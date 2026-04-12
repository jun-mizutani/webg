// ---------------------------------------------
// Billboard.js    2026/03/30
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Matrix from "./Matrix.js";
import BillboardShader from "./BillboardShader.js";

export default class Billboard {
  // ビルボード群を管理する
  constructor(gpu, maxCount = 256) {
    this.gpu = gpu;
    this.maxCount = Math.floor(maxCount);
    this.shader = new BillboardShader(gpu);
    this.texture = null;

    this.instanceStrideFloats = 9;
    this.instanceData = new Float32Array(this.maxCount * this.instanceStrideFloats);
    this.instanceBuffer = null;
    this.vertexBuffer = null;
    this.count = 0;
    this.initialized = false;
  }

  // GPUリソースを作成する
  async init() {
    await this.shader.init();

    const quad = new Float32Array([
      -1.0, -1.0, 0.0, 1.0,
       1.0, -1.0, 1.0, 1.0,
      -1.0,  1.0, 0.0, 0.0,
       1.0,  1.0, 1.0, 0.0
    ]);

    this.vertexBuffer = this.gpu.device.createBuffer({
      size: quad.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.gpu.queue.writeBuffer(this.vertexBuffer, 0, quad);

    this.instanceBuffer = this.gpu.device.createBuffer({
      size: this.instanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });

    this.initialized = true;
    return true;
  }

  // 描画テクスチャを設定する
  setTexture(texture) {
    this.texture = texture;
  }

  // 全体不透明度を設定する
  setOpacity(alpha) {
    this.shader.setOpacity(alpha);
  }

  // 現在フレームのビルボードを消去する
  clear() {
    this.count = 0;
  }

  // 1枚追加する
  addBillboard(x, y, z, sx, sy, color = [1.0, 1.0, 1.0, 1.0]) {
    if (this.count >= this.maxCount) return -1;
    const i = this.count;
    const o = i * this.instanceStrideFloats;
    this.instanceData[o] = x;
    this.instanceData[o + 1] = y;
    this.instanceData[o + 2] = z;
    this.instanceData[o + 3] = sx;
    this.instanceData[o + 4] = sy;
    this.instanceData[o + 5] = color[0];
    this.instanceData[o + 6] = color[1];
    this.instanceData[o + 7] = color[2];
    this.instanceData[o + 8] = color[3];
    this.count++;
    return i;
  }

  // 既存インスタンスの位置を更新する
  setPosition(index, x, y, z) {
    if (index < 0 || index >= this.count) return;
    const o = index * this.instanceStrideFloats;
    this.instanceData[o] = x;
    this.instanceData[o + 1] = y;
    this.instanceData[o + 2] = z;
  }

  // 既存インスタンスのサイズを更新する
  setScale(index, sx, sy) {
    if (index < 0 || index >= this.count) return;
    const o = index * this.instanceStrideFloats;
    this.instanceData[o + 3] = sx;
    this.instanceData[o + 4] = sy;
  }

  // 既存インスタンスの色を更新する
  setColor(index, r, g, b, a) {
    if (index < 0 || index >= this.count) return;
    const o = index * this.instanceStrideFloats;
    this.instanceData[o + 5] = r;
    this.instanceData[o + 6] = g;
    this.instanceData[o + 7] = b;
    this.instanceData[o + 8] = a;
  }

  // カメラ姿勢をシェーダへ設定する
  setCamera(eyeNode, projectionMatrix) {
    eyeNode.setWorldMatrix();
    const view = new Matrix();
    view.makeView(eyeNode.worldMatrix);
    this.shader.setViewMatrix(view);

    if (projectionMatrix) {
      this.shader.setProjectionMatrix(projectionMatrix);
    }

    const m = eyeNode.worldMatrix.mat;
    const right = [m[0], m[1], m[2]];
    const up = [m[4], m[5], m[6]];
    this.shader.setCameraAxes(right, up);
  }

  // 共通描画処理
  // view/projと軸ベクトルを渡してビルボードを描画する
  drawWithAxes(eyeNode, projectionMatrix, right, up) {
    if (!this.initialized || this.count <= 0) return;
    const pass = this.gpu.passEncoder;
    if (!pass) return;

    eyeNode.setWorldMatrix();
    const viewMatrix = new Matrix();
    viewMatrix.makeView(eyeNode.worldMatrix);
    this.shader.setViewMatrix(viewMatrix);
    if (projectionMatrix) {
      this.shader.setProjectionMatrix(projectionMatrix);
    }
    this.shader.setCameraAxes(right, up);

    const view = this.instanceData.subarray(0, this.count * this.instanceStrideFloats);
    this.gpu.queue.writeBuffer(this.instanceBuffer, 0, view.buffer, view.byteOffset, view.byteLength);

    pass.setPipeline(this.shader.pipeline);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setVertexBuffer(1, this.instanceBuffer);
    const bindGroup = this.shader.getBindGroup(this.texture);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4, this.count, 0, 0);
  }

  // 現在のpassに描画する（カメラ向き）
  draw(eyeNode, projectionMatrix) {
    eyeNode.setWorldMatrix();
    const m = eyeNode.worldMatrix.mat;
    const right = [m[0], m[1], m[2]];
    const up = [m[4], m[5], m[6]];
    this.drawWithAxes(eyeNode, projectionMatrix, right, up);
  }

  // 現在のpassに描画する（地面向き）
  // right=[1,0,0], up=[0,0,1] に固定してXZ平面へ寝かせる
  drawGround(eyeNode, projectionMatrix) {
    this.drawWithAxes(eyeNode, projectionMatrix, [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]);
  }
}
