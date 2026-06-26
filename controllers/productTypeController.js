import Item from "../models/Item.js";
import ProductType from "../models/ProductType.js";

// Create a new ProductType
const createProductType = async (req, res) => {
  try {
    console.log("req.body product Type ", req.body);
    
    // Extract both productType and the newly required catagoryID
    const { productType, catagoryID } = req.body;

    // Validation guard: explicitly check for catagoryID since it's required
    if (!catagoryID) {
      return res.status(400).json({ message: 'catagoryID is required' });
    }

    const productTypeDoc = new ProductType({ 
      name: productType,
      catagoryID: catagoryID // 👈 map the new key here
    }); 
    
    const savedProductType = await productTypeDoc.save();
    res.status(201).json(savedProductType);
  } catch (error) {
    console.log("error ", error);
    res.status(400).json({ message: error.message });
  }
};

// Get all ProductTypes as [{ label, value, catagoryID }]
const getProductTypes = async (req, res) => {
  try {
    // Optional: Allow the frontend to filter by category (e.g., ?category=60d5ec...)
    // This pairs perfectly with the `apiparams` logic in your frontend SelectTypeInput
    const filter = {};
    console.log("req.query.category ", req.query.category);

    // Return name and catagoryID for dropdowns
    const productTypes = await ProductType.find(filter).populate('catagoryID', 'name')
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
    const filter = {};
    console.log("req.query.category ", req.query.category);

    // Return name and catagoryID for dropdowns
    const productTypes = await ProductType.find(filter).populate('catagoryID', 'name')
      .sort({ name: 1 })
      .lean();

    // console.log("productTypes ", productTypes);
    // Map to the format your React component expects, including the new ID
    const options = productTypes.map(pt => ({ 
      label: pt.name, 
      value: String(pt._id),
      catagory: pt.catagoryID // pass it along in case the frontend needs it
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
    const productTypes = await ProductType.find({catagoryID :req.params.id});
    if (!productTypes) {
      return res.status(404).json({ message: 'ProductType not found' });
    }
    const options = productTypes.map(pt => ({ 
      label: pt.name, 
      value: String(pt._id),
      catagory: pt.catagoryID // pass it along in case the frontend needs it
    }));
    res.status(200).json(options);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update a ProductType by ID
const updateProductType = async (req, res) => {
  try {
    const updatedProductType = await ProductType.findByIdAndUpdate(
      req.params.id,
      req.body, // This automatically grabs catagoryID if it is passed in the update payload
      { new: true, runValidators: true }
    ).populate('catagoryID'); // Populate the response so the frontend gets the updated related data

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
    // Deletion doesn't explicitly need to worry about catagoryID, but it's kept intact
    if (!req.params.id) {
      return res.status(400).json({ message: "Category ID is required" });
    }

    const itemCount = await Item.countDocuments({ category: req.params.id });

    if (itemCount > 0) {
      return res.status(400).json({
        message: `You can't delete this category. It is linked to ${itemCount} item(s). Please delete the linked records first.`,
        itemCount,
        productTypeCount,
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