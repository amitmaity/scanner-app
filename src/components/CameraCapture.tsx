import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { detectDocumentEdges } from '../lib/detectEdges'
import {
  cameraErrorFromUnknown,
  ERROR_MESSAGES,
  normalizeError,
} from '../lib/errors'
import {
  CAPTURE_JPEG_QUALITY,
  canvasToBlob,
  createCanvas,
  get2d,
  loadOpenCV,
  normalizeImageOrientation,
  type NormalizedImage,
} from '../lib/opencv'
import type { PendingCapture } from '../types'

interface CameraCaptureProps {
  onCapture: (capture: PendingCapture) => void
  onCancel: () => void
}

/** Up to 4K: the browser picks the closest size the camera supports. */
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 3840 },
  height: { ideal: 2160 },
}
/** Some devices never resolve takePhoto(); fall back to the video frame. */
const PHOTO_TIMEOUT_MS = 4000

type Stage = 'preparing' | 'loading-tools' | 'detecting'

const STAGE_MESSAGES: Record<Stage, string> = {
  preparing: 'Processing photo…',
  'loading-tools': 'Loading scanning tools…',
  detecting: 'Detecting edges…',
}

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>
}
type ImageCaptureConstructor = new (track: MediaStreamTrack) => ImageCaptureLike

/**
 * A still at the sensor's full resolution, which is usually well above the
 * video stream's. Only Chromium implements ImageCapture; returns null where
 * it's missing, fails or stalls.
 */
async function takeFullResolutionPhoto(stream: MediaStream): Promise<Blob | null> {
  const ImageCaptureImpl = (window as Window & { ImageCapture?: ImageCaptureConstructor })
    .ImageCapture
  const [track] = stream.getVideoTracks()
  if (!ImageCaptureImpl || !track) return null

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new ImageCaptureImpl(track).takePhoto(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), PHOTO_TIMEOUT_MS)
      }),
    ])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function grabVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = createCanvas(video.videoWidth, video.videoHeight)
  get2d(canvas).drawImage(video, 0, 0)
  return canvas
}

export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  /** Bumped whenever the camera is stopped or restarted, so a getUserMedia call
   * that resolves late (e.g. "Try again" tapped twice) stops its own stream
   * instead of orphaning whichever one was assigned first. */
  const requestIdRef = useRef(0)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage | null>(null)
  const isCapturing = stage !== null

  const stopStream = useCallback(() => {
    requestIdRef.current += 1
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const startCamera = useCallback(async () => {
    stopStream()
    const requestId = requestIdRef.current
    setError(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(ERROR_MESSAGES.CAMERA_NOT_FOUND)
      return
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: VIDEO_CONSTRAINTS,
        audio: false,
      })
      if (requestId !== requestIdRef.current) {
        media.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = media
      setStream(media)
      if (videoRef.current) {
        videoRef.current.srcObject = media
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      setError(cameraErrorFromUnknown(err).message)
    }
  }, [stopStream])

  useEffect(() => {
    void startCamera()
    const requestIds = requestIdRef
    return () => {
      requestIds.current += 1
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [startCamera])

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const processImage = async (prepare: () => Promise<NormalizedImage>) => {
    setStage('preparing')
    setError(null)
    try {
      const image = await prepare()

      setStage('loading-tools')
      await loadOpenCV()
      setStage('detecting')
      // Reuse the decoded pixels rather than decoding the JPEG again.
      const corners = await detectDocumentEdges(image.canvas, image.width, image.height)

      // Created last so a failed load or detection doesn't leak the URL.
      onCapture({
        blob: image.blob,
        imageUrl: URL.createObjectURL(image.blob),
        width: image.width,
        height: image.height,
        corners,
      })
    } catch (err) {
      const { code, message } = normalizeError(err, 'CAPTURE_FAILED')
      if (code === 'OPENCV_LOAD_FAILED' || code === 'OPENCV_TIMEOUT') {
        setError(message)
      } else {
        setError('Could not process this image. Try another file or retake the photo.')
      }
      setStage(null)
      void startCamera()
    }
  }

  const captureFromCamera = async () => {
    const video = videoRef.current
    const media = streamRef.current
    if (!video || !video.videoWidth || !media) {
      setError(ERROR_MESSAGES.CAPTURE_FAILED)
      return
    }

    let frame: HTMLCanvasElement
    try {
      // Grab the frame first so there's always something to fall back on.
      frame = grabVideoFrame(video)
    } catch {
      setError(ERROR_MESSAGES.CAPTURE_FAILED)
      return
    }

    await processImage(async () => {
      const photo = await takeFullResolutionPhoto(media)
      stopStream()
      if (photo) {
        try {
          const still = await normalizeImageOrientation(photo)
          if (still.width * still.height >= frame.width * frame.height) return still
        } catch {
          // Fall through to the video frame.
        }
      }
      // A video frame is already upright, so it's encoded once with no
      // orientation pass.
      const blob = await canvasToBlob(frame, 'image/jpeg', CAPTURE_JPEG_QUALITY)
      return { blob, canvas: frame, width: frame.width, height: frame.height }
    })
  }

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    stopStream()
    await processImage(() => normalizeImageOrientation(file))
  }

  const overlayMessage = stage ? STAGE_MESSAGES[stage] : ''

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
