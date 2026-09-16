import { useState } from 'react'
import { normalizeError } from '../lib/errors'
import { exportPagesAsImages, exportPagesToPdf } from '../lib/pdf'
import type { Page } from '../types'

interface ExportDialogProps {
  pages: Page[]
  documentName: string
  onClose: () => void
}

export function ExportDialog({ pages, documentName, onClose }: ExportDialogProps) {
  const [filename, setFilename] = useState(
    documentName.replace(/[^\w\s-]/g, '').trim() || 'scan',
  )
  const [format, setFormat] = useState<'pdf' | 'jpeg' | 'png'>('pdf')
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)

  const handleExport = async () => {
    setIsExporting(true)
    setError(null)
    setProgress(null)
    try {
      const onProgress = (current: number, total: number) => setProgress({ current, total })
      if (format === 'pdf') {
        await exportPagesToPdf(pages, filename.trim(), onProgress)
      } else {
        await exportPagesAsImages(pages, format, filename.trim(), onProgress)
      }
      onClose()
    } catch (err) {
      const { message } = normalizeError(err, 'EXPORT_FAILED')
      setError(message)
      setIsExporting(false)
      setProgress(null)
    }
  }

  const exportLabel = isExporting
    ? progress
      ? `Exporting page ${progress.current} of ${progress.total}…`
      : 'Exporting…'
    : error
      ? 'Retry'
      : 'Export'

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
      >
        <h2 id="export-dialog-title">Export scan</h2>
        <p className="modal-subtitle">
          {pages.length} page{pages.length !== 1 ? 's' : ''}
        </p>

        <label className="form-label">
          Filename
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            className="form-input"
          />
        </label>

        <div className="export-formats">
          <label className="radio-label">
            <input
              type="radio"
              name="format"
              value="pdf"
              checked={format === 'pdf'}
              onChange={() => setFormat('pdf')}
            />
            PDF (multi-page)
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="format"
              value="jpeg"
              checked={format === 'jpeg'}
              onChange={() => setFormat('jpeg')}
            />
            JPEG images
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="format"
              value="png"
              checked={format === 'png'}
              onChange={() => setFormat('png')}
            />
            PNG images
          </label>
        </div>

        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isExporting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleExport()}
            disabled={isExporting || !filename.trim()}
          >
            {exportLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
