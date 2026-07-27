import XLSX from 'xlsx';
import Party, {
  PARTY_LIFECYCLE,
  PARTY_ROLES,
  PARTY_STATUS,
  PARTY_TYPE,
} from '../models/Party.js';
import User from '../models/User.js';
import { AppError, handleError } from '../utils/errorHandler.js';
import { applyAuditCreate, applyAuditUpdate } from '../utils/auditHelper.js';
import {
  PARTY_LIST_SELECT,
  asString,
  assertAccountOwner,
  buildPartyFilter,
  castPartyCompanyId,
  dataQualityForParty,
  findDuplicateParties,
  normalizePartyPayload,
  partyListOptions,
  validatePartyId,
} from '../services/partyService.js';
import {
  isTallyPartyExport,
  isTallyPlaceholderRow,
  mapTallyPartyRow,
} from '../services/tallyPartyImportMapper.js';

const actorId = req => req.user?.id || req.user?._id || req.user?.userId || null;

function companyIdFrom(req) {
  const companyId = req.user?.companyId;
  if (!companyId) {
    throw new AppError('Missing company context', {
      statusCode: 401,
      code: 'COMPANY_REQUIRED',
    });
  }
  return companyId;
}

function conflict(message, code, details = null) {
  return new AppError(message, { statusCode: 409, code, details });
}

function mapPartyDetail(party) {
  if (!party) return null;
  return {
    ...party,
    dataQuality: dataQualityForParty(party),
  };
}

function criticalDuplicate(duplicates, payload) {
  return duplicates.find(party => (
    (payload.code && party.code === payload.code)
    || (
      payload.taxProfile?.taxId
      && party.taxProfile?.taxId === payload.taxProfile.taxId
    )
  ));
}

export async function createParty(req, res) {
  try {
    const companyId = companyIdFrom(req);
    const payload = normalizePartyPayload(req.body || {});
    payload.companyId = companyId;
    payload.accountOwner ||= actorId(req);
    await assertAccountOwner(companyId, payload.accountOwner);

    const duplicates = await findDuplicateParties(companyId, payload);
    const exact = criticalDuplicate(duplicates, payload);
    if (exact) {
      throw conflict(
        'A business partner with this code or tax ID already exists',
        'DUPLICATE_PARTY',
        { duplicate: exact },
      );
    }

    const doc = await Party.create(applyAuditCreate(req, payload));
    const created = await Party.findById(doc._id)
      .populate('accountOwner', 'fullName email status')
      .lean();
    return res.status(201).json({
      status: true,
      message: 'Business partner created',
      data: mapPartyDetail(created),
      warnings: duplicates,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getPartyById(req, res) {
  try {
    const companyId = companyIdFrom(req);
    validatePartyId(req.params.id);
    const party = await Party.findOne({ _id: req.params.id, companyId })
      .populate('accountOwner', 'fullName email status')
      .populate('createdBy', 'fullName email')
      .populate('updatedBy', 'fullName email')
      .lean();
    if (!party) {
      throw new AppError('Business partner not found', {
        statusCode: 404,
        code: 'PARTY_NOT_FOUND',
      });
    }
    return res.json({ status: true, data: mapPartyDetail(party) });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function listParties(req, res) {
  try {
    const companyId = companyIdFrom(req);
    const filter = buildPartyFilter(companyId, req.query);
    const options = partyListOptions(req.query);
    const [rows, total] = await Promise.all([
      Party.find(filter)
        .select(PARTY_LIST_SELECT)
        .populate('accountOwner', 'fullName email')
        .sort(options.sort)
        .skip(options.skip)
        .limit(options.limit)
        .lean(),
      Party.countDocuments(filter),
    ]);

    return res.json({
      status: true,
      data: rows,
      meta: {
        page: options.page,
        limit: options.limit,
        total,
        pages: Math.ceil(total / options.limit),
        hasNextPage: options.page * options.limit < total,
        hasPreviousPage: options.page > 1,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getPartySummary(req, res) {
  try {
    const companyId = companyIdFrom(req);
    const aggregateCompanyId = castPartyCompanyId(companyId);
    const [summary] = await Party.aggregate([
      { $match: { companyId: aggregateCompanyId } },
      {
        $facet: {
          total: [{ $count: 'value' }],
          statuses: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          lifecycle: [{ $group: { _id: '$lifecycleStage', count: { $sum: 1 } } }],
          roles: [
            { $unwind: '$roles' },
            { $group: { _id: '$roles', count: { $sum: 1 } } },
          ],
        },
      },
    ]);
    const toObject = rows => Object.fromEntries(
      (rows || []).map(row => [row._id, row.count]),
    );
    return res.json({
      status: true,
      data: {
        total: summary?.total?.[0]?.value || 0,
        statuses: toObject(summary?.statuses),
        lifecycle: toObject(summary?.lifecycle),
        roles: toObject(summary?.roles),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getPartyOptions(req, res) {
  try {
    const companyId = companyIdFrom(req);
    const filter = buildPartyFilter(companyId, {
      ...req.query,
      status: PARTY_STATUS.ACTIVE,
    });
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const rows = await Party.find(filter)
      .select('code name legalName phone email roles status taxProfile.taxId')
      .sort({ name: 1, _id: 1 })
      .limit(limit)
      .lean();

    return res.json({
      status: true,
      data: rows.map(party => ({
        _id: party._id,
        value: String(party._id),
        name: party.name,
        legalName: party.legalName,
        phone: party.phone,
        email: party.email,
        roles: party.roles,
        status: party.status,
        taxProfile: party.taxProfile,
        label: `${party.code} · ${party.name}`,
      })),
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getAccountOwnerOptions(req, res) {
  try {
    const companyId = companyIdFrom(req);
    const search = asString(req.query.q);
    const filter = {
      companyId,
      status: { $in: ['active', 'pending'] },
    };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
      ];
    }
    const users = await User.find(filter)
      .select('fullName email role status')
      .sort({ fullName: 1 })
      .limit(100)
      .lean();
    return res.json({
      status: true,
      data: users.map(user => ({
        value: String(user._id),
        label: `${user.fullName} · ${user.email}`,
        meta: { role: user.role, status: user.status },
      })),
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function checkPartyDuplicates(req, res) {
  try {
    const companyId = companyIdFrom(req);
    const payload = normalizePartyPayload(req.body || {});
    const excludeId = req.body?.excludeId || null;
    if (excludeId) validatePartyId(excludeId);
    const rows = await findDuplicateParties(companyId, payload, excludeId);
    return res.json({
      status: true,
      data: rows,
      meta: { count: rows.length },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function updateParty(req, res) {
  try {
    const companyId = companyIdFrom(req);
    validatePartyId(req.params.id);
    const existing = await Party.findOne({ _id: req.params.id, companyId });
    if (!existing) {
      throw new AppError('Business partner not found', {
        statusCode: 404,
        code: 'PARTY_NOT_FOUND',
      });
    }

    const requestedVersion = req.body?.version;
    if (
      requestedVersion !== undefined
      && Number(requestedVersion) !== existing.__v
    ) {
      throw conflict(
        'This business partner was changed by another user. Refresh before saving.',
        'STALE_PARTY_VERSION',
        { expected: existing.__v, received: Number(requestedVersion) },
      );
    }

    const current = existing.toObject({ flattenMaps: true });
    const incoming = req.body || {};
    const merged = {
      ...current,
      ...incoming,
      addresses: incoming.addresses ?? current.addresses,
      contacts: incoming.contacts ?? current.contacts,
      bankAccounts: incoming.bankAccounts ?? current.bankAccounts,
      taxProfile: { ...(current.taxProfile || {}), ...(incoming.taxProfile || {}) },
      paymentTerms: {
        ...(current.paymentTerms || {}),
        ...(incoming.paymentTerms || {}),
      },
      communicationPreferences: {
        ...(current.communicationPreferences || {}),
        ...(incoming.communicationPreferences || {}),
      },
      meta: incoming.meta ?? current.meta,
      customFields: incoming.customFields ?? current.customFields,
    };
    const payload = normalizePartyPayload(merged);
    await assertAccountOwner(companyId, payload.accountOwner);

    const duplicates = await findDuplicateParties(companyId, payload, existing._id);
    const exact = criticalDuplicate(duplicates, payload);
    if (exact) {
      throw conflict(
        'Another business partner already uses this code or tax ID',
        'DUPLICATE_PARTY',
        { duplicate: exact },
      );
    }

    Object.assign(existing, applyAuditUpdate(req, payload));
    await existing.save();
    const updated = await Party.findById(existing._id)
      .populate('accountOwner', 'fullName email status')
      .lean();
    return res.json({
      status: true,
      message: 'Business partner updated',
      data: mapPartyDetail(updated),
      warnings: duplicates,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function updatePartyStatus(req, res) {
  try {
    const companyId = companyIdFrom(req);
    validatePartyId(req.params.id);
    const status = String(req.body?.to || '').trim().toLowerCase();
    if (!Object.values(PARTY_STATUS).includes(status)) {
      throw new AppError('Invalid target status', {
        statusCode: 400,
        code: 'INVALID_PARTY_STATUS',
      });
    }

    const party = await Party.findOne({ _id: req.params.id, companyId });
    if (!party) {
      throw new AppError('Business partner not found', {
        statusCode: 404,
        code: 'PARTY_NOT_FOUND',
      });
    }
    party.status = status;
    if (status === PARTY_STATUS.ARCHIVED) {
      party.archivedAt = new Date();
      party.archivedBy = actorId(req);
    }
    Object.assign(party, applyAuditUpdate(req, {}));
    await party.save();
    return res.json({
      status: true,
      message: status === PARTY_STATUS.ARCHIVED
        ? 'Business partner archived'
        : 'Business partner status updated',
      data: party,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function archiveParty(req, res) {
  req.body = { ...(req.body || {}), to: PARTY_STATUS.ARCHIVED };
  return updatePartyStatus(req, res);
}

export async function restoreParty(req, res) {
  req.body = { ...(req.body || {}), to: PARTY_STATUS.INACTIVE };
  return updatePartyStatus(req, res);
}

function exportFilter(companyId, query) {
  return buildPartyFilter(companyId, {
    role: query.role,
    status: query.status || 'all',
    lifecycleStage: query.lifecycleStage,
    priority: query.priority,
    q: query.q,
  });
}

export async function exportPartiesXlsx(req, res) {
  try {
    const companyId = companyIdFrom(req);
    const rows = await Party.find(exportFilter(companyId, req.query))
      .sort({ name: 1 })
      .lean();
    const data = rows.map(party => {
      const address = party.addresses?.primaryAddress || {};
      const contact = (party.contacts || []).find(item => item.isPrimary)
        || party.contacts?.[0]
        || {};
      return {
        Code: party.code || '',
        Name: party.name || '',
        LegalName: party.legalName || '',
        PartyType: party.partyType || PARTY_TYPE.BUSINESS,
        Roles: (party.roles || []).join(','),
        Status: party.status || PARTY_STATUS.ACTIVE,
        LifecycleStage: party.lifecycleStage || PARTY_LIFECYCLE.ACTIVE,
        Priority: party.priority || 'NORMAL',
        Industry: party.industry || '',
        LeadSource: party.leadSource || '',
        Phone: party.phone || '',
        AlternatePhone: party.alternatePhone || '',
        Email: party.email || '',
        Website: party.website || '',
        TaxRegistered: party.taxProfile?.isTaxRegistered ? 'YES' : 'NO',
        TaxIdType: party.taxProfile?.taxIdType || 'GSTIN',
        TaxId: party.taxProfile?.taxId || '',
        PAN: party.taxProfile?.pan || '',
        GSTRegistrationType: party.taxProfile?.gstRegistrationType || '',
        RegistrationNumber: party.taxProfile?.registrationNumber || '',
        CIN: party.taxProfile?.cin || '',
        MSMENumber: party.taxProfile?.msmeNumber || '',
        PlaceOfSupply: party.taxProfile?.placeOfSupply || '',
        AddressLine1: address.line1 || '',
        AddressLine2: address.line2 || '',
        City: address.city || '',
        State: address.state || '',
        Country: address.country || '',
        Pincode: address.pincode || '',
        PrimaryContact: contact.name || '',
        ContactDesignation: contact.designation || '',
        ContactPhone: contact.phone || '',
        ContactEmail: contact.email || '',
        PaymentTermType: party.paymentTerms?.type || 'NET_DAYS',
        NetDays: party.paymentTerms?.netDays ?? 30,
        Currency: party.currency || 'INR',
        CreditLimit: party.creditLimit ?? 0,
        Tags: (party.tags || []).join(','),
        Notes: party.notes || '',
      };
    });

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet['!cols'] = Object.keys(data[0] || { Name: '' })
      .map(key => ({ wch: Math.min(Math.max(key.length + 2, 14), 32) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Business Partners');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="business_partners_${Date.now()}.xlsx"`,
    );
    return res.send(buffer);
  } catch (error) {
    return handleError(res, error);
  }
}

function cellGetter(row) {
  const keys = Object.keys(row);
  return name => {
    const key = keys.find(value => (
      String(value).trim().toLowerCase() === String(name).trim().toLowerCase()
    ));
    return key ? row[key] : '';
  };
}

function boolCell(value) {
  return ['yes', 'true', '1', 'y'].includes(String(value).trim().toLowerCase());
}

function importPayload(row, current = {}) {
  const cell = cellGetter(row);
  const hasCell = name => {
    const value = cell(name);
    return value !== '' && value !== null && value !== undefined;
  };
  const valueOr = (name, fallback = '') => (
    hasCell(name) ? cell(name) : fallback
  );
  const currentTax = current.taxProfile || {};
  const currentAddress = current.addresses?.primaryAddress || {};
  const currentContacts = Array.isArray(current.contacts) ? current.contacts : [];
  const currentPrimaryIndex = currentContacts.findIndex(contact => contact.isPrimary);
  const primaryIndex = currentPrimaryIndex >= 0 ? currentPrimaryIndex : 0;
  const currentPrimary = currentContacts[primaryIndex] || {};
  const hasContactChanges = [
    'PrimaryContact',
    'ContactDesignation',
    'ContactPhone',
    'ContactEmail',
  ].some(hasCell);
  let contacts = currentContacts;
  if (hasContactChanges) {
    const primaryContact = {
      ...currentPrimary,
      name: valueOr('PrimaryContact', currentPrimary.name),
      designation: valueOr('ContactDesignation', currentPrimary.designation),
      phone: valueOr('ContactPhone', currentPrimary.phone),
      email: valueOr('ContactEmail', currentPrimary.email),
      isPrimary: true,
    };
    contacts = currentContacts.length
      ? currentContacts.map((contact, index) => (
          index === primaryIndex
            ? primaryContact
            : { ...contact, isPrimary: false }
        ))
      : [primaryContact];
  }

  const taxRegistered = hasCell('TaxRegistered')
    ? boolCell(cell('TaxRegistered'))
    : Boolean(currentTax.isTaxRegistered);
  const incomingRoles = valueOr(
    'Roles',
    current.roles || PARTY_ROLES.SUPPLIER,
  );
  const roles = row.__mergeRoles
    ? [...new Set([
        ...(Array.isArray(current.roles) ? current.roles : []),
        ...(Array.isArray(incomingRoles)
          ? incomingRoles
          : String(incomingRoles || '').split(/[,|]/)),
      ].map(value => String(value).trim().toUpperCase()).filter(Boolean))]
    : incomingRoles;
  const currentMeta = current.meta instanceof Map
    ? Object.fromEntries(current.meta)
    : current.meta || {};
  const importMeta = row.__importMeta || {};
  return normalizePartyPayload({
    code: valueOr('Code', current.code),
    name: valueOr('Name', current.name),
    legalName: valueOr('LegalName', current.legalName),
    partyType: valueOr('PartyType', current.partyType || PARTY_TYPE.BUSINESS),
    roles,
    status: valueOr('Status', current.status || PARTY_STATUS.ACTIVE),
    lifecycleStage: valueOr(
      'LifecycleStage',
      current.lifecycleStage || PARTY_LIFECYCLE.ACTIVE,
    ),
    priority: valueOr('Priority', current.priority || 'NORMAL'),
    accountOwner: current.accountOwner,
    industry: valueOr('Industry', current.industry),
    leadSource: valueOr('LeadSource', current.leadSource),
    phone: valueOr('Phone', current.phone),
    alternatePhone: valueOr('AlternatePhone', current.alternatePhone),
    email: valueOr('Email', current.email),
    website: valueOr('Website', current.website),
    communicationPreferences: current.communicationPreferences,
    taxProfile: {
      isTaxRegistered: taxRegistered,
      taxIdType: valueOr('TaxIdType', currentTax.taxIdType || 'GSTIN'),
      taxId: valueOr('TaxId', currentTax.taxId),
      pan: valueOr('PAN', currentTax.pan),
      gstRegistrationType: valueOr('GSTRegistrationType', currentTax.gstRegistrationType)
        || (taxRegistered ? 'REGULAR' : 'UNREGISTERED'),
      registrationNumber: valueOr(
        'RegistrationNumber',
        currentTax.registrationNumber,
      ),
      cin: valueOr('CIN', currentTax.cin),
      msmeNumber: valueOr('MSMENumber', currentTax.msmeNumber),
      placeOfSupply: valueOr('PlaceOfSupply', currentTax.placeOfSupply),
    },
    addresses: {
      primaryAddress: {
        ...currentAddress,
        label: currentAddress.label || 'Office',
        purposes: currentAddress.purposes?.length
          ? currentAddress.purposes
          : ['registered'],
        line1: valueOr('AddressLine1', currentAddress.line1),
        line2: valueOr('AddressLine2', currentAddress.line2),
        city: valueOr('City', currentAddress.city),
        state: valueOr('State', currentAddress.state),
        country: valueOr('Country', currentAddress.country || 'India'),
        pincode: valueOr('Pincode', currentAddress.pincode),
      },
      additionalAddresses: current.addresses?.additionalAddresses || [],
    },
    contacts,
    paymentTerms: {
      ...(current.paymentTerms || {}),
      type: valueOr(
        'PaymentTermType',
        current.paymentTerms?.type || 'NET_DAYS',
      ),
      netDays: valueOr('NetDays', current.paymentTerms?.netDays ?? 30),
    },
    currency: valueOr('Currency', current.currency || 'INR'),
    creditLimit: valueOr('CreditLimit', current.creditLimit ?? 0),
    bankAccounts: current.bankAccounts,
    tags: valueOr('Tags', current.tags),
    notes: valueOr('Notes', current.notes),
    meta: {
      ...currentMeta,
      ...importMeta,
      ...(currentMeta.tally || importMeta.tally
        ? {
            tally: {
              ...(currentMeta.tally || {}),
              ...(importMeta.tally || {}),
            },
          }
        : {}),
    },
    customFields: current.customFields,
  });
}

export async function importPartiesXlsx(req, res) {
  try {
    const companyId = companyIdFrom(req);
    if (!req.file?.buffer) {
      throw new AppError(
        'Missing Excel file. Use multipart field "file".',
        { statusCode: 400, code: 'FILE_REQUIRED' },
      );
    }
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames?.[0]];
    if (!worksheet) {
      throw new AppError('Excel workbook has no readable sheet', {
        statusCode: 400,
        code: 'INVALID_EXCEL_FILE',
      });
    }
    const matrix = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    const headers = Array.isArray(matrix[0]) ? matrix[0] : [];
    const sourceFormat = isTallyPartyExport(headers)
      ? 'TALLY_XLSX'
      : 'ERP_XLSX';
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      defval: '',
      blankrows: false,
    });
    if (rows.length > 5000) {
      throw new AppError('Import is limited to 5,000 rows per file', {
        statusCode: 413,
        code: 'IMPORT_TOO_LARGE',
      });
    }

    const errors = [];
    const skippedRows = [];
    let created = 0;
    let updated = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const rowNumber = index + 2;
      if (
        sourceFormat === 'TALLY_XLSX'
        && isTallyPlaceholderRow(rows[index])
      ) {
        skippedRows.push({
          row: rowNumber,
          reason: 'Ignored Tally placeholder row',
        });
        continue;
      }

      try {
        const importRow = sourceFormat === 'TALLY_XLSX'
          ? mapTallyPartyRow(rows[index])
          : rows[index];
        const cell = cellGetter(importRow);
        const code = asString(cell('Code')).toUpperCase();
        const taxId = asString(cell('TaxId')).toUpperCase();
        const name = asString(cell('Name'));
        const phone = asString(cell('Phone'));
        const match = code
          ? { companyId, code }
          : taxId
            ? { companyId, 'taxProfile.taxId': taxId }
            : {
                companyId,
                name: {
                  $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
                  $options: 'i',
                },
                ...(phone ? { phone } : {}),
              };
        const existing = await Party.findOne(match);
        const payload = importPayload(
          importRow,
          existing?.toObject({ flattenMaps: true }),
        );
        payload.companyId = companyId;
        payload.accountOwner ||= actorId(req);
        if (existing) {
          Object.assign(existing, applyAuditUpdate(req, payload));
          await existing.save();
          updated += 1;
        } else {
          await Party.create(applyAuditCreate(req, payload));
          created += 1;
        }
      } catch (error) {
        errors.push({ row: rowNumber, error: error.message });
      }
    }

    return res.json({
      status: true,
      message: sourceFormat === 'TALLY_XLSX'
        ? 'Tally business partner import completed'
        : 'Business partner import completed',
      summary: {
        total: rows.length,
        created,
        updated,
        skipped: skippedRows.length,
        failed: errors.length,
      },
      errors: errors.slice(0, 200),
      meta: {
        sourceFormat,
        errorsTruncated: errors.length > 200,
        skippedRows: skippedRows.slice(0, 200),
        skippedRowsTruncated: skippedRows.length > 200,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export default {
  createParty,
  getPartyById,
  listParties,
  getPartySummary,
  getPartyOptions,
  getAccountOwnerOptions,
  checkPartyDuplicates,
  updateParty,
  updatePartyStatus,
  archiveParty,
  restoreParty,
  exportPartiesXlsx,
  importPartiesXlsx,
};
