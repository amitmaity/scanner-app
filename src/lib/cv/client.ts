/**
 * Main-thread side of the OpenCV worker: starts it, sends requests and
 * matches replies. Pixel buffers are transferred, so callers must not reuse
 * an image after passing it in.
 */
import type { Point } from '../../types'
import { ERROR_MESSAGES, ScannerError } from '../errors'
import type { CvMessage, CvRequest, CvResponse, FilterOptions, RawImage } from './protocol'

export const OPENCV_LOAD_TIMEOUT_MS = 30_000

const OPENCV_PATH = `${import.meta.env.BASE_URL}opencv/opencv.js`

type WorkerFactory = () => Worker

// Vite only bundles the worker when `new Worker(new URL(...))` is written out
// literally like this.
const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'opencv' })

let createWorker: WorkerFactory = defaultWorkerFactory
let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: unknown) => void }>()

/** The worker's OpenCV download and start-up. It has no timeout of its own:
 * a slow download that outlives a caller's timeout keeps going, and a retry
 * waits on it instead of fetching the ~10 MB script again. */
let runtimePromise: Promise<void> | null = null
let ready = false
let loadPromise: Promise<void> | null = null
let loadTimeoutId: ReturnType<typeof setTimeout> | null = null

/** Rejects everything in flight and drops the worker; the next call starts fresh. */
function discardWorker(reason: unknown): void {
  worker?.terminate()
  worker = null
  runtimePromise = null
  ready = false
  const waiting = [...pending.values()]
  pending.clear()
  for (const entry of waiting) entry.reject(reason)
}

function getWorker(): Worker {
  if (worker) return worker
  const created = createWorker()
  created.onmessage = (event: MessageEvent<CvResponse>) => {
    const response = event.data
    const entry = pending.get(response.id)
    if (!entry) return
    pending.delete(response.id)
    if (response.ok) entry.resolve(response.result)
    else entry.reject(new Error(response.message))
  }
  created.onerror = (event) => {
    event.preventDefault()
    discardWorker(new Error('The image processor stopped unexpectedly.'))
  }
  worker = created
  return created
}

function send<T>(request: CvRequest, transfer: Transferable[] = []): Promise<T> {
  const target = getWorker()
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    const message: CvMessage = { ...request, id }
    target.postMessage(message, transfer)
  })
}

function loadRuntime(): Promise<void> {
  if (runtimePromise) return runtimePromise
  const url = new URL(OPENCV_PATH, location.href).href
  runtimePromise = send<null>({ type: 'init', url }).then(
    () => {
      ready = true
    },
    (err: unknown) => {
      // A worker that couldn't start OpenCV is dropped so a retry begins clean.
      discardWorker(err)
      throw new ScannerError('OPENCV_LOAD_FAILED', ERROR_MESSAGES.OPENCV_LOAD_FAILED, {
        cause: err,
      })
    },
  )
  return runtimePromise
}

function clearLoadTimeout(): void {
  if (loadTimeoutId !== null) {
    clearTimeout(loadTimeoutId)
    loadTimeoutId = null
  }
}

/** Starts OpenCV in the worker, failing after `timeoutMs` (the download keeps going). */
export function loadOpenCV(options?: { timeoutMs?: number }): Promise<void> {
  if (ready) return Promise.resolve()
  if (loadPromise) return loadPromise

  const timeoutMs = options?.timeoutMs ?? OPENCV_LOAD_TIMEOUT_MS
  const runtime = loadRuntime()

  const attempt = new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearLoadTimeout()
      if (loadPromise === attempt) loadPromise = null
      action()
    }

    loadTimeoutId = setTimeout(() => {
      finish(() => reject(new ScannerError('OPENCV_TIMEOUT', ERROR_MESSAGES.OPENCV_TIMEOUT)))
    }, timeoutMs)

    runtime.then(
      () => finish(resolve),
      (err: unknown) => finish(() => reject(err)),
    )
  })

  loadPromise = attempt
  return attempt
}

/** Four page corners in `image` pixels (top-left first, clockwise), or null. */
export async function detectQuad(image: RawImage): Promise<Point[] | null> {
  await loadOpenCV()
  return send<Point[] | null>({ type: 'detect', image }, [image.data.buffer])
}

export async function warpQuad(image: RawImage, corners: Point[]): Promise<RawImage> {
  await loadOpenCV()
  return send<RawImage>({ type: 'warp', image, corners }, [image.data.buffer])
}

export async function filterImage(image: RawImage, options: FilterOptions): Promise<RawImage> {
  // Plain colour with brightness/contrast doesn't need OpenCV, so it keeps
  // working offline before the scanning tools are cached.
  if (options.mode !== 'color') await loadOpenCV()
  return send<RawImage>({ type: 'filter', image, options }, [image.data.buffer])
}

/** Test-only: swap the worker for a fake and reset all loader state. Leaves
 * earlier requests unsettled rather than rejecting them into the next test. */
export function resetCvClientForTests(factory: WorkerFactory | null = null): void {
  worker?.terminate()
  worker = null
  runtimePromise = null
  ready = false
  pending.clear()
  clearLoadTimeout()
  loadPromise = null
  createWorker = factory ?? defaultWorkerFactory
}
