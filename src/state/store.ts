import { create } from 'zustand'
import {
  normalizeError,
  persistFailureError,
  type AppError,
} from '../lib/errors'
import { applyFilter, createThumbnail } from '../lib/filters'
import { loadOpenCV } from '../lib/opencv'
import { perspectiveCorrect, rotateImage } from '../lib/perspective'
import {
  deleteDocument,
  deletePageBlobs,
  loadDocuments,
  saveDocument,
  saveDocumentMetadata,
} from '../lib/storage'
import {
  createId,
  DEFAULT_FILTER,
  type AppStep,
  type FilterSettings,
  type Page,
  type PendingCapture,
  type Point,
  type ScanDocument,
} from '../types'

export type OpenCvStatus = 'idle' | 'loading' | 'ready' | 'error'

const TOAST_DISMISS_MS = 6000
let toastTimer: ReturnType<typeof setTimeout> | null = null

function clearToastTimer() {
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
}

interface ScannerState {
  step: AppStep
  documents: ScanDocument[]
  currentDocumentId: string | null
  pendingCapture: PendingCapture | null
  croppedBlob: Blob | null
  workingBlob: Blob | null
  workingFilter: FilterSettings
  isProcessing: boolean
  error: AppError | null
  opencvStatus: OpenCvStatus

  hydrate: () => Promise<void>
  preloadOpenCV: () => Promise<void>
  newDocument: () => void
  openDocument: (id: string) => void
  setStep: (step: AppStep) => void
  setPendingCapture: (capture: PendingCapture) => void
  updateCorners: (corners: Point[]) => void
  confirmCrop: () => Promise<void>
  setFilter: (filter: Partial<FilterSettings>) => void
  applyEnhancement: () => Promise<void>
  addPageToDocument: () => Promise<void>
  deletePage: (pageId: string) => Promise<void>
  reorderPages: (fromIndex: number, toIndex: number) => Promise<void>
  persistCurrentDocument: () => Promise<void>
  clearPending: () => void
  setError: (error: AppError | null) => void
}

function createEmptyDocument(): ScanDocument {
  const now = Date.now()
  return {
    id: createId(),
    name: `Scan ${new Date(now).toLocaleString()}`,
    pages: [],
    createdAt: now,
    updatedAt: now,
  }
}

export const useScannerStore = create<ScannerState>((set, get) => ({
  step: 'home',
  documents: [],
  currentDocumentId: null,
  pendingCapture: null,
  croppedBlob: null,
  workingBlob: null,
  workingFilter: { ...DEFAULT_FILTER },
  isProcessing: false,
  error: null,
  opencvStatus: 'idle',

  setError: (error) => {
    clearToastTimer()
    set({ error })
    if (error && !error.critical && !error.retry) {
      toastTimer = setTimeout(() => {
        useScannerStore.setState({ error: null })
        toastTimer = null
      }, TOAST_DISMISS_MS)
    }
  },

  hydrate: async () => {
    try {
      const { documents, skippedPages } = await loadDocuments()
      set({ documents })
      if (skippedPages > 0) {
        get().setError({
          message: `${skippedPages} saved page${skippedPages === 1 ? '' : 's'} could not be restored.`,
        })
      }
    } catch (err) {
      get().setError({
        ...persistFailureError(err, () => {
          void get().hydrate()
        }),
        message: normalizeError(err, 'STORAGE_UNAVAILABLE').message,
        critical: true,
      })
    }
  },

  preloadOpenCV: async () => {
    if (get().opencvStatus === 'loading' || get().opencvStatus === 'ready') return
    set({ opencvStatus: 'loading' })
    try {
      await loadOpenCV()
      set({ opencvStatus: 'ready' })
      // Only clear the toast this loader raised — never unrelated errors.
      if (get().error?.source === 'opencv') get().setError(null)
    } catch (err) {
      const { message } = normalizeError(err, 'OPENCV_LOAD_FAILED')
      set({ opencvStatus: 'error' })
      get().setError({
        message,
        source: 'opencv',
        retry: () => {
          void get().preloadOpenCV()
        },
        critical: true,
      })
    }
  },

  newDocument: () => {
    clearToastTimer()
    const doc = createEmptyDocument()
    set((state) => ({
      documents: [doc, ...state.documents],
      currentDocumentId: doc.id,
      step: 'capture',
      pendingCapture: null,
      croppedBlob: null,
      workingBlob: null,
      workingFilter: { ...DEFAULT_FILTER },
      error: null,
    }))
  },

  openDocument: (id) => {
    clearToastTimer()
    set({
      currentDocumentId: id,
      step: 'pages',
      pendingCapture: null,
      croppedBlob: null,
      workingBlob: null,
      workingFilter: { ...DEFAULT_FILTER },
      error: null,
    })
  },

  setStep: (step) => set({ step }),

  setPendingCapture: (capture) => {
    clearToastTimer()
    set({
      pendingCapture: capture,
      step: 'crop',
      error: null,
    })
  },

  updateCorners: (corners) => {
    const { pendingCapture } = get()
    if (!pendingCapture) return
    set({ pendingCapture: { ...pendingCapture, corners } })
  },

  confirmCrop: async () => {
    const { pendingCapture } = get()
    if (!pendingCapture) return

    set({ isProcessing: true })
    get().setError(null)
    try {
      const croppedBlob = await perspectiveCorrect(pendingCapture.blob, pendingCapture.corners)
      set({
        croppedBlob,
        workingBlob: croppedBlob,
        step: 'enhance',
        isProcessing: false,
      })
    } catch (err) {
      const { message } = normalizeError(err, 'CROP_FAILED')
      set({ isProcessing: false })
      get().setError({
        message,
        retry: () => {
          void get().confirmCrop()
        },
      })
    }
  },

  setFilter: (filter) => {
    set((state) => ({
      workingFilter: { ...state.workingFilter, ...filter },
    }))
  },

  applyEnhancement: async () => {
    const { croppedBlob, workingFilter } = get()
    if (!croppedBlob) return

    set({ isProcessing: true })
    get().setError(null)
    try {
      let source = croppedBlob
      if (workingFilter.rotation !== 0) {
        source = await rotateImage(croppedBlob, workingFilter.rotation)
      }
      const processed = await applyFilter(source, workingFilter)
      set({ workingBlob: processed, isProcessing: false })
    } catch (err) {
      const { message } = normalizeError(err, 'FILTER_FAILED')
      set({ isProcessing: false })
      get().setError({
        message,
        retry: () => {
          void get().applyEnhancement()
        },
      })
    }
  },

  addPageToDocument: async () => {
    const { workingBlob, workingFilter, pendingCapture, currentDocumentId, documents } = get()
    if (!workingBlob || !pendingCapture || !currentDocumentId) return

    set({ isProcessing: true })
    get().setError(null)
    let thumbnailUrl: string | null = null
    try {
      const processedBlob = workingBlob
      thumbnailUrl = await createThumbnail(processedBlob)

      const page: Page = {
        id: createId(),
        originalBlob: pendingCapture.blob,
        corners: pendingCapture.corners,
        filter: { ...workingFilter },
        processedBlob,
        thumbnailUrl,
        createdAt: Date.now(),
      }

      const updatedDocs = documents.map((doc) => {
        if (doc.id !== currentDocumentId) return doc
        return {
          ...doc,
          pages: [...doc.pages, page],
          updatedAt: Date.now(),
        }
      })

      const current = updatedDocs.find((d) => d.id === currentDocumentId)
      if (current) await saveDocument(current)

      const captureUrl = pendingCapture.imageUrl

      set({
        documents: updatedDocs,
        step: 'pages',
        pendingCapture: null,
        croppedBlob: null,
        workingBlob: null,
        workingFilter: { ...DEFAULT_FILTER },
        isProcessing: false,
      })

      if (captureUrl) URL.revokeObjectURL(captureUrl)
    } catch (err) {
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl)
      set({ isProcessing: false })
      get().setError(
        persistFailureError(err, () => {
          void get().addPageToDocument()
        }),
      )
    }
  },

  deletePage: async (pageId) => {
    const { currentDocumentId, documents } = get()
    if (!currentDocumentId) return

    const previous = documents
    const previousDoc = previous.find((d) => d.id === currentDocumentId)
    const pageToRevoke = previousDoc?.pages.find((p) => p.id === pageId)

    const updatedDocs = documents.map((doc) => {
      if (doc.id !== currentDocumentId) return doc
      return {
        ...doc,
        pages: doc.pages.filter((p) => p.id !== pageId),
        updatedAt: Date.now(),
      }
    })

    set({ documents: updatedDocs })
    get().setError(null)
    try {
      // Delete blobs first: a failure here leaves persistence untouched, and a
      // metadata failure afterwards can be healed by re-saving the old doc.
      await deletePageBlobs(pageId)
      const current = updatedDocs.find((d) => d.id === currentDocumentId)
      if (current) await saveDocumentMetadata(current)
      if (pageToRevoke?.thumbnailUrl) URL.revokeObjectURL(pageToRevoke.thumbnailUrl)
    } catch (err) {
      // Best-effort compensating write so the in-memory rollback below matches
      // IndexedDB (re-puts blobs if they were deleted, restores old metadata).
      if (previousDoc) {
        try {
          await saveDocument(previousDoc)
        } catch {
          // Persistence is down (e.g. quota) — the error toast covers it.
        }
      }
      set({ documents: previous })
      get().setError(
        persistFailureError(err, () => {
          void get().deletePage(pageId)
        }),
      )
    }
  },

  reorderPages: async (fromIndex, toIndex) => {
    const { currentDocumentId, documents } = get()
    if (!currentDocumentId) return

    const previous = documents
    const updatedDocs = documents.map((doc) => {
      if (doc.id !== currentDocumentId) return doc
      const pages = [...doc.pages]
      const [moved] = pages.splice(fromIndex, 1)
      pages.splice(toIndex, 0, moved)
      return { ...doc, pages, updatedAt: Date.now() }
    })

    set({ documents: updatedDocs })
    get().setError(null)
    try {
      const current = updatedDocs.find((d) => d.id === currentDocumentId)
      if (current) await saveDocumentMetadata(current)
    } catch (err) {
      set({ documents: previous })
      get().setError(
        persistFailureError(err, () => {
          void get().reorderPages(fromIndex, toIndex)
        }),
      )
    }
  },

  persistCurrentDocument: async () => {
    const { currentDocumentId, documents } = get()
    if (!currentDocumentId) return
    const current = documents.find((d) => d.id === currentDocumentId)
    if (!current) return
    try {
      await saveDocument(current)
    } catch (err) {
      get().setError(
        persistFailureError(err, () => {
          void get().persistCurrentDocument()
        }),
      )
    }
  },

  clearPending: () => {
    const { pendingCapture } = get()
    if (pendingCapture?.imageUrl) URL.revokeObjectURL(pendingCapture.imageUrl)
    set({
      pendingCapture: null,
      croppedBlob: null,
      workingBlob: null,
      workingFilter: { ...DEFAULT_FILTER },
    })
  },
}))

export async function removeDocument(id: string): Promise<void> {
  try {
    await deleteDocument(id)
    useScannerStore.setState((state) => ({
      documents: state.documents.filter((d) => d.id !== id),
      currentDocumentId: state.currentDocumentId === id ? null : state.currentDocumentId,
      step: state.currentDocumentId === id ? 'home' : state.step,
    }))
  } catch (err) {
    useScannerStore.getState().setError(
      persistFailureError(err, () => {
        void removeDocument(id)
      }),
    )
  }
}
