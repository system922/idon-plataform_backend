/**
 * registerController.js
 *
 * Two flows:
 *  A) New owner (ownerExists = false):
 *     1. Validate required fields incl. password
 *     2. Check duplicates (email, document)
 *     3. Hash password → INSERT public.users
 *     4. INSERT public.business_owners
 *     5. INSERT public.business_registration_requests
 *
 *  B) Existing owner (ownerExists = true):
 *     1. Validate required fields (no password needed)
 *     2. Lookup existing business_owner by documentType + documentNumber
 *     3. INSERT public.business_registration_requests linking to existing owner
 */

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getClient } from '../config/database.js';
import logger from '../utils/logger.js';
import { notifyRegistro } from '../utils/waNotifications.js';

/* ─── Helpers ─────────────────────────────────────────────── */

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

async function uniqueSlug(client, base) {
  let slug = base;
  for (let i = 0; i < 10; i++) {
    const { rows } = await client.query(
      'SELECT id FROM public.business_registration_requests WHERE slug = $1',
      [slug]
    );
    if (rows.length === 0) return slug;
    slug = `${base}-${Math.random().toString(36).substring(2, 6)}`;
  }
  return slug;
}

/* ─── Controller ──────────────────────────────────────────── */

export const submitRegistration = async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    phone,
    password,
    businessName,
    businessTypeId,
    businessSlug,
    documentType   = 'cedula',
    documentNumber,
    ownerExists    = false,
  } = req.body;

  /* 1. Validación común */
  const missing = [];
  if (!firstName)      missing.push('firstName');
  if (!lastName)       missing.push('lastName');
  if (!businessName)   missing.push('businessName');
  if (!businessTypeId) missing.push('businessTypeId');
  if (!documentNumber) missing.push('documentNumber');

  /* Password only required for new owners */
  if (!ownerExists) {
    if (!email)    missing.push('email');
    if (!password) missing.push('password');
  }

  if (missing.length > 0) {
    return res.status(400).json({
      ok: false,
      message: `Campos requeridos faltantes: ${missing.join(', ')}`
    });
  }

  if (!ownerExists && password.length < 8) {
    return res.status(400).json({
      ok: false,
      message: 'La contraseña debe tener al menos 8 caracteres'
    });
  }

  const docNumClean  = documentNumber.trim();
  const docTypeClean = (documentType || 'cedula').trim();

  const client = await getClient();

  try {
    await client.query('BEGIN');

    /* ── FLOW B: Existing owner ──────────────────────────────── */
    if (ownerExists) {
      // Find the existing business_owner
      const { rows: ownerRows } = await client.query(
        `SELECT id, user_id, first_name, last_name, email
         FROM public.business_owners
         WHERE document_type = $1 AND document_number = $2
         LIMIT 1`,
        [docTypeClean, docNumClean]
      );

      if (ownerRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          ok: false,
          message: 'No se encontró el propietario con ese documento. Por favor completa tu registro.'
        });
      }

      const existingOwner = ownerRows[0];

      /* Verify businessTypeId */
      const { rows: btRows } = await client.query(
        'SELECT id FROM public.business_types WHERE id = $1 AND is_active = TRUE',
        [businessTypeId]
      );
      if (btRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, message: 'El tipo de negocio seleccionado no es válido' });
      }

      /* Check: same owner hasn't already submitted a pending request for this exact business name */
      const { rows: dupRows } = await client.query(
        `SELECT id FROM public.business_registration_requests
         WHERE business_owner_id = $1
           AND LOWER(business_name) = LOWER($2)
           AND status IN ('pending','approved')
         LIMIT 1`,
        [existingOwner.id, businessName.trim()]
      );
      if (dupRows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          ok: false,
          message: 'Ya tienes una solicitud pendiente o aprobada para ese nombre de negocio'
        });
      }

      /* INSERT business_registration_request */
      const slug      = await uniqueSlug(client, slugify(businessSlug || businessName));
      const requestId = uuidv4();

      await client.query(
        `INSERT INTO public.business_registration_requests
           (id, slug, business_name, business_type_id,
            user_id, business_owner_id,
            owner_first_name, owner_last_name, owner_email,
            owner_document_type, owner_document_number, owner_phone,
            status, requested_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',NOW(),NOW(),NOW())`,
        [
          requestId, slug, businessName.trim(), businessTypeId,
          existingOwner.user_id, existingOwner.id,
          existingOwner.first_name, existingOwner.last_name, existingOwner.email,
          docTypeClean, docNumClean, phone?.trim() || null,
        ]
      );

      await client.query('COMMIT');

      logger.info(`[REGISTRO-EXISTENTE] owner=${existingOwner.id} request=${requestId}`);

      res.status(201).json({
        ok: true,
        message: 'Solicitud enviada. Un administrador la revisará pronto.',
        data: {
          ownerId: existingOwner.id,
          userId: existingOwner.user_id,
          requestId,
          slug,
          status: 'pending'
        }
      });

      notifyRegistro(phone?.trim() || null, {
        firstName:    firstName?.trim() || '',
        lastName:     lastName?.trim()  || '',
        email:        existingOwner.email,
        businessName: businessName.trim(),
        businessSlug: slug,
      });

      return;
    }

    /* ── FLOW A: New owner ───────────────────────────────────── */
    const emailClean = email.toLowerCase().trim();

    /* 2a. Email duplicado en public.users */
    const { rows: userRows } = await client.query(
      'SELECT id FROM public.users WHERE email = $1',
      [emailClean]
    );
    if (userRows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, message: 'Ya existe una cuenta con ese correo electrónico' });
    }

    /* 2b. Email duplicado en public.business_owners */
    const { rows: ownerEmailRows } = await client.query(
      'SELECT id FROM public.business_owners WHERE email = $1',
      [emailClean]
    );
    if (ownerEmailRows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, message: 'Ya existe una solicitud con ese correo electrónico' });
    }

    /* 2c. Documento duplicado en public.business_owners (same owner trying to re-register as new) */
    const { rows: ownerDocRows } = await client.query(
      'SELECT id FROM public.business_owners WHERE document_type = $1 AND document_number = $2',
      [docTypeClean, docNumClean]
    );
    if (ownerDocRows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        ok: false,
        message: 'Ese número de documento ya está registrado. Si deseas agregar otro negocio, usa el mismo cedula para identificarte en el paso 1.'
      });
    }

    /* 3. Verificar businessTypeId */
    const { rows: btRows } = await client.query(
      'SELECT id FROM public.business_types WHERE id = $1 AND is_active = TRUE',
      [businessTypeId]
    );
    if (btRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, message: 'El tipo de negocio seleccionado no es válido' });
    }

    /* 4. Hash contraseña */
    const passwordHash = await bcrypt.hash(password, 12);

    /* 5. INSERT public.users */
    const userId = uuidv4();
    await client.query(
      `INSERT INTO public.users
         (id, email, first_name, last_name, phone,
          document_type, document_number,
          password_hash, is_active, email_verified,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,FALSE,NOW(),NOW())`,
      [userId, emailClean, firstName.trim(), lastName.trim(),
       phone?.trim() || null, docTypeClean, docNumClean, passwordHash]
    );

    /* 6. INSERT public.business_owners */
    const ownerId = uuidv4();
    await client.query(
      `INSERT INTO public.business_owners
         (id, user_id, first_name, last_name, email, phone,
          document_type, document_number,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
      [ownerId, userId, firstName.trim(), lastName.trim(),
       emailClean, phone?.trim() || null, docTypeClean, docNumClean]
    );

    /* 7. INSERT public.business_registration_requests */
    const slug      = await uniqueSlug(client, slugify(businessName));
    const requestId = uuidv4();

    await client.query(
      `INSERT INTO public.business_registration_requests
         (id, slug, business_name, business_type_id,
          user_id, business_owner_id,
          owner_first_name, owner_last_name, owner_email,
          owner_document_type, owner_document_number, owner_phone,
          status, requested_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',NOW(),NOW(),NOW())`,
      [
        requestId, slug, businessName.trim(), businessTypeId,
        userId, ownerId,
        firstName.trim(), lastName.trim(), emailClean,
        docTypeClean, docNumClean, phone?.trim() || null,
      ]
    );

    await client.query('COMMIT');

    logger.info(`[REGISTRO] user=${userId} owner=${ownerId} request=${requestId} email=${emailClean}`);

    res.status(201).json({
      ok: true,
      message: 'Solicitud enviada. Un administrador la revisará pronto.',
      data: { userId, ownerId, requestId, slug, status: 'pending' }
    });

    notifyRegistro(phone?.trim() || null, {
      firstName:    firstName.trim(),
      lastName:     lastName.trim(),
      email:        emailClean,
      businessName: businessName.trim(),
      businessSlug: slug,
    });

    return;

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, code: err?.code, detail: err?.detail }, '[REGISTRO] Error');

    if (err.code === '23505') {
      const d = err.detail || '';
      if (d.includes('email'))           return res.status(409).json({ ok: false, message: 'Ese correo ya está registrado' });
      if (d.includes('document_number')) return res.status(409).json({ ok: false, message: 'Ese número de documento ya está registrado' });
      if (d.includes('slug'))            return res.status(409).json({ ok: false, message: 'Ese nombre de negocio ya existe, prueba con otro' });
    }

    return res.status(500).json({ ok: false, message: 'Error interno. Intenta de nuevo más tarde.' });

  } finally {
    client.release();
  }
};
