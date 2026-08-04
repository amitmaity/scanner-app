interface ToolbarProps {
  title: string
  onBack?: () => void
  rightAction?: React.ReactNode
}

export function Toolbar({ title, onBack, rightAction }: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar-left">
        {onBack && (
          <button type="button" className="btn btn-ghost" onClick={onBack} aria-label="Back">
            ←
          </button>
        )}
      </div>
      <h1 className="toolbar-title">{title}</h1>
      <div className="toolbar-right">{rightAction}</div>
    </header>
  )
}
