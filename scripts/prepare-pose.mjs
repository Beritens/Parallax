import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const target = new URL('../public/pose/', import.meta.url);
await mkdir(target, { recursive: true });
const models = [
  ['superpoint_1024.onnx', 'superpoint-1024.onnx', '4f88ff878e1e9b6eb54a66e5f52c205b725e67a425120931393cf5cdd3577232'],
  ['superpoint_lightglue.onnx', 'lightglue.onnx', '80ae9218c44fe702b48666834e83cdcc3fada4f1dfdad7f0600dbc22fdd2d97b'],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [name, local, digest] of models) {
  const path = new URL(local, target);
  const existing = await readFile(path).catch(() => null);
  if (existing && hash(existing) === digest) continue;
  console.log(`Downloading ${name}…`);
  const response = await fetch(`https://github.com/fabio-sim/LightGlue-ONNX/releases/download/v0.1.3/${name}`, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Model download failed: ${response.status} ${name}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (hash(bytes) !== digest) throw new Error(`Model checksum mismatch: ${name}`);
  await writeFile(path, bytes);
}
const ortDist = dirname(require.resolve('onnxruntime-web'));
for (const name of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(join(ortDist, name), new URL(name, target));
}
await copyFile(require.resolve('@techstark/opencv-js'), new URL('opencv.js', target));
await build({ entryPoints: ['src/pose/worker.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'es2022', outfile: new URL('worker.js', target).pathname, sourcemap: true });
console.log('Browser pose worker, models, and WASM ready.');
