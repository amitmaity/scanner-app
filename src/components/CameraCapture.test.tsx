import { act, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraCapture } from './CameraCapture'

function fakeStream() {
  const track = { stop: vi.fn() }
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream }
}

function mockGetUserMedia() {
  const resolvers: ((stream: MediaStream) => void)[] = []
  const getUserMedia = vi.fn(
    () => new Promise<MediaStream>((resolve) => resolvers.push(resolve)),
  )
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
  return { getUserMedia, resolvers }
}

describe('CameraCapture', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'mediaDevices')
  })

  it('stops a camera stream that resolves after a newer request', async () => {
    const { getUserMedia, resolvers } = mockGetUserMedia()

    // StrictMode mounts, unmounts and remounts, so two requests overlap — the
    // same shape as tapping "Try again" twice while a permission prompt is open.
    render(
      <StrictMode>
        <CameraCapture onCapture={vi.fn()} onCancel={vi.fn()} />
      </StrictMode>,
    )
    expect(getUserMedia).toHaveBeenCalledTimes(2)

    const stale = fakeStream()
    const current = fakeStream()
    await act(async () => {
      resolvers[0](stale.stream)
      resolvers[1](current.stream)
    })

    expect(stale.track.stop).toHaveBeenCalled()
    expect(current.track.stop).not.toHaveBeenCalled()
  })

  it('stops the camera when a request resolves after unmount', async () => {
    const { resolvers } = mockGetUserMedia()
    const { unmount } = render(<CameraCapture onCapture={vi.fn()} onCancel={vi.fn()} />)

    unmount()
    const late = fakeStream()
    await act(async () => {
      resolvers[0](late.stream)
    })

    expect(late.track.stop).toHaveBeenCalled()
  })
})
