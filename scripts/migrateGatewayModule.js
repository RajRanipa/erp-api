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
  const productTypes = mongoose.connection.collection("producttypes");
  const categories = mongoose.connection.collection("categories");
  const items = mongoose.connection.collection("items");
  const missingStatus = {
    inventoryStatus: { $exists: false },
  };
  const legacyEtNotApplicable = {
    inventoryPosted: { $ne: true },
    productCode: 5,
    inventoryStatus: "NOT_APPLICABLE",
  };
  const [missingStatusCount, etRequeueCount] = await Promise.all([
    rolls.countDocuments(missingStatus),
    rolls.countDocuments(legacyEtNotApplicable),
  ]);
  const scanned = missingStatusCount + etRequeueCount;
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
    etRequeued: etRequeueCount,
  };
  planned.pending =
    missingStatusCount
    - planned.posted
    - planned.notApplicable;

  const result = {
    mode: apply ? "APPLY" : "AUDIT",
    scanned,
    planned,
    updated: 0,
  };

  const etProductType = await productTypes.findOne(
    { name: "et" },
    { projection: { name: 1, categories: 1 } },
  );
  const etCategoryIds = etProductType?.categories || [];
  const etCategories = etCategoryIds.length
    ? await categories.find(
      { _id: { $in: etCategoryIds } },
      { projection: { name: 1 } },
    ).toArray()
    : [];
  const configuredCompanyId = process.env.GATEWAY_COMPANY_ID;
  const etItemFilter = {
    productType: etProductType?._id || null,
    category: { $in: etCategoryIds },
    status: "active",
  };
  if (configuredCompanyId && mongoose.isValidObjectId(configuredCompanyId)) {
    etItemFilter.companyId = new mongoose.Types.ObjectId(configuredCompanyId);
  }
  const etItems = etProductType
    ? await items.find(
      etItemFilter,
      {
        projection: {
          name: 1,
          sku: 1,
          category: 1,
          categoryKey: 1,
          UOM: 1,
          temperature: 1,
        },
      },
    ).toArray()
    : [];
  result.etConfiguration = {
    productTypeId: etProductType?._id || null,
    categories: etCategories.map(category => ({
      id: category._id,
      name: category.name,
    })),
    activeMatchingItems: etItems,
    ready:
      Boolean(etProductType)
      && etCategories.some(category => category.name === "non-conformance")
      && etItems.some(item => item.categoryKey === "NC"),
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
    const etRequeued = await rolls.updateMany(
      legacyEtNotApplicable,
      {
        $set: {
          inventoryStatus: "PENDING",
          inventoryLastError: "Queued for category-driven ET inventory reconciliation",
        },
      }
    );
    result.updated =
      posted.modifiedCount
      + notApplicable.modifiedCount
      + pending.modifiedCount
      + etRequeued.modifiedCount;

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
