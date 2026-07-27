import UserAuditLog from '../models/UserAuditLog.js';

export async function recordUserAudit(req, action, {
  targetUserId = null,
  companyId = req.user?.companyId || null,
  metadata = {},
} = {}) {
  try {
    await UserAuditLog.create({
      companyId,
      actorId: req.user?.userId || null,
      targetUserId,
      action,
      metadata,
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  } catch (error) {
    console.error('User audit log failure:', error?.message || error);
  }
}

