import type { Point } from '../types'
import { computeOutputSize, orderPoints } from './geometry'
import { blobToImage, createCanvas, get2d, getCv, loadOpenCV } from './opencv'

/**
 * Warps the quad at `corners` to a flat rectangle. Returns pixels rather than
 * an encoded image: the result is filtered and only encoded once, at save.
 */
export async function perspectiveCorrect(
  source: Blob | HTMLImageElement | HTMLCanvasElement,
  corners: Point[],
): Promise<HTMLCanvasElement> {
  await loadOpenCV()
  const cv = getCv()

  const image = source instanceof Blob ? await blobToImage(source) : source
  const ordered = orderPoints(corners)
  const { width, height } = computeOutputSize(ordered)

  const src = cv.imread(image)
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
    const output = createCanvas(width, height)
    cv.imshow(output, dst)
    return output
  } finally {
    src.delete()
    srcTri.delete()
    dstTri.delete()
    M.delete()
    dst.delete()
  }
}

/**
 * Rotates counter-clockwise by a multiple of 90° (the convention saved pages
 * already use). Quarter turns map pixels exactly, so unlike an affine warp
 * this neither blurs nor adds a border. Returns `canvas` itself for 0°.
 */
export function rotateCanvas(canvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const turns = ((Math.round(degrees / 90) % 4) + 4) % 4
  if (turns === 0) return canvas

  const swap = turns % 2 === 1
  const output = createCanvas(swap ? canvas.height : canvas.width, swap ? canvas.width : canvas.height)
  const ctx = get2d(output)
  ctx.translate(output.width / 2, output.height / 2)
  ctx.rotate((-turns * Math.PI) / 2)
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return output
}
