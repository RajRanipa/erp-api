import 'dotenv/config';
import mongoose from 'mongoose';
import { syncPermissionCatalog } from '../services/accessControlService.js';

const mongoUri = process.env.MONGO_URI
  || process.env.MONGODB_URI
  || 'mongodb://127.0.0.1:27017/orient-erp';

try {
  await mongoose.connect(mongoUri, { autoIndex: true });
  const count = await syncPermissionCatalog();
  console.log(JSON.stringify({ status: 'ok', permissionDefinitions: count }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

