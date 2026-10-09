// ---------------------------------------------
// ComputePhysicsSpace.js  2026/09/23
//   GPU rigid-body Box, Sphere, and local-Y Capsule simulation with an XZ Grid broad phase
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";
import PhysicsMaterialPairs from "./PhysicsMaterialPairs.js";
import ComputeBoxCollider from "./ComputeBoxCollider.js";
import ComputeSphereCollider from "./ComputeSphereCollider.js";
import ComputeCapsuleCollider from "./ComputeCapsuleCollider.js";
import ComputePlaneCollider from "./ComputePlaneCollider.js";
import Quat from "./Quat.js";
import ComputePhysicsPipeline from "./ComputePhysicsPipeline.js";
import { createComputePhysicsWGSL } from "./ComputePhysicsShader.js";
import * as computePhysicsReadback from "./ComputePhysicsReadback.js";
export {
  COMPUTE_PHYSICS_BODY_STATE_LAYOUT,
  COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT,
  COMPUTE_PHYSICS_BODY_TYPES,
  COMPUTE_PHYSICS_BODY_COMMAND_FLAGS,
  COMPUTE_PHYSICS_BROADPHASE_MODE,
  DEFAULT_COMPUTE_PHYSICS_SCALE
} from "./ComputeBodyState.js";
import {
  COMPUTE_PHYSICS_BODY_STATE_LAYOUT,
  COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT,
  COMPUTE_PHYSICS_BODY_TYPES,
  COMPUTE_PHYSICS_BODY_COMMAND_FLAGS,
  COMPUTE_PHYSICS_BROADPHASE_MODE,
  DEFAULT_COMPUTE_PHYSICS_SCALE,
  DEFAULT_BODY_MATERIAL,
  DEFAULT_BODY_CONTROL,
  WORKGROUP_SIZE,
  MAX_SOLVER_ITERATIONS
} from "./ComputeBodyState.js";

// GPU上のBox、Sphere、local-Y Capsule状態、Broad Phase、局所solver、停止状態を一つの固定step処理として管理します
// command encoderとsubmitは呼出側が管理し、最新Storage Bufferをそのまま描画へ渡せる形で公開します
export default class ComputePhysicsSpace {
  // WebGPU contextと容量、固定step、空間範囲、寸法スケールを検証してGPUリソースを生成します
  // bodyを同時に渡した場合も全設定の成立後に転送し、完成した状態からsimulationを開始します
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputePhysicsSpace requires a ready WebGPU context");
    }
    const opts = util.readPlainObject(options, "ComputePhysicsSpace options", {});
    // GPU実体を保持し、以降のStorage Buffer、Uniform、pipeline生成を同じdeviceへ固定します
    this.gpu = gpu;
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.label = util.readOptionalString(
      opts.label,
      "ComputePhysicsSpace label",
      "compute-physics-space",
      { trim: true, allowEmpty: false }
    );
    this.maxBodies = util.readOptionalInteger(
      opts.maxBodies,
      `${this.label} maxBodies`,
      200,
      { min: 1, max: 4096 }
    );
    // Joint bufferの容量とbodyごとのadjacency上限を初期化時に固定し、GPU配列の範囲を初期値で管理します
    this.maxJoints = util.readOptionalInteger(
      opts.maxJoints,
      `${this.label} maxJoints`,
      256,
      { min: 1, max: 8192 }
    );
    this.maxJointsPerBody = util.readOptionalInteger(
      opts.maxJointsPerBody,
      `${this.label} maxJointsPerBody`,
      64,
      { min: 1, max: this.maxJoints }
    );
    this.jointSolverIterations = util.readOptionalInteger(
      opts.jointSolverIterations,
      `${this.label} jointSolverIterations`,
      8,
      { min: 1, max: 64 }
    );
    // body容量とBroad Phase容量はcandidate bitsetのサイズへ直結するため、初期化時に確定します
    this.gridSize = util.readOptionalInteger(
      opts.gridSize,
      `${this.label} gridSize`,
      16,
      { min: 1, max: 128 }
    );
    this.broadphaseMode = util.readOptionalEnum(
      opts.broadphaseMode,
      `${this.label} broadphaseMode`,
      COMPUTE_PHYSICS_BROADPHASE_MODE,
      [COMPUTE_PHYSICS_BROADPHASE_MODE]
    );
    this.fixedTimeStepMs = util.readOptionalFiniteNumber(
      opts.fixedTimeStepMs,
      `${this.label} fixedTimeStepMs`,
      1000 / 120,
      { minExclusive: 0 }
    );
    this.maxSubSteps = util.readOptionalInteger(
      opts.maxSubSteps,
      `${this.label} maxSubSteps`,
      6,
      { min: 1, max: 64 }
    );
    this.solverIterations = util.readOptionalInteger(
      opts.solverIterations,
      `${this.label} solverIterations`,
      12,
      { min: 1, max: MAX_SOLVER_ITERATIONS }
    );
    this.defaultRestitution = util.readOptionalFiniteNumber(
      opts.defaultRestitution,
      `${this.label} defaultRestitution`,
      DEFAULT_BODY_MATERIAL.restitution,
      { min: 0, max: 1 }
    );
    this.defaultFriction = util.readOptionalFiniteNumber(
      opts.defaultFriction,
      `${this.label} defaultFriction`,
      DEFAULT_BODY_MATERIAL.friction,
      { min: 0 }
    );
    this.materialPairs = new PhysicsMaterialPairs({ ...opts, defaultRestitution: this.defaultRestitution, defaultFriction: this.defaultFriction });
    this.gravity = this.readVec3(opts.gravity ?? [0, -4.9, 0], `${this.label} gravity`);
    this.bounds = this.readBounds(opts.bounds);
    this.maxPlanes = util.readOptionalInteger(
      opts.maxPlanes,
      `${this.label} maxPlanes`,
      16,
      { min: 1, max: 256 }
    );
    this.planes = this.readPlanes(opts.planes);
    this.scale = this.readScale(opts.scale);
    if (opts.restingRestitutionSpeed !== undefined) this.scale = Object.freeze({ ...this.scale,
      restingRestitutionSpeed: util.readFiniteNumber(opts.restingRestitutionSpeed, "restingRestitutionSpeed", { min: 0 }) });
    // 物理の寸法、固定step、Plane、補正量を先に検証し、GPU resource生成へ検証済み値を渡します
    this.positionCorrectionBeta = util.readOptionalFiniteNumber(
      opts.positionCorrectionBeta,
      `${this.label} positionCorrectionBeta`,
      1,
      { min: 0, max: 1 }
    );
    this.sleepEnabled = util.readOptionalBoolean(
      opts.persistentSleep,
      `${this.label} persistentSleep`,
      true
    );
    this.sleepAngularSpeed = util.readOptionalFiniteNumber(
      opts.sleepAngularSpeed,
      `${this.label} sleepAngularSpeed`,
      0.5,
      { min: 0 }
    );
    this.wakeAngularSpeed = util.readOptionalFiniteNumber(
      opts.wakeAngularSpeed,
      `${this.label} wakeAngularSpeed`,
      this.sleepAngularSpeed * 1.5,
      { min: 0 }
    );
    if (this.scale.wakeLinearSpeed < this.scale.sleepLinearSpeed) {
      throw new Error(`${this.label} wakeLinearSpeed must be at least sleepLinearSpeed`);
    }
    if (this.wakeAngularSpeed < this.sleepAngularSpeed) {
      throw new Error(`${this.label} wakeAngularSpeed must be at least sleepAngularSpeed`);
    }
    // sleep/wakeの閾値関係を確定した後、床支持条件を保持します
    this.sleepSteps = util.readOptionalInteger(
      opts.sleepSteps,
      `${this.label} sleepSteps`,
      5,
      { min: 1, max: 65535 }
    );
    this.timeToSleep = opts.timeToSleep === undefined ? null : util.readFiniteNumber(opts.timeToSleep, "timeToSleep", { minExclusive: 0 });
    this.minimumFloorSupportPoints = util.readOptionalInteger(
      opts.minimumFloorSupportPoints,
      `${this.label} minimumFloorSupportPoints`,
      2,
      { min: 1, max: 8 }
    );
    this.bodyCount = 0;
    this.bodySlotCount = 0;
    this.bodyRecords = new Map();
    this.slotRecords = new Array(this.maxBodies).fill(null);
    this.readbackContactMap = new Map();
    this.readbackContactEventOptions = null;
    this.lastReadbackContacts = [];
    this.lastReadbackManifolds = [];
    this.lastReadbackContactEvents = { begin: [], stay: [], end: [] };
    this.beginContactListeners = [];
    this.stayContactListeners = [];
    this.endContactListeners = [];
    this.nextBodyId = 1;
    this.accumulatorMs = 0;
    this.fixedStepCount = 0;
    this.destroyed = false;
    // 初期bodyの形状だけをshaderへ渡し、混在しないsampleで未使用の接触式をコンパイルしません
    this.computeShapeKinds = this.readComputeShapeKinds(opts.bodies);
    // GPU resource生成を専用部品へ委譲し、body登録やfixed stepの公開処理をこのクラスに残します
    this.computePhysicsPipeline = new ComputePhysicsPipeline(this);
    // すべての設定とCPU側の状態容器を準備してからGPU resourceを生成します
    this.createResources();
    if (opts.bodies !== undefined) {
      // 初期bodyの全件検証と2本のstate bufferへの転送はresource生成後に一度だけ行います
      this.setBodies(opts.bodies);
    }
  }

  /** @internal
   * 三要素の有限数配列を複製し、呼出側の配列変更が内部設定へ影響しない値にします
   * 要素不足を0で補わず、GPUへ渡すvec3の意味が不明な入力として例外にします
   */
  readVec3(value, name) {
    if (!Array.isArray(value) || value.length !== 3) {
      throw new Error(`${name} must be a 3 element array`);
    }
    return value.map((entry, index) => util.readFiniteNumber(entry, `${name}[${index}]`));
  }

  /** @internal
   * 初期descriptorのcollider種別を調べ、shader生成へ渡す最小の形状集合を返します
   * bodyなし、または検証前の不正入力では全形状を残し、既存の入力エラーをpackBodyへ委譲します
   */
  readComputeShapeKinds(bodies) {
    const allKinds = new Set(["box", "sphere", "capsule"]);
    // body未登録のspaceは最頻用のBoxだけで初期化し、後からSphere/Capsuleを追加した時だけ再生成します
    if (!Array.isArray(bodies) || bodies.length === 0) return new Set(["box"]);
    const kinds = new Set();
    for (const body of bodies) {
      if (!body || typeof body !== "object") return allKinds;
      if (body.collider instanceof ComputeBoxCollider) kinds.add("box");
      else if (body.collider instanceof ComputeSphereCollider) kinds.add("sphere");
      else if (body.collider instanceof ComputeCapsuleCollider) kinds.add("capsule");
      else if (body.collider === undefined && body.halfExtents !== undefined) kinds.add("box");
      else return allKinds;
    }
    return kinds.size > 0 ? kinds : allKinds;
  }

  /** @internal
   * 後から追加するbodyの形状が現在のshaderに無ければ、次step前に形状式を含むpipelineへ更新します
   */
  ensureComputeShapeKind(kind) {
    if (this.computeShapeKinds.has(kind)) return false;
    this.computeShapeKinds = new Set([...this.computeShapeKinds, kind]);
    this.createPipelines();
    this.createBindGroups();
    return true;
  }

  /** @internal
   * setBodiesで確定した形状集合が変わった場合だけ、未使用形状を除いたshaderを再生成します
   */
  setComputeShapeKinds(kinds) {
    if (!(kinds instanceof Set) || kinds.size === 0) return false;
    const current = this.computeShapeKinds;
    if (current.size === kinds.size && [...current].every((kind) => kinds.has(kind))) return false;
    this.computeShapeKinds = new Set(kinds);
    this.createPipelines();
    this.createBindGroups();
    return true;
  }

  /** @internal
   * bodyTypeをCPU版と同じ3種類へ限定し、対応する文字列をGPU側へ明示します
   * typeごとの逆質量や重力の扱いはpackBodyとWGSLで同じ値を参照します
   */
  readBodyType(value, name, fallback = DEFAULT_BODY_CONTROL.bodyType) {
    return util.readOptionalEnum(
      value,
      name,
      fallback,
      Object.keys(COMPUTE_PHYSICS_BODY_TYPES)
    );
  }

  /** @internal
   * collision layer / mask用の32bit bitmaskを検証します
   * 小数や範囲外の値を丸めず、GPUのbit演算と意味が一致しない入力を拒否します
   */
  readCollisionBits(value, name, fallback) {
    return util.readOptionalFiniteNumber(value, name, fallback, {
      integer: true,
      min: 0,
      max: 0xffffffff
    });
  }

  /** @internal
   * XZ Gridの範囲と床高さを読み、幅0や反転した範囲をBroad Phaseへ渡さないようにします
   * Y上限は設けず、swept Yは動的body同士の候補除外だけに使用します
   */
  readBounds(value) {
    const bounds = util.readPlainObject(value, `${this.label} bounds`, {});
    const result = {
      minX: util.readOptionalFiniteNumber(bounds.minX, `${this.label} bounds.minX`, -0.6),
      maxX: util.readOptionalFiniteNumber(bounds.maxX, `${this.label} bounds.maxX`, 0.6),
      minZ: util.readOptionalFiniteNumber(bounds.minZ, `${this.label} bounds.minZ`, -0.6),
      maxZ: util.readOptionalFiniteNumber(bounds.maxZ, `${this.label} bounds.maxZ`, 0.6),
      floorY: util.readOptionalFiniteNumber(bounds.floorY, `${this.label} bounds.floorY`, 0)
    };
    if (result.minX >= result.maxX) {
      throw new Error(`${this.label} bounds.minX must be smaller than bounds.maxX`);
    }
    if (result.minZ >= result.maxZ) {
      throw new Error(`${this.label} bounds.minZ must be smaller than bounds.maxZ`);
    }
    return Object.freeze(result);
  }

  /** @internal
   * 明示されたComputePlaneCollider配列、またはboundsから作る床と四壁を検証して保持します
   * plain objectを平面として受け取らず、形状classを通してnormalとplaneDistanceの意味を固定します
   */
  readPlanes(value) {
    const planes = value === undefined
      ? ComputePlaneCollider.createBoundaryPlanes(this.bounds)
      : value;
    if (!Array.isArray(planes)) {
      throw new Error(`${this.label} planes must be an array of ComputePlaneCollider`);
    }
    if (planes.length > this.maxPlanes) {
      throw new Error(`${this.label} plane count exceeds maxPlanes: ${planes.length} > ${this.maxPlanes}`);
    }
    planes.forEach((plane, index) => {
      if (!(plane instanceof ComputePlaneCollider)) {
        throw new Error(`${this.label} planes[${index}] must be a ComputePlaneCollider`);
      }
    });
    return Object.freeze([...planes]);
  }

  /** @internal
   * すべての寸法依存値をreferenceLengthと無次元比率へ分けて読みます
   * 個別の実寸しきい値を別optionへ散らさず、worldサイズ変更時の調整箇所をこの設定へ集約します
   */
  readScale(value) {
    const scale = util.readPlainObject(value, `${this.label} scale`, {});
    const checked = {};
    for (const [name, defaultValue] of Object.entries(DEFAULT_COMPUTE_PHYSICS_SCALE)) {
      checked[name] = util.readOptionalFiniteNumber(
        scale[name],
        `${this.label} scale.${name}`,
        defaultValue,
        { minExclusive: 0 }
      );
    }
    return Object.freeze({
      ...checked,
      broadphasePadding: checked.referenceLength * checked.broadphasePaddingRatio,
      positionSlop: checked.referenceLength * checked.positionSlopRatio,
      supportFeatureTolerance: checked.referenceLength * checked.supportFeatureToleranceRatio,
      restingRestitutionSpeed: checked.referenceLength * checked.restingRestitutionSpeedRatio,
      sleepLinearSpeed: checked.referenceLength * checked.sleepLinearSpeedRatio,
      wakeLinearSpeed: checked.referenceLength * checked.wakeLinearSpeedRatio,
      sleepContactSpeed: checked.referenceLength * checked.sleepContactSpeedRatio,
      sleepNormalSpeed: checked.referenceLength * checked.sleepNormalSpeedRatio
    });
  }

  /** @internal
   * ComputePhysicsPipelineへGPU resource、pipeline、bind groupの生成を委譲します
   */
  createResources() {
    this.computePhysicsPipeline.createResources();
  }

  /** @internal
   * ComputePhysicsPipelineへGPU pipelineの再生成を委譲します
   */
  createPipelines() {
    this.computePhysicsPipeline.createPipelines();
  }

  /** @internal
   * ComputePhysicsPipelineへGPU bind groupの再生成を委譲します
   */
  createBindGroups() {
    this.computePhysicsPipeline.createBindGroups();
  }

  /** @internal
   * Plane配列をnormal.xyzとplaneDistanceの4 float recordへ変換してStorage Bufferへ転送します
   * 未使用slotは0のまま保持し、ShaderはUniformで指定したplane数までを読みます
   */
  writePlaneData() {
    const data = new Float32Array(this.maxPlanes * 12);
    this.planes.forEach((plane, index) => {
      plane.writeRecord(data, index * 12);
      const m = this.materialPairs.material(plane.material ?? {}, plane.materialId);
      data.set([m.restitution, m.dynamicFriction, m.staticFriction, m.rollingResistanceLength,
        this.materialPairs.numericId(m.materialId), 0, 0, 0], index * 12 + 4);
    });
    this.queue.writeBuffer(this.planeBuffer, 0, data);
  }

  /** @internal
   * 現在設定をWGSLのSimParamsと同じ32個のfloatへ詰めてUniform Bufferへ転送します
   * body数やsleep切替を各fixed step開始前に確定値としてShaderへ渡します
   */
  writeParams() {
    const s = this.scale;
    this.paramData.set([
      this.fixedTimeStepMs / 1000, this.bodySlotCount, this.solverIterations, this.sleepEnabled ? 1 : 0,
      this.gravity[0], this.gravity[1], this.gravity[2], this.positionCorrectionBeta,
      this.bounds.minX, this.bounds.maxX, this.bounds.minZ, this.bounds.maxZ,
      this.planes.length, s.positionSlop, s.broadphasePadding, s.supportFeatureTolerance,
      s.restingRestitutionSpeed, s.sleepLinearSpeed, this.sleepAngularSpeed, s.sleepContactSpeed,
      s.sleepNormalSpeed, this.timeToSleep === null ? this.sleepSteps : Math.max(1, Math.ceil(this.timeToSleep * 1000 / this.fixedTimeStepMs)), this.minimumFloorSupportPoints, this.gridSize,
      this.gridCellCount, this.candidateWordCount, this.candidateWordOffset, this.maxBodies,
      s.wakeLinearSpeed, this.wakeAngularSpeed, 0, 0
    ]);
    this.queue.writeBuffer(this.paramBuffer, 0, this.paramData);
  }

  /** @internal
   * body記述を検証して、BodyStateとBodyControlへ同じbody属性を書き込みます
   * Box、Sphere、local-Y Capsule以外を別形状へ読み替えず、未対応colliderとして初期化時に拒否します
   */
  packBody(body, index, target) {
    const value = util.readPlainObject(body, `${this.label} bodies[${index}]`);
    const prefix = `${this.label} bodies[${index}]`;
    const position = this.readVec3(value.position, `${prefix}.position`);
    let collider;
    // collider classを明示的に検証し、halfExtents指定だけの場合はCompute Boxへ変換します
    if (value.collider !== undefined) {
      if (!(value.collider instanceof ComputeBoxCollider)
        && !(value.collider instanceof ComputeSphereCollider)
        && !(value.collider instanceof ComputeCapsuleCollider)) {
        throw new Error(`${prefix}.collider must be a ComputeBoxCollider, ComputeSphereCollider, or ComputeCapsuleCollider`);
      }
      if (value.halfExtents !== undefined) {
        throw new Error(`${prefix} must not specify both collider and halfExtents`);
      }
      collider = value.collider;
    } else {
      const halfExtentsInput = this.readVec3(value.halfExtents, `${prefix}.halfExtents`);
      collider = new ComputeBoxCollider(halfExtentsInput.map((entry) => entry * 2));
    }
    if (!Array.isArray(collider.offset) || collider.offset.some((entry) => entry !== 0)) {
      throw new Error(`${prefix}.collider offset is not supported by ComputePhysicsSpace BodyState`);
    }
    const bodyType = this.readBodyType(value.bodyType, `${prefix}.bodyType`);
    const colliderKind = collider.getComputeColliderKind();
    // BodyStateのshape欄とtype値を形状ごとに決め、Capsuleのradius/halfSegmentを専用欄へ保持します
    const shapeData = colliderKind === "capsule"
      ? collider.getBodyShapeData()
      : collider.getHalfExtents();
    const colliderType = colliderKind === "sphere" ? 1 : colliderKind === "capsule" ? 2 : 0;
    const orientation = value.orientation === undefined
      ? [1, 0, 0, 0]
      : this.readQuat(value.orientation, `${prefix}.orientation`);
    const linearVelocity = this.readVec3(value.linearVelocity ?? [0, 0, 0], `${prefix}.linearVelocity`);
    const angularVelocity = this.readVec3(value.angularVelocity ?? [0, 0, 0], `${prefix}.angularVelocity`);
    const surfaceVelocity = this.readVec3(value.surfaceVelocity ?? [0, 0, 0], `${prefix}.surfaceVelocity`);
    if (bodyType !== "kinematic" && surfaceVelocity.some((entry) => entry !== 0.0)) {
      throw new Error(`${prefix}.surfaceVelocity requires a kinematic body`);
    }
    const mass = util.readOptionalFiniteNumber(value.mass, `${prefix}.mass`, 1, { min: 0 });
    if (bodyType === "dynamic" && mass <= 0) {
      throw new Error(`${prefix}.mass must be positive for a dynamic body`);
    }
    const inverseMass = bodyType === "dynamic" ? 1 / mass : 0;
    let inverseInertia = value.inverseInertiaLocal === undefined
      ? collider.calculateInverseInertia(inverseMass)
      : this.readVec3(value.inverseInertiaLocal, `${prefix}.inverseInertiaLocal`);
    inverseInertia.forEach((entry, axis) => {
      if (entry < 0) throw new Error(`${prefix}.inverseInertiaLocal[${axis}] must not be negative`);
    });
    const inverseInertiaUnrestricted = [...inverseInertia];
    const fixedRotation = util.readOptionalBoolean(
      value.fixedRotation,
      `${prefix}.fixedRotation`,
      DEFAULT_BODY_CONTROL.fixedRotation
    );
    if (bodyType !== "dynamic" || fixedRotation) {
      if (inverseInertia.some((entry) => entry !== 0)) {
        throw new Error(`${prefix}.inverseInertiaLocal must be zero for a non-rotating body`);
      }
      inverseInertia = [0, 0, 0];
    }
    // materialと表示色を検証し、GPU状態へ書く値とCPU descriptorで参照する値を同じ配列から作ります
    const material = this.materialPairs.material(util.readPlainObject(value.material, `${prefix}.material`, {}), value.materialId);
    const materialValues = [
      util.readOptionalFiniteNumber(material.restitution, `${prefix}.material.restitution`, this.defaultRestitution, { min: 0, max: 1 }),
      util.readOptionalFiniteNumber(material.friction, `${prefix}.material.friction`, this.defaultFriction, { min: 0 }),
      util.readOptionalFiniteNumber(value.linearDamping ?? material.linearDamping, `${prefix}.linearDamping`, DEFAULT_BODY_MATERIAL.linearDamping, { min: 0 }),
      util.readOptionalFiniteNumber(value.angularDamping ?? material.angularDamping, `${prefix}.angularDamping`, DEFAULT_BODY_MATERIAL.angularDamping, { min: 0 })
    ];
    const color = value.color === undefined ? [1, 1, 1, 1] : this.readVec4(value.color, `${prefix}.color`);
    const sleeping = util.readOptionalBoolean(value.isSleeping, `${prefix}.isSleeping`, false);
    const base = index * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideFloats;
    target.set([...position, 1], base + 0);
    target.set(orientation, base + 4);
    target.set([...linearVelocity, inverseMass], base + 8);
    target.set([...angularVelocity, sleeping ? 1 : 0], base + 12);
    target.set([...shapeData, 0], base + 16);
    target.set([...inverseInertia, colliderType], base + 20);
    target.set(materialValues, base + 24);
    target.set(color, base + 28);
    // BodyStateとBodyControlを同じslotへ書き、solverが形状状態と制御属性を別bindingから同じbodyとして読みます
    this.writeControlRecord(value, index, {
      physicsMaterial: material,
      bodyType,
      gravityScale: util.readOptionalFiniteNumber(value.gravityScale, `${prefix}.gravityScale`, DEFAULT_BODY_CONTROL.gravityScale),
      allowSleep: util.readOptionalBoolean(value.allowSleep, `${prefix}.allowSleep`, DEFAULT_BODY_CONTROL.allowSleep),
      isTrigger: util.readOptionalBoolean(value.isTrigger, `${prefix}.isTrigger`, DEFAULT_BODY_CONTROL.isTrigger),
      fixedRotation,
      collisionLayer: this.readCollisionBits(value.collisionLayer, `${prefix}.collisionLayer`, DEFAULT_BODY_CONTROL.collisionLayer),
      collisionMask: this.readCollisionBits(value.collisionMask, `${prefix}.collisionMask`, DEFAULT_BODY_CONTROL.collisionMask),
      surfaceVelocity
    });
    return {
      bodyType,
      gravityScale: util.readOptionalFiniteNumber(value.gravityScale, `${prefix}.gravityScale`, DEFAULT_BODY_CONTROL.gravityScale),
      allowSleep: util.readOptionalBoolean(value.allowSleep, `${prefix}.allowSleep`, DEFAULT_BODY_CONTROL.allowSleep),
      isTrigger: util.readOptionalBoolean(value.isTrigger, `${prefix}.isTrigger`, DEFAULT_BODY_CONTROL.isTrigger),
      fixedRotation,
      collisionLayer: this.readCollisionBits(value.collisionLayer, `${prefix}.collisionLayer`, DEFAULT_BODY_CONTROL.collisionLayer),
      collisionMask: this.readCollisionBits(value.collisionMask, `${prefix}.collisionMask`, DEFAULT_BODY_CONTROL.collisionMask),
      material: materialValues,
      physicsMaterial: material,
      materialExplicit: value.material !== undefined,
      inverseInertiaExplicit: value.inverseInertiaLocal !== undefined,
      inverseInertiaUnrestricted,
      position: [...position],
      orientation: [...orientation],
      collider,
      mass,
      inverseInertia: [...inverseInertia],
      color: [...color],
      surfaceVelocity: [...surfaceVelocity]
    };
  }

  /** @internal
   * BodyControlの属性と命令欄をslotへ書き込み、GPUが次のfixed stepで参照できる状態にします
   * commandFlagsを初期化して、body登録時に現在slotのforceやteleportを明示的に管理します
   */
  writeControlRecord(value, index, config = {}) {
    const base = index * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats;
    this.controlFloats.fill(0, base, base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats);
    this.controlUint32[base + 0] = 1;
    this.controlUint32[base + 1] = COMPUTE_PHYSICS_BODY_TYPES[config.bodyType ?? DEFAULT_BODY_CONTROL.bodyType];
    this.controlUint32[base + 2] = config.allowSleep === false ? 0 : 1;
    this.controlUint32[base + 3] = config.fixedRotation ? 1 : 0;
    this.controlUint32[base + 4] = config.collisionLayer ?? DEFAULT_BODY_CONTROL.collisionLayer;
    this.controlUint32[base + 5] = config.collisionMask ?? DEFAULT_BODY_CONTROL.collisionMask;
    this.controlUint32[base + 6] = config.isTrigger ? 1 : 0;
    this.controlFloats[base + 8] = config.gravityScale ?? DEFAULT_BODY_CONTROL.gravityScale;
    const material = config.physicsMaterial ?? this.materialPairs.material(value.material ?? {}, value.materialId);
    this.controlFloats[base + 9] = this.materialPairs.numericId(material.materialId);
    this.controlFloats[base + 10] = material.staticFriction;
    this.controlFloats[base + 11] = material.rollingResistanceLength;
    this.controlFloats.set(
      [...(config.surfaceVelocity ?? [0.0, 0.0, 0.0]), 0.0],
      base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.surfaceVelocity
    );
    return base;
  }

  /** @internal
   * [w,x,y,z]順のquaternionを正規化して返し、正規化済みの姿勢をそのまま使います
   * CPU入力とWGSLの回転関数で同じ成分順を維持し、姿勢の解釈差を初期化時に防ぎます
   */
  readQuat(value, name) {
    const q = this.readVec4(value, name);
    const length = Math.hypot(q[0], q[1], q[2], q[3]);
    if (length <= 0) throw new Error(`${name} must not be a zero quaternion`);
    return q.map((entry) => entry / length);
  }

  /** @internal
   * 配列またはQuat互換オブジェクトを同じ[w,x,y,z]配列へ変換します
   * PhysicsNode.getQuat()の戻り値を配列へ作り替える呼出側の重複をなくし、姿勢の検証をここへ集約します
   */
  readQuatLike(value, name) {
    if (Array.isArray(value)) {
      return this.readQuat(value, name);
    }
    if (!value || typeof value !== "object" || !Array.isArray(value.q) || value.q.length < 4) {
      throw new Error(`${name} must be a 4 element array or Quat-like object`);
    }
    return this.readQuat(value.q.slice(0, 4), name);
  }

  /** @internal
   * 検証済みの[w,x,y,z]配列をwebgのQuatへ変換します
   * PhysicsNode.syncNodeFromPhysics()が要求するQuat互換形式をCompute側で明示的に構築します
   */
  createQuat(value, name) {
    const q = this.readQuatLike(value, name);
    const quat = new Quat();
    quat.q[0] = q[0];
    quat.q[1] = q[1];
    quat.q[2] = q[2];
    quat.q[3] = q[3];
    return quat;
  }

  /** @internal
   * 四要素の有限数配列を複製し、quaternionとcolorの要素不足を明示的に拒否します
   */
  readVec4(value, name) {
    if (!Array.isArray(value) || value.length !== 4) {
      throw new Error(`${name} must be a 4 element array`);
    }
    return value.map((entry, index) => util.readFiniteNumber(entry, `${name}[${index}]`));
  }

  // body配列全体を検証してから2本のping-pong bufferへ同じ初期stateを書き込みます
  // 最大数超過時に一部だけを切り捨てず、candidate bitset容量との不一致として例外にします
  setBodies(bodies) {
    this.requireAlive();
    if (!Array.isArray(bodies)) throw new Error(`${this.label} setBodies requires an array`);
    if (bodies.length > this.maxBodies) {
      throw new Error(`${this.label} body count exceeds maxBodies: ${bodies.length} > ${this.maxBodies}`);
    }
    // body IDとslotを作り直すため、Jointとreadback metadataを新しいbody配列へ再構築します
    this.joints.clear();
    // bodyとreadback contactを破棄し、新しい配列をslot 0から詰め直します
    const data = new Float32Array(this.maxBodies * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideFloats);
    this.controlFloats.fill(0);
    this.bodyRecords.clear();
    this.slotRecords.fill(null);
    this.readbackContactMap.clear();
    this.readbackContactEventOptions = null;
    this.lastReadbackContacts = [];
    this.lastReadbackManifolds = [];
    this.lastReadbackContactEvents = { begin: [], stay: [], end: [] };
    const usedIds = new Set();
    let nextId = this.nextBodyId;
    // 各bodyを全件検証しながらCPU shadowへ記録し、検証済みの配列だけをGPUへ転送します
    bodies.forEach((body, index) => {
      const value = util.readPlainObject(body, `${this.label} bodies[${index}]`);
      const requestedId = value.id === undefined
        ? nextId
        : util.readFiniteNumber(value.id, `${this.label} bodies[${index}].id`, {
          integer: true,
          minExclusive: 0
        });
      if (usedIds.has(requestedId)) {
        throw new Error(`${this.label} duplicate body id: ${requestedId}`);
      }
      usedIds.add(requestedId);
      nextId = Math.max(nextId, requestedId + 1);
      const descriptor = this.packBody(value, index, data);
      const record = { id: requestedId, slot: index, descriptor };
      this.bodyRecords.set(requestedId, record);
      this.slotRecords[index] = record;
    });
    this.nextBodyId = nextId;
    // 検証済みの同じ初期stateを2本へ書き、ping-pongのどちらから開始しても値を一致させます
    this.stateBuffers.forEach((buffer) => this.queue.writeBuffer(buffer, 0, data));
    this.clearContactHistory();
    this.queue.writeBuffer(this.controlBuffer, 0, this.controlData);
    this.bodyCount = bodies.length;
    this.bodySlotCount = bodies.length;
    this.states.reset(0);
    this.accumulatorMs = 0;
    this.fixedStepCount = 0;
    // body数とstate indexをリセットして、次のencodeが新しいsimulationの先頭から始まるようにします
    this.writeParams();
    const shapeKinds = new Set();
    for (const record of this.bodyRecords.values()) {
      shapeKinds.add(record.descriptor.collider.getComputeColliderKind());
    }
    if (shapeKinds.size > 0) this.setComputeShapeKinds(shapeKinds);
    return this.bodyCount;
  }

  // 経過時間をaccumulatorへ加え、固定時間幅に到達した回数だけ同じencoderへstepを記録します
  // maxSubStepsを超えた残時間を捨てず保持し、表示frameの速さからsimulation速度を分離します
  // getTimestampWritesを指定した場合は、実際に記録する最初と最後のfixed stepだけへGPU timestampを渡します
  // callbackにはphase、fixed step index、今回記録するstep総数を渡し、返されたdescriptorをCompute Passへ設定します
  encode(commandEncoder, elapsedMs, options = {}) {
    this.requireEncoder(commandEncoder, "encode");
    const elapsed = util.readFiniteNumber(elapsedMs, `${this.label} elapsedMs`, { min: 0 });
    const checkedOptions = util.readPlainObject(options, `${this.label} encode options`, {});
    const getTimestampWrites = util.readOptionalFunction(
      checkedOptions.getTimestampWrites,
      `${this.label} encode options.getTimestampWrites`,
      null
    );
    this.accumulatorMs += elapsed;

    // 実際のaccumulatorを変更せずに、今回のencodeで記録するfixed step数を先に数えます
    // 先に総数を確定することで、最終stepへだけend timestampを置き、query値を一つのstepへ対応付けます
    let scheduledStepCount = 0;
    let remainingMs = this.accumulatorMs;
    while (remainingMs >= this.fixedTimeStepMs && scheduledStepCount < this.maxSubSteps) {
      remainingMs -= this.fixedTimeStepMs;
      scheduledStepCount += 1;
    }

    let beginTimestampWrites;
    let endTimestampWrites;
    if (getTimestampWrites !== null && scheduledStepCount > 0 && this.bodySlotCount > 0) {
      beginTimestampWrites = getTimestampWrites("begin", 0, scheduledStepCount);
      endTimestampWrites = getTimestampWrites(
        "end",
        scheduledStepCount - 1,
        scheduledStepCount
      );
    }

    let steps = 0;
    while (this.accumulatorMs >= this.fixedTimeStepMs && steps < this.maxSubSteps) {
      const stepOptions = getTimestampWrites === null
        ? undefined
        : {
          beginTimestampWrites: steps === 0 ? beginTimestampWrites : undefined,
          endTimestampWrites: steps === scheduledStepCount - 1 ? endTimestampWrites : undefined
        };
      this.encodeFixedStep(commandEncoder, stepOptions);
      this.accumulatorMs -= this.fixedTimeStepMs;
      steps += 1;
    }
    return steps;
  }

  // CPU版stepに対応するCompute版の記録入口を提供します
  // GPU submitは呼出側が管理するため、CPU版の即時実行に対応するencode(commandEncoder, elapsedMs)として扱います
  // encodeと同じ計測optionを受け取り、低レベルstep入口だけで挙動が変わらないようにします
  step(commandEncoder, elapsedMs, options = {}) {
    return this.encode(commandEncoder, elapsedMs, options);
  }

  // clear、予測AABB、Grid登録、candidate展開、combined solverを一つの固定stepとして順に記録します
  // candidateはsolver反復の外で一度だけ作り、12回の既定反復すべてで同じbitsetを再利用します
  // timestamp指定を受けた場合だけ最初のclearと最後のsolverへCompute Pass timestampを設定します
  encodeFixedStep(commandEncoder, options = {}) {
    this.requireEncoder(commandEncoder, "encodeFixedStep");
    if (this.bodySlotCount === 0) return false;
    const checkedOptions = util.readPlainObject(options, `${this.label} encodeFixedStep options`, {});
    // 固定step開始時点のUniformと入力state indexを確定し、後続のBroad Phase・solver passが同じ値を見るようにします
    this.writeParams();
    const stateIndex = this.states.getCurrentIndex();
    // Gridとcandidate bitsetをsolverより前にclearし、現在のfixed stepの候補を構築します
    this.encodePass(
      commandEncoder,
      this.clearPipeline,
      this.clearBindGroup,
      this.totalGridWordCount,
      "clear",
      checkedOptions.beginTimestampWrites === undefined
        ? undefined
        : { timestampWrites: checkedOptions.beginTimestampWrites }
    );
    // 予測AABB、XZ Grid、body別candidate bitsetを順に作り、solverが再利用できる候補を完成させます
    this.encodePass(commandEncoder, this.aabbPipeline, this.broadphaseBindGroups[stateIndex], this.bodySlotCount, "predict-aabb");
    this.encodePass(commandEncoder, this.cellPipeline, this.broadphaseBindGroups[stateIndex], this.bodySlotCount, "build-grid");
    this.encodePass(
      commandEncoder,
      this.candidatePipeline,
      this.broadphaseBindGroups[stateIndex],
      this.bodySlotCount * this.candidateWordCount,
      "build-candidates"
    );
    // bodyごとの局所反復solverがbody pairとPlane接触を同じ状態更新へ反映します
    const hasJoints = this.joints.getCount() > 0;
    this.encodePass(
      commandEncoder,
      this.solverPipeline,
      this.solverBindGroups[stateIndex],
      this.bodySlotCount,
      "combined-solver",
      hasJoints || checkedOptions.endTimestampWrites === undefined
        ? undefined
        : { timestampWrites: checkedOptions.endTimestampWrites }
    );
    this.states.swap();
    // contact solver後のstateへJoint XPBD position/orientation correctionを適用します
    // 一回のdispatchを全bodyへ適用してstateを交換し、隣接Jointが前dispatchの補正結果を参照できるようにします
    if (hasJoints) {
      for (let iteration = 0; iteration < this.jointSolverIterations; iteration++) {
        for (let parity = 0; parity < this.jointPipelines.length; parity++) {
          const jointStateIndex = this.states.getCurrentIndex();
          const isLastPass = iteration === this.jointSolverIterations - 1
            && parity === this.jointPipelines.length - 1;
          this.encodePass(
            commandEncoder,
            this.jointPipelines[parity],
            this.jointBindGroups[jointStateIndex],
            this.bodySlotCount,
            `joint-xpbd-solver-${iteration}-${parity}`,
            !isLastPass || checkedOptions.endTimestampWrites === undefined
              ? undefined
              : { timestampWrites: checkedOptions.endTimestampWrites }
          );
          this.states.swap();
        }
      }
    }
    this.fixedStepCount += 1;
    // GPU側で一度消費する外部命令に対応して、CPU shadowの命令欄だけを次frame用に空にします
    this.clearEncodedCommandShadow();
    return true;
  }

  // CPU版stepFixedに対応する一fixed stepの記録入口を提供します
  // state bufferのswapは記録時に進めますが、GPU処理完了とqueue submitは呼出側へ残します
  stepFixed(commandEncoder, options = {}) {
    return this.encodeFixedStep(commandEncoder, options);
  }

  /** @internal
   * 一つのpipelineを1次元dispatchとしてcommand encoderへ追加します
   * invocation数は必ず正数で呼ばれ、0 body時はencodeFixedStep側でpass記録を省略します
   * options.timestampWritesはWebGPU Compute Passへそのまま渡し、未指定時は通常のpassにします
   */
  encodePass(commandEncoder, pipeline, bindGroup, invocationCount, suffix, options = undefined) {
    const descriptor = { label: `${this.label}:${suffix}` };
    if (options?.timestampWrites !== undefined) descriptor.timestampWrites = options.timestampWrites;
    const pass = commandEncoder.beginComputePass(descriptor);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(invocationCount / WORKGROUP_SIZE));
    pass.end();
  }

  /** @internal
   * command encoderにCompute Pass開始APIがあることを確認し、現在のencoder状態を明示的に使います
   */
  requireEncoder(commandEncoder, methodName) {
    if (!commandEncoder?.beginComputePass) {
      throw new Error(`${this.label} ${methodName} requires a GPUCommandEncoder`);
    }
  }

  // 最新BodyStateを持つStorage Bufferとlayout情報を描画側へ返します
  // buffer内容をCPUへ複製せず、vertex shaderは返されたindexとstrideを使ってGPU上で直接参照できます
  getRenderState() {
    this.requireAlive();
    return Object.freeze({
      buffer: this.states.getCurrent(),
      bufferIndex: this.states.getCurrentIndex(),
      bodyCount: this.bodyCount,
      bodySlotCount: this.bodySlotCount,
      layout: COMPUTE_PHYSICS_BODY_STATE_LAYOUT
    });
  }

  // 最新のBodyState Storage Bufferだけを返し、既存の描画bind group生成へ直接渡せるようにします
  getCurrentStateBuffer() {
    this.requireAlive();
    return this.states.getCurrent();
  }

  // ping-pongを構成する2本のBodyState Storage Bufferを固定順の新しい配列で返します
  // 描画側は初期化時に両方のbind groupを作り、frameごとのbuffer indexだけで最新stateを選べます
  getStateBuffers() {
    this.requireAlive();
    return [...this.stateBuffers];
  }

  /**
   * 現在のBodyStateをCPUへコピーするMAP_READ bufferの生成をreadback部品へ委譲します
   */
  createStateReadbackBuffer(...args) {
    return computePhysicsReadback.createStateReadbackBuffer(this, ...args);
  }

  /**
   * BodyStateのGPU copy command記録をreadback部品へ委譲します
   */
  encodeStateReadback(...args) {
    return computePhysicsReadback.encodeStateReadback(this, ...args);
  }

  /**
   * submit後のBodyState readbackをCPU配列へ変換する処理をreadback部品へ委譲します
   */
  async readStateReadback(...args) {
    return computePhysicsReadback.readStateReadback(this, ...args);
  }

  /**
   * readback配列から一つのbody stateを取得する処理をreadback部品へ委譲します
   */
  readBodyStateFromReadback(...args) {
    return computePhysicsReadback.readBodyStateFromReadback(this, ...args);
  }

  /**
   * 一つのNodeへGPU body stateを同期する処理をreadback部品へ委譲します
   */
  syncNodeFromPhysics(...args) {
    return computePhysicsReadback.syncNodeFromPhysics(this, ...args);
  }

  /**
   * 複数NodeへGPU body stateを同期する処理をreadback部品へ委譲します
   */
  syncNodesFromPhysics(...args) {
    return computePhysicsReadback.syncNodesFromPhysics(this, ...args);
  }

  /**
   * Nodeの状態をbody commandへ反映する処理をreadback部品へ委譲します
   */
  syncPhysicsFromNode(...args) {
    return computePhysicsReadback.syncPhysicsFromNode(this, ...args);
  }

  /**
   * readback query optionの検証をreadback部品へ委譲します
   */
  readComputeQueryOptions(...args) {
    return computePhysicsReadback.readComputeQueryOptions(this, ...args);
  }

  /**
   * readback stateからquery対象bodyを収集する処理を委譲します
   */
  collectReadbackQueryEntries(...args) {
    return computePhysicsReadback.collectReadbackQueryEntries(this, ...args);
  }

  /**
   * readback query用の姿勢回転を計算する処理を委譲します
   */
  rotateReadbackVector(...args) {
    return computePhysicsReadback.rotateReadbackVector(this, ...args);
  }

  /**
   * readback bodyのworld軸を取得する処理を委譲します
   */
  getReadbackBodyAxes(...args) {
    return computePhysicsReadback.getReadbackBodyAxes(this, ...args);
  }

  /**
   * readback bodyのAABBを取得する処理を委譲します
   */
  getReadbackBodyAabb(...args) {
    return computePhysicsReadback.getReadbackBodyAabb(this, ...args);
  }

  /**
   * readback bodyのhalf extentsを取得する処理を委譲します
   */
  getReadbackBodyHalfExtents(...args) {
    return computePhysicsReadback.getReadbackBodyHalfExtents(this, ...args);
  }

  /**
   * readback BoxとAABBの重なりを判定する処理を委譲します
   */
  readbackBoxOverlapsAabb(...args) {
    return computePhysicsReadback.readbackBoxOverlapsAabb(this, ...args);
  }

  /**
   * readback bodyとrayの交差を計算する処理を委譲します
   */
  intersectReadbackBodyRay(...args) {
    return computePhysicsReadback.intersectReadbackBodyRay(this, ...args);
  }

  /**
   * readback bodyとsphereの重なりを計算する処理を委譲します
   */
  overlapReadbackBodySphere(...args) {
    return computePhysicsReadback.overlapReadbackBodySphere(this, ...args);
  }

  /**
   * readback body pairのcontactを計算する処理を委譲します
   */
  getReadbackBodyContact(...args) {
    return computePhysicsReadback.getReadbackBodyContact(this, ...args);
  }

  /**
   * readback bodyとPlaneのcontactを計算する処理を委譲します
   */
  getReadbackBodyPlaneContact(...args) {
    return computePhysicsReadback.getReadbackBodyPlaneContact(this, ...args);
  }

  /**
   * readback body pairのmanifoldを計算する処理を委譲します
   */
  getReadbackBodyManifold(...args) {
    return computePhysicsReadback.getReadbackBodyManifold(this, ...args);
  }

  /**
   * readback stateからbody contactを取得する処理を委譲します
   */
  getContactsFromReadback(...args) {
    return computePhysicsReadback.getContactsFromReadback(this, ...args);
  }

  /**
   * readback stateからPlane contactを取得する処理を委譲します
   */
  getPlaneContactsFromReadback(...args) {
    return computePhysicsReadback.getPlaneContactsFromReadback(this, ...args);
  }

  /**
   * readback stateからmanifoldを取得する処理を委譲します
   */
  getManifoldsFromReadback(...args) {
    return computePhysicsReadback.getManifoldsFromReadback(this, ...args);
  }

  /**
   * readback stateからcontact eventを取得する処理を委譲します
   */
  getContactEventsFromReadback(...args) {
    return computePhysicsReadback.getContactEventsFromReadback(this, ...args);
  }

  /**
   * 最後に取得したbody contactを返す処理を委譲します
   */
  getLastContacts(...args) {
    return computePhysicsReadback.getLastContacts(this, ...args);
  }

  /**
   * 最後に取得したmanifoldを返す処理を委譲します
   */
  getLastManifolds(...args) {
    return computePhysicsReadback.getLastManifolds(this, ...args);
  }

  /**
   * 最後に取得したcontact eventを返す処理を委譲します
   */
  getLastContactEvents(...args) {
    return computePhysicsReadback.getLastContactEvents(this, ...args);
  }

  /**
   * readback contact eventをlistenerへ通知する処理を委譲します
   */
  dispatchContactEventsFromReadback(...args) {
    return computePhysicsReadback.dispatchContactEventsFromReadback(this, ...args);
  }

  /**
   * begin contact listenerの登録を委譲します
   */
  onBeginContact(...args) {
    return computePhysicsReadback.onBeginContact(this, ...args);
  }

  /**
   * stay contact listenerの登録を委譲します
   */
  onStayContact(...args) {
    return computePhysicsReadback.onStayContact(this, ...args);
  }

  /**
   * end contact listenerの登録を委譲します
   */
  onEndContact(...args) {
    return computePhysicsReadback.onEndContact(this, ...args);
  }

  /**
   * begin contact listenerの解除を委譲します
   */
  offBeginContact(...args) {
    return computePhysicsReadback.offBeginContact(this, ...args);
  }

  /**
   * stay contact listenerの解除を委譲します
   */
  offStayContact(...args) {
    return computePhysicsReadback.offStayContact(this, ...args);
  }

  /**
   * end contact listenerの解除を委譲します
   */
  offEndContact(...args) {
    return computePhysicsReadback.offEndContact(this, ...args);
  }

  /**
   * 一件のreadback contactを複製する処理を委譲します
   */
  cloneReadbackContact(...args) {
    return computePhysicsReadback.cloneReadbackContact(this, ...args);
  }

  /**
   * 一件のreadback manifoldを複製する処理を委譲します
   */
  cloneReadbackManifold(...args) {
    return computePhysicsReadback.cloneReadbackManifold(this, ...args);
  }

  /**
   * readback contact eventの複製を委譲します
   */
  cloneReadbackContactEvents(...args) {
    return computePhysicsReadback.cloneReadbackContactEvents(this, ...args);
  }

  /**
   * listener配列への追加を委譲します
   */
  addContactListener(...args) {
    return computePhysicsReadback.addContactListener(this, ...args);
  }

  /**
   * listener配列からの削除を委譲します
   */
  removeContactListener(...args) {
    return computePhysicsReadback.removeContactListener(this, ...args);
  }

  /**
   * contact eventのlistener通知を委譲します
   */
  emitReadbackContactEvents(...args) {
    return computePhysicsReadback.emitReadbackContactEvents(this, ...args);
  }

  /**
   * readback stateからraycast結果を取得する処理を委譲します
   */
  raycastFromReadback(...args) {
    return computePhysicsReadback.raycastFromReadback(this, ...args);
  }

  /**
   * readback stateから複数raycast結果を取得する処理を委譲します
   */
  raycastAllFromReadback(...args) {
    return computePhysicsReadback.raycastAllFromReadback(this, ...args);
  }

  /**
   * readback stateからAABB query結果を取得する処理を委譲します
   */
  queryAabbFromReadback(...args) {
    return computePhysicsReadback.queryAabbFromReadback(this, ...args);
  }

  /**
   * readback stateからsphere overlap結果を取得する処理を委譲します
   */
  overlapSphereFromReadback(...args) {
    return computePhysicsReadback.overlapSphereFromReadback(this, ...args);
  }

  // 固定step累計を返し、表示frame数とは分けてsimulation進行量を表示できるようにします
  getFixedStepCount() {
    this.requireAlive();
    return this.fixedStepCount;
  }

  // 現在登録されているbody数を返し、描画instance数とCompute dispatch対象を一致させます
  getBodyCount() {
    this.requireAlive();
    return this.bodyCount;
  }

  // GPU dispatchへ使うslot数を返し、削除後に残る空slotを含む容量を明示します
  // 描画側がinstanceを全slot分描く場合はgetRenderState().bodySlotCountを利用します
  getBodySlotCount() {
    this.requireAlive();
    return this.bodySlotCount;
  }

  /** @internal
   * body IDを正の整数へ限定し、存在確認をMapへ集約します
   * 配列indexを利用者へ要求せず、remove後も別bodyへ変化しないIDを扱います
   */
  readBodyId(bodyId, name = `${this.label} bodyId`) {
    return util.readFiniteNumber(bodyId, name, {
      integer: true,
      minExclusive: 0
    });
  }

  /** @internal
   * body IDから内部recordを取得し、登録済みIDだけを対象slotとして扱います
   */
  getBodyRecord(bodyId) {
    const id = this.readBodyId(bodyId);
    const record = this.bodyRecords.get(id);
    if (!record) throw new Error(`${this.label} unknown body id: ${id}`);
    return record;
  }

  // body ID一覧を登録順のslot順で返し、利用者がGPU instanceと論理bodyを対応付けられるようにします
  getBodyIds() {
    this.requireAlive();
    return this.slotRecords.filter((record) => record !== null).map((record) => record.id);
  }

  // bodyの初期設定とslotを返し、GPU上の現在位置とは混同しない読み取り専用情報にします
  getBodyInfo(bodyId) {
    const record = this.getBodyRecord(bodyId);
    return Object.freeze({
      id: record.id,
      slot: record.slot,
      bodyType: record.descriptor.bodyType,
      mass: record.descriptor.mass,
      gravityScale: record.descriptor.gravityScale,
      allowSleep: record.descriptor.allowSleep,
      isTrigger: record.descriptor.isTrigger,
      fixedRotation: record.descriptor.fixedRotation,
      collisionLayer: record.descriptor.collisionLayer,
      collisionMask: record.descriptor.collisionMask,
      surfaceVelocity: Object.freeze([...(record.descriptor.surfaceVelocity ?? [0.0, 0.0, 0.0])])
    });
  }

  /** @internal
   * control shadowの1recordをGPUへ転送し、属性変更と外部命令を同じslotへ反映します
   * command APIは次のencode前に呼び出す前提で、GPU側の一回消費とCPU shadowを同期させます
   */
  writeControlSlot(slot) {
    const byteOffset = slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideBytes;
    const view = new Uint8Array(this.controlData, byteOffset, COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideBytes);
    this.queue.writeBuffer(this.controlBuffer, byteOffset, view);
  }

  /** @internal
   * encodeFixedStepへ記録した一回命令をCPU shadowから消し、次frameの新命令へ分離します
   * GPU側のBodyControlはsolverが同じ内容を消去するため、ここでは一度だけ転送します
   */
  clearEncodedCommandShadow() {
    for (let slot = 0; slot < this.bodySlotCount; slot++) {
      const base = slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats;
      // surfaceVelocityは次の呼出しまで保持する設定なので、一回命令欄とは分けて残します
      this.controlFloats.fill(
        0,
        base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.force,
        base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.commandFlags + 4
      );
    }
  }

  /** @internal
   * BodyControlのforceや速度命令を更新し、GPUへ反映します
   * 命令をCPU側で上書きせず加算し、同一frameの複数回呼出しを一つのstepへまとめます
   */
  mutateBodyCommand(bodyId, mutator) {
    const record = this.getBodyRecord(bodyId);
    mutator(record.slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats);
    this.writeControlSlot(record.slot);
    return this;
  }

  // bodyへ線形速度を設定し、sleep中でも次のfixed stepでwakeさせます
  setBodyLinearVelocity(bodyId, velocity) {
    const value = this.readVec3(velocity, `${this.label} setBodyLinearVelocity`);
    return this.mutateBodyCommand(bodyId, (base) => {
      this.controlFloats.set([...value, 0], base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.linearVelocity);
      this.controlUint32[base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.commandFlags] |= COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.setLinearVelocity;
    });
  }

  // kinematic bodyの接触面へだけ接線速度を与え、bodyのlinearVelocityやteleport意味を変更しません
  // 搬送を止めるときはzeroを設定し、dynamic bodyへの摩擦伝達とwake対象を同時に解除します
  setBodySurfaceVelocity(bodyId, velocity) {
    const record = this.getBodyRecord(bodyId);
    if (record.descriptor.bodyType !== "kinematic") {
      throw new Error(`${this.label} setBodySurfaceVelocity requires a kinematic body`);
    }
    const value = this.readVec3(velocity, `${this.label} setBodySurfaceVelocity`);
    record.descriptor.surfaceVelocity = [...value];
    return this.mutateBodyCommand(bodyId, (base) => {
      this.controlFloats.set([...value, 0], base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.surfaceVelocity);
    });
  }

  // bodyへ角速度を設定し、sleep中でも次のfixed stepでwakeさせます
  setBodyAngularVelocity(bodyId, angularVelocity) {
    const value = this.readVec3(angularVelocity, `${this.label} setBodyAngularVelocity`);
    return this.mutateBodyCommand(bodyId, (base) => {
      this.controlFloats.set([...value, 0], base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.angularVelocity);
      this.controlUint32[base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.commandFlags] |= COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.setAngularVelocity;
    });
  }

  // bodyへ力を蓄積し、次のdynamic fixed stepで質量に応じた速度変化へ変換します
  applyForce(bodyId, force) {
    const value = this.readVec3(force, `${this.label} applyForce`);
    return this.mutateBodyCommand(bodyId, (base) => {
      const offset = base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.force;
      this.controlFloats[offset] += value[0];
      this.controlFloats[offset + 1] += value[1];
      this.controlFloats[offset + 2] += value[2];
    });
  }

  // bodyへ線形impulseを加え、次のdynamic fixed stepで即時速度へ変換します
  applyImpulse(bodyId, impulse) {
    const record = this.getBodyRecord(bodyId);
    if (record.descriptor.bodyType !== "dynamic") {
      throw new Error(`${this.label} applyImpulse requires a dynamic body`);
    }
    const value = this.readVec3(impulse, `${this.label} applyImpulse`);
    return this.mutateBodyCommand(bodyId, (base) => {
      const offset = base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.linearImpulse;
      this.controlFloats[offset] += value[0];
      this.controlFloats[offset + 1] += value[1];
      this.controlFloats[offset + 2] += value[2];
    });
  }

  // bodyへtorqueを蓄積し、次のdynamic fixed stepで角加速度へ変換します
  applyTorque(bodyId, torque) {
    const value = this.readVec3(torque, `${this.label} applyTorque`);
    return this.mutateBodyCommand(bodyId, (base) => {
      const offset = base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.torque;
      this.controlFloats[offset] += value[0];
      this.controlFloats[offset + 1] += value[1];
      this.controlFloats[offset + 2] += value[2];
    });
  }

  // bodyへ角impulseを加え、次のdynamic fixed stepで逆慣性に応じた角速度へ変換します
  applyAngularImpulse(bodyId, impulse) {
    const record = this.getBodyRecord(bodyId);
    if (record.descriptor.bodyType !== "dynamic") {
      throw new Error(`${this.label} applyAngularImpulse requires a dynamic body`);
    }
    if (record.descriptor.fixedRotation) {
      throw new Error(`${this.label} applyAngularImpulse is not allowed when fixedRotation=true`);
    }
    const value = this.readVec3(impulse, `${this.label} applyAngularImpulse`);
    return this.mutateBodyCommand(bodyId, (base) => {
      const offset = base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.angularImpulse;
      this.controlFloats[offset] += value[0];
      this.controlFloats[offset + 1] += value[1];
      this.controlFloats[offset + 2] += value[2];
    });
  }

  // bodyの位置を変更し、keepVelocity=falseなら速度停止も同じfixed stepで要求します
  teleport(bodyId, position, options = {}) {
    const value = this.readVec3(position, `${this.label} teleport position`);
    const opts = util.readPlainObject(options, `${this.label} teleport options`, {});
    const keepVelocity = util.readOptionalBoolean(opts.keepVelocity, `${this.label} teleport keepVelocity`, false);
    const wakeUp = util.readOptionalBoolean(opts.wakeUp, `${this.label} teleport wakeUp`, true);
    return this.mutateBodyCommand(bodyId, (base) => {
      this.controlFloats.set([...value, 0], base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.position);
      let flags = this.controlUint32[base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.commandFlags];
      flags |= COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportPosition;
      if (!keepVelocity) flags |= COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.stopMotion;
      if (wakeUp) flags |= COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.wake;
      this.controlUint32[base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.commandFlags] = flags;
    });
  }

  // bodyのquaternionを変更し、正規化済みquaternionをGPUへ渡します
  // wakeUp=falseを指定した場合は姿勢だけを更新し、sleep flagを現在値のまま保持します
  setBodyOrientation(bodyId, orientation, options = {}) {
    const value = this.readQuat(orientation, `${this.label} setBodyOrientation`);
    const opts = util.readPlainObject(options, `${this.label} setBodyOrientation options`, {});
    const wakeUp = util.readOptionalBoolean(opts.wakeUp, `${this.label} setBodyOrientation wakeUp`, true);
    return this.mutateBodyCommand(bodyId, (base) => {
      this.controlFloats.set(value, base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.orientation);
      let flags = this.controlUint32[base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.commandFlags];
      flags |= COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportOrientation;
      if (wakeUp) flags |= COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.wake;
      this.controlUint32[base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.commandFlags] = flags;
    });
  }

  // bodyの速度、force、torqueを停止し、sleep状態を現在stepの処理対象として更新します
  stopBodyMotion(bodyId) {
    return this.mutateBodyCommand(bodyId, (base) => {
      this.controlUint32[base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.commandFlags] |= COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.stopMotion;
    });
  }

  // bodyのsleep flagを解除し、以後の支持接触判定へ戻します
  wakeBody(bodyId) {
    return this.mutateBodyCommand(bodyId, (base) => {
      this.controlUint32[base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.commandFlags] |= COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.wake;
    });
  }

  // bodyを明示的にsleepさせ、allowSleep=trueのbodyへ適用します
  sleepBody(bodyId) {
    const record = this.getBodyRecord(bodyId);
    if (!record.descriptor.allowSleep) {
      throw new Error(`${this.label} sleepBody requires allowSleep=true`);
    }
    return this.mutateBodyCommand(bodyId, (base) => {
      this.controlUint32[base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.commandFlags] |= COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.sleep;
    });
  }

  /** @internal
   * BodyStateの指定欄だけを2本のping-pong bufferへ書き、GPUで進行中の位置や速度を保持します
   * 質量、材質、色の実行時変更を状態全体の再初期化から分離します
   */
  writeStateField(record, fieldOffset, values) {
    const data = Float32Array.from(values);
    const byteOffset = (record.slot * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideFloats + fieldOffset)
      * Float32Array.BYTES_PER_ELEMENT;
    this.stateBuffers.forEach((buffer) => this.queue.writeBuffer(buffer, byteOffset, data));
  }

  // bodyTypeを変更し、static/kinematic/dynamicの逆質量と回転可否をGPUへ反映します
  setBodyType(bodyId, bodyType, options = {}) {
    const record = this.getBodyRecord(bodyId);
    const nextType = this.readBodyType(bodyType, `${this.label} setBodyType bodyType`);
    const opts = util.readPlainObject(options, `${this.label} setBodyType options`, {});
    const clearVelocity = util.readOptionalBoolean(opts.clearVelocity, `${this.label} setBodyType clearVelocity`, true);
    if (nextType === "dynamic" && record.descriptor.mass <= 0) {
      throw new Error(`${this.label} dynamic body requires positive mass`);
    }
    record.descriptor.bodyType = nextType;
    record.descriptor.surfaceVelocity = [0.0, 0.0, 0.0];
    if (!record.descriptor.inverseInertiaExplicit) {
      const inverseMassForInertia = nextType === "dynamic" ? 1 / record.descriptor.mass : 0;
      record.descriptor.inverseInertiaUnrestricted = record.descriptor.collider.calculateInverseInertia(inverseMassForInertia);
      record.descriptor.inverseInertia = [...record.descriptor.inverseInertiaUnrestricted];
    }
    const controlBase = record.slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats;
    this.controlUint32[controlBase + 1] = COMPUTE_PHYSICS_BODY_TYPES[nextType];
    this.controlFloats.fill(
      0,
      controlBase + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.surfaceVelocity,
      controlBase + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.surfaceVelocity + 4
    );
    const inverseMass = nextType === "dynamic" ? 1 / record.descriptor.mass : 0;
    const inverseInertia = nextType === "dynamic" && !record.descriptor.fixedRotation
      ? record.descriptor.inverseInertiaUnrestricted
      : [0, 0, 0];
    record.descriptor.inverseInertia = [...inverseInertia];
    this.writeStateField(record, COMPUTE_PHYSICS_BODY_STATE_LAYOUT.linearVelocityInvMass + 3, [inverseMass]);
    this.writeStateField(record, COMPUTE_PHYSICS_BODY_STATE_LAYOUT.inverseInertiaLocal, inverseInertia);
    if (clearVelocity) this.stopBodyMotion(bodyId);
    this.wakeBody(bodyId);
    this.writeControlSlot(record.slot);
    return this;
  }

  // body質量を変更し、dynamic bodyの逆質量と自動逆慣性を再計算します
  setBodyMass(bodyId, mass) {
    const record = this.getBodyRecord(bodyId);
    const value = util.readFiniteNumber(mass, `${this.label} setBodyMass mass`, { min: 0 });
    if (record.descriptor.bodyType === "dynamic" && value <= 0) {
      throw new Error(`${this.label} dynamic body mass must be positive`);
    }
    record.descriptor.mass = value;
    const inverseMass = record.descriptor.bodyType === "dynamic" ? 1 / value : 0;
    if (!record.descriptor.inverseInertiaExplicit) {
      record.descriptor.inverseInertiaUnrestricted = record.descriptor.collider.calculateInverseInertia(inverseMass);
      record.descriptor.inverseInertia = [...record.descriptor.inverseInertiaUnrestricted];
    }
    const inverseInertia = record.descriptor.bodyType === "dynamic" && !record.descriptor.fixedRotation
      ? record.descriptor.inverseInertiaUnrestricted
      : [0, 0, 0];
    record.descriptor.inverseInertia = [...inverseInertia];
    this.writeStateField(record, COMPUTE_PHYSICS_BODY_STATE_LAYOUT.linearVelocityInvMass + 3, [inverseMass]);
    this.writeStateField(record, COMPUTE_PHYSICS_BODY_STATE_LAYOUT.inverseInertiaLocal, inverseInertia);
    this.wakeBody(bodyId);
    return this;
  }

  // bodyの重力倍率を更新し、次のfixed stepから重力加速度へ反映します
  setBodyGravityScale(bodyId, scale) {
    const record = this.getBodyRecord(bodyId);
    const value = util.readFiniteNumber(scale, `${this.label} setBodyGravityScale scale`);
    record.descriptor.gravityScale = value;
    const base = record.slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats;
    this.controlFloats[base + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.properties] = value;
    this.writeControlSlot(record.slot);
    return this;
  }

  // bodyのlinear dampingを更新し、BodyStateのmaterial欄だけへ反映します
  setBodyLinearDamping(bodyId, damping) {
    const record = this.getBodyRecord(bodyId);
    const value = util.readFiniteNumber(damping, `${this.label} setBodyLinearDamping damping`, { min: 0 });
    record.descriptor.material[2] = value;
    this.writeStateField(record, COMPUTE_PHYSICS_BODY_STATE_LAYOUT.material + 2, [value]);
    return this;
  }

  // bodyのangular dampingを更新し、BodyStateのmaterial欄だけへ反映します
  setBodyAngularDamping(bodyId, damping) {
    const record = this.getBodyRecord(bodyId);
    const value = util.readFiniteNumber(damping, `${this.label} setBodyAngularDamping damping`, { min: 0 });
    record.descriptor.material[3] = value;
    this.writeStateField(record, COMPUTE_PHYSICS_BODY_STATE_LAYOUT.material + 3, [value]);
    return this;
  }

  // bodyのsleep許可を更新し、allowSleepの現在値に合わせてsleep命令を管理します
  setBodyAllowSleep(bodyId, enabled) {
    const record = this.getBodyRecord(bodyId);
    const value = util.readOptionalBoolean(enabled, `${this.label} setBodyAllowSleep enabled`, record.descriptor.allowSleep);
    record.descriptor.allowSleep = value;
    const base = record.slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats;
    this.controlUint32[base + 2] = value ? 1 : 0;
    this.writeControlSlot(record.slot);
    if (!value) this.wakeBody(bodyId);
    return this;
  }

  // bodyのtrigger状態を更新し、物理solverの接触応答対象から外します
  setBodyTrigger(bodyId, enabled) {
    const record = this.getBodyRecord(bodyId);
    const value = util.readOptionalBoolean(enabled, `${this.label} setBodyTrigger enabled`, record.descriptor.isTrigger);
    record.descriptor.isTrigger = value;
    const base = record.slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats;
    this.controlUint32[base + 6] = value ? 1 : 0;
    this.writeControlSlot(record.slot);
    return this;
  }

  // bodyのcollision layerを更新し、相手maskとの双方向一致へ反映します
  setBodyCollisionLayer(bodyId, layer) {
    const record = this.getBodyRecord(bodyId);
    const value = this.readCollisionBits(layer, `${this.label} setBodyCollisionLayer layer`, record.descriptor.collisionLayer);
    record.descriptor.collisionLayer = value;
    const base = record.slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats;
    this.controlUint32[base + 4] = value;
    this.writeControlSlot(record.slot);
    return this;
  }

  // bodyのcollision maskを更新し、相手layerとの双方向一致へ反映します
  setBodyCollisionMask(bodyId, mask) {
    const record = this.getBodyRecord(bodyId);
    const value = this.readCollisionBits(mask, `${this.label} setBodyCollisionMask mask`, record.descriptor.collisionMask);
    record.descriptor.collisionMask = value;
    const base = record.slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats;
    this.controlUint32[base + 5] = value;
    this.writeControlSlot(record.slot);
    return this;
  }

  // bodyのfixedRotationを更新し、回転自由度を逆慣性へ反映します
  setBodyFixedRotation(bodyId, enabled) {
    const record = this.getBodyRecord(bodyId);
    const value = util.readOptionalBoolean(enabled, `${this.label} setBodyFixedRotation enabled`, record.descriptor.fixedRotation);
    record.descriptor.fixedRotation = value;
    const base = record.slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats;
    this.controlUint32[base + 3] = value ? 1 : 0;
    const inverseInertia = record.descriptor.bodyType === "dynamic" && !value
      ? record.descriptor.inverseInertiaUnrestricted
      : [0, 0, 0];
    record.descriptor.inverseInertia = [...inverseInertia];
    this.writeStateField(record, COMPUTE_PHYSICS_BODY_STATE_LAYOUT.inverseInertiaLocal, inverseInertia);
    this.writeControlSlot(record.slot);
    this.wakeBody(bodyId);
    return this;
  }

  // bodyの物理材質を更新し、restitution、friction、減衰を2本のBodyStateへ反映します
  setBodyMaterial(bodyId, material) {
    const record = this.getBodyRecord(bodyId);
    const value = util.readPlainObject(material, `${this.label} setBodyMaterial material`, {});
    const previous = record.descriptor.physicsMaterial;
    const combined = { ...previous, ...value };
    if (value.friction !== undefined) {
      combined.dynamicFriction = value.dynamicFriction ?? value.friction;
      combined.staticFriction = value.staticFriction ?? value.friction;
    }
    // An explicit coefficient edit creates an inline surface; named-pair lookup uses setBodyMaterialId.
    delete combined.materialId;
    const physical = this.materialPairs.material(combined);
    const next = [...record.descriptor.material];
    next[0] = util.readOptionalFiniteNumber(value.restitution, `${this.label} material.restitution`, next[0], { min: 0, max: 1 });
    next[1] = physical.dynamicFriction;
    next[2] = util.readOptionalFiniteNumber(value.linearDamping, `${this.label} material.linearDamping`, next[2], { min: 0 });
    next[3] = util.readOptionalFiniteNumber(value.angularDamping, `${this.label} material.angularDamping`, next[3], { min: 0 });
    record.descriptor.material = next;
    record.descriptor.physicsMaterial = physical;
    const properties = record.slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats + 9;
    this.controlFloats.set([0, physical.staticFriction, physical.rollingResistanceLength], properties);
    this.writeControlSlot(record.slot);
    this.clearContactHistory(record.slot);
    this.wakeAllBodies();
    record.descriptor.materialExplicit = true;
    this.writeStateField(record, COMPUTE_PHYSICS_BODY_STATE_LAYOUT.material, next);
    return this;
  }

  setBodyMaterialId(bodyId, materialId) {
    const material = this.materialPairs.material({}, materialId);
    this.setBodyMaterial(bodyId, material);
    const record = this.getBodyRecord(bodyId);
    record.descriptor.physicsMaterial = material;
    this.controlFloats[record.slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats + 9] = this.materialPairs.numericId(materialId);
    this.writeControlSlot(record.slot);
    return this;
  }

  getContactMaterial(bodyA, bodyB, speed = 0) {
    return this.materialPairs.resolve(this.getBodyRecord(bodyA).descriptor.physicsMaterial,
      this.getBodyRecord(bodyB).descriptor.physicsMaterial, speed);
  }

  clearContactHistory(slot = undefined) {
    if (!this.contactHistoryBuffer) return;
    const stride = this.maxBodies + this.maxPlanes;
    if (slot === undefined) this.queue.writeBuffer(this.contactHistoryBuffer, 0, new Uint8Array(this.contactHistoryBytes));
    else {
      // 先頭のGPU世代recordを保持し、指定bodyが持つ行と他body行の対応列だけを初期化します
      this.queue.writeBuffer(this.contactHistoryBuffer, (1 + slot * stride) * 16, new Uint8Array(stride * 16));
      const zero = new Uint8Array(16);
      for (let i = 0; i < this.bodySlotCount; i++) if (i !== slot) {
        this.queue.writeBuffer(this.contactHistoryBuffer, (1 + i * stride + slot) * 16, zero);
      }
    }
  }

  wakeAllBodies() {
    for (const record of this.bodyRecords.values()) if (record.descriptor.bodyType === "dynamic") this.wakeBody(record.id);
    return this;
  }

  // bodyを空slotへ追加し、既存bodyのGPU stateを保持したまま新しいslotだけを書き換えます
  // IDは明示指定を優先し、省略時はspace内で再利用しない連番を割り当てます
  addBody(body) {
    this.requireAlive();
    const value = util.readPlainObject(body, `${this.label} addBody body`);
    const slot = this.slotRecords.findIndex((record) => record === null);
    if (slot < 0) throw new Error(`${this.label} has no free body slot`);
    // 空slotを決めてからbody全体を検証し、state/control/IDの同じslotへ登録します
    const requestedId = value.id === undefined
      ? this.nextBodyId
      : this.readBodyId(value.id, `${this.label} addBody body.id`);
    if (this.bodyRecords.has(requestedId)) {
      throw new Error(`${this.label} duplicate body id: ${requestedId}`);
    }
    const data = new Float32Array(this.maxBodies * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideFloats);
    const descriptor = this.packBody(value, slot, data);
    this.clearContactHistory(slot);
    const byteOffset = slot * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideBytes;
    const state = data.subarray(
      slot * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideFloats,
      (slot + 1) * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideFloats
    );
    // 新規slotだけを2本のstate bufferへ書き、既存bodyのGPU状態を保持します
    this.stateBuffers.forEach((buffer) => this.queue.writeBuffer(buffer, byteOffset, state));
    this.writeControlSlot(slot);
    const record = { id: requestedId, slot, descriptor };
    this.bodyRecords.set(requestedId, record);
    this.slotRecords[slot] = record;
    this.nextBodyId = Math.max(this.nextBodyId, requestedId + 1);
    this.bodyCount += 1;
    this.bodySlotCount = Math.max(this.bodySlotCount, slot + 1);
    this.ensureComputeShapeKind(descriptor.collider.getComputeColliderKind());
    this.writeParams();
    return requestedId;
  }

  // Compute専用Joint descriptorをGPU bufferへ追加し、次のfixed stepからXPBD solverへ接続します
  // bodyAId/bodyBIdはCompute spaceの整数IDで明示し、GPU bufferには整数IDを渡します
  addJoint(joint) {
    this.requireAlive();
    const id = this.joints.add(joint, this.bodyRecords);
    // Jointなし空間では遅延していたXPBD pipelineを、最初の登録時だけ生成します
    this.computePhysicsPipeline.createJointPipelines();
    return id;
  }

  // GPU Joint bufferへ接続中のJointを削除し、body adjacencyとrecordを明示的に更新します
  removeJoint(jointId) {
    this.requireAlive();
    return this.joints.remove(jointId);
  }

  // Jointのenabled状態だけを変更し、過去のXPBD lambdaを保持したまま次stepへ渡します
  setJointEnabled(jointId, enabled) {
    this.requireAlive();
    return this.joints.setEnabled(jointId, enabled);
  }

  // Compute Jointの登録情報をGPU runtime値と混同しない形で返します
  getJointInfo(jointId) {
    this.requireAlive();
    return this.joints.getInfo(jointId);
  }

  // 登録中JointのID一覧を返し、readback要求やUI表示の対象を呼出側で選べるようにします
  getJointIds() {
    this.requireAlive();
    return this.joints.getIds();
  }

  // Joint solverの反復回数を更新し、次に生成するWGSLへ反映します
  // GPU shaderは反復回数を固定値として埋め込むため、変更時はpipelineを再生成します
  setJointSolverIterations(value) {
    this.requireAlive();
    this.jointSolverIterations = util.readOptionalInteger(
      value,
      `${this.label} jointSolverIterations`,
      this.jointSolverIterations,
      { min: 1, max: 64 }
    );
    this.createPipelines();
    this.createBindGroups();
    return this.jointSolverIterations;
  }

  // Compute Jointの固定stride bufferとlayout情報を返し、描画または明示readbackのbind groupへ渡します
  getJointBuffer() {
    this.requireAlive();
    return Object.freeze({
      buffer: this.joints.getBuffer(),
      layout: this.joints.getLayoutInfo(),
      jointCount: this.joints.getCount()
    });
  }

  // bodyをactiveから外し、slotを再利用可能にします
  // 転送先だけに残ったstateはposition.wを0にして描画とsimulationの両方から明示的に除外します
  removeBody(bodyId) {
    this.requireAlive();
    const record = this.getBodyRecord(bodyId);
    if (this.joints.hasBody(record.id)) {
      throw new Error(`${this.label} cannot remove body ${record.id} while a Joint is connected`);
    }
    // control active bitとstate position.wを先に無効化し、GPUのBroad Phase・描画から同時に除外します
    const controlBase = record.slot * COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats;
    this.controlFloats.fill(0, controlBase, controlBase + COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT.strideFloats);
    this.controlUint32[controlBase] = 0;
    this.writeControlSlot(record.slot);
    const positionWOffset = (record.slot * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideFloats
      + COMPUTE_PHYSICS_BODY_STATE_LAYOUT.position + 3) * Float32Array.BYTES_PER_ELEMENT;
    this.stateBuffers.forEach((buffer) => this.queue.writeBuffer(buffer, positionWOffset, new Float32Array([0])));
    this.bodyRecords.delete(record.id);
    this.clearContactHistory(record.slot);
    this.wakeAllBodies();
    this.slotRecords[record.slot] = null;
    this.bodyCount -= 1;
    while (this.bodySlotCount > 0 && this.slotRecords[this.bodySlotCount - 1] === null) {
      this.bodySlotCount -= 1;
    }
    this.writeParams();
    return record.id;
  }

  // 登録中bodyのIDとslotだけを返し、GPU上の現在値をCPU値と誤認させない一覧にします
  getBodies() {
    this.requireAlive();
    return this.getBodyIds().map((id) => this.getBodyInfo(id));
  }

  // gravityを更新し、次のfixed stepからdynamic bodyの加速度へ反映します
  setGravity(gravity) {
    this.gravity = this.readVec3(gravity, `${this.label} gravity`);
    this.clearContactHistory();
    this.wakeAllBodies();
    this.writeParams();
    return this;
  }

  // 現在のgravityを新しい配列で返します
  getGravity() {
    this.requireAlive();
    return [...this.gravity];
  }

  // fixed timestepを更新し、正数として検証した値をGPUへ渡します
  setFixedTimeStepMs(value) {
    this.fixedTimeStepMs = util.readFiniteNumber(value, `${this.label} fixedTimeStepMs`, { minExclusive: 0 });
    this.accumulatorMs = Math.min(this.accumulatorMs, this.fixedTimeStepMs * this.maxSubSteps);
    this.writeParams();
    return this;
  }

  // fixed timestepを返します
  getFixedTimeStepMs() {
    this.requireAlive();
    return this.fixedTimeStepMs;
  }

  // frameあたりの最大sub step数を更新し、未処理時間を範囲内へ制限します
  setMaxSubSteps(value) {
    this.maxSubSteps = util.readOptionalInteger(value, `${this.label} maxSubSteps`, this.maxSubSteps, { min: 1, max: 64 });
    this.accumulatorMs = Math.min(this.accumulatorMs, this.fixedTimeStepMs * this.maxSubSteps);
    return this;
  }

  // frameあたりの最大sub step数を返します
  getMaxSubSteps() {
    this.requireAlive();
    return this.maxSubSteps;
  }

  // contact solverの反復回数を更新し、固定回数を埋め込んだWGSLへ反映します
  setSolverIterations(value) {
    const next = util.readOptionalInteger(value, `${this.label} solverIterations`, this.solverIterations, {
      min: 1,
      max: MAX_SOLVER_ITERATIONS
    });
    if (next !== this.solverIterations) {
      this.solverIterations = next;
      this.createPipelines();
      this.createBindGroups();
    }
    this.writeParams();
    return this;
  }

  // contact solverの反復回数を返します
  getSolverIterations() {
    this.requireAlive();
    return this.solverIterations;
  }

  // Compute版で固定使用するBroad Phase方式を返します
  // CPU版のbruteForceやsweepAabbへ暗黙に切り替えず、GPUのXZ Gridとswept Yを公開名で示します
  getBroadphaseMode() {
    this.requireAlive();
    return this.broadphaseMode;
  }

  // Broad Phase方式の混同を初期化時に検出します
  // 現在はXZ Gridだけを実装しているため、指定方式をXZ Gridとして検証します
  setBroadphaseMode(mode) {
    this.broadphaseMode = util.readOptionalEnum(
      mode,
      `${this.label} broadphaseMode`,
      this.broadphaseMode,
      [COMPUTE_PHYSICS_BROADPHASE_MODE]
    );
    return this;
  }

  // 新規bodyの既定restitutionを更新します
  setDefaultRestitution(value) {
    this.defaultRestitution = util.readFiniteNumber(value, `${this.label} defaultRestitution`, { min: 0, max: 1 });
    return this;
  }

  // 既定restitutionを返します
  getDefaultRestitution() {
    this.requireAlive();
    return this.defaultRestitution;
  }

  // 新規bodyの既定frictionを更新します
  setDefaultFriction(value) {
    this.defaultFriction = util.readFiniteNumber(value, `${this.label} defaultFriction`, { min: 0 });
    return this;
  }

  // 既定frictionを返します
  getDefaultFriction() {
    this.requireAlive();
    return this.defaultFriction;
  }

  // sleepへ入る線速度しきい値を絶対world値で更新します
  setSleepLinearThreshold(value) {
    const checked = util.readFiniteNumber(value, `${this.label} sleepLinearThreshold`, { min: 0 });
    this.scale = Object.freeze({ ...this.scale, sleepLinearSpeed: checked });
    this.writeParams();
    return this;
  }

  // sleepへ入る線速度しきい値を返します
  getSleepLinearThreshold() {
    this.requireAlive();
    return this.scale.sleepLinearSpeed;
  }

  // sleep bodyを接触からwakeさせる法線相対速度しきい値を返します
  // body自身の線速度しきい値ではなく、接触点で相手へ近づく速度として公開します
  getWakeLinearThreshold() {
    this.requireAlive();
    return this.scale.wakeLinearSpeed;
  }

  // sleepへ入る角速度しきい値を更新します
  setSleepAngularThreshold(value) {
    this.sleepAngularSpeed = util.readFiniteNumber(value, `${this.label} sleepAngularThreshold`, { min: 0 });
    this.writeParams();
    return this;
  }

  // sleepへ入る角速度しきい値を返します
  getSleepAngularThreshold() {
    this.requireAlive();
    return this.sleepAngularSpeed;
  }

  // sleepへ入る連続fixed step数を更新します
  setSleepStepsThreshold(value) {
    this.sleepSteps = util.readOptionalInteger(value, `${this.label} sleepStepsThreshold`, this.sleepSteps, {
      min: 1,
      max: 65535
    });
    this.writeParams();
    return this;
  }

  // sleepへ入る連続fixed step数を返します
  getSleepStepsThreshold() {
    this.requireAlive();
    return this.sleepSteps;
  }

  // accumulatorを明示的にリセットします
  resetAccumulator() {
    this.accumulatorMs = 0;
    return this;
  }

  // 現在の未処理elapsed時間を返します
  getAccumulatorMs() {
    this.requireAlive();
    return this.accumulatorMs;
  }

  /** @internal
   * 破棄後のencode、state更新、buffer取得を早期に検出します
   */
  requireAlive() {
    if (this.destroyed) throw new Error(`${this.label} is destroyed`);
  }

  // この空間が生成したGPUBufferを一度だけ破棄し、pipelineとbind groupの参照を解放します
  // 呼出側が取得済みのbufferも無効になるため、描画を停止してから呼び出す必要があります
  destroy() {
    if (this.destroyed) return false;
    this.stateBuffers.forEach((buffer) => buffer.destroy());
    this.controlBuffer.destroy();
    this.aabbBuffer.destroy();
    this.planeBuffer.destroy();
    this.contactHistoryBuffer.destroy();
    this.gridCandidateBuffer.destroy();
    this.paramBuffer.destroy();
    this.joints.destroy();
    this.stateBuffers = null;
    this.controlBuffer = null;
    this.controlData = null;
    this.controlFloats = null;
    this.controlUint32 = null;
    this.aabbBuffer = null;
    this.planeBuffer = null;
    this.gridCandidateBuffer = null;
    this.paramBuffer = null;
    this.joints = null;
    this.clearPipeline = null;
    this.aabbPipeline = null;
    this.cellPipeline = null;
    this.candidatePipeline = null;
    this.solverPipeline = null;
    this.jointPipeline = null;
    this.jointPipelines = null;
    this.clearBindGroup = null;
    this.broadphaseBindGroups = null;
    this.solverBindGroups = null;
    this.jointBindGroups = null;
    this.destroyed = true;
    return true;
  }

  /** @internal
   * ComputePhysicsShaderへWGSL生成を委譲します
   * runtime配列長と同じ値を渡し、ComputePhysicsSpace側の公開APIを維持します
   */
  createWGSL(options = {}) {
    return createComputePhysicsWGSL(this, options);
  }
}
