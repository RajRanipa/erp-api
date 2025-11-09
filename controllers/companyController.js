// backend-api/controllers/companyController.js
// Controllers: createCompany, getCompanies, getCompanyById, updateCompany, deleteCompany

import Company from '../models/Company.js';
import User from '../models/User.js';
import { handleError } from '../utils/errorHandler.js';
import { ACCESS_TOKEN_EXPIRE_MINUTES, generateAccessToken } from '../utils/tokenUtils.js';

// Helper: ensure the authenticated user can access the given company
function assertCompanyAccess(req, companyDoc) {
  if (!companyDoc) return false;
  const user = req.user;
  if (!user) return false;
  // Basic rule: user can access only their own company
  return String(companyDoc._id) === String(user.companyId);
}

// Internal: apply allowed updates onto a company doc
function applyCompanyUpdates(company, body = {}) {
  const {
    companyName,
    workspaceName,
    industry,
    enabledModules,
    address,
    taxInfo,
    currency,
    timezone,
    dateFormat,
    fiscalYearStart,
    logoUrl,
    isSetupCompleted,
    setupProgress,
  } = body;

  if (companyName !== undefined) company.companyName = companyName;
  if (workspaceName !== undefined) company.workspaceName = workspaceName;
  if (industry !== undefined) company.industry = industry;
  if (Array.isArray(enabledModules)) company.enabledModules = enabledModules;
  if (currency !== undefined) company.currency = currency;
  if (timezone !== undefined) company.timezone = timezone;
  if (typeof dateFormat === 'string' && dateFormat.trim() !== '') company.dateFormat = dateFormat.trim();
  if (typeof fiscalYearStart === 'string' && fiscalYearStart.trim() !== '') company.fiscalYearStart = fiscalYearStart.trim();
  if (logoUrl !== undefined) company.logoUrl = logoUrl;
  if (typeof isSetupCompleted === 'boolean') company.isSetupCompleted = isSetupCompleted;

  if (address && typeof address === 'object') {
    company.address = { ...company.address?.toObject?.(), ...address };
  }
  if (taxInfo && typeof taxInfo === 'object') {
    company.taxInfo = { ...company.taxInfo?.toObject?.(), ...taxInfo };
  }
  // console.log('setupProgress', setupProgress);
  if (setupProgress && typeof setupProgress === 'object') {
    company.setupProgress = {
      ...(company.setupProgress || {}),
      ...Object.keys(setupProgress).reduce((acc, k) => ({ ...acc, [k]: !!setupProgress[k] }), {}),
    };
  }

  // recompute step counter
  const completed = Object.values(company.setupProgress || {}).filter(Boolean).length;
  company.setupStepCompleted = completed;
}

// GET /api/company/me — tenant-scoped fetch
export async function getCompanyMe(req, res) {
  // console.log('getCompanyMe user');
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }
    if (!user.companyId) {
      return res.status(404).json({ status: false, message: 'No company linked to this user' });
    }
    const company = await Company.findById(user.companyId);
    if (!company) {
      return res.status(404).json({ status: false, message: 'Company not found' });
    }
    return res.status(200).json({ status: true, message: 'Company fetched successfully', data: company });
  } catch (error) {
    return handleError(res, error);
  }
}

// PATCH /api/company/me — tenant-scoped update
export async function updateCompanyMe(req, res) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }
    if (!user.companyId) {
      return res.status(404).json({ status: false, message: 'No company linked to this user' });
    }
    const company = await Company.findById(user.companyId);
    if (!company) {
      return res.status(404).json({ status: false, message: 'Company not found' });
    }

    applyCompanyUpdates(company, req.body || {});
    const saved = await company.save();
    return res.status(200).json({ status: true, message: 'Company updated', data: saved });
  } catch (error) {
    return handleError(res, error);
  }
}

// POST /api/company/me/finish — finalize setup (validates required parts)
export async function finishCompanySetup(req, res) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }
    if (!user.companyId) {
      return res.status(404).json({ status: false, message: 'No company linked to this user' });
    }
    const company = await Company.findById(user.companyId);
    if (!company) {
      return res.status(404).json({ status: false, message: 'Company not found' });
    }

    // Validate minimal completion (address, taxInfo, localization, modules)
    const problems = [];
    const a = company.address || {};
    const t = company.taxInfo || {};

    if (!company.companyName || !company.companyName.trim()) problems.push('companyName');

    if (!a.country) problems.push('address.country');
    if (!a.state) problems.push('address.state');
    if (!a.city) problems.push('address.city');
    if (!a.street) problems.push('address.street');
    if (!a.postalCode) problems.push('address.postalCode');

    if (!t.panNumber) problems.push('taxInfo.panNumber');
    if (!t.gstNumber) problems.push('taxInfo.gstNumber');

    if (!company.currency) problems.push('currency');
    if (!company.timezone) problems.push('timezone');
    if (!Array.isArray(company.enabledModules) || company.enabledModules.length === 0) problems.push('enabledModules');

    if (problems.length) {
      return res.status(400).json({ status: false, message: 'Setup not complete', missing: problems });
    }

    // Mark all known steps as done and complete setup
    company.isSetupCompleted = true;
    company.setupProgress = {
      ...(company.setupProgress || {}),
      companyBasics: true,
      address: true,
      taxInfo: true,
      localization: true,
      logo: company.logoUrl ? true : (company.setupProgress?.logo || false),
      modules: true,
    };
    const completed = Object.values(company.setupProgress).filter(Boolean).length;
    company.setupStepCompleted = completed;

    const saved = await company.save();
    return res.status(200).json({ status: true, message: 'Company setup finished', data: saved });
  } catch (error) {
    return handleError(res, error);
  }
}

// POST /api/company
export async function createCompany(req, res) {
  try {
    const user = req.user; // set by auth middleware from token
    if (!user) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    // Only allow creation if user has no company yet
    if (user.companyId) {
      return res.status(400).json({ status: false, message: 'Company already exists for this user' });
    }

    const {
      companyName,
      workspaceName,
      industry,
      // allow both client keys; schema uses `email`
      companyEmail,
      email,
      phone,
      enabledModules = [],
      address = {},
      taxInfo = {},
      currency = 'USD',
      timezone = 'UTC',
      dateFormat = 'DD/MM/YYYY',
      fiscalYearStart = 'April',
      logoUrl,
      setupProgress = {},
    } = req.body || {};

    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ status: false, message: 'Company name is required' });
    }

    if (!industry || !industry.trim()) {
      return res.status(400).json({ status: false, message: 'Industry is required' });
    }

    const resolvedEmail = (companyEmail ?? email ?? '').trim();
    if (!resolvedEmail) {
      return res.status(400).json({ status: false, message: 'Email is required' });
    }

    const resolvedPhoneRaw = typeof phone === 'string' ? phone.trim() : phone;
    const resolvedPhone = resolvedPhoneRaw === '' || resolvedPhoneRaw === undefined ? NaN : Number(resolvedPhoneRaw);
    if (!Number.isFinite(resolvedPhone)) {
      return res.status(400).json({ status: false, message: 'Phone must be a valid number' });
    }

    const company = await Company.create({
      companyName: companyName.trim(),
      workspaceName: workspaceName?.trim?.() || undefined,
      industry: industry?.trim?.() || undefined,
      email: resolvedEmail,
      phone: resolvedPhone,
      enabledModules,
      isSetupCompleted: false,
      setupStepCompleted: 0,
      setupProgress: { ...setupProgress, companyBasics: true },
      address: {
        street: address.street || '',
        city: address.city || '',
        state: address.state || '',
        country: address.country || '',
        postalCode: address.postalCode || '',
      },
      taxInfo: {
        gstNumber: taxInfo.gstNumber || '',
        panNumber: taxInfo.panNumber || '',
        taxRegion: taxInfo.taxRegion || '',
      },
      currency: currency || 'USD',
      timezone: timezone || 'UTC',
      dateFormat: (dateFormat || 'DD/MM/YYYY').trim(),
      fiscalYearStart: (fiscalYearStart || 'April').trim(),
      logoUrl: logoUrl || undefined,
    });

    // Link user -> company
    await User.findByIdAndUpdate(
      user.id || user._id,
      { $set: { companyId: company._id }, $setOnInsert: {} },
      { new: true }
    );
    // here if company is created we need to clear old accesstoken and create new accesstoken with this company id also 
    const payload = {
      id: user._id || user.id,
      companyId: company._id || null,
      role: user.role || 'employee',
      isSetupCompleted: user.isSetupCompleted || false,
      companyId: company._id || null,
      companyName: company.companyName || null,
    };

    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
    });
    const accessToken = generateAccessToken(payload);

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
      maxAge: ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000,
    });

    return res.status(201).json({ status: true, message: 'Company created', data: company });
  } catch (error) {
    return handleError(res, error);
  }
}

// GET /api/company (scoped list)
export async function getCompanies(req, res) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    if (!user.companyId) {
      return res.status(200).json({ status: true, data: [] });
    }

    const companies = await Company.find({ _id: user.companyId });
    return res.status(200).json({ status: true, data: companies });
  } catch (error) {
    return handleError(res, error);
  }
}

// GET /api/company/:id
export async function getCompanyById(req, res) {
  // console.log('getCompanyById', req.params); // getCompanyById [Object: null prototype] { id: 'me' }
  if (req.params?.id === 'me') {
    return res.status(400).json({ status: false, message: 'Use /api/company/me for tenant-scoped access' });
  }
  try {
    const { id } = req.params;
    const company = await Company.findById(id);
    if (!company) {
      return res.status(404).json({ status: false, message: 'Company not found' });
    }
    if (!assertCompanyAccess(req, company)) {
      return res.status(403).json({ status: false, message: 'Forbidden' });
    }
    return res.status(200).json({ status: true, data: company });
  } catch (error) {
    return handleError(res, error);
  }
}

// PATCH /api/company/:id  (or /api/company/me routed to this handler after resolving id)
export async function updateCompany(req, res) {
  // console.log('updateCompany called', req.body); // updateCompany called [Object: null prototype] {}
  try {
    const { companyId } = req.user;
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ status: false, message: 'Company not found' });
    }
    if (!assertCompanyAccess(req, company)) {
      return res.status(403).json({ status: false, message: 'Forbidden' });
    }

    // Only allow specific fields to be updated
    const {
      companyName,
      workspaceName,
      industry,
      enabledModules,
      address,
      taxInfo,
      currency,
      timezone,
      dateFormat,
      fiscalYearStart,
      logoUrl,
      isSetupCompleted,
      setupProgress,
    } = req.body || {};

    if (companyName !== undefined) company.companyName = companyName;
    if (workspaceName !== undefined) company.workspaceName = workspaceName;
    if (industry !== undefined) company.industry = industry;
    if (Array.isArray(enabledModules)) company.enabledModules = enabledModules;
    if (currency !== undefined) company.currency = currency;
    if (timezone !== undefined) company.timezone = timezone;
    if (typeof dateFormat === 'string' && dateFormat.trim() !== '') company.dateFormat = dateFormat.trim();
    if (typeof fiscalYearStart === 'string' && fiscalYearStart.trim() !== '') company.fiscalYearStart = fiscalYearStart.trim();
    if (logoUrl !== undefined) company.logoUrl = logoUrl;
    if (typeof isSetupCompleted === 'boolean') company.isSetupCompleted = isSetupCompleted;

    if (address && typeof address === 'object') {
      company.address = { ...company.address?.toObject?.(), ...address };
    }
    if (taxInfo && typeof taxInfo === 'object') {
      company.taxInfo = { ...company.taxInfo?.toObject?.(), ...taxInfo };
    }
    // Merge setupProgress flags (logical OR merge)
    if (setupProgress && typeof setupProgress === 'object') {
      company.setupProgress = {
        ...(company.setupProgress || {}),
        ...Object.keys(setupProgress).reduce((acc, k) => ({ ...acc, [k]: !!setupProgress[k] }), {}),
      };
      // console.log('setupProgress', setupProgress); 
      // console.log('company.setupProgress', company.setupProgress); 

      // naive step counter: count true flags
      const completed = Object.values(company.setupProgress).filter(Boolean).length;
      company.setupStepCompleted = completed;
    }

    const saved = await company.save();
    return res.status(200).json({ status: true, message: 'Company updated', data: saved });
  } catch (error) {
    return handleError(res, error);
  }
}

// DELETE /api/company/:id
export async function deleteCompany(req, res) {
  try {
    const { id } = req.params;
    const company = await Company.findById(id);
    if (!company) {
      return res.status(404).json({ status: false, message: 'Company not found' });
    }
    if (!assertCompanyAccess(req, company)) {
      return res.status(403).json({ status: false, message: 'Forbidden' });
    }

    // Optional: only owner can delete
    if (req.user?.role !== 'owner' && req.user?.role !== 'admin') {
      return res.status(403).json({ status: false, message: 'Only owner/admin can delete company' });
    }

    await Company.findByIdAndDelete(id);

    // Unlink the requesting user (and optionally all users of this tenant)
    await User.updateMany({ companyId: id }, { $unset: { companyId: 1 } });

    return res.status(200).json({ status: true, message: 'Company deleted' });
  } catch (error) {
    return handleError(res, error);
  }
}
export async function finishCompany(req, res) {
  try {
    const user = req.user;
    // console.log("user", user);
    // return; // <-- REMOVE this line so function continues
    if (!user) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }
    if (!user.companyId) {
      return res.status(404).json({ status: false, message: 'No company linked to this user' });
    }

    const company = await Company.findById(user.companyId);
    if (!company) {
      return res.status(404).json({ status: false, message: 'Company not found' });
    }

    // Optional: allow last-moment partial updates coming in the body
    if (req.body && Object.keys(req.body).length) {
      applyCompanyUpdates(company, req.body);
    }

    // Validate minimal completion
    const problems = [];
    const a = company.address || {};
    const t = company.taxInfo || {};

    if (!company.companyName || !company.companyName.trim()) problems.push('companyName');

    if (!a.country) problems.push('address.country');
    if (!a.state) problems.push('address.state');
    if (!a.city) problems.push('address.city');
    if (!a.street) problems.push('address.street');
    if (!a.postalCode) problems.push('address.postalCode');

    if (!t.panNumber) problems.push('taxInfo.panNumber');
    if (!t.gstNumber) problems.push('taxInfo.gstNumber');

    if (!company.currency) problems.push('currency');
    if (!company.timezone) problems.push('timezone');
    if (!Array.isArray(company.enabledModules) || company.enabledModules.length === 0) problems.push('enabledModules');

    // Optional but recommended for localization step
    if (!company.dateFormat) problems.push('dateFormat');
    if (!company.fiscalYearStart) problems.push('fiscalYearStart');

    if (problems.length) {
      return res.status(400).json({ status: false, message: 'Setup not complete', missing: problems });
    }

    // Mark setup as complete & ensure all known steps are true
    company.isSetupCompleted = true;
    company.setupProgress = {
      ...(company.setupProgress || {}),
      companyBasics: true,
      address: true,
      taxInfo: true,
      localization: true,
      logo: company.logoUrl ? true : (company.setupProgress?.logo || false),
      modules: true,
    };
    const completed = Object.values(company.setupProgress).filter(Boolean).length;
    company.setupStepCompleted = completed;

    const saved = await company.save();

    // Mirror isSetupCompleted to the User document (true at this point)
    try {
      await User.findByIdAndUpdate(
        user.id || user._id,
        { $set: { isSetupCompleted: true } },
        { new: true }
      );
    } catch (e) {
      console.warn('Failed to mirror isSetupCompleted to User in finishCompany:', e?.message);
    }

    // Refresh access token with updated flags
    const payload = {
      id: user._id || user.id,
      companyId: saved._id,
      role: user.role || 'employee',
      isSetupCompleted: true,
      companyName: saved.companyName,
    };

    // rotate cookie
    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name?.includes('localhost') ? '' : process.env.Domain_Name,
    });
    const accessToken = generateAccessToken(payload);
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name?.includes('localhost') ? '' : process.env.Domain_Name,
      maxAge: ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000,
    });

    return res.status(200).json({ status: true, message: 'Company setup finished', data: saved });
  } catch (error) {
    return handleError(res, error);
  }
}

export default {
  createCompany,
  getCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
  getCompanyMe,
  updateCompanyMe,
  finishCompanySetup,
  finishCompany
};