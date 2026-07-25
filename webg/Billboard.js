// ---------------------------------------------
// Billboard.js    2026/07/13
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import BillboardShader from "./BillboardShader.js";
import { createCameraTransformFrameFromEye } from "./CameraFrame.js";
import util from "./util.js";

// 完全なrender frameはそのまま共有し、低レベルAPIのeye Nodeだけ内部snapshotへ変換します
function resolveCameraTransform(cameraOrFrame, label) {
  if (
    cameraOrFrame
    && typeof cameraOrFrame.worldPointToCameraRelative === "function"
    && cameraOrFrame.viewRotationMatrix
    && cameraOrFrame.cameraWorldMatrix
  ) {
    return cameraOrFrame;
  }
  return createCameraTransformFrameFromEye(cameraOrFrame, label);
}

export default class Billboard {
  // ビルボード群を管理する
  constructor(gpu, maxCount = 256) {
    this.gpu = gpu;
    this.maxCount = Math.floor(maxCount);
    this.shader = new BillboardShader(gpu);
    this.texture = null;

    this.instanceStrideFloats = 9;
    this.instanceData = new Float32Array(this.maxCount * this.instanceStrideFloats);
    // World位置はJavaScript Numberのまま保持し、draw直前にカメラ位置との差を計算します
    // 巨大World値を先にfloat32 instanceDataへ書くと、小さい相対差が失われるため分離します
    this.worldPositionData = new Array(this.maxCount * 3).fill(0.0);
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
    const p = i * 3;
    this.worldPositionData[p] = util.readFiniteNumber(x, "Billboard x");
    this.worldPositionData[p + 1] = util.readFiniteNumber(y, "Billboard y");
    this.worldPositionData[p + 2] = util.readFiniteNumber(z, "Billboard z");
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
    const p = index * 3;
    this.worldPositionData[p] = util.readFiniteNumber(x, "Billboard x");
    this.worldPositionData[p + 1] = util.readFiniteNumber(y, "Billboard y");
    this.worldPositionData[p + 2] = util.readFiniteNumber(z, "Billboard z");
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
  setCamera(cameraOrFrame, projectionMatrix) {
    const cameraFrame = resolveCameraTransform(cameraOrFrame, "Billboard.setCamera");
    this.shader.setViewMatrix(cameraFrame.viewRotationMatrix);

    if (projectionMatrix) {
      this.shader.setProjectionMatrix(projectionMatrix);
    }

    const m = cameraFrame.cameraWorldMatrix.mat;
    const right = [m[0], m[1], m[2]];
    const up = [m[4], m[5], m[6]];
    this.shader.setCameraAxes(right, up);
  }

  // 共通描画処理
  // view/projと軸ベクトルを渡してビルボードを描画する
  drawWithAxes(cameraOrFrame, projectionMatrix, right, up) {
    const cameraFrame = resolveCameraTransform(cameraOrFrame, "Billboard.drawWithAxes");
    return this.drawResolved(cameraFrame, projectionMatrix, right, up);
  }

  // camera-relative化済みframeを使い、World位置を小さいfloat32 instance座標へ変換して描画します
  drawResolved(cameraFrame, projectionMatrix, right, up) {
    if (!this.initialized || this.count <= 0) return;
    const pass = this.gpu.passEncoder;
    if (!pass) return;

    this.shader.setViewMatrix(cameraFrame.viewRotationMatrix);
    if (projectionMatrix) {
      this.shader.setProjectionMatrix(projectionMatrix);
    }
    this.shader.setCameraAxes(right, up);

    // 倍精度World位置からカメラWorld位置を先に減算し、小さくなった値だけをfloat32へ書きます
    for (let i = 0; i < this.count; i += 1) {
      const p = i * 3;
      const o = i * this.instanceStrideFloats;
      const relative = cameraFrame.worldPointToCameraRelative([
        this.worldPositionData[p],
        this.worldPositionData[p + 1],
        this.worldPositionData[p + 2]
      ]);
      this.instanceData[o] = relative[0];
      this.instanceData[o + 1] = relative[1];
      this.instanceData[o + 2] = relative[2];
    }

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
  draw(cameraOrFrame, projectionMatrix) {
    const cameraFrame = resolveCameraTransform(cameraOrFrame, "Billboard.draw");
    const m = cameraFrame.cameraWorldMatrix.mat;
    const right = [m[0], m[1], m[2]];
    const up = [m[4], m[5], m[6]];
    this.drawResolved(cameraFrame, projectionMatrix, right, up);
  }

  // 現在のpassに描画する（地面向き）
  // right=[1,0,0], up=[0,0,1] に固定してXZ平面へ寝かせる
  drawGround(cameraOrFrame, projectionMatrix) {
    const cameraFrame = resolveCameraTransform(cameraOrFrame, "Billboard.drawGround");
    this.drawResolved(cameraFrame, projectionMatrix, [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]);
  }
}
