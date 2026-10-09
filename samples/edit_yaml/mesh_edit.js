// mesh_edit.js 2026/09/18
// 頂点と面を保存データのまま編集する関数群。Copyright (c) 2026 Jun Mizutani, MIT
import util from "../../webg/util.js";
import { readSceneMesh } from "../../webg/app/SceneMesh.js";
import { makePrimitiveGeometry } from "../mmodeler/ModelerPrimitiveFactory.js";

// mmodelerの編集用primitiveを再利用し、頂点番号を共有するメッシュを作る
export function makeMesh(kind = "cube") {
  const { vertices, faces } = makePrimitiveGeometry(kind, { segments: 12 });
  return { vertices, faces };
}

// GPUへ送る前に全頂点と面の参照を検査し、不正データを現在の作品へ反映させない
export function validateMesh(mesh, label) {
  readSceneMesh(mesh, label);
  if (mesh.vertices.length > 20000 || mesh.faces.length > 40000) throw Error(`${label}: 編集上限は頂点20000、面40000です`);
  return mesh;
}

// 面の先頭三頂点から外向き方向を求め、押し出す方向に使う
export function faceNormal(mesh, index) {
  const face = mesh.faces[index];
  if (!face) throw Error("面を選択してください");
  const [a, b, c] = face.map(i => mesh.vertices[i]);
  const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
  return [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
}

// 選択面を法線方向へ押し出し、元の面を先端面と側面へ置き換える
export function extrudeFace(mesh, index, distance) {
  util.readFiniteNumber(distance, "押し出し距離");
  if (distance === 0) throw Error("押し出し距離は0以外を指定してください");
  const face = mesh.faces[index], normal = faceNormal(mesh, index), length = Math.hypot(...normal);
  if (length < 1e-10) throw Error("面の面積が0です");
  const top = face.map(id => {
    const next = mesh.vertices.length;
    mesh.vertices.push(mesh.vertices[id].map((n, i) => n + distance * normal[i] / length));
    return next;
  });
  mesh.faces[index] = top;
  face.forEach((a, i) => {
    const j = (i + 1) % face.length;
    mesh.faces.push([a, face[j], top[j], top[i]]);
  });
}

// 選択面の中心に頂点を加えて三角面へ分割し、共有する境界頂点は保持する
export function subdivideFace(mesh, index) {
  const face = mesh.faces[index];
  if (!face) throw Error("面を選択してください");
  const center = [0, 1, 2].map(axis => face.reduce((sum, id) => sum + mesh.vertices[id][axis], 0) / face.length);
  const id = mesh.vertices.push(center) - 1;
  mesh.faces.splice(index, 1, ...face.map((a, i) => [a, face[(i + 1) % face.length], id]));
}
