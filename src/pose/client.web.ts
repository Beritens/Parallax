import appConfig from '../../app.json';
import { PoseEvent, PoseRequest, Reconstruction } from './types';

export function poseWorkerCandidates(locationHref: string) {
  const location = new URL(locationHref);
  const currentDirectory = new URL('.', location);
  const configuredBase = appConfig.expo.experiments.baseUrl.replace(/^\/+|\/+$/g, '');
  return [...new Set([
    new URL('pose/worker.js', currentDirectory).href,
    new URL(`${configuredBase}/pose/worker.js`, location.origin + '/').href,
    new URL('pose/worker.js', location.origin + '/').href,
  ])];
}

async function findPoseWorker(signal: AbortSignal) {
  const failures: string[] = [];
  for (const url of poseWorkerCandidates(window.location.href)) {
    try {
      const response = await fetch(url, { cache: 'no-cache', signal });
      const type = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!response.ok) { failures.push(`${new URL(url).pathname}: HTTP ${response.status}`); continue; }
      if (type.includes('text/html')) { failures.push(`${new URL(url).pathname}: returned HTML`); continue; }
      // Read it now so network failures are reported before Worker obscures them.
      await response.arrayBuffer();
      return url;
    } catch (error) {
      if (signal.aborted) throw new Error('Camera estimation cancelled.');
      failures.push(`${new URL(url).pathname}: ${error instanceof Error ? error.message : 'request failed'}`);
    }
  }
  throw new Error(`The pose worker is missing (${failures.join('; ')}). Run pnpm prepare:pose, then restart the web server.`);
}

export async function estimatePoses(request: PoseRequest, progress: (message: string) => void, signal: AbortSignal): Promise<Reconstruction> {
  if (signal.aborted) throw new Error('Camera estimation cancelled.');
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('Camera estimation needs a browser with Web Workers and OffscreenCanvas.');
  }
  const workerUrl = await findPoseWorker(signal);
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Camera estimation cancelled.')); return; }
    const worker = new Worker(workerUrl);
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, result?: Reconstruction) => {
      clearTimeout(timeout); signal.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new Error('Camera estimation cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    // Reset on progress; a hung WASM call still has a bounded lifetime.
    const watchdog = () => { clearTimeout(timeout); timeout = setTimeout(() => finish(new Error('Estimation timed out. Try fewer or smaller reference photos.')), 180_000); };
    watchdog();
    worker.onmessage = (event: MessageEvent<PoseEvent>) => {
      watchdog();
      if (event.data.type === 'progress') progress(event.data.message);
      else if (event.data.type === 'error') finish(new Error(event.data.message));
      else finish(undefined, event.data.result);
    };
    worker.onerror = event => {
      const detail = event.message && event.message !== 'Script error.' ? ` ${event.message}` : '';
      finish(new Error(`The pose worker loaded but could not start.${detail} Reload and retry.`));
    };
    worker.onmessageerror = () => finish(new Error('Could not read the camera estimation result.'));
    worker.postMessage(request);
  });
}
