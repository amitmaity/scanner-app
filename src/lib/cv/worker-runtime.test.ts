import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CvMessage, CvResponse } from './protocol'
import type { OpenCvModule } from './types'
import {
  createMessageHandler,
  createOpenCvLoader,
  waitForRuntime,
  type WorkerScope,
} from './worker-runtime'

function fakeScope() {
  const posted: { message: CvResponse; transfer?: Transferable[] }[] = []
  const scope: WorkerScope = {
    postMessage: (message, transfer) => posted.push({ message, transfer }),
  }
  return { scope, posted }
}

/** Like OpenCV.js: a module with an Emscripten-style `then`. */
function emscriptenModule(ready: boolean) {
  const module: Record<string, unknown> = {}
  if (ready) module.Mat = class {}
  module.then = (fn: (m: unknown) => void) => {
    fn(module)
    return module
  }
  return module as unknown as OpenCvModule
}

function okResponse(body: string) {
  return Promise.resolve(new Response(body, { status: 200 }))
}

describe('waitForRuntime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('settles even though the module is a thenable', async () => {
    // Resolving a promise *with* an Emscripten module never settles; this
    // must resolve with nothing.
    await expect(waitForRuntime(emscriptenModule(true))).resolves.toBeUndefined()
  })

  it('waits for onRuntimeInitialized', async () => {
    const module = emscriptenModule(false)
    const waiting = waitForRuntime(module)

    module.onRuntimeInitialized?.()

    await expect(waiting).resolves.toBeUndefined()
  })

  it('notices a runtime that started before the hook was set', async () => {
    vi.useFakeTimers()
    const module = emscriptenModule(false)
    const waiting = waitForRuntime(module, 10)

    ;(module as unknown as { Mat: unknown }).Mat = class {}
    await vi.advanceTimersByTimeAsync(10)

    await expect(waiting).resolves.toBeUndefined()
  })

  it('gives up if the runtime never starts', async () => {
    vi.useFakeTimers()
    const waiting = waitForRuntime(emscriptenModule(false), 1000)
    const assertion = expect(waiting).rejects.toThrow('did not start')

    await vi.advanceTimersByTimeAsync(21_000)
    await assertion
  })
})

describe('createOpenCvLoader', () => {
  it('fetches the script, runs it and waits for cv', async () => {
    const { scope } = fakeScope()
    const fetchScript = vi.fn(() => okResponse('/* opencv */'))
    const evaluate = vi.fn(() => {
      scope.cv = emscriptenModule(true)
    })
    const loader = createOpenCvLoader(scope, fetchScript, evaluate)

    await loader.load('https://app/opencv/opencv.js')
    await loader.load('https://app/opencv/opencv.js')

    expect(fetchScript).toHaveBeenCalledTimes(1)
    expect(evaluate).toHaveBeenCalledWith('/* opencv */')
    expect(loader.get()).toBe(scope.cv)
  })

  it('reports a failed download', async () => {
    const { scope } = fakeScope()
    const loader = createOpenCvLoader(
      scope,
      () => Promise.resolve(new Response('', { status: 404 })),
      vi.fn(),
    )

    await expect(loader.load('x')).rejects.toThrow('HTTP 404')
    expect(loader.get()).toBeNull()
  })

  it('reports a script that does not define cv', async () => {
    const { scope } = fakeScope()
    const loader = createOpenCvLoader(scope, () => okResponse(''), vi.fn())

    await expect(loader.load('x')).rejects.toThrow('did not define cv')
  })
})

describe('createMessageHandler', () => {
  function readyLoader(cv: OpenCvModule | null) {
    return { load: vi.fn().mockResolvedValue(undefined), get: () => cv }
  }

  it('acknowledges init once OpenCV is loaded', async () => {
    const { scope, posted } = fakeScope()
    const loader = readyLoader(null)

    await createMessageHandler(scope, loader)({ id: 1, type: 'init', url: 'u' })

    expect(loader.load).toHaveBeenCalledWith('u')
    expect(posted[0].message).toEqual({ id: 1, ok: true, result: null })
  })

  it('reports a failed init with its message', async () => {
    const { scope, posted } = fakeScope()
    const loader = { load: vi.fn().mockRejectedValue(new Error('HTTP 404')), get: () => null }

    await createMessageHandler(scope, loader)({ id: 2, type: 'init', url: 'u' })

    expect(posted[0].message).toEqual({ id: 2, ok: false, message: 'HTTP 404' })
  })

  it('filters plain colour before OpenCV has loaded and transfers the result', async () => {
    const { scope, posted } = fakeScope()
    const message: CvMessage = {
      id: 3,
      type: 'filter',
      image: { width: 1, height: 1, data: new Uint8ClampedArray([10, 10, 10, 255]) },
      options: { mode: 'color', brightness: 5, contrast: 0 },
    }

    await createMessageHandler(scope, readyLoader(null))(message)

    const { message: reply, transfer } = posted[0]
    expect(reply.ok).toBe(true)
    expect(transfer).toHaveLength(1)
  })

  it('refuses OpenCV work before init', async () => {
    const { scope, posted } = fakeScope()

    await createMessageHandler(scope, readyLoader(null))({
      id: 4,
      type: 'detect',
      image: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
    })

    expect(posted[0].message).toEqual({ id: 4, ok: false, message: 'OpenCV is not loaded' })
  })

  it('turns OpenCV C++ exception pointers into messages', async () => {
    const { scope, posted } = fakeScope()
    const cv = {
      matFromImageData: () => {
        throw 1234
      },
      exceptionFromPtr: (ptr: number) => ({ msg: `cv exception ${ptr}` }),
    } as unknown as OpenCvModule

    await createMessageHandler(scope, readyLoader(cv))({
      id: 5,
      type: 'warp',
      image: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
      corners: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    })

    expect(posted[0].message).toEqual({ id: 5, ok: false, message: 'cv exception 1234' })
  })
})
