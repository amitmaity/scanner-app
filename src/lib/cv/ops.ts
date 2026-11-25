/**
 * OpenCV work that runs inside the worker. Everything takes and returns
 * RawImage pixels, so nothing here touches the DOM, and `cv` is passed in so
 * tests can supply a fake.
 */
import type { FilterMode, Point } from '../../types'
import { computeOutputSize, isConvexQuad, orderPoints } from '../geometry'
import type { CvOpRequest, FilterOptions, RawImage } from './protocol'
import type { CvClahe, CvMat, OpenCvModule } from './types'

/** Ignore contours smaller than this share of the image. */
const MIN_AREA_RATIO = 0.05

export function requireCv(cv: OpenCvModule | null): OpenCvModule {
  if (!cv) throw new Error('OpenCV is not loaded')
  return cv
}

function toMat(cv: OpenCvModule, image: RawImage): CvMat {
  return cv.matFromImageData(image)
}

/** Copies an RGBA Mat out of the WebAssembly heap so it can be transferred. */
function toRaw(mat: CvMat): RawImage {
  return { width: mat.cols, height: mat.rows, data: new Uint8ClampedArray(mat.data) }
}

function matToPoints(mat: { data32S: Int32Array }): Point[] {
  const points: Point[] = []
  for (let i = 0; i < mat.data32S.length; i += 2) {
    points.push({ x: mat.data32S[i], y: mat.data32S[i + 1] })
  }
  return points
}

/** The largest convex four-sided contour, top-left first and clockwise, or null. */
export function detectQuad(cv: OpenCvModule, image: RawImage): Point[] | null {
  const src = toMat(cv, image)
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
    const minArea = image.width * image.height * MIN_AREA_RATIO

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
    return bestPoints
  } finally {
    src.delete()
    gray.delete()
    blurred.delete()
    edges.delete()
    contours.delete()
    hierarchy.delete()
  }
}

/** Warps the quad at `corners` to a flat rectangle sized by its longer edges. */
export function warpQuad(cv: OpenCvModule, image: RawImage, corners: Point[]): RawImage {
  const ordered = orderPoints(corners)
  const { width, height } = computeOutputSize(ordered)

  const src = toMat(cv, image)
  const srcTri = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    ordered.flatMap((p) => [p.x, p.y]),
  )
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height])
  const M = cv.getPerspectiveTransform(srcTri, dstTri)
  const dst = new cv.Mat()

  try {
    cv.warpPerspective(
      src,
      dst,
      M,
      new cv.Size(width, height),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255),
    )
    return toRaw(dst)
  } finally {
    src.delete()
    srcTri.delete()
    dstTri.delete()
    M.delete()
    dst.delete()
  }
}

/**
 * Adaptive-threshold neighbourhood in pixels, scaled with the image so a
 * downscaled preview looks like the full-size result. `divisor` is chosen so a
 * 1920px image gets the block size these filters used before they scaled.
 */
function thresholdBlockSize(mat: CvMat, divisor: number): number {
  const size = Math.round(Math.max(mat.cols, mat.rows) / divisor)
  return Math.max(3, size % 2 === 0 ? size + 1 : size)
}

function createClahe(cv: OpenCvModule): CvClahe {
  const tileGrid = new cv.Size(8, 8)
  // The bundled OpenCV.js 4.9 only has the constructor; calling the missing
  // factory used to throw and silently turn "Auto" into a threshold.
  if (cv.CLAHE) return new cv.CLAHE(2.0, tileGrid)
  if (cv.createCLAHE) return cv.createCLAHE(2.0, tileGrid)
  throw new Error('CLAHE is not available in this OpenCV build')
}

/** Boosts local contrast on the lightness channel only, keeping colours. */
function magicColor(cv: OpenCvModule, src: CvMat): RawImage {
  const rgb = new cv.Mat()
  const lab = new cv.Mat()
  const channels = new cv.MatVector()
  const enhanced = new cv.Mat()
  const merged = new cv.Mat()
  const result = new cv.Mat()
  let lChannel: CvMat | null = null
  let clahe: CvClahe | null = null

  try {
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab)
    cv.split(lab, channels)

    clahe = createClahe(cv)
    // MatVector.get() returns a separately-owned Mat; keep the reference so we
    // can delete it exactly once. set() copies `enhanced` back into the vector.
    lChannel = channels.get(0)
    clahe.apply(lChannel, enhanced)
    channels.set(0, enhanced)

    cv.merge(channels, merged)
    cv.cvtColor(merged, result, cv.COLOR_Lab2RGB)
    cv.cvtColor(result, result, cv.COLOR_RGB2RGBA)
    return toRaw(result)
  } finally {
    clahe?.delete()
    lChannel?.delete()
    rgb.delete()
    lab.delete()
    channels.delete()
    enhanced.delete()
    merged.delete()
    result.delete()
  }
}

function threshold(cv: OpenCvModule, src: CvMat, divisor: number, C: number): RawImage {
  const gray = new cv.Mat()
  const binary = new cv.Mat()
  const rgba = new cv.Mat()
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.adaptiveThreshold(
      gray,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      thresholdBlockSize(gray, divisor),
      C,
    )
    cv.cvtColor(binary, rgba, cv.COLOR_GRAY2RGBA)
    return toRaw(rgba)
  } finally {
    gray.delete()
    binary.delete()
    rgba.delete()
  }
}

function grayscale(cv: OpenCvModule, src: CvMat): RawImage {
  const gray = new cv.Mat()
  const rgba = new cv.Mat()
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.cvtColor(gray, rgba, cv.COLOR_GRAY2RGBA)
    return toRaw(rgba)
  } finally {
    gray.delete()
    rgba.delete()
  }
}

function applyMode(cv: OpenCvModule, image: RawImage, mode: Exclude<FilterMode, 'color'>): RawImage {
  const src = toMat(cv, image)
  try {
    switch (mode) {
      case 'grayscale':
        return grayscale(cv, src)
      case 'blackwhite':
        return threshold(cv, src, 128, 8)
      case 'auto':
      default:
        try {
          return magicColor(cv, src)
        } catch {
          // Adaptive threshold still gives a clean document look if the
          // LAB/CLAHE path is unavailable in this OpenCV build.
          return threshold(cv, src, 175, 2)
        }
    }
  } finally {
    src.delete()
  }
}

/** Contrast stretch around mid-grey plus a brightness offset, in place. */
export function adjustBrightnessContrast(
  data: Uint8ClampedArray,
  brightness: number,
  contrast: number,
): void {
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
  for (let i = 0; i < data.length; i += 4) {
    // Uint8ClampedArray rounds and clamps to 0–255 on assignment.
    data[i] = factor * (data[i] - 128) + 128 + brightness
    data[i + 1] = factor * (data[i + 1] - 128) + 128 + brightness
    data[i + 2] = factor * (data[i + 2] - 128) + 128 + brightness
  }
}

/** "Color" with only brightness or contrast needs no OpenCV at all. */
export function filterImage(
  cv: OpenCvModule | null,
  image: RawImage,
  options: FilterOptions,
): RawImage {
  const result = options.mode === 'color' ? image : applyMode(requireCv(cv), image, options.mode)
  if (options.brightness !== 0 || options.contrast !== 0) {
    adjustBrightnessContrast(result.data, options.brightness, options.contrast)
  }
  return result
}

export interface OpResult {
  result: unknown
  transfer: Transferable[]
}

export function runOp(cv: OpenCvModule | null, request: CvOpRequest): OpResult {
  switch (request.type) {
    case 'detect':
      return { result: detectQuad(requireCv(cv), request.image), transfer: [] }
    case 'warp': {
      const output = warpQuad(requireCv(cv), request.image, request.corners)
      return { result: output, transfer: [output.data.buffer] }
    }
    case 'filter': {
      const output = filterImage(cv, request.image, request.options)
      return { result: output, transfer: [output.data.buffer] }
    }
  }
}
