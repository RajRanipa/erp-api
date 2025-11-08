

import express from 'express';
import { createCategory, getCategories } from '../controllers/categoryController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(auth);
router.post('/', roleAuth('items:categories:create'), createCategory);
router.get('/', roleAuth('items:categories:read'), getCategories);

export default router;