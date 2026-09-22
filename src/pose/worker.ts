import type * as ORT from 'onnxruntime-web';
import type * as CV from '@techstark/opencv-js';
import { intrinsics, Point2 } from './geometry';
import { decodeMatches } from './matches';
import { Features, Pair, reconstruct } from './reconstruct';
import { PoseEvent, PoseRequest } from './types';

// Classic worker: runtime scripts and WASM are served from the same deployment directory.
declare const self: { importScripts: (...urls: string[]) => void; ort: typeof ORT; cv: typeof CV & { then: (ready: () => void) => void };
  location: Location; onmessage: ((event: MessageEvent<PoseRequest>) => void) | null; postMessage: (event: PoseEvent) => void };
const progress = (message: string) => self.postMessage({ type: 'progress', message });
type Extracted = Features & { normalized: Float32Array; descriptors: Float32Array };

async function run(request: PoseRequest) {
  if (request.images.length < 2) throw new Error('Add at least two reference photos of the same scene.');
  progress('Loading camera estimation tools…');
  self.importScripts('ort.wasm.min.js', 'opencv.js');
  const { ort, cv } = self;
  // Emscripten's Module is a self-resolving thenable; do not `await cv`.
  await new Promise<void>(resolve => cv.then(() => resolve()));
  ort.env.wasm.numThreads = 1; // Works on static hosting without cross-origin isolation headers.
  ort.env.wasm.wasmPaths = new URL('./', self.location.href).href;
  let extractor: ORT.InferenceSession | undefined, matcher: ORT.InferenceSession | undefined;
  const features: Extracted[] = [];
  const originalIntrinsics = new Map<string, { k: ReturnType<typeof intrinsics>; scale: number }>();
  try {
    progress('Loading SuperPoint and LightGlue models (about 52 MB on first use)…');
    extractor = await ort.InferenceSession.create(new URL('superpoint-1024.onnx', self.location.href).href, { executionProviders: ['wasm'] });
    matcher = await ort.InferenceSession.create(new URL('lightglue.onnx', self.location.href).href, { executionProviders: ['wasm'] });
    for (const [index, image] of request.images.entries()) {
      progress(`Finding features in reference ${index + 1} of ${request.images.length}…`);
      const response = await fetch(image.uri);
      if (!response.ok) throw new Error(`Could not read reference ${index + 1}.`);
      const bitmap = await createImageBitmap(await response.blob());
      const factor = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(32, Math.round(bitmap.width * factor / 8) * 8), h = Math.max(32, Math.round(bitmap.height * factor / 8) * 8);
      const sx = w / bitmap.width, sy = h / bitmap.height;
      const canvas = new OffscreenCanvas(w, h), context = canvas.getContext('2d');
      if (!context) { bitmap.close(); throw new Error('This browser cannot prepare photos in a worker.'); }
      context.drawImage(bitmap, 0, 0, w, h); bitmap.close();
      const rgba = context.getImageData(0, 0, w, h).data, gray = new Float32Array(w*h);
      for (let i = 0; i < gray.length; i++) gray[i] = (0.299*rgba[4*i] + 0.587*rgba[4*i+1] + 0.114*rgba[4*i+2]) / 255;
      const tensor = new ort.Tensor('float32', gray, [1, 1, h, w]);
      const output = await extractor.run({ image: tensor });
      try {
        const keypoints = output.keypoints;
        if (!keypoints || !output.descriptors || keypoints.dims.length !== 3 || keypoints.dims[2] !== 2) throw new Error('Unexpected SuperPoint model outputs.');
        const points: Point2[] = [], normalized = new Float32Array(keypoints.data.length);
        for (let i = 0; i < keypoints.data.length; i += 2) {
          const x = Number(keypoints.data[i]), y = Number(keypoints.data[i+1]);
          points.push([x, y]);
          normalized[i] = (x-w/2)/(Math.max(w,h)/2); normalized[i+1] = (y-h/2)/(Math.max(w,h)/2);
        }
        const k = intrinsics(image.width, image.height, request.horizontalFov);
        originalIntrinsics.set(image.id, { k, scale: (sx+sy)/2 });
        features.push({ id: image.id, points, normalized, descriptors: Float32Array.from(output.descriptors.data as Float32Array),
          k: { ...k, fx: k.fx*sx, fy: k.fy*sy, cx: (k.cx+0.5)*sx-0.5, cy: (k.cy+0.5)*sy-0.5 } });
      } finally { tensor.dispose(); Object.values(output).forEach(t => t.dispose()); }
    }
    const pairs: Pair[] = [];
    const total = features.length * (features.length - 1) / 2;
    for (let a = 0; a < features.length; a++) for (let b = a+1; b < features.length; b++) {
      progress(`Matching reference pair ${pairs.length + 1} of ${total}…`);
      const f0 = features[a], f1 = features[b];
      if (f0.points.length < 24 || f1.points.length < 24) { pairs.push({ a, b, matches: [] }); continue; }
      const feeds = { kpts0: new ort.Tensor('float32', f0.normalized, [1,f0.points.length,2]), kpts1: new ort.Tensor('float32', f1.normalized, [1,f1.points.length,2]),
        desc0: new ort.Tensor('float32', f0.descriptors, [1,f0.points.length,256]), desc1: new ort.Tensor('float32', f1.descriptors, [1,f1.points.length,256]) };
      const output = await matcher.run(feeds);
      try {
        const indices = output.matches0, scores = output.mscores0;
        if (!indices || !scores) throw new Error('Unexpected LightGlue model outputs.');
        const matches = decodeMatches(f0.points, f1.points, indices.data as BigInt64Array, scores.data as Float32Array, indices.dims);
        pairs.push({ a, b, matches });
      } finally { Object.values(feeds).forEach(t => t.dispose()); Object.values(output).forEach(t => t.dispose()); }
    }
    const result = reconstruct(cv, features, pairs, request.horizontalFov, progress);
    for (const [id, pose] of Object.entries(result.cameras)) {
      const original = originalIntrinsics.get(id)!;
      pose.intrinsics = original.k; if (pose.reprojectionError !== null) pose.reprojectionError /= original.scale;
    }
    return result;
  } finally { await extractor?.release(); await matcher?.release(); }
}
self.onmessage = event => {
  void run(event.data).then(result => self.postMessage({ type: 'result', result })).catch(error => {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : `Camera estimation failed (${String(error)}).` });
  });
};
