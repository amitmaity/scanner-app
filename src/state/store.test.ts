import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_MESSAGES } from '../lib/errors'
import { DEFAULT_FILTER, type Page, type ScanDocument } from '../types'

vi.mock('../lib/storage', () => ({
  loadDocuments: vi.fn(),
  saveDocument: vi.fn(),
  saveDocumentMetadata: vi.fn(),
  saveThumbnail: vi.fn(),
  deleteDocument: vi.fn(),
  deletePageBlobs: vi.fn(),
  requestPersistentStorage: vi.fn(),
}))

vi.mock('../lib/filters', () => ({
  PREVIEW_MAX_SIDE: 1600,
  renderPage: vi.fn(),
  createThumbnail: vi.fn(),
}))

vi.mock('../lib/perspective', () => ({
  perspectiveCorrect: vi.fn(),
}))

vi.mock('../lib/cv/client', () => ({
  loadOpenCV: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/image', () => ({
  canvasToBlob: vi.fn(),
  blobToImage: vi.fn(),
  sourceSize: (img: { naturalWidth: number; naturalHeight: number }) => ({
    width: img.naturalWidth,
    height: img.naturalHeight,
  }),
}))

import {
  deleteDocument,
  deletePageBlobs,
  loadDocuments,
  requestPersistentStorage,
  saveDocument,
  saveDocumentMetadata,
  saveThumbnail,
} from '../lib/storage'
import { createThumbnail, renderPage } from '../lib/filters'
import { loadOpenCV } from '../lib/cv/client'
import { blobToImage, canvasToBlob } from '../lib/image'
import { perspectiveCorrect } from '../lib/perspective'
import { PAGE_DELETED_MESSAGE, removeDocument, useScannerStore } from './store'

function makePage(id: string, overrides: Partial<Page> = {}): Page {
  return {
    id,
    originalBlob: new Blob(['orig']),
    corners: [],
    filter: { ...DEFAULT_FILTER },
    processedBlob: new Blob(['proc']),
    thumbnailBlob: new Blob(['thumb']),
    thumbnailUrl: `blob:${id}`,
    createdAt: 1,
    ...overrides,
  }
}

function makeDoc(pages: Page[] = [makePage('p1')], id = 'd1'): ScanDocument {
  return { id, name: 'Scan', pages, createdAt: 1, updatedAt: 1 }
}

function makeCapture(imageUrl = 'blob:capture') {
  return { blob: new Blob(['raw']), imageUrl, width: 10, height: 10, corners: [] }
}

function fakeCanvas(): HTMLCanvasElement {
  return document.createElement('canvas')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function resetStore(partial: Partial<ReturnType<typeof useScannerStore.getState>> = {}) {
  useScannerStore.setState({
    step: 'home',
    documents: [],
    draftDocument: null,
    currentDocumentId: null,
    pendingCapture: null,
    editingPageId: null,
    cropped: null,
    previewBlob: null,
    workingFilter: { ...DEFAULT_FILTER },
    isProcessing: false,
    isPreviewing: false,
    error: null,
    opencvStatus: 'idle',
    ...partial,
  })
}

const state = () => useScannerStore.getState()

describe('scanner store', () => {
  beforeEach(() => {
    vi.mocked(loadDocuments).mockReset()
    vi.mocked(saveDocumentMetadata).mockReset().mockResolvedValue()
    vi.mocked(saveDocument).mockReset().mockResolvedValue()
    vi.mocked(saveThumbnail).mockReset().mockResolvedValue()
    vi.mocked(deleteDocument).mockReset().mockResolvedValue()
    vi.mocked(deletePageBlobs).mockReset().mockResolvedValue()
    vi.mocked(requestPersistentStorage).mockReset().mockResolvedValue()
    vi.mocked(loadOpenCV).mockReset().mockResolvedValue(undefined)
    vi.mocked(renderPage).mockReset().mockResolvedValue(fakeCanvas())
    vi.mocked(canvasToBlob).mockReset().mockResolvedValue(new Blob(['encoded']))
    vi.mocked(createThumbnail).mockReset().mockResolvedValue(new Blob(['thumb']))
    vi.mocked(blobToImage).mockReset()
    vi.mocked(perspectiveCorrect).mockReset()
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:new')
    resetStore()
  })

  describe('persistence failures', () => {
    it('rolls back deletePage and restores IndexedDB when metadata save fails', async () => {
      const doc = makeDoc()
      resetStore({ documents: [doc], currentDocumentId: doc.id, step: 'pages' })
      vi.mocked(saveDocumentMetadata).mockRejectedValue(new Error('idb fail'))

      await state().deletePage('p1')

      expect(state().documents[0].pages).toHaveLength(1)
      expect(state().error?.message).toBe(ERROR_MESSAGES.PERSIST_FAILED)
      expect(state().error?.retry).toBeTypeOf('function')
      expect(deletePageBlobs).toHaveBeenCalledWith('p1')
      // Compensating write heals the blob deletion so UI and IndexedDB match.
      expect(saveDocument).toHaveBeenCalledWith(doc)
    })

    it('rolls back deletePage when blob deletion fails', async () => {
      const doc = makeDoc()
      resetStore({ documents: [doc], currentDocumentId: doc.id, step: 'pages' })
      vi.mocked(deletePageBlobs).mockRejectedValue(new Error('idb fail'))

      await state().deletePage('p1')

      expect(state().documents[0].pages).toHaveLength(1)
      expect(state().error?.retry).toBeTypeOf('function')
      expect(saveDocumentMetadata).not.toHaveBeenCalled()
    })

    it('rolls back reorderPages when persistence fails', async () => {
      const doc = makeDoc([makePage('p1'), makePage('p2')])
      resetStore({ documents: [doc], currentDocumentId: doc.id, step: 'pages' })
      vi.mocked(saveDocumentMetadata).mockRejectedValue(new Error('idb fail'))

      await state().reorderPages(0, 1)

      expect(state().documents[0].pages.map((p) => p.id)).toEqual(['p1', 'p2'])
      expect(state().error?.retry).toBeTypeOf('function')
    })

    it('does not remove a document when IndexedDB delete fails', async () => {
      const doc = makeDoc()
      resetStore({ documents: [doc] })
      vi.mocked(deleteDocument).mockRejectedValue(new Error('idb fail'))

      await removeDocument(doc.id)

      expect(state().documents).toHaveLength(1)
      expect(state().error?.message).toBe(ERROR_MESSAGES.PERSIST_FAILED)
    })

    it('marks quota errors critical and omits retry', async () => {
      const doc = makeDoc()
      resetStore({ documents: [doc], currentDocumentId: doc.id })
      const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
      vi.mocked(saveDocumentMetadata).mockRejectedValue(quota)

      await state().deletePage('p1')

      expect(state().error?.message).toBe(ERROR_MESSAGES.STORAGE_QUOTA)
      expect(state().error?.retry).toBeUndefined()
      expect(state().error?.critical).toBe(true)
    })
  })

  describe('OpenCV preload', () => {
    it('clears only its own toast when a retried preloadOpenCV succeeds', async () => {
      vi.mocked(loadOpenCV).mockRejectedValueOnce(new Error('offline'))

      await state().preloadOpenCV()
      expect(state().opencvStatus).toBe('error')
      expect(state().error?.source).toBe('opencv')

      await state().preloadOpenCV()
      expect(state().opencvStatus).toBe('ready')
      expect(state().error).toBeNull()
    })

    it('keeps unrelated errors when preloadOpenCV succeeds', async () => {
      state().setError({ message: 'Storage is full', critical: true })

      await state().preloadOpenCV()

      expect(state().opencvStatus).toBe('ready')
      expect(state().error?.message).toBe('Storage is full')
    })
  })

  describe('hydrate', () => {
    it('warns when saved pages cannot be restored', async () => {
      vi.mocked(loadDocuments).mockResolvedValue({ documents: [makeDoc([])], skippedPages: 2 })

      await state().hydrate()

      expect(state().error?.message).toBe('2 saved pages could not be restored.')
    })

    it('keeps documents saved while hydrate was still loading', async () => {
      const load = deferred<Awaited<ReturnType<typeof loadDocuments>>>()
      vi.mocked(loadDocuments).mockReturnValue(load.promise)
      const saved = makeDoc(undefined, 'saved-old')
      const addedDuringLoad = makeDoc(undefined, 'added-now')

      const hydrating = state().hydrate()
      useScannerStore.setState({ documents: [addedDuringLoad] })
      load.resolve({ documents: [saved, { ...addedDuringLoad }], skippedPages: 0 })
      await hydrating

      expect(state().documents.map((d) => d.id)).toEqual(['added-now', 'saved-old'])
      // The in-memory copy wins; the duplicate's thumbnail URL is released.
      expect(state().documents[0]).toBe(addedDuringLoad)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p1')
    })

    it('generates and stores thumbnails for pages saved without one', async () => {
      const legacy = makePage('old', { thumbnailBlob: null, thumbnailUrl: null })
      vi.mocked(loadDocuments).mockResolvedValue({
        documents: [makeDoc([legacy])],
        skippedPages: 0,
      })
      const thumb = new Blob(['small'])
      vi.mocked(createThumbnail).mockResolvedValue(thumb)

      await state().hydrate()
      await vi.waitFor(() => expect(state().documents[0].pages[0].thumbnailUrl).toBe('blob:new'))

      expect(createThumbnail).toHaveBeenCalledWith(legacy.processedBlob)
      expect(saveThumbnail).toHaveBeenCalledWith('old', thumb)
      expect(state().documents[0].pages[0].thumbnailBlob).toBe(thumb)
    })
  })

  describe('new scans', () => {
    it('keeps a new scan off the home list until its first page is saved', async () => {
      state().newDocument()
      const { draftDocument, currentDocumentId } = state()
      expect(state().documents).toHaveLength(0)
      expect(draftDocument?.id).toBe(currentDocumentId)

      state().setPendingCapture(makeCapture())
      useScannerStore.setState({ cropped: fakeCanvas() })
      await state().savePage()

      expect(state().draftDocument).toBeNull()
      expect(state().documents).toHaveLength(1)
      expect(state().documents[0].id).toBe(currentDocumentId)
      expect(state().documents[0].pages).toHaveLength(1)
      expect(saveDocument).toHaveBeenCalledWith(state().documents[0], { replacePageIds: [] })
      expect(requestPersistentStorage).toHaveBeenCalled()
    })

    it('discards an empty new scan when going home', () => {
      state().newDocument()
      state().goHome()

      expect(state().documents).toHaveLength(0)
      expect(state().draftDocument).toBeNull()
      expect(state().currentDocumentId).toBeNull()
      expect(state().step).toBe('home')
    })
  })

  describe('saving pages', () => {
    it('renders the saved page once at full size, separately from the preview', async () => {
      const doc = makeDoc([])
      const cropped = fakeCanvas()
      const full = fakeCanvas()
      vi.mocked(renderPage).mockResolvedValue(full)
      resetStore({
        documents: [doc],
        currentDocumentId: doc.id,
        step: 'enhance',
        pendingCapture: makeCapture(),
        cropped,
        workingFilter: { ...DEFAULT_FILTER, mode: 'grayscale' },
      })

      await state().savePage()

      expect(renderPage).toHaveBeenCalledWith(cropped, { ...DEFAULT_FILTER, mode: 'grayscale' })
      expect(createThumbnail).toHaveBeenCalledWith(full)
      const page = state().documents[0].pages[0]
      expect(page.filter.mode).toBe('grayscale')
      expect(page.thumbnailBlob).toBeInstanceOf(Blob)
      expect(state().step).toBe('pages')
      expect(state().cropped).toBeNull()
    })

    it('ignores a second save while one is in progress', async () => {
      const doc = makeDoc([])
      const render = deferred<HTMLCanvasElement>()
      vi.mocked(renderPage).mockReturnValueOnce(render.promise)
      resetStore({
        documents: [doc],
        currentDocumentId: doc.id,
        pendingCapture: makeCapture(),
        cropped: fakeCanvas(),
      })

      const first = state().savePage()
      await state().savePage()
      render.resolve(fakeCanvas())
      await first

      expect(saveDocument).toHaveBeenCalledTimes(1)
      expect(state().documents[0].pages).toHaveLength(1)
    })
  })

  describe('editing a page', () => {
    it('opens a saved page in the crop editor with its corners and filter', async () => {
      const corners = [
        { x: 1, y: 1 },
        { x: 9, y: 1 },
        { x: 9, y: 9 },
        { x: 1, y: 9 },
      ]
      const page = makePage('p1', { corners, filter: { ...DEFAULT_FILTER, mode: 'blackwhite' } })
      const doc = makeDoc([page])
      resetStore({ documents: [doc], currentDocumentId: doc.id, step: 'pages' })
      vi.mocked(blobToImage).mockResolvedValue({
        naturalWidth: 10,
        naturalHeight: 10,
      } as HTMLImageElement)

      await state().editPage('p1')

      expect(state().step).toBe('crop')
      expect(state().editingPageId).toBe('p1')
      expect(state().pendingCapture?.blob).toBe(page.originalBlob)
      expect(state().pendingCapture?.corners).toEqual(corners)
      expect(state().workingFilter.mode).toBe('blackwhite')
    })

    it('replaces the edited page in place and rewrites its blobs', async () => {
      const doc = makeDoc([makePage('p1'), makePage('p2', { thumbnailUrl: 'blob:old-p2' })])
      resetStore({
        documents: [doc],
        currentDocumentId: doc.id,
        step: 'enhance',
        editingPageId: 'p2',
        pendingCapture: makeCapture(),
        cropped: fakeCanvas(),
        workingFilter: { ...DEFAULT_FILTER, rotation: 90 },
      })

      await state().savePage()

      const pages = state().documents[0].pages
      expect(pages.map((p) => p.id)).toEqual(['p1', 'p2'])
      expect(pages[1].filter.rotation).toBe(90)
      expect(saveDocument).toHaveBeenCalledWith(state().documents[0], { replacePageIds: ['p2'] })
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old-p2')
      expect(state().editingPageId).toBeNull()
    })

    it('forgets the page being edited when the user goes back to the page list', () => {
      resetStore({ step: 'capture', editingPageId: 'p1', currentDocumentId: 'd1' })

      state().showPages()

      expect(state().editingPageId).toBeNull()
      expect(state().step).toBe('pages')
    })
  })

  describe('undo delete', () => {
    it('offers Undo after deleting a page and restores it in place', async () => {
      const doc = makeDoc([makePage('p1'), makePage('p2'), makePage('p3')])
      resetStore({ documents: [doc], currentDocumentId: doc.id, step: 'pages' })

      await state().deletePage('p2')
      expect(state().documents[0].pages.map((p) => p.id)).toEqual(['p1', 'p3'])
      expect(state().error).toMatchObject({
        message: PAGE_DELETED_MESSAGE,
        tone: 'info',
        actionLabel: 'Undo',
      })

      state().error?.retry?.()
      await vi.waitFor(() => expect(saveDocument).toHaveBeenCalled())

      expect(state().documents[0].pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
      expect(state().documents[0].pages[1].thumbnailUrl).toBe('blob:new')
    })

    it('auto-dismisses the undo notice', async () => {
      vi.useFakeTimers()
      try {
        const doc = makeDoc()
        resetStore({ documents: [doc], currentDocumentId: doc.id, step: 'pages' })
        await state().deletePage('p1')
        expect(state().error?.actionLabel).toBe('Undo')

        await vi.advanceTimersByTimeAsync(6000)
        expect(state().error).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('renaming', () => {
    it('renames a document and saves it', async () => {
      const doc = makeDoc()
      resetStore({ documents: [doc] })

      await state().renameDocument(doc.id, '  Receipts  ')

      expect(state().documents[0].name).toBe('Receipts')
      expect(saveDocumentMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ id: doc.id, name: 'Receipts' }),
      )
    })

    it('restores the old name when saving fails', async () => {
      const doc = makeDoc()
      resetStore({ documents: [doc] })
      vi.mocked(saveDocumentMetadata).mockRejectedValue(new Error('idb fail'))

      await state().renameDocument(doc.id, 'Receipts')

      expect(state().documents[0].name).toBe('Scan')
      expect(state().error?.retry).toBeTypeOf('function')
    })

    it('ignores blank names', async () => {
      const doc = makeDoc()
      resetStore({ documents: [doc] })

      await state().renameDocument(doc.id, '   ')

      expect(state().documents[0].name).toBe('Scan')
      expect(saveDocumentMetadata).not.toHaveBeenCalled()
    })
  })

  describe('enhance preview', () => {
    it('ignores an older preview that finishes after a newer one starts', async () => {
      const cropped = fakeCanvas()
      resetStore({ step: 'enhance', cropped })
      const first = deferred<HTMLCanvasElement>()
      const second = deferred<HTMLCanvasElement>()
      vi.mocked(renderPage).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const stale = new Blob(['stale'])
      const latest = new Blob(['latest'])
      vi.mocked(canvasToBlob).mockResolvedValueOnce(stale).mockResolvedValueOnce(latest)

      const firstRun = state().applyEnhancement()
      state().setFilter({ brightness: 40 })
      const secondRun = state().applyEnhancement()

      first.resolve(fakeCanvas())
      await firstRun
      // The newer run is still busy: the preview must not show the stale result.
      expect(state().isPreviewing).toBe(true)
      expect(state().previewBlob).toBeNull()

      second.resolve(fakeCanvas())
      await secondRun
      expect(state().previewBlob).toBe(latest)
      expect(state().isPreviewing).toBe(false)
    })

    it('renders the preview at reduced size', async () => {
      const cropped = fakeCanvas()
      resetStore({ step: 'enhance', cropped })

      await state().applyEnhancement()

      expect(renderPage).toHaveBeenCalledWith(cropped, DEFAULT_FILTER, 1600)
    })

    it('drops a preview that lands after the user retakes', async () => {
      resetStore({ step: 'enhance', cropped: fakeCanvas(), pendingCapture: makeCapture() })
      const run = deferred<HTMLCanvasElement>()
      vi.mocked(renderPage).mockReturnValueOnce(run.promise)

      const pending = state().applyEnhancement()
      state().retake()
      run.resolve(fakeCanvas())
      await pending

      expect(state().previewBlob).toBeNull()
    })
  })

  describe('navigation', () => {
    it('releases the capture and clears crop state on retake', () => {
      resetStore({
        step: 'enhance',
        pendingCapture: makeCapture('blob:old-capture'),
        cropped: fakeCanvas(),
        previewBlob: new Blob(['preview']),
        workingFilter: { ...DEFAULT_FILTER, rotation: 90 },
      })

      state().retake()

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old-capture')
      expect(state().step).toBe('capture')
      expect(state().pendingCapture).toBeNull()
      expect(state().cropped).toBeNull()
      expect(state().previewBlob).toBeNull()
      expect(state().workingFilter).toEqual(DEFAULT_FILTER)
    })

    it('goes back to the crop keeping the capture and filter', () => {
      const capture = makeCapture()
      resetStore({
        step: 'enhance',
        pendingCapture: capture,
        cropped: fakeCanvas(),
        previewBlob: new Blob(['preview']),
        workingFilter: { ...DEFAULT_FILTER, mode: 'grayscale' },
      })

      state().backToCrop()

      expect(state().step).toBe('crop')
      expect(state().pendingCapture).toBe(capture)
      expect(state().cropped).toBeNull()
      expect(state().workingFilter.mode).toBe('grayscale')
    })

    it('releases the previous capture URL when a new capture replaces it', () => {
      resetStore({ pendingCapture: makeCapture('blob:first') })

      state().setPendingCapture(makeCapture('blob:second'))

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
      expect(state().pendingCapture?.imageUrl).toBe('blob:second')
    })

    it('releases thumbnails when a document is deleted', async () => {
      const doc = makeDoc([makePage('p1'), makePage('p2')])
      resetStore({ documents: [doc] })

      await removeDocument(doc.id)

      expect(state().documents).toHaveLength(0)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p1')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p2')
    })
  })
})
