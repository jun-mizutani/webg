import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parseKarakuriDocument, stringifyKarakuriDocument, migrateKarakuriStandardStartupTimeScale, readKarakuriText } from "../../../samples/karakuri/scene_document.js";
import { readObjectEuler, objectRelations, uniqueObjectId, editDocument, editObjectMaterial, readEditorNumber } from "../../../samples/karakuri/editor_state.js";
import { EmitterClock } from "../../../samples/karakuri/emitter_clock.js";
import { findReachedGoals } from "../../../samples/karakuri/goal_runtime.js";
import { KarakuriAudio, collectBallBodyIds, contactIncludesBody } from "../../../samples/karakuri/karakuri_audio.js";
import { formatTimeScale } from "../../../samples/karakuri/karakuri_shared.js";
import { viewProjection, projectPoint, pointOnHeight, pointOnDepth, pickMesh } from "../../../samples/karakuri/editor_projection.js";
import Matrix from "../../../webg/Matrix.js";
import Space from "../../../webg/Space.js";
import { addDominoRow } from "../../../samples/karakuri/domino_parts.js";

const url = new URL("../../../samples/karakuri/karakuri_scene.yaml", import.meta.url);
const text = readFileSync(url, "utf8");
const state = parseKarakuriDocument(text, url.href);
let count = 0;
async function test(name, run) { await run(); count++; console.log(`PASS ${name}`); }
function rejectEdit(edit, pattern) {
  const before = structuredClone(state.manifest);
  assert.throws(() => editDocument(state, edit), pattern);
  assert.deepEqual(state.manifest, before);
}

await test("untouched YAML preserves all comments and formatting", () => {
  assert.equal(stringifyKarakuriDocument(state.manifest, state), text);
});
await test("starting scene has a visible flat floor aligned with the physics plane", () => {
  const floor = state.manifest.objects.find(object => object.id === "floor");
  assert.ok(floor);
  assert.deepEqual(floor.shape, { type: "box", size: [7, 0.1, 7] });
  assert.deepEqual(floor.transform.position, [0, -0.05, 0]);
  assert.equal(floor.material, "machine-floor");
  assert.equal(floor.physics, undefined);
  assert.deepEqual(state.manifest.physics.space.gravity, [0, -9.80665, 0]);
  assert.equal(state.playback.defaultTimeScale, 1.0);
  assert.deepEqual(state.manifest.physics.space.planes[0], { normal: [0, 1, 0], planeDistance: 0 });
  assert.deepEqual(state.manifest.objects.find(object => object.id === "back-wall").shape, { type: "box", size: [7, 3.6, 0.12] });
  assert.deepEqual(state.manifest.objects.find(object => object.id === "left-wall").shape, { type: "box", size: [0.12, 3.6, 7] });
  assert.deepEqual(state.manifest.objects.find(object => object.id === "right-wall").shape, { type: "box", size: [0.12, 3.6, 7] });
});
await test("floor uses mixed-sawn Oak with zero joint width", () => {
  const definition = state.manifest.proceduralMaterials.find(entry => entry.materialId === "machine-floor");
  assert.ok(definition);
  assert.equal(definition.preset, "wood.oak.mixed-sawn");
  assert.equal(definition.scale, 2);
  assert.equal(definition.tile.joint.widthMeters, 0);
  assert.equal(definition.appearance.roughness, 0.42);
  assert.equal(definition.appearance.normalStrength, 1.15);
  const projectMaterial = state.projectManifest.materials.find(material => material.id === "machine-floor");
  assert.ok(projectMaterial);
  assert.equal(projectMaterial.roughness, 0.42);
  assert.equal("uvScale" in projectMaterial, false);
});
await test("wall uses a textured lower-roughness surface", () => {
  const definition = state.manifest.proceduralMaterials.find(entry => entry.materialId === "wall");
  assert.ok(definition);
  assert.equal(definition.preset, "ceramic.white.square");
  assert.equal(definition.scale, 2);
  assert.equal(definition.appearance.roughness, 0.38);
  const projectMaterial = state.projectManifest.materials.find(material => material.id === "wall");
  assert.ok(projectMaterial);
  assert.equal(projectMaterial.roughness, 0.38);
});
await test("ball uses a cool metallic aluminum color", () => {
  const ball = state.manifest.materials.find(material => material.id === "ball");
  assert.ok(ball);
  assert.deepEqual(ball.color, [0.68, 0.70, 0.72, 1]);
  assert.equal(ball.metallic, 1.0);
});
await test("one edit adds two six-domino rows with unique IDs and reserved capacity", () => {
  const originalObjectCount = state.manifest.objects.length;
  const next = editDocument(state, m => {
    addDominoRow(m, [2.5, 0, 0], state.world.editBounds);
    addDominoRow(m, [-2.5, 0, 0], state.world.editBounds);
  });
  const row = next.manifest.objects
    .slice(originalObjectCount)
    .filter(o => o.id.startsWith("domino-"));
  assert.equal(row.length, 12);
  assert.equal(new Set(row.map(o => o.id)).size, 12);
  for (const o of row) {
    assert.deepEqual(o.shape, { type: "box", size: [0.10, 0.6, 0.32] });
    assert.equal(o.physics.bodyType, "dynamic");
    assert.equal(o.transform.position[1], 0.3);
    assert.ok(o.transform.position[0] >= state.world.editBounds.min[0] + o.shape.size[0] / 2 - 1e-9);
    assert.ok(o.transform.position[0] <= state.world.editBounds.max[0] - o.shape.size[0] / 2 + 1e-9);
  }
  assert.ok(Math.abs(row[1].transform.position[0] - row[0].transform.position[0] - 0.3) < 1e-9);
  next.project.destroy();
});
await test("numeric-looking string IDs survive YAML round trip", () => {
  const next = editDocument(state, m => { m.objects[0].id = "001"; });
  assert.equal(next.manifest.objects[0].id, "001"); next.project.destroy();
});
await test("duplicate ID is transactional", () => rejectEdit(m => { m.objects[0].id = m.objects[1].id; }, /duplicat/i));
await test("invalid emitter dimensions, material and mass rejected before playback", () => {
  rejectEdit(m => { m.emitters[0].prototype.shape.radius = -1; }, /radius/);
  rejectEdit(m => { m.emitters[0].prototype.material = "missing"; }, /material/);
  rejectEdit(m => { m.emitters[0].prototype.physics.mass = -1; }, /mass/);
});
await test("emitter count, capacity and ID validation", () => {
  rejectEdit(m => { m.emitters[0].maxActive = 0; }, /maxActive/);
  rejectEdit(m => { m.emitters[0].maxCount = 1.5; }, /maxCount/);
  rejectEdit(m => { m.emitters[0].id = m.objects[0].id; }, /conflicts/);
  rejectEdit(m => { m.physics.space.maxBodies = 1; }, /maxBodies/);
  rejectEdit(m => { m.emitters[0].spawn = {}; }, /unsupported/);
});
await test("emitter ball slides easily and bounces strongly", () => {
  const material = state.manifest.emitters[0].prototype.physics.material;
  assert.equal(material.friction, 0.15);
  assert.equal(material.restitution, 0.72);
  assert.deepEqual(state.manifest.emitters[0].initialVelocity, [0.2, 0, 0]);
});
await test("goal contact definitions resolve object and emitter references", () => {
  assert.deepEqual(state.goals, [{
    id: "deliver-ball",
    target: "goal-board",
    source: { kind: "emitter", id: "ball-launcher" },
    message: "とどいた！",
    once: true
  }]);
  rejectEdit(m => { m.goals[0].target = "missing"; }, /unknown object/);
  rejectEdit(m => { m.goals[0].source = { emitter: "missing" }; }, /unknown emitter/);
  rejectEdit(m => { m.goals[0].message = ""; }, /non-empty/);
});
await test("goal contacts accept either body order and honor once", () => {
  const references = new Map([
    ["7", { kind: "object", id: "goal-board" }],
    ["9", { kind: "emitter", id: "ball-launcher" }]
  ]);
  const reached = new Set();
  assert.equal(findReachedGoals(state.goals, references, [{ bodyAId: 9, bodyBId: 7 }], reached).length, 1);
  assert.equal(findReachedGoals(state.goals, references, [{ bodyAId: 7, bodyBId: 9 }], reached).length, 0);
  assert.equal(findReachedGoals(state.goals, references, [{ bodyAId: 7, bodyBId: 99 }], reached).length, 0);
});
await test("collision audio tracks ball contacts and plane contact begins", () => {
  const audio = new KarakuriAudio();
  const ballBodyIds = new Set(["ball-1"]);
  assert.equal(contactIncludesBody({ bodyAId: "wall", bodyBId: "ball-1" }, ballBodyIds), true);
  assert.equal(contactIncludesBody({ bodyAId: "wall", bodyBId: "goal" }, ballBodyIds), false);
  const physics = {
    getPlaneContactsFromReadback: () => [{ bodyAId: "ball-1", planeIndex: 0 }]
  };
  assert.equal(audio.readPlaneContactBegins(physics, {}, ballBodyIds).length, 1);
  assert.equal(audio.readPlaneContactBegins(physics, {}, ballBodyIds).length, 0);
  assert.equal(audio.readPlaneContactBegins({ getPlaneContactsFromReadback: () => [] }, {}, ballBodyIds).length, 0);
  const allBalls = collectBallBodyIds(
    { getDiagnostics: () => ({ physics: { bindings: [{ id: "scene-ball", bodyId: 11 }] } }) },
    { objects: [{ id: "scene-ball", shape: { type: "sphere" } }, { id: "block", shape: { type: "box" } }] },
    [{ bodyId: 12 }]
  );
  assert.deepEqual([...allBalls].sort(), ["11", "12"]);
});
await test("playback options match core time-scale range and descending UI order", () => {
  rejectEdit(m => { m.playback.timeScaleOptions = [1, 2]; }, /descend/);
  rejectEdit(m => { m.playback.timeScaleOptions = [5, 0.5]; }, /descend/);
});
await test("speed multiplier labels preserve useful decimal precision", () => {
  assert.equal(formatTimeScale(1), "1.0");
  assert.equal(formatTimeScale(0.5), "0.5");
  assert.equal(formatTimeScale(0.25), "0.25");
});
await test("old standard local scenes start at normal speed", () => {
  const legacy = text.replace("defaultTimeScale: 1", "defaultTimeScale: 0.5");
  const migrated = migrateKarakuriStandardStartupTimeScale(legacy);
  assert.match(migrated, /defaultTimeScale: 1\.0/);
  assert.equal(migrateKarakuriStandardStartupTimeScale(text), text);
  const migratedState = parseKarakuriDocument(migrated, "local:legacy-standard.yaml");
  assert.equal(migratedState.playback.defaultTimeScale, 1.0);
  migratedState.project.destroy();
});
await test("finite numeric input and serialization", () => {
  assert.throws(() => readEditorNumber({ id: "mass", value: "", min: "0", max: "" }), /finite/);
  assert.throws(() => readEditorNumber({ id: "mass", value: "-1", min: "0", max: "" }), /minimum/);
  assert.equal(readEditorNumber({ id: "x", value: "-1.25", min: "", max: "" }), -1.25);
  assert.throws(() => stringifyKarakuriDocument({ x: NaN }), /finite/);
  assert.throws(() => stringifyKarakuriDocument({ x: undefined }), /defined/);
});
await test("Euler arrays retain X/Y/Z components", () => {
  assert.deepEqual(readObjectEuler({ transform: { orientation: [10, 90, 30] } }), { pitch: 10, yaw: 90, roll: 30 });
  assert.deepEqual(readObjectEuler({ transform: { orientation: { yaw: 90 } } }), { pitch: 0, yaw: 90, roll: 0 });
});
await test("IDs remain unique after deletion and include emitter IDs", () => {
  const m = structuredClone(state.manifest);
  m.objects.push({ ...structuredClone(m.objects[0]), id: "box-01" }, { ...structuredClone(m.objects[0]), id: "box-03" });
  m.emitters.push({ id: "box-02" });
  assert.equal(uniqueObjectId(m, "box"), "box-04");
});
await test("parent and current animation target references detected", () => {
  assert.deepEqual(objectRelations({ objects: [{ parent: "arm" }], animations: [{ tracks: [{ target: { object: "arm" } }] }] }, "arm"), ["objects[0].parent", "animations[0].tracks[0]"]);
});
await test("object material edit preserves shared source material", () => {
  const original = structuredClone(state.manifest.materials);
  const next = editDocument(state, m => editObjectMaterial(m, m.objects[0], { roughness: 0.33 }));
  assert.deepEqual(next.manifest.materials.slice(0, original.length), original);
  assert.notEqual(next.manifest.objects[0].material, state.manifest.objects[0].material);
  assert.equal(next.manifest.materials.at(-1).roughness, 0.33);
  next.project.destroy();
});
await test("gzip sniff, plain text and HTTP-decoded gzip", async () => {
  assert.equal(await readKarakuriText(new Blob([text]), "a.yaml"), text);
  assert.equal(await readKarakuriText(new Blob([gzipSync(text)]), "no-extension"), text);
  assert.equal(await readKarakuriText(new Response(text, { headers: { "Content-Encoding": "gzip" } }), "a.yaml.gz"), text);
  await assert.rejects(readKarakuriText(new Blob([text]), "a.yaml.gz"), /Expected gzip/);
  await assert.rejects(readKarakuriText(new Blob([new Uint8Array([0xff])]), "a.yaml"), /encoded|encoding/);
});
await test("each emitter owns its total count", () => {
  const clock = new EmitterClock();
  const firstSpawns = [];
  clock.advance({ id: "first", intervalSec: 2.8, maxCount: 2, maxActive: 4 }, 0, () => {
    firstSpawns.push(true);
    return true;
  });
  assert.equal(firstSpawns.length, 1);
  for (const id of ["a", "b"]) clock.advance({ id, intervalSec: 1, maxCount: 2, maxActive: 4 }, 10, () => true);
  assert.equal(clock.states.get("a").count, 2);
  assert.equal(clock.states.get("b").count, 2);
  clock.reset(); assert.equal(clock.states.size, 0);
});
await test("blocked emitter has bounded backlog and successful counts only", () => {
  const clock = new EmitterClock();
  const e = { id: "a", intervalSec: 1, maxActive: 2, maxCount: 0 };
  clock.advance(e, 10000, () => false);
  assert.deepEqual(clock.states.get("a"), { elapsed: 1, count: 0, waiting: true });
  clock.advance(e, 0, () => true);
  assert.equal(clock.states.get("a").count, 1);
  clock.advance(e, 10000, () => true);
  assert.equal(clock.states.get("a").count, 3);
});
await test("camera projection/unprojection follows camera movement and zoom", () => {
  const space = new Space();
  const eye = space.addNode(null, "eye");
  for (const [x, y, z, angle] of [[0, 14, 45, -9], [5, 12, 25, -20]]) {
    eye.setPosition(x, y, z); eye.rotateX(angle); eye.setWorldMatrix();
    const projectionMatrix = new Matrix(); projectionMatrix.makeProjectionMatrix(0.1, 1000, 52, 1280 / 720);
    const vp = viewProjection({ eye, projectionMatrix });
    const position = [-2, 1, -3];
    const pixel = projectPoint(vp, position, 1280, 720);
    assert.ok(pixel);
    const restored = pointOnHeight(vp, pixel.left/1280, 1-pixel.bottom/720, position[1]);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(position[i]-restored[i]) < 0.001, `${position} vs ${restored}`);
  }
});
state.project.destroy();
await test("XY plane dragging keeps depth under camera pitch", () => {
  const space = new Space(), eye = space.addNode(null, "eye");
  eye.setPosition(0, 2, 8); eye.rotateX(-12); eye.setWorldMatrix();
  const projectionMatrix = new Matrix(); projectionMatrix.makeProjectionMatrix(0.1, 100, 28, 1.7);
  const vp = viewProjection({ eye, projectionMatrix });
  const original = [1.8, 2.2, 0.4], pixel = projectPoint(vp, original, 1000, 600);
  const restored = pointOnDepth(vp, pixel.left/1000, 1-pixel.bottom/600, original[2]);
  original.forEach((v, i) => assert.ok(Math.abs(v-restored[i]) < 1e-5));
});
await test("mesh selection rejects empty corners of a triangle's bounding box", () => {
  const entry = { id: "triangle", node: { getWorldMatrix: () => new Matrix(), shapes: [{ positionArray: [0,0,0, 1,0,0, 0,1,0], indicesArray: [0,1,2] }] } };
  assert.equal(pickMesh([entry], { origin: [0.9,0.9,1], direction: [0,0,-1] }), null);
  assert.equal(pickMesh([entry], { origin: [0.2,0.2,1], direction: [0,0,-1] }), entry);
});
console.log(`karakuri editor contracts: ${count} passed (CPU/data only)`);
