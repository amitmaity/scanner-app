import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTER, type Page } from '../types'
import { downloadBlob, exportPagesAsImages, exportPagesToPdf } from './pdf'

vi.mock('./opencv', () => ({
  blobToImage: vi.fn(),
}))

import { blobToImage } from './opencv'

function makePage(id: string): Page {
  return {
    id,
    originalBlob: new Blob(['img']),
    corners: [],
    filter: { ...DEFAULT_FILTER },
    processedBlob: new Blob(['proc']),
    thumbnailUrl: null,
    createdAt: 1,
  }
}

function makeImg(): HTMLImageElement {
  return { naturalWidth: 10, naturalHeight: 10 } as HTMLImageElement
}

describe('pdf export', () => {
  beforeEach(() => {
    vi.mocked(blobToImage).mockReset()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    HTMLAnchorElement.prototype.click = vi.fn()
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.toBlob = ((cb: BlobCallback) => {
      cb(new Blob(['out'], { type: 'image/jpeg' }))
    }) as typeof HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,QQ==')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('aggregates per-page image export failures', async () => {
    vi.mocked(blobToImage)
      .mockResolvedValueOnce(makeImg())
      .mockRejectedValueOnce(new Error('decode failed'))
      .mockResolvedValueOnce(makeImg())

    await expect(
      exportPagesAsImages([makePage('a'), makePage('b'), makePage('c')], 'jpeg', 'scan'),
    ).rejects.toMatchObject({
      code: 'EXPORT_FAILED',
      message: 'Failed to export page 2.',
    })
  })

  it('names the failing PDF page', async () => {
    vi.mocked(blobToImage)
      .mockResolvedValueOnce(makeImg())
      .mockRejectedValueOnce(new Error('decode failed'))

    await expect(exportPagesToPdf([makePage('a'), makePage('b')], 'scan')).rejects.toMatchObject({
      code: 'EXPORT_FAILED',
      message: 'Failed to export page 2 of 2.',
    })
  })

  it('defers revoking the object URL so the download can start', () => {
    vi.useFakeTimers()
    downloadBlob(new Blob(['a']), 'a.jpg')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    vi.useRealTimers()
  })
})
