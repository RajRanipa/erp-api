// models/Item.js


import mongoose from 'mongoose';

export const STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending_approval',
  REJECTED: 'rejected',
  APPROVED: 'approved',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
};

const statusTransitions = {
  [STATUS.DRAFT]:        [STATUS.PENDING, STATUS.ARCHIVED],
  [STATUS.PENDING]:      [STATUS.APPROVED, STATUS.REJECTED, STATUS.ARCHIVED],
  [STATUS.REJECTED]:     [STATUS.DRAFT, STATUS.ARCHIVED],
  [STATUS.APPROVED]:     [STATUS.ACTIVE, STATUS.ARCHIVED],
  [STATUS.ACTIVE]:       [STATUS.ARCHIVED],
  [STATUS.ARCHIVED]:     [STATUS.DRAFT],
};

const { Schema } = mongoose;

const itemError = (message, statusCode = 400, code = 'ITEM_VALIDATION_ERROR') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const ItemSchema = new Schema({
  // Common fields
  name: { type: String, required: true, trim: true, maxlength: 160 },
  sku: { type: String, unique: true, trim: true, uppercase: true },
  status: { type: String, enum: Object.values(STATUS), default: STATUS.DRAFT },
  // Audit trail for status changes (embedded history)
  statusHistory: [{
    from:   { type: String, enum: Object.values(STATUS) },
    to:     { type: String, enum: Object.values(STATUS) },
    reason: { type: String, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    at:     { type: Date, default: Date.now },
  }],
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  // denormalized category key for fast conditional indexing/validation
  categoryKey: {
    type: String,
    enum: ['RAW', 'FG', 'PACKING', 'NC'],
    required: true,
    index: true,
  },
  UOM: { type: String, required: true, trim: true, lowercase: true },
  // Legacy cached stock. InventorySnapshot is authoritative.
  currentStock: { type: Number, default: 0, select: false },
  minimumStock: { type: Number, default: 0, min: 0 },
  purchasePrice: { type: Number, default: 0, min: 0 },
  salePrice: { type: Number, default: 0, min: 0 },
  description: { type: String, trim: true, maxlength: 2000 },

  // RawMaterial specific: optional for FG / Packing
  raw_specificField1: { type: String, trim: true },
  raw_specificField2: { type: String, trim: true },
  // Optional grade for raw materials. When present, name+grade+categoryKey(RAW) must be unique.
  grade: { type: String, trim: true, lowercase: true, default: '' },

  // Product / FG specific
  productType: { type: Schema.Types.ObjectId, ref: 'ProductType' },
  temperature: { type: Schema.Types.ObjectId, ref: 'Temperature' },
  density: { type: Schema.Types.ObjectId, ref: 'Density' },
  dimension: { type: Schema.Types.ObjectId, ref: 'Dimension' },
  packing: { type: Schema.Types.ObjectId, ref: 'Item' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
    immutable: true,
  },
  // Packing specific
  brandType: { type: String, enum: ['branded', 'plain'] },
  productColor: { type: String, trim: true, lowercase: true },
  //   packing_dimension: { type: Schema.Types.ObjectId, ref: 'Dimension' },
}, { timestamps: true });


// Quick lookup for SKU
// ItemSchema.index({ sku: 1 }, { unique: true });
// Enforce RAW identity at the database level, including Items with no grade.
ItemSchema.index(
  { companyId: 1, name: 1, grade: 1, categoryKey: 1 },
  {
    unique: true,
    partialFilterExpression: { categoryKey: 'RAW' },
    name: 'uniq_company_raw_name_grade',
  },
);
ItemSchema.index({ companyId: 1, status: 1 });
ItemSchema.index({ companyId: 1, categoryKey: 1, status: 1, name: 1 });

// --- Virtuals ---
ItemSchema.virtual('inStock').get(function () {
  return (this.currentStock ?? 0) > 0;
});
ItemSchema.virtual('lowStock').get(function () {
  const min = this.minimumStock ?? 0;
  const cur = this.currentStock ?? 0;
  return cur > 0 && cur <= min;
});

// --- Status Transition Rules ---
ItemSchema.statics.canTransition = function (from, to) {
  return (statusTransitions[from] || []).includes(to);
};

/**
 * Safe status setter with audit trail.
 * Usage: await item.setStatus('active', { userId: req.user._id, reason: 'QC approved' });
 */
ItemSchema.methods.setStatus = async function (to, { userId, reason } = {}) {
  const from = this.status;
  if (from === to) return this;

  if (!this.constructor.canTransition(from, to)) {
    throw itemError(
      `Invalid status change: ${from} → ${to}`,
      409,
      'INVALID_STATUS_TRANSITION',
    );
  }

  // Push audit record
  this.statusHistory = this.statusHistory || [];
  this.statusHistory.push({
    from,
    to,
    reason: reason || '',
    userId: userId || undefined,
    at: new Date(),
  });

  this.status = to;
  await this.save();
  return this;
};

// --- Validation ---
ItemSchema.pre('validate', function (next) {
  const buy = this.purchasePrice != null ? Number(this.purchasePrice) : 0;
  const sell = this.salePrice != null ? Number(this.salePrice) : 0;
  if (sell < 0 || buy < 0) {
    return next(itemError('Prices cannot be negative'));
  }
  next();
});

// Populate categoryKey from the controlled Category enum.
ItemSchema.pre('validate', async function (next) {
  if (this.category && !this.categoryKey) {
    try {
      const cat = await mongoose.models.Category.findById(this.category).select('name').lean();
      if (cat && cat.name) {
        const n = String(cat.name).toLowerCase();
        if (n === 'raw material') this.categoryKey = 'RAW';
        else if (n === 'finished goods') this.categoryKey = 'FG';
        else if (n === 'packing material') this.categoryKey = 'PACKING';
        else if (n === 'non-conformance') this.categoryKey = 'NC';
      }
    } catch (err) {
      return next(err);
    }
  }
  next();
});

ItemSchema.pre('validate', async function validateItemReferences(next) {
  try {
    const [
      productType,
      temperature,
      density,
      dimension,
      packing,
    ] = await Promise.all([
      this.productType
        ? mongoose.models.ProductType.findById(this.productType)
          .select('name categories')
          .lean()
        : null,
      this.temperature
        ? mongoose.models.Temperature.findById(this.temperature)
          .select('productType')
          .lean()
        : null,
      this.density
        ? mongoose.models.Density.findById(this.density)
          .select('productType')
          .lean()
        : null,
      this.dimension
        ? mongoose.models.Dimension.findById(this.dimension)
          .select('category productType')
          .lean()
        : null,
      this.packing
        ? mongoose.models.Item.findById(this.packing)
          .select('companyId categoryKey productType status')
          .lean()
        : null,
    ]);

    if (this.productType && !productType) {
      return next(itemError('Selected product type does not exist'));
    }
    if (
      productType &&
      this.category &&
      !productType.categories.some(categoryId =>
        String(categoryId) === String(this.category)
      )
    ) {
      return next(itemError('Selected product type is not available for this category'));
    }
    if (this.temperature && !temperature) {
      return next(itemError('Selected temperature does not exist'));
    }
    if (
      temperature &&
      this.productType &&
      String(temperature.productType) !== String(this.productType)
    ) {
      return next(itemError('Selected temperature does not belong to the product type'));
    }
    if (this.density && !density) {
      return next(itemError('Selected density does not exist'));
    }
    if (
      density &&
      this.productType &&
      String(density.productType) !== String(this.productType)
    ) {
      return next(itemError('Selected density does not belong to the product type'));
    }
    if (this.dimension && !dimension) {
      return next(itemError('Selected dimension does not exist'));
    }
    if (
      dimension &&
      (
        String(dimension.category) !== String(this.category) ||
        String(dimension.productType) !== String(this.productType)
      )
    ) {
      return next(itemError('Selected dimension does not belong to the category and product type'));
    }
    if (this.packing && !packing) {
      return next(itemError('Selected packing Item does not exist'));
    }
    if (
      packing &&
      (
        packing.categoryKey !== 'PACKING' ||
        String(packing.companyId) !== String(this.companyId) ||
        (
          this.status !== STATUS.ARCHIVED &&
          packing.status !== STATUS.ACTIVE
        )
      )
    ) {
      return next(itemError('Packing must be an active PACKING Item from the same company'));
    }
    if (
      packing?.productType &&
      this.productType &&
      String(packing.productType) !== String(this.productType)
    ) {
      return next(itemError('Selected packing Item does not belong to the product type'));
    }

    this.$locals.productTypeDoc = productType;
    return next();
  } catch (error) {
    return next(error);
  }
});

// Auto-generate SKU if not provided
ItemSchema.pre('save', async function (next) {
  if (!this.sku) {
    const prefix = {
      RAW: 'RAW-',
      FG: 'FG-',
      PACKING: 'PACK-',
      NC: 'NC-',
    }[this.categoryKey] || 'ITEM-';

    const namePart = (this.name ?? 'XXX')
      .replace(/[^a-z0-9]/gi, '')
      .substring(0, 3)
      .toUpperCase()
      .padEnd(3, 'X');
    let serial = 1;
    let skuCandidate = `${prefix}${namePart}-${serial.toString().padStart(3, '0')}`;

    while (await mongoose.models.Item.findOne({ sku: skuCandidate })) {
      serial++;
      skuCandidate = `${prefix}${namePart}-${serial.toString().padStart(3, '0')}`;
    }

    this.sku = skuCandidate;
  }
  next();
});

// Pre-save hook to prevent duplicate PACKING items
ItemSchema.pre('save', async function (next) {
  // Only enforce for categoryKey 'PACKING' and defined brandType
  if (this.categoryKey === 'PACKING') {
    const trimmedGrade = this.grade && String(this.grade).trim();

    // dimension is required for packing items
    if (!this.productType) {
      return next(itemError('Product type is required for packing Items'));
    }
    if (!this.dimension) {
      return next(itemError('Dimension is required for packing Items'));
    }
    // If brandType is NOT provided, enforce uniqueness on (categoryKey, productType, name, dimension)
    // and, when grade is provided, include grade in the unique combination as well.
    if (!this.brandType && !this.productColor) {
      const queryNoBrand = {
        companyId: this.companyId,
        categoryKey: 'PACKING',
        productType: this.productType,
        name: this.name,
        dimension: this.dimension,
      };

      // If grade is provided, make it part of the unique combo
      // if (trimmedGrade) {
        queryNoBrand.grade = trimmedGrade || { $in: ['', null] };
      // }

      const existingNoBrand = await mongoose.models.Item.findOne(queryNoBrand).lean();
      if (existingNoBrand && String(existingNoBrand._id) !== String(this._id)) {
        return next(itemError(
          'A PACKING Item with the same name and specifications already exists',
          409,
          'DUPLICATE_ITEM',
        ));
      }
    }
    if (this.brandType) {
      // Base query for all cases
      let query = {
        companyId: this.companyId,
        categoryKey: 'PACKING',
        productType: this.productType,
        name: this.name,
        brandType: this.brandType,
        dimension: this.dimension,
      };

      // If grade is provided, make it part of the unique combo
      // if (trimmedGrade) {
        query.grade = trimmedGrade || { $in: ['', null] };
      // }

      // If productColor exists and is not empty, include it in uniqueness check
      if (this.productColor && this.productColor.trim() !== '') {
        query.productColor = this.productColor;
      } else {
        // If no productColor, exclude documents where productColor exists
        query.$or = [
          { productColor: { $exists: false } },
          { productColor: null },
          { productColor: '' },
        ];
      }

      // Check for existing document
      const existing = await mongoose.models.Item.findOne(query);

      if (existing && existing._id.toString() !== this._id.toString()) {
        let errorMessage = 'Duplicate PACKING item detected';
        if (this.productColor) errorMessage += ` with same productColor "${this.productColor}"`;
        if (this.dimension) errorMessage += ` and same dimension`;
        if (trimmedGrade) errorMessage += ` and same grade "${trimmedGrade}"`;
        return next(itemError(errorMessage, 409, 'DUPLICATE_ITEM'));
      }
    }
  }
  // --- RAW material: if grade provided, ensure name+grade combination is unique ---
  if (this.categoryKey === 'RAW') {
    if (this.grade && String(this.grade).trim() !== '') {
      const query = {
        companyId: this.companyId,
        categoryKey: 'RAW',
        name: this.name,
        grade: String(this.grade).trim(),
      };
      if (this._id) query._id = { $ne: this._id };
      const existingRaw = await mongoose.models.Item.findOne(query).lean();
      if (existingRaw) {
        return next(itemError(
          'A RAW Item with the same name and grade already exists',
          409,
          'DUPLICATE_ITEM',
        ));
      }
    }else{
      // if no grade provided, ensure name is unique
      const query = {
        companyId: this.companyId,
        categoryKey: 'RAW',
        name: this.name,
        grade: { $in: ['', null] },
      };
      if (this._id) query._id = { $ne: this._id };
      const existingRaw = await mongoose.models.Item.findOne(query).lean();
      if (existingRaw) {
        return next(itemError(
          `A RAW Item named ${this.name} already exists`,
          409,
          'DUPLICATE_ITEM',
        ));
      }
    }
  }
  if (this.categoryKey === 'FG') {
    // --- FG validation & uniqueness (Option A: ProductType has explicit isBulk flag) ---
    try {
      // Determine whether the productType is bulk by reading the ProductType document's isBulk flag
      if (!this.productType) {
        return next(itemError('Product type is required for finished-goods Items'));
      }

      const pt = this.$locals.productTypeDoc
        || await mongoose.models.ProductType.findById(this.productType)
          .select('name')
          .lean();
      const productTypeName = String(pt?.name || '').trim().toLowerCase();
      const isBulk = productTypeName === 'bulk';

      // Required-field checks
      if (!this.temperature) {
        return next(itemError('Temperature is required for finished-goods Items'));
      }
      if (!this.packing) {
        return next(itemError('Packing is required for finished-goods Items'));
      }
      if (!isBulk) {
        // For non-bulk, dimension and density required
        if (!this.dimension) {
          return next(itemError('Dimension is required for finished-goods Items'));
        }
        if (!this.density && productTypeName !== 'board') {
          return next(itemError('Density is required for finished-goods Items'));
        }
      }

      const trimmedGradeFG = this.grade && String(this.grade).trim();

      const baseQuery = {
        companyId: this.companyId,
        categoryKey: 'FG',
        productType: this.productType,
      };

      // If grade is provided, make it part of the unique combo
      // if (trimmedGradeFG) {
        baseQuery.grade = trimmedGradeFG || { $in: ['', null] };
      // }

      if (!isBulk) {
        // uniqueness: productType + dimension + density + temperature + packing (+ optional grade)
        baseQuery.dimension = this.dimension;
        if (productTypeName !== 'board') baseQuery.density = this.density;
        baseQuery.temperature = this.temperature;
        baseQuery.packing = this.packing;
      } else {
        // bulk uniqueness: productType + temperature + packing (+ optional grade)
        baseQuery.temperature = this.temperature;
        baseQuery.packing = this.packing;
      }

      // Exclude current doc when checking for duplicates (useful during updates)
      if (this._id) baseQuery._id = { $ne: this._id };

      const existingFG = await mongoose.models.Item.findOne(baseQuery).lean();
      // console.log('baseQuery -->> ', baseQuery);
      // console.log('existingFG -->> ', existingFG);
      if (existingFG) {
        return next(itemError(
          'A finished-goods Item with the same specifications already exists',
          409,
          'DUPLICATE_ITEM',
        ));
      }
    } catch (err) {
      return next(err);
    }
  }

  next();
});

export default mongoose.model('Item', ItemSchema);

// need to write controller for fetching all packing items
