// ---------------------------------------------
// samples/maze/WalkCollisionBuilder.js  2026/07/07
//   Build walk-through collision segments from runtime shapes
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import CollisionWorld, { CollisionSegment, DEFAULT_GRID_CELL_SIZE } from "./CollisionWorld.js";

const DEFAULT_VERTICAL_NORMAL_Y_MAX = 0.35;
const MIN_EDGE_LENGTH = 0.02;
const COLLISION_PARTS = new Set(["wall", "pillar", "column", "fence"]);
const NON_COLLISION_PARTS = new Set(["floor", "roof", "ceiling", "cap-floor", "cap-roof"]);

// 三角形の面法線を計算する
// 法線のY成分を見れば、床や天井のような水平面と、壁や柱のような垂直面を分けられる
function triangleNormal(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  return length > 0.0 ? [nx / length, ny / length, nz / length] : [0.0, 1.0, 0.0];
}

// XZ平面へ投影した辺の長さを返す
// 衝突は水平移動だけを扱うため、Y方向の長さではなく歩行平面上の長さを基準にする
function edgeLength2d(a, b) {
  return Math.hypot(b[0] - a[0], b[2] - a[2]);
}

// Shapeのローカル頂点をワールド座標へ変換する
// ownerNodeがないShapeも扱えるよう、worldMatrixがない場合はローカル座標をそのまま使う
function toWorldPoint(shape, vertexIndex, worldMatrix) {
  const src = shape.positionArray;
  const base = vertexIndex * 3;
  const point = [src[base], src[base + 1], src[base + 2], 1.0];
  if (!worldMatrix || typeof worldMatrix.mulVector !== "function") {
    return [point[0], point[1], point[2]];
  }
  const transformed = worldMatrix.mulVector(point);
  return [transformed[0], transformed[1], transformed[2]];
}

// Shapeが所属するNodeのworldMatrixを取得する
// 衝突線分は表示後の実座標で使うため、Node階層の移動・回転・拡大縮小を反映してから抽出する
function getWorldMatrix(shape) {
  const node = shape.ownerNode;
  if (!node) {
    return null;
  }
  if (typeof node.setWorldMatrix === "function") {
    node.setWorldMatrix();
  }
  return node.worldMatrix ?? null;
}

// オブジェクト名から階数と部品種別を読み取る
// 1F_3rd_WALL_001 のような命名を前提に、名前が十分な場合は座標推定より名前分類を優先する
export function parseCollisionName(name = "") {
  const lower = String(name).toLowerCase();
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const floorToken = tokens.find((token) => /^[123]f$/.test(token));
  const partToken = tokens.find((token) => COLLISION_PARTS.has(token) || NON_COLLISION_PARTS.has(token));

  return {
    floor: floorToken ?? null,
    part: partToken ?? null
  };
}

// part文字列が衝突対象の壁・柱・塀系カテゴリを含むかを判定する
// OUTER_FENCE のような複合名でも token 単位で拾えるようにしている
export function isCollisionPart(part) {
  const lower = String(part ?? "").toLowerCase();
  if (COLLISION_PARTS.has(lower)) {
    return true;
  }
  return lower.split(/[^a-z0-9]+/).some((token) => COLLISION_PARTS.has(token));
}

// Shapeを衝突線分化する対象に含めるかを判定する
// 床や天井は水平移動の初期実装では対象外にし、壁・柱・塀だけを候補にする
export function shouldUseCollisionShape(shape, meta) {
  const parsed = parseCollisionName(shape?.getName?.() ?? shape?.name ?? "");
  const part = String(meta?.part ?? parsed.part ?? "").toLowerCase();
  if (NON_COLLISION_PARTS.has(part)) {
    return false;
  }
  return isCollisionPart(part) || part === "" || part === "misc";
}

// runtime.shapes から現在条件に合う衝突用 CollisionWorld を構築する
// 呼び出し側が階数・工場表示のfilterを渡し、この関数は垂直三角形の抽出と線分登録に専念する
export function buildCollisionWorldFromRuntime(runtime, options = {}) {
  const shapes = runtime?.shapes ?? [];
  const world = new CollisionWorld({ cellSize: options.cellSize ?? DEFAULT_GRID_CELL_SIZE });
  const classifyShape = options.classifyShape ?? (() => ({}));
  const filterShape = options.filterShape ?? (() => true);
  const verticalNormalYMax = options.verticalNormalYMax ?? DEFAULT_VERTICAL_NORMAL_Y_MAX;
  const stats = {
    floorId: options.floorId ?? null,
    factoryPreset: options.factoryPreset ?? null,
    shapeCount: shapes.length,
    usedShapeCount: 0,
    triangleCount: 0,
    verticalTriangleCount: 0,
    segmentCount: 0,
    gridCellCount: 0
  };

  for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
    const shape = shapes[shapeIndex];
    if (!shape?.positionArray || !shape?.indicesArray) {
      continue;
    }

    const meta = classifyShape(shape) ?? {};
    if (!filterShape(shape, meta) || !shouldUseCollisionShape(shape, meta)) {
      continue;
    }

    const worldMatrix = getWorldMatrix(shape);
    const indices = shape.indicesArray;
    let usedShape = false;

    // 三角形を1枚ずつワールド座標へ変換し、垂直面だけをXZ線分へ分解する
    // 初期実装では三角形の全辺を登録し、内部辺や重複辺の削減は後段の改善余地として残す
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = toWorldPoint(shape, indices[i], worldMatrix);
      const b = toWorldPoint(shape, indices[i + 1], worldMatrix);
      const c = toWorldPoint(shape, indices[i + 2], worldMatrix);
      const normal = triangleNormal(a, b, c);
      stats.triangleCount++;

      if (Math.abs(normal[1]) > verticalNormalYMax) {
        continue;
      }

      stats.verticalTriangleCount++;
      const minY = Math.min(a[1], b[1], c[1]);
      const maxY = Math.max(a[1], b[1], c[1]);
      const edges = [[a, b], [b, c], [c, a]];

      for (const [p0, p1] of edges) {
        if (edgeLength2d(p0, p1) < MIN_EDGE_LENGTH) {
          continue;
        }
        world.addSegment(new CollisionSegment(p0[0], p0[2], p1[0], p1[2], minY, maxY, shapeIndex));
        stats.segmentCount++;
        usedShape = true;
      }
    }

    if (usedShape) {
      stats.usedShapeCount++;
    }
  }

  stats.gridCellCount = world.grid.size;
  world.stats = stats;
  return { world, stats };
}
