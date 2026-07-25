// ---------------------------------------------
// headless_tests/core/eye_rig/headless_probe.js  2026/06/19
//   EyeRig coordinate and tracking contract probe
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import assert from "node:assert/strict";
import CoordinateSystem from "../../../webg/CoordinateSystem.js";
import EyeRig from "../../../webg/EyeRig.js";

// parent -> base -> rod -> eyeの最小階層を作る
// WebGPUや描画Nodeを使わず、EyeRigが担当するlocal変換だけを検証する
const createRigNodes = () => {
  const parent = new CoordinateSystem(null, "camera-parent");
  const base = new CoordinateSystem(parent, "camera-base");
  const rod = new CoordinateSystem(base, "camera-rod");
  const eye = new CoordinateSystem(rod, "camera-eye");
  return { parent, base, rod, eye };
};

// 3要素vectorが指定誤差内で一致することを確認する
// assertion失敗時には実測値と期待値を並べ、座標系のずれを追跡しやすくする
const assertVec3 = (actual, expected, epsilon, label) => {
  for (let index = 0; index < 3; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= epsilon,
      `${label}[${index}] actual=${actual[index]} expected=${expected[index]}`
    );
  }
};

// eyeのworld前方とtarget方向の内積を返す
// 1.0に近いほど、EyeRigが求めた姿勢でtargetを正確に注視している
const getViewDot = (eye, targetWorld) => {
  const eyeWorld = eye.getWorldPosition();
  const forward = eye.getWorldMatrix().mul3x3Vector([0.0, 0.0, -1.0]);
  const toTarget = [
    targetWorld[0] - eyeWorld[0],
    targetWorld[1] - eyeWorld[1],
    targetWorld[2] - eyeWorld[2]
  ];
  const forwardLength = Math.hypot(...forward);
  const targetLength = Math.hypot(...toTarget);
  return (
    forward[0] * toTarget[0]
    + forward[1] * toTarget[1]
    + forward[2] * toTarget[2]
  ) / (forwardLength * targetLength);
};

// Followがtarget位置へbaseを移動せず、eye姿勢だけで注視することを確認する
// targetOffsetはtargetNodeのlocal座標としてworld変換されることも同時に固定する
const testFollowTracksWithEyeOrientation = () => {
  const { base, rod, eye } = createRigNodes();
  const target = new CoordinateSystem(null, "follow-target");
  target.setPosition(8.0, 5.0, -12.0);
  target.setAttitude(35.0, -8.0, 12.0);

  const rig = new EyeRig(base, rod, eye, {
    type: "follow",
    follow: {
      targetNode: target,
      targetOffset: [0.0, 1.5, -2.0],
      basePosition: [1.0, 2.0, 3.0],
      baseAttitude: [5.0, -3.0, 2.0],
      distance: 7.0,
      response: 6.0,
      maxAngularSpeed: 240.0,
      upReference: "base"
    }
  });

  rig.update(1.0 / 60.0);
  assertVec3(base.getPosition(), [1.0, 2.0, 3.0], 1.0e-8, "follow base");
  const expectedTarget = target.getWorldMatrix().mulVector([0.0, 1.5, -2.0]);
  assertVec3(
    rig.getFollowTargetWorldPosition(),
    expectedTarget,
    1.0e-8,
    "follow local targetOffset"
  );
  assert.ok(
    getViewDot(eye, expectedTarget) > 0.999999,
    `follow initial view dot=${getViewDot(eye, expectedTarget)}`
  );

  target.setPosition(-10.0, 7.0, 5.0);
  rig.update(1.0 / 60.0);
  assert.ok(
    rig.follow.lastAngularErrorDeg > 0.0,
    "follow must report angular error after target movement"
  );
  for (let frame = 0; frame < 180; frame += 1) {
    rig.update(1.0 / 60.0);
  }
  assert.ok(
    rig.follow.lastViewDot > 0.9999,
    `follow converged view dot=${rig.follow.lastViewDot}`
  );
};

// First Personのpointer水平差分がbodyYawではなくlookYawへ入ることを確認する
// character進行方向と独立した見回しを、入力処理の契約として固定する
const testFirstPersonPointerChangesLookYaw = () => {
  const { base, rod, eye } = createRigNodes();
  const rig = new EyeRig(base, rod, eye, {
    type: "first-person",
    firstPerson: {
      bodyYaw: 180.0,
      lookYaw: 0.0,
      dragRotateSpeed: 0.2
    }
  });
  rig.dragging = true;
  rig.pointerId = 1;
  rig.lastClientX = 100.0;
  rig.lastClientY = 100.0;
  rig.onPointerMove({
    pointerId: 1,
    pointerType: "mouse",
    clientX: 150.0,
    clientY: 100.0,
    preventDefault() {}
  });
  assert.equal(rig.firstPerson.bodyYaw, 180.0);
  assert.equal(rig.firstPerson.lookYaw, 10.0);
};

// First Person のW/D移動が、body姿勢で回転したlocal -Z / +Xと一致することを確認する
// 0度や180度だけでは符号誤りを見落とすため、斜め方向と90度方向を含む複数yawで固定する
const testFirstPersonMovementMatchesBodyAxes = () => {
  const yawAngles = [0.0, 45.0, 90.0, 180.0, -90.0];
  const movementCases = [
    { key: "w", localAxis: [0.0, 0.0, -1.0], label: "forward" },
    { key: "d", localAxis: [1.0, 0.0, 0.0], label: "right" }
  ];

  for (const yaw of yawAngles) {
    for (const movement of movementCases) {
      const { base, rod, eye } = createRigNodes();
      const activeKeys = new Set([movement.key]);
      const rig = new EyeRig(base, rod, eye, {
        input: { has: (key) => activeKeys.has(key) },
        type: "first-person",
        firstPerson: {
          bodyYaw: yaw,
          moveSpeed: 1.0,
          runMultiplier: 1.0
        }
      });
      const expected = base.getWorldMatrix().mul3x3Vector(movement.localAxis);

      rig.update(1.0);

      assertVec3(
        rig.firstPerson.position,
        expected,
        1.0e-8,
        `first-person ${movement.label} yaw=${yaw}`
      );
    }
  }
};

// 回転した親の下でもOrbit PANが有限のbase local移動量へ変換されることを確認する
// world画面軸をorbit.targetへ直接加えて親回転を二重適用する回帰を検出する
const testOrbitPanUnderRotatedParent = () => {
  const { parent, base, rod, eye } = createRigNodes();
  parent.setAttitude(55.0, 18.0, -12.0);
  const rig = new EyeRig(base, rod, eye, {
    type: "orbit",
    element: {
      clientWidth: 800,
      clientHeight: 600
    },
    orbit: {
      target: [0.0, 1.0, 0.0],
      distance: 12.0,
      yaw: 25.0,
      pitch: -15.0
    }
  });
  const before = [...rig.orbit.target];
  rig.panViewByScreenDelta(40.0, -20.0);
  const after = rig.orbit.target;
  assert.ok(after.every(Number.isFinite), `orbit target=${JSON.stringify(after)}`);
  assert.notDeepEqual(after, before);
};

// 初回から追跡方向とup方向が平行な場合は、姿勢を一意に決められないことを確認する
// 直前姿勢がない初期状態を暗黙のright軸で補わず、設定誤りとして例外にする
const testFollowRejectsInitialParallelUp = () => {
  const { base, rod, eye } = createRigNodes();
  const target = new CoordinateSystem(null, "parallel-target");
  target.setPosition(0.0, 10.0, 0.0);
  const rig = new EyeRig(base, rod, eye, {
    type: "follow",
    follow: {
      targetNode: target,
      basePosition: [0.0, 0.0, 0.0],
      distance: 5.0,
      upReference: "world"
    }
  });
  const eyeWorld = eye.getWorldPosition();
  target.setPosition(eyeWorld[0], eyeWorld[1] + 10.0, eyeWorld[2]);
  rig.resetFollowTracking();
  assert.throws(
    () => rig.update(1.0 / 60.0),
    /initial target direction is parallel to upReference/
  );
};

testFollowTracksWithEyeOrientation();
testFirstPersonPointerChangesLookYaw();
testFirstPersonMovementMatchesBodyAxes();
testOrbitPanUnderRotatedParent();
testFollowRejectsInitialParallelUp();

console.log("PASS EyeRig headless contracts");
