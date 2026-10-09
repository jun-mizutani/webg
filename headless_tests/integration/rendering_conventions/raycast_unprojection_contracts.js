// -----------------------------------------------------------------------------
// headless_tests/integration/rendering_conventions/raycast_unprojection_contracts.js  2026/10/04
//   Reverse-Z screen-point ray unprojection contracts
// -----------------------------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Matrix from "../../../webg/Matrix.js";
import Space from "../../../webg/Space.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";

const raycastMainPath = new URL("../../../unittest/raycast/main.js", import.meta.url);
const raycastMain = readFileSync(raycastMainPath, "utf8");
const collisionChapterPath = new URL("../../../book/15_衝突判定とクエリ.md", import.meta.url);
const collisionChapter = readFileSync(collisionChapterPath, "utf8");
// 行列合成の詳しい規則は、描画内部を扱う41章の説明と照合する
const graphicsChapterPath = new URL("../../../book/41_描画内部の共通規則.md", import.meta.url);
const graphicsChapter = readFileSync(graphicsChapterPath, "utf8");

// unittestが透視成分を含む4×4行列全体を合成することをソース上でも確認する
// Reverse-Zの両端は共通定義を参照し、near/farの意味を一致させる
assert.match(raycastMain, /import\s*\{\s*CAMERA_REVERSE_Z\s*\}/);
assert.match(raycastMain, /invVp\.mul_\(view\)/);
assert.doesNotMatch(raycastMain, /invVp\.mul\(view\)/);
assert.match(raycastMain, /CAMERA_REVERSE_Z\.nearDepth/);
assert.match(raycastMain, /CAMERA_REVERSE_Z\.farDepth/);

// 書籍の実装例も実行コードと同じ行列合成とReverse-Z depthを説明する
// Space.raycastの現行optionと、透視成分を保つ行列合成の説明を確認する
assert.match(collisionChapter, /import\s*\{\s*CAMERA_REVERSE_Z\s*\}/);
assert.match(collisionChapter, /invVp\.mul_\(view\)/);
assert.doesNotMatch(collisionChapter, /invVp\.mul\(view\)/);
assert.match(collisionChapter, /CAMERA_REVERSE_Z\.nearDepth/);
assert.match(collisionChapter, /CAMERA_REVERSE_Z\.farDepth/);
assert.doesNotMatch(collisionChapter, /最大距離、hidden/);
assert.match(graphicsChapter, /projectionとviewを合成するときは`Matrix\.mul_\(\)`/);

// 実画面と同じcamera、projection、cube中心を使ってworld rayを数値検査する
// cube中心を一度NDCへ投影し、同じNDCから逆投影したrayが元の中心方向へ戻ることを確認する
const space = new Space();
const eye = space.addNode(null, "eye");
eye.setPosition(0, 14, 45);
eye.rotateX(-9);
eye.setWorldMatrix();

const view = new Matrix();
view.makeView(eye.worldMatrix);
const projection = new Matrix();
projection.makeProjectionMatrix(0.1, 1000, 52, 1280 / 720);

const viewProjection = projection.clone();
viewProjection.mul_(view);

const cubeCenter = [-16, 0, -18];
const cubeNdc = viewProjection.mulVector(cubeCenter);
const inverseViewProjection = viewProjection.clone();
inverseViewProjection.inverse_strict();

const nearPoint = inverseViewProjection.mulVector([
  cubeNdc[0],
  cubeNdc[1],
  CAMERA_REVERSE_Z.nearDepth
]);
const farPoint = inverseViewProjection.mulVector([
  cubeNdc[0],
  cubeNdc[1],
  CAMERA_REVERSE_Z.farDepth
]);
const eyePosition = eye.getWorldPosition();

function normalizeDirection(from, to) {
  const direction = [
    to[0] - from[0],
    to[1] - from[1],
    to[2] - from[2]
  ];
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  assert.ok(length > 0.0, "ray direction must have a positive length");
  return direction.map((component) => component / length);
}

const expectedDirection = normalizeDirection(eyePosition, cubeCenter);
const nearDirection = normalizeDirection(eyePosition, nearPoint);
const farDirection = normalizeDirection(eyePosition, farPoint);

// near/farは同じ視線上にあり、どちらから作った方向もcube中心方向と一致する
for (let axis = 0; axis < 3; axis++) {
  assert.ok(Math.abs(nearDirection[axis] - expectedDirection[axis]) < 1.0e-6);
  assert.ok(Math.abs(farDirection[axis] - expectedDirection[axis]) < 1.0e-6);
}

console.log("rendering_conventions_raycast_unprojection_contracts: Reverse-Z ray points toward projected cube");
