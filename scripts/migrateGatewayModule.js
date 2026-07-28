import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const apply = process.argv.includes("--apply");
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!mongoUri) {
  console.error("MONGO_URI or MONGODB_URI is required");
  process.exit(1);
}

await mongoose.connect(mongoUri, { autoIndex: false });

try {
  const rolls = mongoose.connection.collection("productionblanketrolls");
  const batches = mongoose.connection.collection("gatewayingestbatches");
  const missingStatus = {
    inventoryStatus: { $exists: false },
  };
  const scanned = await rolls.countDocuments(missingStatus);
  const planned = {
    posted: await rolls.countDocuments({
      ...missingStatus,
      inventoryPosted: true,
    }),
    notApplicable: await rolls.countDocuments({
      ...missingStatus,
      inventoryPosted: { $ne: true },
      productCode: { $ne: 5 },
      statusOk: false,
    }),
  };
  planned.pending = scanned - planned.posted - planned.notApplicable;

  const result = {
    mode: apply ? "APPLY" : "AUDIT",
    scanned,
    planned,
    updated: 0,
  };

  if (apply) {
    const posted = await rolls.updateMany(
      { ...missingStatus, inventoryPosted: true },
      { $set: { inventoryStatus: "POSTED" } }
    );
    const notApplicable = await rolls.updateMany(
      {
        ...missingStatus,
        inventoryPosted: { $ne: true },
        productCode: { $ne: 5 },
        statusOk: false,
      },
      { $set: { inventoryStatus: "NOT_APPLICABLE" } }
    );
    const pending = await rolls.updateMany(
      missingStatus,
      { $set: { inventoryStatus: "PENDING" } }
    );
    result.updated =
      posted.modifiedCount
      + notApplicable.modifiedCount
      + pending.modifiedCount;

    await rolls.createIndex(
      { inventoryPosted: 1, inventoryStatus: 1, at: 1 },
      { name: "idx_gateway_inventory_reconcile" }
    );
    await batches.createIndex(
      { companyId: 1, gatewayId: 1, clientBatchId: 1 },
      {
        name: "idx_gateway_client_batch",
        partialFilterExpression: { clientBatchId: { $type: "string" } },
      }
    );
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  await mongoose.disconnect();
}

