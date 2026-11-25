# Scanner App

A client-side document scanner PWA inspired by Microsoft Lens. Capture documents with your camera, auto-detect edges, adjust borders, enhance images, and export as images or PDF.

## Features

- Camera capture (rear camera, full sensor resolution where the browser supports it) and image upload
- Auto edge detection with OpenCV.js
- Manual corner adjustment for crop and straighten (drag, or arrow keys)
- Enhancement filters: Auto, Color, Grayscale, Black & White
- Brightness and contrast controls with a live preview
- Rotate 90°
- Multi-page documents: reorder, rename, re-edit a page's crop and filter, undo a delete
- Export as PDF or individual PNG/JPEG images, by download or the system share sheet
- Offline-capable PWA; asks the browser to keep saved scans from being evicted
- Deployed to GitHub Pages

## Development

```bash
npm install   # downloads OpenCV.js automatically and verifies its checksum
npm run dev
```

To move to another OpenCV.js release, update `OPENCV_URL` and `OPENCV_SHA256` together in `scripts/download-opencv.js`.

```bash
npm test      # unit and component tests
npm run lint
```

Open http://localhost:5173/scanner-app/ (camera requires HTTPS or localhost).

## Build

```bash
npm run build
npm run preview
```

## Deploy

Push to `main` branch. GitHub Actions builds and deploys to GitHub Pages. Pull requests run lint, tests and the build without deploying.

Ensure repository Settings → Pages → Source is set to **GitHub Actions**.

The app will be available at [https://amitmaity.github.io/scanner-app/](https://amitmaity.github.io/scanner-app/).

## Install & offline use

1. Open the app in Chrome, Edge, or Safari at the URL above.
2. **Android/Desktop:** tap **Install** when prompted, or use the browser menu → *Install app*.
3. **iPhone/iPad:** tap Share → *Add to Home Screen*.
4. Visit once while online so the service worker can cache the app and OpenCV (~10 MB).
5. After that, the app works offline for viewing saved scans, uploading images, cropping, enhancing, and exporting.

## Tech Stack

- React + Vite + TypeScript
- vite-plugin-pwa
- OpenCV.js (self-hosted), run in a Web Worker so image processing never blocks the UI
- jsPDF
- Zustand + IndexedDB
