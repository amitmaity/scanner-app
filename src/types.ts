export interface Point {
  x: number
  y: number
}

export type FilterMode = 'auto' | 'color' | 'grayscale' | 'blackwhite'

export interface FilterSettings {
  mode: FilterMode
  brightness: number
  contrast: number
  rotation: number
}

export interface Page {
  id: string
  originalBlob: Blob
  corners: Point[]
  filter: FilterSettings
  processedBlob: Blob | null
  thumbnailUrl: string | null
  createdAt: number
}

export interface ScanDocument {
  id: string
  name: string
  pages: Page[]
  createdAt: number
  updatedAt: number
}

export type AppStep = 'home' | 'capture' | 'crop' | 'enhance' | 'pages'

export interface PendingCapture {
  blob: Blob
  imageUrl: string
  width: number
  height: number
  corners: Point[]
}

export const DEFAULT_FILTER: FilterSettings = {
  mode: 'auto',
  brightness: 0,
  contrast: 0,
  rotation: 0,
}

export function createId(): string {
  return crypto.randomUUID()
}

export function defaultCorners(width: number, height: number): Point[] {
  const margin = Math.min(width, height) * 0.05
  return [
    { x: margin, y: margin },
    { x: width - margin, y: margin },
    { x: width - margin, y: height - margin },
    { x: margin, y: height - margin },
  ]
}
