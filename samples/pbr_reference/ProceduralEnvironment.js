// ---------------------------------------------
// samples/pbr_reference/ProceduralEnvironment.js  2026/09/03
//   Compatibility re-export for the former sample-local environment helper
// ---------------------------------------------

// 旧sample importを維持しながら、実装本体をwebgコアへ移します
export {
  PROCEDURAL_ENVIRONMENT_PRESETS,
  createProceduralEnvironmentData,
  createProceduralEnvironmentRadiance,
  createProceduralEnvironmentPng,
  encodeProceduralEnvironmentPng,
  listProceduralEnvironmentPresets
} from "../../webg/ProceduralEnvironment.js";
