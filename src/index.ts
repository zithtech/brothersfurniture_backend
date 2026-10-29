import express from 'express'
import cors from 'cors'
import { config } from './config/env.js'
import { initDB } from './db/init.js'
import { healthRouter } from './routes/health.js'
import { overviewRouter } from './routes/overview.js'
import { productsRouter } from './routes/products.js'
import { chairsRouter } from './routes/chairs.js'
import { leadsRouter } from './routes/leads.js'
import { ordersRouter } from './routes/orders.js'
import { clientsRouter } from './routes/clients.js'
import { testimonialsRouter } from './routes/testimonials.js'
import { settingsRouter } from './routes/settings.js'
import { syncRouter } from './routes/sync.js'
import { authRouter } from './routes/auth.js'
import { uploadRouter } from './routes/upload.js'

const app = express()

// CORS Configuration
const allowedOrigins = [
  config.frontendUrl,
  config.adminUrl,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
]

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, postman)
      if (!origin) return callback(null, true)
      if (allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost:')) {
        return callback(null, true)
      }
      return callback(null, true) // Allow all in local dev
    },
    credentials: true,
  })
)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Root Route
app.get('/', (_req, res) => {
  res.json({
    service: 'Brothers Furniture Management API',
    status: 'online',
    version: '1.0.0',
    documentation: {
      health: '/api/health',
      overview: '/api/overview',
      products: '/api/products',
      chairs: '/api/chairs',
      leads: '/api/leads',
      orders: '/api/orders',
      clients: '/api/clients',
      testimonials: '/api/testimonials',
      settings: '/api/settings',
      sync: '/api/sync',
      upload: '/api/upload',
    },
    connectedUrls: {
      frontend: config.frontendUrl,
      admin: config.adminUrl,
    },
  })
})

// Mount API Routers
app.use('/api/health', healthRouter)
app.use('/api/overview', overviewRouter)
app.use('/api/products', productsRouter)
app.use('/api/chairs', chairsRouter)
app.use('/api/leads', leadsRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/clients', clientsRouter)
app.use('/api/testimonials', testimonialsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/sync', syncRouter)
app.use('/api/auth', authRouter)
app.use('/api/upload', uploadRouter)

// Global Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled server error:', err)
  res.status(500).json({ error: err.message || 'Internal Server Error' })
})

// Initialize DB and start server
async function start() {
  try {
    await initDB()

    app.listen(config.port, () => {
      console.log(`
=====================================================
  Brothers Furniture Backend API Server
  Running on: http://localhost:${config.port}
  PostgreSQL: ${config.db.host}:${config.db.port}/${config.db.database}
  Admin App : ${config.adminUrl}
  Landing UI: ${config.frontendUrl}
=====================================================
      `)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

start()
