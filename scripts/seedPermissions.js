// seedPermissions.js (run once)
import 'dotenv/config';
import mongoose from 'mongoose';
import Permission from '../models/Permission.js';


const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/orient-erp';

try {
  await mongoose.connect(MONGO_URI, { autoIndex: true });
  console.log('✅ Connected to MongoDB:', MONGO_URI);
} catch (err) {
  console.error('❌ Failed to connect to MongoDB:', err.message);
  process.exit(1);
}

const all = [
  // owner (full) — you can tag owner on every permission or treat owner as bypass
  'campaigns:full','users:full','items:full','inventory:full','settings:full','categories:full',
  'parameters:full','producttypes:full','campaigns:full','rawmaterials:full','rawmterials:full',
  'batches:full','parties:full','dashboard:full','manufacturing:full','crm:full','warehouses:full',

  // granular
  'items:read','items:create','items:update','items:status:update',
  'inventory:read','inventory:receipt','inventory:issue','inventory:adjust','inventory:repack',
  'users:invite:read','users:read','users:invite:create','users:invite:resend','users:invite:revoke','users:remove',
  'warehouses:read','warehouses:update','warehouses:create','warehouses:delete',
  'reports:view','transactions:approve'
];

for (const key of all) {
  await Permission.updateOne(
    { key },
    { $setOnInsert: { key } },
    { upsert: true }
  );
}

console.log('Seeded permission keys');

// tag roles for each permission
await Permission.updateMany({}, { $pull: { roles: { $in: ['owner','manager','store_operator','production_manager','accountant','investor'] } } });

// owner gets everything
await Permission.updateMany({}, { $addToSet: { roles: 'owner' } });

// manager
await Permission.updateMany({ key: { $in: [
  'items:read','items:create','items:update','items:status:update',
  'inventory:read','inventory:receipt','inventory:repack',
  'users:invite:read','users:read','users:invite:create','users:invite:resend','users:invite:revoke','users:remove',
  'warehouses:read','warehouses:update','warehouses:create','warehouses:delete'
]}}, { $addToSet: { roles: 'manager' } });

// store_operator
await Permission.updateMany({ key: { $in: [
  'items:read','items:create','items:update',
  'inventory:read','inventory:receipt','inventory:issue','inventory:adjust','inventory:repack',
  'users:invite:read','users:invite:resend',
  'warehouses:read','warehouses:update','warehouses:create','warehouses:delete'
]}}, { $addToSet: { roles: 'store_operator' } });

// production_manager
await Permission.updateMany({ key: { $in: [
  'items:read','items:create','items:update',
  'inventory:read','inventory:receipt','inventory:repack','inventory:adjust',
  'warehouses:read','warehouses:update','warehouses:create','warehouses:delete'
]}}, { $addToSet: { roles: 'production_manager' } });

// accountant
await Permission.updateMany({ key: { $in: [
  'reports:view','transactions:approve','inventory:issue'
]}}, { $addToSet: { roles: 'accountant' } });

// investor
await Permission.updateMany({ key: { $in: [
  'items:read','inventory:read','users:read'
]}}, { $addToSet: { roles: 'investor' } });


try {
  await mongoose.disconnect();
  console.log('🔌 Disconnected');
} catch (e) {
  console.warn('Disconnect warning:', e?.message);
}
