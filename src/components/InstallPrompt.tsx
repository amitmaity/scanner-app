import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isInStandaloneMode(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
  )
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [showIosHint, setShowIosHint] = useState(false)

  useEffect(() => {
    if (isInStandaloneMode()) return

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    if (!isInStandaloneMode() && isIos()) {
      setShowIosHint(true)
    }
  }, [])

  if (dismissed || isInStandaloneMode()) return null

  const handleInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setDeferredPrompt(null)
    }
    setDismissed(true)
  }

  if (deferredPrompt) {
    return (
      <div className="install-banner">
        <div className="install-banner-text">
          <strong>Install Scanner</strong>
          <span>Add to your home screen for quick access and offline use.</span>
        </div>
        <div className="install-banner-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setDismissed(true)}>
            Not now
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleInstall()}>
            Install
          </button>
        </div>
      </div>
    )
  }

  if (showIosHint) {
    return (
      <div className="install-banner install-banner-ios">
        <div className="install-banner-text">
          <strong>Install on iPhone/iPad</strong>
          <span>Tap Share, then &ldquo;Add to Home Screen&rdquo; to install and use offline.</span>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    )
  }

  return null
}
