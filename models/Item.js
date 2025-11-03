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
  [STATUS.ARCHIVED]:     [],
};

const { Schema } = mongoose;

const ItemSchema = new Schema({
  // Common fields
  name: { type: String, required: true, trim: true },
  sku: { type: String, unique: true, trim: true },
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
  categoryKey: { type: String, enum: ['RAW', 'FG', 'PACKING'], index: true },
  product_unit: { type: String, required: true },
  currentStock: { type: Number, default: 0 },
  minimumStock: { type: Number, default: 0 },
  purchasePrice: { type: Number, default: 0 },
  salePrice: { type: Number, default: 0 },
  description: { type: String, trim: true },

  // RawMaterial specific: optional for FG / Packing
  raw_specificField1: { type: String },
  raw_specificField2: { type: String },
  // Optional grade for raw materials. When present, name+grade+categoryKey(RAW) must be unique.
  grade: { type: String, trim: true },

  // Product / FG specific
  productType: { type: Schema.Types.ObjectId, ref: 'ProductType' },
  temperature: { type: Schema.Types.ObjectId, ref: 'Temperature' },
  density: { type: Schema.Types.ObjectId, ref: 'Density' },
  dimension: { type: Schema.Types.ObjectId, ref: 'Dimension' },
  packing: { type: Schema.Types.ObjectId, ref: 'Item' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date, default: Date.now },
  // isArchived: { type: Boolean, default: false },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
  // Packing specific
  brandType: { type: String, enum: ['branded', 'plain'] },
  productColor: { type: String },
  //   packing_dimension: { type: Schema.Types.ObjectId, ref: 'Dimension' },
}, { timestamps: true });


// Quick lookup for SKU
ItemSchema.index({ sku: 1 }, { unique: true });
// Unique combination for raw materials by (name + grade). Only applies when categoryKey === 'RAW' and grade exists.
ItemSchema.index({ name: 1, grade: 1, categoryKey: 1 }, { unique: true, partialFilterExpression: { categoryKey: 'RAW', grade: { $exists: true, $ne: '' } } });
ItemSchema.index({ status: 1 });
ItemSchema.index({ categoryKey: 1, status: 1, name: 1 });

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
    throw new Error(`Invalid status change: ${from} → ${to}`);
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
    return next(new Error('Prices cannot be negative'));
  }
  next();
});

// Populate categoryKey from Category.name when category is set but categoryKey is missing
ItemSchema.pre('validate', async function (next) {
  if (this.category && !this.categoryKey) {
    try {
      const cat = await mongoose.models.Category.findById(this.category).select('name').lean();
      if (cat && cat.name) {
        const n = String(cat.name).toLowerCase();
        if (n.includes('raw')) this.categoryKey = 'RAW';
        else if (n.includes('finish') || n.includes('finished')) this.categoryKey = 'FG';
        else if (n.includes('pack')) this.categoryKey = 'PACKING';
        else this.categoryKey = 'FG'; // fallback
      }
    } catch (err) {
      // ignore - fallback required value will raise validation if missing
    }
  }
  next();
});

// Auto-generate SKU if not provided
ItemSchema.pre('save', async function (next) {
  if (!this.sku) {
    let prefix = 'ITEM-';
    if (this.category) {
      try {
        const categoryDoc = await mongoose.models.Category.findById(this.category).select('name').lean();
        if (categoryDoc && categoryDoc.name) {
          const catName = categoryDoc.name.toUpperCase();
          if (catName === 'RAW') prefix = 'RAW-';
          else if (catName === 'FG') prefix = 'FG-';
          else if (catName === 'PACKING') prefix = 'PACK-';
        }
      } catch (err) {
        // fallback to default prefix
      }
    }

    const namePart = (this.name ?? 'XXX').substring(0, 3).toUpperCase();
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
    // dimension is required for packing items
    if (!this.productType) {
      return next(new Error('product type is required for packing items'));
    }
    if (!this.dimension) {
      return next(new Error('dimension is required for packing items'));
    }
    // If brandType is NOT provided, enforce uniqueness on (categoryKey, productType, name)
    if (!this.brandType && !this.productColor) {
      const queryNoBrand = {
        categoryKey: 'PACKING',
        productType: this.productType,
        name: this.name,
        dimension: this.dimension
      };
      // If productColor is set on the current doc, we still want to allow duplicates that differ only by productColor
      // (so we do NOT include productColor in the uniqueness criteria when brandType is missing).

      const existingNoBrand = await mongoose.models.Item.findOne(queryNoBrand).lean();
      if (existingNoBrand && String(existingNoBrand._id) !== String(this._id)) {
        return next(new Error('Duplicate PACKING item detected: same categoryKey, productType, name and dimension  already exist'));
      }
    }
    if (this.brandType) {
      // Base query for all cases
      let query = {
        categoryKey: 'PACKING',
        productType: this.productType,
        name: this.name,
        brandType: this.brandType,
        dimension : this.dimension
      };

      // If productColor exists and is not empty, include it in uniqueness check
      if (this.productColor && this.productColor.trim() !== '') {
        query.productColor = this.productColor;
      } else {
        // If no productColor, exclude documents where productColor exists
        query.$or = [
          { productColor: { $exists: false } },
          { productColor: null },
          { productColor: '' }
        ];
      }
      // Check for existing document
      const existing = await mongoose.models.Item.findOne(query);

      if (existing && existing._id.toString() !== this._id.toString()) {
        let errorMessage = 'Duplicate PACKING item detected';
        if (this.productColor) errorMessage += ` with same productColor "${this.productColor}"`;
        if (this.dimension) errorMessage += ` and same dimension`;
        return next(new Error(errorMessage));
      }
    }
  }
  // --- RAW material: if grade provided, ensure name+grade combination is unique ---
  if (this.categoryKey === 'RAW') {
    if (this.grade && String(this.grade).trim() !== '') {
      const query = {
        categoryKey: 'RAW',
        name: this.name,
        grade: String(this.grade).trim(),
      };
      if (this._id) query._id = { $ne: this._id };
      const existingRaw = await mongoose.models.Item.findOne(query).lean();
      if (existingRaw) {
        return next(new Error('Duplicate RAW material detected: same name and grade already exist'));
      }
    }else{
      // if no grade provided, ensure name is unique
      const query = {
        categoryKey: 'RAW',
        name: this.name,
      };
      if (this._id) query._id = { $ne: this._id };
      const existingRaw = await mongoose.models.Item.findOne(query).lean();
      if (existingRaw) {
        return next(new Error(`duplicate raw material detected: ${this.name} already exist`));
      }
    }
  }
  if (this.categoryKey === 'FG') {
    // --- FG validation & uniqueness (Option A: ProductType has explicit isBulk flag) ---
    try {
      // Determine whether the productType is bulk by reading the ProductType document's isBulk flag
      if (!this.productType) {
        return next(new Error('product type is required for items'));
      }

      let isBulk = false;
      let pt = false;
      if (this.productType) {
        pt = await mongoose.models.ProductType.findById(this.productType).select('name').lean();
        console.log('pt', pt);
        if (pt && pt.name) pt.name === 'bulk' ? isBulk = true : isBulk = false;
      }

      // Required-field checks
      if (!this.temperature) {
        return next(new Error('Temperature is required for items'));
      }
      if (!this.packing) {
        return next(new Error('Packing is required for items'));
      }
      if (!isBulk) {
        // For non-bulk, dimension and density required
        if (!this.dimension) {
          return next(new Error('Dimension is required for items'));
        }
        if (!this.density && pt && pt.name !== "board") {
          return next(new Error('Density is required for items'));
        }
      }

      // Build uniqueness query depending on bulk vs non-bulk
      const baseQuery = { categoryKey: 'FG', productType: this.productType };
      if (!isBulk) {
        // uniqueness: productType + dimension + density + temperature + packing
        baseQuery.dimension = this.dimension;
        console.log('baseQuery.dimension', pt);
        if(pt && pt.name === "board") baseQuery.density = this.density;
        baseQuery.temperature = this.temperature;
        baseQuery.packing = this.packing;
      } else {
        // bulk uniqueness: productType + temperature + packing
        baseQuery.temperature = this.temperature;
        baseQuery.packing = this.packing;
      }

      // Exclude current doc when checking for duplicates (useful during updates)
      if (this._id) baseQuery._id = { $ne: this._id };

      const existingFG = await mongoose.models.Item.findOne(baseQuery).lean();
      console.log('existingFG -->> ', existingFG);
      if (existingFG) {
        return next(new Error('Duplicate product item detected for the provided combination of fields'));
      }
    } catch (err) {
      return next(err);
    }
  }

  next();
});

export default mongoose.model('Item', ItemSchema);

// need to write controller for fetching all packing items 