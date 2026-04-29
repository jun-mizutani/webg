// ---------------------------------------------
// samples/collisions/main.js  2026/04/10
//   collisions sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Screen from "../../webg/Screen.js";
import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import InputController from "../../webg/InputController.js";

const hud = document.getElementById("hud");

const setProjection = (screen, shader, fov = 53) => {
  // 透視投影行列を設定してシェーダへ渡す
  const proj = new Matrix();
  const vfov = screen.getRecommendedFov(fov);
  proj.makeProjectionMatrix(0.1, 1000, vfov, screen.getAspect());
  shader.setProjectionMatrix(proj);
  return proj;
};

const createShape = (gpu, kind, color, scale = 1.0) => {
  // 種別ごとに基本形状を作り、scaleでサイズ調整する
  const s = new Shape(gpu);
  if (kind === "cube") s.applyPrimitiveAsset(Primitive.cube(10 * scale, s.getPrimitiveOptions()));
  else if (kind === "sphere") s.applyPrimitiveAsset(Primitive.sphere(6.5 * scale, 22, 22, s.getPrimitiveOptions()));
  else if (kind === "cylinder") s.applyPrimitiveAsset(Primitive.prism(12 * scale, 0.8 * scale, 40, s.getPrimitiveOptions()));
  else if (kind === "torus") s.applyPrimitiveAsset(Primitive.donut(12 * scale, 2.2 * scale, 28, 28, s.getPrimitiveOptions()));
  else if (kind === "cone") s.applyPrimitiveAsset(Primitive.cone(16 * scale, 6.2 * scale, 22, s.getPrimitiveOptions()));
  else s.applyPrimitiveAsset(Primitive.prism(12 * scale, 5.6 * scale, 12, s.getPrimitiveOptions()));
  s.endShape();
  s.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color]
  });
  return s;
};

const start = async () => {
  // 画面とシェーダの初期化
  const screen = new Screen(document);
  await screen.ready;
  screen.setClearColor([0.07, 0.1, 0.15, 1.0]);

  const shader = new SmoothShader(screen.getGL());
  await shader.init();
  Shape.prototype.shader = shader;
  const applyViewportLayout = () => {
    screen.resize(Math.max(1, Math.floor(window.innerWidth)), Math.max(1, Math.floor(window.innerHeight)));
    setProjection(screen, shader, 55);
  };
  applyViewportLayout();
  window.addEventListener("resize", applyViewportLayout);
  window.addEventListener("orientationchange", applyViewportLayout);
  shader.setLightPosition([140, 260, 210, 1]);

  // シーンとカメラノードを用意
  // カメラは「ワールド原点のベースノード」の子として配置し、
  // ベースの回転のみで原点を中心にオービットさせる
  const space = new Space();
  const camBase = space.addNode(null, "camBase");
  camBase.setPosition(0, 0, 0);
  const eye = space.addNode(camBase, "eye");
  eye.setPosition(0, 0, 74);
  eye.setAttitude(0, 0, 0);
  let orbitYawDeg = 0;
  let orbitPitchDeg = 8;
  const input = new InputController(document);
  // document 全体の text selection を止めないよう、
  // pointerdown の既定抑止は canvas 内だけへ絞る
  input.setPointerPreventDefaultElement(screen.canvas);

  // タッチUIを左右分割にするため、このサンプル専用スタイルを1回だけ注入する
  // 左グループと右グループを画面端へ固定し、片手でも押しやすい配置にする
  const touchStyleId = "collisions-touch-layout-style";
  if (!document.getElementById(touchStyleId)) {
    const style = document.createElement("style");
    style.id = touchStyleId;
    style.textContent = `
      .webg-touch-root.collisions-touch-root {
        justify-content: space-between;
        align-items: flex-end;
      }
      .webg-touch-root.collisions-touch-root .webg-touch-group {
        min-width: 96px;
      }
      .webg-touch-root.collisions-touch-root .webg-touch-group[data-group="camera-left"] {
        justify-content: flex-start;
      }
      .webg-touch-root.collisions-touch-root .webg-touch-group[data-group="camera-right"] {
        justify-content: flex-end;
      }
    `;
    document.head.appendChild(style);
  }

  const updateEyeOrbit = () => {
    // 親ノード回転で eye を原点周りに公転させる
    // eye のローカル前方は常に親回転を継承するため、原点中心を向き続ける
    camBase.setAttitude(orbitYawDeg, orbitPitchDeg, 0);
  };

  // 配置定義: moverは小型化して判定差を見やすくしている
  const defs = [
    { name: "mover", kind: "sphere", basePos: [0, 3, -3], color: [0.26, 0.70, 0.98, 1.0], mover: true, scale: 0.55 },
    { name: "cube-L", kind: "cube", basePos: [-18, 5, 2], color: [0.24, 0.50, 0.92, 1.0] },
    { name: "cube-R", kind: "cube", basePos: [18, -5, 2], color: [0.20, 0.44, 0.86, 1.0] },
    { name: "cone-B", kind: "cone", basePos: [-2, -10, 8], color: [0.30, 0.58, 0.96, 1.0] },
    { name: "cylinder-F", kind: "cylinder", basePos: [0, 2, -6], color: [0.18, 0.38, 0.78, 1.0] },
    { name: "torus-L", kind: "torus", basePos: [-22, 11, -10], color: [0.34, 0.66, 0.98, 1.0], scale: 1.35 }
  ];

  const entries = defs.map((def) => {
    // 定義からノード+Shapeを生成してSpaceへ登録する
    const shape = createShape(screen.getGL(), def.kind, def.color, def.scale ?? 1.0);
    const node = space.addNode(null, def.name);
    node.setPosition(def.basePos[0], def.basePos[1], def.basePos[2]);
    node.addShape(shape);
    return { ...def, node, shape };
  });

  // 細い円柱を斜め固定にして、AABBのみ先行ヒットが出やすい状態を作る
  const cylinder = entries.find((entry) => entry.name === "cylinder-F");
  if (cylinder) {
    cylinder.node.rotateZ(48);
    cylinder.node.rotateY(36);
  }

  const torus = entries.find((entry) => entry.name === "torus-L");
  if (torus) {
    torus.node.rotateX(24);
    torus.node.rotateY(18);
  }

  const cubeL = entries.find((entry) => entry.name === "cube-L");
  const cubeR = entries.find((entry) => entry.name === "cube-R");
  const coneB = entries.find((entry) => entry.name === "cone-B");

  const mover = entries.find((entry) => entry.mover);
  // 初期位置での衝突多発を避けるため、位相をずらして開始する
  let t = Math.PI;

  const getShapeTriangles = (shape) => {
    if (Array.isArray(shape.indicesArray) && shape.indicesArray.length >= 3) {
      return shape.indicesArray;
    }
    if (shape.iObj && shape.iObj.length >= 3) {
      return Array.from(shape.iObj);
    }
    return [];
  };

  const getWorldVertices = (node, shape) => {
    node.setWorldMatrix();
    const src = shape.positionArray ?? [];
    const out = new Array(src.length);
    for (let i = 0; i + 2 < src.length; i += 3) {
      const p = node.worldMatrix.mulVector([src[i], src[i + 1], src[i + 2]]);
      out[i] = p[0];
      out[i + 1] = p[1];
      out[i + 2] = p[2];
    }
    return out;
  };

  const getMoverRadius = () => {
    // moverは球を前提としているので、ローカルAABBから半径を求める
    const box = mover.shape.getBoundingBox();
    const rx = (box.maxx - box.minx) * 0.5;
    const ry = (box.maxy - box.miny) * 0.5;
    const rz = (box.maxz - box.minz) * 0.5;
    return Math.max(rx, ry, rz);
  };

  const sub3 = (vecA, vecB) => [vecA[0] - vecB[0], vecA[1] - vecB[1], vecA[2] - vecB[2]];
  const dot3 = (vecA, vecB) => vecA[0] * vecB[0] + vecA[1] * vecB[1] + vecA[2] * vecB[2];

  const closestPointOnTriangle = (point, triA, triB, triC) => {
    // Real-Time Collision Detection の標準実装
    const ab = sub3(triB, triA);
    const ac = sub3(triC, triA);
    const ap = sub3(point, triA);
    const d1 = dot3(ab, ap);
    const d2 = dot3(ac, ap);
    if (d1 <= 0 && d2 <= 0) return triA;

    const bp = sub3(point, triB);
    const d3 = dot3(ab, bp);
    const d4 = dot3(ac, bp);
    if (d3 >= 0 && d4 <= d3) return triB;

    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      return [triA[0] + ab[0] * v, triA[1] + ab[1] * v, triA[2] + ab[2] * v];
    }

    const cp = sub3(point, triC);
    const d5 = dot3(ab, cp);
    const d6 = dot3(ac, cp);
    if (d6 >= 0 && d5 <= d6) return triC;

    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      return [triA[0] + ac[0] * w, triA[1] + ac[1] * w, triA[2] + ac[2] * w];
    }

    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const bc = sub3(triC, triB);
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      return [triB[0] + bc[0] * w, triB[1] + bc[1] * w, triB[2] + bc[2] * w];
    }

    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    return [
      triA[0] + ab[0] * v + ac[0] * w,
      triA[1] + ab[1] * v + ac[1] * w,
      triA[2] + ab[2] * v + ac[2] * w
    ];
  };

  const sqDistPointTriangle = (point, triA, triB, triC) => {
    const closest = closestPointOnTriangle(point, triA, triB, triC);
    const dx = point[0] - closest[0];
    const dy = point[1] - closest[1];
    const dz = point[2] - closest[2];
    return dx * dx + dy * dy + dz * dz;
  };

  const validateMoverPairBySphereMesh = (pair) => {
    // tri-triの誤判定を抑えるため、mover(球) vs 相手メッシュで再確認する
    const otherNode = pair.nodeA === mover.node ? pair.nodeB : pair.nodeA;
    const otherShape = pair.shapeA === mover.shape ? pair.shapeB : pair.shapeA;
    if (!otherNode || !otherShape) return false;

    mover.node.setWorldMatrix();
    const center = mover.node.getWorldPosition();
    const radius = getMoverRadius();
    const radiusSq = radius * radius;

    const indices = getShapeTriangles(otherShape);
    if (indices.length < 3) return false;
    const wv = getWorldVertices(otherNode, otherShape);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const i0 = indices[i] * 3;
      const i1 = indices[i + 1] * 3;
      const i2 = indices[i + 2] * 3;
      const triA = [wv[i0], wv[i0 + 1], wv[i0 + 2]];
      const triB = [wv[i1], wv[i1 + 1], wv[i1 + 2]];
      const triC = [wv[i2], wv[i2 + 1], wv[i2 + 2]];
      if (sqDistPointTriangle(center, triA, triB, triC) <= radiusSq) {
        return true;
      }
    }
    return false;
  };

  input.attach({
    onKeyDown: (key, ev) => {
      if (key === "arrowleft" || key === "arrowright" || key === "arrowup" || key === "arrowdown") {
        ev.preventDefault();
      }
    },
    onKeyUp: (key, ev) => {
      if (key === "arrowleft" || key === "arrowright" || key === "arrowup" || key === "arrowdown") {
        ev.preventDefault();
      }
    }
  });
  input.installTouchControls({
    touchDeviceOnly: true,
    autoSpread: false,
    className: "webg-touch-root collisions-touch-root",
    // 左手側に 左/上、右手側に 下/右 を置いて、親指の移動量を減らす
    groups: [
      {
        id: "camera-left",
        buttons: [
          { key: "arrowleft", label: "\u2190", kind: "hold", ariaLabel: "camera left" },
          { key: "arrowup", label: "\u2191", kind: "hold", ariaLabel: "camera up" }
        ]
      },
      {
        id: "camera-right",
        buttons: [
          { key: "arrowdown", label: "\u2193", kind: "hold", ariaLabel: "camera down" },
          { key: "arrowright", label: "\u2192", kind: "hold", ariaLabel: "camera right" }
        ]
      }
    ]
  });

  const animateMover = () => {
    // moverをゆっくり動かして衝突判定の差を観察しやすくする
    t += 0.007;
    const x = Math.sin(t) * 20;
    const y = 2.0 + Math.sin(t * 0.57) * 3.2;
    const z = -6 + Math.cos(t * 0.72) * 9.5;
    mover.node.setPosition(x, y, z);
  };

  const setBaseColors = () => {
    // 毎フレーム、ベース色へ戻してから状態色を上書きする
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      entry.shape.updateMaterial({ color: [...entry.color] });
    }
  };

  const filterMoverPairs = (pairs) => {
    const out = [];
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (pair.shapeA === mover.shape || pair.shapeB === mover.shape) {
        out.push(pair);
      }
    }
    return out;
  };

  const getOtherShapeFromMoverPair = (pair) => {
    if (pair.shapeA === mover.shape) return pair.shapeB;
    if (pair.shapeB === mover.shape) return pair.shapeA;
    return null;
  };

  const colorByMoverCollisionState = (moverBroadPairs, moverDetailedPairs) => {
    // moverと他物体を状態で色分けする:
    // 非衝突=青(ベース), AABBのみ=緑, 詳細衝突=赤
    const broadSet = new Set();
    const detailedSet = new Set();
    for (let i = 0; i < moverBroadPairs.length; i++) {
      const shape = getOtherShapeFromMoverPair(moverBroadPairs[i]);
      if (shape) broadSet.add(shape);
    }
    for (let i = 0; i < moverDetailedPairs.length; i++) {
      const shape = getOtherShapeFromMoverPair(moverDetailedPairs[i]);
      if (shape) detailedSet.add(shape);
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (detailedSet.has(entry.shape)) {
        entry.shape.updateMaterial({ color: [1.0, 0.2, 0.2, 1.0] }); // detailed hit: red
      } else if (broadSet.has(entry.shape)) {
        entry.shape.updateMaterial({ color: [0.2, 0.95, 0.2, 1.0] }); // broad only: green
      }
    }

    // mover自体の色も状態で変化させる
    if (moverDetailedPairs.length > 0) {
      mover.shape.updateMaterial({ color: [1.0, 0.2, 0.2, 1.0] });
    } else if (moverBroadPairs.length > 0) {
      mover.shape.updateMaterial({ color: [0.2, 0.95, 0.2, 1.0] });
    }
  };

  const loop = () => {
    // 矢印キー入力をオービット角に反映
    if (input.has("arrowleft")) orbitYawDeg -= 0.8;
    if (input.has("arrowright")) orbitYawDeg += 0.8;
    if (input.has("arrowup")) orbitPitchDeg = Math.min(70, orbitPitchDeg + 0.6);
    if (input.has("arrowdown")) orbitPitchDeg = Math.max(-40, orbitPitchDeg - 0.6);
    updateEyeOrbit();

    animateMover();
    // mover + 複数物体の通常検証モード
    mover.node.rotateY(0.225);
    if (cubeL) cubeL.node.rotateY(0.12);
    if (cubeR) cubeR.node.rotateY(-0.13);
    if (coneB) coneB.node.rotateX(0.11);
    if (cylinder) {
      // 衝突状態を観察しやすいよう、円柱はゆっくり回転させる
      cylinder.node.rotateX(0.03);
    }
    if (torus) {
      torus.node.rotateY(0.09);
      torus.node.rotateX(-0.05);
    }

    // 自動比較: broad(AABB) と detailed(TRI) を同時に計算する
    const broadAll = space.checkCollisions({
      firstHit: false,
      filter: ({ node }) => node !== eye,
      includeHidden: false
    });

    // moverとのペアだけに絞って色判定/統計を行う
    const moverBroadPairs = filterMoverPairs(broadAll);
    // 真の詳細衝突は、broad候補に対して球vsメッシュ距離で直接判定する
    // これにより Space.checkCollisionsDetailed() の取りこぼしを補完する
    const moverDetailedPairs = moverBroadPairs.filter((pair) => validateMoverPairBySphereMesh(pair));

    // 色付け優先度: base(青) -> moverとのAABBのみ(緑) -> moverとの詳細衝突(赤)
    setBaseColors();
    colorByMoverCollisionState(moverBroadPairs, moverDetailedPairs);

    // 描画本体
    screen.clear();
    space.draw(eye);
    screen.present();

    // HUDへモード/統計/対象ペアを表示
    const lines = [
      "collisions sample",
      "Arrow keys: orbit camera",
      "color : bounding-box:green, detailed:red",
    ];
    hud.textContent = lines.join("\n");
    requestAnimationFrame(loop);
  };

  // 初期姿勢を1回反映してからループ開始
  updateEyeOrbit();
  requestAnimationFrame(loop);
};

document.addEventListener("DOMContentLoaded", start);
