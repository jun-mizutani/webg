// ---------------------------------------------
// samples/proctex/main.js  2026/04/12
//   proctex sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Texture from "../../webg/Texture.js";

// webgクラスの役割:
// WebgApp : Screen / Shader / Space / Message / input / debug dock 初期化をまとめる
// SmoothShader: 手続きハイトマップと法線マップを貼った mapCube を描く
// Texture : 手続きハイトマップ生成と法線マップ生成を担当する
// Shape   : mapCube のメッシュと材質設定を保持する

const FONT_FILE = "../../webg/font512.png";
const HUD_ROW_OPTIONS = {
  anchor: "top-left",
  x: 0,
  y: 0,
  color: [0.90, 0.95, 1.0],
  minScale: 0.68
};

let app = null;

const buildControlRows = (state, colorPresets) => [
  { line: "proctex sample (Texture.js procedural height)" },
  {
    label: "Texture",
    value: state.useTexture ? "ON" : "OFF",
    toggleKey: "T",
    toggleAction: "toggle"
  },
  {
    label: "Normal",
    value: state.useNormalMap ? "ON" : "OFF",
    toggleKey: "N",
    toggleAction: "toggle"
  },
  {
    label: "Pattern",
    value: state.pattern,
    cycleKey: "P",
    cycleAction: "noise / dots"
  },
  {
    label: "Color",
    value: `${state.colorIndex + 1}/${colorPresets.length}`,
    cycleKey: "C",
    cycleAction: "next"
  },
  {
    label: "Scale",
    value: state.scale.toFixed(2),
    decKey: "[",
    decAction: "-",
    incKey: "]",
    incAction: "+"
  },
  {
    label: "Bias",
    value: state.bias.toFixed(2),
    decKey: ",",
    decAction: "-",
    incKey: ".",
    incAction: "+"
  },
  {
    label: "Contrast",
    value: state.contrast.toFixed(2),
    decKey: ";",
    decAction: "-",
    incKey: "'",
    incAction: "+"
  },
  {
    label: "Seed",
    value: String(state.seed),
    decKey: "K",
    decAction: "-",
    incKey: "L",
    incAction: "+"
  },
  {
    label: "Normal Strength",
    value: state.normalStrength.toFixed(2),
    decKey: "J",
    decAction: "-",
    incKey: "U",
    incAction: "+"
  },
  {
    label: "Build Strength",
    value: state.buildStrength.toFixed(2)
  },
  {
    label: "Invert Height",
    value: state.invertHeight ? "ON" : "OFF",
    toggleKey: "I",
    toggleAction: "toggle"
  },
  {
    label: "Invert Y",
    value: state.invertY ? "ON" : "OFF",
    toggleKey: "Y",
    toggleAction: "toggle"
  },
  {
    label: "Rebuild",
    value: state.rebuilding ? "rebuilding" : "ready",
    key: "R",
    action: "force"
  },
  {
    line: `status=${state.rebuilding ? "rebuilding" : "ready"} tex=${state.useTexture ? "ON" : "OFF"} norm=${state.useNormalMap ? "ON" : "OFF"} pattern=${state.pattern}`
  }
];

const start = async () => {
  try {
    app = new WebgApp({
      document,
      shaderClass: SmoothShader,
      clearColor: [0.08, 0.11, 0.16, 1.0],
      viewAngle: 53.0,
      projectionNear: 0.1,
      projectionFar: 1000.0,
      messageFontTexture: FONT_FILE,
      messageScale: 0.70,
      debugTools: {
        mode: "release",
        system: "proctex",
        source: "samples/proctex/main.js",
        probeDefaultAfterFrames: 1
      },
      camera: {
        target: [0.0, 0.0, 0.0],
        distance: 19.6,
        yaw: 0.0,
        pitch: 0.0
      },
      lightPosition: [140.0, 180.0, 320.0, 1.0]
    });
    await app.init();

    // mapCube と 2 種類の texture を app で初期化した GPU 上へ準備する
    const gpu = app.getGL();
    const cubeShape = new Shape(gpu);
    cubeShape.applyPrimitiveAsset(Primitive.mapCube(10.0));
    cubeShape.endShape();
    const cubeNode = app.space.addNode(null, "procCube");
    cubeNode.addShape(cubeShape);

    const colorTex = new Texture(gpu);
    await colorTex.initPromise;
    const normalTex = new Texture(gpu);
    await normalTex.initPromise;

    // サンプル状態:
    // 表示フラグ、手続き生成パラメータ、法線強度、再生成状態をまとめる
    const state = {
      useTexture: true,
      useNormalMap: true,
      colorIndex: 0,
      pattern: "noise",
      scale: 15.0,
      contrast: 2.0,
      bias: 0.0,
      seed: 7,
      invertHeight: false,
      invertY: false,
      normalStrength: 2.5,
      buildStrength: 2.5,
      rebuilding: false,
      rebuildRequested: false
    };

    // Cキーで循環するシェーダ色プリセット（RGBA）
    const colorPresets = [
      [1.0, 1.0, 1.0, 1.0],
      [1.0, 0.20, 0.20, 1.0],
      [0.20, 1.0, 0.20, 1.0],
      [0.20, 0.45, 1.0, 1.0],
      [1.0, 1.0, 0.20, 1.0],
      [1.0, 0.20, 1.0, 1.0],
      [0.20, 1.0, 1.0, 1.0],
      [1.0, 0.88, 0.74, 1.0],
      [0.72, 0.86, 1.0, 1.0],
      [0.82, 1.0, 0.76, 1.0],
      [1.0, 0.76, 0.90, 1.0]
    ];

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    const applyMaterial = () => {
      // 現在 state を SmoothShader 材質へ反映する
      cubeShape.setMaterial("smooth-shader", {
        has_bone: 0,
        use_texture: state.useTexture ? 1 : 0,
        texture: colorTex,
        use_normal_map: state.useNormalMap ? 1 : 0,
        normal_texture: normalTex,
        normal_strength: state.normalStrength,
        color: colorPresets[state.colorIndex],
        ambient: 0.24,
        specular: 0.90,
        power: 56.0,
        emissive: 0.0
      });
    };

    const rebuildTextures = async () => {
      // まずハイトマップ生成オプションを組み立てる
      const procOptions = {
        pattern: state.pattern,
        width: 256,
        height: 256,
        scale: state.scale,
        seed: state.seed,
        contrast: state.contrast,
        bias: state.bias,
        invert: state.invertHeight
      };

      // パターン別に追加パラメータを切り替える
      if (state.pattern === "dots") {
        Object.assign(procOptions, {
          dotRadius: 0.32,
          dotRadiusRange: 1.0,
          jitter: 0.03,
          softness: 0.16,
          dotMode: "max",
          regularGrid: true
        });
      } else {
        Object.assign(procOptions, {
          octaves: 4,
          persistence: 0.52,
          lacunarity: 2.0
        });
      }

      // 同一ハイトマップをカラー用テクスチャとして適用する
      const heightMap = colorTex.makeProceduralHeightMapPixels(procOptions);
      colorTex.setImage(heightMap.image, heightMap.width, heightMap.height, 4);
      colorTex.setRepeat();

      // 同じハイトマップから法線マップを生成して適用する
      await normalTex.buildNormalMapFromHeightMap({
        source: heightMap.image,
        width: heightMap.width,
        height: heightMap.height,
        ncol: 4,
        channel: "luma",
        strength: state.buildStrength,
        wrap: true,
        invertY: state.invertY
      });
      normalTex.setRepeat();
    };

    const processRebuild = async () => {
      // 再生成要求があるときだけ、1回ずつ非同期実行する
      if (!state.rebuildRequested || state.rebuilding) return;
      state.rebuilding = true;
      state.rebuildRequested = false;
      try {
        await rebuildTextures();
        applyMaterial();
      } catch (err) {
        console.error("proctex rebuild failed:", err);
      } finally {
        state.rebuilding = false;
        if (state.rebuildRequested) {
          void processRebuild();
        }
      }
    };

    const requestRebuild = () => {
      // 再生成要求フラグを立て、処理キューを起動する
      state.rebuildRequested = true;
      void processRebuild();
    };

    const refreshHud = () => {
      // HUD と debug dock は同じ行情報を見るようにし、
      // 操作ガイドと現在値がずれないようにする
      app.setControlRows(buildControlRows(state, colorPresets), HUD_ROW_OPTIONS);
    };

    const handleKey = (key, ev = null) => {
      // キー操作でパラメータを更新し、必要なら再生成する
      if (ev?.repeat) return;
      const normalizedKey = String(key ?? "").toLowerCase();
      let changed = false;
      let regen = false;

      // 表示モード切り替え
      if (normalizedKey === "t") {
        state.useTexture = !state.useTexture;
        changed = true;
      } else if (normalizedKey === "n") {
        state.useNormalMap = !state.useNormalMap;
        changed = true;
      } else if (normalizedKey === "p") {
        state.pattern = state.pattern === "noise" ? "dots" : "noise";
        changed = true;
        regen = true;
      } else if (normalizedKey === "c") {
        state.colorIndex = (state.colorIndex + 1) % colorPresets.length;
        changed = true;
      // 手続きハイトマップ生成パラメータ
      } else if (normalizedKey === "[") {
        state.scale = clamp(state.scale - 0.5, 1.0, 32.0);
        changed = true;
        regen = true;
      } else if (normalizedKey === "]") {
        state.scale = clamp(state.scale + 0.5, 1.0, 32.0);
        changed = true;
        regen = true;
      } else if (normalizedKey === ",") {
        state.bias = clamp(state.bias - 0.05, -1.0, 1.0);
        changed = true;
        regen = true;
      } else if (normalizedKey === ".") {
        state.bias = clamp(state.bias + 0.05, -1.0, 1.0);
        changed = true;
        regen = true;
      } else if (normalizedKey === ";") {
        state.contrast = clamp(state.contrast - 0.1, 0.1, 3.0);
        changed = true;
        regen = true;
      } else if (normalizedKey === "'") {
        state.contrast = clamp(state.contrast + 0.1, 0.1, 3.0);
        changed = true;
        regen = true;
      } else if (normalizedKey === "k") {
        state.seed = Math.max(0, state.seed - 1);
        changed = true;
        regen = true;
      } else if (normalizedKey === "l") {
        state.seed = Math.min(9999, state.seed + 1);
        changed = true;
        regen = true;
      // 法線マップの強度・向き設定
      } else if (normalizedKey === "u") {
        state.normalStrength = clamp(state.normalStrength + 0.1, 0.0, 5.0);
        changed = true;
      } else if (normalizedKey === "j") {
        state.normalStrength = clamp(state.normalStrength - 0.1, 0.0, 5.0);
        changed = true;
      } else if (normalizedKey === "i") {
        state.invertHeight = !state.invertHeight;
        changed = true;
        regen = true;
      } else if (normalizedKey === "y") {
        state.invertY = !state.invertY;
        changed = true;
        regen = true;
      } else if (normalizedKey === "r") {
        // 現在パラメータのまま手動で再生成する
        changed = true;
        regen = true;
      } else {
        return;
      }

      ev?.preventDefault?.();
      if (changed) {
        state.buildStrength = state.normalStrength;
        applyMaterial();
        if (regen) requestRebuild();
        refreshHud();
      }
    };

    app.attachInput({
      onKeyDown: (key, ev) => handleKey(key, ev)
    });
    app.input.installTouchControls({
      // proctex でも PC ブラウザでタッチUIを確認できるよう常時表示する
      touchDeviceOnly: false,
      groups: [
        {
          id: "mode",
          buttons: [
            { key: "t", label: "T", kind: "action", ariaLabel: "toggle texture" },
            { key: "n", label: "N", kind: "action", ariaLabel: "toggle normal map" },
            { key: "p", label: "P", kind: "action", ariaLabel: "toggle pattern" },
            { key: "c", label: "C", kind: "action", ariaLabel: "next color" },
            { key: "r", label: "R", kind: "action", ariaLabel: "force rebuild" }
          ]
        },
        {
          id: "scaleBias",
          buttons: [
            { key: "[", label: "[", kind: "action", ariaLabel: "decrease scale" },
            { key: "]", label: "]", kind: "action", ariaLabel: "increase scale" },
            { key: ",", label: ",", kind: "action", ariaLabel: "decrease bias" },
            { key: ".", label: ".", kind: "action", ariaLabel: "increase bias" }
          ]
        },
        {
          id: "contrastSeed",
          buttons: [
            { key: ";", label: ";", kind: "action", ariaLabel: "decrease contrast" },
            { key: "'", label: "'", kind: "action", ariaLabel: "increase contrast" },
            { key: "k", label: "K", kind: "action", ariaLabel: "decrease seed" },
            { key: "l", label: "L", kind: "action", ariaLabel: "increase seed" }
          ]
        },
        {
          id: "normal",
          buttons: [
            { key: "u", label: "U", kind: "action", ariaLabel: "increase normal strength" },
            { key: "j", label: "J", kind: "action", ariaLabel: "decrease normal strength" },
            { key: "i", label: "I", kind: "action", ariaLabel: "invert height" },
            { key: "y", label: "Y", kind: "action", ariaLabel: "invert normal y" }
          ]
        }
      ],
      onAction: ({ key }) => handleKey(key)
    });

    // 初回表示用に1度生成してからループを開始する
    await rebuildTextures();
    applyMaterial();
    refreshHud();

    app.start({
      onUpdate: () => {
        // キューブをゆっくり回転し、3D描画とHUD描画を行う
        cubeNode.rotateY(0.22);
        cubeNode.rotateX(0.12);
        refreshHud();
      }
    });
  } catch (err) {
    // 初期化失敗時は WebgApp の固定パネルに出し、原因を追いやすくする
    console.error("proctex start failed:", err);
    app?.showErrorPanel?.(err, {
      title: "proctex failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  }
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    console.error("proctex bootstrap failed:", err);
    app?.showErrorPanel?.(err, {
      title: "proctex bootstrap failed",
      id: "bootstrap-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  });
});
