// ---------------------------------------------
// samples/mmodeler/ModelerCommandDispatcher.js  2026/07/25
//   command dispatcher for mmodeler
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

const PRIMITIVE_SEGMENTS = new Set([3, 4, 8, 12, 16, 24, 32]);

// `function`を検証し、後続処理が扱える共通形式へ整える
function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`ModelerCommandDispatcher requires ${name}`);
  }
  return value;
}

function isAxisCommand(action) {
  return action === "axis-x" || action === "axis-y" || action === "axis-z" || action === "axis-normal";
}

// `axis`のコマンドの値を読み込み、検証済みのデータとして後続処理へ渡す
function readAxisCommandValue(action) {
  if (action === "axis-normal") {
    return "n";
  }
  return String(action ?? "").slice(-1);
}

// `primitive`の`add`のコマンドの条件を判定し、結果を真偽値で返す
function isPrimitiveAddCommand(action) {
  return action === "add-cube" || action === "add-plane" || action === "add-sphere"
    || action === "add-cylinder" || action === "add-cone"
    || action === "add-torus" || action === "add-double-cone";
}

// 表示のコマンドの条件を判定し、結果を真偽値で返す
function isViewCommand(action) {
  return action === "view-x" || action === "view-y" || action === "view-z"
    || action === "view-x-reverse" || action === "view-y-reverse" || action === "view-z-reverse";
}

// `primitive`の`segments`を読み込み、検証済みのデータとして後続処理へ渡す
function readPrimitiveSegments(action) {
  const segments = Number(String(action).slice("primitive-segments-".length));
  if (!PRIMITIVE_SEGMENTS.has(segments)) {
    throw new Error(`invalid primitive segment count: ${action}`);
  }
  return segments;
}

// mmodeler の action id を意味ごとの実行先へ振り分ける
// CommandPalette は表示だけを担当し、この class が palette / ribbon / view button から届く command id の入口になる
export default class ModelerCommandDispatcher {
  constructor({
    palette,
    isActionEnabled,
    setMessage,
    openFilePicker,
    saveJson,
    saveGlb,
    createInitialModel,
    objectModeController,
    editModeController,
    viewController,
    showSelectedVertexCoordinates,
    showSculptBrushSettings,
    showActiveObjectInfo,
    cycleViewAnglePreset,
    undo,
    redo,
    takeScreenshot,
    setTransformMode,
    deleteSelected,
    invertSelectionForCurrentMode,
    selectXNegativeForCurrentMode,
    setEditorMode,
    setSculptBrushType,
    setSculptBrushDirection,
    selectAllForCurrentMode,
    setPrimitiveSegments,
    setPaletteTransformAxis,
    renderPalette,
    closePalette,
    objectModeName,
    editModeName,
    sculptModeName,
    faceToolName,
    vertexToolName,
    addVertexToolName,
    now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())
  }) {
    this.palette = palette;
    this.isActionEnabled = requireFunction(isActionEnabled, "isActionEnabled");
    this.setMessage = requireFunction(setMessage, "setMessage");
    this.openFilePicker = requireFunction(openFilePicker, "openFilePicker");
    this.saveJson = requireFunction(saveJson, "saveJson");
    this.saveGlb = requireFunction(saveGlb, "saveGlb");
    this.createInitialModel = requireFunction(createInitialModel, "createInitialModel");
    if (!objectModeController) {
      throw new Error("ModelerCommandDispatcher requires objectModeController");
    }
    this.objectModeController = objectModeController;
    if (!editModeController) {
      throw new Error("ModelerCommandDispatcher requires editModeController");
    }
    this.editModeController = editModeController;
    if (!viewController) {
      throw new Error("ModelerCommandDispatcher requires viewController");
    }
    this.viewController = viewController;
    this.showSelectedVertexCoordinates = requireFunction(showSelectedVertexCoordinates, "showSelectedVertexCoordinates");
    this.showSculptBrushSettings = requireFunction(showSculptBrushSettings, "showSculptBrushSettings");
    this.showActiveObjectInfo = requireFunction(showActiveObjectInfo, "showActiveObjectInfo");
    this.cycleViewAnglePreset = requireFunction(cycleViewAnglePreset, "cycleViewAnglePreset");
    this.undo = requireFunction(undo, "undo");
    this.redo = requireFunction(redo, "redo");
    this.takeScreenshot = requireFunction(takeScreenshot, "takeScreenshot");
    this.setTransformMode = requireFunction(setTransformMode, "setTransformMode");
    this.deleteSelected = requireFunction(deleteSelected, "deleteSelected");
    this.invertSelectionForCurrentMode = requireFunction(invertSelectionForCurrentMode, "invertSelectionForCurrentMode");
    this.selectXNegativeForCurrentMode = requireFunction(selectXNegativeForCurrentMode, "selectXNegativeForCurrentMode");
    this.setEditorMode = requireFunction(setEditorMode, "setEditorMode");
    this.setSculptBrushType = requireFunction(setSculptBrushType, "setSculptBrushType");
    this.setSculptBrushDirection = requireFunction(setSculptBrushDirection, "setSculptBrushDirection");
    this.selectAllForCurrentMode = requireFunction(selectAllForCurrentMode, "selectAllForCurrentMode");
    this.setPrimitiveSegments = requireFunction(setPrimitiveSegments, "setPrimitiveSegments");
    this.setPaletteTransformAxis = requireFunction(setPaletteTransformAxis, "setPaletteTransformAxis");
    this.renderPalette = requireFunction(renderPalette, "renderPalette");
    this.closePalette = requireFunction(closePalette, "closePalette");
    this.now = requireFunction(now, "now");
    this.objectModeName = objectModeName;
    this.editModeName = editModeName;
    this.sculptModeName = sculptModeName;
    this.faceToolName = faceToolName;
    this.vertexToolName = vertexToolName;
    this.addVertexToolName = addVertexToolName;
    this.lastAction = "";
    this.lastActionTime = 0;
  }

  // pointerup と click の二重発火を短い時間窓で抑止する
  // UI event 側ではなく command 入口で抑止することで、palette / ribbon / view button の挙動をそろえる
  shouldSuppressRepeatedAction(action) {
    const currentTime = this.now();
    if (this.lastAction === action && (currentTime - this.lastActionTime) < 280) {
      return true;
    }
    this.lastAction = action;
    this.lastActionTime = currentTime;
    return false;
  }

  // action id を実行する
  // option command は palette を閉じず、それ以外の command は従来通り実行前に palette を閉じる
  dispatch(action) {
    if (this.shouldSuppressRepeatedAction(action)) {
      return;
    }
    if (action === "palette-next") {
      const page = this.palette?.nextPage() ?? 0;
      this.setMessage(`command palette ${page + 1}`);
      return;
    }
    if (String(action ?? "").startsWith("primitive-segments-")) {
      const segments = readPrimitiveSegments(action);
      this.setPrimitiveSegments(segments);
      this.renderPalette();
      this.setMessage(`primitive segments ${segments}`);
      return;
    }
    if (isAxisCommand(action)) {
      this.setPaletteTransformAxis(readAxisCommandValue(action));
      return;
    }
    this.closePalette();
    if (!action) {
      return;
    }
    if (action === "undefined") {
      this.setMessage("undefined command slot");
      return;
    }
    if (!this.isActionEnabled(action)) {
      return;
    }
    this.dispatchEnabledAction(action);
  }

  // `dispatchEnabledAction`は入力またはイベントを受け取り、対応する処理へ振り分ける
  dispatchEnabledAction(action) {
    if (this.dispatchFileAction(action)) {
      return;
    }
    if (this.dispatchSceneAction(action)) {
      return;
    }
    if (this.dispatchViewAction(action)) {
      return;
    }
    if (this.dispatchHistoryAction(action)) {
      return;
    }
    if (this.dispatchEditAction(action)) {
      return;
    }
    if (action === "select-all") {
      this.selectAllForCurrentMode();
    }
  }

  // `dispatchFileAction`は入力またはイベントを受け取り、対応する処理へ振り分ける
  dispatchFileAction(action) {
    if (action === "load") {
      this.openFilePicker();
      this.setMessage("open file picker");
      return true;
    }
    if (action === "save-json") {
      this.saveJson().catch((err) => {
        console.error(err);
        this.setMessage(`save failed: ${err?.message ?? err}`);
      });
      return true;
    }
    if (action === "save-glb") {
      try {
        this.saveGlb();
      } catch (err) {
        console.error(err);
        this.setMessage(`glb export failed: ${err?.message ?? err}`);
      }
      return true;
    }
    if (action === "screenshot") {
      this.takeScreenshot();
      return true;
    }
    return false;
  }

  // `dispatchSceneAction`は入力またはイベントを受け取り、対応する処理へ振り分ける
  dispatchSceneAction(action) {
    if (action === "new-scene") {
      this.createInitialModel();
      this.setMessage("new model");
      return true;
    }
    if (isPrimitiveAddCommand(action)) {
      this.objectModeController.addPrimitiveObject(action.slice(4));
      return true;
    }
    if (action === "join-objects") {
      this.objectModeController.joinSelectedObjects();
      return true;
    }
    if (action === "origin-world") {
      this.objectModeController.moveSelectedObjectsToWorldOrigin();
      return true;
    }
    return false;
  }

  // `dispatchViewAction`は入力またはイベントを受け取り、対応する処理へ振り分ける
  dispatchViewAction(action) {
    if (action === "toggle-projection") {
      this.viewController.runToggleProjectionCommand();
      return true;
    }
    if (action === "view-vertex") {
      this.showSelectedVertexCoordinates();
      return true;
    }
    if (action === "sculpt-brush") {
      this.showSculptBrushSettings();
      return true;
    }
    if (action === "object-info") {
      this.showActiveObjectInfo();
      return true;
    }
    if (action === "object-wireframe") {
      this.viewController.runToggleObjectWireframeCommand();
      return true;
    }
    if (action === "object-smooth-shading") {
      this.viewController.runToggleObjectSmoothShadingCommand();
      return true;
    }
    if (action === "cycle-lens") {
      this.cycleViewAnglePreset(1);
      return true;
    }
    if (isViewCommand(action)) {
      const reversed = action.endsWith("-reverse");
      const axis = reversed ? action.slice(5, 6) : action.slice(-1);
      this.viewController.runSetMobileAxisViewCommand(axis, reversed);
      return true;
    }
    return false;
  }

  // `dispatchHistoryAction`は入力またはイベントを受け取り、対応する処理へ振り分ける
  dispatchHistoryAction(action) {
    if (action === "undo") {
      this.undo();
      return true;
    }
    if (action === "redo") {
      this.redo();
      return true;
    }
    return false;
  }

  // `dispatchEditAction`は入力またはイベントを受け取り、対応する処理へ振り分ける
  dispatchEditAction(action) {
    if (action === "toggle-x-mirror") {
      this.editModeController.toggleXMirrorEdit();
      return true;
    }
    if (action === "move" || action === "rotate" || action === "scale" || action === "extrude") {
      this.setTransformMode(action);
      return true;
    }
    if (action === "edge-slide") {
      this.setTransformMode("edge-slide");
      return true;
    }
    if (action === "loop-cut") {
      this.editModeController.runLoopCutCommand();
      return true;
    }
    if (action === "chain-select") {
      this.editModeController.runChainSelectCommand();
      return true;
    }
    if (action === "select-loop") {
      this.editModeController.selectLoop();
      return true;
    }
    if (action === "subdivide") {
      this.editModeController.subdivideMesh();
      return true;
    }
    if (action === "catmull-clark") {
      this.editModeController.catmullClarkSubdivideMesh();
      return true;
    }
    if (action === "delete") {
      this.deleteSelected();
      return true;
    }
    if (action === "invert-selection") {
      this.invertSelectionForCurrentMode();
      return true;
    }
    if (action === "select-x-negative") {
      this.selectXNegativeForCurrentMode();
      return true;
    }
    if (action === "mode-object") {
      this.setEditorMode(this.objectModeName);
      return true;
    }
    if (action === "mode-edit") {
      this.setEditorMode(this.editModeName);
      return true;
    }
    if (action === "mode-sculpt") {
      this.setEditorMode(this.sculptModeName);
      return true;
    }
    if (action === "sculpt-draw") {
      this.setSculptBrushType("draw");
      return true;
    }
    if (action === "sculpt-blur") {
      this.setSculptBrushType("blur");
      return true;
    }
    if (action === "sculpt-grab") {
      this.setSculptBrushType("grab");
      return true;
    }
    if (action === "sculpt-pinch") {
      this.setSculptBrushType("pinch");
      return true;
    }
    if (action === "sculpt-plus") {
      this.setSculptBrushDirection(1);
      return true;
    }
    if (action === "sculpt-minus") {
      this.setSculptBrushDirection(-1);
      return true;
    }
    if (action === "tool-face") {
      this.editModeController.setTool(this.faceToolName);
      return true;
    }
    if (action === "tool-vertex") {
      this.editModeController.setTool(this.vertexToolName);
      return true;
    }
    if (action === "tool-add") {
      if (this.editModeController.canMakeFaceFromSelection()) {
        this.editModeController.makeFaceFromSelection();
        return true;
      }
      this.editModeController.setTool(this.addVertexToolName);
      return true;
    }
    return false;
  }
}
