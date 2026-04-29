// ---------------------------------------------
// samples/webgmodeler/editOperations.js  2026/04/29
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
    makeFaceFromSelection,
    moveActiveVerticesBy,
    moveSelectionByNormalKey,
    moveSelectionByScreenKeys,
    scaleSelectionByKeyboard
  };
}
