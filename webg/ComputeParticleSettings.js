// ComputeParticleSettings.js 2026/09/22
// 粒子APIとSceneYAMLで共用する設定検証。GPU資源を作る前に入力を確定する
import util from "./util.js";

export const MAX_PARTICLE_COMMANDS = 32;
export const PARTICLE_PARAM_FLOATS = 48 + MAX_PARTICLE_COMMANDS * 32;

// 各プリセットは速度分布、寿命、発光色、半径、重力の出発点を提供する
const PRESETS = {
  spark: { gravity: [0, -15, 0], drag: .03, velocity: [0, 12, 0],
    velocitySpread: [22, 9, 22], lifetime: [.57, .88], size: [.22, .44],
    colors: [[8, 3.2, .45], [1.2, 5, 8]] },
  light: { gravity: [0, 0, 0], drag: .4, velocity: [0, .5, 0],
    velocitySpread: [1, 1, 1], lifetime: [1, 2], size: [.05, .12],
    colors: [[.5, 2, 5], [2, .5, 5]] },
  fountain: { gravity: [0, -9.8, 0], drag: .05, velocity: [0, 7, 0],
    velocitySpread: [1, 1, 1], lifetime: [1, 2], size: [.04, .08],
    colors: [[.2, 1, 3], [.4, 2, 4]] }
};

// 設定名の誤記を呼び出し位置で示し、未使用の設定を残さない
export function readParticleObject(value, name, keys) {
  const source = util.readPlainObject(value, name);
  for (const key of Object.keys(source)) {
    if (!keys.includes(key)) throw new Error(`${name}.${key} is unsupported`);
  }
  return source;
}

// 最小値と最大値を順序付きで読み、乱数を適用する範囲を確定する
function readRange(value, name, positive = false) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${name} requires [min, max]`);
  const min = util.readFiniteNumber(value[0], `${name}[0]`, positive ? { minExclusive: 0 } : { min: 0 });
  return [min, util.readFiniteNumber(value[1], `${name}[1]`, { min })];
}

// ベクトルの各成分を検証し、速度のばらつきやHDR色を正の量として読む
function readNonnegativeVector(value, name) {
  return util.readVec3(value, name).map((v, i) => util.readFiniteNumber(v, `${name}[${i}]`, { min: 0 }));
}

// 発生位置と速度分布を読む。方向・角度指定は円錐分布、速度・幅指定は直方体分布になる
export function readParticleEmission(value, defaults, name = "particle emission") {
  const source = readParticleObject(value, name,
    ["position", "velocity", "velocitySpread", "direction", "spreadAngle", "speed", "lifetime"]);
  const cone = source.direction !== undefined || source.spreadAngle !== undefined || source.speed !== undefined;
  if (cone && (source.velocity !== undefined || source.velocitySpread !== undefined)) {
    throw new Error(`${name} selects either direction/speed or velocity/velocitySpread`);
  }
  const result = {
    position: util.readVec3(source.position ?? [0, 0, 0], `${name}.position`),
    velocity: util.readVec3(source.velocity ?? defaults.velocity, `${name}.velocity`),
    velocitySpread: readNonnegativeVector(source.velocitySpread ?? defaults.velocitySpread, `${name}.velocitySpread`),
    lifetime: readRange(source.lifetime ?? defaults.lifetime, `${name}.lifetime`, true),
    cone, direction: [0, 1, 0], spreadAngle: 0, speed: [0, 0]
  };
  if (cone) {
    const direction = util.readVec3(source.direction, `${name}.direction`);
    const length = Math.hypot(...direction);
    if (length === 0) throw new Error(`${name}.direction requires nonzero length`);
    result.direction = direction.map(v => v / length);
    result.spreadAngle = util.readFiniteNumber(source.spreadAngle ?? 0, `${name}.spreadAngle`, { min: 0, max: 180 });
    result.speed = readRange(source.speed, `${name}.speed`);
  }
  return result;
}

// 公開設定を検証してCPU/GPU双方へ渡す値を一か所で作る
export function readComputeParticleSettings(value = {}) {
  const source = readParticleObject(value, "ComputeParticleEmitter",
    ["label", "preset", "capacity", "seed", "overflow", "simulation", "appearance", "targetFormat"]);
  const preset = util.readOptionalEnum(source.preset, "particle preset", "spark", Object.keys(PRESETS));
  const defaults = PRESETS[preset];
  const simulation = readParticleObject(source.simulation ?? {}, "particle simulation", ["gravity", "drag"]);
  const appearance = readParticleObject(source.appearance ?? {}, "particle appearance", ["colors", "size", "intensity"]);
  const colors = appearance.colors ?? defaults.colors;
  if (!Array.isArray(colors) || colors.length !== 2) throw new Error("particle appearance.colors requires two RGB colors");
  return {
    label: util.readOptionalString(source.label, "particle label", "compute-particles", { allowEmpty: false }),
    targetFormat: util.readOptionalString(source.targetFormat, "particle targetFormat", "rgba16float", { allowEmpty: false }),
    preset, defaults,
    capacity: util.readOptionalInteger(source.capacity, "particle capacity", 1024, { min: 1 }),
    seed: util.readOptionalInteger(source.seed, "particle seed", 1, { min: 0, max: 0xffffffff }),
    overflow: util.readOptionalEnum(source.overflow, "particle overflow", "reject", ["reject", "replace-oldest"]),
    gravity: util.readVec3(simulation.gravity ?? defaults.gravity, "particle gravity"),
    drag: util.readOptionalFiniteNumber(simulation.drag, "particle drag", defaults.drag, { min: 0 }),
    colors: colors.map((color, i) => readNonnegativeVector(color, `particle colors[${i}]`)),
    size: readRange(appearance.size ?? defaults.size, "particle size", true),
    intensity: util.readOptionalFiniteNumber(appearance.intensity, "particle intensity", 1, { min: 0 })
  };
}

// 連続発生は秒当たり粒子数と一回発生の設定を組み合わせる
export function readParticleContinuous(value, defaults) {
  const source = util.readPlainObject(value, "particle continuous emission");
  const { rate, ...emission } = source;
  return { rate: util.readFiniteNumber(rate, "particle rate", { minExclusive: 0 }),
    emission: readParticleEmission(emission, defaults) };
}

// SceneYAMLの名前付き一覧を検証し、起動時に構築できる設定として返す
export function readSceneParticleEmitters(value = []) {
  if (!Array.isArray(value)) throw new Error("particleEmitters must be an array");
  const ids = new Set();
  return value.map((item, index) => {
    const { id, emission, ...options } = util.readPlainObject(item, `particleEmitters[${index}]`);
    const name = util.readOptionalString(id, "particle emitter id", undefined, { allowEmpty: false });
    if (!name || ids.has(name)) throw new Error("particle emitter ids must be present and unique");
    ids.add(name);
    const settings = readComputeParticleSettings(options);
    if (emission !== undefined) readParticleContinuous(emission, settings.defaults);
    return { id: name, options, emission };
  });
}
