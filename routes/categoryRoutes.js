

import express from 'express';
import { createCategory, getCategories, updateCategories, deleteCategory } from '../controllers/categoryController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(auth);
router.post('/', roleAuth('parameters:categories:create'), createCategory);
router.get('/', roleAuth('parameters:categories:read'), getCategories);
router.put('/', roleAuth('parameters:categories:update'), updateCategories);
router.delete('/:categoryId', roleAuth('parameters:categories:delete'), deleteCategory);

export default router;