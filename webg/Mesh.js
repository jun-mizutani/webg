// ---------------------------------------------
//  Mesh.js       2026/03/01
//   for Collada.js
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

export default class Mesh {

  // メッシュコンテナを初期化する
  constructor(frame) {
    // COLLADA由来のメッシュ中間表現
    // 頂点/法線/UV/スキニング情報を保持する
    this.frame = frame;
    this.verts = [];
    this.polygons = [];
    this.texure_cood = [];
    this.joint_names = [];
    this.skinweights = [];
    this.bind_shape_matrix = null;
    this.node_matrix = null;
    this.nMaxSkinWeightsPerVertex = 0;
    this.nMaxSkinWeightsPerFace = 0;
    this.nBones = 0;
    this.hasNormals = false;
    this.normals = [];
    this.materialId = null;
    this.box = {
        minx : 1.0E10, maxx : -1.0E10,
        miny : 1.0E10, maxy : -1.0E10,
        minz : 1.0E10, maxz : -1.0E10
    };
  }

  // 名前を設定する
  setName(name) {
    this.name = name;
  }

  // 名前を返す
  getName() {
    return this.name;
  }

  // 頂点配列を設定する
  setVertices(verts) {
    this.verts = verts;
  }

  // 頂点配列を返す
  getVertices() {
    return this.verts;
  }

  // ポリゴン配列を設定する
  setPolygons(polygons) {
    this.polygons = polygons;
  }

  // ポリゴン配列を返す
  getPolygons() {
    return this.polygons;
  }

  // UV配列を設定する
  setTextureCoord(texure_coord) {
    this.texure_cood = texure_coord;
  }

  // UV配列を返す
  getTextureCoord() {
    return this.texure_cood;
  }

  // スキン重みを設定する
  setSkinWeights(skin_weights) {
    // skin_weights :
    // { {bone_index, weight, bone_index, weight, ..}, .. }
    this.skinweights = skin_weights;
  }

  // スキン重みを返す
  getSkinWeights() {
    return this.skinweights;
  }

  // 法線配列を設定する
  setNormals(normals) {
    this.hasNormals = true;
    this.normals = normals;
  }

  // 法線配列を返す
  getNormals() {
    return this.normals;
  }

  // ジョイント名配列を設定する
  setJointNames(joint_names) {
    this.joint_names = joint_names;
  }

  // ジョイント名配列を返す
  getJointNames() {
    return this.joint_names;
  }

  // バインドポーズ行列を設定する
  setBindPoseMatrices(bindPoseMatrices) {
    this.bindPoseMatrices = bindPoseMatrices;
  }

  // バインドポーズ行列を返す
  getBindPoseMatrices() {
    return this.bindPoseMatrices;
  }

  // Bind Shape Matrixを設定する
  setBindShapeMatrix(bind_shape_matrix) {
    this.bind_shape_matrix = bind_shape_matrix;
  }

  // Bind Shape Matrixを返す
  getBindShapeMatrix() {
    return this.bind_shape_matrix;
  }

  // ノード行列を設定する
  setNodeMatrix(node_matrix) {
    this.node_matrix = node_matrix;
  }

  // ノード行列を返す
  getNodeMatrix() {
    return this.node_matrix;
  }

  // マテリアルIDを設定する
  setMaterialId(id) {
    this.materialId = id;
  }

  // マテリアルIDを返す
  getMaterialId() {
    return this.materialId;
  }

  // バウンディングボックスを更新する
  updateBoundingBox(x, y, z) {
    let box = this.box;
    if (box.minx > x) { box.minx = x; }
    if (box.maxx < x) { box.maxx = x; }
    if (box.miny > y) { box.miny = y; }
    if (box.maxy < y) { box.maxy = y; }
    if (box.minz > z) { box.minz = z; }
    if (box.maxz < z) { box.maxz = z; }
  }

  // 統計を出力する
  printInfo() {
    let verts = this.verts;
    let normals = this.normals;
    let tex_table = this.texure_cood;
    let polygons = this.polygons;
    let joint_names = this.joint_names;
    let skinweights = this.skinweights;
    let bind_shape_matrix = this.bind_shape_matrix;

    util.printf("Mesh:---- %s ----\n", this.name);
    util.printf("vertices    = %d\n", verts.length/3);
    util.printf("normals     = %d\n", normals.length/3);
    for (let m=0; m<tex_table.length; m++) {
      let tex = tex_table[m];
      util.printf("texture     = %d\n", tex.length/2);
    }
    util.printf("polygons    = %d\n", polygons.length);
    if (bind_shape_matrix !== null) {
      util.printf("bind_shape_matrix\n");
      bind_shape_matrix.print();
    }
    util.printf("bone count  = %d\n", joint_names.length);
    for (let n=0; n<joint_names.length; n++) {
      util.printf("[%3d]  %s\n", n, joint_names[n]);
    }

    for (let i=0; i < verts.length/3; i++) {
     this.updateBoundingBox(verts[i*3+1], verts[i*3+2], verts[i*3+3]);
    }
    const box = this.box;
    util.printf(" X:%10.5f -- %10.5f center:%10.5f, size:%10.5f\n",
      box.minx, box.maxx, (box.maxx+box.minx)/2, box.maxx - box.minx);
    util.printf(" Y:%10.5f -- %10.5f center:%10.5f, size:%10.5f\n",
      box.miny, box.maxy, (box.maxy+box.miny)/2, box.maxy - box.miny);
    util.printf(" Z:%10.5f -- %10.5f center:%10.5f, size:%10.5f\n",
      box.minz, box.maxz, (box.maxz+box.minz)/2, box.maxz - box.minz);
  }

};
