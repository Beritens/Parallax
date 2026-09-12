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
- Subjects are grouped by case-insensitive names with whitespace normalized, and assigned stable IDs.
- Native images are copied into app documents; SQLite stores metadata. Web uses IndexedDB with durable image data. Saving reports failures and retains the draft.
- ZIP export of the complete collection, including both originals and a versioned JSON manifest.

Subject viewing and camera/subject position estimation are intentionally deferred. No account, server, location collection, or sync is included. Drafts are held in memory until saved. Clearing app/browser data removes saved data; export backups first. Exports are assembled in memory, so very large collections may exceed device memory. Import is not implemented yet.

## Export format

```text
manifest.json
images/<entry-id>/artwork.<extension>
images/<entry-id>/reference.<extension>
```

`manifest.json` has `schemaVersion: 1`, export time, subjects, and entries. Each entry links to a subject ID and includes image paths, dimensions, MIME types, camera/library source, selection time, creation time, description, and alignment. Selection time records when this app received the image, not the original photo's EXIF timestamp.

To reconstruct alignment, aspect-fit the artwork inside the reference image, multiply by `scale`, rotate clockwise by `rotation` degrees around the artwork center, then translate by `x * referenceWidth` and `y * referenceHeight`. Positive x is right, positive y is down. The starting origin is the reference center. `opacity` affects only the preview. Original files are never composited or cropped by alignment. Mobile confirmation uses a screen-filling crop for display only; transforms remain relative to the full reference image. Camera preview framing can differ by device; reference confirmation uses the actual captured dimensions.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm exec expo export --platform web
pnpm exec expo export --platform android --platform ios
```

Manual device checks: allow/deny camera access, capture both images, drag with one finger, rotate/pinch with two fingers (including adding/lifting a finger), retake and go back through all three steps, save to a new and existing subject, restart the app, and share/unzip an export. Browser and native stores are independent.
