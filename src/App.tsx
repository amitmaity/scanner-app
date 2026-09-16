import { useEffect, useMemo, useRef, useState } from 'react'
import { CameraCapture } from './components/CameraCapture'
import { CropEditor } from './components/CropEditor'
import { ExportDialog } from './components/ExportDialog'
import { FilterControls } from './components/FilterControls'
import { InstallPrompt } from './components/InstallPrompt'
import { OfflineStatus } from './components/OfflineStatus'
import { PageList } from './components/PageList'
import { Toolbar } from './components/Toolbar'
import { removeDocument, useScannerStore } from './state/store'

interface AppProps {
  offlineReady: boolean
}

export default function App({ offlineReady }: AppProps) {
  const {
    step,
    documents,
    currentDocumentId,
    pendingCapture,
    workingBlob,
    workingFilter,
    isProcessing,
    error,
    hydrate,
    preloadOpenCV,
    newDocument,
    openDocument,
    setStep,
    setPendingCapture,
    updateCorners,
    confirmCrop,
    setFilter,
    applyEnhancement,
    addPageToDocument,
    deletePage,
    reorderPages,
    clearPending,
    setError,
  } = useScannerStore()

  const [showExport, setShowExport] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const prevStepRef = useRef(step)

  const currentDocument = useMemo(
    () => documents.find((d) => d.id === currentDocumentId) ?? null,
    [documents, currentDocumentId],
  )

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!navigator.onLine) return
    void preloadOpenCV()
  }, [preloadOpenCV])

  useEffect(() => {
    if (!workingBlob) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(workingBlob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [workingBlob])

  useEffect(() => {
    if (step === 'enhance' && prevStepRef.current !== 'enhance') {
      void applyEnhancement()
    }
    prevStepRef.current = step
  }, [step, applyEnhancement])

  const goHome = () => {
    clearPending()
    setStep('home')
    useScannerStore.setState({ currentDocumentId: null })
  }

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
                        aria-label="Delete scan"
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
          onCancel={() => (currentDocumentId ? setStep('pages') : goHome())}
        />
      )}

      {step === 'crop' && pendingCapture && (
        <CropEditor
          capture={pendingCapture}
          onCornersChange={updateCorners}
          onConfirm={() => void confirmCrop()}
          onCancel={() => {
            if (pendingCapture.imageUrl) URL.revokeObjectURL(pendingCapture.imageUrl)
            setStep('capture')
            useScannerStore.setState({ pendingCapture: null })
          }}
          isProcessing={isProcessing}
        />
      )}

      {step === 'enhance' && (
        <FilterControls
          filter={workingFilter}
          previewUrl={previewUrl}
          onChange={setFilter}
          onApply={() => void applyEnhancement()}
          onAddPage={() => void addPageToDocument()}
          onRetake={() => setStep('capture')}
          isProcessing={isProcessing}
        />
      )}

      {step === 'pages' && currentDocument && (
        <>
          <Toolbar title={currentDocument.name} onBack={goHome} />
          <PageList
            pages={currentDocument.pages}
            onAddPage={() => setStep('capture')}
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
        <div className="toast" role="alert" aria-live="assertive">
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
                Retry
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
