// ---------------------------------------------
// TransparencyPass.js  2026/07/25
//   Sorted translucent triangle composition for deferred scenes
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import ComputePass from "./ComputePass.js";
import ComputeImagePyramid from "./ComputeImagePyramid.js?v=20260723_image_pyramid";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import { DEFERRED_LIGHTING_OUTPUT_FORMAT } from "./DeferredLightingPass.js";
import RenderTarget from "./RenderTarget.js";
import SmoothShader from "./SmoothShader.js";
import util from "./util.js";

export const FROST_PYRAMID_LEVELS = Object.freeze([2, 4, 8]);

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
  let halfColor = textureSampleLevel(halfTexture, frostSampler, uv, 0.0);
  let quarterColor = textureSampleLevel(quarterTexture, frostSampler, uv, 0.0);
  let eighthColor = textureSampleLevel(eighthTexture, frostSampler, uv, 0.0);
  if (levelPosition < 1.0) {
    return mix(sceneColor, halfColor, levelPosition);
  }
  if (levelPosition < 2.0) {
    return mix(halfColor, quarterColor, levelPosition - 1.0);
  }
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
  // 最大roughnessは1/8へ到達し、隣接Level間だけを線形補間して段階境界を隠します
  let roughnessAmount = clamp((roughness - 0.04) / 0.96, 0.0, 1.0);
  let levelPosition = roughnessAmount * 3.0;
  let frostedBackground = selectFrostBackground(sceneColor, uv, levelPosition);
  textureStore(outputTexture, pixel, frostedBackground);
}
`;

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
    this.roughnessMaskShader = new SmoothShader(gpu, {
      colorFormat: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      depthWriteEnabled: false,
      roughnessMask: true
    });
    this.shader = new SmoothShader(gpu, {
      colorFormat: DEFERRED_LIGHTING_OUTPUT_FORMAT,
      depthWriteEnabled: false,
      roughnessSpecular: true
    });
    this.ready = Promise.all([
      this.outputTarget.ready,
      this.roughnessMaskTarget.ready,
      this.frostPyramid.ready,
      this.roughnessMaskShader.init(),
      this.shader.init()
    ]);
    this.destroyed = false;
  }

  // 入力scene、G-buffer depth、Space、Camera Frameが同じframe寸法とReverse-Z契約か検証する
  validateInputs(scene, depth, space, cameraFrame) {
    if (!scene || typeof scene.getView !== "function") {
      throw new Error(`${this.label} requires a scene color target`);
    }
    if (!depth || typeof depth.getDepthView !== "function") {
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

    // 透明合成前のHDR sceneから1/2、1/4、1/8 Levelを連続low-passで作ります
    // 透明layer同士の交差・循環と同様、手前の透明面が背後の透明面だけを再blurする処理は対象外とする
    this.frostPyramid.encode(commandEncoder, scene);
    const half = this.frostPyramid.getLevel(2);
    const quarter = this.frostPyramid.getLevel(4);
    const eighth = this.frostPyramid.getLevel(8);

    // opaque depthをloadし、手前の不透明面で隠れた透明triangleをmaskへ書かない
    // colorはmax blendなので、透明面が重なるpixelでは最大roughnessが残る
    const maskPass = commandEncoder.beginRenderPass({
      label: `${this.label}:roughness-mask-pass`,
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

    // Frost背景はmaterial Alphaを使わずroughness maskだけで合成する
    // この時点では透明surface色とSpecularを加えず、次のsorted passへ役割を分ける
    this.frostCompositePass.encode(commandEncoder, {
      scene,
      half,
      quarter,
      eighth,
      roughnessMask: this.roughnessMaskTarget,
      sampler: half.getSampler(),
      output: this.outputTarget
    });

    const pass = commandEncoder.beginRenderPass({
      label: `${this.label}:transparent-pass`,
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
    if (resources.ambient !== undefined) {
      this.shader.setDefaultParam("ambient", util.readFiniteNumber(
        resources.ambient,
        `${this.label} ambient`,
        { min: 0.0, max: 1.0 }
      ));
    }
    try {
      space.draw(cameraFrame, {
        onlyTranslucent: true,
        shaderOverride: this.shader,
        ...(resources.lightOverride === undefined
          ? {}
          : { lightOverride: resources.lightOverride })
      });
    } finally {
      pass.end();
      this.gpu.passEncoder = null;
    }
    return this.outputTarget;
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
    this.shader.destroy();
    this.roughnessMaskShader.destroy();
    this.frostCompositePass.destroy();
    this.frostPyramid.destroy();
    this.roughnessMaskTarget.destroy();
    this.outputTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
