import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { pool } from '../db/pool.js'

export const authRouter = Router()

const JWT_SECRET = process.env.JWT_SECRET || 'bf_secret_jwt_key_2026_brothers_furniture'

async function recordAudit(email: string, action: string, details: string) {
  try {
    const id = 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6)
    await pool.query(
      'INSERT INTO admin_audit_logs (id, admin_email, action, details) VALUES ($1, $2, $3, $4)',
      [id, email, action, details]
    )
  } catch (err) {
    console.error('Failed to write audit log:', err)
  }
}

// 1. Login
authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const emailNorm = String(email).trim().toLowerCase()
    const result = await pool.query(
      'SELECT * FROM admin_users WHERE LOWER(email) = LOWER($1)',
      [emailNorm]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'No administrator account found with this email address.' })
    }

    const user = result.rows[0]
    const passwordMatch = await bcrypt.compare(String(password), user.password_hash)

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid password. Please double-check your credentials.' })
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'This administrator account has been suspended by a Super Admin.' })
    }

    if (user.status === 'pending_approval') {
      return res.status(403).json({ error: 'Your registration is pending approval by a Super Admin. You will be notified once activated.' })
    }

    const nowIso = new Date().toISOString()
    await pool.query('UPDATE admin_users SET last_login_at = $1 WHERE id = $2', [nowIso, user.id])

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    )

    await recordAudit(user.email, 'ADMIN_LOGIN', 'Successful login to admin portal from ' + (req.ip || 'client'))

    res.json({
      token,
      expiresAt: Date.now() + 24 * 3600 * 1000,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        phone: user.phone,
        avatarUrl: user.avatar_url,
        lastLoginAt: nowIso,
        createdAt: user.created_at,
      },
    })
  } catch (err: any) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Server error during login: ' + err.message })
  }
})

// 2. Register / Access Request
authRouter.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, phone, inviteCode } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' })
    }

    const emailNorm = String(email).trim().toLowerCase()
    const existing = await pool.query('SELECT id FROM admin_users WHERE LOWER(email) = LOWER($1)', [emailNorm])

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An administrator account with this email already exists.' })
    }

    const isInstantApproved = String(inviteCode || '').trim().toUpperCase() === 'BF-ADMIN-2026'
    const status = isInstantApproved ? 'active' : 'pending_approval'
    const finalRole = role || 'viewer'
    const id = 'admin-' + Date.now()
    const hashedPassword = await bcrypt.hash(String(password), 10)
    const avatarUrl = 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(name)

    await pool.query(
      'INSERT INTO admin_users (id, email, password_hash, name, role, status, phone, avatar_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, emailNorm, hashedPassword, name.trim(), finalRole, status, phone || null, avatarUrl]
    )

    await recordAudit(
      emailNorm,
      isInstantApproved ? 'ADMIN_REGISTERED_ACTIVE' : 'ACCESS_REQUEST_SUBMITTED',
      isInstantApproved
        ? 'Account instantly activated with Master Passcode'
        : 'Access request submitted; status is pending_approval'
    )

    res.status(201).json({
      user: {
        id,
        email: emailNorm,
        name: name.trim(),
        role: finalRole,
        status,
        phone,
        avatarUrl,
        createdAt: new Date().toISOString(),
      },
      isPending: !isInstantApproved,
      message: isInstantApproved
        ? 'Account successfully created and activated! You can now log in.'
        : 'Your access request has been submitted to executive administrators for approval.',
    })
  } catch (err: any) {
    console.error('Registration error:', err)
    res.status(500).json({ error: 'Server error during registration: ' + err.message })
  }
})

// 3. Logout
authRouter.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded: any = jwt.verify(authHeader.split(' ')[1], JWT_SECRET)
        if (decoded && decoded.email) {
          await recordAudit(decoded.email, 'ADMIN_LOGOUT', 'Admin session terminated cleanly.')
        }
      } catch {
        // ignore
      }
    }
    res.json({ success: true, message: 'Logged out successfully' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 4. Get Current User (/me)
authRouter.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid token' })
    }

    const token = authHeader.split(' ')[1]
    const decoded: any = jwt.verify(token, JWT_SECRET)

    const result = await pool.query('SELECT * FROM admin_users WHERE id = $1', [decoded.sub])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' })
    }

    const user = result.rows[0]
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      phone: user.phone,
      avatarUrl: user.avatar_url,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
    })
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
})

// 5. Update Profile & Photo
authRouter.patch('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid token' })
    }

    const token = authHeader.split(' ')[1]
    const decoded: any = jwt.verify(token, JWT_SECRET)
    if (!decoded || !decoded.sub) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    const { name, phone, avatarUrl, currentPassword, newPassword } = req.body

    const userRes = await pool.query('SELECT * FROM admin_users WHERE id = $1', [decoded.sub])
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Admin user not found' })
    }
    const user = userRes.rows[0]

    let passwordHash = user.password_hash
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to change password' })
      }
      const match = await bcrypt.compare(String(currentPassword), user.password_hash)
      if (!match) {
        return res.status(400).json({ error: 'Incorrect current password' })
      }
      if (String(newPassword).length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' })
      }
      passwordHash = await bcrypt.hash(String(newPassword), 10)
    }

    const updatedName = name ? String(name).trim() : user.name
    const updatedPhone = phone !== undefined ? String(phone).trim() : user.phone
    const updatedAvatar = avatarUrl !== undefined ? String(avatarUrl) : user.avatar_url

    const result = await pool.query(
      'UPDATE admin_users SET name = $1, phone = $2, avatar_url = $3, password_hash = $4, updated_at = NOW() WHERE id = $5 RETURNING id, email, name, role, status, phone, avatar_url, last_login_at, created_at',
      [updatedName, updatedPhone, updatedAvatar, passwordHash, decoded.sub]
    )

    const updated = result.rows[0]
    await recordAudit(updated.email, 'PROFILE_UPDATED', 'Profile details and photo updated for ' + updated.name)

    res.json({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      status: updated.status,
      phone: updated.phone,
      avatarUrl: updated.avatar_url,
      lastLoginAt: updated.last_login_at,
      createdAt: updated.created_at,
    })
  } catch (err: any) {
    console.error('Update profile error:', err)
    res.status(500).json({ error: err.message || 'Failed to update profile' })
  }
})

// 6. Get All Admins
authRouter.get('/admins', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role, status, phone, avatar_url, last_login_at, created_at FROM admin_users ORDER BY created_at DESC'
    )
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
        status: r.status,
        phone: r.phone,
        avatarUrl: r.avatar_url,
        lastLoginAt: r.last_login_at,
        createdAt: r.created_at,
      }))
    )
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 7. Invite / Create Admin directly
authRouter.post('/admins/invite', async (req, res) => {
  try {
    const { name, email, role, phone, tempPassword } = req.body
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' })
    }

    const emailNorm = String(email).trim().toLowerCase()
    const existing = await pool.query('SELECT id FROM admin_users WHERE LOWER(email) = LOWER($1)', [emailNorm])
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An administrator with this email already exists.' })
    }

    const id = 'admin-' + Date.now()
    const password = tempPassword || 'Brothers@2026'
    const hashedPassword = await bcrypt.hash(password, 10)
    const avatarUrl = 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(name)

    await pool.query(
      'INSERT INTO admin_users (id, email, password_hash, name, role, status, phone, avatar_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, emailNorm, hashedPassword, name.trim(), role || 'viewer', 'active', phone || null, avatarUrl]
    )

    await recordAudit(emailNorm, 'ADMIN_INVITED', 'Directly created admin ' + name + ' with role ' + role)

    res.status(201).json({
      id,
      email: emailNorm,
      name: name.trim(),
      role: role || 'viewer',
      status: 'active',
      phone,
      avatarUrl,
      createdAt: new Date().toISOString(),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 8. Update Status
authRouter.patch('/admins/:id/status', async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    const result = await pool.query(
      'UPDATE admin_users SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' })
    }

    const user = result.rows[0]
    await recordAudit(user.email, 'STATUS_CHANGED', 'Account status updated to ' + status)

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      phone: user.phone,
      avatarUrl: user.avatar_url,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 9. Update Role
authRouter.patch('/admins/:id/role', async (req, res) => {
  try {
    const { id } = req.params
    const { role } = req.body

    const currentRes = await pool.query('SELECT role, email FROM admin_users WHERE id = $1', [id])
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' })
    }

    if (currentRes.rows[0].role === 'super_admin' && role !== 'super_admin') {
      const superCheck = await pool.query("SELECT count(*) FROM admin_users WHERE role = 'super_admin' AND status = 'active'")
      if (parseInt(superCheck.rows[0].count, 10) <= 1) {
        return res.status(400).json({ error: 'Cannot demote the last remaining active Super Administrator.' })
      }
    }

    const result = await pool.query(
      'UPDATE admin_users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [role, id]
    )

    const user = result.rows[0]
    await recordAudit(user.email, 'ROLE_CHANGED', 'Role updated to ' + role)

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      phone: user.phone,
      avatarUrl: user.avatar_url,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 10. Delete Admin
authRouter.delete('/admins/:id', async (req, res) => {
  try {
    const { id } = req.params

    const target = await pool.query('SELECT email, role FROM admin_users WHERE id = $1', [id])
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' })
    }

    if (target.rows[0].role === 'super_admin') {
      const superCount = await pool.query("SELECT count(*) FROM admin_users WHERE role = 'super_admin'")
      if (parseInt(superCount.rows[0].count, 10) <= 1) {
        return res.status(400).json({ error: 'Cannot delete the only Super Administrator.' })
      }
    }

    await pool.query('DELETE FROM admin_users WHERE id = $1', [id])
    await recordAudit(target.rows[0].email, 'ADMIN_DELETED', 'Administrator deleted from database: ' + target.rows[0].email)

    res.json({ success: true, message: 'Admin deleted successfully' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 11. Audit Logs
authRouter.get('/audit-logs', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 100')
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        adminEmail: r.admin_email,
        action: r.action,
        details: r.details,
        timestamp: r.created_at,
      }))
    )
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
