// ComputeParticleEmitter.js 2026/09/22
// 発生要求をまとめて送り、初期値生成・移動・寿命更新をComputeで処理する
import GpuParticleEmitter from "./GpuParticleEmitter.js";
import util from "./util.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import { readComputeParticleSettings, readParticleEmission, readParticleContinuous,
  MAX_PARTICLE_COMMANDS, PARTICLE_PARAM_FLOATS } from "./ComputeParticleSettings.js";
import { COMPUTE_PARTICLE_UPDATE, COMPUTE_PARTICLE_RENDER } from "./ComputeParticleShaders.js";

export default class ComputeParticleEmitter extends GpuParticleEmitter {
  // 設定とGPU容量を先に検証し、固定長bufferを一度だけ確保する
  constructor(gpu, options = {}) {
    const settings = readComputeParticleSettings(options);
    if (!gpu?.device) throw new Error("ComputeParticleEmitter requires a ready GPU");
    const limits = gpu.device.limits;
    if (settings.capacity * 48 > Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize)
      || Math.ceil(settings.capacity / 64) > limits.maxComputeWorkgroupsPerDimension
      || PARTICLE_PARAM_FLOATS * 4 > limits.maxUniformBufferBindingSize) {
      throw new Error("ComputeParticleEmitter exceeds GPU buffer or dispatch limits");
    }
    super(gpu, { label: settings.label, particleCount: settings.capacity, floatsPerParticle: 12,
      initialData: new Float32Array(settings.capacity * 12), paramFloats: PARTICLE_PARAM_FLOATS,
      workgroupSize: 64, coordinateSpace: "camera-relative", depthConvention: CAMERA_REVERSE_Z,
      targetFormat: settings.targetFormat, blendMode: "additive",
      computeCode: COMPUTE_PARTICLE_UPDATE, renderCode: COMPUTE_PARTICLE_RENDER });
    this.settings = settings;
    this.commands = [];
    // CPUには予約スロットの最大寿命だけを残す。座標と速度はGPUが保持する
    this.expiry = new Float64Array(settings.capacity);
    this.cursor = 0;
    this.time = 0;
    this.sequence = 0;
    this.burstCount = 0;
    this.rejectedCount = 0;
    this.paused = false;
    this.timeScale = 1;
    this.continuous = null;
    this.carry = 0;
  }

  // 発生設定を検証して一括予約する。容量不足は返値で明示する
  emit(count, options = {}) {
    this.requireAlive();
    util.readFiniteNumber(count, "particle count", { integer: true, min: 1, max: this.particleCount });
    return this.queueEmission(count, readParticleEmission(options, this.settings.defaults));
  }

  // 円環上の連続スロットへ要求を置く。rejectでは生存予約と重なる要求全体を返却する
  // replace-oldestでは発生順の円環カーソルを進め、古い割当を上書きする
  queueEmission(count, emission) {
    let reason = null;
    if (this.commands.length === MAX_PARTICLE_COMMANDS) reason = "command-capacity";
    if (reason === null && this.settings.overflow === "reject") {
      let run = 0;
      let start = -1;
      for (let n = 0; n < this.particleCount + count - 1; n++) {
        const slot = (this.cursor + n) % this.particleCount;
        run = this.expiry[slot] <= this.time ? run + 1 : 0;
        if (run === count) { start = (slot + 1 + this.particleCount - count) % this.particleCount; break; }
      }
      if (start < 0) reason = "particle-capacity";
      else this.cursor = start;
    }
    if (reason !== null) {
      this.rejectedCount += count;
      return { accepted: 0, rejected: count, reason };
    }
    const start = this.cursor;
    for (let i = 0; i < count; i++) this.expiry[(start + i) % this.particleCount] = Infinity;
    this.commands.push({ start, count, sequence: this.sequence++ >>> 0, emission });
    this.cursor = (start + count) % this.particleCount;
    this.burstCount++;
    return { accepted: count, rejected: 0, reason: null };
  }

  // 秒当たり発生数を設定する。次の更新から端数を蓄積して連続発生させる
  startEmission(options) {
    this.requireAlive();
    this.continuous = readParticleContinuous(options, this.settings.defaults);
    this.carry = 0;
    return this;
  }

  // 新しい連続発生を止め、既に生まれた粒子は寿命まで更新する
  stopEmission() { this.requireAlive(); this.continuous = null; this.carry = 0; return this; }

  // 停止中は寿命と発生要求を保持し、カメラ変更に合わせた描画だけを続ける
  setPaused(value) {
    this.requireAlive();
    if (typeof value !== "boolean") throw new Error("particle paused must be boolean");
    this.paused = value;
    return this;
  }

  // シーンの時間倍率を粒子にも適用する。0では現在の姿勢を維持する
  setTimeScale(value) {
    this.requireAlive();
    this.timeScale = util.readFiniteNumber(value, "particle timeScale", { min: 0 });
    return this;
  }

  // 前の粒子と保留要求を消し、同じseedから再現できる初期状態へ戻す
  // 連続発生の設定と一時停止設定は維持する
  clear() {
    this.requireAlive();
    this.queue.writeBuffer(this.particleBuffer, 0, this.initialData);
    this.commands.length = 0;
    this.expiry.fill(0);
    this.cursor = this.time = this.sequence = this.burstCount = this.rejectedCount = this.carry = 0;
    return this;
  }

  // 最大寿命に基づく保守的な生存推定数を返す。保留中の発生予約も含む
  getEstimatedAliveCount() {
    this.requireAlive();
    let count = 0;
    for (const end of this.expiry) if (end > this.time) count++;
    return count;
  }

  // GPU readbackを使わず、容量、予約数、拒否数を確認できるようにする
  getDiagnostics() {
    this.requireAlive();
    return { capacity: this.particleCount, estimatedAliveCount: this.getEstimatedAliveCount(),
      pendingCommands: this.commands.length, burstCount: this.burstCount,
      rejectedCount: this.rejectedCount, paused: this.paused, continuous: this.continuous !== null };
  }

  // 毎frame一度、カメラ・時間・発生要求を一括転送してComputeを記録する
  // encoderの生成とsubmitはPBRのフレーム処理に任せる
  encodeFrame(encoder, { cameraFrame, deltaSec }) {
    this.requireAlive();
    const frameDelta = util.readFiniteNumber(deltaSec, "particle deltaSec", { min: 0 });
    const frozen = this.paused || this.timeScale === 0;
    const dt = frozen ? 0 : frameDelta * this.timeScale;
    this.time += dt;
    if (!frozen && this.continuous) {
      const total = this.carry + dt * this.continuous.rate;
      const count = Math.floor(total);
      this.carry = total - count;
      // 一frameの上限超過は診断値へ記録し、巨大な要求queueを作らない
      const acceptedRequest = Math.min(count, this.particleCount);
      this.rejectedCount += count - acceptedRequest;
      if (acceptedRequest > 0) this.queueEmission(acceptedRequest, this.continuous.emission);
    }
    const values = this.paramData;
    const integers = new Uint32Array(values.buffer);
    values.set(cameraFrame.projectionMatrix.mat, 0);
    values.set(cameraFrame.viewRotationMatrix.mat, 16);
    values.set(cameraFrame.cameraWorldPosition, 32);
    values[36] = dt;
    values.set(this.settings.gravity, 40);
    values[43] = this.settings.drag;
    integers[44] = frozen ? 0 : this.commands.length;
    integers[45] = this.particleCount;
    integers[46] = this.settings.seed;
    if (!frozen) {
      for (let index = 0; index < this.commands.length; index++) {
        const command = this.commands[index];
        const e = command.emission;
        const offset = 48 + index * 32;
        integers.set([command.start, command.count, command.sequence, 0], offset);
        values.set([...e.position, e.lifetime[0]], offset + 4);
        values.set([...e.velocity, e.lifetime[1]], offset + 8);
        values.set([...e.velocitySpread, this.settings.size[0]], offset + 12);
        values.set([...this.settings.colors[0].map(v => v * this.settings.intensity), this.settings.size[1]], offset + 16);
        values.set([...this.settings.colors[1].map(v => v * this.settings.intensity), e.cone ? 1 : 0], offset + 20);
        values.set([...e.direction, e.spreadAngle * Math.PI / 180], offset + 24);
        values.set(e.speed, offset + 28);
        for (let i = 0; i < command.count; i++) {
          this.expiry[(command.start + i) % this.particleCount] = this.time + e.lifetime[1];
        }
      }
    }
    this.writeParams(values);
    if (!frozen) { this.encodeCompute(encoder); this.commands.length = 0; }
  }

  // 不透明物のReverse-Z深度を読み、HDRの既存色に発光を加算する
  encodeRender(encoder, { colorView, depthView }) {
    this.requireAlive();
    if (!colorView || !depthView) throw new Error("particle rendering requires color and depth views");
    const pass = encoder.beginRenderPass({ label: `${this.label}:hdr-particles`,
      colorAttachments: [{ view: colorView, loadOp: "load", storeOp: "store" }],
      depthStencilAttachment: { view: depthView, depthReadOnly: true } });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.setVertexBuffer(0, this.quadBuffer);
    pass.draw(6, this.particleCount);
    pass.end();
  }

  // GPU資源に加えて発生要求と連続発生設定を解放する
  destroy() {
    if (!super.destroy()) return false;
    this.commands.length = 0;
    this.continuous = null;
    this.expiry = null;
    return true;
  }
}
