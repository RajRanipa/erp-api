import mongoose from 'mongoose';
import Temperature from '../models/Temperature.js';
import Density from '../models/Density.js';
import Dimension from '../models/Dimension.js';
import ProductType from '../models/ProductType.js';
import Category from '../models/Category.js';
import Item from '../models/Item.js';
import { AppError, handleError } from '../utils/errorHandler.js';

const fail = (message, statusCode = 400, code = 'PARAMETER_ERROR', details = null) =>
  new AppError(message, { statusCode, code, details });

const validateObjectId = (value, field) => {
  if (!mongoose.isValidObjectId(value)) {
    throw fail(`${field} is invalid`, 400, 'INVALID_ID', { field });
  }
};

const mapDensity = doc => ({
  label: `${doc.value}${doc.unit ? ` ${doc.unit}` : ''}`.trim(),
  value: String(doc._id),
});

const mapTemperature = doc => ({
  label: `${doc.value}${doc.unit ? ` ${doc.unit}` : ''}`.trim(),
  value: String(doc._id),
});

const mapDimension = doc => {
  const values = [doc.length, doc.width, doc.thickness]
    .filter(value => value !== undefined && value !== null);
  return {
    label: `${values.join(' × ')}${doc.unit ? ` ${doc.unit}` : ''}`.trim(),
    value: String(doc._id),
  };
};

const parseMeasurement = (body, label) => {
  const value = Number(body?.value);
  const unit = String(body?.unit || '').trim();
  const productType = body?.productType;

  if (!Number.isFinite(value) || value < 0) {
    throw fail(`${label} value must be a non-negative number`);
  }
  if (!unit) throw fail(`${label} unit is required`);
  validateObjectId(productType, 'productType');

  return { value, unit, productType };
};

async function validateProductType(productTypeId, categoryId = null) {
  validateObjectId(productTypeId, 'productType');
  const productType = await ProductType.findById(productTypeId)
    .select('_id categories name')
    .lean();
  if (!productType) throw fail('Product type not found', 400, 'PRODUCT_TYPE_NOT_FOUND');

  if (categoryId) {
    validateObjectId(categoryId, 'category');
    const category = await Category.findById(categoryId).select('_id').lean();
    if (!category) throw fail('Category not found', 400, 'CATEGORY_NOT_FOUND');
    if (!productType.categories.some(id => String(id) === String(categoryId))) {
      throw fail('Product type is not available for the selected category');
    }
  }

  return productType;
}

const parseDimension = body => {
  const unit = String(body?.unit || '').trim();
  const category = body?.category;
  const productType = body?.productType;
  const rawValues = [body?.length, body?.width, body?.thickness];
  const hasAnyValue = rawValues.some(
    value => value !== undefined && value !== null && String(value).trim() !== '',
  );

  if (!hasAnyValue) {
    throw fail('At least one of length, width or thickness is required');
  }
  if (!unit) throw fail('Dimension unit is required');
  validateObjectId(category, 'category');
  validateObjectId(productType, 'productType');

  const [length, width, thickness] = rawValues.map(value => {
    if (value === undefined || value === null || String(value).trim() === '') return 0;
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) {
      throw fail('Dimension values must be non-negative numbers');
    }
    return numberValue;
  });

  return { length, width, thickness, unit, category, productType };
};

async function ensureParameterUnused(field, id, label, action = 'deleted') {
  validateObjectId(id, `${label} id`);
  const itemCount = await Item.countDocuments({ [field]: id });
  if (itemCount > 0) {
    throw fail(
      `${label} cannot be ${action} because ${itemCount} Item(s) use it. Create a new specification instead.`,
      409,
      'PARAMETER_IN_USE',
      { itemCount },
    );
  }
}

export const getDensitys = async (req, res) => {
  try {
    const rows = await Density.find({})
      .populate({
        path: 'productType',
        select: 'name categories',
        populate: { path: 'categories', select: 'name' },
      })
      .sort({ value: 1 })
      .lean();
    return res.json(rows);
  } catch (error) {
    return handleError(res, error);
  }
};

export const getDensityOptions = async (req, res) => {
  try {
    const rows = await Density.find({}).sort({ value: 1 }).lean();
    return res.json(rows.map(mapDensity));
  } catch (error) {
    return handleError(res, error);
  }
};

export const getAllTemperature = async (req, res) => {
  try {
    const rows = await Temperature.find({})
      .populate({
        path: 'productType',
        select: 'name categories',
        populate: { path: 'categories', select: 'name' },
      })
      .sort({ value: 1 })
      .lean();
    return res.json(rows);
  } catch (error) {
    return handleError(res, error);
  }
};

export const getAllDimension = async (req, res) => {
  try {
    const rows = await Dimension.find({})
      .populate('productType', 'name')
      .populate('category', 'name')
      .sort({ length: 1, width: 1, thickness: 1 })
      .lean();
    return res.json(rows);
  } catch (error) {
    return handleError(res, error);
  }
};

export const getDimensionOptionsById = async (req, res) => {
  try {
    const { productType, category } = req.query || {};
    await validateProductType(productType, category);
    const rows = await Dimension.find({ productType, category })
      .sort({ length: 1, width: 1, thickness: 1 })
      .lean();
    return res.json(rows.map(mapDimension));
  } catch (error) {
    return handleError(res, error);
  }
};

export const getDensityOptionsById = async (req, res) => {
  try {
    const { productType } = req.query || {};
    await validateProductType(productType);
    const rows = await Density.find({ productType }).sort({ value: 1 }).lean();
    return res.json(rows.map(mapDensity));
  } catch (error) {
    return handleError(res, error);
  }
};

export const getTemperatureOptionsById = async (req, res) => {
  try {
    const { productType } = req.query || {};
    await validateProductType(productType);
    const rows = await Temperature.find({ productType }).sort({ value: 1 }).lean();
    return res.json(rows.map(mapTemperature));
  } catch (error) {
    return handleError(res, error);
  }
};

export const getAllParameterOptions = async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    const [densities, temperatures, dimensions, packings] = await Promise.all([
      Density.find({}).sort({ value: 1 }).lean(),
      Temperature.find({}).sort({ value: 1 }).lean(),
      Dimension.find({}).sort({ length: 1, width: 1, thickness: 1 }).lean(),
      Item.find({
        ...(companyId ? { companyId } : {}),
        categoryKey: 'PACKING',
        status: 'active',
      })
        .select('_id name')
        .sort({ name: 1 })
        .lean(),
    ]);

    return res.json({
      density: densities.map(mapDensity),
      temperature: temperatures.map(mapTemperature),
      dimension: dimensions.map(mapDimension),
      packing: packings.map(item => ({
        label: item.name,
        value: String(item._id),
      })),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const createDensity = async (req, res) => {
  try {
    const payload = parseMeasurement(req.body, 'Density');
    await validateProductType(payload.productType);
    const density = await Density.create(payload);
    return res.status(201).json({
      success: true,
      message: 'Density created',
      data: density,
      option: mapDensity(density),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateDensity = async (req, res) => {
  try {
    validateObjectId(req.params.id, 'density id');
    await ensureParameterUnused('density', req.params.id, 'Density', 'updated');
    const payload = parseMeasurement(req.body, 'Density');
    await validateProductType(payload.productType);
    const density = await Density.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });
    if (!density) throw fail('Density not found', 404, 'DENSITY_NOT_FOUND');
    return res.json({ success: true, message: 'Density updated', data: density });
  } catch (error) {
    return handleError(res, error);
  }
};

export const deleteDensity = async (req, res) => {
  try {
    await ensureParameterUnused('density', req.params.id, 'Density');
    const density = await Density.findByIdAndDelete(req.params.id);
    if (!density) throw fail('Density not found', 404, 'DENSITY_NOT_FOUND');
    return res.json({ success: true, message: 'Density deleted' });
  } catch (error) {
    return handleError(res, error);
  }
};

export const createTemperature = async (req, res) => {
  try {
    const payload = parseMeasurement(req.body, 'Temperature');
    await validateProductType(payload.productType);
    const temperature = await Temperature.create(payload);
    return res.status(201).json({
      success: true,
      message: 'Temperature created',
      data: temperature,
      option: mapTemperature(temperature),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateTemperature = async (req, res) => {
  try {
    validateObjectId(req.params.id, 'temperature id');
    await ensureParameterUnused('temperature', req.params.id, 'Temperature', 'updated');
    const payload = parseMeasurement(req.body, 'Temperature');
    await validateProductType(payload.productType);
    const temperature = await Temperature.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });
    if (!temperature) {
      throw fail('Temperature not found', 404, 'TEMPERATURE_NOT_FOUND');
    }
    return res.json({
      success: true,
      message: 'Temperature updated',
      data: temperature,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const deleteTemperature = async (req, res) => {
  try {
    await ensureParameterUnused('temperature', req.params.id, 'Temperature');
    const temperature = await Temperature.findByIdAndDelete(req.params.id);
    if (!temperature) {
      throw fail('Temperature not found', 404, 'TEMPERATURE_NOT_FOUND');
    }
    return res.json({ success: true, message: 'Temperature deleted' });
  } catch (error) {
    return handleError(res, error);
  }
};

export const createDimension = async (req, res) => {
  try {
    const payload = parseDimension(req.body);
    await validateProductType(payload.productType, payload.category);
    const dimension = await Dimension.create(payload);
    return res.status(201).json({
      success: true,
      message: 'Dimension created',
      data: dimension,
      option: mapDimension(dimension),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const UpdateDimension = async (req, res) => {
  try {
    const id = req.params.id || req.body?._id;
    validateObjectId(id, 'dimension id');
    await ensureParameterUnused('dimension', id, 'Dimension', 'updated');
    const payload = parseDimension(req.body);
    await validateProductType(payload.productType, payload.category);
    const dimension = await Dimension.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });
    if (!dimension) throw fail('Dimension not found', 404, 'DIMENSION_NOT_FOUND');
    return res.json({
      success: true,
      message: 'Dimension updated',
      data: dimension,
      option: mapDimension(dimension),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const deleteDimension = async (req, res) => {
  try {
    await ensureParameterUnused('dimension', req.params.id, 'Dimension');
    const dimension = await Dimension.findByIdAndDelete(req.params.id);
    if (!dimension) throw fail('Dimension not found', 404, 'DIMENSION_NOT_FOUND');
    return res.json({ success: true, message: 'Dimension deleted' });
  } catch (error) {
    return handleError(res, error);
  }
};
