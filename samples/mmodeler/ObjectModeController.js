// ---------------------------------------------
// samples/mmodeler/ObjectModeController.js  2026/05/26
//   object mode controller for mmodeler
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import { add3, normalize3 } from "./math3d.js";

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`ObjectModeController requires ${name}`);
  }
  return value;
}

function isWorldOrigin(origin) {
  return Math.abs(origin[0]) <= 1.0e-9
    && Math.abs(origin[1]) <= 1.0e-9
    && Math.abs(origin[2]) <= 1.0e-9;
}

function quatFromAxisAngle(axis, angleRad) {
  const n = normalize3(axis, "object transform axis");
  const half = angleRad * 0.5;
  const s = Math.sin(half);
  return [
    n[0] * s,
    n[1] * s,
    n[2] * s,
    Math.cos(half)
  ];
}

function multiplyQuatXyzw(a, b) {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const aw = a[3];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const bw = b[3];
  const q = [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!Number.isFinite(len) || len <= 1.0e-9) {
    throw new Error("object transform produced invalid rotation");
  }
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

// Object Mode の object selection と object list 操作を扱う
// mesh geometry の編集や Edit Mode の vertex / face selection は担当しない
export default class ObjectModeController {
  constructor({
    scene,
    objectModeName,
    commitActiveObject,
    activateObject,
    rebuildScene,
    setMessage,
    pushUndo,
    getObjectOrigin,
    getObjectRotation,
    getObjectScale,
    buildJoinedObject,
    buildPrimitiveObject,
    orientAllFacesConsistently
  }) {
    if (!scene) {
      throw new Error("ObjectModeController requires scene");
    }
    this.scene = scene;
    this.objectModeName = objectModeName;
    this.commitActiveObject = requireFunction(commitActiveObject, "commitActiveObject");
    this.activateObject = requireFunction(activateObject, "activateObject");
    this.rebuildScene = requireFunction(rebuildScene, "rebuildScene");
    this.setMessage = requireFunction(setMessage, "setMessage");
    this.pushUndo = requireFunction(pushUndo, "pushUndo");
    this.getObjectOrigin = requireFunction(getObjectOrigin, "getObjectOrigin");
    this.getObjectRotation = requireFunction(getObjectRotation, "getObjectRotation");
    this.getObjectScale = requireFunction(getObjectScale, "getObjectScale");
    this.buildJoinedObject = requireFunction(buildJoinedObject, "buildJoinedObject");
    this.buildPrimitiveObject = requireFunction(buildPrimitiveObject, "buildPrimitiveObject");
    this.orientAllFacesConsistently = requireFunction(orientAllFacesConsistently, "orientAllFacesConsistently");
  }

  // Object Mode で操作できる状態かを確認する
  // mode が違う場合は呼び出し側の分岐漏れなので、message を出して false を返す
  requireObjectMode(message) {
    if (this.scene.mode === this.objectModeName) {
      return true;
    }
    this.setMessage(message);
    return false;
  }

  // object を追加選択または置換選択する
  // additive では選択済み object を再度選ぶと選択解除し、active object が外れた場合は残りの選択から補う
  selectObject(id, additive = false) {
    const object = this.scene.objects.find((entry) => entry.id === id);
    if (!object) {
      return false;
    }
    if (!additive) {
      this.scene.clearObjectSelection();
    }
    if (additive && this.scene.selectedObjectIds.has(id)) {
      this.scene.selectedObjectIds.delete(id);
      if (this.scene.activeObjectId === id) {
        this.scene.activeObjectId = this.scene.selectedObjectIds.values().next().value ?? null;
      }
    } else {
      this.scene.selectedObjectIds.add(id);
      this.activateObject(id);
    }
    return true;
  }

  // click selection の object 選択を反映し、scene 表示まで更新する
  selectObjectFromPick(id, additive = false) {
    if (!this.selectObject(id, additive)) {
      return false;
    }
    this.rebuildScene();
    const activeObject = this.scene.getActiveObject();
    this.setMessage(`selected object ${activeObject?.name ?? this.scene.activeObjectId}`);
    return true;
  }

  // empty click で Object Mode selection を解除し、scene 表示まで更新する
  clearObjectSelectionFromPick() {
    this.scene.clearObjectSelection();
    this.rebuildScene();
    this.setMessage("object selection cleared");
  }

  // box select の object id 群を反映し、active object を補正する
  selectObjectsByIdsFromBox(ids, additive = false) {
    if (!additive) {
      this.scene.clearObjectSelection();
    }
    for (const id of ids) {
      this.scene.selectedObjectIds.add(id);
    }
    if (ids.length > 0) {
      this.activateObject(ids[0], { clearEditSelection: true });
      for (const id of ids) {
        this.scene.selectedObjectIds.add(id);
      }
    }
    this.rebuildScene();
    this.setMessage(`box selected objects ${ids.length}`);
    return ids.length;
  }

  // Object Mode の全 object を選択する
  selectAllObjects() {
    this.commitActiveObject();
    this.scene.selectAllObjects();
    if (!this.scene.getActiveObject() && this.scene.objects.length > 0) {
      this.activateObject(this.scene.objects[0].id);
    }
    this.rebuildScene();
    this.setMessage(`selected all objects (${this.scene.selectedObjectIds.size})`);
  }

  // Object Mode の選択状態を反転する
  invertObjectSelection() {
    this.commitActiveObject();
    this.scene.invertObjectSelection();
    this.rebuildScene();
    this.setMessage(`inverted objects (${this.scene.selectedObjectIds.size})`);
  }

  // world X が負の object だけを選択する
  selectXNegativeObjects() {
    this.commitActiveObject();
    this.scene.setObjectSelection(
      this.scene.objects
        .filter((object) => this.getObjectOrigin(object)[0] < 0.0)
        .map((object) => object.id)
    );
    this.rebuildScene();
    this.setMessage(`selected X<0 objects (${this.scene.selectedObjectIds.size})`);
  }

  // Object Mode transform session の開始時点の transform state を保存する
  // mesh geometry は保存せず、Object Mode が直接変更する origin / rotation / scale だけを保持する
  createObjectTransformSnapshot(objects) {
    if (!Array.isArray(objects)) {
      throw new Error("createObjectTransformSnapshot requires objects array");
    }
    return new Map(objects.map((object) => [
      object,
      {
        origin: this.getObjectOrigin(object),
        rotation: this.getObjectRotation(object),
        scale: this.getObjectScale(object)
      }
    ]));
  }

  // Object Mode の drag preview を object transform state へ反映する
  // vertices / faces は object local geometry の正本なので、この method では変更しない
  applyObjectTransformPreview({
    mode,
    objects,
    initialTransforms,
    axis,
    basis,
    dx,
    dy,
    constrainedMoveDelta
  }) {
    if (!Array.isArray(objects)) {
      throw new Error("applyObjectTransformPreview requires objects array");
    }
    if (!(initialTransforms instanceof Map)) {
      throw new Error("applyObjectTransformPreview requires initialTransforms Map");
    }
    if (!basis || !Array.isArray(basis.forward)) {
      throw new Error("applyObjectTransformPreview requires camera basis");
    }
    const angleRad = (dx - dy) * 0.01;
    const factor = Math.max(0.02, Math.exp((dx - dy) * 0.006));
    for (const object of objects) {
      const initial = initialTransforms.get(object);
      if (!initial) {
        continue;
      }
      if (mode === "move") {
        object.origin = add3(initial.origin, constrainedMoveDelta);
      } else if (mode === "rotate") {
        const delta = quatFromAxisAngle(axis ?? basis.forward, angleRad);
        object.rotation = multiplyQuatXyzw(initial.rotation, delta);
      } else if (mode === "scale") {
        object.scale = initial.scale * factor;
      }
    }
    this.rebuildScene();
    this.setMessage(`${mode} object${axis ? " constrained" : ""}`);
  }

  // 選択 object を削除し、残った object があれば次の active object にする
  deleteSelectedObjects() {
    if (!this.requireObjectMode("switch to object mode before deleting objects")) {
      return;
    }
    if (this.scene.selectedObjectIds.size === 0) {
      this.setMessage("select objects before deleting objects");
      return;
    }
    this.pushUndo("delete objects");
    this.commitActiveObject();
    const removedIds = this.scene.deleteSelectedObjectsAndActivateNext();
    this.rebuildScene();
    this.setMessage(`deleted ${removedIds.size} object(s)`);
  }

  // Object Mode で選択中の複数 object を 1 object へ統合する
  // controller は選択確認、undo、scene 置換、表示更新を担当し、geometry の詰め替えは注入された helper に任せる
  joinSelectedObjects() {
    if (!this.requireObjectMode("switch to object mode before joining objects")) {
      return;
    }
    if (this.scene.selectedObjectIds.size < 2) {
      this.setMessage("select at least 2 objects to join");
      return;
    }
    const selectedIds = new Set(this.scene.selectedObjectIds);
    const selectedObjects = this.scene.objects.filter((object) => selectedIds.has(object.id));
    if (selectedObjects.length < 2) {
      this.setMessage("select at least 2 objects to join");
      return;
    }
    this.pushUndo("join objects");
    this.commitActiveObject();
    const joinedObject = this.buildJoinedObject(selectedObjects, this.scene.allocateObjectId());
    this.scene.replaceSelectedObjectsWithObject(selectedIds, joinedObject);
    this.rebuildScene();
    this.setMessage(`joined ${selectedObjects.length} objects`);
  }

  // primitive geometry を新しい object として scene に追加する
  // geometry の生成は helper に任せ、controller は undo、id 払い出し、scene 追加、表示更新を担当する
  addPrimitiveObject(kind) {
    const objectId = this.scene.nextObjectId;
    const object = this.buildPrimitiveObject(kind, objectId);
    this.pushUndo(`add ${object.name}`);
    this.commitActiveObject();
    const allocatedId = this.scene.allocateObjectId();
    if (allocatedId !== objectId) {
      throw new Error(`primitive object id mismatch: expected ${objectId}, got ${allocatedId}`);
    }
    this.scene.addObjectAndActivate(object, {
      mode: this.objectModeName
    });
    this.commitActiveObject();
    this.rebuildScene();
    this.setMessage(`added ${object.name}`);
  }

  // 選択 object 群の local 原点を world 原点へ移動する
  // 頂点座標は object local のまま保持し、object transform の origin だけを変更する
  moveSelectedObjectsToWorldOrigin() {
    if (!this.requireObjectMode("switch to object mode before origin reset")) {
      return;
    }
    this.commitActiveObject();
    const selectedIds = this.scene.selectedObjectIds.size > 0
      ? new Set(this.scene.selectedObjectIds)
      : new Set(this.scene.activeObjectId !== null ? [this.scene.activeObjectId] : []);
    const objects = this.scene.objects.filter((object) => selectedIds.has(object.id));
    if (objects.length === 0) {
      this.setMessage("select object before origin reset");
      return;
    }
    if (objects.every((object) => isWorldOrigin(this.getObjectOrigin(object)))) {
      this.setMessage("object origin already at world origin");
      return;
    }
    this.pushUndo("move object to world origin");
    for (const object of objects) {
      object.origin = [0.0, 0.0, 0.0];
    }
    this.rebuildScene();
    this.setMessage(`moved ${objects.length} object(s) to world origin`);
  }
}
