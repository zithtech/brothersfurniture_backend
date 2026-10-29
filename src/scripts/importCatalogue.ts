import { pool } from '../db/pool.js'
import { syncEvents } from '../utils/syncEvents.js'
import { catalogues } from '../../../brothersfurniture/src/data/catalogues.js'

interface CategoryConfig {
  prefix: string
  basePrice: number
  priceRange: number
  material: string
  dimensions: string
}

const configMap: Record<string, CategoryConfig> = {
  Workstations: {
    prefix: 'BF-WS',
    basePrice: 42000,
    priceRange: 85000,
    material: 'Engineered Wood, Powder-Coated Steel Frame, Acoustic Fabric Screen',
    dimensions: 'W 140-280 × D 60-120 × H 75-120 cm',
  },
  'Office Chairs': {
    prefix: 'BF-CH',
    basePrice: 12500,
    priceRange: 14000,
    material: 'Breathable High-Tensile Mesh, High-Density Moulded PU Foam, Nylon/Aluminium Base',
    dimensions: 'W 64 × D 62 × H 98–128 cm',
  },
  Desks: {
    prefix: 'BF-DK',
    basePrice: 32000,
    priceRange: 45000,
    material: 'Commercial Melamine Faced Board, Solid Wood Edge, Steel Leg Base',
    dimensions: 'W 140-180 × D 70-90 × H 75 cm',
  },
  'Meeting Tables': {
    prefix: 'BF-TB',
    basePrice: 45000,
    priceRange: 120000,
    material: 'Commercial Laminate Top, Integrated Cable Raceway, Heavy Gauge Steel Pedestals',
    dimensions: 'W 180-360 × D 90-140 × H 75 cm',
  },
  Storage: {
    prefix: 'BF-ST',
    basePrice: 18000,
    priceRange: 24000,
    material: 'Cold Rolled Steel, Epoxy Powder Coating, Central Lock System',
    dimensions: 'W 40-120 × D 45-50 × H 65-180 cm',
  },
  Lounge: {
    prefix: 'BF-LG',
    basePrice: 8500,
    priceRange: 28000,
    material: 'Perforated Steel Beam, Moulded Polymer Shell / Wool-Blend Upholstery',
    dimensions: 'W 65-240 × D 65 × H 80 cm',
  },
}

async function importAll() {
  console.log('--- Starting Catalogue Import to PostgreSQL ---')
  const existingRes = await pool.query('SELECT id, sku FROM products')
  const existingIds = new Set(existingRes.rows.map((r) => r.id))
  const existingSkus = new Set(existingRes.rows.map((r) => r.sku))

  let insertedCount = 0
  let updatedCount = 0
  let skuCounter = 101

  for (const [categoryName, def] of Object.entries(catalogues)) {
    const cfg = configMap[categoryName] || {
      prefix: 'BF-GEN',
      basePrice: 15000,
      priceRange: 20000,
      material: 'Commercial Grade Materials',
      dimensions: 'Standard B2B Sizing',
    }

    console.log(`Processing category: ${categoryName} (${def.items.length} items)...`)

    for (let i = 0; i < def.items.length; i++) {
      const item = def.items[i]
      const isNew = !existingIds.has(item.id)

      // Generate unique SKU if new
      let sku = `BF-${cfg.prefix.slice(3)}-${101 + i}`
      while (existingSkus.has(sku)) {
        sku = `${cfg.prefix}-${++skuCounter}`
      }
      existingSkus.add(sku)

      // Calculate pseudo-deterministic price based on name hash
      const hash = item.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
      const priceVariation = (hash % 10) / 10
      const price = Math.round((cfg.basePrice + cfg.priceRange * priceVariation) / 100) * 100
      const oldPrice = hash % 3 === 0 ? Math.round((price * 1.15) / 100) * 100 : null
      const rating = parseFloat((4.4 + ((hash % 6) * 0.1)).toFixed(1))

      // Description
      const desc = item.blurb
        ? `${item.blurb} Highlights: ${(item.features || []).join('; ')}.`
        : `Commercial-grade ${item.name} manufactured in Chennai.`

      const queryStr = `
        INSERT INTO products (
          id, sku, name, category, price, old_price, rating, image, cutout,
          description, material, dimensions, in_stock, featured, stock_count,
          min_order_quantity, updated_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          image = EXCLUDED.image,
          cutout = EXCLUDED.cutout,
          description = COALESCE(products.description, EXCLUDED.description),
          material = COALESCE(products.material, EXCLUDED.material),
          dimensions = COALESCE(products.dimensions, EXCLUDED.dimensions),
          updated_at = NOW()
        RETURNING id
      `

      const values = [
        item.id,
        sku,
        item.name,
        categoryName,
        price,
        oldPrice,
        rating,
        item.src,
        item.fit === 'contain',
        desc,
        cfg.material,
        cfg.dimensions,
        true,
        i < 2, // feature first two of each category
        15 + (hash % 20),
        1,
      ]

      await pool.query(queryStr, values)

      if (isNew) {
        insertedCount++
      } else {
        updatedCount++
      }
    }
  }

  const finalRes = await pool.query('SELECT count(*) FROM products')
  const totalInDb = parseInt(finalRes.rows[0].count, 10)

  console.log('--- Catalogue Import Complete ---')
  console.log(`Newly Inserted: ${insertedCount}`)
  console.log(`Updated Existing: ${updatedCount}`)
  console.log(`Total Products in Database: ${totalInDb}`)

  // Broadcast real-time sync event to all active landing page & admin sessions
  syncEvents.notify('products', 'update')

  await pool.end()
}

importAll().catch((err) => {
  console.error('Import failed:', err)
  process.exit(1)
})
