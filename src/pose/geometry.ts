import { Matrix, SingularValueDecomposition as SVD, determinant } from 'ml-matrix';
import { CameraPose, Intrinsics } from './types';

export type Point2 = [number, number];
export type Point3 = [number, number, number];
export type Match = { a: Point2; b: Point2; i: number; j: number };
export const identity = () => Matrix.eye(3);
export const vector = (v: number[]) => Matrix.columnVector(v);
export const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? Infinity;
const unit = (v: number[]) => { const n = Math.hypot(...v); return v.map(x => x / n); };

export function intrinsics(width: number, height: number, horizontalFov: number): Intrinsics {
  if (!(width > 0 && height > 0 && horizontalFov >= 20 && horizontalFov <= 120)) throw new Error('Use a horizontal field of view between 20° and 120°.');
  const f = width / (2 * Math.tan(horizontalFov * Math.PI / 360));
  return { fx: f, fy: f, cx: (width - 1) / 2, cy: (height - 1) / 2, source: 'assumed', horizontalFov };
}
export const normalize = (p: Point2, k: Intrinsics): Point2 => [(p[0] - k.cx) / k.fx, (p[1] - k.cy) / k.fy];
export function camera(R: Matrix, t: number[], k: Intrinsics, inliers: number, error: number): CameraPose {
  return { rotation: R.to1DArray(), translation: t, center: R.transpose().mmul(vector(t)).mul(-1).to1DArray(), intrinsics: k, inliers, reprojectionError: error };
}
export const rotation = (pose: CameraPose) => Matrix.from1DArray(3, 3, pose.rotation);

// Hartley-normalized eight-point fit followed by the essential matrix singular-value constraint.
function essential(matches: Match[]): Matrix {
  const transform = (points: Point2[]) => {
    const c = [0, 1].map(i => points.reduce((s, p) => s + p[i], 0) / points.length);
    const d = points.reduce((s, p) => s + Math.hypot(p[0] - c[0], p[1] - c[1]), 0) / points.length;
    if (d < 1e-6) throw new Error('Degenerate correspondences');
    const s = Math.SQRT2 / d;
    return new Matrix([[s, 0, -s * c[0]], [0, s, -s * c[1]], [0, 0, 1]]);
  };
  const A = transform(matches.map(m => m.a)), B = transform(matches.map(m => m.b));
  const rows = matches.map(m => {
    const [x, y] = A.mmul(vector([...m.a, 1])).to1DArray();
    const [u, v] = B.mmul(vector([...m.b, 1])).to1DArray();
    return [u*x, u*y, u, v*x, v*y, v, x, y, 1];
  });
  // Pad to square so the nullspace is retained for an eight-point sample.
  while (rows.length < 9) rows.push(Array(9).fill(0));
  const fit = new SVD(new Matrix(rows));
  if (fit.diagonal[7] < 1e-8) throw new Error('Degenerate correspondences');
  const F = Matrix.from1DArray(3, 3, fit.rightSingularVectors.getColumn(8));
  const E = B.transpose().mmul(F).mmul(A);
  const svd = new SVD(E);
  return svd.leftSingularVectors.mmul(Matrix.diag([1, 1, 0])).mmul(svd.rightSingularVectors.transpose());
}
function sampson(E: Matrix, m: Match) {
  const a = [...m.a, 1], b = [...m.b, 1];
  const ea = E.mmul(vector(a)).to1DArray(), eb = E.transpose().mmul(vector(b)).to1DArray();
  const e = b.reduce((s, x, i) => s + x * ea[i], 0);
  return e*e / (ea[0]**2 + ea[1]**2 + eb[0]**2 + eb[1]**2 + 1e-20);
}
export function triangulate(a: Point2, b: Point2, R0: Matrix, t0: number[], R1: Matrix, t1: number[]): Point3 | null {
  const rows: number[][] = [];
  for (const [p, R, t] of [[a, R0, t0], [b, R1, t1]] as const) {
    const P = R.clone().addColumn(3, t);
    for (let i = 0; i < 2; i++) rows.push(P.getRow(2).map((x, j) => p[i] * x - P.get(i, j)));
  }
  const h = new SVD(new Matrix(rows)).rightSingularVectors.getColumn(3);
  if (Math.abs(h[3]) < 1e-10) return null;
  const X = h.slice(0, 3).map(x => x / h[3]) as Point3;
  if (!X.every(Number.isFinite)) return null;
  for (const [R, t] of [[R0, t0], [R1, t1]] as const) {
    if (R.mmul(vector(X)).get(2, 0) + t[2] <= 0) return null;
  }
  return X;
}
export function project(X: Point3, R: Matrix, t: number[], k: Intrinsics): Point2 | null {
  const p = R.mmul(vector(X)).to1DArray().map((x, i) => x + t[i]);
  return p[2] > 0 ? [p[0] / p[2] * k.fx + k.cx, p[1] / p[2] * k.fy + k.cy] : null;
}
export function parallax(X: Point3, center0: number[], center1: number[]) {
  const a = unit(X.map((x, i) => x - center0[i])), b = unit(X.map((x, i) => x - center1[i]));
  return Math.acos(Math.max(-1, Math.min(1, a.reduce((s, x, i) => s + x*b[i], 0)))) * 180 / Math.PI;
}
export function recoverRelative(matches: Match[], k0: Intrinsics, k1: Intrinsics, random = Math.random) {
  if (matches.length < 24) throw new Error('Not enough matching features (need at least 24).');
  const normalized = matches.map(m => ({ ...m, a: normalize(m.a, k0), b: normalize(m.b, k1) }));
  const threshold = (1.5 / Math.min(k0.fx, k1.fx)) ** 2;
  let best: number[] = [];
  let iterations = 1800;
  for (let iter = 0; iter < iterations; iter++) {
    const indices = new Set<number>();
    while (indices.size < 8) indices.add(Math.floor(random() * matches.length));
    try {
      const E = essential([...indices].map(i => normalized[i]));
      const inliers = normalized.flatMap((m, i) => sampson(E, m) < threshold ? [i] : []);
      if (inliers.length > best.length) {
        best = inliers;
        const probability = (best.length / matches.length) ** 8;
        iterations = Math.min(iterations, Math.max(100, Math.ceil(Math.log(0.001) / Math.log(1 - Math.min(0.999, probability)))));
      }
    } catch { /* Collinear samples have no usable nullspace. */ }
  }
  if (best.length < 24 || best.length / matches.length < 0.3) throw new Error('Too few geometrically consistent matches.');
  const E = essential(best.map(i => normalized[i]));
  best = normalized.flatMap((m, i) => sampson(E, m) < threshold ? [i] : []);
  const svd = new SVD(E), U = svd.leftSingularVectors, V = svd.rightSingularVectors;
  if (determinant(U) < 0) U.setColumn(2, U.getColumn(2).map(x => -x));
  if (determinant(V) < 0) V.setColumn(2, V.getColumn(2).map(x => -x));
  const W = new Matrix([[0, -1, 0], [1, 0, 0], [0, 0, 1]]);
  const candidates = [];
  for (const w of [W, W.transpose()]) for (const sign of [1, -1]) {
    const R = U.mmul(w).mmul(V.transpose()), t = U.getColumn(2).map(x => sign*x);
    const center = R.transpose().mmul(vector(t)).mul(-1).to1DArray();
    const points = best.flatMap(index => {
      const m = normalized[index], X = triangulate(m.a, m.b, identity(), [0,0,0], R, t);
      if (!X || parallax(X, [0,0,0], center) < 1) return [];
      const p0 = project(X, identity(), [0,0,0], k0), p1 = project(X, R, t, k1);
      if (!p0 || !p1) return [];
      const error = Math.max(Math.hypot(p0[0]-matches[index].a[0], p0[1]-matches[index].a[1]), Math.hypot(p1[0]-matches[index].b[0], p1[1]-matches[index].b[1]));
      return error < 3 ? [{ index, X, error }] : [];
    });
    candidates.push({ R, t, points });
  }
  candidates.sort((a,b) => b.points.length-a.points.length);
  const result = candidates[0];
  if (result.points.length < 24 || result.points.length < best.length * 0.6 || candidates[1].points.length > result.points.length * 0.8) {
    throw new Error('Insufficient parallax or ambiguous geometry. Move sideways and include scene depth.');
  }
  return result;
}
