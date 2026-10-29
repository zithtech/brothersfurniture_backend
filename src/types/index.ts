export type Category = 
  | 'Workstations' 
  | 'Office Chairs' 
  | 'Desks' 
  | 'Meeting Tables' 
  | 'Storage' 
  | 'Lounge' 
  | (string & {})

export interface ProductImage {
  id: string
  productId?: string
  url: string
  r2Key?: string
  sortOrder: number
  isPrimary: boolean
  createdAt?: string
}

export interface Product {
  id: string
  sku: string
  name: string
  type?: string
  category: Category
  subCategory?: string
  price: number
  oldPrice?: number
  rating: number
  image: string
  r2Key?: string
  images?: ProductImage[]
  cutout?: boolean
  description: string
  material: string
  dimensions: string
  inStock: boolean
  featured?: boolean
  stockCount: number
  minOrderQuantity: number
  updatedAt: string
}

export type ChairType = 'high-back' | 'medium-back' | 'mesh-seat' | 'visitor'

export interface ErgonomicChairModel {
  id: string
  name: string
  type: ChairType
  image: string
  features: string[]
  inProduction: boolean
  basePrice?: number
}

export type LeadStatus = 'new' | 'contacted' | 'quoted' | 'site-visit' | 'won' | 'lost'
export type LeadPriority = 'urgent' | 'high' | 'medium' | 'low'
export type InquiryType = 'General inquiry' | 'Office fit-out / bulk quote' | 'Space planning' | 'Delivery & returns'

export interface Lead {
  id: string
  name: string
  phone: string
  email: string
  subject: InquiryType
  message: string
  status: LeadStatus
  priority: LeadPriority
  estimatedValue?: number
  notes?: string
  createdAt: string
  lastContactedAt?: string
}

export type OrderStatus = 'pending' | 'in_production' | 'ready_for_dispatch' | 'dispatched' | 'delivered' | 'cancelled'
export type PaymentStatus = 'paid' | 'advance_received' | 'pending'

export interface OrderItem {
  productId: string
  name: string
  quantity: number
  unitPrice: number
  category: Category
}

export interface Order {
  id: string
  orderNumber: string
  customerName: string
  companyName?: string
  phone: string
  email: string
  items: OrderItem[]
  subtotal: number
  deliveryFee: number
  total: number
  status: OrderStatus
  paymentStatus: PaymentStatus
  deliveryAddress: string
  createdAt: string
  targetDeliveryDate?: string
  notes?: string
}

export interface ClientPartner {
  id: string
  name: string
  logo: string
  sector: string
  featured: boolean
}

export interface TestimonialReview {
  id: string
  name: string
  role: string
  company: string
  quote: string
  rating: number
  approved: boolean
  featured: boolean
  createdAt: string
}

export interface CompanySettings {
  name: string
  addressLines: string[]
  phones: { display: string; tel: string }[]
  email: string
  whatsapp: {
    number: string
    message: string
  }
  map: {
    embed: string
    link: string
  }
  gstin: string
  factoryLocation: string
  freeDeliveryThreshold: number
  standardDeliveryFee: number
  bannerAnnouncement: string
  isBannerActive: boolean
}
