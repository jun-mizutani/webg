// ---------------------------------------------
// WaterDepthPass.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 水面computeが書いたr32floatを、後段が共有できるdepth32floatへ転写する
// 深度だけのpassで転写し、画面寸法が変わった場合にdepth textureを再生成する

import { CAMERA_REVERSE_Z } from "./DepthConvention.js";

const CODE = `
@group(0) @binding(0) var source : texture_2d<f32>;
// 全画面を覆う三角形の頂点を生成し、深度転写を全pixelへ実行する
@vertex fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return vec4f(p[i], 0, 1);
}
// 元textureの深度を読み、後段と共有するdepth attachmentへ出力する
@fragment fn fs(@builtin(position) p : vec4f) -> @builtin(frag_depth) f32 {
  return textureLoad(source, vec2i(p.xy), 0).r;
}`;

export default class WaterDepthPass {
  // 深度転写用のshaderとpipelineを作り、画面寸法に合わせた深度textureを確保する
  constructor(gpu, width, height) {
    this.gpu = gpu;
    this.depthConvention = CAMERA_REVERSE_Z;
    this.depthFormat = "depth32float";
    const module = gpu.device.createShaderModule({ label: "water:depth", code: CODE });
    this.pipeline = gpu.device.createRenderPipeline({ label: "water:depth", layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "always" } });
    this.resize(width, height);
  }

  // 現在の寸法と比較し、サイズが変わった段階で描画先のGPU資源を作り直す
  resize(width, height) {
    if (this.width === width && this.height === height) return;
    this.texture?.destroy();
    this.width = width;
    this.height = height;
    this.texture = this.gpu.device.createTexture({ label: "water:depth-target",
      size: [width, height], format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.view = this.texture.createView();
    this.group = this.source = null;
  }

  // 水面計算のr32float深度をdepth attachmentへ転写し、後段へ返す
  // 入力textureが変わった場合にbind groupを更新し、出力寸法も同期する
  encode(encoder, source, timestampWrites) {
    this.resize(source.width, source.height);
    if (this.source !== source.colorTexture) {
      this.group = this.gpu.device.createBindGroup({ label: "water:depth-group",
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: source.getView() }] });
      this.source = source.colorTexture;
    }
    const pass = encoder.beginRenderPass({ label: "water:depth-copy", colorAttachments: [],
      depthStencilAttachment: { view: this.view, depthClearValue: 0,
        depthLoadOp: "clear", depthStoreOp: "store" }, timestampWrites });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(3);
    pass.end();
    return this;
  }

  // 後段の描画passへ渡す深度attachmentのviewを返す
  getDepthView() { return this.view; }
  // 後段のshaderから深度を採取するためのtexture viewを返す
  getDepthSampleView() { return this.view; }
  // 現在の描画先の横幅をpixel単位で返す
  getWidth() { return this.width; }
  // 現在の描画先の高さをpixel単位で返す
  getHeight() { return this.height; }
  // 深度textureを解放し、viewとbind groupの参照を終了状態へ戻す
  destroy() { this.texture?.destroy(); this.texture = this.view = this.group = null; }
}
