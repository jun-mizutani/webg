// ---------------------------------------------
// DofDebugViewPass.js  2026/07/23
//   Full-resolution display conversion for linear HDR DoF pyramid Levels
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "../../webg/ComputePass.js";
import { COLOR_SPACE_WGSL } from "../../webg/ColorSpace.js";
import {
  COMPUTE_DOF_FORMAT
} from "../../webg/ComputeDofPass.js?v=20260723_dof_coverage";
import StorageTargetFactory, {
  resizeTarget
} from "../../webg/StorageTargetFactory.js";
import util from "../../webg/util.js";

export const DOF_DEBUG_OUTPUT_FORMAT = "rgba8unorm";

// 1/2、1/4、1/8、1/16の各Levelは解像度が異なるため、正規化座標で線形補間して画面へ拡大します
// Linear HDR値にはReinhardとsRGB変換を適用し、FullscreenPassが受け付ける表示色へ変換します
export const DOF_DEBUG_VIEW_WGSL = `
struct Params {
  exposure : f32,
  viewMode : f32,
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
  let source = textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
  var displayColor : vec3f;
  if (params.viewMode > 1.5) {
    // CoC metadataではRをnear、Gをfarとして保持します
    // Level選択値の最大4を表示範囲1へ正規化し、両者を色で区別します
    let nearCoc = clamp(source.r * 0.25, 0.0, 1.0);
    let farCoc = clamp(source.g * 0.25, 0.0, 1.0);
    displayColor = vec3f(nearCoc, 0.15 * (nearCoc + farCoc), farCoc);
  } else if (params.viewMode > 0.5) {
    // far/near color targetのAlphaは色の混合率ではなくgeometry coverageです
    let coverage = clamp(source.a, 0.0, 1.0);
    displayColor = vec3f(coverage);
  } else {
    let hdr = max(source.rgb * params.exposure, vec3f(0.0));
    let mapped = hdr / (hdr + vec3f(1.0));
    displayColor = clamp(linearToSrgb(mapped), vec3f(0.0), vec3f(1.0));
  }
  textureStore(outputTexture, vec2<i32>(id.xy), vec4f(displayColor, 1.0));
}`;

// DoFの低解像度HDR Levelをデバッグ表示用のfull-resolution 8 bit targetへ変換します
export default class DofDebugViewPass {
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("DofDebugViewPass requires a ready WebGPU context");
    }
    this.label = util.readOptionalString(
      options.label,
      "DofDebugViewPass label",
      "compute-dof:debug-view",
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(options.width, `${this.label} width`, 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, `${this.label} height`, 1, { min: 1 });
    this.targetFactory = new StorageTargetFactory(gpu, {
      label: `${this.label}:storage`,
      format: DOF_DEBUG_OUTPUT_FORMAT
    });
    this.outputTarget = this.targetFactory.create({
      label: `${this.label}:output`,
      width: this.width,
      height: this.height,
      format: DOF_DEBUG_OUTPUT_FORMAT
    });
    this.computePass = new ComputePass(gpu, {
      label: this.label,
      code: DOF_DEBUG_VIEW_WGSL,
      uniformFloats: 4,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "source", type: "sampled-texture" },
        { binding: 2, name: "sampler", type: "sampler" },
        {
          binding: 3,
          name: "output",
          type: "storage-texture",
          format: DOF_DEBUG_OUTPUT_FORMAT,
          dispatchSize: true
        }
      ]
    });
    this.ready = this.outputTarget.ready;
    this.destroyed = false;
  }

  // DoFのHDR target、sample view、linear samplerをdispatch前に確認します
  validateSource(source) {
    if (!source || typeof source.getView !== "function" || !source.getView()) {
      throw new Error(`${this.label} source view is not ready`);
    }
    if (source.getFormat?.() !== COMPUTE_DOF_FORMAT) {
      throw new Error(`${this.label} source format must be ${COMPUTE_DOF_FORMAT}`);
    }
    if (typeof source.getSampler !== "function" || !source.getSampler()) {
      throw new Error(`${this.label} source sampler is not ready`);
    }
    return source;
  }

  // 選択したHDR色、coverage、CoC metadataをfull resolutionへ拡大して表示します
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
    const viewMode = util.readOptionalEnum(
      options.viewMode,
      `${this.label} viewMode`,
      "color",
      ["color", "coverage", "coc"]
    );
    const viewModeNumber = viewMode === "coverage" ? 1.0 : viewMode === "coc" ? 2.0 : 0.0;
    this.computePass.setUniforms([exposure, viewModeNumber, 0.0, 0.0]);
    this.computePass.encode(commandEncoder, {
      source: checkedSource,
      sampler: checkedSource.getSampler(),
      output: this.outputTarget
    });
    return this.outputTarget;
  }

  // Canvas実pixel寸法へ表示用targetを揃えます
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

  // Compute Passと表示用targetを一度だけ破棄します
  destroy() {
    if (this.destroyed) return false;
    this.computePass.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
