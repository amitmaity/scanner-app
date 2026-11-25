import type { FilterMode, Point } from '../../types'

/**
 * RGBA pixels in row order, the layout ImageData uses. The buffer is
 * transferred between threads rather than copied, so the sender must not use
 * it after posting.
 */
export interface RawImage {
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

export interface FilterOptions {
  mode: FilterMode
  brightness: number
  contrast: number
}

export type CvRequest =
  /** Download and start OpenCV.js. */
  | { type: 'init'; url: string }
  /** Find the page outline. Result: four corners in image pixels, or null. */
  | { type: 'detect'; image: RawImage }
  /** Flatten the quad at `corners`. Result: RawImage. */
  | { type: 'warp'; image: RawImage; corners: Point[] }
  /** Apply a filter mode, then brightness and contrast. Result: RawImage. */
  | { type: 'filter'; image: RawImage; options: FilterOptions }

export type CvOpRequest = Exclude<CvRequest, { type: 'init' }>

export type CvMessage = CvRequest & { id: number }

export type CvResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; message: string }
