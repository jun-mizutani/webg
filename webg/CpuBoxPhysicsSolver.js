// ---------------------------------------------
// CpuBoxPhysicsSolver.js  2026/09/13
//   Local CPU solver that mirrors the ComputePhysicsSpace path for the core CPU backend
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import ComputePlaneCollider from "./ComputePlaneCollider.js";
import {
  buildBoxContact as buildSharedBoxContact,
  createBoxPairAxisCache as createSharedBoxPairAxisCache
} from "./BoxContact.js";
import { isPlaneSupportProjectionBalanced } from "./PlaneBoxContact.js";
import { solvePhysicsContactImpulse, solvePhysicsRollingResistance } from "./PhysicsContactImpulseSolver.js";
import { buildDeltaQuaternionStep } from "./PhysicsMath.js";
import util from "./util.js";
import PhysicsMaterialPairs from './PhysicsMaterialPairs.js';

const EPSILON = 1.0e-8;
const DEFAULT_DIVERGENCE_LIMITS = Object.freeze({
  position: 1.0e-4,
  linear: 1.0e-3,
  angular: 1.0e-2,
  orientation: 1.0e-3
});

// CPU側のVec3演算を一箇所へ集め、GPUの接触式と同じ式を追跡しやすくします
// 配列長と有限値を検証し、呼出側の計算不成立をそのまま通知します
// 配列を新しく返し、solver途中の速度配列を別bodyの計算から分離します
function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// 位置、速度、角速度の差をGPUのvec3減算と同じ順序で計算します
function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// kinematicの搬送速度から法線成分を除き、接触点速度へ加える値を返します
// quasiStaticの通常linearVelocityを変更せず、摩擦だけへsurface velocityを渡します
function addSurfaceContactVelocity(base, body, normal) {
  if (body?.bodyType !== "kinematic") {
    return base;
  }
  const surfaceVelocity = body.surfaceVelocity ?? [0.0, 0.0, 0.0];
  const normalComponent = dot3(surfaceVelocity, normal);
  return [
    base[0] + surfaceVelocity[0] - normal[0] * normalComponent,
    base[1] + surfaceVelocity[1] - normal[1] * normalComponent,
    base[2] + surfaceVelocity[2] - normal[2] * normalComponent
  ];
}

// worldベクトルへscalarを掛け、impulseと位置補正の符号を呼出側へ残します
function scale3(value, scalar) {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

// 接触法線への射影を求め、法線速度とSATの分離判定で共通利用します
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// 接触点の腕とimpulseから角速度への寄与を求めます
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// 既存のVec3演算と同じ成分順で結果だけを再利用Vec3へ書き込みます
// 返り値を次の演算へ直接渡せるため、hot pathの一時配列を最小限に保ちます
function add3Into(output, a, b) {
  output[0] = a[0] + b[0];
  output[1] = a[1] + b[1];
  output[2] = a[2] + b[2];
  return output;
}

// 既存のVec3減算と同じ計算順で結果を再利用Vec3へ書き込みます
// 接触相対速度の計算ではscratch配列を再利用して割り当てを抑えます
function sub3Into(output, a, b) {
  output[0] = a[0] - b[0];
  output[1] = a[1] - b[1];
  output[2] = a[2] - b[2];
  return output;
}

// 既存の外積と同じ積・減算の順番で結果を再利用Vec3へ書き込みます
// normal、摩擦、作用点の外積を一つのscratch領域で順番に処理できます
function cross3Into(output, a, b) {
  output[0] = a[1] * b[2] - a[2] * b[1];
  output[1] = a[2] * b[0] - a[0] * b[2];
  output[2] = a[0] * b[1] - a[1] * b[0];
  return output;
}

// 速度ベクトルの大きさを求め、sleep閾値と接触残留速度を比較します
function length3(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

// 非zeroの接線基底だけを返し、zero vectorを別方向へ置き換えず計算不成立を検出します
function normalize3(value) {
  const length = length3(value);
  if (length <= EPSILON) throw new Error("CpuBoxPhysicsSolver vector must not be zero");
  return scale3(value, 1 / length);
}

// Plane法線から直交する2本の接線基底を作り、body pairの摩擦方向を法線から決めます
function computePlaneTangentBasis(normal) {
  const seed = Math.abs(normal[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0];
  const tangentA = normalize3(cross3(normal, seed));
  const tangentB = normalize3(cross3(normal, tangentA));
  return [tangentA, tangentB];
}

// 複数のPlane支持点がbody重心の投影を支えられるかを、GPUの辺・三角形判定と同じ順序で調べます
// 1点支持を安定支持へ置き換えず、重心投影が支持featureの内側にある場合だけtrueを返します
function computePlaneSupportBalance(activePoints, normal, position, tolerance, tangentBasis) {
  return isPlaneSupportProjectionBalanced(
    activePoints,
    normal,
    position,
    tolerance,
    tangentBasis
  );
}

// webgのquaternionは[w,x,y,z]順なので、GPUのvec4(x=scalar,yzw=vector)式を配列へ対応させます
// GPUとCPUで姿勢の成分順を取り違えると接触法線だけでなくBoxのAABBも変わるため、ここで固定します
// 二つの姿勢または角速度quaternionの積をGPUと同じ成分順で返します
function quatMultiply(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
  ];
}

// 姿勢の長さを検証して正規化し、正規化済みquaternionを返します
function quatNormalize(value) {
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  if (length <= EPSILON) throw new Error("CpuBoxPhysicsSolver quaternion must not be zero");
  return value.map((entry) => entry / length);
}

// worldからlocalへ戻すquaternion変換のため、姿勢の共役を返します
function quatConjugate(value) {
  return [value[0], -value[1], -value[2], -value[3]];
}

// local軸上のBox頂点や接触点をworld座標へ回転します
function quatRotate(orientation, value) {
  const rotated = quatMultiply(
    quatMultiply(orientation, [0, value[0], value[1], value[2]]),
    quatConjugate(orientation)
  );
  return rotated.slice(1, 4);
}

// rad/secのworld角速度から有限回転を作り、現在姿勢へΔqを左から掛けます
// 通常PhysicsSpaceの全形状経路と同じPhysicsMathの配列計算をBox solverでも使います
function integrateOrientationDeltaQuaternion(orientation, angularVelocity, dt) {
  return buildDeltaQuaternionStep(orientation, angularVelocity, dt);
}

// CPU Box solverへ渡された姿勢積分関数の結果を検証して単位quaternionへ揃えます
// 配列不足や非有限値を検証し、実験用積分の不成立をその場で通知します
function integrateOrientation(orientation, angularVelocity, dt, orientationIntegrator) {
  const next = orientationIntegrator(orientation, angularVelocity, dt);
  if (!Array.isArray(next) || next.length !== 4
      || next.some((value) => !Number.isFinite(value))) {
    throw new Error("CpuBoxPhysicsSolver orientation integrator must return four finite values");
  }
  return quatNormalize(next);
}

// readback比較用の配列を複製し、CPU stateの内部配列を保護します
function cloneArray(value) {
  return [...value];
}

// body stateの配列欄を複製し、source snapshotとnext stateを分離します
function cloneState(state) {
  return {
    ...state,
    position: cloneArray(state.position),
    orientation: cloneArray(state.orientation),
    linearVelocity: cloneArray(state.linearVelocity),
    angularVelocity: cloneArray(state.angularVelocity),
    surfaceVelocity: cloneArray(state.surfaceVelocity ?? [0.0, 0.0, 0.0])
  };
}

// fixed stepの接触観測値を複製し、solver scratchや内部lambda配列を保護します
function cloneObservedContact(contact) {
  return {
    ...contact,
    normal: cloneArray(contact.normal),
    point: cloneArray(contact.point),
    tangentImpulse: cloneArray(contact.tangentImpulse)
  };
}

// body pair、またはbodyとPlaneの組をfixed step間で追跡するkeyへ変換します
// 名前や配列slotではなく明示body IDを使い、Node登録順から独立して接触継続を判定します
function getObservedContactKey(contact) {
  if (contact.kind === "plane") {
    return `plane:${contact.bodyId}:${contact.planeIndex}`;
  }
  const firstId = Math.min(contact.bodyAId, contact.bodyBId);
  const secondId = Math.max(contact.bodyAId, contact.bodyBId);
  return `body:${firstId}:${secondId}`;
}

// B31のfixed step診断を複製し、最大角速度を記録したstepの値を後から比較できるようにします
function cloneStage(stage) {
  if (stage === null) return null;
  return {
    start: cloneArray(stage.start),
    afterB30: cloneArray(stage.afterB30),
    afterB32: cloneArray(stage.afterB32),
    afterPlane: cloneArray(stage.afterPlane),
    end: cloneArray(stage.end),
    events: cloneArray(stage.events)
  };
}

// 接触一回分の診断値を複製し、作用点・法線・角速度差を外部の解析処理へ安全に渡します
// 物理計算用の配列を複製し、readback比較と同じく診断側からsolver状態を保護します
function cloneImpulseAudit(audit) {
  if (audit === null) return null;
  return {
    ...audit,
    normal: cloneArray(audit.normal),
    point: cloneArray(audit.point),
    r: cloneArray(audit.r),
    normalImpulseVector: cloneArray(audit.normalImpulseVector),
    frictionImpulseVector: cloneArray(audit.frictionImpulseVector),
    angularBefore: cloneArray(audit.angularBefore),
    angularAfter: cloneArray(audit.angularAfter),
    normalAngularDelta: cloneArray(audit.normalAngularDelta),
    frictionAngularDelta: cloneArray(audit.frictionAngularDelta),
    angularDelta: cloneArray(audit.angularDelta)
  };
}

// 一body一fixed stepの接触履歴を複製し、後続bodyへ波及した順番を確認できるようにします
// body接触とPlane接触を別配列に保持し、発生源を配列の種類から判別できるようにします
function cloneBodyTrace(trace) {
  if (trace === null) return null;
  return {
    id: trace.id,
    start: cloneArray(trace.start),
    preContact: trace.preContact === null ? null : cloneArray(trace.preContact),
    bodyImpulses: trace.bodyImpulses.map(cloneImpulseAudit),
    planeImpulses: trace.planeImpulses.map(cloneImpulseAudit),
    end: trace.end === null ? null : cloneArray(trace.end),
    sleeping: trace.sleeping
  };
}

// 一fixed step内の全trace bodyを複製し、body間の角速度波及をstep単位で保存します
function cloneStepTrace(trace) {
  if (trace === null) return null;
  return {
    fixedStep: trace.fixedStep,
    bodies: trace.bodies.map(cloneBodyTrace)
  };
}

// GPUのBodyStateに必要な動的属性だけをdescriptorから取り出し、CPU専用counterと命令を分離します
// GPU readbackを内部stateへ混ぜず、CPUエミュレータが独立に進んだ結果を比較できるようにします
function buildState(descriptor, materialPairs) {
  const colliderKind = descriptor.collider?.getComputeColliderKind?.();
  if (colliderKind !== "box") {
    throw new Error(`CpuBoxPhysicsSolver supports only ComputeBoxCollider, got ${colliderKind ?? "unknown"}`);
  }
  const bodyType = descriptor.bodyType ?? "dynamic";
  const mass = Number(descriptor.mass);
  if (!Number.isFinite(mass) || mass <= 0) {
    throw new Error(`CpuBoxPhysicsSolver body ${descriptor.id} mass must be positive`);
  }
  const inverseMass = bodyType === "dynamic" ? 1 / mass : 0;
  const inverseInertia = descriptor.inverseInertiaLocal === undefined
    ? descriptor.collider.calculateInverseInertia(inverseMass)
    : [...descriptor.inverseInertiaLocal];
  const halfExtents = descriptor.collider.getHalfExtents();
  const material = materialPairs.material(descriptor.material ?? {}, descriptor.materialId);
  return {
    id: descriptor.id,
    bodyType,
    allowSleep: descriptor.allowSleep !== false,
    gravityScale: descriptor.gravityScale ?? 1,
    collisionLayer: descriptor.collisionLayer ?? 1,
    collisionMask: descriptor.collisionMask ?? 0xffffffff,
    inverseMass,
    inverseInertia,
    fixedRotation: descriptor.fixedRotation === true,
    halfExtents,
    material,
    restitution: material.restitution,
    friction: material.dynamicFriction,
    linearDamping: material.linearDamping ?? 0.08,
    angularDamping: material.angularDamping ?? 0.12,
    position: cloneArray(descriptor.position),
    orientation: quatNormalize(cloneArray(descriptor.orientation ?? [1, 0, 0, 0])),
    linearVelocity: cloneArray(descriptor.linearVelocity ?? [0, 0, 0]),
    angularVelocity: cloneArray(descriptor.angularVelocity ?? [0, 0, 0]),
    surfaceVelocity: cloneArray(descriptor.surfaceVelocity ?? [0, 0, 0]),
    sleeping: descriptor.isSleeping === true,
    sleepCounter: 0
  };
}

// CPU上でGPUのComputePlaneRecordと同じ五つの境界平面を作ります
// 平面を別の衝突厚へ置き換えず、normalとplaneDistanceの定義をそのまま再利用します
function createBoundaryPlanes(bounds) {
  const names = ["minX", "maxX", "minZ", "maxZ", "floorY"];
  if (!bounds || names.some((name) => !Number.isFinite(bounds[name]))) {
    throw new Error("CpuBoxPhysicsSolver bounds must contain finite minX, maxX, minZ, maxZ, and floorY");
  }
  return [
    new ComputePlaneCollider([0, 1, 0], { planeDistance: bounds.floorY }),
    new ComputePlaneCollider([1, 0, 0], { planeDistance: bounds.minX }),
    new ComputePlaneCollider([-1, 0, 0], { planeDistance: -bounds.maxX }),
    new ComputePlaneCollider([0, 0, 1], { planeDistance: bounds.minZ }),
    new ComputePlaneCollider([0, 0, -1], { planeDistance: -bounds.maxZ })
  ];
}

// PhysicsSpaceへ登録されたPlane Nodeを、solverが直接走査する固定Planeへ変換します
// planesを明示した場合は登録Planeだけを床・四壁として使い、同じ平面の接触を一つに保ちます
function createSolverPlanes(planes, bounds) {
  if (planes === undefined) {
    return createBoundaryPlanes(bounds);
  }
  if (!Array.isArray(planes)) {
    throw new Error("CpuBoxPhysicsSolver planes must be an array");
  }
  return planes.map((plane, index) => {
    if (!plane || typeof plane !== "object") {
      throw new Error(`CpuBoxPhysicsSolver planes[${index}] must be an object`);
    }
    if (!Array.isArray(plane.normal) || plane.normal.length !== 3) {
      throw new Error(`CpuBoxPhysicsSolver planes[${index}].normal must be a 3 element array`);
    }
    if (!Number.isFinite(plane.planeDistance)) {
      throw new Error(`CpuBoxPhysicsSolver planes[${index}].planeDistance must be finite`);
    }
    return new ComputePlaneCollider(plane.normal, {
      planeDistance: plane.planeDistance
    });
  });
}

// GPUのComputePhysicsSpaceと同じ物理順序でBoxのworld軸半径を計算します
// 姿勢の現在値と予測値を両方に渡すことで、回転中の候補を落とさないswept AABBになります
function computeBoxWorldRadius(state, orientation) {
  const axes = computeBoxAxes(orientation);
  return [
    Math.abs(axes[0][0]) * state.halfExtents[0]
      + Math.abs(axes[1][0]) * state.halfExtents[1]
      + Math.abs(axes[2][0]) * state.halfExtents[2],
    Math.abs(axes[0][1]) * state.halfExtents[0]
      + Math.abs(axes[1][1]) * state.halfExtents[1]
      + Math.abs(axes[2][1]) * state.halfExtents[2],
    Math.abs(axes[0][2]) * state.halfExtents[0]
      + Math.abs(axes[1][2]) * state.halfExtents[1]
      + Math.abs(axes[2][2]) * state.halfExtents[2]
  ];
}

// 正規化済み姿勢からBoxのlocal X/Y/Z軸を一度だけ作り、SAT・support・AABBで共有します
// 同じ姿勢のbody Bについて毎接触で軸を作り直さず、計算式と軸の順序はGPU版に合わせます
function computeBoxAxes(orientation) {
  return [
    quatRotate(orientation, [1, 0, 0]),
    quatRotate(orientation, [0, 1, 0]),
    quatRotate(orientation, [0, 0, 1])
  ];
}

// 既存のworld軸を使ってBox頂点を再利用領域へ書き込み、position correction後のA頂点だけを作り直せるようにします
// 各成分の演算順は元のscale3とadd3の順を保ち、extentへの符号乗算を軸の乗算より先に行います
function computeBoxCornersInto(output, state, position, orientation, axes = null) {
  const resolvedAxes = axes ?? computeBoxAxes(orientation);
  const corners = output ?? Array.from({ length: 8 }, () => [0, 0, 0]);
  for (let index = 0; index < 8; index++) {
    const signX = (index & 1) !== 0 ? 1 : -1;
    const signY = (index & 2) !== 0 ? 1 : -1;
    const signZ = (index & 4) !== 0 ? 1 : -1;
    const offsetX = state.halfExtents[0] * signX;
    const offsetY = state.halfExtents[1] * signY;
    const offsetZ = state.halfExtents[2] * signZ;
    const corner = corners[index];
    const afterX0 = position[0] + resolvedAxes[0][0] * offsetX;
    const afterX1 = position[1] + resolvedAxes[0][1] * offsetX;
    const afterX2 = position[2] + resolvedAxes[0][2] * offsetX;
    const afterY0 = afterX0 + resolvedAxes[1][0] * offsetY;
    const afterY1 = afterX1 + resolvedAxes[1][1] * offsetY;
    const afterY2 = afterX2 + resolvedAxes[1][2] * offsetY;
    corner[0] = afterY0 + resolvedAxes[2][0] * offsetZ;
    corner[1] = afterY1 + resolvedAxes[2][1] * offsetZ;
    corner[2] = afterY2 + resolvedAxes[2][2] * offsetZ;
  }
  return corners;
}

// Box頂点を新しい配列へ生成する互換入口を残し、geometry cacheと既存の呼出側の形式を維持します
// hot pathだけがcomputeBoxCornersIntoを渡して固定数の頂点配列を再利用します
function computeBoxCorners(state, position, orientation, axes = null) {
  return computeBoxCornersInto(null, state, position, orientation, axes);
}

// source snapshotのbody geometryを保存し、solver反復間で変化しないB側の軸・頂点を共有します
// position correctionで位置が動くA側はこのcacheへ入れず、接触処理の直前に現在positionから生成します
function createBoxGeometry(state, position = state.position, orientation = state.orientation) {
  const normalizedOrientation = quatNormalize(orientation);
  const axes = computeBoxAxes(normalizedOrientation);
  return {
    orientation: normalizedOrientation,
    axes,
    corners: computeBoxCorners(state, position, normalizedOrientation, axes),
    inverseInertiaOperator: createInverseInertiaOperator(
      normalizedOrientation, state.inverseInertia, axes
    )
  };
}

// CPU solverのstateを共通BoxContact入力へ変換し、core colliderと同じgeometry形式へ揃えます
// position correction中のAとsource snapshotのBを別々のcenterとして渡せるようにします
function createSharedBoxInput(state, position, orientation, geometry = null) {
  const resolvedOrientation = geometry?.orientation ?? quatNormalize(orientation);
  const axes = geometry?.axes ?? computeBoxAxes(resolvedOrientation);
  const corners = geometry?.corners ?? computeBoxCorners(
    state,
    position,
    resolvedOrientation,
    axes
  );
  return {
    center: position,
    half: state.halfExtents,
    axes,
    corners
  };
}

// shared BoxContactの最小軸とsupport feature中点を既存solverの呼出形式へ接続します
// CPU referenceで実績のある一接触点経路をcore側でも同じ形状関数から生成します
function computeBoxContact(
  bodyA,
  positionA,
  orientationA,
  bodyB,
  tolerance,
  geometryA = null,
  geometryB = null,
  axisCache = null
) {
  const boxA = createSharedBoxInput(bodyA, positionA, orientationA, geometryA);
  const boxB = createSharedBoxInput(bodyB, bodyB.position, bodyB.orientation, geometryB);
  return buildSharedBoxContact(boxA, boxB, tolerance, axisCache);
}

// 仮想position状態だけへ拘束補正を適用し、physical velocityはsolverの力積で更新します
// scalarの符号はbody pairのA/B方向を呼出側で指定し、診断用には補正距離だけを返します
function applyPositionCorrection(position, normal, penetration, scalar, config) {
  const magnitude = Math.max(penetration - config.positionSlop, 0) * config.positionCorrectionBeta;
  const signedMagnitude = magnitude * scalar;
  position[0] += normal[0] * signedMagnitude;
  position[1] += normal[1] * signedMagnitude;
  position[2] += normal[2] * signedMagnitude;
  return Math.abs(signedMagnitude);
}

// 固定された姿勢とlocal逆慣性から、world空間で使う3本の主軸を一度だけ作ります
// 同じ姿勢のbodyへ毎contactでquaternion変換を繰り返さず、法線・摩擦の式だけを反復します
function createInverseInertiaOperator(orientation, inverseInertia, axes = null) {
  return {
    axes: axes ?? computeBoxAxes(orientation),
    inverseInertia
  };
}

// worldベクトルへ逆慣性を適用し、GPUのR * D * transpose(R) * valueを同じ意味で計算します
// local主軸をworldへ移した結果を再利用し、毎回のquaternion積とlocal配列生成を省きます
function applyInverseInertia(operator, value) {
  const axisX = operator.axes[0];
  const axisY = operator.axes[1];
  const axisZ = operator.axes[2];
  const localX = dot3(axisX, value) * operator.inverseInertia[0];
  const localY = dot3(axisY, value) * operator.inverseInertia[1];
  const localZ = dot3(axisZ, value) * operator.inverseInertia[2];
  return [
    axisX[0] * localX + axisY[0] * localY + axisZ[0] * localZ,
    axisX[1] * localX + axisY[1] * localY + axisZ[1] * localZ,
    axisX[2] * localX + axisY[2] * localY + axisZ[2] * localZ
  ];
}

// 逆慣性の計算結果を指定されたVec3へ書き込み、contactごとの中間配列を増やさないようにします
// 数式と主軸の順序はapplyInverseInertiaと同じにし、呼出側が次の計算前に必要な値を複製します
function applyInverseInertiaInto(operator, value, output) {
  const axisX = operator.axes[0];
  const axisY = operator.axes[1];
  const axisZ = operator.axes[2];
  const localX = dot3(axisX, value) * operator.inverseInertia[0];
  const localY = dot3(axisY, value) * operator.inverseInertia[1];
  const localZ = dot3(axisZ, value) * operator.inverseInertia[2];
  output[0] = axisX[0] * localX + axisY[0] * localY + axisZ[0] * localZ;
  output[1] = axisX[1] * localX + axisY[1] * localY + axisZ[1] * localZ;
  output[2] = axisX[2] * localX + axisY[2] * localY + axisZ[2] * localZ;
  return output;
}

// contact solverの一body内で連続利用するVec3をまとめ、各contactのGC対象を固定数へ抑えます
// body間で同時に参照される値はなく、impulse auditが必要な場合だけ呼出側で複製します
function createContactScratch() {
  return {
    corners: Array.from({ length: 8 }, () => [0, 0, 0]),
    projections: new Array(8),
    activePoints: [],
    supportSum: [0, 0, 0],
    supportPoint: [0, 0, 0],
    rA: [0, 0, 0],
    rB: [0, 0, 0],
    velocityA: [0, 0, 0],
    velocityB: [0, 0, 0],
    relative: [0, 0, 0],
    contactVelocity: [0, 0, 0],
    postRelative: [0, 0, 0],
    tangentVelocity: [0, 0, 0],
    residualVelocity: [0, 0, 0],
    crossA: [0, 0, 0],
    crossB: [0, 0, 0],
    inverseA: [0, 0, 0],
    inverseB: [0, 0, 0],
    angularA: [0, 0, 0],
    angularB: [0, 0, 0],
    angularTangentA: [0, 0, 0],
    angularTangentB: [0, 0, 0],
    angularTangentA2: [0, 0, 0],
    angularTangentB2: [0, 0, 0],
    impulse: [0, 0, 0],
    frictionImpulse: [0, 0, 0],
    normalAngularDelta: [0, 0, 0],
    frictionAngularDelta: [0, 0, 0]
  };
}

// GPUのworld/local逆慣性変換をCPU側へ写し、角速度へのimpulse効果を同じ向きで計算します
// fixedRotationやstatic bodyはinverseInertiaが0なので、同じ式で角速度差分を計算します
function inverseInertiaApply(orientation, inverseInertia, value) {
  return applyInverseInertia(createInverseInertiaOperator(orientation, inverseInertia), value);
}

// GPUの次step予測BodyStateを作り、sleep bodyのwake判定とwake後solverへ同じ相手速度を渡します
// 現在の相手stateだけを使う判定へ戻さず、重力・命令・減衰・移動を順に適用します
function predictWakeBody(body, command, config, dt, gravity) {
  const predicted = cloneState(body);
  let linearVelocity = cloneArray(body.linearVelocity);
  let angularVelocity = cloneArray(body.angularVelocity);
  if (body.bodyType === "dynamic") {
    linearVelocity = add3(
      add3(linearVelocity, scale3(gravity, body.gravityScale * dt)),
      scale3(command.linearImpulse, body.inverseMass)
    );
    angularVelocity = add3(
      angularVelocity,
      inverseInertiaApply(body.orientation, body.inverseInertia, command.angularImpulse)
    );
  }
  linearVelocity = scale3(linearVelocity, Math.exp(-body.linearDamping * dt));
  angularVelocity = scale3(angularVelocity, Math.exp(-body.angularDamping * dt));
  predicted.position = add3(body.position, scale3(linearVelocity, dt));
  predicted.orientation = integrateOrientation(
    body.orientation,
    angularVelocity,
    dt,
    config.orientationIntegrator
  );
  predicted.linearVelocity = linearVelocity;
  predicted.angularVelocity = angularVelocity;
  return predicted;
}

// GPUの一fixed step予測AABBを作り、XZ Gridとswept Yの最終候補条件をCPUで再現します
// 全pairを候補判定してからsolverへ渡し、GPUと同じく候補接触だけを計算します
function buildPredictedAabbs(states, commands, config) {
  const result = states.map((body, index) => {
    const orientation = quatNormalize(body.orientation);
    const sleeping = config.persistentSleep && body.sleeping;
    const moves = body.bodyType === "dynamic" && !sleeping;
    const command = commands[index];
    const predictedVelocity = moves
      ? add3(
        add3(body.linearVelocity, scale3(config.gravity, body.gravityScale * config.dt)),
        scale3(command.linearImpulse, body.inverseMass)
      )
      : [0, 0, 0];
    const predictedPosition = moves
      ? add3(body.position, scale3(predictedVelocity, config.dt))
      : cloneArray(body.position);
    const predictedOrientation = moves
      ? integrateOrientation(
        orientation,
        body.angularVelocity,
        config.dt,
        config.orientationIntegrator
      )
      : orientation;
    const currentRadius = computeBoxWorldRadius(body, orientation);
    const predictedRadius = computeBoxWorldRadius(body, predictedOrientation);
    const padding = config.broadphasePadding;
    return {
      minX: Math.min(body.position[0] - currentRadius[0], predictedPosition[0] - predictedRadius[0]) - padding,
      minZ: Math.min(body.position[2] - currentRadius[2], predictedPosition[2] - predictedRadius[2]) - padding,
      maxX: Math.max(body.position[0] + currentRadius[0], predictedPosition[0] + predictedRadius[0]) + padding,
      maxZ: Math.max(body.position[2] + currentRadius[2], predictedPosition[2] + predictedRadius[2]) + padding,
      minY: Math.min(body.position[1] - currentRadius[1], predictedPosition[1] - predictedRadius[1]) - padding,
      maxY: Math.max(body.position[1] + currentRadius[1], predictedPosition[1] + predictedRadius[1]) + padding
    };
  });
  return result;
}

// world座標をCompute版と同じ端cellを含む整数Grid座標へ変換します
// bounds外も端cellへ集約し、境界近くの接触候補をGridへ保持します
function getGridCoordinate(value, origin, cellSize, gridSize) {
  if (!Number.isFinite(value) || !Number.isFinite(origin) || !Number.isFinite(cellSize)) {
    throw new Error("CpuBoxPhysicsSolver Grid coordinate must be finite");
  }
  if (cellSize <= 0) {
    throw new Error("CpuBoxPhysicsSolver Grid cellSize must be positive");
  }
  const coordinate = Math.floor((value - origin) / cellSize);
  return Math.max(0, Math.min(gridSize - 1, coordinate));
}

// swept AABBが占めるXZ cell範囲を計算し、GPUのcellRangeと同じ範囲をCPUへ写します
// YはGrid登録に使わず、cell候補を統合した後の最終判定で別に検査します
function getGridRange(aabb, bounds, gridSize) {
  const cellSizeX = (bounds.maxX - bounds.minX) / gridSize;
  const cellSizeZ = (bounds.maxZ - bounds.minZ) / gridSize;
  return {
    minX: getGridCoordinate(aabb.minX, bounds.minX, cellSizeX, gridSize),
    minZ: getGridCoordinate(aabb.minZ, bounds.minZ, cellSizeZ, gridSize),
    maxX: getGridCoordinate(aabb.maxX, bounds.minX, cellSizeX, gridSize),
    maxZ: getGridCoordinate(aabb.maxZ, bounds.minZ, cellSizeZ, gridSize)
  };
}

// XZ Gridへbodyを登録し、cellが重なるbodyだけをBroad Phase候補へ渡します
// GPUのatomic bitsetをMapとSetで置き換えますが、body slot昇順へ戻して接触処理順を固定します
function buildCandidates(states, aabbs, config) {
  const grid = new Map();
  const addToCell = (cell, bodyIndex) => {
    let entries = grid.get(cell);
    if (entries === undefined) {
      entries = [];
      grid.set(cell, entries);
    }
    entries.push(bodyIndex);
  };

  for (let bodyIndex = 0; bodyIndex < states.length; bodyIndex++) {
    // static Boxもdynamicまたはkinematic Boxの接触相手になるためGridへ登録します
    const range = getGridRange(aabbs[bodyIndex], config.bounds, config.gridSize);
    for (let z = range.minZ; z <= range.maxZ; z++) {
      for (let x = range.minX; x <= range.maxX; x++) {
        addToCell(z * config.gridSize + x, bodyIndex);
      }
    }
  }

  const candidates = states.map(() => []);
  for (let bodyA = 0; bodyA < states.length; bodyA++) {
    if (states[bodyA].bodyType === "static") continue;

    const range = getGridRange(aabbs[bodyA], config.bounds, config.gridSize);
    const candidateSet = new Set();
    for (let z = range.minZ; z <= range.maxZ; z++) {
      for (let x = range.minX; x <= range.maxX; x++) {
        const entries = grid.get(z * config.gridSize + x);
        if (entries === undefined) continue;
        for (const bodyB of entries) candidateSet.add(bodyB);
      }
    }

    // bitsetのword/bit走査と同じbody slot順に整列し、決定的な候補順を使います
    const orderedCandidates = [...candidateSet].sort((first, second) => first - second);
    for (const bodyB of orderedCandidates) {
      // static Boxもdynamic Boxの接触相手になれるため、Planeと同じくcandidateへ残します
      // static側のlocal invocationを保持し、dynamic側のlocal invocationだけが接触を解きます
      if (bodyA === bodyB) continue;
      const a = aabbs[bodyA];
      const b = aabbs[bodyB];
      const controlPair = (states[bodyA].collisionLayer & states[bodyB].collisionMask) !== 0
        && (states[bodyB].collisionLayer & states[bodyA].collisionMask) !== 0;
      const firstId = Math.min(states[bodyA].id, states[bodyB].id);
      const secondId = Math.max(states[bodyA].id, states[bodyB].id);
      const pairExcluded = config.excludedBodyPairKeys?.has(`${firstId}:${secondId}`) === true;
      const overlaps = a.minX <= b.maxX && b.minX <= a.maxX
        && a.minZ <= b.maxZ && b.minZ <= a.maxZ
        && a.minY <= b.maxY && b.minY <= a.maxY;
      if (controlPair && !pairExcluded && overlaps) candidates[bodyA].push(bodyB);
    }
  }
  return candidates;
}

// Compute版Plane solverのBox support点、法線impulse、摩擦impulse、位置補正を一回分実行します
// fixed step内の累積力積を受け取り、反復ごとに差分だけを速度へ加えます
function solvePlaneContact(
  body,
  position,
  orientation,
  plane,
  planeIndex,
  linearVelocity,
  angularVelocity,
  iteration,
  config,
  accumulator,
  inverseInertiaOperator,
  tangentBasis,
  traceEnabled = false,
  scratch,
  axes = null
) {
  const normal = plane.normal;
  const corners = computeBoxCornersInto(scratch.corners, body, position, orientation, axes);
  const projections = scratch.projections;
  let minimum = Infinity;
  for (let index = 0; index < corners.length; index += 1) {
    const projection = dot3(corners[index], normal);
    projections[index] = projection;
    minimum = Math.min(minimum, projection);
  }
  const penetration = plane.planeDistance - minimum;
  if (penetration <= 0) {
    accumulator.normalLambda = 0;
    accumulator.tangentLambdaA = 0;
    accumulator.tangentLambdaB = 0;
    delete accumulator.targetNormalVelocity;
    delete accumulator.rollingLambda;
    return {
      supportCount: 0,
      normalImpulseApplied: false,
      supportImpulseY: 0,
      contactSpeed: 0,
      normalSpeed: 0,
      linearVelocity,
      angularVelocity,
      positionCorrection: null,
      impulseAudit: null,
      observedContact: null
    };
  }
  const supportLimit = plane.planeDistance + config.positionSlop;
  let supportCount = 0;
  const activePoints = scratch.activePoints;
  activePoints.length = 0;
  for (let index = 0; index < corners.length; index += 1) {
    if (projections[index] <= supportLimit) {
      supportCount += 1;
      activePoints.push(corners[index]);
    }
  }
  if (activePoints.length === 0) {
    throw new Error(
      `CpuBoxPhysicsSolver Plane contact has no active support point: planeDistance=${plane.planeDistance} minimum=${minimum} projections=${projections.join(",")}`
    );
  }
  // 重心投影が複数支持の内側にある場合は、支持点へ分配された合力を重心投影へ集約します
  // 1点支持または重心投影が支持範囲外の場合は実接触corner中心を使い、転倒回転を保持します
  const supportBalanced = computePlaneSupportBalance(
    activePoints, normal, position, config.positionSlop, tangentBasis
  );
  const supportPoint = scratch.supportPoint;
  if (supportBalanced) {
    supportPoint[0] = position[0];
    supportPoint[1] = position[1];
    supportPoint[2] = position[2];
  } else {
    const supportSum = scratch.supportSum;
    supportSum[0] = 0;
    supportSum[1] = 0;
    supportSum[2] = 0;
    for (const point of activePoints) {
      supportSum[0] += point[0];
      supportSum[1] += point[1];
      supportSum[2] += point[2];
    }
    supportPoint[0] = supportSum[0] / activePoints.length;
    supportPoint[1] = supportSum[1] / activePoints.length;
    supportPoint[2] = supportSum[2] / activePoints.length;
  }
  const supportOffset = plane.planeDistance - dot3(supportPoint, normal);
  supportPoint[0] += normal[0] * supportOffset;
  supportPoint[1] += normal[1] * supportOffset;
  supportPoint[2] += normal[2] * supportOffset;
  const r = sub3Into(scratch.rA, supportPoint, position);
  let contactVelocity = add3Into(
    scratch.contactVelocity,
    linearVelocity,
    cross3Into(scratch.crossA, angularVelocity, r)
  );
  const normalVelocity = dot3(contactVelocity, normal);
  const pair = config.materialPairs.resolve(body.material, plane.material, Math.max(0, -normalVelocity));
  if (accumulator.targetNormalVelocity === undefined) {
    accumulator.targetNormalVelocity = normalVelocity < -config.restingRestitutionSpeed
      ? -pair.restitution * normalVelocity : 0;
  }
  let normalImpulseApplied = accumulator.normalLambda > EPSILON;
  const frictionImpulse = scratch.frictionImpulse;
  frictionImpulse[0] = 0;
  frictionImpulse[1] = 0;
  frictionImpulse[2] = 0;
  let normalImpulseMagnitude = accumulator.normalLambda;
  let denominator = 0;
  let restitution = 0;
  let tangentSpeed = 0;
  let unrestricted = 0;
  let frictionLimit = accumulator.normalLambda * pair.staticFriction;
  let normalImpulseVector = traceEnabled ? [0, 0, 0] : null;
  let frictionImpulseVector = traceEnabled ? [0, 0, 0] : null;
  const normalAngularDelta = scratch.normalAngularDelta;
  const frictionAngularDelta = scratch.frictionAngularDelta;
  const angularBefore = traceEnabled ? cloneArray(angularVelocity) : null;
  normalAngularDelta[0] = 0;
  normalAngularDelta[1] = 0;
  normalAngularDelta[2] = 0;
  frictionAngularDelta[0] = 0;
  frictionAngularDelta[1] = 0;
  frictionAngularDelta[2] = 0;
  if (normalVelocity < 0) {
    const angular = cross3Into(
      scratch.angularA,
      applyInverseInertiaInto(
        inverseInertiaOperator,
        cross3Into(scratch.crossA, r, normal),
        scratch.inverseA
      ),
      r
    );
    denominator = body.inverseMass + dot3(angular, normal);
    if (denominator > 1.0e-7) {
      restitution = pair.restitution;
      const targetNormalVelocity = iteration === 0
        ? accumulator.targetNormalVelocity
        : 0;
      const deltaLambda = -(normalVelocity - targetNormalVelocity) / denominator;
      const previousLambda = accumulator.normalLambda;
      const nextLambda = Math.max(previousLambda + deltaLambda, 0);
      const appliedLambda = nextLambda - previousLambda;
      accumulator.normalLambda = nextLambda;
      normalImpulseMagnitude = nextLambda;
      normalImpulseApplied = nextLambda > EPSILON;
      if (Math.abs(appliedLambda) > EPSILON) {
        const impulse = scratch.impulse;
        impulse[0] = normal[0] * appliedLambda;
        impulse[1] = normal[1] * appliedLambda;
        impulse[2] = normal[2] * appliedLambda;
        if (traceEnabled) normalImpulseVector = cloneArray(impulse);
        linearVelocity[0] += impulse[0] * body.inverseMass;
        linearVelocity[1] += impulse[1] * body.inverseMass;
        linearVelocity[2] += impulse[2] * body.inverseMass;
        const inverseImpulse = applyInverseInertiaInto(
          inverseInertiaOperator,
          cross3Into(scratch.crossA, r, impulse),
          scratch.inverseA
        );
        normalAngularDelta[0] = inverseImpulse[0];
        normalAngularDelta[1] = inverseImpulse[1];
        normalAngularDelta[2] = inverseImpulse[2];
        angularVelocity[0] += normalAngularDelta[0];
        angularVelocity[1] += normalAngularDelta[1];
        angularVelocity[2] += normalAngularDelta[2];
      }
    }
  }
  // 累積法線力積がある接触だけで摩擦を解き、摩擦力積が法線力を越えないようにします
  if (accumulator.normalLambda > EPSILON) {
    const tangentA = tangentBasis[0];
    const tangentB = tangentBasis[1];
    contactVelocity = add3Into(
      scratch.contactVelocity,
      linearVelocity,
      cross3Into(scratch.crossA, angularVelocity, r)
    );
    const normalTangentComponent = dot3(contactVelocity, normal);
    const tangentVelocity = scratch.tangentVelocity;
    tangentVelocity[0] = contactVelocity[0] - normal[0] * normalTangentComponent;
    tangentVelocity[1] = contactVelocity[1] - normal[1] * normalTangentComponent;
    tangentVelocity[2] = contactVelocity[2] - normal[2] * normalTangentComponent;
    tangentSpeed = length3(tangentVelocity);
    if (tangentSpeed > EPSILON) {
      const angularTangentA = cross3Into(
        scratch.angularTangentA,
        applyInverseInertiaInto(
          inverseInertiaOperator,
          cross3Into(scratch.crossA, r, tangentA),
          scratch.inverseA
        ),
        r
      );
      const angularTangentB = cross3Into(
        scratch.angularTangentB,
        applyInverseInertiaInto(
          inverseInertiaOperator,
          cross3Into(scratch.crossA, r, tangentB),
          scratch.inverseA
        ),
        r
      );
      const denominatorA = body.inverseMass
        + angularTangentA[0] * tangentA[0]
        + angularTangentA[1] * tangentA[1]
        + angularTangentA[2] * tangentA[2];
      const denominatorB = body.inverseMass
        + angularTangentB[0] * tangentB[0]
        + angularTangentB[1] * tangentB[1]
        + angularTangentB[2] * tangentB[2];
      const deltaA = denominatorA > 1.0e-7
        ? -dot3(contactVelocity, tangentA) / denominatorA
        : 0;
      const deltaB = denominatorB > 1.0e-7
        ? -dot3(contactVelocity, tangentB) / denominatorB
        : 0;
      const requestedA = accumulator.tangentLambdaA + deltaA;
      const requestedB = accumulator.tangentLambdaB + deltaB;
      const requestedLength = Math.hypot(requestedA, requestedB);
      const staticLimit = accumulator.normalLambda * pair.staticFriction;
      frictionLimit = requestedLength <= staticLimit ? staticLimit
        : accumulator.normalLambda * pair.dynamicFriction;
      const tangentScale = requestedLength > frictionLimit && requestedLength > EPSILON
        ? frictionLimit / requestedLength
        : 1;
      const nextA = requestedA * tangentScale;
      const nextB = requestedB * tangentScale;
      const appliedA = nextA - accumulator.tangentLambdaA;
      const appliedB = nextB - accumulator.tangentLambdaB;
      accumulator.tangentLambdaA = nextA;
      accumulator.tangentLambdaB = nextB;
      unrestricted = Math.hypot(deltaA, deltaB);
      frictionImpulse[0] = tangentA[0] * appliedA + tangentB[0] * appliedB;
      frictionImpulse[1] = tangentA[1] * appliedA + tangentB[1] * appliedB;
      frictionImpulse[2] = tangentA[2] * appliedA + tangentB[2] * appliedB;
      if (traceEnabled) frictionImpulseVector = cloneArray(frictionImpulse);
      linearVelocity[0] += frictionImpulse[0] * body.inverseMass;
      linearVelocity[1] += frictionImpulse[1] * body.inverseMass;
      linearVelocity[2] += frictionImpulse[2] * body.inverseMass;
      const inverseFriction = applyInverseInertiaInto(
        inverseInertiaOperator,
        cross3Into(scratch.crossA, r, frictionImpulse),
        scratch.inverseA
      );
      frictionAngularDelta[0] = inverseFriction[0];
      frictionAngularDelta[1] = inverseFriction[1];
      frictionAngularDelta[2] = inverseFriction[2];
      angularVelocity[0] += frictionAngularDelta[0];
      angularVelocity[1] += frictionAngularDelta[1];
      angularVelocity[2] += frictionAngularDelta[2];
    }
  }
  solvePhysicsRollingResistance({ normal, normalLambda: accumulator.normalLambda,
    length: pair.rollingResistanceLength, accumulator,
    local: { angularVelocity }, other: { angularVelocity: [0, 0, 0], sleeping: true },
    getAngularVelocity: state => state.angularVelocity,
    applyInverseInertia: (_state, impulse) => applyInverseInertia(inverseInertiaOperator, impulse),
    applyAngularImpulse: (state, impulse) => {
      const delta = applyInverseInertia(inverseInertiaOperator, impulse);
      for (let axis = 0; axis < 3; axis++) state.angularVelocity[axis] += delta[axis];
    }
  });
  const residualVelocity = add3Into(
    scratch.residualVelocity,
    linearVelocity,
    cross3Into(scratch.crossA, angularVelocity, r)
  );
  const positionCorrection = applyPositionCorrection(
    position,
    normal,
    penetration,
    1,
    config
  );
  return {
    supportCount,
    normalImpulseApplied,
    supportImpulseY: Math.abs(normal[1]) <= 0.5 ? Math.max(frictionImpulse[1], 0) : 0,
    contactSpeed: normalImpulseApplied ? length3(residualVelocity) : 0,
    normalSpeed: normalImpulseApplied ? Math.abs(dot3(residualVelocity, normal)) : 0,
    linearVelocity,
    angularVelocity,
    positionCorrection,
    observedContact: iteration + 1 >= config.solverIterations
      ? {
        normal: cloneArray(normal),
        point: cloneArray(supportPoint),
        penetration,
        normalImpulse: accumulator.normalLambda,
        tangentImpulse: add3(
          scale3(tangentBasis[0], accumulator.tangentLambdaA),
          scale3(tangentBasis[1], accumulator.tangentLambdaB)
        )
      }
      : null,
    impulseAudit: traceEnabled && normalImpulseApplied
      ? {
        kind: "plane",
        planeIndex,
        iteration: iteration + 1,
        normal,
        point: cloneArray(supportPoint),
        r: cloneArray(r),
        normalImpulseVector,
        frictionImpulseVector,
        normalVelocity,
        denominator,
        normalImpulse: normalImpulseMagnitude,
        restitution,
        tangentSpeed,
        unrestricted,
        frictionLimit,
        frictionImpulse: length3(frictionImpulse),
        angularBefore,
        angularAfter: cloneArray(angularVelocity),
        normalAngularDelta,
        frictionAngularDelta,
        angularDelta: sub3(angularVelocity, angularBefore)
      }
      : null
  };
}

// 実績済みCompute solverのlocal contactを共通kernelへ渡します
// other bodyはGPUと同じstep開始snapshotから読み、A側の局所速度だけを更新します
function solveBodyContact(
  body,
  other,
  otherIndex,
  position,
  orientation,
  linearVelocity,
  angularVelocity,
  iteration,
  config,
  accumulator,
  contactOverride = null,
  geometryB,
  inverseInertiaA,
  inverseInertiaB,
  axisCache = null,
  traceEnabled = false,
  scratch
) {
  const contact = contactOverride ?? computeBoxContact(
    body,
    position,
    orientation,
    other,
    config.supportFeatureTolerance,
    null,
    geometryB,
    axisCache
  );
  if (contact === null) {
    delete accumulator.targetNormalVelocity;
    delete accumulator.rollingLambda;
    accumulator.normalLambda = 0.0;
    accumulator.tangentLambdaA = 0.0;
    accumulator.tangentLambdaB = 0.0;
    return {
      support: false,
      normalImpulseApplied: false,
      impulseApplied: false,
      contactSpeed: 0.0,
      normalSpeed: 0.0,
      otherIndex,
      linearVelocity,
      angularVelocity,
      positionCorrection: null,
      impulseAudit: null
    };
  }

  const local = {
    material: body.material,
    position,
    linearVelocity,
    angularVelocity,
    inverseMass: body.inverseMass,
    positionInverseMass: body.inverseMass,
    restitution: body.restitution,
    friction: body.friction,
    sleeping: body.sleeping,
    bodyType: body.bodyType,
    surfaceVelocity: body.surfaceVelocity,
    inverseInertiaOperator: inverseInertiaA
  };
  const snapshotOther = {
    material: other.material,
    position: other.position,
    linearVelocity: other.linearVelocity,
    angularVelocity: other.angularVelocity,
    inverseMass: other.inverseMass,
    positionInverseMass: other.inverseMass,
    restitution: other.restitution,
    friction: other.friction,
    sleeping: other.sleeping,
    bodyType: other.bodyType,
    surfaceVelocity: other.surfaceVelocity,
    inverseInertiaOperator: inverseInertiaB
  };
  const result = solvePhysicsContactImpulse({
    materialPairs: config.materialPairs,
    applyInverseInertia: (state, impulse) => applyInverseInertia(state.inverseInertiaOperator, impulse),
    applyAngularImpulse: (state, impulse) => {
      const delta = applyInverseInertia(state.inverseInertiaOperator, impulse);
      for (let axis = 0; axis < 3; axis++) state.angularVelocity[axis] += delta[axis];
    },
    local,
    other: snapshotOther,
    normal: contact.normal,
    point: contact.point,
    penetration: contact.penetration,
    iteration,
    solverIterations: config.solverIterations,
    restingRestitutionSpeed: config.restingRestitutionSpeed,
    revisitBodyContactImpulses: config.revisitBodyContactImpulses,
    accumulator,
    positionCorrectionSlop: config.positionSlop,
    positionCorrectionBeta: config.positionCorrectionBeta,
    tangentBasis: contact.tangentBasis ?? null,
    normalize: normalize3,
    getContactPointVelocity: (state, arm) => addSurfaceContactVelocity(
      add3(state.linearVelocity, cross3(state.angularVelocity, arm)),
      state,
      contact.normal
    ),
    getAngularContribution: (state, arm, direction) => cross3(
      applyInverseInertia(
        state.inverseInertiaOperator,
        cross3(arm, direction)
      ),
      arm
    ),
    applyImpulse: (state, arm, impulse, sign) => {
      state.linearVelocity[0] += impulse[0] * sign * state.inverseMass;
      state.linearVelocity[1] += impulse[1] * sign * state.inverseMass;
      state.linearVelocity[2] += impulse[2] * sign * state.inverseMass;
      const angularDelta = applyInverseInertia(
        state.inverseInertiaOperator,
        cross3(arm, impulse)
      );
      state.angularVelocity[0] += angularDelta[0] * sign;
      state.angularVelocity[1] += angularDelta[1] * sign;
      state.angularVelocity[2] += angularDelta[2] * sign;
    },
    traceEnabled
  });
  return {
    ...result,
    otherIndex,
    linearVelocity,
    angularVelocity,
    impulseAudit: result.impulseAudit === null
      ? null
      : {
        ...result.impulseAudit,
        kind: "body",
        otherId: other.id,
        iteration: iteration + 1
      }
  };
}

// 旧実装を比較用に一時保存した関数です
// 実績済みkernelへ置き換えた後は呼び出さず、数式差分の調査が必要な場合だけ参照します
function solveBodyContactLegacy(
  body,
  other,
  otherIndex,
  position,
  orientation,
  linearVelocity,
  angularVelocity,
  iteration,
  config,
  accumulator,
  contactOverride = null,
  geometryB,
  inverseInertiaA,
  inverseInertiaB,
  axisCache = null,
  traceEnabled = false,
  scratch
) {
  // config.manifoldPointsが指定されていればその接触点群を使い、未指定時は代表1点を使います
  // 接触点の作り方と力積solverを混ぜず、複数点化の効果だけを比較できるようにします
  const contact = contactOverride ?? computeBoxContact(
    body,
    position,
    orientation,
    other,
    config.supportFeatureTolerance,
    null,
    geometryB,
    axisCache
  );
  if (contact === null) {
    accumulator.normalLambda = 0;
    accumulator.tangentLambdaA = 0;
    accumulator.tangentLambdaB = 0;
    return {
      support: false,
      normalImpulseApplied: false,
      impulseApplied: false,
      contactSpeed: 0,
      normalSpeed: 0,
      otherIndex,
      linearVelocity,
      angularVelocity,
      positionCorrection: null,
      impulseAudit: null
    };
  }
  const normal = contact.normal;
  const inverseMassSum = body.inverseMass + other.inverseMass;
  if (inverseMassSum <= 1.0e-7) {
    accumulator.normalLambda = 0;
    accumulator.tangentLambdaA = 0;
    accumulator.tangentLambdaB = 0;
    return {
      support: false,
      normalImpulseApplied: false,
      impulseApplied: false,
      contactSpeed: 0,
      normalSpeed: 0,
      otherIndex,
      linearVelocity,
      angularVelocity,
      positionCorrection: null,
      impulseAudit: null
    };
  }
  const point = contact.point;
  const rA = sub3Into(scratch.rA, point, position);
  const rB = sub3Into(scratch.rB, point, other.position);
  const velocityA = add3Into(
    scratch.velocityA,
    linearVelocity,
    cross3Into(scratch.crossA, angularVelocity, rA)
  );
  const velocityB = add3Into(
    scratch.velocityB,
    other.linearVelocity,
    cross3Into(scratch.crossB, other.angularVelocity, rB)
  );
  const relative = sub3Into(scratch.relative, velocityB, velocityA);
  const normalVelocity = dot3(relative, normal);
  let normalImpulseApplied = accumulator.normalLambda > EPSILON;
  let denominator = 0;
  let restitution = 0;
  let normalImpulseMagnitude = accumulator.normalLambda;
  let tangentSpeed = 0;
  let unrestricted = 0;
  let frictionLimit = 0;
  let frictionImpulseMagnitude = 0;
  let normalImpulseVector = null;
  let frictionImpulseVector = null;
  const normalAngularDelta = scratch.normalAngularDelta;
  const frictionAngularDelta = scratch.frictionAngularDelta;
  let impulseApplied = false;
  const angularBefore = traceEnabled ? cloneArray(angularVelocity) : null;
  if (traceEnabled) {
    normalAngularDelta[0] = 0;
    normalAngularDelta[1] = 0;
    normalAngularDelta[2] = 0;
    frictionAngularDelta[0] = 0;
    frictionAngularDelta[1] = 0;
    frictionAngularDelta[2] = 0;
  }
  const angularA = cross3Into(
    scratch.angularA,
    applyInverseInertiaInto(inverseInertiaA, cross3Into(scratch.crossA, rA, normal), scratch.inverseA),
    rA
  );
  const angularB = cross3Into(
    scratch.angularB,
    applyInverseInertiaInto(inverseInertiaB, cross3Into(scratch.crossB, rB, normal), scratch.inverseB),
    rB
  );
  const otherSleeping = other.sleeping;
  denominator = otherSleeping
    ? body.inverseMass + dot3(angularA, normal)
    : inverseMassSum
      + (angularA[0] + angularB[0]) * normal[0]
      + (angularA[1] + angularB[1]) * normal[1]
      + (angularA[2] + angularB[2]) * normal[2];
  // config.revisitBodyContactImpulses が有効な場合は局所反復で残留法線速度を解き直します
  // 局所反復でも相手bodyはstep開始snapshotのままなので、CPU近似経路として扱います
  const solvePairImpulse = config.revisitBodyContactImpulses || accumulator.normalLambda <= EPSILON;
  if (solvePairImpulse && normalVelocity < 0 && denominator > 1.0e-7) {
    restitution = iteration === 0 && normalVelocity < -config.restingRestitutionSpeed
      ? Math.min(body.restitution, other.restitution)
      : 0;
    const targetNormalVelocity = -restitution * normalVelocity;
    const deltaLambda = -(normalVelocity - targetNormalVelocity) / denominator;
    const previousLambda = accumulator.normalLambda;
    const nextLambda = Math.max(previousLambda + deltaLambda, 0);
    const appliedLambda = nextLambda - previousLambda;
    accumulator.normalLambda = nextLambda;
    normalImpulseMagnitude = nextLambda;
    normalImpulseApplied = nextLambda > EPSILON;
    if (Math.abs(appliedLambda) > EPSILON) {
      // 法線力積は累積値の差分だけをbody Aへ反映し、反復ごとの全量再適用を避けます
      impulseApplied = true;
      const impulse = scratch.impulse;
      impulse[0] = normal[0] * appliedLambda;
      impulse[1] = normal[1] * appliedLambda;
      impulse[2] = normal[2] * appliedLambda;
      if (traceEnabled) normalImpulseVector = cloneArray(impulse);
      linearVelocity[0] += impulse[0] * -body.inverseMass;
      linearVelocity[1] += impulse[1] * -body.inverseMass;
      linearVelocity[2] += impulse[2] * -body.inverseMass;
      const inverseImpulse = applyInverseInertiaInto(
        inverseInertiaA, cross3Into(scratch.crossA, rA, impulse), scratch.inverseA
      );
      normalAngularDelta[0] = -inverseImpulse[0];
      normalAngularDelta[1] = -inverseImpulse[1];
      normalAngularDelta[2] = -inverseImpulse[2];
      angularVelocity[0] += normalAngularDelta[0];
      angularVelocity[1] += normalAngularDelta[1];
      angularVelocity[2] += normalAngularDelta[2];
    }
  }
  // 累積法線力積があるpairだけで摩擦を解き、接線2方向の力積を摩擦円内へ射影します
  if (solvePairImpulse && accumulator.normalLambda > EPSILON) {
    const basis = contact.tangentBasis ?? computePlaneTangentBasis(normal);
    const postRelative = sub3Into(
      scratch.postRelative,
      velocityB,
      add3Into(scratch.contactVelocity, linearVelocity, cross3Into(scratch.crossA, angularVelocity, rA))
    );
    const normalTangentComponent = dot3(postRelative, normal);
    const tangentVelocity = scratch.tangentVelocity;
    tangentVelocity[0] = postRelative[0] - normal[0] * normalTangentComponent;
    tangentVelocity[1] = postRelative[1] - normal[1] * normalTangentComponent;
    tangentVelocity[2] = postRelative[2] - normal[2] * normalTangentComponent;
    tangentSpeed = length3(tangentVelocity);
    if (tangentSpeed > EPSILON) {
      const tangentA = basis[0];
      const tangentB = basis[1];
      const angularTangentA = cross3Into(
        scratch.angularTangentA,
        applyInverseInertiaInto(inverseInertiaA, cross3Into(scratch.crossA, rA, tangentA), scratch.inverseA),
        rA
      );
      const angularTangentB = cross3Into(
        scratch.angularTangentB,
        applyInverseInertiaInto(inverseInertiaB, cross3Into(scratch.crossB, rB, tangentA), scratch.inverseB),
        rB
      );
      const angularTangentA2 = cross3Into(
        scratch.angularTangentA2,
        applyInverseInertiaInto(inverseInertiaA, cross3Into(scratch.crossA, rA, tangentB), scratch.inverseA),
        rA
      );
      const angularTangentB2 = cross3Into(
        scratch.angularTangentB2,
        applyInverseInertiaInto(inverseInertiaB, cross3Into(scratch.crossB, rB, tangentB), scratch.inverseB),
        rB
      );
      const denominatorA = otherSleeping
        ? body.inverseMass + dot3(angularTangentA, tangentA)
        : inverseMassSum
          + (angularTangentA[0] + angularTangentB[0]) * tangentA[0]
          + (angularTangentA[1] + angularTangentB[1]) * tangentA[1]
          + (angularTangentA[2] + angularTangentB[2]) * tangentA[2];
      const denominatorB = otherSleeping
        ? body.inverseMass + dot3(angularTangentA2, tangentB)
        : inverseMassSum
          + (angularTangentA2[0] + angularTangentB2[0]) * tangentB[0]
          + (angularTangentA2[1] + angularTangentB2[1]) * tangentB[1]
          + (angularTangentA2[2] + angularTangentB2[2]) * tangentB[2];
      const deltaA = denominatorA > EPSILON ? -dot3(postRelative, tangentA) / denominatorA : 0;
      const deltaB = denominatorB > EPSILON ? -dot3(postRelative, tangentB) / denominatorB : 0;
      const requestedA = accumulator.tangentLambdaA + deltaA;
      const requestedB = accumulator.tangentLambdaB + deltaB;
      frictionLimit = accumulator.normalLambda * Math.sqrt(Math.max(body.friction * other.friction, 0));
      const requestedLength = Math.hypot(requestedA, requestedB);
      const tangentScale = requestedLength > frictionLimit && requestedLength > EPSILON
        ? frictionLimit / requestedLength
        : 1;
      const nextA = requestedA * tangentScale;
      const nextB = requestedB * tangentScale;
      const appliedA = nextA - accumulator.tangentLambdaA;
      const appliedB = nextB - accumulator.tangentLambdaB;
      accumulator.tangentLambdaA = nextA;
      accumulator.tangentLambdaB = nextB;
      unrestricted = Math.hypot(deltaA, deltaB);
      const frictionImpulse = scratch.frictionImpulse;
      frictionImpulse[0] = tangentA[0] * appliedA + tangentB[0] * appliedB;
      frictionImpulse[1] = tangentA[1] * appliedA + tangentB[1] * appliedB;
      frictionImpulse[2] = tangentA[2] * appliedA + tangentB[2] * appliedB;
      frictionImpulseMagnitude = length3(frictionImpulse);
      if (traceEnabled) frictionImpulseVector = cloneArray(frictionImpulse);
      if (frictionImpulseMagnitude > EPSILON) {
        impulseApplied = true;
        linearVelocity[0] += frictionImpulse[0] * -body.inverseMass;
        linearVelocity[1] += frictionImpulse[1] * -body.inverseMass;
        linearVelocity[2] += frictionImpulse[2] * -body.inverseMass;
        const inverseFriction = applyInverseInertiaInto(
          inverseInertiaA,
          cross3Into(scratch.crossA, rA, frictionImpulse),
          scratch.inverseA
        );
        frictionAngularDelta[0] = -inverseFriction[0];
        frictionAngularDelta[1] = -inverseFriction[1];
        frictionAngularDelta[2] = -inverseFriction[2];
        angularVelocity[0] += frictionAngularDelta[0];
        angularVelocity[1] += frictionAngularDelta[1];
        angularVelocity[2] += frictionAngularDelta[2];
      }
    }
  }
  const residualVelocity = sub3Into(
    scratch.residualVelocity,
    velocityB,
    add3Into(scratch.contactVelocity, linearVelocity, cross3Into(scratch.crossA, angularVelocity, rA))
  );
  const correctionScale = body.inverseMass / inverseMassSum;
  const positionCorrection = applyPositionCorrection(
    position,
    normal,
    contact.penetration,
    -correctionScale,
    config
  );
  return {
    support: normal[1] < -0.5,
    normalImpulseApplied,
    impulseApplied,
    contactSpeed: normalImpulseApplied && iteration + 1 >= config.solverIterations ? length3(residualVelocity) : 0,
    normalSpeed: normalImpulseApplied && iteration + 1 >= config.solverIterations
      ? Math.abs(dot3(residualVelocity, normal))
      : 0,
    otherIndex,
    normalVelocity,
    linearVelocity,
    angularVelocity,
    positionCorrection,
    impulseAudit: traceEnabled && normalImpulseApplied
      ? {
        kind: "body",
        otherId: other.id,
        iteration: iteration + 1,
        normal,
        point: cloneArray(point),
        r: cloneArray(rA),
        normalImpulseVector,
        frictionImpulseVector,
        normalVelocity,
        denominator,
        normalImpulse: normalImpulseMagnitude,
        restitution,
        tangentSpeed,
        unrestricted,
        frictionLimit,
        frictionImpulse: frictionImpulseMagnitude,
        angularBefore,
        angularAfter: cloneArray(angularVelocity),
        normalAngularDelta,
        frictionAngularDelta,
        angularDelta: sub3(angularVelocity, angularBefore)
      }
      : null
  };
}

// CPU側の一fixed stepを実行し、GPUのB31 stage診断へ対応する途中速度も保持します
// bodyごとの処理は同じsource snapshotから独立に書き出し、GPUのping-pong state更新順へ合わせます
export default class CpuBoxPhysicsSolver {
  constructor(options = {}) {
    if (!Array.isArray(options.bodies) || options.bodies.length === 0) {
      throw new Error("CpuBoxPhysicsSolver bodies must be a non-empty array");
    }
    if (!Array.isArray(options.gravity) || options.gravity.length !== 3) {
      throw new Error("CpuBoxPhysicsSolver gravity must be a 3 element array");
    }
    if (!Number.isFinite(options.fixedTimeStepMs) || options.fixedTimeStepMs <= 0) {
      throw new Error("CpuBoxPhysicsSolver fixedTimeStepMs must be positive");
    }
    if (!Number.isInteger(options.solverIterations) || options.solverIterations < 1) {
      throw new Error("CpuBoxPhysicsSolver solverIterations must be a positive integer");
    }
    // local Box invocationは相手snapshotを固定するため、反発lambdaを初回反復へ限定します
    // 後続反復は位置補正とPlane支持の収束へ使い、同じ反発を重ねず速度を安定させます
    const revisitBodyContactImpulses = options.revisitBodyContactImpulses ?? false;
    if (typeof revisitBodyContactImpulses !== "boolean") {
      throw new Error("CpuBoxPhysicsSolver revisitBodyContactImpulses must be boolean");
    }
    const traceBodyIds = options.traceBodyIds ?? [];
    if (!Array.isArray(traceBodyIds) || traceBodyIds.some((bodyId) => !Number.isInteger(bodyId))) {
      throw new Error("CpuBoxPhysicsSolver traceBodyIds must be an array of integer body IDs");
    }
    const orientationIntegrator = options.orientationIntegrator ?? integrateOrientationDeltaQuaternion;
    if (typeof orientationIntegrator !== "function") {
      throw new Error("CpuBoxPhysicsSolver orientationIntegrator must be a function");
    }
    this.gravity = cloneArray(options.gravity);
    this.traceBodyIds = new Set(traceBodyIds);
    this.planes = createSolverPlanes(options.planes, options.bounds);
    const materialPairs = options.materialPairs ?? new PhysicsMaterialPairs(options);
    this.planes.forEach((plane, index) => {
      const source = options.planes?.[index];
      plane.material = materialPairs.material(source?.material ?? {}, source?.materialId);
    });
    this.planeBodyIds = options.planes === undefined
      ? this.planes.map(() => null)
      : options.planes.map((plane, index) => (
        plane.bodyId === undefined
          ? null
          : util.readFiniteNumber(
            plane.bodyId,
            `CpuBoxPhysicsSolver planes[${index}].bodyId`,
            { integer: true, minExclusive: 0.0 }
          )
      ));
    // Planeの法線はscene全体で固定されるため、摩擦の接線基底もsolver生成時に一度だけ作ります
    // fixed stepごと・bodyごとに同じcrossとnormalizeを繰り返さず、Plane contactへ読み取り専用で渡します
    this.planeTangentBases = this.planes.map((plane) => computePlaneTangentBasis(plane.normal));
    const bounds = options.bounds;
    if (bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ) {
      throw new Error("CpuBoxPhysicsSolver bounds XZ size must be positive");
    }
    const gridSize = options.gridSize ?? 16;
    if (!Number.isInteger(gridSize) || gridSize < 1 || gridSize > 128) {
      throw new Error("CpuBoxPhysicsSolver gridSize must be an integer from 1 to 128");
    }
    this.config = {
      materialPairs,
      dt: options.fixedTimeStepMs / 1000,
      bounds: {
        minX: bounds.minX,
        maxX: bounds.maxX,
        minZ: bounds.minZ,
        maxZ: bounds.maxZ
      },
      gridSize,
      solverIterations: options.solverIterations,
      revisitBodyContactImpulses,
      persistentSleep: options.persistentSleep !== false,
      positionCorrectionBeta: options.positionCorrectionBeta ?? 1,
      positionSlop: options.positionSlop ?? 0.0005,
      broadphasePadding: options.broadphasePadding ?? 0.001,
      supportFeatureTolerance: options.supportFeatureTolerance ?? 0.01,
      restingRestitutionSpeed: options.restingRestitutionSpeed ?? 0.5,
      sleepLinearSpeed: options.sleepLinearSpeed ?? 0.02,
      sleepAngularSpeed: options.sleepAngularSpeed ?? 0.3,
      sleepContactSpeed: options.sleepContactSpeed ?? 0.01,
      sleepNormalSpeed: options.sleepNormalSpeed ?? 0.02,
      timeToSleep: util.readOptionalFiniteNumber(options.timeToSleep, "CpuBoxPhysicsSolver timeToSleep",
        options.sleepSteps === undefined ? 0.5 : options.sleepSteps * options.fixedTimeStepMs / 1000, { min: 0 }),
      minimumFloorSupportPoints: options.minimumFloorSupportPoints ?? 2,
      wakeLinearSpeed: options.wakeLinearSpeed ?? 0.03,
      wakeAngularSpeed: options.wakeAngularSpeed
        ?? (options.sleepAngularSpeed ?? 0.3) * 1.5,
      orientationIntegrator,
      divergenceLimits: {
        position: options.divergencePositionLimit ?? DEFAULT_DIVERGENCE_LIMITS.position,
        linear: options.divergenceLinearLimit ?? DEFAULT_DIVERGENCE_LIMITS.linear,
        angular: options.divergenceAngularLimit ?? DEFAULT_DIVERGENCE_LIMITS.angular,
        orientation: options.divergenceOrientationLimit ?? DEFAULT_DIVERGENCE_LIMITS.orientation
      }
    };
    this.config.excludedBodyPairKeys = new Set();
    this.config.sleepSteps = Math.max(1, Math.ceil(this.config.timeToSleep / this.config.dt));
    if (this.config.wakeAngularSpeed < this.config.sleepAngularSpeed) {
      throw new Error("CpuBoxPhysicsSolver wakeAngularSpeed must be at least sleepAngularSpeed");
    }
    this.reset(options.bodies);
  }

  // 初期descriptorからCPU状態を再構築し、GPUのR操作と同じ開始条件へ戻します
  // state、sleep counter、命令、診断peakを同時に消去します
  reset(bodies) {
    if (!Array.isArray(bodies) || bodies.length === 0) {
      throw new Error("CpuBoxPhysicsSolver reset bodies must be a non-empty array");
    }
    this.states = bodies.map((body) => buildState(body, this.config.materialPairs));
    this.commands = this.states.map(() => ({
      linearImpulse: [0, 0, 0],
      angularImpulse: [0, 0, 0]
    }));
    this.bodyIndexById = new Map(this.states.map((body, index) => [body.id, index]));
    this.fixedStepCount = 0;
    this.lastStage = null;
    this.lastTrace = null;
    this.peakStage = null;
    this.firstDivergence = null;
    this.lastReport = null;
    this.lastMetrics = null;
    this.currentMetrics = null;
    this.lastContacts = [];
    for (const bodyId of this.traceBodyIds) {
      if (!this.bodyIndexById.has(bodyId)) {
        throw new Error(`CpuBoxPhysicsSolver trace body ${bodyId} is missing from bodies`);
      }
    }
  }

  // GPUのapplyAngularImpulseに対応する一回命令をCPU側へ蓄積します
  // 次のfixed stepで一度だけ消費し、commandをそのstepの入力として扱います
  applyAngularImpulse(bodyId, impulse) {
    const index = this.bodyIndexById.get(bodyId);
    if (index === undefined) throw new Error(`CpuBoxPhysicsSolver unknown body id: ${bodyId}`);
    if (!Array.isArray(impulse) || impulse.length !== 3 || impulse.some((value) => !Number.isFinite(value))) {
      throw new Error("CpuBoxPhysicsSolver angular impulse must be a finite 3 element array");
    }
    this.commands[index].angularImpulse = add3(this.commands[index].angularImpulse, impulse);
  }

  // GPUのapplyImpulseに対応する一回命令をCPU側へ蓄積します
  // forceをfixed step幅で積分した値もこの入口へ渡し、重力と同じ外部積分段階で一度だけ消費します
  applyLinearImpulse(bodyId, impulse) {
    const index = this.bodyIndexById.get(bodyId);
    if (index === undefined) throw new Error(`CpuBoxPhysicsSolver unknown body id: ${bodyId}`);
    if (!Array.isArray(impulse) || impulse.length !== 3 || impulse.some((value) => !Number.isFinite(value))) {
      throw new Error("CpuBoxPhysicsSolver linear impulse must be a finite 3 element array");
    }
    this.commands[index].linearImpulse = add3(this.commands[index].linearImpulse, impulse);
  }

  // collideConnected=falseのJointが指定するbody pairを次fixed stepの候補生成から除外します
  // body ID pairを正規化し、接触生成の候補段階で除外します
  setExcludedBodyPairs(bodyPairs) {
    if (!Array.isArray(bodyPairs)) {
      throw new Error("CpuBoxPhysicsSolver excluded body pairs must be an array");
    }
    const keys = new Set();
    for (let index = 0; index < bodyPairs.length; index += 1) {
      const pair = bodyPairs[index];
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new Error(`CpuBoxPhysicsSolver excluded body pair ${index} must contain two body IDs`);
      }
      const first = util.readFiniteNumber(pair[0], `excluded body pair ${index}[0]`, {
        integer: true,
        minExclusive: 0.0
      });
      const second = util.readFiniteNumber(pair[1], `excluded body pair ${index}[1]`, {
        integer: true,
        minExclusive: 0.0
      });
      if (first === second) {
        throw new Error(`CpuBoxPhysicsSolver excluded body pair ${index} contains the same body ID`);
      }
      keys.add(first < second ? `${first}:${second}` : `${second}:${first}`);
    }
    this.config.excludedBodyPairKeys = keys;
    return this;
  }

  // PhysicsNodeから再生成したdescriptorを次stepのsource stateへ同期します
  // sleep counterは同じbody IDの連続状態として保持し、Node側でwakeした場合だけ明示的に0へ戻します
  synchronizeBodies(bodies) {
    if (!Array.isArray(bodies) || bodies.length !== this.states.length) {
      throw new Error("CpuBoxPhysicsSolver synchronizeBodies must contain every registered body");
    }
    const synchronizedStates = bodies.map((descriptor) => {
      const nextState = buildState(descriptor, this.config.materialPairs);
      const index = this.bodyIndexById.get(nextState.id);
      if (index === undefined) {
        throw new Error(`CpuBoxPhysicsSolver synchronizeBodies unknown body id: ${nextState.id}`);
      }
      const previousState = this.states[index];
      if (previousState.bodyType !== nextState.bodyType
          || previousState.halfExtents.some((value, axis) => value !== nextState.halfExtents[axis])) {
        throw new Error(`CpuBoxPhysicsSolver body ${nextState.id} structural data changed after registration`);
      }
      nextState.sleepCounter = nextState.sleeping === previousState.sleeping
        ? previousState.sleepCounter
        : 0;
      return nextState;
    });
    const synchronizedStateMap = new Map(synchronizedStates.map((state) => [state.id, state]));
    if (synchronizedStateMap.size !== this.states.length) {
      throw new Error("CpuBoxPhysicsSolver synchronizeBodies contains duplicate body IDs");
    }
    this.states = this.states.map((state) => {
      const synchronized = synchronizedStateMap.get(state.id);
      if (!synchronized) {
        throw new Error(`CpuBoxPhysicsSolver synchronizeBodies missing body id: ${state.id}`);
      }
      return synchronized;
    });
    return this;
  }

  // 登録時に確定した形状・質量・材質を作り直さず、Nodeの可変stateだけを次stepへ同期します
  // fixed stepごとのComputeBoxCollider生成を避け、scratchを維持したままNodeとsolverの状態を揃えます
  synchronizeBodyStates(bodyStates) {
    if (!Array.isArray(bodyStates) || bodyStates.length !== this.states.length) {
      throw new Error("CpuBoxPhysicsSolver synchronizeBodyStates must contain every registered body");
    }
    const stateMap = new Map();
    for (let index = 0; index < bodyStates.length; index += 1) {
      const input = bodyStates[index];
      if (!input || typeof input !== "object") {
        throw new Error(`CpuBoxPhysicsSolver bodyStates[${index}] must be an object`);
      }
      const id = util.readFiniteNumber(
        input.id,
        `CpuBoxPhysicsSolver bodyStates[${index}].id`,
        { integer: true, minExclusive: 0.0 }
      );
      if (stateMap.has(id)) {
        throw new Error(`CpuBoxPhysicsSolver synchronizeBodyStates duplicate body id: ${id}`);
      }
      const readArray = (value, field, length) => {
        if (!Array.isArray(value) || value.length !== length) {
          throw new Error(`CpuBoxPhysicsSolver body ${id} ${field} must have ${length} elements`);
        }
        return value.map((entry, component) => util.readFiniteNumber(
          entry,
          `CpuBoxPhysicsSolver body ${id} ${field}[${component}]`
        ));
      };
      if (typeof input.sleeping !== "boolean") {
        throw new Error(`CpuBoxPhysicsSolver body ${id} sleeping must be boolean`);
      }
      if (typeof input.allowSleep !== "boolean") {
        throw new Error(`CpuBoxPhysicsSolver body ${id} allowSleep must be boolean`);
      }
      stateMap.set(id, {
        position: readArray(input.position, "position", 3),
        orientation: quatNormalize(readArray(input.orientation, "orientation", 4)),
        linearVelocity: readArray(input.linearVelocity, "linearVelocity", 3),
        angularVelocity: readArray(input.angularVelocity, "angularVelocity", 3),
        surfaceVelocity: readArray(input.surfaceVelocity ?? [0.0, 0.0, 0.0], "surfaceVelocity", 3),
        sleeping: input.sleeping,
        allowSleep: input.allowSleep
      });
    }
    this.states = this.states.map((previous) => {
      const input = stateMap.get(previous.id);
      if (!input) {
        throw new Error(`CpuBoxPhysicsSolver synchronizeBodyStates missing body id: ${previous.id}`);
      }
      return {
        ...previous,
        ...input,
        sleepCounter: input.sleeping === previous.sleeping ? previous.sleepCounter : 0
      };
    });
    return this;
  }

  // 指定fixed step数だけCPU状態を進め、最後のB31 stageを返します
  // 0 stepを許可し、GPU readbackが同一frame内に物理更新を含まない場合も比較状態を保持します
  advance(stepCount) {
    if (!Number.isInteger(stepCount) || stepCount < 0) {
      throw new Error("CpuBoxPhysicsSolver advance stepCount must be a non-negative integer");
    }
    let stage = this.lastStage;
    for (let step = 0; step < stepCount; step++) {
      stage = this.step();
      this.fixedStepCount += 1;
    }
    this.lastStage = stage;
    return stage;
  }

  // GPUの一body一invocation方式をCPUでbody単位に再現し、全bodyの新stateを同時に確定します
  // 途中でthis.statesを書き換えず、同じsource snapshotを各bodyのother入力へ渡します
  step() {
    const stepStartMs = performance.now();
    const source = this.states.map((body) => cloneState(body));
    const commands = this.commands.map((command) => ({
      linearImpulse: cloneArray(command.linearImpulse),
      angularImpulse: cloneArray(command.angularImpulse)
    }));
    const sourceSnapshotMs = performance.now() - stepStartMs;
    const aabbStartMs = performance.now();
    const aabbs = buildPredictedAabbs(source, commands, { ...this.config, gravity: this.gravity });
    const aabbBuildMs = performance.now() - aabbStartMs;
    const candidateStartMs = performance.now();
    const candidates = buildCandidates(source, aabbs, this.config);
    const candidateBuildMs = performance.now() - candidateStartMs;
    const sourceGeometries = source.map((body) => createBoxGeometry(body));
    const metrics = {
      fixedStep: this.fixedStepCount + 1,
      bodyCount: source.length,
      activeBodyCountBefore: source.filter((body) => !body.sleeping && body.bodyType === "dynamic").length,
      candidatePairCount: candidates.reduce((total, entries) => total + entries.length, 0),
      bodyContactTests: 0,
      bodyContacts: 0,
      planeContactTests: 0,
      planeContacts: 0,
      positionCorrectionCount: 0,
      positionCorrectionDistance: 0,
      wakeCandidateChecks: 0,
      wakeContactTests: 0,
      sleepingBodyCountAfter: 0,
      sourceSnapshotMs,
      aabbBuildMs,
      candidateBuildMs,
      bodySolveMs: 0,
      stateCommitMs: 0,
      totalStepMs: 0
    };
    this.currentMetrics = metrics;
    const bodySolveStartMs = performance.now();
    const nextStates = [];
    const traces = [];
    const observedContacts = [];
    let b31Stage = null;
    for (let index = 0; index < source.length; index++) {
      const result = this.solveBody(
        index,
        source,
        commands,
        candidates[index],
        this.traceBodyIds.has(source[index].id),
        sourceGeometries
      );
      nextStates.push(result.state);
      for (let contactIndex = 0; contactIndex < result.contacts.length; contactIndex += 1) {
        observedContacts.push(result.contacts[contactIndex]);
      }
      if (result.stage !== null) b31Stage = result.stage;
      if (result.trace !== null) traces.push(result.trace);
    }
    metrics.bodySolveMs = performance.now() - bodySolveStartMs;
    const stateCommitStartMs = performance.now();
    this.states = nextStates;
    this.commands = this.states.map(() => ({
      linearImpulse: [0, 0, 0],
      angularImpulse: [0, 0, 0]
    }));
    metrics.sleepingBodyCountAfter = nextStates.filter((body) => body.sleeping).length;
    metrics.stateCommitMs = performance.now() - stateCommitStartMs;
    metrics.totalStepMs = performance.now() - stepStartMs;
    this.lastMetrics = Object.freeze({ ...metrics });
    // sleep中bodyは接触solverを実行せず、両側が静止したpairだけ前stepの観測値を維持します
    // 一方がawakeになったpairは今回の実接触だけを採用し、離れた接触を履歴から除きます
    const nextStateById = new Map(nextStates.map((state) => [state.id, state]));
    const currentContactMap = new Map(observedContacts.map((contact) => [
      getObservedContactKey(contact),
      contact
    ]));
    for (const previousContact of this.lastContacts) {
      const key = getObservedContactKey(previousContact);
      if (currentContactMap.has(key)) continue;
      const bodyA = nextStateById.get(
        previousContact.kind === "plane" ? previousContact.bodyId : previousContact.bodyAId
      );
      const bodyB = previousContact.kind === "plane"
        ? null
        : nextStateById.get(previousContact.bodyBId);
      const bodyAStopped = bodyA !== undefined
        && (bodyA.bodyType === "static" || bodyA.sleeping === true);
      const bodyBStopped = previousContact.kind === "plane"
        || (bodyB !== undefined && (bodyB.bodyType === "static" || bodyB.sleeping === true));
      if (bodyAStopped && bodyBStopped) {
        currentContactMap.set(key, previousContact);
      }
    }
    this.lastContacts = [...currentContactMap.values()].map((contact) => (
      Object.freeze(cloneObservedContact(contact))
    ));
    this.currentMetrics = null;
    this.lastTrace = traces.length === 0
      ? null
      : {
        fixedStep: this.fixedStepCount + 1,
        bodies: traces.map(cloneBodyTrace)
      };
    if (b31Stage !== null) {
      const currentPeak = Math.max(b31Stage.afterB30[3], b31Stage.afterB32[3], b31Stage.afterPlane[3]);
      const previousPeak = this.peakStage === null
        ? -Infinity
        : Math.max(this.peakStage.afterB30[3], this.peakStage.afterB32[3], this.peakStage.afterPlane[3]);
      if (currentPeak > previousPeak) this.peakStage = cloneStage(b31Stage);
    }
    return b31Stage;
  }

  // sleep bodyの現在接触と次fixed stepの予測接触を走査し、新規接触の法線接近だけをwake条件へ採用します
  // 継続接触の残留速度や接線速度をwake判定から分離し、wake候補の相手slotと速度を診断用に返します
  findWakeContact(index, source, commands, candidateIndices, sourceGeometries = null) {
    const body = source[index];
    const bodyGeometry = sourceGeometries?.[index] ?? null;
    let best = { contact: false, normalVelocity: 0, approachSpeed: 0, otherIndex: -1 };
    for (const otherIndex of candidateIndices) {
      if (this.currentMetrics !== null) this.currentMetrics.wakeCandidateChecks += 1;
      const other = source[otherIndex];
      if (other.bodyType === "static") continue;
      // まず現在位置の接触を確認し、継続接触を現在の接触として保持します
      // 継続接触の残留沈み込みをwake判定から分離し、solver側のsleep body固定支持へ渡します
      if (this.currentMetrics !== null) this.currentMetrics.wakeContactTests += 1;
      let contact = computeBoxContact(
        other,
        other.position,
        other.orientation,
        body,
        this.config.supportFeatureTolerance,
        sourceGeometries?.[otherIndex] ?? null,
        bodyGeometry
      );
      let contactOther = other;
      let predictedContact = false;
      if (contact === null) {
        // 現在は離れているpairだけ、次fixed stepの活動bodyを予測して新規接触を調べます
        const predictedOther = predictWakeBody(other, commands[otherIndex], this.config, this.config.dt, this.gravity);
        contactOther = predictedOther;
        if (this.currentMetrics !== null) this.currentMetrics.wakeContactTests += 1;
        contact = computeBoxContact(
          contactOther,
          contactOther.position,
          contactOther.orientation,
          body,
          this.config.supportFeatureTolerance,
          createBoxGeometry(contactOther),
          bodyGeometry
        );
        predictedContact = true;
      }
      if (contact === null) continue;
      const point = contact.point;
      const velocityA = addSurfaceContactVelocity(
        add3(contactOther.linearVelocity, cross3(contactOther.angularVelocity, sub3(point, contactOther.position))),
        contactOther,
        contact.normal
      );
      const velocityB = add3(body.linearVelocity, cross3(body.angularVelocity, sub3(point, body.position)));
      const normalVelocity = dot3(sub3(velocityB, velocityA), contact.normal);
      const approachSpeed = Math.max(0, -normalVelocity);
      if (!best.contact || approachSpeed > best.approachSpeed) {
        best = { contact: true, normalVelocity, approachSpeed, otherIndex };
      }
      // 水平成分だけを持つkinematic surface velocityでも、sleep中のpayloadを接触solverへ戻します
      if (contactOther.bodyType === "kinematic"
          && length3(contactOther.surfaceVelocity ?? [0.0, 0.0, 0.0]) > EPSILON) {
        return { awake: true, ...best };
      }
      // 既存接触の残留速度はwakeへ使わず、gapから新しく接触する場合だけwakeさせます
      if (predictedContact && normalVelocity <= -this.config.wakeLinearSpeed) {
        return { awake: true, ...best };
      }
    }
    return { awake: false, ...best };
  }

  // 一つのbodyの外部命令、減衰、接触solver、sleep判定をGPUの順番で実行します
  // 計算順序を変更した近似結果を「GPU再現」と表示しないため、対応形状だけを初期化します
  solveBody(index, source, commands, candidateIndices, traceEnabled = false, sourceGeometries = null) {
    const sourceBody = source[index];
    const command = commands[index];
    let position = cloneArray(sourceBody.position);
    let orientation = quatNormalize(sourceBody.orientation);
    let linearVelocity = cloneArray(sourceBody.linearVelocity);
    let angularVelocity = cloneArray(sourceBody.angularVelocity);
    if (sourceBody.fixedRotation === true) {
      // 回転固定bodyは初期角速度と外部角力積を姿勢更新へ渡さず、角速度をゼロへ揃えます
      angularVelocity = [0.0, 0.0, 0.0];
    }
    // 最終solver反復で成立した接触だけを保持し、pairごとに一件の診断記録へまとめます
    const observedContacts = [];
    const trace = traceEnabled
      ? {
        id: sourceBody.id,
        start: [...sourceBody.linearVelocity, length3(sourceBody.angularVelocity)],
        preContact: null,
        bodyImpulses: [],
        planeImpulses: [],
        end: null,
        sleeping: false
      }
      : null;
    const commandWakes = length3(command.linearImpulse) > 0
      || length3(command.angularImpulse) > 0;
    const sourceWasSleeping = this.config.persistentSleep && sourceBody.sleeping;
    let wasSleeping = sourceWasSleeping && sourceBody.allowSleep && !commandWakes;
    if (sourceBody.bodyType === "static") {
      if (trace !== null) {
        trace.preContact = [0, 0, 0, 0];
        trace.end = [0, 0, 0, 0];
      }
      return {
        state: { ...cloneState(sourceBody), position, orientation, linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0], sleeping: false },
        stage: null,
        trace,
        contacts: observedContacts
      };
    }
    let wakeAudit = { awake: false, contact: false, normalVelocity: 0, approachSpeed: 0, otherIndex: -1 };
    if (wasSleeping) {
      wakeAudit = this.findWakeContact(index, source, commands, candidateIndices, sourceGeometries);
      if (!wakeAudit.awake) {
        if (trace !== null) {
          trace.end = [...sourceBody.linearVelocity, length3(sourceBody.angularVelocity)];
          trace.sleeping = true;
        }
        return { state: cloneState(sourceBody), stage: null, trace, contacts: observedContacts };
      }
      wasSleeping = false;
    }
    if (sourceBody.bodyType === "dynamic") {
      linearVelocity = add3(
        add3(linearVelocity, scale3(this.gravity, sourceBody.gravityScale * this.config.dt)),
        scale3(command.linearImpulse, sourceBody.inverseMass)
      );
      angularVelocity = add3(
        angularVelocity,
        inverseInertiaApply(orientation, sourceBody.inverseInertia, command.angularImpulse)
      );
    }
    linearVelocity = scale3(linearVelocity, Math.exp(-sourceBody.linearDamping * this.config.dt));
    angularVelocity = scale3(angularVelocity, Math.exp(-sourceBody.angularDamping * this.config.dt));
    position = add3(position, scale3(linearVelocity, this.config.dt));
    orientation = integrateOrientation(
      orientation,
      angularVelocity,
      this.config.dt,
      this.config.orientationIntegrator
    );
    if (trace !== null) trace.preContact = [...linearVelocity, length3(angularVelocity)];
    const stage = sourceBody.id === 31
      ? {
        start: [...sourceBody.linearVelocity, length3(sourceBody.angularVelocity)],
        afterB30: [0, 0, 0, 0],
        afterB32: [0, 0, 0, 0],
        afterPlane: [0, 0, 0, 0],
        end: [0, 0, 0, 0],
        events: [0, 0, 0, 0]
      }
      : null;
    let hasSupport = false;
    let bodyContactObserved = false;
    let activeDynamicBodyContactObserved = false;
    let nonFloorPlaneContactObserved = false;
    let maxContactSpeed = 0;
    let maxNormalSpeed = 0;
    let floorContactObserved = false;
    let floorSupportPoints = 8;
    let wallSupportImpulseY = 0;
    let bodySupportObserved = false;
    let peakSupportPenetration = -Infinity;
    let peakSupportNormalImpulse = 0;
    let peakSupportOtherSleeping = false;
    let wakeSolverSeed = sourceWasSleeping && wakeAudit.awake;
    // GPUのPlaneごとのfunction-local accumulatorをCPU側でもfixed step単位で保持します
    // solver反復では法線・摩擦力積の増分だけを同じ順序で反映します
    const planeImpulseAccumulators = this.planes.map(() => ({
      normalLambda: 0,
      tangentLambdaA: 0,
      tangentLambdaB: 0
    }));
    // GPUと同じくcandidate pairごとに累積力積を分け、pairごとの接触拘束を独立して扱います
    // body slotをそのまま配列indexへ使い、毎反復のMap lookupとcandidate初期化用配列を減らします
    const pairImpulseAccumulators = new Array(source.length);
    // body pairの姿勢は一bodyのfixed step中に変わらないため、SAT軸の正規化結果をpair単位で共有します
    // position correctionで変化するのはprojectionとpenetrationだけなので、軸cacheを再利用して現在の接触位置を計算します
    const pairAxisCaches = new Array(source.length);
    // body contactとPlane contactが同時に使うVec3 scratchをbody単位で確保します
    // contactごとの配列を共有し、診断へ渡す値だけは呼出側で複製します
    const contactScratch = createContactScratch();
    const axesA = computeBoxAxes(orientation);
    const geometryA = {
      axes: axesA,
      inverseInertiaOperator: createInverseInertiaOperator(
        orientation, sourceBody.inverseInertia, axesA
      )
    };
    for (let iteration = 0; iteration < this.config.solverIterations; iteration++) {
      // candidate bitsetをslot昇順で走査し、B30/B32の順番がGPUと一致するようにします
      for (const otherIndex of candidateIndices) {
        if (this.currentMetrics !== null) this.currentMetrics.bodyContactTests += 1;
        const solverOther = wakeSolverSeed && otherIndex === wakeAudit.otherIndex
          ? predictWakeBody(source[otherIndex], commands[otherIndex], this.config, this.config.dt, this.gravity)
          : source[otherIndex];
        const geometryB = wakeSolverSeed && otherIndex === wakeAudit.otherIndex
          ? createBoxGeometry(solverOther)
          : sourceGeometries?.[otherIndex] ?? createBoxGeometry(solverOther);
        let axisCache = pairAxisCaches[otherIndex];
        if (axisCache === undefined) {
          axisCache = createSharedBoxPairAxisCache(geometryA.axes, geometryB.axes);
          pairAxisCaches[otherIndex] = axisCache;
        }
        // CPUによるBox接触は、Compute版と同じ代表接触点をpairごとに一つだけ使います
        // 複数support点の並べ替えや接点ごとのlambdaを持たず、接触式の選択を固定します
        const contact = computeBoxContact(
          sourceBody,
          position,
          orientation,
          solverOther,
          this.config.supportFeatureTolerance,
          geometryA,
          geometryB,
          axisCache
        );
        if (contact === null) {
          pairImpulseAccumulators[otherIndex] = null;
          continue;
        }
        if (this.currentMetrics !== null) this.currentMetrics.bodyContacts += 1;
        // GPUと同じく、法線方向や力積の有無に関係なく現在stepの実接触を記録します
        // sleep中bodyだけとの接触とactive bodyとの接触を後段で分けるため、最終接触を記録します
        bodyContactObserved = true;
        if (solverOther.inverseMass > 0 && !solverOther.sleeping) {
          activeDynamicBodyContactObserved = true;
        }
        let accumulator = pairImpulseAccumulators[otherIndex];
        if (accumulator === undefined || accumulator === null) {
          accumulator = {
            normalLambda: 0,
            tangentLambdaA: 0,
            tangentLambdaB: 0
          };
          pairImpulseAccumulators[otherIndex] = accumulator;
        }
        const contactResult = solveBodyContact(
          sourceBody,
          solverOther,
          otherIndex,
          position,
          orientation,
          linearVelocity,
          angularVelocity,
          iteration,
          this.config,
          accumulator,
          contact,
          geometryB,
          geometryA.inverseInertiaOperator,
          geometryB.inverseInertiaOperator,
          axisCache,
          trace !== null,
          contactScratch
        );
        linearVelocity = contactResult.linearVelocity;
        angularVelocity = contactResult.angularVelocity;
        // dynamic pairはslot番号が小さいlocal invocationだけを観測し、A/B両側の重複を防ぎます
        // static Boxはlocal invocationを持たないため、dynamic側から必ず一件を記録します
        if (iteration + 1 >= this.config.solverIterations
            && (solverOther.bodyType === "static" || index < otherIndex)) {
          const tangentBasis = contact.tangentBasis ?? computePlaneTangentBasis(contact.normal);
          observedContacts.push({
            kind: "body",
            bodyAId: sourceBody.id,
            bodyBId: solverOther.id,
            normal: cloneArray(contact.normal),
            point: cloneArray(contact.point),
            penetration: contact.penetration,
            normalImpulse: accumulator.normalLambda,
            tangentImpulse: add3(
              scale3(tangentBasis[0], accumulator.tangentLambdaA),
              scale3(tangentBasis[1], accumulator.tangentLambdaB)
            )
          });
        }
        if (this.currentMetrics !== null && contactResult.positionCorrection !== null) {
          this.currentMetrics.positionCorrectionCount += 1;
          this.currentMetrics.positionCorrectionDistance += contactResult.positionCorrection;
        }
        if (trace !== null && contactResult.impulseAudit !== null) {
          trace.bodyImpulses.push(cloneImpulseAudit(contactResult.impulseAudit));
        }
        if (contactResult.support) {
          bodySupportObserved = true;
          hasSupport = true;
          if (contactResult.normalVelocity !== undefined && contactResult.normalVelocity < 0) {
            peakSupportPenetration = Math.max(peakSupportPenetration, contactResult.normalVelocity);
          }
        }
        maxContactSpeed = Math.max(maxContactSpeed, contactResult.contactSpeed);
        maxNormalSpeed = Math.max(maxNormalSpeed, contactResult.normalSpeed);
        if (stage !== null && contactResult.impulseApplied) {
          const stageValue = [...linearVelocity, length3(angularVelocity)];
          if (otherIndex === 29) {
            stage.afterB30 = stageValue;
            stage.events[0] = iteration + 1;
          }
          if (otherIndex === 31) {
            stage.afterB32 = stageValue;
            stage.events[1] = iteration + 1;
          }
        }
      }
      for (let planeIndex = 0; planeIndex < this.planes.length; planeIndex++) {
        const planeBodyId = this.planeBodyIds[planeIndex];
        const excludedPlanePair = planeBodyId === null
          ? false
          : this.config.excludedBodyPairKeys.has(
            sourceBody.id < planeBodyId
              ? `${sourceBody.id}:${planeBodyId}`
              : `${planeBodyId}:${sourceBody.id}`
          );
        if (excludedPlanePair) continue;
        if (this.currentMetrics !== null) this.currentMetrics.planeContactTests += 1;
        const plane = this.planes[planeIndex];
        const planeResult = solvePlaneContact(
          sourceBody,
          position,
          orientation,
          plane,
          planeIndex,
          linearVelocity,
          angularVelocity,
          iteration,
          this.config,
          planeImpulseAccumulators[planeIndex],
          geometryA.inverseInertiaOperator,
          this.planeTangentBases[planeIndex],
          trace !== null,
          contactScratch,
          geometryA.axes
        );
        linearVelocity = planeResult.linearVelocity;
        angularVelocity = planeResult.angularVelocity;
        if (this.currentMetrics !== null && planeResult.positionCorrection !== null) {
          this.currentMetrics.positionCorrectionCount += 1;
          this.currentMetrics.positionCorrectionDistance += planeResult.positionCorrection;
        }
        if (trace !== null && planeResult.impulseAudit !== null) {
          trace.planeImpulses.push(cloneImpulseAudit(planeResult.impulseAudit));
        }
        maxContactSpeed = Math.max(maxContactSpeed, planeResult.contactSpeed);
        maxNormalSpeed = Math.max(maxNormalSpeed, planeResult.normalSpeed);
        if (this.currentMetrics !== null && planeResult.supportCount > 0) {
          this.currentMetrics.planeContacts += 1;
        }
        if (planeResult.observedContact !== null) {
          observedContacts.push({
            kind: "plane",
            bodyId: sourceBody.id,
            planeIndex,
            planeBodyId: this.planeBodyIds[planeIndex],
            ...planeResult.observedContact
          });
        }
        wallSupportImpulseY += iteration + 1 >= this.config.solverIterations ? planeResult.supportImpulseY : 0;
        if (planeResult.supportCount > 0 && plane.normal[1] > 0.5) {
          floorContactObserved = true;
          floorSupportPoints = Math.min(floorSupportPoints, planeResult.supportCount);
          hasSupport = hasSupport || planeResult.supportCount >= this.config.minimumFloorSupportPoints;
        }
        if (planeResult.supportCount > 0 && Math.abs(plane.normal[1]) <= 0.5) {
          // 床以外のPlaneとの実接触を、床1点支持bodyの外部支持候補へ記録します
          nonFloorPlaneContactObserved = true;
        }
        if (stage !== null && planeResult.normalImpulseApplied) {
          stage.afterPlane = [...linearVelocity, length3(angularVelocity)];
          stage.events[2] = iteration + 1;
          stage.events[3] = planeIndex + 1;
        }
      }
    }
    const wallSupportObserved = wallSupportImpulseY > 0;
    const floorOnePointExternalContact = floorContactObserved
      && floorSupportPoints < this.config.minimumFloorSupportPoints
      && (bodyContactObserved || nonFloorPlaneContactObserved);
    const combinedSupport = floorSupportPoints >= this.config.minimumFloorSupportPoints
      || bodySupportObserved
      || wallSupportObserved
      || floorOnePointExternalContact;
    if (floorContactObserved) {
      // 床1点だけでも同じstepにbodyまたは壁との実接触があれば、外部接触付き支持として扱います
      hasSupport = (hasSupport && combinedSupport) || floorOnePointExternalContact;
    } else {
      hasSupport = hasSupport || wallSupportObserved;
    }
    const lowMotion = length3(linearVelocity) < this.config.sleepLinearSpeed
      && length3(angularVelocity) < this.config.sleepAngularSpeed;
    const quietContact = maxContactSpeed < this.config.sleepContactSpeed
      && maxNormalSpeed < this.config.sleepNormalSpeed;
    // 床へ密着して自身が静止したbodyは、上載bodyの沈み込み速度をsleep判定から分離します
    // 下側body自身の速度はlowMotionで検査し、上載bodyが強く押し込めばwake条件で再びsolverへ戻します
    const floorSupportLoadSettled = floorContactObserved
      && floorSupportPoints >= this.config.minimumFloorSupportPoints
      && lowMotion;
    let sleepContactQuiet = quietContact || floorSupportLoadSettled;
    // sleep中bodyとの微小な再接触をcounter判定から分離し、active body接触では通常条件を適用します
    const sleepingContactsOnly = bodyContactObserved && !activeDynamicBodyContactObserved;
    const lowMotionWithSleepingContacts = sleepingContactsOnly
      && length3(linearVelocity) < this.config.wakeLinearSpeed
      && length3(angularVelocity) < this.config.wakeAngularSpeed;
    const sleepMotionSettled = lowMotion || lowMotionWithSleepingContacts;
    sleepContactQuiet = sleepContactQuiet || lowMotionWithSleepingContacts;
    let sleepCounter = sourceWasSleeping && wakeAudit.awake ? 0 : sourceBody.sleepCounter;
    let sleepFlag = false;
    if (this.config.persistentSleep
      && sourceBody.allowSleep
      && hasSupport
      && sleepMotionSettled
      && sleepContactQuiet) {
      sleepCounter = Math.min(sleepCounter + 1, this.config.sleepSteps);
      if (sleepCounter >= this.config.sleepSteps) {
        linearVelocity = [0, 0, 0];
        angularVelocity = [0, 0, 0];
        sleepFlag = true;
      }
    } else {
      sleepCounter = 0;
    }
    if (stage !== null) {
      stage.end = [...linearVelocity, length3(angularVelocity)];
    }
    if (trace !== null) {
      trace.end = [...linearVelocity, length3(angularVelocity)];
      trace.sleeping = sleepFlag;
    }
    return {
      state: {
        ...cloneState(sourceBody),
        position,
        orientation,
        linearVelocity,
        angularVelocity,
        sleeping: sleepFlag,
        sleepCounter
      },
      stage,
      trace,
      contacts: observedContacts
    };
  }

  // 最新CPU状態をbody ID別に返し、GPU readbackとの差分計算が固定slotへ依存しないようにします
  // 配列を直接公開せず、比較表示側がCPU状態を変更できない複製を返します
  getStates() {
    return new Map(this.states.map((state) => [state.id, Object.freeze(cloneState(state))]));
  }

  // 最新fixed stepの最終反復でsolverが実際に解いた接触を返します
  // narrow phaseを観測用に再実行せず、法線・作用点・penetration・累積力積をそのstepの値から複製します
  getLastContacts() {
    return this.lastContacts.map((contact) => Object.freeze(cloneObservedContact(contact)));
  }

  // 最新fixed stepの全trace body接触履歴を返し、発生源を後段の解析で選べるようにします
  // GPU stateやCPU stateを返すAPIとは分離し、診断を有効にした場合だけ明示的に利用します
  getLastTrace() {
    return cloneStepTrace(this.lastTrace);
  }

  // 直近fixed stepの候補数・接触数・sleep数を返し、solver内部の負荷をFPSと分離して調べます
  // 計測値はstateやaccumulatorを公開せず、次の性能比較で同じstep境界を使えるようにします
  getLastMetrics() {
    return this.lastMetrics === null ? null : Object.freeze({ ...this.lastMetrics });
  }

  // GPU状態とCPU状態の最大差分をbody別に調べ、最初に大きく外れたbodyも残します
  // CPU演算の丸め誤差を隠す許容値は設けず、位置・線速度・角速度・姿勢・sleepを個別に表示します
  compare(gpuStates) {
    if (!(gpuStates instanceof Map)) throw new Error("CpuBoxPhysicsSolver compare gpuStates must be a Map");
    const result = {
      maxPositionError: 0,
      maxLinearError: 0,
      maxAngularError: 0,
      maxOrientationError: 0,
      positionBodyId: null,
      linearBodyId: null,
      angularBodyId: null,
      orientationBodyId: null,
      sleepingMismatchCount: 0
    };
    for (const cpuState of this.states) {
      const gpuState = gpuStates.get(cpuState.id);
      if (!gpuState) throw new Error(`CpuBoxPhysicsSolver GPU state is missing body ${cpuState.id}`);
      const positionError = length3(sub3(cpuState.position, gpuState.position));
      const linearError = length3(sub3(cpuState.linearVelocity, gpuState.linearVelocity));
      const angularError = length3(sub3(cpuState.angularVelocity, gpuState.angularVelocity));
      const orientationError = Math.hypot(
        cpuState.orientation[0] - gpuState.orientation[0],
        cpuState.orientation[1] - gpuState.orientation[1],
        cpuState.orientation[2] - gpuState.orientation[2],
        cpuState.orientation[3] - gpuState.orientation[3]
      );
      if (positionError > result.maxPositionError) {
        result.maxPositionError = positionError;
        result.positionBodyId = cpuState.id;
      }
      if (linearError > result.maxLinearError) {
        result.maxLinearError = linearError;
        result.linearBodyId = cpuState.id;
      }
      if (angularError > result.maxAngularError) {
        result.maxAngularError = angularError;
        result.angularBodyId = cpuState.id;
      }
      if (orientationError > result.maxOrientationError) {
        result.maxOrientationError = orientationError;
        result.orientationBodyId = cpuState.id;
      }
      if (cpuState.sleeping !== gpuState.sleeping) result.sleepingMismatchCount += 1;
    }
    return result;
  }

  // 最初に設定した比較限界を越えたreadback境界だけを保存し、接触連鎖で差分が増えた位置を追跡します
  // GPU状態へ追従して差分を消す処理を使わず、CPU独立計算の最初の崩れをそのまま診断します
  recordFirstDivergence(phase, fixedStep, comparison) {
    if (this.firstDivergence !== null) return;
    const limits = this.config.divergenceLimits;
    const diverged = comparison.maxPositionError > limits.position
      || comparison.maxLinearError > limits.linear
      || comparison.maxAngularError > limits.angular
      || comparison.maxOrientationError > limits.orientation;
    if (diverged) {
      this.firstDivergence = Object.freeze({
        phase,
        fixedStep,
        ...comparison
      });
    }
  }

  // readback境界の前後でCPUを比較し、進めたfixed step数とB31途中速度を一つにまとめます
  // GPU stateをCPUへコピーして一致させる処理を使わず、差分が拡大する時点をそのまま診断へ渡します
  compareAndAdvance(preGpuStates, postGpuStates, stepCount, preFixedStepCount = null) {
    if (preFixedStepCount !== null) {
      if (!Number.isInteger(preFixedStepCount) || preFixedStepCount < 0) {
        throw new Error("CpuBoxPhysicsSolver preFixedStepCount must be a non-negative integer");
      }
      if (this.fixedStepCount > preFixedStepCount) {
        throw new Error(
          `CpuBoxPhysicsSolver timeline moved backwards: cpu=${this.fixedStepCount} gpu=${preFixedStepCount}`
        );
      }
      // readbackがCPU計算より先に進んだ場合は、GPU stateを補正入力にせずCPUだけを同じstep数まで追い付きます
      const catchUpSteps = preFixedStepCount - this.fixedStepCount;
      if (catchUpSteps > 0) this.advance(catchUpSteps);
    }
    const before = this.compare(preGpuStates);
    this.recordFirstDivergence(
      "before",
      preFixedStepCount ?? this.fixedStepCount,
      before
    );
    const stage = this.advance(stepCount);
    const after = this.compare(postGpuStates);
    this.recordFirstDivergence(
      "after",
      preFixedStepCount === null ? this.fixedStepCount : preFixedStepCount + stepCount,
      after
    );
    this.lastReport = Object.freeze({
      cpuFixedStep: this.fixedStepCount,
      advancedSteps: stepCount,
      catchUpSteps: preFixedStepCount === null ? 0 : Math.max(0, preFixedStepCount - (this.fixedStepCount - stepCount)),
      firstDivergence: this.firstDivergence,
      before,
      after,
      // falling_dominoes専用診断がB29〜B32のpair力積をCoreへ埋め込まずに参照できるよう、独立traceを返します
      trace: this.lastTrace === null ? null : cloneStepTrace(this.lastTrace),
      stage: stage ? {
        ...cloneStage(stage)
      } : null,
      peakStage: cloneStage(this.peakStage)
    });
    return this.lastReport;
  }

  // 最後に計算したCPU/GPU比較結果を読み取り、readback未完了時は明示的にnullを返します
  getLastReport() {
    return this.lastReport;
  }
}
