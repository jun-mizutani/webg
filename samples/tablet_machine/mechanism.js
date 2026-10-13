// ---------------------------------------------
// mechanism.js  2026/10/13
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 回転式打錠機の工程と杵の軌道を定義する

export const TAU = Math.PI * 2;
// 水平方向の配置を共通倍率で広げ、臼・杵の公転径と回転盤の径を揃える
export const RADIAL_SCALE = 1.20;
export const RADIUS = 4.4 * RADIAL_SCALE;
export const SHAFT_LENGTH = 2.85;
export const HEAD_HALF = 0.10;
export const ROLLER_RADIUS = 1.00;

// 杵先端から杵頭までの半径と高さを並べ、太い胴体と細い首を持つ断面を作る
// 下杵の細い先端は排出時にも臼を貫通できる長さを確保する
export function punchProfile(upper) {
  const tipLength = upper ? 0.60 : 1.40;
  return [
    [0.0001, SHAFT_LENGTH + HEAD_HALF * 2],
    [0.43, SHAFT_LENGTH + HEAD_HALF * 2],
    [0.50, SHAFT_LENGTH + HEAD_HALF * 1.5],
    [0.50, SHAFT_LENGTH + HEAD_HALF * 0.5],
    [0.40, SHAFT_LENGTH],
    [0.18, SHAFT_LENGTH - 0.05],
    [0.18, SHAFT_LENGTH - 0.28],
    [0.43, SHAFT_LENGTH - 0.37],
    [0.43, tipLength + 0.14],
    [0.245, tipLength],
    [0.245, 0],
    [0.0001, 0]
  ];
}

// 排出樋と錠剤の移動で、入口高さと下り勾配を共通に使う
export const CHUTE = {
  angle: 4.66, slope: 10 * Math.PI / 180, entryHeight: 0.33,
  centerOffset: 1.45, length: 3.3, thickness: 0.06,
  tabletThickness: 0.18, travel: 2.8, endAngle: 5.58
};

// 錠剤下面が傾斜面に接する位置から、錠剤の中心位置を求める
export function sampleChute(distance) {
  const half = CHUTE.tabletThickness / 2;
  return {
    radius: RADIUS + distance + half * Math.sin(CHUTE.slope),
    height: CHUTE.entryHeight - distance * Math.tan(CHUTE.slope) + half * Math.cos(CHUTE.slope)
  };
}

export const STAGES = [
  { start: 0, end: 0.75, name: 'Filling', color: '#e3bd64', description: 'The lower punch descends to make room for powder from the feeder.' },
  { start: 0.75, end: 1.25, name: 'Metering', color: '#7fcab1', description: 'The lower punch rises slightly; excess powder is scraped off to set the fill volume.' },
  { start: 1.25, end: 2.05, name: 'Precompression', color: '#79b9f4', description: 'The smaller upper and lower rollers press the punch heads to precompress the powder.' },
  { start: 2.05, end: 3.22, name: 'Main compression', color: '#e98c9d', description: 'The punch heads pass between the main rollers, compressing the powder into a tablet.' },
  { start: 3.22, end: 5.08, name: 'Ejection', color: '#bca7f0', description: 'The upper punch retracts and the lower punch rises. The take-off blade guides the tablet outward.' },
  { start: 5.08, end: TAU, name: 'Return', color: '#8c9cad', description: 'The lower punch returns to the filling position for the next charge.' }
];

export const COMPRESSION = [
  { angle: 1.65, upper: 0.12, lower: -0.34, radius: 0.82, label: '予圧ローラー' },
  { angle: 2.65, upper: 0.04, lower: -0.14, radius: ROLLER_RADIUS, label: '本圧ローラー' }
];

// 回転角を一周の範囲へ揃え、工程表と軌道表の共通入力にする
export function wrap(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

// 両端で速度が滑らかになる補間を使い、カムによる杵の昇降を表す
function interpolate(angle, points) {
  for (let i = 1; i < points.length; i++) {
    if (angle <= points[i][0]) {
      const [a, y] = points[i - 1];
      const [b, z] = points[i];
      const t = Math.max(0, Math.min(1, (angle - a) / (b - a)));
      return y + (z - y) * t * t * (3 - 2 * t);
    }
  }
  return points.at(-1)[1];
}

// 一組の杵先端位置と粉末の状態を求め、3Dと断面図へ同じ結果を渡す
export function sampleCycle(angle) {
  const a = wrap(angle);
  let upper = interpolate(a, [[0, 1.35], [1.03, 1.35], [1.40, 0.56], [1.65, 0.12], [1.90, 0.55], [2.40, 0.49], [2.65, 0.04], [2.90, 0.49], [3.50, 1.35], [TAU, 1.35]]);
  let lower = interpolate(a, [[0, -0.83], [0.65, -0.83], [1.04, -0.63], [1.40, -0.66], [1.65, -0.34], [1.90, -0.65], [2.40, -0.59], [2.65, -0.14], [2.90, -0.59], [3.35, -0.54], [4.30, 0.33], [4.85, 0.33], [5.65, -0.83], [TAU, -0.83]]);

  // 接触区間では円形ローラーの輪郭から杵頭の高さを求める
  // ローラーの下端・上端と杵頭が接する位置を基準に、両杵の間隔を縮める
  for (const press of COMPRESSION) {
    const d = Math.abs(a - press.angle);
    const x = RADIUS * Math.sin(d);
    if (d < 0.26 && x < press.radius) {
      const rise = press.radius - Math.sqrt(press.radius ** 2 - x ** 2);
      upper = Math.min(upper, press.upper + rise);
      lower = Math.max(lower, press.lower - rise);
    }
  }

  const stage = STAGES.find(item => a >= item.start && a < item.end);
  const formed = a >= 2.65;
  const occupied = a >= 0.12 && a < 4.66;
  const top = formed ? lower + 0.18 : Math.min(0.32, upper, lower + 0.90);
  return { angle: a, upper, lower, stage, formed, occupied, top, height: top - lower };
}
