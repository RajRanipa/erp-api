import express from 'express';
import auth  from '../middleware/authMiddleware.js';
import { uploadLogoMulter, uploadCompanyLogo } from '../controllers/uploadController.js';

const router = express.Router();

// Must be authenticated (we name field 'file')
router.post('/logo', auth, (req, res, next) => {
  uploadLogoMulter(req, res, function (err) {
    if (err) {
      return res.status(400).json({ status: false, message: err.message });
    }
    next();
  });
}, uploadCompanyLogo);

export default router;