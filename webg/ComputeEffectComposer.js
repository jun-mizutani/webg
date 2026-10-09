// ---------------------------------------------
// ComputeEffectComposer.js  2026/08/04
//   Linear High Dynamic Range reflection compositor
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import {
  createGBufferProjectionParams,
  GBUFFER_WGSL_COMMON
} from "./GeometryBufferPass.js";
import { PBR_BRDF_WGSL, PBR_IBL_WGSL } from "./PbrBrdf.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const COMPUTE_EFFECT_COMPOSER_MODES = Object.freeze([
  "add",
  "mix",
  "pbr-ssr"
]);

export const COMPUTE_EFFECT_COMPOSER_FORMAT = "rgba16float";

export const COMPUTE_EFFECT_COMPOSER_WGSL = `
struct Params {
  // control.x = 0:add、1:mix、2:PBR SSR鏡面IBL置換
  control : vec4f,
  // Reverse-Z G-bufferと同じnear、far、tan(vfov/2)、aspect
  projection : vec4f,
};

${GBUFFER_WGSL_COMMON}

${PBR_BRDF_WGSL}

${PBR_IBL_WGSL}

const PBR_SSR_MIN_HIT_LUMINANCE : f32 = 0.00001;

// 黒いSSR sampleをIBL置換へ渡さず、現在pixelのベース画を維持します
fn pbrSsrHasUsableRadiance(radiance : vec3f) -> bool {
  let nonNegative = max(radiance, vec3f(0.0));
  let luminance = dot(nonNegative, vec3f(0.2126, 0.7152, 0.0722));
  return luminance > PBR_SSR_MIN_HIT_LUMINANCE;
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var baseTexture : texture_2d<f32>;
@group(0) @binding(2) var reflectionTexture : texture_2d<f32>;
@group(0) @binding(3) var depthTexture : texture_depth_2d;
@group(0) @binding(4) var specularIblTexture : texture_2d<f32>;
@group(0) @binding(5) var albedoTexture : texture_2d<f32>;
@group(0) @binding(6) var normalTexture : texture_2d<f32>;
@group(0) @binding(7) var materialTexture : texture_2d<f32>;
@group(0) @binding(8) var ambientOcclusionTexture : texture_2d<f32>;
@group(0) @binding(9) var brdfLutTexture : texture_2d<f32>;
@group(0) @binding(10) var brdfSampler : sampler;
@group(0) @binding(11) var outputTexture : texture_storage_2d<${COMPUTE_EFFECT_COMPOSER_FORMAT}, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dims = textureDimensions(outputTexture);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let reflectionDims = textureDimensions(reflectionTexture);
  let base = textureLoad(baseTexture, coord, 0).rgb;
  let depth = textureLoad(depthTexture, coord, 0);
  let reflectionUv = (vec2f(coord) + vec2f(0.5)) / vec2f(dims);
  let reflectionCoord = clamp(
    vec2<i32>(reflectionUv * vec2f(reflectionDims)),
    vec2<i32>(0),
    vec2<i32>(reflectionDims) - vec2<i32>(1)
  );
  let reflection = textureLoad(reflectionTexture, reflectionCoord, 0);
  var linearColor = base;
  if (!isGBufferBackgroundDepth(depth)) {
    let reflectionWeight = clamp(reflection.a, 0.0, 1.0);
    if (i32(params.control.x) == 2) {
      // SSR missと画面端はconfidence 0となり、baseに既に含まれる同一HDRの鏡面IBLをそのまま保ちます
      // control.yの利用者指定強度はray hit confidenceと分離し、置換量だけを調整します
      let reflectionIsUsable = pbrSsrHasUsableRadiance(reflection.rgb);
      let confidence = select(
        0.0,
        clamp(reflectionWeight * params.control.y, 0.0, 1.0),
        reflectionIsUsable
      );
      let albedo = textureLoad(albedoTexture, coord, 0).rgb;
      let normal = decodeGBufferNormal(textureLoad(normalTexture, coord, 0).rgb);
      let material = textureLoad(materialTexture, coord, 0);
      let ambientOcclusion = textureLoad(ambientOcclusionTexture, coord, 0).r
        * material.w;
      let position = reconstructGBufferViewPosition(
        coord,
        depth,
        vec2<i32>(dims),
        params.projection
      );
      let viewDirection = normalize(-position);
      let nDotV = max(dot(normal, viewDirection), 0.0);
      let roughness = material.y;
      let dielectricF0 = vec3f(0.04 * material.x);
      let f0 = pbrEvaluateF0(albedo, material.z, dielectricF0);
      let brdf = textureSampleLevel(
        brdfLutTexture,
        brdfSampler,
        pbrClampBrdfLutUv(
          vec2f(nDotV, roughness),
          textureDimensions(brdfLutTexture)
        ),
        0.0
      ).rg;
      let pbrSpecularWeight = pbrEvaluateSpecularIblWeight(
        f0,
        brdf,
        ambientOcclusion
      );
      let specularIbl = textureLoad(specularIblTexture, coord, 0).rgb;
      let ssrSpecular = reflection.rgb * pbrSpecularWeight;
      // IBLを一度分離してSSRへ置換し、置換不可のpixelは元のbaseを保ちます
      let baseWithoutSpecularIbl = max(base - specularIbl, vec3f(0.0));
      let replacedColor = baseWithoutSpecularIbl + ssrSpecular;
      linearColor = mix(base, replacedColor, confidence);
    } else if (i32(params.control.x) == 1) {
      linearColor = mix(base, reflection.rgb, reflectionWeight);
    } else {
      linearColor = base + reflection.rgb * reflectionWeight;
    }
  }
  // Tone Map前の輝度を保持するため、合成後の0から1 clampを行わない
  textureStore(outputTexture, coord, vec4f(linearColor, 1.0));
}`;

export default class ComputeEffectComposer {
  // Tone Map前の線形High Dynamic Range合成targetとComputePassを初期化する
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeEffectComposer requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "ComputeEffectComposer label",
      "compute-effect:composer",
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(options.width, `${this.label} width`, 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, `${this.label} height`, 1, { min: 1 });
    this.format = util.readOptionalString(
      options.format,
      `${this.label} format`,
      COMPUTE_EFFECT_COMPOSER_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== COMPUTE_EFFECT_COMPOSER_FORMAT) {
      throw new Error(`${this.label} format must be ${COMPUTE_EFFECT_COMPOSER_FORMAT}`);
    }
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
    // legacy add／mixでも固定pipeline layoutを満たすため、PBR専用bindingの零textureを用意します
    this.emptyColorTexture = gpu.device.createTexture({
      label: `${this.label}:empty-color`,
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING
    });
    this.emptyBrdfLutTexture = gpu.device.createTexture({
      label: `${this.label}:empty-brdf-lut`,
      size: [1, 1, 1],
      format: "rg16float",
      usage: GPUTextureUsage.TEXTURE_BINDING
    });
    this.emptySampler = gpu.device.createSampler({
      magFilter: "linear",
      minFilter: "linear"
    });
    this.computePass = new ComputePass(gpu, {
      label: this.label,
      code: COMPUTE_EFFECT_COMPOSER_WGSL,
      uniformFloats: 8,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "base", type: "sampled-texture" },
        { binding: 2, name: "reflection", type: "sampled-texture" },
        { binding: 3, name: "depth", type: "depth-texture" },
        { binding: 4, name: "specularIbl", type: "sampled-texture" },
        { binding: 5, name: "albedo", type: "sampled-texture" },
        { binding: 6, name: "normal", type: "sampled-texture" },
        { binding: 7, name: "material", type: "sampled-texture" },
        { binding: 8, name: "ambientOcclusion", type: "sampled-texture" },
        { binding: 9, name: "brdfLut", type: "sampled-texture" },
        { binding: 10, name: "brdfSampler", type: "sampler" },
        {
          binding: 11,
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

  // base、reflection、depthとPBR SSR置換に必要な材質resourceをmodeごとに検証する
  validateResources(resources, mode) {
    const base = resources?.base;
    const reflection = resources?.reflection;
    const depth = resources?.depth;
    for (const [name, target] of [["base", base], ["reflection", reflection]]) {
      if (!target || typeof target.getView !== "function") {
        throw new Error(`${this.label} resources require ${name} target`);
      }
      if (target.getFormat?.() !== COMPUTE_EFFECT_COMPOSER_FORMAT) {
        throw new Error(
          `${this.label} ${name} format must be ${COMPUTE_EFFECT_COMPOSER_FORMAT}`
        );
      }
    }
    if (
      typeof depth?.getDepthSampleView !== "function" ||
      depth.depthConvention !== CAMERA_REVERSE_Z
    ) {
      throw new Error(
        `${this.label} resources require CAMERA_REVERSE_Z depth target`
      );
    }
    for (const [name, target] of [["base", base], ["depth", depth]]) {
      const width = target.getWidth?.();
      const height = target.getHeight?.();
      if (width !== this.width || height !== this.height) {
        throw new Error(
          `${this.label} ${name} size ${width}x${height} does not match output size `
          + `${this.width}x${this.height}`
        );
      }
    }
    util.readFiniteNumber(
      reflection.getWidth?.(),
      `${this.label} reflection width`,
      { integer: true, min: 1 }
    );
    util.readFiniteNumber(
      reflection.getHeight?.(),
      `${this.label} reflection height`,
      { integer: true, min: 1 }
    );
    const fallbackView = this.emptyColorTexture.createView();
    const result = {
      base,
      reflection,
      depth,
      specularIbl: base,
      albedo: fallbackView,
      normal: fallbackView,
      material: fallbackView,
      ambientOcclusion: fallbackView,
      brdfLut: this.emptyBrdfLutTexture.createView(),
      brdfSampler: this.emptySampler
    };
    if (mode !== "pbr-ssr") return result;

    for (const name of [
      "specularIbl",
      "albedo",
      "normal",
      "material",
      "ambientOcclusion",
      "brdfLut"
    ]) {
      const target = resources[name];
      if (!target || typeof target.getView !== "function") {
        throw new Error(`${this.label} pbr-ssr resources require ${name} target`);
      }
      result[name] = target;
    }
    if (!resources.brdfSampler) {
      throw new Error(`${this.label} pbr-ssr resources require brdfSampler`);
    }
    result.brdfSampler = resources.brdfSampler;
    for (const name of ["specularIbl", "albedo", "normal", "material", "ambientOcclusion"]) {
      const target = resources[name];
      if (target.getWidth?.() !== this.width || target.getHeight?.() !== this.height) {
        throw new Error(`${this.label} pbr-ssr ${name} size must match output size`);
      }
    }
    return result;
  }

  // Deferred Lighting済みbaseとSSR反射を線形領域で合成して出力する
  encode(commandEncoder, resources, options = {}) {
    this.requireAlive();
    const mode = util.readOptionalEnum(
      options.mode,
      `${this.label} mode`,
      "mix",
      COMPUTE_EFFECT_COMPOSER_MODES
    );
    const checkedResources = this.validateResources(resources, mode);
    const projection = mode === "pbr-ssr"
      ? createGBufferProjectionParams(options.cameraFrame)
      : [0.1, 1000.0, 1.0, 1.0];
    const intensity = mode === "pbr-ssr"
      ? util.readFiniteNumber(options.intensity ?? 1.0, `${this.label} intensity`, {
          min: 0.0,
          max: 1.5
        })
      : 1.0;
    this.computePass.setUniforms(new Float32Array([
      mode === "pbr-ssr" ? 2 : mode === "mix" ? 1 : 0,
      intensity,
      0,
      0,
      ...projection
    ]));
    this.computePass.encode(commandEncoder, {
      base: checkedResources.base,
      reflection: checkedResources.reflection,
      depth: checkedResources.depth,
      specularIbl: checkedResources.specularIbl,
      albedo: checkedResources.albedo,
      normal: checkedResources.normal,
      material: checkedResources.material,
      ambientOcclusion: checkedResources.ambientOcclusion,
      brdfLut: checkedResources.brdfLut,
      brdfSampler: checkedResources.brdfSampler,
      output: this.outputTarget
    }, {
      timestampWrites: options.timestampWrites
    });
    return this.outputTarget;
  }

  // 画面サイズ変更に合わせて出力ターゲットをリサイズする
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

  // 最終合成結果の出力ターゲットを返す
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // 破棄済みインスタンスへの操作を防ぐ
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  // 所有しているGPUリソースを破棄する
  destroy() {
    if (this.destroyed) return false;
    this.computePass.destroy();
    this.emptyColorTexture.destroy();
    this.emptyBrdfLutTexture.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
