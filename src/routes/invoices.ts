import { Router } from 'express'
import { pool } from '../db/pool.js'
import { mapInvoice, mapSettings } from '../utils/serializer.js'
import { syncEvents } from '../utils/syncEvents.js'
import { generateInvoicePdfBuffer } from '../services/invoicePdfGenerator.js'
import { uploadPdfBufferToR2 } from '../utils/r2Client.js'

export const invoicesRouter = Router()

// List invoices
invoicesRouter.get('/', async (req, res) => {
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
      conditions.push(`(invoice_number ILIKE $${values.length} OR customer_name ILIKE $${values.length} OR company_name ILIKE $${values.length} OR proposal_ref ILIKE $${values.length} OR phone ILIKE $${values.length})`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const queryStr = `SELECT * FROM invoices ${whereClause} ORDER BY created_at DESC`

    const result = await pool.query(queryStr, values)
    res.json(result.rows.map(mapInvoice))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Get single invoice
invoicesRouter.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' })
    }
    res.json(mapInvoice(result.rows[0]))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Create direct invoice
invoicesRouter.post('/', async (req, res) => {
  try {
    const inv = req.body
    const id = inv.id || `inv-${Date.now()}`

    let invoiceNumber = inv.invoiceNumber
    if (!invoiceNumber) {
      const countRes = await pool.query('SELECT COUNT(*) FROM invoices')
      const count = parseInt(countRes.rows[0].count, 10) + 1
      invoiceNumber = `BF-INV-2026-${String(count).padStart(3, '0')}`
    }

    const subtotal = Number(inv.subtotal) || 0
    const discountAmount = Number(inv.discountAmount) || 0
    const deliveryFee = Number(inv.deliveryFee) || 0
    const taxableSubtotal = Math.max(0, subtotal - discountAmount)
    const cgstAmount = Number(inv.cgstAmount) || Math.round(taxableSubtotal * 0.09)
    const sgstAmount = Number(inv.sgstAmount) || Math.round(taxableSubtotal * 0.09)
    const totalTax = cgstAmount + sgstAmount
    const total = Number(inv.total) || (taxableSubtotal + deliveryFee + totalTax)
    const amountPaid = Number(inv.amountPaid) || 0
    const balanceDue = Number(inv.balanceDue) !== undefined ? Number(inv.balanceDue) : Math.max(0, total - amountPaid)

    let status = inv.status || 'pending'
    if (balanceDue <= 0 && total > 0) {
      status = 'paid'
    } else if (amountPaid > 0 && balanceDue > 0) {
      status = 'advance_received'
    }

    const queryStr = `
      INSERT INTO invoices (
        id, invoice_number, proposal_ref, customer_name, company_name, phone,
        email, client_gstin, billing_address, shipping_address, po_number,
        issue_date, due_date, status, items, subtotal, discount_amount,
        delivery_fee, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
        tax_amount, total, amount_paid, balance_due, payment_records, notes,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22,
        $23, $24, $25, $26, $27, $28,
        NOW(), NOW()
      )
      RETURNING *
    `
    const values = [
      id,
      invoiceNumber,
      inv.proposalRef || null,
      inv.customerName,
      inv.companyName || null,
      inv.phone,
      inv.email,
      inv.clientGstin || null,
      inv.billingAddress,
      inv.shippingAddress,
      inv.poNumber || null,
      inv.issueDate || new Date().toISOString().split('T')[0],
      inv.dueDate || new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status,
      JSON.stringify(inv.items || []),
      subtotal,
      discountAmount,
      deliveryFee,
      inv.cgstRate || 9.0,
      cgstAmount,
      inv.sgstRate || 9.0,
      sgstAmount,
      totalTax,
      total,
      amountPaid,
      balanceDue,
      JSON.stringify(inv.paymentRecords || []),
      inv.notes || null,
    ]

    const result = await pool.query(queryStr, values)
    const newInvoice = mapInvoice(result.rows[0])
    syncEvents.notify('invoices', 'create', newInvoice?.id, newInvoice)
    res.status(201).json(newInvoice)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Update invoice
invoicesRouter.put('/:id', async (req, res) => {
  try {
    const inv = req.body
    const id = req.params.id

    const check = await pool.query('SELECT * FROM invoices WHERE id = $1', [id])
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' })
    }

    const current = check.rows[0]
    const updated = {
      customer_name: inv.customerName !== undefined ? inv.customerName : current.customer_name,
      company_name: inv.companyName !== undefined ? inv.companyName : current.company_name,
      phone: inv.phone !== undefined ? inv.phone : current.phone,
      email: inv.email !== undefined ? inv.email : current.email,
      client_gstin: inv.clientGstin !== undefined ? inv.clientGstin : current.client_gstin,
      billing_address: inv.billingAddress !== undefined ? inv.billingAddress : current.billing_address,
      shipping_address: inv.shippingAddress !== undefined ? inv.shippingAddress : current.shipping_address,
      po_number: inv.poNumber !== undefined ? inv.poNumber : current.po_number,
      issue_date: inv.issueDate !== undefined ? inv.issueDate : current.issue_date,
      due_date: inv.dueDate !== undefined ? inv.dueDate : current.due_date,
      status: inv.status !== undefined ? inv.status : current.status,
      items: inv.items !== undefined ? JSON.stringify(inv.items) : current.items,
      subtotal: inv.subtotal !== undefined ? inv.subtotal : current.subtotal,
      discount_amount: inv.discountAmount !== undefined ? inv.discountAmount : current.discount_amount,
      delivery_fee: inv.deliveryFee !== undefined ? inv.deliveryFee : current.delivery_fee,
      cgst_amount: inv.cgstAmount !== undefined ? inv.cgstAmount : current.cgst_amount,
      sgst_amount: inv.sgstAmount !== undefined ? inv.sgstAmount : current.sgst_amount,
      tax_amount: inv.taxAmount !== undefined ? inv.taxAmount : current.tax_amount,
      total: inv.total !== undefined ? inv.total : current.total,
      amount_paid: inv.amountPaid !== undefined ? inv.amountPaid : current.amount_paid,
      balance_due: inv.balanceDue !== undefined ? inv.balanceDue : current.balance_due,
      payment_records: inv.paymentRecords !== undefined ? JSON.stringify(inv.paymentRecords) : current.payment_records,
      notes: inv.notes !== undefined ? inv.notes : current.notes,
    }

    const queryStr = `
      UPDATE invoices SET
        customer_name = $1, company_name = $2, phone = $3, email = $4,
        client_gstin = $5, billing_address = $6, shipping_address = $7,
        po_number = $8, issue_date = $9, due_date = $10, status = $11,
        items = $12, subtotal = $13, discount_amount = $14, delivery_fee = $15,
        cgst_amount = $16, sgst_amount = $17, tax_amount = $18, total = $19,
        amount_paid = $20, balance_due = $21, payment_records = $22, notes = $23,
        updated_at = NOW()
      WHERE id = $24
      RETURNING *
    `
    const values = [
      updated.customer_name,
      updated.company_name,
      updated.phone,
      updated.email,
      updated.client_gstin,
      updated.billing_address,
      updated.shipping_address,
      updated.po_number,
      updated.issue_date,
      updated.due_date,
      updated.status,
      updated.items,
      updated.subtotal,
      updated.discount_amount,
      updated.delivery_fee,
      updated.cgst_amount,
      updated.sgst_amount,
      updated.tax_amount,
      updated.total,
      updated.amount_paid,
      updated.balance_due,
      updated.payment_records,
      updated.notes,
      id,
    ]

    const result = await pool.query(queryStr, values)
    const saved = mapInvoice(result.rows[0])
    syncEvents.notify('invoices', 'update', saved?.id, saved)
    res.json(saved)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Delete invoice
invoicesRouter.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM invoices WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' })
    }
    syncEvents.notify('invoices', 'delete', req.params.id)
    res.json({ success: true, message: 'Invoice deleted successfully' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Record payment on invoice
invoicesRouter.post('/:id/payments', async (req, res) => {
  try {
    const { amount, paymentMode, transactionReference, notes } = req.body
    const id = req.params.id

    const check = await pool.query('SELECT * FROM invoices WHERE id = $1', [id])
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' })
    }

    const current = mapInvoice(check.rows[0])!
    const payAmt = Number(amount)
    if (!payAmt || payAmt <= 0) {
      return res.status(400).json({ error: 'Invalid payment amount' })
    }

    const newRecord = {
      id: `pay-${Date.now()}`,
      amount: payAmt,
      paymentMode: paymentMode || 'bank_transfer',
      transactionReference: transactionReference || undefined,
      paymentDate: new Date().toISOString(),
      notes: notes || undefined,
    }

    const currentPayments = Array.isArray(current.paymentRecords) ? current.paymentRecords : []
    const updatedPayments = [...currentPayments, newRecord]
    const updatedAmountPaid = current.amountPaid + payAmt
    const updatedBalanceDue = Math.max(0, current.total - updatedAmountPaid)

    let updatedStatus = current.status
    if (updatedBalanceDue <= 0) {
      updatedStatus = 'paid'
    } else if (updatedAmountPaid > 0) {
      updatedStatus = 'advance_received'
    }

    const queryStr = `
      UPDATE invoices SET
        amount_paid = $1, balance_due = $2, status = $3, payment_records = $4, updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `
    const values = [updatedAmountPaid, updatedBalanceDue, updatedStatus, JSON.stringify(updatedPayments), id]
    const result = await pool.query(queryStr, values)
    const saved = mapInvoice(result.rows[0])

    syncEvents.notify('invoices', 'payment', id, { payment: newRecord, invoice: saved })
    res.json(saved)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Generate PDF for existing invoice and upload to Cloudflare R2
invoicesRouter.post('/:id/generate-pdf', async (req, res) => {
  try {
    const { id } = req.params

    let invoiceRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [id])
    if (invoiceRes.rows.length === 0) {
      // Retry loop: wait up to 1.5s in case createInvoice is running concurrently
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 500))
        invoiceRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [id])
        if (invoiceRes.rows.length > 0) break
      }
    }

    if (invoiceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' })
    }

    const invoice = mapInvoice(invoiceRes.rows[0])
    if (!invoice) {
      return res.status(404).json({ error: 'Failed to parse invoice data' })
    }

    // Fetch company settings to pass current address, GSTIN and active bank details
    const settingsRes = await pool.query('SELECT * FROM company_settings WHERE id = $1', ['default'])
    const settings = settingsRes.rows.length > 0 ? mapSettings(settingsRes.rows[0]) : undefined

    // 1. Generate PDF buffer using Puppeteer
    const pdfBuffer = await generateInvoicePdfBuffer(invoice as any, settings as any)

    // 2. Upload to Cloudflare R2 under 'invoices' folder
    const fileName = `${invoice.invoiceNumber || 'invoice'}`
    const r2Result = await uploadPdfBufferToR2({
      buffer: pdfBuffer,
      originalName: `${fileName}.pdf`,
      folder: 'invoices',
      invoiceId: invoice.id,
    })

    // 3. Persist R2 URL and object key into database
    const updateRes = await pool.query(
      `UPDATE invoices 
       SET pdf_url = $1, r2_key = $2, updated_at = NOW() 
       WHERE id = $3 
       RETURNING *`,
      [r2Result.url, r2Result.key, id]
    )

    const updatedInvoice = mapInvoice(updateRes.rows[0])
    syncEvents.notify('invoices', 'update', id, updatedInvoice)

    res.json({
      success: true,
      pdfUrl: r2Result.url,
      r2Key: r2Result.key,
      size: r2Result.size,
      invoice: updatedInvoice,
    })
  } catch (err: any) {
    console.error('Invoice PDF generation / R2 upload error:', err)
    res.status(500).json({ error: err.message || 'Failed to generate invoice PDF and upload to Cloudflare R2' })
  }
})

// Direct file download endpoint with Content-Disposition: attachment
invoicesRouter.get('/:id/download-pdf', async (req, res) => {
  try {
    const { id } = req.params
    const invoiceRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [id])
    if (invoiceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' })
    }
    const invoice = mapInvoice(invoiceRes.rows[0])
    if (!invoice) {
      return res.status(404).json({ error: 'Failed to parse invoice data' })
    }

    const fileName = `${invoice.invoiceNumber || 'invoice'}.pdf`
    let pdfBuffer: Buffer | null = null

    // If PDF is already stored in R2, fetch the buffer
    if (invoice.pdfUrl) {
      try {
        const fetchRes = await fetch(invoice.pdfUrl)
        if (fetchRes.ok) {
          const arrayBuffer = await fetchRes.arrayBuffer()
          pdfBuffer = Buffer.from(arrayBuffer)
        }
      } catch {
        // Fallback to generating buffer
      }
    }

    // If not found or fetch failed, generate buffer on the fly
    if (!pdfBuffer) {
      const settingsRes = await pool.query('SELECT * FROM company_settings WHERE id = $1', ['default'])
      const settings = settingsRes.rows.length > 0 ? mapSettings(settingsRes.rows[0]) : undefined
      pdfBuffer = await generateInvoicePdfBuffer(invoice as any, settings as any)
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.send(pdfBuffer)
  } catch (err: any) {
    console.error('Download invoice error:', err)
    res.status(500).json({ error: err.message || 'Failed to download invoice PDF' })
  }
})

// Generate PDF on-the-fly and upload to Cloudflare R2
invoicesRouter.post('/generate-pdf', async (req, res) => {
  try {
    const payload = req.body
    if (!payload || !payload.invoiceNumber) {
      return res.status(400).json({ error: 'Invalid invoice data provided' })
    }

    const settingsRes = await pool.query('SELECT * FROM company_settings WHERE id = $1', ['default'])
    const settings = settingsRes.rows.length > 0 ? mapSettings(settingsRes.rows[0]) : undefined

    const pdfBuffer = await generateInvoicePdfBuffer(payload, settings as any)
    const r2Result = await uploadPdfBufferToR2({
      buffer: pdfBuffer,
      originalName: `${payload.invoiceNumber}.pdf`,
      folder: 'invoices',
      invoiceId: payload.id || 'draft',
    })

    res.json({
      success: true,
      pdfUrl: r2Result.url,
      r2Key: r2Result.key,
      size: r2Result.size,
    })
  } catch (err: any) {
    console.error('On-the-fly invoice PDF generation error:', err)
    res.status(500).json({ error: err.message || 'Failed to generate invoice PDF and upload to R2' })
  }
})

