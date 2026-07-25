// ---------------------------------------------
// headless_tests/diagnostics/physics_collider/headless_probe.js  2026/05/09
//   physics_collider headless probe
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Space from "../../../webg/Space.js";
import BoxCollider from "../../../webg/BoxCollider.js";
import PlaneCollider from "../../../webg/PlaneCollider.js";
import PhysicsSpace from "../../../webg/PhysicsSpace.js";

// このスクリプトは visual unittest の代わりに、PhysicsSpace を headless で進めながら
// beam が立ち上がる瞬間の contact 数、impulse、姿勢変化を数値で追跡する
// 見た目では「踊る」と感じる現象を、
// 「何フレーム single-point contact が続き、その間にどの軸角速度が増えているか」
// として切り分けるための診断用入口として使う

const FIXED_TIME_STEP_MS = 1000.0 / 120.0;
const SIM_DURATION_MS = 8000.0;
const FLOOR_Y = 0.0;
const BEAM_SIZE = [0.10, 0.02, 0.02];
const CUBE_SIZE = [0.06, 0.06, 0.06];
const PLATE_SIZE = [0.09, 0.018, 0.06];
const COLUMN_SIZE = [0.03, 0.10, 0.03];
const DEEP_BLOCK_SIZE = [0.05, 0.05, 0.09];
const RANDOM_TRIAL_COUNT = 40;

const formatVec3 = (vec, digits = 4) => (
  `[${vec.map((value) => value.toFixed(digits)).join(", ")}]`
);

const lengthVec3 = (vec) => Math.hypot(vec[0], vec[1], vec[2]);

const dotVec3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const createMulberry32 = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const lerp = (a, b, t) => a + (b - a) * t;

const rotateVec3ByQuat = (vec, quat) => {
  const q = Array.isArray(quat?.q) ? quat.q : [1.0, 0.0, 0.0, 0.0];
  const w = q[0];
  const x = q[1];
  const y = q[2];
  const z = q[3];
  const vx = vec[0];
  const vy = vec[1];
  const vz = vec[2];
  const tx = 2.0 * (y * vz - z * vy);
  const ty = 2.0 * (z * vx - x * vz);
  const tz = 2.0 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx)
  ];
};

// beam の local X 軸を world へ回して、どの程度上方向を向いているかを返す
// 1.0 に近いほど「beam が立っている」
const getBeamUprightness = (body) => {
  const beamAxis = rotateVec3ByQuat([1.0, 0.0, 0.0], body.getQuat());
  return Math.abs(dotVec3(beamAxis, [0.0, 1.0, 0.0]));
};

const createWorld = (options = {}) => new PhysicsSpace({
  gravity: [0.0, -9.8, 0.0],
  fixedTimeStepMs: FIXED_TIME_STEP_MS,
  maxSubSteps: 1,
  solverIterations: options.solverIterations ?? 7,
  defaultRestitution: 0.01,
  defaultFriction: 0.72,
  sleepLinearThreshold: 0.06,
  sleepAngularThreshold: 8.0,
  sleepStepsThreshold: 12
});

const createFloor = (space, world) => {
  const floor = space.addPhysicsNode(null, "floor", {
    bodyType: "static"
  });
  floor.setPosition(0.0, FLOOR_Y, 0.0);
  floor.setCollider(new PlaneCollider([0.0, 1.0, 0.0]));
  floor.setPhysicsMaterial({
    restitution: 0.0,
    friction: 0.88
  });
  world.addBody(floor);
  return floor;
};

const createBeam = (space, world, options = {}) => {
  const body = space.addPhysicsNode(null, options.name ?? "beam", {
    bodyType: "kinematic",
    mass: 1.0,
    linearDamping: options.linearDamping ?? 0.07,
    angularDamping: options.angularDamping ?? 0.10
  });
  body.setPosition(
    options.position?.[0] ?? 0.0,
    options.position?.[1] ?? 0.18,
    options.position?.[2] ?? 0.0
  );
  body.setAttitude(
    options.attitude?.[0] ?? 8.0,
    options.attitude?.[1] ?? 0.0,
    options.attitude?.[2] ?? 14.0
  );
  body.setCollider(new BoxCollider(options.size ?? BEAM_SIZE));
  body.setPhysicsMaterial({
    restitution: options.restitution ?? 0.02,
    friction: options.friction ?? 0.78
  });
  if (Number.isFinite(options.inertiaScale) && options.inertiaScale > 0.0 && options.inertiaScale !== 1.0) {
    const baseInertia = body.getInertia();
    body.setInertia([
      baseInertia[0] * options.inertiaScale,
      baseInertia[1] * options.inertiaScale,
      baseInertia[2] * options.inertiaScale
    ]);
  }
  body.setLinearVelocityVec(options.velocity ?? [0.0, 0.0, 0.0]);
  body.setAngularVelocityVec(options.angularVelocity ?? [16.0, 0.0, 12.0]);
  body.setBodyType("dynamic", {
    clearVelocity: false,
    restoreVelocity: false
  });
  world.addBody(body);
  return body;
};

const createCube = (space, world, options = {}) => {
  const body = space.addPhysicsNode(null, options.name ?? "cube", {
    bodyType: "kinematic",
    mass: 1.0,
    linearDamping: options.linearDamping ?? 0.08,
    angularDamping: options.angularDamping ?? 0.11
  });
  body.setPosition(
    options.position?.[0] ?? 0.0,
    options.position?.[1] ?? 0.18,
    options.position?.[2] ?? 0.0
  );
  body.setAttitude(
    options.attitude?.[0] ?? 14.0,
    options.attitude?.[1] ?? 8.0,
    options.attitude?.[2] ?? 10.0
  );
  body.setCollider(new BoxCollider(options.size ?? CUBE_SIZE));
  body.setPhysicsMaterial({
    restitution: options.restitution ?? 0.02,
    friction: options.friction ?? 0.70
  });
  body.setLinearVelocityVec(options.velocity ?? [0.0, 0.0, 0.0]);
  body.setAngularVelocityVec(options.angularVelocity ?? [18.0, 14.0, 10.0]);
  body.setBodyType("dynamic", {
    clearVelocity: false,
    restoreVelocity: false
  });
  world.addBody(body);
  return body;
};

const createBodyFromSpec = (space, world, spec) => {
  const body = space.addPhysicsNode(null, spec.name, {
    bodyType: "kinematic",
    mass: 1.0,
    linearDamping: spec.linearDamping,
    angularDamping: spec.angularDamping
  });
  body.setPosition(
    spec.position?.[0] ?? 0.0,
    spec.position?.[1] ?? 0.18,
    spec.position?.[2] ?? 0.0
  );
  body.setAttitude(
    spec.attitude[0],
    spec.attitude[1],
    spec.attitude[2]
  );
  body.setCollider(new BoxCollider(spec.size));
  body.setPhysicsMaterial({
    restitution: spec.restitution,
    friction: spec.friction
  });
  body.setLinearVelocityVec(spec.velocity ?? [0.0, 0.0, 0.0]);
  body.setAngularVelocityVec(spec.angularVelocity);
  body.setBodyType("dynamic", {
    clearVelocity: false,
    restoreVelocity: false
  });
  world.addBody(body);
  return body;
};

const summarizeManifold = (manifold) => {
  const normalImpulseSum = manifold.contacts.reduce(
    (sum, contact) => sum + Math.max(0.0, contact.normalImpulse ?? 0.0),
    0.0
  );
  const tangentImpulseMagnitude = manifold.contacts.reduce(
    (sum, contact) => sum + lengthVec3(contact.tangentImpulse ?? [0.0, 0.0, 0.0]),
    0.0
  );
  return {
    contactCount: manifold.contacts.length,
    normal: [...manifold.normal],
    maxPenetration: Math.max(...manifold.contacts.map((contact) => contact.penetration ?? 0.0)),
    normalImpulseSum,
    tangentImpulseMagnitude,
    sharedTangentImpulseMagnitude: lengthVec3(
      manifold.sharedTangentImpulse
        ?? manifold.supportTangentImpulse
        ?? [0.0, 0.0, 0.0]
    )
  };
};

const runScenario = (label, beamOptions) => {
  const space = new Space();
  const world = createWorld({
    solverIterations: beamOptions.solverIterations
  });
  createFloor(space, world);
  const beam = createBeam(space, world, beamOptions);

  let maxUprightness = getBeamUprightness(beam);
  let maxCenterY = beam.getPosition()[1];
  let firstStandTimeMs = null;
  let singleContactFrames = 0;
  let multiContactFrames = 0;
  let noContactFrames = 0;
  let maxNormalImpulseSum = 0.0;
  let maxTangentImpulseMagnitude = 0.0;
  let peakAngularVelocity = [...beam.getAngularVelocity()];
  const notableFrames = [];

  for (let elapsedMs = 0.0; elapsedMs < SIM_DURATION_MS; elapsedMs += FIXED_TIME_STEP_MS) {
    world.step(FIXED_TIME_STEP_MS);
    const position = beam.getPosition();
    const angularVelocity = beam.getAngularVelocity();
    const uprightness = getBeamUprightness(beam);
    const manifolds = world.getLastManifolds().filter((manifold) => (
      manifold.bodyA === beam || manifold.bodyB === beam
    ));
    const contacts = world.getLastContacts().filter((contact) => (
      contact.bodyA === beam || contact.bodyB === beam
    ));
    const contactCount = contacts.length;

    maxUprightness = Math.max(maxUprightness, uprightness);
    maxCenterY = Math.max(maxCenterY, position[1]);
    if (lengthVec3(angularVelocity) > lengthVec3(peakAngularVelocity)) {
      peakAngularVelocity = [...angularVelocity];
    }
    if (uprightness >= 0.85 && firstStandTimeMs === null) {
      firstStandTimeMs = elapsedMs;
    }

    if (contactCount <= 0) {
      noContactFrames += 1;
    } else if (contactCount === 1) {
      singleContactFrames += 1;
    } else {
      multiContactFrames += 1;
    }

    for (let i = 0; i < manifolds.length; i++) {
      const summary = summarizeManifold(manifolds[i]);
      maxNormalImpulseSum = Math.max(maxNormalImpulseSum, summary.normalImpulseSum);
      maxTangentImpulseMagnitude = Math.max(maxTangentImpulseMagnitude, summary.tangentImpulseMagnitude);
      if (
        summary.contactCount === 1
        || uprightness >= 0.85
        || summary.maxPenetration >= 0.006
      ) {
        notableFrames.push({
          timeMs: elapsedMs,
          position: [...position],
          angularVelocity: [...angularVelocity],
          uprightness,
          manifold: summary
        });
      }
    }
  }

  const firstFrames = notableFrames.slice(0, 12);
  const lastFrames = notableFrames.slice(-12);

  console.log(`\n=== ${label} ===`);
  console.log(`final position: ${formatVec3(beam.getPosition())}`);
  console.log(`final angularVelocity(deg/s): ${formatVec3(beam.getAngularVelocity())}`);
  console.log(`max uprightness: ${maxUprightness.toFixed(4)}`);
  console.log(`first stand time ms (uprightness>=0.85): ${firstStandTimeMs ?? "never"}`);
  console.log(`max centerY: ${maxCenterY.toFixed(4)}`);
  console.log(`contact frames: single=${singleContactFrames} multi=${multiContactFrames} none=${noContactFrames}`);
  console.log(`peak angularVelocity(deg/s): ${formatVec3(peakAngularVelocity)}`);
  console.log(`max normalImpulseSum: ${maxNormalImpulseSum.toFixed(6)}`);
  console.log(`max tangentImpulseMagnitude: ${maxTangentImpulseMagnitude.toFixed(6)}`);
  console.log("first notable frames:");
  for (let i = 0; i < firstFrames.length; i++) {
    const frame = firstFrames[i];
    console.log(
      `  t=${frame.timeMs.toFixed(1)} y=${frame.position[1].toFixed(4)} upright=${frame.uprightness.toFixed(4)} `
      + `ang=${formatVec3(frame.angularVelocity, 3)} contacts=${frame.manifold.contactCount} `
      + `pen=${frame.manifold.maxPenetration.toFixed(6)} `
      + `nImp=${frame.manifold.normalImpulseSum.toFixed(6)} `
      + `tImp=${frame.manifold.tangentImpulseMagnitude.toFixed(6)} `
      + `shared=${frame.manifold.sharedTangentImpulseMagnitude.toFixed(6)} `
      + `normal=${formatVec3(frame.manifold.normal, 3)}`
    );
  }
  console.log("last notable frames:");
  for (let i = 0; i < lastFrames.length; i++) {
    const frame = lastFrames[i];
    console.log(
      `  t=${frame.timeMs.toFixed(1)} y=${frame.position[1].toFixed(4)} upright=${frame.uprightness.toFixed(4)} `
      + `ang=${formatVec3(frame.angularVelocity, 3)} contacts=${frame.manifold.contactCount} `
      + `pen=${frame.manifold.maxPenetration.toFixed(6)} `
      + `nImp=${frame.manifold.normalImpulseSum.toFixed(6)} `
      + `tImp=${frame.manifold.tangentImpulseMagnitude.toFixed(6)} `
      + `shared=${frame.manifold.sharedTangentImpulseMagnitude.toFixed(6)} `
      + `normal=${formatVec3(frame.manifold.normal, 3)}`
    );
  }
};

const runBeamStackScenario = (label, options = {}) => {
  const space = new Space();
  const world = createWorld({
    solverIterations: options.solverIterations
  });
  createFloor(space, world);

  const beams = [];
  const count = options.count ?? 12;
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 4);
    const col = i % 4;
    beams.push(createBeam(space, world, {
      name: `beam_stack_${i}`,
      position: [
        -0.18 + col * 0.12,
        0.18 + row * 0.08,
        -0.08 + row * 0.05
      ],
      attitude: [
        4.0 + row * 3.0,
        (col - 1.5) * 5.0,
        10.0 + row * 4.0
      ],
      angularVelocity: options.angularVelocity ?? [0.0, 0.0, 0.0],
      inertiaScale: options.inertiaScale
    }));
  }

  let maxStandingCount = 0;
  for (let elapsedMs = 0.0; elapsedMs < SIM_DURATION_MS; elapsedMs += FIXED_TIME_STEP_MS) {
    world.step(FIXED_TIME_STEP_MS);
    let standingCount = 0;
    for (let i = 0; i < beams.length; i++) {
      if (getBeamUprightness(beams[i]) >= 0.85) {
        standingCount += 1;
      }
    }
    maxStandingCount = Math.max(maxStandingCount, standingCount);
  }

  const finalStanding = beams.filter((beam) => getBeamUprightness(beam) >= 0.85);
  const manifolds = world.getLastManifolds();
  console.log(`\n=== ${label} ===`);
  console.log(`final standing beams: ${finalStanding.length}/${beams.length}`);
  console.log(`max standing beams during sim: ${maxStandingCount}/${beams.length}`);
  for (let i = 0; i < beams.length; i++) {
    console.log(
      `  ${beams[i].name}: upright=${getBeamUprightness(beams[i]).toFixed(4)} `
      + `pos=${formatVec3(beams[i].getPosition())} `
      + `ang=${formatVec3(beams[i].getAngularVelocity(), 3)}`
    );
  }
  if (finalStanding.length > 0) {
    console.log("standing beam supports:");
    for (let i = 0; i < finalStanding.length; i++) {
      const beam = finalStanding[i];
      const ownManifolds = manifolds.filter((manifold) => (
        manifold.bodyA === beam || manifold.bodyB === beam
      ));
      console.log(`  ${beam.name}:`);
      for (let j = 0; j < ownManifolds.length; j++) {
        const manifold = ownManifolds[j];
        const otherBody = manifold.bodyA === beam ? manifold.bodyB : manifold.bodyA;
        console.log(
          `    with ${otherBody?.name ?? "(unknown)"} `
          + `type=${otherBody?.getCollider?.()?.type ?? "(none)"} `
          + `body=${otherBody?.isStatic?.() === true ? "static" : (otherBody?.isDynamic?.() === true ? "dynamic" : "other")} `
          + `contacts=${manifold.contacts.length} `
          + `normal=${formatVec3(manifold.normal, 3)} `
          + `penetrations=[${manifold.contacts.map((contact) => (
            (contact.penetration ?? 0.0).toFixed(6)
          )).join(", ")}]`
        );
      }
    }
  }
};

const runCubeScenario = (label, cubeOptions = {}) => {
  const space = new Space();
  const world = createWorld({
    solverIterations: cubeOptions.solverIterations
  });
  createFloor(space, world);
  const cube = createCube(space, world, cubeOptions);

  let maxCenterY = cube.getPosition()[1];
  let minCenterY = cube.getPosition()[1];
  let maxAngularSpeed = lengthVec3(cube.getAngularVelocity());

  for (let elapsedMs = 0.0; elapsedMs < SIM_DURATION_MS; elapsedMs += FIXED_TIME_STEP_MS) {
    world.step(FIXED_TIME_STEP_MS);
    const position = cube.getPosition();
    const angularVelocity = cube.getAngularVelocity();
    maxCenterY = Math.max(maxCenterY, position[1]);
    minCenterY = Math.min(minCenterY, position[1]);
    maxAngularSpeed = Math.max(maxAngularSpeed, lengthVec3(angularVelocity));
  }

  const manifolds = world.getLastManifolds().filter((manifold) => (
    manifold.bodyA === cube || manifold.bodyB === cube
  ));
  console.log(`\n=== ${label} ===`);
  console.log(`final position: ${formatVec3(cube.getPosition())}`);
  console.log(`final angularVelocity(deg/s): ${formatVec3(cube.getAngularVelocity())}`);
  console.log(`centerY range: min=${minCenterY.toFixed(4)} max=${maxCenterY.toFixed(4)}`);
  console.log(`peak angular speed(deg/s): ${maxAngularSpeed.toFixed(4)}`);
  console.log("final supports:");
  for (let i = 0; i < manifolds.length; i++) {
    const manifold = manifolds[i];
    const otherBody = manifold.bodyA === cube ? manifold.bodyB : manifold.bodyA;
    console.log(
      `  with ${otherBody?.name ?? "(unknown)"} `
      + `type=${otherBody?.getCollider?.()?.type ?? "(none)"} `
      + `body=${otherBody?.isStatic?.() === true ? "static" : (otherBody?.isDynamic?.() === true ? "dynamic" : "other")} `
      + `contacts=${manifold.contacts.length} `
      + `normal=${formatVec3(manifold.normal, 3)} `
      + `penetrations=[${manifold.contacts.map((contact) => (
        (contact.penetration ?? 0.0).toFixed(6)
      )).join(", ")}]`
    );
  }
};

const runRestShapeScenario = (label, spec) => {
  const space = new Space();
  const world = createWorld({
    solverIterations: spec.solverIterations
  });
  createFloor(space, world);
  const body = createBodyFromSpec(space, world, {
    ...spec,
    position: spec.position ?? [0.0, 0.18, 0.0],
    velocity: spec.velocity ?? [0.0, 0.0, 0.0]
  });

  let minCenterY = body.getPosition()[1];
  let maxCenterY = body.getPosition()[1];
  let maxAngularSpeed = lengthVec3(body.getAngularVelocity());

  for (let elapsedMs = 0.0; elapsedMs < SIM_DURATION_MS; elapsedMs += FIXED_TIME_STEP_MS) {
    world.step(FIXED_TIME_STEP_MS);
    const position = body.getPosition();
    const angularSpeed = lengthVec3(body.getAngularVelocity());
    minCenterY = Math.min(minCenterY, position[1]);
    maxCenterY = Math.max(maxCenterY, position[1]);
    maxAngularSpeed = Math.max(maxAngularSpeed, angularSpeed);
  }

  const manifolds = world.getLastManifolds().filter((manifold) => (
    manifold.bodyA === body || manifold.bodyB === body
  ));
  console.log(`\n=== ${label} ===`);
  console.log(`final position: ${formatVec3(body.getPosition())}`);
  console.log(`final angularVelocity(deg/s): ${formatVec3(body.getAngularVelocity())}`);
  console.log(`centerY range: min=${minCenterY.toFixed(4)} max=${maxCenterY.toFixed(4)}`);
  console.log(`peak angular speed(deg/s): ${maxAngularSpeed.toFixed(4)}`);
  console.log("final supports:");
  for (let i = 0; i < manifolds.length; i++) {
    const manifold = manifolds[i];
    const otherBody = manifold.bodyA === body ? manifold.bodyB : manifold.bodyA;
    console.log(
      `  with ${otherBody?.name ?? "(unknown)"} `
      + `type=${otherBody?.getCollider?.()?.type ?? "(none)"} `
      + `body=${otherBody?.isStatic?.() === true ? "static" : (otherBody?.isDynamic?.() === true ? "dynamic" : "other")} `
      + `contacts=${manifold.contacts.length} `
      + `normal=${formatVec3(manifold.normal, 3)} `
      + `penetrations=[${manifold.contacts.map((contact) => (
        (contact.penetration ?? 0.0).toFixed(6)
      )).join(", ")}]`
    );
  }
};

const runRandomRestStressScenario = (label, spec, options = {}) => {
  const trialCount = options.trialCount ?? RANDOM_TRIAL_COUNT;
  const seed = options.seed ?? 0x12345678;
  const random = createMulberry32(seed);
  const maxAllowedAngularSpeed = options.maxAllowedAngularSpeed ?? 6.0;
  const maxAllowedHeight = options.maxAllowedHeight
    ?? (Math.min(spec.size[0], spec.size[1], spec.size[2]) * 0.5 + 0.020);
  const failures = [];
  let maxFinalCenterY = -Infinity;
  let maxFinalAngularSpeed = -Infinity;

  for (let i = 0; i < trialCount; i++) {
    const space = new Space();
    const world = createWorld({
      solverIterations: options.solverIterations
    });
    createFloor(space, world);
    const attitudeJitter = [
      lerp(-22.0, 22.0, random()),
      lerp(-22.0, 22.0, random()),
      lerp(-22.0, 22.0, random())
    ];
    const angularScale = lerp(0.65, 1.45, random());
    const angularVelocity = [
      spec.angularVelocity[0] * angularScale + lerp(-6.0, 6.0, random()),
      spec.angularVelocity[1] * angularScale + lerp(-6.0, 6.0, random()),
      spec.angularVelocity[2] * angularScale + lerp(-6.0, 6.0, random())
    ];
    const body = createBodyFromSpec(space, world, {
      ...spec,
      name: `${spec.name}_stress_${i}`,
      position: [0.0, 0.18, 0.0],
      attitude: [
        spec.attitude[0] + attitudeJitter[0],
        spec.attitude[1] + attitudeJitter[1],
        spec.attitude[2] + attitudeJitter[2]
      ],
      angularVelocity
    });
    for (let elapsedMs = 0.0; elapsedMs < SIM_DURATION_MS; elapsedMs += FIXED_TIME_STEP_MS) {
      world.step(FIXED_TIME_STEP_MS);
    }
    const finalCenterY = body.getPosition()[1];
    const finalAngularSpeed = lengthVec3(body.getAngularVelocity());
    maxFinalCenterY = Math.max(maxFinalCenterY, finalCenterY);
    maxFinalAngularSpeed = Math.max(maxFinalAngularSpeed, finalAngularSpeed);
    if (finalCenterY > maxAllowedHeight || finalAngularSpeed > maxAllowedAngularSpeed) {
      failures.push({
        trial: i,
        finalCenterY,
        finalAngularSpeed,
        finalPosition: [...body.getPosition()],
        finalAngularVelocity: [...body.getAngularVelocity()],
        attitude: [
          spec.attitude[0] + attitudeJitter[0],
          spec.attitude[1] + attitudeJitter[1],
          spec.attitude[2] + attitudeJitter[2]
        ],
        angularVelocity
      });
    }
  }

  console.log(`\n=== ${label} ===`);
  console.log(`trials: ${trialCount}`);
  console.log(`failures: ${failures.length}`);
  console.log(`max final centerY: ${maxFinalCenterY.toFixed(4)}`);
  console.log(`max final angular speed(deg/s): ${maxFinalAngularSpeed.toFixed(4)}`);
  if (failures.length > 0) {
    console.log("sample failures:");
    for (let i = 0; i < Math.min(6, failures.length); i++) {
      const failure = failures[i];
      console.log(
        `  trial=${failure.trial} y=${failure.finalCenterY.toFixed(4)} `
        + `angSpeed=${failure.finalAngularSpeed.toFixed(4)} `
        + `pos=${formatVec3(failure.finalPosition)} `
        + `ang=${formatVec3(failure.finalAngularVelocity)} `
        + `att=${formatVec3(failure.attitude)} `
        + `initAng=${formatVec3(failure.angularVelocity)}`
      );
    }
  }
};

// 現象が見た目由来か solver 由来かを切り分けるために、
// まずは physics_collider と同じ beam、次に spin を 0 にした beam を比較する
runScenario("beam_current_settings", {
  name: "beam_current"
});

runScenario("beam_zero_spin_control", {
  name: "beam_zero_spin",
  angularVelocity: [0.0, 0.0, 0.0]
});

runScenario("beam_zero_spin_inertia_x20", {
  name: "beam_zero_spin_inertia_x20",
  angularVelocity: [0.0, 0.0, 0.0],
  inertiaScale: 20.0
});

runScenario("beam_zero_spin_solver_iter_1", {
  name: "beam_zero_spin_solver_iter_1",
  angularVelocity: [0.0, 0.0, 0.0],
  solverIterations: 1
});

runBeamStackScenario("beam_stack_zero_spin", {
  angularVelocity: [0.0, 0.0, 0.0]
});

runCubeScenario("cube_current_settings", {
  name: "cube_current"
});

runCubeScenario("cube_zero_spin_control", {
  name: "cube_zero_spin",
  angularVelocity: [0.0, 0.0, 0.0]
});

runCubeScenario("cube_corner_bias", {
  name: "cube_corner_bias",
  angularVelocity: [0.0, 0.0, 0.0],
  attitude: [35.0, 35.0, 0.0]
});

runRestShapeScenario("plate_current_settings", {
  name: "plate_current",
  size: PLATE_SIZE,
  attitude: [0.0, -10.0, 16.0],
  angularVelocity: [14.0, 0.0, 18.0],
  restitution: 0.015,
  friction: 0.82,
  linearDamping: 0.08,
  angularDamping: 0.11
});

runRestShapeScenario("column_current_settings", {
  name: "column_current",
  size: COLUMN_SIZE,
  attitude: [6.0, 0.0, -10.0],
  angularVelocity: [12.0, 0.0, 16.0],
  restitution: 0.015,
  friction: 0.76,
  linearDamping: 0.08,
  angularDamping: 0.10
});

runRestShapeScenario("deep_block_current_settings", {
  name: "deep_block_current",
  size: DEEP_BLOCK_SIZE,
  attitude: [10.0, 10.0, 0.0],
  angularVelocity: [16.0, 12.0, 14.0],
  restitution: 0.02,
  friction: 0.72,
  linearDamping: 0.09,
  angularDamping: 0.11
});

runRandomRestStressScenario("beam_random_rest_stress", {
  name: "beam_random",
  size: BEAM_SIZE,
  attitude: [8.0, 0.0, 14.0],
  angularVelocity: [16.0, 0.0, 12.0],
  restitution: 0.02,
  friction: 0.78,
  linearDamping: 0.07,
  angularDamping: 0.10
}, {
  maxAllowedHeight: 0.030,
  maxAllowedAngularSpeed: 6.0,
  trialCount: RANDOM_TRIAL_COUNT,
  seed: 0x0BEEF101
});

runRandomRestStressScenario("plate_random_rest_stress", {
  name: "plate_random",
  size: PLATE_SIZE,
  attitude: [0.0, -10.0, 16.0],
  angularVelocity: [14.0, 0.0, 18.0],
  restitution: 0.015,
  friction: 0.82,
  linearDamping: 0.08,
  angularDamping: 0.11
}, {
  maxAllowedHeight: 0.025,
  maxAllowedAngularSpeed: 6.0,
  trialCount: RANDOM_TRIAL_COUNT,
  seed: 0x0BEEF202
});
