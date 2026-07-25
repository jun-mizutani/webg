// ---------------------------------------------
// ComputeImagePyramid.js  2026/07/25
//   Continuous low-pass image pyramid for Compute effects
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_IMAGE_PYRAMID_DEFAULT_LEVELS = Object.freeze([2, 4, 8]);
export const COMPUTE_IMAGE_PYRAMID_DEFAULTS = Object.freeze({
  filterRadius: 1.0
});

// 1つ前のLevelを13 tapの連続low-pass filterで1/2へ縮小します
// 離れたtexelだけを読む間引きではなく、linear samplerを使う重なった近傍sampleで
// 高周波成分を除いてから次の低解像度Levelへ書き込みます
export const COMPUTE_IMAGE_PYRAMID_DOWNSAMPLE_WGSL = `
struct Params {
  filterRadius : f32,
  reserved0 : f32,
  reserved1 : f32,
  reserved2 : f32,
};
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sourceTexture : texture_2d<f32>;
@group(0) @binding(2) var sourceSampler : sampler;
@group(0) @binding(3) var outputTexture : texture_storage_2d<rgba16float, write>;

fn readSource(uv : vec2f, offset : vec2f, texel : vec2f) -> vec4f {
  return textureSampleLevel(
    sourceTexture,
    sourceSampler,
    uv + offset * texel * params.filterRadius,
    0.0
  );
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDims = textureDimensions(outputTexture);
  if (id.x >= outputDims.x || id.y >= outputDims.y) {
    return;
  }

  let sourceDims = textureDimensions(sourceTexture);
  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(outputDims);
  let texel = vec2f(1.0) / vec2f(sourceDims);

  // 中心、内側対角、外側軸、外側対角を合計1.0の重みで合成します
  // 各段で低域通過処理を行うため、縮小を重ねても櫛状patternを残しません
  var color = readSource(uv, vec2f(0.0, 0.0), texel) * 0.125;
  color += (
    readSource(uv, vec2f(-1.0, -1.0), texel)
    + readSource(uv, vec2f(1.0, -1.0), texel)
    + readSource(uv, vec2f(-1.0, 1.0), texel)
    + readSource(uv, vec2f(1.0, 1.0), texel)
  ) * 0.03125;
  color += (
    readSource(uv, vec2f(-2.0, 0.0), texel)
    + readSource(uv, vec2f(2.0, 0.0), texel)
    + readSource(uv, vec2f(0.0, -2.0), texel)
    + readSource(uv, vec2f(0.0, 2.0), texel)
  ) * 0.0625;
  color += (
    readSource(uv, vec2f(-2.0, -2.0), texel)
    + readSource(uv, vec2f(2.0, -2.0), texel)
    + readSource(uv, vec2f(-2.0, 2.0), texel)
    + readSource(uv, vec2f(2.0, 2.0), texel)
  ) * 0.125;
  textureStore(outputTexture, vec2<i32>(id.xy), color);
}`;

// 画面寸法をLevelの縮小率で割り、端数がある場合も最低1 pixelを保持します
export function computePyramidDimension(value, divisor, label) {
  const checkedValue = util.readFiniteNumber(value, label, {
    integer: true,
    min: 1
  });
  const checkedDivisor = util.readFiniteNumber(divisor, `${label} divisor`, {
    integer: true,
    min: 2
  });
  return Math.max(1, Math.round(checkedValue / checkedDivisor));
}

// 連続した2の累乗だけを受け付け、内部で暗黙のLevelを生成しないようにします
export function validatePyramidLevels(levels, label = "ComputeImagePyramid levels") {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const validated = levels.map((level, index) => util.readFiniteNumber(
    level,
    `${label}[${index}]`,
    { integer: true, min: 2 }
  ));
  validated.forEach((level, index) => {
    const expected = 2 ** (index + 1);
    if (level !== expected) {
      throw new Error(
        `${label}[${index}] must be ${expected} so every Level has an explicit source`
      );
    }
  });
  return Object.freeze(validated);
}

export default class ComputeImagePyramid {
  // 出力formatと必要Levelを固定し、Levelごとのstorage targetを生成します
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeImagePyramid requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeImagePyramid label",
      "compute-image-pyramid",
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
      "rgba16float",
      { trim: true, allowEmpty: false }
    );
    if (this.format !== "rgba16float") {
      throw new Error(`${this.label} format must be rgba16float`);
    }
    this.levels = validatePyramidLevels(
      options.levels ?? COMPUTE_IMAGE_PYRAMID_DEFAULT_LEVELS,
      `${this.label} levels`
    );
    this.targetFactory = new StorageTargetFactory(gpu, {
      label: `${this.label}:storage`,
      format: this.format
    });
    this.targets = new Map();
    for (const divisor of this.levels) {
      this.targets.set(divisor, this.targetFactory.create({
        label: `${this.label}:level-${divisor}`,
        width: computePyramidDimension(
          this.width,
          divisor,
          `${this.label} level-${divisor} width`
        ),
        height: computePyramidDimension(
          this.height,
          divisor,
          `${this.label} level-${divisor} height`
        ),
        format: this.format
      }));
    }
    this.downsamplePass = new ComputePass(this.gpu, {
      label: `${this.label}:downsample-pass`,
      code: COMPUTE_IMAGE_PYRAMID_DOWNSAMPLE_WGSL,
      uniformFloats: 4,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "source", type: "sampled-texture" },
        { binding: 2, name: "sampler", type: "sampler" },
        {
          binding: 3,
          name: "output",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        }
      ]
    });
    this.ready = Promise.all(
      Array.from(this.targets.values(), (target) => target.ready)
    );
    this.destroyed = false;
  }

  // 使用可能状態を検証し、後続処理が扱える共通形式へ整える
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} has been destroyed`);
    }
  }

  // 入力はfull-resolutionで、全Levelと同じformatを持つ必要があります
  validateSource(source) {
    if (!source?.getView || !source?.getWidth || !source?.getHeight) {
      throw new Error(`${this.label} source must be a RenderTarget-compatible resource`);
    }
    const width = util.readFiniteNumber(source.getWidth(), `${this.label} source width`, {
      integer: true,
      min: 1
    });
    const height = util.readFiniteNumber(source.getHeight(), `${this.label} source height`, {
      integer: true,
      min: 1
    });
    if (width !== this.width || height !== this.height) {
      throw new Error(
        `${this.label} source size ${width}x${height} does not match ${this.width}x${this.height}`
      );
    }
    if (!source.getView()) {
      throw new Error(`${this.label} source view is not ready`);
    }
    if (source.getFormat?.() !== this.format) {
      throw new Error(`${this.label} source format must be ${this.format}`);
    }
    if (!source.getSampler?.()) {
      throw new Error(`${this.label} source sampler is not ready`);
    }
    return source;
  }

  // full-resolution入力から最小Levelまでを順番に同じcommand encoderへ記録します
  encode(commandEncoder, source, options = {}) {
    this.requireAlive();
    if (!commandEncoder?.beginComputePass) {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    let currentSource = this.validateSource(source);
    const filterRadius = util.readOptionalFiniteNumber(
      options.filterRadius,
      `${this.label} filterRadius`,
      COMPUTE_IMAGE_PYRAMID_DEFAULTS.filterRadius,
      { min: 0.25, max: 3.0 }
    );
    // 全Levelで同じ半径を使い、解像度が下がるごとに画面上のfilter幅が自然に広がるようにします
    this.downsamplePass.setUniforms([filterRadius, 0.0, 0.0, 0.0]);
    const timestampWrites = options.timestampWrites;
    this.levels.forEach((divisor, index) => {
      const output = this.targets.get(divisor);
      const firstTimestampWrites = index === 0 &&
        timestampWrites?.beginningOfPassWriteIndex !== undefined
        ? {
            querySet: timestampWrites.querySet,
            beginningOfPassWriteIndex: timestampWrites.beginningOfPassWriteIndex
          }
        : undefined;
      const lastTimestampWrites = index === this.levels.length - 1 &&
        timestampWrites?.endOfPassWriteIndex !== undefined
        ? {
            querySet: timestampWrites.querySet,
            endOfPassWriteIndex: timestampWrites.endOfPassWriteIndex
          }
        : undefined;
      const passTimestampWrites = firstTimestampWrites ?? lastTimestampWrites;
      if (firstTimestampWrites && lastTimestampWrites) {
        passTimestampWrites.endOfPassWriteIndex = lastTimestampWrites.endOfPassWriteIndex;
      }
      this.downsamplePass.encode(commandEncoder, {
        source: currentSource,
        sampler: currentSource.getSampler(),
        output
      }, {
        timestampWrites: passTimestampWrites
      });
      currentSource = output;
    });
    return currentSource;
  }

  // 縮小率を明示してLevelを取得し、未生成Levelへの参照を早期に検出します
  getLevel(divisor) {
    this.requireAlive();
    const checkedDivisor = util.readFiniteNumber(
      divisor,
      `${this.label} level`,
      { integer: true, min: 2 }
    );
    const target = this.targets.get(checkedDivisor);
    if (!target) {
      throw new Error(`${this.label} does not contain level ${checkedDivisor}`);
    }
    return target;
  }

  // `levels`を現在の入力と状態から求め、呼び出し元へ返す
  getLevels() {
    this.requireAlive();
    return [...this.levels];
  }

  // Canvas寸法変更時は保持しているLevelだけを同じ縮小率で再生成します
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
    let changed = false;
    for (const divisor of this.levels) {
      const resized = resizeTarget(
        this.targets.get(divisor),
        computePyramidDimension(
          this.width,
          divisor,
          `${this.label} level-${divisor} width`
        ),
        computePyramidDimension(
          this.height,
          divisor,
          `${this.label} level-${divisor} height`
        )
      );
      changed = resized || changed;
    }
    return changed;
  }

  // 内部ComputePassと全Levelのtextureを一度だけ破棄します
  destroy() {
    if (this.destroyed) return false;
    this.downsamplePass.destroy();
    for (const target of this.targets.values()) {
      target.destroy();
    }
    this.targets.clear();
    this.destroyed = true;
    return true;
  }
}
