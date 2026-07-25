// ---------------------------------------------
// samples/mmodeler/ModelerPicking.js  2026/07/25
//   Picking calculations for the mmodeler sample.
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Matrix from "../../webg/Matrix.js";
import {
  add3,
  cross3,
  dot3,
  length3,
  mul3,
  normalize3,
  sub3
} from "./math3d.js";

// `cssToNdc`は座標または数値を計算し、後続処理で使う結果を返す
export function cssToNdc(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
  const y = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;
  return [x, y];
}

// `intersectRayPlane`は入力条件や交差状態を比較し、判定結果を返す
export function intersectRayPlane(ray, point, normal) {
  const n = normalize3(normal, "plane normal");
  const denom = dot3(ray.dir, n);
  if (Math.abs(denom) < 1.0e-8) {
    return null;
  }
  const t = dot3(sub3(point, ray.origin), n) / denom;
  if (!Number.isFinite(t)) {
    throw new Error(`ray-plane intersection produced invalid t: ${t}`);
  }
  return add3(ray.origin, mul3(ray.dir, t));
}

// `intersectRayTriangle`は入力条件や交差状態を比較し、判定結果を返す
export function intersectRayTriangle(ray, p0, p1, p2) {
  const eps = 1.0e-8;
  const edge1 = sub3(p1, p0);
  const edge2 = sub3(p2, p0);
  const h = cross3(ray.dir, edge2);
  const a = dot3(edge1, h);
  if (Math.abs(a) < eps) {
    return null;
  }
  const f = 1.0 / a;
  const s = sub3(ray.origin, p0);
  const u = f * dot3(s, h);
  if (u < 0.0 || u > 1.0) {
    return null;
  }
  const q = cross3(s, edge1);
  const v = f * dot3(ray.dir, q);
  if (v < 0.0 || u + v > 1.0) {
    return null;
  }
  const t = f * dot3(edge2, q);
  if (t <= eps) {
    return null;
  }
  return {
    t,
    point: add3(ray.origin, mul3(ray.dir, t))
  };
}

// 頂点一覧から識別子に対応する頂点を返す
export function getVertexByIdFromList(vertices, id) {
  if (!Number.isInteger(id) || id < 0 || id >= vertices.length) {
    return null;
  }
  const vertex = vertices[id];
  if (vertex.id !== id) {
    throw new Error(`dense vertex invariant broken: vertices[${id}].id is ${vertex.id}`);
  }
  return vertex;
}

// 検索表から識別子に対応する頂点を読み出す
function readVertexFromLookup(vertexLookup, vertices, id) {
  if (Array.isArray(vertexLookup)) {
    return getVertexByIdFromList(vertexLookup, id);
  }
  if (vertexLookup) {
    throw new Error("vertex lookup must be a dense vertex array");
  }
  return getVertexByIdFromList(vertices, id);
}

// 面を構成する頂点から面の法線を計算する
export function computeFaceNormalFromVertices(face, vertices, options = {}) {
  if (!face || face.indices.length < 3) {
    return null;
  }
  const vertexLookup = options.vertexLookup ?? null;
  const readVertex = (id) => readVertexFromLookup(vertexLookup, vertices, id);
  const v0 = readVertex(face.indices[0]);
  const v1 = readVertex(face.indices[1]);
  const v2 = readVertex(face.indices[2]);
  if (!v0 || !v1 || !v2) {
    throw new Error(`face ${face?.id ?? "-"} contains missing vertex for normal`);
  }
  const normal = cross3(
    sub3(v1.position, v0.position),
    sub3(v2.position, v0.position)
  );
  const len = length3(normal);
  if (!Number.isFinite(len) || len <= 1.0e-8) {
    return null;
  }
  return [normal[0] / len, normal[1] / len, normal[2] / len];
}

// `face`の`front`の`facing`の`ray`の条件を判定し、結果を真偽値で返す
export function isFaceFrontFacingRay(face, vertices, ray, options = {}) {
  const normal = computeFaceNormalFromVertices(face, vertices, options);
  if (!normal) {
    return false;
  }
  return dot3(normal, ray.dir) < -1.0e-8;
}

// 面を構成する頂点から面の中心を求める
export function getFaceCenterFromVertices(face, vertices) {
  const points = face.indices
    .map((id) => getVertexByIdFromList(vertices, id))
    .filter((vertex) => vertex !== null)
    .map((vertex) => vertex.position);
  if (points.length === 0) {
    return null;
  }
  const sum = points.reduce((acc, point) => add3(acc, point), [0.0, 0.0, 0.0]);
  return mul3(sum, 1.0 / points.length);
}

// `point`の`ray`の距離を現在の入力と状態から求め、呼び出し元へ返す
export function getPointRayDistance(ray, point) {
  const denom = dot3(ray.dir, ray.dir);
  if (!Number.isFinite(denom) || denom <= 0.0) {
    throw new Error(`point visibility requires non-zero ray direction: ${denom}`);
  }
  const t = dot3(sub3(point, ray.origin), ray.dir) / denom;
  if (!Number.isFinite(t)) {
    throw new Error(`point visibility produced invalid ray distance: ${t}`);
  }
  return t;
}

export default class ModelerPicking {
  // インスタンス生成時に、受け取った設定を検証して初期状態を準備する
  constructor(options = {}) {
    this.getCanvas = options.getCanvas;
    this.getEye = options.getEye;
    this.getProjectionMatrix = options.getProjectionMatrix;
    this.getProjectionMode = options.getProjectionMode;
    this.orthographicMode = options.orthographicMode;
    this.getObjects = options.getObjects;
    this.getActiveObject = options.getActiveObject;
    this.getRenderableEditorMode = options.getRenderableEditorMode;
    this.editModeName = options.editModeName;
    this.getRenderableEditMeshState = options.getRenderableEditMeshState;
    this.makeObjectLocalRay = options.makeObjectLocalRay;
    this.buildVertexLookup = options.buildVertexLookup;
    this.localToWorldPosition = options.localToWorldPosition;
    this.projectWorldToClient = options.projectWorldToClient;
    this.clientPointInRect = options.clientPointInRect;
    this.getCurrentViewProjectionMatrix = options.getCurrentViewProjectionMatrix;
    this.getActiveObjectBounds = options.getActiveObjectBounds;
    this.getFaceCenter = options.getFaceCenter;
    this.getVisiblePickOnly = options.getVisiblePickOnly;
    this.getObjectWireframe = options.getObjectWireframe;
    this.isMobileProfile = options.isMobileProfile === true;
    this.visiblePickGridCols = options.visiblePickGridCols ?? 48;
    this.visiblePickGridRows = options.visiblePickGridRows ?? 48;
    this.visiblePickGridPaddingPx = options.visiblePickGridPaddingPx ?? 3.0;
    this.setVisiblePickSelectionStats = options.setVisiblePickSelectionStats;
  }

  // クライアント座標から選択判定用のレイを生成する
  makeRayFromClient(clientX, clientY) {
    const eye = this.getEye();
    eye.setWorldMatrix();
    const view = new Matrix();
    view.makeView(eye.worldMatrix);
    const [nx, ny] = cssToNdc(this.getCanvas(), clientX, clientY);
    const invVp = this.getProjectionMatrix().clone();
    invVp.mul_(view);
    invVp.inverse_strict();
    const near = invVp.mulVector([nx, ny, -1.0]);
    const far = invVp.mulVector([nx, ny, 1.0]);
    const projectionMode = this.getProjectionMode();
    if (projectionMode === this.orthographicMode) {
      return {
        origin: near,
        dir: sub3(far, near),
        near,
        far,
        ndc: [nx, ny],
        client: { x: clientX, y: clientY },
        projectionMode
      };
    }
    const eyePos = eye.getWorldPosition();
    return {
      origin: eyePos,
      dir: sub3(far, eyePos),
      near,
      far,
      ndc: [nx, ny],
      client: { x: clientX, y: clientY },
      projectionMode
    };
  }

  // 同じ view / projection から多数の screen point ray を作る処理向けの共有 context を作る
  // box select の可視判定では候補 vertex ごとに ray が必要になるため、
  // ここで inverse view-projection と canvas rect を 1 回だけ計算して使い回す
  makeRayBuildContext() {
    const eye = this.getEye();
    eye.setWorldMatrix();
    const view = new Matrix();
    view.makeView(eye.worldMatrix);
    const invVp = this.getProjectionMatrix().clone();
    invVp.mul_(view);
    invVp.inverse_strict();
    const projectionMode = this.getProjectionMode();
    return {
      invVp,
      projectionMode,
      eyePosition: projectionMode === this.orthographicMode ? null : eye.getWorldPosition(),
      canvasRect: this.getCanvas().getBoundingClientRect()
    };
  }

  // makeRayBuildContext() で共有した逆行列から client 座標 ray を作る
  // makeRayFromClient() と同じ戻り値形状を保ち、visible pick の既存処理へそのまま渡せるようにする
  makeRayFromClientWithContext(clientX, clientY, context = null) {
    if (!context) {
      return this.makeRayFromClient(clientX, clientY);
    }
    const rect = context.canvasRect;
    const nx = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
    const ny = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;
    const near = context.invVp.mulVector([nx, ny, -1.0]);
    const far = context.invVp.mulVector([nx, ny, 1.0]);
    if (context.projectionMode === this.orthographicMode) {
      return {
        origin: near,
        dir: sub3(far, near),
        near,
        far,
        ndc: [nx, ny],
        client: { x: clientX, y: clientY },
        projectionMode: context.projectionMode
      };
    }
    return {
      origin: context.eyePosition,
      dir: sub3(far, context.eyePosition),
      near,
      far,
      ndc: [nx, ny],
      client: { x: clientX, y: clientY },
      projectionMode: context.projectionMode
    };
  }

  // `pickFaceInObject`は現在状態から対象を選択し、結果を返すまたは選択を切り替える
  pickFaceInObject(ray, object, options = {}) {
    const localRay = this.makeObjectLocalRay(ray, object);
    const ignoreFaceId = options.ignoreFaceId ?? null;
    const ignoreVertexId = options.ignoreVertexId ?? null;
    const faces = Array.isArray(options.faces) ? options.faces : object.faces;
    const vertices = Array.isArray(options.vertices) ? options.vertices : object.vertices;
    const vertexLookup = options.vertexLookup ?? vertices;
    let best = null;
    for (const face of faces) {
      if (face.id === ignoreFaceId || (ignoreVertexId !== null && face.indices.includes(ignoreVertexId))) {
        continue;
      }
      const verts = face.indices.map((id) => readVertexFromLookup(vertexLookup, vertices, id));
      if (verts.some((vertex) => vertex === null)) {
        throw new Error(`object ${object.id} face ${face.id} contains missing vertex`);
      }
      const triangles = face.indices.length === 3
        ? [[0, 1, 2]]
        : [[0, 1, 2], [0, 2, 3]];
      for (const tri of triangles) {
        const hit = intersectRayTriangle(
          localRay,
          verts[tri[0]].position,
          verts[tri[1]].position,
          verts[tri[2]].position
        );
        if (hit && (!best || hit.t < best.t)) {
          best = {
            ...hit,
            objectId: object.id,
            faceId: face.id
          };
        }
      }
    }
    return best;
  }

  // `pickFace`は現在状態から対象を選択し、結果を返すまたは選択を切り替える
  pickFace(ray, options = {}) {
    const object = this.getActiveObject();
    if (!object) {
      return null;
    }
    if (this.getRenderableEditorMode() !== this.editModeName) {
      return this.pickFaceInObject(ray, object, options);
    }
    const editMesh = this.getRenderableEditMeshState();
    return this.pickFaceInObject(ray, object, {
      ...options,
      faces: Array.isArray(options.faces) ? options.faces : editMesh.faces,
      vertices: editMesh.vertices
    });
  }

  pickSelectableFace(ray) {
    return this.pickFace(ray);
  }

  // `pickObjectFace`は現在状態から対象を選択し、結果を返すまたは選択を切り替える
  pickObjectFace(ray) {
    let best = null;
    for (const object of this.getObjects()) {
      const hit = this.pickFaceInObject(ray, object);
      if (hit && (!best || hit.t < best.t)) {
        best = hit;
      }
    }
    return best;
  }

  pickVertexMarker() {
    return null;
  }

  // `pickAtClientPoint`は現在状態から対象を選択し、結果を返すまたは選択を切り替える
  pickAtClientPoint(clientX, clientY, options = {}) {
    const ray = this.makeRayFromClient(clientX, clientY);
    return {
      ray,
      objectFaceHit: options.includeObjectFace ? this.pickObjectFace(ray) : null,
      activeFaceHit: options.includeActiveFace ? this.pickFace(ray, options.activeFaceOptions ?? {}) : null,
      vertexHit: options.includeVertex ? (this.pickVertexByRayDistance(ray) ?? this.pickVertexMarker(ray)) : null,
      selectableFaceHit: options.includeSelectableFace ? this.pickSelectableFace(ray) : null
    };
  }

  // 点が現在のオブジェクトに遮られているか判定する
  isPointOccludedByActiveObject(point, ray, options = {}) {
    const object = this.getActiveObject();
    if (!object) {
      return false;
    }
    const editMesh = this.getRenderableEditorMode() === this.editModeName
      ? this.getRenderableEditMeshState()
      : null;
    const defaultFaces = editMesh?.faces ?? object.faces;
    if (defaultFaces.length === 0) {
      return false;
    }
    const localRay = this.makeObjectLocalRay(ray, object);
    const candidateFaces = Array.isArray(options.faces) ? options.faces : null;
    if (candidateFaces && candidateFaces.length === 0) {
      return false;
    }
    const hit = this.pickFaceInObject(ray, object, {
      ignoreFaceId: options.ignoreFaceId ?? null,
      ignoreVertexId: options.ignoreVertexId ?? null,
      faces: candidateFaces ?? defaultFaces,
      vertices: editMesh?.vertices
    });
    if (!hit) {
      return false;
    }
    const pointT = getPointRayDistance(localRay, point);
    const rayLength = length3(localRay.dir);
    if (!Number.isFinite(rayLength) || rayLength <= 0.0) {
      throw new Error(`point occlusion requires positive ray length: ${rayLength}`);
    }
    const tolerance = Math.max(this.getActiveObjectBounds().size * 1.0e-4, 1.0e-5) / rayLength;
    return hit.t < pointT - tolerance;
  }

  // box select の 1 回の確定処理内で、編集メッシュ頂点の screen 投影結果を共有する
  // 15000 頂点級の mesh では、候補抽出後に face grid 構築で同じ頂点を面ごとに再投影すると、
  // 共有頂点が属する面数ぶんだけ projectWorldToClient() が繰り返される
  makeProjectedEditMeshContext(viewProjection) {
    const object = this.getActiveObject();
    const editMesh = this.getRenderableEditMeshState();
    const vertexLookup = editMesh.vertices;
    const projectedVerticesById = [];
    const vertexEntries = [];
    for (const vertex of editMesh.vertices) {
      const projected = object && viewProjection
        ? this.projectWorldToClient(viewProjection, this.localToWorldPosition(object, vertex.position))
        : null;
      projectedVerticesById[vertex.id] = projected;
      vertexEntries.push({
        vertex,
        projected
      });
    }
    return {
      object,
      editMesh,
      vertexLookup,
      projectedVerticesById,
      vertexEntries
    };
  }

  // `visible`の`occlusion`の`grid`を生成し、後続処理で利用できる状態にする
  makeVisibleOcclusionGrid(viewProjection, projectionContext = null) {
    if (!viewProjection) {
      return null;
    }
    const editMesh = projectionContext?.editMesh ?? this.getRenderableEditMeshState();
    const rect = this.getCanvas().getBoundingClientRect();
    const cols = this.visiblePickGridCols;
    const rows = this.visiblePickGridRows;
    const cells = Array.from({ length: cols * rows }, () => []);
    const pad = this.visiblePickGridPaddingPx;
    const object = this.getActiveObject();
    const vertexLookup = projectionContext?.vertexLookup ?? editMesh.vertices;
    const projectedVerticesById = projectionContext?.projectedVerticesById ?? null;
    let faceCount = 0;
    // 面を画面上で重なる分割領域へ登録する
    const addFaceToCells = (face, bounds) => {
      const left = Math.max(rect.left, bounds.left - pad);
      const right = Math.min(rect.right, bounds.right + pad);
      const top = Math.max(rect.top, bounds.top - pad);
      const bottom = Math.min(rect.bottom, bounds.bottom + pad);
      if (right < rect.left || left > rect.right || bottom < rect.top || top > rect.bottom) {
        return;
      }
      const col0 = Math.max(0, Math.min(cols - 1, Math.floor(((left - rect.left) / rect.width) * cols)));
      const col1 = Math.max(0, Math.min(cols - 1, Math.floor(((right - rect.left) / rect.width) * cols)));
      const row0 = Math.max(0, Math.min(rows - 1, Math.floor(((top - rect.top) / rect.height) * rows)));
      const row1 = Math.max(0, Math.min(rows - 1, Math.floor(((bottom - rect.top) / rect.height) * rows)));
      for (let row = row0; row <= row1; row++) {
        for (let col = col0; col <= col1; col++) {
          cells[row * cols + col].push(face);
        }
      }
    };
    for (const face of editMesh.faces) {
      faceCount += 1;
      const projected = face.indices
        .map((id) => readVertexFromLookup(vertexLookup, editMesh.vertices, id))
        .filter((vertex) => vertex !== null)
        .map((vertex) => projectedVerticesById
          ? (projectedVerticesById[vertex.id] ?? null)
          : this.projectWorldToClient(viewProjection, this.localToWorldPosition(object, vertex.position)))
        .filter((point) => point !== null);
      if (projected.length === 0) {
        addFaceToCells(face, {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom
        });
        continue;
      }
      if (projected.length !== face.indices.length) {
        addFaceToCells(face, {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom
        });
        continue;
      }
      const bounds = projected.reduce((acc, point) => ({
        left: Math.min(acc.left, point.x),
        right: Math.max(acc.right, point.x),
        top: Math.min(acc.top, point.y),
        bottom: Math.max(acc.bottom, point.y)
      }), {
        left: Infinity,
        right: -Infinity,
        top: Infinity,
        bottom: -Infinity
      });
      addFaceToCells(face, bounds);
    }
    let filledCellCount = 0;
    let totalCellFaces = 0;
    let maxFacesPerCell = 0;
    for (const cell of cells) {
      if (cell.length === 0) {
        continue;
      }
      filledCellCount += 1;
      totalCellFaces += cell.length;
      maxFacesPerCell = Math.max(maxFacesPerCell, cell.length);
    }
    return {
      rect,
      cols,
      rows,
      cells,
      faceCount,
      filledCellCount,
      avgFacesPerFilledCell: filledCellCount > 0 ? totalCellFaces / filledCellCount : 0.0,
      maxFacesPerCell
    };
  }

  // `visible`の`occlusion`の`faces`を現在の入力と状態から求め、呼び出し元へ返す
  getVisibleOcclusionFaces(clientPoint, context = null) {
    const grid = context?.occlusionGrid ?? null;
    if (!grid || !clientPoint) {
      return null;
    }
    const { rect, cols, rows, cells } = grid;
    if (clientPoint.x < rect.left || clientPoint.x > rect.right || clientPoint.y < rect.top || clientPoint.y > rect.bottom) {
      return [];
    }
    const col = Math.max(0, Math.min(cols - 1, Math.floor(((clientPoint.x - rect.left) / rect.width) * cols)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(((clientPoint.y - rect.top) / rect.height) * rows)));
    return cells[row * cols + col];
  }

  // `visible`の`adjacency`の実行コンテキストを生成し、後続処理で利用できる状態にする
  makeVisibleAdjacencyContext(projectionContext = null, vertexIdFilter = null) {
    const editMesh = projectionContext?.editMesh ?? this.getRenderableEditMeshState();
    const adjacentFacesByVertexId = new Map();
    const vertexLookup = projectionContext?.vertexLookup ?? editMesh.vertices;
    for (const face of editMesh.faces) {
      for (const vertexId of face.indices) {
        if (vertexIdFilter && !vertexIdFilter.has(vertexId)) {
          continue;
        }
        let faces = adjacentFacesByVertexId.get(vertexId);
        if (!faces) {
          faces = [];
          adjacentFacesByVertexId.set(vertexId, faces);
        }
        faces.push(face);
      }
    }
    return {
      adjacentFacesByVertexId,
      vertexLookup
    };
  }

  // `visible`の`pick`の実行コンテキストを生成し、後続処理で利用できる状態にする
  makeVisiblePickContext(viewProjection = null, projectionContext = null) {
    return {
      ...this.makeVisibleAdjacencyContext(projectionContext),
      occlusionGrid: this.makeVisibleOcclusionGrid(viewProjection, projectionContext)
    };
  }

  // `fast`の`face`の`visibility`の実行コンテキストを生成し、後続処理で利用できる状態にする
  makeFastFaceVisibilityContext(editMesh) {
    return {
      adjacentFacesByVertexId: null,
      vertexLookup: editMesh.vertices
    };
  }

  // 頂点の`front`の`facing`の`ray`の条件を判定し、結果を真偽値で返す
  isVertexFrontFacingRay(vertex, ray, context = null) {
    const editMesh = this.getRenderableEditMeshState();
    const adjacentFaces = context?.adjacentFacesByVertexId?.get(vertex.id)
      ?? editMesh.faces.filter((face) => face.indices.includes(vertex.id));
    if (adjacentFaces.length === 0) {
      return true;
    }
    return adjacentFaces.some((face) => isFaceFrontFacingRay(face, editMesh.vertices, ray, {
      vertexLookup: context?.vertexLookup ?? null
    }));
  }

  // 現在の視点から頂点を選択できるか判定する
  isVertexSelectableFromView(vertex, ray, context = null) {
    if (!this.getVisiblePickOnly()) {
      return true;
    }
    if (this.getObjectWireframe()) {
      return true;
    }
    const localRay = this.makeObjectLocalRay(ray, this.getActiveObject());
    if (!this.isVertexFrontFacingRay(vertex, localRay, context)) {
      return false;
    }
    const candidateFaces = this.getVisibleOcclusionFaces(ray.client, context);
    return !this.isPointOccludedByActiveObject(vertex.position, ray, {
      ignoreVertexId: vertex.id,
      faces: candidateFaces
    });
  }

  // 現在の視点から面を選択できるか判定する
  isFaceSelectableFromView(face, ray, context = null) {
    if (!this.getVisiblePickOnly()) {
      return true;
    }
    const center = this.getFaceCenter(face);
    if (!center) {
      return false;
    }
    const candidateFaces = this.getVisibleOcclusionFaces(ray.client, context);
    return !this.isPointOccludedByActiveObject(center, ray, {
      ignoreFaceId: face.id,
      faces: candidateFaces
    });
  }

  // `pickVertexByRayDistance`は座標または数値を計算し、後続処理で使う結果を返す
  pickVertexByRayDistance(ray) {
    const object = this.getActiveObject();
    const viewProjection = this.getCurrentViewProjectionMatrix();
    if (!object || !viewProjection || !ray?.client) {
      return null;
    }
    const editMesh = this.getRenderableEditMeshState();
    const candidates = [];
    let bestCandidate = null;
    let candidateCount = 0;
    const pickRadiusPx = this.isMobileProfile ? 20.0 : 12.0;
    const pickRadius2 = pickRadiusPx * pickRadiusPx;
    const maxVisibleCandidates = 64;
    for (const vertex of editMesh.vertices) {
      const projected = this.projectWorldToClient(viewProjection, this.localToWorldPosition(object, vertex.position));
      if (!projected) {
        continue;
      }
      const dx = projected.x - ray.client.x;
      const dy = projected.y - ray.client.y;
      const distance2 = dx * dx + dy * dy;
      if (distance2 > pickRadius2) {
        continue;
      }
      const candidate = {
        vertex,
        vertexId: vertex.id,
        distance: Math.sqrt(distance2),
        distance2,
        z: projected.z,
        projected
      };
      candidateCount += 1;
      if (this.getVisiblePickOnly()) {
        candidates.push(candidate);
      } else if (!bestCandidate
          || distance2 < bestCandidate.distance2
          || (distance2 === bestCandidate.distance2 && projected.z < bestCandidate.z)) {
        bestCandidate = candidate;
      }
    }
    if (!this.getVisiblePickOnly()) {
      this.setVisiblePickSelectionStats("click-vertex", candidateCount, bestCandidate ? 1 : 0);
      return bestCandidate;
    }
    if (candidates.length === 0) {
      this.setVisiblePickSelectionStats("click-vertex", 0, 0);
      return null;
    }
    candidates.sort((a, b) => (a.distance2 - b.distance2) || (a.z - b.z));
    const visibleCandidates = candidates.slice(0, maxVisibleCandidates);
    const context = this.makeVisiblePickContext(this.getCurrentViewProjectionMatrix());
    const rayContext = this.makeRayBuildContext();
    for (const candidate of visibleCandidates) {
      const candidateRay = this.makeRayFromClientWithContext(candidate.projected.x, candidate.projected.y, rayContext);
      if (this.isVertexSelectableFromView(candidate.vertex, candidateRay, context)) {
        this.setVisiblePickSelectionStats("click-vertex", candidateCount, 1, context);
        return {
          vertexId: candidate.vertexId,
          distance: candidate.distance,
          z: candidate.z
        };
      }
    }
    this.setVisiblePickSelectionStats("click-vertex", candidateCount, 0, context);
    return null;
  }

  // `objectIntersectsClientRect`は入力条件や交差状態を比較し、判定結果を返す
  objectIntersectsClientRect(object, viewProjection, rect) {
    for (const vertex of object.vertices) {
      if (this.clientPointInRect(this.projectWorldToClient(viewProjection, this.localToWorldPosition(object, vertex.position)), rect)) {
        return true;
      }
    }
    for (const face of object.faces) {
      const center = getFaceCenterFromVertices(face, object.vertices);
      if (center && this.clientPointInRect(this.projectWorldToClient(viewProjection, this.localToWorldPosition(object, center)), rect)) {
        return true;
      }
    }
    return false;
  }

  // オブジェクトの`rect`の`candidates`を現在の入力と状態から求め、呼び出し元へ返す
  collectObjectRectCandidates(rect, viewProjection) {
    const selectedIds = this.getObjects()
      .filter((object) => this.objectIntersectsClientRect(object, viewProjection, rect))
      .map((object) => object.id);
    return {
      candidateCount: selectedIds.length,
      selectedIds
    };
  }

  // 頂点の`rect`の`candidates`を現在の入力と状態から求め、呼び出し元へ返す
  collectVertexRectCandidates(rect, viewProjection) {
    const projectionContext = this.makeProjectedEditMeshContext(viewProjection);
    const entries = projectionContext.vertexEntries
      .filter((entry) => this.clientPointInRect(entry.projected, rect));
    if (!this.getVisiblePickOnly() || this.getObjectWireframe()) {
      return {
        candidateCount: entries.length,
        selectedIds: entries.map((entry) => entry.vertex.id),
        context: null,
        mode: "box-vertex"
      };
    }

    // box select では矩形の広さで可視判定アルゴリズムを変えない
    // 狭い範囲だけ exact occlusion を使うと、遮蔽候補集合の違いで選択結果と速度が不安定になる
    // vertex は接続 face の front-facing 判定だけを行い、候補数によらず同じ処理フローに揃える
    const context = this.makeVisibleAdjacencyContext(projectionContext, new Set(entries.map((entry) => entry.vertex.id)));
    const rayContext = this.makeRayBuildContext();
    const selectedIds = entries
      .filter((entry) => {
        const ray = this.makeRayFromClientWithContext(entry.projected.x, entry.projected.y, rayContext);
        const localRay = this.makeObjectLocalRay(ray, projectionContext.object);
        return this.isVertexFrontFacingRay(entry.vertex, localRay, context);
      })
      .map((entry) => entry.vertex.id);
    return {
      candidateCount: entries.length,
      selectedIds,
      context,
      mode: "box-vertex-fast"
    };
  }

  // `face`の`rect`の`candidates`を現在の入力と状態から求め、呼び出し元へ返す
  collectFaceRectCandidates(rect, viewProjection) {
    const object = this.getActiveObject();
    const editMesh = this.getRenderableEditMeshState();
    const entries = editMesh.faces
      .map((face) => {
        const center = this.getFaceCenter(face);
        const projected = center ? this.projectWorldToClient(viewProjection, this.localToWorldPosition(object, center)) : null;
        return {
          face,
          center,
          projected
        };
      })
      .filter((entry) => entry.center && this.clientPointInRect(entry.projected, rect));
    if (!this.getVisiblePickOnly() || this.getObjectWireframe()) {
      return {
        candidateCount: entries.length,
        selectedIds: entries.map((entry) => entry.face.id),
        context: null,
        mode: "box-face"
      };
    }

    // face box select も矩形の広さで可視判定アルゴリズムを変えない
    // face center が矩形内にある候補へ front-facing 判定だけを行い、狭い範囲でも広い範囲でも同じ結果規則にする
    const context = this.makeFastFaceVisibilityContext(editMesh);
    const rayContext = this.makeRayBuildContext();
    const selectedIds = entries
      .filter((entry) => {
        const ray = this.makeRayFromClientWithContext(entry.projected.x, entry.projected.y, rayContext);
        const localRay = this.makeObjectLocalRay(ray, object);
        return isFaceFrontFacingRay(entry.face, editMesh.vertices, localRay, {
          vertexLookup: context?.vertexLookup ?? null
        });
      })
      .map((entry) => entry.face.id);
    return {
      candidateCount: entries.length,
      selectedIds,
      context,
      mode: "box-face-fast"
    };
  }
}
