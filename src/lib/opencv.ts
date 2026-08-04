const BASE = import.meta.env.BASE_URL

let loadPromise: Promise<void> | null = null

declare global {
  interface Window {
    cv: OpenCvModule
  }
}

export interface OpenCvModule {
  Mat: new (...args: unknown[]) => CvMat
  MatVector: new () => CvMatVector
  Size: new (w: number, h: number) => unknown
  Point: new (x: number, y: number) => unknown
  Scalar: new (...args: number[]) => unknown
  imread: (source: HTMLCanvasElement | HTMLImageElement) => CvMat
  imshow: (canvas: HTMLCanvasElement, mat: CvMat) => void
  cvtColor: (src: CvMat, dst: CvMat, code: number) => void
  GaussianBlur: (src: CvMat, dst: CvMat, ksize: unknown, sigmaX: number) => void
  Canny: (src: CvMat, dst: CvMat, threshold1: number, threshold2: number) => void
  findContours: (
    image: CvMat,
    contours: CvMatVector,
    hierarchy: CvMat,
    mode: number,
    method: number,
  ) => void
  contourArea: (contour: CvMat) => number
  arcLength: (curve: CvMat, closed: boolean) => number
  approxPolyDP: (curve: CvMat, approxCurve: CvMat, epsilon: number, closed: boolean) => void
  getPerspectiveTransform: (src: CvMat, dst: CvMat) => CvMat
  warpPerspective: (
    src: CvMat,
    dst: CvMat,
    M: CvMat,
    dsize: unknown,
    flags?: number,
    borderMode?: number,
    borderValue?: unknown,
  ) => void
  getRotationMatrix2D: (center: unknown, angle: number, scale: number) => CvMat
  warpAffine: (
    src: CvMat,
    dst: CvMat,
    M: CvMat,
    dsize: unknown,
    flags?: number,
    borderMode?: number,
    borderValue?: unknown,
  ) => void
  createCLAHE: (clipLimit: number, tileGridSize: unknown) => CvClahe
  adaptiveThreshold: (
    src: CvMat,
    dst: CvMat,
    maxValue: number,
    adaptiveMethod: number,
    thresholdType: number,
    blockSize: number,
    C: number,
  ) => void
  COLOR_RGBA2GRAY: number
  COLOR_GRAY2RGBA: number
  COLOR_RGBA2RGB: number
  COLOR_RGB2RGBA: number
  COLOR_RGB2GRAY: number
  COLOR_RGB2Lab: number
  COLOR_Lab2RGB: number
  matFromArray: (rows: number, cols: number, type: number, array: number[]) => CvMat
  CV_32FC2: number
  split: (src: CvMat, mv: CvMatVector) => void
  merge: (mv: CvMatVector, dst: CvMat) => void
  RETR_LIST: number
  CHAIN_APPROX_SIMPLE: number
  INTER_LINEAR: number
  BORDER_CONSTANT: number
  ADAPTIVE_THRESH_GAUSSIAN_C: number
  THRESH_BINARY: number
  onRuntimeInitialized: () => void
}

export interface CvMat {
  rows: number
  cols: number
  data: Uint8Array
  data32S: Int32Array
  delete: () => void
  clone: () => CvMat
  setTo: (value: unknown) => void
}

export interface CvMatVector {
  size: () => number
  get: (index: number) => CvMat
  set: (index: number, value: CvMat) => void
  delete: () => void
}

export interface CvClahe {
  apply: (src: CvMat, dst: CvMat) => void
  delete: () => void
}

export function getCv(): OpenCvModule {
  if (!window.cv) {
    throw new Error('OpenCV.js is not loaded yet')
  }
  return window.cv
}

export function loadOpenCV(): Promise<void> {
  if (window.cv?.Mat) {
    return Promise.resolve()
  }

  if (loadPromise) {
    return loadPromise
  }

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${BASE}opencv/opencv.js`
    script.async = true
    script.onload = () => {
      const checkReady = () => {
        if (window.cv?.Mat) {
          resolve()
        } else if (window.cv) {
          window.cv.onRuntimeInitialized = () => resolve()
        } else {
          setTimeout(checkReady, 50)
        }
      }
      checkReady()
    }
    script.onerror = () => reject(new Error('Failed to load OpenCV.js'))
    document.head.appendChild(script)
  })

  return loadPromise
}

export async function imageToMat(image: HTMLImageElement | HTMLCanvasElement): Promise<CvMat> {
  await loadOpenCV()
  const cv = getCv()
  return cv.imread(image)
}

export function matToCanvas(mat: CvMat): HTMLCanvasElement {
  const cv = getCv()
  const canvas = document.createElement('canvas')
  cv.imshow(canvas, mat)
  return canvas
}

export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const img = await blobToImage(blob)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not get canvas context')
  ctx.drawImage(img, 0, 0)
  return canvas
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/jpeg',
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to create blob'))),
      type,
      quality,
    )
  })
}

export interface NormalizedImage {
  blob: Blob
  width: number
  height: number
}

/**
 * Bakes EXIF orientation into the pixels and strips metadata so that the
 * preview, edge detection, crop, and export all operate on identical,
 * upright image data.
 */
export async function normalizeImageOrientation(input: Blob): Promise<NormalizedImage> {
  let canvas: HTMLCanvasElement

  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' })
    } catch {
      bitmap = await createImageBitmap(input)
    }
    canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      throw new Error('Could not get canvas context')
    }
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
  } else {
    canvas = await blobToCanvas(input)
  }

  const blob = await canvasToBlob(canvas)
  return { blob, width: canvas.width, height: canvas.height }
}
