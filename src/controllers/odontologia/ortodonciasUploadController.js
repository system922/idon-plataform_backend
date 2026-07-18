// controllers/odontologia/ortodonciasUploadController.js
import { getSchemaName } from '../../utils/tenantHelper.js';
import cloudinary from '../../config/cloudinary.js';
import * as ortodonciasService from '../../services/odontologia/ortodonciasService.js';

const getSchema = async (req) => {
  return await getSchemaName(req);
};

// ============================================================
// SUBIR IMÁGENES A CLOUDINARY
// ============================================================
const uploadToCloudinary = (buffer, pacienteId, fileName) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `odontologia/ortodoncia/${pacienteId}`,
        public_id: `${Date.now()}_${fileName.split('.')[0]}`,
        transformation: [
          { width: 800, height: 600, crop: 'limit', quality: 'auto:good' }
        ]
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
    uploadStream.end(buffer);
  });
};

// ============================================================
// SUBIR IMÁGENES
// ============================================================
export const uploadImages = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { paciente_id } = req.body;
    
    if (!paciente_id) {
      return res.status(400).json({
        success: false,
        error: 'paciente_id es requerido',
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No se subieron archivos',
      });
    }

    const uploadedFiles = [];

    for (const file of req.files) {
      let imageUrl = '';
      let fileName = file.originalname;

      // Subir a Cloudinary
      try {
        const result = await uploadToCloudinary(file.buffer, paciente_id, fileName);
        imageUrl = result.secure_url;
      } catch (err) {
        console.error('❌ Error subiendo a Cloudinary:', err);
        // Fallback: guardar localmente
        imageUrl = `/uploads/ortodoncia/${file.filename}`;
      }

      uploadedFiles.push({
        id: `foto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        nombre_archivo: fileName,
        image_url: imageUrl,
        size: file.size,
        created_at: new Date().toISOString(),
      });
    }

    // Obtener o crear registro de ortodoncia para este paciente
    let ortodoncia = await ortodonciasService.getByPatientId(schema, paciente_id);
    
    if (ortodoncia) {
      // Actualizar fotografías existentes
      const fotosActuales = ortodoncia.fotografias || [];
      const nuevasFotos = [...uploadedFiles, ...fotosActuales];
      
      ortodoncia = await ortodonciasService.update(schema, ortodoncia.id, {
        fotografias: nuevasFotos,
      });
    } else {
      // Crear nuevo registro con las fotos
      ortodoncia = await ortodonciasService.create(schema, {
        paciente_id,
        requiere_tratamiento: false,
        estado: 'diagnostico',
        fotografias: uploadedFiles,
        diagnostico: {},
        trabajo: {},
        tratamiento: {},
        resumen: {},
      });
    }

    res.json({
      success: true,
      data: uploadedFiles,
      message: 'Imágenes subidas exitosamente',
    });
  } catch (error) {
    console.error('❌ Error en uploadImages:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};