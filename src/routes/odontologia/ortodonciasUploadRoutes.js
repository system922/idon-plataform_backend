import express from 'express';
import { upload, multerErrorHandler } from '../../config/multer.js';
import { uploadImages } from '../../controllers/odontologia/ortodonciasUploadController.js';

const router = express.Router();

router.post('/upload', upload.array('fotos', 10), multerErrorHandler, uploadImages);

export default router;