import { Router } from 'express'
import { pool } from '../db/pool.js'
import { mapLead, mapOrder } from '../utils/serializer.js'

export const overviewRouter = Router()

overviewRouter.get('/', async (_req, res) => {
  try {
    const statsRes = await pool.query(`
      SELECT
        (SELECT count(*) FROM products) as total_products,
        (SELECT count(*) FROM products WHERE in_stock = true) as in_stock_products,
        (SELECT count(*) FROM ergonomic_chairs) as total_chairs,
        (SELECT count(*) FROM ergonomic_chairs WHERE in_production = true) as active_chairs,
        (SELECT count(*) FROM leads) as total_leads,
        (SELECT count(*) FROM leads WHERE status = 'new') as new_leads,
        (SELECT coalesce(sum(estimated_value), 0) FROM leads WHERE status IN ('new', 'contacted', 'quoted', 'site-visit')) as pipeline_value,
        (SELECT count(*) FROM orders) as total_orders,
        (SELECT coalesce(sum(total), 0) FROM orders WHERE status != 'cancelled') as total_revenue,
        (SELECT count(*) FROM clients) as total_clients,
        (SELECT count(*) FROM testimonials WHERE approved = true) as approved_reviews
    `)

    const recentLeadsRes = await pool.query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 5')
    const recentOrdersRes = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5')

    const stats = statsRes.rows[0]

    res.json({
      metrics: {
        totalProducts: parseInt(stats.total_products, 10),
        inStockProducts: parseInt(stats.in_stock_products, 10),
        totalChairs: parseInt(stats.total_chairs, 10),
        activeChairs: parseInt(stats.active_chairs, 10),
        totalLeads: parseInt(stats.total_leads, 10),
        newLeads: parseInt(stats.new_leads, 10),
        pipelineValue: parseFloat(stats.pipeline_value),
        totalOrders: parseInt(stats.total_orders, 10),
        totalRevenue: parseFloat(stats.total_revenue),
        totalClients: parseInt(stats.total_clients, 10),
        approvedReviews: parseInt(stats.approved_reviews, 10),
      },
      recentLeads: recentLeadsRes.rows.map(mapLead),
      recentOrders: recentOrdersRes.rows.map(mapOrder),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
