// ---------------------------------------------------------
// headless_tests/core/node/headless_probe.js  2026/07/12
//   Node hierarchy contracts for camera-relative rendering
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";
import Node from "../../../webg/Node.js";

function assertAlmostEqual(actual, expected, tolerance, label) {
  const difference = Math.abs(actual - expected);
  assert.ok(difference <= tolerance,
    `${label}: actual=${actual} expected=${expected} difference=${difference}`);
}

function makeCamera(position) {
  const matrix = new Matrix();
  matrix.setByEuler(23.0, -9.0, 4.0);
  matrix.position(position);
  return new CameraFrame({ cameraWorldMatrix: matrix, near: 0.1, far: Infinity,
    vfov: 60.0, aspect: 1.5, depthConvention: CAMERA_REVERSE_Z });
}

function addCaptureShape(node, captures, label) {
  node.shapes.push({
    shaderParameter() {},
    draw(modelView, normal) {
      captures.push({ label, modelView: modelView.clone(), normal: normal.clone() });
    }
  });
}

function buildHierarchy(offset) {
  const captures = [];
  const root = new Node(null, "root");
  root.setPosition(offset[0] + 14.0, offset[1] - 3.0, offset[2] - 40.0);
  root.setAttitude(-12.0, 5.0, 7.0);
  const child = new Node(root, "child");
  root.addChild(child);
  child.setPosition(2.0, 1.5, -6.0);
  child.setAttitude(8.0, -4.0, 3.0);
  addCaptureShape(root, captures, "root");
  addCaptureShape(child, captures, "child");
  return { root, captures };
}

// 原点付近と巨大World offsetで同じ階層を描き、rootとchildのmodelView全要素を比較します
// rootだけが大域位置を減算し、childへ二重にcamera位置を引かないことも同時に確認します
{
  const nearOffset = [10.0, 20.0, -30.0];
  const farOffset = [1.0e11 + 10.0, -2.0e11 + 20.0, 3.0e11 - 30.0];
  const nearScene = buildHierarchy(nearOffset);
  const farScene = buildHierarchy(farOffset);
  nearScene.root.draw(makeCamera(nearOffset), null, 0);
  farScene.root.draw(makeCamera(farOffset), null, 0);
  assert.equal(nearScene.captures.length, 2);
  assert.equal(farScene.captures.length, 2);
  for (let captureIndex = 0; captureIndex < 2; captureIndex += 1) {
    assert.equal(farScene.captures[captureIndex].label, nearScene.captures[captureIndex].label);
    for (let matrixIndex = 0; matrixIndex < 16; matrixIndex += 1) {
      assertAlmostEqual(farScene.captures[captureIndex].modelView.mat[matrixIndex],
        nearScene.captures[captureIndex].modelView.mat[matrixIndex], 2.0e-5,
        `${farScene.captures[captureIndex].label} modelView[${matrixIndex}]`);
    }
    assert.equal(farScene.captures[captureIndex].normal.mat[12], 0.0);
    assert.equal(farScene.captures[captureIndex].normal.mat[13], 0.0);
    assert.equal(farScene.captures[captureIndex].normal.mat[14], 0.0);
  }
}

// 旧view Matrixを渡して暗黙に従来経路へ戻ることを禁止します
{
  const root = new Node(null, "invalid-root");
  assert.throws(() => root.draw(new Matrix(), null, 0), /requires a CameraFrame/);
}

console.log("node_camera_relative_contracts: all hierarchy contracts passed");
