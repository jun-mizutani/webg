// samples/circular_breaker2/particleEffects.js 2026/09/22
// 標準Compute粒子をPBRへ登録し、衝突位置と発生数をゲーム側から渡す
import { PARTICLE_POOL } from "./constants.js";

// 火花の初期値生成・更新・HDR合成はコアへ任せ、ゲーム用の容量とseedを指定する
export async function createSparkEmitter(sceneApp) {
  const sparks = await sceneApp.createComputeParticleEmitter({
    label: "arena-collision-sparks", preset: "spark", capacity: PARTICLE_POOL,
    seed: 20260922, overflow: "replace-oldest"
  }, "collision-sparks");
  sceneApp.sparkEmitter = sparks;
  return sparks;
}
