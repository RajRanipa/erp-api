import Item from "../models/Item.js";
import ProductType from "../models/ProductType.js";
import Category from '../models/Category.js';
import Temperature from '../models/Temperature.js';
import Density from '../models/Density.js';
import Dimension from '../models/Dimension.js';
import mongoose from 'mongoose';
import { AppError, handleError } from '../utils/errorHandler.js';

const fail = (message, statusCode = 400, code = 'PRODUCT_TYPE_ERROR') =>
  new AppError(message, { statusCode, code });

const normalizeProductTypeInput = async (body = {}) => {
  const name = String(body.name || '').trim().toLowerCase();
  const categories = [...new Set(
    (Array.isArray(body.categories) ? body.categories : [])
      .map(value => String(value)),
  )];

  if (!name) throw fail('Product type name is required');
  if (!categories.length) throw fail('At least one category is required');
  if (categories.some(id => !mongoose.isValidObjectId(id))) {
    throw fail('One or more category IDs are invalid');
  }

  const categoryCount = await Category.countDocuments({ _id: { $in: categories } });
  if (categoryCount !== categories.length) {
    throw fail('One or more categories do not exist');
  }

  return { name, categories };
};

// Create a new ProductType
const createProductType = async (req, res) => {
  try {

    // Extract both productType and the newly required categoryID
    const payload = await normalizeProductTypeInput(req.body);
    const productTypeDoc = new ProductType(payload);

    const savedProductType = await productTypeDoc.save();
    res.status(201).json(savedProductType);
  } catch (error) {
    return handleError(res, error);
  }
};

// Get all ProductTypes as [{ label, value, categoryID }]
const getProductTypes = async (req, res) => {
  try {
    // Optional: Allow the frontend to filter by category (e.g., ?category=60d5ec...)
    // This pairs perfectly with the `apiparams` logic in your frontend SelectTypeInput
    const filter = {};
    if (req.query.category) {
      if (!mongoose.isValidObjectId(req.query.category)) {
        return res.status(400).json({ message: 'Invalid category ID' });
      }
      filter.categories = req.query.category;
    }
    // Return name and categoryID for dropdowns
    const productTypes = await ProductType.find(filter).populate("categories", "name")
      .sort({ name: 1 })
      .lean();

    res.status(200).json(productTypes);
  } catch (error) {
    return handleError(res, error);
  }
};
const getProductTypesOptions = async (req, res) => {
  try {
    // Optional: Allow the frontend to filter by category (e.g., ?category=60d5ec...)
    // This pairs perfectly with the `apiparams` logic in your frontend SelectTypeInput
    const filter = {};
    if (req.query.category) {
      if (!mongoose.isValidObjectId(req.query.category)) {
        return res.status(400).json({ message: 'Invalid category ID' });
      }
      filter.categories = req.query.category;
    }
    // console.log("req.query.category ", req.query.category);

    // Return name and categoryID for dropdowns
    const productTypes = await ProductType.find(filter).populate("categories", "name")
      .sort({ name: 1 })
      .lean();

    // console.log("productTypes ", productTypes);
    // Map to the format your React component expects, including the new ID
    const options = productTypes.map(pt => ({
      label: pt.name,
      value: String(pt._id),
      categories: pt.categories // pass it along in case the frontend needs it
    }));

    res.status(200).json(options);
  } catch (error) {
    return handleError(res, error);
  }
};

// Get a ProductType by ID
const getProductTypeById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid category ID' });
    }
    // Use .populate() to attach the full Category document to the response
    // console.log("req.params.id ", req.params.id);
    const productTypes = await ProductType.find({
      categories: req.params.id
    }).populate("categories", "name");

    const options = productTypes.map(pt => ({
      label: pt.name,
      value: String(pt._id),
      categories: pt.categories // pass it along in case the frontend needs it
    }));
    res.status(200).json(options);
  } catch (error) {
    return handleError(res, error);
  }
};

// Update a ProductType by ID
const updateProductType = async (req, res) => {
  try {
    const { _id } = req.body;
    if (!mongoose.isValidObjectId(_id)) {
      return res.status(400).json({ message: 'Product Type ID is invalid' });
    }

    const payload = await normalizeProductTypeInput(req.body);
    const existingProductType = await ProductType.findById(_id).lean();
    if (!existingProductType) {
      return res.status(404).json({ message: 'ProductType not found' });
    }

    const existingCategoryIds = existingProductType.categories.map(String);
    const removedCategoryIds = existingCategoryIds.filter(
      categoryId => !payload.categories.includes(categoryId)
    );

    const [itemCount, temperatureCount, densityCount, dimensionCount] = await Promise.all([
      Item.countDocuments({ productType: _id }),
      Temperature.countDocuments({ productType: _id }),
      Density.countDocuments({ productType: _id }),
      Dimension.countDocuments({ productType: _id }),
    ]);
    const linkedCount = itemCount + temperatureCount + densityCount + dimensionCount;

    if (existingProductType.name !== payload.name && linkedCount > 0) {
      return res.status(409).json({
        message: (
          'This Product Type cannot be renamed because Items or specification '
          + 'parameters already reference it. Create a new Product Type instead.'
        ),
        itemCount,
        temperatureCount,
        densityCount,
        dimensionCount,
      });
    }

    if (removedCategoryIds.length) {
      const [itemsInRemovedCategories, dimensionsInRemovedCategories] = await Promise.all([
        Item.countDocuments({
          productType: _id,
          category: { $in: removedCategoryIds },
        }),
        Dimension.countDocuments({
          productType: _id,
          category: { $in: removedCategoryIds },
        }),
      ]);

      if (itemsInRemovedCategories || dimensionsInRemovedCategories) {
        return res.status(409).json({
          message: (
            'A category cannot be removed from this Product Type while Items or '
            + 'dimensions still use that combination.'
          ),
          itemCount: itemsInRemovedCategories,
          dimensionCount: dimensionsInRemovedCategories,
        });
      }
    }

    const updatedProductType = await ProductType.findByIdAndUpdate(
      _id,
      payload,
      { new: true, runValidators: true }
    ).populate('categories'); // Populate the response so the frontend gets the updated related data

    res.status(200).json(updatedProductType);
  } catch (error) {
    return handleError(res, error);
  }
};

// Delete a ProductType by ID
const deleteProductType = async (req, res) => {
  try {
    // Deletion doesn't explicitly need to worry about categoryID, but it's kept intact
    if (!req.params.id) {
      return res.status(400).json({ message: "Product Type ID is required" });
    }

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Product Type ID is invalid' });
    }

    const [itemCount, temperatureCount, densityCount, dimensionCount] = await Promise.all([
      Item.countDocuments({ productType: req.params.id }),
      Temperature.countDocuments({ productType: req.params.id }),
      Density.countDocuments({ productType: req.params.id }),
      Dimension.countDocuments({ productType: req.params.id }),
    ]);
    const linkedCount = itemCount + temperatureCount + densityCount + dimensionCount;

    if (linkedCount > 0) {
      return res.status(409).json({
        message: (
          `You can't delete this Product Type. It is linked to `
          + `${itemCount} Item(s), ${temperatureCount} temperature(s), `
          + `${densityCount} density value(s), and ${dimensionCount} dimension(s).`
        ),
        itemCount,
        temperatureCount,
        densityCount,
        dimensionCount,
      });
    }

    const deletedProductType = await ProductType.findByIdAndDelete(req.params.id);
    if (!deletedProductType) {
      return res.status(404).json({ message: 'ProductType not found' });
    }
    res.status(200).json({ message: 'ProductType deleted successfully' });
  } catch (error) {
    return handleError(res, error);
  }
};

export {
  createProductType,
  getProductTypes,
  getProductTypesOptions,
  getProductTypeById,
  updateProductType,
  deleteProductType,
};
