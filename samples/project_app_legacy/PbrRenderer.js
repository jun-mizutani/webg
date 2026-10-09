// ---------------------------------------------
//  PbrRenderer.js  2026/09/23
//   ProjectApp sample layer for a compact Deferred PBR presentation
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import PbrEnvironment from "../../webg/PbrEnvironment.js";
import {
  createProceduralEnvironmentData,
  listProceduralEnvironmentPresets
} from "../../webg/ProceduralEnvironment.js";
import util from "../../webg/util.js";

// 高水準PBRのprofileごとに、画面効果を含む標準設定をまとめます
// studioではEyeRigが提供するCameraFrame.focusDistanceをDoFへ接続し、zoom後も同じ対象へ焦点を保ちます
export const PBR_RENDERER_PROFILES = Object.freeze({
  studio: Object.freeze({
    pipeline: Object.freeze({
      shadow: Object.freeze({
        type: "directional",
        pcfRadius: 0
      }),
      ssao: Object.freeze({
        radius: 28.0,
        strength: 2.0,
        bias: 0.05,
        samples: 12
      }),
      ssr: Object.freeze({
        intensity: 0.82,
        distance: 42.0,
        thickness: 0.42,
        steps: 48,
        resolutionScale: 0.7,
        reflectivityThreshold: 0.05
      }),
      lighting: Object.freeze({
        unitSystem: "relative",
        ambient: 0.0,
        directionalColor: Object.freeze([1.0, 0.92, 0.82]),
        directionalIntensity: 1.25,
        environmentIntensity: 0.50
      }),
      composer: Object.freeze({ mode: "pbr-ssr" }),
      toneMap: Object.freeze({
        mode: "reinhard",
        exposure: 1.12,
        saturation: 1.0,
        gamma: 2.2
      }),
      dof: Object.freeze({
        focusSource: "camera",
        focusRange: 7.0,
        cocScale: 0.95,
        blurRadius: 1.15,
        focusTransitionWidth: 0.40,
        sharpnessWidth: 0.60,
        sharpnessPower: 1.0,
        enabled: true
      })
    })
  })
});

const PBR_DOF_PUBLIC_KEYS = new Set([
  "enabled",
  "focus",
  "blurRadius"
]);

const PBR_DOF_FOCUS_PUBLIC_KEYS = new Set([
  "source",
  "rangeMeters",
  "transitionMeters"
]);

// project renderer manifestで利用者が指定できるpipeline blockを固定します
// ComputeEffectPipelineの低水準optionはこのmanifestへ直接公開せず、profileの既定値へ集約します
export const PBR_PIPELINE_MANIFEST_KEYS = Object.freeze([
  "shadow",
  "ssao",
  "ssr",
  "lighting",
  "composer",
  "toneMap"
]);

const PBR_PIPELINE_PUBLIC_KEYS = new Set([
  ...PBR_PIPELINE_MANIFEST_KEYS,
  "dof"
]);

// renderer manifestの最上位キーをSchemaとruntime validatorで共有できる一覧です
export const PBR_RENDERER_MANIFEST_KEYS = Object.freeze([
  "profile",
  "width",
  "height",
  "clearColor",
  "environment",
  "pipeline",
  "dof"
]);

// option blockに含まれる項目名を確認し、書き間違いを既定値へ隠さずに通知します
function requireKnownKeys(value, label, allowedKeys) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label}.${key} is not supported`);
    }
  }
}

// 環境presetと緯度経度画像の解像度を公開PBR設定として検証します
// 2:1の比率を設定段階で確認し、環境生成時のサイズエラーを初期化後へ遅らせません
export function validatePbrEnvironmentOptions(value, label = "PbrRenderer environment") {
  const source = util.readPlainObject(value, label, {});
  requireKnownKeys(source, label, new Set(["preset", "resolution"]));
  const preset = util.readOptionalEnum(
    source.preset,
    `${label}.preset`,
    "dark-studio",
    listProceduralEnvironmentPresets()
  );
  const resolution = util.readPlainObject(source.resolution, `${label}.resolution`, {});
  requireKnownKeys(resolution, `${label}.resolution`, new Set(["width", "height"]));
  const width = util.readOptionalInteger(
    resolution.width,
    `${label}.resolution.width`,
    64,
    { min: 2, max: 4096 }
  );
  const height = util.readOptionalInteger(
    resolution.height,
    `${label}.resolution.height`,
    32,
    { min: 1, max: 2048 }
  );
  if (width !== height * 2) {
    throw new Error(`${label}.resolution must have a 2:1 width-to-height ratio`);
  }
  return {
    preset,
    resolution: { width, height }
  };
}

// Shadow、SSAO、SSR、照明、composer、tone mappingの公開範囲をまとめて検証します
// 画面効果の内部段階やGPU resourceはこの入口へ持ち込まず、意味のある単位と組合せを固定します
export function validatePbrPipelineOptions(value, label = "PbrRenderer pipeline", {
  environmentEnabled = true
} = {}) {
  const pipeline = util.readPlainObject(value, label, {});
  requireKnownKeys(pipeline, label, PBR_PIPELINE_PUBLIC_KEYS);

  const shadow = util.readPlainObject(pipeline.shadow, `${label}.shadow`, {});
  requireKnownKeys(shadow, `${label}.shadow`, new Set([
    "type", "bias", "normalBias", "pcfRadius", "directional", "spot"
  ]));
  util.readOptionalEnum(shadow.type, `${label}.shadow.type`, "directional", ["directional", "spot"]);
  util.readOptionalFiniteNumber(shadow.bias, `${label}.shadow.bias`, 0.0015, { min: 0.0 });
  util.readOptionalFiniteNumber(shadow.normalBias, `${label}.shadow.normalBias`, 0.003, { min: 0.0 });
  util.readOptionalInteger(shadow.pcfRadius, `${label}.shadow.pcfRadius`, 1, { min: 0, max: 2 });

  const directional = util.readPlainObject(shadow.directional, `${label}.shadow.directional`, {});
  requireKnownKeys(directional, `${label}.shadow.directional`, new Set([
    "fitMode", "fitFar", "xyPadding", "depthPadding", "minHalfExtent", "minNear", "texelSnap", "up"
  ]));
  util.readOptionalEnum(
    directional.fitMode,
    `${label}.shadow.directional.fitMode`,
    "fixed",
    ["fixed", "frustum-fit"]
  );
  if (directional.fitFar !== undefined && directional.fitFar !== null) {
    util.readFiniteNumber(directional.fitFar, `${label}.shadow.directional.fitFar`, { minExclusive: 0.0 });
  }
  util.readOptionalFiniteNumber(directional.xyPadding, `${label}.shadow.directional.xyPadding`, 0.8, { min: 0.0 });
  util.readOptionalFiniteNumber(directional.depthPadding, `${label}.shadow.directional.depthPadding`, 4.0, { min: 0.0 });
  util.readOptionalFiniteNumber(directional.minHalfExtent, `${label}.shadow.directional.minHalfExtent`, 1.0, { minExclusive: 0.0 });
  util.readOptionalFiniteNumber(directional.minNear, `${label}.shadow.directional.minNear`, 0.2, { minExclusive: 0.0 });
  util.readOptionalBoolean(directional.texelSnap, `${label}.shadow.directional.texelSnap`, true);
  if (directional.up !== undefined) util.readVec3(directional.up, `${label}.shadow.directional.up`);

  const spot = util.readPlainObject(shadow.spot, `${label}.shadow.spot`, {});
  requireKnownKeys(spot, `${label}.shadow.spot`, new Set([
    "position", "direction", "fov", "innerAngle", "outerAngle", "near", "far", "aspect", "up"
  ]));
  if (spot.position !== undefined) util.readVec3(spot.position, `${label}.shadow.spot.position`);
  if (spot.direction !== undefined) util.readVec3(spot.direction, `${label}.shadow.spot.direction`);
  util.readOptionalFiniteNumber(spot.fov, `${label}.shadow.spot.fov`, 70.0, { minExclusive: 0.0, maxExclusive: 180.0 });
  util.readOptionalFiniteNumber(spot.innerAngle, `${label}.shadow.spot.innerAngle`, 40.0, { minExclusive: 0.0, maxExclusive: 180.0 });
  util.readOptionalFiniteNumber(spot.outerAngle, `${label}.shadow.spot.outerAngle`, 50.0, { minExclusive: 0.0, maxExclusive: 180.0 });
  const innerAngle = spot.innerAngle ?? 40.0;
  const outerAngle = spot.outerAngle ?? 50.0;
  if (innerAngle >= outerAngle) {
    throw new Error(`${label}.shadow.spot.innerAngle must be less than outerAngle`);
  }
  util.readOptionalFiniteNumber(spot.near, `${label}.shadow.spot.near`, 0.05, { minExclusive: 0.0 });
  util.readOptionalFiniteNumber(spot.far, `${label}.shadow.spot.far`, 42.0, { minExclusive: 0.0 });
  const near = spot.near ?? 0.05;
  const far = spot.far ?? 42.0;
  if (far <= near) {
    throw new Error(`${label}.shadow.spot.far must be greater than near`);
  }
  util.readOptionalFiniteNumber(spot.aspect, `${label}.shadow.spot.aspect`, 1.0, { minExclusive: 0.0 });
  if (spot.up !== undefined) util.readVec3(spot.up, `${label}.shadow.spot.up`);

  const ssao = util.readPlainObject(pipeline.ssao, `${label}.ssao`, {});
  requireKnownKeys(ssao, `${label}.ssao`, new Set(["radius", "strength", "bias", "samples", "resolutionScale"]));
  util.readOptionalFiniteNumber(ssao.radius, `${label}.ssao.radius`, 22.0, { min: 1.0 });
  util.readOptionalFiniteNumber(ssao.strength, `${label}.ssao.strength`, 1.55, { min: 0.0 });
  util.readOptionalFiniteNumber(ssao.bias, `${label}.ssao.bias`, 0.045, { min: 0.0, max: 1.0 });
  util.readOptionalInteger(ssao.samples, `${label}.ssao.samples`, 12, { min: 4, max: 16 });
  util.readOptionalFiniteNumber(ssao.resolutionScale, `${label}.ssao.resolutionScale`, 0.7, { min: 0.5, max: 1.0 });

  const ssr = util.readPlainObject(pipeline.ssr, `${label}.ssr`, {});
  requireKnownKeys(ssr, `${label}.ssr`, new Set([
    "intensity", "distance", "thickness", "steps", "resolutionScale", "reflectivityThreshold"
  ]));
  util.readOptionalFiniteNumber(ssr.intensity, `${label}.ssr.intensity`, 0.72, { min: 0.0, max: 1.5 });
  util.readOptionalFiniteNumber(ssr.distance, `${label}.ssr.distance`, 38.0, { min: 1.0 });
  util.readOptionalFiniteNumber(ssr.thickness, `${label}.ssr.thickness`, 0.42, { minExclusive: 0.0 });
  util.readOptionalInteger(ssr.steps, `${label}.ssr.steps`, 48, { min: 12, max: 64 });
  util.readOptionalFiniteNumber(ssr.resolutionScale, `${label}.ssr.resolutionScale`, 0.7, { min: 0.5, max: 1.0 });
  util.readOptionalFiniteNumber(ssr.reflectivityThreshold, `${label}.ssr.reflectivityThreshold`, 0.05, { min: 0.0, max: 1.0 });

  const lighting = util.readPlainObject(pipeline.lighting, `${label}.lighting`, {});
  requireKnownKeys(lighting, `${label}.lighting`, new Set([
    "unitSystem", "ambient", "directionalColor", "directionalIntensity", "spotColor", "spotIntensity",
    "spotMinimumDistance", "environmentIntensity", "environmentBackground", "environmentRotationDegrees"
  ]));
  const unitSystem = util.readOptionalEnum(
    lighting.unitSystem,
    `${label}.lighting.unitSystem`,
    "relative",
    ["relative", "photometric"]
  );
  const ambient = util.readOptionalFiniteNumber(lighting.ambient, `${label}.lighting.ambient`, 0.0, { min: 0.0, max: 1.0 });
  if (environmentEnabled && ambient > 0.0) {
    throw new Error(`${label}.lighting.ambient must be 0 when an environment is enabled`);
  }
  if (lighting.directionalColor !== undefined) util.readColor(lighting.directionalColor, `${label}.lighting.directionalColor`, undefined, 3);
  util.readOptionalFiniteNumber(lighting.directionalIntensity, `${label}.lighting.directionalIntensity`, 1.0, { min: 0.0 });
  if (lighting.spotColor !== undefined) util.readColor(lighting.spotColor, `${label}.lighting.spotColor`, undefined, 3);
  util.readOptionalFiniteNumber(lighting.spotIntensity, `${label}.lighting.spotIntensity`, 1.0, { min: 0.0 });
  if (lighting.spotMinimumDistance !== undefined && lighting.spotMinimumDistance !== null) {
    if (unitSystem !== "photometric") {
      throw new Error(`${label}.lighting.spotMinimumDistance requires photometric unitSystem`);
    }
    util.readFiniteNumber(lighting.spotMinimumDistance, `${label}.lighting.spotMinimumDistance`, { minExclusive: 0.0 });
  }
  util.readOptionalFiniteNumber(lighting.environmentIntensity, `${label}.lighting.environmentIntensity`, 1.0, { min: 0.0 });
  util.readOptionalBoolean(lighting.environmentBackground, `${label}.lighting.environmentBackground`, false);
  util.readOptionalFiniteNumber(lighting.environmentRotationDegrees, `${label}.lighting.environmentRotationDegrees`, 0.0);

  const composer = util.readPlainObject(pipeline.composer, `${label}.composer`, {});
  requireKnownKeys(composer, `${label}.composer`, new Set(["mode"]));
  util.readOptionalEnum(composer.mode, `${label}.composer.mode`, "pbr-ssr", ["add", "mix", "pbr-ssr"]);

  const toneMap = util.readPlainObject(pipeline.toneMap, `${label}.toneMap`, {});
  requireKnownKeys(toneMap, `${label}.toneMap`, new Set(["mode", "exposure", "exposureEv100", "saturation", "gamma", "blackBackground"]));
  util.readOptionalEnum(toneMap.mode, `${label}.toneMap.mode`, "reinhard", ["reinhard", "linear"]);
  if (toneMap.exposure !== undefined && toneMap.exposureEv100 !== undefined) {
    throw new Error(`${label}.toneMap.exposure and exposureEv100 cannot be specified together`);
  }
  if (toneMap.exposure !== undefined) util.readFiniteNumber(toneMap.exposure, `${label}.toneMap.exposure`, { min: 0.0, max: 4.0 });
  if (toneMap.exposureEv100 !== undefined) util.readFiniteNumber(toneMap.exposureEv100, `${label}.toneMap.exposureEv100`, { min: -24.0, max: 24.0 });
  util.readOptionalFiniteNumber(toneMap.saturation, `${label}.toneMap.saturation`, 1.0, { min: 0.0, max: 3.0 });
  util.readOptionalFiniteNumber(toneMap.gamma, `${label}.toneMap.gamma`, 2.2, { min: 0.1, max: 4.0 });
  util.readOptionalBoolean(toneMap.blackBackground, `${label}.toneMap.blackBackground`, false);
  if (unitSystem === "photometric" && toneMap.exposureEv100 === undefined) {
    throw new Error(`${label}.lighting.unitSystem photometric requires ${label}.toneMap.exposureEv100`);
  }

  if (pipeline.lightDirection !== undefined) util.readVec3(pipeline.lightDirection, `${label}.lightDirection`);
  if (pipeline.lightTarget !== undefined) util.readVec3(pipeline.lightTarget, `${label}.lightTarget`);
  for (const key of ["lightDistance", "lightHalfWidth", "lightHalfHeight", "lightNear", "lightFar"]) {
    if (pipeline[key] !== undefined) util.readFiniteNumber(pipeline[key], `${label}.${key}`, { minExclusive: 0.0 });
  }
  util.readOptionalInteger(pipeline.shadowMapSize, `${label}.shadowMapSize`, 1536, { min: 1 });
  util.readOptionalInteger(pipeline.maxLights, `${label}.maxLights`, 128, { min: 1 });
  return pipeline;
}

// 利用者向けのm単位DoF設定を、core passが受け取る内部値へ変換します
// 利用者は焦点中心から前後何mを鮮明にするかを指定し、Pyramid levelやCoC段階はrendererが解決します
export function resolvePbrDofOptions(value, baseDof = {}) {
  const options = util.readPlainObject(value, "PbrRenderer dof");
  for (const key of Object.keys(options)) {
    if (!PBR_DOF_PUBLIC_KEYS.has(key)) {
      throw new Error(`PbrRenderer dof.${key} is not supported`);
    }
  }
  const focus = util.readPlainObject(options.focus, "PbrRenderer dof.focus", {});
  for (const key of Object.keys(focus)) {
    if (!PBR_DOF_FOCUS_PUBLIC_KEYS.has(key)) {
      throw new Error(`PbrRenderer dof.focus.${key} is not supported`);
    }
  }
  const source = util.readOptionalEnum(
    focus.source,
    "PbrRenderer dof.focus.source",
    "camera",
    ["camera"]
  );
  const rangeMeters = util.readOptionalFiniteNumber(
    focus.rangeMeters,
    "PbrRenderer dof.focus.rangeMeters",
    2.0,
    { minExclusive: 0.0 }
  );
  const transitionMeters = util.readOptionalFiniteNumber(
    focus.transitionMeters,
    "PbrRenderer dof.focus.transitionMeters",
    0.6,
    { min: 0.0 }
  );
  const sharpnessWidth = 0.95;
  const internalFocusRange = rangeMeters / sharpnessWidth;
  const internalTransitionWidth = transitionMeters / internalFocusRange;
  if (internalTransitionWidth > 4.0 - sharpnessWidth) {
    throw new Error(
      "PbrRenderer dof.focus.transitionMeters is too large for the requested focus range"
    );
  }
  const base = util.readPlainObject(baseDof, "PbrRenderer base dof", {});
  const enabled = util.readOptionalBoolean(
    options.enabled,
    "PbrRenderer dof.enabled",
    base.enabled === undefined ? true : base.enabled
  );
  const blurRadius = util.readOptionalFiniteNumber(
    options.blurRadius,
    "PbrRenderer dof.blurRadius",
    base.blurRadius === undefined ? 1.0 : base.blurRadius,
    { min: 0.25, max: 3.0 }
  );
  return {
    core: {
      ...base,
      enabled,
      focusSource: source,
      focusRange: internalFocusRange,
      cocScale: 1.0,
      blurRadius,
      sharpnessWidth,
      focusTransitionWidth: internalTransitionWidth
    },
    public: Object.freeze({
      enabled,
      focusSource: source,
      rangeMeters,
      transitionMeters,
      blurRadius
    })
  };
}

// profileと利用者のpipeline optionを合成し、effect block単位の明示設定を保ちます
// 利用者が指定したdof fieldをprofile値へ重ね、各fieldの設定値を保ちます
export function resolvePbrRendererProfile(profileName, pipelineOptions = {}) {
  const name = util.readOptionalEnum(
    profileName,
    "PbrRenderer profile",
    "studio",
    Object.keys(PBR_RENDERER_PROFILES)
  );
  const pipeline = util.readPlainObject(pipelineOptions, "PbrRenderer pipeline", {});
  requireKnownKeys(
    pipeline,
    "PbrRenderer pipeline",
    new Set(PBR_PIPELINE_MANIFEST_KEYS)
  );
  const profile = PBR_RENDERER_PROFILES[name];
  const profileDof = util.readPlainObject(profile.pipeline.dof, "PbrRenderer profile dof", {});
  const overrideDof = util.readPlainObject(pipeline.dof, "PbrRenderer pipeline.dof", {});
  const effectBlocks = ["shadow", "ssao", "ssr", "lighting", "composer", "toneMap"];
  const mergedPipeline = { ...profile.pipeline, ...pipeline };
  for (const key of effectBlocks) {
    if (pipeline[key] !== undefined) {
      mergedPipeline[key] = {
        ...util.readPlainObject(profile.pipeline[key], `PbrRenderer profile ${key}`, {}),
        ...util.readPlainObject(pipeline[key], `PbrRenderer pipeline.${key}`, {})
      };
    }
  }
  const toneMapOverride = util.readPlainObject(pipeline.toneMap, "PbrRenderer pipeline.toneMap", {});
  const hasExposure = Object.prototype.hasOwnProperty.call(toneMapOverride, "exposure");
  const hasExposureEv100 = Object.prototype.hasOwnProperty.call(toneMapOverride, "exposureEv100");
  if (hasExposure && !hasExposureEv100) {
    delete mergedPipeline.toneMap.exposureEv100;
  } else if (hasExposureEv100 && !hasExposure) {
    delete mergedPipeline.toneMap.exposure;
  }
  return {
    ...mergedPipeline,
    dof: { ...profileDof, ...overrideDof }
  };
}

// renderer manifestの環境、profile、DoF、画面効果を一度に検証します
// constructorはこの結果だけをresource生成へ渡し、公開単位とcore単位の境界を一か所へ集めます
export function validatePbrRendererOptions(options = {}, label = "PbrRenderer") {
  const source = util.readPlainObject(options, `${label} options`, {});
  requireKnownKeys(source, `${label} options`, new Set([
    "label", "profile", "width", "height", "clearColor", "environment", "pipeline", "dof"
  ]));
  if (source.width !== undefined) {
    util.readFiniteNumber(source.width, `${label}.width`, { integer: true, min: 1 });
  }
  if (source.height !== undefined) {
    util.readFiniteNumber(source.height, `${label}.height`, { integer: true, min: 1 });
  }
  if (source.clearColor !== undefined) {
    util.readColor(source.clearColor, `${label}.clearColor`, undefined, 4);
  }
  const profile = util.readOptionalEnum(
    source.profile,
    `${label} profile`,
    "studio",
    Object.keys(PBR_RENDERER_PROFILES)
  );
  const environment = validatePbrEnvironmentOptions(source.environment, `${label} environment`);
  const pipeline = resolvePbrRendererProfile(profile, source.pipeline);
  validatePbrPipelineOptions(pipeline, `${label} pipeline`, { environmentEnabled: true });
  let dofPresentation = null;
  if (source.dof !== undefined) {
    const dof = resolvePbrDofOptions(source.dof, pipeline.dof);
    dofPresentation = dof.public;
    return {
      profile,
      environment,
      pipeline: { ...pipeline, dof: dof.core },
      dofPresentation
    };
  }
  return { profile, environment, pipeline, dofPresentation };
}

// 現在のdominoで個別に作っている環境、pipeline、最終copyを一つへまとめる試作クラスです
// 既存のWebgAppとComputeEffectPipelineの公開APIを組み合わせ、高水準呼出しを検証します
export default class PbrRenderer {
  // GPU contextとPBR設定を検証し、非同期resource生成をready Promiseへまとめます
  // 指定されたpresetと解像度をそのまま生成し、environment設定を固定します
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("PbrRenderer requires a ready WebGPU context");
    }
    const opts = util.readPlainObject(options, "PbrRenderer options", {});
    this.gpu = gpu;
    this.label = util.readOptionalString(opts.label, "PbrRenderer label", "pbr-renderer", {
      trim: true,
      allowEmpty: false
    });
    this.width = util.readFiniteNumber(opts.width, `${this.label} width`, { integer: true, min: 1 });
    this.height = util.readFiniteNumber(opts.height, `${this.label} height`, { integer: true, min: 1 });
    this.clearColor = opts.clearColor === undefined
      ? [0.0, 0.0, 0.0, 1.0]
      : util.readColor(opts.clearColor, `${this.label} clearColor`, undefined, 4);
    const rendererOptions = validatePbrRendererOptions({
      profile: opts.profile,
      environment: opts.environment,
      pipeline: opts.pipeline,
      dof: opts.dof
    }, this.label);
    this.profile = rendererOptions.profile;
    this.environmentOptions = rendererOptions.environment;
    this.pipelineOptions = rendererOptions.pipeline;
    this.dofPresentation = rendererOptions.dofPresentation;
    this.environment = null;
    this.pipeline = null;
    this.copyPass = null;
    this.outputTarget = null;
    this.destroyed = false;
    this.state = "loading";
    this.ready = this.initialize();
  }

  // PBR environment、Deferred pipeline、canvas copy passを同じGPUへ作成します
  // 途中で失敗したresourceはこのProjectApp sampleが破棄し、利用者へ初期化失敗を明示します
  async initialize() {
    try {
      const environmentData = createProceduralEnvironmentData(this.environmentOptions);
      this.environment = new PbrEnvironment(this.gpu, {
        label: `${this.label}-environment`,
        ...environmentData
      });
      const lighting = util.readPlainObject(this.pipelineOptions.lighting, `${this.label} pipeline.lighting`, {});
      this.pipeline = new ComputeEffectPipeline(this.gpu, {
        ...this.pipelineOptions,
        width: this.width,
        height: this.height,
        lighting: {
          ...lighting,
          environment: this.environment.getResources()
        }
      });
      this.copyPass = new FullscreenPass(this.gpu);
      await Promise.all([this.pipeline.ready, this.copyPass.init()]);
      this.state = "ready";
      return this;
    } catch (error) {
      this.destroy();
      this.state = "failed";
      throw error;
    }
  }

  // resource生成完了を確認し、ready状態のpipelineへGPU commandを送ります
  async waitUntilReady() {
    await this.ready;
    this.requireReady();
    return this;
  }

  // rendererの状態を各公開処理で検証し、readyなresourceだけを使用します
  requireReady() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
    if (this.state !== "ready") {
      throw new Error(`${this.label} requires ready state`);
    }
  }

  // SceneをG-bufferへ描き、同じCameraFrameを後段encodeへ固定します
  // Reverse-Z検証をComputeEffectPipelineへ委譲し、カメラ規約をcoreの処理で確認します
  renderScene(space, cameraFrame, clearColor = this.clearColor, options = {}) {
    this.requireReady();
    this.pipeline.renderScene(space, cameraFrame, clearColor, options);
    return this;
  }

  // Deferred Lightingからtone mappingまでを同じcommand encoderへ記録します
  // submitはWebgAppまたはframe ownerが担当し、rendererは記録済みcommandを返します
  encode(commandEncoder, options = {}) {
    this.requireReady();
    if (this.dofPresentation?.enabled
      && this.dofPresentation.focusSource === "camera"
      && (!Number.isFinite(options.cameraFrame?.focusDistance)
        || options.cameraFrame.focusDistance <= this.dofPresentation.rangeMeters)) {
      throw new Error(
        `${this.label} DoF focus center must be farther than focus range in meters`
      );
    }
    this.outputTarget = this.pipeline.encode(commandEncoder, options);
    return this.outputTarget;
  }

  // 前回encodeした最終textureをPresent passへ描きます
  // Present passの終了とqueue submitはScreenへ残し、commandの順序を呼出側が確認できます
  present(screen, options = {}) {
    this.requireReady();
    if (!screen || typeof screen.beginPresentPass !== "function") {
      throw new Error(`${this.label} present requires a Screen-like object`);
    }
    if (!this.outputTarget) {
      throw new Error(`${this.label} present requires encode() output`);
    }
    const clearColor = options.clearColor === undefined
      ? this.clearColor
      : util.readColor(options.clearColor, `${this.label} present clearColor`, undefined, 4);
    screen.beginPresentPass({ clearColor, colorLoadOp: "clear" });
    this.copyPass.draw(this.outputTarget);
    return this;
  }

  // WebgAppのframe callbackへDeferred PBRのRender Pass処理を接続します
  // 利用者側にはScene、cameraFrame、renderer設定を渡してもらい、pass終了とPresentの順序はこのProjectApp sampleが管理します
  createFrameCallbacks(app, options = {}) {
    this.requireReady();
    if (!app || typeof app !== "object" || !app.space) {
      throw new Error(`${this.label} createFrameCallbacks requires a WebgApp with space`);
    }
    const opts = util.readPlainObject(options, `${this.label} frame callbacks`, {});
    const renderSceneOptions = util.readPlainObject(
      opts.renderScene,
      `${this.label} frame callbacks.renderScene`,
      {}
    );
    const encodeOptions = util.readPlainObject(
      opts.encode,
      `${this.label} frame callbacks.encode`,
      {}
    );
    const onPresented = opts.onPresented;
    if (onPresented !== undefined && typeof onPresented !== "function") {
      throw new Error(`${this.label} frame callbacks.onPresented must be a function`);
    }
    const onUpdate = opts.onUpdate;
    if (onUpdate !== undefined && typeof onUpdate !== "function") {
      throw new Error(`${this.label} frame callbacks.onUpdate must be a function`);
    }
    const beforeRenderScene = opts.beforeRenderScene;
    if (beforeRenderScene !== undefined && typeof beforeRenderScene !== "function") {
      throw new Error(`${this.label} frame callbacks.beforeRenderScene must be a function`);
    }
    const afterPresentPass = opts.afterPresentPass;
    if (afterPresentPass !== undefined && typeof afterPresentPass !== "function") {
      throw new Error(`${this.label} frame callbacks.afterPresentPass must be a function`);
    }
    return Object.freeze({
      onUpdate: ({ screen, ...frame }) => {
        if (!screen || typeof screen.getWidth !== "function" || typeof screen.getHeight !== "function") {
          throw new Error(`${this.label} frame callback requires a Screen-like object`);
        }
        this.resize(screen.getWidth(), screen.getHeight());
        if (typeof onUpdate === "function") onUpdate({ screen, ...frame });
      },
      onBeforeDraw: (frame) => {
        const { cameraFrame, screen } = frame;
        if (!screen || typeof screen.getGPU !== "function") {
          throw new Error(`${this.label} frame callback requires Screen.getGPU()`);
        }
        screen.getGPU().endPass();
        if (typeof beforeRenderScene === "function") {
          beforeRenderScene({ app, screen, ...frame });
        }
        this.renderScene(app.space, cameraFrame, app.clearColor, renderSceneOptions);
      },
      onAfterDraw3d: (frame) => {
        const { cameraFrame, screen } = frame;
        if (!screen || typeof screen.getGPU !== "function") {
          throw new Error(`${this.label} frame callback requires Screen.getGPU()`);
        }
        const frameGpu = screen.getGPU();
        frameGpu.endPass();
        this.encode(frameGpu.commandEncoder, { ...encodeOptions, cameraFrame });
        this.present(screen);
        if (typeof onPresented === "function") onPresented({ screen, ...frame });
        if (typeof afterPresentPass === "function") {
          afterPresentPass({ app, screen, ...frame });
        }
      }
    });
  }

  // canvasのpixel寸法変更をpipelineの全中間targetへ伝えます
  // widthとheightを検証し、resize後のG-bufferとcanvasの寸法を一致させます
  resize(width, height) {
    this.requireReady();
    const nextWidth = util.readFiniteNumber(width, `${this.label} width`, { integer: true, min: 1 });
    const nextHeight = util.readFiniteNumber(height, `${this.label} height`, { integer: true, min: 1 });
    const changed = nextWidth !== this.width || nextHeight !== this.height;
    if (changed) {
      this.width = nextWidth;
      this.height = nextHeight;
      this.pipeline.resize(nextWidth, nextHeight);
      this.outputTarget = null;
    }
    return changed;
  }

  // 次の診断表示へ使えるpipeline状態を返します
  // 内部classを観測値へ変換して公開し、ProjectApp sampleの設定を管理します
  getDiagnostics() {
    this.requireReady();
    return Object.freeze({
      label: this.label,
      profile: this.profile,
      width: this.width,
      height: this.height,
      hasEnvironment: this.environment !== null,
      hasOutput: this.outputTarget !== null,
      dof: this.dofPresentation
    });
  }

  // PBR pipeline、copy pass、IBL textureを一度だけ依存順に破棄します
  // destroyを一回の破棄処理として扱い、resourceの状態を固定します
  destroy() {
    if (this.destroyed) {
      return false;
    }
    this.copyPass?.destroy?.();
    this.pipeline?.destroy?.();
    this.environment?.destroy?.();
    this.copyPass = null;
    this.pipeline = null;
    this.environment = null;
    this.outputTarget = null;
    this.destroyed = true;
    if (this.state !== "failed") {
      this.state = "destroyed";
    }
    return true;
  }
}
