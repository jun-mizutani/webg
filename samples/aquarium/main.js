// ---------------------------------------------
// main.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// GLBの泳ぎ、Nodeの遊泳経路、WaterBodyを通常PBRへ接続する

import WebgApp from "../../webg/WebgApp.js";
import PbrRenderer from "../../webg/app/PbrRenderer.js";
import WaterBody from "../../webg/WaterBody.js";
import ComputeParticleEmitter from "../../webg/ComputeParticleEmitter.js";
import { createWaterSurface } from "./waterSurface.js";
import { createScene } from "./scene.js";
import { createSwimmingPath } from "./swimmingPath.js";

// 指定したIDのDOM要素を取得し、操作部品と表示欄への参照を返す
const $ = id => document.getElementById(id);
const camera = { target: [0, 1.2, 0], distance: 12.375, yaw: 22, pitch: -3 };
let app, renderer, scene, model, water, particles, callbacks, waterSurface;
const dolphins = [];
const bubbles = [];
let paused = false, busy = false, time = 2;

// エラーを画面とconsoleへ表示し、描画を停止して失敗箇所を確認できる状態にする
function fail(error) {
  app?.stop();
  $("errors").hidden = false;
  $("errors").textContent = error?.message ?? String(error);
  document.body.dataset.status = "error";
  console.error(error);
}

// 時刻から各個体の位置と姿勢を求め、骨のanimationを進めて水の時刻も同期する
function updateSwimming(deltaSec) {
  if (!paused) time += Math.min(deltaSec, .05);

  // 各個体の親Nodeを経路の距離に沿って進め、立体的な接線へ頭を向ける
  // 骨の泳ぎは個別のanimationで更新し、全身の移動・旋回とは分けて扱う
  for (const dolphin of dolphins) {
    const { node, instance, path } = dolphin;
    const pose = path.sample(time);
    node.setPosition(...pose.position);
    node.setQuat(pose.rotation);

    // 停止中もplayを呼び時刻の飛びを防ぐ。clipは個体ごとに終了を判定する
    instance.playAllAnimations();
    for (const name of instance.getAnimationNames()) {
      if (!paused && instance.getAnimation(name).schedule.stopped) instance.restartAnimation(name);
    }
  }
  water.setTime(time);
  $("status").textContent = paused ? "泳ぎと光を停止中" : "水中を遊泳中";
}

// 描画を止めて集光のGPU資源を切り替え、非同期準備の完了後に再開する
async function setCaustics() {
  if (busy) return;
  busy = true;
  app.stop();
  $("caustics").disabled = true;
  try {
    // 描画を止めて非同期の資源切替を完了する。水面の反射・屈折は集光OFFでも表示する
    await renderer.setWater(water, { causticsEnabled: $("caustics").checked,
      surfaceEnabled: true, quality: "high" });
    app.start(callbacks);
  } catch (error) { fail(error); }
  finally { busy = false; $("caustics").disabled = false; }
}

// GPUとPBRを準備し、5頭のモデル・水・粒子・操作を登録してframe更新を開始する
async function start() {
  app = new WebgApp({ document, autoDrawScene: false, useMessage: false,
    layoutMode: "embedded", fixedCanvasSize: { width: 960, height: 720, useDevicePixelRatio: false },
    clearColor: [.012, .055, .085, 1], viewAngle: 42, projectionNear: .1, projectionFar: 80,
    camera, debugTools: { mode: "release", system: "aquarium", source: "samples/aquarium/main.js" } });
  await app.init();
  const gpu = app.getGPU();
  gpu.device.addEventListener("uncapturederror", event => fail(event.error));
  app.createOrbitEyeRig({ ...camera, minDistance: 8, maxDistance: 36,
    minPitch: -70, maxPitch: 15, wheelZoomStep: .5 });

  renderer = new PbrRenderer(gpu, { profile: "studio", width: 960, height: 720,
    environment: { preset: "blue-sky", resolution: { width: 128, height: 64 } },
    dof: { enabled: false }, pipeline: {
      shadow: { pcfRadius: 1, directional: { up: [0, 0, 1] } },
      lighting: { ambient: 0, directionalColor: [.65, .92, 1], directionalIntensity: 4,
        environmentIntensity: .65 }, toneMap: { exposure: 1.5 }
    } });
  await renderer.waitUntilReady();
  renderer.pipeline.lightOptions.direction = [0, -1, 0];
  // 手前の色を保ち、視点から遠い側を薄い青緑の霧へなじませる
  // linearのdensityで最大混合量を抑え、奥でも薄い霧に保つ
  Object.assign(renderer.pipeline.fogOptions, { enabled: true, mode: "linear",
    near: 16, far: 40, density: .005, color: [.035, .10, .13] });
  scene = await createScene(app);
  Object.assign(renderer.pipeline.bloomOptions, { enabled: true, threshold: 1.2, strength: .18 });

  // 目を含む2026/10/04版の識別子を付け、差し替えたGLBをブラウザーへ読み込む
  model = await app.loadModel("./dolphin1_20260719.glb?v=20261004-eyes", {
    format: "gltf", instantiate: true, startAnimations: true, gltf: { includeSkins: true }
  });
  // GLBは一度だけ読み込む。geometryとtextureは共有し、骨・Node・再生状態は
  // instantiate()で個体ごとに作る。GLBは読み込んだ内容のまま共有する
  const baseScale = 1.25;
  const smallScale = baseScale * 2 / 3;
  const swimSettings = [
    { scale: baseScale, phase: 0, height: 3.0, radiusX: 4.6, radiusZ: 2.9, speed: .9,
      center: [-.5, 0], heading: .15, bend: .5, verticalCycles: 1, verticalPhase: .4 },
    { scale: 1.1, phase: Math.PI * 2 / 3, height: 3.15, radiusX: 4.0, radiusZ: 2.6, speed: .85,
      center: [.7, -.4], heading: -.3, bend: -.65, verticalCycles: 2, verticalPhase: 1.8,
      direction: -1, rollAmplitude: 90, rollRate: .34 },
    { scale: 1.05, phase: Math.PI * 4 / 3, height: 2.85, radiusX: 3.8, radiusZ: 2.8, speed: .95,
      center: [-.8, .4], heading: .4, bend: .7, verticalCycles: 1, verticalPhase: 3.2 },
    { scale: smallScale, phase: Math.PI / 3, height: 3.45, radiusX: 3.0, radiusZ: 2.2, speed: .8,
      center: [1.1, .6], heading: -.5, bend: .45, verticalCycles: 3, verticalPhase: .9,
      direction: -1, rollAmplitude: 90, rollRate: .45 },
    { scale: smallScale, phase: Math.PI, height: 2.55, radiusX: 3.5, radiusZ: 2.4, speed: .82,
      center: [-1, -.6], heading: .25, bend: -.55, verticalCycles: 2, verticalPhase: 4.1 }
  ];
  swimSettings.forEach((settings, i) => {
    const instance = i === 0 ? model.instantiated
      : model.instantiate(app.space, { bindAnimations: true, setActive: false });
    const node = app.space.addNode(null, `dolphin-swimming-path-${i}`);
    for (const root of instance.rootNodes) root.attach(node);
    node.setScale(settings.scale);
    // 身体のskin付き頂点にはArmatureの原点補正が焼き込まれている
    // 別メッシュの目にも同じ平行移動を加え、白目と瞳を頭の位置へ合わせる
    // 個体ごとのNodeへ設定することで、泳ぐ位置・向き・大きさに目も追従する
    const instanceNodes = [...instance.nodeMap.values()];
    const armatureNode = instanceNodes.find(item => item.name === "Armature");
    const eyesNode = instanceNodes.find(item => item.name === "Sphere");
    if (armatureNode && eyesNode) {
      const originOffset = armatureNode.getPosition();
      const eyePosition = eyesNode.getPosition();
      eyesNode.setPosition(...eyePosition.map((value, axis) => value + originOffset[axis]));
    }
    instance.startAllAnimations();

    // 身体をさらに暗くし、元textureの緑みを抑えるfactorで模様と反射を残す
    // 眼の白目・瞳は元の単色材質を保つ
    for (const shape of instance.shapes) {
      for (let slot = 0; slot < shape.getMaterialCount(); slot++) {
        const params = shape.getMaterialAt(slot).params;
        if (params.texture ?? shape.texture) {
          shape.updateMaterialAt(slot, { use_texture: 1, color: [.52, .43, .48, 1] });
        }
      }
    }
    // 上下振幅を抑え、全身が傾いても水底から余裕を持つ高さにする
    const path = createSwimmingPath({ ...settings, heightAmplitude: .45 });
    dolphins.push({ node, instance, path });
  });

  water = new WaterBody({ origin: [0, 0, 0], width: 18, depth: 12, extent: 24,
    surfaceHeight: 6, amplitude: .05, wavelength: .6, speed: 1.3,
    waveMix: [1, .2, .12], absorption: [.12, .05, .025] });
  for (const target of scene.receivers) water.addReceiver(target, { strength: .65 });
  for (const { node } of dolphins) water.addReceiver(node);
  await renderer.setWater(water, { causticsEnabled: true, surfaceEnabled: true, quality: "high" });

  waterSurface = await createWaterSurface(app, water);

  // 微小な浮遊粒子。屈折する気泡ではなく、水中の雰囲気を添える低輝度の点
  particles = new ComputeParticleEmitter(gpu, { preset: "light", capacity: 128, seed: 17,
    overflow: "replace-oldest", simulation: { gravity: [0, .02, 0], drag: .1 },
    appearance: { colors: [[.25, .55, .6], [.4, .65, .7]], size: [.012, .028], intensity: .4 } });
  particles.startEmission({ rate: 8, position: [0, .1, 0], velocity: [0, .4, 0],
    velocitySpread: [2, .12, 1.5], lifetime: [8, 12] });
  await renderer.pipeline.addParticleEmitter(particles);

  // 水底の3か所から白青の泡を連続発生させる。個々のサイズと横流れを
  // ばらつかせ、発生場所ごとに上昇速度を変えて一列に揃うのを避ける
  // 鉛直速度は一定にし、水面の高さまでの距離 / 速度を寿命にする
  // 泡は水面に到達する直前にフェードし、粒子の寿命で消える
  const bubbleSources = [
    { position: [-3.8, .15, -1.8], speed: .65, rate: 5 },
    { position: [4.2, .15, 1.8], speed: .8, rate: 6 },
    { position: [.8, .15, -2.7], speed: .95, rate: 4 }
  ];
  for (const [i, source] of bubbleSources.entries()) {
    const life = (water.options.surfaceHeight - source.position[1]) / source.speed;
    const emitter = new ComputeParticleEmitter(gpu, { preset: "light", capacity: 96,
      seed: 41 + i * 17, overflow: "replace-oldest",
      simulation: { gravity: [0, 0, 0], drag: 0 },
      // 加算合成の寄与を下げ、白く塗りつぶすような見え方を抑える
      appearance: { colors: [[.55, .75, .9], [.7, .85, .95]],
        size: [.04, .095], intensity: .25 } });
    emitter.startEmission({ rate: source.rate, position: source.position,
      velocity: [0, source.speed, 0], velocitySpread: [.075, 0, .075], lifetime: [life, life] });
    await renderer.pipeline.addParticleEmitter(emitter);
    bubbles.push(emitter);
  }

  callbacks = renderer.createFrameCallbacks(app, { renderScene: { shadowEnabled: true },
    // 鉛直の集光用照明だけでは腹が影になる。水底からの照り返しを近似する
    // 控えめな白い補助光を下側に置き、textureの白と背中の暗色を見分ける
    encode: { shadowEnabled: true, ssaoEnabled: false, ssrEnabled: false, dofEnabled: false,
      lights: [{ type: "point", position: [0, .3, 2], color: [1, 1, 1], radius: 14, intensity: 5.5 }, ...scene.lights] },
    // カメラの水面上下を判定し、水中用meshの表示とGPU頂点更新を切り替える
    beforeRenderScene: ({ cameraFrame }) => {
      // コアの屈折合成は水面上から使う。水中用meshを上から重ねると、
      // 合成元の背景へ水面自身が入り込むので、カメラの高さで排他的に表示する
      const above = cameraFrame.cameraWorldMatrix.getPosition()[1]
        > water.options.surfaceHeight + water.options.amplitude;
      waterSurface.setVisible(!above);
      if (!above) waterSurface.encode(gpu.commandEncoder);
      $("view").textContent = above ? "水中から見る" : "水面上から見る";
      document.body.dataset.waterView = above ? "above" : "underwater";
    },
    // 各イルカの位置・姿勢・骨の泳ぎと、水の時刻を一frame分更新する
    onUpdate: ({ deltaSec }) => updateSwimming(deltaSec) });
  // 泳ぎ・波・浮遊粒子・泡を同じ停止状態に揃え、再生ボタンの表示も更新する
  $("pause").onclick = () => {
    paused = !paused;
    for (const { instance } of dolphins) instance.setAnimationsPaused(paused);
    particles.setPaused(paused);
    for (const emitter of bubbles) emitter.setPaused(paused);
    $("pause").textContent = paused ? "再生" : "一時停止";
    $("pause").setAttribute("aria-pressed", String(paused));
  };
  // 現在の水面上下に応じてカメラの角度を切り替え、距離は現在の値を保つ
  $("view").onclick = () => {
    const pitch = document.body.dataset.waterView === "above" ? camera.pitch : -48;
    app.eyeRig.setAngles(camera.yaw, pitch);
  };
  $("caustics").onchange = setCaustics;
  // 全個体の親Nodeを受光対象へ登録・解除し、イルカだけの集光を切り替える
  $("dolphin-light").onchange = () => {
    for (const { node } of dolphins) {
      if ($("dolphin-light").checked) water.addReceiver(node);
      else water.removeReceiver(node);
    }
  };
  for (const control of document.querySelectorAll("button,input")) control.disabled = false;
  document.body.dataset.status = "ready";
  app.start(callbacks);

  // rendererは登録した粒子も所有する。モデルと手続き材質は作成側が解放する
  window.addEventListener("pagehide", () => {
    app.stop();
    renderer.destroy();
    waterSurface.destroy();
    model.runtime.destroy();
    scene.destroy();
  }, { once: true });
}

// 同期処理の例外を共通のエラー表示へ渡す
window.addEventListener("error", event => fail(event.error ?? event.message));
// 非同期初期化・資源切替の失敗も共通の表示へ渡す
window.addEventListener("unhandledrejection", event => fail(event.reason));
start().catch(fail);
