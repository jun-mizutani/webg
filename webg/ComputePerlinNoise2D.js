// ---------------------------------------------
// ComputePerlinNoise2D.js  2026/08/14
//   Material-independent WebGPU compute implementation of periodic 2D Perlin fBm
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";

// CPU参照版とCompute版が共有するparameter bufferのword位置を一か所へ固定する
// 整数wordはUint32Array、実数wordは同じArrayBufferのFloat32Array viewから書き込む
const PARAM = {
  WIDTH: 0,
  HEIGHT: 1,
  SEED: 2,
  SALT: 3,
  PERIOD_X: 4,
  PERIOD_Y: 5,
  OCTAVES: 6,
  PERIODIC: 7,
  ORIGIN_X: 8,
  ORIGIN_Y: 9,
  DOMAIN_X: 10,
  DOMAIN_Y: 11,
  LACUNARITY: 12,
  GAIN: 13,
  WORD_COUNT: 16
};

// Compute Shader内でもCPU参照版と同じ順序で利用するPerlin低水準WGSLを返す
// Tile generatorもこの文字列を組み込み、hash、gradient、fadeの別実装化を防ぐ
function createPerlinWgslLibrary() {
  return `
const PERLIN_DIAGONAL : f32 = 0.7071067690849304;

// 32bit整数の各bitを均等に混ぜ、近い入力値から相関の少ないhash値を作る
// Perlin格子点ごとの勾配方向を再現可能に選ぶための最下層関数として使う
fn mixLowbias32(value : u32) -> u32 {
  var result = value;
  result = result ^ (result >> 16u);
  result = result * 0x7feb352du;
  result = result ^ (result >> 15u);
  result = result * 0x846ca68bu;
  return result ^ (result >> 16u);
}

// 二つの整数要素とseedを順番込みで混ぜ、同じ入力から同じ乱数wordを返す
// variation cellなど二次元indexだけを識別したい呼出側で使用する
fn hashSequence2(value0 : u32, value1 : u32, seed : u32) -> u32 {
  var state = mixLowbias32(seed ^ 2u);
  state = mixLowbias32(state ^ value0);
  state = mixLowbias32(state ^ value1);
  return state;
}

// 三つの整数要素とseedを混ぜ、格子X、格子Y、用途別saltを一つのhashへ畳み込む
// 配列を作らずWGSLの値だけで完結させ、CPU版と同じ入力順序を維持する
fn hashSequence3(value0 : u32, value1 : u32, value2 : u32, seed : u32) -> u32 {
  var state = mixLowbias32(seed ^ 3u);
  state = mixLowbias32(state ^ value0);
  state = mixLowbias32(state ^ value1);
  state = mixLowbias32(state ^ value2);
  return state;
}

// 四つの整数要素とseedを混ぜ、二次元cellに追加の識別値を二つ持たせる
// Voronoi feature位置のX/Yなど、同じcellから複数系列を作る場合に使う
fn hashSequence4(
  value0 : u32,
  value1 : u32,
  value2 : u32,
  value3 : u32,
  seed : u32
) -> u32 {
  var state = mixLowbias32(seed ^ 4u);
  state = mixLowbias32(state ^ value0);
  state = mixLowbias32(state ^ value1);
  state = mixLowbias32(state ^ value2);
  state = mixLowbias32(state ^ value3);
  return state;
}

// 五つの整数要素とseedを混ぜ、variation番号と局所cellと用途を同時に識別する
// Terrazzo片の配置など、階層の多い乱数入力でも文字列keyを使わず再現性を保つ
fn hashSequence5(
  value0 : u32,
  value1 : u32,
  value2 : u32,
  value3 : u32,
  value4 : u32,
  seed : u32
) -> u32 {
  var state = mixLowbias32(seed ^ 5u);
  state = mixLowbias32(state ^ value0);
  state = mixLowbias32(state ^ value1);
  state = mixLowbias32(state ^ value2);
  state = mixLowbias32(state ^ value3);
  state = mixLowbias32(state ^ value4);
  return state;
}

// u32 hashの上位24bitを0以上1未満のf32へ変換する
// f32で正確に保持できるbit数へ制限し、GPUごとの下位bit丸め差を避ける
fn uint32ToUnitFloat(value : u32) -> f32 {
  return f32(value >> 8u) / 16777216.0;
}

// 負の格子番号を含む整数座標を0以上period未満へ折り返す
// WGSLの剰余は負値を返し得るため、texture境界の周期接続前に正規化する
fn wrapI32(value : i32, period : i32) -> i32 {
  let remainder = value % period;
  return select(remainder, remainder + period, remainder < 0);
}

// Ken Perlinの6t^5 - 15t^4 + 10t^3をHorner形式で評価する
// 格子境界で一次・二次微分を0にし、補間したnoiseの継ぎ目を滑らかにする
fn perlinFade(value : f32) -> f32 {
  let t6 = value * 6.0;
  let inner = (t6 - 15.0) * value;
  let polynomial = (inner + 10.0) * value;
  return (polynomial * value) * value;
}

// startからendまでweightで線形補間し、格子四隅の寄与を連続値へまとめる
// 呼出側でX方向、Y方向の順に使用し、二次元補間の段階を明確にする
fn perlinLerp(start : f32, end : f32, weight : f32) -> f32 {
  return start + weight * (end - start);
}

// hash下位3bitを水平、垂直、斜めの八方向単位勾配へ対応させる
// 対角方向は1/sqrt(2)を使い、方向によって勾配長が変わらないようにする
fn perlinGradient(index : u32) -> vec2f {
  switch index & 7u {
    case 0u: { return vec2f(1.0, 0.0); }
    case 1u: { return vec2f(PERLIN_DIAGONAL, PERLIN_DIAGONAL); }
    case 2u: { return vec2f(0.0, 1.0); }
    case 3u: { return vec2f(-PERLIN_DIAGONAL, PERLIN_DIAGONAL); }
    case 4u: { return vec2f(-1.0, 0.0); }
    case 5u: { return vec2f(-PERLIN_DIAGONAL, -PERLIN_DIAGONAL); }
    case 6u: { return vec2f(0.0, -1.0); }
    default: { return vec2f(PERLIN_DIAGONAL, -PERLIN_DIAGONAL); }
  }
}

// 一つの格子点について、選択した勾配とsampleまでの距離vectorの内積を返す
// periodic指定時だけhash入力座標をwrapし、texture両端で同じ勾配を再利用する
fn perlinGradientDot(
  lattice : vec2i,
  distance : vec2f,
  period : vec2i,
  periodic : bool,
  seed : u32,
  salt : u32
) -> f32 {
  var hashLattice = lattice;
  if periodic {
    hashLattice = vec2i(
      wrapI32(lattice.x, period.x),
      wrapI32(lattice.y, period.y)
    );
  }
  let hash = hashSequence3(
    bitcast<u32>(hashLattice.x),
    bitcast<u32>(hashLattice.y),
    salt,
    seed
  );
  return dot(perlinGradient(hash), distance);
}

// sampleを囲む四格子点の勾配寄与をfade曲線で二段階補間する
// 戻り値は概ね-1から1の連続noiseで、色やHeightへの変換は上位関数へ任せる
fn perlinSample(
  samplePosition : vec2f,
  period : vec2i,
  periodic : bool,
  seed : u32,
  salt : u32
) -> f32 {
  let lattice0 = vec2i(floor(samplePosition));
  let lattice1 = lattice0 + vec2i(1, 1);
  let local = samplePosition - vec2f(lattice0);
  let fade = vec2f(perlinFade(local.x), perlinFade(local.y));
  let bottom = perlinLerp(
    perlinGradientDot(lattice0, local, period, periodic, seed, salt),
    perlinGradientDot(
      vec2i(lattice1.x, lattice0.y),
      vec2f(local.x - 1.0, local.y),
      period,
      periodic,
      seed,
      salt
    ),
    fade.x
  );
  let top = perlinLerp(
    perlinGradientDot(
      vec2i(lattice0.x, lattice1.y),
      vec2f(local.x, local.y - 1.0),
      period,
      periodic,
      seed,
      salt
    ),
    perlinGradientDot(lattice1, local - vec2f(1.0, 1.0), period, periodic, seed, salt),
    fade.x
  );
  return perlinLerp(bottom, top, fade.y);
}

// 周波数と振幅を変えた複数octaveのPerlin noiseを加算してfBmを作る
// lacunarityは周波数倍率、gainは振幅倍率で、最後に振幅合計で正規化する
fn perlinFbm(
  basePosition : vec2f,
  period : vec2i,
  periodic : bool,
  seed : u32,
  salt : u32,
  octaves : u32,
  lacunarity : f32,
  gain : f32
) -> f32 {
  var frequency = 1.0;
  var amplitude = 1.0;
  var total = 0.0;
  var amplitudeTotal = 0.0;
  for (var octave = 0u; octave < octaves; octave += 1u) {
    total += perlinSample(basePosition * frequency, period, periodic, seed, salt) * amplitude;
    amplitudeTotal += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return select(0.0, total / amplitudeTotal, amplitudeTotal > 0.0);
}
`;
}

// 通常objectだけを受け付け、配列やnullをoption objectとして誤認しないようにする
// 以後の検証関数が存在しないfieldを個別に推測せず、入力形式の誤りを入口で止める
function readObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

// 二要素配列を検証し、domainやperiodのX/Yが欠落した状態でshaderを実行しない
// 各要素は呼出側のreadEntryへ渡し、整数periodと実数domainで検証規則を切り替える
function readPair(value, label, readEntry) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must be a two-element Array`);
  }
  return [readEntry(value[0], `${label}[0]`), readEntry(value[1], `${label}[1]`)];
}

// field生成optionをCPU参照版と同じ意味へ正規化し、GPU resource作成前に確定する
// 寸法、周期、domain、octave設定を一度検証し、dispatch中に条件分岐を増やさない
function validateFieldOptions(options) {
  const source = readObject(options, "ComputePerlinNoise2D field options");
  const width = util.readFiniteNumber(source.width, "width", { integer: true, min: 1, max: 16384 });
  const height = util.readFiniteNumber(source.height, "height", { integer: true, min: 1, max: 16384 });
  const length = width * height;
  if (!Number.isSafeInteger(length) || length > 0x3fffffff) {
    throw new Error("ComputePerlinNoise2D field is too large");
  }
  const periodCells = source.periodCells === null || source.periodCells === undefined
    ? null
    : readPair(source.periodCells, "periodCells", (entry, label) => (
      util.readFiniteNumber(entry, label, { integer: true, min: 1, max: 0x7fffffff })
    ));
  const domainOrigin = readPair(
    source.domainOrigin ?? [0, 0],
    "domainOrigin",
    util.readFiniteNumber
  );
  const domainSize = readPair(
    source.domainSize ?? [1, 1],
    "domainSize",
    util.readFiniteNumber
  );
  const octaves = util.readFiniteNumber(
    source.octaves ?? 5,
    "octaves",
    { integer: true, min: 1, max: 16 }
  );
  const lacunarity = util.readFiniteNumber(
    source.lacunarity ?? 2.0,
    "lacunarity",
    { minExclusive: 0 }
  );
  const gain = util.readFiniteNumber(source.gain ?? 0.5, "gain", { min: 0, max: 1 });
  if (periodCells && octaves > 1 && !Number.isInteger(lacunarity)) {
    throw new Error("lacunarity must be an integer for periodic noise");
  }
  return {
    width,
    height,
    length,
    seed: util.readFiniteNumber(
      source.seed ?? 0,
      "seed",
      { integer: true, min: 0, max: 0xffffffff }
    ) >>> 0,
    salt: util.readFiniteNumber(
      source.salt ?? 0,
      "salt",
      { integer: true, min: 0, max: 0xffffffff }
    ) >>> 0,
    periodCells,
    domainOrigin,
    domainSize,
    octaves,
    lacunarity,
    gain
  };
}

class ComputePerlinNoise2D {
  // WebGPU contextを受け取り、全field生成で再利用するbind group layoutとpipelineを作る
  // fieldごとのbufferはgenerateField()で分離し、このinstanceは不変のshader資源だけを所有する
  constructor(gpu) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputePerlinNoise2D requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.destroyed = false;
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: "compute-perlin-2d layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
      ]
    });
    this.shaderModule = this.device.createShaderModule({
      label: "compute-perlin-2d shader",
      code: this.createWGSL()
    });
    this.pipeline = this.device.createComputePipeline({
      label: "compute-perlin-2d pipeline",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      compute: { module: this.shaderModule, entryPoint: "main" }
    });
  }

  // CPU参照版と同じ半開domain samplingを行い、row-major f32 bufferへ書くWGSLを返す
  // 一つのinvocationを一pixelへ対応させ、範囲外workgroup threadは書込み前に終了する
  createWGSL() {
    return `
${createPerlinWgslLibrary()}

@group(0) @binding(0) var<storage, read> params : array<u32>;
@group(0) @binding(1) var<storage, read_write> outputField : array<f32>;

// dispatchされた二次元threadからsample座標を求め、対応するrow-major要素へfBmを書き込む
// widthとheightで割る半開区間により、周期fieldの終端sampleを先頭と重複させない
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) invocation : vec3u) {
  let width = params[${PARAM.WIDTH}];
  let height = params[${PARAM.HEIGHT}];
  if invocation.x >= width || invocation.y >= height {
    return;
  }
  let origin = vec2f(
    bitcast<f32>(params[${PARAM.ORIGIN_X}]),
    bitcast<f32>(params[${PARAM.ORIGIN_Y}])
  );
  let domainSize = vec2f(
    bitcast<f32>(params[${PARAM.DOMAIN_X}]),
    bitcast<f32>(params[${PARAM.DOMAIN_Y}])
  );
  let samplePosition = origin + vec2f(
    f32(invocation.x) / f32(width),
    f32(invocation.y) / f32(height)
  ) * domainSize;
  let index = invocation.y * width + invocation.x;
  outputField[index] = perlinFbm(
    samplePosition,
    vec2i(i32(params[${PARAM.PERIOD_X}]), i32(params[${PARAM.PERIOD_Y}])),
    params[${PARAM.PERIODIC}] != 0u,
    params[${PARAM.SEED}],
    params[${PARAM.SALT}],
    params[${PARAM.OCTAVES}],
    bitcast<f32>(params[${PARAM.LACUNARITY}]),
    bitcast<f32>(params[${PARAM.GAIN}])
  );
}
`;
  }

  // browserが返すshader compilation messageを検査し、errorを含むpipelineを実行前に停止する
  // warningを含む全messageも返し、呼出側の診断や将来のWGSL更新確認に利用できるようにする
  async validateShaderCompilation() {
    if (!this.shaderModule?.getCompilationInfo) return [];
    const info = await this.shaderModule.getCompilationInfo();
    const messages = info.messages.map((message) => ({
      type: message.type,
      message: message.message,
      lineNum: message.lineNum,
      linePos: message.linePos
    }));
    const errors = messages.filter((message) => message.type === "error");
    if (errors.length > 0) {
      throw new Error(
        `ComputePerlinNoise2D WGSL compilation failed: ${errors.map((entry) => (
          `${entry.lineNum}:${entry.linePos} ${entry.message}`
        )).join(" | ")}`
      );
    }
    return messages;
  }

  // typed viewでu32とf32を同じparameter bufferへ格納し、seedのf32丸めを避ける
  // PARAMで固定したword位置へ値を書き、JavaScriptとWGSLの構造体alignment差を発生させない
  createParameterWords(options) {
    const buffer = new ArrayBuffer(PARAM.WORD_COUNT * Uint32Array.BYTES_PER_ELEMENT);
    const words = new Uint32Array(buffer);
    const floats = new Float32Array(buffer);
    words[PARAM.WIDTH] = options.width;
    words[PARAM.HEIGHT] = options.height;
    words[PARAM.SEED] = options.seed;
    words[PARAM.SALT] = options.salt;
    words[PARAM.PERIOD_X] = options.periodCells?.[0] ?? 1;
    words[PARAM.PERIOD_Y] = options.periodCells?.[1] ?? 1;
    words[PARAM.OCTAVES] = options.octaves;
    words[PARAM.PERIODIC] = options.periodCells ? 1 : 0;
    floats[PARAM.ORIGIN_X] = options.domainOrigin[0];
    floats[PARAM.ORIGIN_Y] = options.domainOrigin[1];
    floats[PARAM.DOMAIN_X] = options.domainSize[0];
    floats[PARAM.DOMAIN_Y] = options.domainSize[1];
    floats[PARAM.LACUNARITY] = options.lacunarity;
    floats[PARAM.GAIN] = options.gain;
    return words;
  }

  // 一つのfield用resourceとdispatchを作成・submitし、GPU上のfield handleを返す
  // 通常利用ではこのhandleを次のCompute passへ渡し、readbackしない
  // parameter bufferと出力bufferの所有権は返却handleへ移し、destroyField()で対にして解放する
  generateField(options) {
    if (this.destroyed) throw new Error("ComputePerlinNoise2D is destroyed");
    const specification = validateFieldOptions(options);
    const params = this.createParameterWords(specification);
    const parameterBuffer = this.device.createBuffer({
      label: "compute-perlin-2d parameters",
      size: params.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    const outputBuffer = this.device.createBuffer({
      label: "compute-perlin-2d field",
      size: specification.length * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.queue.writeBuffer(parameterBuffer, 0, params);
    const bindGroup = this.device.createBindGroup({
      label: "compute-perlin-2d bind group",
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: parameterBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } }
      ]
    });
    const encoder = this.device.createCommandEncoder({ label: "compute-perlin-2d encoder" });
    const pass = encoder.beginComputePass({ label: "compute-perlin-2d dispatch" });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(specification.width / 8), Math.ceil(specification.height / 8), 1);
    pass.end();
    this.queue.submit([encoder.finish()]);
    return {
      buffer: outputBuffer,
      parameterBuffer,
      width: specification.width,
      height: specification.height,
      length: specification.length,
      specification,
      destroyed: false
    };
  }

  // 利用を終えたfield固有bufferを明示破棄し、field再生成でGPU memoryを残さない
  // 二重破棄はfalseを返し、handle内参照をnull化して破棄後利用を発見しやすくする
  destroyField(field) {
    if (!field || field.destroyed) return false;
    field.buffer?.destroy();
    field.parameterBuffer?.destroy();
    field.buffer = null;
    field.parameterBuffer = null;
    field.destroyed = true;
    return true;
  }

  // pipeline所有classを破棄済みにし、以後のfield生成を早期に例外として検出する
  // WebGPU pipeline自体にdestroy APIはないためJavaScript参照を解放してlife cycleを終了する
  destroy() {
    if (this.destroyed) return false;
    this.bindGroupLayout = null;
    this.shaderModule = null;
    this.pipeline = null;
    this.destroyed = true;
    return true;
  }
}

export default ComputePerlinNoise2D;
export { ComputePerlinNoise2D, createPerlinWgslLibrary };
