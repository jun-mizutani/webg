# HUDとオーバーレイの設計

3D アプリでは、シーンそのものを描くだけでは足りません。操作ガイド、状態表示、長文の説明、デバッグ情報、画面上のボタンのように、シーンの上へ重ねて見せたい情報は必ず出てきます。ところが、これらを同じ表示経路へ押し込むと、短い HUD は読みにくくなり、長文は落ち着いて読めず、ボタン類も扱いにくくなります。本章では、`webg` が HUD とオーバーレイをどのように役割分担しているかを整理し、`Text`、`Message`、`DebugDock`、`FixedFormatPanel`、`UIPanel` をどの場面で使い分けるべきかを見ていきます。

ここで重要なのは、`webg` の HUD 系部品が「1 つの万能 UI」を目指していないことです。canvas 上へ短く重ねる文字 HUD と、canvas 外の DOM を使って長文や操作 UI を出すオーバーレイは、最初から別の役割として設計されています。さらに `WebgApp` では、ビューポート全体を使う通常構成だけでなく、`layoutMode: "embedded"` で固定サイズ canvas を本文中へ埋め込む構成も扱えるため、同じ `UIPanel` や `FixedFormatPanel` でも「ビューポート固定で出すのか」「canvas host と一緒にスクロールさせるのか」で見え方が変わります。本章では、この表示経路の違いを「API 名の違い」ではなく「役割の違い」として読むことを目標にします。

最初に結論だけを言うと、短い ASCII HUD なら `Text` か `Message`、デスクトップで詳しい状態を見たいなら `DebugDock`、長文やエラー全文を読むなら `FixedFormatPanel`、日本語を含む説明文やボタンをシーンの上へ重ねるなら `UIPanel` が自然です。通常サンプルの操作説明は、まず `WebgApp.createHelpPanel()` が使えるかを考えると整理しやすくなります。

## HUDとオーバーレイの役割分担

`webg` の表示補助部品は、大きく 5 つに分けて考えると整理しやすくなります。`Text` は文字グリッドそのものを扱う最下層で、固定座標へ直接文字を書くための部品です。`Message` は `Text` の上に `id`、アンカー、ブロックを載せた高レベル HUD で、スコアやガイドのような短い表示を意味単位で更新したいときに向いています。`DebugDock` はデスクトップデバッグ時に右側へ固定表示される開発者向けドックで、コントロール、診断情報、レポートサマリーを 1 か所へ集約します。`FixedFormatPanel` は長文やエラー全文を `<pre>` 形式で読むパネルです。`UIPanel` は、シーンの上にボタン、カード、ヒント、日本語の説明文を重ねる DOM オーバーレイの基盤です。

この分担にしている理由は、表示内容の性格が大きく異なるためです。スコアや FPS は一瞬で読める位置が重要ですが、エラー全文は落ち着いて読めるパネルのほうが向いています。ボタンを押させる UI では、さらに別の配慮が必要です。canvas 上の文字 HUD は短い情報に絞り、DOM オーバーレイ側は長文や操作 UI を引き受けるように分けておくと、サンプルを読むときも新しいアプリを組むときも、「どこへ何を出すか」の判断を役割から行いやすくなります。

ここで先に意識しておきたいのは、`Text` と `Message` は ASCII 前提だという点です。`Text.js` は文字を `charCodeAt()` と `charOffset` でグリフインデックスへ変換して描画し、標準の外部フォントアトラスも `0x00..0x7F` を前提にしています。そのため、日本語や一般的な UTF-8 本文を扱うなら、最初から `UIPanel` や `FixedFormatPanel` のような DOM 側で扱うほうが自然です。短い ASCII HUD は canvas、非 ASCII を含む説明や操作 UI は DOM という分担が、現在の `webg` 実装にもっとも合っています。

## 短いHUDを出す: `Text` と `Message`

### `Text.js` の使い方

`Text` は、文字グリッドへ直接書く最下層のクラスです。`writeAt()` や `goTo()` でセル座標へ文字を書き、`drawScreen()` で描画します。アンカーや `id` を持たないため、固定座標で構成する端末風 HUD やローレベルの文字表示確認に向いています。

最小例は次のようになります。

```js
import Text from "./webg/Text.js";

const text = new Text(screen.getGL(), { cols: 80, rows: 25 });
await text.init("../../webg/font512.png");

text.writeAt(0, 0, "FPS: 60");
text.writeAt(0, 2, "PRESS ENTER");
text.drawScreen();
```

この構成では、何列何行のどこへ文字を書くかを利用者側がそのまま決めます。`Text` はグリッドサイズと文字スケールを分けて扱えるので、ローレベル確認や固定レイアウトの HUD を組みたいときに便利です。 

```js
text.setGridSize(100, 30);
text.setScale(1.5);

text.writeAt(0, 0, "100x30 grid");
text.writeAt(0, 1, "scale=1.5");
text.drawScreen();
```

ここで `setGridSize()` は文字バッファの列数と行数を変え、`setScale()` は見えている文字の大きさを変えます。`Text` は軽くてシーンとなじみやすい一方、長文や日本語の説明には向きません。標準のフォントアトラス前提では、次のように ASCII の範囲で使うのが安全です。

```js
text.writeAt(0, 0, "HP 120");
text.writeAt(0, 1, "SCORE 000123");
// text.writeAt(0, 2, "開始") は標準のフォントアトラス前提では扱わない
```

### `Message.js` の使い方

`Message` は `Text` の上に、`setLine()`、`setBlock()`、`replaceAll()` を載せた高レベル HUD です。`id` で同じ要素を更新し、アンカーで画面端や中央へ配置し、`width`、`wrap`、`align`、`gap` でブロックを整えます。スコア、ガイド、モード表示のような短い HUD を意味単位で管理したいときの中心になります。

短い 1 行表示なら `setLine()` が基本です。

```js
import Message from "./webg/Message.js";

const message = new Message(screen.getGL(), { cols: 80, rows: 25 });
await message.init("../../webg/font512.png");

message.setLine("score", "SCORE 1200", {
  anchor: "top-left",
  x: 0,
  y: 0,
  color: [1.0, 0.88, 0.72]
});

message.setLine("mode", "MODE DEBUG", {
  anchor: "top-right",
  x: -1,
  y: 0,
  color: [0.90, 0.96, 1.0]
});
```

`id` があるので、次のフレームで同じ `"score"` を更新すれば、同じ意味の HUD を保ったまま値だけ差し替えられます。行番号を手作業で管理しなくてよい点が、`Text` より扱いやすい理由です。 

複数行のガイドやステータスは `setBlock()` でまとめて配置すると整理しやすくなります。

```js
message.setBlock("guide", [
  "[WASD] move",
  "[R] reset camera",
  "[B] bloom"
], {
  anchor: "bottom-left",
  x: 0,
  y: -2,
  width: 28,
  wrap: true,
  gap: 1,
  align: "left",
  color: [0.88, 0.96, 0.90]
});
```

HUD 全体を一括で差し替えたいときは `replaceAll()` が使えます。

```js
message.replaceAll([
  {
    id: "status",
    lines: [
      `SCORE ${score}`,
      `LIVES ${lives}`,
      `TIME ${timeLeft}`
    ],
    anchor: "top-left",
    color: [1.0, 0.90, 0.72]
  },
  {
    id: "guide",
    lines: [
      "[Enter] START",
      "[ArrowLeft/Right] MOVE"
    ],
    anchor: "bottom-left",
    y: -1,
    color: [0.92, 0.96, 1.0]
  }
]);
```

通常のサンプルでは `Message` を直接触る代わりに、`WebgApp` のヘルパーを使うほうが簡潔です。短い操作説明や状態表示は `setGuideLines()`、`setStatusLines()`、必要なら `setHudRows()` にまとめると流れがそろいます。HUD や診断情報を後から無理に付け足すより、初期段階からアプリ構造に含めておくほうが扱いやすい、という `webg` 全体の方針にも合います。

```js
app.setGuideLines([
  "[WASD] move",
  "[R] reset",
  "[B] bloom"
], {
  anchor: "bottom-left",
  x: 0,
  y: -2,
  width: 36,
  wrap: true
});

app.setStatusLines([
  `mode=${mode}`,
  `threshold=${threshold.toFixed(2)}`,
  `strength=${strength.toFixed(2)}`
], {
  anchor: "top-right",
  x: -1,
  y: 0,
  width: 40
});
```

`Message` も `Text` と同じフォントアトラスを使うため、短い ASCII HUD 用として扱います。日本語の説明や複数段落の本文をそのまま入れたい場合は、次の `UIPanel` か `FixedFormatPanel` へ分けるほうが安全です。

## 読むためのパネル: `DebugDock` と `FixedFormatPanel`

### `DebugDock.js` の使い方

`DebugDock` は、デスクトップデバッグ時に右側へ固定表示するドックです。コントロール、診断情報、レポートサマリー、診断ボタン群を 1 か所へ集約し、`formatText()` や `copyDebugDockText()` でその内容をテキスト化できます。利用者向けの常設 HUD ではなく、開発者向けの調査パネルだと考えるのが自然です。

基本的な使い方は、ドックへ見せたい行をまとめ、必要な値を diagnostics 側へも入れる形です。

```js
app.setDebugDockRows([
  { label: "Threshold", decKey: "1", incKey: "2", value: bloom.threshold.toFixed(2) },
  { label: "Strength", decKey: "3", incKey: "4", value: bloom.bloomStrength.toFixed(2) },
  { label: "Tone Map", cycleKey: "G", value: toneMapLabel }
]);

app.mergeDiagnosticsStats({
  threshold: bloom.threshold,
  bloomStrength: bloom.bloomStrength,
  toneMap: toneMapLabel
});
```

現在見えているドック内容をそのまま共有したい場合は、`formatDebugDockText()` または `copyDebugDockText()` を使います。

```js
const dockText = app.formatDebugDockText();
console.log(dockText);

await app.copyDebugDockText();
```

ここで重要なのは、`DebugDock` がモバイルや狭い幅でも常に出るものではないことです。ビューポート幅とポインタ条件を満たしたときだけ有効になるため、利用者に必要な最小限の情報までドックにしか置かない構成は避けるべきです。ドックは「詳しい状態を増やす場所」であって、「唯一の表示経路」ではありません。 

### `FixedFormatPanel.js` の使い方

`FixedFormatPanel` は `<pre>` ベースの固定パネルです。短い HUD に入れたくない長文、エラーメッセージ、診断情報の全文、読み込み結果の一覧をそのまま表示するために使います。`WebgApp.showFixedFormatPanel()` と `showErrorPanel()` の土台でもあります。

長文パネルの最小例は次のようになります。

```js
app.showFixedFormatPanel([
  "Overview",
  `clipCount=${clipCount}`,
  `warningCount=${warningCount}`,
  `triangleCount=${triangleCount}`
].join("\n"), {
  id: "scene-overview"
});
```

起動失敗やローダーエラーは `showErrorPanel()` にまとめると、デバッグドックや diagnostics と連携しながら同じ形式で扱えます。

```js
try {
  await loadScene();
} catch (error) {
  app.showErrorPanel(error, {
    id: "scene-load-error",
    title: "scene load failed",
    stage: "load-scene"
  });
}
```

`FixedFormatPanel` は DOM の `<pre>` を使うため、ASCII に制限されません。日本語や長文の補足を出したいときは、短い HUD に無理に詰め込まず、このパネル側で扱うほうが自然です。

```js
app.showFixedFormatPanel([
  "読み込みに失敗しました",
  "missing node: hero_root",
  "scene.json を確認してください"
].join("\n"), {
  id: "load-help"
});
```

`WebgApp` を `layoutMode: "embedded"` で使う場合は、このパネルも canvas host を基準に配置されます。教材ページの本文中に canvas を置いているときは、fixed panel だけがビューポートへ貼りつくのではなく、canvas と一緒に移動するほうが自然です。通常の fixed 構成と embedded 構成で挙動が変わる点も、読むパネルとしての役割を理解しておくと整理しやすくなります。 

## 操作用のオーバーレイ: `UIPanel.js`

`UIPanel` は canvas 外の DOM を使ってシーンの上にパネルを重ねる共通基盤です。`createLayout()` で左右カラムを作り、`createPanel()`、`createButtonRow()`、`createButtonGrid()`、`createTextBlock()`、`createHint()`、`createPill()` で部品を組み立てます。ボタンを押させる UI、日本語を含む説明文、ステータスカードを表示する標準経路です。会話専用の `DialogueOverlay` と違い、操作パネルやツールパレットを作るための基盤として使うのが中心になります。

### レイアウトとパネル

まずレイアウトを作り、その中へパネルを配置します。

```js
import UIPanel from "./webg/UIPanel.js";

const uiPanels = new UIPanel({
  document,
  theme: app.uiTheme.uiPanel
});

const layout = uiPanels.createLayout({
  id: "scene-tools",
  leftWidth: "minmax(320px, 460px)",
  rightWidth: "minmax(260px, 340px)",
  scrollColumns: true
});

const mainPanel = uiPanels.createPanel(layout.left, { stack: true });
uiPanels.createEyebrow(mainPanel, "Scene Actions");
uiPanels.createTitle(mainPanel, "Runtime Controls", 1);
uiPanels.createHint(mainPanel, "scene action と同じ処理を overlay button から呼び出す例");
```

この段階で、シーンの左上に説明付きパネルを置く土台ができます。`UIPanel` は CSS クラスを内部で適用するため、サンプルごとの重複を減らしやすくなります。 `webg/samples/scene` は、左のアクションボタンと右のステータスパネルを持つ代表例として最初の参照先に向いています。テーマ適用まで含めて確認したいなら `webg/unittest/theme` が分かりやすくなります。

### 通常サンプルのヘルプは `createHelpPanel()` を優先する

サンプルごとに `UIPanel` を手作業で組み立てる前に、まず `WebgApp.createHelpPanel()` が使えるかを考えるほうが自然です。これは教材寄りのサンプル向けに、左上の折りたたみ可能なヘルプパネルをそのまま出すヘルパーです。1 行 1 操作の配列を渡すだけで、`Hide Help` / `Show Help` ボタンを持つパネルが作られます。デバッグドックの右余白も自動で反映するため、サンプル側でパネルのオフセットを追いかけ直す必要がありません。通常サンプルではこれを最初の標準にすると、開発者にも利用者にも意図が伝わりやすくなります。

```js
const helpLines = [
  "Drag or Arrow keys: orbit camera",
  "[ / ] or wheel: zoom",
  "[1]/[2] threshold -/+",
  "[3]/[4] strength -/+",
  "[space] pause"
];

app.createHelpPanel({
  id: "sampleHelpOverlay",
  lines: helpLines
});
```

`janken` や `circular_breaker` のようにゲーム HUD 自体が演出の一部になっているサンプル、あるいは `tile_sim` のように説明量が多く独自レイアウトを持つサンプルは例外です。しかしそれ以外では、「操作説明は畳める help panel、現在値は HUD、調査用の詳細は diagnostics」という分担がもっとも整理しやすくなります。また `layoutMode: "embedded"` を併用すると、ヘルプパネルは canvas host 基準で本文と一緒にスクロールします。教材ページではこの挙動が自然で、閉じたあとの `Show Help` ボタンも canvas の近くに残るため、「本文を読んでから実行例へ戻る」という流れを作りやすくなります。

### ボタン行とテキストブロック

ボタンと説明文を加えると、操作 UI と長文の分担が分かりやすくなります。

```js
const buttonRow = uiPanels.createButtonRow(mainPanel);
const pauseButton = uiPanels.createButton(buttonRow, { text: "Pause Scene" });
const resetButton = uiPanels.createButton(buttonRow, { text: "Reset Camera" });

pauseButton.addEventListener("click", () => togglePause());
resetButton.addEventListener("click", () => resetCamera());

uiPanels.createTextBlock(mainPanel, {
  text: [
    "このパネルは DOM オーバーレイなので、日本語の説明をそのまま表示できる",
    "短い ASCII HUD を `Message` へ置き、詳しい説明はここへ置くと分担しやすい"
  ].join("\n")
});
```

`createTextBlock()` は `textContent` を使うので、長文のヘルプや日本語の説明文をそのまま扱えます。ここが `Message` との大きな違いです。短い HUD は `Message` に寄せ、詳しい説明は `UIPanel` に置くと、表示経路の役割がかなりはっきりします。

### グリッド、ピル、ステータス

複数ボタンやステータスカードを並べたい場合は、グリッドやピルを組み合わせます。

```js
const sidePanel = uiPanels.createPanel(layout.right, { stack: true });
uiPanels.createPill(sidePanel, { text: "DEBUG ACTIVE" });

const grid = uiPanels.createButtonGrid(sidePanel, { columns: 2 });
const exportButton = uiPanels.createButton(grid, { text: "Export Report" });
const copyButton = uiPanels.createButton(grid, { text: "Copy Dock" });

exportButton.addEventListener("click", () => saveReport());
copyButton.addEventListener("click", () => app.copyDebugDockText());

uiPanels.createStatusBlock(layout, {
  id: "scene-status",
  text: "選択中：hero_root\n状態：ready"
});
```

`createStatusBlock()` は画面下部寄りの固定ステータスを作り、ボタン群とは別に状態を見せたいときに役立ちます。日本語の状態文をそのまま出せる点でも、ASCII 制限のある HUD と分ける価値があります。テーマをそろえたい場合は `WebgUiTheme` の `uiPanel` プリセットを使い、`WebgApp` と一緒に更新します。これにより、`DebugDock`、`FixedFormatPanel`、`UIPanel` の見た目を同じ方向へそろえられます。

```js
import { DEFAULT_UI_LIGHT_THEME } from "./webg/WebgUiTheme.js";

app.setUiTheme(DEFAULT_UI_LIGHT_THEME);
uiPanels.setTheme(app.uiTheme.uiPanel);
```

## どの部品を選ぶべきか

最後に、実装を始める際の選び方を簡潔にまとめます。端末風の固定座標表示やローレベル確認なら `Text`、スコア、ガイド、タイマー、コントロール行のような短い ASCII HUD なら `Message` または `WebgApp.setGuideLines()` / `setStatusLines()` / `setHudRows()`、デスクトップで診断情報とコントロールを詳しく見たいなら `DebugDock`、エラー全文や長文レポートを読むなら `FixedFormatPanel`、日本語を含む説明文、ボタン、選択、ステータスカードをシーンの上へ重ねるなら `UIPanel` が自然です。迷ったときは、「短い ASCII か」「長文か」「操作を含むか」「デスクトップデバッグ限定か」を先に決めると、この章の部品を選びやすくなります。

要するに、この章で最も大事なのは「表示部品を増やすこと」ではなく、「役割に応じて表示経路を分けること」です。短い HUD と長文、利用者向け UI と開発者向けパネル、日本語を含む説明と ASCII 前提の HUD を最初から分けておくと、サンプルも本番アプリもかなり読みやすくなります。これは [14_UI表示の設計.md](./14_UI表示の設計.md) の分担とも一致しており、次章の入力代替 UI である `Touch` を読む前提としても重要です。
