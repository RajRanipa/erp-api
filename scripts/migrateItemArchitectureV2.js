import dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  ITEM_ATTRIBUTE_CATALOG,
  ITEM_CLASS_CATALOG,
  ITEM_FAMILY_CATALOG,
} from '../config/itemMasterCatalog.js';
import Item from '../models/Item.js';
import '../models/Category.js';
import '../models/Density.js';
import '../models/Dimension.js';
import ItemFamily from '../models/ItemFamily.js';
import ItemMaster from '../models/ItemMaster.js';
import '../models/ProductType.js';
import '../models/Temperature.js';
import {
  createItemMaster,
  normalizeItemAttributes,
} from '../services/itemMasterService.js';

dotenv.config();

const apply = process.argv.includes('--apply');
const companyArg = process.argv.find(argument => argument.startsWith('--company='))
  ?.split('=')[1];
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('MONGO_URI or MONGODB_URI is required');
  process.exit(1);
}
if (companyArg && !mongoose.isValidObjectId(companyArg)) {
  console.error('--company must be a valid ObjectId');
  process.exit(1);
}

await mongoose.connect(mongoUri, { autoIndex: false });

const text = value => String(value || '').trim().toLowerCase();
const searchPrefixes = values => {
  const prefixes = new Set();
  for (const value of values) {
    const words = text(value).split(/[^a-z0-9°]+/).filter(Boolean);
    for (const word of words) {
      for (let length = 1; length <= Math.min(word.length, 24); length += 1) {
        prefixes.add(word.slice(0, length));
      }
    }
  }
  return [...prefixes].slice(0, 400);
};
const withoutMaterialClassFingerprint = fingerprint => {
  const remaining = String(fingerprint || '')
    .split('|')
    .filter(part => part && !part.startsWith('material_class='));
  return remaining.join('|') || 'family-default';
};
const itemSearchFields = item => {
  const values = [
    item.sku,
    item.name,
    item.familyId?.name,
    ...(item.attributes || []).flatMap(attribute => [
      attribute.displayValue,
      attribute.normalizedValue,
    ]),
  ];
  return {
    searchText: values.filter(Boolean).join(' ').toLowerCase(),
    searchTokens: searchPrefixes(values),
  };
};
const inferFamilyCode = item => {
  const productType = text(item.productType?.name);
  const name = text(item.name);
  if (item.categoryKey === 'FG') {
    if (productType.includes('blanket')) return 'BLANKET';
    if (productType.includes('bulk')) return 'BULK';
    if (productType.includes('board')) return 'BOARD';
    if (productType.includes('module')) return 'MODULE';
  }
  if (item.categoryKey === 'NC' && (productType === 'et' || name === 'et')) return 'ET';
  if (item.categoryKey === 'PACKING') {
    if (name.includes('plastic')) return 'PLASTIC_BAG';
    if (name.includes('woven')) return 'WOVEN_BAG';
    if (name.includes('box') || name.includes('carton')) return 'BOX';
  }
  if (item.categoryKey === 'RAW') {
    if (name.includes('alumina')) return 'ALUMINA';
    if (name.includes('zircon')) return 'ZIRCONIA';
    if (name.includes('silica')) return 'SILICA';
  }
  return null;
};

const legacyAttributeValues = (item, familyCode) => {
  const values = {
    classification_temperature: item.temperature?.value ?? null,
    density: item.density?.value ?? null,
    length: item.dimension?.length ?? null,
    width: item.dimension?.width ?? null,
    thickness: item.dimension?.thickness ?? null,
    grade: item.grade || null,
    brand_type: item.brandType || null,
    print_color: item.productColor || null,
  };
  if (['ALUMINA', 'SILICA', 'ZIRCONIA'].includes(familyCode)) {
    values.chemical_grade = item.grade || item.raw_specificField1 || null;
    values.particle_size = item.raw_specificField2 || null;
  }
  return values;
};

try {
  const database = mongoose.connection;
  const companies = database.collection('companies');
  const legacyItems = database.collection('items');
  const classes = database.collection('itemclasses');
  const attributes = database.collection('itemattributedefinitions');
  const families = database.collection('itemfamilies');
  const itemMasters = database.collection('itemmasters');

  let companyIds = companyArg
    ? [new mongoose.Types.ObjectId(companyArg)]
    : await legacyItems.distinct('companyId', { companyId: { $type: 'objectId' } });
  if (!companyIds.length) {
    companyIds = (await companies.find({}, { projection: { _id: 1 } }).toArray())
      .map(company => company._id);
  }

  const result = {
    mode: apply ? 'APPLY' : 'AUDIT',
    companies: [],
    totals: {
      companies: companyIds.length,
      legacyItems: 0,
      existingV2Items: 0,
      plannedClasses: companyIds.length * ITEM_CLASS_CATALOG.length,
      plannedAttributes: companyIds.length * ITEM_ATTRIBUTE_CATALOG.length,
      plannedFamilies: companyIds.length * ITEM_FAMILY_CATALOG.length,
      upsertedClasses: 0,
      upsertedAttributes: 0,
      upsertedFamilies: 0,
      mappedLegacyItems: 0,
      existingMappings: 0,
      mappingCandidates: 0,
      mappingBlockers: 0,
      plannedMaterialClassCleanup: 0,
      cleanedMaterialClassItems: 0,
      removedMaterialClassDefinitions: 0,
    },
    blockers: [],
  };

  for (const companyId of companyIds) {
    const [legacyItemCount, existingV2ItemCount, existingV2Rows] = await Promise.all([
      legacyItems.countDocuments({ companyId }),
      itemMasters.countDocuments({ companyId }),
      ItemMaster.find({ companyId }).populate('familyId', 'name').lean(),
    ]);
    result.totals.legacyItems += legacyItemCount;
    result.totals.existingV2Items += existingV2ItemCount;
    const companyResult = {
      companyId,
      legacyItems: legacyItemCount,
      existingV2Items: existingV2ItemCount,
      classes: ITEM_CLASS_CATALOG.length,
      attributes: ITEM_ATTRIBUTE_CATALOG.length,
      families: ITEM_FAMILY_CATALOG.length,
    };
    const materialClassRows = existingV2Rows.filter(item =>
      (item.attributes || []).some(attribute => attribute.code === 'material_class')
      || String(item.attributeFingerprint || '').includes('material_class=')
    );
    result.totals.plannedMaterialClassCleanup += materialClassRows.length;

    // Removing an identity field can expose records that are otherwise the
    // same Item. Detect that before any write instead of allowing a unique
    // index failure halfway through the migration.
    const proposedIdentities = new Map();
    for (const item of existingV2Rows) {
      const fingerprint = withoutMaterialClassFingerprint(item.attributeFingerprint);
      const key = `${item.familyId?._id || item.familyId}:${fingerprint}`;
      const rows = proposedIdentities.get(key) || [];
      rows.push(item);
      proposedIdentities.set(key, rows);
    }
    const identityConflicts = [...proposedIdentities.entries()]
      .filter(([, rows]) =>
        rows.length > 1
        && rows.some(row => materialClassRows.some(item => String(item._id) === String(row._id)))
      );
    for (const [identity, rows] of identityConflicts) {
      result.totals.mappingBlockers++;
      result.blockers.push({
        companyId,
        reason: 'Removing material_class would create duplicate Item identities',
        identity,
        items: rows.map(row => ({ id: row._id, sku: row.sku, name: row.name })),
        hint: 'Merge/archive the duplicate Item Masters before applying this migration',
      });
    }
    if (apply && identityConflicts.length) {
      companyResult.skipped = true;
      companyResult.reason = 'Material-class cleanup identity conflicts must be resolved first';
      result.companies.push(companyResult);
      continue;
    }

    if (apply) {
      const classOperations = ITEM_CLASS_CATALOG.map(entry => ({
        updateOne: {
          filter: { companyId, code: entry.code },
          update: {
            $set: {
              name: entry.name,
              capabilities: {
                inventory: entry.capabilities.inventory ?? true,
                purchasable: entry.capabilities.purchasable ?? false,
                manufacturable: entry.capabilities.manufacturable ?? false,
                consumable: entry.capabilities.consumable ?? false,
                sellable: entry.capabilities.sellable ?? false,
              },
              description: entry.description || '',
              system: true,
              status: 'active',
              updatedAt: new Date(),
            },
            $setOnInsert: { companyId, createdAt: new Date() },
          },
          upsert: true,
        },
      }));
      const classWrite = await classes.bulkWrite(classOperations, { ordered: true });
      result.totals.upsertedClasses += classWrite.upsertedCount + classWrite.modifiedCount;

      const attributeOperations = ITEM_ATTRIBUTE_CATALOG.map(entry => ({
        updateOne: {
          filter: { companyId, code: entry.code },
          update: {
            $set: {
              label: entry.label,
              description: entry.description || '',
              dataType: entry.dataType,
              unit: entry.unit || null,
              referenceModel: entry.referenceModel || null,
              referenceFamilyCode: entry.referenceFamilyCode || null,
              allowedValues: (entry.allowedValues || []).map((option, index) => ({
                value: option.value,
                label: option.label,
                sortOrder: option.sortOrder ?? index,
                active: true,
              })),
              validation: {
                min: entry.validation?.min ?? null,
                max: entry.validation?.max ?? null,
                precision: entry.validation?.precision ?? null,
                pattern: entry.validation?.pattern ?? null,
                maxLength: entry.validation?.maxLength ?? null,
              },
              system: true,
              status: 'active',
              updatedAt: new Date(),
            },
            $setOnInsert: { companyId, createdAt: new Date() },
          },
          upsert: true,
        },
      }));
      const attributeWrite = await attributes.bulkWrite(attributeOperations, { ordered: true });
      result.totals.upsertedAttributes +=
        attributeWrite.upsertedCount + attributeWrite.modifiedCount;

      const [classRows, attributeRows] = await Promise.all([
        classes.find({ companyId }).toArray(),
        attributes.find({ companyId }).toArray(),
      ]);
      const classByCode = new Map(classRows.map(row => [row.code, row]));
      const attributeByCode = new Map(attributeRows.map(row => [row.code, row]));

      const familyOperations = ITEM_FAMILY_CATALOG.map(entry => {
        const itemClass = classByCode.get(entry.classCode);
        const rules = entry.attributes.map((rule, index) => ({
          attributeId: attributeByCode.get(rule.attributeCode)._id,
          required: rule.required,
          identity: rule.identity,
          searchable: true,
          displayOrder: index,
          defaultValue: null,
        }));
        return {
          updateOne: {
            filter: { companyId, code: entry.code },
            update: {
              $set: {
                itemClassId: itemClass._id,
                name: entry.name,
                description: entry.description || '',
                capabilities: itemClass.capabilities,
                attributeRules: rules,
                uomPolicy: {
                  baseUom: entry.uomPolicy.baseUom,
                  catchUom: entry.uomPolicy.catchUom || null,
                  catchMode: entry.uomPolicy.catchMode || 'NONE',
                  nominalFactor: entry.uomPolicy.nominalFactor ?? null,
                },
                trackingPolicy: {
                  lotTracked: entry.trackingPolicy?.lotTracked ?? true,
                  serialTracked: entry.trackingPolicy?.serialTracked ?? false,
                  serialControlMode: entry.trackingPolicy?.serialControlMode
                    || (entry.trackingPolicy?.serialTracked ? 'INFORMATIONAL' : 'NONE'),
                  expiryTracked: entry.trackingPolicy?.expiryTracked ?? false,
                },
                skuPrefix: entry.skuPrefix,
                status: 'active',
                updatedAt: new Date(),
              },
              $setOnInsert: {
                companyId,
                version: 1,
                createdAt: new Date(),
              },
            },
            upsert: true,
          },
        };
      });
      const familyWrite = await families.bulkWrite(familyOperations, { ordered: true });
      result.totals.upsertedFamilies += familyWrite.upsertedCount + familyWrite.modifiedCount;

      if (materialClassRows.length) {
        const cleanupOperations = materialClassRows.map(item => {
          const cleaned = {
            ...item,
            attributes: (item.attributes || []).filter(
              attribute => attribute.code !== 'material_class'
            ),
          };
          return {
            updateOne: {
              filter: { _id: item._id, companyId },
              update: {
                $set: {
                  attributes: cleaned.attributes,
                  attributeFingerprint:
                    withoutMaterialClassFingerprint(item.attributeFingerprint),
                  ...itemSearchFields(cleaned),
                  updatedAt: new Date(),
                },
              },
            },
          };
        });
        const cleanupWrite = await itemMasters.bulkWrite(cleanupOperations, { ordered: true });
        result.totals.cleanedMaterialClassItems += cleanupWrite.modifiedCount;
      }
      const removedDefinition = await attributes.deleteOne({
        companyId,
        code: 'material_class',
      });
      result.totals.removedMaterialClassDefinitions += removedDefinition.deletedCount;
    }

    const legacyRows = await Item.find({ companyId })
      .populate('productType', 'name')
      .populate('temperature', 'value unit')
      .populate('density', 'value unit')
      .populate('dimension', 'length width thickness unit')
      .lean();
    for (const legacyItem of legacyRows) {
      const existing = await ItemMaster.findOne({
        companyId,
        legacyItemId: legacyItem._id,
      }).select('_id').lean();
      if (existing) {
        result.totals.existingMappings++;
        continue;
      }
      const familyCode = inferFamilyCode(legacyItem);
      if (!familyCode) {
        result.totals.mappingBlockers++;
        result.blockers.push({
          legacyItemId: legacyItem._id,
          sku: legacyItem.sku,
          name: legacyItem.name,
          reason: 'Item Family cannot be inferred safely',
        });
        continue;
      }
      const values = legacyAttributeValues(legacyItem, familyCode);
      if (!apply) {
        const catalogFamily = ITEM_FAMILY_CATALOG.find(entry => entry.code === familyCode);
        const missing = (catalogFamily?.attributes || [])
          .filter(rule => rule.required)
          .map(rule => rule.attributeCode)
          .filter(code => values[code] === null || values[code] === undefined || values[code] === '');
        if (missing.length) {
          result.totals.mappingBlockers++;
          result.blockers.push({
            legacyItemId: legacyItem._id,
            sku: legacyItem.sku,
            name: legacyItem.name,
            familyCode,
            reason: `Required V2 attributes are missing: ${missing.join(', ')}`,
          });
        } else {
          result.totals.mappingCandidates++;
        }
        continue;
      }
      const family = await ItemFamily.findOne({
        companyId,
        code: familyCode,
        status: 'active',
      })
        .populate('itemClassId')
        .populate('attributeRules.attributeId')
        .lean();
      try {
        normalizeItemAttributes(family, values);
      } catch (error) {
        result.totals.mappingBlockers++;
        result.blockers.push({
          legacyItemId: legacyItem._id,
          sku: legacyItem.sku,
          name: legacyItem.name,
          familyCode,
          reason: error.message,
        });
        continue;
      }
      result.totals.mappingCandidates++;
      if (!apply) continue;
      try {
        const created = await createItemMaster(companyId, legacyItem.createdBy || null, {
          familyId: family._id,
          sku: legacyItem.sku,
          name: legacyItem.name,
          description: legacyItem.description,
          minimumStock: legacyItem.minimumStock,
          attributes: values,
        });
        await ItemMaster.updateOne(
          { _id: created._id },
          {
            $set: {
              legacyItemId: legacyItem._id,
              status: legacyItem.status === 'active' ? 'active' : 'draft',
            },
            $push: {
              statusHistory: {
                from: 'draft',
                to: legacyItem.status === 'active' ? 'active' : 'draft',
                reason: 'Migrated from legacy Item architecture',
                by: legacyItem.updatedBy || legacyItem.createdBy || null,
                at: new Date(),
              },
            },
          },
        );
        result.totals.mappedLegacyItems++;
      } catch (error) {
        result.totals.mappingBlockers++;
        result.blockers.push({
          legacyItemId: legacyItem._id,
          sku: legacyItem.sku,
          name: legacyItem.name,
          familyCode,
          reason: error.message,
        });
      }
    }
    result.companies.push(companyResult);
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  await mongoose.disconnect();
}
