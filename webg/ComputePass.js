// ---------------------------------------------
// ComputePass.js  2026/06/14
//   Compute Pass wrapper
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";

export const DEFAULT_COMPUTE_WORKGROUP_SIZE = Object.freeze([8, 8, 1]);
export const DEFAULT_STORAGE_TEXTURE_FORMAT = "rgba8unorm";

// WGSL、明示的binding、pipeline、dispatchを一つの契約として管理します
// command encoderとsubmitは呼び出し側が所有し、Render Passとの実行順をこのクラスへ推測させません
export default class ComputePass {
  // WebGPU contextとshader定義を検証し、内部Uniform BufferとCompute Pipelineを生成します
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputePass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.label = util.readOptionalString(
      options.label,
      "ComputePass label",
      "compute-pass",
      { trim: true, allowEmpty: false }
    );
    this.code = util.readOptionalString(
      options.code,
      `${this.label} code`,
      undefined,
      { allowEmpty: false }
    );
    if (this.code === undefined) {
      throw new Error(`${this.label} requires WGSL code`);
    }
    this.entryPoint = util.readOptionalString(
      options.entryPoint,
      `${this.label} entryPoint`,
      "main",
      { trim: true, allowEmpty: false }
    );
    this.workgroupSize = this.validateWorkgroupSize(
      options.workgroupSize ?? DEFAULT_COMPUTE_WORKGROUP_SIZE
    );
    this.bindings = this.validateBindings(options.bindings);
    this.uniformBinding = this.bindings.find(
      (definition) => definition.type === "uniform-buffer"
    ) ?? null;
    this.dispatchBinding = this.bindings.find(
      (definition) => definition.dispatchSize === true
    ) ?? null;
    this.uniformFloats = this.uniformBinding
      ? util.readOptionalInteger(
        options.uniformFloats,
        `${this.label} uniformFloats`,
        16,
        { min: 1 }
      )
      : 0;
    if (!this.uniformBinding && options.uniformFloats !== undefined) {
      throw new Error(`${this.label} uniformFloats requires a uniform-buffer binding`);
    }
    this.uniformData = this.uniformBinding
      ? new Float32Array(this.uniformFloats)
      : null;
    this.uniformBuffer = this.uniformBinding
      ? this.device.createBuffer({
        label: `${this.label}:uniforms`,
        size: this.uniformData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })
      : null;
    this.bindGroupLayout = this.createBindGroupLayout();
    this.shaderModule = this.device.createShaderModule({
      label: `${this.label}:shader`,
      code: this.code
    });
    this.pipeline = this.device.createComputePipeline({
      label: `${this.label}:pipeline`,
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      }),
      compute: {
        module: this.shaderModule,
        entryPoint: this.entryPoint
      }
    });
    this.destroyed = false;
  }

  // WGSLのworkgroup_sizeと一致するX、Y、Zの正整数を検証します
  // 配列不足や小数を既定の8x8x1へ補正せず、pipeline定義の不一致として例外にします
  validateWorkgroupSize(value) {
    if (!Array.isArray(value) || value.length !== 3) {
      throw new Error(`${this.label} workgroupSize must be a 3 element array`);
    }
    return value.map((entry, index) => util.readFiniteNumber(
      entry,
      `${this.label} workgroupSize[${index}]`,
      { integer: true, min: 1 }
    ));
  }

  // binding番号、名前、type、内部Uniform数、dispatch基準の重複を検証します
  // dispatch基準は明示寸法を使うpassでは不要なので0件または1件を許可します
  validateBindings(bindings) {
    if (!Array.isArray(bindings) || bindings.length === 0) {
      throw new Error(`${this.label} requires explicit bindings`);
    }
    const bindingNumbers = new Set();
    const bindingNames = new Set();
    const supportedTypes = new Set([
      "uniform-buffer",
      "read-only-storage-buffer",
      "storage-buffer",
      "sampled-texture",
      "depth-texture",
      "sampler",
      "storage-texture"
    ]);
    let uniformCount = 0;
    let dispatchCount = 0;
    const validated = bindings.map((definition) => {
      if (!definition || !Number.isInteger(definition.binding) || definition.binding < 0) {
        throw new Error(`${this.label} binding number must be a non-negative integer`);
      }
      if (typeof definition.name !== "string" || definition.name.length === 0) {
        throw new Error(`${this.label} binding ${definition.binding} requires a name`);
      }
      if (!supportedTypes.has(definition.type)) {
        throw new Error(
          `${this.label} binding ${definition.name} has unsupported type: ${definition.type}`
        );
      }
      if (bindingNumbers.has(definition.binding)) {
        throw new Error(`${this.label} has duplicate binding number: ${definition.binding}`);
      }
      if (bindingNames.has(definition.name)) {
        throw new Error(`${this.label} has duplicate binding name: ${definition.name}`);
      }
      bindingNumbers.add(definition.binding);
      bindingNames.add(definition.name);
      if (definition.type === "uniform-buffer") uniformCount += 1;
      if (definition.dispatchSize === true) dispatchCount += 1;
      return { ...definition };
    });
    if (uniformCount > 1) {
      throw new Error(`${this.label} supports at most one internal uniform buffer`);
    }
    if (dispatchCount > 1) {
      throw new Error(`${this.label} supports at most one dispatchSize binding`);
    }
    return validated.sort((a, b) => a.binding - b.binding);
  }

  // 明示的binding定義をWebGPUのBindGroupLayoutEntryへ変換します
  createLayoutEntry(definition) {
    const entry = {
      binding: definition.binding,
      visibility: GPUShaderStage.COMPUTE
    };
    if (definition.type === "uniform-buffer") {
      entry.buffer = { type: "uniform" };
    } else if (definition.type === "read-only-storage-buffer") {
      entry.buffer = { type: "read-only-storage" };
    } else if (definition.type === "storage-buffer") {
      entry.buffer = { type: "storage" };
    } else if (definition.type === "sampled-texture") {
      entry.texture = {
        sampleType: definition.sampleType ?? "float",
        viewDimension: definition.viewDimension ?? "2d",
        multisampled: definition.multisampled ?? false
      };
    } else if (definition.type === "depth-texture") {
      entry.texture = {
        sampleType: "depth",
        viewDimension: definition.viewDimension ?? "2d",
        multisampled: definition.multisampled ?? false
      };
    } else if (definition.type === "sampler") {
      entry.sampler = { type: definition.samplerType ?? "filtering" };
    } else if (definition.type === "storage-texture") {
      entry.storageTexture = {
        access: definition.access ?? "write-only",
        format: definition.format ?? DEFAULT_STORAGE_TEXTURE_FORMAT,
        viewDimension: definition.viewDimension ?? "2d"
      };
    }
    return entry;
  }

  // binding番号順のlayoutを生成し、WGSLとの対応を配列位置から推測しません
  createBindGroupLayout() {
    return this.device.createBindGroupLayout({
      label: `${this.label}:layout`,
      entries: this.bindings.map((definition) => this.createLayoutEntry(definition))
    });
  }

  // WGSL Uniform構造体と完全に同じfloat数だけを受け付けます
  // 短い配列の0埋めや長い配列の切り捨てを行わず、layoutずれを例外にします
  setUniforms(values) {
    this.requireAlive();
    if (!this.uniformBuffer) {
      throw new Error(`${this.label} has no uniform-buffer binding`);
    }
    if (!(values instanceof Float32Array) && !Array.isArray(values)) {
      throw new Error(`${this.label} uniforms must be an Array or Float32Array`);
    }
    if (values.length !== this.uniformFloats) {
      throw new Error(
        `${this.label} uniforms length must be ${this.uniformFloats}: ${values.length}`
      );
    }
    this.uniformData.set(values);
    this.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  // named resourceをbinding typeが要求するGPU resource表現へ変換します
  resolveBindingResource(definition, resources) {
    if (definition.type === "uniform-buffer") {
      return { buffer: this.uniformBuffer };
    }
    if (!Object.prototype.hasOwnProperty.call(resources, definition.name)) {
      throw new Error(`${this.label} requires resource: ${definition.name}`);
    }
    const resource = resources[definition.name];
    if (!resource) {
      throw new Error(`${this.label} resource is empty: ${definition.name}`);
    }
    if (
      definition.type === "read-only-storage-buffer" ||
      definition.type === "storage-buffer"
    ) {
      return resource.buffer ? resource : { buffer: resource };
    }
    if (definition.type === "sampled-texture") {
      return resource.getView?.() ?? resource.getColorView?.() ?? resource;
    }
    if (definition.type === "depth-texture") {
      return resource.getDepthSampleView?.() ?? resource.getDepthView?.() ?? resource;
    }
    if (definition.type === "storage-texture") {
      return resource.getView?.() ?? resource.getColorView?.() ?? resource;
    }
    return resource;
  }

  // resourceのwidth、height、depthからinvocation数を取得します
  getResourceDispatchSize(resources) {
    if (!this.dispatchBinding) {
      throw new Error(`${this.label} requires dispatchSize option or binding`);
    }
    const resource = resources[this.dispatchBinding.name];
    const width = resource?.getWidth?.() ?? resource?.width;
    const height = resource?.getHeight?.() ?? resource?.height ?? 1;
    const depth = resource?.getDepth?.() ?? resource?.depth ?? 1;
    return this.validateDispatchSize([width, height, depth]);
  }

  // invocation数をX、Y、Zの正整数として検証します
  validateDispatchSize(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
      throw new Error(`${this.label} dispatchSize must be a 1 to 3 element array`);
    }
    const expanded = [value[0], value[1] ?? 1, value[2] ?? 1];
    return expanded.map((entry, index) => util.readFiniteNumber(
      entry,
      `${this.label} dispatchSize[${index}]`,
      { integer: true, min: 1 }
    ));
  }

  // 指定command encoderへCompute Passを追加し、command bufferのsubmitは行いません
  // timestampWritesは呼び出し側が計測範囲を決め、明示寸法はresource基準より優先します
  encode(commandEncoder, resources, options = {}) {
    this.requireAlive();
    if (!commandEncoder?.beginComputePass) {
      throw new Error(`${this.label} requires a GPUCommandEncoder`);
    }
    if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
      throw new Error(`${this.label} encode requires a named resource object`);
    }
    const dispatchSize = options.dispatchSize === undefined
      ? this.getResourceDispatchSize(resources)
      : this.validateDispatchSize(options.dispatchSize);
    const entries = this.bindings.map((definition) => ({
      binding: definition.binding,
      resource: this.resolveBindingResource(definition, resources)
    }));
    const bindGroup = this.device.createBindGroup({
      label: `${this.label}:bind-group`,
      layout: this.bindGroupLayout,
      entries
    });
    const pass = commandEncoder.beginComputePass({
      label: this.label,
      timestampWrites: options.timestampWrites
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(dispatchSize[0] / this.workgroupSize[0]),
      Math.ceil(dispatchSize[1] / this.workgroupSize[1]),
      Math.ceil(dispatchSize[2] / this.workgroupSize[2])
    );
    pass.end();
    return resources[this.dispatchBinding?.name] ?? null;
  }

  // 破棄後のencodeやuniform更新を早期に検出します
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  // このpassが所有する内部Uniform Bufferを破棄します
  // shader module、pipeline、layoutはWebGPUに明示destroy APIがないため参照を解放します
  destroy() {
    if (this.destroyed) {
      return false;
    }
    this.uniformBuffer?.destroy();
    this.uniformBuffer = null;
    this.uniformData = null;
    this.pipeline = null;
    this.shaderModule = null;
    this.bindGroupLayout = null;
    this.destroyed = true;
    return true;
  }
}
