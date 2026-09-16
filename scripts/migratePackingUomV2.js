import dotenv from 'dotenv';
import mongoose from 'mongoose';
import InventoryBalanceV2 from '../models/InventoryBalanceV2.js';
import InventoryTransactionV2 from '../models/InventoryTransactionV2.js';
import ItemClass from '../models/ItemClass.js';
import ItemFamily from '../models/ItemFamily.js';
import ItemMaster from '../models/ItemMaster.js';

dotenv.config();

const apply = process.argv.includes('--apply');
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('MONGO_URI or MONGODB_URI is required');
  process.exit(1);
}

await mongoose.connect(mongoUri, { autoIndex: false });

try {
  const packagingClasses = await ItemClass.find({ code: 'PACKAGING' })
    .select('_id companyId')
    .lean();
  const packagingClassIds = packagingClasses.map(entry => entry._id);
  const families = packagingClassIds.length
    ? await ItemFamily.find({ itemClassId: { $in: packagingClassIds } })
      .select('_id companyId code name uomPolicy')
      .lean()
    : [];
  const items = packagingClassIds.length
    ? await ItemMaster.find({ itemClassId: { $in: packagingClassIds } })
      .select('_id companyId sku name baseUom catchUom catchMode nominalFactor status')
      .lean()
    : [];

  const itemIds = items.map(entry => entry._id);
  const [transactionItemIds, balanceItemIds] = itemIds.length
    ? await Promise.all([
      InventoryTransactionV2.distinct('entries.itemId', {
        'entries.itemId': { $in: itemIds },
      }),
      InventoryBalanceV2.distinct('itemId', {
        itemId: { $in: itemIds },
        $or: [
          { onHand: { $ne: 0 } },
          { reserved: { $ne: 0 } },
          { catchOnHand: { $nin: [null, 0] } },
        ],
      }),
    ])
    : [[], []];
  const transactionItems = new Set(transactionItemIds.map(String));
  const balanceItems = new Set(balanceItemIds.map(String));

  const report = {
    mode: apply ? 'APPLY' : 'AUDIT',
    packagingClasses: packagingClasses.length,
    familiesScanned: families.length,
    familyUpdatesPlanned: 0,
    familiesUpdated: 0,
    itemsScanned: items.length,
    itemUpdatesPlanned: 0,
    itemsUpdated: 0,
    blockers: [],
  };

  const standardUom = {
    baseUom: 'nos',
    catchUom: null,
    catchMode: 'NONE',
    nominalFactor: null,
  };

  for (const family of families) {
    const alreadyStandard = family.uomPolicy?.baseUom === standardUom.baseUom
      && !family.uomPolicy?.catchUom
      && family.uomPolicy?.catchMode === standardUom.catchMode
      && family.uomPolicy?.nominalFactor == null;
    if (alreadyStandard) continue;
    report.familyUpdatesPlanned++;
    if (!apply) continue;
    await ItemFamily.updateOne(
      { _id: family._id },
      { $set: { uomPolicy: standardUom } },
    );
    report.familiesUpdated++;
  }

  for (const item of items) {
    const alreadyStandard = item.baseUom === standardUom.baseUom
      && !item.catchUom
      && item.catchMode === standardUom.catchMode
      && item.nominalFactor == null;
    if (alreadyStandard) continue;

    const hasTransactions = transactionItems.has(String(item._id));
    const hasStock = balanceItems.has(String(item._id));
    if (hasTransactions || hasStock) {
      report.blockers.push({
        itemId: item._id,
        sku: item.sku,
        name: item.name,
        currentUom: item.baseUom,
        reason: hasTransactions
          ? 'Inventory V2 transaction history exists; historical quantities cannot be reinterpreted safely'
          : 'A non-zero Inventory V2 balance exists; clear it through posted transactions first',
      });
      continue;
    }

    report.itemUpdatesPlanned++;
    if (!apply) continue;
    await ItemMaster.updateOne(
      { _id: item._id },
      { $set: standardUom },
    );
    report.itemsUpdated++;
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await mongoose.disconnect();
}
