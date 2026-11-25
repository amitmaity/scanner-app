/**
 * Runs OpenCV off the main thread: parsing the ~10 MB script, edge detection,
 * perspective warps and filters all happen here, so the UI stays responsive.
 */
import type { CvMessage } from './protocol'
import { createMessageHandler, createOpenCvLoader, type WorkerScope } from './worker-runtime'

// The app's tsconfig uses the DOM lib, where `self` is a Window.
const scope = self as unknown as WorkerScope & {
  onmessage: ((event: MessageEvent<CvMessage>) => void) | null
}

const handle = createMessageHandler(scope, createOpenCvLoader(scope))

scope.onmessage = (event) => {
  void handle(event.data)
}
