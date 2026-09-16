import {
  fetchAndSendReport,
  fetchproduction,
  fetchproductionALL,
  getProductionDay,
  getProductionNight,
  getTodayDayShiftRange,
} from '../services/productionReportService.js';
import { handleError } from '../utils/errorHandler.js';

export async function getAllProduction(req, res) {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate required' });
    }
    const { start, end } = getTodayDayShiftRange(startDate);
    const [data, specificData] = await Promise.all([
      fetchproduction(start, end, req.user?.companyId),
      fetchproductionALL(start, end, req.user?.companyId),
    ]);
    return res.json({ success: true, count: data.length, data, specificData });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function getProductionReportDay(req, res) {
  try {
    const response = await getProductionDay(req.query.date, req.user?.companyId);
    return res.json({
      success: true,
      count: response.data.length,
      data: response.data,
      batchReport: response.batchReport,
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function getProductionReportNight(req, res) {
  try {
    const response = await getProductionNight(req.query.date, req.user?.companyId);
    return res.json({
      success: true,
      count: response.data.length,
      data: response.data,
      batchReport: response.batchReport,
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function sentProductionReport(req, res) {
  try {
    const shift = String(req.body?.shift || '').trim().toUpperCase();
    if (!['DAY', 'NIGHT'].includes(shift)) {
      return res.status(400).json({ success: false, message: 'shift must be DAY or NIGHT' });
    }
    const result = await fetchAndSendReport(shift, req.user?.companyId);
    return res.json({
      success: true,
      message: result?.message || `${shift} production report sent successfully`,
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}
