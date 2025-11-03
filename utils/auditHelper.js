// backend-api/utils/auditHelper.js
export const applyAuditCreate = (req, data = {}) => ({
  ...data,
  createdBy: req.user?.id || req.user?._id,
  updatedBy: req.user?.id || req.user?._id,
  companyId: req.user?.companyId,
});

export const applyAuditUpdate = (req, data = {}) => ({
  ...data,
  updatedBy: req.user?._id,
});