import { Router } from 'express'
import { pool } from '../db/pool.js'
import { mapLead } from '../utils/serializer.js'
import { syncEvents } from '../utils/syncEvents.js'

export const leadsRouter = Router()

leadsRouter.get('/', async (req, res) => {
  try {
    const { status, priority, search } = req.query
    const conditions: string[] = []
    const values: any[] = []

    if (status) {
      values.push(status)
      conditions.push(`status = $${values.length}`)
    }

    if (priority) {
      values.push(priority)
      conditions.push(`priority = $${values.length}`)
    }

    if (search) {
      values.push(`%${search}%`)
      conditions.push(`(name ILIKE $${values.length} OR email ILIKE $${values.length} OR phone ILIKE $${values.length} OR message ILIKE $${values.length})`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const queryStr = `SELECT * FROM leads ${whereClause} ORDER BY created_at DESC`

    const result = await pool.query(queryStr, values)
    res.json(result.rows.map(mapLead))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

leadsRouter.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM leads WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' })
    }
    res.json(mapLead(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Create Lead (used by both Landing contact form and Admin)
leadsRouter.post('/', async (req, res) => {
  try {
    const l = req.body
    const id = l.id || 'lead-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)

    // Normalize subject/inquiry
    const subject = l.subject || l.interest || 'General inquiry'
    const message = l.message || l.requirement || ''
    const priority = l.priority || 'medium'
    const status = l.status || 'new'

    const queryStr = `
      INSERT INTO leads (
        id, name, phone, email, subject, message, status, priority, estimated_value, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *
    `
    const values = [
      id,
      l.name,
      l.phone,
      l.email || '',
      subject,
      message,
      status,
      priority,
      l.estimatedValue || null,
      l.notes || null,
    ]

    const result = await pool.query(queryStr, values)
    const mapped = mapLead(result.rows[0])
    if (mapped) syncEvents.notify('leads', 'create', mapped.id, mapped)
    res.status(201).json(mapped)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

leadsRouter.put('/:id', async (req, res) => {
  try {
    const id = req.params.id
    const l = req.body

    const queryStr = `
      UPDATE leads SET
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        email = COALESCE($3, email),
        subject = COALESCE($4, subject),
        message = COALESCE($5, message),
        status = COALESCE($6, status),
        priority = COALESCE($7, priority),
        estimated_value = COALESCE($8, estimated_value),
        notes = COALESCE($9, notes),
        last_contacted_at = COALESCE($10, last_contacted_at)
      WHERE id = $11
      RETURNING *
    `
    const values = [
      l.name,
      l.phone,
      l.email,
      l.subject,
      l.message,
      l.status,
      l.priority,
      l.estimatedValue,
      l.notes,
      l.lastContactedAt,
      id,
    ]

    const result = await pool.query(queryStr, values)
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' })
    }
    res.json(mapLead(result.rows[0]))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

leadsRouter.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body
    if (!status) {
      return res.status(400).json({ error: 'Status is required' })
    }

    const result = await pool.query(
      'UPDATE leads SET status = $1, last_contacted_at = NOW() WHERE id = $2 RETURNING *',
      [status, req.params.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' })
    }
    res.json(mapLead(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

leadsRouter.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM leads WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' })
    }
    res.json({ success: true, id: req.params.id })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
