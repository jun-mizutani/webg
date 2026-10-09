// ---------------------------------------------
// main.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Core procedural material catalog, editor, preview, and code exporter

import Background from "../../webg/Background.js";
import Diagnostics from "../../webg/Diagnostics.js";
import { buildErrorPanelOptions } from "../../webg/OverlayPanelPresets.js";
import ProceduralMaterials from "../../webg/ProceduralMaterials.js";
import Shape from "../../webg/Shape.js";
import WebgApp from "../../webg/WebgApp.js";

// 公開schemaの一覧と省略値を使い、コアへ追加したpatternも編集できるようにする
import { PATTERN_MODES, PEBBLE_DEFAULTS } from "../../webg/ProceduralTileSpec.js";

const PEBBLE_CONTROLS = {
  density: "pebbleDensity",
  packing: "pebblePacking",
  irregularity: "pebbleIrregularity",
  roundness: "pebbleRoundness",
  gravelAmount: "gravelAmount",
  gravelScaleMeters: "gravelScale",
  gravelHeightMeters: "gravelHeight",
  gravelColorAmount: "gravelColor"
};

// 初期視点とorbit可能範囲を一つの設定へまとめ、WebgApp初期cameraとEyeRigへ同じ値を渡す
const CAMERA_CONFIG = {
  target: [0, -0.7, 0],
  distance: 8.8,
  yaw: 34,
  pitch: -22,
  minDistance: 4,
  maxDistance: 12,
  wheelZoomStep: 0.4
};

// preview立方体を実寸3mとして扱い、材質tile寸法からRepeat回数を求める基準にする
const CUBE_SIZE_METERS = 3.0;
const CUBE_HALF_SIZE_METERS = CUBE_SIZE_METERS * 0.5;

// appとGPU resourceの所有参照をmodule内へ保持し、生成成功時だけactive一式を交換する
// nullは未初期化または未生成を表し、pagehideでは所有者ごとのdestroy入口から解放する
let app = null;
let materials = null;
// 現在sceneへcommit済みのmaterial、Shape、Nodeを一組として保持する
let activeMaterial = null;
let activeShape = null;
let activeNode = null;
// map preview用Backgroundは初回生成後に再利用し、参照textureだけを交換する
let colorPreview = null;
let heightPreview = null;
let normalPreview = null;
// UIで編集中の完成definitionと、Reset時に戻すcore preset IDを分けて保持する
let workingDefinition = null;
let selectedPresetId = null;
// 非同期処理の重複、最新要求の順序、control値がactive textureへ未反映かどうかを明示的に管理する
let generating = false;
let imageExporting = false;
let definitionDirty = true;
let generationSerial = 0;
let generationPromise = null;
let numberAdjustmentMessages = [];

// HTML側で宣言したcontrol IDをDOM要素へ解決し、UI参照の表記を全処理で統一する
// 起動時に必須要素の存在を確認し、誤ったIDをエラーとして報告する
const byId = (id) => document.getElementById(id);

// registryの定義から編集用objectを作り、配列を含む全階層を切り離す
// preset原本をUI操作から保護し、生成前の作業値だけを安全に変更できるようにする
function cloneDefinition(definition) {
  return JSON.parse(JSON.stringify(definition));
}

// 0から1の一つの色channelをcolor input用の2桁16進文字列へ変換する
// registryの正規化済みRGBをHTMLの#rrggbb表現へ組み立てる前段として使用する
function channelToHex(channel) {
  return Math.round(channel * 255).toString(16).padStart(2, "0");
}

// 0から1のRGB配列をHTML color inputが受け取る#rrggbb文字列へ変換する
// 各channelの変換規則をchannelToHexへ集約し、Base色とJoint色で同じ丸めを使う
function colorToHex(color) {
  return `#${color.map(channelToHex).join("")}`;
}

// HTML color inputの#rrggbbをcore definition用の0から1のRGB配列へ戻す
// 入力形式を検証し、不正な入力項目を具体的なerrorとして報告する
function hexToColor(value) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`invalid color value: ${value}`);
  return [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
}

// 数値をHTML controlのstep、min、maxと現在の解像度で表現できる値へ丸める
// 自動補正の内容をnumberAdjustmentMessagesへ記録し、info欄へ表示する
function normalizeNumberInput(id, value) {
  const input = byId(id);
  let normalized = value;
  const min = input.min === "" ? null : Number(input.min);
  const max = input.max === "" ? null : Number(input.max);
  const step = input.step === "" ? null : Number(input.step);
  if (Number.isFinite(step) && step > 0) {
    const base = Number.isFinite(min) ? min : 0;
    normalized = base + Math.round((normalized - base) / step) * step;
  }
  if (PIXEL_ALIGNED_NUMBER_CONTROLS.has(id)) {
    // 解像度を同時に編集中でも、画面に表示されている新しい解像度へ寸法を揃える
    const pixelsPerMeter = Number(byId("pixelsPerMeter").value);
    if (Number.isFinite(pixelsPerMeter) && pixelsPerMeter > 0) {
      const metersPerPixel = 1 / pixelsPerMeter;
      normalized = Math.round(normalized / metersPerPixel) * metersPerPixel;
    }
  }
  if (Number.isFinite(min)) normalized = Math.max(min, normalized);
  if (Number.isFinite(max)) normalized = Math.min(max, normalized);
  normalized = Number(normalized.toPrecision(12));
  if (normalized !== value) {
    const label = input.closest("label")?.firstChild?.textContent?.trim() ?? id;
    numberAdjustmentMessages.push(
      `${label}: ${input.value} → ${normalized}（入力可能な値へ丸めました）`
    );
    input.value = String(normalized);
  }
  return normalized;
}

// 解像度の整数pixelへ変換する必要があるnumber controlを一箇所で管理する
// patternや高さは連続値として扱い、部材寸法、目地幅、目地周辺の丸みだけをpixel gridへ揃える
const PIXEL_ALIGNED_NUMBER_CONTROLS = new Set([
  "longSize",
  "shortSize",
  "jointWidth",
  "edgeRound"
]);

// 指定IDのnumber controlから現在の文字列を読み、有限なJavaScript Numberへ変換する
// 完成値の読み取り時だけ入力可能な近似値へ正規化し、入力途中は呼び出し元がnormalizeをfalseにする
function readNumber(id, { normalize = true } = {}) {
  const value = Number(byId(id).value);
  if (!Number.isFinite(value)) throw new Error(`${id} must be a finite number`);
  return normalize && byId(id).type === "number"
    ? normalizeNumberInput(id, value)
    : value;
}

// 完成definitionをES moduleとして保存できる文字列へ直列化する
// 省略値を作らず全階層を出力し、将来preset既定値が変わっても保存時の材質を再現可能にする
function buildJavaScript(definition = workingDefinition) {
  return `// Generated by webg texture_catalog on 2026-08-15\nexport default ${JSON.stringify(definition, null, 2)};\n`;
}

// 現在の作業definitionを読み取り専用code欄へ再直列化する
// control変更のたびに呼び、画面の設定値とCopy／Download対象の内容を一致させる
function updateCode() {
  byId("code").value = buildJavaScript();
}

// definition metadataのtext controlから必須文字列を読み、空文字を入力エラーとして報告する
// 利用者が新しいcore preset名と分類名を明示した段階で確定処理を進める
function readRequiredText(id, label) {
  const value = byId(id).value;
  if (value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

// presetを元に新しいdefinitionを作るとき、GPU生成を確定イベントまで待つmetadata controlを固定する
// 入力中はcode表示を更新し、change時に確定値をcore validationへ渡す
const DEFINITION_TEXT_CONTROLS = new Set([
  "definitionId",
  "definitionCategory",
  "labelJa",
  "labelEn",
  "tilePresetId"
]);

// 現在のHTML controlから完成definitionを再構築し、非表示項目は元preset値を維持する
// 作業definitionを先に複製してから公開中の項目を上書きし、原本を保つ
function readDefinitionFromControls({ normalizeNumbers = true } = {}) {
  // 指定した数値controlを読み、完成した手続き材質definitionへ値を渡す
  const read = (id) => readNumber(id, { normalize: normalizeNumbers });
  const definition = cloneDefinition(workingDefinition);
  definition.id = readRequiredText("definitionId", "definition.id");
  definition.category = readRequiredText("definitionCategory", "definition.category");
  definition.label.ja = readRequiredText("labelJa", "definition.label.ja");
  definition.label.en = readRequiredText("labelEn", "definition.label.en");
  definition.tile.presetId = readRequiredText("tilePresetId", "definition.tile.presetId");
  definition.tile.resolution.pixelsPerMeter = read("pixelsPerMeter");
  definition.tile.color.base = hexToColor(byId("baseColor").value);
  definition.tile.color.unitVariation = read("unitVariation");
  definition.tile.color.dirtColor = hexToColor(byId("dirtColor").value);
  definition.tile.color.dirtAmount = read("dirtAmount");
  definition.tile.joint.color = hexToColor(byId("jointColor").value);
  definition.tile.unit.longSizeMeters = read("longSize");
  definition.tile.unit.shortSizeMeters = read("shortSize");
  definition.tile.unit.thicknessMeters = byId("thicknessMode").value === "null"
    ? null
    : read("thicknessSize");
  definition.tile.unit.longAxis = byId("longAxis").value;
  definition.tile.joint.widthMeters = read("jointWidth");
  definition.tile.joint.depthMeters = read("jointDepth");
  definition.tile.joint.edgeRoundMeters = read("edgeRound");
  definition.tile.layout.mode = byId("layoutMode").value;
  definition.tile.layout.rowOffsetRatio = read("rowOffset");
  definition.tile.variationCell.longUnitCount = read("longUnitCount");
  definition.tile.variationCell.rowCount = read("rowCount");
  definition.tile.pattern.mode = byId("patternMode").value;
  definition.tile.pattern.scaleMeters = read("patternScale");
  definition.tile.pattern.colorAmount = read("patternColor");
  definition.tile.pattern.heightMeters = read("patternHeight");
  byId("pebbleControls").hidden = definition.tile.pattern.mode !== "pebbles";
  if (definition.tile.pattern.mode === "pebbles") {
    definition.tile.pattern.pebbles = Object.fromEntries(
      Object.entries(PEBBLE_CONTROLS).map(([name, id]) => [name, read(id)])
    );
  } else {
    // 石粒専用の設定を該当patternへ集約し、JSON出力をschemaへ揃える
    delete definition.tile.pattern.pebbles;
  }
  definition.tile.surface.detailScaleMeters = read("surfaceScale");
  definition.tile.surface.heightNoiseMeters = read("surfaceHeight");
  definition.tile.random.seed = read("randomSeed");
  definition.appearance.roughness = read("roughness");
  definition.appearance.specular = read("specular");
  definition.appearance.metallic = read("metallic");
  definition.appearance.normalStrength = read("normalStrength");
  return definition;
}

// thicknessMetersの未指定／指定値を切り替え、null時は数値入力を編集対象から外す
// nullを明示的な設定として扱い、definitionへnullまたは正の値を書き込む
function syncThicknessControl() {
  const specified = byId("thicknessMode").value === "value";
  byId("thicknessSize").disabled = !specified;
}

// 検証済みdefinitionの値を全control、preset metadata、code表示へ一括反映する
// preset選択、Reset、Import、生成成功の四経路が同じ画面更新手順を通るようにする
function writeDefinitionToControls(definition) {
  byId("definitionId").value = definition.id;
  byId("definitionCategory").value = definition.category;
  byId("labelJa").value = definition.label.ja;
  byId("labelEn").value = definition.label.en;
  byId("tilePresetId").value = definition.tile.presetId;
  byId("pixelsPerMeter").value = definition.tile.resolution.pixelsPerMeter;
  byId("baseColor").value = colorToHex(definition.tile.color.base);
  byId("unitVariation").value = definition.tile.color.unitVariation;
  byId("dirtColor").value = colorToHex(definition.tile.color.dirtColor);
  byId("dirtAmount").value = definition.tile.color.dirtAmount;
  byId("jointColor").value = colorToHex(definition.tile.joint.color);
  byId("longSize").value = definition.tile.unit.longSizeMeters;
  byId("shortSize").value = definition.tile.unit.shortSizeMeters;
  byId("thicknessMode").value = definition.tile.unit.thicknessMeters === null ? "null" : "value";
  byId("thicknessSize").value = definition.tile.unit.thicknessMeters ?? "";
  syncThicknessControl();
  byId("longAxis").value = definition.tile.unit.longAxis;
  byId("jointWidth").value = definition.tile.joint.widthMeters;
  byId("jointDepth").value = definition.tile.joint.depthMeters;
  byId("edgeRound").value = definition.tile.joint.edgeRoundMeters;
  byId("layoutMode").value = definition.tile.layout.mode;
  byId("rowOffset").value = String(definition.tile.layout.rowOffsetRatio);
  byId("longUnitCount").value = definition.tile.variationCell.longUnitCount;
  byId("rowCount").value = definition.tile.variationCell.rowCount;
  byId("patternMode").value = definition.tile.pattern.mode;
  byId("patternScale").value = definition.tile.pattern.scaleMeters;
  byId("patternColor").value = definition.tile.pattern.colorAmount;
  byId("patternHeight").value = definition.tile.pattern.heightMeters;
  const pebbles = { ...PEBBLE_DEFAULTS, ...(definition.tile.pattern.pebbles ?? {}) };
  for (const [name, id] of Object.entries(PEBBLE_CONTROLS)) byId(id).value = pebbles[name];
  byId("pebbleControls").hidden = definition.tile.pattern.mode !== "pebbles";
  byId("surfaceScale").value = definition.tile.surface.detailScaleMeters;
  byId("surfaceHeight").value = definition.tile.surface.heightNoiseMeters;
  byId("randomSeed").value = definition.tile.random.seed;
  byId("roughness").value = definition.appearance.roughness;
  byId("specular").value = definition.appearance.specular;
  byId("metallic").value = definition.appearance.metallic;
  byId("normalStrength").value = definition.appearance.normalStrength;
  byId("presetLabel").textContent = definition.label.ja;
  byId("presetId").textContent = definition.id;
  updateCode();
}

// core registryの完成definitionをcategory条件で絞り込み、新しい配列として返す
// allだけを特別値として扱い、個別category名はregistryに記録された文字列と完全一致させる
function listDefinitions(category = "all") {
  return ProceduralMaterials.listPresetDefinitions().filter((definition) => (
    category === "all" || definition.category === category
  ));
}

// core registryからcategoryの重複を除いて並べ、category selectを現在の登録内容から構築する
// category一覧はregistryへ集約し、preset追加時の更新箇所を一か所に揃える
function populateCategories() {
  const categories = Array.from(new Set(
    ProceduralMaterials.listPresetDefinitions().map((definition) => definition.category)
  )).sort();
  byId("category").replaceChildren(
    new Option("All", "all"),
    ...categories.map((category) => new Option(category, category))
  );
}

// 選択categoryに属するpresetを日英label付きで列挙し、可能なら直前のpreset IDを維持する
// category内のpreset数を検査し、空の場合はregistry不整合として停止する
function populatePresets(category = byId("category").value, preferredId = selectedPresetId) {
  const definitions = listDefinitions(category);
  byId("preset").replaceChildren(...definitions.map((definition) => (
    new Option(`${definition.label.ja} / ${definition.label.en}`, definition.id)
  )));
  const selected = definitions.some((definition) => definition.id === preferredId)
    ? preferredId
    : definitions[0]?.id;
  if (!selected) throw new Error(`texture_catalog category has no presets: ${category}`);
  byId("preset").value = selected;
  selectPreset(selected);
}

// 指定presetのdefinitionを編集用へ複製し、未生成状態として全controlへ表示する
// GPU textureの交換は呼び出し元が最新definitionの生成を要求した後に行う
function selectPreset(presetId) {
  selectedPresetId = presetId;
  workingDefinition = cloneDefinition(ProceduralMaterials.getPresetDefinition(presetId));
  definitionDirty = true;
  writeDefinitionToControls(workingDefinition);
}

// Layout変更時にrow offsetを整え、stackとrunning-bondを区別できる入力へ揃える
// stackはoffsetを必ず0へ戻し、running-bondへ変更した時の0は標準的な1/2 offsetへ切り替える
function handleLayoutModeChange() {
  const layoutMode = byId("layoutMode").value;
  const currentOffset = byId("rowOffset").value;
  byId("rowOffset").value = layoutMode === "stack"
    ? "0"
    : currentOffset === "0" ? "0.5" : currentOffset;
  definitionDirty = true;
  try {
    workingDefinition = readDefinitionFromControls();
    updateCode();
    byId("error").textContent = "";
  } catch (error) {
    byId("error").textContent = error?.message ?? String(error);
  }
  generateFromUi();
}

// 現在のcontrol値を作業definitionとcode表示へ反映し、入力エラーを画面へ表示する
// 数値欄では入力途中の空欄や小数点だけの状態を許容し、完成値のvalidationと生成はchange eventへ任せる
function updateWorkingDefinitionFromControls({ normalizeNumbers = true } = {}) {
  definitionDirty = true;
  numberAdjustmentMessages = [];
  try {
    workingDefinition = readDefinitionFromControls({ normalizeNumbers });
    updateCode();
    byId("error").textContent = "";
    byId("info").textContent = numberAdjustmentMessages.join("\n");
  } catch (error) {
    byId("info").textContent = "";
    byId("error").textContent = error?.message ?? String(error);
  }
}

// 一つの立方体面へ実寸tile寸法からRepeat用UVを求め、4頂点とplane indexを追加する
// 3m面に収まるtile数をUVの最大値にし、textureの実寸周期を保つ
function addCubeFace(shape, vertices, tileSizeMeters) {
  const maxU = CUBE_SIZE_METERS / tileSizeMeters[0];
  const maxV = CUBE_SIZE_METERS / tileSizeMeters[1];
  const uv = [[0, 0], [maxU, 0], [maxU, maxV], [0, maxV]];
  const indices = vertices.map((position, index) => (
    shape.addVertexUV(position[0], position[1], position[2], uv[index][0], uv[index][1]) - 1
  ));
  shape.addPlane(indices, 0);
}

// 実寸tile sizeから各面の反復UVを作り、material handleを高水準APIで登録する
// 六面のgeometryを完成させた後にProceduralMaterial.applyTo()でColor／Normal／PBRをまとめて設定する
function createPreviewCube(material) {
  const h = CUBE_HALF_SIZE_METERS;
  const faces = [
    [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]],
    [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]],
    [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]],
    [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]],
    [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]],
    [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]]
  ];
  const shape = new Shape(app.getGPU());
  shape.setTextureMappingMode(1);
  shape.setAutoCalcNormals(true);
  for (const vertices of faces) addCubeFace(shape, vertices, material.tileSizeMeters);
  shape.endShape();
  material.applyTo(shape);
  return shape;
}

// 三枚のscreen-space previewを初回だけ作り、生成結果のtextureだけを交換する
// Heightを直接観察できるので、色と粒の丸みが独立していることを確認しやすい
async function updatePreviews(material) {
  if (!colorPreview) {
    [colorPreview, heightPreview, normalPreview] = Array.from({ length: 3 }, () => new Background(app.getGPU()));
    for (const preview of [colorPreview, heightPreview, normalPreview]) {
      await preview.init();
      preview.setColor(1, 1, 1);
      preview.setAspect(1);
    }
  }
  colorPreview.setBackground(material.colorTexture);
  heightPreview.setBackground(material.heightTexture);
  normalPreview.setBackground(material.normalTexture);
}

// 元画像の縦横比を保ち、狭いviewportでも三枚が横に収まるよう同じ倍率で縮小する
function drawPreviews() {
  if (!activeMaterial || !colorPreview || !heightPreview || !normalPreview) return;
  const canvas = app.screen.canvas;
  const visibleWidth = Math.min(canvas.clientWidth, canvas.parentElement?.clientWidth ?? canvas.clientWidth);
  const visibleHeight = Math.min(canvas.clientHeight, canvas.parentElement?.clientHeight ?? canvas.clientHeight);
  const maxWidth = Math.max(1, Math.min(190, (visibleWidth - 60) / 3));
  const scale = Math.min(maxWidth / activeMaterial.result.width, 150 / activeMaterial.result.height, 1);
  const width = activeMaterial.result.width * scale;
  const height = activeMaterial.result.height * scale;
  const top = visibleHeight - height - 34;
  for (const [index, preview] of [colorPreview, heightPreview, normalPreview].entries()) {
    preview.setWindowPixels(18 + index*(width+12), top, width, height, canvas.clientWidth, canvas.clientHeight);
    preview.draw();
  }
}

// controlの完成definitionを検証してGPU textureとpreview Shapeを生成し、成功時だけ表示一式を交換する
// 入力の世代を確認し、最新世代の生成結果をcommitする
async function generateCurrentDefinition(requestSerial = generationSerial) {
  if (imageExporting) {
    byId("error").textContent = "Texture image download is still running";
    return;
  }
  generating = true;
  byId("error").textContent = "";
  let nextMaterial = null;
  let nextShape = null;
  let ownershipTransferred = false;
  try {
    // control値を完成したdefinitionへ変換し、core validation後にGPU materialを作る
    const nextDefinition = readDefinitionFromControls();
    byId("info").textContent = numberAdjustmentMessages.join("\n");
    nextMaterial = await materials.create(nextDefinition);
    // 新materialを参照するShapeとmap previewを準備し、active表示を保持する
    nextShape = createPreviewCube(nextMaterial);
    await updatePreviews(nextMaterial);
    // GPU生成中にcontrolが変わった場合は、一時resourceだけを破棄してactive表示を維持する
    if (requestSerial !== generationSerial) {
      nextShape.destroy({ destroyResource: true });
      nextMaterial.destroy();
      nextShape = null;
      nextMaterial = null;
      return;
    }
    if (!activeNode) activeNode = app.space.addNode(null, "texture-catalog-preview");
    // scene node、active参照、control表示を同じ生成結果へcommitする
    activeNode.setShape(nextShape);
    const previousShape = activeShape;
    const previousMaterial = activeMaterial;
    activeShape = nextShape;
    activeMaterial = nextMaterial;
    ownershipTransferred = true;
    workingDefinition = cloneDefinition(nextMaterial.definition);
    definitionDirty = false;
    writeDefinitionToControls(workingDefinition);
    byId("mapSize").textContent = `${nextMaterial.result.width} × ${nextMaterial.result.height}`;
    byId("tileSize").textContent = `${nextMaterial.tileSizeMeters[0].toFixed(3)} × ${nextMaterial.tileSizeMeters[1].toFixed(3)} m`;
    byId("heightRange").textContent = nextMaterial.result.heightRangeMeters.map((meters) => (meters*1000).toFixed(2)).join(" ～ ") + " mm";
    // commit後に前のShapeとmaterialを解放し、失敗時にactive previewを維持できるようにする
    previousShape?.destroy({ destroyResource: true });
    previousMaterial?.destroy();
    nextShape = null;
    nextMaterial = null;
  } catch (error) {
    // commit前の失敗では作成中のresourceだけを破棄し、active previewを継続表示する
    if (!ownershipTransferred) {
      nextShape?.destroy({ destroyResource: true });
      nextMaterial?.destroy();
    }
    if (requestSerial === generationSerial) {
      byId("error").textContent = error?.message ?? String(error);
    }
    throw error;
  } finally {
    generating = false;
  }
}

// 入力変更ごとの生成要求を一つの非同期queueへまとめ、最後に届いたdefinitionまで順番に処理する
// 生成要求を直列に処理し、完了後に最新control値を読み直す
function requestGeneration() {
  generationSerial += 1;
  if (generationPromise) return generationPromise;
  generationPromise = (async () => {
    while (true) {
      const requestSerial = generationSerial;
      try {
        await generateCurrentDefinition(requestSerial);
      } catch (error) {
        // 要求の世代を確認し、最新要求の結果とerror表示を優先する
        if (requestSerial !== generationSerial) continue;
        throw error;
      }
      if (requestSerial === generationSerial) break;
    }
  })().finally(() => {
    generationPromise = null;
  });
  return generationPromise;
}

// JavaScript／JSON文字列を指定MIME typeのBlobへ変換し、共通download処理へ渡す
// 画像Blobとtext Blobのlink生成手順をdownloadBlobへ一本化するためのtext専用入口とする
function downloadText(filename, mimeType, text) {
  const blob = new Blob([text], { type: mimeType });
  downloadBlob(filename, blob);
}

// Blob用の一時Object URLとdownload属性付きlinkを作り、browserのfile保存を開始する
// click開始後のtaskでURLを解放し、download開始まで参照の有効期間を確保する
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// definition IDをfile systemで扱いやすい英数字とunderscoreだけのbase nameへ正規化する
// JS、JSON、Color、Height、Normalが同じ命名規則を共有し、map種別と拡張子だけを後段で追加する
function exportBaseName(definition = workingDefinition) {
  return definition.id.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
}

// WebGPUの256 byte row整列を満たすread bufferへtextureをcopyし、paddingなしRGBA8へ戻す
// Download要求時にCOPY_SRC textureをMAP_READ bufferへ転送し、通常previewはGPU上の画像を使う
async function readTextureRgba(texture, width, height) {
  if (!texture?.texture) throw new Error("Texture image download requires a live GPU texture");
  if (!(width > 0) || !(height > 0)) throw new Error("Texture image dimensions must be positive");
  const gpu = app.getGPU();
  const unpaddedBytesPerRow = width * 4;
  // WebGPUのbuffer copyでは一行を256 byte境界へ揃える必要があるため、末尾padding込みstrideを求める
  const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const readBuffer = gpu.device.createBuffer({
    label: "texture_catalog image readback",
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
  let mapped = false;
  try {
    // GPU側でtexture全域を一つのread bufferへcopyし、submit済みworkが終わるまでmapAsyncで待つ
    const encoder = gpu.device.createCommandEncoder({ label: "texture_catalog image copy" });
    encoder.copyTextureToBuffer(
      { texture: texture.texture },
      { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    );
    gpu.queue.submit([encoder.finish()]);
    await readBuffer.mapAsync(GPUMapMode.READ);
    mapped = true;
    const source = new Uint8Array(readBuffer.getMappedRange());
    const rgba = new Uint8ClampedArray(unpaddedBytesPerRow * height);
    // 各rowの有効RGBAを連続配列へ移し、整列paddingを除いてCanvasへ渡す
    for (let y = 0; y < height; y += 1) {
      const sourceOffset = y * bytesPerRow;
      rgba.set(
        source.subarray(sourceOffset, sourceOffset + unpaddedBytesPerRow),
        y * unpaddedBytesPerRow
      );
    }
    return rgba;
  } finally {
    // 成功・失敗の両方でmap状態を解除し、Download用の一時bufferを破棄する
    if (mapped) readBuffer.unmap();
    readBuffer.destroy();
  }
}

// RGBA8を書き込んだ非表示Canvasをbrowser encoderへ渡し、PNGまたはJPEG Blobの完了を待つ
// toBlobの未対応形式やencoder失敗はPromiseのrejectで呼出側へ報告する
function encodeCanvas(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`Browser failed to encode ${mimeType}`));
    }, mimeType, quality);
  });
}

// Download要求時だけGPU textureをreadbackし、元texture寸法を保った画像へencodeする
// 最後にGenerate成功したColor・Height・Normalだけを対象とし、編集中definitionとの取り違えを拒否する
async function downloadTextureImage(mapKind) {
  if (generating || imageExporting) throw new Error("Texture generation or image download is already running");
  if (!activeMaterial?.result) throw new Error("Generate a texture before downloading an image");
  if (definitionDirty) throw new Error("Click Generate before downloading the edited texture image");
  imageExporting = true;
  byId("apply").disabled = true;
  byId("downloadColorImage").disabled = true;
  byId("downloadNormalImage").disabled = true;
  byId("downloadHeightImage").disabled = true;
  try {
    // Download開始時点の生成resultとIDを固定し、encode中も保存対象とfilenameを対応させる
    const result = activeMaterial.result;
    const baseName = exportBaseName(activeMaterial.definition);
    const texture = { color: result.colorTexture, height: result.heightTexture, normal: result.normalTexture }[mapKind];
    const rgba = await readTextureRgba(texture, result.width, result.height);
    const canvas = document.createElement("canvas");
    canvas.width = result.width;
    canvas.height = result.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable for texture image export");
    // readbackしたchannel値を一画素ずつCanvasへ置き、元texture寸法を維持する
    context.putImageData(new ImageData(rgba, result.width, result.height), 0, 0);
    const format = byId("imageFormat").value;
    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const extension = format === "jpeg" ? "jpg" : "png";
    const blob = await encodeCanvas(canvas, mimeType, format === "jpeg" ? 0.92 : undefined);
    downloadBlob(`${baseName}_${mapKind}.${extension}`, blob);
    byId("error").textContent = `Downloaded ${mapKind} map as ${extension.toUpperCase()}`;
  } finally {
    // encodeやbrowser downloadが失敗しても操作buttonを必ず復帰させ、再試行できる状態へ戻す
    imageExporting = false;
    byId("apply").disabled = false;
    byId("downloadColorImage").disabled = false;
    byId("downloadNormalImage").disabled = false;
    byId("downloadHeightImage").disabled = false;
    // 画像変換中に編集されたdefinitionがあれば、完了後に最新値のGPU生成を再開する
    if (definitionDirty) generateFromUi();
  }
}

// Generate button、G shortcut、自動反映から同じ非同期生成queueを起動する
// 生成側がerror表示とresource cleanupを担当し、入口側は要求の受付に集中する
function generateFromUi() {
  requestGeneration().catch(() => {});
}

// KeyboardEventが修飾keyなしの一回限りのG押下かを判定する
// IME変換中、OS／browser shortcut、key repeatを除外し、通常の単発操作でGPU生成を実行する
function isGenerateShortcut(event) {
  return event.code === "KeyG"
    && !event.repeat
    && !event.isComposing
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey;
}

// text入力欄とtextareaではGを通常文字として扱い、Generate shortcutのpreventDefault対象から外す
// number inputではG shortcutを使えるため、入力型を確認して対象を限定する
function isTextEntryTarget(target) {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement
    && ["text", "search", "email", "url", "tel", "password"].includes(target.type);
}

// panel内のnumber入力と矢印stepは編集操作として処理し、camera操作はpanel外で受け付ける
// text入力欄以外のGはGenerateへ割り当て、その他のkeyはcontrol本来のdefault動作へ任せる
function setupKeyboardControls() {
  // panel controlをevent境界とし、number入力の文字や矢印はDOMの標準操作へ渡す
  for (const control of document.querySelectorAll(".panel input, .panel select, .panel textarea, .panel button")) {
    control.addEventListener("keydown", (event) => {
      if (isGenerateShortcut(event) && !isTextEntryTarget(event.target)) {
        event.preventDefault();
        generateFromUi();
      }
      event.stopPropagation();
    });
    control.addEventListener("keyup", (event) => event.stopPropagation());
  }
  // focusがpanel外にある場合も同じ判定を使い、Canvas操作中のGをGenerateへ接続する
  document.addEventListener("keydown", (event) => {
    if (!isGenerateShortcut(event) || isTextEntryTarget(event.target)) return;
    event.preventDefault();
    generateFromUi();
  });
}

// preset選択、編集、生成、clipboard、file入出力のDOM eventを一度だけ登録する
// control変更は作業definitionとcodeを更新した直後にGPU生成を要求し、画面表示を最新値へ合わせる
function setupControls() {
  // 第1段階でcore catalog由来の選択肢と初期preset値をDOMへ構築する
  for (const mode of PATTERN_MODES) byId("patternMode").append(new Option(mode, mode));
  populateCategories();
  populatePresets("all", ProceduralMaterials.listPresetIds()[0]);
  byId("category").addEventListener("change", () => {
    populatePresets();
    generateFromUi();
  });
  byId("preset").addEventListener("change", () => {
    selectPreset(byId("preset").value);
    generateFromUi();
  });
  byId("layoutMode").addEventListener("change", handleLayoutModeChange);
  byId("thicknessMode").addEventListener("input", syncThicknessControl);
  byId("thicknessMode").addEventListener("change", syncThicknessControl);
  byId("reset").addEventListener("click", () => {
    selectPreset(selectedPresetId);
    generateFromUi();
  });
  byId("apply").addEventListener("click", generateFromUi);
  // 第2段階で材質controlの変更を作業definitionへ反映し、同じ入力イベントからGPU生成も開始する
  for (const input of document.querySelectorAll("input, select")) {
    if (
      input.id === "category"
      || input.id === "preset"
      || input.id === "imageFormat"
      || input.id === "layoutMode"
    ) continue;
    input.addEventListener("input", () => {
      if (input.type === "number" && (input.value === "" || input.validity.badInput)) {
        definitionDirty = true;
        byId("info").textContent = "";
        byId("error").textContent = "";
        return;
      }
      updateWorkingDefinitionFromControls({ normalizeNumbers: false });
      // numberとmetadataは確定時の値を使い、一度だけGPU生成を実行する
      if (input.type !== "number" && !DEFINITION_TEXT_CONTROLS.has(input.id)) generateFromUi();
    });
    input.addEventListener("change", () => {
      if (input.type !== "number" && !DEFINITION_TEXT_CONTROLS.has(input.id)) return;
      updateWorkingDefinitionFromControls();
      generateFromUi();
    });
  }
  // 第3段階で完成definitionのclipboard／text file出力を登録する
  byId("copy").addEventListener("click", async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API is not available");
      await navigator.clipboard.writeText(buildJavaScript());
      byId("error").textContent = "Copied JavaScript to clipboard";
    } catch (error) {
      byId("error").textContent = error?.message ?? String(error);
    }
  });
  byId("downloadJs").addEventListener("click", () => (
    downloadText(`${exportBaseName()}.js`, "text/javascript", buildJavaScript())
  ));
  byId("downloadJson").addEventListener("click", () => (
    downloadText(`${exportBaseName()}.json`, "application/json", `${JSON.stringify(workingDefinition, null, 2)}\n`)
  ));
  // 第4段階で最後にGenerate成功したColor／Height／Normalの画像出力を個別buttonへ接続する
  byId("downloadColorImage").addEventListener("click", () => {
    downloadTextureImage("color").catch((error) => {
      byId("error").textContent = error?.message ?? String(error);
    });
  });
  byId("downloadNormalImage").addEventListener("click", () => {
    downloadTextureImage("normal").catch((error) => {
      byId("error").textContent = error?.message ?? String(error);
    });
  });
  byId("downloadHeightImage").addEventListener("click", () => {
    downloadTextureImage("height").catch((error) => {
      byId("error").textContent = error?.message ?? String(error);
    });
  });
  // 第5段階で外部JSONを作業definitionへ読み込み、core検証を通した生成までを一操作で行う
  byId("importJson").addEventListener("click", () => byId("importJsonFile").click());
  byId("importJsonFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const definition = JSON.parse(await file.text());
      workingDefinition = cloneDefinition(definition);
      definitionDirty = true;
      writeDefinitionToControls(workingDefinition);
      await requestGeneration();
      byId("error").textContent = `Imported ${file.name}`;
    } catch (error) {
      byId("error").textContent = error?.message ?? String(error);
    } finally {
      event.target.value = "";
    }
  });
  // DOM controlがすべて揃った後にkeyboard境界を設定し、追加済みbuttonとinputも対象へ含める
  setupKeyboardControls();
}

// WebgApp、ProceduralMaterials、初期preview、camera、diagnosticsを依存順に初期化して描画loopを開始する
// 途中で失敗した場合は呼び出し元のDOMContentLoaded handlerへ例外を返し、共通error panelで報告する
async function start() {
  // 第1段階でCanvas、rendering、diagnosticsを所有するWebgAppを作り、GPU利用可能状態まで待つ
  app = new WebgApp({
    document,
    layoutMode: "embedded",
    fixedCanvasSize: { width: 960, height: 720, useDevicePixelRatio: false },
    clearColor: [0.045, 0.065, 0.080, 1],
    viewAngle: 48,
    projectionNear: 0.1,
    projectionFar: 200,
    camera: CAMERA_CONFIG,
    lightPosition: [24, 30, 34, 1],
    debugTools: {
      mode: "release",
      system: "texture_catalog",
      source: "samples/texture_catalog/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();

  // 文書内のstage寸法へCanvasとprojectionを合わせる
  // window全体の寸法で描くと、横の設定欄や下の本文へCanvasがはみ出してしまう
  const stage = byId("canvas").closest(".stage");
  // 現在のCanvas寸法へ描画先を合わせ、材質previewを再描画する
  const resizePreview = () => {
    app.fixedCanvasSize = {
      width: Math.max(1, Math.round(stage.clientWidth)),
      height: Math.max(1, Math.round(stage.clientHeight)),
      useDevicePixelRatio: false
    };
    app.applyViewportLayout();
  };
  resizePreview();
  const previewObserver = new ResizeObserver(resizePreview);
  previewObserver.observe(stage);
  window.addEventListener("pagehide", () => previewObserver.disconnect(), { once: true });

  // 第2段階でcore material managerとUIを作り、registry先頭presetを最初のGPU textureへ生成する
  materials = new ProceduralMaterials(app.getGPU());
  setupControls();
  await generateCurrentDefinition();
  if (!app.createOrbitEyeRig(CAMERA_CONFIG)) {
    throw new Error("texture_catalog failed to create orbit EyeRig");
  }
  // 第3段階で正常起動後のdiagnostics snapshotとdebug keyを登録し、継続描画を開始する
  app.setDiagnosticsStage("runtime");
  app.configureDiagnosticsCapture({
    labelPrefix: "texture_catalog",
    // 現在のpreset ID・完成definition・画像寸法をdiagnosticsのsnapshotへ返す
    collect: () => ({
      presetId: workingDefinition?.id ?? null,
      definition: workingDefinition,
      mapSize: activeMaterial ? [activeMaterial.result.width, activeMaterial.result.height] : null
    })
  });
  app.configureDebugKeyInput();
  app.start({ onBeforeDraw: drawPreviews,
    // 更新callbackを入口として用意し、previewの描画はonBeforeDrawへ集約する
    onUpdate: () => {} });
}

// page離脱時にShape側とProceduralMaterials側の所有resourceをそれぞれ解放する
window.addEventListener("pagehide", () => {
  activeShape?.destroy({ destroyResource: true });
  materials?.destroy();
});

// DOM構築完了後に非同期起動を開始し、起動段階の例外を画面内errorとdiagnosticsの両方へ保存する
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    byId("error").textContent = error?.message ?? String(error);
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(error, {
      system: "texture_catalog",
      source: "samples/texture_catalog/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      id: "texture-catalog-error",
      title: "texture_catalog failed"
    }));
  });
});
