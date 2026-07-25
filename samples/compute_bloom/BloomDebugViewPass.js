// ---------------------------------------------
// samples/compute_bloom/BloomDebugViewPass.js  2026/07/23
//   Pyramid Bloom Level preview
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "../../webg/ComputePass.js";
import { COLOR_SPACE_WGSL } from "../../webg/ColorSpace.js";
import {
  COMPUTE_BLOOM_STORAGE_FORMAT
} from "../../webg/ComputeBloomPass.js?v=20260723_image_pyramid";
import StorageTargetFactory, {
  resizeTarget
} from "../../webg/StorageTargetFactory.js";
import util from "../../webg/util.js";

export const BLOOM_DEBUG_VIEW_NAMES = Object.freeze([
  "extract",
  "half",
  "quarter",
  "eighth",
  "sixteenth",
  "thirty-second",
  "blur"
]);

export const BLOOM_DEBUG_OUTPUT_FORMAT = "rgba8unorm";

// 段階別targetは解像度が異なるため、出力pixel中心を正規化座標へ変換して線形補間します
// Bloom合成前の線形HDR値は、そのまま8 bitへ切り詰めずReinhardとsRGB変換を一度だけ適用します
export const BLOOM_DEBUG_VIEW_WGSL = `
struct Params {
  exposure : f32,
  reserved0 : f32,
  reserved1 : f32,
  reserved2 : f32,
};

${COLOR_SPACE_WGSL}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sourceTexture : texture_2d<f32>;
@group(0) @binding(2) var sourceSampler : sampler;
@group(0) @binding(3) var outputTexture : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDims = textureDimensions(outputTexture);
  if (id.x >= outputDims.x || id.y >= outputDims.y) {
    return;
  }

  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(outputDims);
  let hdr = max(
    textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0).rgb * params.exposure,
    vec3f(0.0)
  );
  let mapped = hdr / (hdr + vec3f(1.0));
  let displayColor = clamp(linearToSrgb(mapped), vec3f(0.0), vec3f(1.0));
  textureStore(outputTexture, vec2<i32>(id.xy), vec4f(displayColor, 1.0));
}`;

// View名とComputeBloomPassの公開中間targetを一対一で対応させます
// 未知のViewをcompositeへ補正するとPaletteと実表示の不一致を隠すため、明示的に停止します
export function getBloomDebugSource(viewName, bloomPass) {
  if (!bloomPass) {
    throw new Error("getBloomDebugSource requires ComputeBloomPass");
  }
  if (viewName === "extract") return bloomPass.getExtractTarget();
  if (viewName === "half") return bloomPass.getHalfTarget();
  if (viewName === "quarter") return bloomPass.getQuarterTarget();
  if (viewName === "eighth") return bloomPass.getEighthTarget();
  if (viewName === "sixteenth") return bloomPass.getSixteenthTarget();
  if (viewName === "thirty-second") return bloomPass.getThirtySecondTarget();
  if (viewName === "blur") return bloomPass.getBlurTarget();
  throw new Error(`unsupported Bloom debug view: ${viewName}`);
}

// 通常のcompositeとsceneを除き、HDR中間targetを表示変換するViewかどうかを返します
// Palette定義外の値は最終表示へ流さず、状態と表示の不一致として明示的に停止します
export function isBloomDebugView(viewName) {
  if (BLOOM_DEBUG_VIEW_NAMES.includes(viewName)) return true;
  if (viewName === "scene" || viewName === "composite") return false;
  throw new Error(`unsupported Bloom view: ${viewName}`);
}

export default class BloomDebugViewPass {
  // 画面解像度の表示用targetと、HDR中間targetを読み取るCompute Passを構築します
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("BloomDebugViewPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "BloomDebugViewPass label",
      "compute-bloom:debug-view",
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(options.width, `${this.label} width`, 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, `${this.label} height`, 1, { min: 1 });
    this.targetFactory = new StorageTargetFactory(gpu, {
      label: `${this.label}:storage`,
      format: BLOOM_DEBUG_OUTPUT_FORMAT
    });
    this.outputTarget = this.targetFactory.create({
      label: `${this.label}:output`,
      width: this.width,
      height: this.height,
      format: BLOOM_DEBUG_OUTPUT_FORMAT
    });
    this.computePass = new ComputePass(gpu, {
      label: this.label,
      code: BLOOM_DEBUG_VIEW_WGSL,
      uniformFloats: 4,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "source", type: "sampled-texture" },
        { binding: 2, name: "sampler", type: "sampler" },
        {
          binding: 3,
          name: "output",
          type: "storage-texture",
          format: BLOOM_DEBUG_OUTPUT_FORMAT,
          dispatchSize: true
        }
      ]
    });
    this.ready = this.outputTarget.ready;
    this.destroyed = false;
  }

  // Bloomの線形HDR targetだけを受け付け、表示可能なViewとSamplerもdispatch前に確認します
  validateSource(source) {
    if (!source || typeof source.getView !== "function") {
      throw new Error(`${this.label} source requires getView()`);
    }
    if (typeof source.getFormat !== "function") {
      throw new Error(`${this.label} source requires getFormat()`);
    }
    if (source.getFormat() !== COMPUTE_BLOOM_STORAGE_FORMAT) {
      throw new Error(`${this.label} source format must be ${COMPUTE_BLOOM_STORAGE_FORMAT}`);
    }
    if (!source.getView()) {
      throw new Error(`${this.label} source view is not ready`);
    }
    if (typeof source.getSampler !== "function" || !source.getSampler()) {
      throw new Error(`${this.label} source sampler is not ready`);
    }
    return source;
  }

  // 選択した段階のHDR値を画面解像度へ拡大し、表示用8 bit色へ変換します
  encode(commandEncoder, source, options = {}) {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
    const checkedSource = this.validateSource(source);
    const exposure = util.readOptionalFiniteNumber(
      options.exposure,
      `${this.label} exposure`,
      1.0,
      { min: 0.0, max: 4.0 }
    );
    this.computePass.setUniforms([exposure, 0.0, 0.0, 0.0]);
    this.computePass.encode(commandEncoder, {
      source: checkedSource,
      sampler: checkedSource.getSampler(),
      output: this.outputTarget
    });
    return this.outputTarget;
  }

  // Canvas寸法が変わった場合だけ、表示用targetを同じ寸法へ作り直します
  resize(width, height) {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
    this.width = util.readFiniteNumber(width, `${this.label} width`, {
      integer: true,
      min: 1
    });
    this.height = util.readFiniteNumber(height, `${this.label} height`, {
      integer: true,
      min: 1
    });
    return resizeTarget(this.outputTarget, this.width, this.height);
  }

  // FullscreenPassへ渡す表示用rgba8unorm targetを返します
  getOutputTarget() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
    return this.outputTarget;
  }

  // 所有するUniform Bufferと表示用textureを一度だけ破棄します
  destroy() {
    if (this.destroyed) return false;
    this.computePass.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
