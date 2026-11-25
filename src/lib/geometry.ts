import type { Point } from '../types'

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Orders four points clockwise (on screen, y pointing down) starting from the
 * top-left. Sorting by angle around the centroid works at any rotation and
 * untangles a quad whose corners were dragged past each other, where sorting by
 * y can pair diagonal corners and produce a twisted warp.
 */
export function orderPoints(points: Point[]): Point[] {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length
  const angle = (p: Point) => Math.atan2(p.y - cy, p.x - cx)
  const sorted = [...points].sort((a, b) => angle(a) - angle(b))

  let start = 0
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i
  }
  return [...sorted.slice(start), ...sorted.slice(0, start)]
}

export function isConvexQuad(points: Point[]): boolean {
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

/** Output size for a perspective crop: the longer of each pair of opposite edges. */
export function computeOutputSize(corners: Point[]): { width: number; height: number } {
  const [tl, tr, br, bl] = orderPoints(corners)
  const width = Math.max(distance(tl, tr), distance(bl, br))
  const height = Math.max(distance(tl, bl), distance(tr, br))
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

/** A frame inset 5% from the image edges, ordered top-left clockwise. */
export function defaultCorners(width: number, height: number): Point[] {
  const margin = Math.min(width, height) * 0.05
  return [
    { x: margin, y: margin },
    { x: width - margin, y: margin },
    { x: width - margin, y: height - margin },
    { x: margin, y: height - margin },
  ]
}

export function clampPoint(p: Point, width: number, height: number): Point {
  return {
    x: Math.max(0, Math.min(width, p.x)),
    y: Math.max(0, Math.min(height, p.y)),
  }
}
