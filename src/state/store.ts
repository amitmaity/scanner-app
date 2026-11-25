import { create } from 'zustand'
import {
  ERROR_MESSAGES,
  normalizeError,
  persistFailureError,
  type AppError,
} from '../lib/errors'
import { createThumbnail, PREVIEW_MAX_SIDE, renderPage } from '../lib/filters'
import { defaultCorners } from '../lib/geometry'
import { loadOpenCV } from '../lib/cv/client'
import { blobToImage, canvasToBlob, sourceSize } from '../lib/image'
import { perspectiveCorrect } from '../lib/perspective'
import {
  deleteDocument,
  deletePageBlobs,
  loadDocuments,
  requestPersistentStorage,
  saveDocument,
  saveDocumentMetadata,
  saveThumbnail,
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
const PREVIEW_JPEG_QUALITY = 0.85
export const MAX_NAME_LENGTH = 100
export const PAGE_DELETED_MESSAGE = 'Page deleted.'

let toastTimer: ReturnType<typeof setTimeout> | null = null

/** Bumped for every preview run so a slower, older run can't overwrite the
 * result of a newer one or clear `isPreviewing` while the newer one is busy. */
let enhanceRequestId = 0

function clearToastTimer() {
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
}

function revokeThumbnails(doc: ScanDocument) {
  for (const page of doc.pages) {
    if (page.thumbnailUrl) URL.revokeObjectURL(page.thumbnailUrl)
  }
}

function replaceDocument(documents: ScanDocument[], doc: ScanDocument): ScanDocument[] {
  return documents.map((d) => (d.id === doc.id ? doc : d))
}

interface ScannerState {
  step: AppStep
  documents: ScanDocument[]
  /** A new scan with no pages yet. Kept out of `documents` (and so off the home
   * list) until its first page is saved. */
  draftDocument: ScanDocument | null
  currentDocumentId: string | null
  pendingCapture: PendingCapture | null
  /** The page being re-edited: saving replaces it instead of adding a page. */
  editingPageId: string | null
  /** Perspective-corrected pixels of the pending capture, before any filter.
   * Kept unencoded so the saved page goes through only one lossy encode. */
  cropped: HTMLCanvasElement | null
  /** Reduced-size render of `cropped` with `workingFilter` applied. */
  previewBlob: Blob | null
  workingFilter: FilterSettings
  /** Cropping or saving: blocks navigation and the save button. */
  isProcessing: boolean
  /** Rendering the preview. Doesn't block saving, which renders full size itself. */
  isPreviewing: boolean
  error: AppError | null
  opencvStatus: OpenCvStatus

  hydrate: () => Promise<void>
  preloadOpenCV: () => Promise<void>
  newDocument: () => void
  openDocument: (id: string) => void
  goHome: () => void
  /** Opens the camera to add a page to the current document. */
  startCapture: () => void
  showPages: () => void
  retake: () => void
  backToCrop: () => void
  editPage: (pageId: string) => Promise<void>
  setPendingCapture: (capture: PendingCapture) => void
  updateCorners: (corners: Point[]) => void
  confirmCrop: () => Promise<void>
  setFilter: (filter: Partial<FilterSettings>) => void
  applyEnhancement: () => Promise<void>
  /** Adds the pending capture as a page, or replaces the page being edited. */
  savePage: () => Promise<void>
  deletePage: (pageId: string) => Promise<void>
  restorePage: (documentId: string, page: Page, index: number) => Promise<void>
  reorderPages: (fromIndex: number, toIndex: number) => Promise<void>
  renameDocument: (id: string, name: string) => Promise<void>
  clearPending: () => void
  setError: (error: AppError | null) => void
}

export function selectCurrentDocument(
  state: Pick<ScannerState, 'documents' | 'draftDocument' | 'currentDocumentId'>,
): ScanDocument | null {
  const { documents, draftDocument, currentDocumentId } = state
  if (!currentDocumentId) return null
  return (
    documents.find((d) => d.id === currentDocumentId) ??
    (draftDocument?.id === currentDocumentId ? draftDocument : null)
  )
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

const EMPTY_WORKSPACE = {
  pendingCapture: null,
  editingPageId: null,
  cropped: null,
  previewBlob: null,
  isPreviewing: false,
} as const

export const useScannerStore = create<ScannerState>((set, get) => ({
  step: 'home',
  documents: [],
  draftDocument: null,
  currentDocumentId: null,
  ...EMPTY_WORKSPACE,
  workingFilter: { ...DEFAULT_FILTER },
  isProcessing: false,
  error: null,
  opencvStatus: 'idle',

  setError: (error) => {
    clearToastTimer()
    set({ error })
    // Errors offering a retry stay until handled; notices (even with an Undo
    // action) and plain errors fade.
    const autoDismiss = error && !error.critical && (!error.retry || error.tone === 'info')
    if (autoDismiss) {
      toastTimer = setTimeout(() => {
        useScannerStore.setState({ error: null })
        toastTimer = null
      }, TOAST_DISMISS_MS)
    }
  },

  hydrate: async () => {
    try {
      const { documents: loaded, skippedPages } = await loadDocuments()
      // Merge rather than replace: a scan saved while loading was still in
      // progress must survive. Prefer the in-memory copy of any duplicate.
      const inMemoryIds = new Set(get().documents.map((d) => d.id))
      const fresh: ScanDocument[] = []
      for (const doc of loaded) {
        if (inMemoryIds.has(doc.id)) revokeThumbnails(doc)
        else fresh.push(doc)
      }
      set((state) => ({ documents: [...state.documents, ...fresh] }))
      if (skippedPages > 0) {
        get().setError({
          message: `${skippedPages} saved page${skippedPages === 1 ? '' : 's'} could not be restored.`,
        })
      }
      void backfillThumbnails()
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
    get().clearPending()
    const doc = createEmptyDocument()
    set({
      ...EMPTY_WORKSPACE,
      draftDocument: doc,
      currentDocumentId: doc.id,
      step: 'capture',
      error: null,
    })
  },

  openDocument: (id) => {
    clearToastTimer()
    get().clearPending()
    set({
      ...EMPTY_WORKSPACE,
      draftDocument: null,
      currentDocumentId: id,
      step: 'pages',
      error: null,
    })
  },

  goHome: () => {
    get().clearPending()
    set({ step: 'home', currentDocumentId: null, draftDocument: null, editingPageId: null })
  },

  startCapture: () => {
    get().clearPending()
    set({ step: 'capture', editingPageId: null })
  },

  showPages: () => {
    get().clearPending()
    set({ step: 'pages', editingPageId: null })
  },

  // Keeps `editingPageId`: retaking while editing replaces that page's photo.
  retake: () => {
    get().clearPending()
    set({ step: 'capture' })
  },

  // Keeps the capture, corners and filter; only the crop is redone.
  backToCrop: () => {
    set({ step: 'crop', cropped: null, previewBlob: null, isPreviewing: false })
  },

  editPage: async (pageId) => {
    const page = selectCurrentDocument(get())?.pages.find((p) => p.id === pageId)
    if (!page) return
    try {
      const { width, height } = sourceSize(await blobToImage(page.originalBlob))
      clearToastTimer()
      get().clearPending()
      set({
        editingPageId: pageId,
        pendingCapture: {
          blob: page.originalBlob,
          imageUrl: URL.createObjectURL(page.originalBlob),
          width,
          height,
          corners: page.corners.length === 4 ? page.corners : defaultCorners(width, height),
        },
        workingFilter: { ...DEFAULT_FILTER, ...page.filter },
        step: 'crop',
        error: null,
      })
    } catch {
      get().setError({
        message: ERROR_MESSAGES.EDIT_FAILED,
        retry: () => {
          void get().editPage(pageId)
        },
      })
    }
  },

  setPendingCapture: (capture) => {
    clearToastTimer()
    const previousUrl = get().pendingCapture?.imageUrl
    if (previousUrl && previousUrl !== capture.imageUrl) URL.revokeObjectURL(previousUrl)
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
      const cropped = await perspectiveCorrect(pendingCapture.blob, pendingCapture.corners)
      set({
        cropped,
        previewBlob: null,
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
    const { cropped, workingFilter } = get()
    if (!cropped) return

    const requestId = ++enhanceRequestId
    // Superseded by a newer run, or the user has moved on to another capture.
    const isStale = () => requestId !== enhanceRequestId || get().cropped !== cropped

    set({ isPreviewing: true })
    get().setError(null)
    try {
      const canvas = await renderPage(cropped, workingFilter, PREVIEW_MAX_SIDE)
      const previewBlob = await canvasToBlob(canvas, 'image/jpeg', PREVIEW_JPEG_QUALITY)
      if (isStale()) return
      set({ previewBlob, isPreviewing: false })
    } catch (err) {
      if (isStale()) return
      const { message } = normalizeError(err, 'FILTER_FAILED')
      set({ isPreviewing: false })
      get().setError({
        message,
        retry: () => {
          void get().applyEnhancement()
        },
      })
    }
  },

  savePage: async () => {
    const state = get()
    const { cropped, workingFilter, pendingCapture, editingPageId, isProcessing } = state
    if (!cropped || !pendingCapture || !state.currentDocumentId || isProcessing) return

    const existing = selectCurrentDocument(state)
    if (!existing) {
      get().setError({ message: 'This scan is no longer available. Start a new scan.' })
      return
    }
    const previous = editingPageId
      ? existing.pages.find((p) => p.id === editingPageId)
      : undefined

    set({ isProcessing: true })
    get().setError(null)
    let thumbnailUrl: string | null = null
    try {
      // The preview was rendered small; the saved page is rendered once at
      // full size and encoded once.
      const full = await renderPage(cropped, workingFilter)
      const processedBlob = await canvasToBlob(full)
      const thumbnailBlob = await createThumbnail(full)
      thumbnailUrl = URL.createObjectURL(thumbnailBlob)

      const page: Page = {
        id: previous?.id ?? createId(),
        originalBlob: pendingCapture.blob,
        corners: pendingCapture.corners,
        filter: { ...workingFilter },
        processedBlob,
        thumbnailBlob,
        thumbnailUrl,
        createdAt: previous?.createdAt ?? Date.now(),
      }
      const updated: ScanDocument = {
        ...existing,
        pages: previous
          ? existing.pages.map((p) => (p.id === previous.id ? page : p))
          : [...existing.pages, page],
        updatedAt: Date.now(),
      }
      await saveDocument(updated, { replacePageIds: previous ? [previous.id] : [] })

      const captureUrl = pendingCapture.imageUrl
      // Read the list fresh: hydrate may have merged documents in meanwhile.
      set((s) => ({
        documents: s.documents.some((d) => d.id === updated.id)
          ? replaceDocument(s.documents, updated)
          : [updated, ...s.documents],
        draftDocument: s.draftDocument?.id === updated.id ? null : s.draftDocument,
        ...EMPTY_WORKSPACE,
        step: 'pages',
        workingFilter: { ...DEFAULT_FILTER },
        isProcessing: false,
      }))

      if (captureUrl) URL.revokeObjectURL(captureUrl)
      if (previous?.thumbnailUrl) URL.revokeObjectURL(previous.thumbnailUrl)
      void requestPersistentStorage()
    } catch (err) {
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl)
      set({ isProcessing: false })
      get().setError(
        persistFailureError(err, () => {
          void get().savePage()
        }),
      )
    }
  },

  deletePage: async (pageId) => {
    const { currentDocumentId, documents } = get()
    if (!currentDocumentId) return

    const previousDoc = documents.find((d) => d.id === currentDocumentId)
    const index = previousDoc?.pages.findIndex((p) => p.id === pageId) ?? -1
    if (!previousDoc || index < 0) return
    const page = previousDoc.pages[index]

    const updatedDoc: ScanDocument = {
      ...previousDoc,
      pages: previousDoc.pages.filter((p) => p.id !== pageId),
      updatedAt: Date.now(),
    }

    set({ documents: replaceDocument(documents, updatedDoc) })
    get().setError(null)
    try {
      // Delete blobs first: a failure here leaves persistence untouched, and a
      // metadata failure afterwards can be healed by re-saving the old doc.
      await deletePageBlobs(pageId)
      await saveDocumentMetadata(updatedDoc)
    } catch (err) {
      // Best-effort compensating write so the in-memory rollback below matches
      // IndexedDB (re-puts blobs if they were deleted, restores old metadata).
      try {
        await saveDocument(previousDoc)
      } catch {
        // Persistence is down (e.g. quota) — the error toast covers it.
      }
      set((s) => ({ documents: replaceDocument(s.documents, previousDoc) }))
      get().setError(
        persistFailureError(err, () => {
          void get().deletePage(pageId)
        }),
      )
      return
    }

    // The page's blobs stay in memory, so Undo can write them back.
    if (page.thumbnailUrl) URL.revokeObjectURL(page.thumbnailUrl)
    get().setError({
      message: PAGE_DELETED_MESSAGE,
      tone: 'info',
      actionLabel: 'Undo',
      retry: () => {
        void get().restorePage(currentDocumentId, page, index)
      },
    })
  },

  restorePage: async (documentId, page, index) => {
    const before = get().documents.find((d) => d.id === documentId)
    if (!before || before.pages.some((p) => p.id === page.id)) return

    let thumbnailBlob = page.thumbnailBlob
    if (!thumbnailBlob && page.processedBlob) {
      thumbnailBlob = await createThumbnail(page.processedBlob).catch(() => null)
    }
    const latest = get().documents.find((d) => d.id === documentId)
    if (!latest) return

    const restored: Page = {
      ...page,
      thumbnailBlob,
      thumbnailUrl: thumbnailBlob ? URL.createObjectURL(thumbnailBlob) : null,
    }
    const pages = [...latest.pages]
    pages.splice(Math.min(index, pages.length), 0, restored)
    const updated: ScanDocument = { ...latest, pages, updatedAt: Date.now() }

    set((s) => ({ documents: replaceDocument(s.documents, updated) }))
    try {
      await saveDocument(updated)
    } catch (err) {
      if (restored.thumbnailUrl) URL.revokeObjectURL(restored.thumbnailUrl)
      set((s) => ({ documents: replaceDocument(s.documents, latest) }))
      get().setError(
        persistFailureError(err, () => {
          void get().restorePage(documentId, page, index)
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

  renameDocument: async (id, rawName) => {
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH)
    if (!name) return

    const { draftDocument, documents } = get()
    if (draftDocument?.id === id) {
      set({ draftDocument: { ...draftDocument, name } })
      return
    }
    const doc = documents.find((d) => d.id === id)
    if (!doc || doc.name === name) return

    const renamed: ScanDocument = { ...doc, name, updatedAt: Date.now() }
    set((s) => ({ documents: replaceDocument(s.documents, renamed) }))
    try {
      await saveDocumentMetadata(renamed)
    } catch (err) {
      set((s) => ({ documents: replaceDocument(s.documents, doc) }))
      get().setError(
        persistFailureError(err, () => {
          void get().renameDocument(id, name)
        }),
      )
    }
  },

  clearPending: () => {
    const { pendingCapture } = get()
    if (pendingCapture?.imageUrl) URL.revokeObjectURL(pendingCapture.imageUrl)
    set({
      pendingCapture: null,
      cropped: null,
      previewBlob: null,
      isPreviewing: false,
      workingFilter: { ...DEFAULT_FILTER },
    })
  },
}))

/**
 * Pages saved before thumbnails were stored only have their full-size image.
 * Give each a small thumbnail once, in the background, and store it so later
 * launches don't decode every page.
 */
async function backfillThumbnails(): Promise<void> {
  const pageExists = (pageId: string) =>
    useScannerStore.getState().documents.some((d) => d.pages.some((p) => p.id === pageId))

  const missing = useScannerStore
    .getState()
    .documents.flatMap((d) => d.pages)
    .flatMap((p) => (!p.thumbnailBlob && p.processedBlob ? [{ id: p.id, source: p.processedBlob }] : []))

  for (const { id, source } of missing) {
    try {
      if (!pageExists(id)) continue
      const thumbnailBlob = await createThumbnail(source)
      if (!pageExists(id)) continue
      await saveThumbnail(id, thumbnailBlob)
      const thumbnailUrl = URL.createObjectURL(thumbnailBlob)
      useScannerStore.setState((s) => ({
        documents: s.documents.map((doc) =>
          doc.pages.some((p) => p.id === id)
            ? {
                ...doc,
                pages: doc.pages.map((p) =>
                  p.id === id ? { ...p, thumbnailBlob, thumbnailUrl } : p,
                ),
              }
            : doc,
        ),
      }))
    } catch {
      // Keep the placeholder; the next launch tries again.
    }
  }
}

export async function removeDocument(id: string): Promise<void> {
  try {
    await deleteDocument(id)
    const doc = useScannerStore.getState().documents.find((d) => d.id === id)
    if (doc) revokeThumbnails(doc)
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
