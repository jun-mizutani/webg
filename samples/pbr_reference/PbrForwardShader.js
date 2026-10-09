// ---------------------------------------------------------
// PbrForwardShader.js  2026/08/03
//   Display-ready forward GGX shader derived from the core HDR PBR shader
// ---------------------------------------------------------
import CorePbrForwardShader from "../../webg/PbrForwardShader.js";

// コアshaderの線形HDR出力だけをReinhard Tone MapとsRGB表示値へ変換します
// BRDF、材質texture、IBL、shadow、local lightはコア実装をそのまま使い、参照用コードを最小化します
export function buildPbrForwardWgsl(coreWgsl) {
  if (typeof coreWgsl !== "string" || coreWgsl.length === 0) {
    throw new Error("PBR reference forward shader requires non-empty core WGSL");
  }
  const hdrOutput = `        let pbrOutput = vec4<f32>(outputRgb, lit.a);
        return select(pbrOutput, vec4f(u.debugColor.rgb, 1.0), pbrDebugBackface);`;
  if (!coreWgsl.includes(hdrOutput)) {
    throw new Error("PBR reference forward shader could not find the core HDR output");
  }
  const displayOutput = `        // 参照画面へ直接描くForwardだけ、Deferred後段と同じReinhardとsRGB変換を適用します
        let mappedLinear = outputRgb / (vec3f(1.0) + outputRgb);
        let pbrOutput = vec4<f32>(linearToSrgb(mappedLinear), lit.a);
        return select(pbrOutput, vec4f(u.debugColor.rgb, 1.0), pbrDebugBackface);`;
  return coreWgsl.replace(hdrOutput, displayOutput);
}

// 通常のコアPBR shaderを初期化した後、参照画面の最終表示変換だけを差し替えます
export default class PbrForwardShader extends CorePbrForwardShader {
  constructor(gpu, options = {}) {
    super(gpu, options);
    this.wgslSrc = buildPbrForwardWgsl(this.wgslSrc);
  }
}
