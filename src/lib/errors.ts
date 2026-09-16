export type ScannerErrorCode =
  | 'OPENCV_LOAD_FAILED'
  | 'OPENCV_TIMEOUT'
  | 'CAMERA_DENIED'
  | 'CAMERA_NOT_FOUND'
  | 'CAMERA_IN_USE'
  | 'CAPTURE_FAILED'
  | 'CROP_FAILED'
  | 'FILTER_FAILED'
  | 'STORAGE_QUOTA'
  | 'STORAGE_UNAVAILABLE'
  | 'EXPORT_FAILED'
  | 'PERSIST_FAILED'

export const ERROR_MESSAGES: Record<ScannerErrorCode, string> = {
  OPENCV_LOAD_FAILED: 'Could not load scanning tools. Check your connection and try again.',
  OPENCV_TIMEOUT: 'Scanning tools took too long to load. Check your connection and try again.',
  CAMERA_DENIED:
    'Camera permission denied. Allow camera access in your browser settings, or upload an image instead.',
  CAMERA_NOT_FOUND: 'No camera found. Connect a camera or upload an image instead.',
  CAMERA_IN_USE: 'Camera is in use by another app. Close it and try again, or upload an image.',
  CAPTURE_FAILED: 'Could not capture the image. Try again or upload a file instead.',
  CROP_FAILED: 'Failed to crop image. Try adjusting corners.',
  FILTER_FAILED: 'Failed to apply enhancement. Try a different filter.',
  STORAGE_QUOTA: 'Device storage is full. Delete old scans and try again.',
  STORAGE_UNAVAILABLE: 'Could not access saved scans. Check browser storage permissions and try again.',
  EXPORT_FAILED: 'Export failed. Please try again.',
  PERSIST_FAILED: 'Could not save your changes. Please try again.',
}

export interface AppError {
  message: string
  retry?: () => void
  critical?: boolean
  /** Identifies the subsystem that raised the error, so a recovery in that
   * subsystem can clear its own toast without dismissing unrelated errors. */
  source?: 'opencv'
}

export class ScannerError extends Error {
  readonly code: ScannerErrorCode

  constructor(code: ScannerErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? ERROR_MESSAGES[code], options)
    this.name = 'ScannerError'
    this.code = code
  }
}

export function isQuotaExceeded(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; code?: number; message?: string; cause?: unknown; inner?: unknown }
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true
  if (e.code === 22 || e.code === 1014) return true
  if (typeof e.message === 'string' && /quota/i.test(e.message)) return true
  if (e.cause) return isQuotaExceeded(e.cause)
  if (e.inner) return isQuotaExceeded(e.inner)
  return false
}

const CAMERA_DENIED_NAMES = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])
const CAMERA_NOT_FOUND_NAMES = new Set([
  'NotFoundError',
  'DevicesNotFoundError',
  'OverconstrainedError',
  'ConstraintNotSatisfiedError',
])
const CAMERA_IN_USE_NAMES = new Set(['NotReadableError', 'TrackStartError'])

export function cameraErrorFromUnknown(err: unknown): ScannerError {
  const name = err instanceof Error ? err.name : ''
  if (CAMERA_DENIED_NAMES.has(name)) {
    return new ScannerError('CAMERA_DENIED', ERROR_MESSAGES.CAMERA_DENIED, { cause: err })
  }
  if (CAMERA_NOT_FOUND_NAMES.has(name)) {
    return new ScannerError('CAMERA_NOT_FOUND', ERROR_MESSAGES.CAMERA_NOT_FOUND, { cause: err })
  }
  if (CAMERA_IN_USE_NAMES.has(name) || name === 'AbortError') {
    return new ScannerError('CAMERA_IN_USE', ERROR_MESSAGES.CAMERA_IN_USE, { cause: err })
  }
  return new ScannerError('CAPTURE_FAILED', ERROR_MESSAGES.CAPTURE_FAILED, { cause: err })
}

export function normalizeError(
  err: unknown,
  fallbackCode: ScannerErrorCode = 'PERSIST_FAILED',
): { code: ScannerErrorCode; message: string } {
  if (err instanceof ScannerError) {
    return { code: err.code, message: err.message }
  }
  if (isQuotaExceeded(err)) {
    return { code: 'STORAGE_QUOTA', message: ERROR_MESSAGES.STORAGE_QUOTA }
  }
  const raw = err instanceof Error ? err.message : ''
  if (/opencv/i.test(raw) || /not loaded yet/i.test(raw)) {
    return { code: 'OPENCV_LOAD_FAILED', message: ERROR_MESSAGES.OPENCV_LOAD_FAILED }
  }
  return {
    code: fallbackCode,
    message: ERROR_MESSAGES[fallbackCode],
  }
}

export function persistFailureError(err: unknown, retry: () => void): AppError {
  const { code, message } = normalizeError(err, 'PERSIST_FAILED')
  return {
    message,
    retry: code === 'STORAGE_QUOTA' ? undefined : retry,
    critical: code === 'STORAGE_QUOTA' || code === 'STORAGE_UNAVAILABLE',
  }
}
