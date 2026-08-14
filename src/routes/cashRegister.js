import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware, businessContextMiddleware } from '../middleware/auth.js';
import { ecuadorToday } from '../utils/dateHelper.js';
import { sendGenericEmail } from '../services/crmEmailService.js';

// ===============================
// 🔥 HELPERS PRO
// ===============================
const n = (v) => {
  const num = Number(v);
  return isNaN(num) ? 0 : num;
};

const safe = (v) => (v == null || isNaN(v) ? 0 : v);

const router = express.Router();

// ===============================
// GET /api/pos/cash-register/full-closing?date=YYYY-MM-DD
// ===============================
router.get('/full-closing', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const date = req.query.date || ecuadorToday();
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const result = await query(
      `
      SELECT
        id,
        closing_user_id,
        closing_date,
        closing_time,
        cash_counted,
        cash_system,
        diff_cash,
        transfer_counted,
        transfer_system,
        diff_transfer,
        card_counted,
        card_system,
        diff_card,
        orders_counted,
        orders_system,
        diff_orders,
        extras,
        expenses_total,
        total_counted,
        total_system,
        diff_total,
        net_system,
        net_counted,
        diff_net,
        remarks,
        created_at
      FROM "${schema}".cash_register_closing
      WHERE closing_date = $1
        AND closing_user_id = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [date, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({});
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en full-closing:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📊 SUMMARY
// ===============================
router.get('/summary', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const date = req.query.date || ecuadorToday();
    const TZ = 'America/Guayaquil';
    
    console.log(`📊 SUMMARY REQUEST: date=${date}, schema=${schema}`);

    const ventasRes = await query(
      `
      SELECT
        CASE
          WHEN LOWER(COALESCE(p.payment_method, '')) IN ('cash','efectivo','') THEN 'cash'
          WHEN LOWER(p.payment_method) IN ('transfer','transferencia','banco','banca','transferencia bancaria','transferencia electronica') THEN 'transfer'
          WHEN LOWER(p.payment_method) IN ('card','tarjeta','credit','debit','credito','debito','tarjeta de credito','tarjeta de debito') THEN 'card'
          ELSE LOWER(p.payment_method)
        END AS payment_method,
        COALESCE(SUM(p.amount), 0)::FLOAT AS total_cobrado,
        COUNT(DISTINCT p.id)::INT AS cantidad_pagos,
        COUNT(DISTINCT o.id)::INT AS ordenes_afectadas
      FROM "${schema}".pos_orders o
      INNER JOIN "${schema}".pos_payments p ON p.order_id = o.id
      WHERE
        DATE(p.paid_at AT TIME ZONE '${TZ}') = $1
        AND p.status = 'completed'
        AND o.status IN ('paid', 'completed')
      GROUP BY 
        CASE
          WHEN LOWER(COALESCE(p.payment_method, '')) IN ('cash','efectivo','') THEN 'cash'
          WHEN LOWER(p.payment_method) IN ('transfer','transferencia','banco','banca','transferencia bancaria','transferencia electronica') THEN 'transfer'
          WHEN LOWER(p.payment_method) IN ('card','tarjeta','credit','debit','credito','debito','tarjeta de credito','tarjeta de debito') THEN 'card'
          ELSE LOWER(p.payment_method)
        END
      ORDER BY payment_method
      `,
      [date]
    );

    console.log(`💰 VENTAS RESULT:`, ventasRes.rows);

    const gastosRes = await query(
      `
      SELECT
        COALESCE(ec.name, e.description, 'Gasto') AS concepto,
        e.description,
        e.amount AS monto
      FROM "${schema}".expenses e
      LEFT JOIN "${schema}".expense_categories ec ON ec.id = e.category_id
      WHERE e.date = $1
      `,
      [date]
    );

    const standardMethods = ['cash', 'transfer', 'card'];
    const metodos = [];
    
    for (const method of standardMethods) {
      const found = ventasRes.rows.find(r => r.payment_method === method);
      metodos.push(found || { payment_method: method, total_cobrado: 0, cantidad_pagos: 0, ordenes_afectadas: 0 });
    }
    
    for (const row of ventasRes.rows) {
      if (!standardMethods.includes(row.payment_method)) {
        metodos.push(row);
      }
    }

    const result = {
      metodos: metodos,
      gastos: gastosRes.rows || []
    };

    console.log(`📊 FINAL RESPONSE:`, JSON.stringify(result, null, 2));
    res.json(result);

  } catch (err) {
    console.error("❌ SUMMARY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📦 POST /closing - CIERRE COMPLETO CON INVENTARIO
// ===============================
router.post('/closing', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const {
      efectivoFisico,
      transferenciaFisico,
      tarjetaFisico,
      propinaFisico,
      date,
      remarks,
      cashDenominationCount,
      coinsDenominationCount,
      closing_user_id,
      cash_system,
      transfer_system,
      card_system,
      total_system,
      orders_system,
      expenses_total,
      total_extras,
      apertura_total,
      total_esperado,
      process_inventory = true
    } = req.body;

    const closingDate = date || ecuadorToday();
    const userId = closing_user_id || req.user?.id || req.user?.userId;
    const TZ = 'America/Guayaquil';

    console.log('📦 INICIANDO CIERRE:', { closingDate, userId, schema });

    // ✅ VERIFICAR SI YA EXISTE CIERRE
    const existingClose = await query(
      `SELECT id FROM "${schema}".cash_register_closing 
       WHERE closing_date = $1 AND closing_user_id = $2
       LIMIT 1`,
      [closingDate, userId]
    );

    if (existingClose.rows.length > 0) {
      return res.status(409).json({ 
        error: 'Ya existe un cierre de caja para hoy para este usuario',
        closing_id: existingClose.rows[0].id
      });
    }

    // 📊 FUNCIONES HELPER
    const n = (v) => {
      const num = Number(v);
      return isNaN(num) ? 0 : num;
    };

    const safe = (v) => (v == null || isNaN(v) ? 0 : v);

    // 📊 CALCULAR DIFERENCIAS
    const cashSystem = n(cash_system || 0);
    const transferSystem = n(transfer_system || 0);
    const cardSystem = n(card_system || 0);
    const totalSystem = n(total_system || 0);
    const ordersSystem = n(orders_system || 0);
    const expensesTotal = n(expenses_total || 0);

    const cashCounted = n(efectivoFisico || 0);
    const transferCounted = n(transferenciaFisico || 0);
    const cardCounted = n(tarjetaFisico || 0);
    const tipCounted = n(propinaFisico || 0);

    const diffCash = cashCounted - cashSystem;
    const diffTransfer = transferCounted - transferSystem;
    const diffCard = cardCounted - cardSystem;
    const diffOrders = 0 - ordersSystem;

    const totalCounted = cashCounted + transferCounted + cardCounted;
    const diffTotal = totalCounted - totalSystem;

    const netSystem = totalSystem - expensesTotal;
    const netCounted = totalCounted - expensesTotal;
    const diffNet = netCounted - netSystem;

    // 💾 INSERT - CIERRE DE CAJA
    const closingResult = await query(
      `
      INSERT INTO "${schema}".cash_register_closing (
        closing_user_id,
        closing_date,
        closing_time,
        cash_counted,
        cash_system,
        diff_cash,
        transfer_counted,
        transfer_system,
        diff_transfer,
        card_counted,
        card_system,
        diff_card,
        orders_counted,
        orders_system,
        diff_orders,
        extras,
        expenses_total,
        total_counted,
        total_system,
        diff_total,
        net_system,
        net_counted,
        diff_net,
        remarks,
        created_at
      )
      VALUES (
        $1, $2, NOW(),
        $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11,
        $12, $13, $14,
        $15, $16,
        $17, $18, $19,
        $20, $21, $22,
        $23, NOW()
      )
      RETURNING *
      `,
      [
        userId,
        closingDate,
        safe(cashCounted),
        safe(cashSystem),
        safe(diffCash),
        safe(transferCounted),
        safe(transferSystem),
        safe(diffTransfer),
        safe(cardCounted),
        safe(cardSystem),
        safe(diffCard),
        safe(0),
        safe(ordersSystem),
        safe(diffOrders),
        JSON.stringify({
          cash_denomination: cashDenominationCount || {},
          coins_denomination: coinsDenominationCount || {},
          propina: tipCounted
        }),
        safe(expensesTotal),
        safe(totalCounted),
        safe(totalSystem),
        safe(diffTotal),
        safe(netSystem),
        safe(netCounted),
        safe(diffNet),
        remarks || null
      ]
    );

    const closingData = closingResult.rows[0];
    console.log('✅ CIERRE GUARDADO - ID:', closingData.id);
    console.log('📅 FECHA CIERRE:', closingDate);

    // 📦 PROCESAR MOVIMIENTOS DE INVENTARIO
    let inventoryMovements = [];
    let inventoryProcessed = false;
    let inventoryError = null;
    let sourceType = 'none';

    if (process_inventory) {
      try {
        console.log('📦 INICIANDO PROCESAMIENTO DE INVENTARIO...');

        // Verificar si ya existen movimientos para esta fecha
        const movementsCheck = await query(
          `
          SELECT COUNT(*) as count 
          FROM "${schema}".inventory_movements 
          WHERE DATE(created_at AT TIME ZONE '${TZ}') = $1
          AND type = 'venta'
          `,
          [closingDate]
        );

        console.log(`📊 Movimientos existentes: ${movementsCheck.rows[0].count}`);

        if (parseInt(movementsCheck.rows[0].count) === 0) {
          // 🔍 BUSCAR EN FACTURAS
          let orderIds = [];

          const invoicesResult = await query(
            `
            SELECT 
              ei.id AS invoice_id,
              ei.invoice_number,
              ei.order_id
            FROM "${schema}".einvoices ei
            WHERE 
              DATE(ei.emission_date AT TIME ZONE '${TZ}') = $1
            `,
            [closingDate]
          );

          console.log(`📊 Facturas encontradas: ${invoicesResult.rows.length}`);

          // Extraer order_ids de facturas
          const orderIdsFromInvoices = invoicesResult.rows
            .map(row => row.order_id)
            .filter(id => id !== null);

          if (orderIdsFromInvoices.length > 0) {
            orderIds = orderIdsFromInvoices;
            sourceType = 'facturas';
            console.log(`📊 Usando ${orderIds.length} órdenes de facturas`);
          } else {
            // Buscar órdenes paid directamente
            const ordersResult = await query(
              `
              SELECT 
                id AS order_id,
                order_number
              FROM "${schema}".pos_orders
              WHERE 
                DATE(created_at AT TIME ZONE '${TZ}') = $1
                AND status = 'paid'
              `,
              [closingDate]
            );
            
            orderIds = ordersResult.rows.map(row => row.order_id);
            sourceType = 'ordenes_paid';
            console.log(`📊 Usando ${orderIds.length} órdenes paid directas`);
          }

          // Obtener items de las órdenes
          if (orderIds.length > 0) {
            const itemsResult = await query(
              `
              SELECT 
                oi.order_id,
                oi.product_id,
                oi.product_name,
                oi.quantity,
                oi.unit_price,
                oi.line_total,
                o.order_number
              FROM "${schema}".pos_order_items oi
              INNER JOIN "${schema}".pos_orders o ON o.id = oi.order_id
              WHERE oi.order_id = ANY($1::uuid[])
              `,
              [orderIds]
            );

            console.log(`📊 Items encontrados: ${itemsResult.rows.length}`);

            if (itemsResult.rows.length > 0) {
              // Agrupar por producto
              const productMovements = new Map();

              itemsResult.rows.forEach(row => {
                const productId = row.product_id;
                const quantity = parseInt(row.quantity) || 0;

                if (productMovements.has(productId)) {
                  const existing = productMovements.get(productId);
                  existing.total_quantity += quantity;
                } else {
                  productMovements.set(productId, {
                    product_id: productId,
                    product_name: row.product_name || 'Producto',
                    total_quantity: quantity,
                    unit_price: parseFloat(row.unit_price) || 0
                  });
                }
              });

              console.log(`📊 Productos agrupados: ${productMovements.size}`);

              // 🔥 FORMATO DE FECHA CORREGIDO
              // La fecha viene como '2026-08-08', formatear a '08/08/2026'
              const dateParts = closingDate.split('-');
              const year = dateParts[0];
              const month = dateParts[1];
              const day = dateParts[2];
              const formattedDate = `${day}/${month}/${year}`;
              
              console.log(`📅 Fecha formateada para notes: ${formattedDate}`);

              // Crear movimientos
              for (const [productId, data] of productMovements) {
                const productResult = await query(
                  `
                  SELECT unit_cost, stock, name 
                  FROM "${schema}".products 
                  WHERE id = $1
                  `,
                  [productId]
                );

                const unitCost = productResult.rows[0]?.unit_cost || data.unit_price || 0;
                const productName = productResult.rows[0]?.name || data.product_name || 'Producto';
                const currentStock = productResult.rows[0]?.stock || 0;

                // 📝 NOTA: "Cierre de caja de 08/08/2026"
                const notes = `Cierre de caja de ${formattedDate}`;
                
                // Cantidad NEGATIVA para venta (salida de inventario)
                const quantity = -Math.abs(data.total_quantity);

                console.log(`📝 Creando movimiento para ${productName}:`, {
                  quantity,
                  unitCost,
                  notes,
                  currentStock
                });

                // Insertar movimiento de inventario (sin reference_id)
                const movementResult = await query(
                  `
                  INSERT INTO "${schema}".inventory_movements (
                    product_id,
                    type,
                    quantity,
                    unit_cost,
                    notes,
                    applied,
                    created_at
                  )
                  VALUES (
                    $1, $2, $3, $4, $5, $6, NOW()
                  )
                  RETURNING *
                  `,
                  [
                    productId,
                    'venta',
                    quantity,
                    unitCost,
                    notes,
                    true
                  ]
                );

                inventoryMovements.push(movementResult.rows[0]);

                // Actualizar stock del producto
                await query(
                  `
                  UPDATE "${schema}".products
                  SET stock = stock - $1,
                      updated_at = NOW()
                  WHERE id = $2
                  `,
                  [Math.abs(data.total_quantity), productId]
                );

                console.log(`✅ Movimiento creado para ${productName}: ${quantity} unidades (Stock: ${currentStock} → ${currentStock - Math.abs(data.total_quantity)})`);
              }

              inventoryProcessed = true;
              console.log(`✅ ${inventoryMovements.length} movimientos creados desde ${sourceType}`);
            } else {
              console.log('ℹ️ No hay items para procesar');
            }
          } else {
            console.log('ℹ️ No hay órdenes para procesar');
          }
        } else {
          console.log(`ℹ️ Ya existen movimientos para ${closingDate}`);
          inventoryProcessed = true;
        }
      } catch (inventoryErr) {
        console.error("⚠️ ERROR EN INVENTARIO:", inventoryErr);
        inventoryError = inventoryErr.message;
      }
    }

    // 📤 RESPUESTA
    res.status(201).json({
      success: true,
      closing: closingData,
      inventory: {
        processed: inventoryProcessed,
        movements_created: inventoryMovements.length,
        movements: inventoryMovements,
        source: sourceType,
        error: inventoryError
      }
    });

  } catch (err) {
    console.error("❌ ERROR CLOSING:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ===============================
// 🔍 GET /debug-inventory
// ===============================
router.get('/debug-inventory', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const date = req.query.date || ecuadorToday();
    const TZ = 'America/Guayaquil';

    const results = {};

    // 1. Verificar órdenes paid del día
    const ordersPaid = await query(
      `
      SELECT 
        id,
        order_number,
        status,
        customer_name,
        total,
        created_at
      FROM "${schema}".pos_orders
      WHERE DATE(created_at AT TIME ZONE '${TZ}') = $1
        AND status = 'paid'
      `,
      [date]
    );
    results.orders_paid = ordersPaid.rows;
    results.orders_paid_count = ordersPaid.rows.length;

    // 2. Verificar facturas del día (todas)
    const invoices = await query(
      `
      SELECT 
        id,
        invoice_number,
        order_id,
        status,
        emission_date
      FROM "${schema}".einvoices
      WHERE DATE(emission_date AT TIME ZONE '${TZ}') = $1
      `,
      [date]
    );
    results.invoices = invoices.rows;
    results.invoices_count = invoices.rows.length;

    // 3. Verificar order_ids de facturas
    const orderIdsFromInvoices = invoices.rows.map(row => row.order_id).filter(Boolean);
    results.order_ids_from_invoices = orderIdsFromInvoices;
    results.order_ids_from_invoices_count = orderIdsFromInvoices.length;

    // 4. Verificar items de órdenes paid
    if (ordersPaid.rows.length > 0) {
      const orderIds = ordersPaid.rows.map(row => row.id);
      const items = await query(
        `
        SELECT 
          oi.order_id,
          oi.product_id,
          oi.product_name,
          oi.quantity,
          oi.unit_price,
          oi.line_total,
          o.order_number
        FROM "${schema}".pos_order_items oi
        INNER JOIN "${schema}".pos_orders o ON o.id = oi.order_id
        WHERE oi.order_id = ANY($1::uuid[])
        `,
        [orderIds]
      );
      results.items_from_orders = items.rows;
      results.items_from_orders_count = items.rows.length;
    }

    // 5. Verificar items de facturas
    if (orderIdsFromInvoices.length > 0) {
      const items = await query(
        `
        SELECT 
          oi.order_id,
          oi.product_id,
          oi.product_name,
          oi.quantity,
          oi.unit_price,
          oi.line_total,
          o.order_number
        FROM "${schema}".pos_order_items oi
        INNER JOIN "${schema}".pos_orders o ON o.id = oi.order_id
        WHERE oi.order_id = ANY($1::uuid[])
        `,
        [orderIdsFromInvoices]
      );
      results.items_from_invoices = items.rows;
      results.items_from_invoices_count = items.rows.length;
    }

    // 6. Verificar movimientos de inventario existentes
    const movements = await query(
      `
      SELECT 
        im.*,
        p.name as product_name
      FROM "${schema}".inventory_movements im
      LEFT JOIN "${schema}".products p ON p.id = im.product_id
      WHERE DATE(im.created_at AT TIME ZONE '${TZ}') = $1
      `,
      [date]
    );
    results.movements = movements.rows;
    results.movements_count = movements.rows.length;

    // 7. Verificar productos con stock
    const products = await query(
      `
      SELECT 
        id,
        name,
        unit_cost,
        stock,
        selling_price
      FROM "${schema}".products
      WHERE is_active = true
      ORDER BY name
      LIMIT 20
      `
    );
    results.products = products.rows;

    res.json({
      success: true,
      date: date,
      summary: {
        orders_paid: results.orders_paid_count,
        invoices: results.invoices_count,
        order_ids_from_invoices: results.order_ids_from_invoices_count,
        items_from_orders: results.items_from_orders_count || 0,
        items_from_invoices: results.items_from_invoices_count || 0,
        movements: results.movements_count
      },
      results: results
    });

  } catch (err) {
    console.error("❌ ERROR DEBUG:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📦 POST /process-inventory
// ===============================
router.post('/process-inventory', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { date, force = false, closing_id = null } = req.body;
    const closingDate = date || ecuadorToday();
    const TZ = 'America/Guayaquil';

    let closingId = closing_id;
    if (!closingId) {
      const closingRes = await query(
        `
        SELECT id FROM "${schema}".cash_register_closing
        WHERE closing_date = $1
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [closingDate]
      );
      
      if (closingRes.rows.length === 0) {
        return res.status(404).json({
          error: 'No se encontró un cierre para esta fecha'
        });
      }
      closingId = closingRes.rows[0].id;
    }

    const movementsCheck = await query(
      `
      SELECT COUNT(*) as count 
      FROM "${schema}".inventory_movements 
      WHERE reference_id = $1
      AND type = 'venta'
      `,
      [closingId]
    );

    if (parseInt(movementsCheck.rows[0].count) > 0 && !force) {
      return res.status(409).json({
        error: 'Ya existen movimientos de inventario para este cierre',
        count: parseInt(movementsCheck.rows[0].count)
      });
    }

    if (force && parseInt(movementsCheck.rows[0].count) > 0) {
      const existingMovements = await query(
        `
        SELECT * FROM "${schema}".inventory_movements
        WHERE reference_id = $1
        AND type = 'venta'
        `,
        [closingId]
      );

      for (const movement of existingMovements.rows) {
        await query(
          `
          UPDATE "${schema}".products
          SET stock = stock + $1,
              updated_at = NOW()
          WHERE id = $2
          `,
          [Math.abs(movement.quantity), movement.product_id]
        );
      }

      await query(
        `
        DELETE FROM "${schema}".inventory_movements
        WHERE reference_id = $1
        AND type = 'venta'
        `,
        [closingId]
      );

      console.log(`🔄 Movimientos eliminados para reprocesar`);
    }

    const invoicesResult = await query(
      `
      SELECT 
        ei.id AS invoice_id,
        ei.invoice_number,
        oi.product_id,
        oi.quantity,
        oi.product_name,
        oi.unit_price,
        oi.line_total
      FROM "${schema}".einvoices ei
      INNER JOIN "${schema}".pos_orders o ON o.id = ei.order_id
      INNER JOIN "${schema}".pos_order_items oi ON oi.order_id = o.id
      WHERE 
        DATE(ei.emission_date AT TIME ZONE '${TZ}') = $1
        AND o.status IN ('paid', 'completed')
      `,
      [closingDate]
    );

    if (invoicesResult.rows.length === 0) {
      return res.status(404).json({
        message: 'No hay facturas para procesar en esta fecha'
      });
    }

    const productMovements = new Map();

    invoicesResult.rows.forEach(row => {
      const productId = row.product_id;
      const quantity = parseInt(row.quantity) || 0;
      const invoiceNumber = row.invoice_number || 'S/N';

      if (productMovements.has(productId)) {
        const existing = productMovements.get(productId);
        existing.total_quantity += quantity;
        existing.invoices.push(invoiceNumber);
      } else {
        productMovements.set(productId, {
          product_id: productId,
          product_name: row.product_name || 'Producto',
          total_quantity: quantity,
          unit_price: parseFloat(row.unit_price) || 0,
          invoices: [invoiceNumber]
        });
      }
    });

    const movements = [];
    const productsUpdated = [];

    for (const [productId, data] of productMovements) {
      const productCost = await query(
        `
        SELECT unit_cost, stock, name 
        FROM "${schema}".products 
        WHERE id = $1
        `,
        [productId]
      );

      const unitCost = productCost.rows[0]?.unit_cost || data.unit_price || 0;
      const productName = productCost.rows[0]?.name || data.product_name || 'Producto';
      const currentStock = productCost.rows[0]?.stock || 0;

      const invoiceNumbers = data.invoices.join(', #');
      const notes = `Factura #${invoiceNumbers}`;
      const quantity = -Math.abs(data.total_quantity);

      const movementResult = await query(
        `
        INSERT INTO "${schema}".inventory_movements (
          product_id,
          type,
          quantity,
          unit_cost,
          reference_id,
          notes,
          applied,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, NOW()
        )
        RETURNING *
        `,
        [
          productId,
          'venta',
          quantity,
          unitCost,
          closingId,
          notes,
          true
        ]
      );

      movements.push(movementResult.rows[0]);

      await query(
        `
        UPDATE "${schema}".products
        SET stock = stock - $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [Math.abs(data.total_quantity), productId]
      );

      productsUpdated.push({
        product_id: productId,
        product_name: productName,
        quantity_sold: Math.abs(data.total_quantity),
        previous_stock: currentStock,
        new_stock: currentStock - Math.abs(data.total_quantity),
        unit_cost: unitCost
      });
    }

    const totalInvoices = new Set(invoicesResult.rows.map(r => r.invoice_id)).size;
    const totalProducts = productMovements.size;
    const totalUnits = Array.from(productMovements.values()).reduce((sum, d) => sum + d.total_quantity, 0);

    res.status(201).json({
      success: true,
      message: 'Movimientos de inventario procesados exitosamente',
      summary: {
        date: closingDate,
        closing_id: closingId,
        total_invoices: totalInvoices,
        total_products: totalProducts,
        total_units_sold: totalUnits,
        movements_created: movements.length
      },
      movements: movements,
      products_updated: productsUpdated
    });

  } catch (err) {
    console.error("❌ ERROR PROCESSING INVENTORY:", err);
    res.status(500).json({
      success: false,
      error: err.message,
      details: 'Error al procesar movimientos de inventario'
    });
  }
});

// ===============================
// 📊 GET /inventory-movements
// ===============================
router.get('/inventory-movements', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const date = req.query.date || ecuadorToday();
    const TZ = 'America/Guayaquil';

    const result = await query(
      `
      SELECT 
        im.id,
        im.product_id,
        p.name AS product_name,
        p.code AS product_code,
        p.unit_cost AS current_cost,
        im.type,
        im.quantity,
        im.unit_cost AS movement_cost,
        im.notes,
        im.applied,
        im.reference_id,
        im.created_at,
        (im.quantity * im.unit_cost) AS total_cost,
        CASE 
          WHEN im.quantity < 0 THEN 'SALIDA'
          WHEN im.quantity > 0 THEN 'ENTRADA'
          ELSE 'SIN MOVIMIENTO'
        END AS movement_type
      FROM "${schema}".inventory_movements im
      LEFT JOIN "${schema}".products p ON p.id = im.product_id
      WHERE DATE(im.created_at AT TIME ZONE '${TZ}') = $1
        AND im.type = 'venta'
      ORDER BY im.created_at DESC
      `,
      [date]
    );

    const totalProducts = result.rows.length;
    const totalUnits = result.rows.reduce((sum, row) => sum + Math.abs(row.quantity || 0), 0);
    const totalCost = result.rows.reduce((sum, row) => sum + Math.abs(row.total_cost || 0), 0);

    res.json({
      success: true,
      date: date,
      movements: result.rows,
      summary: {
        total_products: totalProducts,
        total_units_sold: totalUnits,
        total_cost: parseFloat(totalCost.toFixed(2))
      }
    });

  } catch (err) {
    console.error("❌ ERROR GETTING INVENTORY MOVEMENTS:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 🔍 GET /check-inventory-movements
// ===============================
router.get('/check-inventory-movements', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const date = req.query.date || ecuadorToday();
    const TZ = 'America/Guayaquil';

    const result = await query(
      `
      SELECT 
        COUNT(*) as total_movements,
        COUNT(DISTINCT product_id) as products_affected,
        SUM(ABS(quantity)) as total_units,
        SUM(ABS(quantity * unit_cost)) as total_cost,
        array_agg(DISTINCT product_id) as product_ids,
        array_agg(DISTINCT reference_id) as closing_ids
      FROM "${schema}".inventory_movements
      WHERE DATE(created_at AT TIME ZONE '${TZ}') = $1
        AND type = 'venta'
      `,
      [date]
    );

    const data = result.rows[0];
    res.json({
      success: true,
      date: date,
      has_movements: parseInt(data.total_movements || 0) > 0,
      total_movements: parseInt(data.total_movements || 0),
      products_affected: parseInt(data.products_affected || 0),
      total_units: parseInt(data.total_units || 0),
      total_cost: parseFloat(data.total_cost || 0).toFixed(2),
      product_ids: data.product_ids || [],
      closing_ids: data.closing_ids || []
    });

  } catch (err) {
    console.error("❌ ERROR CHECKING INVENTORY MOVEMENTS:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 🔄 POST /revert-inventory
// ===============================
router.post('/revert-inventory', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { closing_id, date, confirm = false } = req.body;
    const TZ = 'America/Guayaquil';

    if (!closing_id && !date) {
      return res.status(400).json({ 
        error: 'Se requiere closing_id o date para revertir' 
      });
    }

    let movementsQuery;
    let params;
    let identifier;

    if (closing_id) {
      movementsQuery = `
        SELECT * FROM "${schema}".inventory_movements
        WHERE reference_id = $1
        AND type = 'venta'
      `;
      params = [closing_id];
      identifier = `cierre ${closing_id}`;
    } else if (date) {
      movementsQuery = `
        SELECT * FROM "${schema}".inventory_movements
        WHERE DATE(created_at AT TIME ZONE '${TZ}') = $1
        AND type = 'venta'
      `;
      params = [date];
      identifier = `fecha ${date}`;
    }

    const movements = await query(movementsQuery, params);

    if (movements.rows.length === 0) {
      return res.status(404).json({ 
        message: `No se encontraron movimientos para ${identifier}` 
      });
    }

    if (!confirm) {
      const summary = {
        total_movements: movements.rows.length,
        products: [],
        total_units: 0
      };

      const productMap = new Map();
      movements.rows.forEach(m => {
        const pid = m.product_id;
        if (!productMap.has(pid)) {
          productMap.set(pid, {
            product_id: pid,
            quantity: 0
          });
        }
        productMap.get(pid).quantity += Math.abs(m.quantity);
        summary.total_units += Math.abs(m.quantity);
      });

      summary.products = Array.from(productMap.values());

      return res.json({
        confirm_required: true,
        message: `Se encontraron ${movements.rows.length} movimientos para revertir`,
        summary: summary,
        movements: movements.rows
      });
    }

    const reverted = [];
    for (const movement of movements.rows) {
      await query(
        `
        UPDATE "${schema}".products
        SET stock = stock + $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [Math.abs(movement.quantity), movement.product_id]
      );

      await query(
        `
        DELETE FROM "${schema}".inventory_movements
        WHERE id = $1
        `,
        [movement.id]
      );

      reverted.push(movement);
    }

    res.json({
      success: true,
      message: `Se revirtieron ${reverted.length} movimientos de inventario`,
      reverted: reverted
    });

  } catch (err) {
    console.error("❌ ERROR REVERTING INVENTORY:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 💵 INGRESOS EXTRAS
// ===============================
router.get('/income-extra', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const date = req.query.date || ecuadorToday();
    const result = await query(
      `SELECT * FROM "${schema}".incomes_extras WHERE date = $1 ORDER BY created_at ASC`,
      [date]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/income-extra', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { date, amount, payment_method, description } = req.body;
    const userId   = req.user?.id || 'unknown';
    const userName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ')
                     || req.user?.email || userId;
    const result = await query(
      `INSERT INTO "${schema}".incomes_extras (date, amount, payment_method, description, user_id, user_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [date || ecuadorToday(), n(amount), payment_method || 'cash', description || null, userId, userName]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📧 POST /send-close-email
// ===============================
router.post('/send-close-email', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const { pdfBase64, closingDate, totalVentas, totalContado, diferencia } = req.body;
    const businessId = req.user?.businessId;

    const bizRes = await query(`
      SELECT bo.email, b.name AS business_name
      FROM public.businesses b
      JOIN public.business_users bu ON bu.business_id = b.id AND bu.is_owner = TRUE
      JOIN public.business_owners bo ON bo.user_id = bu.user_id
      WHERE b.id = $1
      LIMIT 1
    `, [businessId]);

    if (!bizRes.rows.length || !bizRes.rows[0].email) {
      return res.json({ ok: false, message: 'Sin email de propietario configurado' });
    }

    const { email, business_name } = bizRes.rows[0];
    const fmtAmt = (a) => `$${parseFloat(a || 0).toFixed(2)}`;
    const fecha = closingDate || ecuadorToday();
    const hora = new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });

    const diffNum = parseFloat(diferencia || 0);
    const diffColor = diffNum > 0 ? '#059669' : diffNum < 0 ? '#ef4444' : '#64748b';
    const diffLabel = diffNum === 0 ? 'Cuadrado' : diffNum > 0 ? `Sobrante ${fmtAmt(Math.abs(diffNum))}` : `Faltante ${fmtAmt(Math.abs(diffNum))}`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1e293b">
        <div style="background:#ff8c42;padding:24px 28px;border-radius:10px 10px 0 0">
          <h2 style="color:#fff;margin:0;font-size:20px">${business_name}</h2>
          <p style="color:#fff3e0;margin:4px 0 0;font-size:13px">Reporte de Cierre de Caja</p>
        </div>
        <div style="background:#f8fafc;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
          <p style="margin:0 0 20px;color:#475569;font-size:14px">
            Se adjunta el reporte de cierre de caja del día <strong>${fecha}</strong> generado a las <strong>${hora}</strong>.
          </p>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            <tr>
              <td style="padding:7px 10px;background:#fff;border:1px solid #e2e8f0;color:#64748b">Fecha</td>
              <td style="padding:7px 10px;background:#fff;border:1px solid #e2e8f0;font-weight:700">${fecha}</td>
            </tr>
            <tr>
              <td style="padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b">Total Ventas</td>
              <td style="padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:700;color:#059669">${fmtAmt(totalVentas)}</td>
            </tr>
            <tr>
              <td style="padding:7px 10px;background:#fff;border:1px solid #e2e8f0;color:#64748b">Total Contado</td>
              <td style="padding:7px 10px;background:#fff;border:1px solid #e2e8f0;font-weight:700">${fmtAmt(totalContado)}</td>
            </tr>
            <tr>
              <td style="padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b">Diferencia</td>
              <td style="padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:700;color:${diffColor}">${diffLabel}</td>
            </tr>
          </table>
          <p style="margin:20px 0 0;font-size:11px;color:#cbd5e1;text-align:center">
            Idon Plataforma — cierre de caja automático.
          </p>
        </div>
      </div>`;

    const attachments = pdfBase64
      ? [{ filename: `cierre-caja-${fecha}.pdf`, content: pdfBase64 }]
      : [];

    await sendGenericEmail({
      to: email,
      subject: `Cierre de Caja ${fecha} — ${business_name}`,
      html,
      businessName: business_name,
      attachments,
    });

    res.json({ ok: true, sentTo: email });
  } catch (err) {
    console.error('[SendCloseEmail]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===============================
// GET /opening
// ===============================
router.get('/opening', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const date   = req.query.date || ecuadorToday();

    const result = await query(
      `SELECT * FROM "${schema}".cash_register_openings
       WHERE date = $1
       ORDER BY created_at ASC
       LIMIT 1`,
      [date]
    );

    if (result.rows.length === 0) return res.status(404).json({});
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// POST /opening
// ===============================
router.post('/opening', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const userId   = req.user?.id || req.user?.userId || 'unknown';
    const userName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ')
                     || req.user?.email || userId;
    const date     = req.body.date || ecuadorToday();

    const existing = await query(
      `SELECT id FROM "${schema}".cash_register_openings WHERE date = $1 LIMIT 1`,
      [date]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Ya existe una apertura de caja para hoy' });
    }

    const {
      moneda_001 = 0, moneda_005 = 0, moneda_010 = 0,
      moneda_025 = 0, moneda_050 = 0, moneda_100 = 0,
      billete_1  = 0, billete_5  = 0, billete_10  = 0,
      billete_20 = 0, billete_50 = 0, billete_100 = 0,
      monto_banca = 0, observaciones = null,
    } = req.body;

    const totalEfectivo =
      Number(moneda_001) * 0.01 + Number(moneda_005) * 0.05 + Number(moneda_010) * 0.10 +
      Number(moneda_025) * 0.25 + Number(moneda_050) * 0.50 + Number(moneda_100) * 1.00 +
      Number(billete_1)  * 1    + Number(billete_5)  * 5    + Number(billete_10)  * 10   +
      Number(billete_20) * 20   + Number(billete_50) * 50   + Number(billete_100) * 100;

    const totalInicial = totalEfectivo + Number(monto_banca);

    const result = await query(
      `INSERT INTO "${schema}".cash_register_openings (
        user_id, user_name, date,
        moneda_001, moneda_005, moneda_010, moneda_025, moneda_050, moneda_100,
        billete_1,  billete_5,  billete_10, billete_20, billete_50, billete_100,
        total_efectivo, monto_banca, total_inicial, observaciones
      ) VALUES (
        $1,  $2,  $3,
        $4,  $5,  $6,  $7,  $8,  $9,
        $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19
      ) RETURNING *`,
      [
        userId, userName, date,
        Number(moneda_001), Number(moneda_005), Number(moneda_010),
        Number(moneda_025), Number(moneda_050), Number(moneda_100),
        Number(billete_1),  Number(billete_5),  Number(billete_10),
        Number(billete_20), Number(billete_50), Number(billete_100),
        parseFloat(totalEfectivo.toFixed(2)),
        Number(monto_banca),
        parseFloat(totalInicial.toFixed(2)),
        observaciones,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================
// GET /audit/openings - TODAS LAS APERTURAS CON DATOS DEL USUARIO
// ================================
router.get('/audit/openings', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { startDate, endDate, userId } = req.query;
    
    let queryText = `
      SELECT 
        o.id,
        o.user_id,
        COALESCE(
          u_public.first_name || ' ' || u_public.last_name,
          u_public.email,
          u_schema.first_name || ' ' || u_schema.last_name,
          u_schema.email,
          o.user_id
        ) AS user_name,
        COALESCE(
          u_public.email,
          u_schema.email
        ) AS user_email,
        o.date,
        o.total_efectivo,
        o.monto_banca,
        o.total_inicial,
        o.observaciones,
        o.created_at,
        o.moneda_001,
        o.moneda_005,
        o.moneda_010,
        o.moneda_025,
        o.moneda_050,
        o.moneda_100,
        o.billete_1,
        o.billete_5,
        o.billete_10,
        o.billete_20,
        o.billete_50,
        o.billete_100
      FROM "${schema}".cash_register_openings o
      LEFT JOIN public.users u_public ON u_public.id::text = o.user_id
      LEFT JOIN "${schema}".users u_schema ON u_schema.id::text = o.user_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (startDate) {
      queryText += ` AND o.date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      queryText += ` AND o.date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    if (userId) {
      queryText += ` AND o.user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }
    
    queryText += ` ORDER BY o.created_at DESC`;
    
    const result = await query(queryText, params);
    res.json(result.rows);
    
  } catch (err) {
    console.error('❌ Error en audit/openings:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================
// GET /audit/closings - TODOS LOS CIERRES CON DATOS DEL USUARIO
// ================================
router.get('/audit/closings', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { startDate, endDate, userId } = req.query;
    
    let queryText = `
      SELECT 
        c.id,
        c.closing_user_id,
        COALESCE(
          u_public.first_name || ' ' || u_public.last_name,
          u_public.email,
          u_schema.first_name || ' ' || u_schema.last_name,
          u_schema.email,
          c.closing_user_id
        ) AS closing_user_name,
        COALESCE(
          u_public.email,
          u_schema.email
        ) AS closing_user_email,
        c.closing_date,
        c.closing_time,
        c.cash_counted,
        c.cash_system,
        c.diff_cash,
        c.transfer_counted,
        c.transfer_system,
        c.diff_transfer,
        c.card_counted,
        c.card_system,
        c.diff_card,
        c.orders_counted,
        c.orders_system,
        c.diff_orders,
        c.extras,
        c.expenses_total,
        c.total_counted,
        c.total_system,
        c.diff_total,
        c.net_system,
        c.net_counted,
        c.diff_net,
        c.remarks,
        c.created_at
      FROM "${schema}".cash_register_closing c
      LEFT JOIN public.users u_public ON u_public.id::text = c.closing_user_id
      LEFT JOIN "${schema}".users u_schema ON u_schema.id::text = c.closing_user_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (startDate) {
      queryText += ` AND c.closing_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      queryText += ` AND c.closing_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    if (userId) {
      queryText += ` AND c.closing_user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }
    
    queryText += ` ORDER BY c.created_at DESC`;
    
    const result = await query(queryText, params);
    res.json(result.rows);
    
  } catch (err) {
    console.error('❌ Error en audit/closings:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================
// GET /audit/summary - RESUMEN DE APERTURAS Y CIERRES POR USUARIO
// ================================
router.get('/audit/summary', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { date, userId } = req.query;
    const targetDate = date || ecuadorToday();
    const targetUserId = userId || req.user?.id || req.user?.userId;
    
    if (!targetUserId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    // Obtener apertura del día para el usuario específico
    const openingResult = await query(
      `
      SELECT 
        o.id,
        o.user_id,
        COALESCE(
          u_public.first_name || ' ' || u_public.last_name,
          u_public.email,
          u_schema.first_name || ' ' || u_schema.last_name,
          u_schema.email,
          o.user_id
        ) AS user_name,
        COALESCE(
          u_public.email,
          u_schema.email
        ) AS user_email,
        o.date,
        o.total_efectivo,
        o.monto_banca,
        o.total_inicial,
        o.observaciones,
        o.created_at,
        o.moneda_001,
        o.moneda_005,
        o.moneda_010,
        o.moneda_025,
        o.moneda_050,
        o.moneda_100,
        o.billete_1,
        o.billete_5,
        o.billete_10,
        o.billete_20,
        o.billete_50,
        o.billete_100
      FROM "${schema}".cash_register_openings o
      LEFT JOIN public.users u_public ON u_public.id::text = o.user_id
      LEFT JOIN "${schema}".users u_schema ON u_schema.id::text = o.user_id
      WHERE o.date = $1 
        AND o.user_id = $2
      ORDER BY o.created_at DESC 
      LIMIT 1
      `,
      [targetDate, targetUserId]
    );
    
    // Obtener cierre del día para el usuario específico
    const closingResult = await query(
      `
      SELECT 
        c.id,
        c.closing_user_id,
        COALESCE(
          u_public.first_name || ' ' || u_public.last_name,
          u_public.email,
          u_schema.first_name || ' ' || u_schema.last_name,
          u_schema.email,
          c.closing_user_id
        ) AS closing_user_name,
        COALESCE(
          u_public.email,
          u_schema.email
        ) AS closing_user_email,
        c.closing_date,
        c.closing_time,
        c.cash_counted,
        c.cash_system,
        c.diff_cash,
        c.transfer_counted,
        c.transfer_system,
        c.diff_transfer,
        c.card_counted,
        c.card_system,
        c.diff_card,
        c.orders_counted,
        c.orders_system,
        c.diff_orders,
        c.extras,
        c.expenses_total,
        c.total_counted,
        c.total_system,
        c.diff_total,
        c.net_system,
        c.net_counted,
        c.diff_net,
        c.remarks,
        c.created_at
      FROM "${schema}".cash_register_closing c
      LEFT JOIN public.users u_public ON u_public.id::text = c.closing_user_id
      LEFT JOIN "${schema}".users u_schema ON u_schema.id::text = c.closing_user_id
      WHERE c.closing_date = $1 
        AND c.closing_user_id = $2
      ORDER BY c.created_at DESC 
      LIMIT 1
      `,
      [targetDate, targetUserId]
    );
    
    // Obtener todas las aperturas del día (para mostrar quiénes abrieron)
    const allOpeningsResult = await query(
      `
      SELECT 
        o.id,
        o.user_id,
        COALESCE(
          u_public.first_name || ' ' || u_public.last_name,
          u_public.email,
          u_schema.first_name || ' ' || u_schema.last_name,
          u_schema.email,
          o.user_id
        ) AS user_name,
        COALESCE(
          u_public.email,
          u_schema.email
        ) AS user_email,
        o.date,
        o.total_inicial,
        o.created_at
      FROM "${schema}".cash_register_openings o
      LEFT JOIN public.users u_public ON u_public.id::text = o.user_id
      LEFT JOIN "${schema}".users u_schema ON u_schema.id::text = o.user_id
      WHERE o.date = $1
      ORDER BY o.created_at DESC
      `,
      [targetDate]
    );
    
    // Obtener todos los cierres del día (para mostrar quiénes cerraron)
    const allClosingsResult = await query(
      `
      SELECT 
        c.id,
        c.closing_user_id,
        COALESCE(
          u_public.first_name || ' ' || u_public.last_name,
          u_public.email,
          u_schema.first_name || ' ' || u_schema.last_name,
          u_schema.email,
          c.closing_user_id
        ) AS closing_user_name,
        COALESCE(
          u_public.email,
          u_schema.email
        ) AS closing_user_email,
        c.closing_date,
        c.total_counted,
        c.total_system,
        c.diff_total,
        c.created_at
      FROM "${schema}".cash_register_closing c
      LEFT JOIN public.users u_public ON u_public.id::text = c.closing_user_id
      LEFT JOIN "${schema}".users u_schema ON u_schema.id::text = c.closing_user_id
      WHERE c.closing_date = $1
      ORDER BY c.created_at DESC
      `,
      [targetDate]
    );
    
    res.json({
      date: targetDate,
      user: {
        id: targetUserId,
        opening: openingResult.rows[0] || null,
        closing: closingResult.rows[0] || null,
        has_opening: openingResult.rows.length > 0,
        has_closing: closingResult.rows.length > 0
      },
      summary: {
        total_openings: allOpeningsResult.rows.length,
        total_closings: allClosingsResult.rows.length,
        openings: allOpeningsResult.rows,
        closings: allClosingsResult.rows
      }
    });
    
  } catch (err) {
    console.error('❌ Error en audit/summary:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;