import { useEffect, useState } from 'react'
import type { FilterMode, FilterSettings } from '../types'

interface FilterControlsProps {
  filter: FilterSettings
  previewUrl: string | null
  onChange: (filter: Partial<FilterSettings>) => void
  onApply: () => void
  onAddPage: () => void
  onRetake: () => void
  isProcessing: boolean
}

const MODES: { id: FilterMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'color', label: 'Color' },
  { id: 'grayscale', label: 'Gray' },
  { id: 'blackwhite', label: 'B&W' },
]

export function FilterControls({
  filter,
  previewUrl,
  onChange,
  onApply,
  onAddPage,
  onRetake,
  isProcessing,
}: FilterControlsProps) {
  const [localPreview, setLocalPreview] = useState(previewUrl)

  useEffect(() => {
    setLocalPreview(previewUrl)
  }, [previewUrl])

  const rotate = () => {
    onChange({ rotation: (filter.rotation + 90) % 360 })
    onApply()
  }

  return (
    <div className="enhance-screen">
      <div className="enhance-header">
        <button type="button" className="btn btn-ghost" onClick={onRetake} disabled={isProcessing}>
          Retake
        </button>
        <h2>Enhance</h2>
        <button type="button" className="btn btn-primary" onClick={onAddPage} disabled={isProcessing}>
          {isProcessing ? 'Saving…' : 'Add page'}
        </button>
      </div>

      <div className="preview-container">
        {localPreview ? (
          <img src={localPreview} alt="Preview" className="preview-image" />
        ) : (
          <div className="preview-placeholder">Processing preview…</div>
        )}
        {isProcessing && (
          <div className="preview-loading">
            <div className="spinner" />
          </div>
        )}
      </div>

      <div className="filter-modes">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`filter-mode-btn ${filter.mode === mode.id ? 'active' : ''}`}
            onClick={() => {
              onChange({ mode: mode.id })
              onApply()
            }}
            disabled={isProcessing}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="sliders">
        <label className="slider-label">
          <span>Brightness</span>
          <input
            type="range"
            min={-100}
            max={100}
            value={filter.brightness}
            onChange={(e) => onChange({ brightness: Number(e.target.value) })}
            onMouseUp={() => onApply()}
            onTouchEnd={() => onApply()}
            onKeyUp={(e) => {
              if (
                e.key === 'ArrowLeft' ||
                e.key === 'ArrowRight' ||
                e.key === 'Home' ||
                e.key === 'End'
              ) {
                onApply()
              }
            }}
          />
        </label>
        <label className="slider-label">
          <span>Contrast</span>
          <input
            type="range"
            min={-100}
            max={100}
            value={filter.contrast}
            onChange={(e) => onChange({ contrast: Number(e.target.value) })}
            onMouseUp={() => onApply()}
            onTouchEnd={() => onApply()}
            onKeyUp={(e) => {
              if (
                e.key === 'ArrowLeft' ||
                e.key === 'ArrowRight' ||
                e.key === 'Home' ||
                e.key === 'End'
              ) {
                onApply()
              }
            }}
          />
        </label>
      </div>

      <div className="enhance-actions">
        <button type="button" className="btn btn-secondary" onClick={rotate} disabled={isProcessing}>
          Rotate 90°
        </button>
        <button type="button" className="btn btn-secondary" onClick={onApply} disabled={isProcessing}>
          Refresh preview
        </button>
      </div>
    </div>
  )
}
