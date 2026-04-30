# HUDとオーバーレイの設計

3D アプリケーションにおいて、シーンそのものを描画するだけでは十分ではありません。操作ガイドや状態表示、詳細な説明文、デバッグ情報、あるいは画面上のボタンなど、シーンの上に重ねて表示したい情報は必ず発生します。しかし、これらすべての情報を同一の表示経路で処理しようとすると、簡潔な HUD は視認性が低下し、長文は読みづらくなり、ボタン類も操作性が悪化します。

本章では、`webg` が HUD とオーバーレイの役割をどのように分担しているかを整理し、`Text`、`Message`、`DebugDock`、`FixedFormatPanel`、`UIPanel` をどのような場面で使い分けるべきかを解説します。

## HUDとは何か

まず、HUD（Heads-Up Display：ヘッドアップディスプレイ）について説明します。もともとは航空機のコクピットなどで、パイロットが視線を正面から外さずに情報を確認できるよう、フロントガラスなどの視界に情報を投影するシステムの名称です。

コンピューターグラフィックスやゲームにおける HUD も同様の目的で利用されます。ユーザーが 3D シーンという「主役」から視線を外すことなく、現在のスコア、体力、FPS（フレームレート）、操作ガイドなどの「補助的な情報」をリアルタイムで確認できるように、画面上の最前面に重ねて表示するインターフェースのことを指します。

## HUDとオーバーレイの設計思想

`webg` の HUD 系コンポーネントは、単一の万能な UI を提供することではなく、用途に応じた「表示経路の使い分け」という設計思想に基づいています。Canvas 上に簡潔に重ねる「Canvas HUD」と、Canvas 外の DOM を利用して長文や操作 UI を表示する「DOM オーバーレイ」は、設計段階から明確に役割が分けられています。

さらに `WebgApp` では、ビューポート全体を使用する通常構成だけでなく、`layoutMode: "embedded"` によって固定サイズの Canvas を本文中に埋め込む構成もサポートしています。そのため、同じ `UIPanel` や `FixedFormatPanel` であっても、「ビューポートに固定して表示するのか」「Canvas ホストと共にスクロールさせるのか」によって挙動が異なります。本章では、この表示経路の違いを単なる API 名の違いではなく、「役割の違い」として理解することを目指します。

本章の要点をまとめると、短い ASCII 文字による HUD であれば `Text` または `Message`、デスクトップ環境で詳細な状態を確認したい場合は `DebugDock`、長文やエラーメッセージの全文を表示させる場合は `FixedFormatPanel`、そして日本語を含む説明文やボタンをシーン上に重ねる場合は `UIPanel` を使用するのが最適です。通常のサンプルにおける操作説明の実装では、まず `WebgApp.createHelpPanel()` が利用可能かを検討することで、実装を簡潔に抑えることが可能です。

## DOMとは何か

DOM（Document Object Model）は、ブラウザが HTML 文書を JavaScript から操作できるようにしたツリー構造です。HTML の `<div>`、`<button>`、`<p>`、`<pre>` といった要素は、ブラウザ内部では DOM のノード（node）として管理されます。JavaScript を通じて、これらのノードを作成したり、表示内容を書き換えたり、スタイルを変更したり、クリックイベントなどのハンドラを接続したりできます。

`webg` の 3D シーンは WebGPU の canvas に描画されます。canvas はピクセル単位で描画する領域であり、3D モデル、背景、パーティクル、および Canvas HUD はこの描画結果の一部として表示されます。一方で、説明文、ボタン、エラーパネル、ヘルプパネルのような UI は、canvas の外側または上側に HTML 要素として配置できます。この HTML 要素による表示経路を、本章では「DOM オーバーレイ」と呼びます。

Canvas HUD と DOM オーバーレイは、どちらもユーザーには「画面に重なっている情報」として見えますが、内部の仕組みは大きく異なります。Canvas HUD は WebGPU の描画フローに含まれるため、3D シーンと同じタイミングで軽量に描画できます。その代わり、標準の文字描画は短い ASCII 表示を前提としており、ブラウザの通常テキストのような日本語組版、可変幅フォント、テキストの選択、スクロール、ボタン操作などの機能は持ちません。対して DOM オーバーレイはブラウザの HTML 表示であるため、日本語、長文、ボタン、スクロール、コピー可能なテキスト、入力フォームなどを自然に扱うことができます。

この違いを理解しておくと、「短い状態表示は Canvas HUD」「読むための説明や操作 UI は DOM」という役割分担が明確になります。HUD とオーバーレイは見た目の上下関係だけで分類するのではなく、描画フローと利用目的の違いで選択してください。

## HUDとオーバーレイの役割分担

`webg` の表示補助コンポーネントは、大きく 5 つに分類して考えると体系的に理解できます。

`Text` は文字グリッドそのものを扱うローレベル（低レイヤー）のクラスであり、固定座標へ直接文字を書き込むための部品です。`Message` は `Text` をベースに `id`、アンカー、ブロックといった概念を追加したハイレベル（高レイヤー）な HUD であり、スコアやガイドのような短い表示を意味的な単位で更新したい場合に適しています。`DebugDock` はデスクトップでのデバッグ時に画面右側に固定表示される開発者向けドックで、コントロール、診断情報、レポートサマリーなどを 1 か所に集約します。`FixedFormatPanel` は長文やエラー全文を `<pre>` 形式で表示するためのパネルです。そして `UIPanel` は、シーンの上にボタン、カード、ヒント、日本語の説明文などを重ねる DOM オーバーレイの基盤となります。

このように役割を分担させている理由は、表示内容によって求められる特性が大きく異なるためです。スコアや FPS は一瞬で認識できる位置にあることが重要ですが、エラー全文は落ち着いて読めるパネル形式の方が適しています。また、ボタン操作を伴う UI では、さらに異なる配慮が必要になります。Canvas 上の文字 HUD は簡潔な情報に絞り、DOM オーバーレイ側で長文や操作 UI を担わせることで、サンプルの解析や新規アプリケーションの開発において、「何をどこに表示すべきか」という判断を役割に基づいてスムーズに行えるようになります。

ここで留意すべき点は、`Text` と `Message` は ASCII 文字を想定して設計されていることです。`Text.js` は文字を `charCodeAt()` と `charOffset` を用いてグリフインデックスに変換して描画しており、標準の外部フォントアトラスも `0x00..0x7F` の範囲を対象としています。したがって、日本語や一般的な UTF-8 テキストを扱う場合は、最初から `UIPanel` や `FixedFormatPanel` のような DOM ベースのコンポーネントで扱うのが自然です。「短い ASCII HUD は Canvas、非 ASCII を含む説明や操作 UI は DOM」という分担が、現在の `webg` の実装において最も効率的な設計方針となります。

## 短いHUDを出す: `Text` と `Message`

### Canvas HUD は文字グリッドとして描画される

`webg` の Canvas HUD は、DOM の文字要素ではなく、WebGPU の描画対象として扱われます。`Text` は `cols x rows` の文字セルを持つ画面バッファを管理し、`write()` や `writeAt()` はそのバッファへ文字コードに基づくグリフ番号を書き込みます。既定の `Text` は 80 列 x 25 行の端末風グリッドとして初期化され、必要に応じて `setGridSize()` で列数と行数を変更できます。

描画時には `drawScreen()` が画面バッファを走査し、空でないセルだけを 1 文字ずつ描画します。1 文字は小さな四角形（クアッド）として用意され、`Font` シェーダーがその四角形にフォントアトラスの該当グリフを貼ります。`Font` は文字ごとの `x`、`y`、`ch`、`scale` を uniform として受け取り、dynamic uniform offset を使って同じ render pass 内で多数の文字を描き分けます。つまり、Canvas HUD は「HTML の文字を canvas 上に置いている」のではなく、「文字グリッドを GPU で描いている」と理解すると実装と一致します。

`Font` は 16 列 x 8 行のフォントアトラスを前提にしており、外部フォントテクスチャを使う場合は `0x00..0x7F` の範囲を扱います。外部フォントを渡さない場合は、`Text` が内蔵の 96 文字分のビットマップフォントを CPU 側で生成し、`charOffset = 32` として ASCII printable 相当の文字を扱います。このため、標準の Canvas HUD は、スコア、FPS、mode、操作キー、短い debug value のような ASCII 中心の表示に向いています。

`setScale()` は文字を大きく表示するための機能ですが、文字が大きくなる分、画面上に見える列数と行数は減少します。`Text.getVisibleGridSize()` と `Message.resolvePosition()` はこの visible grid を基準に anchor を解決するため、`top-right` や `bottom-left` のような指定は scale 後の見える範囲に追従します。HUD の位置が canvas のピクセル座標ではなく文字セル座標で管理されていることを意識すると、`x`、`y`、`width`、`gap`、`align` の意味を理解しやすくなります。

この仕組みにより、Canvas HUD は 3D シーンと同じ canvas 上に軽量に重ねられます。一方で、長文、日本語、可変幅フォント、クリック可能な UI、スクロールする説明文には向きません。これらが必要な場合は、後述する `UIPanel`、`FixedFormatPanel`、`DebugDock` のような DOM ベースのコンポーネントを選びます。

### `Text.js` の使い方

`Text` は、文字グリッドへ直接書き込むローレベル（低レイヤー）のクラスです。`writeAt()` や `goTo()` を用いてセル座標に文字を書き込み、`drawScreen()` で描画を行います。アンカーや `id` を持たないため、固定座標で構成する端末風の HUD や、低レイヤーでの文字表示確認に適しています。

最小構成の例を以下に示します。

```js
import Text from "./webg/Text.js";

const text = new Text(screen.getGL(), { cols: 80, rows: 25 });
await text.init("../../webg/font512.png");

text.writeAt(0, 0, "FPS: 60");
text.writeAt(0, 2, "PRESS ENTER");
text.drawScreen();
```

この構成では、何列何行のどこに文字を配置するかを開発者が直接制御します。`Text` はグリッドサイズと文字スケールを個別に管理できるため、固定レイアウトの HUD を構築する際に便利です。

```js
text.setGridSize(100, 30);
text.setScale(1.5);

text.writeAt(0, 0, "100x30 grid");
text.writeAt(0, 1, "scale=1.5");
text.drawScreen();
```

ここで `setGridSize()` は文字バッファの列数と行数を変更し、`setScale()` は描画される文字の大きさを変更します。`Text` は軽量でシーンに馴染みやすい特性を持ちますが、長文や日本語の説明には向いていません。標準のフォントアトラスを使用する場合は、次のように ASCII の範囲内で利用することが推奨されます。

```js
text.writeAt(0, 0, "HP 120");
text.writeAt(0, 1, "SCORE 000123");
// text.writeAt(0, 2, "開始") は標準のフォントアトラスでは扱わない
```

### `Message.js` の使い方

`Message` は `Text` を拡張し、`setLine()`、`setBlock()`、`replaceAll()` といった機能を追加したハイレベル（高レイヤー）な HUD です。`id` による要素の更新、アンカーによる画面端や中央への配置、さらに `width`、`wrap`、`align`、`gap` によるブロックの整形が可能です。スコア、ガイド、モード表示といった短い HUD を意味単位で管理する場合の中心的なコンポーネントとなります。

内部的には、`Message` も `Text` と同じ文字バッファと `Font` シェーダーを使います。違いは、利用者がセル座標へ直接書き込む代わりに、`id` 付きの line や block を登録し、描画前にそれらを文字グリッドへ展開する点です。`replaceAll()` はこの設計意図を具体化した API で、現在フレームに表示したい HUD 要素の集合を渡し、古い表示をまとめて置き換えます。毎フレーム変わる値を扱う場合でも、表示位置の手動クリアや上書きを細かく管理する必要がありません。

簡潔な 1 行表示には `setLine()` を使用します。

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

`id` を指定することで、次フレーム以降に同じ `"score"` という ID で更新を行えば、配置を維持したまま値だけを差し替えることができます。行番号を手動で管理する必要がないため、`Text` よりも柔軟な運用が可能です。

複数行のガイドやステータスを表示する場合は、`setBlock()` でまとめて配置すると効率的です。

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

HUD 全体を一括で更新したい場合は `replaceAll()` が利用可能です。

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

通常のサンプルでは、短い操作説明や状態表示を `Message.setLine()` / `setLines()` で直接管理し、項目が増えて整列が必要になったときだけ `setHudRows()` へ移す構成が分かりやすいです。HUD や診断情報を後から場当たり的に追加するのではなく、初期段階からアプリケーション構造に組み込んでおくという `webg` の設計思想に基づいた実装が推奨されます。

```js
app.message.setLines("guide", [
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

app.message.setLines("status", [
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

`Message` も `Text` と同様にフォントアトラスに依存しているため、あくまで短い ASCII HUD 用として利用してください。日本語の説明や複数段落にわたる本文を表示したい場合は、後述する `UIPanel` または `FixedFormatPanel` を使用してください。

## `DebugDock` と `FixedFormatPanel`

### `DebugDock.js` の使い方

`DebugDock` は、デスクトップ環境でのデバッグ時に画面右側に固定表示されるドックです。コントロール、診断情報、レポートサマリー、診断ボタン群を 1 か所に集約し、`formatText()` や `copyDebugDockText()` を通じてその内容をテキストとして抽出できます。これはエンドユーザー向けの常設 HUD ではなく、開発者向けの調査パネルとして利用するのが適切です。

基本的な使い方は、ドックに表示したい項目をまとめ、同時に診断情報（diagnostics）側にも値を保持させる形式となります。

```js
app.setDebugDockRows([
  { label: "Threshold", decKey: "1", incKey: "2", 
    value: bloom.threshold.toFixed(2) },
  { label: "Strength", decKey: "3", incKey: "4", 
    value: bloom.bloomStrength.toFixed(2) },
  { label: "Tone Map", cycleKey: "G", value: toneMapLabel }
]);

app.mergeDiagnosticsStats({
  threshold: bloom.threshold,
  bloomStrength: bloom.bloomStrength,
  toneMap: toneMapLabel
});
```

現在表示されているドックの内容を共有したい場合は、`formatDebugDockText()` または `copyDebugDockText()` を使用します。

```js
const dockText = app.formatDebugDockText();
console.log(dockText);

await app.copyDebugDockText();
```

ここで重要なのは、`DebugDock` はモバイル環境やウィンドウ幅が狭い場合には表示されないという点です。ビューポート幅とポインタ条件を満たしたときのみ有効になるため、エンドユーザーに必要な最小限の情報までドックにのみ配置する構成は避けてください。ドックはあくまで「詳細な状態を補足的に表示する場所」であり、「唯一の情報提示経路」ではないことを意識する必要があります。

### `FixedFormatPanel.js` の使い方

`FixedFormatPanel` は `<pre>` 要素ベースの固定パネルです。短い HUD には収まりきらない長文、エラーメッセージ、診断情報の全文、あるいは読み込み結果の一覧などを表示するために使用します。これは `WebgApp.showFixedFormatPanel()` および `showErrorPanel()` の基盤となるコンポーネントです。

長文パネルの最小構成例を以下に示します。

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

起動失敗やローダーのエラーなどは `showErrorPanel()` にまとめると、デバッグドックや diagnostics と連携しながら統一した形式で扱うことができます。

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

`FixedFormatPanel` は DOM の `<pre>` 要素を使用するため、ASCII 文字の制限を受けません。日本語や詳細な補足情報を提示したい場合は、HUD に無理に詰め込むのではなく、このパネルを利用するのが最適です。

```js
app.showFixedFormatPanel([
  "読み込みに失敗しました",
  "missing node: hero_root",
  "scene.json を確認してください"
].join("\n"), {
  id: "load-help"
});
```

`WebgApp` を `layoutMode: "embedded"` で運用する場合、このパネルも Canvas ホストを基準に配置されます。教材ページなどの本文中に Canvas を配置している場合、パネルだけがビューポートに固定されるのではなく、Canvas と共にスクロールする挙動になります。通常の固定構成と embedded 構成で挙動が異なる点も含め、「読むためのパネル」としての役割を理解して使い分けてください。

## 操作用のオーバーレイ: `UIPanel.js`

`UIPanel` は Canvas 外の DOM を利用してシーンの上にパネルを重ねる共通基盤です。`createLayout()` で左右のカラムを定義し、`createPanel()`、`createButtonRow()`、`createButtonGrid()`、`createTextBlock()`、`createHint()`、`createPill()` などのメソッドを用いてコンポーネントを組み立てます。ボタンによる操作 UI、日本語を含む説明文、ステータスカードなどを表示するための標準的な経路となります。

### レイアウトとパネル

まずレイアウトを定義し、その内部にパネルを配置します。

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

これにより、シーンの左上に説明付きパネルを配置する土台が完成します。`UIPanel` は内部で CSS クラスを適用するため、サンプル間での記述の重複を最小限に抑えることができます。`webg/samples/scene` は、左側のアクションボタンと右側のステータスパネルを持つ代表的な構成例であるため、まずはこのサンプルを参照してください。テーマの適用方法を確認したい場合は `webg/unittest/theme` が有用です。

### 会話専用オーバーレイ: `DialogueOverlay`

`DialogueOverlay` は、`UIPanel` をベースにしつつ、「会話」という特定のワークフローに特化したハイレベル（高レイヤー）なコンポーネントです。話者、本文、選択肢という構造化されたデータを DOM オーバーレイとして出力し、ユーザーとのインタラクティブな対話を管理します。

汎用的な `UIPanel` を使って会話 UI を自作することも可能ですが、`DialogueOverlay` を利用することで、次へボタンの制御や選択肢による分岐、再表示などの会話システムに必要な機能を標準的に利用できます。

```js
const intro = [
  {
    speaker: "guide",
    lines: ["ようこそ", "ここでは移動と攻撃を順番に確認します"]
  }
];
app.startDialogue(intro);
```

### 学習用サンプルのヘルプは `createHelpPanel()` を優先する

サンプルごとに `UIPanel` を手動で構築する前に、まずは `WebgApp.createHelpPanel()` が利用可能かを検討してください。これは学習用サンプル向けに、左上に折りたたみ可能なヘルプパネルを迅速に展開するためのヘルパーです。1 行 1 操作の配列を渡すだけで、「Hide Help」および「Show Help」ボタンを備えたパネルが生成されます。デバッグドックの右側余白も自動的に反映されるため、サンプル側でパネルのオフセットを個別に調整する必要はありません。通常のサンプルではこれを標準的な実装とすることで、開発者と利用者の双方にとって意図が伝わりやすくなります。

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

ただし、`janken` や `circular_breaker` のようにゲーム HUD 自体が演出の一部となっているサンプルや、`tile_sim` のように説明量が多く独自のレイアウトを必要とするサンプルは例外となります。それ以外では、「操作説明は折りたたみ可能な help panel、現在値は HUD、詳細な調査情報は diagnostics」という分担にすることが、開発効率と保守性の面で最適です。また `layoutMode: "embedded"` を併用した場合、ヘルプパネルは Canvas ホスト基準で本文と共にスクロールします。これにより、「本文を読んでから実行例に戻る」という学習フローを自然に構築でき、閉じた後の `Show Help` ボタンも Canvas の近傍に保持されるため、利便性が向上します。

### ボタン行とテキストブロック

ボタンと説明文を組み合わせることで、操作 UI と長文表示の分担がより明確になります。

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

`createTextBlock()` は `textContent` を使用するため、長文のヘルプや日本語の説明文をそのまま扱うことができます。ここが `Message` との決定的な違いです。簡潔な HUD は `Message` に集約し、詳細な説明は `UIPanel` に配置することで、表示経路の役割を明確に分けることができます。

### グリッド、ピル、ステータス

複数のボタンやステータスカードを配置したい場合は、グリッドやピルを組み合わせて構築します。

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

`createStatusBlock()` は画面下部寄りに固定ステータスを表示し、ボタン群とは別に状態を提示したい場合に有効です。日本語の状態文をそのまま表示できる点も、ASCII 制限のある HUD と分ける価値があります。全体のテーマを統一したい場合は `WebgUiTheme` の `uiPanel` プリセットを使用し、`WebgApp` と同期させて更新してください。これにより、`DebugDock`、`FixedFormatPanel`、`UIPanel` の視覚的な一貫性を保つことができます。

```js
import { DEFAULT_UI_LIGHT_THEME } from "./webg/WebgUiTheme.js";

app.setUiTheme(DEFAULT_UI_LIGHT_THEME);
uiPanels.setTheme(app.uiTheme.uiPanel);
```

## どの部品を選ぶべきか

最後に、実装におけるコンポーネントの選定基準をまとめます。

*   `Text`: 端末風の固定座標表示や、ローレベル（低レイヤー）での動作確認。
*   `Message` / `setHudRows()`: スコア、ガイド、タイマー、コントロール行などの簡潔な ASCII HUD。
*   `DebugDock`: デスクトップ環境における詳細な診断情報とコントロールの表示。
*   `FixedFormatPanel`: エラー全文や長文のレポート表示。
*   `UIPanel`: 日本語を含む説明文、ボタン、選択 UI、ステータスカードをシーン上に重ねる場合。

迷った際は、「短い ASCII 文字か」「長文か」「ユーザー操作を含むか」「デスクトップデバッグ限定か」という観点から検討してください。

### 【注意】DebugDock 表示時のレイアウト崩れについて

レイアウト調整において、`DebugDock` を表示した際に `DialogueOverlay` や `UIPanel` 由来のパネルが canvas 外へはみ出してしまう現象が発生することがあります。これは、`DebugDock` がビューポート右端に固定される一方で、DOM オーバーレイ側がビューポート全幅を基準に配置されている場合に起こります。

この問題を回避し、安定したレイアウトを実現するためのポイントは以下の 3 点です。

1. canvas 領域の制御を集約する: canvas を狭める処理は `WebgApp.applyViewportLayout()` に集約し、サンプル側で個別に canvas style を補正しないようにします。これにより、`--webg-canvas-right-inset` という CSS 変数が document に適切に配布されます。
2. 有効表示領域を基準にする: DOM オーバーレイ側はビューポート基準ではなく、「canvas 右端までの有効表示領域」を基準にしたオフセットを参照させます。`DialogueOverlay` や `FixedFormatPanel` は内部で `getDockOffset()` を使用しており、独自 DOM を構築する場合は `--webg-canvas-right-inset` を参照させる必要があります。
3. レスポンシブクラスでのオフセット保持: `DialogueOverlay` のように `.is-stacked` などのレスポンシブ用クラスを持つ UI では、ルート要素だけでなく、各クラス側の定義においても dock offset が保持されている必要があります。

トラブルシューティングの際は、まず「特定のパネルだけが外に出るのか（クラス切り替え側の問題）」、あるいは「すべての固定 DOM が外に出るのか（CSS 変数の配布や canvas 縮小自体の問題）」を確認してください。

## まとめ

本章で最も重要なのは、単に表示部品を増やすことではなく、「役割に応じて表示経路を適切に分けること」です。簡潔な HUD と長文、エンドユーザー向け UI と開発者向けパネル、そして日本語説明と ASCII HUD を明確に分離しておくことで、サンプルコードの可読性が向上し、本番アプリケーションの保守性も高まります。この設計アプローチは [14_UI表示の設計.md](./14_UI表示の設計.md) の分担思想と一貫しており、次章で解説する入力代替 UI である `Touch` を理解する上でも重要な前提となります。
