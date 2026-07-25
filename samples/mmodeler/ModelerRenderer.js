// ---------------------------------------------
// samples/mmodeler/ModelerRenderer.js  2026/05/26
//   WebGPU scene graph rendering helpers for mmodeler.
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Shape from "../../webg/Shape.js";
import Quat from "../../webg/Quat.js";
import Matrix from "../../webg/Matrix.js";
import { readFiniteNumber, readQuatXyzw, readVec3 } from "./math3d.js";

function quatFromXyzw(rotation) {
  const q = readQuatXyzw(rotation, "object rotation");
  const quat = new Quat();
  quat.q = [q[3], q[0], q[1], q[2]];
  quat.normalize();
  return quat;
}

// mmodeler の WebGPU scene graph node と Shape の寿命を管理する
// この class は edit command や import の意味を知らず、渡された object / asset を描画 node へ反映する
export default class ModelerRenderer {
  constructor(options = {}) {
    if (!options.app) {
      throw new Error("ModelerRenderer requires app");
    }
    if (!options.modelerImportExport) {
      throw new Error("ModelerRenderer requires modelerImportExport");
    }
    if (!options.material) {
      throw new Error("ModelerRenderer requires material");
    }
    this.app = options.app;
    this.modelerImportExport = options.modelerImportExport;
    this.material = options.material;
    this.meshNode = null;
    this.selectedFaceNode = null;
    this.markerRoot = null;
    this.gridRoot = null;
  }

  // ModelAsset から WebGPU Shape を作る
  // material と shader の設定をここへ集め、main.js から Shape の生成詳細を隠す
  makeShapeFromAsset(asset, materialParams, shader = null) {
    const shape = new Shape(this.app.getGPU());
    if (shader) {
      shape.shader = shader;
    }
    shape.applyPrimitiveAsset(asset);
    shape.endShape();
    shape.setMaterial("smooth-shader", materialParams);
    return shape;
  }

  // 表示用 material を作る
  // smoothShading が ON の場合だけ SmoothShader の flat_shading を 0 にし、
  // editor geometry や保存用 ModelAsset の頂点共有構造は変更しない
  makeMeshMaterial(baseMaterial, smoothShading) {
    return {
      ...baseMaterial,
      flat_shading: smoothShading === true ? 0 : 1
    };
  }

  // scene graph から node subtree を shape 破棄込みで取り除く
  removeNodeTree(node) {
    if (node) {
      this.app.space.removeNodeTree(node, { destroyShapes: true });
    }
  }

  // 全 object の mesh Shape を編集データから再構築する
  // object selection や wireframe は描画表現なので引数で受け取り、scene state 自体は変更しない
  rebuildMeshShapes(options = {}) {
    const objects = Array.isArray(options.objects) ? options.objects : [];
    const selectedObjectIds = options.selectedObjectIds;
    const getObjectOrigin = options.getObjectOrigin;
    const getObjectRotation = options.getObjectRotation;
    const getObjectScale = options.getObjectScale;
    if (!(selectedObjectIds instanceof Set)) {
      throw new Error("rebuildMeshShapes requires selectedObjectIds Set");
    }
    if (typeof getObjectOrigin !== "function") {
      throw new Error("rebuildMeshShapes requires getObjectOrigin");
    }
    if (typeof getObjectRotation !== "function") {
      throw new Error("rebuildMeshShapes requires getObjectRotation");
    }
    if (typeof getObjectScale !== "function") {
      throw new Error("rebuildMeshShapes requires getObjectScale");
    }

    this.removeNodeTree(this.meshNode);
    this.meshNode = null;
    if (objects.length === 0) {
      return;
    }
    this.meshNode = this.app.space.addNode(null, "webgmodeler-objects");
    for (const object of objects) {
      if (object.faces.length === 0) {
        continue;
      }
      const asset = this.modelerImportExport.createModelAssetFromGeometry({
        vertices: object.vertices,
        faces: object.faces,
        name: object.name,
        origin: [0.0, 0.0, 0.0],
        material: this.makeMeshMaterial(this.material.mesh, options.objectSmoothShading)
      });
      const selectedObject = options.objectModeActive === true && selectedObjectIds.has(object.id);
      const shape = this.makeShapeFromAsset(
        asset,
        selectedObject
          ? this.makeMeshMaterial(this.material.selectedObject, options.objectSmoothShading)
          : this.makeMeshMaterial(this.material.mesh, options.objectSmoothShading)
      );
      // Shape 側の polygonLoops から wireframe を作るため、Edit Mode の edge overlay と併用できる
      if (options.objectWireframe === true) {
        shape.setWireframe(true);
      }
      const node = this.app.space.addNode(this.meshNode, `object-${object.id}`);
      const origin = getObjectOrigin(object);
      node.setPosition(origin[0], origin[1], origin[2]);
      node.setQuat(quatFromXyzw(getObjectRotation(object)));
      node.setScale(getObjectScale(object));
      node.webgmodelerKind = "object";
      node.webgmodelerObjectId = object.id;
      node.addShape(shape);
    }
  }

  // Edit Mode の選択 face overlay Shape を再構築する
  // 選択 face が無い場合や Edit Mode ではない場合は、既存 overlay node を取り除いて終了する
  rebuildSelectedFaceShape(options = {}) {
    this.removeNodeTree(this.selectedFaceNode);
    this.selectedFaceNode = null;
    if (options.editModeActive !== true) {
      return;
    }
    if (!options.asset) {
      return;
    }
    const origin = options.origin;
    const rotation = options.rotation;
    const scale = options.scale;
    const checkedOrigin = readVec3(origin, "selected face origin");
    const checkedScale = readFiniteNumber(scale, "selected face scale");
    const shape = this.makeShapeFromAsset(
      options.asset,
      this.material.selectedFace,
      options.shader ?? null
    );
    this.selectedFaceNode = this.app.space.addNode(null, "webgmodeler-selected-faces");
    this.selectedFaceNode.setPosition(checkedOrigin[0], checkedOrigin[1], checkedOrigin[2]);
    this.selectedFaceNode.setQuat(quatFromXyzw(rotation));
    this.selectedFaceNode.setScale(checkedScale);
    this.selectedFaceNode.addShape(shape);
  }

  // edge overlay の line-list 頂点を geometry から再構築する
  // edge の抽出や色の決定は呼び出し側の責務とし、renderer は GPU overlay buffer への追加だけを担当する
  rebuildEdgeOverlayBuffer(options = {}) {
    const edgeOverlay = options.edgeOverlay;
    if (!edgeOverlay) {
      return;
    }
    const edges = options.edges;
    const editMesh = options.editMesh;
    const object = options.object;
    const buildVertexLookup = options.buildVertexLookup;
    const localToWorldPosition = options.localToWorldPosition;
    const getEdgeColor = options.getEdgeColor;
    if (!Array.isArray(edges)) {
      throw new Error("rebuildEdgeOverlayBuffer requires edges array");
    }
    if (!editMesh || !Array.isArray(editMesh.vertices)) {
      throw new Error("rebuildEdgeOverlayBuffer requires edit mesh vertices");
    }
    if (typeof buildVertexLookup !== "function") {
      throw new Error("rebuildEdgeOverlayBuffer requires buildVertexLookup");
    }
    if (typeof localToWorldPosition !== "function") {
      throw new Error("rebuildEdgeOverlayBuffer requires localToWorldPosition");
    }
    if (typeof getEdgeColor !== "function") {
      throw new Error("rebuildEdgeOverlayBuffer requires getEdgeColor");
    }

    edgeOverlay.clear();
    const vertexLookup = buildVertexLookup(editMesh.vertices);
    for (const edge of edges) {
      const va = vertexLookup.get(edge.a);
      const vb = vertexLookup.get(edge.b);
      if (!va || !vb) {
        continue;
      }
      edgeOverlay.addLine(
        localToWorldPosition(object, va.position),
        localToWorldPosition(object, vb.position),
        getEdgeColor(edge)
      );
    }
  }

  // marker overlay の screen-space marker buffer を再構築する
  // marker の分類、投影、色決定は呼び出し側で済ませ、renderer は描画 data だけを受け取る
  rebuildMarkerOverlayBuffer(markerOverlayRenderData = {}) {
    const overlay2d = markerOverlayRenderData.overlay2d;
    if (!overlay2d) {
      return;
    }
    const markers = markerOverlayRenderData.markers;
    if (!Array.isArray(markers)) {
      throw new Error("rebuildMarkerOverlayBuffer requires markers array");
    }
    overlay2d.clear();
    for (const marker of markers) {
      overlay2d.addMarker(
        marker.x,
        marker.y,
        marker.z,
        marker.radiusX,
        marker.radiusY,
        marker.color
      );
    }
  }

  // overlay pass で共通して使う view / viewProjection / canvas を現在 camera から作る
  // marker 投影や edge / guide overlay の matrix 設定で同じ camera snapshot を共有するための入口
  makeOverlayViewProjection() {
    if (!this.app?.eye || !this.app?.projectionMatrix) {
      return null;
    }
    this.app.eye.setWorldMatrix();
    const viewMatrix = new Matrix();
    viewMatrix.makeView(this.app.eye.worldMatrix);
    const viewProjectionMatrix = this.app.projectionMatrix.clone();
    viewProjectionMatrix.mul_(viewMatrix);
    return {
      projectionMatrix: this.app.projectionMatrix,
      viewMatrix,
      viewProjectionMatrix,
      canvas: this.app.screen?.canvas ?? null
    };
  }

  // edit edge overlay を現在 camera の matrix で描く
  // edge の抽出や dirty 判定は呼び出し側に残し、renderer は overlay の matrix 設定と draw を担当する
  drawEdgeOverlayLines(options = {}) {
    const edgeOverlay = options.edgeOverlay;
    if (!edgeOverlay) {
      return;
    }
    const viewState = options.viewState ?? this.makeOverlayViewProjection();
    if (!viewState) {
      return;
    }
    edgeOverlay.zBias = options.zBias;
    edgeOverlay.setMatrices(viewState.projectionMatrix, viewState.viewMatrix);
    if (options.rebuildBuffer === true) {
      if (typeof options.rebuild === "function") {
        options.rebuild();
      } else {
        throw new Error("drawEdgeOverlayLines requires rebuild function when rebuildBuffer is true");
      }
    }
    edgeOverlay.draw();
  }

  // marker overlay を描く
  // marker data の作成と再投影が必要かどうかの判断は呼び出し側に残す
  drawMarkerOverlay(options = {}) {
    const overlay2d = options.overlay2d;
    if (!overlay2d) {
      return;
    }
    if (options.rebuildMarkers === true) {
      this.rebuildMarkerOverlayBuffer(options.markerOverlayRenderData);
    }
    overlay2d.draw();
  }

  // guide overlay の line-list buffer を再構築して描画する
  // grid / axis / loop cut guide の意味は呼び出し側で line data に変換済みとする
  drawGuideOverlay(guideOverlayRenderData = {}) {
    const guideOverlay = guideOverlayRenderData.guideOverlay;
    if (!guideOverlay) {
      return;
    }
    const lines = guideOverlayRenderData.lines;
    if (!Array.isArray(lines)) {
      throw new Error("drawGuideOverlay requires lines array");
    }
    guideOverlay.zBias = guideOverlayRenderData.zBias;
    guideOverlay.setMatrices(
      guideOverlayRenderData.projectionMatrix,
      guideOverlayRenderData.viewMatrix
    );
    guideOverlay.clear();
    for (const line of lines) {
      guideOverlay.addLine(line.a, line.b, line.color);
    }
    guideOverlay.draw();
  }

  // guide overlay を現在の camera / projection で描画する
  // main.js 側は grid / preview の意味を line data へ変換し、renderer は WebGPU overlay への反映を担当する
  drawGuideOverlayLines(options = {}) {
    const guideOverlay = options.guideOverlay;
    if (!guideOverlay) {
      return;
    }
    const lines = options.lines;
    if (!Array.isArray(lines)) {
      throw new Error("drawGuideOverlayLines requires lines array");
    }
    const viewState = options.viewState ?? this.makeOverlayViewProjection();
    if (!viewState) {
      return;
    }
    this.drawGuideOverlay({
      guideOverlay,
      projectionMatrix: viewState.projectionMatrix,
      viewMatrix: viewState.viewMatrix,
      zBias: options.zBias,
      lines
    });
  }

  // 旧 3D marker node を使わないため marker root を空に保つ
  rebuildMarkers() {
    this.removeNodeTree(this.markerRoot);
    this.markerRoot = null;
  }

  // 旧 grid shape が残っている場合だけ取り除く
  clearGridRoot() {
    this.removeNodeTree(this.gridRoot);
    this.gridRoot = null;
  }
}
