// ---------------------------------------------
// unittest/detouch_min/main.js  2026/04/10
//   detouch_min sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";

// webgクラスの役割:
// UnitTestApp: Screen 初期化、viewport 追従、status / error 表示を共通化
// Space      : attach / detach 対象の Node 階層を管理
// Primitive  : 軸の棒と先端マーカー、球の最小形状を作る
// Shape      : Primitive から作った形状へ材質を与える
// SmoothShader: 形状の陰影計算

const setProjection = (screen, shader, angle = 52) => {
  // detouch_min は世界座標の飛びを見たいので、やや引いた固定視点向けの投影を使う
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(1.0, 1200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

// 棒と先端ノードの距離を同じ値にそろえ、親切り替え前後の見えを読みやすくする
const ROD_LENGTH = 40.0;

const createRodShape = (gpu, length, radius, color) => {
  const shape = new Shape(gpu);
  // Primitive.prism を細い棒として使い、軸形状の確認に必要な見えだけを残す
  shape.applyPrimitiveAsset(Primitive.prism(length, radius, 14, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    color,
    ambient: 0.4,
    specular: 0.25,
    power: 20.0
  });
  return shape;
};

const createSphereShape = (gpu, radius, color, ambient = 0.38) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.sphere(radius, 18, 12, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    color,
    ambient,
    specular: 0.35,
    power: 24.0
  });
  return shape;
};

const formatVec3 = (vec) => {
  return `${vec[0].toFixed(2)}, ${vec[1].toFixed(2)}, ${vec[2].toFixed(2)}`;
};

const distance3 = (vecA, vecB) => {
  const dx = vecA[0] - vecB[0];
  const dy = vecA[1] - vecB[1];
  const dz = vecA[2] - vecB[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
  // Shape 全体に共通の SmoothShader を設定し、色付きの棒と球だけで状態差を見えるようにする
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  setViewportLayout(() => {
    setProjection(screen, shader, 52);
  });
  shader.setLightPosition([0.0, 120.0, 120.0, 1.0]);

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0, 44, 140);
  eye.setAttitude(0, -12, 0);

  // 左右に同じ構造の回転アームを置き、親変更時の比較対象を明確にする
  const leftBase = space.addNode(null, "leftBase");
  leftBase.setPosition(-48, 0, 0);
  const leftTip = space.addNode(leftBase, "leftTip");
  leftTip.setPosition(0, ROD_LENGTH, 0);

  const rightBase = space.addNode(null, "rightBase");
  rightBase.setPosition(48, 0, 0);
  const rightTip = space.addNode(rightBase, "rightTip");
  rightTip.setPosition(0, ROD_LENGTH, 0);

  leftBase.addShape(createRodShape(gpu, ROD_LENGTH, 1.3, [0.84, 0.28, 0.28, 1.0]));
  rightBase.addShape(createRodShape(gpu, ROD_LENGTH, 1.3, [0.26, 0.76, 0.96, 1.0]));
  leftTip.addShape(createSphereShape(gpu, 3.6, [1.0, 0.88, 0.28, 1.0], 0.42));
  rightTip.addShape(createSphereShape(gpu, 3.6, [1.0, 0.88, 0.28, 1.0], 0.42));

  // 実際に attach / detach 対象となる球は右先端の子から開始する
  const sphere = space.addNode(rightTip, "sphere");
  sphere.setPosition(0, 7, 0);
  sphere.addShape(createSphereShape(gpu, 6.5, [1.0, 0.92, 0.96, 1.0]));

  let lastAction = "idle";
  let lastDelta = 0.0;

  const captureTransition = (label, action) => {
    // 親変更の前後で world 位置を採取し、見た目位置がどれだけ保たれたかを数値で残す
    const before = sphere.getWorldPosition();
    action();
    const after = sphere.getWorldPosition();
    lastAction = label;
    lastDelta = distance3(before, after);
  };

  const resetState = () => {
    // 最小 test として再現しやすいよう、右先端へ戻す初期化経路を持っておく
    captureTransition("reset-to-right", () => {
      if (sphere.parent !== rightTip) {
        sphere.detach();
        sphere.attach(rightTip);
      }
    });
  };

  const exchangeParent = () => {
    // 左右どちらかの先端へ付け替え、attach 時の world 位置保持を確認する
    captureTransition("exchange-left-right", () => {
      if (sphere.parent === leftTip) {
        sphere.detach();
        sphere.attach(rightTip);
      } else {
        sphere.detach();
        sphere.attach(leftTip);
      }
    });
  };

  const detachAttachRight = () => {
    // 一度 parent を null 側へ外す経路も残し、単純な attach / detach の両方を確認する
    captureTransition("toggle-right", () => {
      if (sphere.parent === rightTip) {
        sphere.detach();
      } else {
        sphere.detach();
        sphere.attach(rightTip);
      }
    });
  };

  document.addEventListener("keydown", (event) => {
    // unittest なので操作は最小の 3 つに絞り、何を確認する test かをぶらさない
    const key = event.key.toLowerCase();
    if (key === " ") exchangeParent();
    if (key === "d") detachAttachRight();
    if (key === "r") resetState();
  });

  let phase = 0.0;
  startLoop(() => {
    // 親側ノードだけを回し続け、attach / detach 後も球の見えが継続するかを観察しやすくする
    phase += 0.02;
    leftBase.setAttitude(0, 0, -24 + Math.sin(phase) * 18);
    rightBase.setAttitude(0, 0, 24 - Math.sin(phase * 0.9) * 18);
    sphere.rotateY(2.2);

    screen.clear();
    space.draw(eye);
    screen.present();

    const world = sphere.getWorldPosition();
    const parentName = sphere.parent ? sphere.parent.name : "null";
    // world 位置と最後の遷移差分を常時出し、見た目と数値をその場で付き合わせられるようにする
    setStatus(
      "unittest/detouch_min\n"
      + `parent: ${parentName}\n`
      + `world: ${formatVec3(world)}\n`
      + `last: ${lastAction}\n`
      + `delta: ${lastDelta.toFixed(4)}\n`
      + "[space] exchange  [d] toggle-right  [r] reset"
    );
  });
};

bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating screen...",
  clearColor: [0.02, 0.02, 0.03, 1.0]
}, (app) => {
  return start(app);
});
