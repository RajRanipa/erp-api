// backend-api/controllers/partyController.js
//
// ✅ CRUD + Options + Status + Soft Delete
// ✅ Bulk Export to Excel (.xlsx)
// ✅ Bulk Import from Excel (.xlsx/.xls)
//
// Packages:
//   npm i xlsx
//
// For import upload, use multer in routes (field name: "file"):
//   npm i multer
//
// Assumptions (same as your codebase style):
//  - req.user.companyId exists (multi-tenant)
//  - handleError(res, err, msg?) exists
//  - applyAuditCreate(req, payload) + applyAuditUpdate(req, payload) exist

import XLSX from 'xlsx';
import Party, { PARTY_ROLES, PARTY_STATUS, PARTY_TYPE, ADDRESS_PURPOSES } from '../models/Party.js';
import { handleError } from '../utils/errorHandler.js';
import { applyAuditCreate, applyAuditUpdate } from '../utils/auditHelper.js';

const asStr = (v) => (v == null ? '' : String(v)).trim();
const asUpper = (v) => asStr(v).toUpperCase();
const asLower = (v) => asStr(v).toLowerCase();

// Basic format validators (optional fields: validate only when provided)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const PHONE_RE = /^[0-9+\-() ]{6,20}$/;

// India GSTIN format (15 chars). We apply this only when taxId looks like a GSTIN.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

function validateEmailPhone({ email, phone }) {
  if (email && !EMAIL_RE.test(String(email).trim())) {
    const err = new Error('Invalid email format');
    err.status = 400;
    throw err;
  }
  if (phone && !PHONE_RE.test(String(phone).trim())) {
    const err = new Error('Invalid phone format');
    err.status = 400;
    throw err;
  }
}

function validateTaxIdMaybeGSTIN(taxId) {
  if (!taxId) return;
  const t = String(taxId).trim().toUpperCase();

  // Only enforce GSTIN regex when it looks like a GSTIN (15 chars).
  // This keeps the module universal (VAT/other tax IDs won't be rejected).
  if (t.length === 15 && !GSTIN_RE.test(t)) {
    const err = new Error('Invalid GSTIN format');
    err.status = 400;
    throw err;
  }
}

// ---- Address normalization helpers ----
function normalizePurposes(purposes) {
  return Array.from(
    new Set(
      (Array.isArray(purposes) ? purposes : [])
        .map((p) => asLower(p))
        .map((p) => p.trim())
        .filter(Boolean)
    )
  );
}

function normalizeAddress(addr = {}) {
  const a = addr && typeof addr === 'object' ? addr : {};

  // Accept both postalCode and pincode from clients; we store pincode.
  const pin = asStr(a.pincode || a.postalCode);

  return {
    label: asStr(a.label) || 'Office',
    purposes: normalizePurposes(a.purposes),
    line1: asStr(a.line1),
    line2: asStr(a.line2),
    city: asStr(a.city),
    state: asStr(a.state),
    country: asStr(a.country) || 'India',
    pincode: pin,

    // pass-through optional fields if you later add them in UI
    landmark: asStr(a.landmark),
    area: asStr(a.area),
    district: asStr(a.district),
    placeId: asStr(a.placeId),
    isActive: a.isActive == null ? true : Boolean(a.isActive),
    notes: asStr(a.notes),
  };
}

function normalizeAddresses(input) {
  // New format: { primaryAddress, additionalAddresses }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const primary = normalizeAddress(input.primaryAddress || {});
    const additional = Array.isArray(input.additionalAddresses)
      ? input.additionalAddresses.map(normalizeAddress)
      : [];
    return { primaryAddress: primary, additionalAddresses: additional };
  }

  // Old format: [addr, addr, ...] => first becomes primary; rest additional.
  if (Array.isArray(input)) {
    const first = input[0] || {};
    const rest = input.slice(1) || [];
    return {
      primaryAddress: normalizeAddress(first),
      additionalAddresses: rest.map((a) => {
        const na = normalizeAddress(a);
        // translate old flags if present
        if (a?.isDefaultBilling) na.purposes = Array.from(new Set([...(na.purposes || []), ADDRESS_PURPOSES.BILLING]));
        if (a?.isDefaultShipping) na.purposes = Array.from(new Set([...(na.purposes || []), ADDRESS_PURPOSES.SHIPPING]));
        return na;
      }),
    };
  }

  // No addresses provided
  return { primaryAddress: normalizeAddress({ label: 'Office' }), additionalAddresses: [] };
}

function enforceUniquePurpose(additionalAddresses = []) {
  // At most one billing + one shipping in additional addresses.
  let seenBilling = false;
  let seenShipping = false;

  return (additionalAddresses || []).map((a) => {
    const addr = { ...(a || {}) };
    const p = normalizePurposes(addr.purposes);

    let out = p;
    if (out.includes(ADDRESS_PURPOSES.BILLING)) {
      if (seenBilling) out = out.filter((x) => x !== ADDRESS_PURPOSES.BILLING);
      else seenBilling = true;
    }
    if (out.includes(ADDRESS_PURPOSES.SHIPPING)) {
      if (seenShipping) out = out.filter((x) => x !== ADDRESS_PURPOSES.SHIPPING);
      else seenShipping = true;
    }

    addr.purposes = out;
    return addr;
  });
}

function ensureCompany(req) {
  const companyId = req.user?.companyId;
  if (!companyId) throw new Error('Missing companyId on user');
  return companyId;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseRoles(v) {
  if (Array.isArray(v)) return v.map(asUpper).filter(Boolean);
  const s = asStr(v);
  if (!s) return [];
  // allow: "SUPPLIER,CUSTOMER" or "SUPPLIER | CUSTOMER"
  return s
    .split(/[,|]/g)
    .map(asUpper)
    .map((x) => x.replace(/\s+/g, ''))
    .filter(Boolean);
}

function validateRoles(roles = []) {
  const allowed = new Set(Object.values(PARTY_ROLES));
  for (const r of roles) {
    if (!allowed.has(r)) {
      throw new Error(`Invalid role "${r}". Allowed: ${Array.from(allowed).join(', ')}`);
    }
  }
}

function normalizePartyPayload(body = {}) {
  const roles = parseRoles(body.roles);
  validateRoles(roles);

  const partyType = body.partyType ? asUpper(body.partyType) : PARTY_TYPE.BUSINESS;
  if (!Object.values(PARTY_TYPE).includes(partyType)) {
    throw new Error(`Invalid partyType "${partyType}"`);
  }

  const status = body.status ? asLower(body.status) : PARTY_STATUS.ACTIVE;
  if (!Object.values(PARTY_STATUS).includes(status)) {
    throw new Error(`Invalid status "${status}"`);
  }

  const taxId = body?.taxProfile?.taxId != null ? asUpper(body.taxProfile.taxId) : null;
  const pan = body?.taxProfile?.pan != null ? asUpper(body.taxProfile.pan) : null;

  const payload = {
    name: asStr(body.name),
    legalName: asStr(body.legalName),
    partyType,
    roles,
    status,

    phone: asStr(body.phone),
    email: asLower(body.email),
    website: asStr(body.website),

    tags: Array.isArray(body.tags) ? body.tags.map(asStr).filter(Boolean) : [],

    addresses: (() => {
      const out = normalizeAddresses(body.addresses);
      out.additionalAddresses = enforceUniquePurpose(out.additionalAddresses);
      return out;
    })(),
    contacts: Array.isArray(body.contacts) ? body.contacts : [],

    taxProfile: {
      ...(body.taxProfile || {}),
      isTaxRegistered: Boolean(body?.taxProfile?.isTaxRegistered),
      taxId: taxId || null,
      pan: pan || null,
      placeOfSupply: asStr(body?.taxProfile?.placeOfSupply),
    },

    paymentTerms: {
      ...(body.paymentTerms || {}),
    },

    currency: asStr(body.currency) || 'INR',
    creditLimit: body.creditLimit == null ? 0 : Number(body.creditLimit),
    openingBalance: body.openingBalance == null ? 0 : Number(body.openingBalance),

    notes: asStr(body.notes),

    // Extensions
    meta: body.meta && typeof body.meta === 'object' ? body.meta : undefined,
    customFields: body.customFields && typeof body.customFields === 'object' ? body.customFields : undefined,
  };

  validateEmailPhone({ email: payload.email, phone: payload.phone });
  validateTaxIdMaybeGSTIN(payload?.taxProfile?.taxId);

  if (!payload.name) throw new Error('name is required');
  if (Number.isNaN(payload.creditLimit) || payload.creditLimit < 0) throw new Error('creditLimit must be a non-negative number');
  if (Number.isNaN(payload.openingBalance)) throw new Error('openingBalance must be a number');

  return payload;
}

/**
 * POST /parties
 */
export async function createParty(req, res) {
  try {
    const companyId = ensureCompany(req);
    let payload = normalizePartyPayload(req.body || {});
    payload.companyId = companyId;

    payload = applyAuditCreate(req, payload);

    const doc = await Party.create(payload);
    return res.status(201).json({ status: true, message: 'Party created', data: doc });
  } catch (err) {
    return handleError(res, err, 'Failed to create party');
  }
}

/**
 * GET /parties/:id
 */
export async function getPartyById(req, res) {
  try {
    const companyId = ensureCompany(req);
    const { id } = req.params;

    const doc = await Party.findOne({ _id: id, companyId }).lean();
    if (!doc) return res.status(404).json({ status: false, message: 'Party not found' });

    return res.json({ status: true, data: doc });
  } catch (err) {
    return handleError(res, err, 'Failed to fetch party');
  }
}

/**
 * GET /parties
 * Query:
 *  - role=SUPPLIER|CUSTOMER|...
 *  - status=active|inactive|all
 *  - q=search (name/phone/email/taxId/pan)
 *  - page, limit
 */
export async function listParties(req, res) {
  try {
    const companyId = ensureCompany(req);
    const { role, status = 'active', q = '', limit = 50, page = 1 } = req.query || {};

    const filter = { companyId };

    if (role) {
      const r = asUpper(role);
      validateRoles([r]);
      filter.roles = r;
    }

    if (String(status).toLowerCase() !== 'all') {
      const st = asLower(status);
      if (!Object.values(PARTY_STATUS).includes(st)) throw new Error('Invalid status filter');
      filter.status = st;
    }

    const search = asStr(q);
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { name: re },
        { legalName: re },
        { phone: re },
        { email: re },
        { 'taxProfile.taxId': re },
        { 'taxProfile.pan': re },
      ];
    }

    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const pg = Math.max(1, Number(page) || 1);
    const skip = (pg - 1) * lim;

    const [rows, total] = await Promise.all([
      Party.find(filter).sort({ name: 1 }).skip(skip).limit(lim).lean(),
      Party.countDocuments(filter),
    ]);

    return res.json({
      status: true,
      data: rows,
      meta: { page: pg, limit: lim, total, pages: Math.ceil(total / lim) },
    });
  } catch (err) {
    return handleError(res, err, 'Failed to list parties');
  }
}

/**
 * GET /parties/options
 * Lightweight endpoint for dropdowns
 * Query:
 *  - role=SUPPLIER (common)
 *  - q=search
 *  - limit
 */
export async function getPartyOptions(req, res) {
  try {
    const companyId = ensureCompany(req);
    const { role, q = '', limit = 30 } = req.query || {};

    const filter = { companyId, status: PARTY_STATUS.ACTIVE };

    if (role) {
      const r = asUpper(role);
      validateRoles([r]);
      filter.roles = r;
    }

    const search = asStr(q);
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { name: re },
        { phone: re },
        { email: re },
        { 'taxProfile.taxId': re },
      ];
    }

    const lim = Math.min(100, Math.max(1, Number(limit) || 30));

    const rows = await Party.find(filter, 'name phone email roles status taxProfile.taxId')
      .sort({ name: 1 })
      .limit(lim)
      .lean();

    const mapped = rows.map((p) => ({
      value: String(p._id),
      label: p.name,
      meta: {
        phone: p.phone || '',
        email: p.email || '',
        taxId: p?.taxProfile?.taxId || '',
        roles: p.roles || [],
      },
    }));

    return res.json({ status: true, data: mapped });
  } catch (err) {
    return handleError(res, err, 'Failed to fetch party options');
  }
}

/**
 * PATCH /parties/:id
 */
export async function updateParty(req, res) {
  try {
    const companyId = ensureCompany(req);
    const { id } = req.params;

    const existing = await Party.findOne({ _id: id, companyId });
    if (!existing) return res.status(404).json({ status: false, message: 'Party not found' });

    // Merge existing + incoming, then normalize (prevents wiping fields unintentionally)
    const incoming = req.body || {};
    const merged = {
      ...existing.toObject(),
      ...incoming,
      // Preserve nested objects when incoming omits them
      taxProfile: { ...(existing.toObject().taxProfile || {}), ...(incoming.taxProfile || {}) },
      paymentTerms: { ...(existing.toObject().paymentTerms || {}), ...(incoming.paymentTerms || {}) },
      // addresses are normalized later, but ensure we pass incoming.addresses if provided, else keep existing
      addresses: incoming.addresses != null ? incoming.addresses : existing.toObject().addresses,
    };
    const normalized = normalizePartyPayload(merged);
    const updateWithAudit = applyAuditUpdate(req, normalized);

    Object.assign(existing, updateWithAudit);
    await existing.save();

    return res.json({ status: true, message: 'Party updated', data: existing });
  } catch (err) {
    return handleError(res, err, 'Failed to update party');
  }
}

/**
 * PATCH /parties/:id/status
 * Body: { to: 'active'|'inactive' }
 */
export async function updatePartyStatus(req, res) {
  try {
    const companyId = ensureCompany(req);
    const { id } = req.params;
    const { to } = req.body || {};

    const st = asLower(to);
    if (!Object.values(PARTY_STATUS).includes(st)) throw new Error('Invalid target status');

    const doc = await Party.findOne({ _id: id, companyId });
    if (!doc) return res.status(404).json({ status: false, message: 'Party not found' });

    doc.status = st;
    Object.assign(doc, applyAuditUpdate(req, {}));
    await doc.save();

    return res.json({ status: true, message: 'Status updated', data: doc });
  } catch (err) {
    return handleError(res, err, 'Failed to update status');
  }
}

/**
 * DELETE /parties/:id
 * Soft delete => set status inactive
 */
export async function deleteParty(req, res) {
  try {
    const companyId = ensureCompany(req);
    const { id } = req.params;

    const doc = await Party.findOne({ _id: id, companyId });
    if (!doc) return res.status(404).json({ status: false, message: 'Party not found' });

    doc.status = PARTY_STATUS.INACTIVE;
    Object.assign(doc, applyAuditUpdate(req, {}));
    await doc.save();

    return res.json({ status: true, message: 'Party deactivated', data: doc });
  } catch (err) {
    return handleError(res, err, 'Failed to delete party');
  }
}

/**
 * GET /parties/export
 * Query:
 *  - role=SUPPLIER|CUSTOMER
 *  - status=active|inactive|all
 *  - q=search
 * Returns .xlsx buffer
 */
export async function exportPartiesXlsx(req, res) {
  try {
    const companyId = ensureCompany(req);
    const { role, status = 'all', q = '' } = req.query || {};

    const filter = { companyId };

    if (role) {
      const r = asUpper(role);
      validateRoles([r]);
      filter.roles = r;
    }

    if (String(status).toLowerCase() !== 'all') {
      const st = asLower(status);
      if (!Object.values(PARTY_STATUS).includes(st)) throw new Error('Invalid status filter');
      filter.status = st;
    }

    const search = asStr(q);
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: re }, { phone: re }, { email: re }, { 'taxProfile.taxId': re }];
    }

    const rows = await Party.find(filter).sort({ name: 1 }).lean();

    const data = rows.map((p) => ({
      Name: p.name || '',
      LegalName: p.legalName || '',
      PartyType: p.partyType || '',
      Roles: (p.roles || []).join(','),
      Status: p.status || '',
      Phone: p.phone || '',
      Email: p.email || '',
      Website: p.website || '',
      TaxRegistered: p?.taxProfile?.isTaxRegistered ? 'YES' : 'NO',
      TaxId: p?.taxProfile?.taxId || '',
      PAN: p?.taxProfile?.pan || '',
      PlaceOfSupply: p?.taxProfile?.placeOfSupply || '',
      Currency: p.currency || 'INR',
      CreditLimit: p.creditLimit ?? 0,
      OpeningBalance: p.openingBalance ?? 0,
      Notes: p.notes || '',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Parties');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="parties_${Date.now()}.xlsx"`);
    return res.send(buf);
  } catch (err) {
    return handleError(res, err, 'Failed to export parties');
  }
}

/**
 * POST /parties/import
 * multipart/form-data, field name: "file"
 *
 * Columns (case-insensitive):
 *  Name*, LegalName, PartyType, Roles, Status, Phone, Email, Website,
 *  TaxRegistered, TaxId, PAN, PlaceOfSupply, Currency, CreditLimit, OpeningBalance, Notes
 *
 * Upsert rules:
 *  - If TaxId exists => upsert by (companyId + taxId)
 *  - Else => soft match by (companyId + name + phone?) then update, else create
 */
export async function importPartiesXlsx(req, res) {
  try {
    const companyId = ensureCompany(req);

    if (!req.file?.buffer) {
      throw new Error('Missing file. Send multipart/form-data with field name "file".');
    }

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) throw new Error('Excel has no sheets');

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.json({
        status: true,
        message: 'No rows found in file',
        summary: { total: 0, created: 0, updated: 0, failed: 0 },
        errors: [],
      });
    }

    const errors = [];
    let created = 0;
    let updated = 0;

    const getCell = (row, key) => {
      const k = Object.keys(row).find((x) => asLower(x) === asLower(key));
      return k ? row[k] : '';
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const name = asStr(getCell(row, 'Name'));
        if (!name) throw new Error('Name is required');

        const roles = parseRoles(getCell(row, 'Roles'));
        validateRoles(roles);

        const partyType = asUpper(getCell(row, 'PartyType')) || PARTY_TYPE.BUSINESS;
        if (!Object.values(PARTY_TYPE).includes(partyType)) throw new Error(`Invalid PartyType "${partyType}"`);

        const status = asLower(getCell(row, 'Status')) || PARTY_STATUS.ACTIVE;
        if (!Object.values(PARTY_STATUS).includes(status)) throw new Error(`Invalid Status "${status}"`);

        const taxRegisteredRaw = asUpper(getCell(row, 'TaxRegistered'));
        const isTaxRegistered = taxRegisteredRaw === 'YES' || taxRegisteredRaw === 'TRUE' || taxRegisteredRaw === '1';

        const taxId = asUpper(getCell(row, 'TaxId')) || null;
        const pan = asUpper(getCell(row, 'PAN')) || null;

        const payload = {
          companyId,
          name,
          legalName: asStr(getCell(row, 'LegalName')),
          partyType,
          roles,
          status,
          phone: asStr(getCell(row, 'Phone')),
          email: asLower(getCell(row, 'Email')),
          website: asStr(getCell(row, 'Website')),
          taxProfile: {
            isTaxRegistered,
            taxId,
            pan,
            placeOfSupply: asStr(getCell(row, 'PlaceOfSupply')),
          },
          currency: asStr(getCell(row, 'Currency')) || 'INR',
          creditLimit: Number(getCell(row, 'CreditLimit') || 0),
          openingBalance: Number(getCell(row, 'OpeningBalance') || 0),
          notes: asStr(getCell(row, 'Notes')),
        };

        validateEmailPhone({ email: payload.email, phone: payload.phone });
        validateTaxIdMaybeGSTIN(payload?.taxProfile?.taxId);

        if (Number.isNaN(payload.creditLimit) || payload.creditLimit < 0) throw new Error('CreditLimit must be a non-negative number');
        if (Number.isNaN(payload.openingBalance)) throw new Error('OpeningBalance must be a number');

        // Upsert
        if (taxId) {
          const doc = await Party.findOne({ companyId, 'taxProfile.taxId': taxId });
          if (doc) {
            Object.assign(doc, applyAuditUpdate(req, payload));
            await doc.save();
            updated++;
          } else {
            await Party.create(applyAuditCreate(req, payload));
            created++;
          }
        } else {
          const softMatch = { companyId, name: payload.name };
          if (payload.phone) softMatch.phone = payload.phone;

          const doc = await Party.findOne(softMatch);
          if (doc) {
            Object.assign(doc, applyAuditUpdate(req, payload));
            await doc.save();
            updated++;
          } else {
            await Party.create(applyAuditCreate(req, payload));
            created++;
          }
        }
      } catch (e) {
        // row number: +2 because header row + 1-indexed
        errors.push({ row: i + 2, error: String(e?.message || e) });
      }
    }

    return res.json({
      status: true,
      message: 'Import completed',
      summary: { total: rows.length, created, updated, failed: errors.length },
      errors,
    });
  } catch (err) {
    return handleError(res, err, 'Failed to import parties');
  }
}

const partyController = {
  createParty,
  getPartyById,
  listParties,
  getPartyOptions,
  updateParty,
  updatePartyStatus,
  deleteParty,
  exportPartiesXlsx,
  importPartiesXlsx,
};

export default partyController;

// I want to use this ✅ Option A — If user enters GSTIN
// You can fetch:
// 	•	legal name
// 	•	address
// 	•	registration status/type
// …but typically via GSTN APIs through an authorized channel (GSP / e-invoice APIs), not a casual public endpoint. GSTN explains GSP ecosystem (authorized providers) here.  
// NIC’s e-invoice API docs also show “Get GSTIN details” endpoints (part of e-invoicing API set).  

// Best practical approach:
// In your Party form, add a button:
// 	•	“Fetch details from GSTIN”
// 	•	Fill: legalName + address + status

// So for this we need to make one api ??