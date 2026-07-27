import 'dotenv/config';
import mongoose from 'mongoose';
import Party, {
  PARTY_LIFECYCLE,
  PARTY_PRIORITY,
  PARTY_ROLES,
  PARTY_STATUS,
  PARTY_TYPE,
  buildPartySearchPrefixes,
} from '../models/Party.js';
import { normalizePartyPayload } from '../services/partyService.js';

const applyChanges = process.argv.includes('--apply');
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('MONGO_URI or MONGODB_URI is required');
  process.exit(1);
}

const validRoles = new Set(Object.values(PARTY_ROLES));
const validStatuses = new Set(Object.values(PARTY_STATUS));
const validLifecycle = new Set(Object.values(PARTY_LIFECYCLE));
const validPriorities = new Set(Object.values(PARTY_PRIORITY));
const validTypes = new Set(Object.values(PARTY_TYPE));

function legacyAddresses(value) {
  if (!Array.isArray(value)) return value;
  const [primary = {}, ...additional] = value;
  const mapAddress = (address, isPrimary = false) => ({
    ...address,
    country: ['IN', 'IND'].includes(String(address.country || '').toUpperCase())
      ? 'India'
      : address.country,
    purposes: [
      ...(address.purposes || []),
      ...(address.isDefaultBilling ? ['billing'] : []),
      ...(address.isDefaultShipping ? ['shipping'] : []),
      ...(isPrimary && !(address.purposes || []).length ? ['registered'] : []),
    ],
  });
  return {
    primaryAddress: mapAddress(primary, true),
    additionalAddresses: additional.map(address => mapAddress(address)),
  };
}

function legacyRoles(row) {
  const values = Array.isArray(row.roles)
    ? row.roles
    : [row.role].filter(Boolean);
  const aliases = {
    VENDOR: PARTY_ROLES.SUPPLIER,
    SUPPLIER: PARTY_ROLES.SUPPLIER,
    CUSTOMER: PARTY_ROLES.CUSTOMER,
    CLIENT: PARTY_ROLES.CUSTOMER,
    BUYER: PARTY_ROLES.CUSTOMER,
    TRANSPORTER: PARTY_ROLES.TRANSPORTER,
    LOGISTICS: PARTY_ROLES.TRANSPORTER,
    JOBWORKER: PARTY_ROLES.JOBWORKER,
    JOB_WORKER: PARTY_ROLES.JOBWORKER,
    BROKER: PARTY_ROLES.BROKER,
    SERVICE_PROVIDER: PARTY_ROLES.SERVICE_PROVIDER,
  };
  return values.map(value => {
    const key = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
    return aliases[key] || key;
  });
}

function legacyTaxProfile(row) {
  const source = row.taxProfile || {};
  const legacy = row.tax || {};
  const taxId = source.taxId
    || legacy.taxId
    || legacy.gstin
    || legacy.gstNo
    || legacy.vatNumber
    || '';
  return {
    ...legacy,
    ...source,
    taxId,
    pan: source.pan || legacy.pan || '',
    isTaxRegistered: source.isTaxRegistered ?? Boolean(taxId),
    placeOfSupply: source.placeOfSupply || legacy.placeOfSupply || '',
  };
}

function legacyBankAccounts(row) {
  if (Array.isArray(row.bankAccounts)) return row.bankAccounts;
  if (!row.bank || typeof row.bank !== 'object') return [];
  return [{
    accountHolderName:
      row.bank.accountHolderName || row.bank.holderName || row.legalName || '',
    bankName: row.bank.bankName || row.bank.name || '',
    accountNumber:
      row.bank.accountNumber || row.bank.accountNo || row.bank.number || '',
    ifscCode: row.bank.ifscCode || row.bank.ifsc || '',
    swiftCode: row.bank.swiftCode || row.bank.swift || '',
    branch: row.bank.branch || '',
    accountType: row.bank.accountType || 'CURRENT',
    currency: row.bank.currency || row.currency || 'INR',
    isPrimary: true,
    isActive: row.bank.isActive !== false,
  }];
}

function candidateInput(row) {
  const roles = [...new Set(
    legacyRoles(row)
      .map(value => String(value).trim().toUpperCase())
      .filter(value => validRoles.has(value)),
  )];
  if (!roles.length) roles.push(PARTY_ROLES.OTHER);

  const taxProfile = legacyTaxProfile(row);
  const taxId = String(taxProfile.taxId || '').trim().toUpperCase();
  const taxIdType = ['GSTIN', 'VAT', 'EIN', 'OTHER'].includes(taxProfile.taxIdType)
    ? taxProfile.taxIdType
    : taxId.length === 15
      ? 'GSTIN'
      : 'OTHER';

  return {
    code: row.code || `BP-${String(row._id).slice(-12).toUpperCase()}`,
    name: row.name || row.displayName || row.legalName,
    legalName: row.legalName || row.name,
    partyType: validTypes.has(row.partyType) ? row.partyType : PARTY_TYPE.BUSINESS,
    roles,
    status: validStatuses.has(row.status) ? row.status : PARTY_STATUS.INACTIVE,
    lifecycleStage: validLifecycle.has(row.lifecycleStage)
      ? row.lifecycleStage
      : row.status === PARTY_STATUS.ACTIVE
        ? PARTY_LIFECYCLE.ACTIVE
        : PARTY_LIFECYCLE.DORMANT,
    priority: validPriorities.has(row.priority)
      ? row.priority
      : PARTY_PRIORITY.NORMAL,
    accountOwner: row.accountOwner || row.createdBy || null,
    leadSource: row.leadSource,
    industry: row.industry,
    phone: row.phone,
    alternatePhone: row.alternatePhone,
    email: row.email,
    website: row.website,
    communicationPreferences: row.communicationPreferences,
    tags: row.tags,
    addresses: legacyAddresses(row.addresses),
    contacts: row.contacts,
    taxProfile: {
      ...taxProfile,
      taxIdType,
      taxId: taxId || null,
      gstRegistrationType: taxProfile.gstRegistrationType
        || (taxProfile.isTaxRegistered ? 'REGULAR' : 'UNREGISTERED'),
    },
    paymentTerms: row.paymentTerms,
    currency: row.currency,
    creditLimit: row.creditLimit,
    bankAccounts: legacyBankAccounts(row),
    notes: row.notes,
    meta: row.meta,
    customFields: row.customFields,
  };
}

await mongoose.connect(mongoUri, { autoIndex: false });

try {
  const collection = mongoose.connection.collection('parties');
  const companyIds = await mongoose.connection
    .collection('companies')
    .distinct('_id');
  const report = {
    mode: applyChanges ? 'APPLY' : 'AUDIT',
    scanned: 0,
    valid: 0,
    legacyRecords: 0,
    inferredCompanyIds: 0,
    plannedUpdates: 0,
    updated: 0,
    indexes: {
      synchronized: false,
      dropped: [],
      error: null,
    },
    blockers: [],
    warnings: [],
  };
  const operations = [];
  const seenCodes = new Set();

  for await (const row of collection.find({})) {
    report.scanned += 1;
    try {
      const isLegacy = Boolean(
        row.displayName
        || row.role
        || row.tax
        || row.bank
        || Array.isArray(row.addresses),
      );
      if (isLegacy) report.legacyRecords += 1;

      const companyId = row.companyId || (
        companyIds.length === 1 ? companyIds[0] : null
      );
      if (!companyId) {
        throw new Error(
          companyIds.length
            ? 'Missing companyId and multiple companies exist; assign the correct company manually'
            : 'Missing companyId and no company exists to infer it from',
        );
      }
      if (!row.companyId) report.inferredCompanyIds += 1;

      const payload = normalizePartyPayload(candidateInput(row));
      const codeKey = `${companyId}:${payload.code}`;
      if (seenCodes.has(codeKey)) {
        throw new Error(`Duplicate generated/existing partner code ${payload.code}`);
      }
      seenCodes.add(codeKey);

      const model = new Party({
        ...payload,
        _id: row._id,
        companyId,
        archivedAt: row.archivedAt,
        archivedBy: row.archivedBy,
        createdBy: row.createdBy,
        updatedBy: row.updatedBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        __v: Number.isInteger(row.__v) ? row.__v : 0,
      });
      await model.validate();
      payload.searchPrefixes = buildPartySearchPrefixes(payload);
      if (payload.status === PARTY_STATUS.ARCHIVED) {
        payload.archivedAt = row.archivedAt || new Date();
        payload.archivedBy = row.archivedBy || row.updatedBy || null;
      } else {
        payload.archivedAt = null;
        payload.archivedBy = null;
      }

      report.valid += 1;
      report.plannedUpdates += 1;
      operations.push({
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: {
              ...payload,
              companyId,
              ...(Number.isInteger(row.__v) ? {} : { __v: 0 }),
            },
            ...(isLegacy
              ? {
                  $unset: {
                    displayName: '',
                    role: '',
                    tax: '',
                    bank: '',
                  },
                }
              : {}),
          },
        },
      });

    } catch (error) {
      report.blockers.push({
        id: String(row._id),
        name: row.name || '',
        error: error.message,
      });
    }
  }

  if (applyChanges && report.blockers.length === 0) {
    for (let index = 0; index < operations.length; index += 500) {
      const result = await collection.bulkWrite(
        operations.slice(index, index + 500),
        { ordered: false },
      );
      report.updated += result.modifiedCount;
    }
    try {
      report.indexes.dropped = await Party.syncIndexes();
      report.indexes.synchronized = true;
    } catch (error) {
      report.indexes.error = error.message;
      report.warnings.push(
        'Party records were migrated, but index synchronization failed.',
      );
      process.exitCode = 3;
    }
  } else if (applyChanges && report.blockers.length) {
    report.warnings.push(
      'No records were changed because the preflight audit found blockers.',
    );
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.blockers.length) process.exitCode = 2;
} finally {
  await mongoose.disconnect();
}
