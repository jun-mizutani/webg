// -------------------------------------------------
// circular_breaker sample
//   particleEffects.js 2026/03/26
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import {
  PARTICLE_POOL,
  SHADOW_Y
} from "./constants.js";

// この file は main.js が emitter を生成し、gameRuntime.js が emit し、
// main.js の loop が draw する spark effect の共有 helper をまとめる
// sample 固有の preset 調整をここへ寄せ、
// gameplay code から particle の細部を外す

// circular_breaker 用の spark emitter をまとめて構築する
// sample 固有の texture / size / shadow 調整をここへ集め、
// main.js には「ParticleEmitter を使う」という意図だけを残す
export const createSparkEmitter = async (app) => app.createParticleEmitter({
  name: "circularBreakerSparkEmitter",
  maxParticles: PARTICLE_POOL,
  useShadow: true,
  groundY: SHADOW_Y + 0.16,
  preset: "spark",
  seed: 31,
  presetOptions: {
    texture: {
      width: 96,
      height: 96,
      style: "smoke",
      seed: 31,
      noiseScale: 5.8,
      noiseAmount: 0.68,
      dotsAmount: 0.25,
      edgeSoftness: 0.24,
      radius: 0.90,
      centerBoost: 1.62,
      alphaPower: 0.70
    },
    defaults: {
      life: 0.88,
      lifeSpread: 0.27,
      size: 2.6,
      sizeSpread: 0.9,
      velocity: [0.0, 12.0, 0.0],
      velocitySpread: [22.0, 9.0, 22.0],
      gravity: [0.0, -15.0, 0.0],
      drag: 0.03,
      color: [1.0, 1.0, 1.0, 1.0],
      colorSpread: [0.0, 0.0, 0.0, 0.0],
      shadowAlpha: 0.85,
      shadowScale: 1.2,
      shadowY: SHADOW_Y + 0.16
    }
  }
});

// custom loop から emitter を描きたいので、小さな helper を用意する
// WebgApp.start() を使わない sample でも、描画呼び出し位置を統一しやすくする
export const drawSparkEmitter = (sparkEmitter, eyeNode, projectionMatrix) =>
  sparkEmitter?.draw?.(eyeNode, projectionMatrix) ?? 0;

export default createSparkEmitter;
