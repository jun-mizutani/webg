// ---------------------------------------------
// samples/compute_shadow_map/main.js  2026/07/25
//   Directional shadow map verification sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js?v=20260615_frame_timing1";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Skeleton from "../../webg/Skeleton.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import Diagnostics from "../../webg/Diagnostics.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";

const LIGHT_DIRECTION = [0.55, -1.0, 0.38];
const SHADOW_MAP_SIZE = 1024;
const SHADOW_VIEW_MODES = Object.freeze(["lighting", "shadow", "albedo", "normal", "depth"]);
const FIXED_LIGHT_OPTIONS = Object.freeze({
  target: [0, -0.5, -1],
  distance: 35,
  halfWidth: 21,
  halfHeight: 18,
  near: 1,
  far: 75
});
const FRUSTUM_FIT_OPTIONS = Object.freeze({
  fitFar: 36,
  xyPadding: 0.8,
  depthPadding: 4.0,
  minHalfExtent: 1.0,
  minNear: 0.2,
  texelSnap: true
});
let app = null;
let palette = null;
let lastHelpText = "";
let lastHelpUpdateMs = 0;

// 操作説明とFrameTimerの英語表示行を同じHelp panelへまとめる
// timestamp-query非対応時もFrameTimer自身のunavailable表示を使い、0 msと誤認させない
function buildHelpLines() {
  const state = app?.computeShadowState;
  const light = state?.activeLight;
  const lightBox = (
    light
    && Number.isFinite(light.halfWidth)
    && Number.isFinite(light.halfHeight)
    && Number.isFinite(light.near)
    && Number.isFinite(light.far)
  )
    ? `${light.halfWidth.toFixed(1)} x ${light.halfHeight.toFixed(1)} / near ${light.near.toFixed(1)} far ${light.far.toFixed(1)}`
    : "--";
  return [
    "Directional shadow map",
    "CommandPalette: double tap canvas or press /",
    "Drag or Arrow keys: orbit camera",
    "Use palette controls to inspect shadow map evaluation",
    "",
    `Mode: ${state?.fitMode ?? "--"} / fit far: ${state ? state.fitFar.toFixed(1) : "--"}`,
    `View: ${state?.view ?? "--"} / bias: ${state ? state.bias.toFixed(4) : "--"}`,
    `PCF: ${state ? state.pcfRadius : "--"} / motion: ${state?.paused ? "PAUSE" : "RUN"}`,
    `Light Box: ${lightBox}`,
    ...(app?.getFrameTimingLines?.() ?? [])
  ];
}

// GPU readbackの移動平均が変化したときだけ既存Help panelの本文を更新する
// 呼び出し側で0.5秒間隔に制限し、毎frameのDOM再構築を避ける
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("computeShadowMapHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) return;
  app.updateOverlayPanel("computeShadowMapHelp", { lines });
  lastHelpText = nextText;
}

// Primitive assetを通常Shapeへ変換し、ShadowMapPassとGeometryBufferPassで共有する
function createPrimitiveShape(gpu, factory) {
  if (typeof factory !== "function") {
    throw new Error("createPrimitiveShape requires a primitive factory");
  }
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(factory(shape.getPrimitiveOptions()));
  shape.endShape();
  return shape;
}

// NodeへShapeとmaterial colorを設定し、camera passとlight passが同じscene graphを読む
function addObject(name, shape, position, color, scale = 1) {
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.setScale(scale);
  shape.shaderParameter("color", color);
  shape.shaderParameter("specular", 0.35);
  shape.shaderParameter("roughness", 0.60);
  shape.shaderParameter("metallic", 0.0);
  shape.shaderParameter("emissive", 0.0);
  node.addShape(shape);
  return node;
}

// 5本のboneで曲がる円柱を作り、通常描画とshadow depthが同じpaletteを使うことを確認する
// 長さ方向の隣接boneを線形blendし、関節境界だけが折れる形ではなく連続した曲面にする
function createSkinnedCaster(gpu) {
  const shape = new Shape(gpu);
  shape.setAutoCalcNormals(true);
  shape.deferAltVertexSync = true;
  const skeleton = new Skeleton();
  shape.setSkeleton(skeleton);
  const boneCount = 5;
  const bones = [];
  let parent = null;
  const length = 7;
  const halfLength = length * 0.5;
  const boneStep = length / (boneCount - 1);
  for (let index = 0; index < boneCount; index += 1) {
    const bone = skeleton.addBone(parent, `shadow-caster-${index}`);
    bone.setRestPosition(0, index === 0 ? -halfLength : boneStep, 0);
    bones.push(bone);
    parent = bone;
  }
  skeleton.bindRestPose();
  skeleton.setBoneOrder(bones.map((bone) => bone.name));

  const rows = 28;
  const segments = 20;
  const ringStride = segments + 1;
  const radius = 0.62;
  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows;
    const y = -halfLength + t * length;
    const bonePosition = t * (boneCount - 1);
    const bone0 = Math.min(Math.floor(bonePosition), boneCount - 1);
    const bone1 = Math.min(bone0 + 1, boneCount - 1);
    const weight1 = bone1 === bone0 ? 0 : bonePosition - bone0;
    const weight0 = 1 - weight1;
    let firstVertex = -1;
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const angle = u * Math.PI * 2;
      const vertex = shape.addVertexUV(
        Math.cos(angle) * radius,
        y,
        -Math.sin(angle) * radius,
        u,
        t
      ) - 1;
      shape.addVertexWeight(vertex, bone0, weight0);
      if (bone1 !== bone0) {
        shape.addVertexWeight(vertex, bone1, weight1);
      }
      if (segment === 0) {
        firstVertex = vertex;
      } else if (segment === segments) {
        shape.altVertices.push(firstVertex, vertex);
      }
    }
  }
  for (let row = 0; row < rows; row += 1) {
    const current = row * ringStride;
    const next = (row + 1) * ringStride;
    for (let segment = 0; segment < segments; segment += 1) {
      const following = segment + 1;
      shape.addTriangle(current + segment, current + following, next + segment);
      shape.addTriangle(current + following, next + following, next + segment);
    }
  }

  // 端面は側面と頂点を分け、円筒側面のsmooth normalを平面側へ混ぜない
  // 各端面の全頂点を対応する端のboneへ固定し、曲げても側面端部から分離させない
  const bottomCenter = shape.addVertexUV(0, -halfLength, 0, 0.5, 0.5) - 1;
  const topCenter = shape.addVertexUV(0, halfLength, 0, 0.5, 0.5) - 1;
  shape.addVertexWeight(bottomCenter, 0, 1);
  shape.addVertexWeight(topCenter, boneCount - 1, 1);
  const bottomRing = [];
  const topRing = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const angle = segment / segments * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = -Math.sin(angle) * radius;
    const u = x / (radius * 2) + 0.5;
    const v = z / (radius * 2) + 0.5;
    const bottom = shape.addVertexUV(x, -halfLength, z, u, v) - 1;
    const top = shape.addVertexUV(x, halfLength, z, u, v) - 1;
    shape.addVertexWeight(bottom, 0, 1);
    shape.addVertexWeight(top, boneCount - 1, 1);
    bottomRing.push(bottom);
    topRing.push(top);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const following = (segment + 1) % segments;
    shape.addTriangle(bottomCenter, bottomRing[following], bottomRing[segment]);
    shape.addTriangle(topCenter, topRing[segment], topRing[following]);
  }
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    color: [0.18, 0.78, 0.48, 1],
    has_bone: 1,
    ambient: 0.18,
    specular: 0.72,
    power: 48,
    roughness: 0.32,
    metallic: 0.0,
    emissive: 0.0
  });
  return { shape, bones };
}

// 長い影、接触影、高さの異なる影、bone変形する影を一画面で確認できるsceneを作る
function createScene() {
  const gpu = app.getGPU();
  const cuboid = (x, y, z) => createPrimitiveShape(
    gpu,
    (options) => Primitive.cuboid(x, y, z, options)
  );
  const sphere = createPrimitiveShape(
    gpu,
    (options) => Primitive.sphere(1, 32, 20, options)
  );
  addObject("floor", cuboid(34, 0.8, 28), [0, -3.4, 0], [0.52, 0.56, 0.60, 1]);
  addObject("back-platform", cuboid(13, 1.2, 8), [6.5, -1.8, -6], [0.30, 0.38, 0.48, 1]);
  addObject("red-block", cuboid(3.2, 6.5, 3.2), [-7, 0.1, -2], [0.92, 0.28, 0.12, 1]);
  addObject("gold-block", cuboid(4.6, 3.2, 4.6), [5.5, -1.4, -5.5], [0.92, 0.64, 0.15, 1]);
  addObject("blue-sphere", sphere, [0, -0.7, 2.5], [0.12, 0.48, 0.92, 1], 2.4);
  const skinned = createSkinnedCaster(gpu);
  const moving = addObject(
    "moving-skinned-cylinder",
    skinned.shape,
    [6.5, 1.2, 4.5],
    [0.18, 0.78, 0.48, 1]
  );
  // 円柱の長軸を横へ倒し、移動、Node回転、bone曲げによる影の変化を見比べやすくする
  moving.rotateZ(90);
  return {
    movingCaster: moving,
    skinBones: skinned.bones
  };
}

// keyboardとtouch buttonの共通actionを一箇所で処理し、操作経路でparameter差を作らない
function applyAction(state, key) {
  if (key === "v") {
    state.view = SHADOW_VIEW_MODES[
      (SHADOW_VIEW_MODES.indexOf(state.view) + 1) % SHADOW_VIEW_MODES.length
    ];
  } else if (key === "1") {
    state.bias = Math.max(0, state.bias - 0.00025);
  } else if (key === "2") {
    state.bias = Math.min(0.01, state.bias + 0.00025);
  } else if (key === "3") {
    state.pcfRadius = (state.pcfRadius + 1) % 3;
  } else if (key === "f") {
    state.fitMode = state.fitMode === "fixed" ? "frustum-fit" : "fixed";
  } else if (key === " ") {
    state.paused = !state.paused;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "compute_shadow_map",
      source: "samples/compute_shadow_map/main.js"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "compute_shadow_map failed",
      id: "start-error"
    }));
    console.error("compute_shadow_map failed:", err);
  });
});

// light depth、camera G-buffer、shadow evaluation、canvas copyの4段階を接続する
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    frameTiming: true,
    clearColor: [0.025, 0.035, 0.05, 1],
    viewAngle: 52,
    projectionFar: 120,
    messageFontTexture: "../../webg/font512.png",
    camera: { target: [0, -0.5, -1], distance: 33, yaw: 28, pitch: -18 },
    debugTools: {
      mode: "release",
      system: "compute_shadow_map",
      source: "samples/compute_shadow_map/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computeShadowMapHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");
  const orbit = app.createOrbitEyeRig({
    target: [0, -0.5, -1],
    distance: 33,
    yaw: 28,
    pitch: -18,
    minDistance: 18,
    maxDistance: 58,
    wheelZoomStep: 1
  });
  const pipeline = new ComputeEffectPipeline(app.getGPU(), {
    label: "directional-shadow",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    shadowMapSize: SHADOW_MAP_SIZE,
    lightDirection: LIGHT_DIRECTION,
    lightTarget: FIXED_LIGHT_OPTIONS.target,
    lightDistance: FIXED_LIGHT_OPTIONS.distance,
    lightHalfWidth: FIXED_LIGHT_OPTIONS.halfWidth,
    lightHalfHeight: FIXED_LIGHT_OPTIONS.halfHeight,
    lightNear: FIXED_LIGHT_OPTIONS.near,
    lightFar: FIXED_LIGHT_OPTIONS.far,
    lighting: {
      ambient: 0.20,
      directionalIntensity: 1.0
    }
  });
  await pipeline.ready;
  const copyPass = new FullscreenPass(app.getGPU(), {
    targetFormat: app.getGPU().format
  });
  await copyPass.init();

  const scene = createScene();
  const state = {
    fitMode: "fixed",
    fitFar: FRUSTUM_FIT_OPTIONS.fitFar,
    // pipeline初期化時にFIXED_LIGHT_OPTIONSから生成済みのlightを参照します。
    // 初回frame前からHelp Panelへ実際のshadow volumeを表示し、別の推測値を複製しません。
    activeLight: pipeline.currentShadowLight,
    view: "composite",
    bias: 0.0015,
    normalBias: 0.003,
    pcfRadius: 1,
    paused: false,
    time: 0
  };
  app.computeShadowState = state;

  // 操作変更後の表示と状態を現在の入力と実行状態に合わせて更新する
  const refreshAfterControlChange = () => {
    palette?.render();
    updateHelpPanel();
    app.requestRender();
  };

  // 操作パレットを生成し、後続処理で利用できる状態にする
  const createPalette = () => {
    palette = new CommandPalette({
      document,
      container: document.body,
      viewport: app.screen.canvas,
      title: "Shadow Map",
      pageRows: 5,
      closeOnCommand: false,
      onChange: (id, value) => {
        if (id === "fitMode") state.fitMode = value;
        else if (id === "fitFar") state.fitFar = value;
        else if (id === "view") state.view = value;
        else if (id === "bias") state.bias = value;
        else if (id === "pcf") state.pcfRadius = value;
        else if (id === "paused") state.paused = value;
        refreshAfterControlChange();
      },
      commands: [
        // 1ページ目
        { type: "toggle", id: "paused", label: "Pause", detail: "caster", value: () => state.paused },
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "select", id: "fitMode", label: "Shadow Fit", value: () => state.fitMode, options: [
          { value: "fixed", label: "fixed" },
          { value: "frustum-fit", label: "frustum-fit" }
        ] },
        { type: "stepper", id: "fitFar", label: "Fit Far", value: () => state.fitFar, min: 6.0, max: 120.0, step: 1.0, decimals: 1, input: true },
        { type: "select", id: "view", label: "View", value: () => state.view, options: SHADOW_VIEW_MODES.map((mode) => ({
          value: mode,
          label: mode
        })) },
        { type: "stepper", id: "bias", label: "Depth Bias", value: () => state.bias, min: 0.0, max: 0.01, step: 0.00025, decimals: 4, input: true },
        // 2ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "pcf", label: "PCF Radius", value: () => state.pcfRadius, min: 0, max: 2, step: 1, decimals: 0, input: true },
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ]
    });
    palette.attachToCanvas(app.screen.canvas, { key: "/" });
    palette.setStyle(getDefaultCommandPaletteCss());
  };

  createPalette();
  refreshAfterControlChange();

  app.attachInput({
    onKeyDown: async (key, event) => {
      if (!event.repeat) {
        applyAction(state, key);
      }
    }
  });
  app.setDiagnosticsStage("runtime");
  app.configureDebugKeyInput();
  app.start({
    onUpdate: ({ deltaSec, screen, timeMs }) => {
      // 前frameでsubmitしたtimestampを非同期readbackへ進め、最新平均をHelp Panelへ反映する
      app.afterGpuSubmit();
      if (timeMs - lastHelpUpdateMs >= 500) {
        updateHelpPanel();
        lastHelpUpdateMs = timeMs;
      }
      if (!state.paused) {
        state.time += deltaSec;
      }
      scene.movingCaster.setPosition(
        6.5 + Math.cos(state.time * 0.75) * 2.5,
        1.2 + Math.sin(state.time * 1.25) * 1.1,
        4.5
      );
      if (!state.paused) {
        scene.movingCaster.rotateX(24 * deltaSec);
        const bend = Math.sin(state.time * 1.35) * 13;
        for (let index = 1; index < scene.skinBones.length; index += 1) {
          scene.skinBones[index].setAttitude(0, 0, bend);
        }
      }
      pipeline.resize(screen.getWidth(), screen.getHeight());
      app.mergeDiagnosticsStats({
        fitMode: state.fitMode,
        fitFar: state.fitFar.toFixed(1),
        view: state.view,
        shadowMap: `${SHADOW_MAP_SIZE}x${SHADOW_MAP_SIZE}`,
        shadowHalfWidth: state.activeLight?.halfWidth?.toFixed?.(2) ?? "--",
        shadowHalfHeight: state.activeLight?.halfHeight?.toFixed?.(2) ?? "--",
        shadowNear: state.activeLight?.near?.toFixed?.(2) ?? "--",
        shadowFar: state.activeLight?.far?.toFixed?.(2) ?? "--",
        bias: state.bias.toFixed(4),
        pcfRadius: state.pcfRadius
      });
      app.updateDebugProbe();
    },
    onBeforeDraw: ({ cameraFrame }) => {
      // 第1段階で光源視点depth、第2段階でcamera視点G-bufferを生成する
      // Render計測は2個のgeometry pass全体を囲み、後段Compute時間とは重複させない
      app.beginGpuTiming();
      pipeline.renderScene(app.space, cameraFrame, app.clearColor, {
        shadowEnabled: true,
        shadow: {
          bias: state.bias,
          normalBias: state.normalBias,
          pcfRadius: state.pcfRadius,
          directional: {
            fitMode: state.fitMode,
            fitFar: state.fitFar,
            xyPadding: FRUSTUM_FIT_OPTIONS.xyPadding,
            depthPadding: FRUSTUM_FIT_OPTIONS.depthPadding,
            minHalfExtent: FRUSTUM_FIT_OPTIONS.minHalfExtent,
            minNear: FRUSTUM_FIT_OPTIONS.minNear,
            texelSnap: FRUSTUM_FIT_OPTIONS.texelSnap
          }
        },
        timestampWrites: app.getGpuRenderTimestampWrites(true, true)
      });
      state.activeLight = pipeline.currentShadowLight;
    },
    onAfterDraw3d: ({ cameraFrame }) => {
      // 第3段階でcamera G-bufferをworld-spaceへ戻し、shadow mapとのdepth比較を行う
      app.getGPU().endPass();
      const finalColor = pipeline.encode(app.getGPU().commandEncoder, {
          cameraFrame,
          shadowEnabled: true,
          ssaoEnabled: false,
          ssrEnabled: false,
          toonEnabled: false,
          dofEnabled: false,
          bloomEnabled: false,
          edgeEnabled: false,
          lightingView: state.view === "composite" ? "lighting" : state.view,
          lighting: {
            ambient: 0.20,
            directionalIntensity: 1.0
          },
          shadow: {
          bias: state.bias,
          normalBias: state.normalBias,
          pcfRadius: state.pcfRadius,
          directional: {
            fitMode: state.fitMode,
            fitFar: state.fitFar,
            xyPadding: FRUSTUM_FIT_OPTIONS.xyPadding,
            depthPadding: FRUSTUM_FIT_OPTIONS.depthPadding,
            minHalfExtent: FRUSTUM_FIT_OPTIONS.minHalfExtent,
            minNear: FRUSTUM_FIT_OPTIONS.minNear,
            texelSnap: FRUSTUM_FIT_OPTIONS.texelSnap
          }
        },
          timestampWrites: app.getGpuTimestampWrites(true, true)
      });
      // timestamp queryを同じcommand encoderへ解決し、screen.present()後にreadbackできる状態へ進める
      app.endGpuTiming(app.getGPU().commandEncoder);

      // 第4段階でCompute結果をcanvasへcopyし、次frame用depth stateを戻す
      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      copyPass.draw(finalColor);
      app.screen.clearDepthBuffer();
    }
  });
}
