// ---------------------------------------------
// samples/falling_dominoes/FallingDominoSleepDiagnostic.js  2026/09/13
//   falling_dominoes専用のsleep・接触連鎖診断
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { buildComputePhysicsStateDiagnostics } from "../../user/dev_core/ComputePhysicsDiagnostics.js";

const READBACK_FRAME_INTERVAL = 1;

// 二つのvec3の内積を計算し、接触法線方向の相対速度を取り出せるようにします
function dot3(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

// 二つのvec3の差を作り、body Aからbody Bへ向かう速度差を表します
function subtract3(first, second) {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

// 角速度と接触点までの腕の外積を計算し、接触点の回転由来速度を求めます
function cross3(first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0]
  ];
}

// 線速度と角速度から接触点のworld速度を作り、重心速度と分けて評価します
function contactPointVelocity(state, point) {
  const arm = subtract3(point, state.position);
  const rotationalVelocity = cross3(state.angularVelocity, arm);
  return [
    state.linearVelocity[0] + rotationalVelocity[0],
    state.linearVelocity[1] + rotationalVelocity[1],
    state.linearVelocity[2] + rotationalVelocity[2]
  ];
}

// Plane接触が一つのbodyへ加えた角速度差分の大きさを求め、先行回転の比較値にします
function vectorLength3(values) {
  return Math.hypot(values[0], values[1], values[2]);
}

// CPUエミュレータの接触履歴から指定body pairで最大の法線力積を取り出します
// B29〜B32というbody番号はこのサンプルの固定配置にだけ使い、Coreへは共通body IDを渡します
function findPairImpulseAudit(trace, bodyAId, bodyBId) {
  const bodyTrace = trace?.bodies?.find((body) => body.id === bodyAId);
  const candidates = bodyTrace?.bodyImpulses?.filter((impulse) => (
    impulse.otherId === bodyBId && impulse.normalImpulse > 0
  )) ?? [];
  if (candidates.length === 0) return null;
  const selected = candidates.reduce((best, candidate) => (
    Math.max(0, -candidate.normalVelocity) > Math.max(0, -best.normalVelocity)
      ? candidate
      : best
  ));
  const approachSpeed = Math.max(0, -selected.normalVelocity);
  return {
    normal: [selected.normalVelocity, approachSpeed, selected.denominator, selected.normalImpulse],
    friction: [
      selected.restitution,
      selected.tangentSpeed,
      selected.unrestricted,
      selected.frictionLimit
    ],
    applied: [selected.frictionImpulse, 1, bodyBId - 1, 0]
  };
}

// CPUエミュレータが保持したbody別traceを隣接pairの表示形式へまとめます
// GPUの通常solverへ固定body番号の診断処理を追加せず、診断の対象と粒度をsample側で選びます
function buildPairImpulseAudit(trace, fixedStep) {
  const body29To30 = findPairImpulseAudit(trace, 29, 30);
  const body30To31 = findPairImpulseAudit(trace, 30, 31);
  const body31To32 = findPairImpulseAudit(trace, 31, 32);
  if (body29To30 === null && body30To31 === null && body31To32 === null) return null;
  return { fixedStep, body29To30, body30To31, body31To32 };
}

// falling_dominoesの固定配置を対象に、GPU汎用診断とCPUエミュレータを組み合わせて表示値を作ります
// GPU側はBodyStateと汎用sleep診断だけをreadbackし、B29〜B32の段階追跡はCPU側の独立計算で行います
export default class FallingDominoSleepDiagnostic {
  // physicsのreadback API、body情報、CPUエミュレータを保持し、診断専用bufferを生成します
  constructor(physics, bodyCount, cpuEmulator) {
    this.physics = physics;
    this.cpuEmulator = cpuEmulator;
    this.bodyIds = Array.from({ length: bodyCount }, (_, index) => index + 1);
    this.wakeLinearThreshold = physics.getWakeLinearThreshold();
    this.preReadbackBuffer = physics.createStateReadbackBuffer();
    this.postReadbackBuffer = physics.createStateReadbackBuffer();
    this.frameScheduled = false;
    this.readbackPending = false;
    this.readbackMapStarted = false;
    this.readbackError = null;
    this.resetGeneration = 0;
    this.pendingReadbackGeneration = null;
    this.sampleCount = 0;
    this.pendingPreFixedStepCount = null;
    this.pendingPostFixedStepCount = null;
    this.bodyInfo = new Map(this.bodyIds.map((id) => [id, physics.getBodyInfo(id)]));
    this.values = this.createInitialValues();
  }

  // physics更新前のBodyStateをcopyし、接触前の速度をsolver後の値と分離します
  encodeBeforePhysics(encoder, frameNumber) {
    if (this.readbackPending || (frameNumber - 1) % READBACK_FRAME_INTERVAL !== 0) return false;
    this.physics.encodeStateReadback(encoder, this.preReadbackBuffer);
    this.pendingPreFixedStepCount = this.physics.getFixedStepCount();
    this.frameScheduled = true;
    return true;
  }

  // physics更新後のBodyStateだけを同じcommand encoderへcopyします
  // 診断値はsubmit後に外部moduleがこのstateとcontact queryから組み立てます
  encodeAfterPhysics(encoder) {
    if (!this.frameScheduled) return false;
    this.physics.encodeStateReadback(encoder, this.postReadbackBuffer);
    this.pendingPostFixedStepCount = this.physics.getFixedStepCount();
    this.pendingReadbackGeneration = this.resetGeneration;
    this.frameScheduled = false;
    this.readbackPending = true;
    return true;
  }

  // submit後に二つのstate readbackをmapし、外部moduleの観測値とCPU独立計算を比較表示へ渡します
  // map失敗を空の数値へ置き換えず、panelへ明示的なERRORとして残します
  resolveAfterSubmit() {
    if (!this.readbackPending || this.readbackMapStarted) return;
    this.readbackMapStarted = true;
    const readbackGeneration = this.pendingReadbackGeneration;
    Promise.all([
      this.physics.readStateReadback(this.preReadbackBuffer, this.physics.getBodySlotCount()),
      this.physics.readStateReadback(this.postReadbackBuffer, this.physics.getBodySlotCount())
    ]).then(([preStateData, postStateData]) => {
      if (readbackGeneration !== this.resetGeneration) {
        // reset後に完了した旧世代の結果を新しい連鎖の表示値へ混ぜず、次のreadbackを受け付けます
        this.pendingPreFixedStepCount = null;
        this.pendingPostFixedStepCount = null;
        this.pendingReadbackGeneration = null;
        this.readbackPending = false;
        this.readbackMapStarted = false;
        return;
      }
      const states = new Map(this.bodyIds.map((id) => [
        id,
        this.physics.readBodyStateFromReadback(id, postStateData)
      ]));
      const contacts = this.physics.getContactsFromReadback(postStateData, { includeTriggers: false });
      const planeContacts = this.physics.getPlaneContactsFromReadback(postStateData, { includeTriggers: false });
      const diagnostics = buildComputePhysicsStateDiagnostics(
        this.physics,
        states,
        contacts,
        planeContacts
      );
      this.processStateData(
        preStateData,
        postStateData,
        diagnostics,
        this.pendingPreFixedStepCount,
        this.pendingPostFixedStepCount
      );
      this.pendingPreFixedStepCount = null;
      this.pendingPostFixedStepCount = null;
      this.pendingReadbackGeneration = null;
      this.readbackPending = false;
      this.readbackMapStarted = false;
    }).catch((error) => {
      this.readbackError = error;
      this.readbackPending = false;
      this.readbackMapStarted = false;
      console.error("falling_dominoes sleep diagnostic readback failed:", error);
    });
  }

  // 初期状態を作り、まだ接触していないpairにも間隔とsleep状態を表示できるようにします
  createInitialValues() {
    const firstMass = this.bodyInfo.get(this.bodyIds[0]).mass;
    const secondMass = this.bodyInfo.get(this.bodyIds[1]).mass;
    const reducedMass = (firstMass * secondMass) / (firstMass + secondMass);
    return Object.freeze({
      sampleCount: 0,
      wakeLinearThreshold: this.wakeLinearThreshold,
      wakeEnergy: 0.5 * reducedMass * this.wakeLinearThreshold ** 2,
      maxLinearSpeed: 0,
      maxAngularSpeed: 0,
      peakLinearSpeed: 0,
      peakAngularSpeed: 0,
      peakMotionByBody: this.bodyIds.map((bodyId) => ({ bodyId, linearSpeed: 0, angularSpeed: 0 })),
      planeAngularDeltaByBody: this.bodyIds.map((bodyId) => ({
        bodyId,
        normal: 0,
        friction: 0,
        total: 0
      })),
      peakPlaneAngularDelta: { bodyId: null, normal: 0, friction: 0, total: 0 },
      bodyPairAngularDeltaByBody: this.bodyIds.map((bodyId) => ({
        bodyId,
        normal: 0,
        friction: 0,
        total: 0
      })),
      peakBodyPairAngularDelta: { bodyId: null, normal: 0, friction: 0, total: 0 },
      firstAngularSourceByBody: this.bodyIds.map((bodyId) => ({
        bodyId,
        source: "none",
        fixedStep: null,
        floorSupportBalanced: null,
        floorSupportUnbalanced: null
      })),
      pairImpulseAudit: null,
      stageVelocity: null,
      cpuEmulator: null,
      maxContactSpeed: 0,
      maxNormalSpeed: 0,
      sleepEligibleCount: 0,
      quietContactCount: 0,
      supportCount: 0,
      pairs: this.bodyIds.slice(0, -1).map((bodyAId, index) => ({
        bodyAId,
        bodyBId: this.bodyIds[index + 1],
        sleepingTarget: true,
        contact: false,
        pointAvailable: false,
        normalVelocity: null,
        approachSpeed: null,
        deficit: null,
        energy: null,
        wakeEnergy: null,
        energyDeficit: null,
        impactNormalVelocity: null,
        impactApproachSpeed: null,
        impactEnergy: null,
        solverNormalVelocity: null,
        solverApproachSpeed: null,
        solverNormalImpulse: null,
        solverContactOtherSlot: null,
        solverBNormalVelocity: null,
        solverBApproachSpeed: null,
        solverBNormalImpulse: null,
        solverBContactNormal: null,
        solverBContactPoint: null,
        solverBPeakApproachSpeed: 0,
        solverBPeakNormalImpulse: 0,
        solverBPeakNormalVelocity: null,
        solverContactNormal: null,
        solverContactPoint: null,
        solverPeakContactNormal: null,
        solverPeakContactPoint: null,
        wakeCandidate: null,
        wakeBodySleeping: null,
        wakeNormalVelocity: null,
        wakeApproachSpeed: null,
        wakeContactValid: null,
        wakeCandidateSlot: null,
        wakePeakNormalVelocity: null,
        wakePeakApproachSpeed: 0,
        wakePeakContactValid: false,
        wakePeakCandidateSlot: null,
        solverPeakApproachSpeed: 0,
        solverPeakNormalImpulse: 0,
        closingSpeed: null,
        peakClosingSpeed: 0,
        peakApproachSpeed: 0,
        peakEnergy: 0,
        gapX: null
      }))
    });
  }

  // GPU状態をbody IDへ戻し、接触一覧・汎用診断・CPUエミュレータを同じfixed step範囲で揃えます
  processStateData(preStateData, postStateData, diagnostics, preFixedStepCount, postFixedStepCount) {
    const preStates = new Map(this.bodyIds.map((id) => [
      id,
      this.physics.readBodyStateFromReadback(id, preStateData)
    ]));
    const states = new Map(this.bodyIds.map((id) => [
      id,
      this.physics.readBodyStateFromReadback(id, postStateData)
    ]));
    const diagnosticMap = new Map(diagnostics.map((diagnostic) => [diagnostic.bodyId, diagnostic]));
    const contacts = this.physics.getContactsFromReadback(postStateData, { includeTriggers: false });
    const fixedStepDelta = preFixedStepCount === null || postFixedStepCount === null
      ? 0
      : Math.max(0, postFixedStepCount - preFixedStepCount);
    const sampleSeconds = fixedStepDelta * this.physics.getFixedTimeStepMs() / 1000;
    const cpuReport = this.cpuEmulator.compareAndAdvance(
      preStates,
      states,
      fixedStepDelta,
      preFixedStepCount
    );
    const pairs = this.bodyIds.slice(0, -1).map((bodyAId, index) => {
      const bodyBId = this.bodyIds[index + 1];
      const pairContacts = contacts.filter((contact) => (
        contact.bodyAId === bodyAId && contact.bodyBId === bodyBId
      ));
      return this.measurePair(
        bodyAId,
        bodyBId,
        states.get(bodyAId),
        states.get(bodyBId),
        pairContacts,
        diagnosticMap.get(bodyAId),
        this.bodyInfo.get(bodyBId).slot,
        diagnosticMap.get(bodyBId),
        this.bodyInfo.get(bodyAId).slot,
        preStates.get(bodyAId),
        preStates.get(bodyBId),
        sampleSeconds
      );
    });
    const previousMotion = new Map(this.values.peakMotionByBody.map((motion) => [motion.bodyId, motion]));
    const currentPlaneAngularDelta = diagnostics.map((diagnostic) => {
      const normal = vectorLength3(diagnostic.contactAngularDelta.planeNormal);
      const friction = vectorLength3(diagnostic.contactAngularDelta.planeFriction);
      return { bodyId: diagnostic.bodyId, normal, friction, total: normal + friction };
    });
    const currentBodyPairAngularDelta = diagnostics.map((diagnostic) => {
      const normal = vectorLength3(diagnostic.contactAngularDelta.bodyPairNormal);
      const friction = vectorLength3(diagnostic.contactAngularDelta.bodyPairFriction);
      return { bodyId: diagnostic.bodyId, normal, friction, total: normal + friction };
    });
    const currentPlaneAngularPeak = currentPlaneAngularDelta.reduce((best, value) => (
      value.total > best.total ? value : best
    ), { bodyId: null, normal: 0, friction: 0, total: 0 });
    const previousPlaneAngularPeak = this.values.peakPlaneAngularDelta;
    const peakPlaneAngularDelta = currentPlaneAngularPeak.total > previousPlaneAngularPeak.total
      ? currentPlaneAngularPeak
      : previousPlaneAngularPeak;
    const currentBodyPairAngularPeak = currentBodyPairAngularDelta.reduce((best, value) => (
      value.total > best.total ? value : best
    ), { bodyId: null, normal: 0, friction: 0, total: 0 });
    const previousBodyPairAngularPeak = this.values.peakBodyPairAngularDelta;
    const peakBodyPairAngularDelta = currentBodyPairAngularPeak.total > previousBodyPairAngularPeak.total
      ? currentBodyPairAngularPeak
      : previousBodyPairAngularPeak;
    const previousAngularSources = new Map(
      this.values.firstAngularSourceByBody.map((value) => [value.bodyId, value])
    );
    const firstAngularSourceByBody = diagnostics.map((diagnostic) => {
      const previous = previousAngularSources.get(diagnostic.bodyId);
      if (previous?.source !== "none") return previous;
      const bodyPair = currentBodyPairAngularDelta.find((value) => value.bodyId === diagnostic.bodyId);
      const plane = currentPlaneAngularDelta.find((value) => value.bodyId === diagnostic.bodyId);
      const bodyPairActive = bodyPair.total > 0.0000001;
      const planeActive = plane.total > 0.0000001;
      const source = bodyPairActive && planeActive
        ? "box+plane"
        : bodyPairActive
          ? "box"
          : planeActive
            ? "plane"
            : "none";
      return {
        bodyId: diagnostic.bodyId,
        source,
        fixedStep: source === "none" ? null : postFixedStepCount,
        floorSupportBalanced: source === "none"
          ? null
          : diagnostic.flagState.floorSupportBalanced,
        floorSupportUnbalanced: source === "none"
          ? null
          : diagnostic.flagState.floorSupportUnbalanced
      };
    });
    const pairImpulseAudit = buildPairImpulseAudit(cpuReport?.trace, postFixedStepCount);
    const stageVelocity = cpuReport?.stage
      ? { fixedStep: postFixedStepCount, ...cpuReport.stage }
      : this.values.stageVelocity;
    this.sampleCount += 1;
    this.values = Object.freeze({
      sampleCount: this.sampleCount,
      wakeLinearThreshold: this.wakeLinearThreshold,
      wakeEnergy: this.values.wakeEnergy,
      maxLinearSpeed: Math.max(...diagnostics.map((diagnostic) => diagnostic.speeds[2]), 0),
      maxAngularSpeed: Math.max(...diagnostics.map((diagnostic) => diagnostic.speeds[3]), 0),
      peakLinearSpeed: Math.max(this.values.peakLinearSpeed, ...diagnostics.map((diagnostic) => diagnostic.speeds[2]), 0),
      peakAngularSpeed: Math.max(this.values.peakAngularSpeed, ...diagnostics.map((diagnostic) => diagnostic.speeds[3]), 0),
      peakMotionByBody: diagnostics.map((diagnostic) => {
        const previous = previousMotion.get(diagnostic.bodyId);
        return {
          bodyId: diagnostic.bodyId,
          linearSpeed: Math.max(previous?.linearSpeed ?? 0, diagnostic.speeds[2]),
          angularSpeed: Math.max(previous?.angularSpeed ?? 0, diagnostic.speeds[3])
        };
      }),
      planeAngularDeltaByBody: currentPlaneAngularDelta,
      peakPlaneAngularDelta,
      bodyPairAngularDeltaByBody: currentBodyPairAngularDelta,
      peakBodyPairAngularDelta,
      firstAngularSourceByBody,
      pairImpulseAudit: pairImpulseAudit ?? this.values.pairImpulseAudit,
      stageVelocity,
      cpuEmulator: cpuReport,
      maxContactSpeed: Math.max(...diagnostics.map((diagnostic) => diagnostic.speeds[0]), 0),
      maxNormalSpeed: Math.max(...diagnostics.map((diagnostic) => diagnostic.speeds[1]), 0),
      sleepEligibleCount: diagnostics.filter((diagnostic) => diagnostic.flagState.sleepEligible).length,
      quietContactCount: diagnostics.filter((diagnostic) => diagnostic.flagState.quietContact).length,
      supportCount: diagnostics.filter((diagnostic) => diagnostic.flagState.hasSupport).length,
      pairs
    });
  }

  // 一つの隣接pairについて接触法線速度、wake不足量、法線方向の簡易運動エネルギーを算出します
  // GPUの汎用contactVelocityとreadback形状接触を比較し、body ID対応表から対象を選びます
  measurePair(
    bodyAId,
    bodyBId,
    stateA,
    stateB,
    pairContacts,
    bodyADiagnostic,
    bodyBSlot,
    bodyBDiagnostic,
    bodyASlot,
    preStateA,
    preStateB,
    sampleSeconds
  ) {
    const previous = this.values.pairs.find((pair) => pair.bodyAId === bodyAId && pair.bodyBId === bodyBId);
    const aabbA = this.physics.getReadbackBodyAabb(stateA);
    const aabbB = this.physics.getReadbackBodyAabb(stateB);
    const gapX = Math.max(0, aabbB.min[0] - aabbA.max[0]);
    const relativeCenterX = stateB.position[0] - stateA.position[0];
    const previousRelativeCenterX = preStateA === null || preStateB === null
      ? null
      : preStateB.position[0] - preStateA.position[0];
    const closingSpeed = previousRelativeCenterX === null || sampleSeconds <= 0
      ? null
      : Math.max(0, (previousRelativeCenterX - relativeCenterX) / sampleSeconds);
    const result = {
      bodyAId,
      bodyBId,
      sleepingTarget: stateB.sleeping,
      contact: pairContacts.length > 0,
      pointAvailable: false,
      normalVelocity: null,
      approachSpeed: null,
      deficit: null,
      energy: null,
      wakeEnergy: null,
      energyDeficit: null,
      impactNormalVelocity: previous?.impactNormalVelocity ?? null,
      impactApproachSpeed: previous?.impactApproachSpeed ?? null,
      impactEnergy: previous?.impactEnergy ?? null,
      solverNormalVelocity: null,
      solverApproachSpeed: null,
      solverNormalImpulse: null,
      solverContactOtherSlot: null,
      solverBNormalVelocity: null,
      solverBApproachSpeed: null,
      solverBNormalImpulse: null,
      solverBContactNormal: null,
      solverBContactPoint: null,
      solverBPeakApproachSpeed: previous?.solverBPeakApproachSpeed ?? 0,
      solverBPeakNormalImpulse: previous?.solverBPeakNormalImpulse ?? 0,
      solverBPeakNormalVelocity: previous?.solverBPeakNormalVelocity ?? null,
      solverContactNormal: null,
      solverContactPoint: null,
      solverPeakContactNormal: previous?.solverPeakContactNormal ?? null,
      solverPeakContactPoint: previous?.solverPeakContactPoint ?? null,
      solverPeakApproachSpeed: previous?.solverPeakApproachSpeed ?? 0,
      solverPeakNormalImpulse: previous?.solverPeakNormalImpulse ?? 0,
      wakeCandidate: bodyBDiagnostic?.flagState.awakeContact ?? null,
      wakeBodySleeping: bodyBDiagnostic?.flagState.sleeping ?? null,
      wakeNormalVelocity: bodyBDiagnostic?.wakeVelocity?.[0] ?? null,
      wakeApproachSpeed: bodyBDiagnostic?.wakeVelocity?.[1] ?? null,
      wakeContactValid: bodyBDiagnostic?.wakeVelocity === undefined
        ? null
        : bodyBDiagnostic.wakeVelocity[2] > 0.5,
      wakeCandidateSlot: bodyBDiagnostic?.wakeVelocity?.[3] ?? null,
      wakePeakNormalVelocity: previous?.wakePeakNormalVelocity ?? null,
      wakePeakApproachSpeed: previous?.wakePeakApproachSpeed ?? 0,
      wakePeakContactValid: previous?.wakePeakContactValid ?? false,
      wakePeakCandidateSlot: previous?.wakePeakCandidateSlot ?? null,
      closingSpeed,
      peakClosingSpeed: Math.max(previous?.peakClosingSpeed ?? 0, closingSpeed ?? 0),
      peakApproachSpeed: previous?.peakApproachSpeed ?? 0,
      peakEnergy: previous?.peakEnergy ?? 0,
      gapX
    };
    const contactVelocity = bodyADiagnostic?.contactVelocity ?? null;
    const solverContactOtherSlot = contactVelocity === null || contactVelocity[3] < 0
      ? null
      : contactVelocity[3];
    if (solverContactOtherSlot === bodyBSlot) {
      result.solverNormalVelocity = contactVelocity[0];
      result.solverApproachSpeed = contactVelocity[1];
      result.solverNormalImpulse = contactVelocity[2];
      result.solverContactOtherSlot = solverContactOtherSlot;
      result.solverContactNormal = bodyADiagnostic.contactVelocityNormal.slice(0, 3);
      result.solverContactPoint = bodyADiagnostic.contactVelocityPoint.slice(0, 3);
      result.solverPeakApproachSpeed = Math.max(result.solverPeakApproachSpeed, contactVelocity[1]);
      result.solverPeakNormalImpulse = Math.max(result.solverPeakNormalImpulse, contactVelocity[2]);
      if (contactVelocity[1] >= result.solverPeakApproachSpeed) {
        result.solverPeakContactNormal = result.solverContactNormal;
        result.solverPeakContactPoint = result.solverContactPoint;
      }
    }
    const bodyBContactVelocity = bodyBDiagnostic?.contactVelocity ?? null;
    const solverBContactOtherSlot = bodyBContactVelocity === null || bodyBContactVelocity[3] < 0
      ? null
      : bodyBContactVelocity[3];
    if (solverBContactOtherSlot === bodyASlot) {
      result.solverBNormalVelocity = bodyBContactVelocity[0];
      result.solverBApproachSpeed = bodyBContactVelocity[1];
      result.solverBNormalImpulse = bodyBContactVelocity[2];
      result.solverBContactNormal = bodyBDiagnostic.contactVelocityNormal.slice(0, 3);
      result.solverBContactPoint = bodyBDiagnostic.contactVelocityPoint.slice(0, 3);
      result.solverBPeakApproachSpeed = Math.max(result.solverBPeakApproachSpeed, bodyBContactVelocity[1]);
      result.solverBPeakNormalVelocity = bodyBContactVelocity[0];
      result.solverBPeakNormalImpulse = Math.max(result.solverBPeakNormalImpulse, bodyBContactVelocity[2]);
    }
    const wakeVelocity = bodyBDiagnostic?.wakeVelocity ?? null;
    const wakeContactValid = wakeVelocity !== null && wakeVelocity[2] > 0.5;
    const wakeCandidateSlot = wakeVelocity === null || wakeVelocity[3] < 0 ? null : wakeVelocity[3];
    if (wakeCandidateSlot === bodyAId - 1 && wakeContactValid) {
      result.wakePeakContactValid = true;
      result.wakePeakCandidateSlot = wakeCandidateSlot;
      result.wakePeakApproachSpeed = Math.max(result.wakePeakApproachSpeed, wakeVelocity[1]);
      result.wakePeakNormalVelocity = result.wakePeakNormalVelocity === null
        ? wakeVelocity[0]
        : Math.min(result.wakePeakNormalVelocity, wakeVelocity[0]);
    }
    if (pairContacts.length === 0) return result;
    let selected = null;
    for (const contact of pairContacts) {
      if (!Array.isArray(contact.point) || contact.point.length !== 3) continue;
      const velocityA = contactPointVelocity(stateA, contact.point);
      const velocityB = contactPointVelocity(stateB, contact.point);
      const normalVelocity = dot3(subtract3(velocityB, velocityA), contact.normal);
      const approachSpeed = Math.max(0, -normalVelocity);
      if (selected === null || approachSpeed > selected.approachSpeed) {
        selected = { normalVelocity, approachSpeed, point: contact.point, normal: contact.normal };
      }
    }
    if (selected === null) return result;
    const massA = this.bodyInfo.get(bodyAId).mass;
    const massB = this.bodyInfo.get(bodyBId).mass;
    const reducedMass = (massA * massB) / (massA + massB);
    const energy = 0.5 * reducedMass * selected.approachSpeed ** 2;
    const wakeEnergy = 0.5 * reducedMass * this.wakeLinearThreshold ** 2;
    let impactNormalVelocity = null;
    let impactApproachSpeed = null;
    let impactEnergy = null;
    if (preStateA !== null && preStateB !== null && sampleSeconds > 0) {
      const previousVelocityA = contactPointVelocity(preStateA, selected.point);
      const previousVelocityB = contactPointVelocity(preStateB, selected.point);
      impactNormalVelocity = dot3(
        subtract3(previousVelocityB, previousVelocityA),
        selected.normal
      );
      impactApproachSpeed = Math.max(0, -impactNormalVelocity);
      impactEnergy = 0.5 * reducedMass * impactApproachSpeed ** 2;
    }
    return {
      ...result,
      pointAvailable: true,
      normalVelocity: selected.normalVelocity,
      approachSpeed: selected.approachSpeed,
      deficit: Math.max(0, this.wakeLinearThreshold - selected.approachSpeed),
      energy,
      wakeEnergy,
      energyDeficit: Math.max(0, wakeEnergy - energy),
      impactNormalVelocity,
      impactApproachSpeed,
      impactEnergy,
      peakApproachSpeed: Math.max(result.peakApproachSpeed, selected.approachSpeed, impactApproachSpeed ?? 0),
      peakEnergy: Math.max(result.peakEnergy, energy, impactEnergy ?? 0)
    };
  }

  // reset操作時に過去のpeak値を捨て、次の連鎖だけを比較対象へ戻します
  reset() {
    this.resetGeneration += 1;
    this.sampleCount = 0;
    this.readbackError = null;
    this.frameScheduled = false;
    this.pendingPreFixedStepCount = null;
    this.pendingPostFixedStepCount = null;
    this.pendingReadbackGeneration = null;
    this.values = this.createInitialValues();
  }

  // panelが参照する最新の完了値を返し、map完了済みの状態だけを公開します
  getValues() {
    return { ...this.values, error: this.readbackError };
  }

  // 外部診断専用のstate readback bufferだけを破棄し、通常描画用state bufferはphysics側へ残します
  destroy() {
    this.preReadbackBuffer.destroy();
    this.postReadbackBuffer.destroy();
  }
}
