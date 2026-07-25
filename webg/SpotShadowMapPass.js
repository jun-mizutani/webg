// ---------------------------------------------
// SpotShadowMapPass.js  2026/07/25
//   Spot light shadow map pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Matrix from "./Matrix.js";
import ShadowMapPass from "./ShadowMapPass.js";
import util from "./util.js";
import { SHADOW_STANDARD_Z } from "./DepthConvention.js";

// 方向を検証し、後続処理が扱える共通形式へ整える
function normalizeDirection(value, label) {
  const vector = util.readColor(value, label, undefined, 3);
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length <= 1.0e-8) {
    throw new Error(`${label} has zero length`);
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

// `cross`は座標または数値を計算し、後続処理で使う結果を返す
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// spot lightの位置と照射方向から、perspective shadow map用のview-projectionを作る
// webg cameraと同じくlocal -Zを前方として扱い、ShadowMapPassのdepth-only描画へ渡せる形にする
export function createSpotLightMatrices(options = {}) {
  const position = util.readColor(
    options.position,
    "spot shadow position",
    undefined,
    3
  );
  const direction = normalizeDirection(
    options.direction,
    "spot shadow direction"
  );
  const near = util.readFiniteNumber(
    options.near,
    "spot shadow near",
    { minExclusive: 0 }
  );
  const far = util.readFiniteNumber(
    options.far,
    "spot shadow far",
    { minExclusive: near }
  );
  const fov = util.readFiniteNumber(
    options.fov,
    "spot shadow fov",
    { minExclusive: 0, maxExclusive: 180 }
  );
  const aspect = util.readOptionalFiniteNumber(
    options.aspect,
    "spot shadow aspect",
    1.0,
    { minExclusive: 0 }
  );
  const worldUp = normalizeDirection(
    options.up ?? [0, 1, 0],
    "spot shadow up"
  );

  const back = [-direction[0], -direction[1], -direction[2]];
  let rightRaw = cross(worldUp, back);
  let rightLength = Math.hypot(rightRaw[0], rightRaw[1], rightRaw[2]);
  if (rightLength <= 1.0e-8) {
    rightRaw = cross([1, 0, 0], back);
    rightLength = Math.hypot(rightRaw[0], rightRaw[1], rightRaw[2]);
  }
  if (rightLength <= 1.0e-8) {
    throw new Error("spot shadow direction must not be parallel to all up candidates");
  }
  const right = rightRaw.map((value) => value / rightLength);
  const up = normalizeDirection(cross(back, right), "spot shadow camera up");

  const world = new Matrix();
  world.setBulk([
    right[0], right[1], right[2], 0,
    up[0], up[1], up[2], 0,
    back[0], back[1], back[2], 0,
    position[0], position[1], position[2], 1
  ]);
  const view = new Matrix();
  view.makeView(world);
  const projection = new Matrix();
  // spot lightは有限farへ限定した透視Shadow Mapとして、通常Z契約を明示する
  // 通常カメラのReverse-Zへ暗黙に追従させず、biasとPCFの基準を第一実装期で維持する
  projection.makeProjectionMatrix(near, far, fov, aspect, SHADOW_STANDARD_Z);
  const viewProjection = projection.clone();
  viewProjection.mul_(view);

  return {
    type: "spot",
    position,
    direction,
    world,
    view,
    projection,
    viewProjection,
    fov,
    near,
    far,
    aspect
  };
}

// depth-onlyの描画処理はShadowMapPassと同じなので、spot専用classは行列生成の責務を明示する
export default class SpotShadowMapPass extends ShadowMapPass {
  createLightMatrices(options = {}) {
    return createSpotLightMatrices(options);
  }
}
