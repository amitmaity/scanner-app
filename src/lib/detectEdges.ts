import type { Point } from '../types'
import { detectQuad } from './cv/client'
import { clampPoint, defaultCorners } from './geometry'
import { blobToImage, canvasToRaw, scaleToFit, type ImageSource } from './image'

/** Detection runs on a copy this size: full-resolution photos are slow on
 * phones and add nothing to finding four page corners. */
export const DETECT_MAX_SIDE = 800

/**
 * Finds the page outline and returns its corners in full-image coordinates
 * (top-left first, clockwise), or an inset default frame when there's none.
 */
export async function detectDocumentEdges(
  source: Blob | ImageSource,
  width: number,
  height: number,
): Promise<Point[]> {
  const image = source instanceof Blob ? await blobToImage(source) : source
  const small = scaleToFit(image, DETECT_MAX_SIDE)
  const toFull = width / small.width

  const quad = await detectQuad(canvasToRaw(small))
  if (!quad) return defaultCorners(width, height)
  return quad.map((p) => clampPoint({ x: p.x * toFull, y: p.y * toFull }, width, height))
}
