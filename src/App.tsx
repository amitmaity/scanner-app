import { useEffect, useRef, useState } from 'react'
import { CameraCapture } from './components/CameraCapture'
import { CropEditor } from './components/CropEditor'
import { ExportDialog } from './components/ExportDialog'
import { FilterControls } from './components/FilterControls'
import { InstallPrompt } from './components/InstallPrompt'
import { OfflineStatus } from './components/OfflineStatus'
import { PageList } from './components/PageList'
import { Toolbar } from './components/Toolbar'
import {
  MAX_NAME_LENGTH,
  removeDocument,
  selectCurrentDocument,
  useScannerStore,
} from './state/store'

interface AppProps {
  offlineReady: boolean
}

export default function App({ offlineReady }: AppProps) {
  const state = useScannerStore()
  const {
    step,
    documents,
    draftDocument,
    pendingCapture,
    editingPageId,
    previewBlob,
    workingFilter,
    isProcessing,
    isPreviewing,
    error,
    hydrate,
    preloadOpenCV,
    newDocument,
    openDocument,
    goHome,
    startCapture,
    showPages,
    retake,
    backToCrop,
    editPage,
    setPendingCapture,
    updateCorners,
    confirmCrop,
    setFilter,
    applyEnhancement,
    savePage,
    deletePage,
    reorderPages,
    renameDocument,
    setError,
  } = state

  const [showExport, setShowExport] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const prevStepRef = useRef(step)

  const currentDocument = selectCurrentDocument(state)
  const isDraft = draftDocument !== null && currentDocument === draftDocument

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!navigator.onLine) return
    void preloadOpenCV()
  }, [preloadOpenCV])

  useEffect(() => {
    if (!previewBlob) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(previewBlob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [previewBlob])

  useEffect(() => {
    if (step === 'enhance' && prevStepRef.current !== 'enhance') {
      void applyEnhancement()
    }
    prevStepRef.current = step
  }, [step, applyEnhancement])

  const handleDeleteDocument = async (id: string) => {
    if (!confirm('Delete this scan?')) return
    await removeDocument(id)
  }

  return (
    <div className="app">
      <InstallPrompt />
      <OfflineStatus offlineReady={offlineReady} />
      {step === 'home' && (
        <>
          <Toolbar title="Scanner" />
          <main className="home-screen">
            <section className="hero">
              <div className="hero-icon" aria-hidden="true">
                <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="8" y="14" width="48" height="36" rx="4" stroke="currentColor" strokeWidth="3" />
                  <circle cx="32" cy="32" r="10" stroke="currentColor" strokeWidth="3" />
                  <path d="M20 10h24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
              <h2>Document Scanner</h2>
              <p>Capture, straighten, enhance, and export as images or PDF.</p>
              <button type="button" className="btn btn-primary btn-large" onClick={newDocument}>
                New scan
              </button>
            </section>

            {documents.length > 0 && (
              <section className="recent-scans">
                <h3>Recent scans</h3>
                <ul className="scan-list">
                  {documents.map((doc) => (
                    <li key={doc.id} className="scan-item">
                      <button
                        type="button"
                        className="scan-item-main"
                        onClick={() => openDocument(doc.id)}
                      >
                        <span className="scan-name">{doc.name}</span>
                        <span className="scan-meta">
                          {doc.pages.length} page{doc.pages.length !== 1 ? 's' : ''} ·{' '}
                          {new Date(doc.updatedAt).toLocaleDateString()}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-icon danger"
                        onClick={() => void handleDeleteDocument(doc.id)}
                        aria-label={`Delete ${doc.name}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </main>
        </>
      )}

      {step === 'capture' && (
        <CameraCapture
          onCapture={setPendingCapture}
          onCancel={() => (currentDocument && !isDraft ? showPages() : goHome())}
        />
      )}

      {step === 'crop' && pendingCapture && (
        <CropEditor
          capture={pendingCapture}
          onCornersChange={updateCorners}
          onConfirm={() => void confirmCrop()}
          onCancel={retake}
          isProcessing={isProcessing}
        />
      )}

      {step === 'enhance' && (
        <FilterControls
          filter={workingFilter}
          previewUrl={previewUrl}
          onChange={setFilter}
          onApply={() => void applyEnhancement()}
          onSave={() => void savePage()}
          onRetake={retake}
          onBackToCrop={backToCrop}
          isEditing={editingPageId !== null}
          isProcessing={isProcessing}
          isPreviewing={isPreviewing}
        />
      )}

      {step === 'pages' && currentDocument && (
        <>
          <Toolbar
            title={currentDocument.name}
            onBack={goHome}
            onRename={(name) => void renameDocument(currentDocument.id, name)}
            maxTitleLength={MAX_NAME_LENGTH}
          />
          <PageList
            pages={currentDocument.pages}
            onAddPage={startCapture}
            onEditPage={(pageId) => void editPage(pageId)}
            onDeletePage={(pageId) => void deletePage(pageId)}
            onMovePage={(from, to) => void reorderPages(from, to)}
            onExport={() => setShowExport(true)}
          />
        </>
      )}

      {showExport && currentDocument && currentDocument.pages.length > 0 && (
        <ExportDialog
          pages={currentDocument.pages}
          documentName={currentDocument.name}
          onClose={() => setShowExport(false)}
        />
      )}

      {error && (
        <div
          className={`toast${error.tone === 'info' ? ' toast-info' : ''}`}
          role={error.tone === 'info' ? 'status' : 'alert'}
        >
          <span>{error.message}</span>
          <div className="toast-actions">
            {error.retry && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const retry = error.retry
                  setError(null)
                  retry?.()
                }}
              >
                {error.actionLabel ?? 'Retry'}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
