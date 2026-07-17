import { uploadImages as uploadImagesService } from '../../services/odontologia/ortodonciasService.js';
import { getSchemaName } from '../../utils/tenantHelper.js';

export const uploadImages = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No se enviaron imágenes' });
    }

    const pacienteId = req.body.paciente_id || 'temp';
    const results = await uploadImagesService(files, pacienteId);
    
    res.json({
      success: true,
      data: results,
      message: 'Imágenes subidas exitosamente',
    });
  } catch (err) {
    console.error('❌ Error subiendo imágenes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};