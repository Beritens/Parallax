import type * as CV from '@techstark/opencv-js';
import { Matrix } from 'ml-matrix';
import { camera, identity, Match, median, normalize, parallax, Point2, Point3, project, recoverRelative, rotation, triangulate } from './geometry';
import { CameraPose, Intrinsics, Reconstruction } from './types';

export type Features = { id: string; points: Point2[]; k: Intrinsics };
export type Pair = { a: number; b: number; matches: Match[] };
type Landmark = { X: Point3; observations: Map<number, number> };

function planar(cv: typeof CV, matches: Match[]) {
  if (matches.length < 24) return false;
  const a = cv.matFromArray(matches.length, 1, cv.CV_32FC2, matches.flatMap(m => m.a));
  const b = cv.matFromArray(matches.length, 1, cv.CV_32FC2, matches.flatMap(m => m.b));
  const mask = new cv.Mat();
  let H: CV.Mat | undefined;
  try {
    H = cv.findHomography(a, b, cv.RANSAC, 2, mask, 2000, 0.995);
    return !H.empty() && cv.countNonZero(mask) / matches.length > 0.8;
  } finally { a.delete(); b.delete(); mask.delete(); H?.delete(); }
}

function pnp(cv: typeof CV, correspondences: { X: Point3; p: Point2 }[], k: Intrinsics): { pose?: CameraPose; tentative?: CameraPose; reason?: string } {
  if (correspondences.length < 12) return { reason: `Only ${correspondences.length} matches connect to reconstructed 3D points; at least 12 are needed.` };
  const objects = cv.matFromArray(correspondences.length, 1, cv.CV_64FC3, correspondences.flatMap(c => c.X));
  const pixels = cv.matFromArray(correspondences.length, 1, cv.CV_64FC2, correspondences.flatMap(c => c.p));
  const K = cv.matFromArray(3, 3, cv.CV_64F, [k.fx,0,k.cx,0,k.fy,k.cy,0,0,1]);
  const distortion = cv.Mat.zeros(4, 1, cv.CV_64F), r = new cv.Mat(), t = new cv.Mat(), mask = new cv.Mat(), R = new cv.Mat();
  try {
    const solved = cv.solvePnPRansac(objects, pixels, K, distortion, r, t, false, 1000, 3, 0.999, mask, cv.SOLVEPNP_EPNP);
    if (!solved || mask.rows < 6) return { reason: `${correspondences.length} 3D matches, but only ${solved ? mask.rows : 0} agree on a camera pose. Repeated features or inaccurate calibration can cause this.` };
    const inliers = Array.from(mask.data32S).map(i => correspondences[i]);
    const oi = cv.matFromArray(inliers.length, 1, cv.CV_64FC3, inliers.flatMap(c => c.X));
    const pi = cv.matFromArray(inliers.length, 1, cv.CV_64FC2, inliers.flatMap(c => c.p));
    try { cv.solvePnPRefineLM(oi, pi, K, distortion, r, t); } finally { oi.delete(); pi.delete(); }
    cv.Rodrigues(r, R);
    const rm = Matrix.from1DArray(3, 3, Array.from(R.data64F)), tv = Array.from(t.data64F);
    const errors = inliers.map(c => { const p = project(c.X, rm, tv, k); return p ? Math.hypot(p[0]-c.p[0], p[1]-c.p[1]) : Infinity; });
    const error = median(errors), good = errors.filter(e => e < 3).length;
    const consensusAccepted = inliers.length >= 12 && inliers.length >= correspondences.length * 0.4;
    const reprojectionAccepted = good >= inliers.length * 0.9 && error <= 2;
    if (consensusAccepted && reprojectionAccepted) return { pose: camera(rm, tv, k, inliers.length, error) };
    const reason = consensusAccepted
      ? `${inliers.length} inliers found, but the refined pose failed the strict reprojection/depth checks.`
      : `${correspondences.length} 3D matches, but only ${inliers.length} agree on a camera pose. This estimate is tentative.`;
    // A small but coherent consensus is still useful to inspect. Keep it out of
    // the trusted pose map so it cannot create landmarks or register more views.
    if (Number.isFinite(error) && error <= 5 && errors.filter(e => e < 5).length >= Math.max(6, inliers.length * 0.6)) {
      return { tentative: { ...camera(rm, tv, k, inliers.length, error), status: 'tentative', correspondences: correspondences.length, warning: reason }, reason };
    }
    return { reason };
  } finally { for (const mat of [objects, pixels, K, distortion, r, t, mask, R]) mat.delete(); }
}

function reconstructAttempt(cv: typeof CV, features: Features[], pairs: Pair[], horizontalFov: number, progress: (message: string) => void, seeds: Pair[]): Reconstruction {
  const result: Reconstruction = { version: 1, method: 'superpoint-lightglue-sfm', estimatedAt: new Date().toISOString(), entryIds: features.map(f => f.id),
    horizontalFov, scale: 'arbitrary', cameras: Object.create(null), unresolved: Object.create(null), pointCount: 0 };
  const poses = new Map<number, CameraPose>(), tentativePoses = new Map<number, CameraPose>(), landmarks: Landmark[] = [];
  const lookup = new Map<string, number>();
  const observe = (landmark: number, image: number, point: number) => {
    const key = `${image}:${point}`;
    if (lookup.has(key) || landmarks[landmark].observations.has(image)) return;
    landmarks[landmark].observations.set(image, point); lookup.set(key, landmark);
  };
  // Extend tracks as well as creating new points. A match with one existing observation
  // is useful evidence; skipping it can prevent subsequent cameras from reaching PnP.
  const completeTracks = () => {
    let added: boolean;
    do {
      added = false;
      for (const pair of pairs) {
        const p0 = poses.get(pair.a), p1 = poses.get(pair.b);
        if (!p0 || !p1) continue;
        const R0 = rotation(p0), R1 = rotation(p1);
        for (const m of pair.matches) {
          const known0 = lookup.get(`${pair.a}:${m.i}`), known1 = lookup.get(`${pair.b}:${m.j}`);
          if (known0 !== undefined && known1 !== undefined) continue;
          if (known0 !== undefined || known1 !== undefined) {
            const known = (known0 ?? known1)!;
            const target = known0 !== undefined ? pair.b : pair.a;
            if (landmarks[known].observations.has(target)) continue;
            const pose = known0 !== undefined ? p1 : p0;
            const pixel = known0 !== undefined ? m.b : m.a;
            const projected = project(landmarks[known].X, known0 !== undefined ? R1 : R0, pose.translation, pose.intrinsics);
            if (projected && Math.hypot(projected[0]-pixel[0], projected[1]-pixel[1]) < 2) {
              observe(known, target, known0 !== undefined ? m.j : m.i); added = true;
            }
            continue;
          }
          const X = triangulate(normalize(m.a, p0.intrinsics), normalize(m.b, p1.intrinsics), R0, p0.translation, R1, p1.translation);
          if (!X || parallax(X, p0.center, p1.center) < 1) continue;
          const a = project(X, R0, p0.translation, p0.intrinsics), b = project(X, R1, p1.translation, p1.intrinsics);
          if (!a || !b || Math.hypot(a[0]-m.a[0],a[1]-m.a[1]) > 2 || Math.hypot(b[0]-m.b[0],b[1]-m.b[1]) > 2) continue;
          const index = landmarks.length; landmarks.push({ X, observations: new Map() });
          observe(index, pair.a, m.i); observe(index, pair.b, m.j); added = true;
        }
      }
    } while (added);
  };
  for (const pair of seeds) {
    progress('Finding a starting pair with enough scene depth…');
    try {
      if (planar(cv, pair.matches)) throw new Error('Flat scene or rotation only. Include depth and move sideways.');
      const relative = recoverRelative(pair.matches, features[pair.a].k, features[pair.b].k);
      const errorFor = (side: 'a' | 'b') => median(relative.points.map(p => {
        const q = project(p.X, side === 'a' ? identity() : relative.R, side === 'a' ? [0,0,0] : relative.t, features[pair[side]].k)!;
        const observed = pair.matches[p.index][side];
        return Math.hypot(q[0]-observed[0], q[1]-observed[1]);
      }));
      poses.set(pair.a, camera(identity(), [0,0,0], features[pair.a].k, relative.points.length, errorFor('a')));
      poses.set(pair.b, camera(relative.R, relative.t, features[pair.b].k, relative.points.length, errorFor('b')));
      result.originEntryId = features[pair.a].id; result.baselineEntryId = features[pair.b].id;
      for (const p of relative.points) {
        const index = landmarks.length;
        landmarks.push({ X: p.X, observations: new Map() });
        observe(index, pair.a, pair.matches[p.index].i); observe(index, pair.b, pair.matches[p.index].j);
      }
      break;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Could not recover camera geometry.';
      result.unresolved[features[pair.a].id] = reason; result.unresolved[features[pair.b].id] = reason;
    }
  }
  completeTracks();
  // Register into the existing reconstruction, never compose unit-length pairwise translations.
  let changed = true;
  while (poses.size && changed) {
    changed = false;
    for (let target = 0; target < features.length; target++) {
      if (poses.has(target)) continue;
      progress(`Registering reference ${target + 1} of ${features.length}…`);
      const candidates = new Map<number, Set<number>>();
      for (const pair of pairs) {
        const reverse = pair.a === target;
        if (!reverse && pair.b !== target) continue;
        const source = reverse ? pair.b : pair.a;
        if (!poses.has(source)) continue;
        for (const match of pair.matches) {
          const point = reverse ? match.i : match.j, known = lookup.get(`${source}:${reverse ? match.j : match.i}`);
          if (known === undefined) continue;
          const options = candidates.get(point) ?? new Set<number>(); options.add(known); candidates.set(point, options);
        }
      }
      const used = new Set<number>();
      const correspondences = [...candidates].flatMap(([point, options]) => {
        if (options.size !== 1) return [];
        const landmark = [...options][0];
        if (used.has(landmark)) return [];
        used.add(landmark);
        return [{ X: landmarks[landmark].X, p: features[target].points[point], landmark, point }];
      });
      const registration = pnp(cv, correspondences, features[target].k), pose = registration.pose;
      if (!pose) {
        const pairMatches = pairs.filter(p => p.a === target || p.b === target).reduce((sum,p) => sum+p.matches.length,0);
        result.unresolved[features[target].id] = `${pairMatches} pairwise matches. ${registration.reason}`;
        if (registration.tentative) tentativePoses.set(target, registration.tentative);
        continue;
      }
      tentativePoses.delete(target);
      poses.set(target, pose); changed = true;
      const R = rotation(pose);
      for (const c of correspondences) {
        const p = project(c.X, R, pose.translation, pose.intrinsics);
        if (p && Math.hypot(p[0]-c.p[0], p[1]-c.p[1]) < 3) observe(c.landmark, target, c.point);
      }
      completeTracks();
    }
  }
  for (let i = 0; i < features.length; i++) {
    const id = features[i].id, pose = poses.get(i);
    const tentative = tentativePoses.get(i);
    if (pose) { result.cameras[id] = pose; delete result.unresolved[id]; }
    else if (tentative) { result.cameras[id] = tentative; delete result.unresolved[id]; }
    else result.unresolved[id] ??= 'No overlapping pair with sufficient parallax. Add another reference with scene depth.';
  }
  result.pointCount = landmarks.length;
  return result;
}

export function reconstruct(cv: typeof CV, features: Features[], pairs: Pair[], horizontalFov: number, progress: (message: string) => void): Reconstruction {
  let remaining = [...pairs].sort((a,b) => b.matches.length-a.matches.length);
  let best: Reconstruction | undefined;
  // Different seed pairs expose different scene points. Keep a single coherent
  // reconstruction, choosing by registered cameras; never mix frames or unit baselines.
  for (let attempt = 0; attempt < 4; attempt++) {
    progress(`Reconstruction attempt ${attempt+1} of up to 4…`);
    const result = reconstructAttempt(cv, features, pairs, horizontalFov, progress, remaining);
    const score = (item: Reconstruction) => [Object.values(item.cameras).filter(p => p.status !== 'tentative').length, Object.keys(item.cameras).length] as const;
    const current = score(result), previous = best ? score(best) : [-1,-1];
    if (!best || current[0] > previous[0] || (current[0] === previous[0] && current[1] > previous[1])) best = result;
    if (score(best)[0] === features.length || !result.originEntryId) break;
    const used = remaining.findIndex(p => features[p.a].id === result.originEntryId && features[p.b].id === result.baselineEntryId);
    remaining = remaining.slice(used+1);
    if (!remaining.length) break;
  }
  return best!;
}
