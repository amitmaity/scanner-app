/** Canvas, Blob and pixel helpers for the main thread. */
import type { RawImage } from './cv/protocol'


/** JPEG quality for a page's final image — the only lossy encode after capture. */
export const OUTPUT_JPEG_QUALITY = 0.92
/** Captures are stored at higher quality since every edit starts from them. */
export const CAPTURE_JPEG_QUALITY = 0.95

export type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap

export function sourceSize(source: ImageSource): { width: number; height: number } {
  if ('naturalWidth' in source) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  return { width: source.width, height: source.height }
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function get2d(
  canvas: HTMLCanvasElement,
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', options)
  if (!ctx) throw new Error('Could not get canvas context')
  return ctx
}

/** Copies `source` into a new canvas no larger than `maxSide` (never upscales). */
export function scaleToFit(source: ImageSource, maxSide = Infinity): HTMLCanvasElement {
  const { width, height } = sourceSize(source)
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const canvas = createCanvas(
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  )
  const ctx = get2d(canvas)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  return scaleToFit(await blobToImage(blob))
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/jpeg',
  quality = OUTPUT_JPEG_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to create blob'))),
      type,
      quality,
    )
  })
}

export interface NormalizedImage {
  blob: Blob
  /** The decoded pixels, so callers can run detection without decoding again. */
  canvas: HTMLCanvasElement
  width: number
  height: number
}

/**
 * Bakes EXIF orientation into the pixels and strips metadata so that the
 * preview, edge detection, crop, and export all operate on identical,
 * upright image data.
 */
export async function normalizeImageOrientation(input: Blob): Promise<NormalizedImage> {
  let canvas: HTMLCanvasElement

  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' })
    } catch {
      bitmap = await createImageBitmap(input)
    }
    try {
      canvas = scaleToFit(bitmap)
    } finally {
      bitmap.close()
    }
  } else {
    canvas = await blobToCanvas(input)
  }

  const blob = await canvasToBlob(canvas, 'image/jpeg', CAPTURE_JPEG_QUALITY)
  return { blob, canvas, width: canvas.width, height: canvas.height }
}

/** Reads a canvas's pixels in the transferable form the OpenCV worker takes. */
export function canvasToRaw(canvas: HTMLCanvasElement): RawImage {
  const { data } = get2d(canvas, { willReadFrequently: true }).getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return { width: canvas.width, height: canvas.height, data }
}

export function rawToCanvas(image: RawImage): HTMLCanvasElement {
  const canvas = createCanvas(image.width, image.height)
  get2d(canvas).putImageData(new ImageData(image.data, image.width, image.height), 0, 0)
  return canvas
}
