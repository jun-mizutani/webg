// ---------------------------------------------
// ComputeToonPass.js  2026/07/12
//   Linear High Dynamic Range toon quantization pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_TOON_DEFAULTS = Object.freeze({
  levels: 4,
  strength: 1.0,
  gamma: 1.0,
  floor: 0.28,
  enabled: true
});

// ToonはTone Map前に実行し、入力と出力の線形High Dynamic Range値を維持する
export const COMPUTE_TOON_FORMAT = "rgba16float";

export const COMPUTE_TOON_WGSL = `
struct Params {
  values : vec4f,
  control : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var outputTexture : texture_storage_2d<${COMPUTE_TOON_FORMAT}, write>;

// 輝度を2倍ごとのexposure intervalへ分け、各intervalをlevels段階に量子化します
// 0から1へ正規化してclampする方式と異なり、1.0を超えるHigh Dynamic Range輝度も保持します
fn quantizeIntensity(intensity : f32, levels : f32, gammaValue : f32) -> f32 {
  if (intensity <= 0.0) {
    return 0.0;
  }
  let exposureBase = exp2(floor(log2(intensity)));
  let intervalPosition = intensity / exposureBase - 1.0;
  let encoded = pow(intervalPosition, gammaValue);
  let band = floor(encoded * levels + 0.5) / levels;
  let decoded = pow(band, 1.0 / gammaValue);
  return exposureBase * (1.0 + decoded);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dims = textureDimensions(sceneTexture);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  let coord = vec2<i32>(id.xy);
  let source = textureLoad(sceneTexture, coord, 0);
  if (params.values.w < 0.5) {
    textureStore(outputTexture, coord, source);
    return;
  }

  // levels、strength、gamma、floorはCPU側で検証済みの値をそのまま使用します
  let levels = params.values.x;
  let intensity = max(max(source.r, source.g), source.b);
  let quantized = quantizeIntensity(intensity, levels, params.values.z);
  // 1.0未満だけshadow floorを適用し、High Dynamic Range側の輝度は変更しません
  let lifted = select(
    params.control.x + (1.0 - params.control.x) * quantized,
    quantized,
    quantized >= 1.0
  );
  let scale = select(0.0, lifted / intensity, intensity > 0.0001);
  let toon = source.rgb * scale;
  let color = mix(source.rgb, toon, params.values.y);
  textureStore(outputTexture, coord, vec4f(color, source.a));
}`;

// Toon effectでは輪郭線を扱わず、scene color の段階化だけを担当します
// scene描画、Edgeとの組み合わせ順、canvasへのcopyは呼び出し側が所有します
export default class ComputeToonPass {
  // sceneと同寸法のstorage targetと、色段階化用ComputePassを作ります
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeToonPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeToonPass label",
      "compute-toon",
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
      COMPUTE_TOON_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== COMPUTE_TOON_FORMAT) {
      throw new Error(
        `${this.label} format must be ${COMPUTE_TOON_FORMAT}`
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
    this.computePass = new ComputePass(gpu, {
      label: `${this.label}:quantize`,
      code: COMPUTE_TOON_WGSL,
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
    this.ready = this.outputTarget.ready;
    this.destroyed = false;
  }

  // destroy後の利用を例外にし、破棄済みresourceを再利用しません
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} has been destroyed`);
    }
  }

  // 段階数、混合比、gammaを用途に応じた範囲で検証し、誤入力をshader内で隠しません
  validateEncodeOptions(options = {}) {
    return {
      levels: util.readOptionalInteger(
        options.levels,
        `${this.label} levels`,
        COMPUTE_TOON_DEFAULTS.levels,
        { min: 2, max: 16 }
      ),
      strength: util.readOptionalFiniteNumber(
        options.strength,
        `${this.label} strength`,
        COMPUTE_TOON_DEFAULTS.strength,
        { min: 0.0, max: 1.0 }
      ),
      gamma: util.readOptionalFiniteNumber(
        options.gamma,
        `${this.label} gamma`,
        COMPUTE_TOON_DEFAULTS.gamma,
        { minExclusive: 0.0, max: 4.0 }
      ),
      floor: util.readOptionalFiniteNumber(
        options.floor,
        `${this.label} floor`,
        COMPUTE_TOON_DEFAULTS.floor,
        { min: 0.0, max: 1.0 }
      ),
      enabled: util.readOptionalBoolean(
        options.enabled,
        `${this.label} enabled`,
        COMPUTE_TOON_DEFAULTS.enabled
      )
    };
  }

  // 入力sceneが線形rgba16floatで、内部出力targetと同じ寸法であることを確認します
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
    if (scene.getFormat?.() !== COMPUTE_TOON_FORMAT) {
      throw new Error(`${this.label} scene format must be ${COMPUTE_TOON_FORMAT}`);
    }
    if (!scene.getView()) {
      throw new Error(`${this.label} scene view is not ready`);
    }
    return scene;
  }

  // 1 dispatchで色段階化を実行し、最終output targetを返します
  encode(commandEncoder, scene, options = {}) {
    this.requireAlive();
    if (!commandEncoder || typeof commandEncoder.beginComputePass !== "function") {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    const checkedScene = this.validateScene(scene);
    const params = this.validateEncodeOptions(options);
    this.computePass.setUniforms([
      params.levels,
      params.strength,
      params.gamma,
      params.enabled ? 1.0 : 0.0,
      params.floor,
      0.0,
      0.0,
      0.0
    ]);
    this.computePass.encode(commandEncoder, {
      scene: checkedScene,
      output: this.outputTarget
    }, {
      timestampWrites: options.timestampWrites
    });
    return this.outputTarget;
  }

  // 入力sceneと同じ寸法で処理できるよう内部targetを更新します
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

  // 元sceneを段階化した最終targetを返します
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // 内部ComputePassのbinding契約を調べる必要がある場合に限り公開します
  getComputePass() {
    this.requireAlive();
    return this.computePass;
  }

  // 所有するComputePassと出力targetを一度だけ破棄します
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.computePass.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
  }
}
