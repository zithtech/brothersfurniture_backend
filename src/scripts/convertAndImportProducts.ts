import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { pool } from '../db/pool.js'
import { r2Client, BUCKET_NAME, getR2PublicBaseUrl } from '../utils/r2Client.js'
import { syncEvents } from '../utils/syncEvents.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const JSON_FILE_PATH = '/Users/karthikeyan/products_202610301308.json'
const BACKUP_FILE_PATH = '/Users/karthikeyan/products_202610301308.backup.json'
const PUBLIC_DIR = '/Users/karthikeyan/brothers-furniture/brothersfurniture/public'

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.webp':
      return 'image/webp'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    default:
      return 'image/webp'
  }
}

async function runBatchConversionAndImport() {
  console.log('=====================================================')
  console.log(' Brothers Furniture: R2 Image Conversion & DB Import')
  console.log('=====================================================\n')

  if (!fs.existsSync(JSON_FILE_PATH)) {
    throw new Error(`Target JSON file not found: ${JSON_FILE_PATH}`)
  }

  // 1. Create a backup of the original JSON file
  fs.copyFileSync(JSON_FILE_PATH, BACKUP_FILE_PATH)
  console.log(`[1/5] Safety backup created: ${BACKUP_FILE_PATH}`)

  const raw = fs.readFileSync(JSON_FILE_PATH, 'utf8')
  const data = JSON.parse(raw)
  const products: any[] = data.products || []

  console.log(`[2/5] Read ${products.length} products from JSON file.\n`)

  const publicBaseUrl = getR2PublicBaseUrl()

  // 2. Identify unique local images and upload to R2
  const localImageMap = new Map<string, { r2Url: string; r2Key: string }>()
  const unsplashMap = new Map<string, { r2Url: string; r2Key: string }>()

  for (const p of products) {
    if (p.image && typeof p.image === 'string') {
      if (p.image.startsWith('/products/')) {
        localImageMap.set(p.image, { r2Url: '', r2Key: '' })
      } else if (p.image.includes('images.unsplash.com')) {
        unsplashMap.set(p.id, { r2Url: '', r2Key: '' })
      }
    }
  }

  console.log(`Found ${localImageMap.size} unique local product images to upload to Cloudflare R2.`)
  console.log(`Found ${unsplashMap.size} Unsplash product images to convert to Cloudflare R2.\n`)

  console.log('[3/5] Uploading local product images to Cloudflare R2...')
  let localUploaded = 0
  const localEntries = Array.from(localImageMap.keys())

  const concurrency = 8
  for (let i = 0; i < localEntries.length; i += concurrency) {
    const chunk = localEntries.slice(i, i + concurrency)
    await Promise.all(
      chunk.map(async (localRelPath) => {
        const fullDiskPath = path.join(PUBLIC_DIR, localRelPath)
        if (!fs.existsSync(fullDiskPath)) {
          console.warn(`[Warning] Local file missing: ${fullDiskPath}`)
          return
        }

        const buffer = fs.readFileSync(fullDiskPath)
        const mimeType = getMimeType(fullDiskPath)
        const key = localRelPath.startsWith('/') ? localRelPath.slice(1) : localRelPath

        await r2Client.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
            CacheControl: 'public, max-age=31536000, immutable',
            Metadata: {
              'original-path': localRelPath,
              'uploaded-at': new Date().toISOString(),
            },
          })
        )

        const r2Url = `${publicBaseUrl}/${key}`
        localImageMap.set(localRelPath, { r2Url, r2Key: key })
        localUploaded++
      })
    )
    process.stdout.write(`  Uploaded ${Math.min(i + concurrency, localEntries.length)} / ${localEntries.length} local images...\r`)
  }
  console.log(`\n  Done: ${localUploaded} local product images uploaded to R2.\n`)

  // 3. Download & Upload Unsplash images to R2
  if (unsplashMap.size > 0) {
    console.log('Uploading Unsplash product images to Cloudflare R2...')
    for (const p of products) {
      if (unsplashMap.has(p.id) && p.image) {
        try {
          const res = await fetch(p.image)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buffer = Buffer.from(await res.arrayBuffer())
          const contentType = res.headers.get('content-type') || 'image/jpeg'
          const ext = contentType.includes('webp') ? 'webp' : 'jpg'
          const key = `products/catalog/${p.id}.${ext}`

          await r2Client.send(
            new PutObjectCommand({
              Bucket: BUCKET_NAME,
              Key: key,
              Body: buffer,
              ContentType: contentType,
              CacheControl: 'public, max-age=31536000, immutable',
            })
          )

          const r2Url = `${publicBaseUrl}/${key}`
          unsplashMap.set(p.id, { r2Url, r2Key: key })
          console.log(`  Converted Unsplash -> R2 for [${p.id}]: ${r2Url}`)
        } catch (err: any) {
          console.warn(`  Failed to convert Unsplash image for [${p.id}], preserving original:`, err.message)
        }
      }
    }
    console.log('  Done converting Unsplash images.\n')
  }

  // 4. Update the products array in memory
  let r2ConvertedCount = 0
  for (const p of products) {
    if (p.image && localImageMap.has(p.image)) {
      const mapping = localImageMap.get(p.image)!
      p.image = mapping.r2Url
      p.r2_key = mapping.r2Key
      r2ConvertedCount++
    } else if (unsplashMap.has(p.id)) {
      const mapping = unsplashMap.get(p.id)
      if (mapping && mapping.r2Url) {
        p.image = mapping.r2Url
        p.r2_key = mapping.r2Key
        r2ConvertedCount++
      }
    } else if (p.image && p.image.includes('r2.dev')) {
      if (!p.r2_key && p.image.includes('.r2.dev/')) {
        p.r2_key = p.image.split('.r2.dev/')[1]
      }
      r2ConvertedCount++
    }
  }

  // Save the updated JSON back to file
  fs.writeFileSync(JSON_FILE_PATH, JSON.stringify({ products }, null, 2), 'utf8')
  console.log(`[4/5] Updated JSON file written: ${JSON_FILE_PATH} (${r2ConvertedCount} products now have R2 URLs)\n`)

  // 5. Upsert all 170 products into PostgreSQL Database
  console.log('[5/5] Importing all 170 products into PostgreSQL database...')
  const client = await pool.connect()

  let insertedCount = 0
  let updatedCount = 0

  try {
    await client.query('BEGIN')

    for (let i = 0; i < products.length; i++) {
      const p = products[i]
      const price = parseFloat(p.price) || 0
      const oldPrice = p.old_price !== null && p.old_price !== undefined ? parseFloat(p.old_price) : null
      const rating = parseFloat(p.rating) || 4.5
      const stockCount = parseInt(p.stock_count ?? '10', 10)
      const minOrder = parseInt(p.min_order_quantity ?? '1', 10)
      const inStock = p.in_stock !== undefined ? Boolean(p.in_stock) : true
      const featured = p.featured !== undefined ? Boolean(p.featured) : false
      const cutout = p.cutout !== undefined ? Boolean(p.cutout) : false
      const createdAt = p.created_at ? new Date(p.created_at) : new Date()
      const updatedAt = new Date()

      const productQuery = `
        INSERT INTO products (
          id, sku, name, type, category, sub_category, price, old_price, rating,
          image, r2_key, cutout, description, material, dimensions,
          in_stock, featured, stock_count, min_order_quantity, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21
        )
        ON CONFLICT (id) DO UPDATE SET
          sku = EXCLUDED.sku,
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          category = EXCLUDED.category,
          sub_category = EXCLUDED.sub_category,
          price = EXCLUDED.price,
          old_price = EXCLUDED.old_price,
          rating = EXCLUDED.rating,
          image = EXCLUDED.image,
          r2_key = EXCLUDED.r2_key,
          cutout = EXCLUDED.cutout,
          description = EXCLUDED.description,
          material = EXCLUDED.material,
          dimensions = EXCLUDED.dimensions,
          in_stock = EXCLUDED.in_stock,
          featured = EXCLUDED.featured,
          stock_count = EXCLUDED.stock_count,
          min_order_quantity = EXCLUDED.min_order_quantity,
          updated_at = NOW()
        RETURNING (xmax = 0) AS is_insert;
      `

      const values = [
        p.id,
        p.sku,
        p.name,
        p.type || null,
        p.category,
        p.sub_category || null,
        price,
        oldPrice,
        rating,
        p.image,
        p.r2_key || null,
        cutout,
        p.description || null,
        p.material || null,
        p.dimensions || null,
        inStock,
        featured,
        stockCount,
        minOrder,
        createdAt,
        updatedAt,
      ]

      const res = await client.query(productQuery, values)
      const isInsert = res.rows[0]?.is_insert

      if (isInsert) {
        insertedCount++
      } else {
        updatedCount++
      }

      if (p.image) {
        const imgId = `img-${p.id}-0`
        const imgQuery = `
          INSERT INTO product_images (id, product_id, url, r2_key, sort_order, is_primary, created_at)
          VALUES ($1, $2, $3, $4, 0, TRUE, NOW())
          ON CONFLICT (id) DO UPDATE SET
            url = EXCLUDED.url,
            r2_key = EXCLUDED.r2_key,
            is_primary = TRUE
        `
        await client.query(imgQuery, [imgId, p.id, p.image, p.r2_key || null])
      }
    }

    await client.query('COMMIT')
    console.log(`  Database Transaction Committed successfully!`)
  } catch (dbErr) {
    await client.query('ROLLBACK')
    throw dbErr
  } finally {
    client.release()
  }

  const countRes = await pool.query('SELECT count(*) FROM products')
  const totalInDb = parseInt(countRes.rows[0].count, 10)

  console.log('\n=====================================================')
  console.log(' Success Summary')
  console.log('=====================================================')
  console.log(`Newly Inserted Products : ${insertedCount}`)
  console.log(`Updated Products        : ${updatedCount}`)
  console.log(`Total Products in DB    : ${totalInDb}`)
  console.log(`Cloudflare R2 Images    : ${r2ConvertedCount}`)
  console.log('=====================================================\n')

  try {
    syncEvents.notify('products', 'update', 'all')
    console.log('Sent live real-time sync notification (SSE) to Storefront and Admin!')
  } catch (syncErr) {
    console.warn('Sync notification note:', syncErr)
  }

  await pool.end()
}

runBatchConversionAndImport()
  .then(() => {
    console.log('All 170 products imported and images converted to Cloudflare R2 successfully!')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Fatal execution error:', err)
    process.exit(1)
  })
