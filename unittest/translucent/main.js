// ---------------------------------------------
// unittest/translucent/main.js  2026/05/04
//   frosted glass mask/composite test
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import GlassMaskShader from "../../webg/GlassMaskShader.js";
import FrostedGlassPass from "../../webg/FrostedGlassPass.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import { bootUnitTestApp } from "../shared/UnitTestApp.js";

const SCENE_CLEAR = [0.12, 0.16, 0.20, 1.0];
const GLASS_MATERIAL_ID = "frosted-glass";

const DEFAULT_STATE = {
  view: "composite",
  enabled: true,
  paused: false,
  blurRadius: 2.8,
  blurStrength: 0.92,
  tintStrength: 0.30,
  maskPower: 0.85
};

// 値調整段階: key 操作で増減した値を指定範囲へ収める
// blur や tint の設定が shader 側で扱えない範囲へ出ないようにする
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Shape 分類段階: この Shape が曇りガラス用 mask pass へ送る対象か判定する
// materialId または shader parameter を見ることで、関数名を知らなくても運用側で指定できる
const isGlassShape = (shape) => {
  return shape?.materialId === GLASS_MATERIAL_ID ||
    shape?.shaderParam?.frosted_glass === true ||
    shape?.shaderParam?.frosted_glass === 1;
};

// camera 設定段階: 通常 shader と mask shader の projection matrix を同じ値へそろえる
// scene pass と mask pass で投影がずれると合成位置が合わないため、resize 時にも呼ぶ
const setProjection = (screen, shaders, angle = 48) => {
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 1200.0, fov, screen.getAspect());
  for (let i = 0; i < shaders.length; i++) {
    shaders[i].setProjectionMatrix(proj);
  }
};

// 通常 Shape 作成段階: Primitive asset から SmoothShader 用の Shape を作る
// 背景 object や手前の depth 確認用 object はこの経路で不透明 scene に描く
const createShape = (gpu, asset, color, material = {}) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(asset);
  shape.endShape();
  shape.shaderParameter("has_bone", 0);
  shape.shaderParameter("color", color);
  shape.shaderParameter("ambient", material.ambient ?? 0.34);
  shape.shaderParameter("specular", material.specular ?? 0.70);
  shape.shaderParameter("power", material.power ?? 28.0);
  if (material.emissive) {
    shape.shaderParameter("emissive", 1);
  }
  return shape;
};

// ガラス Shape 作成段階: Primitive asset から mask pass 専用の Shape を作る
// 通常 scene では filter で除外し、mask pass で GlassMaskShader を使って描く
const createGlassShape = (gpu, asset, maskShader, color) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(asset);
  shape.endShape();
  shape.setShader(maskShader);
  shape.setMaterial(GLASS_MATERIAL_ID, {
    frosted_glass: true,
    color
  });
  return shape;
};

// scene 配置段階: Node を作り、位置を設定し、Shape を 1 つ追加する
// unittest の scene 構築を短く保ち、どの object を置いたか読みやすくする
const addNodeWithShape = (space, name, position, shape) => {
  const node = space.addNode(null, name);
  node.setPosition(position[0], position[1], position[2]);
  node.addShape(shape);
  return node;
};

// pass 設定反映段階: UI state に入っている値を FrostedGlassPass の setter へ流す
// key 操作後にこの関数を呼ぶことで status 表示と描画結果を同期させる
const applyFrostedState = (pass, state) => {
  pass.setEnabled(state.enabled);
  pass.setBlurRadius(state.blurRadius);
  pass.setBlurStrength(state.blurStrength);
  pass.setTintStrength(state.tintStrength);
  pass.setMaskPower(state.maskPower);
};

// 起動段階: GPU resource、scene、入力、frame loop を順に準備する
// UnitTestApp から渡された screen と gpu を使い、曇りガラスの最小確認 scene を組み立てる
const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  shader.setLightPosition([32.0, 80.0, 120.0, 1.0]);

  const glassMaskShader = new GlassMaskShader(gpu, {
    targetFormat: gpu.format,
    cullMode: "none"
  });
  await glassMaskShader.init();

  const frosted = new FrostedGlassPass(gpu, {
    sceneFormat: gpu.format,
    canvasFormat: gpu.format,
    blurRadius: DEFAULT_STATE.blurRadius,
    blurStrength: DEFAULT_STATE.blurStrength,
    tintStrength: DEFAULT_STATE.tintStrength,
    maskPower: DEFAULT_STATE.maskPower,
    blurScale: 0.5,
    blurIterations: 2
  });
  await frosted.ready;

  const debugPass = new FullscreenPass(gpu);
  await debugPass.init();

  const state = { ...DEFAULT_STATE };
  applyFrostedState(frosted, state);

  // resize 段階: canvas サイズ変更時に projection と render target サイズを更新する
  setViewportLayout(() => {
    setProjection(screen, [shader, glassMaskShader], 48);
    frosted.resizeToScreen(screen);
  });

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0.0, 4.5, 48.0);
  eye.setAttitude(0.0, -5.5, 0.0);

  const floorShape = createShape(
    gpu,
    Primitive.cuboid(96.0, 2.2, 72.0),
    [0.28, 0.32, 0.36, 1.0],
    { ambient: 0.62, specular: 0.16, power: 10.0 }
  );
  addNodeWithShape(space, "floor", [0.0, -24.0, -26.0], floorShape);

  const backShape = createShape(
    gpu,
    Primitive.cuboid(100.0, 54.0, 2.0),
    [0.90, 0.95, 1.0, 1.0],
    { ambient: 0.84, specular: 0.05, power: 8.0 }
  );
  addNodeWithShape(space, "backdrop", [0.0, 3.0, -58.0], backShape);

  const colorAssets = [
    Primitive.sphere(7.0, 18, 18),
    Primitive.cube(9.0),
    Primitive.donut(8.0, 2.2, 20, 14),
    Primitive.prism(11.0, 4.0, 8),
    Primitive.sphere(5.5, 16, 16)
  ];
  const colorNodes = [
    addNodeWithShape(space, "red_ball", [-28.0, 12.0, -33.0], createShape(gpu, colorAssets[0], [0.96, 0.26, 0.24, 1.0])),
    addNodeWithShape(space, "green_cube", [1.0, 15.0, -37.0], createShape(gpu, colorAssets[1], [0.22, 0.86, 0.45, 1.0])),
    addNodeWithShape(space, "blue_ring", [23.0, 7.0, -26.0], createShape(gpu, colorAssets[2], [0.24, 0.58, 0.96, 1.0])),
    addNodeWithShape(space, "violet_prism", [-10.0, -8.0, -29.0], createShape(gpu, colorAssets[3], [0.78, 0.38, 0.96, 1.0])),
    addNodeWithShape(space, "gold_ball", [21.0, -10.0, -27.0], createShape(gpu, colorAssets[4], [1.0, 0.76, 0.28, 1.0], { specular: 0.95, power: 48.0 }))
  ];

  const glassShape = createGlassShape(
    gpu,
    Primitive.cuboid(60.0, 38.0, 0.8),
    glassMaskShader,
    [0.78, 0.76, 0.68, 0.74]
  );
  const glassNode = addNodeWithShape(space, "frosted_glass", [0.0, 2.0, -24.0], glassShape);
  glassNode.setAttitude(0.0, 0.0, 0.0);

  const frontBarShape = createShape(
    gpu,
    Primitive.cuboid(5.6, 33.0, 3.4),
    [0.08, 0.11, 0.14, 1.0],
    { ambient: 0.48, specular: 0.35, power: 18.0 }
  );
  const frontBar = addNodeWithShape(space, "front_depth_bar", [-15.0, 1.0, -12.0], frontBarShape);

  // 入力段階: debug view と曇りガラス parameter を key 操作で切り替える
  // 値を変更した後は applyFrostedState() で pass へ即時反映する
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === " ") {
      state.paused = !state.paused;
    } else if (key === "v") {
      const views = ["composite", "scene", "blur", "mask"];
      state.view = views[(views.indexOf(state.view) + 1) % views.length];
    } else if (key === "b") {
      state.enabled = !state.enabled;
      applyFrostedState(frosted, state);
    } else if (key === "1") {
      state.blurRadius = clamp(state.blurRadius - 0.35, 0.0, 7.0);
      applyFrostedState(frosted, state);
    } else if (key === "2") {
      state.blurRadius = clamp(state.blurRadius + 0.35, 0.0, 7.0);
      applyFrostedState(frosted, state);
    } else if (key === "3") {
      state.blurStrength = clamp(state.blurStrength - 0.05, 0.0, 1.0);
      applyFrostedState(frosted, state);
    } else if (key === "4") {
      state.blurStrength = clamp(state.blurStrength + 0.05, 0.0, 1.0);
      applyFrostedState(frosted, state);
    } else if (key === "5") {
      state.tintStrength = clamp(state.tintStrength - 0.05, 0.0, 1.0);
      applyFrostedState(frosted, state);
    } else if (key === "6") {
      state.tintStrength = clamp(state.tintStrength + 0.05, 0.0, 1.0);
      applyFrostedState(frosted, state);
    } else if (key === "7") {
      state.maskPower = clamp(state.maskPower - 0.10, 0.25, 3.0);
      applyFrostedState(frosted, state);
    } else if (key === "8") {
      state.maskPower = clamp(state.maskPower + 0.10, 0.25, 3.0);
      applyFrostedState(frosted, state);
    } else if (key === "r") {
      Object.assign(state, DEFAULT_STATE);
      applyFrostedState(frosted, state);
    }
  });

  // frame 描画段階: scene pass、mask pass、composite/debug 表示を毎 frame 実行する
  // ガラス Shape は通常 scene から除外し、mask pass だけに描く
  startLoop(() => {
    if (!state.paused) {
      for (let i = 0; i < colorNodes.length; i++) {
        colorNodes[i].rotateX(0.25 + i * 0.05);
        colorNodes[i].rotateY(0.42 + i * 0.04);
      }
      glassNode.rotateY(0.08);
      frontBar.rotateY(0.18);
    }

    // scene pass: ガラスを除外した不透明 scene を offscreen target へ描く
    frosted.beginScene(screen, SCENE_CLEAR);
    space.draw(eye, {
      filter: ({ shape }) => !isGlassShape(shape)
    });

    // mask pass: scene pass の depth を使い、ガラス Shape の画面領域だけを mask target へ描く
    frosted.beginMask(screen);
    space.draw(eye, {
      filter: ({ shape }) => isGlassShape(shape)
    });

    // 表示段階: composite のほか、scene、blur、mask の中間 target を切り替えて確認する
    if (state.view === "composite") {
      frosted.render(screen, { clearColor: SCENE_CLEAR });
    } else {
      let source = frosted.getSceneTarget();
      if (state.view === "blur") {
        source = frosted.blurPass.render(screen, frosted.getSceneTarget(), {
          iterations: frosted.blurIterations,
          blurRadius: frosted.blurRadius
        });
      } else if (state.view === "mask") {
        source = frosted.getMaskTarget();
      }
      screen.beginPass({
        clearColor: SCENE_CLEAR,
        colorLoadOp: "clear",
        depthView: null
      });
      debugPass.draw(source);
    }

    screen.present();

    setStatus(
      "unittest/translucent\n"
      + `view: ${state.view}\n`
      + `enabled: ${state.enabled ? "on" : "off"}\n`
      + `paused: ${state.paused ? "yes" : "no"}\n`
      + `blurRadius: ${state.blurRadius.toFixed(2)}\n`
      + `blurStrength: ${state.blurStrength.toFixed(2)}\n`
      + `tintStrength: ${state.tintStrength.toFixed(2)}\n`
      + `maskPower: ${state.maskPower.toFixed(2)}\n`
      + "glass is drawn only into mask pass\n"
      + "front dark bar should stay sharp over glass\n"
      + "[space] pause [v] view [b] on/off [r] reset\n"
      + "[1/2] blur radius [3/4] blur mix\n"
      + "[5/6] tint [7/8] mask power"
    );
  });
};

// boot 段階: DOMContentLoaded 後に UnitTestApp を起動し、start() へ制御を渡す
bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating screen...",
  clearColor: SCENE_CLEAR
}, (app) => {
  return start(app);
});
