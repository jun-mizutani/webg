// ---------------------------------------------------------
// headless_tests/core/camera_frame/headless_probe.js  2026/07/13
//   Numeric contracts for camera-relative frame coordinates
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame, {
  createCameraFrameFromEye,
  createCameraTransformFrameFromEye
} from "../../../webg/CameraFrame.js";
import { CAMERA_REVERSE_Z, SHADOW_STANDARD_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

function assertAlmostEqual(actual, expected, tolerance, label) {
  const scale = Math.max(1.0, Math.abs(actual), Math.abs(expected));
  const difference = Math.abs(actual - expected);
  assert.ok(difference <= tolerance * scale,
    `${label}: actual=${actual} expected=${expected} difference=${difference}`);
}

function assertVec3(actual, expected, tolerance, label) {
  for (let index = 0; index < 3; index += 1) {
    assertAlmostEqual(actual[index], expected[index], tolerance, `${label}[${index}]`);
  }
}

function makeTransform(position, attitude = [0.0, 0.0, 0.0]) {
  const matrix = new Matrix();
  matrix.setByEuler(attitude[0], attitude[1], attitude[2]);
  matrix.position(position);
  return matrix;
}

function createFrame(cameraWorldMatrix) {
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.125,
    far: Infinity,
    vfov: 67.0,
    aspect: 16.0 / 9.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

// 大きなWorld値をfloat32へ落とす前に差を取るため、0.25mの相対差が維持されます
// 先にfloat32化する誤った順序では同じ入力の差が0になることも併記して検出します
{
  const base = 1.0e9;
  const camera = makeTransform([base, -base, base]);
  const frame = createFrame(camera);
  const worldPoint = [base + 0.25, -base - 0.5, base + 1.0];
  assertVec3(frame.worldPointToCameraRelative(worldPoint), [0.25, -0.5, 1.0], 0.0,
    "double relative");
  assertVec3(frame.worldPointToCameraRelativeF32(worldPoint), [0.25, -0.5, 1.0], 0.0,
    "float32 after relative");
  const wrongX = Math.fround(worldPoint[0]) - Math.fround(base);
  assert.equal(wrongX, 0.0, "float32-before-subtract must demonstrate lost 0.25m offset");
}

// 回転した巨大座標カメラでも、camera localで指定したpointが同じview-space値へ戻ります
{
  const cameraPosition = [1.0e12, -2.0e12, 3.0e12];
  const camera = makeTransform(cameraPosition, [37.0, -18.0, 11.0]);
  const frame = createFrame(camera);
  const expectedView = [4.0, -2.0, -25.0];
  const worldOffset = camera.mul3x3Vector(expectedView);
  const worldPoint = [
    cameraPosition[0] + worldOffset[0],
    cameraPosition[1] + worldOffset[1],
    cameraPosition[2] + worldOffset[2]
  ];
  // 1e12付近のbinary64量子幅はNumber.EPSILON×1e12≒2.22e-4mなので、
  // その範囲内である2.5e-4mを絶対値1未満にも適用できる相対引数として使います
  assertVec3(frame.worldPointToView(worldPoint), expectedView, 2.5e-4, "rotated huge view");
}

// 原点付近と巨大World位置に同じ相対配置を作り、生成model-view行列の全要素を比較します
// 回転とscaleを含むため、平行移動だけを特別扱いして3x3を壊す回帰も検出できます
{
  const cameraNear = makeTransform([10.0, 20.0, -30.0], [25.0, -7.0, 3.0]);
  const objectNear = makeTransform([14.0, 18.0, -50.0], [-12.0, 6.0, 9.0]);
  const offset = [1.0e11, -3.0e11, 5.0e11];
  const cameraFar = cameraNear.clone();
  const objectFar = objectNear.clone();
  cameraFar.position(cameraNear.getPosition().map((value, index) => value + offset[index]));
  objectFar.position(objectNear.getPosition().map((value, index) => value + offset[index]));
  const nearModelView = createFrame(cameraNear).createModelViewMatrix(objectNear);
  const farModelView = createFrame(cameraFar).createModelViewMatrix(objectFar);
  for (let index = 0; index < 16; index += 1) {
    assertAlmostEqual(farModelView.mat[index], nearModelView.mat[index], 2.0e-6,
      `origin-independent modelView[${index}]`);
  }
}

// 現行Nodeと同じview×modelの倍精度合成とcamera-relative結果の差を測定します
// 回転scaleの3x3は一致しますが、巨大な平行移動を一般行列で相殺すると追加誤差が出ることを固定します
{
  const camera = makeTransform([8.0e10, -9.0e10, 7.0e10], [13.0, 4.0, -8.0]);
  const object = makeTransform([8.0e10 + 12.0, -9.0e10 - 3.0, 7.0e10 - 40.0], [2.0, 7.0, 5.0]);
  const conventional = object.clone();
  const view = camera.clone();
  view.inverse();
  conventional.lmul(view);
  const explicit = createFrame(camera).createModelViewMatrix(object);
  for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
    assertAlmostEqual(explicit.mat[index], conventional.mat[index], 1.0e-14,
      `Node-compatible rotation[${index}]`);
  }
  const translationDifference = Math.hypot(
    explicit.mat[12] - conventional.mat[12],
    explicit.mat[13] - conventional.mat[13],
    explicit.mat[14] - conventional.mat[14]
  );
  assert.ok(translationDifference > 1.0e-6,
    `conventional matrix cancellation must be observable: ${translationDifference}`);
  assert.ok(translationDifference < 1.0e-3,
    `conventional matrix cancellation exceeded binary64 scale: ${translationDifference}`);
}

// Camera Frameは通常カメラ専用であり、Shadow Map conventionや不正行列を受け入れません
{
  const camera = makeTransform([0.0, 0.0, 0.0]);
  assert.throws(() => new CameraFrame({ cameraWorldMatrix: camera, near: 0.1, far: 100.0,
    vfov: 60.0, aspect: 1.0, depthConvention: SHADOW_STANDARD_Z }),
  /requires CAMERA_REVERSE_Z/);
  assert.throws(() => createFrame({ mat: [1.0, 2.0] }), /must be a 4x4 Matrix/);
}

// eyeのWorld matrix更新はframe生成時に一度だけ行われ、snapshotは後のeye変更から独立します
{
  const eye = {
    count: 0,
    worldMatrix: makeTransform([100.0, 200.0, 300.0]),
    setWorldMatrix() { this.count += 1; }
  };
  const frame = createCameraFrameFromEye(eye, {
    near: 0.1, far: 1000.0, vfov: 60.0, aspect: 1.0,
    depthConvention: CAMERA_REVERSE_Z
  });
  assert.equal(eye.count, 1);
  eye.worldMatrix.position([0.0, 0.0, 0.0]);
  assert.deepEqual(frame.cameraWorldPosition, [100.0, 200.0, 300.0]);
}

// 低レベルSpace用transform snapshotはprojection知識を要求せず、完全なCameraFrameと
// 同じcamera-relative変換結果を作ります。内部objectへnear/farやDepthConventionは露出しません
{
  const world = makeTransform([1.0e12, -2.0e12, 3.0e12], [31.0, -14.0, 8.0]);
  const eye = {
    count: 0,
    worldMatrix: world,
    setWorldMatrix() { this.count += 1; }
  };
  const transform = createCameraTransformFrameFromEye(eye);
  const complete = createFrame(world);
  assert.equal(eye.count, 1);
  assert.equal("projectionMatrix" in transform, false);
  assert.equal("depthConvention" in transform, false);
  assert.equal("near" in transform, false);
  assert.equal("far" in transform, false);

  const objectWorld = makeTransform(
    [1.0e12 + 16.0, -2.0e12 - 4.0, 3.0e12 - 50.0],
    [-7.0, 4.0, 2.0]
  );
  const transformModelView = transform.createModelViewMatrix(objectWorld);
  const completeModelView = complete.createModelViewMatrix(objectWorld);
  for (let index = 0; index < 16; index += 1) {
    assertAlmostEqual(
      transformModelView.mat[index],
      completeModelView.mat[index],
      0.0,
      `low-level transform modelView[${index}]`
    );
  }
}

console.log("camera_frame_api_contracts: all camera-relative contracts passed");
