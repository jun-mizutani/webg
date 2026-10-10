// ---------------------------------------------------------
// main.js  2026/10/10
//   Forward and deferred GGX comparison application
// ---------------------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import PbrEnvironment from "../../webg/PbrEnvironment.js";
import {
  decodePbrEnvironmentCache,
  encodePbrEnvironmentCache,
  loadPbrEnvironmentCache,
  PbrEnvironmentCacheRepository
} from "../../webg/PbrEnvironmentCache.js";
import PbrEnvironmentCompute from "../../webg/PbrEnvironmentCompute.js";
import PbrEnvironmentDebugPass, {
  mapPbrEnvironmentDebugUv
} from "../../webg/PbrEnvironmentDebugPass.js";
import {
  estimatePbrEnvironmentMemory,
  evaluatePbrWhiteFurnace
} from "../../webg/PbrEnvironmentEvaluation.js";
import {
  createPbrEnvironmentReferenceData,
  readPbrEnvironmentPreprocessOptions
} from "../../webg/PbrEnvironmentReference.js";
import { convertRadianceHdrToLinearSrgb } from "../../webg/RadianceHdr.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Texture from "../../webg/Texture.js";
import PbrForwardShader from "./PbrForwardShader.js";
import { decodeDiagnosticRadianceHdr } from "./DiagnosticRadianceHdr.js";
import { createProceduralEnvironmentData } from "../../webg/ProceduralEnvironment.js";

// 比較するroughness列とmetallic行を固定し、描画経路を切り替えても同じShapeと値を使う
const ROUGHNESS_VALUES = Object.freeze([0.08, 0.20, 0.40, 0.65, 0.90]);
const METALLIC_VALUES = Object.freeze([0.0, 0.5, 1.0]);
const BASE_COLOR_SRGB = Object.freeze([0.78, 0.32, 0.12, 1.0]);
const LIGHT_TO_SURFACE_WORLD = Object.freeze([-0.35, -0.55, -1.0]);
const SURFACE_TO_LIGHT_VIEW = Object.freeze([0.35, 0.55, 1.0, 0.0]);
const TRANSPARENT_PBR_LOCAL_LIGHTS = Object.freeze([
  Object.freeze({
    type: "point",
    position: [2.4, 1.8, 3.2],
    color: [0.35, 0.55, 1.0],
    radius: 8.0,
    intensity: 5.0
  }),
  Object.freeze({
    type: "cone",
    position: [-2.6, 2.8, 3.5],
    direction: [2.6, -2.8, -3.5],
    color: [1.0, 0.35, 0.12],
    radius: 9.0,
    intensity: 7.0,
    innerAngle: 24.0,
    outerAngle: 42.0
  })
]);
const PHOTOMETRIC_LOCAL_LIGHTS = Object.freeze(
  TRANSPARENT_PBR_LOCAL_LIGHTS.map((light, index) => Object.freeze({
    ...light,
    intensity: index === 0 ? 1800.0 : 2600.0,
    minimumDistance: 0.20
  }))
);
const PHOTOMETRIC_DIRECTIONAL_LUX = 1000.0;
const PHOTOMETRIC_EXPOSURE_EV100 = 9.0;
const DIAGNOSTIC_PREPROCESS_OPTIONS = Object.freeze({
  irradianceWidth: 8,
  irradianceHeight: 4,
  specularWidth: 16,
  specularHeight: 8,
  specularMipCount: 5,
  brdfLutWidth: 32,
  brdfLutHeight: 32,
  diffuseSampleCount: 128,
  specularSampleCount: 128,
  brdfSampleCount: 128
});
const DIAGNOSTIC_GPU_MAX_ERROR = 0.25;
const DIAGNOSTIC_CACHE_SOURCE_ID = "webg-diagnostic-linear-srgb-v2";
const REAL_HDR_CACHE_SOURCE_ID = "polyhaven-studio-small-01-1k";
const REAL_HDR_CACHE_URL = "./assets/studio_small_01_1k_standard.webgpbr";
// 同梱standard cacheのmanifestと同じ寸法・sample数をcoreの共通validatorで検証します
const REAL_HDR_PREPROCESS_OPTIONS = readPbrEnvironmentPreprocessOptions({
  irradianceWidth: 64,
  irradianceHeight: 32,
  specularWidth: 256,
  specularHeight: 128,
  specularMipCount: 9,
  brdfLutWidth: 128,
  brdfLutHeight: 128,
  diffuseSampleCount: 512,
  specularSampleCount: 512,
  brdfSampleCount: 512
});
const ENVIRONMENT_MODES = Object.freeze(["procedural", "diagnostic", "real"]);
const ENVIRONMENT_DEBUG_VIEWS = Object.freeze([
  "scene",
  "radiance",
  "irradiance",
  "specular",
  "brdfLut"
]);

let app = null;
let pipeline = null;
let copyPass = null;
let proceduralEnvironment = null;
let diagnosticEnvironment = null;
let diagnosticEnvironmentCompute = null;
let diagnosticCacheRepository = null;
let diagnosticCacheHandle = null;
let diagnosticCachedData = null;
let realEnvironment = null;
let realCachedData = null;
let environmentDebugPass = null;
let environmentDebugView = "scene";
let environmentDebugMipLevel = 0;
let environmentDebugExposureStops = 0.0;
let environmentDebugSelectedUv = [0.5, 0.5];
let environmentMode = "procedural";
let hdrBackgroundEnabled = false;
let directLightEnabled = true;
let environmentRotationDegrees = 0.0;
let renderMode = "forward";
let iblEnabled = false;
let ssrEnabled = false;
let pbrTexturesEnabled = false;
let pbrTextures = null;
let gltfFixtureEnabled = false;
let transparentPbrFixtureEnabled = false;
let photometricEnabled = false;
let gltfFixtureModel = null;
let gltfFixtureInstance = null;
let alphaCheckerTexture = null;
const materialShapes = [];
const alphaComparisonShapes = [];

// 起動失敗をCanvas外へ表示し、WebGPU validationやmodule例外を画面から確認できるようにする
function showStartError(error) {
  const status = document.getElementById("statusError");
  if (status) {
    status.textContent = error?.message ?? String(error);
  }
  document.body.dataset.pbrStatus = "error";
  console.error("pbr_reference failed:", error);
}

// 現在の描画経路をDOMへ反映し、自動テストからもdatasetで確認できるようにする
function updateModeDisplay() {
  const mode = document.getElementById("statusMode");
  const button = document.getElementById("toggleMode");
  if (mode) mode.textContent = renderMode === "forward" ? "Forward GGX" : "Deferred GGX";
  if (button) button.textContent = renderMode === "forward" ? "Deferredへ切替" : "Forwardへ切替";
  document.body.dataset.renderMode = renderMode;
  app?.requestRender?.();
}

// forwardとdeferredを交互に切り替え、同じcamera frameとsceneで差を比較する
function toggleRenderMode() {
  renderMode = renderMode === "forward" ? "deferred" : "forward";
  updateModeDisplay();
}

// SSR状態をDOMへ反映し、IBL側から無効化した場合もbutton、status、datasetを一致させる
function updateSsrDisplay() {
  const button = document.getElementById("toggleSsr");
  const status = document.getElementById("statusSsr");
  if (button) button.textContent = ssrEnabled ? "PBR SSRを無効化" : "PBR SSRを有効化";
  if (status) status.textContent = ssrEnabled ? "PBR specular replacement" : "Off";
  document.body.dataset.ssrEnabled = ssrEnabled ? "true" : "false";
}

// IBL状態をDOMと描画modeへ反映し、別の比較切替からも同じ更新処理を使えるようにする
function setIblEnabled(enabled) {
  iblEnabled = enabled;
  if (iblEnabled) renderMode = "deferred";
  if (!iblEnabled && ssrEnabled) {
    ssrEnabled = false;
    updateSsrDisplay();
  }
  const button = document.getElementById("toggleIbl");
  const status = document.getElementById("statusIbl");
  if (button) button.textContent = iblEnabled ? "IBLを無効化" : "IBLを有効化";
  if (status) {
    const environmentLabels = {
      procedural: "Procedural HDR",
      diagnostic: "Diagnostic HDR / cached Compute prefilter",
      real: "Studio Small 01 / standard asset cache"
    };
    status.textContent = iblEnabled ? environmentLabels[environmentMode] : "Off";
  }
  document.body.dataset.iblEnabled = iblEnabled ? "true" : "false";
  updateModeDisplay();
}

// IBLを有効にしたときは環境反射を実装したdeferredへ切り替える
function toggleIbl() {
  setIblEnabled(!iblEnabled);
}

// PBR SSR確認ではIBLとDeferredを必ず有効にし、鏡面IBL置換経路だけを切り替える
function toggleSsr() {
  ssrEnabled = !ssrEnabled;
  if (ssrEnabled) setIblEnabled(true);
  updateSsrDisplay();
  updateModeDisplay();
}

// 現在の環境と次に選べる環境を同時に示し、切替後のbutton文言を他の操作とも同期します
function updateEnvironmentModeDisplay() {
  const button = document.getElementById("toggleHdrEnvironment");
  const nextLabels = {
    procedural: "診断HDR IBLへ切替",
    diagnostic: "実写HDR IBLへ切替",
    real: "手続きIBLへ戻す"
  };
  if (!Object.prototype.hasOwnProperty.call(nextLabels, environmentMode)) {
    throw new Error(`unknown PBR environment mode: ${environmentMode}`);
  }
  if (button) button.textContent = nextLabels[environmentMode];
  document.body.dataset.hdrEnvironment = environmentMode;
}

// 手続き、方向診断、実写assetを固定順に切り替え、どの環境を使うか画面へ明示します
function toggleHdrEnvironment() {
  const currentIndex = ENVIRONMENT_MODES.indexOf(environmentMode);
  if (currentIndex < 0) throw new Error(`unknown PBR environment mode: ${environmentMode}`);
  environmentMode = ENVIRONMENT_MODES[(currentIndex + 1) % ENVIRONMENT_MODES.length];
  environmentDebugMipLevel = 0;
  updateEnvironmentModeDisplay();
  setIblEnabled(true);
}

// 元HDRを物体のないpixelへ表示し、同じ環境をIBLにも必ず使用します
function toggleHdrBackground() {
  hdrBackgroundEnabled = !hdrBackgroundEnabled;
  if (hdrBackgroundEnabled) setIblEnabled(true);
  const button = document.getElementById("toggleHdrBackground");
  const status = document.getElementById("statusHdrBackground");
  if (button) button.textContent = hdrBackgroundEnabled
    ? "HDR背景を隠す"
    : "HDR背景を表示";
  if (status) status.textContent = hdrBackgroundEnabled ? "Original radiance" : "Off";
  document.body.dataset.hdrBackground = hdrBackgroundEnabled ? "true" : "false";
  updateModeDisplay();
}

// 直接光を外してHDR環境由来の拡散と鏡面反射だけを確認できる状態へ切り替えます
function toggleIblOnly() {
  directLightEnabled = !directLightEnabled;
  if (!directLightEnabled) setIblEnabled(true);
  const button = document.getElementById("toggleIblOnly");
  const status = document.getElementById("statusDirectLight");
  if (button) button.textContent = directLightEnabled
    ? "IBLのみで確認"
    : "直接光を戻す";
  if (status) status.textContent = directLightEnabled ? "On" : "Off: IBL only";
  document.body.dataset.directLight = directLightEnabled ? "true" : "false";
  updateModeDisplay();
}

// 環境をworld-spaceのY軸周りに45度ずつ回し、背景とIBL反射を同じ角度で更新します
function rotateEnvironment() {
  environmentRotationDegrees = (environmentRotationDegrees + 45.0) % 360.0;
  setIblEnabled(true);
  const status = document.getElementById("statusEnvironmentRotation");
  if (status) status.textContent = `${environmentRotationDegrees.toFixed(0)}° around +Y`;
  document.body.dataset.environmentRotation = environmentRotationDegrees.toFixed(0);
  updateModeDisplay();
}

// 現在選択したcacheのCPU dataを返し、実写assetでも画面と同じtexel値を表示します
function getSelectedCachedData() {
  if (environmentMode === "diagnostic") return diagnosticCachedData;
  if (environmentMode === "real") return realCachedData;
  return null;
}

// 選択cacheのmip数とroughness対応を診断表示へ渡します
function getSelectedPreprocessOptions() {
  if (environmentMode === "diagnostic") return DIAGNOSTIC_PREPROCESS_OPTIONS;
  if (environmentMode === "real") return REAL_HDR_PREPROCESS_OPTIONS;
  return null;
}

// 現在の診断viewが参照するcache内CPU levelを返し、画面上のtexel値表示と一致させます
function getEnvironmentDebugLevel() {
  const cachedData = getSelectedCachedData();
  if (!cachedData || environmentDebugView === "scene") return null;
  if (environmentDebugView === "radiance") return cachedData.radiance;
  if (environmentDebugView === "irradiance") return cachedData.irradiance;
  if (environmentDebugView === "specular") {
    return cachedData.prefilteredSpecular[environmentDebugMipLevel];
  }
  return cachedData.brdfLut;
}

// view名、mipとroughness、表示露出、crosshair位置の実値を一括してDOMへ反映します
function updateEnvironmentDebugDisplay() {
  const button = document.getElementById("toggleEnvironmentDebugView");
  const viewStatus = document.getElementById("statusEnvironmentDebugView");
  const detailStatus = document.getElementById("statusEnvironmentDebugDetail");
  const pixelStatus = document.getElementById("statusEnvironmentDebugPixel");
  const labels = {
    scene: "Final spheres",
    radiance: "Original HDR radiance",
    irradiance: "Diffuse irradiance",
    specular: "GGX prefiltered specular",
    brdfLut: "BRDF LUT: R scale / G bias"
  };
  if (button) button.textContent = `環境診断: ${labels[environmentDebugView]}`;
  if (viewStatus) viewStatus.textContent = labels[environmentDebugView];
  const level = getEnvironmentDebugLevel();
  if (!level) {
    if (detailStatus) detailStatus.textContent = "球表示 / cache IBL";
    if (pixelStatus) pixelStatus.textContent = "診断画像を選択してください";
  } else {
    const exposureText = environmentDebugView === "brdfLut"
      ? "display linear"
      : `exposure ${environmentDebugExposureStops >= 0 ? "+" : ""}${environmentDebugExposureStops.toFixed(0)} EV`;
    const preprocessOptions = getSelectedPreprocessOptions();
    const roughness = preprocessOptions.specularMipCount === 1
      ? 0.04
      : environmentDebugMipLevel
        / (preprocessOptions.specularMipCount - 1);
    if (detailStatus) {
      detailStatus.textContent = environmentDebugView === "specular"
        ? `${level.width}x${level.height} / mip ${environmentDebugMipLevel} / roughness ${roughness.toFixed(2)} / ${exposureText}`
        : `${level.width}x${level.height} / ${exposureText}`;
    }
    const u = environmentDebugSelectedUv[0];
    const v = environmentDebugSelectedUv[1];
    const x = Math.min(level.width - 1, Math.floor(u * level.width));
    const y = Math.min(level.height - 1, Math.floor(v * level.height));
    const channels = environmentDebugView === "brdfLut" ? 2 : 4;
    const offset = (y * level.width + x) * channels;
    const channelNames = environmentDebugView === "brdfLut"
      ? ["R(scale)", "G(bias)"]
      : ["R", "G", "B"];
    const values = channelNames.map((name, index) => (
      `${name} ${level.data[offset + index].toFixed(5)}`
    ));
    if (pixelStatus) {
      pixelStatus.textContent = `UV ${u.toFixed(3)}, ${v.toFixed(3)} / texel ${x}, ${y} / ${values.join(" / ")}`;
    }
  }
  document.body.dataset.environmentDebugView = environmentDebugView;
  document.body.dataset.environmentDebugMip = String(environmentDebugMipLevel);
  document.body.dataset.environmentDebugExposure = String(environmentDebugExposureStops);
  document.body.dataset.environmentDebugUv = environmentDebugSelectedUv.join(",");
  app?.requestRender?.();
}

// 球、元HDR、irradiance、specular、BRDF LUTを固定順で切り替えます
function toggleEnvironmentDebugView() {
  const index = ENVIRONMENT_DEBUG_VIEWS.indexOf(environmentDebugView);
  environmentDebugView = ENVIRONMENT_DEBUG_VIEWS[(index + 1) % ENVIRONMENT_DEBUG_VIEWS.length];
  if (environmentDebugView !== "scene") {
    if (environmentMode === "procedural") environmentMode = "diagnostic";
    updateEnvironmentModeDisplay();
    setIblEnabled(true);
  }
  updateEnvironmentDebugDisplay();
}

// specular診断へ切り替え、roughnessと対応するmipを一段ずつ循環させます
function nextEnvironmentDebugMip() {
  if (environmentMode === "procedural") environmentMode = "diagnostic";
  updateEnvironmentModeDisplay();
  const preprocessOptions = getSelectedPreprocessOptions();
  environmentDebugView = "specular";
  environmentDebugMipLevel = (environmentDebugMipLevel + 1)
    % preprocessOptions.specularMipCount;
  setIblEnabled(true);
  updateEnvironmentDebugDisplay();
}

// HDR診断表示だけの露出段数を変更し、照明用environment intensityを保持します
function changeEnvironmentDebugExposure(delta) {
  if (environmentDebugView === "scene") environmentDebugView = "radiance";
  environmentDebugExposureStops = Math.min(
    Math.max(environmentDebugExposureStops + delta, -8.0),
    8.0
  );
  if (environmentMode === "procedural") environmentMode = "diagnostic";
  updateEnvironmentModeDisplay();
  setIblEnabled(true);
  updateEnvironmentDebugDisplay();
}

// Canvas上のclickをaspect fit後の画像UVへ戻し、crosshairと数値表示を同じtexelへ移します
function selectEnvironmentDebugPixel(event) {
  const level = getEnvironmentDebugLevel();
  if (!level) return;
  const canvas = document.getElementById("canvas");
  const rect = canvas.getBoundingClientRect();
  const screenU = (event.clientX - rect.left) / rect.width;
  const screenV = (event.clientY - rect.top) / rect.height;
  const selectedUv = mapPbrEnvironmentDebugUv(
    [screenU, screenV],
    [Math.round(rect.width), Math.round(rect.height)],
    [level.width, level.height]
  );
  if (selectedUv === null) return;
  environmentDebugSelectedUv = selectedUv;
  updateEnvironmentDebugDisplay();
}

// 相対強度とphotometric単位をsceneを作り直さず切り替え、物理単位時はEV100を必須にします
function toggleUnitSystem() {
  photometricEnabled = !photometricEnabled;
  if (photometricEnabled) renderMode = "deferred";
  const button = document.getElementById("toggleUnitSystem");
  const unitStatus = document.getElementById("statusUnitSystem");
  const exposureStatus = document.getElementById("statusExposure");
  if (button) button.textContent = photometricEnabled
    ? "相対光源へ戻す"
    : "物理光源へ切替";
  if (unitStatus) unitStatus.textContent = photometricEnabled
    ? "Photometric: lux / candela"
    : "Relative";
  if (exposureStatus) exposureStatus.textContent = photometricEnabled
    ? `EV100 ${PHOTOMETRIC_EXPOSURE_EV100.toFixed(1)}`
    : "1.0";
  document.body.dataset.unitSystem = photometricEnabled ? "photometric" : "relative";
  updateModeDisplay();
}

// 15球とalpha比較平面の表示を排他的に切り替え、3種類のalpha modeを同時評価する
function toggleGltfFixture() {
  gltfFixtureEnabled = !gltfFixtureEnabled;
  transparentPbrFixtureEnabled = false;
  for (const shape of materialShapes) shape.hide(gltfFixtureEnabled);
  for (const shape of alphaComparisonShapes) shape.hide(!gltfFixtureEnabled);
  for (const shape of gltfFixtureInstance.shapes) shape.hide(true);
  if (gltfFixtureEnabled) {
    renderMode = "deferred";
    setIblEnabled(true);
  }
  const button = document.getElementById("toggleGltfFixture");
  const status = document.getElementById("statusGltfFixture");
  if (button) button.textContent = gltfFixtureEnabled
    ? "15球表示へ戻る"
    : "Alpha 3平面比較を表示";
  if (status) {
    status.textContent = gltfFixtureEnabled
      ? "3 planes / OPAQUE + MASK + BLEND"
      : "Off";
  }
  document.body.dataset.gltfFixtureEnabled = gltfFixtureEnabled ? "true" : "false";
  document.body.dataset.transparentPbrFixtureEnabled = "false";
  const transparentButton = document.getElementById("toggleTransparentPbrFixture");
  const transparentStatus = document.getElementById("statusTransparentPbrFixture");
  if (transparentButton) transparentButton.textContent = "透明PBR Fixtureを表示";
  if (transparentStatus) transparentStatus.textContent = "Off";
  updateModeDisplay();
}

// 5種類のglTF PBR textureとIBLを透明共有GGXへ同時接続し、alpha比較とは別に評価する
function toggleTransparentPbrFixture() {
  transparentPbrFixtureEnabled = !transparentPbrFixtureEnabled;
  gltfFixtureEnabled = false;
  for (const shape of materialShapes) shape.hide(transparentPbrFixtureEnabled);
  for (const shape of alphaComparisonShapes) shape.hide(true);
  for (const shape of gltfFixtureInstance.shapes) {
    shape.hide(!transparentPbrFixtureEnabled);
    if (transparentPbrFixtureEnabled) {
      shape.updateMaterial({
        alpha: 0.72,
        alpha_mode: "BLEND",
        double_sided: 1
      });
    }
  }
  if (transparentPbrFixtureEnabled) {
    renderMode = "deferred";
    setIblEnabled(true);
  }
  const button = document.getElementById("toggleTransparentPbrFixture");
  const status = document.getElementById("statusTransparentPbrFixture");
  if (button) button.textContent = transparentPbrFixtureEnabled
    ? "15球表示へ戻る"
    : "透明PBR Fixtureを表示";
  if (status) status.textContent = transparentPbrFixtureEnabled
    ? "5 textures + IBL + shadow + point/cone"
    : "Off";
  const alphaButton = document.getElementById("toggleGltfFixture");
  const alphaStatus = document.getElementById("statusGltfFixture");
  if (alphaButton) alphaButton.textContent = "Alpha 3平面比較を表示";
  if (alphaStatus) alphaStatus.textContent = "Off";
  document.body.dataset.gltfFixtureEnabled = "false";
  document.body.dataset.transparentPbrFixtureEnabled = transparentPbrFixtureEnabled
    ? "true"
    : "false";
  updateModeDisplay();
}

// PBR texture入力を全Shapeへ同時に設定し、同じsceneのまま一様値との差を比較する
function togglePbrTextures() {
  pbrTexturesEnabled = !pbrTexturesEnabled;
  if (pbrTexturesEnabled) renderMode = "deferred";
  const enabled = pbrTexturesEnabled ? 1 : 0;
  for (const shape of materialShapes) {
    shape.updateMaterial({
      use_metallic_roughness_texture: enabled,
      metallic_roughness_texture: pbrTextures.metallicRoughness,
      use_occlusion_texture: enabled,
      occlusion_texture: pbrTextures.occlusion,
      use_emissive_texture: enabled,
      emissive_texture: pbrTextures.emissive,
      emissive_factor: pbrTexturesEnabled ? [3.5, 0.7, 0.12] : [0.0, 0.0, 0.0]
    });
  }
  const button = document.getElementById("togglePbrTextures");
  const status = document.getElementById("statusPbrTextures");
  if (button) button.textContent = pbrTexturesEnabled
    ? "PBR Textureを無効化"
    : "PBR Textureを有効化";
  if (status) status.textContent = pbrTexturesEnabled
    ? "MR + Occlusion + HDR Emissive"
    : "Off";
  document.body.dataset.pbrTexturesEnabled = pbrTexturesEnabled ? "true" : "false";
  updateModeDisplay();
}

// RGBA8画素から繰返しsamplingするTextureを作り、GPU転送完了後に返す
async function createRgbaTexture(gpu, width, height, pixels) {
  const texture = new Texture(gpu);
  await texture.initPromise;
  texture.setRepeat();
  texture.setImage(pixels, width, height, 4);
  return texture;
}

// RGBA8画素を補間せずに読むTextureを作り、alpha境界とchecker境界を明確に保つ
async function createNearestRgbaTexture(gpu, width, height, pixels) {
  const texture = new Texture(gpu);
  await texture.initPromise;
  texture.sampler = gpu.device.createSampler({
    magFilter: "nearest",
    minFilter: "nearest",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge"
  });
  texture.setImage(pixels, width, height, 4);
  return texture;
}

// camera側を向く開いた四角形を作り、閉じた立体の裏面がalpha結果へ混入しないようにする
function createOpenPlane(gpu, width, height, materialId, materialParams) {
  const shape = new Shape(gpu);
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const vertices = [
    [-halfWidth, -halfHeight, 0.0, 0.0, 1.0],
    [halfWidth, -halfHeight, 0.0, 1.0, 1.0],
    [halfWidth, halfHeight, 0.0, 1.0, 0.0],
    [-halfWidth, halfHeight, 0.0, 0.0, 0.0]
  ];
  // U=0とU=1は平面の左右端であり、球面用のUV継ぎ目補正対象ではない
  shape.setTextureMappingMode(-1);
  shape.setAutoCalcNormals(false);
  for (let index = 0; index < vertices.length; index += 1) {
    shape.addVertexUV(...vertices[index]);
    shape.setVertNormal(index, 0.0, 0.0, 1.0);
  }
  shape.addPlane([0, 1, 2, 3]);
  shape.endShape();
  shape.setMaterial(materialId, materialParams);
  return shape;
}

// 明暗checkerを作り、MASKのdiscardとBLENDの透過先を同じ背景で比較できるようにする
async function createAlphaCheckerTexture(gpu) {
  const width = 8;
  const height = 8;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const light = (x + y) % 2 === 0;
      const value = light ? 210 : 35;
      pixels[offset] = value;
      pixels[offset + 1] = light ? 218 : 43;
      pixels[offset + 2] = light ? 224 : 52;
      pixels[offset + 3] = 255;
    }
  }
  return createNearestRgbaTexture(gpu, width, height, pixels);
}

// glTFでdecodeした同一base-color textureを3平面へ適用し、alpha modeだけを変える
async function createAlphaComparisonScene(gpu) {
  const fixtureShape = gltfFixtureInstance.shapes[0];
  const sourceMaterial = fixtureShape.getMaterialAt(0);
  const baseColorTexture = sourceMaterial.params.texture;

  // 2x2の4段階alphaを補間すると閾値位置が曖昧になるため、この比較ではnearestを明示する
  baseColorTexture.sampler = gpu.device.createSampler({
    magFilter: "nearest",
    minFilter: "nearest",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge"
  });

  alphaCheckerTexture = await createAlphaCheckerTexture(gpu);
  const checker = createOpenPlane(gpu, 11.4, 5.8, "alpha-checker", {
    has_bone: 0,
    use_texture: 1,
    texture: alphaCheckerTexture,
    color: [1.0, 1.0, 1.0, 1.0],
    alpha: 1.0,
    alpha_mode: "OPAQUE",
    ambient: 0.0,
    specular: 0.0,
    metallic: 0.0,
    roughness: 1.0,
    emissive: 0.0,
    emissive_factor: [0.0, 0.0, 0.0],
    flat_shading: 0,
    double_sided: 0
  });
  const checkerNode = app.space.addNode(null, "alpha-checker-background");
  checkerNode.setPosition(0.0, -0.15, -0.35);
  checkerNode.addShape(checker);
  alphaComparisonShapes.push(checker);

  const modes = ["OPAQUE", "MASK", "BLEND"];
  const xPositions = [-3.7, 0.0, 3.7];
  for (let index = 0; index < modes.length; index += 1) {
    const mode = modes[index];
    const plane = createOpenPlane(gpu, 3.0, 4.4, `alpha-${mode.toLowerCase()}`, {
      ...sourceMaterial.params,
      use_texture: 1,
      texture: baseColorTexture,
      color: [1.0, 1.0, 1.0, 1.0],
      alpha: 1.0,
      alpha_mode: mode,
      alpha_cutoff: 0.5,
      double_sided: 0,
      use_normal_map: 0,
      use_metallic_roughness_texture: 0,
      use_occlusion_texture: 0,
      use_emissive_texture: 0,
      metallic: 0.0,
      roughness: 0.65,
      specular: 0.4,
      emissive: 0.0,
      emissive_factor: [0.0, 0.0, 0.0]
    });
    const node = app.space.addNode(null, `alpha-${mode.toLowerCase()}-plane`);
    node.setPosition(xPositions[index], -0.15, 0.0);
    node.addShape(plane);
    alphaComparisonShapes.push(plane);
  }
  for (const shape of alphaComparisonShapes) shape.hide(true);
}

// glTF準拠のチャンネル配置を目視確認できる3種類の手続きPBR textureを作る
async function createPbrTextures(gpu) {
  const width = 8;
  const height = 8;
  const metallicRoughness = new Uint8Array(width * height * 4);
  const occlusion = new Uint8Array(width * height * 4);
  const emissive = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alternate = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0;

      // metallic-roughness textureはGにroughness、Bにmetallicを格納する
      metallicRoughness[offset] = 255;
      metallicRoughness[offset + 1] = alternate ? 72 : 220;
      metallicRoughness[offset + 2] = x < width / 2 ? 36 : 255;
      metallicRoughness[offset + 3] = 255;

      // occlusion textureはRだけを読み、IBLを有効にしたとき間接光の差として現れる
      occlusion[offset] = y < height / 2 ? 255 : 90;
      occlusion[offset + 1] = 255;
      occlusion[offset + 2] = 255;
      occlusion[offset + 3] = 255;

      // emissive textureは疎な格子だけを発光させ、線形HDR emissive_factorで増幅する
      const lit = x === 0 || y === 0 || x === y;
      emissive[offset] = lit ? 255 : 0;
      emissive[offset + 1] = lit ? 180 : 0;
      emissive[offset + 2] = lit ? 96 : 0;
      emissive[offset + 3] = 255;
    }
  }
  const [metallicRoughnessTexture, occlusionTexture, emissiveTexture] = await Promise.all([
    createRgbaTexture(gpu, width, height, metallicRoughness),
    createRgbaTexture(gpu, width, height, occlusion),
    createRgbaTexture(gpu, width, height, emissive)
  ]);
  return {
    metallicRoughness: metallicRoughnessTexture,
    occlusion: occlusionTexture,
    emissive: emissiveTexture
  };
}

// 球1個を作り、両描画経路が読むspecular、roughness、metallic、emissiveをすべて明示する
function createMaterialSphere(gpu, roughness, metallic) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.sphere(0.82, 32, 24, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("pbr-reference", {
    has_bone: 0,
    use_texture: 0,
    color: [...BASE_COLOR_SRGB],
    alpha: 1.0,
    ambient: 0.0,
    specular: 1.0,
    power: 0.0,
    metallic,
    roughness,
    emissive: 0.0,
    flat_shading: 0
  });
  return shape;
}

// roughnessを横方向、metallicを縦方向へ並べ、切替後もShapeを作り直さない比較sceneを構築する
function createComparisonScene() {
  const gpu = app.getGPU();
  const xStep = 2.15;
  const yStep = 2.25;
  for (let row = 0; row < METALLIC_VALUES.length; row += 1) {
    for (let column = 0; column < ROUGHNESS_VALUES.length; column += 1) {
      const roughness = ROUGHNESS_VALUES[column];
      const metallic = METALLIC_VALUES[row];
      const shape = createMaterialSphere(gpu, roughness, metallic);
      const node = app.space.addNode(null, `sphere-r${column}-m${row}`);
      node.setPosition(
        (column - (ROUGHNESS_VALUES.length - 1) * 0.5) * xStep,
        ((METALLIC_VALUES.length - 1) * 0.5 - row) * yStep,
        0.0
      );
      node.addShape(shape);
      materialShapes.push(shape);
    }
  }
}

// 現在選択中の環境をForwardとDeferredへ同じinstanceで渡します
function getSelectedEnvironment() {
  if (environmentMode === "procedural") return proceduralEnvironment;
  if (environmentMode === "diagnostic") return diagnosticEnvironment;
  if (environmentMode === "real") return realEnvironment;
  throw new Error(`unknown PBR environment mode: ${environmentMode}`);
}

// 比較に不要なeffectを全て無効にし、直接光、Reinhard Tone Map、sRGB出力だけを実行する
function encodeDeferredFrame(cameraFrame) {
  const gpu = app.getGPU();
  gpu.endPass();
  const selectedEnvironment = getSelectedEnvironment();
  const finalColor = pipeline.encode(gpu.commandEncoder, {
    cameraFrame,
    ssaoEnabled: false,
    shadowEnabled: directLightEnabled && transparentPbrFixtureEnabled,
    ssrEnabled: ssrEnabled && iblEnabled,
    toonEnabled: false,
    dofEnabled: false,
    bloomEnabled: false,
    edgeEnabled: false,
    fogEnabled: false,
    vignetteEnabled: false,
    lighting: {
      unitSystem: photometricEnabled ? "photometric" : "relative",
      ambient: 0.0,
      environment: iblEnabled ? selectedEnvironment.getResources() : null,
      // 二つの比較環境は測光校正済みではないため、photometric比較では明示scaleだけを与えます
      environmentIntensity: iblEnabled ? (photometricEnabled ? 500.0 : 1.0) : undefined,
      environmentBackground: iblEnabled && hdrBackgroundEnabled,
      environmentRotationDegrees: iblEnabled ? environmentRotationDegrees : undefined,
      directionalColor: [1.0, 1.0, 1.0],
      directionalIntensity: directLightEnabled
        ? (photometricEnabled ? PHOTOMETRIC_DIRECTIONAL_LUX : 1.0)
        : 0.0,
      spotColor: [1.0, 1.0, 1.0],
      spotIntensity: 0.0
    },
    lights: directLightEnabled && transparentPbrFixtureEnabled
      ? (photometricEnabled ? PHOTOMETRIC_LOCAL_LIGHTS : TRANSPARENT_PBR_LOCAL_LIGHTS)
      : [],
    toneMap: photometricEnabled ? {
      mode: "reinhard",
      exposureEv100: PHOTOMETRIC_EXPOSURE_EV100,
      saturation: 1.0,
      gamma: 2.2,
      blackBackground: false
    } : {
      mode: "reinhard",
      exposure: 1.0,
      saturation: 1.0,
      gamma: 2.2,
      blackBackground: false
    }
  });
  app.screen.beginPresentPass({ clearColor: app.clearColor, colorLoadOp: "clear" });
  copyPass.draw(finalColor);
}

// 選択中cache environmentのresourceをHDR診断passへ出し、表示用Tone Mapだけを適用します
function encodeEnvironmentDebugFrame() {
  const gpu = app.getGPU();
  gpu.endPass();
  const hdrDebug = environmentDebugPass.encode(
    gpu.commandEncoder,
    getSelectedEnvironment().getResources(),
    {
      view: environmentDebugView,
      mipLevel: environmentDebugMipLevel,
      exposureStops: environmentDebugExposureStops,
      selectedUv: environmentDebugSelectedUv
    }
  );
  const finalColor = pipeline.toneMapPass.encode(gpu.commandEncoder, {
    scene: hdrDebug,
    depth: pipeline.getBindingResources().depth
  }, {
    mode: environmentDebugView === "brdfLut" ? "linear" : "reinhard",
    exposure: 1.0,
    saturation: 1.0,
    gamma: 2.2,
    blackBackground: false
  });
  app.screen.beginPresentPass({ clearColor: app.clearColor, colorLoadOp: "clear" });
  copyPass.draw(finalColor);
}

// 診断用Radiance HDRをGPU初期化前に復号し、入力形式と高輝度値の確認結果を画面へ表示します
function verifyDiagnosticHdrInput() {
  const { decoded, maximum } = decodeDiagnosticRadianceHdr();
  const converted = convertRadianceHdrToLinearSrgb(decoded, { outOfGamut: "clip" });
  const status = document.getElementById("statusHdrInput");
  if (status) {
    status.textContent = `${decoded.width}x${decoded.height} / linear sRGB / max ${maximum.toFixed(2)} / clipped ${converted.colorConversion.clippedComponentCount}`;
  }
  document.body.dataset.hdrInputVerified = "true";
  document.body.dataset.hdrColorSpace = converted.colorSpace;
  document.body.dataset.hdrClippedComponents = String(
    converted.colorConversion.clippedComponentCount
  );
  return converted;
}

// CPU基準とGPU readbackの対応する全要素を比較し、最大絶対誤差と発生位置を返します
function comparePreprocessLevels(reference, actual, label) {
  if (reference.width !== actual.width || reference.height !== actual.height) {
    throw new Error(
      `${label} GPU size ${actual.width}x${actual.height} does not match CPU `
      + `${reference.width}x${reference.height}`
    );
  }
  if (reference.data.length !== actual.data.length) {
    throw new Error(`${label} GPU data length does not match CPU reference`);
  }
  let maximum = { difference: 0.0, index: 0, cpu: 0.0, gpu: 0.0, label };
  for (let index = 0; index < reference.data.length; index += 1) {
    const cpu = reference.data[index];
    const gpu = actual.data[index];
    if (!Number.isFinite(gpu)) {
      throw new Error(`${label} GPU data[${index}] must be finite: ${gpu}`);
    }
    const difference = Math.abs(cpu - gpu);
    if (difference > maximum.difference) {
      maximum = { difference, index, cpu, gpu, label };
    }
  }
  return maximum;
}

// irradiance、全specular mip、BRDF LUTを比較し、許容値内のGPU結果だけを照明へ使います
function verifyComputePreprocess(reference, actual) {
  const comparisons = [
    comparePreprocessLevels(reference.irradiance, actual.irradiance, "irradiance"),
    comparePreprocessLevels(reference.brdfLut, actual.brdfLut, "BRDF LUT")
  ];
  if (reference.prefilteredSpecular.length !== actual.prefilteredSpecular.length) {
    throw new Error("GPU specular mip count does not match CPU reference");
  }
  reference.prefilteredSpecular.forEach((level, index) => {
    comparisons.push(comparePreprocessLevels(
      level,
      actual.prefilteredSpecular[index],
      `specular mip ${index}`
    ));
  });
  const maximum = comparisons.reduce((largest, entry) => (
    entry.difference > largest.difference ? entry : largest
  ));
  if (maximum.difference > DIAGNOSTIC_GPU_MAX_ERROR) {
    throw new Error(
      `${maximum.label} GPU/CPU max error must be <= ${DIAGNOSTIC_GPU_MAX_ERROR}: `
      + `${maximum.difference} at ${maximum.index}, CPU ${maximum.cpu}, GPU ${maximum.gpu}`
    );
  }
  return maximum;
}

// timestamp-query対応deviceでは前処理全体のGPU開始／終了をqueryで測り、未対応時はunavailableを返します
// wall timeはpipeline準備やqueue待ちを含むため、GPU timestampと別の値として常に記録します
async function encodeTimedEnvironmentPreprocess(gpu, preprocessor, source) {
  const timestampSupported = gpu.device.features?.has?.("timestamp-query") === true;
  let querySet = null;
  let resolveBuffer = null;
  let readBuffer = null;
  if (timestampSupported) {
    querySet = gpu.device.createQuerySet({
      label: "pbr-reference-preprocess-timestamp",
      type: "timestamp",
      count: 2
    });
    resolveBuffer = gpu.device.createBuffer({
      label: "pbr-reference-preprocess-timestamp-resolve",
      size: 256,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
    });
    readBuffer = gpu.device.createBuffer({
      label: "pbr-reference-preprocess-timestamp-read",
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
  }
  try {
    const encoder = gpu.device.createCommandEncoder({
      label: "pbr-reference-diagnostic-hdr-preprocess"
    });
    const started = performance.now();
    preprocessor.encode(encoder, source, timestampSupported ? {
      timestampWrites: {
        querySet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1
      }
    } : {});
    if (timestampSupported) {
      encoder.resolveQuerySet(querySet, 0, 2, resolveBuffer, 0);
      encoder.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, 16);
    }
    gpu.queue.submit([encoder.finish()]);
    await gpu.queue.onSubmittedWorkDone();
    const wallMilliseconds = performance.now() - started;
    let timestampMilliseconds = null;
    if (timestampSupported) {
      await readBuffer.mapAsync(GPUMapMode.READ);
      const timestamps = new BigUint64Array(readBuffer.getMappedRange());
      if (timestamps[1] < timestamps[0]) {
        throw new Error("PBR environment preprocess timestamp end precedes start");
      }
      timestampMilliseconds = Number(timestamps[1] - timestamps[0]) / 1_000_000.0;
      if (!Number.isFinite(timestampMilliseconds) || timestampMilliseconds < 0.0) {
        throw new Error(`PBR environment preprocess timestamp is invalid: ${timestampMilliseconds}`);
      }
      readBuffer.unmap();
    }
    return { wallMilliseconds, timestampMilliseconds };
  } finally {
    readBuffer?.destroy();
    resolveBuffer?.destroy();
    querySet?.destroy();
  }
}

// WebgApp、比較scene、forward shader、deferred pipelineを順に初期化する
async function start() {
  const diagnosticHdr = verifyDiagnosticHdrInput();
  app = new WebgApp({
    document,
    autoDrawScene: false,
    shaderClass: PbrForwardShader,
    // 比較画像の画角とpixel位置がbrowser viewportやDPRで変わらないよう、実験解像度を固定する
    layoutMode: "embedded",
    renderMode: "continuous",
    fixedCanvasSize: {
      width: 960,
      height: 720,
      useDevicePixelRatio: false
    },
    // 前処理のGPU実行時間をwall timeと分離するためtimestamp-queryをoptional featureとして要求します
    frameTiming: true,
    clearColor: [0.015, 0.022, 0.032, 1.0],
    viewAngle: 42,
    projectionNear: 0.1,
    projectionFar: 80,
    useMessage: false,
    lightPosition: [...SURFACE_TO_LIGHT_VIEW],
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 16.5,
      yaw: 0.0,
      pitch: 0.0
    },
    debugTools: {
      mode: "release",
      system: "pbr_reference",
      source: "samples/pbr_reference/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  app.shader.setLightPosition(SURFACE_TO_LIGHT_VIEW);
  app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 16.5,
    yaw: 0.0,
    pitch: 0.0,
    minDistance: 12.0,
    maxDistance: 24.0,
    wheelZoomStep: 0.5
  });
  createComparisonScene();

  // 5種類のglTF PBR textureを含むfixtureを通常のModelLoader処理フローで読み込む
  gltfFixtureModel = await app.loadModel("./pbr_fixture.gltf", {
    format: "gltf",
    instantiate: false,
    startAnimations: false
  });
  gltfFixtureInstance = gltfFixtureModel.runtime.instantiate(app.space);
  for (const shape of gltfFixtureInstance.shapes) shape.hide(true);

  const gpu = app.getGPU();
  await createAlphaComparisonScene(gpu);
  gpu.device.addEventListener("uncapturederror", (event) => {
    showStartError(event.error ?? event);
  });
  proceduralEnvironment = new PbrEnvironment(gpu, {
    label: "pbr-reference-environment",
    ...createProceduralEnvironmentData()
  });
  const cpuStarted = performance.now();
  const diagnosticReference = createPbrEnvironmentReferenceData(
    diagnosticHdr,
    DIAGNOSTIC_PREPROCESS_OPTIONS
  );
  const cpuMilliseconds = performance.now() - cpuStarted;
  diagnosticEnvironmentCompute = new PbrEnvironmentCompute(gpu, {
    label: "pbr-reference-diagnostic-hdr-environment",
    ...DIAGNOSTIC_PREPROCESS_OPTIONS
  });
  const preprocessTiming = await encodeTimedEnvironmentPreprocess(
    gpu,
    diagnosticEnvironmentCompute,
    diagnosticHdr
  );
  const diagnosticReadback = await diagnosticEnvironmentCompute.readback();
  const maximumError = verifyComputePreprocess(diagnosticReference, diagnosticReadback);
  const preprocessStatus = document.getElementById("statusHdrPreprocess");
  if (preprocessStatus) {
    preprocessStatus.textContent = `CPU ${cpuMilliseconds.toFixed(1)} ms / GPU wall ${preprocessTiming.wallMilliseconds.toFixed(1)} ms / max Δ ${maximumError.difference.toFixed(4)}`;
  }
  const timestampStatus = document.getElementById("statusHdrGpuTimestamp");
  if (timestampStatus) {
    timestampStatus.textContent = preprocessTiming.timestampMilliseconds === null
      ? "unavailable (timestamp-query)"
      : `${preprocessTiming.timestampMilliseconds.toFixed(3)} ms`;
  }
  document.body.dataset.hdrPreprocessReady = "true";
  document.body.dataset.hdrPreprocessMaxError = maximumError.difference.toFixed(6);
  document.body.dataset.hdrPreprocessGpuMilliseconds = preprocessTiming.timestampMilliseconds === null
    ? "unavailable"
    : preprocessTiming.timestampMilliseconds.toFixed(6);

  // 数値検証済みCompute出力と元HDRを版付きbinary cacheへ保存し、実際の非同期fetchで読み戻します
  // 同じkeyを二度acquireして一つのGPU environmentが再利用されることも起動画面で確認します
  const cacheBuffer = encodePbrEnvironmentCache({
    sourceId: DIAGNOSTIC_CACHE_SOURCE_ID,
    source: diagnosticHdr,
    preprocessed: diagnosticReadback
  });
  diagnosticCachedData = decodePbrEnvironmentCache(cacheBuffer, {
    expectedSourceId: DIAGNOSTIC_CACHE_SOURCE_ID,
    expectedSettings: DIAGNOSTIC_PREPROCESS_OPTIONS
  }).environment;
  const whiteFurnace = evaluatePbrWhiteFurnace(diagnosticCachedData.brdfLut);
  if (!whiteFurnace.passed) {
    throw new Error(
      `PBR white furnace energy must be <= ${whiteFurnace.maximumEnergy}: ${whiteFurnace.maximum}`
    );
  }
  const furnaceStatus = document.getElementById("statusWhiteFurnace");
  if (furnaceStatus) {
    furnaceStatus.textContent = `Pass / min ${whiteFurnace.minimum.toFixed(3)} / max ${whiteFurnace.maximum.toFixed(3)}`;
  }
  document.body.dataset.whiteFurnacePassed = "true";
  document.body.dataset.whiteFurnaceMinimum = whiteFurnace.minimum.toFixed(6);
  document.body.dataset.whiteFurnaceMaximum = whiteFurnace.maximum.toFixed(6);

  const environmentMemory = estimatePbrEnvironmentMemory(
    [diagnosticHdr.width, diagnosticHdr.height],
    DIAGNOSTIC_PREPROCESS_OPTIONS
  );
  const memoryStatus = document.getElementById("statusEnvironmentMemory");
  if (memoryStatus) {
    memoryStatus.textContent = `runtime ${(environmentMemory.runtimeTextureBytes / 1024).toFixed(1)} KiB / Compute ${(environmentMemory.computeWorkingBytes / 1024).toFixed(1)} KiB`;
  }
  document.body.dataset.environmentRuntimeBytes = String(environmentMemory.runtimeTextureBytes);
  document.body.dataset.environmentComputeBytes = String(environmentMemory.computeWorkingBytes);
  const cacheUrl = URL.createObjectURL(new Blob([cacheBuffer], {
    type: "application/octet-stream"
  }));
  diagnosticCacheRepository = new PbrEnvironmentCacheRepository(gpu, {
    label: "pbr-reference-environment-cache"
  });
  try {
    diagnosticCacheHandle = await diagnosticCacheRepository.acquire(
      "diagnostic-hdr",
      cacheUrl,
      {
        expectedSourceId: DIAGNOSTIC_CACHE_SOURCE_ID,
        expectedSettings: DIAGNOSTIC_PREPROCESS_OPTIONS
      }
    );
    const reusedHandle = await diagnosticCacheRepository.acquire(
      "diagnostic-hdr",
      cacheUrl,
      {
        expectedSourceId: DIAGNOSTIC_CACHE_SOURCE_ID,
        expectedSettings: DIAGNOSTIC_PREPROCESS_OPTIONS
      }
    );
    if (reusedHandle.environment !== diagnosticCacheHandle.environment) {
      throw new Error("PBR environment cache did not reuse the same GPU environment");
    }
    reusedHandle.release();
    diagnosticEnvironment = diagnosticCacheHandle.environment;
  } finally {
    URL.revokeObjectURL(cacheUrl);
  }
  diagnosticEnvironmentCompute.destroy();
  diagnosticEnvironmentCompute = null;
  const cacheStatus = document.getElementById("statusHdrCache");
  if (cacheStatus) {
    cacheStatus.textContent = `v1 / ${(cacheBuffer.byteLength / 1024).toFixed(1)} KiB / reused`;
  }
  document.body.dataset.hdrCacheReady = "true";
  document.body.dataset.hdrCacheBytes = String(cacheBuffer.byteLength);
  document.body.dataset.hdrCacheReused = "true";

  // 配布済み実写cacheを通常のHTTP fetchと厳密decodeで読み、元HDRの再積分なしにGPUへ転送します
  // source IDとstandard生成条件が一致するassetだけを同名環境として利用します
  const realCacheStarted = performance.now();
  const loadedRealCache = await loadPbrEnvironmentCache(REAL_HDR_CACHE_URL, {
    expectedSourceId: REAL_HDR_CACHE_SOURCE_ID,
    expectedSettings: REAL_HDR_PREPROCESS_OPTIONS
  });
  realCachedData = loadedRealCache.environment;
  realEnvironment = new PbrEnvironment(gpu, {
    label: "pbr-reference-studio-small-01",
    ...realCachedData
  });
  const realCacheMilliseconds = performance.now() - realCacheStarted;
  const realHdrStatus = document.getElementById("statusRealHdrAsset");
  if (realHdrStatus) {
    realHdrStatus.textContent = `Studio Small 01 / 1024x512 / standard / ${realCacheMilliseconds.toFixed(1)} ms`;
  }
  document.body.dataset.realHdrReady = "true";
  document.body.dataset.realHdrLoadMilliseconds = realCacheMilliseconds.toFixed(3);

  pbrTextures = await createPbrTextures(gpu);
  pipeline = new ComputeEffectPipeline(gpu, {
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    // Pipelineのdirectional lightはshadow blockではなくconstructor直下のworld-space directionで指定する
    lightDirection: [...LIGHT_TO_SURFACE_WORLD],
    shadow: {
      type: "directional"
    },
    lighting: {
      ambient: 0.0,
      directionalColor: [1.0, 1.0, 1.0],
      directionalIntensity: 1.0
    },
    toneMap: {
      mode: "reinhard",
      exposure: 1.0,
      saturation: 1.0,
      gamma: 2.2,
      blackBackground: false
    }
  });
  environmentDebugPass = new PbrEnvironmentDebugPass(gpu, {
    label: "pbr-reference-environment-debug",
    width: app.screen.getWidth(),
    height: app.screen.getHeight()
  });
  copyPass = new FullscreenPass(gpu);
  await Promise.all([pipeline.ready, environmentDebugPass.ready, copyPass.init()]);

  document.getElementById("toggleMode")?.addEventListener("click", toggleRenderMode);
  document.getElementById("toggleIbl")?.addEventListener("click", toggleIbl);
  document.getElementById("toggleSsr")?.addEventListener("click", toggleSsr);
  document.getElementById("toggleHdrEnvironment")?.addEventListener("click", toggleHdrEnvironment);
  document.getElementById("toggleHdrBackground")?.addEventListener("click", toggleHdrBackground);
  document.getElementById("toggleIblOnly")?.addEventListener("click", toggleIblOnly);
  document.getElementById("rotateEnvironment")?.addEventListener("click", rotateEnvironment);
  document.getElementById("toggleEnvironmentDebugView")?.addEventListener(
    "click",
    toggleEnvironmentDebugView
  );
  document.getElementById("nextEnvironmentDebugMip")?.addEventListener(
    "click",
    nextEnvironmentDebugMip
  );
  document.getElementById("decreaseEnvironmentDebugExposure")?.addEventListener(
    "click",
    () => changeEnvironmentDebugExposure(-1.0)
  );
  document.getElementById("increaseEnvironmentDebugExposure")?.addEventListener(
    "click",
    () => changeEnvironmentDebugExposure(1.0)
  );
  document.getElementById("canvas")?.addEventListener("click", selectEnvironmentDebugPixel);
  document.getElementById("toggleUnitSystem")?.addEventListener("click", toggleUnitSystem);
  document.getElementById("togglePbrTextures")?.addEventListener("click", togglePbrTextures);
  document.getElementById("toggleGltfFixture")?.addEventListener("click", toggleGltfFixture);
  document.getElementById("toggleTransparentPbrFixture")?.addEventListener(
    "click",
    toggleTransparentPbrFixture
  );
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      toggleRenderMode();
    }
  });
  updateModeDisplay();
  updateEnvironmentModeDisplay();
  updateEnvironmentDebugDisplay();
  document.body.dataset.pbrStatus = "ready";
  document.getElementById("statusError").textContent = "なし";

  app.start({
    // resize時はdeferred側の全targetをCanvas寸法へ合わせ、古いtextureを参照しない
    onUpdate: ({ screen }) => {
      pipeline.resize(screen.getWidth(), screen.getHeight());
      environmentDebugPass.resize(screen.getWidth(), screen.getHeight());
    },
    // forwardでは通常Space描画、deferredでは同じSpaceをG-bufferへ描画する
    onBeforeDraw: ({ cameraFrame }) => {
      if (environmentDebugView !== "scene") return;
      if (renderMode === "forward") {
        // 参照用ForwardへDeferredと同じenvironment、強度、回転、直接光状態を毎frame明示します
        const selectedEnvironment = getSelectedEnvironment();
        app.shader.setEnvironment(
          iblEnabled ? selectedEnvironment.getResources() : null,
          iblEnabled ? (photometricEnabled ? 500.0 : 1.0) : undefined,
          iblEnabled ? cameraFrame : null,
          iblEnabled ? environmentRotationDegrees : 0.0
        );
        // draw単位のdoParameter()は材質にradianceがなければshader既定値を使うため、
        // frame直前の一時uniformではなく既定値を更新し、15球すべてへ同じ直接光状態を適用します
        app.shader.setDefaultParam(
          "radiance",
          directLightEnabled ? [1.0, 1.0, 1.0] : [0.0, 0.0, 0.0]
        );
        app.space.draw(cameraFrame);
        return;
      }
      pipeline.renderScene(app.space, cameraFrame, app.clearColor, {
        shadowEnabled: directLightEnabled && transparentPbrFixtureEnabled,
        shadow: { type: "directional" }
      });
    },
    // deferred時だけComputeEffectPipelineを実行し、完成した表示色をCanvasへ提示する
    onAfterDraw3d: ({ cameraFrame }) => {
      if (environmentDebugView !== "scene") {
        encodeEnvironmentDebugFrame();
      } else if (renderMode === "deferred") {
        encodeDeferredFrame(cameraFrame);
      }
    }
  });

  window.addEventListener("pagehide", () => {
    app.stop();
    copyPass.destroy?.();
    environmentDebugPass.destroy();
    proceduralEnvironment.destroy();
    realEnvironment?.destroy();
    diagnosticEnvironmentCompute?.destroy();
    diagnosticCacheHandle?.release();
    diagnosticCacheRepository?.destroy().catch(showStartError);
    pbrTextures?.metallicRoughness?.texture?.destroy?.();
    pbrTextures?.occlusion?.texture?.destroy?.();
    pbrTextures?.emissive?.texture?.destroy?.();
    alphaCheckerTexture?.texture?.destroy?.();
    gltfFixtureModel?.destroy?.();
    pipeline.destroy();
    app.shader.destroy?.();
  }, { once: true });
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch(showStartError);
});

// requestAnimationFrame内の同期例外と未処理Promise拒否も画面へ出し、黒画面だけを残さない
window.addEventListener("error", (event) => {
  showStartError(event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  showStartError(event.reason ?? event);
});
