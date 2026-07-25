// ---------------------------------------------
// ComputeEffectToneMapPass.js  2026/07/25
//   Linear High Dynamic Range to display color compute pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import {
  COLOR_SPACE_WGSL,
  SRGB_REFERENCE_GAMMA
} from "./ColorSpace.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import { GBUFFER_WGSL_COMMON } from "./GeometryBufferPass.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_EFFECT_TONEMAP_MODES = Object.freeze([
  "reinhard",
  "linear"
]);

// Tone Map前後の意味をformat名と共に固定し、途中passの8 bit色を誤接続できないようにする
export const COMPUTE_EFFECT_TONEMAP_INPUT_FORMAT = "rgba16float";
export const COMPUTE_EFFECT_TONEMAP_OUTPUT_FORMAT = "rgba8unorm";

export const COMPUTE_EFFECT_TONEMAP_WGSL = `
struct Params {
  exposure : f32,
  saturation : f32,
  gamma : f32,
  mode : f32,
  blackBackground : f32,
  reserved0 : f32,
  reserved1 : f32,
  reserved2 : f32,
};

${GBUFFER_WGSL_COMMON}
${COLOR_SPACE_WGSL}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var depthTexture : texture_depth_2d;
@group(0) @binding(3) var outputTexture : texture_storage_2d<${COMPUTE_EFFECT_TONEMAP_OUTPUT_FORMAT}, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dims = textureDimensions(outputTexture);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let depth = textureLoad(depthTexture, coord, 0);
  if (isGBufferBackgroundDepth(depth) && params.blackBackground >= 0.5) {
    textureStore(outputTexture, coord, vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let scene = max(textureLoad(sceneTexture, coord, 0).rgb * params.exposure, vec3f(0.0));
  var mapped = scene;
  if (i32(params.mode) == 0) {
    mapped = scene / (scene + vec3f(1.0));
  } else {
    mapped = clamp(scene, vec3f(0.0), vec3f(1.0));
  }
  // mappedは線形色なので、暗部の線形区間を含む正確なsRGB伝達関数で表示値へ変換します
  // gamma 2.2では標準sRGBをそのまま使い、他の値だけを表示上の追加調整として適用します
  let srgbColor = linearToSrgb(mapped);
  let displayColor = pow(
    max(srgbColor, vec3f(0.0)),
    vec3f(${SRGB_REFERENCE_GAMMA} / params.gamma)
  );
  let luma = dot(displayColor, vec3f(0.2126, 0.7152, 0.0722));
  let saturated = clamp(mix(vec3f(luma), displayColor, params.saturation), vec3f(0.0), vec3f(1.0));
  textureStore(outputTexture, coord, vec4f(saturated, 1.0));
}`;

export default class ComputeEffectToneMapPass {
  // 線形High Dynamic Range sceneとCamera Reverse-Z depthを受け取る最終表示変換を構築します
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeEffectToneMapPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeEffectToneMapPass label",
      "compute-effect:tone-map",
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(
      options.width,
      `${this.label} width`,
      1,
      { min: 1 }
    );
    this.height = util.readOptionalInteger(
      options.height,
      `${this.label} height`,
      1,
      { min: 1 }
    );
    this.format = util.readOptionalString(
      options.format,
      `${this.label} format`,
      COMPUTE_EFFECT_TONEMAP_OUTPUT_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== COMPUTE_EFFECT_TONEMAP_OUTPUT_FORMAT) {
      throw new Error(
        `${this.label} format must be ${COMPUTE_EFFECT_TONEMAP_OUTPUT_FORMAT}`
      );
    }
    this.targetFactory = options.targetFactory ?? new StorageTargetFactory(gpu, {
      label: `${this.label}:storage`,
      format: this.format
    });
    if (this.targetFactory.format !== this.format) {
      throw new Error(
        `${this.label} StorageTargetFactory format must be ${this.format}`
      );
    }
    this.outputTarget = this.targetFactory.create({
      label: `${this.label}:output`,
      width: this.width,
      height: this.height,
      format: this.format
    });
    this.computePass = new ComputePass(gpu, {
      label: this.label,
      code: COMPUTE_EFFECT_TONEMAP_WGSL,
      uniformFloats: 8,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "scene", type: "sampled-texture" },
        { binding: 2, name: "depth", type: "depth-texture" },
        {
          binding: 3,
          name: "output",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        }
      ]
    });
    this.ready = this.outputTarget.ready;
    this.destroyed = false;
  }

  // 最終変換へ渡すscene、depth、出力の形式と寸法をdispatch前に照合します
  // getFormatを持たない任意texture wrapperは色空間を証明できないため受け付けません
  validateResources(resources) {
    const scene = resources?.scene;
    const depth = resources?.depth;
    if (!scene || typeof scene.getView !== "function") {
      throw new Error(`${this.label} resources require scene target`);
    }
    if (typeof scene.getFormat !== "function") {
      throw new Error(`${this.label} scene target requires getFormat()`);
    }
    if (scene.getFormat() !== COMPUTE_EFFECT_TONEMAP_INPUT_FORMAT) {
      throw new Error(
        `${this.label} scene format must be ${COMPUTE_EFFECT_TONEMAP_INPUT_FORMAT}`
      );
    }
    if (
      typeof depth?.getDepthSampleView !== "function" ||
      depth.depthConvention !== CAMERA_REVERSE_Z
    ) {
      throw new Error(
        `${this.label} resources require CAMERA_REVERSE_Z depth target`
      );
    }
    for (const [name, target] of [["scene", scene], ["depth", depth]]) {
      const width = target.getWidth?.();
      const height = target.getHeight?.();
      if (width !== this.width || height !== this.height) {
        throw new Error(
          `${this.label} ${name} size ${width}x${height} does not match output size `
          + `${this.width}x${this.height}`
        );
      }
    }
    return { scene, depth };
  }

  // exposure、tone mapping、sRGB符号化、display gamma調整、saturationを最終passで一度だけ適用します
  encode(commandEncoder, resources, options = {}) {
    this.requireAlive();
    const checkedResources = this.validateResources(resources);
    const exposure = util.readOptionalFiniteNumber(
      options.exposure,
      `${this.label} exposure`,
      1.0,
      { min: 0, max: 4 }
    );
    const saturation = util.readOptionalFiniteNumber(
      options.saturation,
      `${this.label} saturation`,
      1.0,
      { min: 0, max: 3 }
    );
    const gamma = util.readOptionalFiniteNumber(
      options.gamma,
      `${this.label} gamma`,
      2.2,
      { min: 0.1, max: 4 }
    );
    const mode = util.readOptionalEnum(
      options.mode,
      `${this.label} mode`,
      "reinhard",
      COMPUTE_EFFECT_TONEMAP_MODES
    );
    const blackBackground = util.readOptionalBoolean(
      options.blackBackground,
      `${this.label} blackBackground`,
      false
    );
    this.computePass.setUniforms(new Float32Array([
      exposure,
      saturation,
      gamma,
      mode === "linear" ? 1 : 0,
      blackBackground ? 1 : 0,
      0,
      0,
      0
    ]));
    this.computePass.encode(commandEncoder, {
      scene: checkedResources.scene,
      depth: checkedResources.depth,
      output: this.outputTarget
    }, {
      timestampWrites: options.timestampWrites
    });
    return this.outputTarget;
  }

  // `resize`は表示領域に合わせて関連する寸法と描画先を更新する
  resize(width, height) {
    this.requireAlive();
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

  // 出力の対象を現在の入力と状態から求め、呼び出し元へ返す
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // 使用可能状態を検証し、後続処理が扱える共通形式へ整える
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  // このインスタンスが保持する資源と参照を安全に解放する
  destroy() {
    if (this.destroyed) return false;
    this.computePass.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
