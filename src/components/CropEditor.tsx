import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { detectDocumentEdges } from '../lib/detectEdges'
import { clampPoint } from '../lib/geometry'
import type { PendingCapture, Point } from '../types'

interface CropEditorProps {
  capture: PendingCapture
  onCornersChange: (corners: Point[]) => void
  onConfirm: () => void
  onCancel: () => void
  isProcessing: boolean
}

const HANDLE_RADIUS = 22
/** Corners arrive ordered top-left, clockwise (detection and defaults both do). */
const CORNER_NAMES = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left']
/** Arrow keys move a corner by this share of the image's long side; ×10 with Shift. */
const KEY_STEP_RATIO = 0.002

const KEY_DIRECTIONS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

export function CropEditor({
  capture,
  onCornersChange,
  onConfirm,
  onCancel,
  isProcessing,
}: CropEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 })
  const [isRedetecting, setIsRedetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)

  const scale = displaySize.width > 0 ? displaySize.width / capture.width : 1

  const toDisplay = useCallback(
    (p: Point) => ({ x: p.x * scale, y: p.y * scale }),
    [scale],
  )

  const toImage = useCallback(
    (p: Point) => clampPoint({ x: p.x / scale, y: p.y / scale }, capture.width, capture.height),
    [scale, capture.width, capture.height],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      const aspect = capture.width / capture.height
      let width = rect.width
      let height = width / aspect
      if (height > rect.height) {
        height = rect.height
        width = height * aspect
      }
      setDisplaySize({ width, height })
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [capture.width, capture.height])

  const getPointerPos = (clientX: number, clientY: number): Point | null => {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const offsetX = (rect.width - displaySize.width) / 2
    const offsetY = (rect.height - displaySize.height) / 2
    return {
      x: clientX - rect.left - offsetX,
      y: clientY - rect.top - offsetY,
    }
  }

  const handlePointerDown = (index: number) => (e: PointerEvent) => {
    e.preventDefault()
    setDragIndex(index)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handleKeyDown = (index: number) => (e: KeyboardEvent) => {
    const direction = KEY_DIRECTIONS[e.key]
    if (!direction) return
    e.preventDefault()
    const step =
      Math.max(1, Math.max(capture.width, capture.height) * KEY_STEP_RATIO) * (e.shiftKey ? 10 : 1)
    const corner = capture.corners[index]
    const next = [...capture.corners]
    next[index] = clampPoint(
      { x: corner.x + direction.x * step, y: corner.y + direction.y * step },
      capture.width,
      capture.height,
    )
    onCornersChange(next)
  }

  const handlePointerMove = (e: PointerEvent) => {
    if (dragIndex === null) return
    const pos = getPointerPos(e.clientX, e.clientY)
    if (!pos) return
    const imagePos = toImage(pos)
    const next = [...capture.corners]
    next[dragIndex] = imagePos
    onCornersChange(next)
  }

  const handlePointerUp = () => setDragIndex(null)

  const handleAutoDetect = async () => {
    setIsRedetecting(true)
    setDetectError(null)
    try {
      const corners = await detectDocumentEdges(capture.blob, capture.width, capture.height)
      onCornersChange(corners)
    } catch {
      setDetectError('Auto-detect failed; drag corners manually.')
    } finally {
      setIsRedetecting(false)
    }
  }

  const displayCorners = capture.corners.map(toDisplay)
  const polygonPoints = displayCorners.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div className="crop-screen">
      <div className="crop-header">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isProcessing}>
          Back
        </button>
        <h2>Adjust borders</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onConfirm}
          disabled={isProcessing}
        >
          {isProcessing ? 'Processing…' : 'Done'}
        </button>
      </div>

      <div
        ref={containerRef}
        className="crop-container"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div
          className="crop-canvas"
          style={{ width: displaySize.width, height: displaySize.height }}
        >
          <img src={capture.imageUrl} alt="Capture" className="crop-image" draggable={false} />
          <svg className="crop-overlay" width={displaySize.width} height={displaySize.height}>
            <polygon points={polygonPoints} className="crop-polygon" />
            {displayCorners.map((corner, i) => (
              <line
                key={`line-${i}`}
                x1={corner.x}
                y1={corner.y}
                x2={displayCorners[(i + 1) % 4].x}
                y2={displayCorners[(i + 1) % 4].y}
                className="crop-line"
              />
            ))}
          </svg>
          {displayCorners.map((corner, i) => (
            <button
              key={i}
              type="button"
              className="corner-handle"
              style={{
                left: corner.x - HANDLE_RADIUS,
                top: corner.y - HANDLE_RADIUS,
                width: HANDLE_RADIUS * 2,
                height: HANDLE_RADIUS * 2,
              }}
              onPointerDown={handlePointerDown(i)}
              onKeyDown={handleKeyDown(i)}
              aria-label={`${CORNER_NAMES[i] ?? `Corner ${i + 1}`} corner`}
              aria-describedby="crop-hint"
            />
          ))}
        </div>
      </div>

      <div className="crop-toolbar">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleAutoDetect()}
          disabled={isRedetecting || isProcessing}
        >
          {isRedetecting ? 'Detecting…' : 'Auto-detect edges'}
        </button>
        {detectError && (
          <p className="crop-detect-error" role="alert">
            {detectError}
          </p>
        )}
        <p className="hint" id="crop-hint">
          Drag corners, or focus one and use the arrow keys (Shift for bigger steps)
        </p>
      </div>
    </div>
  )
}
