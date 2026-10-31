import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface ProposalPdfData {
  proposalNumber: string
  title: string
  preparedFor?: string
  customerName?: string
  companyName?: string
  phone?: string
  clientPhone?: string
  email?: string
  clientGstin?: string
  deliveryAddress?: string
  clientAddress?: string
  validUntil?: string
  targetDeliveryDate?: string
  status: string
  items: Array<{
    id?: string
    productId?: string
    name: string
    description?: string
    product?: any
    image?: string
    images?: string[]
    type?: string
    category: string
    subCategory?: string
    quantity: number
    unitPrice: number
    discountPercent?: number
    discountAmount?: number
    total: number
    material?: string
    dimensions?: string
    sku?: string
    notes?: string
  }>
  subtotal: number
  discountAmount?: number
  deliveryFee: number
  total: number
  terms?: string
  notes?: string
  createdAt: string
}

/**
 * Resolves local image paths into base64 Data URIs so Puppeteer renders them reliably
 */
function resolveImageAsDataUri(imgUrl?: string): string {
  if (!imgUrl) return ''
  if (imgUrl.startsWith('data:')) return imgUrl
  if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) return imgUrl

  try {
    const cleanPath = imgUrl.startsWith('/') ? imgUrl.slice(1) : imgUrl
    const candidatePaths = [
      path.resolve(__dirname, '../../../brothersfurniture_admin/public', cleanPath),
      path.resolve(__dirname, '../../../brothersfurniture/public', cleanPath),
      path.resolve(__dirname, '../../../brothersfurniture/src/assets', cleanPath),
      path.resolve(__dirname, '../../../brothersfurniture/src/assets', path.basename(cleanPath)),
      path.resolve(__dirname, '../../assets', cleanPath),
      path.resolve(__dirname, '../../assets', path.basename(cleanPath)),
    ]

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const ext = path.extname(p).toLowerCase().replace('.', '') || 'jpeg'
        const mime =
          ext === 'webp'
            ? 'image/webp'
            : ext === 'png'
            ? 'image/png'
            : ext === 'svg'
            ? 'image/svg+xml'
            : 'image/jpeg'
        const buf = fs.readFileSync(p)
        return `data:${mime};base64,${buf.toString('base64')}`
      }
    }
  } catch (err) {
    console.warn('Could not resolve image as Data URI:', imgUrl, err)
  }

  return imgUrl
}

/**
 * Resolves only images that strictly belong to the chosen product.
 * Never appends unrelated products (like Optimus chairs).
 */
function resolveProductImages(item: any): string[] {
  const list: string[] = []

  // 1. Explicit multi-images array from catalog if present
  const sourceImages =
    Array.isArray(item.images) && item.images.length > 0
      ? item.images
      : Array.isArray(item.product?.images) && item.product.images.length > 0
        ? item.product.images
        : []

  for (const u of sourceImages) {
    const url = typeof u === 'string' ? u : u?.url
    if (url && !list.includes(url)) list.push(url)
  }

  // 2. Primary image
  const mainImg = item.image || item.product?.image || ''
  if (mainImg && !list.includes(mainImg)) {
    list.unshift(mainImg)
  }

  return list
}

/**
 * Paginates items: First page shows up to 8 products.
 * Subsequent pages (2nd, 3rd, etc.) show up to 4 products each.
 */
function chunkProposalItems(items: ProposalPdfData['items']): Array<ProposalPdfData['items']> {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return []

  const pages: Array<typeof list> = []

  // First page shows up to 8 products
  pages.push(list.slice(0, 8))

  // Subsequent pages show up to 4 products each
  let remaining = list.slice(8)
  while (remaining.length > 0) {
    pages.push(remaining.slice(0, 4))
    remaining = remaining.slice(4)
  }

  return pages
}

export async function generateProposalPdfBuffer(proposal: ProposalPdfData): Promise<Buffer> {
  // Read cover photos (chair.webp & workspace.webp) & logo.png as base64 Data URIs
  let coverDataUri = ''
  let workspaceDataUri = ''
  let logoDataUri = ''
  try {
    const logoPaths = [
      path.resolve(__dirname, '../../../brothersfurniture/src/assets/logo.png'),
      path.resolve(__dirname, '../../../brothersfurniture_admin/src/assets/logo.png'),
      path.resolve(__dirname, '../../assets/logo.png'),
    ]
    for (const lp of logoPaths) {
      if (fs.existsSync(lp)) {
        const buf = fs.readFileSync(lp)
        logoDataUri = `data:image/png;base64,${buf.toString('base64')}`
        break
      }
    }

    const chairPath = path.resolve(__dirname, '../../assets/chair.webp')
    if (fs.existsSync(chairPath)) {
      const buf = fs.readFileSync(chairPath)
      coverDataUri = `data:image/webp;base64,${buf.toString('base64')}`
    } else {
      const adminChairPath = path.resolve(__dirname, '../../../brothersfurniture_admin/public/chair.webp')
      if (fs.existsSync(adminChairPath)) {
        const buf = fs.readFileSync(adminChairPath)
        coverDataUri = `data:image/webp;base64,${buf.toString('base64')}`
      }
    }

    const wsPath = path.resolve(__dirname, '../../assets/workspace.webp')
    if (fs.existsSync(wsPath)) {
      const buf = fs.readFileSync(wsPath)
      workspaceDataUri = `data:image/webp;base64,${buf.toString('base64')}`
    } else {
      const adminWsPath = path.resolve(
        __dirname,
        '../../../brothersfurniture_admin/public/products/workstations/open-plan-linear.webp'
      )
      if (fs.existsSync(adminWsPath)) {
        const buf = fs.readFileSync(adminWsPath)
        workspaceDataUri = `data:image/webp;base64,${buf.toString('base64')}`
      }
    }
  } catch (err) {
    console.warn('Could not read proposal cover assets:', err)
  }

  const items = Array.isArray(proposal.items) ? proposal.items : []
  const itemPages = chunkProposalItems(items)

  const rawCreated =
    (proposal.createdAt as any) instanceof Date
      ? (proposal.createdAt as any).toISOString()
      : String(proposal.createdAt || new Date().toISOString())
  const issueDate = rawCreated.split('T')[0]
  const validityDate = proposal.validUntil || '30 Days from issue'

  const grossFromItems = items.reduce((s, it) => s + (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0), 0)
  const rowDiscountsFromItems = items.reduce((s, it) => s + (Number(it.discountAmount) || 0), 0)
  const subtotal = Number(proposal.subtotal) || grossFromItems
  const discountAmount = Number(proposal.discountAmount !== undefined ? proposal.discountAmount : rowDiscountsFromItems)
  const taxableAmount = Math.max(0, subtotal - discountAmount)
  const gstAmount = Math.round(taxableAmount * 0.18)
  const deliveryFee = Number(proposal.deliveryFee || 0)
  const grandTotal = Number(proposal.total || taxableAmount + gstAmount + deliveryFee)

  // Unique products for showcase page(s) before the table
  const uniqueProductsMap = new Map<string, any>()
  for (const rawItem of items) {
    const it = rawItem as any
    const key = it.productId || it.product?.id || it.name || it.description || 'prod'
    if (!uniqueProductsMap.has(key)) {
      const mergedProduct = {
        ...(it.product || {}),
        ...it,
        name: it.name || it.product?.name || it.description || 'Commercial Series Ergonomics',
        type: it.type || it.product?.type || 'Chairs',
        category: it.category || it.product?.category || 'Commercial Ergonomics',
        subCategory: it.subCategory || it.product?.subCategory,
        dimensions: it.dimensions || it.product?.dimensions,
        material: it.material || it.product?.material,
      }
      uniqueProductsMap.set(key, mergedProduct)
    }
  }
  const showcaseProducts = Array.from(uniqueProductsMap.values())
  const showcaseCount = showcaseProducts.length
  const totalPages = 3 + showcaseCount + itemPages.length
  const aboutUsPageNumber = 2 + showcaseCount + itemPages.length

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${proposal.proposalNumber} - Commercial Fit-Out Proposal</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;0,900;1,600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');

    @page {
      size: A4;
      margin: 0;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      color: #0f172a;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      width: 210mm;
      height: 297mm;
      max-height: 297mm;
      page-break-after: always;
      position: relative;
      background: #ffffff;
      box-sizing: border-box;
      overflow: hidden;
    }

    /* ========================================================
       PAGE 1: COVER PAGE
       Left: Image visible fully
       Right: Company name, proposal name
       ======================================================== */
    /* ========================================================
       PAGE 1: COVER PAGE
       Left: Luxury Architectural Showcase (Image Visible Fully)
       Right: Stately Executive Typography (Matching Reference)
       ======================================================== */
    .cover-page {
      display: flex;
      width: 210mm;
      height: 297mm;
      max-height: 297mm;
      background: #ffffff;
    }

    /* Left Side: ~48% width, warm architectural linen, generous photo card */
    .cover-left {
      width: 48%;
      height: 100%;
      background: #f7f5f0;
      border-right: 1.5px solid #e7e2d7;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 22mm 16mm 18mm 16mm;
      box-sizing: border-box;
      position: relative;
    }

    .cover-left-header {
      margin-bottom: 12px;
    }

    .cover-left-brand-block {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 5px;
    }

    .cover-left-logo-img {
      height: 38px;
      width: auto;
      max-width: 175px;
      object-fit: contain;
      display: block;
      margin-bottom: 2px;
    }

    .cover-left-logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #ea580c, #c2410c);
      color: #ffffff;
      font-weight: 900;
      font-size: 16px;
      border-radius: 8px;
      letter-spacing: -0.5px;
      margin-bottom: 2px;
    }

    .cover-left-brand-name {
      font-size: 13.5px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      line-height: 1.25;
    }

    .cover-left-brand-sub {
      font-size: 8.5px;
      font-weight: 700;
      color: #ea580c;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      line-height: 1.35;
    }

    /* Photos Stack: showcases two real Brothers Furniture photos (Workstations + Chairs) */
    .cover-photos-stack {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 8px 0;
    }

    .cover-photo-card {
      width: 100%;
      background: #ffffff;
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 10px 24px -6px rgba(28, 25, 23, 0.12);
      border: 1px solid rgba(0, 0, 0, 0.06);
    }

    .cover-photo-card img {
      width: 100%;
      height: 62mm;
      object-fit: cover;
      display: block;
      border-radius: 8px;
    }

    .cover-photo-caption {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 4px 2px 4px;
      font-size: 8.5px;
      font-weight: 700;
      color: #78716c;
    }

    .cover-photo-caption span:first-child {
      color: #c2410c;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    /* Left Side Bottom Features */
    .cover-left-features {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-top: 6px;
      margin-bottom: 12px;
    }

    .cover-feature-pill {
      background: #ffffff;
      border: 1px solid #e7e2d7;
      padding: 6px 8px;
      border-radius: 8px;
      font-size: 9px;
      font-weight: 700;
      color: #44403c;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }

    .cover-feature-pill::before {
      content: '●';
      color: #ea580c;
      font-size: 6px;
    }

    .cover-plant-seal {
      background: #1c1917;
      color: #ffffff;
      border-radius: 12px;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9.5px;
    }

    .cover-plant-seal strong {
      display: block;
      color: #fdba74;
      font-size: 10.5px;
      letter-spacing: 0.3px;
    }

    .cover-plant-seal span {
      color: #a8a29e;
      font-size: 8.5px;
    }

    /* Right Side: ~52% width, pristine executive white, stately typography */
    .cover-right {
      width: 52%;
      height: 100%;
      background: #ffffff;
      padding: 18mm 18mm 16mm 18mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-sizing: border-box;
    }

    .cover-right-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 4mm 0;
    }

    .cover-brand-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }

    .cover-brand-monogram {
      width: 42px;
      height: 42px;
      background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%);
      color: #ffffff;
      font-weight: 900;
      font-size: 17px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      box-shadow: 0 4px 10px rgba(234, 88, 12, 0.25);
    }

    .cover-brand-title {
      font-size: 21px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.5px;
      line-height: 1.1;
    }

    .cover-brand-sub {
      font-size: 10px;
      font-weight: 800;
      color: #ea580c;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-top: 2px;
    }

    /* Main Title matching user reference image */
    .cover-hero-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 44px;
      font-weight: 900;
      color: #0f172a;
      line-height: 1.08;
      letter-spacing: -0.5px;
      margin-bottom: 12px;
    }

    .cover-hero-rule {
      width: 100px;
      height: 4px;
      background: #991b1b; /* Crimson matching user reference */
      border-radius: 2px;
      margin-bottom: 14px;
    }

    .cover-hero-subtitle {
      font-size: 14.5px;
      font-weight: 700;
      color: #475569;
      line-height: 1.4;
      margin-bottom: 22px;
    }

    /* Client Details Card */
    .cover-client-card {
      background: #f8fafc;
      border: 1.5px solid #e2e8f0;
      border-radius: 14px;
      padding: 15px 18px;
      margin-bottom: 16px;
    }

    .cover-client-card-title {
      font-size: 9.5px;
      font-weight: 800;
      color: #991b1b;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .cover-client-card-name {
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 3px;
    }

    .cover-client-card-meta {
      font-size: 11px;
      color: #64748b;
      line-height: 1.45;
    }

    /* Commercial Estimate Card */
    .cover-estimate-card {
      background: #fffaf5;
      border: 1.5px solid #fed7aa;
      border-radius: 14px;
      padding: 15px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
    }

    .cover-estimate-label {
      font-size: 9.5px;
      font-weight: 800;
      color: #c2410c;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }

    .cover-estimate-note {
      font-size: 10px;
      color: #78716c;
    }

    .cover-estimate-val {
      font-family: 'JetBrains Mono', monospace;
      font-size: 22px;
      font-weight: 900;
      color: #c2410c;
    }

    /* Meta Grid */
    .cover-specs-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      padding: 16px 0;
      border-top: 1.5px solid #e2e8f0;
      margin-bottom: 16px;
    }

    .cover-spec-cell-label {
      font-size: 9px;
      font-weight: 800;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 3px;
    }

    .cover-spec-cell-val {
      font-size: 12px;
      font-weight: 800;
      color: #0f172a;
    }

    /* Trust Hallmark */
    .cover-trust-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 10px;
      color: #475569;
      font-weight: 700;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 14px;
      margin-bottom: 16px;
    }

    .cover-trust-row span {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* Executive Assurance Card */
    .cover-assurance-card {
      background: #f8fafc;
      border: 1.5px solid #e2e8f0;
      border-radius: 14px;
      padding: 15px 18px;
      margin-top: 0;
      margin-bottom: 0;
    }

    .cover-assurance-title {
      font-size: 9px;
      font-weight: 800;
      color: #ea580c;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .cover-assurance-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .cover-assurance-item strong {
      display: block;
      font-size: 10px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 2px;
    }

    .cover-assurance-item span {
      font-size: 8.5px;
      color: #64748b;
      line-height: 1.35;
      display: block;
    }

    .cover-footer-bar {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #94a3b8;
      font-weight: 600;
      border-top: 1px solid #e2e8f0;
      padding-top: 8px;
    }

    /* ========================================================
       FINAL PAGE: ABOUT US (DEDICATED FULL-PAGE FACTORY PROFILE)
       ======================================================== */
    .about-page {
      width: 210mm;
      height: 297mm;
      max-height: 297mm;
      padding: 18mm 18mm 16mm 18mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: #ffffff;
    }

    .about-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 2px solid #0f172a;
      margin-bottom: 16px;
    }

    .about-logo-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .about-logo-badge {
      width: 38px;
      height: 38px;
      background: #ea580c;
      color: #ffffff;
      font-weight: 900;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
    }

    .about-logo-title {
      font-size: 17px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.3px;
    }

    .about-logo-sub {
      font-size: 10px;
      font-weight: 700;
      color: #ea580c;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .about-header-meta {
      text-align: right;
      font-size: 11px;
      color: #64748b;
    }

    .about-header-meta strong {
      color: #0f172a;
      display: block;
      font-family: 'JetBrains Mono', monospace;
    }

    /* Hero */
    .about-hero {
      margin-bottom: 16px;
    }

    .about-hero-tag {
      font-size: 10px;
      font-weight: 800;
      color: #ea580c;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .about-hero-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 25px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.3px;
      line-height: 1.2;
      margin-bottom: 8px;
    }

    .about-hero-desc {
      font-size: 11.5px;
      color: #475569;
      line-height: 1.6;
    }

    /* 4 Stats Cards */
    .about-stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }

    .stat-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px 10px;
      text-align: center;
    }

    .stat-num {
      font-family: 'JetBrains Mono', monospace;
      font-size: 24px;
      font-weight: 900;
      color: #ea580c;
      margin-bottom: 4px;
    }

    .stat-label {
      font-size: 10.5px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 3px;
    }

    .stat-sub {
      font-size: 9px;
      color: #64748b;
    }

    /* 4 Pillars */
    .about-pillars-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 20px;
    }

    .pillar-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px 18px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
      min-height: 104px;
    }

    .pillar-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .pillar-num {
      width: 22px;
      height: 22px;
      background: #fff7ed;
      color: #ea580c;
      font-size: 10.5px;
      font-weight: 800;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #fed7aa;
    }

    .pillar-title {
      font-size: 12.5px;
      font-weight: 800;
      color: #0f172a;
    }

    .pillar-desc {
      font-size: 10px;
      color: #475569;
      line-height: 1.55;
    }

    /* Process Flow */
    .process-section {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px 18px;
      margin-bottom: 20px;
    }

    .process-header-title {
      font-size: 9.5px;
      font-weight: 800;
      color: #ea580c;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 12px;
      text-align: center;
    }

    .process-steps {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .process-step {
      text-align: center;
      flex: 1;
    }

    .process-circle {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: #0f172a;
      color: #ffffff;
      font-size: 11px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 6px auto;
    }

    .process-name {
      font-size: 10.5px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 2px;
    }

    .process-sub {
      font-size: 8.5px;
      color: #64748b;
    }

    .process-arrow {
      color: #ea580c;
      font-size: 16px;
      font-weight: 900;
      padding: 0 4px;
    }

    /* Plant Footer Card */
    .about-footer-card {
      background: #0f172a;
      color: #ffffff;
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      line-height: 1.6;
    }

    .about-footer-card strong {
      color: #fb923c;
    }

    .about-page-footer {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #94a3b8;
      border-top: 1px solid #f1f5f9;
      padding-top: 8px;
      margin-top: 8px;
    }

    /* ========================================================
       PAGE 3+: PRODUCT DETAILS & IMAGES (PAGINATED CLEANLY)
       ======================================================== */
    .content-page {
      width: 210mm;
      height: 297mm;
      max-height: 297mm;
      padding: 16mm 18mm 14mm 18mm;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      box-sizing: border-box;
      overflow: hidden;
    }

    .content-page .page-footer {
      margin-top: auto;
    }

    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 2px solid #0f172a;
      margin-bottom: 14px;
    }

    .header-logo {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .header-logo-badge {
      width: 32px;
      height: 32px;
      background: #ea580c;
      color: #ffffff;
      font-weight: 900;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
    }

    .header-logo-title {
      font-size: 16px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.3px;
    }

    .header-logo-sub {
      font-size: 9.5px;
      font-weight: 700;
      color: #ea580c;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .header-meta {
      text-align: right;
      font-size: 11px;
      color: #64748b;
    }

    .header-meta strong {
      color: #0f172a;
      font-size: 12px;
      display: block;
      font-family: 'JetBrains Mono', monospace;
    }

    .scope-banner {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 14px;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .scope-title-label {
      font-size: 9px;
      font-weight: 800;
      color: #ea580c;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 2px;
    }

    .scope-title-val {
      font-size: 13px;
      font-weight: 800;
      color: #0f172a;
    }

    .scope-badge {
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #a7f3d0;
      padding: 3px 10px;
      border-radius: 9999px;
      font-size: 9.5px;
      font-weight: 700;
    }

    /* Product Table */
    .table-container {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 14px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
    }

    thead {
      background: #f1f5f9;
      border-bottom: 1px solid #cbd5e1;
    }

    th {
      padding: 8px 10px;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      font-size: 8.5px;
      letter-spacing: 0.5px;
    }

    tr {
      page-break-inside: avoid;
    }

    td {
      padding: 9px 12px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
    }

    tr:last-child td {
      border-bottom: none;
    }

    .col-idx {
      width: 26px;
      text-align: center;
      color: #94a3b8;
      font-weight: 600;
    }

    .col-img {
      width: 68px;
      text-align: center;
    }

    .product-thumb {
      width: 56px;
      height: 56px;
      object-fit: contain;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      display: inline-block;
      padding: 3px;
    }

    .product-thumb-placeholder {
      width: 56px;
      height: 56px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: #fff7ed;
      color: #ea580c;
      font-weight: 900;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
    }

    .product-name {
      font-weight: 800;
      color: #0f172a;
      font-size: 12px;
      margin-bottom: 2px;
    }

    .product-meta {
      font-size: 9.5px;
      color: #64748b;
      line-height: 1.4;
    }

    .product-tag {
      display: inline-block;
      background: #f1f5f9;
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 8.5px;
      font-weight: 600;
      color: #475569;
      margin-right: 4px;
    }

    .col-qty {
      width: 44px;
      text-align: center;
      font-weight: 800;
      color: #0f172a;
      font-size: 11.5px;
    }

    .col-rate {
      width: 85px;
      text-align: right;
      color: #475569;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
    }

    .col-total {
      width: 90px;
      text-align: right;
      font-weight: 800;
      color: #0f172a;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
    }

    .continued-strip {
      background: #fff7ed;
      border: 1px dashed #fed7aa;
      border-radius: 8px;
      padding: 10px 14px;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      color: #c2410c;
      margin-top: 14px;
    }

    /* Commercial Financial Summary Cards */
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 14px;
      page-break-inside: avoid;
    }

    .terms-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 9.5px;
      color: #475569;
      line-height: 1.5;
    }

    .terms-box h4 {
      font-size: 9px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .terms-box ul {
      padding-left: 14px;
    }

    .terms-box li {
      margin-bottom: 2px;
    }

    .table-totals-wrapper {
      display: flex;
      justify-content: flex-end;
      margin-top: 10px;
      margin-bottom: 14px;
      page-break-inside: avoid;
    }

    .totals-box {
      width: 360px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 18px;
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #64748b;
      margin-bottom: 5px;
    }

    .total-row.grand {
      border-top: 1.5px solid #0f172a;
      padding-top: 8px;
      margin-top: 4px;
      margin-bottom: 0;
      font-size: 13.5px;
      font-weight: 900;
      color: #0f172a;
    }

    .total-row.grand .amount {
      color: #ea580c;
      font-size: 16px;
      font-family: 'JetBrains Mono', monospace;
    }

    /* ========================================================
       FINAL PAGE: FACTORY TERMS, STANDARD WARRANTY & SIGN-OFF
       ======================================================== */
    .terms-page {
      width: 210mm;
      height: 297mm;
      max-height: 297mm;
      padding: 16mm 18mm 14mm 18mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: #ffffff;
      box-sizing: border-box;
    }

    .terms-hero {
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1.5px solid #e2e8f0;
    }

    .terms-hero-tag {
      font-size: 8.5px;
      font-weight: 800;
      color: #ea580c;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .terms-hero-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 21px;
      font-weight: 900;
      color: #0f172a;
      line-height: 1.2;
      margin-bottom: 5px;
    }

    .terms-hero-desc {
      font-size: 9px;
      color: #64748b;
      line-height: 1.45;
    }

    .terms-pillars-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 13px;
      margin-bottom: 16px;
    }

    .terms-item-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 9px;
      padding: 14px 16px;
      min-height: 96px;
    }

    .terms-item-title {
      font-size: 9.5px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .terms-item-title span {
      color: #ea580c;
      font-size: 11px;
    }

    .terms-item-desc {
      font-size: 8.5px;
      color: #475569;
      line-height: 1.52;
    }

    .terms-assurance-banner {
      background: #fff7ed;
      border: 1.5px solid #fed7aa;
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 8.5px;
      color: #9a3412;
      line-height: 1.45;
    }

    .terms-assurance-icon {
      font-size: 16px;
      flex-shrink: 0;
    }

    .terms-final-signoff {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      border: 1.5px solid #cbd5e1;
      border-radius: 12px;
      padding: 22px 26px;
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      margin-top: 12px;
      margin-bottom: 10px;
      min-height: 205px;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03);
    }

    .terms-final-signoff .signoff-label {
      font-size: 10px;
      font-weight: 800;
      color: #ea580c;
      letter-spacing: 1px;
      margin-bottom: 6px;
      text-transform: uppercase;
    }

    .terms-final-signoff .signoff-org {
      font-size: 14px;
      font-weight: 900;
      color: #0f172a;
      margin-bottom: 4px;
    }

    .terms-final-signoff .signoff-sub {
      font-size: 9.5px;
      color: #64748b;
      margin-bottom: 40px;
      line-height: 1.4;
    }

    .terms-final-signoff .signoff-line {
      border-bottom: 1.5px dashed #94a3b8;
      width: 95%;
      margin-bottom: 8px;
    }

    .terms-final-signoff .signoff-name {
      font-size: 9.5px;
      font-weight: 700;
      color: #334155;
    }

    /* Sign-Off Strip */
    .signoff-box {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 14px;
      background: #ffffff;
      margin-bottom: 12px;
      page-break-inside: avoid;
    }

    .signoff-col {
      font-size: 9.5px;
    }

    .signoff-label {
      font-size: 8.5px;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }

    .signoff-org {
      font-weight: 800;
      color: #0f172a;
      font-size: 11px;
    }

    .signoff-sub {
      color: #64748b;
      font-size: 8.5px;
      margin-bottom: 16px;
    }

    .signoff-line {
      border-bottom: 1px dashed #cbd5e1;
      width: 80%;
      margin-bottom: 4px;
    }

    .signoff-name {
      font-size: 8.5px;
      color: #64748b;
    }

    .page-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9px;
      color: #94a3b8;
    }

    .page-footer strong {
      color: #475569;
    }

    /* ========================================================
       PAGE: PRODUCT SHOWCASE & MULTI-ANGLE GALLERY
       ======================================================== */
    .showcase-page {
      width: 210mm;
      height: 297mm;
      max-height: 297mm;
      padding: 16mm 18mm 14mm 18mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: #ffffff;
      box-sizing: border-box;
      overflow: hidden;
    }

    .showcase-header {
      border-bottom: 1.5px solid #e2e8f0;
      padding-bottom: 9px;
      margin-bottom: 11px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }

    .showcase-eyebrow {
      font-size: 8px;
      font-weight: 800;
      color: #ea580c;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-bottom: 3px;
    }

    .showcase-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 20px;
      font-weight: 900;
      color: #0f172a;
      line-height: 1.2;
      margin: 0;
    }

    .showcase-meta-tag {
      font-size: 9px;
      font-weight: 700;
      color: #475569;
      background: #f1f5f9;
      padding: 4px 9px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Dynamic Gallery Grid (1, 2, or 3 columns based on product assets) */
    .showcase-gallery-grid {
      display: grid;
      gap: 12px;
      margin-bottom: 16px;
    }

    .showcase-gallery-grid.cols-3 {
      grid-template-columns: repeat(3, 1fr);
    }

    .showcase-gallery-grid.cols-2 {
      grid-template-columns: repeat(2, 1fr);
    }

    .showcase-gallery-grid.cols-1 {
      grid-template-columns: 1fr;
    }

    .showcase-angle-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
      display: flex;
      flex-direction: column;
    }

    .showcase-img-box {
      background: #f8fafc;
      height: 340px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      border-bottom: 1px solid #f1f5f9;
      position: relative;
    }

    .showcase-img-box img {
      max-height: 310px;
      max-width: 100%;
      object-fit: contain;
      display: block;
    }

    .showcase-img-box.single-hero-box {
      height: 440px;
      background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
    }

    .showcase-img-box.single-hero-box img {
      max-height: 410px;
    }

    .showcase-angle-badge {
      position: absolute;
      top: 8px;
      left: 8px;
      background: #0f172a;
      color: #ffffff;
      font-size: 8px;
      font-weight: 800;
      letter-spacing: 0.8px;
      padding: 3px 7px;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .showcase-angle-caption {
      padding: 8px 10px;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .showcase-angle-label {
      font-size: 10px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .showcase-angle-tag {
      font-size: 8px;
      font-weight: 700;
      color: #ea580c;
      background: #fff7ed;
      border: 1px solid #ffedd5;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    /* Section Header */
    .showcase-section-title {
      font-size: 8.5px;
      font-weight: 800;
      color: #ea580c;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      margin-top: 14px;
      margin-bottom: 11px;
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .showcase-section-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #e2e8f0;
    }

    /* 4x2 Specs Key-Value Cards Grid */
    .showcase-specs-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 18px;
    }

    .showcase-spec-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 4px;
      min-height: 54px;
    }

    .showcase-spec-label {
      font-size: 7.5px;
      font-weight: 800;
      color: #64748b;
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }

    .showcase-spec-val {
      font-size: 9.5px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Warranty Card & 3 Pillars */
    .showcase-warranty-card {
      background: linear-gradient(135deg, #fffbf5 0%, #fff7ed 100%);
      border: 1.5px solid #fed7aa;
      border-radius: 10px;
      padding: 15px 18px;
      box-shadow: 0 1px 3px rgba(234, 88, 12, 0.05);
      margin-bottom: 8px;
    }

    .showcase-warranty-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 9px;
      padding-bottom: 6px;
      border-bottom: 1px solid #ffedd5;
    }

    .showcase-warranty-title {
      font-size: 9px;
      font-weight: 800;
      color: #9a3412;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .showcase-warranty-seal {
      font-size: 7.5px;
      font-weight: 800;
      background: #ea580c;
      color: #ffffff;
      padding: 2.5px 7px;
      border-radius: 4px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .showcase-warranty-pillars {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 9px;
    }

    .showcase-warranty-pillar {
      background: #ffffff;
      border: 1px solid #fed7aa;
      border-radius: 7px;
      padding: 8px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .showcase-warranty-icon {
      font-size: 15px;
      line-height: 1;
      flex-shrink: 0;
    }

    .showcase-warranty-texts {
      display: flex;
      flex-direction: column;
      gap: 1.5px;
    }

    .showcase-warranty-bold {
      font-size: 8.5px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .showcase-warranty-sub {
      font-size: 8px;
      font-weight: 600;
      color: #64748b;
      line-height: 1.25;
    }
  </style>
</head>
<body>

  <!-- ========================================================
       PAGE 1: COVER PAGE
       Left Side: Image visible fully
       Right Side: Company name, proposal name
       ======================================================== -->
  <div class="page cover-page">
    <!-- Left: Luxury Showcase with Full Image Visible -->
    <div class="cover-left">
      <div class="cover-left-header">
        <div class="cover-left-brand-block">
          ${logoDataUri ? `<img src="${logoDataUri}" alt="Brothers Furniture" class="cover-left-logo-img" />` : `<div class="cover-left-logo-badge">BF</div>`}
          <div class="cover-left-brand-name">BROTHERS FURNITURE</div>
          <div class="cover-left-brand-sub">COMMERCIAL FIT-OUTS &bull; AMBATTUR PLANT</div>
        </div>
      </div>

      <!-- Dual Photos Stack from Brothers Furniture -->
      <div class="cover-photos-stack">
        <div class="cover-photo-card">
          ${workspaceDataUri ? `<img src="${workspaceDataUri}" alt="Commercial Workstations" />` : ''}
          <div class="cover-photo-caption">
            <span>Workstation Architecture</span>
            <span>Ambattur Plant</span>
          </div>
        </div>

        <div class="cover-photo-card">
          ${coverDataUri ? `<img src="${coverDataUri}" alt="Ergonomic Seating Suite" />` : ''}
          <div class="cover-photo-caption">
            <span>Ergonomic Seating Series</span>
            <span>Executive Suite</span>
          </div>
        </div>
      </div>

      <!-- Engineering Features & Plant Seal -->
      <div>
        <div class="cover-left-features">
          <div class="cover-feature-pill">Synchronous Multi-Tilt</div>
          <div class="cover-feature-pill">Breathable Mesh</div>
          <div class="cover-feature-pill">Class-4 Gas Lift</div>
          <div class="cover-feature-pill">BIFMA X5.1 Tested</div>
        </div>

        <div class="cover-plant-seal">
          <div>
            <strong>Ambattur Manufacturing Plant</strong>
            <span>Direct Enterprise Handover • Chennai</span>
          </div>
          <div style="color: #fdba74; font-size: 13px; font-weight: 900;">ISO 9001</div>
        </div>
      </div>
    </div>

    <!-- Right: Stately Executive Typography & Details -->
    <div class="cover-right">
      <div class="cover-right-content">
        <!-- Main Heading: Proposal Name / Scope -->
        <h1 class="cover-hero-title">${proposal.title || 'Commercial Fit-Out Proposal'}</h1>
        <div class="cover-hero-rule"></div>

        <div class="cover-hero-subtitle">
          Official Commercial Proposal & Scope of Supply
        </div>

        <!-- Client Details Card -->
        <div class="cover-client-card">
          <div class="cover-client-card-title">PROPOSAL FOR</div>
          <div class="cover-client-card-name">${proposal.preparedFor || proposal.customerName || 'Enterprise Client'}</div>
          ${proposal.companyName ? `<div style="font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 2px;">${proposal.companyName}</div>` : ''}
          <div class="cover-client-card-meta">
            ${proposal.email ? `<span>✉ ${proposal.email}</span>` : ''}
            ${(proposal.clientPhone || proposal.phone) ? `<span>${proposal.email ? ' &bull; ' : ''}✆ ${proposal.clientPhone || proposal.phone}</span>` : ''}
            ${(proposal.clientAddress || proposal.deliveryAddress) ? `<div style="margin-top: 3px; color: #64748b;">📍 ${proposal.clientAddress || proposal.deliveryAddress}</div>` : ''}
          </div>
        </div>

        <!-- Commercial Total Estimate Highlight Card -->
        <div class="cover-estimate-card">
          <div>
            <div class="cover-estimate-label">Commercial Estimate</div>
            <div class="cover-estimate-note">GST 18% & Factory Handover Included</div>
          </div>
          <div class="cover-estimate-val">₹${grandTotal.toLocaleString('en-IN')}</div>
        </div>

        <!-- Meta Schedule Grid -->
        <div class="cover-specs-grid">
          <div>
            <div class="cover-spec-cell-label">Date Issued</div>
            <div class="cover-spec-cell-val">${issueDate}</div>
          </div>
          <div>
            <div class="cover-spec-cell-label">Validity</div>
            <div class="cover-spec-cell-val">${validityDate}</div>
          </div>
          <div>
            <div class="cover-spec-cell-label">Target Delivery</div>
            <div class="cover-spec-cell-val">${proposal.targetDeliveryDate || 'Within 14 Days'}</div>
          </div>
          <div>
            <div class="cover-spec-cell-label">Total Units</div>
            <div class="cover-spec-cell-val">${proposal.items.reduce((s, i) => s + (i.quantity || 1), 0)} Products</div>
          </div>
        </div>

        <!-- Trust Hallmark Strip -->
        <div class="cover-trust-row">
          <span>✓ BIFMA Certified</span>
          <span>✓ Direct Factory Supply</span>
          <span>✓ 3-Year Warranty</span>
        </div>

        <!-- Executive Assurance Card -->
        <div class="cover-assurance-card">
          <div class="cover-assurance-title">ENTERPRISE DELIVERY & SERVICE COMMITMENT</div>
          <div class="cover-assurance-grid">
            <div class="cover-assurance-item">
              <strong>Direct Plant Handover</strong>
              <span>Direct factory dispatch from Ambattur with complete on-site assembly.</span>
            </div>
            <div class="cover-assurance-item">
              <strong>3-Year Factory Warranty</strong>
              <span>Full plant coverage on hydraulics, synchro mechanisms & frames.</span>
            </div>
          </div>
        </div>
      </div>

      <div class="cover-footer-bar">
        <span>Brothers Furniture &bull; Ambattur Industrial Estate Plant, Chennai</span>
        <span>Page 1 of ${totalPages}</span>
      </div>
    </div>
  </div>

  <!-- ========================================================
       PAGE 2+: PRODUCT ARCHITECTURE & MULTI-ANGLE SHOWCASE
       (BEFORE PRODUCT TABLE: FRONT, BACK, SIDE IMAGES & WARRANTY)
       ======================================================== -->
  ${showcaseProducts
    .map((prod, sIdx) => {
      const pageNumber = 2 + sIdx
      const productImages = resolveProductImages(prod)
      const imageCount = productImages.length

      let galleryHtml = ''
      if (imageCount >= 3) {
        galleryHtml = `
      <!-- 3-Angle Visual Gallery (Front, Side, Back of Chosen Product) -->
      <div class="showcase-gallery-grid cols-3">
        <div class="showcase-angle-card">
          <div class="showcase-img-box">
            <span class="showcase-angle-badge">Front Elevation</span>
            ${productImages[0] ? `<img src="${resolveImageAsDataUri(productImages[0])}" alt="${prod.name} Front" />` : ''}
          </div>
          <div class="showcase-angle-caption">
            <span class="showcase-angle-label">Front View</span>
            <span class="showcase-angle-tag">Primary Profile</span>
          </div>
        </div>
        <div class="showcase-angle-card">
          <div class="showcase-img-box">
            <span class="showcase-angle-badge">Side Profile</span>
            ${productImages[1] ? `<img src="${resolveImageAsDataUri(productImages[1])}" alt="${prod.name} Side" />` : ''}
          </div>
          <div class="showcase-angle-caption">
            <span class="showcase-angle-label">Side Profile</span>
            <span class="showcase-angle-tag">Lumbar S-Curve</span>
          </div>
        </div>
        <div class="showcase-angle-card">
          <div class="showcase-img-box">
            <span class="showcase-angle-badge">Rear Architecture</span>
            ${productImages[2] ? `<img src="${resolveImageAsDataUri(productImages[2])}" alt="${prod.name} Rear" />` : ''}
          </div>
          <div class="showcase-angle-caption">
            <span class="showcase-angle-label">Back / Rear</span>
            <span class="showcase-angle-tag">Spine Support</span>
          </div>
        </div>
      </div>`
      } else if (imageCount === 2) {
        galleryHtml = `
      <!-- 2-Angle Visual Gallery -->
      <div class="showcase-gallery-grid cols-2">
        <div class="showcase-angle-card">
          <div class="showcase-img-box">
            <span class="showcase-angle-badge">Primary Elevation</span>
            ${productImages[0] ? `<img src="${resolveImageAsDataUri(productImages[0])}" alt="${prod.name} View 1" />` : ''}
          </div>
          <div class="showcase-angle-caption">
            <span class="showcase-angle-label">Front Elevation</span>
            <span class="showcase-angle-tag">Ergonomic Profile</span>
          </div>
        </div>
        <div class="showcase-angle-card">
          <div class="showcase-img-box">
            <span class="showcase-angle-badge">Profile View</span>
            ${productImages[1] ? `<img src="${resolveImageAsDataUri(productImages[1])}" alt="${prod.name} View 2" />` : ''}
          </div>
          <div class="showcase-angle-caption">
            <span class="showcase-angle-label">Profile & Contour</span>
            <span class="showcase-angle-tag">Structural Form</span>
          </div>
        </div>
      </div>`
      } else {
        galleryHtml = `
      <!-- Single Product Visual Showcase (Chosen Product Only) -->
      <div class="showcase-gallery-grid cols-1">
        <div class="showcase-angle-card single-hero">
          <div class="showcase-img-box single-hero-box">
            <span class="showcase-angle-badge">Product Visual Showcase & Architecture</span>
            ${
              productImages[0]
                ? `<img src="${resolveImageAsDataUri(productImages[0])}" alt="${prod.name}" />`
                : ''
            }
          </div>
          <div class="showcase-angle-caption">
            <span class="showcase-angle-label">${prod.name} &bull; Primary Product Architecture</span>
            <span class="showcase-angle-tag">Factory Specification Model</span>
          </div>
        </div>
      </div>`
      }

      const isWorkstation =
        (prod.type && prod.type.toLowerCase().includes('workstation')) ||
        (prod.category && prod.category.toLowerCase().includes('workstation')) ||
        (prod.name && (prod.name.toLowerCase().includes('workstation') || prod.name.toLowerCase().includes('desk') || prod.name.toLowerCase().includes('table')))

      return `
  <div class="page showcase-page">
    <!-- Showcase Top Header -->
    <div class="showcase-header">
      <div>
        <div class="showcase-eyebrow">PRODUCT ARCHITECTURE & SPECIFICATION SHEET</div>
        <h2 class="showcase-title">${prod.name}</h2>
      </div>
      <div class="showcase-meta-tag">
        ${prod.type || 'Chairs'} &bull; ${prod.subCategory || prod.category || 'Commercial Ergonomics'}
      </div>
    </div>

    ${galleryHtml}

    <div class="showcase-specs-block">
      <!-- Technical Specifications Section Title -->
      <div class="showcase-section-title">
        <span>⚙</span> Technical Specifications & Engineering Standards
      </div>

      <!-- 4x2 Specs Key-Value Cards Grid (Zero Paragraphs - Clean, Punchy & Simple) -->
      <div class="showcase-specs-grid">
        ${
          isWorkstation
            ? `
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Desktop Core</div>
          <div class="showcase-spec-val" title="25mm Pre-Laminated Engineered Board">25mm Pre-Lam Particle/Birch</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Edge Protection</div>
          <div class="showcase-spec-val" title="2mm Machine Hot-Melt PVC Edge Banding">2mm Seamless PVC Edge</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Understructure</div>
          <div class="showcase-spec-val" title="50x50mm Heavy MS Steel Powder Coated">50×50mm Heavy MS Steel</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Surface Finish</div>
          <div class="showcase-spec-val" title="Anti-Scratch Melamine & Epoxy Coating">Scratch-Resistant Melamine</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Wire Management</div>
          <div class="showcase-spec-val" title="Integrated Raceway & Flip-Top Box">Flip-Top Grommet & Raceway</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Modesty Panel</div>
          <div class="showcase-spec-val" title="Perforated Metal / Matching Laminate">Perforated Steel Panel</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Leveling Glides</div>
          <div class="showcase-spec-val" title="Heavy-Duty Adjustable Nylon Glides">±15mm Nylon Levelers</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Dimensions</div>
          <div class="showcase-spec-val" title="${prod.dimensions || '1200 × 600 × 750 mm'}">${prod.dimensions || '1200 × 600 × 750 mm'}</div>
        </div>
            `
            : `
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Backrest Mesh</div>
          <div class="showcase-spec-val" title="Breathable Korean Elastomeric Mesh">Korean Elastomeric Mesh</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Seat Cushion</div>
          <div class="showcase-spec-val" title="55 kg/m³ High-Density Cold Moulded PU Foam">55 kg/m³ Moulded PU Foam</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Tilt Mechanism</div>
          <div class="showcase-spec-val" title="Multi-Lock Synchro-Tilt (90°–135° Recline)">Synchro-Tilt (90°–135°)</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Gas Hydraulics</div>
          <div class="showcase-spec-val" title="Heavy-Duty Class-4 Nitrogen Cylinder">Class-4 Heavy Duty (BIFMA)</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Armrests</div>
          <div class="showcase-spec-val" title="3D Height & Depth Adjustable PU Pads">3D Soft-Touch Adjustable</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Base & Wheels</div>
          <div class="showcase-spec-val" title="Die-Cast Chrome Alloy Base • 60mm Casters">Alloy Base & 60mm Casters</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Proof Load</div>
          <div class="showcase-spec-val" title="150 kg Static / 135 kg Dynamic Proof Load">150 kg Static / 135 kg Load</div>
        </div>
        <div class="showcase-spec-card">
          <div class="showcase-spec-label">Dimensions</div>
          <div class="showcase-spec-val" title="${prod.dimensions || '650 × 650 × 1150–1250 mm'}">${prod.dimensions || '650 × 650 × 1150–1250 mm'}</div>
        </div>
            `
        }
      </div>
    </div>

    <!-- 5-Year Factory Warranty & Support (Clean 3-Pillar Badges - Zero Paragraphs) -->
    <div class="showcase-warranty-card">
      <div class="showcase-warranty-header">
        <div class="showcase-warranty-title">
          <span>🛡️</span> 5-Year Factory Warranty & Service Commitment
        </div>
        <div class="showcase-warranty-seal">AMBATTUR PLANT DIRECT GUARANTEE</div>
      </div>
      <div class="showcase-warranty-pillars">
        <div class="showcase-warranty-pillar">
          <span class="showcase-warranty-icon">🛡️</span>
          <div class="showcase-warranty-texts">
            <span class="showcase-warranty-bold">5-Year Full Warranty</span>
            <span class="showcase-warranty-sub">Gas lift hydraulics & synchro tilt mechanisms</span>
          </div>
        </div>
        <div class="showcase-warranty-pillar">
          <span class="showcase-warranty-icon">🏗️</span>
          <div class="showcase-warranty-texts">
            <span class="showcase-warranty-bold">10-Year Frame Durability</span>
            <span class="showcase-warranty-sub">Structural chassis & alloy base integrity</span>
          </div>
        </div>
        <div class="showcase-warranty-pillar">
          <span class="showcase-warranty-icon">⚡</span>
          <div class="showcase-warranty-texts">
            <span class="showcase-warranty-bold">24–48h On-Site SLA</span>
            <span class="showcase-warranty-sub">Chennai factory engineers & genuine spares</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Page Footer -->
    <div class="page-footer">
      <span>Brothers Furniture &bull; Technical Product Specifications &bull; Ambattur Industrial Estate Plant</span>
      <span>Document Ref: <strong>${proposal.proposalNumber}</strong> &bull; Page ${pageNumber} of ${totalPages}</span>
    </div>
  </div>
      `
    })
    .join('')}

  <!-- ========================================================
       PRODUCT SPECIFICATION TABLE (PAGES AFTER SHOWCASE)
       ======================================================== -->
  ${itemPages
    .map((pageItems, pageIdx) => {
      const pageNumber = 2 + showcaseCount + pageIdx
      const isFinalPage = pageIdx === itemPages.length - 1
      const itemOffset = itemPages
        .slice(0, pageIdx)
        .reduce((sum, chunk) => sum + chunk.length, 0)

      return `
  <div class="page content-page">
    <div class="header-bar">
        <div class="header-logo">
          <div class="header-logo-badge">BF</div>
          <div>
            <div class="header-logo-title">BROTHERS FURNITURE</div>
            <div class="header-logo-sub">
              ${
                itemPages.length > 1
                  ? `Product Scope & Commercial Bill of Materials (Part ${pageIdx + 1} of ${itemPages.length})`
                  : 'Product Scope & Commercial Bill of Materials'
              }
            </div>
          </div>
        </div>
        <div class="header-meta">
          <strong>${proposal.proposalNumber}</strong>
          <span>Issued: ${issueDate}</span>
        </div>
      </div>

      <div class="scope-banner">
        <div>
          <div class="scope-title-label">Scope of Supply</div>
          <div class="scope-title-val">${proposal.title || 'Commercial Office Furniture Scope'}</div>
        </div>
        <div class="scope-badge">
          Client: ${proposal.preparedFor || proposal.customerName || 'Enterprise Order'}
        </div>
      </div>

      <!-- PRODUCT TABLE WITH EMBEDDED IMAGES -->
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th class="col-idx">#</th>
              <th class="col-img">Product Image</th>
              <th>Product Details & Technical Specifications</th>
              <th class="col-qty">Qty</th>
              <th class="col-rate">Unit Rate (₹)</th>
              <th class="col-total">Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${pageItems
              .map((item, idx) => {
                const itemImgUri = resolveImageAsDataUri(item.image)
                return `
              <tr>
                <td class="col-idx">${itemOffset + idx + 1}</td>
                <td class="col-img">
                  ${
                    itemImgUri
                      ? `<img src="${itemImgUri}" class="product-thumb" alt="${item.name}" />`
                      : `<div class="product-thumb-placeholder">BF</div>`
                  }
                </td>
                <td>
                  <div class="product-name">${item.name}</div>
                  <div class="product-meta">
                    <span class="product-tag">${item.category || 'Furniture'}</span>
                    ${item.subCategory ? `<span class="product-tag">${item.subCategory}</span>` : ''}
                    ${item.material ? `<span>&bull; ${item.material}</span>` : ''}
                    ${item.dimensions ? `<span>&bull; ${item.dimensions}</span>` : ''}
                  </div>
                  ${item.notes ? `<div style="font-size: 8.5px; color: #94a3b8; margin-top: 2px;">${item.notes}</div>` : ''}
                </td>
                <td class="col-qty">${item.quantity}</td>
                <td class="col-rate">₹${Number(item.unitPrice || 0).toLocaleString('en-IN')}</td>
                <td class="col-total">
                  <div>₹${Number(item.total || (item.quantity * item.unitPrice - (item.discountAmount || 0)) || 0).toLocaleString('en-IN')}</div>
                  ${
                    (item.discountPercent || 0) > 0 || (item.discountAmount || 0) > 0
                      ? `<div style="font-size: 8px; font-weight: 700; color: #059669; font-family: 'Plus Jakarta Sans', sans-serif; margin-top: 1px;">
                          ${item.discountPercent ? `${item.discountPercent}% OFF` : `-₹${Number(item.discountAmount).toLocaleString('en-IN')}`}
                        </div>`
                      : ''
                  }
                </td>
              </tr>
            `
              })
              .join('')}
          </tbody>
        </table>
      </div>

      ${
        isFinalPage
          ? `
      <!-- FINANCIAL TOTALS STRIP (FINAL TABLE PAGE) -->
      <div class="table-totals-wrapper">
        <div class="totals-box">
          <div>
            <div class="total-row">
              <span>Subtotal (${proposal.items.reduce((s, i) => s + (i.quantity || 1), 0)} units)</span>
              <span>₹${subtotal.toLocaleString('en-IN')}</span>
            </div>
            ${
              discountAmount > 0
                ? `
            <div class="total-row" style="color: #059669;">
              <span>Project Discount</span>
              <span>-₹${discountAmount.toLocaleString('en-IN')}</span>
            </div>`
                : ''
            }
            <div class="total-row">
              <span>GST (18% Ambattur Standard)</span>
              <span>₹${gstAmount.toLocaleString('en-IN')}</span>
            </div>
            <div class="total-row">
              <span>Factory Freight & On-Site Installation</span>
              <span style="color: #059669; font-weight: 700;">${deliveryFee > 0 ? `₹${deliveryFee.toLocaleString('en-IN')}` : 'Included (Complimentary)'}</span>
            </div>
          </div>

          <div class="total-row grand">
            <span>Grand Total</span>
            <span class="amount">₹${grandTotal.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>
      `
          : ''
      }

    <div class="page-footer">
      <span>Brothers Furniture &bull; Ambattur Industrial Estate Plant, Chennai</span>
      <span>Document Ref: <strong>${proposal.proposalNumber}</strong> &bull; Page ${pageNumber} of ${totalPages}</span>
    </div>
  </div>
  `
    })
    .join('')}

  <!-- ========================================================
       FINAL PAGE: ABOUT US (DEDICATED FULL-PAGE FACTORY PROFILE)
       ======================================================== -->
  <div class="page about-page">
    <div class="about-header">
        <div class="about-logo-group">
          <div class="about-logo-badge">BF</div>
          <div>
            <div class="about-logo-title">BROTHERS FURNITURE</div>
            <div class="about-logo-sub">Commercial Fit-Outs &bull; Ambattur Industrial Estate Plant, Chennai</div>
          </div>
        </div>
        <div class="about-header-meta">
          <strong>${proposal.proposalNumber}</strong>
          <span>Issued: ${issueDate}</span>
        </div>
      </div>

      <div class="about-hero">
        <div class="about-hero-tag">ABOUT US</div>
        <h2 class="about-hero-title">Engineering High-Performance Commercial Workspaces</h2>
        <p class="about-hero-desc">
          Headquartered in Ambattur Industrial Estate, Chennai, <strong>Brothers Furniture</strong> is an integrated designer and manufacturer of commercial-grade ergonomic chairs, executive workstations, and turnkey corporate interior furniture. Combining precision fabrication, ergonomic health engineering, and a direct-to-enterprise supply model, we equip modern enterprises with furniture built for comfort, endurance, and productivity.
        </p>
      </div>

      <!-- 4 STATS CARDS -->
      <div class="about-stats-grid">
        <div class="stat-card">
          <div class="stat-num">25,000+</div>
          <div class="stat-label">Sq.Ft Factory</div>
          <div class="stat-sub">Ambattur Industrial Estate</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">50,000+</div>
          <div class="stat-label">Units Fabricated</div>
          <div class="stat-sub">For Corporate Enterprises</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">150+</div>
          <div class="stat-label">Corporate Clients</div>
          <div class="stat-sub">IT, Banking & Healthcare</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">3 - 5 Years</div>
          <div class="stat-label">Comprehensive Warranty</div>
          <div class="stat-sub">Factory Direct Support</div>
        </div>
      </div>

      <!-- 4 PILLARS -->
      <div class="about-pillars-grid">
        <div class="pillar-card">
          <div class="pillar-header">
            <div class="pillar-num">01</div>
            <div class="pillar-title">In-House Manufacturing Prowess</div>
          </div>
          <p class="pillar-desc">
            Equipped with CNC tube benders, automated robotic welding systems, electrostatic powder coating booths, and high-density cold-cure foam moulds for zero-tolerance consistency.
          </p>
        </div>

        <div class="pillar-card">
          <div class="pillar-header">
            <div class="pillar-num">02</div>
            <div class="pillar-title">Ergonomic Science & BIFMA Testing</div>
          </div>
          <p class="pillar-desc">
            Engineered to ANSI/BIFMA X5.1 international commercial durability guidelines. Features Class-4 heavy-duty pneumatic gas lifts, high-tensile breathable mesh, and multi-lock synchronized tilt.
          </p>
        </div>

        <div class="pillar-card">
          <div class="pillar-header">
            <div class="pillar-num">03</div>
            <div class="pillar-title">Direct Plant-to-Enterprise Pricing</div>
          </div>
          <p class="pillar-desc">
            By eliminating distributor intermediaries and third-party margins, Brothers Furniture provides substantial cost savings, customizable material finishes, and dedicated project management.
          </p>
        </div>

        <div class="pillar-card">
          <div class="pillar-header">
            <div class="pillar-num">04</div>
            <div class="pillar-title">Factory Logistics & Lifetime Service</div>
          </div>
          <p class="pillar-desc">
            White-glove delivery, direct on-site assembly by factory technicians, guaranteed spare-parts availability for 7+ years, and rapid 48-hour service turnaround across Chennai.
          </p>
        </div>
      </div>

      <!-- MANUFACTURING PROCESS LIFECYCLE -->
      <div class="process-section">
        <div class="process-header-title">THE BROTHERS FURNITURE MANUFACTURING LIFECYCLE</div>
        <div class="process-steps">
          <div class="process-step">
            <div class="process-circle">1</div>
            <div class="process-name">CAD & Design</div>
            <div class="process-sub">Ergonomic modeling</div>
          </div>
          <div class="process-arrow">→</div>
          <div class="process-step">
            <div class="process-circle">2</div>
            <div class="process-name">Precision Assembly</div>
            <div class="process-sub">Welding & cold foam</div>
          </div>
          <div class="process-arrow">→</div>
          <div class="process-step">
            <div class="process-circle">3</div>
            <div class="process-name">BIFMA Quality Test</div>
            <div class="process-sub">100k cycle load stress</div>
          </div>
          <div class="process-arrow">→</div>
          <div class="process-step">
            <div class="process-circle">4</div>
            <div class="process-name">Turnkey Handover</div>
            <div class="process-sub">Direct factory delivery</div>
          </div>
        </div>
      </div>

      <!-- PLANT FOOTER CARD -->
      <div class="about-footer-card">
        <div>
          <strong>FACTORY & WORKSHOP:</strong> Ambattur Industrial Estate, Chennai – 600058, Tamil Nadu
        </div>
        <div>
          <strong>CONTACT:</strong> +91 97907 40027 &bull; sales@brothersfurniture.in
        </div>
      </div>

      <div class="about-page-footer">
      <span>Brothers Furniture Corporate Profile</span>
      <span>Page ${aboutUsPageNumber} of ${totalPages}</span>
    </div>
  </div>

  <!-- ========================================================
       PAGE ${totalPages}: FACTORY TERMS, STANDARD WARRANTY & SIGN-OFF
       Strictly placed after About Us as the final page
       ======================================================== -->
  <div class="page terms-page">
    <div class="about-header" style="margin-bottom: 18px;">
        <div class="about-logo-group">
          <div class="about-logo-badge">BF</div>
          <div>
            <div class="about-logo-title">BROTHERS FURNITURE</div>
            <div class="about-logo-sub">Commercial Fit-Outs &bull; Ambattur Industrial Estate Plant, Chennai</div>
          </div>
        </div>
        <div class="about-header-meta">
          <strong>${proposal.proposalNumber}</strong>
          <span>Issued: ${issueDate}</span>
        </div>
      </div>

      <div class="terms-hero">
        <div class="terms-hero-tag">Commercial Fit-Outs &bull; Factory Direct SLA</div>
        <h2 class="terms-hero-title">FACTORY TERMS &amp; STANDARD WARRANTY</h2>
        <div class="terms-hero-desc">
          Official manufacturing covenants, institutional endurance guarantees, and lifecycle support commitments governing this commercial supply order from Brothers Furniture Ambattur Plant.
        </div>
      </div>

      <div class="terms-pillars-grid">
        <div class="terms-item-card">
          <div class="terms-item-title">
            <span>&#9670;</span> ANSI/BIFMA X5.1 CERTIFIED
          </div>
          <div class="terms-item-desc">
            Components undergo 100,000+ cycle fatigue tests, drop impact tests, and multi-angle stress evaluations. 100% cold-cure high-resilience foam and breathable tensile mesh.
          </div>
        </div>

        <div class="terms-item-card">
          <div class="terms-item-title">
            <span>&#9670;</span> 5-YEAR FACTORY WARRANTY
          </div>
          <div class="terms-item-desc">
            Direct replacement &amp; repair warranty covering pneumatic class-4 gas lift cylinders, heavy-duty synchronized tilt-lock mechanisms, nylon bases, and structural frames.
          </div>
        </div>

        <div class="terms-item-card">
          <div class="terms-item-title">
            <span>&#9670;</span> COMMERCIAL PAYMENT SCHEDULE
          </div>
          <div class="terms-item-desc">
            50% advance upon formal purchase order sign-off; 40% against dispatch intimation / pre-delivery inspection; balance 10% post-turnkey handover &amp; fit-out sign-off.
          </div>
        </div>

        <div class="terms-item-card">
          <div class="terms-item-title">
            <span>&#9670;</span> WHITE-GLOVE SITE COMMISSIONING
          </div>
          <div class="terms-item-desc">
            Direct plant-supervised dispatch, careful on-site assembly, ergonomic calibration for workstations, and unboxing debris clearance handled by certified technicians.
          </div>
        </div>

        <div class="terms-item-card">
          <div class="terms-item-title">
            <span>&#9670;</span> RAPID ONSITE FIELD SLA
          </div>
          <div class="terms-item-desc">
            Direct manufacturer helpline with on-site technician visit within 24 to 48 business hours across Chennai and surrounding industrial corridors for all service requests.
          </div>
        </div>

        <div class="terms-item-card">
          <div class="terms-item-title">
            <span>&#9670;</span> PRODUCTION &amp; DISPATCH TIMELINE
          </div>
          <div class="terms-item-desc">
            Custom manufacturing schedule: 7 to 14 business days from technical specification freeze and deposit clearance. Standard transit insurance included to destination.
          </div>
        </div>
      </div>

      <!-- FACTORY COMMERCIAL ASSURANCE BANNER -->
      <div class="terms-assurance-banner">
        <div class="terms-assurance-icon">&#9670;</div>
        <div>
          <strong>Institutional Warranty Covenant:</strong> All workstations, ergonomic seating, and architectural fit-outs fabricated at our Ambattur Industrial Estate Plant carry direct factory warranty against structural, mechanical, and hydraulic fatigue. Issuance of a Purchase Order confirms acceptance of the specifications, warranty terms, and handover schedule outlined herein.
        </div>
      </div>

      <!-- FORMAL CONTRACTUAL AUTHORIZATION & ACCEPTANCE -->
      <div class="terms-final-signoff">
        <div>
          <div class="signoff-label">PREPARED &amp; AUTHORIZED BY:</div>
          <div class="signoff-org">Brothers Furniture Commercial Plant</div>
          <div class="signoff-sub">Ambattur Industrial Estate, Chennai – 600058</div>
          <div class="signoff-line"></div>
          <div class="signoff-name">Authorized Factory Representative / Commercial Lead</div>
        </div>

        <div>
          <div class="signoff-label">ACCEPTED &amp; CONFIRMED BY:</div>
          <div class="signoff-org">${proposal.preparedFor || proposal.customerName || proposal.companyName || 'Enterprise Client'}</div>
          <div class="signoff-sub">${[proposal.clientPhone || proposal.phone, proposal.clientAddress || proposal.deliveryAddress].filter(Boolean).join(' • ') || 'Commercial Purchasing Authority'}</div>
          <div class="signoff-line"></div>
          <div class="signoff-name">Authorized Client Signatory (Seal &amp; Signature)</div>
        </div>
      </div>

      <div class="about-page-footer">
      <span>Brothers Furniture &bull; Ambattur Plant &bull; Terms of Supply &amp; Warranty</span>
      <span>Page ${totalPages} of ${totalPages}</span>
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
