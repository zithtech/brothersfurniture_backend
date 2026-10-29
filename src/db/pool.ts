import pg from 'pg'
import { config } from '../config/env.js'

const { Pool } = pg

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err)
})

export const query = (text: string, params?: any[]) => pool.query(text, params)
