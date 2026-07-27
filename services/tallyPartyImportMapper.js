import { PARTY_ROLES } from '../models/Party.js';

const TALLY_NAME_HEADER = '$name';
const TALLY_PARENT_HEADER = '$parent';
const PLACEHOLDER_VALUE = '12';

const asText = value => String(value ?? '').trim();
const normalizedHeader = value => asText(value).replace(/^\uFEFF/, '').toLowerCase();

function rowGetter(row = {}) {
  const values = new Map(
    Object.entries(row).map(([key, value]) => [normalizedHeader(key), value]),
  );
  return name => values.get(normalizedHeader(name)) ?? '';
}

function cleanPlaceholder(value) {
  const text = asText(value);
  return text === PLACEHOLDER_VALUE ? '' : text;
}

function cleanAddressPart(value) {
  return cleanPlaceholder(value)
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
}

function roleForParent(parent) {
  const normalized = asText(parent).toLowerCase();
  if (
    normalized.includes('sundry debtor')
    || normalized === 'debtor'
    || normalized === 'customer'
  ) {
    return PARTY_ROLES.CUSTOMER;
  }
  if (
    normalized.includes('sundry creditor')
    || normalized === 'creditor'
    || normalized === 'vendor'
    || normalized === 'supplier'
  ) {
    return PARTY_ROLES.SUPPLIER;
  }
  return null;
}

export function isTallyPartyExport(headers = []) {
  const normalized = new Set((headers || []).map(normalizedHeader));
  return normalized.has(TALLY_NAME_HEADER)
    && normalized.has(TALLY_PARENT_HEADER)
    && (
      normalized.has('$partygstin')
      || normalized.has('$ledgermobile')
      || normalized.has('$_address1')
    );
}

export function isTallyPlaceholderRow(row = {}) {
  const cell = rowGetter(row);
  const name = asText(cell('$Name'));
  const parent = asText(cell('$Parent'));
  const populated = Object.values(row)
    .map(asText)
    .filter(Boolean);
  if (!name && !parent && populated.length === 0) return true;
  if (name !== PLACEHOLDER_VALUE || parent !== PLACEHOLDER_VALUE) return false;
  return populated.length > 0
    && populated.every(value => value === PLACEHOLDER_VALUE);
}

export function mapTallyPartyRow(row = {}) {
  const cell = rowGetter(row);
  const name = cleanPlaceholder(cell('$Name'));
  const parent = cleanPlaceholder(cell('$Parent'));
  if (!name) {
    throw new Error('Tally ledger name is missing');
  }

  const role = roleForParent(parent);
  if (!role) {
    throw new Error(
      `Unsupported Tally party group "${parent || 'blank'}"; expected Sundry Debtors or Sundry Creditors`,
    );
  }

  const addressParts = [1, 2, 3, 4, 5]
    .map(index => cleanAddressPart(cell(`$_Address${index}`)))
    .filter(Boolean);
  const hasCityCandidate = addressParts.length >= 3;
  const city = hasCityCandidate ? addressParts.at(-1) : '';
  const line2Parts = hasCityCandidate
    ? addressParts.slice(1, -1)
    : addressParts.slice(1);

  const state = cleanPlaceholder(cell('$LedStateName'));
  const gstin = cleanPlaceholder(cell('$PartyGSTIN')).toUpperCase();

  return {
    Code: '',
    Name: name,
    LegalName: name,
    PartyType: 'BUSINESS',
    Roles: role,
    Status: 'active',
    LifecycleStage: 'ACTIVE',
    Priority: 'NORMAL',
    Phone: cleanPlaceholder(cell('$LedgerMobile')),
    Email: cleanPlaceholder(cell('$EMAIL')).toLowerCase(),
    TaxRegistered: gstin ? 'YES' : 'NO',
    TaxIdType: 'GSTIN',
    TaxId: gstin,
    GSTRegistrationType: gstin ? 'REGULAR' : 'UNREGISTERED',
    PlaceOfSupply: state,
    AddressLine1: addressParts[0] || '',
    AddressLine2: line2Parts.join(', '),
    City: city,
    State: state,
    Country: 'India',
    Pincode: cleanPlaceholder(cell('$PinCode')),
    PaymentTermType: 'NET_DAYS',
    NetDays: 30,
    Currency: 'INR',
    CreditLimit: 0,
    __mergeRoles: true,
    __importMeta: {
      tally: {
        sourceFormat: 'TALLY_XLSX',
        parentGroup: parent,
      },
    },
  };
}
