// services/fifoService.js
import { query } from '../config/database.js';

class FIFOService {
  constructor(schema) {
    this.schema = schema;
  }

  /**
   * Registrar salida FIFO - Cuando se paga una orden
   */
  async registerSale(productId, orderId, quantity) {
    // 1. Obtener lotes activos (más antiguos primero)
    const lots = await query(`
      SELECT id, remaining_quantity, unit_cost, purchase_date
      FROM "${this.schema}".fifo_lots
      WHERE product_id = $1 
        AND is_active = true 
        AND remaining_quantity > 0
      ORDER BY purchase_date ASC, created_at ASC
    `, [productId]);

    if (lots.rows.length === 0) {
      throw new Error(`No hay stock disponible para el producto ${productId}`);
    }

    let remaining = quantity;
    let totalCost = 0;
    const usedLots = [];

    // 2. Recorrer lotes hasta cubrir la cantidad vendida
    for (const lot of lots.rows) {
      if (remaining <= 0) break;

      const take = Math.min(lot.remaining_quantity, remaining);
      const cost = take * parseFloat(lot.unit_cost);
      totalCost += cost;
      remaining -= take;

      // 3. Actualizar lote
      const newRemaining = lot.remaining_quantity - take;
      await query(`
        UPDATE "${this.schema}".fifo_lots
        SET remaining_quantity = $1, 
            is_active = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [newRemaining, newRemaining > 0, lot.id]);

      usedLots.push({
        lotId: lot.id,
        quantity: take,
        unitCost: lot.unit_cost,
        purchaseDate: lot.purchase_date
      });
    }

    if (remaining > 0) {
      throw new Error(`Stock insuficiente. Faltan ${remaining} unidades del producto ${productId}`);
    }

    // 4. Registrar movimiento en inventory_movements
    const averageCost = totalCost / quantity;
    const notes = `Venta #${orderId} - FIFO: ${usedLots.length} lotes - Costo total: $${totalCost.toFixed(2)}`;
    
    // ✅ quantity negativo (salida), reference_id = orderId (UUID como texto)
    const result = await query(`
        INSERT INTO "${this.schema}".inventory_movements (
        product_id,
        type,
        quantity,
        unit_cost,
        reference_id,
        notes,
        applied,
        created_at
        ) VALUES ($1, 'venta', $2, $3, $4, $5, true, NOW())
        RETURNING *
    `, [productId, -quantity, averageCost, orderId, notes]);

    return {
        totalCost,
        averageCost,
        usedLots,
        quantity,
        movement: result.rows[0]
    };
    }
    
  /**
   * Calcular ganancia de una orden específica
   */
  async getOrderProfit(orderId) {
    // Total de la orden
    const order = await query(`
      SELECT total, subtotal, tax_amount 
      FROM "${this.schema}".pos_orders 
      WHERE id = $1
    `, [orderId]);

    if (order.rows.length === 0) {
      throw new Error('Orden no encontrada');
    }

    // Costo total de los items vendidos
    const cost = await query(`
      SELECT 
        SUM(quantity * unit_cost) as total_cost,
        COUNT(*) as items_count
      FROM "${this.schema}".inventory_movements
      WHERE reference_id = $1 AND type = 'sale'
    `, [orderId]);

    const total = parseFloat(order.rows[0].total) || 0;
    const totalCost = parseFloat(cost.rows[0]?.total_cost) || 0;
    const itemsCount = parseInt(cost.rows[0]?.items_count) || 0;

    return {
      orderId,
      total,
      totalCost,
      profit: total - totalCost,
      margin: total > 0 ? ((total - totalCost) / total) * 100 : 0,
      itemsCount
    };
  }

  /**
   * Calcular ganancia neta por período
   */
  async getPeriodProfit(from, to) {
    // 1. Ventas totales del período
    const sales = await query(`
      SELECT 
        COALESCE(SUM(total), 0) as total_sales,
        COUNT(*) as total_orders
      FROM "${this.schema}".pos_orders
      WHERE status = 'paid'
        AND DATE(created_at) >= $1::DATE
        AND DATE(created_at) <= $2::DATE
    `, [from, to]);

    // 2. Costo total de ventas (FIFO)
    const cost = await query(`
      SELECT 
        COALESCE(SUM(quantity * unit_cost), 0) as total_cost
      FROM "${this.schema}".inventory_movements
      WHERE type = 'sale'
        AND applied = true
        AND created_at >= $1::TIMESTAMP
        AND created_at <= $2::TIMESTAMP
    `, [from + ' 00:00:00', to + ' 23:59:59']);

    // 3. Gastos operativos
    const expenses = await query(`
      SELECT COALESCE(SUM(amount), 0) as total_expenses
      FROM "${this.schema}".expenses
      WHERE DATE(date) >= $1::DATE AND DATE(date) <= $2::DATE
    `, [from, to]);

    const totalSales = parseFloat(sales.rows[0]?.total_sales) || 0;
    const totalCost = parseFloat(cost.rows[0]?.total_cost) || 0;
    const totalExpenses = parseFloat(expenses.rows[0]?.total_expenses) || 0;
    const totalOrders = parseInt(sales.rows[0]?.total_orders) || 0;

    const grossProfit = totalSales - totalCost;
    const netProfit = grossProfit - totalExpenses;

    return {
      totalSales,
      totalCost,
      grossProfit,
      totalExpenses,
      netProfit,
      margin: totalSales > 0 ? (netProfit / totalSales) * 100 : 0,
      totalOrders,
      period: { from, to }
    };
  }

  /**
   * Obtener detalle de ganancia por día
   */
  async getDailyProfit(from, to) {
    const result = await query(`
      SELECT 
        DATE(created_at) as date,
        COALESCE(SUM(quantity * unit_cost), 0) as daily_cost,
        COUNT(*) as transactions
      FROM "${this.schema}".inventory_movements
      WHERE type = 'sale'
        AND applied = true
        AND DATE(created_at) >= $1::DATE
        AND DATE(created_at) <= $2::DATE
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [from, to]);

    return result.rows;
  }

  /**
   * Obtener stock actual con costo FIFO promedio
   */
  async getCurrentStockWithCost(productId) {
    const lots = await query(`
      SELECT 
        SUM(remaining_quantity) as total_quantity,
        AVG(unit_cost) as avg_cost
      FROM "${this.schema}".fifo_lots
      WHERE product_id = $1 
        AND is_active = true 
        AND remaining_quantity > 0
    `, [productId]);

    return {
      productId,
      totalQuantity: parseInt(lots.rows[0]?.total_quantity) || 0,
      avgCost: parseFloat(lots.rows[0]?.avg_cost) || 0
    };
  }
}

export default FIFOService;