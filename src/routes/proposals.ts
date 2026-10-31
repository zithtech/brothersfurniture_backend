import { Router } from 'express'
import { pool } from '../db/pool.js'
import { mapProposal, mapInvoice } from '../utils/serializer.js'
import { syncEvents } from '../utils/syncEvents.js'
import { uploadPdfBufferToR2 } from '../utils/r2Client.js'
import { generateProposalPdfBuffer } from '../services/proposalPdfGenerator.js'

export const proposalsRouter = Router()

// List proposals
proposalsRouter.get('/', async (req, res) => {
  try {
    const { status, search } = req.query
    const conditions: string[] = []
    const values: any[] = []

    if (status && status !== 'all') {
      values.push(status)
      conditions.push(`status = $${values.length}`)
    }

    if (search) {
      values.push(`%${search}%`)
      conditions.push(`(proposal_number ILIKE $${values.length} OR title ILIKE $${values.length} OR customer_name ILIKE $${values.length} OR prepared_for ILIKE $${values.length} OR company_name ILIKE $${values.length} OR phone ILIKE $${values.length} OR client_phone ILIKE $${values.length})`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const queryStr = `SELECT * FROM proposals ${whereClause} ORDER BY created_at DESC`

    const result = await pool.query(queryStr, values)
    res.json(result.rows.map(mapProposal))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Get single proposal
proposalsRouter.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM proposals WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Proposal not found' })
    }
    res.json(mapProposal(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Create proposal
proposalsRouter.post('/', async (req, res) => {
  try {
    const p = req.body
    const id = p.id || `prop-${Date.now()}`

    // Ensure proposal number is unique and sequential
    const year = new Date().getFullYear()
    const prefix = `BF-PROP-${year}-`

    let proposalNumber = p.proposalNumber
    if (proposalNumber) {
      // If client sent a proposal number, check if it already exists
      const existing = await pool.query('SELECT 1 FROM proposals WHERE proposal_number = $1', [proposalNumber])
      if (existing.rows.length > 0) {
        proposalNumber = null // force generation of unique sequence
      }
    }

    if (!proposalNumber) {
      const allRows = await pool.query(
        'SELECT proposal_number FROM proposals WHERE proposal_number LIKE $1',
        [`${prefix}%`]
      )
      let maxNum = 0
      for (const row of allRows.rows) {
        const num = parseInt(String(row.proposal_number).replace(prefix, ''), 10)
        if (!isNaN(num) && num > maxNum) {
          maxNum = num
        }
      }
      let nextSeq = Math.max(maxNum + 1, allRows.rows.length + 1)
      let candidate = `${prefix}${String(nextSeq).padStart(4, '0')}`

      // Safety loop to ensure absolute uniqueness
      while (true) {
        const check = await pool.query('SELECT 1 FROM proposals WHERE proposal_number = $1', [candidate])
        if (check.rows.length === 0) {
          proposalNumber = candidate
          break
        }
        nextSeq++
        candidate = `${prefix}${String(nextSeq).padStart(4, '0')}`
      }
    }

    const preparedFor = p.preparedFor || p.customerName || ''
    const clientPhone = p.clientPhone || p.phone || ''
    const clientAddress = p.clientAddress || p.deliveryAddress || ''

    const queryStr = `
      INSERT INTO proposals (
        id, proposal_number, title, customer_name, company_name, phone, email,
        client_gstin, delivery_address, status, valid_until, items, subtotal,
        discount_amount, delivery_fee, total, terms, notes,
        prepared_for, client_phone, client_address,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21,
        NOW(), NOW()
      )
      RETURNING *
    `
    const values = [
      id,
      proposalNumber,
      p.title || 'Executive Commercial Scope',
      preparedFor,
      p.companyName || null,
      clientPhone,
      p.email || '',
      p.clientGstin || null,
      clientAddress,
      p.status || 'draft',
      p.validUntil || null,
      JSON.stringify(p.items || []),
      p.subtotal || 0,
      p.discountAmount || 0,
      p.deliveryFee || 0,
      p.total || 0,
      p.terms || null,
      p.notes || null,
      preparedFor,
      clientPhone,
      clientAddress,
    ]

    const result = await pool.query(queryStr, values)
    const newProposal = mapProposal(result.rows[0])
    syncEvents.notify('proposals', 'create', newProposal?.id, newProposal)
    res.status(201).json(newProposal)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Update proposal
proposalsRouter.put('/:id', async (req, res) => {
  try {
    const p = req.body
    const id = req.params.id

    const check = await pool.query('SELECT * FROM proposals WHERE id = $1', [id])
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Proposal not found' })
    }

    const current = check.rows[0]
    const updatedPreparedFor = p.preparedFor !== undefined ? p.preparedFor : (p.customerName !== undefined ? p.customerName : (current.prepared_for || current.customer_name))
    const updatedClientPhone = p.clientPhone !== undefined ? p.clientPhone : (p.phone !== undefined ? p.phone : (current.client_phone || current.phone))
    const updatedClientAddress = p.clientAddress !== undefined ? p.clientAddress : (p.deliveryAddress !== undefined ? p.deliveryAddress : (current.client_address || current.delivery_address))

    const updated = {
      title: p.title !== undefined ? p.title : current.title,
      customer_name: updatedPreparedFor,
      company_name: p.companyName !== undefined ? p.companyName : current.company_name,
      phone: updatedClientPhone,
      email: p.email !== undefined ? p.email : current.email,
      client_gstin: p.clientGstin !== undefined ? p.clientGstin : current.client_gstin,
      delivery_address: updatedClientAddress,
      status: p.status !== undefined ? p.status : current.status,
      valid_until: p.validUntil !== undefined ? p.validUntil : current.valid_until,
      items: p.items !== undefined ? JSON.stringify(p.items) : current.items,
      subtotal: p.subtotal !== undefined ? p.subtotal : current.subtotal,
      discount_amount: p.discountAmount !== undefined ? p.discountAmount : current.discount_amount,
      delivery_fee: p.deliveryFee !== undefined ? p.deliveryFee : current.delivery_fee,
      total: p.total !== undefined ? p.total : current.total,
      terms: p.terms !== undefined ? p.terms : current.terms,
      notes: p.notes !== undefined ? p.notes : current.notes,
      converted_invoice_id: p.convertedInvoiceId !== undefined ? p.convertedInvoiceId : current.converted_invoice_id,
      prepared_for: updatedPreparedFor,
      client_phone: updatedClientPhone,
      client_address: updatedClientAddress,
    }

    const queryStr = `
      UPDATE proposals SET
        title = $1, customer_name = $2, company_name = $3, phone = $4, email = $5,
        client_gstin = $6, delivery_address = $7, status = $8, valid_until = $9,
        items = $10, subtotal = $11, discount_amount = $12, delivery_fee = $13,
        total = $14, terms = $15, notes = $16, converted_invoice_id = $17,
        prepared_for = $18, client_phone = $19, client_address = $20,
        updated_at = NOW()
      WHERE id = $21
      RETURNING *
    `
    const values = [
      updated.title,
      updated.customer_name,
      updated.company_name,
      updated.phone,
      updated.email,
      updated.client_gstin,
      updated.delivery_address,
      updated.status,
      updated.valid_until,
      updated.items,
      updated.subtotal,
      updated.discount_amount,
      updated.delivery_fee,
      updated.total,
      updated.terms,
      updated.notes,
      updated.converted_invoice_id,
      updated.prepared_for,
      updated.client_phone,
      updated.client_address,
      id,
    ]

    const result = await pool.query(queryStr, values)
    const saved = mapProposal(result.rows[0])
    syncEvents.notify('proposals', 'update', saved?.id, saved)
    res.json(saved)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Delete proposal
proposalsRouter.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM proposals WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Proposal not found' })
    }
    syncEvents.notify('proposals', 'delete', req.params.id)
    res.json({ success: true, message: 'Proposal deleted successfully' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Convert Proposal to Tax Invoice (1-Click)
proposalsRouter.post('/:id/convert-to-invoice', async (req, res) => {
  try {
    let propRes = await pool.query('SELECT * FROM proposals WHERE id = $1', [req.params.id])
    if (propRes.rows.length === 0) {
      // Retry in case proposal was just created concurrently
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 400))
        propRes = await pool.query('SELECT * FROM proposals WHERE id = $1', [req.params.id])
        if (propRes.rows.length > 0) break
      }
    }

    let proposal = propRes.rows.length > 0 ? mapProposal(propRes.rows[0]) : null

    // If proposal was not in db yet but client provided fallback in body
    if (!proposal && req.body && (req.body.proposalRef || req.body.customerName || req.body.items)) {
      const p = req.body
      proposal = {
        id: req.params.id,
        proposalNumber: p.proposalRef || p.proposalNumber || 'BF-PROP-2026-0001',
        title: p.title || 'Commercial Proposal',
        customerName: p.customerName || 'Direct Commercial Client',
        companyName: p.companyName || '',
        phone: p.phone || '',
        email: p.email || '',
        clientGstin: p.clientGstin || '',
        deliveryAddress: p.billingAddress || p.shippingAddress || p.deliveryAddress || '',
        status: 'converted',
        subtotal: Number(p.subtotal) || 0,
        discountAmount: Number(p.discountAmount) || 0,
        deliveryFee: Number(p.deliveryFee) || 0,
        total: Number(p.total) || 0,
        items: Array.isArray(p.items) ? p.items : [],
        notes: p.notes || '',
        createdAt: new Date().toISOString(),
      } as any
    }

    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' })
    }

    const invCountRes = await pool.query('SELECT COUNT(*) FROM invoices')
    const nextInvNum = String(parseInt(invCountRes.rows[0].count, 10) + 1).padStart(3, '0')
    const invoiceNumber = req.body?.invoiceNumber || `BF-INV-2026-${nextInvNum}`
    const invId = req.body?.id || `inv-${Date.now()}`

    const taxableSubtotal = Math.max(0, proposal.subtotal - (proposal.discountAmount || 0))
    const cgstAmount = req.body?.cgstAmount !== undefined ? Number(req.body.cgstAmount) : Math.round(taxableSubtotal * 0.09)
    const sgstAmount = req.body?.sgstAmount !== undefined ? Number(req.body.sgstAmount) : Math.round(taxableSubtotal * 0.09)
    const totalTax = cgstAmount + sgstAmount
    const grandTotal = req.body?.total !== undefined ? Number(req.body.total) : (taxableSubtotal + proposal.deliveryFee + totalTax)

    const invoiceQuery = `
      INSERT INTO invoices (
        id, invoice_number, proposal_ref, customer_name, company_name, phone,
        email, client_gstin, billing_address, shipping_address, issue_date,
        due_date, status, items, subtotal, discount_amount, delivery_fee,
        cgst_rate, cgst_amount, sgst_rate, sgst_amount, tax_amount, total,
        amount_paid, balance_due, payment_records, notes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23,
        $24, $25, $26, $27, NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        customer_name = EXCLUDED.customer_name,
        company_name = EXCLUDED.company_name,
        items = EXCLUDED.items,
        subtotal = EXCLUDED.subtotal,
        discount_amount = EXCLUDED.discount_amount,
        delivery_fee = EXCLUDED.delivery_fee,
        total = EXCLUDED.total,
        balance_due = EXCLUDED.balance_due,
        updated_at = NOW()
      RETURNING *
    `
    const invoiceValues = [
      invId,
      invoiceNumber,
      proposal.proposalNumber,
      req.body?.customerName || proposal.customerName || 'Direct Commercial Client',
      req.body?.companyName !== undefined ? req.body.companyName : (proposal.companyName || null),
      req.body?.phone !== undefined ? req.body.phone : (proposal.phone || ''),
      req.body?.email !== undefined ? req.body.email : (proposal.email || ''),
      req.body?.clientGstin !== undefined ? req.body.clientGstin : (proposal.clientGstin || null),
      req.body?.billingAddress || proposal.deliveryAddress || 'Client Office Address',
      req.body?.shippingAddress || proposal.deliveryAddress || 'Client Office Address',
      req.body?.issueDate || new Date().toISOString().split('T')[0],
      req.body?.dueDate || new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      req.body?.status || 'pending',
      JSON.stringify(req.body?.items || proposal.items.map((it: any, idx: number) => {
        const itemDiscPct = it.discountPercent !== undefined && Number(it.discountPercent) > 0
          ? Number(it.discountPercent)
          : ((proposal as any).discountPercent ? Number((proposal as any).discountPercent) : 0)
        const gross = (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0)
        const itemDiscAmt = it.discountAmount !== undefined && Number(it.discountAmount) > 0
          ? Number(it.discountAmount)
          : (itemDiscPct > 0 ? Math.round((gross * itemDiscPct) / 100) : 0)
        const itemTot = it.total !== undefined ? Number(it.total) : Math.max(0, gross - itemDiscAmt)

        return {
          id: it.id || `iitem-${Date.now()}-${idx}`,
          productId: it.productId,
          name: it.name,
          hsnCode: it.hsnCode || '9403',
          image: it.image,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          discountPercent: itemDiscPct,
          discountAmount: itemDiscAmt,
          material: it.material,
          dimensions: it.dimensions,
          sku: it.sku,
          total: itemTot,
        }
      })),
      proposal.subtotal,
      proposal.discountAmount || 0,
      proposal.deliveryFee,
      req.body?.cgstRate || 9.0,
      cgstAmount,
      req.body?.sgstRate || 9.0,
      sgstAmount,
      totalTax,
      grandTotal,
      req.body?.amountPaid || 0,
      req.body?.balanceDue !== undefined ? req.body.balanceDue : grandTotal,
      JSON.stringify(req.body?.paymentRecords || []),
      req.body?.notes || `Generated from Commercial Proposal ${proposal.proposalNumber}. ${proposal.notes || ''}`,
    ]

    const newInvRes = await pool.query(invoiceQuery, invoiceValues)
    const newInvoice = mapInvoice(newInvRes.rows[0])

    // Update proposal status if proposal exists in database
    await pool.query(
      'UPDATE proposals SET status = $1, converted_invoice_id = $2, updated_at = NOW() WHERE id = $3',
      ['converted', invId, proposal.id]
    ).catch(() => {})

    syncEvents.notify('invoices', 'create', newInvoice?.id, newInvoice)
    syncEvents.notify('proposals', 'update', proposal.id, { status: 'converted', convertedInvoiceId: invId })

    res.status(201).json(newInvoice)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Generate PDF via Puppeteer and store in Cloudflare R2 for existing proposal
proposalsRouter.post('/:id/generate-pdf', async (req, res) => {
  try {
    const { id } = req.params

    let proposalRes = await pool.query('SELECT * FROM proposals WHERE id = $1', [id])
    if (proposalRes.rows.length === 0) {
      // Retry loop: wait up to 1.5s in case createProposal is running concurrently
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 500))
        proposalRes = await pool.query('SELECT * FROM proposals WHERE id = $1', [id])
        if (proposalRes.rows.length > 0) break
      }
    }

    let proposal: any = null
    if (req.body && (req.body.title || req.body.customerName || req.body.items)) {
      // If client supplied proposal payload in body, insert/update and persist it immediately
      const p = req.body
      const preparedFor = p.preparedFor || p.customerName || ''
      const clientPhone = p.clientPhone || p.phone || ''
      const clientAddress = p.clientAddress || p.deliveryAddress || ''
      const insertRes = await pool.query(
        `INSERT INTO proposals (
          id, proposal_number, title, customer_name, company_name, phone, email,
          client_gstin, delivery_address, status, valid_until, items, subtotal,
          discount_amount, delivery_fee, total, terms, notes,
          prepared_for, client_phone, client_address,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18,
          $19, $20, $21,
          NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          customer_name = EXCLUDED.customer_name,
          company_name = EXCLUDED.company_name,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          client_gstin = EXCLUDED.client_gstin,
          delivery_address = EXCLUDED.delivery_address,
          status = EXCLUDED.status,
          valid_until = EXCLUDED.valid_until,
          items = EXCLUDED.items,
          subtotal = EXCLUDED.subtotal,
          discount_amount = EXCLUDED.discount_amount,
          delivery_fee = EXCLUDED.delivery_fee,
          total = EXCLUDED.total,
          terms = EXCLUDED.terms,
          notes = EXCLUDED.notes,
          prepared_for = EXCLUDED.prepared_for,
          client_phone = EXCLUDED.client_phone,
          client_address = EXCLUDED.client_address,
          updated_at = NOW()
        RETURNING *`,
        [
          id,
          p.proposalNumber || `BF-PROP-${new Date().getFullYear()}-0001`,
          p.title || 'Executive Commercial Scope',
          preparedFor,
          p.companyName || null,
          clientPhone,
          p.email || '',
          p.clientGstin || null,
          clientAddress,
          p.status || 'draft',
          p.validUntil || null,
          JSON.stringify(p.items || []),
          p.subtotal || 0,
          p.discountAmount || 0,
          p.deliveryFee || 0,
          p.total || 0,
          p.terms || null,
          p.notes || null,
          preparedFor,
          clientPhone,
          clientAddress,
        ]
      )
      proposal = mapProposal(insertRes.rows[0])
    } else if (proposalRes.rows.length > 0) {
      proposal = mapProposal(proposalRes.rows[0])
    }

    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' })
    }

    // 1. Generate PDF buffer using Puppeteer
    const pdfBuffer = await generateProposalPdfBuffer(proposal as any)

    // 2. Upload to Cloudflare R2
    const fileName = `${proposal.proposalNumber || 'proposal'}`
    const r2Result = await uploadPdfBufferToR2({
      buffer: pdfBuffer,
      originalName: `${fileName}.pdf`,
      folder: 'proposals',
      proposalId: proposal.id,
    })

    // 3. Persist R2 URL and object key into database
    const updateRes = await pool.query(
      `UPDATE proposals 
       SET pdf_url = $1, r2_key = $2, updated_at = NOW() 
       WHERE id = $3 
       RETURNING *`,
      [r2Result.url, r2Result.key, id]
    )

    const updatedProposal = mapProposal(updateRes.rows[0])
    syncEvents.notify('proposals', 'update', id, updatedProposal)

    res.json({
      success: true,
      pdfUrl: r2Result.url,
      r2Key: r2Result.key,
      size: r2Result.size,
      proposal: updatedProposal,
    })
  } catch (err: any) {
    console.error('PDF generation/R2 upload error:', err)
    res.status(500).json({ error: err.message || 'Failed to generate PDF and upload to Cloudflare R2' })
  }
})

// Direct file download endpoint with Content-Disposition: attachment
proposalsRouter.get('/:id/download-pdf', async (req, res) => {
  try {
    const { id } = req.params
    const proposalRes = await pool.query('SELECT * FROM proposals WHERE id = $1', [id])
    if (proposalRes.rows.length === 0) {
      return res.status(404).json({ error: 'Proposal not found' })
    }
    const proposal = mapProposal(proposalRes.rows[0])
    if (!proposal) {
      return res.status(404).json({ error: 'Failed to parse proposal data' })
    }

    const fileName = `${proposal.proposalNumber || 'proposal'}.pdf`
    let pdfBuffer: Buffer | null = null

    if (proposal.pdfUrl) {
      try {
        const fetchRes = await fetch(proposal.pdfUrl)
        if (fetchRes.ok) {
          const arrayBuffer = await fetchRes.arrayBuffer()
          pdfBuffer = Buffer.from(arrayBuffer)
        }
      } catch {
        // Fallback to generating buffer
      }
    }

    if (!pdfBuffer) {
      pdfBuffer = await generateProposalPdfBuffer(proposal as any)
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.send(pdfBuffer)
  } catch (err: any) {
    console.error('Download proposal error:', err)
    res.status(500).json({ error: err.message || 'Failed to download proposal PDF' })
  }
})

// Generate PDF on-the-fly and upload to Cloudflare R2
proposalsRouter.post('/generate-pdf', async (req, res) => {
  try {
    const payload = req.body
    if (!payload || !payload.proposalNumber) {
      return res.status(400).json({ error: 'Invalid proposal data provided' })
    }

    const pdfBuffer = await generateProposalPdfBuffer(payload)
    const r2Result = await uploadPdfBufferToR2({
      buffer: pdfBuffer,
      originalName: `${payload.proposalNumber}.pdf`,
      folder: 'proposals',
      proposalId: payload.id || 'draft',
    })

    res.json({
      success: true,
      pdfUrl: r2Result.url,
      r2Key: r2Result.key,
      size: r2Result.size,
    })
  } catch (err: any) {
    console.error('On-the-fly PDF generation error:', err)
    res.status(500).json({ error: err.message || 'Failed to generate PDF and upload to Cloudflare R2' })
  }
})

