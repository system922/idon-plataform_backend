import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import FIFOService from '../services/fifoService.js';


const router = express.Router();

function buildDateFilter(periodo, startDate, endDate, tableAlias = 'o') {
  let dateFilter = '';
  let queryParams = [];

  if (startDate && endDate) {
    dateFilter = `DATE(${tableAlias}.created_at) >= $1::DATE AND DATE(${tableAlias}.created_at) <= $2::DATE`;
    queryParams = [startDate, endDate];
  } else {
    switch (periodo) {
      case 'day':
        dateFilter = `${tableAlias}.created_at >= CURRENT_DATE AND ${tableAlias}.created_at < CURRENT_DATE + INTERVAL '1 day'`;
        break;
      case 'week':
        dateFilter = `${tableAlias}.created_at >= CURRENT_DATE - INTERVAL '7 days'`;
        break;
      case 'month':
        dateFilter = `${tableAlias}.created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
        break;
      case 'quarter':
        dateFilter = `${tableAlias}.created_at >= DATE_TRUNC('quarter', CURRENT_DATE)`;
        break;
      case 'year':
        dateFilter = `${tableAlias}.created_at >= DATE_TRUNC('year', CURRENT_DATE)`;
        break;
      default:
        dateFilter = `${tableAlias}.created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
    }
  }

  return { dateFilter, queryParams };
}

async function getSalesTotals(schema, periodo, startDate, endDate) {
  const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
  const params = queryParams.length > 0 ? [...queryParams] : [];

  const sql = `
    SELECT
      COUNT(DISTINCT o.id) as total_ordenes,
      COALESCE(SUM(o.total), 0) as total_ingresos,
      COALESCE(SUM(o.subtotal), 0) as total_subtotal,
      COALESCE(SUM(o.tax_amount), 0) as total_iva,
      COUNT(DISTINCT o.customer_id) as clientes_unicos,
      CASE
        WHEN COUNT(DISTINCT o.id) > 0
        THEN COALESCE(SUM(o.total), 0) / COUNT(DISTINCT o.id)
        ELSE 0
      END as ticket_promedio
    FROM "${schema}".pos_orders o
    WHERE ${dateFilter}
      AND o.status = 'paid'
  `;

  const result = await query(sql, params);
  return result.rows[0] || { total_ordenes: 0, total_ingresos: 0, total_subtotal: 0, total_iva: 0, clientes_unicos: 0, ticket_promedio: 0 };
}

/**
 * GET /api/reports/sales/detail/:id
 * Obtiene el detalle completo de una factura con sus items y datos de orden
 */
router.get('/sales/detail/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;

    // PRIMERO: Buscar en pos_orders (porque la factura está relacionada con una orden)
    const orderResult = await query(
      `SELECT 
        o.id,
        o.order_number as numero_orden,
        o.order_type as tipo_orden,
        o.status as estado_orden,
        o.mesa_numero as mesa,
        o.subtotal as orden_subtotal,
        o.tax_rate as tasa_iva,
        o.tax_amount as orden_iva,
        o.total as orden_total,
        o.discount_amount as orden_descuento,
        o.notes as notas,
        o.created_at as fecha_orden,
        o.printed as impresa,
        o.customer_name as cliente_nombre_orden,
        o.customer_id
       FROM "${schema}".pos_orders o
       WHERE o.id = $1`,
      [id]
    );

    if (orderResult.rows.length === 0) {
      // Si no se encuentra en pos_orders, buscar en einvoices
      const invoiceResult = await query(
        `SELECT 
          e.id,
          e.invoice_number as numero_factura,
          e.access_key as clave_acceso,
          e.auth_number as numero_autorizacion,
          e.customer_name as cliente_nombre,
          e.customer_ruc as cliente_ruc,
          e.customer_email as cliente_email,
          e.customer_phone as cliente_telefono,
          e.subtotal,
          e.iva_amount as iva,
          e.total,
          e.discount_amount as descuento,
          e.status as estado,
          e.emission_date as fecha_emision,
          e.auth_date as fecha_autorizacion,
          e.created_at,
          e.updated_at,
          e.order_id,
          e.credited_amount as monto_credito,
          e.items
         FROM "${schema}".einvoices e
         WHERE e.id = $1`,
        [id]
      );

      if (invoiceResult.rows.length === 0) {
        return res.status(404).json({ error: 'Factura no encontrada' });
      }

      const invoice = invoiceResult.rows[0];
      
      // Obtener items de la factura
      let items = [];
      if (invoice.items) {
        items = typeof invoice.items === 'string' ? JSON.parse(invoice.items) : invoice.items;
      }

      // Si tiene order_id, obtener datos de la orden
      let orderData = null;
      if (invoice.order_id) {
        const orderResult2 = await query(
          `SELECT 
            o.id,
            o.order_number as numero_orden,
            o.order_type as tipo_orden,
            o.status as estado_orden,
            o.mesa_numero as mesa,
            o.subtotal as orden_subtotal,
            o.tax_rate as tasa_iva,
            o.tax_amount as orden_iva,
            o.total as orden_total,
            o.discount_amount as orden_descuento,
            o.notes as notas,
            o.created_at as fecha_orden
           FROM "${schema}".pos_orders o
           WHERE o.id = $1`,
          [invoice.order_id]
        );

        if (orderResult2.rows.length > 0) {
          orderData = orderResult2.rows[0];
          
          // Obtener items de la orden
          const itemsResult = await query(
            `SELECT 
              id,
              product_id,
              product_name,
              code,
              quantity,
              unit_price,
              tax_rate,
              iva_amount,
              line_total,
              notes
             FROM "${schema}".pos_order_items
             WHERE order_id = $1
             ORDER BY created_at ASC`,
            [invoice.order_id]
          );
          
          orderData.items = itemsResult.rows;
        }
      }

      return res.json({
        success: true,
        data: {
          factura: invoice,
          items_factura: items,
          orden: orderData
        }
      });
    }

    // Si encontró la orden, buscar la factura asociada
    const order = orderResult.rows[0];
    
    // Buscar factura asociada a esta orden
    const invoiceResult = await query(
      `SELECT 
        e.id,
        e.invoice_number as numero_factura,
        e.access_key as clave_acceso,
        e.auth_number as numero_autorizacion,
        e.customer_name as cliente_nombre,
        e.customer_ruc as cliente_ruc,
        e.customer_email as cliente_email,
        e.customer_phone as cliente_telefono,
        e.subtotal,
        e.iva_amount as iva,
        e.total,
        e.discount_amount as descuento,
        e.status as estado,
        e.emission_date as fecha_emision,
        e.auth_date as fecha_autorizacion,
        e.created_at,
        e.updated_at,
        e.order_id,
        e.credited_amount as monto_credito,
        e.items
       FROM "${schema}".einvoices e
       WHERE e.order_id = $1`,
      [id]
    );

    let factura = null;
    let itemsFactura = [];
    
    if (invoiceResult.rows.length > 0) {
      factura = invoiceResult.rows[0];
      if (factura.items) {
        itemsFactura = typeof factura.items === 'string' ? JSON.parse(factura.items) : factura.items;
      }
    }

    // Obtener items de la orden
    const itemsResult = await query(
      `SELECT 
        id,
        product_id,
        product_name,
        code,
        quantity,
        unit_price,
        tax_rate,
        iva_amount,
        line_total,
        notes
       FROM "${schema}".pos_order_items
       WHERE order_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    // Construir la respuesta con datos de factura y orden
    const facturaData = factura ? {
      ...factura,
      // Si la factura no tiene cliente, usar el de la orden
      cliente_nombre: factura.cliente_nombre || order.cliente_nombre_orden || 'CONSUMIDOR FINAL',
    } : {
      // Crear datos de factura desde la orden si no existe
      id: order.id,
      numero_factura: order.numero_orden || 'N/A',
      cliente_nombre: order.cliente_nombre_orden || 'CONSUMIDOR FINAL',
      subtotal: order.orden_subtotal || 0,
      iva: order.orden_iva || 0,
      total: order.orden_total || 0,
      descuento: order.orden_descuento || 0,
      estado: order.estado_orden || 'pending',
      fecha_emision: order.fecha_orden,
    };

    res.json({
      success: true,
      data: {
        factura: facturaData,
        items_factura: itemsFactura,
        orden: {
          ...order,
          items: itemsResult.rows
        }
      }
    });

  } catch (err) {
    console.error('[SalesDetail] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/sales/summary
 */
router.get('/sales/summary', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { startDate = null, endDate = null, periodo = 'month' } = req.query;

    const totals = await getSalesTotals(schema, periodo, startDate, endDate);

    res.json({
      success: true,
      data: {
        total_ventas: parseInt(totals.total_ordenes) || 0,
        total_ingresos: parseFloat(totals.total_ingresos) || 0,
        total_subtotal: parseFloat(totals.total_subtotal) || 0,
        total_iva: parseFloat(totals.total_iva) || 0,
        clientes_unicos: parseInt(totals.clientes_unicos) || 0,
        ticket_promedio: parseFloat(totals.ticket_promedio) || 0
      },
      metadata: { invoiceSource: 'pos' }
    });
  } catch (err) {
    console.error('[SalesSummary] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/sales
 */
router.get('/sales', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { page = 1, limit = 20, startDate = null, endDate = null, periodo = 'month' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
    let params = queryParams.length > 0 ? [...queryParams] : [];

    const posDateFilter = params.length > 0
      ? `DATE(o.created_at) >= $1::DATE AND DATE(o.created_at) <= $2::DATE`
      : `o.created_at >= DATE_TRUNC('month', CURRENT_DATE)`;

    const whereClause = `WHERE ${posDateFilter} AND o.status = 'paid'`;

    const countQuery = `SELECT COUNT(*) as total FROM "${schema}".pos_orders o ${whereClause}`;

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const selectQuery = `
      SELECT
        o.id,
        o.order_number as numero_factura,
        COALESCE(c.name, o.customer_name, 'CONSUMIDOR FINAL') as cliente_nombre,
        c.document_number as cliente_cedula,
        o.created_at as fecha,
        o.subtotal,
        o.tax_amount as iva,
        o.total,
        o.status as estado
      FROM "${schema}".pos_orders o
      LEFT JOIN "${schema}".customers c ON o.customer_id = c.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    params.push(parseInt(limit), offset);

    const countResult = await query(countQuery, queryParams.length > 0 ? queryParams : []);
    const total = parseInt(countResult.rows[0].total);
    const result = await query(selectQuery, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      },
      metadata: { invoiceSource: 'pos' }
    });
  } catch (err) {
    console.error('[Sales] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/products/categories
 */
router.get('/products/categories', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `SELECT id, name, description
       FROM "${schema}".categories
       WHERE is_active = true
       ORDER BY name ASC`
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Categories] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/products-stats
 */
router.get('/products-stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { periodo = 'month', startDate, endDate } = req.query;

    const salesTotals = await getSalesTotals(schema, periodo, startDate, endDate);
    const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
    const params = queryParams.length > 0 ? [...queryParams] : [];

    const productsResult = await query(
      `SELECT
        COALESCE(SUM(oi.quantity), 0) as total_cantidad,
        COUNT(DISTINCT oi.product_id) as productos_distintos
       FROM "${schema}".pos_order_items oi
       INNER JOIN "${schema}".pos_orders o ON oi.order_id = o.id
       WHERE ${dateFilter} AND o.status = 'paid'`,
      params
    );

    const stats = {
      total_productos_vendidos: parseInt(productsResult.rows[0]?.total_cantidad) || 0,
      total_ventas: Math.round((parseFloat(salesTotals.total_ingresos) || 0) * 100) / 100,
      productos_distintos: parseInt(productsResult.rows[0]?.productos_distintos) || 0,
      ticket_promedio: Math.round((parseFloat(salesTotals.ticket_promedio) || 0) * 100) / 100
    };

    res.json({
      success: true,
      data: stats,
      metadata: { invoiceSource: 'pos', periodo }
    });
  } catch (err) {
    console.error('[ProductsStats] Error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      data: { total_productos_vendidos: 0, total_ventas: 0, productos_distintos: 0, ticket_promedio: 0 }
    });
  }
});

/**
 * GET /api/reports/products-sold
 */
router.get('/products-sold', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const {
      periodo = 'month',
      categoria = null,
      order_by = 'quantity',
      limit = 50,
      startDate = null,
      endDate = null
    } = req.query;

    const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');

    let orderByClause = 'cantidad_vendida DESC';
    if (order_by === 'total') orderByClause = 'total_vendido DESC';
    else if (order_by === 'name') orderByClause = 'nombre_producto ASC';

    let params = queryParams.length > 0 ? [...queryParams] : [];
    let whereConditions = [dateFilter, `o.status = 'paid'`];

    if (categoria) {
      const catIdx = params.length + 1;
      whereConditions.push(`cat.id = $${catIdx}`);
      params.push(categoria);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    const limitIdx = params.length + 1;

    const queryText = `
      SELECT
        p.id::text as id,
        COALESCE(p.code, p.sku, '') as sku,
        COALESCE(p.name, 'Producto sin nombre') as nombre_producto,
        COALESCE(SUM(oi.quantity), 0) as cantidad_vendida,
        COALESCE(SUM(oi.quantity * p.selling_price), 0) as total_vendido,
        COALESCE(cat.name, 'Sin categoria') as categoria,
        COUNT(DISTINCT o.id) as numero_transacciones
      FROM "${schema}".pos_order_items oi
      INNER JOIN "${schema}".pos_orders o ON oi.order_id = o.id
      INNER JOIN "${schema}".products p ON oi.product_id = p.id
      LEFT JOIN "${schema}".categories cat ON p.category_id = cat.id
      ${whereClause}
      GROUP BY p.id, p.code, p.sku, p.name, cat.name
      HAVING COALESCE(SUM(oi.quantity), 0) > 0
      ORDER BY ${orderByClause}
      LIMIT $${limitIdx}
    `;

    params.push(parseInt(limit) || 50);

    const result = await query(queryText, params);

    const formattedRows = result.rows.map(row => ({
      ...row,
      cantidad_vendida: parseInt(row.cantidad_vendida) || 0,
      total_vendido: parseFloat(row.total_vendido) || 0,
      numero_transacciones: parseInt(row.numero_transacciones) || 0
    }));

    res.json({
      success: true,
      data: formattedRows,
      metadata: {
        invoiceSource: 'pos',
        periodo,
        categoria: categoria || 'todas',
        order_by,
        limit: parseInt(limit),
        total_registros: formattedRows.length
      }
    });
  } catch (err) {
    console.error('[ProductsSold] Error:', err);
    res.status(500).json({ success: false, error: err.message, data: [] });
  }
});


// routes/reports.js - Endpoint /advanced completo y corregido

router.get('/advanced', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { from = null, to = null, groupBy = 'day' } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    const TZ = 'America/Guayaquil';
    const fifoService = new FIFOService(schema);

    // ─── 1. DETERMINAR AGRUPACIÓN Y GENERAR FECHAS ──────────────────────
    let dateFormatGroup, dateFormatLabel, allDates;

    if (groupBy === 'year') {
      // Agrupar por mes
      dateFormatGroup = `DATE_TRUNC('month', created_at)::DATE`;
      dateFormatLabel = `TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM')`;

      // Generar 12 meses del año seleccionado
      const year = from.split('-')[0];
      allDates = [];
      for (let m = 1; m <= 12; m++) {
        allDates.push(`${year}-${String(m).padStart(2, '0')}`);
      }
    } else {
      // Agrupar por día
      dateFormatGroup = `DATE(created_at)`;
      dateFormatLabel = `TO_CHAR(DATE(created_at), 'YYYY-MM-DD')`;

      // Generar todos los días del rango usando Date.UTC
      const [startYear, startMonth, startDay] = from.split('-').map(Number);
      const [endYear, endMonth, endDay] = to.split('-').map(Number);

      const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));
      const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));

      allDates = [];
      for (
        let d = new Date(start);
        d <= end;
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        allDates.push(d.toISOString().slice(0, 10));
      }
    }

    // ─── 2. OBTENER VENTAS DEL PERÍODO ──────────────────────────────────
    const salesResult = await query(
      `
      SELECT 
        ${dateFormatLabel} as sale_date,
        o.id as order_id,
        o.total,
        o.subtotal,
        o.tax_amount as iva
      FROM "${schema}".pos_orders o
      WHERE o.status = 'paid'
        AND DATE(o.created_at AT TIME ZONE '${TZ}') >= $1::DATE
        AND DATE(o.created_at AT TIME ZONE '${TZ}') <= $2::DATE
      ORDER BY sale_date ASC
      `,
      [from, to]
    );

    console.log(`📊 Ventas encontradas: ${salesResult.rows.length}`);

    // ─── 3. OBTENER COSTO FIFO PARA CADA VENTA ──────────────────────────
    let totalVentas = 0;
    let totalCostoFIFO = 0;
    let totalIva = 0;
    let totalOrdenes = salesResult.rows.length;

    const dailyData = {};

    for (const sale of salesResult.rows) {
      const orderTotal = parseFloat(sale.total) || 0;
      const iva = parseFloat(sale.iva) || 0;
      const dateKey = sale.sale_date; // 'YYYY-MM' o 'YYYY-MM-DD'

      totalVentas += orderTotal;
      totalIva += iva;

      const costResult = await query(
        `
        SELECT 
          COALESCE(SUM(ABS(quantity) * unit_cost), 0) as total_cost,
          COUNT(*) as items_count
        FROM "${schema}".inventory_movements
        WHERE reference_id::text = $1 
          AND type = 'venta'
          AND applied = true
        `,
        [sale.order_id]
      );

      const orderCost = parseFloat(costResult.rows[0]?.total_cost) || 0;
      totalCostoFIFO += orderCost;

      // Acumular por fecha (mes o día)
      if (!dailyData[dateKey]) {
        dailyData[dateKey] = {
          sales: 0,
          cost: 0,
          profit: 0,
          orders: 0,
          iva: 0
        };
      }
      dailyData[dateKey].sales += orderTotal;
      dailyData[dateKey].cost += orderCost;
      dailyData[dateKey].profit += (orderTotal - orderCost);
      dailyData[dateKey].orders += 1;
      dailyData[dateKey].iva += iva;
    }

    // ─── 4. OBTENER GASTOS OPERATIVOS ──────────────────────────────────
    let expensesResult = { rows: [] };
    try {
      let expenseDateFormat;
      if (groupBy === 'year') {
        expenseDateFormat = `TO_CHAR(DATE_TRUNC('month', date), 'YYYY-MM')`;
      } else {
        expenseDateFormat = `TO_CHAR(date, 'YYYY-MM-DD')`;
      }

      expensesResult = await query(
        `
        SELECT
          ${expenseDateFormat} as date,
          COALESCE(SUM(amount), 0) as total_expenses
        FROM "${schema}".expenses
        WHERE date >= $1::DATE AND date <= $2::DATE
        GROUP BY ${expenseDateFormat}
        ORDER BY date ASC
        `,
        [from, to]
      );
    } catch (err) {
      console.warn('[Advanced] Expenses query failed:', err.message);
    }

    // ─── 5. COMPLETAR DATOS POR FECHA ─────────────────────────────────────
    const expensesMap = {};
    expensesResult.rows.forEach(e => {
      expensesMap[e.date] = Number(e.total_expenses) || 0;
    });

    const completeSales = allDates.map((dateStr) => {
      const day = dailyData[dateStr];
      return {
        date: dateStr,
        total_sales: Number(day?.sales || 0),
        total_cost: Number(day?.cost || 0),
        profit: Number(day?.profit || 0),
        orders: Number(day?.orders || 0),
        iva: Number(day?.iva || 0),
      };
    });

    const completeExpenses = allDates.map((dateStr) => ({
      date: dateStr,
      total_expenses: expensesMap[dateStr] || 0,
    }));

    // ─── 6. CALCULAR TOTALES ────────────────────────────────────────────
    const gananciaBruta = totalVentas - totalCostoFIFO;
    const totalGastos = completeExpenses.reduce((sum, e) => sum + e.total_expenses, 0);
    const gananciaNeta = gananciaBruta - totalGastos;
    const margen = totalVentas > 0 ? (gananciaNeta / totalVentas) * 100 : 0;
    const margenBruto = totalVentas > 0 ? (gananciaBruta / totalVentas) * 100 : 0;

    // ─── 7. OBTENER DETALLE DE LOTES USADOS (opcional) ──────────────────
    const lotsUsed = await query(
      `
      SELECT 
        COUNT(DISTINCT im.reference_id) as orders_with_fifo,
        COUNT(DISTINCT fl.id) as lots_used,
        SUM(ABS(im.quantity)) as total_lots_quantity
      FROM "${schema}".inventory_movements im
      INNER JOIN "${schema}".fifo_lots fl ON fl.product_id = im.product_id
      WHERE im.type = 'venta'
        AND im.applied = true
        AND DATE(im.created_at AT TIME ZONE '${TZ}') >= $1::DATE
        AND DATE(im.created_at AT TIME ZONE '${TZ}') <= $2::DATE
      `,
      [from, to]
    );

    // ─── 8. RESPONDER ────────────────────────────────────────────────────
    res.json({
      success: true,
      sales: completeSales,
      expenses: completeExpenses,
      totals: {
        total_ventas: parseFloat(totalVentas.toFixed(2)),
        total_costo_fifo: parseFloat(totalCostoFIFO.toFixed(2)),
        ganancia_bruta: parseFloat(gananciaBruta.toFixed(2)),
        total_gastos: parseFloat(totalGastos.toFixed(2)),
        ganancia_neta: parseFloat(gananciaNeta.toFixed(2)),
        margen: parseFloat(margen.toFixed(2)),
        margen_bruto: parseFloat(margenBruto.toFixed(2)),
        total_iva: parseFloat(totalIva.toFixed(2)),
        total_ordenes: totalOrdenes,
      },
      fifo_metrics: {
        orders_with_fifo: parseInt(lotsUsed.rows[0]?.orders_with_fifo || 0),
        lots_used: parseInt(lotsUsed.rows[0]?.lots_used || 0),
        total_lots_quantity: parseInt(lotsUsed.rows[0]?.total_lots_quantity || 0),
      },
      metadata: {
        invoiceSource: 'pos',
        dateRange: { from, to },
        groupBy: groupBy || 'day',
        totalDays: allDates.length,
        totalOrders: totalOrdenes,
      },
    });

  } catch (err) {
    console.error('[Advanced] Error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

/**
 * GET /api/reports/profit-detail
 * Obtiene detalle de ganancias por producto con FIFO
 */
router.get('/profit-detail', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    // ✅ Aceptamos category (opcional)
    const { from = null, to = null, category = null } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    const TZ = 'America/Guayaquil';

    // ─── 1. OBTENER ÓRDENES PAGADAS ──────────────────────────────
    const ordersResult = await query(
      `
      SELECT 
        o.id as order_id,
        o.order_number,
        o.total as order_total,
        o.created_at
      FROM "${schema}".pos_orders o
      WHERE o.status = 'paid'
        AND DATE(o.created_at AT TIME ZONE '${TZ}') >= $1::DATE
        AND DATE(o.created_at AT TIME ZONE '${TZ}') <= $2::DATE
      ORDER BY o.created_at ASC
      `,
      [from, to]
    );

    if (ordersResult.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          summary: {
            total_ventas: 0,
            total_costo: 0,
            total_ganancia: 0,
            total_ordenes: 0,
            margen_promedio: 0
          },
          products: [],
          orders: [],
          lots_used: []
        }
      });
    }

    const orderIds = ordersResult.rows.map(o => o.order_id);

    // ─── 2. OBTENER ITEMS CON CATEGORÍA Y BARCODE ────────────────
    // ✅ JOIN con products y categories para obtener barcode y category_name
    // ✅ Filtro por category (si se envía)
    const itemsResult = await query(
      `
      SELECT 
        oi.order_id,
        oi.product_id,
        oi.product_name,
        oi.quantity,
        oi.unit_price,
        oi.line_total,
        o.order_number,
        p.barcode,
        p.category_id,
        c.name as category_name
      FROM "${schema}".pos_order_items oi
      INNER JOIN "${schema}".pos_orders o ON o.id = oi.order_id
      INNER JOIN "${schema}".products p ON p.id = oi.product_id
      LEFT JOIN "${schema}".categories c ON c.id = p.category_id
      WHERE oi.order_id = ANY($1::uuid[])
        AND (($2::integer IS NULL) OR p.category_id = $2::integer)
      `,
      [orderIds, category]
    );

    // ─── 3. OBTENER COSTO FIFO ──────────────────────────────────
    const movementsResult = await query(
      `
      SELECT 
        im.product_id,
        im.quantity,
        im.unit_cost,
        im.reference_id,
        im.notes,
        im.created_at
      FROM "${schema}".inventory_movements im
      WHERE im.type = 'venta'
        AND im.reference_id::text = ANY($1::text[])
        AND im.applied = true
      `,
      [orderIds]
    );

    // ─── 4. OBTENER DETALLE DE LOTES ────────────────────────────
    const lotsUsedResult = await query(
      `
      SELECT 
        fl.id as lot_id,
        fl.product_id,
        fl.unit_cost,
        fl.purchase_date,
        fl.quantity as lot_quantity,
        fl.remaining_quantity,
        im.reference_id as order_id,
        im.quantity as quantity_used
      FROM "${schema}".fifo_lots fl
      INNER JOIN "${schema}".inventory_movements im 
        ON im.product_id = fl.product_id 
        AND im.type = 'venta'
        AND im.reference_id::text = ANY($1::text[])
      WHERE fl.is_active = false 
        OR fl.remaining_quantity < fl.quantity
      ORDER BY fl.purchase_date ASC
      `,
      [orderIds]
    );

    // ─── 5. CALCULAR GANANCIA POR PRODUCTO ──────────────────────
    const productMap = new Map();
    let totalVentas = 0, totalCosto = 0, totalGanancia = 0;

    for (const item of itemsResult.rows) {
      const productId = item.product_id;
      if (!productMap.has(productId)) {
        productMap.set(productId, {
          product_id: productId,
          product_name: item.product_name || 'Producto',
          barcode: item.barcode || '',
          category_name: item.category_name || 'Sin categoría',
          category_id: item.category_id,
          total_quantity: 0,
          total_ventas: 0,
          total_costo: 0,
          total_ganancia: 0,
          precio_promedio: 0,
          costo_promedio: 0,
          orders: []
        });
      }
      const product = productMap.get(productId);
      product.total_quantity += parseInt(item.quantity) || 0;
      product.total_ventas += parseFloat(item.line_total) || 0;
      product.orders.push(item.order_id);
    }

    // Asignar costos FIFO
    for (const movement of movementsResult.rows) {
      const productId = movement.product_id;
      if (productMap.has(productId)) {
        const product = productMap.get(productId);
        const cost = Math.abs(parseFloat(movement.quantity) * parseFloat(movement.unit_cost));
        product.total_costo += cost;
        product.total_ganancia = product.total_ventas - product.total_costo;
      }
    }

    // Construir array de productos
    const products = [];
    for (const [, product] of productMap) {
      const ventas = product.total_ventas;
      const costo = product.total_costo;
      const ganancia = ventas - costo;
      totalVentas += ventas;
      totalCosto += costo;
      totalGanancia += ganancia;
      products.push({
        ...product,
        total_ventas: parseFloat(ventas.toFixed(2)),
        total_costo: parseFloat(costo.toFixed(2)),
        total_ganancia: parseFloat(ganancia.toFixed(2)),
        precio_promedio: product.total_quantity > 0 ? parseFloat((ventas / product.total_quantity).toFixed(2)) : 0,
        costo_promedio: product.total_quantity > 0 ? parseFloat((costo / product.total_quantity).toFixed(2)) : 0,
        margen: ventas > 0 ? parseFloat(((ganancia / ventas) * 100).toFixed(2)) : 0
      });
    }

    products.sort((a, b) => b.total_ganancia - a.total_ganancia);

    const margenTotal = totalVentas > 0 ? (totalGanancia / totalVentas) * 100 : 0;

    // ─── 6. RESPONDER ────────────────────────────────────────────────────
    res.json({
      success: true,
      data: {
        summary: {
          total_ventas: parseFloat(totalVentas.toFixed(2)),
          total_costo: parseFloat(totalCosto.toFixed(2)),
          total_ganancia: parseFloat(totalGanancia.toFixed(2)),
          total_ordenes: ordersResult.rows.length,
          margen_promedio: parseFloat(margenTotal.toFixed(2))
        },
        products,
        orders: ordersResult.rows.map(o => ({
          ...o,
          order_total: parseFloat((Number(o.order_total) || 0).toFixed(2))
        })),
        lots_used: lotsUsedResult.rows.map(l => ({
          ...l,
          unit_cost: parseFloat(l.unit_cost) || 0,
          quantity_used: parseInt(l.quantity_used) || 0
        }))
      }
    });

  } catch (err) {
    console.error('[ProfitDetail] Error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

export default router;
