import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTER, type Page } from '../types'

vi.mock('../lib/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/export')>()
  return {
    ...actual,
    buildPdf: vi.fn(),
    buildImages: vi.fn(),
    downloadFiles: vi.fn(),
    shareFiles: vi.fn(),
    canShareFormat: vi.fn(() => false),
  }
})

import { buildImages, buildPdf, canShareFormat, downloadFiles, shareFiles } from '../lib/export'
import { ExportDialog } from './ExportDialog'

const page: Page = {
  id: 'p1',
  originalBlob: new Blob(['o']),
  corners: [],
  filter: { ...DEFAULT_FILTER },
  processedBlob: new Blob(['p']),
  thumbnailBlob: null,
  thumbnailUrl: null,
  createdAt: 1,
}
const pdfFile = { blob: new Blob(['%PDF']), name: 'scan.pdf' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function setup(documentName = 'Scan 25/11/2026, 13:42') {
  const onClose = vi.fn()
  render(<ExportDialog pages={[page]} documentName={documentName} onClose={onClose} />)
  return onClose
}

describe('ExportDialog', () => {
  beforeEach(() => {
    vi.mocked(buildPdf).mockReset().mockResolvedValue(pdfFile)
    vi.mocked(buildImages).mockReset()
    vi.mocked(downloadFiles).mockReset().mockResolvedValue()
    vi.mocked(shareFiles).mockReset().mockResolvedValue()
    vi.mocked(canShareFormat).mockReset().mockReturnValue(false)
  })

  it('suggests a filename that keeps the date readable', () => {
    setup()
    expect(screen.getByLabelText('Filename')).toHaveValue('Scan 25-11-2026, 13-42')
  })

  it('downloads the PDF and closes', async () => {
    const onClose = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(buildPdf).toHaveBeenCalledWith([page], 'Scan 25-11-2026, 13-42', expect.any(Function))
    expect(downloadFiles).toHaveBeenCalledWith([pdfFile])
  })

  it('closes on Escape or a backdrop tap, but not while exporting', async () => {
    const pending = deferred<typeof pdfFile>()
    vi.mocked(buildPdf).mockReturnValue(pending.promise)
    const onClose = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('presentation'))
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => pending.resolve(pdfFile))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('closes on Escape when idle', () => {
    const onClose = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shares through the system sheet where supported', async () => {
    vi.mocked(canShareFormat).mockReturnValue(true)
    const onClose = setup('Receipts')

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(shareFiles).toHaveBeenCalledWith([pdfFile], 'Receipts')
    expect(downloadFiles).not.toHaveBeenCalled()
  })

  it('stays open when the share sheet is dismissed', async () => {
    vi.mocked(canShareFormat).mockReturnValue(true)
    vi.mocked(shareFiles).mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    const onClose = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('asks for another tap when preparing outlasted the share permission', async () => {
    vi.mocked(canShareFormat).mockReturnValue(true)
    vi.mocked(shareFiles)
      .mockRejectedValueOnce(new DOMException('no activation', 'NotAllowedError'))
      .mockResolvedValueOnce()
    const onClose = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Share now' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(shareFiles).toHaveBeenCalledTimes(2)
    // The files built the first time are reused.
    expect(buildPdf).toHaveBeenCalledTimes(1)
  })

  it('delivers the images that worked and names the ones that failed', async () => {
    const good = { blob: new Blob(['1']), name: 'scan-1.jpg' }
    vi.mocked(buildImages).mockResolvedValue({ files: [good], failedPages: [2] })
    const onClose = setup()

    fireEvent.click(screen.getByLabelText('JPEG images'))
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to export page 2.')
    expect(downloadFiles).toHaveBeenCalledWith([good])
    expect(onClose).not.toHaveBeenCalled()
  })
})
