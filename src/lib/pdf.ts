import { jsPDF } from 'jspdf'
import type { Page } from '../types'
import { ScannerError } from './errors'
import { blobToImage } from './opencv'

interface RenderedPage {
  dataUrl: string
  width: number
  height: number
}

export type ExportProgress = (current: number, total: number) => void

const DOWNLOAD_REVOKE_MS = 60_000

async function renderPage(page: Page): Promise<RenderedPage> {
  const blob = page.processedBlob ?? page.originalBlob
  const img = await blobToImage(blob)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get canvas context')
  ctx.drawImage(img, 0, 0)
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
    width: img.naturalWidth,
    height: img.naturalHeight,
  }
}

export async function exportPagesToPdf(
  pages: Page[],
  filename: string,
  onProgress?: ExportProgress,
): Promise<void> {
  if (pages.length === 0) return

  let pdf: InstanceType<typeof jsPDF> | null = null

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i + 1, pages.length)
    let rendered: RenderedPage
    try {
      rendered = await renderPage(pages[i])
    } catch (err) {
      throw new ScannerError(
        'EXPORT_FAILED',
        `Failed to export page ${i + 1} of ${pages.length}.`,
        { cause: err },
      )
    }

    const orientation = rendered.width > rendered.height ? 'landscape' : 'portrait'
    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' })
    } else {
      pdf.addPage('a4', orientation)
    }

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const ratio = Math.min(pageWidth / rendered.width, pageHeight / rendered.height)
    const w = rendered.width * ratio
    const h = rendered.height * ratio
    const x = (pageWidth - w) / 2
    const y = (pageHeight - h) / 2

    pdf.addImage(rendered.dataUrl, 'JPEG', x, y, w, h)
  }

  pdf?.save(`${filename}.pdf`)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_MS)
}

export async function exportPagesAsImages(
  pages: Page[],
  format: 'png' | 'jpeg',
  baseName: string,
  onProgress?: ExportProgress,
): Promise<void> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  const ext = format === 'png' ? 'png' : 'jpg'
  const failures: number[] = []

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i + 1, pages.length)
    try {
      const blob = pages[i].processedBlob ?? pages[i].originalBlob
      const canvas = document.createElement('canvas')
      const img = await blobToImage(blob)
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not get canvas context')
      ctx.drawImage(img, 0, 0)

      const outBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to export image'))),
          mime,
          0.92,
        )
      })

      const suffix = pages.length > 1 ? `-${i + 1}` : ''
      downloadBlob(outBlob, `${baseName}${suffix}.${ext}`)
    } catch {
      failures.push(i + 1)
    }
  }

  if (failures.length > 0) {
    const list = failures.join(', ')
    const noun = failures.length === 1 ? 'page' : 'pages'
    throw new ScannerError('EXPORT_FAILED', `Failed to export ${noun} ${list}.`)
  }
}