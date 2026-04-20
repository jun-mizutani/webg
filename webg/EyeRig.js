// ---------------------------------------------
// EyeRig.js      2026/04/20
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// EyeRig:
// - `base -> rod -> eye` の3段構成だけを扱う視点 helper
// - `type` により orbit / first-person / follow を切り替える
// - `setAngles()` は base/rod 側の向き、`setLookAngles()` は eye の独立視線を表す
// - pointer 入力は mouse / pen / touch を同じ入口で扱い、
//   orbit / follow では 1本指回転、2本指平行移動、pinch zoom を使えるようにする
export default class EyeRig {
  constructor(baseNode, rodNode, eyeNode, options = {}) {
    this.baseNode = baseNode ?? null;
    this.rodNode = rodNode ?? null;
    this.eyeNode = eyeNode ?? null;
    this.doc = options.document ?? (typeof document !== "undefined" ? document : null);
    this.element = options.element ?? (this.doc ? this.doc.getElementById("canvas") : null);
    this.input = options.input ?? null;
    this.requestRender = typeof options.requestRender === "function" ? options.requestRender : null;
    this.enabled = options.enabled !== false;
    this.type = options.type ?? "orbit";
    this.dragButton = Number.isFinite(options.dragButton) ? options.dragButton : 0;

    this.orbit = {
      target: [...(options.orbit?.target ?? options.target ?? [0.0, 0.0, 0.0])],
      yaw: Number.isFinite(options.orbit?.yaw ?? options.yaw) ? (options.orbit?.yaw ?? options.yaw) : 0.0,
      pitch: Number.isFinite(options.orbit?.pitch ?? options.pitch) ? (options.orbit?.pitch ?? options.pitch) : 0.0,
      bank: Number.isFinite(options.orbit?.bank ?? options.bank) ? (options.orbit?.bank ?? options.bank) : 0.0,
      lookYaw: Number.isFinite(options.orbit?.lookYaw) ? options.orbit.lookYaw : 0.0,
      lookPitch: Number.isFinite(options.orbit?.lookPitch) ? options.orbit.lookPitch : 0.0,
      lookBank: Number.isFinite(options.orbit?.lookBank) ? options.orbit.lookBank : 0.0,
      distance: Number.isFinite(options.orbit?.distance ?? options.distance) ? (options.orbit?.distance ?? options.distance) : 28.0,
      minDistance: Number.isFinite(options.orbit?.minDistance) ? options.orbit.minDistance : 4.0,
      maxDistance: Number.isFinite(options.orbit?.maxDistance) ? options.orbit.maxDistance : 180.0,
      keyRotateSpeed: Number.isFinite(options.orbit?.keyRotateSpeed) ? options.orbit.keyRotateSpeed : 72.0,
      keyZoomSpeed: Number.isFinite(options.orbit?.keyZoomSpeed) ? options.orbit.keyZoomSpeed : 18.0,
      dragRotateSpeed: Number.isFinite(options.orbit?.dragRotateSpeed) ? options.orbit.dragRotateSpeed : 0.28,
      dragPanSpeed: Number.isFinite(options.orbit?.dragPanSpeed) ? options.orbit.dragPanSpeed : 2.0,
      pinchZoomSpeed: Number.isFinite(options.orbit?.pinchZoomSpeed) ? options.orbit.pinchZoomSpeed : 2.2,
      wheelZoomStep: Number.isFinite(options.orbit?.wheelZoomStep) ? options.orbit.wheelZoomStep : 1.8,
      pitchMin: Number.isFinite(options.orbit?.pitchMin) ? options.orbit.pitchMin : -85.0,
      pitchMax: Number.isFinite(options.orbit?.pitchMax) ? options.orbit.pitchMax : 85.0,
      keyMap: {
        left: String(options.orbit?.keyMap?.left ?? "arrowleft").toLowerCase(),
        right: String(options.orbit?.keyMap?.right ?? "arrowright").toLowerCase(),
        up: String(options.orbit?.keyMap?.up ?? "arrowup").toLowerCase(),
        down: String(options.orbit?.keyMap?.down ?? "arrowdown").toLowerCase(),
        zoomIn: String(options.orbit?.keyMap?.zoomIn ?? "[").toLowerCase(),
        zoomOut: String(options.orbit?.keyMap?.zoomOut ?? "]").toLowerCase()
      }
    };

    this.firstPerson = {
      position: [...(options.firstPerson?.position ?? options.position ?? [0.0, 0.0, 0.0])],
      bodyYaw: Number.isFinite(options.firstPerson?.bodyYaw) ? options.firstPerson.bodyYaw
        : Number.isFinite(options.firstPerson?.yaw ?? options.yaw) ? (options.firstPerson?.yaw ?? options.yaw) : 0.0,
      bodyPitch: Number.isFinite(options.firstPerson?.bodyPitch) ? options.firstPerson.bodyPitch : 0.0,
      bodyBank: Number.isFinite(options.firstPerson?.bodyBank) ? options.firstPerson.bodyBank : 0.0,
      lookYaw: Number.isFinite(options.firstPerson?.lookYaw) ? options.firstPerson.lookYaw : 0.0,
      lookPitch: Number.isFinite(options.firstPerson?.lookPitch ?? options.pitch) ? (options.firstPerson?.lookPitch ?? options.pitch) : 0.0,
      lookBank: Number.isFinite(options.firstPerson?.lookBank ?? options.bank) ? (options.firstPerson?.lookBank ?? options.bank) : 0.0,
      eyeHeight: Number.isFinite(options.firstPerson?.eyeHeight) ? options.firstPerson.eyeHeight : 1.6,
      moveSpeed: Number.isFinite(options.firstPerson?.moveSpeed) ? options.firstPerson.moveSpeed : 10.0,
      runMultiplier: Number.isFinite(options.firstPerson?.runMultiplier) ? options.firstPerson.runMultiplier : 2.0,
      dragRotateSpeed: Number.isFinite(options.firstPerson?.dragRotateSpeed) ? options.firstPerson.dragRotateSpeed : 0.20,
      lookPitchMin: Number.isFinite(options.firstPerson?.lookPitchMin) ? options.firstPerson.lookPitchMin : -85.0,
      lookPitchMax: Number.isFinite(options.firstPerson?.lookPitchMax) ? options.firstPerson.lookPitchMax : 85.0,
      keyMap: {
        forward: String(options.firstPerson?.keyMap?.forward ?? "w").toLowerCase(),
        back: String(options.firstPerson?.keyMap?.back ?? "s").toLowerCase(),
        left: String(options.firstPerson?.keyMap?.left ?? "a").toLowerCase(),
        right: String(options.firstPerson?.keyMap?.right ?? "d").toLowerCase(),
        up: String(options.firstPerson?.keyMap?.up ?? "e").toLowerCase(),
        down: String(options.firstPerson?.keyMap?.down ?? "q").toLowerCase(),
        run: String(options.firstPerson?.keyMap?.run ?? "shift").toLowerCase()
      }
    };

    this.follow = {
      targetNode: options.follow?.targetNode ?? options.targetNode ?? null,
      targetOffset: [...(options.follow?.targetOffset ?? [0.0, 0.0, 0.0])],
      currentTarget: [0.0, 0.0, 0.0],
      yaw: Number.isFinite(options.follow?.yaw ?? options.yaw) ? (options.follow?.yaw ?? options.yaw) : 0.0,
      pitch: Number.isFinite(options.follow?.pitch ?? options.pitch) ? (options.follow?.pitch ?? options.pitch) : -12.0,
      bank: Number.isFinite(options.follow?.bank ?? options.bank) ? (options.follow?.bank ?? options.bank) : 0.0,
      lookYaw: Number.isFinite(options.follow?.lookYaw) ? options.follow.lookYaw : 0.0,
      lookPitch: Number.isFinite(options.follow?.lookPitch) ? options.follow.lookPitch : 0.0,
      lookBank: Number.isFinite(options.follow?.lookBank) ? options.follow.lookBank : 0.0,
      distance: Number.isFinite(options.follow?.distance ?? options.distance) ? (options.follow?.distance ?? options.distance) : 18.0,
      minDistance: Number.isFinite(options.follow?.minDistance) ? options.follow.minDistance : 3.0,
      maxDistance: Number.isFinite(options.follow?.maxDistance) ? options.follow.maxDistance : 120.0,
      keyRotateSpeed: Number.isFinite(options.follow?.keyRotateSpeed) ? options.follow.keyRotateSpeed : 72.0,
      keyZoomSpeed: Number.isFinite(options.follow?.keyZoomSpeed) ? options.follow.keyZoomSpeed : 16.0,
      dragRotateSpeed: Number.isFinite(options.follow?.dragRotateSpeed) ? options.follow.dragRotateSpeed : 0.28,
      dragPanSpeed: Number.isFinite(options.follow?.dragPanSpeed) ? options.follow.dragPanSpeed : 1.8,
      pinchZoomSpeed: Number.isFinite(options.follow?.pinchZoomSpeed) ? options.follow.pinchZoomSpeed : 2.0,
      followLerp: Number.isFinite(options.follow?.followLerp) ? options.follow.followLerp : 1.0,
      inheritTargetYaw: options.follow?.inheritTargetYaw === true,
      targetYawOffset: Number.isFinite(options.follow?.targetYawOffset) ? options.follow.targetYawOffset : 0.0,
      pitchMin: Number.isFinite(options.follow?.pitchMin) ? options.follow.pitchMin : -80.0,
      pitchMax: Number.isFinite(options.follow?.pitchMax) ? options.follow.pitchMax : 60.0,
      keyMap: {
        left: String(options.follow?.keyMap?.left ?? "arrowleft").toLowerCase(),
        right: String(options.follow?.keyMap?.right ?? "arrowright").toLowerCase(),
        up: String(options.follow?.keyMap?.up ?? "arrowup").toLowerCase(),
        down: String(options.follow?.keyMap?.down ?? "arrowdown").toLowerCase(),
        zoomIn: String(options.follow?.keyMap?.zoomIn ?? "[").toLowerCase(),
        zoomOut: String(options.follow?.keyMap?.zoomOut ?? "]").toLowerCase()
      }
    };

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
    this.debugState = {
      lastOrbitDeltaSec: 0.0,
      lastOrbitShiftPan: false,
      lastOrbitKeyActive: false,
      lastOrbitChanged: false,
      lastOrbitInputLeft: false,
      lastOrbitInputRight: false,
      lastOrbitInputUp: false,
      lastOrbitInputDown: false,
      lastOrbitInputZoomIn: false,
      lastOrbitInputZoomOut: false
    };
    this.previousTouchAction = null;
    this._boundPointerDown = (ev) => this.onPointerDown(ev);
    this._boundPointerMove = (ev) => this.onPointerMove(ev);
    this._boundPointerUp = (ev) => this.onPointerUp(ev);
    this._boundWheel = (ev) => this.onWheel(ev);
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

  setRequestRender(requestRender) {
    this.requestRender = typeof requestRender === "function" ? requestRender : null;
    return this;
  }

  scheduleRender() {
    if (this.requestRender) {
      this.requestRender();
    }
    return this;
  }

  setElement(element) {
    this.detachPointer();
    this.element = element;
    return this;
  }

  setTarget(x, y, z) {
    this.orbit.target[0] = x;
    this.orbit.target[1] = y;
    this.orbit.target[2] = z;
    if (this.type === "orbit") this.apply();
    return this;
  }

  setPosition(x, y, z) {
    this.firstPerson.position[0] = x;
    this.firstPerson.position[1] = y;
    this.firstPerson.position[2] = z;
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
    this.follow.targetOffset[0] = x;
    this.follow.targetOffset[1] = y;
    this.follow.targetOffset[2] = z;
    this.syncTarget(true);
    if (this.type === "follow") this.apply();
    return this;
  }

  setDistance(distance) {
    if (this.type === "follow") {
      this.follow.distance = this.clamp(distance, this.follow.minDistance, this.follow.maxDistance);
    } else {
      this.orbit.distance = this.clamp(distance, this.orbit.minDistance, this.orbit.maxDistance);
    }
    this.apply();
    return this;
  }

  // `setAngles` は eye ではなく base/rod 側の向きを操作する
  setAngles(head, pitch, bank = 0.0) {
    if (this.type === "orbit") {
      this.orbit.yaw = head;
      this.orbit.pitch = this.clamp(pitch, this.orbit.pitchMin, this.orbit.pitchMax);
      this.orbit.bank = bank;
    } else if (this.type === "first-person") {
      this.firstPerson.bodyYaw = head;
      this.firstPerson.bodyPitch = pitch;
      this.firstPerson.bodyBank = bank;
    } else {
      this.follow.yaw = head;
      this.follow.pitch = this.clamp(pitch, this.follow.pitchMin, this.follow.pitchMax);
      this.follow.bank = bank;
    }
    this.apply();
    return this;
  }

  // 進行方向とは独立した camera の向きは eye 側へ与える
  setLookAngles(head, pitch, bank = 0.0) {
    if (this.type === "orbit") {
      this.orbit.lookYaw = head;
      this.orbit.lookPitch = pitch;
      this.orbit.lookBank = bank;
    } else if (this.type === "first-person") {
      this.firstPerson.lookYaw = head;
      this.firstPerson.lookPitch = this.clamp(
        pitch,
        this.firstPerson.lookPitchMin,
        this.firstPerson.lookPitchMax
      );
      this.firstPerson.lookBank = bank;
    } else {
      this.follow.lookYaw = head;
      this.follow.lookPitch = pitch;
      this.follow.lookBank = bank;
    }
    this.apply();
    return this;
  }

  setEyeHeight(height) {
    this.firstPerson.eyeHeight = height;
    if (this.type === "first-person") this.apply();
    return this;
  }

  setRodLength(length) {
    if (this.type === "follow") {
      this.follow.distance = this.clamp(length, this.follow.minDistance, this.follow.maxDistance);
    } else {
      this.orbit.distance = this.clamp(length, this.orbit.minDistance, this.orbit.maxDistance);
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
      this.rodNode.setAttitude(state.yaw, state.pitch, state.bank);
      this.eyeNode.setPosition(0.0, 0.0, state.distance);
      this.eyeNode.setAttitude(state.lookYaw, state.lookPitch, state.lookBank);
      return this;
    }

    if (this.type === "first-person") {
      const state = this.firstPerson;
      this.baseNode.setPosition(state.position[0], state.position[1], state.position[2]);
      this.baseNode.setAttitude(state.bodyYaw, state.bodyPitch, state.bodyBank);
      this.rodNode.setPosition(0.0, state.eyeHeight, 0.0);
      this.rodNode.setAttitude(0.0, 0.0, 0.0);
      this.eyeNode.setPosition(0.0, 0.0, 0.0);
      this.eyeNode.setAttitude(state.lookYaw, state.lookPitch, state.lookBank);
      return this;
    }

    const state = this.follow;
    const baseYaw = this.resolveFollowBaseYaw();
    this.baseNode.setPosition(state.currentTarget[0], state.currentTarget[1], state.currentTarget[2]);
    this.baseNode.setAttitude(baseYaw, 0.0, 0.0);
    this.rodNode.setPosition(0.0, 0.0, 0.0);
    this.rodNode.setAttitude(state.yaw, state.pitch, state.bank);
    this.eyeNode.setPosition(0.0, 0.0, state.distance);
    this.eyeNode.setAttitude(state.lookYaw, state.lookPitch, state.lookBank);
    return this;
  }

  update(deltaSec) {
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
    const inputLeft = this.input.has(state.keyMap.left);
    const inputRight = this.input.has(state.keyMap.right);
    const inputUp = this.input.has(state.keyMap.up);
    const inputDown = this.input.has(state.keyMap.down);
    const inputZoomIn = this.input.has(state.keyMap.zoomIn);
    const inputZoomOut = this.input.has(state.keyMap.zoomOut);
    const shiftPan = this.input.has("shift");
    const keyActive = inputLeft
      || inputRight
      || inputUp
      || inputDown
      || inputZoomIn
      || inputZoomOut;
    let changed = false;
    if (shiftPan) {
      let panX = 0.0;
      let panY = 0.0;
      if (inputLeft) panX -= 1.0;
      if (inputRight) panX += 1.0;
      if (inputUp) panY += 1.0;
      if (inputDown) panY -= 1.0;
      if (panX !== 0.0 || panY !== 0.0) {
        this.panViewByScreenDelta(
          panX * state.keyRotateSpeed * dt,
          panY * state.keyRotateSpeed * dt
        );
        changed = true;
      }
    } else {
      if (inputLeft) {
        state.yaw -= state.keyRotateSpeed * dt;
        changed = true;
      }
      if (inputRight) {
        state.yaw += state.keyRotateSpeed * dt;
        changed = true;
      }
      if (inputUp) {
        state.pitch = this.clamp(state.pitch + state.keyRotateSpeed * dt, state.pitchMin, state.pitchMax);
        changed = true;
      }
      if (inputDown) {
        state.pitch = this.clamp(state.pitch - state.keyRotateSpeed * dt, state.pitchMin, state.pitchMax);
        changed = true;
      }
    }
    if (inputZoomIn) {
      state.distance = this.clamp(
        state.distance - state.keyZoomSpeed * this.getZoomSensitivityScale() * dt,
        state.minDistance,
        state.maxDistance
      );
      changed = true;
    }
    if (inputZoomOut) {
      state.distance = this.clamp(
        state.distance + state.keyZoomSpeed * this.getZoomSensitivityScale() * dt,
        state.minDistance,
        state.maxDistance
      );
      changed = true;
    }
    this.debugState.lastOrbitDeltaSec = dt;
    this.debugState.lastOrbitShiftPan = shiftPan;
    this.debugState.lastOrbitKeyActive = keyActive;
    this.debugState.lastOrbitChanged = changed;
    this.debugState.lastOrbitInputLeft = inputLeft;
    this.debugState.lastOrbitInputRight = inputRight;
    this.debugState.lastOrbitInputUp = inputUp;
    this.debugState.lastOrbitInputDown = inputDown;
    this.debugState.lastOrbitInputZoomIn = inputZoomIn;
    this.debugState.lastOrbitInputZoomOut = inputZoomOut;
    if (changed) this.apply();
    if (keyActive || this.dragging || this.touchGesture.active) {
      this.scheduleRender();
    }
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
    const shiftPan = this.input?.has("shift") === true;
    const keyActive = this.input
      ? this.input.has(state.keyMap.left)
        || this.input.has(state.keyMap.right)
        || this.input.has(state.keyMap.up)
        || this.input.has(state.keyMap.down)
        || this.input.has(state.keyMap.zoomIn)
        || this.input.has(state.keyMap.zoomOut)
      : false;
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
    if (keyActive || this.dragging || this.touchGesture.active) {
      this.scheduleRender();
    }
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

  onPointerDown(ev) {
    if (!this.enabled) return;
    this.scheduleRender();
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
    if (ev.button !== this.dragButton) return;
    this.dragging = true;
    this.pointerId = ev.pointerId;
    this.lastClientX = ev.clientX;
    this.lastClientY = ev.clientY;
    if (this.element?.setPointerCapture) {
      this.element.setPointerCapture(ev.pointerId);
    }
    ev.preventDefault();
  }

  onPointerMove(ev) {
    if (!this.enabled) return;
    this.scheduleRender();
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

    // orbit / follow では Shift を押しながら drag したときに
    // 視線の screen 平面に沿った pan として扱う
    // これにより、rotation と pan を同じ pointer 経路の中で切り替えられる
    if (!this.isTouchPointerEvent(ev) && ev.shiftKey === true && this.type !== "first-person") {
      this.panViewByScreenDelta(dx, dy);
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
    this.scheduleRender();
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

  onWheel(ev) {
    if (!this.enabled) return;
    this.scheduleRender();
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
