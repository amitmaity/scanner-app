import type { FilterSettings } from '../types'
import { filterImage } from './cv/client'
import { blobToImage, canvasToBlob, canvasToRaw, rawToCanvas, scaleToFit, type ImageSource } from './image'
import { rotateCanvas } from './perspective'

/** Long side of the enhance-screen preview. Full resolution is only rendered on save. */
export const PREVIEW_MAX_SIDE = 1600
/** Long side of page-grid thumbnails (~200 CSS px at 2x). */
export const THUMBNAIL_MAX_SIDE = 400

/**
 * Rotates, filters and adjusts a cropped page, optionally at reduced size for
 * previews. Rotation happens here on a canvas; the filter and adjustments run
 * in the OpenCV worker. May return `source` itself when nothing changes it, so
 * callers must treat the result as read-only.
 */
export async function renderPage(
  source: HTMLCanvasElement,
  settings: FilterSettings,
  maxSide = Infinity,
): Promise<HTMLCanvasElement> {
  let canvas =
    Math.max(source.width, source.height) > maxSide ? scaleToFit(source, maxSide) : source
  canvas = rotateCanvas(canvas, settings.rotation)

  const { mode, brightness, contrast } = settings
  if (mode === 'color' && brightness === 0 && contrast === 0) return canvas

  // Reading pixels copies them, so `source` itself is never modified.
  const filtered = await filterImage(canvasToRaw(canvas), { mode, brightness, contrast })
  return rawToCanvas(filtered)
}

export async function createThumbnail(
  source: Blob | ImageSource,
  maxSide = THUMBNAIL_MAX_SIDE,
): Promise<Blob> {
  const image = source instanceof Blob ? await blobToImage(source) : source
  return canvasToBlob(scaleToFit(image, maxSide), 'image/jpeg', 0.8)
}
