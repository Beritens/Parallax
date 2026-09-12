import { Alignment, fitInside, initialAlignment, Photo } from './model';
import { referenceFrame } from './gestures';

// Alignment is stored relative to an aspect-fit artwork. Scale it just enough
// that the initial overlay uses the same centered cover crop as camera capture.
export function coverAlignment(artwork: Pick<Photo, 'width' | 'height'>, referenceAspect: number): Alignment {
  const artworkAspect = artwork.width / artwork.height;
  return { ...initialAlignment, scale: Math.max(artworkAspect / referenceAspect, referenceAspect / artworkAspect) };
}

// The viewport remains fixed while source dimensions can change (webcam,
// native still crop, upload, or retake). Preserve the on-screen artwork transform.
export function reframeAlignment(alignment: Alignment, artwork: Pick<Photo, 'width' | 'height'>,
  viewport: { width: number; height: number }, fromAspect: number, toAspect: number): Alignment {
  const before = referenceFrame(viewport.width, viewport.height, fromAspect, true);
  const after = referenceFrame(viewport.width, viewport.height, toAspect, true);
  const beforeArt = fitInside(artwork.width, artwork.height, before.width, before.height);
  const afterArt = fitInside(artwork.width, artwork.height, after.width, after.height);
  return { ...alignment, x: alignment.x * before.width / after.width,
    y: alignment.y * before.height / after.height, scale: alignment.scale * beforeArt.width / afterArt.width };
}
