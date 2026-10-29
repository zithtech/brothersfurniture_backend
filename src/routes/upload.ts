import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import jwt from 'jsonwebtoken'
import { pool } from '../db/pool.js'
import {
  uploadImageBufferToR2,
  deleteObjectFromR2,
  generatePresignedUploadUrl,
  extractKeyFromUrl,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '../utils/r2Client.js'

export const uploadRouter = Router()

const JWT_SECRET = process.env.JWT_SECRET || 'bf_secret_jwt_key_2026_brothers_furniture'

/**
 * Authentication middleware for admin actions
 */
async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Missing Bearer token.' })
    }

    const token = authHeader.split(' ')[1]
    const decoded: any = jwt.verify(token, JWT_SECRET)

    if (!decoded || !decoded.sub) {
      return res.status(401).json({ error: 'Invalid or expired authentication token.' })
    }

    const userRes = await pool.query(
      'SELECT id, email, name, role, status FROM admin_users WHERE id = $1',
      [decoded.sub]
    )

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Admin account not found.' })
    }

    const admin = userRes.rows[0]
    if (admin.status === 'suspended') {
      return res.status(403).json({ error: 'Administrator account is suspended.' })
    }

    // Attach to request
    ;(req as any).admin = admin
    next()
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' })
    }
    return res.status(401).json({ error: 'Invalid authentication credentials.' })
  }
}

// Multer memory storage configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES, // 10MB
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(
        new Error(
          `Unsupported file type: ${file.mimetype}. Allowed types: JPEG, PNG, WebP.`
        )
      )
    }
  },
})

// Error handling wrapper for Multer
function handleMulterError(err: any, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds maximum allowed limit of 10MB.' })
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files uploaded at once. Maximum is 10.' })
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` })
  } else if (err) {
    return res.status(400).json({ error: err.message || 'File upload failed' })
  }
  next()
}

/**
 * 1. Single Image Upload
 * POST /api/upload/image
 * FormData: file, productId (optional)
 */
uploadRouter.post(
  '/image',
  requireAdminAuth,
  upload.single('file'),
  handleMulterError,
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided in request.' })
      }

      const productId = req.body.productId ? String(req.body.productId).trim() : undefined

      const result = await uploadImageBufferToR2({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        productId,
        clientMimeType: req.file.mimetype,
      })

      res.status(201).json({
        success: true,
        data: result,
      })
    } catch (err: any) {
      console.error('R2 single image upload error:', err)
      res.status(400).json({ error: err.message || 'Failed to upload image to Cloudflare R2.' })
    }
  }
)

/**
 * 2. Multi-Image Batch Upload
 * POST /api/upload/images
 * FormData: images (multiple files), productId (optional)
 */
uploadRouter.post(
  '/images',
  requireAdminAuth,
  upload.array('images', 10),
  handleMulterError,
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[]
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No image files provided in request.' })
      }

      const productId = req.body.productId ? String(req.body.productId).trim() : undefined

      // Upload all files in parallel
      const uploadPromises = files.map((file) =>
        uploadImageBufferToR2({
          buffer: file.buffer,
          originalName: file.originalname,
          productId,
          clientMimeType: file.mimetype,
        })
      )

      const results = await Promise.all(uploadPromises)

      res.status(201).json({
        success: true,
        count: results.length,
        data: results,
      })
    } catch (err: any) {
      console.error('R2 batch image upload error:', err)
      res.status(400).json({ error: err.message || 'Failed to upload images to Cloudflare R2.' })
    }
  }
)

/**
 * 3. Delete Image
 * DELETE /api/upload/image
 * JSON Body: { key?: string, url?: string, productId?: string }
 */
uploadRouter.delete(
  '/image',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    try {
      const { key: directKey, url, productId } = req.body

      const key = directKey || (url ? extractKeyFromUrl(url) : null)

      if (!key) {
        return res.status(400).json({ error: 'Must provide either object key or a valid Cloudflare R2 image URL.' })
      }

      // Safety check: is this image still used by another product?
      const checkParams = productId ? [key, url || '', productId] : [key, url || '']
      const excludeClause = productId ? 'AND id != $3' : ''
      const excludeImgClause = productId ? 'AND product_id != $3' : ''

      const [prodRefCheck, imgRefCheck] = await Promise.all([
        pool.query(
          `SELECT id, name FROM products WHERE (r2_key = $1 OR image = $2) ${excludeClause} LIMIT 1`,
          checkParams
        ),
        pool.query(
          `SELECT product_id FROM product_images WHERE (r2_key = $1 OR url = $2) ${excludeImgClause} LIMIT 1`,
          checkParams
        ),
      ])

      const isStillReferenced = prodRefCheck.rows.length > 0 || imgRefCheck.rows.length > 0

      if (isStillReferenced) {
        // Still referenced elsewhere: avoid deleting R2 object
        return res.json({
          success: true,
          deletedFromR2: false,
          message: 'Image is still referenced by another catalog item and was preserved in storage.',
        })
      }

      // Safe to purge from Cloudflare R2
      await deleteObjectFromR2(key)

      res.json({
        success: true,
        deletedFromR2: true,
        key,
        message: 'Object removed from Cloudflare R2 successfully.',
      })
    } catch (err: any) {
      console.error('R2 image delete error:', err)
      res.status(500).json({ error: err.message || 'Failed to delete image from Cloudflare R2.' })
    }
  }
)

/**
 * 4. Presigned Upload URL Generator
 * POST /api/upload/presigned-url
 * JSON Body: { fileName, mimeType, productId }
 */
uploadRouter.post(
  '/presigned-url',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    try {
      const { fileName, mimeType, productId } = req.body

      if (!fileName || !mimeType) {
        return res.status(400).json({ error: 'fileName and mimeType are required.' })
      }

      const result = await generatePresignedUploadUrl({
        fileName,
        mimeType,
        productId,
      })

      res.json({
        success: true,
        data: result,
      })
    } catch (err: any) {
      console.error('Presigned URL error:', err)
      res.status(400).json({ error: err.message || 'Failed to generate presigned upload URL.' })
    }
  }
)
