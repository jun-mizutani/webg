// ---------------------------------------------
// ComputeFogPass.js  2026/07/25
//   Full-screen High Dynamic Range fog using opaque G-buffer depth
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import {
  createGBufferProjectionParams,
  GBUFFER_WGSL_COMMON
} from "./GeometryBufferPass.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_FOG_FORMAT = "rgba16float";
export const COMPUTE_FOG_MODES = Object.freeze(["linear", "exp"]);
export const COMPUTE_FOG_DEFAULTS = Object.freeze({
  color: Object.freeze([0.1, 0.15, 0.1]),
  near: 20.0,
  far: 80.0,
  density: 0.03,
  mode: "linear",
  enabled: false
});

export const COMPUTE_FOG_WGSL = `
struct Params {
  projection : vec4f,
  fogColor : vec4f,
  fog : vec4f,
};

${GBUFFER_WGSL_COMMON}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var depthTexture : texture_depth_2d;
@group(0) @binding(3) var outputTexture : texture_storage_2d<${COMPUTE_FOG_FORMAT}, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dimsU = textureDimensions(outputTexture);
  if (id.x >= dimsU.x || id.y >= dimsU.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let dims = vec2<i32>(dimsU);
  let scene = textureLoad(sceneTexture, coord, 0);
  let depth = textureLoad(depthTexture, coord, 0);
  let mode = i32(params.fog.w);

  // 不透明geometryがないpixelでは距離を推測せず、透明合成済みsceneをそのまま保持します。
  if (mode == 0 || isGBufferBackgroundDepth(depth)) {
    textureStore(outputTexture, coord, scene);
    return;
  }

  let viewPosition = reconstructGBufferViewPosition(coord, depth, dims, params.projection);
  let fogDistance = length(viewPosition);
  var visibility = 1.0;
  if (mode == 1) {
    let fogRange = max(params.fog.y - params.fog.x, 0.0001);
    let linearVisibility = clamp((params.fog.y - fogDistance) / fogRange, 0.0, 1.0);
    let linearWeight = clamp(params.fog.z * 50.0, 0.0, 1.0);
    visibility = 1.0 - (1.0 - linearVisibility) * linearWeight;
  } else {
    visibility = clamp(exp(-params.fog.z * fogDistance), 0.0, 1.0);
  }

  let color = mix(params.fogColor.rgb, scene.rgb, visibility);
  textureStore(outputTexture, coord, vec4f(color, scene.a));
}`;

// 透明合成済みHDR sceneへ、不透明G-buffer深度を使った距離fogを一度だけ適用します。
export default class ComputeFogPass {
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeFogPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeFogPass label",
      "compute-fog",
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
      COMPUTE_FOG_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== COMPUTE_FOG_FORMAT) {
      throw new Error(`${this.label} format must be ${COMPUTE_FOG_FORMAT}`);
    }
    this.targetFactory = options.targetFactory ?? new StorageTargetFactory(gpu, {
      label: this.label,
      format: this.format
    });
    if (this.targetFactory.format !== this.format) {
      throw new Error(`${this.label} StorageTargetFactory format must be ${this.format}`);
    }
    this.outputTarget = this.targetFactory.create({
      label: `${this.label}:output`,
      width: this.width,
      height: this.height,
      format: this.format
    });
    this.computePass = new ComputePass(gpu, {
      label: `${this.label}:apply`,
      code: COMPUTE_FOG_WGSL,
      uniformFloats: 12,
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

  // 使用可能状態を検証し、後続処理が扱える共通形式へ整える
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} has been destroyed`);
    }
  }

  // 資源を検証し、後続処理が扱える共通形式へ整える
  validateResources(resources) {
    const scene = resources?.scene;
    const depth = resources?.depth;
    if (!scene || typeof scene.getView !== "function") {
      throw new Error(`${this.label} resources require scene target`);
    }
    if (scene.getFormat?.() !== this.format) {
      throw new Error(`${this.label} scene format must be ${this.format}`);
    }
    if (
      !depth ||
      typeof depth.getDepthSampleView !== "function" ||
      depth.depthConvention !== CAMERA_REVERSE_Z
    ) {
      throw new Error(`${this.label} resources require CAMERA_REVERSE_Z depth target`);
    }
    for (const [name, target] of [["scene", scene], ["depth", depth]]) {
      const width = util.readFiniteNumber(target.getWidth?.(), `${this.label} ${name} width`, {
        integer: true,
        min: 1
      });
      const height = util.readFiniteNumber(target.getHeight?.(), `${this.label} ${name} height`, {
        integer: true,
        min: 1
      });
      if (width !== this.width || height !== this.height) {
        throw new Error(
          `${this.label} ${name} size ${width}x${height} does not match output size `
          + `${this.width}x${this.height}`
        );
      }
    }
    if (!scene.getView()) {
      throw new Error(`${this.label} scene view is not ready`);
    }
    if (!depth.getDepthSampleView()) {
      throw new Error(`${this.label} depth sample view is not ready`);
    }
    return { scene, depth };
  }

  // `encode`の設定値を検証し、後続処理が扱える共通形式へ整える
  validateEncodeOptions(options = {}) {
    const color = util.readColor(
      options.color,
      `${this.label} color`,
      COMPUTE_FOG_DEFAULTS.color,
      3
    );
    for (let index = 0; index < color.length; index++) {
      if (color[index] < 0.0) {
        throw new Error(`${this.label} color[${index}] must be >= 0`);
      }
    }
    const near = util.readOptionalFiniteNumber(
      options.near,
      `${this.label} near`,
      COMPUTE_FOG_DEFAULTS.near,
      { min: 0.0 }
    );
    const far = util.readOptionalFiniteNumber(
      options.far,
      `${this.label} far`,
      COMPUTE_FOG_DEFAULTS.far,
      { minExclusive: 0.0 }
    );
    if (far <= near) {
      throw new Error(`${this.label} far must be greater than near`);
    }
    return {
      color,
      near,
      far,
      density: util.readOptionalFiniteNumber(
        options.density,
        `${this.label} density`,
        COMPUTE_FOG_DEFAULTS.density,
        { min: 0.0 }
      ),
      mode: util.readOptionalEnum(
        options.mode,
        `${this.label} mode`,
        COMPUTE_FOG_DEFAULTS.mode,
        COMPUTE_FOG_MODES
      ),
      enabled: util.readOptionalBoolean(
        options.enabled,
        `${this.label} enabled`,
        COMPUTE_FOG_DEFAULTS.enabled
      )
    };
  }

  // このインスタンスの描画段階で、必要な描画命令と表示内容を記録する
  encode(commandEncoder, resources, options = {}) {
    this.requireAlive();
    if (!commandEncoder || typeof commandEncoder.beginComputePass !== "function") {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    const checkedResources = this.validateResources(resources);
    const params = this.validateEncodeOptions(options);
    const projection = createGBufferProjectionParams(options.cameraFrame);
    const mode = !params.enabled ? 0.0 : params.mode === "linear" ? 1.0 : 2.0;
    this.computePass.setUniforms([
      ...projection,
      params.color[0], params.color[1], params.color[2], 0.0,
      params.near, params.far, params.density, mode
    ]);
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
    const checkedWidth = util.readFiniteNumber(width, `${this.label} width`, {
      integer: true,
      min: 1
    });
    const checkedHeight = util.readFiniteNumber(height, `${this.label} height`, {
      integer: true,
      min: 1
    });
    const changed = resizeTarget(this.outputTarget, checkedWidth, checkedHeight);
    this.width = checkedWidth;
    this.height = checkedHeight;
    return changed;
  }

  // 出力の対象を現在の入力と状態から求め、呼び出し元へ返す
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // `compute`の処理を現在の入力と状態から求め、呼び出し元へ返す
  getComputePass() {
    this.requireAlive();
    return this.computePass;
  }

  // このインスタンスが保持する資源と参照を安全に解放する
  destroy() {
    if (this.destroyed) return;
    this.computePass.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
  }
}
