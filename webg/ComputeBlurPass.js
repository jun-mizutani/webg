// ---------------------------------------------
// ComputeBlurPass.js  2026/07/13
//   Separable linear High Dynamic Range blur pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import StorageTargetFactory from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_BLUR_DEFAULTS = Object.freeze({
  radius: 3,
  iterations: 1
});

export const COMPUTE_BLUR_FORMAT = "rgba16float";

export const COMPUTE_BLUR_WGSL = `
struct Params {
  direction : vec2f,
  radius : f32,
  pad : f32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sourceTexture : texture_2d<f32>;
@group(0) @binding(2) var outputTexture : texture_storage_2d<${COMPUTE_BLUR_FORMAT}, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dimsU = textureDimensions(sourceTexture);
  if (id.x >= dimsU.x || id.y >= dimsU.y) {
    return;
  }

  let dims = vec2<i32>(dimsU);
  let coord = vec2<i32>(id.xy);
  // radiusはCPU側で1から8の整数として検証済みです
  let radius = i32(params.radius);
  let direction = vec2<i32>(round(params.direction));
  var sum = vec4f(0.0);
  var weightSum = 0.0;

  // 固定loop内で指定radiusだけを使用し、pipeline生成時に上限を確定できるようにします
  for (var i = -8; i <= 8; i += 1) {
    if (abs(i) <= radius) {
      let p = clamp(coord + direction * i, vec2<i32>(0), dims - vec2<i32>(1));
      let x = f32(i) / f32(radius);
      let weight = exp(-x * x * 2.0);
      sum += textureLoad(sourceTexture, p, 0) * weight;
      weightSum += weight;
    }
  }
  textureStore(outputTexture, coord, sum / weightSum);
}`;

// 水平と垂直の2回に分けたblurを、2個のStorage RenderTargetへ順番に書き込みます
// command encoderとRender Passの終了時点は呼び出し側が所有し、このclassはCompute処理だけをencodeします
export default class ComputeBlurPass {
  // 出力寸法とStorage Targetの生成規則を検証し、水平・垂直用のComputePassを別々に作ります
  // Uniform Bufferを共有するとsubmit前の最後の値で両dispatchが動くため、方向ごとに専用Bufferを持たせます
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeBlurPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeBlurPass label",
      "compute-blur",
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
      COMPUTE_BLUR_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== COMPUTE_BLUR_FORMAT) {
      throw new Error(
        `${this.label} format must be ${COMPUTE_BLUR_FORMAT}`
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

    this.targets = this.targetFactory.createPingPong({
      label: this.label,
      width: this.width,
      height: this.height,
      format: this.format
    });
    [this.intermediateTarget, this.outputTarget] = this.targets.getResources();
    this.horizontalPass = this.createDirectionalPass("horizontal");
    this.verticalPass = this.createDirectionalPass("vertical");
    this.ready = this.targets.ready;
    this.destroyed = false;
  }

  // 方向だけが異なる同一WGSLのComputePassを作り、bindingとdispatch基準を共通化します
  createDirectionalPass(direction) {
    return new ComputePass(this.gpu, {
      label: `${this.label}:${direction}`,
      code: COMPUTE_BLUR_WGSL,
      uniformFloats: 4,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "source", type: "sampled-texture" },
        {
          binding: 2,
          name: "output",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        }
      ]
    });
  }

  // destroy後のresource利用をその場で検出し、破棄済みGPU objectへcommandを積みません
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} has been destroyed`);
    }
  }

  // blur半径と反復回数を検証し、shaderが対応しない値をclampせず例外にします
  validateEncodeOptions(options = {}) {
    return {
      radius: util.readOptionalInteger(
        options.radius,
        `${this.label} radius`,
        COMPUTE_BLUR_DEFAULTS.radius,
        { min: 1, max: 8 }
      ),
      iterations: util.readOptionalInteger(
        options.iterations,
        `${this.label} iterations`,
        COMPUTE_BLUR_DEFAULTS.iterations,
        { min: 1 }
      )
    };
  }

  // 入力targetがsample可能で、内部の出力targetと同じpixel寸法を持つことを確認します
  // 寸法不一致を部分blurとして扱うと意図しない範囲だけが更新されるため、encode前に拒否します
  validateSource(source) {
    if (
      !source ||
      typeof source.getView !== "function" ||
      typeof source.getWidth !== "function" ||
      typeof source.getHeight !== "function"
    ) {
      throw new Error(`${this.label} source must be a RenderTarget-compatible resource`);
    }
    const width = util.readFiniteNumber(
      source.getWidth(),
      `${this.label} source width`,
      { integer: true, min: 1 }
    );
    const height = util.readFiniteNumber(
      source.getHeight(),
      `${this.label} source height`,
      { integer: true, min: 1 }
    );
    if (width !== this.width || height !== this.height) {
      throw new Error(
        `${this.label} source size ${width}x${height} does not match output size ${this.width}x${this.height}`
      );
    }
    if (!source.getView()) {
      throw new Error(`${this.label} source view is not ready`);
    }
    if (source.getFormat?.() !== this.format) {
      throw new Error(`${this.label} source format must be ${this.format}`);
    }
    return source;
  }

  // 1 iterationにつき水平と垂直の2 dispatchを同じcommand encoderへ順番に追加します
  // 2回目以降は直前の垂直結果を入力にし、戻り値は常に最終output targetとします
  encode(commandEncoder, source, options = {}) {
    this.requireAlive();
    if (!commandEncoder || typeof commandEncoder.beginComputePass !== "function") {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    let current = this.validateSource(source);
    const { radius, iterations } = this.validateEncodeOptions(options);
    const timestampWrites = options.timestampWrites;
    for (let index = 0; index < iterations; index += 1) {
      const horizontalTimestampWrites = index === 0 && timestampWrites?.beginningOfPassWriteIndex !== undefined
        ? {
            querySet: timestampWrites.querySet,
            beginningOfPassWriteIndex: timestampWrites.beginningOfPassWriteIndex
          }
        : undefined;
      const verticalTimestampWrites = index === iterations - 1 && timestampWrites?.endOfPassWriteIndex !== undefined
        ? {
            querySet: timestampWrites.querySet,
            endOfPassWriteIndex: timestampWrites.endOfPassWriteIndex
          }
        : undefined;
      this.horizontalPass.setUniforms([1.0, 0.0, radius, 0.0]);
      this.horizontalPass.encode(commandEncoder, {
        source: current,
        output: this.intermediateTarget
      }, {
        timestampWrites: horizontalTimestampWrites
      });

      this.verticalPass.setUniforms([0.0, 1.0, radius, 0.0]);
      this.verticalPass.encode(commandEncoder, {
        source: this.intermediateTarget,
        output: this.outputTarget
      }, {
        timestampWrites: verticalTimestampWrites
      });
      current = this.outputTarget;
    }
    return this.outputTarget;
  }

  // viewport変更時に2個の内部targetを同じ寸法へ変更し、一方だけ古い状態を残しません
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
    const changed = this.targets.resize(checkedWidth, checkedHeight);
    this.width = checkedWidth;
    this.height = checkedHeight;
    return changed;
  }

  // 水平blur直後のtargetを返し、方向別のdebug表示や検証で使用します
  getIntermediateTarget() {
    this.requireAlive();
    return this.intermediateTarget;
  }

  // 垂直blurまで完了した最終targetを返します
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // 内部2 targetを所有するPingPongTargetを返し、resource構成の調査に使用します
  getTargets() {
    this.requireAlive();
    return this.targets;
  }

  // 所有するComputePassとStorage RenderTargetを一度だけ破棄します
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.horizontalPass.destroy();
    this.verticalPass.destroy();
    this.targets.destroy();
    this.destroyed = true;
  }
}
