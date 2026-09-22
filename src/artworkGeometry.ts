import { Matrix, SingularValueDecomposition } from 'ml-matrix';
import { Entry, fitInside } from './model';
import type { CameraPose, Reconstruction } from './pose/types';

export type Vec3 = [number, number, number];
export type SubjectRay = { id: string; origin: Vec3; direction: Vec3 };
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const subtract = (a: number[], b: number[]) => a.map((x, i) => x - b[i]) as Vec3;

export function artworkRay(entry: Entry, pose: CameraPose): SubjectRay {
  const { width, height } = entry.reference;
  const k = pose.intrinsics;
  // Image coordinates describe pixel centers, while alignment uses frame edges.
  const local = [((width - 1) / 2 + entry.alignment.x * width - k.cx) / k.fx,
    ((height - 1) / 2 + entry.alignment.y * height - k.cy) / k.fy, 1];
  const direction = [0, 1, 2].map(i => dot(local, [pose.rotation[i], pose.rotation[i + 3], pose.rotation[i + 6]])) as Vec3;
  const length = Math.hypot(...direction);
  return { id: entry.id, origin: [...pose.center] as Vec3, direction: direction.map(x => x / length) as Vec3 };
}

/** Least-squares perpendicular distance to all forward-facing artwork rays. */
export function estimateSubject(entries: Entry[], reconstruction: Reconstruction) {
  const rays = entries.flatMap(entry => {
    const pose = reconstruction.cameras[entry.id];
    return pose && pose.status !== 'tentative' ? [artworkRay(entry, pose)] : [];
  });
  if (rays.length < 2) return null;
  const a = Matrix.zeros(3, 3), b = Matrix.zeros(3, 1);
  for (const { origin, direction } of rays) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const value = (i === j ? 1 : 0) - direction[i] * direction[j];
    a.set(i, j, a.get(i, j) + value);
    b.set(i, 0, b.get(i, 0) + value * origin[j]);
  }
  const svd = new SingularValueDecomposition(a);
  if (svd.diagonal[2] / svd.diagonal[0] < 1e-5) return null;
  const point = svd.solve(b).to1DArray() as Vec3;
  // A solution behind a camera cannot be displayed by that camera. Do not
  // invent a depth for divergent views or an inconsistent reconstruction.
  if (!point.every(Number.isFinite) || rays.some(ray => dot(subtract(point, ray.origin), ray.direction) <= 1e-6)) return null;
  const rmsDistance = Math.sqrt(rays.reduce((sum, ray) => {
    const delta = subtract(point, ray.origin), depth = dot(delta, ray.direction);
    return sum + delta.reduce((s, x, i) => s + (x - depth * ray.direction[i]) ** 2, 0);
  }, 0) / rays.length);
  return { point, rays, rmsDistance };
}

/** Invert fit → scale → rotate → translate to locate the subject in artwork pixels. */
export function subjectOnArtwork(entry: Entry, pose: CameraPose, point: Vec3) {
  const p = [0, 1, 2].map(i => dot(pose.rotation.slice(i * 3, i * 3 + 3), point) + pose.translation[i]);
  if (p[2] <= 1e-6) return null;
  const { width, height } = entry.reference, { alignment } = entry;
  const x = p[0] / p[2] * pose.intrinsics.fx + pose.intrinsics.cx - (width - 1) / 2 - alignment.x * width;
  const y = p[1] / p[2] * pose.intrinsics.fy + pose.intrinsics.cy - (height - 1) / 2 - alignment.y * height;
  const angle = alignment.rotation * Math.PI / 180;
  const fitted = fitInside(entry.artwork.width, entry.artwork.height, width, height);
  const scale = fitted.width / entry.artwork.width * alignment.scale;
  return { x: entry.artwork.width / 2 + (Math.cos(angle) * x + Math.sin(angle) * y) / scale,
    y: entry.artwork.height / 2 + (-Math.sin(angle) * x + Math.cos(angle) * y) / scale };
}

/** Alignment already contains the source camera's perspective shrinkage.
 * Recover its size at the source distance, then project at the orbit distance.
 */
export function artworkViewerLayout(entry: Entry, pose: CameraPose, subject: Vec3,
  viewport: { width: number; height: number }, viewerDistance: number) {
  const anchor = subjectOnArtwork(entry, pose, subject);
  const distance = Math.hypot(...subtract(pose.center, subject));
  if (!anchor || distance <= 1e-6 || !Number.isFinite(viewerDistance) || viewerDistance <= 1e-6) return null;
  const referenceFit = fitInside(entry.reference.width, entry.reference.height, viewport.width * 0.9, viewport.height * 0.9);
  const artworkFit = fitInside(entry.artwork.width, entry.artwork.height, entry.reference.width, entry.reference.height);
  const scale = artworkFit.width / entry.artwork.width * referenceFit.width / entry.reference.width
    * entry.alignment.scale * distance / viewerDistance;
  const width = entry.artwork.width * scale, height = entry.artwork.height * scale;
  const angle = entry.alignment.rotation * Math.PI / 180;
  const x = (anchor.x - entry.artwork.width / 2) * scale, y = (anchor.y - entry.artwork.height / 2) * scale;
  return { anchor, width, height,
    left: viewport.width / 2 - width / 2 - (Math.cos(angle) * x - Math.sin(angle) * y),
    top: viewport.height / 2 - height / 2 - (Math.sin(angle) * x + Math.cos(angle) * y) };
}

export type Orbit = { yaw: number; pitch: number; radius: number };
export function orbitFromCamera(center: number[], subject: Vec3): Orbit {
  const d = subtract(center, subject), radius = Math.hypot(...d);
  return { yaw: Math.atan2(d[0], -d[2]), pitch: Math.asin(Math.max(-1, Math.min(1, -d[1] / radius))), radius };
}
export function orbitPosition(subject: Vec3, orbit: Orbit): Vec3 {
  const { yaw, pitch, radius } = orbit;
  return [subject[0] + radius * Math.sin(yaw) * Math.cos(pitch), subject[1] - radius * Math.sin(pitch),
    subject[2] - radius * Math.cos(yaw) * Math.cos(pitch)];
}
/** Select by viewing direction around the subject, independent of camera distance. */
export function nearestArtwork(entries: Entry[], reconstruction: Reconstruction, position: Vec3, subject: Vec3) {
  const view = subtract(position, subject), viewLength = Math.hypot(...view);
  if (viewLength <= 1e-10) return null;
  let best: Entry | null = null, bestScore = -Infinity;
  for (const entry of entries) {
    const pose = reconstruction.cameras[entry.id];
    // Tentative poses are too uncertain to influence the shared subject fit,
    // but they still provide a usable viewing direction for their own artwork.
    if (!pose || !subjectOnArtwork(entry, pose, subject)) continue;
    const direction = subtract(pose.center, subject), length = Math.hypot(...direction);
    if (length <= 1e-10) continue;
    const score = dot(view, direction) / (viewLength * length);
    if (score > bestScore + 1e-12) { best = entry; bestScore = score; }
  }
  return best;
}

export function snapArtworkOrbit(entries: Entry[], reconstruction: Reconstruction, subject: Vec3, orbit: Orbit): Orbit {
  const selected = nearestArtwork(entries, reconstruction, orbitPosition(subject, orbit), subject);
  return selected ? orbitFromCamera(reconstruction.cameras[selected.id].center, subject) : orbit;
}
