import { Alignment } from './model';

export type TouchPoint = { id: string; x: number; y: number };
export type GestureFrame = { width: number; height: number; centerX: number; centerY: number };
const center = (points: TouchPoint[]) => ({ x: points.reduce((n, p) => n + p.x, 0) / points.length, y: points.reduce((n, p) => n + p.y, 0) / points.length });
export const wrapRotation = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180;

// Apply incremental changes so adding/lifting a finger can rebase without jumping.
export function moveArtwork(alignment: Alignment, previous: TouchPoint[], next: TouchPoint[], frame: GestureFrame): Alignment {
  if (!previous.length || previous.length !== next.length || previous.some((p, i) => p.id !== next[i].id)) return alignment;
  const from = center(previous), to = center(next);
  let angle = 0, scale = alignment.scale;
  if (next.length > 1) {
    const a = { x: previous[1].x - previous[0].x, y: previous[1].y - previous[0].y };
    const b = { x: next[1].x - next[0].x, y: next[1].y - next[0].y };
    if (Math.hypot(a.x, a.y) > 8 && Math.hypot(b.x, b.y) > 8) {
      angle = wrapRotation((Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x)) * 180 / Math.PI) * Math.PI / 180;
      scale = Math.max(0.2, Math.min(3, alignment.scale * Math.hypot(b.x, b.y) / Math.hypot(a.x, a.y)));
    }
  }
  const ratio = scale / alignment.scale;
  const dx = frame.centerX + alignment.x * frame.width - from.x;
  const dy = frame.centerY + alignment.y * frame.height - from.y;
  return { ...alignment, scale, rotation: wrapRotation(alignment.rotation + angle * 180 / Math.PI),
    x: (to.x + ratio * (dx * Math.cos(angle) - dy * Math.sin(angle)) - frame.centerX) / frame.width,
    y: (to.y + ratio * (dx * Math.sin(angle) + dy * Math.cos(angle)) - frame.centerY) / frame.height };
}

export function referenceFrame(width: number, height: number, aspectRatio: number, cover: boolean) {
  const factor = (cover ? Math.max : Math.min)(width / aspectRatio, height);
  return { width: factor * aspectRatio, height: factor };
}
