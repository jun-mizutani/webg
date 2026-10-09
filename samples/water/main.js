// ---------------------------------------------
// main.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 通常PBRへWaterBodyを接続し、専用の更新は波の時刻設定へ集約する

import WebgApp from "../../webg/WebgApp.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import PbrEnvironmentCompute from "../../webg/PbrEnvironmentCompute.js";
import { createProceduralEnvironmentRadiance } from "../../webg/ProceduralEnvironment.js";
import WaterBody from "../../webg/WaterBody.js";
import ResourceLedger from "./ResourceLedger.js";
import { createScene } from "./scene.js";

// 指定したIDのDOM要素を取得し、操作部品と表示欄への参照を返す
const $ = id => document.getElementById(id);
let app, gpu, pipeline, copy, scene, ledger, body, environment;
let busy = false, paused = true, time = 1.5, lastStatus = 0;

// エラーを画面とconsoleへ表示し、描画を停止して失敗箇所を確認できる状態にする
function fail(error) {
  $("errors").hidden = false;
  $("errors").textContent = error?.message ?? String(error);
  document.body.dataset.status = "error";
  app?.stop();
  console.error(error);
}

// 現在の機能設定と資源統計を読み、操作部品と状態表示へ反映する
function sync() {
  $("enabled").checked = pipeline.getWaterStats().causticsEnabled;
  $("water-visible").checked = pipeline.getWaterStats().surfaceEnabled;
  $("mode").textContent = pipeline.getWaterStats().causticsEnabled ? "ON · 登録した物体へ投影" : "OFF · 通常PBR";
  $("pause").textContent = paused ? "波を動かす" : "波を止める";
  const resources = ledger.snapshot();
  $("resources").textContent = `専用GPU資源：${resources.buffers} buffer / ${resources.textures} texture / ${resources.querySets} QuerySet · ${(resources.logicalBytes / 1048576).toFixed(3)} MiB · 集光 ${pipeline.getWaterStats().causticDispatches} dispatch / 対象 ${pipeline.getWaterStats().receiverPasses} pass / 水面 ${pipeline.getWaterStats().surfaceDispatches} dispatch`;
}

// カメラ更新、PBR描画、画面効果、画面への出力、submitを順に実行して測定対象を返す
function render(_baseline = false, frameTime = time, overrides = {}, readStage = "opaque") {
  const cameraFrame = app.updateCameraFrame();
  gpu.commandEncoder = gpu.device.createCommandEncoder();
  const encoder = gpu.commandEncoder;
  pipeline.renderScene(app.space, cameraFrame, app.clearColor, { shadowEnabled: false });
  gpu.endPass();
  const options = { cameraFrame, deltaSec: 0, shadowEnabled: false, ssaoEnabled: false, ssrEnabled: false,
    fogEnabled: false, dofEnabled: false, toonEnabled: false,
    bloomEnabled: false, edgeEnabled: false, vignetteEnabled: false, ...overrides };
  body.setTime(frameTime);
  const output = pipeline.encode(encoder, options);
  app.screen.beginPresentPass({ clearColor: app.clearColor });
  copy.draw(output);
  gpu.endPass();
  gpu.submit();
  pipeline.afterGpuSubmit();
  return readStage === "final" ? output : pipeline.deferredLightingPass.getOutputTarget();
}

// 非同期操作中の入力をまとめて制御し、成功・失敗の後に表示と操作状態を更新する
async function operation(task) {
  if (busy) return;
  busy = true;
  for (const control of document.querySelectorAll("button,input,select")) control.disabled = true;
  try { await task(); } catch (error) { fail(error); }
  finally {
    busy = false;
    for (const control of document.querySelectorAll("button,input,select")) control.disabled = false;
    sync();
  }
}

// PBR環境と比較シーンを準備し、WaterBodyの登録・操作・検証の入口を接続する
async function start() {
  for (const control of document.querySelectorAll("button,input,select")) control.disabled = true;
  app = new WebgApp({ document, computeFrame: true, useMessage: false, layoutMode: "embedded",
    fixedCanvasSize: { width: 960, height: 720, useDevicePixelRatio: false },
    clearColor: [0.018, 0.040, 0.047, 1], viewAngle: 42, projectionNear: 0.1, projectionFar: 60,
    camera: { target: [0, 0.3, 0], distance: 14.2, yaw: 25, pitch: -52 },
    debugTools: { mode: "release", system: "water", source: "samples/water/main.js" }
  });
  await app.init();
  gpu = app.getGPU();
  gpu.device.addEventListener("uncapturederror", event => fail(event.error));
  app.createOrbitEyeRig({ target: [0, 0.3, 0], distance: 14.2, yaw: 25, pitch: -52,
    minDistance: 10, maxDistance: 22, minPitch: -82, maxPitch: -22, wheelZoomStep: 0.5 });
  scene = await createScene(app);
  environment = new PbrEnvironmentCompute(gpu, {
    label: "water-sample:environment", irradianceWidth: 32, irradianceHeight: 16,
    specularWidth: 64, specularHeight: 32, specularMipCount: 6,
    brdfLutWidth: 64, brdfLutHeight: 64,
    diffuseSampleCount: 256, specularSampleCount: 256, brdfSampleCount: 256
  });
  const environmentEncoder = gpu.device.createCommandEncoder();
  environment.encode(environmentEncoder, createProceduralEnvironmentRadiance({
    preset: "blue-sky", resolution: { width: 64, height: 32 }
  }));
  gpu.queue.submit([environmentEncoder.finish()]);
  await gpu.queue.onSubmittedWorkDone();
  pipeline = new ComputeEffectPipeline(gpu, { label: "water-sample", width: 960, height: 720,
    lightDirection: [0, -1, 0], shadow: { directional: { up: [0, 0, 1] } },
    lighting: { directionalColor: [1, 0.97, 0.90], directionalIntensity: 4, ambient: 0,
      environment: environment.getResources(), environmentIntensity: 0.5 },
    toneMap: { mode: "reinhard", exposure: 1.15, gamma: 2.2 }
  });
  copy = new FullscreenPass(gpu);
  await Promise.all([pipeline.ready, copy.init()]);
  ledger = new ResourceLedger(gpu);
  // この検証器はdeviceの資源生成を追跡し、既存の描画経路とshaderをそのまま利用する
  gpu.device = ledger.device;
  // 波高と波長を控えめにして、小さな波が水面に広がる設定にする
  body = new WaterBody({
    amplitude: 0.15, wavelength: 0.75, speed: 1.3,
    // 赤と緑を青より少し吸収し、透過する水に淡い青みを加える
    absorption: [0.12, 0.05, 0.025]
  });
  const targets = { floor: scene.floor, sphere: scene.objects.sphere.node,
    box: scene.objects.box.shape, slope: scene.objects.slope.node };
  for (const [name, target] of Object.entries(targets)) {
    body.addReceiver(target);
    $(name).onchange = () => {
      if ($(name).checked) body.addReceiver(target);
      else body.removeReceiver(target);
    };
  }
  // 操作部品の値を水域設定へ反映し、次のframeで波と光の表示を更新する
  const updateWater = () => pipeline.setWater(body, {
    causticsEnabled: $("enabled").checked, surfaceEnabled: $("water-visible").checked,
    quality: $("quality").value
  });
  $("enabled").onchange = () => operation(updateWater);
  $("water-visible").onchange = () => operation(updateWater);
  $("quality").onchange = () => operation(updateWater);
  $("pause").onclick = () => { paused = !paused; sync(); };
  $("height").oninput = () => {
    const height = Number($("height").value);
    scene.objects.sphere.node.setPosition(-1.6, height, 0.4);
    $("height-value").textContent = `${height.toFixed(2)} m`;
  };
  $("verify").onclick = () => operation(async () => {
    const { verify } = await import("./validation.js");
    const saved = { paused, time };
    paused = true;
    time = 1.5;
    try {
      const result = await verify({ app, gpu, pipeline, scene, body, ledger, render });
      $("report").textContent = JSON.stringify(result, null, 2);
      $("report-details").open = true;
    } finally { ({ paused, time } = saved); }
  });
  sync();
  for (const control of document.querySelectorAll("button,input,select")) control.disabled = false;
  document.body.dataset.status = "ready";
  app.start({
    // 波の時刻と操作状態を更新し、集光生成・PBR描画・状態表示を一frame分進める
    onComputeFrame: ({ deltaSec, timeMs }) => {
    if (busy) return;
    if (!paused) time += Math.min(deltaSec, 0.05);
    render();
    if (timeMs - lastStatus > 400) {
      sync();
      $("status").textContent = `960 × 720 · ${paused ? "停止" : "再生"} ${time.toFixed(2)} s`;
      lastStatus = timeMs;
    }
  } });
  window.addEventListener("pagehide", () => {
    app.stop(); pipeline.destroy(); environment.destroy(); copy.destroy(); scene.materials.destroy();
  }, { once: true });
}

window.addEventListener("error", event => fail(event.error ?? event.message));
window.addEventListener("unhandledrejection", event => fail(event.reason));
start().catch(fail);
