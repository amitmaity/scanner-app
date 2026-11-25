import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CropEditor } from './CropEditor'

const corners = [
  { x: 100, y: 100 },
  { x: 900, y: 100 },
  { x: 900, y: 700 },
  { x: 100, y: 700 },
]

function setup() {
  const onCornersChange = vi.fn()
  render(
    <CropEditor
      capture={{ blob: new Blob(), imageUrl: 'blob:img', width: 1000, height: 800, corners }}
      onCornersChange={onCornersChange}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      isProcessing={false}
    />,
  )
  return onCornersChange
}

describe('CropEditor', () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  it('names each corner handle', () => {
    setup()
    for (const name of ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left']) {
      expect(screen.getByRole('button', { name: `${name} corner` })).toBeInTheDocument()
    }
  })

  it('moves a focused corner with the arrow keys', () => {
    const onCornersChange = setup()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Top-left corner' }), {
      key: 'ArrowRight',
    })

    // 0.2% of the 1000px long side.
    expect(onCornersChange).toHaveBeenLastCalledWith([{ x: 102, y: 100 }, ...corners.slice(1)])
  })

  it('takes bigger steps with Shift and stays inside the image', () => {
    const onCornersChange = setup()
    const handle = screen.getByRole('button', { name: 'Bottom-right corner' })

    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true })
    expect(onCornersChange).toHaveBeenLastCalledWith([
      ...corners.slice(0, 2),
      { x: 900, y: 720 },
      corners[3],
    ])

    fireEvent.keyDown(screen.getByRole('button', { name: 'Top-left corner' }), {
      key: 'ArrowUp',
      shiftKey: true,
    })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Top-left corner' }), {
      key: 'ArrowUp',
      shiftKey: true,
    })
    expect(onCornersChange.mock.calls.at(-1)?.[0][0]).toEqual({ x: 100, y: 80 })
  })

  it('ignores other keys', () => {
    const onCornersChange = setup()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Top-left corner' }), { key: 'a' })

    expect(onCornersChange).not.toHaveBeenCalled()
  })
})
