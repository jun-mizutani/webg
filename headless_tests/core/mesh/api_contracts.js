import assert from "node:assert/strict";
import Mesh from "../../../webg/Mesh.js";

const frame = { name: "frame" };
const mesh = new Mesh(frame);
const vertices = [0, 0, 0, 1, 2, 3];
const polygons = [[0, 1, 2]];
const normals = [0, 1, 0, 0, 1, 0];
const uvs = [[0, 0, 1, 1]];
const weights = [[0, 1]];
const joints = ["root"];
const matrices = [[1]];
const bind = { id: "bind" };
const nodeMatrix = { id: "node" };

mesh.setName("mesh");
mesh.setVertices(vertices);
mesh.setPolygons(polygons);
mesh.setNormals(normals);
mesh.setTextureCoord(uvs);
mesh.setSkinWeights(weights);
mesh.setJointNames(joints);
mesh.setBindPoseMatrices(matrices);
mesh.setBindShapeMatrix(bind);
mesh.setNodeMatrix(nodeMatrix);
mesh.setMaterialId("mat");
mesh.updateBoundingBox(-2, 3, 1);
mesh.updateBoundingBox(4, -1, 5);

assert.equal(mesh.frame, frame);
assert.equal(mesh.getName(), "mesh");
assert.equal(mesh.getVertices(), vertices);
assert.equal(mesh.getPolygons(), polygons);
assert.equal(mesh.getNormals(), normals);
assert.equal(mesh.getTextureCoord(), uvs);
assert.equal(mesh.getSkinWeights(), weights);
assert.equal(mesh.getJointNames(), joints);
assert.equal(mesh.getBindPoseMatrices(), matrices);
assert.equal(mesh.getBindShapeMatrix(), bind);
assert.equal(mesh.getNodeMatrix(), nodeMatrix);
assert.equal(mesh.getMaterialId(), "mat");
assert.deepEqual(mesh.box, { minx: -2, maxx: 4, miny: -1, maxy: 3, minz: 1, maxz: 5 });

console.log("PASS mesh_container_contracts");
