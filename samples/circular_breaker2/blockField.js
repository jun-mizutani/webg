// samples/circular_breaker2/blockField.js 2026/09/20
// ModelYAMLの形状へ、SF外装のパネル模様・浅い溝・発光ランプを接続する
import Texture from "../../webg/Texture.js";
import { BLOCK_COUNT, BLOCK_RING_RADIUS } from "./constants.js";
import { createPanelPixels } from "./panelTexture.js";


// block 表面用の procedural texture と normal map をまとめて作る
// block prototype の材料を 1 箇所へ寄せ、scene 構築側は shape 配置だけ見ればよい形にする
const createBlockTextures = async (gpu) => {
  const blockTexture = new Texture(gpu);
  await blockTexture.initPromise;
  const pixels = createPanelPixels();
  const { width, height } = pixels;
  blockTexture.setImage(pixels.color, width, height, 4);
  blockTexture.setRepeat();

  const blockNormalTexture = new Texture(gpu);
  await blockNormalTexture.initPromise;
  await blockNormalTexture.buildNormalMapFromHeightMap({
    source: pixels.relief,
    width,
    height,
    ncol: 4,
    channel: "luma",
    strength: .35,
    wrap: true,
    invertY: false
  });
  blockNormalTexture.setRepeat();
  const blockEmissiveTexture = new Texture(gpu);
  await blockEmissiveTexture.initPromise;
  blockEmissiveTexture.setImage(pixels.emission, width, height, 4);
  blockEmissiveTexture.setRepeat();

  return {
    blockTexture,
    blockNormalTexture,
    blockEmissiveTexture
  };
};


// Nodeを確認し、形状不足を初期化時のエラーとして通知する
const shapeAt = (model, id) => {
  const entry = model.getEntry(id);
  if (entry.shapes.length !== 1) throw new Error(`expected one shape: ${id}`);
  return entry.shapes[0];
};

// YAMLで読み込んだ28個の配置と交換用形状をゲーム処理へ渡す
export const createBlockField = async ({ model, gpu }) => {
  const { blockTexture, blockNormalTexture, blockEmissiveTexture } = await createBlockTextures(gpu);
  const blockAssets = {
    blockBase: shapeAt(model, "prototype-base"),
    hardBlockTall: shapeAt(model, "prototype-tall"),
    hardBlockShort: shapeAt(model, "prototype-short")
  };
  for (const type of ["base", "tall", "short"]) model.getNode(`prototype-${type}`).hide(true);
  // 外周の48本のポールにも同じ模様を使い、金属面と帯の境目を共有する
  for (let i = 0; i < 48; i++) {
    shapeAt(model, `wall-${i}`).updateMaterial({
      texture: blockTexture, normal_texture: blockNormalTexture,
      emissive_texture: blockEmissiveTexture, use_emissive_texture: 1,
      emissive_factor: i % 6 === 0 ? [5.2, 1, .12] : [.05, 3.4, 5.6],
      use_texture: 1, use_normal_map: 1, normal_strength: .18
    });
  }
  const blocks = [];
  for (let i = 0; i < BLOCK_COUNT; i++) {
    const id = `block-${String(i).padStart(2, "0")}`;
    const variants = {
      base: { node: model.getNode(id), shape: shapeAt(model, id) },
      tall: { node: model.getNode(`${id}-tall`), shape: shapeAt(model, `${id}-tall`) },
      short: { node: model.getNode(`${id}-short`), shape: shapeAt(model, `${id}-short`) }
    };
    const node = variants.base.node;
    const shape = variants.base.shape;
    const angle = i / BLOCK_COUNT * Math.PI * 2;
    const position = node.getPosition();
    if (Math.abs(position[0] - Math.cos(angle) * BLOCK_RING_RADIUS) > 1e-3
      || Math.abs(position[2] - Math.sin(angle) * BLOCK_RING_RADIUS) > 1e-3) {
      throw new Error(`${id}: position must match the collision ring`);
    }
    for (const variant of Object.values(variants)) {
      variant.shape.updateMaterial({ texture: blockTexture, normal_texture: blockNormalTexture,
        emissive_texture: blockEmissiveTexture, use_emissive_texture: 1 });
      variant.node.hide(true);
      variant.node.setPosition(position[0], position[1], position[2]);
    }
    node.hide(false);
    blocks.push({ node, shape, variants, angle, baseY: position[1], active: true,
      type: "normal", hp: 1, maxHp: 1, glow: 0 });
  }
  // Textureは全ブロックで共有するので、最後に1回だけ解放する
  const destroy = () => {
    blockTexture.destroy(); blockNormalTexture.destroy(); blockEmissiveTexture.destroy();
  };
  return { blocks, blockAssets, destroy };
};

// 種別を判別する色と、低粗さの金属反射を表面模様へ適用する
const setAppearance = (shape, color, textured) => {
  shape.updateMaterial({ color, metallic: .72, roughness: .22, specular: 1,
    // 種別色をランプにも使い、白いマスク部分だけを色付きHDR光にする
    emissive_factor: color.slice(0, 3).map(component => component * component * 5.6),
    use_emissive_texture: 1, use_texture: textured ? 1 : 0,
    use_normal_map: textured ? 1 : 0, normal_strength: textured ? .18 : 0 });
};

// 形状resourceを差し替えず、ModelYAMLで用意したNodeの表示だけを切り替える
const selectVariant = (block, name) => {
  const selected = block.variants[name];
  if (!selected) throw new Error(`unknown block variant: ${name}`);
  for (const variant of Object.values(block.variants)) variant.node.hide(true);
  selected.node.hide(false);
  selected.node.setPosition(selected.node.getPosition()[0], block.baseY, selected.node.getPosition()[2]);
  block.node = selected.node;
  block.shape = selected.shape;
};

// 耐久と補給は高い円柱、それ以外は標準円柱に切り替える
export const applyBlockTypeAppearance = (block, { blockAssets, locksOpen = false }) => {
  const colors = { normal: [.38,.80,1,1], hard: [1,.58,.24,1], bomb: [1,.33,.28,1],
    switch: [.98,.92,.26,1], locked: locksOpen ? [.66,.78,1,1] : [.56,.35,.90,1],
    supply: [.12,.70,.20,1] };
  if (!colors[block.type]) throw new Error(`unknown block type: ${block.type}`);
  selectVariant(block, block.type === "hard" || block.type === "supply" ? "tall" : "base");
  setAppearance(block.shape, colors[block.type], true);
};

// 耐久ブロックの1回目の衝突では、底面を維持して高さを半分へ変更する
export const applyHardBlockDamageAppearance = (block, { blockAssets }) => {
  selectVariant(block, "short");
  setAppearance(block.shape, [1.0, 0.75, 0.34, 1.0], true);
};

// 旧版と同じ規則で、ステージ番号から各ブロックの種別を求める
const chooseType = (index, level, supplyIndex) => {
  if (index === supplyIndex) return "supply";
  if ((index + level) % 11 === 0) return "bomb";
  if ((index + level * 2) % 7 === 0) return "switch";
  if ((index + level * 3) % 5 === 0) return "locked";
  if ((index + level) % 3 === 0) return "hard";
  return "normal";
};

// 次のステージに進むとき、高さ・HP・表示状態・種別をまとめて戻す
export const resetBlocksForStage = ({ blocks, level, blockAssets }) => {
  let hasLocked = false, hasSwitch = false;
  const supplyIndex = (level * 5 + 1) % blocks.length;
  blocks.forEach((block, i) => {
    block.active = true; block.glow = 0; block.node.hide(false);
    const position = block.node.getPosition();
    block.node.setPosition(position[0], block.baseY, position[2]);
    block.type = chooseType(i, level, supplyIndex);
    block.maxHp = block.type === "hard" ? 2 : 1;
    block.hp = block.maxHp;
    hasLocked ||= block.type === "locked";
    hasSwitch ||= block.type === "switch";
  });
  if (hasLocked && !hasSwitch) {
    const block = blocks[(level * 3) % blocks.length];
    block.type = "switch"; block.maxHp = 1; block.hp = 1;
  }
  const locksOpen = !hasLocked;
  blocks.forEach(block => applyBlockTypeAppearance(block, { blockAssets, locksOpen }));
  return locksOpen;
};

// ステージ判定で使う、表示中のブロック数を返す
export const countAliveBlocks = blocks => blocks.filter(block => block.active).length;
export default createBlockField;
