import Packing from "../models/Packing.js";
import ProductType from "../models/ProductType.js";

// Create new packing material
export const createPacking = async (req, res) => {
  try {
    // If productType is a string, look up the ProductType by name
    if (false && typeof req.body.productType === "string") {
      const productType = await ProductType.findOne({ name: req.body.productType });
      console.log("productType ", productType)
      if (!productType) {
        return res.status(400).json({ message: "Invalid productType" });
      }
      req.body.productType = productType._id;
    }
    console.log("req.body ", req.body)
    const packing = new Packing(req.body);
    await packing.save();

    res.status(201).json({ message: "Packing material created successfully", packing });
  } catch (error) {
    console.error("packing error ", error)
    res.status(400).json({ message: "Error creating packing material", error });
  }
};

// Get all packing materials
export const getAllPacking = async (req, res) => {
  try {

    const packings = await Packing.find();
    // Map packings to desired format
    console.log("packings ", packings)
    const mapped = packings.map(packing => (
      {
        value: packing._id,
        label: `${packing?.brandType || ''} ${packing.productName}`.trim()
      }
    ));
    res.status(200).json(mapped);
  } catch (error) {
    res.status(500).json({ message: "Error fetching packing materials", error });
  }
};

// Get single packing material by ID
export const getPackingById = async (req, res) => {
  try {
    const { productType } = req.query || {};

    // Require productType like temperature/density by-id endpoints
    if (!productType) {
      return res.status(400).json({ message: 'productType is a required query param' });
    }

    const isValidObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
    if (!isValidObjectId(productType)) {
      return res.status(400).json({ message: 'Invalid productType id format' });
    }

    const packings = await Packing.find({ productType })
      .sort({ productName: 1 })
      .lean();

    const mapped = packings.map((p) => ({
      value: p._id,
      label: `${p?.brandType || ''} ${p.productName}`.trim(),
    }));

    return res.status(200).json(mapped);
  } catch (error) {
    console.error('getPackingById error', error);
    return res.status(500).json({ message: 'Error fetching packing materials', error });
  }
};

// Update packing material by ID
export const updatePacking = async (req, res) => {
  try {
    const packing = await Packing.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!packing) {
      return res.status(404).json({ message: "Packing material not found" });
    }
    res.status(200).json(packing);
  } catch (error) {
    res.status(400).json({ message: "Error updating packing material", error });
  }
};

// Delete packing material by ID
export const deletePacking = async (req, res) => {
  try {
    const packing = await Packing.findByIdAndDelete(req.params.id);
    if (!packing) {
      return res.status(404).json({ message: "Packing material not found" });
    }
    res.status(200).json({ message: "Packing material deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting packing material", error });
  }
};