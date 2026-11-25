import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTER } from '../types'

class FakeMat {
  rows = 0
  cols = 0
  delete = vi.fn()
}

const fakeCv = {
  Mat: FakeMat,
  MatVector: class {
    get = () => new FakeMat()
    set = vi.fn()
    delete = vi.fn()
  },
  Size: class {
    width: number
    height: number
    constructor(width: number, height: number) {
      this.width = width
      this.height = height
    }
  },
  imread: vi.fn(),
  imshow: vi.fn(),
  cvtColor: vi.fn((src: FakeMat, dst: FakeMat) => {
    dst.rows = src.rows
    dst.cols = src.cols
  }),
  split: vi.fn(),
  merge: vi.fn(),
  adaptiveThreshold: vi.fn(),
  CLAHE: undefined as unknown,
  createCLAHE: undefined as unknown,
  COLOR_RGBA2RGB: 1,
  COLOR_RGB2Lab: 2,
  COLOR_Lab2RGB: 3,
  COLOR_RGB2RGBA: 4,
  COLOR_RGBA2GRAY: 5,
  COLOR_GRAY2RGBA: 6,
  ADAPTIVE_THRESH_GAUSSIAN_C: 7,
  THRESH_BINARY: 8,
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

const fakeCtx = {
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  putImageData: vi.fn(),
}

vi.mock('./opencv', () => ({
  loadOpenCV: vi.fn().mockResolvedValue(undefined),
  getCv: () => fakeCv,
  createCanvas: (w: number, h: number) => canvas(w, h),
  get2d: () => fakeCtx,
  scaleToFit: vi.fn((source: HTMLCanvasElement, maxSide = Infinity) => {
    const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
    return canvas(Math.round(source.width * scale), Math.round(source.height * scale))
  }),
  blobToImage: vi.fn(),
  canvasToBlob: vi.fn(),
}))

import { scaleToFit } from './opencv'
import { renderPage } from './filters'

function claheInstance() {
  return { apply: vi.fn(), delete: vi.fn() }
}

function mat(cols: number, rows: number): FakeMat {
  return Object.assign(new FakeMat(), { cols, rows })
}

describe('renderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeCv.CLAHE = vi.fn(function () {
      return claheInstance()
    })
    fakeCv.createCLAHE = undefined
    fakeCv.imread.mockImplementation(() => mat(200, 100))
  })

  it('enhances "Auto" with CLAHE via the constructor OpenCV.js 4.9 provides', async () => {
    await renderPage(canvas(200, 100), { ...DEFAULT_FILTER, mode: 'auto' })

    expect(fakeCv.CLAHE).toHaveBeenCalledWith(2, expect.anything())
    // Previously the missing createCLAHE threw and "Auto" quietly became a threshold.
    expect(fakeCv.adaptiveThreshold).not.toHaveBeenCalled()
  })

  it('uses the factory on builds that only have createCLAHE', async () => {
    fakeCv.CLAHE = undefined
    fakeCv.createCLAHE = vi.fn(() => claheInstance())

    await renderPage(canvas(200, 100), { ...DEFAULT_FILTER, mode: 'auto' })

    expect(fakeCv.createCLAHE).toHaveBeenCalled()
    expect(fakeCv.adaptiveThreshold).not.toHaveBeenCalled()
  })

  it('falls back to a threshold when CLAHE is unavailable', async () => {
    fakeCv.CLAHE = undefined

    await renderPage(canvas(200, 100), { ...DEFAULT_FILTER, mode: 'auto' })

    expect(fakeCv.adaptiveThreshold).toHaveBeenCalled()
  })

  it('scales the B&W threshold window with the image size', async () => {
    const blockSize = () => fakeCv.adaptiveThreshold.mock.calls.at(-1)?.[5]

    fakeCv.imread.mockImplementation(() => mat(1920, 1080))
    await renderPage(canvas(1920, 1080), { ...DEFAULT_FILTER, mode: 'blackwhite' })
    expect(blockSize()).toBe(15)

    fakeCv.imread.mockImplementation(() => mat(3840, 2160))
    await renderPage(canvas(3840, 2160), { ...DEFAULT_FILTER, mode: 'blackwhite' })
    expect(blockSize()).toBe(31)
  })

  it('renders previews from a downscaled copy', async () => {
    const source = canvas(3200, 2400)

    const result = await renderPage(source, { ...DEFAULT_FILTER, mode: 'color' }, 1600)

    expect(scaleToFit).toHaveBeenCalledWith(source, 1600)
    expect(result.width).toBe(1600)
  })

  it('returns the source untouched when nothing changes it', async () => {
    const source = canvas(200, 100)

    const result = await renderPage(source, { ...DEFAULT_FILTER, mode: 'color' })

    expect(result).toBe(source)
    expect(fakeCv.imread).not.toHaveBeenCalled()
  })

  it('adjusts brightness on a copy, never on the cropped source', async () => {
    const source = canvas(200, 100)

    const result = await renderPage(source, { ...DEFAULT_FILTER, mode: 'color', brightness: 20 })

    expect(result).not.toBe(source)
    expect(fakeCtx.putImageData).toHaveBeenCalled()
  })
})
