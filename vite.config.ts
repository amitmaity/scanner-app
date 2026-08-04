import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = '/scanner-app/'
const deployUrl = 'https://amitmaity.github.io/scanner-app/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.svg',
        'robots.txt',
        'pwa-192.png',
        'pwa-512.png',
        'opencv/opencv.js',
      ],
      manifest: {
        id: deployUrl,
        name: 'Scanner App',
        short_name: 'Scanner',
        description: 'Document scanner with edge detection, enhancement, and PDF export',
        theme_color: '#1a73e8',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        scope: base,
        start_url: base,
        categories: ['productivity', 'utilities'],
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/scanner-app\/opencv\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('/opencv/opencv.js'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'opencv-cache',
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
})
