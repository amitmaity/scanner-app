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
import { loadOpenCV } from '../lib/opencv'
import { removeDocument, useScannerStore } from './store'

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
