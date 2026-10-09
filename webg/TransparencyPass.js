// ---------------------------------------------
// TransparencyPass.js  2026/08/13
//   Sorted translucent triangle composition for deferred scenes
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import ComputePass from "./ComputePass.js";
import ComputeImagePyramid from "./ComputeImagePyramid.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import { DEFERRED_LIGHTING_OUTPUT_FORMAT } from "./DeferredLightingPass.js";
import {
  createGBufferProjectionParams,
  GBUFFER_WGSL_COMMON
} from "./GeometryBufferPass.js";
import RenderTarget from "./RenderTarget.js";
import PbrForwardShader from "./PbrForwardShader.js";
import SmoothShader from "./SmoothShader.js";
import { srgbColorToLinear } from "./ColorSpace.js";
import { validatePbrEnvironmentResources } from "./PbrEnvironment.js";
import {
  TRANSLUCENT_SMALL_OVERLAP_PIXEL_LIMIT
} from "./TranslucentRenderQueue.js";
import GpuPassProfiler, {
  readPerformanceTime
} from "./GpuPassProfiler.js";
import util from "./util.js";

export const FROST_PYRAMID_LEVELS = Object.freeze([2, 4, 8]);
export const FROST_MIN_ROUGHNESS = 0.04;

// GPU timestampの表示名を固定し、sample、診断JSON、文書で同じ区間名を共有する
export const TRANSPARENCY_GPU_PROFILE_NAMES = Object.freeze([
  "transmissionMask",
  "transmissionVolume",
  "transmissionExit",
  "transmissionComposite",
  "frostPyramid",
  "roughnessMask",
  "frostComposite",
  "forward"
]);

export const TRANSMISSION_DEFAULTS = Object.freeze({
  enabled: false,
  strength: 1.0,
  // autoはHDR radianceがあればenvironment、なければclearを選ぶ
  rayMissFallback: "auto",
  // maxUvOffsetは旧2D offset方式とのAPI互換用に受理するが、物理ray経路には使用しない
  maxUvOffset: 0.12,
  // view-spaceで透明物体内部／外部を探索する最大距離
  distance: 42.0,
  // depth surfaceを交差とみなす最大許容厚み
  hitThickness: 0.1,
  // coarse ray marchの基準step数。画面上のray長に応じて最大2倍まで増やす
  steps: 48
});

// 厚みを持つ透明meshを2面屈折させるScreen Space Refraction本体
// Mask RGはoct encodeしたentry法線、BはTransmission、Aはentry linear view depth
// Exit Rはexit linear view depth、GBはoct encodeしたexit法線、AはIORを格納する
// entryで空気→媒質、exitで媒質→空気のrefractを行い、最後にopaque G-buffer depthへray marchする
export const TRANSMISSION_COMPOSITE_WGSL = `
struct Params {
  // x = near、y = farまたは0、z = tan(verticalFov / 2)、w = aspect
  projection : vec4f,
  // x = pass全体のTransmission倍率、y = 最大ray距離、z = hit許容厚み、w = 基準step数
  effect : vec4f,
  // x = ray失敗理由の色分け表示。0は通常表示、1は診断表示
  debug : vec4f,
  // x = environment fallback有効、y = environment intensity、z/w = 予約
  fallback : vec4f,
  // clearColorまたは利用者指定constantをlinearへ変換した固定fallback色
  fallbackColor : vec4f,
  // view-space方向をworld-spaceへ戻す回転行列の各行
  viewToWorldRow0 : vec4f,
  viewToWorldRow1 : vec4f,
  viewToWorldRow2 : vec4f,
  // x = environment Y回転のcos、y = sin、z/w = 予約
  environmentRotation : vec4f,
};

// ray marchの探索密度と実行上限を一か所へ集約する
// coarse pixel strideはscreen上のray主軸長から目標step数を求めるときの間隔
// 交差候補を検出した後はbinary refinementでcoarse区間をさらに狭める
const RAY_MIN_BASE_STEP_COUNT : i32 = 12;
const RAY_MAX_BASE_STEP_COUNT : i32 = 64;
const RAY_MAX_COARSE_STEP_COUNT : i32 = 128;
const RAY_BINARY_REFINEMENT_COUNT : i32 = 5;
const INTERNAL_RAY_COARSE_PIXEL_STRIDE : f32 = 8.0;
const OUTSIDE_RAY_COARSE_PIXEL_STRIDE : f32 = 8.0;
const INTERNAL_SURFACE_FRONT : i32 = 0;
const INTERNAL_SURFACE_BACK : i32 = 1;
// ray失敗理由をTone Map後も識別しやすい固定色へ対応付ける
const RAY_DEBUG_INVALID_VOLUME : vec4f = vec4f(1.0, 0.0, 0.0, 1.0);
const RAY_DEBUG_ENTRY_REFRACTION : vec4f = vec4f(1.0, 0.35, 0.0, 1.0);
const RAY_DEBUG_EXIT_MISS : vec4f = vec4f(1.0, 0.0, 1.0, 1.0);
const RAY_DEBUG_TOTAL_INTERNAL_REFLECTION : vec4f = vec4f(1.0, 1.0, 0.0, 1.0);
const RAY_DEBUG_OUTSIDE_DISTANCE : vec4f = vec4f(0.0, 1.0, 1.0, 1.0);
const RAY_DEBUG_BACKGROUND_MISS : vec4f = vec4f(0.0, 1.0, 0.0, 1.0);

${GBUFFER_WGSL_COMMON}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var transmissionMaskTexture : texture_2d<f32>;
@group(0) @binding(3) var transmissionExitTexture : texture_2d<f32>;
@group(0) @binding(4) var transmissionVolumeTexture : texture_2d<f32>;
@group(0) @binding(5) var depthTexture : texture_depth_2d;
@group(0) @binding(6) var sceneSampler : sampler;
@group(0) @binding(7) var outputTexture : texture_storage_2d<rgba16float, write>;
// rgba32floatのHDR radianceも受け取るためfiltering samplerを要求せずtextureLoadで読む
@group(0) @binding(8) var radianceTexture : texture_2d<f32>;

fn clampCoord(coord : vec2<i32>, dims : vec2<i32>) -> vec2<i32> {
  return clamp(coord, vec2<i32>(0), dims - vec2<i32>(1));
}

fn environmentViewToWorld(direction : vec3f) -> vec3f {
  return normalize(vec3f(
    dot(params.viewToWorldRow0.xyz, direction),
    dot(params.viewToWorldRow1.xyz, direction),
    dot(params.viewToWorldRow2.xyz, direction)
  ));
}

fn environmentWorldToTextureDirection(direction : vec3f) -> vec3f {
  let cosine = params.environmentRotation.x;
  let sine = params.environmentRotation.y;
  return normalize(vec3f(
    cosine * direction.x - sine * direction.z,
    direction.y,
    sine * direction.x + cosine * direction.z
  ));
}

fn environmentDirectionToUv(direction : vec3f) -> vec2f {
  let normalized = normalize(direction);
  let u = atan2(normalized.z, normalized.x) / (2.0 * 3.14159265) + 0.5;
  let v = acos(clamp(normalized.y, -1.0, 1.0)) / 3.14159265;
  return vec2f(u, v);
}

// Deferred Lightingと同じ規則でHDR radianceを手動bilinear参照する
// textureLoadを使い、rgba32floatへfilterable featureを要求しない
fn sampleEnvironmentRadiance(direction : vec3f) -> vec4f {
  let worldDirection = environmentViewToWorld(direction);
  let textureDirection = environmentWorldToTextureDirection(worldDirection);
  let uv = environmentDirectionToUv(textureDirection);
  let dims = textureDimensions(radianceTexture);
  let sourceX = fract(uv.x) * f32(dims.x) - 0.5;
  let sourceY = clamp(uv.y, 0.0, 1.0) * f32(dims.y) - 0.5;
  let x0Unwrapped = i32(floor(sourceX));
  let y0Unclamped = i32(floor(sourceY));
  let fraction = vec2f(
    sourceX - floor(sourceX),
    sourceY - floor(sourceY)
  );
  let width = i32(dims.x);
  let height = i32(dims.y);
  let x0 = ((x0Unwrapped % width) + width) % width;
  let x1 = (((x0Unwrapped + 1) % width) + width) % width;
  let y0 = clamp(y0Unclamped, 0, height - 1);
  let y1 = clamp(y0Unclamped + 1, 0, height - 1);
  let top = mix(
    textureLoad(radianceTexture, vec2i(x0, y0), 0).rgb,
    textureLoad(radianceTexture, vec2i(x1, y0), 0).rgb,
    fraction.x
  );
  let bottom = mix(
    textureLoad(radianceTexture, vec2i(x0, y1), 0).rgb,
    textureLoad(radianceTexture, vec2i(x1, y1), 0).rgb,
    fraction.x
  );
  return vec4f(
    mix(top, bottom, fraction.y) * params.fallback.y,
    1.0
  );
}

// 外向き方向を得られない早期失敗ではenvironment方向を推測しない
// clear modeはclearColor、constant modeは指定固定色をfallbackColorへ設定する
fn rayFailureColor(debugColor : vec4f) -> vec4f {
  return select(
    params.fallbackColor,
    debugColor,
    params.debug.x >= 0.5
  );
}

// 外向き方向を得られた背景未到達rayだけHDR environmentを参照できる
fn rayFailureColorForDirection(
  direction : vec3f,
  debugColor : vec4f
) -> vec4f {
  var fallbackColor = params.fallbackColor;
  if (params.fallback.x >= 0.5) {
    fallbackColor = sampleEnvironmentRadiance(direction);
  }
  return select(
    fallbackColor,
    debugColor,
    params.debug.x >= 0.5
  );
}

// linear view depthとscreen UVからview-space位置を復元する
// SmoothShaderのentry／exit depthはともに-input.vPosition.zなのでReverse-Zのraw depth変換は不要
fn reconstructLinearViewPosition(uv : vec2f, viewDepth : f32) -> vec3f {
  let ndc = uv * 2.0 - vec2f(1.0);
  return vec3f(
    ndc.x * viewDepth * params.projection.z * params.projection.w,
    -ndc.y * viewDepth * params.projection.z,
    -viewDepth
  );
}

fn projectToUv(position : vec3f) -> vec2f {
  let viewDepth = max(-position.z, 0.0001);
  let ndc = vec2f(
    position.x / (viewDepth * params.projection.z * params.projection.w),
    -position.y / (viewDepth * params.projection.z)
  );
  return ndc * 0.5 + vec2f(0.5);
}

// opaque geometryへhitしなかったrayを無限遠の背景方向としてscreen UVへ変換する
// view-spaceの方向ベクトルをcamera原点から投影するため、ray開始位置には依存しない
fn directionToUv(direction : vec3f) -> vec2f {
  let viewDepth = max(-direction.z, 0.0001);
  let ndc = vec2f(
    direction.x / (viewDepth * params.projection.z * params.projection.w),
    -direction.y / (viewDepth * params.projection.z)
  );
  return ndc * 0.5 + vec2f(0.5);
}

fn insideScreen(uv : vec2f) -> bool {
  return all(uv > vec2f(0.001)) && all(uv < vec2f(0.999));
}

// SmoothShaderがRGへ保存したoctahedral normalを完全なview-space XYZ法線へ戻す
fn decodeOctNormal(encoded : vec2f) -> vec3f {
  let p = encoded * 2.0 - vec2f(1.0);
  var n = vec3f(p.x, p.y, 1.0 - abs(p.x) - abs(p.y));
  if (n.z < 0.0) {
    let oldX = n.x;
    n.x = (1.0 - abs(n.y)) * select(-1.0, 1.0, oldX >= 0.0);
    n.y = (1.0 - abs(oldX)) * select(-1.0, 1.0, n.y >= 0.0);
  }
  return normalize(n);
}

// 内部rayが次に交差した透明境界の位置、外向き法線、screen座標を返す
// found=0はfront／backどちらのsurfaceとも保守的な交差区間を作れなかったことを表す
struct InternalSurfaceHit {
  position : vec3f,
  normal : vec3f,
  coord : vec2<i32>,
  found : u32,
};

fn missingInternalSurface(position : vec3f) -> InternalSurfaceHit {
  var hit : InternalSurfaceHit;
  hit.position = position;
  hit.normal = vec3f(0.0, 0.0, 1.0);
  hit.coord = vec2<i32>(0);
  hit.found = 0u;
  return hit;
}

// front maskとback targetは保存channelが異なるため、surface種別ごとのdepthを同じ形へ変換する
fn internalSurfaceDepth(surface : vec4f, surfaceKind : i32) -> f32 {
  return select(surface.a, surface.r, surfaceKind == INTERNAL_SURFACE_BACK);
}

// front maskのRGとback targetのGBから、どちらも物体外向きのview-space法線として復元する
fn internalSurfaceNormal(surface : vec4f, surfaceKind : i32) -> vec3f {
  let encoded = select(surface.rg, surface.gb, surfaceKind == INTERNAL_SURFACE_BACK);
  return decodeOctNormal(encoded);
}

fn internalSurfaceValid(surface : vec4f, surfaceKind : i32) -> bool {
  let frontValid = surface.b > 0.0 && surface.a > 0.0;
  let backValid = surface.r > 0.0;
  return select(frontValid, backValid, surfaceKind == INTERNAL_SURFACE_BACK);
}

fn loadInternalSurface(coord : vec2<i32>, surfaceKind : i32) -> vec4f {
  let front = textureLoad(transmissionMaskTexture, coord, 0);
  let back = textureLoad(transmissionExitTexture, coord, 0);
  return select(front, back, surfaceKind == INTERNAL_SURFACE_BACK);
}

// coarse区間を指定surfaceに対して1/32まで狭め、hitThickness内の境界だけを採用する
// frontは物体内部側の正deltaから負へ、backは負deltaから正へ横切る向きが正しい
fn refineInternalSurface(
  lowInput : vec3f,
  highInput : vec3f,
  surfaceKind : i32,
  dims : vec2<i32>,
  hitThickness : f32
) -> InternalSurfaceHit {
  var lowPosition = lowInput;
  var highPosition = highInput;
  for (var refine = 0; refine < RAY_BINARY_REFINEMENT_COUNT; refine += 1) {
    let middlePosition = (lowPosition + highPosition) * 0.5;
    let middleUv = projectToUv(middlePosition);
    if (insideScreen(middleUv)) {
      let middleCoord = clampCoord(vec2<i32>(middleUv * vec2f(dims)), dims);
      let middleSurface = loadInternalSurface(middleCoord, surfaceKind);
      if (internalSurfaceValid(middleSurface, surfaceKind)) {
        let middleDepth = internalSurfaceDepth(middleSurface, surfaceKind);
        let middleDelta = -middlePosition.z - middleDepth;
        let reachedOutside = select(
          middleDelta <= 0.0,
          middleDelta >= 0.0,
          surfaceKind == INTERNAL_SURFACE_BACK
        );
        if (reachedOutside) {
          highPosition = middlePosition;
        } else {
          lowPosition = middlePosition;
        }
      } else {
        lowPosition = middlePosition;
      }
    } else {
      lowPosition = middlePosition;
    }
  }

  let candidateUv = projectToUv(highPosition);
  if (!insideScreen(candidateUv)) {
    return missingInternalSurface(highPosition);
  }
  let candidateCoord = clampCoord(vec2<i32>(candidateUv * vec2f(dims)), dims);
  let candidateSurface = loadInternalSurface(candidateCoord, surfaceKind);
  if (!internalSurfaceValid(candidateSurface, surfaceKind)) {
    return missingInternalSurface(highPosition);
  }
  let candidateDepth = internalSurfaceDepth(candidateSurface, surfaceKind);
  let candidateDelta = -highPosition.z - candidateDepth;
  let candidateReachedOutside = select(
    candidateDelta <= 0.0 && candidateDelta >= -hitThickness,
    candidateDelta >= 0.0 && candidateDelta <= hitThickness,
    surfaceKind == INTERNAL_SURFACE_BACK
  );
  if (!candidateReachedOutside) {
    return missingInternalSurface(highPosition);
  }

  var hit : InternalSurfaceHit;
  hit.position = highPosition;
  hit.normal = internalSurfaceNormal(candidateSurface, surfaceKind);
  hit.coord = candidateCoord;
  hit.found = 1u;
  return hit;
}

// 透明物体内部のrayに対してfront／back両surfaceを同時に追跡し、先に横切る境界を返す
// camera基準のfront／back分類だけでは凹形状やreflection後の出口を表せないため両方を候補にする
fn findNextInternalSurface(
  startPosition : vec3f,
  direction : vec3f,
  distance : f32,
  stepCount : i32,
  hitThickness : f32,
  dims : vec2<i32>
) -> InternalSurfaceHit {
  let stepLength = distance / f32(stepCount);
  var previousPosition = startPosition
    + direction * max(stepLength * 0.05, max(hitThickness * 0.25, 0.0001));
  var previousFrontDelta = 0.0;
  var previousBackDelta = 0.0;
  var previousFrontValid = false;
  var previousBackValid = false;

  let initialUv = projectToUv(previousPosition);
  if (insideScreen(initialUv)) {
    let initialCoord = clampCoord(vec2<i32>(initialUv * vec2f(dims)), dims);
    let initialFront = loadInternalSurface(initialCoord, INTERNAL_SURFACE_FRONT);
    let initialBack = loadInternalSurface(initialCoord, INTERNAL_SURFACE_BACK);
    if (internalSurfaceValid(initialFront, INTERNAL_SURFACE_FRONT)) {
      previousFrontDelta = -previousPosition.z
        - internalSurfaceDepth(initialFront, INTERNAL_SURFACE_FRONT);
      previousFrontValid = true;
    }
    if (internalSurfaceValid(initialBack, INTERNAL_SURFACE_BACK)) {
      previousBackDelta = -previousPosition.z
        - internalSurfaceDepth(initialBack, INTERNAL_SURFACE_BACK);
      previousBackValid = true;
    }
  }

  for (var i = 0; i < RAY_MAX_COARSE_STEP_COUNT; i += 1) {
    if (i < stepCount) {
      let currentPosition = previousPosition + direction * stepLength;
      let currentUv = projectToUv(currentPosition);
      if (insideScreen(currentUv)) {
        let currentCoord = clampCoord(vec2<i32>(currentUv * vec2f(dims)), dims);
        let currentFront = loadInternalSurface(currentCoord, INTERNAL_SURFACE_FRONT);
        let currentBack = loadInternalSurface(currentCoord, INTERNAL_SURFACE_BACK);
        let currentFrontValid = internalSurfaceValid(currentFront, INTERNAL_SURFACE_FRONT);
        let currentBackValid = internalSurfaceValid(currentBack, INTERNAL_SURFACE_BACK);
        var currentFrontDelta = 0.0;
        var currentBackDelta = 0.0;
        if (currentFrontValid) {
          currentFrontDelta = -currentPosition.z
            - internalSurfaceDepth(currentFront, INTERNAL_SURFACE_FRONT);
        }
        if (currentBackValid) {
          currentBackDelta = -currentPosition.z
            - internalSurfaceDepth(currentBack, INTERNAL_SURFACE_BACK);
        }

        let crossedFront = previousFrontValid && currentFrontValid
          && previousFrontDelta > 0.0 && currentFrontDelta <= 0.0;
        let crossedBack = previousBackValid && currentBackValid
          && previousBackDelta < 0.0 && currentBackDelta >= 0.0;
        if (crossedFront || crossedBack) {
          let frontFraction = select(
            2.0,
            abs(previousFrontDelta)
              / max(abs(previousFrontDelta) + abs(currentFrontDelta), 1.0e-6),
            crossedFront
          );
          let backFraction = select(
            2.0,
            abs(previousBackDelta)
              / max(abs(previousBackDelta) + abs(currentBackDelta), 1.0e-6),
            crossedBack
          );
          let surfaceKind = select(
            INTERNAL_SURFACE_BACK,
            INTERNAL_SURFACE_FRONT,
            frontFraction <= backFraction
          );
          let hit = refineInternalSurface(
            previousPosition,
            currentPosition,
            surfaceKind,
            dims,
            hitThickness
          );
          if (hit.found != 0u) {
            return hit;
          }
        }

        previousFrontDelta = currentFrontDelta;
        previousBackDelta = currentBackDelta;
        previousFrontValid = currentFrontValid;
        previousBackValid = currentBackValid;
      } else {
        previousFrontValid = false;
        previousBackValid = false;
      }
      previousPosition = currentPosition;
    }
  }
  return missingInternalSurface(previousPosition);
}

// 画面上のray長を8 pixel間隔へ変換し、公開base stepと実行上限の範囲へ収める
fn internalRayStepCount(
  startPosition : vec3f,
  direction : vec3f,
  distance : f32,
  size : vec2<u32>,
  baseStepCount : i32
) -> i32 {
  let endPosition = startPosition + direction * distance;
  let startPixel = projectToUv(startPosition) * vec2f(size);
  let endPixel = projectToUv(endPosition) * vec2f(size);
  let pixelDelta = endPixel - startPixel;
  let majorLength = max(abs(pixelDelta.x), abs(pixelDelta.y));
  let requested = i32(ceil(majorLength / INTERNAL_RAY_COARSE_PIXEL_STRIDE));
  return clamp(
    requested,
    baseStepCount,
    min(baseStepCount * 2, RAY_MAX_COARSE_STEP_COUNT)
  );
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let size = textureDimensions(outputTexture);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }

  let pixel = vec2<i32>(id.xy);
  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(size);
  let sceneColor = textureLoad(sceneTexture, pixel, 0);
  let mask = textureLoad(transmissionMaskTexture, pixel, 0);
  let volume = textureLoad(transmissionVolumeTexture, pixel, 0);
  let sourceExit = textureLoad(transmissionExitTexture, pixel, 0);
  let materialStrength = clamp(mask.b * params.effect.x, 0.0, 1.0);
  let entryDepth = max(mask.a, 0.0);
  let sourceExitDepth = max(sourceExit.r, 0.0);
  // Exit Aはこのentry pixelと同じ視線上にある裏面materialのIOR
  // R=0ならexit passのclear値なので閉じたvolumeではない
  let materialIor = max(sourceExit.a, 1.0);
  let samePixelThickness = sourceExitDepth - entryDepth;
  if (materialStrength <= 0.0 || materialIor <= 1.00001) {
    textureStore(outputTexture, pixel, sceneColor);
    return;
  }
  if (samePixelThickness <= 1.0e-4) {
    textureStore(
      outputTexture,
      pixel,
      rayFailureColor(RAY_DEBUG_INVALID_VOLUME)
    );
    return;
  }

  // 段階1: 前面位置と完全な3D法線を復元し、空気から透明媒質へSnellの法則で屈折させる
  let entryPosition = reconstructLinearViewPosition(uv, entryDepth);
  let entryNormal = decodeOctNormal(mask.rg);
  let incidentDirection = normalize(entryPosition);
  let insideDirectionRaw = refract(incidentDirection, entryNormal, 1.0 / materialIor);
  if (length(insideDirectionRaw) <= 1.0e-6) {
    textureStore(
      outputTexture,
      pixel,
      rayFailureColor(RAY_DEBUG_ENTRY_REFRACTION)
    );
    return;
  }
  let insideDirection = normalize(insideDirectionRaw);
  let dims = vec2<i32>(size);
  let baseStepCount = clamp(
    i32(round(params.effect.w)),
    RAY_MIN_BASE_STEP_COUNT,
    RAY_MAX_BASE_STEP_COUNT
  );
  let maxRayDistance = max(params.effect.y, 0.01);
  let hitThickness = max(params.effect.z, 0.0005);

  // 段階2: 屈折した内部rayが最初に横切るfront／backいずれかの透明境界を探す
  // 同一pixelで観測した厚さを探索距離の尺度にし、複雑形状用の上限はmaxRayDistanceで制限する
  let internalDistance = min(
    maxRayDistance,
    max(samePixelThickness * 3.0, hitThickness * 2.0)
  );
  let internalStepCount = internalRayStepCount(
    entryPosition,
    insideDirection,
    internalDistance,
    size,
    baseStepCount
  );
  let firstBoundary = findNextInternalSurface(
    entryPosition,
    insideDirection,
    internalDistance,
    internalStepCount,
    hitThickness,
    dims
  );
  if (firstBoundary.found == 0u) {
    textureStore(
      outputTexture,
      pixel,
      rayFailureColor(RAY_DEBUG_EXIT_MISS)
    );
    return;
  }

  // 段階3: 最初の境界で媒質から空気へ屈折し、全反射時だけ内部reflectionを1回追跡する
  var exitPosition = firstBoundary.position;
  var exitNormal = firstBoundary.normal;
  var boundaryIncidentDirection = insideDirection;
  var opticalDistance = length(firstBoundary.position - entryPosition);
  var outsideDirectionRaw = refract(
    boundaryIncidentDirection,
    -exitNormal,
    materialIor
  );
  if (length(outsideDirectionRaw) <= 1.0e-6) {
    let reflectedDirection = normalize(reflect(boundaryIncidentDirection, exitNormal));
    let remainingRayDistance = max(maxRayDistance - opticalDistance, 0.0);
    let reflectedDistance = min(
      remainingRayDistance,
      max(internalDistance, samePixelThickness * 4.0)
    );
    if (reflectedDistance <= 1.0e-5) {
      textureStore(
        outputTexture,
        pixel,
        rayFailureColor(RAY_DEBUG_TOTAL_INTERNAL_REFLECTION)
      );
      return;
    }
    let reflectedStepCount = internalRayStepCount(
      exitPosition,
      reflectedDirection,
      reflectedDistance,
      size,
      baseStepCount
    );
    let reflectedBoundary = findNextInternalSurface(
      exitPosition,
      reflectedDirection,
      reflectedDistance,
      reflectedStepCount,
      hitThickness,
      dims
    );
    if (reflectedBoundary.found == 0u) {
      textureStore(
        outputTexture,
        pixel,
        rayFailureColor(RAY_DEBUG_EXIT_MISS)
      );
      return;
    }
    opticalDistance += length(reflectedBoundary.position - exitPosition);
    exitPosition = reflectedBoundary.position;
    exitNormal = reflectedBoundary.normal;
    boundaryIncidentDirection = reflectedDirection;
    outsideDirectionRaw = refract(
      boundaryIncidentDirection,
      -exitNormal,
      materialIor
    );
    // 2回目の境界でも全反射するrayは追加bounceが必要なので黄色として残す
    if (length(outsideDirectionRaw) <= 1.0e-6) {
      textureStore(
        outputTexture,
        pixel,
        rayFailureColor(RAY_DEBUG_TOTAL_INTERNAL_REFLECTION)
      );
      return;
    }
  }
  let outsideDirection = normalize(outsideDirectionRaw);

  // 段階4: 球から出たrayをopaque G-buffer depthへ投影し、最初の背景surfaceを探す
  let outsideStart = exitPosition + outsideDirection * max(hitThickness * 0.25, 0.001);
  var usableDistance = maxRayDistance;
  if (outsideDirection.z > 0.00001) {
    usableDistance = min(
      maxRayDistance,
      max((-params.projection.x * 1.01 - outsideStart.z) / outsideDirection.z, 0.0)
    );
  }
  if (usableDistance <= 1.0e-5) {
    textureStore(
      outputTexture,
      pixel,
      rayFailureColorForDirection(
        outsideDirection,
        RAY_DEBUG_OUTSIDE_DISTANCE
      )
    );
    return;
  }

  let outsideEnd = outsideStart + outsideDirection * usableDistance;
  let outsideStartPixel = projectToUv(outsideStart) * vec2f(size);
  let outsideEndPixel = projectToUv(outsideEnd) * vec2f(size);
  let outsidePixelDelta = outsideEndPixel - outsideStartPixel;
  let outsideMajorLength = max(abs(outsidePixelDelta.x), abs(outsidePixelDelta.y));
  // 球を出て背景を探索する間隔
  let outsideRequested = i32(ceil(
    outsideMajorLength / OUTSIDE_RAY_COARSE_PIXEL_STRIDE
  ));
  let outsideStepCount = clamp(
    outsideRequested,
    baseStepCount,
    min(baseStepCount * 2, RAY_MAX_COARSE_STEP_COUNT)
  );
  let outsideStepLength = usableDistance / f32(outsideStepCount);

  var previousOutsidePosition = outsideStart;
  var previousOutsideDelta = -1.0;
  var previousOutsideValid = false;
  var backgroundCoord = pixel;
  var backgroundFound = false;

  let outsideStartUv = projectToUv(previousOutsidePosition);
  if (insideScreen(outsideStartUv)) {
    let startCoord = clampCoord(vec2<i32>(outsideStartUv * vec2f(size)), dims);
    let startDepth = textureLoad(depthTexture, startCoord, 0);
    if (!isGBufferBackgroundDepth(startDepth)) {
      let startSceneDepth = linearizeGBufferDepth(startDepth, params.projection);
      previousOutsideDelta = -previousOutsidePosition.z - startSceneDepth;
      previousOutsideValid = true;
    }
  }

  for (var i = 0; i < RAY_MAX_COARSE_STEP_COUNT; i += 1) {
    if (i < outsideStepCount && !backgroundFound) {
      let currentPosition = previousOutsidePosition + outsideDirection * outsideStepLength;
      if (currentPosition.z < -params.projection.x) {
        let currentUv = projectToUv(currentPosition);
        if (insideScreen(currentUv)) {
          let currentCoord = clampCoord(vec2<i32>(currentUv * vec2f(size)), dims);
          let currentDepth = textureLoad(depthTexture, currentCoord, 0);
          if (!isGBufferBackgroundDepth(currentDepth)) {
            let currentSceneDepth = linearizeGBufferDepth(currentDepth, params.projection);
            let currentDelta = -currentPosition.z - currentSceneDepth;
            if (previousOutsideValid && previousOutsideDelta < 0.0 && currentDelta >= 0.0) {
              var lowPosition = previousOutsidePosition;
              var highPosition = currentPosition;
              for (var refine = 0; refine < RAY_BINARY_REFINEMENT_COUNT; refine += 1) {
                let middlePosition = (lowPosition + highPosition) * 0.5;
                let middleUv = projectToUv(middlePosition);
                let middleCoord = clampCoord(vec2<i32>(middleUv * vec2f(size)), dims);
                let middleDepth = textureLoad(depthTexture, middleCoord, 0);
                if (!isGBufferBackgroundDepth(middleDepth)) {
                  let middleSceneDepth = linearizeGBufferDepth(middleDepth, params.projection);
                  let middleDelta = -middlePosition.z - middleSceneDepth;
                  if (middleDelta >= 0.0) {
                    highPosition = middlePosition;
                  } else {
                    lowPosition = middlePosition;
                  }
                } else {
                  lowPosition = middlePosition;
                }
              }
              let hitUv = projectToUv(highPosition);
              let hitCoord = clampCoord(vec2<i32>(hitUv * vec2f(size)), dims);
              let hitDepth = textureLoad(depthTexture, hitCoord, 0);
              if (!isGBufferBackgroundDepth(hitDepth)) {
                let hitSceneDepth = linearizeGBufferDepth(hitDepth, params.projection);
                let hitDelta = -highPosition.z - hitSceneDepth;
                if (hitDelta >= 0.0 && hitDelta <= hitThickness) {
                  backgroundCoord = hitCoord;
                  backgroundFound = true;
                }
              }
            }
            previousOutsideDelta = currentDelta;
            previousOutsideValid = true;
          } else {
            previousOutsideValid = false;
          }
        } else {
          previousOutsideValid = false;
        }
      } else {
        previousOutsideValid = false;
      }
      previousOutsidePosition = currentPosition;
    }
  }

  // geometryへhitした場合は交点色を使い、depthなしの背景では屈折rayの無限遠方向からsceneを読む
  // これにより立方体などの隙間で元pixelの未屈折背景へ突然戻る不連続を避ける
  var refracted = sceneColor;
  var backgroundResolved = false;
  if (backgroundFound) {
    refracted = textureLoad(sceneTexture, backgroundCoord, 0);
    backgroundResolved = true;
  } else if (outsideDirection.z < -0.0001) {
    let backgroundUv = directionToUv(outsideDirection);
    if (insideScreen(backgroundUv)) {
      let fallbackCoord = clampCoord(vec2<i32>(backgroundUv * vec2f(size)), dims);
      refracted = textureLoad(sceneTexture, fallbackCoord, 0);
      backgroundResolved = true;
    }
  }
  if (!backgroundResolved) {
    // 診断色をBeer-Lambert吸収で変色させず、失敗理由を固定RGBのまま表示する
    if (params.debug.x >= 0.5) {
      textureStore(outputTexture, pixel, RAY_DEBUG_BACKGROUND_MISS);
      return;
    }
    refracted = rayFailureColorForDirection(
      outsideDirection,
      RAY_DEBUG_BACKGROUND_MISS
    );
  }
  // Beer-Lambert吸収にはreflection区間も含む実際の媒質内部光路長を使う
  // attenuationColorはattenuationDistance進んだ後に残る割合なので、距離比を指数にする
  // inverseDistance 0はInfinity指定を表し、pow(color, 0)=1により吸収なしとなる
  let safeAttenuationColor = max(volume.rgb, vec3f(1.0e-6));
  let attenuationExponent = opticalDistance * max(volume.a, 0.0);
  let transmittance = pow(safeAttenuationColor, vec3f(attenuationExponent));
  let absorbedRefraction = vec4f(refracted.rgb * transmittance, refracted.a);
  // 正常hitした屈折色へ同一pixelの元背景を混ぜると、未屈折像がghostとして残る
  // 非Transmission分は後段PBR Forwardのsurface側へ配分し、ここでは屈折光だけを保存する
  textureStore(outputTexture, pixel, absorbedRefraction);
}`;

// Roughness maskをAlphaから独立して解釈し、透明合成前のHDR sceneへFrost背景を作ります
// roughness 0ではsceneを保ち、値が増えるほど1/2、1/4、1/8 Levelへ連続的に移ります
const FROST_COMPOSITE_WGSL = `
@group(0) @binding(0) var sceneTexture : texture_2d<f32>;
@group(0) @binding(1) var halfTexture : texture_2d<f32>;
@group(0) @binding(2) var quarterTexture : texture_2d<f32>;
@group(0) @binding(3) var eighthTexture : texture_2d<f32>;
@group(0) @binding(4) var roughnessMaskTexture : texture_2d<f32>;
@group(0) @binding(5) var frostSampler : sampler;
@group(0) @binding(6) var outputTexture : texture_storage_2d<rgba16float, write>;

fn selectFrostBackground(sceneColor : vec4f, uv : vec2f, levelPosition : f32) -> vec4f {
  // 分岐前に全Levelを読むと、選択されない高cost sampleまで全pixelで実行されます
  // 現在のroughnessに必要なLevelへ到達してからsampleし、結果の補間式は従来と同じに保ちます
  let halfColor = textureSampleLevel(halfTexture, frostSampler, uv, 0.0);
  if (levelPosition <= 1.0) {
    return mix(sceneColor, halfColor, levelPosition);
  }
  let quarterColor = textureSampleLevel(quarterTexture, frostSampler, uv, 0.0);
  if (levelPosition <= 2.0) {
    return mix(halfColor, quarterColor, levelPosition - 1.0);
  }
  let eighthColor = textureSampleLevel(eighthTexture, frostSampler, uv, 0.0);
  return mix(quarterColor, eighthColor, levelPosition - 2.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let size = textureDimensions(outputTexture);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }
  let pixel = vec2<i32>(i32(id.x), i32(id.y));
  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(size);
  let sceneColor = textureLoad(sceneTexture, pixel, 0);
  let roughness = clamp(textureLoad(roughnessMaskTexture, pixel, 0).r, 0.0, 1.0);

  // 0.04は透明materialの最小roughnessであり、背景ぼかしなしに対応します
  // maskがclear値0の背景pixelと最小roughnessはPyramidを一切sampleせずsceneを保持します
  if (roughness <= 0.04) {
    textureStore(outputTexture, pixel, sceneColor);
    return;
  }
  // 最大roughnessは1/8へ到達し、隣接Level間だけを線形補間して段階境界を隠します
  let roughnessAmount = clamp((roughness - 0.04) / 0.96, 0.0, 1.0);
  let levelPosition = roughnessAmount * 3.0;
  let frostedBackground = selectFrostBackground(sceneColor, uv, levelPosition);
  textureStore(outputTexture, pixel, frostedBackground);
}
`;

// visibleな透明materialの最大roughnessを、実際に参照する最深Pyramid Levelへ変換する
// Level境界のroughness 0.36と0.68では補間係数が丁度0となるため、深いLevelは不要です
export function computeFrostPyramidMaxLevel(maxRoughness) {
  const roughness = util.readFiniteNumber(
    maxRoughness,
    "TransparencyPass maxFrostRoughness",
    { min: FROST_MIN_ROUGHNESS, max: 1.0 }
  );
  const firstBoundary = FROST_MIN_ROUGHNESS + (1.0 - FROST_MIN_ROUGHNESS) / 3.0;
  const secondBoundary = FROST_MIN_ROUGHNESS + 2.0 * (1.0 - FROST_MIN_ROUGHNESS) / 3.0;
  if (roughness <= FROST_MIN_ROUGHNESS) return 0;
  if (roughness <= firstBoundary) return 2;
  if (roughness <= secondBoundary) return 4;
  return 8;
}

// G-bufferに格納できない透明layerを、opaque lighting後かつcolor effect前にforward合成する
// Spaceが全Shapeから透明triangleを収集・sortするため、利用者は追加Render Passを組み立てない
export default class TransparencyPass {
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("TransparencyPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.device = gpu.device;
    this.label = util.readOptionalString(
      options.label,
      "TransparencyPass label",
      "transparency",
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(options.width, `${this.label} width`, 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, `${this.label} height`, 1, { min: 1 });
    const deprecatedFrostOptions = [
      "frostBlurRadius",
      "frostBlurIterations",
      "frostMediumBlurRadius",
      "frostMediumBlurIterations"
    ].filter((key) => Object.prototype.hasOwnProperty.call(options, key));
    if (deprecatedFrostOptions.length > 0) {
      throw new Error(
        `${this.label} no longer supports fixed Frost blur parameters `
        + `(${deprecatedFrostOptions.join(", ")}); Frost now uses fixed 1/2, 1/4, and 1/8 pyramid Levels`
      );
    }
    this.outputTarget = new RenderTarget(gpu, {
      label: `${this.label}:output`,
      width: this.width,
      height: this.height,
      format: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      hasDepth: false,
      usage: GPUTextureUsage.STORAGE_BINDING
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.COPY_SRC
    });
    this.roughnessMaskTarget = new RenderTarget(gpu, {
      label: `${this.label}:roughness-mask`,
      width: this.width,
      height: this.height,
      format: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      hasDepth: false
    });
    this.transmissionMaskTarget = new RenderTarget(gpu, {
      label: `${this.label}:transmission-mask`,
      width: this.width,
      height: this.height,
      format: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      hasDepth: false
    });
    // entryと同じfront materialの吸収色RGBとattenuation distance逆数を保持する
    // 法線・entry距離targetと分離し、Beer-Lambert値を半精度の線形値として直接読む
    this.transmissionVolumeTarget = new RenderTarget(gpu, {
      label: `${this.label}:transmission-volume`,
      width: this.width,
      height: this.height,
      format: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      hasDepth: false
    });
    // 透明meshの最初のback faceだけを専用Reverse-Z depthへ書き、entryとの差から幾何厚さを求める
    // colorにはexit距離、IOR、最大Thickness、有効flagを保持し、Shapeへpass固有fieldを追加しない
    this.transmissionExitTarget = new RenderTarget(gpu, {
      label: `${this.label}:transmission-exit`,
      width: this.width,
      height: this.height,
      format: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      hasDepth: true,
      depthConvention: CAMERA_REVERSE_Z
    });
    this.transmissionTarget = new RenderTarget(gpu, {
      label: `${this.label}:transmission-background`,
      width: this.width,
      height: this.height,
      format: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      hasDepth: false,
      usage: GPUTextureUsage.STORAGE_BINDING
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.COPY_SRC
    });
    // environmentなしでも固定bind group layoutを満たす1 pixelの零radianceを用意する
    // environment fallback無効時はWGSLの分岐により内容を読み取らない
    this.emptyRadianceTexture = gpu.device.createTexture({
      label: `${this.label}:empty-radiance`,
      size: [1, 1, 1],
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.emptyRadianceView = this.emptyRadianceTexture.createView();
    this.frostPyramid = new ComputeImagePyramid(gpu, {
      label: `${this.label}:frost-pyramid`,
      width: this.width,
      height: this.height,
      format: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      levels: FROST_PYRAMID_LEVELS
    });
    this.frostCompositePass = new ComputePass(gpu, {
      label: `${this.label}:frost-composite`,
      code: FROST_COMPOSITE_WGSL,
      bindings: [
        { binding: 0, name: "scene", type: "sampled-texture" },
        { binding: 1, name: "half", type: "sampled-texture" },
        { binding: 2, name: "quarter", type: "sampled-texture" },
        { binding: 3, name: "eighth", type: "sampled-texture" },
        { binding: 4, name: "roughnessMask", type: "sampled-texture" },
        { binding: 5, name: "sampler", type: "sampler" },
        {
          binding: 6,
          name: "output",
          type: "storage-texture",
          format: DEFERRED_LIGHTING_OUTPUT_FORMAT,
          dispatchSize: true
        }
      ]
    });
    this.transmissionCompositePass = new ComputePass(gpu, {
      label: `${this.label}:transmission-composite`,
      code: TRANSMISSION_COMPOSITE_WGSL,
      // Paramsは9個のvec4fで構成し、CPU配列との長さ不一致をComputePassで検出する
      uniformFloats: 36,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "scene", type: "sampled-texture" },
        { binding: 2, name: "transmissionMask", type: "sampled-texture" },
        { binding: 3, name: "transmissionExit", type: "sampled-texture" },
        { binding: 4, name: "transmissionVolume", type: "sampled-texture" },
        { binding: 5, name: "depth", type: "depth-texture" },
        { binding: 6, name: "sampler", type: "sampler" },
        {
          binding: 7,
          name: "output",
          type: "storage-texture",
          format: DEFERRED_LIGHTING_OUTPUT_FORMAT,
          dispatchSize: true
        },
        {
          binding: 8,
          name: "radiance",
          type: "sampled-texture",
          sampleType: "unfilterable-float"
        }
      ]
    });
    this.roughnessMaskShader = new SmoothShader(gpu, {
      colorFormat: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      depthWriteEnabled: false,
      roughnessMask: true
    });
    this.transmissionMaskShader = new SmoothShader(gpu, {
      colorFormat: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      depthWriteEnabled: false,
      transmissionMask: true
    });
    this.transmissionVolumeShader = new SmoothShader(gpu, {
      colorFormat: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      depthWriteEnabled: false,
      transmissionVolumeMask: true
    });
    this.transmissionExitShader = new SmoothShader(gpu, {
      colorFormat: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      depthWriteEnabled: true,
      cullMode: "front",
      transmissionExit: true
    });
    this.shader = new PbrForwardShader(gpu, {
      colorFormat: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      depthWriteEnabled: false,
      maxLights: util.readOptionalInteger(
        options.maxLights,
        `${this.label} maxLights`,
        128,
        { min: 1 }
      )
    });
    this.ready = Promise.all([
      this.outputTarget.ready,
      this.roughnessMaskTarget.ready,
      this.transmissionMaskTarget.ready,
      this.transmissionVolumeTarget.ready,
      this.transmissionExitTarget.ready,
      this.transmissionTarget.ready,
      this.frostPyramid.ready,
      this.roughnessMaskShader.init(),
      this.transmissionMaskShader.init(),
      this.transmissionVolumeShader.init(),
      this.transmissionExitShader.init(),
      this.shader.init()
    ]);
    // 画面を占有するRender/Compute Passを個別に計測し、非同期readbackで描画loopを止めない
    this.profiler = new GpuPassProfiler(this.device, {
      label: `${this.label}:profiler`,
      names: TRANSPARENCY_GPU_PROFILE_NAMES,
      sampleWindow: 60
    });
    this.lastQueueStats = {
      frameSequence: 0,
      triangleCount: 0,
      batchCount: 0,
      fragmentationCount: 0,
      instanceCount: 0,
      independentInstanceCount: 0,
      globallySortedInstanceCount: 0,
      ambiguousPairCount: 0,
      coarseAmbiguousPairCount: 0,
      tightBoundsGroupCount: 0,
      tightBoundsUnavailableGroupCount: 0,
      ignoredSmallOverlapPairCount: 0,
      maximumIgnoredOverlapPixels: 0,
      queueCollectMs: 0,
      queueSortMs: 0,
      queuePrepareMs: 0,
      queueTotalMs: 0
    };
    this.queueFrameSequence = 0;
    this.lastPreparedTranslucentQueue = null;
    this.destroyed = false;
  }

  // 画面空間屈折の公開値を有限範囲へ検証し、無効時も同じ形の値を返す
  validateTransmissionOptions(options = {}) {
    const checked = util.readPlainObject(options, `${this.label} transmission options`);
    const rayMissFallback = util.readOptionalEnum(
      checked.rayMissFallback,
      `${this.label} transmission rayMissFallback`,
      TRANSMISSION_DEFAULTS.rayMissFallback,
      ["auto", "environment", "clear", "constant"]
    );
    const hasRayMissColor = checked.rayMissColor !== undefined
      && checked.rayMissColor !== null;
    if (rayMissFallback === "constant" && !hasRayMissColor) {
      throw new Error(
        `${this.label} transmission rayMissFallback "constant" requires rayMissColor`
      );
    }
    if (rayMissFallback !== "constant" && hasRayMissColor) {
      throw new Error(
        `${this.label} transmission rayMissColor requires rayMissFallback "constant"`
      );
    }
    // 固定色はWebgAppのclearColorと同じ表示用sRGB入力とし、HDR合成前に一度だけ線形化する
    const rayMissColor = hasRayMissColor
      ? srgbColorToLinear(
          checked.rayMissColor,
          `${this.label} transmission rayMissColor`
        )
      : null;
    return {
      enabled: util.readOptionalBoolean(
        checked.enabled,
        `${this.label} transmission enabled`,
        TRANSMISSION_DEFAULTS.enabled
      ),
      strength: util.readFiniteNumber(
        checked.strength ?? TRANSMISSION_DEFAULTS.strength,
        `${this.label} transmission strength`,
        { min: 0.0, max: 1.0 }
      ),
      maxUvOffset: util.readFiniteNumber(
        checked.maxUvOffset ?? TRANSMISSION_DEFAULTS.maxUvOffset,
        `${this.label} transmission maxUvOffset`,
        { min: 0.0, max: 0.25 }
      ),
      distance: util.readFiniteNumber(
        checked.distance ?? TRANSMISSION_DEFAULTS.distance,
        `${this.label} transmission distance`,
        { min: 0.1, max: 1000.0 }
      ),
      hitThickness: util.readFiniteNumber(
        checked.hitThickness ?? TRANSMISSION_DEFAULTS.hitThickness,
        `${this.label} transmission hitThickness`,
        { min: 0.001, max: 4.0 }
      ),
      steps: util.readFiniteNumber(
        checked.steps ?? TRANSMISSION_DEFAULTS.steps,
        `${this.label} transmission steps`,
        { min: 12, max: 64, integer: true }
      ),
      debugRayStatus: util.readOptionalBoolean(
        checked.debugRayStatus,
        `${this.label} transmission debugRayStatus`,
        false
      ),
      rayMissFallback,
      rayMissColor
    };
  }

  // 入力scene、G-buffer depth、Space、Camera Frameが同じframe寸法とReverse-Z契約か検証する
  validateInputs(scene, depth, space, cameraFrame) {
    if (!scene || typeof scene.getView !== "function") {
      throw new Error(`${this.label} requires a scene color target`);
    }
    if (!depth || typeof depth.getDepthView !== "function"
      || typeof depth.getDepthSampleView !== "function") {
      throw new Error(`${this.label} requires a depth target`);
    }
    if (depth.depthConvention !== CAMERA_REVERSE_Z) {
      throw new Error(`${this.label} depth target must use CAMERA_REVERSE_Z`);
    }
    if (!space || typeof space.draw !== "function") {
      throw new Error(`${this.label} requires a Space`);
    }
    if (!cameraFrame || cameraFrame.depthConvention !== CAMERA_REVERSE_Z
      || !cameraFrame.projectionMatrix) {
      throw new Error(`${this.label} requires a Reverse-Z CameraFrame`);
    }
    const sceneWidth = util.readFiniteNumber(scene.getWidth?.(), `${this.label} scene width`, {
      integer: true,
      min: 1
    });
    const sceneHeight = util.readFiniteNumber(scene.getHeight?.(), `${this.label} scene height`, {
      integer: true,
      min: 1
    });
    const depthWidth = util.readFiniteNumber(depth.getWidth?.(), `${this.label} depth width`, {
      integer: true,
      min: 1
    });
    const depthHeight = util.readFiniteNumber(depth.getHeight?.(), `${this.label} depth height`, {
      integer: true,
      min: 1
    });
    if (sceneWidth !== this.width || sceneHeight !== this.height) {
      throw new Error(
        `${this.label} scene size ${sceneWidth}x${sceneHeight} does not match output size `
        + `${this.width}x${this.height}`
      );
    }
    if (depthWidth !== this.width || depthHeight !== this.height) {
      throw new Error(
        `${this.label} depth size ${depthWidth}x${depthHeight} does not match output size `
        + `${this.width}x${this.height}`
      );
    }
  }

  // Roughness maskと3段階PyramidでFrost背景を作り、その上へ透明triangleをAlpha合成します
  encode(commandEncoder, resources = {}) {
    this.requireAlive();
    if (!commandEncoder || typeof commandEncoder.beginComputePass !== "function"
      || typeof commandEncoder.beginRenderPass !== "function") {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    const scene = resources.scene;
    const depth = resources.depth;
    const space = resources.space;
    const cameraFrame = resources.cameraFrame;
    this.validateInputs(scene, depth, space, cameraFrame);
    const encodeStartedAt = readPerformanceTime();
    this.profiler.beginFrame();
    if (Number.isFinite(resources.cpuSummaryMs) && resources.cpuSummaryMs >= 0.0) {
      this.profiler.addCpuSample("sceneSummary", resources.cpuSummaryMs);
    }
    const maxFrostRoughness = util.readOptionalFiniteNumber(
      resources.maxFrostRoughness,
      `${this.label} maxFrostRoughness`,
      1.0,
      { min: FROST_MIN_ROUGHNESS, max: 1.0 }
    );

    // 透明surfaceの最前面法線をmaskへ描き、屈折を有効にした場合だけHDR背景をずらす
    // maskは不透明depthをloadし、背後へ隠れた透明triangleを屈折対象へ含めない
    const transmission = this.validateTransmissionOptions(resources.transmission ?? {});
    let backgroundSource = scene;
    let preparedTranslucentQueue = null;
    if (transmission.enabled && transmission.strength > 0.0) {
      const transmissionMaskCpuStartedAt = readPerformanceTime();
      const transmissionMaskPass = commandEncoder.beginRenderPass({
        label: `${this.label}:transmission-mask-pass`,
        timestampWrites: this.profiler.getTimestampWrites("transmissionMask"),
        colorAttachments: [{
          view: this.transmissionMaskTarget.getView(),
          clearValue: [0.5, 0.5, 0.0, 0.0],
          loadOp: "clear",
          storeOp: "store"
        }],
        depthStencilAttachment: {
          view: depth.getDepthView(),
          depthLoadOp: "load",
          depthStoreOp: "store"
        }
      });
      this.gpu.passEncoder = transmissionMaskPass;
      this.gpu.uniformIndex = 1;
      this.transmissionMaskShader.setProjectionMatrix(cameraFrame.projectionMatrix);
      try {
        // 最前面maskで作ったsort済みqueueを受け取り、最終Forwardでも同じIndex Bufferを再利用する
        preparedTranslucentQueue = space.draw(cameraFrame, {
          onlyTranslucent: true,
          shaderOverride: this.transmissionMaskShader,
          viewportWidth: this.width,
          viewportHeight: this.height,
          smallOverlapPixelLimit: TRANSLUCENT_SMALL_OVERLAP_PIXEL_LIMIT
        });
      } finally {
        transmissionMaskPass.end();
        this.gpu.passEncoder = null;
      }
      this.profiler.addCpuSample(
        "transmissionMaskEncode",
        readPerformanceTime() - transmissionMaskCpuStartedAt
      );

      // entryと同じfront materialをprepared queueで再描画し、吸収値だけをVolume targetへ保存する
      // target clearの白RGBと逆数0は、材質値がないpixelに対する吸収なしのBeer-Lambert入力となる
      const transmissionVolumeCpuStartedAt = readPerformanceTime();
      const transmissionVolumePass = commandEncoder.beginRenderPass({
        label: `${this.label}:transmission-volume-pass`,
        timestampWrites: this.profiler.getTimestampWrites("transmissionVolume"),
        colorAttachments: [{
          view: this.transmissionVolumeTarget.getView(),
          clearValue: [1.0, 1.0, 1.0, 0.0],
          loadOp: "clear",
          storeOp: "store"
        }],
        depthStencilAttachment: {
          view: depth.getDepthView(),
          depthLoadOp: "load",
          depthStoreOp: "store"
        }
      });
      this.gpu.passEncoder = transmissionVolumePass;
      this.gpu.uniformIndex = 1;
      this.transmissionVolumeShader.setProjectionMatrix(cameraFrame.projectionMatrix);
      try {
        preparedTranslucentQueue.owner.drawPrepared(preparedTranslucentQueue, {
          shaderOverride: this.transmissionVolumeShader
        });
      } finally {
        transmissionVolumePass.end();
        this.gpu.passEncoder = null;
      }
      this.profiler.addCpuSample(
        "transmissionVolumeEncode",
        readPerformanceTime() - transmissionVolumeCpuStartedAt
      );

      // entry passで準備した同じtriangle Index Bufferを再利用し、back faceだけを専用depthへ描く
      // Reverse-Zのgreater比較とdepth writeにより、各pixelでcameraから最初に見えるexit面を選ぶ
      const transmissionExitCpuStartedAt = readPerformanceTime();
      const transmissionExitPass = commandEncoder.beginRenderPass({
        label: `${this.label}:transmission-exit-pass`,
        timestampWrites: this.profiler.getTimestampWrites("transmissionExit"),
        colorAttachments: [{
          view: this.transmissionExitTarget.getView(),
          // R=0をinvalid sentinel、GBをneutral oct normal、Aを空気IOR 1で初期化する
          clearValue: [0.0, 0.5, 0.5, 1.0],
          loadOp: "clear",
          storeOp: "store"
        }],
        depthStencilAttachment: {
          view: this.transmissionExitTarget.getDepthView(),
          depthClearValue: CAMERA_REVERSE_Z.clearValue,
          depthLoadOp: "clear",
          depthStoreOp: "store"
        }
      });
      this.gpu.passEncoder = transmissionExitPass;
      this.gpu.uniformIndex = 1;
      this.transmissionExitShader.setProjectionMatrix(cameraFrame.projectionMatrix);
      try {
        preparedTranslucentQueue.owner.drawPrepared(preparedTranslucentQueue, {
          shaderOverride: this.transmissionExitShader,
          translucent: false
        });
      } finally {
        transmissionExitPass.end();
        this.gpu.passEncoder = null;
      }
      this.profiler.addCpuSample(
        "transmissionExitEncode",
        readPerformanceTime() - transmissionExitCpuStartedAt
      );

      const transmissionCompositeCpuStartedAt = readPerformanceTime();
      const transmissionProjection = createGBufferProjectionParams(cameraFrame);
      const linearClearColor = srgbColorToLinear(
        resources.clearColor,
        `${this.label} clearColor`
      );
      const checkedEnvironment = validatePbrEnvironmentResources(
        resources.environment,
        resources.environmentIntensity,
        `${this.label} transmission environment`
      );
      const environmentRotationDegrees = util.readOptionalFiniteNumber(
        resources.environmentRotationDegrees,
        `${this.label} environmentRotationDegrees`,
        0.0
      );
      if (checkedEnvironment === null && environmentRotationDegrees !== 0.0) {
        throw new Error(`${this.label} environmentRotationDegrees requires environment`);
      }
      const hasEnvironmentRadiance = checkedEnvironment !== null
        && checkedEnvironment.radiance !== null;
      if (transmission.rayMissFallback === "environment" && !hasEnvironmentRadiance) {
        throw new Error(
          `${this.label} transmission rayMissFallback "environment" `
          + "requires environment.radiance"
        );
      }
      // autoだけはresourceの有無で選ぶ。明示environmentの欠落は上で停止し、clearへ隠さない
      const useEnvironmentFallback = transmission.rayMissFallback === "environment"
        || (transmission.rayMissFallback === "auto" && hasEnvironmentRadiance);
      const solidFallbackColor = transmission.rayMissFallback === "constant"
        ? transmission.rayMissColor
        : linearClearColor;
      const cameraWorldMatrix = cameraFrame.cameraWorldMatrix.mat;
      const rotationRadians = environmentRotationDegrees * Math.PI / 180.0;
      this.transmissionCompositePass.setUniforms(new Float32Array([
        ...transmissionProjection,
        transmission.strength,
        transmission.distance,
        transmission.hitThickness,
        transmission.steps,
        transmission.debugRayStatus ? 1.0 : 0.0,
        0.0,
        0.0,
        0.0,
        useEnvironmentFallback ? 1.0 : 0.0,
        checkedEnvironment?.intensity ?? 0.0,
        0.0,
        0.0,
        ...solidFallbackColor,
        cameraWorldMatrix[0], cameraWorldMatrix[4], cameraWorldMatrix[8], 0.0,
        cameraWorldMatrix[1], cameraWorldMatrix[5], cameraWorldMatrix[9], 0.0,
        cameraWorldMatrix[2], cameraWorldMatrix[6], cameraWorldMatrix[10], 0.0,
        Math.cos(rotationRadians), Math.sin(rotationRadians), 0.0, 0.0
      ]));
      this.transmissionCompositePass.encode(commandEncoder, {
        scene,
        transmissionMask: this.transmissionMaskTarget,
        transmissionExit: this.transmissionExitTarget,
        transmissionVolume: this.transmissionVolumeTarget,
        depth,
        sampler: scene.getSampler(),
        radiance: checkedEnvironment?.radiance ?? this.emptyRadianceView,
        output: this.transmissionTarget
      }, {
        timestampWrites: this.profiler.getTimestampWrites("transmissionComposite")
      });
      this.profiler.addCpuSample(
        "transmissionCompositeEncode",
        readPerformanceTime() - transmissionCompositeCpuStartedAt
      );
      backgroundSource = this.transmissionTarget;
    }

    // 透明合成前のHDR sceneから1/2、1/4、1/8 Levelを連続low-passで作ります
    // 透明layer同士の交差・循環と同様、手前の透明面が背後の透明面だけを再blurする処理は対象外とする
    const frostPyramidMaxLevel = computeFrostPyramidMaxLevel(maxFrostRoughness);
    if (frostPyramidMaxLevel > 0) {
      const frostPyramidCpuStartedAt = readPerformanceTime();
      this.frostPyramid.encode(commandEncoder, backgroundSource, {
        maxLevel: frostPyramidMaxLevel,
        timestampWrites: this.profiler.getTimestampWrites("frostPyramid")
      });
      this.profiler.addCpuSample(
        "frostPyramidEncode",
        readPerformanceTime() - frostPyramidCpuStartedAt
      );
    }
    const half = this.frostPyramid.getLevel(2);
    const quarter = this.frostPyramid.getLevel(4);
    const eighth = this.frostPyramid.getLevel(8);

    // opaque depthをloadし、手前の不透明面で隠れた透明triangleをmaskへ書かない
    // colorはmax blendなので、透明面が重なるpixelでは最大roughnessが残る
    const roughnessMaskCpuStartedAt = readPerformanceTime();
    const maskPass = commandEncoder.beginRenderPass({
      label: `${this.label}:roughness-mask-pass`,
      timestampWrites: this.profiler.getTimestampWrites("roughnessMask"),
      colorAttachments: [{
        view: this.roughnessMaskTarget.getView(),
        clearValue: [0.0, 0.0, 0.0, 0.0],
        loadOp: "clear",
        storeOp: "store"
      }],
      depthStencilAttachment: {
        view: depth.getDepthView(),
        depthLoadOp: "load",
        depthStoreOp: "store"
      }
    });
    this.gpu.passEncoder = maskPass;
    this.gpu.uniformIndex = 1;
    this.roughnessMaskShader.setProjectionMatrix(cameraFrame.projectionMatrix);
    try {
      space.draw(cameraFrame, {
        onlyTranslucent: true,
        // maskはopaque depthに対するtestとmax blendだけで決まり、透明triangle間の順序に依存しない
        // material別index bufferを一括描画し、色合成用のtriangle sortは後段passだけに限定する
        orderIndependentTranslucent: true,
        shaderOverride: this.roughnessMaskShader
      });
    } finally {
      maskPass.end();
      this.gpu.passEncoder = null;
    }
    this.profiler.addCpuSample(
      "roughnessMaskEncode",
      readPerformanceTime() - roughnessMaskCpuStartedAt
    );

    // Frost背景はmaterial Alphaを使わずroughness maskだけで合成する
    // この時点では透明surface色とSpecularを加えず、次のsorted passへ役割を分ける
    const frostCompositeCpuStartedAt = readPerformanceTime();
    this.frostCompositePass.encode(commandEncoder, {
      scene: backgroundSource,
      half,
      quarter,
      eighth,
      roughnessMask: this.roughnessMaskTarget,
      sampler: half.getSampler(),
      output: this.outputTarget
    }, {
      timestampWrites: this.profiler.getTimestampWrites("frostComposite")
    });
    this.profiler.addCpuSample(
      "frostCompositeEncode",
      readPerformanceTime() - frostCompositeCpuStartedAt
    );

    const forwardCpuStartedAt = readPerformanceTime();
    const pass = commandEncoder.beginRenderPass({
      label: `${this.label}:transparent-pass`,
      timestampWrites: this.profiler.getTimestampWrites("forward"),
      colorAttachments: [{
        view: this.outputTarget.getView(),
        loadOp: "load",
        storeOp: "store"
      }],
      depthStencilAttachment: {
        view: depth.getDepthView(),
        depthLoadOp: "load",
        depthStoreOp: "store"
      }
    });
    this.gpu.passEncoder = pass;
    this.gpu.uniformIndex = 1;
    this.shader.setProjectionMatrix(cameraFrame.projectionMatrix);
    if (resources.radiance !== undefined) {
      this.shader.setDefaultParam("radiance", resources.radiance);
    }
    // Deferredへ渡した同じ前処理済み環境を透明共有GGXへ設定します
    // environmentがない場合だけ明示的な無効状態とし、不完全なresource集合はshader側で拒否します
    this.shader.setEnvironment(
      resources.environment,
      resources.environmentIntensity,
      cameraFrame,
      resources.environmentRotationDegrees ?? 0.0
    );
    // Shadowは透明fragment位置からshadow mapを再評価し、Local LightはDeferredのbufferを共有します
    this.shader.setFrameLighting(
      resources.shadow ?? null,
      resources.localLights ?? null
    );
    // material Transmissionとpass全体倍率の積を後段surface合成にも共有し、
    // 非透過分を未屈折背景ではなくPBR surfaceへ配分する
    this.shader.setTransmissionPassScale(
      transmission.enabled ? transmission.strength : 0.0
    );
    let finalPreparedQueue = null;
    try {
      finalPreparedQueue = space.draw(cameraFrame, {
        onlyTranslucent: true,
        shaderOverride: this.shader,
        ...(preparedTranslucentQueue === null
          ? {}
          : { preparedTranslucentQueue }),
        ...(resources.lightOverride === undefined
          ? {}
          : { lightOverride: resources.lightOverride })
      });
    } finally {
      pass.end();
      this.gpu.passEncoder = null;
    }
    this.profiler.addCpuSample("forwardEncode", readPerformanceTime() - forwardCpuStartedAt);
    const measuredQueue = preparedTranslucentQueue ?? finalPreparedQueue;
    if (measuredQueue?.cpuTiming) {
      this.profiler.addCpuSample("queueCollect", measuredQueue.cpuTiming.collectMs);
      this.profiler.addCpuSample("queueSort", measuredQueue.cpuTiming.sortMs);
      this.profiler.addCpuSample("queuePrepare", measuredQueue.cpuTiming.prepareMs);
      this.profiler.addCpuSample("queueTotal", measuredQueue.cpuTiming.totalMs);
    }
    this.queueFrameSequence += 1;
    this.lastPreparedTranslucentQueue = measuredQueue;
    const queueTiming = measuredQueue?.cpuTiming;
    const batchCount = measuredQueue?.batches?.length ?? 0;
    const instanceCount = measuredQueue?.sortStats?.instanceCount ?? 0;
    // sampleの毎frame監視が同じ参照を読めるよう、summary object自体は作り直さず全fieldを更新する
    this.lastQueueStats.frameSequence = this.queueFrameSequence;
    this.lastQueueStats.triangleCount = measuredQueue?.triangleCount ?? 0;
    this.lastQueueStats.batchCount = batchCount;
    this.lastQueueStats.fragmentationCount = Math.max(batchCount - instanceCount, 0);
    this.lastQueueStats.instanceCount = instanceCount;
    this.lastQueueStats.independentInstanceCount =
      measuredQueue?.sortStats?.independentInstanceCount ?? 0;
    this.lastQueueStats.globallySortedInstanceCount =
      measuredQueue?.sortStats?.globallySortedInstanceCount ?? 0;
    this.lastQueueStats.ambiguousPairCount = measuredQueue?.sortStats?.ambiguousPairCount ?? 0;
    this.lastQueueStats.coarseAmbiguousPairCount =
      measuredQueue?.sortStats?.coarseAmbiguousPairCount ?? 0;
    this.lastQueueStats.tightBoundsGroupCount =
      measuredQueue?.sortStats?.tightBoundsGroupCount ?? 0;
    this.lastQueueStats.tightBoundsUnavailableGroupCount =
      measuredQueue?.sortStats?.tightBoundsUnavailableGroupCount ?? 0;
    this.lastQueueStats.ignoredSmallOverlapPairCount =
      measuredQueue?.sortStats?.ignoredSmallOverlapPairCount ?? 0;
    this.lastQueueStats.maximumIgnoredOverlapPixels =
      measuredQueue?.sortStats?.maximumIgnoredOverlapPixels ?? 0;
    this.lastQueueStats.queueCollectMs = queueTiming?.collectMs ?? 0;
    this.lastQueueStats.queueSortMs = queueTiming?.sortMs ?? 0;
    this.lastQueueStats.queuePrepareMs = queueTiming?.prepareMs ?? 0;
    this.lastQueueStats.queueTotalMs = queueTiming?.totalMs ?? 0;
    this.profiler.endFrame(commandEncoder);
    this.profiler.addCpuSample("transparencyEncode", readPerformanceTime() - encodeStartedAt);
    return this.outputTarget;
  }

  // queue.submit()後にGPU timestampのreadbackを開始し、呼び出し側のframe処理をawaitで停止しない
  afterGpuSubmit() {
    this.requireAlive();
    this.profiler.afterSubmit();
  }

  // パス別GPU時間とscene集計・sort・encodeのCPU時間を、診断表示用のsnapshotとして返す
  getPerformanceSnapshot() {
    this.requireAlive();
    return {
      ...this.profiler.getSnapshot(),
      queue: { ...this.lastQueueStats }
    };
  }

  // sampleの毎frame異常判定へ、allocationなしで直前queueのprimitive統計を公開する
  // 戻り値は内部objectなので呼び出し側は読み取り専用として扱う
  getQueueFrameSummary() {
    this.requireAlive();
    return this.lastQueueStats;
  }

  // 異常を検出したframeだけ、instance姿勢・bounds・pair・latest pass時間を詳細化する
  getQueueDebugSnapshot() {
    this.requireAlive();
    const preparedQueue = this.lastPreparedTranslucentQueue;
    if (!preparedQueue) {
      return null;
    }
    if (typeof preparedQueue.owner?.getDebugSnapshot !== "function") {
      throw new Error("TransparencyPass queue debug snapshot requires current TranslucentRenderQueue module");
    }
    return {
      frameSequence: this.lastQueueStats.frameSequence,
      queue: preparedQueue.owner.getDebugSnapshot(preparedQueue),
      timings: this.profiler.getLatestSnapshot()
    };
  }

  // canvas寸法変更時だけHDR合成先を再生成する
  resize(width, height) {
    this.requireAlive();
    const nextWidth = util.readFiniteNumber(width, `${this.label} width`, {
      integer: true,
      min: 1
    });
    const nextHeight = util.readFiniteNumber(height, `${this.label} height`, {
      integer: true,
      min: 1
    });
    if (nextWidth === this.width && nextHeight === this.height) {
      return false;
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.outputTarget.resize(this.width, this.height);
    this.roughnessMaskTarget.resize(this.width, this.height);
    this.transmissionMaskTarget.resize(this.width, this.height);
    this.transmissionVolumeTarget.resize(this.width, this.height);
    this.transmissionExitTarget.resize(this.width, this.height);
    this.transmissionTarget.resize(this.width, this.height);
    this.frostPyramid.resize(this.width, this.height);
    return true;
  }

  // 使用可能状態を検証し、後続処理が扱える共通形式へ整える
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  // Frost用Compute resource、mask/透明shader、HDR targetを所有順序の逆に破棄する
  destroy() {
    if (this.destroyed) return false;
    this.profiler.destroy();
    this.shader.destroy();
    this.transmissionExitShader.destroy();
    this.transmissionVolumeShader.destroy();
    this.transmissionMaskShader.destroy();
    this.roughnessMaskShader.destroy();
    this.transmissionCompositePass.destroy();
    this.frostCompositePass.destroy();
    this.frostPyramid.destroy();
    this.roughnessMaskTarget.destroy();
    this.transmissionMaskTarget.destroy();
    this.transmissionVolumeTarget.destroy();
    this.transmissionExitTarget.destroy();
    this.transmissionTarget.destroy();
    this.emptyRadianceTexture.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
