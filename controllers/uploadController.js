// backend-api/controllers/uploadController.js

import path from 'path';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import Company from '../models/Company.js';
// import {getLocalIP} from '../server.js'
// Allowed mime types for logos
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const MAX_BYTES = 2 * 1024 * 1024; // 2MB

// Disk storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Resolve to `<project>/backend-api/uploads` when running from backend-api dir,
    // and to `<project>/uploads` if process.cwd() is the backend-api dir already.
    const cwd = process.cwd();
    const base = path.basename(cwd) === 'backend-api' ? cwd : path.join(cwd, 'backend-api');
    const dir = path.join(base, 'uploads');
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Example: <companyId>-<hash>-<timestamp>.<ext>
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    const hash = crypto.createHash('sha1').update(`${file.originalname}-${Date.now()}`).digest('hex').slice(0, 10);
    const companyId = (req.user?.companyId || 'anon').toString();
    cb(null, `${companyId}-${hash}-${Date.now()}${ext}`);
  }
});

// Multer instance with size limit and basic filter
export const uploadLogoMulter = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('Only PNG, JPEG, WEBP, SVG are allowed'));
    }
    cb(null, true);
  }
}).single('file'); // frontend must send field name 'file'

// Controller: handle upload and return a public URL
export async function uploadCompanyLogo(req, res) {
  console.log('uploadCompanyLogo');
  try {
    if (!req.user) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }
    if (!req.file) {
      return res.status(400).json({ status: false, message: 'No file received' });
    }

    // Build public URL
    const baseUrl = process.env.PUBLIC_BASE_URL ||'http://localhost:1122';
    const publicUrl = `${baseUrl}/uploads/${req.file.filename}`;

    // Persist on company immediately
    try {
      if (req.user?.companyId) {
        const company = await Company.findById(req.user.companyId);
        if (company) {
          company.logoUrl = publicUrl;
          const currentProgress = company.setupProgress?.toObject?.() || company.setupProgress || {};
          company.setupProgress = { ...currentProgress, logo: true };
          company.markModified && company.markModified('setupProgress');
          await company.save();
        }
      }
    } catch (persistErr) {
      console.error('Failed to persist logoUrl to company:', persistErr?.message || persistErr);
      // Don't fail the upload response because of a persistence issue
    }

    return res.status(201).json({
      status: true,
      message: 'Logo uploaded',
      data: {
        url: publicUrl,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        filename: req.file.filename,
      }
    });
  } catch (err) {
    return res.status(400).json({ status: false, message: err.message || 'Upload failed' });
  }
}