import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertColmap, parseColmapRequest, readColmapResult, ColmapRequest } from '../src/pose/colmap';
import { parseReconstruction } from '../src/pose/validation';
const request: ColmapRequest = {version:1,subjectId:'subject',horizontalFov:60,images:[
  {id:'a',name:'reference-1.png',width:640,height:480},
  {id:'b',name:'reference-2.png',width:640,height:480},
  {id:'c',name:'reference-3.png',width:640,height:480},
]};
const calibration = '1 PINHOLE 640 480 500 500 320 240\n2 PINHOLE 640 480 600 600 320 240';
// Non-identity orientation and nonzero origin; second camera is 2 world units away.
const images = '10 0 0 0 1 2 0 0 1 reference-1.png\n420 240 99\n20 0 0 0 1 4 0 0 2 reference-2.png\n560 240 99\n';
const points = '99 0 0 10 255 255 255 0 10 0 20 0';
test('COLMAP conversion rebases orientation and scale, keeps refined intrinsics and computes pixel errors', () => {
  const r = convertColmap(request,calibration,images,points);
  assert.equal(r.method,'colmap');
  assert.ok(r.cameras.a.center.every(v => Math.abs(v)<1e-10));
  assert.deepEqual(r.cameras.b.center,[-1,0,0]);
  assert.equal(r.cameras.b.inliers,1);
  assert.equal(r.cameras.b.reprojectionError,0);
  assert.equal(r.cameras.b.intrinsics.fx,600);
  assert.notEqual(r.cameras.a.intrinsics.horizontalFov,r.cameras.b.intrinsics.horizontalFov);
  assert.ok(r.unresolved.c);
  assert.deepEqual(parseReconstruction(JSON.parse(JSON.stringify(r))),JSON.parse(JSON.stringify(r)));
});
test('result import rejects a different subject and stale reference set', () => {
  const result = {version:1,subjectId:'subject',reconstruction:convertColmap(request,calibration,images,points)};
  assert.equal(readColmapResult(result,'subject',['a','b','c']).method,'colmap');
  assert.throws(() => readColmapResult(result,'other',['a','b','c']),/another subject/);
  assert.throws(() => readColmapResult(result,'subject',['a','b']),/changed/);
});
test('request paths are constrained and unsupported camera models are rejected', () => {
  assert.throws(() => parseColmapRequest({...request,images:request.images.map(i => ({...i,name:'../escape.png'}))}),/Invalid/);
  assert.throws(() => convertColmap(request,calibration.replaceAll('PINHOLE','OPENCV'),images,points),/Unsupported/);
  assert.throws(() => convertColmap(request,calibration,images.split('\n').slice(0,2).join('\n'),points),/at least two/);
});
test('empty observation lines do not shift subsequent camera records', () => {
  const r = convertColmap(request,calibration,images.replace('420 240 99',''),points);
  assert.equal(r.cameras.a.inliers,0);
  assert.equal(r.cameras.b.inliers,1);
});

test('SIMPLE_PINHOLE imports one focal length into both pixel axes', () => {
  const r = convertColmap(request,'1 SIMPLE_PINHOLE 640 480 500 320 240\n2 SIMPLE_PINHOLE 640 480 600 320 240',images,points);
  assert.equal(r.cameras.b.intrinsics.fx,600);
  assert.equal(r.cameras.b.intrinsics.fy,600);
  assert.equal(r.cameras.b.reprojectionError,0);
});
