// backend-api/models/Party.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

export const PARTY_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
};

export const PARTY_TYPE = {
  BUSINESS: 'BUSINESS',
  INDIVIDUAL: 'INDIVIDUAL',
};

export const PARTY_ROLES = {
  SUPPLIER: 'SUPPLIER',
  CUSTOMER: 'CUSTOMER',
  TRANSPORTER: 'TRANSPORTER',
  JOBWORKER: 'JOBWORKER',
  BROKER: 'BROKER',
  OTHER: 'OTHER',
};

export const ADDRESS_PURPOSES = {
  BILLING: 'billing',
  SHIPPING: 'shipping',
  MAILING: 'mailing',
  REGISTERED: 'registered',
  OFFICE: 'office',
  WAREHOUSE: 'warehouse',
  FACTORY: 'factory',
  OTHER: 'other',
};

const AddressSchema = new Schema(
  {
    label: { type: String, trim: true, default: 'Office' }, // Office / Billing / Shipping / Warehouse / Factory etc.

    // Purposes drive defaults (no boolean default flags stored)
    // Example: ['billing'], ['shipping'], ['billing','shipping']
    purposes: {
      type: [String],
      enum: Object.values(ADDRESS_PURPOSES),
      default: [],
      index: true,
    },

    line1: { type: String, trim: true, default: '' },
    line2: { type: String, trim: true, default: '' },
    landmark: { type: String, trim: true, default: '' },
    area: { type: String, trim: true, default: '' },

    city: { type: String, trim: true, default: '' },
    district: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: 'India' },

    // Universal postal/zip code
    pincode: { type: String, trim: true, default: '' },

    // Future: maps integration
    placeId: { type: String, trim: true, default: '' },

    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const ContactPersonSchema = new Schema(
  {
    name: { type: String, trim: true, default: '' },
    designation: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false }
);

const PartyAddressesSchema = new Schema(
  {
    // Primary address is the inline form (always present as an object)
    primaryAddress: { type: AddressSchema, default: () => ({ label: 'Office' }) },

    // Additional addresses are optional (Billing/Shipping/Mailing/etc.)
    additionalAddresses: { type: [AddressSchema], default: [] },
  },
  { _id: false }
);

const TaxProfileSchema = new Schema(
  {
    // Generic (works for GST/VAT/etc.)
    isTaxRegistered: { type: Boolean, default: false },

    // India GST/VAT id (optional)
    taxId: { type: String, trim: true, uppercase: true, default: null }, // GSTIN/VAT

    // India-specific extras (optional)
    pan: { type: String, trim: true, uppercase: true, default: null },

    // Useful later for GST logic
    placeOfSupply: { type: String, trim: true, default: '' }, // e.g., "Gujarat"
  },
  { _id: false }
);

const PaymentTermsSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['DUE_ON_RECEIPT', 'NET_DAYS', 'CUSTOM'],
      default: 'NET_DAYS',
    },
    netDays: { type: Number, default: 30, min: 0 },
    note: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const PartySchema = new Schema(
  {
    // Tenant / company isolation (MANDATORY)
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },

    // Core identity
    name: { type: String, required: true, trim: true },
    legalName: { type: String, trim: true, default: '' },

    partyType: { type: String, enum: Object.values(PARTY_TYPE), default: PARTY_TYPE.BUSINESS },

    // ✅ Hybrid design: one master; multiple roles
    roles: {
      type: [String],
      enum: Object.values(PARTY_ROLES),
      default: [],
      index: true,
    },

    status: { type: String, enum: Object.values(PARTY_STATUS), default: PARTY_STATUS.ACTIVE, index: true },

    // Communication
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    website: { type: String, trim: true, default: '' },

    tags: [{ type: String, trim: true }], // optional

    // Addresses / Contacts (embedded)
    addresses: { type: PartyAddressesSchema, default: () => ({}) },
    contacts: { type: [ContactPersonSchema], default: [] },

    // Tax + finance defaults
    taxProfile: { type: TaxProfileSchema, default: () => ({}) },
    paymentTerms: { type: PaymentTermsSchema, default: () => ({}) },

    currency: { type: String, trim: true, default: 'INR' },
    creditLimit: { type: Number, default: 0, min: 0 },
    openingBalance: { type: Number, default: 0 }, // optional (use later in accounting)

    notes: { type: String, trim: true, default: '' },

    // ✅ Industry extensions
    // meta: free-form internal extensions (per party)
    meta: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },

    // customFields: structured per-tenant fields (later you can validate keys)
    customFields: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },

    // Audit
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// ---------- Indexes (enterprise-friendly) ----------

// Fast list/search by name within company
PartySchema.index({ companyId: 1, name: 1 });

// Common filters (supplier/customer lists)
PartySchema.index({ companyId: 1, roles: 1, status: 1 });

// Optional: fast search by phone/email
PartySchema.index({ companyId: 1, phone: 1 });
PartySchema.index({ companyId: 1, email: 1 });

// Helpful when filtering parties by whether they have billing/shipping addresses
PartySchema.index({ companyId: 1, 'addresses.additionalAddresses.purposes': 1 });

// ✅ Prevent duplicates when GSTIN/VAT is present (per company)
// Partial unique: only applies when taxProfile.taxId exists and not empty
PartySchema.index(
  { companyId: 1, 'taxProfile.taxId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'taxProfile.taxId': { $type: 'string', $ne: '' } },
    name: 'uniq_company_taxId',
  }
);

// ---------- Helpers ----------

// normalize roles: ensure unique values
PartySchema.pre('validate', function normalizeRoles(next) {
  if (Array.isArray(this.roles)) {
    this.roles = Array.from(new Set(this.roles.map((r) => String(r).trim()).filter(Boolean)));
  }
  next();
});

// Backward compatibility: if client sends `addresses` as an array (old format), convert it.
PartySchema.pre('validate', function migrateOldAddresses(next) {
  if (Array.isArray(this.addresses)) {
    const arr = this.addresses;

    // Pick the first address as primary; map pincode -> pincode
    const first = arr[0] || {};
    const primary = {
      label: first.label || 'Office',
      line1: first.line1 || '',
      line2: first.line2 || '',
      city: first.city || '',
      state: first.state || '',
      country: first.country || 'India',
      pincode: first.pincode || first.pincode || '',
      purposes: [],
      isActive: true,
    };

    // Convert remaining as additional, translating default flags into purposes
    const additional = (arr.slice(1) || []).map((a) => {
      const purposes = [];
      if (a?.isDefaultBilling) purposes.push(ADDRESS_PURPOSES.BILLING);
      if (a?.isDefaultShipping) purposes.push(ADDRESS_PURPOSES.SHIPPING);

      return {
        label: a?.label || 'Office',
        line1: a?.line1 || '',
        line2: a?.line2 || '',
        city: a?.city || '',
        state: a?.state || '',
        country: a?.country || 'India',
        pincode: a?.pincode || a?.pincode || '',
        purposes,
        isActive: true,
      };
    });

    this.addresses = { primaryAddress: primary, additionalAddresses: additional };
  }

  next();
});

// Normalize address purposes + enforce at-most-one billing/shipping purpose across additional addresses.
PartySchema.pre('validate', function normalizeAddressPurposes(next) {
  const addrs = this.addresses || {};
  const primary = addrs.primaryAddress || {};
  const extra = Array.isArray(addrs.additionalAddresses) ? addrs.additionalAddresses : [];

  // helper to normalize purposes array
  const normPurposes = (arr) =>
    Array.from(new Set((arr || []).map((p) => String(p).trim().toLowerCase()).filter(Boolean)));

  // Normalize primary purposes (usually empty; allow but keep clean)
  if (primary && typeof primary === 'object') {
    primary.purposes = normPurposes(primary.purposes);
  }

  // Enforce uniqueness for billing/shipping across additionalAddresses
  let seenBilling = false;
  let seenShipping = false;

  const nextExtra = extra.map((a) => {
    const addr = a?.toObject?.() ? a.toObject() : { ...(a || {}) };
    addr.purposes = normPurposes(addr.purposes);

    if (addr.purposes.includes(ADDRESS_PURPOSES.BILLING)) {
      if (seenBilling) {
        addr.purposes = addr.purposes.filter((p) => p !== ADDRESS_PURPOSES.BILLING);
      } else {
        seenBilling = true;
      }
    }

    if (addr.purposes.includes(ADDRESS_PURPOSES.SHIPPING)) {
      if (seenShipping) {
        addr.purposes = addr.purposes.filter((p) => p !== ADDRESS_PURPOSES.SHIPPING);
      } else {
        seenShipping = true;
      }
    }

    return addr;
  });

  // Write back normalized structure
  this.addresses = {
    primaryAddress: primary,
    additionalAddresses: nextExtra,
  };

  next();
});

export default mongoose.model('Party', PartySchema);