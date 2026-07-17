import Category from "../models/Category.js";
import { handleError } from '../utils/errorHandler.js';
import { applyAuditCreate, applyAuditUpdate } from '../utils/auditHelper.js';
import Item from "../models/Item.js";
import ProductType from "../models/ProductType.js";

// Create a new Category
export const createCategory = async (req, res) => {
  try {
    const { category } = req.body;
    if (!category) {
      return res.status(400).json({ message: "Category name is required" });
    }
    let payload = { name: category }
    payload = applyAuditCreate(req, payload);
    // Create new category
    const newCategory = new Category(payload);
    const savedCategory = await newCategory.save();

    res.status(201).json(savedCategory); // includes _id by default
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({ message: error.message });
  }
};
export const updateCategories = async (req, res) => {
  try {
    // console.log("updateCategories req.body", req.body);

    const { categoryId, category } = req.body;
    const name = category?.trim();

    if (!categoryId) {
      return res.status(400).json({ message: "Category ID is required" });
    }

    if (!name) {
      return res.status(400).json({ message: "Category name is required" });
    }

    const updatedCategory = await Category.findByIdAndUpdate(
      categoryId,
      { name },
      { new: true, runValidators: true }
    );

    if (!updatedCategory) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.status(200).json(updatedCategory);
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({ message: error.message });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    // Basic checking before deleting and give a message if catagory is linked to any items or not 

    if (!categoryId) {
      return res.status(400).json({ message: "Category ID is required" });
    }
    const itemCount = await Item.countDocuments({ category: categoryId });
    const productTypeCount = await ProductType.countDocuments({ category: categoryId });

    if (itemCount > 0 || productTypeCount > 0) {
      return res.status(400).json({
        message: `You can't delete this category. It is linked to ${itemCount} item(s) and ${productTypeCount} product type(s). Please delete the linked records first.`,
        itemCount,
        productTypeCount,
      });
    }

    const deletedCategory = await Category.findByIdAndDelete(categoryId);

    if (!deletedCategory) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.status(200).json({
      message: "Category deleted successfully",
      categoryId,
    });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({ message: error.message });
  }
};

// Get all Categories
export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find({}).sort({ name: 1 }).lean();

    // Map categories to { value: _id, label: name }
    const formattedCategories = categories.map(({ _id, name }) => ({
      value: _id,
      label: name,
    }));

    res.status(200).json(formattedCategories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: error.message });
  }
};