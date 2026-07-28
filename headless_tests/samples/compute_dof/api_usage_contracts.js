// ---------------------------------------------------------
// headless_tests/samples/compute_dof/api_usage_contracts.js  2026/07/27
//   Public sample contracts for the 1/16 image-pyramid DoF
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relativePath) => readFileSync(
  new URL(relativePath, import.meta.url),
  "utf8"
);

const main = read("../../../samples/compute_dof/main.js");
const html = read("../../../samples/compute_dof/compute_dof.html");
const readmeJa = read("../../../samples/compute_dof/README.md");
const readmeEn = read("../../../samples/compute_dof/README.en.md");
const opacityMain = read("../../../samples/opacity/main.js");
const opacityHtml = read("../../../samples/opacity/opacity.html");

// 実行入口から新しいPipeline世代を読み、debug viewが1/16 targetを明示的に選びます
assert.match(html, /main\.js\?v=20260723_dof_coverage/);
assert.match(main, /ComputeEffectPipeline\.js\?v=20260723_dof_coverage/);
assert.match(main, /\{ value: "sixteenth", label: "sixteenth \(1\/16\)" \}/);
assert.match(main, /pipeline\.dofPass\.getSixteenthTarget\(\)/);
assert.match(main, /"half", "quarter", "eighth", "sixteenth"/);
assert.match(main, /id: "blur-radius", label: "Blur Radius"/);
assert.match(main, /id: "coc-scale", label: "CoC Scale"/);
assert.match(main, /blurRadius: p\.blurRadius/);
assert.match(main, /cocScale: p\.cocScale/);
assert.match(main, /pipeline\.dofPass\.getFarFieldTarget\(\)/);
assert.match(main, /pipeline\.dofPass\.getNearFieldTarget\(\)/);
assert.match(main, /pipeline\.dofPass\.getCocFieldTarget\(\)/);

// opacityでDoFを有効にしたときも現行APIの検証範囲内でencodeできる設定を維持します
// 実行HTMLのcache識別子も同時に検査し、修正前main.jsの再利用を防ぎます
assert.match(opacityHtml, /main\.js\?v=20260727_dof_options/);
assert.match(
  opacityMain,
  /dof:\s*\{\s*focusDistance:\s*18,\s*focusRange:\s*7,\s*cocScale:\s*0\.88,\s*blurRadius:\s*3\.0\s*\}/
);
assert.doesNotMatch(opacityMain, /\bmaxBlurMix\s*:/);

// 日英説明はcoverage/CoC分離、scene blur置換、負荷を実装と同じ式で説明します
assert.match(readmeJa, /abs\(viewDepth - focusDistance\) \/ focusRange \* cocScale/);
assert.match(readmeJa, /Alphaは純粋なgeometry coverage/);
assert.match(readmeJa, /moment \/ coverage/);
assert.match(readmeJa, /scene全体の低周波画像が鮮明なscene colorを完全に置き換え/);
assert.match(readmeJa, /42\.625 bytes/);
assert.match(readmeEn, /abs\(viewDepth - focusDistance\) \/ focusRange \* cocScale/);
assert.match(readmeEn, /Alpha is pure geometric coverage/);
assert.match(readmeEn, /moment \/ coverage/);
assert.match(readmeEn, /low-frequency image selected by CoC fully replaces sharp scene color/);
assert.match(readmeEn, /42\.625 bytes/);

console.log("PASS sample_compute_dof_api_usage_contracts");
