import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'crypto'
import { config } from '../config/env.js'

// Validate required environment variables
if (!config.r2.accountId || !config.r2.accessKeyId || !config.r2.secretAccessKey) {
  console.warn(
    '[R2 Warning] Cloudflare R2 credentials are missing or incomplete. Image uploads may fail.'
  )
}

// Create S3 client configured for Cloudflare R2
export const r2Client = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
  forcePathStyle: true,
})

export const BUCKET_NAME = config.r2.bucketName

// Allowed formats and size limit
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB limit

/**
 * Validates file buffer using magic byte signatures to prevent spoofed file extensions.
 */
export function validateImageBuffer(buffer: Buffer): { isValid: boolean; detectedMime?: string; error?: string } {
  if (!buffer || buffer.length === 0) {
    return { isValid: false, error: 'Empty file received' }
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      error: `File size exceeds the 10MB limit (${(buffer.length / (1024 * 1024)).toFixed(2)}MB)`,
    }
  }

  // Check magic bytes
  // JPEG: 0xFF, 0xD8, 0xFF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { isValid: true, detectedMime: 'image/jpeg' }
  }

  // PNG: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { isValid: true, detectedMime: 'image/png' }
  }

  // WebP: starts with 'RIFF' and contains 'WEBP' at offset 8-11
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { isValid: true, detectedMime: 'image/webp' }
  }

  return {
    isValid: false,
    error: 'Invalid file format. Only real JPEG, PNG, and WebP images are supported.',
  }
}

/**
 * Get standard file extension from MIME type
 */
function getExtensionForMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      return 'bin'
  }
}

/**
 * Normalizes base public URL
 */
export function getR2PublicBaseUrl(): string {
  let base = config.r2.publicUrl.trim()
  if (base.endsWith('/')) {
    base = base.slice(0, -1)
  }
  return base
}

export interface UploadResult {
  url: string
  key: string
  size: number
  mimeType: string
  originalName: string
}

/**
 * Uploads an image buffer to Cloudflare R2
 */
export async function uploadImageBufferToR2(params: {
  buffer: Buffer
  originalName: string
  folder?: string
  productId?: string
  clientMimeType?: string
}): Promise<UploadResult> {
  const { buffer, originalName, folder = 'products', productId } = params

  // 1. Validate content and real magic bytes
  const validation = validateImageBuffer(buffer)
  if (!validation.isValid || !validation.detectedMime) {
    throw new Error(validation.error || 'Invalid image buffer')
  }

  const mimeType = validation.detectedMime
  const extension = getExtensionForMime(mimeType)

  // 2. Generate unique, collision-proof key
  const randomSuffix = crypto.randomBytes(4).toString('hex')
  const cleanName = (originalName || 'image')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40)

  const timestamp = Date.now()
  const fileName = `${timestamp}-${randomSuffix}_${cleanName}.${extension}`

  // Key structure: products/{productId}/{fileName} or products/general/{fileName}
  const subFolder = productId ? productId.replace(/[^a-zA-Z0-9_-]/g, '_') : 'general'
  const key = `${folder}/${subFolder}/${fileName}`

  // 3. Send PutObjectCommand to Cloudflare R2
  const putParams = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: {
      'original-name': encodeURIComponent(originalName || ''),
      'uploaded-at': new Date().toISOString(),
    },
  }

  await r2Client.send(new PutObjectCommand(putParams))

  // 4. Construct accessible public delivery URL
  const baseUrl = getR2PublicBaseUrl()
  const publicUrl = `${baseUrl}/${key}`

  return {
    url: publicUrl,
    key,
    size: buffer.length,
    mimeType,
    originalName,
  }
}

/**
 * Deletes an object from Cloudflare R2
 */
export async function deleteObjectFromR2(key: string): Promise<boolean> {
  if (!key || typeof key !== 'string') return false

  try {
    await r2Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
    )
    return true
  } catch (error: any) {
    console.error(`Failed to delete object from R2 (${key}):`, error)
    throw new Error(`Cloudflare R2 deletion failed: ${error.message}`)
  }
}

/**
 * Generates a presigned URL for direct client-to-R2 upload if preferred
 */
export async function generatePresignedUploadUrl(params: {
  fileName: string
  mimeType: string
  productId?: string
  folder?: string
}): Promise<{ presignedUrl: string; key: string; publicUrl: string; expiresIn: number }> {
  const { fileName, mimeType, productId, folder = 'products' } = params

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error('Unsupported image format. Allowed: image/jpeg, image/png, image/webp')
  }

  const extension = getExtensionForMime(mimeType)
  const randomSuffix = crypto.randomBytes(4).toString('hex')
  const cleanName = (fileName || 'image')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40)

  const timestamp = Date.now()
  const objectName = `${timestamp}-${randomSuffix}_${cleanName}.${extension}`
  const subFolder = productId ? productId.replace(/[^a-zA-Z0-9_-]/g, '_') : 'general'
  const key = `${folder}/${subFolder}/${objectName}`

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: mimeType,
    CacheControl: 'public, max-age=31536000, immutable',
  })

  const expiresIn = 900 // 15 minutes
  const presignedUrl = await getSignedUrl(r2Client, command, { expiresIn })
  const publicUrl = `${getR2PublicBaseUrl()}/${key}`

  return {
    presignedUrl,
    key,
    publicUrl,
    expiresIn,
  }
}

/**
 * Extracts R2 object key from a full image URL if it belongs to this R2 bucket
 */
export function extractKeyFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null

  const baseUrl = getR2PublicBaseUrl()
  if (url.startsWith(baseUrl)) {
    return url.replace(`${baseUrl}/`, '').replace(/^\//, '')
  }

  if (url.includes('.r2.dev/')) {
    const parts = url.split('.r2.dev/')
    return parts[1] || null
  }

  if (url.includes('r2.cloudflarestorage.com/')) {
    const parts = url.split('r2.cloudflarestorage.com/')
    if (parts[1]) {
      // url might be bucket/key
      const afterDomain = parts[1].split('/')
      afterDomain.shift() // remove bucket name
      return afterDomain.join('/')
    }
  }

  return null
}
