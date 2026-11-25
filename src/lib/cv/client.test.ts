import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectQuad, filterImage, loadOpenCV, resetCvClientForTests, warpQuad } from './client'
import type { CvMessage, CvResponse, RawImage } from './protocol'

/** Stands in for the worker; tests decide how and when it replies. */
class FakeWorker {
  static instances: FakeWorker[] = []
  received: { message: CvMessage; transfer: Transferable[] }[] = []
  onmessage: ((event: MessageEvent<CvResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminate = vi.fn()

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: CvMessage, transfer: Transferable[] = []) {
    this.received.push({ message, transfer })
  }

  reply(response: CvResponse) {
    this.onmessage?.({ data: response } as MessageEvent<CvResponse>)
  }

  last(type: CvMessage['type']) {
    return [...this.received].reverse().find((r) => r.message.type === type)?.message
  }

  crash() {
    this.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent)
  }
}

function raw(width = 2, height = 2): RawImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

const latest = () => FakeWorker.instances.at(-1)!

async function startedWorker() {
  const loading = loadOpenCV()
  const w = latest()
  w.reply({ id: w.last('init')!.id, ok: true, result: null })
  await loading
  return w
}

describe('OpenCV worker client', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    resetCvClientForTests(() => new FakeWorker() as unknown as Worker)
  })

  afterEach(() => {
    vi.useRealTimers()
    resetCvClientForTests()
  })

  it('starts OpenCV in the worker with an absolute script URL', async () => {
    await startedWorker()

    const init = latest().last('init')
    expect(init).toMatchObject({ type: 'init' })
    expect((init as { url: string }).url).toMatch(/^http.*\/opencv\/opencv\.js$/)
  })

  it('starts the worker only once', async () => {
    await startedWorker()
    await loadOpenCV()

    expect(FakeWorker.instances).toHaveLength(1)
    expect(latest().received.filter((r) => r.message.type === 'init')).toHaveLength(1)
  })

  it('times out but reuses the download still in flight when retried', async () => {
    vi.useFakeTimers()
    const first = loadOpenCV({ timeoutMs: 40 })
    const timedOut = expect(first).rejects.toMatchObject({ code: 'OPENCV_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(40)
    await timedOut

    const second = loadOpenCV({ timeoutMs: 1000 })
    const w = latest()
    w.reply({ id: w.last('init')!.id, ok: true, result: null })
    await expect(second).resolves.toBeUndefined()

    // One worker, one download: the retry waited on the original.
    expect(FakeWorker.instances).toHaveLength(1)
    expect(w.received.filter((r) => r.message.type === 'init')).toHaveLength(1)
  })

  it('discards a worker that failed to start OpenCV and retries with a fresh one', async () => {
    const first = loadOpenCV()
    const broken = latest()
    broken.reply({ id: broken.last('init')!.id, ok: false, message: 'HTTP 404' })
    await expect(first).rejects.toMatchObject({ code: 'OPENCV_LOAD_FAILED' })
    expect(broken.terminate).toHaveBeenCalled()

    const retry = await startedWorker()
    expect(retry).not.toBe(broken)
  })

  it('rejects in-flight work and recovers when the worker crashes', async () => {
    const w = await startedWorker()
    const detecting = detectQuad(raw())
    await vi.waitFor(() => expect(w.last('detect')).toBeDefined())

    w.crash()

    await expect(detecting).rejects.toThrow('stopped unexpectedly')
    expect(w.terminate).toHaveBeenCalled()
    await startedWorker()
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it('transfers pixel buffers instead of copying them', async () => {
    const w = await startedWorker()
    const image = raw()

    const warping = warpQuad(image, [])
    await vi.waitFor(() => expect(w.last('warp')).toBeDefined())
    const sent = w.received.find((r) => r.message.type === 'warp')!
    expect(sent.transfer).toEqual([image.data.buffer])

    const output = raw(3, 3)
    w.reply({ id: sent.message.id, ok: true, result: output })
    await expect(warping).resolves.toBe(output)
  })

  it('passes worker errors back to the caller', async () => {
    const w = await startedWorker()
    const detecting = detectQuad(raw())
    await vi.waitFor(() => expect(w.last('detect')).toBeDefined())

    w.reply({ id: w.last('detect')!.id, ok: false, message: 'cv exception' })

    await expect(detecting).rejects.toThrow('cv exception')
  })

  it('adjusts plain colour without waiting for OpenCV', async () => {
    const filtering = filterImage(raw(), { mode: 'color', brightness: 10, contrast: 0 })
    const w = latest()

    expect(w.last('init')).toBeUndefined()
    const request = w.last('filter')!
    w.reply({ id: request.id, ok: true, result: raw() })
    await expect(filtering).resolves.toMatchObject({ width: 2 })
  })

  it('loads OpenCV before other filters', async () => {
    const filtering = filterImage(raw(), { mode: 'blackwhite', brightness: 0, contrast: 0 })
    const w = latest()
    expect(w.last('filter')).toBeUndefined()

    w.reply({ id: w.last('init')!.id, ok: true, result: null })
    await vi.waitFor(() => expect(w.last('filter')).toBeDefined())
    w.reply({ id: w.last('filter')!.id, ok: true, result: raw() })
    await expect(filtering).resolves.toBeDefined()
  })
})
