// ---------------------------------------------
// samples/opacity/main.js  2026/07/27
//   Mixed opaque/translucent Shape with deferred color effects
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";
import {
  COMPUTE_BLOOM_DEFAULTS
} from "../../webg/ComputeBloomPass.js?v=20260723_image_pyramid";
import FullscreenPass from "../../webg/FullscreenPass.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import WebgApp from "../../webg/WebgApp.js";
import util from "../../webg/util.js";

let app = null;
let pipeline = null;
let copyPass = null;
let foregroundTorusNode = null;
let foregroundTorusShape = null;
const controlledTranslucentMaterials = [];
const animatedNodes = [];

// opaqueのDeferred Lightingと透明forward描画で共通の明るさ基準を使う
// pipeline生成時とframeごとのencode時へ同じ値を渡し、UI操作で差が生じないよう固定する
const lightingSettings = Object.freeze({
  ambient: 0.18,
  directionalIntensity: 1.25
});
const displayExposure = 1.18;

// UI値を描画frameから直接参照できる小さな状態へまとめる
// checkboxのDOM状態をpipeline呼び出しの途中で何度も読むことを避け、変更箇所を追いやすくする
const state = {
  ssao: true,
  shadow: true,
  ssr: true,
  toon: false,
  dof: false,
  bloom: false,
  edge: false,
  pause: false,
  alpha: 0.42,
  roughness: 0.25
};

// G-bufferが必要とするsurface値と、透明分類に使うalphaを一つのmaterial定義にする
// color[3]は従来のtexture混合係数なので透明度には使わず、alphaを独立して指定する
function createMaterial(color, options = {}) {
  return {
    has_bone: 0,
    use_texture: 0,
    color: [color[0], color[1], color[2], 1.0],
    alpha: options.alpha ?? 1.0,
    ambient: options.ambient ?? 0.16,
    specular: options.specular ?? 0.30,
    roughness: options.roughness ?? 0.46,
    metallic: options.metallic ?? 0.0,
    power: options.power ?? 30.0,
    emissive: options.emissive ?? 0.0,
    flat_shading: options.flatShading ?? 0
  };
}

// 1つのShapeへmaterial slot 0と1を登録し、checker状にtriangleを割り当てる
// 頂点は隣接cellで共有するがmaterial番号はtriangle単位なので、共有頂点を複製する必要はない
function createMixedPanel(gpu) {
  const shape = new Shape(gpu);
  shape.setMaterial("smooth-shader", createMaterial([0.95, 0.50, 0.12], {
    alpha: 1.0,
    roughness: 0.30,
    metallic: 0.08
  }));
  shape.setMaterialAt(1, "smooth-shader", createMaterial([0.12, 0.72, 0.98], {
    alpha: state.alpha,
    ambient: 0.24,
    specular: 0.46,
    roughness: state.roughness,
    emissive: 0.08
  }));

  const columns = 3;
  const rows = 2;
  const vertices = [];
  for (let row = 0; row <= rows; row++) {
    const y = -2.3 + row * 2.3;
    for (let column = 0; column <= columns; column++) {
      const x = -3.4 + column * (6.8 / columns);
      // Shape.addVertex()は追加後の頂点数を返すため、indexには1を引いた値を保存する
      vertices.push(shape.addVertex(x, y, 0.0) - 1);
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const bottomLeft = vertices[row * (columns + 1) + column];
      const bottomRight = vertices[row * (columns + 1) + column + 1];
      const topLeft = vertices[(row + 1) * (columns + 1) + column];
      const topRight = vertices[(row + 1) * (columns + 1) + column + 1];
      // 左上と右下だけをopaqueとし、残りのcellを同じShape内のtranslucent materialにする
      const materialIndex = (row === 1 && column === 0) || (row === 0 && column === 2)
        ? 0
        : 1;
      shape.addTriangle(bottomLeft, bottomRight, topRight, materialIndex);
      shape.addTriangle(bottomLeft, topRight, topLeft, materialIndex);
    }
  }
  shape.endShape();
  return shape;
}

// Primitive由来Shapeへ、G-bufferで省略できないmaterial値を明示してopaque物体を作る
function createOpaquePrimitive(gpu, primitiveAsset, color, options = {}) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(primitiveAsset);
  shape.endShape();
  shape.setMaterial("smooth-shader", createMaterial(color, {
    alpha: 1.0,
    ambient: options.ambient ?? 0.13,
    specular: options.specular ?? 0.32,
    roughness: options.roughness ?? 0.48,
    metallic: options.metallic ?? 0.0,
    emissive: options.emissive ?? 0.0
  }));
  return shape;
}

// 半透明専用のShapeを作成し、alpha指定忘れを不透明表示へ置き換えず初期化時に検出する
// 作成した全三角形は、他のShapeに含まれる透明三角形と同じglobal queueでsortされる
function createTranslucentPrimitive(gpu, primitiveAsset, color, options) {
  util.readFiniteNumber(options?.alpha, "translucent primitive alpha", {
    min: 0.0,
    maxExclusive: 1.0
  });

  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(primitiveAsset);
  shape.endShape();
  shape.setMaterial("smooth-shader", createMaterial(color, options));
  return shape;
}

// ShapeをSpaceのroot Nodeへ登録し、位置と姿勢を同じ箇所で確定する
function addShapeNode(name, shape, position, attitude = [0, 0, 0]) {
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.setAttitude(...attitude);
  node.addShape(shape);
  return node;
}

// mixed Shapeを3枚重ね、Shapeをまたぐ透明triangleも一つのglobal queueでsortされる配置を作る
// 完全な交差面は仕様範囲外なので、主なpaneは奥行きをずらし、回転時に近接する状態だけを観察できるようにする
function createScene() {
  const gpu = app.getGPU();
  const basePanel = createMixedPanel(gpu);
  const middlePanel = basePanel.createInstance();
  const rearPanel = basePanel.createInstance();
  middlePanel.updateMaterialAt(0, {
    color: [0.38, 0.94, 0.34, 1.0]
  });
  middlePanel.updateMaterialAt(1, {
    color: [0.86, 0.28, 0.94, 1.0]
  });
  rearPanel.updateMaterialAt(0, {
    color: [0.98, 0.82, 0.22, 1.0]
  });
  rearPanel.updateMaterialAt(1, {
    color: [0.20, 0.92, 0.78, 1.0]
  });
  controlledTranslucentMaterials.push(
    { shape: basePanel, materialIndex: 1 },
    { shape: middlePanel, materialIndex: 1 },
    { shape: rearPanel, materialIndex: 1 }
  );

  animatedNodes.push(
    addShapeNode("mixed-front", basePanel, [-1.5, 0.3, -2.0], [0, -16, 0]),
    addShapeNode("mixed-middle", middlePanel, [1.0, 0.1, -4.2], [0, 11, 0]),
    addShapeNode("mixed-rear", rearPanel, [0.0, -0.2, -6.4], [0, -7, 0])
  );

  const floor = createOpaquePrimitive(
    gpu,
    Primitive.cuboid(22, 0.7, 20, {}),
    [0.23, 0.29, 0.39],
    { roughness: 0.58, metallic: 0.08 }
  );
  const marker = createOpaquePrimitive(
    gpu,
    Primitive.sphere(1.35, 24, 16, {}),
    [1.0, 0.34, 0.10],
    { roughness: 0.18, metallic: 0.12, emissive: 0.78 }
  );
  const rearCube = createOpaquePrimitive(
    gpu,
    Primitive.cube(3.5, {}),
    [0.16, 0.46, 0.98],
    { roughness: 0.26, metallic: 0.18 }
  );
  addShapeNode("floor", floor, [0, -3.0, -4.0]);
  addShapeNode("bloom-marker", marker, [-5.2, -1.45, -4.0]);
  animatedNodes.push(addShapeNode("rear-cube", rearCube, [4.8, -1.1, -7.0], [18, 24, 0]));

  // 中央手前のトーラスは独立した透明Shapeとし、パネルとは別のalphaを保つ
  // 異なるShapeの透明面が重なっても、利用側で追加のRender Passを構成する必要はない
  // major radiusとtube radiusの和を1.5にして、置き換え前の立方体と外径をそろえる
  foregroundTorusShape = createTranslucentPrimitive(
    gpu,
    Primitive.donut(1.08, 0.42, 12, 24, {}),
    [1.0, 0.78, 0.08],
    {
      alpha: state.alpha,
      ambient: 0.28,
      specular: 0.90,
      roughness: state.roughness,
      metallic: 0.02,
      emissive: 0.08
    }
  );
  foregroundTorusNode = addShapeNode(
    "foreground-translucent-torus",
    foregroundTorusShape,
    [0.0, -1.15, 0.3],
    [68, 18, 8]
  );
  controlledTranslucentMaterials.push({
    shape: foregroundTorusShape,
    materialIndex: 0
  });
}

// checkboxとrangeをstateへ結び、透明度と表面粗さを描画中のmaterialへ反映する
// 共通の対象一覧を使い、市松パネルとトーラスで一方だけ更新を忘れない構成にする
function bindControls() {
  const checkboxIds = ["ssao", "shadow", "ssr", "toon", "dof", "bloom", "edge", "pause"];
  for (const id of checkboxIds) {
    const input = document.getElementById(id);
    input.addEventListener("change", () => {
      state[id] = input.checked;
    });
  }
  const alphaInput = document.getElementById("alpha");
  const alphaValue = document.getElementById("alphaValue");
  alphaInput.addEventListener("input", () => {
    const value = util.readFiniteNumber(Number(alphaInput.value), "opacity alpha", {
      min: 0.0,
      max: 1.0
    });
    state.alpha = value;
    alphaValue.value = value.toFixed(2);
    for (const target of controlledTranslucentMaterials) {
      target.shape.updateMaterialAt(target.materialIndex, { alpha: value });
    }
  });

  const roughnessInput = document.getElementById("roughness");
  const roughnessValue = document.getElementById("roughnessValue");
  roughnessInput.addEventListener("input", () => {
    const value = util.readFiniteNumber(Number(roughnessInput.value), "translucent roughness", {
      min: 0.04,
      max: 1.0
    });
    state.roughness = value;
    roughnessValue.value = value.toFixed(2);
    for (const target of controlledTranslucentMaterials) {
      target.shape.updateMaterialAt(target.materialIndex, { roughness: value });
    }
  });
}

// 初期化失敗をcanvas背後へ隠さず、操作panel内とconsoleの両方へ表示する
function reportError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  document.getElementById("error").textContent = message;
  document.getElementById("status").textContent = "failed";
  console.error("opacity sample failed:", error);
}

// WebgAppはframe、camera、present passを管理し、ComputeEffectPipelineは追加passをsample側へ露出しない
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    renderMode: "ondemand",
    clearColor: [0.04, 0.075, 0.12, 1.0],
    viewAngle: 50,
    projectionFar: 100,
    camera: {
      target: [0, -0.2, -4.2],
      distance: 17.2,
      yaw: 8,
      pitch: -7
    }
  });
  await app.init();
  app.createOrbitEyeRig({
    target: [0, -0.2, -4.2],
    distance: 17.2,
    yaw: 8,
    pitch: -7,
    minDistance: 10,
    maxDistance: 34
  });
  createScene();
  bindControls();

  const gpu = app.getGPU();
  pipeline = new ComputeEffectPipeline(gpu, {
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    lighting: lightingSettings,
    bloom: {
      ...COMPUTE_BLOOM_DEFAULTS,
      strength: 0.78
    },
    // 画像Pyramidのfilter radiusは現行ComputeDofPassの検証範囲0.25〜3.0に合わせる
    // cocScaleは焦点面から離れた距離をCoCへ変換する倍率として現行名を明示する
    dof: {
      focusDistance: 18,
      focusRange: 7,
      cocScale: 0.88,
      blurRadius: 3.0
    },
    toon: {
      levels: 4,
      floor: 0.14
    }
  });
  copyPass = new FullscreenPass(gpu);
  await Promise.all([pipeline.ready, copyPass.init()]);
  document.getElementById("status").textContent = "drag to orbit / alpha 1.0 makes panels and torus opaque";

  app.start({
    // panelとtorusをゆっくり動かし、cameraからのtriangle depth順がframeごとに更新されることを見せる
    onUpdate: ({ deltaSec, timeMs, screen }) => {
      if (!state.pause) {
        // 一方向へ回し続けると3枚とも裏面になる時間帯が生じるため、
        // material比較では正面付近を保つ小さな往復回転だけを与える
        const phase = timeMs * 0.001;
        animatedNodes[0].setAttitude(0, -16 + Math.sin(phase * 0.70) * 7, 0);
        animatedNodes[1].setAttitude(0, 11 + Math.sin(phase * 0.57 + 1.4) * 7, 0);
        animatedNodes[2].setAttitude(0, -7 + Math.sin(phase * 0.48 + 2.8) * 6, 0);
        animatedNodes[3].rotateX(10.0 * deltaSec);
        animatedNodes[3].rotateY(14.0 * deltaSec);
        // 穴がCamera側を向く姿勢を保ったまま小さく揺らし、ドーナッツ形状を常に判別できるようにする
        foregroundTorusNode.setAttitude(
          68 + Math.sin(phase * 0.43) * 7,
          18 + Math.sin(phase * 0.37 + 0.8) * 9,
          8 + Math.sin(phase * 0.51 + 1.6) * 6
        );
      }
      pipeline.resize(screen.getWidth(), screen.getHeight());
    },

    // renderScene()は全Shapeからalpha 1.0のtriangleだけをG-bufferとopaque depthへ記録する
    onBeforeDraw: ({ cameraFrame }) => {
      pipeline.renderScene(app.space, cameraFrame, app.clearColor, {
        shadowEnabled: state.shadow
      });
    },

    // encode()内部で透明triangleをsort・HDR合成し、その後に有効なcolor effectを順番に適用する
    onAfterDraw3d: ({ cameraFrame }) => {
      gpu.endPass();
      const finalColor = pipeline.encode(gpu.commandEncoder, {
        cameraFrame,
        ssaoEnabled: state.ssao,
        shadowEnabled: state.shadow,
        ssrEnabled: state.ssr,
        toonEnabled: state.toon,
        dofEnabled: state.dof,
        bloomEnabled: state.bloom,
        edgeEnabled: state.edge,
        edgeGeometryEnabled: true,
        lighting: lightingSettings,
        toneMap: {
          mode: "reinhard",
          exposure: displayExposure,
          saturation: 1.05,
          gamma: 2.2
        }
      });
      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      copyPass.draw(finalColor);
      app.screen.clearDepthBuffer();
    }
  });

  window.addEventListener("pagehide", () => {
    app.stop();
    copyPass.destroy?.();
    pipeline.destroy();
  }, { once: true });
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch(reportError);
});
