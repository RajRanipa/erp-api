import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import ProductionOrderV2 from '../models/ProductionOrderV2.js';
import generatePdfFromHtml from '../utils/generatePdfFromHtml.js';
import sendMail from '../utils/sendMail.js';
import { sendProductionReport } from './whatsappService.js';

const REPORT_TIMEZONE = 'Asia/Kolkata';
const GATEWAY_SIZE_MAP = Object.freeze({
  1: { length: 7300, width: 610, thickness: 25, unit: 'mm' },
  2: { length: 3650, width: 610, thickness: 50, unit: 'mm' },
  3: { length: 7320, width: 610, thickness: 25, unit: 'mm' },
  4: { length: 7620, width: 610, thickness: 25, unit: 'mm' },
  5: { length: 7300, width: 610, thickness: 12, unit: 'mm' },
  8: { length: 8000, width: 600, thickness: 30, unit: 'mm' },
});
const PRODUCT_NAMES = Object.freeze({
  1: 'Blanket',
  2: 'Bulk',
  3: 'Board',
  4: 'Module',
  5: 'ET',
});

function reportCompanyId(companyId) {
  const value = companyId
    || process.env.PRODUCTION_REPORT_COMPANY_ID
    || process.env.GATEWAY_COMPANY_ID;
  if (!mongoose.isValidObjectId(value)) {
    throw new Error('A valid production report company is required');
  }
  return value;
}

function reportDay(date = null) {
  const value = date
    ? DateTime.fromISO(date, { zone: REPORT_TIMEZONE })
    : DateTime.now().setZone(REPORT_TIMEZONE);
  if (!value.isValid) throw new Error(`Invalid report date: ${date}`);
  return value.startOf('day');
}

export function getTodayDayShiftRange(date = null) {
  const day = reportDay(date);
  const start = day.set({ hour: 7, minute: 30 });
  const end = day.set({ hour: 19, minute: 30 });
  return {
    start: start.toUTC().toJSDate(),
    end: end.toUTC().toJSDate(),
    startIST: start.toISO(),
    endIST: end.toISO(),
  };
}

function getTodayNightShiftRange(date = null) {
  const day = reportDay(date);
  const start = day.minus({ days: 1 }).set({ hour: 19, minute: 30 });
  const end = day.set({ hour: 7, minute: 30 });
  return {
    start: start.toUTC().toJSDate(),
    end: end.toUTC().toJSDate(),
    startIST: start.toISO(),
    endIST: end.toISO(),
  };
}

function validateRange(start, end) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw new Error('Valid start date is required');
  }
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    throw new Error('Valid end date is required');
  }
}

async function productionRows(start, end, companyId) {
  validateRange(start, end);
  return ProductionBlanketRoll.find({
    companyId: reportCompanyId(companyId),
    at: { $gte: start, $lt: end },
  })
    .select(
      'companyId campaign gatewayId recordId ingestBatchId at weightKg statusOk '
      + 'productCode temperatureValue densityValue sizeCode batchNo scaleNo '
      + 'resolveErrors inventoryV2ItemId createdAt updatedAt',
    )
    .populate({
      path: 'inventoryV2ItemId',
      select: 'sku name familyId attributes baseUom catchUom',
      populate: { path: 'familyId', select: 'code name' },
    })
    .sort({ at: 1, _id: 1 })
    .lean();
}

function shapeProduction(row) {
  const item = row.inventoryV2ItemId || null;
  return {
    ...row,
    matchedItem: item || {
      _id: null,
      sku: 'UNMAPPED',
      name: `${PRODUCT_NAMES[row.productCode] || `Product ${row.productCode}`} (unmapped)`,
    },
    productType: item?.familyId || {
      _id: String(row.productCode || ''),
      name: PRODUCT_NAMES[row.productCode] || `Product ${row.productCode}`,
    },
    temperature: Number.isFinite(Number(row.temperatureValue))
      ? { value: Number(row.temperatureValue), unit: '°C' }
      : null,
    density: Number(row.densityValue) > 0
      ? { value: Number(row.densityValue), unit: 'kg/m³' }
      : null,
    dimension: GATEWAY_SIZE_MAP[row.sizeCode] || null,
    packingItem: null,
  };
}

export async function fetchproduction(start, end, companyId) {
  const grouped = new Map();
  for (const raw of await productionRows(start, end, companyId)) {
    const row = shapeProduction(raw);
    const key = [
      row.inventoryV2ItemId?._id,
      row.statusOk,
      row.temperatureValue,
      row.densityValue,
      row.sizeCode,
    ].join(':');
    const current = grouped.get(key) || { ...row, totalRolls: 0, totalWeight: 0 };
    current.totalRolls += 1;
    current.totalWeight += Number(row.weightKg || 0);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((left, right) => right.totalWeight - left.totalWeight);
}

export async function fetchproductionALL(start, end, companyId) {
  return (await productionRows(start, end, companyId)).map(shapeProduction);
}

export async function fetchBatchReport(start, end, companyId) {
  validateRange(start, end);
  const orders = await ProductionOrderV2.find({
    companyId: reportCompanyId(companyId),
    createdAt: { $gte: start, $lt: end },
  })
    .select(
      'orderNo plannedQuantity actualOutputQuantity outputUom status createdAt completedAt '
      + 'outputItemId sourceWarehouseId materials',
    )
    .populate('outputItemId', 'sku name')
    .populate('sourceWarehouseId', 'code name')
    .populate('materials.itemId', 'sku name description baseUom attributes')
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const rows = orders.map(order => ({
    id: order._id,
    batchCode: order.orderNo,
    manufacturingDate: order.completedAt || order.createdAt,
    recordedAt: order.createdAt,
    numberOfBatches: Number(order.actualOutputQuantity || order.plannedQuantity || 0),
    campaign: order.outputItemId?.name || '-',
    campaignStatus: order.status,
    warehouse: order.sourceWarehouseId?.name || '-',
    warehouseCode: order.sourceWarehouseId?.code || '',
    totalRawKg: (order.materials || []).reduce(
      (total, line) => total + (line.uom === 'kg' ? Number(line.issuedQuantity || 0) : 0),
      0,
    ),
    materials: (order.materials || []).map(line => ({
      itemId: line.itemId?._id || line.itemId,
      name: line.itemId?.name || 'Unknown item',
      sku: line.itemId?.sku || '',
      description: line.itemId?.description || '',
      quantityPerBatch: Number(line.plannedQuantity || 0),
      perBatchUom: line.uom,
      totalQuantity: Number(line.issuedQuantity || 0),
      totalUom: line.uom,
    })),
  }));
  return {
    totalBatchRecords: rows.length,
    totalBatches: rows.reduce((total, row) => total + row.numberOfBatches, 0),
    totalRawKg: rows.reduce((total, row) => total + row.totalRawKg, 0),
    rows,
  };
}

async function reportForRange(range, companyId) {
  const [data, batchReport] = await Promise.all([
    fetchproduction(range.start, range.end, companyId),
    fetchBatchReport(range.start, range.end, companyId),
  ]);
  return { range: { startIST: range.startIST, endIST: range.endIST }, data, batchReport };
}

export function getProductionDay(date = null, companyId = null) {
  return reportForRange(getTodayDayShiftRange(date), companyId);
}

export function getProductionNight(date = null, companyId = null) {
  return reportForRange(getTodayNightShiftRange(date), companyId);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function dateTime(value) {
  return DateTime.fromISO(String(value), { setZone: true })
    .setZone(REPORT_TIMEZONE)
    .toFormat('dd LLL yyyy, hh:mm a');
}

function totals(rows) {
  return rows.reduce((value, row) => {
    const rolls = Number(row.totalRolls || 0);
    const weight = Number(row.totalWeight || 0);
    value.rolls += rolls;
    value.weight += weight;
    if (row.statusOk) {
      value.okRolls += rolls;
      value.okWeight += weight;
    } else {
      value.rejectedRolls += rolls;
      value.rejectedWeight += weight;
    }
    return value;
  }, { rolls: 0, weight: 0, okRolls: 0, okWeight: 0, rejectedRolls: 0, rejectedWeight: 0 });
}

function buildReportHtml(rows, shift, range, batchReport) {
  const total = totals(rows);
  const detailRows = rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(row.matchedItem?.name || '-')}</strong><br>${escapeHtml(row.matchedItem?.sku || '')}</td>
      <td>${escapeHtml(row.productType?.name || '-')}</td>
      <td>${escapeHtml(row.temperature ? `${row.temperature.value} ${row.temperature.unit}` : '-')}</td>
      <td>${escapeHtml(row.density ? `${row.density.value} ${row.density.unit}` : '-')}</td>
      <td>${escapeHtml(row.dimension ? `${row.dimension.length} × ${row.dimension.width} × ${row.dimension.thickness} ${row.dimension.unit}` : '-')}</td>
      <td>${row.statusOk ? 'OK' : 'Rejected'}</td>
      <td>${row.totalRolls}</td>
      <td>${Number(row.totalWeight).toFixed(2)} kg</td>
    </tr>`).join('');
  const orderRows = (batchReport.rows || []).map(row => `
    <tr><td>${escapeHtml(row.batchCode)}</td><td>${escapeHtml(row.campaign)}</td><td>${escapeHtml(row.warehouse)}</td><td>${escapeHtml(row.campaignStatus)}</td><td>${row.numberOfBatches}</td><td>${row.totalRawKg.toFixed(2)} kg</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;color:#1f2937}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{border:1px solid #d1d5db;padding:8px;text-align:left}th{background:#111827;color:white}.cards{display:flex;gap:12px}.card{padding:12px;background:#f3f4f6;border-radius:6px}
  </style></head><body>
    <h1>${escapeHtml(shift)} Shift Production Report</h1>
    <p>${escapeHtml(dateTime(range.startIST))} to ${escapeHtml(dateTime(range.endIST))} IST</p>
    <div class="cards"><div class="card">Total: ${total.rolls} / ${total.weight.toFixed(2)} kg</div><div class="card">OK: ${total.okRolls} / ${total.okWeight.toFixed(2)} kg</div><div class="card">Rejected: ${total.rejectedRolls} / ${total.rejectedWeight.toFixed(2)} kg</div></div>
    <h2>Gateway Production</h2><table><thead><tr><th>#</th><th>Item</th><th>Family</th><th>Temperature</th><th>Density</th><th>Size</th><th>Status</th><th>Units</th><th>Weight</th></tr></thead><tbody>${detailRows || '<tr><td colspan="9">No gateway production</td></tr>'}</tbody></table>
    <h2>Production Orders</h2><table><thead><tr><th>Order</th><th>Output</th><th>Warehouse</th><th>Status</th><th>Quantity</th><th>Raw issued</th></tr></thead><tbody>${orderRows || '<tr><td colspan="6">No production orders</td></tr>'}</tbody></table>
  </body></html>`;
}

function buildSummary(rows, shift, range, batchReport) {
  const total = totals(rows);
  return [
    `JNR ERP — ${shift} Shift Production`,
    `${dateTime(range.startIST)} to ${dateTime(range.endIST)} IST`,
    `Total: ${total.rolls} units / ${total.weight.toFixed(2)} kg`,
    `OK: ${total.okRolls} / ${total.okWeight.toFixed(2)} kg`,
    `Rejected: ${total.rejectedRolls} / ${total.rejectedWeight.toFixed(2)} kg`,
    `Production orders: ${batchReport.totalBatchRecords}`,
    `Raw issued: ${Number(batchReport.totalRawKg || 0).toFixed(2)} kg`,
  ].join('\n');
}

function recipients(value) {
  if (!value) return [];
  const rows = Array.isArray(value) ? value : String(value).replace(/^\[|\]$/g, '').split(',');
  return rows.map(row => String(row).replace(/\D/g, '')).filter(row => /^\d{10,15}$/.test(row));
}

export async function fetchAndSendReport(timeOfDay, companyId = null) {
  const shift = String(timeOfDay || '').trim().toUpperCase();
  if (!['DAY', 'NIGHT'].includes(shift)) throw new Error('shift must be DAY or NIGHT');
  const report = shift === 'DAY'
    ? await getProductionDay(null, companyId)
    : await getProductionNight(null, companyId);
  if (!report.data.length && !report.batchReport.totalBatchRecords) {
    return {
      success: true,
      skipped: true,
      emailSent: false,
      whatsappSent: 0,
      message: `No ${shift} production data found`,
    };
  }
  const html = buildReportHtml(report.data, shift, report.range, report.batchReport);
  const pdfBuffer = await generatePdfFromHtml(html);
  const summary = buildSummary(report.data, shift, report.range, report.batchReport);
  const reportDate = DateTime.fromISO(report.range.startIST, { setZone: true })
    .setZone(REPORT_TIMEZONE)
    .toFormat('dd-LL-yyyy');
  const filename = `JNR-PR-${shift.toLowerCase()}-${reportDate}.pdf`;
  const email = process.env.PRODUCTION_REPORT_EMAIL || 'orientfibertechllp@gmail.com';
  await sendMail({
    to: email,
    subject: `JNR ERP: ${shift} Shift Production Report — ${reportDate}`,
    html,
  });
  let whatsappSent = 0;
  const whatsappRecipients = recipients(process.env.WHATSAPP_RECIPIENT_NUMBER);
  for (const to of whatsappRecipients) {
    try {
      await sendProductionReport({ to, summary, pdfBuffer, filename, shift });
      whatsappSent += 1;
    } catch (error) {
      console.error(`Production report WhatsApp delivery failed for ${to}:`, error.message);
    }
  }
  return {
    success: true,
    emailSent: true,
    whatsappSent,
    message: whatsappRecipients.length
      ? `${shift} report emailed; WhatsApp delivered to ${whatsappSent}/${whatsappRecipients.length}`
      : `${shift} report emailed; no WhatsApp recipients configured`,
  };
}
