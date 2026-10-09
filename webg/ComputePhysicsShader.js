// ---------------------------------------------
// ComputePhysicsShader.js  2026/09/14
//   WGSL generation for ComputePhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import ComputeBoxCollider from "./ComputeBoxCollider.js";
import ComputeSphereCollider from "./ComputeSphereCollider.js";
import ComputeCapsuleCollider from "./ComputeCapsuleCollider.js";
import ComputePlaneCollider from "./ComputePlaneCollider.js";
import { COMPUTE_PHYSICS_JOINT_LAYOUT } from "./ComputeJointBuffer.js";
import {
  COMPUTE_PHYSICS_BODY_COMMAND_FLAGS,
  WORKGROUP_SIZE,
  MAX_SOLVER_ITERATIONS
} from "./ComputeBodyState.js";

// WGSLのtop-level declarationを読み、指定entry pointから到達する関数だけを残します
// 同じmoduleへ全passを詰め込まず、初回dispatchで不要なsolver関数まで検証・コンパイルさせないために使います
function pruneComputeWGSL(code, entryPoints) {
  const lines = code.split("\n");
  const blocks = [];
  const functionBlocks = new Map();
  const countBraces = (line) => (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0);
  const findBlockEnd = (start) => {
    let depth = 0;
    let opened = false;
    for (let index = start; index < lines.length; index += 1) {
      depth += countBraces(lines[index]);
      if (lines[index].includes("{")) opened = true;
      if (opened && depth === 0) return index;
    }
    throw new Error("ComputePhysicsShader top-level block is missing a closing brace");
  };
  const functionNameAt = (start) => {
    for (let index = start; index < lines.length; index += 1) {
      const match = lines[index].trim().match(/^fn\s+([A-Za-z_]\w*)\s*\(/);
      if (match) return match[1];
      if (index > start && /^(?:struct|fn|@group|@compute)\b/.test(lines[index].trim())) return null;
    }
    return null;
  };

  for (let index = 0; index < lines.length;) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("@compute")) {
      const name = functionNameAt(index);
      if (!name) {
        index += 1;
        continue;
      }
      const end = findBlockEnd(index);
      const block = { kind: "function", name, start: index, end, text: lines.slice(index, end + 1).join("\n") };
      blocks.push(block);
      functionBlocks.set(name, block);
      index = end + 1;
      continue;
    }
    if (trimmed.startsWith("fn ")) {
      const name = functionNameAt(index);
      if (!name) {
        index += 1;
        continue;
      }
      const end = findBlockEnd(index);
      const block = { kind: "function", name, start: index, end, text: lines.slice(index, end + 1).join("\n") };
      blocks.push(block);
      functionBlocks.set(name, block);
      index = end + 1;
      continue;
    }
    if (trimmed.startsWith("struct ")) {
      const end = findBlockEnd(index);
      blocks.push({ kind: "declaration", start: index, end, text: lines.slice(index, end + 1).join("\n") });
      index = end + 1;
      continue;
    }
    if (trimmed.startsWith("@group") || trimmed.startsWith("const ") || trimmed.startsWith("override ")) {
      blocks.push({ kind: "declaration", start: index, end: index, text: lines[index] });
    }
    index += 1;
  }

  const selectedFunctions = new Set();
  const pending = [...entryPoints];
  while (pending.length > 0) {
    const name = pending.pop();
    if (selectedFunctions.has(name)) continue;
    const block = functionBlocks.get(name);
    if (!block) throw new Error(`ComputePhysicsShader entry point is unavailable: ${name}`);
    selectedFunctions.add(name);
    for (const match of block.text.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      if (functionBlocks.has(match[1])) pending.push(match[1]);
    }
  }

  return blocks
    .filter((block) => block.kind !== "function" || selectedFunctions.has(block.name))
    .map((block) => block.text)
    .join("\n\n");
}

// GPUへ渡すruntime shaderから説明コメントだけを除き、WGSL parserへ渡す文字量を減らします
// 公開createWGSL()の可読な出力は保持し、pipeline生成時だけこの軽量化を適用します
function minifyComputeWGSL(code) {
  return code
    .replace(/\/\/[^\r\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ComputePhysicsSpaceの固定設定を読み、Broad PhaseからsolverまでのWGSLを組み立てます
// GPU resourceの生成はComputePhysicsPipelineが行い、必要時はentry point到達範囲だけを返します
export function createComputePhysicsWGSL(space, options = {}) {
    const gridSize = space.gridSize;
    const gridCells = space.gridCellCount;
    const words = space.candidateWordCount;
    const solverIterationLimit = Math.max(1, Math.min(MAX_SOLVER_ITERATIONS, space.solverIterations));
    const shapeKinds = space.computeShapeKinds instanceof Set
      ? space.computeShapeKinds
      : new Set(["box", "sphere", "capsule"]);
    const hasBox = shapeKinds.has("box");
    const hasSphere = shapeKinds.has("sphere");
    const hasCapsule = shapeKinds.has("capsule");
    const candidateOffset = space.candidateWordOffset;
    const jointLayout = COMPUTE_PHYSICS_JOINT_LAYOUT;
    const jointBufferInfo = space.joints.getLayoutInfo();
    const entryPoints = Array.isArray(options.entryPoints) ? options.entryPoints : null;
    if (entryPoints?.length === 1 && entryPoints[0] === "clearMain") {
      const clearCode = `
@group(0) @binding(0) var<storage, read_write> clearWords : array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> clearContactHistory : array<vec4f>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn clearMain(@builtin(global_invocation_id) id : vec3u) {
  if (id.x < ${space.totalGridWordCount}u) {
    atomicStore(&clearWords[id.x], 0u);
  }
  if (id.x == 0u) {
    let previousStamp = clearContactHistory[0].w;
    let nextStamp = select(previousStamp + 1.0, 1.0, previousStamp >= 65536.0);
    clearContactHistory[0] = vec4f(0.0, 0.0, 0.0, nextStamp);
  }
}`;
      return options.minify ? minifyComputeWGSL(clearCode) : clearCode;
    }
    // 実際に登録された形状だけをmain shaderへ含め、Box専用sampleへSphere/Capsule式を持ち込みません
    const shapeLibraries = [
      hasBox ? ComputeBoxCollider.createWGSL() : "",
      hasCapsule ? ComputeCapsuleCollider.createWGSL() : "",
      hasSphere ? ComputeSphereCollider.createWGSL() : "",
      ComputePlaneCollider.createWGSL({ hasBox, hasSphere, hasCapsule })
    ].join("\n");
    const worldRadiusBranches = [];
    if (hasCapsule) {
      worldRadiusBranches.push(`if (body.inverseInertiaLocal.w > 1.5) {
    return computeCapsuleWorldRadius(body, orientation);
  }`);
    }
    if (hasSphere) {
      worldRadiusBranches.push(`if (body.inverseInertiaLocal.w > 0.5 && body.inverseInertiaLocal.w < 1.5) {
    return computeSphereWorldRadius(body);
  }`);
    }
    if (hasBox) {
      worldRadiusBranches.push("return computeBoxWorldRadius(orientation, body.halfExtentsSleepCounter.xyz);");
    } else if (hasCapsule) {
      worldRadiusBranches.push("return computeCapsuleWorldRadius(body, orientation);");
    } else if (hasSphere) {
      worldRadiusBranches.push("return computeSphereWorldRadius(body);");
    } else {
      worldRadiusBranches.push("return vec3f(0.0);");
    }
    const contactTypeDeclarations = [
      hasCapsule ? "  let capsuleA = bodyA.inverseInertiaLocal.w > 1.5;\n  let capsuleB = bodyB.inverseInertiaLocal.w > 1.5;" : "",
      hasSphere ? "  let sphereA = bodyA.inverseInertiaLocal.w > 0.5 && bodyA.inverseInertiaLocal.w < 1.5;\n  let sphereB = bodyB.inverseInertiaLocal.w > 0.5 && bodyB.inverseInertiaLocal.w < 1.5;" : ""
    ].filter(Boolean).join("\n");
    const contactBranches = [];
    if (hasCapsule && hasSphere) {
      contactBranches.push("  if (capsuleA && capsuleB) {\n    return computeCapsuleCapsuleContact(bodyA, positionA, orientationA, bodyB, orientationB);\n  }");
      contactBranches.push("  if (capsuleA && sphereB) {\n    return computeCapsuleSphereContact(bodyA, positionA, orientationA, bodyB);\n  }");
      contactBranches.push("  if (capsuleB && sphereA) {\n    let contact = computeCapsuleSphereContact(bodyB, bodyB.position.xyz, orientationB, bodyA);\n    return Contact(\n      vec4f(-contact.normalPenetration.xyz, contact.normalPenetration.w),\n      contact.pointValid\n    );\n  }");
    } else if (hasCapsule) {
      contactBranches.push("  if (capsuleA && capsuleB) {\n    return computeCapsuleCapsuleContact(bodyA, positionA, orientationA, bodyB, orientationB);\n  }");
    }
    if (hasCapsule && hasBox) {
      contactBranches.push("  if (capsuleA) {\n    return computeCapsuleBoxContact(\n      bodyA, positionA, orientationA, bodyB, bodyB.position.xyz, orientationB\n    );\n  }");
      contactBranches.push("  if (capsuleB) {\n    let contact = computeCapsuleBoxContact(\n      bodyB, bodyB.position.xyz, orientationB, bodyA, positionA, orientationA\n    );\n    return Contact(\n      vec4f(-contact.normalPenetration.xyz, contact.normalPenetration.w),\n      contact.pointValid\n    );\n  }");
    }
    if (hasSphere) {
      if (hasSphere) contactBranches.push("  if (sphereA && sphereB) {\n    return computeSphereContact(bodyA, positionA, bodyB);\n  }");
      if (hasBox) {
        contactBranches.push("  if (sphereA) {\n    return computeSphereBoxContact(\n      bodyA, positionA, bodyB, bodyB.position.xyz, orientationB\n    );\n  }");
        contactBranches.push("  if (sphereB) {\n    let contact = computeSphereBoxContact(\n      bodyB, bodyB.position.xyz, bodyA, positionA, orientationA\n    );\n    return Contact(\n      vec4f(-contact.normalPenetration.xyz, contact.normalPenetration.w),\n      contact.pointValid\n    );\n  }");
      }
    }
    if (hasBox) {
      contactBranches.push("  return computeBoxContact(bodyA, positionA, orientationA, bodyB);");
    } else if (hasSphere) {
      contactBranches.push("  return computeSphereContact(bodyA, positionA, bodyB);");
    } else if (hasCapsule) {
      contactBranches.push("  return computeCapsuleCapsuleContact(bodyA, positionA, orientationA, bodyB, orientationB);");
    } else {
      contactBranches.push("  return Contact(vec4f(0.0), vec4f(0.0));");
    }
    const contactOrientationB = hasCapsule || (hasSphere && hasBox)
      ? "  let orientationB = quatNormalize(bodyB.orientation);\n"
      : "";
    const colliderWorldRadiusFunction = `fn computeColliderWorldRadius(body : BodyState, orientation : vec4f) -> vec3f {
  // collider typeを含む形状集合だけを参照し、不要なworld radius式をshaderへ入れません
  ${worldRadiusBranches.join("\n  ")}
}`;
    const colliderContactFunction = `fn computeColliderContact(
  bodyA : BodyState,
  positionA : vec3f,
  orientationA : vec4f,
  bodyB : BodyState
) -> Contact {
  // BodyStateの形状typeを、登録済み形状の組み合わせだけへ接続します
${contactTypeDeclarations}
${contactOrientationB}${contactBranches.join("\n")}
}`;
    const colliderManifoldFunction = `
struct ComputeColliderContactManifold {
  normalPenetration : vec4f,
  representativePoint : vec4f,
  points : array<vec4f, 4>,
  pointCount : u32,
};

fn emptyComputeColliderContactManifold() -> ComputeColliderContactManifold {
  var result : ComputeColliderContactManifold;
  result.normalPenetration = vec4f(0.0);
  result.representativePoint = vec4f(0.0);
  result.pointCount = 0u;
  for (var index = 0u; index < 4u; index += 1u) {
    result.points[index] = vec4f(0.0);
  }
  return result;
}

// Boxのdynamic-static面接触だけを4点へ展開し、それ以外の形状pairは従来の一点を共有します
// 面clipはcomputeBoxContactManifold内で一度だけ実行し、solver反復中の4点から同じ結果を参照します
fn computeColliderContactManifold(
  bodyA : BodyState,
  positionA : vec3f,
  orientationA : vec4f,
  bodyB : BodyState
) -> ComputeColliderContactManifold {
  var result = emptyComputeColliderContactManifold();
${hasBox ? `  let boxA = bodyA.inverseInertiaLocal.w < 0.5;
  let boxB = bodyB.inverseInertiaLocal.w < 0.5;
  if (boxA && boxB && (bodyA.linearVelocityInvMass.w > 0.0) != (bodyB.linearVelocityInvMass.w > 0.0)) {
    let boxManifold = computeBoxContactManifold(bodyA, positionA, orientationA, bodyB);
    result.normalPenetration = boxManifold.normalPenetration;
    result.representativePoint = boxManifold.representativePoint;
    result.pointCount = boxManifold.pointCount;
    for (var index = 0u; index < 4u; index += 1u) {
      result.points[index] = boxManifold.points[index];
    }
    return result;
  }` : ""}
  let contact = computeColliderContact(bodyA, positionA, orientationA, bodyB);
  result.normalPenetration = contact.normalPenetration;
  result.representativePoint = contact.pointValid;
  result.points[0] = contact.pointValid;
  result.pointCount = select(0u, 1u, contact.pointValid.w > 0.5);
  return result;
}`;
    const jointCollisionDeclaration = `
@group(0) @binding(7) var<storage, read> collisionJointData : array<u32>;
`;
    const jointCollisionHelpers = `
// body adjacencyを調べ、enabledかつcollideConnected=falseのJoint pairだけ通常接触から除外します
// Joint拘束そのものは別XPBD passで残し、collision suppressionはbody typeやtriggerとは独立して管理します
fn jointsAllowCollision(bodyA : u32, bodyB : u32) -> bool {
  let rangeOffset = bodyA * 2u;
  let adjacencyStart = collisionJointData[rangeOffset];
  let adjacencyCount = collisionJointData[rangeOffset + 1u];
  for (var link = 0u; link < ${jointBufferInfo.maxJointLinks}u; link += 1u) {
    if (link >= adjacencyCount) { break; }
    let recordIndex = collisionJointData[${jointBufferInfo.maxBodies * 2}u + adjacencyStart + link];
    let recordBase = ${jointBufferInfo.recordBaseU32}u + recordIndex * ${jointBufferInfo.recordStrideU32}u;
    let recordA = collisionJointData[recordBase + ${jointLayout.bodyA}u];
    let recordB = collisionJointData[recordBase + ${jointLayout.bodyB}u];
    if (((recordA == bodyA && recordB == bodyB) || (recordA == bodyB && recordB == bodyA))
      && (collisionJointData[recordBase + ${jointLayout.flags}u] & ${jointLayout.enabledFlag}u) != 0u
      && (collisionJointData[recordBase + ${jointLayout.flags}u] & ${jointLayout.collideConnectedFlag}u) == 0u) {
      return false;
    }
  }
  return true;
}
`;
    let code = `
struct BodyState {
  position : vec4f,
  orientation : vec4f,
  linearVelocityInvMass : vec4f,
  angularVelocitySleep : vec4f,
  halfExtentsSleepCounter : vec4f,
  inverseInertiaLocal : vec4f,
  material : vec4f,
  color : vec4f,
};

// BodyControlはsimulationだけが読む属性と、次のfixed stepで一度だけ消費する命令を分けて保持します
// config.xはactive、config.yはbodyType、config.zはallowSleep、config.wはfixedRotationです
// collision.x/yはlayer/mask、collision.zはtrigger、properties.xはgravityScaleです
// surfaceVelocityはkinematic bodyの通常linearVelocityを変えず、接触の接線速度だけへ加える持続設定です
struct BodyControl {
  config : vec4u,
  collision : vec4u,
  properties : vec4f,
  force : vec4f,
  torque : vec4f,
  linearImpulse : vec4f,
  angularImpulse : vec4f,
  linearVelocity : vec4f,
  angularVelocity : vec4f,
  position : vec4f,
  orientation : vec4f,
  commandFlags : vec4u,
  surfaceVelocity : vec4f,
};

struct SimParams {
  timing : vec4f,
  gravityBeta : vec4f,
  bounds : vec4f,
  scale0 : vec4f,
  scale1 : vec4f,
  sleep : vec4f,
  grid : vec4f,
  wake : vec4f,
};

struct Contact {
  normalPenetration : vec4f,
  pointValid : vec4f,
};

// sleep bodyのwake走査結果を一つのvec4へまとめる内部値
// candidateは候補bodyの存在、contactは現在または予測された接触、otherIndexは相手slotを表します
struct WakeContactState {
  candidate : bool,
  contact : bool,
  otherIndex : u32,
  normalVelocity : f32,
  approachSpeed : f32,
};

@group(0) @binding(0) var<storage, read_write> clearWords : array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> clearContactHistory : array<vec4f>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn clearMain(@builtin(global_invocation_id) id : vec3u) {
  // Grid領域とbody別candidate領域を同じclear dispatchで初期化します
  if (id.x < ${space.totalGridWordCount}u) {
    atomicStore(&clearWords[id.x], 0u);
  }
  // invocation 0だけがGPU内のfixed step世代を進め、同じencoderへ複数stepを記録した場合も個別の番号を作ります
  // contactHistory[0]は世代番号専用recordで、各接触履歴はindex 1以降へ格納します
  if (id.x == 0u) {
    let previousStamp = clearContactHistory[0].w;
    let nextStamp = select(previousStamp + 1.0, 1.0, previousStamp >= 65536.0);
    clearContactHistory[0] = vec4f(0.0, 0.0, 0.0, nextStamp);
  }
}

@group(0) @binding(0) var<storage, read> broadphaseBodies : array<BodyState>;
@group(0) @binding(1) var<storage, read_write> predictedAabbs : array<vec4f>;
@group(0) @binding(2) var<uniform> broadphaseParams : SimParams;
@group(0) @binding(3) var<storage, read_write> gridCandidateWords : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> broadphaseControls : array<BodyControl>;
${jointCollisionDeclaration}

fn quatMultiply(a : vec4f, b : vec4f) -> vec4f {
  // BodyStateの[w,x,y,z] quaternionを積算し、姿勢更新とworld/local変換で共通利用します
  return vec4f(
    a.x*b.x-a.y*b.y-a.z*b.z-a.w*b.w,
    a.x*b.y+a.y*b.x+a.z*b.w-a.w*b.z,
    a.x*b.z-a.y*b.w+a.z*b.x+a.w*b.y,
    a.x*b.w+a.y*b.z-a.z*b.y+a.w*b.x
  );
}

fn quatConjugate(q : vec4f) -> vec4f {
  // 単位quaternionの共役を返し、worldベクトルをlocalへ戻す回転に使います
  return vec4f(q.x, -q.y, -q.z, -q.w);
}

fn quatNormalize(q : vec4f) -> vec4f {
  // 姿勢積分やBodyState入力の丸め誤差を正規化し、回転行列相当の長さを維持します
  return q * inverseSqrt(dot(q, q));
}

fn quatRotate(q : vec4f, value : vec3f) -> vec3f {
  // vectorをquaternionで回転し、OBB軸、接触点、慣性変換へ同じ向きを渡します
  return quatMultiply(quatMultiply(q, vec4f(0.0, value)), quatConjugate(q)).yzw;
}

fn integrateOrientation(orientation : vec4f, angularVelocity : vec3f, dt : f32) -> vec4f {
  // world角速度の大きさをfixed stepの回転角へ変換し、有限回転Δqを作ります
  // 角速度がzeroのときだけidentityを使い、非zeroの角速度は積分式で姿勢へ反映します
  let angularSpeed = length(angularVelocity);
  if (angularSpeed == 0.0) {
    return quatNormalize(orientation);
  }
  let halfAngle = angularSpeed * dt * 0.5;
  let axis = angularVelocity / angularSpeed;
  let delta = vec4f(cos(halfAngle), axis * sin(halfAngle));
  // world角速度のΔqを現在姿勢の左へ掛け、Δq ⊗ qとして更新します
  return quatNormalize(quatMultiply(delta, orientation));
}

// body controlのactive bitを参照し、削除済みslotをBroad Phaseとsolverから除外します
fn controlIsActive(control : BodyControl) -> bool {
  return control.config.x > 0u;
}

// layer/maskの双方向一致とtrigger状態を検証し、物理solverへ渡す組み合わせを限定します
// triggerは今後のイベント出力用に登録でき、通常の力学接触とは別の通知対象として扱います
fn controlsCanSolve(a : BodyControl, b : BodyControl) -> bool {
  if (!controlIsActive(a) || !controlIsActive(b)) { return false; }
  if ((a.collision.x & b.collision.y) == 0u) { return false; }
  if ((b.collision.x & a.collision.y) == 0u) { return false; }
  if (a.collision.z > 0u || b.collision.z > 0u) { return false; }
  return true;
}

// commandFlags内の指定bitを命令判定へ変換します
// Broad Phase、wake予測、solverが同じ命令解釈を使うため、早い位置へ定義します
fn hasBodyCommand(flags : u32, bit : u32) -> bool {
  return (flags & bit) != 0u;
}

// kinematicの搬送速度を接触法線へ直交する成分だけへ限定します
// quasiStaticの本体速度・法線速度は0のままにし、摩擦の相対接線速度だけを変えます
fn getSurfaceContactVelocity(control : BodyControl, normal : vec3f) -> vec3f {
  if (control.config.y != 1u) { return vec3f(0.0); }
  let surfaceVelocity = control.surfaceVelocity.xyz;
  return surfaceVelocity - normal * dot(surfaceVelocity, normal);
}

// kinematic bodyが現在のfixed stepで接触相手へ動作を伝える状態かを返します
// 接線搬送、通常のimpact速度、teleportによる位置移動をsleep wakeへ反映します
fn hasKinematicMotion(
  body : BodyState,
  control : BodyControl
) -> bool {
  if (control.config.y != 1u) { return false; }
  let surfaceMoving = length(control.surfaceVelocity.xyz) > 0.0000001;
  let velocityMoving = hasBodyCommand(
    control.commandFlags.x,
    ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.setLinearVelocity}u
  ) && length(control.linearVelocity.xyz) > 0.0000001;
  let targetMoving = hasBodyCommand(
    control.commandFlags.x,
    ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportPosition}u
  ) && length(control.position.xyz - body.position.xyz) > 0.0000001;
  return surfaceMoving || velocityMoving || targetMoving;
}

${jointCollisionHelpers}

${shapeLibraries}

${colliderWorldRadiusFunction}

${colliderContactFunction}

${colliderManifoldFunction}

fn cellCoordinate(value : f32, origin : f32, cellSize : f32) -> i32 {
  // world座標をXZ Grid cellへ変換し、Bounds外は端cellへ収めます
  return clamp(i32(floor((value - origin) / cellSize)), 0, ${gridSize - 1});
}

fn cellRange(aabb : vec4f) -> vec4i {
  // 予測AABBのXZ範囲をGridの最小・最大cellへ変換します
  let cellSizeX = (broadphaseParams.bounds.y - broadphaseParams.bounds.x) / f32(${gridSize});
  let cellSizeZ = (broadphaseParams.bounds.w - broadphaseParams.bounds.z) / f32(${gridSize});
  return vec4i(
    cellCoordinate(aabb.x, broadphaseParams.bounds.x, cellSizeX),
    cellCoordinate(aabb.y, broadphaseParams.bounds.z, cellSizeZ),
    cellCoordinate(aabb.z, broadphaseParams.bounds.x, cellSizeX),
    cellCoordinate(aabb.w, broadphaseParams.bounds.z, cellSizeZ)
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn aabbMain(@builtin(global_invocation_id) id : vec3u) {
  // 現在位置とfixed step後の予測位置を包むAABBを作り、移動中の接触候補を先に確保します
  let index = id.x;
  if (index >= u32(broadphaseParams.timing.y)) { return; }
  let body = broadphaseBodies[index];
  let control = broadphaseControls[index];
  if (!controlIsActive(control)) {
    predictedAabbs[index * 2u] = vec4f(0.0);
    predictedAabbs[index * 2u + 1u] = vec4f(0.0);
    return;
  }
  let dt = broadphaseParams.timing.x;
  let currentOrientation = quatNormalize(body.orientation);
  let moves = control.config.y != 0u
    && !(broadphaseParams.timing.w > 0.5 && body.angularVelocitySleep.w > 0.5);
  let appliesGravity = control.config.y == 2u;
  let predictedVelocity = select(
    vec3f(0.0),
    body.linearVelocityInvMass.xyz
      + select(vec3f(0.0), broadphaseParams.gravityBeta.xyz * control.properties.x, appliesGravity) * dt,
    moves
  );
  let integratedPosition = select(body.position.xyz, body.position.xyz + predictedVelocity * dt, moves);
  let predictedPosition = select(
    integratedPosition,
    control.position.xyz,
    hasBodyCommand(control.commandFlags.x, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportPosition}u)
  );
  let predictedOrientation = select(
    select(
      currentOrientation,
      integrateOrientation(currentOrientation, body.angularVelocitySleep.xyz, dt),
      moves
    ),
    quatNormalize(control.orientation),
    hasBodyCommand(control.commandFlags.x, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportOrientation}u)
  );
  // 現在姿勢と予測姿勢の両方を含め、回転と移動で抜ける候補をswept AABBへ残します
  let currentRadius = computeColliderWorldRadius(body, currentOrientation);
  let predictedRadius = computeColliderWorldRadius(body, predictedOrientation);
  let padding = broadphaseParams.scale0.z;
  predictedAabbs[index * 2u] = vec4f(
    min(body.position.x-currentRadius.x, predictedPosition.x-predictedRadius.x)-padding,
    min(body.position.z-currentRadius.z, predictedPosition.z-predictedRadius.z)-padding,
    max(body.position.x+currentRadius.x, predictedPosition.x+predictedRadius.x)+padding,
    max(body.position.z+currentRadius.z, predictedPosition.z+predictedRadius.z)+padding
  );
  predictedAabbs[index * 2u + 1u] = vec4f(
    // x/yへswept Yの上下限を保存し、XZ Gridへ登録した候補をY方向で再確認します
    min(body.position.y-currentRadius.y, predictedPosition.y-predictedRadius.y)-padding,
    max(body.position.y+currentRadius.y, predictedPosition.y+predictedRadius.y)+padding,
    0.0,
    0.0
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn cellMain(@builtin(global_invocation_id) id : vec3u) {
  // bodyのXZ範囲に含まれる全cellへbody bitをatomic ORで登録します
  let bodyIndex = id.x;
  if (bodyIndex >= u32(broadphaseParams.timing.y)) { return; }
  if (!controlIsActive(broadphaseControls[bodyIndex])) { return; }
  let range = cellRange(predictedAabbs[bodyIndex * 2u]);
  let wordIndex = bodyIndex / 32u;
  let bit = 1u << (bodyIndex % 32u);
  for (var z = range.y; z <= range.w; z += 1) {
    for (var x = range.x; x <= range.z; x += 1) {
      let cell = u32(z * ${gridSize} + x);
      atomicOr(&gridCandidateWords[cell * ${words}u + wordIndex], bit);
    }
  }
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn candidateMain(@builtin(global_invocation_id) id : vec3u) {
  // bodyごとに重なったcellのbitを統合し、Y範囲・layer/mask・triggerで最終候補を確定します
  let slot = id.x;
  let bodyIndex = slot / ${words}u;
  let wordIndex = slot % ${words}u;
  let count = u32(broadphaseParams.timing.y);
  if (bodyIndex >= count) { return; }
  let ownControl = broadphaseControls[bodyIndex];
  if (!controlIsActive(ownControl)) {
    atomicStore(&gridCandidateWords[${candidateOffset}u + slot], 0u);
    return;
  }
  let range = cellRange(predictedAabbs[bodyIndex * 2u]);
  var candidates = 0u;
  // 複数cellへ登録された同じbody bitをORで一度にまとめます
  for (var z = range.y; z <= range.w; z += 1) {
    for (var x = range.x; x <= range.z; x += 1) {
      let cell = u32(z * ${gridSize} + x);
      candidates |= atomicLoad(&gridCandidateWords[cell * ${words}u + wordIndex]);
    }
  }
  if (wordIndex == bodyIndex / 32u) {
    candidates &= ~(1u << (bodyIndex % 32u));
  }
  var checked = candidates;
  var accepted = 0u;
  // 自分自身を除外し、候補bitを一つずつ検証してbody別bitsetへ保存します
  let ownY = predictedAabbs[bodyIndex * 2u + 1u].xy;
  let ownXz = predictedAabbs[bodyIndex * 2u];
  loop {
    if (checked == 0u) { break; }
    let bitIndex = u32(firstTrailingBit(checked));
    checked &= checked - 1u;
    let otherIndex = wordIndex * 32u + bitIndex;
    if (otherIndex < count
      && controlsCanSolve(ownControl, broadphaseControls[otherIndex])
      && jointsAllowCollision(bodyIndex, otherIndex)) {
      // 同じGrid cellを共有してもcell内でAABBが離れている候補をnarrow phaseへ渡しません
      // swept AABBの交差は形状接触の必要条件なので、真の接触候補を削らずfalse positiveだけを減らします
      let otherXz = predictedAabbs[otherIndex * 2u];
      let otherY = predictedAabbs[otherIndex * 2u + 1u].xy;
      if (ownXz.x <= otherXz.z && otherXz.x <= ownXz.z
        && ownXz.y <= otherXz.w && otherXz.y <= ownXz.w
        && ownY.x <= otherY.y && otherY.x <= ownY.y) {
        accepted |= 1u << bitIndex;
      }
    }
  }
  atomicStore(&gridCandidateWords[${candidateOffset}u + slot], accepted);
}

@group(0) @binding(0) var<storage, read> srcBodies : array<BodyState>;
@group(0) @binding(1) var<storage, read_write> dstBodies : array<BodyState>;
@group(0) @binding(2) var<uniform> params : SimParams;
@group(0) @binding(3) var<storage, read_write> solverGridWords : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> planeColliders : array<ComputePlaneRecord>;
@group(0) @binding(5) var<storage, read_write> bodyControls : array<BodyControl>;
@group(0) @binding(8) var<storage, read_write> contactHistory : array<vec4f>;

// bodyごとの接触履歴から非接触から接触へ変化したfixed stepだけを新しい衝突として扱います
// 接触法線は接触面やSAT最小軸の切り替わりで変化するため、継続判定には直前世代の記録有無だけを使います
fn physicsImpactTarget(index: u32, normal: vec3f, approach: f32, restitution: f32) -> f32 {
  let historyIndex = index + 1u;
  let previous = contactHistory[historyIndex];
  let stamp = contactHistory[0].w;
  let previousStamp = select(stamp - 1.0, 65536.0, stamp == 1.0);
  let continued = previous.w == previousStamp;
  contactHistory[historyIndex] = vec4f(normal, stamp);
  // 継続接触中の圧縮速度は拘束solverで0へ収束させ、新規接触時だけ反発目標速度を生成します
  return select(0.0, restitution * approach, !continued && approach > params.scale1.x);
}

${space.materialPairs.createWGSL()}

fn physicsRollingVelocity(omega: vec3f, orientation: vec4f, inverseLocal: vec3f,
  normal: vec3f, limit: f32) -> vec3f {
  let tangent = omega - normal * dot(omega, normal);
  let speed = length(tangent);
  if (speed <= 0.0000001 || limit <= 0.0) { return omega; }
  let axis = tangent / speed;
  let response = inverseInertiaApply(orientation, inverseLocal, axis);
  let effective = dot(axis, response);
  if (effective <= 0.0000001) { return omega; }
  return omega - response * min(limit, speed / effective);
}

fn inverseInertiaApply(q : vec4f, inverseLocal : vec3f, value : vec3f) -> vec3f {
  // world torque/impulseをlocal対角逆慣性で処理し、world角速度へ戻します
  return quatRotate(q, quatRotate(quatConjugate(q), value) * inverseLocal);
}

struct PairImpulseAccumulator {
  // 一つのbody pairについてfixed step内に蓄積した法線力積と接線力積です
  normalLambda : f32,
  tangentLambdaA : f32,
  tangentLambdaB : f32,
  targetNormalVelocity : f32,
};

fn solveBodyContact(
  body : BodyState,
  materialProperties : vec4f,
  bodyIndex : u32,
  other : BodyState,
  otherIndex : u32,
  contact : Contact,
  manifoldIndex : u32,
  pairTargetNormalVelocity : ptr<function, f32>,
  impulseAccumulator : ptr<function, PairImpulseAccumulator>,
  position : ptr<function, vec3f>,
  orientation : vec4f,
  linearVelocity : ptr<function, vec3f>,
  angularVelocity : ptr<function, vec3f>,
  iteration : u32,
  maxContactSpeed : ptr<function, f32>,
  maxNormalSpeed : ptr<function, f32>,
  bodySupportObserved : ptr<function, bool>,
  bodyContactObserved : ptr<function, bool>,
  activeDynamicBodyContactObserved : ptr<function, bool>
) -> bool {
  // body pairのcontactを一つ解き、法線impulse、摩擦impulse、位置補正、支持判定を更新します
  // bodyContactObservedはnormal方向を限定しない現在stepの実接触をsleep判定へ渡します
  if (contact.pointValid.w < 0.5) {
    // 接触が消えたpairの累積値を次の接触へ持ち越さず、同じfixed step内の再接触を別拘束にします
    (*impulseAccumulator) = PairImpulseAccumulator(0.0, 0.0, 0.0, -1.0);
    return false;
  }
  // normal方向に関係なく、現在fixed stepでnarrow phase接触が成立した事実を記録します
  // AABB候補や過去stepの接触履歴は床1点支持のsleep許可から分離し、現在の支持情報を使います
  (*bodyContactObserved) = true;
  let normal = contact.normalPenetration.xyz;
  let inverseMassA = body.linearVelocityInvMass.w;
  let inverseMassB = other.linearVelocityInvMass.w;
  // sleep中またはstaticな相手との接触は、active bodyからの新しい衝突と分けて記録します
  // sleep緩和を許可できるのは、現在stepの動的active body接触が一つもない場合だけです
  if (inverseMassB > 0.0 && other.angularVelocitySleep.w <= 0.5) {
    (*activeDynamicBodyContactObserved) = true;
  }
  let inverseMassSum = inverseMassA + inverseMassB;
  if (inverseMassSum <= 0.0000001) {
    (*impulseAccumulator) = PairImpulseAccumulator(0.0, 0.0, 0.0, -1.0);
    return false;
  }
  let point = contact.pointValid.xyz;
  let rA = point - *position;
  let rB = point - other.position.xyz;
  // 接触点の線速度を求め、法線方向へ近づく場合だけ反発と摩擦を適用します
  if (normal.y < -0.5) {
    (*bodySupportObserved) = true;
  }
  let bodyControl = bodyControls[bodyIndex];
  let otherControl = bodyControls[otherIndex];
  let velocityA = *linearVelocity + cross(*angularVelocity, rA)
    + getSurfaceContactVelocity(bodyControl, normal);
  let velocityB = other.linearVelocityInvMass.xyz + cross(other.angularVelocitySleep.xyz, rB)
    + getSurfaceContactVelocity(otherControl, normal);
  let relative = velocityB - velocityA;
  let normalVelocity = dot(relative, normal);
  let otherProperties = bodyControls[otherIndex].properties;
  let contactMaterial = physicsContactMaterial(vec4f(body.material.xy, materialProperties.zw),
    vec4f(other.material.xy, otherProperties.zw), materialProperties.y, otherProperties.y,
    max(0.0, -normalVelocity));
  if (*pairTargetNormalVelocity < 0.0) {
    *pairTargetNormalVelocity = physicsImpactTarget(
      bodyIndex * ${space.maxBodies + space.maxPlanes}u + otherIndex,
      normal, max(0.0, -normalVelocity), contactMaterial.x);
  }
  (*impulseAccumulator).targetNormalVelocity = *pairTargetNormalVelocity;
  let otherOrientation = quatNormalize(other.orientation);
  var normalImpulseApplied = (*impulseAccumulator).normalLambda > 0.0000001;
  let angularA = cross(inverseInertiaApply(orientation, body.inverseInertiaLocal.xyz, cross(rA, normal)), rA);
  let angularB = cross(inverseInertiaApply(otherOrientation, other.inverseInertiaLocal.xyz, cross(rB, normal)), rB);
  // sleepは計算量を省く状態であり質量特性は維持されるため、接触相手のsleep状態にかかわらず両bodyの有効質量を使います
  // 同じpairをA側とB側から解いたときの分母を一致させ、sleep境界で法線力積が片側だけ過大になる状態を防ぎます
  let denominator = inverseMassSum + dot(angularA + angularB, normal);
  // Plane接触と同じ局所反復でbody pairの残留法線速度を再評価し、先に解いた接触の姿勢変化を後続接触へ渡します
  // 相手bodyはstep開始snapshotのまま扱い、累積力積は差分だけを適用します
  let solvePairImpulse = true;
  if (solvePairImpulse && normalVelocity < 0.0 && denominator > 0.0000001) {
    // body間の実効反発はCPU版と同じく高い側を採用し、SphereとBoxの材質値へ応じて決めます
    let targetNormalVelocity = select(0.0, (*impulseAccumulator).targetNormalVelocity,
      iteration == 0u);
    let deltaLambda = -(normalVelocity - targetNormalVelocity) / denominator;
    let previousLambda = (*impulseAccumulator).normalLambda;
    let nextLambda = max(previousLambda + deltaLambda, 0.0);
    let appliedLambda = nextLambda - previousLambda;
    (*impulseAccumulator).normalLambda = nextLambda;
    let impulse = normal * appliedLambda;
    normalImpulseApplied = nextLambda > 0.0000001;
    if (abs(appliedLambda) > 0.0000001) {
      // 法線力積は累積値の差分だけをbody Aへ反映し、反復ごとの全量再適用を避けます
      *linearVelocity -= impulse * inverseMassA;
      let angularDelta = inverseInertiaApply(orientation, body.inverseInertiaLocal.xyz, cross(rA, impulse));
      *angularVelocity -= angularDelta;
    }
  }
  // 累積法線力積があるpairだけで摩擦を解き、接線2方向の力積を摩擦円内へ射影します
  if (solvePairImpulse && (*impulseAccumulator).normalLambda > 0.0000001) {
    let basis = computePlaneTangentBasis(normal);
    let postRelative = velocityB - (*linearVelocity + cross(*angularVelocity, rA));
    let tangentVelocity = postRelative - normal * dot(postRelative, normal);
    let tangentSpeed = length(tangentVelocity);
    if (tangentSpeed > 0.0000001) {
      let tangentA = basis[0];
      let tangentB = basis[1];
      let angularTangentA = cross(
        inverseInertiaApply(orientation, body.inverseInertiaLocal.xyz, cross(rA, tangentA)), rA
      );
      let angularTangentB = cross(
        inverseInertiaApply(otherOrientation, other.inverseInertiaLocal.xyz, cross(rB, tangentA)), rB
      );
      let angularTangentA2 = cross(
        inverseInertiaApply(orientation, body.inverseInertiaLocal.xyz, cross(rA, tangentB)), rA
      );
      let angularTangentB2 = cross(
        inverseInertiaApply(otherOrientation, other.inverseInertiaLocal.xyz, cross(rB, tangentB)), rB
      );
      // 接線方向も法線方向と同じ二体の有効質量を使い、sleep境界で摩擦応答が変わる状態を防ぎます
      let denominatorA = inverseMassSum + dot(angularTangentA + angularTangentB, tangentA);
      let denominatorB = inverseMassSum + dot(angularTangentA2 + angularTangentB2, tangentB);
      var deltaA = 0.0;
      var deltaB = 0.0;
      if (denominatorA > 0.0000001) {
        deltaA = -dot(postRelative, tangentA) / denominatorA;
      }
      if (denominatorB > 0.0000001) {
        deltaB = -dot(postRelative, tangentB) / denominatorB;
      }
      let requestedA = (*impulseAccumulator).tangentLambdaA + deltaA;
      let requestedB = (*impulseAccumulator).tangentLambdaB + deltaB;
      let requestedLength = sqrt(requestedA * requestedA + requestedB * requestedB);
      let frictionLimit = (*impulseAccumulator).normalLambda * select(contactMaterial.y, contactMaterial.z,
        requestedLength <= (*impulseAccumulator).normalLambda * contactMaterial.z);
      var tangentScale = 1.0;
      if (requestedLength > frictionLimit && requestedLength > 0.0000001) {
        tangentScale = frictionLimit / requestedLength;
      }
      let nextA = requestedA * tangentScale;
      let nextB = requestedB * tangentScale;
      let appliedA = nextA - (*impulseAccumulator).tangentLambdaA;
      let appliedB = nextB - (*impulseAccumulator).tangentLambdaB;
      (*impulseAccumulator).tangentLambdaA = nextA;
      (*impulseAccumulator).tangentLambdaB = nextB;
      let frictionImpulse = tangentA * appliedA + tangentB * appliedB;
      if (length(frictionImpulse) > 0.0000001) {
        // 摩擦力積も累積値の差分だけをbody Aへ反映し、相手bodyのsnapshotは入力状態として保持します
        *linearVelocity -= frictionImpulse * inverseMassA;
        let angularDelta = inverseInertiaApply(
          orientation, body.inverseInertiaLocal.xyz, cross(rA, frictionImpulse)
        );
        *angularVelocity -= angularDelta;
      }
    }
  }
  // sleep判定には最終反復でnormal impulseを適用した接触だけの残留相対速度を使います
  // 法線力が発生せず摩擦も適用していない接触の接線速度はsleep/wake判定から分離します
  if (normalImpulseApplied && iteration + 1u >= u32(params.timing.z)) {
    let residualVelocityA = *linearVelocity + cross(*angularVelocity, rA);
    let residualRelative = velocityB - residualVelocityA;
    (*maxContactSpeed) = max(*maxContactSpeed, length(residualRelative));
    (*maxNormalSpeed) = max(*maxNormalSpeed, abs(dot(residualRelative, normal)));
  }
  if (iteration == 0u && contactMaterial.w > 0.0 && (*impulseAccumulator).normalLambda > 0.0) {
    let relativeOmega = *angularVelocity - other.angularVelocitySleep.xyz;
    *angularVelocity += physicsRollingVelocity(relativeOmega, orientation, body.inverseInertiaLocal.xyz,
      normal, (*impulseAccumulator).normalLambda * contactMaterial.w) - relativeOmega;
  }
  // めり込み補正は速度impulseと分離し、逆質量に応じてbody Aだけの位置を押し戻します
  let correction = max(contact.normalPenetration.w - params.scale0.y, 0.0) * params.gravityBeta.w;
  if (manifoldIndex == 0u) {
    *position -= normal * correction * inverseMassA / inverseMassSum;
  }
  return normal.y < -0.5;
}

fn candidateWord(bodyIndex : u32, wordIndex : u32) -> u32 {
  // Broad Phaseがfixed stepごとに作ったbody別candidate bitsetをsolverから読みます
  return atomicLoad(&solverGridWords[${candidateOffset}u + bodyIndex * ${words}u + wordIndex]);
}

// 一回限りの外部命令をfixed stepの最後に消去し、forceやteleportをそのstepだけへ適用します
fn clearBodyCommands(bodyIndex : u32) {
  // force、impulse、teleportなどの一回命令をsolver完了時に消費済みへ戻します
  bodyControls[bodyIndex].force = vec4f(0.0);
  bodyControls[bodyIndex].torque = vec4f(0.0);
  bodyControls[bodyIndex].linearImpulse = vec4f(0.0);
  bodyControls[bodyIndex].angularImpulse = vec4f(0.0);
  bodyControls[bodyIndex].linearVelocity = vec4f(0.0);
  bodyControls[bodyIndex].angularVelocity = vec4f(0.0);
  bodyControls[bodyIndex].position = vec4f(0.0);
  bodyControls[bodyIndex].orientation = vec4f(0.0);
  bodyControls[bodyIndex].commandFlags = vec4u(0u);
}

fn predictWakeBody(body : BodyState, control : BodyControl) -> BodyState {
  // 次のfixed stepで相手bodyが到達する位置・姿勢・接触点速度をsleep bodyのwake判定へ渡します
  // 外部の速度設定、force、impulse、重力、dampingをsolverと同じ順で適用し、原点速度だけの判定を避けます
  let dt = params.timing.x;
  var orientation = quatNormalize(body.orientation);
  let commandFlags = control.commandFlags.x;
  var linearVelocity = body.linearVelocityInvMass.xyz;
  var angularVelocity = body.angularVelocitySleep.xyz;
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.setLinearVelocity}u)) {
    linearVelocity = control.linearVelocity.xyz;
  }
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.setAngularVelocity}u)) {
    angularVelocity = control.angularVelocity.xyz;
  }
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportOrientation}u)) {
    orientation = quatNormalize(control.orientation);
  }
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.stopMotion}u)
    || hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.sleep}u)) {
    linearVelocity = vec3f(0.0);
    angularVelocity = vec3f(0.0);
  }
  if (control.config.y == 2u) {
    // sleep中の相手へ外部impulseが加わった場合も、その一回命令を予測速度へ反映します
    linearVelocity += control.force.xyz * body.linearVelocityInvMass.w * dt;
    linearVelocity += control.linearImpulse.xyz * body.linearVelocityInvMass.w;
    angularVelocity += inverseInertiaApply(
      orientation,
      body.inverseInertiaLocal.xyz,
      control.torque.xyz
    ) * dt;
    angularVelocity += inverseInertiaApply(
      orientation,
      body.inverseInertiaLocal.xyz,
      control.angularImpulse.xyz
    );
    linearVelocity += params.gravityBeta.xyz * control.properties.x * dt;
  }
  linearVelocity *= exp(-body.material.z * dt);
  angularVelocity *= exp(-body.material.w * dt);
  var predicted = body;
  predicted.position = vec4f(body.position.xyz + linearVelocity * dt, 1.0);
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportPosition}u)) {
    predicted.position = vec4f(control.position.xyz, 1.0);
  }
  predicted.orientation = integrateOrientation(orientation, angularVelocity, dt);
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportOrientation}u)) {
    predicted.orientation = orientation;
  }
  predicted.linearVelocityInvMass = vec4f(linearVelocity, body.linearVelocityInvMass.w);
  predicted.angularVelocitySleep = vec4f(angularVelocity, body.angularVelocitySleep.w);
  return predicted;
}

// 現在位置から次fixed stepの予測位置までを二分探索し、sleep bodyへ最初に触れる姿勢を返します
// step終端の深い重なりではなく接触開始位置を使うことで、細いBoxを通り越した法線や過大な回転腕を避けます
fn predictWakeImpactBody(body : BodyState, control : BodyControl, sleepingBody : BodyState) -> BodyState {
  var predicted = predictWakeBody(body, control);
  let startPosition = body.position.xyz;
  let endPosition = predicted.position.xyz;
  let startOrientation = quatNormalize(body.orientation);
  let predictedAngularVelocity = predicted.angularVelocitySleep.xyz;
  var lower = 0.0;
  var upper = 1.0;
  // 8回の二分探索でfixed stepの1/256まで接触開始時刻を絞ります
  for (var search = 0u; search < 8u; search += 1u) {
    let fraction = 0.5 * (lower + upper);
    var candidate = predicted;
    candidate.position = vec4f(mix(startPosition, endPosition, fraction), 1.0);
    candidate.orientation = integrateOrientation(
      startOrientation,
      predictedAngularVelocity,
      params.timing.x * fraction
    );
    let contact = computeColliderContact(
      candidate,
      candidate.position.xyz,
      quatNormalize(candidate.orientation),
      sleepingBody
    );
    if (contact.pointValid.w > 0.5) {
      upper = fraction;
    } else {
      lower = fraction;
    }
  }
  predicted.position = vec4f(mix(startPosition, endPosition, upper), 1.0);
  predicted.orientation = integrateOrientation(
    startOrientation,
    predictedAngularVelocity,
    params.timing.x * upper
  );
  return predicted;
}

fn awakeContactExists(
  bodyIndex : u32,
  body : BodyState,
  count : u32,
  wakeState : ptr<function, WakeContactState>
) -> bool {
  // sleep bodyへ接触するawake bodyだけを走査し、現在接触または次fixed stepの接触で法線接近を判定します
  // sleep中の隣接bodyをwake起点にせず、連鎖の直前bodyが既に接触している場合も取りこぼさないようにします
  for (var wordIndex = 0u; wordIndex < ${words}u; wordIndex += 1u) {
    var bits = candidateWord(bodyIndex, wordIndex);
    loop {
      if (bits == 0u) { break; }
      let bitIndex = u32(firstTrailingBit(bits));
      bits &= bits - 1u;
      let otherIndex = wordIndex * 32u + bitIndex;
      if (otherIndex < count) {
        let other = srcBodies[otherIndex];
        let otherControl = bodyControls[otherIndex];
        if (controlIsActive(otherControl)
          && otherControl.config.y != 0u
          && other.angularVelocitySleep.w <= 0.5) {
          (*wakeState).candidate = true;
          (*wakeState).otherIndex = otherIndex;
          // まず現在位置の接触を確認し、既に接触しているawake bodyからの連鎖を保持します
          var contactOther = other;
          // solverMainと同じく活動bodyをA、sleep bodyをBとしてnarrow phaseを実行します
          var contact = computeColliderContact(
            contactOther,
            contactOther.position.xyz,
            quatNormalize(contactOther.orientation),
            body
          );
          if (contact.pointValid.w < 0.5) {
            // 現在は離れているpairだけ、次fixed stepの活動bodyを予測して接触開始を調べます
            contactOther = predictWakeImpactBody(other, otherControl, body);
            contact = computeColliderContact(
              contactOther,
              contactOther.position.xyz,
              quatNormalize(contactOther.orientation),
              body
            );
          }
          if (contact.pointValid.w > 0.5) {
            let point = contact.pointValid.xyz;
            let rA = point - contactOther.position.xyz;
            let rB = point - body.position.xyz;
            let velocityA = contactOther.linearVelocityInvMass.xyz
              + cross(contactOther.angularVelocitySleep.xyz, rA)
              + getSurfaceContactVelocity(otherControl, contact.normalPenetration.xyz);
            let velocityB = body.linearVelocityInvMass.xyz + cross(body.angularVelocitySleep.xyz, rB);
            let normalVelocity = dot(velocityB - velocityA, contact.normalPenetration.xyz);
            let approachSpeed = max(0.0, -normalVelocity);
            if (!(*wakeState).contact || approachSpeed > (*wakeState).approachSpeed) {
              (*wakeState).contact = true;
              (*wakeState).normalVelocity = normalVelocity;
              (*wakeState).approachSpeed = approachSpeed;
              (*wakeState).otherIndex = otherIndex;
            }
            // 搬送中のkinematicは法線衝突がなくても、接線摩擦を受けるsleep bodyを起こします
            if (hasKinematicMotion(other, otherControl)) { return true; }
            // 現在接触でも予測接触でも、awake bodyからの法線接近が閾値へ届けばsleep bodyを起こします
            if (normalVelocity <= -params.wake.x) { return true; }
          }
        }
      }
    }
  }
  return false;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn solverMain(@builtin(global_invocation_id) id : vec3u) {
  // 1 invocationが1 bodyを担当し、src stateとcandidate bitsetからdst stateを作ります
  let bodyIndex = id.x;
  let count = u32(params.timing.y);
  if (bodyIndex >= count) { return; }
  let source = srcBodies[bodyIndex];
  let control = bodyControls[bodyIndex];
  if (!controlIsActive(control)) {
    // 削除済みslotは命令だけ消費し、position.w=0のinactive stateをdstへ残します
    clearBodyCommands(bodyIndex);
    var inactiveResult = source;
    inactiveResult.position.w = 0.0;
    dstBodies[bodyIndex] = inactiveResult;
    return;
  }
  let commandFlags = control.commandFlags.x;
  let commandWakes = hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.setLinearVelocity}u)
    || hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.setAngularVelocity}u)
    || hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportPosition}u)
    || hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportOrientation}u)
    || hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.wake}u)
    || length(control.surfaceVelocity.xyz) > 0.0000001
    || length(control.force.xyz) > 0.0
    || length(control.torque.xyz) > 0.0
    || length(control.linearImpulse.xyz) > 0.0
    || length(control.angularImpulse.xyz) > 0.0;
  let sourceWasSleeping = params.timing.w > 0.5 && source.angularVelocitySleep.w > 0.5;
  var wasSleeping = sourceWasSleeping && control.config.z > 0u && !commandWakes;
  let staticBody = control.config.y == 0u;
  // 外部命令を先にstateへ重ね、teleportや速度設定を重力・接触計算より前に適用します
  var position = source.position.xyz;
  var orientation = quatNormalize(source.orientation);
  var linearVelocity = source.linearVelocityInvMass.xyz;
  var angularVelocity = source.angularVelocitySleep.xyz;
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.setLinearVelocity}u)) {
    linearVelocity = control.linearVelocity.xyz;
  }
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.setAngularVelocity}u)) {
    angularVelocity = control.angularVelocity.xyz;
  }
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportPosition}u)) {
    position = control.position.xyz;
  }
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.teleportOrientation}u)) {
    orientation = quatNormalize(control.orientation);
  }
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.stopMotion}u)) {
    linearVelocity = vec3f(0.0);
    angularVelocity = vec3f(0.0);
  }
  if (hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.sleep}u)) {
    linearVelocity = vec3f(0.0);
    angularVelocity = vec3f(0.0);
  }
  if (staticBody) {
    // static bodyは位置と姿勢の入力だけを保持し、重力・solver・sleep判定を対象外として扱います
    var staticResult = source;
    staticResult.position = vec4f(position, 1.0);
    staticResult.orientation = orientation;
    staticResult.linearVelocityInvMass = vec4f(0.0, 0.0, 0.0, source.linearVelocityInvMass.w);
    staticResult.angularVelocitySleep = vec4f(0.0);
    clearBodyCommands(bodyIndex);
    dstBodies[bodyIndex] = staticResult;
    return;
  }
  var awakeContact = false;
  var wakeState = WakeContactState(false, false, 0u, 0.0, 0.0);
  if (wasSleeping) {
    // sleep bodyは活動bodyとの法線接近がなければそのままstateを複製し、不要なsolver計算を省きます
    awakeContact = awakeContactExists(bodyIndex, source, count, &wakeState);
    if (!awakeContact) {
      clearBodyCommands(bodyIndex);
      dstBodies[bodyIndex] = source;
      return;
    }
  }
  if (wasSleeping) {
    wasSleeping = false;
  }
  // 予測接触でsleepを解除したbodyには、二分探索した接触開始位置の相手をsolver入力として渡します
  // fixed step終端の深い重なりを避け、次のbodyへ接触開始時の法線力積を伝えます
  let wakeSolverSeed = sourceWasSleeping && awakeContact;
  let sleepEnabled = params.timing.w > 0.5 && control.config.z > 0u && control.config.y == 2u;
  if (source.linearVelocityInvMass.w <= 0.0 && control.config.y == 2u) {
    clearBodyCommands(bodyIndex);
    dstBodies[bodyIndex] = source;
    return;
  }
  if (control.config.y == 2u) {
    // dynamic bodyだけがforce、impulse、torque、重力を速度へ積分します
    linearVelocity += control.force.xyz * source.linearVelocityInvMass.w * params.timing.x;
    linearVelocity += control.linearImpulse.xyz * source.linearVelocityInvMass.w;
    angularVelocity += inverseInertiaApply(
      orientation,
      source.inverseInertiaLocal.xyz,
      control.torque.xyz
    ) * params.timing.x;
    angularVelocity += inverseInertiaApply(
      orientation,
      source.inverseInertiaLocal.xyz,
      control.angularImpulse.xyz
    );
    linearVelocity += params.gravityBeta.xyz * control.properties.x * params.timing.x;
  }
  let dt = params.timing.x;
  // dampingを指数減衰として適用してから位置と姿勢をfixed step分だけ進めます
  linearVelocity *= exp(-source.material.z * dt);
  angularVelocity *= exp(-source.material.w * dt);
  position += linearVelocity * dt;
  orientation = integrateOrientation(orientation, angularVelocity, dt);
  let requestedSleep = hasBodyCommand(commandFlags, ${COMPUTE_PHYSICS_BODY_COMMAND_FLAGS.sleep}u);
  var hasSupport = false;
  var bodyContactObserved = false;
  var activeDynamicBodyContactObserved = false;
  var nonFloorPlaneContactObserved = false;
  var maxContactSpeed = 0.0;
  var maxNormalSpeed = 0.0;
  var bodySupportObserved = false;
  var wallSupportImpulseY = 0.0;
  var floorSupportPoints = 8u;
  var requiredFloorSupportPoints = 1u;
  var floorContactObserved = false;
  // Planeごとの累積力積をbody invocation内へ保持し、solver反復では差分だけを適用します
  // 事前にmaxPlanes全件を初期化せず、実際に処理するplaneをiteration 0で初期化します
  var planeImpulseAccumulators : array<PlaneImpulseAccumulator, ${space.maxPlanes}>;
  // 共有pairの別passは設けず、各body invocationが自身の局所position/velocity/angularVelocityへ接触応答を累積します
  // 相手bodyはfixed step開始時のsrc snapshotを読み、各反復でcontactとlambdaを再評価してPlane接触と同じ局所状態へ反映します
  // candidateはiteration 0から同じbitsetを再利用するため、候補へ入ったslotだけを遅延初期化します
  var pairImpulseAccumulators : array<PairImpulseAccumulator, ${space.maxBodies * 4}>;
  var pairTargetNormalVelocities : array<f32, ${space.maxBodies}>;
  let iterations = u32(params.timing.z);
  // candidate bitsetを各solver反復で再利用し、body接触とPlane接触を同じ局所状態へ順に反映します
  for (var iteration = 0u; iteration < ${solverIterationLimit}u; iteration += 1u) {
    if (iteration >= iterations) { break; }
    for (var wordIndex = 0u; wordIndex < ${words}u; wordIndex += 1u) {
      var bits = candidateWord(bodyIndex, wordIndex);
      loop {
        if (bits == 0u) { break; }
        let bitIndex = u32(firstTrailingBit(bits));
        bits &= bits - 1u;
        let otherIndex = wordIndex * 32u + bitIndex;
        if (otherIndex < count) {
          var solverOther = srcBodies[otherIndex];
          let otherControl = bodyControls[otherIndex];
            if (iteration == 0u) {
              pairTargetNormalVelocities[otherIndex] = -1.0;
              for (var initializeIndex = 0u; initializeIndex < 4u; initializeIndex += 1u) {
                pairImpulseAccumulators[otherIndex * 4u + initializeIndex]
                  = PairImpulseAccumulator(0.0, 0.0, 0.0, -1.0);
              }
            }
            if (otherControl.config.y == 1u) {
              // kinematicのteleport targetまたは次stepの速度を接触形状にも反映し、
              // quasiStatic台の一つ前のsnapshotへ摩擦力積を掛けないようにします
              solverOther = predictWakeBody(solverOther, otherControl);
            }
            if (wakeSolverSeed && otherIndex == wakeState.otherIndex) {
            solverOther = predictWakeImpactBody(solverOther, bodyControls[otherIndex], source);
            } else if (!sourceWasSleeping && solverOther.angularVelocitySleep.w > 0.5) {
              // 活動bodyがsleep bodyへこのstepで初めて触れる場合は、step終端の重なりではなく接触開始姿勢へ揃えます
              // sleep body側が同じ予測接触から受ける力積と対になる反作用を活動body側へ与え、運動量の複製を防ぎます
              let startContact = computeColliderContact(
                source,
                source.position.xyz,
                quatNormalize(source.orientation),
                solverOther
              );
              let endContact = computeColliderContact(source, position, orientation, solverOther);
              if (startContact.pointValid.w < 0.5 && endContact.pointValid.w > 0.5) {
                let impactSource = predictWakeImpactBody(source, control, solverOther);
                position = impactSource.position.xyz;
                orientation = quatNormalize(impactSource.orientation);
              }
            }
            var manifold = computeColliderContactManifold(source, position, orientation, solverOther);
            for (var contactIndex = 0u; contactIndex < 4u; contactIndex += 1u) {
              if (contactIndex >= manifold.pointCount) { break; }
              let contact = Contact(manifold.normalPenetration, manifold.points[contactIndex]);
              hasSupport = solveBodyContact(
                source, control.properties, bodyIndex, solverOther, otherIndex,
                contact, contactIndex, &pairTargetNormalVelocities[otherIndex],
                &pairImpulseAccumulators[otherIndex * 4u + contactIndex],
                &position, orientation, &linearVelocity, &angularVelocity,
                iteration,
                &maxContactSpeed,
                &maxNormalSpeed,
                &bodySupportObserved,
                &bodyContactObserved,
                &activeDynamicBodyContactObserved
              ) || hasSupport;
            }
        }
      }
    }
    for (var planeIndex = 0u; planeIndex < u32(params.scale0.x); planeIndex += 1u) {
      // Planeはbody candidate bitsetの外側で処理し、床の支持点数と壁の上向き摩擦を診断へ残します
      let plane = planeColliders[planeIndex];
      if (iteration == 0u) {
        planeImpulseAccumulators[planeIndex] = PlaneImpulseAccumulator(0.0, 0.0, 0.0, -1.0);
      }
      var normalImpulseObserved = false;
      var supportBalanced = false;
      let supportPoints = solveComputePlaneBody(
        source, control.properties, bodyIndex * ${space.maxBodies + space.maxPlanes}u + ${space.maxBodies}u + planeIndex,
        plane, &position, orientation, &linearVelocity, &angularVelocity,
        iteration, &maxNormalSpeed,
        &planeImpulseAccumulators[planeIndex],
        &wallSupportImpulseY
      );
      let requiredSupportPoints = select(
        u32(params.sleep.z), 1u, source.inverseInertiaLocal.w > 0.5
      );
      if (plane.normalPlaneDistance.y > 0.5 && supportPoints > 0u) {
        floorContactObserved = true;
        floorSupportPoints = min(floorSupportPoints, supportPoints);
        requiredFloorSupportPoints = requiredSupportPoints;
      }
      if (supportPoints > 0u && abs(plane.normalPlaneDistance.y) <= 0.5) {
        // 床以外のPlaneについては、上向き摩擦力積の有無に限定せず実接触を記録します
        // 床1点支持bodyが壁へ実際に接触して静止している場合のsleep候補へ使います
        nonFloorPlaneContactObserved = true;
      }
      hasSupport = hasSupport || (
        plane.normalPlaneDistance.y > 0.5
        && supportPoints >= requiredSupportPoints
      );
    }
  }
  // Floor接触があるBoxは、床2点以上、下向きbody支持、壁friction支持のいずれかを基本条件にします
  // Floor1点だけの場合は、同じfixed stepの床外実接触と低速条件を後段のsleep判定で組み合わせます
  // 重心投影のbalanceは接触点の選択へ使い、sleepは現在の支持接触と速度条件で許可します
  let wallSupportObserved = wallSupportImpulseY > 0.0;
  let floorOnePointExternalContact = floorContactObserved
    && requiredFloorSupportPoints > 1u
    && floorSupportPoints < requiredFloorSupportPoints
    && (bodyContactObserved || nonFloorPlaneContactObserved);
  let combinedSupport = floorSupportPoints >= requiredFloorSupportPoints
    || bodySupportObserved
    || wallSupportObserved
    || floorOnePointExternalContact;
  if (floorContactObserved) {
    // 床1点だけでは通さず、同じfixed stepの別body・壁実接触がある場合だけ補助支持として認めます
    hasSupport = (hasSupport && combinedSupport) || floorOnePointExternalContact;
  } else {
    hasSupport = hasSupport || wallSupportObserved;
  }
  // 法線impulseを伴う接触速度、body自身の速度、支持点条件を分けてsleep可否を判定します
  // wakeしたfixed stepは過去の満了counterを引き継がず、起きた後の静止時間を数え直します
  // 通常のactive bodyも0から始め、sleep bodyがwakeを発生させず早期returnした場合だけ上の分岐で旧stateを保持します
  var sleepCounter = select(
    0u,
    u32(source.halfExtentsSleepCounter.w),
    !(sourceWasSleeping && awakeContact)
  );
  var sleepFlag = 0.0;
  let lowMotion = length(linearVelocity) < params.scale1.y && length(angularVelocity) < params.scale1.z;
  let quietContact = maxContactSpeed < params.scale1.w && maxNormalSpeed < params.sleep.x;
  // 床へ密着して自身が静止したbodyは、上載bodyの沈み込み速度を分離してsleepを判定します
  // 下側body自身の速度はlowMotionで検査し、上載bodyが強く押し込めばwake条件で再びsolverへ戻します
  let floorSupportLoadSettled = floorContactObserved
    && floorSupportPoints >= requiredFloorSupportPoints
    && lowMotion;
  var sleepContactQuiet = quietContact || floorSupportLoadSettled;
  // sleep中の相手との接触で微小な接近速度だけが残る場合は、wake閾値未満まで減衰していれば停止候補にします
  // 動的active bodyが一つでも接触しているstepは従来のsleep閾値を使い、衝突の見逃しを防ぎます
  let sleepingContactsOnly = bodyContactObserved && !activeDynamicBodyContactObserved;
  let lowMotionWithSleepingContacts = sleepingContactsOnly
    && length(linearVelocity) < params.wake.x
    && length(angularVelocity) < params.wake.y;
  let sleepMotionSettled = lowMotion || lowMotionWithSleepingContacts;
  sleepContactQuiet = sleepContactQuiet || lowMotionWithSleepingContacts;
  if (sleepEnabled && hasSupport && sleepMotionSettled && sleepContactQuiet) {
    // 条件を連続fixed stepで満たした場合にsleepし、安定した静止時間を確認します
    sleepCounter = min(sleepCounter + 1u, u32(params.sleep.y));
    if (sleepCounter >= u32(params.sleep.y)) {
      linearVelocity = vec3f(0.0);
      angularVelocity = vec3f(0.0);
      sleepFlag = 1.0;
    }
  } else {
    sleepCounter = 0u;
  }
  if (requestedSleep && control.config.z > 0u) {
    linearVelocity = vec3f(0.0);
    angularVelocity = vec3f(0.0);
    sleepCounter = u32(params.sleep.y);
    sleepFlag = 1.0;
  }
  if (commandWakes && !requestedSleep) {
    sleepCounter = 0u;
    sleepFlag = 0.0;
  }
  let sleepCounterReset = source.halfExtentsSleepCounter.w > 0.0 && sleepCounter == 0u;
  // 計算済みのtransform、速度、sleep counterをdstへ書き、外部命令は最後に一度だけ消費します
  var result = source;
  result.position = vec4f(position, 1.0);
  result.orientation = orientation;
  result.linearVelocityInvMass = vec4f(linearVelocity, source.linearVelocityInvMass.w);
  result.angularVelocitySleep = vec4f(angularVelocity, sleepFlag);
  result.halfExtentsSleepCounter = vec4f(source.halfExtentsSleepCounter.xyz, f32(sleepCounter));
  clearBodyCommands(bodyIndex);
  dstBodies[bodyIndex] = result;
}
`;
    const selectedCode = entryPoints ? pruneComputeWGSL(code, entryPoints) : code;
    return options.minify ? minifyComputeWGSL(selectedCode) : selectedCode;
}
