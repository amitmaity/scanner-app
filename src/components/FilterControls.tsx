import { useEffect, useRef } from 'react'
import type { FilterMode, FilterSettings } from '../types'

interface FilterControlsProps {
  filter: FilterSettings
  previewUrl: string | null
  onChange: (filter: Partial<FilterSettings>) => void
  onApply: () => void
  onSave: () => void
  onRetake: () => void
  onBackToCrop: () => void
  /** Re-editing a saved page rather than adding a new one. */
  isEditing: boolean
  /** Saving: locks the screen. */
  isProcessing: boolean
  /** Rendering the preview: shows a spinner but leaves controls usable. */
  isPreviewing: boolean
}

/** Slider changes refresh the preview once the value settles for this long. */
export const SLIDER_APPLY_DELAY_MS = 250

const MODES: { id: FilterMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'color', label: 'Color' },
  { id: 'grayscale', label: 'Gray' },
  { id: 'blackwhite', label: 'B&W' },
]

const SLIDERS: { key: 'brightness' | 'contrast'; label: string }[] = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
]

export function FilterControls({
  filter,
  previewUrl,
  onChange,
  onApply,
  onSave,
  onRetake,
  onBackToCrop,
  isEditing,
  isProcessing,
  isPreviewing,
}: FilterControlsProps) {
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelPendingApply = () => {
    if (applyTimer.current) {
      clearTimeout(applyTimer.current)
      applyTimer.current = null
    }
  }

  useEffect(() => {
    const timer = applyTimer
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const applyNow = () => {
    cancelPendingApply()
    onApply()
  }

  // Debouncing the value change itself (rather than listening for mouseup,
  // touchend or specific keys) covers every input method, screen readers
  // included, and avoids rendering on every step of a drag.
  const applySoon = () => {
    cancelPendingApply()
    applyTimer.current = setTimeout(() => {
      applyTimer.current = null
      onApply()
    }, SLIDER_APPLY_DELAY_MS)
  }

  const rotate = () => {
    onChange({ rotation: (filter.rotation + 90) % 360 })
    applyNow()
  }

  return (
    <div className="enhance-screen">
      <div className="enhance-header">
        <button type="button" className="btn btn-ghost" onClick={onRetake} disabled={isProcessing}>
          Retake
        </button>
        <h2>Enhance</h2>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={isProcessing}>
          {isProcessing ? 'Saving…' : isEditing ? 'Save page' : 'Add page'}
        </button>
      </div>

      <div className="preview-container">
        {previewUrl ? (
          <img src={previewUrl} alt="Preview" className="preview-image" />
        ) : (
          <div className="preview-placeholder">Processing preview…</div>
        )}
        {(isPreviewing || isProcessing) && (
          <div className="preview-loading" role="status" aria-label="Updating preview">
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
            aria-pressed={filter.mode === mode.id}
            onClick={() => {
              onChange({ mode: mode.id })
              applyNow()
            }}
            disabled={isProcessing}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="sliders">
        {SLIDERS.map(({ key, label }) => (
          <label key={key} className="slider-label">
            <span>{label}</span>
            <input
              type="range"
              min={-100}
              max={100}
              value={filter[key]}
              disabled={isProcessing}
              onChange={(e) => {
                onChange({ [key]: Number(e.target.value) })
                applySoon()
              }}
            />
          </label>
        ))}
      </div>

      <div className="enhance-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onBackToCrop}
          disabled={isProcessing}
        >
          Adjust crop
        </button>
        <button type="button" className="btn btn-secondary" onClick={rotate} disabled={isProcessing}>
          Rotate 90°
        </button>
      </div>
    </div>
  )
}
