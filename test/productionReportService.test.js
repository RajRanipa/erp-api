import assert from 'node:assert/strict';
import test from 'node:test';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import {
  getCampaignProductionRecords,
  getCampaignProductionReport,
  getSelectedShiftRange,
} from '../services/productionReportService.js';

const COMPANY_ID = '6909ab791eb1036890994ff4';
const CAMPAIGN_ID = '6aaa6b6e3cadf166c8eed5fc';

async function withProductionRows(rows, callback) {
  const originalFind = ProductionBlanketRoll.find;
  ProductionBlanketRoll.find = () => ({
    select() { return this; },
    populate() { return this; },
    sort() { return this; },
    lean() { return Promise.resolve(rows); },
  });
  try {
    return await callback();
  } finally {
    ProductionBlanketRoll.find = originalFind;
  }
}

test('selected Day shift uses 07:30 to 19:30 IST on the selected date', () => {
  const range = getSelectedShiftRange('2026-09-27', 'DAY');

  assert.equal(range.date, '2026-09-27');
  assert.equal(range.start.toISOString(), '2026-09-27T02:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-09-27T14:00:00.000Z');
});

test('selected Night shift uses 19:30 IST to 07:30 IST on the next date', () => {
  const range = getSelectedShiftRange('2026-09-27', 'NIGHT');

  assert.equal(range.date, '2026-09-27');
  assert.equal(range.start.toISOString(), '2026-09-27T14:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-09-28T02:00:00.000Z');
});

test('selected shift rejects unsupported shift names', () => {
  assert.throws(
    () => getSelectedShiftRange('2026-09-27', 'EVENING'),
    /shift must be DAY or NIGHT/,
  );
});

test('campaign summary excludes individual records and the records endpoint owns them', async () => {
  const familyId = '6909ab791eb1036890994fa1';
  const itemId = '6909ab791eb1036890994fb1';
  const rows = [
    {
      _id: '6909ab791eb1036890994fc1',
      companyId: COMPANY_ID,
      campaign: CAMPAIGN_ID,
      at: new Date('2026-09-27T03:00:00.000Z'),
      weightKg: 14.25,
      statusOk: true,
      productCode: 1,
      temperatureValue: 1260,
      densityValue: 128,
      sizeCode: 1,
      scaleNo: 1,
      itemId: {
        _id: itemId,
        sku: 'ITEM_ORE_001',
        name: 'orewool blanket',
        familyId: { _id: familyId, code: 'BLANKET', name: 'Ceramic Fibre Blanket' },
      },
      inventoryStatus: 'POSTED',
      inventorySerialNo: '100000000000000001',
    },
    {
      _id: '6909ab791eb1036890994fc2',
      companyId: COMPANY_ID,
      campaign: CAMPAIGN_ID,
      at: new Date('2026-09-27T04:00:00.000Z'),
      weightKg: 13.75,
      statusOk: false,
      productCode: 1,
      temperatureValue: 1260,
      densityValue: 128,
      sizeCode: 1,
      scaleNo: 2,
      itemId: {
        _id: itemId,
        sku: 'ITEM_ORE_001',
        name: 'orewool blanket',
        familyId: { _id: familyId, code: 'BLANKET', name: 'Ceramic Fibre Blanket' },
      },
      inventoryStatus: 'POSTED',
      inventorySerialNo: '100000000000000002',
    },
  ];

  await withProductionRows(rows, async () => {
    const filters = {
      campaignId: CAMPAIGN_ID,
      companyId: COMPANY_ID,
      date: '2026-09-27',
      shift: 'DAY',
      quality: 'ALL',
      familyId: '',
    };
    const summary = await getCampaignProductionReport(filters);
    const details = await getCampaignProductionRecords({ ...filters, page: 1, limit: 1000 });

    assert.equal(summary.summary.totalUnits, 2);
    assert.equal(summary.records, undefined);
    assert.equal(summary.pagination, undefined);
    assert.equal(details.records.length, 2);
    assert.equal(details.pagination.total, 2);
    assert.equal(details.records[0].serialNo, '100000000000000001');
  });
});
