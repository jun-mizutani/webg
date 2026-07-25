// ---------------------------------------------
// samples/mmodeler/EditModeController.js  2026/05/25
//   edit mode controller for mmodeler
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import { add3, cross3, dot3, length3, mul3, normalize3, sub3 } from "./math3d.js";

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`EditModeController requires ${name}`);
  }
  return value;
}

// Edit Mode の操作状態と geometry command を扱う
// active object 由来の mesh は editSession として内部に保持し、commit 境界で scene へ反映する
export default class EditModeController {
  constructor({
    scene,
    objectModeName,
    editModeName,
    faceToolName,
    normalizeToolName,
    setEditorMode,
    setMessage,
    rebuildScene,
    refreshSelectionVisuals,
    pushUndo,
    markMarkerOverlayDirty,
    getXMirrorEdit,
    setXMirrorEdit,
    orderVertexIdsForFaceFromView,
    getCameraScreenBasis
  }) {
    if (!scene) {
      throw new Error("EditModeController requires scene");
    }
    this.scene = scene;
    this.objectModeName = objectModeName;
    this.editModeName = editModeName;
    this.faceToolName = faceToolName;
    this.loopCutPreview = {
      active: false,
      faceId: null,
      cutEdgeIndex: 0,
      lastClientX: 0.0,
      lastClientY: 0.0
    };
    this.chainSelectPreview = {
      active: false,
      seedVertexId: null,
      directionNeighborId: null,
      candidateVertexIds: [],
      lastClientX: 0.0,
      lastClientY: 0.0
    };
    this.normalizeToolName = requireFunction(normalizeToolName, "normalizeToolName");
    this.setEditorMode = requireFunction(setEditorMode, "setEditorMode");
    this.setMessage = requireFunction(setMessage, "setMessage");
    this.rebuildScene = requireFunction(rebuildScene, "rebuildScene");
    this.refreshSelectionVisuals = requireFunction(refreshSelectionVisuals, "refreshSelectionVisuals");
    this.pushUndo = requireFunction(pushUndo, "pushUndo");
    this.markMarkerOverlayDirty = requireFunction(markMarkerOverlayDirty, "markMarkerOverlayDirty");
    this.getXMirrorEdit = requireFunction(getXMirrorEdit, "getXMirrorEdit");
    this.setXMirrorEdit = requireFunction(setXMirrorEdit, "setXMirrorEdit");
    this.orderVertexIdsForFaceFromView = requireFunction(orderVertexIdsForFaceFromView, "orderVertexIdsForFaceFromView");
    this.getCameraScreenBasis = requireFunction(getCameraScreenBasis, "getCameraScreenBasis");
    this.explicitXMirrorVertexPairs = new Map();
    this.editSession = null;
    this.transformSession = null;
  }

  cloneVertices(vertices) {
    return vertices.map((vertex) => ({
      id: vertex.id,
      position: [...vertex.position]
    }));
  }

  cloneFaces(faces) {
    return faces.map((face) => ({
      id: face.id,
      indices: [...face.indices]
    }));
  }

  createSessionFromObject(object, options = {}) {
    if (!object) {
      return {
        objectId: null,
        mode: this.editModeName,
        tool: options.tool ?? this.tool,
        vertices: [],
        faces: [],
        selectedVertices: new Set(options.selectedVertices ?? []),
        selectedFaces: new Set(options.selectedFaces ?? []),
        lastSelectedVertexId: options.lastSelectedVertexId ?? null,
        nextVertexId: options.nextVertexId ?? 1,
        nextFaceId: options.nextFaceId ?? 1
      };
    }
    return {
      objectId: object.id,
      mode: this.editModeName,
      tool: options.tool ?? this.tool,
      vertices: this.cloneVertices(object.vertices),
      faces: this.cloneFaces(object.faces),
      selectedVertices: new Set(options.selectedVertices ?? []),
      selectedFaces: new Set(options.selectedFaces ?? []),
      lastSelectedVertexId: options.lastSelectedVertexId ?? null,
      nextVertexId: options.nextVertexId ?? object.nextVertexId,
      nextFaceId: options.nextFaceId ?? object.nextFaceId
    };
  }

  syncSceneModeBridge() {
    if (!this.editSession) {
      return;
    }
    this.scene.mode = this.editSession.mode;
    this.scene.tool = this.editSession.tool;
  }

  // Edit Mode 中は controller 内部の session state を返す
  // session がまだ無い起動直後や Object Mode 中は、既存処理との互換のため ModelerScene field を返す
  getEditMeshState() {
    return this.editSession ?? this.scene;
  }

  // 描画や hit test が読む Edit Mode mesh state を返す
  // 現段階では編集用 state と同じものを返すが、将来は commit 用 state と描画用 bridge を分ける入口になる
  getRenderableEditMeshState() {
    return this.getEditMeshState();
  }

  // undo / redo snapshot が保存する Edit Mode 側の state を plain data として返す
  // object list や active object の保存は scene 全体の責務なのでここでは扱わず、
  // EditModeController が将来内部 state を持ったときに差し替える必要がある mesh 編集 state だけを集める
  createEditMeshSnapshot() {
    const state = this.getEditMeshState();
    return {
      mode: state.mode,
      tool: state.tool,
      selectedVertices: Array.from(state.selectedVertices),
      selectedFaces: Array.from(state.selectedFaces),
      lastSelectedVertexId: state.lastSelectedVertexId,
      nextVertexId: state.nextVertexId,
      nextFaceId: state.nextFaceId,
      explicitXMirrorVertexPairs: Array.from(this.explicitXMirrorVertexPairs.entries())
    };
  }

  // undo / redo snapshot から Edit Mode 側の state を復元する
  // object list と active object の接続は scene 全体の責務なのでここでは扱わず、
  // mode、selection、採番 counter のような mesh 編集 state だけを適用する
  restoreEditMeshSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("restoreEditMeshSnapshot requires a snapshot object");
    }
    if ((snapshot.mode ?? this.scene.mode) === this.editModeName && !this.editSession) {
      this.enterEditMode({
        tool: snapshot.tool ?? this.scene.tool,
        selectedVertices: snapshot.selectedVertices ?? [],
        selectedFaces: snapshot.selectedFaces ?? [],
        lastSelectedVertexId: snapshot.lastSelectedVertexId ?? null,
        nextVertexId: snapshot.nextVertexId,
        nextFaceId: snapshot.nextFaceId
      });
    }
    const state = this.getEditMeshState();
    state.mode = snapshot.mode ?? state.mode;
    state.tool = snapshot.tool ?? state.tool;
    state.selectedVertices = new Set(snapshot.selectedVertices ?? []);
    state.selectedFaces = new Set(snapshot.selectedFaces ?? []);
    state.lastSelectedVertexId = snapshot.lastSelectedVertexId ?? null;
    state.nextVertexId = snapshot.nextVertexId ?? state.nextVertexId;
    state.nextFaceId = snapshot.nextFaceId ?? state.nextFaceId;
    this.explicitXMirrorVertexPairs = new Map(snapshot.explicitXMirrorVertexPairs ?? []);
    if (state.mode !== this.editModeName) {
      this.editSession = null;
      this.scene.mode = state.mode;
      return;
    }
    this.syncSceneModeBridge();
  }

  get mode() {
    return this.getEditMeshState().mode;
  }

  get tool() {
    return this.getEditMeshState().tool;
  }

  set tool(value) {
    this.getEditMeshState().tool = value;
    this.syncSceneModeBridge();
  }

  get vertices() {
    return this.getEditMeshState().vertices;
  }

  get faces() {
    return this.getEditMeshState().faces;
  }

  set faces(value) {
    this.getEditMeshState().faces = value;
    this.syncSceneModeBridge();
  }

  get selectedVertices() {
    return this.getEditMeshState().selectedVertices;
  }

  set selectedVertices(value) {
    this.getEditMeshState().selectedVertices = value;
    this.syncSceneModeBridge();
  }

  get selectedFaces() {
    return this.getEditMeshState().selectedFaces;
  }

  set selectedFaces(value) {
    this.getEditMeshState().selectedFaces = value;
    this.syncSceneModeBridge();
  }

  get lastSelectedVertexId() {
    return this.getEditMeshState().lastSelectedVertexId;
  }

  set lastSelectedVertexId(value) {
    this.getEditMeshState().lastSelectedVertexId = value;
    this.syncSceneModeBridge();
  }

  nextVertexId() {
    const state = this.getEditMeshState();
    const id = state.nextVertexId;
    state.nextVertexId += 1;
    this.syncSceneModeBridge();
    return id;
  }

  nextFaceId() {
    const state = this.getEditMeshState();
    const id = state.nextFaceId;
    state.nextFaceId += 1;
    this.syncSceneModeBridge();
    return id;
  }

  syncSelectedFacesFromVertices() {
    const state = this.getEditMeshState();
    state.selectedFaces.clear();
    if (state.selectedVertices.size < 3) {
      return;
    }
    for (const face of state.faces) {
      if (face.indices.every((id) => state.selectedVertices.has(id))) {
        state.selectedFaces.add(face.id);
      }
    }
    this.syncSceneModeBridge();
  }

  syncSelectedVerticesFromFaces(faces) {
    const state = this.getEditMeshState();
    state.selectedVertices.clear();
    for (const face of faces) {
      for (const id of face.indices) {
        state.selectedVertices.add(id);
      }
    }
    if (state.lastSelectedVertexId !== null && !state.selectedVertices.has(state.lastSelectedVertexId)) {
      state.lastSelectedVertexId = null;
    }
    this.syncSceneModeBridge();
  }

  // Edit Mode の内部 mesh session を active object へ反映する
  // ModelerScene の edit mesh 互換 field へは mode / tool だけを残し、geometry は active object へ commit する
  commitEditMeshState() {
    if (!this.editSession) {
      return this.scene.commitActiveObject();
    }
    const object = this.scene.objects.find((entry) => entry.id === this.editSession.objectId) ?? null;
    if (!object) {
      return false;
    }
    object.vertices = this.cloneVertices(this.editSession.vertices);
    object.faces = this.cloneFaces(this.editSession.faces);
    object.nextVertexId = this.editSession.nextVertexId;
    object.nextFaceId = this.editSession.nextFaceId;
    if (this.scene.activeObjectId === object.id) {
      this.scene.vertices = object.vertices;
      this.scene.faces = object.faces;
      this.scene.nextVertexId = object.nextVertexId;
      this.scene.nextFaceId = object.nextFaceId;
    }
    this.syncSceneModeBridge();
    return true;
  }

  // Edit Mode へ入ったことを state に記録する
  // active object の mesh clone を controller 内部 session として保持する
  enterEditMode(options = {}) {
    const object = options.object ?? this.scene.getActiveObject();
    this.editSession = this.createSessionFromObject(object, {
      tool: options.tool ?? this.scene.tool,
      selectedVertices: options.selectedVertices,
      selectedFaces: options.selectedFaces,
      lastSelectedVertexId: options.lastSelectedVertexId,
      nextVertexId: options.nextVertexId,
      nextFaceId: options.nextFaceId
    });
    this.syncSceneModeBridge();
  }

  // Object Mode へ戻ったことを state に記録する
  // commit 済みの session を破棄し、Object Mode state へ戻す
  exitEditMode() {
    this.cancelLoopCutPreview();
    this.cancelChainSelectPreview();
    this.commitEditMeshState();
    this.editSession = null;
    this.scene.mode = this.objectModeName;
  }

  // New Scene / import のように、現在の Edit Mode session を保存せず scene 側で作り直す前処理
  discardEditSession(mode = this.objectModeName) {
    this.cancelLoopCutPreview();
    this.cancelChainSelectPreview();
    this.editSession = null;
    this.explicitXMirrorVertexPairs.clear();
    this.scene.mode = mode;
  }

  // Edit Mode の選択 / 追加 tool を切り替える
  // Object Mode から呼ばれた場合は、tool を先に保存してから Edit Mode へ入る
  setTool(tool) {
    this.tool = this.normalizeToolName(tool);
    if (this.mode !== this.editModeName) {
      this.setEditorMode(this.editModeName);
      return;
    }
    this.setMessage(`tool ${this.tool}`);
  }

  // X=0 平面を境にした対称編集を切り替える
  // marker overlay は mirror marker の表示に関係するため、状態変更時に dirty として扱う
  toggleXMirrorEdit() {
    const nextValue = !this.getXMirrorEdit();
    this.setXMirrorEdit(nextValue);
    this.markMarkerOverlayDirty();
    this.setMessage(`X mirror edit ${nextValue ? "on" : "off"}`);
  }

  // Edit Mode の削除操作を実行する
  // Face Select では face だけ、Vertex Select / Add Vertex では vertex と参照 face を削除する
  deleteSelected() {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before deleting vertices or faces");
      return;
    }
    if (this.selectedVertices.size === 0 && this.selectedFaces.size === 0) {
      this.setMessage("nothing selected");
      return;
    }
    if (this.tool === this.faceToolName) {
      this.deleteSelectedFaces();
      return;
    }
    this.deleteSelectedVertices();
  }

  // 選択 face だけを削除する
  deleteSelectedFaces() {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before deleting faces");
      return;
    }
    if (this.selectedFaces.size === 0) {
      this.setMessage("select faces before deleting faces");
      return;
    }
    this.pushUndo("delete faces");
    this.faces = this.faces.filter((face) => !this.selectedFaces.has(face.id));
    this.clearSelection();
    this.rebuildScene();
    this.setMessage("deleted faces");
  }

  // 選択 vertex と、その vertex を参照する face を削除する
  deleteSelectedVertices() {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before deleting vertices");
      return;
    }
    if (this.selectedVertices.size === 0) {
      this.setMessage("select vertices before deleting vertices");
      return;
    }
    this.pushUndo("delete vertices");
    const removedVertices = new Set(this.selectedVertices);
    this.faces = this.faces.filter((face) => !face.indices.some((vertexId) => removedVertices.has(vertexId)));
    this.getEditMeshState().vertices = this.vertices.filter((vertex) => !removedVertices.has(vertex.id));
    this.syncSceneModeBridge();
    this.clearSelection();
    this.rebuildScene();
    this.setMessage("deleted vertices");
  }

  // 選択 vertex から face を作成する
  // size 指定時は Triangle / Quad UI と同じく厳密に個数を確認する
  makeFaceFromSelection(size = null) {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before creating faces");
      return;
    }
    const ids = Array.from(this.selectedVertices);
    const expectedSize = size ?? ids.length;
    if (expectedSize !== 3 && expectedSize !== 4) {
      this.setMessage("Face requires 3 or 4 selected vertices");
      return;
    }
    if (ids.length !== expectedSize) {
      this.setMessage(`${expectedSize === 3 ? "Triangle" : "Quad"} requires ${expectedSize} selected vertices`);
      return;
    }
    this.pushUndo(`make ${expectedSize === 3 ? "triangle" : "quad"}`);
    const orientedIds = this.orderVertexIdsForFaceFromView(ids);
    const faceId = this.addFace(this.orientLoopByAdjacentFaces(orientedIds));
    this.selectedFaces = new Set([faceId]);
    this.rebuildScene();
    this.setMessage(`created front-facing face ${faceId}`);
  }

  // mobile palette の Add が face 作成として扱える選択状態かを判定する
  canMakeFaceFromSelection() {
    return this.mode === this.editModeName
        && (this.selectedVertices.size === 3 || this.selectedVertices.size === 4);
  }

  // Edit Mode の vertex / face selection を空にする
  clearSelection() {
    this.cancelLoopCutPreview();
    this.cancelChainSelectPreview();
    const state = this.getEditMeshState();
    state.selectedVertices.clear();
    state.selectedFaces.clear();
    state.lastSelectedVertexId = null;
    this.syncSceneModeBridge();
  }

  // vertex を選択または追加選択で切り替え、完全に含まれる face も同期する
  selectVertex(id, additive = false) {
    if (!additive) {
      this.clearSelection();
    }
    if (this.selectedVertices.has(id) && additive) {
      this.selectedVertices.delete(id);
      if (this.lastSelectedVertexId === id) {
        this.lastSelectedVertexId = null;
      }
    } else {
      this.selectedVertices.add(id);
      this.lastSelectedVertexId = id;
    }
    this.syncSelectedFacesFromVertices();
  }

  // face を選択または追加選択で切り替え、構成 vertex も同期する
  selectFace(id, additive = false) {
    if (!additive) {
      this.clearSelection();
    }
    const face = this.getFaceById(id);
    if (!face) {
      return;
    }
    if (this.selectedFaces.has(id) && additive) {
      this.selectedFaces.delete(id);
    } else {
      this.selectedFaces.add(id);
    }
    this.syncSelectedVerticesFromFaces(this.getSelectedFaceObjects());
  }

  // box select などで求めた vertex id 群を選択へ反映し、face 選択も同期する
  selectVerticesByIds(ids, additive = false) {
    if (!additive) {
      this.clearSelection();
    }
    for (const id of ids) {
      this.selectedVertices.add(id);
    }
    if (ids.length > 0) {
      this.lastSelectedVertexId = ids[ids.length - 1];
    }
    this.syncSelectedFacesFromVertices();
  }

  // box select などで求めた face id 群を選択へ反映し、構成 vertex も同期する
  selectFacesByIds(ids, additive = false) {
    if (!additive) {
      this.clearSelection();
    }
    for (const id of ids) {
      this.selectedFaces.add(id);
    }
    this.syncSelectedVerticesFromFaces(this.getSelectedFaceObjects());
  }

  // click selection の vertex 選択を反映し、選択 overlay だけを更新する
  selectVertexFromPick(id, additive = false) {
    this.selectVertex(id, additive);
    this.refreshSelectionVisuals();
    this.setMessage(`selected vertex ${id}`);
  }

  // click selection の face 選択を反映し、選択 overlay だけを更新する
  selectFaceFromPick(id, additive = false) {
    this.selectFace(id, additive);
    this.refreshSelectionVisuals();
    this.setMessage(`selected face ${id} with vertices`);
  }

  // empty click で Edit Mode selection を解除し、選択 overlay だけを更新する
  clearSelectionFromPick() {
    this.clearSelection();
    this.refreshSelectionVisuals();
    this.setMessage("selection cleared");
  }

  // box select の vertex id 群を反映し、選択 overlay だけを更新する
  selectVerticesByIdsFromBox(ids, additive = false) {
    this.selectVerticesByIds(ids, additive);
    this.refreshSelectionVisuals();
    this.setMessage(`box selected vertices ${ids.length}`);
    return ids.length;
  }

  // box select の face id 群を反映し、選択 overlay だけを更新する
  selectFacesByIdsFromBox(ids, additive = false) {
    this.selectFacesByIds(ids, additive);
    this.refreshSelectionVisuals();
    this.setMessage(`box selected faces ${ids.length}`);
    return ids.length;
  }

  // Edit Mode の全 vertex を選択し、完全に含まれる face も同期する
  selectAll() {
    this.selectedVertices = new Set(this.vertices.map((vertex) => vertex.id));
    this.lastSelectedVertexId = this.vertices.length > 0
      ? this.vertices[this.vertices.length - 1].id
      : null;
    this.syncSelectedFacesFromVertices();
    this.rebuildScene();
    this.setMessage(`selected all vertices (${this.selectedVertices.size})`);
  }

  // 現在の edit tool に合わせて vertex または face の選択状態を反転する
  invertSelection() {
    if (this.tool === this.faceToolName) {
      const next = new Set();
      for (const face of this.faces) {
        if (!this.selectedFaces.has(face.id)) {
          next.add(face.id);
        }
      }
      this.selectedFaces = next;
      this.syncSelectedVerticesFromFaces(this.getSelectedFaceObjects());
      this.rebuildScene();
      this.setMessage(`inverted faces (${this.selectedFaces.size})`);
      return;
    }
    const next = new Set();
    for (const vertex of this.vertices) {
      if (!this.selectedVertices.has(vertex.id)) {
        next.add(vertex.id);
      }
    }
    this.selectedVertices = next;
    this.lastSelectedVertexId = this.getLastSelectedVertexIdFromGeometry();
    this.syncSelectedFacesFromVertices();
    this.rebuildScene();
    this.setMessage(`inverted vertices (${this.selectedVertices.size})`);
  }

  // 現在の edit tool に合わせて X<0 側の vertex または face を選択する
  selectXNegative() {
    if (this.tool === this.faceToolName) {
      this.selectedFaces = new Set(
        this.faces
          .filter((face) => (this.getFaceCenter(face)?.[0] ?? Infinity) < 0.0)
          .map((face) => face.id)
      );
      this.syncSelectedVerticesFromFaces(this.getSelectedFaceObjects());
      this.rebuildScene();
      this.setMessage(`selected X<0 faces (${this.selectedFaces.size})`);
      return;
    }
    this.selectedVertices = new Set(
      this.vertices
        .filter((vertex) => vertex.position[0] < 0.0)
        .map((vertex) => vertex.id)
    );
    this.lastSelectedVertexId = this.getLastSelectedVertexIdFromGeometry();
    this.syncSelectedFacesFromVertices();
    this.rebuildScene();
    this.setMessage(`selected X<0 vertices (${this.selectedVertices.size})`);
  }

  selectLoop() {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before SelectLoop");
      return;
    }
    const seeds = this.getActiveVertexObjects();
    if (seeds.length === 0) {
      this.setMessage("select a midpoint vertex before SelectLoop");
      return;
    }
    const neighborIdsByVertexId = this.buildNeighborIdsByVertexId();
    const selectedIds = new Set();
    const queued = new Set();
    const queue = [];
    let seedTargetCount = 0;
    let expandedTargetCount = 0;
    let enqueueCount = 0;
    const enqueue = (vertexId, incomingVertexId = null) => {
      const key = `${vertexId}:${incomingVertexId ?? ""}`;
      if (queued.has(key)) {
        return;
      }
      queued.add(key);
      queue.push({ vertexId, incomingVertexId });
      enqueueCount += 1;
    };
    for (const seed of seeds) {
      const counterpartIds = this.getLoopSelectCounterpartMiddleIds(seed, { neighborIdsByVertexId });
      seedTargetCount += counterpartIds.targetCount;
      if (counterpartIds.ids.length === 0) {
        continue;
      }
      selectedIds.add(seed.id);
      for (const neighborId of counterpartIds.ids) {
        enqueue(neighborId, seed.id);
      }
    }
    while (queue.length > 0) {
      const { vertexId, incomingVertexId } = queue.shift();
      const vertex = this.getVertexById(vertexId);
      if (!vertex) {
        continue;
      }
      const counterpartIds = this.getLoopSelectCounterpartMiddleIds(vertex, {
        neighborIdsByVertexId,
        incomingVertexId
      });
      if (counterpartIds.ids.length === 0) {
        continue;
      }
      selectedIds.add(vertex.id);
      expandedTargetCount += counterpartIds.targetCount;
      for (const neighborId of counterpartIds.ids) {
        if (!selectedIds.has(neighborId)) {
          enqueue(neighborId, vertex.id);
        }
      }
    }
    if (selectedIds.size === 0) {
      this.setMessage(`SelectLoop no targets: seeds ${seeds.length}`);
      return;
    }
    this.selectedVertices = selectedIds;
    this.lastSelectedVertexId = this.getLastSelectedVertexIdFromGeometry();
    this.syncSelectedFacesFromVertices();
    this.rebuildScene();
    this.setMessage(`SelectLoop v${this.selectedVertices.size} seeds${seeds.length} t${seedTargetCount}/${expandedTargetCount} q${enqueueCount}`);
  }

  // Chain Select は、任意の選択 vertex から隣接 edge の方向を選び、
  // 同じ方向へ連続する vertex 列を preview 後にまとめて選択する
  // Loop Select が loop cut 後の中点列専用であるのに対し、この command は中点判定を使わない
  runChainSelectCommand() {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before Chain Select");
      return false;
    }
    const seed = this.getChainSelectSeedVertex();
    if (!seed) {
      this.setMessage("select a vertex before Chain Select");
      return false;
    }
    this.cancelLoopCutPreview();
    const neighborIds = Array.from(this.buildNeighborIdsByVertexId().get(seed.id) ?? []);
    if (neighborIds.length === 0) {
      this.setMessage("Chain Select requires connected vertex");
      return false;
    }
    this.startChainSelectPreview(seed.id);
    this.setMessage("Chain Select preview: drag near a direction, tap to confirm");
    return true;
  }

  // 複数 vertex が選ばれている場合でも開始点を 1 つに絞る
  // 最後に選択された vertex が分かる場合はそれを優先し、なければ geometry 上で最後の選択 vertex を使う
  getChainSelectSeedVertex() {
    const preferredId = this.lastSelectedVertexId ?? this.getLastSelectedVertexIdFromGeometry();
    if (preferredId !== null && this.selectedVertices.has(preferredId)) {
      return this.getVertexById(preferredId);
    }
    return this.getActiveVertexObjects()[0] ?? null;
  }

  startChainSelectPreview(seedVertexId) {
    this.chainSelectPreview.active = true;
    this.chainSelectPreview.seedVertexId = seedVertexId;
    this.chainSelectPreview.directionNeighborId = null;
    this.chainSelectPreview.candidateVertexIds = [seedVertexId];
    this.chainSelectPreview.lastClientX = 0.0;
    this.chainSelectPreview.lastClientY = 0.0;
  }

  cancelChainSelectPreview() {
    if (!this.chainSelectPreview.active) {
      return false;
    }
    this.chainSelectPreview.active = false;
    this.chainSelectPreview.seedVertexId = null;
    this.chainSelectPreview.directionNeighborId = null;
    this.chainSelectPreview.candidateVertexIds = [];
    this.chainSelectPreview.lastClientX = 0.0;
    this.chainSelectPreview.lastClientY = 0.0;
    return true;
  }

  // screen 上の seed -> neighbor 方向候補から、pointer に最も近い方向を preview に採用する
  updateChainSelectPreviewFromScreenDirections(clientX, clientY, directions) {
    if (!this.chainSelectPreview.active) {
      return false;
    }
    let best = null;
    for (const direction of directions) {
      const seedPoint = direction?.seed ?? null;
      const neighborPoint = direction?.neighbor ?? null;
      if (!seedPoint || !neighborPoint) {
        continue;
      }
      const dx = neighborPoint.x - seedPoint.x;
      const dy = neighborPoint.y - seedPoint.y;
      const len2 = dx * dx + dy * dy;
      if (len2 <= 1.0e-9) {
        continue;
      }
      const projection = ((clientX - seedPoint.x) * dx + (clientY - seedPoint.y) * dy) / len2;
      const clamped = Math.max(0.0, Math.min(1.0, projection));
      const cx = seedPoint.x + dx * clamped;
      const cy = seedPoint.y + dy * clamped;
      const dist2 = (clientX - cx) * (clientX - cx) + (clientY - cy) * (clientY - cy);
      if (!best || dist2 < best.dist2) {
        best = { neighborId: direction.neighborId, dist2 };
      }
    }
    if (!best) {
      return false;
    }
    return this.setChainSelectPreviewDirection(best.neighborId, clientX, clientY);
  }

  setChainSelectPreviewDirection(directionNeighborId, clientX, clientY) {
    if (!this.chainSelectPreview.active) {
      return false;
    }
    const seed = this.getVertexById(this.chainSelectPreview.seedVertexId);
    const neighbor = this.getVertexById(directionNeighborId);
    if (!seed || !neighbor) {
      return false;
    }
    this.chainSelectPreview.directionNeighborId = directionNeighborId;
    this.chainSelectPreview.candidateVertexIds = this.collectChainSelectVertexIds(seed, neighbor);
    this.chainSelectPreview.lastClientX = clientX;
    this.chainSelectPreview.lastClientY = clientY;
    return true;
  }

  // seed から選ばれた edge 方向に沿って、quad 面だけで構成される vertex chain を集める
  // UV 球の緯線のような曲線は直線近傍判定では拾えないため、隣接 edge の向きを順に追う
  // ただし三角面や五角面に入ると loop の解釈が曖昧になるため、その edge を境界として停止する
  collectChainSelectVertexIds(seed, directionNeighbor) {
    const direction = sub3(directionNeighbor.position, seed.position);
    const directionLength = length3(direction);
    if (directionLength <= 1.0e-9) {
      return [seed.id];
    }
    const forward = mul3(direction, 1.0 / directionLength);
    const neighborIdsByVertexId = this.buildNeighborIdsByVertexId();
    const edgeOwners = this.buildEdgeOwners();
    const forwardIds = this.traceChainSelectVertexIds(seed, directionNeighbor, forward, {
      edgeOwners,
      neighborIdsByVertexId
    });
    const reverseNeighbor = this.findNextChainSelectNeighbor(seed, null, mul3(forward, -1.0), {
      edgeOwners,
      neighborIdsByVertexId,
      excludedIds: new Set([directionNeighbor.id])
    });
    const reverseIds = reverseNeighbor
      ? this.traceChainSelectVertexIds(seed, reverseNeighbor, mul3(forward, -1.0), {
        edgeOwners,
        neighborIdsByVertexId
      })
      : [];
    const orderedIds = [...reverseIds.reverse(), seed.id, ...forwardIds];
    const uniqueIds = [];
    const usedIds = new Set();
    for (const id of orderedIds) {
      if (usedIds.has(id)) {
        continue;
      }
      usedIds.add(id);
      uniqueIds.push(id);
    }
    return uniqueIds;
  }

  traceChainSelectVertexIds(seed, firstVertex, initialDirection, context) {
    if (!this.isChainSelectEdgeAllowed(seed.id, firstVertex.id, context.edgeOwners)) {
      return [];
    }
    const ids = [];
    const visitedIds = new Set([seed.id]);
    let previous = seed;
    let current = firstVertex;
    let currentDirection = initialDirection;
    while (current) {
      if (visitedIds.has(current.id)) {
        return ids;
      }
      visitedIds.add(current.id);
      ids.push(current.id);
      const step = sub3(current.position, previous.position);
      const stepLength = length3(step);
      if (stepLength <= 1.0e-9) {
        return ids;
      }
      currentDirection = mul3(step, 1.0 / stepLength);
      const next = this.findNextChainSelectNeighbor(current, previous, currentDirection, context);
      if (!next) {
        return ids;
      }
      previous = current;
      current = next;
    }
    return ids;
  }

  findNextChainSelectNeighbor(current, previous, direction, context) {
    let best = null;
    const excludedIds = context.excludedIds ?? new Set();
    for (const neighborId of context.neighborIdsByVertexId.get(current.id) ?? []) {
      if (excludedIds.has(neighborId) || (previous && neighborId === previous.id)) {
        continue;
      }
      if (!this.isChainSelectEdgeAllowed(current.id, neighborId, context.edgeOwners)) {
        continue;
      }
      const neighbor = this.getVertexById(neighborId);
      if (!neighbor) {
        continue;
      }
      const step = sub3(neighbor.position, current.position);
      const stepLength = length3(step);
      if (stepLength <= 1.0e-9) {
        continue;
      }
      const score = dot3(mul3(step, 1.0 / stepLength), direction);
      if (score < 0.35) {
        continue;
      }
      if (!best || score > best.score) {
        best = { vertex: neighbor, score };
      }
    }
    return best?.vertex ?? null;
  }

  isChainSelectEdgeAllowed(aId, bId, edgeOwners) {
    const owners = edgeOwners.get(this.edgeKey(aId, bId)) ?? [];
    if (owners.length === 0 || owners.length > 2) {
      return false;
    }
    return owners.every((owner) => owner.face.indices.length === 4);
  }

  getChainSelectPreviewGuideLines() {
    if (!this.chainSelectPreview.active || this.chainSelectPreview.candidateVertexIds.length < 2) {
      return [];
    }
    const vertices = this.chainSelectPreview.candidateVertexIds
      .map((id) => this.getVertexById(id))
      .filter((vertex) => vertex !== null);
    if (vertices.length < 2) {
      return [];
    }
    const lines = [];
    for (let i = 0; i < vertices.length - 1; i++) {
      lines.push({
        a: [...vertices[i].position],
        b: [...vertices[i + 1].position]
      });
    }
    const edgeOwners = this.buildEdgeOwners();
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    if (first !== last && this.isChainSelectEdgeAllowed(first.id, last.id, edgeOwners)) {
      lines.push({
        a: [...last.position],
        b: [...first.position]
      });
    }
    return lines;
  }

  confirmChainSelectPreview() {
    if (!this.chainSelectPreview.active) {
      return false;
    }
    const ids = this.chainSelectPreview.candidateVertexIds.filter((id) => this.getVertexById(id) !== null);
    if (ids.length === 0) {
      this.cancelChainSelectPreview();
      this.setMessage("Chain Select no targets");
      return true;
    }
    this.selectedVertices = new Set(ids);
    this.lastSelectedVertexId = this.chainSelectPreview.seedVertexId;
    this.syncSelectedFacesFromVertices();
    this.cancelChainSelectPreview();
    this.rebuildScene();
    this.setMessage(`Chain Select ${this.selectedVertices.size} vertex(s)`);
    return true;
  }

  getChainSelectPreview() {
    return {
      ...this.chainSelectPreview,
      candidateVertexIds: [...this.chainSelectPreview.candidateVertexIds]
    };
  }

  // SelectLoop は、選択 vertex が「元 edge の中点」であることを GG と同じ判定で確認する
  // ただし選択を広げる方向は元 edge の colinear 方向ではなく、左右の face 内で対辺にある中点へ向かう
  // そのため、元 edge の両端を候補から除外し、残った隣接 vertex のうち中点判定を満たすものだけを返す
  getLoopSelectCounterpartMiddleIds(vertex, options = {}) {
    if (!vertex) {
      return { ids: [], targetCount: 0 };
    }
    const neighborIdsByVertexId = options.neighborIdsByVertexId ?? this.buildNeighborIdsByVertexId();
    const targets = this.getCollinearMiddleTargets(vertex, { neighborIdsByVertexId });
    if (targets.length === 0) {
      return { ids: [], targetCount: 0 };
    }
    const selectedTargets = this.getLoopSelectTargetsForIncomingDirection(vertex, targets, options);
    const sourceEdgeEndpointIds = new Set();
    for (const target of selectedTargets) {
      for (const id of target.neighborIds) {
        sourceEdgeEndpointIds.add(id);
      }
    }
    const ids = [];
    for (const neighborId of neighborIdsByVertexId.get(vertex.id) ?? []) {
      if (sourceEdgeEndpointIds.has(neighborId)) {
        continue;
      }
      const neighbor = this.getVertexById(neighborId);
      if (!neighbor) {
        continue;
      }
      if (this.getCollinearMiddleTargets(neighbor, { neighborIdsByVertexId }).length === 0) {
        continue;
      }
      ids.push(neighborId);
    }
    return { ids, targetCount: selectedTargets.length };
  }

  getLoopSelectTargetsForIncomingDirection(vertex, targets, options = {}) {
    const incomingVertexId = options.incomingVertexId ?? null;
    if (incomingVertexId === null || targets.length <= 1) {
      return targets;
    }
    const incomingVertex = this.getVertexById(incomingVertexId);
    if (!incomingVertex) {
      return targets;
    }
    const travel = sub3(vertex.position, incomingVertex.position);
    const travelLength = length3(travel);
    if (travelLength <= 1.0e-9) {
      return targets;
    }
    // 交点では複数方向の midpoint 判定が同時に成立するため、入ってきた方向を保つ target だけを使う。
    const travelDirection = mul3(travel, 1.0 / travelLength);
    let bestPerpendicularScore = Infinity;
    for (const target of targets) {
      bestPerpendicularScore = Math.min(
        bestPerpendicularScore,
        Math.abs(dot3(target.direction, travelDirection))
      );
    }
    return targets.filter((target) => (
      Math.abs(dot3(target.direction, travelDirection)) <= bestPerpendicularScore + 1.0e-4
    ));
  }

  getSelectedFaceObjects() {
    return this.faces.filter((face) => this.selectedFaces.has(face.id));
  }

  getActiveVertexIds() {
    if (this.selectedVertices.size > 0) {
      return Array.from(this.selectedVertices);
    }
    const ids = new Set();
    for (const face of this.getSelectedFaceObjects()) {
      for (const id of face.indices) {
        ids.add(id);
      }
    }
    return Array.from(ids);
  }

  getActiveVertexObjects() {
    return this.getActiveVertexIds()
      .map((id) => this.getVertexById(id))
      .filter((vertex) => vertex !== null);
  }

  buildNeighborIdsByVertexId() {
    const neighborIdsByVertexId = new Map();
    const addNeighbor = (a, b) => {
      if (!neighborIdsByVertexId.has(a)) {
        neighborIdsByVertexId.set(a, new Set());
      }
      neighborIdsByVertexId.get(a).add(b);
    };
    for (const face of this.faces) {
      for (let i = 0; i < face.indices.length; i++) {
        const a = face.indices[i];
        const b = face.indices[(i + 1) % face.indices.length];
        addNeighbor(a, b);
        addNeighbor(b, a);
      }
    }
    return neighborIdsByVertexId;
  }

  getCollinearMiddleTargets(vertex, options = {}) {
    if (!vertex) {
      return [];
    }
    const basis = this.getCameraScreenBasis();
    const neighborIdsByVertexId = options.neighborIdsByVertexId ?? this.buildNeighborIdsByVertexId();
    const preferredDirection = options.preferredDirection ?? null;
    const neighbors = Array.from(neighborIdsByVertexId.get(vertex.id) ?? [])
      .map((id) => this.getVertexById(id))
      .filter((neighbor) => neighbor !== null);
    const targets = [];
    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        const a = neighbors[i];
        const b = neighbors[j];
        const toA = sub3(a.position, vertex.position);
        const toB = sub3(b.position, vertex.position);
        const lenA = length3(toA);
        const lenB = length3(toB);
        if (lenA <= 1.0e-9 || lenB <= 1.0e-9) {
          continue;
        }
        const dirA = mul3(toA, 1.0 / lenA);
        const dirB = mul3(toB, 1.0 / lenB);
        const opposite = -dot3(dirA, dirB);
        if (opposite < 0.999) {
          continue;
        }
        const line = sub3(b.position, a.position);
        const lineLen = length3(line);
        if (lineLen <= 1.0e-9) {
          continue;
        }
        let lineDirection = mul3(line, 1.0 / lineLen);
        if (preferredDirection) {
          if (dot3(lineDirection, preferredDirection) < 0.0) {
            lineDirection = mul3(lineDirection, -1.0);
          }
          if (Math.abs(dot3(lineDirection, preferredDirection)) < 0.999) {
            continue;
          }
        } else if (dot3(lineDirection, basis.right) < 0.0) {
          lineDirection = mul3(lineDirection, -1.0);
        }
        const projected = preferredDirection
          ? Math.abs(dot3(lineDirection, preferredDirection))
          : Math.abs(dot3(lineDirection, basis.right));
        const balance = 1.0 - Math.abs(lenA - lenB) / Math.max(lenA + lenB, 1.0e-9);
        targets.push({
          vertex,
          start: [...vertex.position],
          direction: lineDirection,
          extent: Math.max(lenA, lenB),
          neighborIds: [a.id, b.id],
          rank: opposite * 4.0 + projected + balance * 0.1
        });
      }
    }
    return targets.sort((a, b) => b.rank - a.rank);
  }

  getEdgeSlideTargets(vertices) {
    if (!Array.isArray(vertices) || vertices.length === 0) {
      return [];
    }
    const neighborIdsByVertexId = this.buildNeighborIdsByVertexId();
    const selectedIds = new Set(vertices.map((vertex) => vertex.id));
    const targets = [];
    for (const vertex of vertices) {
      const middleTargets = this.getCollinearMiddleTargets(vertex, { neighborIdsByVertexId });
      let candidateTargets = middleTargets;
      if (middleTargets.length > 1) {
        const selectedNeighborId = Array.from(neighborIdsByVertexId.get(vertex.id) ?? [])
          .find((neighborId) => selectedIds.has(neighborId));
        if (selectedNeighborId !== undefined) {
          candidateTargets = this.getLoopSelectTargetsForIncomingDirection(vertex, middleTargets, {
            incomingVertexId: selectedNeighborId
          });
        }
      }
      const target = candidateTargets[0];
      if (target) {
        targets.push(target);
      }
    }
    return targets;
  }

  getFaceById(id) {
    return this.faces.find((face) => face.id === id) ?? null;
  }

  getLastSelectedVertexIdFromGeometry() {
    for (let i = this.vertices.length - 1; i >= 0; i--) {
      const id = this.vertices[i].id;
      if (this.selectedVertices.has(id)) {
        return id;
      }
    }
    return null;
  }

  getFaceCenter(face) {
    let count = 0;
    const sum = [0.0, 0.0, 0.0];
    for (const id of face.indices) {
      const vertex = this.getVertexById(id);
      if (!vertex) {
        continue;
      }
      sum[0] += vertex.position[0];
      sum[1] += vertex.position[1];
      sum[2] += vertex.position[2];
      count += 1;
    }
    if (count === 0) {
      return null;
    }
    return [sum[0] / count, sum[1] / count, sum[2] / count];
  }

  computeCenter(vertices) {
    if (!Array.isArray(vertices) || vertices.length === 0) {
      return [0.0, 0.0, 0.0];
    }
    const sum = [0.0, 0.0, 0.0];
    for (const vertex of vertices) {
      sum[0] += vertex.position[0];
      sum[1] += vertex.position[1];
      sum[2] += vertex.position[2];
    }
    return [sum[0] / vertices.length, sum[1] / vertices.length, sum[2] / vertices.length];
  }

  computeFaceNormal(face) {
    if (!face || face.indices.length < 3) {
      return [0.0, 1.0, 0.0];
    }
    const v0 = this.getVertexById(face.indices[0]);
    const v1 = this.getVertexById(face.indices[1]);
    const v2 = this.getVertexById(face.indices[2]);
    if (!v0 || !v1 || !v2) {
      return [0.0, 1.0, 0.0];
    }
    const normal = cross3(sub3(v1.position, v0.position), sub3(v2.position, v0.position));
    const len = length3(normal);
    if (len <= 1.0e-9) {
      return [0.0, 1.0, 0.0];
    }
    return [normal[0] / len, normal[1] / len, normal[2] / len];
  }

  computeNormalForVertexIds(vertexIds) {
    if (!Array.isArray(vertexIds) || vertexIds.length < 3) {
      return [0.0, 1.0, 0.0];
    }
    return this.computeFaceNormal({
      id: null,
      indices: vertexIds
    });
  }

  reverseVertexLoop(vertexIds) {
    return [...vertexIds].reverse();
  }

  getLoopEdgeDirection(loop, a, b) {
    for (let i = 0; i < loop.length; i++) {
      const current = loop[i];
      const next = loop[(i + 1) % loop.length];
      if (current === a && next === b) {
        return 1;
      }
      if (current === b && next === a) {
        return -1;
      }
    }
    return 0;
  }

  shouldFlipLoopAwayFromOrigin(vertexIds) {
    const vertices = vertexIds
      .map((id) => this.getVertexById(id))
      .filter((vertex) => vertex !== null);
    if (vertices.length < 3) {
      return false;
    }
    const center = this.computeCenter(vertices);
    const toOrigin = mul3(center, -1.0);
    if (length3(toOrigin) <= 1.0e-8) {
      return false;
    }
    const normal = this.computeNormalForVertexIds(vertexIds);
    return dot3(normal, toOrigin) > 0.0;
  }

  orientLoopByAdjacentFaces(vertexIds) {
    let score = 0;
    for (const face of this.faces) {
      for (let i = 0; i < vertexIds.length; i++) {
        const a = vertexIds[i];
        const b = vertexIds[(i + 1) % vertexIds.length];
        const existingDirection = this.getLoopEdgeDirection(face.indices, a, b);
        if (existingDirection === 0) {
          continue;
        }
        score += existingDirection === 1 ? -1 : 1;
      }
    }
    if (score < 0) {
      return this.reverseVertexLoop(vertexIds);
    }
    if (score > 0) {
      return [...vertexIds];
    }
    return this.shouldFlipLoopAwayFromOrigin(vertexIds)
      ? this.reverseVertexLoop(vertexIds)
      : [...vertexIds];
  }

  addFaceOrientedToDirection(vertexIds, targetDirection) {
    let orientedIds = [...vertexIds];
    if (length3(targetDirection) > 1.0e-9) {
      const normal = this.computeNormalForVertexIds(orientedIds);
      if (dot3(normal, targetDirection) < 0.0) {
        orientedIds = this.reverseVertexLoop(orientedIds);
      }
    } else {
      orientedIds = this.orientLoopByAdjacentFaces(orientedIds);
    }
    return this.addFace(orientedIds);
  }

  computeSelectionNormal() {
    const faces = this.getSelectedFaceObjects();
    if (faces.length > 0) {
      const normal = this.computeAverageFaceNormal(faces);
      if (normal) {
        return normal;
      }
    }
    return [0.0, 1.0, 0.0];
  }

  // N 軸制限で使う法線方向を、現在の選択状態から決める
  // face 選択があれば選択 face の平均法線、vertex 選択だけなら選択 vertex に接する face の平均法線を使う
  // 法線を決められない場合は null を返し、world 軸へ黙って切り替えない
  computeNormalAxisConstraintVector() {
    const selectedFaces = this.getSelectedFaceObjects();
    if (selectedFaces.length > 0) {
      return this.computeAverageFaceNormal(selectedFaces);
    }
    if (this.selectedVertices.size === 0) {
      return null;
    }
    const selectedVertexIds = new Set(this.selectedVertices);
    const adjacentFaces = this.faces.filter((face) => (
      face.indices.some((vertexId) => selectedVertexIds.has(vertexId))
    ));
    return this.computeAverageFaceNormal(adjacentFaces);
  }

  canUseNormalAxisConstraint() {
    return this.computeNormalAxisConstraintVector() !== null;
  }

  computeAverageFaceNormal(faces) {
    if (!Array.isArray(faces) || faces.length === 0) {
      return null;
    }
    const sum = [0.0, 0.0, 0.0];
    for (const face of faces) {
      const normal = this.computeFaceNormal(face);
      sum[0] += normal[0];
      sum[1] += normal[1];
      sum[2] += normal[2];
    }
    const len = length3(sum);
    if (len <= 1.0e-9) {
      return null;
    }
    return [sum[0] / len, sum[1] / len, sum[2] / len];
  }

  getEditMeshSize() {
    if (this.vertices.length === 0) {
      return 1.0;
    }
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const vertex of this.vertices) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], vertex.position[axis]);
        max[axis] = Math.max(max[axis], vertex.position[axis]);
      }
    }
    return Math.max(
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2],
      1.0
    );
  }

  getKeyboardEditStep() {
    return Math.max(0.04, this.getEditMeshSize() * 0.035);
  }

  getXMirrorTolerance() {
    return Math.max(this.getEditMeshSize() * 1.0e-4, 1.0e-5);
  }

  makeXMirrorPosition(position) {
    return [-position[0], position[1], position[2]];
  }

  getVertexById(id) {
    return this.vertices.find((vertex) => vertex.id === id) ?? null;
  }

  findXMirrorVertex(vertex, referencePosition, excludedVertexIds = new Set()) {
    if (!vertex) {
      return null;
    }
    const tolerance = this.getXMirrorTolerance();
    const target = this.makeXMirrorPosition(referencePosition);
    let best = null;
    let bestDistanceSq = Infinity;
    for (const candidate of this.vertices) {
      if (candidate.id === vertex.id || excludedVertexIds.has(candidate.id)) {
        continue;
      }
      const dx = candidate.position[0] - target[0];
      const dy = candidate.position[1] - target[1];
      const dz = candidate.position[2] - target[2];
      if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance || Math.abs(dz) > tolerance) {
        continue;
      }
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < bestDistanceSq) {
        best = candidate;
        bestDistanceSq = distanceSq;
      }
    }
    return best;
  }

  makeXMirrorEditPairs(sourceVertices, initialPositions = null) {
    if (!this.getXMirrorEdit() || this.mode !== this.editModeName || !Array.isArray(sourceVertices) || sourceVertices.length === 0) {
      return [];
    }
    const sourceIds = new Set(sourceVertices.map((vertex) => vertex.id));
    const pairs = [];
    for (const vertex of sourceVertices) {
      const explicitMirrorId = this.explicitXMirrorVertexPairs.get(vertex.id);
      const explicitMirror = explicitMirrorId === undefined || sourceIds.has(explicitMirrorId)
        ? null
        : this.getVertexById(explicitMirrorId);
      if (explicitMirror) {
        pairs.push({
          sourceId: vertex.id,
          mirrorId: explicitMirror.id
        });
        continue;
      }
      const referencePosition = initialPositions?.get?.(vertex) ?? vertex.position;
      const mirror = this.findXMirrorVertex(vertex, referencePosition, sourceIds);
      if (mirror) {
        pairs.push({
          sourceId: vertex.id,
          mirrorId: mirror.id
        });
      }
    }
    return pairs;
  }

  applyXMirrorEdit(sourceVertices, initialPositions = null, mirrorPairs = null) {
    if (!this.getXMirrorEdit() || this.mode !== this.editModeName || !Array.isArray(sourceVertices) || sourceVertices.length === 0) {
      return {
        updated: 0,
        missing: 0
      };
    }
    if (Array.isArray(mirrorPairs)) {
      let updated = 0;
      for (const pair of mirrorPairs) {
        const source = this.getVertexById(pair.sourceId);
        const mirror = this.getVertexById(pair.mirrorId);
        if (!source || !mirror) {
          continue;
        }
        mirror.position = this.makeXMirrorPosition(source.position);
        updated += 1;
      }
      return {
        updated,
        missing: sourceVertices.length - updated
      };
    }
    const sourceIds = new Set(sourceVertices.map((vertex) => vertex.id));
    let updated = 0;
    let missing = 0;
    for (const vertex of sourceVertices) {
      const referencePosition = initialPositions?.get?.(vertex) ?? vertex.position;
      const mirror = this.findXMirrorVertex(vertex, referencePosition, sourceIds);
      if (!mirror) {
        missing += Math.abs(referencePosition[0]) > this.getXMirrorTolerance() ? 1 : 0;
        continue;
      }
      mirror.position = this.makeXMirrorPosition(vertex.position);
      updated += 1;
    }
    return {
      updated,
      missing
    };
  }

  getXMirrorSelectedVertexIds() {
    const ids = new Set();
    if (!this.getXMirrorEdit() || this.mode !== this.editModeName || this.selectedVertices.size === 0) {
      return ids;
    }
    const selectedIds = new Set(this.selectedVertices);
    for (const id of selectedIds) {
      const vertex = this.getVertexById(id);
      if (!vertex) {
        continue;
      }
      const explicitMirrorId = this.explicitXMirrorVertexPairs.get(vertex.id);
      if (explicitMirrorId !== undefined && !selectedIds.has(explicitMirrorId) && this.getVertexById(explicitMirrorId)) {
        ids.add(explicitMirrorId);
        continue;
      }
      const mirror = this.findXMirrorVertex(vertex, vertex.position, selectedIds);
      if (mirror && !selectedIds.has(mirror.id)) {
        ids.add(mirror.id);
      }
    }
    return ids;
  }

  findXMirrorFace(face, excludedFaceIds = new Set()) {
    if (!face) {
      return null;
    }
    const mirroredIds = [];
    for (const vertexId of face.indices) {
      const vertex = this.getVertexById(vertexId);
      if (!vertex) {
        return null;
      }
      if (Math.abs(vertex.position[0]) <= this.getXMirrorTolerance()) {
        mirroredIds.push(vertex.id);
        continue;
      }
      const mirror = this.findXMirrorVertex(vertex, vertex.position);
      if (!mirror) {
        return null;
      }
      mirroredIds.push(mirror.id);
    }
    const sourceKey = [...face.indices].sort((a, b) => a - b).join(":");
    const mirrorKey = [...mirroredIds].sort((a, b) => a - b).join(":");
    if (sourceKey === mirrorKey) {
      return null;
    }
    for (const candidate of this.faces) {
      if (candidate.id === face.id || excludedFaceIds.has(candidate.id) || candidate.indices.length !== mirroredIds.length) {
        continue;
      }
      const candidateKey = [...candidate.indices].sort((a, b) => a - b).join(":");
      if (candidateKey === mirrorKey) {
        return {
          face: candidate,
          vertexPairs: face.indices
            .map((sourceId, index) => ({
              sourceId,
              mirrorId: mirroredIds[index]
            }))
            .filter((pair) => pair.sourceId !== pair.mirrorId)
        };
      }
    }
    return null;
  }

  getXMirrorExtrusionFaces(faces) {
    const empty = {
      faces,
      mirrorFaceIds: new Set(),
      vertexPairs: []
    };
    if (!this.getXMirrorEdit() || this.mode !== this.editModeName || !Array.isArray(faces) || faces.length === 0) {
      return empty;
    }
    const result = [...faces];
    const includedFaceIds = new Set(result.map((face) => face.id));
    const mirrorFaceIds = new Set();
    const vertexPairs = [];
    for (const face of faces) {
      const mirrorInfo = this.findXMirrorFace(face, includedFaceIds);
      if (!mirrorInfo) {
        continue;
      }
      result.push(mirrorInfo.face);
      includedFaceIds.add(mirrorInfo.face.id);
      mirrorFaceIds.add(mirrorInfo.face.id);
      vertexPairs.push(...mirrorInfo.vertexPairs);
    }
    return {
      faces: result,
      mirrorFaceIds,
      vertexPairs
    };
  }

  // X Mirror が ON の loop cut では、source 側で決まった cut edge を mirror face 上の対応 edge へ写す
  // face の頂点順は左右で反転していることがあるため、edge index をそのまま流用せず頂点 ID の対応から探す
  getXMirrorLoopCutEdgeIndex(sourceFace, mirrorInfo, sourceCutEdge) {
    const sourceA = sourceFace.indices[sourceCutEdge];
    const sourceB = sourceFace.indices[(sourceCutEdge + 1) % sourceFace.indices.length];
    const mirrorBySourceId = new Map(
      mirrorInfo.vertexPairs.map((pair) => [pair.sourceId, pair.mirrorId])
    );
    const mirrorA = mirrorBySourceId.get(sourceA) ?? sourceA;
    const mirrorB = mirrorBySourceId.get(sourceB) ?? sourceB;
    const mirrorLoop = mirrorInfo.face.indices;
    const mirrorEdgeKey = this.edgeKey(mirrorA, mirrorB);
    for (let i = 0; i < mirrorLoop.length; i++) {
      if (this.edgeKey(mirrorLoop[i], mirrorLoop[(i + 1) % mirrorLoop.length]) === mirrorEdgeKey) {
        return i;
      }
    }
    return null;
  }

  // source 側の loop cut plan 群に対して、X Mirror の対応 face plan を追加する
  // plan propagation 後に呼ぶことで、source 側で確定した strip / ring と同じ範囲を mirror 側へ複製する
  addXMirrorLoopCutPlans(sourcePlans, planByFaceId, addCutPlan) {
    if (!this.getXMirrorEdit() || this.mode !== this.editModeName) {
      return true;
    }
    for (const { face, cutEdge } of sourcePlans) {
      const mirrorInfo = this.findXMirrorFace(face);
      if (!mirrorInfo || planByFaceId.has(mirrorInfo.face.id)) {
        continue;
      }
      const mirrorCutEdge = this.getXMirrorLoopCutEdgeIndex(face, mirrorInfo, cutEdge);
      if (mirrorCutEdge === null) {
        this.setMessage("loop cut mirror edge not found");
        return false;
      }
      if (!addCutPlan(mirrorInfo.face, mirrorCutEdge)) {
        return false;
      }
    }
    return true;
  }

  addExplicitXMirrorVertexPairs(pairs) {
    if (!Array.isArray(pairs) || pairs.length === 0) {
      return;
    }
    for (const pair of pairs) {
      if (!Number.isInteger(pair?.sourceId) || !Number.isInteger(pair?.mirrorId) || pair.sourceId === pair.mirrorId) {
        continue;
      }
      this.explicitXMirrorVertexPairs.set(pair.sourceId, pair.mirrorId);
      this.explicitXMirrorVertexPairs.set(pair.mirrorId, pair.sourceId);
    }
  }

  edgeKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  buildEdgeOwners() {
    const edgeOwners = new Map();
    for (const face of this.faces) {
      for (let i = 0; i < face.indices.length; i++) {
        const key = this.edgeKey(face.indices[i], face.indices[(i + 1) % face.indices.length]);
        const owners = edgeOwners.get(key) ?? [];
        owners.push({ face, edgeIndex: i });
        edgeOwners.set(key, owners);
      }
    }
    return edgeOwners;
  }

  chooseDefaultLoopCutEdge(face) {
    const edgeLengths = [];
    for (let i = 0; i < 4; i++) {
      const a = this.getVertexById(face.indices[i]);
      const b = this.getVertexById(face.indices[(i + 1) % 4]);
      if (!a || !b) {
        throw new Error(`loop cut face ${face.id} references missing vertex`);
      }
      const dx = a.position[0] - b.position[0];
      const dy = a.position[1] - b.position[1];
      const dz = a.position[2] - b.position[2];
      edgeLengths.push(dx * dx + dy * dy + dz * dz);
    }
    return edgeLengths[0] + edgeLengths[2] >= edgeLengths[1] + edgeLengths[3] ? 0 : 1;
  }

  chooseLoopCutEdge(face, selectedFaceCount, neighborEdges, options) {
    const oppositeEdgeIndex = (edgeIndex) => (edgeIndex + 2) % 4;
    if (
      selectedFaceCount === 1
      && Number.isInteger(options.cutEdgeIndex)
      && options.cutEdgeIndex >= 0
      && options.cutEdgeIndex < 4
    ) {
      return options.cutEdgeIndex;
    }
    if (neighborEdges.length === 0) {
      return this.chooseDefaultLoopCutEdge(face);
    }
    if (neighborEdges.length === 1) {
      return neighborEdges[0];
    }
    if (neighborEdges.length === 2 && oppositeEdgeIndex(neighborEdges[0]) === neighborEdges[1]) {
      return Math.min(neighborEdges[0], neighborEdges[1]);
    }
    this.setMessage("loop cut selection must be a straight quad strip or ring");
    return null;
  }

  addVertex(position) {
    if (!Array.isArray(position) || position.length !== 3) {
      throw new Error("addVertex requires a vec3 position");
    }
    const id = this.nextVertexId();
    this.vertices.push({
      id,
      position: position.map((value) => Number(value))
    });
    return id;
  }

  // Add Vertex tool のクリック確定を反映し、undo / selection / rebuild / message をまとめて扱う
  addVertexFromPick(position, additive = false) {
    this.pushUndo("add vertex");
    const id = this.addVertex(position);
    this.selectVertex(id, additive);
    this.rebuildScene();
    this.setMessage(`added vertex ${id}`);
    return id;
  }

  addFace(vertexIds) {
    if (!Array.isArray(vertexIds) || (vertexIds.length !== 3 && vertexIds.length !== 4)) {
      throw new Error("addFace requires 3 or 4 vertex ids");
    }
    const unique = new Set(vertexIds);
    if (unique.size !== vertexIds.length) {
      throw new Error("face vertices must be unique");
    }
    for (const id of vertexIds) {
      if (!this.getVertexById(id)) {
        throw new Error(`face references missing vertex ${id}`);
      }
    }
    const id = this.nextFaceId();
    this.faces.push({
      id,
      indices: [...vertexIds]
    });
    return id;
  }

  getOrCreateEdgeMidpoint(aId, bId, midpointByEdge) {
    const key = this.edgeKey(aId, bId);
    const existing = midpointByEdge.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const a = this.getVertexById(aId);
    const b = this.getVertexById(bId);
    if (!a || !b) {
      throw new Error(`loop cut edge ${aId}-${bId} references missing vertex`);
    }
    const id = this.addVertex([
      (a.position[0] + b.position[0]) * 0.5,
      (a.position[1] + b.position[1]) * 0.5,
      (a.position[2] + b.position[2]) * 0.5
    ]);
    midpointByEdge.set(key, id);
    return id;
  }

  // active mesh 全体の quad face を 1 段階細分化する
  // 各 face は 4 つの quad に置き換え、隣接 face が共有する edge midpoint は同じ vertex id を使う
  // 三角面や非 quad を含む mesh は、後続の loop / edge 操作で扱う topology を曖昧にしないため拒否する
  subdivideMesh() {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before subdivide");
      return;
    }
    if (this.faces.length === 0) {
      this.setMessage("subdivide requires faces");
      return;
    }
    for (const face of this.faces) {
      if (face.indices.length !== 4) {
        this.setMessage("subdivide requires quad-only mesh");
        return;
      }
      for (const vertexId of face.indices) {
        if (!this.getVertexById(vertexId)) {
          throw new Error(`subdivide face ${face.id} references missing vertex ${vertexId}`);
        }
      }
    }

    this.pushUndo("subdivide mesh");
    const sourceFaces = [...this.faces];
    const removedFaceIds = new Set(sourceFaces.map((face) => face.id));
    const midpointByEdge = new Map();
    const newFaceIds = [];

    for (const face of sourceFaces) {
      const [a, b, c, d] = face.indices;
      const va = this.getVertexById(a);
      const vb = this.getVertexById(b);
      const vc = this.getVertexById(c);
      const vd = this.getVertexById(d);
      const ab = this.getOrCreateEdgeMidpoint(a, b, midpointByEdge);
      const bc = this.getOrCreateEdgeMidpoint(b, c, midpointByEdge);
      const cd = this.getOrCreateEdgeMidpoint(c, d, midpointByEdge);
      const da = this.getOrCreateEdgeMidpoint(d, a, midpointByEdge);
      const center = this.addVertex([
        (va.position[0] + vb.position[0] + vc.position[0] + vd.position[0]) * 0.25,
        (va.position[1] + vb.position[1] + vc.position[1] + vd.position[1]) * 0.25,
        (va.position[2] + vb.position[2] + vc.position[2] + vd.position[2]) * 0.25
      ]);

      newFaceIds.push(this.addFace([a, ab, center, da]));
      newFaceIds.push(this.addFace([ab, b, bc, center]));
      newFaceIds.push(this.addFace([center, bc, c, cd]));
      newFaceIds.push(this.addFace([da, center, cd, d]));
    }

    this.faces = this.faces.filter((face) => !removedFaceIds.has(face.id));
    this.selectedFaces = new Set(newFaceIds);
    this.syncSelectedVerticesFromFaces(newFaceIds
      .map((id) => this.getFaceById(id))
      .filter((face) => face !== null));
    this.rebuildScene();
    this.setMessage(`subdivided ${sourceFaces.length} quad face(s)`);
  }

  // active mesh 全体に Catmull-Clark subdivision を 1 段階適用する
  // face point / edge point / 更新後の旧 vertex point から新しい quad face 群を作り直す
  // non-manifold edge や分岐 boundary は smoothing の解釈が曖昧になるため、補正せず拒否する
  catmullClarkSubdivideMesh() {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before Catmull-Clark");
      return;
    }
    if (this.faces.length === 0) {
      this.setMessage("Catmull-Clark requires faces");
      return;
    }

    const sourceVertices = new Map(this.vertices.map((vertex) => [
      vertex.id,
      { id: vertex.id, position: [...vertex.position] }
    ]));
    const sourceFaces = this.faces.map((face) => ({
      id: face.id,
      indices: [...face.indices]
    }));
    const facePointPositions = new Map();
    const edgeRecords = new Map();
    const vertexFaceIds = new Map();
    const vertexEdgeKeys = new Map();
    const boundaryNeighbors = new Map();
    const usedVertexIds = new Set();
    const average = (positions) => {
      const sum = [0.0, 0.0, 0.0];
      for (const position of positions) {
        sum[0] += position[0];
        sum[1] += position[1];
        sum[2] += position[2];
      }
      return [sum[0] / positions.length, sum[1] / positions.length, sum[2] / positions.length];
    };
    const addToSetMap = (map, id, value) => {
      const set = map.get(id) ?? new Set();
      set.add(value);
      map.set(id, set);
    };

    for (const face of sourceFaces) {
      if (!Array.isArray(face.indices) || face.indices.length < 3) {
        this.setMessage("Catmull-Clark requires polygon faces");
        return;
      }
      const unique = new Set(face.indices);
      if (unique.size !== face.indices.length) {
        this.setMessage("Catmull-Clark requires faces without duplicate vertices");
        return;
      }
      const positions = [];
      for (const vertexId of face.indices) {
        const vertex = sourceVertices.get(vertexId);
        if (!vertex) {
          throw new Error(`Catmull-Clark face ${face.id} references missing vertex ${vertexId}`);
        }
        positions.push(vertex.position);
        usedVertexIds.add(vertexId);
        addToSetMap(vertexFaceIds, vertexId, face.id);
      }
      facePointPositions.set(face.id, average(positions));
      for (let i = 0; i < face.indices.length; i++) {
        const a = face.indices[i];
        const b = face.indices[(i + 1) % face.indices.length];
        const key = this.edgeKey(a, b);
        const record = edgeRecords.get(key) ?? { a, b, faceIds: [] };
        record.faceIds.push(face.id);
        edgeRecords.set(key, record);
        addToSetMap(vertexEdgeKeys, a, key);
        addToSetMap(vertexEdgeKeys, b, key);
      }
    }

    for (const vertex of sourceVertices.values()) {
      if (!usedVertexIds.has(vertex.id)) {
        this.setMessage("Catmull-Clark requires all vertices to belong to faces");
        return;
      }
    }
    for (const record of edgeRecords.values()) {
      if (record.faceIds.length > 2) {
        this.setMessage("Catmull-Clark does not support non-manifold edges");
        return;
      }
      if (record.faceIds.length === 1) {
        addToSetMap(boundaryNeighbors, record.a, record.b);
        addToSetMap(boundaryNeighbors, record.b, record.a);
      }
    }
    for (const vertex of sourceVertices.values()) {
      const faceIds = vertexFaceIds.get(vertex.id);
      const edgeKeys = vertexEdgeKeys.get(vertex.id);
      const neighbors = boundaryNeighbors.get(vertex.id) ?? new Set();
      if (!faceIds || !edgeKeys) {
        this.setMessage("Catmull-Clark requires connected face topology");
        return;
      }
      if (neighbors.size !== 0 && neighbors.size !== 2) {
        this.setMessage("Catmull-Clark requires simple boundary vertices");
        return;
      }
      if (neighbors.size === 0 && edgeKeys.size !== faceIds.size) {
        this.setMessage("Catmull-Clark requires manifold interior vertices");
        return;
      }
    }

    const newVertexPositionsByOldId = new Map();
    for (const vertex of sourceVertices.values()) {
      const faceIds = Array.from(vertexFaceIds.get(vertex.id));
      const edgeKeys = Array.from(vertexEdgeKeys.get(vertex.id));
      const neighbors = Array.from(boundaryNeighbors.get(vertex.id) ?? []);
      if (neighbors.length === 2) {
        const a = sourceVertices.get(neighbors[0]);
        const b = sourceVertices.get(neighbors[1]);
        newVertexPositionsByOldId.set(vertex.id, [
          (vertex.position[0] * 6.0 + a.position[0] + b.position[0]) * 0.125,
          (vertex.position[1] * 6.0 + a.position[1] + b.position[1]) * 0.125,
          (vertex.position[2] * 6.0 + a.position[2] + b.position[2]) * 0.125
        ]);
        continue;
      }

      const n = faceIds.length;
      const faceAverage = average(faceIds.map((faceId) => facePointPositions.get(faceId)));
      const edgeAverage = average(edgeKeys.map((key) => {
        const record = edgeRecords.get(key);
        const a = sourceVertices.get(record.a).position;
        const b = sourceVertices.get(record.b).position;
        return [
          (a[0] + b[0]) * 0.5,
          (a[1] + b[1]) * 0.5,
          (a[2] + b[2]) * 0.5
        ];
      }));
      newVertexPositionsByOldId.set(vertex.id, [
        (faceAverage[0] + edgeAverage[0] * 2.0 + vertex.position[0] * (n - 3.0)) / n,
        (faceAverage[1] + edgeAverage[1] * 2.0 + vertex.position[1] * (n - 3.0)) / n,
        (faceAverage[2] + edgeAverage[2] * 2.0 + vertex.position[2] * (n - 3.0)) / n
      ]);
    }

    const edgePointPositions = new Map();
    for (const [key, record] of edgeRecords.entries()) {
      const a = sourceVertices.get(record.a).position;
      const b = sourceVertices.get(record.b).position;
      if (record.faceIds.length === 1) {
        edgePointPositions.set(key, [
          (a[0] + b[0]) * 0.5,
          (a[1] + b[1]) * 0.5,
          (a[2] + b[2]) * 0.5
        ]);
        continue;
      }
      const f0 = facePointPositions.get(record.faceIds[0]);
      const f1 = facePointPositions.get(record.faceIds[1]);
      edgePointPositions.set(key, [
        (a[0] + b[0] + f0[0] + f1[0]) * 0.25,
        (a[1] + b[1] + f0[1] + f1[1]) * 0.25,
        (a[2] + b[2] + f0[2] + f1[2]) * 0.25
      ]);
    }

    this.pushUndo("Catmull-Clark subdivide mesh");
    const newVertices = [];
    const newFaces = [];
    const oldVertexPointIds = new Map();
    const edgePointIds = new Map();
    const facePointIds = new Map();
    const allocateVertex = (position) => {
      const id = this.nextVertexId();
      newVertices.push({ id, position });
      return id;
    };
    const allocateFace = (indices) => {
      const id = this.nextFaceId();
      newFaces.push({ id, indices });
      return id;
    };

    for (const [oldId, position] of newVertexPositionsByOldId.entries()) {
      oldVertexPointIds.set(oldId, allocateVertex(position));
    }
    for (const [key, position] of edgePointPositions.entries()) {
      edgePointIds.set(key, allocateVertex(position));
    }
    for (const [faceId, position] of facePointPositions.entries()) {
      facePointIds.set(faceId, allocateVertex(position));
    }

    const newFaceIds = [];
    for (const face of sourceFaces) {
      const facePointId = facePointIds.get(face.id);
      for (let i = 0; i < face.indices.length; i++) {
        const current = face.indices[i];
        const next = face.indices[(i + 1) % face.indices.length];
        const previous = face.indices[(i + face.indices.length - 1) % face.indices.length];
        newFaceIds.push(allocateFace([
          oldVertexPointIds.get(current),
          edgePointIds.get(this.edgeKey(current, next)),
          facePointId,
          edgePointIds.get(this.edgeKey(previous, current))
        ]));
      }
    }

    const state = this.getEditMeshState();
    state.vertices = newVertices;
    state.faces = newFaces;
    this.selectedFaces = new Set(newFaceIds);
    this.syncSelectedVerticesFromFaces(newFaces);
    this.rebuildScene();
    this.setMessage(`Catmull-Clark ${sourceFaces.length} face(s)`);
  }

  // transform session から使う extrusion geometry を内部 session 上で作成する
  createExtrusion(distance) {
    const selectedFaces = this.getSelectedFaceObjects();
    if (selectedFaces.length === 0) {
      return null;
    }
    const mirrorExtrusion = this.getXMirrorExtrusionFaces(selectedFaces) ?? {
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
      : Math.max(0.001, this.getEditMeshSize() * 0.0001);
    const resetTopVertices = Math.abs(distance) <= 1.0e-8;
    const topBasePositions = new Map();
    const selectedVertexIds = new Set();
    const vertexNormalSums = new Map();
    const edgeRecords = new Map();

    // Blender の region extrude と同様に、選択 face 群を 1 つの領域として扱う
    for (const face of faces) {
      const normal = this.computeFaceNormal(face);
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
        const key = this.edgeKey(a, b);
        if (!edgeRecords.has(key)) {
          edgeRecords.set(key, []);
        }
        edgeRecords.get(key).push({ face, a, b });
      }
    }

    const topByBaseVertex = new Map();
    for (const vertexId of selectedVertexIds) {
      const vertex = this.getVertexById(vertexId);
      if (!vertex) {
        throw new Error(`selected face references missing vertex ${vertexId}`);
      }
      const sum = vertexNormalSums.get(vertexId) ?? this.computeSelectionNormal();
      const len = Math.hypot(sum[0], sum[1], sum[2]);
      const normal = len > 1.0e-9
        ? [sum[0] / len, sum[1] / len, sum[2] / len]
        : this.computeSelectionNormal();
      const id = this.addVertex(add3(vertex.position, mul3(normal, buildDistance)));
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
      .map((id) => this.getVertexById(id))
      .filter((vertex) => vertex !== null);
    const regionCenter = this.computeCenter(regionVertices);

    for (const face of faces) {
      const normal = this.computeFaceNormal(face);
      const top = face.indices.map((vertexId) => topByBaseVertex.get(vertexId));
      if (top.some((vertexId) => vertexId === undefined)) {
        throw new Error(`extrude face ${face.id} is missing duplicated top vertices`);
      }
      const faceId = this.addFaceOrientedToDirection(top, normal);
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
        .map((id) => this.getVertexById(id))
        .filter((vertex) => vertex !== null);
      const sideCenter = this.computeCenter(sideVertices);
      const faceId = this.addFaceOrientedToDirection(sideLoop, sub3(sideCenter, regionCenter));
      newFaceIds.push(faceId);
    }

    // Region extrude では元の選択面は押し出し後の内部面になるため削除する
    this.faces = this.faces.filter((face) => !baseFaceIds.has(face.id));

    if (resetTopVertices) {
      for (const [id, position] of topBasePositions.entries()) {
        const vertex = this.getVertexById(id);
        if (vertex) {
          vertex.position = position;
        }
      }
    }
    this.addExplicitXMirrorVertexPairs(mirrorTopVertexPairs);
    this.selectedVertices = sourceNewVertexIds;
    this.selectedFaces = mirrorTopVertexPairs.length > 0
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

  // Edit Mode transform session を開始し、preview に必要な edit geometry state を controller 内に保持する
  startEditTransformSession(mode) {
    const normalized = mode === "move" || mode === "rotate" || mode === "scale" || mode === "extrude" || mode === "edge-slide"
      ? mode
      : null;
    if (!normalized) {
      return false;
    }
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before transform");
      return false;
    }
    if (normalized === "extrude" && this.getSelectedFaceObjects().length === 0) {
      this.setMessage("select face before extrude");
      return false;
    }
    let vertices = [];
    let extrudeVertexNormals = new Map();
    let edgeSlideTargets = [];
    let xMirrorPairs = [];
    if (normalized === "extrude") {
      const extrusion = this.createExtrusion(0.0);
      if (!extrusion) {
        this.setMessage("select face before extrude");
        return false;
      }
      extrudeVertexNormals = extrusion.extrudeVertexNormals;
      vertices = Array.from(extrusion.sourceNewVertexIds ?? extrusion.newVertexIds)
        .map((id) => this.getVertexById(id))
        .filter((vertex) => vertex !== null);
      xMirrorPairs = extrusion.mirrorTopVertexPairs ?? [];
      this.rebuildScene();
    } else {
      vertices = this.getActiveVertexObjects();
    }
    if (normalized === "edge-slide") {
      edgeSlideTargets = this.getEdgeSlideTargets(vertices);
      vertices = edgeSlideTargets.map((target) => target.vertex);
      if (vertices.length === 0) {
        this.setMessage("GG requires selected vertices between collinear edges");
        return false;
      }
    }
    if (vertices.length === 0) {
      this.setMessage(`select vertices or faces before ${normalized === "edge-slide" ? "edge slide" : normalized}`);
      return false;
    }
    const initialPositions = new Map(vertices.map((vertex) => [
      vertex,
      [...vertex.position]
    ]));
    if (normalized !== "extrude") {
      xMirrorPairs = this.makeXMirrorEditPairs(vertices, initialPositions);
    }
    this.transformSession = {
      mode: normalized,
      vertices,
      initialPositions,
      xMirrorPairs,
      edgeSlideTargets,
      extrudeVertexNormals,
      axisConstraint: null,
      normalAxisVector: null,
      changed: false,
      segmentChanged: false,
      center: this.computeCenter(vertices)
    };
    return true;
  }

  // mobile の複数 drag segment では、現在の preview 結果を次 segment の初期状態にする
  finishEditTransformDragSegment() {
    if (!this.transformSession) {
      return false;
    }
    const session = this.transformSession;
    session.initialPositions = new Map(session.vertices.map((vertex) => [
      vertex,
      [...vertex.position]
    ]));
    session.edgeSlideTargets = session.edgeSlideTargets.map((target) => ({
      ...target,
      start: [...target.vertex.position]
    }));
    session.center = this.computeCenter(session.vertices);
    session.segmentChanged = false;
    return true;
  }

  confirmEditTransformSession() {
    const hadSession = this.transformSession !== null;
    this.transformSession = null;
    return hadSession;
  }

  cancelEditTransformSession() {
    const hadSession = this.transformSession !== null;
    this.transformSession = null;
    return hadSession;
  }

  getEditTransformAxisConstraint() {
    return this.transformSession?.axisConstraint ?? null;
  }

  hasEditTransformChanged() {
    return this.transformSession?.changed === true;
  }

  hasEditTransformSegmentChanged() {
    return this.transformSession?.segmentChanged === true;
  }

  toggleEditTransformAxisConstraint(axis) {
    if (!this.transformSession) {
      return null;
    }
    const normalized = axis === "x" || axis === "y" || axis === "z" || axis === "n" ? axis : null;
    let normalAxisVector = null;
    if (normalized === "n") {
      normalAxisVector = this.computeNormalAxisConstraintVector();
    }
    if (normalized === "n" && !normalAxisVector) {
      this.setMessage("normal axis requires selected face or adjacent face");
      return this.transformSession.axisConstraint;
    }
    this.transformSession.axisConstraint = this.transformSession.axisConstraint === normalized
      ? null
      : normalized;
    this.transformSession.normalAxisVector = this.transformSession.axisConstraint === "n"
      ? normalAxisVector
      : null;
    return this.transformSession.axisConstraint;
  }

  getEditTransformConstraintAxisVector() {
    const axisConstraint = this.getEditTransformAxisConstraint();
    if (axisConstraint === "x") return [1.0, 0.0, 0.0];
    if (axisConstraint === "y") return [0.0, 1.0, 0.0];
    if (axisConstraint === "z") return [0.0, 0.0, 1.0];
    if (axisConstraint === "n") return this.transformSession?.normalAxisVector ?? null;
    return null;
  }

  makeEditTransformMoveDelta(basis, dx, dy, worldPerPixel) {
    return add3(
      mul3(basis.right, dx * worldPerPixel),
      mul3(basis.up, -dy * worldPerPixel)
    );
  }

  makeEditTransformAxisMoveDelta(axis, basis, dx, dy, worldPerPixel) {
    const screenX = dot3(axis, basis.right);
    const screenY = dot3(axis, basis.up);
    const screenLen = Math.hypot(screenX, screenY);
    if (screenLen <= 1.0e-6) {
      return [0.0, 0.0, 0.0];
    }
    const pixelsAlongAxis = (dx * screenX + (-dy) * screenY) / screenLen;
    return mul3(axis, pixelsAlongAxis * worldPerPixel);
  }

  makeEditTransformWorldPerPixel(viewportWidth, viewportHeight) {
    const viewportSize = Math.max(160.0, Math.min(viewportWidth, viewportHeight));
    return Math.max(0.002, this.getEditMeshSize() / viewportSize);
  }

  // pointer bridge からの drag preview を、EditModeController が所有する transform session へ適用する
  applyEditTransformDrag(dragInput) {
    const session = this.transformSession;
    if (!session) {
      return false;
    }
    const {
      basis,
      dx,
      dy,
      viewportHeight,
      viewportWidth
    } = dragInput ?? {};
    const slideWidth = Number.isFinite(viewportWidth)
      ? viewportWidth * 0.25
      : 0.0;
    const {
      mode,
      vertices,
      initialPositions,
      xMirrorPairs,
      edgeSlideTargets,
      extrudeVertexNormals,
      center
    } = session;
    if (!Array.isArray(vertices)) {
      throw new Error("applyEditTransformDrag requires vertices array");
    }
    if (!(initialPositions instanceof Map)) {
      throw new Error("applyEditTransformDrag requires initialPositions Map");
    }
    if (!basis || !Array.isArray(basis.forward)) {
      throw new Error("applyEditTransformDrag requires camera basis");
    }
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) {
      throw new Error("applyEditTransformDrag requires finite drag metrics");
    }
    const worldPerPixel = this.makeEditTransformWorldPerPixel(viewportWidth, viewportHeight);
    const axis = this.getEditTransformConstraintAxisVector();
    const moveDelta = this.makeEditTransformMoveDelta(basis, dx, dy, worldPerPixel);
    const constrainedMoveDelta = axis
      ? this.makeEditTransformAxisMoveDelta(axis, basis, dx, dy, worldPerPixel)
      : moveDelta;
    for (const vertex of vertices) {
      const initial = initialPositions.get(vertex);
      if (!initial) {
        continue;
      }
      if (mode === "move") {
        vertex.position = add3(initial, constrainedMoveDelta);
      } else if (mode === "rotate") {
        const angleRad = (dx - dy) * 0.01;
        vertex.position = this.rotatePointAroundAxis(initial, center, axis ?? basis.forward, angleRad);
      } else if (mode === "scale") {
        const factor = Math.max(0.02, Math.exp((dx - dy) * 0.006));
        if (axis) {
          const rel = sub3(initial, center);
          const along = dot3(rel, axis);
          const parallel = mul3(axis, along);
          const perpendicular = sub3(rel, parallel);
          vertex.position = add3(center, add3(perpendicular, mul3(parallel, factor)));
        } else {
          vertex.position = add3(center, mul3(sub3(initial, center), factor));
        }
      } else if (mode === "extrude") {
        const normal = extrudeVertexNormals.get(vertex.id) ?? this.computeSelectionNormal();
        const distance = (dx - dy) * worldPerPixel;
        vertex.position = axis
          ? add3(initial, constrainedMoveDelta)
          : add3(initial, mul3(normal, distance));
      } else if (mode === "edge-slide") {
        const slide = edgeSlideTargets.find((target) => target.vertex === vertex);
        if (!slide) {
          continue;
        }
        const ratio = Math.max(-1.0, Math.min(1.0, dx / Math.max(80.0, slideWidth)));
        if (slide.direction && Number.isFinite(slide.extent)) {
          vertex.position = add3(slide.start, mul3(slide.direction, ratio * slide.extent));
        } else {
          vertex.position = add3(slide.start, mul3(sub3(slide.end, slide.start), ratio));
        }
      }
    }
    this.applyXMirrorEdit(vertices, initialPositions, xMirrorPairs);
    session.changed = true;
    session.segmentChanged = true;
    this.rebuildScene();
    this.setMessage(`${mode === "edge-slide" ? "edge slide" : mode} drag${axis ? " constrained" : ""}`);
    return true;
  }

  // transform preview の rotate で、指定軸まわりに点を回転させる
  // Edit Mode の transform は object local 座標系内の vertex position を直接更新する
  rotatePointAroundAxis(point, center, axis, angleRad) {
    const rel = sub3(point, center);
    const n = normalize3(axis, "edit transform rotate axis");
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const term1 = mul3(rel, cosA);
    const term2 = mul3(cross3(n, rel), sinA);
    const term3 = mul3(n, dot3(n, rel) * (1.0 - cosA));
    return add3(center, add3(add3(term1, term2), term3));
  }

  // 即時 extrude 操作を実行する
  extrudeSelectedFaces() {
    const faces = this.getSelectedFaceObjects();
    if (faces.length === 0) {
      this.setMessage("select face before extrude");
      return;
    }
    this.pushUndo("extrude faces");
    const distance = Math.max(0.25, this.getEditMeshSize() * 0.18);
    this.createExtrusion(distance);
    this.rebuildScene();
    this.setMessage(`extruded ${faces.length} face(s)`);
  }

  // 選択 face の頂点順を反転し、表裏を入れ替える
  flipSelectedFaces() {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before flipping faces");
      return;
    }
    const faces = this.getSelectedFaceObjects();
    if (faces.length === 0) {
      this.setMessage("select face before flip");
      return;
    }
    this.pushUndo("flip face orientation");
    for (const face of faces) {
      face.indices = [...face.indices].reverse();
    }
    this.rebuildScene();
    this.setMessage(`flipped ${faces.length} face(s)`);
  }

  // 四角面列に loop cut を入れる
  // 選択 face を開始点として、同じ edge loop 上の quad へ処理を伝播する
  loopCutSelectedFaces(options = {}) {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before loop cut");
      return;
    }
    const selectedFaces = this.getSelectedFaceObjects();
    if (selectedFaces.length === 0) {
      this.setMessage("select quad faces before loop cut");
      return;
    }
    for (const face of selectedFaces) {
      if (face.indices.length !== 4) {
        this.setMessage("loop cut requires quad faces");
        return;
      }
    }

    const selectedFaceIds = new Set(selectedFaces.map((face) => face.id));
    const edgeOwners = this.buildEdgeOwners();
    const planByFaceId = new Map();
    const oppositeEdgeIndex = (edgeIndex) => (edgeIndex + 2) % 4;
    const isSameCutPair = (left, right) => left === right || oppositeEdgeIndex(left) === right;
    const addCutPlan = (face, cutEdge) => {
      if (face.indices.length !== 4) {
        return true;
      }
      const existing = planByFaceId.get(face.id);
      if (existing) {
        if (!isSameCutPair(existing.cutEdge, cutEdge)) {
          this.setMessage("loop cut reached the same face from incompatible directions");
          return false;
        }
        return true;
      }
      planByFaceId.set(face.id, { face, cutEdge });
      return true;
    };

    for (const face of selectedFaces) {
      const neighborEdges = [];
      for (let i = 0; i < 4; i++) {
        const owners = edgeOwners.get(this.edgeKey(face.indices[i], face.indices[(i + 1) % 4])) ?? [];
        if (owners.some((owner) => owner.face.id !== face.id && selectedFaceIds.has(owner.face.id))) {
          neighborEdges.push(i);
        }
      }
      const cutEdge = this.chooseLoopCutEdge(face, selectedFaces.length, neighborEdges, options);
      if (cutEdge === null || !addCutPlan(face, cutEdge)) {
        return;
      }
    }

    const queue = Array.from(planByFaceId.values());
    for (let index = 0; index < queue.length; index++) {
      const { face, cutEdge } = queue[index];
      for (const edgeIndex of [cutEdge, oppositeEdgeIndex(cutEdge)]) {
        const owners = edgeOwners.get(this.edgeKey(face.indices[edgeIndex], face.indices[(edgeIndex + 1) % 4])) ?? [];
        if (owners.length > 2) {
          this.setMessage("loop cut does not support non-manifold edges");
          return;
        }
        for (const owner of owners) {
          if (owner.face.id === face.id || owner.face.indices.length !== 4) {
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

    const sourceCutPlans = Array.from(planByFaceId.values());
    if (!this.addXMirrorLoopCutPlans(sourceCutPlans, planByFaceId, addCutPlan)) {
      return;
    }

    this.pushUndo("loop cut faces");
    const cutPlans = Array.from(planByFaceId.values());
    const midpointByEdge = new Map();
    const newFaceIds = [];
    const removedFaceIds = new Set(cutPlans.map((plan) => plan.face.id));

    for (const { face, cutEdge } of cutPlans) {
      const loop = face.indices;
      const a = loop[cutEdge];
      const b = loop[(cutEdge + 1) % 4];
      const c = loop[(cutEdge + 2) % 4];
      const d = loop[(cutEdge + 3) % 4];
      const ab = this.getOrCreateEdgeMidpoint(a, b, midpointByEdge);
      const cd = this.getOrCreateEdgeMidpoint(c, d, midpointByEdge);
      newFaceIds.push(this.addFace([a, ab, cd, d]));
      newFaceIds.push(this.addFace([ab, b, c, cd]));
    }

    this.faces = this.faces.filter((face) => !removedFaceIds.has(face.id));
    this.selectedVertices = new Set(Array.from(midpointByEdge.values()));
    this.selectedFaces = new Set(newFaceIds);
    this.rebuildScene();
    this.setMessage(`loop cut ${cutPlans.length} quad face(s)`);
  }

  // loop cut command を実行する
  // 単独 quad face は preview session を開始し、それ以外は既存 operation へ即時に渡す
  runLoopCutCommand() {
    const faces = this.getSelectedFaceObjects();
    this.cancelChainSelectPreview();
    if (faces.length === 1 && faces[0].indices.length === 4) {
      this.startLoopCutPreview(faces[0].id);
      this.setMessage("loop cut preview: drag near an edge, tap to confirm");
      return;
    }
    this.cancelLoopCutPreview();
    this.loopCutSelectedFaces();
  }

  // loop cut preview session を開始する
  startLoopCutPreview(faceId) {
    this.loopCutPreview.active = true;
    this.loopCutPreview.faceId = faceId;
    this.loopCutPreview.cutEdgeIndex = 0;
    this.loopCutPreview.lastClientX = 0.0;
    this.loopCutPreview.lastClientY = 0.0;
  }

  // loop cut preview session を終了する
  cancelLoopCutPreview() {
    if (!this.loopCutPreview.active) {
      return false;
    }
    this.loopCutPreview.active = false;
    this.loopCutPreview.faceId = null;
    this.loopCutPreview.cutEdgeIndex = 0;
    this.loopCutPreview.lastClientX = 0.0;
    this.loopCutPreview.lastClientY = 0.0;
    return true;
  }

  // preview 中の pointer 位置から選ばれた edge index を保存する
  setLoopCutPreviewEdge(edgeIndex, clientX, clientY) {
    if (!this.loopCutPreview.active) {
      return false;
    }
    this.loopCutPreview.cutEdgeIndex = edgeIndex;
    this.loopCutPreview.lastClientX = clientX;
    this.loopCutPreview.lastClientY = clientY;
    return true;
  }

  // screen 上の edge 端点群から、pointer に最も近い edge を preview に反映する
  updateLoopCutPreviewEdgeFromScreenEdges(clientX, clientY, edges) {
    if (!this.loopCutPreview.active) {
      return false;
    }
    let best = null;
    for (const edge of edges) {
      const pa = edge?.a ?? null;
      const pb = edge?.b ?? null;
      if (!pa || !pb) {
        continue;
      }
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const denom = dx * dx + dy * dy;
      const t = denom > 1.0e-9
        ? Math.max(0.0, Math.min(1.0, ((clientX - pa.x) * dx + (clientY - pa.y) * dy) / denom))
        : 0.0;
      const cx = pa.x + dx * t;
      const cy = pa.y + dy * t;
      const dist2 = (clientX - cx) * (clientX - cx) + (clientY - cy) * (clientY - cy);
      if (!best || dist2 < best.dist2) {
        best = { edgeIndex: edge.edgeIndex, dist2 };
      }
    }
    if (!best) {
      return false;
    }
    return this.setLoopCutPreviewEdge(best.edgeIndex, clientX, clientY);
  }

  // loop cut preview guide を active mesh local 座標の線分として返す
  getLoopCutPreviewGuideLine() {
    if (!this.loopCutPreview.active) {
      return null;
    }
    const face = this.getFaceById(this.loopCutPreview.faceId);
    if (!face || face.indices.length !== 4) {
      return null;
    }
    const edgeIndex = this.loopCutPreview.cutEdgeIndex;
    const oppositeIndex = (edgeIndex + 2) % 4;
    const a0 = this.getVertexById(face.indices[edgeIndex]);
    const a1 = this.getVertexById(face.indices[(edgeIndex + 1) % 4]);
    const b0 = this.getVertexById(face.indices[oppositeIndex]);
    const b1 = this.getVertexById(face.indices[(oppositeIndex + 1) % 4]);
    if (!a0 || !a1 || !b0 || !b1) {
      return null;
    }
    const midpoint = (left, right) => [
      (left.position[0] + right.position[0]) * 0.5,
      (left.position[1] + right.position[1]) * 0.5,
      (left.position[2] + right.position[2]) * 0.5
    ];
    return {
      a: midpoint(a0, a1),
      b: midpoint(b0, b1)
    };
  }

  // preview 確定時に必要な options を取り出し、session を終了する
  consumeLoopCutPreviewOptions() {
    if (!this.loopCutPreview.active) {
      return null;
    }
    const options = {
      cutEdgeIndex: this.loopCutPreview.cutEdgeIndex
    };
    this.cancelLoopCutPreview();
    return options;
  }

  // preview で選ばれている辺を使って loop cut を確定する
  confirmLoopCutPreview() {
    const options = this.consumeLoopCutPreviewOptions();
    if (!options) {
      return false;
    }
    this.loopCutSelectedFaces(options);
    return true;
  }

  // 描画や pointer hit test のため、preview state を読み取り専用 snapshot として返す
  getLoopCutPreview() {
    return { ...this.loopCutPreview };
  }

  // keyboard 補助移動を内部 session 上の active vertex へ適用する
  moveActiveVerticesBy(delta, label) {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before keyboard edit");
      return false;
    }
    const vertices = this.getActiveVertexObjects();
    if (vertices.length === 0) {
      this.setMessage("select vertices or faces before keyboard edit");
      return false;
    }
    this.pushUndo(label);
    const initialPositions = new Map(vertices.map((vertex) => [
      vertex,
      [...vertex.position]
    ]));
    for (const vertex of vertices) {
      vertex.position = add3(vertex.position, delta);
    }
    this.applyXMirrorEdit(vertices, initialPositions);
    this.rebuildScene();
    this.setMessage(label);
    return true;
  }

  // screen 平面 keyboard 移動を実行する
  moveSelectionByScreenKeys(stepX, stepY) {
    const basis = this.getCameraScreenBasis();
    const step = this.getKeyboardEditStep();
    const delta = add3(
      mul3(basis.right, stepX * step),
      mul3(basis.up, stepY * step)
    );
    return this.moveActiveVerticesBy(delta, "keyboard move screen");
  }

  // 法線方向 keyboard 移動を実行する
  moveSelectionByNormalKey(direction) {
    const step = this.getKeyboardEditStep();
    const normal = this.computeSelectionNormal();
    return this.moveActiveVerticesBy(mul3(normal, direction * step), "keyboard move normal");
  }

  // keyboard scale を内部 session 上の active vertex へ適用する
  scaleSelectionByKeyboard(factor) {
    if (this.mode !== this.editModeName) {
      this.setMessage("switch to edit mode before keyboard scale");
      return false;
    }
    const vertices = this.getActiveVertexObjects();
    if (vertices.length === 0) {
      this.setMessage("select vertices or faces before keyboard scale");
      return false;
    }
    this.pushUndo("keyboard scale selection");
    const center = this.computeCenter(vertices);
    const initialPositions = new Map(vertices.map((vertex) => [
      vertex,
      [...vertex.position]
    ]));
    for (const vertex of vertices) {
      vertex.position = add3(center, mul3(sub3(vertex.position, center), factor));
    }
    this.applyXMirrorEdit(vertices, initialPositions);
    this.rebuildScene();
    this.setMessage(`keyboard scale ${factor.toFixed(2)}`);
    return true;
  }
}
