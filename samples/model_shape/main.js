// -------------------------------------------------
// model_shape sample
//   main.js       2026/04/28
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import ModelAsset from "../../webg/ModelAsset.js";
import ModelValidator from "../../webg/ModelValidator.js";
import ModelBuilder from "../../webg/ModelBuilder.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Texture from "../../webg/Texture.js";
import Diagnostics from "../../webg/Diagnostics.js";

// model_shape の役割:
// - Primitive -> ModelAsset -> ModelValidator -> ModelBuilder の流れを
//   そのまま見える形で確認する
// - 法線マップ付きの複数形状を並べ、
//   生成経路を変えても見え方が維持されることを確認する
// - WebgApp.js を使って、初期化順とメッセージ表示を簡潔に保つ

const SPEED = 0.6;
let app = null;

const loadBaseAndNormalTexture = async (gpu, url) => {
  // canvas の画素列は上端から並ぶため、webg の Bottom-Left UV 基準に合わせて Y 方向だけ反転する
  // 同じ補正後画素からカラー用テクスチャと法線マップを構築する
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
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgba = new Uint8Array(imageData);

  const colorTex = new Texture(gpu);
  await colorTex.initPromise;
  colorTex.setImage(rgba, canvas.width, canvas.height, 4);

  const normalTex = new Texture(gpu);
  await normalTex.initPromise;
  await normalTex.buildNormalMapFromHeightMap({
    source: rgba,
    width: canvas.width,
    height: canvas.height,
    ncol: 4,
    channel: "luma",
    strength: 2.0,
    wrap: true,
    invertY: false
  });

  return { colorTex, normalTex };
};

const buildPrimitiveAssets = () => {
  // Primitive が返す ModelAsset を一覧化する
  // 最後の mapCube は、ModelAsset.fromData() を明示的に通した例として残す
  const list = [
    { label: "sphere", asset: Primitive.sphere(8, 16, 16, { txAxis: 1 }) },
    { label: "cone", asset: Primitive.cone(10, 6, 16, { txAxis: 1 }) },
    { label: "trunc", asset: Primitive.truncated_cone(8, 2, 5, 16, { txAxis: 1 }) },
    { label: "double", asset: Primitive.double_cone(10, 8, 16, { txAxis: 1 }) },
    { label: "prism", asset: Primitive.prism(12, 4, 16, { txAxis: 1 }) },
    { label: "donut", asset: Primitive.donut(8, 3, 16, 16, { txAxis: 1 }) },
    {
      label: "cube",
      asset: Primitive.cube(8, {
        txMode: 1,
        txAxis: 1,
        txScaleU: 8,
        txScaleV: 8
      })
    },
    {
      label: "cuboid",
      asset: Primitive.cuboid(8, 7, 6, {
        txMode: 1,
        txAxis: 1,
        txScaleU: 4,
        txScaleV: 4
      })
    },
    {
      label: "mapCube",
      asset: ModelAsset.fromData(Primitive.mapCube(10).getData())
    }
  ];
  return list;
};

const applyMaterial = (shape, colorTex, normalTex, useNormalMap, wireframe, color) => {
  // ModelBuilder が返した Shape は geometry だけを持つため、
  // サンプル側で shaderParameter と material を与えて見え方を整える
  shape.setWireframe(wireframe);
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 1,
    texture: colorTex,
    use_normal_map: useNormalMap ? 1 : 0,
    normal_texture: normalTex,
    normal_strength: 1.0,
    color,
    ambient: 0.26,
    specular: 0.90,
    power: 54.0,
    emissive: 0.0
  });
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "model_shape",
      source: "samples/model_shape/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("model_shape failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "model_shape failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  });
});

const start = async () => {
  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    clearColor: [0.11, 0.14, 0.19, 1.0],
    lightPosition: [0.0, 110.0, 120.0, 1.0],
    viewAngle: 53.0,
    messageFontTexture: "../../webg/font512.png",
    debugTools: {
      mode: "debug",
      system: "model_shape",
      source: "samples/model_shape/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: [0.0, 0.0, -28.0],
      distance: 78.0,
      yaw: 18.0,
      pitch: -14.0
    }
  });
  await app.init();
  app.setDiagnosticsStage("load-texture");

  const orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, -28.0],
    distance: 78.0,
    yaw: 18.0,
    pitch: -14.0,
    minDistance: 28.0,
    maxDistance: 140.0,
    wheelZoomStep: 2.0
  });

  const { colorTex, normalTex } = await loadBaseAndNormalTexture(app.getGL(), "../../webg/num256.png");
  app.setDiagnosticsStage("validate-build");
  const validator = new ModelValidator();
  const builder = new ModelBuilder(app.getGL());
  const assetEntries = buildPrimitiveAssets();
  const buildResults = [];

  let warningCount = 0;
  for (let i = 0; i < assetEntries.length; i++) {
    const entry = assetEntries[i];
    const result = validator.validate(entry.asset.getData());
    if (!result.ok) {
      const lines = result.errors.map((item) => `${item.path}: ${item.message}`).join("\n");
      throw new Error(`ModelAsset validation failed for ${entry.label}\n${lines}`);
    }
    warningCount += result.warnings.length;
    buildResults.push({
      label: entry.label,
      built: builder.build(entry.asset.getData())
    });
  }

  const state = {
    paused: false,
    useNormalMap: true,
    wireframe: false
  };
  const getSceneShapes = () => nodes.map((node) => node.shapes[0]).filter(Boolean);
  const refreshDiagnosticsStats = (frameCount = app.screen.getFrameCount()) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-check",
      shapes: getSceneShapes()
    });
    app.mergeDiagnosticsStats({
      frameCount,
      validatorWarnings: warningCount,
      assetCount: assetEntries.length,
      builtShapeCount: nodes.length,
      paused: state.paused ? "yes" : "no",
      useNormalMap: state.useNormalMap ? "yes" : "no",
      wireframe: state.wireframe ? "yes" : "no",
      envOk: envReport.ok ? "yes" : "no",
      envWarning: envReport.warnings?.[0] ?? "-"
    });
    return envReport;
  };
  const makeProbeReport = (frameCount) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-probe",
      shapes: getSceneShapes()
    });
    const report = app.createProbeReport("runtime-probe");
    Diagnostics.addDetail(report, `assets=${assetEntries.map((entry) => entry.label).join(",")}`);
    Diagnostics.addDetail(report, `normalMap=${state.useNormalMap ? "ON" : "OFF"} wireframe=${state.wireframe ? "ON" : "OFF"}`);
    if (envReport.warnings?.length) {
      Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
    }
    Diagnostics.mergeStats(report, {
      frameCount,
      validatorWarnings: warningCount,
      assetCount: assetEntries.length,
      builtShapeCount: nodes.length,
      paused: state.paused ? "yes" : "no",
      useNormalMap: state.useNormalMap ? "yes" : "no",
      wireframe: state.wireframe ? "yes" : "no",
      envOk: envReport.ok ? "yes" : "no"
    });
    return report;
  };
  app.configureDiagnosticsCapture({
    labelPrefix: "model_shape",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      if (key === " ") {
        state.paused = !state.paused;
      } else if (key === "n") {
        state.useNormalMap = !state.useNormalMap;
      } else if (key === "w") {
        state.wireframe = !state.wireframe;
      } else if (key === "r") {
        orbit.setAngles(18.0, -14.0);
        orbit.setDistance(78.0);
      }
    }
  });

  const nodes = [];
  const spin = [];
  const palette = [
    [0.82, 0.71, 0.52, 1.0],
    [0.66, 0.87, 0.78, 1.0],
    [0.78, 0.72, 0.92, 1.0],
    [0.92, 0.65, 0.59, 1.0],
    [0.71, 0.80, 0.94, 1.0],
    [0.95, 0.84, 0.56, 1.0],
    [0.70, 0.86, 0.60, 1.0],
    [0.90, 0.72, 0.82, 1.0],
    [0.72, 0.78, 0.68, 1.0]
  ];

  const spacing = 24.0;
  for (let i = 0; i < buildResults.length; i++) {
    const built = buildResults[i].built;
    const shape = built.shapes[0];
    applyMaterial(shape, colorTex, normalTex, state.useNormalMap, state.wireframe, palette[i]);

    const node = app.space.addNode(null, buildResults[i].label);
    const col = i % 3;
    const row = Math.floor(i / 3);
    node.setPosition((col - 1) * spacing, (1 - row) * spacing, -28.0);
    node.addShape(shape);
    nodes.push(node);
    spin.push((0.5 + i * 0.05) * SPEED);
  }
  app.setDiagnosticsStage("runtime");

  app.start({
    onUpdate: ({ deltaSec, screen }) => {
      orbit.update(deltaSec);

      for (let i = 0; i < nodes.length; i++) {
        applyMaterial(nodes[i].shapes[0], colorTex, normalTex, state.useNormalMap, state.wireframe, palette[i]);
        if (!state.paused) {
          nodes[i].rotateX(18.0 * spin[i] * deltaSec);
          nodes[i].rotateY(26.0 * spin[i] * deltaSec);
        }
      }
      const envReport = refreshDiagnosticsStats(screen.getFrameCount());
      app.updateDebugProbe();
      const controlLines = [
        "model_shape sample",
        "Drag or arrow keys: orbit camera",
        "[ / ] or wheel: zoom",
        "[space] pause  [n] normal map  [w] wireframe  [r] reset camera",
        ...app.getDebugKeyGuideLines(),
        `frame=${screen.getFrameCount()}`,
        `validatorWarnings=${warningCount}`,
        `normalMap=${state.useNormalMap ? "ON" : "OFF"} wireframe=${state.wireframe ? "ON" : "OFF"}`,
        `assets=Primitive/ModelAsset/ModelValidator/ModelBuilder`,
        `env=${envReport.ok ? "OK" : "WARN"}`,
        app.getDiagnosticsStatusLine(),
        app.isDebugUiEnabled() ? app.getProbeStatusLine() : ""
      ].filter(Boolean);
      app.setControlRows(app.isDebugUiEnabled() ? app.makeTextControlRows(controlLines) : []);
    }
  });
};
