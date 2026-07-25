// ---------------------------------------------
// samples/compute_edge/main.js  2026/07/25
//   Compute Shader edge detection sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import { runSimpleComputePostprocess } from "../computeSimplePostprocessApp.js";
import ComputeEdgePass, {
  COMPUTE_EDGE_BLEND_MODES,
  COMPUTE_EDGE_DEFAULTS
} from "../../webg/ComputeEdgePass.js";

// `nextBlendMode`は現在状態から対象を選択し、結果を返すまたは選択を切り替える
function nextBlendMode(current) {
  const index = COMPUTE_EDGE_BLEND_MODES.indexOf(current);
  return COMPUTE_EDGE_BLEND_MODES[(index + 1) % COMPUTE_EDGE_BLEND_MODES.length];
}

// 共通runtimeへeffect固有のWGSLと操作定義を渡します
document.addEventListener("DOMContentLoaded", () => {
  runSimpleComputePostprocess({
    id: "compute_edge",
    defaults: COMPUTE_EDGE_DEFAULTS,
    createPass(gpu, options) {
      // compute_edgeは検証後にコアへ統合したComputeEdgePassを直接使います
      // sample側はscene、入力、HUD、canvas表示だけを担当します
      return new ComputeEdgePass(gpu, options);
    },
    guideLines: [
      "Drag or Arrow keys: orbit camera",
      "[c] compute edge on/off",
      "[v] view output/scene",
      "[1]/[2] strength",
      "[3]/[4] threshold",
      "[5]/[6] source mix",
      "[7]/[8] thickness",
      "[m] blend mode",
      "[space] pause",
      "[r] reset"
    ],
    // parameter変更はCPU側だけで行い、次frameにまとめてuniformへ転送します
    onKey(key, params) {
      if (key === "1") params.strength = Math.max(0.1, params.strength - 0.15);
      else if (key === "2") params.strength = Math.min(4.0, params.strength + 0.15);
      else if (key === "3") params.threshold = Math.max(0.0, params.threshold - 0.03);
      else if (key === "4") params.threshold = Math.min(1.0, params.threshold + 0.03);
      else if (key === "5") params.mix = Math.max(0.0, params.mix - 0.10);
      else if (key === "6") params.mix = Math.min(1.0, params.mix + 0.10);
      else if (key === "7") params.thickness = Math.max(1, params.thickness - 1);
      else if (key === "8") params.thickness = Math.min(4, params.thickness + 1);
      else if (key === "m") params.blendMode = nextBlendMode(params.blendMode);
    },
    // ComputeEdgePassへ渡すparameter名を明示し、sample側でbinding順を再解釈しません
    makePassOptions(params, state) {
      return {
        strength: params.strength,
        threshold: params.threshold,
        mix: params.mix,
        blendMode: params.blendMode,
        thickness: params.thickness,
        enabled: state.enabled
      };
    },
    hudRows(params, state) {
      return [
        { label: "Compute Edge", toggleKey: "C", value: state.enabled ? "ON" : "OFF" },
        { label: "View", cycleKey: "V", value: state.view },
        { label: "Strength", value: params.strength.toFixed(2) },
        { label: "Threshold", value: params.threshold.toFixed(2) },
        { label: "Source Mix", value: params.mix.toFixed(2) },
        { label: "Thickness", value: String(params.thickness) },
        { label: "Blend", key: "M", action: "cycle", value: params.blendMode },
        { label: "Pause", toggleKey: "Space", value: state.paused ? "ON" : "OFF" },
        { label: "Reset", key: "R", action: "reset", value: "ready" }
      ];
    },
    diagnostics(params) {
      return {
        strength: params.strength.toFixed(2),
        threshold: params.threshold.toFixed(2),
        sourceMix: params.mix.toFixed(2),
        blendMode: params.blendMode,
        thickness: String(params.thickness)
      };
    }
  });
});
