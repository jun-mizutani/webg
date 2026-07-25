// ---------------------------------------------------------
// headless_tests/core/space/headless_probe.js  2026/07/13
//   Space frame and light coordinate contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame, { createRenderFrameToken } from "../../../webg/CameraFrame.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";
import Space from "../../../webg/Space.js";

function assertVec(actual, expected, tolerance, label) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    const difference = Math.abs(actual[index] - expected[index]);
    assert.ok(difference <= tolerance,
      `${label}[${index}]: actual=${actual[index]} expected=${expected[index]} difference=${difference}`);
  }
}

function makeFrame(position, attitude = [0.0, 0.0, 0.0]) {
  const camera = new Matrix();
  camera.setByEuler(attitude[0], attitude[1], attitude[2]);
  camera.position(position);
  return new CameraFrame({ cameraWorldMatrix: camera, near: 0.1, far: Infinity,
    vfov: 60.0, aspect: 1.5, depthConvention: CAMERA_REVERSE_Z });
}

// point lightはWorld positionからcamera位置を引いたview-space pointとしてroot Nodeへ渡されます
// 3x3方向変換だけを使った旧方式では巨大World値が残るため、この期待値には一致しません
{
  const cameraPosition = [1.0e10, -2.0e10, 3.0e10];
  const frame = makeFrame(cameraPosition);
  const captured = [];
  const space = new Space();
  space.nodes.push({ parent: null, draw(receivedFrame, lightVec, count) {
    captured.push({ receivedFrame, lightVec, count });
  }});
  space.setLight({ getWorldPosition: () => [cameraPosition[0] + 4.0,
    cameraPosition[1] - 2.0, cameraPosition[2] - 15.0] });
  space.setLightType(1.0);
  space.draw(frame);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].receivedFrame, frame);
  assertVec(captured[0].lightVec, [4.0, -2.0, -15.0, 1.0], 0.0, "point light");
  assert.equal(captured[0].count, 0);
  assert.equal(space.count(), 1);
}

// depth依存の複数passはrenderFrameTokenを渡し、内部で同じ完全なCameraFrameを共有します
{
  const frame = makeFrame([3.0e10, -4.0e10, 5.0e10]);
  const renderFrameToken = createRenderFrameToken(frame);
  let capturedFrame = null;
  const space = new Space();
  space.nodes.push({
    parent: null,
    draw(receivedFrame) { capturedFrame = receivedFrame; }
  });
  space.draw(renderFrameToken);
  assert.equal(capturedFrame, frame);
}

// directional lightはWorld方向をCamera Frameの逆回転だけでview-spaceへ移します
// カメラとライトの平行移動を変えても結果が変化しないことを確認します
{
  const frame = makeFrame([7.0e9, 8.0e9, -9.0e9], [35.0, -12.0, 6.0]);
  const lightWorld = new Matrix();
  lightWorld.setByEuler(-20.0, 15.0, 3.0);
  lightWorld.position([-4.0e11, 2.0e11, 8.0e11]);
  const expectedWorld = lightWorld.mul3x3Vector([0.0, 0.0, 1.0]);
  const expectedView = frame.viewRotationMatrix.mul3x3Vector(expectedWorld);
  let capturedLight = null;
  const space = new Space();
  space.nodes.push({ parent: null, draw(_frame, lightVec) { capturedLight = lightVec; }});
  space.setLight({ worldMatrix: lightWorld, setWorldMatrix() {} });
  space.setLightType(0.0);
  space.draw(frame);
  assertVec(capturedLight, [...expectedView, 0.0], 1.0e-14, "directional light");
}

// 低レベル公開APIのSpace.draw(eye)は内部transform snapshotを一度作り、
// CameraFrameを構築しなくても巨大World座標をcamera-relative化します
{
  const cameraPosition = [4.0e11, -5.0e11, 6.0e11];
  const eyeWorld = new Matrix();
  eyeWorld.position(cameraPosition);
  const eye = {
    count: 0,
    worldMatrix: eyeWorld,
    setWorldMatrix() { this.count += 1; }
  };
  let capturedFrame = null;
  const space = new Space();
  space.nodes.push({
    parent: null,
    draw(receivedFrame) { capturedFrame = receivedFrame; }
  });
  space.draw(eye);
  assert.equal(eye.count, 1);
  assert.ok(capturedFrame);
  assert.equal("projectionMatrix" in capturedFrame, false);
  assertVec(
    capturedFrame.worldPointToCameraRelative([
      cameraPosition[0] + 0.25,
      cameraPosition[1] - 0.5,
      cameraPosition[2] + 1.0
    ]),
    [0.25, -0.5, 1.0],
    0.0,
    "low-level eye relative"
  );
}

// webg 1.0互換経路ではsetEye()で登録した既定eyeを引数なしのdraw()が使います
{
  const defaultWorld = new Matrix();
  defaultWorld.position([12.0, 34.0, 56.0]);
  const defaultEye = {
    count: 0,
    worldMatrix: defaultWorld,
    setWorldMatrix() { this.count += 1; }
  };
  const explicitWorld = new Matrix();
  explicitWorld.position([65.0, 43.0, 21.0]);
  const explicitEye = {
    count: 0,
    worldMatrix: explicitWorld,
    setWorldMatrix() { this.count += 1; }
  };
  const receivedPositions = [];
  const space = new Space();
  space.nodes.push({
    parent: null,
    draw(receivedFrame) {
      receivedPositions.push(receivedFrame.cameraWorldPosition);
    }
  });
  assert.equal(space.setEye(defaultEye), space);
  space.draw();
  assert.equal(defaultEye.count, 1);
  assert.deepEqual(receivedPositions[0], [12.0, 34.0, 56.0]);

  // draw()へ明示したeyeは既定eyeより優先します
  space.draw(explicitEye);
  assert.equal(defaultEye.count, 1);
  assert.equal(explicitEye.count, 1);
  assert.deepEqual(receivedPositions[1], [65.0, 43.0, 21.0]);
}

// 既定eyeがない引数省略、不完全なeye、旧view Matrixは受け入れません
{
  const space = new Space();
  assert.throws(() => space.draw(), /requires an eye Node or render frame/);
  assert.throws(
    () => space.setEye(null),
    /Space\.setEye requires an eye Node/
  );
  assert.throws(
    () => space.setEye({ setWorldMatrix() {} }),
    /Space\.setEye requires an eye Node/
  );
  assert.throws(
    () => space.draw({ setWorldMatrix() {} }),
    /requires an eye Node or render frame/
  );
  assert.throws(
    () => space.draw(new Matrix()),
    /requires an eye Node or render frame/
  );
}

console.log("space_camera_relative_contracts: all frame and light contracts passed");
