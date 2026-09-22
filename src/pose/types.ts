export type Intrinsics = { fx: number; fy: number; cx: number; cy: number; source: 'assumed' | 'colmap' | 'vggt'; horizontalFov: number };
export type CameraPose = {
  // Row-major world-to-camera: Xcamera = R * Xworld + t. OpenCV axes: right, down, forward.
  rotation: number[];
  translation: number[];
  center: number[];
  intrinsics: Intrinsics;
  inliers: number | null;
  reprojectionError: number | null;
  // A tentative pose is display-only and is never used to register more cameras.
  status?: 'tentative';
  correspondences?: number;
  warning?: string;
};
export type Reconstruction = {
  version: 1;
  method: 'superpoint-lightglue-sfm' | 'colmap' | 'vggt';
  estimatedAt: string;
  entryIds: string[];
  originEntryId?: string;
  baselineEntryId?: string;
  scale: 'arbitrary';
  horizontalFov: number;
  cameras: Record<string, CameraPose>;
  unresolved: Record<string, string>;
  pointCount: number;
};
export type PoseImage = { id: string; uri: string; width: number; height: number };
export type PoseRequest = { images: PoseImage[]; horizontalFov: number };
export type PoseEvent = { type: 'progress'; message: string } | { type: 'result'; result: Reconstruction } | { type: 'error'; message: string };
