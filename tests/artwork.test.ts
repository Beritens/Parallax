import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artworkRay, artworkViewerLayout, estimateSubject, nearestArtwork, orbitFromCamera, orbitPosition, snapArtworkOrbit, subjectOnArtwork, Vec3 } from '../src/artworkGeometry';
import { Entry, initialAlignment } from '../src/model';
import { camera, identity, intrinsics } from '../src/pose/geometry';
import { Reconstruction } from '../src/pose/types';

const photo = { uri: 'test', width: 800, height: 600, mimeType: 'image/jpeg', source: 'library' as const, selectedAt: '' };
const entry = (id: string, x: number, y = 0): Entry => ({ id, subjectId: 's', artwork: photo, reference: photo,
  alignment: { ...initialAlignment, x, y }, createdAt: '', description: '' });
const k = intrinsics(800, 600, 60);
const poses = { a: camera(identity(), [0, 0, 0], k, 50, 0), b: camera(identity(), [-2, 0, 0], k, 50, 0) };
const reconstruction: Reconstruction = { version: 1, method: 'superpoint-lightglue-sfm', estimatedAt: '', entryIds: ['a', 'b'],
  scale: 'arbitrary', horizontalFov: 60, cameras: poses, unresolved: {}, pointCount: 50 };
const point: Vec3 = [-1, -1, 5];
const entries = [entry('a', -k.fx / 5 / 800, -k.fy / 5 / 600), entry('b', -3 * k.fx / 5 / 800, -k.fy / 5 / 600)];
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('viewer halves artwork dimensions at twice the orbit distance and preserves alignment scale', () => {
  const subject: Vec3 = [0, 0, 5], viewport = { width: 800, height: 600 };
  const e = entry('a', 0);
  const near = artworkViewerLayout(e, poses.a, subject, viewport, 5)!;
  const far = artworkViewerLayout(e, poses.a, subject, viewport, 10)!;
  close(near.width, 720); close(near.height, 540);
  close(far.width, near.width / 2); close(far.height, near.height / 2);
  const enlarged = artworkViewerLayout({ ...e, alignment: { ...e.alignment, scale: 2 } }, poses.a, subject, viewport, 10)!;
  close(enlarged.width, near.width); close(enlarged.height, near.height);
  // Reconstruction units are arbitrary: only distance ratios may affect size.
  const rescaled = artworkViewerLayout(e, poses.a, [0, 0, 50], viewport, 50)!;
  close(rescaled.width, near.width);
});

test('alignment encodes capture distance and is not shrunk a second time', () => {
  const subject: Vec3 = [0, 0, 5], viewport = { width: 800, height: 600 };
  const nearEntry = entry('a', 0);
  const farEntry = { ...entry('b', 0), alignment: { ...initialAlignment, scale: 0.5 } };
  const farPose = camera(identity(), [0, 0, 5], k, 50, 0);
  const near = artworkViewerLayout(nearEntry, poses.a, subject, viewport, 5)!;
  // The same drawing aligned at twice the capture distance has half the scale.
  // At a shared viewer distance both sources must display at the same size.
  const duringOrbit = artworkViewerLayout(farEntry, farPose, subject, viewport, 5)!;
  close(duringOrbit.width, near.width);
  const snapped = artworkViewerLayout(farEntry, farPose, subject, viewport, 10)!;
  close(snapped.width, near.width / 2);
  close(snapped.height, near.height / 2);
});

test('viewer retains reference fit and centers an offset subject after rotation and scaling', () => {
  const e = { ...entry('a', 0.1, -0.1), artwork: { ...photo, width: 400, height: 800 },
    alignment: { ...initialAlignment, x: 0.1, y: -0.1, scale: 1.7, rotation: 37 } };
  const layout = artworkViewerLayout(e, poses.a, [0, 0, 10], { width: 800, height: 600 }, 5)!;
  close(layout.width, 300 * 0.9 * 1.7 * 2);
  close(layout.height, 600 * 0.9 * 1.7 * 2);
  const x = (layout.anchor.x / e.artwork.width - 0.5) * layout.width;
  const y = (layout.anchor.y / e.artwork.height - 0.5) * layout.height;
  const angle = 37 * Math.PI / 180;
  close(layout.left + layout.width / 2 + Math.cos(angle) * x - Math.sin(angle) * y, 400);
  close(layout.top + layout.height / 2 + Math.sin(angle) * x + Math.cos(angle) * y, 300);
});

test('casts upper-left alignment rays and recovers their common subject', () => {
  const ray = artworkRay(entries[0], poses.a);
  assert.ok(ray.direction[0] < 0 && ray.direction[1] < 0 && ray.direction[2] > 0);
  const result = estimateSubject(entries, reconstruction)!;
  result.point.forEach((x, i) => close(x, point[i]));
  close(result.rmsDistance, 0);
});
test('fits skew rays by minimizing total squared perpendicular distance', () => {
  const skew = [entries[0], { ...entries[1], alignment: { ...entries[1].alignment, y: 0.1 } }];
  const result = estimateSubject(skew, reconstruction)!;
  assert.ok(result.rmsDistance > 0);
  const gradient = [0, 0, 0];
  result.rays.forEach(ray => {
    const delta = result.point.map((x, i) => x - ray.origin[i]);
    const depth = delta.reduce((s, x, i) => s + x * ray.direction[i], 0);
    delta.forEach((x, i) => { gradient[i] += x - depth * ray.direction[i]; });
  });
  gradient.forEach(x => close(x, 0));
});
test('refuses single, parallel, tentative-only, and behind-camera estimates', () => {
  assert.equal(estimateSubject(entries.slice(0, 1), reconstruction), null);
  assert.equal(estimateSubject([entry('a', 0), entry('b', 0)], reconstruction), null);
  assert.equal(estimateSubject(entries, { ...reconstruction, cameras: { ...poses, b: { ...poses.b, status: 'tentative' } } }), null);
  assert.equal(estimateSubject([entry('a', -0.2), entry('b', 0.2)], reconstruction), null);
});
test('inverts artwork fit, rotation, scale, and translation for a projected subject', () => {
  const e = { ...entry('a', 0.1, -0.1), artwork: { ...photo, width: 400, height: 800 },
    alignment: { ...initialAlignment, x: 0.1, y: -0.1, scale: 1.7, rotation: 37 } };
  const angle = 37 * Math.PI / 180, scale = 0.75 * 1.7;
  const x = 60 * scale, y = -120 * scale;
  const px = k.cx + 80 + Math.cos(angle) * x - Math.sin(angle) * y;
  const py = k.cy - 60 + Math.sin(angle) * x + Math.cos(angle) * y;
  const anchor = subjectOnArtwork(e, poses.a, [(px - k.cx) / k.fx * 5, (py - k.cy) / k.fy * 5, 5])!;
  close(anchor.x, 260); close(anchor.y, 280);
  assert.equal(subjectOnArtwork(e, poses.a, [0, 0, -1]), null);
});
test('orbit preserves subject-centered radius and chooses nearest camera', () => {
  const orbit = orbitFromCamera(poses.a.center, point);
  orbitPosition(point, orbit).forEach((x, i) => close(x, poses.a.center[i]));
  const opposite = orbitPosition(point, { ...orbit, yaw: orbit.yaw + Math.PI });
  close(Math.hypot(...opposite.map((x, i) => x - point[i])), orbit.radius);
  assert.equal(nearestArtwork(entries, reconstruction, [0, 0, 0], point)?.id, 'a');
  assert.equal(nearestArtwork(entries, reconstruction, [2, 0, 0], point)?.id, 'b');
});

test('ray direction uses inverse camera rotation, not world-to-camera rotation', () => {
  const pose = { ...poses.a, rotation: [0, 0, -1, 0, 1, 0, 1, 0, 0] };
  const ray = artworkRay(entry('a', 0), pose);
  close(ray.direction[0], 1); close(ray.direction[1], 0); close(ray.direction[2], 0);
});

test('all six viewing directions are reachable despite very different camera distances', () => {
  const subject: Vec3 = [0, 0, 0];
  const views = [0.1, 0.5, 2, 10, 50, 200].map((radius, i) => ({ yaw: -1 + i * 0.4, pitch: i % 2 ? 0.2 : -0.2, radius }));
  const artworks = views.map((_, i) => entry(String(i), 0));
  const cameras = Object.fromEntries(views.map((view, i) => {
    const center = orbitPosition(subject, view);
    return [String(i), camera(identity(), center.map(x => -x), k, 50, 0)];
  }));
  const scene = { ...reconstruction, cameras };
  views.forEach((view, i) => {
    for (const radius of [0.2, 3, 100]) {
      const orbit = { ...view, yaw: view.yaw + 0.01, radius };
      const selected = nearestArtwork(artworks, scene, orbitPosition(subject, orbit), subject);
      assert.equal(selected?.id, String(i));
      const snapped = snapArtworkOrbit(artworks, scene, subject, orbit);
      orbitPosition(subject, snapped).forEach((x, axis) => close(x, cameras[String(i)].center[axis]));
      assert.equal(nearestArtwork(artworks, scene, orbitPosition(subject, snapped), subject)?.id, selected?.id);
    }
  });
});

test('angular selection handles wraparound and includes tentative display views', () => {
  const subject: Vec3 = [0, 0, 10];
  const view = orbitFromCamera(poses.b.center, subject);
  const position = orbitPosition(subject, { ...view, yaw: view.yaw + Math.PI * 2 });
  assert.equal(nearestArtwork(entries, reconstruction, position, subject)?.id, 'b');
  const tentative = { ...reconstruction, cameras: { ...poses, b: { ...poses.b, status: 'tentative' as const } } };
  assert.equal(nearestArtwork(entries, tentative, position, subject)?.id, 'b');
  const snapped = snapArtworkOrbit(entries, tentative, subject, view);
  orbitPosition(subject, snapped).forEach((x, axis) => close(x, poses.b.center[axis]));
  assert.equal(nearestArtwork(entries, reconstruction, subject, subject), null);
  assert.deepEqual(snapArtworkOrbit([], reconstruction, subject, view), view);
});
