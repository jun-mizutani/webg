// ---------------------------------------------
// headless_tests/core/overlay_panel/api_contracts.js 2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import assert from "node:assert/strict";
import OverlayPanel from "../../../webg/OverlayPanel.js";

// 本文の入力形式をDOMの配置処理から分け、作成と更新の正規化規約を直接確認する
const normalize = (options, previous = null) => {
  return OverlayPanel.prototype.normalizeOptions.call({}, options, previous);
};

// 作成時と更新時の両方で、明示的な本文はtextかlinesの一方に揃える
for (const previous of [null, normalize({ id: "check", text: "previous" })]) {
  assert.throws(
    () => normalize({ id: "check", text: "x", lines: ["y"] }, previous),
    /both text and lines/,
  );
  assert.throws(
    () => normalize({ id: "check", text: "", lines: [] }, previous),
    /both text and lines/,
  );
}

// 形式の切替は明示した本文だけを採用し、本文以外の更新では現在の文字列を引き継ぐ
const initial = normalize({ id: "check", text: "previous" });
const lines = normalize({ lines: ["first", "second"] }, initial);
assert.equal(lines.text, "first\nsecond");
assert.equal(lines.id, "check");
assert.equal(normalize({ text: "next" }, lines).text, "next");
assert.equal(normalize({ title: "updated" }, lines).text, "first\nsecond");

// 空の本文とundefinedによる省略を区別し、消去と維持の使い分けを確認する
assert.equal(normalize({ text: "" }, initial).text, "");
assert.equal(normalize({ lines: [] }, initial).text, "");
assert.equal(normalize({ text: undefined, lines: ["only lines"] }, initial).text, "only lines");
assert.equal(normalize({ text: "only text", lines: undefined }, initial).text, "only text");
assert.equal(normalize({}, initial).text, "previous");

// 実際のupdateとapplyOptionsの経路でも、本文形式を切り替えられることを確認する
// DOM配置の3処理をスタブにし、入力の正規化と更新後の状態はコアの実装を使う
const panel = {
  options: initial,
  normalizeOptions: OverlayPanel.prototype.normalizeOptions,
  applyOptions: OverlayPanel.prototype.applyOptions,
  // この検査は状態更新を担当し、DOM生成はブラウザページの検査へ分担する
  ensureDom() {},
  // この検査は状態更新を担当し、DOM配置はブラウザページの検査へ分担する
  mount() {},
  // この検査は状態更新を担当し、DOM描画はブラウザページの検査へ分担する
  render() {},
};
assert.equal(OverlayPanel.prototype.update.call(panel, { lines: ["updated lines"] }), panel);
assert.equal(panel.options.text, "updated lines");
OverlayPanel.prototype.update.call(panel, { title: "new title" });
assert.equal(panel.options.text, "updated lines");
OverlayPanel.prototype.update.call(panel, { text: "updated text" });
assert.equal(panel.options.text, "updated text");
assert.throws(
  () => OverlayPanel.prototype.update.call(panel, { text: "x", lines: ["y"] }),
  /both text and lines/,
);
assert.equal(panel.options.text, "updated text");
console.log("PASS overlay_panel_api_contracts");
