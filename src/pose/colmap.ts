import type { Reconstruction, CameraPose } from './types';
import { parseReconstruction } from './validation';

export type ColmapRequest = { version: 1; subjectId: string; horizontalFov: number;
  images: { id: string; name: string; width: number; height: number }[] };
export function parseColmapRequest(value: unknown): ColmapRequest {
  const r = value as ColmapRequest;
  if (!r || r.version !== 1 || typeof r.subjectId !== 'string' || !r.subjectId || !Number.isFinite(r.horizontalFov) || r.horizontalFov < 20 || r.horizontalFov > 120 || !Array.isArray(r.images) || r.images.length < 2 ||
    r.images.some(i => !i || typeof i.id !== 'string' || !i.id || !/^reference-\d+\.png$/.test(i.name) || !Number.isSafeInteger(i.width) || i.width <= 0 || !Number.isSafeInteger(i.height) || i.height <= 0) ||
    new Set(r.images.map(i => i.id)).size !== r.images.length || new Set(r.images.map(i => i.name)).size !== r.images.length) throw new Error('Invalid COLMAP request.');
  return r;
}
const rows = (text: string) => text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).map(l => l.trim().split(/\s+/));

/** COLMAP Hamilton quaternions and right/down/forward axes match our world-to-camera convention. */
export function convertColmap(request: ColmapRequest, camerasText: string, imagesText: string, pointsText: string): Reconstruction {
  const calibration = new Map(rows(camerasText).map(row => {
    const [id, model, w, h, ...params] = row;
    if (model !== 'PINHOLE' && model !== 'SIMPLE_PINHOLE') throw new Error(`Unsupported COLMAP camera model ${model}; run the supplied PINHOLE workflow.`);
    const values = params.map(Number);
    const [fx, fy, cx, cy] = model === 'SIMPLE_PINHOLE' ? [values[0], values[0], values[1], values[2]] : values;
    return [id, { width: Number(w), height: Number(h), fx, fy, cx, cy }];
  }));
  const points = new Map(rows(pointsText).map(r => [r[0], r.slice(1, 4).map(Number)]));
  const cameras: Record<string, CameraPose> = {};
  // Keep empty observation lines: images.txt has exactly two lines per registered image.
  const lines = imagesText.split(/\r?\n/).filter(l => !l.trim().startsWith('#'));
  for (let i = 0; i < lines.length; i += 2) {
    if (!lines[i].trim()) continue;
    const row = lines[i].trim().split(/\s+/);
    const entry = request.images.find(image => image.name === row.slice(9).join(' '));
    if (!entry) throw new Error('COLMAP model contains an unknown image.');
    const k = calibration.get(row[8]);
    if (!k || k.width !== entry.width || k.height !== entry.height) throw new Error('COLMAP image dimensions do not match the request.');
    const q = row.slice(1, 5).map(Number), norm = Math.hypot(...q);
    const [w, x, y, z] = q.map(v => v / norm);
    const R = [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)];
    const t = row.slice(5, 8).map(Number);
    const center = [0,1,2].map(j => -(R[j]*t[0]+R[3+j]*t[1]+R[6+j]*t[2]));
    const obs = (lines[i+1] ?? '').trim().split(/\s+/), errors: number[] = [];
    for (let n = 0; n+2 < obs.length; n += 3) {
      if (obs[n+2] === '-1') continue;
      const p = points.get(obs[n+2]);
      if (!p) throw new Error('COLMAP observation refers to a missing point.');
      const c = [0,1,2].map(j => R[3*j]*p[0]+R[3*j+1]*p[1]+R[3*j+2]*p[2]+t[j]);
      errors.push(Math.hypot(k.fx*c[0]/c[2]+k.cx-Number(obs[n]), k.fy*c[1]/c[2]+k.cy-Number(obs[n+1])));
    }
    errors.sort((a,b) => a-b);
    cameras[entry.id] = { rotation: R, translation: t, center,
      intrinsics: { fx:k.fx, fy:k.fy, cx:k.cx, cy:k.cy, source:'colmap', horizontalFov:2*Math.atan(k.width/(2*k.fx))*180/Math.PI },
      inliers: errors.length, reprojectionError: errors.length ? (errors[Math.floor((errors.length-1)/2)]+errors[Math.floor(errors.length/2)])/2 : 0 };
  }
  const ids = request.images.map(i => i.id), registered = ids.filter(id => cameras[id]);
  if (registered.length < 2) throw new Error('COLMAP did not register at least two cameras. Try more overlapping photos with scene depth.');
  // Rebase to the first camera and a unit baseline, without mixing disconnected models.
  const origin = cameras[registered[0]], base = registered.slice(1).find(id => Math.hypot(...cameras[id].center.map((v,j) => v-origin.center[j])) > 1e-8);
  if (!base) throw new Error('COLMAP cameras have no usable baseline.');
  const scale = Math.hypot(...cameras[base].center.map((v,j) => v-origin.center[j]));
  const O = [...origin.rotation], C = [...origin.center];
  for (const camera of Object.values(cameras)) {
    const R = camera.rotation;
    camera.rotation = Array.from({length:9}, (_,n) => { const i=Math.floor(n/3),j=n%3; return R[3*i]*O[3*j]+R[3*i+1]*O[3*j+1]+R[3*i+2]*O[3*j+2]; });
    camera.center = [0,1,2].map(i => (O[3*i]*(camera.center[0]-C[0])+O[3*i+1]*(camera.center[1]-C[1])+O[3*i+2]*(camera.center[2]-C[2]))/scale);
    camera.translation = [0,1,2].map(i => -camera.rotation.slice(3*i,3*i+3).reduce((s,v,j) => s+v*camera.center[j],0));
  }
  return parseReconstruction({version:1, method:'colmap', estimatedAt:new Date().toISOString(), entryIds:ids,
    originEntryId:registered[0], baselineEntryId:base, scale:'arbitrary', horizontalFov:request.horizontalFov,
    cameras, unresolved:Object.fromEntries(ids.filter(id => !cameras[id]).map(id => [id,'Not registered in the largest COLMAP reconstruction.'])), pointCount:points.size});
}

export function readLocalPoseResult(value: unknown, subjectId: string, entryIds: string[], method: 'colmap' | 'vggt') {
  const result = value as {version: number; subjectId: string; reconstruction: unknown};
  if (!result || result.version !== 1 || result.subjectId !== subjectId) throw new Error('This local pose result belongs to another subject.');
  const reconstruction = parseReconstruction(result.reconstruction);
  if (reconstruction.method !== method || reconstruction.entryIds.length !== entryIds.length || entryIds.some(id => !reconstruction.entryIds.includes(id))) throw new Error('The reference photos have changed. Export and run the local estimator again.');
  return reconstruction;
}

export const readColmapResult = (value: unknown, subjectId: string, entryIds: string[]) => readLocalPoseResult(value, subjectId, entryIds, 'colmap');
