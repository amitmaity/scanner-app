import type { Point } from '../types'
import { clampPoint, defaultCorners, isConvexQuad, orderPoints } from './geometry'
import { blobToImage, getCv, loadOpenCV, scaleToFit, type ImageSource } from './opencv'

/** Detection runs on a copy this size: full-resolution photos are slow on
 * phones and add nothing to finding four page corners. */
export const DETECT_MAX_SIDE = 800
/** Ignore contours smaller than this share of the image. */
const MIN_AREA_RATIO = 0.05

function matToPoints(mat: { data32S: Int32Array }): Point[] {
  const points: Point[] = []
  for (let i = 0; i < mat.data32S.length; i += 2) {
    points.push({ x: mat.data32S[i], y: mat.data32S[i + 1] })
  }
  return points
}

/**
 * Finds the largest convex four-sided contour and returns its corners in
 * full-image coordinates (top-left first, clockwise), or an inset default
 * frame when no page outline is found.
 */
export async function detectDocumentEdges(
  source: Blob | ImageSource,
  width: number,
  height: number,
): Promise<Point[]> {
  await loadOpenCV()
  const cv = getCv()
  const image = source instanceof Blob ? await blobToImage(source) : source
  const small = scaleToFit(image, DETECT_MAX_SIDE)
  const toFull = width / small.width

  const src = cv.imread(small)
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const edges = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0)
    cv.Canny(blurred, edges, 50, 150)
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

    let bestArea = 0
    let bestPoints: Point[] | null = null
    const minArea = small.width * small.height * MIN_AREA_RATIO

    for (let i = 0; i < contours.size(); i++) {
      // MatVector.get() returns a separately-owned Mat that must be deleted.
      const contour = contours.get(i)
      const approx = new cv.Mat()
      try {
        const area = cv.contourArea(contour)
        if (area < minArea) continue

        const peri = cv.arcLength(contour, true)
        cv.approxPolyDP(contour, approx, 0.02 * peri, true)
        if (approx.rows === 4) {
          const points = orderPoints(matToPoints(approx))
          if (isConvexQuad(points) && area > bestArea) {
            bestArea = area
            bestPoints = points
          }
        }
      } finally {
        approx.delete()
        contour.delete()
      }
    }

    if (!bestPoints) return defaultCorners(width, height)
    return bestPoints.map((p) => clampPoint({ x: p.x * toFull, y: p.y * toFull }, width, height))
  } finally {
    src.delete()
    gray.delete()
    blurred.delete()
    edges.delete()
    contours.delete()
    hierarchy.delete()
  }
}
