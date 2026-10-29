import { Router } from 'express'
import { pool } from '../db/pool.js'
import { mapProduct } from '../utils/serializer.js'
import { syncEvents } from '../utils/syncEvents.js'
import { deleteObjectFromR2 } from '../utils/r2Client.js'

export const productsRouter = Router()

function inferProductType(category?: string, explicitType?: string): string {
  if (explicitType && explicitType.trim()) return explicitType.trim()
  if (!category) return 'Others'
  const cat = category.toLowerCase()
  if (cat.includes('chair') || cat === 'lounge' || cat.includes('seating')) return 'Chairs'
  if (cat.includes('table') || cat.includes('desk')) return 'Tables'
  if (cat.includes('workstation') || cat.includes('cubicle')) return 'Workstations'
  if (cat.includes('storage') || cat.includes('cabinet') || cat.includes('pedestal')) return 'Storage'
  return 'Others'
}

// Helper to load multiple products with their images efficiently
async function attachImagesToProducts(productRows: any[]): Promise<any[]> {
  if (productRows.length === 0) return []

  const ids = productRows.map((r) => r.id)
  const imagesRes = await pool.query(
    'SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY sort_order ASC, created_at ASC',
    [ids]
  )

  const imagesMap: Record<string, any[]> = {}
  for (const img of imagesRes.rows) {
    if (!imagesMap[img.product_id]) {
      imagesMap[img.product_id] = []
    }
    imagesMap[img.product_id].push(img)
  }

  return productRows.map((row) => mapProduct(row, imagesMap[row.id]))
}

// 1. List products
productsRouter.get('/', async (req, res) => {
  try {
    const { type, category, subCategory, inStock, featured, search } = req.query
    const conditions: string[] = []
    const values: any[] = []

    if (type && type !== 'All') {
      values.push(type)
      conditions.push('type = $' + values.length)
    }

    if (category && category !== 'All') {
      values.push(category)
      conditions.push('category = $' + values.length)
    }

    if (subCategory && subCategory !== 'All') {
      values.push(subCategory)
      conditions.push('sub_category = $' + values.length)
    }

    if (inStock !== undefined) {
      values.push(inStock === 'true')
      conditions.push(`in_stock = $${values.length}`)
    }

    if (featured !== undefined) {
      values.push(featured === 'true')
      conditions.push(`featured = $${values.length}`)
    }

    if (search) {
      values.push(`%${search}%`)
      conditions.push(
        `(name ILIKE $${values.length} OR description ILIKE $${values.length} OR sku ILIKE $${values.length})`
      )
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const queryStr = `SELECT * FROM products ${whereClause} ORDER BY created_at DESC, id ASC`

    const result = await pool.query(queryStr, values)
    const productsWithImages = await attachImagesToProducts(result.rows)
    res.json(productsWithImages)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 2. Get single product
productsRouter.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const imagesRes = await pool.query(
      'SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, created_at ASC',
      [req.params.id]
    )

    res.json(mapProduct(result.rows[0], imagesRes.rows))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 3. Create product
productsRouter.post('/', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const p = req.body
    const finalType = inferProductType(p.category, p.type)
    const id =
      p.id ||
      p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString().slice(-4)
    const sku =
      p.sku ||
      `BF-${(p.category || 'PR').slice(0, 2).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`

    // Determine primary image and secondary images
    let primaryImageUrl = p.image || ''
    let primaryR2Key = p.r2Key || null
    const imagesList: any[] = Array.isArray(p.images) ? p.images : []

    if (imagesList.length > 0) {
      const primaryItem = imagesList.find((img: any) => img.isPrimary) || imagesList[0]
      if (primaryItem && primaryItem.url) {
        primaryImageUrl = primaryItem.url
        primaryR2Key = primaryItem.r2Key || primaryR2Key
      }
    }

    const queryStr = `
      INSERT INTO products (
        id, sku, name, type, category, sub_category, price, old_price, rating, image, r2_key, cutout,
        description, material, dimensions, in_stock, featured, stock_count,
        min_order_quantity, updated_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
      RETURNING *
    `
    const values = [
      id,
      sku,
      p.name,
      finalType,
      p.category,
      p.subCategory || null,
      p.price,
      p.oldPrice || null,
      p.rating || 5.0,
      primaryImageUrl,
      primaryR2Key,
      p.cutout ?? false,
      p.description || null,
      p.material || null,
      p.dimensions || null,
      p.inStock ?? true,
      p.featured ?? false,
      p.stockCount ?? 10,
      p.minOrderQuantity ?? 1,
    ]

    const result = await client.query(queryStr, values)
    const productRow = result.rows[0]

    // Insert into product_images table
    const savedImages: any[] = []
    if (imagesList.length > 0) {
      for (let i = 0; i < imagesList.length; i++) {
        const item = imagesList[i]
        const imgId = item.id || `img-${id}-${Date.now()}-${i}`
        const isPrimary = item.isPrimary ?? (i === 0)
        const sortOrder = item.sortOrder ?? i

        const imgRes = await client.query(
          `INSERT INTO product_images (id, product_id, url, r2_key, sort_order, is_primary, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           RETURNING *`,
          [imgId, id, item.url, item.r2Key || null, sortOrder, isPrimary]
        )
        savedImages.push(imgRes.rows[0])
      }
    } else if (primaryImageUrl) {
      // Create single primary image record
      const imgRes = await client.query(
        `INSERT INTO product_images (id, product_id, url, r2_key, sort_order, is_primary, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING *`,
        [`img-${id}-0`, id, primaryImageUrl, primaryR2Key, 0, true]
      )
      savedImages.push(imgRes.rows[0])
    }

    await client.query('COMMIT')

    const created = mapProduct(productRow, savedImages)
    syncEvents.notify('products', 'create', created?.id)
    res.status(201).json(created)
  } catch (err: any) {
    await client.query('ROLLBACK')
    console.error('Create product error:', err)
    res.status(400).json({ error: err.message })
  } finally {
    client.release()
  }
})

// 4. Update product
productsRouter.put('/:id', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const id = req.params.id
    const p = req.body

    // Check existing product
    const existingRes = await client.query('SELECT * FROM products WHERE id = $1', [id])
    if (existingRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Product not found' })
    }
    const existing = existingRes.rows[0]

    // Determine images
    const imagesList: any[] | undefined = Array.isArray(p.images) ? p.images : undefined
    let primaryImageUrl = p.image !== undefined ? p.image : existing.image
    let primaryR2Key = p.r2Key !== undefined ? p.r2Key : existing.r2_key

    if (imagesList && imagesList.length > 0) {
      const primaryItem = imagesList.find((img: any) => img.isPrimary) || imagesList[0]
      if (primaryItem && primaryItem.url) {
        primaryImageUrl = primaryItem.url
        primaryR2Key = primaryItem.r2Key || primaryR2Key
      }
    }

    const queryStr = `
      UPDATE products SET
        name = COALESCE($1, name),
        sku = COALESCE($2, sku),
        type = COALESCE($3, type),
        category = COALESCE($4, category),
        sub_category = COALESCE($5, sub_category),
        price = COALESCE($6, price),
        old_price = $7,
        rating = COALESCE($8, rating),
        image = COALESCE($9, image),
        r2_key = $10,
        cutout = COALESCE($11, cutout),
        description = COALESCE($12, description),
        material = COALESCE($13, material),
        dimensions = COALESCE($14, dimensions),
        in_stock = COALESCE($15, in_stock),
        featured = COALESCE($16, featured),
        stock_count = COALESCE($17, stock_count),
        min_order_quantity = COALESCE($18, min_order_quantity),
        updated_at = NOW()
      WHERE id = $19
      RETURNING *
    `
    const values = [
      p.name,
      p.sku,
      p.type !== undefined ? p.type : (p.category ? inferProductType(p.category) : null),
      p.category,
      p.subCategory !== undefined ? p.subCategory : null,
      p.price,
      p.oldPrice !== undefined ? p.oldPrice : null,
      p.rating,
      primaryImageUrl,
      primaryR2Key,
      p.cutout,
      p.description,
      p.material,
      p.dimensions,
      p.inStock,
      p.featured,
      p.stockCount,
      p.minOrderQuantity,
      id,
    ]

    const result = await client.query(queryStr, values)
    const updatedRow = result.rows[0]

    // Synchronize product_images table if images provided
    let savedImages: any[] = []
    if (imagesList !== undefined) {
      // Delete existing records
      await client.query('DELETE FROM product_images WHERE product_id = $1', [id])

      if (imagesList.length > 0) {
        for (let i = 0; i < imagesList.length; i++) {
          const item = imagesList[i]
          const imgId = item.id || `img-${id}-${Date.now()}-${i}`
          const isPrimary = item.isPrimary ?? (i === 0)
          const sortOrder = item.sortOrder ?? i

          const imgRes = await client.query(
            `INSERT INTO product_images (id, product_id, url, r2_key, sort_order, is_primary, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING *`,
            [imgId, id, item.url, item.r2Key || null, sortOrder, isPrimary]
          )
          savedImages.push(imgRes.rows[0])
        }
      }
    } else {
      const existingImgs = await client.query(
        'SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, created_at ASC',
        [id]
      )
      savedImages = existingImgs.rows
    }

    await client.query('COMMIT')

    const updated = mapProduct(updatedRow, savedImages)
    syncEvents.notify('products', 'update', updated?.id)
    res.json(updated)
  } catch (err: any) {
    await client.query('ROLLBACK')
    console.error('Update product error:', err)
    res.status(400).json({ error: err.message })
  } finally {
    client.release()
  }
})

// 5. Toggle stock
productsRouter.patch('/:id/toggle-stock', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE products SET in_stock = NOT in_stock, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' })
    }
    const updated = mapProduct(result.rows[0])
    syncEvents.notify('products', 'toggle-stock', updated?.id)
    res.json(updated)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 6. Toggle featured
productsRouter.patch('/:id/toggle-featured', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE products SET featured = NOT featured, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' })
    }
    const updated = mapProduct(result.rows[0])
    syncEvents.notify('products', 'toggle-featured', updated?.id)
    res.json(updated)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 7. Delete product
productsRouter.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id

    // Check if product exists and collect R2 keys
    const prodRes = await pool.query('SELECT r2_key FROM products WHERE id = $1', [id])
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const imgRes = await pool.query('SELECT r2_key FROM product_images WHERE product_id = $1', [id])
    const r2Keys = [prodRes.rows[0].r2_key, ...imgRes.rows.map((r) => r.r2_key)].filter(Boolean)

    // Delete from PostgreSQL (CASCADE will delete product_images)
    await pool.query('DELETE FROM products WHERE id = $1', [id])

    // Clean up R2 objects if they are not referenced by any other product
    for (const key of r2Keys) {
      try {
        const stillInUse = await pool.query(
          'SELECT id FROM products WHERE r2_key = $1 UNION SELECT product_id FROM product_images WHERE r2_key = $1 LIMIT 1',
          [key]
        )
        if (stillInUse.rows.length === 0) {
          await deleteObjectFromR2(key)
        }
      } catch (cleanupErr) {
        console.warn(`Failed to cleanup R2 key ${key}:`, cleanupErr)
      }
    }

    syncEvents.notify('products', 'delete', id)
    res.json({ success: true, id })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
