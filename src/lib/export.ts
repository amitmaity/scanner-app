import type { Page } from '../types'
import { ScannerError } from './errors'
import { blobToImage, canvasToBlob, OUTPUT_JPEG_QUALITY, scaleToFit, sourceSize } from './opencv'

export type ExportFormat = 'pdf' | 'jpeg' | 'png'

export interface ExportFile {
  blob: Blob
  name: string
}

export type ExportProgress = (current: number, total: number) => void

const MIME_TYPES: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
}
const EXTENSIONS: Record<ExportFormat, string> = { pdf: 'pdf', jpeg: 'jpg', png: 'png' }

const DOWNLOAD_REVOKE_MS = 60_000
/** Gap between multi-file downloads; back-to-back clicks get dropped. */
const DOWNLOAD_SPACING_MS = 300
const MAX_FILENAME_LENGTH = 100

/** Replaces characters that file systems reject, keeping letters in any language. */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .slice(0, MAX_FILENAME_LENGTH)
}

export function exportFailureError(failedPages: number[]): ScannerError {
  const noun = failedPages.length === 1 ? 'page' : 'pages'
  return new ScannerError('EXPORT_FAILED', `Failed to export ${noun} ${failedPages.join(', ')}.`)
}

function pageImage(page: Page): Blob {
  return page.processedBlob ?? page.originalBlob
}

/** The page as JPEG bytes. Saved pages already are JPEG and are embedded
 * as-is: re-encoding would only lose quality. */
async function jpegForPdf(page: Page): Promise<{ data: Uint8Array; width: number; height: number }> {
  const blob = pageImage(page)
  const image = await blobToImage(blob)
  const { width, height } = sourceSize(image)
  const jpeg =
    blob.type === 'image/jpeg'
      ? blob
      : await canvasToBlob(scaleToFit(image), 'image/jpeg', OUTPUT_JPEG_QUALITY)
  return { data: new Uint8Array(await jpeg.arrayBuffer()), width, height }
}

export async function buildPdf(
  pages: Page[],
  baseName: string,
  onProgress?: ExportProgress,
): Promise<ExportFile> {
  if (pages.length === 0) throw new ScannerError('EXPORT_FAILED')

  // jsPDF is large and only needed here, so it loads on first export.
  const { jsPDF } = await import('jspdf')
  let pdf: InstanceType<typeof jsPDF> | null = null

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i + 1, pages.length)
    let image: Awaited<ReturnType<typeof jpegForPdf>>
    try {
      image = await jpegForPdf(pages[i])
    } catch (err) {
      throw new ScannerError(
        'EXPORT_FAILED',
        `Failed to export page ${i + 1} of ${pages.length}.`,
        { cause: err },
      )
    }

    const orientation = image.width > image.height ? 'landscape' : 'portrait'
    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' })
    } else {
      pdf.addPage('a4', orientation)
    }

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const ratio = Math.min(pageWidth / image.width, pageHeight / image.height)
    const w = image.width * ratio
    const h = image.height * ratio
    pdf.addImage(image.data, 'JPEG', (pageWidth - w) / 2, (pageHeight - h) / 2, w, h)
  }

  if (!pdf) throw new ScannerError('EXPORT_FAILED')
  return { blob: pdf.output('blob'), name: `${baseName}.pdf` }
}

export interface ImageExportResult {
  files: ExportFile[]
  /** 1-based numbers of pages that couldn't be converted. */
  failedPages: number[]
}

export async function buildImages(
  pages: Page[],
  format: 'jpeg' | 'png',
  baseName: string,
  onProgress?: ExportProgress,
): Promise<ImageExportResult> {
  const files: ExportFile[] = []
  const failedPages: number[] = []

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i + 1, pages.length)
    try {
      const source = pageImage(pages[i])
      const blob =
        format === 'jpeg' && source.type === 'image/jpeg'
          ? source
          : await canvasToBlob(
              scaleToFit(await blobToImage(source)),
              MIME_TYPES[format],
              OUTPUT_JPEG_QUALITY,
            )
      const suffix = pages.length > 1 ? `-${i + 1}` : ''
      files.push({ blob, name: `${baseName}${suffix}.${EXTENSIONS[format]}` })
    } catch {
      failedPages.push(i + 1)
    }
  }

  return { files, failedPages }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_MS)
}

export async function downloadFiles(files: ExportFile[]): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await new Promise((resolve) => window.setTimeout(resolve, DOWNLOAD_SPACING_MS))
    downloadBlob(files[i].blob, files[i].name)
  }
}

function toFiles(files: ExportFile[]): File[] {
  return files.map((f) => new File([f.blob], f.name, { type: f.blob.type }))
}

/** Whether this device can hand files of `format` to the system share sheet. */
export function canShareFormat(format: ExportFormat): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false
  }
  try {
    const probe = new File([], `scan.${EXTENSIONS[format]}`, { type: MIME_TYPES[format] })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

export async function shareFiles(files: ExportFile[], title: string): Promise<void> {
  await navigator.share({ files: toFiles(files), title })
}
