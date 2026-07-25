// ---------------------------------------------
// SsaoPass.js  2026/07/25
//   G-buffer Screen-Space Ambient Occlusion pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass, {
  DEFAULT_STORAGE_TEXTURE_FORMAT
} from "./ComputePass.js";
import {
  createGBufferProjectionParams,
  GBUFFER_WGSL_COMMON
} from "./GeometryBufferPass.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const SSAO_DEFAULTS = Object.freeze({
  radius: 18.0,
  strength: 1.35,
  bias: 0.05,
  samples: 12,
  resolutionScale: 0.7
});

// G-buffer view-space normal、depthから未平滑化のAO係数を計算するWGSLを定義します
// raw AOだけを低解像度targetへ書き込み、最終color出力の解像度を落とさずに負荷を下げます
export const SSAO_WGSL = `
struct Params {
  ao : vec4f,
  projection : vec4f,
  control : vec4f,
};

${GBUFFER_WGSL_COMMON}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var normalTexture : texture_2d<f32>;
@group(0) @binding(2) var depthTexture : texture_depth_2d;
@group(0) @binding(3) var outputTexture : texture_storage_2d<rgba8unorm, write>;

fn clampCoord(coord : vec2<i32>, dims : vec2<i32>) -> vec2<i32> {
  return clamp(coord, vec2<i32>(0), dims - vec2<i32>(1));
}

fn loadDepth(coord : vec2<i32>, dims : vec2<i32>) -> f32 {
  return textureLoad(depthTexture, clampCoord(coord, dims), 0);
}

fn loadNormal(coord : vec2<i32>, dims : vec2<i32>) -> vec3f {
  let encoded = textureLoad(normalTexture, clampCoord(coord, dims), 0).rgb;
  return decodeGBufferNormal(encoded);
}

fn hashAngle(coord : vec2<i32>) -> f32 {
  let value = sin(dot(vec2f(coord), vec2f(12.9898, 78.233))) * 43758.5453;
  return fract(value) * 6.2831853;
}

fn rotate2(value : vec2f, angle : f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(value.x * c - value.y * s, value.x * s + value.y * c);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDimsU = textureDimensions(outputTexture);
  if (id.x >= outputDimsU.x || id.y >= outputDimsU.y) {
    return;
  }

  let outputCoord = vec2<i32>(id.xy);
  let outputDims = vec2<i32>(outputDimsU);
  let sourceDimsU = textureDimensions(depthTexture);
  let sourceDims = vec2<i32>(sourceDimsU);
  let sourceUv = (vec2f(outputCoord) + vec2f(0.5)) / vec2f(outputDims);
  let coord = clampCoord(vec2<i32>(sourceUv * vec2f(sourceDims)), sourceDims);
  let centerDepth = loadDepth(coord, sourceDims);
  if (isGBufferBackgroundDepth(centerDepth) || params.control.x < 0.5) {
    textureStore(outputTexture, outputCoord, vec4f(1.0));
    return;
  }

  let centerPosition = reconstructGBufferViewPosition(
    coord,
    centerDepth,
    sourceDims,
    params.projection
  );
  let normal = loadNormal(coord, sourceDims);
  let radiusPixels = params.ao.x;
  let sampleCount = i32(params.ao.w);
  let angle = hashAngle(coord);
  let kernel = array<vec2f, 16>(
    vec2f(0.22, 0.00), vec2f(-0.18, 0.18),
    vec2f(0.00, -0.32), vec2f(0.31, 0.31),
    vec2f(-0.46, 0.00), vec2f(0.00, 0.52),
    vec2f(0.48, -0.48), vec2f(-0.58, -0.58),
    vec2f(0.72, 0.00), vec2f(-0.68, 0.28),
    vec2f(0.25, 0.76), vec2f(0.58, 0.58),
    vec2f(-0.86, 0.00), vec2f(0.00, -0.92),
    vec2f(0.72, -0.72), vec2f(-0.78, 0.78)
  );

  let worldRadius = max(
    -centerPosition.z * (radiusPixels / f32(sourceDims.y)) * 2.0 * params.projection.z,
    0.001
  );
  var occlusion = 0.0;
  var validSamples = 0.0;

  for (var i = 0; i < 16; i += 1) {
    if (i < sampleCount) {
      let offset = vec2<i32>(round(rotate2(kernel[i], angle) * radiusPixels));
      let sampleCoord = clampCoord(coord + offset, sourceDims);
      let sampleDepth = loadDepth(sampleCoord, sourceDims);
      if (!isGBufferBackgroundDepth(sampleDepth)) {
        let samplePosition = reconstructGBufferViewPosition(
          sampleCoord,
          sampleDepth,
          sourceDims,
          params.projection
        );
        let delta = samplePosition - centerPosition;
        let distance = length(delta);
        if (distance > 0.0001) {
          // bias境界で寄与を急に切り替えず、occluderが法線前方へ回り込むほど滑らかに強めます
          let facingDot = dot(normal, delta / distance);
          let facing = smoothstep(params.ao.z, 0.75, facingDot);
          let rangeWeight = 1.0 - smoothstep(worldRadius * 0.15, worldRadius * 1.8, distance);
          occlusion += facing * rangeWeight;
          validSamples += 1.0;
        }
      }
    }
  }

  let average = occlusion / max(validSamples, 1.0);
  // 線形減算とclampでは強い遮蔽が一律の黒へ潰れるため、指数減衰で中間階調を残します
  let ao = exp2(-average * params.ao.y * 2.2);

  textureStore(outputTexture, outputCoord, vec4f(vec3f(ao), 1.0));
}`;

// 低解像度AOをdepthとnormalで重み付けし、フル解像度visibilityへ復元するWGSLを定義します
// geometry境界を越えた平均を抑え、完成色との合成はDeferred Lighting側へ残します
export const SSAO_BILATERAL_WGSL = `
struct Params {
  projection : vec4f,
  control : vec4f,
};

${GBUFFER_WGSL_COMMON}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var normalTexture : texture_2d<f32>;
@group(0) @binding(2) var depthTexture : texture_depth_2d;
@group(0) @binding(3) var aoTexture : texture_2d<f32>;
@group(0) @binding(4) var outputTexture : texture_storage_2d<rgba8unorm, write>;

fn clampCoord(coord : vec2<i32>, dims : vec2<i32>) -> vec2<i32> {
  return clamp(coord, vec2<i32>(0), dims - vec2<i32>(1));
}

fn loadNormal(coord : vec2<i32>, dims : vec2<i32>) -> vec3f {
  let encoded = textureLoad(normalTexture, clampCoord(coord, dims), 0).rgb;
  return decodeGBufferNormal(encoded);
}

fn fullCoordToAoCoord(coord : vec2<i32>, fullDims : vec2<i32>, aoDims : vec2<i32>) -> vec2<i32> {
  let uv = (vec2f(coord) + vec2f(0.5)) / vec2f(fullDims);
  return clampCoord(vec2<i32>(uv * vec2f(aoDims)), aoDims);
}

fn loadAoForFullCoord(coord : vec2<i32>, fullDims : vec2<i32>, aoDims : vec2<i32>) -> f32 {
  return textureLoad(aoTexture, fullCoordToAoCoord(coord, fullDims, aoDims), 0).r;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDimsU = textureDimensions(outputTexture);
  if (id.x >= outputDimsU.x || id.y >= outputDimsU.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let dims = vec2<i32>(outputDimsU);
  let aoDims = vec2<i32>(textureDimensions(aoTexture));
  let centerDepth = textureLoad(depthTexture, coord, 0);
  if (isGBufferBackgroundDepth(centerDepth) || params.control.x < 0.5) {
    textureStore(outputTexture, coord, vec4f(1.0));
    return;
  }

  let centerNormal = loadNormal(coord, dims);
  let centerPosition = reconstructGBufferViewPosition(
    coord,
    centerDepth,
    dims,
    params.projection
  );
  var weightedAo = 0.0;
  var weightSum = 0.0;

  for (var y = -2; y <= 2; y += 1) {
    for (var x = -2; x <= 2; x += 1) {
      let sampleCoord = clampCoord(coord + vec2<i32>(x, y), dims);
      let sampleDepth = textureLoad(depthTexture, sampleCoord, 0);
      if (!isGBufferBackgroundDepth(sampleDepth)) {
        let sampleNormal = loadNormal(sampleCoord, dims);
        let samplePosition = reconstructGBufferViewPosition(
          sampleCoord,
          sampleDepth,
          dims,
          params.projection
        );
        let spatialDistance = f32(x * x + y * y);
        let spatialWeight = exp(-spatialDistance * 0.28);
        let depthWeight = exp(-abs(samplePosition.z - centerPosition.z) * 10.0);
        let normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 16.0);
        let weight = spatialWeight * depthWeight * normalWeight;
        weightedAo += loadAoForFullCoord(sampleCoord, dims, aoDims) * weight;
        weightSum += weight;
      }
    }
  }

  let ao = weightedAo / max(weightSum, 0.000001);
  textureStore(outputTexture, coord, vec4f(vec3f(ao), 1.0));
}`;

// `scaledSsaoSize`は座標または数値を計算し、後続処理で使う結果を返す
function scaledSsaoSize(value, scale, label) {
  const checkedValue = util.readFiniteNumber(value, label, {
    integer: true,
    min: 1
  });
  const checkedScale = util.readFiniteNumber(scale, `${label} scale`, {
    min: 0.5,
    max: 1.0
  });
  return Math.max(1, Math.round(checkedValue * checkedScale));
}

// SSAO用ComputePassと出力StorageTargetを一つのライフサイクルで管理します
// command encoder、G-buffer生成、canvasへのcopy、queue.submit()はframe所有者へ残します
export default class SsaoPass {
  // 出力寸法と既定parameterを検証し、ComputePassとStorageTargetを生成します
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("SsaoPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "SsaoPass label",
      "ssao",
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
    this.defaults = this.validateParameters({
      radius: options.radius ?? SSAO_DEFAULTS.radius,
      strength: options.strength ?? SSAO_DEFAULTS.strength,
      bias: options.bias ?? SSAO_DEFAULTS.bias,
      samples: options.samples ?? SSAO_DEFAULTS.samples
    });
    this.resolutionScale = this.validateResolutionScale(
      options.resolutionScale ?? SSAO_DEFAULTS.resolutionScale
    );
    this.rawWidth = scaledSsaoSize(this.width, this.resolutionScale, `${this.label} width`);
    this.rawHeight = scaledSsaoSize(this.height, this.resolutionScale, `${this.label} height`);
    this.targetFactory = new StorageTargetFactory(gpu, {
      label: `${this.label}:storage`,
      format: DEFAULT_STORAGE_TEXTURE_FORMAT
    });
    this.rawTarget = this.targetFactory.create({
      label: `${this.label}:raw`,
      width: this.rawWidth,
      height: this.rawHeight
    });
    this.outputTarget = this.targetFactory.create({
      label: `${this.label}:output`,
      width: this.width,
      height: this.height
    });
    this.computePass = new ComputePass(gpu, {
      label: this.label,
      code: SSAO_WGSL,
      uniformFloats: 12,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "normal", type: "sampled-texture" },
        { binding: 2, name: "depth", type: "depth-texture" },
        {
          binding: 3,
          name: "output",
          type: "storage-texture",
          format: DEFAULT_STORAGE_TEXTURE_FORMAT,
          dispatchSize: true
        }
      ]
    });
    this.bilateralPass = new ComputePass(gpu, {
      label: `${this.label}:bilateral`,
      code: SSAO_BILATERAL_WGSL,
      uniformFloats: 8,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "normal", type: "sampled-texture" },
        { binding: 2, name: "depth", type: "depth-texture" },
        { binding: 3, name: "ao", type: "sampled-texture" },
        {
          binding: 4,
          name: "output",
          type: "storage-texture",
          format: DEFAULT_STORAGE_TEXTURE_FORMAT,
          dispatchSize: true
        }
      ]
    });
    this.ready = Promise.all([this.rawTarget.ready, this.outputTarget.ready]);
    this.destroyed = false;
  }

  // SSAOの画面半径、暗さ、self-occlusion bias、sample数を検証します
  // WGSL側でclampして続行せず、設定値の誤りをcommand発行前に例外にします
  validateParameters(parameters) {
    const checked = util.readPlainObject(parameters, `${this.label} parameters`);
    return {
      radius: util.readFiniteNumber(checked.radius, `${this.label} radius`, {
        min: 1
      }),
      strength: util.readFiniteNumber(checked.strength, `${this.label} strength`, {
        min: 0
      }),
      bias: util.readFiniteNumber(checked.bias, `${this.label} bias`, {
        min: 0,
        max: 1
      }),
      samples: util.readFiniteNumber(checked.samples, `${this.label} samples`, {
        integer: true,
        min: 4,
        max: 16
      })
    };
  }

  // raw AO targetの解像度倍率を検証します
  // 最終color出力はフル解像度のまま保ち、AO計算だけを0.5..1.0倍へ縮小します
  validateResolutionScale(value) {
    return util.readFiniteNumber(value, `${this.label} resolutionScale`, {
      min: 0.5,
      max: 1.0
    });
  }

  // G-bufferを生成したCamera Frameから共通projection paramを作ります
  // 呼び出し側が古い通常Z用配列を渡す余地をなくし、finite/infinite farの区別も共有します
  validateCameraFrame(cameraFrame) {
    return createGBufferProjectionParams(cameraFrame);
  }

  // AOはG-bufferのnormalとcamera Reverse-Z depthだけを読み、完成colorを入力に要求しません
  validateResources(resources) {
    const checked = util.readPlainObject(resources, `${this.label} resources`);
    if (!checked.normal || typeof checked.normal.getView !== "function") {
      throw new Error(`${this.label} resources require normal target`);
    }
    if (
      !checked.depth ||
      typeof checked.depth.getDepthSampleView !== "function" ||
      checked.depth.depthConvention !== CAMERA_REVERSE_Z
    ) {
      throw new Error(`${this.label} resources require CAMERA_REVERSE_Z depth target`);
    }
    for (const [name, resource] of [["normal", checked.normal], ["depth", checked.depth]]) {
      const width = resource.getWidth?.();
      const height = resource.getHeight?.();
      if (width !== this.outputTarget.getWidth() || height !== this.outputTarget.getHeight()) {
        throw new Error(
          `${this.label} ${name} size ${width}x${height} does not match output size `
          + `${this.outputTarget.getWidth()}x${this.outputTarget.getHeight()}`
        );
      }
    }
    return { normal: checked.normal, depth: checked.depth };
  }

  // G-buffer入力を読み、指定command encoderへSSAO Compute Passを記録します
  // optionsを省略したparameterだけconstructor既定値を使い、AO visibilityを二段で生成します
  encode(commandEncoder, resources, options = {}) {
    this.requireAlive();
    if (options.view !== undefined) {
      throw new Error(
        `${this.label} view option was removed; SsaoPass outputs Ambient Occlusion visibility`
      );
    }
    const checkedResources = this.validateResources(resources);
    const parameters = this.validateParameters({
      radius: options.radius ?? this.defaults.radius,
      strength: options.strength ?? this.defaults.strength,
      bias: options.bias ?? this.defaults.bias,
      samples: options.samples ?? this.defaults.samples
    });
    this.setResolutionScale(options.resolutionScale ?? this.resolutionScale);
    const projection = this.validateCameraFrame(options.cameraFrame);
    const enabled = util.readOptionalBoolean(
      options.enabled,
      `${this.label} enabled`,
      true
    );
    this.computePass.setUniforms([
      parameters.radius,
      parameters.strength,
      parameters.bias,
      parameters.samples,
      ...projection,
      enabled ? 1.0 : 0.0,
      0.0,
      this.rawTarget.getWidth(),
      this.rawTarget.getHeight()
    ]);
    const timestampWrites = options.timestampWrites;
    const firstTimestampWrites = timestampWrites?.beginningOfPassWriteIndex !== undefined ? {
      querySet: timestampWrites.querySet,
      beginningOfPassWriteIndex: timestampWrites.beginningOfPassWriteIndex
    } : undefined;
    const secondTimestampWrites = timestampWrites?.endOfPassWriteIndex !== undefined ? {
      querySet: timestampWrites.querySet,
      endOfPassWriteIndex: timestampWrites.endOfPassWriteIndex
    } : undefined;
    this.computePass.encode(commandEncoder, {
      normal: checkedResources.normal,
      depth: checkedResources.depth,
      output: this.rawTarget
    }, {
      timestampWrites: firstTimestampWrites
    });
    this.bilateralPass.setUniforms([
      ...projection,
      enabled ? 1.0 : 0.0,
      0.0,
      this.outputTarget.getWidth(),
      this.outputTarget.getHeight()
    ]);
    this.bilateralPass.encode(commandEncoder, {
      normal: checkedResources.normal,
      depth: checkedResources.depth,
      ao: this.rawTarget,
      output: this.outputTarget
    }, {
      timestampWrites: secondTimestampWrites
    });
    return this.outputTarget;
  }

  // SSAO結果を保持するStorage RenderTargetを返します
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // G-bufferと同じpixel寸法へ最終出力Targetを変更し、raw AO targetはscaleから再計算します
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
    const outputResized = resizeTarget(this.outputTarget, this.width, this.height);
    const rawResized = this.resizeRawTarget();
    return rawResized || outputResized;
  }

  // UIや呼び出し側からscaleだけを変えたとき、raw AO targetだけを更新します
  // 不正値を丸めて続行せず、設定ミスとして検出します
  setResolutionScale(scale) {
    this.requireAlive();
    const nextScale = this.validateResolutionScale(scale);
    const scaleChanged = nextScale !== this.resolutionScale;
    this.resolutionScale = nextScale;
    const rawResized = this.resizeRawTarget();
    return scaleChanged || rawResized;
  }

  // `resizeRawTarget`は表示領域に合わせて関連する寸法と描画先を更新する
  resizeRawTarget() {
    const nextWidth = scaledSsaoSize(this.width, this.resolutionScale, `${this.label} width`);
    const nextHeight = scaledSsaoSize(this.height, this.resolutionScale, `${this.label} height`);
    this.rawWidth = nextWidth;
    this.rawHeight = nextHeight;
    return resizeTarget(this.rawTarget, nextWidth, nextHeight);
  }

  // 破棄後のencode、resize、出力参照を処理フローの誤りとして検出します
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  // ComputePassのUniform Bufferと所有する出力Textureを明示的に破棄します
  destroy() {
    if (this.destroyed) {
      return false;
    }
    this.computePass.destroy();
    this.bilateralPass.destroy();
    this.rawTarget.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
