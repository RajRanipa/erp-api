import packingMaterial from '../models/Packing.js';
import Temperature from '../models/Temperature.js';
import Density from '../models/Density.js';
import Dimension from '../models/Dimension.js';

const mapDensity = (d) => ({ label: `${d.value}${d.unit ? ' ' + d.unit : ''}`.trim(), value: String(d._id) });
const mapTemperature = (t) => ({ label: `${t.value}${t.unit ? ' ' + t.unit : ''}`.trim(), value: String(t._id) });
const mapDimension = (dm) => {
  const unit = dm.unit ? ` ${dm.unit}` : '';
  const l = dm.length ?? '';
  const w = dm.width ?? '';
  const th = dm.thickness ?? '';
  return { label: `${l} × ${w} × ${th}${unit}`.trim(), value: String(dm._id) };
};
const mapPacking = (p) => ({ label: p.productName, value: String(p._id) });

export const getDensityOptions = async (req, res) => {
  try {
    const rows = await Density.find({}).sort({ value: 1 }).lean();
    res.status(200).json(rows.map(mapDensity));
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch densities' });
  }
};

export const getTemperatureOptions = async (req, res) => {
  try {
    const rows = await Temperature.find({}).sort({ value: 1 }).lean();
    console.log(rows);
    console.log(rows.map(mapTemperature));
    res.status(200).json(rows.map(mapTemperature));
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch temperatures' });
  }
};

export const getDimensionOptions = async (req, res) => {
  try {
    const rows = await Dimension.find({}).sort({ length: 1, width: 1, thickness: 1 }).lean();
    res.status(200).json(rows.map(mapDimension));
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch dimensions' });
  }
};

//  getDensityOptionsById,
//   getTemperatureOptionsById,
export const getDimensionOptionsById = async (req, res) => {
  // Expect query: /.../dimensions/by-id?productType=<id>&category=<id>
  try {
    const { productType, category } = req.query || {};
    console.log("productType, category");
    console.log(productType, category);
    // Basic validation
    if (!productType || !category) {
      return res.status(400).json({ message: 'productType and category are required query params' });
    }

    const isValidObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);

    if (!isValidObjectId(productType) || !isValidObjectId(category)) {
      return res.status(400).json({ message: 'Invalid productType or category id format' });
    }

    const rows = await Dimension.find({
      productType,
      category,
    })
      .sort({ length: 1, width: 1, thickness: 1 })
      .lean();
    console.log("rows.map(mapDimension)");
    console.log(rows);
    return res.status(200).json(rows.map(mapDimension));
  } catch (err) {
    console.error('getDimensionOptionsById error', err);
    return res.status(500).json({ message: 'Failed to fetch dimensions' });
  }
};

export const getDensityOptionsById = async (req, res) => {
  // Expect query: /.../densities/by-id?productType=<id>
  try {
    const { productType } = req.query || {};

    if (!productType) {
      return res.status(400).json({ message: 'productType is a required query param' });
    }

    const isValidObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
    if (!isValidObjectId(productType)) {
      return res.status(400).json({ message: 'Invalid productType id format' });
    }

    const rows = await Density.find({ productType })
      .sort({ value: 1 })
      .lean();

    return res.status(200).json(rows.map(mapDensity));
  } catch (err) {
    console.error('getDensityOptionsById error', err);
    return res.status(500).json({ message: 'Failed to fetch densities' });
  }
};

export const getTemperatureOptionsById = async (req, res) => {
  // Expect query: /.../temperatures/by-id?productType=<id>
  try {
    const { productType } = req.query || {};

    if (!productType) {
      return res.status(400).json({ message: 'productType is a required query param' });
    }

    const isValidObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
    if (!isValidObjectId(productType)) {
      return res.status(400).json({ message: 'Invalid productType id format' });
    }

    const rows = await Temperature.find({ productType })
      .sort({ value: 1 })
      .lean();

    return res.status(200).json(rows.map(mapTemperature));
  } catch (err) {
    console.error('getTemperatureOptionsById error', err);
    return res.status(500).json({ message: 'Failed to fetch temperatures' });
  }
};

export const getAllParameterOptions = async (req, res) => {
  try {
    const [dens, temps, dims, packs] = await Promise.all([
      Density.find({}).sort({ value: 1 }).lean(),
      Temperature.find({}).sort({ value: 1 }).lean(),
      Dimension.find({}).sort({ length: 1, width: 1, thickness: 1 }).lean(),
      packingMaterial.find({}).sort({ productName: 1 }).lean(),
    ]);

    res.status(200).json({
      density: dens.map(mapDensity),
      temperature: temps.map(mapTemperature),
      dimension: dims.map(mapDimension),
      packing: packs.map(mapPacking),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch parameters' });
  }
};
// ---------- CREATE / SAVE CONTROLLERS ----------

export const createDensity = async (req, res) => {
  const body = req.body || {};
  try {
    console.log("density body ", body)

    let doc = await Density.create(body);
    doc = doc.toObject();

    return res.status(201).json({
      success: true,
      data: doc,
      option: mapDensity(doc),
    });
  } catch (err) {
    if (err?.code === 11000) {
      const existing = await Density.findOne(body).lean();
      if (existing) {
        return res.status(409).json({
          success: false,
          data: existing,
          option: mapDensity(existing),
          message: 'This density already exists, add a new one.'
        });
      }
      // fall through to generic error if not found for some reason
    } else {
      console.error('Failed to create dimension', err);
      return res.status(500).json({ message: 'Failed to create density' });
    }
  }
};

export const createTemperature = async (req, res) => {
  const body = req.body || {};
  console.log("temperature body ", body)
  try {
    let doc = await Temperature.create(body);
    doc = doc.toObject();
    console.log("temperature body 2", body)

    return res.status(201).json({
      success: true,
      data: doc,
      option: mapTemperature(doc),
    });
  } catch (err) {
    console.log("error ", err)
    if (err?.code === 11000) {
      const existing = await Temperature.findOne(body).lean();
      if (existing) {
        return res.status(409).json({
          success: false,
          data: existing,
          option: mapTemperature(existing),
          message: 'This temperature already exists, add a new one.'
        });
      }
      // fall through to generic error if not found for some reason
    } else {
      console.error('Failed to create dimension', err);
      return res.status(500).json({ message: 'Failed to create temperature' });
    }
  }
};

export const createDimension = async (req, res) => {
  try {
    const body = req.body || {};

    // Normalize inputs
    const rawLength = body.length;
    const rawWidth = body.width;
    const rawThickness = body.thickness;
    const unit = (body.unit || '').toString().trim();

    const hasLength = rawLength !== undefined && rawLength !== null && String(rawLength).trim() !== '';
    const hasWidth = rawWidth !== undefined && rawWidth !== null && String(rawWidth).trim() !== '';
    const hasThickness = rawThickness !== undefined && rawThickness !== null && String(rawThickness).trim() !== '';

    // At least one dimension must be provided
    if (!hasLength && !hasWidth && !hasThickness) {
      return res.status(400).json({ message: 'At least one of length, width or thickness must be provided' });
    }

    // Unit is required
    if (!unit) {
      return res.status(400).json({ message: 'Unit is required for dimension' });
    }

    // Convert provided values to numbers and default missing ones to 0
    const length = hasLength ? Number(rawLength) : 0;
    const width = hasWidth ? Number(rawWidth) : 0;
    const thickness = hasThickness ? Number(rawThickness) : 0;

    // Build payload for creation
    const payload = {
      length,
      width,
      thickness,
      unit,
      // preserve optional fields if provided (productType, category)
      ...(body.productType ? { productType: body.productType } : {}),
      ...(body.category ? { category: body.category } : {}),
    };

    try {
      const docCreated = await Dimension.create(payload);
      const doc = docCreated.toObject();
      return res.status(201).json({ success: true, data: doc, message: 'Dimension created successfully' });
    } catch (err) {
      // If duplicate, fetch and return existing
      if (err?.code === 11000) {
        const existing = await Dimension.findOne({ length, width, thickness, unit }).lean();
        if (existing) {
          return res.status(409).json({
            success: false,
            data: existing,
            option: mapDimension(existing),
            message: 'This dimension already exists, add a new one.'
          });
        }
      }
      console.error('Failed to create dimension', err);
      return res.status(500).json({ message: 'Failed to create dimension' });
    }
  } catch (err) {
    console.error('createDimension error', err);
    return res.status(500).json({ message: 'Failed to create dimension' });
  }
};

export const createDi_old_mension = async (req, res) => {
  try {
    const body = req.body || {};
    console.log("Dimension body ", body)
    // create validation here there should be any one value needed from length , width and thickness , what ever value is not present make it 0 and unit required 
    
    // Just attempt to create; let Mongo unique index enforce duplicates
    try {
      const docCreated = await Dimension.create(body);
      const doc = docCreated.toObject();
      return res.status(201).json({ success: true, data: doc, message: 'Dimension created successfully', });
    } catch (err) {
      // If duplicate, fetch and return existing
      console.log('Error why dimension', err);
      if (err?.code === 11000) {
        const existing = await Dimension.findOne({
          length: body.length,
          width: body.width,
          thickness: body.thickness,
        }).lean();
        if (existing) {
          return res.status(409).json({
            success: false,
            data: existing,
            option: mapDimension(existing),
            message: 'This dimension already exists, add a new one.'
          });
        }
        // fall through to generic error if not found for some reason
      } else {
        console.error('Failed to create dimension', err);
        throw err;
      }
    }

    // Should not reach here
    return res.status(500).json({ message: 'Unexpected error creating dimension' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create dimension' });
  }
};