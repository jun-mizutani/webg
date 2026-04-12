# 15 HUDとオーバーレイ

最終更新：2026-04-09 JST

## 15.1 HUD 詳細

この章では、`Text`、`Message`、`DebugDock`、`FixedFormatPanel`、`UIPanel`、`WebgApp` を使って、画面上の情報をどのように見せ分けるかを考えます。文字表示と情報表示全体の役割分担を先に見たい場合は [14_UI表示の設計.md](./14_UI表示の設計.md) を、テーマの共通化まで含めて確認したい場合は、`webg/unittest/theme` をあわせて読むと、ここで説明する部品の位置づけがつかみやすくなります。

背景として、`webg` の HUD は 1 つの表示部品に情報を詰め込む設計ではありません。シーン上に短く重ねる canvas HUD、デスクトップで詳細を読むデバッグドック、長文やエラーを落ち着いて読む固定パネル、ボタンやカードをシーン上に重ねる UI パネルでは、それぞれ求められる役割が異なります。短い状態表示と長文の説明を同じ場所へ押し込むと、「どこへ何を出すか」が分かりにくくなるため、役割ごとに表示経路を分けています。

加えて、`WebgApp` ではビューポート全体を使う通常構成だけでなく、`layoutMode: "embedded"` で固定サイズ canvas を本文中へ埋め込む構成も扱えるようになりました。同じ `UIPanel`、`FixedFormatPanel`、`Touch` 系でも、「ビューポート固定で出すのか」「canvas host と一緒にスクロールさせるのか」で見え方が変わるため、この章でもその違いを意識して読みます。

## 15.2 この章で押さえること

### 15.2.1 まず「短い HUD なのか、読むパネルなのか、操作 UI なのか」を決める

canvas 上に短く出すだけなら `Text` または `Message`、デスクトップのデバッグで詳細を増やすなら `DebugDock`、長文やエラー全文を見せるなら `FixedFormatPanel`、ボタンやカードをシーン上に重ねるなら `UIPanel` が自然です。`webg` ではこの分担を先に決めてから API を選ぶほうが、迷いが少なくなります。

### 15.2.2 `Text` は最下層、`Message` は意味単位で扱う HUD

`Text` は「何列何行のどこへ文字を置くか」を直接扱うローレベルクラスです。`Message` はその上に `id`、アンカー、ブロックを加え、短い HUD を意味単位で更新できるクラスです。短いスコアやガイドを出したいときは、まず `Message` か `WebgApp` のヘルパーから始めるほうが整理しやすくなります。

### 15.2.3 `Text` と `Message` は ASCII 前提で考える

`Text.js` は文字を `charCodeAt()` と `charOffset` でグリフインデックスへ変換して描画しており、既定の外部フォントアトラスも `0x00..0x7F` の並びを前提にしています。そのため、`Text` と `Message` は短い ASCII HUD 用として扱うのが安全です。日本語や一般的な UTF-8 文章、長い会話文をそのまま出したい場合は、`UIPanel` など DOM 側の UI を使うべきです。

### 15.2.4 `DebugDock` と `FixedFormatPanel` は常時見せる HUD の置き場ではない

`DebugDock` はデスクトップデバッグ用の情報集約パネル、`FixedFormatPanel` は長文やエラーの読み物パネルです。どちらも「常時見せるゲーム内 HUD」を置く場所ではありません。毎フレーム更新する短いステータスをここへ寄せるより、canvas HUD と役割を分けるほうが表示フローを保ちやすくなります。

### 15.2.5 `UIPanel` は UTF-8 の説明文と操作 UI を扱いやすい

`UIPanel` は DOM オーバーレイを使うため、日本語を含む本文、ボタン、ピル、ヒント、ステータスブロックをそのまま扱えます。`Message` が苦手な長文、非 ASCII 文字、複数ボタンを持つ操作パネルは、最初から `UIPanel` へ寄せるほうが自然です。とくに通常サンプルの操作説明は、`bloom` と同じ `WebgApp.createHelpPanel()` を標準として選ぶとそろえやすくなります。

## 15.3 この章の流れ

`webg` の HUD は、次の 5 つに分けて考えると整理しやすくなります。

1. `Text`
   文字グリッドへ直接書く最下層のクラスです。ローレベル確認や端末風 UI に向きます。
2. `Message`
   `id` とアンカーを持つ短い ASCII HUD です。ガイド、スコア、短いステータスの標準です。
3. `DebugDock`
   デスクトップデバッグでコントロール、診断情報、レポートサマリーを右側へ固定表示するパネルです。
4. `FixedFormatPanel`
   エラー全文や長文の診断情報を `<pre>` 形式で読むパネルです。
5. `UIPanel`
   シーンの上にボタン、カード、ヒント、UTF-8 の説明文を重ねる DOM オーバーレイ基盤です。

この 5 分割を先に決めておくと、「ASCII の短い HUD は `Message`」「日本語を含む本文や操作パネルは `UIPanel`」「デバッグ用の詳しい状態は `DebugDock`」「長文の失敗理由は `FixedFormatPanel`」という選び分けがしやすくなります。

## 15.4 背景

3D アプリの表示では、シーン自体の描画だけでなく、「今の操作方法」「現在値」「調査用の内部状態」「失敗理由」「画面上のボタン」をどう見せるかも重要です。ところが、これらを同じ形式で出すと読みにくくなります。たとえばスコアや FPS は一瞬で読める位置が大事ですが、エラー全文は落ち着いて読めるパネルのほうが向いています。ボタンを押させる UI では、さらに別の配慮が必要です。

`webg` の HUD 系部品は、この違いをそのまま分離した設計になっています。canvas 上の文字 HUD は短い情報に絞り、DOM オーバーレイ側は長文や操作 UI を引き受けます。これにより、サンプルを読むときも読者が新しいアプリを組むときも、「どこへ何を出すか」の判断を API 名ではなく役割から行えるようになっています。

## 15.5 役割

ここでは、この章で扱う主要部品の役割を先に整理します。

### 15.5.1 `Text.js`

`Text` は文字グリッドそのものを扱う最下層です。`writeAt()` や `goTo()` でセル座標へ直接文字を書き、`drawScreen()` で描画します。`setGridSize()` と `setScale()` を持つので、端末風 HUD やローレベルテストの土台になります。

### 15.5.2 `Message.js`

`Message` は `Text` の上に、`setLine()`、`setBlock()`、`replaceAll()` を載せた高レベル HUD です。`id` で同じ要素を更新し、アンカーで画面端や中央へ配置し、`width`、`wrap`、`align`、`gap` でブロックを整えます。スコア、ガイド、モード表示のような短い HUD を意味単位で管理したいときの中心です。

### 15.5.3 `DebugDock.js`

`DebugDock` は、デスクトップデバッグ時に右側へ固定表示するドックです。コントロール、診断情報、レポートサマリー、診断ボタン群を 1 か所へ集約し、`formatText()` や `copyDebugDockText()` でその内容をテキスト化できます。利用者向けの常設 HUD ではなく、開発者向けの調査パネルです。

### 15.5.4 `FixedFormatPanel.js`

`FixedFormatPanel` は `<pre>` ベースの固定パネルです。短い HUD に入れたくない長文、エラーメッセージ、診断情報の全文、読み込み結果の一覧をそのまま表示するために使います。`WebgApp.showFixedFormatPanel()` と `showErrorPanel()` の土台でもあります。

### 15.5.5 `UIPanel.js`

`UIPanel` は canvas 外の DOM を使ってシーンの上にパネルを重ねる共通基盤です。`createLayout()` で左右カラムを作り、`createPanel()`、`createButtonRow()`、`createButtonGrid()`、`createTextBlock()`、`createHint()`、`createPill()` で部品を組み立てます。ボタンを押させる UI、日本語を含む説明文、ステータスカードを表示する標準経路です。

## 15.6 理由

このように部品を分けている理由は、表示内容の性格が大きく異なるためです。

まず、短い HUD と長文は同じ場所に置かないほうが読みやすくなります。スコアや閾値は毎フレーム更新されてもよいですが、エラー全文はスクロール可能な領域で読みたいことが多くなります。

次に、canvas 上の文字描画はフォントアトラス由来の制約を受けます。`Text` と `Message` は軽くてシーンとなじみやすい反面、ASCII を超える一般的な文字表示には向いていません。日本語の説明や多言語 UI を扱うなら、DOM オーバーレイ側へ分ける必要があります。

さらに、デバッグ用の情報と利用者向け UI は同じ密度にしないほうが運用しやすくなります。利用者には短いガイドだけを見せ、デスクトップデバッグではドックや診断情報を増やすほうが、サンプルも本番アプリも整理しやすくなります。

## 15.7 使いどころ

それぞれの部品は、次のような場面で使うと自然です。

### 15.7.1 `Text`

ローレベルの文字描画確認、ASCII フォントアトラスの確認、端末風の固定座標 UI に向きます。`webg/unittest/textdemo` と `webg/unittest/message` は、この層の挙動を追う入り口です。

### 15.7.2 `Message`

短いガイド、スコア、モード、タイマー、行形式のコントロールサマリーに向きます。`webg/samples/breakout`、`webg/samples/janken`、`webg/samples/bloom`、`webg/samples/dof` は、この層の使い分けが分かりやすいサンプルです。

### 15.7.3 `DebugDock`

デスクトップで診断情報を見ながらパラメータを調整したいサンプルに向きます。`webg/samples/bloom`、`webg/samples/dof`、`webg/samples/scene`、`webg/unittest/theme` は、デバッグドックの使いどころを追いやすい代表例です。

### 15.7.4 `FixedFormatPanel`

ローダーエラー、バリデーション失敗、長いレポート、調査メモを一時表示したい場面に向きます。`showErrorPanel()` と組み合わせると、失敗理由を短い HUD へ押し込まずに済みます。

### 15.7.5 `UIPanel`

シーンアクションボタン、テーマプレビュー、状態カード、日本語を含むヘルプパネル、複数選択を持つオーバーレイに向きます。`webg/samples/scene` と `webg/unittest/theme` が、最初の参照先として分かりやすくなります。

## 15.8 注意点

これらの部品を使う際に、あらかじめ意識しておきたい注意点は次のとおりです。

1. `Text` と `Message` は ASCII 前提です。日本語や一般的な UTF-8 本文は `UIPanel` など DOM 側で扱うべきです。
2. `Message` は短い HUD に向いています。長文や読み物を無理に詰め込む場所ではありません。
3. `DebugDock` はデスクトップデバッグ専用です。ビューポート幅やポインタ条件によっては表示されません。
4. `FixedFormatPanel` は毎フレーム更新には向きません。読むためのパネルとして使うほうが自然です。
5. `UIPanel` は DOM オーバーレイなので、日本語や長文は扱いやすい一方で、canvas HUD と同じ見え方にはなりません。シーンと一体化した短い表示は `Message` のほうが向いています。

## 15.9 `Text.js` の使い方

### 15.9.1 最小構成

`Text` は「どのセルへ何を書くか」を自分で決めるクラスです。最小例は次のようになります。

```js
import Text from "./webg/Text.js";

const text = new Text(screen.getGL(), { cols: 80, rows: 25 });
await text.init("../../webg/font512.png");

text.writeAt(0, 0, "FPS: 60");
text.writeAt(0, 2, "PRESS ENTER");
text.drawScreen();
```

この例では、`0,0` と `0,2` に直接文字列を書いています。`Text` はアンカーや `id` を持たないので、固定座標で構成する端末風表示やローレベル確認に向いています。

### 15.9.2 グリッドとスケール

`Text` はグリッドサイズと文字スケールを分けて扱えます。

```js
text.setGridSize(100, 30);
text.setScale(1.5);

text.writeAt(0, 0, "100x30 grid");
text.writeAt(0, 1, "scale=1.5");
text.drawScreen();
```

`setGridSize()` は文字バッファの列数と行数を変え、`setScale()` は見えている文字の大きさを変えます。スケールを上げると `Message` のアンカー計算にも影響するため、`Text` を土台にして `Message` を使うアプリでは、現在の見かけ上のグリッド範囲が変わる前提で考える必要があります。

### 15.9.3 文字制限

`Text` は `writeAt()` で受け取った文字列を `charCodeAt()` からグリフインデックスへ変換して描画します。既定フォントアトラスも `0x00..0x7F` を前提にしているため、ASCII 以外をそのまま出す用途には向きません。

```js
text.writeAt(0, 0, "HP 120");
text.writeAt(0, 1, "SCORE 000123");
// text.writeAt(0, 2, "開始") は標準のフォントアトラス前提では扱わない
```

この制限は「たまたま見えることがあるか」ではなく、「標準の使い方として期待しない」という前提で読むのが安全です。非 ASCII を含む本文を出したい時点で `UIPanel` へ切り替えるほうが、サンプルと文書の方針にも合います。

## 15.10 `Message.js` の使い方

### 15.10.1 1 行 HUD

`Message` は `Text` の上に `id` とアンカーを持たせた HUD です。短い 1 行表示なら `setLine()` が中心になります。

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

`id` があるので、次フレームで同じ `"score"` を更新すれば、同じ意味の HUD を保ったまま値だけ差し替えられます。行番号を手作業で管理しなくてよい点が、`Text` より扱いやすい理由です。

### 15.10.2 ブロック HUD

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

`width`、`wrap`、`clip`、`align`、`gap` は、ブロックの読みやすさを整えるためにあります。ガイドやステータスは 1 行ずつばらばらに置くより、ブロック単位で扱うほうが表示フローを追いやすくなります。

### 15.10.3 HUD 全体の差し替え

HUD 全体を毎回組み直すなら `replaceAll()` が使えます。

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

この形にしておくと、「このフレームの HUD が何で構成されるか」が配列からそのまま読めるようになります。開発者が HUD を追加する際も、意図を読み取りやすくなります。

### 15.10.4 `WebgApp` ヘルパーを使う場合

サンプルでは `Message` を直接触る代わりに、`WebgApp` のヘルパーを使うほうが簡潔です。

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

`WebgApp` は内部で `Message` ブロックを使うため、サンプル側は座標の細部よりも「何を見せるか」に集中できます。

### 15.10.5 文字制限

`Message` も `Text` と同じフォントアトラスを使うので、短い ASCII HUD 用として扱います。

```js
message.setLine("title", "START", { anchor: "center", y: -2 });
message.setBlock("stats", [
  "HP 120",
  "AMMO 008",
  "MODE SAFE"
], { anchor: "top-left" });
```

`"開始"` や `"弾数"` のような非 ASCII 文字列を `Message` の標準経路として扱うのは避けるべきです。日本語の説明や複数段落の本文を出したい場合は、次の `UIPanel` を使います。

## 15.11 `DebugDock.js` の使い方

### 15.11.1 基本

`DebugDock` はデスクトップデバッグ用の固定ドックです。行を渡し、コントロール、診断情報、レポートを 1 か所へ集めます。

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

このときドックには、コントロールの要約、診断情報のテキスト、レポートサマリーが並びます。利用者向け HUD に出しきれない詳細を、デスクトップだけで増やせる点が利点です。

### 15.11.2 ドック全文をテキスト化する

現在見えているドック内容をそのまま共有したい場合は、`formatDebugDockText()` または `copyDebugDockText()` を使います。

```js
const dockText = app.formatDebugDockText();
console.log(dockText);

await app.copyDebugDockText();
```

これは診断情報 JSON とは別に、「ドックで今見えている内容そのもの」をテキスト化するための経路です。開発者へ調査結果を渡すときにも使いやすくなります。

### 15.11.3 表示条件

`DebugDock` はデスクトップ前提です。ビューポート幅とファインポインタ条件を満たしたときだけ有効になります。

```js
if (app.isDebugDockActive()) {
  console.log("desktop debug dock is visible");
}
```

したがって、ドックにしか置いていない情報はモバイルでは見えません。利用者に必要な最小限の情報は、canvas HUD か別のオーバーレイに残しておく必要があります。

## 15.12 `FixedFormatPanel.js` の使い方

### 15.12.1 長文パネル

`FixedFormatPanel` は、読むためのテキストを `<pre>` 形式で表示します。通常は画面端へ固定表示され、`WebgApp.showFixedFormatPanel()` から使うのが分かりやすい入口です。

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

このパネルは HUD の代わりではなく、長いレポートを読む場所です。短いステータスを毎フレーム書き換える用途よりも、一定時間そのまま読む用途に向いています。

`WebgApp` を `layoutMode: "embedded"` で使う場合は、このパネルも canvas host を基準に配置されます。教材ページの本文中に canvas を置いているときは、fixed panel だけがビューポートへ貼り付くのではなく、canvas と一緒に移動するほうが自然です。確認用には `webg/unittest/embedded` がそのまま使えます。

### 15.12.2 エラーパネル

起動失敗やローダーエラーは `showErrorPanel()` にまとめると、デバッグドックと連携しながら同じ形式で扱えます。

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

この経路では診断情報側の最新エラーも更新されるため、「失敗をパネルへ出す」と「デバッグ情報へ残す」が分断されません。

### 15.12.3 文字制限

`FixedFormatPanel` は DOM の `<pre>` を使うので、ASCII に制限されません。

```js
app.showFixedFormatPanel([
  "読み込みに失敗しました",
  "missing node: hero_root",
  "scene.json を確認してください"
].join("\n"), {
  id: "load-help"
});
```

日本語や長文の補足を出したいときは、このように DOM パネル側へ寄せるほうが自然です。

## 15.13 `UIPanel.js` の使い方

### 15.13.1 レイアウトとパネル

`UIPanel` は、シーンの上に重ねる DOM オーバーレイを組み立てる基盤です。まずレイアウトを作り、その中へパネルを配置します。

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

この段階で、シーンの左上に説明付きパネルを置く土台ができます。`UIPanel` は CSS をクラス化して内部で適用するので、サンプルごとの重複を減らしやすくなります。

### 15.13.2 通常サンプルのヘルプパネルは `WebgApp.createHelpPanel()` を優先する

サンプルごとに `UIPanel` を手作業で組み立てる前に、まず `WebgApp.createHelpPanel()` が使えるかを考えるほうが自然です。これは `bloom` のような教材寄りサンプル向けに、左上の折りたたみ可能なヘルプパネルをそのまま出すヘルパーです。1 行 1 操作の配列を渡すだけで、`Hide Help` / `Show Help` ボタンを持つパネルが作られます。

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

このヘルパーはデバッグドックの右余白も自動で反映するため、サンプル側でパネルのオフセットを追いかけ直す必要がありません。`janken` や `circular_breaker` のようなアーケードゲーム系 HUD、`tile_sim` のような説明量が多い独自 UI は例外ですが、それ以外の通常サンプルではこのヘルパーを最初の標準にすると、開発者にも利用者にも意図が伝わりやすくなります。

また `layoutMode: "embedded"` を併用すると、ヘルプパネルは canvas host 基準で本文と一緒にスクロールします。教材ページではこの挙動が自然で、閉じたあとの `Show Help` ボタンも canvas の近くに残るため、「本文を読んでから実行例へ戻る」という流れを作りやすくなります。

### 15.13.3 ボタン行とテキストブロック

次にボタンと説明文を加えます。

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

`createTextBlock()` は `textContent` を使うので、長文のヘルプや日本語の説明文をそのまま扱えます。ここが `Message` との大きな違いです。

### 15.13.4 グリッド、ピル、ステータス

複数ボタンやステータスカードを並べたい場合は、グリッドやピルを組み合わせます。

```js
const sidePanel = uiPanels.createPanel(layout.right, { stack: true });
uiPanels.createPill(sidePanel, { text: "DEBUG ACTIVE" });

const grid = uiPanels.createButtonGrid(sidePanel, { columns: 2 });
const exportButton = uiPanels.createButton(grid, { text: "Export Report" });
const copyButton = uiPanels.createButton(grid, { text: "Copy Dock" });

exportButton.addEventListener("click", () => saveReport());
copyButton.addEventListener("click", () => app.copyDebugDockText());

uiPanels.createTextBlock(sidePanel, {
  text: `selected=${selectedName}\ntriangles=${triangleCount}`,
  code: true
});

uiPanels.createStatusBlock(layout, {
  id: "scene-status",
  text: "選択中：hero_root\n状態：ready"
});
```

`createStatusBlock()` は画面下部寄りの固定ステータスを作り、ボタン群とは別にステータスを見せたいときに役立ちます。日本語の状態文をそのまま出せる点でも、ASCII 制限のある HUD と分ける価値があります。

### 15.13.5 テーマをそろえる

`UIPanel` は `WebgUiTheme` の `uiPanel` プリセットを使えます。`DebugDock` と `FixedFormatPanel` と同じテーマへ寄せるなら、`WebgApp` と一緒に更新します。

```js
import { DEFAULT_UI_LIGHT_THEME } from "./webg/WebgUiTheme.js";

app.setUiTheme(DEFAULT_UI_LIGHT_THEME);
uiPanels.setTheme(app.uiTheme.uiPanel);
```

これにより、ドック、固定パネル、オーバーレイパネルの見た目を同じ方向へそろえられます。`webg/unittest/theme` は、この確認用として読むと整理しやすくなります。

## 15.14 制限のまとめ

文字制限は、部品ごとに次のように整理しておくと分かりやすくなります。

1. `Text`
   標準のフォントアトラス前提では ASCII HUD 用です。
2. `Message`
   `Text` と同じ制限を受けるため、短い ASCII HUD 用です。
3. `DebugDock`
   DOM のテキスト表示なので、ASCII 制限はありません。
4. `FixedFormatPanel`
   DOM の `<pre>` なので、日本語や長文をそのまま扱えます。
5. `UIPanel`
   DOM オーバーレイなので、日本語や一般的な UTF-8 本文、ボタンラベル、説明文を扱えます。

この整理を先に持っておくと、`Message` に日本語ヘルプを入れようとして詰まることを避けやすくなります。短い ASCII HUD は canvas、非 ASCII を含む説明や操作 UI は DOM オーバーレイという分担が、現在の `webg` 実装に最も合っています。

## 15.15 どう選ぶか

最後に、実装を始める際の選び方を簡潔にまとめます。

1. 端末風の固定座標表示やローレベル確認なら `Text`
2. スコア、ガイド、タイマー、コントロール行のような短い ASCII HUD なら `Message` または `WebgApp.setGuideLines()` / `setStatusLines()` / `setHudRows()`
3. デスクトップで診断情報とコントロールを詳しく見たいなら `DebugDock`
4. エラー全文や長文レポートを読むなら `FixedFormatPanel`
5. 日本語を含む説明文、ボタン、選択、ステータスカードをシーンの上へ重ねるなら `UIPanel`

迷ったときは、「短い ASCII か」「長文か」「操作を含むか」「デスクトップデバッグ限定か」を先に決めると、この章の部品を選びやすくなります。
