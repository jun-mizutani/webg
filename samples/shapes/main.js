// -------------------------------------------------
// shapes sample
//   main.js       2026/04/28
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Texture from "../../webg/Texture.js";
import Message from "../../webg/Message.js";
import Diagnostics from "../../webg/Diagnostics.js";
import DebugConfig from "../../webg/DebugConfig.js";
import Matrix from "../../webg/Matrix.js";

// shapes の役割:
// - texture 比較、image normal 比較、procedural normal / wireframe 比較を
//   1 本へまとめる統合 sample
// - `WebgApp` を使い、canvas HUD と HTML debug dock の両方へ同じ controls row を流す
// - primitive 系 sample の統合母体として、何を比較しているかを画面上から追いやすくする

const SPEED = 0.2;
const HUD_ROW_OPTIONS = {
  anchor: "top-left",
  x: 0,
  y: 0,
  color: [0.90, 0.95, 1.0],
  minScale: 0.80
};
const SHAPE_LABELS = ["sphere", "cone", "trunc", "double", "prism", "donut", "cube", "cuboid", "mapCube"];
const SURFACE_MODE_KEYS = ["c", "t", "i", "n", "d"];
const SURFACE_MODE_INFO = {
  c: {
    id: "color",
    label: "color",
    description: "solid color only",
    useTexture: false,
    useNormalMap: false,
    normalSource: "off"
  },
  t: {
    id: "texture",
    label: "texture",
    description: "texture only",
    useTexture: true,
    useNormalMap: false,
    normalSource: "off"
  },
  i: {
    id: "image",
    label: "image normal",
    description: "texture + image normal",
    useTexture: true,
    useNormalMap: true,
    normalSource: "image"
  },
  n: {
    id: "noise",
    label: "noise normal",
    description: "solid color + noise normal",
    useTexture: false,
    useNormalMap: true,
    normalSource: "noise"
  },
  d: {
    id: "dots",
    label: "dots normal",
    description: "solid color + dots normal",
    useTexture: false,
    useNormalMap: true,
    normalSource: "dots"
  }
};
const PALETTE = [
  [0.88, 0.60, 0.47, 1.0],
  [0.94, 0.76, 0.33, 1.0],
  [0.86, 0.87, 0.37, 1.0],
  [0.47, 0.82, 0.58, 1.0],
  [0.36, 0.75, 0.86, 1.0],
  [0.41, 0.61, 0.94, 1.0],
  [0.66, 0.50, 0.94, 1.0],
  [0.86, 0.45, 0.78, 1.0],
  [0.91, 0.55, 0.66, 1.0]
];

let app = null;

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "shapes",
      source: "samples/shapes/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("shapes failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "shapes failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  });
});

const loadTextureFlipY = async (gpu, url) => {
  // canvas は上端から画素を返すため、webg の Bottom-Left UV 基準に合わせて Y 方向だけ反転する
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.translate(0, canvas.height);
  ctx.scale(1, -1);
  ctx.drawImage(bitmap, 0, 0);
  const rgba = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);

  const colorTex = new Texture(gpu);
  await colorTex.initPromise;
  colorTex.setImage(rgba, canvas.width, canvas.height, 4);

  return {
    rgba,
    width: canvas.width,
    height: canvas.height,
    colorTex
  };
};

const createImageNormalTexture = async (gpu, rgba, width, height) => {
  // 元画像そのものから normal map を作ると、
  // texture 比較と image normal 比較を 1 本の sample 内で読み分けやすい
  const normalTex = new Texture(gpu);
  await normalTex.initPromise;
  await normalTex.buildNormalMapFromHeightMap({
    source: rgba,
    width,
    height,
    ncol: 4,
    channel: "luma",
    strength: 2.0,
    wrap: true,
    invertY: false
  });
  normalTex.setRepeat();
  return normalTex;
};

const createProceduralNormalTextures = async (gpu) => {
  // 旧 `shapes` で使っていた procedural normal の 2 系統を残し、
  // image normal と同じ sample 上で見比べられるようにする
  const noise = new Texture(gpu);
  await noise.initPromise;
  await noise.buildNormalMapFromProceduralHeight({
    pattern: "noise",
    width: 256,
    height: 256,
    scale: 9.0,
    seed: 7,
    octaves: 4,
    persistence: 0.52,
    lacunarity: 2.0,
    contrast: 1.15,
    normalStrength: 1.8,
    wrap: true
  });
  noise.setRepeat();

  const dots = new Texture(gpu);
  await dots.initPromise;
  await dots.buildNormalMapFromProceduralHeight({
    pattern: "dots",
    width: 256,
    height: 256,
    scale: 12.0,
    seed: 19,
    dotRadius: 0.25,
    jitter: 0.34,
    softness: 0.55,
    dotMode: "max",
    contrast: 1.2,
    normalStrength: 2.2,
    wrap: true
  });
  dots.setRepeat();

  return { noise, dots };
};

const worldToCell = (vp, worldPos) => {
  // 3D 座標を 80x25 の文字セルへ変換し、画面上の番号ラベル位置へ使う
  const ndc = vp.mulVector(worldPos);
  const cx = Math.floor((ndc[0] * 0.5 + 0.5) * 79.0);
  const cy = Math.floor((1.0 - (ndc[1] * 0.5 + 0.5)) * 24.0);
  if (cx < 0 || cx > 79 || cy < 0 || cy > 24) return null;
  return [cx, cy];
};

const applyPrimitiveToShape = (shape, index) => {
  // geometry 自体は固定にして、surface mode の差だけを比較しやすくする
  shape.setTextureMappingMode(0);
  shape.setTextureMappingAxis(1);
  if (index === 0) shape.applyPrimitiveAsset(Primitive.sphere(8, 16, 16, shape.getPrimitiveOptions()));
  else if (index === 1) shape.applyPrimitiveAsset(Primitive.cone(10, 6, 16, shape.getPrimitiveOptions()));
  else if (index === 2) shape.applyPrimitiveAsset(Primitive.truncated_cone(8, 2, 5, 16, shape.getPrimitiveOptions()));
  else if (index === 3) shape.applyPrimitiveAsset(Primitive.double_cone(10, 8, 16, shape.getPrimitiveOptions()));
  else if (index === 4) shape.applyPrimitiveAsset(Primitive.prism(12, 4, 16, shape.getPrimitiveOptions()));
  else if (index === 5) shape.applyPrimitiveAsset(Primitive.donut(8, 3, 16, 16, shape.getPrimitiveOptions()));
  else if (index === 6) {
    shape.setTextureMappingMode(1);
    shape.setTextureMappingAxis(1);
    shape.setTextureScale(8, 8);
    shape.applyPrimitiveAsset(Primitive.cube(8, shape.getPrimitiveOptions()));
  } else if (index === 7) {
    shape.setTextureMappingMode(1);
    shape.setTextureMappingAxis(1);
    shape.setTextureScale(4, 4);
    shape.applyPrimitiveAsset(Primitive.cuboid(8, 7, 6, shape.getPrimitiveOptions()));
  } else {
    shape.setTextureScale(4, 4);
    shape.applyPrimitiveAsset(Primitive.mapCube(10));
  }
};

const createShapes = (gpu) => {
  // surface mode 切替では material だけを更新したいので、
  // shape と geometry は起動時に一度だけ確定しておく
  const shapes = [];
  for (let i = 0; i < SHAPE_LABELS.length; i++) {
    const shape = new Shape(gpu);
    applyPrimitiveToShape(shape, i);
    shape.endShape();
    shapes.push(shape);
  }
  return shapes;
};

const makeControlRows = (app, state) => {
  const mode = SURFACE_MODE_INFO[state.surfaceModeKey];
  const wireRows = [];
  for (let block = 0; block < 3; block++) {
    const base = block * 3;
    const keys = [];
    const value = [];
    for (let i = 0; i < 3; i++) {
      const index = base + i;
      keys.push({ key: String(index + 1), action: "wire" });
      value.push(`${index + 1}:${state.wireframeStates[index] ? "W" : "-"}`);
    }
    wireRows.push({
      label: `Wire ${base + 1}-${base + 3}`,
      value: value.join("  "),
      keys
    });
  }
  return [
    {
      label: "Surface",
      value: mode.label,
      keys: [
        { key: "C", action: "color" },
        { key: "T", action: "texture" },
        { key: "I", action: "image" },
        { key: "N", action: "noise" },
        { key: "D", action: "dots" }
      ],
      note: mode.description
    },
    ...wireRows,
    { label: "Pause", toggleKey: "Space", value: state.paused ? "ON" : "OFF" },
    { label: "Debug", value: DebugConfig.mode, keys: [{ key: "F9" }, { key: "M", action: "mode" }] }
  ];
};

const start = async () => {
  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    clearColor: [0.16, 0.18, 0.26, 1.0],
    lightPosition: [0.0, 100.0, 1000.0, 1.0],
    viewAngle: 53.0,
    messageFontTexture: "../../webg/font512.png",
    debugTools: {
      mode: "debug",
      system: "shapes",
      source: "samples/shapes/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      // 3x3 配置の primitive 群は z=-28 に並べているため、
      // target まで z=-28 に寄せると rig 自体が物体中心へ入り込みやすい
      // 旧 sample の見えに近い全体比較へ戻すため、target は原点へ置き、
      // distance でまとめて引いた視点を作る
      target: [0.0, 0.0, 0.0],
      distance: 50.0,
      yaw: 0.0,
      pitch: 0.0
    }
  });
  await app.init();
  app.setDiagnosticsStage("load-texture");

  const { rgba, width, height, colorTex } = await loadTextureFlipY(app.getGL(), "../../webg/num256.png");
  const imageNormalTex = await createImageNormalTexture(app.getGL(), rgba, width, height);
  const proceduralNormals = await createProceduralNormalTextures(app.getGL());

  app.setDiagnosticsStage("build-shapes");
  const shapes = createShapes(app.getGL());
  const state = {
    paused: false,
    surfaceModeKey: "t",
    wireframeStates: new Array(SHAPE_LABELS.length).fill(false)
  };

  const pickNormalTexture = () => {
    const mode = SURFACE_MODE_INFO[state.surfaceModeKey];
    if (mode.normalSource === "image") return imageNormalTex;
    if (mode.normalSource === "noise") return proceduralNormals.noise;
    if (mode.normalSource === "dots") return proceduralNormals.dots;
    return null;
  };

  const applySurfaceModeToShapes = () => {
    // unified sample の中心処理:
    // geometry は固定のまま、texture / normal / wireframe 条件だけを切り替える
    const mode = SURFACE_MODE_INFO[state.surfaceModeKey];
    const normalTex = pickNormalTexture();
    for (let i = 0; i < shapes.length; i++) {
      shapes[i].setWireframe(state.wireframeStates[i]);
      shapes[i].setMaterial("smooth-shader", {
        has_bone: 0,
        use_texture: mode.useTexture ? 1 : 0,
        texture: colorTex,
        use_normal_map: mode.useNormalMap ? 1 : 0,
        normal_texture: normalTex,
        normal_strength: 1.0,
        color: PALETTE[i],
        ambient: 0.22,
        specular: 0.92,
        power: 56.0,
        emissive: 0.0
      });
    }
  };
  applySurfaceModeToShapes();

  const nodes = [];
  const rot = [];
  const spacing = 24.0;
  for (let i = 0; i < SHAPE_LABELS.length; i++) {
    const node = app.space.addNode(null, SHAPE_LABELS[i]);
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = (col - 1) * spacing;
    const y = (1 - row) * spacing;
    const z = -28.0;
    node.setPosition(x, y, z);
    node.addShape(shapes[i]);
    nodes.push(node);
    rot.push((Math.random() * 0.8 + 0.5) * SPEED);
  }

  const labels = new Message(app.getGL());
  await labels.init("../../webg/font512.png");
  labels.shader.setScale(1.0);
  labels.setColor(1.0, 1.0, 1.0);

  const refreshDiagnosticsStats = (frameCount = app.screen.getFrameCount()) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-check",
      shapes
    });
    const mode = SURFACE_MODE_INFO[state.surfaceModeKey];
    app.mergeDiagnosticsStats({
      frameCount,
      surfaceMode: mode.id,
      useTexture: mode.useTexture ? "yes" : "no",
      useNormalMap: mode.useNormalMap ? "yes" : "no",
      normalSource: mode.normalSource,
      wireCount: state.wireframeStates.filter(Boolean).length,
      paused: state.paused ? "yes" : "no",
      envOk: envReport.ok ? "yes" : "no",
      envWarning: envReport.warnings?.[0] ?? "-"
    });
    return envReport;
  };

  const makeProbeReport = (frameCount) => {
    const mode = SURFACE_MODE_INFO[state.surfaceModeKey];
    const envReport = app.checkEnvironment({
      stage: "runtime-probe",
      shapes
    });
    const report = app.createProbeReport("runtime-probe");
    Diagnostics.addDetail(report, `surface=${mode.id}`);
    Diagnostics.addDetail(report, `wire=${state.wireframeStates.map((value, index) => `${index + 1}:${value ? "on" : "off"}`).join(",")}`);
    if (envReport.warnings?.length) {
      Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
    }
    Diagnostics.mergeStats(report, {
      frameCount,
      surfaceMode: mode.id,
      wireCount: state.wireframeStates.filter(Boolean).length,
      paused: state.paused ? "yes" : "no",
      envOk: envReport.ok ? "yes" : "no"
    });
    return report;
  };

  app.configureDiagnosticsCapture({
    labelPrefix: "shapes",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  const applyKeyAction = (key) => {
    if (SURFACE_MODE_KEYS.includes(key)) {
      state.surfaceModeKey = key;
      applySurfaceModeToShapes();
      return true;
    }
    if (key === "space") {
      state.paused = !state.paused;
      return true;
    }
    if (/^[1-9]$/.test(key)) {
      const index = Number.parseInt(key, 10) - 1;
      state.wireframeStates[index] = !state.wireframeStates[index];
      shapes[index].setWireframe(state.wireframeStates[index]);
      return true;
    }
    return false;
  };

  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      applyKeyAction(key);
    }
  });
  app.input.installTouchControls({
    touchDeviceOnly: true,
    groups: [
      {
        id: "surfaceMode",
        buttons: [
          { key: "c", label: "C", kind: "action", ariaLabel: "surface mode color" },
          { key: "t", label: "T", kind: "action", ariaLabel: "surface mode texture" },
          { key: "i", label: "I", kind: "action", ariaLabel: "surface mode image normal" },
          { key: "n", label: "N", kind: "action", ariaLabel: "surface mode noise normal" },
          { key: "d", label: "D", kind: "action", ariaLabel: "surface mode dots normal" }
        ]
      },
      {
        id: "wire",
        buttons: [
          { key: "1", label: "1", kind: "action", ariaLabel: "toggle wireframe 1" },
          { key: "2", label: "2", kind: "action", ariaLabel: "toggle wireframe 2" },
          { key: "3", label: "3", kind: "action", ariaLabel: "toggle wireframe 3" },
          { key: "4", label: "4", kind: "action", ariaLabel: "toggle wireframe 4" },
          { key: "5", label: "5", kind: "action", ariaLabel: "toggle wireframe 5" },
          { key: "6", label: "6", kind: "action", ariaLabel: "toggle wireframe 6" },
          { key: "7", label: "7", kind: "action", ariaLabel: "toggle wireframe 7" },
          { key: "8", label: "8", kind: "action", ariaLabel: "toggle wireframe 8" },
          { key: "9", label: "9", kind: "action", ariaLabel: "toggle wireframe 9" },
          { key: "space", label: "Pause", kind: "action", ariaLabel: "pause rotation" }
        ]
      }
    ],
    // Touch 側も InputController が key 名を正規化して渡すので、
    // keyboard と同じ比較名で surface mode や pause を扱える
    onAction: ({ key }) => applyKeyAction(String(key).toLowerCase())
  });

  const refreshControlRows = () => {
    const rows = makeControlRows(app, state);
    app.setControlRows(rows, HUD_ROW_OPTIONS);
  };

  app.setDiagnosticsStage("runtime");
  app.start({
    onUpdate: ({ screen }) => {
      if (!state.paused) {
        for (let i = 0; i < nodes.length; i++) {
          nodes[i].rotateX(rot[i]);
          nodes[i].rotateY(rot[i]);
        }
      }
      refreshDiagnosticsStats(screen.getFrameCount());
      refreshControlRows();
      app.updateDebugProbe();
    },
    onAfterDraw3d: () => {
      // HTML debug dock / canvas HUD は WebgApp 側へ任せつつ、
      // primitive 番号ラベルだけは別 Message で重ね、比較対象を追いやすくする
      app.eye.setWorldMatrix();
      const view = new Matrix();
      view.makeView(app.eye.worldMatrix);
      const vp = app.projectionMatrix.clone();
      vp.mul(view);
      // primitive 番号ラベルは毎 frame の投影結果に合わせて全件差し替える
      // 旧 setMessage(slot, x, y, text) ではなく、現在の setLine(id, text, options) へ寄せる
      labels.clear();
      for (let i = 0; i < nodes.length; i++) {
        const cell = worldToCell(vp, nodes[i].getWorldPosition());
        if (cell) {
          labels.setLine(`shape-label-${i}`, String(i), {
            x: cell[0],
            y: cell[1],
            color: labels.color
          });
        }
      }
      labels.drawScreen();
    }
  });
};
