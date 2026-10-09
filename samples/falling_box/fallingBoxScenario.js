// ---------------------------------------------
// samples/falling_box/fallingBoxScenario.js  2026/08/28
//   Shared falling-box scenario for CPU and Compute samples
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "../../webg/util.js";

// comparison200で使った200体の初期条件を公開sample側へ移します
// CPU PhysicsSpaceとComputePhysicsSpaceは、このscenarioから同じbody列を受け取ります
export const FALLING_BOX_DEFAULT_BODY_COUNT = 200;
export const FALLING_BOX_MAX_BODY_COUNT = 200;
export const FALLING_BOX_DEFAULT_SEED = 20260822;
export const FALLING_BOX_DEFAULT_ANGULAR_SPEED_SCALE = 0.825;
export const FALLING_BOX_ARENA = Object.freeze({
  minX: -0.60,
  maxX: 0.60,
  minZ: -0.60,
  maxZ: 0.60,
  floorY: 0.0
});

// CPUとComputeが共有する重力、Plane、fixed stepを定義します
// CPUではPlane PhysicsNodeへ、Computeではbounds由来のPlane bufferへ変換します
export const FALLING_BOX_WORLD = Object.freeze({
  gravity: Object.freeze([0.0, -4.9, 0.0]),
  fixedTimeStepMs: 1000.0 / 120.0,
  maxSubSteps: 8,
  solverIterations: 14,
  defaultRestitution: 0.0,
  defaultFriction: 0.4,
  planes: Object.freeze([
    Object.freeze({ normal: Object.freeze([0.0, 1.0, 0.0]), planeDistance: 0.0 }),
    Object.freeze({ normal: Object.freeze([1.0, 0.0, 0.0]), planeDistance: FALLING_BOX_ARENA.minX }),
    Object.freeze({ normal: Object.freeze([-1.0, 0.0, 0.0]), planeDistance: -FALLING_BOX_ARENA.maxX }),
    Object.freeze({ normal: Object.freeze([0.0, 0.0, 1.0]), planeDistance: FALLING_BOX_ARENA.minZ }),
    Object.freeze({ normal: Object.freeze([0.0, 0.0, -1.0]), planeDistance: -FALLING_BOX_ARENA.maxZ })
  ])
});

// Compute版の寸法依存値をCPU版にも同じ比率で渡します
// 数値をbackendごとに書き直さず、差が出た場合にsolver処理だけを比較できるようにします
export const FALLING_BOX_SOLVER = Object.freeze({
  persistentSleep: true,
  sleepSteps: 5,
  minimumFloorSupportPoints: 2,
  positionCorrectionBeta: 1.0,
  referenceLength: 0.08,
  broadphasePaddingRatio: 0.0125,
  positionSlopRatio: 0.00625,
  supportFeatureToleranceRatio: 0.125,
  restingRestitutionSpeedRatio: 6.25,
  sleepLinearSpeedRatio: 0.25,
  wakeLinearSpeedRatio: 0.375,
  sleepAngularSpeed: 0.5,
  wakeAngularSpeed: 0.75,
  sleepContactSpeedRatio: 0.125,
  sleepNormalSpeedRatio: 0.25
});

// 本体の種類、寸法、初期姿勢、角速度、材質、色を固定します
// 配置の変化はseed付き生成側へ分離し、backendが個別に条件を変えないようにします
const BASE_BODY_SPECS = Object.freeze([
  Object.freeze({
    role: "long beam", size: Object.freeze([0.10, 0.02, 0.02]),
    attitude: Object.freeze([8.0, 0.0, 14.0]),
    angularVelocityDeg: Object.freeze([16.0, 0.0, 12.0]),
    restitution: 0.02, friction: 0.78, linearDamping: 0.07, angularDamping: 0.10,
    color: Object.freeze([0.92, 0.44, 0.34, 1.0])
  }),
  Object.freeze({
    role: "cube", size: Object.freeze([0.08, 0.08, 0.08]),
    attitude: Object.freeze([14.0, 8.0, 10.0]),
    angularVelocityDeg: Object.freeze([18.0, 14.0, 10.0]),
    restitution: 0.02, friction: 0.70, linearDamping: 0.08, angularDamping: 0.11,
    color: Object.freeze([0.34, 0.72, 0.95, 1.0])
  }),
  Object.freeze({
    role: "flat plate", size: Object.freeze([0.09, 0.018, 0.06]),
    attitude: Object.freeze([0.0, -10.0, 16.0]),
    angularVelocityDeg: Object.freeze([14.0, 0.0, 18.0]),
    restitution: 0.015, friction: 0.82, linearDamping: 0.08, angularDamping: 0.11,
    color: Object.freeze([0.40, 0.84, 0.54, 1.0])
  }),
  Object.freeze({
    role: "tall column", size: Object.freeze([0.03, 0.10, 0.03]),
    attitude: Object.freeze([6.0, 0.0, -10.0]),
    angularVelocityDeg: Object.freeze([12.0, 0.0, 16.0]),
    restitution: 0.015, friction: 0.76, linearDamping: 0.08, angularDamping: 0.10,
    color: Object.freeze([0.92, 0.80, 0.34, 1.0])
  }),
  Object.freeze({
    role: "deep block", size: Object.freeze([0.05, 0.05, 0.09]),
    attitude: Object.freeze([10.0, 10.0, 0.0]),
    angularVelocityDeg: Object.freeze([16.0, 12.0, 14.0]),
    restitution: 0.02, friction: 0.72, linearDamping: 0.09, angularDamping: 0.11,
    color: Object.freeze([0.76, 0.60, 0.90, 1.0])
  })
]);
const BODY_SPEC_ORDER = Object.freeze([0, 2, 3, 4, 1, 0, 2, 4, 3]);

// body数を検証し、200体を超えた値を静かに切り詰めないようにします
// 生成数を変える場合も、比較条件の誤りを呼出時点で発見できるようにします
export function validateFallingBoxBodyCount(count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > FALLING_BOX_MAX_BODY_COUNT) {
    throw new Error(
      `falling_box body count must be an integer from 1 to ${FALLING_BOX_MAX_BODY_COUNT}: ${count}`
    );
  }
  return count;
}

// seed付き乱数から初期配置の小さな揺らぎを作ります
// Math.randomを使わず、CPU/Computeと複数回の実行で同じscenarioを再現します
function randomRange(random, minimum, maximum) {
  return minimum + (maximum - minimum) * random.random();
}

// degree指定の初期姿勢をwebgの[w,x,y,z]順へ変換します
// CPU PhysicsNodeとCompute BodyStateが同じ姿勢から積分を始められるようにします
function eulerDegreesToQuaternion(xDegrees, yDegrees, zDegrees) {
  const x = xDegrees * Math.PI / 360.0;
  const y = yDegrees * Math.PI / 360.0;
  const z = zDegrees * Math.PI / 360.0;
  const cx = Math.cos(x); const sx = Math.sin(x);
  const cy = Math.cos(y); const sy = Math.sin(y);
  const cz = Math.cos(z); const sz = Math.sin(z);
  return [
    cx * cy * cz + sx * sy * sz,
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz
  ];
}

// rawな200体の配置・姿勢・角速度・材質を生成します
// bodyの並びを固定し、Computeのstate slotとCPUのPhysicsNode登録順を一致させます
function createRawBodySpecs(count, seed) {
  const random = new util.MersenneTwister(seed);
  const columnsPerLayer = 4;
  const rowsPerLayer = 4;
  const bodiesPerLayer = columnsPerLayer * rowsPerLayer;
  const specs = [];
  for (let index = 0; index < count; index += 1) {
    const base = BASE_BODY_SPECS[BODY_SPEC_ORDER[index % BODY_SPEC_ORDER.length]];
    const layer = Math.floor(index / bodiesPerLayer);
    const layerIndex = index % bodiesPerLayer;
    const row = Math.floor(layerIndex / columnsPerLayer);
    const column = layerIndex % columnsPerLayer;
    specs.push(Object.freeze({
      name: `box_${index}`,
      role: `${base.role} ${index}`,
      size: Object.freeze([...base.size]),
      position: Object.freeze([
        -0.27 + column * 0.10 + randomRange(random, -0.025, 0.025),
        1.0 + layer * 0.10 + row * 0.05,
        -0.21 + row * 0.10 + randomRange(random, -0.010, 0.010)
      ]),
      attitude: Object.freeze([
        base.attitude[0] + ((index % 3) - 1) * 4.0,
        base.attitude[1] + ((index % 5) - 2) * 3.0,
        base.attitude[2] + ((index % 4) - 1.5) * 3.5
      ]),
      velocity: Object.freeze([0.0, 0.0, 0.0]),
      angularVelocityDeg: Object.freeze([
        base.angularVelocityDeg[0] + (index % 4) * 0.4,
        base.angularVelocityDeg[1] + (index % 3) * 0.5,
        base.angularVelocityDeg[2] + (index % 5) * 0.4
      ]),
      restitution: base.restitution,
      friction: base.friction,
      linearDamping: base.linearDamping,
      angularDamping: base.angularDamping,
      color: Object.freeze([...base.color])
    }));
  }
  return Object.freeze(specs);
}

// CPU PhysicsSpaceとComputePhysicsSpaceが共有するbody descriptorを作ります
// 角速度だけは共通単位のrad/secへ変換し、CPU API側のdegree/sec変換はNode生成境界へ残します
function createBodyDescriptors(rawSpecs, initialAngularSpeedScale) {
  return Object.freeze(rawSpecs.map((spec, index) => Object.freeze({
    id: index + 1,
    bodyType: "dynamic",
    motionMode: "none",
    position: spec.position,
    orientation: Object.freeze(eulerDegreesToQuaternion(...spec.attitude)),
    linearVelocity: spec.velocity,
    angularVelocity: Object.freeze(spec.angularVelocityDeg.map(
      (value) => value * initialAngularSpeedScale * Math.PI / 180.0
    )),
    mass: 1.0,
    gravityScale: 1.0,
    allowSleep: true,
    isSleeping: false,
    isTrigger: false,
    fixedRotation: false,
    collisionLayer: 1,
    collisionMask: 0xffffffff,
    material: Object.freeze({
      restitution: spec.restitution,
      friction: spec.friction
    }),
    linearDamping: spec.linearDamping,
    angularDamping: spec.angularDamping,
    shape: Object.freeze({
      type: "box",
      size: spec.size
    })
  })));
}

// CPU/Computeへ渡す比較条件を一つの読み取り専用scenarioへまとめます
// HTMLがbackendを選んでも、seed・body・Plane・solver設定は同じ値を使います
export function createFallingBoxScenario(options = {}) {
  const opts = util.readPlainObject(options, "falling_box scenario options", {});
  const count = opts.count === undefined
    ? FALLING_BOX_DEFAULT_BODY_COUNT
    : validateFallingBoxBodyCount(opts.count);
  const seed = opts.seed === undefined
    ? FALLING_BOX_DEFAULT_SEED
    : util.readFiniteNumber(opts.seed, "falling_box scenario seed", { integer: true });
  const initialAngularSpeedScale = opts.initialAngularSpeedScale === undefined
    ? FALLING_BOX_DEFAULT_ANGULAR_SPEED_SCALE
    : util.readFiniteNumber(
      opts.initialAngularSpeedScale,
      "falling_box initialAngularSpeedScale",
      { min: 0.0 }
    );
  const rawBodySpecs = createRawBodySpecs(count, seed);
  return Object.freeze({
    id: "fallingBox200",
    label: "falling box 200",
    count,
    seed,
    initialAngularSpeedScale,
    arena: FALLING_BOX_ARENA,
    world: FALLING_BOX_WORLD,
    solver: FALLING_BOX_SOLVER,
    rawBodySpecs,
    bodies: createBodyDescriptors(rawBodySpecs, initialAngularSpeedScale)
  });
}
