// ---------------------------------------------
// samples/webgmodeler/editOperations.js  2026/05/16
//   webgmodeler edit operations
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import { add3, mul3, sub3 } from "./math3d.js";

// main.js から渡された context を使い、編集操作 API をまとめて作る
export function createEditOperations(ctx) {
  // keyboard 補助操作で使う 1 回分の移動量を model size から決める
  const getKeyboardEditStep = () => Math.max(0.04, ctx.getEditorBounds().size * 0.035);

  // 選択 face だけを削除する
  // face を削除しても vertex は残すため、穴を開ける操作や面の張り直しに使える
  function deleteSelectedFaces() {
    const { editor } = ctx;
    if (!ctx.isEditMode()) {
      ctx.setMessage("switch to edit mode before deleting faces");
      return;
    }
    if (editor.selectedFaces.size === 0) {
      ctx.setMessage("select faces before deleting faces");
      return;
    }
    ctx.pushUndo("delete faces");
    editor.faces = editor.faces.filter((face) => !editor.selectedFaces.has(face.id));
    ctx.clearSelection();
    ctx.rebuildScene();
    ctx.setMessage("deleted faces");
  }

  // 選択 vertex と、その vertex を参照する face を削除する
  // dangling face を残すと ModelAsset 構築時に壊れるため、参照 face は必ず同時に消す
  function deleteSelectedVertices() {
    const { editor } = ctx;
    if (!ctx.isEditMode()) {
      ctx.setMessage("switch to edit mode before deleting vertices");
      return;
    }
    if (editor.selectedVertices.size === 0) {
      ctx.setMessage("select vertices before deleting vertices");
      return;
    }
    ctx.pushUndo("delete vertices");
    const removedVertices = new Set(editor.selectedVertices);
    editor.faces = editor.faces.filter((face) => !face.indices.some((vertexId) => removedVertices.has(vertexId)));
    editor.vertices = editor.vertices.filter((vertex) => !removedVertices.has(vertex.id));
    ctx.clearSelection();
    ctx.rebuildScene();
    ctx.setMessage("deleted vertices");
  }

  // 現在の Edit Mode tool に合わせて削除対象を決める
  // Face Select では face だけ、Vertex Select / Add Vertex では vertex と参照 face を削除する
  function deleteSelected() {
    const { editor } = ctx;
    if (!ctx.isEditMode()) {
      ctx.setMessage("switch to edit mode before deleting vertices or faces");
      return;
    }
    if (editor.selectedVertices.size === 0 && editor.selectedFaces.size === 0) {
      ctx.setMessage("nothing selected");
      return;
    }
    if (editor.tool === "selectFace") {
      deleteSelectedFaces();
      return;
    }
    deleteSelectedVertices();
  }

  // 選択 vertex から face を作成する
  // size を指定した場合は Triangle / Quad の旧 UI と同じく厳密に個数を確認し、
  // size を省略した場合は Blender の F と同様に 3 点なら三角形、4 点なら四角形として扱う
  function makeFaceFromSelection(size = null) {
    const { editor } = ctx;
    if (!ctx.isEditMode()) {
      ctx.setMessage("switch to edit mode before creating faces");
      return;
    }
    const ids = Array.from(editor.selectedVertices);
    const expectedSize = size ?? ids.length;
    if (expectedSize !== 3 && expectedSize !== 4) {
      ctx.setMessage("Face requires 3 or 4 selected vertices");
      return;
    }
    if (ids.length !== expectedSize) {
      ctx.setMessage(`${expectedSize === 3 ? "Triangle" : "Quad"} requires ${expectedSize} selected vertices`);
      return;
    }
    ctx.pushUndo(`make ${expectedSize === 3 ? "triangle" : "quad"}`);
    const orientedIds = ctx.orderVertexIdsForFaceFromView(ids);
    const faceId = ctx.addFaceWithStableOrientation(orientedIds);
    editor.selectedFaces = new Set([faceId]);
    ctx.rebuildScene();
    ctx.setMessage(`created front-facing face ${faceId}`);
  }

  // editOperations の extrusion 作成処理を transform から呼べるよう中継する
  function createExtrusion(distance) {
    const { editor } = ctx;
    const selectedFaces = ctx.getSelectedFaceObjects();
    if (selectedFaces.length === 0) {
      return null;
    }
    const mirrorExtrusion = ctx.getXMirrorExtrusionFaces?.(selectedFaces) ?? {
      faces: selectedFaces,
      mirrorFaceIds: new Set(),
      vertexPairs: []
    };
    const faces = mirrorExtrusion.faces;
    const mirrorBaseVertexIds = new Set(mirrorExtrusion.vertexPairs.map((pair) => pair.mirrorId));
    const newFaceIds = [];
    const topNewFaceIds = new Set();
    const sourceTopNewFaceIds = new Set();
    const newVertexIds = new Set();
    const sourceNewVertexIds = new Set();
    const extrudeVertexNormals = new Map();
    const baseFaceIds = new Set(faces.map((face) => face.id));
    const buildDistance = Math.abs(distance) > 1.0e-8
      ? distance
      : Math.max(0.001, ctx.getEditorBounds().size * 0.0001);
    const resetTopVertices = Math.abs(distance) <= 1.0e-8;
    const topBasePositions = new Map();
    const selectedVertexIds = new Set();
    const vertexNormalSums = new Map();
    const edgeRecords = new Map();
    // edge の向きに依存せず同じ共有辺として集計するための key を作る
    const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;

    // Blender の region extrude と同様に、選択 face 群を 1 つの領域として扱う
    // 選択 face 同士が共有する edge は内部 edge なので側面を作らず、
    // 1 枚の選択 face にしか属さない boundary edge だけから側面を作る
    for (const face of faces) {
      const normal = ctx.computeFaceNormal(face);
      for (const vertexId of face.indices) {
        selectedVertexIds.add(vertexId);
        const sum = vertexNormalSums.get(vertexId) ?? [0.0, 0.0, 0.0];
        sum[0] += normal[0];
        sum[1] += normal[1];
        sum[2] += normal[2];
        vertexNormalSums.set(vertexId, sum);
      }
      for (let i = 0; i < face.indices.length; i++) {
        const a = face.indices[i];
        const b = face.indices[(i + 1) % face.indices.length];
        const key = edgeKey(a, b);
        if (!edgeRecords.has(key)) {
          edgeRecords.set(key, []);
        }
        edgeRecords.get(key).push({ face, a, b });
      }
    }

    const topByBaseVertex = new Map();
    for (const vertexId of selectedVertexIds) {
      const vertex = ctx.getVertexById(vertexId);
      if (!vertex) {
        throw new Error(`selected face references missing vertex ${vertexId}`);
      }
      const sum = vertexNormalSums.get(vertexId) ?? ctx.computeSelectionNormal();
      const len = Math.hypot(sum[0], sum[1], sum[2]);
      const normal = len > 1.0e-9
        ? [sum[0] / len, sum[1] / len, sum[2] / len]
        : ctx.computeSelectionNormal();
      const id = ctx.addVertex(add3(vertex.position, mul3(normal, buildDistance)));
      topByBaseVertex.set(vertexId, id);
      newVertexIds.add(id);
      if (!mirrorBaseVertexIds.has(vertexId)) {
        sourceNewVertexIds.add(id);
      }
      extrudeVertexNormals.set(id, normal);
      topBasePositions.set(id, [...vertex.position]);
    }
    const mirrorTopVertexPairs = mirrorExtrusion.vertexPairs
      .map((pair) => ({
        sourceId: topByBaseVertex.get(pair.sourceId),
        mirrorId: topByBaseVertex.get(pair.mirrorId)
      }))
      .filter((pair) => pair.sourceId !== undefined && pair.mirrorId !== undefined);

    const regionVertices = Array.from(selectedVertexIds)
      .map((id) => ctx.getVertexById(id))
      .filter((vertex) => vertex !== null);
    const regionCenter = ctx.computeCenter(regionVertices);

    for (const face of faces) {
      const normal = ctx.computeFaceNormal(face);
      const top = face.indices.map((vertexId) => topByBaseVertex.get(vertexId));
      if (top.some((vertexId) => vertexId === undefined)) {
        throw new Error(`extrude face ${face.id} is missing duplicated top vertices`);
      }
      const faceId = ctx.addFaceOrientedToDirection(top, normal);
      newFaceIds.push(faceId);
      topNewFaceIds.add(faceId);
      if (!mirrorExtrusion.mirrorFaceIds.has(face.id)) {
        sourceTopNewFaceIds.add(faceId);
      }
    }

    for (const records of edgeRecords.values()) {
      if (records.length !== 1) {
        continue;
      }
      const { a, b } = records[0];
      const topA = topByBaseVertex.get(a);
      const topB = topByBaseVertex.get(b);
      if (topA === undefined || topB === undefined) {
        throw new Error(`extrude boundary edge ${a}-${b} is missing duplicated top vertices`);
      }
      const sideLoop = [a, b, topB, topA];
      const sideVertices = sideLoop
        .map((id) => ctx.getVertexById(id))
        .filter((vertex) => vertex !== null);
      const sideCenter = ctx.computeCenter(sideVertices);
      const faceId = ctx.addFaceOrientedToDirection(sideLoop, sub3(sideCenter, regionCenter));
      newFaceIds.push(faceId);
    }

    // Region extrude では元の選択面は押し出し後の内部面になるため削除する。
    // 元の頂点は boundary side face が参照するので、face だけを取り除く。
    editor.faces = editor.faces.filter((face) => !baseFaceIds.has(face.id));

    if (resetTopVertices) {
      for (const [id, position] of topBasePositions.entries()) {
        const vertex = ctx.getVertexById(id);
        if (vertex) {
          vertex.position = position;
        }
      }
    }
    ctx.addExplicitXMirrorVertexPairs?.(mirrorTopVertexPairs);
    editor.selectedVertices = sourceNewVertexIds;
    editor.selectedFaces = mirrorTopVertexPairs.length > 0
      ? sourceTopNewFaceIds
      : topNewFaceIds;
    return {
      newVertexIds,
      sourceNewVertexIds,
      topNewFaceIds,
      sourceTopNewFaceIds,
      mirrorTopVertexPairs,
      newFaceIds,
      extrudeVertexNormals
    };
  }

  // editOperations の即時 extrude 処理を呼び出す
  function extrudeSelectedFaces() {
    const faces = ctx.getSelectedFaceObjects();
    if (faces.length === 0) {
      ctx.setMessage("select face before extrude");
      return;
    }
    ctx.pushUndo("extrude faces");
    const bounds = ctx.getEditorBounds();
    const distance = Math.max(0.25, bounds.size * 0.18);
    // editOperations の extrusion 作成処理を transform から呼べるよう中継する
    createExtrusion(distance);
    ctx.rebuildScene();
    ctx.setMessage(`extruded ${faces.length} face(s)`);
  }

  // editOperations の face 反転処理を呼び出す
  function flipSelectedFaces() {
    if (!ctx.isEditMode()) {
      ctx.setMessage("switch to edit mode before flipping faces");
      return;
    }
    const faces = ctx.getSelectedFaceObjects();
    if (faces.length === 0) {
      ctx.setMessage("select face before flip");
      return;
    }
    ctx.pushUndo("flip face orientation");
    for (const face of faces) {
      face.indices = ctx.reverseVertexLoop(face.indices);
    }
    ctx.rebuildScene();
    ctx.setMessage(`flipped ${faces.length} face(s)`);
  }

  // 四角面列に loop cut を入れる
  // 選択 face は loop cut の開始点として扱い、cut が通る対辺方向へ隣接 quad をたどる
  // 共有辺の中点 vertex は隣接 face と再利用するため、未選択の隣接 face も同じ loop 上なら連続して分割される
  function loopCutSelectedFaces(options = {}) {
    const { editor } = ctx;
    if (!ctx.isEditMode()) {
      ctx.setMessage("switch to edit mode before loop cut");
      return;
    }
    const selectedFaces = ctx.getSelectedFaceObjects();
    if (selectedFaces.length === 0) {
      ctx.setMessage("select quad faces before loop cut");
      return;
    }
    const selectedFaceIds = new Set(selectedFaces.map((face) => face.id));
    const planByFaceId = new Map();
    const edgeOwners = new Map();
    const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
    const oppositeEdgeIndex = (edgeIndex) => (edgeIndex + 2) % 4;

    // 全 face の edge 所有者を先に集計する
    // ループカットは選択 face だけで終わらず、同じ edge loop 上の未選択 face へ伝播するため全体を対象にする
    for (const face of editor.faces) {
      for (let i = 0; i < face.indices.length; i++) {
        const a = face.indices[i];
        const b = face.indices[(i + 1) % face.indices.length];
        const key = edgeKey(a, b);
        const owners = edgeOwners.get(key) ?? [];
        owners.push({ face, edgeIndex: i });
        edgeOwners.set(key, owners);
      }
    }

    // 開始点として選択された face は quad であることを要求する
    // 三角面が混ざると「対辺の中点をつなぐ」という loop cut の定義が崩れるためここで止める
    for (const face of selectedFaces) {
      if (face.indices.length !== 4) {
        ctx.setMessage("loop cut requires quad faces");
        return;
      }
    }

    // 単独 quad では、長い向きを半分にするよう cut edge を選ぶ
    // 長辺の中点同士を結ぶと短辺方向に分割されるため、見た目として自然な 2 分割になりやすい
    function chooseDefaultCutEdge(face) {
      const edgeLengths = [];
      for (let i = 0; i < 4; i++) {
        const a = ctx.getVertexById(face.indices[i]);
        const b = ctx.getVertexById(face.indices[(i + 1) % 4]);
        if (!a || !b) {
          throw new Error(`loop cut face ${face.id} references missing vertex`);
        }
        const dx = a.position[0] - b.position[0];
        const dy = a.position[1] - b.position[1];
        const dz = a.position[2] - b.position[2];
        edgeLengths.push(dx * dx + dy * dy + dz * dz);
      }
      const pair02 = edgeLengths[0] + edgeLengths[2];
      const pair13 = edgeLengths[1] + edgeLengths[3];
      return pair02 >= pair13 ? 0 : 1;
    }

    function isSameCutPair(a, b) {
      return a === b || oppositeEdgeIndex(a) === b;
    }

    function addCutPlan(face, cutEdge) {
      if (face.indices.length !== 4) {
        return true;
      }
      const existing = planByFaceId.get(face.id);
      if (existing) {
        if (!isSameCutPair(existing.cutEdge, cutEdge)) {
          ctx.setMessage("loop cut reached the same face from incompatible directions");
          return false;
        }
        return true;
      }
      planByFaceId.set(face.id, { face, cutEdge });
      return true;
    }

    // 選択 face ごとに、どの対辺ペアの中点を結ぶか決定する
    // 単独 face の場合は pointer hover で選んだ cutEdgeIndex を優先し、
    // 複数 face を選択している場合は選択 face 同士の共有辺から cut 方向を推定する
    for (const face of selectedFaces) {
      const neighborEdges = [];
      for (let i = 0; i < 4; i++) {
        const a = face.indices[i];
        const b = face.indices[(i + 1) % 4];
        const owners = edgeOwners.get(edgeKey(a, b)) ?? [];
        if (owners.some((owner) => owner.face.id !== face.id && selectedFaceIds.has(owner.face.id))) {
          neighborEdges.push(i);
        }
      }
      let cutEdge = null;
      if (
        selectedFaces.length === 1
        && Number.isInteger(options.cutEdgeIndex)
        && options.cutEdgeIndex >= 0
        && options.cutEdgeIndex < 4
      ) {
        cutEdge = options.cutEdgeIndex;
      } else if (neighborEdges.length === 0) {
        cutEdge = chooseDefaultCutEdge(face);
      } else if (neighborEdges.length === 1) {
        cutEdge = neighborEdges[0];
      } else if (
        neighborEdges.length === 2
        && oppositeEdgeIndex(neighborEdges[0]) === neighborEdges[1]
      ) {
        cutEdge = Math.min(neighborEdges[0], neighborEdges[1]);
      } else {
        ctx.setMessage("loop cut selection must be a straight quad strip or ring");
        return;
      }
      if (!addCutPlan(face, cutEdge)) {
        return;
      }
    }

    // 選択 face を起点に、cut が通る 2 本の対辺から隣接 quad へ処理を伝播する
    // 各隣接 face では共有辺とその対辺を中点接続するため、カット線が途切れずに続く
    const queue = Array.from(planByFaceId.values());
    for (let index = 0; index < queue.length; index++) {
      const { face, cutEdge } = queue[index];
      for (const edgeIndex of [cutEdge, oppositeEdgeIndex(cutEdge)]) {
        const a = face.indices[edgeIndex];
        const b = face.indices[(edgeIndex + 1) % 4];
        const owners = edgeOwners.get(edgeKey(a, b)) ?? [];
        if (owners.length > 2) {
          ctx.setMessage("loop cut does not support non-manifold edges");
          return;
        }
        for (const owner of owners) {
          if (owner.face.id === face.id) {
            continue;
          }
          if (owner.face.indices.length !== 4) {
            continue;
          }
          const beforeSize = planByFaceId.size;
          if (!addCutPlan(owner.face, owner.edgeIndex)) {
            return;
          }
          if (planByFaceId.size > beforeSize) {
            queue.push(planByFaceId.get(owner.face.id));
          }
        }
      }
    }

    ctx.pushUndo("loop cut faces");
    const cutPlans = Array.from(planByFaceId.values());
    const midpointByEdge = new Map();
    const newFaceIds = [];
    const removedFaceIds = new Set(cutPlans.map((plan) => plan.face.id));

    // 辺の中点 vertex を作る。同じ選択 edge は 1 つの vertex を共有する
    function getOrCreateMidpoint(aId, bId) {
      const key = edgeKey(aId, bId);
      const existing = midpointByEdge.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const a = ctx.getVertexById(aId);
      const b = ctx.getVertexById(bId);
      if (!a || !b) {
        throw new Error(`loop cut edge ${aId}-${bId} references missing vertex`);
      }
      const id = ctx.addVertex(mul3(add3(a.position, b.position), 0.5));
      midpointByEdge.set(key, id);
      return id;
    }

    for (const { face, cutEdge } of cutPlans) {
      const loop = face.indices;
      const a = loop[cutEdge];
      const b = loop[(cutEdge + 1) % 4];
      const c = loop[(cutEdge + 2) % 4];
      const d = loop[(cutEdge + 3) % 4];
      const ab = getOrCreateMidpoint(a, b);
      const cd = getOrCreateMidpoint(c, d);
      newFaceIds.push(ctx.addFace([a, ab, cd, d]));
      newFaceIds.push(ctx.addFace([ab, b, c, cd]));
    }

    editor.faces = editor.faces.filter((face) => !removedFaceIds.has(face.id));
    editor.selectedVertices = new Set(Array.from(midpointByEdge.values()));
    editor.selectedFaces = new Set(newFaceIds);
    ctx.rebuildScene();
    ctx.setMessage(`loop cut ${cutPlans.length} quad face(s)`);
  }

  // keyboard 補助移動を editOperations へ中継する
  function moveActiveVerticesBy(delta, label) {
    if (!ctx.isEditMode()) {
      ctx.setMessage("switch to edit mode before keyboard edit");
      return false;
    }
    const vertices = ctx.getActiveVertexObjects();
    if (vertices.length === 0) {
      ctx.setMessage("select vertices or faces before keyboard edit");
      return false;
    }
    ctx.pushUndo(label);
    const initialPositions = new Map(vertices.map((vertex) => [
      vertex,
      [...vertex.position]
    ]));
    for (const vertex of vertices) {
      vertex.position = add3(vertex.position, delta);
    }
    ctx.applyXMirrorEdit?.(vertices, initialPositions);
    ctx.rebuildScene();
    ctx.setMessage(label);
    return true;
  }

  // screen 平面 keyboard 移動を editOperations へ中継する
  function moveSelectionByScreenKeys(stepX, stepY) {
    const basis = ctx.getCameraScreenBasis();
    const step = getKeyboardEditStep();
    const delta = add3(
      // vec3 を scalar 倍する
      mul3(basis.right, stepX * step),
      // vec3 を scalar 倍する
      mul3(basis.up, stepY * step)
    );
    return moveActiveVerticesBy(delta, "keyboard move screen");
  }

  // 法線方向 keyboard 移動を editOperations へ中継する
  function moveSelectionByNormalKey(direction) {
    const step = getKeyboardEditStep();
    const normal = ctx.computeSelectionNormal();
    return moveActiveVerticesBy(mul3(normal, direction * step), "keyboard move normal");
  }

  // keyboard scale を editOperations へ中継する
  function scaleSelectionByKeyboard(factor) {
    if (!ctx.isEditMode()) {
      ctx.setMessage("switch to edit mode before keyboard scale");
      return false;
    }
    const vertices = ctx.getActiveVertexObjects();
    if (vertices.length === 0) {
      ctx.setMessage("select vertices or faces before keyboard scale");
      return false;
    }
    ctx.pushUndo("keyboard scale selection");
    const center = ctx.computeCenter(vertices);
    const initialPositions = new Map(vertices.map((vertex) => [
      vertex,
      [...vertex.position]
    ]));
    for (const vertex of vertices) {
      vertex.position = add3(
        center,
        // vec3 を scalar 倍する
        mul3(sub3(vertex.position, center), factor)
      );
    }
    ctx.applyXMirrorEdit?.(vertices, initialPositions);
    ctx.rebuildScene();
    ctx.setMessage(`keyboard scale ${factor.toFixed(2)}`);
    return true;
  }

  return {
    createExtrusion,
    deleteSelected,
    deleteSelectedFaces,
    deleteSelectedVertices,
    extrudeSelectedFaces,
    flipSelectedFaces,
    loopCutSelectedFaces,
    makeFaceFromSelection,
    moveActiveVerticesBy,
    moveSelectionByNormalKey,
    moveSelectionByScreenKeys,
    scaleSelectionByKeyboard
  };
}
