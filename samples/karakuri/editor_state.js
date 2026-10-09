// Pure editing operations shared by the Maker and regression tests. 2026/09/23
import { parseKarakuriDocument, stringifyKarakuriDocument } from "./scene_document.js";
import { readPrimitiveDefinitions } from "../../webg/app/PrimitiveScene.js";

export function readObjectEuler(object) {
  const value = object.transform?.orientation;
  if (Array.isArray(value)) return { pitch: value[0], yaw: value[1], roll: value[2] };
  return { pitch: value?.pitch ?? 0, yaw: value?.yaw ?? 0, roll: value?.roll ?? 0 };
}

export function objectRelations(manifest, id) {
  const refs = [];
  for (const [i, object] of (manifest.objects ?? []).entries()) if (object.parent === id) refs.push(`objects[${i}].parent`);
  for (const [i, joint] of (manifest.physics?.joints ?? []).entries()) {
    if ([joint.a?.body, joint.b?.body, joint.a?.object, joint.b?.object, joint.bodyA, joint.bodyB, joint.objectA, joint.objectB].includes(id)) refs.push(`physics.joints[${i}]`);
  }
  for (const [ci, clip] of (manifest.animations ?? []).entries()) {
    for (const [ti, track] of (clip.tracks ?? []).entries()) if ((track.target?.object ?? track.target) === id) refs.push(`animations[${ci}].tracks[${ti}]`);
  }
  // Generated definitions can also name an explicit object as their parent.
  for (const [i, set] of (manifest.objectSets ?? []).entries()) {
    if (JSON.stringify(set).includes(JSON.stringify(id))) refs.push(`objectSets[${i}] (check references)`);
  }
  return refs;
}

export function uniqueObjectId(manifest, prefix) {
  const ids = new Set(readPrimitiveDefinitions(manifest.objects, manifest.objectSets, "Maker", { allowMaterialReference: true }).map(o => o.id));
  for (const e of manifest.emitters ?? []) ids.add(e.id);
  let n = 1;
  while (ids.has(`${prefix}-${String(n).padStart(2, "0")}`)) n++;
  return `${prefix}-${String(n).padStart(2, "0")}`;
}

export function editDocument(state, edit) {
  const candidate = structuredClone(state.manifest);
  edit(candidate);
  // Validation happens before the caller replaces its current state or saves to storage.
  return parseKarakuriDocument(stringifyKarakuriDocument(candidate, state), state.sourceUrl);
}

export function readEditorNumber(input) {
  const value = input.value.trim();
  if (!value || !Number.isFinite(Number(value))) throw new Error(`${input.id}: enter a finite number`);
  const number = Number(value);
  if (input.min !== "" && Number.isFinite(Number(input.min)) && number < Number(input.min)) throw new Error(`${input.id}: minimum ${input.min}`);
  if (input.max !== "" && Number.isFinite(Number(input.max)) && number > Number(input.max)) throw new Error(`${input.id}: maximum ${input.max}`);
  return number;
}

// A material edit is local to the selected object. Its old shared material remains intact.
export function editObjectMaterial(manifest, object, values) {
  const source = manifest.materials.find(m => m.id === object.material);
  if (!source) throw new Error(`unknown material ${object.material}`);
  let suffix = 1, id = `${object.id}-look`;
  while (manifest.materials.some(m => m.id === id)) id = `${object.id}-look-${suffix++}`;
  manifest.materials.push({ ...structuredClone(source), id, ...values });
  object.material = id;
}
