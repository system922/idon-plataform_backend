// routes/odontologia/ortodonciasUploadRoutes.js
import express from 'express';
import { upload, multerErrorHandler } from '../../config/multer.js';
import { uploadImages } from '../../controllers/odontologia/ortodonciasUploadController.js';

const router = express.Router();

// POST /api/odontologia/ortodoncias/upload - Subir imágenes
router.post('/', upload.array('fotos', 10), multerErrorHandler, uploadImages);

export default router;