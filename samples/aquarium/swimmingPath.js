// ---------------------------------------------
// swimmingPath.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 立体的な遊泳経路を、距離に沿って一定速度で進む

import Matrix from "../../webg/Matrix.js";
import Quat from "../../webg/Quat.js";

const TAU = Math.PI * 2;

// 立体経路の距離表を先に作り、時刻から等速移動の位置と姿勢を求める関数を返す
export function createSwimmingPath({ radiusX, radiusZ, height, heightAmplitude, phase, speed,
  center = [0, 0], heading = 0, bend = 0, verticalCycles = 2,
  verticalPhase = 0, direction = 1, rollAmplitude = 10, rollRate = .8 + phase * .04 }) {
  const cos = Math.cos(heading), sin = Math.sin(heading);

  // 中心と水平回転だけでなく、二次のうねりで経路そのものの形も変える
  // 高さの周期・位相と周回方向を分け、個体ごとに異なる場所で潜る
  const positionAt = angle => {
    const x = radiusX * Math.sin(angle) + bend * Math.sin(angle * 2);
    const z = radiusZ * Math.cos(angle) + bend * .5 * Math.sin(angle * 2 + .7);
    return [center[0] + cos * x - sin * z,
      height + heightAmplitude * Math.sin(angle * verticalCycles + verticalPhase),
      center[1] + sin * x + cos * z];
  };

  // 角度を等速で増やすと、楕円の端では移動だけが遅くなる
  // 一周の距離表を先に作り、フレームごとの移動距離から角度を求める
  const divisions = 1024;
  const distances = [0];
  let previous = positionAt(0);
  for (let i = 1; i <= divisions; i++) {
    const next = positionAt(TAU * i / divisions);
    distances.push(distances[i - 1] + Math.hypot(...next.map((v, j) => v - previous[j])));
    previous = next;
  }
  const length = distances[divisions];
  const phaseIndex = ((phase % TAU + TAU) % TAU) / TAU * divisions;
  const index = Math.floor(phaseIndex);
  const offset = distances[index] + (distances[index + 1] - distances[index]) * (phaseIndex - index);
  const matrix = new Matrix();
  const rotation = new Quat();

  return {
    // 指定時刻に対応する経路上の位置と、進行方向・身体のねじれを合わせた姿勢を返す
    sample(time) {
      const distance = ((offset + time * speed * direction) % length + length) % length;
      let lo = 0, hi = divisions;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (distances[mid] <= distance) lo = mid;
        else hi = mid;
      }
      const fraction = (distance - distances[lo]) / (distances[hi] - distances[lo]);
      const angle = TAU * (lo + fraction) / divisions;

      // GLBの頭はローカル+Z側。経路の微分を正規化して前方軸にする
      // 上昇・下降も含むため、頭が向く方向と実際の移動方向が一致する
      const dx = radiusX * Math.cos(angle) + 2 * bend * Math.cos(angle * 2);
      const dz = -radiusZ * Math.sin(angle) + bend * Math.cos(angle * 2 + .7);
      const tangent = [cos * dx - sin * dz,
        verticalCycles * heightAmplitude * Math.cos(angle * verticalCycles + verticalPhase),
        sin * dx + cos * dz].map(v => v * direction);
      const norm = Math.hypot(...tangent);
      const forward = tangent.map(v => v / norm);
      const horizontal = Math.hypot(forward[0], forward[2]);
      const right = [forward[2] / horizontal, 0, -forward[0] / horizontal];
      const up = [forward[1] * right[2],
        forward[2] * right[0] - forward[0] * right[2], -forward[1] * right[0]];

      // 接線を保ったまま前方軸のまわりにねじる。振幅と周期は個体別で、
      // 90度傾く個体はゆっくり回す。経路と上下動の周期からは独立させる
      const roll = rollAmplitude * Math.PI / 180 * Math.sin(time * rollRate + phase);
      const rollCos = Math.cos(roll), rollSin = Math.sin(roll);

      // 右・上・前を列に持つ回転行列をクォータニオンへ変換する
      // 前方軸を接線へ直接合わせ、姿勢の基準を進行方向から組み立てる
      for (let row = 0; row < 3; row++) {
        matrix.set(row, 0, right[row] * rollCos + up[row] * rollSin);
        matrix.set(row, 1, up[row] * rollCos - right[row] * rollSin);
        matrix.set(row, 2, forward[row]);
      }
      rotation.matrixToQuat(matrix);
      return { position: positionAt(angle), rotation };
    }
  };
}
