import { create } from 'zustand'
import { applyFilter, createThumbnail } from '../lib/filters'
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

interface ScannerState {
  step: AppStep
  documents: ScanDocument[]
  currentDocumentId: string | null
  pendingCapture: PendingCapture | null
  croppedBlob: Blob | null
  workingBlob: Blob | null
  workingFilter: FilterSettings
  isProcessing: boolean
  error: string | null

  hydrate: () => Promise<void>
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
  setError: (error: string | null) => void
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

  hydrate: async () => {
    try {
      const documents = await loadDocuments()
      set({ documents })
    } catch {
      set({ error: 'Failed to load saved scans' })
    }
  },

  newDocument: () => {
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

    set({ isProcessing: true, error: null })
    try {
      const croppedBlob = await perspectiveCorrect(pendingCapture.blob, pendingCapture.corners)
      set({
        croppedBlob,
        workingBlob: croppedBlob,
        step: 'enhance',
        isProcessing: false,
      })
    } catch {
      set({ isProcessing: false, error: 'Failed to crop image. Try adjusting corners.' })
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

    set({ isProcessing: true, error: null })
    try {
      let source = croppedBlob
      if (workingFilter.rotation !== 0) {
        source = await rotateImage(croppedBlob, workingFilter.rotation)
      }
      const processed = await applyFilter(source, workingFilter)
      set({ workingBlob: processed, isProcessing: false })
    } catch {
      set({ isProcessing: false, error: 'Failed to apply enhancement' })
    }
  },

  addPageToDocument: async () => {
    const { workingBlob, workingFilter, pendingCapture, currentDocumentId, documents } = get()
    if (!workingBlob || !pendingCapture || !currentDocumentId) return

    set({ isProcessing: true, error: null })
    try {
      const processedBlob = workingBlob
      const thumbnailUrl = await createThumbnail(processedBlob)

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

      const current = updatedDocs.find((d) => d.id === currentDocumentId)
      if (current) await saveDocument(current)
      if (captureUrl) URL.revokeObjectURL(captureUrl)
    } catch {
      set({ isProcessing: false, error: 'Failed to save page' })
    }
  },

  deletePage: async (pageId) => {
    const { currentDocumentId, documents } = get()
    if (!currentDocumentId) return

    const updatedDocs = documents.map((doc) => {
      if (doc.id !== currentDocumentId) return doc
      const page = doc.pages.find((p) => p.id === pageId)
      if (page?.thumbnailUrl) URL.revokeObjectURL(page.thumbnailUrl)
      return {
        ...doc,
        pages: doc.pages.filter((p) => p.id !== pageId),
        updatedAt: Date.now(),
      }
    })

    set({ documents: updatedDocs })
    await deletePageBlobs(pageId)
    const current = updatedDocs.find((d) => d.id === currentDocumentId)
    if (current) await saveDocumentMetadata(current)
  },

  reorderPages: async (fromIndex, toIndex) => {
    const { currentDocumentId, documents } = get()
    if (!currentDocumentId) return

    const updatedDocs = documents.map((doc) => {
      if (doc.id !== currentDocumentId) return doc
      const pages = [...doc.pages]
      const [moved] = pages.splice(fromIndex, 1)
      pages.splice(toIndex, 0, moved)
      return { ...doc, pages, updatedAt: Date.now() }
    })

    set({ documents: updatedDocs })
    const current = updatedDocs.find((d) => d.id === currentDocumentId)
    if (current) await saveDocumentMetadata(current)
  },

  persistCurrentDocument: async () => {
    const { currentDocumentId, documents } = get()
    if (!currentDocumentId) return
    const current = documents.find((d) => d.id === currentDocumentId)
    if (current) await saveDocument(current)
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

  setError: (error) => set({ error }),
}))

export async function removeDocument(id: string): Promise<void> {
  await deleteDocument(id)
  useScannerStore.setState((state) => ({
    documents: state.documents.filter((d) => d.id !== id),
    currentDocumentId: state.currentDocumentId === id ? null : state.currentDocumentId,
    step: state.currentDocumentId === id ? 'home' : state.step,
  }))
}
