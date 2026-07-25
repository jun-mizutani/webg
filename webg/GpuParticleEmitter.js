// ---------------------------------------------
// GpuParticleEmitter.js  2026/07/12
//   GPU particle simulation and instanced billboard renderer
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";
import { CAMERA_REVERSE_Z, requireDepthConvention } from "./DepthConvention.js";

const DEFAULT_QUAD_VERTICES = new Float32Array([
  -1.0, -1.0,
   1.0, -1.0,
  -1.0,  1.0,
  -1.0,  1.0,
   1.0, -1.0,
   1.0,  1.0
]);

// Storage Buffer上の粒子状態をCompute Shaderで更新し、同じBufferからinstance描画する
// 粒子構造とsimulation式はWGSLとして外部から受け取り、GPU resourceとcommand encodeを担当する
export default class GpuParticleEmitter {
  // 粒子数、stride、初期値、shader、描画formatを検証してGPU resourceを構築する
  // 不足したshaderや初期値を空データへ置き換えず、pipeline作成前に設定誤りとして例外にする
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("GpuParticleEmitter requires a WebGPU context");
    }
    this.gpu = gpu;
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.label = util.readOptionalString(
      options.label,
      "GpuParticleEmitter label",
      "gpu-particle-emitter",
      { allowEmpty: false }
    );
    this.particleCount = util.readOptionalInteger(
      options.particleCount,
      `${this.label} particleCount`,
      1,
      { min: 1 }
    );
    this.floatsPerParticle = util.readOptionalInteger(
      options.floatsPerParticle,
      `${this.label} floatsPerParticle`,
      1,
      { min: 1 }
    );
    this.workgroupSize = util.readOptionalInteger(
      options.workgroupSize,
      `${this.label} workgroupSize`,
      64,
      { min: 1 }
    );
    this.paramFloats = util.readOptionalInteger(
      options.paramFloats,
      `${this.label} paramFloats`,
      4,
      { min: 4 }
    );
    this.targetFormat = util.readOptionalString(
      options.targetFormat,
      `${this.label} targetFormat`,
      gpu.format,
      { allowEmpty: false }
    );
    this.depthConvention = requireDepthConvention(
      options.depthConvention,
      `${this.label} depthConvention`
    );
    if (this.depthConvention !== CAMERA_REVERSE_Z) {
      throw new Error(`${this.label} requires CAMERA_REVERSE_Z`);
    }
    this.depthFormat = this.depthConvention.format;
    this.coordinateSpace = util.readOptionalEnum(
      options.coordinateSpace,
      `${this.label} coordinateSpace`,
      undefined,
      ["camera-relative"]
    );
    if (this.coordinateSpace === undefined) {
      throw new Error(`${this.label} coordinateSpace is required`);
    }
    this.computeCode = util.readOptionalString(
      options.computeCode,
      `${this.label} computeCode`,
      undefined,
      { allowEmpty: false }
    );
    this.renderCode = util.readOptionalString(
      options.renderCode,
      `${this.label} renderCode`,
      undefined,
      { allowEmpty: false }
    );
    if (this.computeCode === undefined) {
      throw new Error(`${this.label} computeCode is required`);
    }
    if (this.renderCode === undefined) {
      throw new Error(`${this.label} renderCode is required`);
    }

    this.initialData = this.validateInitialData(options.initialData);
    this.quadVertices = this.validateQuadVertices(
      options.quadVertices ?? DEFAULT_QUAD_VERTICES
    );
    this.paramData = new Float32Array(this.paramFloats);
    this.destroyed = false;
    this.createResources();
  }

  // destroy()後のEmitterへGPU commandやBuffer参照を要求していないか確認する
  // 破棄済みresourceを暗黙に作り直さず、ライフサイクル違反を呼び出し位置で例外にする
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} has been destroyed`);
    }
  }

  // Particle 1件のstrideと粒子数に一致するFloat32Arrayであることを確認する
  // 配列長が不足または過剰な場合はBuffer末尾の未定義領域を作らず例外にする
  validateInitialData(data) {
    if (!(data instanceof Float32Array)) {
      throw new Error(`${this.label} initialData must be a Float32Array`);
    }
    const expected = this.particleCount * this.floatsPerParticle;
    if (data.length !== expected) {
      throw new Error(
        `${this.label} initialData length must be ${expected}: ${data.length}`
      );
    }
    return data;
  }

  // billboard quadはvec2頂点でtriangle-listを構成できるFloat32Arrayとして検証する
  // 奇数要素や3頂点未満を暗黙に切り捨てず、vertex buffer作成前に例外にする
  validateQuadVertices(vertices) {
    if (!(vertices instanceof Float32Array)) {
      throw new Error(`${this.label} quadVertices must be a Float32Array`);
    }
    if (vertices.length < 6 || vertices.length % 2 !== 0) {
      throw new Error(`${this.label} quadVertices must contain vec2 triangle vertices`);
    }
    const vertexCount = vertices.length / 2;
    if (vertexCount % 3 !== 0) {
      throw new Error(`${this.label} quad vertex count must be divisible by 3`);
    }
    return vertices;
  }

  // 粒子、quad、uniform BufferとCompute/Render pipeline、bind groupを順に作る
  // 同じparticle BufferをComputeではread_write、Renderではread-onlyとして明示的に共有する
  createResources() {
    this.particleBuffer = this.device.createBuffer({
      label: `${this.label}:particles`,
      size: this.initialData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.queue.writeBuffer(this.particleBuffer, 0, this.initialData);

    this.quadBuffer = this.device.createBuffer({
      label: `${this.label}:quad`,
      size: this.quadVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.queue.writeBuffer(this.quadBuffer, 0, this.quadVertices);

    this.paramBuffer = this.device.createBuffer({
      label: `${this.label}:params`,
      size: this.paramData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const computeLayout = this.device.createBindGroupLayout({
      label: `${this.label}:compute-layout`,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" }
        }
      ]
    });
    const renderLayout = this.device.createBindGroupLayout({
      label: `${this.label}:render-layout`,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" }
        }
      ]
    });
    const computeModule = this.device.createShaderModule({
      label: `${this.label}:compute-shader`,
      code: this.computeCode
    });
    const renderModule = this.device.createShaderModule({
      label: `${this.label}:render-shader`,
      code: this.renderCode
    });
    this.computePipeline = this.device.createComputePipeline({
      label: `${this.label}:compute-pipeline`,
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [computeLayout]
      }),
      compute: {
        module: computeModule,
        entryPoint: "main"
      }
    });
    this.renderPipeline = this.device.createRenderPipeline({
      label: `${this.label}:render-pipeline`,
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [renderLayout]
      }),
      vertex: {
        module: renderModule,
        entryPoint: "vsMain",
        buffers: [{
          arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }]
        }]
      },
      fragment: {
        module: renderModule,
        entryPoint: "fsMain",
        targets: [{
          format: this.targetFormat,
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
        }]
      },
      primitive: { topology: "triangle-list" },
      depthStencil: {
        format: this.depthFormat,
        depthWriteEnabled: false,
        depthCompare: this.depthConvention.compare
      }
    });
    this.computeBindGroup = this.device.createBindGroup({
      label: `${this.label}:compute-bind-group`,
      layout: computeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.paramBuffer } }
      ]
    });
    this.renderBindGroup = this.device.createBindGroup({
      label: `${this.label}:render-bind-group`,
      layout: renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.paramBuffer } }
      ]
    });
  }

  // WGSLのuniform構造体と同じfloat数を要求し、現在frameの値をGPUへ転送する
  // 短い配列を0埋めしたり長い配列を切り捨てず、layout不一致として例外にする
  writeParams(values) {
    this.requireAlive();
    if (!(values instanceof Float32Array)) {
      throw new Error(`${this.label} params must be a Float32Array`);
    }
    if (values.length !== this.paramFloats) {
      throw new Error(`${this.label} params length must be ${this.paramFloats}: ${values.length}`);
    }
    this.paramData.set(values);
    this.queue.writeBuffer(this.paramBuffer, 0, this.paramData);
  }

  // 1 invocationが1粒子を更新するCompute Passを既存command encoderへ追加する
  // command bufferの生成、timestamp queryの開始終了、submitはframe全体を管理するアプリ側へ残す
  encodeCompute(commandEncoder, options = {}) {
    this.requireAlive();
    if (!commandEncoder?.beginComputePass) {
      throw new Error(`${this.label} encodeCompute requires a command encoder`);
    }
    const pass = commandEncoder.beginComputePass({
      label: `${this.label}:compute-pass`,
      timestampWrites: options.timestampWrites
    });
    pass.setPipeline(this.computePipeline);
    pass.setBindGroup(0, this.computeBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.particleCount / this.workgroupSize));
    pass.end();
  }

  // 同じparticle Bufferをvertex shaderから読み、billboard quadをinstance描画する
  // color/depth Viewとclear colorはframeの描画先に依存するため呼び出し側から明示的に受け取る
  encodeRender(commandEncoder, options = {}) {
    this.requireAlive();
    if (!commandEncoder?.beginRenderPass) {
      throw new Error(`${this.label} encodeRender requires a command encoder`);
    }
    if (!options.colorView) {
      throw new Error(`${this.label} encodeRender requires colorView`);
    }
    if (!options.depthView) {
      throw new Error(`${this.label} encodeRender requires depthView`);
    }
    const clearColor = options.clearColor;
    if (!Array.isArray(clearColor) || clearColor.length !== 4) {
      throw new Error(`${this.label} clearColor must contain 4 numbers`);
    }
    const checkedClear = clearColor.map((value, index) =>
      util.readFiniteNumber(value, `${this.label} clearColor[${index}]`)
    );
    const pass = commandEncoder.beginRenderPass({
      label: `${this.label}:render-pass`,
      timestampWrites: options.timestampWrites,
      colorAttachments: [{
        view: options.colorView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: {
          r: checkedClear[0],
          g: checkedClear[1],
          b: checkedClear[2],
          a: checkedClear[3]
        }
      }],
      depthStencilAttachment: {
        view: options.depthView,
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: this.depthConvention.clearValue
      }
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.setVertexBuffer(0, this.quadBuffer);
    pass.draw(this.quadVertices.length / 2, this.particleCount, 0, 0);
    pass.end();
  }

  // emitterが管理する粒子数を返し、Help表示やdiagnosticsでGPU設定値を参照できるようにする
  getParticleCount() {
    this.requireAlive();
    return this.particleCount;
  }

  // Compute dispatchのworkgroup幅を返す
  getWorkgroupSize() {
    this.requireAlive();
    return this.workgroupSize;
  }

  // simulationと描画が共有するparticle Storage Bufferを返す
  getParticleBuffer() {
    this.requireAlive();
    return this.particleBuffer;
  }

  // Emitterが所有するParticle、quad、uniform Bufferを破棄し、GPU resource参照を解放する
  // 複数回呼ばれた場合は最初の呼び出しだけを実行し、既に破棄済みならfalseを返す
  destroy() {
    if (this.destroyed) {
      return false;
    }
    this.particleBuffer.destroy();
    this.quadBuffer.destroy();
    this.paramBuffer.destroy();
    this.particleBuffer = null;
    this.quadBuffer = null;
    this.paramBuffer = null;
    this.computePipeline = null;
    this.renderPipeline = null;
    this.computeBindGroup = null;
    this.renderBindGroup = null;
    this.destroyed = true;
    return true;
  }
}
