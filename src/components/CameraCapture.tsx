import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { detectDocumentEdges } from '../lib/detectEdges'
import {
  cameraErrorFromUnknown,
  ERROR_MESSAGES,
  normalizeError,
} from '../lib/errors'
import { loadOpenCV, normalizeImageOrientation } from '../lib/opencv'
import { useScannerStore } from '../state/store'
import { defaultCorners, type PendingCapture } from '../types'

interface CameraCaptureProps {
  onCapture: (capture: PendingCapture) => void
  onCancel: () => void
}

export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const activeRef = useRef(true)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [loadingTools, setLoadingTools] = useState(false)
  const opencvStatus = useScannerStore((s) => s.opencvStatus)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const startCamera = useCallback(async () => {
    stopStream()
    setError(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(ERROR_MESSAGES.CAMERA_NOT_FOUND)
      return
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      if (!activeRef.current) {
        media.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = media
      setStream(media)
      if (videoRef.current) {
        videoRef.current.srcObject = media
      }
    } catch (err) {
      setError(cameraErrorFromUnknown(err).message)
    }
  }, [stopStream])

  useEffect(() => {
    activeRef.current = true
    void startCamera()
    return () => {
      activeRef.current = false
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [startCamera])

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const processImage = async (rawBlob: Blob) => {
    setIsCapturing(true)
    setError(null)
    try {
      const { blob, width, height } = await normalizeImageOrientation(rawBlob)
      const url = URL.createObjectURL(blob)

      setLoadingTools(true)
      await loadOpenCV()
      setLoadingTools(false)
      const corners = await detectDocumentEdges(blob, width, height)

      onCapture({
        blob,
        imageUrl: url,
        width,
        height,
        corners: corners.length === 4 ? corners : defaultCorners(width, height),
      })
    } catch (err) {
      const { code, message } = normalizeError(err, 'CAPTURE_FAILED')
      if (code === 'OPENCV_LOAD_FAILED' || code === 'OPENCV_TIMEOUT') {
        setError(message)
      } else {
        setError('Could not process this image. Try another file or retake the photo.')
      }
      setIsCapturing(false)
      setLoadingTools(false)
      void startCamera()
    }
  }

  const captureFromCamera = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) {
      setError(ERROR_MESSAGES.CAPTURE_FAILED)
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setError(ERROR_MESSAGES.CAPTURE_FAILED)
      return
    }
    ctx.drawImage(video, 0, 0)

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Capture failed'))),
          'image/jpeg',
          0.92,
        )
      })
      stopStream()
      await processImage(blob)
    } catch (err) {
      const { message } = normalizeError(err, 'CAPTURE_FAILED')
      setError(message)
      setIsCapturing(false)
      void startCamera()
    }
  }

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    stopStream()
    await processImage(file)
  }

  const overlayMessage =
    loadingTools || opencvStatus === 'loading'
      ? 'Loading scanning tools…'
      : 'Detecting edges…'

  return (
    <div className="capture-screen">
      <div className="capture-header">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            stopStream()
            onCancel()
          }}
        >
          Cancel
        </button>
        <h2>Capture document</h2>
        <div className="spacer" />
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost" onClick={() => void startCamera()}>
            Try again
          </button>
        </div>
      )}

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
          onClick={() => void captureFromCamera()}
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
        onChange={(e) => void handleFileChange(e)}
      />

      {isCapturing && (
        <div className="loading-overlay">
          <div className="spinner" />
          <p>{overlayMessage}</p>
        </div>
      )}
    </div>
  )
}
