import type { Page } from '../types'

interface PageListProps {
  pages: Page[]
  onAddPage: () => void
  onEditPage: (pageId: string) => void
  onDeletePage: (pageId: string) => void
  onMovePage: (from: number, to: number) => void
  onExport: () => void
}

export function PageList({
  pages,
  onAddPage,
  onEditPage,
  onDeletePage,
  onMovePage,
  onExport,
}: PageListProps) {
  if (pages.length === 0) {
    return (
      <div className="pages-empty">
        <p>No pages yet. Capture your first document.</p>
        <button type="button" className="btn btn-primary" onClick={onAddPage}>
          Scan page
        </button>
      </div>
    )
  }

  return (
    <div className="pages-screen">
      <div className="pages-grid">
        {pages.map((page, index) => {
          const number = index + 1
          return (
            <div key={page.id} className="page-card">
              <button
                type="button"
                className="page-thumb-button"
                onClick={() => onEditPage(page.id)}
                aria-label={`Edit page ${number}`}
              >
                {page.thumbnailUrl ? (
                  <img src={page.thumbnailUrl} alt="" className="page-thumb" decoding="async" />
                ) : (
                  <span className="page-thumb placeholder">Page {number}</span>
                )}
              </button>
              <div className="page-card-actions">
                <span className="page-number">{number}</span>
                <div className="page-btns">
                  {index > 0 && (
                    <button
                      type="button"
                      className="btn btn-icon"
                      onClick={() => onMovePage(index, index - 1)}
                      aria-label={`Move page ${number} earlier`}
                    >
                      ←
                    </button>
                  )}
                  {index < pages.length - 1 && (
                    <button
                      type="button"
                      className="btn btn-icon"
                      onClick={() => onMovePage(index, index + 1)}
                      aria-label={`Move page ${number} later`}
                    >
                      →
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-icon danger"
                    onClick={() => onDeletePage(page.id)}
                    aria-label={`Delete page ${number}`}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <p className="hint">Tap a page to adjust its crop or filter.</p>

      <div className="pages-footer">
        <button type="button" className="btn btn-secondary" onClick={onAddPage}>
          + Add page
        </button>
        <button type="button" className="btn btn-primary" onClick={onExport}>
          Export
        </button>
      </div>
    </div>
  )
}
