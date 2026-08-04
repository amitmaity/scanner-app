import type { Page } from '../types'

interface PageListProps {
  pages: Page[]
  onAddPage: () => void
  onDeletePage: (pageId: string) => void
  onMovePage: (from: number, to: number) => void
  onExport: () => void
}

export function PageList({
  pages,
  onAddPage,
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
        {pages.map((page, index) => (
          <div key={page.id} className="page-card">
            {page.thumbnailUrl ? (
              <img src={page.thumbnailUrl} alt={`Page ${index + 1}`} className="page-thumb" />
            ) : (
              <div className="page-thumb placeholder">Page {index + 1}</div>
            )}
            <div className="page-card-actions">
              <span className="page-number">{index + 1}</span>
              <div className="page-btns">
                {index > 0 && (
                  <button
                    type="button"
                    className="btn btn-icon"
                    onClick={() => onMovePage(index, index - 1)}
                    aria-label="Move left"
                  >
                    ←
                  </button>
                )}
                {index < pages.length - 1 && (
                  <button
                    type="button"
                    className="btn btn-icon"
                    onClick={() => onMovePage(index, index + 1)}
                    aria-label="Move right"
                  >
                    →
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-icon danger"
                  onClick={() => onDeletePage(page.id)}
                  aria-label="Delete page"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

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
