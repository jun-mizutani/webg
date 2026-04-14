import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "book", "img", "svg");

const WIDTH = 1280;
const HEIGHT = 760;
const TEXT_PRIMARY = "#111827";
const TEXT_SECONDARY = "#374151";
const ARROW_COLOR = "#4b5563";

function getLineUnits(line) {
  let units = 0;
  for (const char of String(line)) {
    if (char === " ") {
      units += 0.35;
    } else if (/[\u0000-\u00ff]/.test(char)) {
      units += /[A-Z0-9]/.test(char) ? 0.72 : 0.62;
    } else if (/[\u3000-\u303f\u30a0-\u30ff]/.test(char)) {
      units += 0.92;
    } else {
      units += 1.0;
    }
  }
  return units;
}

function fitTextSize(text, maxWidth, maxHeight, preferredSize, leading, options = {}) {
  const {
    minSize = 16,
    widthPadding = 28,
    heightPadding = 24
  } = options;
  const lines = String(text).split("\n");
  const maxUnits = Math.max(...lines.map((line) => getLineUnits(line)), 1);
  const lineCount = Math.max(lines.length, 1);
  const usableWidth = Math.max(maxWidth - widthPadding * 2, 1);
  const usableHeight = Math.max(maxHeight - heightPadding * 2, 1);
  const widthLimitedSize = usableWidth / Math.max(maxUnits * 0.96, 1);
  const heightLimitedSize = usableHeight / Math.max(1 + (lineCount - 1) * leading, 1);
  return Math.max(minSize, Math.min(preferredSize, widthLimitedSize, heightLimitedSize));
}

function estimateBoxWidth(text, preferredSize, options = {}) {
  const {
    minWidth = 120,
    maxWidth = 420,
    paddingX = 28
  } = options;
  const lines = String(text).split("\n");
  const maxUnits = Math.max(...lines.map((line) => getLineUnits(line)), 1);
  const estimatedWidth = maxUnits * preferredSize * 0.96 + paddingX * 2;
  return Math.max(minWidth, Math.min(maxWidth, estimatedWidth));
}

function esc(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function svgText(x, y, text, options = {}) {
  const {
    size = 26,
    weight = 500,
    fill = TEXT_PRIMARY,
    anchor = "middle",
    leading = 1.35
  } = options;
  const lines = String(text).split("\n");
  const firstDy = lines.length > 1 ? `${-(lines.length - 1) * leading * 0.5}em` : "0";
  const tspans = lines
    .map((line, index) =>
      `<tspan x="${x}" dy="${index === 0 ? firstDy : `${leading}em`}">${esc(line)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${fill}" font-family="'Segoe UI', 'Hiragino Sans', 'Yu Gothic UI', sans-serif">${tspans}</text>`;
}

function box(x, y, w, h, title, options = {}) {
  const {
    fill = "#f7fbff",
    stroke = "#2f537f",
    strokeWidth = 2.5,
    radius = 20,
    titleSize = 26,
    titleFill = TEXT_PRIMARY,
    titleWeight = 600,
    titleLeading = 1.35,
    minTitleSize = 16,
    titlePaddingX = 28,
    titlePaddingY = 22
  } = options;
  const fittedTitleSize = fitTextSize(title, w, h, titleSize, titleLeading, {
    minSize: minTitleSize,
    widthPadding: titlePaddingX,
    heightPadding: titlePaddingY
  });
  const rect = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  const label = svgText(x + w / 2, y + h / 2, title, {
    size: fittedTitleSize,
    fill: titleFill,
    weight: titleWeight,
    leading: titleLeading
  });
  return `${rect}${label}`;
}

function autoWidthBox(centerX, y, h, title, options = {}) {
  const {
    titleSize = 26,
    minWidth = 120,
    maxWidth = 420,
    titlePaddingX = 28
  } = options;
  const width = estimateBoxWidth(title, titleSize, {
    minWidth,
    maxWidth,
    paddingX: titlePaddingX
  });
  const x = centerX - width / 2;
  return box(x, y, width, h, title, options);
}

function panel(x, y, w, h, label, options = {}) {
  const {
    fill = "#eef4ff",
    stroke = "#9db4d7",
    labelFill = TEXT_SECONDARY
  } = options;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" ry="28" fill="${fill}" stroke="${stroke}" stroke-width="2.2"/>
    ${svgText(x + 24, y + 38, label, { size: 24, fill: labelFill, anchor: "start", weight: 700 })}
  `;
}

function arrow(x1, y1, x2, y2, options = {}) {
  const {
    dashed = false,
    color = ARROW_COLOR,
    width = 3.0,
    label = "",
    labelX = null,
    labelY = null,
    labelColor = TEXT_SECONDARY
  } = options;
  const dash = dashed ? `stroke-dasharray="10 8"` : "";
  const line = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${dash} marker-end="url(#arrow)"/>`;
  if (!label) return line;
  return `${line}${svgText(labelX ?? (x1 + x2) / 2, labelY ?? (y1 + y2) / 2 - 12, label, { size: 20, fill: labelColor })}`;
}

function titleBlock(_chapter, title) {
  return `
    ${svgText(56, 98, title, { size: 33, fill: TEXT_PRIMARY, anchor: "start", weight: 700 })}
    <line x1="56" y1="118" x2="${WIDTH - 56}" y2="118" stroke="#d8e3f4" stroke-width="2"/>
  `;
}

function baseSvg(chapter, title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${esc(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fbfdff"/>
      <stop offset="100%" stop-color="#eef4fb"/>
    </linearGradient>
    <marker id="arrow" viewBox="0 0 10 10" refX="8.4" refY="5" markerWidth="4.1" markerHeight="4.1" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/>
    </marker>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  ${titleBlock(chapter, title)}
  ${body}
</svg>`;
}

function writeFigure(fileName, chapter, title, body) {
  return {
    fileName,
    content: baseSvg(chapter, title, body)
  };
}

const figures = [
  writeFigure(
    "fig03_01_coordinate_rotation_basics.svg",
    "第3章",
    "座標系と回転の基準",
    `
    ${box(116, 232, 282, 190, "右手系\n+X = 右\n+Y = 上\n+Z = 前", { fill: "#eef5ff", titleSize: 30 })}
    ${box(488, 214, 296, 226, "回転の対応\nhead = yaw = Y軸\npitch = pitch = X軸\nbank = roll = Z軸", { fill: "#f9fcff", titleSize: 28 })}
    ${box(896, 232, 248, 190, "正の head\n前 +Z が\n右 +X へ回る", { fill: "#fff8ef", stroke: "#bc8752", titleFill: TEXT_PRIMARY, titleSize: 30 })}

    <line x1="178" y1="536" x2="332" y2="536" stroke="${ARROW_COLOR}" stroke-width="5" marker-end="url(#arrow)"/>
    <line x1="178" y1="536" x2="178" y2="404" stroke="#4a9c83" stroke-width="6" marker-end="url(#arrow)"/>
    <line x1="178" y1="536" x2="104" y2="602" stroke="#bc8752" stroke-width="6" marker-end="url(#arrow)"/>
    ${svgText(348, 540, "+X", { size: 24, fill: TEXT_PRIMARY, anchor: "start" })}
    ${svgText(178, 386, "+Y", { size: 24, fill: TEXT_PRIMARY })}
    ${svgText(88, 626, "+Z", { size: 24, fill: TEXT_PRIMARY, anchor: "start" })}

    <circle cx="1018" cy="532" r="92" fill="none" stroke="#bc8752" stroke-width="4" stroke-dasharray="10 8"/>
    <line x1="1018" y1="532" x2="1018" y2="426" stroke="#4a9c83" stroke-width="6" marker-end="url(#arrow)"/>
    <line x1="1018" y1="532" x2="1110" y2="532" stroke="${ARROW_COLOR}" stroke-width="5" marker-end="url(#arrow)"/>
    <circle cx="1018" cy="440" r="8" fill="#bc8752"/>
    <path d="M 1018 440 A 92 92 0 0 1 1100 494" fill="none" stroke="#bc8752" stroke-width="5" marker-end="url(#arrow)"/>
    ${svgText(1134, 536, "+X", { size: 24, fill: TEXT_PRIMARY, anchor: "start" })}
    ${svgText(1018, 406, "+Y", { size: 24, fill: TEXT_PRIMARY })}
    ${svgText(980, 428, "+Z", { size: 24, fill: TEXT_PRIMARY, anchor: "end" })}
    ${svgText(1136, 476, "head +90", { size: 22, fill: TEXT_PRIMARY, anchor: "start" })}

    ${svgText(640, 626, "第3章では、軸の向きと回転軸の対応を最初に固定して読むと後続の章がつながりやすい", { size: 24, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig03_02_uv_normalmap.svg",
    "第3章",
    "UV とノーマルマップの読み方",
    `
    ${panel(94, 186, 454, 442, "UV 座標")}
    ${panel(732, 186, 454, 442, "normal map")}

    <rect x="166" y="276" width="308" height="236" fill="#ffffff" stroke="#2f537f" stroke-width="3"/>
    <line x1="166" y1="512" x2="474" y2="512" stroke="${ARROW_COLOR}" stroke-width="4" marker-end="url(#arrow)"/>
    <line x1="166" y1="512" x2="166" y2="250" stroke="#4a9c83" stroke-width="5" marker-end="url(#arrow)"/>
    ${svgText(492, 520, "U", { size: 24, fill: TEXT_PRIMARY, anchor: "start" })}
    ${svgText(166, 236, "V", { size: 24, fill: TEXT_PRIMARY })}
    ${svgText(162, 540, "(0,0)", { size: 22, fill: TEXT_PRIMARY, anchor: "start" })}
    ${svgText(474, 540, "(1,0)", { size: 22, fill: TEXT_PRIMARY })}
    ${svgText(474, 258, "(1,1)", { size: 22, fill: TEXT_PRIMARY })}
    ${svgText(166, 258, "(0,1)", { size: 22, fill: TEXT_PRIMARY, anchor: "start" })}

    <rect x="810" y="282" width="126" height="126" fill="#d48383" stroke="#2f537f" stroke-width="2"/>
    <rect x="936" y="282" width="126" height="126" fill="#81c89b" stroke="#2f537f" stroke-width="2"/>
    <rect x="873" y="408" width="126" height="126" fill="#7d9dde" stroke="#2f537f" stroke-width="2"/>
    ${svgText(873, 348, "R -> X", { size: 22, fill: "#ffffff", weight: 700 })}
    ${svgText(999, 348, "G -> Y", { size: 22, fill: "#ffffff", weight: 700 })}
    ${svgText(936, 474, "B -> Z", { size: 22, fill: "#ffffff", weight: 700 })}
    ${svgText(936, 566, "0..1 の色を\n-1..1 の方向ベクトルへ戻して使う", { size: 24, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig03_03_projection_fov.svg",
    "第3章",
    "視野角と見え方の違い",
    `
    ${box(122, 236, 280, 264, "狭い FOV\n35°\n望遠寄り\n写る範囲は狭い", { fill: "#f9fcff", titleSize: 30 })}
    ${box(500, 236, 280, 264, "標準 FOV\n55°\n基準の見え方", { fill: "#eef5ff", titleSize: 30 })}
    ${box(878, 236, 280, 264, "広い FOV\n85°\n広角寄り\n写る範囲は広い", { fill: "#fff8ef", stroke: "#bc8752", titleFill: TEXT_PRIMARY, titleSize: 30 })}

    <path d="M 180 560 L 262 410 L 344 560 Z" fill="none" stroke="${ARROW_COLOR}" stroke-width="4"/>
    <path d="M 520 560 L 640 382 L 760 560 Z" fill="none" stroke="#4a9c83" stroke-width="5"/>
    <path d="M 888 560 L 1018 342 L 1148 560 Z" fill="none" stroke="#bc8752" stroke-width="5"/>

    ${svgText(262, 596, "同じ位置でも対象が大きく見える", { size: 22, fill: TEXT_SECONDARY })}
    ${svgText(640, 596, "標準的な基準", { size: 22, fill: TEXT_SECONDARY })}
    ${svgText(1018, 596, "同じ位置でも対象が小さく見える", { size: 22, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig03_04_quat_and_gltf_order.svg",
    "第3章",
    "クォータニオンと glTF の並び順",
    `
    ${autoWidthBox(300, 256, 158, "webg Quat\n[w, x, y, z]", { fill: "#eef5ff", titleSize: 34, minWidth: 240, maxWidth: 300 })}
    ${autoWidthBox(980, 256, 158, "glTF / GLB\n[x, y, z, w]", { fill: "#fff8ef", stroke: "#bc8752", titleFill: TEXT_PRIMARY, titleSize: 34, minWidth: 240, maxWidth: 310 })}
    ${autoWidthBox(640, 504, 110, "読み込み時に並び替えてから\n行列や runtime 姿勢へ変換する", { fill: "#eef8f5", stroke: "#4a9c83", titleFill: TEXT_PRIMARY, titleSize: 28, minWidth: 280, maxWidth: 350 })}

    ${arrow(480, 334, 800, 334, { dashed: true, label: "順序が違う", labelX: 640, labelY: 296 })}
    ${arrow(980, 414, 640, 504, { color: "#4a9c83", label: "loader が変換", labelX: 822, labelY: 470 })}
    ${arrow(300, 414, 640, 504, { color: "#4a9c83" })}

    ${svgText(640, 668, "第3章では [w,x,y,z] と [x,y,z,w] を混同しないことが重要", { size: 24, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig04_01_minimum_to_webgapp_flow.svg",
    "第4章",
    "最小描画から WebgApp への流れ",
    `
    ${panel(60, 170, 520, 470, "ローレベルの最小構成")}
    ${panel(700, 170, 520, 470, "WebgApp の標準構成")}

    ${box(160, 236, 320, 72, "1. Screen を作って await ready")}
    ${box(160, 338, 320, 72, "2. Shader / projection を初期化")}
    ${box(160, 440, 320, 72, "3. Space / eye / Shape を作る")}
    ${box(160, 542, 320, 72, "4. clear -> draw -> present を回す")}

    ${box(800, 236, 320, 72, "1. new WebgApp(options)")}
    ${box(800, 338, 320, 72, "2. await app.init()")}
    ${box(800, 440, 320, 72, "3. shape / model / scene を追加")}
    ${box(800, 542, 320, 72, "4. app.start() で入力 / HUD / 診断も回す")}

    ${arrow(320, 308, 320, 338)}
    ${arrow(320, 410, 320, 440)}
    ${arrow(320, 512, 320, 542)}
    ${arrow(960, 308, 960, 338)}
    ${arrow(960, 410, 960, 440)}
    ${arrow(960, 512, 960, 542)}
    ${arrow(480, 374, 800, 374, { dashed: true, label: "描画の骨格を理解したあとで標準構成へ", labelX: 640, labelY: 336 })}

    ${svgText(320, 676, "最初は何が最低限必要かを確認する", { size: 22, fill: TEXT_SECONDARY })}
    ${svgText(960, 676, "慣れたら WebgApp で補助機能込みの構成へ進む", { size: 22, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig05_01_webgapp_overview.svg",
    "第5章",
    "WebgApp 全体構成図",
    `
    ${panel(52, 162, 300, 470, "利用者コード")}
    ${panel(394, 162, 468, 470, "WebgApp が束ねる基盤")}
    ${panel(904, 162, 324, 470, "毎フレーム")}

    ${box(86, 232, 232, 86, "new WebgApp(options)")}
    ${box(86, 354, 232, 86, "await app.init()")}
    ${box(86, 476, 232, 96, "app.start({\nonUpdate,\nonAfterHud\n})")}

    ${box(430, 210, 182, 78, "Screen\ncanvas / WebGPU")}
    ${box(644, 210, 182, 78, "Space\nscene graph")}
    ${box(430, 318, 182, 78, "camera rig\nbase / rod / eye")}
    ${box(644, 318, 182, 78, "InputController\nkeyboard / touch")}
    ${box(430, 426, 182, 78, "HUD / Overlay\nMessage / UIPanel")}
    ${box(644, 426, 182, 78, "Diagnostics\nDebugDock / probe")}
    ${box(537, 534, 182, 78, "Loader facade\nModelLoader / SceneLoader")}

    ${box(952, 248, 228, 86, "update\nhandlers")}
    ${box(952, 372, 228, 86, "draw 3D\nscene")}
    ${box(952, 496, 228, 86, "draw HUD /\noverlays")}

    ${arrow(202, 318, 202, 354)}
    ${arrow(202, 440, 202, 476)}
    ${arrow(318, 399, 430, 250)}
    ${arrow(318, 399, 644, 250)}
    ${arrow(318, 399, 430, 358)}
    ${arrow(318, 399, 644, 358)}
    ${arrow(318, 399, 430, 466)}
    ${arrow(318, 399, 644, 466)}
    ${arrow(318, 399, 537, 574)}

    ${arrow(826, 249, 952, 291, { label: "init で準備", labelY: 212 })}
    ${arrow(826, 358, 952, 415)}
    ${arrow(826, 466, 952, 539)}
    ${arrow(612, 612, 612, 650, { dashed: true, label: "loadModel / loadScene", labelX: 724, labelY: 640 })}

    ${svgText(1040, 650, "3D と UI の入口を 1 か所にまとめる", { size: 24, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig06_01_eyerig_base_rod_eye.svg",
    "第6章",
    "base -> rod -> eye カメラ構成図",
    `
    ${autoWidthBox(257, 316, 112, "base\n水平位置 / yaw", { fill: "#f9fcff", minWidth: 160, maxWidth: 190 })}
    ${autoWidthBox(621, 316, 112, "rod\npitch / distance", { fill: "#f9fcff", minWidth: 180, maxWidth: 220 })}
    ${autoWidthBox(985, 316, 112, "eye\n実際の視点", { fill: "#f9fcff", minWidth: 150, maxWidth: 180 })}
    ${autoWidthBox(985, 524, 90, "target\n注視点", { fill: "#fff8ef", stroke: "#bc8752", titleFill: TEXT_PRIMARY, minWidth: 150, maxWidth: 180 })}
    ${autoWidthBox(621, 170, 92, "WebgApp\nviewAngle / near / far", { fill: "#eef8f5", stroke: "#4a9c83", titleFill: TEXT_PRIMARY, minWidth: 190, maxWidth: 240 })}

    ${arrow(372, 372, 506, 372)}
    ${arrow(736, 372, 870, 372)}
    ${arrow(736, 216, 986, 316, { dashed: true, color: "#4a9c83", label: "投影設定", labelX: 876, labelY: 228 })}
    ${arrow(986, 524, 986, 428, { dashed: true, color: "#bc8752", label: "注視", labelX: 1042, labelY: 474 })}

    ${svgText(256, 470, "体の基準や追従位置", { size: 22, fill: TEXT_SECONDARY })}
    ${svgText(620, 470, "角度と距離を分離", { size: 22, fill: TEXT_SECONDARY })}
    ${svgText(986, 470, "最終的に Space.setEye() される", { size: 22, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig07_01_material_and_shader_routing.svg",
    "第7章",
    "Shape と Shader への値の渡し分け",
    `
    ${panel(64, 172, 364, 460, "Shape 側へ持たせる値")}
    ${panel(458, 172, 364, 460, "描画直前の受け渡し")}
    ${panel(852, 172, 364, 460, "Shader 側で共有する値")}

    ${box(126, 246, 240, 86, "color / texture\nnormal map", { titleSize: 25, titlePaddingX: 14, titlePaddingY: 12 })}
    ${box(126, 368, 240, 86, "ambient / specular\npower / emissive", { titleSize: 23, titlePaddingX: 10, titlePaddingY: 12 })}
    ${box(126, 490, 240, 86, "has_bone\nweight_debug", { titleSize: 23, titlePaddingX: 16, titlePaddingY: 12 })}

    ${box(491, 310, 297, 120, "Shape.materialParams\n-> shader.doParameter()\n-> setter へ流す", { titleSize: 22.8, titlePaddingX: 12, titlePaddingY: 12, radius: 24, strokeWidth: 2.73 })}

    ${box(914, 246, 240, 86, "light position", { titleSize: 22.8, titlePaddingX: 12, titlePaddingY: 12 })}
    ${box(914, 368, 240, 86, "fog default", { titleSize: 22.5, titlePaddingX: 12, titlePaddingY: 12 })}
    ${box(914, 490, 240, 86, "bind group / palette\nshared state", { titleSize: 24.2, titlePaddingX: 10, titlePaddingY: 12 })}

    ${arrow(365.93, 288.87, 487.51, 339.92)}
    ${arrow(365.93, 411.0, 487.51, 369.95)}
    ${arrow(365.93, 533.13, 487.51, 399.99)}
    ${arrow(793.88, 339.9, 914.22, 288.83, { dashed: true, label: "描画ごとに\n使い分け", labelX: 836.82, labelY: 283.26 })}
    ${arrow(793.88, 369.94, 914.22, 411.0)}
    ${arrow(793.88, 399.99, 914.22, 533.17)}

    ${svgText(246, 674, "オブジェクトごとの差として変わる値", { size: 22, fill: TEXT_SECONDARY })}
    ${svgText(1034, 674, "複数 Shape で共有するほうが自然な値", { size: 22, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig10_01_modelasset_build_instantiate.svg",
    "第10章",
    "ModelAsset -> build -> instantiate",
    `
    ${panel(58, 174, 228, 404, "入力形式")}
    ${box(92, 232, 160, 72, "glTF / GLB")}
    ${box(92, 340, 160, 72, "Collada")}
    ${box(92, 448, 160, 72, "imported JSON")}

    ${autoWidthBox(460, 320, 102, "ModelAsset\nCPU 側の共通データ", { minWidth: 190, maxWidth: 240 })}
    ${autoWidthBox(724, 246, 76, "validate", { minWidth: 120, maxWidth: 150 })}
    ${autoWidthBox(724, 366, 76, "build()", { minWidth: 120, maxWidth: 150 })}
    ${autoWidthBox(1030, 274, 120, "model runtime\nshared GPU buffers\ntextures / skeleton", { minWidth: 240, maxWidth: 310 })}
    ${autoWidthBox(1006, 444, 72, "instantiate() -> A", { minWidth: 180, maxWidth: 220 })}
    ${autoWidthBox(1006, 544, 72, "instantiate() -> B", { minWidth: 180, maxWidth: 220 })}
    ${autoWidthBox(1006, 644, 72, "instantiate() -> C", { minWidth: 180, maxWidth: 220 })}

    ${arrow(252, 268, 358, 356)}
    ${arrow(252, 376, 358, 371)}
    ${arrow(252, 484, 358, 386)}
    ${arrow(562, 371, 632, 284)}
    ${arrow(562, 371, 632, 404)}
    ${arrow(816, 404, 874, 334)}
    ${arrow(1030, 394, 1030, 444)}
    ${arrow(1030, 516, 1030, 544)}
    ${arrow(1030, 616, 1030, 644)}

    ${svgText(1030, 420, "build は 1 回", { size: 24, fill: TEXT_SECONDARY })}
    ${svgText(1142, 736, "必要な数だけ instance を作る", { size: 22, fill: TEXT_SECONDARY, anchor: "start" })}
  `
  ),
  writeFigure(
    "fig11_01_scenejson_scope.svg",
    "第11章",
    "Scene JSON の守備範囲図",
    `
    ${box(500, 280, 280, 120, "Scene JSON", { fill: "#eef5ff", stroke: "#2f537f", titleSize: 34 })}

    ${box(170, 172, 180, 82, "camera")}
    ${box(170, 322, 180, 82, "HUD / guide /\nstatus")}
    ${box(170, 472, 180, 82, "input\nactions")}

    ${box(930, 160, 180, 82, "primitive\nentries")}
    ${box(930, 290, 180, 82, "model\nentries")}
    ${box(930, 420, 180, 82, "tileMap")}
    ${box(930, 550, 180, 82, "animation /\nmetadata")}
    ${box(930, 674, 180, 72, "ModelAsset", { fill: "#fff8ef", stroke: "#bc8752", titleFill: TEXT_PRIMARY })}

    ${arrow(350, 214, 500, 314)}
    ${arrow(350, 364, 500, 340)}
    ${arrow(350, 514, 500, 366)}
    ${arrow(780, 314, 930, 201)}
    ${arrow(780, 340, 930, 331)}
    ${arrow(780, 366, 930, 461)}
    ${arrow(780, 392, 930, 591)}
    ${arrow(1020, 632, 1020, 674, { dashed: true, color: "#bc8752", label: "参照", labelX: 1066, labelY: 640 })}

    ${svgText(640, 468, "1 モデルではなく\nシーン全体の初期状態を宣言する", { size: 26, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig12_01_animation_layers.svg",
    "第12章",
    "clip -> action -> state -> task 層図",
    `
    ${box(92, 308, 206, 120, "clip\n元の animation data")}
    ${box(374, 308, 206, 120, "action\n使う区間を切り出す")}
    ${box(656, 308, 206, 120, "state\n今どの action を選ぶか")}
    ${box(938, 308, 206, 120, "schedule / task\n時間進行と補間実行")}

    ${box(938, 526, 206, 92, "node pose\nupdate", { fill: "#eef8f5", stroke: "#4a9c83", titleFill: TEXT_PRIMARY })}

    ${arrow(298, 368, 374, 368)}
    ${arrow(580, 368, 656, 368)}
    ${arrow(862, 368, 938, 368)}
    ${arrow(1041, 428, 1041, 526)}

    ${svgText(195, 470, "アセットが持つ連続データ", { size: 22, fill: TEXT_SECONDARY })}
    ${svgText(477, 470, "どこを使うかを決める", { size: 22, fill: TEXT_SECONDARY })}
    ${svgText(759, 470, "状況に応じて選択する", { size: 22, fill: TEXT_SECONDARY })}
    ${svgText(1041, 470, "実際に時間を進める", { size: 22, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig14_01_ui_component_selector.svg",
    "第14章",
    "UI 部品選択表",
    `
    ${box(452, 170, 376, 112, "今ほしい UI は何か", { fill: "#eef5ff", titleSize: 34 })}
    ${box(120, 404, 220, 96, "短い情報を\n常時見せたい")}
    ${box(390, 404, 220, 96, "長文を\n読ませたい")}
    ${box(660, 404, 220, 96, "操作ボタンを\n出したい")}
    ${box(930, 404, 220, 96, "診断情報を\n共有したい")}

    ${box(120, 580, 220, 90, "Text / Message", { fill: "#f9fcff" })}
    ${box(390, 580, 220, 90, "FixedFormatPanel /\nDialogueOverlay", { fill: "#f9fcff" })}
    ${box(660, 580, 220, 90, "UIPanel / Touch", { fill: "#f9fcff" })}
    ${box(930, 580, 220, 90, "Diagnostics /\nDebugDock", { fill: "#f9fcff" })}

    ${arrow(640, 282, 230, 404)}
    ${arrow(640, 282, 500, 404)}
    ${arrow(640, 282, 770, 404)}
    ${arrow(640, 282, 1040, 404)}

    ${arrow(230, 500, 230, 580)}
    ${arrow(500, 500, 500, 580)}
    ${arrow(770, 500, 770, 580)}
    ${arrow(1040, 500, 1040, 580)}
  `
  ),
  writeFigure(
    "fig17_01_hit_test_api_selector.svg",
    "第17章",
    "判定 API の選び分け",
    `
    ${box(468, 170, 344, 92, "今やりたい判定は何か", { fill: "#eef5ff", titleSize: 34 })}

    ${box(98, 358, 246, 96, "クリック / タップで\n何に当たったか")}
    ${box(388, 358, 246, 96, "TileMap のどの cell に\n当たったか")}
    ${box(678, 358, 246, 96, "scene 内の object 同士が\n重なったか")}
    ${box(968, 358, 214, 96, "AABB 候補を\nさらに絞りたい")}

    ${box(98, 566, 246, 86, "Space.raycast()")}
    ${box(388, 566, 246, 86, "TileMap.pickCell()")}
    ${box(678, 566, 246, 86, "checkCollisions()")}
    ${box(968, 566, 214, 86, "checkCollisionsDetailed()")}

    ${arrow(640, 262, 221, 358)}
    ${arrow(640, 262, 511, 358)}
    ${arrow(640, 262, 801, 358)}
    ${arrow(640, 262, 1075, 358)}

    ${arrow(221, 454, 221, 566)}
    ${arrow(511, 454, 511, 566)}
    ${arrow(801, 454, 801, 566)}
    ${arrow(1075, 454, 1075, 566)}
    ${arrow(924, 609, 968, 609, { dashed: true, label: "候補が多すぎるときだけ\n詳細版へ", labelX: 946, labelY: 536 })}

    ${svgText(640, 706, "まず用途ごとに API を分けて選ぶと、判定結果の読み方がかなり整理しやすくなる", { size: 22, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig18_01_audio_layers_and_buses.svg",
    "第18章",
    "AudioSynth とバス構成の全体像",
    `
    ${panel(70, 170, 280, 460, "利用者 / sample 側")}
    ${panel(392, 170, 496, 460, "AudioSynth の基盤")}
    ${panel(930, 170, 280, 460, "出力経路")}

    ${box(106, 232, 208, 72, "ボタン操作\nクリック / タップ")}
    ${box(106, 336, 208, 72, "GameAudioSynth\npreset / SE 名")}
    ${box(106, 440, 208, 72, "sample helper\nBGM preset / event sound")}

    ${box(448, 218, 176, 72, "resume()")}
    ${box(656, 218, 176, 72, "AudioContext\nensureContext()")}
    ${box(448, 334, 176, 72, "SE bus")}
    ${box(656, 334, 176, 72, "BGM bus")}
    ${box(448, 450, 176, 72, "delay")}
    ${box(656, 450, 176, 72, "reverb / IR")}

    ${box(986, 252, 168, 72, "master")}
    ${box(986, 378, 168, 72, "speaker / device")}
    ${box(986, 504, 168, 72, "聞こえ方の調整")}

    ${arrow(314, 268, 448, 254)}
    ${arrow(314, 372, 448, 370)}
    ${arrow(314, 476, 448, 488)}
    ${arrow(624, 254, 656, 254)}
    ${arrow(624, 370, 986, 288)}
    ${arrow(832, 370, 986, 288)}
    ${arrow(624, 486, 986, 540)}
    ${arrow(832, 486, 986, 540)}
    ${arrow(1070, 324, 1070, 378)}

    ${svgText(640, 676, "SE と BGM は別バスで持ち、delay / reverb は量と性格を分けて調整する", { size: 22, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig20_01_postprocess_flow.svg",
    "第20章",
    "ポストプロセス描画フロー図",
    `
    ${autoWidthBox(162, 314, 94, "beginScene()", { minWidth: 132, maxWidth: 160 })}
    ${autoWidthBox(384, 314, 94, "space.draw()", { minWidth: 132, maxWidth: 160 })}
    ${autoWidthBox(634, 298, 126, "offscreen\ncolor + depth", { fill: "#eef8f5", stroke: "#4a9c83", titleFill: TEXT_PRIMARY, minWidth: 180, maxWidth: 220 })}
    ${autoWidthBox(899, 314, 94, "Bloom / DOF /\nVignette", { minWidth: 160, maxWidth: 190 })}
    ${autoWidthBox(1136, 314, 94, "render to\ncanvas", { minWidth: 132, maxWidth: 160 })}
    ${autoWidthBox(899, 534, 84, "clearDepthBuffer()", { fill: "#fff8ef", stroke: "#bc8752", titleFill: TEXT_PRIMARY, minWidth: 180, maxWidth: 220 })}
    ${autoWidthBox(1136, 528, 96, "Message /\nHUD / overlay", { minWidth: 160, maxWidth: 190 })}

    ${arrow(246, 361, 300, 361)}
    ${arrow(468, 361, 522, 361)}
    ${arrow(746, 361, 800, 361)}
    ${arrow(998, 361, 1052, 361)}
    ${arrow(1136, 408, 1136, 528)}
    ${arrow(998, 576, 1052, 576)}

    ${svgText(634, 468, "3D scene をいったんテクスチャへ描く", { size: 24, fill: TEXT_SECONDARY })}
    ${svgText(1136, 662, "HUD は最後に重ねる", { size: 24, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig23_01_tile_logic_visual.svg",
    "第23章",
    "論理位置と見た目位置の分離図",
    `
    ${panel(104, 204, 404, 372, "論理層")}
    ${panel(772, 204, 404, 372, "見た目層")}

    ${box(180, 296, 252, 94, "cell (x, y)")}
    ${box(180, 430, 252, 94, "canMove /\nfindPath")}

    ${box(848, 264, 252, 94, "world target\nposition")}
    ${box(848, 398, 252, 94, "Node.animatePosition()")}
    ${box(848, 532, 252, 94, "displayArea\nscroll")}

    ${arrow(306, 390, 306, 430)}
    ${arrow(432, 343, 848, 311)}
    ${arrow(974, 358, 974, 398)}
    ${arrow(432, 364, 848, 566, { dashed: true, label: "同じ cell から計算", labelX: 646, labelY: 514 })}

    ${svgText(306, 560, "盤面上でどこにいるか", { size: 22, fill: TEXT_SECONDARY })}
    ${svgText(974, 660, "画面上でどう見せるか", { size: 22, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig24_01_tilesim_structure.svg",
    "第24章",
    "tile_sim 構成図",
    `
    ${box(506, 180, 268, 94, "main.js")}
    ${box(210, 364, 220, 90, "controller.js")}
    ${box(504, 364, 220, 90, "camera.js")}
    ${box(798, 364, 220, 90, "mission.js")}
    ${box(504, 524, 220, 90, "terrain.js /\nconstants.js")}
    ${box(210, 566, 220, 90, "alpha_actor.js")}
    ${box(798, 566, 220, 90, "enemy_units.js /\nsupport_units.js")}
    ${box(210, 680, 220, 72, "human.glb runtime", { fill: "#fff8ef", stroke: "#bc8752", titleFill: TEXT_PRIMARY })}

    ${arrow(640, 274, 320, 364)}
    ${arrow(640, 274, 614, 364)}
    ${arrow(640, 274, 908, 364)}
    ${arrow(640, 274, 614, 524)}

    ${arrow(320, 454, 320, 566)}
    ${arrow(908, 454, 908, 566)}
    ${arrow(320, 656, 320, 680)}

    ${svgText(640, 112, "役割を分けて読むと tile_sim の設計が追いやすい", { size: 26, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig25_01_low_level_layer_map.svg",
    "第25章",
    "ローレベル API の 3 層構造",
    `
    ${panel(118, 166, 1044, 150, "GPU 側の入口")}
    ${panel(118, 346, 1044, 170, "シーン変換と配置")}
    ${panel(118, 546, 1044, 140, "数理の土台")}

    ${box(168, 210, 300, 72, "Screen\ncanvas / device / context", { titleSize: 24, titlePaddingX: 8, titlePaddingY: 8 })}
    ${box(458, 210, 364, 72, "Shader\npipeline / uniform / bind group", { titleSize: 24, titlePaddingX: 8, titlePaddingY: 8 })}
    ${box(842, 210, 230, 72, "Shape\nmesh / material", { titleSize: 24, titlePaddingX: 8, titlePaddingY: 8 })}

    ${box(115, 394, 320, 84, "CoordinateSystem\nposition / attitude", { titleSize: 24, titlePaddingX: 8, titlePaddingY: 10 })}
    ${box(415, 394, 240, 84, "Node\nshape を置く実体", { titleSize: 24, titlePaddingX: 10, titlePaddingY: 10 })}
    ${box(670, 394, 250, 84, "Space\nscene 全体を draw", { titleSize: 24, titlePaddingX: 10, titlePaddingY: 10 })}
    ${box(940, 394, 180, 84, "eye\n視点 node", { titleSize: 24, titlePaddingX: 10, titlePaddingY: 10 })}

    ${box(254, 580, 360, 72, "Matrix\nprojection / view / transform", { titleSize: 24, titlePaddingX: 8, titlePaddingY: 8 })}
    ${box(736, 580, 220, 72, "Quat\n回転保持 / 補間", { titleSize: 24, titlePaddingX: 10, titlePaddingY: 8 })}

    ${arrow(468, 246, 458, 246)}
    ${arrow(822, 246, 842, 246)}
    ${arrow(655, 478, 842, 282, { dashed: true, label: "Shape は Shader で描かれる", labelX: 748, labelY: 330 })}
    ${arrow(364, 620, 275, 478)}
    ${arrow(846, 620, 275, 478)}
    ${arrow(535, 478, 670, 478)}
    ${arrow(920, 478, 940, 478)}

    ${svgText(640, 718, "第25章は、この 3 層のどこを読んでいるかを見失わないことが最も大切", { size: 22, fill: TEXT_SECONDARY })}
  `
  ),
  writeFigure(
    "fig28_01_single_vertex_skinning.svg",
    "第28章",
    "1 頂点スキニング図",
    `
    ${box(96, 334, 172, 90, "vertex p")}
    ${box(366, 238, 220, 90, "bone 0 matrix * p")}
    ${box(366, 430, 220, 90, "bone 1 matrix * p")}
    ${box(668, 238, 188, 90, "w0 * result")}
    ${box(668, 430, 188, 90, "w1 * result")}
    ${box(938, 334, 188, 90, "weighted sum")}
    ${box(1144, 334, 92, 90, "final\nposition", { fill: "#eef8f5", stroke: "#4a9c83", titleFill: TEXT_PRIMARY })}

    ${arrow(268, 365, 366, 283)}
    ${arrow(268, 393, 366, 475)}
    ${arrow(586, 283, 668, 283)}
    ${arrow(586, 475, 668, 475)}
    ${arrow(856, 283, 938, 365)}
    ${arrow(856, 475, 938, 393)}
    ${arrow(1126, 379, 1144, 379)}

    ${svgText(640, 612, "複数の bone で変換した結果を\nweight で混ぜて最終位置を得る", { size: 26, fill: TEXT_SECONDARY })}
  `
  )
];

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const figure of figures) {
    const outPath = path.join(OUT_DIR, figure.fileName);
    await fs.writeFile(outPath, figure.content, "utf8");
  }
  console.log(`Generated ${figures.length} SVG files in ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
