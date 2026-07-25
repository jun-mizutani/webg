// ---------------------------------------------
// ComputeEffectComposer.js  2026/07/12
//   Linear High Dynamic Range reflection compositor
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import { GBUFFER_WGSL_COMMON } from "./GeometryBufferPass.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_EFFECT_COMPOSER_MODES = Object.freeze([
  "add",
  "mix"
]);

export const COMPUTE_EFFECT_COMPOSER_FORMAT = "rgba16float";

export const COMPUTE_EFFECT_COMPOSER_WGSL = `
struct Params {
  mode : f32,
  reserved0 : f32,
  reserved1 : f32,
  reserved2 : f32,
};

${GBUFFER_WGSL_COMMON}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var baseTexture : texture_2d<f32>;
@group(0) @binding(2) var reflectionTexture : texture_2d<f32>;
@group(0) @binding(3) var depthTexture : texture_depth_2d;
@group(0) @binding(4) var outputTexture : texture_storage_2d<${COMPUTE_EFFECT_COMPOSER_FORMAT}, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dims = textureDimensions(outputTexture);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let reflectionDims = textureDimensions(reflectionTexture);
  let base = textureLoad(baseTexture, coord, 0).rgb;
  let depth = textureLoad(depthTexture, coord, 0);
  let reflectionUv = (vec2f(coord) + vec2f(0.5)) / vec2f(dims);
  let reflectionCoord = clamp(
    vec2<i32>(reflectionUv * vec2f(reflectionDims)),
    vec2<i32>(0),
    vec2<i32>(reflectionDims) - vec2<i32>(1)
  );
  let reflection = textureLoad(reflectionTexture, reflectionCoord, 0);
  var linearColor = base;
  if (!isGBufferBackgroundDepth(depth)) {
    let reflectionWeight = clamp(reflection.a, 0.0, 1.0);
    if (i32(params.mode) == 1) {
      linearColor = mix(base, reflection.rgb, reflectionWeight);
    } else {
      linearColor = base + reflection.rgb * reflectionWeight;
    }
  }
  // Tone Map前の輝度を保持するため、合成後の0から1 clampを行わない
  textureStore(outputTexture, coord, vec4f(linearColor, 1.0));
}`;

export default class ComputeEffectComposer {
  // Tone Map前の線形High Dynamic Range合成targetとComputePassを初期化する
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeEffectComposer requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeEffectComposer label",
      "compute-effect:composer",
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(options.width, `${this.label} width`, 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, `${this.label} height`, 1, { min: 1 });
    this.format = util.readOptionalString(
      options.format,
      `${this.label} format`,
      COMPUTE_EFFECT_COMPOSER_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== COMPUTE_EFFECT_COMPOSER_FORMAT) {
      throw new Error(`${this.label} format must be ${COMPUTE_EFFECT_COMPOSER_FORMAT}`);
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
      code: COMPUTE_EFFECT_COMPOSER_WGSL,
      uniformFloats: 4,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "base", type: "sampled-texture" },
        { binding: 2, name: "reflection", type: "sampled-texture" },
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

  // base、reflection、depthの形式と寸法を検証し、誤った色空間や深度規約を拒否する
  validateResources(resources) {
    const base = resources?.base;
    const reflection = resources?.reflection;
    const depth = resources?.depth;
    for (const [name, target] of [["base", base], ["reflection", reflection]]) {
      if (!target || typeof target.getView !== "function") {
        throw new Error(`${this.label} resources require ${name} target`);
      }
      if (target.getFormat?.() !== COMPUTE_EFFECT_COMPOSER_FORMAT) {
        throw new Error(
          `${this.label} ${name} format must be ${COMPUTE_EFFECT_COMPOSER_FORMAT}`
        );
      }
    }
    if (
      typeof depth?.getDepthSampleView !== "function" ||
      depth.depthConvention !== CAMERA_REVERSE_Z
    ) {
      throw new Error(
        `${this.label} resources require CAMERA_REVERSE_Z depth target`
      );
    }
    for (const [name, target] of [["base", base], ["depth", depth]]) {
      const width = target.getWidth?.();
      const height = target.getHeight?.();
      if (width !== this.width || height !== this.height) {
        throw new Error(
          `${this.label} ${name} size ${width}x${height} does not match output size `
          + `${this.width}x${this.height}`
        );
      }
    }
    util.readFiniteNumber(
      reflection.getWidth?.(),
      `${this.label} reflection width`,
      { integer: true, min: 1 }
    );
    util.readFiniteNumber(
      reflection.getHeight?.(),
      `${this.label} reflection height`,
      { integer: true, min: 1 }
    );
    return { base, reflection, depth };
  }

  // Deferred Lighting済みbaseとSSR反射を線形領域で合成して出力する
  encode(commandEncoder, resources, options = {}) {
    this.requireAlive();
    const checkedResources = this.validateResources(resources);
    const mode = util.readOptionalEnum(
      options.mode,
      `${this.label} mode`,
      "mix",
      COMPUTE_EFFECT_COMPOSER_MODES
    );
    this.computePass.setUniforms(new Float32Array([
      mode === "mix" ? 1 : 0,
      0,
      0,
      0
    ]));
    this.computePass.encode(commandEncoder, {
      base: checkedResources.base,
      reflection: checkedResources.reflection,
      depth: checkedResources.depth,
      output: this.outputTarget
    }, {
      timestampWrites: options.timestampWrites
    });
    return this.outputTarget;
  }

  // 画面サイズ変更に合わせて出力ターゲットをリサイズする
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

  // 最終合成結果の出力ターゲットを返す
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // 破棄済みインスタンスへの操作を防ぐ
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  // 所有しているGPUリソースを破棄する
  destroy() {
    if (this.destroyed) return false;
    this.computePass.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
