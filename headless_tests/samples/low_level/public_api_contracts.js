// ---------------------------------------------------------
// headless_tests/samples/low_level/headless_probe.js  2026/07/13
//   Public low-level camera facade contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Matrix from "../../../webg/Matrix.js";
import Space from "../../../webg/Space.js";

function assertAlmostEqual(actual, expected, tolerance, label) {
  const difference = Math.abs(actual - expected);
  assert.ok(
    difference <= tolerance,
    `${label}: actual=${actual} expected=${expected} difference=${difference}`
  );
}

// 公開4引数projectionがnear=1、far=0のReverse-Zを作り、Convention指定を要求しません
{
  const near = 0.1;
  const far = 1000.0;
  const projection = new Matrix().makeProjectionMatrix(near, far, 55.0, 16.0 / 9.0);
  const projectDepth = (distance) => {
    const viewZ = -distance;
    const clipZ = projection.mat[10] * viewZ + projection.mat[14];
    const clipW = projection.mat[11] * viewZ + projection.mat[15];
    return clipZ / clipW;
  };
  assertAlmostEqual(projectDepth(near), 1.0, 1.0e-14, "public projection near");
  assertAlmostEqual(projectDepth(far), 0.0, 1.0e-14, "public projection far");
}

// Space.draw(eye)だけで巨大World座標のobjectをcamera-relative model-viewへ変換します
// CameraFrameやDepthConventionを生成するコードは利用側に置きません
{
  const base = 1.0e10;
  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(base, -base, base);
  const object = space.addNode(null, "object");
  object.setPosition(base + 2.0, -base - 3.0, base - 20.0);

  let capturedModelView = null;
  object.shapes.push({
    shaderParameter() {},
    draw(modelView) { capturedModelView = modelView.clone(); }
  });
  space.draw(eye);
  assert.ok(capturedModelView);
  assert.deepEqual(capturedModelView.getPosition(), [2.0, -3.0, -20.0]);
}

// 実sampleが内部実装classをimportせず、従来どおりの公開構文を維持することを確認します
{
  const source = readFileSync(new URL("../../../samples/low_level/main.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CameraFrame|RenderFrameToken|renderFrameToken|DepthConvention|CAMERA_REVERSE_Z/);
  assert.match(source, /projection\.makeProjectionMatrix\(\s*0\.1,\s*1000\.0,/);
  assert.match(source, /screen\.clear\(\);\s*space\.draw\(eye\);\s*screen\.present\(\);/);
}

console.log("sample_low_level_public_api_contracts: all simple camera facade contracts passed");
