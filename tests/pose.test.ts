import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Matrix } from 'ml-matrix';
import cvModule from '@techstark/opencv-js';
import { camera, identity, intrinsics, Match, Point3, project, recoverRelative } from '../src/pose/geometry';
import { reconstruct } from '../src/pose/reconstruct';
import { parseReconstruction } from '../src/pose/validation';
import { decodeMatches } from '../src/pose/matches';
import { poseWorkerCandidates } from '../src/pose/client.web';
import { cameraFrustum, cameraScene, cameraViewAfterDrag, cameraViewPoint } from '../src/pose/cameraPlot';
import type { Reconstruction } from '../src/pose/types';
import { appendEntry, emptyCollection, newDraft, Photo } from '../src/model';
import { makeArchive, readArchive } from '../src/archive';

const k = intrinsics(640, 480, 60);
const rng = (seed = 42) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const random = rng();
const points: Point3[] = Array.from({length: 100}, () => [(random()-.5)*4, (random()-.5)*3, 5+random()*6]);
const angle = 0.1;
const R = new Matrix([[Math.cos(angle),0,Math.sin(angle)],[0,1,0],[-Math.sin(angle),0,Math.cos(angle)]]);
const t = [-1, 0.1, 0.05];
const observations = (r: Matrix, translation: number[]) => points.map(p => project(p, r, translation, k)!);
const first = observations(identity(), [0,0,0]), second = observations(R, t);
const matches: Match[] = first.map((a,i) => ({a, b:second[i], i, j:i}));
const ready = new Promise<void>(resolve => (cvModule as typeof cvModule & {then: (f: () => void) => void}).then(() => resolve()));

test('finds pose workers at both the current hosting path and configured Pages path', () => {
  assert.deepEqual(poseWorkerCandidates('http://localhost:8081/'), [
    'http://localhost:8081/pose/worker.js',
    'http://localhost:8081/Parallax/pose/worker.js',
  ]);
  assert.deepEqual(poseWorkerCandidates('https://example.test/Parallax/'), [
    'https://example.test/Parallax/pose/worker.js',
    'https://example.test/pose/worker.js',
  ]);
});

test('decodes pinned LightGlue dense int64 outputs, rejecting unmatched and weak features', () => {
  const decoded = decodeMatches([[1,2],[3,4],[5,6],[7,8]],[[9,10],[11,12]],BigInt64Array.from([1n,-1n,0n,20n]),[.8,1,.1,1],[1,4]);
  assert.deepEqual(decoded,[{i:0,j:1,a:[1,2],b:[11,12]}]);
  assert.throws(()=>decodeMatches(first,second,[],[],[2,2]));
});

test('recovers rotation and translation direction despite outliers and subpixel noise', () => {
  const noise = rng(17);
  const noisy: Match[] = matches.map((m,i) => ({...m, b:i < 20 ? [noise()*640,noise()*480] : [m.b[0]+(noise()-.5)*.3,m.b[1]+(noise()-.5)*.3]}));
  const pose = recoverRelative(noisy, k, k, rng(1));
  assert.ok(pose.points.length >= 70);
  pose.R.to1DArray().forEach((v,i) => assert.ok(Math.abs(v-R.to1DArray()[i]) < .015));
  const norm = Math.hypot(...t);
  pose.t.forEach((v,i) => assert.ok(Math.abs(v-t[i]/norm) < .025));
});

test('rejects too few matches, collinearity, and rotation-only pairs', () => {
  assert.throws(() => recoverRelative(matches.slice(0,10), k,k), /at least 24/);
  assert.throws(() => recoverRelative(matches.map((m,i) => ({...m,a:[i,i],b:[i+2,i+2]})),k,k,rng()));
  const rotated = observations(R,[0,0,0]);
  assert.throws(() => recoverRelative(matches.map((m,i) => ({...m,b:rotated[i]})),k,k,rng()));
});

test('registers a third camera with shared scale using PnP; leaves disconnected views unresolved', async () => {
  await ready;
  const third = observations(identity(),[-2.5,.2,0]);
  const features = [first,second,third,[]].map((p,i) => ({id:String(i),points:p,k}));
  const result = reconstruct(cvModule,features,[{a:0,b:1,matches},{a:0,b:2,matches:matches.slice(0,70).map((m,i)=>({...m,b:third[i]}))},{a:1,b:2,matches:matches.slice(0,60).map((m,i)=>({...m,a:second[i],b:third[i]}))}],60,()=>{});
  assert.equal(Object.keys(result.cameras).length,3);
  assert.equal(result.originEntryId,'0');
  assert.ok(Math.abs(result.cameras['2'].center[0]-2.5/Math.hypot(...t)) < .03);
  assert.ok(result.unresolved['3']);
  assert.equal(parseReconstruction(result),result);
});

test('keeps a coherent low-consensus PnP pose as tentative without using it for reconstruction', async () => {
  await ready;
  const third = observations(identity(),[-2.5,.2,0]);
  const noise = rng(313);
  const target = third.slice(0,67).map((point,index) => index < 17 ? point : [noise()*640,noise()*480] as [number,number]);
  const weakMatches = target.map((b,index) => ({a:first[index],b,i:index,j:index}));
  const result = reconstruct(cvModule,[first,second,target].map((p,i)=>({id:String(i),points:p,k})),[
    {a:0,b:1,matches}, {a:0,b:2,matches:weakMatches},
  ],60,()=>{});
  const tentative = result.cameras['2'];
  assert.equal(tentative.status,'tentative');
  assert.equal(tentative.correspondences,67);
  assert.ok(tentative.inliers !== null && tentative.inliers >= 12 && tentative.inliers < 67*.4);
  assert.match(tentative.warning ?? '',/tentative/);
  assert.equal(result.unresolved['2'],undefined);
  assert.equal(parseReconstruction(result),result);
});

test('does not invent a reconstruction for planar or duplicate views', async () => {
  await ready;
  const result = reconstruct(cvModule,[{id:'a',points:first,k},{id:'b',points:first,k}],[{a:0,b:1,matches:matches.map(m=>({...m,b:m.a}))}],60,()=>{});
  assert.equal(Object.keys(result.cameras).length,0);
  assert.match(result.unresolved.a,/Flat scene|rotation/);
});

test('tries another seed when the most-matched pair isolates the larger reconstruction', async () => {
  await ready;
  const third = observations(identity(),[-2.5,.2,0]);
  const features = [first,second,first,second,third].map((p,i) => ({id:String(i),points:p,k}));
  const result = reconstruct(cvModule,features,[
    {a:0,b:1,matches},
    {a:2,b:3,matches:matches.slice(0,60)},
    {a:2,b:4,matches:matches.slice(0,40).map((m,i)=>({...m,b:third[i]}))},
  ],60,()=>{});
  assert.deepEqual(Object.keys(result.cameras).sort(),['2','3','4']);
  assert.equal(result.originEntryId,'2');
  assert.ok(result.unresolved['0'] && result.unresolved['1']);
  assert.match(result.unresolved['0'],/pairwise matches.*Only 0 matches/);
});

test('completes tracks through registered views to reach a camera without seed-point matches', async () => {
  await ready;
  const views = [first,second,observations(identity(),[-2,.1,0]),observations(identity(),[-2.8,.3,0])];
  const pair = (a:number,b:number,ids:number[]) => ({a,b,matches:ids.map(i=>({i,j:i,a:views[a][i],b:views[b][i]}))});
  const head = Array.from({length:70},(_,i)=>i), tail = Array.from({length:30},(_,i)=>i+70);
  const result = reconstruct(cvModule,views.map((p,i)=>({id:String(i),points:p,k})),[
    pair(0,1,head), pair(0,2,[...head.slice(0,20),...tail]), pair(1,2,tail), pair(1,3,tail),
  ],60,()=>{});
  assert.equal(result.originEntryId,'0');
  assert.equal(result.baselineEntryId,'1');
  assert.equal(Object.keys(result.cameras).length,4);
  assert.ok(Math.abs(result.cameras['3'].center[0]-2.8/Math.hypot(...t)) < .03);
});

test('camera pose convention uses C = -R transpose t and validates finite proper rotations', () => {
  const pose = camera(R,t,k,40,.2);
  const result = {version:1,method:'superpoint-lightglue-sfm',estimatedAt:new Date().toISOString(),entryIds:['a','b'],originEntryId:'a',baselineEntryId:'b',scale:'arbitrary',horizontalFov:60,cameras:{a:camera(identity(),[0,0,0],k,40,.2),b:pose},unresolved:{},pointCount:40};
  assert.doesNotThrow(()=>parseReconstruction(result));
  assert.throws(()=>parseReconstruction({...result,cameras:{...result.cameras,b:{...pose,center:[NaN,0,0]}}}));
  assert.throws(()=>parseReconstruction({...result,cameras:{...result.cameras,b:{...pose,rotation:Array(9).fill(0)}}}));
  assert.throws(()=>parseReconstruction({...result,entryIds:['a']}));
});

test('camera scene preserves 3D positions, labels, and camera orientation', () => {
  const reconstruction = {version:1,method:'superpoint-lightglue-sfm',estimatedAt:new Date().toISOString(),entryIds:['a','b'],originEntryId:'a',baselineEntryId:'b',scale:'arbitrary',horizontalFov:60,
    cameras:{a:camera(identity(),[0,0,0],k,40,.2),b:camera(R,t,k,40,.2)},unresolved:{},pointCount:40} as Reconstruction;
  const scene = cameraScene([{id:'a'},{id:'missing'},{id:'b'}],reconstruction);
  assert.deepEqual(scene.cameras.map(p => p.label),[1,3]);
  assert.equal(scene.cameras[0].origin,true); assert.equal(scene.cameras[1].origin,false);
  assert.ok(scene.cameras[0].center.every(value => Math.abs(value) < 1e-12));
  const closeVector = (actual: number[], expected: number[]) => actual.every((value,index) => Math.abs(value-expected[index]) < 1e-12);
  assert.ok(closeVector(scene.cameras[0].right,[1,0,0]));
  assert.ok(closeVector(scene.cameras[0].up,[0,-1,0]));
  assert.ok(closeVector(scene.cameras[0].forward,[0,0,1]));
  assert.ok(scene.cameras.every(camera => [camera.right,camera.up,camera.forward].every(axis => Math.abs(Math.hypot(...axis)-1) < 1e-9)));
  assert.ok(scene.radius >= .5);
  const frustum = cameraFrustum(scene.cameras[0],.4);
  assert.ok(closeVector(frustum.apex,[0,0,0]));
  assert.ok(frustum.corners.every(corner => Math.abs(corner[2]-.4) < 1e-9));
  const tentativeReconstruction = { ...reconstruction, cameras: { ...reconstruction.cameras,
    b: { ...reconstruction.cameras.b, status:'tentative', correspondences:67, warning:'Low consensus.' } } } as Reconstruction;
  assert.equal(cameraScene([{id:'a'},{id:'b'}],tentativeReconstruction).cameras[1].tentative,true);
});

test('camera viewer maps OpenCV axes and uses camera-orbit drag directions', () => {
  const center: [number,number,number] = [0,0,0];
  const right = cameraViewPoint([1,0,0],center,1,{yaw:0,pitch:0});
  const down = cameraViewPoint([0,1,0],center,1,{yaw:0,pitch:0});
  assert.ok(right[0] > 0, 'OpenCV image-right must render to the right');
  assert.ok(down[1] < 0, 'OpenCV image-down must render downward after the canvas Y inversion');
  const forwardAtRest = cameraViewPoint([0,0,1],center,1,{yaw:0,pitch:0});
  assert.ok(forwardAtRest[2] < 0, 'OpenCV forward must map to viewer -Z without mirroring the scene');
  const dragged = cameraViewAfterDrag({yaw:0,pitch:0},20,0);
  const forward = cameraViewPoint([0,0,1],center,1,dragged);
  assert.ok(forward[0] < 0, 'dragging the viewpoint right must rotate the scene left');
  const draggedDown = cameraViewAfterDrag({yaw:0,pitch:0},0,20);
  const forwardAfterDown = cameraViewPoint([0,0,1],center,1,draggedDown);
  assert.ok(forwardAfterDown[1] > 0, 'dragging the viewpoint down must rotate the scene upward on canvas');
});

test('pose metadata survives ZIP export/import alongside legacy collections', async () => {
  const photo: Photo = {uri:'local.png',width:640,height:480,mimeType:'image/png',source:'library',selectedAt:new Date().toISOString()};
  let collection = appendEntry(emptyCollection(),{...newDraft('test'),artwork:photo,reference:photo},'a',photo.selectedAt);
  collection = appendEntry(collection,{...newDraft('test'),artwork:photo,reference:photo},'b',photo.selectedAt);
  collection.subjects[0].reconstruction = {version:1,method:'superpoint-lightglue-sfm',estimatedAt:photo.selectedAt,entryIds:['a','b'],originEntryId:'a',baselineEntryId:'b',scale:'arbitrary',horizontalFov:60,cameras:{a:camera(identity(),[0,0,0],k,40,.2),b:camera(R,t,k,40,.2)},unresolved:{},pointCount:40};
  const imported = await readArchive(await makeArchive(collection,async()=>new Uint8Array([1,2,3])));
  assert.deepEqual(imported.collection.subjects,JSON.parse(JSON.stringify(collection.subjects)));
});
