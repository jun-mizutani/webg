// ---------------------------------------------
// CameraRig.js   2026/04/22
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// CameraRig:
// - 視点 helper を `base -> rod -> carriage -> mount -> camera` の5段で整理する実験用 helper
// - `type` は orbit / first-person の2種類だけを持ち、core の責務を絞る
// - rod は主姿勢、carriage は距離、mount は carriage 平面上の移動、camera は最終姿勢と微小 offset を担当する
// - pan の単位は screen drag ではなく carriage 平面上の local X/Y をそのまま使う
// - loader 系で bbox の 5% を使いたい場合も、その値を呼び出し側で計算して setPan()/addPan() へ渡せばよい
// - まだ入力系は持たず、mode 切替と state -> node 反映だけに専念する
import util from "./util.js";

export default class CameraRig {

  // CameraRig 自身が 5 node を所有し、
  // 外側は mode ごとの state を調整して `apply()` するだけでよい構成にする
  constructor(options = {}) {
    this.space = options.space ?? null;
    this.parentNode = options.parentNode ?? null;
    this.namePrefix = options.namePrefix ?? "camera";
    if (!this.space?.addNode) {
      throw new Error("CameraRig requires options.space with addNode()");
    }

    this.type = util.readEnumOption(
      [{ value: options.type, label: "CameraRig type" }],
      "CameraRig type",
      "orbit",
      ["orbit", "first-person"]
    );
    this.distanceMin = util.readFiniteOption(
      [{ value: options.minDistance, label: "CameraRig minDistance" }],
      "CameraRig minDistance",
      0.01,
      { minExclusive: 0.0 }
    );
    this.distanceMax = util.readFiniteOption(
      [{ value: options.maxDistance, label: "CameraRig maxDistance" }],
      "CameraRig maxDistance",
      1000000.0,
      { minExclusive: 0.0 }
    );
    if (this.distanceMin > this.distanceMax) {
      throw new Error("CameraRig minDistance must be <= maxDistance");
    }

    this.defaults = {
      orbit: this.readOrbitState(options),
      firstPerson: this.readFirstPersonState(options)
    };
    this.orbit = this.cloneState(this.defaults.orbit);
    this.firstPerson = this.cloneState(this.defaults.firstPerson);

    this.baseNode = this.space.addNode(this.parentNode, options.baseName ?? `${this.namePrefix}Base`);
    this.rodNode = this.space.addNode(this.baseNode, options.rodName ?? `${this.namePrefix}Rod`);
    this.carriageNode = this.space.addNode(this.rodNode, options.carriageName ?? `${this.namePrefix}Carriage`);
    this.mountNode = this.space.addNode(this.carriageNode, options.mountName ?? `${this.namePrefix}Mount`);
    this.cameraNode = this.space.addNode(this.mountNode, options.cameraName ?? `${this.namePrefix}Eye`);

    // 5 node の責務は mode が変わっても固定する
    // apply() が毎回 mode state から同じ責務へ投影する
    this.baseNode.setPosition(0.0, 0.0, 0.0);
    this.baseNode.setAttitude(0.0, 0.0, 0.0);
    this.rodNode.setPosition(0.0, 0.0, 0.0);
    this.rodNode.setAttitude(0.0, 0.0, 0.0);
    this.carriageNode.setPosition(0.0, 0.0, 0.0);
    this.carriageNode.setAttitude(0.0, 0.0, 0.0);
    this.mountNode.setPosition(0.0, 0.0, 0.0);
    this.mountNode.setAttitude(0.0, 0.0, 0.0);
    this.cameraNode.setPosition(0.0, 0.0, 0.0);
    this.cameraNode.setAttitude(0.0, 0.0, 0.0);

    this.apply();
  }

  // orbit は base が world 基準点、rod が orbit 姿勢、
  // carriage が距離、mount が pan、camera が最終姿勢を持つ
  readOrbitState(options = {}) {
    const state = {
      basePosition: util.readVec3Option(
        [
          { value: options.orbit?.basePosition, label: "options.orbit.basePosition" },
          { value: options.basePosition, label: "options.basePosition" },
          { value: options.target, label: "options.target" }
        ],
        "CameraRig orbit.basePosition",
        [0.0, 0.0, 0.0]
      ),
      rodAngles: [
        util.readFiniteOption(
          [
            { value: options.orbit?.yaw, label: "options.orbit.yaw" },
            { value: options.yaw, label: "options.yaw" }
          ],
          "CameraRig orbit.yaw",
          0.0
        ),
        util.readFiniteOption(
          [
            { value: options.orbit?.pitch, label: "options.orbit.pitch" },
            { value: options.pitch, label: "options.pitch" }
          ],
          "CameraRig orbit.pitch",
          0.0
        ),
        util.readFiniteOption(
          [
            { value: options.orbit?.bank, label: "options.orbit.bank" },
            { value: options.bank, label: "options.bank" }
          ],
          "CameraRig orbit.bank",
          0.0
        )
      ],
      distance: this.readDistanceOption(
        [
          { value: options.orbit?.distance, label: "options.orbit.distance" },
          { value: options.distance, label: "options.distance" }
        ],
        "CameraRig orbit.distance",
        28.0
      ),
      pan: [
        util.readFiniteOption([{ value: options.orbit?.panX, label: "options.orbit.panX" }], "CameraRig orbit.panX", 0.0),
        util.readFiniteOption([{ value: options.orbit?.panY, label: "options.orbit.panY" }], "CameraRig orbit.panY", 0.0)
      ],
      cameraPosition: util.readVec3Option(
        [{ value: options.orbit?.cameraPosition, label: "options.orbit.cameraPosition" }],
        "CameraRig orbit.cameraPosition",
        [0.0, 0.0, 0.0]
      ),
      cameraAngles: [
        util.readFiniteOption([{ value: options.orbit?.cameraYaw, label: "options.orbit.cameraYaw" }], "CameraRig orbit.cameraYaw", 0.0),
        util.readFiniteOption([{ value: options.orbit?.cameraPitch, label: "options.orbit.cameraPitch" }], "CameraRig orbit.cameraPitch", 0.0),
        util.readFiniteOption([{ value: options.orbit?.cameraBank, label: "options.orbit.cameraBank" }], "CameraRig orbit.cameraBank", 0.0)
      ]
    };
    state.distance = this.clampDistance(state.distance);
    return state;
  }

  // first-person では base が body/world 位置、rod が body 姿勢、
  // mount が eyeHeight を持つ台、camera が look 姿勢を持つ head として振る舞う
  readFirstPersonState(options = {}) {
    return {
      basePosition: util.readVec3Option(
        [
          { value: options.firstPerson?.position, label: "options.firstPerson.position" },
          { value: options.position, label: "options.position" }
        ],
        "CameraRig firstPerson.position",
        [0.0, 0.0, 0.0]
      ),
      rodAngles: [
        util.readFiniteOption(
          [
            { value: options.firstPerson?.bodyYaw, label: "options.firstPerson.bodyYaw" },
            { value: options.firstPerson?.yaw, label: "options.firstPerson.yaw" }
          ],
          "CameraRig firstPerson.bodyYaw",
          0.0
        ),
        util.readFiniteOption(
          [{ value: options.firstPerson?.bodyPitch, label: "options.firstPerson.bodyPitch" }],
          "CameraRig firstPerson.bodyPitch",
          0.0
        ),
        util.readFiniteOption(
          [{ value: options.firstPerson?.bodyBank, label: "options.firstPerson.bodyBank" }],
          "CameraRig firstPerson.bodyBank",
          0.0
        )
      ],
      eyeHeight: util.readFiniteOption(
        [{ value: options.firstPerson?.eyeHeight, label: "options.firstPerson.eyeHeight" }],
        "CameraRig firstPerson.eyeHeight",
        1.6
      ),
      cameraPosition: util.readVec3Option(
        [{ value: options.firstPerson?.cameraPosition, label: "options.firstPerson.cameraPosition" }],
        "CameraRig firstPerson.cameraPosition",
        [0.0, 0.0, 0.0]
      ),
      cameraAngles: [
        util.readFiniteOption([{ value: options.firstPerson?.lookYaw, label: "options.firstPerson.lookYaw" }], "CameraRig firstPerson.lookYaw", 0.0),
        util.readFiniteOption([{ value: options.firstPerson?.lookPitch, label: "options.firstPerson.lookPitch" }], "CameraRig firstPerson.lookPitch", 0.0),
        util.readFiniteOption([{ value: options.firstPerson?.lookBank, label: "options.firstPerson.lookBank" }], "CameraRig firstPerson.lookBank", 0.0)
      ]
    };
  }

  readDistanceOption(candidates, name, defaultValue) {
    return util.readFiniteOption(candidates, name, defaultValue, { minExclusive: 0.0 });
  }

  cloneState(state) {
    if (Array.isArray(state)) {
      return state.map((item) => this.cloneState(item));
    }
    if (!state || typeof state !== "object") {
      return state;
    }
    const cloned = {};
    for (const key of Object.keys(state)) {
      cloned[key] = this.cloneState(state[key]);
    }
    return cloned;
  }

  getNodes() {
    return {
      base: this.baseNode,
      rod: this.rodNode,
      carriage: this.carriageNode,
      mount: this.mountNode,
      camera: this.cameraNode
    };
  }

  getModeState(type = this.type) {
    if (type === "first-person") return this.firstPerson;
    return this.orbit;
  }

  setType(type) {
    this.type = util.readOptionalEnum(type, "CameraRig type", this.type, ["orbit", "first-person"]);
    this.apply();
    return this;
  }

  setBasePosition(x, y, z) {
    const state = this.getModeState();
    state.basePosition[0] = util.readFiniteNumber(x, "CameraRig basePosition.x");
    state.basePosition[1] = util.readFiniteNumber(y, "CameraRig basePosition.y");
    state.basePosition[2] = util.readFiniteNumber(z, "CameraRig basePosition.z");
    return this;
  }

  setTarget(x, y, z) {
    return this.setBasePosition(x, y, z);
  }

  setPosition(x, y, z) {
    return this.setBasePosition(x, y, z);
  }

  moveBase(dx, dy, dz) {
    const state = this.getModeState();
    state.basePosition[0] += util.readFiniteNumber(dx, "CameraRig moveBase.dx");
    state.basePosition[1] += util.readFiniteNumber(dy, "CameraRig moveBase.dy");
    state.basePosition[2] += util.readFiniteNumber(dz, "CameraRig moveBase.dz");
    return this;
  }

  setRodAngles(head, pitch, bank = 0.0) {
    const state = this.getModeState();
    state.rodAngles[0] = util.readFiniteNumber(head, "CameraRig rodAngles.head");
    state.rodAngles[1] = util.readFiniteNumber(pitch, "CameraRig rodAngles.pitch");
    state.rodAngles[2] = util.readFiniteNumber(bank, "CameraRig rodAngles.bank");
    return this;
  }

  rotateRod(deltaHead = 0.0, deltaPitch = 0.0, deltaBank = 0.0) {
    const state = this.getModeState();
    state.rodAngles[0] += util.readFiniteNumber(deltaHead, "CameraRig rotateRod.deltaHead");
    state.rodAngles[1] += util.readFiniteNumber(deltaPitch, "CameraRig rotateRod.deltaPitch");
    state.rodAngles[2] += util.readFiniteNumber(deltaBank, "CameraRig rotateRod.deltaBank");
    return this;
  }

  setDistance(distance) {
    if (this.type === "first-person") {
      throw new Error("CameraRig first-person mode does not use distance");
    }
    this.orbit.distance = this.clampDistance(util.readFiniteNumber(distance, "CameraRig distance"));
    return this;
  }

  addDistance(deltaDistance) {
    if (this.type === "first-person") {
      throw new Error("CameraRig first-person mode does not use distance");
    }
    this.orbit.distance = this.clampDistance(
      this.orbit.distance + util.readFiniteNumber(deltaDistance, "CameraRig deltaDistance")
    );
    return this;
  }

  setPan(x, y) {
    if (this.type === "first-person") {
      throw new Error("CameraRig first-person mode does not use carriage-plane pan");
    }
    this.orbit.pan[0] = util.readFiniteNumber(x, "CameraRig pan.x");
    this.orbit.pan[1] = util.readFiniteNumber(y, "CameraRig pan.y");
    return this;
  }

  addPan(deltaX = 0.0, deltaY = 0.0) {
    if (this.type === "first-person") {
      throw new Error("CameraRig first-person mode does not use carriage-plane pan");
    }
    this.orbit.pan[0] += util.readFiniteNumber(deltaX, "CameraRig addPan.deltaX");
    this.orbit.pan[1] += util.readFiniteNumber(deltaY, "CameraRig addPan.deltaY");
    return this;
  }

  setCameraPosition(x, y, z) {
    const state = this.getModeState();
    state.cameraPosition[0] = util.readFiniteNumber(x, "CameraRig cameraPosition.x");
    state.cameraPosition[1] = util.readFiniteNumber(y, "CameraRig cameraPosition.y");
    state.cameraPosition[2] = util.readFiniteNumber(z, "CameraRig cameraPosition.z");
    return this;
  }

  setCameraAngles(head, pitch, bank = 0.0) {
    const state = this.getModeState();
    state.cameraAngles[0] = util.readFiniteNumber(head, "CameraRig cameraAngles.head");
    state.cameraAngles[1] = util.readFiniteNumber(pitch, "CameraRig cameraAngles.pitch");
    state.cameraAngles[2] = util.readFiniteNumber(bank, "CameraRig cameraAngles.bank");
    return this;
  }

  rotateCamera(deltaHead = 0.0, deltaPitch = 0.0, deltaBank = 0.0) {
    const state = this.getModeState();
    state.cameraAngles[0] += util.readFiniteNumber(deltaHead, "CameraRig rotateCamera.deltaHead");
    state.cameraAngles[1] += util.readFiniteNumber(deltaPitch, "CameraRig rotateCamera.deltaPitch");
    state.cameraAngles[2] += util.readFiniteNumber(deltaBank, "CameraRig rotateCamera.deltaBank");
    return this;
  }

  setEyeHeight(height) {
    this.firstPerson.eyeHeight = util.readFiniteNumber(height, "CameraRig firstPerson.eyeHeight");
    return this;
  }

  update(deltaSec = 0.0) {
    util.readFiniteNumber(deltaSec, "CameraRig deltaSec");
    this.apply();
    return this;
  }

  apply() {
    if (this.type === "first-person") {
      return this.applyFirstPerson();
    }
    return this.applyOrbit();
  }

  applyOrbit() {
    const state = this.orbit;
    return this.applyNodeState({
      basePosition: state.basePosition,
      baseAngles: [0.0, 0.0, 0.0],
      rodAngles: state.rodAngles,
      carriagePosition: [0.0, 0.0, state.distance],
      mountPosition: [state.pan[0], state.pan[1], 0.0],
      cameraPosition: state.cameraPosition,
      cameraAngles: state.cameraAngles
    });
  }

  applyFirstPerson() {
    const state = this.firstPerson;
    return this.applyNodeState({
      basePosition: state.basePosition,
      baseAngles: [0.0, 0.0, 0.0],
      rodAngles: state.rodAngles,
      carriagePosition: [0.0, 0.0, 0.0],
      mountPosition: [0.0, state.eyeHeight, 0.0],
      cameraPosition: state.cameraPosition,
      cameraAngles: state.cameraAngles
    });
  }

  applyNodeState(state) {
    this.baseNode.setPosition(...state.basePosition);
    this.baseNode.setAttitude(...state.baseAngles);
    this.rodNode.setPosition(0.0, 0.0, 0.0);
    this.rodNode.setAttitude(...state.rodAngles);
    this.carriageNode.setPosition(...state.carriagePosition);
    this.carriageNode.setAttitude(0.0, 0.0, 0.0);
    this.mountNode.setPosition(...state.mountPosition);
    this.mountNode.setAttitude(0.0, 0.0, 0.0);
    this.cameraNode.setPosition(...state.cameraPosition);
    this.cameraNode.setAttitude(...state.cameraAngles);
    return this;
  }

  resetOrbit() {
    this.orbit = this.cloneState(this.defaults.orbit);
    return this;
  }

  resetTranslate() {
    if (this.type === "first-person") {
      this.firstPerson.eyeHeight = this.defaults.firstPerson.eyeHeight;
      return this;
    }
    this.orbit.pan = [...this.defaults.orbit.pan];
    return this;
  }

  resetDistance() {
    if (this.type === "first-person") {
      throw new Error("CameraRig first-person mode does not use distance");
    }
    this.orbit.distance = this.clampDistance(this.defaults.orbit.distance);
    return this;
  }

  resetCameraPose() {
    const key = this.type === "first-person" ? "firstPerson" : "orbit";
    const state = this.getModeState();
    state.cameraPosition = [...this.defaults[key].cameraPosition];
    state.cameraAngles = [...this.defaults[key].cameraAngles];
    return this;
  }

  resetAll() {
    this.orbit = this.cloneState(this.defaults.orbit);
    this.firstPerson = this.cloneState(this.defaults.firstPerson);
    return this;
  }

  getState() {
    return {
      type: this.type,
      orbit: this.cloneState(this.orbit),
      firstPerson: this.cloneState(this.firstPerson)
    };
  }

  clampDistance(distance) {
    if (!Number.isFinite(distance)) {
      throw new Error("CameraRig distance must be finite");
    }
    if (distance < this.distanceMin) {
      return this.distanceMin;
    }
    if (distance > this.distanceMax) {
      return this.distanceMax;
    }
    return distance;
  }
}
