// ---------------------------------------------
// JointDefinition.js     2026/09/08
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// JointDefinition:
// - 部品の接続点と Scene の距離接続を GPU 生成前に検証する
// - 名前参照を body local 座標へ解決し、編集元と容量を保持する
export function validateAnchors(value = {}, check) {
  check.keys(value, Object.keys(value ?? {}));
  const anchors = {};
  for (const [name, anchor] of Object.entries(value)) {
    check.id(name, `/${name}`);
    if (!anchor || Object.getPrototypeOf(anchor) !== Object.prototype) check.fail("anchor object required", `/${name}`);
    for (const key of Object.keys(anchor)) {
      if (key !== "localPoint") check.fail("anchor uses localPoint", `/${name}/${key}`);
    }
    check.vector(anchor.localPoint, `/${name}/localPoint`);
    anchors[name] = { localPoint: [...anchor.localPoint] };
  }
  return anchors;
}

// 全物体の確定後に両端を解決し、接続数から Compute buffer の容量を求める
export function validateJoints(value = [], objects, source, checker) {
  const root = checker(source, "/joints");
  if (!Array.isArray(value)) root.fail("array required");
  if (value.length > 8192) root.fail("at most 8192 joints supported");
  const byId = new Map(objects.map(object => [object.id, object]));
  const ids = new Set();
  const counts = new Map();
  const joints = value.map((raw, index) => {
    const pointer = `/joints/${index}`;
    const check = checker(source, pointer);
    check.keys(raw, ["id", "type", "mode", "response", "a", "b", "lengthMeters", "collideConnected"]);
    check.id(raw.id, "/id");
    if (ids.has(raw.id)) check.fail(`duplicate Joint ID ${raw.id}`, "/id");
    ids.add(raw.id);
    check.enum(raw.type, ["distance"], "/type");
    check.enum(raw.mode === undefined ? "fixed" : raw.mode, ["fixed"], "/mode");
    check.enum(raw.response === undefined ? "hard" : raw.response, ["hard"], "/response");
    check.number(raw.lengthMeters, 0, Infinity, "/lengthMeters", true);
    const collideConnected = raw.collideConnected === undefined ? false : raw.collideConnected;
    if (typeof collideConnected !== "boolean") check.fail("boolean required", "/collideConnected");
    const endpoint = (side) => {
      const end = raw[side];
      const ec = checker(source, `${pointer}/${side}`);
      ec.keys(end, ["object", "anchor", "localPoint"]);
      ec.id(end.object, "/object");
      const object = byId.get(end.object);
      if (!object) ec.fail(`unknown object ${end.object}`, "/object");
      if (!object.physics) ec.fail("Joint endpoint requires a physics body", "/object");
      const named = Object.hasOwn(end, "anchor");
      if (named === Object.hasOwn(end, "localPoint")) ec.fail("choose exactly one of anchor or localPoint");
      let point;
      if (named) {
        ec.id(end.anchor, "/anchor");
        if (!Object.hasOwn(object.anchors, end.anchor)) ec.fail(`unknown anchor ${end.anchor}`, "/anchor");
        point = object.anchors[end.anchor].localPoint;
      } else {
        ec.vector(end.localPoint, "/localPoint");
        point = end.localPoint;
      }
      counts.set(object.id, (counts.get(object.id) ?? 0) + 1);
      return { object: object.id, ...(named ? { anchor: end.anchor } : {}), localPoint: [...point] };
    };
    const a = endpoint("a"), b = endpoint("b");
    if (a.object === b.object) check.fail("Joint endpoints require distinct bodies", "/b/object");
    if (![a, b].some(end => byId.get(end.object).physics.bodyType === "dynamic")) {
      check.fail("distance Joint requires a dynamic endpoint");
    }
    return { id: raw.id, type: "distance", mode: "fixed", response: "hard", a, b,
      lengthMeters: raw.lengthMeters, collideConnected, source: { source, pointer } };
  });
  return { joints, jointCapacity: { maxJoints: Math.max(1, joints.length),
    maxJointsPerBody: Math.max(1, ...counts.values()) } };
}
