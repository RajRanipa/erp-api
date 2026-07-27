import mongoose from 'mongoose';
import Party, {
  ADDRESS_PURPOSES,
  PARTY_LIFECYCLE,
  PARTY_PRIORITY,
  PARTY_ROLES,
  PARTY_STATUS,
  PARTY_TYPE,
  PREFERRED_CHANNELS,
} from '../models/Party.js';
import User from '../models/User.js';
import { AppError } from '../utils/errorHandler.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const PHONE_RE = /^[0-9+\-() ]{6,30}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PARTY_CODE_RE = /^[A-Z0-9][A-Z0-9._/-]{1,39}$/;

const fail = (message, statusCode = 400, code = 'PARTY_VALIDATION_ERROR', details = null) =>
  new AppError(message, { statusCode, code, details });

export const asString = value => String(value ?? '').trim();
const asUpper = value => asString(value).toUpperCase();
const asLower = value => asString(value).toLowerCase();

function enumValue(value, allowed, fallback, field) {
  const normalized = asUpper(value || fallback);
  if (!Object.values(allowed).includes(normalized)) {
    throw fail(
      `Invalid ${field}`,
      400,
      'INVALID_PARTY_FIELD',
      { field, value, allowed: Object.values(allowed) },
    );
  }
  return normalized;
}

function statusValue(value, fallback = PARTY_STATUS.ACTIVE) {
  const normalized = asLower(value || fallback);
  if (!Object.values(PARTY_STATUS).includes(normalized)) {
    throw fail(
      'Invalid business partner status',
      400,
      'INVALID_PARTY_STATUS',
      { value, allowed: Object.values(PARTY_STATUS) },
    );
  }
  return normalized;
}

function optionalId(value, field) {
  if (!value) return null;
  if (!mongoose.isValidObjectId(value)) {
    throw fail(`${field} is invalid`, 400, 'INVALID_ID', { field, value });
  }
  return value;
}

function normalizeEmail(value, field = 'email') {
  const email = asLower(value);
  if (email && !EMAIL_RE.test(email)) {
    throw fail(`Invalid ${field} format`, 400, 'INVALID_EMAIL', { field });
  }
  return email;
}

function normalizePhone(value, field = 'phone') {
  const phone = asString(value);
  if (phone && !PHONE_RE.test(phone)) {
    throw fail(`Invalid ${field} format`, 400, 'INVALID_PHONE', { field });
  }
  return phone;
}

function normalizeWebsite(value) {
  const website = asString(value);
  if (!website) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(website)
    ? website
    : `https://${website}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw fail('Invalid website URL', 400, 'INVALID_WEBSITE');
  }
}

function normalizePurposes(value) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map(asLower)
      .filter(purpose => Object.values(ADDRESS_PURPOSES).includes(purpose)),
  )];
}

function normalizeAddress(value = {}, { primary = false } = {}) {
  const address = value && typeof value === 'object' ? value : {};
  return {
    ...(mongoose.isValidObjectId(address._id) ? { _id: address._id } : {}),
    label: asString(address.label) || (primary ? 'Office' : 'Address'),
    purposes: normalizePurposes(address.purposes),
    line1: asString(address.line1),
    line2: asString(address.line2),
    landmark: asString(address.landmark),
    area: asString(address.area),
    city: asString(address.city),
    district: asString(address.district),
    state: asString(address.state),
    country: asString(address.country) || 'India',
    pincode: asString(address.pincode || address.postalCode),
    placeId: asString(address.placeId),
    isActive: address.isActive !== false,
    notes: asString(address.notes),
  };
}

function normalizeAddresses(value) {
  if (Array.isArray(value)) {
    const [first = {}, ...rest] = value;
    return {
      primaryAddress: normalizeAddress({
        ...first,
        purposes: [
          ...(first.purposes || []),
          ...(first.isDefaultBilling ? [ADDRESS_PURPOSES.BILLING] : []),
          ...(first.isDefaultShipping ? [ADDRESS_PURPOSES.SHIPPING] : []),
        ],
      }, { primary: true }),
      additionalAddresses: rest.map(address => normalizeAddress({
        ...address,
        purposes: [
          ...(address.purposes || []),
          ...(address.isDefaultBilling ? [ADDRESS_PURPOSES.BILLING] : []),
          ...(address.isDefaultShipping ? [ADDRESS_PURPOSES.SHIPPING] : []),
        ],
      })),
    };
  }

  const source = value && typeof value === 'object' ? value : {};
  const primaryAddress = normalizeAddress(source.primaryAddress || {}, { primary: true });
  const additionalAddresses = Array.isArray(source.additionalAddresses)
    ? source.additionalAddresses.map(address => normalizeAddress(address))
    : [];
  if (additionalAddresses.length > 50) {
    throw fail('A business partner cannot have more than 50 additional addresses');
  }
  return { primaryAddress, additionalAddresses };
}

function normalizeContact(value = {}, index = 0) {
  const contact = value && typeof value === 'object' ? value : {};
  return {
    ...(mongoose.isValidObjectId(contact._id) ? { _id: contact._id } : {}),
    name: asString(contact.name),
    designation: asString(contact.designation),
    department: asString(contact.department),
    phone: normalizePhone(contact.phone, `contacts.${index}.phone`),
    alternatePhone: normalizePhone(
      contact.alternatePhone,
      `contacts.${index}.alternatePhone`,
    ),
    email: normalizeEmail(contact.email, `contacts.${index}.email`),
    preferredChannel: enumValue(
      contact.preferredChannel,
      PREFERRED_CHANNELS,
      PREFERRED_CHANNELS.EMAIL,
      `contacts.${index}.preferredChannel`,
    ),
    isPrimary: Boolean(contact.isPrimary),
    isDecisionMaker: Boolean(contact.isDecisionMaker),
    receivesInvoices: Boolean(contact.receivesInvoices),
    receivesOrders: Boolean(contact.receivesOrders),
    isActive: contact.isActive !== false,
    notes: asString(contact.notes),
  };
}

function normalizeContacts(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 50) {
    throw fail('A business partner cannot have more than 50 contacts');
  }
  const contacts = value
    .map(normalizeContact)
    .filter(contact => contact.name || contact.phone || contact.email);
  let primarySeen = false;
  return contacts.map(contact => {
    if (contact.isPrimary && !primarySeen) {
      primarySeen = true;
      return contact;
    }
    return { ...contact, isPrimary: false };
  });
}

function normalizeBankAccount(value = {}, index = 0) {
  const account = value && typeof value === 'object' ? value : {};
  const accountType = asUpper(account.accountType || 'CURRENT');
  if (!['CURRENT', 'SAVINGS', 'CASH_CREDIT', 'OTHER'].includes(accountType)) {
    throw fail(`Invalid bankAccounts.${index}.accountType`);
  }
  const currency = asUpper(account.currency || 'INR');
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw fail(`Invalid bankAccounts.${index}.currency`);
  }
  return {
    ...(mongoose.isValidObjectId(account._id) ? { _id: account._id } : {}),
    accountHolderName: asString(account.accountHolderName),
    bankName: asString(account.bankName),
    accountNumber: asString(account.accountNumber),
    ifscCode: asUpper(account.ifscCode),
    swiftCode: asUpper(account.swiftCode),
    branch: asString(account.branch),
    accountType,
    currency,
    isPrimary: Boolean(account.isPrimary),
    isActive: account.isActive !== false,
    verifiedAt: account.verifiedAt || null,
  };
}

function normalizeBankAccounts(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 20) {
    throw fail('A business partner cannot have more than 20 bank accounts');
  }
  const accounts = value
    .map(normalizeBankAccount)
    .filter(account => account.bankName || account.accountNumber || account.ifscCode);
  let primarySeen = false;
  return accounts.map(account => {
    if (account.isPrimary && !primarySeen) {
      primarySeen = true;
      return account;
    }
    return { ...account, isPrimary: false };
  });
}

function normalizeExtension(value, field) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw fail(`${field} must be an object`);
  }
  const entries = Object.entries(value instanceof Map ? Object.fromEntries(value) : value);
  if (entries.length > 50) {
    throw fail(`${field} cannot contain more than 50 keys`);
  }
  for (const [key] of entries) {
    if (!key || key.startsWith('$') || key.includes('.')) {
      throw fail(`${field} contains an invalid key`, 400, 'INVALID_CUSTOM_FIELD', { key });
    }
  }
  if (Buffer.byteLength(JSON.stringify(Object.fromEntries(entries)), 'utf8') > 50_000) {
    throw fail(`${field} is too large`);
  }
  return Object.fromEntries(entries);
}

function normalizeTaxProfile(value = {}, country = 'India') {
  const source = value && typeof value === 'object' ? value : {};
  const taxIdType = asUpper(source.taxIdType || (asLower(country) === 'india' ? 'GSTIN' : 'OTHER'));
  if (!['GSTIN', 'VAT', 'EIN', 'OTHER'].includes(taxIdType)) {
    throw fail('Invalid taxProfile.taxIdType');
  }
  const taxId = asUpper(source.taxId) || null;
  const pan = asUpper(source.pan) || null;
  const isTaxRegistered = Boolean(source.isTaxRegistered);
  if (isTaxRegistered && !taxId) {
    throw fail('Tax ID is required when the business partner is tax registered');
  }
  if (taxId && taxIdType === 'GSTIN' && !GSTIN_RE.test(taxId)) {
    throw fail('Invalid GSTIN format', 400, 'INVALID_GSTIN');
  }
  if (pan && !PAN_RE.test(pan)) {
    throw fail('Invalid PAN format', 400, 'INVALID_PAN');
  }

  const gstRegistrationType = asUpper(
    source.gstRegistrationType || (isTaxRegistered ? 'REGULAR' : 'UNREGISTERED'),
  );
  if (!['REGULAR', 'COMPOSITION', 'SEZ', 'UNREGISTERED', 'OVERSEAS', 'OTHER']
    .includes(gstRegistrationType)) {
    throw fail('Invalid taxProfile.gstRegistrationType');
  }

  return {
    isTaxRegistered,
    taxIdType,
    taxId,
    pan,
    gstRegistrationType,
    registrationNumber: asString(source.registrationNumber),
    cin: asUpper(source.cin),
    msmeNumber: asUpper(source.msmeNumber),
    placeOfSupply: asString(source.placeOfSupply),
  };
}

function normalizePaymentTerms(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const type = asUpper(source.type || 'NET_DAYS');
  if (!['DUE_ON_RECEIPT', 'NET_DAYS', 'CUSTOM'].includes(type)) {
    throw fail('Invalid paymentTerms.type');
  }
  const netDays = type === 'DUE_ON_RECEIPT' ? 0 : Number(source.netDays ?? 30);
  if (!Number.isInteger(netDays) || netDays < 0 || netDays > 3650) {
    throw fail('paymentTerms.netDays must be an integer between 0 and 3650');
  }
  return { type, netDays, note: asString(source.note) };
}

function normalizeRoles(value) {
  const input = Array.isArray(value)
    ? value
    : asString(value).split(/[,|]/);
  const roles = [...new Set(input.map(asUpper).filter(Boolean))];
  if (!roles.length) throw fail('At least one business partner role is required');
  const invalid = roles.find(role => !Object.values(PARTY_ROLES).includes(role));
  if (invalid) {
    throw fail('Invalid business partner role', 400, 'INVALID_PARTY_ROLE', {
      value: invalid,
      allowed: Object.values(PARTY_ROLES),
    });
  }
  return roles;
}

export function normalizePartyPayload(body = {}) {
  const addresses = normalizeAddresses(body.addresses);
  const country = addresses.primaryAddress.country || 'India';
  const creditLimit = body.creditLimit == null || body.creditLimit === ''
    ? 0
    : Number(body.creditLimit);
  if (!Number.isFinite(creditLimit) || creditLimit < 0) {
    throw fail('creditLimit must be a non-negative number');
  }

  const code = asUpper(body.code);
  if (code && !PARTY_CODE_RE.test(code)) {
    throw fail(
      'Partner code must contain only letters, numbers, dot, dash, slash, or underscore',
      400,
      'INVALID_PARTY_CODE',
    );
  }

  const name = asString(body.name);
  if (name.length < 2 || name.length > 160) {
    throw fail('Name must be between 2 and 160 characters');
  }

  const currency = asUpper(body.currency || 'INR');
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw fail('currency must be a three-letter ISO code');
  }

  const communication = body.communicationPreferences || {};
  return {
    ...(code ? { code } : {}),
    name,
    legalName: asString(body.legalName),
    partyType: enumValue(body.partyType, PARTY_TYPE, PARTY_TYPE.BUSINESS, 'partyType'),
    roles: normalizeRoles(body.roles),
    status: statusValue(body.status),
    lifecycleStage: enumValue(
      body.lifecycleStage,
      PARTY_LIFECYCLE,
      PARTY_LIFECYCLE.ACTIVE,
      'lifecycleStage',
    ),
    priority: enumValue(
      body.priority,
      PARTY_PRIORITY,
      PARTY_PRIORITY.NORMAL,
      'priority',
    ),
    accountOwner: optionalId(body.accountOwner, 'accountOwner'),
    leadSource: asString(body.leadSource),
    industry: asString(body.industry),
    phone: normalizePhone(body.phone),
    alternatePhone: normalizePhone(body.alternatePhone, 'alternatePhone'),
    email: normalizeEmail(body.email),
    website: normalizeWebsite(body.website),
    communicationPreferences: {
      preferredChannel: enumValue(
        communication.preferredChannel,
        PREFERRED_CHANNELS,
        PREFERRED_CHANNELS.EMAIL,
        'communicationPreferences.preferredChannel',
      ),
      doNotContact: Boolean(communication.doNotContact),
      marketingOptIn: Boolean(communication.marketingOptIn),
      whatsappOptIn: Boolean(communication.whatsappOptIn),
    },
    tags: [...new Set(
      (Array.isArray(body.tags) ? body.tags : asString(body.tags).split(','))
        .map(asLower)
        .filter(Boolean),
    )].slice(0, 30),
    addresses,
    contacts: normalizeContacts(body.contacts),
    taxProfile: normalizeTaxProfile(body.taxProfile, country),
    paymentTerms: normalizePaymentTerms(body.paymentTerms),
    currency,
    creditLimit,
    bankAccounts: normalizeBankAccounts(body.bankAccounts),
    notes: asString(body.notes),
    meta: normalizeExtension(body.meta, 'meta'),
    customFields: normalizeExtension(body.customFields, 'customFields'),
  };
}

export async function assertAccountOwner(companyId, accountOwner) {
  if (!accountOwner) return;
  const exists = await User.exists({
    _id: accountOwner,
    companyId,
    status: { $in: ['active', 'pending'] },
  });
  if (!exists) {
    throw fail(
      'Account owner must be an active user in this company',
      409,
      'INVALID_ACCOUNT_OWNER',
    );
  }
}

export function validatePartyId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw fail('Invalid business partner id', 400, 'INVALID_ID');
  }
}

export function castPartyCompanyId(companyId) {
  if (!mongoose.isValidObjectId(companyId)) {
    throw fail('Invalid company context', 401, 'INVALID_COMPANY_ID');
  }
  return companyId instanceof mongoose.Types.ObjectId
    ? companyId
    : new mongoose.Types.ObjectId(companyId);
}

export function partySearchTokens(value) {
  return [...new Set(
    asLower(value)
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(token => token.slice(0, 32)),
  )].slice(0, 8);
}

export function buildPartyFilter(companyId, query = {}) {
  const filter = { companyId };

  if (query.role) {
    const role = asUpper(query.role);
    if (!Object.values(PARTY_ROLES).includes(role)) {
      throw fail('Invalid role filter');
    }
    filter.roles = role;
  }
  if (query.status && asLower(query.status) !== 'all') {
    filter.status = statusValue(query.status);
  }
  if (query.lifecycleStage) {
    filter.lifecycleStage = enumValue(
      query.lifecycleStage,
      PARTY_LIFECYCLE,
      null,
      'lifecycleStage',
    );
  }
  if (query.priority) {
    filter.priority = enumValue(query.priority, PARTY_PRIORITY, null, 'priority');
  }
  if (query.accountOwner) {
    filter.accountOwner = optionalId(query.accountOwner, 'accountOwner');
  }

  const search = asString(query.q);
  const tokens = partySearchTokens(search);
  if (tokens.length) {
    if (tokens.length === 1 && tokens[0].length === 1) {
      filter.name = { $regex: `^${tokens[0]}`, $options: 'i' };
    } else {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fallbackRegex = { $regex: escaped, $options: 'i' };
      filter.$or = [
        { searchPrefixes: { $all: tokens } },
        { code: fallbackRegex },
        { name: fallbackRegex },
        { legalName: fallbackRegex },
        { phone: fallbackRegex },
        { email: fallbackRegex },
        { 'taxProfile.taxId': fallbackRegex },
      ];
    }
  }
  return filter;
}

export function partyListOptions(query = {}) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const page = Math.max(1, Number(query.page) || 1);
  const sortFields = {
    name: 'name',
    code: 'code',
    status: 'status',
    phone: 'phone',
    email: 'email',
    lifecycleStage: 'lifecycleStage',
    priority: 'priority',
    updatedAt: 'updatedAt',
    createdAt: 'createdAt',
  };
  const sortBy = sortFields[query.sortBy] || 'name';
  const sortOrder = asLower(query.sortOrder) === 'desc' ? -1 : 1;
  return {
    limit,
    page,
    skip: (page - 1) * limit,
    sort: { [sortBy]: sortOrder, _id: sortOrder },
  };
}

export const PARTY_LIST_SELECT = [
  'code',
  'name',
  'legalName',
  'partyType',
  'roles',
  'status',
  'lifecycleStage',
  'priority',
  'phone',
  'email',
  'taxProfile.taxId',
  'taxProfile.taxIdType',
  'accountOwner',
  'updatedAt',
  'createdAt',
].join(' ');

export function dataQualityForParty(party) {
  const checks = [
    ['phone or email', Boolean(party?.phone || party?.email)],
    ['legal name', Boolean(party?.legalName || party?.partyType === PARTY_TYPE.INDIVIDUAL)],
    ['primary address', Boolean(party?.addresses?.primaryAddress?.line1)],
    ['city and state', Boolean(
      party?.addresses?.primaryAddress?.city
      && party?.addresses?.primaryAddress?.state
    )],
    ['contact person', Boolean(party?.contacts?.length)],
    ['tax details', Boolean(
      !party?.taxProfile?.isTaxRegistered || party?.taxProfile?.taxId
    )],
    ['payment terms', Boolean(party?.paymentTerms?.type)],
    ['account owner', Boolean(party?.accountOwner)],
  ];
  const completed = checks.filter(([, ok]) => ok).length;
  return {
    score: Math.round((completed / checks.length) * 100),
    missing: checks.filter(([, ok]) => !ok).map(([label]) => label),
  };
}

export async function findDuplicateParties(companyId, payload, excludeId = null) {
  const clauses = [];
  if (payload.code) clauses.push({ code: payload.code });
  if (payload.taxProfile?.taxId) {
    clauses.push({ 'taxProfile.taxId': payload.taxProfile.taxId });
  }
  if (payload.email) clauses.push({ email: payload.email });
  if (payload.phone) clauses.push({ phone: payload.phone });
  if (payload.name) {
    clauses.push({
      name: { $regex: `^${payload.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });
  }
  if (!clauses.length) return [];

  const filter = { companyId, $or: clauses };
  if (excludeId) filter._id = { $ne: excludeId };
  return Party.find(filter)
    .select('code name legalName phone email status roles taxProfile.taxId')
    .sort({ status: 1, name: 1 })
    .limit(10)
    .lean();
}
