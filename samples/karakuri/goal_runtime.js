// ---------------------------------------------
//  goal_runtime.js  2026/09/10
//   Shared contact-to-goal matching for Karakuri Maker and Player
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Compute body IDをSceneYAMLのobject IDまたはemitter IDへ戻します
// 初期bodyはWebgSceneAppのbinding、生成bodyは呼出側のruntimeBodiesから解決します
export function createGoalBodyReferences(sceneApp, runtimeBodies = []) {
  const references = new Map();
  for (const binding of sceneApp?.getDiagnostics?.().physics?.bindings ?? []) {
    references.set(String(binding.bodyId), { kind: "object", id: binding.id ?? binding.nodeId });
  }
  for (const entry of runtimeBodies) {
    references.set(String(entry.bodyId), { kind: "emitter", id: entry.emitterId });
  }
  return references;
}

// 一つのcontactが指定されたtargetとsourceの組み合わせに一致するかを判定します
export function goalContactMatches(goal, references, contact) {
  const first = references.get(String(contact.bodyAId));
  const second = references.get(String(contact.bodyBId));
  const sides = [first, second];
  const targetIndex = sides.findIndex((reference) => reference?.kind === "object" && reference.id === goal.target);
  if (targetIndex < 0) return false;
  const other = sides[1 - targetIndex];
  if (!other) return false;
  return goal.source === null
    || (other.kind === goal.source.kind && other.id === goal.source.id);
}

// 一つのcontactにゴール対象のobjectが含まれるかを調べ、source条件に依存しない板の接触判定へ使います
export function contactIncludesGoalTarget(contact, references, goals) {
  if (!contact || !references || !Array.isArray(goals)) return false;
  const targetIds = new Set(goals.map((goal) => String(goal?.target ?? "")));
  return [contact.bodyAId, contact.bodyBId].some((bodyId) => {
    const reference = references.get(String(bodyId));
    return reference?.kind === "object" && targetIds.has(String(reference.id));
  });
}

// begin contact列から今回到達したゴールだけを返し、once指定の重複通知を抑えます
export function findReachedGoals(goals, references, contacts, reached = new Set()) {
  const result = [];
  for (const goal of goals ?? []) {
    if (goal.once && reached.has(goal.id)) continue;
    if (!contacts?.some((contact) => goalContactMatches(goal, references, contact))) continue;
    reached.add(goal.id);
    result.push(goal);
  }
  return result;
}
