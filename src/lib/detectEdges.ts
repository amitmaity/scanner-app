import type { Point } from '../types'
import { blobToCanvas, getCv, imageToMat, loadOpenCV } from './opencv'

function orderPoints(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.y - b.y)
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x)
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x)
  return [top[0], top[1], bottom[1], bottom[0]]
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function isConvexQuad(points: Point[]): boolean {
  if (points.length !== 4) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const p1 = points[i]
    const p2 = points[(i + 1) % 4]
    const p3 = points[(i + 2) % 4]
    const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x)
    if (cross === 0) continue
    const currentSign = cross > 0 ? 1 : -1
    if (sign === 0) sign = currentSign
    else if (sign !== currentSign) return false
  }
  return true
}

function matToPoints(mat: { data32S: Int32Array }): Point[] {
  const points: Point[] = []
  for (let i = 0; i < mat.data32S.length; i += 2) {
    points.push({ x: mat.data32S[i], y: mat.data32S[i + 1] })
  }
  return points
}

export async function detectDocumentEdges(
  blob: Blob,
  fallbackWidth: number,
  fallbackHeight: number,
): Promise<Point[]> {
  await loadOpenCV()
  const cv = getCv()
  const canvas = await blobToCanvas(blob)
  const src = await imageToMat(canvas)

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
    const imageArea = fallbackWidth * fallbackHeight

    for (let i = 0; i < contours.size(); i++) {
      // MatVector.get() returns a separately-owned Mat that must be deleted.
      const contour = contours.get(i)
      const approx = new cv.Mat()
      try {
        const area = cv.contourArea(contour)
        if (area < imageArea * 0.05) continue

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

    if (bestPoints) {
      return bestPoints
    }

    const margin = Math.min(fallbackWidth, fallbackHeight) * 0.05
    return [
      { x: margin, y: margin },
      { x: fallbackWidth - margin, y: margin },
      { x: fallbackWidth - margin, y: fallbackHeight - margin },
      { x: margin, y: fallbackHeight - margin },
    ]
  } finally {
    src.delete()
    gray.delete()
    blurred.delete()
    edges.delete()
    contours.delete()
    hierarchy.delete()
  }
}

export function computeOutputSize(corners: Point[]): { width: number; height: number } {
  const ordered = orderPoints(corners)
  const width = Math.max(
    distance(ordered[0], ordered[1]),
    distance(ordered[3], ordered[2]),
  )
  const height = Math.max(
    distance(ordered[0], ordered[3]),
    distance(ordered[1], ordered[2]),
  )
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}
