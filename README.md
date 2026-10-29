# Brothers Furniture — Central Backend & Admin API

A robust, enterprise-grade REST API backend built for **Brothers Furniture** (Ambattur, Chennai), connecting PostgreSQL with both the customer landing application (`brothersfurniture_UI`) and the operations admin portal (`brothersfurniture-admin`).

---

## Tech Stack
- **Runtime**: Node.js (ES Modules)
- **Language**: TypeScript 5.7
- **Framework**: Express 4.21
- **Database**: PostgreSQL 17 (`pg` connection pool with automatic error recovery)
- **Dev Runner**: `tsx` (TypeScript Execute & Watch)

---

## Environment Variables (`.env`)

```env
PORT=5000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=brothers_furniture
DB_USER=postgres
DB_PASSWORD=root

FRONTEND_URL=http://localhost:5173
ADMIN_URL=http://localhost:5174

NODE_ENV=development
```

---

## Database Architecture (`brothers_furniture`)

| Table Name | Description | Key Columns |
| :--- | :--- | :--- |
| `products` | 6 furniture categories (Workstations, Office Chairs, Desks, Meeting Tables, Storage, Lounge) | `id`, `sku`, `name`, `category`, `price`, `old_price`, `in_stock`, `featured`, `stock_count` |
| `ergonomic_chairs` | Factory manufactured chair lines (Godrez, Grandeur, Optimus, etc.) | `id`, `name`, `type`, `image`, `features`, `in_production`, `base_price` |
| `leads` | Customer inquiries & quotes from the landing page & phone hotlines | `id`, `name`, `phone`, `email`, `subject`, `message`, `status`, `priority`, `estimated_value` |
| `orders` | Commercial B2B purchase orders & pro-forma invoices | `id`, `order_number`, `customer_name`, `company_name`, `items`, `total`, `status`, `payment_status` |
| `clients` | Marquee corporate clients (PVR, Indian Bank, Billroth Hospital, etc.) | `id`, `name`, `logo`, `sector`, `featured` |
| `testimonials` | Verified client reviews and project ratings | `id`, `name`, `role`, `company`, `quote`, `rating`, `approved`, `featured` |
| `company_settings` | Ambattur factory address, phone hotlines, WhatsApp, Google Maps CID, GSTIN | `id`, `name`, `address_lines`, `phones`, `whatsapp`, `map`, `gstin`, `banner_announcement` |

---

## API Endpoints

### 1. System & Operations
- `GET /` — API service info & route documentation
- `GET /api/health` — PostgreSQL connection status & live record counts
- `GET /api/overview` — Dashboard summary KPIs, total pipeline value, and recent activities

### 2. Products (`/api/products`)
- `GET /api/products` — List products (supports `?category=...&inStock=true&featured=true&search=...`)
- `GET /api/products/:id` — Get single product
- `POST /api/products` — Create new inventory item
- `PUT /api/products/:id` — Update product specifications & pricing
- `PATCH /api/products/:id/toggle-stock` — Instant toggle stock status
- `PATCH /api/products/:id/toggle-featured` — Instant toggle homepage showcase
- `DELETE /api/products/:id` — Remove product

### 3. Ergonomic Chairs (`/api/chairs`)
- `GET /api/chairs` — List chairs (supports `?type=high-back|medium-back|mesh-seat|visitor`)
- `GET /api/chairs/:id` — Get single chair
- `POST /api/chairs` — Add new chair model
- `PUT /api/chairs/:id` — Update chair details
- `PATCH /api/chairs/:id/toggle-production` — Toggle plant production status
- `DELETE /api/chairs/:id` — Delete chair model

### 4. Leads & Quotations CRM (`/api/leads`)
- `GET /api/leads` — List inquiries (supports `?status=new|contacted|quoted|site-visit|won|lost&search=...`)
- `GET /api/leads/:id` — Get inquiry details
- `POST /api/leads` — Submit new lead (used directly by `Contact.tsx` on landing app)
- `PUT /api/leads/:id` — Update lead details and notes
- `PATCH /api/leads/:id/status` — Move lead through sales pipeline Kanban stages
- `DELETE /api/leads/:id` — Remove lead

### 5. Orders & Quotations (`/api/orders`)
- `GET /api/orders` — List orders (supports `?status=...&paymentStatus=...&search=...`)
- `GET /api/orders/:id` — Get order & items
- `POST /api/orders` — Create new order/quote
- `PUT /api/orders/:id` — Update order
- `PATCH /api/orders/:id/status` — Progress order (`pending` → `in_production` → `ready_for_dispatch` → `dispatched` → `delivered`)
- `PATCH /api/orders/:id/payment` — Update payment (`pending` → `advance_received` → `paid`)
- `DELETE /api/orders/:id` — Delete order

### 6. Corporate Clients (`/api/clients`)
- `GET /api/clients` — List client logos
- `POST /api/clients` — Add corporate partner
- `PUT /api/clients/:id` — Update partner details
- `PATCH /api/clients/:id/toggle-featured` — Toggle landing page badge
- `DELETE /api/clients/:id` — Remove client

### 7. Testimonials (`/api/testimonials`)
- `GET /api/testimonials` — List reviews
- `POST /api/testimonials` — Add review
- `PUT /api/testimonials/:id` — Edit review
- `PATCH /api/testimonials/:id/toggle-approved` — Approve review
- `PATCH /api/testimonials/:id/toggle-featured` — Feature review
- `DELETE /api/testimonials/:id` — Delete review

### 8. Settings & Sync (`/api/settings`, `/api/sync`)
- `GET /api/settings` — Get plant contact and store configurations
- `PUT /api/settings` — Update plant information
- `POST /api/sync/reset` — Reset database to factory default seed data
- `GET /api/sync/export` — Full JSON database export

---

## Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Run migrations (tables are also auto-created on start)
npm run db:migrate

# 3. Seed database with Brothers Furniture authentic catalog
npm run db:seed

# 4. Start development server with auto-reload
npm run dev

# 5. Build for production
npm run build
npm start
```
