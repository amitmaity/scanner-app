import { describe, expect, it } from 'vitest'
import {
  cameraErrorFromUnknown,
  ERROR_MESSAGES,
  isQuotaExceeded,
  normalizeError,
  persistFailureError,
  ScannerError,
} from './errors'

describe('isQuotaExceeded', () => {
  it('detects QuotaExceededError by name', () => {
    const err = Object.assign(new Error('storage full'), { name: 'QuotaExceededError' })
    expect(isQuotaExceeded(err)).toBe(true)
  })

  it('detects quota from nested cause', () => {
    const inner = Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    expect(isQuotaExceeded({ cause: inner })).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isQuotaExceeded(new Error('nope'))).toBe(false)
    expect(isQuotaExceeded(null)).toBe(false)
  })
})

describe('normalizeError', () => {
  it('preserves ScannerError code and message', () => {
    const err = new ScannerError('CROP_FAILED', 'custom crop')
    expect(normalizeError(err)).toEqual({ code: 'CROP_FAILED', message: 'custom crop' })
  })

  it('maps quota errors', () => {
    const err = Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' })
    expect(normalizeError(err)).toEqual({
      code: 'STORAGE_QUOTA',
      message: ERROR_MESSAGES.STORAGE_QUOTA,
    })
  })

  it('maps OpenCV load messages', () => {
    expect(normalizeError(new Error('OpenCV.js is not loaded yet'))).toEqual({
      code: 'OPENCV_LOAD_FAILED',
      message: ERROR_MESSAGES.OPENCV_LOAD_FAILED,
    })
  })

  it('uses the fallback code for generic errors', () => {
    expect(normalizeError(new Error('boom'), 'EXPORT_FAILED')).toEqual({
      code: 'EXPORT_FAILED',
      message: ERROR_MESSAGES.EXPORT_FAILED,
    })
  })
})

describe('cameraErrorFromUnknown', () => {
  it('maps permission denial', () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    const result = cameraErrorFromUnknown(err)
    expect(result.code).toBe('CAMERA_DENIED')
    expect(result.message).toBe(ERROR_MESSAGES.CAMERA_DENIED)
  })

  it('maps missing camera', () => {
    const err = Object.assign(new Error('missing'), { name: 'NotFoundError' })
    expect(cameraErrorFromUnknown(err).code).toBe('CAMERA_NOT_FOUND')
  })

  it('maps camera in use', () => {
    const err = Object.assign(new Error('busy'), { name: 'NotReadableError' })
    expect(cameraErrorFromUnknown(err).code).toBe('CAMERA_IN_USE')
  })
})

describe('persistFailureError', () => {
  it('omits retry and marks quota errors critical', () => {
    const err = new ScannerError('STORAGE_QUOTA')
    const result = persistFailureError(err, () => undefined)
    expect(result.retry).toBeUndefined()
    expect(result.critical).toBe(true)
    expect(result.message).toBe(ERROR_MESSAGES.STORAGE_QUOTA)
  })

  it('keeps retry for generic persist failures', () => {
    const retry = () => undefined
    const result = persistFailureError(new Error('fail'), retry)
    expect(result.retry).toBe(retry)
    expect(result.critical).toBe(false)
    expect(result.message).toBe(ERROR_MESSAGES.PERSIST_FAILED)
  })
})
