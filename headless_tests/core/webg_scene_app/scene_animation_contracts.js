import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import Node from "../../../webg/Node.js";
import Quat from "../../../webg/Quat.js";
import SceneDefinition from "../../../webg/app/SceneDefinition.js";
import WebgSceneApp from "../../../webg/app/WebgSceneApp.js";
import SceneAnimations, { readSceneAnimationDefinitions } from "../../../webg/app/SceneAnimations.js";
import { readPrimitiveDefinitions } from "../../../webg/app/PrimitiveScene.js";

const q = angle => { const result = new Quat(); result.eulerToQuat(angle, 0, 0); return result.q; };
const pose = (x, angle) => ({ position: [x, 1, 0], quaternion: q(angle) });
const clip = {
  id: "gate-motion",
  keyframes: [{ id: "closed", time: 0 }, { id: "open", time: 1 }, { id: "held", time: 2 }],
  tracks: [{ id: "gate-track", target: { object: "gate" }, poses: [pose(0, 0), pose(2, 90), pose(2, 90)] }]
};
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const sameRotation = (node, angle) => close(Math.abs(node.getQuat().dotProduct({ q: q(angle) })), 1);
const definitions = () => structuredClone([clip]);
const rejected = (mutate, pattern) => {
  const data = definitions(); mutate(data);
  assert.throws(() => readSceneAnimationDefinitions(data), pattern);
};
rejected(d => d.push(d[0]), /duplicate ID/);
rejected(d => d[0].keyframes[0].time = 0.1, /start at zero/);
rejected(d => d[0].keyframes[2].time = 1, /strictly increase/);
rejected(d => d[0].keyframes[2].id = "open", /duplicate ID/);
rejected(d => d[0].tracks[0].poses.pop(), /poses must match/);
rejected(d => d[0].tracks[0].poses[0].quaternion = [0, 0, 0, 0], /unit length/);
rejected(d => d[0].tracks[0].poses[0].quaternion = [1, 0, 0], /4 numbers/);
rejected(d => d[0].tracks[0].poses[0].position[0] = Infinity, /finite/);
rejected(d => d[0].tracks[0].poses[0].position[0] = "1", /finite/);
rejected(d => d[0].tracks[0].poses[0].orientation = [0, 0, 0], /not supported/);
rejected(d => d[0].tracks[0].target = { skeleton: "rig", joint: "bone" }, /not supported/);
rejected(d => d[0].tracks[0].interpolation = { quaternion: "bezier" }, /requires slerp/);
rejected(d => d[0].tracks[0].poses[0].scale = [1, 1, 1], /every key/);
rejected(d => d[0].tracks[0].poses.forEach(p => p.scale = [1, 2, 1]), /uniform scale/);
rejected(d => d[0].tracks[0].poses.forEach(p => p.scale = [0, 0, 0]), /uniform scale/);
rejected(d => d[0].tracks[0].poses.forEach((p, i) => p.scale = [1+i, 1+i, 1+i]), /animated scale/);

const parent = new Node(null, "placement"); parent.setPosition(10, 0, 0);
const gate = new Node(parent, "gate"); parent.addChild(gate);
gate.setPosition(0, 1, 0); gate.setAttitude(30, 0, 0); gate.setScale(2);
const base = gate.getWorldMatrix().mat.slice();
const player = new SceneAnimations(definitions(), id => id === "gate" ? gate : null);
assert.deepEqual(player.getIds(), [clip.id]);
assert.equal(player.getState(clip.id).status, "stopped");
player.play(clip.id);
player.update(5); // First frame establishes the clock boundary, excluding prior idle time.
close(player.getState(clip.id).time, 0);
player.update(0.5);
close(gate.getPosition()[0], 1); sameRotation(gate, 45);
close(gate.getWorldPosition()[0], 11); close(gate.getScale(), 2);
player.pause(clip.id); player.update(60);
close(player.getState(clip.id).time, 0.5);
player.resume(clip.id); player.update(60); player.update(0.5);
sameRotation(gate, 90); close(player.getState(clip.id).time, 1);
player.update(1); assert.equal(player.getState(clip.id).status, "finished");
player.update(100); sameRotation(gate, 90);
player.seek(clip.id, 0.25); close(gate.getPosition()[0], 0.5); sameRotation(gate, 22.5);
assert.equal(player.getState(clip.id).status, "paused");
player.seek(clip.id, -4); sameRotation(gate, 0);
player.seek(clip.id, 40); sameRotation(gate, 90);
player.stop(clip.id); player.update(1); sameRotation(gate, 90);
assert.throws(() => player.resume(clip.id), /paused clip/);
player.play(clip.id, { loop: true }); player.update(0); player.update(4.5);
sameRotation(gate, 45); close(player.getState(clip.id).time, 0.5);
player.reset(); assert.deepEqual(gate.getWorldMatrix().mat, base);
assert.equal(player.getState(clip.id).status, "stopped");
assert.throws(() => player.seek(clip.id, NaN), /finite/);
assert.throws(() => player.update(-1), /non-negative/);
assert.throws(() => player.play("missing"), /unknown clip/);
assert.throws(() => player.play(clip.id, { loop: 1 }), /boolean/);

const samePose = definitions();
samePose[0].tracks[0].poses[1].quaternion = q(0).map(v => -v);
samePose[0].tracks[0].poses[2].quaternion = q(0);
const signPlayer = new SceneAnimations(samePose, () => gate);
signPlayer.seek(clip.id, 0.5); sameRotation(gate, 0);
const near = definitions(); near[0].tracks[0].poses[1].quaternion = q(0.001);
const nearPlayer = new SceneAnimations(near, () => gate);
nearPlayer.seek(clip.id, 0); sameRotation(gate, 0);
nearPlayer.seek(clip.id, 0.5); sameRotation(gate, 0.0005);
const roundTrip = structuredClone(clip);
roundTrip.keyframes = [0,1,2,3].map(time => ({ id: `turn${time}`, time }));
roundTrip.tracks[0].poses = [0,120,240,360].map(a => pose(0,a));
const spin = new SceneAnimations([roundTrip], () => gate);
for (const t of [0.5,1.5,2.5,3,0]) { spin.seek(clip.id,t); sameRotation(gate, t*120); }

const single = definitions(); single[0].keyframes.length = 1; single[0].tracks[0].poses.length = 1;
const still = new SceneAnimations(single, () => gate);
still.play(clip.id, { loop:true }); still.update(5);
assert.equal(still.getState(clip.id).status, "finished");
const duplicate = { ...structuredClone(clip), id: "other" };
const multiple = new SceneAnimations([clip,duplicate], () => gate);
multiple.play(clip.id);
assert.throws(() => multiple.play("other"), /owned by clip/);
multiple.pause(clip.id);
assert.throws(() => multiple.seek("other", 0), /owned by clip/);
multiple.stop(clip.id); multiple.play("other");
assert.throws(() => new SceneAnimations([clip], () => null), /unavailable/);
assert.throws(() => new SceneAnimations([clip], () => gate, [gate]), /display-only/);
const child = new Node(gate, "physical-child");
assert.throws(() => new SceneAnimations([clip], () => gate, [child]), /display-only/);

const object = { id: "gate", shape: { type: "box", size: [2,1,0.1] }, transform: { orientation: [0,30,0] } };
const manifest = { format: "webg-scene", version: 1, objects: [object], animations: definitions() };
assert.equal(new SceneDefinition(manifest).validate(), true);
assert.throws(() => new SceneDefinition({ ...manifest, version: 2 }).validate(), /version 1/);
assert.throws(() => new SceneDefinition({ ...manifest, format: undefined }).validate(), /require format/);
assert.throws(() => new SceneDefinition({ ...manifest, objects: [{ ...object, id: "unknown" }] }).validate(), /unknown object/);
assert.throws(() => readPrimitiveDefinitions([{ ...object, parent: "unknown" }]), /unknown object/);
assert.throws(() => readPrimitiveDefinitions([{ ...object, parent: "gate" }]), /cyclic parent/);
assert.throws(() => new SceneDefinition({ ...manifest, objects: [{ ...object, physics: { bodyType: "static" } }] }).validate(), /physics.space/);
assert.throws(() => new SceneDefinition({ ...manifest, physics: { space: {} }, objects: [{ ...object, physics: { bodyType: "static" } }] }).validate(), /display-only/);
const parentObject = { ...object, id: "base", transform: { position: [10,0,0] } };
const hierarchy = readPrimitiveDefinitions([{ ...object, parent: "base" }, parentObject]);
assert.equal(hierarchy[0].parent, "base");

// API wrappers and frame integration remain testable without constructing a GPU.
const sceneApp = new WebgSceneApp({ project: manifest });
sceneApp.animations = player;
sceneApp.effectOptions = {};
sceneApp.renderer = { createFrameCallbacks: (_app, options) => options, destroy() {} };
sceneApp.app = { start() {}, stop() {} };
const callbacks = sceneApp.createFrameCallbacks();
sceneApp.playAnimation(clip.id); callbacks.onUpdate({ deltaSec: 0 }); callbacks.onUpdate({ deltaSec: 0.5 });
sameRotation(gate,45);
sceneApp.stopAnimation(clip.id); sceneApp.seekAnimation(clip.id,1); sameRotation(gate,90);
sceneApp.reset(); sameRotation(gate,30);
assert.equal(sceneApp.renderMode,"ondemand");
sceneApp.destroy(); assert.throws(() => sceneApp.playAnimation(clip.id), /destroyed/);
assert.throws(() => player.getIds(), /destroyed/);

// The compressed exchange file is YAML text, parsed directly into scene data.
const yaml = `format: webg-scene\nversion: 1\nobjects:\n  - id: gate\n    shape: { type: box, size: [2, 1, 0.1] }\nanimations:\n  - id: turn\n    keyframes: [{id: a, time: 0}, {id: b, time: 1}]\n    tracks:\n      - id: gate-track\n        target: {object: gate}\n        poses:\n          - position: [0, 0, 0]\n            quaternion: [1, 0, 0, 0]\n          - position: [2, 0, 0]\n            quaternion: [0.7071067812, 0, 0.7071067812, 0]\n`;
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(gzipSync(yaml));
  const loaded = await SceneDefinition.load("https://example.test/scene.yaml.gz");
  assert.equal(loaded.validate(),true);
  const result = readSceneAnimationDefinitions(loaded.manifest.animations);
  assert.equal(result[0].tracks[0].target.object,"gate");
} finally { globalThis.fetch = originalFetch; }
console.log("PASS scene_animation_contracts: validation, LERP/SLERP, hierarchy, lifecycle, conflict and gzip");
