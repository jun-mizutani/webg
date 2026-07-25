// ---------------------------------------------
// ShapeResource.js  2026/04/20
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
    this.polygonLoops = [];
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
    this.refCount = 0;
    this.isDestroyed = false;
  }

  // Shape instance が shared resource を参照し始めた回数を記録する
  // ShapeResource は複数 instance で共有されるので、GPUBuffer を安全に破棄するには参照数が必要
  retainReference() {
    console.assert(!this.isDestroyed, "ShapeResource.retainReference() requires a live resource");
    if (this.isDestroyed) {
      return this.refCount;
    }
    this.refCount += 1;
    return this.refCount;
  }

  // Shape instance が shared resource の参照を手放した回数を記録する
  // 0 未満は二重 release を意味するため assert で検出する
  releaseReference() {
    console.assert(this.refCount > 0, "ShapeResource.releaseReference() requires a positive refCount");
    if (this.refCount <= 0) {
      return 0;
    }
    this.refCount -= 1;
    return this.refCount;
  }

  // CPU 側の頂点配列と補助配列を空にする
  // GPUBuffer を残したまま builder 用の一時配列だけ外したい場面でも使える
  releaseCpuObjects() {
    this.positionArray = [];
    this.normalArray = [];
    this.indicesArray = [];
    this.polygonLoops = [];
    this.texCoordsArray = [];
    this.altVertices = [];
    this.vObj = [];
    this.vObj0 = [];
    this.vObj1 = [];
    this.iObj = [];
    this.wireObj = [];
    this.bindex = [];
    this.weight = [];
  }

  // GPU 側の頂点/索引バッファを明示的に破棄する
  // WebGPU は不要 GPUBuffer を destroy() で手放せるので、
  // runtime 差し替え時にブラウザ任せへせず明示的に寿命を切る
  destroyGpuBuffers() {
    const bufferFields = [
      "vertexBuffer",
      "vertexBuffer0",
      "vertexBuffer1",
      "indexBuffer",
      "wireIndexBuffer"
    ];
    for (let i = 0; i < bufferFields.length; i++) {
      const field = bufferFields[i];
      const buffer = this[field];
      if (buffer && typeof buffer.destroy === "function") {
        buffer.destroy();
      }
      this[field] = null;
    }
    this.indexCount = 0;
    this.wireIndexCount = 0;
  }

  // shared resource 全体を破棄する
  // force=false ではまだ参照中の Shape instance が残っていないことを確認してから破棄する
  destroy(options = {}) {
    const force = options.force === true;
    if (this.isDestroyed) {
      return true;
    }
    console.assert(
      force || this.refCount === 0,
      "ShapeResource.destroy() requires refCount === 0 unless force=true"
    );
    if (!force && this.refCount !== 0) {
      return false;
    }
    this.destroyGpuBuffers();
    this.releaseCpuObjects();
    this.vertexCount = 0;
    this.primitiveCount = 0;
    this.vertexStride = 8 * Float32Array.BYTES_PER_ELEMENT;
    this.box = {
      minx: 1.0E10, maxx: -1.0E10,
      miny: 1.0E10, maxy: -1.0E10,
      minz: 1.0E10, maxz: -1.0E10
    };
    this.debugStageHandler = null;
    this.debugStageLabel = null;
    this.deferAltVertexSync = false;
    this.isDestroyed = true;
    this.refCount = 0;
    return true;
  }
}
