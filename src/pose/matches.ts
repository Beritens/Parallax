import { Match, Point2 } from './geometry';

/** v0.1.3 dense outputs: matches0[1,N] contains the target index or -1. */
export function decodeMatches(a: Point2[], b: Point2[], indices: ArrayLike<number | bigint>, scores: ArrayLike<number>, dims: readonly number[]): Match[] {
  if (dims.length !== 2 || dims[0] !== 1 || dims[1] !== a.length || indices.length !== a.length || scores.length !== a.length) throw new Error('Unexpected LightGlue model outputs.');
  const matches: Match[] = [];
  for (let i = 0; i < indices.length; i++) {
    const j = Number(indices[i]);
    if (Number.isSafeInteger(j) && j >= 0 && j < b.length && scores[i] >= 0.2) matches.push({ i, j, a: a[i], b: b[j] });
  }
  return matches;
}
