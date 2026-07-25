// ---------------------------------------------
// webg/ComputeShadowPass.js  2026/07/25
//   Directional shadow compute pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import StorageTargetFactory, { resizeTarget } from "./StorageTargetFactory.js";
import util from "./util.js";
import {
  createGBufferProjectionParams,
  GBUFFER_WGSL_COMMON
} from "./GeometryBufferPass.js";
import { SHADOW_STANDARD_Z } from "./DepthConvention.js";

export const SHADOW_RESOLVE_WGSL = `
struct Params {
  cameraProjection : vec4f,
  viewToLightClip : mat4x4f,
  lightDirection : vec4f,
  shadowOptions : vec4f,
  shadowSize : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var normalTexture : texture_2d<f32>;
@group(0) @binding(2) var cameraDepthTexture : texture_depth_2d;
@group(0) @binding(3) var shadowDepthTexture : texture_depth_2d;
@group(0) @binding(4) var outputTexture : texture_storage_2d<rgba8unorm, write>;

${GBUFFER_WGSL_COMMON}

fn evaluateShadow(viewPosition : vec3f, viewNormal : vec3f) -> f32 {
  let clip = params.viewToLightClip * vec4f(viewPosition, 1.0);
  if (abs(clip.w) <= 0.000001) {
    return 1.0;
  }
  let ndc = clip.xyz / clip.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (
    uv.x < 0.0 || uv.x > 1.0 ||
    uv.y < 0.0 || uv.y > 1.0 ||
    ndc.z < 0.0 || ndc.z > 1.0
  ) {
    return 1.0;
  }

  let surfaceToLight = normalize(-params.lightDirection.xyz);
  let slope = 1.0 - max(dot(viewNormal, surfaceToLight), 0.0);
  let receiverDepth = ndc.z - params.shadowOptions.x - params.shadowOptions.y * slope;
  let center = vec2i(
    clamp(
      uv * params.shadowSize.xy,
      vec2f(0.0),
      params.shadowSize.xy - vec2f(1.0)
    )
  );
  let radius = i32(params.shadowOptions.z);
  var visible = 0.0;
  var samples = 0.0;
  for (var y = -2; y <= 2; y += 1) {
    for (var x = -2; x <= 2; x += 1) {
      if (abs(x) <= radius && abs(y) <= radius) {
        let coord = clamp(
          center + vec2i(x, y),
          vec2i(0),
          vec2i(params.shadowSize.xy) - vec2i(1)
        );
        let storedDepth = textureLoad(shadowDepthTexture, coord, 0);
        visible += select(0.0, 1.0, receiverDepth <= storedDepth);
        samples += 1.0;
      }
    }
  }
  return visible / max(samples, 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3u) {
  let dims = textureDimensions(outputTexture);
  let coord = vec2i(id.xy);
  if (coord.x >= i32(dims.x) || coord.y >= i32(dims.y)) {
    return;
  }

  let cameraDepth = textureLoad(cameraDepthTexture, coord, 0);
  if (isGBufferBackgroundDepth(cameraDepth) || params.shadowOptions.w < 0.5) {
    // 背景またはshadow無効時は、光を遮らないvisibility 1を返す
    textureStore(outputTexture, coord, vec4f(1.0));
    return;
  }

  let viewNormal = decodeGBufferNormal(textureLoad(normalTexture, coord, 0).xyz);
  let viewPosition = reconstructGBufferViewPosition(
    coord,
    cameraDepth,
    vec2i(dims),
    params.cameraProjection
  );
  let visibility = evaluateShadow(viewPosition, viewNormal);
  textureStore(outputTexture, coord, vec4f(vec3f(visibility), 1.0));
}`;

// view-space位置をShadow Map clipへ直接変換する行列をCPU倍精度で合成します
// GPU上で巨大なcamera World平行移動を加えてからlight viewで引く追加誤差を避けます
export function createViewToLightClip(cameraFrame, lightViewProjection) {
  createGBufferProjectionParams(cameraFrame);
  if (!lightViewProjection?.mat || lightViewProjection.mat.length !== 16) {
    throw new Error("createViewToLightClip requires a 4x4 lightViewProjection Matrix");
  }
  const result = lightViewProjection.clone();
  result.mul_(cameraFrame.cameraWorldMatrix);
  for (let index = 0; index < 16; index += 1) {
    util.readFiniteNumber(result.mat[index], `viewToLightClip[${index}]`);
  }
  return result;
}

// resolveへ渡るShadow Map resourceが通常Z生成物であることをidentityで確認します
// 同じdepth32floatでもcamera Reverse-Z textureは意味が異なるためformat比較だけでは受け入れません
export function validateStandardShadowDepth(shadowDepth, label) {
  if (!shadowDepth || shadowDepth.depthConvention !== SHADOW_STANDARD_Z) {
    throw new Error(`${label} shadowDepth must use SHADOW_STANDARD_Z`);
  }
  const width = shadowDepth.getWidth?.();
  const height = shadowDepth.getHeight?.();
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`${label} shadowDepth must expose integer dimensions`);
  }
  return { shadowDepth, width, height };
}

// visibility passから照明責務を外した後も旧optionを黙って無視しないようにします
// 呼び出し側が移行未完のまま見た目だけ変わる状態を、encode前の明示エラーとして検出します
export function rejectRemovedShadowOptions(options, label, names) {
  for (const name of names) {
    if (options[name] !== undefined) {
      throw new Error(
        `${label} ${name} option was removed; lighting is evaluated by Deferred Shading`
      );
    }
  }
}

// camera G-bufferとshadow mapを読み、directional lightのvisibilityをStorageTargetへ出力する
export default class ComputeShadowPass {
  // 出力targetとComputePassを作り、影の可視率評価だけに必要なbinding順を固定する
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeShadowPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeShadowPass label",
      "shadow-resolve",
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(options.width, `${this.label} width`, 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, `${this.label} height`, 1, { min: 1 });
    this.factory = new StorageTargetFactory(gpu, { label: `${this.label}:target` });
    this.outputTarget = this.factory.create({
      label: `${this.label}:output`,
      width: this.width,
      height: this.height
    });
    this.computePass = new ComputePass(gpu, {
      label: this.label,
      code: SHADOW_RESOLVE_WGSL,
      uniformFloats: 32,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "normal", type: "sampled-texture" },
        { binding: 2, name: "cameraDepth", type: "depth-texture" },
        { binding: 3, name: "shadowDepth", type: "depth-texture" },
        {
          binding: 4,
          name: "output",
          type: "storage-texture",
          dispatchSize: true
        }
      ]
    });
    this.ready = this.outputTarget.ready;
    this.destroyed = false;
  }

  // matrix、bias、PCF、enabledを検証し、指定command encoderへvisibility評価を記録する
  encode(commandEncoder, resources, options = {}) {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
    const cameraFrame = options.cameraFrame;
    rejectRemovedShadowOptions(options, this.label, [
      "view",
      "ambient",
      "directIntensity"
    ]);
    const lightViewProjection = options.lightViewProjection;
    const projection = createGBufferProjectionParams(cameraFrame);
    const viewToLightClip = createViewToLightClip(cameraFrame, lightViewProjection);
    const direction = util.readColor(
      options.lightDirection,
      `${this.label} lightDirection`,
      undefined,
      3
    );
    const directionLength = Math.hypot(...direction);
    if (directionLength <= 1.0e-8) {
      throw new Error(`${this.label} lightDirection has zero length`);
    }
    const bias = util.readOptionalFiniteNumber(
      options.bias,
      `${this.label} bias`,
      0.0015,
      { min: 0 }
    );
    const normalBias = util.readOptionalFiniteNumber(
      options.normalBias,
      `${this.label} normalBias`,
      0.003,
      { min: 0 }
    );
    const pcfRadius = util.readOptionalInteger(
      options.pcfRadius,
      `${this.label} pcfRadius`,
      1,
      { min: 0, max: 2 }
    );
    const enabled = util.readOptionalBoolean(
      options.enabled,
      `${this.label} enabled`,
      true
    );
    const shadow = validateStandardShadowDepth(resources.shadowDepth, this.label);

    const directionView = cameraFrame.viewRotationMatrix.mul3x3Vector([
      direction[0] / directionLength,
      direction[1] / directionLength,
      direction[2] / directionLength
    ]);

    const uniforms = new Float32Array(32);
    uniforms.set(projection, 0);
    uniforms.set(viewToLightClip.mat, 4);
    uniforms.set([
      directionView[0],
      directionView[1],
      directionView[2],
      0.0
    ], 20);
    uniforms.set([bias, normalBias, pcfRadius, enabled ? 1.0 : 0.0], 24);
    uniforms.set([
      shadow.width,
      shadow.height,
      0.0,
      0
    ], 28);
    this.computePass.setUniforms(uniforms);
    this.computePass.encode(commandEncoder, {
      normal: resources.normal,
      cameraDepth: resources.depth,
      shadowDepth: resources.shadowDepth,
      output: this.outputTarget
    }, {
      timestampWrites: options.timestampWrites
    });
    return this.outputTarget;
  }

  // canvas寸法へ合わせて出力targetだけを変更し、shadow map解像度とは独立させる
  resize(width, height) {
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
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
    return this.outputTarget;
  }

  // ComputePassと所有するStorageTargetを一度だけ破棄する
  destroy() {
    if (this.destroyed) {
      return false;
    }
    this.computePass.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
