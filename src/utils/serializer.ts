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

export function mapCustomerContact(row: any) {
  if (!row) return null
  return {
    id: row.id,
    customerId: row.customer_id,
    name: row.name,
    designation: row.designation,
    email: row.email,
    phone: row.phone,
    isPrimary: Boolean(row.is_primary),
    department: row.department,
    notes: row.notes,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  }
}

export function mapCustomerAddress(row: any) {
  if (!row) return null
  return {
    id: row.id,
    customerId: row.customer_id,
    addressType: row.address_type,
    isDefault: Boolean(row.is_default),
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    country: row.country || 'India',
    pinCode: row.pin_code,
    mapLocation: row.map_location,
    latitude: row.latitude ? parseFloat(row.latitude) : null,
    longitude: row.longitude ? parseFloat(row.longitude) : null,
    landmark: row.landmark,
    contactPerson: row.contact_person,
    contactPhone: row.contact_phone,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  }
}

export function mapCustomerNote(row: any) {
  if (!row) return null
  return {
    id: row.id,
    customerId: row.customer_id,
    note: row.note,
    category: row.category || 'General',
    authorName: row.author_name || 'Admin',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  }
}

export function mapCustomerActivityLog(row: any) {
  if (!row) return null
  return {
    id: row.id,
    customerId: row.customer_id,
    action: row.action,
    description: row.description,
    actorName: row.actor_name || 'Admin',
    metadata: typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata || '{}'),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  }
}

export function mapCustomer(row: any, extra?: { contacts?: any[]; addresses?: any[]; notes?: any[]; activityLogs?: any[]; orders?: any[] }) {
  if (!row) return null
  return {
    id: row.id,
    customerCode: row.customer_code,
    companyName: row.company_name,
    companyPhone: row.company_phone,
    companyEmail: row.company_email,
    gstNumber: row.gst_number,
    websiteUrl: row.website_url,
    companySize: row.company_size || 'Medium',
    category: row.category || 'Corporate',
    status: row.status || 'active',
    customerType: row.customer_type || 'B2B',
    gstType: row.gst_type || 'Regular',
    paymentTerms: row.payment_terms || 'Net 30',
    creditLimit: row.credit_limit ? parseFloat(row.credit_limit) : 0,
    customerSource: row.customer_source || 'Direct',
    accountManager: row.account_manager,
    internalNotes: row.internal_notes,
    internalRemarks: row.internal_remarks,
    createdBy: row.created_by || 'Admin',
    updatedBy: row.updated_by || 'Admin',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,

    // Primary contact summary for list view
    primaryContact: row.primary_contact_name
      ? {
          name: row.primary_contact_name,
          designation: row.primary_contact_designation,
          phone: row.primary_contact_phone,
          email: row.primary_contact_email,
        }
      : undefined,

    // Primary address summary for list view
    primaryAddress: row.primary_city
      ? {
          city: row.primary_city,
          state: row.primary_state,
          country: row.primary_country,
          pinCode: row.primary_pin_code,
          addressLine1: row.primary_address_line1,
          mapLocation: row.primary_map_location,
        }
      : undefined,

    // Detailed relation arrays
    contacts: extra?.contacts ? extra.contacts.map(mapCustomerContact).filter(Boolean) : undefined,
    addresses: extra?.addresses ? extra.addresses.map(mapCustomerAddress).filter(Boolean) : undefined,
    notes: extra?.notes ? extra.notes.map(mapCustomerNote).filter(Boolean) : undefined,
    activityLogs: extra?.activityLogs ? extra.activityLogs.map(mapCustomerActivityLog).filter(Boolean) : undefined,
    orders: extra?.orders || undefined,
  }
}
