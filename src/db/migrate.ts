import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool } from './pool.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function runMigrations() {
  const schemaPath = path.resolve(__dirname, 'schema.sql')
  const sql = fs.readFileSync(schemaPath, 'utf8')
  
  console.log('Running database migrations...')
  await pool.query(sql)
  console.log('Database tables successfully initialized.')
}

// Allow direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err)
      process.exit(1)
    })
}
