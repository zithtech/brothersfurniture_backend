import { pool } from '../db/pool.js'

export async function migrateAndSeedCustomers() {
  console.log('--- Starting Customer Management Migration ---')

  const migrationSql = `
    -- 1. Customer Categories
    CREATE TABLE IF NOT EXISTS customer_categories (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      description TEXT,
      color VARCHAR(50),
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 2. Main Customers Table
    CREATE TABLE IF NOT EXISTS customers (
      id VARCHAR(100) PRIMARY KEY,
      customer_code VARCHAR(50) UNIQUE NOT NULL,
      company_name VARCHAR(255) NOT NULL,
      company_phone VARCHAR(50) NOT NULL,
      company_email VARCHAR(255),
      gst_number VARCHAR(50),
      website_url TEXT,
      company_size VARCHAR(50) DEFAULT 'Medium',
      category VARCHAR(100) NOT NULL DEFAULT 'Corporate',
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      customer_type VARCHAR(50) DEFAULT 'B2B',
      gst_type VARCHAR(50) DEFAULT 'Regular',
      payment_terms VARCHAR(100) DEFAULT 'Net 30',
      credit_limit NUMERIC(14,2) DEFAULT 0,
      customer_source VARCHAR(100) DEFAULT 'Direct',
      account_manager VARCHAR(150),
      internal_notes TEXT,
      internal_remarks TEXT,
      created_by VARCHAR(150) DEFAULT 'Admin',
      updated_by VARCHAR(150) DEFAULT 'Admin',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);
    CREATE INDEX IF NOT EXISTS idx_customers_company_name ON customers(company_name);
    CREATE INDEX IF NOT EXISTS idx_customers_gst_number ON customers(gst_number);
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(company_phone);
    CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(company_email);
    CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
    CREATE INDEX IF NOT EXISTS idx_customers_category ON customers(category);
    CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON customers(deleted_at);

    -- 3. Customer Contacts Table
    CREATE TABLE IF NOT EXISTS customer_contacts (
      id VARCHAR(100) PRIMARY KEY,
      customer_id VARCHAR(100) NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      designation VARCHAR(150) NOT NULL,
      email VARCHAR(255),
      phone VARCHAR(50) NOT NULL,
      is_primary BOOLEAN DEFAULT FALSE,
      department VARCHAR(100),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer_id ON customer_contacts(customer_id);
    CREATE INDEX IF NOT EXISTS idx_customer_contacts_phone ON customer_contacts(phone);
    CREATE INDEX IF NOT EXISTS idx_customer_contacts_email ON customer_contacts(email);

    -- 4. Customer Addresses Table
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id VARCHAR(100) PRIMARY KEY,
      customer_id VARCHAR(100) NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      address_type VARCHAR(50) NOT NULL DEFAULT 'billing',
      is_default BOOLEAN DEFAULT FALSE,
      address_line1 TEXT NOT NULL,
      address_line2 TEXT,
      city VARCHAR(100) NOT NULL,
      state VARCHAR(100) NOT NULL,
      country VARCHAR(100) NOT NULL DEFAULT 'India',
      pin_code VARCHAR(20) NOT NULL,
      map_location TEXT,
      latitude NUMERIC(10,7),
      longitude NUMERIC(10,7),
      landmark TEXT,
      contact_person VARCHAR(150),
      contact_phone VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id ON customer_addresses(customer_id);
    CREATE INDEX IF NOT EXISTS idx_customer_addresses_city ON customer_addresses(city);
    CREATE INDEX IF NOT EXISTS idx_customer_addresses_state ON customer_addresses(state);

    -- 5. Customer Notes Table
    CREATE TABLE IF NOT EXISTS customer_notes (
      id VARCHAR(100) PRIMARY KEY,
      customer_id VARCHAR(100) NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      category VARCHAR(50) DEFAULT 'General',
      author_name VARCHAR(150) DEFAULT 'Admin',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_customer_notes_customer_id ON customer_notes(customer_id);

    -- 6. Customer Activity Logs Table
    CREATE TABLE IF NOT EXISTS customer_activity_logs (
      id VARCHAR(100) PRIMARY KEY,
      customer_id VARCHAR(100) NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      action VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      actor_name VARCHAR(150) DEFAULT 'Admin',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_customer_activity_customer_id ON customer_activity_logs(customer_id);
    CREATE INDEX IF NOT EXISTS idx_customer_activity_created_at ON customer_activity_logs(created_at DESC);
  `

  await pool.query(migrationSql)
  console.log('Customer tables successfully migrated.')

  // Check if customers already exist
  const countCheck = await pool.query('SELECT COUNT(*) FROM customers')
  const count = parseInt(countCheck.rows[0].count, 10)

  if (count === 0) {
    console.log('Seeding initial customer directory records...')

    // Seed Categories
    const categories = [
      { id: 'cat-mfg', name: 'Manufacturer', description: 'Furniture & Component Manufacturers', color: '#3B82F6', sort_order: 1 },
      { id: 'cat-ret', name: 'Retailer', description: 'Retail showrooms and commercial stores', color: '#10B981', sort_order: 2 },
      { id: 'cat-who', name: 'Wholesaler', description: 'Bulk wholesale and procurement partners', color: '#8B5CF6', sort_order: 3 },
      { id: 'cat-dis', name: 'Distributor', description: 'Regional furniture distributors', color: '#F59E0B', sort_order: 4 },
      { id: 'cat-dea', name: 'Dealer', description: 'Authorized dealers and agents', color: '#EC4899', sort_order: 5 },
      { id: 'cat-corp', name: 'Corporate', description: 'Enterprise corporate clients and offices', color: '#EA580C', sort_order: 6 },
      { id: 'cat-id', name: 'Interior Designer', description: 'Architectural and interior design studios', color: '#06B6D4', sort_order: 7 },
      { id: 'cat-oth', name: 'Other', description: 'General and institutional clients', color: '#6B7280', sort_order: 8 },
    ]

    for (const c of categories) {
      await pool.query(
        `INSERT INTO customer_categories (id, name, description, color, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.name, c.description, c.color, c.sort_order]
      )
    }

    // Seed Sample Customers
    const sampleCustomers = [
      {
        id: 'cus-abc-001',
        customer_code: 'CUS-000101',
        company_name: 'ABC Furniture Pvt Ltd',
        company_phone: '+91 98765 43210',
        company_email: 'contact@abcfurniture.com',
        gst_number: '33ABCDE1234F1Z5',
        website_url: 'https://abcfurniture.example.com',
        company_size: 'Medium',
        category: 'Manufacturer',
        status: 'active',
        customer_type: 'B2B',
        gst_type: 'Regular',
        payment_terms: 'Net 30',
        credit_limit: 500000,
        customer_source: 'Referral',
        account_manager: 'Karthik S',
        internal_notes: 'Key manufacturing partner for office chair components and tubular steel frames.',
        contacts: [
          {
            id: 'con-abc-1',
            name: 'Raj Kumar',
            designation: 'General Manager',
            email: 'raj.kumar@abcfurniture.com',
            phone: '+91 98765 43210',
            is_primary: true,
            department: 'Management',
            notes: 'Primary decision maker for contract renewals and procurement.',
          },
          {
            id: 'con-abc-2',
            name: 'Priya Sundaram',
            designation: 'Procurement Lead',
            email: 'priya.s@abcfurniture.com',
            phone: '+91 98765 43211',
            is_primary: false,
            department: 'Procurement',
            notes: 'Handles purchase orders and delivery dispatch timelines.',
          },
        ],
        addresses: [
          {
            id: 'addr-abc-1',
            address_type: 'billing',
            is_default: true,
            address_line1: 'No. 42, Mount Road',
            address_line2: 'Guindy Industrial Estate',
            city: 'Chennai',
            state: 'Tamil Nadu',
            country: 'India',
            pin_code: '600032',
            map_location: 'Guindy Industrial Estate, Chennai, Tamil Nadu',
            latitude: 13.0067,
            longitude: 80.2025,
            landmark: 'Near Guindy Metro Station',
            contact_person: 'Raj Kumar',
            contact_phone: '+91 98765 43210',
          },
          {
            id: 'addr-abc-2',
            address_type: 'shipping',
            is_default: false,
            address_line1: 'Warehouse Bay 4B, Phase 2',
            address_line2: 'Ambattur Industrial Estate',
            city: 'Chennai',
            state: 'Tamil Nadu',
            country: 'India',
            pin_code: '600058',
            map_location: 'Ambattur Industrial Estate, Chennai',
            latitude: 13.0984,
            longitude: 80.1612,
            landmark: 'Near Telephone Exchange',
            contact_person: 'Priya Sundaram',
            contact_phone: '+91 98765 43211',
          },
        ],
        notes: [
          {
            id: 'note-abc-1',
            note: 'Discussed volume discounts for 200+ ergonomic workstation sets for Q4 fit-outs.',
            category: 'Meeting',
            author_name: 'Karthik S',
          },
        ],
      },
      {
        id: 'cus-prestige-002',
        customer_code: 'CUS-000102',
        company_name: 'Prestige Workspace Solutions',
        company_phone: '+91 98450 12345',
        company_email: 'procurement@prestigeworkspace.com',
        gst_number: '29AAAAA0000A1Z5',
        website_url: 'https://prestigeworkspace.example.com',
        company_size: 'Large',
        category: 'Corporate',
        status: 'active',
        customer_type: 'B2B',
        gst_type: 'Regular',
        payment_terms: 'Net 15',
        credit_limit: 1200000,
        customer_source: 'Direct',
        account_manager: 'Sarah Jenkins',
        internal_notes: 'Major corporate facility manager operating tech parks across Bangalore and Hyderabad.',
        contacts: [
          {
            id: 'con-prest-1',
            name: 'Arvind Swaminathan',
            designation: 'VP Infrastructure & Facilities',
            email: 'arvind.s@prestigeworkspace.com',
            phone: '+91 98450 12345',
            is_primary: true,
            department: 'Corporate Facilities',
            notes: 'Direct signoff on all furnishing contracts over ₹10 Lakhs.',
          },
          {
            id: 'con-prest-2',
            name: 'Deepa Hegde',
            designation: 'Senior Facility Manager',
            email: 'deepa.h@prestigeworkspace.com',
            phone: '+91 98450 12346',
            is_primary: false,
            department: 'Operations',
            notes: 'Coordinates on-site furniture assembly and deliveries.',
          },
        ],
        addresses: [
          {
            id: 'addr-prest-1',
            address_type: 'billing',
            is_default: true,
            address_line1: 'Prestige Tech Park, Tower B, Level 6',
            address_line2: 'Marathahalli-Sarjapur Outer Ring Road',
            city: 'Bengaluru',
            state: 'Karnataka',
            country: 'India',
            pin_code: '560103',
            map_location: 'Prestige Tech Park, Outer Ring Road, Bengaluru',
            latitude: 12.9352,
            longitude: 77.6946,
            landmark: 'Opposite Cisco Campus',
            contact_person: 'Arvind Swaminathan',
            contact_phone: '+91 98450 12345',
          },
        ],
        notes: [
          {
            id: 'note-prest-1',
            note: 'Sample conference room table and 12 executive mesh chairs installed for testing.',
            category: 'Requirement',
            author_name: 'Sarah Jenkins',
          },
        ],
      },
      {
        id: 'cus-urban-003',
        customer_code: 'CUS-000103',
        company_name: 'Urban Living Architecture & Interiors',
        company_phone: '+91 98850 56789',
        company_email: 'studio@urbanliving.in',
        gst_number: '36ABCDE5678G1Z2',
        website_url: 'https://urbanliving.in',
        company_size: 'Medium',
        category: 'Interior Designer',
        status: 'active',
        customer_type: 'B2B',
        gst_type: 'Regular',
        payment_terms: 'Advance 50%',
        credit_limit: 300000,
        customer_source: 'Website',
        account_manager: 'Arun Varma',
        internal_notes: 'Boutique architectural practice specializing in modern IT and coworking interior layouts.',
        contacts: [
          {
            id: 'con-urb-1',
            name: 'Vikram Rao',
            designation: 'Principal Architect & Founder',
            email: 'vikram@urbanliving.in',
            phone: '+91 98850 56789',
            is_primary: true,
            department: 'Design',
            notes: 'Requires 3D CAD / Revit models and custom wood finishes.',
          },
        ],
        addresses: [
          {
            id: 'addr-urb-1',
            address_type: 'headquarters',
            is_default: true,
            address_line1: 'Plot No. 128, Road No. 36',
            address_line2: 'Jubilee Hills Commercial Zone',
            city: 'Hyderabad',
            state: 'Telangana',
            country: 'India',
            pin_code: '500033',
            map_location: 'Road 36, Jubilee Hills, Hyderabad',
            latitude: 17.4319,
            longitude: 78.4073,
            landmark: 'Near Peddamma Temple',
            contact_person: 'Vikram Rao',
            contact_phone: '+91 98850 56789',
          },
        ],
        notes: [
          {
            id: 'note-urb-1',
            note: 'Sent sample finish swatches: Walnut laminate and matte black powder coat.',
            category: 'General',
            author_name: 'Arun Varma',
          },
        ],
      },
      {
        id: 'cus-apex-004',
        customer_code: 'CUS-000104',
        company_name: 'Apex Retail Chain Ltd',
        company_phone: '+91 98200 87654',
        company_email: 'accounts@apexretail.in',
        gst_number: '27AAACA9999P1ZA',
        website_url: 'https://apexretail.in',
        company_size: 'Enterprise',
        category: 'Retailer',
        status: 'active',
        customer_type: 'B2B',
        gst_type: 'Regular',
        payment_terms: 'Net 60',
        credit_limit: 2500000,
        customer_source: 'Exhibition',
        account_manager: 'Rohan Mehta',
        internal_notes: 'National lifestyle chain outfitting 15 retail stores across western India.',
        contacts: [
          {
            id: 'con-apx-1',
            name: 'Sunita Deshmukh',
            designation: 'Head of Visual Merchandising',
            email: 'sunita.d@apexretail.in',
            phone: '+91 98200 87654',
            is_primary: true,
            department: 'Procurement',
            notes: 'Manages store fit-out schedule and store fixture specs.',
          },
        ],
        addresses: [
          {
            id: 'addr-apx-1',
            address_type: 'billing',
            is_default: true,
            address_line1: 'Express Towers, 14th Floor',
            address_line2: 'Barrister Rajni Patel Marg, Nariman Point',
            city: 'Mumbai',
            state: 'Maharashtra',
            country: 'India',
            pin_code: '400021',
            map_location: 'Express Towers, Nariman Point, Mumbai',
            latitude: 18.9284,
            longitude: 72.8223,
            landmark: 'Near Air India Building',
            contact_person: 'Sunita Deshmukh',
            contact_phone: '+91 98200 87654',
          },
        ],
        notes: [],
      },
      {
        id: 'cus-deccan-005',
        customer_code: 'CUS-000105',
        company_name: 'Deccan Modular Systems',
        company_phone: '+91 94432 11223',
        company_email: 'sales@deccanmodular.com',
        gst_number: '33AABBD4321E1Z8',
        website_url: 'https://deccanmodular.com',
        company_size: 'Medium',
        category: 'Distributor',
        status: 'inactive',
        customer_type: 'B2B',
        gst_type: 'Regular',
        payment_terms: 'Net 30',
        credit_limit: 400000,
        customer_source: 'Direct',
        account_manager: 'Karthik S',
        internal_notes: 'Regional distributor in Western Tamil Nadu. Account temporarily inactive pending annual contract renegotiation.',
        contacts: [
          {
            id: 'con-dec-1',
            name: 'K. Senthil Nathan',
            designation: 'Managing Partner',
            email: 'senthil@deccanmodular.com',
            phone: '+91 94432 11223',
            is_primary: true,
            department: 'Executive',
            notes: 'Contact for dealership agreement and territory allocation.',
          },
        ],
        addresses: [
          {
            id: 'addr-dec-1',
            address_type: 'billing',
            is_default: true,
            address_line1: 'No. 88, Avinashi Road',
            address_line2: 'Near Hope College, Peelamedu',
            city: 'Coimbatore',
            state: 'Tamil Nadu',
            country: 'India',
            pin_code: '641004',
            map_location: 'Avinashi Road, Peelamedu, Coimbatore',
            latitude: 11.0267,
            longitude: 77.0125,
            landmark: 'Near PSG Tech',
            contact_person: 'K. Senthil Nathan',
            contact_phone: '+91 94432 11223',
          },
        ],
        notes: [
          {
            id: 'note-dec-1',
            note: 'Account placed on Inactive status until Q1 volume quota agreement is signed.',
            category: 'Meeting',
            author_name: 'Karthik S',
          },
        ],
      },
      {
        id: 'cus-global-006',
        customer_code: 'CUS-000106',
        company_name: 'Global Tech Parks India Ltd',
        company_phone: '+91 97654 33221',
        company_email: 'facilities@globaltechparks.in',
        gst_number: '27AAACG1111Q1Z4',
        website_url: 'https://globaltechparks.in',
        company_size: 'Enterprise',
        category: 'Corporate',
        status: 'archived',
        customer_type: 'B2B',
        gst_type: 'Regular',
        payment_terms: 'Net 45',
        credit_limit: 1500000,
        customer_source: 'Referral',
        account_manager: 'Rohan Mehta',
        internal_notes: 'Old project account archived after completion of Phase 1 IT park outfitting.',
        contacts: [
          {
            id: 'con-gtp-1',
            name: 'Neha Kulkarni',
            designation: 'Lead Procurement Manager',
            email: 'neha.k@globaltechparks.in',
            phone: '+91 97654 33221',
            is_primary: true,
            department: 'Procurement',
            notes: 'Primary liaison for IT park tower 3 fitout.',
          },
        ],
        addresses: [
          {
            id: 'addr-gtp-1',
            address_type: 'billing',
            is_default: true,
            address_line1: 'Rajiv Gandhi Infotech Park, Phase 1',
            address_line2: 'Plot 22, MIDC Hinjewadi',
            city: 'Pune',
            state: 'Maharashtra',
            country: 'India',
            pin_code: '411057',
            map_location: 'Hinjewadi Phase 1, Pune',
            latitude: 18.5913,
            longitude: 73.7389,
            landmark: 'Near Wipro Circle',
            contact_person: 'Neha Kulkarni',
            contact_phone: '+91 97654 33221',
          },
        ],
        notes: [],
      },
    ]

    for (const c of sampleCustomers) {
      await pool.query(
        `INSERT INTO customers (
          id, customer_code, company_name, company_phone, company_email, gst_number,
          website_url, company_size, category, status, customer_type, gst_type,
          payment_terms, credit_limit, customer_source, account_manager, internal_notes,
          created_by, updated_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'Admin', 'Admin', NOW(), NOW())`,
        [
          c.id, c.customer_code, c.company_name, c.company_phone, c.company_email,
          c.gst_number, c.website_url, c.company_size, c.category, c.status,
          c.customer_type, c.gst_type, c.payment_terms, c.credit_limit,
          c.customer_source, c.account_manager, c.internal_notes,
        ]
      )

      // Insert Contacts
      for (const con of c.contacts) {
        await pool.query(
          `INSERT INTO customer_contacts (
            id, customer_id, name, designation, email, phone, is_primary, department, notes, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
          [con.id, c.id, con.name, con.designation, con.email, con.phone, con.is_primary, con.department, con.notes]
        )
      }

      // Insert Addresses
      for (const addr of c.addresses) {
        await pool.query(
          `INSERT INTO customer_addresses (
            id, customer_id, address_type, is_default, address_line1, address_line2,
            city, state, country, pin_code, map_location, latitude, longitude, landmark,
            contact_person, contact_phone, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())`,
          [
            addr.id, c.id, addr.address_type, addr.is_default, addr.address_line1, addr.address_line2,
            addr.city, addr.state, addr.country, addr.pin_code, addr.map_location,
            addr.latitude, addr.longitude, addr.landmark, addr.contact_person, addr.contact_phone,
          ]
        )
      }

      // Insert Notes
      for (const n of c.notes) {
        await pool.query(
          `INSERT INTO customer_notes (id, customer_id, note, category, author_name, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [n.id, c.id, n.note, n.category, n.author_name]
        )
      }

      // Insert Activity Log
      await pool.query(
        `INSERT INTO customer_activity_logs (id, customer_id, action, description, actor_name, created_at)
         VALUES ($1, $2, 'created', $3, 'Admin', NOW())`,
        [`act-${c.id}-init`, c.id, `Customer record initialized in CRM directory with code ${c.customer_code}`]
      )
    }

    console.log('Seeded 6 comprehensive customer profiles with contacts, addresses, notes, and activity.')
  } else {
    console.log(`Customers table already contains ${count} records. Migration done.`)
  }
}

if (process.argv[1] && process.argv[1].includes('migrateAndSeedCustomers')) {
  migrateAndSeedCustomers()
    .then(() => {
      console.log('Customer migration script completed successfully.')
      process.exit(0)
    })
    .catch((err) => {
      console.error('Migration failed:', err)
      process.exit(1)
    })
}
