// routes/purchaseOrders.js
import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { generateOrderNumber } from '../utils/orderNumberGenerator.js';

const router = express.Router();

// ============================================================
// HELPERS
// ============================================================

/**
 * Obtiene los items de una orden según su tipo
 */
async function getOrderItems(schema, orderId, orderType) {
    if (orderType === 'COMMERCIAL') {
        return await query(`
            SELECT 
                ci.id,
                ci.purchase_order_id,
                ci.product_id,
                ci.quantity,
                ci.received_qty,
                ci.notes,
                ci.created_at,
                ci.updated_at,
                p.code as product_code,
                p.name as product_name,
                p.barcode as product_barcode,
                p.min_stock,
                p.product_type,
                p.unit_cost as default_unit_cost,
                'COMMERCIAL' as source_type,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', pois.id,
                            'supplier_id', pois.supplier_id,
                            'supplier_name', s.name,
                            'quantity', pois.quantity,
                            'unit_cost', pois.unit_cost,
                            'line_total', pois.line_total,
                            'received_qty', pois.received_qty
                        )
                    ) FILTER (WHERE pois.id IS NOT NULL),
                    '[]'::json
                ) as suppliers
            FROM "${schema}".purchase_order_items_comm ci
            LEFT JOIN "${schema}".products p ON ci.product_id = p.id
            LEFT JOIN "${schema}".purchase_order_item_suppliers pois ON ci.id = pois.item_comm_id
            LEFT JOIN "${schema}".suppliers s ON pois.supplier_id = s.id
            WHERE ci.purchase_order_id = $1
            GROUP BY ci.id, p.code, p.name, p.barcode, p.min_stock, p.product_type, p.unit_cost
            ORDER BY ci.created_at ASC
        `, [orderId]);
    } else {
        return await query(`
            SELECT 
                mi.id,
                mi.purchase_order_id,
                mi.product_id,
                mi.recipe_id,
                mi.raw_material_id,
                mi.quantity,
                mi.required_quantity,
                mi.received_qty,
                mi.notes,
                mi.created_at,
                mi.updated_at,
                p.name as product_name_manufactured,
                p.code as product_code_manufactured,
                r.description as recipe_description,
                rm.name as raw_material_name,
                rm.code as raw_material_code,
                rm.unit as raw_material_unit,
                'MANUFACTURED' as source_type,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', pois.id,
                            'supplier_id', pois.supplier_id,
                            'supplier_name', s.name,
                            'quantity', pois.quantity,
                            'unit_cost', pois.unit_cost,
                            'line_total', pois.line_total,
                            'received_qty', pois.received_qty
                        )
                    ) FILTER (WHERE pois.id IS NOT NULL),
                    '[]'::json
                ) as suppliers
            FROM "${schema}".purchase_order_items_man mi
            LEFT JOIN "${schema}".products p ON mi.product_id = p.id
            LEFT JOIN "${schema}".recipes r ON mi.recipe_id = r.id
            LEFT JOIN "${schema}".raw_materials rm ON mi.raw_material_id = rm.id
            LEFT JOIN "${schema}".purchase_order_item_suppliers pois ON mi.id = pois.item_man_id
            LEFT JOIN "${schema}".suppliers s ON pois.supplier_id = s.id
            WHERE mi.purchase_order_id = $1
            GROUP BY mi.id, p.name, p.code, r.description, rm.name, rm.code, rm.unit
            ORDER BY mi.created_at ASC
        `, [orderId]);
    }
}

// ============================================================
// GET /api/purchase-orders
// Listar todas las órdenes de compra
// ============================================================
router.get('/', authMiddleware, async (req, res) => {
    try {
        const schema = await getSchemaName(req);
        
        const result = await query(`
            SELECT 
                po.*,
                COALESCE(
                    (SELECT COUNT(*) FROM "${schema}".purchase_order_items_comm WHERE purchase_order_id = po.id),
                    0
                ) + COALESCE(
                    (SELECT COUNT(*) FROM "${schema}".purchase_order_items_man WHERE purchase_order_id = po.id),
                    0
                ) as item_count
            FROM "${schema}".purchase_orders po
            ORDER BY po.created_at DESC
        `);
        
        res.json(result.rows);
    } catch (err) {
        console.error('Error en GET /purchase-orders:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/purchase-orders/:id
// Obtener una orden de compra con sus items
// ============================================================
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const schema = await getSchemaName(req);
        
        const orderResult = await query(`
            SELECT * FROM "${schema}".purchase_orders WHERE id = $1
        `, [id]);
        
        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }
        
        const order = orderResult.rows[0];
        const itemsResult = await getOrderItems(schema, id, order.order_type);
        
        res.json({
            order: order,
            items: itemsResult.rows
        });
    } catch (err) {
        console.error('Error en GET /purchase-orders/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/purchase-orders/suggestions/items
// Obtener sugerencias de productos con stock bajo
// ============================================================
router.get('/suggestions/items', authMiddleware, async (req, res) => {
    try {
        const schema = await getSchemaName(req);
        
        // 1. Productos COMMERCIAL con min_stock bajo
        const commercialResult = await query(`
            SELECT 
                p.id,
                p.code,
                p.name,
                p.barcode,
                p.stock,
                p.min_stock,
                p.unit_cost,
                'COMMERCIAL' as source_type,
                NULL as recipe_id,
                NULL as yield_qty,
                NULL as yield_unit,
                NULL::jsonb as ingredients,
                p.stock as calculated_stock,
                p.min_stock as calculated_min_stock
            FROM "${schema}".products p
            WHERE p.product_type = 'COMMERCIAL' 
                AND p.is_active = true
                AND p.stock <= p.min_stock
            ORDER BY (p.min_stock - p.stock) DESC
        `);
        
        // 2. Productos MANUFACTURED con stock calculado
        const manufacturedResult = await query(`
            WITH 
            material_capacity AS (
                SELECT 
                    r.product_id,
                    MIN(
                        CASE 
                            WHEN ri.quantity > 0 
                            THEN FLOOR(COALESCE(rm.stock, 0) / ri.quantity)
                            ELSE 0
                        END
                    ) as max_units_producible,
                    MIN(
                        CASE 
                            WHEN ri.quantity > 0 
                            THEN FLOOR(COALESCE(rm.min_stock, 0) / ri.quantity)
                            ELSE 0
                        END
                    ) as max_units_for_min_stock
                FROM "${schema}".recipes r
                INNER JOIN "${schema}".recipe_ingredients ri 
                    ON ri.recipe_id = r.id
                INNER JOIN "${schema}".raw_materials rm 
                    ON rm.id = ri.raw_material_id 
                    AND rm.is_active = true
                WHERE r.is_active = true
                GROUP BY r.product_id
            )
            SELECT 
                p.id,
                p.code,
                p.name,
                p.barcode,
                COALESCE(mc.max_units_producible, 0) as stock,
                COALESCE(mc.max_units_for_min_stock, 0) as min_stock,
                p.unit_cost,
                'MANUFACTURED' as source_type,
                r.id as recipe_id,
                r.yield_qty,
                r.yield_unit,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'raw_material_id', rm.id,
                            'raw_material_name', rm.name,
                            'raw_material_code', rm.code,
                            'quantity_needed', ri.quantity,
                            'stock_available', rm.stock,
                            'units_producible',
                                CASE 
                                    WHEN ri.quantity > 0 
                                    THEN FLOOR(COALESCE(rm.stock, 0) / ri.quantity)
                                    ELSE 0
                                END,
                            'unit', rm.unit,
                            'unit_cost', rm.unit_cost,
                            'total_cost', ri.quantity * rm.unit_cost,
                            'min_stock', rm.min_stock
                        )
                    ) FILTER (WHERE rm.id IS NOT NULL),
                    '[]'::json
                ) as ingredients,
                COALESCE(mc.max_units_producible, 0) as calculated_stock,
                COALESCE(mc.max_units_for_min_stock, 0) as calculated_min_stock
            FROM "${schema}".products p
            INNER JOIN "${schema}".recipes r 
                ON p.id = r.product_id 
                AND r.is_active = true
            INNER JOIN material_capacity mc 
                ON mc.product_id = p.id
            LEFT JOIN "${schema}".recipe_ingredients ri 
                ON r.id = ri.recipe_id
            LEFT JOIN "${schema}".raw_materials rm 
                ON ri.raw_material_id = rm.id 
                AND rm.is_active = true
            WHERE p.product_type = 'MANUFACTURED' 
                AND p.is_active = true
                AND COALESCE(mc.max_units_producible, 0) <= COALESCE(mc.max_units_for_min_stock, 0)
                AND EXISTS (
                    SELECT 1 
                    FROM "${schema}".recipe_ingredients ri2 
                    WHERE ri2.recipe_id = r.id
                )
            GROUP BY p.id, r.id, mc.max_units_producible, mc.max_units_for_min_stock
            HAVING COUNT(rm.id) > 0
            ORDER BY (COALESCE(mc.max_units_for_min_stock, 0) - COALESCE(mc.max_units_producible, 0)) DESC
        `);
        
        res.json({
            commercial: commercialResult.rows,
            manufactured: manufacturedResult.rows
        });
    } catch (err) {
        console.error('Error en GET /purchase-orders/suggestions/items:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/purchase-orders/suppliers/:productId
// Obtener proveedores que han vendido un producto
// ============================================================
router.get('/suppliers/:productId', authMiddleware, async (req, res) => {
    try {
        const { productId } = req.params;
        const schema = await getSchemaName(req);
        
        const result = await query(`
            SELECT DISTINCT
                s.id,
                s.name,
                s.tax_id,
                s.phone,
                s.email,
                psh.last_unit_cost,
                psh.total_orders,
                psh.last_order_date
            FROM "${schema}".suppliers s
            JOIN "${schema}".product_supplier_history psh ON s.id = psh.supplier_id
            WHERE psh.product_id = $1
            ORDER BY psh.total_orders DESC, psh.last_order_date DESC
        `, [productId]);
        
        if (result.rows.length === 0) {
            const allSuppliers = await query(`
                SELECT 
                    id,
                    name,
                    tax_id,
                    phone,
                    email,
                    NULL as last_unit_cost,
                    0 as total_orders,
                    NULL as last_order_date
                FROM "${schema}".suppliers
                WHERE is_active = true
                ORDER BY name ASC
            `);
            return res.json(allSuppliers.rows);
        }
        
        res.json(result.rows);
    } catch (err) {
        console.error('Error en GET /purchase-orders/suppliers/:productId:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/purchase-orders/products/with-recipe
// Obtener productos con sus recetas y materiales
// ============================================================
router.get('/products/with-recipe', authMiddleware, async (req, res) => {
    try {
        const { product_type } = req.query;
        
        if (!['COMMERCIAL', 'MANUFACTURED'].includes(product_type)) {
            return res.status(400).json({
                error: 'product_type debe ser COMMERCIAL o MANUFACTURED'
            });
        }
        
        const schema = await getSchemaName(req);
        
        const result = await query(`
            WITH 
            material_production_capacity AS (
                SELECT 
                    r.product_id,
                    MIN(
                        CASE 
                            WHEN ri.quantity > 0 
                            THEN FLOOR(COALESCE(rm.stock, 0) / ri.quantity)
                            ELSE 0
                        END
                    ) as max_units_producible,
                    MIN(
                        CASE 
                            WHEN ri.quantity > 0 
                            THEN FLOOR(COALESCE(rm.min_stock, 0) / ri.quantity)
                            ELSE 0
                        END
                    ) as max_units_for_min_stock
                FROM "${schema}".recipes r
                INNER JOIN "${schema}".recipe_ingredients ri 
                    ON ri.recipe_id = r.id
                INNER JOIN "${schema}".raw_materials rm 
                    ON rm.id = ri.raw_material_id 
                    AND rm.is_active = true
                WHERE r.is_active = true
                GROUP BY r.product_id
            )
            SELECT
                p.id,
                p.code,
                p.name,
                p.description,
                p.category_id,
                p.unit_cost,
                p.selling_price,
                p.tax_rate,
                p.is_taxable,
                p.is_active,
                p.sku,
                p.barcode,
                CASE 
                    WHEN p.product_type = 'MANUFACTURED' 
                    THEN COALESCE(mpc.max_units_producible, 0)
                    ELSE p.stock
                END AS stock,
                CASE 
                    WHEN p.product_type = 'MANUFACTURED' 
                    THEN COALESCE(mpc.max_units_for_min_stock, 0)
                    ELSE p.min_stock
                END AS min_stock,
                p.created_at,
                p.updated_at,
                p.product_type,
                r.id AS recipe_id,
                r.description AS recipe_description,
                r.yield_qty,
                r.yield_unit,
                r.total_cost AS recipe_total_cost,
                CASE
                    WHEN p.product_type = 'MANUFACTURED'
                    THEN COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'id', rm.id,
                                'code', rm.code,
                                'name', rm.name,
                                'description', rm.description,
                                'unit', rm.unit,
                                'quantity_needed', ri.quantity,
                                'stock_available', rm.stock,
                                'units_producible',
                                    CASE 
                                        WHEN ri.quantity > 0 
                                        THEN FLOOR(COALESCE(rm.stock, 0) / ri.quantity)
                                        ELSE 0
                                    END,
                                'conversion_factor', ri.conversion_factor,
                                'unit_cost', ri.unit_cost,
                                'total_cost', ri.total_cost,
                                'min_stock', rm.min_stock,
                                'is_active', rm.is_active,
                                'barcode', rm.barcode,
                                'sku', rm.sku
                            )
                            ORDER BY rm.name
                        ) FILTER (WHERE rm.id IS NOT NULL),
                        '[]'::jsonb
                    )
                    ELSE '[]'::jsonb
                END AS materials
            FROM "${schema}".products p
            LEFT JOIN "${schema}".recipes r
                ON r.product_id = p.id
                AND r.is_active = true
            LEFT JOIN "${schema}".recipe_ingredients ri
                ON ri.recipe_id = r.id
            LEFT JOIN "${schema}".raw_materials rm
                ON rm.id = ri.raw_material_id
                AND rm.is_active = true
            LEFT JOIN material_production_capacity mpc
                ON mpc.product_id = p.id
            WHERE
                p.is_active = true
                AND p.product_type = $1
                AND (
                    p.product_type = 'COMMERCIAL'
                    OR (
                        p.product_type = 'MANUFACTURED'
                        AND r.id IS NOT NULL
                    )
                )
            GROUP BY
                p.id,
                p.code,
                p.name,
                p.description,
                p.category_id,
                p.unit_cost,
                p.selling_price,
                p.tax_rate,
                p.is_taxable,
                p.is_active,
                p.sku,
                p.barcode,
                p.stock,
                p.min_stock,
                p.created_at,
                p.updated_at,
                p.product_type,
                r.id,
                r.description,
                r.yield_qty,
                r.yield_unit,
                r.total_cost,
                mpc.max_units_producible,
                mpc.max_units_for_min_stock
            ORDER BY p.name
        `, [product_type]);

        res.json(result.rows);
    } catch (err) {
        console.error('Error en GET /purchase-orders/products/with-recipe:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/purchase-orders (SOLO CREA ORDEN - SIN PRECIOS)
// ============================================================
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { 
            order_date, 
            expected_at,
            notes, 
            items,
            order_type
        } = req.body;
        
        const schema = await getSchemaName(req);
        const userId = req.user.id;
        
        if (!order_type || !['COMMERCIAL', 'MANUFACTURED'].includes(order_type)) {
            return res.status(400).json({ 
                error: 'order_type debe ser COMMERCIAL o MANUFACTURED' 
            });
        }
        
        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'Se requieren items para la orden' });
        }
        
        // Validar items según el tipo
        if (order_type === 'COMMERCIAL') {
            for (const item of items) {
                if (!item.product_id) {
                    return res.status(400).json({ 
                        error: 'COMMERCIAL requiere product_id' 
                    });
                }
                if (!item.quantity || item.quantity <= 0) {
                    return res.status(400).json({ 
                        error: 'Cantidad debe ser mayor a 0' 
                    });
                }
            }
        } else {
            for (const item of items) {
                if (!item.raw_material_id) {
                    return res.status(400).json({ 
                        error: 'MANUFACTURED requiere raw_material_id' 
                    });
                }
                if (!item.product_id) {
                    return res.status(400).json({ 
                        error: 'MANUFACTURED requiere product_id (producto origen)' 
                    });
                }
                if (!item.recipe_id) {
                    return res.status(400).json({ 
                        error: 'MANUFACTURED requiere recipe_id' 
                    });
                }
                if (!item.quantity || item.quantity <= 0) {
                    return res.status(400).json({ 
                        error: 'Cantidad debe ser mayor a 0' 
                    });
                }
                
                const ingredientCheck = await query(`
                    SELECT id FROM "${schema}".recipe_ingredients 
                    WHERE recipe_id = $1 AND raw_material_id = $2
                `, [item.recipe_id, item.raw_material_id]);
                
                if (ingredientCheck.rows.length === 0) {
                    return res.status(400).json({ 
                        error: `La materia prima ${item.raw_material_id} no pertenece a la receta ${item.recipe_id}` 
                    });
                }
            }
        }
        
        const orderNumber = await generateOrderNumber(schema);
        
        await query('BEGIN');
        
        const orderResult = await query(`
            INSERT INTO "${schema}".purchase_orders (
                order_number,
                order_type,
                order_date,
                expected_at,
                notes,
                created_by,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, 'draft')
            RETURNING *
        `, [orderNumber, order_type, order_date || new Date(), expected_at, notes, userId]);
        
        const order = orderResult.rows[0];
        
        // Insertar items según el tipo (SOLO producto/cantidad, SIN PRECIOS)
        if (order_type === 'COMMERCIAL') {
            for (const item of items) {
                await query(`
                    INSERT INTO "${schema}".purchase_order_items_comm (
                        purchase_order_id,
                        product_id,
                        quantity,
                        notes
                    ) VALUES ($1, $2, $3, $4)
                `, [
                    order.id,
                    item.product_id,
                    item.quantity,
                    item.notes || null
                ]);
            }
        } else {
            // MANUFACTURED - SOLO materia prima y cantidad
            for (const item of items) {
                await query(`
                    INSERT INTO "${schema}".purchase_order_items_man (
                        purchase_order_id,
                        product_id,
                        recipe_id,
                        raw_material_id,
                        quantity,
                        required_quantity,
                        notes
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    order.id,
                    item.product_id,
                    item.recipe_id,
                    item.raw_material_id,
                    item.quantity,
                    item.required_quantity || item.quantity,
                    item.notes || null
                ]);
            }
        }
        
        await query('COMMIT');
        
        const result = await query(`
            SELECT 
                po.*,
                COALESCE(
                    (SELECT COUNT(*) FROM "${schema}".purchase_order_items_comm WHERE purchase_order_id = po.id),
                    0
                ) + COALESCE(
                    (SELECT COUNT(*) FROM "${schema}".purchase_order_items_man WHERE purchase_order_id = po.id),
                    0
                ) as item_count
            FROM "${schema}".purchase_orders po
            WHERE po.id = $1
            GROUP BY po.id
        `, [order.id]);
        
        res.status(201).json(result.rows[0]);
    } catch (err) {
        await query('ROLLBACK');
        console.error('❌ Error en POST /purchase-orders:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/purchase-orders/:id (SOLO ACTUALIZA - SIN PRECIOS)
// ============================================================
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { notes, items } = req.body;

        const schema = await getSchemaName(req);

        const orderResult = await query(`
            SELECT * FROM "${schema}".purchase_orders WHERE id = $1
        `, [id]);

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }

        const order = orderResult.rows[0];

        if (order.status !== 'draft') {
            return res.status(400).json({ 
                error: `No se puede editar una orden en estado "${order.status}"` 
            });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Se requieren items para la orden' });
        }

        const orderType = order.order_type;

        await query('BEGIN');

        try {
            await query(`
                UPDATE "${schema}".purchase_orders
                SET notes = $1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [notes || null, id]);

            let currentItems;
            if (orderType === 'COMMERCIAL') {
                currentItems = await query(`
                    SELECT id FROM "${schema}".purchase_order_items_comm 
                    WHERE purchase_order_id = $1
                `, [id]);
            } else {
                currentItems = await query(`
                    SELECT id FROM "${schema}".purchase_order_items_man 
                    WHERE purchase_order_id = $1
                `, [id]);
            }

            const currentItemIds = currentItems.rows.map(row => row.id);
            const incomingItemIds = items.filter(item => item.id).map(item => item.id);

            const itemsToDelete = currentItemIds.filter(
                currentId => !incomingItemIds.includes(currentId)
            );

            if (itemsToDelete.length > 0) {
                const tableName = orderType === 'COMMERCIAL' ? 'item_comm_id' : 'item_man_id';
                await query(`
                    DELETE FROM "${schema}".purchase_order_item_suppliers
                    WHERE ${tableName} = ANY($1::uuid[])
                `, [itemsToDelete]);

                const itemsTable = orderType === 'COMMERCIAL' 
                    ? 'purchase_order_items_comm' 
                    : 'purchase_order_items_man';
                
                await query(`
                    DELETE FROM "${schema}".${itemsTable}
                    WHERE id = ANY($1::uuid[])
                    AND purchase_order_id = $2
                `, [itemsToDelete, id]);
            }

            if (orderType === 'COMMERCIAL') {
                for (const item of items) {
                    if (item.id && currentItemIds.includes(item.id)) {
                        await query(`
                            UPDATE "${schema}".purchase_order_items_comm
                            SET product_id = $1, quantity = $2, notes = $3, updated_at = CURRENT_TIMESTAMP
                            WHERE id = $4 AND purchase_order_id = $5
                        `, [
                            item.product_id,
                            item.quantity,
                            item.notes || null,
                            item.id,
                            id
                        ]);
                    } else {
                        await query(`
                            INSERT INTO "${schema}".purchase_order_items_comm (
                                purchase_order_id, product_id, quantity, notes
                            ) VALUES ($1, $2, $3, $4)
                        `, [
                            id,
                            item.product_id,
                            item.quantity,
                            item.notes || null
                        ]);
                    }
                }
            } else {
                // MANUFACTURED
                for (const item of items) {
                    if (item.id && currentItemIds.includes(item.id)) {
                        await query(`
                            UPDATE "${schema}".purchase_order_items_man
                            SET product_id = $1, recipe_id = $2, raw_material_id = $3,
                                quantity = $4, required_quantity = $5, notes = $6, updated_at = CURRENT_TIMESTAMP
                            WHERE id = $7 AND purchase_order_id = $8
                        `, [
                            item.product_id,
                            item.recipe_id,
                            item.raw_material_id,
                            item.quantity,
                            item.required_quantity || item.quantity,
                            item.notes || null,
                            item.id,
                            id
                        ]);
                    } else {
                        await query(`
                            INSERT INTO "${schema}".purchase_order_items_man (
                                purchase_order_id, product_id, recipe_id, raw_material_id,
                                quantity, required_quantity, notes
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                        `, [
                            id,
                            item.product_id,
                            item.recipe_id,
                            item.raw_material_id,
                            item.quantity,
                            item.required_quantity || item.quantity,
                            item.notes || null
                        ]);
                    }
                }
            }

            await query('COMMIT');

        } catch (transactionError) {
            await query('ROLLBACK');
            throw transactionError;
        }

        const result = await query(`
            SELECT 
                po.*,
                COALESCE(
                    (SELECT COUNT(*) FROM "${schema}".purchase_order_items_comm WHERE purchase_order_id = po.id),
                    0
                ) + COALESCE(
                    (SELECT COUNT(*) FROM "${schema}".purchase_order_items_man WHERE purchase_order_id = po.id),
                    0
                ) as item_count
            FROM "${schema}".purchase_orders po
            WHERE po.id = $1
            GROUP BY po.id
        `, [id]);

        res.json(result.rows[0]);

    } catch (err) {
        console.error('❌ Error en PUT /purchase-orders/:id:', err);
        try { await query('ROLLBACK'); } catch (_) {}
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/purchase-orders/:id/status
// Cambiar estado de una orden
// ============================================================
router.put('/:id/status', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const schema = await getSchemaName(req);
        
        const validStatuses = ['draft', 'pending', 'approved', 'received', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ 
                error: 'Estado no válido. Debe ser: draft, pending, approved, received o cancelled' 
            });
        }
        
        const checkResult = await query(`
            SELECT id, status, order_number, order_type
            FROM "${schema}".purchase_orders 
            WHERE id = $1::uuid
        `, [id]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }
        
        const currentStatus = checkResult.rows[0].status;
        const orderNumber = checkResult.rows[0].order_number;
        
        const validTransitions = {
            'draft': ['pending', 'approved', 'cancelled'],
            'pending': ['approved', 'cancelled'],
            'approved': ['received', 'cancelled'],
            'received': [],
            'cancelled': []
        };
        
        if (!validTransitions[currentStatus].includes(status)) {
            return res.status(400).json({ 
                error: `No se puede cambiar de "${currentStatus}" a "${status}" para la orden #${orderNumber}` 
            });
        }
        
        await query(`
            UPDATE "${schema}".purchase_orders 
            SET 
                status = $1::text,
                received_at = CASE WHEN $1::text = 'received' THEN CURRENT_TIMESTAMP ELSE received_at END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2::uuid
        `, [status, id]);
        
        const result = await query(`
            SELECT 
                po.*,
                COALESCE(
                    (SELECT COUNT(*) FROM "${schema}".purchase_order_items_comm WHERE purchase_order_id = po.id),
                    0
                ) + COALESCE(
                    (SELECT COUNT(*) FROM "${schema}".purchase_order_items_man WHERE purchase_order_id = po.id),
                    0
                ) as item_count
            FROM "${schema}".purchase_orders po
            WHERE po.id = $1::uuid
            GROUP BY po.id
        `, [id]);
        
        res.json(result.rows[0]);
        
    } catch (err) {
        console.error('Error en PUT /purchase-orders/:id/status:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/purchase-orders/:orderId/items/:itemId
// Eliminar un item de una orden
// ============================================================
router.delete('/:orderId/items/:itemId', authMiddleware, async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const schema = await getSchemaName(req);

        const orderCheck = await query(`
            SELECT status, order_type FROM "${schema}".purchase_orders WHERE id = $1
        `, [orderId]);

        if (orderCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }

        if (orderCheck.rows[0].status !== 'draft') {
            return res.status(400).json({ 
                error: 'Solo se pueden eliminar items de órdenes en estado "Borrador"' 
            });
        }

        const orderType = orderCheck.rows[0].order_type;
        const tableName = orderType === 'COMMERCIAL' 
            ? 'purchase_order_items_comm' 
            : 'purchase_order_items_man';

        const itemCheck = await query(`
            SELECT id FROM "${schema}".${tableName}
            WHERE id = $1::uuid AND purchase_order_id = $2::uuid
        `, [itemId, orderId]);

        if (itemCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Item no encontrado en esta orden' });
        }

        const supplierColumn = orderType === 'COMMERCIAL' ? 'item_comm_id' : 'item_man_id';
        await query(`
            DELETE FROM "${schema}".purchase_order_item_suppliers
            WHERE ${supplierColumn} = $1::uuid
        `, [itemId]);

        await query(`
            DELETE FROM "${schema}".${tableName}
            WHERE id = $1::uuid AND purchase_order_id = $2::uuid
        `, [itemId, orderId]);

        res.json({ success: true, message: 'Item eliminado correctamente' });

    } catch (err) {
        console.error('Error en DELETE /purchase-orders/:orderId/items/:itemId:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/purchase-orders/:id
// Eliminar una orden (solo si está en draft)
// ============================================================
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const schema = await getSchemaName(req);
        
        const checkResult = await query(`
            SELECT status, order_type FROM "${schema}".purchase_orders WHERE id = $1
        `, [id]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }
        
        if (checkResult.rows[0].status !== 'draft') {
            return res.status(400).json({ error: 'Solo se pueden eliminar órdenes en borrador' });
        }
        
        const orderType = checkResult.rows[0].order_type;
        const tableName = orderType === 'COMMERCIAL' 
            ? 'purchase_order_items_comm' 
            : 'purchase_order_items_man';
        
        await query(`
            DELETE FROM "${schema}".${tableName} WHERE purchase_order_id = $1
        `, [id]);
        
        await query(`
            DELETE FROM "${schema}".purchase_orders WHERE id = $1
        `, [id]);
        
        res.json({ success: true, message: 'Orden eliminada correctamente' });
    } catch (err) {
        console.error('Error en DELETE /purchase-orders/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/purchase-orders/stats
// Obtener estadísticas de órdenes
// ============================================================
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const schema = await getSchemaName(req);
        
        const result = await query(`
            SELECT 
                COUNT(*) as total_orders,
                COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_count,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
                COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count,
                COUNT(CASE WHEN status = 'received' THEN 1 END) as received_count,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_count,
                COUNT(CASE WHEN order_type = 'COMMERCIAL' THEN 1 END) as commercial_count,
                COUNT(CASE WHEN order_type = 'MANUFACTURED' THEN 1 END) as manufactured_count
            FROM "${schema}".purchase_orders po
        `);
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error en GET /purchase-orders/stats:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;