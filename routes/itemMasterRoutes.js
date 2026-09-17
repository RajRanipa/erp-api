import express from 'express';
import {
  changeMasterItemStatus,
  createAttributeDefinition,
  createItemClass,
  createItemFamily,
  createMasterItem,
  deleteMasterItem,
  getFamilyForm,
  getItemMasterSetup,
  getMasterItem,
  getMasterItemEditContext,
  getMasterItemDeletionAssessment,
  listMasterItems,
  listMasterItemOptions,
  updateItemFamily,
  updateMasterItem,
} from '../controllers/itemMasterController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(auth);

router.get('/setup', roleAuth('items:read'), getItemMasterSetup);
router.post('/classes', roleAuth('items:update'), createItemClass);
router.post('/attributes', roleAuth('items:update'), createAttributeDefinition);
router.post('/families', roleAuth('items:update'), createItemFamily);
router.put('/families/:id', roleAuth('items:update'), updateItemFamily);
router.get('/families/:id/form', roleAuth('items:read'), getFamilyForm);

router.get('/items', roleAuth('items:read'), listMasterItems);
router.get('/items/options', roleAuth('items:read'), listMasterItemOptions);
router.post('/items', roleAuth('items:create'), createMasterItem);
router.get(
  '/items/:id/deletion-assessment',
  roleAuth('items:delete'),
  getMasterItemDeletionAssessment,
);
router.get('/items/:id/edit-context', roleAuth('items:read'), getMasterItemEditContext);
router.get('/items/:id', roleAuth('items:read'), getMasterItem);
router.put('/items/:id', roleAuth('items:update'), updateMasterItem);
router.patch('/items/:id/status', roleAuth('items:status:update'), changeMasterItemStatus);
router.delete('/items/:id', roleAuth('items:delete'), deleteMasterItem);

export default router;
