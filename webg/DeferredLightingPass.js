// ---------------------------------------------
// DeferredLightingPass.js  2026/07/14
//   G-buffer deferred lighting compute pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import {
  createGBufferProjectionParams,
  GBUFFER_MIN_ROUGHNESS,
  GBUFFER_WGSL_COMMON
} from "./GeometryBufferPass.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const DEFERRED_LIGHTING_DEFAULTS = Object.freeze({
  maxLights: 128,
  ambient: 0.035,
  view: "lighting"
});

// 照明値はtone mapping前の線形High Dynamic Range値として後段へ渡す
// rgba8unormへ途中で量子化すると1.0を超える輝度と暗部の階調が失われるため、形式を固定する
export const DEFERRED_LIGHTING_OUTPUT_FORMAT = "rgba16float";

export const DEFERRED_LIGHTING_VIEW_MODES = Object.freeze([
  "lighting",
  "albedo",
  "normal",
  "depth",
  "shadow",
  "spotShadow",
  "ao",
  "specular",
  "roughness",
  "metallic",
  "emissive"
]);

// Local Lightは全方向のpointと、放射方向を持つconeを同じ配列で扱います
// GPU側の数値IDはstorage bufferにのみ使い、公開入力では意味が明確な文字列typeを必須とします
export const DEFERRED_LOCAL_LIGHT_TYPES = Object.freeze(["point", "cone"]);
export const DEFERRED_LOCAL_LIGHT_TYPE_IDS = Object.freeze({
  point: 0,
  cone: 1
});
export const DEFERRED_LOCAL_LIGHT_STRIDE_FLOATS = 16;

// G-bufferのalbedo、view-space normal、depthを読み、Local Light配列をpixel単位で評価する
// Geometry Passを内包せず、lighting用StorageTargetだけを所有する
export function buildDeferredLightingWgsl(maxLights = DEFERRED_LIGHTING_DEFAULTS.maxLights) {
  const checkedMaxLights = util.readFiniteNumber(
    maxLights,
    "DeferredLightingPass maxLights",
    { integer: true, min: 1 }
  );
  return `
struct Params {
  // projection = near, far, tan(vfov/2), aspect
  projection : vec4f,
  // control.x = Local Light count、control.y = debug view、control.z = directional enabled
  control : vec4f,
  // xyz = 光が進むview-space方向、w = intensity
  directionalDirectionIntensity : vec4f,
  // rgb = directional color、w = shadowの影響を受けないambient係数
  directionalColorAmbient : vec4f,
  // xyz = view-space spot位置、w = 有効半径
  spotPositionRadius : vec4f,
  // xyz = 光が進むview-space方向、w = intensity
  spotDirectionIntensity : vec4f,
  // rgb = spot color、w = inner cone cosine
  spotColorInner : vec4f,
  // x = outer cone cosine、残りは予約
  spotCone : vec4f,
};

${GBUFFER_WGSL_COMMON}

struct LocalLight {
  // JavaScript側でworld-spaceからview-spaceへ変換した位置と半径
  positionRadius : vec4f,
  colorIntensity : vec4f,
  // xyz = view-spaceの光が進む方向、w = inner cone cosine
  directionInnerCos : vec4f,
  // x = outer cone cosine、y = 0: point / 1: cone、zw = 予約
  outerCosAndType : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var albedoTexture : texture_2d<f32>;
@group(0) @binding(2) var normalTexture : texture_2d<f32>;
@group(0) @binding(3) var depthTexture : texture_depth_2d;
@group(0) @binding(4) var materialTexture : texture_2d<f32>;
@group(0) @binding(5) var<storage, read> lights : array<LocalLight>;
@group(0) @binding(6) var shadowVisibilityTexture : texture_2d<f32>;
@group(0) @binding(7) var spotShadowVisibilityTexture : texture_2d<f32>;
@group(0) @binding(8) var ambientOcclusionTexture : texture_2d<f32>;
@group(0) @binding(9) var outputTexture : texture_storage_2d<${DEFERRED_LIGHTING_OUTPUT_FORMAT}, write>;

// Schlick Fresnelの5乗を汎用powへ渡さず、3回の乗算で評価します。
// 入力cosineは内積から得るため、丸め誤差があっても0から1へ収めます。
fn schlickWeight(cosine : f32) -> f32 {
  let oneMinusCosine = clamp(1.0 - cosine, 0.0, 1.0);
  let squared = oneMinusCosine * oneMinusCosine;
  return squared * squared * oneMinusCosine;
}

// 一様な環境光を、Lambert積分後の線形拡散環境強度として評価します。
// metallic-roughness材質では金属のbase colorは鏡面F0であり拡散色ではないため、
// Fresnelへ配分した割合とmetallic成分を拡散アンビエントから除外します。
// 金属の環境鏡面反射はImage Based Lightingの責務であり、拡散色で代用しません。
fn evaluateAmbientDiffuse(
  albedo : vec3f,
  normal : vec3f,
  viewDirection : vec3f,
  material : vec4f,
  ambient : f32,
  ambientOcclusion : f32
) -> vec3f {
  let roughness = material.y;
  let metallic = material.z;
  let dielectricF0 = vec3f(0.04 * material.x);
  let f0 = mix(dielectricF0, albedo, metallic);
  let nDotV = max(dot(normal, viewDirection), 0.0);
  // 粗い面でgrazing Fresnelが過大にならないよう、環境光用F90をroughnessで抑えます。
  let ambientF90 = max(vec3f(1.0 - roughness), f0);
  let fresnel = f0 + (ambientF90 - f0) * schlickWeight(nDotV);
  let diffuseWeight = (vec3f(1.0) - fresnel) * (1.0 - metallic);
  return albedo * ambient * ambientOcclusion * diffuseWeight;
}

// Local Light（point / cone）、directional、spotで共有するGGX系の直接反射モデルです
// material = specular、roughness、metallic、emissiveで、roughnessはCPU側で${GBUFFER_MIN_ROUGHNESS}以上を保証します
fn evaluateDirectBrdf(
  albedo : vec3f,
  normal : vec3f,
  viewDirection : vec3f,
  lightDirection : vec3f,
  material : vec4f,
  radiance : vec3f
) -> vec3f {
  let nDotL = max(dot(normal, lightDirection), 0.0);
  let nDotV = max(dot(normal, viewDirection), 0.0);
  if (nDotL == 0.0 || nDotV == 0.0) {
    return vec3f(0.0);
  }
  let halfVector = normalize(lightDirection + viewDirection);
  let nDotH = max(dot(normal, halfVector), 0.0);
  let vDotH = max(dot(viewDirection, halfVector), 0.0);
  let roughness = material.y;
  let metallic = material.z;
  let alpha = roughness * roughness;
  let alphaSquared = alpha * alpha;
  let distributionDenominator = nDotH * nDotH * (alphaSquared - 1.0) + 1.0;
  let distribution = alphaSquared
    / (3.14159265 * distributionDenominator * distributionDenominator);
  let geometryK = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  let geometryView = nDotV / (nDotV * (1.0 - geometryK) + geometryK);
  let geometryLight = nDotL / (nDotL * (1.0 - geometryK) + geometryK);
  let geometry = geometryView * geometryLight;
  let dielectricF0 = vec3f(0.04 * material.x);
  let f0 = mix(dielectricF0, albedo, metallic);
  let fresnel = f0 + (vec3f(1.0) - f0) * schlickWeight(vDotH);
  let specularBrdf = distribution * geometry * fresnel / (4.0 * nDotV * nDotL);
  let diffuseBrdf = (vec3f(1.0) - fresnel) * (1.0 - metallic)
    * albedo / 3.14159265;
  return (diffuseBrdf + specularBrdf) * radiance * nDotL;
}

// pointは全方向へ1、coneは光が進む方向とlight-to-surface方向の角度で減衰します
// innerCos > outerCosはCPU側で保証し、cone境界だけをsmoothstepで連続にします
fn evaluateLocalLightAngularAttenuation(
  light : LocalLight,
  lightToSurface : vec3f
) -> f32 {
  if (light.outerCosAndType.y < 0.5) {
    return 1.0;
  }
  let coneCos = dot(light.directionInnerCos.xyz, lightToSurface);
  return smoothstep(
    light.outerCosAndType.x,
    light.directionInnerCos.w,
    coneCos
  );
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dimsU = textureDimensions(albedoTexture);
  if (id.x >= dimsU.x || id.y >= dimsU.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let dims = vec2<i32>(dimsU);
  let albedo = textureLoad(albedoTexture, coord, 0);
  let material = textureLoad(materialTexture, coord, 0);
  let depth = textureLoad(depthTexture, coord, 0);
  let mode = i32(round(params.control.y));

  if (isGBufferBackgroundDepth(depth)) {
    // geometryがないpixelはG-bufferのalbedo clear値を背景色として引き継ぐ。
    // DeferredLightingPassが固定色を決めず、renderScene()へclearColorを渡したアプリに
    // 背景の所有権を残しつつ、位置復元とlight評価は背景depthで早期終了する。
    textureStore(outputTexture, coord, vec4f(albedo.rgb, 1.0));
    return;
  }

  let normal = decodeGBufferNormal(textureLoad(normalTexture, coord, 0).rgb);
  if (mode == 1) {
    textureStore(outputTexture, coord, vec4f(albedo.rgb, 1.0));
    return;
  }
  if (mode == 2) {
    textureStore(outputTexture, coord, vec4f(normal * 0.5 + vec3f(0.5), 1.0));
    return;
  }
  if (mode == 3) {
    // Reverse-Zのraw depthはnearで1、遠方ほど0へ近づくため、finite/infinite farで同じ表示になる
    textureStore(outputTexture, coord, vec4f(vec3f(depth), 1.0));
    return;
  }
  let shadowVisibility = textureLoad(shadowVisibilityTexture, coord, 0).r;
  let spotShadowVisibility = textureLoad(spotShadowVisibilityTexture, coord, 0).r;
  let ambientOcclusion = textureLoad(ambientOcclusionTexture, coord, 0).r;
  if (mode == 4) {
    textureStore(outputTexture, coord, vec4f(vec3f(shadowVisibility), 1.0));
    return;
  }
  if (mode == 5) {
    textureStore(outputTexture, coord, vec4f(vec3f(spotShadowVisibility), 1.0));
    return;
  }
  if (mode == 6) {
    textureStore(outputTexture, coord, vec4f(vec3f(ambientOcclusion), 1.0));
    return;
  }
  if (mode == 7) {
    textureStore(outputTexture, coord, vec4f(vec3f(material.x), 1.0));
    return;
  }
  if (mode == 8) {
    textureStore(outputTexture, coord, vec4f(vec3f(material.y), 1.0));
    return;
  }
  if (mode == 9) {
    textureStore(outputTexture, coord, vec4f(vec3f(material.z), 1.0));
    return;
  }
  if (mode == 10) {
    textureStore(outputTexture, coord, vec4f(vec3f(material.w), 1.0));
    return;
  }

  let position = reconstructGBufferViewPosition(coord, depth, dims, params.projection);
  let viewDirection = normalize(-position);
  let lightCount = u32(clamp(params.control.x, 0.0, ${checkedMaxLights}.0));
  // 拡散アンビエントはShadow MapやContact Shadowで遮らず、SSAOと材質のenergy配分を適用します。
  // emissiveは環境遮蔽やmetallicに依存しないため、ambientとは分けて一度だけ加算します。
  let ambientDiffuse = evaluateAmbientDiffuse(
    albedo.rgb,
    normal,
    viewDirection,
    material,
    params.directionalColorAmbient.w,
    ambientOcclusion
  );
  var lighting = ambientDiffuse + albedo.rgb * material.w;

  if (params.control.z >= 0.5) {
    let surfaceToLight = normalize(-params.directionalDirectionIntensity.xyz);
    let radiance = params.directionalColorAmbient.rgb
      * params.directionalDirectionIntensity.w;
    lighting += evaluateDirectBrdf(
      albedo.rgb,
      normal,
      viewDirection,
      surfaceToLight,
      material,
      radiance
    ) * shadowVisibility;
  }

  if (params.control.w >= 0.5) {
    let lightVector = params.spotPositionRadius.xyz - position;
    let distance = length(lightVector);
    let radius = params.spotPositionRadius.w;
    if (distance < radius && distance > 0.0001) {
      let surfaceToLight = lightVector / distance;
      let lightToSurface = -surfaceToLight;
      let spotCos = dot(normalize(params.spotDirectionIntensity.xyz), lightToSurface);
      let innerCos = params.spotColorInner.w;
      let outerCos = params.spotCone.x;
      let cone = clamp((spotCos - outerCos) / (innerCos - outerCos), 0.0, 1.0);
      let attenuation = pow(max(1.0 - distance / radius, 0.0), 2.0);
      let radiance = params.spotColorInner.rgb
        * params.spotDirectionIntensity.w
        * attenuation
        * cone;
      // coneはライト形状、visibilityは遮蔽物として別々に一度だけ評価する
      lighting += evaluateDirectBrdf(
        albedo.rgb,
        normal,
        viewDirection,
        surfaceToLight,
        material,
        radiance
      ) * spotShadowVisibility;
    }
  }

  // 単純化のためpixelごとに全Local Lightを走査し、距離と放射角の減衰を一度だけ適用します
  for (var i = 0u; i < ${checkedMaxLights}u; i += 1u) {
    if (i < lightCount) {
      let light = lights[i];
      let delta = light.positionRadius.xyz - position;
      let distance = length(delta);
      let radius = light.positionRadius.w;
      if (distance < radius && distance > 0.0001) {
        let surfaceToLight = delta / distance;
        let lightToSurface = -surfaceToLight;
        let angularAttenuation = evaluateLocalLightAngularAttenuation(
          light,
          lightToSurface
        );
        // cone外ではGGXの高コストなBRDF評価を行わず、放射形状の追加負荷を抑えます
        if (angularAttenuation > 0.0) {
          let distanceAttenuation = pow(max(1.0 - distance / radius, 0.0), 2.0);
          let radiance = light.colorIntensity.rgb
            * light.colorIntensity.w
            * distanceAttenuation
            * angularAttenuation;
          lighting += evaluateDirectBrdf(
            albedo.rgb,
            normal,
            viewDirection,
            surfaceToLight,
            material,
            radiance
          );
        }
      }
    }
  }

  // ここではtone mappingもdisplay gamma変換も行わず、線形照明値をそのまま保持する
  // 最終表示変換を一度だけ行うことで、SSRなど後続effectが物理的な輝度を読めるようにする
  textureStore(outputTexture, coord, vec4f(lighting, 1.0));
}`;
}

// G-bufferを読む多数ライト評価を1クラスへまとめ、uniform、light buffer、出力targetを管理する
// Scene更新、Geometry Pass、canvasへのcopyはアプリケーション側へ残し、責務をlightingだけへ絞る
export default class DeferredLightingPass {
  // 出力サイズ、最大light数、内部ComputePassを確定し、毎frame使うGPU resourceを先に作る
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("DeferredLightingPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "DeferredLightingPass label",
      "deferred-lighting",
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
      DEFERRED_LIGHTING_OUTPUT_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== DEFERRED_LIGHTING_OUTPUT_FORMAT) {
      throw new Error(
        `${this.label} format must be ${DEFERRED_LIGHTING_OUTPUT_FORMAT}`
      );
    }
    this.maxLights = util.readOptionalInteger(
      options.maxLights,
      `${this.label} maxLights`,
      DEFERRED_LIGHTING_DEFAULTS.maxLights,
      { min: 1 }
    );
    this.targetFactory = options.targetFactory ?? new StorageTargetFactory(gpu, {
      label: `${this.label}:storage`,
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
    this.lightData = new Float32Array(
      this.maxLights * DEFERRED_LOCAL_LIGHT_STRIDE_FLOATS
    );
    this.lightBuffer = gpu.device.createBuffer({
      label: `${this.label}:lights`,
      size: this.lightData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.computePass = new ComputePass(gpu, {
      label: this.label,
      code: buildDeferredLightingWgsl(this.maxLights),
      uniformFloats: 32,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "albedo", type: "sampled-texture" },
        { binding: 2, name: "normal", type: "sampled-texture" },
        { binding: 3, name: "depth", type: "depth-texture" },
        { binding: 4, name: "material", type: "sampled-texture" },
        { binding: 5, name: "lights", type: "read-only-storage-buffer" },
        { binding: 6, name: "shadowVisibility", type: "sampled-texture" },
        { binding: 7, name: "spotShadowVisibility", type: "sampled-texture" },
        { binding: 8, name: "ambientOcclusion", type: "sampled-texture" },
        {
          binding: 9,
          name: "output",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        }
      ]
    });
    this.ready = Promise.all([this.outputTarget.ready]);
    this.destroyed = false;
  }

  // encode前に共通resourceが生きているかを確認し、destroy後の誤使用を早い段階で止める
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  // G-buffer生成時と同じCamera Frameから投影paramとlight用view-space変換を取得する
  // projection配列とview matrixを別々に受け取らず、一frame内で異なるカメラ状態が混ざる余地をなくす
  validateCameraFrame(cameraFrame) {
    const projection = createGBufferProjectionParams(cameraFrame);
    if (typeof cameraFrame.worldPointToView !== "function") {
      throw new Error(`${this.label} cameraFrame must provide worldPointToView(point)`);
    }
    return { cameraFrame, projection };
  }

  // G-buffer resourceはalbedo、normal、depthが揃って初めてlighting評価できるため、必要resourceを明示する
  validateResources(resources) {
    const checked = util.readPlainObject(resources, `${this.label} resources`);
    const albedo = checked.albedo ?? checked.color;
    const normal = checked.normal;
    const depth = checked.depth;
    const material = checked.material;
    const shadowVisibility = checked.shadowVisibility;
    const spotShadowVisibility = checked.spotShadowVisibility;
    const ambientOcclusion = checked.ambientOcclusion;
    if (!albedo || typeof albedo.getView !== "function") {
      throw new Error(`${this.label} resources require albedo or color target`);
    }
    if (!normal || typeof normal.getView !== "function") {
      throw new Error(`${this.label} resources require normal target`);
    }
    if (!material || typeof material.getView !== "function") {
      throw new Error(`${this.label} resources require material target`);
    }
    if (
      !depth ||
      (
        typeof depth.getDepthSampleView !== "function" &&
        typeof depth.getDepthView !== "function"
      )
    ) {
      throw new Error(`${this.label} resources require depth target`);
    }
    if (depth.depthConvention !== CAMERA_REVERSE_Z) {
      throw new Error(`${this.label} depth target must use CAMERA_REVERSE_Z`);
    }
    if (!shadowVisibility || typeof shadowVisibility.getView !== "function") {
      throw new Error(`${this.label} resources require shadowVisibility target`);
    }
    if (!spotShadowVisibility || typeof spotShadowVisibility.getView !== "function") {
      throw new Error(`${this.label} resources require spotShadowVisibility target`);
    }
    if (!ambientOcclusion || typeof ambientOcclusion.getView !== "function") {
      throw new Error(`${this.label} resources require ambientOcclusion target`);
    }
    const width = util.readFiniteNumber(
      albedo.getWidth?.() ?? this.outputTarget.getWidth(),
      `${this.label} albedo width`,
      { integer: true, min: 1 }
    );
    const height = util.readFiniteNumber(
      albedo.getHeight?.() ?? this.outputTarget.getHeight(),
      `${this.label} albedo height`,
      { integer: true, min: 1 }
    );
    if (width !== this.outputTarget.getWidth() || height !== this.outputTarget.getHeight()) {
      throw new Error(
        `${this.label} G-buffer size ${width}x${height} does not match output size `
        + `${this.outputTarget.getWidth()}x${this.outputTarget.getHeight()}`
      );
    }
    const materialWidth = material.getWidth?.();
    const materialHeight = material.getHeight?.();
    if (materialWidth !== width || materialHeight !== height) {
      throw new Error(
        `${this.label} material size ${materialWidth}x${materialHeight} `
        + `does not match G-buffer size ${width}x${height}`
      );
    }
    const shadowWidth = shadowVisibility.getWidth?.();
    const shadowHeight = shadowVisibility.getHeight?.();
    if (shadowWidth !== width || shadowHeight !== height) {
      throw new Error(
        `${this.label} shadowVisibility size ${shadowWidth}x${shadowHeight} `
        + `does not match G-buffer size ${width}x${height}`
      );
    }
    const spotShadowWidth = spotShadowVisibility.getWidth?.();
    const spotShadowHeight = spotShadowVisibility.getHeight?.();
    if (spotShadowWidth !== width || spotShadowHeight !== height) {
      throw new Error(
        `${this.label} spotShadowVisibility size ${spotShadowWidth}x${spotShadowHeight} `
        + `does not match G-buffer size ${width}x${height}`
      );
    }
    const aoWidth = ambientOcclusion.getWidth?.();
    const aoHeight = ambientOcclusion.getHeight?.();
    if (aoWidth !== width || aoHeight !== height) {
      throw new Error(
        `${this.label} ambientOcclusion size ${aoWidth}x${aoHeight} `
        + `does not match G-buffer size ${width}x${height}`
      );
    }
    return {
      albedo,
      normal,
      depth,
      material,
      shadowVisibility,
      spotShadowVisibility,
      ambientOcclusion
    };
  }

  // 主要directional lightを検証し、World方向をCamera Frameのview-spaceへ回転します
  // nullはdirectional lightなしを明示し、option自体の省略は旧point-only呼び出しとして拒否します
  validateDirectionalLight(cameraFrame, directionalLight) {
    if (directionalLight === null) {
      return {
        enabled: false,
        direction: [0.0, 0.0, -1.0],
        color: [0.0, 0.0, 0.0],
        intensity: 0.0
      };
    }
    const light = util.readPlainObject(
      directionalLight,
      `${this.label} directionalLight`
    );
    const direction = util.readColor(
      light.direction,
      `${this.label} directionalLight.direction`,
      undefined,
      3
    );
    const length = Math.hypot(...direction);
    if (length <= 1.0e-8) {
      throw new Error(`${this.label} directionalLight.direction has zero length`);
    }
    const normalized = direction.map((value) => value / length);
    const viewDirection = cameraFrame.viewRotationMatrix.mul3x3Vector(normalized);
    return {
      enabled: true,
      direction: viewDirection,
      color: util.readColor(
        light.color,
        `${this.label} directionalLight.color`,
        undefined,
        3
      ),
      intensity: util.readFiniteNumber(
        light.intensity,
        `${this.label} directionalLight.intensity`,
        { min: 0.0 }
      )
    };
  }

  // spot lightのWorld位置と方向をCamera Frameでview-spaceへ変換し、coneと距離範囲を検証します
  // cone減衰は照明形状、spotShadowVisibilityは遮蔽物としてshader内で別々に評価します
  validateSpotLight(cameraFrame, spotLight) {
    if (spotLight === null) {
      return {
        enabled: false,
        position: [0.0, 0.0, 0.0],
        direction: [0.0, 0.0, -1.0],
        color: [0.0, 0.0, 0.0],
        radius: 1.0,
        intensity: 0.0,
        innerCos: 1.0,
        outerCos: 0.0
      };
    }
    const light = util.readPlainObject(spotLight, `${this.label} spotLight`);
    const position = util.readColor(
      light.position,
      `${this.label} spotLight.position`,
      undefined,
      3
    );
    const direction = util.readColor(
      light.direction,
      `${this.label} spotLight.direction`,
      undefined,
      3
    );
    const directionLength = Math.hypot(...direction);
    if (directionLength <= 1.0e-8) {
      throw new Error(`${this.label} spotLight.direction has zero length`);
    }
    const innerCos = util.readFiniteNumber(
      light.innerCos,
      `${this.label} spotLight.innerCos`,
      { min: -1.0, max: 1.0 }
    );
    const outerCos = util.readFiniteNumber(
      light.outerCos,
      `${this.label} spotLight.outerCos`,
      { min: -1.0, max: 1.0 }
    );
    if (innerCos <= outerCos) {
      throw new Error(`${this.label} spotLight.innerCos must be greater than outerCos`);
    }
    const normalizedDirection = direction.map((value) => value / directionLength);
    return {
      enabled: true,
      position: cameraFrame.worldPointToView(position),
      direction: cameraFrame.viewRotationMatrix.mul3x3Vector(normalizedDirection),
      color: util.readColor(
        light.color,
        `${this.label} spotLight.color`,
        undefined,
        3
      ),
      radius: util.readFiniteNumber(
        light.radius,
        `${this.label} spotLight.radius`,
        { minExclusive: 0.0 }
      ),
      intensity: util.readFiniteNumber(
        light.intensity,
        `${this.label} spotLight.intensity`,
        { min: 0.0 }
      ),
      innerCos,
      outerCos
    };
  }

  // Local Lightの公開入力を検証し、GPUへ書き込むview-spaceデータへ一度だけ正規化します
  // coneの不足fieldをpointに置き換えず、入力作成側の誤りをencode時点で停止します
  validateLights(cameraFrame, lights, lightCount) {
    if (!Array.isArray(lights)) {
      throw new Error(`${this.label} lights must be an array`);
    }
    const count = util.readOptionalInteger(
      lightCount,
      `${this.label} lightCount`,
      lights.length,
      { min: 0, max: this.maxLights }
    );
    if (count > lights.length) {
      throw new Error(`${this.label} lightCount exceeds lights.length`);
    }
    const checkedLights = [];
    for (let index = 0; index < count; index += 1) {
      const prefix = `${this.label} lights[${index}]`;
      const light = util.readPlainObject(lights[index], `${this.label} lights[${index}]`);
      if (light.type === undefined) {
        throw new Error(`${prefix}.type is required`);
      }
      const type = util.readOptionalEnum(
        light.type,
        `${prefix}.type`,
        undefined,
        DEFERRED_LOCAL_LIGHT_TYPES
      );
      const worldPosition = util.readVec3(light.position, `${prefix}.position`);
      const color = util.readColor(light.color, `${prefix}.color`, undefined, 3);
      const radius = util.readFiniteNumber(light.radius, `${prefix}.radius`, {
        minExclusive: 0
      });
      const intensity = util.readFiniteNumber(light.intensity, `${prefix}.intensity`, {
        min: 0
      });
      const position = util.readVec3(
        cameraFrame.worldPointToView(worldPosition),
        `${prefix} view-space position`
      );

      let direction = [0.0, 0.0, -1.0];
      let innerCos = 1.0;
      let outerCos = 0.0;
      if (type === "cone") {
        const worldDirection = util.readVec3(light.direction, `${prefix}.direction`);
        const worldDirectionLength = Math.hypot(...worldDirection);
        if (worldDirectionLength <= 1.0e-8) {
          throw new Error(`${prefix}.direction has zero length`);
        }
        const innerAngle = util.readFiniteNumber(
          light.innerAngle,
          `${prefix}.innerAngle`,
          { minExclusive: 0.0, max: 90.0 }
        );
        const outerAngle = util.readFiniteNumber(
          light.outerAngle,
          `${prefix}.outerAngle`,
          { minExclusive: 0.0, max: 90.0 }
        );
        if (innerAngle >= outerAngle) {
          throw new Error(`${prefix}.innerAngle must be less than outerAngle`);
        }
        const normalizedWorldDirection = worldDirection.map(
          (value) => value / worldDirectionLength
        );
        const rotatedDirection = util.readVec3(
          cameraFrame.viewRotationMatrix.mul3x3Vector(normalizedWorldDirection),
          `${prefix} view-space direction`
        );
        const rotatedDirectionLength = Math.hypot(...rotatedDirection);
        if (rotatedDirectionLength <= 1.0e-8) {
          throw new Error(`${prefix} view-space direction has zero length`);
        }
        direction = rotatedDirection.map((value) => value / rotatedDirectionLength);
        innerCos = Math.cos(innerAngle * Math.PI / 180.0);
        outerCos = Math.cos(outerAngle * Math.PI / 180.0);
      }

      checkedLights.push({
        type,
        typeId: DEFERRED_LOCAL_LIGHT_TYPE_IDS[type],
        position,
        color,
        radius,
        intensity,
        direction,
        innerCos,
        outerCos
      });
    }
    return checkedLights;
  }

  // light配列をview-spaceのGPU storage bufferへ詰め替え、view mode込みでlighting dispatchを記録する
  encode(commandEncoder, resources, options = {}) {
    this.requireAlive();
    const checkedResources = this.validateResources(resources);
    const { cameraFrame, projection } = this.validateCameraFrame(options.cameraFrame);
    if (!Object.prototype.hasOwnProperty.call(options, "directionalLight")) {
      throw new Error(`${this.label} directionalLight option is required; use null for none`);
    }
    const directional = this.validateDirectionalLight(
      cameraFrame,
      options.directionalLight
    );
    if (!Object.prototype.hasOwnProperty.call(options, "spotLight")) {
      throw new Error(`${this.label} spotLight option is required; use null for none`);
    }
    const spot = this.validateSpotLight(cameraFrame, options.spotLight);
    const ambient = util.readOptionalFiniteNumber(
      options.ambient,
      `${this.label} ambient`,
      DEFERRED_LIGHTING_DEFAULTS.ambient,
      { min: 0.0, max: 1.0 }
    );
    const view = util.readOptionalEnum(
      options.view,
      `${this.label} view`,
      DEFERRED_LIGHTING_DEFAULTS.view,
      DEFERRED_LIGHTING_VIEW_MODES
    );
    const localLights = this.validateLights(
      cameraFrame,
      options.lights,
      options.lightCount
    );
    const lightCount = localLights.length;

    this.lightData.fill(0.0);
    for (let index = 0; index < lightCount; index += 1) {
      const light = localLights[index];
      const offset = index * DEFERRED_LOCAL_LIGHT_STRIDE_FLOATS;
      this.lightData.set([
        light.position[0],
        light.position[1],
        light.position[2],
        light.radius
      ], offset);
      this.lightData.set([
        light.color[0],
        light.color[1],
        light.color[2],
        light.intensity
      ], offset + 4);
      this.lightData.set([
        light.direction[0],
        light.direction[1],
        light.direction[2],
        light.innerCos
      ], offset + 8);
      this.lightData.set([
        light.outerCos,
        light.typeId,
        0.0,
        0.0
      ], offset + 12);
    }
    this.gpu.queue.writeBuffer(this.lightBuffer, 0, this.lightData);

    const viewMode = view === "albedo" ? 1.0
      : view === "normal" ? 2.0
        : view === "depth" ? 3.0
          : view === "shadow" ? 4.0
            : view === "spotShadow" ? 5.0
              : view === "ao" ? 6.0
                : view === "specular" ? 7.0
                  : view === "roughness" ? 8.0
                    : view === "metallic" ? 9.0
                      : view === "emissive" ? 10.0
                        : 0.0;
    this.computePass.setUniforms([
      ...projection,
      lightCount,
      viewMode,
      directional.enabled ? 1.0 : 0.0,
      spot.enabled ? 1.0 : 0.0,
      directional.direction[0],
      directional.direction[1],
      directional.direction[2],
      directional.intensity,
      directional.color[0],
      directional.color[1],
      directional.color[2],
      ambient,
      spot.position[0],
      spot.position[1],
      spot.position[2],
      spot.radius,
      spot.direction[0],
      spot.direction[1],
      spot.direction[2],
      spot.intensity,
      spot.color[0],
      spot.color[1],
      spot.color[2],
      spot.innerCos,
      spot.outerCos,
      0.0,
      0.0,
      0.0
    ]);
    this.computePass.encode(commandEncoder, {
      albedo: checkedResources.albedo,
      normal: checkedResources.normal,
      depth: checkedResources.depth,
      material: checkedResources.material,
      lights: this.lightBuffer,
      shadowVisibility: checkedResources.shadowVisibility,
      spotShadowVisibility: checkedResources.spotShadowVisibility,
      ambientOcclusion: checkedResources.ambientOcclusion,
      output: this.outputTarget
    }, {
      timestampWrites: options.timestampWrites
    });
    return this.outputTarget;
  }

  // 外部のscreen resizeに追従してlighting結果のStorageTargetだけを更新する
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
    return resizeTarget(this.outputTarget, this.width, this.height);
  }

  // fullscreen copyやdebug表示で使うlighting結果のtargetを外部へ返す
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // 内部ComputePass、storage buffer、output targetをまとめて解放し、二重解放も吸収する
  destroy() {
    if (this.destroyed) {
      return false;
    }
    this.computePass.destroy();
    this.lightBuffer.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
