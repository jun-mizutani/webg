// ---------------------------------------------
// samples/compute_vignette/main.js  2026/06/13
//   Compute Shader vignette sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import { runSimpleComputePostprocess } from "../computeSimplePostprocessApp.js";

// 既存VignettePassと同じ意味のparameterを使い、
// fragment shader版とCompute Shader版を比較しやすくします
const DEFAULTS = {
  radius: 0.90,
  softness: 0.35,
  strength: 0.65
};

const SHADER = `
// values.x = outer radius
// values.y = softness
// values.z = strength
// values.w = enabled
// size.xy = output texture width / height
struct Params {
  values : vec4f,
  size : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var outputTexture : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  // invocation 1つが出力pixel 1つを担当します
  // 8x8 workgroupの端数でtexture外へ出たinvocationは何も書かず終了します
  let dims = textureDimensions(sceneTexture);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  let coord = vec2<i32>(id.xy);
  let source = textureLoad(sceneTexture, coord, 0);

  // OFF時もdispatch構成を変えず、元sceneをstorage textureへそのままコピーします
  if (params.values.w < 0.5) {
    textureStore(outputTexture, coord, source);
    return;
  }

  // pixel centerを0.0-1.0のUVへ変換し、画面中心からの距離を求めます
  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(dims);
  var delta = uv - vec2f(0.5);

  // 横長画面でもvignetteが楕円に潰れないよう、x方向をaspect比で補正します
  delta.x *= params.size.x / max(params.size.y, 1.0);
  let outerRadius = max(params.values.x, 0.0001);
  let softness = clamp(params.values.y, 0.0001, outerRadius);

  // outerRadius - softnessまでは元色を保ち、外周へ向けてsmoothstepで減衰します
  let edge = smoothstep(max(outerRadius - softness, 0.0), outerRadius, length(delta));
  let attenuation = 1.0 - edge * clamp(params.values.z, 0.0, 1.0);
  textureStore(outputTexture, coord, vec4f(source.rgb * attenuation, source.a));
}`;

// scene構築と描画loopは単一dispatch用の共通runtimeへ任せ、
// このfileではVignette固有のparameterとWGSLだけを定義します
document.addEventListener("DOMContentLoaded", () => {
  runSimpleComputePostprocess({
    id: "compute_vignette",
    shader: SHADER,
    uniformFloats: 8,
    defaults: DEFAULTS,
    guideLines: [
      "Drag or Arrow keys: orbit camera",
      "[c] compute vignette on/off",
      "[v] view output/scene",
      "[1]/[2] radius",
      "[3]/[4] softness",
      "[5]/[6] strength",
      "[space] pause",
      "[r] reset"
    ],
    // key入力はCPU側parameterだけを変更し、次frameのmakeUniforms()でGPUへ渡します
    onKey(key, params) {
      if (key === "1") params.radius = Math.max(0.35, params.radius - 0.05);
      else if (key === "2") params.radius = Math.min(1.40, params.radius + 0.05);
      else if (key === "3") params.softness = Math.max(0.05, params.softness - 0.04);
      else if (key === "4") params.softness = Math.min(params.radius, params.softness + 0.04);
      else if (key === "5") params.strength = Math.max(0.0, params.strength - 0.08);
      else if (key === "6") params.strength = Math.min(1.0, params.strength + 0.08);
    },
    // WGSLのParams layoutと同じ順番で8 floatを詰めます
    makeUniforms(params, state, target) {
      return [
        params.radius,
        Math.min(params.softness, params.radius),
        params.strength,
        state.enabled ? 1.0 : 0.0,
        target.getWidth(),
        target.getHeight(),
        0.0,
        0.0
      ];
    },
    hudRows(params, state) {
      return [
        { label: "Compute Vignette", toggleKey: "C", value: state.enabled ? "ON" : "OFF" },
        { label: "View", cycleKey: "V", value: state.view },
        { label: "Radius", value: params.radius.toFixed(2) },
        { label: "Softness", value: params.softness.toFixed(2) },
        { label: "Strength", value: params.strength.toFixed(2) },
        { label: "Pause", toggleKey: "Space", value: state.paused ? "ON" : "OFF" },
        { label: "Reset", key: "R", action: "reset", value: "ready" }
      ];
    },
    diagnostics(params) {
      return {
        radius: params.radius.toFixed(2),
        softness: params.softness.toFixed(2),
        strength: params.strength.toFixed(2)
      };
    }
  });
});
