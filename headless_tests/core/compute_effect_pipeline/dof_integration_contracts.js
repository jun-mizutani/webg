// ---------------------------------------------------------
// headless_tests/core/compute_effect_pipeline/headless_probe.js  2026/07/13
//   ComputeEffectPipeline to v2 DoF connection contract
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Pipeline全体は移行途中であるため、このtestはDoF接続部分だけを静的に限定して確認します
// 未移行のShadowやGeometry経路までOKと誤記録しないことが目的です
const source = readFileSync(
  new URL("../../../webg/ComputeEffectPipeline.js", import.meta.url),
  "utf8"
);

// 色とdepthをAPI互換wrapperへ隠さず、別resourceとしてDoFへ渡します
assert.match(
  source,
  /this\.dofPass\.encode\(commandEncoder, \{\s*scene: output,\s*depth: resources\.depth\s*\}/
);

// Geometry Bufferと同じframe snapshotを渡し、near/farの個別値を再構成しません
assert.match(source, /cameraFrame: options\.cameraFrame/);
assert.doesNotMatch(source, /function withDepth\(/);
assert.doesNotMatch(source, /projectionNear: options\.projectionNear/);
assert.doesNotMatch(source, /projectionFar: options\.projectionFar/);

console.log("compute_effect_pipeline_dof_integration_contracts: DoF connection contract passed");
