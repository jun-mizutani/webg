// ---------------------------------------------
// ComputeBloomPass.js  2026/07/25
//   Continuous image-pyramid High Dynamic Range bloom pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import ComputeImagePyramid, {
  computePyramidDimension
} from "./ComputeImagePyramid.js?v=20260723_image_pyramid";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_BLOOM_STORAGE_FORMAT = "rgba16float";
export const COMPUTE_BLOOM_LEVELS = Object.freeze([2, 4, 8, 16, 32]);

// 1/2から1/16までのWeight合計は1.0とし、1/32は広いtailとして独立加算します
// Weightは自動正規化せず、各周波数帯の光量を利用側が明示的に決めます
export const COMPUTE_BLOOM_DEFAULTS = Object.freeze({
  enabled: true,
  threshold: 0.60,
  softKnee: 0.40,
  strength: 0.70,
  halfWeight: 0.45,
  quarterWeight: 0.28,
  eighthWeight: 0.17,
  sixteenthWeight: 0.10,
  thirtySecondWeight: 0.18,
  filterRadius: 1.00
});

// HDR sceneの各pixelへthresholdとsoft kneeを一度だけ適用します
// 縮小してからthresholdを適用すると孤立した高輝度pixelが周囲との平均で消えるため、
// extractはfull-resolutionで完了させ、その結果だけを後段のpyramidへ渡します
export const COMPUTE_BLOOM_EXTRACT_WGSL = `
struct Params {
  values : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var outputTexture : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDims = textureDimensions(outputTexture);
  if (id.x >= outputDims.x || id.y >= outputDims.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let color = textureLoad(sceneTexture, coord, 0);
  let luma = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let peak = max(max(color.r, color.g), color.b);
  let brightness = mix(luma, peak, 0.65);
  let threshold = params.values.x;
  let hardExcess = max(brightness - threshold, 0.0);
  var bloomExcess = hardExcess;

  // softKneeが0、またはthresholdが0の場合はhard thresholdとして明示的に処理します
  if (params.values.y > 0.0 && threshold > 0.0) {
    let knee = threshold * params.values.y;
    let softDistance = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
    let softExcess = softDistance * softDistance / (4.0 * knee);
    bloomExcess = max(hardExcess, softExcess);
  }

  // Threshold超過量が元輝度へ占める比率だけを保持し、色相を変えずBloom sourceを作ります
  var extractScale = 0.0;
  if (brightness > 0.0 && bloomExcess > 0.0) {
    extractScale = bloomExcess / brightness;
  }
  textureStore(outputTexture, coord, vec4f(color.rgb * extractScale, extractScale));
}`;

// coarse Levelを9 tap tent filterでfine Levelの解像度へ拡大し、fine Levelを加算します
// 最小Levelから順番に繰り返し、広い低周波成分と近傍の強い成分を一つに再構成します
export const COMPUTE_BLOOM_UPSAMPLE_WGSL = `
struct Params {
  values : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var fineTexture : texture_2d<f32>;
@group(0) @binding(2) var coarseTexture : texture_2d<f32>;
@group(0) @binding(3) var coarseSampler : sampler;
@group(0) @binding(4) var outputTexture : texture_storage_2d<rgba16float, write>;

fn readCoarse(uv : vec2f, offset : vec2f, texel : vec2f) -> vec4f {
  return textureSampleLevel(coarseTexture, coarseSampler, uv + offset * texel, 0.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDims = textureDimensions(outputTexture);
  if (id.x >= outputDims.x || id.y >= outputDims.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let coarseDims = textureDimensions(coarseTexture);
  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(outputDims);
  let texel = vec2f(params.values.z) / vec2f(coarseDims);

  // 3x3 tent kernel [1 2 1] x [1 2 1] / 16でcoarse Levelを滑らかに拡大します
  var expanded = readCoarse(uv, vec2f(-1.0, -1.0), texel);
  expanded += readCoarse(uv, vec2f(0.0, -1.0), texel) * 2.0;
  expanded += readCoarse(uv, vec2f(1.0, -1.0), texel);
  expanded += readCoarse(uv, vec2f(-1.0, 0.0), texel) * 2.0;
  expanded += readCoarse(uv, vec2f(0.0, 0.0), texel) * 4.0;
  expanded += readCoarse(uv, vec2f(1.0, 0.0), texel) * 2.0;
  expanded += readCoarse(uv, vec2f(-1.0, 1.0), texel);
  expanded += readCoarse(uv, vec2f(0.0, 1.0), texel) * 2.0;
  expanded += readCoarse(uv, vec2f(1.0, 1.0), texel);
  expanded *= 1.0 / 16.0;

  let fine = textureLoad(fineTexture, coord, 0);
  textureStore(
    outputTexture,
    coord,
    fine * params.values.x + expanded * params.values.y
  );
}`;

// full-resolutionで再構成したBloomを線形HDR sceneへ加算します
// Tone MapはComputeEffectPipeline後段に残し、Bloom内で表示色へ変換しません
export const COMPUTE_BLOOM_COMPOSITE_WGSL = `
struct Params {
  values : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var bloomTexture : texture_2d<f32>;
@group(0) @binding(3) var outputTexture : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDims = textureDimensions(outputTexture);
  if (id.x >= outputDims.x || id.y >= outputDims.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let scene = textureLoad(sceneTexture, coord, 0);
  if (params.values.y < 0.5) {
    textureStore(outputTexture, coord, scene);
    return;
  }
  let bloom = textureLoad(bloomTexture, coord, 0);
  textureStore(
    outputTexture,
    coord,
    vec4f(scene.rgb + bloom.rgb * params.values.x, scene.a)
  );
}`;

export default class ComputeBloomPass {
  // full-resolution extract、5段階の縮小、4段階の中間拡大、
  // full-resolution Bloomとscene合成targetを一括して構築します
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeBloomPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeBloomPass label",
      "compute-bloom",
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
      COMPUTE_BLOOM_STORAGE_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== COMPUTE_BLOOM_STORAGE_FORMAT) {
      throw new Error(`${this.label} format must be ${COMPUTE_BLOOM_STORAGE_FORMAT}`);
    }
    this.params = this.validateEncodeOptions({
      ...COMPUTE_BLOOM_DEFAULTS,
      ...options
    });
    this.targetFactory = options.targetFactory ?? new StorageTargetFactory(gpu, {
      label: `${this.label}:storage`,
      format: this.format
    });
    if (this.targetFactory.format !== this.format) {
      throw new Error(`${this.label} StorageTargetFactory format must be ${this.format}`);
    }

    this.extractTarget = this.createTarget("extract", 1);
    this.pyramid = new ComputeImagePyramid(gpu, {
      label: `${this.label}:pyramid`,
      width: this.width,
      height: this.height,
      format: this.format,
      levels: COMPUTE_BLOOM_LEVELS
    });
    this.sixteenthUpsampleTarget = this.createTarget("sixteenth-upsample", 16);
    this.eighthUpsampleTarget = this.createTarget("eighth-upsample", 8);
    this.quarterUpsampleTarget = this.createTarget("quarter-upsample", 4);
    this.halfUpsampleTarget = this.createTarget("half-upsample", 2);
    this.bloomTarget = this.createTarget("bloom", 1);
    this.outputTarget = this.createTarget("output", 1);

    this.extractPass = this.createExtractPass();
    // 各dispatchが別のUniform値を保持できるよう、LevelごとにComputePassを分けます
    this.sixteenthUpsamplePass = this.createUpsamplePass("sixteenth-upsample");
    this.eighthUpsamplePass = this.createUpsamplePass("eighth-upsample");
    this.quarterUpsamplePass = this.createUpsamplePass("quarter-upsample");
    this.halfUpsamplePass = this.createUpsamplePass("half-upsample");
    this.fullUpsamplePass = this.createUpsamplePass("full-upsample");
    this.compositePass = this.createCompositePass();

    this.ready = Promise.all([
      this.extractTarget.ready,
      this.pyramid.ready,
      this.sixteenthUpsampleTarget.ready,
      this.eighthUpsampleTarget.ready,
      this.quarterUpsampleTarget.ready,
      this.halfUpsampleTarget.ready,
      this.bloomTarget.ready,
      this.outputTarget.ready
    ]);
    this.destroyed = false;
  }

  // divisor 1はfull-resolution、2以降はpyramid Levelの縮小率として使います
  createTarget(name, divisor) {
    return this.targetFactory.create({
      label: `${this.label}:${name}`,
      width: divisor === 1
        ? this.width
        : computePyramidDimension(this.width, divisor, `${this.label} ${name} width`),
      height: divisor === 1
        ? this.height
        : computePyramidDimension(this.height, divisor, `${this.label} ${name} height`),
      format: this.format
    });
  }

  // `extract`の処理を生成し、後続処理で利用できる状態にする
  createExtractPass() {
    return new ComputePass(this.gpu, {
      label: `${this.label}:extract-pass`,
      code: COMPUTE_BLOOM_EXTRACT_WGSL,
      uniformFloats: 4,
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
  }

  // `upsample`の処理を生成し、後続処理で利用できる状態にする
  createUpsamplePass(name) {
    return new ComputePass(this.gpu, {
      label: `${this.label}:${name}-pass`,
      code: COMPUTE_BLOOM_UPSAMPLE_WGSL,
      uniformFloats: 4,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "fine", type: "sampled-texture" },
        { binding: 2, name: "coarse", type: "sampled-texture" },
        { binding: 3, name: "sampler", type: "sampler" },
        {
          binding: 4,
          name: "output",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        }
      ]
    });
  }

  // `composite`の処理を生成し、後続処理で利用できる状態にする
  createCompositePass() {
    return new ComputePass(this.gpu, {
      label: `${this.label}:composite-pass`,
      code: COMPUTE_BLOOM_COMPOSITE_WGSL,
      uniformFloats: 4,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "scene", type: "sampled-texture" },
        { binding: 2, name: "bloom", type: "sampled-texture" },
        {
          binding: 3,
          name: "output",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        }
      ]
    });
  }

  // 使用可能状態を検証し、後続処理が扱える共通形式へ整える
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} has been destroyed`);
    }
  }

  // 旧staged方式の値は意味が異なるため無視や暗黙変換を行わず明示的に拒否します
  rejectDeprecatedOptions(options = {}) {
    const deprecated = [
      "smallScale",
      "mediumScale",
      "largeScale",
      "smallSampleStep",
      "mediumSampleStep",
      "largeSampleStep",
      "smallThreshold",
      "mediumThreshold",
      "largeThreshold",
      "smallStrength",
      "mediumStrength",
      "largeStrength",
      "blurRadius",
      "blurIterations",
      "intensity",
      "resolutionScale",
      "stageMode",
      "exposure"
    ].filter((key) => Object.prototype.hasOwnProperty.call(options, key));
    if (deprecated.length > 0) {
      throw new Error(
        `${this.label} no longer supports staged small/medium/large bloom parameters `
        + `(${deprecated.join(", ")}); use threshold, level weights, filterRadius, and strength`
      );
    }
  }

  // Pyramid Bloomの値だけを検証し、Level Weightの合計は利用側の指定を保持します
  validateEncodeOptions(options = {}) {
    this.rejectDeprecatedOptions(options);
    return {
      enabled: util.readOptionalBoolean(
        options.enabled,
        `${this.label} enabled`,
        COMPUTE_BLOOM_DEFAULTS.enabled
      ),
      threshold: util.readOptionalFiniteNumber(
        options.threshold,
        `${this.label} threshold`,
        COMPUTE_BLOOM_DEFAULTS.threshold,
        { min: 0.0, max: 4.0 }
      ),
      softKnee: util.readOptionalFiniteNumber(
        options.softKnee,
        `${this.label} softKnee`,
        COMPUTE_BLOOM_DEFAULTS.softKnee,
        { min: 0.0, max: 1.0 }
      ),
      strength: util.readOptionalFiniteNumber(
        options.strength,
        `${this.label} strength`,
        COMPUTE_BLOOM_DEFAULTS.strength,
        { min: 0.0, max: 4.0 }
      ),
      halfWeight: util.readOptionalFiniteNumber(
        options.halfWeight,
        `${this.label} halfWeight`,
        COMPUTE_BLOOM_DEFAULTS.halfWeight,
        { min: 0.0, max: 4.0 }
      ),
      quarterWeight: util.readOptionalFiniteNumber(
        options.quarterWeight,
        `${this.label} quarterWeight`,
        COMPUTE_BLOOM_DEFAULTS.quarterWeight,
        { min: 0.0, max: 4.0 }
      ),
      eighthWeight: util.readOptionalFiniteNumber(
        options.eighthWeight,
        `${this.label} eighthWeight`,
        COMPUTE_BLOOM_DEFAULTS.eighthWeight,
        { min: 0.0, max: 4.0 }
      ),
      sixteenthWeight: util.readOptionalFiniteNumber(
        options.sixteenthWeight,
        `${this.label} sixteenthWeight`,
        COMPUTE_BLOOM_DEFAULTS.sixteenthWeight,
        { min: 0.0, max: 4.0 }
      ),
      thirtySecondWeight: util.readOptionalFiniteNumber(
        options.thirtySecondWeight,
        `${this.label} thirtySecondWeight`,
        COMPUTE_BLOOM_DEFAULTS.thirtySecondWeight,
        { min: 0.0, max: 4.0 }
      ),
      filterRadius: util.readOptionalFiniteNumber(
        options.filterRadius,
        `${this.label} filterRadius`,
        COMPUTE_BLOOM_DEFAULTS.filterRadius,
        { min: 0.25, max: 3.0 }
      )
    };
  }

  // ComputeEffectPipelineから渡されるsceneが同じ寸法とHDR formatを持つことを確認します
  validateScene(scene) {
    if (!scene?.getView || !scene?.getWidth || !scene?.getHeight) {
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
        `${this.label} scene size ${width}x${height} does not match ${this.width}x${this.height}`
      );
    }
    if (!scene.getView()) {
      throw new Error(`${this.label} scene view is not ready`);
    }
    if (scene.getFormat?.() !== this.format) {
      throw new Error(`${this.label} scene format must be ${this.format}`);
    }
    return scene;
  }

  // fine Level固有の重みと、既に重み付け済みのcoarse結果を合成します
  encodeUpsample(pass, commandEncoder, fine, coarse, output, fineWeight, coarseWeight, radius) {
    pass.setUniforms([fineWeight, coarseWeight, radius, 0.0]);
    pass.encode(commandEncoder, {
      fine,
      coarse,
      sampler: coarse.getSampler(),
      output
    });
  }

  // extract、連続downsample、progressive upsample、scene合成を同じencoderへ順番に記録します
  encode(commandEncoder, scene, options = {}) {
    this.requireAlive();
    if (!commandEncoder?.beginComputePass) {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    const checkedScene = this.validateScene(scene);
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

    this.extractPass.setUniforms([
      params.threshold,
      params.softKnee,
      0.0,
      0.0
    ]);
    this.extractPass.encode(commandEncoder, {
      scene: checkedScene,
      output: this.extractTarget
    }, {
      timestampWrites: firstTimestampWrites
    });

    this.pyramid.encode(commandEncoder, this.extractTarget);
    const half = this.pyramid.getLevel(2);
    const quarter = this.pyramid.getLevel(4);
    const eighth = this.pyramid.getLevel(8);
    const sixteenth = this.pyramid.getLevel(16);
    const thirtySecond = this.pyramid.getLevel(32);

    // 最も広い1/32成分から開始し、重み付け済みのcoarse結果を上位Levelへ伝播します
    this.encodeUpsample(
      this.sixteenthUpsamplePass,
      commandEncoder,
      sixteenth,
      thirtySecond,
      this.sixteenthUpsampleTarget,
      params.sixteenthWeight,
      params.thirtySecondWeight,
      params.filterRadius
    );
    this.encodeUpsample(
      this.eighthUpsamplePass,
      commandEncoder,
      eighth,
      this.sixteenthUpsampleTarget,
      this.eighthUpsampleTarget,
      params.eighthWeight,
      1.0,
      params.filterRadius
    );
    this.encodeUpsample(
      this.quarterUpsamplePass,
      commandEncoder,
      quarter,
      this.eighthUpsampleTarget,
      this.quarterUpsampleTarget,
      params.quarterWeight,
      1.0,
      params.filterRadius
    );
    this.encodeUpsample(
      this.halfUpsamplePass,
      commandEncoder,
      half,
      this.quarterUpsampleTarget,
      this.halfUpsampleTarget,
      params.halfWeight,
      1.0,
      params.filterRadius
    );
    // scene内の発光面を二重に強調しないようfull-resolution extractは再加算しません
    this.encodeUpsample(
      this.fullUpsamplePass,
      commandEncoder,
      this.extractTarget,
      this.halfUpsampleTarget,
      this.bloomTarget,
      0.0,
      1.0,
      params.filterRadius
    );

    this.compositePass.setUniforms([
      params.strength,
      params.enabled ? 1.0 : 0.0,
      0.0,
      0.0
    ]);
    this.compositePass.encode(commandEncoder, {
      scene: checkedScene,
      bloom: this.bloomTarget,
      output: this.outputTarget
    }, {
      timestampWrites: lastTimestampWrites
    });
    this.params = params;
    return this.outputTarget;
  }

  // Canvas寸法変更時にfull-resolution targetと各pyramid Levelを同じframeで更新します
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
    const resizeLevel = (target, divisor, name) => resizeTarget(
      target,
      divisor === 1
        ? this.width
        : computePyramidDimension(this.width, divisor, `${this.label} ${name} width`),
      divisor === 1
        ? this.height
        : computePyramidDimension(this.height, divisor, `${this.label} ${name} height`)
    );
    const results = [
      resizeLevel(this.extractTarget, 1, "extract"),
      this.pyramid.resize(this.width, this.height),
      resizeLevel(this.sixteenthUpsampleTarget, 16, "sixteenth-upsample"),
      resizeLevel(this.eighthUpsampleTarget, 8, "eighth-upsample"),
      resizeLevel(this.quarterUpsampleTarget, 4, "quarter-upsample"),
      resizeLevel(this.halfUpsampleTarget, 2, "half-upsample"),
      resizeLevel(this.bloomTarget, 1, "bloom"),
      resizeLevel(this.outputTarget, 1, "output")
    ];
    return results.some(Boolean);
  }

  // `extract`の対象を現在の入力と状態から求め、呼び出し元へ返す
  getExtractTarget() {
    this.requireAlive();
    return this.extractTarget;
  }

  getHalfTarget() {
    return this.pyramid.getLevel(2);
  }

  getQuarterTarget() {
    return this.pyramid.getLevel(4);
  }

  getEighthTarget() {
    return this.pyramid.getLevel(8);
  }

  getSixteenthTarget() {
    return this.pyramid.getLevel(16);
  }

  getThirtySecondTarget() {
    return this.pyramid.getLevel(32);
  }

  // `blur`の対象を現在の入力と状態から求め、呼び出し元へ返す
  getBlurTarget() {
    this.requireAlive();
    return this.bloomTarget;
  }

  // 出力の対象を現在の入力と状態から求め、呼び出し元へ返す
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // Bloomが所有するCompute resourceとtextureを一度だけ破棄します
  destroy() {
    if (this.destroyed) return false;
    this.extractPass.destroy();
    this.pyramid.destroy();
    this.sixteenthUpsamplePass.destroy();
    this.eighthUpsamplePass.destroy();
    this.quarterUpsamplePass.destroy();
    this.halfUpsamplePass.destroy();
    this.fullUpsamplePass.destroy();
    this.compositePass.destroy();
    this.extractTarget.destroy();
    this.sixteenthUpsampleTarget.destroy();
    this.eighthUpsampleTarget.destroy();
    this.quarterUpsampleTarget.destroy();
    this.halfUpsampleTarget.destroy();
    this.bloomTarget.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
