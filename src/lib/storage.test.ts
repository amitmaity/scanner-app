// @vitest-environment node
// Node's Blob survives structured cloning into fake-indexeddb; jsdom's doesn't.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTER, type Page, type ScanDocument } from '../types'
import {
  deleteDocument,
  deletePageBlobs,
  loadDocuments,
  requestPersistentStorage,
  resetStorageForTests,
  saveDocument,
  saveDocumentMetadata,
  saveThumbnail,
} from './storage'

function blob(text: string): Blob {
  return new Blob([text], { type: 'image/jpeg' })
}

function makePage(id: string, overrides: Partial<Page> = {}): Page {
  return {
    id,
    originalBlob: blob(`${id}-original`),
    corners: [{ x: 1, y: 2 }],
    filter: { ...DEFAULT_FILTER, mode: 'grayscale' },
    processedBlob: blob(`${id}-processed`),
    thumbnailBlob: blob(`${id}-thumb`),
    thumbnailUrl: `blob:${id}`,
    createdAt: 5,
    ...overrides,
  }
}

function makeDoc(pages: Page[], id = 'd1', updatedAt = 1): ScanDocument {
  return { id, name: `Doc ${id}`, pages, createdAt: 1, updatedAt }
}

async function text(b: Blob | null | undefined): Promise<string | null> {
  return b ? b.text() : null
}

describe('storage', () => {
  beforeEach(() => {
    // A fresh, empty database for every test.
    globalThis.indexedDB = new IDBFactory()
  })

  afterEach(async () => {
    await resetStorageForTests()
    vi.unstubAllGlobals()
  })

  it('round-trips documents with their images', async () => {
    await saveDocument(makeDoc([makePage('p1'), makePage('p2')]))

    const { documents, skippedPages } = await loadDocuments()

    expect(skippedPages).toBe(0)
    expect(documents).toHaveLength(1)
    const [p1, p2] = documents[0].pages
    expect(p1.id).toBe('p1')
    expect(p2.id).toBe('p2')
    expect(p1.filter.mode).toBe('grayscale')
    expect(p1.corners).toEqual([{ x: 1, y: 2 }])
    expect(await text(p1.originalBlob)).toBe('p1-original')
    expect(await text(p1.processedBlob)).toBe('p1-processed')
    expect(await text(p1.thumbnailBlob)).toBe('p1-thumb')
    // Thumbnails come from the small stored image, not the full-size one.
    expect(p1.thumbnailUrl).toMatch(/^blob:/)
  })

  it('lists the most recently updated documents first', async () => {
    await saveDocument(makeDoc([makePage('a')], 'old', 1))
    await saveDocument(makeDoc([makePage('b')], 'new', 2))

    const { documents } = await loadDocuments()

    expect(documents.map((d) => d.id)).toEqual(['new', 'old'])
  })

  it('does not rewrite stored images unless a page is replaced', async () => {
    await saveDocument(makeDoc([makePage('p1')]))

    await saveDocument(makeDoc([makePage('p1', { processedBlob: blob('changed') })]))
    let [page] = (await loadDocuments()).documents[0].pages
    expect(await text(page.processedBlob)).toBe('p1-processed')

    await saveDocument(makeDoc([makePage('p1', { processedBlob: blob('changed') })]), {
      replacePageIds: ['p1'],
    })
    ;[page] = (await loadDocuments()).documents[0].pages
    expect(await text(page.processedBlob)).toBe('changed')
  })

  it('saves metadata without touching images', async () => {
    await saveDocument(makeDoc([makePage('p1'), makePage('p2')]))
    const reordered = makeDoc([makePage('p2'), makePage('p1')])
    reordered.name = 'Renamed'

    await saveDocumentMetadata(reordered)

    const [doc] = (await loadDocuments()).documents
    expect(doc.name).toBe('Renamed')
    expect(doc.pages.map((p) => p.id)).toEqual(['p2', 'p1'])
    expect(await text(doc.pages[0].originalBlob)).toBe('p2-original')
  })

  it('loads pages saved before thumbnails were stored, and stores one later', async () => {
    await saveDocument(makeDoc([makePage('p1', { thumbnailBlob: null })]))

    let [page] = (await loadDocuments()).documents[0].pages
    expect(page.thumbnailBlob).toBeNull()
    expect(page.thumbnailUrl).toBeNull()

    await saveThumbnail('p1', blob('backfilled'))
    ;[page] = (await loadDocuments()).documents[0].pages
    expect(await text(page.thumbnailBlob)).toBe('backfilled')
  })

  it('skips and counts pages whose original image is missing', async () => {
    await saveDocument(makeDoc([makePage('p1'), makePage('p2')]))
    await deletePageBlobs('p1')

    const { documents, skippedPages } = await loadDocuments()

    expect(skippedPages).toBe(1)
    expect(documents[0].pages.map((p) => p.id)).toEqual(['p2'])
  })

  it('deletes a document and all of its images', async () => {
    await saveDocument(makeDoc([makePage('p1')], 'gone'))
    await saveDocument(makeDoc([makePage('p2')], 'kept'))

    await deleteDocument('gone')

    const { documents } = await loadDocuments()
    expect(documents.map((d) => d.id)).toEqual(['kept'])
    // Re-saving the deleted page's metadata alone finds no images left.
    await saveDocumentMetadata(makeDoc([makePage('p1')], 'gone'))
    expect((await loadDocuments()).skippedPages).toBe(1)
  })

  it('asks for persistent storage once per session', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { storage: { persist, persisted: vi.fn().mockResolvedValue(false) } })

    await requestPersistentStorage()
    await requestPersistentStorage()

    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('does not ask again when storage is already persistent', async () => {
    const persist = vi.fn()
    vi.stubGlobal('navigator', { storage: { persist, persisted: vi.fn().mockResolvedValue(true) } })

    await requestPersistentStorage()

    expect(persist).not.toHaveBeenCalled()
  })
})
