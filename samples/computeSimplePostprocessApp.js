// ---------------------------------------------
// samples/computeSimplePostprocessApp.js  2026/07/25
//   Single-dispatch Compute Shader sample runtime
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../webg/WebgApp.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../webg/OverlayPanelPresets.js";
import Primitive from "../webg/Primitive.js";
import Shape from "../webg/Shape.js";
import FullscreenPass from "../webg/FullscreenPass.js";
import Diagnostics from "../webg/Diagnostics.js";
import ComputePass, {
  DEFAULT_STORAGE_TEXTURE_FORMAT as COMPUTE_OUTPUT_FORMAT
} from "../webg/ComputePass.js";
import StorageTargetFactory, { resizeTarget } from "../webg/StorageTargetFactory.js";

// VignetteとEdge Detectionは同じsceneと単一dispatchの描画フローを使うため、
// sample固有部分をWGSL・parameter・HUD定義だけに絞る共通runtimeです

function makeTimingHudRows(app) {
  const timer = app?.frameTimer;
  const gpuAvailable = timer?.timestampSupported === true;
  const computeMs = Number.isFinite(timer?.gpuComputeMs)
    ? `${timer.gpuComputeMs.toFixed(3)} ms`
    : "--";
  const renderMs = Number.isFinite(timer?.gpuRenderMs)
    ? `${timer.gpuRenderMs.toFixed(3)} ms`
    : "--";
  const computeLoad = Number.isFinite(timer?.gpuComputeMs) && timer.frameIntervalMs > 0
    ? `${(timer.gpuComputeMs / timer.frameIntervalMs * 100).toFixed(1)}%`
    : (gpuAvailable ? "--" : "unavailable");
  const renderLoad = Number.isFinite(timer?.gpuRenderMs) && timer.frameIntervalMs > 0
    ? `${(timer.gpuRenderMs / timer.frameIntervalMs * 100).toFixed(1)}%`
    : (gpuAvailable ? "--" : "unavailable");
  const jsLoad = Number.isFinite(timer?.jsLoadPercent)
    ? `${timer.jsLoadPercent.toFixed(1)}%`
    : "--";
  return [
    { label: "GPU Compute", value: `${computeMs} / ${computeLoad}` },
    { label: "GPU Render", value: `${renderMs} / ${renderLoad}` },
    { label: "JS Load", value: jsLoad }
  ];
}

// smooth-shaderへ渡すmaterialを揃え、各effectの比較でscene条件が変わらないようにします
function makeMaterial(color, ambient, specular, power, emissive = 0.0) {
  return {
    has_bone: 0,
    use_texture: 0,
    color,
    ambient,
    specular,
    power,
    emissive
  };
}

// Vignetteでは画面周辺の減衰、Edgeでは曲面と直線の検出を確認できるsceneを作ります
// 中央球、色付き小球、柱、床を同じ構成で使うことで、effect間の比較もしやすくします
function createScene(app) {
  // 暗い床はvignetteの周辺減衰とedgeの長い直線を確認する基準になります
  const floorShape = new Shape(app.getGPU());
  floorShape.applyPrimitiveAsset(Primitive.cuboid(42.0, 1.0, 42.0, floorShape.getPrimitiveOptions()));
  floorShape.endShape();
  floorShape.setMaterial("smooth-shader", makeMaterial([0.13, 0.16, 0.20, 1.0], 0.20, 0.20, 14.0));
  const floor = app.space.addNode(null, "floor");
  floor.setPosition(0.0, -4.5, 0.0);
  floor.addShape(floorShape);

  // 中央球は滑らかなsilhouetteとspecular境界を持つ確認用objectです
  const centerShape = new Shape(app.getGPU());
  centerShape.applyPrimitiveAsset(Primitive.sphere(3.5, 36, 24, centerShape.getPrimitiveOptions()));
  centerShape.endShape();
  centerShape.setMaterial("smooth-shader", makeMaterial([0.92, 0.88, 0.78, 1.0], 0.45, 1.00, 54.0));
  const center = app.space.addNode(null, "center");
  center.addShape(centerShape);

  const rig = app.space.addNode(null, "probeRig");
  const colors = [
    [1.0, 0.42, 0.22, 1.0],
    [0.28, 0.80, 1.0, 1.0],
    [0.92, 0.34, 0.90, 1.0],
    [0.60, 1.0, 0.38, 1.0],
    [1.0, 0.88, 0.36, 1.0]
  ];
  const probes = [];
  // 色付き小球を回転rigへattachし、frame間でeffectが安定して追従するか確認します
  for (let i = 0; i < colors.length; i += 1) {
    const angle = i / colors.length * Math.PI * 2.0;
    const shape = new Shape(app.getGPU());
    shape.applyPrimitiveAsset(Primitive.sphere(0.95, 24, 18, shape.getPrimitiveOptions()));
    shape.endShape();
    shape.setMaterial("smooth-shader", makeMaterial(colors[i], 0.30, 0.55, 28.0, 0.55));
    const node = app.space.addNode(null, `colorProbe${i}`);
    node.setPosition(Math.cos(angle) * 10.0, 1.2 + Math.sin(i * 1.7) * 1.1, Math.sin(angle) * 10.0);
    node.addShape(shape);
    node.attach(rig);
    probes.push(node);
  }

  // 背景の柱は縦方向の境界を増やし、Sobel filterの方向差を読みやすくします
  for (let i = -3; i <= 3; i += 1) {
    const shape = new Shape(app.getGPU());
    shape.applyPrimitiveAsset(Primitive.cuboid(1.0, 5.0 + (i + 3) * 0.35, 1.0, shape.getPrimitiveOptions()));
    shape.endShape();
    shape.setMaterial("smooth-shader", makeMaterial([0.30, 0.42 + i * 0.025, 0.52, 1.0], 0.25, 0.45, 22.0));
    const node = app.space.addNode(null, `pillar${i}`);
    node.setPosition(i * 3.0, -1.8, -9.0);
    node.addShape(shape);
  }
  return { center, rig, probes };
}

// configにはeffect固有のshader、default値、入力処理、uniform packing、
// HUDとdiagnostics生成関数を渡します。WebgAppの初期化からscene描画、
// compute dispatch、canvas copyまでの共通部分はこの関数が担当します
export async function runSimpleComputePostprocess(config) {
  let app = null;
  try {
    // sceneを直接canvasへ描かず、sample側で
    // sceneTarget -> compute output -> canvasの順序を制御します
    app = new WebgApp({
      document,
      autoDrawScene: false,
      frameTiming: true,
      clearColor: [0.045, 0.055, 0.070, 1.0],
      viewAngle: 54.0,
      messageFontTexture: "../../webg/font512.png",
      camera: { target: [0.0, 0.0, 0.0], distance: 34.0, yaw: 30.0, pitch: -13.0 },
      light: {
        mode: "world-node",
        nodeName: "worldLight",
        position: [80.0, 120.0, 100.0],
        attitude: [0.0, 0.0, 0.0],
        type: 1.0
      },
      debugTools: {
        mode: "release",
        system: config.id,
        source: `samples/${config.id}/main.js`,
        probeDefaultAfterFrames: 1
      }
    });
    await app.init();

    // 固有の操作説明はconfigから受け取り、標準Help panelへ表示します
    let lastHelpText = "";
    const buildHelpLines = () => [
      ...config.guideLines,
      ...app.getFrameTimingLines()
    ];
    // ヘルプのパネルを現在の入力と実行状態に合わせて更新する
    const updateHelpPanel = () => {
      const panel = app?.getOverlayPanel?.(`${config.id}Help`);
      if (!panel) return;
      const lines = buildHelpLines();
      const text = lines.join("\n");
      if (text === lastHelpText) return;
      app.updateOverlayPanel(`${config.id}Help`, { lines });
      lastHelpText = text;
    };
    const initialHelpLines = buildHelpLines();
    app.showOverlayPanel(buildHelpPanelOptions({
      id: `${config.id}Help`,
      collapsed: true,
      lines: initialHelpLines
    }));
    lastHelpText = initialHelpLines.join("\n");

    const orbit = app.createOrbitEyeRig({
      target: [0.0, 0.0, 0.0],
      distance: 34.0,
      yaw: 30.0,
      pitch: -13.0,
      minDistance: 14.0,
      maxDistance: 78.0,
      wheelZoomStep: 1.3
    });

    // 通常の3D pipelineで描くcolor/depth付きoffscreen targetです
    // Compute Shaderはこのcolor textureをtextureLoad()で読みます
    const sceneTarget = app.screen.createRenderTarget({
      label: `${config.id}:scene`,
      format: app.getGPU().format,
      hasDepth: true
    });
    await sceneTarget.ready;

    let outputTarget = null;
    let computePass = null;
    // sample固有Passをコアclassとして差し込む経路です
    // 未指定時は従来どおり単一dispatchのComputePassをこのruntime内で生成します
    if (typeof config.createPass === "function") {
      computePass = config.createPass(app.getGPU(), {
        label: config.id,
        width: app.screen.getWidth(),
        height: app.screen.getHeight()
      });
      if (!computePass || typeof computePass.encode !== "function") {
        throw new Error(`${config.id} createPass must return an object with encode()`);
      }
      if (typeof computePass.getOutputTarget !== "function") {
        throw new Error(`${config.id} createPass must return an object with getOutputTarget()`);
      }
      await Promise.resolve(computePass.ready);
    } else {
      // Compute Shader専用のrgba8unorm storage textureです
      // 最終的にはFullscreenPassがtextureとして読みcanvasへコピーします
      const targetFactory = new StorageTargetFactory(app.getGPU(), {
        label: `${config.id}:storage`
      });
      outputTarget = targetFactory.create({
        label: `${config.id}:output`,
        width: app.screen.getWidth(),
        height: app.screen.getHeight()
      });
      await outputTarget.ready;

      // effect固有WGSLを単一のcompute pipelineとして作ります
      computePass = new ComputePass(app.getGPU(), {
        label: config.id,
        code: config.shader,
        uniformFloats: config.uniformFloats ?? 16,
        bindings: [
          { binding: 0, name: "params", type: "uniform-buffer" },
          { binding: 1, name: "scene", type: "sampled-texture" },
          {
            binding: 2,
            name: "output",
            type: "storage-texture",
            format: COMPUTE_OUTPUT_FORMAT,
            dispatchSize: true
          }
        ]
      });
    }

    // storage textureはswapchainへ直接表示できないため、最後だけrender passでコピーします
    const copyPass = new FullscreenPass(app.getGPU(), {
      targetFormat: app.getGPU().format
    });
    await copyPass.init();
    const scene = createScene(app);
    const state = {
      enabled: true,
      paused: false,
      view: "output",
      params: { ...config.defaults }
    };
    app.computePostprocessState = state;

    // effect parameterとdebug viewだけを初期値へ戻し、camera姿勢は維持します
    const reset = () => {
      state.enabled = true;
      state.view = "output";
      Object.assign(state.params, config.defaults);
    };

    app.attachInput({
      onKeyDown: async (key, ev) => {
        if (ev.repeat) return;
        if (key === "c") state.enabled = !state.enabled;
        else if (key === "v") state.view = state.view === "output" ? "scene" : "output";
        else if (key === " ") state.paused = !state.paused;
        else if (key === "r") reset();
        else config.onKey?.(key, state.params);
      }
    });
    app.input.installTouchControls({
      touchDeviceOnly: false,
      groups: [
        {
          id: "mode",
          buttons: [
            { key: "c", label: "C", kind: "action", ariaLabel: "toggle compute" },
            { key: "v", label: "V", kind: "action", ariaLabel: "toggle view" },
            { key: " ", label: "P", kind: "action", ariaLabel: "pause or resume" },
            { key: "r", label: "R", kind: "action", ariaLabel: "reset parameters" }
          ]
        },
        {
          id: "param-a",
          buttons: [
            { key: "1", label: "1", kind: "action", ariaLabel: "parameter 1 decrease" },
            { key: "2", label: "2", kind: "action", ariaLabel: "parameter 1 increase" },
            { key: "3", label: "3", kind: "action", ariaLabel: "parameter 2 decrease" },
            { key: "4", label: "4", kind: "action", ariaLabel: "parameter 2 increase" }
          ]
        },
        {
          id: "param-b",
          buttons: [
            { key: "5", label: "5", kind: "action", ariaLabel: "parameter 3 decrease" },
            { key: "6", label: "6", kind: "action", ariaLabel: "parameter 3 increase" }
          ]
        }
      ],
      onAction: ({ key }) => {
        const actionKey = String(key);
        if (actionKey === "c") state.enabled = !state.enabled;
        else if (actionKey === "v") state.view = state.view === "output" ? "scene" : "output";
        else if (actionKey === " ") state.paused = !state.paused;
        else if (actionKey === "r") reset();
        else config.onKey?.(actionKey, state.params);
      }
    });
    app.setDiagnosticsStage("runtime");
    app.configureDiagnosticsCapture({
      labelPrefix: config.id,
      collect: () => {
        const report = app.createProbeReport("runtime-probe");
        Diagnostics.mergeStats(report, {
          view: state.view,
          enabled: state.enabled ? "yes" : "no",
          ...config.diagnostics(state.params)
        });
        return report;
      }
    });
    app.configureDebugKeyInput();

    app.start({
      // update phaseではcamera、target resize、scene animation、HUDを更新します
      // GPU commandの発行は後続のdraw callbackへ分けます
      onUpdate: ({ deltaSec, screen }) => {
        app.afterGpuSubmit();
        updateHelpPanel();
        resizeTarget(sceneTarget, screen.getWidth(), screen.getHeight());
        if (outputTarget) {
          resizeTarget(outputTarget, screen.getWidth(), screen.getHeight());
        } else if (typeof computePass.resize === "function") {
          computePass.resize(screen.getWidth(), screen.getHeight());
        }
        if (!state.paused) {
          scene.rig.rotateY(18.0 * deltaSec);
          scene.center.rotateY(11.0 * deltaSec);
          for (let i = 0; i < scene.probes.length; i += 1) {
            scene.probes[i].rotateY((14.0 + i * 3.0) * deltaSec);
          }
        }
        app.setHudRows(app.isDebugUiEnabled()
          ? [
            ...config.hudRows(state.params, state),
            ...makeTimingHudRows(app)
          ]
          : [], {
            anchor: "top-left",
            x: 0,
            y: 0,
            color: [0.90, 0.95, 1.0],
            minScale: 0.80
          });
        app.mergeDiagnosticsStats({
          view: state.view,
          enabled: state.enabled ? "yes" : "no",
          ...config.diagnostics(state.params)
        });
        app.updateDebugProbe();
      },
      // draw phase 1: color/depth付きsceneTargetへ通常の3D sceneを描きます
      onBeforeDraw: () => {
        app.beginGpuTiming();
        app.screen.beginPass({
          target: sceneTarget,
          clearColor: app.clearColor,
          colorLoadOp: "clear",
          depthClear: true,
          timestampWrites: app.getGpuRenderTimestampWrites(true, true)
        });
        app.space.draw(app.eye);
      },
      // draw phase 2:
      // 1. JavaScript parameterをuniformへ転送
      // 2. scene colorを入力にcompute dispatch
      // 3. sceneまたはcompute outputをcanvasへコピー
      // 4. HUD描画用にdepth付きcanvas passを開き直す
      onAfterDraw3d: () => {
        // scene Render Passを閉じ、同じframeのcommand encoderへCompute Passを追加します
        app.getGPU().endPass();
        if (outputTarget) {
          computePass.setUniforms(config.makeUniforms(state.params, state, outputTarget));
          computePass.encode(app.getGPU().commandEncoder, {
            scene: sceneTarget,
            output: outputTarget
          }, {
            timestampWrites: app.getGpuTimestampWrites(true, true)
          });
        } else {
          computePass.encode(
            app.getGPU().commandEncoder,
            sceneTarget,
            {
              ...config.makePassOptions?.(state.params, state),
              timestampWrites: app.getGpuTimestampWrites(true, true)
            }
          );
        }
        app.endGpuTiming(app.getGPU().commandEncoder);
        const source = state.view === "scene"
          ? sceneTarget
          : (outputTarget ?? computePass.getOutputTarget());
        app.screen.beginPresentPass({
          clearColor: app.clearColor,
          colorLoadOp: "clear"
        });
        copyPass.draw(source);
        app.screen.clearDepthBuffer();
      }
    });
  } catch (err) {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: config.id,
      source: `samples/${config.id}/main.js`,
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: `${config.id} failed`,
      id: "start-error"
    }));
    console.error(`${config.id} failed:`, err);
  }
}
