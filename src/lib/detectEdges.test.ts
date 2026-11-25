import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./cv/client', () => ({ detectQuad: vi.fn() }))

vi.mock('./image', () => ({
  blobToImage: vi.fn(),
  canvasToRaw: vi.fn((c: { width: number; height: number }) => ({
    width: c.width,
    height: c.height,
    data: new Uint8ClampedArray(4),
  })),
  scaleToFit: vi.fn((source: { width: number; height: number }, maxSide: number) => {
    const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
    return { width: Math.round(source.width * scale), height: Math.round(source.height * scale) }
  }),
}))

import { detectQuad } from './cv/client'
import { canvasToRaw } from './image'
import { DETECT_MAX_SIDE, detectDocumentEdges } from './detectEdges'

const photo = { width: 4000, height: 3000 } as HTMLCanvasElement

describe('detectDocumentEdges', () => {
  beforeEach(() => {
    vi.mocked(detectQuad).mockReset()
  })

  it('detects on a small copy and scales the corners back to full size', async () => {
    vi.mocked(detectQuad).mockResolvedValue([
      { x: 100, y: 60 },
      { x: 700, y: 60 },
      { x: 700, y: 540 },
      { x: 100, y: 540 },
    ])

    const corners = await detectDocumentEdges(photo, 4000, 3000)

    expect(canvasToRaw).toHaveBeenCalledWith({ width: DETECT_MAX_SIDE, height: 600 })
    expect(corners).toEqual([
      { x: 500, y: 300 },
      { x: 3500, y: 300 },
      { x: 3500, y: 2700 },
      { x: 500, y: 2700 },
    ])
  })

  it('keeps scaled corners inside the image', async () => {
    vi.mocked(detectQuad).mockResolvedValue([
      { x: -1, y: 0 },
      { x: 801, y: 0 },
      { x: 800, y: 600 },
      { x: 0, y: 600 },
    ])

    const corners = await detectDocumentEdges(photo, 4000, 3000)

    expect(corners[0].x).toBe(0)
    expect(corners[1].x).toBe(4000)
  })

  it('falls back to an inset frame when no page is found', async () => {
    vi.mocked(detectQuad).mockResolvedValue(null)

    const corners = await detectDocumentEdges(photo, 4000, 3000)

    expect(corners[0]).toEqual({ x: 150, y: 150 })
  })
})
