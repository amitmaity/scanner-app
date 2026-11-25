/** The slice of the OpenCV.js API this app uses. */
export interface OpenCvModule {
  Mat: new (...args: unknown[]) => CvMat
  MatVector: new () => CvMatVector
  Size: new (w: number, h: number) => unknown
  Scalar: new (...args: number[]) => unknown
  matFromImageData: (image: { width: number; height: number; data: ArrayLike<number> }) => CvMat
  matFromArray: (rows: number, cols: number, type: number, array: number[]) => CvMat
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
  /** OpenCV.js builds expose CLAHE as a class; the factory exists only in some. */
  CLAHE?: new (clipLimit: number, tileGridSize: unknown) => CvClahe
  createCLAHE?: (clipLimit: number, tileGridSize: unknown) => CvClahe
  adaptiveThreshold: (
    src: CvMat,
    dst: CvMat,
    maxValue: number,
    adaptiveMethod: number,
    thresholdType: number,
    blockSize: number,
    C: number,
  ) => void
  split: (src: CvMat, mv: CvMatVector) => void
  merge: (mv: CvMatVector, dst: CvMat) => void
  /** Turns a thrown C++ exception pointer into its message. */
  exceptionFromPtr?: (ptr: number) => { msg: string }
  COLOR_RGBA2GRAY: number
  COLOR_GRAY2RGBA: number
  COLOR_RGBA2RGB: number
  COLOR_RGB2RGBA: number
  COLOR_RGB2Lab: number
  COLOR_Lab2RGB: number
  CV_32FC2: number
  RETR_LIST: number
  CHAIN_APPROX_SIMPLE: number
  INTER_LINEAR: number
  BORDER_CONSTANT: number
  ADAPTIVE_THRESH_GAUSSIAN_C: number
  THRESH_BINARY: number
  onRuntimeInitialized?: () => void
}

export interface CvMat {
  rows: number
  cols: number
  data: Uint8Array
  data32S: Int32Array
  delete: () => void
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
