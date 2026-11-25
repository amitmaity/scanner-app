import { useRef, useState, type ReactNode } from 'react'

interface ToolbarProps {
  title: string
  onBack?: () => void
  /** Makes the title tappable to rename. */
  onRename?: (name: string) => void
  maxTitleLength?: number
  rightAction?: ReactNode
}

export function Toolbar({ title, onBack, onRename, maxTitleLength, rightAction }: ToolbarProps) {
  const [draft, setDraft] = useState<string | null>(null)
  // Enter or Escape ends editing; a blur that follows as the input unmounts
  // must not commit (again, or after a cancel).
  const editingDone = useRef(false)

  const startEditing = () => {
    editingDone.current = false
    setDraft(title)
  }

  const cancel = () => {
    editingDone.current = true
    setDraft(null)
  }

  const commit = () => {
    if (draft === null || editingDone.current) return
    editingDone.current = true
    const name = draft.trim()
    setDraft(null)
    if (name && name !== title) onRename?.(name)
  }

  let heading: ReactNode
  if (draft !== null) {
    heading = (
      <input
        className="toolbar-title-input"
        value={draft}
        maxLength={maxTitleLength}
        aria-label="Scan name"
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') cancel()
        }}
      />
    )
  } else if (onRename) {
    heading = (
      <h1 className="toolbar-title">
        <button
          type="button"
          className="toolbar-title-button"
          onClick={startEditing}
          aria-label={`Rename ${title}`}
        >
          <span className="toolbar-title-text">{title}</span>
          <span className="toolbar-title-edit" aria-hidden="true">
            ✎
          </span>
        </button>
      </h1>
    )
  } else {
    heading = <h1 className="toolbar-title">{title}</h1>
  }

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        {onBack && (
          <button type="button" className="btn btn-ghost" onClick={onBack} aria-label="Back">
            ←
          </button>
        )}
      </div>
      {heading}
      <div className="toolbar-right">{rightAction}</div>
    </header>
  )
}
