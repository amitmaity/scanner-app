import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTER } from '../types'

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

vi.mock('./cv/client', () => ({ filterImage: vi.fn() }))

vi.mock('./image', () => ({
  canvasToRaw: vi.fn((c: HTMLCanvasElement) => ({
    width: c.width,
    height: c.height,
    data: new Uint8ClampedArray(4),
  })),
  rawToCanvas: vi.fn((raw: { width: number; height: number }) => canvas(raw.width, raw.height)),
  scaleToFit: vi.fn((source: HTMLCanvasElement, maxSide = Infinity) => {
    const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
    return canvas(Math.round(source.width * scale), Math.round(source.height * scale))
  }),
  blobToImage: vi.fn(),
  canvasToBlob: vi.fn(),
  createCanvas: canvas,
  get2d: vi.fn(() => ({ translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn() })),
}))

import { filterImage } from './cv/client'
import { canvasToRaw, scaleToFit } from './image'
import { renderPage } from './filters'

describe('renderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(filterImage).mockImplementation(async (image) => image)
  })

  it('returns the source untouched when nothing changes it', async () => {
    const source = canvas(200, 100)

    const result = await renderPage(source, { ...DEFAULT_FILTER, mode: 'color' })

    expect(result).toBe(source)
    expect(filterImage).not.toHaveBeenCalled()
  })

  it('sends the pixels to the worker with the filter settings', async () => {
    const source = canvas(200, 100)

    const result = await renderPage(source, {
      ...DEFAULT_FILTER,
      mode: 'blackwhite',
      brightness: 10,
    })

    expect(filterImage).toHaveBeenCalledWith(expect.objectContaining({ width: 200, height: 100 }), {
      mode: 'blackwhite',
      brightness: 10,
      contrast: 0,
    })
    expect(result).not.toBe(source)
  })

  it('renders previews from a downscaled copy', async () => {
    const source = canvas(3200, 2400)

    await renderPage(source, { ...DEFAULT_FILTER, mode: 'auto' }, 1600)

    expect(scaleToFit).toHaveBeenCalledWith(source, 1600)
    expect(canvasToRaw).toHaveBeenCalledWith(expect.objectContaining({ width: 1600, height: 1200 }))
  })

  it('rotates before filtering, swapping width and height', async () => {
    await renderPage(canvas(200, 100), { ...DEFAULT_FILTER, mode: 'grayscale', rotation: 90 })

    expect(canvasToRaw).toHaveBeenCalledWith(expect.objectContaining({ width: 100, height: 200 }))
  })
})
