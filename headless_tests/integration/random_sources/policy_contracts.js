// ---------------------------------------------------------
// policy_contracts.js  2026/08/01
//   webg core and maze sample random source policy contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const webgDirectory = new URL("../../../webg/", import.meta.url);
const sourceByModule = new Map(
  readdirSync(webgDirectory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => [name, readFileSync(new URL(name, webgDirectory), "utf8")])
);
const mazeSources = ["maze", "maze2"].map((name) => ({
  name,
  source: readFileSync(new URL(`../../../samples/${name}/main.js`, import.meta.url), "utf8")
}));

// コア自身が順次乱数を必要とする場合はMT19937を使い、実行環境のMath.random()へ戻さない
for (const [name, source] of sourceByModule) {
  assert.doesNotMatch(source, /Math\.random\s*\(/, `${name} must not call Math.random()`);
}

// 座標hashへ浮動小数点の大角度sinを戻さず、CPUとWGSLでlowbias32定数を共有する
for (const name of ["Texture.js", "SsaoPass.js"]) {
  const source = sourceByModule.get(name);
  assert.doesNotMatch(source, /43758\.545|12\.9898|78\.233/);
}
assert.match(sourceByModule.get("Texture.js"), /util\.hashUint32Sequence/);
assert.match(sourceByModule.get("Texture.js"), /util\.uint32ToUnitFloat/);
assert.match(sourceByModule.get("SsaoPass.js"), /0x7feb352du/);
assert.match(sourceByModule.get("SsaoPass.js"), /0x846ca68bu/);

// 順次生成箇所は用途別MT19937 streamを使い、旧ParticleEmitter LCGを再導入しない
assert.doesNotMatch(
  sourceByModule.get("ParticleEmitter.js"),
  /state\s*=\s*\(state\s*\*\s*1664525\s*\+\s*1013904223\)/
);
assert.match(sourceByModule.get("ParticleEmitter.js"), /new util\.MersenneTwister\(seed\)/);
assert.match(sourceByModule.get("ToneSynth.js"), /this\.reverbRandom/);
assert.match(sourceByModule.get("AudioSynth.js"), /this\.rhythmRandom/);
assert.match(sourceByModule.get("AudioSynth.js"), /this\.modulationRandom/);

// 固定seedから順番に迷路を作るsampleもMT19937を使い、旧mulberry32を再導入しない
for (const { name, source } of mazeSources) {
  assert.doesNotMatch(source, /mulberry32/, `${name} must not define or call mulberry32`);
  assert.match(source, /import util from "\.\.\/\.\.\/webg\/util\.js"/);
  assert.match(source, /new util\.MersenneTwister\(seed\)/);
  assert.match(source, /const rng = createMazeRandom\(MAZE_SEED\)/);
}

console.log("PASS webg core and maze sample random source policy contracts");
