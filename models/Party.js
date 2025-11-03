import mongoose, { Schema } from 'mongoose';

const AddressSchema = new Schema({
  label: { type: String, trim: true },              // Billing / Shipping / HQ
  line1: { type: String, required: true, trim: true },
  line2: { type: String, trim: true },
  city: { type: String, trim: true },
  state: { type: String, trim: true },              // e.g. "Gujarat"
  stateCode: { type: String, trim: true },          // e.g. "24"
  country: { type: String, default: 'IN' },
  pincode: { type: String, trim: true },
  isDefaultBilling: { type: Boolean, default: false },
  isDefaultShipping: { type: Boolean, default: false }
}, { _id: false });

const ContactSchema = new Schema({
  name: { type: String, trim: true },
  email: { type: String, trim: true },
  phone: { type: String, trim: true },
  role: { type: String, trim: true },               // Owner / Accounts / Purchase / Sales
  isPrimary: { type: Boolean, default: false }
}, { _id: false });

const BankSchema = new Schema({
  holderName: { type: String, trim: true },
  ifsc: { type: String, trim: true },
  accountNo: { type: String, trim: true },          // store encrypted if possible
  branch: { type: String, trim: true }
}, { _id: false });

const CreditSchema = new Schema({
  currency: { type: String, default: 'INR' },
  paymentTerm: { type: String, default: 'NET30' },  // your code, not text
  creditLimit: { type: Number, default: 0, min: 0 },
  onHold: { type: Boolean, default: false },        // block SO confirmation if true
}, { _id: false });

const TaxSchema = new Schema({
  gstin: { type: String, trim: true },              // 15 chars
  pan: { type: String, trim: true },
  placeOfSupply: { type: String, trim: true },      // state code
}, { _id: false });

const PartySchema = new Schema({
  code: { type: String, unique: true, sparse: true, trim: true }, // optional human code
  legalName: { type: String, required: true, trim: true },
  displayName: { type: String, trim: true },
  role: { type: String, enum: ['customer','vendor','both'], required: true },

  contacts: [ContactSchema],
  addresses: [AddressSchema],

  tax: TaxSchema,
  credit: CreditSchema,
  bank: BankSchema,

  email: { type: String, trim: true },              // top-level quick search
  phone: { type: String, trim: true },

  status: { type: String, enum: ['draft','active','archived'], default: 'active' },

  // audit
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Indexes
PartySchema.index({ role: 1, status: 1, 'addresses.state': 1 });
PartySchema.index({ legalName: 'text', displayName: 'text', email: 'text', phone: 'text' });
PartySchema.index({ 'tax.gstin': 1 }, { unique: true, partialFilterExpression: { 'tax.gstin': { $type: 'string' } } });
PartySchema.index({ email: 1 }, { partialFilterExpression: { email: { $type: 'string' } } });
PartySchema.index({ phone: 1 }, { partialFilterExpression: { phone: { $type: 'string' } } });

export default mongoose.model('Party', PartySchema);