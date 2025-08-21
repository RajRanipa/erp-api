// /controller/campaignController.js
// controllers/campaignController.js
import Campaign from '../models/Campaign.js';

// --- helpers ---------------------------------------------------------------
function normalizeDate(d) {
  if (!d) return null;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  // strip time for date-only comparisons
  x.setHours(0, 0, 0, 0);
  return x;
}

function validatePayload({ name, startDate, endDate, status }) {
  const errors = {};
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!name || !String(name).trim()) errors.name = 'Name is required';

  const allowedStatuses = ['PLANNED', 'RUNNING', 'COMPLETED'];
  if (!status || !allowedStatuses.includes(status)) {
    errors.status = `Status must be one of: ${allowedStatuses.join(', ')}`;
  }

  if (!startDate) errors.startDate = 'Start Date is required';
  else if (!start) errors.startDate = 'Start Date is invalid';
  else if (start.getTime() < today.getTime()) errors.startDate = 'Start Date cannot be in the past';

  if (endDate) {
    if (!end) errors.endDate = 'End Date is invalid';
    else if (end.getTime() < today.getTime()) errors.endDate = 'End Date cannot be in the past';
    else if (start && end.getTime() < start.getTime()) errors.endDate = 'End Date cannot be before Start Date';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

function pickCampaign(dto = {}) {
  return {
    _id: dto._id,
    name: dto.name,
    startDate: dto.startDate,
    endDate: dto.endDate,
    status: dto.status,
    totalRawIssued: dto.totalRawIssued,
    totalFiberProduced: dto.totalFiberProduced,
    meltReturns: dto.meltReturns,
    remarks: dto.remarks,
    createdBy: dto.createdBy,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

// --- controllers -----------------------------------------------------------
export const createCampaign = async (req, res) => {
  try {
    const { name, startDate, endDate, status, remarks, totalRawIssued, totalFiberProduced, meltReturns } = req.body || {};

    const v = validatePayload({ name, startDate, endDate, status });
    if (!v.ok) return res.status(400).json({ success: false, errors: v.errors });

    const doc = new Campaign({
      name: String(name).trim(),
      startDate: normalizeDate(startDate),
      endDate: endDate ? normalizeDate(endDate) : undefined,
      status,
      remarks: remarks || '',
      totalRawIssued: Number(totalRawIssued) || 0,
      totalFiberProduced: Number(totalFiberProduced) || 0,
      meltReturns: Number(meltReturns) || 0,
      createdBy: req.user?.id || req.user?._id || undefined,
    });

    const saved = await doc.save();
    return res.status(201).json({ success: true, data: pickCampaign(saved) });
  } catch (err) {
    console.error('createCampaign error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create campaign', error: err.message });
  }
};

export const listCampaigns = async (req, res) => {
  console.log('listCampaigns called');
  try {
    const rows = await Campaign.find({}).sort({ startDate: -1, createdAt: -1 }).lean();
    console.log(rows);
    return res.status(200).json(rows);
  } catch (err) {
    console.error('listCampaigns error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch campaigns', error: err.message });
  }
};

export const getCampaignById = async (req, res) => {
  try {
    const { id } = req.params;
    const row = await Campaign.findById(id).lean();
    if (!row) return res.status(404).json({ success: false, message: 'Campaign not found' });
    return res.status(200).json({ success: true, data: pickCampaign(row) });
  } catch (err) {
    console.error('getCampaignById error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch campaign', error: err.message });
  }
};

export const updateCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, startDate, endDate, status, remarks, totalRawIssued, totalFiberProduced, meltReturns } = req.body || {};

    const v = validatePayload({ name, startDate, endDate, status });
    if (!v.ok) return res.status(400).json({ success: false, errors: v.errors });

    const patch = {
      name: String(name).trim(),
      startDate: normalizeDate(startDate),
      endDate: endDate ? normalizeDate(endDate) : undefined,
      status,
      remarks: remarks ?? '',
      totalRawIssued: Number(totalRawIssued) || 0,
      totalFiberProduced: Number(totalFiberProduced) || 0,
      meltReturns: Number(meltReturns) || 0,
    };

    const updated = await Campaign.findByIdAndUpdate(id, patch, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: 'Campaign not found' });
    return res.status(200).json({ success: true, data: pickCampaign(updated) });
  } catch (err) {
    console.error('updateCampaign error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update campaign', error: err.message });
  }
};

export const deleteCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Campaign.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Campaign not found' });
    return res.status(200).json({ success: true, message: 'Campaign deleted' });
  } catch (err) {
    console.error('deleteCampaign error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete campaign', error: err.message });
  }
};