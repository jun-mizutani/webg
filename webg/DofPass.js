// ---------------------------------------------
//  DofPass.js      2026/07/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import RenderTarget from "./RenderTarget.js";
import SeparableBlurPass from "./SeparableBlurPass.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import { resolveRenderFrameTokenCameraFrame } from "./CameraFrame.js";
import util from "./util.js";

// render-pass版DoFもCompute版と同じCamera Reverse-Zの復元式を使います
// far=0はCameraFrameの無限farを表し、depth=0は背景なので呼び出し側で先に除外します
export const DOF_REVERSE_Z_WGSL = `
fn isDofBackgroundDepth(depth : f32) -> bool {
  return depth == 0.0;
}

fn linearizeDofDepth(depth : f32, near : f32, far : f32) -> f32 {
  if (far == 0.0) {
    return near / depth;
  }
  return (near * far) / (near + depth * (far - near));
}
`;

// CameraFrameからshaderへ渡す投影値を作り、旧near/farの独立状態を持たせません
export function createDofProjectionParams(cameraFrame) {
  if (!cameraFrame || cameraFrame.depthConvention !== CAMERA_REVERSE_Z) {
    throw new Error("DofPass requires a Reverse-Z CameraFrame");
  }
  const near = util.readFiniteNumber(cameraFrame.near, "DofPass CameraFrame near", {
    minExclusive: 0.0
  });
  const far = cameraFrame.far;
  if (far !== Infinity) {
    util.readFiniteNumber(far, "DofPass CameraFrame far", { minExclusive: near });
  }
  return new Float32Array([near, far === Infinity ? 0.0 : far]);
}

const DOF_STAGE_RADIUS_SCALES = Object.freeze({
  small: 0.16,
  medium: 0.55,
  large: 1.0
});
const DOF_STAGE_DEFAULT_ITERATIONS = Object.freeze({
  // small は焦点近傍の軽いblurを作る段階なので、反復を増やしても品質差が出にくい
  small: 1,
  // medium は中間段階の滑らかさに効くが、実測では 2 回で十分な見え方になった
  medium: 2,
  // large は低解像度targetで大きなblurを受け持つため、広いkernelを保つために 4 回使う
  large: 4
});
const DOF_STAGE_TARGET_SCALE_MULTIPLIERS = Object.freeze({
  // 小さいblurは輪郭付近の遷移にそのまま見えやすいため、基準の blurScale を維持する
  small: 1.0,
  // 中程度以上のblurは細部が見えにくくなるため、段階ごとに target を縮めて
  // 生成コストを下げても見た目の破綻が起きにくい
  medium: 0.7,
  large: 0.5
});
const DOF_STAGE_COUNT_MIN = 1;
const DOF_STAGE_COUNT_MAX = 3;

// ステージの`blur`の`iterations`を読み込み、検証済みのデータとして後続処理へ渡す
function readStageBlurIterations(options = {}) {
  // 旧来の blurIterations 指定がある場合は、3 stage すべてへ同じ値を明示適用する
  // 未指定なら実測結果に基づく stage 別の軽量な既定値を使う
  const sharedIterations = options.blurIterations === undefined
    ? null
    : util.readOptionalInteger(options.blurIterations, "DofPass blurIterations", 2, { min: 1 });
  const stageOptions = options.stageBlurIterations ?? {};
  if (typeof stageOptions !== "object" || Array.isArray(stageOptions)) {
    throw new Error("DofPass stageBlurIterations must be an object with small, medium and large values");
  }
  const baseSmall = sharedIterations ?? DOF_STAGE_DEFAULT_ITERATIONS.small;
  const baseMedium = sharedIterations ?? DOF_STAGE_DEFAULT_ITERATIONS.medium;
  const baseLarge = sharedIterations ?? DOF_STAGE_DEFAULT_ITERATIONS.large;
  return {
    small: util.readOptionalInteger(stageOptions.small, "DofPass stageBlurIterations.small", baseSmall, { min: 1 }),
    medium: util.readOptionalInteger(stageOptions.medium, "DofPass stageBlurIterations.medium", baseMedium, { min: 1 }),
    large: util.readOptionalInteger(stageOptions.large, "DofPass stageBlurIterations.large", baseLarge, { min: 1 })
  };
}

export default class DofPass {
  // scene color + sampled depth から、focus 面だけ sharp に残して
  // それ以外を blur 側へ寄せる最小の被写界深度 pass
  // 利用側は beginScene() で sceneTarget へ 3D scene を描いたあと、
  // render() で depth debug / focus debug / 最終 composite を順に実行する
  constructor(gpu, options = {}) {
    for (const name of ["projectionNear", "projectionFar"]) {
      if (Object.prototype.hasOwnProperty.call(options, name)) {
        throw new Error(
          `DofPass no longer supports ${name}; pass renderFrameToken to beginScene and render`
        );
      }
    }
    this.gpu = gpu;
    this.device = null;
    this.queue = null;
    this.enabled = options.enabled !== false;
    this.width = util.readOptionalInteger(options.width, "DofPass width", 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, "DofPass height", 1, { min: 1 });
    this.sceneFormat = options.sceneFormat ?? gpu?.format ?? "bgra8unorm";
    this.canvasFormat = options.canvasFormat ?? gpu?.format ?? "bgra8unorm";
    this.dofMode = util.readOptionalEnum(
      options.dofMode,
      "DofPass dofMode",
      "staged",
      ["staged"]
    );
    this.focusDistance = util.readOptionalFiniteNumber(options.focusDistance, "DofPass focusDistance", 34.0, { min: 0 });
    // focusRange は最大blur到達距離ではなく、scene -> small など 1 stage 分の距離幅として扱う
    this.focusRange = util.readOptionalFiniteNumber(options.focusRange, "DofPass focusRange", 6.0, { minExclusive: 0 });
    this.maxBlurMix = util.readOptionalFiniteNumber(options.maxBlurMix, "DofPass maxBlurMix", 1.0, { min: 0, max: 1 });
    this.sharpnessWidth = util.readOptionalFiniteNumber(options.sharpnessWidth, "DofPass sharpnessWidth", 0.15, { min: 0, max: 0.95 });
    this.sharpnessPower = util.readOptionalFiniteNumber(options.sharpnessPower, "DofPass sharpnessPower", 1.0, { minExclusive: 0 });
    this.cameraFrame = null;
    this.renderFrameToken = null;
    this.blurRadius = util.readOptionalFiniteNumber(options.blurRadius, "DofPass blurRadius", 2.4, { min: 0 });
    this.stageBlurIterations = readStageBlurIterations(options);
    this.blurIterations = this.stageBlurIterations.large;
    this.blurScale = util.readOptionalFiniteNumber(options.blurScale, "DofPass blurScale", 0.5, { minExclusive: 0 });
    this.stagedStageCount = util.readOptionalInteger(
      options.stagedStageCount,
      "DofPass stagedStageCount",
      3,
      { min: DOF_STAGE_COUNT_MIN, max: DOF_STAGE_COUNT_MAX }
    );
    this.sceneTarget = null;
    this.depthDebugTarget = null;
    this.focusDebugTarget = null;
    this.stageDebugTarget = null;
    // staged blur は 3 段階とも同じ scene color を入力にするが、
    // blur 半径が大きい段階ほど target 解像度を下げて作る
    // これにより、large blur で特に支配的になりやすい fill cost を抑える
    this.blurPassSmall = new SeparableBlurPass(gpu, {
      width: this.width,
      height: this.height,
      targetFormat: this.sceneFormat,
      labelPrefix: "DofPass:blurSmall",
      blurRadius: this.blurRadius * DOF_STAGE_RADIUS_SCALES.small,
      targetScale: this.getStageTargetScale("small"),
      iterations: this.stageBlurIterations.small
    });
    this.blurPassMedium = new SeparableBlurPass(gpu, {
      width: this.width,
      height: this.height,
      targetFormat: this.sceneFormat,
      labelPrefix: "DofPass:blurMedium",
      blurRadius: this.blurRadius * DOF_STAGE_RADIUS_SCALES.medium,
      targetScale: this.getStageTargetScale("medium"),
      iterations: this.stageBlurIterations.medium
    });
    this.blurPassLarge = new SeparableBlurPass(gpu, {
      width: this.width,
      height: this.height,
      targetFormat: this.sceneFormat,
      labelPrefix: "DofPass:blurLarge",
      blurRadius: this.blurRadius * DOF_STAGE_RADIUS_SCALES.large,
      targetScale: this.getStageTargetScale("large"),
      iterations: this.stageBlurIterations.large
    });
    // 既存コードが blurPass を参照している場合は、最大blur側を代表として扱う
    this.blurPass = this.blurPassLarge;
    this.vertexBuffer = null;
    this.sampler = null;
    this.uniformData = null;
    this.uniformBuffer = null;
    this.layout = null;
    this.pipeline = null;
    this.depthDebugLayout = null;
    this.depthDebugPipeline = null;
    this.focusDebugLayout = null;
    this.focusDebugPipeline = null;
    this.stageDebugLayout = null;
    this.stageDebugPipeline = null;
    this.ready = this.init();
  }

  // WebGPU resource 一式をまとめて立ち上げる
  // scene を描く RenderTarget、blur 用 pass、fullscreen quad、
  // DOF 合成 pipeline の順に準備しておく
  async init() {
    if (this.gpu?.ready) {
      await this.gpu.ready;
    }
    this.device = this.gpu?.device ?? null;
    this.queue = this.gpu?.queue ?? null;
    if (!this.device) {
      throw new Error("DofPass requires a ready WebGPU device");
    }

    this.createSampler();
    this.createQuad();
    this.createBuffers();
    this.createLayout();
    await this.createPipeline();
    await this.createDebugPipelines();
    await this.createTargets();
    this.updateUniforms();
    return this;
  }

  // `logShaderCompilationInfo`は現在値を読みやすい診断文字列へ整形する
  async logShaderCompilationInfo(module, label) {
    if (typeof module?.getCompilationInfo !== "function") {
      return null;
    }
    const info = await module.getCompilationInfo();
    const messages = Array.isArray(info?.messages) ? info.messages : [];
    for (const message of messages) {
      const type = String(message?.type ?? message?.messageType ?? "info");
      const lineNum = Number.isFinite(message?.lineNum) ? message.lineNum : null;
      const linePos = Number.isFinite(message?.linePos) ? message.linePos : null;
      const text = String(message?.message ?? message?.text ?? "").trim();
      const location = lineNum === null
        ? ""
        : `:${lineNum}${linePos !== null ? `:${linePos}` : ""}`;
      const prefix = `${label}${location} ${type}`;
      if (type === "error") {
        console.error(prefix, text);
      } else {
        console.warn(prefix, text);
      }
    }
    return info;
  }

  // `with`の`validation`を生成し、後続処理で利用できる状態にする
  async createWithValidation(label, createFn) {
    if (typeof this.device?.pushErrorScope === "function" && typeof this.device?.popErrorScope === "function") {
      this.device.pushErrorScope("validation");
      const result = createFn();
      const error = await this.device.popErrorScope();
      if (error) {
        console.error(`${label} validation error:`, error);
        throw error;
      }
      return result;
    }
    return createFn();
  }

  // scene / blur の両方を線形補間で読むので linear sampler を共有する
  createSampler() {
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });
  }

  // fullscreen quad を triangle-strip 4 頂点で用意する
  // 頂点は position.xy + texCoord.xy の並びで、後段の全 pass が同じ形を使う
  createQuad() {
    const vertices = new Float32Array([
      -1.0, -1.0, 0.0, 1.0,
       1.0, -1.0, 1.0, 1.0,
      -1.0,  1.0, 0.0, 0.0,
       1.0,  1.0, 1.0, 0.0
    ]);
    this.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.queue.writeBuffer(this.vertexBuffer, 0, vertices);
  }

  // バッファを生成し、後続処理で利用できる状態にする
  createBuffers() {
    // Uniform は JS / WGSL 両方で同じ並びを使う
    // 0: focusDistance   1: focusRange   2: maxBlurMix    3: enabled
    // 4: near            5: far(無限farは0) 6: width       7: height
    // 8: sharpnessWidth  9: sharpnessPower
    // 10以降は将来の拡張用に確保しておく
    // sharpnessWidth は focusRange 内で完全に sharp とみなす割合
    // sharpnessPower は smoothstep 後の blur 増加を少し寝かせたり立てたりする指数
    this.uniformData = new Float32Array(16);
    this.uniformBuffer = this.device.createBuffer({
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  // 合成 pass は 5 種類の入力を受ける
  // 1. 元 scene color
  // 2. small / medium / large の3段階blur color
  // 3. sceneTarget が持つ sampleable depth
  createLayout() {
    this.layout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } }
      ]
    });
  }

  // depth debug / focus debug は depth だけ読めればよいので、
  // 合成 pass より小さい bind group layout を共通化する
  createDebugTextureLayout() {
    return this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } }
      ]
    });
  }

  // 処理経路を生成し、後続処理で利用できる状態にする
  async createPipeline() {
    const module = this.device.createShaderModule({
      code: `
struct Uniforms {
  focusDistance : f32,
  focusRange : f32,
  maxBlurMix : f32,
  enabled : f32,
  near : f32,
  far : f32,
  width : f32,
  height : f32,
  sharpnessWidth : f32,
  sharpnessPower : f32,
  reserved0 : f32,
  reserved1 : f32,
  reserved2 : f32,
  reserved3 : f32,
  reserved4 : f32,
  reserved5 : f32,
};

struct VSIn {
  @location(0) position : vec2f,
  @location(1) texCoord : vec2f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) vTexCoord : vec2f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var sceneSampler : sampler;
@group(0) @binding(3) var blurSmallTexture : texture_2d<f32>;
@group(0) @binding(4) var blurSmallSampler : sampler;
@group(0) @binding(5) var blurMediumTexture : texture_2d<f32>;
@group(0) @binding(6) var blurMediumSampler : sampler;
@group(0) @binding(7) var blurLargeTexture : texture_2d<f32>;
@group(0) @binding(8) var blurLargeSampler : sampler;
@group(0) @binding(9) var depthTexture : texture_depth_2d;

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.vTexCoord = input.texCoord;
  return output;
}

${DOF_REVERSE_Z_WGSL}

fn getDepth(uv : vec2f) -> f32 {
  // texture_depth_2d は sample ではなく load で読む
  // UV が右端ぴったりになると範囲外になりうるので少し clamp しておく
  let clamped = clamp(uv, vec2f(0.0), vec2f(0.999999));
  let dims = textureDimensions(depthTexture);
  let pixel = min(vec2u(clamped * vec2f(dims)), dims - vec2u(1u, 1u));
  return textureLoad(depthTexture, vec2i(pixel), 0);
}

fn sceneColorAt(uv : vec2f) -> vec4f {
  // scene color は blur texture と同じ sampler 経由で読み、
  // stage 間の補間時にfiltering条件が揃うようにする
  let clamped = clamp(uv, vec2f(0.0), vec2f(0.999999));
  return textureSampleLevel(sceneTexture, sceneSampler, clamped, 0.0);
}

fn blurSmallColorAt(uv : vec2f) -> vec3f {
  let clamped = clamp(uv, vec2f(0.0), vec2f(0.999999));
  return textureSampleLevel(blurSmallTexture, blurSmallSampler, clamped, 0.0).rgb;
}

fn blurMediumColorAt(uv : vec2f) -> vec3f {
  let clamped = clamp(uv, vec2f(0.0), vec2f(0.999999));
  return textureSampleLevel(blurMediumTexture, blurMediumSampler, clamped, 0.0).rgb;
}

fn blurLargeColorAt(uv : vec2f) -> vec3f {
  let clamped = clamp(uv, vec2f(0.0), vec2f(0.999999));
  return textureSampleLevel(blurLargeTexture, blurLargeSampler, clamped, 0.0).rgb;
}

fn stagePosition(focusDelta : f32, focusRange : f32) -> f32 {
  // focusRange は最大blur到達距離ではなく、1 stage 分の距離幅として扱う
  // 0..1: scene -> small、1..2: small -> medium、2..3: medium -> large、3以降: large
  return focusDelta / focusRange;
}

fn smoothStageFraction(stageValue : f32, holdRatio : f32, power : f32) -> f32 {
  // 各stage内の 0..1 を smoothstep でならし、stage境界付近の急な見え方を抑える
  let normalizedDistance = clamp(stageValue, 0.0, 1.0);
  let hold = clamp(holdRatio, 0.0, 0.95);
  let ramp = clamp((normalizedDistance - hold) / (1.0 - hold), 0.0, 1.0);
  let smoothWeight = ramp * ramp * (3.0 - 2.0 * ramp);
  return pow(smoothWeight, power);
}

fn stagedBlurColor(
  sceneColor : vec3f,
  smallBlur : vec3f,
  mediumBlur : vec3f,
  largeBlur : vec3f,
  stagePositionValue : f32,
  mixScale : f32
) -> vec3f {
  // 合焦中はsceneColorをそのまま返し、その外側では
  // scene -> small -> medium -> large の順に段階的に移る
  // これにより、焦点面を少し外れた場所で small blur を経由せず
  // medium / large 相当へ飛ぶ見え方を避ける
  let clampedMixScale = clamp(mixScale, 0.0, 1.0);
  let stage = clamp(stagePositionValue, 0.0, 3.0);
  if (stage < 1.0) {
    return mix(sceneColor, smallBlur, smoothStageFraction(stage, uniforms.sharpnessWidth, uniforms.sharpnessPower) * clampedMixScale);
  }
  if (stage < 2.0) {
    return mix(smallBlur, mediumBlur, smoothStageFraction(stage - 1.0, uniforms.sharpnessWidth, uniforms.sharpnessPower) * clampedMixScale);
  }
  return mix(mediumBlur, largeBlur, smoothStageFraction(stage - 2.0, uniforms.sharpnessWidth, uniforms.sharpnessPower) * clampedMixScale);
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let sceneColor = sceneColorAt(input.vTexCoord);
  if (uniforms.enabled < 0.5) {
    // DOF 無効時は scene をそのまま返し、呼び出し側の処理フローを変えずに済ませる
    return sceneColor;
  }
  let smallBlur = blurSmallColorAt(input.vTexCoord);
  let mediumBlur = blurMediumColorAt(input.vTexCoord);
  let largeBlur = blurLargeColorAt(input.vTexCoord);
  let depth = getDepth(input.vTexCoord);
  // clear値0の背景にはview-space距離がないため、scene colorをそのまま維持する
  if (isDofBackgroundDepth(depth)) {
    return sceneColor;
  }
  let linearDepth = linearizeDofDepth(depth, uniforms.near, uniforms.far);
  let focusDelta = abs(linearDepth - uniforms.focusDistance);
  let stageValue = stagePosition(focusDelta, uniforms.focusRange);
  let color = stagedBlurColor(sceneColor.rgb, smallBlur, mediumBlur, largeBlur, stageValue, uniforms.maxBlurMix);
  return vec4f(color, sceneColor.a);
}`
    });
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.layout]
    });
    await this.logShaderCompilationInfo(module, "DofPass composite");
    this.pipeline = await this.createWithValidation("DofPass composite pipeline", () => this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [{
          arrayStride: 4 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 2 * 4, format: "float32x2" }
          ]
        }]
      },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [{ format: this.canvasFormat }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    }));
  }

  // debug 用に 2 種類の表示を持つ
  // depthDebug: 線形 depth を白黒で確認
  // focusDebug: 近景 / 合焦面 / 遠景を色分けして focus 設定を確認
  // stageDebug: scene / small / medium / large のどの段階が使われるかを色分けして確認
  async createDebugPipelines() {
    this.depthDebugLayout = this.createDebugTextureLayout();
    this.focusDebugLayout = this.createDebugTextureLayout();
    this.stageDebugLayout = this.createDebugTextureLayout();

    const depthModule = this.device.createShaderModule({
      code: `
struct Uniforms {
  focusDistance : f32,
  focusRange : f32,
  maxBlurMix : f32,
  enabled : f32,
  near : f32,
  far : f32,
  width : f32,
  height : f32,
  sharpnessWidth : f32,
  sharpnessPower : f32,
};

struct VSIn {
  @location(0) position : vec2f,
  @location(1) texCoord : vec2f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) vTexCoord : vec2f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var depthTexture : texture_depth_2d;

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.vTexCoord = input.texCoord;
  return output;
}

${DOF_REVERSE_Z_WGSL}

fn getDepth(uv : vec2f) -> f32 {
  let clamped = clamp(uv, vec2f(0.0), vec2f(0.999999));
  let dims = textureDimensions(depthTexture);
  let pixel = min(vec2u(clamped * vec2f(dims)), dims - vec2u(1u, 1u));
  return textureLoad(depthTexture, vec2i(pixel), 0);
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  // Reverse-Zのraw値を表示し、near=白、farと背景=黒という実textureの向きを確認する
  let depth = getDepth(input.vTexCoord);
  return vec4f(vec3f(depth), 1.0);
}`
    });

    const focusModule = this.device.createShaderModule({
      code: `
struct Uniforms {
  focusDistance : f32,
  focusRange : f32,
  maxBlurMix : f32,
  enabled : f32,
  near : f32,
  far : f32,
  width : f32,
  height : f32,
  sharpnessWidth : f32,
  sharpnessPower : f32,
};

struct VSIn {
  @location(0) position : vec2f,
  @location(1) texCoord : vec2f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) vTexCoord : vec2f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var depthTexture : texture_depth_2d;

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.vTexCoord = input.texCoord;
  return output;
}

${DOF_REVERSE_Z_WGSL}

fn getDepth(uv : vec2f) -> f32 {
  let clamped = clamp(uv, vec2f(0.0), vec2f(0.999999));
  let dims = textureDimensions(depthTexture);
  let pixel = min(vec2u(clamped * vec2f(dims)), dims - vec2u(1u, 1u));
  return textureLoad(depthTexture, vec2i(pixel), 0);
}

fn stagePosition(focusDelta : f32, focusRange : f32) -> f32 {
  return focusDelta / focusRange;
}

fn focusStageColor(delta : f32, stagePositionValue : f32) -> vec3f {
  // compute_dof と同じ色分けで、合焦を0、手前を -1..-3、奥を 1..3 として表示する
  let hold = clamp(uniforms.sharpnessWidth, 0.0, 0.95);
  if (stagePositionValue <= hold) {
    return vec3f(0.24, 1.0, 0.38);
  }
  var level = min(max(i32(ceil(stagePositionValue)), 1), 3);
  if (delta < 0.0) {
    if (level == 1) {
      return vec3f(1.0, 0.86, 0.18);
    }
    if (level == 2) {
      return vec3f(1.0, 0.48, 0.08);
    }
    return vec3f(1.0, 0.12, 0.08);
  }
  if (level == 1) {
    return vec3f(0.24, 0.95, 1.0);
  }
  if (level == 2) {
    return vec3f(0.14, 0.42, 1.0);
  }
  return vec3f(0.68, 0.22, 1.0);
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  // focusDistance からの距離を stage 幅で割り、compute_dof と同じ色分けで確認する
  let depth = getDepth(input.vTexCoord);
  if (isDofBackgroundDepth(depth)) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  let linearDepth = linearizeDofDepth(depth, uniforms.near, uniforms.far);
  let signedDelta = linearDepth - uniforms.focusDistance;
  let stageValue = stagePosition(abs(signedDelta), uniforms.focusRange);
  return vec4f(focusStageColor(signedDelta, stageValue), 1.0);
}`
    });

    const stageModule = this.device.createShaderModule({
      code: `
struct Uniforms {
  focusDistance : f32,
  focusRange : f32,
  maxBlurMix : f32,
  enabled : f32,
  near : f32,
  far : f32,
  width : f32,
  height : f32,
  sharpnessWidth : f32,
  sharpnessPower : f32,
};

struct VSIn {
  @location(0) position : vec2f,
  @location(1) texCoord : vec2f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) vTexCoord : vec2f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var depthTexture : texture_depth_2d;

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.vTexCoord = input.texCoord;
  return output;
}

${DOF_REVERSE_Z_WGSL}

fn getDepth(uv : vec2f) -> f32 {
  let clamped = clamp(uv, vec2f(0.0), vec2f(0.999999));
  let dims = textureDimensions(depthTexture);
  let pixel = min(vec2u(clamped * vec2f(dims)), dims - vec2u(1u, 1u));
  return textureLoad(depthTexture, vec2i(pixel), 0);
}

fn stagePosition(focusDelta : f32, focusRange : f32) -> f32 {
  return focusDelta / focusRange;
}

fn smoothStageFraction(stageValue : f32, holdRatio : f32, power : f32) -> f32 {
  let normalizedDistance = clamp(stageValue, 0.0, 1.0);
  let hold = clamp(holdRatio, 0.0, 0.95);
  let ramp = clamp((normalizedDistance - hold) / (1.0 - hold), 0.0, 1.0);
  let smoothWeight = ramp * ramp * (3.0 - 2.0 * ramp);
  return pow(smoothWeight, power);
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  if (uniforms.enabled < 0.5) {
    return vec4f(0.92, 0.92, 0.92, 1.0);
  }
  let depth = getDepth(input.vTexCoord);
  if (isDofBackgroundDepth(depth)) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  let linearDepth = linearizeDofDepth(depth, uniforms.near, uniforms.far);
  let focusDelta = abs(linearDepth - uniforms.focusDistance);
  let stageValue = stagePosition(focusDelta, uniforms.focusRange);
  let mixScale = clamp(uniforms.maxBlurMix, 0.0, 1.0);
  let sceneColor = vec3f(0.96, 0.96, 0.86);
  let smallColor = vec3f(1.0, 0.62, 0.22);
  let mediumColor = vec3f(0.24, 0.86, 1.0);
  let largeColor = vec3f(0.86, 0.40, 1.0);
  let stage = clamp(stageValue, 0.0, 3.0);
  if (stage < 1.0) {
    return vec4f(mix(sceneColor, smallColor, smoothStageFraction(stage, uniforms.sharpnessWidth, uniforms.sharpnessPower) * mixScale), 1.0);
  }
  if (stage < 2.0) {
    return vec4f(mix(smallColor, mediumColor, smoothStageFraction(stage - 1.0, uniforms.sharpnessWidth, uniforms.sharpnessPower) * mixScale), 1.0);
  }
  return vec4f(mix(mediumColor, largeColor, smoothStageFraction(stage - 2.0, uniforms.sharpnessWidth, uniforms.sharpnessPower) * mixScale), 1.0);
}`
    });

    await this.logShaderCompilationInfo(depthModule, "DofPass depthDebug");
    const depthLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.depthDebugLayout]
    });
    this.depthDebugPipeline = await this.createWithValidation("DofPass depthDebug pipeline", () => this.device.createRenderPipeline({
      layout: depthLayout,
      vertex: {
        module: depthModule,
        entryPoint: "vsMain",
        buffers: [{
          arrayStride: 4 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 2 * 4, format: "float32x2" }
          ]
        }]
      },
      fragment: {
        module: depthModule,
        entryPoint: "fsMain",
        targets: [{ format: this.sceneFormat }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    }));

    await this.logShaderCompilationInfo(focusModule, "DofPass focusDebug");
    const focusLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.focusDebugLayout]
    });
    this.focusDebugPipeline = await this.createWithValidation("DofPass focusDebug pipeline", () => this.device.createRenderPipeline({
      layout: focusLayout,
      vertex: {
        module: focusModule,
        entryPoint: "vsMain",
        buffers: [{
          arrayStride: 4 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 2 * 4, format: "float32x2" }
          ]
        }]
      },
      fragment: {
        module: focusModule,
        entryPoint: "fsMain",
        targets: [{ format: this.sceneFormat }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    }));

    await this.logShaderCompilationInfo(stageModule, "DofPass stageDebug");
    const stageLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.stageDebugLayout]
    });
    this.stageDebugPipeline = await this.createWithValidation("DofPass stageDebug pipeline", () => this.device.createRenderPipeline({
      layout: stageLayout,
      vertex: {
        module: stageModule,
        entryPoint: "vsMain",
        buffers: [{
          arrayStride: 4 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 2 * 4, format: "float32x2" }
          ]
        }]
      },
      fragment: {
        module: stageModule,
        entryPoint: "fsMain",
        targets: [{ format: this.sceneFormat }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    }));
  }

  // sceneTarget は color + depth を持つ本番入力
  // depthDebugTarget / focusDebugTarget / stageDebugTarget は CPU 取得ではなく画面確認用の color target
  async createTargets() {
    this.sceneTarget = new RenderTarget(this.gpu, {
      label: "DofPass:scene",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: true,
      sampleDepth: true,
      depthConvention: CAMERA_REVERSE_Z
    });
    this.depthDebugTarget = new RenderTarget(this.gpu, {
      label: "DofPass:depthDebug",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: false
    });
    this.focusDebugTarget = new RenderTarget(this.gpu, {
      label: "DofPass:focusDebug",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: false
    });
    this.stageDebugTarget = new RenderTarget(this.gpu, {
      label: "DofPass:stageDebug",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: false
    });
    await Promise.all([
      this.sceneTarget.ready,
      this.depthDebugTarget.ready,
      this.focusDebugTarget.ready,
      this.stageDebugTarget.ready,
      this.blurPassSmall.ready,
      this.blurPassMedium.ready,
      this.blurPassLarge.ready
    ]);
  }

  // JS側のsetterで触る値とCamera Frameの投影値をuniform bufferへ集約して流す
  // Camera Frame確定前の初期化ではnear/farを0にし、描画API側で必ず更新してから使用する
  updateUniforms() {
    this.uniformData[0] = this.focusDistance;
    this.uniformData[1] = this.focusRange;
    this.uniformData[2] = this.maxBlurMix;
    this.uniformData[3] = this.enabled ? 1.0 : 0.0;
    const projection = this.cameraFrame
      ? createDofProjectionParams(this.cameraFrame)
      : [0.0, 0.0];
    this.uniformData[4] = projection[0];
    this.uniformData[5] = projection[1];
    this.uniformData[6] = this.width;
    this.uniformData[7] = this.height;
    this.uniformData[8] = this.sharpnessWidth;
    this.uniformData[9] = this.sharpnessPower;
    this.uniformData[10] = 0.0;
    this.uniformData[11] = 0.0;
    this.uniformData[12] = 0.0;
    this.uniformData[13] = 0.0;
    this.uniformData[14] = 0.0;
    this.uniformData[15] = 0.0;
    this.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  // scene color、3段階blur color、sampleable depth を 1 つの bind group に束ねる
  // depth は sceneTarget 自身から読むので、最後の引数も通常は sceneTarget を渡す
  createBindGroup(sceneSource, blurSmallSource, blurMediumSource, blurLargeSource, depthSource) {
    const sceneView = sceneSource?.getColorView?.() ?? sceneSource?.getView?.() ?? sceneSource?.view ?? null;
    const sceneSampler = sceneSource?.getSampler?.() ?? sceneSource?.sampler;
    const blurSmallView = blurSmallSource?.getColorView?.() ?? blurSmallSource?.getView?.() ?? blurSmallSource?.view ?? null;
    const blurSmallSampler = blurSmallSource?.getSampler?.() ?? blurSmallSource?.sampler;
    const blurMediumView = blurMediumSource?.getColorView?.() ?? blurMediumSource?.getView?.() ?? blurMediumSource?.view ?? null;
    const blurMediumSampler = blurMediumSource?.getSampler?.() ?? blurMediumSource?.sampler;
    const blurLargeView = blurLargeSource?.getColorView?.() ?? blurLargeSource?.getView?.() ?? blurLargeSource?.view ?? null;
    const blurLargeSampler = blurLargeSource?.getSampler?.() ?? blurLargeSource?.sampler;
    const depthView = depthSource?.getDepthSampleView?.() ?? depthSource?.depthSampleView ?? null;
    if (!sceneView || !blurSmallView || !blurMediumView || !blurLargeView || !depthView) {
      throw new Error("DofPass requires scene color, 3 blur colors and sampleable depth");
    }
    if (!sceneSampler || !blurSmallSampler || !blurMediumSampler || !blurLargeSampler) {
      throw new Error("DofPass requires scene color and all blur colors to provide samplers");
    }
    return this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: sceneView },
        { binding: 2, resource: sceneSampler },
        { binding: 3, resource: blurSmallView },
        { binding: 4, resource: blurSmallSampler },
        { binding: 5, resource: blurMediumView },
        { binding: 6, resource: blurMediumSampler },
        { binding: 7, resource: blurLargeView },
        { binding: 8, resource: blurLargeSampler },
        { binding: 9, resource: depthView }
      ]
    });
  }

  // depth debug / focus debug は depth だけ読むので専用 bind group を使う
  createDepthDebugBindGroup(depthSource) {
    const depthView = depthSource?.getDepthSampleView?.() ?? depthSource?.depthSampleView ?? null;
    if (!depthView) {
      throw new Error("DofPass requires sampleable depth for debug view");
    }
    return this.device.createBindGroup({
      layout: this.depthDebugLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: depthView }
      ]
    });
  }

  // pipeline は外で選んでおき、ここでは quad 描画だけに絞る
  drawQuad(passEncoder) {
    passEncoder.setVertexBuffer(0, this.vertexBuffer);
    passEncoder.draw(4, 1, 0, 0);
  }

  // 有効状態を受け取り、現在の設定と後続処理へ反映する
  setEnabled(flag) {
    if (typeof flag !== "boolean") {
      throw new Error("DofPass enabled must be boolean");
    }
    this.enabled = !!flag;
    this.updateUniforms();
  }

  // `focus`の距離を受け取り、現在の設定と後続処理へ反映する
  setFocusDistance(value) {
    this.focusDistance = util.readOptionalFiniteNumber(value, "DofPass focusDistance", this.focusDistance, { min: 0 });
    this.updateUniforms();
  }

  // `focus`の`range`を受け取り、現在の設定と後続処理へ反映する
  setFocusRange(value) {
    // composite shader / debug shader ともに、この値を 1 stage 分の幅として参照する
    this.focusRange = util.readOptionalFiniteNumber(value, "DofPass focusRange", this.focusRange, { minExclusive: 0 });
    this.updateUniforms();
  }

  // `max`の`blur`の`mix`を受け取り、現在の設定と後続処理へ反映する
  setMaxBlurMix(value) {
    this.maxBlurMix = util.readOptionalFiniteNumber(value, "DofPass maxBlurMix", this.maxBlurMix, { min: 0, max: 1 });
    this.updateUniforms();
  }

  // 被写界深度のモードを受け取り、現在の設定と後続処理へ反映する
  setDofMode(value) {
    this.dofMode = util.readOptionalEnum(value, "DofPass dofMode", this.dofMode, ["staged"]);
    this.updateUniforms();
  }

  // `sharpness`の幅を受け取り、現在の設定と後続処理へ反映する
  setSharpnessWidth(value) {
    this.sharpnessWidth = util.readOptionalFiniteNumber(value, "DofPass sharpnessWidth", this.sharpnessWidth, { min: 0, max: 0.95 });
    this.updateUniforms();
  }

  // `sharpness`の`power`を受け取り、現在の設定と後続処理へ反映する
  setSharpnessPower(value) {
    this.sharpnessPower = util.readOptionalFiniteNumber(value, "DofPass sharpnessPower", this.sharpnessPower, { minExclusive: 0 });
    this.updateUniforms();
  }

  // `blur`の半径を受け取り、現在の設定と後続処理へ反映する
  setBlurRadius(value) {
    this.blurRadius = util.readOptionalFiniteNumber(value, "DofPass blurRadius", this.blurRadius, { min: 0 });
    this.blurPassSmall?.setBlurRadius(this.blurRadius * DOF_STAGE_RADIUS_SCALES.small);
    this.blurPassMedium?.setBlurRadius(this.blurRadius * DOF_STAGE_RADIUS_SCALES.medium);
    this.blurPassLarge?.setBlurRadius(this.blurRadius * DOF_STAGE_RADIUS_SCALES.large);
    this.updateUniforms();
  }

  // `blur`の`iterations`を受け取り、現在の設定と後続処理へ反映する
  setBlurIterations(value) {
    const iterations = util.readOptionalInteger(value, "DofPass blurIterations", this.blurIterations, { min: 1 });
    this.setStageBlurIterations({
      small: iterations,
      medium: iterations,
      large: iterations
    });
  }

  // ステージの`blur`の`iterations`を受け取り、現在の設定と後続処理へ反映する
  setStageBlurIterations(value = {}) {
    const next = {
      small: util.readOptionalInteger(value.small, "DofPass stageBlurIterations.small", this.stageBlurIterations.small, { min: 1 }),
      medium: util.readOptionalInteger(value.medium, "DofPass stageBlurIterations.medium", this.stageBlurIterations.medium, { min: 1 }),
      large: util.readOptionalInteger(value.large, "DofPass stageBlurIterations.large", this.stageBlurIterations.large, { min: 1 })
    };
    this.stageBlurIterations = next;
    this.blurIterations = next.large;
    this.blurPassSmall?.setIterations(next.small);
    this.blurPassMedium?.setIterations(next.medium);
    this.blurPassLarge?.setIterations(next.large);
  }

  getStageBlurIterations() {
    return { ...this.stageBlurIterations };
  }

  // `blur`の倍率を受け取り、現在の設定と後続処理へ反映する
  setBlurScale(value) {
    this.blurScale = util.readOptionalFiniteNumber(value, "DofPass blurScale", this.blurScale, { minExclusive: 0 });
    this.blurPassSmall?.setTargetScale(this.getStageTargetScale("small"));
    this.blurPassMedium?.setTargetScale(this.getStageTargetScale("medium"));
    this.blurPassLarge?.setTargetScale(this.getStageTargetScale("large"));
  }

  // `staged`のステージの`count`を受け取り、現在の設定と後続処理へ反映する
  setStagedStageCount(value) {
    this.stagedStageCount = util.readOptionalInteger(
      value,
      "DofPass stagedStageCount",
      this.stagedStageCount,
      { min: DOF_STAGE_COUNT_MIN, max: DOF_STAGE_COUNT_MAX }
    );
  }

  getStagedStageCount() {
    return this.stagedStageCount;
  }

  // ステージの対象の倍率を現在の入力と状態から求め、呼び出し元へ返す
  getStageTargetScale(stage) {
    const multiplier = DOF_STAGE_TARGET_SCALE_MULTIPLIERS[stage];
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`DofPass unknown stage target scale: ${stage}`);
    }
    return this.blurScale * multiplier;
  }

  // `resize`は表示領域に合わせて関連する寸法と描画先を更新する
  resize(width, height) {
    const nextWidth = util.readOptionalInteger(width, "DofPass width", this.width, { min: 1 });
    const nextHeight = util.readOptionalInteger(height, "DofPass height", this.height, { min: 1 });
    if (nextWidth === this.width && nextHeight === this.height && this.sceneTarget) {
      return false;
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.sceneTarget?.resize(this.width, this.height);
    this.depthDebugTarget?.resize(this.width, this.height);
    this.focusDebugTarget?.resize(this.width, this.height);
    this.stageDebugTarget?.resize(this.width, this.height);
    this.blurPassSmall?.resize(this.width, this.height);
    this.blurPassMedium?.resize(this.width, this.height);
    this.blurPassLarge?.resize(this.width, this.height);
    this.updateUniforms();
    return true;
  }

  // `resizeToScreen`は座標または数値を計算し、後続処理で使う結果を返す
  resizeToScreen(screen) {
    this.resize(screen.getWidth(), screen.getHeight());
    return this;
  }

  getSceneTarget() {
    return this.sceneTarget;
  }

  getBlurTargetA() {
    return this.blurPassLarge?.getTargetA?.() ?? null;
  }

  getBlurTargetB() {
    return this.blurPassLarge?.getTargetB?.() ?? null;
  }

  getSmallBlurTarget() {
    return this.blurPassSmall?.getOutputTarget?.() ?? null;
  }

  getMediumBlurTarget() {
    return this.blurPassMedium?.getOutputTarget?.() ?? null;
  }

  getLargeBlurTarget() {
    return this.blurPassLarge?.getOutputTarget?.() ?? null;
  }

  getBlurScale() {
    return this.blurScale;
  }

  getDepthDebugTarget() {
    return this.depthDebugTarget;
  }

  getFocusDebugTarget() {
    return this.focusDebugTarget;
  }

  getStageDebugTarget() {
    return this.stageDebugTarget;
  }

  // 利用側はこの pass で scene 全体を一度 offscreen へ描く
  // sampleDepth: true の RenderTarget に描くことで、
  // あとから WGSL が depthTexture として depth を読み返せる
  beginScene(screen, clearColor = screen.clearColor, options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "cameraFrame")) {
      throw new Error("DofPass beginScene no longer accepts cameraFrame; pass renderFrameToken");
    }
    if (Object.prototype.hasOwnProperty.call(options, "view")) {
      throw new Error("DofPass beginScene no longer accepts view; pass renderFrameToken");
    }
    const renderFrameToken = options.renderFrameToken;
    const cameraFrame = resolveRenderFrameTokenCameraFrame(
      renderFrameToken,
      "DofPass beginScene"
    );
    createDofProjectionParams(cameraFrame);
    this.renderFrameToken = renderFrameToken;
    this.cameraFrame = cameraFrame;
    this.sceneTarget.cameraFrame = cameraFrame;
    this.updateUniforms();
    this.resizeToScreen(screen);
    screen.beginPass({
      target: this.sceneTarget,
      clearColor,
      colorLoadOp: "clear",
      depthClear: true,
      timestampWrites: options.timestampWrites
    });
  }

  // 本番の DOF 合成
  // 1. DOF有効かつ staged の場合だけ、sceneTarget から
  //    small / medium / large の3段階blur textureを作る
  //    DOF無効時まで blur pass を走らせると、見た目はscene直通でも
  //    benchmark 上は staged とほぼ同じ負荷になってしまう
  // 2. destination へ新しい pass を開く
  // 3. scene + 3段階blur + depth を読んで最終 color を書く
  runCompositePass(screen, destination = null, clearColor = [0.0, 0.0, 0.0, 1.0], options = {}) {
    let blurSmallTarget = this.sceneTarget;
    let blurMediumTarget = this.sceneTarget;
    let blurLargeTarget = this.sceneTarget;
    if (this.enabled && this.dofMode === "staged") {
      blurSmallTarget = this.blurPassSmall.render(screen, this.sceneTarget, {
        iterations: this.stageBlurIterations.small,
        blurRadius: this.blurRadius * DOF_STAGE_RADIUS_SCALES.small
      });
      blurMediumTarget = blurSmallTarget;
      blurLargeTarget = blurMediumTarget;
      if (this.stagedStageCount >= 2) {
        blurMediumTarget = this.blurPassMedium.render(screen, this.sceneTarget, {
          iterations: this.stageBlurIterations.medium,
          blurRadius: this.blurRadius * DOF_STAGE_RADIUS_SCALES.medium
        });
        blurLargeTarget = blurMediumTarget;
      }
      if (this.stagedStageCount >= 3) {
        blurLargeTarget = this.blurPassLarge.render(screen, this.sceneTarget, {
          iterations: this.stageBlurIterations.large,
          blurRadius: this.blurRadius * DOF_STAGE_RADIUS_SCALES.large
        });
      }
    }
    screen.beginPass({
      target: destination,
      clearColor,
      colorLoadOp: "clear",
      depthView: null,
      timestampWrites: options.timestampWrites
    });
    const pass = this.gpu.passEncoder;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.createBindGroup(
      this.sceneTarget,
      blurSmallTarget,
      blurMediumTarget,
      blurLargeTarget,
      this.sceneTarget
    ));
    this.drawQuad(pass);
  }

  // depth の見え方を白黒で確認する pass
  // projection range が合っていない時はここで違和感が見つけやすい
  runDepthDebugPass(screen) {
    screen.beginPass({
      target: this.depthDebugTarget,
      clearColor: [0.0, 0.0, 0.0, 1.0],
      colorLoadOp: "clear",
      depthView: null
    });
    const pass = this.gpu.passEncoder;
    pass.setPipeline(this.depthDebugPipeline);
    pass.setBindGroup(0, this.createDepthDebugBindGroup(this.sceneTarget));
    this.drawQuad(pass);
  }

  // focusDistance / focusRange が scene のどこに掛かっているかを色分けして確認する pass
  runFocusDebugPass(screen) {
    screen.beginPass({
      target: this.focusDebugTarget,
      clearColor: [0.0, 0.0, 0.0, 1.0],
      colorLoadOp: "clear",
      depthView: null
    });
    const pass = this.gpu.passEncoder;
    pass.setPipeline(this.focusDebugPipeline);
    pass.setBindGroup(0, this.createDepthDebugBindGroup(this.sceneTarget));
    this.drawQuad(pass);
  }

  // scene / small / medium / large のどの段階が選ばれるかを色分けして確認する pass
  runStageDebugPass(screen) {
    screen.beginPass({
      target: this.stageDebugTarget,
      clearColor: [0.0, 0.0, 0.0, 1.0],
      colorLoadOp: "clear",
      depthView: null
    });
    const pass = this.gpu.passEncoder;
    pass.setPipeline(this.stageDebugPipeline);
    pass.setBindGroup(0, this.createDepthDebugBindGroup(this.sceneTarget));
    this.drawQuad(pass);
  }

  // render() は DofPass 全体の出力フローをまとめた入口
  // debug target を先に更新しておくことで、
  // 利用側は render() 後にそれらをそのまま UI へ表示できる
  render(screen, options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "cameraFrame")) {
      throw new Error("DofPass render no longer accepts cameraFrame; pass renderFrameToken");
    }
    if (Object.prototype.hasOwnProperty.call(options, "view")) {
      throw new Error("DofPass render no longer accepts view; pass renderFrameToken");
    }
    const renderFrameToken = options.renderFrameToken;
    const cameraFrame = resolveRenderFrameTokenCameraFrame(
      renderFrameToken,
      "DofPass render"
    );
    createDofProjectionParams(cameraFrame);
    if (
      renderFrameToken !== this.renderFrameToken
      || cameraFrame !== this.cameraFrame
      || cameraFrame !== this.sceneTarget?.cameraFrame
    ) {
      throw new Error("DofPass render requires the same renderFrameToken used by beginScene");
    }
    const destination = options.destination;
    const clearColor = options.clearColor;
    this.runDepthDebugPass(screen);
    this.runFocusDebugPass(screen);
    this.runStageDebugPass(screen);
    this.runCompositePass(screen, destination, clearColor, {
      timestampWrites: options.timestampWrites
    });
  }
}
