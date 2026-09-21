import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Campaign from '../models/Campaign.js';
import ItemFamily from '../models/ItemFamily.js';
import ItemMaster from '../models/ItemMaster.js';
import ManufacturingRecipe from '../models/ManufacturingRecipe.js';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import {
  GATEWAY_PRODUCT_FAMILY,
  resolveGatewayItem,
  resolveGatewayWarehouseId,
} from '../services/gatewayInventoryService.js';

dotenv.config();

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const companyId = process.env.GATEWAY_COMPANY_ID;
if (!mongoUri || !mongoose.isValidObjectId(companyId)) {
  console.error('MONGO_URI and a valid GATEWAY_COMPANY_ID are required');
  process.exit(1);
}

await mongoose.connect(mongoUri, { autoIndex: false });
try {
  const [warehouseId, campaign, families, items, recipes, recentRecords] = await Promise.all([
    resolveGatewayWarehouseId(companyId),
    Campaign.findOne({ companyId, status: 'RUNNING' }).select('_id name').lean(),
    ItemFamily.find({
      companyId,
      code: { $in: [...Object.values(GATEWAY_PRODUCT_FAMILY), 'PLASTIC_BAG'] },
      status: 'active',
    }).select('_id code').lean(),
    ItemMaster.find({
      companyId,
      'capabilities.inventory': true,
    }).select(
      '_id familyId sku name status attributes baseUom catchUom trackingPolicy capabilities',
    ).lean(),
    ManufacturingRecipe.find({ companyId, status: 'ACTIVE' })
      .select('outputItemId components')
      .lean(),
    ProductionBlanketRoll.find({ companyId })
      .sort({ at: -1, _id: -1 })
      .limit(200)
      .select('productCode temperatureValue densityValue sizeCode itemId')
      .lean(),
  ]);
  const familyCodeById = new Map(families.map(family => [String(family._id), family.code]));
  const itemById = new Map(items.map(item => [String(item._id), item]));
  const plasticBagItems = items.filter(item => (
    familyCodeById.get(String(item.familyId)) === 'PLASTIC_BAG'
    && item.status === 'active'
    && item.baseUom === 'nos'
    && item.capabilities?.inventory === true
    && item.capabilities?.consumable === true
  ));
  const configuredItems = items
    .filter(item => familyCodeById.has(String(item.familyId)))
    .map(item => ({
      itemId: item._id,
      familyCode: familyCodeById.get(String(item.familyId)),
      sku: item.sku,
      name: item.name,
      status: item.status,
      baseUom: item.baseUom,
      catchUom: item.catchUom,
      serialTracked: Boolean(item.trackingPolicy?.serialTracked),
    }));
  const uniqueRecords = new Map();
  for (const record of recentRecords) {
    const key = [
      record.productCode,
      record.temperatureValue,
      record.densityValue,
      record.sizeCode,
    ].join(':');
    if (!uniqueRecords.has(key)) uniqueRecords.set(key, record);
  }
  const mappings = [];
  for (const record of uniqueRecords.values()) {
    const resolved = await resolveGatewayItem({
      companyId,
      productCode: record.productCode,
      temperatureValue: record.temperatureValue,
      densityValue: record.densityValue,
      sizeCode: record.sizeCode,
    });
    mappings.push({
      plc: {
        productCode: record.productCode,
        temperature: record.temperatureValue,
        density: record.densityValue,
        sizeCode: record.sizeCode,
      },
      familyCode: resolved.familyCode,
      status: resolved.status,
      itemId: resolved.item?._id || null,
      sku: resolved.item?.sku || null,
      message: resolved.message,
    });
  }
  const blanketItemIds = new Set(
    mappings
      .filter(mapping => mapping.familyCode === 'BLANKET' && mapping.status === 'RESOLVED')
      .map(mapping => String(mapping.itemId)),
  );
  const recipePackedBlanketIds = new Set(
    recipes
      .filter(recipe => blanketItemIds.has(String(recipe.outputItemId)))
      .filter(recipe => recipe.components.some(component => {
        const item = itemById.get(String(component.itemId));
        return component.stage === 'PACKING'
          && familyCodeById.get(String(item?.familyId)) === 'PLASTIC_BAG'
          && item?.status === 'active'
          && item?.baseUom === 'nos'
          && item?.capabilities?.inventory === true
          && item?.capabilities?.consumable === true;
      }))
      .map(recipe => String(recipe.outputItemId)),
  );
  const blanketPackingReady = [...blanketItemIds].every(itemId => (
    recipePackedBlanketIds.has(itemId) || plasticBagItems.length === 1
  ));
  console.log(JSON.stringify({
    gatewayCompanyId: companyId,
    warehouseReady: Boolean(warehouseId),
    warehouseId,
    runningCampaignReady: Boolean(campaign),
    runningCampaign: campaign,
    inventoryRuntime: 'CURRENT_ONLY',
    configuredItems,
    mandatoryPlasticBagPacking: {
      ready: blanketPackingReady,
      eligibleFallbackItems: plasticBagItems.map(item => ({
        itemId: item._id,
        sku: item.sku,
        name: item.name,
      })),
      blanketItemsWithActivePackingRecipe: [...recipePackedBlanketIds],
    },
    recentSpecificationMappings: mappings,
    ready: Boolean(warehouseId)
      && Boolean(campaign)
      && blanketPackingReady
      && mappings.every(mapping => ['RESOLVED', 'NOT_APPLICABLE'].includes(mapping.status)),
  }, null, 2));
} finally {
  await mongoose.disconnect();
}
