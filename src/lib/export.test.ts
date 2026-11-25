import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTER, type Page } from '../types'

const pdfInstance = {
  addPage: vi.fn(),
  addImage: vi.fn(),
  output: vi.fn(() => new Blob(['%PDF'], { type: 'application/pdf' })),
  internal: { pageSize: { getWidth: () => 595, getHeight: () => 842 } },
}
const jsPDFConstructor = vi.fn(() => pdfInstance)

vi.mock('jspdf', () => ({
  jsPDF: function (...args: unknown[]) {
    return jsPDFConstructor(...(args as []))
  },
}))

vi.mock('./opencv', () => ({
  OUTPUT_JPEG_QUALITY: 0.92,
  blobToImage: vi.fn(),
  canvasToBlob: vi.fn(),
  scaleToFit: vi.fn(() => document.createElement('canvas')),
  sourceSize: (img: { naturalWidth: number; naturalHeight: number }) => ({
    width: img.naturalWidth,
    height: img.naturalHeight,
  }),
}))

import { blobToImage, canvasToBlob } from './opencv'
import {
  buildImages,
  buildPdf,
  canShareFormat,
  downloadBlob,
  downloadFiles,
  sanitizeFilename,
} from './export'

function jpeg(content = 'jpeg-bytes'): Blob {
  return new Blob([content], { type: 'image/jpeg' })
}

function makePage(id: string, processed: Blob | null = jpeg()): Page {
  return {
    id,
    originalBlob: jpeg('original'),
    corners: [],
    filter: { ...DEFAULT_FILTER },
    processedBlob: processed,
    thumbnailBlob: null,
    thumbnailUrl: null,
    createdAt: 1,
  }
}

function makeImg(width = 100, height = 200): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement
}

describe('export', () => {
  beforeEach(() => {
    vi.mocked(blobToImage).mockReset().mockResolvedValue(makeImg())
    vi.mocked(canvasToBlob).mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    jsPDFConstructor.mockClear()
    pdfInstance.addPage.mockClear()
    pdfInstance.addImage.mockClear()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    HTMLAnchorElement.prototype.click = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('buildPdf', () => {
    it('embeds each saved JPEG as-is, one page per scan', async () => {
      const file = await buildPdf([makePage('a'), makePage('b')], 'scan')

      expect(file.name).toBe('scan.pdf')
      expect(file.blob.type).toBe('application/pdf')
      expect(pdfInstance.addPage).toHaveBeenCalledTimes(1)
      expect(pdfInstance.addImage).toHaveBeenCalledTimes(2)
      const [data, format] = pdfInstance.addImage.mock.calls[0] as unknown as [Uint8Array, string]
      expect(format).toBe('JPEG')
      expect(new TextDecoder().decode(data)).toBe('jpeg-bytes')
      // No canvas re-encode for JPEG pages.
      expect(canvasToBlob).not.toHaveBeenCalled()
    })

    it('uses landscape pages for wide scans', async () => {
      vi.mocked(blobToImage).mockResolvedValue(makeImg(300, 100))

      await buildPdf([makePage('a')], 'scan')

      expect(jsPDFConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ orientation: 'landscape' }),
      )
    })

    it('names the failing PDF page', async () => {
      vi.mocked(blobToImage)
        .mockResolvedValueOnce(makeImg())
        .mockRejectedValueOnce(new Error('decode failed'))

      await expect(buildPdf([makePage('a'), makePage('b')], 'scan')).rejects.toMatchObject({
        code: 'EXPORT_FAILED',
        message: 'Failed to export page 2 of 2.',
      })
    })
  })

  describe('buildImages', () => {
    it('reuses saved JPEGs without re-encoding and numbers multi-page files', async () => {
      const pages = [makePage('a'), makePage('b')]

      const { files, failedPages } = await buildImages(pages, 'jpeg', 'scan')

      expect(failedPages).toEqual([])
      expect(files.map((f) => f.name)).toEqual(['scan-1.jpg', 'scan-2.jpg'])
      expect(files[0].blob).toBe(pages[0].processedBlob)
      expect(canvasToBlob).not.toHaveBeenCalled()
    })

    it('converts to PNG', async () => {
      const { files } = await buildImages([makePage('a')], 'png', 'scan')

      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('scan.png')
      expect(canvasToBlob).toHaveBeenCalledWith(expect.anything(), 'image/png', 0.92)
    })

    it('reports pages that fail while keeping the rest', async () => {
      vi.mocked(canvasToBlob)
        .mockResolvedValueOnce(new Blob(['1']))
        .mockRejectedValueOnce(new Error('encode failed'))
        .mockResolvedValueOnce(new Blob(['3']))

      const { files, failedPages } = await buildImages(
        [makePage('a'), makePage('b'), makePage('c')],
        'png',
        'scan',
      )

      expect(failedPages).toEqual([2])
      expect(files.map((f) => f.name)).toEqual(['scan-1.png', 'scan-3.png'])
    })
  })

  describe('delivery', () => {
    it('defers revoking the object URL so the download can start', () => {
      vi.useFakeTimers()
      downloadBlob(new Blob(['a']), 'a.jpg')
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      vi.advanceTimersByTime(60_000)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    })

    it('spaces out multiple downloads', async () => {
      vi.useFakeTimers()
      const done = downloadFiles([
        { blob: new Blob(['1']), name: '1.jpg' },
        { blob: new Blob(['2']), name: '2.jpg' },
      ])
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(300)
      await done
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2)
    })

    it('only offers sharing where the browser can share files', () => {
      expect(canShareFormat('pdf')).toBe(false)

      Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true })
      try {
        expect(canShareFormat('pdf')).toBe(true)
      } finally {
        Reflect.deleteProperty(navigator, 'share')
        Reflect.deleteProperty(navigator, 'canShare')
      }
    })
  })

  describe('sanitizeFilename', () => {
    it('replaces characters file systems reject but keeps other letters', () => {
      expect(sanitizeFilename('Scan 25/11/2026, 13:42:59')).toBe('Scan 25-11-2026, 13-42-59')
      expect(sanitizeFilename('Reçu été 東京')).toBe('Reçu été 東京')
      expect(sanitizeFilename('  ..secret?  ')).toBe('secret')
    })
  })
})
