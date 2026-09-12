import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { appendEntry, emptyCollection, fitInside, newDraft, Photo } from '../src/model';
import { makeArchive } from '../src/archive';
import { moveArtwork, referenceFrame, TouchPoint } from '../src/gestures';
import { coverAlignment, reframeAlignment } from '../src/cameraGeometry';

const photo: Photo = { uri: 'file:///original.png', width: 800, height: 600, mimeType: 'image/png', source: 'library', selectedAt: '2026-09-11T10:00:00Z' };
const draft = { ...newDraft('  Old   Bridge '), artwork: photo, reference: photo, description: '  West bank  ' };

test('groups normalized subject names under a stable ID and preserves the first image', () => {
  const first = appendEntry(emptyCollection(), draft, 'one', '2026-09-11T10:00:00Z');
  const second = appendEntry(first, { ...draft, subject: 'old bridge', artwork: { ...photo, uri: 'file:///second.png' } }, 'two', '2026-09-11T11:00:00Z');
  assert.equal(second.subjects.length, 1);
  assert.equal(second.subjects[0].name, 'Old Bridge');
  assert.equal(second.entries[0].subjectId, second.entries[1].subjectId);
  assert.equal(second.entries[0].artwork.uri, photo.uri);
  assert.equal(second.entries[0].description, 'West bank');
  assert.equal(first.entries.length, 1);
});

test('rejects incomplete drafts and blank subjects', () => {
  for (const invalid of [newDraft('Bridge'), { ...draft, subject: '  ' }, { ...draft, reference: undefined }]) {
    assert.throws(() => appendEntry(emptyCollection(), invalid, 'one', 'now'));
  }
});

test('alignment stays independent of preview resolution', () => {
  assert.deepEqual(fitInside(800, 600, 300, 400), { width: 300, height: 225 });
  assert.deepEqual(fitInside(600, 800, 400, 300), { width: 225, height: 300 });
  const alignment = { x: 0.15, y: -0.1, rotation: 32, scale: 1.4, opacity: 0.35 };
  const saved = appendEntry(emptyCollection(), { ...draft, alignment }, 'one', 'now');
  alignment.x = 0.9;
  assert.equal(saved.entries[0].alignment.x, 0.15);
});

test('ZIP contains both unchanged originals and a portable, linked manifest', async () => {
  const original = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const collection = appendEntry(emptyCollection(), draft, 'one', '2026-09-11T10:00:00Z');
  const zip = await JSZip.loadAsync(await makeArchive(collection, async () => original));
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.entries[0].subjectId, manifest.subjects[0].id);
  assert.equal(manifest.entries[0].artwork.uri, undefined);
  assert.equal(manifest.entries[0].artwork.width, 800);
  assert.deepEqual(manifest.entries[0].alignment, draft.alignment);
  for (const role of ['artwork', 'reference']) {
    assert.deepEqual(await zip.file(manifest.entries[0][role].path)!.async('uint8array'), original);
  }
});

const point = (id: string, x: number, y: number): TouchPoint => ({ id, x, y });
const frame = { width: 400, height: 800, centerX: 200, centerY: 400 };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

test('one finger translates in reference coordinates without changing rotation or scale', () => {
  const next = moveArtwork(draft.alignment, [point('a', 80, 120)], [point('a', 120, 200)], frame);
  close(next.x, 0.1); close(next.y, 0.1);
  assert.equal(next.rotation, 0); assert.equal(next.scale, 1);
});

test('two fingers rotate and resize together around the touched artwork point', () => {
  const previous = [point('a', 150, 400), point('b', 250, 400)];
  const next = [point('a', 220, 320), point('b', 220, 520)];
  const result = moveArtwork(draft.alignment, previous, next, frame);
  close(result.rotation, 90); close(result.scale, 2);
  close(result.x, 0.05); close(result.y, 0.025);
  // A pivot away from the artwork center moves that center during rotation.
  const offCenter = moveArtwork(draft.alignment, [point('a', 250, 400), point('b', 350, 400)], [point('a', 300, 350), point('b', 300, 450)], frame);
  close(offCenter.x, 0.25); close(offCenter.y, -0.125);
});

test('finger changes rebase without jumping and rotation crosses the angle seam smoothly', () => {
  const start = [point('a', 80, 120)];
  assert.deepEqual(moveArtwork(draft.alignment, start, [...start, point('b', 200, 300)], frame), draft.alignment);
  assert.deepEqual(moveArtwork(draft.alignment, [...start, point('b', 200, 300)], start, frame), draft.alignment);
  assert.deepEqual(moveArtwork(draft.alignment, start, [point('c', 500, 600)], frame), draft.alignment);
  const nearSeam = moveArtwork(draft.alignment, [point('a', 200, 400), point('b', 100, 401)], [point('a', 200, 400), point('b', 100, 399)], frame);
  assert.ok(nearSeam.rotation > 0 && nearSeam.rotation < 2);
});

test('full-screen crop and contained detail preview share the same reference coordinates', () => {
  assert.deepEqual(referenceFrame(400, 800, 3 / 4, true), { width: 600, height: 800 });
  assert.deepEqual(referenceFrame(300, 400, 3 / 4, false), { width: 300, height: 400 });
  const covered = moveArtwork(draft.alignment, [point('a', 100, 100)], [point('a', 160, 180)], { ...frame, width: 600 });
  close(covered.x, 0.1); close(covered.y, 0.1);
});

test('capture preserves artwork size and position when preview and still ratios differ', () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 500, height: 500 / 0.75 }]) {
    for (const [from, to] of [[3 / 4, 16 / 9], [16 / 9, 3 / 4], [3 / 4, 390 / 844]]) {
      for (const artwork of [{ width: 800, height: 600 }, { width: 600, height: 800 }]) {
        const alignment = { x: 0.12, y: -0.08, scale: 1.7, rotation: 37, opacity: 0.4 };
        const next = reframeAlignment(alignment, artwork, viewport, from, to);
        const before = referenceFrame(viewport.width, viewport.height, from, true);
        const after = referenceFrame(viewport.width, viewport.height, to, true);
        const beforeArt = fitInside(artwork.width, artwork.height, before.width, before.height);
        const afterArt = fitInside(artwork.width, artwork.height, after.width, after.height);
        close(next.x * after.width, alignment.x * before.width);
        close(next.y * after.height, alignment.y * before.height);
        close(next.scale * afterArt.width, alignment.scale * beforeArt.width);
        close(next.scale * afterArt.height, alignment.scale * beforeArt.height);
        assert.equal(next.rotation, alignment.rotation);
        assert.equal(next.opacity, alignment.opacity);
        const restored = reframeAlignment(next, artwork, viewport, to, from);
        close(restored.x, alignment.x); close(restored.y, alignment.y); close(restored.scale, alignment.scale);
      }
    }
  }
});

test('initial artwork overlay uses the same cover crop as the artwork camera confirmation', () => {
  for (const referenceAspect of [3 / 4, 16 / 9, 390 / 844]) {
    for (const artwork of [{ width: 800, height: 600 }, { width: 600, height: 800 }, { width: 1000, height: 1000 }]) {
      const alignment = coverAlignment(artwork, referenceAspect);
      const frame = { width: referenceAspect * 1000, height: 1000 };
      const fitted = fitInside(artwork.width, artwork.height, frame.width, frame.height);
      close(fitted.width * alignment.scale, Math.max(frame.width, frame.height * artwork.width / artwork.height));
      close(fitted.height * alignment.scale, Math.max(frame.height, frame.width * artwork.height / artwork.width));
      assert.ok(fitted.width * alignment.scale + 0.000001 >= frame.width);
      assert.ok(fitted.height * alignment.scale + 0.000001 >= frame.height);
      assert.equal(alignment.x, 0); assert.equal(alignment.y, 0); assert.equal(alignment.rotation, 0);
    }
  }
});
