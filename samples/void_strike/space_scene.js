// space_scene.js 2026/09/25
// PBR宇宙背景、プレイヤー機、敵機、レーザーの再利用プールを生成する
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";

// primitive assetをGPU Shapeへ変換し、同じ機体部品へ共有する元形状として返す
function createPrototype(gpu, asset, material, id, shapes) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(asset);
  shape.endShape();
  shape.setMaterial(id, material);
  shapes.push(shape);
  return shape;
}

// 元形状から独立した表示instanceとNodeを作り、部位ごとの姿勢・材質を設定する
function addPart(space, parent, name, prototype, material, position, attitude = [0, 0, 0], scale = 1, shapes = []) {
  const shape = new Shape(prototype);
  shape.setMaterial(name, material);
  shape.hide(true);
  shapes.push(shape);
  const node = space.addNode(parent, name);
  node.addShape(shape);
  node.setPosition(...position);
  node.setAttitude(...attitude);
  if (scale !== 1) node.setScale(scale);
  return { node, shape };
}

// 一つのOctahedron meshへ決定的な星位置を格納し、星空を少ないdraw callで描画する
function createStarfield(space, gpu, shapes) {
  const shape = new Shape(gpu);
  const random = (() => {
    let state = 0x6d2b79f5;
    return () => {
      state = Math.imul(state ^ (state >>> 15), state | 1);
      state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
      return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
    };
  })();
  for (let star = 0; star < 300; star++) {
    const x = (random() * 2 - 1) * 26;
    const y = (random() * 2 - 1) * 16;
    const z = -125 + random() * 150;
    const radius = 0.025 + random() * 0.055;
    const vertices = [
      [x + radius, y, z], [x - radius, y, z],
      [x, y + radius, z], [x, y - radius, z],
      [x, y, z + radius], [x, y, z - radius]
    ];
    const start = shape.getVertexCount();
    for (const vertex of vertices) shape.addVertex(...vertex);
    for (const [a, b, c] of [
      [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
      [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]
    ]) shape.addTriangle(start + a, start + b, start + c);
  }
  shape.endShape();
  shape.setMaterial("starlight", {
    color: [0.38, 0.72, 1, 1], metallic: 0, roughness: 1, specular: 0,
    emissive_factor: [0.5, 1.7, 3.4], double_sided: 1
  });
  const node = space.addNode(null, "starfield");
  node.addShape(shape);
  shapes.push(shape);
  return node;
}

// 薄い四角形をつないだ低い輝度の星間航路グリッドを一つのmeshとして作る
function createFlightGrid(space, gpu, shapes) {
  const shape = new Shape(gpu);
  const addQuad = (a, b, c, d) => {
    const start = shape.getVertexCount();
    for (const point of [a, b, c, d]) shape.addVertex(...point);
    shape.addTriangle(start, start + 1, start + 2);
    shape.addTriangle(start, start + 2, start + 3);
  };
  const y = -8.5;
  for (let x = -14; x <= 14; x += 2) {
    const halfWidth = x % 6 === 0 ? 0.035 : 0.012;
    addQuad([x - halfWidth, y, -135], [x + halfWidth, y, -135],
      [x + halfWidth, y, 18], [x - halfWidth, y, 18]);
  }
  for (let z = -132; z <= 18; z += 6) {
    const halfWidth = z % 24 === 12 ? 0.035 : 0.012;
    addQuad([-14, y, z - halfWidth], [14, y, z - halfWidth],
      [14, y, z + halfWidth], [-14, y, z + halfWidth]);
  }
  shape.endShape();
  shape.setMaterial("flight-grid", {
    color: [0.02, 0.12, 0.2, 1], metallic: 0, roughness: 1, specular: 0,
    emissive_factor: [0.008, 0.09, 0.2], double_sided: 1
  });
  const node = space.addNode(null, "flight-grid");
  node.addShape(shape);
  shapes.push(shape);
  return node;
}

// 一つのレーザー発射体をNodeとShapeで保持し、非表示切替で連続的に再利用する
function createBolt(space, name, prototype, material, shapes, size = 1) {
  const root = space.addNode(null, name);
  const part = addPart(space, root, `${name}-beam`, prototype, material, [0, 0, 0], [0, 0, 0], size, shapes);
  return { node: root, shape: part.shape, active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
}

// 機体の複数部位を一つの親Nodeへまとめ、ヒット時に機体全体を消せるpool itemを作る
function createCraft(space, name, prototypes, palette, shapes, isPlayer = false) {
  const root = space.addNode(null, name);
  const parts = [];
  const hull = addPart(space, root, `${name}-hull`, prototypes.hull, palette.hull,
    [0, 0, 0], [isPlayer ? -90 : 90, 0, 0], isPlayer ? 1 : 1.1, shapes);
  const wings = addPart(space, root, `${name}-wings`, prototypes.wings, palette.wings,
    [0, 0.08, 0.2], [0, 0, 0], isPlayer ? 1 : 0.84, shapes);
  const core = addPart(space, root, `${name}-core`, prototypes.core, palette.core,
    [0, 0.17, isPlayer ? 0.05 : 0.12], [0, 0, 0], isPlayer ? 0.62 : 0.52, shapes);
  parts.push(hull.shape, wings.shape, core.shape);
  let canopy = null;
  let engine = null;
  if (isPlayer) {
    canopy = addPart(space, root, `${name}-canopy`, prototypes.canopy, palette.canopy,
      [0, 0.38, 0.56], [0, 0, 0], 0.5, shapes);
    engine = addPart(space, root, `${name}-engine`, prototypes.core, palette.engine,
      [0, -0.04, 1.05], [0, 0, 0], 0.42, shapes);
    parts.push(canopy.shape, engine.shape);
  }
  for (const shape of parts) shape.hide(isPlayer ? false : true);
  return {
    node: root,
    parts,
    hull: hull.shape,
    core: core.shape,
    active: isPlayer,
    x: 0,
    y: 0,
    z: 0,
    hp: 1,
    radius: 0.9,
    phase: 0,
    fireCooldown: 0,
    kind: "drone"
  };
}

// PBRの宇宙船、星間ゲート、背景、弾のpoolを作りgameplayが直接更新できる形で返す
export function createStarfighterScene(app) {
  const gpu = app.getGPU();
  const space = app.space;
  const shapes = [];
  const nodes = new Map();
  const addNode = (node) => { nodes.set(node.name, node); return node; };

  const hullPrototype = createPrototype(gpu, Primitive.double_cone(1.28, 0.48, 8),
    { color: [0.2, 0.66, 0.95, 1], metallic: 0.82, roughness: 0.2, specular: 1 },
    "fighter-hull", shapes);
  const wingsPrototype = createPrototype(gpu, Primitive.cuboid(2.5, 0.13, 0.9),
    { color: [0.12, 0.34, 0.6, 1], metallic: 0.78, roughness: 0.24, specular: 1 },
    "fighter-wings", shapes);
  const corePrototype = createPrototype(gpu, Primitive.sphere(0.3, 12, 16),
    { color: [0.1, 0.9, 1, 1], metallic: 0.1, roughness: 0.25, specular: 1,
      emissive_factor: [0.08, 3.6, 6.5] }, "fighter-core", shapes);
  const canopyPrototype = createPrototype(gpu, Primitive.sphere(0.42, 14, 20),
    { color: [0.12, 0.86, 1, 1], metallic: 0.35, roughness: 0.12, specular: 1,
      emissive_factor: [0.03, 0.4, 0.7] }, "cockpit-glass", shapes);
  const playerPalette = {
    hull: { color: [0.28, 0.72, 0.96, 1], metallic: 0.88, roughness: 0.16, specular: 1 },
    wings: { color: [0.08, 0.23, 0.52, 1], metallic: 0.78, roughness: 0.2, specular: 1 },
    core: { color: [0.04, 0.85, 1, 1], metallic: 0.05, roughness: 0.2, specular: 1,
      emissive_factor: [0.02, 4.5, 8] },
    canopy: { color: [0.2, 0.88, 1, 0.82], alpha: 0.82, alpha_mode: "BLEND", metallic: 0.3,
      roughness: 0.12, specular: 1, emissive_factor: [0.03, 0.4, 0.7] },
    engine: { color: [1, 0.23, 0.05, 1], metallic: 0, roughness: 0.3, specular: 1,
      emissive_factor: [8, 0.7, 0.04] }
  };
  const enemyPalette = {
    hull: { color: [0.43, 0.08, 0.22, 1], metallic: 0.82, roughness: 0.21, specular: 1 },
    wings: { color: [0.23, 0.035, 0.19, 1], metallic: 0.7, roughness: 0.28, specular: 1 },
    core: { color: [1, 0.08, 0.25, 1], metallic: 0.02, roughness: 0.24, specular: 1,
      emissive_factor: [8, 0.08, 0.9] }
  };
  const prototypes = { hull: hullPrototype, wings: wingsPrototype, core: corePrototype, canopy: canopyPrototype };

  const starNode = addNode(createStarfield(space, gpu, shapes));
  const gridNode = addNode(createFlightGrid(space, gpu, shapes));
  const player = createCraft(space, "player-fighter", prototypes, playerPalette, shapes, true);
  nodes.set("player-fighter", player.node);
  player.node.setPosition(0, 0, 10);

  const gatePrototype = createPrototype(gpu, Primitive.donut(10.2, 0.13, 14, 96),
    { color: [0.15, 0.65, 0.94, 1], metallic: 0.68, roughness: 0.18, specular: 1,
      emissive_factor: [0.025, 0.35, 0.95] }, "rift-gate", shapes);
  const gateNodes = [];
  for (let index = 0; index < 5; index++) {
    const shape = new Shape(gatePrototype);
    shape.setMaterial(`rift-gate-${index}`, index % 2 === 0
      ? { color: [0.1, 0.72, 1, 1], metallic: 0.7, roughness: 0.16, specular: 1,
          emissive_factor: [0.03, 0.5, 1.4] }
      : { color: [0.9, 0.08, 0.6, 1], metallic: 0.68, roughness: 0.18, specular: 1,
          emissive_factor: [1.1, 0.03, 0.55] });
    const node = addNode(space.addNode(null, `rift-gate-${index}`));
    node.addShape(shape);
    // トーラスの初期面をカメラへ向け、飛行方向から円形ゲートとして読めるようにする
    node.setAttitude(90, 0, 0);
    node.setPosition(0, 0, -22 - index * 32);
    gateNodes.push({ node, shape, index });
    shapes.push(shape);
  }

  const boundaryPrototype = createPrototype(gpu, Primitive.cuboid(0.16, 0.12, 150),
    { color: [0.08, 0.22, 0.35, 1], metallic: 0.7, roughness: 0.3, specular: 1,
      emissive_factor: [0.01, 0.09, 0.2] }, "flight-boundary", shapes);
  for (const x of [-12.3, 12.3]) {
    const boundary = addPart(space, null, `boundary-${x}`, boundaryPrototype,
      { color: [0.08, 0.22, 0.35, 1], metallic: 0.7, roughness: 0.3, specular: 1,
        emissive_factor: [0.01, 0.09, 0.2] }, [x, 0, -45], [0, 0, 0], 1, shapes);
    boundary.shape.hide(false);
  }

  const boltPrototype = createPrototype(gpu, Primitive.cuboid(0.13, 0.13, 1.6),
    { color: [0.1, 0.85, 1, 1], metallic: 0.1, roughness: 0.2, specular: 1,
      emissive_factor: [0.1, 4, 9] }, "player-bolt", shapes);
  const enemyBoltPrototype = createPrototype(gpu, Primitive.cuboid(0.22, 0.22, 0.9),
    { color: [1, 0.08, 0.3, 1], metallic: 0.1, roughness: 0.2, specular: 1,
      emissive_factor: [8, 0.06, 0.5] }, "enemy-bolt", shapes);
  const playerBolts = Array.from({ length: 64 }, (_, index) =>
    createBolt(space, `player-bolt-${index}`, boltPrototype,
      { color: [0.08, 0.85, 1, 1], metallic: 0.1, roughness: 0.2, specular: 1,
        emissive_factor: [0.08, 4, 9] }, shapes));
  const enemyBolts = Array.from({ length: 36 }, (_, index) =>
    createBolt(space, `enemy-bolt-${index}`, enemyBoltPrototype,
      { color: [1, 0.08, 0.25, 1], metallic: 0.1, roughness: 0.2, specular: 1,
        emissive_factor: [8, 0.05, 0.5] }, shapes, 1.1));

  const enemies = Array.from({ length: 20 }, (_, index) =>
    createCraft(space, `enemy-fighter-${index}`, prototypes, enemyPalette, shapes));
  for (const enemy of enemies) nodes.set(enemy.node.name, enemy.node);

  // 同型shapeの表示、親Node、pool状態をまとめてから次の更新へ引き渡す
  function setCraftVisible(craft, visible) {
    craft.active = visible;
    for (const shape of craft.parts) shape.hide(!visible);
  }

  // 非表示の敵を一つ選び、wave側の初期座標とhealthを設定して返す
  function activateEnemy({ x, y, z, hp, radius, phase, kind }) {
    const enemy = enemies.find(entry => !entry.active);
    if (!enemy) throw new Error("void_strike enemy pool exhausted");
    enemy.x = x;
    enemy.y = y;
    enemy.baseX = x;
    enemy.baseY = y;
    enemy.z = z;
    enemy.hp = hp;
    enemy.radius = radius;
    enemy.phase = phase;
    enemy.kind = kind;
    enemy.fireCooldown = 0.7 + (phase % 7) * 0.13;
    enemy.node.setPosition(x, y, z);
    enemy.node.setScale(kind === "heavy" ? 1.55 : 1);
    setCraftVisible(enemy, true);
    return enemy;
  }

  // 再利用poolから指定した向きと速度のレーザーを一発分取り出す
  function fireBolt(pool, data) {
    const bolt = pool.find(entry => !entry.active);
    if (!bolt) return null;
    Object.assign(bolt, data, { active: true });
    bolt.node.setPosition(bolt.x, bolt.y, bolt.z);
    bolt.shape.hide(false);
    return bolt;
  }

  // 一発を非表示にし、次の発射で同じShapeとNodeを再利用できる状態へ戻す
  function releaseBolt(bolt) {
    bolt.active = false;
    bolt.shape.hide(true);
  }

  return {
    nodes,
    player,
    enemies,
    playerBolts,
    enemyBolts,
    gateNodes,
    starNode,
    gridNode,
    activateEnemy,
    setCraftVisible,
    fireBolt,
    releaseBolt,
    // scene破棄時にShape資源を一度ずつ解放する
    destroy() {
      for (let index = shapes.length - 1; index >= 0; index--) shapes[index].destroy();
      shapes.length = 0;
    }
  };
}
