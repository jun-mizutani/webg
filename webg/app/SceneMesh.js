// SceneMesh.js 2026/09/18
// SceneYAML内の頂点と面を検証し、表示用Shapeへ渡す
// Copyright (c) 2026 Jun Mizutani, MIT
import util from "../util.js";

// 三角面・四角面の頂点順を維持し、扇形分割で面積0になる入力を拒否する
// 法線とUVの明示入力は初版の対象外で、未知の項目は読み飛ばさない
export function readSceneMesh(value, label = "SceneYAML mesh") {
  const source = util.readPlainObject(value, label);
  for (const key of Object.keys(source)) {
    if (!["id", "vertices", "faces"].includes(key)) throw new Error(`${label}.${key} is not supported`);
  }
  const id = util.readOptionalString(source.id, `${label}.id`, undefined, { trim: true, allowEmpty: false });
  if (!id) throw new Error(`${label}.id is required`);
  if (!Array.isArray(source.vertices) || source.vertices.length < 3) throw new Error(`${label}.vertices requires at least 3 vertices`);
  if (!Array.isArray(source.faces) || source.faces.length < 1) throw new Error(`${label}.faces requires at least one face`);
  const vertices = source.vertices.map((value, index) => {
    if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label}.vertices[${index}] requires XYZ`);
    return value.map((n, axis) => util.readFiniteNumber(n, `${label}.vertices[${index}][${axis}]`));
  });
  const faces = source.faces.map((value, index) => {
    const faceLabel = `${label}.faces[${index}]`;
    if (!Array.isArray(value) || ![3, 4].includes(value.length)) throw new Error(`${faceLabel} requires 3 or 4 indices`);
    const face = value.map(n => util.readFiniteNumber(n, faceLabel, { integer: true, min: 0, max: vertices.length - 1 }));
    if (new Set(face).size !== face.length) throw new Error(`${faceLabel} contains repeated indices`);
    for (let i = 1; i < face.length - 1; i++) {
      const a = vertices[face[0]], b = vertices[face[i]], c = vertices[face[i + 1]];
      const u = b.map((n, j) => n - a[j]), v = c.map((n, j) => n - a[j]);
      const area = Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]);
      if (!Number.isFinite(area) || area === 0) throw new Error(`${faceLabel} has a degenerate or non-finite triangle`);
    }
    return face;
  });
  return { id, vertices, faces };
}

// ID参照を解決できる表を生成し、未使用の定義も含めて全メッシュを検証する
export function readSceneMeshes(value, label = "SceneYAML meshes") {
  if (value === undefined) return new Map();
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const meshes = new Map();
  value.forEach((item, index) => {
    const mesh = readSceneMesh(item, `${label}[${index}]`);
    if (meshes.has(mesh.id)) throw new Error(`${label} has duplicated id: ${mesh.id}`);
    meshes.set(mesh.id, mesh);
  });
  return meshes;
}

// 検証済みの頂点と面を既存Shapeへ追加する。GPU確定とマテリアル設定は呼出元で行う
// UVは未指定であることを表す0に統一し、法線生成は既存Shapeの処理を利用する
export function appendSceneMesh(shape, mesh, flatShading = false) {
  const indices = new Map();
  let nextIndex = 0;
  // 使われる頂点だけを転送し、未使用頂点の法線が0になることを防ぐ
  // flatShadingでは面間で頂点を分け、PBRでも面ごとの法線を維持する
  for (const face of mesh.faces) {
    const polygon = face.map(index => {
      if (!flatShading && indices.has(index)) return indices.get(index);
      const added = nextIndex++;
      shape.addVertexUV(...mesh.vertices[index], 0, 0);
      if (!flatShading) indices.set(index, added);
      return added;
    });
    shape.addPolygon(polygon);
  }
}
