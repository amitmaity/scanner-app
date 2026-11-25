/**
 * Worker-side startup and message handling, kept apart from the worker entry
 * point so tests can drive it with a fake scope, fetch and OpenCV module.
 */
import { requireCv, runOp } from './ops'
import type { CvMessage, CvResponse } from './protocol'
import type { OpenCvModule } from './types'

export interface WorkerScope {
  cv?: OpenCvModule
  postMessage(message: CvResponse, transfer?: Transferable[]): void
}

const READY_POLL_MS = 50
/** How long to wait for the WebAssembly runtime after the script has run. */
const READY_TIMEOUT_MS = 20_000

/**
 * Resolves once the module's runtime is up. It deliberately resolves with
 * nothing: the module has an Emscripten `then` method, and a promise that
 * resolves *with* it never settles.
 */
export function waitForRuntime(module: OpenCvModule, pollMs = READY_POLL_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    if (module.Mat) {
      resolve()
      return
    }
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    module.onRuntimeInitialized = done
    // Polling as well covers a runtime that started before the hook was set.
    const deadline = Date.now() + READY_TIMEOUT_MS
    const poll = () => {
      if (settled) return
      if (module.Mat) return done()
      if (Date.now() > deadline) {
        settled = true
        reject(new Error('OpenCV runtime did not start'))
        return
      }
      setTimeout(poll, pollMs)
    }
    setTimeout(poll, pollMs)
  })
}

export interface OpenCvLoader {
  load(url: string): Promise<void>
  get(): OpenCvModule | null
}

export function createOpenCvLoader(
  scope: WorkerScope,
  fetchScript: (url: string) => Promise<Response> = (url) => fetch(url),
  // opencv.js is a classic UMD script, and module workers (the only kind Vite
  // serves in dev) can't importScripts(). Indirect eval runs it as a global
  // script, where it assigns `self.cv`.
  evaluate: (source: string) => void = (source) => (0, eval)(source),
): OpenCvLoader {
  let cv: OpenCvModule | null = null
  let loading: Promise<void> | null = null

  return {
    get: () => cv,
    load(url) {
      loading ??= (async () => {
        const response = await fetchScript(url)
        if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`)
        evaluate(await response.text())
        const module = scope.cv
        if (!module) throw new Error('The script did not define cv')
        await waitForRuntime(module)
        cv = module
      })()
      return loading
    },
  }
}

function describeError(err: unknown, cv: OpenCvModule | null): string {
  if (err instanceof Error) return err.message
  // OpenCV.js throws C++ exceptions as numeric pointers.
  if (typeof err === 'number' && cv?.exceptionFromPtr) {
    try {
      return cv.exceptionFromPtr(err).msg
    } catch {
      // Fall through to the raw value.
    }
  }
  return String(err)
}

export function createMessageHandler(scope: WorkerScope, loader: OpenCvLoader) {
  return async (message: CvMessage): Promise<void> => {
    try {
      if (message.type === 'init') {
        await loader.load(message.url)
        scope.postMessage({ id: message.id, ok: true, result: null })
        return
      }
      // "Color" filtering works without OpenCV; everything else needs it.
      const cv = message.type === 'filter' ? loader.get() : requireCv(loader.get())
      const { result, transfer } = runOp(cv, message)
      scope.postMessage({ id: message.id, ok: true, result }, transfer)
    } catch (err) {
      scope.postMessage({ id: message.id, ok: false, message: describeError(err, loader.get()) })
    }
  }
}
