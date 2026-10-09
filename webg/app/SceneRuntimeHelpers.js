// ---------------------------------------------
//  SceneRuntimeHelpers.js  2026/09/08
//   Prototype helpers for validating Scene JSON runtime transforms
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// SceneLoaderが作った各primitive assetのrootを検査し、placementNodeをワールド姿勢の唯一の入力にします
// asset側のrootを恒等変換へ揃え、表示とphysics colliderが同じ座標基準を使う状態を検証します
export function alignPrimitiveRoots(runtime, label = "SceneRuntime") {
  if (!Array.isArray(runtime?.entries)) {
    throw new Error(`${label} scene runtime entries are unavailable`);
  }
  for (const entry of runtime.entries) {
    const assetData = entry.asset?.getData?.();
    const rootDefinitions = (assetData?.nodes ?? []).filter((node) => node.parent === null);
    if (rootDefinitions.length !== 1) {
      throw new Error(`${label} scene entry "${entry.id}" requires one primitive root`);
    }
    const rootDefinition = rootDefinitions[0];
    const transform = rootDefinition.transform;
    const identity = transform?.translation?.every((value) => value === 0) === true
      && transform?.rotation?.every((value, index) => value === [0, 0, 0, 1][index]) === true
      && transform?.scale?.every((value) => value === 1) === true;
    if (!identity) {
      throw new Error(`${label} scene entry "${entry.id}" requires an identity asset root`);
    }
    const rootNode = entry.nodeMap?.get(rootDefinition.id);
    if (!rootNode || rootNode.parent !== entry.placementNode) {
      throw new Error(`${label} scene entry "${entry.id}" root is not attached to placementNode`);
    }
    rootNode.setPosition(0.0, 0.0, 0.0);
    rootNode.setAttitude(0.0, 0.0, 0.0);
    rootNode.setScale(1.0);
  }
  return runtime;
}
