import { useCallback, useEffect, useRef, useState } from 'react'
import { detectDocumentEdges } from '../lib/detectEdges'
import { loadOpenCV, normalizeImageOrientation } from '../lib/opencv'
import { defaultCorners, type PendingCapture } from '../types'

interface CameraCaptureProps {
  onCapture: (capture: PendingCapture) => void
  onCancel: () => void
}

export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)

  const stopStream = useCallback(() => {
    stream?.getTracks().forEach((track) => track.stop())
    setStream(null)
  }, [stream])

  useEffect(() => {
    let active = true

    async function startCamera() {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        if (!active) {
          media.getTracks().forEach((t) => t.stop())
          return
        }
        setStream(media)
        if (videoRef.current) {
          videoRef.current.srcObject = media
        }
      } catch {
        setError('Camera access denied or unavailable. Use upload instead.')
      }
    }

    startCamera()
    return () => {
      active = false
      mediaStreamCleanup(videoRef.current?.srcObject as MediaStream | null)
    }
  }, [])

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const processImage = async (rawBlob: Blob) => {
    setIsCapturing(true)
    setError(null)
    try {
      // Bake EXIF orientation into the pixels so preview, detection, and crop
      // all use identical upright image data.
      const { blob, width, height } = await normalizeImageOrientation(rawBlob)
      const url = URL.createObjectURL(blob)

      await loadOpenCV()
      const corners = await detectDocumentEdges(blob, width, height)

      onCapture({
        blob,
        imageUrl: url,
        width,
        height,
        corners: corners.length === 4 ? corners : defaultCorners(width, height),
      })
    } catch {
      setError('Failed to process image')
      setIsCapturing(false)
    }
  }

  const captureFromCamera = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Capture failed'))),
        'image/jpeg',
        0.92,
      )
    })

    stopStream()
    await processImage(blob)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    stopStream()
    await processImage(file)
  }

  return (
    <div className="capture-screen">
      <div className="capture-header">
        <button type="button" className="btn btn-ghost" onClick={() => { stopStream(); onCancel() }}>
          Cancel
        </button>
        <h2>Capture document</h2>
        <div className="spacer" />
      </div>

      {error && <p className="error-banner">{error}</p>}

      <div className="camera-container">
        {stream ? (
          <video ref={videoRef} autoPlay playsInline muted className="camera-preview" />
        ) : (
          <div className="camera-placeholder">
            <p>No camera — upload an image instead</p>
          </div>
        )}
        <div className="camera-overlay" />
      </div>

      <div className="capture-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={isCapturing}
        >
          Upload
        </button>
        <button
          type="button"
          className="shutter-btn"
          onClick={captureFromCamera}
          disabled={!stream || isCapturing}
          aria-label="Capture"
        />
        <div className="spacer-btn" />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleFileChange}
      />

      {isCapturing && (
        <div className="loading-overlay">
          <div className="spinner" />
          <p>Detecting edges…</p>
        </div>
      )}
    </div>
  )
}

function mediaStreamCleanup(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}
