// backend-api/utils/auditHelper.js
export const applyAuditCreate = (req, data = {}) => ({
  ...data,
  createdBy: req.user?.id || req.user?._id || req.user?.userId,
  updatedBy: req.user?.id || req.user?._id|| req.user?.userId,
  companyId: req.user?.companyId,
});

export const applyAuditUpdate = (req, data = {}) => ({
  ...data,
  updatedBy: req.user?.id || req.user?._id || req.user?.userId,
  updatedAt: new Date(),
});