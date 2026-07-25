// ---------------------------------------------
// ComputeEdgePass.js  2026/07/14
//   Display color and Camera Reverse-Z geometry edge pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import {
  createGBufferProjectionParams,
  GBUFFER_WGSL_COMMON
} from "./GeometryBufferPass.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_EDGE_DEFAULTS = Object.freeze({
  strength: 1.0,
  threshold: 0.16,
  mix: 1.0,
  blendMode: "black-multiply",
  colorEnabled: true,
  geometryEnabled: false,
  normalWeight: 1.0,
  depthWeight: 1.0,
  thickness: 1,
  enabled: true
});

export const COMPUTE_EDGE_BLEND_MODES = Object.freeze([
  "black-multiply",
  "black-subtract",
  "white-add"
]);

// EdgeはTone Map後または通常描画後の表示色を読みます
// RenderTargetはcanvasと同じbgra8unorm、storage出力はrgba8unormになるため、入力と出力を分けて定義します
export const COMPUTE_EDGE_INPUT_FORMATS = Object.freeze([
  "rgba8unorm",
  "bgra8unorm"
]);
export const COMPUTE_EDGE_FORMAT = "rgba8unorm";

export const COMPUTE_EDGE_WGSL = `
struct Params {
  values : vec4f,
  control : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var outputTexture : texture_storage_2d<${COMPUTE_EDGE_FORMAT}, write>;

fn readLuma(coord : vec2<i32>, dims : vec2<i32>) -> f32 {
  let p = clamp(coord, vec2<i32>(0), dims - vec2<i32>(1));
  return dot(textureLoad(sceneTexture, p, 0).rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn sobelEdge(coord : vec2<i32>, dims : vec2<i32>) -> f32 {
  let tl = readLuma(coord + vec2<i32>(-1, -1), dims);
  let tc = readLuma(coord + vec2<i32>(0, -1), dims);
  let tr = readLuma(coord + vec2<i32>(1, -1), dims);
  let ml = readLuma(coord + vec2<i32>(-1, 0), dims);
  let mr = readLuma(coord + vec2<i32>(1, 0), dims);
  let bl = readLuma(coord + vec2<i32>(-1, 1), dims);
  let bc = readLuma(coord + vec2<i32>(0, 1), dims);
  let br = readLuma(coord + vec2<i32>(1, 1), dims);
  let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  let magnitude = sqrt(gx * gx + gy * gy) * params.values.x;
  return smoothstep(params.values.y, params.values.y + 0.18, magnitude);
}

fn dilateEdge(baseCoord : vec2<i32>, dims : vec2<i32>, radius : i32) -> f32 {
  var result = 0.0;
  for (var y = -3; y <= 3; y += 1) {
    for (var x = -3; x <= 3; x += 1) {
      if (abs(x) <= radius && abs(y) <= radius) {
        result = max(result, sobelEdge(baseCoord + vec2<i32>(x, y), dims));
      }
    }
  }
  return result;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dimsU = textureDimensions(sceneTexture);
  if (id.x >= dimsU.x || id.y >= dimsU.y) {
    return;
  }
  let coord = vec2<i32>(id.xy);
  let dims = vec2<i32>(dimsU);
  let source = textureLoad(sceneTexture, coord, 0);
  let radius = i32(params.control.y);

  if (params.values.w < 0.5) {
    textureStore(outputTexture, coord, source);
    return;
  }

  let edge = dilateEdge(coord, dims, radius);
  let amount = edge * params.values.z;
  let mode = i32(params.control.x);
  var color = source.rgb;
  if (mode == 1) {
    color = max(source.rgb - vec3f(amount), vec3f(0.0));
  } else if (mode == 2) {
    color = min(source.rgb + vec3f(amount), vec3f(1.0));
  } else {
    color = source.rgb * (1.0 - amount);
  }
  textureStore(outputTexture, coord, vec4f(color, source.a));
}`;

export const COMPUTE_EDGE_GEOMETRY_WGSL = `
struct Params {
  values : vec4f,
  control : vec4f,
  weights : vec4f,
  projection : vec4f,
};

${GBUFFER_WGSL_COMMON}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var normalTexture : texture_2d<f32>;
@group(0) @binding(3) var depthTexture : texture_depth_2d;
@group(0) @binding(4) var outputTexture : texture_storage_2d<${COMPUTE_EDGE_FORMAT}, write>;

fn clampCoord(coord : vec2<i32>, dims : vec2<i32>) -> vec2<i32> {
  return clamp(coord, vec2<i32>(0), dims - vec2<i32>(1));
}

fn readLuma(coord : vec2<i32>, dims : vec2<i32>) -> f32 {
  let p = clampCoord(coord, dims);
  return dot(textureLoad(sceneTexture, p, 0).rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn readNormal(coord : vec2<i32>, dims : vec2<i32>) -> vec3f {
  let p = clampCoord(coord, dims);
  return decodeGBufferNormal(textureLoad(normalTexture, p, 0).rgb);
}

fn sobelEdge(coord : vec2<i32>, dims : vec2<i32>) -> f32 {
  let tl = readLuma(coord + vec2<i32>(-1, -1), dims);
  let tc = readLuma(coord + vec2<i32>(0, -1), dims);
  let tr = readLuma(coord + vec2<i32>(1, -1), dims);
  let ml = readLuma(coord + vec2<i32>(-1, 0), dims);
  let mr = readLuma(coord + vec2<i32>(1, 0), dims);
  let bl = readLuma(coord + vec2<i32>(-1, 1), dims);
  let bc = readLuma(coord + vec2<i32>(0, 1), dims);
  let br = readLuma(coord + vec2<i32>(1, 1), dims);
  let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  let colorMagnitude = sqrt(gx * gx + gy * gy) * params.values.x;
  return smoothstep(params.values.y, params.values.y + 0.18, colorMagnitude);
}

fn geometrySample(coord : vec2<i32>, dims : vec2<i32>) -> f32 {
  let centerDepthRaw = textureLoad(depthTexture, coord, 0);
  if (params.control.z < 0.5 || isGBufferBackgroundDepth(centerDepthRaw)) {
    return 0.0;
  }
  let centerNormal = readNormal(coord, dims);
  let centerDepth = linearizeGBufferDepth(centerDepthRaw, params.projection);
  let neighbors = array<vec2<i32>, 4>(
    vec2<i32>(-1, 0),
    vec2<i32>(1, 0),
    vec2<i32>(0, -1),
    vec2<i32>(0, 1)
  );
  var maxNormalDelta = 0.0;
  var maxDepthDelta = 0.0;
  for (var i = 0; i < 4; i += 1) {
    let sampleCoord = clampCoord(coord + neighbors[i], dims);
    let sampleDepthRaw = textureLoad(depthTexture, sampleCoord, 0);
    if (!isGBufferBackgroundDepth(sampleDepthRaw)) {
      let sampleNormal = readNormal(sampleCoord, dims);
      let normalDelta = 1.0 - max(dot(centerNormal, sampleNormal), 0.0);
      maxNormalDelta = max(maxNormalDelta, normalDelta);
      let sampleDepth = linearizeGBufferDepth(sampleDepthRaw, params.projection);
      let depthDelta = abs(sampleDepth - centerDepth) / centerDepth;
      maxDepthDelta = max(maxDepthDelta, depthDelta);
    } else {
      maxDepthDelta = 1.0;
    }
  }
  let normalEdge = smoothstep(0.04, 0.22, maxNormalDelta * params.weights.x);
  let depthEdge = smoothstep(0.002, 0.02, maxDepthDelta * params.weights.y);
  return max(normalEdge, depthEdge);
}

fn dilateEdge(baseCoord : vec2<i32>, dims : vec2<i32>, radius : i32) -> f32 {
  var result = 0.0;
  for (var y = -3; y <= 3; y += 1) {
    for (var x = -3; x <= 3; x += 1) {
      if (abs(x) <= radius && abs(y) <= radius) {
        let coord = clampCoord(baseCoord + vec2<i32>(x, y), dims);
        result = max(result, max(sobelEdge(coord, dims), geometrySample(coord, dims)));
      }
    }
  }
  return result;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dimsU = textureDimensions(sceneTexture);
  if (id.x >= dimsU.x || id.y >= dimsU.y) {
    return;
  }
  let coord = vec2<i32>(id.xy);
  let dims = vec2<i32>(dimsU);
  let source = textureLoad(sceneTexture, coord, 0);
  let radius = i32(params.control.y);
  let useColorEdge = params.control.w >= 0.5;

  if (params.values.w < 0.5) {
    textureStore(outputTexture, coord, source);
    return;
  }

  var edge = 0.0;
  if (useColorEdge) {
    edge = dilateEdge(coord, dims, radius);
  } else {
    for (var y = -3; y <= 3; y += 1) {
      for (var x = -3; x <= 3; x += 1) {
        if (abs(x) <= radius && abs(y) <= radius) {
          let sampleCoord = clampCoord(coord + vec2<i32>(x, y), dims);
          edge = max(edge, geometrySample(sampleCoord, dims));
        }
      }
    }
  }
  let amount = edge * params.values.z;
  let mode = i32(params.control.x);
  var color = source.rgb;
  if (mode == 1) {
    color = max(source.rgb - vec3f(amount), vec3f(0.0));
  } else if (mode == 2) {
    color = min(source.rgb + vec3f(amount), vec3f(1.0));
  } else {
    color = source.rgb * (1.0 - amount);
  }
  textureStore(outputTexture, coord, vec4f(color, source.a));
}`;

// color textureだけを入力に取り、Sobel edgeを最終colorへ混ぜた出力を作ります
// scene描画、debug用の元scene表示、canvasへのcopyは呼び出し側が所有します
export default class ComputeEdgePass {
  // 入力sceneと同じ寸法のstorage targetとComputePassを作ります
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeEdgePass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeEdgePass label",
      "compute-edge",
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
      COMPUTE_EDGE_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== COMPUTE_EDGE_FORMAT) {
      throw new Error(
        `${this.label} format must be ${COMPUTE_EDGE_FORMAT}`
      );
    }
    this.targetFactory = options.targetFactory ?? new StorageTargetFactory(gpu, {
      label: this.label,
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
    this.edgePass = new ComputePass(gpu, {
      label: `${this.label}:sobel`,
      code: COMPUTE_EDGE_WGSL,
      uniformFloats: 8,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "scene", type: "sampled-texture" },
        {
          binding: 2,
          name: "output",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        }
      ]
    });
    this.geometryEdgePass = new ComputePass(gpu, {
      label: `${this.label}:sobel-geometry`,
      code: COMPUTE_EDGE_GEOMETRY_WGSL,
      uniformFloats: 16,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "scene", type: "sampled-texture" },
        { binding: 2, name: "normal", type: "sampled-texture" },
        { binding: 3, name: "depth", type: "depth-texture" },
        {
          binding: 4,
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

  // destroy後のencodeやresizeを即座に止め、破棄済みresourceの再利用を防ぎます
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} has been destroyed`);
    }
  }

  // edge強度、閾値、元sceneとのmix比を検証し、shader内clampへ誤入力を隠しません
  validateEncodeOptions(options = {}) {
    return {
      strength: util.readOptionalFiniteNumber(
        options.strength,
        `${this.label} strength`,
        COMPUTE_EDGE_DEFAULTS.strength,
        { min: 0.0 }
      ),
      threshold: util.readOptionalFiniteNumber(
        options.threshold,
        `${this.label} threshold`,
        COMPUTE_EDGE_DEFAULTS.threshold,
        { min: 0.0, max: 1.0 }
      ),
      mix: util.readOptionalFiniteNumber(
        options.mix,
        `${this.label} mix`,
        COMPUTE_EDGE_DEFAULTS.mix,
        { min: 0.0, max: 1.0 }
      ),
      blendMode: util.readOptionalEnum(
        options.blendMode,
        `${this.label} blendMode`,
        COMPUTE_EDGE_DEFAULTS.blendMode,
        COMPUTE_EDGE_BLEND_MODES
      ),
      colorEnabled: util.readOptionalBoolean(
        options.colorEnabled,
        `${this.label} colorEnabled`,
        COMPUTE_EDGE_DEFAULTS.colorEnabled
      ),
      geometryEnabled: util.readOptionalBoolean(
        options.geometryEnabled,
        `${this.label} geometryEnabled`,
        COMPUTE_EDGE_DEFAULTS.geometryEnabled
      ),
      normalWeight: util.readOptionalFiniteNumber(
        options.normalWeight,
        `${this.label} normalWeight`,
        COMPUTE_EDGE_DEFAULTS.normalWeight,
        { min: 0.0 }
      ),
      depthWeight: util.readOptionalFiniteNumber(
        options.depthWeight,
        `${this.label} depthWeight`,
        COMPUTE_EDGE_DEFAULTS.depthWeight,
        { min: 0.0 }
      ),
      thickness: util.readOptionalInteger(
        options.thickness,
        `${this.label} thickness`,
        COMPUTE_EDGE_DEFAULTS.thickness,
        { min: 1, max: 4 }
      ),
      enabled: util.readOptionalBoolean(
        options.enabled,
        `${this.label} enabled`,
        COMPUTE_EDGE_DEFAULTS.enabled
      )
    };
  }

  // 入力sceneがsample可能で、内部出力targetと同じ寸法であることを確認します
  validateScene(scene) {
    if (
      !scene ||
      typeof scene.getView !== "function" ||
      typeof scene.getWidth !== "function" ||
      typeof scene.getHeight !== "function"
    ) {
      throw new Error(`${this.label} scene must be a RenderTarget-compatible resource`);
    }
    const width = util.readFiniteNumber(scene.getWidth(), `${this.label} scene width`, {
      integer: true,
      min: 1
    });
    const height = util.readFiniteNumber(scene.getHeight(), `${this.label} scene height`, {
      integer: true,
      min: 1
    });
    if (width !== this.width || height !== this.height) {
      throw new Error(
        `${this.label} scene size ${width}x${height} does not match output size ${this.width}x${this.height}`
      );
    }
    if (!scene.getView()) {
      throw new Error(`${this.label} scene view is not ready`);
    }
    const sceneFormat = scene.getFormat?.();
    if (!COMPUTE_EDGE_INPUT_FORMATS.includes(sceneFormat)) {
      throw new Error(
        `${this.label} scene format must be ${COMPUTE_EDGE_INPUT_FORMATS.join(" or ")}; `
        + `received ${sceneFormat}`
      );
    }
    return scene;
  }

  // geometry edgeを有効にする場合だけnormal、Camera Reverse-Z depth、Camera Frameを要求します
  validateGeometryResources(options = {}, geometryEnabled = false) {
    const normal = options.normal;
    const depth = options.depth;
    const cameraFrame = options.cameraFrame;
    if (options.projection !== undefined) {
      throw new Error(
        `${this.label} projection option was removed; pass a Reverse-Z CameraFrame`
      );
    }
    const anyProvided = normal !== undefined || depth !== undefined || cameraFrame !== undefined;
    if (!geometryEnabled) {
      if (anyProvided) {
        throw new Error(
          `${this.label} geometry resources require geometryEnabled true`
        );
      }
      return null;
    }
    if (
      !normal ||
      typeof normal.getView !== "function" ||
      typeof normal.getWidth !== "function" ||
      typeof normal.getHeight !== "function"
    ) {
      throw new Error(`${this.label} normal must be a RenderTarget-compatible resource`);
    }
    if (
      !depth ||
      typeof depth.getDepthSampleView !== "function" ||
      typeof depth.getWidth !== "function" ||
      typeof depth.getHeight !== "function" ||
      depth.depthConvention !== CAMERA_REVERSE_Z
    ) {
      throw new Error(`${this.label} depth must use CAMERA_REVERSE_Z and provide a sampleable view`);
    }
    const checkedProjection = createGBufferProjectionParams(cameraFrame);
    const width = util.readFiniteNumber(normal.getWidth(), `${this.label} normal width`, {
      integer: true,
      min: 1
    });
    const height = util.readFiniteNumber(normal.getHeight(), `${this.label} normal height`, {
      integer: true,
      min: 1
    });
    if (width !== this.width || height !== this.height) {
      throw new Error(
        `${this.label} normal size ${width}x${height} does not match output size ${this.width}x${this.height}`
      );
    }
    const depthWidth = util.readFiniteNumber(depth.getWidth(), `${this.label} depth width`, {
      integer: true,
      min: 1
    });
    const depthHeight = util.readFiniteNumber(depth.getHeight(), `${this.label} depth height`, {
      integer: true,
      min: 1
    });
    if (depthWidth !== this.width || depthHeight !== this.height) {
      throw new Error(
        `${this.label} depth size ${depthWidth}x${depthHeight} does not match output size ${this.width}x${this.height}`
      );
    }
    if (!normal.getView()) {
      throw new Error(`${this.label} normal view is not ready`);
    }
    if (!depth.getDepthSampleView()) {
      throw new Error(`${this.label} depth sample view is not ready`);
    }
    return {
      normal,
      depth,
      projection: checkedProjection,
      cameraFrame
    };
  }

  // Sobel edgeの1 dispatchを同じcommand encoderへ追加し、最終output targetを返します
  encode(commandEncoder, scene, options = {}) {
    this.requireAlive();
    if (!commandEncoder || typeof commandEncoder.beginComputePass !== "function") {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    const checkedScene = this.validateScene(scene);
    const params = this.validateEncodeOptions(options);
    const geometry = this.validateGeometryResources(options, params.geometryEnabled);
    const blendModeIndex = params.blendMode === "black-subtract"
      ? 1.0
      : params.blendMode === "white-add"
        ? 2.0
        : 0.0;
    const thicknessRadius = params.thickness - 1.0;
    if (geometry) {
      this.geometryEdgePass.setUniforms([
        params.strength,
        params.threshold,
        params.mix,
        params.enabled ? 1.0 : 0.0,
        blendModeIndex,
        thicknessRadius,
        params.geometryEnabled ? 1.0 : 0.0,
        params.colorEnabled ? 1.0 : 0.0,
        params.normalWeight,
        params.depthWeight,
        0.0,
        0.0,
        ...geometry.projection
      ]);
      this.geometryEdgePass.encode(commandEncoder, {
        scene: checkedScene,
        normal: geometry.normal,
        depth: geometry.depth,
        output: this.outputTarget
      }, {
        timestampWrites: options.timestampWrites
      });
    } else {
      this.edgePass.setUniforms([
        params.strength,
        params.threshold,
        params.mix,
        params.enabled ? 1.0 : 0.0,
        blendModeIndex,
        thicknessRadius,
        0.0,
        0.0
      ]);
      this.edgePass.encode(commandEncoder, {
        scene: checkedScene,
        output: this.outputTarget
      }, {
        timestampWrites: options.timestampWrites
      });
    }
    return this.outputTarget;
  }

  // 入力sceneに追従するよう最終outputを同一寸法へ更新します
  resize(width, height) {
    this.requireAlive();
    const checkedWidth = util.readFiniteNumber(width, `${this.label} width`, {
      integer: true,
      min: 1
    });
    const checkedHeight = util.readFiniteNumber(height, `${this.label} height`, {
      integer: true,
      min: 1
    });
    const outputChanged = resizeTarget(this.outputTarget, checkedWidth, checkedHeight);
    this.width = checkedWidth;
    this.height = checkedHeight;
    return outputChanged;
  }

  // 元sceneへSobel edgeを混ぜた最終targetを返します
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // 内部ComputePassのbinding契約を調べる必要がある場合に限り公開します
  getEdgePass() {
    this.requireAlive();
    return this.edgePass;
  }

  // geometry edge版のbinding契約を調べる必要がある場合に限り公開します
  getGeometryEdgePass() {
    this.requireAlive();
    return this.geometryEdgePass;
  }

  // 所有するComputePassと出力targetを一度だけ破棄します
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.edgePass.destroy();
    this.geometryEdgePass.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
  }
}
