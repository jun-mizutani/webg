// ---------------------------------------------
// samples/compute_ssao_gbuffer/main.js  2026/07/25
//   Compute Shader G-buffer ambient occlusion sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Skeleton from "../../webg/Skeleton.js";
import Texture from "../../webg/Texture.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import Diagnostics from "../../webg/Diagnostics.js";
import { SSAO_DEFAULTS } from "../../webg/SsaoPass.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";

const DEFAULTS = { ...SSAO_DEFAULTS };


let app = null;
let palette = null;
let lastHelpText = "";

// ヘルプの行を生成し、後続処理で利用できる状態にする
function buildHelpLines() {
  const p = app?.computeSsaoGbufferState?.params;
  return [
    "G-buffer normal ambient occlusion",
    "CommandPalette: double tap canvas or press /",
    "Drag or Arrow keys: orbit camera",
    "Use palette controls to inspect AO parameters and normal input",
    "",
    `SSAO: ${app?.computeSsaoGbufferState?.enabled ? "ON" : "OFF"} / view: ${app?.computeSsaoGbufferState?.view ?? "--"}`,
    `Radius: ${p ? p.radius.toFixed(0) : "--"} / strength: ${p ? p.strength.toFixed(2) : "--"}`,
    `Bias: ${p ? p.bias.toFixed(2) : "--"} / samples: ${p ? p.samples : "--"}`,
    `SSAO Scale: ${p ? p.resolutionScale.toFixed(2) : "--"}`,
    `Pause: ${app?.computeSsaoGbufferState?.paused ? "ON" : "OFF"}`,
    ...(app?.getFrameTimingLines?.() ?? [])
  ];
}

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("computeSsaoGbufferHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) return;
  app.updateOverlayPanel("computeSsaoGbufferHelp", { lines });
  lastHelpText = nextText;
}

// Primitiveが返すCPU geometryを標準Shapeへ取り込み、描画用GPU Bufferを確定します
// sceneで使うgeometryの作成手順をこのmain.js内で完結させ、sample外の補助moduleへ隠しません
function createPrimitiveShape(gpu, createPrimitive) {
  if (typeof createPrimitive !== "function") {
    throw new Error("createPrimitiveShape requires a primitive factory function");
  }
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(createPrimitive(shape.getPrimitiveOptions()));
  shape.endShape();
  return shape;
}

// オブジェクトを対象へ追加し、後続処理から参照できるようにする
function addObject(name, shape, position, scale, color) {
  // Shapeの標準colorを設定し、GeometryBufferPassも同じmaterial情報を読みます
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.setScale(scale);
  shape.shaderParameter("color", color);
  shape.shaderParameter("specular", 0.35);
  shape.shaderParameter("roughness", 0.62);
  shape.shaderParameter("metallic", 0.0);
  shape.shaderParameter("emissive", 0.0);
  node.addShape(shape);
  return node;
}

// G-bufferのtextureとnormal map対応を確認する小さな手続きtextureを作ります
// 通常描画と同じTexture objectをShape materialへ渡し、GeometryBuffer専用resourceは作りません
async function createSurfaceTextures(gpu) {
  const colorTexture = new Texture(gpu);
  await colorTexture.initPromise;
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
      // 二つの高周波を重ね、specular highlightの細かな揺れでnormal mapを確認します
      const height = (
        Math.sin(x * 0.82) * Math.cos(y * 0.76) * 0.68
        + Math.sin((x + y) * 1.47) * 0.32
      );
      const wave = Math.round((height * 0.5 + 0.5) * 255);
      pixels[offset] = checker ? 242 : 36;
      pixels[offset + 1] = checker ? 126 : 124;
      pixels[offset + 2] = checker ? 48 : 214;
      pixels[offset + 3] = wave;
    }
  }
  colorTexture.setImage(pixels, size, size, 4);
  colorTexture.setRepeat();

  const normalTexture = new Texture(gpu);
  await normalTexture.initPromise;
  await normalTexture.buildNormalMapFromHeightMap({
    source: pixels,
    width: size,
    height: size,
    ncol: 4,
    channel: "a",
    strength: 1.9,
    wrap: true
  });
  normalTexture.setRepeat();
  return { colorTexture, normalTexture };
}

// 5本のboneで曲がる円柱meshを作り、G-bufferのskinning経路を立体面で確認します
// 1関節へ曲げを集中させず短い区間へ分散し、線形blendによる断面潰れと自己交差を抑えます
function createSkinnedCylinder(gpu) {
  const shape = new Shape(gpu);
  shape.setAutoCalcNormals(true);
  // seam法線は全triangleの加算後に一度だけ同期し、途中値の反復合算を避けます
  shape.deferAltVertexSync = true;
  const skeleton = new Skeleton();
  shape.setSkeleton(skeleton);
  const boneCount = 5;
  const lastBoneIndex = boneCount - 1;
  const bones = [];
  let parent = null;
  const boneStep = 6 / (boneCount - 1);
  for (let index = 0; index < boneCount; index += 1) {
    const bone = skeleton.addBone(parent, `cylinder-${index}`);
    bone.setRestPosition(0, index === 0 ? -3 : boneStep, 0);
    bones.push(bone);
    parent = bone;
  }
  skeleton.bindRestPose();
  skeleton.setBoneOrder(bones.map((bone) => bone.name));

  const rows = 24;
  const segments = 24;
  const ringStride = segments + 1;
  const radius = 0.72;
  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows;
    const y = -3 + t * 6;
    const bonePosition = t * (boneCount - 1);
    const bone0 = Math.min(Math.floor(bonePosition), boneCount - 1);
    const bone1 = Math.min(bone0 + 1, boneCount - 1);
    const weight1 = bone1 === bone0 ? 0 : bonePosition - bone0;
    const weight0 = 1 - weight1;
    let firstVertex = -1;
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const angle = u * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = -Math.sin(angle) * radius;
      const vertex = shape.addVertexUV(x, y, z, u, t) - 1;
      shape.addVertexWeight(vertex, bone0, weight0);
      if (bone1 !== bone0) {
        shape.addVertexWeight(vertex, bone1, weight1);
      }
      if (segment === 0) {
        firstVertex = vertex;
      } else if (segment === segments) {
        // UV seamは頂点を分けつつ、法線計算では同一位置として平滑化します
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

  // 側面と頂点を共有するとcap境界の法線が丸まるため、両端専用の頂点を追加します
  const bottomCenter = shape.addVertexUV(0, -3, 0, 0.5, 0.5) - 1;
  shape.addVertexWeight(bottomCenter, 0, 1);
  const topCenter = shape.addVertexUV(0, 3, 0, 0.5, 0.5) - 1;
  shape.addVertexWeight(topCenter, lastBoneIndex, 1);
  const bottomRing = [];
  const topRing = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const angle = segment / segments * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = -Math.sin(angle) * radius;
    const u = x / (radius * 2) + 0.5;
    const v = z / (radius * 2) + 0.5;
    const bottom = shape.addVertexUV(x, -3, z, u, v) - 1;
    const top = shape.addVertexUV(x, 3, z, u, v) - 1;
    shape.addVertexWeight(bottom, 0, 1);
    // 上端capと側面上端を同じ末端boneへ固定し、曲げたときの分離を防ぎます
    shape.addVertexWeight(top, lastBoneIndex, 1);
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
    color: [0.84, 0.28, 0.10, 0.25],
    has_bone: 1,
    ambient: 0.20,
    specular: 0.72,
    roughness: 0.38,
    metallic: 0.0,
    emissive: 0.0,
    power: 42
  });
  return { shape, bones };
}

// シーンを生成し、後続処理で利用できる状態にする
async function createScene() {
  // corner、接地部、物体間の狭い隙間など、AOの差が見えやすいsceneを構成します
  const gpu = app.getGPU();
  const floorShape = createPrimitiveShape(gpu, (options) => Primitive.cuboid(34.0, 1.0, 30.0, options));
  const backWallShape = createPrimitiveShape(gpu, (options) => Primitive.cuboid(34.0, 16.0, 1.0, options));
  const sideWallShape = createPrimitiveShape(gpu, (options) => Primitive.cuboid(1.0, 16.0, 28.0, options));
  const rightWallShape = createPrimitiveShape(gpu, (options) => Primitive.cuboid(1.0, 16.0, 12.0, options));
  const boxLargeShape = createPrimitiveShape(gpu, (options) => Primitive.cuboid(5.0, 5.0, 5.0, options));
  const boxSmallShape = createPrimitiveShape(gpu, (options) => Primitive.cuboid(3.0, 3.0, 3.0, options));
  const pillarShape = createPrimitiveShape(gpu, (options) => Primitive.cuboid(3.0, 8.0, 3.0, options));
  const sphereShape = createPrimitiveShape(gpu, (options) => Primitive.sphere(1.0, 30, 22, options));
  const textures = await createSurfaceTextures(gpu);
  const texturedShape = createPrimitiveShape(gpu, (options) => Primitive.mapCube(4.5, options));
  texturedShape.setMaterial("smooth-shader", {
    color: [1, 1, 1, 0.35],
    use_texture: 1,
    texture: textures.colorTexture,
    use_normal_map: 1,
    normal_texture: textures.normalTexture,
    normal_strength: 1.35,
    ambient: 0.16,
    specular: 1.0,
    roughness: 0.28,
    metallic: 0.0,
    emissive: 0.0,
    power: 58
  });
  sphereShape.setMaterial("smooth-shader", {
    color: [1, 1, 1, 1],
    ambient: 0.18,
    specular: 0.72,
    power: 54
  });
  const cylinder = createSkinnedCylinder(gpu);

  addObject("floor", floorShape, [0.0, -4.5, 0.0], 1.0, [0.58, 0.62, 0.67, 1.0]);
  const wallColor = [0.76, 0.80, 0.86, 1.0];
  const wallMaterial = {
    color: wallColor,
    ambient: 0.38,
    specular: 0.20,
    power: 20
  };
  backWallShape.setMaterial("smooth-shader", wallMaterial);
  sideWallShape.setMaterial("smooth-shader", wallMaterial);
  rightWallShape.setMaterial("smooth-shader", wallMaterial);
  addObject("backWall", backWallShape, [0.0, 3.0, -13.5], 1.0, wallColor);
  addObject("leftWall", sideWallShape, [-16.5, 3.0, 0.0], 1.0, wallColor);
  // 右壁は背面側へ限定し、初期カメラと主要sceneの間を塞がず右奥のcorner AOを作ります
  addObject("rightWall", rightWallShape, [16.5, 3.0, -7.0], 1.0, wallColor);

  const boxLargeNode = addObject(
    "boxLarge",
    boxLargeShape,
    [-5.6, -1.2, -4.8],
    1.12,
    [0.86, 0.56, 0.34, 1.0]
  );
  const boxSmallNode = addObject(
    "boxSmall",
    boxSmallShape,
    [-2.1, -2.275, -2.5],
    1.15,
    [0.92, 0.76, 0.38, 1.0]
  );
  const animatedNodes = [
    boxLargeNode,
    boxSmallNode,
    addObject("pillar", pillarShape, [6.4, 0.32, -6.5], 1.08, [0.38, 0.68, 0.88, 1.0]),
    addObject("sphereFloor", sphereShape, [3.2, -1.75, 0.0], 2.25, [0.38, 0.88, 0.66, 1.0]),
    addObject("sphereCorner", sphereShape.createInstance(), [-11.5, -1.35, -9.0], 2.65, [0.82, 0.42, 0.55, 1.0]),
    addObject("sphereRaised", sphereShape.createInstance(), [8.8, 0.8, -2.8], 2.3, [0.72, 0.55, 0.94, 1.0])
  ];
  const texturedNode = app.space.addNode(null, "texturedNormalCube");
  // 4.5幅のCubeを1.1倍し、拡大後の下面が床上面y=-4.0へ接する高さに置きます
  texturedNode.setPosition(8.6, -1.525, 3.8);
  texturedNode.setScale(1.1);
  texturedNode.addShape(texturedShape);
  animatedNodes.push(texturedNode);
  const cylinderNode = app.space.addNode(null, "skinnedCylinder");
  // 円柱も少し拡大して中央へ寄せ、床および近傍objectとのAOを見やすくします
  cylinderNode.setPosition(-6.8, 0.1, 3.8);
  cylinderNode.setScale(1.1);
  cylinderNode.addShape(cylinder.shape);
  return {
    animatedNodes,
    cubeNodes: new Set([boxLargeNode, boxSmallNode, texturedNode]),
    skinBones: cylinder.bones
  };
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "compute_ssao_gbuffer",
      source: "samples/compute_ssao_gbuffer/main.js"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "compute_ssao_gbuffer failed",
      id: "start-error"
    }));
    console.error("compute_ssao_gbuffer failed:", err);
  });
});

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    frameTiming: true,
    clearColor: [0.12, 0.15, 0.19, 1.0],
    viewAngle: 52.0,
    projectionFar: 120.0,
    messageFontTexture: "../../webg/font512.png",
    camera: { target: [0.0, -0.5, -4.0], distance: 35.0, yaw: 24.0, pitch: -13.0 },
    debugTools: {
      mode: "release",
      system: "compute_ssao_gbuffer",
      source: "samples/compute_ssao_gbuffer/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computeSsaoGbufferHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");

  const orbit = app.createOrbitEyeRig({
    target: [0.0, -0.5, -4.0],
    distance: 35.0,
    yaw: 24.0,
    pitch: -13.0,
    minDistance: 18.0,
    maxDistance: 70.0,
    wheelZoomStep: 1.2
  });

  // v2統合pipelineでG-buffer、AO visibility、Deferred Lightingを接続し、
  // 旧SSAO完成色passをsample側へ再実装しません
  const pipeline = new ComputeEffectPipeline(app.getGPU(), {
    label: "compute-ssao-gbuffer",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    ssao: { ...DEFAULTS },
    lighting: {
      ambient: 0.28,
      directionalIntensity: 1.0
    }
  });
  await pipeline.ready;
  const copyPass = new FullscreenPass(app.getGPU(), {
    targetFormat: app.getGPU().format
  });
  await copyPass.init();

  const scene = await createScene();
  const state = {
    enabled: true,
    paused: false,
    view: "composite",
    params: { ...DEFAULTS }
  };
  app.computeSsaoGbufferState = state;
  // このインスタンスを初期状態へ戻し、前回の状態を残さない
  const reset = () => {
    state.enabled = true;
    state.view = "composite";
    Object.assign(state.params, DEFAULTS);
  };

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
      title: "Compute SSAO2",
      pageRows: 5,
      pageRowsByPage: [5, 5],
      closeOnCommand: false,
      onChange: (id, value) => {
        const p = state.params;
        if (id === "enabled") state.enabled = value;
        else if (id === "paused") state.paused = value;
        else if (id === "view") state.view = value;
        else if (id === "radius") p.radius = value;
        else if (id === "strength") p.strength = value;
        else if (id === "bias") p.bias = value;
        else if (id === "samples") p.samples = value;
        else if (id === "resolution-scale") p.resolutionScale = value;
        refreshAfterControlChange();
      },
      onCommand: (id) => {
        if (id === "reset") reset();
        refreshAfterControlChange();
      },
      commands: [
        // 1ページ目
        { type: "toggle", id: "enabled", label: "SSAO", detail: "on/off", value: () => state.enabled },
        { type: "toggle", id: "paused", label: "Pause", detail: "anim", value: () => state.paused },
        { id: "reset", label: "Reset", detail: "params" },
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "select", id: "view", label: "View", value: () => state.view, options: [
          { value: "composite", label: "composite" },
          { value: "scene", label: "scene" },
          { value: "ao", label: "ao" },
          { value: "normal", label: "normal" }
        ] },
        { type: "stepper", id: "radius", label: "Radius", value: () => state.params.radius, min: 4.0, max: 48.0, step: 2.0, decimals: 0, input: true },
        { type: "stepper", id: "strength", label: "Strength", value: () => state.params.strength, min: 0.0, max: 4.0, step: 0.12, decimals: 2, input: true },
        { type: "stepper", id: "bias", label: "Bias", value: () => state.params.bias, min: 0.0, max: 0.35, step: 0.01, decimals: 2, input: true },
        // 2ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "samples", label: "Samples", value: () => state.params.samples, min: 4, max: 16, step: 2, decimals: 0, input: true },
        { type: "stepper", id: "resolution-scale", label: "SSAO Scale", value: () => state.params.resolutionScale, min: 0.5, max: 1.0, step: 0.05, decimals: 2, input: true },
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
    onKeyDown: async (key, ev) => {
      if (ev.repeat) return;
      const p = state.params;
      if (key === "c") state.enabled = !state.enabled;
      else if (key === "v") {
        const views = ["composite", "scene", "ao", "normal"];
        state.view = views[(views.indexOf(state.view) + 1) % views.length];
      } else if (key === "1") p.radius = Math.max(4.0, p.radius - 2.0);
      else if (key === "2") p.radius = Math.min(48.0, p.radius + 2.0);
      else if (key === "3") p.strength = Math.max(0.0, p.strength - 0.12);
      else if (key === "4") p.strength = Math.min(4.0, p.strength + 0.12);
      else if (key === "5") p.bias = Math.max(0.0, p.bias - 0.01);
      else if (key === "6") p.bias = Math.min(0.35, p.bias + 0.01);
      else if (key === "7") p.samples = Math.max(4, p.samples - 2);
      else if (key === "8") p.samples = Math.min(16, p.samples + 2);
      else if (key === "9") p.resolutionScale = Math.max(0.5, Number((p.resolutionScale - 0.05).toFixed(2)));
      else if (key === "0") p.resolutionScale = Math.min(1.0, Number((p.resolutionScale + 0.05).toFixed(2)));
      else if (key === " ") state.paused = !state.paused;
      else if (key === "r") reset();
    }
  });
  app.setDiagnosticsStage("runtime");
  app.configureDiagnosticsCapture({
    labelPrefix: "compute_ssao_gbuffer",
    collect: () => {
      const report = app.createProbeReport("runtime-probe");
      Diagnostics.mergeStats(report, {
        view: state.view,
        enabled: state.enabled ? "yes" : "no",
        radius: state.params.radius.toFixed(0),
        strength: state.params.strength.toFixed(2),
        bias: state.params.bias.toFixed(2),
        samples: state.params.samples,
        ssaoScale: state.params.resolutionScale.toFixed(2)
      });
      return report;
    }
  });
  app.configureDebugKeyInput();

  app.start({
    onUpdate: ({ deltaSec, screen }) => {
      app.afterGpuSubmit();
      updateHelpPanel();
      // cameraとscene animationを更新し、全中間targetをcanvas寸法へ追従させます
      const width = screen.getWidth();
      const height = screen.getHeight();
      pipeline.resize(width, height);
      if (!state.paused) {
        for (let i = 0; i < scene.animatedNodes.length; i += 1) {
          const node = scene.animatedNodes[i];
          // 立方体だけを約2倍速にし、球、柱、skinningの比較速度は維持します
          const cubeSpeedScale = scene.cubeNodes.has(node) ? 2.0 : 1.0;
          node.rotateY((2.0 + i * 0.35) * cubeSpeedScale * deltaSec);
        }
        const phase = performance.now() * 0.0012;
        // root boneのpitch=90度で円柱を倒し、同じ総曲げ角を4関節へ分散します
        scene.skinBones[0].setAttitude(0, 90, 0);
        const bendPerJoint = Math.sin(phase * 1.3) * 12.0;
        for (let index = 1; index < scene.skinBones.length; index += 1) {
          scene.skinBones[index].setAttitude(0, 0, bendPerJoint);
        }
      }
      app.mergeDiagnosticsStats({
        view: state.view,
        enabled: state.enabled ? "yes" : "no",
        radius: state.params.radius.toFixed(0),
        strength: state.params.strength.toFixed(2),
        bias: state.params.bias.toFixed(2),
        samples: state.params.samples,
        ssaoScale: state.params.resolutionScale.toFixed(2)
      });
      app.updateDebugProbe();
    },
    onBeforeDraw: ({ cameraFrame }) => {
      // 第1段: lit color、view-space normal、depthをG-bufferへ出力します
      app.beginGpuTiming();
      pipeline.renderScene(app.space, cameraFrame, app.clearColor, {
        shadowEnabled: false,
        timestampWrites: app.getGpuRenderTimestampWrites(true, true)
      });
    },
    onAfterDraw3d: ({ cameraFrame }) => {
      // 第2段: G-bufferを読みAOを計算し、第3段で選択viewをcanvasへcopyします
      const p = state.params;
      app.getGPU().endPass();
      const finalColor = pipeline.encode(app.getGPU().commandEncoder, {
        cameraFrame,
        shadowEnabled: false,
        ssaoEnabled: state.enabled && state.view !== "scene",
        ssrEnabled: false,
        toonEnabled: false,
        dofEnabled: false,
        bloomEnabled: false,
        edgeEnabled: false,
        lightingView: state.view === "ao" || state.view === "normal" ? state.view : "lighting",
        ssao: {
          radius: p.radius,
          strength: p.strength,
          bias: p.bias,
          samples: p.samples,
          resolutionScale: p.resolutionScale
        },
        timestampWrites: app.getGpuTimestampWrites(true, true)
      });
      app.endGpuTiming(app.getGPU().commandEncoder);

      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      copyPass.draw(finalColor);
      app.screen.clearDepthBuffer();
    }
  });
}
