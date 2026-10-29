import { fileURLToPath } from 'url'
import { pool } from './pool.js'
import {
  initialChairs,
  initialClients,
  initialLeads,
  initialOrders,
  initialProducts,
  initialSettings,
  initialTestimonials,
} from './seedData.js'

export async function seedDatabase() {
  console.log('Seeding PostgreSQL database: brothers_furniture...')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Seed Products
    for (const p of initialProducts) {
      await client.query(
        `INSERT INTO products (
          id, sku, name, category, price, old_price, rating, image, cutout,
          description, material, dimensions, in_stock, featured, stock_count,
          min_order_quantity, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO UPDATE SET
          sku = EXCLUDED.sku,
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          price = EXCLUDED.price,
          old_price = EXCLUDED.old_price,
          rating = EXCLUDED.rating,
          image = EXCLUDED.image,
          cutout = EXCLUDED.cutout,
          description = EXCLUDED.description,
          material = EXCLUDED.material,
          dimensions = EXCLUDED.dimensions,
          in_stock = EXCLUDED.in_stock,
          featured = EXCLUDED.featured,
          stock_count = EXCLUDED.stock_count,
          min_order_quantity = EXCLUDED.min_order_quantity,
          updated_at = EXCLUDED.updated_at`,
        [
          p.id,
          p.sku,
          p.name,
          p.category,
          p.price,
          p.oldPrice || null,
          p.rating,
          p.image,
          p.cutout ?? false,
          p.description || null,
          p.material || null,
          p.dimensions || null,
          p.inStock,
          p.featured ?? false,
          p.stockCount ?? 10,
          p.minOrderQuantity ?? 1,
          p.updatedAt || new Date().toISOString(),
        ]
      )
    }
    console.log(`✓ Seeded ${initialProducts.length} products`)

    // 2. Seed Ergonomic Chairs
    for (const c of initialChairs) {
      await client.query(
        `INSERT INTO ergonomic_chairs (
          id, name, type, image, features, in_production, base_price, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          image = EXCLUDED.image,
          features = EXCLUDED.features,
          in_production = EXCLUDED.in_production,
          base_price = EXCLUDED.base_price,
          updated_at = NOW()`,
        [
          c.id,
          c.name,
          c.type,
          c.image,
          JSON.stringify(c.features || []),
          c.inProduction ?? true,
          c.basePrice ?? 0,
        ]
      )
    }
    console.log(`✓ Seeded ${initialChairs.length} ergonomic chairs`)

    // 3. Seed Corporate Clients
    for (const cl of initialClients) {
      await client.query(
        `INSERT INTO clients (id, name, logo, sector, featured)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          logo = EXCLUDED.logo,
          sector = EXCLUDED.sector,
          featured = EXCLUDED.featured`,
        [cl.id, cl.name, cl.logo, cl.sector, cl.featured]
      )
    }
    console.log(`✓ Seeded ${initialClients.length} corporate clients`)

    // 4. Seed Testimonials
    for (const t of initialTestimonials) {
      await client.query(
        `INSERT INTO testimonials (
          id, name, role, company, quote, rating, approved, featured, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          company = EXCLUDED.company,
          quote = EXCLUDED.quote,
          rating = EXCLUDED.rating,
          approved = EXCLUDED.approved,
          featured = EXCLUDED.featured`,
        [
          t.id,
          t.name,
          t.role,
          t.company,
          t.quote,
          t.rating,
          t.approved,
          t.featured,
          t.createdAt || new Date().toISOString(),
        ]
      )
    }
    console.log(`✓ Seeded ${initialTestimonials.length} testimonials`)

    // 5. Seed Company Settings
    await client.query(
      `INSERT INTO company_settings (
        id, name, address_lines, phones, email, whatsapp, map,
        gstin, factory_location, free_delivery_threshold, standard_delivery_fee,
        banner_announcement, is_banner_active, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        address_lines = EXCLUDED.address_lines,
        phones = EXCLUDED.phones,
        email = EXCLUDED.email,
        whatsapp = EXCLUDED.whatsapp,
        map = EXCLUDED.map,
        gstin = EXCLUDED.gstin,
        factory_location = EXCLUDED.factory_location,
        free_delivery_threshold = EXCLUDED.free_delivery_threshold,
        standard_delivery_fee = EXCLUDED.standard_delivery_fee,
        banner_announcement = EXCLUDED.banner_announcement,
        is_banner_active = EXCLUDED.is_banner_active,
        updated_at = NOW()`,
      [
        'default',
        initialSettings.name,
        JSON.stringify(initialSettings.addressLines),
        JSON.stringify(initialSettings.phones),
        initialSettings.email,
        JSON.stringify(initialSettings.whatsapp),
        JSON.stringify(initialSettings.map),
        initialSettings.gstin,
        initialSettings.factoryLocation,
        initialSettings.freeDeliveryThreshold,
        initialSettings.standardDeliveryFee,
        initialSettings.bannerAnnouncement,
        initialSettings.isBannerActive,
      ]
    )
    console.log(`✓ Seeded company settings`)

    // 6. Seed Leads
    for (const l of initialLeads) {
      await client.query(
        `INSERT INTO leads (
          id, name, phone, email, subject, message, status, priority, estimated_value, notes, created_at, last_contacted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          subject = EXCLUDED.subject,
          message = EXCLUDED.message,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          estimated_value = EXCLUDED.estimated_value,
          notes = EXCLUDED.notes,
          last_contacted_at = EXCLUDED.last_contacted_at`,
        [
          l.id,
          l.name,
          l.phone,
          l.email,
          l.subject,
          l.message,
          l.status,
          l.priority,
          l.estimatedValue || null,
          l.notes || null,
          l.createdAt || new Date().toISOString(),
          l.lastContactedAt || null,
        ]
      )
    }
    console.log(`✓ Seeded ${initialLeads.length} leads`)

    // 7. Seed Orders
    for (const o of initialOrders) {
      await client.query(
        `INSERT INTO orders (
          id, order_number, customer_name, company_name, phone, email, items,
          subtotal, delivery_fee, total, status, payment_status, delivery_address,
          target_delivery_date, notes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET
          order_number = EXCLUDED.order_number,
          customer_name = EXCLUDED.customer_name,
          company_name = EXCLUDED.company_name,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          items = EXCLUDED.items,
          subtotal = EXCLUDED.subtotal,
          delivery_fee = EXCLUDED.delivery_fee,
          total = EXCLUDED.total,
          status = EXCLUDED.status,
          payment_status = EXCLUDED.payment_status,
          delivery_address = EXCLUDED.delivery_address,
          target_delivery_date = EXCLUDED.target_delivery_date,
          notes = EXCLUDED.notes`,
        [
          o.id,
          o.orderNumber,
          o.customerName,
          o.companyName || null,
          o.phone,
          o.email,
          JSON.stringify(o.items),
          o.subtotal,
          o.deliveryFee,
          o.total,
          o.status,
          o.paymentStatus,
          o.deliveryAddress,
          o.targetDeliveryDate || null,
          o.notes || null,
          o.createdAt || new Date().toISOString(),
        ]
      )
    }
    console.log(`✓ Seeded ${initialOrders.length} orders`)

    await client.query('COMMIT')
    console.log('All Brothers Furniture datasets seeded successfully into PostgreSQL!')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Error during database seed:', error)
    throw error
  } finally {
    client.release()
  }
}

// Allow direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
