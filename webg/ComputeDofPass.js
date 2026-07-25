// ---------------------------------------------
// ComputeDofPass.js  2026/07/25
//   Linear High Dynamic Range depth of field pass with image pyramid
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import ComputeImagePyramid from "./ComputeImagePyramid.js?v=20260723_dof_coverage";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import {
  createGBufferProjectionParams,
  GBUFFER_WGSL_COMMON
} from "./GeometryBufferPass.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_DOF_LEVELS = Object.freeze([2, 4, 8, 16]);

export const COMPUTE_DOF_DEFAULTS = Object.freeze({
  focusDistance: 36.0,
  focusRange: 7.0,
  blurRadius: 1.0,
  cocScale: 1.0,
  enabled: true,
  debugView: "composite",
  sharpnessWidth: 0.15,
  sharpnessPower: 1.0
});

export const COMPUTE_DOF_FORMAT = "rgba16float";

export const COMPUTE_DOF_VIEW_MODES = Object.freeze([
  "composite",
  "depth",
  "focus"
]);

// 符号付きCoCに従って近景と遠景を別々のpremultiplied色と被覆率へ分離します
// clear backgroundと合焦領域を除外してから低域画像を作ることで、
// 合焦した輪郭がscene全体のblurを介して背景へ広がることを防ぎます
export const COMPUTE_DOF_COC_EXTRACT_WGSL = `
struct Params {
  values : vec4f,
  projection : vec4f,
  shape : vec4f,
};
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var depthTexture : texture_depth_2d;
@group(0) @binding(3) var farOutputTexture : texture_storage_2d<${COMPUTE_DOF_FORMAT}, write>;
@group(0) @binding(4) var nearOutputTexture : texture_storage_2d<${COMPUTE_DOF_FORMAT}, write>;
@group(0) @binding(5) var cocOutputTexture : texture_storage_2d<${COMPUTE_DOF_FORMAT}, write>;

${GBUFFER_WGSL_COMMON}

fn cocStage(distance : f32) -> f32 {
  // values.zは鮮明sceneの混合率ではなくCoC scaleです
  // 距離差が何段先のPyramid Levelに対応するかだけを変更します
  return clamp((distance / params.values.y) * params.values.z, 0.0, 4.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dims = textureDimensions(sceneTexture);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  let coord = vec2<i32>(id.xy);
  let depth = textureLoad(depthTexture, coord, 0);
  if (isGBufferBackgroundDepth(depth)) {
    textureStore(farOutputTexture, coord, vec4f(0.0));
    textureStore(nearOutputTexture, coord, vec4f(0.0));
    textureStore(cocOutputTexture, coord, vec4f(0.0));
    return;
  }

  let linearDepth = linearizeGBufferDepth(depth, params.projection);
  let delta = linearDepth - params.values.x;
  let stage = cocStage(abs(delta));
  let scene = textureLoad(sceneTexture, coord, 0);
  // 元解像度ではgeometryが存在する画素のcoverageを常に1にします
  // CoC stageをAlphaへ掛けず、独立したmetadata targetへ保存します
  let layer = vec4f(scene.rgb, 1.0);
  if (stage <= params.shape.x) {
    textureStore(farOutputTexture, coord, vec4f(0.0));
    textureStore(nearOutputTexture, coord, vec4f(0.0));
    textureStore(cocOutputTexture, coord, vec4f(0.0));
    return;
  }
  if (delta > 0.0) {
    textureStore(farOutputTexture, coord, layer);
    textureStore(nearOutputTexture, coord, vec4f(0.0));
    textureStore(cocOutputTexture, coord, vec4f(0.0, stage, 0.0, 0.0));
  } else if (delta < 0.0) {
    textureStore(farOutputTexture, coord, vec4f(0.0));
    textureStore(nearOutputTexture, coord, layer);
    textureStore(cocOutputTexture, coord, vec4f(stage, 0.0, 0.0, 0.0));
  } else {
    textureStore(farOutputTexture, coord, vec4f(0.0));
    textureStore(nearOutputTexture, coord, vec4f(0.0));
    textureStore(cocOutputTexture, coord, vec4f(0.0));
  }
}`;

export const COMPUTE_DOF_COMPOSITE_WGSL = `
struct Params {
  values : vec4f,
  projection : vec4f,
  shape : vec4f,
};
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var depthTexture : texture_depth_2d;
@group(0) @binding(3) var levelSampler : sampler;
@group(0) @binding(4) var sceneHalfTexture : texture_2d<f32>;
@group(0) @binding(5) var sceneQuarterTexture : texture_2d<f32>;
@group(0) @binding(6) var sceneEighthTexture : texture_2d<f32>;
@group(0) @binding(7) var sceneSixteenthTexture : texture_2d<f32>;
@group(0) @binding(8) var farHalfTexture : texture_2d<f32>;
@group(0) @binding(9) var farQuarterTexture : texture_2d<f32>;
@group(0) @binding(10) var farEighthTexture : texture_2d<f32>;
@group(0) @binding(11) var farSixteenthTexture : texture_2d<f32>;
@group(0) @binding(12) var nearHalfTexture : texture_2d<f32>;
@group(0) @binding(13) var nearQuarterTexture : texture_2d<f32>;
@group(0) @binding(14) var nearEighthTexture : texture_2d<f32>;
@group(0) @binding(15) var nearSixteenthTexture : texture_2d<f32>;
@group(0) @binding(16) var cocSixteenthTexture : texture_2d<f32>;
@group(0) @binding(17) var outputTexture : texture_storage_2d<${COMPUTE_DOF_FORMAT}, write>;

${GBUFFER_WGSL_COMMON}

fn stagePosition(distance : f32, focusRange : f32) -> f32 {
  return clamp((distance / focusRange) * params.values.z, 0.0, 4.0);
}

fn smoothLevelFraction(value : f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  let smoothWeight = clamped * clamped * (3.0 - 2.0 * clamped);
  // sharpnessPowerは鮮明sceneを残す値ではなく、隣接Level間の遷移曲線だけを調整します
  return pow(smoothWeight, params.shape.y);
}

fn selectBlurLayer(
  halfLayer : vec4f,
  quarterLayer : vec4f,
  eighthLayer : vec4f,
  sixteenthLayer : vec4f,
  stage : f32
) -> vec4f {
  let checkedStage = clamp(stage, 0.0, 4.0);
  // 合焦帯を出たgeometryは最小でもlow-pass済みの1/2 Levelへ置き換えます
  // 鮮明sceneから1/2 Levelへのcross-fadeは行いません
  if (checkedStage < 1.0) {
    return halfLayer;
  }
  if (checkedStage < 2.0) {
    return mix(halfLayer, quarterLayer, smoothLevelFraction(checkedStage - 1.0));
  }
  if (checkedStage < 3.0) {
    return mix(quarterLayer, eighthLayer, smoothLevelFraction(checkedStage - 2.0));
  }
  return mix(eighthLayer, sixteenthLayer, smoothLevelFraction(checkedStage - 3.0));
}

fn sceneBlurAtStage(uv : vec2f, stage : f32) -> vec4f {
  // 元geometry輪郭の内側も外側と同じ低域画像へ接続します
  // scene Levelには物体色と周囲色がfilter済みの比率で含まれるため、
  // coverageを除算して物体色を復元せず、そのまま内部の色に使います
  return selectBlurLayer(
    textureSampleLevel(sceneHalfTexture, levelSampler, uv, 0.0),
    textureSampleLevel(sceneQuarterTexture, levelSampler, uv, 0.0),
    textureSampleLevel(sceneEighthTexture, levelSampler, uv, 0.0),
    textureSampleLevel(sceneSixteenthTexture, levelSampler, uv, 0.0),
    stage
  );
}

fn farLayerAtStage(uv : vec2f, stage : f32) -> vec4f {
  return selectBlurLayer(
    textureSampleLevel(farHalfTexture, levelSampler, uv, 0.0),
    textureSampleLevel(farQuarterTexture, levelSampler, uv, 0.0),
    textureSampleLevel(farEighthTexture, levelSampler, uv, 0.0),
    textureSampleLevel(farSixteenthTexture, levelSampler, uv, 0.0),
    stage
  );
}

fn nearLayerAtStage(uv : vec2f, stage : f32) -> vec4f {
  return selectBlurLayer(
    textureSampleLevel(nearHalfTexture, levelSampler, uv, 0.0),
    textureSampleLevel(nearQuarterTexture, levelSampler, uv, 0.0),
    textureSampleLevel(nearEighthTexture, levelSampler, uv, 0.0),
    textureSampleLevel(nearSixteenthTexture, levelSampler, uv, 0.0),
    stage
  );
}

fn sourceStage(moment : f32, coverage : f32) -> f32 {
  // CoC momentとcoverageを同じfilterで処理するため、
  // 輪郭外でcoverageが薄くなっても除算後のsource stageは維持されます
  if (coverage <= 0.0) {
    return 0.0;
  }
  return clamp(moment / coverage, 0.0, 4.0);
}

fn farSpreadLayer(uv : vec2f) -> vec4f {
  let widestLayer = textureSampleLevel(farSixteenthTexture, levelSampler, uv, 0.0);
  let cocMoment = textureSampleLevel(cocSixteenthTexture, levelSampler, uv, 0.0).g;
  return farLayerAtStage(uv, sourceStage(cocMoment, widestLayer.a));
}

fn nearSpreadLayer(uv : vec2f) -> vec4f {
  let widestLayer = textureSampleLevel(nearSixteenthTexture, levelSampler, uv, 0.0);
  let cocMoment = textureSampleLevel(cocSixteenthTexture, levelSampler, uv, 0.0).r;
  return nearLayerAtStage(uv, sourceStage(cocMoment, widestLayer.a));
}

fn compositeCoverageLayer(baseColor : vec3f, layer : vec4f) -> vec3f {
  // 元geometry輪郭の外側ではfiltered coverageだけを合成率として使います
  if (layer.a <= 0.0) {
    return baseColor;
  }
  let layerColor = layer.rgb / layer.a;
  return mix(baseColor, layerColor, clamp(layer.a, 0.0, 1.0));
}

fn focusStageColor(delta : f32, stagePositionValue : f32) -> vec3f {
  // debug focus viewは、実際のLevel補間に近い符号付き段階を色で表示します
  let hold = params.shape.x;
  if (stagePositionValue <= hold) {
    return vec3f(0.24, 1.0, 0.38);
  }
  let level = min(max(i32(ceil(stagePositionValue)), 1), 4);
  if (delta < 0.0) {
    if (level == 1) {
      return vec3f(1.0, 0.86, 0.18);
    }
    if (level == 2) {
      return vec3f(1.0, 0.48, 0.08);
    }
    if (level == 3) {
      return vec3f(1.0, 0.12, 0.08);
    }
    return vec3f(0.72, 0.02, 0.04);
  }
  if (level == 1) {
    return vec3f(0.24, 0.95, 1.0);
  }
  if (level == 2) {
    return vec3f(0.14, 0.42, 1.0);
  }
  if (level == 3) {
    return vec3f(0.68, 0.22, 1.0);
  }
  return vec3f(1.0, 0.12, 0.82);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dims = textureDimensions(sceneTexture);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  let coord = vec2<i32>(id.xy);
  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(dims);
  let scene = textureLoad(sceneTexture, coord, 0);
  let depth = textureLoad(depthTexture, coord, 0);
  let mode = i32(params.shape.z);

  // clear background自身には距離もCoCもありません
  // 近景・遠景のfiltered coverageが届いた部分だけを各source stageで合成します
  if (isGBufferBackgroundDepth(depth)) {
    if (mode == 1 || mode == 2) {
      textureStore(outputTexture, coord, vec4f(0.0, 0.0, 0.0, 1.0));
    } else if (params.values.w < 0.5) {
      textureStore(outputTexture, coord, scene);
    } else {
      let farComposite = compositeCoverageLayer(scene.rgb, farSpreadLayer(uv));
      let nearComposite = compositeCoverageLayer(farComposite, nearSpreadLayer(uv));
      textureStore(outputTexture, coord, vec4f(nearComposite, scene.a));
    }
    return;
  }

  let linearDepth = linearizeGBufferDepth(depth, params.projection);
  if (mode == 1) {
    textureStore(outputTexture, coord, vec4f(vec3f(depth), 1.0));
    return;
  }

  let delta = linearDepth - params.values.x;
  let stageValue = stagePosition(abs(delta), params.values.y);
  if (mode == 2) {
    textureStore(outputTexture, coord, vec4f(focusStageColor(delta, stageValue), 1.0));
    return;
  }
  if (params.values.w < 0.5) {
    textureStore(outputTexture, coord, scene);
    return;
  }

  let isOutOfFocus = stageValue > params.shape.x;
  let isOutOfFocusNear = delta < 0.0 && isOutOfFocus;
  var color = scene.rgb;
  if (isOutOfFocus && delta != 0.0) {
    // 元geometry輪郭内部でもscene全体の同じ低周波Levelを使用します
    // layer色をcoverageで正規化すると元物体色を復元するため、ここでは行いません
    color = sceneBlurAtStage(uv, stageValue).rgb;
  }

  // 近景blurは焦点面と遠景の手前へfiltered coverageに従って重ねます
  // 合焦帯のnear側も焦点面の一部なので、別の焦点外近景から届くcoverageを受け取ります
  // 焦点外近景自身だけはscene blurで既に置換されているため、同じnear layerを重ねません
  if (!isOutOfFocusNear) {
    color = compositeCoverageLayer(color, nearSpreadLayer(uv));
  }
  textureStore(outputTexture, coord, vec4f(color, scene.a));
}`;

// sample可能なscene colorとdepthを使い、Compute Shaderで多段階DoF合成を作ります
export default class ComputeDofPass {
  // scene、近景・遠景coverage、CoC metadataの4系統のLevelを構築します
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeDofPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeDofPass label",
      "compute-dof",
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
      COMPUTE_DOF_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== COMPUTE_DOF_FORMAT) {
      throw new Error(`${this.label} format must be ${COMPUTE_DOF_FORMAT}`);
    }
    this.targetFactory = options.targetFactory ?? new StorageTargetFactory(gpu, {
      label: this.label,
      format: this.format
    });
    if (this.targetFactory.format !== this.format) {
      throw new Error(`${this.label} StorageTargetFactory format must be ${this.format}`);
    }
    this.validateEncodeOptions(options);
    this.outputTarget = this.targetFactory.create({
      label: `${this.label}:output`,
      width: this.width,
      height: this.height,
      format: this.format
    });
    this.farFieldTarget = this.targetFactory.create({
      label: `${this.label}:far-field`,
      width: this.width,
      height: this.height,
      format: this.format
    });
    this.nearFieldTarget = this.targetFactory.create({
      label: `${this.label}:near-field`,
      width: this.width,
      height: this.height,
      format: this.format
    });
    this.cocFieldTarget = this.targetFactory.create({
      label: `${this.label}:coc-field`,
      width: this.width,
      height: this.height,
      format: this.format
    });
    this.pyramid = new ComputeImagePyramid(gpu, {
      label: `${this.label}:pyramid`,
      width: this.width,
      height: this.height,
      format: this.format,
      levels: COMPUTE_DOF_LEVELS
    });
    this.farPyramid = new ComputeImagePyramid(gpu, {
      label: `${this.label}:far-pyramid`,
      width: this.width,
      height: this.height,
      format: this.format,
      levels: COMPUTE_DOF_LEVELS
    });
    this.nearPyramid = new ComputeImagePyramid(gpu, {
      label: `${this.label}:near-pyramid`,
      width: this.width,
      height: this.height,
      format: this.format,
      levels: COMPUTE_DOF_LEVELS
    });
    this.cocPyramid = new ComputeImagePyramid(gpu, {
      label: `${this.label}:coc-pyramid`,
      width: this.width,
      height: this.height,
      format: this.format,
      levels: COMPUTE_DOF_LEVELS
    });
    this.cocExtractPass = new ComputePass(gpu, {
      label: `${this.label}:coc-extract`,
      code: COMPUTE_DOF_COC_EXTRACT_WGSL,
      uniformFloats: 12,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "scene", type: "sampled-texture" },
        { binding: 2, name: "depth", type: "depth-texture" },
        {
          binding: 3,
          name: "farOutput",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        },
        {
          binding: 4,
          name: "nearOutput",
          type: "storage-texture",
          format: this.format
        },
        {
          binding: 5,
          name: "cocOutput",
          type: "storage-texture",
          format: this.format
        }
      ]
    });
    this.compositePass = new ComputePass(gpu, {
      label: `${this.label}:composite`,
      code: COMPUTE_DOF_COMPOSITE_WGSL,
      uniformFloats: 12,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "scene", type: "sampled-texture" },
        { binding: 2, name: "depth", type: "depth-texture" },
        { binding: 3, name: "sampler", type: "sampler" },
        { binding: 4, name: "sceneHalf", type: "sampled-texture" },
        { binding: 5, name: "sceneQuarter", type: "sampled-texture" },
        { binding: 6, name: "sceneEighth", type: "sampled-texture" },
        { binding: 7, name: "sceneSixteenth", type: "sampled-texture" },
        { binding: 8, name: "farHalf", type: "sampled-texture" },
        { binding: 9, name: "farQuarter", type: "sampled-texture" },
        { binding: 10, name: "farEighth", type: "sampled-texture" },
        { binding: 11, name: "farSixteenth", type: "sampled-texture" },
        { binding: 12, name: "nearHalf", type: "sampled-texture" },
        { binding: 13, name: "nearQuarter", type: "sampled-texture" },
        { binding: 14, name: "nearEighth", type: "sampled-texture" },
        { binding: 15, name: "nearSixteenth", type: "sampled-texture" },
        { binding: 16, name: "cocSixteenth", type: "sampled-texture" },
        {
          binding: 17,
          name: "output",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        }
      ]
    });
    this.ready = Promise.all([
      this.outputTarget.ready,
      this.farFieldTarget.ready,
      this.nearFieldTarget.ready,
      this.cocFieldTarget.ready,
      this.pyramid.ready,
      this.farPyramid.ready,
      this.nearPyramid.ready,
      this.cocPyramid.ready
    ]);
    this.destroyed = false;
  }

  // 使用可能状態を検証し、後続処理が扱える共通形式へ整える
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} has been destroyed`);
    }
  }

  // staged blur用parameterはPyramid Levelへ暗黙変換できないため明示的に拒否します
  rejectDeprecatedOptions(options = {}) {
    const deprecated = [
      "blurIterations",
      "sampleStep",
      "stageSmallScale",
      "stageMediumScale",
      "stageLargeScale"
    ].filter((key) => Object.prototype.hasOwnProperty.call(options, key));
    if (deprecated.length > 0) {
      throw new Error(
        `${this.label} no longer supports staged DoF blur parameters `
        + `(${deprecated.join(", ")}); the pass now uses fixed 1/2, 1/4, 1/8, and 1/16 pyramid Levels`
      );
    }
  }

  // 焦点、投影、debug、Level補間のparameterを検証してshaderへ渡す値を返します
  validateEncodeOptions(options = {}) {
    this.rejectDeprecatedOptions(options);
    for (const name of ["projectionNear", "projectionFar"]) {
      if (Object.prototype.hasOwnProperty.call(options, name)) {
        throw new Error(
          `${this.label} no longer supports ${name}; pass a Reverse-Z CameraFrame`
        );
      }
    }
    const debugView = util.readOptionalEnum(
      options.debugView,
      `${this.label} debugView`,
      COMPUTE_DOF_DEFAULTS.debugView,
      COMPUTE_DOF_VIEW_MODES
    );
    const hasCocScale = Object.prototype.hasOwnProperty.call(options, "cocScale");
    const hasLegacyMaxBlurMix = Object.prototype.hasOwnProperty.call(options, "maxBlurMix");
    const cocScale = util.readOptionalFiniteNumber(
      hasCocScale ? options.cocScale : options.maxBlurMix,
      `${this.label} cocScale`,
      COMPUTE_DOF_DEFAULTS.cocScale,
      { min: 0.0, max: 2.0 }
    );
    if (hasCocScale && hasLegacyMaxBlurMix) {
      const legacyValue = util.readFiniteNumber(
        options.maxBlurMix,
        `${this.label} maxBlurMix compatibility value`,
        { min: 0.0, max: 2.0 }
      );
      if (legacyValue !== cocScale) {
        throw new Error(
          `${this.label} cocScale and legacy maxBlurMix must match when both are specified`
        );
      }
    }
    return {
      focusDistance: util.readOptionalFiniteNumber(
        options.focusDistance,
        `${this.label} focusDistance`,
        COMPUTE_DOF_DEFAULTS.focusDistance,
        { minExclusive: 0.0 }
      ),
      focusRange: util.readOptionalFiniteNumber(
        options.focusRange,
        `${this.label} focusRange`,
        COMPUTE_DOF_DEFAULTS.focusRange,
        { minExclusive: 0.0 }
      ),
      blurRadius: util.readOptionalFiniteNumber(
        options.blurRadius,
        `${this.label} blurRadius`,
        COMPUTE_DOF_DEFAULTS.blurRadius,
        { min: 0.25, max: 3.0 }
      ),
      cocScale,
      enabled: util.readOptionalBoolean(
        options.enabled,
        `${this.label} enabled`,
        COMPUTE_DOF_DEFAULTS.enabled
      ),
      debugView,
      debugMode: debugView === "depth" ? 1.0 : debugView === "focus" ? 2.0 : 0.0,
      sharpnessWidth: util.readOptionalFiniteNumber(
        options.sharpnessWidth,
        `${this.label} sharpnessWidth`,
        COMPUTE_DOF_DEFAULTS.sharpnessWidth,
        { min: 0.0, max: 0.95 }
      ),
      sharpnessPower: util.readOptionalFiniteNumber(
        options.sharpnessPower,
        `${this.label} sharpnessPower`,
        COMPUTE_DOF_DEFAULTS.sharpnessPower,
        { minExclusive: 0.0 }
      )
    };
  }

  // High Dynamic Range sceneとCamera Reverse-Z depthを別resourceとして検証します
  validateResources(resources) {
    const checked = util.readPlainObject(resources, `${this.label} resources`);
    const scene = checked.scene;
    const depth = checked.depth;
    if (!scene || typeof scene.getView !== "function") {
      throw new Error(`${this.label} resources require scene target`);
    }
    if (scene.getFormat?.() !== COMPUTE_DOF_FORMAT) {
      throw new Error(`${this.label} scene format must be ${COMPUTE_DOF_FORMAT}`);
    }
    if (
      !depth ||
      typeof depth.getDepthSampleView !== "function" ||
      depth.depthConvention !== CAMERA_REVERSE_Z
    ) {
      throw new Error(`${this.label} resources require CAMERA_REVERSE_Z depth target`);
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
      throw new Error(`${this.label} scene color view is not ready`);
    }
    const depthWidth = util.readFiniteNumber(depth.getWidth?.(), `${this.label} depth width`, {
      integer: true,
      min: 1
    });
    const depthHeight = util.readFiniteNumber(depth.getHeight?.(), `${this.label} depth height`, {
      integer: true,
      min: 1
    });
    if (depthWidth !== width || depthHeight !== height) {
      throw new Error(
        `${this.label} depth size ${depthWidth}x${depthHeight} does not match scene size `
        + `${width}x${height}`
      );
    }
    if (!depth.getDepthSampleView()) {
      throw new Error(`${this.label} scene depth sample view is not ready`);
    }
    return { scene, depth };
  }

  // scene、coverage、CoC metadataの各Pyramidとcompositeを同じencoderへ追加します
  encode(commandEncoder, resources, options = {}) {
    this.requireAlive();
    if (!commandEncoder?.beginComputePass) {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    const checkedResources = this.validateResources(resources);
    const params = this.validateEncodeOptions(options);
    const projection = createGBufferProjectionParams(options.cameraFrame);
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
    this.pyramid.encode(commandEncoder, checkedResources.scene, {
      filterRadius: params.blurRadius,
      timestampWrites: firstTimestampWrites
    });
    const commonUniforms = [
      params.focusDistance,
      params.focusRange,
      params.cocScale,
      params.enabled ? 1.0 : 0.0,
      ...projection,
      params.sharpnessWidth,
      params.sharpnessPower,
      params.debugMode,
      0.0
    ];
    this.cocExtractPass.setUniforms(commonUniforms);
    this.cocExtractPass.encode(commandEncoder, {
      scene: checkedResources.scene,
      depth: checkedResources.depth,
      farOutput: this.farFieldTarget,
      nearOutput: this.nearFieldTarget,
      cocOutput: this.cocFieldTarget
    });
    this.farPyramid.encode(commandEncoder, this.farFieldTarget, {
      filterRadius: params.blurRadius
    });
    this.nearPyramid.encode(commandEncoder, this.nearFieldTarget, {
      filterRadius: params.blurRadius
    });
    this.cocPyramid.encode(commandEncoder, this.cocFieldTarget, {
      filterRadius: params.blurRadius
    });
    const half = this.pyramid.getLevel(2);
    const quarter = this.pyramid.getLevel(4);
    const eighth = this.pyramid.getLevel(8);
    const sixteenth = this.pyramid.getLevel(16);
    const farHalf = this.farPyramid.getLevel(2);
    const farQuarter = this.farPyramid.getLevel(4);
    const farEighth = this.farPyramid.getLevel(8);
    const farSixteenth = this.farPyramid.getLevel(16);
    const nearHalf = this.nearPyramid.getLevel(2);
    const nearQuarter = this.nearPyramid.getLevel(4);
    const nearEighth = this.nearPyramid.getLevel(8);
    const nearSixteenth = this.nearPyramid.getLevel(16);
    const cocSixteenth = this.cocPyramid.getLevel(16);
    this.compositePass.setUniforms(commonUniforms);
    this.compositePass.encode(commandEncoder, {
      scene: checkedResources.scene,
      depth: checkedResources.depth,
      sampler: half.getSampler(),
      sceneHalf: half,
      sceneQuarter: quarter,
      sceneEighth: eighth,
      sceneSixteenth: sixteenth,
      farHalf,
      farQuarter,
      farEighth,
      farSixteenth,
      nearHalf,
      nearQuarter,
      nearEighth,
      nearSixteenth,
      cocSixteenth,
      output: this.outputTarget
    }, {
      timestampWrites: lastTimestampWrites
    });
    return this.outputTarget;
  }

  // full-resolution targetとscene・coverage・CoCの全Levelを同じ寸法変更で更新します
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
    const outputChanged = resizeTarget(this.outputTarget, this.width, this.height);
    const farFieldChanged = resizeTarget(this.farFieldTarget, this.width, this.height);
    const nearFieldChanged = resizeTarget(this.nearFieldTarget, this.width, this.height);
    const cocFieldChanged = resizeTarget(this.cocFieldTarget, this.width, this.height);
    const pyramidChanged = this.pyramid.resize(this.width, this.height);
    const farPyramidChanged = this.farPyramid.resize(this.width, this.height);
    const nearPyramidChanged = this.nearPyramid.resize(this.width, this.height);
    const cocPyramidChanged = this.cocPyramid.resize(this.width, this.height);
    return outputChanged || farFieldChanged || nearFieldChanged || cocFieldChanged
      || pyramidChanged || farPyramidChanged || nearPyramidChanged || cocPyramidChanged;
  }

  getBlurTarget() {
    return this.pyramid.getLevel(16);
  }

  // 旧debug getterは表示名との互換性を維持し、固定Levelを返します
  getSmallBlurTarget() {
    return this.pyramid.getLevel(2);
  }

  getMediumBlurTarget() {
    return this.pyramid.getLevel(4);
  }

  getLargeBlurTarget() {
    return this.pyramid.getLevel(16);
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

  // 近景・遠景targetはpremultiplied色と純粋なgeometry coverageを保持します
  getFarFieldTarget() {
    this.requireAlive();
    return this.farFieldTarget;
  }

  getFarSixteenthTarget() {
    return this.farPyramid.getLevel(16);
  }

  // `near`の`field`の対象を現在の入力と状態から求め、呼び出し元へ返す
  getNearFieldTarget() {
    this.requireAlive();
    return this.nearFieldTarget;
  }

  getNearSixteenthTarget() {
    return this.nearPyramid.getLevel(16);
  }

  // 錯乱円の`field`の対象を現在の入力と状態から求め、呼び出し元へ返す
  getCocFieldTarget() {
    this.requireAlive();
    return this.cocFieldTarget;
  }

  getCocSixteenthTarget() {
    return this.cocPyramid.getLevel(16);
  }

  // 出力の対象を現在の入力と状態から求め、呼び出し元へ返す
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // DoFが所有するComputePass、Pyramid target、output targetを一度だけ破棄します
  destroy() {
    if (this.destroyed) return false;
    this.compositePass.destroy();
    this.cocExtractPass.destroy();
    this.pyramid.destroy();
    this.farPyramid.destroy();
    this.nearPyramid.destroy();
    this.cocPyramid.destroy();
    this.farFieldTarget.destroy();
    this.nearFieldTarget.destroy();
    this.cocFieldTarget.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
