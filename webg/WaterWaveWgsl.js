// ---------------------------------------------
// WaterWaveWgsl.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 水面と集光の両方で用いる、解析的な高さ・勾配・Fresnelの契約

export const WATER_WAVE_WGSL = String.raw`
// 光量計算と水面表示で、このUniformと波の式を共有する
// 単位はm・秒。grid.zは計算領域の一辺。水域より広く取って境界の光束漏れを抑える
struct Params {
  grid: vec4<f32>,      // 光線数の一辺、画像の一辺、計算領域、時刻
  water: vec4<f32>,     // 平均水深、総波高、波長の倍率、屈折率
  view: vec4<f32>,      // xyz: 予約、w: 集光生成時の平均吸収係数
  eye: vec4<f32>,       // xyz: 水域原点に相対のカメラ位置、w: 予約
  right: vec4<f32>,     // xyz: カメラ右方向、w: aspect
  up: vec4<f32>,        // xyz: カメラ上方向、w: 予約
  forward: vec4<f32>,   // xyz: カメラ前方向、w: tan(半画角)
  floor: vec4<f32>,     // 予約
  wave: vec4<f32>,      // 波の形(3: 混合)、ゆらぎ、時間の速さ、予約
  waveMix: vec4<f32>,   // 交差する波、うねり、さざ波の相対的な強さ、予約
  absorptionColor: vec4<f32>, // 予約。水面のRGB吸収はSurfaceCameraで渡す
};

@group(0) @binding(0) var<uniform> params: Params;

// 一種類の波の変位と解析的な偏微分(変位, h_x, h_z)を求める
// 波の変位だけを混ぜ、平均水深は最後に一度だけ加える
// 各成分の正の重みを正規化し、変位をwater.y以内へ収める
fn waveComponent(xz: vec2<f32>, pattern: f32) -> vec3<f32> {
  // xyは波数、zは進む速さ、wは振幅の比率。0は従来の5成分を維持する
  var waves = array<vec4<f32>, 8>(
    vec4<f32>(2.6, 0.7, 0.82, 0.32),
    vec4<f32>(-1.4, 3.1, 1.13, 0.26),
    vec4<f32>(3.8, -2.4, 1.37, 0.20),
    vec4<f32>(-4.5, -3.6, 1.62, 0.14),
    vec4<f32>(1.9, 5.7, 1.88, 0.08),
    vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0)
  );
  if (pattern > 0.5 && pattern < 1.5) {
    // 大きなうねりを主にし、異なる向きの小さい波を重ねる
    waves = array<vec4<f32>, 8>(
      vec4<f32>(1.0, 0.3, 0.58, 0.40),
      vec4<f32>(0.5, 1.3, 0.75, 0.28),
      vec4<f32>(-1.5, 0.8, 1.00, 0.16),
      vec4<f32>(2.2, -0.4, 1.35, 0.10),
      vec4<f32>(-0.7, -2.4, 1.51, 0.06),
      vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0)
    );
  } else if (pattern > 1.5) {
    // 短い8成分を重ね、細かい交差と分岐を増やす
    waves = array<vec4<f32>, 8>(
      vec4<f32>(4.8, 1.8, 1.42, 0.22),
      vec4<f32>(-2.8, 5.1, 1.64, 0.19),
      vec4<f32>(7.3, -3.5, 1.83, 0.16),
      vec4<f32>(-5.4, -5.8, 2.01, 0.13),
      vec4<f32>(2.4, 8.5, 2.19, 0.10),
      vec4<f32>(-8.1, 2.1, 2.37, 0.08),
      vec4<f32>(8.8, 5.4, 2.52, 0.07),
      vec4<f32>(-4.5, 9.2, 2.71, 0.05)
    );
  }

  let time = params.grid.w * params.wave.z;
  let variation = params.wave.y;
  let count = select(5u, 8u, pattern > 1.5);
  var weights: array<f32, 8>;
  var weightSum = 0.0;
  for (var i = 0u; i < count; i++) {
    // 時間だけに依存する包絡で、強く見える成分をゆっくり入れ替える
    // 重みは時刻だけで決まり、空間微分は0として扱える
    let envelope = 1.0 - 0.25 * variation + 0.25 * variation * sin(time * (0.17 + 0.013*f32(i)) + 2.11*f32(i));
    weights[i] = waves[i].w * envelope;
    weightSum += weights[i];
  }

  var result = vec3<f32>(0.0);
  for (var i = 0u; i < count; i++) {
    let w = waves[i];
    let k = w.xy / params.water.z;
    var phase = dot(k, xz) - w.z * time + f32(i) * 1.73;
    var phaseGradient = k;
    if (variation > 0.0) {
      // 長周期の位相変調で筋を曲げ、時間に連続な形を作る
      let angle = 0.73 * f32(i) + 0.41;
      let q = vec2<f32>(cos(angle), sin(angle)) * (0.34 + 0.035*f32(i)) / params.water.z;
      let bendPhase = dot(q, xz) - (0.21 + 0.019*f32(i))*time + 1.31*f32(i);
      phase += 0.9 * variation * sin(bendPhase);
      // 曲がった位相の微分も法線へ含め、表示と集光の傾きをそろえる
      phaseGradient += 0.9 * variation * cos(bendPhase) * q;
    }
    let amplitude = params.water.y * weights[i] / weightSum;
    result += vec3<f32>(amplitude * sin(phase), amplitude * cos(phase) * phaseGradient);
  }
  return result;
}


// 水面の表示と集光は、この合成済みの高さ・傾きを使う
// 光量画像を混ぜるのではなく、先に水面を合成してから屈折を計算する
fn surface(xz: vec2<f32>) -> vec3<f32> {
  let base = vec3<f32>(params.water.x, 0.0, 0.0);
  if (params.wave.x < 2.5) {
    return base + waveComponent(xz, params.wave.x);
  }

  let weights = max(params.waveMix.xyz, vec3<f32>(0.0));
  let total = weights.x + weights.y + weights.z;
  if (total == 0.0) { return base; }

  // 非負の重みを合計1へ換算するので、混合後も波高の上界が保たれる
  // 高さと微分を同じ割合で混ぜ、合成した勾配から法線を求める
  let ratios = weights / total;
  var result = base;
  if (ratios.x > 0.0) { result += ratios.x * waveComponent(xz, 0.0); }
  if (ratios.y > 0.0) { result += ratios.y * waveComponent(xz, 1.0); }
  if (ratios.z > 0.0) { result += ratios.z * waveComponent(xz, 2.0); }
  return result;
}

// 合成した波の高さ勾配から、上向きに正規化した水面法線を求める
fn normalAt(xz: vec2<f32>) -> vec3<f32> {
  let h = surface(xz);
  return normalize(vec3<f32>(-h.y, 1.0, -h.z));
}

// 空気→水の非偏光Fresnel反射率。IOR=1では全角度で反射なし
// cは入射側のcos、ctはSnellから求めた透過側のcos
fn fresnel(c: f32, ct: f32, n: f32) -> f32 {
  if (abs(n - 1.0) < 0.00001) { return 0.0; }
  let rs = (c - n * ct) / max(c + n * ct, 0.00001);
  let rp = (n * c - ct) / max(n * c + ct, 0.00001);
  return 0.5 * (rs * rs + rp * rp);
}
`;
