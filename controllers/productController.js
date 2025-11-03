// controllers/productController.js
import Product from '../models/Product.js';
import packingMaterial from '../models/Packing.js';
import ProductType from '../models/ProductType.js';
import Temperature from '../models/Temperature.js';
import Density from '../models/Density.js';
import Dimension from '../models/Dimension.js';

// ---------- Reusable Helpers (Validation + Normalization) ----------
const isString = (v) => typeof v === 'string';
const isNonEmptyString = (v) => isString(v) && v.trim().length > 0;
const toTrimmed = (v) => (isString(v) ? v.trim() : v);

// Accepts only 24-hex ObjectId-like strings
const isObjectIdLike = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);

// Ensure a referenced doc exists; returns the id if found else null
const ensureExists = async (Model, id) => {
  if (!isObjectIdLike(id)) return null;
  const exists = await Model.exists({ _id: id });
  return exists ? id : null;
};

// Resolve specific refs; all return the valid id or null
const resolveProductTypeId = async (input) => (input ? ensureExists(ProductType, input) : null);
const resolveTemperatureId = async (input) => (input ? ensureExists(Temperature, input) : null);
const resolveDensityId     = async (input) => (input ? ensureExists(Density, input) : null);
const resolveDimensionId   = async (input) => (input ? ensureExists(Dimension, input) : null);
const resolvePackingId     = async (input) => (input ? ensureExists(packingMaterial, input) : null);

// Build a compact SKU: PRODUCTNAME-(TEMP?)-(DENS?)-(DIM?)-(PACKUNIT?)-<base36-ts>
// Uses ORIGINAL payload (not resolved ids) so it works with legacy callers.
const slug = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, '');
const buildSKU = (body) => {
  const parts = [];
  if (body.productName) parts.push(slug(body.productName));
  if (body.temperature && (body.temperature.value ?? body.temperature) && body.temperature.unique === 'yes') {
    parts.push(String(body.temperature.value ?? body.temperature));
  }
  if (body.density && (body.density.value ?? body.density) && body.density.unique === 'yes') {
    parts.push(String(body.density.value ?? body.density));
  }
  if (body.dimension && body.dimension.unique === 'yes') {
    const { length, width, thickness } = body.dimension;
    if (length && width && thickness) parts.push(`${length}x${width}x${thickness}`);
  }
  if (body.packing && body.packing.unique === 'yes') {
    if (body.packing.unit) parts.push(slug(body.packing.unit));
  }
  parts.push(Date.now().toString(36));
  return parts.filter(Boolean).join('-');
};

// Validate requireds + business rules; returns { ok, errors, safe }
// - Does NOT touch DB; only checks presence/format. Ref existence is checked by resolve step.
const validateProductInput = (input) => {
  const errors = {};
  const safe = { ...input };

  // Normalize obvious string fields
  safe.productName = toTrimmed(safe.productName);
  safe.product_unit = toTrimmed(safe.product_unit);

  if (!isNonEmptyString(safe.productName)) {
    errors.productName = 'productName is required';
  }
  if (!isNonEmptyString(safe.product_unit)) {
    errors.product_unit = 'product_unit is required';
  }
  // productType is required (ObjectId string)
  if (!isObjectIdLike(safe.productType)) {
    errors.productType = 'productType id is required/invalid';
  }
  // temperature required (ObjectId string)
  if (!isObjectIdLike(safe.temperature)) {
    errors.temperature = 'temperature id is required/invalid';
  }
  // packingType required (supports alias "packing")
  const packingInput = safe.packingType ?? safe.packing;
  if (!isObjectIdLike(packingInput)) {
    errors.packingType = 'packingType id is required/invalid';
  }

  // Optional refs (if provided, must at least look like ObjectId)
  if (safe.density !== undefined && safe.density !== null && !isObjectIdLike(safe.density)) {
    errors.density = 'density id is invalid';
  }
  if (safe.dimension !== undefined && safe.dimension !== null && !isObjectIdLike(safe.dimension)) {
    errors.dimension = 'dimension id is invalid';
  }

  // Numeric sanity (if provided)
  const nonNeg = (n) => Number.isFinite(n) && n >= 0;
  if (safe.purchasePrice != null && !nonNeg(Number(safe.purchasePrice))) {
    errors.purchasePrice = 'purchasePrice must be a non-negative number';
  }
  if (safe.salePrice != null && !nonNeg(Number(safe.salePrice))) {
    errors.salePrice = 'salePrice must be a non-negative number';
  }
  if (safe.currentStock != null && !nonNeg(Number(safe.currentStock))) {
    errors.currentStock = 'currentStock must be a non-negative number';
  }
  if (safe.minimumStock != null && !nonNeg(Number(safe.minimumStock))) {
    errors.minimumStock = 'minimumStock must be a non-negative number';
  }

  return { ok: Object.keys(errors).length === 0, errors, safe };
};

// Resolve & verify DB existence of refs; returns sanitized "body" or an error map
const resolveAndVerifyRefs = async (safe) => {
  const errors = {};

  // Required refs
  const ptId = await resolveProductTypeId(safe.productType);
  if (!ptId) errors.productType = 'Invalid productType id';

  const tId = await resolveTemperatureId(safe.temperature);
  if (!tId) errors.temperature = 'Invalid temperature id';

  const pInput = safe.packingType ?? safe.packing;
  const pId = await resolvePackingId(pInput);
  if (!pId) errors.packingType = 'Invalid packingType id';

  // Optional refs
  let dId = null;
  if (safe.density !== undefined && safe.density !== null) {
    dId = await resolveDensityId(safe.density);
    if (!dId) errors.density = 'Invalid density id';
  }

  let dimId = null;
  if (safe.dimension !== undefined && safe.dimension !== null) {
    dimId = await resolveDimensionId(safe.dimension);
    if (!dimId) errors.dimension = 'Invalid dimension id';
  }

  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }

  const out = {
    productName: safe.productName,
    product_unit: safe.product_unit,
    productType: ptId,
    temperature: tId,
    packingType: pId,
    purchasePrice: safe.purchasePrice,
    salePrice: safe.salePrice,
    currentStock: safe.currentStock,
    minimumStock: safe.minimumStock,
    description: safe.description,
  };
  if (dId) out.density = dId;
  else out.density = null;

  if (dimId) out.dimension = dimId;
  else out.dimension = null;

  return { ok: true, body: out };
};
// ---------- End Helpers ----------

export const getProducts = async (req, res) => {
  try {
    const products = await Product.find()
      .populate({ path: 'productType', select: 'name code', strictPopulate: false })
      .populate({ path: 'temperature', select: 'value unit', strictPopulate: false })
      .populate({ path: 'density', select: 'value unit', strictPopulate: false })
      .populate({ path: 'dimension', select: 'length width thickness unit', strictPopulate: false })
      .populate({ path: 'packingType', select: 'productName product_unit brandType currentStock purchasePrice minimumStock description', strictPopulate: false })
      .lean();
      console.log('Fetched products:', products[0]);
    res.status(200).json(products);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ message: 'Error fetching products.', error: err.message });
  }
};

// Fetch unique product names
export const getUniqueProductNames = async (req, res) => {
  try {
    const names = await Product.distinct('productName');
    res.json(names);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching product names' });
  }
};

// Fetch unique dimensions for a product name
export const getUniqueDimensions = async (req, res) => {
  try {
    const { productName } = req.query;
    if (!productName) {
      return res.status(400).json({ message: 'productName is required' });
    }
    const dimensions = await Product.distinct('parameters.dimension.value', { productName });
    res.json(dimensions);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching dimensions' });
  }
};

// Fetch unique densities for product name + dimension
export const getUniqueDensities = async (req, res) => {
  try {
    const { productName, dimension } = req.query;
    if (!productName || !dimension) {
      return res.status(400).json({ message: 'productName and dimension are required' });
    }
    const densities = await Product.distinct('parameters.density.value', {
      productName,
      'parameters.dimension.value': dimension
    });
    res.json(densities);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching densities' });
  }
};

// Fetch unique temperatures for product name + dimension + density
export const getUniqueTemperatures = async (req, res) => {
  try {
    const { productName, dimension, density } = req.query;
    if (!productName || !dimension || !density) {
      return res.status(400).json({ message: 'productName, dimension, and density are required' });
    }
    const temperatures = await Product.distinct('parameters.temperature.value', {
      productName,
      'parameters.dimension.value': dimension,
      'parameters.density.value': density
    });
    res.json(temperatures);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching temperatures' });
  }
};

// Fetch unique packings for product name + dimension + density + temperature
export const getUniquePackings = async (req, res) => {
  try {
    const { productName, dimension, density, temperature } = req.query;
    if (!productName || !dimension || !density || !temperature) {
      return res.status(400).json({ message: 'productName, dimension, density, and temperature are required' });
    }
    const packings = await Product.distinct('parameters.packing.value', {
      productName,
      'parameters.dimension.value': dimension,
      'parameters.density.value': density,
      'parameters.temperature.value': temperature
    });
    res.json(packings);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching packings' });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: 'Error updating product' });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting product' });
  }
};

export const createProduct = async (req, res) => {
  try {
    const original = { ...req.body };
    const { ok, errors, safe } = validateProductInput(original);
    if (!ok) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }

    // Resolve DB refs and verify existence
    const resolved = await resolveAndVerifyRefs(safe);
    if (!resolved.ok) {
      return res.status(400).json({ success: false, message: 'Invalid references', errors: resolved.errors });
    }

    // Build SKU from ORIGINAL payload (keeps legacy unique flags support)
    const sku = buildSKU(original);
    if (!isNonEmptyString(sku)) {
      return res.status(400).json({ success: false, message: 'Failed to build SKU from payload' });
    }

    // Persist
    const doc = new Product({ ...resolved.body, sku });
    await doc.save();

    // Populate key refs for immediate client use
    const saved = await Product.findById(doc._id)
      .populate({ path: 'productType', select: 'name code', strictPopulate: false })
      .populate({ path: 'temperature', select: 'value unit', strictPopulate: false })
      .populate({ path: 'density', select: 'value unit', strictPopulate: false })
      .populate({ path: 'dimension', select: 'length width thickness unit', strictPopulate: false })
      .populate({ path: 'packingType', select: 'productName product_unit brandType currentStock purchasePrice minimumStock description', strictPopulate: false });

    return res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: saved,
    });
  } catch (err) {
    // Duplicate key handling (e.g., unique index collisions on sku or composite partial indexes)
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'A product with these parameters already exists', keyValue: err.keyValue });
    }
    console.error('Error creating product:', err);
    return res.status(500).json({ success: false, message: 'Error creating product' });
  }
};