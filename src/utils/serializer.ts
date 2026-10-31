export function mapProduct(row: any, imagesList?: any) {
  if (!row) return null

  // Ensure imagesList is an array, not an index number from Array.prototype.map
  const safeImagesList = Array.isArray(imagesList) ? imagesList : undefined

  // Resolve images: if imagesList provided, use it; otherwise synthesize from primary image
  let images: any[] = []
  if (safeImagesList && safeImagesList.length > 0) {
    images = safeImagesList.map((img: any) => ({
      id: img.id,
      productId: img.product_id || row.id,
      url: img.url,
      r2Key: img.r2_key || undefined,
      sortOrder: img.sort_order ?? 0,
      isPrimary: img.is_primary ?? false,
      createdAt: img.created_at ? new Date(img.created_at).toISOString() : undefined,
    }))
  } else if (row.images) {
    const rawImgs = Array.isArray(row.images) ? row.images : (typeof row.images === 'string' ? JSON.parse(row.images) : [])
    images = rawImgs.map((img: any) => ({
      id: img.id,
      productId: img.product_id || row.id,
      url: img.url,
      r2Key: img.r2_key || undefined,
      sortOrder: img.sort_order ?? 0,
      isPrimary: img.is_primary ?? false,
    }))
  }

  // Fallback to primary image if no secondary images
  if (images.length === 0 && row.image) {
    images = [
      {
        id: `${row.id}-primary`,
        productId: row.id,
        url: row.image,
        r2Key: row.r2_key || undefined,
        sortOrder: 0,
        isPrimary: true,
      },
    ]
  }

  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    type: row.type || undefined,
    category: row.category,
    subCategory: row.sub_category || undefined,
    price: parseFloat(row.price),
    oldPrice: row.old_price != null ? parseFloat(row.old_price) : undefined,
    rating: parseFloat(row.rating),
    image: row.image,
    r2Key: row.r2_key || undefined,
    images,
    cutout: row.cutout,
    description: row.description,
    material: row.material,
    dimensions: row.dimensions,
    inStock: row.in_stock,
    featured: row.featured,
    stockCount: parseInt(row.stock_count, 10),
    minOrderQuantity: parseInt(row.min_order_quantity, 10),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  }
}

export function mapChair(row: any) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    image: row.image,
    features: Array.isArray(row.features) ? row.features : (typeof row.features === 'string' ? JSON.parse(row.features) : []),
    inProduction: row.in_production,
    basePrice: row.base_price != null ? parseFloat(row.base_price) : 0,
  }
}

export function mapLead(row: any) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    subject: row.subject,
    message: row.message,
    status: row.status,
    priority: row.priority,
    estimatedValue: row.estimated_value != null ? parseFloat(row.estimated_value) : undefined,
    notes: row.notes,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    lastContactedAt: row.last_contacted_at ? new Date(row.last_contacted_at).toISOString() : undefined,
  }
}

export function mapOrder(row: any) {
  if (!row) return null
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    companyName: row.company_name,
    phone: row.phone,
    email: row.email,
    items: Array.isArray(row.items) ? row.items : (typeof row.items === 'string' ? JSON.parse(row.items) : []),
    subtotal: parseFloat(row.subtotal),
    deliveryFee: parseFloat(row.delivery_fee),
    total: parseFloat(row.total),
    status: row.status,
    paymentStatus: row.payment_status,
    deliveryAddress: row.delivery_address,
    targetDeliveryDate: row.target_delivery_date,
    notes: row.notes,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  }
}

export function mapClient(row: any) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    logo: row.logo,
    sector: row.sector,
    featured: row.featured,
  }
}

export function mapTestimonial(row: any) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    company: row.company,
    quote: row.quote,
    rating: parseInt(row.rating, 10),
    approved: row.approved,
    featured: row.featured,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  }
}

export function mapSettings(row: any) {
  if (!row) return null
  return {
    name: row.name,
    addressLines: Array.isArray(row.address_lines) ? row.address_lines : (typeof row.address_lines === 'string' ? JSON.parse(row.address_lines) : []),
    phones: Array.isArray(row.phones) ? row.phones : (typeof row.phones === 'string' ? JSON.parse(row.phones) : []),
    email: row.email,
    whatsapp: typeof row.whatsapp === 'object' ? row.whatsapp : JSON.parse(row.whatsapp || '{}'),
    map: typeof row.map === 'object' ? row.map : JSON.parse(row.map || '{}'),
    gstin: row.gstin,
    factoryLocation: row.factory_location,
    freeDeliveryThreshold: parseFloat(row.free_delivery_threshold),
    standardDeliveryFee: parseFloat(row.standard_delivery_fee),
    bannerAnnouncement: row.banner_announcement,
    isBannerActive: row.is_banner_active,
    bankAccounts: Array.isArray(row.bank_accounts) ? row.bank_accounts : (typeof row.bank_accounts === 'string' ? JSON.parse(row.bank_accounts) : []),
    signatureUrl: row.signature_url || undefined,
  }
}

export function mapProposal(row: any) {
  if (!row) return null
  const subtotal = parseFloat(row.subtotal || 0)
  const discountAmount = parseFloat(row.discount_amount || 0)
  const deliveryFee = parseFloat(row.delivery_fee || 0)
  const taxAmount = Math.max(0, Math.round((subtotal - discountAmount) * 0.18))
  const total = parseFloat(row.total || (subtotal - discountAmount + deliveryFee + taxAmount))

  return {
    id: row.id,
    proposalNumber: row.proposal_number,
    title: row.title || 'Commercial Fit-Out Scope',
    preparedFor: row.prepared_for || row.customer_name || '',
    customerName: row.customer_name || row.prepared_for || '',
    companyName: row.company_name || undefined,
    phone: row.phone || row.client_phone || '',
    clientPhone: row.client_phone || row.phone || '',
    email: row.email || '',
    clientGstin: row.client_gstin || undefined,
    deliveryAddress: row.delivery_address || row.client_address || '',
    clientAddress: row.client_address || row.delivery_address || '',
    status: row.status || 'draft',
    validUntil: row.valid_until || 'Within 30 Days',
    items: Array.isArray(row.items) ? row.items : (typeof row.items === 'string' ? JSON.parse(row.items) : []),
    subtotal,
    discountAmount,
    deliveryFee,
    taxRate: 18,
    taxAmount,
    total,
    terms: row.terms || undefined,
    notes: row.notes || undefined,
    pdfUrl: row.pdf_url || undefined,
    r2Key: row.r2_key || undefined,
    convertedInvoiceId: row.converted_invoice_id || undefined,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  }
}

export function mapInvoice(row: any) {
  if (!row) return null
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    proposalRef: row.proposal_ref || undefined,
    customerName: row.customer_name,
    companyName: row.company_name || undefined,
    phone: row.phone,
    email: row.email,
    clientGstin: row.client_gstin || undefined,
    billingAddress: row.billing_address,
    shippingAddress: row.shipping_address,
    poNumber: row.po_number || undefined,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    status: row.status,
    items: Array.isArray(row.items) ? row.items : (typeof row.items === 'string' ? JSON.parse(row.items) : []),
    subtotal: parseFloat(row.subtotal || 0),
    discountAmount: parseFloat(row.discount_amount || 0),
    deliveryFee: parseFloat(row.delivery_fee || 0),
    cgstRate: parseFloat(row.cgst_rate || 9.0),
    cgstAmount: parseFloat(row.cgst_amount || 0),
    sgstRate: parseFloat(row.sgst_rate || 9.0),
    sgstAmount: parseFloat(row.sgst_amount || 0),
    taxAmount: parseFloat(row.tax_amount || 0),
    total: parseFloat(row.total || 0),
    amountPaid: parseFloat(row.amount_paid || 0),
    balanceDue: parseFloat(row.balance_due || 0),
    paymentRecords: Array.isArray(row.payment_records) ? row.payment_records : (typeof row.payment_records === 'string' ? JSON.parse(row.payment_records) : []),
    notes: row.notes || undefined,
    pdfUrl: row.pdf_url || undefined,
    r2Key: row.r2_key || undefined,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  }
}

