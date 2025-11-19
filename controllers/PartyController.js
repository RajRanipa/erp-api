// controllers/PartyController.js
import mongoose from 'mongoose';
import Party from '../models/Party.js';

const { isValidObjectId } = mongoose;

/* ------------------------------ util helpers ------------------------------ */

const sendHttpError = (res, err, fallbackStatus = 400) => {
  const status = Number(err?.status) || fallbackStatus;
  const payload = {
    success: false,
    message: String(err?.message || 'Request failed'),
  };
  if (err?.errors && typeof err.errors === 'object') payload.errors = err.errors;
  return res.status(status).json(payload);
};

const toTrim = (v) => (typeof v === 'string' ? v.trim() : v);
const toUpper = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v);
const isNonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const PHONE_RE =
  /^[0-9+\-() ]{6,20}$/;

// GSTIN format: 15 chars, first 2 digits state code
// Ref: https://en.wikipedia.org/wiki/Goods_and_Services_Tax_(India)#GSTIN
const GSTIN_RE =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9][Z][A-Z0-9]$/;

const normalizePartyInput = (input = {}) => {
  const out = { ...input };

  out.legalName = toTrim(out.legalName);
  out.displayName = toTrim(out.displayName);
  out.role = toTrim(out.role);
  out.email = toTrim(out.email);
  out.phone = toTrim(out.phone);

  // normalize tax
  if (out.tax) {
    out.tax = { ...out.tax };
    if (out.tax.gstin) out.tax.gstin = toUpper(out.tax.gstin);
    if (out.tax.pan) out.tax.pan = toUpper(out.tax.pan);
    if (out.tax.placeOfSupply) out.tax.placeOfSupply = toTrim(out.tax.placeOfSupply);
  }

  // normalize addresses
  if (Array.isArray(out.addresses)) {
    out.addresses = out.addresses.map((a) => ({
      label: toTrim(a?.label),
      line1: toTrim(a?.line1),
      line2: toTrim(a?.line2),
      city: toTrim(a?.city),
      state: toTrim(a?.state),
      stateCode: toTrim(a?.stateCode),
      country: a?.country || 'IN',
      pincode: toTrim(a?.pincode),
      isDefaultBilling: Boolean(a?.isDefaultBilling),
      isDefaultShipping: Boolean(a?.isDefaultShipping),
    }));
  }

  // contacts
  if (Array.isArray(out.contacts)) {
    out.contacts = out.contacts.map((c) => ({
      name: toTrim(c?.name),
      email: toTrim(c?.email),
      phone: toTrim(c?.phone),
      role: toTrim(c?.role),
      isPrimary: Boolean(c?.isPrimary),
    }));
  }

  // credit
  if (out.credit) {
    out.credit = {
      currency: toTrim(out.credit.currency) || 'INR',
      paymentTerm: toTrim(out.credit.paymentTerm) || 'NET30',
      creditLimit: Number(out.credit.creditLimit) || 0,
      onHold: Boolean(out.credit.onHold),
    };
  }

  // bank
  if (out.bank) {
    out.bank = {
      holderName: toTrim(out.bank.holderName),
      ifsc: toTrim(out.bank.ifsc),
      accountNo: toTrim(out.bank.accountNo),
      branch: toTrim(out.bank.branch),
    };
  }

  // status
  if (out.status) out.status = toTrim(out.status);

  return out;
};

const validatePartyInput = (input = {}) => {
  const errors = {};

  if (!isNonEmpty(input.legalName)) errors.legalName = 'legalName is required';
  if (!['customer', 'vendor', 'both'].includes(input.role || '')) {
    errors.role = 'role must be one of customer | vendor | both';
  }

  if (input.email && !EMAIL_RE.test(input.email)) errors.email = 'invalid email';
  if (input.phone && !PHONE_RE.test(input.phone)) errors.phone = 'invalid phone';

  if (input.tax?.gstin && !GSTIN_RE.test(input.tax.gstin)) {
    errors.gstin = 'invalid GSTIN format';
  }
  if (input.tax?.placeOfSupply && input.tax?.gstin) {
    const stateCodeFromGstin = input.tax.gstin.substring(0, 2);
    if (isNonEmpty(input.tax.placeOfSupply) && input.tax.placeOfSupply !== stateCodeFromGstin) {
      errors.placeOfSupply = 'placeOfSupply must match GSTIN state code';
    }
  }

  // address min validation
  if (Array.isArray(input.addresses)) {
    input.addresses.forEach((a, idx) => {
      if (!isNonEmpty(a?.line1)) {
        (errors.addresses ??= {});
        errors.addresses[idx] = { line1: 'line1 is required' };
      }
      if (a?.pincode && String(a.pincode).length < 5) {
        (errors.addresses ??= {});
        errors.addresses[idx] = { ...(errors.addresses[idx] || {}), pincode: 'invalid pincode' };
      }
    });
  }

  // role-based field visibility
  if (input.role === 'customer' || input.role === 'both') {
    // ok to have credit
  } else if (input.credit) {
    // strip or flag — we choose to ignore silently in controller
  }

  if (input.role === 'vendor' || input.role === 'both') {
    // ok to have bank
  } else if (input.bank) {
    // ignore or flag
  }

  // status enum
  if (input.status && !['draft', 'active', 'archived'].includes(input.status)) {
    errors.status = 'invalid status';
  }

  return { ok: Object.keys(errors).length === 0, errors };
};

const ensureUniqueGSTIN = async (gstin, excludeId = null) => {
  if (!gstin) return;
  const q = { 'tax.gstin': gstin };
  if (excludeId && isValidObjectId(excludeId)) {
    q._id = { $ne: excludeId };
  }
  const exists = await Party.exists(q);
  if (exists) {
    const err = new Error('GSTIN already exists');
    err.status = 409;
    throw err;
  }
};

const buildListFilters = (query = {}) => {
  const {
    role,
    status,
    state,
    q,
  } = query;

  const filter = {};
  if (role && ['customer', 'vendor', 'both'].includes(role)) filter.role = role;
  if (status && ['draft', 'active', 'archived'].includes(status)) filter.status = status;
  if (state) filter['addresses.state'] = state;

  if (q && q.trim()) {
    const term = q.trim();
    // Prefer text index if present, else use regex OR
    filter.$or = [
      { legalName: { $regex: term, $options: 'i' } },
      { displayName: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
      { phone: { $regex: term, $options: 'i' } },
      { 'tax.gstin': { $regex: term, $options: 'i' } },
    ];
  }

  return filter;
};

const parsePaging = (query = {}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/* --------------------------------- create --------------------------------- */

export const createParty = async (req, res) => {
  try {
    const normalized = normalizePartyInput(req.body || {});
    console.log("req.body :- ", req.body)
    console.log("normalized :- ", normalized)
    // return;
    const { ok, errors } = validatePartyInput(normalized);
    if (!ok) return res.status(400).json({ success: false, message: 'Validation failed', errors });

    await ensureUniqueGSTIN(normalized?.tax?.gstin);

    // Strip fields not allowed by role (soft enforcement)
    if (normalized.role === 'customer') normalized.bank = undefined;
    if (normalized.role === 'vendor') normalized.credit = undefined;

    const doc = await Party.create({
      ...normalized,
      createdBy: req.user?.userId || req.user?._id,
      updatedBy: req.user?.userId || req.user?._id,
    });

    const lean = await Party.findById(doc._id).lean({ getters: true });
    return res.status(201).json({ success: true, message: 'Party created', data: lean });
  } catch (err) {
    return sendHttpError(res, err, 500);
  }
};

/* ---------------------------------- list ---------------------------------- */

export const listParties = async (req, res) => {
  try {
    const filter = buildListFilters(req.query || {});
    const { page, limit, skip } = parsePaging(req.query || {});
    const [data, total] = await Promise.all([
      Party.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean({ getters: true }),
      Party.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data,
      page,
      limit,
      total,
    });
  } catch (err) {
    return sendHttpError(res, err, 500);
  }
};

/* ---------------------------------- read ---------------------------------- */

export const getPartyById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const doc = await Party.findById(id).lean({ getters: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Party not found' });

    return res.json({ success: true, data: doc });
  } catch (err) {
    return sendHttpError(res, err, 500);
  }
};

/* --------------------------------- update --------------------------------- */

export const updateParty = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const normalized = normalizePartyInput(req.body || {});
    const { ok, errors } = validatePartyInput(normalized);
    if (!ok) return res.status(400).json({ success: false, message: 'Validation failed', errors });

    await ensureUniqueGSTIN(normalized?.tax?.gstin, id);

    if (normalized.role === 'customer') normalized.bank = undefined;
    if (normalized.role === 'vendor') normalized.credit = undefined;

    const updated = await Party.findByIdAndUpdate(
      id,
      { ...normalized, updatedBy: req.user?.userId || req.user?._id },
      { new: true, runValidators: true }
    ).lean({ getters: true });

    if (!updated) return res.status(404).json({ success: false, message: 'Party not found' });
    return res.json({ success: true, message: 'Party updated', data: updated });
  } catch (err) {
    // duplicate gstin would throw here as well (unique index)
    if (err?.code === 11000 && err?.keyPattern?.['tax.gstin']) {
      err.status = 409; err.message = 'GSTIN already exists';
    }
    return sendHttpError(res, err, 500);
  }
};

/* --------------------------------- status --------------------------------- */

export const patchPartyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    if (!['draft', 'active', 'archived'].includes(status || '')) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const updated = await Party.findByIdAndUpdate(
      id,
      { status, updatedBy: req.user?.userId || req.user?._id },
      { new: true }
    ).lean({ getters: true });

    if (!updated) return res.status(404).json({ success: false, message: 'Party not found' });
    return res.json({ success: true, message: 'Status updated', data: updated });
  } catch (err) {
    return sendHttpError(res, err, 500);
  }
};

/* --------------------------------- delete --------------------------------- */
// Soft delete recommendation: archive instead of delete.
// If you still need hard delete for test data, expose it guarded by role.
export const deleteParty = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const deleted = await Party.findByIdAndDelete(id).lean({ getters: true });
    if (!deleted) return res.status(404).json({ success: false, message: 'Party not found' });

    return res.json({ success: true, message: 'Party deleted' });
  } catch (err) {
    return sendHttpError(res, err, 500);
  }
};
