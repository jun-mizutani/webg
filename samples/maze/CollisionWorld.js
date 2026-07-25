// ---------------------------------------------
// samples/maze/CollisionWorld.js  2026/07/07
//   XZ-plane collision world for walk-through samples
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 歩行者を水平面上の円として扱うための標準値
// 視点高さとは別に、壁や柱と重なる高さ範囲を持つ円柱として判定する
export const DEFAULT_PLAYER_RADIUS = 0.3;
export const DEFAULT_PLAYER_HEIGHT = 1.7;
export const DEFAULT_GRID_CELL_SIZE = 2.0;
export const DEFAULT_MAX_STEP_DISTANCE = 0.15;
export const DEFAULT_MAX_RESOLVE_ITERATIONS = 4;

const EPSILON = 1.0e-6;

// 衝突判定用の線分を表す小さなデータクラス
// ax/az から bx/bz までがXZ平面上の壁線分で、minY/maxY は元三角形の高さ範囲を保持する
export class CollisionSegment {
  constructor(ax, az, bx, bz, minY, maxY, sourceId = -1) {
    this.ax = ax;
    this.az = az;
    this.bx = bx;
    this.bz = bz;
    this.minY = minY;
    this.maxY = maxY;
    this.sourceId = sourceId;
  }
}

// プレイヤー円柱の高さ範囲と、衝突線分の高さ範囲が交差しているかを判定する
// ドア上の垂れ壁や天井付近の梁を、床上の歩行者に対して不要に衝突させないために使う
export function overlapsPlayerHeight(player, segment) {
  const playerMinY = player.y;
  const playerMaxY = player.y + player.height;
  return segment.maxY >= playerMinY && segment.minY <= playerMaxY;
}

// XZ平面上の円と線分のめり込みを解決する
// player は一時オブジェクトとして直接書き換え、壁に垂直な成分だけ押し戻して壁沿い移動を残す
export function resolveCircleSegment(player, segment) {
  const vx = segment.bx - segment.ax;
  const vz = segment.bz - segment.az;
  const wx = player.x - segment.ax;
  const wz = player.z - segment.az;
  const lengthSq = vx * vx + vz * vz;
  let t = 0.0;

  if (lengthSq > EPSILON) {
    t = (wx * vx + wz * vz) / lengthSq;
    t = Math.min(1.0, Math.max(0.0, t));
  }

  const nearestX = segment.ax + vx * t;
  const nearestZ = segment.az + vz * t;
  let dx = player.x - nearestX;
  let dz = player.z - nearestZ;
  let distanceSq = dx * dx + dz * dz;
  const radius = player.radius;

  if (distanceSq >= radius * radius) {
    return false;
  }

  if (distanceSq <= EPSILON) {
    const edgeLength = Math.sqrt(lengthSq);
    if (edgeLength <= EPSILON) {
      dx = 1.0;
      dz = 0.0;
    } else {
      dx = -vz / edgeLength;
      dz = vx / edgeLength;
    }
    distanceSq = 1.0;
  }

  const distance = Math.sqrt(distanceSq);
  const push = radius - distance + EPSILON;
  player.x += (dx / distance) * push;
  player.z += (dz / distance) * push;
  return true;
}

// 歩行用の衝突線分をUniform Gridへ登録し、移動中に近傍線分だけを検索する
// 建物全体を毎フレーム総当たりしないため、線分のAABBが重なるセルへindexを登録しておく
export default class CollisionWorld {
  // セルサイズと診断用カウンタを初期化する
  // 診断値はHUDやgetStateから確認でき、衝突判定が効いているかをその場で追跡できる
  constructor(options = {}) {
    this.cellSize = options.cellSize ?? DEFAULT_GRID_CELL_SIZE;
    this.segments = [];
    this.grid = new Map();
    this.lastCandidateCount = 0;
    this.lastHitCount = 0;
    this.lastIterations = 0;
    this.lastSubStepCount = 0;
  }

  // 登録済み線分とgrid、直近診断値をすべて空に戻す
  // フロアや工場表示が切り替わったときは新しい条件でworldを作り直す
  clear() {
    this.segments.length = 0;
    this.grid.clear();
    this.lastCandidateCount = 0;
    this.lastHitCount = 0;
    this.lastIterations = 0;
    this.lastSubStepCount = 0;
  }

  // 線分を配列へ追加し、検索用gridにも同時に登録する
  // segment object は描画用meshとは独立しており、衝突判定に必要な最小情報だけを持つ
  addSegment(segment) {
    const index = this.segments.length;
    this.segments.push(segment);
    this.registerSegment(index, segment);
  }

  // 線分のAABBが重なる全セルへ同じsegment indexを入れる
  // 長い塀や斜め壁でも取りこぼさないよう、初期実装ではDDAではなくAABB登録を使う
  registerSegment(index, segment) {
    const minX = Math.min(segment.ax, segment.bx);
    const maxX = Math.max(segment.ax, segment.bx);
    const minZ = Math.min(segment.az, segment.bz);
    const maxZ = Math.max(segment.az, segment.bz);
    const minCellX = this.toCell(minX);
    const maxCellX = this.toCell(maxX);
    const minCellZ = this.toCell(minZ);
    const maxCellZ = this.toCell(maxZ);

    for (let cz = minCellZ; cz <= maxCellZ; cz++) {
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        const key = this.cellKey(cx, cz);
        let bucket = this.grid.get(key);
        if (!bucket) {
          bucket = [];
          this.grid.set(key, bucket);
        }
        bucket.push(index);
      }
    }
  }

  // 移動前後の円が通過し得るAABBを作り、その範囲にある線分候補を取り出す
  // 高速移動時に移動先だけを見ると薄い壁を抜ける可能性があるため、移動前後をまとめて検索する
  querySegmentsByMoveAABB(oldX, oldZ, newX, newZ, radius, out = []) {
    const minX = Math.min(oldX, newX) - radius;
    const maxX = Math.max(oldX, newX) + radius;
    const minZ = Math.min(oldZ, newZ) - radius;
    const maxZ = Math.max(oldZ, newZ) + radius;
    return this.querySegmentsByAABB(minX, minZ, maxX, maxZ, out);
  }

  // 指定AABBが重なるgrid cellを走査し、重複を除いた線分候補をoutへ入れる
  // out配列を呼び出し側から渡せるようにして、毎回の一時配列生成を抑える
  querySegmentsByAABB(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const seen = new Set();
    const minCellX = this.toCell(minX);
    const maxCellX = this.toCell(maxX);
    const minCellZ = this.toCell(minZ);
    const maxCellZ = this.toCell(maxZ);

    for (let cz = minCellZ; cz <= maxCellZ; cz++) {
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        const bucket = this.grid.get(this.cellKey(cx, cz));
        if (!bucket) {
          continue;
        }
        for (const index of bucket) {
          if (seen.has(index)) {
            continue;
          }
          seen.add(index);
          out.push(this.segments[index]);
        }
      }
    }

    return out;
  }

  // 指定された水平移動量を、複数の小ステップに分けて衝突解決しながら適用する
  // 各stepで押し戻しを数回反復し、角や複数壁に同時に触れた場合でも安定して外へ戻す
  resolvePlayerMove(player, dx, dz, options = {}) {
    const maxStepDistance = options.maxStepDistance ?? DEFAULT_MAX_STEP_DISTANCE;
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_RESOLVE_ITERATIONS;
    const distance = Math.hypot(dx, dz);
    const subStepCount = Math.max(1, Math.ceil(distance / maxStepDistance));
    const stepX = dx / subStepCount;
    const stepZ = dz / subStepCount;
    const candidates = [];

    this.lastCandidateCount = 0;
    this.lastHitCount = 0;
    this.lastIterations = 0;
    this.lastSubStepCount = subStepCount;

    for (let subStep = 0; subStep < subStepCount; subStep++) {
      const oldX = player.x;
      const oldZ = player.z;
      player.x += stepX;
      player.z += stepZ;
      this.querySegmentsByMoveAABB(oldX, oldZ, player.x, player.z, player.radius, candidates);
      this.lastCandidateCount += candidates.length;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        let resolved = false;
        for (const segment of candidates) {
          if (!overlapsPlayerHeight(player, segment)) {
            continue;
          }
          if (resolveCircleSegment(player, segment)) {
            this.lastHitCount++;
            resolved = true;
          }
        }
        this.lastIterations++;
        if (!resolved) {
          break;
        }
      }
    }

    return {
      subStepCount: this.lastSubStepCount,
      candidateCount: this.lastCandidateCount,
      hitCount: this.lastHitCount,
      iterations: this.lastIterations
    };
  }

  // ワールド座標をgridの整数セル座標へ変換する
  // Math.floor を使うことで負の座標側でもセル境界を一貫して扱える
  toCell(value) {
    return Math.floor(value / this.cellSize);
  }

  // Mapのkeyとして使うため、2次元セル座標を短い文字列へ変換する
  // 衝突判定はCPU側の少数検索なので、初期実装では可読性の高い文字列keyを使う
  cellKey(x, z) {
    return `${x},${z}`;
  }
}
