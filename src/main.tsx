import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

function Root() {
  const [offlineReady, setOfflineReady] = useState(false)

  useEffect(() => {
    registerSW({
      immediate: true,
      onOfflineReady() {
        setOfflineReady(true)
      },
    })
  }, [])

  return <App offlineReady={offlineReady} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
