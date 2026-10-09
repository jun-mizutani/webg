import { uniqueObjectId } from "./editor_state.js";
import { DEFAULT_DOMINO_MASS, DEFAULT_DOMINO_SIZE } from "./karakuri_physics_defaults.js";

const DOMINO_PALETTE = Object.freeze([
  { id: "domino-red", color: [0.94, 0.20, 0.20, 1] },
  { id: "domino-orange", color: [1.00, 0.46, 0.08, 1] },
  { id: "domino-yellow", color: [0.95, 0.82, 0.12, 1] },
  { id: "domino-green", color: [0.16, 0.72, 0.35, 1] },
  { id: "domino-blue", color: [0.14, 0.45, 0.92, 1] },
  { id: "domino-purple", color: [0.65, 0.25, 0.85, 1] }
]);

// ドミノ列で使う6色の材質をmanifestへ登録し、各ドミノから参照できるIDを返します
function ensureDominoPaletteMaterials(manifest) {
  if (!Array.isArray(manifest.materials)) throw new Error("Karakuri domino placement requires a material array");
  for (const palette of DOMINO_PALETTE) {
    if (manifest.materials.some((material) => material?.id === palette.id)) continue;
    manifest.materials.push({
      id: palette.id,
      color: [...palette.color],
      metallic: 0.05,
      roughness: 0.32,
      specular: 0.62
    });
  }
  return DOMINO_PALETTE.map(({ id }) => id);
}

// 6枚を一回の編集として追加します。薄いX方向へ倒れ、次の板へ届く間隔です。
export function addDominoRow(manifest, position, bounds) {
  const size = DEFAULT_DOMINO_SIZE, spacing = 0.3, count = 6;
  const startX = Math.max(bounds.min[0] + size[0]/2,
    Math.min(bounds.max[0] - size[0]/2 - spacing*(count-1), position[0] - spacing*(count-1)/2));
  const y = Math.max(bounds.min[1] + size[1]/2, Math.min(bounds.max[1] - size[1]/2, position[1]));
  const materialIds = ensureDominoPaletteMaterials(manifest);
  const first = manifest.objects.length;
  for (let i = 0; i < count; i++) {
    manifest.objects.push({
      id: uniqueObjectId(manifest, "domino"),
      shape: { type: "box", size: [...size] },
      transform: { position: [startX + i*spacing, y, position[2]] },
      material: materialIds[i % materialIds.length],
      physics: { bodyType: "dynamic", mass: DEFAULT_DOMINO_MASS, material: { friction: 0.55, restitution: 0.05 } }
    });
  }
  // 編集のたびにbody数を再検証するため、追加分の容量も同時に確保します。
  if (manifest.physics?.space) {
    const capacity = manifest.objects.filter(o => o.physics).length
      + (manifest.emitters ?? []).reduce((n, e) => n + e.maxActive, 0);
    manifest.physics.space.maxBodies = Math.max(manifest.physics.space.maxBodies ?? 200, capacity);
  }
  return first;
}
