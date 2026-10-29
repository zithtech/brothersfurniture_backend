import { Router } from 'express'
import { pool } from '../db/pool.js'
import { mapClient } from '../utils/serializer.js'

export const clientsRouter = Router()

clientsRouter.get('/', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients ORDER BY created_at ASC, id ASC')
    res.json(result.rows.map(mapClient))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

clientsRouter.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' })
    }
    res.json(mapClient(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

clientsRouter.post('/', async (req, res) => {
  try {
    const c = req.body
    const id = c.id || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString().slice(-4)

    const queryStr = `
      INSERT INTO clients (id, name, logo, sector, featured, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `
    const values = [id, c.name, c.logo, c.sector, c.featured ?? true]
    const result = await pool.query(queryStr, values)
    res.status(201).json(mapClient(result.rows[0]))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

clientsRouter.put('/:id', async (req, res) => {
  try {
    const id = req.params.id
    const c = req.body

    const queryStr = `
      UPDATE clients SET
        name = COALESCE($1, name),
        logo = COALESCE($2, logo),
        sector = COALESCE($3, sector),
        featured = COALESCE($4, featured)
      WHERE id = $5
      RETURNING *
    `
    const values = [c.name, c.logo, c.sector, c.featured, id]
    const result = await pool.query(queryStr, values)
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' })
    }
    res.json(mapClient(result.rows[0]))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

clientsRouter.patch('/:id/toggle-featured', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE clients SET featured = NOT featured WHERE id = $1 RETURNING *',
      [req.params.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' })
    }
    res.json(mapClient(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

clientsRouter.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' })
    }
    res.json({ success: true, id: req.params.id })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
