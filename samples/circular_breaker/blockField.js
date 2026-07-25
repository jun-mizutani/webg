// ---------------------------------------------
// samples/circular_breaker/blockField.js  2026/04/10
//   circular_breaker sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Shape from "../../webg/Shape.js";
import Texture from "../../webg/Texture.js";

import {
  BLOCK_RING_RADIUS,
  BLOCK_COUNT
} from "./constants.js";
import { makeBeveledCylinder } from "./shapeFactory.js";

// この file は main.js から createBlockField() として呼ばれ、
// block の texture / prototype / 初期配置をまとめて返す
// さらに gameRuntime.js と stageFlow.js が共有する
// block type ごとの見た目変更 helper もここへ集める

// block 表面用の procedural texture と normal map をまとめて作る
// block prototype の材料を 1 箇所へ寄せ、scene 構築側は shape 配置だけ見ればよい形にする
const createBlockTextures = async (gpu) => {
  const blockTexture = new Texture(gpu);
  await blockTexture.initPromise;
  const blockHeight = blockTexture.makeProceduralHeightMapPixels({
    pattern: "noise",
    width: 96,
    height: 96,
    scale: 168.0,
    seed: 41,
    octaves: 4,
    persistence: 0.55,
    lacunarity: 2.0,
    contrast: 2.1,
    bias: 0.7
  });
  blockTexture.setImage(blockHeight.image, blockHeight.width, blockHeight.height, 4);
  blockTexture.setRepeat();

  const blockNormalTexture = new Texture(gpu);
  await blockNormalTexture.initPromise;
  await blockNormalTexture.buildNormalMapFromHeightMap({
    source: blockHeight.image,
    width: blockHeight.width,
    height: blockHeight.height,
    ncol: 4,
    channel: "luma",
    strength: 2.2,
    wrap: true,
    invertY: false
  });
  blockNormalTexture.setRepeat();

  return {
    blockTexture,
    blockNormalTexture
  };
};

// stageFlow / runtime が参照する block prototype をここで定義する
// 「どの shape を refer しているか」と「標準 material は何か」を file 単位で追えるようにする
const createBlockPrototypes = ({ gpu, blockTexture, blockNormalTexture }) => {
  const sharedMaterial = {
    has_bone: 0,
    texture: blockTexture,
    use_texture: 1,
    normal_texture: blockNormalTexture,
    use_normal_map: 1,
    normal_strength: 0.5
  };

  const blockBase = makeBeveledCylinder(gpu, 2.7, 7.6, 0.55, 24);
  const hardBlockTall = makeBeveledCylinder(gpu, 2.7, 12.8, 0.60, 24);
  const hardBlockShort = makeBeveledCylinder(gpu, 2.7, 6.4, 0.35, 24);

  blockBase.setMaterial("smooth-shader", {
    color: [0.35, 0.82, 1.0, 1.0],
    ...sharedMaterial,
    ambient: 0.32,
    specular: 1.08,
    power: 56.0,
    emissive: 0.01
  });
  hardBlockTall.setMaterial("smooth-shader", {
    color: [1.0, 0.58, 0.24, 1.0],
    ...sharedMaterial,
    ambient: 0.12,
    specular: 1.20,
    power: 62.0,
    emissive: 0.0
  });
  hardBlockShort.setMaterial("smooth-shader", {
    color: [1.0, 0.75, 0.34, 1.0],
    ...sharedMaterial,
    ambient: 0.12,
    specular: 1.20,
    power: 62.0,
    emissive: 0.0
  });

  return {
    blockBase,
    hardBlockTall,
    hardBlockShort
  };
};

const applyTexturedBlockMaterial = (shape) => {
  shape.updateMaterial({
    ambient: 0.12,
    specular: 1.20,
    power: 62.0,
    emissive: 0.0,
    use_texture: 1,
    use_normal_map: 1,
    normal_strength: 0.5
  });
};

const applyFlatBlockMaterial = (shape) => {
  shape.updateMaterial({
    ambient: 0.12,
    specular: 1.20,
    power: 62.0,
    emissive: 0.0,
    use_texture: 0,
    use_normal_map: 0,
    normal_strength: 0.0
  });
};

// block node を ring 上へ並べる
// runtime が使う angle / baseY / hp 情報もここで table 化し、配置定義を 1 file へ寄せる
const createBlockNodes = ({ space, gpu, blockBase, blockTexture, blockNormalTexture }) => {
  const blocks = [];
  const blockBaseY = 3.1;
  for (let i = 0; i < BLOCK_COUNT; i++) {
    const angle = (i / BLOCK_COUNT) * Math.PI * 2.0;
    const node = space.addNode(null, `block_${i}`);
    const shape = new Shape(gpu);
    shape.referShape(blockBase);
    shape.copyShaderParamsFromShape(blockBase);
    const tint = 0.35 + 0.55 * Math.sin(angle * 3.0 + 0.3) ** 2;
    shape.setMaterial("smooth-shader", {
      has_bone: 0,
      color: [0.22 + 0.25 * tint, 0.52 + 0.42 * tint, 0.88 + 0.1 * tint, 1.0],
      texture: blockTexture,
      use_texture: 1,
      normal_texture: blockNormalTexture,
      use_normal_map: 1,
      normal_strength: 0.5,
      ambient: 0.12,
      specular: 1.12,
      power: 58.0,
      emissive: 0.0
    });
    node.addShape(shape);
    node.setPosition(
      Math.cos(angle) * BLOCK_RING_RADIUS,
      blockBaseY,
      Math.sin(angle) * BLOCK_RING_RADIUS
    );
    blocks.push({
      node,
      shape,
      active: true,
      angle,
      glow: 0.0,
      type: "normal",
      hp: 1,
      maxHp: 1,
      baseY: blockBaseY
    });
  }
  return blocks;
};

// stageFlow.js は stage の進行条件だけを持ち、
// block type に応じた見た目切り替えはこの file で追えるようにする
export const applyBlockTypeAppearance = (block, options = {}) => {
  const {
    blockAssets,
    locksOpen = false
  } = options;
  const {
    blockBase,
    hardBlockTall
  } = blockAssets ?? {};
  const shape = block?.shape;
  if (!shape) return;

  if (block.type === "normal") {
    shape.referShape(blockBase);
    shape.updateMaterial({ color: [0.38, 0.80, 1.0, 1.0] });
    applyTexturedBlockMaterial(shape);
    return;
  }

  if (block.type === "hard") {
    shape.referShape(hardBlockTall);
    shape.updateMaterial({ color: [1.0, 0.58, 0.24, 1.0] });
    applyTexturedBlockMaterial(shape);
    return;
  }

  if (block.type === "bomb") {
    shape.referShape(blockBase);
    shape.updateMaterial({ color: [1.0, 0.33, 0.28, 1.0] });
    applyTexturedBlockMaterial(shape);
    return;
  }

  if (block.type === "switch") {
    shape.referShape(blockBase);
    shape.updateMaterial({ color: [0.98, 0.92, 0.26, 1.0] });
    applyTexturedBlockMaterial(shape);
    return;
  }

  if (block.type === "locked") {
    shape.referShape(blockBase);
    shape.updateMaterial({
      color: locksOpen ? [0.66, 0.78, 1.0, 1.0] : [0.56, 0.35, 0.90, 1.0]
    });
    applyTexturedBlockMaterial(shape);
    return;
  }

  if (block.type === "supply") {
    shape.referShape(hardBlockTall);
    shape.updateMaterial({ color: [0.12, 0.70, 0.20, 1.0] });
    applyFlatBlockMaterial(shape);
  }
};

// hard block の 1 発目だけ低い shape へ切り替える
// gameRuntime.js では「耐久が減った」という事実だけを扱い、
// どの shape / color へ変わるかはこの file に寄せる
export const applyHardBlockDamageAppearance = (block, options = {}) => {
  const {
    blockAssets
  } = options;
  const hardBlockShort = blockAssets?.hardBlockShort;
  const shape = block?.shape;
  if (!shape || !hardBlockShort) return;
  shape.referShape(hardBlockShort);
  shape.updateMaterial({ color: [1.0, 0.75, 0.34, 1.0] });
  applyTexturedBlockMaterial(shape);
  if (typeof block.baseY === "number") {
    const pos = block.node.getPosition();
    block.node.setPosition(pos[0], block.baseY - 3.2, pos[2]);
  }
};

const chooseBlockTypeForStage = (index, level, supplyIndex) => {
  if (index === supplyIndex) return "supply";
  if (((index + level) % 11) === 0) return "bomb";
  if (((index + level * 2) % 7) === 0) return "switch";
  if (((index + level * 3) % 5) === 0) return "locked";
  if (((index + level) % 3) === 0) return "hard";
  return "normal";
};

// stage 開始時の block table 初期化をまとめる
// 配置復元、type 割り当て、hp 設定、見た目反映を 1 箇所で追えるようにする
export const resetBlocksForStage = ({
  blocks,
  level,
  blockAssets
} = {}) => {
  let hasLocked = false;
  let hasSwitch = false;
  const supplyIndex = (level * 5 + 1) % blocks.length;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    block.active = true;
    block.glow = 0.0;
    block.node.hide(false);
    if (typeof block.baseY === "number") {
      const pos = block.node.getPosition();
      block.node.setPosition(pos[0], block.baseY, pos[2]);
    }

    const type = chooseBlockTypeForStage(i, level, supplyIndex);
    block.type = type;
    block.maxHp = type === "hard" ? 2 : 1;
    block.hp = block.maxHp;
    if (type === "locked") hasLocked = true;
    if (type === "switch") hasSwitch = true;
  }

  if (hasLocked && !hasSwitch) {
    const switchIndex = (level * 3) % blocks.length;
    blocks[switchIndex].type = "switch";
    blocks[switchIndex].maxHp = 1;
    blocks[switchIndex].hp = 1;
  }

  const locksOpen = !hasLocked;
  for (let i = 0; i < blocks.length; i++) {
    applyBlockTypeAppearance(blocks[i], {
      blockAssets,
      locksOpen
    });
  }
  return locksOpen;
};

export const countAliveBlocks = (blocks = []) => {
  let alive = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].active) alive++;
  }
  return alive;
};

// runtime が使う block prototype と配置済み node 群をまとめて返す
// start() 側は builder を await して受け取るだけにし、texture / prototype / placement の分散を減らす
export const createBlockField = async ({ space, gpu }) => {
  const {
    blockTexture,
    blockNormalTexture
  } = await createBlockTextures(gpu);
  const {
    blockBase,
    hardBlockTall,
    hardBlockShort
  } = createBlockPrototypes({
    gpu,
    blockTexture,
    blockNormalTexture
  });
  const blocks = createBlockNodes({
    space,
    gpu,
    blockBase,
    blockTexture,
    blockNormalTexture
  });
  const blockAssets = {
    blockBase,
    hardBlockTall,
    hardBlockShort
  };
  return {
    blocks,
    blockAssets
  };
};

export default createBlockField;
