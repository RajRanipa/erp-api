import mongoose from 'mongoose';

const ProductType = new mongoose.Schema(
  {
    typeId: {
      type: String,
      unique: true
    },
    name: {
      type: String,
      trim: true,
      unique: true,
      required: true,
      lowercase: true
    }
  },
  { timestamps: true }
);

// Pre-save hook to generate typeId with collision handling on 2 and 3 letters
ProductType.pre('save', async function (next) {
  if (this.isNew || this.isModified('name')) {
    const nameTrimmed = this.name ? this.name.trim().replace(/\s+/g, '') : '';
    if (nameTrimmed.length < 2) {
      return next(new Error('Name must have at least 2 characters to generate typeId.'));
    }
    let baseId = nameTrimmed.substring(0, 2).toUpperCase();
    let typeId = baseId;
    let count = 0;
    // First, try with two letters
    while (await mongoose.models.ProductType.findOne({ typeId })) {
      count += 1;
      if (count === 1 && nameTrimmed.length >= 3) {
        // On first collision, expand to three letters
        baseId = nameTrimmed.substring(0, 3).toUpperCase();
        typeId = baseId;
        // But check if this new baseId is also unique before appending numbers
        if (!(await mongoose.models.ProductType.findOne({ typeId }))) {
          break;
        }
      } else {
        typeId = baseId + count;
      }
    }
    this.typeId = typeId;
  }
  next();
});

export default mongoose.model('ProductType', ProductType);