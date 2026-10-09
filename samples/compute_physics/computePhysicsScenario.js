// ---------------------------------------------
// samples/compute_physics/computePhysicsScenario.js  2026/08/29
//   Shared mixed-shape scenario for CPU and Compute comparison pages
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Compute版とCPU版へ同じ条件を渡すための固定値を公開します
// backendごとにbody数、境界、初期高さを書き直さず、動作差と速度差を分けて確認できるようにします
export const COMPUTE_PHYSICS_BODY_COUNT = 72;
export const COMPUTE_PHYSICS_BOUNDS = Object.freeze({
  minX: -3.6,
  maxX: 3.6,
  minZ: -2.6,
  maxZ: 2.6,
  floorY: 0.0
});
export const COMPUTE_PHYSICS_WORLD = Object.freeze({
  gravity: Object.freeze([0.0, -9.80665, 0.0]),
  fixedTimeStepMs: 1000.0 / 120.0,
  maxSubSteps: 8,
  solverIterations: 14,
  defaultRestitution: 0.0,
  defaultFriction: 0.4,
  persistentSleep: true,
  referenceLength: 0.45,
  planes: Object.freeze([
    Object.freeze({ normal: Object.freeze([0.0, 1.0, 0.0]), planeDistance: 0.0 }),
    Object.freeze({ normal: Object.freeze([1.0, 0.0, 0.0]), planeDistance: COMPUTE_PHYSICS_BOUNDS.minX }),
    Object.freeze({ normal: Object.freeze([-1.0, 0.0, 0.0]), planeDistance: -COMPUTE_PHYSICS_BOUNDS.maxX }),
    Object.freeze({ normal: Object.freeze([0.0, 0.0, 1.0]), planeDistance: COMPUTE_PHYSICS_BOUNDS.minZ }),
    Object.freeze({ normal: Object.freeze([0.0, 0.0, -1.0]), planeDistance: -COMPUTE_PHYSICS_BOUNDS.maxZ })
  ])
});
export const COMPUTE_PHYSICS_SCALE = Object.freeze({
  broadphasePaddingRatio: 0.0125,
  positionSlopRatio: 0.00625,
  supportFeatureToleranceRatio: 0.125,
  restingRestitutionSpeedRatio: 6.25,
  sleepLinearSpeedRatio: 0.25,
  wakeLinearSpeedRatio: 0.375,
  sleepContactSpeedRatio: 0.125,
  sleepNormalSpeedRatio: 0.25,
  sleepAngularSpeed: 0.5,
  wakeAngularSpeed: 0.75,
  sleepSteps: 5,
  minimumFloorSupportPoints: 2
});

const INITIAL_BODY_HEIGHT = 4.6;
const BOX_RESTITUTION = 0.12;
const SPHERE_RESTITUTION = 0.72;
const CAPSULE_RESTITUTION = 0.5;
const CAPSULE_RADIUS_RATIO = 0.22;
const CAPSULE_SEGMENT_RATIO = 0.70;
const CAPSULE_COLORS = Object.freeze({
  capsule: Object.freeze([1.0, 0.62, 0.16, 1.0]),
  sphere: Object.freeze([0.12, 0.62, 1.0, 1.0])
});

// indexから決定的な0以上1未満の値を作り、CPU版とCompute版で同じ揺らぎを使います
// Math.randomを使わないため、reset後とbackend切替後も同じ初期配置を再現します
function hash01(value) {
  const raw = Math.sin(value * 91.3458 + 17.123) * 47453.5453;
  return raw - Math.floor(raw);
}

// Box、Sphere、Capsuleを格子配置し、3形状とPlaneの接触が発生する共通body記述を作ります
// colliderはbackend側で明示的に生成し、形状typeと寸法を共通descriptorへ渡します
export function createComputePhysicsScenario() {
  const palette = [
    [0.95, 0.34, 0.26, 1.0], [0.18, 0.68, 0.96, 1.0], [0.98, 0.72, 0.18, 1.0],
    [0.34, 0.84, 0.50, 1.0], [0.75, 0.43, 0.96, 1.0], [0.96, 0.45, 0.68, 1.0]
  ];
  const bodies = Array.from({ length: COMPUTE_PHYSICS_BODY_COUNT }, (_, index) => {
    const column = index % 8;
    const depth = Math.floor(index / 8) % 3;
    const layer = Math.floor(index / 24);
    const kind = index % 3;
    const shapeType = kind === 0 ? "sphere" : kind === 1 ? "capsule" : "box";
    const size = 0.40 + hash01(index * 2.71) * 0.10;
    const shape = shapeType === "sphere"
      ? { type: "sphere", radius: size * 0.5 }
      : shapeType === "capsule"
        ? {
          type: "capsule",
          radius: size * CAPSULE_RADIUS_RATIO,
          segmentLength: size * CAPSULE_SEGMENT_RATIO
        }
        : { type: "box", size: [size, size * 0.86, size * 1.10] };
    return Object.freeze({
      id: index + 1,
      bodyType: "dynamic",
      motionMode: "none",
      position: Object.freeze([
        -2.65 + column * 0.76,
        INITIAL_BODY_HEIGHT + layer * 0.62,
        -0.82 + depth * 0.82
      ]),
      orientation: Object.freeze([
        1.0,
        0.0,
        shapeType === "sphere" ? 0.0 : (hash01(index * 3.17) - 0.5) * 0.28,
        0.0
      ]),
      linearVelocity: Object.freeze([
        (hash01(index * 5.11) - 0.5) * 0.35,
        0.0,
        (hash01(index * 7.19) - 0.5) * 0.25
      ]),
      angularVelocity: Object.freeze(shapeType === "sphere"
        ? [0.0, 0.0, 0.0]
        : [(hash01(index) - 0.5) * 0.8, 0.3, 0.0]),
      mass: 0.8 + hash01(index * 11.3) * 0.8,
      gravityScale: 1.0,
      allowSleep: true,
      isSleeping: false,
      isTrigger: false,
      fixedRotation: false,
      collisionLayer: 1,
      collisionMask: 0xffffffff,
      material: Object.freeze({
        restitution: shapeType === "sphere"
          ? SPHERE_RESTITUTION
          : shapeType === "capsule" ? CAPSULE_RESTITUTION : BOX_RESTITUTION,
        friction: 0.72,
        linearDamping: 0.08,
        angularDamping: 0.16
      }),
      shape: Object.freeze(shape),
      color: Object.freeze(shapeType === "capsule"
        ? [...CAPSULE_COLORS.capsule]
        : shapeType === "sphere"
          ? [...CAPSULE_COLORS.sphere]
          : [...palette[index % palette.length]])
    });
  });
  return Object.freeze({
    id: "computePhysics72",
    bodyCount: COMPUTE_PHYSICS_BODY_COUNT,
    bounds: COMPUTE_PHYSICS_BOUNDS,
    world: COMPUTE_PHYSICS_WORLD,
    scale: COMPUTE_PHYSICS_SCALE,
    bodies: Object.freeze(bodies)
  });
}
