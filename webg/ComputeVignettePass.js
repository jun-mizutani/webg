// ---------------------------------------------
// ComputeVignettePass.js  2026/07/25
//   Final display-color vignette compute pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_VIGNETTE_FORMAT = "rgba8unorm";
export const COMPUTE_VIGNETTE_DEFAULTS = Object.freeze({
  center: Object.freeze([0.5, 0.5]),
  radius: 0.9,
  softness: 0.35,
  strength: 0.65,
  tint: Object.freeze([0.0, 0.0, 0.0]),
  enabled: false
});

export const COMPUTE_VIGNETTE_WGSL = `
struct Params {
  vignette : vec4f,
  control : vec4f,
  tint : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var outputTexture : texture_storage_2d<${COMPUTE_VIGNETTE_FORMAT}, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dims = textureDimensions(outputTexture);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  let coord = vec2<i32>(id.xy);
  let source = textureLoad(sceneTexture, coord, 0);
  if (params.control.y < 0.5) {
    textureStore(outputTexture, coord, source);
    return;
  }

  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(dims);
  var delta = uv - params.vignette.xy;
  delta.x *= f32(dims.x) / max(f32(dims.y), 1.0);
  let outerRadius = params.vignette.z;
  let innerRadius = max(outerRadius - params.vignette.w, 0.0);
  let edge = smoothstep(innerRadius, outerRadius, length(delta));
  let tintMix = edge * params.control.x;
  let color = source.rgb * mix(vec3f(1.0), params.tint.rgb, tintMix);
  textureStore(outputTexture, coord, vec4f(color, source.a));
}`;

// Tone MapとEdgeを終えた表示色全体へ周辺減光を適用します。
export default class ComputeVignettePass {
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeVignettePass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeVignettePass label",
      "compute-vignette",
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
      COMPUTE_VIGNETTE_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== COMPUTE_VIGNETTE_FORMAT) {
      throw new Error(`${this.label} format must be ${COMPUTE_VIGNETTE_FORMAT}`);
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
      code: COMPUTE_VIGNETTE_WGSL,
      uniformFloats: 12,
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
    this.ready = this.outputTarget.ready;
    this.destroyed = false;
  }

  // 使用可能状態を検証し、後続処理が扱える共通形式へ整える
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} has been destroyed`);
    }
  }

  // シーンを検証し、後続処理が扱える共通形式へ整える
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
        `${this.label} scene size ${width}x${height} does not match output size `
        + `${this.width}x${this.height}`
      );
    }
    if (scene.getFormat?.() !== this.format) {
      throw new Error(`${this.label} scene format must be ${this.format}`);
    }
    if (!scene.getView()) {
      throw new Error(`${this.label} scene view is not ready`);
    }
    return scene;
  }

  // `encode`の設定値を検証し、後続処理が扱える共通形式へ整える
  validateEncodeOptions(options = {}) {
    const center = options.center === undefined
      ? [...COMPUTE_VIGNETTE_DEFAULTS.center]
      : (() => {
          if (!Array.isArray(options.center) || options.center.length < 2) {
            throw new Error(`${this.label} center must be a 2 element array`);
          }
          return [
            util.readFiniteNumber(options.center[0], `${this.label} center[0]`),
            util.readFiniteNumber(options.center[1], `${this.label} center[1]`)
          ];
        })();
    const radius = util.readOptionalFiniteNumber(
      options.radius,
      `${this.label} radius`,
      COMPUTE_VIGNETTE_DEFAULTS.radius,
      { minExclusive: 0.0 }
    );
    const softness = util.readOptionalFiniteNumber(
      options.softness,
      `${this.label} softness`,
      COMPUTE_VIGNETTE_DEFAULTS.softness,
      { minExclusive: 0.0, max: radius }
    );
    const tint = util.readColor(
      options.tint,
      `${this.label} tint`,
      COMPUTE_VIGNETTE_DEFAULTS.tint,
      3
    );
    for (let index = 0; index < tint.length; index++) {
      if (tint[index] < 0.0) {
        throw new Error(`${this.label} tint[${index}] must be >= 0`);
      }
    }
    return {
      center,
      radius,
      softness,
      strength: util.readOptionalFiniteNumber(
        options.strength,
        `${this.label} strength`,
        COMPUTE_VIGNETTE_DEFAULTS.strength,
        { min: 0.0, max: 1.0 }
      ),
      tint,
      enabled: util.readOptionalBoolean(
        options.enabled,
        `${this.label} enabled`,
        COMPUTE_VIGNETTE_DEFAULTS.enabled
      )
    };
  }

  // このインスタンスの描画段階で、必要な描画命令と表示内容を記録する
  encode(commandEncoder, scene, options = {}) {
    this.requireAlive();
    if (!commandEncoder || typeof commandEncoder.beginComputePass !== "function") {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    const checkedScene = this.validateScene(scene);
    const params = this.validateEncodeOptions(options);
    this.computePass.setUniforms([
      params.center[0], params.center[1], params.radius, params.softness,
      params.strength, params.enabled ? 1.0 : 0.0, 0.0, 0.0,
      params.tint[0], params.tint[1], params.tint[2], 0.0
    ]);
    this.computePass.encode(commandEncoder, {
      scene: checkedScene,
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
