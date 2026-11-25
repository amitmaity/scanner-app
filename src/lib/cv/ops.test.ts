import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adjustBrightnessContrast, detectQuad, filterImage, runOp, warpQuad } from './ops'
import type { RawImage } from './protocol'
import type { OpenCvModule } from './types'

class FakeMat {
  rows = 0
  cols = 0
  data = new Uint8Array(0)
  data32S = new Int32Array(0)
  delete = vi.fn()
}

function rgbaMat(cols: number, rows: number, fill = 0): FakeMat {
  return Object.assign(new FakeMat(), {
    cols,
    rows,
    data: new Uint8Array(cols * rows * 4).fill(fill),
  })
}

function makeCv() {
  const cv = {
    Mat: FakeMat,
    MatVector: class {
      items: FakeMat[] = []
      size = () => this.items.length
      get = (i: number) => this.items[i]
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
    Scalar: class {},
    matFromImageData: vi.fn((image: RawImage) => rgbaMat(image.width, image.height)),
    matFromArray: vi.fn(() => new FakeMat()),
    // Keeps size and makes the output RGBA, like the real conversions do.
    cvtColor: vi.fn((src: FakeMat, dst: FakeMat) => {
      Object.assign(dst, rgbaMat(src.cols, src.rows, 200))
    }),
    GaussianBlur: vi.fn(),
    Canny: vi.fn(),
    findContours: vi.fn(),
    contourArea: vi.fn(() => 0),
    arcLength: vi.fn(() => 0),
    approxPolyDP: vi.fn(),
    getPerspectiveTransform: vi.fn(() => new FakeMat()),
    warpPerspective: vi.fn((_src: FakeMat, dst: FakeMat, _m: unknown, size: { width: number; height: number }) => {
      Object.assign(dst, rgbaMat(size.width, size.height, 255))
    }),
    CLAHE: vi.fn(function () {
      return { apply: vi.fn(), delete: vi.fn() }
    }) as unknown,
    createCLAHE: undefined as unknown,
    adaptiveThreshold: vi.fn(),
    split: vi.fn(),
    merge: vi.fn(),
    COLOR_RGBA2GRAY: 1,
    COLOR_GRAY2RGBA: 2,
    COLOR_RGBA2RGB: 3,
    COLOR_RGB2RGBA: 4,
    COLOR_RGB2Lab: 5,
    COLOR_Lab2RGB: 6,
    CV_32FC2: 7,
    RETR_LIST: 8,
    CHAIN_APPROX_SIMPLE: 9,
    INTER_LINEAR: 10,
    BORDER_CONSTANT: 11,
    ADAPTIVE_THRESH_GAUSSIAN_C: 12,
    THRESH_BINARY: 13,
  }
  return cv
}

function raw(width: number, height: number, fill = 100): RawImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(fill) }
}

const asCv = (cv: ReturnType<typeof makeCv>) => cv as unknown as OpenCvModule

describe('filterImage', () => {
  let cv: ReturnType<typeof makeCv>

  beforeEach(() => {
    cv = makeCv()
  })

  it('enhances "Auto" with CLAHE via the constructor OpenCV.js 4.9 provides', () => {
    filterImage(asCv(cv), raw(20, 10), { mode: 'auto', brightness: 0, contrast: 0 })

    expect(cv.CLAHE).toHaveBeenCalledWith(2, expect.anything())
    // Previously the missing createCLAHE threw and "Auto" quietly became a threshold.
    expect(cv.adaptiveThreshold).not.toHaveBeenCalled()
  })

  it('uses the factory on builds that only have createCLAHE', () => {
    cv.CLAHE = undefined
    cv.createCLAHE = vi.fn(() => ({ apply: vi.fn(), delete: vi.fn() }))

    filterImage(asCv(cv), raw(20, 10), { mode: 'auto', brightness: 0, contrast: 0 })

    expect(cv.createCLAHE).toHaveBeenCalled()
    expect(cv.adaptiveThreshold).not.toHaveBeenCalled()
  })

  it('falls back to a threshold when CLAHE is unavailable', () => {
    cv.CLAHE = undefined

    filterImage(asCv(cv), raw(20, 10), { mode: 'auto', brightness: 0, contrast: 0 })

    expect(cv.adaptiveThreshold).toHaveBeenCalled()
  })

  it('scales the B&W threshold window with the image size', () => {
    const blockSize = () => cv.adaptiveThreshold.mock.calls.at(-1)?.[5]
    const bw = { mode: 'blackwhite', brightness: 0, contrast: 0 } as const

    filterImage(asCv(cv), raw(1920, 1080), bw)
    expect(blockSize()).toBe(15)

    filterImage(asCv(cv), raw(3840, 2160), bw)
    expect(blockSize()).toBe(31)
  })

  it('returns RGBA pixels the same size as the input', () => {
    const output = filterImage(asCv(cv), raw(20, 10), {
      mode: 'grayscale',
      brightness: 0,
      contrast: 0,
    })

    expect(output.width).toBe(20)
    expect(output.height).toBe(10)
    expect(output.data).toHaveLength(20 * 10 * 4)
  })

  it('adjusts plain colour without OpenCV', () => {
    const image = raw(2, 1, 100)

    const output = filterImage(null, image, { mode: 'color', brightness: 20, contrast: 0 })

    expect(Array.from(output.data.slice(0, 4))).toEqual([120, 120, 120, 100])
  })

  it('needs OpenCV for the other modes', () => {
    expect(() => filterImage(null, raw(2, 2), { mode: 'auto', brightness: 0, contrast: 0 })).toThrow(
      'OpenCV is not loaded',
    )
  })
})

describe('adjustBrightnessContrast', () => {
  it('stretches around mid-grey, clamps, and leaves alpha alone', () => {
    const data = new Uint8ClampedArray([100, 128, 250, 77])

    adjustBrightnessContrast(data, 0, 100)

    // factor = 259 * 355 / (255 * 159) ≈ 2.2677, so 100 → 64.50 → 65
    expect(data[0]).toBe(65)
    expect(data[1]).toBe(128)
    expect(data[2]).toBe(255)
    expect(data[3]).toBe(77)
  })
})

describe('detectQuad', () => {
  it('returns null when no page outline is found', () => {
    expect(detectQuad(asCv(makeCv()), raw(100, 80))).toBeNull()
  })

  it('returns the largest convex quad, ordered and in image pixels', () => {
    const cv = makeCv()
    const contour = new FakeMat()
    cv.findContours.mockImplementation((_img, contours: { items: FakeMat[] }) => {
      contours.items.push(contour)
    })
    cv.contourArea.mockReturnValue(5000)
    cv.approxPolyDP.mockImplementation((_c, approx: FakeMat) => {
      approx.rows = 4
      approx.data32S = new Int32Array([90, 70, 10, 10, 90, 10, 10, 70])
    })

    expect(detectQuad(asCv(cv), raw(100, 80))).toEqual([
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 70 },
      { x: 10, y: 70 },
    ])
    expect(contour.delete).toHaveBeenCalled()
  })
})

describe('warpQuad', () => {
  it('outputs the size of the longer opposite edges', () => {
    const output = warpQuad(asCv(makeCv()), raw(100, 100), [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 0, y: 30 },
    ])

    expect(output.width).toBe(40)
    expect(output.height).toBe(30)
    expect(output.data).toHaveLength(40 * 30 * 4)
  })
})

describe('runOp', () => {
  it('transfers output pixel buffers back', () => {
    const { result, transfer } = runOp(asCv(makeCv()), {
      type: 'filter',
      image: raw(4, 4),
      options: { mode: 'grayscale', brightness: 0, contrast: 0 },
    })

    expect(transfer).toEqual([(result as RawImage).data.buffer])
  })
})
