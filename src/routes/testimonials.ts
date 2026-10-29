import { Router } from 'express'
import { pool } from '../db/pool.js'
import { mapTestimonial } from '../utils/serializer.js'

export const testimonialsRouter = Router()

testimonialsRouter.get('/', async (req, res) => {
  try {
    const { approved, featured } = req.query
    const conditions: string[] = []
    const values: any[] = []

    if (approved !== undefined) {
      values.push(approved === 'true')
      conditions.push(`approved = $${values.length}`)
    }

    if (featured !== undefined) {
      values.push(featured === 'true')
      conditions.push(`featured = $${values.length}`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const queryStr = `SELECT * FROM testimonials ${whereClause} ORDER BY created_at DESC`

    const result = await pool.query(queryStr, values)
    res.json(result.rows.map(mapTestimonial))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

testimonialsRouter.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM testimonials WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Testimonial not found' })
    }
    res.json(mapTestimonial(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

testimonialsRouter.post('/', async (req, res) => {
  try {
    const t = req.body
    const id = t.id || 'test-' + Date.now().toString(36)

    const queryStr = `
      INSERT INTO testimonials (id, name, role, company, quote, rating, approved, featured, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `
    const values = [
      id,
      t.name,
      t.role,
      t.company,
      t.quote,
      t.rating || 5,
      t.approved ?? true,
      t.featured ?? false,
    ]

    const result = await pool.query(queryStr, values)
    res.status(201).json(mapTestimonial(result.rows[0]))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

testimonialsRouter.put('/:id', async (req, res) => {
  try {
    const id = req.params.id
    const t = req.body

    const queryStr = `
      UPDATE testimonials SET
        name = COALESCE($1, name),
        role = COALESCE($2, role),
        company = COALESCE($3, company),
        quote = COALESCE($4, quote),
        rating = COALESCE($5, rating),
        approved = COALESCE($6, approved),
        featured = COALESCE($7, featured)
      WHERE id = $8
      RETURNING *
    `
    const values = [t.name, t.role, t.company, t.quote, t.rating, t.approved, t.featured, id]
    const result = await pool.query(queryStr, values)
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Testimonial not found' })
    }
    res.json(mapTestimonial(result.rows[0]))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

testimonialsRouter.patch('/:id/toggle-approved', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE testimonials SET approved = NOT approved WHERE id = $1 RETURNING *',
      [req.params.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Testimonial not found' })
    }
    res.json(mapTestimonial(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

testimonialsRouter.patch('/:id/toggle-featured', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE testimonials SET featured = NOT featured WHERE id = $1 RETURNING *',
      [req.params.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Testimonial not found' })
    }
    res.json(mapTestimonial(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

testimonialsRouter.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM testimonials WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Testimonial not found' })
    }
    res.json({ success: true, id: req.params.id })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
