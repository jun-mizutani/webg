// ---------------------------------------------
// unittest/raycast/main.js  2026/07/28
//   raycast unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Screen from "../../webg/Screen.js";
import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";

// AI向け注意:
// この unittest は、画面座標 -> NDC -> world ray -> Space.raycast の変換過程を
// 低レイヤーで見せるため、意図的に WebgApp ではなく Screen を直接使う。
// 通常のアプリ構成を作る場合は、まず WebgApp / UnitTestApp の利用を検討する。

// webgクラスの役割:
// Screen : WebGPU初期化とフレーム提示
// Space  : Node階層管理とraycast実行
// Shape  : クリック対象メッシュ生成
// Matrix : 投影/ビュー行列演算
// SmoothShader: 単色ライティング描画

const hud = document.getElementById("hud");

// 投影を受け取り、現在の設定と後続処理へ反映する
const setProjection = (screen, shader, fov = 53) => {
  // 透視投影行列を作り、シェーダへ設定する
  const proj = new Matrix();
  const vfov = screen.getRecommendedFov(fov);
  proj.makeProjectionMatrix(0.1, 1000, vfov, screen.getAspect());
  shader.setProjectionMatrix(proj);
  return proj;
};

// `cssToNdc`は座標または数値を計算し、後続処理で使う結果を返す
const cssToNdc = (canvas, clientX, clientY) => {
  // CSS座標のマウス位置をNDCへ変換する
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
  const y = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;
  return [x, y];
};

// マウスの座標からワールド空間のレイを生成する
const makeRayFromMouse = (canvas, clientX, clientY, eyeNode, proj, view) => {
  // クリック位置からワールド空間レイ（origin, dir）を生成する
  const [nx, ny] = cssToNdc(canvas, clientX, clientY);
  const invVp = proj.clone();
  // projectionは透視成分を持つため、剛体変換専用のmul()ではなく
  // 4×4の全要素を計算するmul_()でVP = P * Vを作る
  invVp.mul_(view);
  invVp.inverse_strict();  // world = inverse(VP) * clip

  // WebGPUのNDC depthは0..1で、Camera Reverse-Zではnear=1、far=0になる
  // OpenGL式のnear=-1、far=1を使わず、共通定義から両端のworld座標を逆投影する
  const near = invVp.mulVector([nx, ny, CAMERA_REVERSE_Z.nearDepth]);
  const far = invVp.mulVector([nx, ny, CAMERA_REVERSE_Z.farDepth]);
  const eyePos = eyeNode.getWorldPosition();
  // 視点位置からfar点へ向かう方向ベクトルを作る
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

// 形状を生成し、後続処理で利用できる状態にする
const createShape = (gpu, kind, color) => {
  // kindに応じて形状を生成し、単色SmoothShader材質を設定する
  const s = new Shape(gpu);
  if (kind === "cube") s.applyPrimitiveAsset(Primitive.cube(11, s.getPrimitiveOptions()));
  else if (kind === "sphere") s.applyPrimitiveAsset(Primitive.sphere(9.0, 20, 20, s.getPrimitiveOptions()));
  else if (kind === "cone") s.applyPrimitiveAsset(Primitive.cone(15.5, 7.8, 20, s.getPrimitiveOptions()));
  else s.applyPrimitiveAsset(Primitive.prism(17, 7.0, 10, s.getPrimitiveOptions()));
  s.endShape();
  s.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color]
  });
  return s;
};

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
const start = async () => {
  // Screen/Shader/Spaceを初期化する
  const screen = new Screen(document);
  await screen.ready;
  screen.setClearColor([0.08, 0.11, 0.17, 1.0]);

  const shader = new SmoothShader(screen.getGPU());
  await shader.init();
  Shape.prototype.shader = shader;
  let proj = null;
  // `viewport`の配置を対象の状態または描画設定へ反映する
  const applyViewportLayout = () => {
    screen.resize(Math.max(1, Math.floor(window.innerWidth)), Math.max(1, Math.floor(window.innerHeight)));
    proj = setProjection(screen, shader, 52);
  };
  applyViewportLayout();
  window.addEventListener("resize", applyViewportLayout);
  window.addEventListener("orientationchange", applyViewportLayout);
  shader.setLightPosition([150, 240, 220, 1]);

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0, 14, 45);
  eye.rotateX(-9);

  // レイ判定対象オブジェクト定義
  const specs = [
    { name: "cube-0", kind: "cube", pos: [-16, 0, -18], color: [0.28, 0.55, 0.94, 1.0] },
    { name: "sphere-1", kind: "sphere", pos: [0, 10, -25], color: [0.32, 0.86, 0.66, 1.0] },
    { name: "cone-2", kind: "cone", pos: [16, 0, -22], color: [0.94, 0.56, 0.36, 1.0] },
    { name: "prism-3", kind: "prism", pos: [0, -1, -10], color: [0.86, 0.78, 0.34, 1.0] }
  ];

  const entries = specs.map((spec) => {
    // spec定義からNode+Shape実体を作る
    const shape = createShape(screen.getGPU(), spec.kind, spec.color);
    const node = space.addNode(null, spec.name);
    node.setPosition(spec.pos[0], spec.pos[1], spec.pos[2]);
    node.addShape(shape);
    return { ...spec, node, shape };
  });

  let selected = null;
  let lastRayInfo = "";

  // 選択状態を対象の状態または描画設定へ反映する
  const applySelection = (hit) => {
    // ヒットしたshapeだけ赤で強調し、他は元色へ戻す
    selected = hit;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const base = e.color;
      if (hit && hit.shape === e.shape) {
        e.shape.updateMaterial({ color: [1.0, 0.18, 0.2, 1.0] });
      } else {
        e.shape.updateMaterial({ color: [...base] });
      }
    }
  };

  screen.canvas.addEventListener("click", (ev) => {
    // クリック時にレイキャストして最初のヒットを記録する
    eye.setWorldMatrix();
    const view = new Matrix();
    view.makeView(eye.worldMatrix);

    const ray = makeRayFromMouse(screen.canvas, ev.clientX, ev.clientY, eye, proj, view);

    const hit = space.raycast(ray.origin, ray.dir, {
      firstHit: true,
      filter: ({ node, shape }) => {
        // カメラ自身や非表示shapeは判定対象から除外する
        return !shape.isHidden && node !== eye;
      }
    });

    applySelection(hit);
    lastRayInfo = `ndc=(${ray.ndc[0].toFixed(3)}, ${ray.ndc[1].toFixed(3)})`;
  });

  // `loop`は処理周期の開始または終了に必要な状態を更新する
  const loop = () => {
    // オブジェクトを回転しながら描画し、HUDへ判定結果を表示する
    entries[0].node.rotateY(0.35);
    entries[1].node.rotateX(0.45);
    entries[1].node.setPosition(0, 10 + Math.sin(performance.now() * 0.0012) * 2.8, -25);
    entries[2].node.rotateZ(0.42);
    entries[3].node.rotateY(-0.32);

    screen.clear();
    space.draw(eye);
    screen.present();

    if (selected) {
      // ヒット情報をHUDに表示する
      hud.textContent = [
        "unittest/raycast",
        "click object to select",
        `hit node: ${selected.node.name}`,
        `distance t: ${selected.t.toFixed(3)}`,
        `point: ${selected.point.map((v) => v.toFixed(2)).join(", ")}`,
        lastRayInfo
      ].join("\n");
    } else {
      // 未ヒット時もNDC情報だけは残して表示する
      hud.textContent = [
        "unittest/raycast",
        "click object to select",
        "hit node: (none)",
        "distance t: -",
        "point: -",
        lastRayInfo
      ].join("\n");
    }

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
};

document.addEventListener("DOMContentLoaded", start);
