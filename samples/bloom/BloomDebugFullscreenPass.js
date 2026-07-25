// ---------------------------------------------
// samples/bloom/BloomDebugFullscreenPass.js  2026/07/16
//   Legacy Bloom intermediate target preview
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import FullscreenPass from "../../webg/FullscreenPass.js";
import util from "../../webg/util.js";

export const BLOOM_PREVIEW_VIEWS = Object.freeze([
  "scene",
  "extract",
  "extractHeat",
  "blurA",
  "blurB"
]);

// View名をBloomPassが公開する中間targetと診断表示倍率へ一対一で対応させます
// 未知のViewをblurBへ読み替えるとPalette表示と実際の描画元が食い違うため、明示的に停止します
export function resolveBloomDebugPreview(viewName, bloomPass) {
  if (!bloomPass) {
    throw new Error("resolveBloomDebugPreview requires BloomPass");
  }
  if (viewName === "scene") {
    return { source: bloomPass.getSceneTarget(), colorScale: [1.0, 1.0, 1.0, 1.0] };
  }
  if (viewName === "extract") {
    return { source: bloomPass.getExtractTarget(), colorScale: [6.0, 6.0, 6.0, 1.0] };
  }
  if (viewName === "extractHeat") {
    return { source: bloomPass.getExtractHeatTarget(), colorScale: [1.0, 1.0, 1.0, 1.0] };
  }
  if (viewName === "blurA") {
    return { source: bloomPass.getBlurTargetA(), colorScale: [8.0, 8.0, 8.0, 1.0] };
  }
  if (viewName === "blurB") {
    return { source: bloomPass.getBlurTargetB(), colorScale: [8.0, 8.0, 8.0, 1.0] };
  }
  throw new Error(`unsupported Bloom preview view: ${viewName}`);
}

// 通常のFullscreenPassはTone Map後のrgba8unormかつcanvasと同じ寸法だけを最終表示します
// このサンプルではBloomPassが使うcanvas形式と低解像度blur targetを診断するため、入力検証だけを限定的に置き換えます
export default class BloomDebugFullscreenPass extends FullscreenPass {
  constructor(gpu, options = {}) {
    super(gpu, options);
    this.sourceFormat = util.readOptionalString(
      options.sourceFormat,
      "BloomDebugFullscreenPass sourceFormat",
      undefined,
      { trim: true, allowEmpty: false }
    );
    if (!this.sourceFormat) {
      throw new Error("BloomDebugFullscreenPass requires sourceFormat");
    }
  }

  // BloomPassの中間targetに必要な公開API、色形式、正の寸法、生成済みresourceを検証します
  // 寸法一致は要求せず、親クラスの正規化UVとlinear samplerで低解像度targetをcanvas全体へ拡大します
  validateSource(texture) {
    if (
      !texture
      || typeof texture.getView !== "function"
      || typeof texture.getSampler !== "function"
      || typeof texture.getFormat !== "function"
      || typeof texture.getWidth !== "function"
      || typeof texture.getHeight !== "function"
    ) {
      throw new Error(
        "BloomDebugFullscreenPass source must be a RenderTarget-compatible Bloom texture"
      );
    }
    const format = util.readOptionalString(
      texture.getFormat(),
      "BloomDebugFullscreenPass source format",
      undefined,
      { trim: true, allowEmpty: false }
    );
    if (format !== this.sourceFormat) {
      throw new Error(
        `BloomDebugFullscreenPass source format must be ${this.sourceFormat}; received ${format}`
      );
    }
    util.readFiniteNumber(texture.getWidth(), "BloomDebugFullscreenPass source width", {
      integer: true,
      min: 1
    });
    util.readFiniteNumber(texture.getHeight(), "BloomDebugFullscreenPass source height", {
      integer: true,
      min: 1
    });
    if (!texture.getView() || !texture.getSampler()) {
      throw new Error("BloomDebugFullscreenPass source view and sampler must be ready");
    }
    return texture;
  }
}
