import express from 'express';
import auth, { roleAuth } from '../middleware/authMiddleware.js';
import {
  createRole,
  deleteRole,
  getRolePermissions,
  getRolePermissionsbyRole,
  listPermissions,
  listAssignableRoles,
  listRoles,
  setRolePermissions,
  updateRole,
} from '../controllers/permissionsController.js';

const router = express.Router();
router.use(auth);

router.get('/by-role', getRolePermissionsbyRole);
router.get('/assignable-roles', listAssignableRoles);
router.get('/roles', roleAuth('roles:read'), listRoles);
router.post('/roles', roleAuth('roles:create'), createRole);
router.patch('/roles/:id', roleAuth('roles:update'), updateRole);
router.delete('/roles/:id', roleAuth('roles:delete'), deleteRole);
router.put('/roles/:id/permissions', roleAuth('roles:permissions:update'), setRolePermissions);
router.get('/role/:role', roleAuth('roles:read'), getRolePermissions);
router.post('/role/set', roleAuth('roles:permissions:update'), setRolePermissions);
router.get('/', roleAuth('permissions:read'), listPermissions);

export default router;
