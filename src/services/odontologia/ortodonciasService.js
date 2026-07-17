import * as ortodonciasModel from '../../models/odontologia/ortodonciasModel.js';
import * as fotosModel from '../../models/odontologia/ortodonciaFotografiasModel.js';
import cloudinary from '../../config/cloudinary.js';

// ============================================================
// SUBIR IMÁGENES A CLOUDINARY
// ============================================================
export const uploadImages = async (files, pacienteId) => {
  const results = [];
  for (const file of files) {
    try {
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: `odontologia/ortodoncia/${pacienteId}`,
            transformation: [{ quality: 'auto:good' }],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(file.buffer);
      });
      results.push({
        nombre_archivo: file.originalname,
        image_url: result.secure_url,
      });
    } catch (err) {
      console.error('❌ Error subiendo imagen a Cloudinary:', err);
      throw new Error(`Error al subir imagen: ${err.message}`);
    }
  }
  return results;
};

// ============================================================
// LISTAR TODAS
// ============================================================
export const getAll = async (schema) => {
  try {
    return await ortodonciasModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar ortodoncias: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR PACIENTE
// ============================================================
export const getByPatientId = async (schema, patientId) => {
  try {
    if (!patientId) throw new Error('El ID del paciente es obligatorio');
    const ortodoncia = await ortodonciasModel.findByPatientId(schema, patientId);
    if (ortodoncia) {
      const fotos = await fotosModel.findByOrtodonciaId(schema, ortodoncia.id);
      ortodoncia.fotografias = fotos;
    }
    return ortodoncia;
  } catch (error) {
    throw new Error(`Error al obtener ortodoncia: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const getById = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const ortodoncia = await ortodonciasModel.findById(schema, id);
    if (ortodoncia) {
      const fotos = await fotosModel.findByOrtodonciaId(schema, ortodoncia.id);
      ortodoncia.fotografias = fotos;
    }
    return ortodoncia;
  } catch (error) {
    throw new Error(`Error al obtener ortodoncia: ${error.message}`);
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (schema, data) => {
  try {
    if (!data.paciente_id) throw new Error('El paciente es obligatorio');

    // Si viene el array de fotos (con URLs ya subidas), las guardamos
    const fotos = data.fotografias || data.fotos || [];
    delete data.fotografias;
    delete data.fotos;

    const ortodoncia = await ortodonciasModel.insert(schema, data);

    // Guardar fotografías
    if (fotos.length > 0) {
      for (const foto of fotos) {
        await fotosModel.insert(schema, {
          ortodoncia_id: ortodoncia.id,
          nombre_archivo: foto.nombre_archivo || foto.name || 'foto',
          image_url: foto.image_url || foto.url || '',
        });
      }
    }

    return { ...ortodoncia, fotografias: fotos };
  } catch (error) {
    throw new Error(`Error al crear ortodoncia: ${error.message}`);
  }
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const update = async (schema, id, data) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');

    const existing = await ortodonciasModel.findById(schema, id);
    if (!existing) throw new Error('Ortodoncia no encontrada');

    // Separar fotos del resto de datos
    const fotos = data.fotografias || data.fotos || [];
    delete data.fotografias;
    delete data.fotos;

    // Actualizar ortodoncia
    const ortodoncia = await ortodonciasModel.updateById(schema, id, data);

    // Gestionar fotografías: eliminar las que no estén en el nuevo array
    if (fotos.length > 0) {
      // Obtener fotos actuales
      const fotosActuales = await fotosModel.findByOrtodonciaId(schema, id);
      const urlsActuales = fotosActuales.map(f => f.image_url);
      const urlsNuevas = fotos.map(f => f.image_url || f.url || '');

      // Eliminar fotos que ya no están
      for (const foto of fotosActuales) {
        if (!urlsNuevas.includes(foto.image_url)) {
          await fotosModel.deleteByOrtodonciaId(schema, id, foto.image_url);
        }
      }

      // Insertar nuevas fotos
      for (const foto of fotos) {
        const exists = fotosActuales.some(f => f.image_url === (foto.image_url || foto.url));
        if (!exists) {
          await fotosModel.insert(schema, {
            ortodoncia_id: id,
            nombre_archivo: foto.nombre_archivo || foto.name || 'foto',
            image_url: foto.image_url || foto.url || '',
          });
        }
      }
    } else {
      // Si no hay fotos, eliminar todas las existentes
      await fotosModel.deleteAllByOrtodonciaId(schema, id);
    }

    return { ...ortodoncia, fotografias: fotos };
  } catch (error) {
    throw new Error(`Error al actualizar ortodoncia: ${error.message}`);
  }
};

// ============================================================
// ELIMINAR (SOFT DELETE)
// ============================================================
export const remove = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    return await ortodonciasModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar ortodoncia: ${error.message}`);
  }
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (schema) => {
  try {
    return await ortodonciasModel.getStats(schema);
  } catch (error) {
    throw new Error(`Error al obtener estadísticas: ${error.message}`);
  }
};