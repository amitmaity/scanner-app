import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { get } from 'node:https'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const targetDir = join(__dirname, '..', 'public', 'opencv')
const targetFile = join(targetDir, 'opencv.js')
const tempFile = `${targetFile}.download`

const OPENCV_URL = 'https://docs.opencv.org/4.9.0/opencv.js'
// This file is served to every user and precached by the service worker, so
// pin its contents. Update this hash together with OPENCV_URL.
const OPENCV_SHA256 = '4d7b85e2e12ea0bd088f491c311d620a45b53d1489b7f065b4492a230bda243a'
const MAX_REDIRECTS = 5
const SOCKET_TIMEOUT_MS = 60_000

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

function download(url, dest, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      const { statusCode = 0, headers } = response

      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume()
        if (redirectsLeft === 0) {
          reject(new Error('Too many redirects'))
          return
        }
        const next = new URL(headers.location, url).toString()
        download(next, dest, redirectsLeft - 1).then(resolve, reject)
        return
      }

      if (statusCode !== 200) {
        response.resume()
        reject(new Error(`HTTP ${statusCode} from ${url}`))
        return
      }

      // pipeline rejects if the connection drops mid-download.
      pipeline(response, createWriteStream(dest)).then(resolve, reject)
    })
    request.on('error', reject)
    request.setTimeout(SOCKET_TIMEOUT_MS, () => {
      request.destroy(new Error('Download stalled'))
    })
  })
}

async function main() {
  if (existsSync(targetFile)) {
    if ((await sha256(targetFile)) === OPENCV_SHA256) {
      console.log('OpenCV.js already present, skipping download.')
      return
    }
    console.warn('Existing OpenCV.js is incomplete or out of date; downloading again.')
    rmSync(targetFile)
  }

  mkdirSync(targetDir, { recursive: true })
  console.log('Downloading OpenCV.js (~10MB)...')

  try {
    await download(OPENCV_URL, tempFile)
    const actual = await sha256(tempFile)
    if (actual !== OPENCV_SHA256) {
      throw new Error(`Checksum mismatch: expected ${OPENCV_SHA256}, got ${actual}`)
    }
    // Only a complete, verified file ever lands at the final path.
    renameSync(tempFile, targetFile)
  } finally {
    rmSync(tempFile, { force: true })
  }

  console.log('OpenCV.js downloaded successfully.')
}

main().catch((err) => {
  console.error('Failed to download OpenCV.js:', err instanceof Error ? err.message : err)
  process.exit(1)
})
