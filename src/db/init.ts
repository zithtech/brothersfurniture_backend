import { pool } from './pool.js'
import { runMigrations } from './migrate.js'
import { seedDatabase } from './seed.js'

export async function initDB() {
  try {
    console.log('Initializing PostgreSQL database...')
    await runMigrations()

    // Check if products table has rows
    const res = await pool.query('SELECT COUNT(*) FROM products')
    const count = parseInt(res.rows[0].count, 10)

    if (count === 0) {
      console.log('No existing products found. Seeding initial data...')
      await seedDatabase()
    } else {
      console.log(`Database already contains ${count} products. Ready to serve.`)
    }
  } catch (err) {
    console.error('Database initialization error:', err)
    throw err
  }
}
