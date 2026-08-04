import { useState } from 'react'
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

  const handleExport = async () => {
    setIsExporting(true)
    setError(null)
    try {
      if (format === 'pdf') {
        await exportPagesToPdf(pages, filename)
      } else {
        await exportPagesAsImages(pages, format, filename)
      }
      onClose()
    } catch {
      setError('Export failed. Please try again.')
      setIsExporting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>Export scan</h2>
        <p className="modal-subtitle">{pages.length} page{pages.length !== 1 ? 's' : ''}</p>

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

        {error && <p className="error-banner">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isExporting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExport}
            disabled={isExporting || !filename.trim()}
          >
            {isExporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
