// ---------------------------------------------
//  TranslucentRenderQueue.js  2026/08/11
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import MaterialParameters from "./MaterialParameters.js";
import { readPerformanceTime } from "./GpuPassProfiler.js";

// 投影矩形とview-space奥行き区間が数値誤差だけで非接触と判定されることを避ける余白
// NDCでは2.0が画面幅全体なので1.0e-5は通常解像度の1 pixelより十分小さい
const PROJECTED_BOUNDS_EPSILON = 1.0e-5;
const VIEW_DEPTH_EPSILON = 1.0e-6;
export const TRANSLUCENT_SMALL_OVERLAP_PIXEL_LIMIT = 8.0;

// scene全体の透明triangle収集、global sort、動的Index Buffer、Frost集計を管理する
// Spaceはscene graphの所有と走査だけを担当し、透明描画固有の規則とGPU資源はこのclassへ分離する
export default class TranslucentRenderQueue {

  // frame間で再利用する透明entry、sort作業領域、Index data、GPU Bufferを初期化する
  constructor() {
    this.indexBuffer = null;
    this.indexCapacity = 0;
    this.device = null;
    // 容量拡張前のBufferは記録済みCommand Bufferから参照される可能性があるため保持する
    this.buffers = [];
    // 通常のShape収集で使うentryと描画instance別Matrixをpool化し、frameごとの生成を避ける
    this.translucentQueue = [];
    this.triangleEntryPool = [];
    this.triangleEntryCount = 0;
    this.instanceSnapshotPool = [];
    this.instanceSnapshotCount = 0;
    this.collectTraversalOrder = 0;
    // Nodeへ渡す関数をconstructorで一度だけ作り、収集context自身の短命関数を増やさない
    this.acquireCollectedEntry = () => this.acquireTriangleEntry();
    this.acquireCollectedInstanceSnapshot = (modelview, normal) =>
      this.acquireInstanceSnapshot(modelview, normal);
    this.nextCollectedTraversalOrder = () => {
      const current = this.collectTraversalOrder;
      this.collectTraversalOrder += 1;
      return current;
    };
    // internal描画が使う作業領域を保持し、公開sort APIは独立した結果配列を返す
    this.sortWorkspace = {
      groupsByShape: new Map(),
      modelViewMaps: [],
      groups: [],
      groupPool: [],
      sortItems: [],
      sortItemPool: [],
      sortedEntries: []
    };
    this.prepareWorkspace = {
      sortedIndices: new Uint32Array(0),
      indexCapacity: 0,
      indexWriteView: new Uint32Array(0),
      indexWriteCount: 0,
      batches: [],
      batchPool: []
    };
    this.updatedShapes = new Set();
  }

  // frame先頭でactive範囲だけを0へ戻し、確保済みentryとMatrixを次の収集へ再利用する
  resetCollectionPools() {
    this.translucentQueue.length = 0;
    this.triangleEntryCount = 0;
    this.instanceSnapshotCount = 0;
    this.collectTraversalOrder = 0;
  }

  // 次の透明triangle entryをpoolから取得し、Shape側で全fieldを上書きできる状態で返す
  acquireTriangleEntry() {
    const poolIndex = this.triangleEntryCount;
    this.triangleEntryCount += 1;
    if (!this.triangleEntryPool[poolIndex]) {
      this.triangleEntryPool[poolIndex] = {};
    }
    return this.triangleEntryPool[poolIndex];
  }

  // 一回のShape描画instanceに対応するmodel-viewとnormalを既存Matrixへcopyして返す
  // Shape object単位では共有せず、同じShapeを複数Nodeへ配置した場合のmatrix identityを分離する
  acquireInstanceSnapshot(modelview, normal) {
    if (!modelview?.clone || !normal?.clone) {
      throw new Error("TranslucentRenderQueue instance snapshot requires cloneable matrices");
    }
    const poolIndex = this.instanceSnapshotCount;
    this.instanceSnapshotCount += 1;
    let snapshot = this.instanceSnapshotPool[poolIndex];
    if (!snapshot) {
      snapshot = {
        modelview: modelview.clone(),
        normal: normal.clone()
      };
      this.instanceSnapshotPool[poolIndex] = snapshot;
      return snapshot;
    }
    if (typeof snapshot.modelview?.copyFrom !== "function"
        || typeof snapshot.normal?.copyFrom !== "function") {
      throw new Error("TranslucentRenderQueue pooled matrices require copyFrom()");
    }
    snapshot.modelview.copyFrom(modelview);
    snapshot.normal.copyFrom(normal);
    return snapshot;
  }

  // 可視なBLEND materialのtriangle有無と最大Frost roughnessを一回のscene走査で集計する
  // 独自Shapeがroughness取得APIを持たない場合は1.0とし、必要Levelを省略しない安全側へ倒す
  summarize(nodes) {
    if (!Array.isArray(nodes)) {
      throw new Error("TranslucentRenderQueue.summarize requires a node array");
    }
    let hasTriangles = false;
    let maxFrostRoughness = 0.04;
    for (const node of nodes) {
      if (!node || !Array.isArray(node.shapes)) {
        continue;
      }
      for (const shape of node.shapes) {
        if (!shape || shape.isHidden || typeof shape.getMaterialCount !== "function") {
          continue;
        }
        // Wireframeはmaterial alphaによらずopaque phaseでShape全体を一度だけ描くため集計しない
        if (typeof shape.isWireframe === "function" && shape.isWireframe()) {
          continue;
        }
        for (let materialIndex = 0; materialIndex < shape.getMaterialCount(); materialIndex++) {
          const hasMaterialRecord = Array.isArray(shape.materials)
            || typeof shape.getMaterialAt === "function";
          const material = MaterialParameters.resolveShapeMaterial(shape, materialIndex);
          const alphaMode = MaterialParameters.getAlphaMode(material, materialIndex);
          if (alphaMode !== "BLEND") {
            continue;
          }
          const drawInfo = shape.getMaterialDrawInfo(materialIndex);
          if (drawInfo.count <= 0) {
            continue;
          }
          hasTriangles = true;
          const roughness = hasMaterialRecord
            ? MaterialParameters.getFrostRoughness(material, materialIndex)
            : 1.0;
          maxFrostRoughness = Math.max(maxFrostRoughness, roughness);
        }
      }
    }
    return { hasTriangles, maxFrostRoughness };
  }

  // cameraがlocal -Zを見る規約に従い、遠方triangleから手前へ並ぶ安定比較を一か所へ集約する
  // depthが同じ場合はscene走査順と元triangle番号を使い、frame間で順序が揺れないようにする
  compareEntries(a, b) {
    return (a.viewDepth - b.viewDepth)
      || (a.traversalOrder - b.traversalOrder)
      || (a.triangleIndex - b.triangleIndex);
  }

  // 一回のNode描画から共有されたmodel-view matrix identityを描画インスタンスの境界としてまとめる
  // 同じShape objectが複数Nodeに配置されてもmatrix snapshotが異なるため、別インスタンスとして扱う
  groupEntriesByInstance(translucentQueue, workspace = null) {
    const groupsByShape = workspace?.groupsByShape ?? new Map();
    const groups = workspace?.groups ?? [];
    groupsByShape.clear();
    groups.length = 0;
    let modelViewMapCount = 0;
    let groupCount = 0;
    for (const entry of translucentQueue) {
      let groupsByModelView = groupsByShape.get(entry.shape);
      if (!groupsByModelView) {
        if (workspace) {
          groupsByModelView = workspace.modelViewMaps[modelViewMapCount] ?? new Map();
          workspace.modelViewMaps[modelViewMapCount] = groupsByModelView;
          modelViewMapCount += 1;
          groupsByModelView.clear();
        } else {
          groupsByModelView = new Map();
        }
        groupsByShape.set(entry.shape, groupsByModelView);
      }
      let group = groupsByModelView.get(entry.modelview);
      if (!group || group.normal !== entry.normal) {
        group = workspace?.groupPool[groupCount] ?? { entries: [] };
        if (workspace) {
          workspace.groupPool[groupCount] = group;
          groupCount += 1;
        }
        group.shape = entry.shape;
        group.modelview = entry.modelview;
        group.normal = entry.normal;
        group.node = entry.node ?? null;
        group.shapeIndex = entry.shapeIndex ?? null;
        group.entries.length = 0;
        group.firstTraversalOrder = entry.traversalOrder;
        group.firstTriangleIndex = entry.triangleIndex;
        group.bounds = null;
        group.coarseBounds = null;
        group.tightBounds = null;
        group.needsTightBounds = false;
        group.vertexVisitGeneration = group.vertexVisitGeneration ?? 0;
        group.requiresGlobalSort = false;
        groupsByModelView.set(entry.modelview, group);
        groups.push(group);
      }
      group.entries.push(entry);
      group.firstTraversalOrder = Math.min(group.firstTraversalOrder, entry.traversalOrder);
      group.firstTriangleIndex = Math.min(group.firstTriangleIndex, entry.triangleIndex);
    }
    return groups;
  }

  // Shapeのlocal AABB 8頂点をview-spaceへ移し、NDC矩形とview-space Z区間を計算する
  // near planeをまたぐ場合は投影が発散するためnullを返し、呼び出し側はglobal sortを使う
  computeProjectedInstanceBounds(group, cameraFrame) {
    const box = group.shape?.getBoundingBox?.() ?? group.shape?.box ?? null;
    const projection = cameraFrame?.projectionMatrix;
    const near = cameraFrame?.near;
    // 骨変形後の頂点は静的local AABB外へ動く可能性があるため、現段階では非干渉判定へ使わない
    if (group.shape?.hasSkeleton === true || group.shape?.skeleton
        || !box || !group.modelview?.mulVector || !projection?.mulVector
        || !Number.isFinite(near) || near <= 0.0) {
      return null;
    }
    const values = [box.minx, box.maxx, box.miny, box.maxy, box.minz, box.maxz];
    if (!values.every(Number.isFinite)
        || box.minx > box.maxx || box.miny > box.maxy || box.minz > box.maxz) {
      return null;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const x of [box.minx, box.maxx]) {
      for (const y of [box.miny, box.maxy]) {
        for (const z of [box.minz, box.maxz]) {
          const viewPoint = group.modelview.mulVector([x, y, z]);
          if (!Array.isArray(viewPoint) || viewPoint.length < 3
              || !viewPoint.every(Number.isFinite)) {
            return null;
          }
          minZ = Math.min(minZ, viewPoint[2]);
          maxZ = Math.max(maxZ, viewPoint[2]);
          // AABBがnear planeへ触れる場合は一部頂点の透視除算が極端になるため最適化しない
          if (viewPoint[2] >= -near + VIEW_DEPTH_EPSILON) {
            return null;
          }
          const projected = projection.mulVector(viewPoint);
          if (!Array.isArray(projected) || projected.length < 2
              || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) {
            return null;
          }
          minX = Math.min(minX, projected[0]);
          maxX = Math.max(maxX, projected[0]);
          minY = Math.min(minY, projected[1]);
          maxY = Math.max(maxY, projected[1]);
        }
      }
    }
    return { minX, maxX, minY, maxY, minZ, maxZ };
  }

  // coarse AABBが重なったinstanceだけ、実際に透明描画するtriangle頂点からtightな投影境界を求める
  // Matrix.mulVector相当をscalarで計算し、同じ頂点が複数triangleに現れても短命Arrayを生成しない
  computeTightProjectedInstanceBounds(group, cameraFrame) {
    const positions = group.shape?.positionArray;
    const modelview = group.modelview?.mat;
    const projection = cameraFrame?.projectionMatrix?.mat;
    const near = cameraFrame?.near;
    const hasPositionData = Array.isArray(positions) || ArrayBuffer.isView(positions);
    if (group.shape?.hasSkeleton === true || group.shape?.skeleton
        || !hasPositionData || positions.length < 3
        || !Array.isArray(modelview) || modelview.length < 16
        || !Array.isArray(projection) || projection.length < 16
        || !Number.isFinite(near) || near <= 0.0) {
      return null;
    }
    if (positions.length % 3 !== 0) {
      throw new Error("TranslucentRenderQueue tight bounds requires xyz Shape positions");
    }
    const shapeVertexCount = positions.length / 3;
    if (!(group.vertexVisitMarks instanceof Uint32Array)
        || group.vertexVisitMarks.length < shapeVertexCount) {
      group.vertexVisitMarks = new Uint32Array(shapeVertexCount);
      group.vertexVisitGeneration = 0;
    }
    group.vertexVisitGeneration += 1;
    if (group.vertexVisitGeneration >= 0xffffffff) {
      group.vertexVisitMarks.fill(0);
      group.vertexVisitGeneration = 1;
    }
    const visitGeneration = group.vertexVisitGeneration;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let vertexCount = 0;
    for (const entry of group.entries) {
      for (let corner = 0; corner < 3; corner++) {
        const vertexIndex = corner === 0
          ? entry.index0
          : corner === 1
            ? entry.index1
            : entry.index2;
        if (!Number.isInteger(vertexIndex) || vertexIndex < 0) {
          throw new Error("TranslucentRenderQueue tight bounds requires non-negative vertex indices");
        }
        const offset = vertexIndex * 3;
        if (offset + 2 >= positions.length) {
          throw new Error(
            `TranslucentRenderQueue tight bounds vertex ${vertexIndex} exceeds Shape positions`
          );
        }
        if (group.vertexVisitMarks[vertexIndex] === visitGeneration) {
          continue;
        }
        group.vertexVisitMarks[vertexIndex] = visitGeneration;
        const localX = positions[offset];
        const localY = positions[offset + 1];
        const localZ = positions[offset + 2];
        if (!Number.isFinite(localX) || !Number.isFinite(localY) || !Number.isFinite(localZ)) {
          throw new Error(`TranslucentRenderQueue tight bounds vertex ${vertexIndex} is not finite`);
        }
        let viewX = modelview[0] * localX + modelview[4] * localY
          + modelview[8] * localZ + modelview[12];
        let viewY = modelview[1] * localX + modelview[5] * localY
          + modelview[9] * localZ + modelview[13];
        let viewZ = modelview[2] * localX + modelview[6] * localY
          + modelview[10] * localZ + modelview[14];
        const viewW = modelview[3] * localX + modelview[7] * localY
          + modelview[11] * localZ + modelview[15];
        if (Math.abs(viewW) > 1.0e-12) {
          viewX /= viewW;
          viewY /= viewW;
          viewZ /= viewW;
        }
        if (!Number.isFinite(viewX) || !Number.isFinite(viewY) || !Number.isFinite(viewZ)) {
          throw new Error(`TranslucentRenderQueue tight bounds view vertex ${vertexIndex} is not finite`);
        }
        // near planeをまたぐ場合は投影境界を安全に確定できないため、coarse判定を維持する
        if (viewZ >= -near + VIEW_DEPTH_EPSILON) {
          return null;
        }
        const clipX = projection[0] * viewX + projection[4] * viewY
          + projection[8] * viewZ + projection[12];
        const clipY = projection[1] * viewX + projection[5] * viewY
          + projection[9] * viewZ + projection[13];
        const clipW = projection[3] * viewX + projection[7] * viewY
          + projection[11] * viewZ + projection[15];
        if (!Number.isFinite(clipX) || !Number.isFinite(clipY)
            || !Number.isFinite(clipW) || Math.abs(clipW) <= 1.0e-12) {
          return null;
        }
        const projectedX = clipX / clipW;
        const projectedY = clipY / clipW;
        minX = Math.min(minX, projectedX);
        maxX = Math.max(maxX, projectedX);
        minY = Math.min(minY, projectedY);
        maxY = Math.max(maxY, projectedY);
        minZ = Math.min(minZ, viewZ);
        maxZ = Math.max(maxZ, viewZ);
        vertexCount += 1;
      }
    }
    if (vertexCount === 0) {
      return null;
    }
    return { minX, maxX, minY, maxY, minZ, maxZ };
  }

  // boundsの重なり量をNDCとrender target pixelの両方で返し、判定規則を一か所へ集約する
  describeBoundsOverlap(a, b, viewportWidth = null, viewportHeight = null) {
    if (!a || !b) {
      return {
        boundsKnown: false,
        screenOverlaps: null,
        depthOverlaps: null,
        mayInterfere: true,
        overlapPixelsX: null,
        overlapPixelsY: null,
        minimumOverlapPixels: null
      };
    }
    const overlapNdcX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const overlapNdcY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
    const screenOverlaps = overlapNdcX >= -PROJECTED_BOUNDS_EPSILON
      && overlapNdcY >= -PROJECTED_BOUNDS_EPSILON;
    const depthOverlaps = !(
      a.maxZ < b.minZ - VIEW_DEPTH_EPSILON
      || b.maxZ < a.minZ - VIEW_DEPTH_EPSILON
    );
    const hasViewport = Number.isFinite(viewportWidth) && viewportWidth > 0
      && Number.isFinite(viewportHeight) && viewportHeight > 0;
    const overlapPixelsX = hasViewport
      ? Math.max(overlapNdcX, 0.0) * viewportWidth * 0.5
      : null;
    const overlapPixelsY = hasViewport
      ? Math.max(overlapNdcY, 0.0) * viewportHeight * 0.5
      : null;
    return {
      boundsKnown: true,
      screenOverlaps,
      depthOverlaps,
      mayInterfere: screenOverlaps && depthOverlaps,
      overlapPixelsX,
      overlapPixelsY,
      minimumOverlapPixels: hasViewport
        ? Math.min(overlapPixelsX, overlapPixelsY)
        : null
    };
  }

  // 二つの描画インスタンスが画面上と奥行き方向の両方で重なる場合だけtriangle相互sortを要求する
  // どちらかの境界が不明なら安全性を証明できないため、干渉ありとして扱う
  instanceBoundsMayInterfere(a, b) {
    return this.describeBoundsOverlap(a, b).mayInterfere;
  }

  // 異常frameログへ過剰な桁数を持ち込まないよう、有限値だけを小数6桁へ丸める
  formatDebugNumber(value) {
    return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
  }

  // Euler角や位置の配列を異常値を隠さないnull付き固定長dataへ変換する
  formatDebugVector(values, length) {
    if (!Array.isArray(values) || values.length < length) {
      return null;
    }
    return values.slice(0, length).map((value) => this.formatDebugNumber(value));
  }

  // 直前にprepareしたqueueから、異常frame時だけinstance姿勢・bounds・batch分断を構築する
  // 通常frameでは呼ばず、pool内objectへの参照を外へ出さない独立snapshotとして返す
  getDebugSnapshot(preparedQueue) {
    if (!preparedQueue || preparedQueue.owner !== this
        || !Array.isArray(preparedQueue.batches)) {
      throw new Error("TranslucentRenderQueue debug snapshot requires its prepared queue");
    }
    const groups = this.sortWorkspace.groups;
    const sortStats = preparedQueue.sortStats;
    const instances = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex];
      let batchRunCount = 0;
      let batchTriangleCount = 0;
      for (const batch of preparedQueue.batches) {
        if (batch.shape !== group.shape
            || batch.modelview !== group.modelview
            || batch.normal !== group.normal) {
          continue;
        }
        batchRunCount += 1;
        batchTriangleCount += batch.indexCount / 3;
      }
      const node = group.node;
      const localAttitude = typeof node?.getLocalAttitude === "function"
        ? node.getLocalAttitude()
        : null;
      const worldAttitude = typeof node?.getWorldAttitude === "function"
        ? node.getWorldAttitude()
        : null;
      const worldPosition = typeof node?.getWorldPosition === "function"
        ? node.getWorldPosition()
        : null;
      const bounds = group.bounds;
      instances.push({
        groupIndex,
        nodeName: typeof node?.getName === "function" ? node.getName() : null,
        shapeIndex: Number.isInteger(group.shapeIndex) ? group.shapeIndex : null,
        traversalOrder: group.firstTraversalOrder,
        triangleCount: group.entries.length,
        batchRunCount,
        batchTriangleCount,
        requiresGlobalSort: group.requiresGlobalSort === true || bounds === null,
        boundsSource: group.tightBounds ? "transparent-vertices" : "local-aabb",
        localAttitudeDegreesYawPitchRoll: this.formatDebugVector(localAttitude, 3),
        worldAttitudeDegreesYawPitchRoll: this.formatDebugVector(worldAttitude, 3),
        worldPosition: this.formatDebugVector(worldPosition, 3),
        bounds: bounds ? {
          minX: this.formatDebugNumber(bounds.minX),
          maxX: this.formatDebugNumber(bounds.maxX),
          minY: this.formatDebugNumber(bounds.minY),
          maxY: this.formatDebugNumber(bounds.maxY),
          minZ: this.formatDebugNumber(bounds.minZ),
          maxZ: this.formatDebugNumber(bounds.maxZ)
        } : null
      });
    }
    const ambiguousPairs = [];
    const ignoredSmallOverlapPairs = [];
    const viewportWidth = sortStats?.viewportWidth ?? null;
    const viewportHeight = sortStats?.viewportHeight ?? null;
    const smallOverlapPixelLimit = sortStats?.smallOverlapPixelLimit
      ?? TRANSLUCENT_SMALL_OVERLAP_PIXEL_LIMIT;
    for (let leftIndex = 0; leftIndex < groups.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex++) {
        const left = groups[leftIndex];
        const right = groups[rightIndex];
        const relation = this.describeBoundsOverlap(
          left.bounds,
          right.bounds,
          viewportWidth,
          viewportHeight
        );
        if (!relation.mayInterfere) continue;
        const pair = {
          leftGroupIndex: leftIndex,
          rightGroupIndex: rightIndex,
          leftNodeName: typeof left.node?.getName === "function" ? left.node.getName() : null,
          rightNodeName: typeof right.node?.getName === "function" ? right.node.getName() : null,
          boundsKnown: relation.boundsKnown,
          screenOverlaps: relation.screenOverlaps,
          depthOverlaps: relation.depthOverlaps,
          overlapPixelsX: this.formatDebugNumber(relation.overlapPixelsX),
          overlapPixelsY: this.formatDebugNumber(relation.overlapPixelsY),
          minimumOverlapPixels: this.formatDebugNumber(relation.minimumOverlapPixels)
        };
        if (left.tightBounds && right.tightBounds
            && Number.isFinite(relation.minimumOverlapPixels)
            && relation.minimumOverlapPixels <= smallOverlapPixelLimit) {
          ignoredSmallOverlapPairs.push(pair);
        } else {
          ambiguousPairs.push(pair);
        }
      }
    }
    const cpuTiming = preparedQueue.cpuTiming;
    return {
      triangleCount: preparedQueue.triangleCount,
      batchCount: preparedQueue.batches.length,
      fragmentationCount: Math.max(preparedQueue.batches.length - groups.length, 0),
      instanceCount: groups.length,
      independentInstanceCount: sortStats?.independentInstanceCount ?? 0,
      globallySortedInstanceCount: sortStats?.globallySortedInstanceCount ?? 0,
      ambiguousPairCount: sortStats?.ambiguousPairCount ?? ambiguousPairs.length,
      coarseAmbiguousPairCount: sortStats?.coarseAmbiguousPairCount ?? 0,
      tightBoundsGroupCount: sortStats?.tightBoundsGroupCount ?? 0,
      tightBoundsUnavailableGroupCount: sortStats?.tightBoundsUnavailableGroupCount ?? 0,
      ignoredSmallOverlapPairCount:
        sortStats?.ignoredSmallOverlapPairCount ?? ignoredSmallOverlapPairs.length,
      maximumIgnoredOverlapPixels: this.formatDebugNumber(
        sortStats?.maximumIgnoredOverlapPixels ?? null
      ),
      smallOverlapPixelLimit,
      cpuTiming: cpuTiming ? {
        collectMs: this.formatDebugNumber(cpuTiming.collectMs),
        sortMs: this.formatDebugNumber(cpuTiming.sortMs),
        prepareMs: this.formatDebugNumber(cpuTiming.prepareMs),
        totalMs: this.formatDebugNumber(cpuTiming.totalMs)
      } : null,
      instances,
      ambiguousPairs,
      ignoredSmallOverlapPairs
    };
  }

  // 非干渉と証明できたインスタンスは内部triangle順だけを保つblockへまとめ、残りはglobal sortする
  // blockと個別triangleをdepth順へ置くことで、画面が重なるが奥行き分離したShape間の前後関係も維持する
  sortForMinimalSafeBatches(translucentQueue, cameraFrame, workspace = null, options = {}) {
    if (!Array.isArray(translucentQueue)) {
      throw new Error("TranslucentRenderQueue sort requires an array queue");
    }
    if (translucentQueue.length === 0) {
      return {
        entries: [],
        stats: {
          instanceCount: 0,
          independentInstanceCount: 0,
          globallySortedInstanceCount: 0,
          ambiguousPairCount: 0,
          coarseAmbiguousPairCount: 0,
          tightBoundsGroupCount: 0,
          tightBoundsUnavailableGroupCount: 0,
          ignoredSmallOverlapPairCount: 0,
          maximumIgnoredOverlapPixels: 0,
          viewportWidth: null,
          viewportHeight: null,
          smallOverlapPixelLimit: TRANSLUCENT_SMALL_OVERLAP_PIXEL_LIMIT
        }
      };
    }
    const hasViewportWidth = options.viewportWidth !== undefined;
    const hasViewportHeight = options.viewportHeight !== undefined;
    if (hasViewportWidth !== hasViewportHeight) {
      throw new Error("TranslucentRenderQueue pixel overlap requires viewport width and height");
    }
    const viewportWidth = hasViewportWidth
      ? util.readFiniteNumber(options.viewportWidth, "TranslucentRenderQueue viewport width", {
          integer: true,
          min: 1
        })
      : null;
    const viewportHeight = hasViewportHeight
      ? util.readFiniteNumber(options.viewportHeight, "TranslucentRenderQueue viewport height", {
          integer: true,
          min: 1
        })
      : null;
    const smallOverlapPixelLimit = util.readOptionalFiniteNumber(
      options.smallOverlapPixelLimit,
      "TranslucentRenderQueue small overlap pixel limit",
      TRANSLUCENT_SMALL_OVERLAP_PIXEL_LIMIT,
      { min: 0.0 }
    );
    const groups = this.groupEntriesByInstance(translucentQueue, workspace);
    for (const group of groups) {
      group.coarseBounds = this.computeProjectedInstanceBounds(group, cameraFrame);
      group.bounds = group.coarseBounds;
    }
    let coarseAmbiguousPairCount = 0;
    // 安価なlocal AABB投影で候補groupだけを選び、非候補では頂点変換を行わない
    for (let leftIndex = 0; leftIndex < groups.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex++) {
        const left = groups[leftIndex];
        const right = groups[rightIndex];
        if (!this.instanceBoundsMayInterfere(left.coarseBounds, right.coarseBounds)) continue;
        left.needsTightBounds = true;
        right.needsTightBounds = true;
        coarseAmbiguousPairCount += 1;
      }
    }
    let tightBoundsGroupCount = 0;
    let tightBoundsUnavailableGroupCount = 0;
    for (const group of groups) {
      if (!group.needsTightBounds) continue;
      group.tightBounds = this.computeTightProjectedInstanceBounds(group, cameraFrame);
      if (group.tightBounds) {
        group.bounds = group.tightBounds;
        tightBoundsGroupCount += 1;
      } else {
        tightBoundsUnavailableGroupCount += 1;
      }
    }
    let ambiguousPairCount = 0;
    let ignoredSmallOverlapPairCount = 0;
    let maximumIgnoredOverlapPixels = 0.0;
    // tight boundsで残ったpairだけを判定し、短辺8 pixel以下の細い重なりは明示規則で除外する
    for (let leftIndex = 0; leftIndex < groups.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex++) {
        const left = groups[leftIndex];
        const right = groups[rightIndex];
        const relation = this.describeBoundsOverlap(
          left.bounds,
          right.bounds,
          viewportWidth,
          viewportHeight
        );
        if (!relation.mayInterfere) continue;
        if (left.tightBounds && right.tightBounds
            && Number.isFinite(relation.minimumOverlapPixels)
            && relation.minimumOverlapPixels <= smallOverlapPixelLimit) {
          ignoredSmallOverlapPairCount += 1;
          maximumIgnoredOverlapPixels = Math.max(
            maximumIgnoredOverlapPixels,
            relation.minimumOverlapPixels
          );
          continue;
        }
        left.requiresGlobalSort = true;
        right.requiresGlobalSort = true;
        ambiguousPairCount += 1;
      }
    }

    const sortItems = workspace?.sortItems ?? [];
    sortItems.length = 0;
    let sortItemCount = 0;
    let independentInstanceCount = 0;
    for (const group of groups) {
      if (group.requiresGlobalSort || group.bounds === null) {
        for (const entry of group.entries) {
          const sortItem = workspace?.sortItemPool[sortItemCount] ?? {};
          if (workspace) {
            workspace.sortItemPool[sortItemCount] = sortItem;
            sortItemCount += 1;
          }
          sortItem.depth = entry.viewDepth;
          sortItem.traversalOrder = entry.traversalOrder;
          sortItem.triangleIndex = entry.triangleIndex;
          sortItem.entry = entry;
          sortItem.entries = null;
          sortItems.push(sortItem);
        }
        continue;
      }
      group.entries.sort((a, b) => this.compareEntries(a, b));
      independentInstanceCount += 1;
      const sortItem = workspace?.sortItemPool[sortItemCount] ?? {};
      if (workspace) {
        workspace.sortItemPool[sortItemCount] = sortItem;
        sortItemCount += 1;
      }
      // block内のどのdepthを選んでも、画面が重なる別Shapeとは区間分離しているため順序は同じになる
      sortItem.depth = (group.bounds.minZ + group.bounds.maxZ) * 0.5;
      sortItem.traversalOrder = group.firstTraversalOrder;
      sortItem.triangleIndex = group.firstTriangleIndex;
      sortItem.entry = null;
      sortItem.entries = group.entries;
      sortItems.push(sortItem);
    }
    sortItems.sort((a, b) =>
      (a.depth - b.depth)
      || (a.traversalOrder - b.traversalOrder)
      || (a.triangleIndex - b.triangleIndex)
    );
    const sortedEntries = workspace?.sortedEntries ?? [];
    sortedEntries.length = 0;
    // 単独triangleを1要素Arrayで包まず、blockだけgroup配列を展開してsortItemsの順序を作る
    for (const item of sortItems) {
      if (item.entry) {
        sortedEntries.push(item.entry);
        continue;
      }
      for (const entry of item.entries) {
        sortedEntries.push(entry);
      }
    }
    return {
      entries: sortedEntries,
      stats: {
        instanceCount: groups.length,
        independentInstanceCount,
        globallySortedInstanceCount: groups.length - independentInstanceCount,
        ambiguousPairCount,
        coarseAmbiguousPairCount,
        tightBoundsGroupCount,
        tightBoundsUnavailableGroupCount,
        ignoredSmallOverlapPairCount,
        maximumIgnoredOverlapPixels,
        viewportWidth,
        viewportHeight,
        smallOverlapPixelLimit
      }
    };
  }

  // sort済みtriangle数を収めるuint32 Index Bufferを確保し、同じGPUDeviceと容量なら再利用する
  // 容量は2の累乗で拡張し、triangle数が少し増えるたびにBufferを作り直すことを避ける
  ensureIndexBuffer(gpu, indexCount) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("TranslucentRenderQueue requires a ready WebGPU context");
    }
    const requiredCount = util.readFiniteNumber(
      indexCount,
      "TranslucentRenderQueue sorted index count",
      { integer: true, min: 1 }
    );
    if (this.device !== null && this.device !== gpu.device) {
      this.indexBuffer = null;
      this.indexCapacity = 0;
    }
    if (this.indexBuffer && this.indexCapacity >= requiredCount) {
      return this.indexBuffer;
    }
    let capacity = 1;
    while (capacity < requiredCount) {
      capacity *= 2;
    }
    const buffer = gpu.device.createBuffer({
      label: "translucent-render-queue:sorted-indices",
      size: capacity * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    this.indexBuffer = buffer;
    this.indexCapacity = capacity;
    this.device = gpu.device;
    this.buffers.push(buffer);
    return buffer;
  }

  // sort済みindexのCPU転送元を2の累乗容量で確保し、通常frameは同じArrayBufferへ上書きする
  // writeBufferへ渡すviewもindex数が変わらない間は保持し、subarray objectの反復生成を避ける
  ensureSortedIndexData(indexCount) {
    const requiredCount = util.readFiniteNumber(
      indexCount,
      "TranslucentRenderQueue CPU sorted index count",
      { integer: true, min: 1 }
    );
    const workspace = this.prepareWorkspace;
    if (workspace.indexCapacity < requiredCount) {
      let capacity = 1;
      while (capacity < requiredCount) {
        capacity *= 2;
      }
      workspace.sortedIndices = new Uint32Array(capacity);
      workspace.indexCapacity = capacity;
      workspace.indexWriteView = new Uint32Array(0);
      workspace.indexWriteCount = 0;
    }
    if (workspace.indexWriteCount !== requiredCount) {
      workspace.indexWriteView = workspace.sortedIndices.subarray(0, requiredCount);
      workspace.indexWriteCount = requiredCount;
    }
    return workspace;
  }

  // global sort済みtriangleをIndex Bufferとbatch一覧へ変換し、複数Render Passで再利用できる形にする
  // CPU配列生成、GPU Buffer転送、batch境界計算はprepare時の一回だけ行い、描画時には繰り返さない
  prepareSortedQueue(translucentQueue, options = {}) {
    if (!Array.isArray(translucentQueue)) {
      throw new Error("TranslucentRenderQueue.prepareSortedQueue requires an array queue");
    }
    const reuseStorage = options.reuseStorage === true;
    const batches = reuseStorage ? this.prepareWorkspace.batches : [];
    batches.length = 0;
    if (translucentQueue.length === 0) {
      return {
        owner: this,
        triangleCount: 0,
        indexBuffer: null,
        batches
      };
    }
    const gpu = translucentQueue[0].shape?.gpu;
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("TranslucentRenderQueue entry requires a Shape with WebGPU context");
    }
    const indexCount = translucentQueue.length * 3;
    const indexWorkspace = reuseStorage
      ? this.ensureSortedIndexData(indexCount)
      : { sortedIndices: new Uint32Array(indexCount), indexWriteView: null };
    const sortedIndices = indexWorkspace.sortedIndices;
    if (!reuseStorage) {
      indexWorkspace.indexWriteView = sortedIndices;
    }
    let batchCount = 0;
    let batch = null;
    for (let entryIndex = 0; entryIndex < translucentQueue.length; entryIndex++) {
      const entry = translucentQueue[entryIndex];
      if (entry.shape?.gpu?.device !== gpu.device) {
        throw new Error("TranslucentRenderQueue entries must use the same GPUDevice");
      }
      const { index0, index1, index2 } = entry;
      if (!Number.isInteger(index0) || index0 < 0 || index0 > 0xFFFFFFFF
          || !Number.isInteger(index1) || index1 < 0 || index1 > 0xFFFFFFFF
          || !Number.isInteger(index2) || index2 < 0 || index2 > 0xFFFFFFFF) {
        throw new Error(
          `TranslucentRenderQueue triangle ${entry.triangleIndex} `
          + `indices must be unsigned 32-bit integers: ${index0}, ${index1}, ${index2}`
        );
      }
      const indexOffset = entryIndex * 3;
      sortedIndices[indexOffset] = index0;
      sortedIndices[indexOffset + 1] = index1;
      sortedIndices[indexOffset + 2] = index2;
      const continuesBatch = batch
        && batch.shape === entry.shape
        && batch.materialIndex === entry.materialIndex
        && batch.modelview === entry.modelview
        && batch.normal === entry.normal;
      if (continuesBatch) {
        batch.indexCount += 3;
        continue;
      }
      batch = reuseStorage
        ? this.prepareWorkspace.batchPool[batchCount] ?? {}
        : {};
      if (reuseStorage) {
        this.prepareWorkspace.batchPool[batchCount] = batch;
      }
      batchCount += 1;
      batch.shape = entry.shape;
      batch.materialIndex = entry.materialIndex;
      batch.modelview = entry.modelview;
      batch.normal = entry.normal;
      batch.firstIndex = indexOffset;
      batch.indexCount = 3;
      batches.push(batch);
    }
    const indexBuffer = this.ensureIndexBuffer(gpu, indexCount);
    gpu.queue.writeBuffer(indexBuffer, 0, indexWorkspace.indexWriteView);
    return {
      owner: this,
      triangleCount: translucentQueue.length,
      indexBuffer,
      batches
    };
  }

  // prepare済みのIndex Bufferとbatch境界を現在のRender Passへ描き、shaderだけをpassごとに交換する
  // Transmission maskと最終Forwardが同じgeometry順を使っても、queue再収集やBuffer再転送は発生しない
  drawPrepared(preparedQueue, options = {}) {
    if (!preparedQueue || preparedQueue.owner !== this
        || !Array.isArray(preparedQueue.batches)) {
      throw new Error("TranslucentRenderQueue.drawPrepared requires a queue prepared by this instance");
    }
    if (preparedQueue.triangleCount === 0) {
      return 0;
    }
    if (!preparedQueue.indexBuffer) {
      throw new Error("TranslucentRenderQueue prepared queue requires an index buffer");
    }
    // Node走査を省く再描画でもpass固有のview-space lightを各Shapeへ反映する
    // 同じShapeが複数batchへ分かれていてもparameter更新は一回だけ行う
    if (Object.prototype.hasOwnProperty.call(options, "lightVector")) {
      const updatedShapes = this.updatedShapes;
      updatedShapes.clear();
      for (const current of preparedQueue.batches) {
        if (updatedShapes.has(current.shape)) {
          continue;
        }
        current.shape.shaderParameter?.("light", options.lightVector);
        updatedShapes.add(current.shape);
      }
    }
    for (const current of preparedQueue.batches) {
      current.shape.drawMaterial(
        current.modelview,
        current.normal,
        current.materialIndex,
        {
          indexBuffer: preparedQueue.indexBuffer,
          indexFormat: "uint32",
          indexCount: current.indexCount,
          firstIndex: current.firstIndex,
          // 通常透明描画はtrue、Transmission exit passは裏面depthを書き込むためfalseを指定する
          translucent: options.translucent ?? true,
          shaderOverride: options.shaderOverride
        }
      );
    }
    return preparedQueue.batches.length;
  }

  // sort済みentry配列を一回だけ描く場合に、prepareとdrawを一つの呼出へまとめる
  // 再利用する呼び出し側はprepareSortedQueue()とdrawPrepared()を個別に使う
  drawSortedBatches(translucentQueue, options = {}) {
    const preparedQueue = this.prepareSortedQueue(translucentQueue, { reuseStorage: true });
    return this.drawPrepared(preparedQueue, options);
  }

  // Spaceが提供するroot走査callbackを透明triangle収集phaseで実行し、奥から手前へsortして描画する
  // 同一depthではscene走査順と元triangle番号を使い、frame間で描画順が揺れないようにする
  collectSortAndDraw(drawRoots, options = {}) {
    if (typeof drawRoots !== "function") {
      throw new Error("TranslucentRenderQueue.collectSortAndDraw requires a drawRoots callback");
    }
    this.resetCollectionPools();
    const translucentQueue = this.translucentQueue;
    const collectStartedAt = readPerformanceTime();
    drawRoots({
      ...options,
      phase: "collect-translucent",
      translucentQueue,
      acquireEntry: this.acquireCollectedEntry,
      acquireInstanceSnapshot: this.acquireCollectedInstanceSnapshot,
      nextTraversalOrder: this.nextCollectedTraversalOrder
    });
    const collectFinishedAt = readPerformanceTime();
    // 投影境界が非干渉と証明できるインスタンスだけをblock化し、曖昧な組合せはtriangle単位sortを維持する
    const sortedResult = this.sortForMinimalSafeBatches(
      translucentQueue,
      options.cameraFrame,
      this.sortWorkspace,
      {
        viewportWidth: options.viewportWidth,
        viewportHeight: options.viewportHeight,
        smallOverlapPixelLimit: options.smallOverlapPixelLimit
      }
    );
    const sortFinishedAt = readPerformanceTime();
    const preparedQueue = this.prepareSortedQueue(
      sortedResult.entries,
      { reuseStorage: true }
    );
    preparedQueue.sortStats = sortedResult.stats;
    const prepareFinishedAt = readPerformanceTime();
    // GPU timestampでは観測できないscene走査、sort、Index Buffer準備を個別に保持する
    // final Forwardがprepare済みqueueを再利用する場合も、この一回分のCPU時間だけを報告する
    preparedQueue.cpuTiming = {
      collectMs: collectFinishedAt - collectStartedAt,
      sortMs: sortFinishedAt - collectFinishedAt,
      prepareMs: prepareFinishedAt - sortFinishedAt,
      totalMs: prepareFinishedAt - collectStartedAt
    };
    this.drawPrepared(preparedQueue, options);
    return preparedQueue;
  }
}
