// ---------------------------------------------
//  emitter_visual.js  2026/09/11
//   Visible, non-physical emitter parts for Karakuri Maker and Player
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import { readPrimitiveMaterialManifest } from "../../webg/app/PrimitiveScene.js";

const DEFAULT_MATERIAL = {
  color: [0.68, 0.70, 0.72, 1.0],
  metallic: 1.0,
  roughness: 0.10,
  specular: 1.0
};

// SceneYAMLのlauncher材質を使い、旧シーンでも球と同じアルミ色へそろえます
function readEmitterMaterial(manifest) {
  const definitions = readPrimitiveMaterialManifest(manifest?.materials ?? []);
  const definition = definitions.get("launcher");
  return {
    id: definition?.id ?? "launcher",
    params: structuredClone(definition?.params ?? DEFAULT_MATERIAL)
  };
}

// 初速度のXZ方向を表示用ノズルの向きへ変換し、速度が0なら右向きを使います
function emitterYaw(emitter) {
  const velocity = emitter?.initialVelocity ?? [];
  const x = Number(velocity[0]) || 0.0;
  const z = Number(velocity[2]) || 0.0;
  return Math.hypot(x, z) > 1e-8 ? Math.atan2(z, x) * 180.0 / Math.PI : 0.0;
}

// カプセル型のノズルを作り、物理bodyを持たない発射台の表示Nodeへ登録します
function addEmitterNozzle(app, parent, name, position, material) {
  const node = app.app.space.addNode(parent, name);
  node.setPosition(...position);
  // Primitive.capsuleの長軸はlocal Yなので、local +Yを発射方向のlocal +Xへ向けます
  node.setAttitude(0.0, 0.0, -90.0);
  const shape = new Shape(app.app.getGPU());
  shape.applyPrimitiveAsset(Primitive.capsule(0.16, 0.30, 12, 24, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial(material.id, material.params);
  node.addShape(shape);
  return { node, shape };
}

// 発射位置を先端に合わせ、発射方向を示すカプセル型ノズルだけを組み立てます
export function createKarakuriEmitterVisual(app, manifest, emitter) {
  if (!app?.app?.space || !emitter?.id) throw new Error("Karakuri emitter visual requires an app and emitter");
  const material = readEmitterMaterial(manifest);
  const root = app.app.space.addNode(null, `${emitter.id}-visual`);
  root.setPosition(...(emitter.spawnPosition ?? [0.0, 0.0, 0.0]));
  root.setAttitude(emitterYaw(emitter), 0.0, 0.0);
  const nozzle = addEmitterNozzle(app, root, `${emitter.id}-nozzle`, [-0.31, 0.0, 0.0], material);
  const pickEntries = [nozzle].map((part) => ({
    id: emitter.id,
    karakuriEmitterId: emitter.id,
    node: part.node
  }));
  app.app.requestRender?.();
  return { app, emitterId: emitter.id, root, parts: [nozzle], pickEntries };
}

// Makerで発射台を移動・編集したとき、表示Nodeの位置と向きをSceneYAMLへ追従させます
export function syncKarakuriEmitterVisual(visual, emitter) {
  if (!visual?.root || !emitter) return false;
  visual.root.setPosition(...(emitter.spawnPosition ?? [0.0, 0.0, 0.0]));
  visual.root.setAttitude(emitterYaw(emitter), 0.0, 0.0);
  visual.app?.app?.requestRender?.();
  return true;
}
