import { Alignment, fitInside, Photo } from './model';
import { referenceFrame } from './gestures';

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
