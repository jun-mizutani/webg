// ---------------------------------------------
// ComputePyramidBlurPass.js  2026/07/24
//   Full-resolution blur reconstructed from a continuous image pyramid
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import ComputeImagePyramid, {
  COMPUTE_IMAGE_PYRAMID_DEFAULTS,
  validatePyramidLevels
} from "./ComputeImagePyramid.js?v=20260723_image_pyramid";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_PYRAMID_BLUR_FORMAT = "rgba16float";
export const COMPUTE_PYRAMID_BLUR_LEVELS = Object.freeze([2, 4, 8, 16]);
export const COMPUTE_PYRAMID_BLUR_DEFAULTS = Object.freeze({
  filterRadius: COMPUTE_IMAGE_PYRAMID_DEFAULTS.filterRadius
});

// 拡大処理の段階で、一つ下の解像度の画像を9点テントフィルターで拡大する
// 縮小時と同じfilterRadiusを使い、解像度階層間でぼかし幅の規則を統一する
export const COMPUTE_PYRAMID_BLUR_UPSAMPLE_WGSL = `
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

// 入力画像の指定位置から、filterRadiusを反映した相対位置の色を読み取る
fn readSource(uv : vec2f, offset : vec2f, texel : vec2f) -> vec4f {
  return textureSampleLevel(
    sourceTexture,
    sourceSampler,
    uv + offset * texel * params.filterRadius,
    0.0
  );
}

// 一つの出力画素について周囲9点を重み付きで読み、拡大後の色を書き込む
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDims = textureDimensions(outputTexture);
  if (id.x >= outputDims.x || id.y >= outputDims.y) {
    return;
  }

  let sourceDims = textureDimensions(sourceTexture);
  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(outputDims);
  let texel = vec2f(1.0) / vec2f(sourceDims);

  var color = readSource(uv, vec2f(-1.0, -1.0), texel);
  color += readSource(uv, vec2f(0.0, -1.0), texel) * 2.0;
  color += readSource(uv, vec2f(1.0, -1.0), texel);
  color += readSource(uv, vec2f(-1.0, 0.0), texel) * 2.0;
  color += readSource(uv, vec2f(0.0, 0.0), texel) * 4.0;
  color += readSource(uv, vec2f(1.0, 0.0), texel) * 2.0;
  color += readSource(uv, vec2f(-1.0, 1.0), texel);
  color += readSource(uv, vec2f(0.0, 1.0), texel) * 2.0;
  color += readSource(uv, vec2f(1.0, 1.0), texel);
  textureStore(outputTexture, vec2<i32>(id.xy), color * (1.0 / 16.0));
}`;

export default class ComputePyramidBlurPass {
  // 初期化段階でGPUと設定値を検証し、画像ピラミッド、出力先、拡大用ComputePassを準備する
  // readyには縮小処理と出力先の準備が完了するまで待機するPromiseを保存する
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputePyramidBlurPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputePyramidBlurPass label",
      "compute-pyramid-blur",
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
      COMPUTE_PYRAMID_BLUR_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== COMPUTE_PYRAMID_BLUR_FORMAT) {
      throw new Error(`${this.label} format must be ${COMPUTE_PYRAMID_BLUR_FORMAT}`);
    }
    this.levels = validatePyramidLevels(
      options.levels ?? COMPUTE_PYRAMID_BLUR_LEVELS,
      `${this.label} levels`
    );
    this.params = this.validateEncodeOptions(options);
    this.targetFactory = options.targetFactory ?? new StorageTargetFactory(gpu, {
      label: `${this.label}:storage`,
      format: this.format
    });
    if (this.targetFactory.format !== this.format) {
      throw new Error(`${this.label} StorageTargetFactory format must be ${this.format}`);
    }
    this.pyramid = new ComputeImagePyramid(gpu, {
      label: `${this.label}:pyramid`,
      width: this.width,
      height: this.height,
      format: this.format,
      levels: this.levels
    });
    this.outputTarget = this.targetFactory.create({
      label: `${this.label}:output`,
      width: this.width,
      height: this.height,
      format: this.format
    });
    this.upsamplePass = new ComputePass(gpu, {
      label: `${this.label}:upsample-pass`,
      code: COMPUTE_PYRAMID_BLUR_UPSAMPLE_WGSL,
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
    this.ready = Promise.all([
      this.pyramid.ready,
      this.outputTarget.ready
    ]);
    this.destroyed = false;
  }

  // 各公開処理の開始時に、解放済みのインスタンスが再利用されていないことを確認する
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} has been destroyed`);
    }
  }

  // 初期化時とencode()呼び出し時に、filterRadiusを有限値かつ許容範囲内へ検証する
  // 値が省略された場合は画像ピラミッドと共通の既定値を使用する
  validateEncodeOptions(options = {}) {
    return {
      filterRadius: util.readOptionalFiniteNumber(
        options.filterRadius,
        `${this.label} filterRadius`,
        COMPUTE_PYRAMID_BLUR_DEFAULTS.filterRadius,
        { min: 0.25, max: 3.0 }
      )
    };
  }

  // 描画命令の記録段階で、入力画像を1/2、1/4、1/8、1/16へ連続して縮小する
  // 最小画像だけを一段ずつフル解像度まで拡大し、完成したぼかし画像の出力先を返す
  // 時刻計測は最初の縮小処理から最後の拡大処理までを一つの範囲として記録する
  encode(commandEncoder, source, options = {}) {
    this.requireAlive();
    if (!commandEncoder?.beginComputePass) {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    const params = this.validateEncodeOptions({ ...this.params, ...options });
    const timestampWrites = options.timestampWrites;
    const firstTimestampWrites = timestampWrites?.beginningOfPassWriteIndex !== undefined
      ? {
          querySet: timestampWrites.querySet,
          beginningOfPassWriteIndex: timestampWrites.beginningOfPassWriteIndex
        }
      : undefined;
    const lastTimestampWrites = timestampWrites?.endOfPassWriteIndex !== undefined
      ? {
          querySet: timestampWrites.querySet,
          endOfPassWriteIndex: timestampWrites.endOfPassWriteIndex
        }
      : undefined;

    let current = this.pyramid.encode(commandEncoder, source, {
      filterRadius: params.filterRadius,
      timestampWrites: firstTimestampWrites
    });
    this.upsamplePass.setUniforms([
      params.filterRadius,
      0.0,
      0.0,
      0.0
    ]);
    for (let index = this.levels.length - 2; index >= 0; index -= 1) {
      const output = this.pyramid.getLevel(this.levels[index]);
      this.upsamplePass.encode(commandEncoder, {
        source: current,
        sampler: current.getSampler(),
        output
      });
      current = output;
    }
    this.upsamplePass.encode(commandEncoder, {
      source: current,
      sampler: current.getSampler(),
      output: this.outputTarget
    }, {
      timestampWrites: lastTimestampWrites
    });
    this.params = params;
    return this.outputTarget;
  }

  // 描画領域の変更時に、画像ピラミッドとフル解像度の出力先を新しい大きさへそろえる
  // どちらかの保存領域が再作成された場合はtrueを返す
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
    const pyramidChanged = this.pyramid.resize(this.width, this.height);
    const outputChanged = resizeTarget(this.outputTarget, this.width, this.height);
    return pyramidChanged || outputChanged;
  }

  // 後続処理へ渡すため、最後の拡大処理が書き込むフル解像度の出力先を返す
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // 呼び出し側が縮小構成を確認できるよう、内部配列を変更できない複製として階層一覧を返す
  getLevels() {
    this.requireAlive();
    return [...this.levels];
  }

  // 使用終了時に、拡大処理、画像ピラミッド、出力先が所有するGPU資源を順番に解放する
  // 二重解放を避けるため、最初の解放だけtrueを返す
  destroy() {
    if (this.destroyed) return false;
    this.upsamplePass.destroy();
    this.pyramid.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
