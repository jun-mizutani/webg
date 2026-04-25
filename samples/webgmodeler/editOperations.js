// -------------------------------------------------
// webgmodeler edit operations
// -------------------------------------------------

import { add3, mul3, sub3 } from "./math3d.js";

export function createEditOperations(ctx) {
  const getKeyboardEditStep = () => Math.max(0.04, ctx.getEditorBounds().size * 0.035);

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
    ctx.pushUndo("delete selection");
    const deleteFacesOnly = editor.selectedFaces.size > 0;
    const removedVertices = deleteFacesOnly
      ? new Set()
      : new Set(editor.selectedVertices);
    editor.faces = editor.faces.filter((face) => {
      if (editor.selectedFaces.has(face.id)) return false;
      return !face.indices.some((vertexId) => removedVertices.has(vertexId));
    });
    editor.vertices = editor.vertices.filter((vertex) => !removedVertices.has(vertex.id));
    ctx.clearSelection();
    ctx.rebuildScene();
    ctx.setMessage("deleted selection");
  }

  function makeFaceFromSelection(size) {
    const { editor } = ctx;
    if (!ctx.isEditMode()) {
      ctx.setMessage("switch to edit mode before creating faces");
      return;
    }
    const ids = Array.from(editor.selectedVertices);
    if (ids.length !== size) {
      ctx.setMessage(`${size === 3 ? "Triangle" : "Quad"} requires ${size} selected vertices`);
      return;
    }
    ctx.pushUndo(`make ${size === 3 ? "triangle" : "quad"}`);
    const orientedIds = ctx.orderVertexIdsForFaceFromView(ids);
    const faceId = ctx.addFaceWithStableOrientation(orientedIds);
    editor.selectedFaces = new Set([faceId]);
    ctx.rebuildScene();
    ctx.setMessage(`created front-facing face ${faceId}`);
  }

  function createExtrusion(distance) {
    const { editor } = ctx;
    const faces = ctx.getSelectedFaceObjects();
    if (faces.length === 0) {
      return null;
    }
    const newFaceIds = [];
    const newVertexIds = new Set();
    const extrudeVertexNormals = new Map();
    const buildDistance = Math.abs(distance) > 1.0e-8
      ? distance
      : Math.max(0.001, ctx.getEditorBounds().size * 0.0001);
    const resetTopVertices = Math.abs(distance) <= 1.0e-8;
    const topBasePositions = new Map();
    for (const face of faces) {
      const normal = ctx.computeFaceNormal(face);
      const baseVertices = face.indices
        .map((id) => ctx.getVertexById(id))
        .filter((vertex) => vertex !== null);
      const faceCenter = ctx.computeCenter(baseVertices);
      const top = [];
      for (const vertexId of face.indices) {
        const vertex = ctx.getVertexById(vertexId);
        if (!vertex) {
          throw new Error(`face ${face.id} references missing vertex ${vertexId}`);
        }
        const id = ctx.addVertex(add3(vertex.position, mul3(normal, buildDistance)));
        top.push(id);
        newVertexIds.add(id);
        extrudeVertexNormals.set(id, normal);
        topBasePositions.set(id, [...vertex.position]);
      }
      newFaceIds.push(ctx.addFaceOrientedToDirection(top, normal));
      for (let i = 0; i < face.indices.length; i++) {
        const next = (i + 1) % face.indices.length;
        const sideLoop = [
          face.indices[i],
          face.indices[next],
          top[next],
          top[i]
        ];
        const sideVertices = sideLoop
          .map((id) => ctx.getVertexById(id))
          .filter((vertex) => vertex !== null);
        const sideCenter = ctx.computeCenter(sideVertices);
        newFaceIds.push(ctx.addFaceOrientedToDirection(sideLoop, sub3(sideCenter, faceCenter)));
      }
    }
    if (resetTopVertices) {
      for (const [id, position] of topBasePositions.entries()) {
        const vertex = ctx.getVertexById(id);
        if (vertex) {
          vertex.position = position;
        }
      }
    }
    editor.selectedVertices = newVertexIds;
    editor.selectedFaces = new Set(newFaceIds);
    return {
      newVertexIds,
      newFaceIds,
      extrudeVertexNormals
    };
  }

  function extrudeSelectedFaces() {
    const faces = ctx.getSelectedFaceObjects();
    if (faces.length === 0) {
      ctx.setMessage("select face before extrude");
      return;
    }
    ctx.pushUndo("extrude faces");
    const bounds = ctx.getEditorBounds();
    const distance = Math.max(0.25, bounds.size * 0.18);
    createExtrusion(distance);
    ctx.rebuildScene();
    ctx.setMessage(`extruded ${faces.length} face(s)`);
  }

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
    for (const vertex of vertices) {
      vertex.position = add3(vertex.position, delta);
    }
    ctx.rebuildScene();
    ctx.setMessage(label);
    return true;
  }

  function moveSelectionByScreenKeys(stepX, stepY) {
    const basis = ctx.getCameraScreenBasis();
    const step = getKeyboardEditStep();
    const delta = add3(
      mul3(basis.right, stepX * step),
      mul3(basis.up, stepY * step)
    );
    return moveActiveVerticesBy(delta, "keyboard move screen");
  }

  function moveSelectionByNormalKey(direction) {
    const step = getKeyboardEditStep();
    const normal = ctx.computeSelectionNormal();
    return moveActiveVerticesBy(mul3(normal, direction * step), "keyboard move normal");
  }

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
    for (const vertex of vertices) {
      vertex.position = add3(
        center,
        mul3(sub3(vertex.position, center), factor)
      );
    }
    ctx.rebuildScene();
    ctx.setMessage(`keyboard scale ${factor.toFixed(2)}`);
    return true;
  }

  return {
    createExtrusion,
    deleteSelected,
    extrudeSelectedFaces,
    flipSelectedFaces,
    makeFaceFromSelection,
    moveActiveVerticesBy,
    moveSelectionByNormalKey,
    moveSelectionByScreenKeys,
    scaleSelectionByKeyboard
  };
}
