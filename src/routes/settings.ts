import { Router } from 'express'
import { pool } from '../db/pool.js'
import { mapSettings } from '../utils/serializer.js'

export const settingsRouter = Router()

settingsRouter.get('/', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM company_settings WHERE id = $1', ['default'])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Settings not found' })
    }
    res.json(mapSettings(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

settingsRouter.put('/', async (req, res) => {
  try {
    const s = req.body

    const queryStr = `
      INSERT INTO company_settings (
        id, name, address_lines, phones, email, whatsapp, map,
        gstin, factory_location, free_delivery_threshold, standard_delivery_fee,
        banner_announcement, is_banner_active, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = COALESCE($2, company_settings.name),
        address_lines = COALESCE($3, company_settings.address_lines),
        phones = COALESCE($4, company_settings.phones),
        email = COALESCE($5, company_settings.email),
        whatsapp = COALESCE($6, company_settings.whatsapp),
        map = COALESCE($7, company_settings.map),
        gstin = COALESCE($8, company_settings.gstin),
        factory_location = COALESCE($9, company_settings.factory_location),
        free_delivery_threshold = COALESCE($10, company_settings.free_delivery_threshold),
        standard_delivery_fee = COALESCE($11, company_settings.standard_delivery_fee),
        banner_announcement = COALESCE($12, company_settings.banner_announcement),
        is_banner_active = COALESCE($13, company_settings.is_banner_active),
        updated_at = NOW()
      RETURNING *
    `
    const values = [
      'default',
      s.name,
      s.addressLines ? JSON.stringify(s.addressLines) : null,
      s.phones ? JSON.stringify(s.phones) : null,
      s.email,
      s.whatsapp ? JSON.stringify(s.whatsapp) : null,
      s.map ? JSON.stringify(s.map) : null,
      s.gstin,
      s.factoryLocation,
      s.freeDeliveryThreshold,
      s.standardDeliveryFee,
      s.bannerAnnouncement,
      s.isBannerActive,
    ]

    const result = await pool.query(queryStr, values)
    res.json(mapSettings(result.rows[0]))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})
