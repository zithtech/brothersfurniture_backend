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
  }
}
