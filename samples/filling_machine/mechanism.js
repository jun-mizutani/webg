// ---------------------------------------------
// mechanism.js  2026/10/13
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 回転式カプセル充填機の工程、受け台、カプセル形状を定義する

export const TAU = Math.PI * 2;
export const RADIUS = 4.8;
export const COUNT = 12;
export const DOSING = { angle: 2.60, halfWindow: .032 };
export const STAGES = [
  { start: 0, end: .78, seek: .38, name: 'Supply', color: '#e9bd6b', description: 'An alignment guide feeds empty capsules into the holders, cap uppermost.' },
  { start: .78, end: 1.55, seek: 1.18, name: 'Separation', color: '#8fcab9', description: 'The upper holder keeps the cap in place while vacuum pulls the body downward.' },
  { start: 1.55, end: 3.22, seek: DOSING.angle, name: 'Filling', color: '#91c8f4', description: 'The body holder slides outward; a dosing cylinder feeds powder through the nozzle.' },
  { start: 3.22, end: 4.15, seek: 3.93, name: 'Closing', color: '#e998a8', description: 'The body returns beneath the cap. A lower pin lifts it into the cap to close the capsule.' },
  { start: 4.15, end: 5.55, seek: 4.85, name: 'Ejection', color: '#c2aef0', description: 'The finished capsule is lifted out and guided onto the discharge chute.' },
  { start: 5.55, end: TAU, seek: 5.92, name: 'Cleaning / return', color: '#98acbf', description: 'The empty holders pass the cleaning unit and return to the supply position.' }
];
export const CHUTE = { angle: 4.75, end: 5.55, travel: 3.2, slope: 10 * Math.PI / 180, entryHeight: .62, centerOffset: 2.15, length: 4.8, thickness: .08 };

// 一周を共通の角度範囲へ揃え、全組の工程を同じ軌道で求める
export function wrap(angle) { return ((angle % TAU) + TAU) % TAU; }

// 区間の両端で速度を滑らかにし、受け台の昇降と外側移動を補間する
export function ramp(value, start, end) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

// 丸い閉端と薄い壁を持つキャップ・ボディの断面を、半径と高さの組で返す
export function capsuleProfile(cap) {
  const outer = cap ? .275 : .25;
  const inner = cap ? .255 : .225;
  const straight = cap ? .34 : .63;
  const profile = [[outer, 0], [outer, straight]];
  for (let i = 1; i <= 8; i++) {
    const a = i / 8 * Math.PI / 2;
    profile.push([Math.max(.0001, outer * Math.cos(a)), straight + outer * Math.sin(a)]);
  }
  for (let i = 8; i >= 0; i--) {
    const a = i / 8 * Math.PI / 2;
    profile.push([Math.max(.0001, inner * Math.cos(a)), straight + inner * Math.sin(a)]);
  }
  profile.push([inner, 0], [outer, 0]);
  // ボディの閉端を下に置き、開口を上へ向ける
  if (!cap) return profile.reverse().map(([r, y]) => [r, straight + outer - y]);
  return profile;
}

// 現在の工程から分離量、外側移動量、粉末量、結合・排出状態を計算する
export function sampleCycle(angle) {
  const a = wrap(angle);
  const stage = STAGES.find(item => a >= item.start && a < item.end);
  const loaded = a >= .12 && a < CHUTE.end;
  const drop = 1.6 * (1 - ramp(a, .12, .55));
  const separated = ramp(a, .78, 1.18) * (1 - ramp(a, 3.58, 4.12));
  const radial = 1.20 * ramp(a, 1.22, 1.76) * (1 - ramp(a, 3.23, 3.64));
  const fill = ramp(a, DOSING.angle - DOSING.halfWindow, DOSING.angle + DOSING.halfWindow);
  const bodyY = -.25 - .62 * separated + drop + .80 * ramp(a, 4.18, 4.73);
  const capY = bodyY + .63 + .62 * separated;
  const holderY = -.25 - .62 * separated;
  return { angle: a, stage, loaded, radial, fill, bodyY, capY, holderY, ejecting: a >= CHUTE.angle && a < CHUTE.end };
}

// カプセルの外形から傾斜面までの高さを求め、樋に沿って倒れながら排出する
export function sampleEjection(angle) {
  const progress = Math.max(0, Math.min(1, (angle - CHUTE.angle) / (CHUTE.end - CHUTE.angle)));
  const distance = progress * CHUTE.travel;
  const tilt = ramp(progress, 0, .28) * Math.PI / 2;
  let minimum = 0;
  for (const cap of [false, true]) {
    for (const [r, y] of capsuleProfile(cap)) minimum = Math.min(minimum, (y + (cap ? .63 : 0)) * Math.cos(tilt) - r * Math.sin(tilt));
  }
  const clearance = -minimum + .012;
  return {
    radius: RADIUS + distance + clearance * Math.sin(CHUTE.slope),
    y: CHUTE.entryHeight - distance * Math.tan(CHUTE.slope) + clearance * Math.cos(CHUTE.slope),
    tilt: -(CHUTE.slope + tilt)
  };
}
