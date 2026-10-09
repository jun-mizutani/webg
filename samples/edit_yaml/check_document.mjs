// check_document.mjs 2026/09/18
// GPUやheadlessブラウザを起動せず、保存データの往復と失敗時の保持を確認する
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { EditorDocument, initialManifest, serialize } from "./scene_document.js";
import { makeMesh, extrudeFace, subdivideFace, validateMesh } from "./mesh_edit.js";
import { newCollider, colliderLines } from "./collider_edit.js";

const manifest = initialManifest(), original = serialize(manifest);
const document = new EditorDocument(original);
assert.deepEqual(document.manifest, manifest);
assert.equal(gunzipSync(gzipSync(original)).toString(), original);
assert.throws(()=>document.commit("objects: broken"));
assert.equal(document.text, original);
assert.equal(document.undoStack.length, 0);
manifest.objects[1].physics = {bodyType:"dynamic",mass:1,material:{friction:.4,restitution:.2}};
document.commit(serialize(manifest));
assert.equal(document.undoStack[0],original);
assert.equal(document.checked.entries[1].physics.mass,1);
for (const kind of ["cube", "sphere"]) {
  const mesh = {id:"edited",...makeMesh(kind)};
  const count = mesh.faces.length;
  validateMesh(mesh,kind); extrudeFace(mesh,0,.25); subdivideFace(mesh,1); validateMesh(mesh,kind);
  assert.ok(mesh.faces.length>count);
  const next=initialManifest();next.meshes=[mesh];delete next.objects[1].shape;next.objects[1].mesh=mesh.id;
  assert.deepEqual(new EditorDocument(serialize(next)).manifest,next);
  next.objects[1].physics={bodyType:"static"};assert.throws(()=>new EditorDocument(serialize(next)),/shape is required/);
  next.objects[1].physics.shape={type:"box",size:[1,1,1]};
  assert.equal(new EditorDocument(serialize(next)).checked.entries[1].physics.shape.type,"box");
  mesh.faces[0][0]=mesh.vertices.length;assert.throws(()=>validateMesh(mesh,kind));
}
const empty=initialManifest();empty.objects=[];assert.equal(new EditorDocument(serialize(empty)).checked.entries.length,0);
const extra=initialManifest();extra.custom={keep:[1,"text",true]};assert.deepEqual(new EditorDocument(serialize(extra)).manifest.custom,extra.custom);
const external=initialManifest();external.modelAssetUrl="test.json";assert.throws(()=>new EditorDocument(serialize(external)),/inline/);
console.log("PASS: primitive/physics/mesh round trips, gzip bytes, empty scene, metadata, rejection and history preservation");
for(const type of ["box","sphere","capsule"]) {
  const shape=newCollider(type),lines=colliderLines(shape);
  assert.ok(lines.length>0);
  const shifted=colliderLines({...shape,offset:[1,2,3]});
  assert.deepEqual(shifted[0][0],lines[0][0].map((v,i)=>v+i+1));
  const data=initialManifest();data.objects[1].physics={bodyType:"static",shape};
  const doc=new EditorDocument(serialize(data));
  assert.deepEqual(doc.checked.entries[1].physics.shape,shape);
  assert.deepEqual(doc.manifest.objects[1].shape,data.objects[1].shape);
}
assert.equal(colliderLines(newCollider("box")).length,12);
const capsulePoints=colliderLines(newCollider("capsule")).flat();
assert.equal(Math.max(...capsulePoints.map(p=>p[1])),.5);
assert.equal(Math.min(...capsulePoints.map(p=>p[1])),-.5);
console.log("PASS: collider line geometry, offsets and unchanged display geometry");
