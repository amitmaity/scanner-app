import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfflineStatus } from './OfflineStatus'

const HINT = 'Stay online once to download scanning tools for offline use.'

function mockCacheStorage(match: (url: string, options?: CacheQueryOptions) => boolean) {
  const cacheStorage = {
    match: vi.fn(async (url: string, options?: CacheQueryOptions) =>
      match(url, options) ? new Response('cv') : undefined,
    ),
  }
  Object.defineProperty(window, 'caches', { value: cacheStorage, configurable: true })
  return cacheStorage
}

describe('OfflineStatus', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'caches')
  })

  it('finds OpenCV in the Workbox precache despite its revision query', async () => {
    // Workbox stores it as opencv.js?__WB_REVISION__=<hash>: only an
    // ignoreSearch lookup can match the plain URL.
    const cacheStorage = mockCacheStorage((_url, options) => options?.ignoreSearch === true)

    render(<OfflineStatus offlineReady />)

    await waitFor(() => expect(cacheStorage.match).toHaveBeenCalled())
    expect(await screen.findByText('Scanner is ready for offline use.')).toBeInTheDocument()
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('shows the download hint when OpenCV is not cached', async () => {
    mockCacheStorage(() => false)

    render(<OfflineStatus offlineReady={false} />)

    expect(await screen.findByText(HINT)).toBeInTheDocument()
  })
})
