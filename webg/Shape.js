// ---------------------------------------------
// Shape.js        2026/04/20
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import Matrix from "./Matrix.js";
import Wireframe from "./Wireframe.js";
import Tween from "./Tween.js";
import ShapeResource from "./ShapeResource.js";
import { DEFAULT_MAX_SKIN_BONES } from "./SkinningConfig.js";

const wireframeShaderCache = new WeakMap();
const SHARED_RESOURCE_FIELDS = [
  "gpu",
  "name",
  "tx_mode",
  "tx_axis",
  "tx_su",
  "tx_sv",
  "tx_offu",
  "tx_offv",
  "vertexCount",
  "positionArray",
  "normalArray",
  "indicesArray",
  "polygonLoops",
  "texCoordsArray",
  "altVertices",
  "vertexStride",
  "primitiveCount",
  "vertexBuffer",
  "vertexBuffer0",
  "vertexBuffer1",
  "indexBuffer",
  "indexCount",
  "indexFormat",
  "wireIndexBuffer",
  "wireIndexCount",
  "wireIndexFormat",
  "wireObj",
  "hasSkeleton",
  "bindex",
  "weight",
  "autoCalcNormals",
  "deferAltVertexSync",
  "box",
  "debugStageHandler",
  "debugStageLabel",
  "vObj",
  "vObj0",
  "vObj1",
  "iObj",
  "maxSkinBones"
];

function bindSharedResourceFields(instance) {
  for (let i = 0; i < SHARED_RESOURCE_FIELDS.length; i++) {
    const field = SHARED_RESOURCE_FIELDS[i];
    Object.defineProperty(instance, field, {
      configurable: true,
      enumerable: true,
      get() {
        return this.resource[field];
      },
      set(value) {
        this.resource[field] = value;
      }
    });
  }
}

export default class Shape {
  // 頂点配列・材質辞書・描画状態を初期化する
  constructor(gpu) {
    // Shape は instance 層として振る舞い、
    // geometry / GPU buffer / static bounding box は ShapeResource 側へ集約する
    // 引数に ShapeResource を渡すと、その shared resource を参照する instance を作る
    this.resource = gpu?.isShapeResource
      ? gpu
      : gpu?.isShapeInstance
        ? gpu.getResource()
        : new ShapeResource(gpu);
    bindSharedResourceFields(this);
    this.resource?.retainReference?.();
    this.isShapeInstance = true;
    this.isDestroyed = false;
    this.isHidden = false;
    this.shaderParam = {};
    this.materialId = null;
    this.materialParams = {};
    this.parameterTweens = [];
    this.wireframeMode = false;
    this.collisionShape = null;
    this.skeleton = null;
    this.anim = null;
    this.texture = null;
    this.ownerNode = null;
  }

  // 詳細観測用の stage callback を emit する
  emitDebugStage(stage) {
    if (typeof this.debugStageHandler !== "function") {
      return;
    }
    const label = this.debugStageLabel ?? this.name ?? "shape";
    this.debugStageHandler(`shape-${stage} ${label}`);
  }

  // バウンディングボックスを更新する
  updateBoundingBox(x, y, z) {
    const box = this.box;
    if (box.minx > x) box.minx = x;
    if (box.maxx < x) box.maxx = x;
    if (box.miny > y) box.miny = y;
    if (box.maxy < y) box.maxy = y;
    if (box.minz > z) box.minz = z;
    if (box.maxz < z) box.maxz = z;
  }

  // 現在のバウンディングボックスを返す
  getBoundingBox() {
    return this.box;
  }

  // バウンディングボックス情報を出力する
  printBoundingBox() {
    const box = this.box;
    util.printf(" X: %10.5f // %10.5f    center:%10.5f, size:%10.5f\n",
      box.minx, box.maxx, (box.maxx + box.minx) / 2, box.maxx - box.minx);
    util.printf(" Y: %10.5f // %10.5f    center:%10.5f, size:%10.5f\n",
      box.miny, box.maxy, (box.maxy + box.miny) / 2, box.maxy - box.miny);
    util.printf(" Z: %10.5f // %10.5f    center:%10.5f, size:%10.5f\n",
      box.minz, box.maxz, (box.maxz + box.minz) / 2, box.maxz - box.minz);
  }

  // 形状名を設定する
  setName(name) {
    this.name = name;
  }

  // 形状名を返す
  getName() {
    return this.name;
  }

  // 法線自動計算の有効/無効を切り替える
  setAutoCalcNormals(flag) {
    this.autoCalcNormals = flag;
  }

  // 他ShapeのGPUバッファ参照を共有する
  referShape(shape) {
    // 他Shape か ShapeResource が持つ shared resource を参照してメッシュを再利用する
    const resource = shape?.isShapeResource
      ? shape
      : (shape?.resource ?? null);
    if (!resource) {
      return;
    }
    if (this.resource === resource) {
      return;
    }
    this.resource?.releaseReference?.();
    this.resource = resource;
    this.resource?.retainReference?.();
  }

  // 材質パラメータを複製する
  copyShaderParamsFromShape(shape) {
    this.shaderParam = { ...shape.shaderParam };
    this.materialId = shape.materialId ?? null;
    this.materialParams = { ...(shape.materialParams ?? {}) };
    this.shader = shape.shader ?? null;
    this.texture = shape.texture ?? null;
    this.wireframeMode = !!shape.wireframeMode;
  }

  // shared resource を直接返す
  getResource() {
    return this.resource;
  }

  // 同じ resource を参照する新しい instance を返す
  createInstance() {
    const instance = new Shape(this.resource);
    instance.copyShaderParamsFromShape(this);
    instance.isHidden = this.isHidden;
    instance.collisionShape = this.collisionShape ? { ...this.collisionShape } : null;
    return instance;
  }

  // 形状にアニメーション参照を持たせる
  setAnimation(anim) {
    this.anim = anim;
  }

  // 設定済みアニメーションを返す
  getAnimation() {
    return this.anim;
  }

  // 頂点数を返す
  getVertexCount() {
    return this.vertexCount;
  }

  // 三角形数を返す
  getTriangleCount() {
    return this.indexCount / 3;
  }

  // シェーダパラメータ辞書へ登録する
  shaderParameter(key, value) {
    // 描画時にシェーダへ渡すパラメータ(色/ライト/テクスチャ等)を保持する
    this.shaderParam[key] = value;
  }

  // 最小マテリアルAPI:
  // materialId と params を保持しつつ、既存 shaderParameter へ展開する
  setMaterial(materialId, params = {}) {
    this.materialId = materialId ?? null;
    this.materialParams = { ...params };
    if (materialId !== undefined) {
      this.shaderParameter("material_id", this.materialId);
    }
    const keys = Object.keys(this.materialParams);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      this.shaderParameter(key, this.materialParams[key]);
    }
  }

  // 現在マテリアルのパラメータを差分更新する
  updateMaterial(params = {}) {
    const keys = Object.keys(params);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      this.materialParams[key] = params[key];
      this.shaderParameter(key, params[key]);
    }
  }

  // material parameter を時間をかけて変更したいときに使う
  // 数値と配列の両方を扱えるようにし、色や透明度、補助係数をまとめて動かせる
  animateParameter(name, to, options = {}) {
    const key = String(name ?? "").trim();
    if (!key) {
      return null;
    }

    const current = this.materialParams[key] !== undefined
      ? this.materialParams[key]
      : this.shaderParam[key];
    const from = options.from !== undefined
      ? options.from
      : (current !== undefined ? current : (Array.isArray(to) ? to.map(() => 0.0) : 0.0));
    const durationMs = Number.isFinite(options.durationMs) ? Math.max(0, Number(options.durationMs)) : 0;
    const tween = new Tween({ value: Tween.cloneValue(from) }, { value: Tween.cloneValue(to) }, {
      durationMs,
      easing: options.easing ?? "linear",
      onUpdate: (target) => {
        this.updateMaterial({ [key]: Tween.cloneValue(target.value) });
      },
      onComplete: (target) => {
        this.updateMaterial({ [key]: Tween.cloneValue(target.value) });
      }
    });

    const entry = {
      key,
      tween
    };
    if (!tween.isFinished()) {
      if (!this.parameterTweens) {
        this.parameterTweens = [];
      }
      this.parameterTweens.push(entry);
    }
    return entry;
  }

  // animateParameter() で積み上げた補間を 1 frame 進める
  // Space から毎 frame 呼ばれることで、Shape 単体でも演出を持てる
  updateAnimatedParameters(deltaMs = 0) {
    if (!Array.isArray(this.parameterTweens) || this.parameterTweens.length === 0) {
      return 0;
    }
    const active = [];
    for (let i = 0; i < this.parameterTweens.length; i++) {
      const entry = this.parameterTweens[i];
      if (!entry?.tween) continue;
      const finished = entry.tween.update(deltaMs);
      if (!finished) {
        active.push(entry);
      }
    }
    this.parameterTweens = active;
    return active.length;
  }

  // 実行中の parameter animation を消す
  clearAnimatedParameters() {
    this.parameterTweens = [];
  }

  // 参照共有を避けるため copy を返す
  getMaterial() {
    return {
      id: this.materialId,
      params: { ...this.materialParams }
    };
  }

  // 使用シェーダを指定する
  setShader(shader) {
    this.shader = shader;
  }

  // 使用テクスチャを指定する
  setTexture(texture) {
    this.texture = texture;
  }

  // UV生成モードを指定する
  setTextureMappingMode(mode) {
    this.tx_mode = mode;
  }

  // UV生成軸を指定する
  setTextureMappingAxis(axis) {
    this.tx_axis = axis;
  }

  // UVスケールを指定する
  setTextureScale(scale_u, scale_v) {
    this.tx_su = scale_u;
    this.tx_sv = scale_v;
  }

  // ワイヤーフレーム表示をON/OFFする
  setWireframe(flag = true) {
    this.wireframeMode = !!flag;
  }

  // ワイヤーフレーム状態を返す
  isWireframe() {
    return this.wireframeMode;
  }

  // 描画メッシュとは独立した collision shape を設定する
  // shape は { type: "aabb" | "sphere", ... } のような簡易定義を受ける
  setCollisionShape(shape = null) {
    if (shape === null) {
      this.collisionShape = null;
      return null;
    }
    this.collisionShape = {
      ...(shape ?? {})
    };
    if (!this.collisionShape.type) {
      this.collisionShape.type = "aabb";
    }
    return { ...this.collisionShape };
  }

  getCollisionShape() {
    return this.collisionShape ? { ...this.collisionShape } : null;
  }

  // CPU側頂点配列をGPUバッファへ確定転送する（必須）
  endShape() {
    // 頂点配列を最終化し、必要に応じてスキニング情報付きでGPUへ転送する
    this.emitDebugStage("pack-begin");
    if (this.autoCalcNormals) {
      for (let i = 0; i < this.normalArray.length / 3; i++) {
        const j = i * 3;
        const x = this.normalArray[j];
        const y = this.normalArray[j + 1];
        const z = this.normalArray[j + 2];
        const d = Math.sqrt(x * x + y * y + z * z);
        this.normalArray[j] = x / d;
        this.normalArray[j + 1] = y / d;
        this.normalArray[j + 2] = z / d;
      }
    }

    if (this.deferAltVertexSync) {
      // seam の法線共有は、全体の法線を一度整えたあとでまとめて行う
      // こうすると、開始点と終了点の頂点法線が最終状態で同じ向きになりやすい
      this.syncAltVertexNormals(this.normalArray);
      if (this.autoCalcNormals) {
        for (let i = 0; i < this.normalArray.length / 3; i++) {
          const j = i * 3;
          const x = this.normalArray[j];
          const y = this.normalArray[j + 1];
          const z = this.normalArray[j + 2];
          const d = Math.sqrt(x * x + y * y + z * z);
          if (d > 1.0e-8) {
            this.normalArray[j] = x / d;
            this.normalArray[j + 1] = y / d;
            this.normalArray[j + 2] = z / d;
          }
        }
      }
    }

    if (this.hasSkeleton) {
      const maxBoneIndex = this.skeleton?.MAX_BONE ?? DEFAULT_MAX_SKIN_BONES;
      // スキニング有効時は頂点属性を2系統へ分離する:
      //   vObj0 = pos/normal/uv, vObj1 = boneIndex/weight
      this.vertexStride = 16 * Float32Array.BYTES_PER_ELEMENT;
      const buf = new ArrayBuffer(this.vertexCount * this.vertexStride);
      this.vObj = new Float32Array(buf);
      const buf0 = new ArrayBuffer(this.vertexCount * 8 * Float32Array.BYTES_PER_ELEMENT);
      const buf1 = new ArrayBuffer(this.vertexCount * 8 * Float32Array.BYTES_PER_ELEMENT);
      this.vObj0 = new Float32Array(buf0);
      this.vObj1 = new Float32Array(buf1);
      for (let i = 0; i < this.vertexCount; i++) {
        const k = i * 3;
        const j0 = i * 8;
        const j1 = i * 8;
        const j = i * 16;
        this.vObj0[j0] = this.positionArray[k];
        this.vObj0[j0 + 1] = this.positionArray[k + 1];
        this.vObj0[j0 + 2] = this.positionArray[k + 2];
        this.vObj0[j0 + 3] = this.normalArray[k];
        this.vObj0[j0 + 4] = this.normalArray[k + 1];
        this.vObj0[j0 + 5] = this.normalArray[k + 2];
        this.vObj0[j0 + 6] = this.texCoordsArray[i * 2];
        this.vObj0[j0 + 7] = this.texCoordsArray[i * 2 + 1];
        this.vObj[j] = this.vObj0[j0];
        this.vObj[j + 1] = this.vObj0[j0 + 1];
        this.vObj[j + 2] = this.vObj0[j0 + 2];
        this.vObj[j + 3] = this.vObj0[j0 + 3];
        this.vObj[j + 4] = this.vObj0[j0 + 4];
        this.vObj[j + 5] = this.vObj0[j0 + 5];
        this.vObj[j + 6] = this.vObj0[j0 + 6];
        this.vObj[j + 7] = this.vObj0[j0 + 7];

        const boneNumber = this.bindex[i];
        const weight = this.weight[i];
        let n = boneNumber.length;
        let wsum = 0.0;
        for (let k2 = 0; k2 < n; k2++) {
          wsum += weight[k2];
        }
        if (wsum > 0.0 && Math.abs(1.0 - wsum) > 0.0001) {
          for (let k2 = 0; k2 < n; k2++) {
            weight[k2] = weight[k2] / wsum;
          }
        }
        let _default = -1;
        for (let k2 = 0; k2 < n; k2++) {
          if (!Number.isInteger(boneNumber[k2]) || boneNumber[k2] < 0) {
            throw new Error(`Shape.endShape invalid bone index at vertex ${i}: ${boneNumber[k2]}`);
          }
          if (!Number.isFinite(weight[k2])) {
            throw new Error(`Shape.endShape invalid bone weight at vertex ${i}: ${weight[k2]}`);
          }
          if (boneNumber[k2] >= maxBoneIndex) {
            throw new Error(`Shape.endShape bone index out of palette range at vertex ${i}: ${boneNumber[k2]} >= ${maxBoneIndex}`);
          }
          if ((_default < 0) && (boneNumber[k2] < maxBoneIndex)) {
            _default = boneNumber[k2];
          }
          this.vObj1[j1 + k2] = boneNumber[k2];
          this.vObj1[j1 + 4 + k2] = weight[k2];
        }

        if (_default < 0) {
          throw new Error(`Shape.endShape vertex ${i} has no valid bone assignment`);
        }
        if (n < 4) {
          for (let k2 = n; k2 < 4; k2++) {
            this.vObj1[j1 + k2] = 0;
            this.vObj1[j1 + 4 + k2] = 0.0;
          }
        }
        this.vObj[j + 8] = this.vObj1[j1];
        this.vObj[j + 9] = this.vObj1[j1 + 1];
        this.vObj[j + 10] = this.vObj1[j1 + 2];
        this.vObj[j + 11] = this.vObj1[j1 + 3];
        this.vObj[j + 12] = this.vObj1[j1 + 4];
        this.vObj[j + 13] = this.vObj1[j1 + 5];
        this.vObj[j + 14] = this.vObj1[j1 + 6];
        this.vObj[j + 15] = this.vObj1[j1 + 7];
      }
    } else {
      this.vertexStride = 8 * Float32Array.BYTES_PER_ELEMENT;
      const buf = new ArrayBuffer(this.vertexCount * this.vertexStride);
      this.vObj = new Float32Array(buf);
      for (let i = 0; i < this.vertexCount; i++) {
        const j = i * 8;
        const k = i * 3;
        this.vObj[j] = this.positionArray[k];
        this.vObj[j + 1] = this.positionArray[k + 1];
        this.vObj[j + 2] = this.positionArray[k + 2];
        this.vObj[j + 3] = this.normalArray[k];
        this.vObj[j + 4] = this.normalArray[k + 1];
        this.vObj[j + 5] = this.normalArray[k + 2];
        this.vObj[j + 6] = this.texCoordsArray[i * 2];
        this.vObj[j + 7] = this.texCoordsArray[i * 2 + 1];
      }
    }
    this.emitDebugStage(`pack-complete vertices=${this.vertexCount}`);
    // GPUDevice.createBuffer でGPUBuffer を生成する
    const device = this.gpu.device;
    if (this.hasSkeleton) {
      // 
      // VertexBuffer x 3 の作成
      this.emitDebugStage(`create-vertex-buffer size=${this.vObj.byteLength}`);
      this.vertexBuffer = device.createBuffer({
        size: this.vObj.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      this.vertexBuffer0 = device.createBuffer({
        size: this.vObj0.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      this.vertexBuffer1 = device.createBuffer({
        size: this.vObj1.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      // GPUQueue.writeBuffer で頂点データを転送
      this.emitDebugStage(`write-vertex-buffer size=${this.vObj.byteLength}`);
      this.gpu.queue.writeBuffer(this.vertexBuffer, 0, this.vObj);
      this.gpu.queue.writeBuffer(this.vertexBuffer0, 0, this.vObj0);
      this.gpu.queue.writeBuffer(this.vertexBuffer1, 0, this.vObj1);
    } else {
      // ボーンなし
      // VertexBuffer の作成
      this.emitDebugStage(`create-vertex-buffer size=${this.vObj.byteLength}`);
      this.vertexBuffer = device.createBuffer({
        size: this.vObj.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      // GPUQueue.writeBuffer で頂点データを転送
      this.emitDebugStage(`write-vertex-buffer size=${this.vObj.byteLength}`);
      this.gpu.queue.writeBuffer(this.vertexBuffer, 0, this.vObj);
    }

    // IndexBufferの作成
    this.indexCount = this.indicesArray.length;
    let useUint32 = false;
    for (let i = 0; i < this.indicesArray.length; i++) {
      if (this.indicesArray[i] > 65535) {
        useUint32 = true;
        break;
      }
    }

    if (useUint32) {
      this.iObj = new Uint32Array(this.indicesArray);
      this.indexFormat = "uint32";
    } else {
      this.iObj = new Uint16Array(this.indicesArray);
      this.indexFormat = "uint16";
    }
    if (this.iObj.byteLength % 4 !== 0) {
      this.iObj = new Uint32Array(this.indicesArray);
      this.indexFormat = "uint32";
    }
    this.emitDebugStage(`create-index-buffer size=${this.iObj.byteLength}`);
    this.indexBuffer = device.createBuffer({
      size: this.iObj.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    this.emitDebugStage(`write-index-buffer size=${this.iObj.byteLength}`);
    this.gpu.queue.writeBuffer(this.indexBuffer, 0, this.iObj);

    this.emitDebugStage("build-wireframe");
    this._buildWireIndexBuffer();
    this.emitDebugStage(`complete indices=${this.indexCount}`);

    return this.vertexCount;
  }

  _buildWireIndexBuffer() {
    if (!this.gpu?.device) return;
    if (!Array.isArray(this.indicesArray) || this.indicesArray.length < 3) {
      this.wireIndexBuffer = null;
      this.wireIndexCount = 0;
      return;
    }

    const edgeMap = new Map();
    const pushEdge = (a, b) => {
      const i0 = a < b ? a : b;
      const i1 = a < b ? b : a;
      const key = i0 + ":" + i1;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, [i0, i1]);
      }
    };
    if (Array.isArray(this.polygonLoops) && this.polygonLoops.length > 0) {
      for (let i = 0; i < this.polygonLoops.length; i++) {
        const loop = this.polygonLoops[i];
        if (!Array.isArray(loop) || loop.length < 2) continue;
        for (let j = 0; j < loop.length; j++) {
          const a = loop[j];
          const b = loop[(j + 1) % loop.length];
          pushEdge(a, b);
        }
      }
    } else {
      // polygon 情報が無い旧データだけ、従来どおり triangle 辺から線枠を作る
      for (let i = 0; i + 2 < this.indicesArray.length; i += 3) {
        const a = this.indicesArray[i];
        const b = this.indicesArray[i + 1];
        const c = this.indicesArray[i + 2];
        pushEdge(a, b);
        pushEdge(b, c);
        pushEdge(c, a);
      }
    }

    const wireIndices = [];
    for (const edge of edgeMap.values()) {
      wireIndices.push(edge[0], edge[1]);
    }
    if (wireIndices.length < 2) {
      this.wireIndexBuffer = null;
      this.wireIndexCount = 0;
      return;
    }

    let useUint32 = false;
    for (let i = 0; i < wireIndices.length; i++) {
      if (wireIndices[i] > 65535) {
        useUint32 = true;
        break;
      }
    }
    if (useUint32) {
      this.wireObj = new Uint32Array(wireIndices);
      this.wireIndexFormat = "uint32";
    } else {
      this.wireObj = new Uint16Array(wireIndices);
      this.wireIndexFormat = "uint16";
    }
    if (this.wireObj.byteLength % 4 !== 0) {
      this.wireObj = new Uint32Array(wireIndices);
      this.wireIndexFormat = "uint32";
    }

    this.wireIndexCount = wireIndices.length;
    this.wireIndexBuffer = this.gpu.device.createBuffer({
      size: this.wireObj.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    this.gpu.queue.writeBuffer(this.wireIndexBuffer, 0, this.wireObj);
  }

  // GPUバッファ参照を解放する
  releaseObjects() {
    this.resource?.releaseCpuObjects?.();
  }

  // ownerNode からこの instance を外す
  // Node 側に shape 配列が残ると draw/update が古い instance を参照し続けるため、
  // destroy 時は Node 側の一覧も合わせて掃除する
  detachFromOwnerNode() {
    const ownerNode = this.ownerNode;
    if (!ownerNode || !Array.isArray(ownerNode.shapeInstances)) {
      this.ownerNode = null;
      return false;
    }
    for (let i = ownerNode.shapeInstances.length - 1; i >= 0; i--) {
      if (ownerNode.shapeInstances[i] === this) {
        ownerNode.shapeInstances.splice(i, 1);
      }
    }
    ownerNode.shapes = ownerNode.shapeInstances;
    this.ownerNode = null;
    return true;
  }

  // Shape instance の寿命を終わらせる
  // destroyResource=false なら shared resource は残し、instance 側の参照だけを外す
  destroy(options = {}) {
    const destroyResource = options.destroyResource === true;
    const forceResourceDestroy = options.forceResourceDestroy === true;
    if (this.isDestroyed) {
      return true;
    }
    this.clearAnimatedParameters();
    this.detachFromOwnerNode();
    this.isHidden = true;
    this.collisionShape = null;
    this.skeleton = null;
    this.anim = null;
    this.texture = null;
    this.shader = null;
    this.materialId = null;
    this.materialParams = {};
    this.shaderParam = {};
    const resource = this.resource;
    this.resource?.releaseReference?.();
    if (destroyResource && resource) {
      resource.destroy({
        force: forceResourceDestroy
      });
    }
    this.isDestroyed = true;
    return true;
  }

  // スケルトンを関連付ける
  setSkeleton(skeleton) {
    this.skeleton = skeleton;
    if (skeleton) {
      this.hasSkeleton = true;
      this.vertexStride = 16 * Float32Array.BYTES_PER_ELEMENT;
      this.shaderParameter("has_bone", 1);
    }
  }

  // 関連付けスケルトンを返す
  getSkeleton() {
    return this.skeleton;
  }

  // 形状の描画可否を切り替える
  hide(true_or_false) {
    this.isHidden = true_or_false;
  }

  // 現在パスへ形状を描画する
  draw(modelview, normal) {
    // ノード計算済み行列を使ってDrawIndexedを発行する
    if (this.isHidden) return;
    const baseShader = this.shader;
    let shd = baseShader;
    const wireParam = this.shaderParam?.wireframe;
    const useWire = (this.wireframeMode || wireParam === 1 || wireParam === true) && !this.hasSkeleton;
    if (useWire) {
      shd = this._getWireframeShader(baseShader);
      if (!shd) shd = baseShader;
      if (baseShader?.projectionMatrix && shd?.setProjectionMatrix) {
        shd.setProjectionMatrix(baseShader.projectionMatrix);
      }
    }
    const pass = this.gpu.passEncoder;
    if (!shd || !pass) return;
    let bindGroup0Offset = 0;
    if (shd.dynamicOffsetGroup0 && shd.uniformStride) {
      const drawUniformIndex = shd.allocUniformIndex();
      bindGroup0Offset = drawUniformIndex * shd.uniformStride;
      shd.activeUniformIndex = drawUniformIndex;
    } else {
      shd.activeUniformIndex = 0;
    }
    shd.setModelViewMatrix(modelview);
    shd.setNormalMatrix(normal);
 
    if (this.hasSkeleton && this.skeleton && shd.setMatrixPalette) {
      if (!this.skipSkinPaletteUpdate) {
        // スキニング対応 shader には、bone 行列配列そのものだけでなく
        // どの skeleton 用の palette かも渡し、shader 側が skeleton ごとの
        // 専用 bone buffer / bind group を再利用できるようにする
        shd.setMatrixPalette(this.skeleton.updateMatrixPalette(), this.skeleton);
      }
      shd.setHasBone?.(1);
    } else if (shd.setHasBone) {
      // スキニング非対応 shape でも、SmoothShader のような共通 shader を使えるよう、
      // bone 経路は draw ごとに明示的に OFF にする
      shd.setHasBone(0);
    }
    shd.doParameter(this.shaderParam);
    if (this.shaderParam.color !== undefined && shd.setColor) {
      shd.setColor(this.shaderParam.color);
    }

    let pipeline = shd.getPipeline? shd.getPipeline(this.hasSkeleton): shd.pipeline;
    // GPUパイプラインを選択し、以降の drawIndexed で使用する
    pass.setPipeline(pipeline);
    let slot1Set = false;
    if (this.hasSkeleton) {
      if (this.vertexBuffer0 && this.vertexBuffer1) {
        // slot0: 位置/法線/UV, slot1: boneIndex/weight
        pass.setVertexBuffer(0, this.vertexBuffer0);
        pass.setVertexBuffer(1, this.vertexBuffer1);
        slot1Set = true;
      } else if (this.vertexBuffer) {
          if (this.vertexBuffer0) {
            pass.setVertexBuffer(0, this.vertexBuffer0);
          } else {
            pass.setVertexBuffer(0, this.vertexBuffer);
          }
        } else {
          if (this.vertexBuffer0) pass.setVertexBuffer(0, this.vertexBuffer0);
          if (this.vertexBuffer1) {
            pass.setVertexBuffer(1, this.vertexBuffer1);
            slot1Set = true;
        }
      }
    } else {
      pass.setVertexBuffer(0, this.vertexBuffer);
    }
    if (!slot1Set && shd.getDummySkinVertexBuffer) {
      const vb1 = shd.getDummySkinVertexBuffer(this.vertexCount);
      if (vb1) {
        pass.setVertexBuffer(1, vb1);
        slot1Set = true;
      }
    }

    const indexBuffer = (useWire && this.wireIndexBuffer) ? this.wireIndexBuffer : this.indexBuffer;
    const fmt = (useWire && this.wireIndexBuffer) ? (this.wireIndexFormat ?? "uint16") : (this.indexFormat ?? "uint16");
    // GPUインデックスバッファを設定
    pass.setIndexBuffer(indexBuffer, fmt);
    
    const texture = this.shaderParam.texture ?? shd.change?.texture ?? this.texture;
    const useTexture = Number(this.shaderParam?.use_texture ?? shd.default?.use_texture ?? 0) !== 0;
    const textureForBinding = texture ?? (!useTexture ? (shd.defaultTextureResource ?? shd.defaultTexture) : null);
    if (shd.getBindGroup) {
      let bindGroup = null;
        if (this.forceUniformWrite === true && shd.uniformBuffer && shd.uniformData) {
          shd.gpu.queue.writeBuffer(
            shd.uniformBuffer,
            bindGroup0Offset,
            shd.uniformData.buffer,
            0,
            shd.uniformData.byteLength
          );
        }
        const forceRebind = this.forceRebind === true;
        if (forceRebind && shd.device && shd.bindGroupLayout) {
          const view = textureForBinding?.getView?.()
            ?? textureForBinding?.view
            ?? textureForBinding?.createView?.();
          const sampler = textureForBinding?.getSampler?.() ?? textureForBinding?.sampler;
          const swapBindings = this.forceSwapBindings === true;
          const binding0 = swapBindings
            ? { binding: 0, resource: { buffer: shd.boneBuffer } }
            : { binding: 0, resource: { buffer: shd.uniformBuffer, size: shd.uniformData.byteLength } };
          const binding3 = swapBindings
            ? { binding: 3, resource: { buffer: shd.uniformBuffer, size: shd.uniformData.byteLength } }
            : { binding: 3, resource: { buffer: shd.boneBuffer } };
          bindGroup = shd.device.createBindGroup({
            layout: shd.bindGroupLayout,
            entries: [
              binding0,
              { binding: 1, resource: view },
              { binding: 2, resource: sampler },
              binding3
            ]
          });
        } else {
          bindGroup = shd.getBindGroup(textureForBinding);
        }
          if (shd.dynamicOffsetGroup0 && shd.uniformStride) {
            // group(0) に uniform/texture/sampler をバインドdynamic offset で描画単位を切替える
            pass.setBindGroup(0, bindGroup, [bindGroup0Offset]);
          } else {
            // dynamic offset なしの通常バインド
            pass.setBindGroup(0, bindGroup);
          }
    }
    if (shd.getBindGroup1) {
      const bindGroup1 = shd.getBindGroup1(textureForBinding);
      if (bindGroup1) {
        pass.setBindGroup(1, bindGroup1);
      }
    }
    if (shd.getBindGroup2) {
      const bindGroup2 = shd.getBindGroup2(this.skeleton ?? null);
      if (bindGroup2) {
        pass.setBindGroup(2, bindGroup2);
      }
    }
    const indexCount = (useWire && this.wireIndexBuffer) ? this.wireIndexCount : (this.primitiveCount * 3);
    if (indexCount <= 0 || !indexBuffer) return;
    // GPUドローコール実行
    pass.drawIndexed(indexCount, 1, 0, 0, 0);
  }

  _getWireframeShader(baseShader) {
    if (!this.gpu?.device) return null;
    if (wireframeShaderCache.has(this.gpu)) {
      return wireframeShaderCache.get(this.gpu);
    }
    const shd = new Wireframe(this.gpu);
    shd.device = this.gpu.device;
    shd.createResources();
    if (baseShader?.projectionMatrix && shd.setProjectionMatrix) {
      shd.setProjectionMatrix(baseShader.projectionMatrix);
    }
    wireframeShaderCache.set(this.gpu, shd);
    return shd;
  }

  // 直前頂点を上書きする
  setVertex(x, y, z) {
    this.positionArray.push(x, y, z);
    this.normalArray.push(0, 0, 0);
    this.vertexCount++;
    if (this.hasSkeleton) {
      this.bindex.push([]);
      this.weight.push([]);
    }
    this.updateBoundingBox(x, y, z);
    return this.vertexCount;
  }

  // 頂点を追加する
  addVertex(x, y, z) {
    const vcount = this.setVertex(x, y, z);
    this.calcUV(x, y, z);
    return vcount;
  }

  // UV付き頂点を追加する
  addVertexUV(x, y, z, u, v) {
    const vcount = this.setVertex(x, y, z);
    this.texCoordsArray.push(u, v);
    return vcount;
  }

  // 配列入力で頂点+UVを追加する
  addVertexPosUV(pos, uv) {
    const vcount = this.setVertex(...pos);
    this.texCoordsArray.push(...uv);
    return vcount;
  }

  // 指定頂点の法線を設定する
  setVertNormal(vn, x, y, z) {
    this.normalArray[vn * 3] = x;
    this.normalArray[vn * 3 + 1] = y;
    this.normalArray[vn * 3 + 2] = z;
  }

  // 指定頂点の法線を返す
  getVertNormal(vn) {
    return [
      this.normalArray[vn * 3],
      this.normalArray[vn * 3 + 1],
      this.normalArray[vn * 3 + 2]
    ];
  }

  // 指定頂点の座標を返す
  getVertPosition(vn) {
    return [
      this.positionArray[vn * 3],
      this.positionArray[vn * 3 + 1],
      this.positionArray[vn * 3 + 2]
    ];
  }

  // 頂点にボーン重みを追加する
  addVertexWeight(vn, ind, wt) {
    if (!this.hasSkeleton) return;
    if (!this.bindex[vn]) {
      util.printf("this.bindex = %d\n", this.bindex.length);
      util.printf("addVertexWeight[%d] is null\n", vn);
      return;
    }
    if (this.bindex[vn].length < 4) {
      this.bindex[vn].push(ind);
      this.weight[vn].push(wt);
    } else {
      util.printf("#bindex[%d]:%d, bone[%d], weight:%f\n",
        this.bindex[vn].length, vn, ind, wt);
    }
  }

  // 同一座標頂点の共有可否を判定する
  checkAltVertex(p) {
    for (let i = 0; i < this.altVertices.length / 2; i++) {
      if (p === this.altVertices[i * 2]) {
        return this.altVertices[i * 2 + 1];
      }
    }
    return -1;
  }

  // altVertices でつながる頂点群ごとに法線を合算して共有する
  syncAltVertexNormals(normals = this.normalArray) {
    if (!this.altVertices || this.altVertices.length === 0) {
      return;
    }

    const parent = new Map();
    const touch = (index) => {
      if (!parent.has(index)) {
        parent.set(index, index);
      }
    };
    const find = (index) => {
      let root = parent.get(index);
      while (root !== parent.get(root)) {
        root = parent.get(root);
      }
      let current = index;
      while (current !== root) {
        const next = parent.get(current);
        parent.set(current, root);
        current = next;
      }
      return root;
    };
    const unite = (a, b) => {
      touch(a);
      touch(b);
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) {
        parent.set(rb, ra);
      }
    };

    for (let i = 0; i < this.altVertices.length; i += 2) {
      unite(this.altVertices[i], this.altVertices[i + 1]);
    }

    const sums = new Map();
    for (const index of parent.keys()) {
      const root = find(index);
      const base = index * 3;
      const current = sums.get(root) ?? [0.0, 0.0, 0.0];
      current[0] += normals[base];
      current[1] += normals[base + 1];
      current[2] += normals[base + 2];
      sums.set(root, current);
    }

    for (const index of parent.keys()) {
      const root = find(index);
      const base = index * 3;
      const sum = sums.get(root);
      normals[base] = sum[0];
      normals[base + 1] = sum[1];
      normals[base + 2] = sum[2];
    }
  }

  // 三角形インデックスを追加する
  addTriangle(p0, p1, p2) {
    let p1_new = p1;
    let p2_new = p2;

    const pa = p0 * 3;
    const pb = p1 * 3;
    const pc = p2 * 3;
    const x0 = this.positionArray[pa];
    const y0 = this.positionArray[pa + 1];
    const z0 = this.positionArray[pa + 2];
    const x1 = this.positionArray[pb];
    const y1 = this.positionArray[pb + 1];
    const z1 = this.positionArray[pb + 2];
    const x2 = this.positionArray[pc];
    const y2 = this.positionArray[pc + 1];
    const z2 = this.positionArray[pc + 2];

    let u0 = this.texCoordsArray[p0 * 2];
    let v0 = this.texCoordsArray[p0 * 2 + 1];
    let u1 = this.texCoordsArray[p1 * 2];
    let v1 = this.texCoordsArray[p1 * 2 + 1];
    let u2 = this.texCoordsArray[p2 * 2];
    let v2 = this.texCoordsArray[p2 * 2 + 1];

    if ((this.tx_mode === 0) && (Math.abs(u1 - u0) > 0.5)) {
      if (u1 < u0) u1 += 1; else u1 -= 1;
      const np = this.checkAltVertex(p1);
      if (np < 0) {
        p1_new = this.addVertexPosUV(this.getVertPosition(p1), [u1, v1]) - 1;
        // UV seam 用に複製した頂点でも、元頂点と同じ法線を引き継ぐ
        // manual normal を使う shape ではここを省くと複製頂点だけ normal が 0 のまま残り、
        // seam 近傍の面だけ暗く崩れて見える
        this.setVertNormal(p1_new, ...this.getVertNormal(p1));
        if (this.hasSkeleton) {
          this.bindex[p1_new] = this.bindex[p1];
          this.weight[p1_new] = this.weight[p1];
        }
        this.altVertices.push(p1, p1_new);
      } else {
        p1_new = np;
      }
    }
    if ((this.tx_mode === 0) && (Math.abs(u2 - u1) > 0.5)) {
      if (u2 < u1) u2 += 1; else u2 -= 1;
      const np = this.checkAltVertex(p2);
      if (np < 0) {
        p2_new = this.addVertexPosUV(this.getVertPosition(p2), [u2, v2]) - 1;
        // p1 と同様に、seam 複製頂点へ元の法線をそのまま写す
        this.setVertNormal(p2_new, ...this.getVertNormal(p2));
        if (this.hasSkeleton) {
          this.bindex[p2_new] = this.bindex[p2];
          this.weight[p2_new] = this.weight[p2];
        }
        this.altVertices.push(p2, p2_new);
      } else {
        p2_new = np;
      }
    }
    this.indicesArray.push(p0, p1_new, p2_new);

    if (this.autoCalcNormals) {
      // Use cross product of (p1 - p0) and (p2 - p0) to compute triangle normal
      const ux = x1 - x0;
      const uy = y1 - y0;
      const uz = z1 - z0;
      const vx = x2 - x0;
      const vy = y2 - y0;
      const vz = z2 - z0;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      this.normalArray[pa] += nx;
      this.normalArray[pa + 1] += ny;
      this.normalArray[pa + 2] += nz;
      this.normalArray[pb] += nx;
      this.normalArray[pb + 1] += ny;
      this.normalArray[pb + 2] += nz;
      this.normalArray[pc] += nx;
      this.normalArray[pc + 1] += ny;
      this.normalArray[pc + 2] += nz;
    }
    if (!this.deferAltVertexSync) {
      this.syncAltVertexNormals(this.normalArray);
    }
    this.primitiveCount++;
  }

  // 多角形を追加する
  // 描画本体は扇形三角形へ分解するが、
  // wireframe 用には元の辺ループも保持し、三角形の対角線が見えないようにする
  addPolygon(indices) {
    if (!Array.isArray(indices) || indices.length < 3) {
      return;
    }
    this.polygonLoops.push([...indices]);
    for (let i = 0; i < indices.length - 2; i++) {
      this.addTriangle(indices[0], indices[i + 1], indices[i + 2]);
    }
  }

  // 既存 API 名は維持しつつ、内部では addPolygon() へ委譲する
  addPlane(indices) {
    this.addPolygon(indices);
  }

  // 現在設定に基づくUVを計算する
  calcUV(x, y, z) {
    let u = 0;
    let v = 0;
    const PI = Math.PI;

    switch (this.tx_mode) {
      case 0:
        switch (this.tx_axis) {
          case 0:
          case 1:
            u = Math.atan2(-z, x);
            v = Math.atan2(Math.sqrt(x * x + z * z), y);
            break;
          case -1:
            u = Math.atan2(z, x);
            v = Math.atan2(Math.sqrt(x * x + z * z), -y);
            break;
          case 2:
            u = Math.atan2(-z, y);
            v = Math.atan2(Math.sqrt(y * y + z * z), x);
            break;
          case -2:
            u = Math.atan2(z, y);
            v = Math.atan2(Math.sqrt(y * y + z * z), -x);
            break;
          case 3:
            u = Math.atan2(y, x);
            v = Math.atan2(Math.sqrt(x * x + y * y), z);
            break;
          case -3:
            u = Math.atan2(-y, x);
            v = Math.atan2(Math.sqrt(x * x + y * y), -z);
            break;
          default:
            break;
        }
        if (u < 0.0) u += PI * 2;
        u = u / (PI * 2);
        v = 1 - v / PI;
        break;

      case 1:
        switch (this.tx_axis) {
          case 0:
          case 1:
            u = x / this.tx_su + this.tx_offu;
            v = y / this.tx_sv + this.tx_offv;
            break;
          case -1:
            u = -(x / this.tx_su + this.tx_offu);
            v = y / this.tx_sv + this.tx_offv;
            break;
          case 2:
            u = z / this.tx_su + this.tx_offu;
            v = y / this.tx_sv + this.tx_offv;
            break;
          case -2:
            u = -(z / this.tx_su + this.tx_offu);
            v = y / this.tx_sv + this.tx_offv;
            break;
          case 3:
            u = x / this.tx_su + this.tx_offu;
            v = -(z / this.tx_sv + this.tx_offv);
            break;
          case -3:
            u = -(x / this.tx_su + this.tx_offu);
            v = -(z / this.tx_sv + this.tx_offv);
            break;
          default:
            break;
        }
        break;
      default:
        break;
    }
    this.texCoordsArray.push(u, v);
  }

  // 現在の mapping 状態を Primitive へ渡せる形へまとめる
  getPrimitiveOptions() {
    return {
      txMode: this.tx_mode,
      txAxis: this.tx_axis,
      txScaleU: this.tx_su,
      txScaleV: this.tx_sv,
      txOffU: this.tx_offu,
      txOffV: this.tx_offv
    };
  }

  // Primitive が返した ModelAsset から geometry 部分だけを読み込む
  applyPrimitiveAsset(asset) {
    // 既存の Shape API 互換を維持するため、
    // Primitive -> ModelAsset で生成した geometry を現在の Shape へ転写する
    const data = asset.getData();
    const mesh = data?.meshes?.[0];
    const geometry = mesh?.geometry;
    if (!geometry) {
      throw new Error("Primitive asset does not contain geometry");
    }

    this.vertexCount = geometry.vertexCount ?? Math.floor((geometry.positions?.length ?? 0) / 3);
    this.primitiveCount = geometry.polygonCount ?? Math.floor((geometry.indices?.length ?? 0) / 3);
    this.positionArray = [...(geometry.positions ?? [])];
    this.indicesArray = [...(geometry.indices ?? [])];
    this.polygonLoops = geometry.polygonLoops
      ? geometry.polygonLoops.map((loop) => [...loop])
      : [];
    this.texCoordsArray = geometry.uvs
      ? [...geometry.uvs]
      : new Array(this.vertexCount * 2).fill(0);
    this.normalArray = geometry.normals
      ? [...geometry.normals]
      : new Array(this.vertexCount * 3).fill(0);
    this.altVertices = geometry.altVertices
      ? [...geometry.altVertices]
      : [];
    this.hasSkeleton = false;
    this.skeleton = null;
    this.bindex = [];
    this.weight = [];
    this.autoCalcNormals = !geometry.normals;
    this.box = {
      minx: 1.0E10, maxx: -1.0E10,
      miny: 1.0E10, maxy: -1.0E10,
      minz: 1.0E10, maxz: -1.0E10
    };

    for (let i = 0; i < this.positionArray.length; i += 3) {
      this.updateBoundingBox(
        this.positionArray[i],
        this.positionArray[i + 1],
        this.positionArray[i + 2]
      );
    }

    // 旧 Shape 実装では addTriangle() が面法線を各頂点へ加算していた
    // Primitive 経由では positions / indices を一括ロードするため、
    // 法線未指定時はここで同等の加算処理を行ってから endShape() に渡す
    if (!geometry.normals && this.autoCalcNormals) {
      this.accumulatePrimitiveNormals();
    }
  }

  // Primitive から取り込んだ三角形配列をもとに頂点法線を加算する
  accumulatePrimitiveNormals() {
    for (let i = 0; i < this.indicesArray.length; i += 3) {
      const p0 = this.indicesArray[i];
      const p1 = this.indicesArray[i + 1];
      const p2 = this.indicesArray[i + 2];
      const pa = p0 * 3;
      const pb = p1 * 3;
      const pc = p2 * 3;

      const x0 = this.positionArray[pa];
      const y0 = this.positionArray[pa + 1];
      const z0 = this.positionArray[pa + 2];
      const x1 = this.positionArray[pb];
      const y1 = this.positionArray[pb + 1];
      const z1 = this.positionArray[pb + 2];
      const x2 = this.positionArray[pc];
      const y2 = this.positionArray[pc + 1];
      const z2 = this.positionArray[pc + 2];

      const ux = x1 - x0;
      const uy = y1 - y0;
      const uz = z1 - z0;
      const vx = x2 - x0;
      const vy = y2 - y0;
      const vz = z2 - z0;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;

      this.normalArray[pa] += nx;
      this.normalArray[pa + 1] += ny;
      this.normalArray[pa + 2] += nz;
      this.normalArray[pb] += nx;
      this.normalArray[pb + 1] += ny;
      this.normalArray[pb + 2] += nz;
      this.normalArray[pc] += nx;
      this.normalArray[pc + 1] += ny;
      this.normalArray[pc + 2] += nz;
    }

    // UV seam やドーナツ断面の閉じ目のように、同一点が複数頂点へ分かれている場合は
    // 連結している頂点群全体の法線寄与をまとめて共有する
    this.syncAltVertexNormals(this.normalArray);
  }

  // 指定頂点情報を出力する
  listVertex(vn) {
    let size = 8;
    const v = this.hasSkeleton ? this.vObj0 : this.vObj;
    const v1 = this.hasSkeleton ? this.vObj1 : null;
    if (this.hasSkeleton) size = 8;
    const j = vn * size;
    util.printf("Vertex No.: %d\n", vn);
    util.printf("  Position x : %12.9f,  y : %12.9f,  z : %12.9f\n", v[j], v[j + 1], v[j + 2]);
    util.printf("  Normal   x : %12.9f,  y : %12.9f,  z : %12.9f\n", v[j + 3], v[j + 4], v[j + 5]);
    util.printf("  Texture  u : %12.9f,  v : %12.9f\n", v[j + 6], v[j + 7]);

    if (this.hasSkeleton) {
      let sum_weights = 0;
      let wcount = 0;
      for (let i = 4; i <= 7; i++) {
        sum_weights += v1[j + i];
        if (v1[j + i] > 0.00001) wcount++;
      }
      util.printf("  [1] index = %12.9f,  weight = %12.9f\n", v1[j + 0], v1[j + 4]);
      util.printf("  [2] index = %12.9f,  weight = %12.9f\n", v1[j + 1], v1[j + 5]);
      util.printf("  [3] index = %12.9f,  weight = %12.9f\n", v1[j + 2], v1[j + 6]);
      util.printf("  [4] index = %12.9f,  weight = %12.9f\n", v1[j + 3], v1[j + 7]);
      if ((sum_weights < 0.95) || (sum_weights > 1.05)) {
        util.printf(">>");
      }
      util.printf(" [%d] sum of weights(%d)  -->  %12.9f\n", vn, wcount, sum_weights);
    }
  }

  // 全頂点情報を出力する
  listVertexAll() {
    for (let i = 0; i < this.vertexCount; i++) {
      this.listVertex(i);
    }
    if (this.hasSkeleton && this.skeleton) {
      this.skeleton.updateMatrixPalette();
      for (let i = 0; i < this.skeleton.boneOrder.length; i++) {
        util.printf("  bone : %s\n", this.skeleton.boneOrder[i].name);
        const n = i * 12;
        const pal = this.skeleton.matrixPalette;
        const fmt = "% 16.14f % 16.14f % 16.14f % 16.14f\n";
        for (let j = 0; j <= 2; j++) {
          const k = n + j * 4;
          util.printf(fmt, pal[k], pal[k + 1], pal[k + 2], pal[k + 3]);
        }
      }
    }
  }

  // 頂点統計を出力する
  printVertex() {
    const p = (format, n, value) => {
      util.printf(format, n, ...value);
    };
    const ptab3 = (title, tab) => {
      util.printf("Count: %d\n", tab.length);
      for (let i = 0; i < tab.length; i++) {
        p(title + "(%3d) %12f  %12f  %12f  \n", i, tab[i]);
      }
    };
    const ptab2 = (title, tab) => {
      util.printf("Count: %d\n", tab.length);
      for (let i = 0; i < tab.length; i++) {
        p(title + "(%3d) %12f  %12f   \n", i, tab[i]);
      }
    };

    ptab3("position: ", this.positionArray);
    ptab3("normal  : ", this.normalArray);
    ptab2("texture : ", this.texCoordsArray);
    ptab3("index   : ", this.indicesArray);
  }
}
