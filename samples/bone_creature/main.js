// ---------------------------------------------
// samples/bone_creature/main.js  2026/04/30
//   bone_creature sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Skeleton from "../../webg/Skeleton.js";
import Texture from "../../webg/Texture.js";

// webgクラスの役割:
// WebgApp      : Screen / Shader / Space / Camera / Input / Message をまとめて初期化する
// Shape        : 触手メッシュ、コア球、先端球、ボーン表示形状を作る
// Skeleton     : 各触手のボーン階層と行列パレットを管理する
// SmoothShader : スキニング + 法線マップ対応の shader として全形状の見え方を統一する
// 補助 SmoothShader: ボーン可視化と先端球を安定表示する補助 shader として使う
// Texture      : 手続きノイズから高さマップと法線マップを作る
// Matrix       : ボーン rest pose と触手基底姿勢を行列で作る

const FONT_FILE = "../../webg/font512.png";
const CLEAR_COLOR = [0.04, 0.08, 0.20, 1.0];
const CAMERA_CONFIG = {
  target: [0.0, 0.0, 0.0],
  distance: 38.0,
  yaw: 0.0,
  pitch: -8.0,
  roll: 0.0
};

const CORE_RADIUS = 4.4;
const SPEED_SCALE = 2.0;
const GUIDE_COLOR = [0.70, 0.95, 1.00];
const STATUS_COLOR = [0.75, 0.85, 1.00];

// 触手の見え方を inspection 用に比較したいときの固定フラグ
// sample の通常表示ではすべて false にしておく
const DISABLE_TENTACLE_MAPS_FOR_INSPECTION = false;
const FREEZE_TENTACLE_MOTION_FOR_INSPECTION = false;
const FLAT_TENTACLE_LIGHTING_FOR_INSPECTION = false;
const SHOW_BACKFACE_COLOR_FOR_INSPECTION = false;
const HIDE_CORE_FOR_INSPECTION = false;
const INSPECT_SINGLE_TENTACLE_ONLY = false;

let app = null;
let creatureRoot = null;
let tentacles = [];
let totalBones = 0;
let showBones = false;
let paused = false;
let fps = 0.0;
let userYaw = 0.0;
let userPitch = 0.0;
let userRoll = 0.0;
let auxShader = null;

const rotateKeys = {
  xPos: false,
  xNeg: false,
  yPos: false,
  yNeg: false,
  zPos: false,
  zNeg: false
};

// ボーンの local rest pose を同じ手順で設定し、
// tentacle 生成側が matrix の細部を都度書かなくて済むようにする
const setRest = (bone, x, y, z) => {
  const m = new Matrix();
  m.makeUnit();
  m.position([x, y, z]);
  bone.setByMatrix(m);
  bone.setRestByMatrix(m);
};

// 方向ベクトル生成では長さを毎回 1 にそろえ、
// 球面配置と姿勢行列の計算誤差が累積しにくいようにする
const normalize3 = (v) => {
  const d = Math.hypot(v[0], v[1], v[2]) || 1.0;
  return [v[0] / d, v[1] / d, v[2] / d];
};

// 触手基底の姿勢行列を作るため、簡単な外積 helper を分離する
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];

// 複数の触手を球面へほぼ均一に散らし、
// どの方向にも同程度の密度で生えるクリーチャを作る
const fibonacciSphereDir = (i, n) => {
  const ga = Math.PI * (3.0 - Math.sqrt(5.0));
  const y = 1.0 - (2.0 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0.0, 1.0 - y * y));
  const a = ga * i;
  return normalize3([Math.cos(a) * r, y, Math.sin(a) * r]);
};

// local +Y 軸が dir を向く姿勢行列を作り、
// 触手根元の Node を法線方向へぴったりそろえる
const makePoseFromYAxis = (dir, pos) => {
  const yAxis = normalize3(dir);
  const ref = Math.abs(yAxis[1]) < 0.95 ? [0.0, 1.0, 0.0] : [1.0, 0.0, 0.0];
  const xAxis = normalize3(cross3(ref, yAxis));
  const zAxis = normalize3(cross3(xAxis, yAxis));
  const m = new Matrix();
  m.makeUnit();
  m.mat[0] = xAxis[0];
  m.mat[1] = xAxis[1];
  m.mat[2] = xAxis[2];
  m.mat[4] = yAxis[0];
  m.mat[5] = yAxis[1];
  m.mat[6] = yAxis[2];
  m.mat[8] = zAxis[0];
  m.mat[9] = zAxis[1];
  m.mat[10] = zAxis[2];
  m.position(pos);
  return m;
};

// quaternion 経由の再計算を避けて回転行列をそのまま Node へ渡し、
// 触手基底の向きが崩れないようにする
const setNodePoseExact = (node, dir, pos) => {
  const pose = makePoseFromYAxis(dir, pos);
  node.matrix.copyFrom(pose);
  node.position[0] = pos[0];
  node.position[1] = pos[1];
  node.position[2] = pos[2];
  node.dirty = false;
};

// quad ごとに向きを判定してから triangle 化し、
// procedural mesh で裏返り面が混ざらないようにする
const addOrientedQuad = (shape, a, b, c, d) => {
  const pa = shape.positionArray;
  const ax = pa[a * 3];
  const ay = pa[a * 3 + 1];
  const az = pa[a * 3 + 2];
  const bx = pa[b * 3];
  const by = pa[b * 3 + 1];
  const bz = pa[b * 3 + 2];
  const cx = pa[c * 3];
  const cy = pa[c * 3 + 1];
  const cz = pa[c * 3 + 2];
  const dx = pa[d * 3];
  const dz = pa[d * 3 + 2];
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const nz = ux * vy - uy * vx;
  const ox = (ax + bx + cx + dx) * 0.25;
  const oz = (az + bz + cz + dz) * 0.25;
  const outward = nx * ox + nz * oz;
  if (outward >= 0.0) {
    shape.addTriangle(a, b, c);
    shape.addTriangle(a, c, d);
  } else {
    shape.addTriangle(a, d, c);
    shape.addTriangle(a, c, b);
  }
};

// ボーン可視化は軽量な補助 SmoothShader を使い、
// debugBone の見え方が崩れない安全な経路を維持する
const createBoneShape = (gpu, shader, size = 0.22, color = [0.90, 0.75, 0.28, 1.0]) => {
  const boneShape = new Shape(gpu);
  boneShape.applyPrimitiveAsset(Primitive.debugBone(size, boneShape.getPrimitiveOptions()));
  boneShape.endShape();
  boneShape.setShader(shader);
  boneShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    use_normal_map: 0,
    color,
    ambient: 0.30,
    specular: 0.45,
    power: 24.0,
    emissive: 0.0
  });
  return boneShape;
};

// 触手の根元となるコア球は同じ SmoothShader で描き、
// has_bone だけ 0 にして通常 mesh として扱う
const createCoreShape = (gpu, color = [0.18, 0.90, 0.95, 1.0], texture = null, normalTexture = null) => {
  const core = new Shape(gpu);
  core.applyPrimitiveAsset(Primitive.sphere(CORE_RADIUS, 20, 16, core.getPrimitiveOptions()));
  core.endShape();
  core.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: texture ? 1 : 0,
    texture,
    use_normal_map: normalTexture ? 1 : 0,
    normal_texture: normalTexture,
    normal_strength: 0.8,
    color,
    ambient: 0.5,
    specular: 1.00,
    power: 30.0,
    emissive: 0.0
  });
  return core;
};

// 触手先端の小球も補助 SmoothShader で描き、
// ボーン表示を有効化したときも輪郭が安定して読めるようにする
const createTipShape = (gpu, shader, color, highlight = false) => {
  const tip = new Shape(gpu);
  tip.applyPrimitiveAsset(Primitive.sphere(0.3, 10, 10, tip.getPrimitiveOptions()));
  tip.endShape();
  tip.setShader(shader);
  tip.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    use_normal_map: 0,
    color: highlight ? [0.95, 0.88, 0.12, 1.0] : color,
    ambient: highlight ? 0.62 : 0.22,
    specular: highlight ? 1.20 : 0.92,
    power: 30.0,
    emissive: 0.0
  });
  return tip;
};

// スキニング円柱を手続き生成し、
// 高さに応じて近傍 2 ボーンへ線形補間ウェイトを割り当てる
const createTentacleShape = (gpu, cfg) => {
  const {
    length = 11.5,
    radiusBase = 0.88,
    radiusTip = 0.25,
    rings = 56,
    segments = 20,
    boneCount = 8,
    color = [0.75, 0.85, 1.0, 1.0],
    texture = null,
    normalTexture = null,
    flatLighting = false,
    backfaceDebug = false,
    backfaceColor = [1.0, 0.0, 1.0, 1.0]
  } = cfg;

  const shape = new Shape(gpu);
  shape.setAutoCalcNormals(true);
  shape.setTextureMappingMode(1);
  shape.deferAltVertexSync = true;

  const skeleton = new Skeleton();
  shape.setSkeleton(skeleton);

  const bones = [];
  let parent = null;
  const step = length / (boneCount - 1);
  for (let i = 0; i < boneCount; i++) {
    const bone = skeleton.addBone(parent, `b${i}`);
    setRest(bone, 0.0, i === 0 ? 0.0 : step, 0.0);
    bones.push(bone);
    parent = bone;
  }
  skeleton.setBoneOrder(bones.map((bone) => bone.name));
  skeleton.bindRestPose();

  const ringStride = segments + 1;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const y = length * t;
    const radius = radiusBase * (1.0 - t) + radiusTip * t;
    let firstVertex = -1;

    for (let j = 0; j <= segments; j++) {
      const u = j / segments;
      const a = u * Math.PI * 2.0;
      const x = Math.cos(a) * radius;
      const z = -Math.sin(a) * radius;
      const vIndex = shape.addVertexUV(x, y, z, u, 1.0 - t) - 1;
      if (j === 0) {
        firstVertex = vIndex;
      } else if (j === segments) {
        shape.altVertices.push(firstVertex, vIndex);
      }

      const g = y / step;
      let b0 = Math.floor(g);
      if (b0 < 0) b0 = 0;
      if (b0 > boneCount - 1) b0 = boneCount - 1;
      let b1 = b0 + 1;
      if (b1 > boneCount - 1) b1 = boneCount - 1;
      const w1 = b0 === b1 ? 0.0 : (g - b0);
      const w0 = 1.0 - w1;
      shape.addVertexWeight(vIndex, b0, w0);
      if (b1 !== b0) {
        shape.addVertexWeight(vIndex, b1, w1);
      }
    }
  }

  for (let i = 0; i < rings; i++) {
    const r0 = i * ringStride;
    const r1 = (i + 1) * ringStride;
    for (let j = 0; j < segments; j++) {
      const j1 = j + 1;
      addOrientedQuad(shape, r0 + j, r0 + j1, r1 + j1, r1 + j);
    }
  }

  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 1,
    use_texture: texture ? 1 : 0,
    texture,
    use_normal_map: normalTexture ? 1 : 0,
    normal_texture: normalTexture,
    normal_strength: 0.8,
    color,
    ambient: flatLighting ? 1.0 : 0.4,
    specular: flatLighting ? 0.0 : 1.00,
    power: flatLighting ? 1.0 : 20.0,
    emissive: 0.0,
    backface_debug: backfaceDebug ? 1 : 0,
    backface_color: backfaceColor
  });

  return { shape, skeleton, bones };
};

// noise 高さマップと法線マップを 1 度だけ作り、
// すべての tentacle と core で共有して表面の一貫性を保つ
const createTentacleTextures = async (gpu) => {
  const tentacleTexture = new Texture(gpu);
  await tentacleTexture.initPromise;
  const tentacleNormal = new Texture(gpu);
  await tentacleNormal.initPromise;
  const procOptions = {
    pattern: "noise",
    width: 256,
    height: 256,
    scale: 30.0,
    seed: 7,
    contrast: 2.0,
    bias: 0.4,
    octaves: 4,
    persistence: 0.52,
    lacunarity: 2.0,
    wrap: true
  };
  const heightMap = tentacleTexture.makeProceduralHeightMapPixels(procOptions);
  tentacleTexture.setImage(heightMap.image, heightMap.width, heightMap.height, 4);
  await tentacleNormal.buildNormalMapFromHeightMap({
    source: heightMap.image,
    width: heightMap.width,
    height: heightMap.height,
    ncol: 4,
    channel: "luma",
    strength: 3.0,
    wrap: true,
    invertY: false
  });
  tentacleTexture.setRepeat();
  tentacleNormal.setRepeat();
  return { tentacleTexture, tentacleNormal };
};

// static guide は bottom-left に固定し、
// この sample で何を回せるかをいつでも読み返せるようにする
const updateGuideLines = () => {
  app.setGuideLines([
    "[Arrows] rotate creature X/Y  [Q/E] rotate creature Z",
    "[B] bones on/off  [P] pause on/off  [S] screenshot",
    "Touch buttons: same actions on mobile"
  ], {
    anchor: "bottom-left",
    x: 0,
    y: -2,
    color: GUIDE_COLOR
  });
};

// 動作状態は status block にまとめ、
// bones / pause / inspection flag / FPS を画面上部から順に読めるようにする
const updateStatusLines = () => {
  app.setStatusLines([
    `FPS: ${fps.toFixed(1)}  tentacles: ${tentacles.length}  bones(total): ${totalBones}`,
    `bones: ${showBones ? "ON" : "OFF"}  pause: ${paused ? "ON" : "OFF"}  freeze: ${FREEZE_TENTACLE_MOTION_FOR_INSPECTION ? "ON" : "OFF"}`,
    `maps: ${DISABLE_TENTACLE_MAPS_FOR_INSPECTION ? "OFF" : "ON"}  core: ${HIDE_CORE_FOR_INSPECTION ? "OFF" : "ON"}  lit: ${FLAT_TENTACLE_LIGHTING_FOR_INSPECTION ? "OFF" : "ON"}`
  ], {
    anchor: "top-left",
    x: 0,
    y: 0,
    color: STATUS_COLOR
  });
};

// ボーン可視化の切り替えは skeleton ごとに同じ処理を流し、
// どの触手だけ更新漏れしたかを避ける
const toggleBones = () => {
  showBones = !showBones;
  for (let i = 0; i < tentacles.length; i++) {
    tentacles[i].shape.skeleton.showBone(showBones);
  }
  app.space.scanSkeletons();
  updateStatusLines();
};

// スクリーンショット保存名は sample 名と時刻を含め、
// 連続取得しても並べて区別しやすいようにする
const requestScreenshot = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const name = `bone_creature_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
  app.screen.screenShot(name);
};

// キーと touch の両方を同じ rotate flag / action へ流し込み、
// sample の見どころを入力方式から切り離す
const attachInput = () => {
  app.attachInput({
    onKeyDown: (key, ev) => {
      if (key === "arrowup") { rotateKeys.xNeg = true; ev.preventDefault(); return; }
      if (key === "arrowdown") { rotateKeys.xPos = true; ev.preventDefault(); return; }
      if (key === "arrowleft") { rotateKeys.yNeg = true; ev.preventDefault(); return; }
      if (key === "arrowright") { rotateKeys.yPos = true; ev.preventDefault(); return; }
      if (key === "q") { rotateKeys.zNeg = true; return; }
      if (key === "e") { rotateKeys.zPos = true; return; }
      if (ev.repeat) return;
      if (key === "b") {
        toggleBones();
        return;
      }
      if (key === "p") {
        paused = !paused;
        updateStatusLines();
        return;
      }
      if (key === "s") {
        requestScreenshot();
      }
    },
    onKeyUp: (key) => {
      if (key === "arrowup") { rotateKeys.xNeg = false; return; }
      if (key === "arrowdown") { rotateKeys.xPos = false; return; }
      if (key === "arrowleft") { rotateKeys.yNeg = false; return; }
      if (key === "arrowright") { rotateKeys.yPos = false; return; }
      if (key === "q") { rotateKeys.zNeg = false; return; }
      if (key === "e") { rotateKeys.zPos = false; }
    }
  });

  app.input.installTouchControls({
    touchDeviceOnly: true,
    groups: [
      {
        id: "rotateXY",
        buttons: [
          { key: "arrowleft", label: "\u2190", kind: "hold", ariaLabel: "rotate y minus" },
          { key: "arrowright", label: "\u2192", kind: "hold", ariaLabel: "rotate y plus" },
          { key: "arrowup", label: "\u2191", kind: "hold", ariaLabel: "rotate x minus" },
          { key: "arrowdown", label: "\u2193", kind: "hold", ariaLabel: "rotate x plus" }
        ]
      },
      {
        id: "rotateZ",
        buttons: [
          { key: "q", label: "Q", kind: "hold", ariaLabel: "rotate z minus" },
          { key: "e", label: "E", kind: "hold", ariaLabel: "rotate z plus" }
        ]
      },
      {
        id: "action",
        buttons: [
          { key: "b", label: "B", kind: "action", ariaLabel: "toggle bones" },
          { key: "p", label: "P", kind: "action", ariaLabel: "toggle pause" },
          { key: "s", label: "S", kind: "action", ariaLabel: "save screenshot" }
        ]
      }
    ],
    onAction: ({ key }) => {
      if (key === "b") { toggleBones(); return; }
      if (key === "p") {
        paused = !paused;
        updateStatusLines();
        return;
      }
      if (key === "s") requestScreenshot();
    }
  });
};

// 触手本体、コア球、先端球、ボーン可視化形状をここで組み立て、
// start() 側は WebgApp 初期化と loop 開始に集中できるようにする
const buildScene = async () => {
  const gpu = app.getGL();
  const { tentacleTexture, tentacleNormal } = await createTentacleTextures(gpu);

  creatureRoot = app.space.addNode(null, "creatureRoot");
  creatureRoot.setPosition(0.0, 2.4, 0.0);

  const coreNode = app.space.addNode(creatureRoot, "core");
  const coreColor = [0.42, 0.08, 0.08, 1.0];
  if (!HIDE_CORE_FOR_INSPECTION) {
    coreNode.addShape(createCoreShape(gpu, coreColor, tentacleTexture, tentacleNormal));
  }

  const boneColor = [0.82, 0.84, 0.86, 1.0];
  const boneShape = createBoneShape(gpu, auxShader, 0.22, boneColor);

  tentacles = [];
  const tentacleCount = INSPECT_SINGLE_TENTACLE_ONLY ? 1 : 24;
  const surfaceRadius = CORE_RADIUS;
  for (let i = 0; i < tentacleCount; i++) {
    const k = tentacleCount <= 1 ? 0.5 : i / Math.max(1, tentacleCount - 1);
    const r = 0.42 + 0.12 * k;
    const g = 0.06 + 0.03 * ((i % 3) / 2);
    const b = 0.06;
    const tentacle = createTentacleShape(gpu, {
      length: 10.2 + i * 0.28,
      radiusBase: 1.2,
      radiusTip: 0.22,
      rings: 48,
      segments: 22,
      boneCount: 8,
      color: [r, g, b, 1.0],
      texture: DISABLE_TENTACLE_MAPS_FOR_INSPECTION ? null : tentacleTexture,
      normalTexture: DISABLE_TENTACLE_MAPS_FOR_INSPECTION ? null : tentacleNormal,
      flatLighting: FLAT_TENTACLE_LIGHTING_FOR_INSPECTION,
      backfaceDebug: SHOW_BACKFACE_COLOR_FOR_INSPECTION,
      backfaceColor: [0.10, 0.95, 1.00, 1.0]
    });

    tentacle.skeleton.setBoneShape(boneShape);
    tentacle.skeleton.setAttachable(true);
    tentacle.skeleton.showBone(false);

    const node = app.space.addNode(creatureRoot, `tentacle_${i}`);
    const dir = INSPECT_SINGLE_TENTACLE_ONLY ? [0.0, 0.0, 1.0] : fibonacciSphereDir(i, tentacleCount);
    const basePos = [dir[0] * surfaceRadius, dir[1] * surfaceRadius, dir[2] * surfaceRadius];
    setNodePoseExact(node, dir, basePos);
    node.addShape(tentacle.shape);

    const tipShape = createTipShape(gpu, auxShader, [r, g, b, 1.0], true);
    const tipNode = app.space.addNode(tentacle.bones[tentacle.bones.length - 1], `tip_${i}`);
    tipNode.setPosition(0.0, 0.0, 0.0);
    tipNode.addShape(tipShape);

    tentacles.push({
      node,
      bones: tentacle.bones,
      shape: tentacle.shape,
      tipShape,
      phase: i * 0.65
    });
  }

  app.space.scanSkeletons();
  totalBones = tentacles.reduce((sum, td) => sum + td.bones.length, 0);
};

// rotate flag と time を使って creature と camera を更新し、
// 「入力で回した向き」と「自動で揺れる camera」の責務を分ける
const updateCreature = (timeMs, deltaSec) => {
  const t = timeMs * 0.001 * SPEED_SCALE;
  if (!paused && !FREEZE_TENTACLE_MOTION_FOR_INSPECTION) {
    const rotateSpeedDeg = 70.0;
    const step = rotateSpeedDeg * Math.max(deltaSec, 0.0001);
    if (rotateKeys.xPos) userPitch += step;
    if (rotateKeys.xNeg) userPitch -= step;
    if (rotateKeys.yPos) userYaw += step;
    if (rotateKeys.yNeg) userYaw -= step;
    if (rotateKeys.zPos) userRoll += step;
    if (rotateKeys.zNeg) userRoll -= step;
    creatureRoot.setAttitude(userYaw * 4.0, userPitch, userRoll);

    const camYaw = Math.sin(t * 0.5) * 8.0;
    const camPitch = -8.0 + Math.cos(t * 0.5) * 5.0;
    app.cameraRig.setAttitude(camYaw, camPitch, 0.0);

    for (let i = 0; i < tentacles.length; i++) {
      const td = tentacles[i];
      for (let b = 1; b < td.bones.length; b++) {
        const ratio = b / (td.bones.length - 1);
        const ph = t * 1.18 + td.phase + b * 0.42;
        const yaw = Math.sin(ph) * (20.0 * ratio);
        const pitch = Math.cos(ph * 1.2) * (18.0 * ratio);
        const roll = Math.sin(ph * 1.5) * (14.0 * ratio);
        td.bones[b].setAttitude(yaw, pitch, roll);
      }
    }
  }

  if (deltaSec > 0.0) {
    const instFps = 1.0 / deltaSec;
    fps = fps === 0.0 ? instFps : (fps * 0.9 + instFps * 0.1);
  }
  updateStatusLines();
};

// bone_creature は WebgApp を入口にし、
// sample 側では skinned mesh と操作確認に必要な scene 構築だけを記述する
const start = async () => {
  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    messageFontTexture: FONT_FILE,
    clearColor: CLEAR_COLOR,
    viewAngle: 56.0,
    camera: CAMERA_CONFIG,
    lightPosition: [0.0, 40.0, 40.0, 1.0],
    debugTools: {
      mode: "release",
      system: "bone_creature",
      source: "samples/bone_creature/main.js"
    }
  });
  await app.init();
  auxShader = new SmoothShader(app.getGL());
  await auxShader.init();
  auxShader.setProjectionMatrix(app.projectionMatrix);
  auxShader.setLightPosition([0.0, 40.0, 40.0, 1.0]);
  window.addEventListener("resize", () => {
    auxShader?.setProjectionMatrix?.(app.projectionMatrix);
  });
  window.addEventListener("orientationchange", () => {
    auxShader?.setProjectionMatrix?.(app.projectionMatrix);
  });

  await buildScene();
  attachInput();
  updateGuideLines();
  updateStatusLines();

  app.start({
    onUpdate: ({ timeMs, deltaSec }) => {
      auxShader?.setProjectionMatrix?.(app.projectionMatrix);
      updateCreature(timeMs, deltaSec);
    },
    onAfterDraw3d: () => {
      if (!showBones) return;
      app.screen.clearDepthBuffer();
      app.space.scanSkeletons();
      app.space.drawBones();
    }
  });
};

// 起動失敗時は fixed-format panel へ理由を残し、
// sample 利用者が browser 上だけで失敗内容を追えるようにする
document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    console.error(err);
    app?.showErrorPanel?.(err, {
      title: "bone_creature sample failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  });
});
