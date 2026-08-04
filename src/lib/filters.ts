import type { FilterSettings } from '../types'
import { blobToCanvas, canvasToBlob, getCv, imageToMat, loadOpenCV } from './opencv'

function applyBrightnessContrast(
  canvas: HTMLCanvasElement,
  brightness: number,
  contrast: number,
): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return canvas

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let value = data[i + c]
      value = factor * (value - 128) + 128 + brightness
      data[i + c] = Math.max(0, Math.min(255, value))
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

function canvasFromMat(cv: ReturnType<typeof getCv>, mat: import('./opencv').CvMat): HTMLCanvasElement {
  const output = document.createElement('canvas')
  cv.imshow(output, mat)
  return output
}

function autoEnhanceMagicColor(
  cv: ReturnType<typeof getCv>,
  src: import('./opencv').CvMat,
): HTMLCanvasElement {
  const rgb = new cv.Mat()
  const lab = new cv.Mat()
  const channels = new cv.MatVector()
  const enhanced = new cv.Mat()
  const merged = new cv.Mat()
  const result = new cv.Mat()
  let lChannel: import('./opencv').CvMat | null = null
  let clahe: import('./opencv').CvClahe | null = null

  try {
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab)
    cv.split(lab, channels)

    clahe = cv.createCLAHE(2.0, new cv.Size(8, 8))
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

function autoEnhanceThreshold(
  cv: ReturnType<typeof getCv>,
  src: import('./opencv').CvMat,
): HTMLCanvasElement {
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
      11,
      2,
    )
    cv.cvtColor(binary, rgba, cv.COLOR_GRAY2RGBA)
    return canvasFromMat(cv, rgba)
  } finally {
    gray.delete()
    binary.delete()
    rgba.delete()
  }
}

async function applyAutoEnhance(blob: Blob): Promise<HTMLCanvasElement> {
  await loadOpenCV()
  const cv = getCv()

  const canvas = await blobToCanvas(blob)
  const src = await imageToMat(canvas)

  try {
    return autoEnhanceMagicColor(cv, src)
  } catch {
    // Fallback: adaptive threshold gives a clean document look if the
    // LAB/CLAHE path is unavailable in this OpenCV build.
    return autoEnhanceThreshold(cv, src)
  } finally {
    src.delete()
  }
}

async function applyGrayscale(blob: Blob): Promise<HTMLCanvasElement> {
  await loadOpenCV()
  const cv = getCv()
  const canvas = await blobToCanvas(blob)
  const src = await imageToMat(canvas)
  const gray = new cv.Mat()
  const rgba = new cv.Mat()

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.cvtColor(gray, rgba, cv.COLOR_GRAY2RGBA)
    const output = document.createElement('canvas')
    output.width = canvas.width
    output.height = canvas.height
    cv.imshow(output, rgba)
    return output
  } finally {
    src.delete()
    gray.delete()
    rgba.delete()
  }
}

async function applyBlackWhite(blob: Blob): Promise<HTMLCanvasElement> {
  await loadOpenCV()
  const cv = getCv()
  const canvas = await blobToCanvas(blob)
  const src = await imageToMat(canvas)
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
      15,
      8,
    )
    cv.cvtColor(binary, rgba, cv.COLOR_GRAY2RGBA)
    const output = document.createElement('canvas')
    output.width = canvas.width
    output.height = canvas.height
    cv.imshow(output, rgba)
    return output
  } finally {
    src.delete()
    gray.delete()
    binary.delete()
    rgba.delete()
  }
}

export async function applyFilter(blob: Blob, settings: FilterSettings): Promise<Blob> {
  let canvas: HTMLCanvasElement

  switch (settings.mode) {
    case 'auto':
      canvas = await applyAutoEnhance(blob)
      break
    case 'grayscale':
      canvas = await applyGrayscale(blob)
      break
    case 'blackwhite':
      canvas = await applyBlackWhite(blob)
      break
    case 'color':
    default:
      canvas = await blobToCanvas(blob)
      break
  }

  if (settings.brightness !== 0 || settings.contrast !== 0) {
    canvas = applyBrightnessContrast(canvas, settings.brightness, settings.contrast)
  }

  return canvasToBlob(canvas)
}

export async function createThumbnail(blob: Blob, maxSize = 120): Promise<string> {
  const img = await blobToCanvas(blob)
  const scale = Math.min(maxSize / img.width, maxSize / img.height, 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return URL.createObjectURL(blob)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const thumbBlob = await canvasToBlob(canvas, 'image/jpeg', 0.7)
  return URL.createObjectURL(thumbBlob)
}
