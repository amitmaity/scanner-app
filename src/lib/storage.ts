import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Page, ScanDocument } from '../types'
import { ERROR_MESSAGES, isQuotaExceeded, ScannerError } from './errors'

interface ScannerDB extends DBSchema {
  documents: {
    key: string
    value: ScanDocument
    indexes: { 'by-updated': number }
  }
  blobs: {
    key: string
    value: Blob
  }
}

const DB_NAME = 'scanner-app'
const DB_VERSION = 1

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

function blobKey(pageId: string, kind: 'original' | 'processed'): string {
  return `${pageId}:${kind}`
}

function toStoredDocument(doc: ScanDocument): ScanDocument {
  return {
    ...doc,
    pages: doc.pages.map((p) => ({
      ...p,
      originalBlob: new Blob(),
      processedBlob: null,
      thumbnailUrl: null,
    })),
  }
}

export async function saveDocument(doc: ScanDocument): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction(['documents', 'blobs'], 'readwrite')
    const blobStore = tx.objectStore('blobs')

    // Only write blobs that aren't already persisted to avoid rewriting
    // multi-MB images on every reorder/delete.
    for (const page of doc.pages) {
      const originalKey = blobKey(page.id, 'original')
      if (page.originalBlob.size > 0 && !(await blobStore.getKey(originalKey))) {
        await blobStore.put(page.originalBlob, originalKey)
      }
      if (page.processedBlob) {
        const processedKey = blobKey(page.id, 'processed')
        if (!(await blobStore.getKey(processedKey))) {
          await blobStore.put(page.processedBlob, processedKey)
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

export interface LoadDocumentsResult {
  documents: ScanDocument[]
  skippedPages: number
}

export async function loadDocuments(): Promise<LoadDocumentsResult> {
  try {
    const db = await getDb()
    const docs = await db.getAllFromIndex('documents', 'by-updated')
    const hydrated: ScanDocument[] = []
    let skippedPages = 0

    for (const doc of docs.reverse()) {
      const pages: Page[] = []
      for (const page of doc.pages) {
        const originalBlob = await db.get('blobs', blobKey(page.id, 'original'))
        const processedBlob = await db.get('blobs', blobKey(page.id, 'processed'))
        if (!originalBlob) {
          skippedPages += 1
          continue
        }
        pages.push({
          ...page,
          originalBlob,
          processedBlob: processedBlob ?? null,
          thumbnailUrl: processedBlob ? URL.createObjectURL(processedBlob) : null,
        })
      }
      hydrated.push({ ...doc, pages })
    }

    return { documents: hydrated, skippedPages }
  } catch (err) {
    if (err instanceof ScannerError) throw err
    throw wrapStorageError(err)
  }
}

export async function deletePageBlobs(pageId: string): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction('blobs', 'readwrite')
    await tx.store.delete(blobKey(pageId, 'original'))
    await tx.store.delete(blobKey(pageId, 'processed'))
    await tx.done
  } catch (err) {
    throw wrapStorageError(err)
  }
}

export async function deleteDocument(id: string): Promise<void> {
  try {
    const db = await getDb()
    const doc = await db.get('documents', id)
    if (!doc) return

    const tx = db.transaction(['documents', 'blobs'], 'readwrite')
    for (const page of doc.pages) {
      await tx.objectStore('blobs').delete(blobKey(page.id, 'original'))
      await tx.objectStore('blobs').delete(blobKey(page.id, 'processed'))
    }
    await tx.objectStore('documents').delete(id)
    await tx.done
  } catch (err) {
    throw wrapStorageError(err)
  }
}
