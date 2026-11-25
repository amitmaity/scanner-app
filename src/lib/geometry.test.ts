import { describe, expect, it } from 'vitest'
import {
  clampPoint,
  computeOutputSize,
  defaultCorners,
  isConvexQuad,
  orderPoints,
} from './geometry'

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

function rotate(points: { x: number; y: number }[], degrees: number) {
  const r = (degrees * Math.PI) / 180
  return points.map(({ x, y }) => ({
    x: Math.round((x * Math.cos(r) - y * Math.sin(r)) * 1000) / 1000,
    y: Math.round((x * Math.sin(r) + y * Math.cos(r)) * 1000) / 1000,
  }))
}

describe('orderPoints', () => {
  it('orders shuffled corners top-left, clockwise', () => {
    const shuffled = [square[2], square[0], square[3], square[1]]
    expect(orderPoints(shuffled)).toEqual(square)
  })

  it('keeps a consistent clockwise cycle at any rotation', () => {
    for (const degrees of [15, 30, 44, 46, 60, 89]) {
      const rotated = rotate(square, degrees)
      const ordered = orderPoints([rotated[3], rotated[1], rotated[0], rotated[2]])
      // Whatever corner comes first, each next one must be the clockwise
      // neighbour, so the warp is never mirrored or twisted.
      const start = rotated.findIndex((p) => p.x === ordered[0].x && p.y === ordered[0].y)
      expect(ordered).toEqual([0, 1, 2, 3].map((i) => rotated[(start + i) % 4]))
      expect(isConvexQuad(ordered)).toBe(true)
    }
  })

  it('untangles corners that were dragged past each other', () => {
    // Top corners swapped: drawn in this order the quad crosses itself.
    const twisted = [square[1], square[0], square[2], square[3]]
    expect(isConvexQuad(twisted)).toBe(false)
    expect(orderPoints(twisted)).toEqual(square)
  })
})

describe('computeOutputSize', () => {
  it('uses the longer of each pair of opposite edges', () => {
    const trapezoid = [
      { x: 10, y: 0 },
      { x: 90, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]
    expect(computeOutputSize(trapezoid)).toEqual({ width: 100, height: 51 })
  })

  it('never returns a zero size', () => {
    const point = { x: 5, y: 5 }
    expect(computeOutputSize([point, point, point, point])).toEqual({ width: 1, height: 1 })
  })
})

describe('defaultCorners', () => {
  it('insets 5% of the short side, top-left clockwise', () => {
    expect(defaultCorners(200, 100)).toEqual([
      { x: 5, y: 5 },
      { x: 195, y: 5 },
      { x: 195, y: 95 },
      { x: 5, y: 95 },
    ])
  })
})

describe('clampPoint', () => {
  it('keeps points inside the image', () => {
    expect(clampPoint({ x: -3, y: 120 }, 100, 100)).toEqual({ x: 0, y: 100 })
  })
})
