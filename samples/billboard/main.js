// -------------------------------------------------
// billboard sample
//   main.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Texture from "../../webg/Texture.js";
import Billboard from "../../webg/Billboard.js";
import Diagnostics from "../../webg/Diagnostics.js";
import DebugConfig from "../../webg/DebugConfig.js";

// billboard sample の役割:
// - `Billboard` で常に camera 正面を向く particle を描く最小アプリ
// - procedural billboard texture を smoke / debris の 2 系統で切り替え、
//   alpha edge と中心濃度の違いをその場で比較する
// - `WebgApp` を使い、canvas HUD と HTML debug dock の両方へ
//   同じ controls row を流して、教材 sample として読みやすくする

const PARTICLE_MAX = 320;
const FLOOR_Y = -12.0;
const FLOOR_HEIGHT = 4.0;
const CORE_RADIUS = 4.5;
const CORE_BASE_Y = 7.5;
const SHADOW_Y = FLOOR_Y + FLOOR_HEIGHT * 0.5 + 0.12;
const CAMERA_PITCH_MIN = -50.0;
const CAMERA_PITCH_MAX = 15.0;
const HUD_ROW_OPTIONS = {
  anchor: "top-left",
  x: 0,
  y: 0,
  color: [0.90, 0.95, 1.0],
  minScale: 0.80
};

let app = null;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "billboard",
      source: "samples/billboard/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("billboard failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "billboard failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  });
});

const createFloorShape = (gpu) => {
  // billboard の奥行き感を拾いやすくするため、薄い床だけを置く
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(120.0, FLOOR_HEIGHT, 120.0, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    color: [0.31, 0.35, 0.43, 1.0],
    ambient: 0.36,
    specular: 0.48,
    power: 30.0,
    emissive: 0.0
  });
  return shape;
};

const createCoreShape = (gpu) => {
  // 旧 sample の大きな回転柱は存在感が強すぎたため、
  // particle の見えを邪魔しにくい小さめの sphere へ差し替える
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.sphere(CORE_RADIUS, 24, 24, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    color: [0.34, 0.48, 0.78, 1.0],
    ambient: 0.06,
    specular: 1.28,
    power: 92.0,
    emissive: 0.0
  });
  return shape;
};

const createTexture = async (gpu, builder) => {
  const tex = new Texture(gpu);
  await tex.initPromise;
  builder(tex);
  tex.setClamp();
  return tex;
};

const makeControlRows = (state, aliveCount) => {
  const boost = state.centerBoostByMode[state.mode];
  const rows = [
    { line: "billboard sample" },
    {
      label: "Burst",
      value: `${aliveCount}/${PARTICLE_MAX}`,
      keys: [
        { key: "Space", action: "burst" },
        { key: "C", action: "clear" }
      ],
      note: "spawn / clear particles"
    },
    {
      label: "Mode",
      value: state.mode,
      keys: [
        { key: "1", action: "smoke" },
        { key: "2", action: "debris" }
      ],
      note: "procedural billboard texture"
    },
    {
      label: "Size",
      value: state.spawnSize.toFixed(2),
      keys: [
        { key: "[", action: "-" },
        { key: "]", action: "+" }
      ]
    },
    {
      label: "CenterBoost",
      value: boost.toFixed(2),
      keys: [
        { key: "-", action: "-" },
        { key: "=", action: "+" }
      ],
      note: `smoke=${state.centerBoostByMode.smoke.toFixed(2)} debris=${state.centerBoostByMode.debris.toFixed(2)}`
    },
    {
      label: "Camera",
      value: `yaw=${state.cameraYawDeg.toFixed(0)} pitch=${state.cameraPitchDeg.toFixed(0)}`,
      note: "Arrow orbit  [R] reset"
    },
    {
      label: "Debug",
      value: DebugConfig.mode,
      keys: [
        { key: "F9" },
        { key: "M", action: "mode" }
      ]
    },
    { line: app.getDiagnosticsStatusLine() }
  ];
  const probeLine = app.getProbeStatusLine();
  if (probeLine) rows.push({ line: probeLine });
  return rows;
};

const start = async () => {
  app = new WebgApp({
    document,
    clearColor: [0.08, 0.10, 0.15, 1.0],
    viewAngle: 52.0,
    projectionNear: 0.1,
    projectionFar: 1200.0,
    messageFontTexture: "../../webg/font512.png",
    debugTools: {
      mode: "debug",
      system: "billboard",
      source: "samples/billboard/main.js",
      probeDefaultAfterFrames: 1
    },
    light: {
      mode: "world-node",
      nodeName: "light",
      position: [34.0, 56.0, 18.0],
      type: 1.0
    },
    camera: {
      target: [0.0, 10.0, 0.0],
      distance: 62.0,
      yaw: 0.0,
      pitch: -12.0
    }
  });
  await app.init();

  app.setDiagnosticsStage("build-scene");

  const floorShape = createFloorShape(app.getGL());
  const coreShape = createCoreShape(app.getGL());

  const floorNode = app.space.addNode(null, "floor");
  floorNode.setPosition(0.0, FLOOR_Y, 0.0);
  floorNode.addShape(floorShape);

  const coreNode = app.space.addNode(null, "coreSphere");
  coreNode.setPosition(0.0, CORE_BASE_Y, 0.0);
  coreNode.addShape(coreShape);

  app.setDiagnosticsStage("build-texture");

  const smokeTex = await createTexture(app.getGL(), (tex) => {
    tex.buildProceduralBillboardTexture({
      width: 96,
      height: 96,
      style: "smoke",
      seed: 11,
      noiseScale: 5.6,
      noiseAmount: 0.66,
      dotsAmount: 0.24,
      edgeSoftness: 0.24,
      radius: 0.90,
      centerBoost: 1.55,
      alphaPower: 0.72
    });
  });
  const debrisTex = await createTexture(app.getGL(), (tex) => {
    tex.buildProceduralBillboardTexture({
      width: 96,
      height: 96,
      style: "debris",
      seed: 73,
      noiseScale: 7.8,
      noiseAmount: 0.75,
      dotsAmount: 0.45,
      edgeSoftness: 0.18,
      radius: 0.84,
      centerBoost: 1.70,
      alphaPower: 0.68
    });
  });

  app.setDiagnosticsStage("build-billboard");

  const billboard = new Billboard(app.getGL(), PARTICLE_MAX);
  await billboard.init();
  billboard.setTexture(smokeTex);
  billboard.setOpacity(1.0);
  const shadowBillboard = new Billboard(app.getGL(), PARTICLE_MAX);
  await shadowBillboard.init();
  shadowBillboard.setTexture(smokeTex);
  shadowBillboard.setOpacity(1.0);

  const particles = Array.from({ length: PARTICLE_MAX }, () => ({
    x: 0.0,
    y: 0.0,
    z: 0.0,
    vx: 0.0,
    vy: 0.0,
    vz: 0.0,
    life: 0.0,
    maxLife: 1.0,
    size: 0.9
  }));

  const state = {
    mode: "smoke",
    spawnSize: 1.0,
    centerBoostByMode: {
      smoke: 1.55,
      debris: 1.70
    },
    cameraYawDeg: 0.0,
    cameraPitchDeg: -12.0
  };

  const updateCamera = () => {
    // WebgApp の camera rig をそのまま使い、
    // billboard と背景 scene の両方へ同じ orbit 視点を適用する
    app.cameraRig.setAttitude(state.cameraYawDeg, state.cameraPitchDeg, 0.0);
    app.eye.setPosition(0.0, 0.0, app.camera.distance);
  };
  updateCamera();

  const rebuildCurrentTexture = () => {
    // centerBoost は mode ごとに独立保持し、
    // 現在 mode の texture だけを再生成して比較しやすくする
    if (state.mode === "debris") {
      debrisTex.buildProceduralBillboardTexture({
        width: 96,
        height: 96,
        style: "debris",
        seed: 73,
        noiseScale: 7.8,
        noiseAmount: 0.75,
        dotsAmount: 0.45,
        edgeSoftness: 0.18,
        radius: 0.84,
        centerBoost: state.centerBoostByMode.debris,
        alphaPower: 0.68
      });
      debrisTex.setClamp();
      billboard.setTexture(debrisTex);
      shadowBillboard.setTexture(debrisTex);
      return;
    }
    smokeTex.buildProceduralBillboardTexture({
      width: 96,
      height: 96,
      style: "smoke",
      seed: 11,
      noiseScale: 5.6,
      noiseAmount: 0.66,
      dotsAmount: 0.24,
      edgeSoftness: 0.24,
      radius: 0.90,
      centerBoost: state.centerBoostByMode.smoke,
      alphaPower: 0.72
    });
    smokeTex.setClamp();
    billboard.setTexture(smokeTex);
    shadowBillboard.setTexture(smokeTex);
  };

  const getAliveCount = () => {
    let n = 0;
    for (let i = 0; i < particles.length; i++) {
      if (particles[i].life > 0.0) n++;
    }
    return n;
  };

  const spawnBurst = (count = 56) => {
    // 空き slot を再利用して particle を生成し、
    // billboard 側は毎 frame addBillboard だけを行う
    let spawned = 0;
    for (let i = 0; i < particles.length && spawned < count; i++) {
      const p = particles[i];
      if (p.life > 0.0) continue;
      const a = Math.random() * Math.PI * 2.0;
      const radius = Math.random() * 2.0;
      const speed = 11.0 + Math.random() * 15.0;
      p.x = Math.cos(a) * radius;
      p.z = Math.sin(a) * radius;
      p.y = 2.8 + Math.random() * 1.8;
      p.vx = Math.cos(a) * speed;
      p.vz = Math.sin(a) * speed;
      p.vy = 10.0 + Math.random() * 11.0;
      p.maxLife = 0.9 + Math.random() * 0.8;
      p.life = p.maxLife;
      p.size = (0.38 + Math.random() * 0.36) * state.spawnSize;
      spawned++;
    }
  };

  const clearParticles = () => {
    for (let i = 0; i < particles.length; i++) {
      particles[i].life = 0.0;
    }
  };

  const updateParticles = (dt) => {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.life <= 0.0) continue;
      p.life -= dt;
      if (p.life <= 0.0) continue;
      p.vy -= 18.0 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < FLOOR_Y + FLOOR_HEIGHT * 0.5 + 2.0) {
        p.life = 0.0;
      }
    }
  };

  const refreshDiagnosticsStats = (frameCount) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-check",
      shapes: [floorShape, coreShape]
    });
    app.mergeDiagnosticsStats({
      frameCount,
      mode: state.mode,
      alive: getAliveCount(),
      spawnSize: state.spawnSize.toFixed(2),
      centerBoost: state.centerBoostByMode[state.mode].toFixed(2),
      cameraYaw: state.cameraYawDeg.toFixed(1),
      cameraPitch: state.cameraPitchDeg.toFixed(1),
      envOk: envReport.ok ? "yes" : "no",
      envWarning: envReport.warnings?.[0] ?? "-"
    });
    return envReport;
  };

  const makeProbeReport = (frameCount) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-probe",
      shapes: [floorShape, coreShape]
    });
    const report = app.createProbeReport("runtime-probe");
    Diagnostics.addDetail(report, `mode=${state.mode}`);
    Diagnostics.addDetail(report, `alive=${getAliveCount()}/${PARTICLE_MAX}`);
    Diagnostics.addDetail(report, `spawnSize=${state.spawnSize.toFixed(2)}`);
    Diagnostics.addDetail(report, `centerBoost(smoke)=${state.centerBoostByMode.smoke.toFixed(2)}`);
    Diagnostics.addDetail(report, `centerBoost(debris)=${state.centerBoostByMode.debris.toFixed(2)}`);
    Diagnostics.addDetail(report, `camera=${state.cameraYawDeg.toFixed(1)}/${state.cameraPitchDeg.toFixed(1)}`);
    if (envReport.warnings?.length) {
      Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
    }
    Diagnostics.mergeStats(report, {
      frameCount,
      mode: state.mode,
      alive: getAliveCount(),
      envOk: envReport.ok ? "yes" : "no"
    });
    return report;
  };

  app.configureDiagnosticsCapture({
    labelPrefix: "billboard",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  const applyKeyAction = (key) => {
    if (key === "space") {
      spawnBurst(56);
      return true;
    }
    if (key === "1") {
      state.mode = "smoke";
      billboard.setTexture(smokeTex);
      shadowBillboard.setTexture(smokeTex);
      return true;
    }
    if (key === "2") {
      state.mode = "debris";
      billboard.setTexture(debrisTex);
      shadowBillboard.setTexture(debrisTex);
      return true;
    }
    if (key === "[") {
      state.spawnSize = clamp(state.spawnSize - 0.08, 0.35, 2.8);
      return true;
    }
    if (key === "]") {
      state.spawnSize = clamp(state.spawnSize + 0.08, 0.35, 2.8);
      return true;
    }
    if (key === "-") {
      state.centerBoostByMode[state.mode] = clamp(state.centerBoostByMode[state.mode] - 0.08, 0.40, 3.00);
      rebuildCurrentTexture();
      return true;
    }
    if (key === "=") {
      state.centerBoostByMode[state.mode] = clamp(state.centerBoostByMode[state.mode] + 0.08, 0.40, 3.00);
      rebuildCurrentTexture();
      return true;
    }
    if (key === "r") {
      state.cameraYawDeg = 0.0;
      state.cameraPitchDeg = -12.0;
      updateCamera();
      return true;
    }
    if (key === "c") {
      clearParticles();
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
        id: "camera",
        buttons: [
          { key: "arrowleft", label: "\u2190", kind: "hold", ariaLabel: "camera left" },
          { key: "arrowright", label: "\u2192", kind: "hold", ariaLabel: "camera right" },
          { key: "arrowup", label: "\u2191", kind: "hold", ariaLabel: "camera up" },
          { key: "arrowdown", label: "\u2193", kind: "hold", ariaLabel: "camera down" }
        ]
      },
      {
        id: "mode",
        buttons: [
          { key: " ", label: "BURST", kind: "action", ariaLabel: "spawn burst" },
          { key: "1", label: "1", kind: "action", ariaLabel: "set smoke mode" },
          { key: "2", label: "2", kind: "action", ariaLabel: "set debris mode" },
          { key: "c", label: "C", kind: "action", ariaLabel: "clear particles" }
        ]
      },
      {
        id: "tune",
        buttons: [
          { key: "[", label: "[", kind: "action", ariaLabel: "decrease spawn size" },
          { key: "]", label: "]", kind: "action", ariaLabel: "increase spawn size" },
          { key: "-", label: "-", kind: "action", ariaLabel: "decrease center boost" },
          { key: "=", label: "+", kind: "action", ariaLabel: "increase center boost" }
        ]
      }
    ],
    onAction: ({ key }) => applyKeyAction(String(key).toLowerCase())
  });

  app.setDiagnosticsStage("runtime");
  app.start({
    onUpdate: ({ timeSec, deltaSec, input, screen }) => {
      // camera orbit は左右で yaw、上下で pitch を更新する
      if (input.has("arrowleft")) state.cameraYawDeg += deltaSec * 86.0;
      if (input.has("arrowright")) state.cameraYawDeg -= deltaSec * 86.0;
      if (input.has("arrowup")) state.cameraPitchDeg = clamp(state.cameraPitchDeg + deltaSec * 68.0, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
      if (input.has("arrowdown")) state.cameraPitchDeg = clamp(state.cameraPitchDeg - deltaSec * 68.0, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
      updateCamera();

      // 背景 object も完全静止にせず、少し上下させて depth 感を残す
      // Y 回転も足し、specular の動きから球面の陰影を読み取りやすくする
      coreNode.setPosition(0.0, CORE_BASE_Y + Math.sin(timeSec * 0.75) * 0.8, 0.0);
      coreNode.setAttitude(timeSec * 24.0, 0.0, 0.0);
      updateParticles(deltaSec);

      billboard.clear();
      shadowBillboard.clear();
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (p.life <= 0.0) continue;
        const t = clamp(p.life / p.maxLife, 0.0, 1.0);
        const alpha = t;
        const sx = p.size * (0.85 + (1.0 - t) * 1.8);
        const sy = p.size * (0.85 + (1.0 - t) * 1.8);
        const color = state.mode === "debris"
          ? [1.0, 0.78, 0.52, alpha]
          : [1.0, 1.0, 1.0, alpha];
        billboard.addBillboard(p.x, p.y, p.z, sx, sy, color);

        // 地面へ寝かせる影 billboard
        // height が高いほど影を少し薄く小さくして、particle 本体との関係を見やすくする
        const heightFade = clamp(1.0 - Math.max(0.0, p.y - SHADOW_Y) / 18.0, 0.18, 1.0);
        const shadowAlpha = alpha * 0.62 * heightFade;
        const shadowScale = p.size * (1.18 + (1.0 - t) * 1.9) * 2.0;
        shadowBillboard.addBillboard(
          p.x,
          SHADOW_Y,
          p.z,
          shadowScale,
          shadowScale,
          [0.0, 0.0, 0.0, shadowAlpha]
        );
      }

      refreshDiagnosticsStats(screen.getFrameCount());
      app.setControlRows(makeControlRows(state, getAliveCount()), HUD_ROW_OPTIONS);
      app.updateDebugProbe();
    },
    onAfterDraw3d: () => {
      // background scene を描いたあと、同じ eye / projection で billboard を重ねる
      billboard.draw(app.eye, app.projectionMatrix);
      shadowBillboard.drawGround(app.eye, app.projectionMatrix);
    }
  });
};
