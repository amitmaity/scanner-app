import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'
import { useScannerStore } from './state/store'

function Root() {
  const [offlineReady, setOfflineReady] = useState(false)
  const setError = useScannerStore((s) => s.setError)

  useEffect(() => {
    registerSW({
      immediate: true,
      onOfflineReady() {
        setOfflineReady(true)
      },
      onRegisterError() {
        setError({
          message: 'Could not enable offline mode. The app still works while you are online.',
        })
      },
    })
  }, [setError])

  return (
    <ErrorBoundary>
      <App offlineReady={offlineReady} />
    </ErrorBoundary>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
