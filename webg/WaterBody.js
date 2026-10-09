// ---------------------------------------------
// WaterBody.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 有限の水平水域の設定と受光対象を保持し、GPU資源はWaterSystemへ委ねる

// 値が有限数か、指定した上下限に収まるかを検証して数値を返す
function number(value, name, min = -Infinity, max = Infinity) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite in [${min}, ${max}]`);
  }
  return value;
}

// 3成分の数値を検証し、設定として共有できる凍結配列を返す
function vector(value, name, min = -Infinity) {
  const result = Array.from(value ?? []);
  if (result.length !== 3) throw new TypeError(`${name} requires three values`);
  return Object.freeze(result.map(v => number(v, name, min)));
}

// 水域の寸法・波高・屈折率・吸収を一括検証し、確定した設定を凍結して返す
function configure(options) {
  const origin = vector(options.origin, "WaterBody.origin");
  const width = number(options.width, "WaterBody.width", 0.01);
  const depth = number(options.depth, "WaterBody.depth", 0.01);
  const extent = number(options.extent, "WaterBody.extent", Math.max(width, depth));
  const surfaceHeight = number(options.surfaceHeight, "WaterBody.surfaceHeight");
  const amplitude = number(options.amplitude, "WaterBody.amplitude", 0);
  if (surfaceHeight - origin[1] <= amplitude) {
    throw new RangeError("WaterBody mean depth must exceed amplitude");
  }
  const waveMix = vector(options.waveMix, "WaterBody.waveMix", 0);
  return Object.freeze({ origin, width, depth, extent, surfaceHeight, amplitude,
    ior: number(options.ior, "WaterBody.ior", 1, 3),
    absorption: vector(options.absorption, "WaterBody.absorption", 0),
    waterlineFade: number(options.waterlineFade, "WaterBody.waterlineFade", 0.0001),
    roughness: number(options.roughness, "WaterBody.roughness", 0.045, 1),
    wavelength: number(options.wavelength, "WaterBody.wavelength", 0.01),
    variation: number(options.variation, "WaterBody.variation", 0, 1),
    speed: number(options.speed, "WaterBody.speed", 0), waveMix });
}

export default class WaterBody {
  // 水域の寸法・波形・吸収を検証し、受光対象と時刻をCPU側で保持する
  constructor(options = {}) {
    this.receivers = new Map();
    this.time = 0;
    const width = options.width ?? 8;
    const depth = options.depth ?? 8;
    this.options = configure({ origin: [0, 0, 0], width, depth,
      extent: Math.max(width, depth) * 2.5, surfaceHeight: 2,
      amplitude: 0.15, ior: 1.333, absorption: [0.09, 0.035, 0.025],
      waterlineFade: 0.08, roughness: 0.06, wavelength: 1,
      variation: 0.65, speed: 1, waveMix: [1, 0, 0], ...options });
  }

  // patch全体を検証してから置き換え、設定を一括で更新する
  setOptions(patch) {
    this.options = configure({ ...this.options, ...patch });
    return this;
  }

  // 秒単位の時刻を検証して保持し、次の波形計算と集光生成へ渡す
  setTime(seconds) {
    this.time = number(seconds, "WaterBody.time", 0);
    return this;
  }

  // Shapeが最優先。Nodeでは最も近い登録を使い、children=falseで自身だけに限定できる
  addReceiver(target, { strength = 1, children = true } = {}) {
    if (!target || (!Array.isArray(target.shapes)
      && typeof target.getShaderParametersForMaterial !== "function")) {
      throw new TypeError("WaterBody receiver requires a Node or Shape");
    }
    if (typeof children !== "boolean") throw new TypeError("children must be boolean");
    this.receivers.set(target, { strength: number(strength, "receiver.strength", 0, 1), children });
    return this;
  }

  // 指定したShapeまたはNodeの受光登録を解除し、登録が存在したかを返す
  removeReceiver(target) { return this.receivers.delete(target); }

  // 受光対象の登録をすべて解除し、設定を続けられるよう自身を返す
  clearReceivers() { this.receivers.clear(); return this; }

  // カメラに依存する項目を除いた共通uniform。時刻・波形は二つの描画経路で一致する
  createWaveUniforms(rays = 0, pixels = 0) {
    const o = this.options;
    const values = new Float32Array(44);
    values.set([rays, pixels, o.extent, this.time]);
    values.set([o.surfaceHeight - o.origin[1], o.amplitude, o.wavelength, o.ior], 4);
    values.set([3, o.variation, o.speed, 0], 32);
    values.set(o.waveMix, 36);
    return values;
  }
}
