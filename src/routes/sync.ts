import { Router } from 'express'
import { pool } from '../db/pool.js'
import { seedDatabase } from '../db/seed.js'
import {
  mapChair,
  mapClient,
  mapLead,
  mapOrder,
  mapProduct,
  mapSettings,
  mapTestimonial,
} from '../utils/serializer.js'
import { syncEvents, type SyncEventPayload } from '../utils/syncEvents.js'

export const syncRouter = Router()

// SSE real-time sync stream for frontend landing page and admin clients
syncRouter.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })

  // Initial connection handshake
  const welcomePayload = {
    type: 'connected',
    message: 'Brothers Furniture Real-Time Sync Stream Connected',
    time: new Date().toISOString(),
  }
  res.write(`data: ${JSON.stringify(welcomePayload)}\n\n`)

  const handleSync = (payload: SyncEventPayload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    } catch {
      // client connection closed
    }
  }

  syncEvents.on('sync', handleSync)

  // Keep-alive heartbeat every 20 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n')
    } catch {
      clearInterval(heartbeat)
    }
  }, 20000)

  req.on('close', () => {
    clearInterval(heartbeat)
    syncEvents.off('sync', handleSync)
  })
})

// Reset database to initial seed data
syncRouter.post('/reset', async (_req, res) => {
  try {
    await pool.query(`
      TRUNCATE products, ergonomic_chairs, leads, orders, clients, testimonials, company_settings CASCADE;
    `)
    await seedDatabase()
    syncEvents.notify('all', 'reset')
    res.json({ success: true, message: 'Database reset to factory default seed data.' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Full export
syncRouter.get('/export', async (_req, res) => {
  try {
    const productsRes = await pool.query('SELECT * FROM products ORDER BY id')
    const chairsRes = await pool.query('SELECT * FROM ergonomic_chairs ORDER BY id')
    const leadsRes = await pool.query('SELECT * FROM leads ORDER BY created_at DESC')
    const ordersRes = await pool.query('SELECT * FROM orders ORDER BY created_at DESC')
    const clientsRes = await pool.query('SELECT * FROM clients ORDER BY id')
    const testimonialsRes = await pool.query('SELECT * FROM testimonials ORDER BY created_at DESC')
    const settingsRes = await pool.query('SELECT * FROM company_settings WHERE id = $1', ['default'])

    res.json({
      exportedAt: new Date().toISOString(),
      products: productsRes.rows.map((r) => mapProduct(r)),
      chairs: chairsRes.rows.map(mapChair),
      leads: leadsRes.rows.map(mapLead),
      orders: ordersRes.rows.map(mapOrder),
      clients: clientsRes.rows.map(mapClient),
      testimonials: testimonialsRes.rows.map(mapTestimonial),
      settings: mapSettings(settingsRes.rows[0]),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
