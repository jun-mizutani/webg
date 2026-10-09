// ---------------------------------------------
//  PlaneBoxContact.js  2026/08/28
//   Shared Compute-style Plane-Box support geometry
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

const EPSILON = 1.0e-8;

// vec3の内積を計算し、平面距離と支持範囲の投影で同じ式を使います
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// vec3の外積を計算し、平面法線から直交する接線基底を作ります
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// vec3を正規化し、退化した平面法線を任意方向へ置き換えず検出します
function normalize3(value, name) {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= EPSILON) {
    throw new Error(`${name} must not be zero`);
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

// 平面法線に直交する2本の接線基底を作り、床・壁・斜面の支持判定を共通化します
// normalのY成分が大きい床ではX軸、それ以外ではY軸をseedにして退化を避けます
export function buildPlaneTangentBasis(normal) {
  const seed = Math.abs(normal[1]) < 0.95
    ? [0.0, 1.0, 0.0]
    : [1.0, 0.0, 0.0];
  const tangentA = normalize3(cross3(seed, normal), "PlaneBoxContact tangentA");
  const tangentB = normalize3(cross3(normal, tangentA), "PlaneBoxContact tangentB");
  return [tangentA, tangentB];
}

// 支持点へ重心投影が含まれるかを線分・三角形で判定します
// 1点支持を安定支持へ置き換えず、支持範囲内の場合だけ重心位置を代表点へ使います
export function isPlaneSupportProjectionBalanced(
  activePoints,
  normal,
  position,
  tolerance,
  tangentBasis = null
) {
  if (activePoints.length < 2) {
    return false;
  }
  const [tangentA, tangentB] = tangentBasis ?? buildPlaneTangentBasis(normal);
  const supports = activePoints.map((point) => [
    dot3(point, tangentA),
    dot3(point, tangentB)
  ]);
  const center = [dot3(position, tangentA), dot3(position, tangentB)];
  const distanceToSegment = (first, second) => {
    const edge = [second[0] - first[0], second[1] - first[1]];
    const lengthSquared = edge[0] * edge[0] + edge[1] * edge[1];
    if (lengthSquared <= EPSILON) {
      return Math.hypot(center[0] - first[0], center[1] - first[1]);
    }
    const projection = Math.max(0.0, Math.min(1.0, (
      (center[0] - first[0]) * edge[0]
      + (center[1] - first[1]) * edge[1]
    ) / lengthSquared));
    return Math.hypot(
      center[0] - first[0] - edge[0] * projection,
      center[1] - first[1] - edge[1] * projection
    );
  };
  for (let first = 0; first < supports.length; first += 1) {
    for (let second = first + 1; second < supports.length; second += 1) {
      if (distanceToSegment(supports[first], supports[second]) <= tolerance) {
        return true;
      }
    }
  }
  if (supports.length < 3) {
    return false;
  }
  for (let first = 0; first < supports.length; first += 1) {
    for (let second = first + 1; second < supports.length; second += 1) {
      for (let third = second + 1; third < supports.length; third += 1) {
        const edgeA = [
          supports[second][0] - supports[first][0],
          supports[second][1] - supports[first][1]
        ];
        const edgeB = [
          supports[third][0] - supports[first][0],
          supports[third][1] - supports[first][1]
        ];
        const denominator = edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0];
        if (Math.abs(denominator) <= EPSILON) {
          continue;
        }
        const toCenter = [
          center[0] - supports[first][0],
          center[1] - supports[first][1]
        ];
        const coordinateA = (
          toCenter[0] * edgeB[1] - toCenter[1] * edgeB[0]
        ) / denominator;
        const coordinateB = (
          edgeA[0] * toCenter[1] - edgeA[1] * toCenter[0]
        ) / denominator;
        if (coordinateA >= -1.0e-6
          && coordinateB >= -1.0e-6
          && coordinateA + coordinateB <= 1.0 + 1.0e-6) {
          return true;
        }
      }
    }
  }
  return false;
}

// PlaneとBox頂点群から、Compute版と同じ一つの代表support contactを生成します
// 接触していない場合はnullを返し、実際の頂点位置から接触を判定します
export function buildPlaneBoxSupportContact(plane, boxPosition, vertices, tolerance, tangentBasis = null) {
  const planeDistance = plane.planeDistance ?? dot3(plane.point, plane.normal);
  const distances = vertices.map((point) => dot3(point, plane.normal) - planeDistance);
  const minimumDistance = Math.min(...distances);
  const penetration = -minimumDistance;
  if (penetration <= 0.0) {
    return null;
  }
  const activePoints = vertices.filter((point, index) => distances[index] <= tolerance);
  if (activePoints.length <= 0) {
    throw new Error("PlaneBoxContact support feature is empty");
  }
  const balanced = isPlaneSupportProjectionBalanced(
    activePoints,
    plane.normal,
    boxPosition,
    tolerance,
    tangentBasis
  );
  const supportPoint = balanced
    ? [...boxPosition]
    : activePoints.reduce((sum, point) => [
      sum[0] + point[0],
      sum[1] + point[1],
      sum[2] + point[2]
    ], [0.0, 0.0, 0.0]).map((value) => value / activePoints.length);
  const supportDistance = dot3(supportPoint, plane.normal) - planeDistance;
  supportPoint[0] -= plane.normal[0] * supportDistance;
  supportPoint[1] -= plane.normal[1] * supportDistance;
  supportPoint[2] -= plane.normal[2] * supportDistance;
  return {
    penetration,
    point: supportPoint,
    activePoints,
    balanced
  };
}
