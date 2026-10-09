// ---------------------------------------------
// ComputeParticleShaders.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 発生要求からGPU上で初期値を作り、同じ粒子bufferを更新・描画で共有する

import { MAX_PARTICLE_COMMANDS } from "./ComputeParticleSettings.js";

const STRUCTS = `
struct Particle { positionLife: vec4f, velocityLife: vec4f, colorSize: vec4f }
// headerは48 float、各発生要求は32 float。整数識別子はbitcastで保存する
struct Command {
  slots: vec4u, positionLife: vec4f, velocityLife: vec4f, spreadSize: vec4f,
  colorSize: vec4f, alternateMode: vec4f, directionAngle: vec4f, speed: vec4f
}
struct Params {
  projection: mat4x4f, rotation: mat4x4f, camera: vec4f, step: vec4f,
  gravityDrag: vec4f, counts: vec4u, commands: array<Command, ${MAX_PARTICLE_COMMANDS}>
}
@group(0) @binding(1) var<uniform> params: Params;
`;

export const COMPUTE_PARTICLE_UPDATE = STRUCTS + `
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
// seed、発生番号、粒子番号から再現可能な乱数列を得る
fn random(state: ptr<function, u32>) -> f32 {
  *state += 0x9e3779b9u;
  var h = *state;
  h = (h ^ (h >> 16u)) * 0x21f0aaadu;
  h = (h ^ (h >> 15u)) * 0x735a2d97u;
  h ^= h >> 15u;
  return f32(h >> 8u) / 16777216.0;
}
// 一つの粒子を進めた後、そのスロット宛ての発生要求を順番に適用する
@compute @workgroup_size(64)
// 既存粒子の位置と寿命を更新してから、発生要求を各スロットへ適用する
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&particles)) { return; }
  var p = particles[id.x];
  let dt = params.step.x;
  if (p.positionLife.w > 0.0) {
    p.positionLife.w -= dt;
    p.velocityLife = vec4f((p.velocityLife.xyz + params.gravityDrag.xyz * dt)
      * exp(-params.gravityDrag.w * dt), p.velocityLife.w);
    p.positionLife = vec4f(p.positionLife.xyz + p.velocityLife.xyz * dt, p.positionLife.w);
  }
  for (var index = 0u; index < params.counts.x; index++) {
    let c = params.commands[index];
    let offset = (id.x + params.counts.y - c.slots.x) % params.counts.y;
    if (offset >= c.slots.y) { continue; }
    var state = params.counts.z ^ (c.slots.z * 747796405u) ^ (offset * 2891336453u);
    let life = mix(c.positionLife.w, c.velocityLife.w, random(&state));
    var velocity = c.velocityLife.xyz + (vec3f(random(&state), random(&state), random(&state)) * 2.0 - 1.0) * c.spreadSize.xyz;
    if (c.alternateMode.w > 0.5) {
      let axis = c.directionAngle.xyz;
      let helper = select(vec3f(0, 1, 0), vec3f(1, 0, 0), abs(axis.y) > 0.99);
      let right = normalize(cross(helper, axis));
      let forward = cross(axis, right);
      let cosine = mix(cos(c.directionAngle.w), 1.0, random(&state));
      let sine = sqrt(max(0.0, 1.0 - cosine * cosine));
      let angle = random(&state) * 6.28318530718;
      velocity = (axis * cosine + sine * (right * cos(angle) + forward * sin(angle)))
        * mix(c.speed.x, c.speed.y, random(&state));
    }
    p.positionLife = vec4f(c.positionLife.xyz, life);
    p.velocityLife = vec4f(velocity, life);
    p.colorSize = vec4f(select(c.colorSize.xyz, c.alternateMode.xyz, offset % 3u == 0u),
      mix(c.spreadSize.w, c.colorSize.w, random(&state)));
  }
  particles[id.x] = p;
}`;

// 正対板の粒子描画WGSLを作り、必要な場合は水面より奥の画素だけを残す
export function buildComputeParticleRenderWgsl({ behindWater = false } = {}) {
  return STRUCTS + `
${behindWater ? "@group(1) @binding(0) var waterDepth : texture_depth_2d;" : ""}
@group(0) @binding(0) var<storage, read> particles: array<Particle>;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) color: vec4f }
// ワールド位置をカメラ相対へ変換し、半径に対応する正対板を描く
@vertex fn vsMain(@location(0) corner: vec2f, @builtin(instance_index) id: u32) -> Out {
  let p = particles[id];
  var out: Out;
  let view = params.rotation * vec4f(p.positionLife.xyz - params.camera.xyz, 1.0);
  out.position = params.projection * (view + vec4f(corner * p.colorSize.w, 0, 0));
  if (p.positionLife.w <= 0.0) { out.position = vec4f(2, 2, 0, 1); }
  out.uv = corner;
  out.color = vec4f(p.colorSize.xyz, min(max(p.positionLife.w, 0.0) * 4.0, 1.0));
  return out;
}
// 円の外側を除き、中心から周辺へ滑らかに発光量を減らす
@fragment fn fsMain(input: Out) -> @location(0) vec4f {
  ${behindWater ? "if (input.position.z >= textureLoad(waterDepth, vec2i(input.position.xy), 0) - 0.000001) { discard; }" : ""}
  let radius = dot(input.uv, input.uv);
  if (radius >= 1.0) { discard; }
  return vec4f(input.color.rgb, input.color.a * (1.0 - radius));
}`;
}

export const COMPUTE_PARTICLE_RENDER = buildComputeParticleRenderWgsl();
