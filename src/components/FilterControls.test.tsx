import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTER } from '../types'
import { FilterControls, SLIDER_APPLY_DELAY_MS } from './FilterControls'

function setup(overrides: Partial<Parameters<typeof FilterControls>[0]> = {}) {
  const props = {
    filter: { ...DEFAULT_FILTER },
    previewUrl: null,
    onChange: vi.fn(),
    onApply: vi.fn(),
    onSave: vi.fn(),
    onRetake: vi.fn(),
    onBackToCrop: vi.fn(),
    isEditing: false,
    isProcessing: false,
    isPreviewing: false,
    ...overrides,
  }
  render(<FilterControls {...props} />)
  return props
}

describe('FilterControls', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes the preview once a slider settles, whatever changed it', () => {
    const props = setup()
    const brightness = screen.getByLabelText('Brightness')

    // Keyboard (ArrowUp/PageUp), touch and screen readers all end up as
    // value changes; several in a row produce a single render.
    fireEvent.change(brightness, { target: { value: '10' } })
    fireEvent.change(brightness, { target: { value: '20' } })
    fireEvent.change(brightness, { target: { value: '30' } })
    expect(props.onChange).toHaveBeenLastCalledWith({ brightness: 30 })
    expect(props.onApply).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(SLIDER_APPLY_DELAY_MS)
    })
    expect(props.onApply).toHaveBeenCalledTimes(1)
  })

  it('applies a filter mode immediately', () => {
    const props = setup()

    fireEvent.click(screen.getByRole('button', { name: 'B&W' }))

    expect(props.onChange).toHaveBeenCalledWith({ mode: 'blackwhite' })
    expect(props.onApply).toHaveBeenCalledTimes(1)
  })

  it('rotates by a quarter turn', () => {
    const props = setup({ filter: { ...DEFAULT_FILTER, rotation: 270 } })

    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90°' }))

    expect(props.onChange).toHaveBeenCalledWith({ rotation: 0 })
  })

  it('keeps controls usable while only the preview is rendering', () => {
    setup({ isPreviewing: true })

    expect(screen.getByRole('button', { name: 'Add page' })).toBeEnabled()
    expect(screen.getByLabelText('Contrast')).toBeEnabled()
  })

  it('locks the screen while saving', () => {
    setup({ isProcessing: true })

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Retake' })).toBeDisabled()
    expect(screen.getByLabelText('Contrast')).toBeDisabled()
  })

  it('labels the save button for an edited page and offers going back to the crop', () => {
    const props = setup({ isEditing: true })

    fireEvent.click(screen.getByRole('button', { name: 'Adjust crop' }))

    expect(screen.getByRole('button', { name: 'Save page' })).toBeInTheDocument()
    expect(props.onBackToCrop).toHaveBeenCalled()
  })
})
