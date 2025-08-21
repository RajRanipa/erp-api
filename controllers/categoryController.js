import Category from "../models/Category.js";

// Create a new Category
export const createCategory = async (req, res) => {
  try {
    const { category } = req.body;
    const name = category;
    if (!name) {
      return res.status(400).json({ message: "Category name is required" });
    }

    // Create new category
    const newCategory = new Category({ name });
    const savedCategory = await newCategory.save();

    res.status(201).json(savedCategory); // includes _id by default
  } catch (error) {
    console.error("Error creating category:", error);
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