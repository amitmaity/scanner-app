import { jsPDF } from 'jspdf'
import type { Page } from '../types'
import { blobToImage } from './opencv'

interface RenderedPage {
  dataUrl: string
  width: number
  height: number
}

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

export async function exportPagesToPdf(pages: Page[], filename: string): Promise<void> {
  if (pages.length === 0) return

  const first = await renderPage(pages[0])
  const orientation = first.width > first.height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' })

  for (let i = 0; i < pages.length; i++) {
    const rendered = i === 0 ? first : await renderPage(pages[i])

    if (i > 0) {
      const pageOrientation = rendered.width > rendered.height ? 'landscape' : 'portrait'
      pdf.addPage('a4', pageOrientation)
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

  pdf.save(`${filename}.pdf`)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportPagesAsImages(
  pages: Page[],
  format: 'png' | 'jpeg',
  baseName: string,
): Promise<void> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  const ext = format === 'png' ? 'png' : 'jpg'

  for (let i = 0; i < pages.length; i++) {
    const blob = pages[i].processedBlob ?? pages[i].originalBlob
    const canvas = document.createElement('canvas')
    const img = await blobToImage(blob)
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
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
  }
}
