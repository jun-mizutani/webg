// ---------------------------------------------
// samples/procedural_texture/PerlinNoise2D.js  2026/08/06
//   Material-independent CPU reference implementation of 2D Perlin noise
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "../../webg/util.js";

const UINT32_MAX = 0xffffffff;
const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;
const DEFAULT_FBM_OPTIONS = Object.freeze({
  octaves: 5,
  lacunarity: 2.0,
  gain: 0.5
});

// CPU参照版と将来のWGSL版でgradientの順序とf32値を一致させるための固定table
// sampleごとの三角関数計算を避け、hashの下位3bitから8方向のいずれかを選択する
const DIAGONAL = Math.fround(0.7071067690849304);
const GRADIENTS = new Float32Array([
  1.0, 0.0,
  DIAGONAL, DIAGONAL,
  0.0, 1.0,
  -DIAGONAL, DIAGONAL,
  -1.0, 0.0,
  -DIAGONAL, -DIAGONAL,
  0.0, -1.0,
  DIAGONAL, -DIAGONAL
]);

// optionの入口で通常objectだけを受け付け、配列やnullを設定objectとして誤認しないようにする
// undefinedは省略可能なoptionを表すため、後段が既定値を補える空objectへ変換する
function readPlainObject(value, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

// 許可したkey以外を処理開始前に検出し、綴り間違いが未使用設定として残ることを防ぐ
function rejectUnknownKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label} has unknown option: ${key}`);
    }
  }
}

// 数値optionをfinite、整数条件、上下限の順に検証し、暗黙の丸めやclampを行わず返す
// labelをerrorへ含めることで、利用側がどの設定値を修正すべきか判断できるようにする
function readFiniteNumber(value, label, options = {}) {
  const { integer = false, min = -Infinity, max = Infinity } = options;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  if (value < min) throw new Error(`${label} must be >= ${min}`);
  if (value > max) throw new Error(`${label} must be <= ${max}`);
  return value;
}

// seedとsaltをunsigned 32bit整数として検証し、hashへ渡せる表現へ確定する
function readUint32(value, label) {
  return readFiniteNumber(value, label, {
    integer: true,
    min: 0,
    max: UINT32_MAX
  }) >>> 0;
}

// 2D座標や周期を必ず二要素として読み、要素ごとの検証後に変更不能な通常配列を返す
function readPair(value, label, readElement) {
  if (!Array.isArray(value) && !(value instanceof Float32Array)) {
    throw new Error(`${label} must be a two-element Array or Float32Array`);
  }
  if (value.length !== 2) throw new Error(`${label} must contain two elements`);
  return Object.freeze([
    readElement(value[0], `${label}[0]`),
    readElement(value[1], `${label}[1]`)
  ]);
}

// nullまたは省略を非周期noiseとして扱い、周期指定時はX/Yを正の整数cell数へ確定する
function readPeriod(value) {
  if (value === null || value === undefined) return null;
  return readPair(value, "periodCells", (element, label) => readFiniteNumber(element, label, {
    integer: true,
    min: 1,
    max: INT32_MAX
  }));
}

// 負の格子indexを含めて0以上period未満へ折り返し、texture両端で同じ格子を参照させる
function wrapInteger(value, period) {
  const remainder = value % period;
  return remainder < 0 ? remainder + period : remainder;
}

// signed 32bitの格子座標をbit patternを保ったままuint32へ変換する
// 負座標は2の補数表現となり、将来のWGSL側でbitcastした値と比較できる
function toLatticeUint32(value, label) {
  readFiniteNumber(value, label, {
    integer: true,
    min: INT32_MIN,
    max: INT32_MAX
  });
  return value >>> 0;
}

// fBmのoctave数、周波数倍率、振幅倍率を一式検証し、各sampleで共有できる設定へ固定する
// 周期noiseでは全octaveを同じ境界で閉じるため、lacunarityを整数へ制限する
function readFbmOptions(value, periodCells, label = "fBm options") {
  const options = readPlainObject(value, label);
  rejectUnknownKeys(options, new Set(["octaves", "lacunarity", "gain"]), label);
  const octaves = readFiniteNumber(options.octaves ?? DEFAULT_FBM_OPTIONS.octaves, `${label}.octaves`, {
    integer: true,
    min: 1,
    max: 16
  });
  const lacunarity = readFiniteNumber(
    options.lacunarity ?? DEFAULT_FBM_OPTIONS.lacunarity,
    `${label}.lacunarity`,
    { min: Number.EPSILON }
  );
  const gain = readFiniteNumber(options.gain ?? DEFAULT_FBM_OPTIONS.gain, `${label}.gain`, {
    min: 0,
    max: 1
  });
  if (periodCells && octaves > 1 && !Number.isInteger(lacunarity)) {
    throw new Error(`${label}.lacunarity must be an integer for periodic noise`);
  }
  return Object.freeze({ octaves, lacunarity, gain });
}

class PerlinNoise2D {
  // seed、salt、周期、数値modeを検証し、必要なら周期格子のgradient cacheを準備する
  // 構築後の設定変更で既知値が変わらないよう、最後にinstance自体を固定する
  constructor(options = {}) {
    const source = readPlainObject(options, "PerlinNoise2D options");
    rejectUnknownKeys(
      source,
      new Set(["seed", "salt", "periodCells", "numericMode"]),
      "PerlinNoise2D options"
    );
    this.seed = readUint32(source.seed ?? 0, "seed");
    this.salt = readUint32(source.salt ?? 0, "salt");
    this.periodCells = readPeriod(source.periodCells);
    this.numericMode = source.numericMode ?? "f32-reference";
    if (this.numericMode !== "f32-reference" && this.numericMode !== "native") {
      throw new Error("numericMode must be f32-reference or native");
    }
    this._round = this.numericMode === "f32-reference" ? Math.fround : (value) => value;
    this._periodGradientOffsets = this.periodCells
      ? this._buildPeriodGradientOffsets()
      : null;
    Object.freeze(this);
  }

  // 一つの格子座標とseed、saltをhashし、固定gradient table内の偶数offsetへ変換する
  // 呼び出し順に依存する乱数列を使わないため、同じ格子は常に同じgradientとなる
  _hashGradientOffset(latticeX, latticeY) {
    const hash = util.hashUint32Sequence([
      toLatticeUint32(latticeX, "lattice x"),
      toLatticeUint32(latticeY, "lattice y"),
      this.salt
    ], this.seed);
    return (hash & 7) * 2;
  }

  // 周期格子をconstructorで一度だけhashし、field全pixelで同じgradientを再利用する
  // cacheが過大になるperiodではnullを返し、sample時の座標hashへ安全にfallbackする
  _buildPeriodGradientOffsets() {
    const [periodX, periodY] = this.periodCells;
    const count = periodX * periodY;
    // 巨大periodを指定した単点sampleで過大なcacheを確保しない
    if (!Number.isSafeInteger(count) || count > 1048576) return null;
    const result = new Uint8Array(count);
    for (let y = 0; y < periodY; y += 1) {
      for (let x = 0; x < periodX; x += 1) {
        result[y * periodX + x] = this._hashGradientOffset(x, y);
      }
    }
    return result;
  }

  // 0から1の格子内座標へquintic fade 6t^5-15t^4+10t^3を適用する
  // 乗算順とf32丸め位置を固定し、将来のWGSL実装と段階ごとに比較できるようにする
  _fade(value) {
    const f = this._round;
    const t = f(value);
    const t6 = f(t * 6.0);
    const inner = f(f(t6 - 15.0) * t);
    const polynomial = f(f(inner + 10.0) * t);
    return f(f(polynomial * t) * t);
  }

  // 二つのscalarをweightで線形補間し、f32-referenceでは各演算境界を丸める
  _lerp(start, end, weight) {
    const f = this._round;
    return f(f(start) + f(f(weight) * f(f(end) - f(start))));
  }

  // 格子のgradientと格子点からsample位置までのdistance vectorの内積を求める
  // 周期時は格子indexを先にwrapし、cacheまたは同じ座標hashからgradientを選ぶ
  _gradientDot(latticeX, latticeY, distanceX, distanceY) {
    let hashX = latticeX;
    let hashY = latticeY;
    let gradientOffset;
    if (this.periodCells) {
      hashX = wrapInteger(latticeX, this.periodCells[0]);
      hashY = wrapInteger(latticeY, this.periodCells[1]);
      gradientOffset = this._periodGradientOffsets
        ? this._periodGradientOffsets[hashY * this.periodCells[0] + hashX]
        : this._hashGradientOffset(hashX, hashY);
    } else {
      gradientOffset = this._hashGradientOffset(hashX, hashY);
    }
    const f = this._round;
    return f(
      f(GRADIENTS[gradientOffset] * f(distanceX))
      + f(GRADIENTS[gradientOffset + 1] * f(distanceY))
    );
  }

  // 任意のnoise domain座標を検証し、選択した数値modeへ丸めて単一Perlin値を返す公開入口
  sample(x, y) {
    const f = this._round;
    const sampleX = f(readFiniteNumber(x, "x"));
    const sampleY = f(readFiniteNumber(y, "y"));
    return this._sampleValidated(sampleX, sampleY);
  }

  // 検証済み座標が属する格子cellを求め、四隅のgradient内積をX、Yの順に補間する
  // fBm field生成ではこの内部入口を使い、pixelごとの重複した型検証を避ける
  _sampleValidated(sampleX, sampleY) {
    const f = this._round;
    const x0 = Math.floor(sampleX);
    const y0 = Math.floor(sampleY);
    if (x0 < INT32_MIN || x0 >= INT32_MAX || y0 < INT32_MIN || y0 >= INT32_MAX) {
      throw new Error("sample lattice coordinate must fit signed 32bit range");
    }
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const tx = f(sampleX - x0);
    const ty = f(sampleY - y0);
    const fadeX = this._fade(tx);
    const fadeY = this._fade(ty);
    const bottom = this._lerp(
      this._gradientDot(x0, y0, tx, ty),
      this._gradientDot(x1, y0, f(tx - 1.0), ty),
      fadeX
    );
    const top = this._lerp(
      this._gradientDot(x0, y1, tx, f(ty - 1.0)),
      this._gradientDot(x1, y1, f(tx - 1.0), f(ty - 1.0)),
      fadeX
    );
    return this._lerp(bottom, top, fadeY);
  }

  // 周波数と振幅を変えた複数octaveのsigned Perlin値を正規化して返す
  fbm(x, y, options = {}) {
    const config = readFbmOptions(options, this.periodCells);
    const f = this._round;
    const baseX = f(readFiniteNumber(x, "x"));
    const baseY = f(readFiniteNumber(y, "y"));
    return this._combineOctavesValidated(baseX, baseY, config, "signed");
  }

  // 各octaveの絶対値を合成し、0を中心とした谷を持たないturbulence値を返す
  turbulence(x, y, options = {}) {
    const config = readFbmOptions(options, this.periodCells);
    const f = this._round;
    const baseX = f(readFiniteNumber(x, "x"));
    const baseY = f(readFiniteNumber(y, "y"));
    return this._combineOctavesValidated(baseX, baseY, config, "absolute");
  }

  // 各octaveを1-|noise|へ変換して合成し、細い尾根を作るridged fBm値を返す
  ridgedFbm(x, y, options = {}) {
    const config = readFbmOptions(options, this.periodCells);
    const f = this._round;
    const baseX = f(readFiniteNumber(x, "x"));
    const baseY = f(readFiniteNumber(y, "y"));
    return this._combineOctavesValidated(baseX, baseY, config, "ridged");
  }

  // 検証済み設定に従ってoctaveごとの周波数と振幅を更新し、指定modeのsignalを累積する
  // 最後に振幅合計で除算し、octave数を変えてもおおむね同じ出力rangeを維持する
  _combineOctavesValidated(baseX, baseY, config, mode) {
    const f = this._round;
    let frequency = f(1.0);
    let amplitude = f(1.0);
    let total = f(0.0);
    let amplitudeTotal = f(0.0);
    for (let octave = 0; octave < config.octaves; octave += 1) {
      const sample = this._sampleValidated(f(baseX * frequency), f(baseY * frequency));
      let signal = sample;
      if (mode === "absolute") signal = f(Math.abs(sample));
      if (mode === "ridged") signal = f(1.0 - f(Math.abs(sample)));
      total = f(total + f(signal * amplitude));
      amplitudeTotal = f(amplitudeTotal + amplitude);
      frequency = f(frequency * config.lacunarity);
      amplitude = f(amplitude * config.gain);
    }
    return amplitudeTotal === 0 ? 0 : f(total / amplitudeTotal);
  }

  // 出力寸法とnoise domain領域を検証し、row-major Float32ArrayへfBm fieldを生成する
  // texture反復では終端pixelを重複させず、column/widthとrow/heightで半開区間をsampleする
  fillFbm(options) {
    const source = readPlainObject(options, "fillFbm options");
    rejectUnknownKeys(
      source,
      new Set([
        "width", "height", "domainOrigin", "domainSize",
        "octaves", "lacunarity", "gain"
      ]),
      "fillFbm options"
    );
    const width = readFiniteNumber(source.width, "fillFbm options.width", {
      integer: true,
      min: 1
    });
    const height = readFiniteNumber(source.height, "fillFbm options.height", {
      integer: true,
      min: 1
    });
    const length = width * height;
    if (!Number.isSafeInteger(length) || length > 0xffffffff) {
      throw new Error("fillFbm field is too large");
    }
    const origin = readPair(source.domainOrigin ?? [0, 0], "fillFbm options.domainOrigin", readFiniteNumber);
    const size = readPair(source.domainSize ?? [1, 1], "fillFbm options.domainSize", readFiniteNumber);
    const fbmOptions = {
      octaves: source.octaves,
      lacunarity: source.lacunarity,
      gain: source.gain
    };
    for (const key of Object.keys(fbmOptions)) {
      if (fbmOptions[key] === undefined) delete fbmOptions[key];
    }
    const fbmConfig = readFbmOptions(fbmOptions, this.periodCells, "fillFbm options");
    const f = this._round;
    const result = new Float32Array(length);
    for (let row = 0; row < height; row += 1) {
      const y = f(origin[1] + f((row / height) * size[1]));
      for (let column = 0; column < width; column += 1) {
        const x = f(origin[0] + f((column / width) * size[0]));
        result[row * width + column] = this._combineOctavesValidated(x, y, fbmConfig, "signed");
      }
    }
    return result;
  }
}

export default PerlinNoise2D;
export { PerlinNoise2D };
