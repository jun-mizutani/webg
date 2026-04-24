// -------------------------------------------------
// tile_sim sample
//   terrain.js    2026/04/24
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import Texture from "../../webg/Texture.js";
import {
  TERRAIN_TEXTURE_SIZE,
  HEIGHT_RANDOM_SEED,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_TERRAIN_HEIGHT,
  MAP_WIDTH as SCENE_MAP_WIDTH,
  MAP_HEIGHT as SCENE_MAP_HEIGHT,
  CELL_SIZE,
  CELL_GAP,
  FLOOR_Y,
  BASE_TOP_Y,
  HEIGHT_STEP_Y
} from "./constants.js";

// この module は、tile_sim の terrain と Scene JSON 構築を受け持つ
// - procedural texture 生成、height map 生成、tile 定義変換、scene 完成までをここへ集める
// - main.js から terrain の細部を外し、sample の起動フローを読みやすく保つ

// tile_sim sample が使う terrain texture 生成設定
// - sample 実行時の texture 見え方はこの定数を正とし、main.js 側へ同じ数値を重複させない
// - createTerrainTexturePair() は必要なときだけ、この既定値へ個別 override を上書きする
export const TILE_SIM_TERRAIN_TEXTURE_OPTIONS = {
  scale: 9.0,
  seed: 17,
  contrast: 1.95,
  bias: 0.0,
  colorLift: 0.22,
  invert: false,
  octaves: 5,
  persistence: 0.56,
  lacunarity: 2.2,
  normalStrength: 4.0,
  invertY: false
};

// procedural texture の RGB にだけ加算オフセットを入れて、黒が沈みすぎないようにする
// - normal map は元の height map から作りたいため、color texture 用に別配列を作る
// - amount は 0..1 を想定し、0.16 なら各 RGB へ約 41 を加算する
const liftTextureColor = (image, amount = 0.0) => {
  const lift = Math.max(0.0, Math.min(1.0, Number(amount) || 0.0));
  if (lift <= 0.0) {
    return image;
  }
  const offset = Math.round(lift * 255);
  const lifted = new Uint8Array(image.length);
  for (let i = 0; i < image.length; i += 4) {
    lifted[i] = Math.min(255, image[i] + offset);
    lifted[i + 1] = Math.min(255, image[i + 1] + offset);
    lifted[i + 2] = Math.min(255, image[i + 2] + offset);
    lifted[i + 3] = image[i + 3];
  }
  return lifted;
};

// height 値を terrain 名へ変換する
// - TileMap の tile 定義は数値 height を持つが、material 設定は terrain 名で切り替える
// - この sample では water / grass / mesa / snow の 4 段に寄せて見た目を分ける
export const terrainFromHeight = (height) => {
  if (height <= 0) return "water";
  if (height <= 2) return "grass";
  if (height <= 4) return "mesa";
  return "snow";
};

// terrain 用の texture と normal map を 1 組生成する
// - TileMap 側は Texture object をそのまま受け取れるため、ここで terrain 共通の素材を作っておく
// - 通常は procedural texture を使い、切り分け時は num256.png を固定画像として読む
export const createTerrainTexturePair = async (gpu, options = {}) => {
  const colorTex = new Texture(gpu);
  await colorTex.initPromise;
  const normalTex = new Texture(gpu);
  await normalTex.initPromise;
  const resolvedOptions = {
    ...TILE_SIM_TERRAIN_TEXTURE_OPTIONS,
    ...(options ?? {})
  };

  const procOptions = {
    pattern: "noise",
    width: TERRAIN_TEXTURE_SIZE,
    height: TERRAIN_TEXTURE_SIZE,
    scale: Number.isFinite(resolvedOptions.scale) ? Number(resolvedOptions.scale) : TILE_SIM_TERRAIN_TEXTURE_OPTIONS.scale,
    seed: Number.isFinite(resolvedOptions.seed) ? Number(resolvedOptions.seed) : TILE_SIM_TERRAIN_TEXTURE_OPTIONS.seed,
    contrast: Number.isFinite(resolvedOptions.contrast) ? Number(resolvedOptions.contrast) : TILE_SIM_TERRAIN_TEXTURE_OPTIONS.contrast,
    bias: Number.isFinite(resolvedOptions.bias) ? Number(resolvedOptions.bias) : TILE_SIM_TERRAIN_TEXTURE_OPTIONS.bias,
    invert: !!resolvedOptions.invert,
    octaves: Number.isFinite(resolvedOptions.octaves) ? Number(resolvedOptions.octaves) : TILE_SIM_TERRAIN_TEXTURE_OPTIONS.octaves,
    persistence: Number.isFinite(resolvedOptions.persistence) ? Number(resolvedOptions.persistence) : TILE_SIM_TERRAIN_TEXTURE_OPTIONS.persistence,
    lacunarity: Number.isFinite(resolvedOptions.lacunarity) ? Number(resolvedOptions.lacunarity) : TILE_SIM_TERRAIN_TEXTURE_OPTIONS.lacunarity
  };

  const heightMap = colorTex.makeProceduralHeightMapPixels(procOptions);
  const colorImage = liftTextureColor(heightMap.image, resolvedOptions.colorLift);
  colorTex.setImage(colorImage, heightMap.width, heightMap.height, heightMap.ncol);
  colorTex.setRepeat();

  await normalTex.buildNormalMapFromHeightMap({
    source: heightMap.image,
    width: heightMap.width,
    height: heightMap.height,
    ncol: 4,
    channel: "luma",
    strength: Number.isFinite(resolvedOptions.normalStrength)
      ? Number(resolvedOptions.normalStrength)
      : TILE_SIM_TERRAIN_TEXTURE_OPTIONS.normalStrength,
    wrap: true,
    invertY: !!resolvedOptions.invertY
  });
  normalTex.setRepeat();

  return {
    texture: colorTex,
    normalTexture: normalTex
  };
};

// terrainMaterials へ渡す material 設定を terrain ごとに組み立てる
// - sample 側で texture / normal map / 色の基準をまとめ、Scene JSON には完成形を渡す
// - terrain 名さえ決まれば TileMap.build() がそのまま見た目へ反映できる
export const buildTerrainMaterials = (terrainTextures) => {
  const shared = {
    materialId: "smooth-shader",
    texture: terrainTextures.texture,
    normal_texture: terrainTextures.normalTexture,
    use_texture: 1,
    use_normal_map: 1,
    has_bone: 0,
    ambient: 0.30,
    specular: 0.58,
    power: 42.0,
    normal_strength: 1.9
  };

  return {
    default: {
      ...shared,
      baseColor: [0.68, 0.70, 0.92, 1.0]
    },
    water: {
      ...shared,
      baseColor: [0.25, 0.54, 0.96, 1.0],
      normal_strength: 1.35
    },
    grass: {
      ...shared,
      baseColor: [0.34, 0.72, 0.34, 1.0],
      normal_strength: 1.55
    },
    mesa: {
      ...shared,
      baseColor: [0.96, 0.66, 0.30, 1.0],
      normal_strength: 2.0
    },
    snow: {
      ...shared,
      baseColor: [0.96, 0.97, 0.99, 1.0],
      normal_strength: 2.35
    }
  };
};

// sample 用の height map を乱数から組み立てる
// - mission に使える凹凸を安定して得られるよう、TileMap sample 用の盤面条件をここでそろえる
// - 1 回だけ平滑化し、さらに detail noise を混ぜて平坦すぎない地形へ寄せる
export const buildHeightMap = () => {
  // row / col から再現可能な疑似乱数を返す
  // - 毎回同じ盤面を得て、sample の比較や説明がぶれないように seed 固定で使う
  const hashNoise = (row, col, seed = HEIGHT_RANDOM_SEED) => {
    let h = seed;
    h ^= Math.imul(row + 1, 374761393);
    h ^= Math.imul(col + 1, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };

  const baseValues = Array.from({ length: MAP_HEIGHT }, (_, row) => {
    return Array.from({ length: MAP_WIDTH }, (_, col) => hashNoise(row, col));
  });

  const detailValues = Array.from({ length: MAP_HEIGHT }, (_, row) => {
    return Array.from({ length: MAP_WIDTH }, (_, col) => {
      return hashNoise(row * 2 + 5, col * 2 + 11, HEIGHT_RANDOM_SEED + 53);
    });
  });

  let values = baseValues.map((row) => [...row]);

  for (let pass = 0; pass < 1; pass++) {
    const next = Array.from({ length: MAP_HEIGHT }, (_, row) => {
      return Array.from({ length: MAP_WIDTH }, (_, col) => {
        let sum = 0.0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const rr = row + dy;
            const cc = col + dx;
            if (rr < 0 || rr >= MAP_HEIGHT || cc < 0 || cc >= MAP_WIDTH) {
              continue;
            }
            sum += values[rr][cc];
            count += 1;
          }
        }
        return count > 0 ? sum / count : values[row][col];
      });
    });
    values = next;
  }

  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (let row = 0; row < values.length; row++) {
    for (let col = 0; col < values[row].length; col++) {
      const mixed = values[row][col] * 0.62 + baseValues[row][col] * 0.20 + detailValues[row][col] * 0.18;
      minValue = Math.min(minValue, mixed);
      maxValue = Math.max(maxValue, mixed);
    }
  }

  const range = Math.max(0.0001, maxValue - minValue);
  return values.map((row, rowIndex) => {
    return row.map((value, col) => {
      const mixed = value * 0.62 + baseValues[rowIndex][col] * 0.20 + detailValues[rowIndex][col] * 0.18;
      const normalized = (mixed - minValue) / range;
      const lifted = Math.pow(Math.max(0.0, Math.min(1.0, normalized)), 1.35);
      const mountainPush = Math.pow(Math.max(0.0, lifted - 0.66) / 0.34, 1.05) * 0.06;
      const peakPush = Math.pow(Math.max(0.0, detailValues[rowIndex][col] - 0.80) / 0.20, 1.25) * 0.03;
      const boosted = Math.max(0.0, Math.min(1.0, lifted + mountainPush + peakPush - 0.13));
      return Math.max(0, Math.min(MAX_TERRAIN_HEIGHT, Math.floor(boosted * (MAX_TERRAIN_HEIGHT + 1))));
    });
  });
};

// height map を Scene JSON 用の tile 配列へ変換する
// - TileMap は full grid の tile 定義を読むため、ここで x / y / height / terrain を埋める
export const buildTileDefinitions = (heights) => {
  const tiles = [];
  for (let row = 0; row < heights.length; row++) {
    for (let col = 0; col < heights[row].length; col++) {
      const height = heights[row][col];
      tiles.push({
        x: col,
        y: row,
        height,
        terrain: terrainFromHeight(height)
      });
    }
  }
  return tiles;
};

// tile_sim sample 用の Scene JSON を組み立てる
// - Terrain material は async 生成後に差し込むため、引数で受けて完成形の scene を返す
// - main.js 側ではこの戻り値を SceneAsset.fromData() へそのまま流し込む
export const createSceneDefinition = (terrainMaterials = null) => {
  const heightMap = buildHeightMap();
  const tileDefinitions = buildTileDefinitions(heightMap);

  return {
    version: "1.0",
    type: "webg-scene",
    meta: {
      name: "tile_sim",
      generator: "samples/tile_sim"
    },
    camera: {
      target: [SCENE_MAP_WIDTH * CELL_SIZE * 0.5, 0.0, SCENE_MAP_HEIGHT * CELL_SIZE * 0.5],
      distance: 18.7,
      head: 28.0,
      pitch: -30.0,
      bank: 0.0,
      viewAngle: 42.0,
      near: 0.1,
      far: 1000.0
    },
    tileMap: {
      name: "tilegame-sample",
      width: SCENE_MAP_WIDTH,
      height: SCENE_MAP_HEIGHT,
      cellSize: CELL_SIZE,
      cellGap: CELL_GAP,
      floorY: FLOOR_Y,
      baseTopY: BASE_TOP_Y,
      heightStepY: HEIGHT_STEP_Y,
      // tile_game 側は既定の flat を保ち、
      // tile_sim 側では shared vertex の smooth cap を試せるようにする
      surfaceShading: "smooth",
      displayArea: {
        x: 2,
        y: 2,
        width: 4,
        height: 4
      },
      terrainMaterials,
      tiles: tileDefinitions
    }
  };
};
