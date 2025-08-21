// controllers/productController.js
import Product from '../models/Product.js';
import packingMaterial from '../models/Packing.js';
import ProductType from '../models/ProductType.js';
import Temperature from '../models/Temperature.js';
import Density from '../models/Density.js';
import Dimension from '../models/Dimension.js';

// Removed legacy helpers: getOrCreateTemperature, getOrCreateDensity, getOrCreateDimension, getOrCreatePacking, getPackingId

const slug = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, '');

const buildSKU = (body) => {
  // Build SKU using only fields flagged unique==='yes'. Do not include any units
  // except packing.unit (as requested earlier).
  const parts = [Date.now().toString(36)];
  if (body.productName) parts.push(slug(body.productName));

  if (body.dimension && body.dimension.unique === 'yes') {
    const { length, width, thickness } = body.dimension;
    if (length && width && thickness) parts.push(`${length}x${width}x${thickness}`);
  }
  if (body.density && body.density.unique === 'yes') {
    if (body.density.value !== undefined && body.density.value !== null) parts.push(`${body.density.value}`);
  }
  if (body.temperature && body.temperature.unique === 'yes') {
    if (body.temperature.value !== undefined && body.temperature.value !== null) parts.push(`${body.temperature.value}`);
  }
  if (body.packing && body.packing.unique === 'yes') {
    if (body.packing.unit) parts.push(slug(body.packing.unit)); // include unit only for packing
  }
  return parts.filter(Boolean).join('-');
};

const isObjectIdLike = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);

const ensureExists = async (Model, id) => {
  if (!isObjectIdLike(id)) return null;
  const exists = await Model.exists({ _id: id });
  return exists ? id : null;
};

// Accepts an ObjectId string OR an object payload and returns/creates the ID
const resolveTemperatureId = async (input) => {
  if (!input) return null;
  if (!isObjectIdLike(input)) return null;
  return ensureExists(Temperature, input);
};

const resolveDensityId = async (input) => {
  if (!input) return null;
  if (!isObjectIdLike(input)) return null;
  return ensureExists(Density, input);
};

const resolveDimensionId = async (input) => {
  if (!input) return null;
  if (!isObjectIdLike(input)) return null;
  return ensureExists(Dimension, input);
};

const resolvePackingId = async (input) => {
  if (!input) return null;
  if (!isObjectIdLike(input)) return null;
  return ensureExists(packingMaterial, input);
};

const resolveProductTypeId = async (input) => {
  if (!input) return null;
  if (!isObjectIdLike(input)) return null;
  return ensureExists(ProductType, input);
};

export const createProduct = async (req, res) => {
  try {
    const original = { ...req.body }; // keep for SKU build
    const body = { ...req.body };
    console.log('body new', body);

    body.productName = (body.productName || '').trim();
    body.product_unit = (body.product_unit || '').trim();

    // --- Resolve productType (required) ---
    const ptId = await resolveProductTypeId(body.productType);
    if (!ptId) return res.status(400).json({ message: 'Invalid productType id' });
    body.productType = ptId;

    // --- Resolve optional refs (if provided, must be valid ids) ---
    if (body.temperature !== undefined) {
      const tId = await resolveTemperatureId(body.temperature);
      if (!tId) return res.status(400).json({ message: 'Invalid temperature id' });
      body.temperature = tId;
    }

    if (body.density !== undefined) {
      const dId = await resolveDensityId(body.density);
      if (!dId) return res.status(400).json({ message: 'Invalid density id' });
      body.density = dId;
    }

    if (body.dimension !== undefined) {
      const dimId = await resolveDimensionId(body.dimension);
      if (!dimId) return res.status(400).json({ message: 'Invalid dimension id' });
      body.dimension = dimId;
    }

    // packing can come as `packing` or `packingType`
    const packingInput = body.packingType ?? body.packing;
    if (packingInput !== undefined) {
      const pId = await resolvePackingId(packingInput);
      if (!pId) return res.status(400).json({ message: 'Invalid packing id' });
      body.packingType = pId;
    }
    delete body.packing;

    // --- Build SKU from ORIGINAL payload (supports legacy unique flags) ---
    body.sku = buildSKU(original);

    // --- Basic required checks (keep lightweight) ---
    const requiredMap = {
      productName: body.productName,
      product_unit: body.product_unit,
      productType: body.productType,
      sku: body.sku,
    };
    const missing = Object.entries(requiredMap).filter(([, v]) => v === undefined || v === null || v === '');
    if (missing.length) {
      return res.status(400).json({
        message: 'Missing required fields',
        missing: missing.map(([k]) => k),
        payloadPreview: {
          productName: body.productName,
          product_unit: body.product_unit,
          productType: body.productType,
          sku: body.sku,
        }
      });
    }

    // --- Persist ---
    const product = new Product(body);
    await product.save();

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product,
    });
  } catch (err) {
    console.log('err', err)
    if (err && err.code === 11000) {
      return res.status(400).json({ message: 'A product with these parameters already exists' });
    }
    console.error('Error creating product:', err);
    res.status(500).json({ message: 'Error creating product' });
  }
};

export const getProducts = async (req, res) => {
  try {
    // Find all products and populate the 'packingType' field
    // This will replace the packingType ObjectId with the actual packingMaterial document
    const products = await Product.find().populate('packingType'); // Populate the packingType reference

    res.status(200).json({
      success: true,
      message: 'Products fetched successfully',
      data: products // Send the array of products in a 'data' field
    });

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