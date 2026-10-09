// ---------------------------------------------
// scene.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 地形データからSceneDefinitionの初期配置・PBR・粒子を生成する

import { tiles, world } from "./rules.mjs";

// SceneYAMLと同じ構造のmanifest objectを返す。ルールと地形座標を共有して生成する
export function createManifest() {
  const materials = [
    { id: "stone", color: [0.21, 0.3, 0.32, 1], roughness: 0.85, metallic: 0.05 },
    { id: "grass", color: [0.09, 0.3, 0.25, 1], roughness: 0.9, metallic: 0 },
    { id: "grass2", color: [0.14, 0.36, 0.3, 1], roughness: 0.88, metallic: 0 },
    { id: "path", color: [0.34, 0.38, 0.32, 1], roughness: 0.82, metallic: 0.03 },
    { id: "ruin", color: [0.36, 0.4, 0.35, 1], roughness: 0.8, metallic: 0.08 },
    { id: "gold", color: [0.8, 0.57, 0.24, 1], roughness: 0.27, metallic: 0.85 },
    {
      id: "crystal", color: [0.15, 0.65, 0.52, 1], roughness: 0.2, metallic: 0.3,
      emissiveFactor: [0.2, 1.4, 0.8]
    },
    { id: "base", color: [0.07, 0.12, 0.14, 1], roughness: 0.65, metallic: 0.25 }
  ];
  const objects = [];

  // 共通の宣言を文字列として組み立て、GPU資源の作成は呼出側へ委ねる
  const box = (id, position, size, material) => {
    objects.push({ id, shape: { type: "box", size }, transform: { position }, material });
  };

  box("island", [0, -1.25, 0], [16.7, 0.8, 16.7], "base");
  for (const tile of tiles) {
    const [x, y, z] = world(tile);
    const depth = y + 1;
    const top = tile.x >= 3 && tile.x <= 5
      ? "path" : (tile.x + tile.z) % 3 ? "grass" : "grass2";

    // 柱の底をそろえ、上面だけを段数に合わせて高くする
    box(`tile-${tile.x}-${tile.z}`, [x, y - depth / 2, z], [1.77, depth, 1.77], "stone");
    box(`cap-${tile.x}-${tile.z}`, [x, y + 0.03, z], [1.72, 0.06, 1.72], top);

    if (tile.blocked && tile.x > 0 && tile.x < 8) {
      box(`ruin-${tile.x}-${tile.z}`, [x, y + 0.8, z], [0.8, 1.6, 0.8], "ruin");
      box(`ruin-cap-${tile.x}-${tile.z}`, [x, y + 1.65, z], [1.05, 0.16, 1.05], "ruin");
      box(`ruin-band-${tile.x}-${tile.z}`, [x, y + 0.4, z], [0.88, 0.12, 0.88], "gold");
    }

    // 境界の小石を装飾として置き、マス中央の通行空間を確保する
    if ((tile.x === 0 || tile.x === 8) && !tile.blocked) {
      box(`rock-${tile.x}-${tile.z}`,
        [x + (tile.x === 0 ? -0.58 : 0.58), y + 0.15, z - 0.55], [0.35, 0.3, 0.45], "ruin");
    }
  }

  for (const x of [-5.4, 5.4]) {
    box(`altar-${x}`, [x, 1.9, -7.2], [1.05, 0.4, 1.05], "ruin");
    box(`crystal-${x}`, [x, 2.55, -7.2], [0.32, 1, 0.32], "crystal");
    box(`cross-${x}`, [x, 2.45, -7.2], [0.72, 0.16, 0.2], "gold");
  }

  return {
    format: "webg-scene",
    version: 1,
    name: "Starfall Keep",
    materials,
    objects,

    // 同時保持する枠を固定し、行動ごとの発生位置はmain.jsから渡す
    particleEmitters: [
      {
        id: "steps", preset: "spark", capacity: 512, seed: 71, overflow: "replace-oldest",
        simulation: { gravity: [0, -2, 0], drag: 2 },
        appearance: {
          colors: [[0.18, 0.8, 0.6], [0.65, 0.9, 0.45]],
          size: [0.025, 0.065], intensity: 1.5
        }
      },
      {
        id: "magic", preset: "light", capacity: 1024, seed: 72, overflow: "replace-oldest",
        simulation: { gravity: [0, 0.2, 0], drag: 1.4 },
        appearance: {
          colors: [[0.1, 0.65, 1], [0.45, 1, 0.8]],
          size: [0.035, 0.1], intensity: 4
        }
      },
      {
        id: "hit", preset: "spark", capacity: 1024, seed: 73, overflow: "replace-oldest",
        simulation: { gravity: [0, -4, 0], drag: 1 },
        appearance: {
          colors: [[1, 0.4, 0.08], [1, 0.85, 0.3]],
          size: [0.035, 0.085], intensity: 4
        }
      },
      {
        id: "ambient", preset: "light", capacity: 128, seed: 74, overflow: "replace-oldest",
        simulation: { gravity: [0, 0.15, 0], drag: 0.35 },
        appearance: {
          colors: [[0.15, 0.65, 0.85], [0.4, 0.85, 0.8]],
          size: [0.02, 0.05], intensity: 1.2
        },
        emission: {
          rate: 14, position: [0, 1.5, -2], direction: [0, 1, 0],
          spreadAngle: 160, speed: [0.3, 1], lifetime: [4, 7]
        }
      }
    ],

    // PBRの標準profileを使う。環境光がある場合のlighting.ambientは0にする
    renderer: {
      profile: "studio",
      width: 960,
      height: 720,
      // 青緑の水中光。鉛直方向光へ集光を接続し、環境光で影の部隊も読めるようにする
      clearColor: [0.025, 0.1, 0.15, 1],
      environment: { preset: "blue-sky", resolution: { width: 128, height: 64 } },
      dof: { enabled: false },
      pipeline: {
        shadow: { pcfRadius: 1, directional: { up: [0, 0, 1] } },
        lighting: { ambient: 0, directionalColor: [0.55, 0.88, 1],
          directionalIntensity: 4, environmentIntensity: 0.65 },
        toneMap: { exposure: 1.8 }
      }
    }
  };
}
