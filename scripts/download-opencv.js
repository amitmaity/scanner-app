import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { get } from 'node:https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const targetDir = join(__dirname, '..', 'public', 'opencv')
const targetFile = join(targetDir, 'opencv.js')
const OPENCV_URL =
  'https://docs.opencv.org/4.9.0/opencv.js'

if (existsSync(targetFile)) {
  console.log('OpenCV.js already present, skipping download.')
  process.exit(0)
}

mkdirSync(targetDir, { recursive: true })

console.log('Downloading OpenCV.js (~8MB)...')

const file = createWriteStream(targetFile)

get(OPENCV_URL, (response) => {
  if (response.statusCode === 302 || response.statusCode === 301) {
    const redirect = response.headers.location
    if (!redirect) {
      console.error('Redirect without location header')
      process.exit(1)
    }
    get(redirect, (res) => res.pipe(file))
    return
  }
  if (response.statusCode !== 200) {
    console.error(`Failed to download OpenCV.js: HTTP ${response.statusCode}`)
    process.exit(1)
  }
  response.pipe(file)
}).on('error', (err) => {
  console.error('Failed to download OpenCV.js:', err.message)
  process.exit(1)
})

file.on('finish', () => {
  file.close()
  console.log('OpenCV.js downloaded successfully.')
})
