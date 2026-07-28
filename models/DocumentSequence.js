import mongoose from 'mongoose';

const { Schema } = mongoose;

const DocumentSequenceSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    immutable: true,
  },
  type: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 40,
  },
  year: {
    type: Number,
    required: true,
    min: 2000,
    max: 9999,
  },
  value: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
}, {
  timestamps: true,
  versionKey: false,
});

DocumentSequenceSchema.index(
  { companyId: 1, type: 1, year: 1 },
  { unique: true, name: 'uniq_company_document_sequence' },
);

export default mongoose.model('DocumentSequence', DocumentSequenceSchema);
