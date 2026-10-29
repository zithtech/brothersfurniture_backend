import { Router } from 'express'
import { pool } from '../db/pool.js'
import { mapOrder } from '../utils/serializer.js'
import { syncEvents } from '../utils/syncEvents.js'

export const ordersRouter = Router()

// Track endpoint for customer landing page order status check
ordersRouter.get('/track/:query', async (req, res) => {
  try {
    const rawQuery = (req.params.query || '').trim()
    if (!rawQuery) {
      return res.status(400).json({ error: 'Please provide an order number or phone number.' })
    }

    const cleanPhone = rawQuery.replace(/[^0-9]/g, '')
    const conditions: string[] = ['order_number ILIKE $1', 'email ILIKE $1']
    const values: any[] = [`%${rawQuery}%`]

    if (cleanPhone.length >= 7) {
      values.push(`%${cleanPhone}%`)
      conditions.push(`regexp_replace(phone, '[^0-9]', '', 'g') LIKE $${values.length}`)
    }

    const queryStr = `SELECT * FROM orders WHERE ${conditions.join(' OR ')} ORDER BY created_at DESC LIMIT 10`
    const result = await pool.query(queryStr, values)

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No order found matching your inquiry. Please verify the order number or phone number.' })
    }

    res.json(result.rows.map(mapOrder))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

ordersRouter.get('/', async (req, res) => {
  try {
    const { status, paymentStatus, search } = req.query
    const conditions: string[] = []
    const values: any[] = []

    if (status) {
      values.push(status)
      conditions.push(`status = $${values.length}`)
    }

    if (paymentStatus) {
      values.push(paymentStatus)
      conditions.push(`payment_status = $${values.length}`)
    }

    if (search) {
      values.push(`%${search}%`)
      conditions.push(`(customer_name ILIKE $${values.length} OR order_number ILIKE $${values.length} OR company_name ILIKE $${values.length} OR phone ILIKE $${values.length})`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const queryStr = `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC`

    const result = await pool.query(queryStr, values)
    res.json(result.rows.map(mapOrder))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

ordersRouter.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }
    res.json(mapOrder(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

ordersRouter.post('/', async (req, res) => {
  try {
    const o = req.body
    const id = o.id || 'ord-' + Date.now().toString(36)
    const orderNumber = o.orderNumber || `BF-ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`

    const queryStr = `
      INSERT INTO orders (
        id, order_number, customer_name, company_name, phone, email, items,
        subtotal, delivery_fee, total, status, payment_status, delivery_address,
        target_delivery_date, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
      RETURNING *
    `
    const values = [
      id,
      orderNumber,
      o.customerName,
      o.companyName || null,
      o.phone,
      o.email,
      JSON.stringify(o.items || []),
      o.subtotal || 0,
      o.deliveryFee || 0,
      o.total || 0,
      o.status || 'pending',
      o.paymentStatus || 'pending',
      o.deliveryAddress || '',
      o.targetDeliveryDate || null,
      o.notes || null,
    ]

    const result = await pool.query(queryStr, values)
    const mapped = mapOrder(result.rows[0])
    
    // Broadcast real-time event to Admin and connected clients
    if (mapped) syncEvents.notify('orders', 'create', mapped.id, mapped)
    
    res.status(201).json(mapped)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

ordersRouter.put('/:id', async (req, res) => {
  try {
    const id = req.params.id
    const o = req.body

    const queryStr = `
      UPDATE orders SET
        customer_name = COALESCE($1, customer_name),
        company_name = COALESCE($2, company_name),
        phone = COALESCE($3, phone),
        email = COALESCE($4, email),
        items = COALESCE($5, items),
        subtotal = COALESCE($6, subtotal),
        delivery_fee = COALESCE($7, delivery_fee),
        total = COALESCE($8, total),
        status = COALESCE($9, status),
        payment_status = COALESCE($10, payment_status),
        delivery_address = COALESCE($11, delivery_address),
        target_delivery_date = COALESCE($12, target_delivery_date),
        notes = COALESCE($13, notes)
      WHERE id = $14
      RETURNING *
    `
    const values = [
      o.customerName,
      o.companyName,
      o.phone,
      o.email,
      o.items ? JSON.stringify(o.items) : null,
      o.subtotal,
      o.deliveryFee,
      o.total,
      o.status,
      o.paymentStatus,
      o.deliveryAddress,
      o.targetDeliveryDate,
      o.notes,
      id,
    ]

    const result = await pool.query(queryStr, values)
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }
    const mapped = mapOrder(result.rows[0])
    if (mapped) syncEvents.notify('orders', 'update', mapped.id, mapped)
    res.json(mapped)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

ordersRouter.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body
    const result = await pool.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }
    const mapped = mapOrder(result.rows[0])
    if (mapped) syncEvents.notify('orders', 'update', mapped.id, mapped)
    res.json(mapped)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

ordersRouter.patch('/:id/payment', async (req, res) => {
  try {
    const { paymentStatus } = req.body
    const result = await pool.query('UPDATE orders SET payment_status = $1 WHERE id = $2 RETURNING *', [paymentStatus, req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }
    const mapped = mapOrder(result.rows[0])
    if (mapped) syncEvents.notify('orders', 'update', mapped.id, mapped)
    res.json(mapped)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

ordersRouter.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }
    syncEvents.notify('orders', 'delete', req.params.id)
    res.json({ success: true, id: req.params.id })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
