// ---------------------------------------------
//  CpuBoxPhysicsAdapter.js  2026/09/13
//   Synchronizes PhysicsSpace nodes with the validated CPU Box/Plane solver
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Quat from "./Quat.js";
import ComputeBoxCollider from "./ComputeBoxCollider.js";
import CpuBoxPhysicsSolver from "./CpuBoxPhysicsSolver.js";
import util from "./util.js";

const DEG_TO_RAD = Math.PI / 180.0;

// PhysicsSpaceのNode状態を検証済みCPU Box solverへ変換するadapter
// 物理世界の更新はsolverへ残し、Nodeとsolver stateの変換だけをこのファイルへ集めます
export default class CpuBoxPhysicsAdapter {

  // PhysicsSpaceを受け取り、登録Nodeとsolver stateの対応表を初期化します
  constructor(space) {
    if (!space || !Array.isArray(space.bodies)) {
      throw new Error("CpuBoxPhysicsAdapter requires a PhysicsSpace");
    }
    this.space = space;
    this.bodyDescriptorMap = new Map();
    this.planeDescriptorMap = new Map();
    this.solver = null;
    this.solverMode = null;
  }

  // body追加・削除後にsolverと登録descriptorの対応を破棄します
  // 次のstepで現在のPhysicsSpace.bodiesからdescriptorとsolverを作り直します
  reset() {
    this.bodyDescriptorMap.clear();
    this.planeDescriptorMap.clear();
    this.solver = null;
    this.solverMode = null;
  }

  // PhysicsNodeのBox状態をCPU Box solverが読むdescriptorへ変換します
  // Node側のdegree/sec角速度だけをrad/secへ変換し、入力値をそのままsolverへ渡します
  _buildBodyDescriptor(body) {
    const space = this.space;
    const collider = body?.getCollider?.();
    if (collider?.type !== "box") {
      throw new Error("CpuBoxPhysicsAdapter body requires a BoxCollider");
    }
    if (body.getTrigger?.() === true) {
      throw new Error("CpuBoxPhysicsAdapter trigger handling is not migrated");
    }
    const halfExtents = collider.getHalfExtents?.();
    if (!Array.isArray(halfExtents) || halfExtents.length !== 3) {
      throw new Error("CpuBoxPhysicsAdapter collider must provide three half extents");
    }
    const size = halfExtents.map((entry, index) => (
      util.readFiniteNumber(entry, `CpuBoxPhysicsAdapter halfExtents[${index}]`, {
        minExclusive: 0.0
      }) * 2.0
    ));
    const offset = Array.isArray(collider.offset) ? collider.offset : [0.0, 0.0, 0.0];
    const checkedOffset = space._readVec3(offset, "CpuBoxPhysicsAdapter collider offset");
    if (checkedOffset.some((entry) => Math.abs(entry) > 1.0e-12)) {
      throw new Error("CpuBoxPhysicsAdapter collider offset is not migrated");
    }
    const quat = body.getQuat?.();
    if (!quat || !Array.isArray(quat.q) || quat.q.length !== 4) {
      throw new Error("CpuBoxPhysicsAdapter body quaternion is incomplete");
    }
    const orientation = quat.q.map((entry, index) => (
      util.readFiniteNumber(entry, `CpuBoxPhysicsAdapter orientation[${index}]`)
    ));
    const inverseInertiaLocal = body.getFixedRotation?.() === true
      || body.isDynamic?.() !== true
      ? [0.0, 0.0, 0.0]
      : space._readVec3(
        body.getInverseInertia?.(),
        "CpuBoxPhysicsAdapter inverse inertia"
      );
    const material = Object.freeze({
      ...space.materialPairs.material(body.getPhysicsMaterial?.() ?? {}, body.getPhysicsMaterialId?.()),
      linearDamping: util.readFiniteNumber(
        body.getLinearDamping?.(),
        "CpuBoxPhysicsAdapter linear damping",
        { min: 0.0 }
      ),
      angularDamping: util.readFiniteNumber(
        body.getAngularDamping?.(),
        "CpuBoxPhysicsAdapter angular damping",
        { min: 0.0 }
      )
    });
    const surfaceVelocity = space._readVec3(
      body.getSurfaceVelocity?.() ?? [0.0, 0.0, 0.0],
      "CpuBoxPhysicsAdapter surface velocity"
    );
    if (body.isKinematic?.() !== true && surfaceVelocity.some((value) => value !== 0.0)) {
      throw new Error("CpuBoxPhysicsAdapter surface velocity requires a kinematic body");
    }
    return Object.freeze({
      id: space._getBodyId(body),
      bodyType: body.getBodyType?.(),
      fixedRotation: body.getFixedRotation?.() === true,
      position: Object.freeze(space._readVec3(
        body.getPosition?.(),
        "CpuBoxPhysicsAdapter position"
      )),
      orientation: Object.freeze(orientation),
      linearVelocity: Object.freeze(space._readVec3(
        body.getLinearVelocity?.(),
        "CpuBoxPhysicsAdapter linear velocity"
      )),
      angularVelocity: Object.freeze(space._degVec3ToRad(space._readVec3(
        body.getAngularVelocity?.(),
        "CpuBoxPhysicsAdapter angular velocity"
      ))),
      surfaceVelocity: Object.freeze(surfaceVelocity),
      mass: util.readFiniteNumber(body.getMass?.(), "CpuBoxPhysicsAdapter mass", {
        minExclusive: 0.0
      }),
      inverseInertiaLocal: Object.freeze(inverseInertiaLocal),
      gravityScale: util.readFiniteNumber(
        body.getGravityScale?.(),
        "CpuBoxPhysicsAdapter gravity scale"
      ),
      allowSleep: body.getAllowSleep?.() === true,
      isSleeping: body.getSleeping?.() === true,
      collisionLayer: util.readFiniteNumber(
        body.getCollisionLayer?.(),
        "CpuBoxPhysicsAdapter collision layer",
        { integer: true, min: 0.0, max: 0xffffffff }
      ),
      collisionMask: util.readFiniteNumber(
        body.getCollisionMask?.(),
        "CpuBoxPhysicsAdapter collision mask",
        { integer: true, min: 0.0, max: 0xffffffff }
      ),
      material,
      collider: new ComputeBoxCollider(size)
    });
  }

  // static Plane NodeをnormalとplaneDistanceだけのsolver入力へ変換します
  // Node位置とcollider offsetからworld上の一点を求め、登録済みPlaneだけを使います
  _buildPlaneDescriptor(body) {
    const space = this.space;
    const collider = body?.getCollider?.();
    if (collider?.type !== "plane") {
      throw new Error("CpuBoxPhysicsAdapter plane requires a PlaneCollider");
    }
    if (body.isStatic?.() !== true) {
      throw new Error("CpuBoxPhysicsAdapter plane body must be static");
    }
    const plane = collider.getWorldInfo?.(body.getPosition?.());
    if (!plane || !Array.isArray(plane.normal) || !Array.isArray(plane.point)) {
      throw new Error("CpuBoxPhysicsAdapter Plane world information is incomplete");
    }
    const normal = space._normalizeVec3(
      space._readVec3(plane.normal, "CpuBoxPhysicsAdapter Plane normal"),
      "CpuBoxPhysicsAdapter Plane normal"
    );
    const point = space._readVec3(plane.point, "CpuBoxPhysicsAdapter Plane point");
    return Object.freeze({
      bodyId: space._getBodyId(body),
      material: space.materialPairs.material(body.getPhysicsMaterial?.() ?? {}, body.getPhysicsMaterialId?.()),
      normal: Object.freeze(normal),
      planeDistance: util.readFiniteNumber(
        space._dotVec3(point, normal),
        "CpuBoxPhysicsAdapter Plane distance"
      )
    });
  }

  // solver生成直前にNodeからBoxとPlaneのdescriptorを作ります
  // mixed SpaceではSphereやCapsuleをBox solverへ渡さず、Box/Plane subsetだけを明示的に抽出します
  _createInputSnapshot({ allowOtherBodies = false } = {}) {
    const space = this.space;
    const bodies = [];
    const planes = [];
    for (const body of space.bodies) {
      const colliderType = body?.getCollider?.()?.type;
      if (colliderType === "box") {
        const descriptor = this._buildBodyDescriptor(body);
        this.bodyDescriptorMap.set(body, descriptor);
        bodies.push(descriptor);
      } else if (colliderType === "plane") {
        const descriptor = this._buildPlaneDescriptor(body);
        this.planeDescriptorMap.set(body, descriptor);
        planes.push(descriptor);
      } else {
        if (allowOtherBodies === true) {
          continue;
        }
        throw new Error(
          `CpuBoxPhysicsAdapter does not support collider type: ${colliderType ?? "unknown"}`
        );
      }
    }
    return Object.freeze({
      bodies: Object.freeze(bodies),
      planes: Object.freeze(planes)
    });
  }

  // 登録後に変化するtransform、速度、sleepだけをsolver stateへ同期します
  // 形状や質量などの固定入力が変化した場合は、古いsolver設定で進めず停止します
  _createStateSnapshot({ allowOtherBodies = false } = {}) {
    const space = this.space;
    const states = [];
    const jointBodies = new Set();
    if (space.solveJointsInStep === true) {
      for (const joint of space.joints) {
        if (joint.isEnabled?.() === true) {
          jointBodies.add(joint.getBodyA());
          jointBodies.add(joint.getBodyB());
        }
      }
    }
    for (const body of space.bodies) {
      const colliderType = body?.getCollider?.()?.type;
      if (colliderType === "plane") {
        const registeredPlane = this.planeDescriptorMap.get(body);
        const currentPlane = this._buildPlaneDescriptor(body);
        if (!registeredPlane
            || currentPlane.bodyId !== registeredPlane.bodyId
            || currentPlane.planeDistance !== registeredPlane.planeDistance
            || JSON.stringify(currentPlane.material) !== JSON.stringify(registeredPlane.material)
            || currentPlane.normal.some((value, axis) => value !== registeredPlane.normal[axis])) {
          throw new Error(
            `CpuBoxPhysicsAdapter Plane ${currentPlane.bodyId} changed after registration`
          );
        }
        continue;
      }
      if (colliderType !== "box") {
        if (allowOtherBodies === true) {
          continue;
        }
        throw new Error(
          `CpuBoxPhysicsAdapter does not support collider type: ${colliderType ?? "unknown"}`
        );
      }
      const descriptor = this.bodyDescriptorMap.get(body);
      if (!descriptor) {
        throw new Error("CpuBoxPhysicsAdapter body is not registered");
      }
      const bodyId = descriptor.id;
      const currentHalfExtents = body.getCollider().getHalfExtents?.();
      const registeredHalfExtents = descriptor.collider.getHalfExtents();
      if (!Array.isArray(currentHalfExtents)
          || currentHalfExtents.length !== 3
          || currentHalfExtents.some((value, axis) => value !== registeredHalfExtents[axis])) {
        throw new Error(`CpuBoxPhysicsAdapter body ${bodyId} collider changed after registration`);
      }
      const currentInverseInertia = body.getFixedRotation?.() === true
        || body.isDynamic?.() !== true
        ? [0.0, 0.0, 0.0]
        : space._readVec3(
          body.getInverseInertia?.(),
          `CpuBoxPhysicsAdapter body ${bodyId} inverse inertia`
        );
      const fixedValuesMatch = body.getBodyType?.() === descriptor.bodyType
        && ["materialId", "staticFriction", "dynamicFriction", "rollingResistanceLength"].every(key =>
          space.materialPairs.material(body.getPhysicsMaterial?.() ?? {}, body.getPhysicsMaterialId?.())[key]
            === descriptor.material[key])
        && body.getMass?.() === descriptor.mass
        && body.getFixedRotation?.() === descriptor.fixedRotation
        && body.getGravityScale?.() === descriptor.gravityScale
        && body.getAllowSleep?.() === descriptor.allowSleep
        && body.getCollisionLayer?.() === descriptor.collisionLayer
        && body.getCollisionMask?.() === descriptor.collisionMask
        && body.getLinearDamping?.() === descriptor.material.linearDamping
        && body.getAngularDamping?.() === descriptor.material.angularDamping
        && space._getRestitution(body) === descriptor.material.restitution
        && space._getFriction(body) === descriptor.material.friction
        && currentInverseInertia.every((value, axis) => value === descriptor.inverseInertiaLocal[axis]);
      if (!fixedValuesMatch) {
        throw new Error(`CpuBoxPhysicsAdapter body ${bodyId} fixed properties changed after registration`);
      }
      const quat = body.getQuat?.();
      if (!quat || !Array.isArray(quat.q) || quat.q.length !== 4) {
        throw new Error(`CpuBoxPhysicsAdapter body ${bodyId} quaternion is incomplete`);
      }
      states.push(Object.freeze({
        id: bodyId,
        position: Object.freeze(space._readVec3(
          body.getPosition?.(),
          `CpuBoxPhysicsAdapter body ${bodyId} position`
        )),
        orientation: Object.freeze(quat.q.map((entry, index) => util.readFiniteNumber(
          entry,
          `CpuBoxPhysicsAdapter body ${bodyId} orientation[${index}]`
        ))),
        linearVelocity: Object.freeze(space._readVec3(
          body.getLinearVelocity?.(),
          `CpuBoxPhysicsAdapter body ${bodyId} linear velocity`
        )),
        angularVelocity: Object.freeze(body.getFixedRotation?.() === true
          ? [0.0, 0.0, 0.0]
          : space._degVec3ToRad(space._readVec3(
            body.getAngularVelocity?.(),
            `CpuBoxPhysicsAdapter body ${bodyId} angular velocity`
          ))),
        surfaceVelocity: Object.freeze(space._readVec3(
          body.getSurfaceVelocity?.() ?? [0.0, 0.0, 0.0],
          `CpuBoxPhysicsAdapter body ${bodyId} surface velocity`
        )),
        sleeping: body.getSleeping?.() === true,
        // 有効Jointへ接続されたbodyはJoint補正前にsolver内sleepへ入れずXPBDへ同じawake stateを渡します
        allowSleep: descriptor.allowSleep && !jointBodies.has(body)
      }));
    }
    return Object.freeze(states);
  }

  // 登録済みBoxのworld AABBからXZ Gridの範囲を作ります
  // Plane接触は明示Plane配列で処理し、床や壁を登録Planeとして管理します
  _buildBroadphaseBounds(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.bodies) || snapshot.bodies.length === 0) {
      throw new Error("CpuBoxPhysicsAdapter requires at least one Box body");
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const body of snapshot.bodies) {
      const aabb = body.collider.getAabb(body.position, body.orientation);
      minX = Math.min(minX, aabb.min[0]);
      maxX = Math.max(maxX, aabb.max[0]);
      minZ = Math.min(minZ, aabb.min[2]);
      maxZ = Math.max(maxZ, aabb.max[2]);
    }
    if (![minX, maxX, minZ, maxZ].every(Number.isFinite)
        || maxX <= minX || maxZ <= minZ) {
      throw new Error("CpuBoxPhysicsAdapter broadphase bounds are invalid");
    }
    return Object.freeze({ minX, maxX, minZ, maxZ, floorY: 0.0 });
  }

  // PhysicsSpaceへ登録されたBoxとPlaneから検証済みCPU Box solverを作ります
  // callerへcommonBodies、Compute collider、bounds由来Planeを要求せず、CPU adapterの登録情報を使います
  _createSolver({ allowOtherBodies = false } = {}) {
    const space = this.space;
    const snapshot = this._createInputSnapshot({ allowOtherBodies });
    if (snapshot.bodies.length === 0) {
      throw new Error("CpuBoxPhysicsAdapter requires at least one Box body");
    }
    const solverOptions = {
      bodies: snapshot.bodies,
      planes: snapshot.planes,
      bounds: this._buildBroadphaseBounds(snapshot),
      gravity: [...space.gravity],
      fixedTimeStepMs: space.fixedTimeStepMs,
      solverIterations: space.solverIterations,
      materialPairs: space.materialPairs,
      timeToSleep: space.timeToSleep,
      persistentSleep: space.persistentSleep,
      positionCorrectionBeta: space.positionCorrectionBeta,
      positionSlop: space.positionCorrectionSlop,
      broadphasePadding: space.computeBoxBroadphasePadding,
      supportFeatureTolerance: space.computeBoxSupportFeatureTolerance ?? 0.0,
      restingRestitutionSpeed: space.restingRestitutionSpeed,
      sleepLinearSpeed: space.sleepLinearThreshold,
      sleepAngularSpeed: space.sleepAngularThreshold * DEG_TO_RAD,
      sleepContactSpeed: space.sleepContactSpeed,
      sleepNormalSpeed: space.sleepNormalSpeed,
      sleepSteps: space.sleepStepsThreshold,
      minimumFloorSupportPoints: space.minimumFloorSupportPoints,
      wakeLinearSpeed: space.wakeLinearSpeed,
      wakeAngularSpeed: space.wakeAngularThreshold * DEG_TO_RAD,
      revisitBodyContactImpulses: space.revisitBodyContactImpulses
    };
    // user側のCPU姿勢実験は必要な場合だけsolverの姿勢積分関数を明示的に差し替えます
    // 標準PhysicsSpaceではCpuBoxPhysicsSolverの共有Δq ⊗ q実装を使います
    if (typeof space._buildCpuBoxStepQuat === "function") {
      solverOptions.orientationIntegrator = space._buildCpuBoxStepQuat.bind(space);
    }
    return new CpuBoxPhysicsSolver(solverOptions);
  }

  // 登録内容が変化しない間は同じsolverを使い、contact scratchとsleep counterを維持します
  getSolver() {
    if (this.solverMode !== null && this.solverMode !== "box-space") {
      throw new Error("CpuBoxPhysicsAdapter solver is already configured for a mixed Box subset");
    }
    if (this.solver === null) {
      this.solver = this._createSolver({ allowOtherBodies: false });
      this.solverMode = "box-space";
    }
    return this.solver;
  }

  // mixed Space内のBoxとPlaneだけを検証済みCPU Box solverへ登録します
  // SphereやCapsuleはこのsolverへ入れず、後段のshape pair処理で形状固有の式を使います
  getMixedBoxSolver() {
    if (this.solverMode !== null && this.solverMode !== "mixed-box-subset") {
      throw new Error("CpuBoxPhysicsAdapter solver is already configured for a complete Box space");
    }
    if (this.solver === null) {
      this.solver = this._createSolver({ allowOtherBodies: true });
      this.solverMode = "mixed-box-subset";
    }
    return this.solver;
  }

  // PhysicsNodeの現在stateを同じbody IDのsolver stateへ同期します
  // Joint補正、teleport、速度設定、sleep・wakeを次fixed stepへ明示的に反映します
  _synchronizeSolver(solver = this.getSolver(), { allowOtherBodies = false } = {}) {
    solver.synchronizeBodyStates(this._createStateSnapshot({ allowOtherBodies }));
    return solver;
  }

  // PhysicsNodeへ蓄積されたforceとtorqueを一fixed step分のimpulseとしてsolverへ渡します
  // Node側のaccumulatorはsolver完了後にPhysicsSpaceが一度だけclearします
  _queueExternalInputs(solver, dtSec) {
    const space = this.space;
    const numericDtSec = util.readFiniteNumber(
      dtSec,
      "CpuBoxPhysicsAdapter dtSec",
      { minExclusive: 0.0 }
    );
    for (const body of space.bodies) {
      if (body?.getCollider?.()?.type !== "box" || body.isDynamic?.() !== true) {
        continue;
      }
      const bodyId = space._getBodyId(body);
      const force = space._readVec3(
        body.getForce?.(),
        `CpuBoxPhysicsAdapter body ${bodyId} force`
      );
      const torque = space._readVec3(
        body.getTorque?.(),
        `CpuBoxPhysicsAdapter body ${bodyId} torque`
      );
      if (force[0] !== 0.0 || force[1] !== 0.0 || force[2] !== 0.0) {
        solver.applyLinearImpulse(bodyId, force.map((value) => value * numericDtSec));
      }
      if (torque[0] !== 0.0 || torque[1] !== 0.0 || torque[2] !== 0.0) {
        solver.applyAngularImpulse(bodyId, torque.map((value) => value * numericDtSec));
      }
    }
    return solver;
  }

  // collideConnected=falseの有効Jointをsolverの候補除外pairへ変換します
  // Joint後にcontactだけを消さず、BoxとPlaneの候補生成前から同じpairを除外します
  _configureJointPairs(solver, { allowUnmappedBodies = false } = {}) {
    const space = this.space;
    const bodyIdMap = new Map();
    for (const [body, descriptor] of this.bodyDescriptorMap.entries()) {
      bodyIdMap.set(body, descriptor.id);
    }
    for (const [body, descriptor] of this.planeDescriptorMap.entries()) {
      bodyIdMap.set(body, descriptor.bodyId);
    }
    const excludedPairs = [];
    for (let index = 0; index < space.joints.length; index += 1) {
      const joint = space.joints[index];
      if (joint.isEnabled?.() !== true || joint.getCollideConnected?.() === true) {
        continue;
      }
      const bodyAId = bodyIdMap.get(joint.getBodyA());
      const bodyBId = bodyIdMap.get(joint.getBodyB());
      if (bodyAId === undefined || bodyBId === undefined) {
        if (allowUnmappedBodies === true) {
          continue;
        }
        throw new Error(
          `CpuBoxPhysicsAdapter Joint ${index} references a body outside the registered Box solver`
        );
      }
      excludedPairs.push([bodyAId, bodyBId]);
    }
    solver.setExcludedBodyPairs(excludedPairs);
    return solver;
  }

  // solverのrad/sec stateを同じPhysicsNodeのtransform・degree/sec速度・sleep状態へ反映します
  // body IDの不足を無視せず、solverとNodeの対応が崩れた時点でfixed stepを停止します
  _syncNodes(solver = this.getSolver()) {
    const space = this.space;
    const states = solver.getStates();
    for (const [body, descriptor] of this.bodyDescriptorMap.entries()) {
      const state = states.get(descriptor.id);
      if (!state) {
        throw new Error(`CpuBoxPhysicsAdapter state ${descriptor.id} is missing`);
      }
      const quat = new Quat();
      quat.q[0] = state.orientation[0];
      quat.q[1] = state.orientation[1];
      quat.q[2] = state.orientation[2];
      quat.q[3] = state.orientation[3];
      body.syncNodeFromPhysics(state.position, { quat });
      if (state.sleeping === true) {
        body.stopMotion();
        body.sleep();
      } else {
        body.wakeUp();
        body.setLinearVelocityVec(state.linearVelocity);
        body.setAngularVelocityVec(space._radVec3ToDeg(state.angularVelocity));
      }
    }
    return states;
  }

  // solverが最終反復で解いたcontactをPhysicsSpaceのcontact・manifold・event形式へ変換します
  // collider判定を再実行せず、solverが保持した法線・作用点・penetration・lambdaを使います
  _applyContacts(solver = this.getSolver()) {
    const result = this._buildContactResults(solver);
    const space = this.space;
    const { contacts, manifolds } = result;
    space.lastContacts = contacts.map((contact) => space._cloneContact(contact));
    space.lastManifolds = manifolds.map((manifold) => space._cloneManifold(manifold));
    const currentContactMap = space._buildContactMap(contacts);
    space.lastContactEvents = space._buildContactEvents(currentContactMap);
    space._emitContactEvents(space.lastContactEvents);
    space.previousContactMap = currentContactMap;
    space.previousManifoldMap = space._buildManifoldCache(manifolds);
    return space.lastContacts;
  }

  // solverの接触結果をPhysicsSpaceのcontact・manifold形式へ変換します
  // mixed Spaceではevent更新を後段へ残し、Box接触とSphere・Capsule接触を一つの履歴へまとめます
  _buildContactResults(solver = this.getSolver()) {
    const space = this.space;
    const nodeByBodyId = new Map();
    for (const [body, descriptor] of this.bodyDescriptorMap.entries()) {
      nodeByBodyId.set(descriptor.id, body);
    }
    for (const [body, descriptor] of this.planeDescriptorMap.entries()) {
      nodeByBodyId.set(descriptor.bodyId, body);
    }

    const manifoldMap = new Map();
    const contacts = [];
    const solverContacts = solver.getLastContacts();
    for (let index = 0; index < solverContacts.length; index += 1) {
      const source = solverContacts[index];
      const bodyAId = source.kind === "plane" ? source.planeBodyId : source.bodyAId;
      const bodyBId = source.kind === "plane" ? source.bodyId : source.bodyBId;
      if (bodyAId === null || bodyAId === undefined) {
        throw new Error(`CpuBoxPhysicsAdapter contact ${index} Plane body ID is missing`);
      }
      const bodyA = nodeByBodyId.get(bodyAId);
      const bodyB = nodeByBodyId.get(bodyBId);
      if (!bodyA || !bodyB) {
        throw new Error(
          `CpuBoxPhysicsAdapter contact ${index} references unknown body IDs: ${bodyAId}, ${bodyBId}`
        );
      }
      const normal = space._readVec3(
        source.normal,
        `CpuBoxPhysicsAdapter contact ${index} normal`
      );
      const point = space._readVec3(
        source.point,
        `CpuBoxPhysicsAdapter contact ${index} point`
      );
      const penetration = util.readFiniteNumber(
        source.penetration,
        `CpuBoxPhysicsAdapter contact ${index} penetration`,
        { min: 0.0 }
      );
      const normalImpulse = util.readFiniteNumber(
        source.normalImpulse,
        `CpuBoxPhysicsAdapter contact ${index} normal impulse`,
        { min: 0.0 }
      );
      const tangentImpulse = space._readVec3(
        source.tangentImpulse,
        `CpuBoxPhysicsAdapter contact ${index} tangent impulse`
      );
      const pairKey = space._getManifoldPairKey(bodyA, bodyB);
      let manifold = manifoldMap.get(pairKey);
      if (!manifold) {
        manifold = {
          bodyA,
          bodyB,
          normal,
          source: {
            kind: source.kind === "plane" ? "computePlaneBox" : "computeBox",
            solver: "registeredBox"
          },
          sharedTangentImpulse: [0.0, 0.0, 0.0],
          supportTangentImpulse: [0.0, 0.0, 0.0],
          contacts: []
        };
        manifoldMap.set(pairKey, manifold);
      }
      manifold.contacts.push({
        featureKey: source.kind === "plane"
          ? `compute-plane-${source.planeIndex}`
          : "compute-box-0",
        penetration,
        point,
        normalImpulse,
        tangentImpulse
      });
      manifold.sharedTangentImpulse[0] += tangentImpulse[0];
      manifold.sharedTangentImpulse[1] += tangentImpulse[1];
      manifold.sharedTangentImpulse[2] += tangentImpulse[2];
      manifold.supportTangentImpulse = [...manifold.sharedTangentImpulse];
      contacts.push({ bodyA, bodyB, normal, penetration, point });
    }

    const manifolds = [...manifoldMap.values()];
    return { contacts, manifolds };
  }

  // 検証済みBox solverのstateをPhysicsSpaceのmixed stateMapへ変換します
  // Box stateはsolver結果を使い、SphereやCapsuleはNodeの現在stateを初期値として後段の一般処理へ渡します
  createMixedStateMap(states) {
    const space = this.space;
    if (!(states instanceof Map)) {
      throw new Error("CpuBoxPhysicsAdapter mixed states must be a Map");
    }
    const stateMap = new Map();
    for (const body of space.bodies) {
      const colliderType = body?.getCollider?.()?.type;
      if (colliderType === "box") {
        const descriptor = this.bodyDescriptorMap.get(body);
        if (!descriptor) {
          throw new Error("CpuBoxPhysicsAdapter mixed Box descriptor is missing");
        }
        const solverState = states.get(descriptor.id);
        if (!solverState) {
          throw new Error(`CpuBoxPhysicsAdapter mixed Box state ${descriptor.id} is missing`);
        }
        const quat = new Quat();
        quat.q[0] = solverState.orientation[0];
        quat.q[1] = solverState.orientation[1];
        quat.q[2] = solverState.orientation[2];
        quat.q[3] = solverState.orientation[3];
        stateMap.set(body, {
          position: [...solverState.position],
          velocity: [...solverState.linearVelocity],
          quat,
          angularVelocity: [...space._radVec3ToDeg(solverState.angularVelocity)],
          sleeping: solverState.sleeping === true,
          computeBoxActive: false,
          computeBoxWasPredictedWake: false,
          touchedStatic: false,
          touchedDynamicSupport: false,
          computeBoxContactObserved: false,
          computeBoxBodyContactObserved: false,
          computeBoxActiveDynamicBodyContactObserved: false,
          computeBoxMaxContactSpeed: 0.0,
          computeBoxMaxNormalSpeed: 0.0,
          computeBoxFloorContactObserved: false,
          computeBoxFloorSupportPoints: Infinity,
          computeBoxWallSupportObserved: false
        });
        continue;
      }
      stateMap.set(body, {
        position: space._cloneVec3(body.getPosition()),
        velocity: space._cloneVec3(body.getLinearVelocity()),
        quat: body.getQuat(),
        angularVelocity: space._cloneVec3(body.getAngularVelocity()),
        sleeping: body.getSleeping?.() === true,
        computeBoxActive: false,
        computeBoxWasPredictedWake: false,
        touchedStatic: false,
        touchedDynamicSupport: false,
        computeBoxContactObserved: false,
        computeBoxBodyContactObserved: false,
        computeBoxActiveDynamicBodyContactObserved: false,
        computeBoxMaxContactSpeed: 0.0,
        computeBoxMaxNormalSpeed: 0.0,
        computeBoxFloorContactObserved: false,
        computeBoxFloorSupportPoints: Infinity,
        computeBoxWallSupportObserved: false
      });
    }
    return stateMap;
  }

  // mixed Box solverのsleep結果をNodeのflagへ先に反映します
  // 後段のSphere・Capsule接触がsleep Boxをwakeすると、一般solverが同じbodyを押し戻せる状態になります
  synchronizeMixedBoxSleepFlags(states) {
    if (!(states instanceof Map)) {
      throw new Error("CpuBoxPhysicsAdapter mixed sleep states must be a Map");
    }
    for (const [body, descriptor] of this.bodyDescriptorMap.entries()) {
      const state = states.get(descriptor.id);
      if (!state) {
        throw new Error(`CpuBoxPhysicsAdapter mixed sleep state ${descriptor.id} is missing`);
      }
      if (state.sleeping === true) {
        body.stopMotion();
        body.sleep();
      } else {
        body.wakeUp();
      }
    }
    return states;
  }

  // mixed SpaceでBox subsetを一fixed stepだけ進め、Node同期とevent通知を後段へ残します
  // Box/Planeの検証済み処理を先に実行し、Sphere・Capsuleとの一般pairが同じstateMapへ接続できる結果を返します
  stepBoxSubset(dtSec) {
    const space = this.space;
    const numericDtSec = util.readFiniteNumber(
      dtSec,
      "CpuBoxPhysicsAdapter mixed dtSec",
      { minExclusive: 0.0 }
    );
    const fixedDtSec = space.fixedTimeStepMs / 1000.0;
    if (Math.abs(numericDtSec - fixedDtSec) > 1.0e-12) {
      throw new Error(
        `CpuBoxPhysicsAdapter mixed dtSec must equal fixed timestep: ${numericDtSec} !== ${fixedDtSec}`
      );
    }
    const solver = this.getMixedBoxSolver();
    this._synchronizeSolver(solver, { allowOtherBodies: true });
    this._configureJointPairs(solver, { allowUnmappedBodies: true });
    this._queueExternalInputs(solver, numericDtSec);
    solver.advance(1);
    return {
      solver,
      states: solver.getStates(),
      ...this._buildContactResults(solver)
    };
  }

  // solverのbody単位sleep stateを既存のsleep island診断形式へ変換します
  // 検証済みsolverはbody単位counterを持つため、未接続Nodeを一body一islandとして記録します
  _updateSleepIslands(
    solver = this.getSolver(),
    states = solver.getStates()
  ) {
    const space = this.space;
    if (!(states instanceof Map)) {
      throw new Error("CpuBoxPhysicsAdapter states must be a Map");
    }
    const jointBodies = new Set();
    for (const joint of space.joints) {
      if (joint.isEnabled?.() !== true) {
        continue;
      }
      jointBodies.add(joint.getBodyA());
      jointBodies.add(joint.getBodyB());
    }
    const maxPenetrationByBodyId = new Map();
    const solverContacts = solver.getLastContacts();
    for (let index = 0; index < solverContacts.length; index += 1) {
      const contact = solverContacts[index];
      const penetration = util.readFiniteNumber(
        contact.penetration,
        `CpuBoxPhysicsAdapter sleep contact ${index} penetration`,
        { min: 0.0 }
      );
      const bodyIds = contact.kind === "plane"
        ? [contact.bodyId]
        : [contact.bodyAId, contact.bodyBId];
      for (const bodyId of bodyIds) {
        if (!Number.isInteger(bodyId) || bodyId <= 0) {
          throw new Error(
            `CpuBoxPhysicsAdapter sleep contact ${index} body ID is invalid`
          );
        }
        maxPenetrationByBodyId.set(
          bodyId,
          Math.max(maxPenetrationByBodyId.get(bodyId) ?? 0.0, penetration)
        );
      }
    }
    const debugIslands = [];
    for (const [body, descriptor] of this.bodyDescriptorMap.entries()) {
      const state = states.get(descriptor.id);
      if (!state) {
        throw new Error(`CpuBoxPhysicsAdapter sleep state ${descriptor.id} is missing`);
      }
      if (state.bodyType !== "dynamic") {
        continue;
      }
      if (typeof state.sleeping !== "boolean" || typeof state.allowSleep !== "boolean") {
        throw new Error(
          `CpuBoxPhysicsAdapter sleep state ${descriptor.id} flags are invalid`
        );
      }
      const linearVelocity = space._readVec3(
        state.linearVelocity,
        `CpuBoxPhysicsAdapter sleep body ${descriptor.id} linear velocity`
      );
      const angularVelocityRad = space._readVec3(
        state.angularVelocity,
        `CpuBoxPhysicsAdapter sleep body ${descriptor.id} angular velocity`
      );
      const sleepCounter = util.readFiniteNumber(
        state.sleepCounter,
        `CpuBoxPhysicsAdapter sleep body ${descriptor.id} counter`,
        { integer: true, min: 0 }
      );
      const linearSpeed = space._lengthVec3(linearVelocity);
      const angularSpeed = space._lengthVec3(space._radVec3ToDeg(angularVelocityRad));
      let blockReason = "none";
      if (state.sleeping !== true) {
        if (body.getAllowSleep?.() !== true) {
          blockReason = "sleep_disabled";
        } else if (state.allowSleep !== true && jointBodies.has(body)) {
          blockReason = "joint";
        } else if (linearSpeed >= space.sleepLinearThreshold) {
          blockReason = "linear_speed";
        } else if (angularSpeed >= space.sleepAngularThreshold) {
          blockReason = "angular_speed";
        } else {
          // solver内部のsupport/contact速度条件は数値結果だけから一意に分解できないため、確定した診断理由だけを返します
          blockReason = "solver_condition";
        }
      }
      debugIslands.push({
        islandId: debugIslands.length + 1,
        state: state.sleeping === true ? "sleeping" : "awake",
        bodyIds: [descriptor.id],
        bodyNames: [body.getName?.() ?? `body_${descriptor.id}`],
        bodyCount: 1,
        minSleepStepCount: sleepCounter,
        maxLinearSpeed: linearSpeed,
        maxAngularSpeed: angularSpeed,
        maxPenetration: maxPenetrationByBodyId.get(descriptor.id) ?? 0.0,
        blockReason
      });
    }
    space.lastSleepIslands = debugIslands;
    return space.lastSleepIslands;
  }

  // 登録bodyの形状がCPU Box solverだけで処理できる構成か判定します
  // BoxとPlaneだけのSpaceで一つのsolverを使い、他形状は形状固有の処理へ明示的に送ります
  hasBoxBodies() {
    let hasBox = false;
    for (const body of this.space.bodies) {
      if (body?.getTrigger?.() === true) {
        return false;
      }
      if (body?.getCollider?.()?.type === "box") {
        hasBox = true;
      }
    }
    return hasBox;
  }

  // 登録bodyの形状がCPU Box solverだけで処理できる構成か判定します
  // BoxとPlaneだけのSpaceで一つのsolverを使い、他形状は形状固有の処理へ明示的に送ります
  shouldUseForStep() {
    let hasBox = false;
    let hasDynamicBox = false;
    for (const body of this.space.bodies) {
      const colliderType = body?.getCollider?.()?.type;
      if (body?.getTrigger?.() === true) {
        return false;
      }
      if (colliderType === "box") {
        hasBox = true;
        hasDynamicBox = hasDynamicBox || body.isDynamic?.() === true;
        continue;
      }
      if (colliderType === "plane") {
        continue;
      }
      return false;
    }
    // 動的Boxが存在する場合は検証済みの専用solverへ送り、静的配置だけはmixed経路でcontact記録を作ります
    return hasBox && hasDynamicBox;
  }

  // 保存済みのBox/Plane contactを使い、重いsolver反復を省略したfixed stepの結果を返します
  // lastContacts、lastManifolds、sleep islandは保持し、stay eventだけ現在step分として再通知します
  _stepSleepingFastPath() {
    const space = this.space;
    const currentContactMap = space._buildContactMap(space.lastContacts);
    space.lastContactEvents = space._buildContactEvents(currentContactMap);
    space._emitContactEvents(space.lastContactEvents);
    space.previousContactMap = currentContactMap;
    const solver = this.solver ?? this.getSolver();
    return solver.getStates();
  }

  // 登録BoxとPlaneだけを使う一回分のCPU統合stepを実行します
  // PhysicsSpaceの公開stepから呼ばれ、Node同期と既存イベント形式へ結果を戻します
  step(dtSec) {
    const space = this.space;
    const numericDtSec = util.readFiniteNumber(
      dtSec,
      "CpuBoxPhysicsAdapter dtSec",
      { minExclusive: 0.0 }
    );
    const fixedDtSec = space.fixedTimeStepMs / 1000.0;
    if (Math.abs(numericDtSec - fixedDtSec) > 1.0e-12) {
      throw new Error(
        `CpuBoxPhysicsAdapter dtSec must equal fixed timestep: ${numericDtSec} !== ${fixedDtSec}`
      );
    }
    space._wakeEnabledJointBodies();
    const dynamicBodies = space.bodies.filter((body) => body.isDynamic?.() === true);
    if (dynamicBodies.length > 0 && space._canUseSpaceSleepingFastPath(dynamicBodies)) {
      return this._stepSleepingFastPath();
    }
    const jointXpbdPreStepTransformMap = space.solveJointsInStep === true
      ? space._createJointXpbdPreStepTransformMap()
      : null;
    const solver = this._synchronizeSolver();
    this._configureJointPairs(solver);
    this._queueExternalInputs(solver, numericDtSec);
    solver.advance(1);
    let states = this._syncNodes(solver);
    this._applyContacts(solver);
    space._solveJointsXPBD(numericDtSec);
    if (jointXpbdPreStepTransformMap !== null) {
      space._applyRegisteredBoxJointVelocityUpdate(
        jointXpbdPreStepTransformMap,
        numericDtSec
      );
    }
    if (space.solveJointsInStep === true && space.joints.length > 0) {
      this._synchronizeSolver(solver);
      states = solver.getStates();
    }
    this._updateSleepIslands(solver, states);
    space.sleepFastPathReady = true;
    for (const body of space.bodies) {
      body.clearAccumulators?.();
    }
    return states;
  }
}
