import { useEffect, useMemo, useState } from 'react'
import { normalizeError } from '../lib/errors'
import {
  buildImages,
  buildPdf,
  canShareFormat,
  downloadFiles,
  exportFailureError,
  sanitizeFilename,
  shareFiles,
  type ExportFile,
  type ExportFormat,
  type ImageExportResult,
} from '../lib/export'
import type { Page } from '../types'

interface ExportDialogProps {
  pages: Page[]
  documentName: string
  onClose: () => void
}

type Delivery = 'share' | 'download'

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF (multi-page)' },
  { id: 'jpeg', label: 'JPEG images' },
  { id: 'png', label: 'PNG images' },
]

/** navigator.share rejects with DOMExceptions, which aren't `instanceof Error` everywhere. */
function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : ''
}

export function ExportDialog({ pages, documentName, onClose }: ExportDialogProps) {
  const [filename, setFilename] = useState(() => sanitizeFilename(documentName) || 'scan')
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [busy, setBusy] = useState<Delivery | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  /** Files built for sharing after the tap that started it expired. */
  const [readyToShare, setReadyToShare] = useState<ExportFile[] | null>(null)
  const canShare = useMemo(() => canShareFormat(format), [format])

  // Escape and backdrop taps close the dialog, but never mid-export.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const build = async (): Promise<ImageExportResult> => {
    const baseName = sanitizeFilename(filename) || 'scan'
    const onProgress = (current: number, total: number) => setProgress({ current, total })
    if (format === 'pdf') {
      return { files: [await buildPdf(pages, baseName, onProgress)], failedPages: [] }
    }
    return buildImages(pages, format, baseName, onProgress)
  }

  const finish = () => {
    setBusy(null)
    setProgress(null)
  }

  const handleExport = async (delivery: Delivery) => {
    setBusy(delivery)
    setError(null)
    setProgress(null)
    setReadyToShare(null)
    try {
      const { files, failedPages } = await build()
      if (files.length > 0) {
        if (delivery === 'share') {
          try {
            await shareFiles(files, documentName)
          } catch (err) {
            if (errorName(err) === 'AbortError') {
              // The user closed the share sheet; let them pick again.
              finish()
              return
            }
            if (errorName(err) === 'NotAllowedError') {
              // Preparing took longer than the browser keeps the tap's
              // permission to share. Ask for one more tap.
              setReadyToShare(files)
              finish()
              return
            }
            throw err
          }
        } else {
          await downloadFiles(files)
        }
      }
      if (failedPages.length > 0) throw exportFailureError(failedPages)
      onClose()
    } catch (err) {
      setError(normalizeError(err, 'EXPORT_FAILED').message)
      finish()
    }
  }

  const handleShareReady = async () => {
    if (!readyToShare) return
    try {
      await shareFiles(readyToShare, documentName)
      onClose()
    } catch (err) {
      if (errorName(err) !== 'AbortError') setError(normalizeError(err, 'EXPORT_FAILED').message)
    }
  }

  const progressLabel = progress
    ? `Preparing page ${progress.current} of ${progress.total}…`
    : 'Preparing…'

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()} role="presentation">
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
            disabled={busy !== null}
            autoFocus
          />
        </label>

        <div className="export-formats" role="radiogroup" aria-label="Format">
          {FORMATS.map(({ id, label }) => (
            <label key={id} className="radio-label">
              <input
                type="radio"
                name="format"
                value={id}
                checked={format === id}
                onChange={() => {
                  setFormat(id)
                  setReadyToShare(null)
                }}
                disabled={busy !== null}
              />
              {label}
            </label>
          ))}
        </div>

        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}

        {readyToShare ? (
          <div className="modal-actions">
            <span className="modal-note" role="status">
              Your file is ready.
            </span>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleShareReady()}
            >
              Share now
            </button>
          </div>
        ) : (
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy !== null}>
              Cancel
            </button>
            <button
              type="button"
              className={canShare ? 'btn btn-secondary' : 'btn btn-primary'}
              onClick={() => void handleExport('download')}
              disabled={busy !== null || !filename.trim()}
            >
              {busy === 'download' ? progressLabel : 'Download'}
            </button>
            {canShare && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleExport('share')}
                disabled={busy !== null || !filename.trim()}
              >
                {busy === 'share' ? progressLabel : 'Share'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
