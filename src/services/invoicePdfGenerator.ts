import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface InvoicePdfItem {
  id?: string
  productId?: string
  name: string
  image?: string
  hsnCode?: string
  quantity: number
  unitPrice: number
  discountPercent?: number
  discountAmount?: number
  material?: string
  dimensions?: string
  sku?: string
  total: number
}

export interface BankAccountDetails {
  id?: string
  bankName: string
  accountName: string
  accountNumber: string
  ifscCode: string
  branch?: string
  upiId?: string
  accountType?: string
  isDefault?: boolean
}

export interface InvoicePdfData {
  id?: string
  invoiceNumber: string
  proposalRef?: string
  poNumber?: string
  customerName: string
  companyName?: string
  phone: string
  email: string
  clientGstin?: string
  billingAddress: string
  shippingAddress?: string
  issueDate: string
  dueDate: string
  status: string
  paymentMode?: string
  items: InvoicePdfItem[]
  subtotal: number
  discountAmount?: number
  deliveryFee: number
  cgstRate?: number
  cgstAmount?: number
  sgstRate?: number
  sgstAmount?: number
  taxAmount: number
  total: number
  amountPaid: number
  balanceDue: number
  notes?: string
  paymentRef?: string
}

export interface StoreSettingsPdfData {
  name?: string
  addressLines?: string[]
  phones?: Array<{ display: string; tel: string } | string>
  email?: string
  gstin?: string
  factoryLocation?: string
  bankAccounts?: BankAccountDetails[]
  signatureUrl?: string
}

/**
 * Resolves local image paths or logo to base64 Data URI
 */
function resolveLogoDataUri(): string {
  try {
    const candidatePaths = [
      path.resolve(__dirname, '../../../brothersfurniture/src/assets/logo.png'),
      path.resolve(__dirname, '../../../brothersfurniture_admin/src/assets/logo.png'),
      path.resolve(__dirname, '../../assets/logo.png'),
    ]

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p)
        return `data:image/png;base64,${buf.toString('base64')}`
      }
    }
  } catch (err) {
    console.warn('Could not read logo asset:', err)
  }
  return ''
}

function formatCurrency(amount: number): string {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export async function generateInvoicePdfBuffer(
  invoice: InvoicePdfData,
  settings?: StoreSettingsPdfData
): Promise<Buffer> {
  const logoDataUri = resolveLogoDataUri()

  // Select active bank details: default account or first available
  const bankAccounts = settings?.bankAccounts || []
  const activeBank: BankAccountDetails =
    bankAccounts.find((b) => b.isDefault) ||
    bankAccounts[0] || {
      bankName: 'HDFC Bank',
      accountName: 'Brothers Furniture Industrial Solutions',
      accountNumber: '50200084920194',
      ifscCode: 'HDFC0001849',
      branch: 'Ambattur Industrial Estate Branch, Chennai',
      upiId: 'brothersfurniture@hdfcbank',
      accountType: 'Current',
    }

  const companyName = settings?.name || 'Brothers Furniture'
  const addressLines =
    settings?.addressLines && settings.addressLines.length > 0
      ? settings.addressLines
      : [
          'Plot No. 42-B, SIDCO Industrial Estate',
          'Ambattur, Chennai – 600058, Tamil Nadu, India',
        ]
  const companyGstin = settings?.gstin || '33AAAAA0000A1Z5'
  const companyEmail = settings?.email || 'sales@brothersfurniture.in'
  const companyPhone =
    settings?.phones && settings.phones.length > 0
      ? typeof settings.phones[0] === 'string'
        ? settings.phones[0]
        : (settings.phones[0] as any).display || (settings.phones[0] as any).tel || '+91 98400 12345'
      : '+91 98400 12345'
  const signatureUrl = settings?.signatureUrl || ''

  const subtotal = Number(invoice.subtotal) || 0
  const discountAmount = Number(invoice.discountAmount) || 0
  const deliveryFee = Number(invoice.deliveryFee) || 0
  const cgstAmount = Number(invoice.cgstAmount) || Math.round(Math.max(0, subtotal - discountAmount) * 0.09)
  const sgstAmount = Number(invoice.sgstAmount) || Math.round(Math.max(0, subtotal - discountAmount) * 0.09)
  const total = Number(invoice.total) || (subtotal - discountAmount + deliveryFee + cgstAmount + sgstAmount)
  const amountPaid = Number(invoice.amountPaid) || 0
  const balanceDue = Number(invoice.balanceDue) !== undefined ? Number(invoice.balanceDue) : Math.max(0, total - amountPaid)

  const items = Array.isArray(invoice.items) ? invoice.items : []

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice - ${invoice.invoiceNumber}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 15mm 15mm 15mm;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #1e293b;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.45;
    }

    .invoice-container {
      width: 100%;
      max-width: 100%;
    }

    /* ==========================================================================
       HEADER: Left = invoice details, Right = logo
       ========================================================================== */
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      padding-bottom: 14px;
      border-bottom: 2px solid #0f172a;
    }

    .header-left {
      vertical-align: top;
      text-align: left;
      width: 60%;
    }

    .header-right {
      vertical-align: top;
      text-align: right;
      width: 40%;
    }

    .invoice-title {
      font-size: 26px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.5px;
      text-transform: uppercase;
      line-height: 1.1;
      margin-bottom: 8px;
    }

    .invoice-meta-list {
      list-style: none;
      padding: 0;
      margin: 0;
      font-size: 11.5px;
      color: #334155;
    }

    .invoice-meta-item {
      margin-bottom: 3px;
      display: flex;
      align-items: baseline;
    }

    .invoice-meta-label {
      font-weight: 600;
      color: #64748b;
      min-width: 105px;
      text-transform: capitalize;
    }

    .invoice-meta-val {
      font-weight: 700;
      color: #0f172a;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .invoice-meta-val.highlight {
      color: #ea580c;
    }

    .logo-img {
      max-width: 180px;
      max-height: 65px;
      object-fit: contain;
    }

    .logo-fallback {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-align: right;
    }

    .logo-badge {
      display: inline-block;
      background: #ea580c;
      color: #ffffff;
      font-weight: 900;
      font-size: 18px;
      padding: 6px 10px;
      border-radius: 6px;
      letter-spacing: 0.5px;
    }

    .logo-brand-text {
      text-align: right;
    }

    .logo-brand-name {
      font-size: 16px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.3px;
      text-transform: uppercase;
    }

    .logo-brand-tagline {
      font-size: 9px;
      color: #64748b;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    /* ==========================================================================
       BILLED BY & BILLED TO COLUMNS
       ========================================================================== */
    .parties-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 14px 0;
      margin-left: -14px;
      margin-right: -14px;
      margin-bottom: 22px;
    }

    .party-card {
      width: 50%;
      vertical-align: top;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 14px;
    }

    .party-title {
      font-size: 10px;
      font-weight: 800;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 6px;
      padding-bottom: 4px;
      border-bottom: 1px dashed #cbd5e1;
    }

    .party-name {
      font-size: 13px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 3px;
    }

    .party-company {
      font-size: 11.5px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 4px;
    }

    .party-detail {
      font-size: 10.5px;
      color: #475569;
      margin-bottom: 2px;
      line-height: 1.4;
    }

    .party-highlight {
      font-weight: 700;
      color: #0f172a;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    /* ==========================================================================
       PRODUCTS DETAILS TABLE
       ========================================================================== */
    .section-heading {
      font-size: 11px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 8px;
    }

    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      overflow: hidden;
    }

    .items-table th {
      background: #0f172a;
      color: #ffffff;
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      padding: 8px 10px;
      text-align: left;
    }

    .items-table th.center,
    .items-table td.center {
      text-align: center;
    }

    .items-table th.right,
    .items-table td.right {
      text-align: right;
    }

    .items-table td {
      padding: 9px 10px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      font-size: 10.5px;
    }

    .items-table tbody tr:nth-child(even) {
      background: #f8fafc;
    }

    .item-name {
      font-weight: 700;
      color: #0f172a;
      font-size: 11px;
      margin-bottom: 2px;
    }

    .item-meta {
      font-size: 9.5px;
      color: #64748b;
      line-height: 1.3;
    }

    .item-sku {
      display: inline-block;
      background: #e2e8f0;
      color: #334155;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 8.5px;
      font-weight: 600;
      padding: 1px 4px;
      border-radius: 3px;
      margin-right: 4px;
    }

    /* ==========================================================================
       FINANCIAL TOTALS BREAKDOWN
       ========================================================================== */
    .totals-container {
      width: 100%;
      margin-bottom: 20px;
      page-break-inside: avoid;
    }

    .totals-table {
      margin-left: auto;
      width: 310px;
      border-collapse: collapse;
    }

    .totals-table td {
      padding: 4px 8px;
      font-size: 10.5px;
    }

    .totals-table td.label {
      color: #475569;
      text-align: left;
    }

    .totals-table td.val {
      text-align: right;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600;
      color: #1e293b;
    }

    .totals-table tr.grand-total td {
      border-top: 2px solid #0f172a;
      border-bottom: 2px solid #0f172a;
      padding: 7px 8px;
      font-size: 12.5px;
      font-weight: 800;
    }

    .totals-table tr.grand-total td.label {
      color: #0f172a;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .totals-table tr.grand-total td.val {
      color: #ea580c;
      font-size: 13.5px;
      font-weight: 900;
    }

    .totals-table tr.balance td {
      padding-top: 6px;
      font-weight: 700;
      font-size: 11px;
    }

    .totals-table tr.balance td.val {
      color: #b45309;
      font-weight: 800;
    }

    /* ==========================================================================
       BANK DETAILS SECTION (as requested below products details)
       ========================================================================== */
    .bottom-layout-container {
      display: flex;
      flex-direction: row;
      align-items: stretch;
      gap: 16px;
      width: 100%;
      page-break-inside: avoid;
      margin-top: 10px;
      box-sizing: border-box;
    }

    .bank-card {
      flex: 1.35;
      width: 58%;
      box-sizing: border-box;
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .bank-card-title {
      font-size: 10.5px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .bank-badge {
      background: #0f172a;
      color: #ffffff;
      font-size: 8.5px;
      font-weight: 700;
      padding: 1.5px 5px;
      border-radius: 3px;
      letter-spacing: 0.3px;
    }

    .bank-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 12px;
      font-size: 10px;
    }

    .bank-grid-item {
      display: flex;
      flex-direction: column;
    }

    .bank-grid-full {
      grid-column: span 2;
    }

    .bank-label {
      font-size: 9px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 1px;
    }

    .bank-value {
      font-size: 11px;
      font-weight: 700;
      color: #0f172a;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .signatory-box {
      flex: 1;
      width: 42%;
      box-sizing: border-box;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 12px 14px;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      text-align: right;
    }

    .sign-for {
      font-size: 10px;
      font-weight: 700;
      color: #334155;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .sign-middle {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      min-height: 48px;
      margin: 4px 0;
    }

    .sign-img {
      max-height: 52px;
      max-width: 140px;
      object-fit: contain;
    }

    .sign-space {
      height: 48px;
    }

    .sign-bottom {
      margin-top: auto;
    }

    .sign-line {
      border-top: 1px solid #94a3b8;
      width: 170px;
      margin-left: auto;
      margin-bottom: 4px;
    }

    .sign-title {
      font-size: 9.5px;
      font-weight: 700;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    /* ==========================================================================
       TERMS & FOOTER
       ========================================================================== */
    .footer-note {
      margin-top: 16px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      font-size: 9px;
      color: #64748b;
      line-height: 1.4;
      text-align: center;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="invoice-container">

    <!-- 1. HEADER (Left: invoice, invoice number, invoice date, due date; Right: logo) -->
    <table class="header-table">
      <tr>
        <td class="header-left">
          <div class="invoice-title">INVOICE</div>
          <ul class="invoice-meta-list">
            <li class="invoice-meta-item">
              <span class="invoice-meta-label">Invoice Number:</span>
              <span class="invoice-meta-val">${invoice.invoiceNumber}</span>
            </li>
            <li class="invoice-meta-item">
              <span class="invoice-meta-label">Invoice Date:</span>
              <span class="invoice-meta-val">${formatDate(invoice.issueDate)}</span>
            </li>
            <li class="invoice-meta-item">
              <span class="invoice-meta-label">Due Date:</span>
              <span class="invoice-meta-val highlight">${formatDate(invoice.dueDate)}</span>
            </li>
            ${invoice.proposalRef ? `
            <li class="invoice-meta-item">
              <span class="invoice-meta-label">Proposal Ref:</span>
              <span class="invoice-meta-val">${invoice.proposalRef}</span>
            </li>` : ''}
            ${invoice.poNumber ? `
            <li class="invoice-meta-item">
              <span class="invoice-meta-label">Buyer PO Ref:</span>
              <span class="invoice-meta-val">${invoice.poNumber}</span>
            </li>` : ''}
          </ul>
        </td>
        <td class="header-right">
          ${logoDataUri ? `
            <img src="${logoDataUri}" alt="Brothers Furniture" class="logo-img" />
          ` : `
            <div class="logo-fallback">
              <div class="logo-badge">BF</div>
              <div class="logo-brand-text">
                <div class="logo-brand-name">Brothers Furniture</div>
                <div class="logo-brand-tagline">Commercial Fit-Outs &bull; Chennai</div>
              </div>
            </div>
          `}
        </td>
      </tr>
    </table>

    <!-- 2. BILLED BY & BILLED TO -->
    <table class="parties-table">
      <tr>
        <!-- BILLED BY -->
        <td class="party-card">
          <div class="party-title">BILLED BY (SUPPLIER)</div>
          <div class="party-name">${companyName}</div>
          <div class="party-detail">${addressLines.join(', ')}</div>
          <div class="party-detail">
            GSTIN: <span class="party-highlight">${companyGstin}</span>
          </div>
          <div class="party-detail">
            State: <span class="party-highlight">33 - Tamil Nadu</span>
          </div>
          <div class="party-detail">
            Phone: ${companyPhone} &bull; Email: ${companyEmail}
          </div>
        </td>

        <!-- BILLED TO -->
        <td class="party-card">
          <div class="party-title">BILLED TO (BUYER)</div>
          <div class="party-name">${invoice.customerName}</div>
          ${invoice.companyName ? `<div class="party-company">${invoice.companyName}</div>` : ''}
          <div class="party-detail">${invoice.billingAddress || 'Address on record'}</div>
          ${invoice.shippingAddress && invoice.shippingAddress !== invoice.billingAddress ? `
            <div class="party-detail" style="margin-top: 3px; font-style: italic;">
              <strong>Delivery Destination:</strong> ${invoice.shippingAddress}
            </div>
          ` : ''}
          <div class="party-detail" style="margin-top: 3px;">
            Phone: <span class="party-highlight">${invoice.phone}</span> &bull; Email: ${invoice.email}
          </div>
          ${invoice.clientGstin ? `
            <div class="party-detail">
              Buyer GSTIN: <span class="party-highlight">${invoice.clientGstin}</span>
            </div>
          ` : ''}
        </td>
      </tr>
    </table>

    <!-- 3. PRODUCTS DETAILS -->
    <div class="section-heading">PRODUCTS DETAILS (TAX INVOICE SCHEDULE)</div>
    <table class="items-table">
      <thead>
        <tr>
          <th class="center" style="width: 32px;">#</th>
          <th>Description &amp; Model</th>
          <th class="center" style="width: 60px;">HSN/SAC</th>
          <th class="center" style="width: 45px;">Qty</th>
          <th class="right" style="width: 85px;">Unit Rate</th>
          <th class="center" style="width: 55px;">Disc (%)</th>
          <th class="right" style="width: 85px;">Taxable</th>
          <th class="right" style="width: 95px;">Total (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${items.length === 0 ? `
          <tr>
            <td colspan="8" class="center" style="padding: 16px; color: #64748b;">
              No line items specified.
            </td>
          </tr>
        ` : items.map((item, idx) => {
          const qty = Number(item.quantity) || 1
          const rate = Number(item.unitPrice) || 0
          const gross = qty * rate
          const itemSubtotal = Number(item.total) || gross
          const discAmt = (item.discountAmount !== undefined && Number(item.discountAmount) > 0)
            ? Number(item.discountAmount)
            : Math.max(0, gross - itemSubtotal)
          const discPct = item.discountPercent
            ? Number(item.discountPercent)
            : (gross > 0 && discAmt > 0
                ? Math.round((discAmt / gross) * 100)
                : (discountAmount > 0 && subtotal > 0
                    ? Math.round((discountAmount / subtotal) * 100)
                    : 0))
          const withGst = itemSubtotal * 1.18
          return `
            <tr>
              <td class="center font-mono" style="color: #64748b;">${idx + 1}</td>
              <td>
                <div class="item-name">${item.name}</div>
                <div class="item-meta">
                  ${item.sku ? `<span class="item-sku">${item.sku}</span>` : ''}
                  ${[item.material, item.dimensions].filter(Boolean).join(' • ')}
                </div>
              </td>
              <td class="center font-mono" style="color: #475569;">${item.hsnCode || '9403'}</td>
              <td class="center font-mono" style="font-weight: 700; color: #0f172a;">${qty}</td>
              <td class="right font-mono">${formatCurrency(rate)}</td>
              <td class="center font-mono" style="color: #16a34a; font-weight: 600;">${discPct ? `${discPct}%` : '—'}</td>
              <td class="right font-mono">
                ${formatCurrency(itemSubtotal)}
                ${discAmt > 0 ? `<div style="font-size: 8px; color: #16a34a;">-₹${discAmt.toLocaleString('en-IN')}</div>` : ''}
              </td>
              <td class="right font-mono" style="font-weight: 700; color: #0f172a;">${formatCurrency(withGst)}</td>
            </tr>
          `
        }).join('')}
      </tbody>
    </table>

    <!-- FINANCIAL TOTALS BREAKDOWN -->
    <div class="totals-container">
      <table class="totals-table">
        <tr>
          <td class="label">Taxable Value (Subtotal):</td>
          <td class="val">${formatCurrency(subtotal)}</td>
        </tr>
        ${discountAmount > 0 ? `
        <tr>
          <td class="label">Commercial Discount:</td>
          <td class="val" style="color: #16a34a;">-${formatCurrency(discountAmount)}</td>
        </tr>` : ''}
        <tr>
          <td class="label">Central GST (CGST 9%):</td>
          <td class="val">${formatCurrency(cgstAmount)}</td>
        </tr>
        <tr>
          <td class="label">State GST (SGST 9%):</td>
          <td class="val">${formatCurrency(sgstAmount)}</td>
        </tr>
        <tr>
          <td class="label">Freight &amp; Assembly Fee:</td>
          <td class="val">${deliveryFee === 0 ? '<span style="color: #16a34a; font-weight: 700;">FREE</span>' : formatCurrency(deliveryFee)}</td>
        </tr>
        <tr class="grand-total">
          <td class="label">Total Amount:</td>
          <td class="val">${formatCurrency(total)}</td>
        </tr>
        <tr>
          <td class="label" style="color: #16a34a; font-weight: 600;">Amount Paid:</td>
          <td class="val" style="color: #16a34a;">${formatCurrency(amountPaid)}</td>
        </tr>
        <tr class="balance">
          <td class="label">Balance Due:</td>
          <td class="val">${formatCurrency(balanceDue)}</td>
        </tr>
      </table>
    </div>

    <!-- 4. BANK DETAILS & AUTHORIZED SIGNATORY -->
    <div class="bottom-layout-container">
      <!-- Bank Details Box -->
      <div class="bank-card">
        <div>
          <div class="bank-card-title">
            <span>BANK DETAILS FOR PAYMENT</span>
            <span class="bank-badge">RTGS / NEFT / IMPS</span>
          </div>
          <div class="bank-grid">
            <div class="bank-grid-item">
              <span class="bank-label">Bank Name</span>
              <span class="bank-value">${activeBank.bankName}</span>
            </div>
            <div class="bank-grid-item">
              <span class="bank-label">Account Name (Beneficiary)</span>
              <span class="bank-value">${activeBank.accountName}</span>
            </div>
            <div class="bank-grid-item">
              <span class="bank-label">Account Number</span>
              <span class="bank-value">${activeBank.accountNumber}</span>
            </div>
            <div class="bank-grid-item">
              <span class="bank-label">IFSC Code</span>
              <span class="bank-value">${activeBank.ifscCode}</span>
            </div>
            ${activeBank.branch ? `
            <div class="bank-grid-item bank-grid-full">
              <span class="bank-label">Branch</span>
              <span class="bank-value" style="font-size: 10px;">${activeBank.branch}</span>
            </div>` : ''}
            ${activeBank.upiId ? `
            <div class="bank-grid-item bank-grid-full">
              <span class="bank-label">UPI ID</span>
              <span class="bank-value">${activeBank.upiId}</span>
            </div>` : ''}
          </div>
        </div>
      </div>

      <!-- Authorized Signatory -->
      <div class="signatory-box">
        <div class="sign-for">For ${companyName}</div>
        <div class="sign-middle">
          ${signatureUrl ? `
            <img src="${signatureUrl}" alt="Authorized Signature" class="sign-img" />
          ` : `
            <div class="sign-space"></div>
          `}
        </div>
        <div class="sign-bottom">
          <div class="sign-line"></div>
          <div class="sign-title">Authorized Signatory</div>
        </div>
      </div>
    </div>

    <!-- FOOTER / TERMS -->
    <div class="footer-note">
      <strong>Terms &amp; Conditions:</strong> 1. Payment is due strictly according to agreed credit terms. 2. Interest @ 18% p.a. will be charged on overdue payments. 3. Goods once sold and accepted at site will not be taken back. 4. Subject to Chennai Jurisdiction.
      <br />
      <em>Thank you for partnering with Brothers Furniture for your commercial workspace fit-outs.</em>
    </div>

  </div>
</body>
</html>
  `

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=medium',
    ],
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 })

    const pdfUint8 = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    })

    return Buffer.from(pdfUint8)
  } finally {
    await browser.close()
  }
}
