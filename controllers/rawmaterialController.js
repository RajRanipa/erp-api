// controllers/rawmaterialController.js

import RawMaterial from '../models/Rawmaterial.js';

// Create a new Raw Material
export const createRawMaterial = async (req, res) => {
  const body = req.body;
  try {
    console.log("body raw material ", body)
    // return;
    const rawMaterial = new RawMaterial(body);
    await rawMaterial.save();
    res.status(201).json({ message: 'Raw material created successfully', data: rawMaterial });
  } catch (error) {
    if (error?.code === 11000) {
          const val = Object.values(error.keyValue)[0];
          console.log("val ", val)
          if (val) {
            return res.status(409).json({
              success: false,
              message: `This ${val} raw material already exists, add a new one.`
            });
          }
          // fall through to generic error if not found for some reason
        } else {
          console.error('Failed to create dimension', err);
          return res.status(500).json({ message: 'Failed to create density' });
        }
    res.status(400).json({ message: 'Failed to create raw material', error: error.message });
  }
};

// Get all Raw Materials
export const getAllRawMaterials = async (req, res) => {
  try {
    const rawMaterials = await RawMaterial.find();
    res.status(200).json({ data: rawMaterials });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch raw materials', error: error.message });
  }
};

// Get a single Raw Material by ID
export const getRawMaterialById = async (req, res) => {
  try {
    const { id } = req.params;
    const rawMaterial = await RawMaterial.findById(id);
    if (!rawMaterial) {
      return res.status(404).json({ message: 'Raw material not found' });
    }
    res.status(200).json({ data: rawMaterial });
  } catch (error) {
    res.status(400).json({ message: 'Failed to fetch raw material', error: error.message });
  }
};

// Update a Raw Material by ID
export const updateRawMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedRawMaterial = await RawMaterial.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    if (!updatedRawMaterial) {
      return res.status(404).json({ message: 'Raw material not found' });
    }
    res.status(200).json({ message: 'Raw material updated successfully', data: updatedRawMaterial });
  } catch (error) {
    res.status(400).json({ message: 'Failed to update raw material', error: error.message });
  }
};

// Delete a Raw Material by ID
export const deleteRawMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedRawMaterial = await RawMaterial.findByIdAndDelete(id);
    if (!deletedRawMaterial) {
      return res.status(404).json({ message: 'Raw material not found' });
    }
    res.status(200).json({ message: 'Raw material deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: 'Failed to delete raw material', error: error.message });
  }
};