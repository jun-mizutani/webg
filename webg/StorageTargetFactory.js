// ---------------------------------------------
// StorageTargetFactory.js  2026/06/14
//   Storage RenderTarget factory
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import RenderTarget from "./RenderTarget.js";
import util from "./util.js";
import PingPongTarget from "./PingPongTarget.js";
import { DEFAULT_STORAGE_TEXTURE_FORMAT } from "./ComputePass.js";

// WebGPU globalが利用可能になった後で既定usageを組み立てます
// Node headless testのmodule評価時にGPUTextureUsageを参照しないため、関数として公開します
export function getDefaultStorageTargetUsage() {
  return GPUTextureUsage.STORAGE_BINDING |
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC;
}

// Storage Textureとして書き込み、後段からsampleできるRenderTargetの生成条件を管理します
export default class StorageTargetFactory {
  // WebGPU context、format、usageを検証し、以後のtarget生成規則を固定します
  constructor(gpu, options = {}) {
    if (!gpu) {
      throw new Error("StorageTargetFactory requires a WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "StorageTargetFactory label",
      "storage-target",
      { trim: true, allowEmpty: false }
    );
    this.format = util.readOptionalString(
      options.format,
      `${this.label} format`,
      DEFAULT_STORAGE_TEXTURE_FORMAT,
      { trim: true, allowEmpty: false }
    );
    this.usage = util.readOptionalFiniteNumber(
      options.usage,
      `${this.label} usage`,
      getDefaultStorageTargetUsage(),
      { integer: true, min: 1 }
    );
  }

  // Storage Texture用usageとdepthなしの条件を持つRenderTargetを1個生成します
  create(options = {}) {
    return new RenderTarget(this.gpu, {
      label: util.readOptionalString(
        options.label,
        `${this.label} target label`,
        this.label,
        { trim: true, allowEmpty: false }
      ),
      width: util.readOptionalInteger(options.width, `${this.label} width`, 1, { min: 1 }),
      height: util.readOptionalInteger(options.height, `${this.label} height`, 1, { min: 1 }),
      format: util.readOptionalString(
        options.format,
        `${this.label} target format`,
        this.format,
        { trim: true, allowEmpty: false }
      ),
      hasDepth: false,
      usage: util.readOptionalFiniteNumber(
        options.usage,
        `${this.label} target usage`,
        this.usage,
        { integer: true, min: 1 }
      ),
      samplerDescriptor: options.samplerDescriptor
    });
  }

  // 同じ生成条件の2個のRenderTargetを作り、所有権付きPingPongTargetとして返します
  // Factoryが生成したresourceなのでdestroy()時に2個とも破棄する責任を明示します
  createPingPong(options = {}) {
    const label = util.readOptionalString(
      options.label,
      `${this.label} ping-pong label`,
      `${this.label}:ping-pong`,
      { trim: true, allowEmpty: false }
    );
    const targetOptions = {
      width: util.readOptionalInteger(options.width, `${label} width`, 1, { min: 1 }),
      height: util.readOptionalInteger(options.height, `${label} height`, 1, { min: 1 }),
      format: util.readOptionalString(
        options.format,
        `${label} format`,
        this.format,
        { trim: true, allowEmpty: false }
      ),
      usage: util.readOptionalFiniteNumber(
        options.usage,
        `${label} usage`,
        this.usage,
        { integer: true, min: 1 }
      ),
      samplerDescriptor: options.samplerDescriptor
    };
    return new PingPongTarget([
      this.create({ ...targetOptions, label: `${label}:a` }),
      this.create({ ...targetOptions, label: `${label}:b` })
    ], {
      label,
      currentIndex: options.currentIndex ?? 0,
      ownsResources: true
    });
  }
}

// 寸法が変わった場合だけRenderTargetをresizeし、再生成の有無を返します
export function resizeTarget(target, width, height) {
  if (
    !target ||
    typeof target.getWidth !== "function" ||
    typeof target.getHeight !== "function" ||
    typeof target.resize !== "function"
  ) {
    throw new Error("resizeTarget requires a RenderTarget-compatible resource");
  }
  const checkedWidth = util.readFiniteNumber(width, "resizeTarget width", {
    integer: true,
    min: 1
  });
  const checkedHeight = util.readFiniteNumber(height, "resizeTarget height", {
    integer: true,
    min: 1
  });
  if (target.getWidth() === checkedWidth && target.getHeight() === checkedHeight) {
    return false;
  }
  target.resize(checkedWidth, checkedHeight);
  return true;
}
