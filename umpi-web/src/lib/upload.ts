/**
 * Image upload/delete utilities for Supabase Storage (web).
 *
 * Storage bucket: listing-images
 * Path format: {userId}/{timestamp}-{random}.{ext}
 */

const BUCKET = 'listing-images'
const MAX_SIZE_MB = 10
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function generateFilePath(userId: string, ext: string): string {
  const name = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  return `${userId}/${name}.${ext}`
}

/**
 * Compress and resize an image file before upload.
 * Returns a new File with JPEG compression at ~80% quality, max 1200px wide.
 */
async function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      const MAX_WIDTH = 1200
      let { width, height } = img

      if (width > MAX_WIDTH) {
        height = (height * MAX_WIDTH) / width
        width = MAX_WIDTH
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
          } else {
            resolve(file) // fallback to original
          }
        },
        'image/jpeg',
        0.8
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file) // fallback to original
    }

    img.src = url
  })
}

/**
 * Upload an image file to Supabase Storage.
 * Validates type and size, compresses, then uploads.
 * @returns Public URL of the uploaded image
 */
export async function uploadImage(file: File, userId: string): Promise<string> {
  if (!file) throw new Error('No file provided')
  if (!userId) throw new Error('User ID is required')

  // Validate type
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato no soportado. Usá JPG, PNG o WEBP.')
  }

  // Validate size
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`El archivo supera ${MAX_SIZE_MB}MB`)
  }

  // Compress
  const compressed = await compressImage(file)
  const ext = compressed.name.split('.').pop() || 'jpg'
  const filePath = generateFilePath(userId, ext)

  // Convert to ArrayBuffer
  const buffer = await compressed.arrayBuffer()

  // Upload
  const { error: uploadError } = await import('../lib/supabase').then(({ supabase }) =>
    supabase.storage.from(BUCKET).upload(filePath, buffer, {
      contentType: compressed.type,
      upsert: false,
    })
  )

  if (uploadError) throw uploadError

  // Get public URL
  const { data } = await import('../lib/supabase').then(({ supabase }) =>
    supabase.storage.from(BUCKET).getPublicUrl(filePath)
  )

  return data.publicUrl
}

/**
 * Delete an image from Supabase Storage using its public URL.
 */
export async function deleteImage(publicUrl: string): Promise<void> {
  if (!publicUrl) throw new Error('Public URL is required')

  const { supabase } = await import('../lib/supabase')

  // Extract the file path from the public URL
  const { data } = supabase.storage.from(BUCKET).getPublicUrl('')
  const baseUrl = data.publicUrl.replace(/\/?$/, '/')

  if (!publicUrl.startsWith(baseUrl)) {
    throw new Error('URL does not belong to the listing-images bucket')
  }

  const filePath = publicUrl.replace(baseUrl, '')

  const { error } = await supabase.storage.from(BUCKET).remove([filePath])
  if (error) throw error
}
