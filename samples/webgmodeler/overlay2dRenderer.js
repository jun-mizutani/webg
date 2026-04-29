// ---------------------------------------------
// samples/webgmodeler/overlay2dRenderer.js  2026/04/29
//   webgmodeler clip-space 2D overlay renderer
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
export default class Overlay2DRenderer {
  // インスタンス生成時に renderer や shader が使う状態を初期化する
  constructor(gpu, {
    initialVertexCapacity = 4096
  } = {}) {
    this.gpu = gpu;
    this.device = null;
    this.vertexStrideFloats = 9;
    this.vertexStrideBytes = this.vertexStrideFloats * Float32Array.BYTES_PER_ELEMENT;
    this.vertexCapacity = initialVertexCapacity;
    this.markerVertices = [];
    this.uploadData = new Float32Array(this.vertexCapacity * this.vertexStrideFloats);
    this.bufferDirty = true;
    this.markerBuffer = null;
    this.markerPipeline = null;
  }

  // WebGPU resource を作る前に GPU の準備完了を待ち、必要な buffer や pipeline を初期化する
  async init() {
    if (this.gpu?.ready) {
      await this.gpu.ready;
    }
    this.device = this.gpu.device;
    this.markerBuffer = this.createVertexBuffer(this.vertexCapacity, "overlay2d-marker-buffer");
    this.createPipelines();
  }

  // 頂点数に応じた WebGPU vertex buffer を作成する
  createVertexBuffer(vertexCapacity, label) {
    return this.device.createBuffer({
      label,
      size: vertexCapacity * this.vertexStrideBytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
  }

  // overlay 用の shader module と render pipeline 群を作成する
  createPipelines() {
    const vertexBuffers = [
      {
        arrayStride: this.vertexStrideBytes,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 3 * 4, format: "float32x2" },
          { shaderLocation: 2, offset: 5 * 4, format: "float32x4" }
        ]
      }
    ];
    const targets = [
      {
        format: this.gpu.format,
        blend: {
          color: {
            srcFactor: "src-alpha",
            dstFactor: "one-minus-src-alpha",
            operation: "add"
          },
          alpha: {
            srcFactor: "one",
            dstFactor: "one-minus-src-alpha",
            operation: "add"
          }
        }
      }
    ];
    const primitive = {
      topology: "triangle-list",
      cullMode: "none"
    };
    const depthStencil = {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less-equal"
    };

    const markerModule = this.device.createShaderModule({
      code: `
struct VSIn {
  @location(0) clip : vec3f,
  @location(1) local : vec2f,
  @location(2) color : vec4f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) color : vec4f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = vec4f(input.clip.xy, input.clip.z, 1.0);
  out.local = input.local;
  out.color = input.color;
  return out;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let d = length(input.local);
  if (d > 1.0) {
    discard;
  }
  let edge = smoothstep(1.0, 0.74, d);
  return vec4f(input.color.rgb, input.color.a * edge);
}`
    });

    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [] });
    this.markerPipeline = this.device.createRenderPipeline({
      layout,
      vertex: { module: markerModule, entryPoint: "vsMain", buffers: vertexBuffers },
      fragment: { module: markerModule, entryPoint: "fsMain", targets },
      primitive,
      depthStencil
    });
  }

  // 次の再構築に備えて CPU 側の描画データを空にする
  clear() {
    this.markerVertices.length = 0;
    this.bufferDirty = true;
  }

  // 1 頂点分の position と color を描画用配列へ追加する
  pushVertex(list, x, y, z, lx, ly, color) {
    list.push(
      x, y, z,
      lx, ly,
      color[0], color[1], color[2], color[3]
    );
    this.bufferDirty = true;
  }

  // screen-space の円 marker を 2 枚の三角形として追加する
  addMarker(x, y, z, radiusNdcX, radiusNdcY, color) {
    const left = x - radiusNdcX;
    const right = x + radiusNdcX;
    const bottom = y - radiusNdcY;
    const top = y + radiusNdcY;
    const v = this.markerVertices;
    this.pushVertex(v, left, bottom, z, -1, -1, color);
    this.pushVertex(v, right, bottom, z, 1, -1, color);
    this.pushVertex(v, right, top, z, 1, 1, color);
    this.pushVertex(v, left, bottom, z, -1, -1, color);
    this.pushVertex(v, right, top, z, 1, 1, color);
    this.pushVertex(v, left, top, z, -1, 1, color);
  }

  // 現在の頂点数を収められるよう GPU buffer 容量を必要に応じて拡張する
  ensureCapacity(vertexCount) {
    if (vertexCount <= this.vertexCapacity) {
      return;
    }
    while (this.vertexCapacity < vertexCount) {
      this.vertexCapacity *= 2;
    }
    this.markerBuffer?.destroy?.();
    this.markerBuffer = this.createVertexBuffer(this.vertexCapacity, "overlay2d-marker-buffer");
    this.uploadData = new Float32Array(this.vertexCapacity * this.vertexStrideFloats);
    this.bufferDirty = true;
  }

  // 指定された頂点配列を GPU へ upload して pipeline で描画する
  drawList(vertices, pipeline) {
    const vertexCount = vertices.length / this.vertexStrideFloats;
    if (vertexCount <= 0) {
      return;
    }
    this.ensureCapacity(vertexCount);
    if (this.bufferDirty) {
      this.uploadData.set(vertices);
      const data = this.uploadData.subarray(0, vertices.length);
      this.gpu.queue.writeBuffer(this.markerBuffer, 0, data.buffer, data.byteOffset, data.byteLength);
      this.bufferDirty = false;
    }
    const pass = this.gpu.passEncoder;
    if (!pass) {
      return;
    }
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, this.markerBuffer);
    pass.draw(vertexCount, 1, 0, 0);
  }

  // 蓄積済みの overlay 頂点を現在の render pass へ描画する
  draw() {
    this.drawList(this.markerVertices, this.markerPipeline);
  }
}
