// ---------------------------------------------
// PbrEnvironmentDebugPass.js  2026/09/09
//   Fullscreen inspection for PBR environment resources
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ComputePass from "./ComputePass.js";
import { validatePbrEnvironmentResources } from "./PbrEnvironment.js";
import StorageTargetFactory, { resizeTarget } from "./StorageTargetFactory.js";
import util from "./util.js";

export const PBR_ENVIRONMENT_DEBUG_FORMAT = "rgba16float";
export const PBR_ENVIRONMENT_DEBUG_VIEWS = Object.freeze([
  "radiance",
  "irradiance",
  "specular",
  "brdfLut"
]);

// Canvas上のscreen UVをaspect fit後の画像UVへ戻し、黒帯上なら選択対象なしを返します
// shaderと画素選択UIで同じ縦横比計算を使えるよう、GPUに依存しない関数として公開します
export function mapPbrEnvironmentDebugUv(screenUv, outputSize, sourceSize) {
  for (const [value, name] of [
    [screenUv, "screenUv"],
    [outputSize, "outputSize"],
    [sourceSize, "sourceSize"]
  ]) {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error(`PBR environment debug ${name} must be an exact vec2 array`);
    }
  }
  const screenU = util.readFiniteNumber(screenUv[0], "PBR environment debug screenUv[0]", {
    min: 0.0,
    max: 1.0
  });
  const screenV = util.readFiniteNumber(screenUv[1], "PBR environment debug screenUv[1]", {
    min: 0.0,
    max: 1.0
  });
  const outputWidth = util.readFiniteNumber(outputSize[0], "PBR environment debug outputSize[0]", {
    integer: true,
    min: 1
  });
  const outputHeight = util.readFiniteNumber(outputSize[1], "PBR environment debug outputSize[1]", {
    integer: true,
    min: 1
  });
  const sourceWidth = util.readFiniteNumber(sourceSize[0], "PBR environment debug sourceSize[0]", {
    integer: true,
    min: 1
  });
  const sourceHeight = util.readFiniteNumber(sourceSize[1], "PBR environment debug sourceSize[1]", {
    integer: true,
    min: 1
  });
  const outputAspect = outputWidth / outputHeight;
  const sourceAspect = sourceWidth / sourceHeight;
  let minU = 0.0;
  let maxU = 1.0;
  let minV = 0.0;
  let maxV = 1.0;
  if (outputAspect > sourceAspect) {
    const widthFraction = sourceAspect / outputAspect;
    minU = (1.0 - widthFraction) * 0.5;
    maxU = minU + widthFraction;
  } else {
    const heightFraction = outputAspect / sourceAspect;
    minV = (1.0 - heightFraction) * 0.5;
    maxV = minV + heightFraction;
  }
  if (screenU < minU || screenU > maxU || screenV < minV || screenV > maxV) return null;
  return [
    (screenU - minU) / (maxU - minU),
    (screenV - minV) / (maxV - minV)
  ];
}

// 元HDR、積分済み環境、選択roughness mip、BRDF scale/biasを同じ2D表示規則で描きます
// texture pixelを判別しやすくするためnearest textureLoadを使い、画素値を直接表示します
export const PBR_ENVIRONMENT_DEBUG_WGSL = `
struct Params {
  // x = view番号、y = specular mip、z = exposure stops、w = 選択mipのroughness
  control : vec4f,
  // xy = 選択UV、zw = 予約
  selected : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var radianceTexture : texture_2d<f32>;
@group(0) @binding(2) var irradianceTexture : texture_2d<f32>;
@group(0) @binding(3) var specularTexture : texture_2d<f32>;
@group(0) @binding(4) var brdfLutTexture : texture_2d<f32>;
@group(0) @binding(5) var outputTexture : texture_storage_2d<rgba16float, write>;

fn selectedTextureDimensions(mode : i32, mipLevel : i32) -> vec2u {
  if (mode == 0) {
    return textureDimensions(radianceTexture);
  }
  if (mode == 1) {
    return textureDimensions(irradianceTexture);
  }
  if (mode == 2) {
    return textureDimensions(specularTexture, mipLevel);
  }
  return textureDimensions(brdfLutTexture);
}

fn loadSelectedTexture(mode : i32, coord : vec2i, mipLevel : i32) -> vec3f {
  if (mode == 0) {
    return textureLoad(radianceTexture, coord, 0).rgb;
  }
  if (mode == 1) {
    return textureLoad(irradianceTexture, coord, 0).rgb;
  }
  if (mode == 2) {
    return textureLoad(specularTexture, coord, mipLevel).rgb;
  }
  let brdf = textureLoad(brdfLutTexture, coord, 0).rg;
  return vec3f(brdf, 0.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDims = textureDimensions(outputTexture);
  if (id.x >= outputDims.x || id.y >= outputDims.y) {
    return;
  }
  let mode = i32(round(params.control.x));
  let mipLevel = i32(round(params.control.y));
  let sourceDims = selectedTextureDimensions(mode, mipLevel);
  let sourceAspect = f32(sourceDims.x) / f32(sourceDims.y);
  let outputAspect = f32(outputDims.x) / f32(outputDims.y);
  var contentMin = vec2f(0.0);
  var contentMax = vec2f(1.0);
  if (outputAspect > sourceAspect) {
    let widthFraction = sourceAspect / outputAspect;
    contentMin.x = (1.0 - widthFraction) * 0.5;
    contentMax.x = contentMin.x + widthFraction;
  } else {
    let heightFraction = outputAspect / sourceAspect;
    contentMin.y = (1.0 - heightFraction) * 0.5;
    contentMax.y = contentMin.y + heightFraction;
  }
  let screenUv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(outputDims);
  if (any(screenUv < contentMin) || any(screenUv > contentMax)) {
    textureStore(outputTexture, vec2i(id.xy), vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }
  let uv = clamp((screenUv - contentMin) / (contentMax - contentMin), vec2f(0.0), vec2f(1.0));
  let sourceCoord = min(vec2i(uv * vec2f(sourceDims)), vec2i(sourceDims) - vec2i(1));
  var color = loadSelectedTexture(mode, sourceCoord, mipLevel);
  if (mode != 3) {
    color *= exp2(params.control.z);
  }

  // 選択UVへ8 pixel長の白黒crosshairを重ね、数値表示の参照位置を画面上で示します
  let markerScreen = contentMin + params.selected.xy * (contentMax - contentMin);
  let markerDistance = abs((screenUv - markerScreen) * vec2f(outputDims));
  let marker = min(markerDistance.x, markerDistance.y) < 1.0
    && max(markerDistance.x, markerDistance.y) <= 8.0;
  if (marker) {
    let checker = (i32(id.x) + i32(id.y)) % 2 == 0;
    color = select(vec3f(0.0), vec3f(1.0), checker);
  }
  textureStore(outputTexture, vec2i(id.xy), vec4f(color, 1.0));
}
`;

export default class PbrEnvironmentDebugPass {
  // 診断用HDR targetとresource選択Compute passを画面寸法で作ります
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("PbrEnvironmentDebugPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "PbrEnvironmentDebugPass label",
      "pbr-environment-debug",
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(options.width, `${this.label} width`, 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, `${this.label} height`, 1, { min: 1 });
    this.targetFactory = options.targetFactory ?? new StorageTargetFactory(gpu, {
      label: `${this.label}:storage`,
      format: PBR_ENVIRONMENT_DEBUG_FORMAT
    });
    if (this.targetFactory.format !== PBR_ENVIRONMENT_DEBUG_FORMAT) {
      throw new Error(
        `${this.label} StorageTargetFactory format must be ${PBR_ENVIRONMENT_DEBUG_FORMAT}`
      );
    }
    this.outputTarget = this.targetFactory.create({
      label: `${this.label}:output`,
      width: this.width,
      height: this.height,
      format: PBR_ENVIRONMENT_DEBUG_FORMAT
    });
    this.computePass = new ComputePass(gpu, {
      label: this.label,
      code: PBR_ENVIRONMENT_DEBUG_WGSL,
      uniformFloats: 8,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "radiance", type: "sampled-texture" },
        { binding: 2, name: "irradiance", type: "sampled-texture" },
        { binding: 3, name: "specular", type: "sampled-texture" },
        { binding: 4, name: "brdfLut", type: "sampled-texture" },
        {
          binding: 5,
          name: "output",
          type: "storage-texture",
          format: PBR_ENVIRONMENT_DEBUG_FORMAT,
          dispatchSize: true
        }
      ]
    });
    this.ready = this.outputTarget.ready;
    this.destroyed = false;
  }

  // debug passが利用可能な状態であることを確認し、encodeとresource取得を保護します
  requireAlive() {
    if (this.destroyed) throw new Error(`${this.label} is destroyed`);
  }

  // 全診断viewで同じ完全な環境集合を使い、元radiance欠落もencode前に検出します
  validateEnvironment(environment) {
    const checked = validatePbrEnvironmentResources(environment, 1.0, this.label);
    if (checked === null) throw new Error(`${this.label} requires environment`);
    if (checked.radiance === null) throw new Error(`${this.label} requires environment.radiance`);
    return checked;
  }

  // view、mip、露出、選択UVを検証し、選択resourceを線形HDR targetへ描きます
  encode(commandEncoder, environment, options = {}) {
    this.requireAlive();
    if (!commandEncoder?.beginComputePass) {
      throw new Error(`${this.label} encode requires a GPUCommandEncoder`);
    }
    const checked = this.validateEnvironment(environment);
    const view = util.readOptionalEnum(
      options.view,
      `${this.label} view`,
      "radiance",
      PBR_ENVIRONMENT_DEBUG_VIEWS
    );
    const mipLevel = util.readOptionalInteger(
      options.mipLevel,
      `${this.label} mipLevel`,
      0,
      { min: 0, max: checked.specularMipCount - 1 }
    );
    const exposureStops = util.readOptionalFiniteNumber(
      options.exposureStops,
      `${this.label} exposureStops`,
      0.0,
      { min: -16.0, max: 16.0 }
    );
    const selectedUv = options.selectedUv ?? [0.5, 0.5];
    if (!Array.isArray(selectedUv) || selectedUv.length !== 2) {
      throw new Error(`${this.label} selectedUv must be an exact vec2 array`);
    }
    const selectedU = util.readFiniteNumber(selectedUv[0], `${this.label} selectedUv[0]`, {
      min: 0.0,
      max: 1.0
    });
    const selectedV = util.readFiniteNumber(selectedUv[1], `${this.label} selectedUv[1]`, {
      min: 0.0,
      max: 1.0
    });
    const roughness = checked.specularMipCount === 1
      ? 0.04
      : mipLevel / (checked.specularMipCount - 1);
    const viewIndex = PBR_ENVIRONMENT_DEBUG_VIEWS.indexOf(view);
    this.computePass.setUniforms([
      viewIndex,
      mipLevel,
      exposureStops,
      roughness,
      selectedU,
      selectedV,
      0.0,
      0.0
    ]);
    this.computePass.encode(commandEncoder, {
      radiance: checked.radiance,
      irradiance: checked.irradiance,
      specular: checked.prefilteredSpecular,
      brdfLut: checked.brdfLut,
      output: this.outputTarget
    });
    return this.outputTarget;
  }

  // Canvas resize時だけHDR targetを交換し、同寸法ならresourceを維持します
  resize(width, height) {
    this.requireAlive();
    this.width = util.readFiniteNumber(width, `${this.label} width`, { integer: true, min: 1 });
    this.height = util.readFiniteNumber(height, `${this.label} height`, { integer: true, min: 1 });
    return resizeTarget(this.outputTarget, this.width, this.height);
  }

  // 診断画像を描いたoutput targetを取得し、画面表示またはreadbackへ渡します
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // compute passとoutput targetを解放し、以後の操作を状態エラーへ切り替えます
  destroy() {
    if (this.destroyed) return false;
    this.computePass.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
