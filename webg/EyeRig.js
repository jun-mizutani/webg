// ---------------------------------------------
// EyeRig.js      2026/07/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// EyeRig:
// - `base -> rod -> eye` の3段構成だけを扱う視点 helper
// - `type` により orbit / first-person / follow を切り替える
// - `setAngles()` は base/rod 側の向き、`setLookAngles()` は eye の独立視線を表す
// - pointer 入力は mouse / pen / touch を同じ入口で扱う
// - Follow は camera の基準位置を target から独立させ、eye の姿勢だけで滑らかに注視追跡する
import Matrix from "./Matrix.js";
import Quat from "./Quat.js";
import util from "./util.js";

export default class EyeRig {
  // インスタンス生成時に、受け取った設定を検証して初期状態を準備する
  constructor(baseNode, rodNode, eyeNode, options = {}) {
    this.baseNode = baseNode ?? null;
    this.rodNode = rodNode ?? null;
    this.eyeNode = eyeNode ?? null;
    this.doc = options.document ?? (typeof document !== "undefined" ? document : null);
    this.element = options.element ?? (this.doc ? this.doc.getElementById("canvas") : null);
    this.input = options.input ?? null;
    this.enabled = options.enabled !== false;
    this.type = util.readEnumOption(
      [{ value: options.type, label: "options.type" }],
      "type",
      "orbit",
      ["orbit", "first-person", "follow"]
    );
    this.dragButton = util.readFiniteOption(
      [{ value: options.dragButton, label: "options.dragButton" }],
      "dragButton",
      0,
      { integer: true, min: 0 }
    );
    this.alternateDragButton = util.readFiniteOption(
      [
        {
          value: options.alternateDragButton ?? undefined,
          label: "options.alternateDragButton"
        }
      ],
      "alternateDragButton",
      null,
      { integer: true, min: 0 }
    );
    this.alternateDragModifierKey = util.readKeyOption(
      [
        {
          value: options.alternateDragModifierKey ?? undefined,
          label: "options.alternateDragModifierKey"
        }
      ],
      "alternateDragModifierKey",
      null
    );

    this.orbit = {
      target: util.readVec3Option(
        [
          { value: options.orbit?.target, label: "options.orbit.target" },
          { value: options.target, label: "options.target" }
        ],
        "orbit.target",
        [0.0, 0.0, 0.0]
      ),
      yaw: util.readFiniteOption(
        [
          { value: options.orbit?.yaw, label: "options.orbit.yaw" },
          { value: options.yaw, label: "options.yaw" }
        ],
        "orbit.yaw",
        0.0
      ),
      pitch: util.readFiniteOption(
        [
          { value: options.orbit?.pitch, label: "options.orbit.pitch" },
          { value: options.pitch, label: "options.pitch" }
        ],
        "orbit.pitch",
        0.0
      ),
      roll: util.readFiniteOption(
        [
          { value: options.orbit?.roll, label: "options.orbit.roll" },
          { value: options.roll, label: "options.roll" }
        ],
        "orbit.roll",
        0.0
      ),
      lookYaw: util.readFiniteOption(
        [{ value: options.orbit?.lookYaw, label: "options.orbit.lookYaw" }],
        "orbit.lookYaw",
        0.0
      ),
      lookPitch: util.readFiniteOption(
        [{ value: options.orbit?.lookPitch, label: "options.orbit.lookPitch" }],
        "orbit.lookPitch",
        0.0
      ),
      lookRoll: util.readFiniteOption(
        [{ value: options.orbit?.lookRoll, label: "options.orbit.lookRoll" }],
        "orbit.lookRoll",
        0.0
      ),
      distance: util.readFiniteOption(
        [
          { value: options.orbit?.distance, label: "options.orbit.distance" },
          { value: options.distance, label: "options.distance" }
        ],
        "orbit.distance",
        28.0,
        { minExclusive: 0.0 }
      ),
      minDistance: util.readFiniteOption(
        [{ value: options.orbit?.minDistance, label: "options.orbit.minDistance" }],
        "orbit.minDistance",
        4.0,
        { minExclusive: 0.0 }
      ),
      maxDistance: util.readFiniteOption(
        [{ value: options.orbit?.maxDistance, label: "options.orbit.maxDistance" }],
        "orbit.maxDistance",
        180.0,
        { minExclusive: 0.0 }
      ),
      keyRotateSpeed: util.readFiniteOption(
        [{ value: options.orbit?.keyRotateSpeed, label: "options.orbit.keyRotateSpeed" }],
        "orbit.keyRotateSpeed",
        72.0,
        { min: 0.0 }
      ),
      keyZoomSpeed: util.readFiniteOption(
        [{ value: options.orbit?.keyZoomSpeed, label: "options.orbit.keyZoomSpeed" }],
        "orbit.keyZoomSpeed",
        18.0,
        { min: 0.0 }
      ),
      dragRotateSpeed: util.readFiniteOption(
        [{ value: options.orbit?.dragRotateSpeed, label: "options.orbit.dragRotateSpeed" }],
        "orbit.dragRotateSpeed",
        0.28,
        { min: 0.0 }
      ),
      dragPanSpeed: util.readFiniteOption(
        [{ value: options.orbit?.dragPanSpeed, label: "options.orbit.dragPanSpeed" }],
        "orbit.dragPanSpeed",
        2.0,
        { min: 0.0 }
      ),
      pinchZoomSpeed: util.readFiniteOption(
        [{ value: options.orbit?.pinchZoomSpeed, label: "options.orbit.pinchZoomSpeed" }],
        "orbit.pinchZoomSpeed",
        2.2,
        { min: 0.0 }
      ),
      wheelZoomStep: util.readFiniteOption(
        [{ value: options.orbit?.wheelZoomStep, label: "options.orbit.wheelZoomStep" }],
        "orbit.wheelZoomStep",
        1.8,
        { min: 0.0 }
      ),
      panModifierKey: util.readKeyOption(
        [{ value: options.orbit?.panModifierKey, label: "options.orbit.panModifierKey" }],
        "orbit.panModifierKey",
        "shift"
      ),
      dragZoomModifierKey: util.readKeyOption(
        [{
          value: options.orbit?.dragZoomModifierKey ?? undefined,
          label: "options.orbit.dragZoomModifierKey"
        }],
        "orbit.dragZoomModifierKey",
        null
      ),
      dragZoomSpeed: util.readFiniteOption(
        [{ value: options.orbit?.dragZoomSpeed, label: "options.orbit.dragZoomSpeed" }],
        "orbit.dragZoomSpeed",
        0.01,
        { min: 0.0 }
      ),
      rotationInputMode: util.readEnumOption(
        [{ value: options.orbit?.rotationInputMode, label: "options.orbit.rotationInputMode" }],
        "orbit.rotationInputMode",
        "camera-view",
        ["euler", "camera-view"]
      ),
      pitchMin: util.readFiniteOption(
        [{ value: options.orbit?.pitchMin, label: "options.orbit.pitchMin" }],
        "orbit.pitchMin",
        -85.0
      ),
      pitchMax: util.readFiniteOption(
        [{ value: options.orbit?.pitchMax, label: "options.orbit.pitchMax" }],
        "orbit.pitchMax",
        85.0
      ),
      keyMap: {
        left: util.readKeyOption(
          [{ value: options.orbit?.keyMap?.left, label: "options.orbit.keyMap.left" }],
          "orbit.keyMap.left",
          "arrowleft"
        ),
        right: util.readKeyOption(
          [{ value: options.orbit?.keyMap?.right, label: "options.orbit.keyMap.right" }],
          "orbit.keyMap.right",
          "arrowright"
        ),
        up: util.readKeyOption(
          [{ value: options.orbit?.keyMap?.up, label: "options.orbit.keyMap.up" }],
          "orbit.keyMap.up",
          "arrowup"
        ),
        down: util.readKeyOption(
          [{ value: options.orbit?.keyMap?.down, label: "options.orbit.keyMap.down" }],
          "orbit.keyMap.down",
          "arrowdown"
        ),
        zoomIn: util.readKeyOption(
          [{ value: options.orbit?.keyMap?.zoomIn, label: "options.orbit.keyMap.zoomIn" }],
          "orbit.keyMap.zoomIn",
          "["
        ),
        zoomOut: util.readKeyOption(
          [{ value: options.orbit?.keyMap?.zoomOut, label: "options.orbit.keyMap.zoomOut" }],
          "orbit.keyMap.zoomOut",
          "]"
        )
      }
    };
    this.setupOrbitQuaternionState();

    this.firstPerson = {
      position: util.readVec3Option(
        [
          { value: options.firstPerson?.position, label: "options.firstPerson.position" },
          { value: options.position, label: "options.position" }
        ],
        "firstPerson.position",
        [0.0, 0.0, 0.0]
      ),
      bodyYaw: util.readFiniteOption(
        [
          { value: options.firstPerson?.bodyYaw, label: "options.firstPerson.bodyYaw" },
          { value: options.yaw, label: "options.yaw" }
        ],
        "firstPerson.bodyYaw",
        0.0
      ),
      bodyPitch: util.readFiniteOption(
        [{ value: options.firstPerson?.bodyPitch, label: "options.firstPerson.bodyPitch" }],
        "firstPerson.bodyPitch",
        0.0
      ),
      bodyRoll: util.readFiniteOption(
        [{ value: options.firstPerson?.bodyRoll, label: "options.firstPerson.bodyRoll" }],
        "firstPerson.bodyRoll",
        0.0
      ),
      lookYaw: util.readFiniteOption(
        [
          { value: options.firstPerson?.lookYaw, label: "options.firstPerson.lookYaw" }
        ],
        "firstPerson.lookYaw",
        0.0
      ),
      lookPitch: util.readFiniteOption(
        [
          { value: options.firstPerson?.lookPitch, label: "options.firstPerson.lookPitch" },
          { value: options.pitch, label: "options.pitch" }
        ],
        "firstPerson.lookPitch",
        0.0
      ),
      lookRoll: util.readFiniteOption(
        [
          { value: options.firstPerson?.lookRoll, label: "options.firstPerson.lookRoll" },
          { value: options.roll, label: "options.roll" }
        ],
        "firstPerson.lookRoll",
        0.0
      ),
      eyeHeight: util.readFiniteOption(
        [{ value: options.firstPerson?.eyeHeight, label: "options.firstPerson.eyeHeight" }],
        "firstPerson.eyeHeight",
        1.6
      ),
      moveSpeed: util.readFiniteOption(
        [{ value: options.firstPerson?.moveSpeed, label: "options.firstPerson.moveSpeed" }],
        "firstPerson.moveSpeed",
        10.0,
        { min: 0.0 }
      ),
      runMultiplier: util.readFiniteOption(
        [{ value: options.firstPerson?.runMultiplier, label: "options.firstPerson.runMultiplier" }],
        "firstPerson.runMultiplier",
        2.0,
        { min: 0.0 }
      ),
      dragRotateSpeed: util.readFiniteOption(
        [{ value: options.firstPerson?.dragRotateSpeed, label: "options.firstPerson.dragRotateSpeed" }],
        "firstPerson.dragRotateSpeed",
        0.20,
        { min: 0.0 }
      ),
      lookPitchMin: util.readFiniteOption(
        [{ value: options.firstPerson?.lookPitchMin, label: "options.firstPerson.lookPitchMin" }],
        "firstPerson.lookPitchMin",
        -85.0
      ),
      lookPitchMax: util.readFiniteOption(
        [{ value: options.firstPerson?.lookPitchMax, label: "options.firstPerson.lookPitchMax" }],
        "firstPerson.lookPitchMax",
        85.0
      ),
      keyMap: {
        forward: util.readKeyOption(
          [{ value: options.firstPerson?.keyMap?.forward, label: "options.firstPerson.keyMap.forward" }],
          "firstPerson.keyMap.forward",
          "w"
        ),
        back: util.readKeyOption(
          [{ value: options.firstPerson?.keyMap?.back, label: "options.firstPerson.keyMap.back" }],
          "firstPerson.keyMap.back",
          "s"
        ),
        left: util.readKeyOption(
          [{ value: options.firstPerson?.keyMap?.left, label: "options.firstPerson.keyMap.left" }],
          "firstPerson.keyMap.left",
          "a"
        ),
        right: util.readKeyOption(
          [{ value: options.firstPerson?.keyMap?.right, label: "options.firstPerson.keyMap.right" }],
          "firstPerson.keyMap.right",
          "d"
        ),
        up: util.readKeyOption(
          [{ value: options.firstPerson?.keyMap?.up, label: "options.firstPerson.keyMap.up" }],
          "firstPerson.keyMap.up",
          "e"
        ),
        down: util.readKeyOption(
          [{ value: options.firstPerson?.keyMap?.down, label: "options.firstPerson.keyMap.down" }],
          "firstPerson.keyMap.down",
          "q"
        ),
        run: util.readKeyOption(
          [{ value: options.firstPerson?.keyMap?.run, label: "options.firstPerson.keyMap.run" }],
          "firstPerson.keyMap.run",
          "shift"
        )
      }
    };

    this.follow = {
      targetNode: options.follow?.targetNode ?? options.targetNode ?? null,
      targetOffset: util.readVec3Option(
        [{ value: options.follow?.targetOffset, label: "options.follow.targetOffset" }],
        "follow.targetOffset",
        [0.0, 0.0, 0.0]
      ),
      basePosition: util.readVec3Option(
        [{ value: options.follow?.basePosition, label: "options.follow.basePosition" }],
        "follow.basePosition",
        [0.0, 0.0, 0.0]
      ),
      baseAttitude: util.readVec3Option(
        [{ value: options.follow?.baseAttitude, label: "options.follow.baseAttitude" }],
        "follow.baseAttitude",
        [0.0, 0.0, 0.0]
      ),
      yaw: util.readFiniteOption(
        [
          { value: options.follow?.yaw, label: "options.follow.yaw" },
          { value: options.yaw, label: "options.yaw" }
        ],
        "follow.yaw",
        0.0
      ),
      pitch: util.readFiniteOption(
        [
          { value: options.follow?.pitch, label: "options.follow.pitch" },
          { value: options.pitch, label: "options.pitch" }
        ],
        "follow.pitch",
        -12.0
      ),
      roll: util.readFiniteOption(
        [
          { value: options.follow?.roll, label: "options.follow.roll" },
          { value: options.roll, label: "options.roll" }
        ],
        "follow.roll",
        0.0
      ),
      lookYaw: util.readFiniteOption(
        [
          { value: options.follow?.lookYaw, label: "options.follow.lookYaw" }
        ],
        "follow.lookYaw",
        0.0
      ),
      lookPitch: util.readFiniteOption(
        [{ value: options.follow?.lookPitch, label: "options.follow.lookPitch" }],
        "follow.lookPitch",
        0.0
      ),
      lookRoll: util.readFiniteOption(
        [{ value: options.follow?.lookRoll, label: "options.follow.lookRoll" }],
        "follow.lookRoll",
        0.0
      ),
      distance: util.readFiniteOption(
        [
          { value: options.follow?.distance, label: "options.follow.distance" },
          { value: options.distance, label: "options.distance" }
        ],
        "follow.distance",
        18.0,
        { minExclusive: 0.0 }
      ),
      minDistance: util.readFiniteOption(
        [{ value: options.follow?.minDistance, label: "options.follow.minDistance" }],
        "follow.minDistance",
        3.0,
        { minExclusive: 0.0 }
      ),
      maxDistance: util.readFiniteOption(
        [{ value: options.follow?.maxDistance, label: "options.follow.maxDistance" }],
        "follow.maxDistance",
        120.0,
        { minExclusive: 0.0 }
      ),
      keyRotateSpeed: util.readFiniteOption(
        [{ value: options.follow?.keyRotateSpeed, label: "options.follow.keyRotateSpeed" }],
        "follow.keyRotateSpeed",
        72.0,
        { min: 0.0 }
      ),
      keyZoomSpeed: util.readFiniteOption(
        [{ value: options.follow?.keyZoomSpeed, label: "options.follow.keyZoomSpeed" }],
        "follow.keyZoomSpeed",
        16.0,
        { min: 0.0 }
      ),
      dragRotateSpeed: util.readFiniteOption(
        [{ value: options.follow?.dragRotateSpeed, label: "options.follow.dragRotateSpeed" }],
        "follow.dragRotateSpeed",
        0.28,
        { min: 0.0 }
      ),
      pinchZoomSpeed: util.readFiniteOption(
        [{ value: options.follow?.pinchZoomSpeed, label: "options.follow.pinchZoomSpeed" }],
        "follow.pinchZoomSpeed",
        2.0,
        { min: 0.0 }
      ),
      response: util.readFiniteOption(
        [{ value: options.follow?.response, label: "options.follow.response" }],
        "follow.response",
        6.0,
        { min: 0.0 }
      ),
      maxAngularSpeed: util.readFiniteOption(
        [{ value: options.follow?.maxAngularSpeed, label: "options.follow.maxAngularSpeed" }],
        "follow.maxAngularSpeed",
        240.0,
        { minExclusive: 0.0 }
      ),
      upReference: util.readEnumOption(
        [{ value: options.follow?.upReference, label: "options.follow.upReference" }],
        "follow.upReference",
        "base",
        ["base", "rod", "world"]
      ),
      pitchMin: util.readFiniteOption(
        [{ value: options.follow?.pitchMin, label: "options.follow.pitchMin" }],
        "follow.pitchMin",
        -80.0
      ),
      pitchMax: util.readFiniteOption(
        [{ value: options.follow?.pitchMax, label: "options.follow.pitchMax" }],
        "follow.pitchMax",
        60.0
      ),
      keyMap: {
        left: util.readKeyOption(
          [{ value: options.follow?.keyMap?.left, label: "options.follow.keyMap.left" }],
          "follow.keyMap.left",
          "arrowleft"
        ),
        right: util.readKeyOption(
          [{ value: options.follow?.keyMap?.right, label: "options.follow.keyMap.right" }],
          "follow.keyMap.right",
          "arrowright"
        ),
        up: util.readKeyOption(
          [{ value: options.follow?.keyMap?.up, label: "options.follow.keyMap.up" }],
          "follow.keyMap.up",
          "arrowup"
        ),
        down: util.readKeyOption(
          [{ value: options.follow?.keyMap?.down, label: "options.follow.keyMap.down" }],
          "follow.keyMap.down",
          "arrowdown"
        ),
        zoomIn: util.readKeyOption(
          [{ value: options.follow?.keyMap?.zoomIn, label: "options.follow.keyMap.zoomIn" }],
          "follow.keyMap.zoomIn",
          "["
        ),
        zoomOut: util.readKeyOption(
          [{ value: options.follow?.keyMap?.zoomOut, label: "options.follow.keyMap.zoomOut" }],
          "follow.keyMap.zoomOut",
          "]"
        )
      }
    };
    this.follow.trackingQuat = this.eyeNode?.getQuat?.() ?? new Quat();
    this.follow.lookQuat = this.createQuatFromEuler(
      this.follow.lookYaw,
      this.follow.lookPitch,
      this.follow.lookRoll
    );
    this.follow.initialized = false;
    this.follow.lastAngularErrorDeg = 0.0;
    this.follow.lastViewDot = 0.0;
    if (
      this.follow.targetNode !== null
      && typeof this.follow.targetNode?.getWorldMatrix !== "function"
    ) {
      throw new Error("EyeRig follow targetNode must provide getWorldMatrix()");
    }

    if (this.orbit.minDistance > this.orbit.maxDistance) {
      throw new Error("EyeRig orbit.minDistance must be <= orbit.maxDistance");
    }
    if (this.orbit.pitchMin > this.orbit.pitchMax) {
      throw new Error("EyeRig orbit.pitchMin must be <= orbit.pitchMax");
    }
    if (this.follow.minDistance > this.follow.maxDistance) {
      throw new Error("EyeRig follow.minDistance must be <= follow.maxDistance");
    }
    if (this.follow.pitchMin > this.follow.pitchMax) {
      throw new Error("EyeRig follow.pitchMin must be <= follow.pitchMax");
    }
    if (this.firstPerson.lookPitchMin > this.firstPerson.lookPitchMax) {
      throw new Error("EyeRig firstPerson.lookPitchMin must be <= firstPerson.lookPitchMax");
    }

    this.dragging = false;
    this.pointerId = null;
    this.lastClientX = 0;
    this.lastClientY = 0;
    this.pointerRecords = new Map();
    this.touchGesture = {
      active: false,
      centerX: 0.0,
      centerY: 0.0,
      distance: 0.0
    };
    this.previousTouchAction = null;
    this._boundPointerDown = (ev) => this.onPointerDown(ev);
    this._boundPointerMove = (ev) => this.onPointerMove(ev);
    this._boundPointerUp = (ev) => this.onPointerUp(ev);
    this._boundWheel = (ev) => this.onWheel(ev);
    this._boundAuxClick = (ev) => this.onAuxClick(ev);
    this._boundBlur = () => this.cancelDrag();
    this.apply(true);
  }

  // オイラー角から四元数を生成する
  createQuatFromEuler(yaw, pitch, roll) {
    const quat = new Quat();
    quat.eulerToQuat(yaw, pitch, roll);
    quat.normalize();
    return quat;
  }

  // 回転軸と角度から四元数を生成する
  createQuatFromAxisAngle(axis, degree) {
    const unit = this.normalizeVector(axis);
    const quat = new Quat();
    const halfRad = degree * Math.PI / 180.0 * 0.5;
    const sinHalf = Math.sin(halfRad);
    quat.q[0] = Math.cos(halfRad);
    quat.q[1] = unit[0] * sinHalf;
    quat.q[2] = unit[1] * sinHalf;
    quat.q[3] = unit[2] * sinHalf;
    quat.normalize();
    return quat;
  }

  // `eulerFromQuat`は座標または数値を計算し、後続処理で使う結果を返す
  eulerFromQuat(quat) {
    const matrix = new Matrix();
    matrix.setByQuat(quat);
    return matrix.matToEuler();
  }

  // 周回視点の`quaternion`の状態の初期化段階で、必要な状態と資源を準備して処理を開始する
  setupOrbitQuaternionState() {
    const state = this.orbit;
    state._syncingEulerMirror = false;
    state._attitudeDirty = false;
    state._lookDirty = false;

    // `defineTrackedAngle`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
    const defineTrackedAngle = (key, dirtyKey) => {
      const hiddenKey = `_${key}`;
      state[hiddenKey] = util.readFiniteNumber(state[key], `orbit.${key}`);
      Object.defineProperty(state, key, {
        configurable: true,
        enumerable: true,
        get() {
          return this[hiddenKey];
        },
        set: (value) => {
          state[hiddenKey] = util.readFiniteNumber(value, `orbit.${key}`);
          if (!state._syncingEulerMirror) {
            state[dirtyKey] = true;
          }
        }
      });
    };

    defineTrackedAngle("yaw", "_attitudeDirty");
    defineTrackedAngle("pitch", "_attitudeDirty");
    defineTrackedAngle("roll", "_attitudeDirty");
    defineTrackedAngle("lookYaw", "_lookDirty");
    defineTrackedAngle("lookPitch", "_lookDirty");
    defineTrackedAngle("lookRoll", "_lookDirty");

    state.attitudeQuat = this.createQuatFromEuler(state.yaw, state.pitch, state.roll);
    state.lookQuat = this.createQuatFromEuler(state.lookYaw, state.lookPitch, state.lookRoll);
  }

  // オイラー角から周回視点の四元数を更新する
  syncOrbitQuatsFromEuler() {
    const state = this.orbit;
    if (state._attitudeDirty) {
      state.attitudeQuat = this.createQuatFromEuler(state.yaw, state.pitch, state.roll);
      state._attitudeDirty = false;
    }
    if (state._lookDirty) {
      state.lookQuat = this.createQuatFromEuler(state.lookYaw, state.lookPitch, state.lookRoll);
      state._lookDirty = false;
    }
  }

  // 四元数から周回視点のオイラー角を更新する
  syncOrbitEulerFromQuats() {
    const state = this.orbit;
    const [yaw, pitch, roll] = this.eulerFromQuat(state.attitudeQuat);
    const [lookYaw, lookPitch, lookRoll] = this.eulerFromQuat(state.lookQuat);
    state._syncingEulerMirror = true;
    state.yaw = yaw;
    state.pitch = pitch;
    state.roll = roll;
    state.lookYaw = lookYaw;
    state.lookPitch = lookPitch;
    state.lookRoll = lookRoll;
    state._syncingEulerMirror = false;
    state._attitudeDirty = false;
    state._lookDirty = false;
  }

  // 表示座標系を基準に周回視点の回転を適用する
  applyOrbitRotationByViewAxes(yawDegree, pitchDegree, rollDegree = 0.0) {
    const state = this.orbit;
    this.syncOrbitQuatsFromEuler();
    if (
      Math.abs(yawDegree) <= 1.0e-9
      && Math.abs(pitchDegree) <= 1.0e-9
      && Math.abs(rollDegree) <= 1.0e-9
    ) {
      return false;
    }
    const eyeWorld = this.eyeNode?.getWorldMatrix?.() ?? null;
    if (!eyeWorld) {
      return false;
    }
    const toBaseLocal = (axis, label) => this.normalizeStrict(
      this.worldDirectionToNodeLocal(this.baseNode, axis, label),
      label
    );
    const upAxis = toBaseLocal(
      eyeWorld.mul3x3Vector([0.0, 1.0, 0.0]),
      "orbit view up"
    );
    const rightAxis = toBaseLocal(
      eyeWorld.mul3x3Vector([1.0, 0.0, 0.0]),
      "orbit view right"
    );
    const forwardAxis = toBaseLocal(
      eyeWorld.mul3x3Vector([0.0, 0.0, -1.0]),
      "orbit view forward"
    );
    const next = state.attitudeQuat.clone();
    if (Math.abs(yawDegree) > 1.0e-9) {
      next.lmulQuat(this.createQuatFromAxisAngle(upAxis, yawDegree));
    }
    if (Math.abs(pitchDegree) > 1.0e-9) {
      next.lmulQuat(this.createQuatFromAxisAngle(rightAxis, pitchDegree));
    }
    if (Math.abs(rollDegree) > 1.0e-9) {
      next.lmulQuat(this.createQuatFromAxisAngle(forwardAxis, rollDegree));
    }
    next.normalize();
    state.attitudeQuat = next;
    this.syncOrbitEulerFromQuats();
    return true;
  }

  // `fromNodes`は元データから独立して利用できる複製または実行状態を作る
  static fromNodes(baseNode, eyeNode, options = {}) {
    let rodNode = options.rodNode ?? null;
    if (!rodNode && eyeNode?.getParent) {
      const parent = eyeNode.getParent();
      if (parent && parent !== baseNode) {
        rodNode = parent;
      }
    }
    return new EyeRig(baseNode, rodNode ?? eyeNode, eyeNode, options);
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  lerp(from, to, t) {
    return from + (to - from) * t;
  }

  // 3要素vectorの長さを返す
  // Followの方向vectorと、姿勢を構成する外積軸を同じ基準で検証する
  vectorLength(vector) {
    return Math.hypot(vector[0], vector[1], vector[2]);
  }

  // 3要素vectorを正規化し、方向を決められない入力は例外にする
  // 単位vectorの代用品を返すとcamera姿勢の不具合が隠れるためfallbackは行わない
  normalizeStrict(vector, label) {
    const length = this.vectorLength(vector);
    if (!Number.isFinite(length) || length <= 1.0e-8) {
      throw new Error(`EyeRig ${label} has zero length`);
    }
    return [vector[0] / length, vector[1] / length, vector[2] / length];
  }

  // 2つの3要素vectorの外積を返す
  // Followのright / up / back直交基底を構築するときに使用する
  cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  // 2つの3要素vectorの内積を返す
  // 直前right軸の直交投影と、実際の注視方向を数値確認するときに使用する
  dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  // world方向vectorを指定Nodeのlocal方向へ変換する
  // position成分を含めず、逆world行列の3x3部分だけで方向をそろえる
  worldDirectionToNodeLocal(node, worldDirection, label) {
    if (!node?.getWorldMatrix) {
      throw new Error(`EyeRig ${label} requires a node with getWorldMatrix()`);
    }
    const inverseWorld = node.getWorldMatrix();
    if (!inverseWorld.inverse_strict()) {
      throw new Error(`EyeRig ${label} requires an invertible world matrix`);
    }
    return inverseWorld.mul3x3Vector(worldDirection);
  }

  getBaseNode() {
    return this.baseNode;
  }

  getRodNode() {
    return this.rodNode;
  }

  getEyeNode() {
    return this.eyeNode;
  }

  getType() {
    return this.type;
  }

  // モードの状態を現在の入力と状態から求め、呼び出し元へ返す
  getModeState(type = this.type) {
    if (type === "orbit") return this.orbit;
    if (type === "first-person") return this.firstPerson;
    if (type === "follow") return this.follow;
    return null;
  }

  // `type`を受け取り、現在の設定と後続処理へ反映する
  setType(type) {
    if (type !== "orbit" && type !== "first-person" && type !== "follow") {
      throw new Error(`Unknown EyeRig type: ${type}`);
    }
    this.type = type;
    if (type === "follow") {
      this.resetFollowTracking();
    }
    this.apply();
    return this;
  }

  // 入力を受け取り、現在の設定と後続処理へ反映する
  setInput(inputController) {
    this.input = inputController;
    return this;
  }

  // 要素を受け取り、現在の設定と後続処理へ反映する
  setElement(element) {
    this.detachPointer();
    this.element = element;
    return this;
  }

  // 対象を受け取り、現在の設定と後続処理へ反映する
  setTarget(x, y, z) {
    this.orbit.target[0] = util.readFiniteNumber(x, "target.x");
    this.orbit.target[1] = util.readFiniteNumber(y, "target.y");
    this.orbit.target[2] = util.readFiniteNumber(z, "target.z");
    if (this.type === "orbit") this.apply();
    return this;
  }

  // 位置を受け取り、現在の設定と後続処理へ反映する
  setPosition(x, y, z) {
    this.firstPerson.position[0] = util.readFiniteNumber(x, "position.x");
    this.firstPerson.position[1] = util.readFiniteNumber(y, "position.y");
    this.firstPerson.position[2] = util.readFiniteNumber(z, "position.z");
    if (this.type === "first-person") this.apply();
    return this;
  }

  // 対象のノードを受け取り、現在の設定と後続処理へ反映する
  setTargetNode(targetNode) {
    if (targetNode !== null && typeof targetNode?.getWorldMatrix !== "function") {
      throw new Error("EyeRig follow targetNode must provide getWorldMatrix()");
    }
    this.follow.targetNode = targetNode;
    this.resetFollowTracking();
    return this;
  }

  // 対象の`offset`を受け取り、現在の設定と後続処理へ反映する
  setTargetOffset(x, y, z) {
    this.follow.targetOffset[0] = util.readFiniteNumber(x, "targetOffset.x");
    this.follow.targetOffset[1] = util.readFiniteNumber(y, "targetOffset.y");
    this.follow.targetOffset[2] = util.readFiniteNumber(z, "targetOffset.z");
    this.resetFollowTracking();
    return this;
  }

  // 距離を受け取り、現在の設定と後続処理へ反映する
  setDistance(distance) {
    const numeric = util.readFiniteNumber(distance, "distance");
    if (this.type === "follow") {
      if (numeric < this.follow.minDistance || numeric > this.follow.maxDistance) {
        throw new Error(`EyeRig distance must be within ${this.follow.minDistance} - ${this.follow.maxDistance}`);
      }
      this.follow.distance = numeric;
    } else {
      if (numeric < this.orbit.minDistance || numeric > this.orbit.maxDistance) {
        throw new Error(`EyeRig distance must be within ${this.orbit.minDistance} - ${this.orbit.maxDistance}`);
      }
      this.orbit.distance = numeric;
    }
    this.apply();
    return this;
  }

  // `setAngles` は eye ではなく base/rod 側の向きを操作する
  setAngles(yaw, pitch, roll = 0.0) {
    const nextYaw = util.readFiniteNumber(yaw, "angles.yaw");
    const nextPitch = util.readFiniteNumber(pitch, "angles.pitch");
    const nextRoll = util.readFiniteNumber(roll, "angles.roll");
    if (this.type === "orbit") {
      if (nextPitch < this.orbit.pitchMin || nextPitch > this.orbit.pitchMax) {
        throw new Error(`EyeRig orbit pitch must be within ${this.orbit.pitchMin} - ${this.orbit.pitchMax}`);
      }
      this.orbit.yaw = nextYaw;
      this.orbit.pitch = nextPitch;
      this.orbit.roll = nextRoll;
    } else if (this.type === "first-person") {
      this.firstPerson.bodyYaw = nextYaw;
      this.firstPerson.bodyPitch = nextPitch;
      this.firstPerson.bodyRoll = nextRoll;
    } else {
      if (nextPitch < this.follow.pitchMin || nextPitch > this.follow.pitchMax) {
        throw new Error(`EyeRig follow pitch must be within ${this.follow.pitchMin} - ${this.follow.pitchMax}`);
      }
      this.follow.yaw = nextYaw;
      this.follow.pitch = nextPitch;
      this.follow.roll = nextRoll;
    }
    this.apply();
    return this;
  }

  // 進行方向とは独立した camera の向きは eye 側へ与える
  setLookAngles(yaw, pitch, roll = 0.0) {
    const nextYaw = util.readFiniteNumber(yaw, "lookAngles.yaw");
    const nextPitch = util.readFiniteNumber(pitch, "lookAngles.pitch");
    const nextRoll = util.readFiniteNumber(roll, "lookAngles.roll");
    if (this.type === "orbit") {
      this.orbit.lookYaw = nextYaw;
      this.orbit.lookPitch = nextPitch;
      this.orbit.lookRoll = nextRoll;
    } else if (this.type === "first-person") {
      if (nextPitch < this.firstPerson.lookPitchMin || nextPitch > this.firstPerson.lookPitchMax) {
        throw new Error(`EyeRig firstPerson lookPitch must be within ${this.firstPerson.lookPitchMin} - ${this.firstPerson.lookPitchMax}`);
      }
      this.firstPerson.lookYaw = nextYaw;
      this.firstPerson.lookPitch = nextPitch;
      this.firstPerson.lookRoll = nextRoll;
    } else {
      this.follow.lookYaw = nextYaw;
      this.follow.lookPitch = nextPitch;
      this.follow.lookRoll = nextRoll;
      this.follow.lookQuat = this.createQuatFromEuler(nextYaw, nextPitch, nextRoll);
    }
    this.apply();
    return this;
  }

  // 表示上の移動量に合わせて周回視点を回転する
  rotateOrbitByViewDelta(yawDegree, pitchDegree) {
    if (this.type !== "orbit") {
      return this;
    }
    this.applyOrbitRotationByViewAxes(
      util.readFiniteNumber(yawDegree, "orbitViewDelta.yaw"),
      util.readFiniteNumber(pitchDegree, "orbitViewDelta.pitch"),
      0.0
    );
    this.apply();
    return this;
  }

  // 表示座標系を基準に周回視点をロール回転する
  rotateOrbitByViewRoll(rollDegree) {
    if (this.type !== "orbit") {
      return this;
    }
    this.applyOrbitRotationByViewAxes(
      0.0,
      0.0,
      util.readFiniteNumber(rollDegree, "orbitViewRoll.roll")
    );
    this.apply();
    return this;
  }

  // 視点の高さを受け取り、現在の設定と後続処理へ反映する
  setEyeHeight(height) {
    this.firstPerson.eyeHeight = util.readFiniteNumber(height, "eyeHeight");
    if (this.type === "first-person") this.apply();
    return this;
  }

  // `rod`の`length`を受け取り、現在の設定と後続処理へ反映する
  setRodLength(length) {
    const numeric = util.readFiniteNumber(length, "rodLength");
    if (this.type === "follow") {
      if (numeric < this.follow.minDistance || numeric > this.follow.maxDistance) {
        throw new Error(`EyeRig rodLength must be within ${this.follow.minDistance} - ${this.follow.maxDistance}`);
      }
      this.follow.distance = numeric;
    } else {
      if (numeric < this.orbit.minDistance || numeric > this.orbit.maxDistance) {
        throw new Error(`EyeRig rodLength must be within ${this.orbit.minDistance} - ${this.orbit.maxDistance}`);
      }
      this.orbit.distance = numeric;
    }
    this.apply();
    return this;
  }

  // targetOffsetをtargetNodeのlocal座標としてworld位置へ変換する
  // targetNodeが回転しても座席や頭部など同じlocal位置を追跡できる
  getFollowTargetWorldPosition() {
    const targetNode = this.follow.targetNode;
    if (!targetNode?.getWorldMatrix) {
      throw new Error("EyeRig follow requires targetNode");
    }
    return targetNode.getWorldMatrix().mulVector(this.follow.targetOffset);
  }

  // upReferenceで選んだworld上方向をrod local座標へ変換する
  // 目標eye姿勢をrod local quaternionとして設定するため、方向vectorも同じ空間へそろえる
  getFollowUpInRodLocal(inverseRodWorld) {
    let upWorld = [0.0, 1.0, 0.0];
    if (this.follow.upReference === "base") {
      upWorld = this.baseNode.getWorldMatrix().mul3x3Vector([0.0, 1.0, 0.0]);
    } else if (this.follow.upReference === "rod") {
      upWorld = this.rodNode.getWorldMatrix().mul3x3Vector([0.0, 1.0, 0.0]);
    }
    return this.normalizeStrict(
      inverseRodWorld.mul3x3Vector(upWorld),
      "follow up direction"
    );
  }

  // forwardとupから、local -Zが対象を向くeye quaternionを構築する
  // 追跡方向とupがほぼ平行な継続frameでは、直前right軸を投影してrollの連続性を保つ
  createFollowTargetQuat(forwardLocal, upLocal) {
    const forward = this.normalizeStrict(forwardLocal, "follow target direction");
    const back = [-forward[0], -forward[1], -forward[2]];
    let right = this.cross(forward, upLocal);

    if (this.vectorLength(right) <= 1.0e-6) {
      if (!this.follow.initialized) {
        throw new Error(
          "EyeRig follow initial target direction is parallel to upReference"
        );
      }
      const previousMatrix = new Matrix();
      previousMatrix.setByQuat(this.follow.trackingQuat);
      const previousRight = previousMatrix.mul3x3Vector([1.0, 0.0, 0.0]);
      const parallel = this.dot(previousRight, forward);
      right = [
        previousRight[0] - forward[0] * parallel,
        previousRight[1] - forward[1] * parallel,
        previousRight[2] - forward[2] * parallel
      ];
    }

    right = this.normalizeStrict(right, "follow right direction");
    const cameraUp = this.normalizeStrict(
      this.cross(back, right),
      "follow camera up direction"
    );
    const rotation = new Matrix();
    rotation.setBulk([
      right[0], right[1], right[2], 0.0,
      cameraUp[0], cameraUp[1], cameraUp[2], 0.0,
      back[0], back[1], back[2], 0.0,
      0.0, 0.0, 0.0, 1.0
    ]);
    const targetQuat = new Quat();
    targetQuat.matrixToQuat(rotation);
    return targetQuat;
  }

  // 現在のrod座標系からtargetを向くeye local quaternionを求める
  // baseやrodのworld姿勢を逆変換し、eyeへ設定できるlocal姿勢として返す
  resolveFollowTargetQuat() {
    const rodWorld = this.rodNode.getWorldMatrix();
    const inverseRodWorld = rodWorld.clone();
    if (!inverseRodWorld.inverse_strict()) {
      throw new Error("EyeRig follow rod world matrix is not invertible");
    }
    const targetLocal = inverseRodWorld.mulVector(this.getFollowTargetWorldPosition());
    const eyeLocal = this.eyeNode.getPosition();
    const forwardLocal = [
      targetLocal[0] - eyeLocal[0],
      targetLocal[1] - eyeLocal[1],
      targetLocal[2] - eyeLocal[2]
    ];
    return this.createFollowTargetQuat(
      forwardLocal,
      this.getFollowUpInRodLocal(inverseRodWorld)
    );
  }

  // quaternion間の最短回転角をdegreeで返す
  // response補間と最大角速度制限のうち、厳しい方を選ぶ比率計算に使用する
  quaternionAngleDeg(a, b) {
    const absoluteDot = Math.min(1.0, Math.abs(a.dotProduct(b)));
    return 2.0 * Math.acos(absoluteDot) * 180.0 / Math.PI;
  }

  // 自動追跡姿勢へ利用者指定のlook角をlocal補正として後置合成する
  // look角はtarget追跡を止めず、注視方向から意図的に視線をずらす用途に使用する
  composeFollowEyeQuat() {
    const composed = this.follow.trackingQuat.clone();
    composed.mulQuat(this.follow.lookQuat);
    composed.normalize();
    return composed;
  }

  // Followの基準位置、rod角度、eye距離と追跡姿勢を各Nodeへ反映する
  // target位置はbaseへコピーせず、camera anchorと追跡対象を独立させる
  applyFollowNodes() {
    const state = this.follow;
    this.baseNode.setPosition(...state.basePosition);
    this.baseNode.setAttitude(...state.baseAttitude);
    this.rodNode.setPosition(0.0, 0.0, 0.0);
    this.rodNode.setAttitude(state.yaw, state.pitch, state.roll);
    this.eyeNode.setPosition(0.0, 0.0, state.distance);
    this.eyeNode.setQuat(this.composeFollowEyeQuat());
  }

  // このインスタンスを対象の状態または描画設定へ反映する
  apply(force = false) {
    if (!this.enabled && !force) return this;
    if (!this.baseNode || !this.rodNode || !this.eyeNode) return this;

    if (this.type === "orbit") {
      const state = this.orbit;
      this.syncOrbitQuatsFromEuler();
      this.baseNode.setPosition(state.target[0], state.target[1], state.target[2]);
      this.baseNode.setAttitude(0.0, 0.0, 0.0);
      this.rodNode.setPosition(0.0, 0.0, 0.0);
      this.rodNode.setQuat(state.attitudeQuat);
      this.eyeNode.setPosition(0.0, 0.0, state.distance);
      this.eyeNode.setQuat(state.lookQuat);
      return this;
    }

    if (this.type === "first-person") {
      const state = this.firstPerson;
      this.baseNode.setPosition(state.position[0], state.position[1], state.position[2]);
      this.baseNode.setAttitude(state.bodyYaw, state.bodyPitch, state.bodyRoll);
      this.rodNode.setPosition(0.0, state.eyeHeight, 0.0);
      this.rodNode.setAttitude(0.0, 0.0, 0.0);
      this.eyeNode.setPosition(0.0, 0.0, 0.0);
      this.eyeNode.setAttitude(state.lookYaw, state.lookPitch, state.lookRoll);
      return this;
    }

    this.applyFollowNodes();
    return this;
  }

  // このインスタンスを現在の入力と実行状態に合わせて更新する
  update(deltaSec) {
    util.readFiniteNumber(deltaSec, "deltaSec");
    if (!this.enabled) return this;
    if (this.type === "orbit") {
      this.updateOrbit(deltaSec);
      return this;
    }
    if (this.type === "first-person") {
      this.updateFirstPerson(deltaSec);
      return this;
    }
    this.updateFollow(deltaSec);
    return this;
  }

  // 周回視点を現在の入力と実行状態に合わせて更新する
  updateOrbit(deltaSec) {
    if (!this.input) return;
    const state = this.orbit;
    const dt = Number.isFinite(deltaSec) ? deltaSec : 0.0;
    const shiftPan = this.isModifierKeyActive(state.panModifierKey);
    let changed = false;
    if (shiftPan) {
      let panX = 0.0;
      let panY = 0.0;
      if (this.input.has(state.keyMap.left)) panX -= 1.0;
      if (this.input.has(state.keyMap.right)) panX += 1.0;
      if (this.input.has(state.keyMap.up)) panY += 1.0;
      if (this.input.has(state.keyMap.down)) panY -= 1.0;
      if (panX !== 0.0 || panY !== 0.0) {
        this.panViewByScreenDelta(
          panX * state.keyRotateSpeed * dt,
          panY * state.keyRotateSpeed * dt
        );
        changed = true;
      }
    } else {
      if (state.rotationInputMode === "camera-view") {
        let yawDelta = 0.0;
        let pitchDelta = 0.0;
        if (this.input.has(state.keyMap.left)) yawDelta -= state.keyRotateSpeed * dt;
        if (this.input.has(state.keyMap.right)) yawDelta += state.keyRotateSpeed * dt;
        if (this.input.has(state.keyMap.up)) pitchDelta += state.keyRotateSpeed * dt;
        if (this.input.has(state.keyMap.down)) pitchDelta -= state.keyRotateSpeed * dt;
        changed = this.applyOrbitRotationByViewAxes(yawDelta, pitchDelta, 0.0) || changed;
      } else {
        if (this.input.has(state.keyMap.left)) {
          state.yaw -= state.keyRotateSpeed * dt;
          changed = true;
        }
        if (this.input.has(state.keyMap.right)) {
          state.yaw += state.keyRotateSpeed * dt;
          changed = true;
        }
        if (this.input.has(state.keyMap.up)) {
          state.pitch = this.clamp(state.pitch + state.keyRotateSpeed * dt, state.pitchMin, state.pitchMax);
          changed = true;
        }
        if (this.input.has(state.keyMap.down)) {
          state.pitch = this.clamp(state.pitch - state.keyRotateSpeed * dt, state.pitchMin, state.pitchMax);
          changed = true;
        }
      }
    }
    if (this.input.has(state.keyMap.zoomIn)) {
      state.distance = this.clamp(
        state.distance - state.keyZoomSpeed * this.getZoomSensitivityScale() * dt,
        state.minDistance,
        state.maxDistance
      );
      changed = true;
    }
    if (this.input.has(state.keyMap.zoomOut)) {
      state.distance = this.clamp(
        state.distance + state.keyZoomSpeed * this.getZoomSensitivityScale() * dt,
        state.minDistance,
        state.maxDistance
      );
      changed = true;
    }
    if (changed) this.apply();
  }

  // `first`の`person`を現在の入力と実行状態に合わせて更新する
  updateFirstPerson(deltaSec) {
    if (!this.input) return;
    const state = this.firstPerson;
    const dt = Number.isFinite(deltaSec) ? deltaSec : 0.0;
    const speed = state.moveSpeed * (this.input.has(state.keyMap.run) ? state.runMultiplier : 1.0);

    // bodyYaw は base の local Y 軸回転であり、移動方向は独立視線の lookYaw ではなく body の姿勢に従う
    // camera の前方は local -Z、右方は local +X なので、同じ Y 回転を適用した親 local 成分を使用する
    // bodyPitch / bodyRoll は移動へ混ぜず、WASD を水平面上の移動として保つ
    const yawRad = state.bodyYaw * Math.PI / 180.0;
    const forwardX = -Math.sin(yawRad);
    const forwardZ = -Math.cos(yawRad);
    const rightX = Math.cos(yawRad);
    const rightZ = -Math.sin(yawRad);
    let moveX = 0.0;
    let moveY = 0.0;
    let moveZ = 0.0;
    if (this.input.has(state.keyMap.forward)) {
      moveX += forwardX;
      moveZ += forwardZ;
    }
    if (this.input.has(state.keyMap.back)) {
      moveX -= forwardX;
      moveZ -= forwardZ;
    }
    if (this.input.has(state.keyMap.left)) {
      moveX -= rightX;
      moveZ -= rightZ;
    }
    if (this.input.has(state.keyMap.right)) {
      moveX += rightX;
      moveZ += rightZ;
    }
    if (this.input.has(state.keyMap.up)) moveY += 1.0;
    if (this.input.has(state.keyMap.down)) moveY -= 1.0;
    const moveLen = Math.hypot(moveX, moveY, moveZ);
    if (moveLen > 0.0) {
      const scale = speed * dt / moveLen;
      state.position[0] += moveX * scale;
      state.position[1] += moveY * scale;
      state.position[2] += moveZ * scale;
      this.apply();
    }
  }

  // `follow`を現在の入力と実行状態に合わせて更新する
  updateFollow(deltaSec) {
    const state = this.follow;
    const dt = util.readFiniteNumber(deltaSec, "deltaSec");
    if (dt < 0.0) {
      throw new Error("EyeRig follow deltaSec must be >= 0");
    }
    let changed = false;
    if (this.input) {
      if (this.input.has(state.keyMap.left)) {
        state.yaw -= state.keyRotateSpeed * dt;
        changed = true;
      }
      if (this.input.has(state.keyMap.right)) {
        state.yaw += state.keyRotateSpeed * dt;
        changed = true;
      }
      if (this.input.has(state.keyMap.up)) {
        state.pitch = this.clamp(state.pitch + state.keyRotateSpeed * dt, state.pitchMin, state.pitchMax);
        changed = true;
      }
      if (this.input.has(state.keyMap.down)) {
        state.pitch = this.clamp(state.pitch - state.keyRotateSpeed * dt, state.pitchMin, state.pitchMax);
        changed = true;
      }
      if (this.input.has(state.keyMap.zoomIn)) {
        state.distance = this.clamp(state.distance - state.keyZoomSpeed * dt, state.minDistance, state.maxDistance);
        changed = true;
      }
      if (this.input.has(state.keyMap.zoomOut)) {
        state.distance = this.clamp(state.distance + state.keyZoomSpeed * dt, state.minDistance, state.maxDistance);
        changed = true;
      }
    }

    this.applyFollowNodes();
    if (!state.targetNode) {
      if (changed) this.applyFollowNodes();
      return;
    }

    const targetQuat = this.resolveFollowTargetQuat();
    if (!state.initialized) {
      state.trackingQuat.copyFrom(targetQuat);
      state.initialized = true;
    }

    const angularErrorDeg = this.quaternionAngleDeg(state.trackingQuat, targetQuat);
    let ratio = 1.0 - Math.exp(-state.response * dt);
    const maxStepDeg = state.maxAngularSpeed * dt;
    if (angularErrorDeg > 1.0e-8) {
      ratio = Math.min(ratio, maxStepDeg / angularErrorDeg);
    }
    ratio = this.clamp(ratio, 0.0, 1.0);

    const nextQuat = new Quat();
    nextQuat.slerp(state.trackingQuat, targetQuat, ratio);
    state.trackingQuat.copyFrom(nextQuat);
    state.lastAngularErrorDeg = angularErrorDeg;
    this.applyFollowNodes();
    this.updateFollowDiagnostics();
  }

  // eyeのworld前方とtarget方向の内積を計算し、追跡結果を検証できる値として保存する
  // 1.0に近いほど自動追跡姿勢とtarget方向が一致している
  updateFollowDiagnostics() {
    const eyeWorld = this.eyeNode.getWorldPosition();
    const targetWorld = this.getFollowTargetWorldPosition();
    const forwardWorld = this.normalizeStrict(
      this.eyeNode.getWorldMatrix().mul3x3Vector([0.0, 0.0, -1.0]),
      "eye world forward"
    );
    const toTarget = this.normalizeStrict([
      targetWorld[0] - eyeWorld[0],
      targetWorld[1] - eyeWorld[1],
      targetWorld[2] - eyeWorld[2]
    ], "eye to target");
    this.follow.lastViewDot = this.dot(forwardWorld, toTarget);
  }

  // 次のupdateFollow()を初回追跡として扱うため、追跡quaternionと診断値を初期化する
  // target変更やmode reset後に、対象を向く初期姿勢を再計算するときに使用する
  resetFollowTracking() {
    this.follow.trackingQuat = new Quat();
    this.follow.initialized = false;
    this.follow.lastAngularErrorDeg = 0.0;
    this.follow.lastViewDot = 0.0;
    return this;
  }

  // ポインターを対象へ追加し、後続処理から参照できるようにする
  attachPointer(element = this.element) {
    this.detachPointer();
    this.element = element;
    if (!this.element) return this;
    if (this.element?.style) {
      this.previousTouchAction = this.element.style.touchAction;
      this.element.style.touchAction = "none";
    }
    this.element.addEventListener("pointerdown", this._boundPointerDown);
    this.element.addEventListener("pointermove", this._boundPointerMove);
    this.element.addEventListener("pointerup", this._boundPointerUp);
    this.element.addEventListener("pointercancel", this._boundPointerUp);
    this.element.addEventListener("pointerleave", this._boundPointerUp);
    this.element.addEventListener("wheel", this._boundWheel, { passive: false });
    this.element.addEventListener("auxclick", this._boundAuxClick);
    if (typeof window !== "undefined") {
      window.addEventListener("blur", this._boundBlur);
    }
    return this;
  }

  // ポインターを対象から切り離し、関連する参照を整理する
  detachPointer() {
    if (!this.element) return this;
    this.element.removeEventListener("pointerdown", this._boundPointerDown);
    this.element.removeEventListener("pointermove", this._boundPointerMove);
    this.element.removeEventListener("pointerup", this._boundPointerUp);
    this.element.removeEventListener("pointercancel", this._boundPointerUp);
    this.element.removeEventListener("pointerleave", this._boundPointerUp);
    this.element.removeEventListener("wheel", this._boundWheel);
    this.element.removeEventListener("auxclick", this._boundAuxClick);
    if (this.element?.style && this.previousTouchAction !== null) {
      this.element.style.touchAction = this.previousTouchAction;
    }
    this.previousTouchAction = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("blur", this._boundBlur);
    }
    this.cancelDrag();
    return this;
  }

  // `cancel`の`drag`の条件を判定し、結果を真偽値で返す
  cancelDrag() {
    if (this.element?.releasePointerCapture) {
      for (const pointerId of this.pointerRecords.keys()) {
        try {
          this.element.releasePointerCapture(pointerId);
        } catch (_) {
          // pointer capture が残っていない場合は無視する
        }
      }
    }
    this.dragging = false;
    this.pointerId = null;
    this.pointerRecords.clear();
    this.resetTouchGesture();
  }

  // `drag`の`rotate`の`speed`を現在の入力と状態から求め、呼び出し元へ返す
  getDragRotateSpeed() {
    return this.type === "first-person"
      ? this.firstPerson.dragRotateSpeed
      : this.type === "follow"
        ? this.follow.dragRotateSpeed
        : this.orbit.dragRotateSpeed;
  }

  // Orbitの画面平面PANへ適用する移動係数を返す
  // Followはtargetとcamera anchorを独立させるためPANを持たない
  getDragPanSpeed() {
    return this.orbit.dragPanSpeed;
  }

  // pinch zoom は wheel とは発火頻度が違うため、別係数で調整できるようにする
  getPinchZoomSpeed() {
    return this.type === "follow"
      ? this.follow.pinchZoomSpeed
      : this.orbit.pinchZoomSpeed;
  }

  // orbit camera は近距離で zoom の見た目変化が強く出やすいため、
  // key / wheel / pinch の全経路へ共通係数を掛けて効きを半分程度にそろえる
  getZoomSensitivityScale() {
    return this.type === "orbit" ? 0.25 : 1.0;
  }

  // keyboard と pointer event で同じ modifier 名を参照できるようにする
  // pointer event は modifier key しか直接持たないため、ここではその範囲に限定する
  isModifierKeyActive(keyName, ev = null) {
    const key = String(keyName ?? "").toLowerCase();
    if (!key) return false;
    if (this.input?.has(key) === true) return true;
    if (!ev) return false;
    if (key === "shift") return ev.shiftKey === true;
    if (key === "control" || key === "ctrl") return ev.ctrlKey === true;
    if (key === "alt" || key === "option") return ev.altKey === true;
    if (key === "meta" || key === "command" || key === "cmd") return ev.metaKey === true;
    return false;
  }

  // touch pointer だけを判定して、mouse / pen の既存 drag 経路と分ける
  isTouchPointerEvent(ev) {
    return String(ev?.pointerType ?? "") === "touch";
  }

  // first-personは視線回転と移動キーを分けるため、2本指gestureはOrbit / Followだけにする
  // OrbitはPANとzoom、FollowはPANを無視してzoomだけを反映する
  canTouchPanOrZoom() {
    return this.type === "orbit" || this.type === "follow";
  }

  // multitouch 中は pointer の最新座標を保持し、2本指の中心差分と距離差分へ変換する
  rememberPointer(ev) {
    this.pointerRecords.set(ev.pointerId, {
      pointerId: ev.pointerId,
      pointerType: String(ev.pointerType ?? ""),
      clientX: ev.clientX,
      clientY: ev.clientY
    });
  }

  forgetPointer(pointerId) {
    this.pointerRecords.delete(pointerId);
  }

  // 3本目以降は gesture 判定へ使わず、最初の 2 本だけで pan / pinch を読む
  getActiveTouchPointers() {
    const touches = [];
    for (const pointer of this.pointerRecords.values()) {
      if (pointer.pointerType === "touch") {
        touches.push(pointer);
      }
      if (touches.length >= 2) {
        break;
      }
    }
    return touches;
  }

  // 2本指 gesture は中心移動と距離変化だけを使うため、毎回同じ形式へまとめる
  getTouchGestureMetrics(pointers = this.getActiveTouchPointers()) {
    if (!Array.isArray(pointers) || pointers.length < 2) {
      return {
        centerX: 0.0,
        centerY: 0.0,
        distance: 0.0
      };
    }
    const a = pointers[0];
    const b = pointers[1];
    return {
      centerX: (a.clientX + b.clientX) * 0.5,
      centerY: (a.clientY + b.clientY) * 0.5,
      distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
    };
  }

  // 2本指操作へ切り替わった瞬間の基準値を保持し、次の move では差分だけを読む
  beginTouchGesture() {
    const metrics = this.getTouchGestureMetrics();
    this.touchGesture.active = true;
    this.touchGesture.centerX = metrics.centerX;
    this.touchGesture.centerY = metrics.centerY;
    this.touchGesture.distance = metrics.distance;
  }

  // タッチ入力の`gesture`を初期状態へ戻し、前回の状態を残さない
  resetTouchGesture() {
    this.touchGesture.active = false;
    this.touchGesture.centerX = 0.0;
    this.touchGesture.centerY = 0.0;
    this.touchGesture.distance = 0.0;
  }

  // eyeのworld行列からscreen平面に対応するright / upを作るため、まず単位化する
  // pointer入力用の既存helperだが、ゼロ長を返して不具合を隠さない
  normalizeVector(v) {
    return this.normalizeStrict(v, "direction");
  }

  // 2本指の中心移動は、Orbitの視線right / upに沿ったworld移動量へ変換する
  // base親が回転している場合は、そのworld移動量を親localへ戻してorbit.targetへ加える
  panViewByScreenDelta(dx, dy) {
    if (this.type !== "orbit" || !this.eyeNode?.getWorldMatrix) {
      return;
    }
    const matrix = this.eyeNode.getWorldMatrix();
    const right = this.normalizeStrict(
      matrix.mul3x3Vector([1.0, 0.0, 0.0]),
      "orbit screen right"
    );
    const up = this.normalizeStrict(
      matrix.mul3x3Vector([0.0, 1.0, 0.0]),
      "orbit screen up"
    );
    const size = Math.max(
      1.0,
      Math.min(
        Number(this.element?.clientWidth ?? 0) || 0,
        Number(this.element?.clientHeight ?? 0) || 0
      )
    );
    const scale = this.orbit.distance * this.getDragPanSpeed() / size;
    const moveWorld = [
      right[0] * (-dx * scale) + up[0] * (dy * scale),
      right[1] * (-dx * scale) + up[1] * (dy * scale),
      right[2] * (-dx * scale) + up[2] * (dy * scale)
    ];
    const parent = this.baseNode.getParent?.() ?? null;
    const moveLocal = parent
      ? this.worldDirectionToNodeLocal(parent, moveWorld, "orbit PAN parent")
      : moveWorld;
    this.orbit.target[0] += moveLocal[0];
    this.orbit.target[1] += moveLocal[1];
    this.orbit.target[2] += moveLocal[2];
  }

  // pinch の開閉量は現在距離へ比例させ、近距離で細かく遠距離で大きく変わるようにする
  zoomByPinchDelta(deltaDistance) {
    if (!this.canTouchPanOrZoom()) {
      return;
    }
    const size = Math.max(
      1.0,
      Math.min(
        Number(this.element?.clientWidth ?? 0) || 0,
        Number(this.element?.clientHeight ?? 0) || 0
      )
    );
    if (this.type === "follow") {
      const zoomAmount = deltaDistance * this.follow.distance * this.getPinchZoomSpeed() / size;
      this.follow.distance = this.clamp(
        this.follow.distance - zoomAmount,
        this.follow.minDistance,
        this.follow.maxDistance
      );
      return;
    }
    const zoomAmount = deltaDistance
      * this.orbit.distance
      * this.getPinchZoomSpeed()
      * this.getZoomSensitivityScale()
      / size;
    this.orbit.distance = this.clamp(
      this.orbit.distance - zoomAmount,
      this.orbit.minDistance,
      this.orbit.maxDistance
    );
  }

  // mouse / pen の drag zoom は、wheel と同じく現在距離を直接変える
  // dy の符号は wheel と同じ向きにし、下方向 drag で遠ざかり、上方向 drag で近づく
  zoomByDragDelta(dy) {
    if (this.type === "follow") {
      const zoomScale = Math.exp(dy * this.follow.pinchZoomSpeed * 0.004);
      this.follow.distance = this.clamp(
        this.follow.distance * zoomScale,
        this.follow.minDistance,
        this.follow.maxDistance
      );
      return;
    }
    const zoomScale = Math.exp(
      dy
      * this.orbit.dragZoomSpeed
      * this.getZoomSensitivityScale()
    );
    this.orbit.distance = this.clamp(
      this.orbit.distance * zoomScale,
      this.orbit.minDistance,
      this.orbit.maxDistance
    );
  }

  // ポインターの`down`を受け取った段階で、対応する状態更新と処理を実行する
  onPointerDown(ev) {
    if (!this.enabled) return;
    if (this.isTouchPointerEvent(ev)) {
      this.rememberPointer(ev);
      if (this.element?.setPointerCapture) {
        try {
          this.element.setPointerCapture(ev.pointerId);
        } catch (_) {
          // 端末差で capture できない場合でも gesture は継続できる
        }
      }
      const touches = this.getActiveTouchPointers();
      if (touches.length >= 2 && this.canTouchPanOrZoom()) {
        this.dragging = false;
        this.pointerId = null;
        this.beginTouchGesture();
      } else if (touches.length === 1) {
        this.dragging = true;
        this.pointerId = ev.pointerId;
        this.lastClientX = ev.clientX;
        this.lastClientY = ev.clientY;
        this.resetTouchGesture();
      }
      ev.preventDefault();
      return;
    }
    if (!this.isDragStartEvent(ev)) return;
    this.dragging = true;
    this.pointerId = ev.pointerId;
    this.lastClientX = ev.clientX;
    this.lastClientY = ev.clientY;
    if (this.element?.setPointerCapture) {
      this.element.setPointerCapture(ev.pointerId);
    }
    ev.preventDefault();
  }

  // dragButton は通常の camera drag button を表す
  // alternateDragButton は macOS の Option+左ドラッグのような代替入力で、
  // modifier が押されている時だけ camera drag として扱い、左ドラッグ単体を編集操作へ残す
  isDragStartEvent(ev) {
    if (ev.button === this.dragButton) {
      return true;
    }
    if (this.alternateDragButton === null) {
      return false;
    }
    if (ev.button !== this.alternateDragButton) {
      return false;
    }
    return this.isModifierKeyActive(this.alternateDragModifierKey, ev);
  }

  // ポインターの`move`を受け取った段階で、対応する状態更新と処理を実行する
  onPointerMove(ev) {
    if (!this.enabled) return;
    if (this.isTouchPointerEvent(ev)) {
      if (!this.pointerRecords.has(ev.pointerId)) return;
      this.rememberPointer(ev);
      const touches = this.getActiveTouchPointers();
      if (touches.length >= 2 && this.canTouchPanOrZoom()) {
        if (!this.touchGesture.active) {
          this.beginTouchGesture();
        }
        const metrics = this.getTouchGestureMetrics(touches);
        const centerDx = metrics.centerX - this.touchGesture.centerX;
        const centerDy = metrics.centerY - this.touchGesture.centerY;
        const pinchDelta = metrics.distance - this.touchGesture.distance;
        this.panViewByScreenDelta(centerDx, centerDy);
        this.zoomByPinchDelta(pinchDelta);
        this.touchGesture.centerX = metrics.centerX;
        this.touchGesture.centerY = metrics.centerY;
        this.touchGesture.distance = metrics.distance;
        this.apply();
        ev.preventDefault();
        return;
      }
      if (!this.dragging) return;
      if (this.pointerId !== null && ev.pointerId !== this.pointerId) return;
    } else {
      if (!this.dragging) return;
      if (this.pointerId !== null && ev.pointerId !== this.pointerId) return;
    }
    const dx = ev.clientX - this.lastClientX;
    const dy = ev.clientY - this.lastClientY;
    const dragRotateSpeed = this.getDragRotateSpeed();
    this.lastClientX = ev.clientX;
    this.lastClientY = ev.clientY;

    // Orbitではpan modifierを押しながらdragしたときにscreen平面PANとして扱う
    // Followはcamera anchorとtargetを独立させるためpointer PANを行わない
    if (
      !this.isTouchPointerEvent(ev)
      && this.type === "orbit"
      && this.isModifierKeyActive(this.orbit.panModifierKey, ev)
    ) {
      this.panViewByScreenDelta(dx, dy);
      this.apply();
      ev.preventDefault();
      return;
    }

    // OrbitではdragZoomModifierKeyを押しながらdragしたときにcamera zoomとして扱う
    const dragZoomModifierKey = this.type === "follow"
      ? null
      : this.orbit.dragZoomModifierKey;
    if (!this.isTouchPointerEvent(ev) && this.type !== "first-person" && this.isModifierKeyActive(dragZoomModifierKey, ev)) {
      this.zoomByDragDelta(dy);
      this.apply();
      ev.preventDefault();
      return;
    }

    if (this.type === "first-person") {
      this.firstPerson.lookYaw += dx * dragRotateSpeed;
      this.firstPerson.lookPitch = this.clamp(
        this.firstPerson.lookPitch + dy * dragRotateSpeed,
        this.firstPerson.lookPitchMin,
        this.firstPerson.lookPitchMax
      );
    } else if (this.type === "follow") {
      this.follow.yaw += dx * dragRotateSpeed;
      this.follow.pitch = this.clamp(
        this.follow.pitch + dy * dragRotateSpeed,
        this.follow.pitchMin,
        this.follow.pitchMax
      );
    } else {
      if (this.orbit.rotationInputMode === "camera-view") {
        this.applyOrbitRotationByViewAxes(dx * dragRotateSpeed, dy * dragRotateSpeed, 0.0);
      } else {
        this.orbit.yaw += dx * dragRotateSpeed;
        this.orbit.pitch = this.clamp(
          this.orbit.pitch + dy * dragRotateSpeed,
          this.orbit.pitchMin,
          this.orbit.pitchMax
        );
      }
    }
    this.apply();
    ev.preventDefault();
  }

  // ポインターの`up`を受け取った段階で、対応する状態更新と処理を実行する
  onPointerUp(ev) {
    if (this.isTouchPointerEvent(ev)) {
      this.forgetPointer(ev.pointerId);
      if (this.element?.releasePointerCapture) {
        try {
          this.element.releasePointerCapture(ev.pointerId);
        } catch (_) {
          // pointer capture が残っていないときは無視する
        }
      }
      const touches = this.getActiveTouchPointers();
      if (touches.length >= 2 && this.canTouchPanOrZoom()) {
        this.dragging = false;
        this.pointerId = null;
        this.beginTouchGesture();
      } else if (touches.length === 1) {
        const remaining = touches[0];
        this.dragging = true;
        this.pointerId = remaining.pointerId;
        this.lastClientX = remaining.clientX;
        this.lastClientY = remaining.clientY;
        this.resetTouchGesture();
      } else {
        this.cancelDrag();
      }
      ev.preventDefault();
      return;
    }
    if (!this.dragging) return;
    if (this.pointerId !== null && ev.pointerId !== this.pointerId) return;
    if (this.element?.releasePointerCapture) {
      try {
        this.element.releasePointerCapture(ev.pointerId);
      } catch (_) {
        // pointer capture が残っていないときは無視する
      }
    }
    this.cancelDrag();
    ev.preventDefault();
  }

  // `aux`の`click`を受け取った段階で、対応する状態更新と処理を実行する
  onAuxClick(ev) {
    if (ev.button === this.dragButton) {
      ev.preventDefault();
    }
  }

  // `wheel`を受け取った段階で、対応する状態更新と処理を実行する
  onWheel(ev) {
    if (!this.enabled) return;
    if (this.type === "first-person") return;
    const zoomDir = ev.deltaY > 0 ? 1.0 : -1.0;
    if (this.type === "follow") {
      this.follow.distance = this.clamp(
        this.follow.distance + zoomDir * this.follow.keyZoomSpeed * 0.1,
        this.follow.minDistance,
        this.follow.maxDistance
      );
    } else {
      this.orbit.distance = this.clamp(
        this.orbit.distance + zoomDir * this.orbit.wheelZoomStep * this.getZoomSensitivityScale(),
        this.orbit.minDistance,
        this.orbit.maxDistance
      );
    }
    this.apply();
    ev.preventDefault();
  }

  destroy() {
    this.detachPointer();
  }
}
