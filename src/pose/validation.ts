import { CameraPose, Reconstruction } from './types';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const array = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(finite);
const count = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
function validCamera(v: unknown, predicted: boolean): v is CameraPose {
  if (!record(v) || !array(v.rotation, 9) || !array(v.translation, 3) || !array(v.center, 3) || !record(v.intrinsics)) return false;
  if (predicted ? v.inliers !== null || v.reprojectionError !== null || v.status !== undefined : !count(v.inliers) || !finite(v.reprojectionError) || v.reprojectionError < 0) return false;
  if (v.status !== undefined && v.status !== 'tentative') return false;
  if (v.correspondences !== undefined && (!count(v.correspondences) || (!count(v.inliers) || v.correspondences < v.inliers))) return false;
  if (v.warning !== undefined && typeof v.warning !== 'string') return false;
  if (v.status === 'tentative' && (!count(v.correspondences) || (!count(v.inliers) || v.correspondences < v.inliers) || typeof v.warning !== 'string' || !v.warning.trim())) return false;
  const k = v.intrinsics, R = v.rotation, t = v.translation, C = v.center;
  if ((k.source !== 'assumed' && k.source !== 'colmap' && k.source !== 'vggt') || !finite(k.fx) || k.fx <= 0 || !finite(k.fy) || k.fy <= 0 || !finite(k.cx) || !finite(k.cy) || !finite(k.horizontalFov) || k.horizontalFov <= 0 || k.horizontalFov >= 180) return false;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(C[i] + R[i]*t[0] + R[3+i]*t[1] + R[6+i]*t[2]) > 1e-4) return false;
    for (let j = 0; j < 3; j++) {
      const dot = R[3*i]*R[3*j] + R[3*i+1]*R[3*j+1] + R[3*i+2]*R[3*j+2];
      if (Math.abs(dot - (i === j ? 1 : 0)) > 1e-4) return false;
    }
  }
  const det = R[0]*(R[4]*R[8]-R[5]*R[7])-R[1]*(R[3]*R[8]-R[5]*R[6])+R[2]*(R[3]*R[7]-R[4]*R[6]);
  return Math.abs(det-1) < 1e-4;
}
export function parseReconstruction(value: unknown): Reconstruction {
  const invalid = () => { throw new Error('The backup has invalid camera reconstruction data.'); };
  if (!record(value) || value.version !== 1 || (value.method !== 'superpoint-lightglue-sfm' && value.method !== 'colmap' && value.method !== 'vggt') || value.scale !== 'arbitrary' || typeof value.estimatedAt !== 'string' || !Number.isFinite(Date.parse(value.estimatedAt)) || !finite(value.horizontalFov) || value.horizontalFov < 20 || value.horizontalFov > 120 || !count(value.pointCount)) return invalid();
  if (!Array.isArray(value.entryIds) || !value.entryIds.every(id => typeof id === 'string') || new Set(value.entryIds).size !== value.entryIds.length || !record(value.cameras) || !record(value.unresolved)) return invalid();
  const ids = new Set(value.entryIds);
  for (const [id, pose] of Object.entries(value.cameras)) if (!ids.has(id) || !validCamera(pose, value.method === 'vggt') || (value.method === 'superpoint-lightglue-sfm' ? pose.intrinsics.source !== 'assumed' || pose.intrinsics.horizontalFov !== value.horizontalFov : pose.intrinsics.source !== value.method)) return invalid();
  for (const [id, reason] of Object.entries(value.unresolved)) if (!ids.has(id) || typeof reason !== 'string' || Object.hasOwn(value.cameras, id)) return invalid();
  for (const id of ids) if (!Object.hasOwn(value.cameras, id) && !Object.hasOwn(value.unresolved, id)) return invalid();
  const n = Object.keys(value.cameras).length;
  if (n > 0 && (n < 2 || typeof value.originEntryId !== 'string' || typeof value.baselineEntryId !== 'string' || value.originEntryId === value.baselineEntryId || !Object.hasOwn(value.cameras, value.originEntryId) || !Object.hasOwn(value.cameras, value.baselineEntryId))) return invalid();
  if (n === 0 && (value.originEntryId !== undefined || value.baselineEntryId !== undefined || value.pointCount !== 0)) return invalid();
  return value as Reconstruction;
}
