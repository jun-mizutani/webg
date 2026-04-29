// ---------------------------------------------
// unittest/vignette/main.js  2026/04/10
//   vignette sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import VignettePass from "../../webg/VignettePass.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";

// webgクラスの役割:
// UnitTestApp  : Screen 初期化、viewport 追従、status / error 表示を共通化
// RenderTarget : 3D scene をいったん offscreen へ描く
// FullscreenPass: raw scene をそのまま canvas へ戻し、vignette との比較に使う
// VignettePass : 周辺減衰を掛ける最小 postprocess を担当する
// Primitive / Shape / SmoothShader : vignette が掛かる元の 3D scene を最小構成で作る

const SCENE_CLEAR = [0.42, 0.46, 0.54, 1.0];
const SPEED = 0.32;
const CENTER_STEP = 0.03;
const STRENGTH_STEP = 0.05;
const RADIUS_STEP = 0.04;
const SOFTNESS_STEP = 0.03;

const TINTS = [
  { label: "black", value: [0.0, 0.0, 0.0, 1.0] },
  { label: "warm", value: [0.46, 0.20, 0.10, 1.0] },
  { label: "cool", value: [0.10, 0.18, 0.40, 1.0] }
];

const DEFAULT_STATE = {
  view: "vignette",
  enabled: true,
  strength: 0.92,
  radius: 0.74,
  softness: 0.42,
  centerX: 0.50,
  centerY: 0.50,
  tintIndex: 0
};

const clamp = (value, min, max) => {
  return Math.max(min, Math.min(max, value));
};

const setProjection = (screen, shader, angle = 52) => {
  // 周辺へ置いた object も一度に見渡せるよう、少し広めの固定投影へそろえる
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 1200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

const createShape = (gpu, asset, color, material = {}) => {
  // unittest では shape ごとの差よりも vignette の掛かり方を見たいので、
  // 材質は見やすい固定値へ寄せる
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(asset);
  shape.endShape();
  shape.shaderParameter("has_bone", 0);
  shape.shaderParameter("color", color);
  shape.shaderParameter("ambient", material.ambient ?? 0.28);
  shape.shaderParameter("specular", material.specular ?? 0.82);
  shape.shaderParameter("power", material.power ?? 34.0);
  if (material.emissive === true) {
    shape.shaderParameter("emissive", 1);
  }
  return shape;
};

const applyVignetteState = (pass, state) => {
  // status 表示と pass 実体がずれないよう、変更後は必ずここへ集約して反映する
  pass.setEnabled(state.enabled);
  pass.setStrength(state.strength);
  pass.setRadius(state.radius);
  pass.setSoftness(state.softness);
  pass.setCenter(state.centerX, state.centerY);
  pass.setTint(...TINTS[state.tintIndex].value);
};

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  shader.setLightPosition([40.0, 90.0, 150.0, 1.0]);

  // scene 自体は普通の 3D 描画で作り、最後だけ offscreen result に vignette を掛ける
  const sceneTarget = screen.createRenderTarget({
    label: "UnitTest:vignette:scene",
    format: gpu.format,
    hasDepth: true
  });
  await sceneTarget.ready;

  const rawScenePass = new FullscreenPass(gpu);
  await rawScenePass.init();
  const vignettePass = new VignettePass(gpu);
  await vignettePass.init();

  const state = { ...DEFAULT_STATE };
  applyVignetteState(vignettePass, state);

  setViewportLayout(() => {
    setProjection(screen, shader, 52);
    sceneTarget.resizeToScreen(screen);
  });

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0.0, 5.0, 86.0);
  eye.setAttitude(0.0, -7.0, 0.0);

  // 中央と周辺に object を置き、vignette の有無で見えの変化を比較しやすくする
  const floorShape = createShape(
    gpu,
    Primitive.cuboid(92.0, 2.2, 56.0),
    [0.50, 0.56, 0.64, 1.0],
    { ambient: 0.60, specular: 0.18, power: 10.0 }
  );
  const backdropShape = createShape(
    gpu,
    Primitive.cuboid(106.0, 64.0, 2.0),
    [0.92, 0.95, 1.00, 1.0],
    { ambient: 0.86, specular: 0.06, power: 8.0 }
  );
  const centerShape = createShape(
    gpu,
    Primitive.sphere(8.5, 18, 18),
    [0.96, 0.82, 0.42, 1.0],
    { ambient: 0.22, specular: 1.0, power: 48.0 }
  );
  const cornerColors = [
    [0.96, 0.36, 0.34, 1.0],
    [0.34, 0.86, 0.54, 1.0],
    [0.34, 0.68, 0.96, 1.0],
    [0.86, 0.48, 0.96, 1.0]
  ];
  const cornerAssets = [
    Primitive.prism(14.0, 4.0, 12),
    Primitive.cube(9.0),
    Primitive.donut(8.0, 2.5, 16, 16),
    Primitive.sphere(7.0, 16, 16)
  ];

  const floorNode = space.addNode(null, "floor");
  floorNode.setPosition(0.0, -22.5, -20.0);
  floorNode.addShape(floorShape);

  const backdropNode = space.addNode(null, "backdrop");
  backdropNode.setPosition(0.0, 2.0, -56.0);
  backdropNode.addShape(backdropShape);

  const centerNode = space.addNode(null, "center");
  centerNode.setPosition(0.0, 4.5, -24.0);
  centerNode.addShape(centerShape);

  const corners = [
    { name: "lt", x: -39.0, y: 24.0, z: -22.0, rx: 0.7, ry: 1.0 },
    { name: "rt", x: 39.0, y: 24.0, z: -22.0, rx: 1.0, ry: 0.8 },
    { name: "lb", x: -39.0, y: -8.5, z: -22.0, rx: 0.8, ry: 1.1 },
    { name: "rb", x: 39.0, y: -8.5, z: -22.0, rx: 1.1, ry: 0.9 }
  ];

  const nodes = [centerNode];
  const rotations = [{ x: 0.58 * SPEED, y: 0.84 * SPEED }];
  for (let i = 0; i < corners.length; i++) {
    const node = space.addNode(null, `corner_${corners[i].name}`);
    node.setPosition(corners[i].x, corners[i].y, corners[i].z);
    node.addShape(createShape(gpu, cornerAssets[i], cornerColors[i]));
    nodes.push(node);
    rotations.push({
      x: corners[i].rx * SPEED,
      y: corners[i].ry * SPEED
    });
  }

  let paused = false;
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === " ") {
      paused = !paused;
    } else if (key === "v") {
      state.view = state.view === "vignette" ? "scene" : "vignette";
    } else if (key === "b") {
      state.enabled = !state.enabled;
      applyVignetteState(vignettePass, state);
    } else if (key === "q") {
      state.strength = clamp(state.strength + STRENGTH_STEP, 0.0, 1.0);
      applyVignetteState(vignettePass, state);
    } else if (key === "a") {
      state.strength = clamp(state.strength - STRENGTH_STEP, 0.0, 1.0);
      applyVignetteState(vignettePass, state);
    } else if (key === "w") {
      state.radius = clamp(state.radius + RADIUS_STEP, 0.15, 1.4);
      applyVignetteState(vignettePass, state);
    } else if (key === "s") {
      state.radius = clamp(state.radius - RADIUS_STEP, 0.15, 1.4);
      applyVignetteState(vignettePass, state);
    } else if (key === "e") {
      state.softness = clamp(state.softness + SOFTNESS_STEP, 0.02, 1.0);
      applyVignetteState(vignettePass, state);
    } else if (key === "d") {
      state.softness = clamp(state.softness - SOFTNESS_STEP, 0.02, 1.0);
      applyVignetteState(vignettePass, state);
    } else if (key === "j") {
      state.centerX = clamp(state.centerX - CENTER_STEP, 0.0, 1.0);
      applyVignetteState(vignettePass, state);
    } else if (key === "l") {
      state.centerX = clamp(state.centerX + CENTER_STEP, 0.0, 1.0);
      applyVignetteState(vignettePass, state);
    } else if (key === "i") {
      state.centerY = clamp(state.centerY - CENTER_STEP, 0.0, 1.0);
      applyVignetteState(vignettePass, state);
    } else if (key === "k") {
      state.centerY = clamp(state.centerY + CENTER_STEP, 0.0, 1.0);
      applyVignetteState(vignettePass, state);
    } else if (key === "c") {
      state.tintIndex = (state.tintIndex + 1) % TINTS.length;
      applyVignetteState(vignettePass, state);
    } else if (key === "r") {
      Object.assign(state, DEFAULT_STATE);
      applyVignetteState(vignettePass, state);
    }
  });

  startLoop(() => {
    if (!paused) {
      // 角と中央の object を少しずつ回し、vignette の掛かる位置で見えが変化することを追いやすくする
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].rotateX(rotations[i].x);
        nodes[i].rotateY(rotations[i].y);
      }
    }

    // まず 3D scene を offscreen target へ描く
    screen.clear(sceneTarget);
    space.draw(eye);

    // 次に raw scene か vignette 合成済み scene のどちらかを canvas へ戻す
    if (state.view === "scene") {
      screen.beginPass({
        clearColor: SCENE_CLEAR,
        colorLoadOp: "clear",
        depthView: null
      });
      rawScenePass.draw(sceneTarget);
    } else {
      vignettePass.render(screen, {
        source: sceneTarget,
        clearColor: SCENE_CLEAR
      });
    }
    screen.present();

    setStatus(
      "unittest/vignette\n"
      + `view: ${state.view}\n`
      + `enabled: ${state.enabled ? "on" : "off"}\n`
      + `paused: ${paused ? "yes" : "no"}\n`
      + `strength: ${state.strength.toFixed(2)}\n`
      + `radius: ${state.radius.toFixed(2)}\n`
      + `softness: ${state.softness.toFixed(2)}\n`
      + `center: ${state.centerX.toFixed(2)}, ${state.centerY.toFixed(2)}\n`
      + `tint: ${TINTS[state.tintIndex].label}\n`
      + "[space] pause [v] raw/fx [b] on/off\n"
      + "[q/a] str [w/s] rad [e/d] soft\n"
      + "[j/l] cx [i/k] cy [c] tint [r] reset"
    );
  });
};

bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating screen...",
  clearColor: SCENE_CLEAR
}, (app) => {
  return start(app);
});
