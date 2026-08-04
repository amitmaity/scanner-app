import type { Point } from '../types'
import { blobToCanvas, canvasToBlob, getCv, imageToMat, loadOpenCV } from './opencv'
import { computeOutputSize } from './detectEdges'

function orderPoints(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.y - b.y)
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x)
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x)
  return [top[0], top[1], bottom[1], bottom[0]]
}

export async function perspectiveCorrect(
  blob: Blob,
  corners: Point[],
): Promise<Blob> {
  await loadOpenCV()
  const cv = getCv()

  const canvas = await blobToCanvas(blob)
  const src = await imageToMat(canvas)
  const ordered = orderPoints(corners)
  const { width, height } = computeOutputSize(ordered)

  const srcTri = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    ordered.flatMap((p) => [p.x, p.y]),
  )
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    width, 0,
    width, height,
    0, height,
  ])

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

    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = width
    outputCanvas.height = height
    cv.imshow(outputCanvas, dst)
    return canvasToBlob(outputCanvas)
  } finally {
    src.delete()
    srcTri.delete()
    dstTri.delete()
    M.delete()
    dst.delete()
  }
}

export async function rotateImage(blob: Blob, degrees: number): Promise<Blob> {
  if (degrees % 360 === 0) return blob

  await loadOpenCV()
  const cv = getCv()

  const canvas = await blobToCanvas(blob)
  const src = await imageToMat(canvas)
  const center = new cv.Point(canvas.width / 2, canvas.height / 2)
  const M = cv.getRotationMatrix2D(center, degrees, 1)

  const matData = M as import('./opencv').CvMat & { data64F: Float64Array }
  const cos = Math.abs(matData.data64F[0])
  const sin = Math.abs(matData.data64F[1])
  const newWidth = Math.round(src.rows * sin + src.cols * cos)
  const newHeight = Math.round(src.rows * cos + src.cols * sin)

  matData.data64F[2] += newWidth / 2 - canvas.width / 2
  matData.data64F[5] += newHeight / 2 - canvas.height / 2

  const dst = new cv.Mat()
  try {
    cv.warpAffine(
      src,
      dst,
      M,
      new cv.Size(newWidth, newHeight),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255),
    )
    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = newWidth
    outputCanvas.height = newHeight
    cv.imshow(outputCanvas, dst)
    return canvasToBlob(outputCanvas)
  } finally {
    src.delete()
    M.delete()
    dst.delete()
  }
}
