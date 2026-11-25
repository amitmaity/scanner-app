import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_MESSAGES } from '../lib/errors'
import { DEFAULT_FILTER, type Page, type ScanDocument } from '../types'

vi.mock('../lib/storage', () => ({
  loadDocuments: vi.fn(),
  saveDocument: vi.fn(),
  saveDocumentMetadata: vi.fn(),
  deleteDocument: vi.fn(),
  deletePageBlobs: vi.fn(),
}))

vi.mock('../lib/filters', () => ({
  applyFilter: vi.fn(),
  createThumbnail: vi.fn(),
}))

vi.mock('../lib/perspective', () => ({
  perspectiveCorrect: vi.fn(),
  rotateImage: vi.fn(),
}))

vi.mock('../lib/opencv', () => ({
  loadOpenCV: vi.fn().mockResolvedValue(undefined),
}))

import {
  deleteDocument,
  deletePageBlobs,
  loadDocuments,
  saveDocument,
  saveDocumentMetadata,
} from '../lib/storage'
import { applyFilter, createThumbnail } from '../lib/filters'
import { loadOpenCV } from '../lib/opencv'
import { removeDocument, useScannerStore } from './store'

function makeCapture(imageUrl = 'blob:capture') {
  return { blob: new Blob(['raw']), imageUrl, width: 10, height: 10, corners: [] }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function makePage(id: string): Page {
  return {
    id,
    originalBlob: new Blob(['orig']),
    corners: [],
    filter: { ...DEFAULT_FILTER },
    processedBlob: new Blob(['proc']),
    thumbnailUrl: `blob:${id}`,
    createdAt: 1,
  }
}

function makeDoc(pages: Page[] = [makePage('p1')]): ScanDocument {
  return {
    id: 'd1',
    name: 'Scan',
    pages,
    createdAt: 1,
    updatedAt: 1,
  }
}

function resetStore(partial: Partial<ReturnType<typeof useScannerStore.getState>> = {}) {
  useScannerStore.setState({
    step: 'home',
    documents: [],
    draftDocument: null,
    currentDocumentId: null,
    pendingCapture: null,
    croppedBlob: null,
    workingBlob: null,
    workingFilter: { ...DEFAULT_FILTER },
    isProcessing: false,
    error: null,
    opencvStatus: 'idle',
    ...partial,
  })
}

describe('scanner store persistence', () => {
  beforeEach(() => {
    vi.mocked(loadDocuments).mockReset()
    vi.mocked(saveDocumentMetadata).mockReset()
    vi.mocked(saveDocument).mockReset()
    vi.mocked(deleteDocument).mockReset()
    vi.mocked(deletePageBlobs).mockReset()
    vi.mocked(loadOpenCV).mockReset().mockResolvedValue(undefined)
    vi.mocked(applyFilter).mockReset()
    vi.mocked(createThumbnail).mockReset()
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    resetStore()
  })

  it('rolls back deletePage and restores IndexedDB when metadata save fails', async () => {
    const doc = makeDoc()
    resetStore({ documents: [doc], currentDocumentId: doc.id, step: 'pages' })
    vi.mocked(saveDocumentMetadata).mockRejectedValue(new Error('idb fail'))

    await useScannerStore.getState().deletePage('p1')

    expect(useScannerStore.getState().documents[0].pages).toHaveLength(1)
    expect(useScannerStore.getState().error?.message).toBe(ERROR_MESSAGES.PERSIST_FAILED)
    expect(useScannerStore.getState().error?.retry).toBeTypeOf('function')
    expect(deletePageBlobs).toHaveBeenCalledWith('p1')
    // Compensating write heals the blob deletion so UI and IndexedDB match.
    expect(saveDocument).toHaveBeenCalledWith(doc)
  })

  it('rolls back deletePage when blob deletion fails', async () => {
    const doc = makeDoc()
    resetStore({ documents: [doc], currentDocumentId: doc.id, step: 'pages' })
    vi.mocked(deletePageBlobs).mockRejectedValue(new Error('idb fail'))

    await useScannerStore.getState().deletePage('p1')

    expect(useScannerStore.getState().documents[0].pages).toHaveLength(1)
    expect(useScannerStore.getState().error?.retry).toBeTypeOf('function')
    expect(saveDocumentMetadata).not.toHaveBeenCalled()
  })

  it('clears only its own toast when a retried preloadOpenCV succeeds', async () => {
    vi.mocked(loadOpenCV).mockRejectedValueOnce(new Error('offline'))

    await useScannerStore.getState().preloadOpenCV()
    expect(useScannerStore.getState().opencvStatus).toBe('error')
    expect(useScannerStore.getState().error?.source).toBe('opencv')

    await useScannerStore.getState().preloadOpenCV()
    expect(useScannerStore.getState().opencvStatus).toBe('ready')
    expect(useScannerStore.getState().error).toBeNull()
  })

  it('keeps unrelated errors when preloadOpenCV succeeds', async () => {
    useScannerStore.getState().setError({
      message: 'Storage is full',
      critical: true,
    })

    await useScannerStore.getState().preloadOpenCV()

    expect(useScannerStore.getState().opencvStatus).toBe('ready')
    expect(useScannerStore.getState().error?.message).toBe('Storage is full')
  })

  it('rolls back reorderPages when persistence fails', async () => {
    const doc = makeDoc([makePage('p1'), makePage('p2')])
    resetStore({ documents: [doc], currentDocumentId: doc.id, step: 'pages' })
    vi.mocked(saveDocumentMetadata).mockRejectedValue(new Error('idb fail'))

    await useScannerStore.getState().reorderPages(0, 1)

    expect(useScannerStore.getState().documents[0].pages.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(useScannerStore.getState().error?.retry).toBeTypeOf('function')
  })

  it('does not remove a document when IndexedDB delete fails', async () => {
    const doc = makeDoc()
    resetStore({ documents: [doc] })
    vi.mocked(deleteDocument).mockRejectedValue(new Error('idb fail'))

    await removeDocument(doc.id)

    expect(useScannerStore.getState().documents).toHaveLength(1)
    expect(useScannerStore.getState().error?.message).toBe(ERROR_MESSAGES.PERSIST_FAILED)
  })

  it('warns when saved pages cannot be restored', async () => {
    vi.mocked(loadDocuments).mockResolvedValue({
      documents: [makeDoc([])],
      skippedPages: 2,
    })

    await useScannerStore.getState().hydrate()

    expect(useScannerStore.getState().error?.message).toBe(
      '2 saved pages could not be restored.',
    )
  })

  it('keeps a new scan off the home list until its first page is saved', async () => {
    const store = useScannerStore.getState()
    store.newDocument()

    const { draftDocument, currentDocumentId } = useScannerStore.getState()
    expect(useScannerStore.getState().documents).toHaveLength(0)
    expect(draftDocument?.id).toBe(currentDocumentId)

    const processed = new Blob(['processed'])
    useScannerStore.getState().setPendingCapture(makeCapture())
    useScannerStore.setState({ croppedBlob: processed, workingBlob: processed })
    vi.mocked(createThumbnail).mockResolvedValue('blob:thumb')
    vi.mocked(saveDocument).mockResolvedValue()

    await useScannerStore.getState().addPageToDocument()

    const state = useScannerStore.getState()
    expect(state.draftDocument).toBeNull()
    expect(state.documents).toHaveLength(1)
    expect(state.documents[0].id).toBe(currentDocumentId)
    expect(state.documents[0].pages).toHaveLength(1)
    expect(saveDocument).toHaveBeenCalledWith(state.documents[0])
  })

  it('discards an empty new scan when going home', () => {
    useScannerStore.getState().newDocument()
    useScannerStore.getState().goHome()

    const state = useScannerStore.getState()
    expect(state.documents).toHaveLength(0)
    expect(state.draftDocument).toBeNull()
    expect(state.currentDocumentId).toBeNull()
    expect(state.step).toBe('home')
  })

  it('keeps documents saved while hydrate was still loading', async () => {
    const load = deferred<Awaited<ReturnType<typeof loadDocuments>>>()
    vi.mocked(loadDocuments).mockReturnValue(load.promise)
    const saved = { ...makeDoc(), id: 'saved-old' }
    const addedDuringLoad = { ...makeDoc(), id: 'added-now' }

    const hydrating = useScannerStore.getState().hydrate()
    useScannerStore.setState({ documents: [addedDuringLoad] })
    load.resolve({ documents: [saved, { ...addedDuringLoad }], skippedPages: 0 })
    await hydrating

    expect(useScannerStore.getState().documents.map((d) => d.id)).toEqual([
      'added-now',
      'saved-old',
    ])
    // The in-memory copy wins; the duplicate's thumbnail URL is released.
    expect(useScannerStore.getState().documents[0]).toBe(addedDuringLoad)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p1')
  })

  it('ignores an older enhancement that finishes after a newer one starts', async () => {
    const cropped = new Blob(['cropped'])
    resetStore({ step: 'enhance', croppedBlob: cropped, workingBlob: cropped })
    const first = deferred<Blob>()
    const second = deferred<Blob>()
    vi.mocked(applyFilter)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const firstRun = useScannerStore.getState().applyEnhancement()
    useScannerStore.getState().setFilter({ brightness: 40 })
    const secondRun = useScannerStore.getState().applyEnhancement()

    first.resolve(new Blob(['stale']))
    await firstRun
    // The newer run is still busy: "Add page" must stay disabled and the
    // preview must not show the stale result.
    expect(useScannerStore.getState().isProcessing).toBe(true)
    expect(useScannerStore.getState().workingBlob).toBe(cropped)

    const latest = new Blob(['latest'])
    second.resolve(latest)
    await secondRun
    expect(useScannerStore.getState().workingBlob).toBe(latest)
    expect(useScannerStore.getState().isProcessing).toBe(false)
  })

  it('drops an enhancement result that lands after the user retakes', async () => {
    const cropped = new Blob(['cropped'])
    resetStore({ step: 'enhance', croppedBlob: cropped, workingBlob: cropped, pendingCapture: makeCapture() })
    const run = deferred<Blob>()
    vi.mocked(applyFilter).mockReturnValueOnce(run.promise)

    const pending = useScannerStore.getState().applyEnhancement()
    useScannerStore.getState().retake()
    run.resolve(new Blob(['late']))
    await pending

    expect(useScannerStore.getState().workingBlob).toBeNull()
  })

  it('releases the capture and clears crop state on retake', () => {
    const cropped = new Blob(['cropped'])
    resetStore({
      step: 'enhance',
      pendingCapture: makeCapture('blob:old-capture'),
      croppedBlob: cropped,
      workingBlob: cropped,
      workingFilter: { ...DEFAULT_FILTER, rotation: 90 },
    })

    useScannerStore.getState().retake()

    const state = useScannerStore.getState()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old-capture')
    expect(state.step).toBe('capture')
    expect(state.pendingCapture).toBeNull()
    expect(state.croppedBlob).toBeNull()
    expect(state.workingBlob).toBeNull()
    expect(state.workingFilter).toEqual(DEFAULT_FILTER)
  })

  it('releases the previous capture URL when a new capture replaces it', () => {
    resetStore({ pendingCapture: makeCapture('blob:first') })

    useScannerStore.getState().setPendingCapture(makeCapture('blob:second'))

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
    expect(useScannerStore.getState().pendingCapture?.imageUrl).toBe('blob:second')
  })

  it('marks quota errors critical and omits retry', async () => {
    const doc = makeDoc()
    resetStore({ documents: [doc], currentDocumentId: doc.id })
    const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    vi.mocked(saveDocumentMetadata).mockRejectedValue(quota)

    await useScannerStore.getState().deletePage('p1')

    expect(useScannerStore.getState().error?.message).toBe(ERROR_MESSAGES.STORAGE_QUOTA)
    expect(useScannerStore.getState().error?.retry).toBeUndefined()
    expect(useScannerStore.getState().error?.critical).toBe(true)
  })
})
