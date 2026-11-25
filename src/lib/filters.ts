import type { FilterSettings } from '../types'
import {
  blobToImage,
  canvasToBlob,
  createCanvas,
  get2d,
  getCv,
  loadOpenCV,
  scaleToFit,
  type CvClahe,
  type CvMat,
  type ImageSource,
  type OpenCvModule,
} from './opencv'
import { rotateCanvas } from './perspective'

/** Long side of the enhance-screen preview. Full resolution is only rendered on save. */
export const PREVIEW_MAX_SIDE = 1600
/** Long side of page-grid thumbnails (~200 CSS px at 2x). */
export const THUMBNAIL_MAX_SIDE = 400

/**
 * Adaptive-threshold neighbourhood in pixels, scaled with the image so a
 * downscaled preview looks like the full-size result. `divisor` is chosen so a
 * 1920px image gets the block size these filters used before they scaled.
 */
function thresholdBlockSize(mat: CvMat, divisor: number): number {
  const size = Math.round(Math.max(mat.cols, mat.rows) / divisor)
  return Math.max(3, size % 2 === 0 ? size + 1 : size)
}

/** Mutates `canvas` in place; only call it on a canvas this module created. */
function applyBrightnessContrast(
  canvas: HTMLCanvasElement,
  brightness: number,
  contrast: number,
): void {
  const ctx = get2d(canvas, { willReadFrequently: true })
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] = factor * (data[i + c] - 128) + 128 + brightness
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

function createClahe(cv: OpenCvModule): CvClahe {
  const tileGrid = new cv.Size(8, 8)
  // The bundled OpenCV.js 4.9 only has the constructor; calling the missing
  // factory used to throw and silently turn "Auto" into a threshold.
  if (cv.CLAHE) return new cv.CLAHE(2.0, tileGrid)
  if (cv.createCLAHE) return cv.createCLAHE(2.0, tileGrid)
  throw new Error('CLAHE is not available in this OpenCV build')
}

function canvasFromMat(cv: OpenCvModule, mat: CvMat): HTMLCanvasElement {
  const output = createCanvas(mat.cols, mat.rows)
  cv.imshow(output, mat)
  return output
}

function magicColor(cv: OpenCvModule, src: CvMat): HTMLCanvasElement {
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
    return canvasFromMat(cv, result)
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

function threshold(cv: OpenCvModule, src: CvMat, divisor: number, C: number): HTMLCanvasElement {
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
    return canvasFromMat(cv, rgba)
  } finally {
    gray.delete()
    binary.delete()
    rgba.delete()
  }
}

function grayscale(cv: OpenCvModule, src: CvMat): HTMLCanvasElement {
  const gray = new cv.Mat()
  const rgba = new cv.Mat()
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.cvtColor(gray, rgba, cv.COLOR_GRAY2RGBA)
    return canvasFromMat(cv, rgba)
  } finally {
    gray.delete()
    rgba.delete()
  }
}

async function applyMode(canvas: HTMLCanvasElement, mode: FilterSettings['mode']) {
  if (mode === 'color') return canvas

  await loadOpenCV()
  const cv = getCv()
  const src = cv.imread(canvas)
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

/**
 * Rotates, filters and adjusts a cropped page, optionally at reduced size for
 * previews. May return `source` itself when nothing changes it, so callers must
 * treat the result as read-only.
 */
export async function renderPage(
  source: HTMLCanvasElement,
  settings: FilterSettings,
  maxSide = Infinity,
): Promise<HTMLCanvasElement> {
  let canvas =
    Math.max(source.width, source.height) > maxSide ? scaleToFit(source, maxSide) : source
  canvas = rotateCanvas(canvas, settings.rotation)
  canvas = await applyMode(canvas, settings.mode)

  if (settings.brightness !== 0 || settings.contrast !== 0) {
    if (canvas === source) canvas = scaleToFit(source)
    applyBrightnessContrast(canvas, settings.brightness, settings.contrast)
  }
  return canvas
}

export async function createThumbnail(
  source: Blob | ImageSource,
  maxSide = THUMBNAIL_MAX_SIDE,
): Promise<Blob> {
  const image = source instanceof Blob ? await blobToImage(source) : source
  return canvasToBlob(scaleToFit(image, maxSide), 'image/jpeg', 0.8)
}
