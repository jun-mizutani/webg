// ---------------------------------------------
// PbrEnvironmentCompute.js  2026/08/14
//   Compute Shader preprocessing for split-sum PBR environments
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import { float16BitsToFloat32 } from "./PbrEnvironment.js";
import {
  createPbrEnvironmentImportanceDistribution,
  readPbrEnvironmentPreprocessOptions
} from "./PbrEnvironmentReference.js";
import { validateRadianceHdrForEquirectangularIbl } from "./RadianceHdr.js";
import util from "./util.js";

const HALF_FLOAT_MAX = 65504.0;
const MAX_SAFE_SOURCE_RADIANCE = HALF_FLOAT_MAX / Math.PI;
const WORKGROUP_SIZE = [8, 8, 1];

// CPU参照と同じHammersley列、緯度経度方向、接線frame、GGX samplingを三つのCompute Shaderで共有します
// WGSL側の演算はf32なので、JavaScriptの倍精度計算とは半精度texture転送前にも小さい差が生じます
export const PBR_ENVIRONMENT_COMPUTE_COMMON_WGSL = `
const PI : f32 = 3.141592653589793;
const TWO_PI : f32 = 6.283185307179586;
const MIN_PBR_ROUGHNESS : f32 = 0.04;
const MIN_INTEGRATION_WEIGHT : f32 = 0.000001;

struct Params {
  sampleCount : f32,
  roughness : f32,
  reserved0 : f32,
  reserved1 : f32,
};

struct ImportanceAliasEntry {
  threshold : f32,
  aliasIndex : u32,
};

fn radicalInverseVdc(value : u32) -> f32 {
  var bits = value;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xaaaaaaaau) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xccccccccu) >> 2u);
  bits = ((bits & 0x0f0f0f0fu) << 4u) | ((bits & 0xf0f0f0f0u) >> 4u);
  bits = ((bits & 0x00ff00ffu) << 8u) | ((bits & 0xff00ff00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley(index : u32, count : u32) -> vec2f {
  return vec2f(f32(index) / f32(count), radicalInverseVdc(index));
}

fn environmentDirectionFromUv(uv : vec2f) -> vec3f {
  let longitude = (uv.x - 0.5) * TWO_PI;
  let latitude = uv.y * PI;
  let sinLatitude = sin(latitude);
  return vec3f(
    cos(longitude) * sinLatitude,
    cos(latitude),
    sin(longitude) * sinLatitude
  );
}

fn directionToUv(direction : vec3f) -> vec2f {
  let normalized = normalize(direction);
  return vec2f(
    atan2(normalized.z, normalized.x) / TWO_PI + 0.5,
    acos(clamp(normalized.y, -1.0, 1.0)) / PI
  );
}

fn tangentForNormal(normal : vec3f) -> vec3f {
  let helper = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(normal.y) < 0.999);
  return normalize(cross(helper, normal));
}

fn localToWorld(local : vec3f, normal : vec3f) -> vec3f {
  let tangent = tangentForNormal(normal);
  let bitangent = cross(normal, tangent);
  return normalize(tangent * local.x + bitangent * local.y + normal * local.z);
}

fn cosineHemisphere(samplePoint : vec2f) -> vec3f {
  let radius = sqrt(samplePoint.y);
  let phi = TWO_PI * samplePoint.x;
  return vec3f(
    cos(phi) * radius,
    sin(phi) * radius,
    sqrt(max(1.0 - samplePoint.y, 0.0))
  );
}

fn importanceSampleGgx(samplePoint : vec2f, roughness : f32) -> vec3f {
  let alpha = pow(max(roughness, MIN_PBR_ROUGHNESS), 2.0);
  let alphaSquared = alpha * alpha;
  let phi = TWO_PI * samplePoint.x;
  let cosTheta = sqrt(
    (1.0 - samplePoint.y) / (1.0 + (alphaSquared - 1.0) * samplePoint.y)
  );
  let sinTheta = sqrt(max(1.0 - cosTheta * cosTheta, 0.0));
  return vec3f(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
}
`;

// sourceをtextureLoadで4点読みし、CPU参照と同じU repeat、V clampのbilinear値を返します
const PBR_ENVIRONMENT_SOURCE_SAMPLING_WGSL = `
@group(0) @binding(3) var<storage, read> importanceAlias : array<ImportanceAliasEntry>;

fn wrapX(value : i32, width : i32) -> i32 {
  return ((value % width) + width) % width;
}

fn sampleEnvironment(sourceUv : vec2f) -> vec3f {
  let dims = textureDimensions(sourceTexture);
  let sourceX = fract(sourceUv.x) * f32(dims.x) - 0.5;
  let sourceY = clamp(sourceUv.y, 0.0, 1.0) * f32(dims.y) - 0.5;
  let x0Unwrapped = i32(floor(sourceX));
  let y0Unclamped = i32(floor(sourceY));
  let fraction = vec2f(sourceX - floor(sourceX), sourceY - floor(sourceY));
  let width = i32(dims.x);
  let height = i32(dims.y);
  let x0 = wrapX(x0Unwrapped, width);
  let x1 = wrapX(x0Unwrapped + 1, width);
  let y0 = clamp(y0Unclamped, 0, height - 1);
  let y1 = clamp(y0Unclamped + 1, 0, height - 1);
  let top = mix(
    textureLoad(sourceTexture, vec2i(x0, y0), 0).rgb,
    textureLoad(sourceTexture, vec2i(x1, y0), 0).rgb,
    fraction.x
  );
  let bottom = mix(
    textureLoad(sourceTexture, vec2i(x0, y1), 0).rgb,
    textureLoad(sourceTexture, vec2i(x1, y1), 0).rgb,
    fraction.x
  );
  return mix(top, bottom, fraction.y);
}

fn environmentPdf(direction : vec3f) -> f32 {
  let dims = textureDimensions(sourceTexture);
  let uv = directionToUv(direction);
  let x = min(u32(fract(uv.x) * f32(dims.x)), dims.x - 1u);
  let y = min(u32(clamp(uv.y, 0.0, 1.0) * f32(dims.y)), dims.y - 1u);
  return textureLoad(sourceTexture, vec2u(x, y), 0).a;
}

struct EnvironmentImportanceSample {
  direction : vec3f,
  radiance : vec3f,
  pdf : f32,
};

fn sampleEnvironmentImportance(samplePoint : vec2f) -> EnvironmentImportanceSample {
  let dims = textureDimensions(sourceTexture);
  let pixelCount = dims.x * dims.y;
  let column = min(u32(samplePoint.x * f32(pixelCount)), pixelCount - 1u);
  let entry = importanceAlias[column];
  let pixel = select(entry.aliasIndex, column, samplePoint.y < entry.threshold);
  let texel = vec2u(pixel % dims.x, pixel / dims.x);
  let value = textureLoad(sourceTexture, texel, 0);
  let uv = (vec2f(texel) + vec2f(0.5)) / vec2f(dims);
  return EnvironmentImportanceSample(environmentDirectionFromUv(uv), value.rgb, value.a);
}
`;

// cosine-weighted sampleの平均へπを掛け、法線方向ごとの拡散irradianceを書き込みます
export const PBR_ENVIRONMENT_DIFFUSE_COMPUTE_WGSL = `
${PBR_ENVIRONMENT_COMPUTE_COMMON_WGSL}
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sourceTexture : texture_2d<f32>;
@group(0) @binding(2) var outputTexture : texture_storage_2d<rgba16float, write>;
${PBR_ENVIRONMENT_SOURCE_SAMPLING_WGSL}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDims = textureDimensions(outputTexture);
  if (id.x >= outputDims.x || id.y >= outputDims.y) {
    return;
  }
  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(outputDims);
  let normal = environmentDirectionFromUv(uv);
  let sampleCount = u32(params.sampleCount);
  var radianceSum = vec3f(0.0);
  var weightSum = 0.0;
  for (var index = 0u; index < sampleCount; index += 1u) {
    let samplePoint = hammersley(index, sampleCount);
    let local = cosineHemisphere(samplePoint);
    let direction = localToWorld(local, normal);
    let normalDotDirection = max(dot(normal, direction), 0.0);
    let cosinePdf = normalDotDirection / PI;
    let proposalSum = cosinePdf + environmentPdf(direction);
    var misWeight = 0.0;
    if (proposalSum > 0.0) {
      misWeight = normalDotDirection / proposalSum;
    }
    radianceSum += sampleEnvironment(directionToUv(direction)) * misWeight;
    weightSum += misWeight;

    let environment = sampleEnvironmentImportance(samplePoint);
    let environmentCosine = max(dot(normal, environment.direction), 0.0);
    if (environmentCosine > 0.0) {
      let environmentCosinePdf = environmentCosine / PI;
      let environmentProposalSum = environment.pdf + environmentCosinePdf;
      var environmentMisWeight = 0.0;
      if (environmentProposalSum > 0.0) {
        environmentMisWeight = environmentCosine / environmentProposalSum;
      }
      radianceSum += environment.radiance * environmentMisWeight;
      weightSum += environmentMisWeight;
    }
  }
  if (weightSum > MIN_INTEGRATION_WEIGHT) {
    textureStore(
      outputTexture,
      vec2i(id.xy),
      vec4f(radianceSum * PI / weightSum, 1.0)
    );
  } else {
    textureStore(outputTexture, vec2i(id.xy), vec4f(0.0, 0.0, 0.0, 1.0));
  }
}
`;

// V=Nのsplit-sum条件でGGX half vectorを生成し、NdotL加重平均を一つのroughness levelへ書き込みます
export const PBR_ENVIRONMENT_SPECULAR_COMPUTE_WGSL = `
${PBR_ENVIRONMENT_COMPUTE_COMMON_WGSL}
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sourceTexture : texture_2d<f32>;
@group(0) @binding(2) var outputTexture : texture_storage_2d<rgba16float, write>;
${PBR_ENVIRONMENT_SOURCE_SAMPLING_WGSL}

fn ggxLightPdf(normal : vec3f, view : vec3f, light : vec3f, roughness : f32) -> f32 {
  let halfVectorRaw = view + light;
  let halfLength = length(halfVectorRaw);
  if (halfLength <= 0.0) {
    return 0.0;
  }
  let halfVector = halfVectorRaw / halfLength;
  let normalDotHalf = max(dot(normal, halfVector), 0.0);
  let viewDotHalf = max(dot(view, halfVector), 0.0);
  if (normalDotHalf <= 0.0 || viewDotHalf <= 0.0) {
    return 0.0;
  }
  let alpha = pow(max(roughness, MIN_PBR_ROUGHNESS), 2.0);
  let alphaSquared = alpha * alpha;
  let denominator = normalDotHalf * normalDotHalf * (alphaSquared - 1.0) + 1.0;
  let distribution = alphaSquared / (PI * denominator * denominator);
  return distribution * normalDotHalf / (4.0 * viewDotHalf);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDims = textureDimensions(outputTexture);
  if (id.x >= outputDims.x || id.y >= outputDims.y) {
    return;
  }
  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(outputDims);
  let normal = environmentDirectionFromUv(uv);
  let view = normal;
  let sampleCount = u32(params.sampleCount);
  var radianceSum = vec3f(0.0);
  var weightSum = 0.0;
  for (var index = 0u; index < sampleCount; index += 1u) {
    let samplePoint = hammersley(index, sampleCount);
    let localHalf = importanceSampleGgx(samplePoint, params.roughness);
    let halfVector = localToWorld(localHalf, normal);
    let viewDotHalf = max(dot(view, halfVector), 0.0);
    let light = 2.0 * viewDotHalf * halfVector - view;
    let normalDotLight = max(dot(normal, light), 0.0);
    if (normalDotLight > 0.0) {
      let ggxPdf = ggxLightPdf(normal, view, light, params.roughness);
      let targetWeight = ggxPdf * normalDotLight;
      let proposalSum = ggxPdf + environmentPdf(light);
      var misWeight = 0.0;
      if (proposalSum > 0.0) {
        misWeight = targetWeight / proposalSum;
      }
      radianceSum += sampleEnvironment(directionToUv(light)) * misWeight;
      weightSum += misWeight;
    }

    let environment = sampleEnvironmentImportance(samplePoint);
    let environmentNormalDotLight = max(dot(normal, environment.direction), 0.0);
    if (environmentNormalDotLight > 0.0) {
      let environmentGgxPdf = ggxLightPdf(
        normal,
        view,
        environment.direction,
        params.roughness
      );
      let targetWeight = environmentGgxPdf * environmentNormalDotLight;
      let proposalSum = environmentGgxPdf + environment.pdf;
      var misWeight = 0.0;
      if (proposalSum > 0.0) {
        misWeight = targetWeight / proposalSum;
      }
      radianceSum += environment.radiance * misWeight;
      weightSum += misWeight;
    }
  }
  if (weightSum > MIN_INTEGRATION_WEIGHT) {
    textureStore(
      outputTexture,
      vec2i(id.xy),
      vec4f(radianceSum / weightSum, 1.0)
    );
  } else {
    textureStore(outputTexture, vec2i(id.xy), vec4f(0.0, 0.0, 0.0, 1.0));
  }
}
`;

// NdotVとroughnessごとにFresnel scaleとbiasを積分し、split-sum BRDF LUTへ書き込みます
export const PBR_ENVIRONMENT_BRDF_COMPUTE_WGSL = `
${PBR_ENVIRONMENT_COMPUTE_COMMON_WGSL}
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var outputTexture : texture_storage_2d<rgba16float, write>;

fn geometrySchlickGgxIbl(normalDotDirection : f32, roughness : f32) -> f32 {
  let k = roughness * roughness * 0.5;
  return normalDotDirection / (normalDotDirection * (1.0 - k) + k);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDims = textureDimensions(outputTexture);
  if (id.x >= outputDims.x || id.y >= outputDims.y) {
    return;
  }
  let normalDotView = (f32(id.x) + 0.5) / f32(outputDims.x);
  let roughness = max((f32(id.y) + 0.5) / f32(outputDims.y), MIN_PBR_ROUGHNESS);
  let view = vec3f(sqrt(max(1.0 - normalDotView * normalDotView, 0.0)), 0.0, normalDotView);
  let sampleCount = u32(params.sampleCount);
  var scale = 0.0;
  var bias = 0.0;
  for (var index = 0u; index < sampleCount; index += 1u) {
    let halfVector = importanceSampleGgx(hammersley(index, sampleCount), roughness);
    let viewDotHalf = max(dot(view, halfVector), 0.0);
    let light = 2.0 * viewDotHalf * halfVector - view;
    let normalDotLight = max(light.z, 0.0);
    let normalDotHalf = max(halfVector.z, 0.0);
    if (normalDotLight > 0.0 && normalDotHalf > 0.0) {
      let geometry = geometrySchlickGgxIbl(normalDotView, roughness)
        * geometrySchlickGgxIbl(normalDotLight, roughness);
      let visibility = geometry * viewDotHalf / (normalDotHalf * normalDotView);
      let fresnelWeight = pow(1.0 - viewDotHalf, 5.0);
      scale += (1.0 - fresnelWeight) * visibility;
      bias += fresnelWeight * visibility;
    }
  }
  textureStore(
    outputTexture,
    vec2i(id.xy),
    vec4f(scale / f32(sampleCount), bias / f32(sampleCount), 0.0, 1.0)
  );
}
`;

// rgba32float sourceを256 byte pitchへ詰め、queue.writeTextureの行境界条件を満たします
function packSourceRows(source, distribution, label) {
  const rowBytes = source.width * 4 * Float32Array.BYTES_PER_ELEMENT;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  const rowFloats = bytesPerRow / Float32Array.BYTES_PER_ELEMENT;
  const packed = new Float32Array(rowFloats * source.height);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width * 4; x += 1) {
      const sourceIndex = y * source.width * 4 + x;
      const channel = x % 4;
      const value = channel === 3
        ? distribution.pdfSolidAngle[Math.floor(x / 4) + y * source.width]
        : util.readFiniteNumber(source.data[sourceIndex], `${label}.data[${sourceIndex}]`, {
          min: 0.0,
          max: MAX_SAFE_SOURCE_RADIANCE
        });
      packed[y * rowFloats + x] = value;
    }
  }
  return { packed, bytesPerRow };
}

// CPUで作ったalias tableをWGSLのf32 threshold／u32 aliasと同じ8 byte strideへ詰めます
function packImportanceAlias(distribution) {
  const buffer = new ArrayBuffer(distribution.pixelCount * 8);
  const view = new DataView(buffer);
  for (let pixel = 0; pixel < distribution.pixelCount; pixel += 1) {
    view.setFloat32(pixel * 8, distribution.thresholds[pixel], true);
    view.setUint32(pixel * 8 + 4, distribution.aliases[pixel], true);
  }
  return buffer;
}

// storage textureの一つのviewをComputePassとIBL resourceの共通形式で公開します
function makeTextureTarget(texture, view, width, height) {
  return {
    width,
    height,
    getWidth: () => width,
    getHeight: () => height,
    getView: () => view,
    texture
  };
}

// rgba16floatまたはrg16floatをMAP_READ可能なbufferへcopyし、CPU比較用Float32Arrayへ戻します
async function resolveReadback(device, descriptor) {
  await descriptor.buffer.mapAsync(GPUMapMode.READ);
  const packed = new Uint16Array(descriptor.buffer.getMappedRange());
  const result = new Float32Array(descriptor.width * descriptor.height * descriptor.channels);
  const packedRowValues = descriptor.bytesPerRow / Uint16Array.BYTES_PER_ELEMENT;
  for (let y = 0; y < descriptor.height; y += 1) {
    for (let x = 0; x < descriptor.width * descriptor.channels; x += 1) {
      result[y * descriptor.width * descriptor.channels + x] = float16BitsToFloat32(
        packed[y * packedRowValues + x]
      );
    }
  }
  descriptor.buffer.unmap();
  descriptor.buffer.destroy();
  return { width: descriptor.width, height: descriptor.height, data: result };
}

// CPU参照と同じ出力寸法、sample数、roughness規則で三つのIBL resourceをCompute Shader生成します
export default class PbrEnvironmentCompute {
  // 設定値をCPU参照の共通関数で検証し、出力textureと三種類のComputePassを準備します
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("PbrEnvironmentCompute requires a ready WebGPU context");
    }
    const checkedOptions = util.readPlainObject(options, "PbrEnvironmentCompute options");
    this.label = util.readOptionalString(
      checkedOptions.label,
      "PbrEnvironmentCompute label",
      "pbr-environment-compute",
      { trim: true, allowEmpty: false }
    );
    const preprocessOptions = { ...checkedOptions };
    delete preprocessOptions.label;
    this.settings = readPbrEnvironmentPreprocessOptions(preprocessOptions);
    this.gpu = gpu;
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.sourceTexture = null;
    this.sourceView = null;
    this.importanceAliasBuffer = null;
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.irradianceTexture = this.createOutputTexture(
      "irradiance",
      "rgba16float",
      this.settings.irradianceWidth,
      this.settings.irradianceHeight,
      1
    );
    this.specularTexture = this.createOutputTexture(
      "prefiltered-specular",
      "rgba16float",
      this.settings.specularWidth,
      this.settings.specularHeight,
      this.settings.specularMipCount
    );
    this.brdfLutTexture = this.createOutputTexture(
      "brdf-lut",
      "rgba16float",
      this.settings.brdfLutWidth,
      this.settings.brdfLutHeight,
      1
    );
    this.irradianceView = this.irradianceTexture.createView();
    this.specularView = this.specularTexture.createView();
    this.brdfLutView = this.brdfLutTexture.createView();
    this.irradianceTarget = makeTextureTarget(
      this.irradianceTexture,
      this.irradianceTexture.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
      this.settings.irradianceWidth,
      this.settings.irradianceHeight
    );
    this.specularTargets = [];
    let mipWidth = this.settings.specularWidth;
    let mipHeight = this.settings.specularHeight;
    for (let level = 0; level < this.settings.specularMipCount; level += 1) {
      this.specularTargets.push(makeTextureTarget(
        this.specularTexture,
        this.specularTexture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
        mipWidth,
        mipHeight
      ));
      mipWidth = Math.max(1, Math.floor(mipWidth / 2));
      mipHeight = Math.max(1, Math.floor(mipHeight / 2));
    }
    this.brdfLutTarget = makeTextureTarget(
      this.brdfLutTexture,
      this.brdfLutTexture.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
      this.settings.brdfLutWidth,
      this.settings.brdfLutHeight
    );
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge"
    });
    const sourceBindings = [
      { binding: 0, name: "params", type: "uniform-buffer" },
      { binding: 1, name: "source", type: "sampled-texture", sampleType: "unfilterable-float" },
      {
        binding: 2,
        name: "output",
        type: "storage-texture",
        format: "rgba16float",
        dispatchSize: true
      },
      { binding: 3, name: "importanceAlias", type: "read-only-storage-buffer" }
    ];
    this.diffusePass = new ComputePass(gpu, {
      label: `${this.label}:diffuse`,
      code: PBR_ENVIRONMENT_DIFFUSE_COMPUTE_WGSL,
      uniformFloats: 4,
      workgroupSize: WORKGROUP_SIZE,
      bindings: sourceBindings
    });
    this.specularPasses = this.specularTargets.map((_target, level) => {
      const pass = new ComputePass(gpu, {
        label: `${this.label}:specular-${level}`,
        code: PBR_ENVIRONMENT_SPECULAR_COMPUTE_WGSL,
        uniformFloats: 4,
        workgroupSize: WORKGROUP_SIZE,
        bindings: sourceBindings
      });
      const roughness = this.specularTargets.length === 1
        ? 0.04
        : level / (this.specularTargets.length - 1);
      pass.setUniforms([
        this.settings.specularSampleCount,
        roughness,
        0.0,
        0.0
      ]);
      return pass;
    });
    this.brdfPass = new ComputePass(gpu, {
      label: `${this.label}:brdf-lut`,
      code: PBR_ENVIRONMENT_BRDF_COMPUTE_WGSL,
      uniformFloats: 4,
      workgroupSize: WORKGROUP_SIZE,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        {
          binding: 1,
          name: "output",
          type: "storage-texture",
          format: "rgba16float",
          dispatchSize: true
        }
      ]
    });
    this.destroyed = false;
    this.encoded = false;
  }

  // samplingとreadbackの両方に使えるstorage textureを、mip構成を明示して作ります
  createOutputTexture(name, format, width, height, mipLevelCount) {
    return this.device.createTexture({
      label: `${this.label}:${name}`,
      size: [width, height, 1],
      format,
      mipLevelCount,
      usage: GPUTextureUsage.STORAGE_BINDING
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC
    });
  }

  // 破棄済みまたは未生成resourceの利用を固定色へ置き換えず例外として報告します
  requireAlive() {
    if (this.destroyed) throw new Error(`${this.label} is destroyed`);
  }

  // source寸法が変わった場合だけrgba32float textureを再作成し、前のtextureを明示破棄します
  prepareSourceTexture(source) {
    if (source.width === this.sourceWidth && source.height === this.sourceHeight) return;
    this.sourceTexture?.destroy();
    this.sourceTexture = this.device.createTexture({
      label: `${this.label}:source`,
      size: [source.width, source.height, 1],
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.sourceView = this.sourceTexture.createView();
    this.importanceAliasBuffer?.destroy();
    this.importanceAliasBuffer = this.device.createBuffer({
      label: `${this.label}:importance-alias`,
      size: source.width * source.height * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.sourceWidth = source.width;
    this.sourceHeight = source.height;
  }

  // sourceをGPUへ転送し、diffuse、全specular mip、BRDF LUTの順でcommandを記録します
  // timestampWritesは最初のdiffuse開始と最後のBRDF終了へ分け、前処理全体のGPU区間を測ります
  encode(commandEncoder, sourceImage, options = {}) {
    this.requireAlive();
    if (!commandEncoder?.beginComputePass) {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    const source = validateRadianceHdrForEquirectangularIbl(
      sourceImage,
      `${this.label} source`
    );
    const checkedOptions = util.readPlainObject(options, `${this.label} encode options`);
    for (const key of Object.keys(checkedOptions)) {
      if (key !== "timestampWrites") {
        throw new Error(`${this.label} encode options.${key} is not supported`);
      }
    }
    let firstTimestampWrites;
    let finalTimestampWrites;
    if (checkedOptions.timestampWrites !== undefined) {
      const timing = util.readPlainObject(
        checkedOptions.timestampWrites,
        `${this.label} timestampWrites`
      );
      if (!timing.querySet) throw new Error(`${this.label} timestampWrites requires querySet`);
      const begin = timing.beginningOfPassWriteIndex;
      const end = timing.endOfPassWriteIndex;
      if (begin === undefined && end === undefined) {
        throw new Error(`${this.label} timestampWrites requires a beginning or end index`);
      }
      if (begin !== undefined) {
        firstTimestampWrites = {
          querySet: timing.querySet,
          beginningOfPassWriteIndex: util.readFiniteNumber(
            begin,
            `${this.label} timestampWrites.beginningOfPassWriteIndex`,
            { integer: true, min: 0 }
          )
        };
      }
      if (end !== undefined) {
        finalTimestampWrites = {
          querySet: timing.querySet,
          endOfPassWriteIndex: util.readFiniteNumber(
            end,
            `${this.label} timestampWrites.endOfPassWriteIndex`,
            { integer: true, min: 0 }
          )
        };
      }
    }
    const importance = createPbrEnvironmentImportanceDistribution(source);
    const transfer = packSourceRows(source, importance, `${this.label} source`);
    const aliasTransfer = packImportanceAlias(importance);
    this.prepareSourceTexture(source);
    this.queue.writeTexture(
      { texture: this.sourceTexture },
      transfer.packed,
      { bytesPerRow: transfer.bytesPerRow, rowsPerImage: source.height },
      { width: source.width, height: source.height, depthOrArrayLayers: 1 }
    );
    this.queue.writeBuffer(this.importanceAliasBuffer, 0, aliasTransfer);
    const sourceResource = { getView: () => this.sourceView };
    const importanceAlias = { buffer: this.importanceAliasBuffer };
    this.diffusePass.setUniforms([
      this.settings.diffuseSampleCount,
      0.0,
      0.0,
      0.0
    ]);
    this.diffusePass.encode(commandEncoder, {
      source: sourceResource,
      importanceAlias,
      output: this.irradianceTarget
    }, {
      timestampWrites: firstTimestampWrites
    });
    for (let level = 0; level < this.specularTargets.length; level += 1) {
      this.specularPasses[level].encode(commandEncoder, {
        source: sourceResource,
        importanceAlias,
        output: this.specularTargets[level]
      });
    }
    this.brdfPass.setUniforms([
      this.settings.brdfSampleCount,
      0.0,
      0.0,
      0.0
    ]);
    this.brdfPass.encode(commandEncoder, { output: this.brdfLutTarget }, {
      timestampWrites: finalTimestampWrites
    });
    this.encoded = true;
    return this.getResources();
  }

  // DeferredとForwardがそのまま受け取れる5 fieldだけを返します
  getResources() {
    this.requireAlive();
    const resources = {
      irradiance: { getView: () => this.irradianceView },
      prefilteredSpecular: { getView: () => this.specularView },
      brdfLut: { getView: () => this.brdfLutView },
      sampler: this.sampler,
      specularMipCount: this.settings.specularMipCount
    };
    if (this.sourceView) resources.radiance = { getView: () => this.sourceView };
    return resources;
  }

  // GPU生成値をCPU参照と比較する診断用に、三つのtextureをFloat32Arrayへ読み戻します
  async readback() {
    this.requireAlive();
    if (!this.encoded) throw new Error(`${this.label} readback requires encode and submit first`);
    const descriptors = [];
    const encoder = this.device.createCommandEncoder({ label: `${this.label}:readback` });
    const addCopy = (texture, mipLevel, width, height, channels, name) => {
      const rowBytes = width * channels * Uint16Array.BYTES_PER_ELEMENT;
      const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
      const buffer = this.device.createBuffer({
        label: `${this.label}:readback:${name}`,
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });
      encoder.copyTextureToBuffer(
        { texture, mipLevel },
        { buffer, bytesPerRow, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 }
      );
      descriptors.push({ buffer, bytesPerRow, width, height, channels });
    };
    addCopy(
      this.irradianceTexture,
      0,
      this.settings.irradianceWidth,
      this.settings.irradianceHeight,
      4,
      "irradiance"
    );
    this.specularTargets.forEach((target, level) => addCopy(
      this.specularTexture,
      level,
      target.width,
      target.height,
      4,
      `specular-${level}`
    ));
    addCopy(
      this.brdfLutTexture,
      0,
      this.settings.brdfLutWidth,
      this.settings.brdfLutHeight,
      4,
      "brdf-lut"
    );
    this.queue.submit([encoder.finish()]);
    const levels = await Promise.all(descriptors.map((entry) => resolveReadback(this.device, entry)));
    const rawBrdfLut = levels.at(-1);
    const brdfData = new Float32Array(rawBrdfLut.width * rawBrdfLut.height * 2);
    for (let pixel = 0; pixel < rawBrdfLut.width * rawBrdfLut.height; pixel += 1) {
      brdfData[pixel * 2] = rawBrdfLut.data[pixel * 4];
      brdfData[pixel * 2 + 1] = rawBrdfLut.data[pixel * 4 + 1];
    }
    return {
      irradiance: levels[0],
      prefilteredSpecular: levels.slice(1, 1 + this.specularTargets.length),
      brdfLut: {
        width: rawBrdfLut.width,
        height: rawBrdfLut.height,
        data: brdfData
      },
      settings: { ...this.settings }
    };
  }

  // 内部pass、source、三つの出力textureを一度だけ破棄します
  destroy() {
    if (this.destroyed) return false;
    this.diffusePass.destroy();
    for (const pass of this.specularPasses) pass.destroy();
    this.brdfPass.destroy();
    this.sourceTexture?.destroy();
    this.importanceAliasBuffer?.destroy();
    this.irradianceTexture.destroy();
    this.specularTexture.destroy();
    this.brdfLutTexture.destroy();
    this.destroyed = true;
    return true;
  }
}
