// ---------------------------------------------
//  BoxContact.js  2026/08/28
//   Shared Compute-style OBB contact geometry
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

const EPSILON = 1.0e-8;

// vec3の内積を計算し、SATの射影距離とsupport featureの選択で同じ順序を使います
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// vec3の外積を計算し、Boxの15本目の分離軸を作ります
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// vec3へscalarを掛け、SAT法線の向きとsupport方向を明示的に反転します
function scale3(value, scalar) {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

// Boxのworld中心とlocal軸から8頂点を生成し、support featureの入力へ渡します
// 頂点の並び順はGPU側の符号組合せと同じにして、support点の平均順序を固定します
function buildBoxCorners(box) {
  const corners = [];
  for (let index = 0; index < 8; index += 1) {
    const signX = (index & 1) !== 0 ? 1.0 : -1.0;
    const signY = (index & 2) !== 0 ? 1.0 : -1.0;
    const signZ = (index & 4) !== 0 ? 1.0 : -1.0;
    const offsetX = box.half[0] * signX;
    const offsetY = box.half[1] * signY;
    const offsetZ = box.half[2] * signZ;
    const afterX = [
      box.center[0] + box.axes[0][0] * offsetX,
      box.center[1] + box.axes[0][1] * offsetX,
      box.center[2] + box.axes[0][2] * offsetX
    ];
    const afterY = [
      afterX[0] + box.axes[1][0] * offsetY,
      afterX[1] + box.axes[1][1] * offsetY,
      afterX[2] + box.axes[1][2] * offsetY
    ];
    corners.push([
      afterY[0] + box.axes[2][0] * offsetZ,
      afterY[1] + box.axes[2][1] * offsetZ,
      afterY[2] + box.axes[2][2] * offsetZ
    ]);
  }
  return corners;
}

// Box pairの15軸を一度だけ正規化し、solver反復での軸計算を共有します
// zero軸はnullのまま保持し、任意の軸へ置き換えて接触を作らないようにします
export function createBoxPairAxisCache(axesA, axesB) {
  const normalizeAxis = (axis) => {
    const lengthSquared = dot3(axis, axis);
    if (lengthSquared < EPSILON) {
      return null;
    }
    const inverseLength = 1.0 / Math.sqrt(lengthSquared);
    return scale3(axis, inverseLength);
  };
  return {
    normalizedA: axesA.map(normalizeAxis),
    normalizedB: axesB.map(normalizeAxis),
    normalizedCross: axesA.map((axisA) => axesB.map((axisB) => (
      normalizeAxis(cross3(axisA, axisB))
    )))
  };
}

// 一つのSAT軸を検査し、最小penetrationの法線候補を更新します
// 分離軸を見つけた場合はfalseを返し、接触しているpairだけをcontactへ変換します
function testSatAxis(
  axisInput,
  centerDelta,
  boxA,
  boxB,
  best,
  normalizedAxis = undefined,
  includeTouching = false
) {
  if (normalizedAxis === null) {
    return true;
  }
  const lengthSquared = normalizedAxis === undefined
    ? dot3(axisInput, axisInput)
    : 1.0;
  if (lengthSquared < EPSILON) {
    return true;
  }
  const axis = normalizedAxis ?? scale3(axisInput, 1.0 / Math.sqrt(lengthSquared));
  const radiusA = boxA.half[0] * Math.abs(dot3(boxA.axes[0], axis))
    + boxA.half[1] * Math.abs(dot3(boxA.axes[1], axis))
    + boxA.half[2] * Math.abs(dot3(boxA.axes[2], axis));
  const radiusB = boxB.half[0] * Math.abs(dot3(boxB.axes[0], axis))
    + boxB.half[1] * Math.abs(dot3(boxB.axes[1], axis))
    + boxB.half[2] * Math.abs(dot3(boxB.axes[2], axis));
  const signedDistance = dot3(centerDelta, axis);
  const overlap = radiusA + radiusB - Math.abs(signedDistance);
  if (includeTouching ? overlap < 0.0 : overlap <= 0.0) {
    return false;
  }
  if (overlap < best.penetration) {
    best.normal = signedDistance >= 0.0 ? axis : scale3(axis, -1.0);
    best.penetration = overlap;
  }
  return true;
}

// Box pairの15軸SATを実行し、support点計算に必要なgeometryを返します
// callerが軸cacheを渡した場合は、Compute互換CPU solverの反復ごとの再計算を避けます
export function buildBoxContactGeometry(boxA, boxB, axisCache = null, options = {}) {
  const cornersA = boxA.corners ?? buildBoxCorners(boxA);
  const cornersB = boxB.corners ?? buildBoxCorners(boxB);
  const centerDelta = [
    boxB.center[0] - boxA.center[0],
    boxB.center[1] - boxA.center[1],
    boxB.center[2] - boxA.center[2]
  ];
  const resolvedAxisCache = axisCache ?? createBoxPairAxisCache(boxA.axes, boxB.axes);
  const includeTouching = options.includeTouching === true;
  const best = { normal: [0.0, 0.0, 0.0], penetration: Infinity };
  for (let axis = 0; axis < 3; axis += 1) {
    if (!testSatAxis(
      boxA.axes[axis], centerDelta, boxA, boxB, best,
      resolvedAxisCache.normalizedA[axis],
      includeTouching
    )) {
      return null;
    }
    if (!testSatAxis(
      boxB.axes[axis], centerDelta, boxA, boxB, best,
      resolvedAxisCache.normalizedB[axis],
      includeTouching
    )) {
      return null;
    }
  }
  for (let axisA = 0; axisA < 3; axisA += 1) {
    for (let axisB = 0; axisB < 3; axisB += 1) {
      if (!testSatAxis(
        null, centerDelta, boxA, boxB, best,
        resolvedAxisCache.normalizedCross[axisA][axisB],
        includeTouching
      )) {
        return null;
      }
    }
  }
  if (best.normal === null || best.penetration === Infinity) {
    throw new Error("BoxContact SAT did not produce a contact axis");
  }
  return { cornersA, cornersB, best };
}

// SAT法線方向の最大投影にあるsupport feature頂点だけを順番どおり選びます
// toleranceを0へ補正せず、呼出側が指定したCompute版の寸法基準をそのまま使います
export function getBoxSupportFeature(box, direction, tolerance, corners = null) {
  const points = corners ?? buildBoxCorners(box);
  let maximum = -Infinity;
  const projections = new Array(points.length);
  for (let index = 0; index < points.length; index += 1) {
    const projection = dot3(points[index], direction);
    projections[index] = projection;
    maximum = Math.max(maximum, projection);
  }
  const selected = [];
  for (let index = 0; index < points.length; index += 1) {
    if (maximum - projections[index] <= tolerance) {
      selected.push(points[index]);
    }
  }
  if (selected.length <= 0) {
    throw new Error("BoxContact support feature is empty");
  }
  return selected;
}

// support featureの頂点平均をCompute版の代表contact pointとして返します
// 面・辺・頂点のいずれでも同じ代表点式を使い、CPUとComputeの接触位置を揃えます
export function getBoxSupportFeatureCenter(box, direction, tolerance, corners = null) {
  const points = getBoxSupportFeature(box, direction, tolerance, corners);
  const sum = [0.0, 0.0, 0.0];
  for (const point of points) {
    sum[0] += point[0];
    sum[1] += point[1];
    sum[2] += point[2];
  }
  const inverseCount = 1.0 / points.length;
  return [sum[0] * inverseCount, sum[1] * inverseCount, sum[2] * inverseCount];
}

// Compute版Box contactの最小軸・penetration・support feature中点を一つの結果へまとめます
// CPU coreとCompute互換CPU solverはこの同じ関数を呼び、共通の形状計算を使います
export function buildBoxContact(boxA, boxB, tolerance, axisCache = null) {
  const geometry = buildBoxContactGeometry(boxA, boxB, axisCache);
  if (geometry === null) {
    return null;
  }
  const { cornersA, cornersB, best } = geometry;
  const pointA = getBoxSupportFeatureCenter(boxA, best.normal, tolerance, cornersA);
  const pointB = getBoxSupportFeatureCenter(
    boxB,
    scale3(best.normal, -1.0),
    tolerance,
    cornersB
  );
  return {
    normal: best.normal,
    penetration: best.penetration,
    point: [
      (pointA[0] + pointB[0]) * 0.5,
      (pointA[1] + pointB[1]) * 0.5,
      (pointA[2] + pointB[2]) * 0.5
    ]
  };
}

// 二つのBoxが接触または境界上にあるかをquery用に判定します
// 物理contactと同じSATを使い、queryだけの旧OBB実装を残さないようにします
export function boxesOverlap(boxA, boxB, axisCache = null) {
  return buildBoxContactGeometry(boxA, boxB, axisCache, {
    includeTouching: true
  }) !== null;
}
