import { Router } from 'express'
import { pool } from '../db/pool.js'
import { mapChair } from '../utils/serializer.js'
import { syncEvents } from '../utils/syncEvents.js'

export const chairsRouter = Router()

chairsRouter.get('/', async (req, res) => {
  try {
    const { type, inProduction } = req.query
    const conditions: string[] = []
    const values: any[] = []

    if (type && type !== 'all') {
      values.push(type)
      conditions.push(`type = $${values.length}`)
    }

    if (inProduction !== undefined) {
      values.push(inProduction === 'true')
      conditions.push(`in_production = $${values.length}`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const queryStr = `SELECT * FROM ergonomic_chairs ${whereClause} ORDER BY created_at ASC, id ASC`

    const result = await pool.query(queryStr, values)
    res.json(result.rows.map(mapChair))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

chairsRouter.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ergonomic_chairs WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chair not found' })
    }
    const updated = mapChair(result.rows[0]); syncEvents.notify('chairs', 'update', updated?.id); res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

chairsRouter.post('/', async (req, res) => {
  try {
    const c = req.body
    const id = c.id || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString().slice(-4)

    const queryStr = `
      INSERT INTO ergonomic_chairs (
        id, name, type, image, features, in_production, base_price, updated_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `
    const values = [
      id,
      c.name,
      c.type,
      c.image,
      JSON.stringify(c.features || []),
      c.inProduction ?? true,
      c.basePrice || 0,
    ]

    const result = await pool.query(queryStr, values)
    const created = mapChair(result.rows[0]); syncEvents.notify('chairs', 'create', created?.id); res.status(201).json(created);
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

chairsRouter.put('/:id', async (req, res) => {
  try {
    const id = req.params.id
    const c = req.body

    const queryStr = `
      UPDATE ergonomic_chairs SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        image = COALESCE($3, image),
        features = COALESCE($4, features),
        in_production = COALESCE($5, in_production),
        base_price = COALESCE($6, base_price),
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `
    const values = [
      c.name,
      c.type,
      c.image,
      c.features ? JSON.stringify(c.features) : null,
      c.inProduction,
      c.basePrice,
      id,
    ]

    const result = await pool.query(queryStr, values)
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chair not found' })
    }
    const updated = mapChair(result.rows[0]); syncEvents.notify('chairs', 'update', updated?.id); res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

chairsRouter.patch('/:id/toggle-production', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE ergonomic_chairs SET in_production = NOT in_production, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chair not found' })
    }
    res.json(mapChair(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

chairsRouter.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM ergonomic_chairs WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chair not found' })
    }
    syncEvents.notify('chairs', 'delete', req.params.id); res.json({ success: true, id: req.params.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
