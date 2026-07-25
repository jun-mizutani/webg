// ---------------------------------------------
// samples/mmodeler/ModelerPrimitiveFactory.js  2026/05/26
//   Editable primitive geometry factory for mmodeler.
//   mmodeler は頂点選択、face 選択、loop cut、subdivision などの編集操作を行うため、
//   webg core の描画用 Primitive ではなく、編集可能な vertices / faces 構造を直接生成する。
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import { readVec3 } from "./math3d.js";

export const VALID_PRIMITIVE_SEGMENTS = Object.freeze([3, 4, 8, 12, 16, 24, 32]);

// primitive の分割数を検証する
// UI 側の選択肢と生成側の前提を一致させ、意図しない値で壊れた mesh を作らないようにする
export function readPrimitiveSegments(value) {
  const segments = Number(value);
  if (!VALID_PRIMITIVE_SEGMENTS.includes(segments)) {
    throw new Error(`invalid primitive segment count: ${segments}`);
  }
  return segments;
}

// primitive 追加で使う頂点配列と face 配列を作る
// 既存 object を置き換えず、1 primitive を 1 object として scene へ足すための local geometry を返す
// primitive の local origin は形状の中心に置き、object origin と一致させる
// ここで返す face loop は外向きの面順を正とし、追加後に原点基準の自動反転を掛けない
export function makePrimitiveGeometry(kind, options = {}) {
  const normalized = String(kind ?? "").trim().toLowerCase();
  const segments = readPrimitiveSegments(options.segments ?? 12);
  if (normalized === "cube") {
    return {
      name: "Cube",
      vertices: [
        [-1.0, -1.0, -1.0],
        [1.0, -1.0, -1.0],
        [1.0, -1.0, 1.0],
        [-1.0, -1.0, 1.0],
        [-1.0, 1.0, -1.0],
        [1.0, 1.0, -1.0],
        [1.0, 1.0, 1.0],
        [-1.0, 1.0, 1.0]
      ],
      faces: [
        [1, 2, 3, 4],
        [5, 8, 7, 6],
        [1, 5, 6, 2],
        [2, 6, 7, 3],
        [3, 7, 8, 4],
        [4, 8, 5, 1]
      ]
    };
  }
  if (normalized === "plane") {
    return {
      name: "Plane",
      vertices: [
        [-1.0, 0.0, -1.0],
        [1.0, 0.0, -1.0],
        [1.0, 0.0, 1.0],
        [-1.0, 0.0, 1.0]
      ],
      faces: [[1, 4, 3, 2]]
    };
  }
  if (normalized === "sphere") {
    const vertices = [[0.0, 1.0, 0.0]];
    const faces = [];
    const longitudeSegments = segments;
    const latitudeSegments = Math.max(3, Math.floor(segments / 2));
    const ringVertexId = (lat, lon) => 2 + (lat - 1) * longitudeSegments + (lon % longitudeSegments);
    for (let lat = 1; lat < latitudeSegments; lat++) {
      const theta = Math.PI * lat / latitudeSegments;
      const y = Math.cos(theta);
      const ringRadius = Math.sin(theta);
      for (let lon = 0; lon < longitudeSegments; lon++) {
        const phi = 2.0 * Math.PI * lon / longitudeSegments;
        vertices.push([
          Math.cos(phi) * ringRadius,
          y,
          Math.sin(phi) * ringRadius
        ]);
      }
    }
    const bottomId = vertices.length + 1;
    vertices.push([0.0, -1.0, 0.0]);
    for (let lon = 0; lon < longitudeSegments; lon++) {
      const nextLon = (lon + 1) % longitudeSegments;
      faces.push([1, ringVertexId(1, nextLon), ringVertexId(1, lon)]);
    }
    for (let lat = 1; lat < latitudeSegments - 1; lat++) {
      for (let lon = 0; lon < longitudeSegments; lon++) {
        const nextLon = (lon + 1) % longitudeSegments;
        faces.push([
          ringVertexId(lat, lon),
          ringVertexId(lat, nextLon),
          ringVertexId(lat + 1, nextLon),
          ringVertexId(lat + 1, lon)
        ]);
      }
    }
    for (let lon = 0; lon < longitudeSegments; lon++) {
      const nextLon = (lon + 1) % longitudeSegments;
      faces.push([ringVertexId(latitudeSegments - 1, lon), ringVertexId(latitudeSegments - 1, nextLon), bottomId]);
    }
    return { name: "Sphere", vertices, faces };
  }
  if (normalized === "torus") {
    const vertices = [];
    const faces = [];
    const ringSegments = segments;
    const tubeSegments = Math.max(3, Math.floor(segments / 2));
    const majorRadius = 0.78;
    const tubeRadius = 0.28;
    const vertexId = (ring, tube) => (ring % ringSegments) * tubeSegments + (tube % tubeSegments) + 1;
    for (let ring = 0; ring < ringSegments; ring++) {
      const ringAngle = 2.0 * Math.PI * ring / ringSegments;
      for (let tube = 0; tube < tubeSegments; tube++) {
        const tubeAngle = 2.0 * Math.PI * tube / tubeSegments;
        const radius = majorRadius + Math.cos(tubeAngle) * tubeRadius;
        vertices.push([
          Math.cos(ringAngle) * radius,
          Math.sin(tubeAngle) * tubeRadius,
          Math.sin(ringAngle) * radius
        ]);
      }
    }
    for (let ring = 0; ring < ringSegments; ring++) {
      for (let tube = 0; tube < tubeSegments; tube++) {
        faces.push([
          vertexId(ring, tube),
          vertexId(ring, tube + 1),
          vertexId(ring + 1, tube + 1),
          vertexId(ring + 1, tube)
        ]);
      }
    }
    return { name: "Torus", vertices, faces };
  }
  if (normalized === "cylinder" || normalized === "cone" || normalized === "double-cone") {
    const vertices = [];
    const faces = [];
    const bottomCenterId = 1;
    const topCenterId = 2;
    vertices.push([0.0, -1.0, 0.0]);
    vertices.push([0.0, 1.0, 0.0]);
    for (let i = 0; i < segments; i++) {
      const angle = 2.0 * Math.PI * i / segments;
      vertices.push([Math.cos(angle), -1.0, Math.sin(angle)]);
    }
    if (normalized === "cylinder") {
      for (let i = 0; i < segments; i++) {
        const angle = 2.0 * Math.PI * i / segments;
        vertices.push([Math.cos(angle), 1.0, Math.sin(angle)]);
      }
    } else if (normalized === "double-cone") {
      vertices[0] = [0.0, -1.0, 0.0];
      vertices[1] = [0.0, 1.0, 0.0];
      for (let i = 0; i < segments; i++) {
        const angle = 2.0 * Math.PI * i / segments;
        vertices[i + 2] = [Math.cos(angle), 0.0, Math.sin(angle)];
      }
    }
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const bottomA = 3 + i;
      const bottomB = 3 + next;
      if (normalized === "cone") {
        // cone は bottom ring と apex で三角面を作るため、bottom cap と side の向きを別々に決める
        // bottom cap は下向き、side は斜面外側を向くよう、ring edge と apex の順序を明示する
        faces.push([bottomCenterId, bottomA, bottomB]);
        faces.push([bottomA, topCenterId, bottomB]);
      } else if (normalized === "double-cone") {
        // double cone は上下の apex を共有 ring へ接続するため、上下とも外側法線になる順序を明示する
        faces.push([bottomA, bottomB, bottomCenterId]);
        faces.push([bottomA, topCenterId, bottomB]);
      } else {
        const topA = 3 + segments + i;
        const topB = 3 + segments + next;
        faces.push([bottomCenterId, bottomA, bottomB]);
        faces.push([bottomA, topA, topB, bottomB]);
        faces.push([topCenterId, topB, topA]);
      }
    }
    return {
      name: normalized === "cone"
        ? "Cone"
        : normalized === "double-cone"
          ? "DoubleCone"
          : "Cylinder",
      vertices,
      faces
    };
  }
  throw new Error(`unknown primitive kind: ${kind}`);
}

// primitive geometry を scene object へ変換する
// ObjectModeController は操作手順を担当し、この helper は頂点 / face 配列の検証と object 生成だけを担当する
export function buildPrimitiveObject(kind, objectId, options = {}) {
  const geometry = makePrimitiveGeometry(kind, options);
  const vertices = geometry.vertices.map((position, index) => ({
    id: index + 1,
    position: readVec3(position, `${geometry.name} vertex ${index + 1}`)
  }));
  const faces = geometry.faces.map((indices, index) => ({
    id: index + 1,
    indices: [...indices]
  }));
  return {
    id: objectId,
    name: geometry.name,
    origin: [0.0, 0.0, 0.0],
    rotation: [0.0, 0.0, 0.0, 1.0],
    scale: 1.0,
    vertices,
    faces,
    nextVertexId: vertices.length + 1,
    nextFaceId: faces.length + 1
  };
}
