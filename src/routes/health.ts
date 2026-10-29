import { Router } from 'express'
import { pool } from '../db/pool.js'

export const healthRouter = Router()

healthRouter.get('/', async (_req, res) => {
  try {
    const dbRes = await pool.query('SELECT NOW() as current_time, current_database() as database')
    const countsRes = await pool.query(`
      SELECT 
        (SELECT count(*) FROM products) as products,
        (SELECT count(*) FROM ergonomic_chairs) as chairs,
        (SELECT count(*) FROM leads) as leads,
        (SELECT count(*) FROM orders) as orders,
        (SELECT count(*) FROM clients) as clients,
        (SELECT count(*) FROM testimonials) as testimonials
    `)

    res.json({
      status: 'ok',
      service: 'Brothers Furniture Backend API',
      timestamp: new Date().toISOString(),
      database: {
        status: 'connected',
        name: dbRes.rows[0].database,
        serverTime: dbRes.rows[0].current_time,
        records: {
          products: parseInt(countsRes.rows[0].products, 10),
          chairs: parseInt(countsRes.rows[0].chairs, 10),
          leads: parseInt(countsRes.rows[0].leads, 10),
          orders: parseInt(countsRes.rows[0].orders, 10),
          clients: parseInt(countsRes.rows[0].clients, 10),
          testimonials: parseInt(countsRes.rows[0].testimonials, 10),
        },
      },
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
      error: error.message,
    })
  }
})
