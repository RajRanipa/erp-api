import 'dotenv/config';
import mongoose from 'mongoose';
import Permission from '../models/Permission.js';

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!mongoUri) throw new Error('MONGO_URI or MONGODB_URI is required');

const assignments = {
  'inventory:transfer': ['owner', 'manager', 'store_operator', 'production_manager'],
  'inventory:reserve': ['owner', 'manager', 'store_operator'],
  'inventory:repack': ['owner', 'manager', 'store_operator', 'production_manager'],
};

await mongoose.connect(mongoUri, { autoIndex: true });
try {
  for (const [key, roles] of Object.entries(assignments)) {
    await Permission.updateOne(
      { key },
      {
        $setOnInsert: { key },
        $addToSet: { roles: { $each: roles } },
      },
      { upsert: true },
    );
  }
  console.log('Inventory permissions seeded without changing unrelated access');
} finally {
  await mongoose.disconnect();
}
