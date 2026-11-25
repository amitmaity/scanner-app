import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Page, ScanDocument } from '../types'
import { ERROR_MESSAGES, isQuotaExceeded, ScannerError } from './errors'

/** A page as saved in `documents`: its images live separately in `blobs`.
 * Records written before thumbnails were stored may carry extra placeholder
 * fields; loading ignores them. */
interface StoredPage {
  id: string
  corners: Page['corners']
  filter: Page['filter']
  createdAt: number
}

interface StoredDocument extends Omit<ScanDocument, 'pages'> {
  pages: StoredPage[]
}

interface ScannerDB extends DBSchema {
  documents: {
    key: string
    value: StoredDocument
    indexes: { 'by-updated': number }
  }
  blobs: {
    key: string
    value: Blob
  }
}

const DB_NAME = 'scanner-app'
const DB_VERSION = 1

type BlobKind = 'original' | 'processed' | 'thumb'
const BLOB_KINDS: readonly BlobKind[] = ['original', 'processed', 'thumb']

let dbPromise: Promise<IDBPDatabase<ScannerDB>> | null = null

function wrapStorageError(err: unknown): ScannerError {
  if (err instanceof ScannerError) return err
  if (isQuotaExceeded(err)) {
    return new ScannerError('STORAGE_QUOTA', ERROR_MESSAGES.STORAGE_QUOTA, { cause: err })
  }
  return new ScannerError('PERSIST_FAILED', ERROR_MESSAGES.PERSIST_FAILED, { cause: err })
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<ScannerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const docStore = db.createObjectStore('documents', { keyPath: 'id' })
        docStore.createIndex('by-updated', 'updatedAt')
        db.createObjectStore('blobs')
      },
    }).catch((err: unknown) => {
      dbPromise = null
      throw new ScannerError('STORAGE_UNAVAILABLE', ERROR_MESSAGES.STORAGE_UNAVAILABLE, {
        cause: err,
      })
    })
  }
  return dbPromise
}

/** Test-only: drops the cached connection so a fresh database can be opened. */
export async function resetStorageForTests(): Promise<void> {
  const db = await dbPromise?.catch(() => null)
  db?.close()
  dbPromise = null
  persistRequested = false
}

function blobKey(pageId: string, kind: BlobKind): string {
  return `${pageId}:${kind}`
}

function pageBlob(page: Page, kind: BlobKind): Blob | null {
  switch (kind) {
    case 'original':
      return page.originalBlob.size > 0 ? page.originalBlob : null
    case 'processed':
      return page.processedBlob
    case 'thumb':
      return page.thumbnailBlob
  }
}

function toStoredDocument(doc: ScanDocument): StoredDocument {
  return {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    pages: doc.pages.map((p) => ({
      id: p.id,
      corners: p.corners,
      filter: p.filter,
      createdAt: p.createdAt,
    })),
  }
}

export interface SaveOptions {
  /** Pages whose images changed (an edited page): always rewrite their blobs. */
  replacePageIds?: Iterable<string>
}

export async function saveDocument(doc: ScanDocument, options: SaveOptions = {}): Promise<void> {
  const replace = new Set(options.replacePageIds ?? [])
  try {
    const db = await getDb()
    const tx = db.transaction(['documents', 'blobs'], 'readwrite')
    const blobStore = tx.objectStore('blobs')

    // Pages are otherwise immutable, so skip blobs that are already stored to
    // avoid rewriting multi-MB images on every reorder or delete.
    for (const page of doc.pages) {
      const replacing = replace.has(page.id)
      for (const kind of BLOB_KINDS) {
        const key = blobKey(page.id, kind)
        const blob = pageBlob(page, kind)
        if (!blob) {
          if (replacing) await blobStore.delete(key)
          continue
        }
        if (replacing || !(await blobStore.getKey(key))) {
          await blobStore.put(blob, key)
        }
      }
    }

    await tx.objectStore('documents').put(toStoredDocument(doc))
    await tx.done
  } catch (err) {
    throw wrapStorageError(err)
  }
}

export async function saveDocumentMetadata(doc: ScanDocument): Promise<void> {
  try {
    const db = await getDb()
    await db.put('documents', toStoredDocument(doc))
  } catch (err) {
    throw wrapStorageError(err)
  }
}

export async function saveThumbnail(pageId: string, blob: Blob): Promise<void> {
  try {
    const db = await getDb()
    await db.put('blobs', blob, blobKey(pageId, 'thumb'))
  } catch (err) {
    throw wrapStorageError(err)
  }
}

export interface LoadDocumentsResult {
  documents: ScanDocument[]
  skippedPages: number
}

export async function loadDocuments(): Promise<LoadDocumentsResult> {
  try {
    const db = await getDb()
    // One transaction with every read issued at once, instead of a separate
    // round trip per image, keeps launch fast as the library grows.
    const tx = db.transaction(['documents', 'blobs'])
    const blobStore = tx.objectStore('blobs')
    const stored = await tx.objectStore('documents').index('by-updated').getAll()

    const withBlobs = await Promise.all(
      stored.reverse().map(async (doc) => ({
        doc,
        pages: await Promise.all(
          doc.pages.map(async (page) => {
            const [original, processed, thumb] = await Promise.all(
              BLOB_KINDS.map((kind) => blobStore.get(blobKey(page.id, kind))),
            )
            return { page, original, processed, thumb }
          }),
        ),
      })),
    )
    await tx.done

    let skippedPages = 0
    const documents = withBlobs.map(({ doc, pages }) => {
      const hydrated: Page[] = []
      for (const { page, original, processed, thumb } of pages) {
        if (!original) {
          skippedPages += 1
          continue
        }
        hydrated.push({
          id: page.id,
          corners: page.corners,
          filter: page.filter,
          createdAt: page.createdAt,
          originalBlob: original,
          processedBlob: processed ?? null,
          thumbnailBlob: thumb ?? null,
          thumbnailUrl: thumb ? URL.createObjectURL(thumb) : null,
        })
      }
      return {
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        pages: hydrated,
      }
    })

    return { documents, skippedPages }
  } catch (err) {
    throw wrapStorageError(err)
  }
}

export async function deletePageBlobs(pageId: string): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction('blobs', 'readwrite')
    for (const kind of BLOB_KINDS) {
      await tx.store.delete(blobKey(pageId, kind))
    }
    await tx.done
  } catch (err) {
    throw wrapStorageError(err)
  }
}

export async function deleteDocument(id: string): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction(['documents', 'blobs'], 'readwrite')
    const doc = await tx.objectStore('documents').get(id)
    if (doc) {
      for (const page of doc.pages) {
        for (const kind of BLOB_KINDS) {
          await tx.objectStore('blobs').delete(blobKey(page.id, kind))
        }
      }
      await tx.objectStore('documents').delete(id)
    }
    await tx.done
  } catch (err) {
    throw wrapStorageError(err)
  }
}

let persistRequested = false

/**
 * Asks the browser not to evict saved scans under storage pressure or, in
 * Safari, after a week without visits. Best effort, once per session; some
 * browsers decide silently, Firefox asks the user.
 */
export async function requestPersistentStorage(): Promise<void> {
  if (persistRequested) return
  persistRequested = true
  try {
    if (!navigator.storage?.persist) return
    if (await navigator.storage.persisted()) return
    await navigator.storage.persist()
  } catch {
    // Not supported or denied: scans still save, just without the guarantee.
  }
}
