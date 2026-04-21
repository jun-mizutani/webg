// ---------------------------------------------
//  VignettePass.js  2026/04/21
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import FullscreenPass from "./FullscreenPass.js";

export default class VignettePass extends FullscreenPass {

  // 最終 color texture の周辺だけを減衰させる最小 postprocess
  // renderer 本体へ追加の scene pass を要求せず、
  // 既存の offscreen target や canvas 出力へそのまま重ねられる形に保つ
  constructor(gpu, options = {}) {
    super(gpu, options);

    // FullscreenPass の colorScale / uvScale / uvOffset に加え、
    // vignette 固有の center / radius / softness / strength / enabled / tint を持つ
    // vec4 単位でそろえておくことで WGSL 側の struct 配置を読みやすくする
    this.uniformData = new Float32Array(20);
    this.OFF_COLOR_SCALE = 0;
    this.OFF_UV_SCALE_OFFSET = 4;
    this.OFF_VIGNETTE = 8;
    this.OFF_FLAGS = 12;
    this.OFF_TINT = 16;

    this.setColorScale(1.0, 1.0, 1.0, 1.0);
    this.setUvScale(1.0, 1.0);
    this.setUvOffset(0.0, 0.0);
    this.setCenter(options.centerX ?? 0.5, options.centerY ?? 0.5);
    this.setRadius(options.radius ?? 0.9);
    this.setSoftness(options.softness ?? 0.35);
    this.setStrength(options.strength ?? 0.65);
    this.setEnabled(options.enabled !== false);
    this.setTint(...(options.tint ?? [0.0, 0.0, 0.0, 1.0]));
  }

  // FullscreenPass の単純 copy shader を、周辺減衰付きの shader へ差し替える
  createResources() {
    const shaderCode = `
struct Uniforms {
  colorScale : vec4f,
  uvScaleOffset : vec4f,
  vignette : vec4f,
  flags : vec4f,
  tint : vec4f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var uTexture : texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

struct VSIn {
  @location(0) position : vec2f,
  @location(1) texCoord : vec2f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) vTexCoord : vec2f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.vTexCoord = input.texCoord * uniforms.uvScaleOffset.xy + uniforms.uvScaleOffset.zw;
  return output;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let sampled = textureSample(uTexture, uSampler, input.vTexCoord) * uniforms.colorScale;
  if (uniforms.flags.y < 0.5) {
    return sampled;
  }

  let dims = textureDimensions(uTexture);
  let aspect = f32(dims.x) / max(f32(dims.y), 1.0);
  var delta = input.vTexCoord - uniforms.vignette.xy;
  delta.x *= aspect;

  let outerRadius = max(uniforms.vignette.z, 0.0001);
  let softness = clamp(uniforms.vignette.w, 0.0001, outerRadius);
  let innerRadius = max(outerRadius - softness, 0.0);
  let dist = length(delta);
  let edge = smoothstep(innerRadius, outerRadius, dist);
  let strength = clamp(uniforms.flags.x, 0.0, 1.0);
  let tintMix = edge * strength;
  let tinted = sampled.rgb * mix(vec3f(1.0), uniforms.tint.rgb, tintMix);
  return vec4f(tinted, sampled.a);
}`;

    const module = this.createShaderModule(shaderCode);
    this.bindGroupLayout = this.createUniformTextureBindGroupLayout({
      hasDynamicOffset: false
    });
    const pipelineLayout = this.createPipelineLayout([this.bindGroupLayout]);

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 4 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 2 * 4, format: "float32x2" }
            ]
          }
        ]
      },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [{
          format: this.targetFormat,
          blend: this.resolveBlendState()
        }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    });

    this.createUniformBuffer(this.uniformData.byteLength);
    this.createDefaultTexture({
      width: 64,
      height: 1,
      samplerDescriptor: {
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear"
      }
    });
    this.makeQuad();
    this.updateUniforms();
  }

  setColorScale(r, g, b, a = 1.0) {
    const offset = Number.isFinite(this.OFF_COLOR_SCALE) ? this.OFF_COLOR_SCALE : 0;
    this.uniformData.set([r, g, b, a], offset);
    this.updateUniforms();
  }

  setUvScale(u, v) {
    const offset = Number.isFinite(this.OFF_UV_SCALE_OFFSET) ? this.OFF_UV_SCALE_OFFSET : 4;
    this.uniformData[offset + 0] = u;
    this.uniformData[offset + 1] = v;
    this.updateUniforms();
  }

  setUvOffset(u, v) {
    const offset = Number.isFinite(this.OFF_UV_SCALE_OFFSET) ? this.OFF_UV_SCALE_OFFSET : 4;
    this.uniformData[offset + 2] = u;
    this.uniformData[offset + 3] = v;
    this.updateUniforms();
  }

  // vignette 中心を UV 基準で指定する
  // 0.5, 0.5 が画面中心に対応する
  setCenter(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("VignettePass.setCenter requires finite x/y");
    }
    this.uniformData[this.OFF_VIGNETTE + 0] = x;
    this.uniformData[this.OFF_VIGNETTE + 1] = y;
    this.updateUniforms();
  }

  // vignette が完全に掛かり切る外周半径
  // 0.5 付近だと中心寄りから暗くなり、1.0 に近いほど周辺だけに寄る
  setRadius(value) {
    this.uniformData[this.OFF_VIGNETTE + 2] = Number(value);
    this.updateUniforms();
  }

  // 内側の保持領域から外周まで、どれだけ滑らかに落とすかを決める
  // 値が小さいほど境界が硬く、大きいほど広い範囲でなだらかに暗くなる
  setSoftness(value) {
    this.uniformData[this.OFF_VIGNETTE + 3] = Number(value);
    this.updateUniforms();
  }

  // vignette の効きの強さ
  // 0 で無効、1 で tint 色まで完全に寄せる
  setStrength(value) {
    this.uniformData[this.OFF_FLAGS + 0] = Number(value);
    this.updateUniforms();
  }

  setEnabled(flag) {
    this.uniformData[this.OFF_FLAGS + 1] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // 周辺へ寄せる色
  // 既定は黒なので、一般的な暗い vignette になる
  // sepia 風などを試したい場合は黒以外へも変えられる
  setTint(r, g, b, a = 1.0) {
    this.uniformData.set([r, g, b, a], this.OFF_TINT);
    this.updateUniforms();
  }

  // source を読み、canvas または destination target へ vignette を描く
  // postprocess の最後段だけでなく、中間 target へ書いて次段へ渡す使い方もできる
  render(screen, options = {}) {
    const source = options.source;
    const destination = options.destination;
    const clearColor = options.clearColor;
    const colorLoadOp = options.colorLoadOp;
    if (source) {
      this.setSource(source);
    }
    screen.beginPass({
      target: destination,
      clearColor,
      colorLoadOp,
      depthView: null
    });
    this.draw(source);
    return destination;
  }
}
