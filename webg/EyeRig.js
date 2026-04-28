// ---------------------------------------------
// EyeRig.js      2026/04/28
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// EyeRig:
// - `base -> rod -> eye` の3段構成だけを扱う視点 helper
// - `type` により orbit / first-person / follow を切り替える
// - `setAngles()` は base/rod 側の向き、`setLookAngles()` は eye の独立視線を表す
// - pointer 入力は mouse / pen / touch を同じ入口で扱い、
//   orbit / follow では 1本指回転、2本指平行移動、pinch zoom を使えるようにする
import util from "./util.js";

export default class EyeRig {
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
      currentTarget: [0.0, 0.0, 0.0],
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
      dragPanSpeed: util.readFiniteOption(
        [{ value: options.follow?.dragPanSpeed, label: "options.follow.dragPanSpeed" }],
        "follow.dragPanSpeed",
        1.8,
        { min: 0.0 }
      ),
      pinchZoomSpeed: util.readFiniteOption(
        [{ value: options.follow?.pinchZoomSpeed, label: "options.follow.pinchZoomSpeed" }],
        "follow.pinchZoomSpeed",
        2.0,
        { min: 0.0 }
      ),
      followLerp: util.readFiniteOption(
        [{ value: options.follow?.followLerp, label: "options.follow.followLerp" }],
        "follow.followLerp",
        1.0,
        { min: 0.0 }
      ),
      panModifierKey: util.readKeyOption(
        [{ value: options.follow?.panModifierKey, label: "options.follow.panModifierKey" }],
        "follow.panModifierKey",
        "shift"
      ),
      inheritTargetYaw: util.readBooleanOption(
        [
          { value: options.follow?.inheritTargetYaw, label: "options.follow.inheritTargetYaw" }
        ],
        "follow.inheritTargetYaw",
        false
      ),
      targetYawOffset: util.readFiniteOption(
        [
          { value: options.follow?.targetYawOffset, label: "options.follow.targetYawOffset" }
        ],
        "follow.targetYawOffset",
        0.0
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
    this.syncTarget(true);
    this.apply(true);
  }

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

  getModeState(type = this.type) {
    if (type === "orbit") return this.orbit;
    if (type === "first-person") return this.firstPerson;
    if (type === "follow") return this.follow;
    return null;
  }

  setType(type) {
    if (type !== "orbit" && type !== "first-person" && type !== "follow") {
      throw new Error(`Unknown EyeRig type: ${type}`);
    }
    this.type = type;
    this.apply();
    return this;
  }

  setInput(inputController) {
    this.input = inputController;
    return this;
  }

  setElement(element) {
    this.detachPointer();
    this.element = element;
    return this;
  }

  setTarget(x, y, z) {
    this.orbit.target[0] = util.readFiniteNumber(x, "target.x");
    this.orbit.target[1] = util.readFiniteNumber(y, "target.y");
    this.orbit.target[2] = util.readFiniteNumber(z, "target.z");
    if (this.type === "orbit") this.apply();
    return this;
  }

  setPosition(x, y, z) {
    this.firstPerson.position[0] = util.readFiniteNumber(x, "position.x");
    this.firstPerson.position[1] = util.readFiniteNumber(y, "position.y");
    this.firstPerson.position[2] = util.readFiniteNumber(z, "position.z");
    if (this.type === "first-person") this.apply();
    return this;
  }

  setTargetNode(targetNode) {
    this.follow.targetNode = targetNode;
    this.syncTarget(true);
    if (this.type === "follow") this.apply();
    return this;
  }

  setTargetOffset(x, y, z) {
    this.follow.targetOffset[0] = util.readFiniteNumber(x, "targetOffset.x");
    this.follow.targetOffset[1] = util.readFiniteNumber(y, "targetOffset.y");
    this.follow.targetOffset[2] = util.readFiniteNumber(z, "targetOffset.z");
    this.syncTarget(true);
    if (this.type === "follow") this.apply();
    return this;
  }

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
    }
    this.apply();
    return this;
  }

  setEyeHeight(height) {
    this.firstPerson.eyeHeight = util.readFiniteNumber(height, "eyeHeight");
    if (this.type === "first-person") this.apply();
    return this;
  }

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

  syncTarget(force = false, deltaSec = 0.0) {
    const state = this.follow;
    if (!state.targetNode?.getWorldPosition) return this;
    const world = state.targetNode.getWorldPosition();
    const targetX = world[0] + state.targetOffset[0];
    const targetY = world[1] + state.targetOffset[1];
    const targetZ = world[2] + state.targetOffset[2];
    const t = force ? 1.0 : this.clamp(state.followLerp * Math.max(0.0, deltaSec), 0.0, 1.0);
    state.currentTarget[0] = this.lerp(state.currentTarget[0], targetX, t);
    state.currentTarget[1] = this.lerp(state.currentTarget[1], targetY, t);
    state.currentTarget[2] = this.lerp(state.currentTarget[2], targetZ, t);
    return this;
  }

  resolveFollowBaseYaw() {
    const state = this.follow;
    if (!state.inheritTargetYaw || !state.targetNode?.getWorldAttitude) {
      return 0.0;
    }
    return state.targetNode.getWorldAttitude()[0] + state.targetYawOffset;
  }

  apply(force = false) {
    if (!this.enabled && !force) return this;
    if (!this.baseNode || !this.rodNode || !this.eyeNode) return this;

    if (this.type === "orbit") {
      const state = this.orbit;
      this.baseNode.setPosition(state.target[0], state.target[1], state.target[2]);
      this.baseNode.setAttitude(0.0, 0.0, 0.0);
      this.rodNode.setPosition(0.0, 0.0, 0.0);
      this.rodNode.setAttitude(state.yaw, state.pitch, state.roll);
      this.eyeNode.setPosition(0.0, 0.0, state.distance);
      this.eyeNode.setAttitude(state.lookYaw, state.lookPitch, state.lookRoll);
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

    const state = this.follow;
    const baseYaw = this.resolveFollowBaseYaw();
    this.baseNode.setPosition(state.currentTarget[0], state.currentTarget[1], state.currentTarget[2]);
    this.baseNode.setAttitude(baseYaw, 0.0, 0.0);
    this.rodNode.setPosition(0.0, 0.0, 0.0);
    this.rodNode.setAttitude(state.yaw, state.pitch, state.roll);
    this.eyeNode.setPosition(0.0, 0.0, state.distance);
    this.eyeNode.setAttitude(state.lookYaw, state.lookPitch, state.lookRoll);
    return this;
  }

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

  updateFirstPerson(deltaSec) {
    if (!this.input) return;
    const state = this.firstPerson;
    const dt = Number.isFinite(deltaSec) ? deltaSec : 0.0;
    const speed = state.moveSpeed * (this.input.has(state.keyMap.run) ? state.runMultiplier : 1.0);
    const yawRad = state.bodyYaw * Math.PI / 180.0;
    const forwardX = -Math.sin(yawRad);
    const forwardZ = Math.cos(yawRad);
    const rightX = Math.cos(yawRad);
    const rightZ = Math.sin(yawRad);
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

  updateFollow(deltaSec) {
    const state = this.follow;
    const dt = Number.isFinite(deltaSec) ? deltaSec : 0.0;
    const shiftPan = this.isModifierKeyActive(state.panModifierKey);
    let changed = false;
    if (this.input) {
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
      if (this.input.has(state.keyMap.zoomIn)) {
        state.distance = this.clamp(state.distance - state.keyZoomSpeed * dt, state.minDistance, state.maxDistance);
        changed = true;
      }
      if (this.input.has(state.keyMap.zoomOut)) {
        state.distance = this.clamp(state.distance + state.keyZoomSpeed * dt, state.minDistance, state.maxDistance);
        changed = true;
      }
    }
    this.syncTarget(false, dt);
    if (changed || state.targetNode) this.apply();
  }

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

  getDragRotateSpeed() {
    return this.type === "first-person"
      ? this.firstPerson.dragRotateSpeed
      : this.type === "follow"
        ? this.follow.dragRotateSpeed
        : this.orbit.dragRotateSpeed;
  }

  // orbit / follow は回転と別に平行移動も持てるため、画面上の移動量へ専用係数を持つ
  getDragPanSpeed() {
    return this.type === "follow"
      ? this.follow.dragPanSpeed
      : this.orbit.dragPanSpeed;
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

  // first-person は視線回転と移動キーを分ける設計なので、2本指 pan / zoom は orbit / follow だけにする
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

  resetTouchGesture() {
    this.touchGesture.active = false;
    this.touchGesture.centerX = 0.0;
    this.touchGesture.centerY = 0.0;
    this.touchGesture.distance = 0.0;
  }

  // eye の world 行列から screen 平面に対応する right / up を作るため、まず単位化する
  normalizeVector(v) {
    const len = Math.hypot(v?.[0] ?? 0.0, v?.[1] ?? 0.0, v?.[2] ?? 0.0);
    if (len <= 1.0e-8) {
      return [0.0, 0.0, 0.0];
    }
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  // 2本指の中心移動は、視線 right / up に沿った平行移動として target 側へ反映する
  panViewByScreenDelta(dx, dy) {
    if (!this.canTouchPanOrZoom() || !this.eyeNode?.getWorldMatrix) {
      return;
    }
    const matrix = this.eyeNode.getWorldMatrix();
    const right = this.normalizeVector(matrix.mul3x3Vector([1.0, 0.0, 0.0]));
    const up = this.normalizeVector(matrix.mul3x3Vector([0.0, 1.0, 0.0]));
    const size = Math.max(
      1.0,
      Math.min(
        Number(this.element?.clientWidth ?? 0) || 0,
        Number(this.element?.clientHeight ?? 0) || 0
      )
    );
    const currentDistance = this.type === "follow" ? this.follow.distance : this.orbit.distance;
    const scale = currentDistance * this.getDragPanSpeed() / size;
    const moveX = right[0] * (-dx * scale) + up[0] * (dy * scale);
    const moveY = right[1] * (-dx * scale) + up[1] * (dy * scale);
    const moveZ = right[2] * (-dx * scale) + up[2] * (dy * scale);

    if (this.type === "follow") {
      this.follow.targetOffset[0] += moveX;
      this.follow.targetOffset[1] += moveY;
      this.follow.targetOffset[2] += moveZ;
      this.follow.currentTarget[0] += moveX;
      this.follow.currentTarget[1] += moveY;
      this.follow.currentTarget[2] += moveZ;
      return;
    }

    this.orbit.target[0] += moveX;
    this.orbit.target[1] += moveY;
    this.orbit.target[2] += moveZ;
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

    // orbit / follow では pan modifier を押しながら drag したときに
    // 視線の screen 平面に沿った pan として扱う
    // これにより、rotation と pan を同じ pointer 経路の中で切り替えられる
    const panModifierKey = this.type === "follow"
      ? this.follow.panModifierKey
      : this.orbit.panModifierKey;
    if (!this.isTouchPointerEvent(ev) && this.type !== "first-person" && this.isModifierKeyActive(panModifierKey, ev)) {
      this.panViewByScreenDelta(dx, dy);
      this.apply();
      ev.preventDefault();
      return;
    }

    // orbit / follow では dragZoomModifierKey を押しながら drag したときに
    // Blender の Ctrl+中ボタンドラッグに相当する camera zoom として扱う
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
      this.firstPerson.bodyYaw += dx * dragRotateSpeed;
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
      this.orbit.yaw += dx * dragRotateSpeed;
      this.orbit.pitch = this.clamp(
        this.orbit.pitch + dy * dragRotateSpeed,
        this.orbit.pitchMin,
        this.orbit.pitchMax
      );
    }
    this.apply();
    ev.preventDefault();
  }

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

  onAuxClick(ev) {
    if (ev.button === this.dragButton) {
      ev.preventDefault();
    }
  }

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
