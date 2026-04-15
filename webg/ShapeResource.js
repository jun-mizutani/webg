// ---------------------------------------------
// ShapeResource.js  2026/04/15
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { DEFAULT_MAX_SKIN_BONES } from "./SkinningConfig.js";

export default class ShapeResource {
  // 共有可能な mesh / GPU resource 状態だけをまとめて初期化する
  constructor(gpu) {
    // ShapeResource は geometry、GPU buffer、static bounding box を保持する
    // Shape 側の hidden / material差分 / skeleton runtime はここへ置かない
    this.isShapeResource = true;
    this.gpu = gpu;
    this.name = "anonymous";
    this.tx_mode = 0;    // sphere
    this.tx_axis = 0;
    this.tx_su = 1.0;
    this.tx_sv = 1.0;
    this.tx_offu = 0.0;
    this.tx_offv = 0.0;
    this.vertexCount = 0;
    this.positionArray = [];
    this.normalArray = [];
    this.indicesArray = [];
    this.texCoordsArray = [];
    this.altVertices = [];
    this.vertexStride = 8 * Float32Array.BYTES_PER_ELEMENT;
    this.primitiveCount = 0;
    this.vertexBuffer = null;
    this.vertexBuffer0 = null;
    this.vertexBuffer1 = null;
    this.indexBuffer = null;
    this.indexCount = 0;
    this.indexFormat = "uint16";
    this.wireIndexBuffer = null;
    this.wireIndexCount = 0;
    this.wireIndexFormat = "uint16";
    this.wireObj = null;
    this.hasSkeleton = false;
    this.bindex = [];
    this.weight = [];
    this.autoCalcNormals = true;
    this.deferAltVertexSync = false;
    this.box = {
      minx: 1.0E10, maxx: -1.0E10,
      miny: 1.0E10, maxy: -1.0E10,
      minz: 1.0E10, maxz: -1.0E10
    };
    this.debugStageHandler = null;
    this.debugStageLabel = null;
    this.vObj = [];
    this.vObj0 = [];
    this.vObj1 = [];
    this.iObj = [];
    this.maxSkinBones = DEFAULT_MAX_SKIN_BONES;
  }
}
