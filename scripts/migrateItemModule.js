import 'dotenv/config';
import mongoose from 'mongoose';
import { pathToFileURL } from 'url';

export async function migrateItemModule({
  applyChanges = process.argv.includes('--apply'),
  mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI,
} = {}) {

  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required');
  }

  await mongoose.connect(mongoUri, { autoIndex: false });

  try {
    const db = mongoose.connection.db;
    const items = db.collection('items');
    const categories = db.collection('categories');
    const users = db.collection('users');
    const temperatures = db.collection('temperatures');
    const dimensions = db.collection('dimensions');
  
    const categoryDocs = await categories
      .find({})
      .project({ _id: 1, name: 1 })
      .toArray();
    const categoryKeyById = new Map(
      categoryDocs.map(category => {
        const name = String(category.name || '').toLowerCase();
        const categoryKey = {
          'raw material': 'RAW',
          'finished goods': 'FG',
          'packing material': 'PACKING',
          'non-conformance': 'NC',
        }[name];
        return [String(category._id), categoryKey];
      }),
    );
  
    const legacyItems = await items
      .find({
        $or: [
          { companyId: { $exists: false } },
          { companyId: null },
          { categoryKey: { $exists: false } },
          { categoryKey: null },
          { grade: { $exists: false } },
        ],
      })
      .project({
        _id: 1,
        name: 1,
        category: 1,
        categoryKey: 1,
        companyId: 1,
        createdBy: 1,
        updatedBy: 1,
        grade: 1,
      })
      .toArray();
  
    const userIds = [
      ...new Set(
        legacyItems
          .flatMap(item => [item.createdBy, item.updatedBy])
          .filter(Boolean)
          .map(String),
      ),
    ].map(id => new mongoose.Types.ObjectId(id));
    const userDocs = userIds.length
      ? await users
        .find({ _id: { $in: userIds } })
        .project({ _id: 1, companyId: 1 })
        .toArray()
      : [];
    const companyByUserId = new Map(
      userDocs
        .filter(user => user.companyId)
        .map(user => [String(user._id), user.companyId]),
    );
  
    const unresolved = [];
    const operations = [];
  
    for (const item of legacyItems) {
      const update = {};
  
      if (!item.companyId) {
        update.companyId =
          companyByUserId.get(String(item.createdBy || '')) ||
          companyByUserId.get(String(item.updatedBy || '')) ||
          null;
      }
      if (!item.categoryKey) {
        update.categoryKey = categoryKeyById.get(String(item.category)) || null;
      }
      if (item.grade === undefined || item.grade === null) {
        update.grade = '';
      }
  
      if (!update.companyId && !item.companyId) {
        unresolved.push({ id: item._id, name: item.name, field: 'companyId' });
      }
      if (!update.categoryKey && !item.categoryKey) {
        unresolved.push({ id: item._id, name: item.name, field: 'categoryKey' });
      }
  
      const safeUpdate = Object.fromEntries(
        Object.entries(update).filter(([, value]) => value !== null),
      );
      if (Object.keys(safeUpdate).length) {
        operations.push({
          updateOne: {
            filter: { _id: item._id },
            update: { $set: safeUpdate },
          },
        });
      }
    }
  
    // Compute RAW identities after the planned backfill, otherwise two legacy
    // Items can appear conflict-free in audit mode and fail only during apply.
    const allItemIdentities = await items
      .find({})
      .project({
        _id: 1,
        name: 1,
        grade: 1,
        category: 1,
        categoryKey: 1,
        companyId: 1,
        createdBy: 1,
        updatedBy: 1,
      })
      .toArray();
    const rawIdentityGroups = new Map();
    for (const item of allItemIdentities) {
      const categoryKey =
        item.categoryKey ||
        categoryKeyById.get(String(item.category)) ||
        null;
      if (categoryKey !== 'RAW') continue;
  
      const companyId =
        item.companyId ||
        companyByUserId.get(String(item.createdBy || '')) ||
        companyByUserId.get(String(item.updatedBy || '')) ||
        null;
      const identity = JSON.stringify({
        companyId: companyId ? String(companyId) : null,
        name: String(item.name || ''),
        grade: String(item.grade || ''),
      });
      const group = rawIdentityGroups.get(identity) || {
        _id: {
          companyId,
          name: String(item.name || ''),
          grade: String(item.grade || ''),
        },
        count: 0,
        ids: [],
      };
      group.count += 1;
      group.ids.push(item._id);
      rawIdentityGroups.set(identity, group);
    }
    const rawDuplicates = [...rawIdentityGroups.values()]
      .filter(group => group.count > 1);
    const allTemperatures = await temperatures.find({}).toArray();
    const temperatureOperations = [];
    const temperatureGroups = new Map();
    for (const temperature of allTemperatures) {
      const normalizedUnit = String(temperature.unit || '').trim() === '˚C'
        ? '°C'
        : String(temperature.unit || '').trim();
      if (normalizedUnit !== temperature.unit) {
        temperatureOperations.push({
          updateOne: {
            filter: { _id: temperature._id },
            update: { $set: { unit: normalizedUnit } },
          },
        });
      }
  
      const identity = JSON.stringify({
        productType: String(temperature.productType || ''),
        value: temperature.value,
        unit: normalizedUnit,
      });
      const group = temperatureGroups.get(identity) || {
        _id: {
          productType: temperature.productType,
          value: temperature.value,
          unit: normalizedUnit,
        },
        count: 0,
        ids: [],
      };
      group.count += 1;
      group.ids.push(temperature._id);
      temperatureGroups.set(identity, group);
    }
    const temperatureDuplicates = [...temperatureGroups.values()]
      .filter(group => group.count > 1);
    const dimensionDuplicates = await dimensions.aggregate([
      {
        $group: {
          _id: {
            productType: '$productType',
            category: '$category',
            length: '$length',
            width: '$width',
            thickness: '$thickness',
            unit: '$unit',
          },
          count: { $sum: 1 },
          ids: { $push: '$_id' },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
  
    console.log(JSON.stringify({
      mode: applyChanges ? 'apply' : 'audit',
      legacyItems: legacyItems.length,
      plannedUpdates: operations.length,
      plannedTemperatureUpdates: temperatureOperations.length,
      unresolved,
      rawDuplicateGroups: rawDuplicates,
      temperatureDuplicateGroups: temperatureDuplicates,
      dimensionDuplicateGroups: dimensionDuplicates,
    }, null, 2));
  
    if (!applyChanges) {
      console.log('Audit complete. Re-run with --apply after resolving reported conflicts.');
      process.exitCode = (
        unresolved.length ||
        rawDuplicates.length ||
        temperatureDuplicates.length ||
        dimensionDuplicates.length
      ) ? 2 : 0;
    } else {
      if (unresolved.length) {
        throw new Error('Migration stopped: some Items have unresolved companyId/categoryKey values');
      }
      if (rawDuplicates.length) {
        throw new Error('Migration stopped: duplicate RAW Item identities must be resolved first');
      }
      if (temperatureDuplicates.length || dimensionDuplicates.length) {
        throw new Error('Migration stopped: duplicate parameter specifications must be resolved first');
      }
  
      if (operations.length) {
        await items.bulkWrite(operations, { ordered: false });
      }
      if (temperatureOperations.length) {
        await temperatures.bulkWrite(temperatureOperations, { ordered: false });
      }
  
      const indexes = await items.indexes();
      const legacyRawIndex = indexes.find(index =>
        index.unique &&
        JSON.stringify(index.key) === JSON.stringify({
          name: 1,
          grade: 1,
          categoryKey: 1,
        })
      );
      if (legacyRawIndex) {
        await items.dropIndex(legacyRawIndex.name);
      }
  
      const expectedRawIndex = indexes.find(index =>
        index.unique &&
        JSON.stringify(index.key) === JSON.stringify({
          companyId: 1,
          name: 1,
          grade: 1,
          categoryKey: 1,
        }) &&
        index.partialFilterExpression?.categoryKey === 'RAW' &&
        Object.keys(index.partialFilterExpression).length === 1
      );
      const staleCompanyRawIndex = indexes.find(index =>
        index.name === 'uniq_company_raw_name_grade' &&
        index.name !== expectedRawIndex?.name
      );
      if (staleCompanyRawIndex) {
        await items.dropIndex(staleCompanyRawIndex.name);
      }
      if (!expectedRawIndex) {
        await items.createIndex(
          { companyId: 1, name: 1, grade: 1, categoryKey: 1 },
          {
            unique: true,
            name: 'uniq_company_raw_name_grade',
            partialFilterExpression: { categoryKey: 'RAW' },
          },
        );
      }
  
      const temperatureIndexes = await temperatures.indexes();
      const legacyTemperatureIndex = temperatureIndexes.find(index =>
        index.unique &&
        JSON.stringify(index.key) === JSON.stringify({
          productType: 1,
          value: 1,
        })
      );
      if (legacyTemperatureIndex) {
        await temperatures.dropIndex(legacyTemperatureIndex.name);
      }
      if (!temperatureIndexes.some(index => index.name === 'uniq_temperature_spec')) {
        await temperatures.createIndex(
          { productType: 1, value: 1, unit: 1 },
          { unique: true, name: 'uniq_temperature_spec' },
        );
      }
  
      const dimensionIndexes = await dimensions.indexes();
      const legacyDimensionIndex = dimensionIndexes.find(index =>
        index.unique &&
        JSON.stringify(index.key) === JSON.stringify({
          productType: 1,
          length: 1,
          width: 1,
          thickness: 1,
        })
      );
      if (legacyDimensionIndex) {
        await dimensions.dropIndex(legacyDimensionIndex.name);
      }
      if (!dimensionIndexes.some(index => index.name === 'uniq_dimension_spec')) {
        await dimensions.createIndex(
          {
            productType: 1,
            category: 1,
            length: 1,
            width: 1,
            thickness: 1,
            unit: 1,
          },
          { unique: true, name: 'uniq_dimension_spec' },
        );
      }
  
      console.log(
        `Item migration applied successfully (${operations.length} Item updates, `
        + `${temperatureOperations.length} temperature updates).`
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrateItemModule();
}
