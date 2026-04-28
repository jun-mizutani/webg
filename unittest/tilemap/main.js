// -------------------------------------------------
// tilemap unittest
//   main.js       2026/04/24
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import SceneAsset from "../../webg/SceneAsset.js";
import Matrix from "../../webg/Matrix.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Message from "../../webg/Message.js";
import Space from "../../webg/Space.js";
import Texture from "../../webg/Texture.js";
import { describeEdgeCutMask, resolveCameraRelativeGridMove } from "../../webg/TileMap.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";

// webgクラスの役割:
// SceneAsset : Scene JSON 由来の tileMap 定義を読み込む入口
// Space      : tileMap の cell と marker を描く Node 階層
// Shape      : tile と marker のメッシュ
// Matrix     : 画面クリックから ray を作る行列計算
// SmoothShader: tile 面の陰影と procedural noise texture / normal map を描く標準材質
// Message    : 画面上へ操作ガイドを出す HUD

const FONT_FILE = "../../webg/font512.png";
const MAP_WIDTH = 8;
const MAP_HEIGHT = 8;
const CELL_SIZE = 4.0;
const CELL_GAP = 0.18;
const TILE_SIZE = CELL_SIZE - CELL_GAP;
const FLOOR_Y = -0.30;
const BASE_TOP_Y = 0.72;
const HEIGHT_STEP_Y = 1.12;
const BALL_RADIUS = 0.82;
const BALL_LIFT = 0.04;
const BALL_MOVE_DURATION_MS = 250;
const DISPLAY_AREA_SCROLL_DURATION_MS = 350;
const BALL_BOUNCE_HEIGHT = 0.58;
const DISPLAY_WIDTH = 4;
const DISPLAY_HEIGHT = 4;
const TERRAIN_TEXTURE_SIZE = 256;
const ORBIT_DRAG_HEAD_SPEED = 0.30;
const ORBIT_DRAG_PITCH_SPEED = 0.20;
const ORBIT_PITCH_MIN = -84.0;
const ORBIT_PITCH_MAX = -8.0;
const ORBIT_DISTANCE_MIN = 10.0;
const ORBIT_DISTANCE_MAX = 34.0;
const ORBIT_PINCH_ZOOM_SPEED = 2.2;
const ORBIT_PAN_SPEED = 2.0;

// オービット操作は近距離で見回しやすいように、少し広めの preset を持たせる
const ORBIT_PRESETS = [
  {
    id: "diag",
    label: "diagonal",
    yaw: 28.0,
    pitch: -30.0,
    distance: 18.7,
    eyeHeight: 13.0
  },
  {
    id: "side",
    label: "side",
    yaw: 90.0,
    pitch: -24.0,
    distance: 20.2,
    eyeHeight: 12.0
  },
  {
    id: "over",
    label: "overhead",
    yaw: 0.0,
    pitch: -78.0,
    distance: 8.2,
    eyeHeight: 21.6
  }
];

// tileMap の見た目を POC と揃えるため、高さから terrain をざっくり分類する
const terrainFromHeight = (height) => {
  if (height >= 2) return "peak";
  if (height >= 1) return "slope";
  return "grass";
};

// tilemap の terrain ごとに使う procedural noise texture と normal map を用意する
// - 1 つの procedural height map から color texture と normal texture を作る
// - terrainMaterials へそのまま渡せる形にして、Scene JSON の build 前に差し込む
const createTerrainTexturePair = async (gpu, options = {}) => {
  const colorTex = new Texture(gpu);
  await colorTex.initPromise;
  const normalTex = new Texture(gpu);
  await normalTex.initPromise;

  const procOptions = {
    pattern: "noise",
    width: TERRAIN_TEXTURE_SIZE,
    height: TERRAIN_TEXTURE_SIZE,
    scale: Number.isFinite(options.scale) ? Number(options.scale) : 18.0,
    seed: Number.isFinite(options.seed) ? Number(options.seed) : 17,
    contrast: Number.isFinite(options.contrast) ? Number(options.contrast) : 1.95,
    bias: Number.isFinite(options.bias) ? Number(options.bias) : 0.0,
    invert: !!options.invert,
    octaves: Number.isFinite(options.octaves) ? Number(options.octaves) : 5,
    persistence: Number.isFinite(options.persistence) ? Number(options.persistence) : 0.52,
    lacunarity: Number.isFinite(options.lacunarity) ? Number(options.lacunarity) : 2.0
  };

  const heightMap = colorTex.makeProceduralHeightMapPixels(procOptions);
  colorTex.setImage(heightMap.image, heightMap.width, heightMap.height, heightMap.ncol);
  colorTex.setRepeat();

  await normalTex.buildNormalMapFromHeightMap({
    source: heightMap.image,
    width: heightMap.width,
    height: heightMap.height,
    ncol: 4,
    channel: "luma",
    strength: Number.isFinite(options.normalStrength) ? Number(options.normalStrength) : 2.0,
    wrap: true,
    invertY: !!options.invertY
  });
  normalTex.setRepeat();

  return {
    texture: colorTex,
    normalTexture: normalTex
  };
};

// terrainMaterials へ流し込む共通の tile 見た目を組み立てる
// - grass / slope / peak で baseColor を少しずつ変える
// - texture と normal_texture は共有しつつ、terrain ごとの見た目差だけを持たせる
const buildTerrainMaterials = (terrainTextures) => {
  const shared = {
    materialId: "smooth-shader",
    has_bone: 0,
    texture: terrainTextures.texture,
    normal_texture: terrainTextures.normalTexture,
    use_texture: 1,
    use_normal_map: 1,
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
    grass: {
      ...shared,
      baseColor: [0.38, 0.74, 0.34, 1.0],
      normal_strength: 1.55
    },
    slope: {
      ...shared,
      baseColor: [0.60, 0.75, 1.0, 1.0],
      normal_strength: 2.0
    },
    peak: {
      ...shared,
      baseColor: [0.96, 0.78, 0.34, 1.0],
      normal_strength: 2.35
    }
  };
};

// ball の移動中に少しだけ跳ねさせるための y 方向オフセットを返す
// - 0 と 1 で 0 に戻り、中央付近で最も高くなる簡単な hop にする
const getBallBounceOffset = (progress) => {
  const t = Math.max(0.0, Math.min(1.0, Number(progress ?? 0.0)));
  return Math.sin(t * Math.PI) * BALL_BOUNCE_HEIGHT;
};

// POC で確認した高さ分布をそのまま test へ流す
const buildHeightMap = () => {
  const heights = Array.from({ length: MAP_HEIGHT }, (_, row) => {
    return Array.from({ length: MAP_WIDTH }, (_, col) => {
      const dx = Math.abs(col - 3.5);
      const dy = Math.abs(row - 3.5);
      return Math.floor(Math.max(dx, dy));
    });
  });

  // 奥側の ridge を入れ、height diff >= 2 のブロックも見えるようにする
  for (let col = 5; col <= 7; col++) {
    heights[1][col] = 3 + (col - 5) + 1;
  }
  return heights;
};

// Scene JSON の tileMap.tiles をそのまま組めるように、height map を entry 化する
const buildTileDefinitions = (heights) => {
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

const HEIGHT_MAP = buildHeightMap();
const TILE_DEFINITIONS = buildTileDefinitions(HEIGHT_MAP);

// Scene JSON では tileMap を中央寄りの可視範囲つきで持たせる
const SCENE = {
  version: "1.0",
  type: "webg-scene",
  meta: {
    name: "tilemap-core-test",
    generator: "unittest/tilemap"
  },
  camera: {
    target: [MAP_WIDTH * CELL_SIZE * 0.5, 0.0, MAP_HEIGHT * CELL_SIZE * 0.5],
    distance: 18.7,
    yaw: 28.0,
    pitch: -30.0,
    roll: 0.0,
    viewAngle: 42.0,
    near: 0.1,
    far: 1000.0
  },
  tileMap: {
    name: "tilemap-core",
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    cellSize: CELL_SIZE,
    cellGap: CELL_GAP,
    floorY: FLOOR_Y,
    baseTopY: BASE_TOP_Y,
    heightStepY: HEIGHT_STEP_Y,
    displayArea: {
      x: 2,
      y: 2,
      width: 4,
      height: 4
    },
    tiles: TILE_DEFINITIONS
  }
};

// 透視投影を作り直し、画面サイズ変更後も同じ見え方を保つ
const setProjection = (screen, shader, fov = 42) => {
  const proj = new Matrix();
  const vfov = screen.getRecommendedFov(fov);
  proj.makeProjectionMatrix(0.1, 1000.0, vfov, screen.getAspect());
  shader.setProjectionMatrix(proj);
  return proj;
};

// CSS 座標のクリック位置を NDC へ変換する
const cssToNdc = (canvas, clientX, clientY) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
  const y = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;
  return [x, y];
};

// クリック位置からワールド空間のレイを作る
const makeRayFromMouse = (canvas, clientX, clientY, eyeNode, proj, view) => {
  const [nx, ny] = cssToNdc(canvas, clientX, clientY);
  const invVp = proj.clone();
  invVp.mul(view);
  invVp.inverse_strict();

  const near = invVp.mulVector([nx, ny, -1.0]);
  const far = invVp.mulVector([nx, ny, 1.0]);
  const eyePos = eyeNode.getWorldPosition();
  const dir = [
    far[0] - eyePos[0],
    far[1] - eyePos[1],
    far[2] - eyePos[2]
  ];

  return {
    origin: eyePos,
    dir,
    near,
    far,
    ndc: [nx, ny]
  };
};

// DisplayArea を画面で読みやすい表記へ整える
const displayAreaToText = (displayArea) => {
  if (!displayArea) {
    return "(none)";
  }
  return `(${displayArea.minCol},${displayArea.minRow})-(${displayArea.maxCol},${displayArea.maxRow})`;
};

// 2 つの displayArea を比較し、scroll したかどうかを読みやすくする
const isSameDisplayArea = (left, right) => {
  if (!left || !right) {
    return false;
  }
  return left.minCol === right.minCol
    && left.maxCol === right.maxCol
    && left.minRow === right.minRow
    && left.maxRow === right.maxRow;
};

// displayArea の中心へ cameraPivot を寄せるための world 座標を求める
const getDisplayAreaCenter = (displayArea) => {
  return [
    (displayArea.minCol + displayArea.maxCol + 1) * 0.5 * CELL_SIZE,
    0.0,
    (displayArea.minRow + displayArea.maxRow + 1) * 0.5 * CELL_SIZE
  ];
};

// ball の現在位置を示す top surface selection を作る
const makeTopSelection = (cell) => {
  if (!cell) {
    return null;
  }
  return {
    cell,
    hitFace: "top",
    hitHeight: cell.topY,
    point: [cell.center[0], cell.topY, cell.center[2]]
  };
};

// camera preset と drag / wheel の両方から orbit camera を更新する
const applyOrbitCamera = (cameraPivot, eye, orbit) => {
  cameraPivot.setAttitude(orbit.yaw, 0.0, 0.0);
  eye.setPosition(0.0, orbit.eyeHeight, orbit.distance);
  eye.setAttitude(0.0, orbit.pitch, 0.0);
};

// drag 量を orbit の yaw / pitch へ反映する
// - mouse drag と 1本指 drag の両方を同じ更新式へそろえる
const applyOrbitDrag = (orbit, dx, dy) => {
  orbit.yaw += dx * ORBIT_DRAG_HEAD_SPEED;
  orbit.pitch = Math.max(ORBIT_PITCH_MIN, Math.min(ORBIT_PITCH_MAX, orbit.pitch + dy * ORBIT_DRAG_PITCH_SPEED));
};

// wheel や pinch で camera 距離を変える
// - zoom の source に依存せず同じ clamp 条件を使う
const applyOrbitZoomDelta = (orbit, zoomDelta) => {
  orbit.distance = Math.max(ORBIT_DISTANCE_MIN, Math.min(ORBIT_DISTANCE_MAX, orbit.distance + zoomDelta));
};

// pinch の距離変化を orbit zoom へ変換する
// - viewport の短辺を基準にして、端末サイズ差の影響を少し抑える
const applyOrbitPinchZoom = (canvas, orbit, pinchDelta) => {
  const size = Math.max(1.0, Math.min(canvas?.clientWidth ?? 0, canvas?.clientHeight ?? 0));
  const zoomAmount = -pinchDelta * orbit.distance * ORBIT_PINCH_ZOOM_SPEED / size;
  applyOrbitZoomDelta(orbit, zoomAmount);
};

// world 行列から得た vector を XZ 平面へ投影して unit vector へ直す
// - TileMap 系の camera 移動は ground 上を滑らせたいので Y 成分は除く
const normalizeGroundVector = (v, fallback = [0.0, 0.0, 0.0]) => {
  const x = v?.[0] ?? 0.0;
  const z = v?.[2] ?? 0.0;
  const len = Math.hypot(x, z);
  if (len <= 1.0e-8) {
    return [...fallback];
  }
  return [x / len, 0.0, z / len];
};

// 2本指 drag を ground 上の camera pivot 移動へ変換する
// - displayArea 追従は別に残しつつ、操作中は現在の pivot をその場でずらして見回しやすくする
const panCameraPivotByScreenDelta = (cameraPivot, eye, canvas, orbit, dx, dy) => {
  eye.setWorldMatrix();
  const matrix = eye.getWorldMatrix();
  const eyePos = eye.getWorldPosition();
  const pivotPos = cameraPivot.getPosition();
  const fallbackForward = normalizeGroundVector([
    pivotPos[0] - eyePos[0],
    0.0,
    pivotPos[2] - eyePos[2]
  ], [0.0, 0.0, -1.0]);
  const right = normalizeGroundVector(
    matrix.mul3x3Vector([1.0, 0.0, 0.0]),
    [fallbackForward[2], 0.0, -fallbackForward[0]]
  );
  const screenUp = normalizeGroundVector(
    matrix.mul3x3Vector([0.0, 1.0, 0.0]),
    fallbackForward
  );
  const size = Math.max(1.0, Math.min(canvas?.clientWidth ?? 0, canvas?.clientHeight ?? 0));
  const scale = orbit.distance * ORBIT_PAN_SPEED / size;
  const moveX = right[0] * (-dx * scale) + screenUp[0] * (dy * scale);
  const moveZ = right[2] * (-dx * scale) + screenUp[2] * (dy * scale);
  cameraPivot.setPosition(pivotPos[0] + moveX, pivotPos[1], pivotPos[2] + moveZ);
};

// 1 つの tileMap POC / test で使う案内文を画面上へまとめる
const updateGuide = (message, selected, ballCell, tileMap, orbit, lastMoveText, pathText) => {
  const cellLine = selected
    ? `cell=(${selected.cell.col}, ${selected.cell.row}) height=${selected.cell.height} terrain=${selected.cell.terrain} area=${tileMap.isInDisplayArea(selected.cell.col, selected.cell.row) ? "display" : "definition"}`
    : "cell=(none)";
  const shapeLine = selected
    ? `cuts=${describeEdgeCutMask(selected.cell.edgeCutMask)}`
    : "cuts=(none)";
  const faceLine = selected
    ? `face=${selected.hitFace} hitHeight=${selected.hitHeight.toFixed(2)} topY=${selected.cell.topY.toFixed(2)}`
    : "face=(none)";
  const ballLine = ballCell
    ? `ball=(${ballCell.col}, ${ballCell.row}) height=${ballCell.height} topY=${ballCell.topY.toFixed(2)} area=${tileMap.isInDisplayArea(ballCell.col, ballCell.row) ? "display" : "definition"}`
    : "ball=(none)";

  message.replaceAll([
    {
      id: "tilemap-guide",
      text: "TileMap core test",
      x: 0,
      y: 1,
      color: [1.0, 0.86, 0.42]
    },
    {
      id: "tilemap-keys",
      lines: [
        "1-finger drag / mouse drag: orbit camera",
        "2-finger drag: move camera on ground",
        "pinch / wheel: zoom",
        "tap / click: pick top or wall",
        "arrow keys: move the ball",
        "1/2/3: orbit preset",
        "r: reset camera"
      ],
      x: 0,
      y: 3,
      color: [0.86, 0.95, 1.0]
    },
    {
      id: "tilemap-info",
      lines: [
        `orbit=${orbit.label} yaw=${orbit.yaw.toFixed(1)} pitch=${orbit.pitch.toFixed(1)} dist=${orbit.distance.toFixed(1)}`,
        `displayArea=${displayAreaToText(tileMap.displayArea)}`,
        ballLine,
        cellLine,
        shapeLine,
        faceLine,
        `path=${pathText}`,
        `move=${lastMoveText}`,
        "tileMap handles pickCell / canMove / displayArea"
      ],
      anchor: "bottom-left",
      x: 0,
      y: -5,
      color: [0.96, 0.98, 0.92]
    }
  ]);
};

// status pane へ現在の選択と camera をまとめて出す
const formatStatus = (selected, ballCell, tileMap, orbit, pathText, lastMoveText, count) => {
  const lines = [
    "unittest/tilemap",
    `orbit: ${orbit.label} yaw=${orbit.yaw.toFixed(1)} pitch=${orbit.pitch.toFixed(1)} dist=${orbit.distance.toFixed(1)}`,
    `displayArea: ${displayAreaToText(tileMap.displayArea)}`,
    `tiles: ${count}`,
    ballCell
      ? `ball: (${ballCell.col}, ${ballCell.row}) h=${ballCell.height} top=${ballCell.topY.toFixed(2)} area=${tileMap.isInDisplayArea(ballCell.col, ballCell.row) ? "display" : "definition"}`
      : "ball: (none)",
    selected
      ? `selected: (${selected.cell.col}, ${selected.cell.row}) ${selected.hitFace} h=${selected.hitHeight.toFixed(2)} cuts=${describeEdgeCutMask(selected.cell.edgeCutMask)}`
      : "selected: (none)",
    `path: ${pathText}`,
    `move: ${lastMoveText}`,
    "drag camera and move the ball with arrows"
  ];
  return lines.join("\n");
};

// 2D の path 結果を status に出しやすい文字列へ整える
const pathToText = (path) => {
  if (!path) {
    return "blocked";
  }
  return `${path.length} cells`;
};

// この sample の初期化を 1 か所へまとめ、screen / shader / space / tileMap / input / HUD の順で追えるようにする
const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop }) => {
  const terrainTextures = await createTerrainTexturePair(gpu, {
    scale: 18.0,
    seed: 17,
    contrast: 1.95,
    octaves: 5,
    normalStrength: 2.0
  });
  SCENE.tileMap.terrainMaterials = buildTerrainMaterials(terrainTextures);

  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  shader.setLightPosition([10.0, 24.0, 18.0, 1.0]);

  const message = new Message(gpu, { cols: 80, rows: 25 });
  await message.init(FONT_FILE);
  message.charOffset = 0;
  message.shader.setScale(1.0);

  let proj = null;
  // 画面サイズ変更時に projection を作り直し、見え方が崩れないようにする
  setViewportLayout(() => {
    proj = setProjection(screen, shader, SCENE.camera.viewAngle);
  });

  const space = new Space();
  const cameraPivot = space.addNode(null, "camera-pivot");
  const eye = space.addNode(cameraPivot, "eye");

  const sceneAsset = SceneAsset.fromData(SCENE);
  const sceneRuntime = await sceneAsset.build({ gpu, space });
  const tileMap = sceneRuntime.tileMap;
  if (!tileMap) {
    throw new Error("tileMap runtime was not created");
  }

  const ballShape = new Shape(gpu);
  ballShape.applyPrimitiveAsset(
    Primitive.sphere(BALL_RADIUS, 18, 18, ballShape.getPrimitiveOptions())
  );
  ballShape.endShape();
  ballShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [1.0, 0.84, 0.82, 1.0],
    ambient: 0.34,
    specular: 0.92,
    power: 58.0
  });
  const ballNode = space.addNode(null, "ball");
  ballNode.addShape(ballShape);

  // ball の上に細長い marker を置き、rotation tween の見え方を確認しやすくする
  // 形状は左右の向きが分かりやすいように横長の cuboid にしている
  const ballMarkerShape = new Shape(gpu);
  ballMarkerShape.applyPrimitiveAsset(
    Primitive.cuboid(BALL_RADIUS * 1.35, BALL_RADIUS * 0.22, BALL_RADIUS * 0.28, ballMarkerShape.getPrimitiveOptions())
  );
  ballMarkerShape.endShape();
  ballMarkerShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [1.0, 0.92, 0.36, 1.0],
    ambient: 0.42,
    specular: 0.58,
    power: 32.0
  });
  const ballMarkerNode = space.addNode(ballNode, "ball-marker");
  ballMarkerNode.setPosition(0.0, BALL_RADIUS + 0.54, 0.0);
  ballMarkerNode.addShape(ballMarkerShape);

  const orbitPresets = ORBIT_PRESETS;
  let orbitIndex = 0;
  const orbit = {
    label: orbitPresets[orbitIndex].label,
    yaw: orbitPresets[orbitIndex].yaw,
    pitch: orbitPresets[orbitIndex].pitch,
    distance: orbitPresets[orbitIndex].distance,
    eyeHeight: orbitPresets[orbitIndex].eyeHeight
  };

  // camera を初期 preset へ戻し、drag や zoom で崩れた視点をいつでも立て直せるようにする
  const resetOrbit = () => {
    orbitIndex = 0;
    orbit.label = orbitPresets[orbitIndex].label;
    orbit.yaw = orbitPresets[orbitIndex].yaw;
    orbit.pitch = orbitPresets[orbitIndex].pitch;
    orbit.distance = orbitPresets[orbitIndex].distance;
    orbit.eyeHeight = orbitPresets[orbitIndex].eyeHeight;
    applyOrbitCamera(cameraPivot, eye, orbit);
  };

  // preset 番号に応じて orbit の角度と距離を切り替え、同じ盤面を別角度で見比べる
  const setOrbitPreset = (index) => {
    orbitIndex = (index + orbitPresets.length) % orbitPresets.length;
    orbit.label = orbitPresets[orbitIndex].label;
    orbit.yaw = orbitPresets[orbitIndex].yaw;
    orbit.pitch = orbitPresets[orbitIndex].pitch;
    orbit.distance = orbitPresets[orbitIndex].distance;
    orbit.eyeHeight = orbitPresets[orbitIndex].eyeHeight;
    applyOrbitCamera(cameraPivot, eye, orbit);
  };

  let ballCell = tileMap.getCell(3, 3);
  let selected = makeTopSelection(ballCell);
  let lastMoveText = "ball ready at (3, 3)";
  let pathText = "blocked";
  let ballMoveTween = null;
  let cameraPivotMoveTween = null;
  let cameraPivotMoveTarget = null;
  const goalCell = tileMap.getCell(7, 7);

  // 現在位置と目標位置が同じかを判定し、同じ tween を無駄に作り直さないようにする
  const sameVec3 = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length < 3 || right.length < 3) {
      return false;
    }
    return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
  };

  // ballCell の移動に合わせて displayArea の中心を決め、必要なときだけ cameraPivot を tween する
  const syncDisplayArea = (animate = false) => {
    const displayArea = tileMap.followCell(ballCell);
    const center = getDisplayAreaCenter(displayArea);
    const target = [center[0], 0.0, center[2]];
    if (!animate) {
      cameraPivotMoveTween = null;
      cameraPivotMoveTarget = [...target];
      cameraPivot.setPosition(target[0], target[1], target[2]);
      return displayArea;
    }
    const current = cameraPivot.getPosition();
    if (sameVec3(current, target)) {
      cameraPivotMoveTween = null;
      cameraPivotMoveTarget = [...target];
      return displayArea;
    }
    if (cameraPivotMoveTween && !cameraPivotMoveTween.isFinished() && sameVec3(cameraPivotMoveTarget, target)) {
      return displayArea;
    }
    cameraPivotMoveTarget = [...target];
    cameraPivotMoveTween = cameraPivot.animatePosition(target, {
      durationMs: DISPLAY_AREA_SCROLL_DURATION_MS,
      easing: "outCubic",
      // cameraPivot の移動が終わったら、次の displayArea 更新へ進めるために実行中フラグを外す
      onComplete: () => {
        cameraPivotMoveTween = null;
      }
    });
    return displayArea;
  };

  syncDisplayArea(false);
  applyOrbitCamera(cameraPivot, eye, orbit);
  tileMap.placeNodeOnCell(ballNode, ballCell, BALL_LIFT, BALL_RADIUS);
  tileMap.refreshTileColors(selected);
  pathText = pathToText(tileMap.findPath(ballCell, goalCell));

  // 論理状態と HUD をまとめ直し、移動後の cell / path / camera を同じ frame で反映する
  const refreshState = (options = {}) => {
    const placeBall = options.placeBall !== false;
    syncDisplayArea(true);
    if (placeBall) {
      tileMap.placeNodeOnCell(ballNode, ballCell, BALL_LIFT, BALL_RADIUS);
    }
    tileMap.refreshTileColors(selected);
    pathText = pathToText(tileMap.findPath(ballCell, goalCell));
    setStatus(formatStatus(selected, ballCell, tileMap, orbit, pathText, lastMoveText, tileMap.cells.length));
  };

  // 1 回の移動要求を tween に変換し、移動中の再入力と表示更新を整理する
  const startBallMove = (nextCell) => {
    if (ballMoveTween && !ballMoveTween.isFinished()) {
      lastMoveText = "move blocked: ball is moving";
      refreshState({ placeBall: false });
      return false;
    }
    const targetPosition = tileMap.getNodePositionOnCell(nextCell, BALL_LIFT, BALL_RADIUS);
    if (!targetPosition) {
      lastMoveText = "move blocked: target position not found";
      refreshState({ placeBall: false });
      return false;
    }

    const beforeDisplayArea = tileMap.displayArea;
    ballMoveTween = ballNode.animatePosition(targetPosition, {
      durationMs: BALL_MOVE_DURATION_MS,
      easing: "outCubic",
      // 進行中は base の移動位置に hop を重ね、cell 間を少し跳ねて進むように見せる
      onUpdate: (target, progress) => {
        target[1] += getBallBounceOffset(progress);
      },
      // ball の移動が終わった時点で cell を確定し、displayArea と HUD をまとめて更新する
      onComplete: () => {
        ballMoveTween = null;
        ballCell = nextCell;
        selected = makeTopSelection(ballCell);
        syncDisplayArea(true);
        lastMoveText = isSameDisplayArea(beforeDisplayArea, tileMap.displayArea)
          ? `moved to (${ballCell.col}, ${ballCell.row})`
          : `moved to (${ballCell.col}, ${ballCell.row}), displayArea scrolled to ${displayAreaToText(tileMap.displayArea)}`;
        refreshState();
      }
    });
    if (!ballMoveTween) {
      return false;
    }

    // ball の移動に合わせて marker も 250ms で Y 軸回りに 90 度回し、animateRotation の確認例にする
    ballMarkerNode.animateRotation([90.0, 0.0, 0.0], {
      durationMs: BALL_MOVE_DURATION_MS,
      easing: "linear",
      relative: true
    });

    lastMoveText = `moving to (${nextCell.col}, ${nextCell.row})`;
    refreshState({ placeBall: false });
    return true;
  };

  // raycast の hit を、ball 配置と cell 選択のどちらとして扱うかを切り分ける
  const applySelection = (hit, isBallPlacement = false) => {
    if (isBallPlacement && hit?.cell) {
      if (ballMoveTween && !ballMoveTween.isFinished()) {
        lastMoveText = "ball placement blocked: ball is moving";
        refreshState({ placeBall: false });
        return;
      }
      const beforeDisplayArea = tileMap.displayArea;
      ballCell = hit.cell;
      selected = makeTopSelection(ballCell);
      syncDisplayArea(true);
      lastMoveText = isSameDisplayArea(beforeDisplayArea, tileMap.displayArea)
        ? `ball placed at (${ballCell.col}, ${ballCell.row})`
        : `ball placed at (${ballCell.col}, ${ballCell.row}), displayArea scrolled to ${displayAreaToText(tileMap.displayArea)}`;
      refreshState();
      return;
    }

    selected = hit;
    lastMoveText = hit
      ? `selected ${hit.hitFace} on (${hit.cell.col}, ${hit.cell.row})`
      : "selection cleared";
    refreshState();
  };

  // 選択を消したときも HUD と status を同じ更新経路へ通す
  const clearSelection = () => {
    selected = null;
    lastMoveText = "selection cleared";
    refreshState();
  };

  // 現在の ballCell から隣接 cell を探し、範囲外と高さ差の条件を先に弾く
  const moveBall = (dx, dy) => {
    if (!ballCell) {
      lastMoveText = "move blocked: ball not placed";
      refreshState();
      return false;
    }
    const nextCell = tileMap.getCell(ballCell.col + dx, ballCell.row + dy);
    if (!nextCell) {
      selected = makeTopSelection(ballCell);
      lastMoveText = "move blocked: outside map";
      refreshState();
      return false;
    }
    if (!tileMap.canMove(ballCell, nextCell)) {
      selected = makeTopSelection(ballCell);
      lastMoveText = `move blocked: height diff ${Math.abs(nextCell.height - ballCell.height)} > 1`;
      refreshState();
      return false;
    }

    return startBallMove(nextCell);
  };

  const pointerState = {
    active: false,
    moved: false,
    lastX: 0,
    lastY: 0,
    pointerId: null,
    touchPointers: new Map(),
    touchPointerId: null,
    touchMoved: false,
    touchStartX: 0,
    touchStartY: 0,
    touchLastX: 0,
    touchLastY: 0,
    touchGestureActive: false,
    touchCenterX: 0,
    touchCenterY: 0,
    touchDistance: 0
  };

  const canvas = screen.canvas;
  canvas.style.touchAction = "none";
  const TOUCH_DRAG_THRESHOLD_PX = 6;
  const MOUSE_DRAG_THRESHOLD_PX = 2;

  // click / tap selection は mouse / touch の両方で同じ raycast 経路を使う
  const pickCellAt = (clientX, clientY) => {
    eye.setWorldMatrix();
    const view = new Matrix();
    view.makeView(eye.worldMatrix);
    const ray = makeRayFromMouse(canvas, clientX, clientY, eye, proj, view);
    const hit = tileMap.pickCell(ray.origin, ray.dir);
    if (hit?.hitFace === "top") {
      applySelection(hit, true);
    } else {
      applySelection(hit, false);
    }
  };

  // touch pointer の最新位置を保持し、gesture 計算を move ごとに更新できるようにする
  const storeTouchPointer = (ev) => {
    pointerState.touchPointers.set(ev.pointerId, {
      pointerId: ev.pointerId,
      clientX: ev.clientX,
      clientY: ev.clientY
    });
  };

  const releaseTouchPointer = (pointerId) => {
    pointerState.touchPointers.delete(pointerId);
  };

  // multitouch gesture は最初の 2 本だけで中心移動と指間距離を読む
  const getTouchPointers = () => {
    return Array.from(pointerState.touchPointers.values()).slice(0, 2);
  };

  const getTouchMetrics = () => {
    const touches = getTouchPointers();
    if (touches.length < 2) {
      return {
        centerX: 0,
        centerY: 0,
        distance: 0
      };
    }
    const a = touches[0];
    const b = touches[1];
    return {
      centerX: (a.clientX + b.clientX) * 0.5,
      centerY: (a.clientY + b.clientY) * 0.5,
      distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
    };
  };

  const beginTouchGesture = () => {
    const metrics = getTouchMetrics();
    pointerState.touchGestureActive = true;
    pointerState.touchCenterX = metrics.centerX;
    pointerState.touchCenterY = metrics.centerY;
    pointerState.touchDistance = metrics.distance;
  };

  const resetTouchGesture = () => {
    pointerState.touchGestureActive = false;
    pointerState.touchCenterX = 0;
    pointerState.touchCenterY = 0;
    pointerState.touchDistance = 0;
  };

  const releasePointerCaptureSafe = (pointerId) => {
    try {
      canvas.releasePointerCapture(pointerId);
    } catch (_) {
      // capture が残っていない場合は無視する
    }
  };

  // 左ボタンと touch の押下を drag / click / tap の起点として記録する
  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "touch") {
      storeTouchPointer(ev);
      canvas.setPointerCapture(ev.pointerId);
      const touches = getTouchPointers();
      if (touches.length >= 2) {
        pointerState.touchMoved = true;
        pointerState.touchPointerId = null;
        beginTouchGesture();
      } else {
        pointerState.touchPointerId = ev.pointerId;
        pointerState.touchMoved = false;
        pointerState.touchStartX = ev.clientX;
        pointerState.touchStartY = ev.clientY;
        pointerState.touchLastX = ev.clientX;
        pointerState.touchLastY = ev.clientY;
        resetTouchGesture();
      }
      ev.preventDefault();
      return;
    }
    if (ev.button !== 0) {
      return;
    }
    pointerState.active = true;
    pointerState.moved = false;
    pointerState.lastX = ev.clientX;
    pointerState.lastY = ev.clientY;
    pointerState.pointerId = ev.pointerId;
    canvas.setPointerCapture(ev.pointerId);
  });

  // drag 中は camera orbit / pan / zoom を更新し、同時に camera の向きを status に反映する
  canvas.addEventListener("pointermove", (ev) => {
    if (ev.pointerType === "touch") {
      if (!pointerState.touchPointers.has(ev.pointerId)) {
        return;
      }
      storeTouchPointer(ev);
      const touches = getTouchPointers();
      if (touches.length >= 2) {
        if (!pointerState.touchGestureActive) {
          beginTouchGesture();
        }
        const metrics = getTouchMetrics();
        const centerDx = metrics.centerX - pointerState.touchCenterX;
        const centerDy = metrics.centerY - pointerState.touchCenterY;
        const pinchDelta = metrics.distance - pointerState.touchDistance;
        if (Math.abs(centerDx) + Math.abs(centerDy) > 0 || Math.abs(pinchDelta) > 0) {
          pointerState.touchMoved = true;
        }
        panCameraPivotByScreenDelta(cameraPivot, eye, canvas, orbit, centerDx, centerDy);
        applyOrbitPinchZoom(canvas, orbit, pinchDelta);
        applyOrbitCamera(cameraPivot, eye, orbit);
        pointerState.touchCenterX = metrics.centerX;
        pointerState.touchCenterY = metrics.centerY;
        pointerState.touchDistance = metrics.distance;
        setStatus(formatStatus(selected, ballCell, tileMap, orbit, pathText, lastMoveText, tileMap.cells.length));
        ev.preventDefault();
        return;
      }
      if (pointerState.touchPointerId !== ev.pointerId) {
        return;
      }
      if (!pointerState.touchMoved) {
        const totalDx = ev.clientX - pointerState.touchStartX;
        const totalDy = ev.clientY - pointerState.touchStartY;
        if (Math.abs(totalDx) + Math.abs(totalDy) <= TOUCH_DRAG_THRESHOLD_PX) {
          return;
        }
        pointerState.touchMoved = true;
      }
      const dx = ev.clientX - pointerState.touchLastX;
      const dy = ev.clientY - pointerState.touchLastY;
      applyOrbitDrag(orbit, dx, dy);
      applyOrbitCamera(cameraPivot, eye, orbit);
      pointerState.touchLastX = ev.clientX;
      pointerState.touchLastY = ev.clientY;
      setStatus(formatStatus(selected, ballCell, tileMap, orbit, pathText, lastMoveText, tileMap.cells.length));
      ev.preventDefault();
      return;
    }
    if (!pointerState.active) {
      return;
    }
    const dx = ev.clientX - pointerState.lastX;
    const dy = ev.clientY - pointerState.lastY;
    if (Math.abs(dx) + Math.abs(dy) > MOUSE_DRAG_THRESHOLD_PX) {
      pointerState.moved = true;
    }
    applyOrbitDrag(orbit, dx, dy);
    applyOrbitCamera(cameraPivot, eye, orbit);
    pointerState.lastX = ev.clientX;
    pointerState.lastY = ev.clientY;
    setStatus(formatStatus(selected, ballCell, tileMap, orbit, pathText, lastMoveText, tileMap.cells.length));
  });

  // drag しなかった pointerup は click / tap として扱い、raycast で tile を選択する
  canvas.addEventListener("pointerup", (ev) => {
    if (ev.pointerType === "touch") {
      const wasPrimaryTouch = pointerState.touchPointerId === ev.pointerId;
      const tapEligible = wasPrimaryTouch && !pointerState.touchMoved && getTouchPointers().length <= 1;
      releaseTouchPointer(ev.pointerId);
      releasePointerCaptureSafe(ev.pointerId);
      const touches = getTouchPointers();
      if (touches.length >= 2) {
        pointerState.touchPointerId = null;
        pointerState.touchMoved = true;
        beginTouchGesture();
      } else if (touches.length === 1) {
        const remaining = touches[0];
        pointerState.touchPointerId = remaining.pointerId;
        pointerState.touchLastX = remaining.clientX;
        pointerState.touchLastY = remaining.clientY;
        resetTouchGesture();
      } else {
        pointerState.touchPointerId = null;
        resetTouchGesture();
      }
      if (tapEligible) {
        pickCellAt(ev.clientX, ev.clientY);
      }
      ev.preventDefault();
      return;
    }
    if (!pointerState.active) {
      return;
    }
    if (!pointerState.moved) {
      pickCellAt(ev.clientX, ev.clientY);
    }
    pointerState.active = false;
    pointerState.pointerId = null;
  });

  canvas.addEventListener("pointercancel", (ev) => {
    if (ev.pointerType === "touch") {
      releaseTouchPointer(ev.pointerId);
      releasePointerCaptureSafe(ev.pointerId);
      const touches = getTouchPointers();
      if (touches.length === 1) {
        const remaining = touches[0];
        pointerState.touchPointerId = remaining.pointerId;
        pointerState.touchLastX = remaining.clientX;
        pointerState.touchLastY = remaining.clientY;
        resetTouchGesture();
      } else {
        pointerState.touchPointerId = null;
        pointerState.touchMoved = false;
        resetTouchGesture();
      }
      return;
    }
    pointerState.active = false;
    pointerState.pointerId = null;
    pointerState.moved = false;
  });

  // wheel は zoom のみを更新し、ballCell や displayArea はそのまま保つ
  canvas.addEventListener("wheel", (ev) => {
    applyOrbitZoomDelta(orbit, ev.deltaY * 0.01);
    applyOrbitCamera(cameraPivot, eye, orbit);
    setStatus(formatStatus(selected, ballCell, tileMap, orbit, pathText, lastMoveText, tileMap.cells.length));
    ev.preventDefault();
  }, { passive: false });

  // keydown は camera 向きに応じた grid move と、preset / reset の操作を分けて扱う
  window.addEventListener("keydown", (ev) => {
    const key = ev.key.toLowerCase();
    const relativeMove = resolveCameraRelativeGridMove(orbit.yaw, key);
    if (relativeMove) {
      moveBall(relativeMove.dx, relativeMove.dy);
      ev.preventDefault();
    } else if (key === "r") {
      resetOrbit();
      setStatus(formatStatus(selected, ballCell, tileMap, orbit, pathText, lastMoveText, tileMap.cells.length));
      ev.preventDefault();
    } else if (key === "1") {
      setOrbitPreset(0);
      setStatus(formatStatus(selected, ballCell, tileMap, orbit, pathText, lastMoveText, tileMap.cells.length));
      ev.preventDefault();
    } else if (key === "2") {
      setOrbitPreset(1);
      setStatus(formatStatus(selected, ballCell, tileMap, orbit, pathText, lastMoveText, tileMap.cells.length));
      ev.preventDefault();
    } else if (key === "3") {
      setOrbitPreset(2);
      setStatus(formatStatus(selected, ballCell, tileMap, orbit, pathText, lastMoveText, tileMap.cells.length));
      ev.preventDefault();
    } else if (key === "c") {
      clearSelection();
      ev.preventDefault();
    }
  });

  setStatus(formatStatus(selected, ballCell, tileMap, orbit, pathText, lastMoveText, tileMap.cells.length));

  let lastFrameTimeMs = null;
  // 毎 frame で Space.update() を 1 回呼び、node / shape の補間を同じ入口から進める
  // そのあと HUD と描画を行い、状態更新と見た目の順番を揃える
  startLoop((timeMs) => {
    const deltaMs = lastFrameTimeMs === null ? 0 : Math.max(0, timeMs - lastFrameTimeMs);
    lastFrameTimeMs = timeMs;
    space.update(deltaMs);
    updateGuide(message, selected, ballCell, tileMap, orbit, lastMoveText, pathText);
    setStatus(formatStatus(selected, ballCell, tileMap, orbit, pathText, lastMoveText, tileMap.cells.length));
    screen.clear();
    space.draw(eye);
    message.drawScreen();
    screen.present();
  });
};

bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating screen...",
  clearColor: [0.05, 0.07, 0.12, 1.0]
}, (app) => {
  return start(app);
});
