import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLocalPoseResult } from '../src/pose/colmap';
import { parseReconstruction } from '../src/pose/validation';
import type { CameraPose, Reconstruction } from '../src/pose/types';
import { appendEntry, emptyCollection, newDraft, Photo } from '../src/model';
import { makeArchive, readArchive } from '../src/archive';
const pose = (x: number): CameraPose => ({rotation:[1,0,0,0,1,0,0,0,1],translation:[-x,0,0],center:[x,0,0],
  intrinsics:{fx:500,fy:500,cx:320,cy:240,source:'vggt',horizontalFov:65},inliers:null,reprojectionError:null});
const result: Reconstruction = {version:1,method:'vggt',estimatedAt:new Date().toISOString(),entryIds:['a','b'],originEntryId:'a',baselineEntryId:'b',scale:'arbitrary',horizontalFov:60,cameras:{a:pose(0),b:pose(1)},unresolved:{},pointCount:0};
test('VGGT import preserves unmeasured quality and rejects method/subject/reference mismatches', () => {
  const envelope = {version:1,subjectId:'s',reconstruction:result};
  assert.equal(readLocalPoseResult(envelope,'s',['a','b'],'vggt').cameras.a.inliers,null);
  assert.throws(() => readLocalPoseResult(envelope,'s',['a','b'],'colmap'));
  assert.throws(() => readLocalPoseResult(envelope,'other',['a','b'],'vggt'));
  assert.throws(() => readLocalPoseResult(envelope,'s',['a','b','c'],'vggt'));
  assert.throws(() => parseReconstruction({...result,cameras:{...result.cameras,a:{...pose(0),inliers:0,reprojectionError:0}}}));
  assert.throws(() => parseReconstruction({...result,cameras:{...result.cameras,a:{...pose(0),rotation:[1,0,0,0,1,0,0,0,-1]}}}));
});
test('VGGT predictions and null metrics survive collection backups', async () => {
  const photo: Photo = {uri:'local.png',width:640,height:480,mimeType:'image/png',source:'library',selectedAt:result.estimatedAt};
  let collection = appendEntry(emptyCollection(),{...newDraft('vggt'),artwork:photo,reference:photo},'a',photo.selectedAt);
  collection = appendEntry(collection,{...newDraft('vggt'),artwork:photo,reference:photo},'b',photo.selectedAt);
  collection.subjects[0].reconstruction = result;
  const restored = await readArchive(await makeArchive(collection,async()=>new Uint8Array([1,2,3])));
  assert.deepEqual(restored.collection.subjects[0].reconstruction,JSON.parse(JSON.stringify(result)));
});
