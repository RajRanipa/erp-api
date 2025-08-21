import ProductType from "../models/ProductType.js";

// Create a new ProductType
const createProductType = async (req, res) => {
  try {
    console.log("req.body product Type ", req.body) // req.body product Type  { prodyctType: 'blanket' }
    const { productType } = req.body;
    const productTypeDoc = new ProductType({ name: productType }); // 👈 map key
    const savedProductType = await productTypeDoc.save();
    res.status(201).json(savedProductType);
  } catch (error) {
    console.log("error ", error)
    res.status(400).json({ message: error.message });
  }
};

// Get all ProductTypes as [{ label, value }]
const getProductTypes = async (req, res) => {
  try {
    // Return as [{ label, value }] for dropdowns: label = name, value = _id
    const productTypes = await ProductType.find({}, 'name')
      .sort({ name: 1 })
      .lean();

    const options = productTypes.map(pt => ({ label: pt.name, value: String(pt._id) }));
    res.status(200).json(options);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get a ProductType by ID
const getProductTypeById = async (req, res) => {
  try {
    const productType = await ProductType.findById(req.params.id);
    if (!productType) {
      return res.status(404).json({ message: 'ProductType not found' });
    }
    res.status(200).json(productType);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update a ProductType by ID
const updateProductType = async (req, res) => {
  try {
    const updatedProductType = await ProductType.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
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
  getProductTypeById,
  updateProductType,
  deleteProductType,
};