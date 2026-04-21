// ---------------------------------------------
// ParticleEmitter.js 2026/03/30
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Billboard from "./Billboard.js";
import Texture from "./Texture.js";
import util from "./util.js";

// ParticleEmitter:
// - 短命な particle をまとめて spawn / update / draw するための小さな管理 class
// - 既存の Billboard と procedural texture を再利用し、毎回 sample 側で同じ管理コードを書かなくて済むようにする
// - どんな種類の particle を出しているかを preset でまとめ、ゲーム側は emit() に集中できるようにする

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const randomRange = (random, min, max) => min + (max - min) * random();

const cloneVec3 = (value, fallback = null, label = "vec3") => {
  return util.readVec3(value, `ParticleEmitter ${label}`, fallback === null ? undefined : fallback);
};

const cloneColor = (value, fallback = null, label = "color") => {
  return util.readColor(value, `ParticleEmitter ${label}`, fallback === null ? undefined : fallback, 4);
};

const cloneObject = (value, label = "object") => {
  return { ...util.readPlainObject(value, `ParticleEmitter ${label}`, {}) };
};

const createSeededRandom = (seed = 1) => {
  let state = util.readFiniteNumber(seed, "ParticleEmitter seed", { integer: true }) >>> 0;
  if (state === 0) {
    throw new Error("ParticleEmitter seed must not resolve to 0");
  }
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const DEFAULT_PRESETS = {
  spark: {
    texture: {
      width: 96,
      height: 96,
      style: "debris",
      seed: 41,
      noiseScale: 8.2,
      noiseAmount: 0.76,
      dotsAmount: 0.52,
      edgeSoftness: 0.14,
      radius: 0.78,
      centerBoost: 1.12,
      alphaPower: 0.78
    },
    defaults: {
      life: 0.55,
      lifeSpread: 0.14,
      size: 0.54,
      sizeSpread: 0.14,
      velocity: [0.0, 0.0, 0.0],
      velocitySpread: [4.0, 5.0, 4.0],
      gravity: [0.0, -9.0, 0.0],
      drag: 0.08,
      color: [1.0, 0.88, 0.42, 1.0],
      colorSpread: [0.08, 0.06, 0.03, 0.0],
      shadowAlpha: 0.34,
      shadowScale: 1.30,
      shadowY: 0.0
    }
  },
  smoke: {
    texture: {
      width: 96,
      height: 96,
      style: "smoke",
      seed: 23,
      noiseScale: 5.6,
      noiseAmount: 0.66,
      dotsAmount: 0.24,
      edgeSoftness: 0.24,
      radius: 0.90,
      centerBoost: 1.55,
      alphaPower: 0.72
    },
    defaults: {
      life: 1.55,
      lifeSpread: 0.45,
      size: 0.84,
      sizeSpread: 0.22,
      velocity: [0.0, 2.0, 0.0],
      velocitySpread: [2.0, 2.5, 2.0],
      gravity: [0.0, 1.0, 0.0],
      drag: 0.04,
      color: [1.0, 1.0, 1.0, 1.0],
      colorSpread: [0.02, 0.02, 0.02, 0.0],
      shadowAlpha: 0.16,
      shadowScale: 1.20,
      shadowY: 0.0
    }
  },
  debris: {
    texture: {
      width: 96,
      height: 96,
      style: "debris",
      seed: 67,
      noiseScale: 7.8,
      noiseAmount: 0.78,
      dotsAmount: 0.46,
      edgeSoftness: 0.18,
      radius: 0.84,
      centerBoost: 1.70,
      alphaPower: 0.68
    },
    defaults: {
      life: 0.85,
      lifeSpread: 0.22,
      size: 0.62,
      sizeSpread: 0.20,
      velocity: [0.0, 0.0, 0.0],
      velocitySpread: [8.0, 10.0, 8.0],
      gravity: [0.0, -18.0, 0.0],
      drag: 0.10,
      color: [1.0, 0.78, 0.52, 1.0],
      colorSpread: [0.08, 0.06, 0.04, 0.0],
      shadowAlpha: 0.22,
      shadowScale: 1.10,
      shadowY: 0.0
    }
  },
  pickup: {
    texture: {
      width: 96,
      height: 96,
      style: "smoke",
      seed: 11,
      noiseScale: 4.8,
      noiseAmount: 0.50,
      dotsAmount: 0.18,
      edgeSoftness: 0.28,
      radius: 0.88,
      centerBoost: 1.85,
      alphaPower: 0.82
    },
    defaults: {
      life: 0.70,
      lifeSpread: 0.12,
      size: 0.44,
      sizeSpread: 0.12,
      velocity: [0.0, 4.0, 0.0],
      velocitySpread: [2.5, 2.5, 2.5],
      gravity: [0.0, 2.0, 0.0],
      drag: 0.05,
      color: [0.95, 1.0, 0.60, 1.0],
      colorSpread: [0.04, 0.04, 0.06, 0.0],
      shadowAlpha: 0.18,
      shadowScale: 1.18,
      shadowY: 0.0
    }
  }
};

export default class ParticleEmitter {
  // ParticleEmitter は「出す / 動かす / 描く」の 3 段だけを担当する
  // 生成自体は WebgApp の helper から呼ばれ、sample 側は emit() を中心に使う
  constructor(options = {}) {
    this.name = String(options.name ?? "particleEmitter");
    this.maxParticles = util.readOptionalInteger(options.maxParticles, "ParticleEmitter maxParticles", 256, { min: 1 });
    this.useShadow = options.useShadow === true;
    this.groundY = util.readOptionalFiniteNumber(options.groundY, "ParticleEmitter groundY", 0.0);
    this.seed = util.readOptionalInteger(options.seed, "ParticleEmitter seed", 1);
    this.random = typeof options.random === "function" ? options.random : createSeededRandom(this.seed);
    this.presetName = "spark";
    this.presetOptions = {};
    this.particles = Array.from({ length: this.maxParticles }, () => this._createParticle());
    this.gpu = null;
    this.texture = null;
    this.billboard = null;
    this.shadowBillboard = null;
    this.initialized = false;
    this.textureReady = false;
    this.initPromise = Promise.resolve(this);

    if (options.preset) {
      this.setPreset(options.preset, options.presetOptions ?? {});
    } else {
      this.setPreset("spark", {});
    }
  }

  // preset 名から既定値を返す
  static getPresetDefinition(name = "spark") {
    const key = String(name ?? "spark").toLowerCase();
    if (!DEFAULT_PRESETS[key]) {
      throw new Error(`Unknown particle preset: ${key}`);
    }
    return DEFAULT_PRESETS[key];
  }

  // 現在の preset 内容を外から読めるようにする
  getPreset() {
    const base = ParticleEmitter.getPresetDefinition(this.presetName);
    return {
      name: this.presetName,
      texture: { ...base.texture, ...(this.presetOptions.texture ?? {}) },
      defaults: { ...base.defaults, ...cloneObject(this.presetOptions.defaults, "presetOptions.defaults") }
    };
  }

  // preset を切り替え、必要なら texture の再生成も行う
  setPreset(name = "spark", options = {}) {
    this.presetName = String(name ?? "spark").toLowerCase();
    const base = ParticleEmitter.getPresetDefinition(this.presetName);
    this.presetOptions = {
      texture: {
        ...base.texture,
        ...cloneObject(options.texture, "preset texture")
      },
      defaults: {
        ...base.defaults,
        ...cloneObject(options.defaults, "preset defaults")
      }
    };
    if (this.textureReady) {
      this.rebuildTexture();
    }
    return this.getPreset();
  }

  // particle の描画に使う renderer を差し替える
  // WebgApp から実 renderer を入れるほか、unittest では fake renderer を渡せる
  setRenderer({ billboard = null, shadowBillboard = null, texture = null } = {}) {
    this.billboard = billboard;
    this.shadowBillboard = shadowBillboard;
    this.texture = texture;
    this.initialized = !!this.billboard;
    this.textureReady = !!this.texture;
    if (this.textureReady) {
      this.rebuildTexture();
    }
    return this;
  }

  // GPU を使う実 renderer を作成する
  // WebgApp 側からは await して使い、内部で Billboard / Texture をまとめて初期化する
  async init(gpu) {
    this.gpu = gpu;
    const texture = new Texture(gpu);
    const billboard = new Billboard(gpu, this.maxParticles);
    const shadowBillboard = this.useShadow ? new Billboard(gpu, this.maxParticles) : null;

    await texture.initPromise;
    await billboard.init();
    if (shadowBillboard) {
      await shadowBillboard.init();
    }

    this.setRenderer({
      billboard,
      shadowBillboard,
      texture
    });
    this.rebuildTexture();
    this.initialized = true;
    return this;
  }

  // preset に合わせて procedural texture を作り直す
  rebuildTexture() {
    if (!this.texture || typeof this.texture.buildProceduralBillboardTexture !== "function") {
      return false;
    }
    const preset = this.getPreset();
    this.texture.buildProceduralBillboardTexture(preset.texture);
    if (typeof this.texture.setClamp === "function") {
      this.texture.setClamp();
    }
    if (this.billboard?.setTexture) {
      this.billboard.setTexture(this.texture);
    }
    if (this.shadowBillboard?.setTexture) {
      this.shadowBillboard.setTexture(this.texture);
    }
    return true;
  }

  // 表示中の particle を全て消す
  clear() {
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].life = 0.0;
    }
  }

  // 生きている particle 数を数える
  getAliveCount() {
    let alive = 0;
    for (let i = 0; i < this.particles.length; i++) {
      if (this.particles[i].life > 0.0) alive++;
    }
    return alive;
  }

  // 1 frame 分だけ spawn 位置や速度のばらつきを付けたいときに使う
  _spreadVec3(base, spread) {
    const b = cloneVec3(base, null, "spread base");
    const s = Array.isArray(spread)
      ? cloneVec3(spread, null, "spread vec3")
      : [
        util.readFiniteNumber(spread, "ParticleEmitter spread scalar"),
        util.readFiniteNumber(spread, "ParticleEmitter spread scalar"),
        util.readFiniteNumber(spread, "ParticleEmitter spread scalar")
      ];
    return [
      b[0] + randomRange(this.random, -s[0], s[0]),
      b[1] + randomRange(this.random, -s[1], s[1]),
      b[2] + randomRange(this.random, -s[2], s[2])
    ];
  }

  // color のばらつきを作る
  _spreadColor(base, spread) {
    const b = cloneColor(base, null, "spread color base");
    const s = Array.isArray(spread)
      ? cloneColor(spread, null, "spread color")
      : [
        util.readFiniteNumber(spread, "ParticleEmitter color spread scalar"),
        util.readFiniteNumber(spread, "ParticleEmitter color spread scalar"),
        util.readFiniteNumber(spread, "ParticleEmitter color spread scalar"),
        util.readFiniteNumber(spread, "ParticleEmitter color spread scalar")
      ];
    return [
      clamp(b[0] + randomRange(this.random, -s[0], s[0]), 0.0, 1.0),
      clamp(b[1] + randomRange(this.random, -s[1], s[1]), 0.0, 1.0),
      clamp(b[2] + randomRange(this.random, -s[2], s[2]), 0.0, 1.0),
      clamp(b[3] + randomRange(this.random, -s[3], s[3]), 0.0, 1.0)
    ];
  }

  // 新しい particle slot を 1 個だけ作る
  _createParticle() {
    return {
      x: 0.0, y: 0.0, z: 0.0,
      vx: 0.0, vy: 0.0, vz: 0.0,
      gravityX: 0.0, gravityY: 0.0, gravityZ: 0.0,
      drag: 0.0,
      life: 0.0,
      maxLife: 1.0,
      size: 0.0,
      baseSize: 0.0,
      color: [1.0, 1.0, 1.0, 1.0],
      shadowAlpha: 0.0,
      shadowScale: 1.0,
      shadowY: 0.0
    };
  }

  // spawn parameter は emit 呼び出し側で明示し、preset/default からは補わない
  _resolveSpawnOptions(options = {}) {
    if (!Array.isArray(options.position)
      || !Array.isArray(options.positionSpread)
      || !Array.isArray(options.velocity)
      || !Array.isArray(options.velocitySpread)
      || !Array.isArray(options.gravity)
      || !Array.isArray(options.color)
      || !Array.isArray(options.colorSpread)) {
      throw new Error("ParticleEmitter emit options require explicit vector/color arrays");
    }
    return {
      position: cloneVec3(options.position, null, "emit.position"),
      positionSpread: cloneVec3(options.positionSpread, null, "emit.positionSpread"),
      velocity: cloneVec3(options.velocity, null, "emit.velocity"),
      velocitySpread: cloneVec3(options.velocitySpread, null, "emit.velocitySpread"),
      gravity: cloneVec3(options.gravity, null, "emit.gravity"),
      drag: util.readFiniteNumber(options.drag, "ParticleEmitter emit.drag"),
      life: util.readFiniteNumber(options.life, "ParticleEmitter emit.life"),
      lifeSpread: util.readFiniteNumber(options.lifeSpread, "ParticleEmitter emit.lifeSpread"),
      size: util.readFiniteNumber(options.size, "ParticleEmitter emit.size"),
      sizeSpread: util.readFiniteNumber(options.sizeSpread, "ParticleEmitter emit.sizeSpread"),
      color: cloneColor(options.color, null, "emit.color"),
      colorSpread: cloneColor(options.colorSpread, null, "emit.colorSpread"),
      shadowAlpha: util.readFiniteNumber(options.shadowAlpha, "ParticleEmitter emit.shadowAlpha"),
      shadowScale: util.readFiniteNumber(options.shadowScale, "ParticleEmitter emit.shadowScale"),
      shadowY: util.readFiniteNumber(options.shadowY, "ParticleEmitter emit.shadowY")
    };
  }

  // particle を最大 count 個まで spawn する
  emit(count = 1, options = {}) {
    util.readFiniteNumber(count, "ParticleEmitter emit count", { integer: true });
    const spawnCount = Number(count);
    if (spawnCount <= 0) return 0;

    const spawn = this._resolveSpawnOptions(options);
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < spawnCount; i++) {
      const p = this.particles[i];
      if (p.life > 0.0) continue;

      const pos = this._spreadVec3(spawn.position, spawn.positionSpread);
      const vel = this._spreadVec3(spawn.velocity, spawn.velocitySpread);
      const color = this._spreadColor(spawn.color, spawn.colorSpread);
      const life = spawn.life + randomRange(this.random, -spawn.lifeSpread, spawn.lifeSpread);
      const size = spawn.size + randomRange(this.random, -spawn.sizeSpread, spawn.sizeSpread);

      p.x = pos[0];
      p.y = pos[1];
      p.z = pos[2];
      p.vx = vel[0];
      p.vy = vel[1];
      p.vz = vel[2];
      p.gravityX = spawn.gravity[0];
      p.gravityY = spawn.gravity[1];
      p.gravityZ = spawn.gravity[2];
      p.drag = spawn.drag;
      p.life = life;
      p.maxLife = life;
      p.size = size;
      p.baseSize = size;
      p.color = color;
      p.shadowAlpha = spawn.shadowAlpha;
      p.shadowScale = spawn.shadowScale;
      p.shadowY = spawn.shadowY;
      spawned++;
    }
    return spawned;
  }

  // 1 frame 分だけ particle を進める
  // deltaMs を受け取り、内部では秒へ換算して velocity / gravity / drag を更新する
  update(deltaMs = 0) {
    const dt = util.readFiniteNumber(deltaMs, "ParticleEmitter deltaMs", { min: 0 }) * 0.001;
    if (dt <= 0.0) {
      return this.getAliveCount();
    }

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.life <= 0.0) continue;

      p.life -= dt;
      if (p.life <= 0.0) {
        p.life = 0.0;
        continue;
      }

      p.vx += p.gravityX * dt;
      p.vy += p.gravityY * dt;
      p.vz += p.gravityZ * dt;

      const drag = clamp(1.0 - p.drag * dt, 0.0, 1.0);
      p.vx *= drag;
      p.vy *= drag;
      p.vz *= drag;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }

    return this.getAliveCount();
  }

  // current frame の particle を billboard へ流し込む
  draw(eyeNode, projectionMatrix) {
    if (!this.initialized || !this.billboard) {
      return 0;
    }

    const main = this.billboard;
    const shadow = this.useShadow ? this.shadowBillboard : null;
    if (typeof main.clear === "function") {
      main.clear();
    }
    if (shadow && typeof shadow.clear === "function") {
      shadow.clear();
    }

    let alive = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.life <= 0.0) continue;
      alive++;
      const t = clamp(p.life / Math.max(1e-6, p.maxLife), 0.0, 1.0);
      const sizeScale = 0.85 + (1.0 - t) * 0.9;
      const alpha = clamp(p.color[3] * t, 0.0, 1.0);
      const color = [p.color[0], p.color[1], p.color[2], alpha];
      main.addBillboard(p.x, p.y, p.z, p.baseSize * sizeScale, p.baseSize * sizeScale, color);

      if (shadow) {
        const shadowAlpha = alpha * p.shadowAlpha;
        if (shadowAlpha > 0.0) {
          shadow.addBillboard(
            p.x,
            p.shadowY,
            p.z,
            p.baseSize * sizeScale * p.shadowScale,
            p.baseSize * sizeScale * p.shadowScale,
            [0.0, 0.0, 0.0, shadowAlpha]
          );
        }
      }
    }

    if (alive <= 0) {
      return 0;
    }

    if (shadow && typeof shadow.drawGround === "function") {
      shadow.drawGround(eyeNode, projectionMatrix);
    }
    if (typeof main.draw === "function") {
      main.draw(eyeNode, projectionMatrix);
    }
    return alive;
  }
}
