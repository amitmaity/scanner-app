import type { Point } from '../types'
import { warpQuad } from './cv/client'
import { blobToImage, canvasToRaw, createCanvas, get2d, rawToCanvas, scaleToFit } from './image'

/**
 * Warps the quad at `corners` to a flat rectangle. Returns pixels rather than
 * an encoded image: the result is filtered and only encoded once, at save.
 */
export async function perspectiveCorrect(
  source: Blob | HTMLImageElement | HTMLCanvasElement,
  corners: Point[],
): Promise<HTMLCanvasElement> {
  const image = source instanceof Blob ? await blobToImage(source) : source
  const canvas = image instanceof HTMLCanvasElement ? image : scaleToFit(image)
  return rawToCanvas(await warpQuad(canvasToRaw(canvas), corners))
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
