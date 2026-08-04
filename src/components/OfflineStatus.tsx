import { useEffect, useState } from 'react'

async function isAssetCached(url: string): Promise<boolean> {
  if (!('caches' in window)) return false
  const keys = await caches.keys()
  for (const key of keys) {
    const cache = await caches.open(key)
    const match = await cache.match(url)
    if (match) return true
  }
  return false
}

interface OfflineStatusProps {
  offlineReady: boolean
}

export function OfflineStatus({ offlineReady }: OfflineStatusProps) {
  const [online, setOnline] = useState(navigator.onLine)
  const [opencvCached, setOpencvCached] = useState<boolean | null>(null)
  const [dismissedReady, setDismissedReady] = useState(false)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    const opencvUrl = `${import.meta.env.BASE_URL}opencv/opencv.js`
    isAssetCached(opencvUrl).then(setOpencvCached)
  }, [offlineReady])

  return (
    <>
      {!online && (
        <div className="offline-banner" role="status">
          You are offline. Saved scans and cached tools remain available.
        </div>
      )}

      {offlineReady && !dismissedReady && online && (
        <div className="offline-ready-banner" role="status">
          <span>Scanner is ready for offline use.</span>
          <button type="button" className="btn btn-ghost" onClick={() => setDismissedReady(true)}>
            Dismiss
          </button>
        </div>
      )}

      {online && opencvCached === false && !dismissedReady && (
        <div className="offline-hint-banner" role="status">
          <span>Stay online once to download scanning tools for offline use.</span>
          <button type="button" className="btn btn-ghost" onClick={() => setDismissedReady(true)}>
            Dismiss
          </button>
        </div>
      )}
    </>
  )
}
