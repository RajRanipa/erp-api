import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const confirmation = process.argv.find(argument => argument.startsWith('--confirm='))?.split('=')[1];
if (confirmation !== 'RESET_TESTING_DATA') {
  console.error('Refusing to reset data. Pass --confirm=RESET_TESTING_DATA.');
  process.exit(1);
}

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('MONGO_URI or MONGODB_URI is required');
  process.exit(1);
}

const resetCollections = Object.freeze([
  'itemmasters',
  'manufacturingrecipes',
  'productionorders',
  'inventorybalances',
  'inventorycostbalances',
  'inventorylots',
  'inventoryserials',
  'inventorytransactions',
  'productionblanketrolls',
  'gatewayingestbatches',
  'goodsreceipts',
  'purchaseorders',
  'purchaseinvoices',
  'purchasereturns',
  'documentsequences',
]);

await mongoose.connect(mongoUri, { autoIndex: false });

try {
  const db = mongoose.connection.db;
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name),
  );
  const deleted = {};
  for (const collectionName of resetCollections) {
    if (!existing.has(collectionName)) {
      deleted[collectionName] = 0;
      continue;
    }
    const result = await db.collection(collectionName).deleteMany({});
    deleted[collectionName] = result.deletedCount;
  }
  console.log(JSON.stringify({
    reset: true,
    deleted,
    preserved: [
      'companies',
      'users',
      'memberships',
      'roles',
      'permissions',
      'warehouses',
      'campaigns',
      'parties',
      'itemclasses',
      'itemattributedefinitions',
      'itemfamilies',
    ],
  }, null, 2));
} finally {
  await mongoose.disconnect();
}
