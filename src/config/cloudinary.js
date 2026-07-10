// src/config/cloudinary.js
import { v2 as cloudinary } from 'cloudinary';

// Configurar Cloudinary usando CLOUDINARY_URL
cloudinary.config({
  cloudinary_url: process.env.CLOUDINARY_URL,
});


export default cloudinary;