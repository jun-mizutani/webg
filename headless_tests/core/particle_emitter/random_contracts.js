// ---------------------------------------------------------
// random_contracts.js  2026/08/01
//   ParticleEmitter MT19937 random stream contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ParticleEmitter from "../../../webg/ParticleEmitter.js";

// emitterごとに同じseedから独立したMT19937 streamを作る
const emitterA = new ParticleEmitter({ maxParticles: 1, seed: 5489 });
const emitterB = new ParticleEmitter({ maxParticles: 1, seed: 5489 });
assert.equal(emitterA.random(), 3499211612 / 4294967296);
assert.equal(emitterB.random(), 3499211612 / 4294967296);
assert.equal(emitterA.random(), 581869302 / 4294967296);
assert.equal(emitterB.random(), 581869302 / 4294967296);

// MT19937ではseed 0も有効であり、LCG時代の禁止値として扱わない
const zeroSeedEmitter = new ParticleEmitter({ maxParticles: 1, seed: 0 });
assert.equal(zeroSeedEmitter.random(), 2357136044 / 4294967296);

// 利用者が明示したrandom callbackは維持し、型間違いを既定streamへ隠さない
const injected = new ParticleEmitter({ maxParticles: 1, random: () => 0.25 });
assert.equal(injected.random(), 0.25);
assert.throws(
  () => new ParticleEmitter({ maxParticles: 1, random: "random" }),
  /ParticleEmitter random must be a function/
);

console.log("PASS ParticleEmitter MT19937 random contracts");
