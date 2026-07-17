import Item from "../models/Item.js";
import ProductType from "../models/ProductType.js";

// Create a new ProductType
const createProductType = async (req, res) => {
  try {

    // Extract both productType and the newly required categoryID
    const { categories, name } = req.body;

    // Validation guard: explicitly check for categoryID since it's required
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ message: "categories is required" });
    }

    const productTypeDoc = new ProductType({
      name,
      categories
    });

    const savedProductType = await productTypeDoc.save();
    res.status(201).json(savedProductType);
  } catch (error) {
    console.log("error ", error);
    res.status(400).json({ message: error.message });
  }
};

// Get all ProductTypes as [{ label, value, categoryID }]
const getProductTypes = async (req, res) => {
  try {
    // Optional: Allow the frontend to filter by category (e.g., ?category=60d5ec...)
    // This pairs perfectly with the `apiparams` logic in your frontend SelectTypeInput
    const filter = {};
    // Return name and categoryID for dropdowns
    const productTypes = await ProductType.find(filter).populate("categories", "name")
      .sort({ name: 1 })
      .lean();

    res.status(200).json(productTypes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
const getProductTypesOptions = async (req, res) => {
  try {
    // Optional: Allow the frontend to filter by category (e.g., ?category=60d5ec...)
    // This pairs perfectly with the `apiparams` logic in your frontend SelectTypeInput
    const filter = {}; // this is future usefull 
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
    res.status(500).json({ message: error.message });
  }
};

// Get a ProductType by ID
const getProductTypeById = async (req, res) => {
  try {
    // Use .populate() to attach the full Category document to the response
    // console.log("req.params.id ", req.params.id);
    const productTypes = await ProductType.find({
      categories: req.params.id
    }).populate("categories", "name");

    if (productTypes.length === 0) {
      return res.status(404).json({ message: 'ProductType not found' });
    }
    const options = productTypes.map(pt => ({
      label: pt.name,
      value: String(pt._id),
      categories: pt.categories // pass it along in case the frontend needs it
    }));
    res.status(200).json(options);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update a ProductType by ID
const updateProductType = async (req, res) => {
  try {
    // console.log("req.params.id ", req.body);
    const { _id, categories, name } = req.body;
    // console.log("_id, categories, name", _id, categories, name);
    const updatedProductType = await ProductType.findByIdAndUpdate(
      _id,
      req.body, // This automatically grabs categories if it is passed in the update payload
      { new: true, runValidators: true }
    ).populate('categories'); // Populate the response so the frontend gets the updated related data

    if (!updatedProductType) {
      return res.status(404).json({ message: 'ProductType not found' });
    }
    res.status(200).json(updatedProductType);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete a ProductType by ID
const deleteProductType = async (req, res) => {
  try {
    // Deletion doesn't explicitly need to worry about categoryID, but it's kept intact
    if (!req.params.id) {
      return res.status(400).json({ message: "Product Type ID is required" });
    }

    const itemCount = await Item.countDocuments({productType: req.params.id});

    if (itemCount > 0) {
      return res.status(400).json({
        message: `You can't delete this Product Type. It is linked to ${itemCount} item(s). Please delete the linked records first.`,
        itemCount,
      });
    }

    const deletedProductType = await ProductType.findByIdAndDelete(req.params.id);
    if (!deletedProductType) {
      return res.status(404).json({ message: 'ProductType not found' });
    }
    res.status(200).json({ message: 'ProductType deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
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