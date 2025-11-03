// backend-api/models/Company.js
import mongoose from 'mongoose';

const companySchema = new mongoose.Schema({
  companyName: { type: String, required: true, trim: true },
  industry: { type: String, trim: true , required: true},
  email: {type: String, trim: true, required: true},
  phone: {type: Number, trim: true, required: true},
  workspaceName: { type: String, trim: true },
  enabledModules: { type: [String], default: [] },
  isSetupCompleted: { type: Boolean, default: false },
  setupStepCompleted: { type: Number, default: 0 },
  setupProgress: {
    companyBasics: { type: Boolean, default: false },
    address: { type: Boolean, default: false },
    taxInfo: { type: Boolean, default: false },
    localization: { type: Boolean, default: false },
    logo:{ type: Boolean, default: false },
    modules:{ type: Boolean, default: false },
  },
  address: {
    street:    { type: String, default: '', required: function() { return this.isSetupCompleted || this.setupProgress?.address === true; } },
    city:      { type: String, default: '', required: function() { return this.isSetupCompleted || this.setupProgress?.address === true; } },
    state:     { type: String, default: '', required: function() { return this.isSetupCompleted || this.setupProgress?.address === true; } },
    country:   { type: String, default: '', required: function() { return this.isSetupCompleted || this.setupProgress?.address === true; } },
    postalCode:{ type: String, default: '', required: function() { return this.isSetupCompleted || this.setupProgress?.address === true; } },
  },
  taxInfo: {
    gstNumber: { type: String, default: '', required: function() { return this.isSetupCompleted || this.setupProgress?.taxInfo === true; } },
    panNumber: { type: String, default: '', required: function() { return this.isSetupCompleted || this.setupProgress?.taxInfo === true; } },
    taxRegion: { type: String, default: '' },
  },
  currency: { type: String, required: true, default: 'USD' },
  timezone: { type: String, default: 'UTC' },
  dateFormat: { type: String, default: 'DD/MM/YYYY' },
  fiscalYearStart: { type: String, default: 'April' },
  logoUrl: { type: String },
}, {
  timestamps: true,
});

const Company = mongoose.model('Company', companySchema);

export default Company;