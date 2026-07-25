// ---------------------------------------------
// samples/mmodeler/SculptModeController.js  2026/07/25
//   sculpt mode controller for mmodeler
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import { add3, cross3, dot3, length3, mul3, normalize3, sub3 } from "./math3d.js";

const DEFAULT_BRUSH_RADIUS = 0.1;
const DEFAULT_BRUSH_STRENGTH = 0.25;
const DEFAULT_BRUSH_TYPE = "draw";
const DEFAULT_FALLOFF_TYPE = "sphere";
const DRAW_AMOUNT_SCALE = 0.25;
const GRAB_AMOUNT_SCALE = 0.35;
const SMOOTH_AMOUNT_SCALE = 0.35;
const PINCH_AMOUNT_SCALE = 0.35;
const EPSILON = 1.0e-9;

function optionalFunction(value, fallback) {
  return typeof value === "function" ? value : fallback;
}

// `cloneVertices`は元データから独立して利用できる複製または実行状態を作る
function cloneVertices(vertices) {
  return vertices.map((vertex, index) => ({
    id: index,
    position: [...vertex.position]
  }));
}

// `positive`の`number`を読み込み、検証済みのデータとして後続処理へ渡す
function readPositiveNumber(value, fallback, label) {
  const num = Number(value ?? fallback);
  if (!Number.isFinite(num) || num <= 0.0) {
    throw new Error(`${label} must be a positive finite number`);
  }
  return num;
}

// `finite`の`number`を読み込み、検証済みのデータとして後続処理へ渡す
function readFiniteNumber(value, fallback, label) {
  const num = Number(value ?? fallback);
  if (!Number.isFinite(num)) {
    throw new Error(`${label} must be a finite number`);
  }
  return num;
}

// `safeNormalize3`は座標または数値を計算し、後続処理で使う結果を返す
function safeNormalize3(value, fallback) {
  const x = Number(value?.[0] ?? 0.0);
  const y = Number(value?.[1] ?? 0.0);
  const z = Number(value?.[2] ?? 0.0);
  const len = Math.hypot(x, y, z);
  if (Number.isFinite(len) && len > EPSILON) {
    return [x / len, y / len, z / len];
  }
  const fx = Number(fallback?.[0] ?? 0.0);
  const fy = Number(fallback?.[1] ?? 0.0);
  const fz = Number(fallback?.[2] ?? 0.0);
  const fallbackLen = Math.hypot(fx, fy, fz);
  if (!Number.isFinite(fallbackLen) || fallbackLen <= EPSILON) {
    throw new Error("fallback normal has zero length");
  }
  return [fx / fallbackLen, fy / fallbackLen, fz / fallbackLen];
}

// `safeNormalize2`は座標または数値を計算し、後続処理で使う結果を返す
function safeNormalize2(value, fallback = [1.0, 0.0]) {
  const x = Number(value?.[0] ?? 0.0);
  const y = Number(value?.[1] ?? 0.0);
  const len = Math.hypot(x, y);
  if (!Number.isFinite(len) || len <= EPSILON) {
    return [...fallback];
  }
  return [x / len, y / len];
}

function mirrorX3(value) {
  return [-value[0], value[1], value[2]];
}

// `mirrorViewBasisX`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
function mirrorViewBasisX(basis) {
  if (!basis) {
    return null;
  }
  return {
    right: mirrorX3(basis.right ?? [1.0, 0.0, 0.0]),
    up: mirrorX3(basis.up ?? [0.0, 1.0, 0.0]),
    forward: mirrorX3(basis.forward ?? [0.0, 0.0, -1.0])
  };
}

// `falloff`を入力値から計算し、後続処理で使える結果を返す
function computeFalloff(distance, radius, type) {
  if (distance > radius) {
    return 0.0;
  }
  const normalizedDistance = Math.max(0.0, Math.min(1.0, distance / radius));
  const t = 1.0 - normalizedDistance;
  if (type === "flat" || type === "constant") {
    return 1.0;
  }
  if (type === "triangle" || type === "linear") {
    return t;
  }
  if (type === "peak") {
    return t * t;
  }
  return Math.sqrt(Math.max(0.0, 1.0 - normalizedDistance * normalizedDistance));
}

// `brush`の`type`を検証し、後続処理が扱える共通形式へ整える
function normalizeBrushType(type) {
  const value = String(type ?? DEFAULT_BRUSH_TYPE).toLowerCase();
  if (value === "inflate" || value === "draw") {
    return "draw";
  }
  if (value === "smooth" || value === "blur") {
    return "blur";
  }
  if (value === "grab") {
    return "grab";
  }
  if (value === "pinch") {
    return "pinch";
  }
  return DEFAULT_BRUSH_TYPE;
}

// `falloff`の`type`を検証し、後続処理が扱える共通形式へ整える
function normalizeFalloffType(type) {
  const value = String(type ?? DEFAULT_FALLOFF_TYPE).toLowerCase();
  if (value === "constant") return "flat";
  if (value === "linear") return "triangle";
  if (value === "smooth") return "sphere";
  if (value === "flat" || value === "triangle" || value === "peak" || value === "sphere") {
    return value;
  }
  return DEFAULT_FALLOFF_TYPE;
}

// `adjacency`を生成し、後続処理で利用できる状態にする
function makeAdjacency(vertices, faces) {
  const adjacency = vertices.map(() => new Set());
  for (const face of faces) {
    const indices = face.indices ?? [];
    for (let i = 0; i < indices.length; i += 1) {
      const a = indices[i];
      const b = indices[(i + 1) % indices.length];
      if (Number.isInteger(a) && Number.isInteger(b) && adjacency[a] && adjacency[b]) {
        adjacency[a].add(b);
        adjacency[b].add(a);
      }
    }
  }
  return adjacency;
}

// `face`の法線を入力値から計算し、後続処理で使える結果を返す
function computeFaceNormal(face, vertices) {
  const indices = face.indices ?? [];
  if (indices.length < 3) {
    return null;
  }
  const a = vertices[indices[0]]?.position;
  for (let i = 1; i + 1 < indices.length; i += 1) {
    const b = vertices[indices[i]]?.position;
    const c = vertices[indices[i + 1]]?.position;
    if (!a || !b || !c) {
      continue;
    }
    const normal = cross3(sub3(b, a), sub3(c, a));
    if (length3(normal) > EPSILON) {
      return normalize3(normal);
    }
  }
  return null;
}

// 頂点の`normals`を入力値から計算し、後続処理で使える結果を返す
function computeVertexNormals(vertices, faces, fallbackNormal) {
  const sums = vertices.map(() => [0.0, 0.0, 0.0]);
  for (const face of faces) {
    const normal = computeFaceNormal(face, vertices);
    if (!normal) {
      continue;
    }
    for (const id of face.indices ?? []) {
      const sum = sums[id];
      if (sum) {
        sum[0] += normal[0];
        sum[1] += normal[1];
        sum[2] += normal[2];
      }
    }
  }
  return vertices.map((vertex) => safeNormalize3(sums[vertex.id], fallbackNormal));
}

// `neighbor`の`averages`を入力値から計算し、後続処理で使える結果を返す
function computeNeighborAverages(vertices, adjacency) {
  const averages = [];
  for (const vertex of vertices) {
    const neighbors = Array.from(adjacency[vertex.id] ?? [])
      .map((id) => vertices[id])
      .filter(Boolean);
    if (neighbors.length === 0) {
      averages[vertex.id] = [...vertex.position];
      continue;
    }
    const sum = neighbors.reduce((acc, neighbor) => add3(acc, neighbor.position), [0.0, 0.0, 0.0]);
    averages[vertex.id] = mul3(sum, 1.0 / neighbors.length);
  }
  return averages;
}

// `vertices`の`within`の半径を現在の入力と状態から求め、呼び出し元へ返す
function collectVerticesWithinRadius(vertices, center, radius) {
  const ids = new Set();
  for (const vertex of vertices ?? []) {
    if (length3(sub3(vertex.position, center)) <= radius) {
      ids.add(vertex.id);
    }
  }
  return ids;
}

// 頂点の`falloffs`の`within`の半径を現在の入力と状態から求め、呼び出し元へ返す
function collectVertexFalloffsWithinRadius(vertices, center, radius, falloffType) {
  const result = new Map();
  for (const vertex of vertices ?? []) {
    const falloff = computeFalloff(length3(sub3(vertex.position, center)), radius, falloffType);
    if (falloff > 0.0) {
      result.set(vertex.id, falloff);
    }
  }
  return result;
}

// Sculpt Mode の brush state と stroke 中の頂点変形を扱う
// mmodeler への入力接続や overlay 描画は main.js / renderer 側の責務として残す
export default class SculptModeController {
  constructor({
    scene = null,
    sculptModeName = "sculpt",
    setMessage = null,
    rebuildScene = null,
    markDirty = null
  } = {}) {
    this.scene = scene;
    this.sculptModeName = sculptModeName;
    this.setMessage = optionalFunction(setMessage, () => {});
    this.rebuildScene = optionalFunction(rebuildScene, () => {});
    this.markDirty = optionalFunction(markDirty, () => {
      this.scene?.markDirty?.();
    });
    this.brushRadius = DEFAULT_BRUSH_RADIUS;
    this.brushStrength = DEFAULT_BRUSH_STRENGTH;
    this.brushType = DEFAULT_BRUSH_TYPE;
    this.falloffType = DEFAULT_FALLOFF_TYPE;
    this.cursorHit = null;
    this.strokeSession = null;
  }

  // `brush`の設定値を受け取り、現在の設定と後続処理へ反映する
  setBrushOptions(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "radius")) {
      this.brushRadius = readPositiveNumber(options.radius, this.brushRadius, "brush radius");
    }
    if (Object.prototype.hasOwnProperty.call(options, "strength")) {
      this.brushStrength = readFiniteNumber(options.strength, this.brushStrength, "brush strength");
    }
    if (Object.prototype.hasOwnProperty.call(options, "type")) {
      this.brushType = normalizeBrushType(options.type);
    }
    if (Object.prototype.hasOwnProperty.call(options, "falloff")) {
      this.falloffType = normalizeFalloffType(options.falloff);
    }
  }

  // `brush`の設定値を現在の入力と状態から求め、呼び出し元へ返す
  getBrushOptions() {
    return {
      radius: this.brushRadius,
      strength: this.brushStrength,
      type: this.brushType,
      falloff: this.falloffType
    };
  }

  getActiveObject(options = {}) {
    return options.object ?? this.scene?.getActiveObject?.() ?? null;
  }

  hasActiveStroke() {
    return this.strokeSession !== null;
  }

  // `stroke`の`snapshot`を生成し、後続処理で利用できる状態にする
  makeStrokeSnapshot(object) {
    return {
      objectId: object.id,
      vertices: cloneVertices(object.vertices ?? [])
    };
  }

  // `restoreStrokeSnapshot`は入力に従って位置または姿勢を更新し、表示状態へ反映する
  restoreStrokeSnapshot(session = this.strokeSession) {
    if (!session?.object || !session.snapshot) {
      return false;
    }
    session.object.vertices = cloneVertices(session.snapshot.vertices);
    return true;
  }

  // `beginStroke`は処理周期の開始または終了に必要な状態を更新する
  beginStroke(options = {}) {
    const object = this.getActiveObject(options);
    if (!object) {
      this.setMessage("sculpt needs an active object");
      return false;
    }
    if (!Array.isArray(object.vertices) || object.vertices.length === 0) {
      this.setMessage("sculpt needs vertices");
      return false;
    }
    const center = options.center ?? options.position;
    if (!Array.isArray(center) || center.length < 3) {
      this.setMessage("sculpt needs a cursor position");
      return false;
    }
    const normal = safeNormalize3(options.normal ?? [0.0, 0.0, 1.0], [0.0, 0.0, 1.0]);
    const radius = readPositiveNumber(options.radius, this.brushRadius, "brush radius");
    const brushType = normalizeBrushType(options.type ?? this.brushType);
    const falloffType = normalizeFalloffType(options.falloff ?? this.falloffType);
    const grabVertexIds = brushType === "grab"
      ? collectVerticesWithinRadius(object.vertices ?? [], center, radius)
      : null;
    const grabFalloffByVertex = brushType === "grab"
      ? collectVertexFalloffsWithinRadius(object.vertices ?? [], center, radius, falloffType)
      : null;
    const mirrorCenter = mirrorX3(center);
    const grabMirrorVertexIds = brushType === "grab" && options.xMirror === true && Math.abs(center[0]) > 1.0e-6
      ? collectVerticesWithinRadius(object.vertices ?? [], mirrorCenter, radius)
      : null;
    const grabMirrorFalloffByVertex = brushType === "grab" && options.xMirror === true && Math.abs(center[0]) > 1.0e-6
      ? collectVertexFalloffsWithinRadius(object.vertices ?? [], mirrorCenter, radius, falloffType)
      : null;
    this.cursorHit = {
      center: [...center],
      normal,
      hit: options.hit !== false,
      screenCenter: options.screenCenter ?? this.cursorHit?.screenCenter ?? null
    };
    this.strokeSession = {
      object,
      snapshot: this.makeStrokeSnapshot(object),
      changedVertexIds: new Set(),
      lastCenter: [...center],
      lastNormal: normal,
      lastScreenCenter: Array.isArray(options.screenCenter) ? [...options.screenCenter] : null,
      lastViewBasis: options.viewBasis ?? null,
      grabCenter: brushType === "grab" ? [...center] : null,
      grabNormal: brushType === "grab" ? [...normal] : null,
      grabViewBasis: brushType === "grab" ? (options.viewBasis ?? null) : null,
      grabScreenToWorldScale: null,
      grabVertexIds,
      grabMirrorVertexIds,
      grabFalloffByVertex,
      grabMirrorFalloffByVertex
    };
    const changed = this.applyStrokeSample({
      ...options,
      object,
      center,
      normal
    });
    this.setMessage(changed ? "sculpt stroke started" : "sculpt brush found no vertices");
    return true;
  }

  // `stroke`の`sample`を対象の状態または描画設定へ反映する
  applyStrokeSample(options = {}) {
    const session = this.strokeSession;
    const object = options.object ?? session?.object ?? this.getActiveObject(options);
    if (!object || !Array.isArray(object.vertices)) {
      return false;
    }
    const center = options.center ?? options.position ?? session?.lastCenter;
    if (!Array.isArray(center) || center.length < 3) {
      return false;
    }
    const normal = safeNormalize3(options.normal ?? session?.lastNormal ?? [0.0, 0.0, 1.0], [0.0, 0.0, 1.0]);
    const radius = readPositiveNumber(options.radius, this.brushRadius, "brush radius");
    const strength = readFiniteNumber(options.strength, this.brushStrength, "brush strength");
    const brushType = normalizeBrushType(options.type ?? this.brushType);
    const falloffType = normalizeFalloffType(options.falloff ?? this.falloffType);
    const strokeDelta = session?.lastCenter
      ? sub3(center, session.lastCenter)
      : [0.0, 0.0, 0.0];
    const screenDelta = session?.lastScreenCenter && Array.isArray(options.screenCenter)
      ? [
          Number(options.screenCenter[0] ?? 0.0) - Number(session.lastScreenCenter[0] ?? 0.0),
          Number(options.screenCenter[1] ?? 0.0) - Number(session.lastScreenCenter[1] ?? 0.0)
        ]
      : [0.0, 0.0];
    const screenDeltaLength = Math.hypot(screenDelta[0], screenDelta[1]);
    let grabDistance = strokeDelta ? length3(strokeDelta) : 0.0;
    if (brushType === "grab" && session) {
      if (grabDistance > EPSILON && screenDeltaLength > EPSILON) {
        session.grabScreenToWorldScale = grabDistance / screenDeltaLength;
      } else if (screenDeltaLength > EPSILON && Number.isFinite(session.grabScreenToWorldScale) && session.grabScreenToWorldScale > EPSILON) {
        grabDistance = screenDeltaLength * session.grabScreenToWorldScale;
      }
    }
    const changedIds = this.applyBrush({
      object,
      center: brushType === "grab" ? (session?.grabCenter ?? center) : center,
      normal: brushType === "grab" ? (session?.grabNormal ?? normal) : normal,
      radius,
      strength,
      brushType,
      falloffType,
      strokeDelta,
      screenDelta,
      movementDistanceOverride: brushType === "grab" ? grabDistance : null,
      viewBasis: brushType === "grab"
        ? (session?.grabViewBasis ?? options.viewBasis ?? session?.lastViewBasis ?? null)
        : (options.viewBasis ?? session?.lastViewBasis ?? null),
      affectedVertexIds: brushType === "grab" ? (session?.grabVertexIds ?? null) : null,
      fixedFalloffByVertex: brushType === "grab" ? (session?.grabFalloffByVertex ?? null) : null
    });
    if (options.xMirror === true && Math.abs(center[0]) > 1.0e-6) {
      for (const id of this.applyBrush({
        object,
        center: brushType === "grab"
          ? mirrorX3(session?.grabCenter ?? center)
          : mirrorX3(center),
        normal: brushType === "grab"
          ? mirrorX3(session?.grabNormal ?? normal)
          : mirrorX3(normal),
        radius,
        strength,
        brushType,
        falloffType,
        strokeDelta: mirrorX3(strokeDelta),
        screenDelta,
        movementDistanceOverride: brushType === "grab" ? grabDistance : null,
        viewBasis: brushType === "grab"
          ? mirrorViewBasisX(session?.grabViewBasis ?? options.viewBasis ?? session?.lastViewBasis ?? null)
          : (options.viewBasis ?? session?.lastViewBasis ?? null),
        affectedVertexIds: brushType === "grab" ? (session?.grabMirrorVertexIds ?? null) : null,
        fixedFalloffByVertex: brushType === "grab" ? (session?.grabMirrorFalloffByVertex ?? null) : null
      })) {
        if (!changedIds.includes(id)) {
          changedIds.push(id);
        }
      }
    }
    if (session) {
      session.lastCenter = [...center];
      session.lastNormal = normal;
      session.lastScreenCenter = Array.isArray(options.screenCenter) ? [...options.screenCenter] : session.lastScreenCenter;
      session.lastViewBasis = options.viewBasis ?? session.lastViewBasis;
      for (const id of changedIds) {
        session.changedVertexIds.add(id);
      }
    }
    this.cursorHit = {
      center: [...center],
      normal,
      hit: changedIds.length > 0,
      screenCenter: options.screenCenter ?? this.cursorHit?.screenCenter ?? null
    };
    if (changedIds.length > 0) {
      this.markDirty();
      this.rebuildScene();
    }
    return changedIds.length > 0;
  }

  // `brush`を対象の状態または描画設定へ反映する
  applyBrush({
    object,
    center,
    normal,
    radius,
    strength,
    brushType,
    falloffType,
    strokeDelta = [0.0, 0.0, 0.0],
    screenDelta = [0.0, 0.0],
    movementDistanceOverride = null,
    viewBasis = null,
    affectedVertexIds = null,
    fixedFalloffByVertex = null
  }) {
    const vertices = object.vertices ?? [];
    const faces = object.faces ?? [];
    const vertexNormals = computeVertexNormals(vertices, faces, normal);
    const adjacency = brushType === "blur" ? makeAdjacency(vertices, faces) : null;
    const averages = adjacency ? computeNeighborAverages(vertices, adjacency) : null;
    const changedIds = [];
    const strokeDistance = Number.isFinite(movementDistanceOverride) ? movementDistanceOverride : length3(strokeDelta);
    const screenDeltaLength = Math.hypot(Number(screenDelta[0] ?? 0.0), Number(screenDelta[1] ?? 0.0));
    const grabNormal = safeNormalize3(normal, [0.0, 0.0, 1.0]);
    const grabViewRight = safeNormalize3(viewBasis?.right ?? [1.0, 0.0, 0.0], [1.0, 0.0, 0.0]);
    const grabViewUp = safeNormalize3(viewBasis?.up ?? [0.0, 1.0, 0.0], [0.0, 1.0, 0.0]);
    const grabViewForward = safeNormalize3(viewBasis?.forward ?? [0.0, 0.0, -1.0], [0.0, 0.0, -1.0]);
    let grabTangent = cross3(grabViewForward, grabNormal);
    if (length3(grabTangent) <= EPSILON) {
      grabTangent = cross3(grabViewRight, grabNormal);
    }
    if (length3(grabTangent) <= EPSILON) {
      grabTangent = cross3(grabViewUp, grabNormal);
    }
    grabTangent = safeNormalize3(grabTangent, [1.0, 0.0, 0.0]);
    let normalScreenAxis = [dot3(grabNormal, grabViewRight), dot3(grabNormal, grabViewUp)];
    let tangentScreenAxis = [dot3(grabTangent, grabViewRight), dot3(grabTangent, grabViewUp)];
    if (Math.hypot(normalScreenAxis[0], normalScreenAxis[1]) <= EPSILON
        && Math.hypot(tangentScreenAxis[0], tangentScreenAxis[1]) > EPSILON) {
      const tangent2 = safeNormalize2(tangentScreenAxis);
      normalScreenAxis = [-tangent2[1], tangent2[0]];
    }
    if (Math.hypot(tangentScreenAxis[0], tangentScreenAxis[1]) <= EPSILON
        && Math.hypot(normalScreenAxis[0], normalScreenAxis[1]) > EPSILON) {
      const normal2 = safeNormalize2(normalScreenAxis);
      tangentScreenAxis = [-normal2[1], normal2[0]];
    }
    normalScreenAxis = safeNormalize2(normalScreenAxis, [0.0, 1.0]);
    tangentScreenAxis = safeNormalize2(tangentScreenAxis, [-normalScreenAxis[1], normalScreenAxis[0]]);
    const screenDirection = screenDeltaLength > EPSILON
      ? [screenDelta[0] / screenDeltaLength, screenDelta[1] / screenDeltaLength]
      : [0.0, 0.0];
    for (const vertex of vertices) {
      if (affectedVertexIds && !affectedVertexIds.has(vertex.id)) {
        continue;
      }
      const distance = length3(sub3(vertex.position, center));
      const falloff = fixedFalloffByVertex?.get(vertex.id) ?? computeFalloff(distance, radius, falloffType);
      if (falloff <= 0.0) {
        continue;
      }
      const signedStrength = strength * falloff;
      const strengthMagnitude = Math.abs(strength) * falloff;
      let nextPosition = vertex.position;
      if (brushType === "blur") {
        const target = averages[vertex.id];
        if (!target) {
          throw new Error(`blur brush missing neighbor average for vertex ${vertex.id}`);
        }
        nextPosition = add3(vertex.position, mul3(sub3(target, vertex.position), Math.min(1.0, strengthMagnitude * SMOOTH_AMOUNT_SCALE)));
      } else if (brushType === "grab") {
        if (strokeDistance <= EPSILON || screenDeltaLength <= EPSILON) {
          continue;
        }
        const normalWeight = screenDirection[0] * normalScreenAxis[0] + screenDirection[1] * normalScreenAxis[1];
        const tangentWeight = screenDirection[0] * tangentScreenAxis[0] + screenDirection[1] * tangentScreenAxis[1];
        const grabDirection = add3(mul3(grabNormal, normalWeight), mul3(grabTangent, tangentWeight));
        const normalizedGrabDirection = safeNormalize3(grabDirection, grabNormal);
        nextPosition = add3(
          vertex.position,
          mul3(normalizedGrabDirection, signedStrength * strokeDistance * GRAB_AMOUNT_SCALE)
        );
      } else if (brushType === "pinch") {
        nextPosition = add3(vertex.position, mul3(sub3(center, vertex.position), Math.min(1.0, Math.abs(signedStrength) * PINCH_AMOUNT_SCALE) * Math.sign(strength || 1.0)));
      } else {
        if (strokeDistance <= EPSILON) {
          continue;
        }
        const vertexNormal = vertexNormals[vertex.id];
        if (!vertexNormal) {
          throw new Error(`draw brush missing vertex normal for vertex ${vertex.id}`);
        }
        nextPosition = add3(vertex.position, mul3(vertexNormal, signedStrength * strokeDistance * DRAW_AMOUNT_SCALE));
      }
      if (length3(sub3(nextPosition, vertex.position)) <= EPSILON) {
        continue;
      }
      vertex.position = nextPosition;
      changedIds.push(vertex.id);
    }
    return changedIds;
  }

  // `endStroke`は処理周期の開始または終了に必要な状態を更新する
  endStroke() {
    if (!this.strokeSession) {
      return null;
    }
    const session = this.strokeSession;
    this.strokeSession = null;
    const changedVertexIds = Array.from(session.changedVertexIds);
    this.setMessage(changedVertexIds.length > 0
      ? `sculpted vertices ${changedVertexIds.length}`
      : "sculpt stroke unchanged");
    return {
      objectId: session.object.id,
      snapshot: session.snapshot,
      changedVertexIds
    };
  }

  // `cancel`の`stroke`の条件を判定し、結果を真偽値で返す
  cancelStroke() {
    if (!this.strokeSession) {
      return false;
    }
    const restored = this.restoreStrokeSnapshot(this.strokeSession);
    this.strokeSession = null;
    if (restored) {
      this.markDirty();
      this.rebuildScene();
    }
    this.setMessage("sculpt stroke canceled");
    return restored;
  }

  // `brush`の`preview`を現在の入力と状態から求め、呼び出し元へ返す
  getBrushPreview(options = {}) {
    const center = options.center ?? options.screenPosition ?? null;
    const radius = readPositiveNumber(options.screenRadius, options.radius ?? this.brushRadius, "preview radius");
    const hit = options.hit ?? this.cursorHit?.hit ?? false;
    const normal = options.normal ?? this.cursorHit?.normal ?? [0.0, 0.0, 1.0];
    const viewDirection = options.viewDirection ?? [0.0, 0.0, 1.0];
    if (!center) {
      return null;
    }
    if (!hit) {
      return {
        center,
        majorRadius: radius,
        minorRadius: radius,
        rotation: 0.0,
        hit: false
      };
    }
    const n = safeNormalize3(normal, [0.0, 0.0, 1.0]);
    const v = safeNormalize3(viewDirection, [0.0, 0.0, 1.0]);
    const facing = Math.abs(dot3(n, v));
    const minorScale = Math.max(0.12, Math.min(0.85, facing));
    return {
      center,
      majorRadius: radius,
      minorRadius: radius * minorScale,
      rotation: Number(options.rotation ?? 0.0),
      hit: true
    };
  }
}
