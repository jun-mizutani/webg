// ---------------------------------------------
// ProjectJointBindings.js     2026/09/08
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "../../webg/util.js";
import { isStableIdentifier, readStableIdentifier } from "./AuthoringVocabulary.js";

// ModelAsset physics bodyの名前付きanchorを検証し、body local座標へまとめます
// Object Sceneのanchor語彙と同じID規則・vec3規則をproject manifestへ適用します
export function readProjectAnchors(value, label = "ProjectRuntime physics body anchors") {
  if (value === undefined) return Object.freeze({});
  const source = util.readPlainObject(value, label);
  const anchors = {};
  for (const [name, raw] of Object.entries(source)) {
    if (!isStableIdentifier(name)) {
      throw new Error(`${label}.${name} must be a stable ID`);
    }
    const anchor = util.readPlainObject(raw, `${label}.${name}`);
    for (const key of Object.keys(anchor)) {
      if (key !== "localPoint") throw new Error(`${label}.${name}.${key} is not supported`);
    }
    if (!Array.isArray(anchor.localPoint) || anchor.localPoint.length !== 3) {
      throw new Error(`${label}.${name}.localPoint must be a vec3`);
    }
    anchors[name] = Object.freeze({
      localPoint: Object.freeze(anchor.localPoint.map((entry, index) => util.readFiniteNumber(
        entry,
        `${label}.${name}.localPoint[${index}]`
      )))
    });
  }
  return Object.freeze(anchors);
}

// ProjectJointBindings:
// - physics manifestのbody名とModelAsset Nodeへ解決済みのbody IDをJointへ対応付ける
// - 初期descriptorを保存し、ProjectRuntimeのReset・破棄で同じ接続を再利用する
export function readProjectJointDefinitions(manifest, bodyBindings, label = "ProjectRuntime") {
  const source = util.readPlainObject(manifest, `${label} physics manifest`);
  const joints = source.joints ?? [];
  if (!Array.isArray(joints)) throw new Error(`${label} physics.joints must be an array`);
  if (joints.length > 8192) throw new Error(`${label} physics.joints exceeds 8192 entries`);
  if (!Array.isArray(bodyBindings)) throw new Error(`${label} bodyBindings must be an array`);
  const bodies = new Map();
  for (const binding of bodyBindings) {
    const value = util.readPlainObject(binding, `${label} body binding`);
    const bodyId = util.readFiniteNumber(value.bodyId, `${label} body binding.bodyId`, { integer: true, minExclusive: 0 });
    const references = [value.id, value.nodeId].filter(v => v !== undefined).map(String);
    const anchors = readProjectAnchors(
      value.anchors,
      `${label} body binding ${references[0] ?? bodyId} anchors`
    );
    for (const reference of references) {
      if (bodies.has(reference) && bodies.get(reference).bodyId !== bodyId) {
        throw new Error(`${label} duplicate body reference: ${reference}`);
      }
      bodies.set(reference, { bodyId, anchors });
    }
  }
  const definitions = joints.map((raw, index) => {
    const path = `${label} physics.joints[${index}]`;
    const value = util.readPlainObject(raw, path);
    for (const key of Object.keys(value)) {
      if (!["id", "type", "a", "b", "lengthMeters", "collideConnected", "compliance", "positionCorrectionSlop"].includes(key)) {
        throw new Error(`${path}.${key} is not supported`);
      }
    }
    if (value.id === undefined) throw new Error(`${path}.id is required`);
    const id = readStableIdentifier(value.id, `${path}.id`);
    const type = util.readOptionalEnum(value.type, `${path}.type`, "distance", ["distance"]);
    if (type !== "distance") throw new Error(`${path}.type must be distance`);
    const readEndpoint = (side) => {
      const endpointPath = `${path}.${side}`;
      const endpoint = util.readPlainObject(value[side], endpointPath);
      for (const key of Object.keys(endpoint)) {
        if (!["body", "node", "anchor", "localPoint"].includes(key)) throw new Error(`${endpointPath}.${key} is not supported`);
      }
      const reference = endpoint.body ?? endpoint.node;
      if (endpoint.body !== undefined && endpoint.node !== undefined) throw new Error(`${endpointPath} chooses body or node`);
      const name = util.readOptionalString(reference, `${endpointPath}.body`, undefined, { trim: true, allowEmpty: false });
      const body = bodies.get(name);
      if (!body) throw new Error(`${endpointPath}.body references unavailable binding: ${name}`);
      const named = endpoint.anchor !== undefined;
      if (named === (endpoint.localPoint !== undefined)) {
        throw new Error(`${endpointPath} chooses exactly one of anchor or localPoint`);
      }
      let anchorReference;
      let point;
      if (named) {
        anchorReference = util.readOptionalString(endpoint.anchor, `${endpointPath}.anchor`, undefined, {
          trim: true,
          allowEmpty: false
        });
        if (!body.anchors[anchorReference]) {
          throw new Error(`${endpointPath}.anchor references unavailable anchor: ${anchorReference}`);
        }
        point = [...body.anchors[anchorReference].localPoint];
      } else {
        if (!Array.isArray(endpoint.localPoint) || endpoint.localPoint.length !== 3) {
          throw new Error(`${endpointPath}.localPoint must be a vec3`);
        }
        point = endpoint.localPoint.map((entry, component) => util.readFiniteNumber(
          entry,
          `${endpointPath}.localPoint[${component}]`
        ));
      }
      return {
        bodyReference: name,
        bodyId: body.bodyId,
        ...(anchorReference === undefined ? {} : { anchorReference }),
        localPoint: point
      };
    };
    const a = readEndpoint("a");
    const b = readEndpoint("b");
    if (a.bodyId === b.bodyId) throw new Error(`${path} endpoints require distinct bodies`);
    const lengthMeters = util.readFiniteNumber(value.lengthMeters, `${path}.lengthMeters`, { minExclusive: 0 });
    const collideConnected = util.readOptionalBoolean(value.collideConnected, `${path}.collideConnected`, false);
    const compliance = util.readOptionalFiniteNumber(value.compliance, `${path}.compliance`, undefined, { min: 0 });
    const positionCorrectionSlop = util.readOptionalFiniteNumber(
      value.positionCorrectionSlop,
      `${path}.positionCorrectionSlop`,
      undefined,
      { min: 0 }
    );
    return Object.freeze({
      id, type, a: Object.freeze(a), b: Object.freeze(b), lengthMeters, collideConnected,
      descriptor: Object.freeze({ type: "DistanceJoint", bodyAId: a.bodyId, bodyBId: b.bodyId,
        localAnchorA: [...a.localPoint], localAnchorB: [...b.localPoint], distance: lengthMeters,
        collideConnected, ...(compliance === undefined ? {} : { compliance }),
        ...(positionCorrectionSlop === undefined ? {} : { positionCorrectionSlop }) }),
      source: Object.freeze({ label: path })
    });
  });
  const ids = new Set();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`${label} duplicate physics Joint ID: ${definition.id}`);
    ids.add(definition.id);
  }
  const counts = new Map();
  for (const definition of definitions) for (const endpoint of [definition.a, definition.b]) {
    counts.set(endpoint.bodyId, (counts.get(endpoint.bodyId) ?? 0) + 1);
  }
  return Object.freeze({ definitions: Object.freeze(definitions),
    capacity: Object.freeze({ maxJoints: Math.max(1, definitions.length), maxJointsPerBody: Math.max(1, ...counts.values()) }) });
}

// ProjectのJoint登録とResetを一つの寿命管理へまとめる
export default class ProjectJointBindings {
  // 検証済みdescriptorを複製し、作品側のmanifest変更から初期値を分離する
  constructor(definitions = [], label = "ProjectRuntime") {
    this.definitions = Object.freeze(definitions.map(definition => Object.freeze({
      ...definition, descriptor: Object.freeze({ ...definition.descriptor,
        localAnchorA: [...definition.descriptor.localAnchorA], localAnchorB: [...definition.descriptor.localAnchorB] })
    })));
    this.label = label;
    this.ids = new Map();
  }

  // bodyが登録された後にdescriptorをcoreへ渡し、作品の名前と数値IDを保存する
  register(physics) {
    if (!physics || typeof physics.addJoint !== "function") throw new Error(`${this.label} requires physics.addJoint()`);
    if (this.ids.size) throw new Error(`${this.label} project Joints are already registered`);
    try {
      for (const definition of this.definitions) this.ids.set(definition.id, physics.addJoint(definition.descriptor));
    } catch (error) {
      this.clear(physics);
      throw new Error(`${this.label} ${error.message}`, { cause: error });
    }
    return this.getEntries();
  }

  // physics bodyをResetする前にJointを解放し、累積lambdaを新しい世代へ持ち越さない
  clear(physics) {
    if (physics && typeof physics.removeJoint === "function") {
      for (const id of this.ids.values()) physics.removeJoint(id);
    }
    this.ids.clear();
  }

  // physics.reset()後に保存した同じdescriptorを登録し直す
  restore(physics) {
    this.ids.clear();
    return this.register(physics);
  }

  // 利用者向けの名前、core ID、両端bodyを返す
  getEntries() {
    return Object.freeze(this.definitions.map(definition => Object.freeze({
      id: definition.id, jointId: this.ids.get(definition.id), type: definition.type,
      a: {
        body: definition.a.bodyReference,
        bodyId: definition.a.bodyId,
        ...(definition.a.anchorReference === undefined ? {} : { anchor: definition.a.anchorReference }),
        localPoint: [...definition.a.localPoint]
      },
      b: {
        body: definition.b.bodyReference,
        bodyId: definition.b.bodyId,
        ...(definition.b.anchorReference === undefined ? {} : { anchor: definition.b.anchorReference }),
        localPoint: [...definition.b.localPoint]
      },
      lengthMeters: definition.lengthMeters
    })));
  }
}
