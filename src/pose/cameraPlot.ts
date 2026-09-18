import type { Entry } from '../model';
import type { Reconstruction } from './types';

export type Vector3 = [number, number, number];

export type SceneCamera = {
  id: string;
  label: number;
  center: Vector3;
  right: Vector3;
  up: Vector3;
  forward: Vector3;
  origin: boolean;
  tentative: boolean;
};

export type CameraScene = {
  cameras: SceneCamera[];
  center: Vector3;
  radius: number;
};

export type CameraFrustum = {
  apex: Vector3;
  corners: [Vector3, Vector3, Vector3, Vector3];
};

export type CameraView = { yaw: number; pitch: number };

const normalized = (v: Vector3): Vector3 => {
  const length = Math.hypot(...v) || 1;
  return [v[0]/length, v[1]/length, v[2]/length];
};

/** Build a true 3D camera scene from the stored world-to-camera poses. */
export function cameraScene(entries: Pick<Entry, 'id'>[], reconstruction: Reconstruction): CameraScene {
  const cameras = entries.flatMap((entry, index): SceneCamera[] => {
    const pose = reconstruction.cameras[entry.id];
    if (!pose) return [];
    const r = pose.rotation;
    // R maps world coordinates to OpenCV camera coordinates. Its rows are the
    // camera axes in world space; camera Y points down, so display -Y as up.
    return [{
      id: entry.id,
      label: index+1,
      center: [...pose.center] as Vector3,
      right: normalized([r[0], r[1], r[2]]),
      up: normalized([-r[3], -r[4], -r[5]]),
      forward: normalized([r[6], r[7], r[8]]),
      origin: entry.id === reconstruction.originEntryId,
      tentative: pose.status === 'tentative',
    }];
  });
  if (!cameras.length) return { cameras, center: [0,0,0], radius: 1 };
  const center: Vector3 = [0,1,2].map(axis => cameras.reduce((sum, camera) => sum+camera.center[axis], 0)/cameras.length) as Vector3;
  const radius = Math.max(0.5, ...cameras.map(camera => Math.hypot(
    camera.center[0]-center[0], camera.center[1]-center[1], camera.center[2]-center[2],
  )));
  return { cameras, center, radius };
}

/** The four image-plane corners for the camera wireframe shown by the viewer. */
export function cameraFrustum(camera: SceneCamera, length: number, aspect = 4/3): CameraFrustum {
  const halfHeight = length*0.36;
  const halfWidth = halfHeight*aspect;
  const point = (right: number, up: number): Vector3 => [0,1,2].map(axis =>
    camera.center[axis]+camera.forward[axis]*length+camera.right[axis]*right+camera.up[axis]*up,
  ) as Vector3;
  return {
    apex: camera.center,
    corners: [point(-halfWidth, halfHeight), point(halfWidth, halfHeight), point(halfWidth, -halfHeight), point(-halfWidth, -halfHeight)],
  };
}

/**
 * Convert OpenCV coordinates (X right, Y down, Z forward) to the viewer's
 * right-handed frame (X right, Y up, Z back), then orbit them. Negating Y and
 * Z is the standard 180° rotation around X; negating only Y would mirror it.
 */
export function cameraViewPoint(point: Vector3, center: Vector3, radius: number, view: CameraView): Vector3 {
  const normalized: Vector3 = [
    (point[0]-center[0])/radius,
    (center[1]-point[1])/radius,
    (center[2]-point[2])/radius,
  ];
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const x = normalized[0]*cy-normalized[2]*sy;
  const z = normalized[0]*sy+normalized[2]*cy;
  return [x, normalized[1]*cp-z*sp, normalized[1]*sp+z*cp];
}

/** Camera-orbit drag: the pointer moves the viewpoint around the scene. */
export function cameraViewAfterDrag(view: CameraView, dx: number, dy: number, sensitivity = 0.009): CameraView {
  return {
    yaw: view.yaw-dx*sensitivity,
    pitch: Math.max(-1.45, Math.min(1.45, view.pitch+dy*sensitivity)),
  };
}
