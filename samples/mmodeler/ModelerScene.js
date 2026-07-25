// ---------------------------------------------
// samples/mmodeler/ModelerScene.js  2026/05/24
//   scene state container for mmodeler
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// mmodeler が編集対象として扱う scene state を保持する
// この class は DOM、WebGPU、command palette、camera を知らない
// 最初の段階では main.js の既存 property 参照を壊さないよう、editor plain object と同じ field を持つ
// 今後、selection、undo、active object、edit mode commit を method 化していくための中核 object とする
export default class ModelerScene {
  constructor({
    mode,
    tool,
    nextObjectId,
    message = "ready"
  }) {
    // 現在の mode を保持する
    // Object Mode では object list と object selection を操作し、Edit Mode では active object の mesh を操作する
    this.mode = mode;

    // scene 内の object 群を保持する
    // 各 object は mmodeler 独自の vertices / faces / origin / selection へ変換しやすい形で保持する
    this.objects = [];
    this.selectedObjectIds = new Set();
    this.activeObjectId = null;
    this.nextObjectId = nextObjectId;

    // Edit Mode 中に active object から取り出して編集する mesh data
    // vertex.id / face.id は削除後も意味が変わらない識別子として使う
    // face.indices は vertex id の配列であり、三角形または四角形だけを許可する
    this.vertices = [];
    this.faces = [];
    this.selectedVertices = new Set();
    this.selectedFaces = new Set();
    this.lastSelectedVertexId = null;
    this.nextVertexId = 1;
    this.nextFaceId = 1;

    // Edit Mode の選択 tool を保持する
    // Object Mode では直接使わないが、Edit Mode に戻ったときの操作状態として維持する
    this.tool = tool;

    // scene の変更状態とユーザー向け status message
    // dirty は保存確認や diagnostics の判断に使う
    this.dirty = false;
    this.lastMessage = message;

    // undo / redo は scene 全体の変更履歴として保持する
    // Edit Mode / Object Mode のどちらで発生した変更も同じ stack に積む
    this.undoStack = [];
    this.redoStack = [];
  }

  // status や diagnostics に出す最後の message を保存する
  // DOM への反映は main.js 側の updateStatus() が担当し、この class は文字列状態だけを持つ
  setMessage(message) {
    this.lastMessage = String(message ?? "");
  }

  // scene が保存前の変更を含む状態であることを記録する
  // geometry 変更、undo / redo 復元、import 後の調整など、保存対象が変わったときに呼ぶ
  markDirty() {
    this.dirty = true;
  }

  // save や import 完了後など、現在状態を保存済み相当として扱う
  // undo history の有無とは独立して、保存確認に使う dirty flag だけを落とす
  markClean() {
    this.dirty = false;
  }

  // undo / redo stack をまとめて初期化する
  // import や new model のように、新しい基準状態へ切り替わった直後に使う
  resetHistory() {
    this.undoStack = [];
    this.redoStack = [];
  }

  // 現在状態の snapshot を undo stack へ積み、必要に応じて message も更新する
  // redo stack は新しい編集が始まった時点で意味を失うため、ここで必ず破棄する
  pushUndoSnapshot(snapshot, label = "") {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > 80) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.markDirty();
    if (label) {
      this.setMessage(label);
    }
  }

  // undo 時に現在状態を redo stack へ退避する
  // snapshot 作成の責務は、WebGPU 表示を知らない main.js 側に残す
  pushRedoSnapshot(snapshot) {
    this.redoStack.push(snapshot);
  }

  // redo 時に現在状態を undo stack へ退避する
  pushUndoSnapshotForRedo(snapshot) {
    this.undoStack.push(snapshot);
  }

  // undo stack から直前状態を取り出す
  popUndoSnapshot() {
    return this.undoStack.pop();
  }

  // redo stack から次状態を取り出す
  popRedoSnapshot() {
    return this.redoStack.pop();
  }

  // Edit Mode の vertex / face selection を空にする
  // mode 切り替えや object mode へ戻る処理で、selection state の初期化を一箇所に集める
  clearEditSelection() {
    this.selectedVertices.clear();
    this.selectedFaces.clear();
    this.lastSelectedVertexId = null;
  }

  // Object Mode の object selection を空にする
  clearObjectSelection() {
    this.selectedObjectIds.clear();
  }

  // 指定 id 群を Object Mode の選択状態として保持する
  // active object の接続までは行わず、選択集合だけを更新したい場面で使う
  setObjectSelection(ids) {
    this.selectedObjectIds = new Set(ids);
  }

  // 現在の active object だけを Object Mode の選択状態にする
  selectActiveObjectOnly() {
    if (this.activeObjectId !== null) {
      this.selectedObjectIds = new Set([this.activeObjectId]);
    }
  }

  // scene 内の全 object を選択する
  selectAllObjects() {
    this.selectedObjectIds = new Set(this.objects.map((object) => object.id));
  }

  // Object Mode の選択状態を反転する
  invertObjectSelection() {
    const next = new Set();
    for (const object of this.objects) {
      if (!this.selectedObjectIds.has(object.id)) {
        next.add(object.id);
      }
    }
    this.selectedObjectIds = next;
  }

  // activeObjectId に対応する object を返す
  // 見つからない場合は null を返し、呼び出し側が mode や表示状態に応じて処理を決める
  getActiveObject() {
    return this.objects.find((object) => object.id === this.activeObjectId) ?? null;
  }

  // 現在の編集配列を active object へ書き戻す
  // Edit Mode で編集している vertices / faces は active object と共有される場合が多いが、
  // object 切り替えや snapshot 作成前には、この method で明示的に object 側へ反映する
  commitActiveObject() {
    const object = this.getActiveObject();
    if (!object) {
      return false;
    }
    object.vertices = this.vertices;
    object.faces = this.faces;
    object.nextVertexId = this.nextVertexId;
    object.nextFaceId = this.nextFaceId;
    return true;
  }

  // 編集対象 mesh の接続を空にする
  // object list を差し替える前後や、object がすべて消えたときに古い mesh 参照が残らないようにする
  clearEditableMesh() {
    this.vertices = [];
    this.faces = [];
    this.nextVertexId = 1;
    this.nextFaceId = 1;
    this.clearEditSelection();
  }

  // 指定 object を active にし、編集配列をその object へ接続する
  // commitCurrent が true の場合は、切り替え前の active object へ現在の編集配列を書き戻してから接続する
  activateObject(id, {
    clearEditSelection = true,
    commitCurrent = true
  } = {}) {
    if (commitCurrent) {
      this.commitActiveObject();
    }
    const object = this.objects.find((entry) => entry.id === id) ?? null;
    if (!object) {
      return false;
    }
    this.activeObjectId = object.id;
    this.vertices = object.vertices;
    this.faces = object.faces;
    this.nextVertexId = object.nextVertexId;
    this.nextFaceId = object.nextFaceId;
    if (clearEditSelection) {
      this.clearEditSelection();
    }
    return true;
  }

  // object list を丸ごと差し替え、新しい active object へ編集配列を接続する
  // objects は main.js 側で origin や vertex 座標の検証を済ませたものを渡す
  replaceObjectsAndActivate(objects, activeObjectId, {
    selectedObjectIds = [activeObjectId],
    mode = this.mode
  } = {}) {
    if (!Array.isArray(objects) || objects.length === 0) {
      throw new Error("replaceObjectsAndActivate requires at least one object");
    }
    const active = objects.find((object) => object.id === activeObjectId);
    if (!active) {
      throw new Error(`replaceObjectsAndActivate missing active object ${activeObjectId}`);
    }
    this.objects = objects;
    this.nextObjectId = Math.max(...objects.map((object) => object.id)) + 1;
    this.selectedObjectIds = new Set(selectedObjectIds);
    this.mode = mode;
    this.activeObjectId = null;
    this.clearEditableMesh();
    this.activateObject(activeObjectId, {
      clearEditSelection: true,
      commitCurrent: false
    });
  }

  // 現在の編集配列から単一 object の scene state を作り直す
  // new model のように、既存 object list を 1 object へ初期化する場面で使う
  resetObjectState(name, objectId) {
    const id = objectId;
    this.objects = [{
      id,
      name: String(name || "Object"),
      origin: [0.0, 0.0, 0.0],
      rotation: [0.0, 0.0, 0.0, 1.0],
      scale: 1.0,
      vertices: this.vertices,
      faces: this.faces,
      nextVertexId: this.nextVertexId,
      nextFaceId: this.nextFaceId
    }];
    this.nextObjectId = id + 1;
    this.activeObjectId = id;
    this.selectedObjectIds = new Set([id]);
  }

  // 新しい object を scene に追加し、その object を active / selected にする
  // primitive 追加のように既存 object を残す操作で使う
  addObjectAndActivate(object, {
    mode = this.mode
  } = {}) {
    this.commitActiveObject();
    this.objects.push(object);
    this.mode = mode;
    this.selectedObjectIds = new Set([object.id]);
    return this.activateObject(object.id, {
      clearEditSelection: true,
      commitCurrent: false
    });
  }

  // 次に使う object id を払い出す
  // id の増加規則を scene 側に閉じ込め、primitive 追加や join が直接 nextObjectId を増やさないようにする
  allocateObjectId() {
    const id = this.nextObjectId;
    this.nextObjectId += 1;
    return id;
  }

  // Object Mode の選択 object を削除し、残っている先頭 object を active にする
  // 返り値は削除された object id の Set で、message 表示や diagnostics に使える
  deleteSelectedObjectsAndActivateNext() {
    const removedIds = new Set(this.selectedObjectIds);
    this.objects = this.objects.filter((object) => !removedIds.has(object.id));
    this.clearObjectSelection();
    this.activeObjectId = null;
    this.clearEditableMesh();
    if (this.objects.length > 0) {
      const nextObject = this.objects[0];
      this.selectedObjectIds = new Set([nextObject.id]);
      this.activateObject(nextObject.id, {
        clearEditSelection: true,
        commitCurrent: false
      });
    }
    return removedIds;
  }

  // 選択 object 群を 1 つの object に置き換え、その object を active / selected にする
  // join の geometry 構築は呼び出し側が行い、scene は object list の整合性だけを担当する
  replaceSelectedObjectsWithObject(selectedIds, object) {
    const idSet = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
    this.objects = [
      ...this.objects.filter((entry) => !idSet.has(entry.id)),
      object
    ];
    this.nextObjectId = Math.max(...this.objects.map((entry) => entry.id)) + 1;
    this.selectedObjectIds = new Set([object.id]);
    this.activeObjectId = null;
    this.clearEditableMesh();
    this.activateObject(object.id, {
      clearEditSelection: true,
      commitCurrent: false
    });
  }

  // 選択 face の構成 vertex を vertex selection へ同期する
  // face object の取得方法は controller 側の責務なので、ここでは渡された face 配列だけを読む
  syncSelectedVerticesFromFaces(selectedFaceObjects) {
    this.selectedVertices.clear();
    for (const face of selectedFaceObjects) {
      for (const id of face.indices) {
        this.selectedVertices.add(id);
      }
    }
    if (this.lastSelectedVertexId !== null && !this.selectedVertices.has(this.lastSelectedVertexId)) {
      this.lastSelectedVertexId = null;
    }
  }

  // 全頂点が選択済みの face を face selection へ同期する
  // geometry の face 配列は scene が持っているため、選択状態の整合性はこの class で更新する
  syncSelectedFacesFromVertices() {
    this.selectedFaces.clear();
    if (this.selectedVertices.size < 3) {
      return;
    }
    for (const face of this.faces) {
      if (face.indices.every((id) => this.selectedVertices.has(id))) {
        this.selectedFaces.add(face.id);
      }
    }
  }
}
