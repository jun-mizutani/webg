// ---------------------------------------------
// samples/cube4/main.js  2026/04/30
//   cube4
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import GameAudioSynth from "../../webg/GameAudioSynth.js";
import Text from "../../webg/Text.js";

const FONT_FILE = "../../webg/font512.png";
const SAVE_KEY = "samples.cube4.highScore";
const BLOCK_SHAPE_MODES = ["shared_bevel", "lite_bevel"];
let currentBlockShapeMode = "shared_bevel";

const BOARD = {
  width: 6,
  depth: 6,
  height: 10,
  cell: 2.5
};

const BASE_Y = -11.0;
const HUD_STATUS_OPTIONS = {
  anchor: "top-left",
  x: 1,
  y: 0,
  color: [0.98, 0.93, 0.84]
};
const HUD_GUIDE_OPTIONS = {
  anchor: "bottom-left",
  x: 1,
  y: 0,
  color: [0.88, 0.95, 1.0]
};
const GAME_HUD_GRID = {
  cols: 80,
  rows: 32,
  scale: 1.0
};
const GAME_HUD_LEFT = {
  x: 1,
  y: 1
};
const GAME_HUD_RIGHT = {
  x: 64,
  y: 1
};

const PIECES = [
  {
    name: "line",
    color: [0.30, 0.88, 0.96, 1.0],
    cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]]
  },
  {
    name: "square",
    color: [0.98, 0.85, 0.26, 1.0],
    cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]]
  },
  {
    name: "tee",
    color: [0.84, 0.46, 0.98, 1.0],
    cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 0, 1]]
  },
  {
    name: "el",
    color: [0.98, 0.58, 0.24, 1.0],
    cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]]
  },
  {
    name: "zig",
    color: [0.38, 0.94, 0.52, 1.0],
    cells: [[-1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1]]
  },
  {
    name: "tripod",
    color: [0.99, 0.35, 0.44, 1.0],
    cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
  },
  {
    name: "screw",
    color: [0.34, 0.68, 1.0, 1.0],
    cells: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]]
  },
  {
    name: "chair",
    color: [1.0, 0.52, 0.74, 1.0],
    cells: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1]]
  }
];

const LAYER_CLEAR_RATIO = 0.8;
const LAYER_CELL_COUNT = BOARD.width * BOARD.depth;
const LAYER_CLEAR_COUNT = Math.ceil(LAYER_CELL_COUNT * LAYER_CLEAR_RATIO);

let app = null;
let orbit = null;
let audio = null;
let gameHudText = null;
let cube4TouchRoot = null;
let cube4TouchVisible = false;
const blockShapeSources = new Map();

const cloneCells = (cells) => cells.map((cell) => [...cell]);
const colorKey = (color) => color.map((value) => value.toFixed(3)).join(",");
const materialKey = (material = {}) => JSON.stringify({
  ambient: material.ambient ?? 0.22,
  specular: material.specular ?? 1.08,
  power: material.power ?? 30.0,
  emissive: material.emissive ?? 0.0,
  flat_shading: material.flat_shading ?? 0
});

const showStartError = (error) => {
  const existing = document.getElementById("start-error");
  if (existing) existing.remove();
  const panel = document.createElement("pre");
  panel.id = "start-error";
  panel.textContent = `cube4 failed\n${error?.message ?? String(error ?? "")}`;
  Object.assign(panel.style, {
    position: "fixed",
    left: "12px",
    top: "12px",
    margin: "0",
    padding: "12px 14px",
    background: "rgba(30, 18, 22, 0.92)",
    color: "#ffe0e7",
    border: "1px solid rgba(255, 155, 173, 0.55)",
    borderRadius: "10px",
    whiteSpace: "pre-wrap",
    maxWidth: "min(560px, calc(100vw - 24px))",
    zIndex: "50"
  });
  document.body.appendChild(panel);
};

const setShapeColor = (shape, color, material = {}) => {
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color],
    ambient: material.ambient ?? 0.22,
    specular: material.specular ?? 1.08,
    power: material.power ?? 30.0,
    emissive: material.emissive ?? 0.0,
    flat_shading: material.flat_shading ?? 0
  });
};

const createCubeShape = (gpu, color, size = BOARD.cell * 0.90, material = {}) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cube(size, shape.getPrimitiveOptions()));
  shape.endShape();
  setShapeColor(shape, color, material);
  return shape;
};

const validateBeveledBoxParams = (width, height, depth, bevel) => {
  const values = { width, height, depth, bevel };
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) {
      throw new Error(`cube4 beveled box requires finite ${name}`);
    }
  }
  if (width <= 0.0 || height <= 0.0 || depth <= 0.0) {
    throw new Error("cube4 beveled box requires positive width, height, depth");
  }
  if (bevel <= 0.0) {
    throw new Error("cube4 beveled box requires positive bevel");
  }
};

// ベベル付き箱を組み立てる前に、各段階で使う半サイズと内側寸法をまとめて計算する
// ここでは「成立する形状だけを返す」ことを目的にし、値の自動補正は行わない
// 返り値は外周、段差、中央パネルの座標計算で共通利用する基準寸法群
const computeBeveledBoxDims = (width, height, depth, bevel) => {
  // まず入力が有限値かつ正の寸法かを検証し、明らかな設定ミスを先に落とす
  validateBeveledBoxParams(width, height, depth, bevel);

  // 箱全体は中心基準で組み立てるため、各軸の半サイズを最初に求める
  // 以後の座標は ±hx, ±hy, ±hz を外枠として展開する
  const hx = width * 0.5;
  const hy = height * 0.5;
  const hz = depth * 0.5;

  // ベベル量は入力 bevel をそのまま面取り量にせず、既存デザインに合わせて 0.3 倍で使う
  // ただし大きすぎるベベルは中央面や側帯を消してしまうため、箱半サイズに対する上限を設ける
  const maxBevel = Math.min(hx, hy, hz) * 0.45;
  const b = bevel * 0.3;
  if (b > maxBevel) {
    throw new Error(`cube4 beveled box bevel is too large: ${bevel}`);
  }

  // ix / iy / iz は、面取り後に残る外周矩形の半サイズ
  // 中央パネルや側帯は、この矩形を基準にして追加していく
  const ix = hx - b;
  const iy = hy - b;
  const iz = hz - b;

  // panelLift は中央パネルを外周面からどれだけ持ち上げるかを表す
  // 持ち上げ量が大きすぎると、外周ベベルより先に中央パネルが突出して破綻するため検証する
  const panelLift = b * 0.3;
  const maxPanelLift = Math.min(ix, iy, iz) * 0.18;
  if (panelLift > maxPanelLift) {
    throw new Error(`cube4 beveled box panel lift becomes too large: ${panelLift}`);
  }

  // jx / jy / jz は、持ち上げた中央パネルそのものの半サイズ
  // 外周矩形よりさらに内側へ 2*b だけ入れて、段差面を張る余地を確保する
  // ここが 0 以下になると中央パネルが消えるため、その状態は明示的にエラーとする
  const jx = ix - b * 2.0;
  const jy = iy - b * 2.0;
  const jz = iz - b * 2.0;
  if (jx <= 0.0 || jy <= 0.0 || jz <= 0.0) {
    throw new Error("cube4 beveled box inner panel size must stay positive");
  }

  // 返す寸法は、各面の中央パネル、帯面、角面を同じ基準で組み立てるための一式
  return {
    hx, hy, hz,
    b,
    ix, iy, iz,
    panelLift,
    jx, jy, jz
  };
};

// 中央面を少し縮小し、その周囲を細い帯面で囲むだけの簡易ベベル寸法を計算する
// 厚い面取り geometry を作らず、shared vertex と smooth shading で角の反射だけを出したい用途向け
// 返り値の ix / iy / iz は、各面の中央 quad が始まる内側矩形の半サイズ
const computeLiteBevelBoxDims = (width, height, depth, bevel) => {
  validateBeveledBoxParams(width, height, depth, bevel);

  // 外形は通常の cuboid と同じで、まず各軸の半サイズを求める
  const hx = width * 0.5;
  const hy = height * 0.5;
  const hz = depth * 0.5;

  // lite bevel は「面の周囲に残す帯の幅」として使う
  // 帯が広すぎると中央面が消えるため、半サイズの 45% を上限とする
  const inset = bevel * 0.3;
  const maxInset = Math.min(hx, hy, hz) * 0.45;
  if (inset > maxInset) {
    throw new Error(`cube4 lite bevel inset is too large: ${bevel}`);
  }

  // 中央面は外形より inset だけ縮小した矩形として定義する
  const ix = hx - inset;
  const iy = hy - inset;
  const iz = hz - inset;
  if (ix <= 0.0 || iy <= 0.0 || iz <= 0.0) {
    throw new Error("cube4 lite bevel inner face size must stay positive");
  }

  return {
    hx, hy, hz,
    inset,
    ix, iy, iz
  };
};

// 厚めの段差と中央パネルを持つ共有頂点版
// 同じ位置の頂点 index を面の境界で共有し、法線や shading の見え方がどう変わるかを確認できる
// 角まで細かく面分割した重めの比較用形状として残してある
const createSharedBeveledBoxShape = (gpu, width, height, depth, bevel, color, material = {}) => {
  const shape = new Shape(gpu);

  // まず直方体の半サイズを求め、その内側にベベルと中央パネルを収める基準寸法を作る
  // ここでは自動補正せず、成立しない設定は例外として表面化させる
  const { hx, hy, hz, ix, iy, iz, panelLift, jx, jy, jz } = computeBeveledBoxDims(width, height, depth, bevel);

  // 同じ位置の頂点を 1 度だけ登録し、以後は同じ index を再利用する
  // これにより面をまたいで本当に shared vertex を使う形状を試せる
  const vertexMap = new Map();
  const addSharedVertex = (x, y, z) => {
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const index = shape.addVertex(x, y, z) - 1;
    vertexMap.set(key, index);
    return index;
  };

  // 任意の polygon を 1 面として追加する helper
  // 面の向きは入力順に依存させず、面中心と外向き法線の内積で自動補正する
  // 共有頂点版でも面定義の手順は非共有版と同じにし、比較対象をそろえる
  const addFace = (pts) => {
    const n = pts.length;
    const cx = pts.reduce((sum, p) => sum + p[0], 0) / n;
    const cy = pts.reduce((sum, p) => sum + p[1], 0) / n;
    const cz = pts.reduce((sum, p) => sum + p[2], 0) / n;
    const [p0, p1, p2] = pts;
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const outward = nx * cx + ny * cy + nz * cz;
    const ordered = outward >= 0.0 ? pts : [...pts].reverse();
    const indices = [];
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      indices.push(addSharedVertex(p[0], p[1], p[2]));
    }
    shape.addPlane(indices);
  };

  // 1 面ぶんの「外周 + 段差 + 中央パネル」をまとめて追加する helper
  // outerPts はベベル内側の外周、innerPts は少し持ち上げた中央パネル
  // 中央面と段差面を分けて追加することで、箱全体に機械パネルのような陰影を作る
  const addRaisedPanel = (outerPts, innerPts) => {
    // 既存版と同じ段構成を保ったまま、頂点 index だけを共有化する
    // 共有頂点化の有無による法線処理の違いを比較しやすくするため、この面構成自体は変えない
    addFace(innerPts);
    for (let i = 0; i < outerPts.length; i++) {
      const next = (i + 1) % outerPts.length;
      addFace([outerPts[i], outerPts[next], innerPts[next], innerPts[i]]);
    }
  };

  // 6 面それぞれの中央パネルを追加する
  // ここで箱の各面に共通する「少し膨らんだ中央面」を作る
  addRaisedPanel(
    [[-ix, -iy, hz], [ix, -iy, hz], [ix, iy, hz], [-ix, iy, hz]],
    [[-jx, -jy, hz + panelLift], [jx, -jy, hz + panelLift], [jx, jy, hz + panelLift], [-jx, jy, hz + panelLift]]
  );
  addRaisedPanel(
    [[-ix, -iy, -hz], [-ix, iy, -hz], [ix, iy, -hz], [ix, -iy, -hz]],
    [[-jx, -jy, -hz - panelLift], [-jx, jy, -hz - panelLift], [jx, jy, -hz - panelLift], [jx, -jy, -hz - panelLift]]
  );
  addRaisedPanel(
    [[hx, -iy, -iz], [hx, iy, -iz], [hx, iy, iz], [hx, -iy, iz]],
    [[hx + panelLift, -jy, -jz], [hx + panelLift, jy, -jz], [hx + panelLift, jy, jz], [hx + panelLift, -jy, jz]]
  );
  addRaisedPanel(
    [[-hx, -iy, -iz], [-hx, -iy, iz], [-hx, iy, iz], [-hx, iy, -iz]],
    [[-hx - panelLift, -jy, -jz], [-hx - panelLift, -jy, jz], [-hx - panelLift, jy, jz], [-hx - panelLift, jy, -jz]]
  );
  addRaisedPanel(
    [[-ix, hy, -iz], [-ix, hy, iz], [ix, hy, iz], [ix, hy, -iz]],
    [[-jx, hy + panelLift, -jz], [-jx, hy + panelLift, jz], [jx, hy + panelLift, jz], [jx, hy + panelLift, -jz]]
  );
  addRaisedPanel(
    [[-ix, -hy, -iz], [ix, -hy, -iz], [ix, -hy, iz], [-ix, -hy, iz]],
    [[-jx, -hy - panelLift, -jz], [jx, -hy - panelLift, -jz], [jx, -hy - panelLift, jz], [-jx, -hy - panelLift, jz]]
  );

  // 各面の外周をつなぐ 4 辺のベルト面を追加する
  // ここは「中央パネル」でも「角」でもない中間帯で、箱の厚みを見せる役割を持つ
  addFace([[-ix, iy, hz], [ix, iy, hz], [ix, hy, iz], [-ix, hy, iz]]);
  addFace([[-ix, -hy, iz], [ix, -hy, iz], [ix, -iy, hz], [-ix, -iy, hz]]);
  addFace([[-ix, hy, -iz], [ix, hy, -iz], [ix, iy, -hz], [-ix, iy, -hz]]);
  addFace([[-ix, -iy, -hz], [ix, -iy, -hz], [ix, -hy, -iz], [-ix, -hy, -iz]]);

  // 左右方向の側帯を追加する
  // 前後面と左右面のつながりを作り、単なる押し出し箱ではない輪郭を作る
  addFace([[ix, -iy, hz], [ix, iy, hz], [hx, iy, iz], [hx, -iy, iz]]);
  addFace([[-hx, -iy, iz], [-hx, iy, iz], [-ix, iy, hz], [-ix, -iy, hz]]);
  addFace([[-ix, -iy, -hz], [-ix, iy, -hz], [-hx, iy, -iz], [-hx, -iy, -iz]]);
  addFace([[hx, -iy, -iz], [hx, iy, -iz], [ix, iy, -hz], [ix, -iy, -hz]]);

  // 上下面へつながる帯面を追加する
  // ここで天面・底面と側面が滑らかにつながる基礎形状を作る
  addFace([[ix, hy, -iz], [ix, hy, iz], [hx, iy, iz], [hx, iy, -iz]]);
  addFace([[-hx, iy, -iz], [-hx, iy, iz], [-ix, hy, iz], [-ix, hy, -iz]]);
  addFace([[-ix, -hy, -iz], [-ix, -hy, iz], [-hx, -iy, iz], [-hx, -iy, -iz]]);
  addFace([[hx, -iy, -iz], [hx, -iy, iz], [ix, -hy, iz], [ix, -hy, -iz]]);

  // 最後に 8 つの角を三角面で閉じる
  // ベベル箱として破綻なく閉じた多面体にするため、角は三角形で確定させる
  addFace([[ix, iy, hz], [hx, iy, iz], [ix, hy, iz]]);
  addFace([[-ix, iy, hz], [-ix, hy, iz], [-hx, iy, iz]]);
  addFace([[ix, -iy, hz], [ix, -hy, iz], [hx, -iy, iz]]);
  addFace([[-ix, -iy, hz], [-hx, -iy, iz], [-ix, -hy, iz]]);

  addFace([[ix, iy, -hz], [ix, hy, -iz], [hx, iy, -iz]]);
  addFace([[-ix, iy, -hz], [-hx, iy, -iz], [-ix, hy, -iz]]);
  addFace([[ix, -iy, -hz], [hx, -iy, -iz], [ix, -hy, -iz]]);
  addFace([[-ix, -iy, -hz], [-ix, -hy, -iz], [-hx, -iy, -iz]]);

  // ここで shared vertex を含む全頂点・全ポリゴンを GPU バッファへ確定する
  // endShape() 前は shape 内部にまだ構築途中の geometry がある状態
  shape.endShape();
  setShapeColor(shape, color, {
    ...material,
    flat_shading: material.flat_shading ?? 0
  });
  return shape;
};

// 各面の中央 quad を縮小し、周囲を 4 本の細い帯面で囲むだけの簡易ベベル版
// 幾何学的には平面分割に近いが、外周の shared vertex を他面と共有することで
// smooth shading 時に角だけが反射し、軽いベベルが入ったように見せる
const createSharedLiteBevelBoxShape = (gpu, width, height, depth, bevel, color, material = {}) => {
  const shape = new Shape(gpu);
  const { hx, hy, hz, ix, iy, iz } = computeLiteBevelBoxDims(width, height, depth, bevel);

  const vertexMap = new Map();
  const addSharedVertex = (x, y, z) => {
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const index = shape.addVertex(x, y, z) - 1;
    vertexMap.set(key, index);
    return index;
  };

  const addFace = (pts) => {
    const n = pts.length;
    const cx = pts.reduce((sum, p) => sum + p[0], 0) / n;
    const cy = pts.reduce((sum, p) => sum + p[1], 0) / n;
    const cz = pts.reduce((sum, p) => sum + p[2], 0) / n;
    const [p0, p1, p2] = pts;
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const outward = nx * cx + ny * cy + nz * cz;
    const ordered = outward >= 0.0 ? pts : [...pts].reverse();
    const indices = [];
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      indices.push(addSharedVertex(p[0], p[1], p[2]));
    }
    shape.addPlane(indices);
  };

  // 1 面を「中央 1 面 + 周囲 4 面」へ分割する
  // 中央面はその面の法線を保ち、周囲帯は隣接面と頂点を共有して反射を受け持つ
  const addInsetFace = (outer, inner) => {
    addFace(inner);
    for (let i = 0; i < outer.length; i++) {
      const next = (i + 1) % outer.length;
      addFace([outer[i], outer[next], inner[next], inner[i]]);
    }
  };

  addInsetFace(
    [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]],
    [[-ix, -iy, hz], [ix, -iy, hz], [ix, iy, hz], [-ix, iy, hz]]
  );
  addInsetFace(
    [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]],
    [[-ix, -iy, -hz], [-ix, iy, -hz], [ix, iy, -hz], [ix, -iy, -hz]]
  );
  addInsetFace(
    [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]],
    [[hx, -iy, -iz], [hx, iy, -iz], [hx, iy, iz], [hx, -iy, iz]]
  );
  addInsetFace(
    [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]],
    [[-hx, -iy, -iz], [-hx, -iy, iz], [-hx, iy, iz], [-hx, iy, -iz]]
  );
  addInsetFace(
    [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]],
    [[-ix, hy, -iz], [-ix, hy, iz], [ix, hy, iz], [ix, hy, -iz]]
  );
  addInsetFace(
    [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]],
    [[-ix, -hy, -iz], [ix, -hy, -iz], [ix, -hy, iz], [-ix, -hy, iz]]
  );

  shape.endShape();
  setShapeColor(shape, color, {
    ...material,
    flat_shading: material.flat_shading ?? 0
  });
  return shape;
};

const getSharedBlockShapeSource = (gpu, options = {}) => {
  const size = options.size ?? BOARD.cell * 0.90;
  const bevel = options.bevel ?? BOARD.cell * 0.12;
  const shapeKey = `${currentBlockShapeMode}:${size.toFixed(4)}:${bevel.toFixed(4)}`;
  const cached = blockShapeSources.get(shapeKey);
  if (cached) return cached;

  // block slot は色と材質だけを頻繁に切り替える一方、形状そのものはサイズごとに共通である
  // そのため geometry は source shape を 1 回だけ作り、各 slot では instance を使って再利用する
  const shapeFactory = currentBlockShapeMode === "shared_bevel"
    ? createSharedBeveledBoxShape
    : createSharedLiteBevelBoxShape;
  const sourceShape = shapeFactory(
    gpu,
    size,
    size,
    size,
    bevel,
    [1.0, 1.0, 1.0, 1.0],
    {
      ambient: 0.22,
      specular: 1.08,
      power: 30.0,
      emissive: 0.0,
      flat_shading: 0
    }
  );
  blockShapeSources.set(shapeKey, sourceShape);
  return sourceShape;
};

const createCuboidShape = (gpu, width, height, depth, color, material = {}) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(width, height, depth, shape.getPrimitiveOptions()));
  shape.endShape();
  setShapeColor(shape, color, material);
  return shape;
};

const createWireframeLayerWallShape = (gpu, width, height, depth, color, material = {}) => {
  const shape = createCuboidShape(gpu, width, height, depth, color, material);
  shape.setWireframe(true);
  return shape;
};

const createSlot = (space, name, gpu, options = {}, parentNode = null) => {
  const node = space.addNode(parentNode, name);
  // block 表示側では source shape を 1 回だけ作り、各 slot へ instance を配る
  // shape mode 切り替え時は、この source を別方式へ差し替えて比較する
  const sourceShape = getSharedBlockShapeSource(gpu, options);
  const shape = sourceShape.createInstance();
  setShapeColor(shape, options.color ?? [0.9, 0.9, 0.9, 1.0], {
    emissive: 0.5,
    ...(options.material ?? {})
  });
  node.addShape(shape);
  node.hide(true);
  return {
    node,
    shape,
    gpu,
    sourceOptions: {
      size: options.size,
      bevel: options.bevel
    },
    visible: false,
    colorKey: "",
    materialKey: "",
    scale: 1.0,
    color: null,
    material: null
  };
};

const applySlot = (slot, visible, position, color, material = {}, scale = 1.0) => {
  if (!slot) return;
  if (!visible) {
    if (slot.visible) {
      slot.node.hide(true);
      slot.visible = false;
    }
    return;
  }

  slot.node.setPosition(position[0], position[1], position[2]);
  if (slot.scale !== scale) {
    slot.node.setScale(scale);
    slot.scale = scale;
  }

  const nextColorKey = colorKey(color);
  const nextMaterialKey = materialKey(material);
  if (slot.colorKey !== nextColorKey || slot.materialKey !== nextMaterialKey) {
    setShapeColor(slot.shape, color, material);
    slot.colorKey = nextColorKey;
    slot.materialKey = nextMaterialKey;
    slot.color = [...color];
    slot.material = { ...material };
  }

  if (!slot.visible) {
    slot.node.hide(false);
    slot.visible = true;
  }
};

const rebuildSlotShape = (slot) => {
  if (!slot?.node || !slot?.gpu) return;
  const sourceShape = getSharedBlockShapeSource(slot.gpu, slot.sourceOptions ?? {});
  const nextShape = sourceShape.createInstance();
  if (slot.color) {
    setShapeColor(nextShape, slot.color, slot.material ?? {});
  }
  nextShape.hide(!slot.visible);
  slot.node.setShape(nextShape);
  slot.shape = nextShape;
};

const forEachBlockSlot = (runtime, callback) => {
  for (let y = 0; y < runtime.lockedSlots.length; y++) {
    for (let z = 0; z < runtime.lockedSlots[y].length; z++) {
      for (let x = 0; x < runtime.lockedSlots[y][z].length; x++) {
        callback(runtime.lockedSlots[y][z][x]);
      }
    }
  }
  for (let i = 0; i < runtime.activeSlots.length; i++) callback(runtime.activeSlots[i]);
  for (let i = 0; i < runtime.ghostSlots.length; i++) callback(runtime.ghostSlots[i]);
  for (let i = 0; i < runtime.previewSlots.length; i++) callback(runtime.previewSlots[i]);
  if (Array.isArray(runtime.demoGallery)) {
    for (let i = 0; i < runtime.demoGallery.length; i++) {
      const item = runtime.demoGallery[i];
      if (!item?.slots) continue;
      for (let j = 0; j < item.slots.length; j++) callback(item.slots[j]);
    }
  }
};

const cycleBlockShapeMode = (runtime) => {
  const currentIndex = BLOCK_SHAPE_MODES.indexOf(currentBlockShapeMode);
  const nextIndex = (currentIndex + 1) % BLOCK_SHAPE_MODES.length;
  currentBlockShapeMode = BLOCK_SHAPE_MODES[nextIndex];
  forEachBlockSlot(runtime, rebuildSlotShape);
  runtime.dirtyVisuals = true;
  return currentBlockShapeMode;
};

const emptyLayer = () =>
  Array.from({ length: BOARD.depth }, () => Array(BOARD.width).fill(null));

const createBoard = () =>
  Array.from({ length: BOARD.height }, () => emptyLayer());

const hideSlotSet = (slots) => {
  for (let i = 0; i < slots.length; i++) {
    applySlot(slots[i], false);
  }
};

const rotateCell = ([x, y, z], axis) => {
  if (axis === "x") return [x, -z, y];
  if (axis === "y") return [z, y, -x];
  return [-y, x, z];
};

const rotateCells = (cells, axis) => cells.map((cell) => rotateCell(cell, axis));
const rotatePointEuler = (point, yawDeg, pitchDeg, rollDeg) => {
  const yaw = yawDeg * Math.PI / 180.0;
  const pitch = pitchDeg * Math.PI / 180.0;
  const roll = rollDeg * Math.PI / 180.0;
  let [x, y, z] = point;

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];

  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];

  const cz = Math.cos(roll);
  const sz = Math.sin(roll);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];

  return [x, y, z];
};

const getExtents = (cells) => {
  const xs = cells.map((cell) => cell[0]);
  const ys = cells.map((cell) => cell[1]);
  const zs = cells.map((cell) => cell[2]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs)
  };
};

const choosePiece = (bag) => {
  if (bag.length === 0) {
    const next = PIECES.map((piece) => piece);
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    bag.push(...next);
  }
  const def = bag.shift();
  return {
    name: def.name,
    color: [...def.color],
    cells: cloneCells(def.cells)
  };
};

const worldFromGrid = (x, y, z) => [
  (x - (BOARD.width - 1) * 0.5) * BOARD.cell,
  BASE_Y + y * BOARD.cell,
  (z - (BOARD.depth - 1) * 0.5) * BOARD.cell
];

const getOrbitYawDeg = () => Number.isFinite(orbit?.orbit?.yaw) ? orbit.orbit.yaw : 0.0;
const playSe = (name) => {
  try {
    audio?.playSe(name);
  } catch (_) {
    // 最初のユーザー操作前など、まだ audio context が使えない場面は黙って流す
  }
};

const resolveCameraRelativeMove = (direction) => {
  const rad = getOrbitYawDeg() * Math.PI / 180.0;
  const forward = [-Math.sin(rad), -Math.cos(rad)];
  const right = [-forward[1], forward[0]];
  const basis = direction === "up"
    ? forward
    : direction === "down"
      ? [-forward[0], -forward[1]]
      : direction === "right"
        ? right
        : [-right[0], -right[1]];

  if (Math.abs(basis[0]) >= Math.abs(basis[1])) {
    return [basis[0] >= 0.0 ? 1 : -1, 0, 0];
  }
  return [0, 0, basis[1] >= 0.0 ? 1 : -1];
};

const createDemoGallery = (space, gpu) => {
  const boardWidth = BOARD.width * BOARD.cell;
  const boardDepth = BOARD.depth * BOARD.cell;
  const cols = 4;
  const spacingX = boardWidth * 0.34;
  const spacingZ = boardDepth * 0.60;
  const startX = -spacingX * 1.5;
  const positions = [];
  for (let i = 0; i < PIECES.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push([
      startX + col * spacingX,
      BASE_Y + BOARD.height * BOARD.cell * (row === 0 ? 0.70 : 0.46),
      row === 0 ? -spacingZ * 0.34 : spacingZ * 0.18
    ]);
  }

  return PIECES.map((def, index) => {
    const root = space.addNode(null, `demo_root_${def.name}`);
    root.setPosition(...positions[index]);
    const localPositions = [];
    const slots = Array.from({ length: def.cells.length }, (_, cellIndex) =>
      createSlot(space, `demo_${def.name}_${cellIndex}`, gpu, {
        size: BOARD.cell * 0.84,
        bevel: BOARD.cell * 0.10,
        color: def.color,
        material: {
          ambient: 0.22,
          specular: 1.18,
          power: 34.0,
          emissive: 0.0
        }
      }, root)
    );

    const extents = getExtents(def.cells);
    const center = [
      (extents.minX + extents.maxX) * 0.5,
      (extents.minY + extents.maxY) * 0.5,
      (extents.minZ + extents.maxZ) * 0.5
    ];
    for (let i = 0; i < def.cells.length; i++) {
      const [x, y, z] = def.cells[i];
      const localPosition = [
        (x - center[0]) * BOARD.cell * 0.90,
        (y - center[1]) * BOARD.cell * 0.90,
        (z - center[2]) * BOARD.cell * 0.90
      ];
      localPositions.push(localPosition);
      applySlot(
        slots[i],
        true,
        localPosition,
        def.color,
        {
          ambient: 0.22,
          specular: 1.18,
          power: 34.0,
          emissive: 0.0,
          flat_shading: 0
        },
        1.0
      );
    }

    return {
      root,
      slots,
      localPositions,
      baseAngles: {
        yaw: index * 24.0,
        pitch: -14.0 + (index % 3) * 9.0,
        roll: (index % 2 === 0 ? 12.0 : -12.0)
      },
      speed: {
        yaw: (index % 2 === 0 ? 1 : -1) * (3.0 + index * 0.45),
        pitch: (index % 3 === 0 ? -1 : 1) * (1.4 + (index % 4) * 0.35),
        roll: (index % 2 === 0 ? 1 : -1) * (1.9 + (index % 3) * 0.45)
      },
      basePosition: positions[index]
    };
  });
};

const updateDemoGallery = (gallery, visible, timeSec) => {
  if (!Array.isArray(gallery)) return;
  for (let i = 0; i < gallery.length; i++) {
    const item = gallery[i];
    if (!item?.root) continue;
    if (!visible) {
      hideSlotSet(item.slots);
      continue;
    }
    for (let j = 0; j < item.slots.length; j++) {
      const slot = item.slots[j];
      if (!slot.visible) {
        slot.node.hide(false);
        slot.visible = true;
      }
    }
    item.root.setPosition(
      item.basePosition[0],
      item.basePosition[1] + Math.sin(timeSec * (0.8 + i * 0.11)) * 0.45,
      item.basePosition[2]
    );
    item.root.dirty = true;
    const yaw = item.baseAngles.yaw + timeSec * item.speed.yaw;
    const pitch = item.baseAngles.pitch + Math.sin(timeSec * item.speed.pitch + i * 0.7) * 18.0;
    const roll = item.baseAngles.roll + Math.cos(timeSec * item.speed.roll + i * 0.45) * 16.0;
    for (let j = 0; j < item.slots.length; j++) {
      const slot = item.slots[j];
      const rotated = rotatePointEuler(item.localPositions[j], yaw, pitch, roll);
      slot.node.setPosition(rotated[0], rotated[1], rotated[2]);
      slot.node.setAttitude(yaw, pitch, roll);
      slot.node.dirty = true;
    }
  }
};

const makeRuntime = (space, gpu) => {
  const lockedSlots = [];
  for (let y = 0; y < BOARD.height; y++) {
    const layer = [];
    for (let z = 0; z < BOARD.depth; z++) {
      const row = [];
      for (let x = 0; x < BOARD.width; x++) {
        row.push(createSlot(space, `locked_${x}_${y}_${z}`, gpu, {
          size: BOARD.cell * 0.86,
          material: {
            ambient: 0.24,
            specular: 1.02,
            power: 28.0
          }
        }));
      }
      layer.push(row);
    }
    lockedSlots.push(layer);
  }

  const activeSlots = Array.from({ length: 4 }, (_, index) =>
    createSlot(space, `active_${index}`, gpu, {
      size: BOARD.cell * 0.90,
      material: {
        ambient: 0.20,
        specular: 1.28,
        power: 36.0,
        emissive: 0.5
      }
    })
  );

  const ghostSlots = Array.from({ length: 4 }, (_, index) =>
    createSlot(space, `ghost_${index}`, gpu, {
      size: BOARD.cell * 0.78,
      color: [0.35, 0.44, 0.58, 1.0],
      material: {
        ambient: 0.64,
        specular: 0.28,
        power: 8.0
      }
    })
  );

  const previewSlots = Array.from({ length: 4 }, (_, index) =>
    createSlot(space, `preview_${index}`, gpu, {
      size: BOARD.cell * 0.68,
      material: {
        ambient: 0.24,
        specular: 1.16,
        power: 30.0
      }
    })
  );

  return {
    board: createBoard(),
    bag: [],
    active: null,
    next: null,
    score: 0,
    lines: 0,
    level: 1,
    fallTimer: 0.0,
    started: false,
    paused: false,
    gameOver: false,
    highScore: Number(app.loadProgress(SAVE_KEY, 0) ?? 0),
    lockedSlots,
    activeSlots,
    ghostSlots,
    previewSlots,
    demoGallery: createDemoGallery(space, gpu),
    dirtyVisuals: true
  };
};

const getCellsInWorld = (piece) =>
  piece.cells.map(([x, y, z]) => [x + piece.position.x, y + piece.position.y, z + piece.position.z]);

const isInsideBoard = (x, y, z) =>
  x >= 0 && x < BOARD.width && y >= 0 && y < BOARD.height && z >= 0 && z < BOARD.depth;

const canPlace = (runtime, cells) => {
  for (let i = 0; i < cells.length; i++) {
    const [x, y, z] = cells[i];
    if (!isInsideBoard(x, y, z)) return false;
    if (runtime.board[y][z][x] !== null) return false;
  }
  return true;
};

const computeSpawnPosition = (cells) => {
  const extents = getExtents(cells);
  let x = Math.floor((BOARD.width - 1) * 0.5);
  let z = Math.floor((BOARD.depth - 1) * 0.5);
  const y = BOARD.height - 1 - extents.maxY;

  if (x + extents.minX < 0) x -= x + extents.minX;
  if (x + extents.maxX >= BOARD.width) x -= x + extents.maxX - (BOARD.width - 1);
  if (z + extents.minZ < 0) z -= z + extents.minZ;
  if (z + extents.maxZ >= BOARD.depth) z -= z + extents.maxZ - (BOARD.depth - 1);

  return { x, y, z };
};

const updateHighScore = (runtime) => {
  if (runtime.score > runtime.highScore) {
    runtime.highScore = runtime.score;
    app.saveProgress(SAVE_KEY, runtime.highScore);
  }
};

const spawnPiece = (runtime) => {
  runtime.active = runtime.next ?? choosePiece(runtime.bag);
  runtime.next = choosePiece(runtime.bag);
  runtime.active.position = computeSpawnPosition(runtime.active.cells);
  runtime.fallTimer = 0.0;
  runtime.dirtyVisuals = true;

  if (!canPlace(runtime, getCellsInWorld(runtime.active))) {
    runtime.gameOver = true;
    runtime.active = null;
    playSe("gameover");
    app.pushToast("Game Over", { durationMs: 1800 });
  }
};

const restartGame = (runtime) => {
  runtime.board = createBoard();
  runtime.bag = [];
  runtime.active = null;
  runtime.next = null;
  runtime.score = 0;
  runtime.lines = 0;
  runtime.level = 1;
  runtime.fallTimer = 0.0;
  runtime.started = false;
  runtime.paused = false;
  runtime.gameOver = false;
  runtime.dirtyVisuals = true;
  spawnPiece(runtime);
  playSe("countdown");
  app.pushToast("Restarted", { durationMs: 1000 });
};

const beginGame = (runtime) => {
  if (runtime.started || runtime.gameOver) return;
  runtime.started = true;
  runtime.fallTimer = 0.0;
  try {
    audio?.startBgm();
  } catch (_) {
    // user gesture 由来の最初の開始時に鳴れば十分
  }
  playSe("ui_ok");
};

const tryMove = (runtime, dx, dy, dz) => {
  if (!runtime.active || runtime.gameOver) return false;
  const candidate = {
    ...runtime.active.position,
    x: runtime.active.position.x + dx,
    y: runtime.active.position.y + dy,
    z: runtime.active.position.z + dz
  };
  const cells = runtime.active.cells.map(([x, y, z]) => [x + candidate.x, y + candidate.y, z + candidate.z]);
  if (!canPlace(runtime, cells)) return false;
  runtime.active.position = candidate;
  runtime.dirtyVisuals = true;
  return true;
};

const tryRotate = (runtime, axis) => {
  if (!runtime.active || runtime.gameOver) return false;
  const rotated = rotateCells(runtime.active.cells, axis);
  const kicks = [
    [0, 0, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0]
  ];

  for (let i = 0; i < kicks.length; i++) {
    const [dx, dy, dz] = kicks[i];
    const cells = rotated.map(([x, y, z]) => [
      x + runtime.active.position.x + dx,
      y + runtime.active.position.y + dy,
      z + runtime.active.position.z + dz
    ]);
    if (canPlace(runtime, cells)) {
      runtime.active.cells = rotated;
      runtime.active.position.x += dx;
      runtime.active.position.y += dy;
      runtime.active.position.z += dz;
      runtime.dirtyVisuals = true;
      return true;
    }
  }
  return false;
};

const lockPiece = (runtime) => {
  if (!runtime.active) return;
  const worldCells = getCellsInWorld(runtime.active);
  for (let i = 0; i < worldCells.length; i++) {
    const [x, y, z] = worldCells[i];
    runtime.board[y][z][x] = [...runtime.active.color];
  }
  runtime.active = null;

  const preserved = [];
  const clearedLayers = [];
  for (let y = 0; y < BOARD.height; y++) {
    const fillCount = countLayerBlocks(runtime.board[y]);
    if (fillCount >= LAYER_CLEAR_COUNT) {
      clearedLayers.push(fillCount);
    } else {
      preserved.push(runtime.board[y]);
    }
  }

  while (preserved.length < BOARD.height) {
    preserved.push(emptyLayer());
  }
  runtime.board = preserved;

  const cleared = clearedLayers.length;
  if (cleared > 0) {
    runtime.lines += cleared;
    const layerScore = clearedLayers.reduce((sum, fillCount) => sum + scoreForClearedLayer(fillCount), 0);
    const chainBonus = cleared > 1 ? 1.0 + (cleared - 1) * 0.35 : 1.0;
    runtime.score += Math.round(layerScore * chainBonus * runtime.level);
    runtime.level = 1 + Math.floor(runtime.lines / 6);
    playSe("levelup");
    const perfectCount = clearedLayers.filter((fillCount) => fillCount >= LAYER_CELL_COUNT).length;
    const minFill = Math.min(...clearedLayers);
    if (perfectCount === cleared) {
      app.pushToast(`${cleared} perfect layer clear`, { durationMs: 1300 });
    } else {
      app.pushToast(`${cleared} layer clear (${minFill}/${LAYER_CELL_COUNT}+ filled)`, { durationMs: 1300 });
    }
  } else {
    playSe("block");
  }

  updateHighScore(runtime);
  spawnPiece(runtime);
};

const hardDrop = (runtime) => {
  if (!runtime.active || runtime.gameOver) return;
  let steps = 0;
  while (tryMove(runtime, 0, -1, 0)) {
    steps += 1;
  }
  runtime.score += steps * 2;
  updateHighScore(runtime);
  lockPiece(runtime);
};

const computeGhostCells = (runtime) => {
  if (!runtime.active) return [];
  let offset = 0;
  let cells = getCellsInWorld(runtime.active);
  while (true) {
    const next = cells.map(([x, y, z]) => [x, y - 1, z]);
    if (!canPlace(runtime, next)) break;
    cells = next;
    offset += 1;
  }
  return offset > 0 ? cells : [];
};

const countLayerBlocks = (layer) => {
  let count = 0;
  for (let z = 0; z < BOARD.depth; z++) {
    for (let x = 0; x < BOARD.width; x++) {
      if (layer[z][x] !== null) count += 1;
    }
  }
  return count;
};

const scoreForClearedLayer = (fillCount) => {
  if (fillCount >= LAYER_CELL_COUNT) return 520;
  const ratio = (fillCount - LAYER_CLEAR_COUNT) / Math.max(1, LAYER_CELL_COUNT - LAYER_CLEAR_COUNT);
  const clamped = Math.max(0.0, Math.min(1.0, ratio));
  return Math.round(120 + clamped * 180);
};

const renderBoard = (runtime) => {
  for (let y = 0; y < BOARD.height; y++) {
    for (let z = 0; z < BOARD.depth; z++) {
      for (let x = 0; x < BOARD.width; x++) {
        const slot = runtime.lockedSlots[y][z][x];
        const cellColor = runtime.board[y][z][x];
        if (cellColor === null) {
          applySlot(slot, false);
          continue;
        }
        applySlot(
          slot,
          true,
          worldFromGrid(x, y, z),
          cellColor,
        {
          ambient: 0.26,
          specular: 1.00,
          power: 28.0,
          flat_shading: 0
        }
        );
      }
    }
  }

  for (let i = 0; i < runtime.activeSlots.length; i++) {
    applySlot(runtime.activeSlots[i], false);
    applySlot(runtime.ghostSlots[i], false);
  }

  if (runtime.started && runtime.active) {
    const activeCells = getCellsInWorld(runtime.active);
    for (let i = 0; i < activeCells.length; i++) {
      applySlot(
        runtime.activeSlots[i],
        true,
        worldFromGrid(...activeCells[i]),
        runtime.active.color,
        {
          ambient: 0.18,
          specular: 1.32,
          power: 38.0,
          emissive: 0.8,
          flat_shading: 0
        }
      );
    }

    const ghostCells = computeGhostCells(runtime);
    for (let i = 0; i < ghostCells.length; i++) {
      applySlot(
        runtime.ghostSlots[i],
        true,
        worldFromGrid(...ghostCells[i]),
        [0.32, 0.40, 0.54, 1.0],
        {
          ambient: 0.66,
          specular: 0.22,
          power: 8.0,
          flat_shading: 0
        }
      );
    }
  }

  for (let i = 0; i < runtime.previewSlots.length; i++) {
    applySlot(runtime.previewSlots[i], false);
  }

  if (runtime.started && runtime.next) {
    const previewBase = [BOARD.width * BOARD.cell * 0.96, BASE_Y + BOARD.height * BOARD.cell * 0.72, -BOARD.depth * BOARD.cell * 0.82];
    for (let i = 0; i < runtime.next.cells.length; i++) {
      const [x, y, z] = runtime.next.cells[i];
      applySlot(
        runtime.previewSlots[i],
        true,
        [
          previewBase[0] + x * (BOARD.cell * 0.82),
          previewBase[1] + y * (BOARD.cell * 0.82),
          previewBase[2] + z * (BOARD.cell * 0.82)
        ],
        runtime.next.color,
        {
          ambient: 0.22,
          specular: 1.14,
          power: 30.0,
          flat_shading: 0
        }
      );
    }
  }

  runtime.dirtyVisuals = false;
};

const updateHud = (runtime) => {
  // cube4 では Text.js ベースの固定 HUD を常時重ねるため、
  // WebgApp 標準の guide/status は空にして表示領域を競合させない
  app.setStatusLines([], HUD_STATUS_OPTIONS);
  app.setGuideLines([], HUD_GUIDE_OPTIONS);
};

const createDecor = (space, gpu) => {
  const center = worldFromGrid((BOARD.width - 1) * 0.5, 0.0, (BOARD.depth - 1) * 0.5);
  const boardWidth = BOARD.width * BOARD.cell;
  const boardDepth = BOARD.depth * BOARD.cell;
  const boardHeight = BOARD.height * BOARD.cell;
  const wallWidth = boardWidth + BOARD.cell * 0.10;
  const wallDepth = boardDepth + BOARD.cell * 0.10;

  const pedestalNode = space.addNode(null, "pedestal");
  pedestalNode.setPosition(center[0], BASE_Y - BOARD.cell * 0.75, center[2]);
  pedestalNode.addShape(createCuboidShape(
    gpu,
    boardWidth,
    0.4,
    boardDepth,
    [0.2, 0.2, 0.2, 1.0],
    {
      ambient: 0.5,
      specular: 0.5,
      power: 6.0
    }
  ));

  const wallRoot = space.addNode(null, "layer_walls");
  const wallShape = createWireframeLayerWallShape(
    gpu,
    wallWidth,
    BOARD.cell,
    wallDepth,
    [0.40, 0.76, 0.98, 1.0],
    {
      ambient: 0.18,
      specular: 0.12,
      power: 8.0,
      emissive: 0.08
    }
  );
  for (let y = 0; y < BOARD.height; y++) {
    // 各層を 1 セルぶんの高さで囲む
    // ワイヤーフレーム表示にすることで、厚みを持たせずに層境界だけを見せる
    const layerWallNode = space.addNode(wallRoot, `layer_wall_${y}`);
    layerWallNode.setPosition(center[0], BASE_Y + y * BOARD.cell, center[2]);
    layerWallNode.addShape(wallShape);
  }

  const beaconShape = createCubeShape(gpu, [0.96, 0.42, 0.24, 1.0], BOARD.cell * 0.26, {
    ambient: 0.30,
    specular: 1.20,
    power: 110.0,
    emissive: 0.55
  });
  const beaconNode = space.addNode(null, "beacon");
  beaconNode.setPosition(center[0], BASE_Y + boardHeight + 0.8, center[2]);
  beaconNode.addShape(beaconShape);

  return { beaconNode, center, boardHeight };
};

const setupOrbit = () => {
  orbit = app.createOrbitEyeRig({
    target: [0.0, BASE_Y + BOARD.height * BOARD.cell * 0.42, 0.0],
    distance: 43.0,
    yaw: 18.0,
    pitch: -30.0,
    minDistance: 22.0,
    maxDistance: 78.0,
    wheelZoomStep: 1.4,
    orbitKeyMap: {
      left: "_",
      right: "_",
      up: "_",
      down: "_",
      zoomIn: "_",
      zoomOut: "_"
    }
  });
};

const fallIntervalSec = (runtime) => Math.max(0.42, 1.95 - (runtime.level - 1) * 0.12);

// cube4 専用の固定 HUD Text を初期化する
// WebgApp の guide/status は可変 block 配置だが、この sample では
// 左右に固定したゲーム情報を出したいため、別 Text を 1 枚重ねる
const createGameHudText = async (gpu) => {
  const text = new Text(gpu, {
    cols: GAME_HUD_GRID.cols,
    rows: GAME_HUD_GRID.rows
  });
  await text.init(FONT_FILE);
  text.setScale(GAME_HUD_GRID.scale);
  return text;
};

// 1 行の値表示を固定幅へ揃え、HUD 左列を読みやすくする
// label を縦に並べたときに値開始位置が揃うよう、手前を右詰めで整形する
const formatHudMetricLine = (label, value) => `${label.padEnd(9, " ")} ${String(value)}`;

// 現在の盤面に対する各レイヤーの埋まり数を下から順に返す
// HUD 右列ではこの値を高さごとに並べ、どの層が消去閾値へ近いかを見やすくする
const collectLayerFillCounts = (runtime) => {
  const counts = [];
  for (let y = 0; y < BOARD.height; y++) {
    counts.push(countLayerBlocks(runtime.board[y]));
  }
  return counts;
};

// 落下中ブロックの最下セルが、盤面下端から何セル上にあるかを返す
// 0 なら最下セルが最下段にあり、値が大きいほどまだ高い位置にいる
const getActivePieceDistanceFromBottom = (runtime) => {
  if (!runtime.active) return null;
  const cells = getCellsInWorld(runtime.active);
  if (cells.length <= 0) return null;
  let minY = cells[0][1];
  for (let i = 1; i < cells.length; i++) {
    if (cells[i][1] < minY) {
      minY = cells[i][1];
    }
  }
  return minY;
};

// ゲーム進行状態を HUD 左列向けの短い文字列へまとめる
// 開始前、進行中、一時停止、ゲームオーバーを毎フレーム同じ位置へ表示する
const getHudStateLabel = (runtime) => {
  if (runtime.gameOver) return "GAME OVER";
  if (runtime.paused) return "PAUSED";
  if (!runtime.started) return "READY";
  return "PLAY";
};

// 左側の進行情報を Text へ書き込む
// score / level / layer / 距離 / high score / 操作補助を固定位置で積み上げる
const drawHudLeftPanel = (runtime, text) => {
  const leftX = GAME_HUD_LEFT.x;
  let lineY = GAME_HUD_LEFT.y;
  const distance = getActivePieceDistanceFromBottom(runtime);
  const upperCenterX = 30;

  text.shader.setColor(1.0, 0.97, 0.82);
  text.drawText("CUBE4 STATUS", leftX, lineY);
  text.drawText(`Fall sec ${fallIntervalSec(runtime).toFixed(2)}`, upperCenterX, lineY++);

  text.shader.setColor(1.0, 0.97, 0.82);
  text.drawText(formatHudMetricLine("Score", runtime.score), leftX, lineY++);
  text.drawText(formatHudMetricLine("Level", runtime.level), leftX, lineY++);
  text.drawText(formatHudMetricLine("Layer", runtime.lines), leftX, lineY++);
  text.drawText(formatHudMetricLine("DropDist", distance === null ? "--" : distance), leftX, lineY++);
  text.drawText(formatHudMetricLine("HighScore", runtime.highScore), leftX, lineY++);
  text.drawText(formatHudMetricLine("State", getHudStateLabel(runtime)), leftX, lineY++);
  lineY += 11;

  text.shader.setColor(1.0, 0.97, 0.82);
  text.drawText("Move  Arrows", leftX, lineY++);
  text.drawText("Rotate A/S/D", leftX, lineY++);
  text.drawText("Drop  X / Space", leftX, lineY++);
  text.drawText("Restart R", leftX, lineY++);
};

// 右側へ各レイヤーの埋まり数を高さぶん並べて描く
// 上の行ほど高い層になるよう逆順にし、閾値到達層には mark を付ける
const drawHudRightPanel = (runtime, text) => {
  const rightX = GAME_HUD_RIGHT.x;
  let lineY = GAME_HUD_RIGHT.y;
  const fillCounts = collectLayerFillCounts(runtime);

  text.shader.setColor(1.0, 0.97, 0.82);
  text.drawText("LAYER FILL", rightX, lineY++);
  text.drawText(`need ${LAYER_CLEAR_COUNT}/${LAYER_CELL_COUNT}+`, rightX, lineY++);
  lineY += 1;

  for (let y = BOARD.height - 1; y >= 0; y--) {
    const fillCount = fillCounts[y];
    const mark = fillCount >= LAYER_CLEAR_COUNT ? "*" : " ";
    text.shader.setColor(1.0, 0.97, 0.82);
    text.drawText(`${mark} ${String(fillCount).padStart(2, " ")}/${LAYER_CELL_COUNT}`, rightX, lineY++);
  }
};

// 標準 HUD とは別に、固定配置のゲーム HUD を Text で描く
// 毎フレーム画面バッファを消去し、左パネルと右パネルを同じ pass 上へ重ねる
const drawGameHud = (runtime) => {
  if (!gameHudText) return;
  gameHudText.clearScreen();
  drawHudLeftPanel(runtime, gameHudText);
  drawHudRightPanel(runtime, gameHudText);
  gameHudText.drawScreen();
};

// coarse pointer 端末かどうかを sample 側でも判定し、
// touch UI を常時表示する端末と desktop で切り替え表示する端末を分ける
const isCoarsePointerDevice = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(pointer: coarse)").matches;
};

// PC では T キーで touch UI の表示を切り替えられるようにし、
// coarse pointer 端末では常時表示のまま使えるようにする
const updateTouchControlsVisibility = () => {
  if (!cube4TouchRoot) return;
  cube4TouchRoot.style.display = cube4TouchVisible ? "" : "none";
};

// desktop だけで touch ボタン表示を切り替える
// 実機 touch 端末では UI を隠す必要が薄いため、常時表示のまま扱う
const toggleTouchControlsVisibility = () => {
  if (!cube4TouchRoot || isCoarsePointerDevice()) {
    return cube4TouchVisible;
  }
  cube4TouchVisible = !cube4TouchVisible;
  updateTouchControlsVisibility();
  app.pushToast(cube4TouchVisible ? "Touch controls on" : "Touch controls off", {
    durationMs: 900
  });
  return cube4TouchVisible;
};

// keyboard と touch の両方から同じゲーム操作を呼べるように、
// cube4 の 1 ステップ入力をここへ集約する
// touch 側はすべて one-shot action にするため、repeat の有無だけ外から渡せれば十分
const handleGameKey = (runtime, key, options = {}) => {
  const repeat = options.repeat === true;
  if (key === "t" && !repeat) {
    toggleTouchControlsVisibility();
    return;
  }
  if (runtime.gameOver && key !== "r") return;
  if (key === "p" && !repeat) {
    runtime.paused = !runtime.paused;
    playSe(runtime.paused ? "ui_ok" : "ui_move");
    app.pushToast(runtime.paused ? "Paused" : "Resumed", { durationMs: 900 });
    return;
  }
  if (key === "r" && !repeat) {
    restartGame(runtime);
    return;
  }
  if (key === "k" && !repeat) {
    const file = app.takeScreenshot({ prefix: "cube4" });
    playSe("coin");
    app.pushToast(`screenshot: ${file}`, { durationMs: 1400 });
    return;
  }
  if (key === "b" && !repeat) {
    const nextMode = cycleBlockShapeMode(runtime);
    playSe("ui_ok");
    app.pushToast(`block shape: ${nextMode}`, { durationMs: 1000 });
    return;
  }
  if (runtime.paused) return;

  if (key === "arrowleft") {
    beginGame(runtime);
    if (tryMove(runtime, ...resolveCameraRelativeMove("left"))) playSe("ui_move");
  } else if (key === "arrowright") {
    beginGame(runtime);
    if (tryMove(runtime, ...resolveCameraRelativeMove("right"))) playSe("ui_move");
  } else if (key === "arrowup") {
    beginGame(runtime);
    if (tryMove(runtime, ...resolveCameraRelativeMove("up"))) playSe("ui_move");
  } else if (key === "arrowdown") {
    beginGame(runtime);
    if (tryMove(runtime, ...resolveCameraRelativeMove("down"))) playSe("ui_move");
  } else if (key === "a" && !repeat) {
    beginGame(runtime);
    if (tryRotate(runtime, "x")) playSe("piyoon");
  } else if (key === "s" && !repeat) {
    beginGame(runtime);
    if (tryRotate(runtime, "y")) playSe("piyoon");
  } else if (key === "d" && !repeat) {
    beginGame(runtime);
    if (tryRotate(runtime, "z")) playSe("piyoon");
  } else if (key === "space" && !repeat) {
    beginGame(runtime);
    hardDrop(runtime);
  } else if (key === "x") {
    beginGame(runtime);
    if (tryMove(runtime, 0, -1, 0)) {
      runtime.score += 1;
      updateHighScore(runtime);
      playSe("ui_move");
    } else {
      lockPiece(runtime);
    }
  }
};

// coarse pointer 端末向けに cube4 の主要操作を仮想ボタンとして並べる
// このゲームは連続移動より 1 回ごとの離散入力が分かりやすいため、
// 方向移動も回転もすべて action ボタンで統一する
const installTouchControls = (runtime) => {
  const touchRoot = app.input.installTouchControls({
    touchDeviceOnly: false,
    className: "webg-touch-root cube4-touch-root",
    groups: [
      {
        id: "rotate",
        buttons: [
          { key: "a", label: "RX", kind: "action", ariaLabel: "rotate block around x" },
          { key: "s", label: "RY", kind: "action", ariaLabel: "rotate block around y" },
          { key: "d", label: "RZ", kind: "action", ariaLabel: "rotate block around z" },
          { key: "space", label: "⬇", kind: "action", ariaLabel: "hard drop block" }
        ]
      },
      {
        id: "system",
        buttons: [
          { key: "r", label: "R", kind: "action", ariaLabel: "restart game" }
        ]
      },
      {
        id: "move",
        buttons: [
          { key: "arrowup", label: "↑", kind: "action", ariaLabel: "move block forward" },
          { key: "arrowdown", label: "↓", kind: "action", ariaLabel: "move block back" },
          { key: "arrowleft", label: "←", kind: "action", ariaLabel: "move block left" },
          { key: "arrowright", label: "→", kind: "action", ariaLabel: "move block right" }
        ]
      }
    ],
    onAction: ({ key }) => handleGameKey(runtime, String(key).toLowerCase(), { repeat: false })
  });
  if (!touchRoot) return null;

  // 盤面の横幅を残しながら、画面下に 3 列の compact な操作群として並べる
  // 同じ Touch.js でも sample ごとに密度が違うため、cube4 向けに個別寸法を与える
  touchRoot.style.display = "block";
  touchRoot.style.minHeight = "148px";
  touchRoot.style.paddingLeft = "10px";
  touchRoot.style.paddingRight = "10px";
  touchRoot.style.paddingBottom = "16px";
  touchRoot.style.setProperty("--webg-touch-btn-font-size", "18px");
  const groups = touchRoot.querySelectorAll(".webg-touch-group");
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (group.dataset.group === "rotate") {
      group.style.position = "absolute";
      group.style.left = "10px";
      group.style.bottom = "16px";
      group.style.display = "grid";
      group.style.gridTemplateColumns = "repeat(2, 56px)";
      group.style.gridTemplateRows = "repeat(2, 56px)";
      group.style.width = "120px";
    } else if (group.dataset.group === "system") {
      group.style.position = "absolute";
      group.style.left = "50%";
      group.style.bottom = "16px";
      group.style.transform = "translateX(-50%)";
    } else if (group.dataset.group === "move") {
      group.style.position = "absolute";
      group.style.right = "10px";
      group.style.bottom = "16px";
      group.style.display = "grid";
      group.style.gridTemplateColumns = "repeat(2, 56px)";
      group.style.gridTemplateRows = "repeat(2, 56px)";
      group.style.width = "120px";
    }
  }
  const btns = touchRoot.querySelectorAll(".webg-touch-btn");
  for (let i = 0; i < btns.length; i++) {
    const btn = btns[i];
    btn.style.minWidth = "56px";
    btn.style.height = "56px";
    btn.style.background = "rgba(34, 40, 24, 0.72)";
    btn.style.color = "#fff6c8";
    btn.style.borderColor = "rgba(255, 243, 181, 0.72)";
  }
  cube4TouchRoot = touchRoot;
  cube4TouchVisible = isCoarsePointerDevice();
  updateTouchControlsVisibility();
  return touchRoot;
};

const attachInput = (runtime) => {
  app.attachInput({
    onKeyDown: (key, ev) => {
      handleGameKey(runtime, key, { repeat: ev.repeat });
    }
  });
  installTouchControls(runtime);
};

const start = async () => {
  app = new WebgApp({
    document,
    clearColor: [0.3, 0.3, 0.4, 1.0],
    lightPosition: [90.0, 160.0, 120.0, 1.0],
    viewAngle: 52.0,
    projectionFar: 1400.0,
    messageFontTexture: FONT_FILE,
    camera: {
      target: [0.0, BASE_Y + BOARD.height * BOARD.cell * 0.42, 0.0],
      distance: 48.0,
      yaw: 18.0,
      pitch: -30.0
    },
    debugTools: {
      mode: "release",
      system: "cube4",
      source: "samples/cube4/main.js"
    }
  });
  await app.init();
  gameHudText = await createGameHudText(app.getGL());
  audio = new GameAudioSynth();
  audio.setMasterVolume(0.22);
  audio.setSeVolume(0.78);
  audio.setSeReverb(0.14);
  audio.setBgmVolume(0.18);
  audio.setBpm(96);
  audio.setMelody("night_drive");
  audio.setBgmDelay(0.20, 0.18, 0.12);
  audio.setBgmReverb(0.18, 0.26);

  const runtime = makeRuntime(app.space, app.getGL());
  const decor = createDecor(app.space, app.getGL());
  setupOrbit();
  attachInput(runtime);
  spawnPiece(runtime);
  renderBoard(runtime);
  updateHud(runtime);

  app.start({
    onUpdate: ({ deltaSec }) => {
      orbit.update(deltaSec);
      updateDemoGallery(runtime.demoGallery, !runtime.started, app.runtimeElapsedSec);
      decor.beaconNode.rotateY(36.0 * deltaSec);
      decor.beaconNode.setPosition(
        decor.center[0],
        BASE_Y + decor.boardHeight + 0.8 + Math.sin(app.runtimeElapsedSec * 1.8) * 0.32,
        decor.center[2]
      );

      if (runtime.started && !runtime.paused && !runtime.gameOver && runtime.active) {
        runtime.fallTimer += deltaSec;
        if (runtime.fallTimer >= fallIntervalSec(runtime)) {
          runtime.fallTimer = 0.0;
          if (!tryMove(runtime, 0, -1, 0)) {
            lockPiece(runtime);
          }
        }
      }

      if (runtime.dirtyVisuals) {
        renderBoard(runtime);
      }
      updateHud(runtime);
    },
    onAfterHud: () => {
      drawGameHud(runtime);
    }
  });
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("cube4 failed:", error);
    app?.showErrorPanel?.(error, {
      title: "cube4 failed",
      id: "start-error",
      background: "rgba(28, 18, 20, 0.92)"
    });
    if (!app) {
      showStartError(error);
    }
  });
});
