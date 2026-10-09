// ---------------------------------------------
// samples/procedural_texture/main.js  2026/08/14
//   Six-face procedural tiled texture comparison with an orbit camera
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
import Background from "../../webg/Background.js";
import Diagnostics from "../../webg/Diagnostics.js";
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";
import {
  buildErrorPanelOptions,
  buildHelpPanelOptions
} from "../../webg/OverlayPanelPresets.js";
import {
  ProceduralTextureFieldCache,
  ProceduralTextureSet,
  ProceduralTiledSurface
} from "./ProceduralTiledSurface.js";
import ProceduralMaterials from "../../webg/ProceduralMaterials.js";

// このサンプルが示す処理:
// - presetと少数の上書きからColor mapとHeight mapを生成する
// - Height mapからNormal mapを作り、Color mapと同じUVで面へ貼る
// - 一つのShapeの6 material slotへ面ごとに異なるtextureを割り当てる
// - 軌道カメラで立方体の全方向を観察し、長手方向や凹凸差を比較する

// 立方体一辺の実寸をmeterで定義し、頂点座標と各面のUV反復回数へ同じ値を使用する
// 材質側の部材寸法は変更せず、3m面の中へ実寸比を保った回数だけtextureを反復する
const CUBE_SIZE_METERS = 3.0;
const CUBE_HALF_SIZE_METERS = CUBE_SIZE_METERS * 0.5;
const NORMAL_STRENGTH = 1.6;
const BACKGROUND_PREVIEW_MARGIN_PIXELS = 24;
const BACKGROUND_PREVIEW_GAP_PIXELS = 12;

// 3m立方体を見渡せるよう、視点距離とzoom範囲を設定する
// targetと角度は維持し、立方体の大きさ以外で比較時の見える面が変わらないようにする
const CAMERA_CONFIG = {
  target: [0.0, 0.0, 0.0],
  distance: 6.75,
  yaw: 32.0,
  pitch: -22.0,
  minDistance: 4.0,
  maxDistance: 12.0,
  wheelZoomStep: 0.4
};

// 6面へ異なる材質presetを割り当て、木材、コンクリート、レンガを同じ照明で比較する
// +Z面だけはCommand Paletteの編集対象とし、他の5面はcatalog基準値を維持する
const FACE_VARIANTS = [
  {
    id: "front",
    presetId: "wood.oak.plank",
    label: "+Z オーク",
    detail: "明るい広葉樹。Palette編集対象",
    swatch: "#a96932",
    render: { roughness: 0.58, specular: 0.48 }
  },
  {
    id: "right",
    presetId: "wood.walnut.plank",
    label: "+X ウォールナット",
    detail: "暗色の広葉樹と細い木理",
    swatch: "#542719",
    render: { roughness: 0.54, specular: 0.50 }
  },
  {
    id: "back",
    presetId: "wood.cedar.deck",
    label: "-Z シダー",
    detail: "赤みのある針葉樹デッキ材",
    swatch: "#a94e25",
    render: { roughness: 0.66, specular: 0.42 }
  },
  {
    id: "left",
    presetId: "concrete.slab.light",
    label: "-X コンクリートパネル",
    detail: "淡色の斑と細かな面粗さ",
    swatch: "#8a8c88",
    render: { roughness: 0.90, specular: 0.22 }
  },
  {
    id: "top",
    presetId: "concrete.block.gray",
    label: "+Y コンクリートブロック",
    detail: "粗い骨材感と深い目地",
    swatch: "#696c69",
    render: { roughness: 0.94, specular: 0.18 }
  },
  {
    id: "bottom",
    presetId: "brick.running.red",
    label: "-Y 赤レンガ",
    detail: "焼きむらと細かな粒状面",
    swatch: "#8f3925",
    render: { roughness: 0.84, specular: 0.25 }
  }
];

// 高コストな再生成を循環selectの途中値ごとに行わず、材質を一回で直接選択する
const MATERIAL_PRESET_CHOICES = [
  { commandId: "preset-oak", presetId: "wood.oak.plank", label: "Oak", labelJa: "オーク" },
  { commandId: "preset-walnut", presetId: "wood.walnut.plank", label: "Walnut", labelJa: "ウォールナット" },
  { commandId: "preset-cedar", presetId: "wood.cedar.deck", label: "Cedar", labelJa: "シダー" },
  { commandId: "preset-slab", presetId: "concrete.slab.light", label: "Panel", labelJa: "コンクリートパネル" },
  { commandId: "preset-block", presetId: "concrete.block.gray", label: "Block", labelJa: "コンクリートブロック" },
  { commandId: "preset-brick", presetId: "brick.running.red", label: "Brick", labelJa: "赤レンガ" },
  {
    commandId: "preset-vinyl",
    presetId: "vinyl.tile.marble",
    label: "Vinyl",
    labelJa: "ビニールタイル",
    swatch: "#929995",
    render: { roughness: 0.28, specular: 0.68 }
  }
];

const PATTERN_MODE_CHOICES = [
  { commandId: "pattern-wood", value: "longitudinal-grain", label: "Wood" },
  { commandId: "pattern-quarter-sawn", value: "quarter-sawn-grain", label: "Quarter Sawn" },
  { commandId: "pattern-flat-sawn", value: "flat-sawn-grain", label: "Flat Sawn" },
  { commandId: "pattern-mixed-sawn", value: "mixed-sawn-grain", label: "Mixed Sawn" },
  { commandId: "pattern-concrete", value: "mottle", label: "Concrete" },
  { commandId: "pattern-brick", value: "speckle", label: "Brick" },
  { commandId: "pattern-marble", value: "veined", label: "Marble" },
  { commandId: "pattern-voronoi", value: "voronoi", label: "Voronoi" },
  { commandId: "pattern-cloudy", value: "cloudy", label: "Cloudy" },
  { commandId: "pattern-linen", value: "linen", label: "Linen" },
  { commandId: "pattern-terrazzo", value: "terrazzo", label: "Terrazzo" },
  { commandId: "pattern-none", value: "none", label: "None" }
];

let app = null;
let orbit = null;
let commandPalette = null;
let textureParameters = null;
let editablePresetId = "wood.oak.plank";
let activeTextureSets = null;
let comparisonNode = null;
let comparisonShape = null;
let regenerationRunning = false;
let regenerationPending = false;
let lastRegenerationTiming = null;
let textureBackgroundSource = null;
let textureBackgroundLayoutSize = [0, 0, 0, 0];

// +Z編集面の現在値と直前値だけを保持し、Palette操作をまたいでsurface detail fieldを再利用する
// 固定比較用5面は再生成しないためcache対象にせず、初期生成時の一時fieldをそのまま解放する
const editableSurfaceDetailFieldCache = new ProceduralTextureFieldCache(2);

// catalogの既定値からpalette用の変更可能な複製を作り、既定値をsample内へ重複記載しない
function createDefaultTextureParameters(presetId = editablePresetId) {
  const specification = ProceduralMaterials.resolve(presetId);
  return {
    resolution: { pixelsPerMeter: specification.resolution.pixelsPerMeter },
    unit: {
      shortSizeMeters: specification.unit.shortSizeMeters,
      longSizeMeters: specification.unit.longSizeMeters,
      thicknessMeters: specification.unit.thicknessMeters,
      longAxis: specification.unit.longAxis
    },
    layout: {
      mode: specification.layout.mode,
      rowOffsetRatio: specification.layout.rowOffsetRatio
    },
    variationCell: { ...specification.variationCell },
    joint: {
      widthMeters: specification.joint.widthMeters,
      color: Array.from(specification.joint.color),
      depthMeters: specification.joint.depthMeters,
      edgeRoundMeters: specification.joint.edgeRoundMeters
    },
    color: {
      base: Array.from(specification.color.base),
      unitVariation: specification.color.unitVariation,
      dirtColor: Array.from(specification.color.dirtColor),
      dirtAmount: specification.color.dirtAmount
    },
    pattern: {
      mode: specification.pattern.mode,
      scaleMeters: specification.pattern.scaleMeters,
      colorAmount: specification.pattern.colorAmount,
      heightMeters: specification.pattern.heightMeters
    },
    surface: {
      detailScaleMeters: specification.surface.detailScaleMeters,
      heightNoiseMeters: specification.surface.heightNoiseMeters
    },
    random: { seed: specification.random.seed }
  };
}

// 非同期生成の途中でpaletteの値が変わっても、一回分の各mapが同じ設定を使うよう複製する
function cloneTextureParameters(parameters) {
  return {
    resolution: { ...parameters.resolution },
    unit: { ...parameters.unit },
    layout: { ...parameters.layout },
    variationCell: { ...parameters.variationCell },
    joint: { ...parameters.joint, color: Array.from(parameters.joint.color) },
    color: {
      ...parameters.color,
      base: Array.from(parameters.color.base),
      dirtColor: Array.from(parameters.color.dirtColor)
    },
    pattern: { ...parameters.pattern },
    surface: { ...parameters.surface },
    random: { ...parameters.random }
  };
}

// Paletteの現在値をF9 diagnosticsのJSONへ保存可能な形で含める
function createProceduralTextureDiagnosticsReport() {
  const report = app.createProbeReport("runtime-probe");
  const reference = activeTextureSets?.[0] ?? null;
  Diagnostics.mergeStats(report, {
    editableFace: "+Z",
    editablePresetId,
    presetCount: MATERIAL_PRESET_CHOICES.length,
    regenerationRunning: regenerationRunning ? "yes" : "no",
    regenerationPending: regenerationPending ? "yes" : "no",
    regeneratedFaceCount: lastRegenerationTiming?.regeneratedFaceCount ?? 0,
    regenerationTotalMs: lastRegenerationTiming?.totalMs ?? 0
  });
  report.context.proceduralTexture = {
    schemaVersion: 2,
    editableFace: "+Z",
    editablePresetId,
    paletteSettings: cloneTextureParameters(textureParameters),
    lastRegenerationTiming,
    appliedReference: reference
      ? {
          presetId: reference.specification.presetId,
          specification: cloneTextureParameters(reference.specification),
          width: reference.generated.width,
          height: reference.generated.height,
          tileSizeMeters: Array.from(reference.generated.tileSizeMeters),
          heightRangeMeters: Array.from(reference.generated.heightRangeMeters),
          fieldDiagnostics: reference.generated.fieldDiagnostics,
          preview: getTextureBackgroundPreviewLayout()
        }
      : null,
    facePresets: activeTextureSets
      ? activeTextureSets.map((entry) => ({
          face: entry.variant.id,
          presetId: entry.specification.presetId
        }))
      : FACE_VARIANTS.map((variant) => ({
          face: variant.id,
          presetId: variant.id === "front" ? editablePresetId : variant.presetId
        }))
  };
  return report;
}

// 必須のHTML要素を取得し、legendのID誤記を空表示として処理しない
function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`procedural_texture sample requires element #${id}`);
  }
  return element;
}

// 選択presetと同じ比較面の表示名、色見本、material値を+Z編集面でも再利用する
function getPresetPresentation(presetId) {
  const choice = MATERIAL_PRESET_CHOICES.find((entry) => entry.presetId === presetId);
  const variant = FACE_VARIANTS.find((entry) => entry.presetId === presetId);
  const swatch = choice?.swatch ?? variant?.swatch;
  const render = choice?.render ?? variant?.render;
  if (!choice || !swatch || !render) {
    throw new Error(`procedural_texture has no presentation for preset: ${presetId}`);
  }
  return {
    label: choice.label,
    labelJa: choice.labelJa,
    swatch,
    render
  };
}

// 面ごとの比較内容をHTMLへ追加し、立方体を回したときに設定差を参照できるようにする
function buildFaceLegend() {
  const list = requireElement("faceLegend");
  list.replaceChildren();
  for (const variant of FACE_VARIANTS) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    const text = document.createElement("span");
    const presentation = variant.id === "front"
      ? getPresetPresentation(editablePresetId)
      : null;
    swatch.className = "swatch";
    swatch.style.background = presentation?.swatch ?? variant.swatch;
    text.innerHTML = variant.id === "front"
      ? `<strong>+Z ${presentation.labelJa}</strong>`
        + `<small>Palette編集対象 / ${editablePresetId}</small>`
      : `<strong>${variant.label}</strong><small>${variant.detail}</small>`;
    item.append(swatch, text);
    list.append(item);
  }
}

function nowMilliseconds() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function roundMilliseconds(value) {
  return Math.round(value * 100) / 100;
}

// 一面分のCPU map生成とGPU texture/Normal作成を分けて計測し、遅延箇所を診断可能にする
async function createFaceTextureSet(gpu, variant, overrideLayers, presetId, fieldCache = null) {
  const cpuStarted = nowMilliseconds();
  const specification = ProceduralMaterials.resolve(presetId, ...overrideLayers);
  const generated = new ProceduralTiledSurface(specification).generate({ fieldCache });
  const cpuFinished = nowMilliseconds();
  const textures = await ProceduralTextureSet.create(gpu, generated);
  const textureFinished = nowMilliseconds();
  return {
    entry: { variant, specification, generated, textures },
    timing: {
      cpuGenerationMs: roundMilliseconds(cpuFinished - cpuStarted),
      textureAndNormalMs: roundMilliseconds(textureFinished - cpuFinished),
      surfaceDetailBuildMs: roundMilliseconds(
        generated.fieldDiagnostics.surfaceDetail.buildMs
      ),
      surfaceDetailCacheHit: generated.fieldDiagnostics.surfaceDetail.cacheHit
    }
  };
}

// 初期表示だけはcatalogの固定6面をすべて生成する
async function createFaceTextureSets(gpu, referenceOverrides, referencePresetId) {
  const results = [];
  try {
    for (const variant of FACE_VARIANTS) {
      const overrideLayers = variant.id === "front" ? [referenceOverrides] : [];
      const presetId = variant.id === "front" ? referencePresetId : variant.presetId;
      const fieldCache = variant.id === "front" ? editableSurfaceDetailFieldCache : null;
      const result = await createFaceTextureSet(
        gpu,
        variant,
        overrideLayers,
        presetId,
        fieldCache
      );
      results.push(result.entry);
    }
  } catch (error) {
    // 作成途中のGPU textureを残さず、表示中のactive textureへ影響を与えない
    destroyTextureSets(results);
    throw error;
  }
  return results;
}

// 生成途中で失敗したtexture一式を含め、表示から外れたGPU textureを明示的に解放する
function destroyTextureSets(textureSets) {
  if (!textureSets) return;
  for (const entry of textureSets) {
    for (const name of ["colorTexture", "heightTexture", "normalTexture"]) {
      const wrapper = entry.textures[name];
      if (!wrapper?.texture) {
        throw new Error(`procedural_texture cannot destroy missing ${name}`);
      }
      wrapper.texture.destroy();
      wrapper.texture = null;
      wrapper.view = null;
    }
  }
}

// 一つの面へUV付き4頂点を追加し、四角面として指定material slotへ割り当てる
function addCubeFace(shape, face, materialIndex, tileSizeMeters) {
  if (!Array.isArray(face.vertices) || face.vertices.length !== 4) {
    throw new Error(`cube face ${face.id} requires four vertices`);
  }
  const tileWidthMeters = tileSizeMeters[0];
  const tileHeightMeters = tileSizeMeters[1];
  const maxU = CUBE_SIZE_METERS / tileWidthMeters;
  const maxV = CUBE_SIZE_METERS / tileHeightMeters;
  const uv = [
    [0.0, 0.0],
    [maxU, 0.0],
    [maxU, maxV],
    [0.0, maxV]
  ];
  const indices = face.vertices.map((position, index) => (
    shape.addVertexUV(position[0], position[1], position[2], uv[index][0], uv[index][1]) - 1
  ));

  // 四隅のpositionとUVの対応を一つの頂点ループとしてShapeへ渡す
  // Shape.addPlane()が同じ四角面から描画用の2三角形を生成するため、
  // 三角形ごとに頂点やUVを組み直さず、面全体のUV配置を一度に定義できる
  shape.addPlane(indices, materialIndex);
}

// 6方向の外向きwindingと面内U/V方向を明示し、各面の見え方を安定させる
function buildCubeFaceGeometry() {
  const h = CUBE_HALF_SIZE_METERS;
  return [
    {
      id: "front",
      vertices: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]]
    },
    {
      id: "right",
      vertices: [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]]
    },
    {
      id: "back",
      vertices: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]]
    },
    {
      id: "left",
      vertices: [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]]
    },
    {
      id: "top",
      vertices: [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]]
    },
    {
      id: "bottom",
      vertices: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]]
    }
  ];
}

// 6 material slotと6面のtriangleを一つのShapeへ登録する
function createComparisonCube(textureSets) {
  if (textureSets.length !== FACE_VARIANTS.length) {
    throw new Error("comparison cube requires one texture set for every face");
  }
  const shape = new Shape(app.getGPU());

  // 各面には0から1を超えて繰り返す平面UVをaddVertexUV()で直接設定する
  // Shapeの既定mode 0は球面UVのU=0/1継ぎ目を補正するため、U差が0.5を超える頂点を
  // 複製してUへ±1を加える。このsampleでは正規の反復回数まで変更して面を斜めにせん断するため、
  // 平面mappingのmode 1を頂点登録前に明示し、入力したUVをそのまま保持する
  shape.setTextureMappingMode(1);
  shape.setAutoCalcNormals(true);
  for (let index = 0; index < textureSets.length; index += 1) {
    const entry = textureSets[index];
    const render = getPresetPresentation(entry.specification.presetId).render;
    shape.setMaterialAt(index, "smooth-shader", {
      has_bone: 0,
      use_texture: 1,
      texture: entry.textures.colorTexture,
      use_normal_map: 1,
      normal_texture: entry.textures.normalTexture,
      normal_strength: NORMAL_STRENGTH,
      color: [1.0, 1.0, 1.0, 1.0],
      alpha: 1.0,
      ambient: 0.25,
      roughness: render.roughness,
      specular: render.specular,
      metallic: 0.0,
      power: 34.0,
      emissive: 0.0,
      flat_shading: 1
    });
  }

  const faces = buildCubeFaceGeometry();
  for (let index = 0; index < faces.length; index += 1) {
    if (faces[index].id !== textureSets[index].variant.id) {
      throw new Error(
        `cube face order mismatch: ${faces[index].id} != ${textureSets[index].variant.id}`
      );
    }
    addCubeFace(
      shape,
      faces[index],
      index,
      textureSets[index].generated.tileSizeMeters
    );
  }

  // 6個の四角面は面ごとに4頂点を持ち、各面が2三角形へ分割される
  // 球面継ぎ目補正が誤って再び有効になると代替頂点が作られるため、GPU buffer確定前に検出する
  if (shape.vertexCount !== 24 || shape.indicesArray.length !== 36) {
    throw new Error(
      `comparison cube geometry mismatch: vertices=${shape.vertexCount}, `
      + `indices=${shape.indicesArray.length}`
    );
  }
  if (shape.altVertices.length !== 0) {
    throw new Error(
      `comparison cube must preserve manual planar UVs without alternate vertices: `
      + `${shape.altVertices.length}`
    );
  }
  shape.endShape();
  return shape;
}

// diagnosticsやbrowser testが、現在表示中の6面presetをCanvas属性から確認できるようにする
function updateTextureSetMetadata(textureSets) {
  const canvas = app.screen.canvas;
  canvas.dataset.proceduralFaceCount = String(textureSets.length);
  canvas.dataset.proceduralMapTypes = "color,height,normal-from-height";
  canvas.dataset.proceduralPresets = textureSets
    .map((entry) => entry.specification.presetId)
    .join(",");
  canvas.dataset.proceduralEditablePreset = editablePresetId;
  canvas.dataset.proceduralPatternMode = textureSets[0].specification.pattern.mode;
}

function updateRegenerationTimingMetadata() {
  if (!lastRegenerationTiming) return;
  const canvas = app.screen.canvas;
  canvas.dataset.proceduralRegeneratedFaceCount = String(
    lastRegenerationTiming.regeneratedFaceCount
  );
  canvas.dataset.proceduralRegenerationTotalMs = String(lastRegenerationTiming.totalMs);
  canvas.dataset.proceduralCpuGenerationMs = String(lastRegenerationTiming.cpuGenerationMs);
  canvas.dataset.proceduralTextureAndNormalMs = String(
    lastRegenerationTiming.textureAndNormalMs
  );
  canvas.dataset.proceduralSurfaceDetailBuildMs = String(
    lastRegenerationTiming.surfaceDetailBuildMs
  );
  canvas.dataset.proceduralSurfaceDetailCacheHit = String(
    lastRegenerationTiming.surfaceDetailCacheHit
  );
}

// 一枚のTextureをscreen-space previewとして描くBackgroundを初期化する
async function createMapPreviewBackground(texture, label) {
  if (!texture) {
    throw new Error(`procedural_texture ${label} preview requires a Texture`);
  }
  const background = new Background(app.getGPU());
  await background.init();
  background.setBackground(texture);

  // mapの値をそのまま確認できるよう、背景側で暗くしたり着色したりしない
  background.setColor(1.0, 1.0, 1.0);
  background.setAspect(1.0);
  return background;
}

// 基準面のColor/Normal textureを対にし、生成画像と立方体上の見え方を同じ画面で比較する
async function createTextureBackground(textureSets) {
  const source = textureSets[0];
  if (!source || source.variant.id !== "front") {
    throw new Error("texture background requires the front texture set at slot 0");
  }
  const colorBackground = await createMapPreviewBackground(
    source.textures.colorTexture,
    "Color map"
  );
  const normalBackground = await createMapPreviewBackground(
    source.textures.normalTexture,
    "Normal map"
  );
  return {
    colorBackground,
    normalBackground,
    textureWidth: source.generated.width,
    textureHeight: source.generated.height
  };
}

// 再生成時はBackgroundの画面配置を保ち、参照textureと元画像寸法だけを交換する
function updateTextureBackground(textureSets) {
  const source = textureSets[0];
  if (!textureBackgroundSource || !source || source.variant.id !== "front") {
    throw new Error("texture background update requires initialized front previews");
  }
  textureBackgroundSource.colorBackground.setBackground(source.textures.colorTexture);
  textureBackgroundSource.normalBackground.setBackground(source.textures.normalTexture);
  textureBackgroundSource = {
    colorBackground: textureBackgroundSource.colorBackground,
    normalBackground: textureBackgroundSource.normalBackground,
    textureWidth: source.generated.width,
    textureHeight: source.generated.height
  };
  textureBackgroundLayoutSize = [0, 0, 0, 0];
}

// 元画像を1:1で置ける向きを優先し、入らない場合だけ縦横比を保って縮小する
function getTextureBackgroundPreviewLayout() {
  if (!textureBackgroundSource) {
    throw new Error("procedural_texture background must be created before drawing");
  }
  const canvas = app.screen.canvas;
  const sourceWidth = textureBackgroundSource.textureWidth;
  const sourceHeight = textureBackgroundSource.textureHeight;
  const margin = BACKGROUND_PREVIEW_MARGIN_PIXELS;
  const gap = BACKGROUND_PREVIEW_GAP_PIXELS;
  const canvasDisplayWidth = canvas.clientWidth;
  const canvasDisplayHeight = canvas.clientHeight;
  const containerWidth = canvas.parentElement?.clientWidth;
  const containerHeight = canvas.parentElement?.clientHeight;
  // viewport調整でCanvasがstageより小さくなった場合も、実際に描画できる範囲内へ収める
  const visibleWidth = Math.min(canvasDisplayWidth, containerWidth ?? 0);
  const visibleHeight = Math.min(canvasDisplayHeight, containerHeight ?? 0);
  if (!(visibleWidth > 0) || !(visibleHeight > 0)) {
    throw new Error("procedural_texture background preview requires a visible canvas container");
  }
  const availableWidth = visibleWidth - margin * 2;
  const availableHeight = visibleHeight - margin * 2;
  if (!(availableWidth > 0) || !(availableHeight > 0)) {
    throw new Error(
      `procedural_texture visible stage ${visibleWidth}x${visibleHeight} cannot reserve `
      + `${margin}px preview margins`
    );
  }
  const horizontalScale = Math.min(
    1.0,
    (availableWidth - gap) / (sourceWidth * 2),
    availableHeight / sourceHeight
  );
  const verticalScale = Math.min(
    1.0,
    availableWidth / sourceWidth,
    (availableHeight - gap) / (sourceHeight * 2)
  );
  let mode = "horizontal";
  let scale = horizontalScale;
  if (horizontalScale < 1.0 && verticalScale >= 1.0) {
    mode = "vertical";
    scale = verticalScale;
  } else if (horizontalScale < 1.0 && verticalScale > horizontalScale) {
    mode = "vertical";
    scale = verticalScale;
  }
  if (!(scale > 0.0)) {
    throw new Error(
      `procedural_texture visible stage ${visibleWidth}x${visibleHeight} cannot contain `
      + `two ${sourceWidth}x${sourceHeight} previews`
    );
  }
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  const colorTop = visibleHeight - displayHeight - margin;
  const colorLeft = margin;
  const normalLeft = mode === "horizontal" ? margin + displayWidth + gap : margin;
  const normalTop = mode === "horizontal"
    ? colorTop
    : colorTop - displayHeight - gap;
  return {
    mode,
    scale,
    sourceWidth,
    sourceHeight,
    displayWidth,
    displayHeight,
    canvasDisplayWidth,
    canvasDisplayHeight,
    visibleWidth,
    visibleHeight,
    colorLeft,
    colorTop,
    normalLeft,
    normalTop
  };
}

// Color mapとNormal mapを、拡張textureの寸法と表示領域に応じて横または縦へ配置する
function drawTextureBackground() {
  const layout = getTextureBackgroundPreviewLayout();
  if (
    layout.canvasDisplayWidth !== textureBackgroundLayoutSize[0]
    || layout.canvasDisplayHeight !== textureBackgroundLayoutSize[1]
    || layout.visibleWidth !== textureBackgroundLayoutSize[2]
    || layout.visibleHeight !== textureBackgroundLayoutSize[3]
  ) {
    textureBackgroundSource.colorBackground.setWindowPixels(
      layout.colorLeft,
      layout.colorTop,
      layout.displayWidth,
      layout.displayHeight,
      layout.canvasDisplayWidth,
      layout.canvasDisplayHeight
    );
    textureBackgroundSource.normalBackground.setWindowPixels(
      layout.normalLeft,
      layout.normalTop,
      layout.displayWidth,
      layout.displayHeight,
      layout.canvasDisplayWidth,
      layout.canvasDisplayHeight
    );
    textureBackgroundLayoutSize = [
      layout.canvasDisplayWidth,
      layout.canvasDisplayHeight,
      layout.visibleWidth,
      layout.visibleHeight
    ];
  }
  textureBackgroundSource.colorBackground.draw();
  textureBackgroundSource.normalBackground.draw();
}

// 立方体を原点へ置き、軌道カメラが6方向から同じ距離で観察できるようにする
async function buildScene() {
  const textureSets = await createFaceTextureSets(
    app.getGPU(),
    textureParameters,
    editablePresetId
  );
  textureBackgroundSource = await createTextureBackground(textureSets);
  const shape = createComparisonCube(textureSets);
  const node = app.space.addNode(null, "procedural-texture-comparison-cube");
  node.addShape(shape);
  activeTextureSets = textureSets;
  comparisonShape = shape;
  comparisonNode = node;
  updateTextureSetMetadata(textureSets);
}

// HelpPanelの開閉状態を変えず、再生成後のpreview寸法だけを最新値へ更新する
function updateHelpPanel() {
  if (!textureBackgroundSource) {
    throw new Error("procedural_texture HelpPanel requires initialized texture previews");
  }
  const previewLayout = getTextureBackgroundPreviewLayout();
  app.updateOverlayPanel("proceduralTextureHelp", {
    lines: [
      "ProceduralTiledSurface",
      "7 material presets / Color + Height -> Normal",
      `+Z ${editablePresetId} is editable from Command Palette`,
      `Bottom-left preview: Color / Normal ${textureBackgroundSource.textureWidth}`
        + `x${textureBackgroundSource.textureHeight}`,
      `Preview layout: ${previewLayout.mode}, scale ${previewLayout.scale.toFixed(3)}`,
      "",
      "Command Palette: / or double-click / double-tap",
      "F9 then M: toggle DebugDock",
      "F9 then V / Copy JSON: export Palette settings",
      "Drag: orbit",
      "2-finger drag: pan",
      "Pinch / wheel: zoom",
      "Arrow keys: orbit",
      "[ / ]: zoom"
    ]
  });
}

// 完成した6面分を一括交換し、途中状態のColor/Normal組が同時に表示されないようにする
async function regenerateTextureScene(parameters, presetId) {
  const totalStarted = nowMilliseconds();
  let nextReference = null;
  let nextShape = null;
  let generationTiming = null;
  let shapeStarted = null;
  let shapeFinished = null;
  try {
    const result = await createFaceTextureSet(
      app.getGPU(),
      FACE_VARIANTS[0],
      [parameters],
      presetId,
      editableSurfaceDetailFieldCache
    );
    nextReference = result.entry;
    generationTiming = result.timing;
    const nextTextureSets = [
      nextReference,
      ...activeTextureSets.slice(1)
    ];
    shapeStarted = nowMilliseconds();
    nextShape = createComparisonCube(nextTextureSets);
    shapeFinished = nowMilliseconds();
  } catch (error) {
    if (nextShape) nextShape.destroy({ destroyResource: true });
    if (nextReference) destroyTextureSets([nextReference]);
    throw error;
  }

  const previousTextureSets = activeTextureSets;
  const previousShape = comparisonShape;
  const nextTextureSets = [
    nextReference,
    ...previousTextureSets.slice(1)
  ];
  const swapStarted = nowMilliseconds();
  comparisonNode.setShape(nextShape);
  updateTextureBackground(nextTextureSets);
  activeTextureSets = nextTextureSets;
  comparisonShape = nextShape;
  updateTextureSetMetadata(nextTextureSets);
  buildFaceLegend();
  app.invalidateCurrentDiagnosticsCache({ clear: true });
  previousShape.destroy({ destroyResource: true });
  destroyTextureSets([previousTextureSets[0]]);
  updateHelpPanel();
  app.removeOverlayPanel("procedural-texture-regeneration-error");
  app.requestRender?.();
  const finished = nowMilliseconds();
  lastRegenerationTiming = {
    regeneratedFaceCount: 1,
    width: nextReference.generated.width,
    height: nextReference.generated.height,
    pixelCount: nextReference.generated.width * nextReference.generated.height,
    cpuGenerationMs: generationTiming.cpuGenerationMs,
    textureAndNormalMs: generationTiming.textureAndNormalMs,
    surfaceDetailBuildMs: generationTiming.surfaceDetailBuildMs,
    surfaceDetailCacheHit: generationTiming.surfaceDetailCacheHit,
    shapeBuildMs: roundMilliseconds(shapeFinished - shapeStarted),
    sceneSwapMs: roundMilliseconds(finished - swapStarted),
    totalMs: roundMilliseconds(finished - totalStarted)
  };
  updateRegenerationTimingMetadata();
  app.invalidateCurrentDiagnosticsCache({ clear: true });
}

// DOMを更新した同じtask内で重いCPU生成を始めると、値は変わっていてもbrowserがPaletteを
// paintできないため、requestAnimationFrame後のtaskまで待ち、表示値を先に画面へ反映する
function waitForPalettePaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

// 操作が連続した場合は未着手の中間値をまとめる。各生成前にPaletteをpaintし、
// 利用者が指定した最新値を見える状態にしてからtexture生成を開始する
function requestTextureRegeneration() {
  regenerationPending = true;
  app.invalidateCurrentDiagnosticsCache({ clear: true });
  if (regenerationRunning) return;
  regenerationRunning = true;
  void (async () => {
    try {
      while (regenerationPending) {
        await waitForPalettePaint();
        regenerationPending = false;
        const parameters = cloneTextureParameters(textureParameters);
        const presetId = editablePresetId;
        try {
          await regenerateTextureScene(parameters, presetId);
        } catch (error) {
          app.showOverlayPanel(buildErrorPanelOptions(error, {
            id: "procedural-texture-regeneration-error",
            title: "Texture regeneration failed"
          }));
          if (app.isConsoleEnabled()) console.error("texture regeneration failed:", error);
        }
      }
    } finally {
      regenerationRunning = false;
      app.invalidateCurrentDiagnosticsCache({ clear: true });
      commandPalette?.render();
      if (regenerationPending) requestTextureRegeneration();
    }
  })();
}

// Variation Rowsのstepper入力をRow Offsetの周期へ揃え、上下端で配置が閉じる行数を返す
// 増減方向を保って前後の有効な倍数へ移動し、1/3では3、6、9行、1/4では4、8、12行と進める
function alignVariationRowCount(requestedRows, currentRows, rowOffsetRatio) {
  const denominator = ProceduralTiledSurface.getRowOffsetDenominator(rowOffsetRatio);
  if (denominator === 1) return requestedRows;
  if (requestedRows < currentRows) {
    return Math.max(denominator, Math.floor(requestedRows / denominator) * denominator);
  }
  return Math.min(64, Math.ceil(requestedRows / denominator) * denominator);
}

// paletteのcontrol IDを入れ子の生成設定へ対応させ、変更ごとに再生成を予約する
function applyTextureParameterChange(id, value) {
  const setters = {
    ppm: () => { textureParameters.resolution.pixelsPerMeter = value; },
    "unit-long": () => { textureParameters.unit.longSizeMeters = value; },
    "unit-short": () => { textureParameters.unit.shortSizeMeters = value; },
    "long-axis": () => { textureParameters.unit.longAxis = value; },
    layout: () => {
      textureParameters.layout.mode = value;
      if (value === "stack") textureParameters.layout.rowOffsetRatio = 0.0;
    },
    "row-offset": () => {
      // 0以外のoffset選択はrunning-bondへの明示操作として扱う
      textureParameters.layout.rowOffsetRatio = value;
      if (value !== 0.0) textureParameters.layout.mode = "running-bond";
      // 現在行数で周期が閉じない場合は、選択した分母の最小周期へ揃える
      const denominator = ProceduralTiledSurface.getRowOffsetDenominator(value);
      if (textureParameters.variationCell.rowCount % denominator !== 0) {
        textureParameters.variationCell.rowCount = denominator;
      }
    },
    "variation-columns": () => { textureParameters.variationCell.longUnitCount = value; },
    "variation-rows": () => {
      // stepperの増減方向を維持しながらRow Offset周期の有効な行数へ移動する
      textureParameters.variationCell.rowCount = alignVariationRowCount(
        value,
        textureParameters.variationCell.rowCount,
        textureParameters.layout.rowOffsetRatio
      );
    },
    "joint-width": () => { textureParameters.joint.widthMeters = value; },
    "base-r": () => { textureParameters.color.base[0] = value; },
    "base-g": () => { textureParameters.color.base[1] = value; },
    "base-b": () => { textureParameters.color.base[2] = value; },
    variation: () => { textureParameters.color.unitVariation = value; },
    "dirt-r": () => { textureParameters.color.dirtColor[0] = value; },
    "dirt-g": () => { textureParameters.color.dirtColor[1] = value; },
    "dirt-b": () => { textureParameters.color.dirtColor[2] = value; },
    "dirt-amount": () => { textureParameters.color.dirtAmount = value; },
    "joint-tone": () => { textureParameters.joint.color = [value, value, value]; },
    "joint-depth": () => { textureParameters.joint.depthMeters = value; },
    "edge-round": () => { textureParameters.joint.edgeRoundMeters = value; },
    "pattern-mode": () => { textureParameters.pattern.mode = value; },
    "pattern-scale": () => { textureParameters.pattern.scaleMeters = value; },
    "pattern-color": () => { textureParameters.pattern.colorAmount = value; },
    "pattern-height": () => { textureParameters.pattern.heightMeters = value; },
    "surface-scale": () => { textureParameters.surface.detailScaleMeters = value; },
    "surface-noise": () => { textureParameters.surface.heightNoiseMeters = value; },
    seed: () => { textureParameters.random.seed = value; }
  };
  const setter = setters[id];
  if (!setter) throw new Error(`unknown procedural texture parameter: ${id}`);
  setter();
  app.invalidateCurrentDiagnosticsCache({ clear: true });
  commandPalette.render();
  requestTextureRegeneration();
}

// CommandPaletteが構築した5pageの境界と上段navigation位置を起動時に検証する
// 全幅のstepperやselectを追加した際に後続pageへ項目が流れても、誤ったUIを表示する前に異常として検出する
function validateCommandPalettePageLayout(palette) {
  const pages = palette.buildCommandPages();
  if (pages.length !== 5) {
    throw new Error(`procedural texture CommandPalette requires 5 pages, received ${pages.length}`);
  }
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const expectedCellCount = palette.getPageRowCount(pageIndex) * 4;
    const occupiedCellCount = page.reduce((total, command) => (
      total + (command.type === "stepper" || command.type === "select" ? 4 : 1)
    ), 0);
    if (occupiedCellCount !== expectedCellCount) {
      throw new Error(`procedural texture CommandPalette page ${pageIndex + 1} has an incomplete grid`);
    }
    if (page[0]?.id !== "palette-prev" || page[3]?.id !== "palette-next") {
      throw new Error(`procedural texture CommandPalette page ${pageIndex + 1} requires Prev/Next at the upper corners`);
    }
  }
}

// 材質の直接選択を先頭ページに置き、低水準値を続く4ページで編集できるようにする
// 各pageの1行目は左端にPrev、右端にNextを固定し、設定項目をscrollした後でも移動先を予測しやすくする
function setupCommandPalette() {
  const stepper = (id, label, value, min, max, step, decimals) => ({
    type: "stepper", id, label, value, min, max, step, decimals, input: true
  });
  const prev = { id: "palette-prev", label: "Prev", detail: "page", pageSwitch: true };
  const next = { id: "palette-next", label: "Next", detail: "page", pageSwitch: true };
  const reset = { id: "reset", label: "Reset", detail: "preset" };
  const select = (id, label, value, options) => ({ type: "select", id, label, value, options });
  const presetButton = (choice) => ({
    id: choice.commandId,
    label: choice.label,
    detail: "preset",
    materialPresetId: choice.presetId,
    modeSwitch: true
  });
  const patternButton = (choice) => ({
    id: choice.commandId,
    label: choice.label,
    detail: "pattern",
    patternMode: choice.value,
    modeSwitch: true
  });
  commandPalette = new CommandPalette({
    document,
    container: document.body,
    viewport: app.screen.canvas,
    title: "Procedural Texture / +Z",
    pageRows: 8,
    pageRowsByPage: [3, 7, 8, 8, 10],
    closeOnCommand: false,
    titleTapCyclesPage: true,
    resetPageOnOpen: true,
    getCommandState: (id, command) => ({
      active: (
        command.materialPresetId === editablePresetId
        || command.patternMode === textureParameters.pattern.mode
      )
    }),
    onCommand: (id, command) => {
      if (command.materialPresetId) {
        if (command.materialPresetId === editablePresetId) return;
        editablePresetId = command.materialPresetId;
        textureParameters = createDefaultTextureParameters(editablePresetId);
        app.invalidateCurrentDiagnosticsCache({ clear: true });
        commandPalette.render();
        requestTextureRegeneration();
        return;
      }
      if (command.patternMode !== undefined) {
        if (command.patternMode === textureParameters.pattern.mode) return;
        applyTextureParameterChange("pattern-mode", command.patternMode);
        return;
      }
      if (id !== "reset") return;
      textureParameters = createDefaultTextureParameters(editablePresetId);
      app.invalidateCurrentDiagnosticsCache({ clear: true });
      commandPalette.render();
      requestTextureRegeneration();
    },
    onChange: applyTextureParameterChange,
    commands: [
      prev, null, null, next,
      presetButton(MATERIAL_PRESET_CHOICES[0]),
      presetButton(MATERIAL_PRESET_CHOICES[1]),
      presetButton(MATERIAL_PRESET_CHOICES[2]),
      presetButton(MATERIAL_PRESET_CHOICES[3]),
      presetButton(MATERIAL_PRESET_CHOICES[4]),
      presetButton(MATERIAL_PRESET_CHOICES[5]),
      presetButton(MATERIAL_PRESET_CHOICES[6]),
      null,

      prev, reset, null, next,
      select("ppm", "Pixels / meter", () => textureParameters.resolution.pixelsPerMeter,
        [100, 200, 400].map((value) => ({ value, label: String(value) }))),
      stepper("unit-long", "Unit long (m)", () => textureParameters.unit.longSizeMeters, 0.1, 5, 0.01, 2),
      stepper("unit-short", "Unit short (m)", () => textureParameters.unit.shortSizeMeters, 0.05, 2, 0.01, 3),
      select("long-axis", "Long axis", () => textureParameters.unit.longAxis,
        [{ value: "u", label: "U" }, { value: "v", label: "V" }]),
      select("layout", "Layout", () => textureParameters.layout.mode,
        [{ value: "running-bond", label: "Running bond" }, { value: "stack", label: "Stack" }]),
      select("row-offset", "Row offset", () => textureParameters.layout.rowOffsetRatio,
        [
          { value: 0.0, label: "0" },
          { value: 0.5, label: "1/2" },
          { value: 1 / 3, label: "1/3" },
          { value: 0.25, label: "1/4" }
        ]),
      prev, reset, null, next,
      stepper("base-r", "Base red", () => textureParameters.color.base[0], 0, 1, 0.02, 2),
      stepper("base-g", "Base green", () => textureParameters.color.base[1], 0, 1, 0.02, 2),
      stepper("base-b", "Base blue", () => textureParameters.color.base[2], 0, 1, 0.02, 2),
      stepper("variation", "Unit color variation", () => textureParameters.color.unitVariation, 0, 0.25, 0.005, 3),
      stepper("dirt-r", "Dirt red", () => textureParameters.color.dirtColor[0], 0, 1, 0.02, 2),
      stepper("dirt-g", "Dirt green", () => textureParameters.color.dirtColor[1], 0, 1, 0.02, 2),
      stepper("dirt-b", "Dirt blue", () => textureParameters.color.dirtColor[2], 0, 1, 0.02, 2),

      prev, reset, null, next,
      stepper("dirt-amount", "Dirt amount", () => textureParameters.color.dirtAmount, 0, 1, 0.02, 2),
      stepper("joint-tone", "Joint tone", () => textureParameters.joint.color[0], 0.05, 1, 0.05, 2),
      stepper("joint-depth", "Joint depth (m)", () => textureParameters.joint.depthMeters, 0.001, 0.05, 0.001, 3),
      stepper("edge-round", "Edge round (m)", () => textureParameters.joint.edgeRoundMeters, 0, 0.15, 0.01, 2),
      stepper(
        "joint-width",
        "Joint width (m)",
        () => textureParameters.joint.widthMeters,
        0.0,
        0.1,
        () => 1.0 / textureParameters.resolution.pixelsPerMeter,
        4
      ),
      stepper("variation-columns", "Variation columns", () => textureParameters.variationCell.longUnitCount, 1, 64, 1, 0),
      stepper("variation-rows", "Variation rows", () => textureParameters.variationCell.rowCount, 1, 64, 1, 0),

      prev, reset, null, next,
      ...PATTERN_MODE_CHOICES.map(patternButton),
      stepper("pattern-scale", "Pattern scale (m)", () => textureParameters.pattern.scaleMeters, 0.005, 1, 0.001, 3),
      stepper("pattern-color", "Pattern color amount", () => textureParameters.pattern.colorAmount, 0, 0.25, 0.005, 3),
      stepper("pattern-height", "Pattern height (m)", () => textureParameters.pattern.heightMeters, 0, 0.01, 0.00001, 5),
      stepper("surface-scale", "Surface detail scale (m)", () => textureParameters.surface.detailScaleMeters, 0.005, 1, 0.0025, 4),
      stepper("surface-noise", "Surface noise (m)", () => textureParameters.surface.heightNoiseMeters, 0, 0.01, 0.00001, 5),
      stepper("seed", "Random seed", () => textureParameters.random.seed, 0, 2147483647, 1, 0)
    ]
  });
  validateCommandPalettePageLayout(commandPalette);
  commandPalette.attachToCanvas(app.screen.canvas, { key: "/" });
  commandPalette.setStyle(getDefaultCommandPaletteCss());
}

// WebgApp標準のorbit helperを使い、drag、wheel、touch操作を一つの視点状態へまとめる
function setupOrbitCamera() {
  orbit = app.createOrbitEyeRig({
    target: CAMERA_CONFIG.target,
    distance: CAMERA_CONFIG.distance,
    yaw: CAMERA_CONFIG.yaw,
    pitch: CAMERA_CONFIG.pitch,
    minDistance: CAMERA_CONFIG.minDistance,
    maxDistance: CAMERA_CONFIG.maxDistance,
    wheelZoomStep: CAMERA_CONFIG.wheelZoomStep
  });
  if (!orbit) {
    throw new Error("procedural_texture sample failed to create orbit EyeRig");
  }
}

// Canvas HUDに分散していたsample情報と操作方法を、折りたたみ可能なHelpPanelの本文へまとめる
function showHelpPanel() {
  if (!textureBackgroundSource) {
    throw new Error("procedural_texture HelpPanel requires initialized texture previews");
  }
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "proceduralTextureHelp",
    title: "Procedural Texture Help",
    anchor: "top-left",
    maxWidth: "460px",
    collapsed: true,
    collapseLabelExpanded: "Hide Help",
    collapseLabelCollapsed: "Show Help",
    lines: []
  }));
  updateHelpPanel();
}

// 初期化、texture生成、Shape確定、camera入力の順序を明示してsampleを開始する
async function start() {
  buildFaceLegend();
  app = new WebgApp({
    document,
    clearColor: [0.055, 0.075, 0.095, 1.0],
    viewAngle: 48.0,
    projectionNear: 0.1,
    projectionFar: 200.0,
    camera: CAMERA_CONFIG,
    lightPosition: [24.0, 30.0, 34.0, 1.0],
    debugTools: {
      mode: "release",
      system: "procedural_texture",
      source: "samples/procedural_texture/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  textureParameters = createDefaultTextureParameters();
  await buildScene();
  setupOrbitCamera();
  showHelpPanel();
  setupCommandPalette();
  app.setDiagnosticsStage("runtime");
  app.configureDiagnosticsCapture({
    labelPrefix: "procedural_texture",
    collect: createProceduralTextureDiagnosticsReport
  });
  app.configureDebugKeyInput();

  app.start({
    onBeforeDraw: () => {
      // WebgAppがclearした直後に左下の2画像を描き、その後の3D描画を手前へ重ねる
      drawTextureBackground();
    },
    onUpdate: () => {
      // 立方体は固定し、観察方向だけをorbit cameraで変更する
    }
  });
}

// DOM構築後に開始し、生成またはGPU初期化の失敗を標準error panelへ表示する
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(error, {
      system: "procedural_texture",
      source: "samples/procedural_texture/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("procedural_texture failed:", error);
    }
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      id: "procedural-texture-error",
      title: "procedural_texture failed"
    }));
  });
});
