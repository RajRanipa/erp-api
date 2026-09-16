import ItemMaster from '../models/ItemMaster.js';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import { resolveGatewayItemV2 } from './gatewayInventoryV2Service.js';

const cache = new Map();
const key = (companyId, legacyItemId) => `${companyId}:${legacyItemId}`;

/**
 * Resolves an orphaned legacy Item ID without guessing. A direct
 * ItemMaster.legacyItemId wins. Otherwise, historical PLC specifications are
 * accepted only when every resolvable specification points to one V2 Item.
 */
export async function resolveLegacyItemReference(companyId, legacyItemId) {
  const cacheKey = key(companyId, legacyItemId);
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const direct = await ItemMaster.findOne({
    companyId,
    legacyItemId,
    status: 'active',
    'capabilities.inventory': true,
  }).lean();
  if (direct) {
    const result = { item: direct, source: 'LEGACY_ITEM_ID', reason: null };
    cache.set(cacheKey, result);
    return result;
  }
  const specifications = await ProductionBlanketRoll.aggregate([
    { $match: { companyId, matchedItem: legacyItemId } },
    {
      $group: {
        _id: {
          productCode: '$productCode',
          temperatureValue: '$temperatureValue',
          densityValue: '$densityValue',
          sizeCode: '$sizeCode',
        },
      },
    },
    { $limit: 100 },
  ]);
  const resolvedItems = new Map();
  const unresolved = [];
  for (const row of specifications) {
    const resolved = await resolveGatewayItemV2({
      companyId,
      legacyItemId,
      ...row._id,
    });
    if (resolved.item) resolvedItems.set(String(resolved.item._id), resolved.item);
    else if (resolved.status !== 'NOT_APPLICABLE') unresolved.push(resolved.message);
  }
  let result;
  if (resolvedItems.size === 1 && !unresolved.length) {
    result = {
      item: [...resolvedItems.values()][0],
      source: 'GATEWAY_SPECIFICATION',
      reason: null,
    };
  } else if (resolvedItems.size > 1) {
    result = {
      item: null,
      source: null,
      reason: 'Historical specifications resolve to multiple Item Masters',
    };
  } else {
    result = {
      item: null,
      source: null,
      reason: unresolved[0] || 'No recoverable Item Master mapping exists',
    };
  }
  cache.set(cacheKey, result);
  return result;
}

export function clearLegacyReferenceCache() {
  cache.clear();
}
