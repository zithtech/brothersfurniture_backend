import { Router } from 'express'
import { pool } from '../db/pool.js'
import {
  mapCustomer,
  mapCustomerAddress,
  mapCustomerContact,
  mapCustomerNote,
  mapCustomerActivityLog,
  mapOrder,
} from '../utils/serializer.js'
import { syncEvents } from '../utils/syncEvents.js'

export const customersRouter = Router()

// 1. GET /api/customers - List customers with server-side search, filters, pagination
customersRouter.get('/', async (req, res) => {
  try {
    const {
      search,
      status,
      category,
      companySize,
      city,
      state,
      sortBy = 'created_at',
      sortOrder = 'desc',
      page = '1',
      limit = '10',
    } = req.query

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
    const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 10))
    const offset = (pageNum - 1) * limitNum

    const conditions: string[] = []
    const values: any[] = []

    // Soft-delete filter
    if (status === 'archived') {
      conditions.push(`(c.status = 'archived' OR c.deleted_at IS NOT NULL)`)
    } else if (status && status !== 'all') {
      values.push(status)
      conditions.push(`c.status = $${values.length} AND c.deleted_at IS NULL`)
    } else if (status === 'all') {
      // Include all including archived, but keep deleted_at if needed
    } else {
      // Default: exclude soft-deleted
      conditions.push(`c.deleted_at IS NULL`)
    }

    if (category && category !== 'All') {
      values.push(category)
      conditions.push(`c.category = $${values.length}`)
    }

    if (companySize && companySize !== 'All') {
      values.push(companySize)
      conditions.push(`c.company_size = $${values.length}`)
    }

    if (city && city !== 'All') {
      values.push(`%${city}%`)
      conditions.push(`EXISTS (SELECT 1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.city ILIKE $${values.length})`)
    }

    if (state && state !== 'All') {
      values.push(`%${state}%`)
      conditions.push(`EXISTS (SELECT 1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.state ILIKE $${values.length})`)
    }

    if (search) {
      values.push(`%${search}%`)
      const searchParam = `$${values.length}`
      conditions.push(`(
        c.company_name ILIKE ${searchParam} OR
        c.customer_code ILIKE ${searchParam} OR
        c.gst_number ILIKE ${searchParam} OR
        c.company_phone ILIKE ${searchParam} OR
        c.company_email ILIKE ${searchParam} OR
        EXISTS (
          SELECT 1 FROM customer_contacts cc
          WHERE cc.customer_id = c.id
          AND (cc.name ILIKE ${searchParam} OR cc.phone ILIKE ${searchParam} OR cc.email ILIKE ${searchParam})
        ) OR
        EXISTS (
          SELECT 1 FROM customer_addresses ca
          WHERE ca.customer_id = c.id
          AND (ca.city ILIKE ${searchParam} OR ca.state ILIKE ${searchParam} OR ca.pin_code ILIKE ${searchParam})
        )
      )`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Allowed sort columns
    const allowedSortCols: Record<string, string> = {
      created_at: 'c.created_at',
      company_name: 'c.company_name',
      customer_code: 'c.customer_code',
      category: 'c.category',
      status: 'c.status',
    }
    const sortCol = allowedSortCols[sortBy as string] || 'c.created_at'
    const sortDir = (sortOrder as string).toLowerCase() === 'asc' ? 'ASC' : 'DESC'

    // Total filtered count
    const countQuery = `SELECT COUNT(*) FROM customers c ${whereClause}`
    const countRes = await pool.query(countQuery, values)
    const total = parseInt(countRes.rows[0].count, 10)

    // Data query with subqueries for primary contact and address
    const dataQuery = `
      SELECT
        c.*,
        pc.name AS primary_contact_name,
        pc.designation AS primary_contact_designation,
        pc.phone AS primary_contact_phone,
        pc.email AS primary_contact_email,
        pa.city AS primary_city,
        pa.state AS primary_state,
        pa.country AS primary_country,
        pa.pin_code AS primary_pin_code,
        pa.address_line1 AS primary_address_line1,
        pa.map_location AS primary_map_location
      FROM customers c
      LEFT JOIN LATERAL (
        SELECT name, designation, phone, email
        FROM customer_contacts
        WHERE customer_id = c.id
        ORDER BY is_primary DESC, created_at ASC
        LIMIT 1
      ) pc ON true
      LEFT JOIN LATERAL (
        SELECT city, state, country, pin_code, address_line1, map_location
        FROM customer_addresses
        WHERE customer_id = c.id
        ORDER BY is_default DESC, created_at ASC
        LIMIT 1
      ) pa ON true
      ${whereClause}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `

    const dataRes = await pool.query(dataQuery, [...values, limitNum, offset])

    // Overall stats for summary cards
    const statsRes = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'active' AND deleted_at IS NULL) AS active,
        COUNT(*) FILTER (WHERE status = 'inactive' AND deleted_at IS NULL) AS inactive,
        COUNT(*) FILTER (WHERE status = 'archived' OR deleted_at IS NOT NULL) AS archived
      FROM customers
    `)
    const statsRow = statsRes.rows[0]
    const stats = {
      total: parseInt(statsRow.total, 10) || 0,
      active: parseInt(statsRow.active, 10) || 0,
      inactive: parseInt(statsRow.inactive, 10) || 0,
      archived: parseInt(statsRow.archived, 10) || 0,
    }

    res.json({
      items: dataRes.rows.map((r) => mapCustomer(r)),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      stats,
    })
  } catch (err: any) {
    console.error('Error fetching customers:', err)
    res.status(500).json({ error: err.message })
  }
})

// 2. GET /api/customers/stats - Quick stats
customersRouter.get('/stats', async (_req, res) => {
  try {
    const statsRes = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'active' AND deleted_at IS NULL) AS active,
        COUNT(*) FILTER (WHERE status = 'inactive' AND deleted_at IS NULL) AS inactive,
        COUNT(*) FILTER (WHERE status = 'archived' OR deleted_at IS NOT NULL) AS archived
      FROM customers
    `)
    const categoriesRes = await pool.query(`
      SELECT category, COUNT(*) as count
      FROM customers
      WHERE deleted_at IS NULL
      GROUP BY category
    `)
    const r = statsRes.rows[0]
    res.json({
      total: parseInt(r.total, 10) || 0,
      active: parseInt(r.active, 10) || 0,
      inactive: parseInt(r.inactive, 10) || 0,
      archived: parseInt(r.archived, 10) || 0,
      byCategory: categoriesRes.rows.reduce((acc, row) => {
        acc[row.category] = parseInt(row.count, 10)
        return acc
      }, {} as Record<string, number>),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 3. GET /api/customers/categories - Categories list
customersRouter.get('/categories', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customer_categories ORDER BY sort_order ASC, name ASC')
    res.json(result.rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 4. GET /api/customers/export - Export customers to CSV
customersRouter.get('/export', async (req, res) => {
  try {
    const { status, category } = req.query
    const conditions: string[] = ['c.deleted_at IS NULL']
    const values: any[] = []

    if (status && status !== 'all') {
      values.push(status)
      conditions.push(`c.status = $${values.length}`)
    }
    if (category && category !== 'All') {
      values.push(category)
      conditions.push(`c.category = $${values.length}`)
    }

    const where = `WHERE ${conditions.join(' AND ')}`
    const sql = `
      SELECT
        c.customer_code,
        c.company_name,
        c.category,
        c.company_size,
        c.status,
        c.company_phone,
        c.company_email,
        c.gst_number,
        c.website_url,
        c.payment_terms,
        c.credit_limit,
        pc.name AS primary_contact_name,
        pc.designation AS primary_contact_designation,
        pc.phone AS primary_contact_phone,
        pc.email AS primary_contact_email,
        pa.address_line1,
        pa.city,
        pa.state,
        pa.pin_code,
        c.created_at
      FROM customers c
      LEFT JOIN LATERAL (
        SELECT name, designation, phone, email
        FROM customer_contacts
        WHERE customer_id = c.id
        ORDER BY is_primary DESC, created_at ASC
        LIMIT 1
      ) pc ON true
      LEFT JOIN LATERAL (
        SELECT address_line1, city, state, pin_code
        FROM customer_addresses
        WHERE customer_id = c.id
        ORDER BY is_default DESC, created_at ASC
        LIMIT 1
      ) pa ON true
      ${where}
      ORDER BY c.customer_code ASC
    `
    const result = await pool.query(sql, values)

    // Build CSV
    const headers = [
      'Customer Code',
      'Company Name',
      'Category',
      'Size',
      'Status',
      'Phone',
      'Email',
      'GSTIN',
      'Website',
      'Payment Terms',
      'Credit Limit',
      'Primary Contact Name',
      'Designation',
      'Contact Phone',
      'Contact Email',
      'Address',
      'City',
      'State',
      'PIN Code',
      'Created Date',
    ]

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""'
      const str = String(val).replace(/"/g, '""')
      return `"${str}"`
    }

    const rows = result.rows.map((r) =>
      [
        r.customer_code,
        r.company_name,
        r.category,
        r.company_size,
        r.status,
        r.company_phone,
        r.company_email,
        r.gst_number,
        r.website_url,
        r.payment_terms,
        r.credit_limit,
        r.primary_contact_name,
        r.primary_contact_designation,
        r.primary_contact_phone,
        r.primary_contact_email,
        r.address_line1,
        r.city,
        r.state,
        r.pin_code,
        r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : '',
      ]
        .map(escapeCsv)
        .join(',')
    )

    const csvContent = [headers.join(','), ...rows].join('\n')

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="customers-export.csv"')
    res.send(csvContent)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 5. POST /api/customers/check-duplicate - Real-time Duplicate Detection
customersRouter.post('/check-duplicate', async (req, res) => {
  try {
    const { gstNumber, companyName, phone, excludeId } = req.body
    const duplicates: Array<{ field: string; value: string; customerId: string; companyName: string }> = []

    if (gstNumber && gstNumber.trim().length >= 5) {
      const q = excludeId
        ? 'SELECT id, company_name, gst_number FROM customers WHERE UPPER(gst_number) = UPPER($1) AND id != $2 AND deleted_at IS NULL LIMIT 1'
        : 'SELECT id, company_name, gst_number FROM customers WHERE UPPER(gst_number) = UPPER($1) AND deleted_at IS NULL LIMIT 1'
      const params = excludeId ? [gstNumber.trim(), excludeId] : [gstNumber.trim()]
      const r = await pool.query(q, params)
      if (r.rows.length > 0) {
        duplicates.push({
          field: 'gstNumber',
          value: r.rows[0].gst_number,
          customerId: r.rows[0].id,
          companyName: r.rows[0].company_name,
        })
      }
    }

    if (companyName && companyName.trim().length >= 3) {
      const q = excludeId
        ? 'SELECT id, company_name FROM customers WHERE LOWER(company_name) = LOWER($1) AND id != $2 AND deleted_at IS NULL LIMIT 1'
        : 'SELECT id, company_name FROM customers WHERE LOWER(company_name) = LOWER($1) AND deleted_at IS NULL LIMIT 1'
      const params = excludeId ? [companyName.trim(), excludeId] : [companyName.trim()]
      const r = await pool.query(q, params)
      if (r.rows.length > 0) {
        duplicates.push({
          field: 'companyName',
          value: r.rows[0].company_name,
          customerId: r.rows[0].id,
          companyName: r.rows[0].company_name,
        })
      }
    }

    if (phone && phone.trim().length >= 8) {
      const cleanPhone = phone.replace(/\D/g, '').slice(-10)
      if (cleanPhone.length >= 8) {
        const q = excludeId
          ? `SELECT id, company_name, company_phone FROM customers WHERE company_phone LIKE $1 AND id != $2 AND deleted_at IS NULL LIMIT 1`
          : `SELECT id, company_name, company_phone FROM customers WHERE company_phone LIKE $1 AND deleted_at IS NULL LIMIT 1`
        const params = excludeId ? [`%${cleanPhone}%`, excludeId] : [`%${cleanPhone}%`]
        const r = await pool.query(q, params)
        if (r.rows.length > 0) {
          duplicates.push({
            field: 'phone',
            value: r.rows[0].company_phone,
            customerId: r.rows[0].id,
            companyName: r.rows[0].company_name,
          })
        }
      }
    }

    res.json({
      hasDuplicate: duplicates.length > 0,
      duplicates,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 6. POST /api/customers/import - Bulk import customers
customersRouter.post('/import', async (req, res) => {
  const client = await pool.connect()
  try {
    const { customers: importList } = req.body
    if (!Array.isArray(importList) || importList.length === 0) {
      return res.status(400).json({ error: 'Array of customers required for import' })
    }

    await client.query('BEGIN')
    let importedCount = 0
    const skipped: any[] = []

    // Get max existing code
    const maxCodeRes = await client.query(`
      SELECT customer_code FROM customers
      WHERE customer_code ~ '^CUS-[0-9]+$'
      ORDER BY customer_code DESC LIMIT 1
    `)
    let nextNum = 101
    if (maxCodeRes.rows.length > 0) {
      const match = maxCodeRes.rows[0].customer_code.match(/CUS-(\d+)/)
      if (match) nextNum = parseInt(match[1], 10) + 1
    }

    for (const item of importList) {
      if (!item.companyName || !item.companyPhone) {
        skipped.push({ item, reason: 'Missing company name or phone' })
        continue
      }

      // Check duplicate GST or name
      if (item.gstNumber) {
        const dupCheck = await client.query(
          'SELECT id FROM customers WHERE UPPER(gst_number) = UPPER($1) AND deleted_at IS NULL',
          [item.gstNumber]
        )
        if (dupCheck.rows.length > 0) {
          skipped.push({ item, reason: `Duplicate GSTIN: ${item.gstNumber}` })
          continue
        }
      }

      const id = 'cus-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
      const code = `CUS-${String(nextNum++).padStart(6, '0')}`

      await client.query(
        `INSERT INTO customers (
          id, customer_code, company_name, company_phone, company_email, gst_number,
          website_url, company_size, category, status, customer_type, gst_type,
          payment_terms, credit_limit, customer_source, account_manager, internal_notes,
          created_by, updated_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'Import', 'Import', NOW(), NOW())`,
        [
          id,
          code,
          item.companyName,
          item.companyPhone,
          item.companyEmail || null,
          item.gstNumber || null,
          item.websiteUrl || null,
          item.companySize || 'Medium',
          item.category || 'Corporate',
          item.status || 'active',
          item.customerType || 'B2B',
          item.gstType || 'Regular',
          item.paymentTerms || 'Net 30',
          item.creditLimit || 0,
          item.customerSource || 'Direct',
          item.accountManager || null,
          item.internalNotes || null,
        ]
      )

      // Add contact if provided
      if (item.contactName) {
        await client.query(
          `INSERT INTO customer_contacts (
            id, customer_id, name, designation, email, phone, is_primary, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())`,
          [
            'con-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
            id,
            item.contactName,
            item.contactDesignation || 'Contact Person',
            item.contactEmail || null,
            item.contactPhone || item.companyPhone,
          ]
        )
      }

      // Add address if provided
      if (item.city && item.state) {
        await client.query(
          `INSERT INTO customer_addresses (
            id, customer_id, address_type, is_default, address_line1, city, state, country, pin_code, created_at, updated_at
          ) VALUES ($1, $2, 'billing', true, $3, $4, $5, 'India', $6, NOW(), NOW())`,
          [
            'addr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
            id,
            item.addressLine1 || item.city,
            item.city,
            item.state,
            item.pinCode || '000000',
          ]
        )
      }

      importedCount++
    }

    await client.query('COMMIT')
    res.json({ success: true, importedCount, skippedCount: skipped.length, skipped })
  } catch (err: any) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: err.message })
  } finally {
    client.release()
  }
})

// 7. GET /api/customers/:id - Single customer details with all relations & matching orders
customersRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params

    const custRes = await pool.query('SELECT * FROM customers WHERE id = $1', [id])
    if (custRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' })
    }
    const customerRow = custRes.rows[0]

    // Fetch contacts
    const contactsRes = await pool.query(
      'SELECT * FROM customer_contacts WHERE customer_id = $1 ORDER BY is_primary DESC, created_at ASC',
      [id]
    )

    // Fetch addresses
    const addressesRes = await pool.query(
      'SELECT * FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at ASC',
      [id]
    )

    // Fetch notes
    const notesRes = await pool.query(
      'SELECT * FROM customer_notes WHERE customer_id = $1 ORDER BY created_at DESC',
      [id]
    )

    // Fetch activity logs
    const activityRes = await pool.query(
      'SELECT * FROM customer_activity_logs WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50',
      [id]
    )

    // Fetch matching orders from existing orders table
    // Matches by company_name, customer_name, phone, or email
    const orderConditions: string[] = []
    const orderValues: any[] = []

    if (customerRow.company_name) {
      orderValues.push(`%${customerRow.company_name}%`)
      orderConditions.push(`company_name ILIKE $${orderValues.length}`)
    }
    if (customerRow.company_phone) {
      orderValues.push(`%${customerRow.company_phone.replace(/\D/g, '').slice(-10)}%`)
      orderConditions.push(`phone LIKE $${orderValues.length}`)
    }
    if (customerRow.company_email) {
      orderValues.push(customerRow.company_email.toLowerCase())
      orderConditions.push(`LOWER(email) = $${orderValues.length}`)
    }

    let orders: any[] = []
    if (orderConditions.length > 0) {
      const orderSql = `SELECT * FROM orders WHERE (${orderConditions.join(' OR ')}) ORDER BY created_at DESC LIMIT 20`
      const ordersRes = await pool.query(orderSql, orderValues)
      orders = ordersRes.rows.map(mapOrder).filter(Boolean)
    }

    const mapped = mapCustomer(customerRow, {
      contacts: contactsRes.rows,
      addresses: addressesRes.rows,
      notes: notesRes.rows,
      activityLogs: activityRes.rows,
      orders,
    })

    res.json(mapped)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 8. POST /api/customers - Create customer with contacts and addresses in a single transaction
customersRouter.post('/', async (req, res) => {
  const client = await pool.connect()
  try {
    const data = req.body

    if (!data.companyName || !data.companyPhone) {
      return res.status(400).json({ error: 'Company Name and Phone are required' })
    }

    await client.query('BEGIN')

    // Generate Customer Code (e.g. CUS-000107)
    const codeRes = await client.query(`
      SELECT customer_code FROM customers
      WHERE customer_code ~ '^CUS-[0-9]+$'
      ORDER BY customer_code DESC LIMIT 1
    `)
    let nextNum = 101
    if (codeRes.rows.length > 0) {
      const match = codeRes.rows[0].customer_code.match(/CUS-(\d+)/)
      if (match) nextNum = parseInt(match[1], 10) + 1
    }
    const customerCode = data.customerCode || `CUS-${String(nextNum).padStart(6, '0')}`

    const id = data.id || 'cus-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)

    const insertCustSql = `
      INSERT INTO customers (
        id, customer_code, company_name, company_phone, company_email, gst_number,
        website_url, company_size, category, status, customer_type, gst_type,
        payment_terms, credit_limit, customer_source, account_manager, internal_notes,
        internal_remarks, created_by, updated_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19, NOW(), NOW())
      RETURNING *
    `
    const custValues = [
      id,
      customerCode,
      data.companyName.trim(),
      data.companyPhone.trim(),
      data.companyEmail ? data.companyEmail.trim() : null,
      data.gstNumber ? data.gstNumber.trim().toUpperCase() : null,
      data.websiteUrl ? data.websiteUrl.trim() : null,
      data.companySize || 'Medium',
      data.category || 'Corporate',
      data.status || 'active',
      data.customerType || 'B2B',
      data.gstType || 'Regular',
      data.paymentTerms || 'Net 30',
      data.creditLimit ? parseFloat(data.creditLimit) : 0,
      data.customerSource || 'Direct',
      data.accountManager || null,
      data.internalNotes || null,
      data.internalRemarks || null,
      data.createdBy || 'Admin',
    ]

    const custResult = await client.query(insertCustSql, custValues)
    const createdCust = custResult.rows[0]

    // Contacts
    const insertedContacts: any[] = []
    if (Array.isArray(data.contacts) && data.contacts.length > 0) {
      for (let i = 0; i < data.contacts.length; i++) {
        const con = data.contacts[i]
        if (!con.name || !con.phone) continue
        const conId = con.id || 'con-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
        const isPrimary = con.isPrimary !== undefined ? Boolean(con.isPrimary) : i === 0

        const conRes = await client.query(
          `INSERT INTO customer_contacts (
            id, customer_id, name, designation, email, phone, is_primary, department, notes, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) RETURNING *`,
          [
            conId,
            id,
            con.name.trim(),
            con.designation ? con.designation.trim() : 'Representative',
            con.email ? con.email.trim() : null,
            con.phone.trim(),
            isPrimary,
            con.department || null,
            con.notes || null,
          ]
        )
        insertedContacts.push(conRes.rows[0])
      }
    }

    // Addresses
    const insertedAddresses: any[] = []
    if (Array.isArray(data.addresses) && data.addresses.length > 0) {
      for (let i = 0; i < data.addresses.length; i++) {
        const addr = data.addresses[i]
        if (!addr.city || !addr.state) continue
        const addrId = addr.id || 'addr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
        const isDefault = addr.isDefault !== undefined ? Boolean(addr.isDefault) : i === 0

        const addrRes = await client.query(
          `INSERT INTO customer_addresses (
            id, customer_id, address_type, is_default, address_line1, address_line2,
            city, state, country, pin_code, map_location, latitude, longitude, landmark,
            contact_person, contact_phone, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()) RETURNING *`,
          [
            addrId,
            id,
            addr.addressType || 'billing',
            isDefault,
            addr.addressLine1 ? addr.addressLine1.trim() : addr.city,
            addr.addressLine2 ? addr.addressLine2.trim() : null,
            addr.city.trim(),
            addr.state.trim(),
            addr.country ? addr.country.trim() : 'India',
            addr.pinCode ? addr.pinCode.trim() : '',
            addr.mapLocation || null,
            addr.latitude ? parseFloat(addr.latitude) : null,
            addr.longitude ? parseFloat(addr.longitude) : null,
            addr.landmark || null,
            addr.contactPerson || null,
            addr.contactPhone || null,
          ]
        )
        insertedAddresses.push(addrRes.rows[0])
      }
    }

    // Initial note if provided
    if (data.initialNote) {
      await client.query(
        `INSERT INTO customer_notes (id, customer_id, note, category, author_name, created_at)
         VALUES ($1, $2, $3, 'General', $4, NOW())`,
        ['note-' + Date.now().toString(36), id, data.initialNote, data.createdBy || 'Admin']
      )
    }

    // Audit Log
    await client.query(
      `INSERT INTO customer_activity_logs (id, customer_id, action, description, actor_name, created_at)
       VALUES ($1, $2, 'created', $3, $4, NOW())`,
      [
        'act-' + Date.now().toString(36),
        id,
        `Customer "${createdCust.company_name}" (${customerCode}) created by ${data.createdBy || 'Admin'}`,
        data.createdBy || 'Admin',
      ]
    )

    await client.query('COMMIT')

    const mapped = mapCustomer(createdCust, {
      contacts: insertedContacts,
      addresses: insertedAddresses,
    })

    syncEvents.notify('customers', 'create', id, mapped)
    res.status(201).json(mapped)
  } catch (err: any) {
    await client.query('ROLLBACK')
    console.error('Error creating customer:', err)
    res.status(400).json({ error: err.message })
  } finally {
    client.release()
  }
})

// 9. PATCH /api/customers/:id - Update customer basic & business details
customersRouter.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const d = req.body

    const queryStr = `
      UPDATE customers SET
        company_name = COALESCE($1, company_name),
        company_phone = COALESCE($2, company_phone),
        company_email = COALESCE($3, company_email),
        gst_number = COALESCE($4, gst_number),
        website_url = COALESCE($5, website_url),
        company_size = COALESCE($6, company_size),
        category = COALESCE($7, category),
        status = COALESCE($8, status),
        customer_type = COALESCE($9, customer_type),
        gst_type = COALESCE($10, gst_type),
        payment_terms = COALESCE($11, payment_terms),
        credit_limit = COALESCE($12, credit_limit),
        customer_source = COALESCE($13, customer_source),
        account_manager = COALESCE($14, account_manager),
        internal_notes = COALESCE($15, internal_notes),
        internal_remarks = COALESCE($16, internal_remarks),
        updated_by = COALESCE($17, updated_by),
        updated_at = NOW()
      WHERE id = $18
      RETURNING *
    `
    const values = [
      d.companyName,
      d.companyPhone,
      d.companyEmail,
      d.gstNumber,
      d.websiteUrl,
      d.companySize,
      d.category,
      d.status,
      d.customerType,
      d.gstType,
      d.paymentTerms,
      d.creditLimit !== undefined ? parseFloat(d.creditLimit) : null,
      d.customerSource,
      d.accountManager,
      d.internalNotes,
      d.internalRemarks,
      d.updatedBy || 'Admin',
      id,
    ]

    const result = await pool.query(queryStr, values)
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    // Log update
    await pool.query(
      `INSERT INTO customer_activity_logs (id, customer_id, action, description, actor_name, created_at)
       VALUES ($1, $2, 'updated', $3, $4, NOW())`,
      [
        'act-' + Date.now().toString(36),
        id,
        `Customer information updated by ${d.updatedBy || 'Admin'}`,
        d.updatedBy || 'Admin',
      ]
    )

    const mapped = mapCustomer(result.rows[0])
    syncEvents.notify('customers', 'update', id, mapped)
    res.json(mapped)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// 10. PATCH /api/customers/:id/status - Change status (active, inactive, archived)
customersRouter.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params
    const { status, updatedBy = 'Admin' } = req.body

    if (!status || !['active', 'inactive', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be active, inactive, or archived.' })
    }

    const result = await pool.query(
      `UPDATE customers SET status = $1, updated_by = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [status, updatedBy, id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    await pool.query(
      `INSERT INTO customer_activity_logs (id, customer_id, action, description, actor_name, created_at)
       VALUES ($1, $2, 'status_changed', $3, $4, NOW())`,
      [
        'act-' + Date.now().toString(36),
        id,
        `Status changed to "${status}" by ${updatedBy}`,
        updatedBy,
      ]
    )

    const mapped = mapCustomer(result.rows[0])
    syncEvents.notify('customers', 'status-change', id, mapped)
    res.json(mapped)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 11. DELETE /api/customers/:id - Soft delete (archive)
customersRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { permanent } = req.query

    if (permanent === 'true') {
      const result = await pool.query('DELETE FROM customers WHERE id = $1 RETURNING id', [id])
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Customer not found' })
      }
      syncEvents.notify('customers', 'delete', id)
      return res.json({ success: true, id, permanent: true })
    }

    // Soft delete: sets deleted_at and status = 'archived'
    const result = await pool.query(
      `UPDATE customers SET deleted_at = NOW(), status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    await pool.query(
      `INSERT INTO customer_activity_logs (id, customer_id, action, description, actor_name, created_at)
       VALUES ($1, $2, 'archived', 'Customer record moved to archive / soft deleted.', 'Admin', NOW())`,
      ['act-' + Date.now().toString(36), id]
    )

    syncEvents.notify('customers', 'archive', id)
    res.json({ success: true, id, softDeleted: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 12. POST /api/customers/:id/contacts - Add contact person
customersRouter.post('/:id/contacts', async (req, res) => {
  try {
    const { id } = req.params
    const c = req.body

    if (!c.name || !c.phone) {
      return res.status(400).json({ error: 'Name and Phone are required' })
    }

    const contactId = c.id || 'con-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
    const isPrimary = Boolean(c.isPrimary)

    // If marked primary, unset other contacts for this customer
    if (isPrimary) {
      await pool.query('UPDATE customer_contacts SET is_primary = false WHERE customer_id = $1', [id])
    }

    const result = await pool.query(
      `INSERT INTO customer_contacts (
        id, customer_id, name, designation, email, phone, is_primary, department, notes, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) RETURNING *`,
      [
        contactId,
        id,
        c.name.trim(),
        c.designation ? c.designation.trim() : 'Representative',
        c.email ? c.email.trim() : null,
        c.phone.trim(),
        isPrimary,
        c.department || null,
        c.notes || null,
      ]
    )

    await pool.query(
      `INSERT INTO customer_activity_logs (id, customer_id, action, description, actor_name, created_at)
       VALUES ($1, $2, 'contact_added', $3, 'Admin', NOW())`,
      ['act-' + Date.now().toString(36), id, `Added contact: ${c.name} (${c.designation || 'Representative'})`]
    )

    res.status(201).json(mapCustomerContact(result.rows[0]))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// 13. PATCH /api/customers/:id/contacts/:contactId - Update contact person
customersRouter.patch('/:id/contacts/:contactId', async (req, res) => {
  try {
    const { id, contactId } = req.params
    const c = req.body

    if (c.isPrimary) {
      await pool.query('UPDATE customer_contacts SET is_primary = false WHERE customer_id = $1', [id])
    }

    const result = await pool.query(
      `UPDATE customer_contacts SET
        name = COALESCE($1, name),
        designation = COALESCE($2, designation),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        is_primary = COALESCE($5, is_primary),
        department = COALESCE($6, department),
        notes = COALESCE($7, notes),
        updated_at = NOW()
      WHERE id = $8 AND customer_id = $9
      RETURNING *`,
      [c.name, c.designation, c.email, c.phone, c.isPrimary, c.department, c.notes, contactId, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' })
    }

    res.json(mapCustomerContact(result.rows[0]))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// 14. DELETE /api/customers/:id/contacts/:contactId - Remove contact
customersRouter.delete('/:id/contacts/:contactId', async (req, res) => {
  try {
    const { id, contactId } = req.params

    // Check count and if primary
    const check = await pool.query('SELECT is_primary, name FROM customer_contacts WHERE id = $1 AND customer_id = $2', [
      contactId,
      id,
    ])
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' })
    }

    const contactName = check.rows[0].name
    const isPrimary = check.rows[0].is_primary

    await pool.query('DELETE FROM customer_contacts WHERE id = $1 AND customer_id = $2', [contactId, id])

    // If primary was deleted, promote another contact if available
    if (isPrimary) {
      await pool.query(`
        UPDATE customer_contacts SET is_primary = true
        WHERE id = (SELECT id FROM customer_contacts WHERE customer_id = $1 ORDER BY created_at ASC LIMIT 1)
      `, [id])
    }

    await pool.query(
      `INSERT INTO customer_activity_logs (id, customer_id, action, description, actor_name, created_at)
       VALUES ($1, $2, 'contact_removed', $3, 'Admin', NOW())`,
      ['act-' + Date.now().toString(36), id, `Removed contact: ${contactName}`]
    )

    res.json({ success: true, contactId })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 15. POST /api/customers/:id/addresses - Add address
customersRouter.post('/:id/addresses', async (req, res) => {
  try {
    const { id } = req.params
    const a = req.body

    if (!a.city || !a.state) {
      return res.status(400).json({ error: 'City and State are required' })
    }

    const addressId = a.id || 'addr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
    const isDefault = Boolean(a.isDefault)

    if (isDefault) {
      await pool.query(
        'UPDATE customer_addresses SET is_default = false WHERE customer_id = $1 AND address_type = $2',
        [id, a.addressType || 'billing']
      )
    }

    const result = await pool.query(
      `INSERT INTO customer_addresses (
        id, customer_id, address_type, is_default, address_line1, address_line2,
        city, state, country, pin_code, map_location, latitude, longitude, landmark,
        contact_person, contact_phone, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()) RETURNING *`,
      [
        addressId,
        id,
        a.addressType || 'billing',
        isDefault,
        a.addressLine1 ? a.addressLine1.trim() : a.city,
        a.addressLine2 ? a.addressLine2.trim() : null,
        a.city.trim(),
        a.state.trim(),
        a.country || 'India',
        a.pinCode ? a.pinCode.trim() : '',
        a.mapLocation || null,
        a.latitude ? parseFloat(a.latitude) : null,
        a.longitude ? parseFloat(a.longitude) : null,
        a.landmark || null,
        a.contactPerson || null,
        a.contactPhone || null,
      ]
    )

    await pool.query(
      `INSERT INTO customer_activity_logs (id, customer_id, action, description, actor_name, created_at)
       VALUES ($1, $2, 'address_added', $3, 'Admin', NOW())`,
      ['act-' + Date.now().toString(36), id, `Added ${a.addressType || 'billing'} address in ${a.city}, ${a.state}`]
    )

    res.status(201).json(mapCustomerAddress(result.rows[0]))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// 16. PATCH /api/customers/:id/addresses/:addressId - Update address
customersRouter.patch('/:id/addresses/:addressId', async (req, res) => {
  try {
    const { id, addressId } = req.params
    const a = req.body

    if (a.isDefault) {
      await pool.query(
        'UPDATE customer_addresses SET is_default = false WHERE customer_id = $1 AND address_type = $2',
        [id, a.addressType || 'billing']
      )
    }

    const result = await pool.query(
      `UPDATE customer_addresses SET
        address_type = COALESCE($1, address_type),
        is_default = COALESCE($2, is_default),
        address_line1 = COALESCE($3, address_line1),
        address_line2 = COALESCE($4, address_line2),
        city = COALESCE($5, city),
        state = COALESCE($6, state),
        country = COALESCE($7, country),
        pin_code = COALESCE($8, pin_code),
        map_location = COALESCE($9, map_location),
        latitude = COALESCE($10, latitude),
        longitude = COALESCE($11, longitude),
        landmark = COALESCE($12, landmark),
        contact_person = COALESCE($13, contact_person),
        contact_phone = COALESCE($14, contact_phone),
        updated_at = NOW()
      WHERE id = $15 AND customer_id = $16
      RETURNING *`,
      [
        a.addressType,
        a.isDefault,
        a.addressLine1,
        a.addressLine2,
        a.city,
        a.state,
        a.country,
        a.pinCode,
        a.mapLocation,
        a.latitude !== undefined ? parseFloat(a.latitude) : null,
        a.longitude !== undefined ? parseFloat(a.longitude) : null,
        a.landmark,
        a.contactPerson,
        a.contactPhone,
        addressId,
        id,
      ]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found' })
    }

    res.json(mapCustomerAddress(result.rows[0]))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// 17. DELETE /api/customers/:id/addresses/:addressId - Remove address
customersRouter.delete('/:id/addresses/:addressId', async (req, res) => {
  try {
    const { id, addressId } = req.params

    const result = await pool.query('DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2 RETURNING id', [
      addressId,
      id,
    ])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found' })
    }

    res.json({ success: true, addressId })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 18. POST /api/customers/:id/notes - Add note
customersRouter.post('/:id/notes', async (req, res) => {
  try {
    const { id } = req.params
    const { note, category = 'General', authorName = 'Admin' } = req.body

    if (!note || !note.trim()) {
      return res.status(400).json({ error: 'Note content cannot be empty' })
    }

    const noteId = 'note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)

    const result = await pool.query(
      `INSERT INTO customer_notes (id, customer_id, note, category, author_name, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [noteId, id, note.trim(), category, authorName]
    )

    await pool.query(
      `INSERT INTO customer_activity_logs (id, customer_id, action, description, actor_name, created_at)
       VALUES ($1, $2, 'note_added', $3, $4, NOW())`,
      ['act-' + Date.now().toString(36), id, `Added ${category} note: "${note.trim().slice(0, 50)}..."`, authorName]
    )

    res.status(201).json(mapCustomerNote(result.rows[0]))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// 19. GET /api/customers/:id/activity - Get customer activity logs
customersRouter.get('/:id/activity', async (req, res) => {
  try {
    const { id } = req.params
    const result = await pool.query(
      'SELECT * FROM customer_activity_logs WHERE customer_id = $1 ORDER BY created_at DESC',
      [id]
    )
    res.json(result.rows.map(mapCustomerActivityLog))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
