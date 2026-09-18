# Parallax

A local-first Expo / React Native prototype for pairing artwork with photographs of the real world.

## Run

Use Node.js 22.13 or newer and pnpm:

```sh
pnpm install
pnpm start
```

Scan the QR code with a compatible Expo Go app on your phone. `pnpm android` / `pnpm ios` opens an installed emulator or simulator; camera capture needs a physical device. `pnpm web` runs the browser version. Browser cameras require localhost or HTTPS; photo uploads work without camera access.

## Implemented

- Subject overview using the first artwork as each subject's cover, with image counts and an add-image shortcut.
- Three-step flow: artwork camera/upload and confirmation → reference camera/upload and alignment confirmation → subject and optional description.
- Mobile capture and confirmation fill the screen with minimal edge controls. Drag with one finger to move the artwork; twist and pinch with two fingers to rotate and resize. Reset and hide/show artwork buttons replace sliders. Desktop retains precision sliders.
- Alignment is adjusted directly over the live reference camera or its captured/uploaded photo; there is no separate alignment step. Back preserves the draft; replacing artwork resets alignment. Closing asks before discarding unsaved work.
- Live preview and confirmation use the same fixed viewport and centered cover crop. Browser video dimensions determine its alignment frame; switching to captured dimensions preserves the artwork's visible transform. Front-webcam preview mirroring is disabled to match saved images.
- The reference overlay starts with the exact centered, screen-filling crop used for artwork confirmation. Reset returns to that crop, including when artwork and camera aspect ratios differ.
- Subjects are grouped by case-insensitive names with whitespace normalized, and assigned stable IDs.
- Native images are copied into app documents; SQLite stores metadata. Web uses IndexedDB with durable image data. Saving reports failures and retains the draft.
- ZIP export and import of the complete collection, including both originals and a versioned JSON manifest. Import validates the archive and asks before replacing existing local data.
- Browser camera pose estimation from reference photos, automatically after saving a second or later perspective, with manual estimation for existing/imported subjects. An interactive 3D viewer shows camera positions and oriented viewing frustums with drag orbit and wheel/pinch zoom; progress, cancellation, coordinates, inlier counts, and unresolved-photo reasons are shown on each subject card.

Subject viewing is deferred. No account, server, location collection, or sync is included. Drafts are held in memory until saved. Clearing app/browser data removes saved data; export backups first. Exports and imports are assembled in memory, so very large collections may exceed device memory.

## Browser camera estimation

Use at least two overlapping photographs of the same static scene, taken from different positions. Include features at different depths; a flat wall, duplicates, a panorama taken by rotating in place, or unrelated photographs cannot provide a reliable reconstruction. Only the original reference photos are matched; artworks and their alignment are not used as geometric evidence.

`pnpm start`, `pnpm web`, and `pnpm build:web` prepare the worker and its assets. The first preparation downloads approximately 52 MB of pinned, SHA-256-verified SuperPoint and LightGlue weights from the [LightGlue-ONNX v0.1.3 release](https://github.com/fabio-sim/LightGlue-ONNX/releases/tag/v0.1.3). Later builds reuse them. Generated files in `public/pose/` are ignored by Git and copied into the web export. GitHub Pages builds run this preparation too. When invoking Expo directly, run `pnpm prepare:pose` first.

All inference runs locally in a cancellable Web Worker: [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) uses single-threaded WASM, so GitHub Pages does not need cross-origin isolation or WebGPU. Photos are resized to approximately 768 pixels on the longest side, SuperPoint extracts up to 1,024 features per photo, and LightGlue matches pairs. A normalized eight-point essential-matrix RANSAC and cheirality/parallax checks initialize a two-view reconstruction. OpenCV.js rejects homography-dominated seed pairs and registers further cameras with PnP RANSAC and refinement against triangulated scene points. Additional well-conditioned points extend the scene as cameras register, and reprojection-checked matches complete existing feature tracks through registered views. If some cameras remain unresolved, up to four starting pairs are tried and the coherent reconstruction with the most registered cameras is kept. A geometrically coherent PnP result below the strict consensus threshold is retained as a dashed orange tentative camera for inspection, but it is never used to triangulate points or register other cameras. Failure messages distinguish insufficient 3D matches from failed pose-consistency or reprojection checks. Disconnected photos remain unresolved instead of receiving invented positions. This is a small-collection prototype: pair matching is quadratic, and there is no bundle adjustment, loop closure, or reconstruction merging. Higher feature counts and retries increase processing time.

The horizontal field of view defaults to **60°** and can be changed on the subject card. This assumes the same horizontal FOV for every photo, square pixels, a centered principal point, and no lens distortion. There is no EXIF calibration or focal-length optimization. Mixed lenses, crops, very wide lenses, and an incorrect FOV reduce accuracy. Results are approximate and up to a **single arbitrary scale**, not GPS coordinates or meters. The first recovered camera is the origin and the seed camera baseline has length one. Re-estimation can choose another seed, changing the coordinate frame.

Modern browsers need WebAssembly, Web Workers, and OffscreenCanvas. Native apps preserve/export the metadata but do not perform inference. Network/build/model failures leave saved photos intact and can be retried; cancel terminates the worker and keeps the previous result. The app discovers worker assets relative to its current hosting path, with fallbacks for the configured GitHub Pages path and the site root. Browser caching may avoid subsequent asset downloads, but offline availability is not guaranteed.

The model projects' licenses apply: see [SuperPoint](https://github.com/magicleap/SuperPointPretrainedNetwork/blob/master/LICENSE), [LightGlue](https://github.com/cvg/LightGlue/blob/main/LICENSE), and [LightGlue-ONNX](https://github.com/fabio-sim/LightGlue-ONNX). SuperPoint weights have a noncommercial license; review that before using this proof of concept commercially.

## Export format

```text
manifest.json
images/<entry-id>/artwork.<extension>
images/<entry-id>/reference.<extension>
```

`manifest.json` has `schemaVersion: 1`, export time, subjects, and entries. Each entry links to a subject ID and includes image paths, dimensions, MIME types, camera/library source, selection time, creation time, description, and alignment. Selection time records when this app received the image, not the original photo's EXIF timestamp.

Subjects may also contain an optional `reconstruction` (version 1). Old backups without it remain supported. It records the method, estimated time, participating entry IDs, origin/baseline entry IDs, assumed FOV, arbitrary scale, scene point count, a `cameras` map keyed by entry ID, and an `unresolved` reason map. Each camera contains row-major `rotation` (3×3), `translation` (3), `center` (3), full-resolution reference-image intrinsics, inlier count, and median reprojection error in original-image pixels. Tentative cameras additionally record their status, total 3D correspondence count, and warning. The convention is **Xcamera = R · Xworld + t**, **camera center = −Rᵀt**, with axes right/down/forward. Adding photos leaves older results marked as needing an update until estimation completes. The sparse point cloud and descriptors are transient and are not exported.

Use **Import data** to restore one of these ZIP files. Import replaces the collection on the current device after confirmation; choosing an invalid or unsupported archive leaves the current collection unchanged.

To reconstruct alignment, aspect-fit the artwork inside the reference image, multiply by `scale`, rotate clockwise by `rotation` degrees around the artwork center, then translate by `x * referenceWidth` and `y * referenceHeight`. Positive x is right, positive y is down. The starting origin is the reference center. `opacity` affects only the preview. Original files are never composited or cropped by alignment. Mobile confirmation uses a screen-filling crop for display only; transforms remain relative to the full reference image. Camera preview framing can differ by device; reference confirmation uses the actual captured dimensions.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build:web
pnpm exec expo export --platform android --platform ios
```

Manual device checks: allow/deny camera access, capture both images, drag with one finger, rotate/pinch with two fingers (including adding/lifting a finger), retake and go back through all three steps, save to a new and existing subject, restart the app, and share/unzip an export. Browser and native stores are independent.

## Deploy

The web app is deployed to GitHub Pages by `.github/workflows/deploy-pages.yml`. Every push to `main` installs the locked dependencies, exports the Expo web build, and publishes `dist` to:

https://beritens.github.io/Parallax/

For the first deployment, open the repository's **Settings → Pages** page and set **Build and deployment → Source** to **GitHub Actions**. Later pushes to `main` deploy automatically; deployments can also be started manually from the Actions tab.
