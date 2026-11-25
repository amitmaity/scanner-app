import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Toolbar } from './Toolbar'

describe('Toolbar rename', () => {
  it('renames on Enter', () => {
    const onRename = vi.fn()
    render(<Toolbar title="Scan 1" onRename={onRename} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename Scan 1' }))
    const input = screen.getByLabelText('Scan name')
    fireEvent.change(input, { target: { value: 'Receipts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)

    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('Receipts')
  })

  it('saves on blur', () => {
    const onRename = vi.fn()
    render(<Toolbar title="Scan 1" onRename={onRename} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename Scan 1' }))
    const input = screen.getByLabelText('Scan name')
    fireEvent.change(input, { target: { value: 'Taxes' } })
    fireEvent.blur(input)

    expect(onRename).toHaveBeenCalledWith('Taxes')
  })

  it('cancels on Escape, even if a blur follows', () => {
    const onRename = vi.fn()
    render(<Toolbar title="Scan 1" onRename={onRename} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename Scan 1' }))
    const input = screen.getByLabelText('Scan name')
    fireEvent.change(input, { target: { value: 'Oops' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('heading')).toHaveTextContent('Scan 1')
  })

  it('ignores blank or unchanged names', () => {
    const onRename = vi.fn()
    render(<Toolbar title="Scan 1" onRename={onRename} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename Scan 1' }))
    fireEvent.change(screen.getByLabelText('Scan name'), { target: { value: '   ' } })
    fireEvent.keyDown(screen.getByLabelText('Scan name'), { key: 'Enter' })

    expect(onRename).not.toHaveBeenCalled()
  })

  it('is a plain heading without a rename handler', () => {
    render(<Toolbar title="Scanner" />)
    expect(screen.getByRole('heading', { name: 'Scanner' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
