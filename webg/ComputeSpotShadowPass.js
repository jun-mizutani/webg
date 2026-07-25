// ---------------------------------------------
// ComputeSpotShadowPass.js  2026/07/25
//   Spot light shadow compute pass
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
import {
  createViewToLightClip,
  rejectRemovedShadowOptions,
  validateStandardShadowDepth
} from "./ComputeShadowPass.js";

export const SPOT_SHADOW_RESOLVE_WGSL = `
struct Params {
  cameraProjection : vec4f,
  viewToLightClip : mat4x4f,
  lightPosition : vec4f,
  shadowOptions : vec4f,
  shadowSize : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var normalTexture : texture_2d<f32>;
@group(0) @binding(2) var cameraDepthTexture : texture_depth_2d;
@group(0) @binding(3) var shadowDepthTexture : texture_depth_2d;
@group(0) @binding(4) var outputTexture : texture_storage_2d<rgba8unorm, write>;

${GBUFFER_WGSL_COMMON}

fn evaluateSpotShadow(viewPosition : vec3f, viewNormal : vec3f, surfaceToLight : vec3f) -> f32 {
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
  let lightVector = params.lightPosition.xyz - viewPosition;
  let lightDistance = max(length(lightVector), 0.000001);
  let surfaceToLight = lightVector / lightDistance;
  let visibility = evaluateSpotShadow(viewPosition, viewNormal, surfaceToLight);
  textureStore(outputTexture, coord, vec4f(vec3f(visibility), 1.0));
}`;

export default class ComputeSpotShadowPass {
  // camera G-bufferとspot shadow mapを読み、spot lightのshadow visibilityを出力する
  // spot coneと照明式は統合Deferred Shading側の責務とし、このpassでは評価しない
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeSpotShadowPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeSpotShadowPass label",
      "spot-shadow-resolve",
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
      code: SPOT_SHADOW_RESOLVE_WGSL,
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

  // matrix、spot position、bias、PCFを検証してvisibility評価を記録する
  encode(commandEncoder, resources, options = {}) {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
    const cameraFrame = options.cameraFrame;
    rejectRemovedShadowOptions(options, this.label, [
      "view",
      "ambient",
      "directIntensity",
      "lightDirection",
      "innerCos",
      "outerCos"
    ]);
    const lightViewProjection = options.lightViewProjection;
    const projection = createGBufferProjectionParams(cameraFrame);
    const viewToLightClip = createViewToLightClip(cameraFrame, lightViewProjection);
    const lightPosition = util.readColor(options.lightPosition, `${this.label} lightPosition`, undefined, 3);
    const bias = util.readOptionalFiniteNumber(options.bias, `${this.label} bias`, 0.0015, { min: 0 });
    const normalBias = util.readOptionalFiniteNumber(options.normalBias, `${this.label} normalBias`, 0.003, { min: 0 });
    const pcfRadius = util.readOptionalInteger(options.pcfRadius, `${this.label} pcfRadius`, 1, { min: 0, max: 2 });
    const enabled = util.readOptionalBoolean(options.enabled, `${this.label} enabled`, true);
    const shadow = validateStandardShadowDepth(resources.shadowDepth, this.label);
    const lightPositionView = cameraFrame.worldPointToView(lightPosition);

    const uniforms = new Float32Array(32);
    uniforms.set(projection, 0);
    uniforms.set(viewToLightClip.mat, 4);
    uniforms.set([
      lightPositionView[0],
      lightPositionView[1],
      lightPositionView[2],
      0.0
    ], 20);
    uniforms.set([bias, normalBias, pcfRadius, enabled ? 1.0 : 0.0], 24);
    uniforms.set([
      shadow.width,
      shadow.height,
      0.0,
      0.0
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

  // このインスタンスが保持する資源と参照を安全に解放する
  destroy() {
    if (this.destroyed) {
      return false;
    }
    this.outputTarget?.destroy?.();
    this.computePass?.destroy?.();
    this.destroyed = true;
    return true;
  }
}
