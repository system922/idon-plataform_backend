import * as pacientesModel from '../../models/odontologia/pacientesModel.js';
import cloudinary from '../../config/cloudinary.js';

// ============================================================
// SUBIR IMAGEN A CLOUDINARY
// ============================================================
export const uploadImage = async (buffer, documentNumber) => {
  try {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'odontologia/pacientes',
          public_id: `paciente_${documentNumber}_${Date.now()}`,
          transformation: [
            { width: 400, height: 400, crop: 'fill', gravity: 'face' },
            { quality: 'auto:good' }
          ]
        },
        (error, result) => {
          if (error) {
            console.error('❌ Error en Cloudinary:', error);
            reject(error);
          } else {
            console.log('✅ Imagen subida a Cloudinary:', result.secure_url);
            resolve(result.secure_url);
          }
        }
      );
      uploadStream.end(buffer);
    });
  } catch (error) {
    console.error('❌ Error al subir imagen:', error);
    throw new Error(`Error al subir imagen: ${error.message}`);
  }
};

// ============================================================
// ELIMINAR IMAGEN DE CLOUDINARY
// ============================================================
export const deleteImage = async (imageUrl) => {
  if (!imageUrl) return;
  
  try {
    // Extraer public_id de la URL
    const parts = imageUrl.split('/');
    const filename = parts[parts.length - 1];
    const publicId = `odontologia/pacientes/${filename.split('.')[0]}`;
    
    console.log('🗑️ Eliminando imagen de Cloudinary:', publicId);
    
    const result = await cloudinary.uploader.destroy(publicId);
    console.log('✅ Imagen eliminada:', result);
  } catch (error) {
    console.error('❌ Error al eliminar imagen de Cloudinary:', error);
    // No lanzamos error para no interrumpir el flujo
  }
};

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  try {
    return await pacientesModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar pacientes: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const getById = async (schema, id) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }
    const paciente = await pacientesModel.findById(schema, id);
    if (!paciente) {
      throw new Error('Paciente no encontrado');
    }
    return paciente;
  } catch (error) {
    throw new Error(`Error al obtener paciente: ${error.message}`);
  }
};

// ============================================================
// BUSCAR
// ============================================================
export const search = async (schema, term) => {
  try {
    if (!term || term.trim().length < 2) {
      throw new Error('La búsqueda debe tener al menos 2 caracteres');
    }
    return await pacientesModel.search(schema, term.trim());
  } catch (error) {
    throw new Error(`Error al buscar pacientes: ${error.message}`);
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (schema, data, fileBuffer = null) => {
  try {
    // Validaciones
    if (!data.document_number) {
      throw new Error('La cédula es obligatoria');
    }
    if (data.document_number.length !== 10) {
      throw new Error('La cédula debe tener 10 dígitos');
    }
    if (!data.first_name) {
      throw new Error('El nombre es obligatorio');
    }
    if (!data.last_name) {
      throw new Error('El apellido es obligatorio');
    }

    // Verificar que la cédula no esté duplicada
    const existing = await pacientesModel.findByDocument(schema, data.document_number);
    if (existing) {
      throw new Error('Ya existe un paciente con esta cédula');
    }

    // Subir imagen si se proporciona
    let imageUrl = null;
    if (fileBuffer) {
      imageUrl = await uploadImage(fileBuffer, data.document_number);
    }

    const pacienteData = {
      ...data,
      image_url: imageUrl,
    };

    return await pacientesModel.insert(schema, pacienteData);
  } catch (error) {
    throw new Error(`Error al crear paciente: ${error.message}`);
  }
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const update = async (schema, id, data, fileBuffer = null) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }

    // Verificar que existe
    const existing = await pacientesModel.findById(schema, id);
    if (!existing) {
      throw new Error('Paciente no encontrado');
    }

    // Si se envía cédula, verificar que no esté duplicada
    if (data.document_number && data.document_number !== existing.document_number) {
      const duplicated = await pacientesModel.findByDocument(schema, data.document_number);
      if (duplicated) {
        throw new Error('Ya existe un paciente con esta cédula');
      }
    }

    // Subir nueva imagen si se proporciona
    let imageUrl = existing.image_url;
    if (fileBuffer) {
      // Eliminar imagen anterior
      if (existing.image_url) {
        await deleteImage(existing.image_url);
      }
      imageUrl = await uploadImage(fileBuffer, data.document_number || existing.document_number);
      data.image_url = imageUrl;
    }

    return await pacientesModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar paciente: ${error.message}`);
  }
};

// ============================================================
// ELIMINAR
// ============================================================
export const remove = async (schema, id) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }

    // Verificar que existe
    const existing = await pacientesModel.findById(schema, id);
    if (!existing) {
      throw new Error('Paciente no encontrado');
    }

    // Eliminar imagen de Cloudinary
    if (existing.image_url) {
      await deleteImage(existing.image_url);
    }

    return await pacientesModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar paciente: ${error.message}`);
  }
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (schema) => {
  try {
    return await pacientesModel.getStats(schema);
  } catch (error) {
    throw new Error(`Error al obtener estadísticas: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR CÉDULA
// ============================================================
export const getByDocument = async (schema, documentNumber) => {
  try {
    if (!documentNumber) {
      throw new Error('La cédula es obligatoria');
    }
    return await pacientesModel.findByDocument(schema, documentNumber);
  } catch (error) {
    throw new Error(`Error al buscar por cédula: ${error.message}`);
  }
};