import mongoose from 'mongoose';

const { Schema } = mongoose;

export const PARTY_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  BLOCKED: 'blocked',
  ARCHIVED: 'archived',
});

export const PARTY_TYPE = Object.freeze({
  BUSINESS: 'BUSINESS',
  INDIVIDUAL: 'INDIVIDUAL',
});

export const PARTY_ROLES = Object.freeze({
  SUPPLIER: 'SUPPLIER',
  CUSTOMER: 'CUSTOMER',
  TRANSPORTER: 'TRANSPORTER',
  JOBWORKER: 'JOBWORKER',
  BROKER: 'BROKER',
  SERVICE_PROVIDER: 'SERVICE_PROVIDER',
  OTHER: 'OTHER',
});

export const PARTY_LIFECYCLE = Object.freeze({
  PROSPECT: 'PROSPECT',
  ONBOARDING: 'ONBOARDING',
  ACTIVE: 'ACTIVE',
  DORMANT: 'DORMANT',
  LOST: 'LOST',
});

export const PARTY_PRIORITY = Object.freeze({
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  STRATEGIC: 'STRATEGIC',
});

export const ADDRESS_PURPOSES = Object.freeze({
  BILLING: 'billing',
  SHIPPING: 'shipping',
  MAILING: 'mailing',
  REGISTERED: 'registered',
  OFFICE: 'office',
  WAREHOUSE: 'warehouse',
  FACTORY: 'factory',
  OTHER: 'other',
});

export const PREFERRED_CHANNELS = Object.freeze({
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  WHATSAPP: 'WHATSAPP',
  SMS: 'SMS',
  NONE: 'NONE',
});

const trimmedString = (maxlength, defaultValue = '') => ({
  type: String,
  trim: true,
  maxlength,
  default: defaultValue,
});

const AddressSchema = new Schema({
  label: trimmedString(80, 'Office'),
  purposes: {
    type: [String],
    enum: Object.values(ADDRESS_PURPOSES),
    default: [],
  },
  line1: trimmedString(240),
  line2: trimmedString(240),
  landmark: trimmedString(160),
  area: trimmedString(120),
  city: trimmedString(100),
  district: trimmedString(100),
  state: trimmedString(100),
  country: trimmedString(100, 'India'),
  pincode: trimmedString(24),
  placeId: trimmedString(180),
  isActive: { type: Boolean, default: true },
  notes: trimmedString(500),
}, { _id: true });

const PartyAddressesSchema = new Schema({
  primaryAddress: {
    type: AddressSchema,
    default: () => ({ label: 'Office', purposes: ['registered'] }),
  },
  additionalAddresses: {
    type: [AddressSchema],
    default: [],
    validate: {
      validator: value => value.length <= 50,
      message: 'A business partner cannot have more than 50 additional addresses',
    },
  },
}, { _id: false });

const ContactPersonSchema = new Schema({
  name: trimmedString(140),
  designation: trimmedString(100),
  department: trimmedString(100),
  phone: trimmedString(30),
  alternatePhone: trimmedString(30),
  email: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 254,
    default: '',
  },
  preferredChannel: {
    type: String,
    enum: Object.values(PREFERRED_CHANNELS),
    default: PREFERRED_CHANNELS.EMAIL,
  },
  isPrimary: { type: Boolean, default: false },
  isDecisionMaker: { type: Boolean, default: false },
  receivesInvoices: { type: Boolean, default: false },
  receivesOrders: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  notes: trimmedString(500),
}, { _id: true });

const TaxProfileSchema = new Schema({
  isTaxRegistered: { type: Boolean, default: false },
  taxIdType: {
    type: String,
    enum: ['GSTIN', 'VAT', 'EIN', 'OTHER'],
    default: 'GSTIN',
  },
  taxId: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 40,
    default: null,
  },
  pan: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 20,
    default: null,
  },
  gstRegistrationType: {
    type: String,
    enum: ['REGULAR', 'COMPOSITION', 'SEZ', 'UNREGISTERED', 'OVERSEAS', 'OTHER'],
    default: 'UNREGISTERED',
  },
  registrationNumber: trimmedString(80),
  cin: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 32,
    default: '',
  },
  msmeNumber: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 40,
    default: '',
  },
  placeOfSupply: trimmedString(100),
}, { _id: false });

const PaymentTermsSchema = new Schema({
  type: {
    type: String,
    enum: ['DUE_ON_RECEIPT', 'NET_DAYS', 'CUSTOM'],
    default: 'NET_DAYS',
  },
  netDays: { type: Number, default: 30, min: 0, max: 3650 },
  note: trimmedString(500),
}, { _id: false });

const CommunicationPreferencesSchema = new Schema({
  preferredChannel: {
    type: String,
    enum: Object.values(PREFERRED_CHANNELS),
    default: PREFERRED_CHANNELS.EMAIL,
  },
  doNotContact: { type: Boolean, default: false },
  marketingOptIn: { type: Boolean, default: false },
  whatsappOptIn: { type: Boolean, default: false },
}, { _id: false });

const BankAccountSchema = new Schema({
  accountHolderName: trimmedString(160),
  bankName: trimmedString(140),
  accountNumber: trimmedString(50),
  ifscCode: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 20,
    default: '',
  },
  swiftCode: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 20,
    default: '',
  },
  branch: trimmedString(120),
  accountType: {
    type: String,
    enum: ['CURRENT', 'SAVINGS', 'CASH_CREDIT', 'OTHER'],
    default: 'CURRENT',
  },
  currency: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 3,
    default: 'INR',
  },
  isPrimary: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  verifiedAt: { type: Date, default: null },
}, { _id: true });

function normalizeSearchPart(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildPartySearchPrefixes(party) {
  const contacts = Array.isArray(party?.contacts) ? party.contacts : [];
  const source = [
    party?.code,
    party?.name,
    party?.legalName,
    party?.phone,
    party?.alternatePhone,
    party?.email,
    party?.website,
    party?.taxProfile?.taxId,
    party?.taxProfile?.pan,
    party?.taxProfile?.registrationNumber,
    party?.taxProfile?.cin,
    party?.taxProfile?.msmeNumber,
    ...(party?.tags || []),
    ...contacts.flatMap(contact => [
      contact?.name,
      contact?.designation,
      contact?.department,
      contact?.phone,
      contact?.email,
    ]),
  ];

  const words = new Set(
    source
      .map(normalizeSearchPart)
      .flatMap(value => value.split(/\s+/))
      .filter(Boolean),
  );
  const prefixes = new Set();
  for (const word of words) {
    const upperBound = Math.min(word.length, 32);
    for (let size = 2; size <= upperBound; size += 1) {
      prefixes.add(word.slice(0, size));
    }
    if (word.length === 1) prefixes.add(word);
  }
  return [...prefixes].slice(0, 1000);
}

const PartySchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  code: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 40,
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 160,
  },
  legalName: trimmedString(200),
  partyType: {
    type: String,
    enum: Object.values(PARTY_TYPE),
    default: PARTY_TYPE.BUSINESS,
  },
  roles: {
    type: [String],
    enum: Object.values(PARTY_ROLES),
    required: true,
    validate: {
      validator: value => value.length > 0,
      message: 'At least one business partner role is required',
    },
  },
  status: {
    type: String,
    enum: Object.values(PARTY_STATUS),
    default: PARTY_STATUS.ACTIVE,
  },
  lifecycleStage: {
    type: String,
    enum: Object.values(PARTY_LIFECYCLE),
    default: PARTY_LIFECYCLE.ACTIVE,
  },
  priority: {
    type: String,
    enum: Object.values(PARTY_PRIORITY),
    default: PARTY_PRIORITY.NORMAL,
  },
  accountOwner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  leadSource: trimmedString(100),
  industry: trimmedString(120),

  phone: trimmedString(30),
  alternatePhone: trimmedString(30),
  email: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 254,
    default: '',
  },
  website: trimmedString(300),
  communicationPreferences: {
    type: CommunicationPreferencesSchema,
    default: () => ({}),
  },

  tags: {
    type: [{ type: String, trim: true, maxlength: 60 }],
    default: [],
    validate: {
      validator: value => value.length <= 30,
      message: 'A business partner cannot have more than 30 tags',
    },
  },
  addresses: { type: PartyAddressesSchema, default: () => ({}) },
  contacts: {
    type: [ContactPersonSchema],
    default: [],
    validate: {
      validator: value => value.length <= 50,
      message: 'A business partner cannot have more than 50 contacts',
    },
  },
  taxProfile: { type: TaxProfileSchema, default: () => ({}) },
  paymentTerms: { type: PaymentTermsSchema, default: () => ({}) },
  currency: {
    type: String,
    trim: true,
    uppercase: true,
    minlength: 3,
    maxlength: 3,
    default: 'INR',
  },
  creditLimit: { type: Number, default: 0, min: 0 },
  bankAccounts: {
    type: [BankAccountSchema],
    default: [],
    validate: {
      validator: value => value.length <= 20,
      message: 'A business partner cannot have more than 20 bank accounts',
    },
  },

  // Retained only for backward compatibility. Opening balances belong in a
  // journal/accounting module and are deliberately not returned by default.
  openingBalance: { type: Number, default: 0, select: false },
  notes: trimmedString(5000),
  meta: {
    type: Map,
    of: Schema.Types.Mixed,
    default: {},
  },
  customFields: {
    type: Map,
    of: Schema.Types.Mixed,
    default: {},
  },

  archivedAt: { type: Date, default: null },
  archivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  searchPrefixes: { type: [String], default: [], select: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, {
  timestamps: true,
  optimisticConcurrency: true,
  toJSON: {
    transform: (_doc, ret) => {
      delete ret.searchPrefixes;
      delete ret.openingBalance;
      return ret;
    },
  },
});

PartySchema.index(
  { companyId: 1, code: 1 },
  {
    unique: true,
    name: 'uniq_company_party_code',
  },
);
PartySchema.index({ companyId: 1, name: 1, _id: 1 });
PartySchema.index({ companyId: 1, status: 1, name: 1, _id: 1 });
PartySchema.index({ companyId: 1, roles: 1, status: 1, name: 1 });
PartySchema.index({ companyId: 1, lifecycleStage: 1, status: 1, name: 1 });
PartySchema.index({ companyId: 1, accountOwner: 1, status: 1, name: 1 });
PartySchema.index({ companyId: 1, searchPrefixes: 1 });
PartySchema.index({ companyId: 1, phone: 1 });
PartySchema.index({ companyId: 1, email: 1 });
PartySchema.index(
  { companyId: 1, 'taxProfile.taxId': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'taxProfile.taxId': { $type: 'string' },
    },
    name: 'uniq_company_tax_id',
  },
);

PartySchema.pre('validate', function normalizePartyMaster() {
  if (!this.code) {
    this.code = `BP-${String(this._id).slice(-12).toUpperCase()}`;
  }

  this.code = String(this.code).trim().toUpperCase();
  this.roles = [...new Set(
    (this.roles || []).map(value => String(value).trim().toUpperCase()).filter(Boolean),
  )];
  this.tags = [...new Set(
    (this.tags || []).map(value => String(value).trim().toLowerCase()).filter(Boolean),
  )];

  if (this.status === PARTY_STATUS.ARCHIVED) {
    this.archivedAt ||= new Date();
  } else {
    this.archivedAt = null;
    this.archivedBy = null;
  }

  if (Array.isArray(this.contacts)) {
    let primarySeen = false;
    this.contacts.forEach(contact => {
      if (contact.isPrimary && !primarySeen) {
        primarySeen = true;
      } else if (contact.isPrimary) {
        contact.isPrimary = false;
      }
    });
  }

  if (Array.isArray(this.bankAccounts)) {
    let primarySeen = false;
    this.bankAccounts.forEach(account => {
      if (account.isPrimary && !primarySeen) {
        primarySeen = true;
      } else if (account.isPrimary) {
        account.isPrimary = false;
      }
    });
  }

  const primary = this.addresses?.primaryAddress;
  const additional = this.addresses?.additionalAddresses || [];
  const seenPurposes = new Set();
  for (const address of [primary, ...additional].filter(Boolean)) {
    address.purposes = [...new Set(
      (address.purposes || [])
        .map(value => String(value).trim().toLowerCase())
        .filter(value => Object.values(ADDRESS_PURPOSES).includes(value)),
    )].filter(purpose => {
      if (![ADDRESS_PURPOSES.BILLING, ADDRESS_PURPOSES.SHIPPING].includes(purpose)) {
        return true;
      }
      if (seenPurposes.has(purpose)) return false;
      seenPurposes.add(purpose);
      return true;
    });
  }

  if (!this.taxProfile?.isTaxRegistered) {
    this.taxProfile.gstRegistrationType = this.taxProfile.gstRegistrationType === 'OVERSEAS'
      ? 'OVERSEAS'
      : 'UNREGISTERED';
  }
  if (this.taxProfile?.taxId === '') this.taxProfile.taxId = null;
  if (this.taxProfile?.pan === '') this.taxProfile.pan = null;

  this.searchPrefixes = buildPartySearchPrefixes(this);
});

export default mongoose.model('Party', PartySchema);
