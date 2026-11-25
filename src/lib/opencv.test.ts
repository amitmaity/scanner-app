import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadOpenCV, resetOpenCvLoader } from './opencv'

function mockOpencvScript() {
  const originalCreate = document.createElement.bind(document)
  const script = {
    src: '',
    async: true,
    onload: null as ((ev: Event) => void) | null,
    onerror: null as ((ev: Event) => void) | null,
    remove: vi.fn(),
  }

  vi.spyOn(document, 'createElement').mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) => {
    if (tag === 'script') return script as unknown as HTMLScriptElement
    return originalCreate(tag, options)
  }) as typeof document.createElement)

  vi.spyOn(document.head, 'appendChild').mockImplementation((node) => node)

  return script
}

describe('loadOpenCV', () => {
  beforeEach(() => {
    resetOpenCvLoader()
    Reflect.deleteProperty(window, 'cv')
  })

  afterEach(() => {
    resetOpenCvLoader()
    Reflect.deleteProperty(window, 'cv')
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries after a failed load', async () => {
    const script = mockOpencvScript()

    const first = loadOpenCV({ timeoutMs: 1000 })
    expect(script.onerror).toBeTypeOf('function')
    script.onerror?.(new Event('error'))
    await expect(first).rejects.toMatchObject({ code: 'OPENCV_LOAD_FAILED' })

    const second = loadOpenCV({ timeoutMs: 1000 })
    window.cv = { Mat: class {} } as unknown as typeof window.cv
    script.onload?.(new Event('load'))
    await expect(second).resolves.toBeUndefined()
  })

  it('times out if the runtime never initializes', async () => {
    mockOpencvScript()
    vi.useFakeTimers()
    const pending = loadOpenCV({ timeoutMs: 40 })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'OPENCV_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(40)
    await assertion
  })

  it('reuses the in-flight download when retrying after a timeout', async () => {
    const script = mockOpencvScript()
    vi.useFakeTimers()

    const first = loadOpenCV({ timeoutMs: 40 })
    const firstAssertion = expect(first).rejects.toMatchObject({ code: 'OPENCV_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(40)
    await firstAssertion

    // The slow download is still going; a retry must wait on it rather than
    // append a second <script> and fetch the 10 MB file again.
    const second = loadOpenCV({ timeoutMs: 1000 })
    window.cv = { Mat: class {} } as unknown as typeof window.cv
    script.onload?.(new Event('load'))
    await expect(second).resolves.toBeUndefined()

    const scriptsCreated = vi
      .mocked(document.createElement)
      .mock.calls.filter(([tag]) => tag === 'script').length
    expect(scriptsCreated).toBe(1)
    expect(document.head.appendChild).toHaveBeenCalledTimes(1)
  })

  it('removes a failed script tag', async () => {
    const script = mockOpencvScript()
    const pending = loadOpenCV({ timeoutMs: 1000 })
    script.onerror?.(new Event('error'))
    await expect(pending).rejects.toMatchObject({ code: 'OPENCV_LOAD_FAILED' })
    expect(script.remove).toHaveBeenCalled()
  })

  it('resolves immediately when OpenCV is already present', async () => {
    window.cv = { Mat: class {} } as unknown as typeof window.cv
    await expect(loadOpenCV()).resolves.toBeUndefined()
  })
})
