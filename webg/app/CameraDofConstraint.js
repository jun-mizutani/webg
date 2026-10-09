// ---------------------------------------------
//  CameraDofConstraint.js  2026/09/09
//   Interactive camera boundary for the core high-level runtime
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "../util.js";

// 3要素vectorを単位vectorへ変換し、view forwardとの距離計算へ使います
// 無効な方向を受け取った場合は、入力条件をその場で知らせます
function normalizeVector(value, label) {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${label} must be a vec3`);
  }
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length <= 1.0e-8) {
    throw new Error(`${label} must have positive length`);
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

// EyeRigの現在のeye Nodeとfocus referenceから、正面方向の合焦距離を求めます
// CameraFrameを作る前の入力制限段階で使うため、world座標とeye forwardだけを参照します
function readInteractiveFocusDistance(eyeRig) {
  const reference = eyeRig.getFocusReference();
  if (reference === null) return null;
  if (reference.mode === "camera-forward" || reference.mode === "view-distance") {
    return util.readFiniteNumber(
      reference.distance,
      "CameraDofConstraint focus reference distance",
      { minExclusive: 0.0 }
    );
  }
  if (!Array.isArray(reference.worldPoint) || reference.worldPoint.length < 3) {
    throw new Error("CameraDofConstraint focus reference must provide worldPoint");
  }
  const eyeNode = eyeRig.getEyeNode?.();
  if (!eyeNode?.getWorldMatrix) {
    throw new Error("CameraDofConstraint requires EyeRig eye Node");
  }
  const world = eyeNode.getWorldMatrix();
  const eyePosition = world.getPosition();
  const forward = normalizeVector(
    world.mul3x3Vector([0.0, 0.0, -1.0]),
    "CameraDofConstraint eye forward"
  );
  const toTarget = [
    reference.worldPoint[0] - eyePosition[0],
    reference.worldPoint[1] - eyePosition[1],
    reference.worldPoint[2] - eyePosition[2]
  ];
  return util.readFiniteNumber(
    toTarget[0] * forward[0] + toTarget[1] * forward[1] + toTarget[2] * forward[2],
    "CameraDofConstraint focus distance"
  );
}

// EyeRigの各モードで変更前状態を保存し、ユーザ操作で範囲を越えた候補姿勢を戻せるようにします
// 入力経路はupdate()へ集約し、プログラムからのsetter入力は既存のエラー検証へ渡します
function captureEyeRigState(eyeRig) {
  const mode = eyeRig.getType?.();
  const state = eyeRig.getModeState?.(mode) ?? eyeRig[mode];
  if (!state) throw new Error(`CameraDofConstraint ${mode} state is unavailable`);
  if (mode === "orbit") {
    return {
      mode,
      target: [...state.target],
      yaw: state.yaw,
      pitch: state.pitch,
      roll: state.roll,
      lookYaw: state.lookYaw,
      lookPitch: state.lookPitch,
      lookRoll: state.lookRoll,
      distance: state.distance
    };
  }
  if (mode === "first-person") {
    return {
      mode,
      position: [...state.position],
      bodyYaw: state.bodyYaw,
      bodyPitch: state.bodyPitch,
      bodyRoll: state.bodyRoll,
      lookYaw: state.lookYaw,
      lookPitch: state.lookPitch,
      lookRoll: state.lookRoll,
      eyeHeight: state.eyeHeight
    };
  }
  if (mode === "follow") {
    if (!state.trackingQuat?.clone || !state.lookQuat?.clone) {
      throw new Error("CameraDofConstraint follow state requires quaternions");
    }
    return {
      mode,
      basePosition: [...state.basePosition],
      baseAttitude: [...state.baseAttitude],
      yaw: state.yaw,
      pitch: state.pitch,
      roll: state.roll,
      lookYaw: state.lookYaw,
      lookPitch: state.lookPitch,
      lookRoll: state.lookRoll,
      distance: state.distance,
      trackingQuat: state.trackingQuat.clone(),
      lookQuat: state.lookQuat.clone(),
      initialized: state.initialized,
      lastAngularErrorDeg: state.lastAngularErrorDeg,
      lastViewDot: state.lastViewDot
    };
  }
  throw new Error(`CameraDofConstraint unsupported EyeRig type: ${mode}`);
}

// 保存したEyeRig状態を各モードのNode階層へ戻し、許可された直前の視点を保ちます
// followの追跡用Quaternionも復元し、次frameの補間履歴を候補姿勢から分離します
function restoreEyeRigState(eyeRig, snapshot) {
  const state = eyeRig.getModeState?.(snapshot.mode) ?? eyeRig[snapshot.mode];
  if (!state) throw new Error(`CameraDofConstraint ${snapshot.mode} state is unavailable`);
  if (snapshot.mode === "orbit") {
    state.target = [...snapshot.target];
    state.yaw = snapshot.yaw;
    state.pitch = snapshot.pitch;
    state.roll = snapshot.roll;
    state.lookYaw = snapshot.lookYaw;
    state.lookPitch = snapshot.lookPitch;
    state.lookRoll = snapshot.lookRoll;
    state.distance = snapshot.distance;
  } else if (snapshot.mode === "first-person") {
    state.position = [...snapshot.position];
    state.bodyYaw = snapshot.bodyYaw;
    state.bodyPitch = snapshot.bodyPitch;
    state.bodyRoll = snapshot.bodyRoll;
    state.lookYaw = snapshot.lookYaw;
    state.lookPitch = snapshot.lookPitch;
    state.lookRoll = snapshot.lookRoll;
    state.eyeHeight = snapshot.eyeHeight;
  } else if (snapshot.mode === "follow") {
    state.basePosition = [...snapshot.basePosition];
    state.baseAttitude = [...snapshot.baseAttitude];
    state.yaw = snapshot.yaw;
    state.pitch = snapshot.pitch;
    state.roll = snapshot.roll;
    state.lookYaw = snapshot.lookYaw;
    state.lookPitch = snapshot.lookPitch;
    state.lookRoll = snapshot.lookRoll;
    state.distance = snapshot.distance;
    state.trackingQuat.copyFrom(snapshot.trackingQuat);
    state.lookQuat.copyFrom(snapshot.lookQuat);
    state.initialized = snapshot.initialized;
    state.lastAngularErrorDeg = snapshot.lastAngularErrorDeg;
    state.lastViewDot = snapshot.lastViewDot;
  } else {
    throw new Error(`CameraDofConstraint unsupported EyeRig type: ${snapshot.mode}`);
  }
  eyeRig.apply();
}

// DoFの公開rangeをユーザ操作の最小合焦距離へ変換します
// epsilonは浮動小数点境界での同値判定を避け、PbrRendererのstrictな条件と同じ向きを保ちます
function readConstraintOptions(options = {}) {
  const source = util.readPlainObject(options, "CameraDofConstraint options", {});
  const minFocusDistance = util.readFiniteNumber(
    source.minFocusDistance,
    "CameraDofConstraint minFocusDistance",
    { minExclusive: 0.0 }
  );
  const epsilon = util.readOptionalFiniteNumber(
    source.epsilon,
    "CameraDofConstraint epsilon",
    1.0e-3,
    { min: 0.0 }
  );
  return {
    minFocusDistance,
    acceptedFocusDistance: minFocusDistance + epsilon,
    epsilon
  };
}

// Orbit、first-person、followのユーザ操作をDoFの合焦範囲へ接続します
// wheel、キー、ドラッグ、pinch、PANはEyeRig.update()へ集約されるため、候補姿勢を一つの境界で検査します
export function installCameraDofConstraint(eyeRig, options = {}) {
  if (!eyeRig || typeof eyeRig.update !== "function" || typeof eyeRig.apply !== "function") {
    throw new Error("CameraDofConstraint requires an EyeRig-like object");
  }
  const mode = eyeRig.getType?.();
  if (!["orbit", "first-person", "follow"].includes(mode)) {
    throw new Error(`CameraDofConstraint unsupported EyeRig type: ${mode}`);
  }
  if (eyeRig.__webgCameraDofConstraint) {
    throw new Error("CameraDofConstraint is already installed");
  }
  const constraint = readConstraintOptions(options);
  const originalUpdate = eyeRig.update;
  const initialFocusDistance = readInteractiveFocusDistance(eyeRig);
  if (initialFocusDistance === null) {
    throw new Error("CameraDofConstraint requires an enabled EyeRig focus reference");
  }
  if (initialFocusDistance <= constraint.acceptedFocusDistance) {
    throw new Error(
      `CameraDofConstraint focus center ${initialFocusDistance} must be farther than focus range ${constraint.minFocusDistance}`
    );
  }
  const state = {
    blocked: false,
    lastFocusDistance: null,
    rejectedCount: 0
  };
  const wrappedUpdate = function wrappedCameraDofUpdate(deltaSec) {
    const before = captureEyeRigState(eyeRig);
    const beforeFocusDistance = readInteractiveFocusDistance(eyeRig);
    if (beforeFocusDistance === null) {
      throw new Error("CameraDofConstraint requires an enabled EyeRig focus reference");
    }
    if (beforeFocusDistance <= constraint.acceptedFocusDistance) {
      throw new Error(
        `CameraDofConstraint focus center ${beforeFocusDistance} must be farther than focus range ${constraint.minFocusDistance}`
      );
    }
    originalUpdate.call(eyeRig, deltaSec);
    const focusDistance = readInteractiveFocusDistance(eyeRig);
    state.lastFocusDistance = focusDistance;
    if (focusDistance <= constraint.acceptedFocusDistance) {
      restoreEyeRigState(eyeRig, before);
      const restoredFocusDistance = readInteractiveFocusDistance(eyeRig);
      if (restoredFocusDistance <= constraint.acceptedFocusDistance) {
        throw new Error(
          `CameraDofConstraint restored focus center ${restoredFocusDistance} must be farther than focus range ${constraint.minFocusDistance}`
        );
      }
      state.blocked = true;
      state.rejectedCount += 1;
    } else {
      state.blocked = false;
    }
    return eyeRig;
  };
  eyeRig.update = wrappedUpdate;
  const handle = {
    // DoF境界で停止した回数と直近の合焦距離を取得し、UIや診断表示へ渡します
    getDiagnostics() {
      return Object.freeze({
        mode,
        minFocusDistance: constraint.minFocusDistance,
        acceptedFocusDistance: constraint.acceptedFocusDistance,
        epsilon: constraint.epsilon,
        blocked: state.blocked,
        lastFocusDistance: state.lastFocusDistance,
        rejectedCount: state.rejectedCount
      });
    },
    // EyeRig.updateを元の関数へ戻し、constraintが保持する参照を解放します
    destroy() {
      if (eyeRig.update === wrappedUpdate) eyeRig.update = originalUpdate;
      if (eyeRig.__webgCameraDofConstraint === handle) delete eyeRig.__webgCameraDofConstraint;
      return true;
    }
  };
  eyeRig.__webgCameraDofConstraint = handle;
  return Object.freeze(handle);
}
