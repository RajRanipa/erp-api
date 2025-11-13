import express from 'express';
import {
  listPermissions, listRoles, getRolePermissions,
  seedPermissions, createPermission, deletePermission,
  setRolePermissions, addRolePermissions, removeRolePermissions,
} from '../controllers/permissionsController.js';
import { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', roleAuth('users:permissions:read'), listPermissions);
router.get('/roles', roleAuth('roles:read'), listRoles);
router.get('/by-role', roleAuth('permissions:read'), getRolePermissions);
// router.post('/seed', roleAuth('users:invite:create'), seedPermissions);
router.post('/', roleAuth('users:permissions:create'), createPermission);
router.delete('/:key', roleAuth('users:permissions:delete'), deletePermission);
router.post('/role/set', roleAuth('users:permissions:update'), setRolePermissions);
router.post('/role/add', roleAuth('users:permissions:create'), addRolePermissions);
router.post('/role/remove', roleAuth('users:permissions:delete'), removeRolePermissions);

export default router;