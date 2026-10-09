// ---------------------------------------------
// WaterCausticField.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 真上の単位入射光から、水平底面の相対照度を生成する

import ComputePass from "./ComputePass.js";
import { WATER_WAVE_WGSL } from "./WaterWaveWgsl.js";

const CAUSTIC_FIELD_WGSL = String.raw`
// common.wgslの波とFresnelを使い、y=0の平面へ光を散布する
// 光束は256倍の整数で蓄積し、四画素への散布で合計を保持する
@group(0) @binding(1) var<storage, read_write> photons: array<atomic<u32>>;
@group(0) @binding(2) var field: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
// 計算領域内の光束bufferを零へ初期化し、今回の光線追跡に備える
fn clear(@builtin(global_invocation_id) id: vec3u) {
  let size = u32(params.grid.y);
  if (all(id.xy < vec2u(size))) {
    atomicStore(&photons[id.y * size + id.x], 0u);
  }
}

// 範囲内の画素へ整数光束をatomic加算し、複数光線の到着量を蓄積する
fn deposit(p: vec2i, amount: u32) {
  let size = i32(params.grid.y);
  if (all(p >= vec2i(0)) && all(p < vec2i(size))) {
    atomicAdd(&photons[u32(p.y * size + p.x)], amount);
  }
}

@compute @workgroup_size(8, 8)
// 波の高さと法線で入射光を屈折させ、交点へ透過・吸収後の光束を散布する
fn trace(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(u32(params.grid.x)))) { return; }
  let xz = ((vec2f(id.xy) + 0.5) / params.grid.x - 0.5) * params.grid.z;
  let wave = surface(xz);
  let normal = normalize(vec3f(-wave.y, 1.0, -wave.z));
  let eta = 1.0 / params.water.w;
  let ct = sqrt(1.0 - eta * eta * (1.0 - normal.y * normal.y));
  let ray = refract(vec3f(0, -1, 0), normal, eta);
  let distance = -wave.x / ray.y;
  let hit = xz + distance * ray.xz;
  let power = (1.0 - fresnel(normal.y, ct, params.water.w))
    * exp(-params.view.w * distance);

  let pixel = (hit / params.grid.z + 0.5) * params.grid.y - 0.5;
  let p = vec2i(floor(pixel));
  let f = fract(pixel);
  let weights = vec4f((1-f.x)*(1-f.y), f.x*(1-f.y), (1-f.x)*f.y, f.x*f.y);
  let total = round(power * 256.0);
  let a = u32(round(total * weights.x));
  let b = u32(round(total * (weights.x + weights.y)));
  let c = u32(round(total * (weights.x + weights.y + weights.z)));
  deposit(p, a);
  deposit(p + vec2i(1, 0), b-a);
  deposit(p + vec2i(0, 1), c-b);
  deposit(p + vec2i(1, 1), u32(total)-c);
}

// 蓄積した画素の光束を読み、計算領域の外側には零を返す
fn loadPower(p: vec2i) -> f32 {
  let size = i32(params.grid.y);
  if (any(p < vec2i(0)) || any(p >= vec2i(size))) { return 0.0; }
  return f32(atomicLoad(&photons[u32(p.y * size + p.x)]));
}

@compute @workgroup_size(8, 8)
// 近傍の蓄積光束を平滑化し、光線数と画素面積で正規化した照度を出力する
fn resolve(@builtin(global_invocation_id) id: vec3u) {
  let size = u32(params.grid.y);
  if (any(id.xy >= vec2u(size))) { return; }
  var flux = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let weight = select(1.0, 2.0, x == 0) * select(1.0, 2.0, y == 0);
      flux += weight * loadPower(vec2i(id.xy) + vec2i(x, y));
    }
  }
  let areaRatio = (params.grid.y * params.grid.y) / (params.grid.x * params.grid.x);
  let irradiance = flux * areaRatio / (16.0 * 256.0);
  let xz = ((vec2f(id.xy) + 0.5) / params.grid.y - 0.5) * params.grid.z;
  textureStore(field, vec2i(id.xy), vec4f(vec3f(irradiance), surface(xz).x));
}
`;


const QUALITY = {
  low: { rays: 512, pixels: 256 },
  high: { rays: 1024, pixels: 512 }
};

export default class WaterCausticField {
  // 共通の波WGSLと集光WGSLを結合し、品質に合わせた生成器を返す
  static async create(gpu, quality) {
    return new WaterCausticField(gpu, WATER_WAVE_WGSL + CAUSTIC_FIELD_WGSL, quality);
  }

  // 光束の整数蓄積bufferと照度textureを確保し、クリア・追跡・解決の3段階を準備する
  constructor(gpu, code, quality) {
    this.gpu = gpu;
    this.size = QUALITY[quality];
    if (!this.size) throw new Error(`Unknown quality: ${quality}`);
    this.dirty = true;
    this.dispatches = 0;
    this.buffer = gpu.device.createBuffer({
      label: "caustic:flux", size: this.size.pixels ** 2 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.texture = gpu.device.createTexture({
      label: "caustic:irradiance", size: [this.size.pixels, this.size.pixels],
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
    });
    this.view = this.texture.createView();
    this.passes = ["clear", "trace", "resolve"].map(entryPoint => new ComputePass(gpu, {
      label: `caustic:${entryPoint}`, code, entryPoint, uniformFloats: 44,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "photons", type: "storage-buffer" },
        { binding: 2, name: "field", type: "storage-texture", format: "rgba16float" }
      ]
    }));
  }

  // 水の44floatの共通uniformから、光束のクリア・屈折追跡・照度への解決を記録する
  // dirtyがfalseのframeでは生成済みの照度画像を再利用し、dispatch数を零に保つ
  encode(encoder, body, timing) {
    this.dispatches = 0;
    if (!this.dirty) return;
    const values = body.createWaveUniforms(this.size.rays, this.size.pixels);
    // 集光はスカラー照度として投影する。RGB吸収は水面透過側で評価し、
    // ここでは三波長の平均減衰でエネルギーを近似する
    values[11] = body.options.absorption.reduce((a, b) => a + b, 0) / 3;
    for (const [index, pass] of this.passes.entries()) {
      pass.setUniforms(values);
      const count = index === 1 ? this.size.rays : this.size.pixels;
      pass.encode(encoder, { photons: this.buffer, field: this.view }, {
        dispatchSize: [count, count, 1],
        timestampWrites: timing?.writes(index)
      });
      this.dispatches++;
    }
    this.dirty = false;
  }

  // 3段階のCompute pass、照度texture、光束bufferを解放する
  destroy() {
    for (const pass of this.passes) pass.destroy();
    this.texture.destroy();
    this.buffer.destroy();
  }
}
