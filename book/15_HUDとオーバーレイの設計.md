# HUDとオーバーレイの設計

## 本章の構成

前章では、`webg` における文字表示の使い分けについて、利用者視点から整理しました。簡潔な状態表示は `Message`、精読させる文章は `OverlayPanel`、調査記録は `Diagnostics` / `DebugDock`、そしてタッチ入力は `Touch` という役割分担です。

本章では、この分担が内部的にどのような構造で実現されているかを解説します。単なる API のリファレンスではなく、なぜ `Message` と `OverlayPanel` を分ける必要があるのか、`WebgApp` がどこまで責任を持つべきか、そして `OverlayPanel` のオプションがどのように実際の表示構造に反映されるのかを確認します。

本章の流れは以下の通りです。

1. キャンバス HUD と DOM オーバーレイの技術的な前提を整理する。
2. `Text` から `Message` へ至る描画フローを確認する。
3. `OverlayPanel` の DOM 構造とオプションの反映仕組みを見る。
4. `WebgApp` が担うオーバーレイ管理の範囲を確認する。
5. テーマ、デバッグドック、および埋め込みレイアウトとの関係を整理する。
6. 実装時の確認手順とユニットテストの活用方法をまとめる。

## キャンバス HUD と DOM オーバーレイの技術的差異

`webg` の UI 表示は、描画される「面」の違いから理解すると明確になります。

| 表示面 | 主な API | 実体 | 得意なこと | 苦手なこと |
| :--- | :--- | :--- | :--- | :--- |
| キャンバス HUD | `Text`, `Message` | WebGPU で描画する文字クアッド | 軽量な更新、短い ASCII 文字、シーンとの一体的な描画 | 日本語、長文、ボタン、スクロール |
| DOM オーバーレイ | `OverlayPanel`, `DebugDock`, `Touch` | HTML 要素（DOM） | UTF-8、可変幅フォント、ボタン、スクロール、フォーカス管理 | 3D 深度との直接的な合成、過剰な DOM 更新による負荷 |

キャンバス HUD は 3D シーンと同じ描画パイプラインに乗るため、極めて軽量に動作します。毎フレーム変動するスコアやステータス表示に最適です。一方で、表示できる文字はフォントアトラスの範囲に依存し、標準では ASCII を前提としているため、日本語の表示はできません。また、長文の扱いには向きません。

対して DOM オーバーレイは、ブラウザが持つ高度なテキストレイアウト機能をそのまま利用できます。日本語、可変幅フォント、ボタン、スクロール、アクセシビリティなどをブラウザに委ねることができます。ただし、これは 3D シーンの一部ではなく、キャンバスの上に重なる別レイヤーであるため、配置や重なり順を適切に管理しなければ、シーンの重要な部分を遮ることになります。

この技術的な特性の違いが、`Message` と `OverlayPanel` を明確に分ける設計上の根拠となっています。

## `Text` と `Message` の階層構造

`Text` は、文字グリッドを GPU 上に描画するためのローレベル（低レイヤー）なクラスです。文字位置、文字コード、スケール、色、フォントテクスチャなどを管理し、最終的に文字ごとのクアッド（四角形ポリゴン）として画面に描画します。

`Message` は、この `Text` クラスをラップし、HUD として使いやすくするための管理層（ハイレベル / 高レイヤー）です。利用者が通常操作するのはこの `Message` 層です。文字列を `id` 付きのブロックとして登録し、`anchor` や `width` を指定することで容易に配置できます。

```js
app.message.setLines("status", [
  "mode=orbit",
  "debug=off"
], {
  anchor: "top-left",
  x: 0,
  y: 0
});
```

`Message` は `setLine()`（単一行）、`setLines()`（複数行）、`setBlock()`（明示的なブロック管理）という入口を提供しています。

```js
app.message.setLine("mode", "MODE: EDIT", {
  anchor: "top-center",
  x: 0,
  y: 1
});

app.message.setBlock("score", [
  "SCORE 1200",
  "LIVES 3"
], {
  anchor: "top-right",
  x: -2,
  y: 0,
  align: "right"
});
```

`Message` 設計の最大の利点は、表示内容を `id` で更新できる点にあります。毎フレーム全てをクリアして再構築するのではなく、特定の `id` を持つブロックだけを更新することで、スコア、ステータス、ガイド、トースト通知などの異なる情報を整理して管理できます。

ただし、前述の通り `Message` はキャンバス HUD であるため、HTML の `<button>` や `<pre>`、スクロール、フォーカスといった機能は持ちません。日本語の説明や詳細なレポートは `OverlayPanel` へ委ねる構成となります。

## `Message` の描画タイミング

`WebgApp` を使用する場合、通常は `app.start()` の描画ループ内でシーンの描画と HUD の描画がまとめて処理されます。アプリケーション側は `onUpdate` ハンドラ内で `app.message.setLines()` を呼び出し、現在の状態を更新します。

```js
app.start({
  onUpdate: ({ deltaSec }) => {
    elapsedSec += deltaSec;

    app.message.setLines("status", [
      `time=${elapsedSec.toFixed(1)}`,
      `camera=${orbit.orbit.distance.toFixed(1)}`
    ], {
      anchor: "top-left",
      x: 0,
      y: 0
    });

    return false;
  }
});
```

この時点では、内部的なデータとして文字列を登録しているに過ぎません。実際の描画は `WebgApp` 内部の `drawMessages()` メソッドを通じて、シーン描画後の最終工程として重ねられます。利用者がこの内部順序を意識する必要はありませんが、「HUD はキャンバスの一部として描画される」という特性を理解しておくことで、DOM オーバーレイとの使い分けがより明確になります。

## `OverlayPanel` の内部構造

`OverlayPanel` は DOM 要素で構成されており、概念的には以下のような階層構造を持っています。

```text
root (オーバーレイ全体の基準)
  backdrop (背景遮蔽層)
  shell (配置制御層：anchorに従って配置)
    panel (パネル本体)
      header (ヘッダー：タイトル、閉じる/畳むボタン)
      body (本文：text または lines)
      choices (選択肢領域)
      buttons (操作ボタン領域)
```

`OverlayPanel` を直接インスタンス化することも可能ですが、通常は `WebgApp` の管理メソッドを介して操作します。

```js
app.showOverlayPanel({
  id: "report",
  title: "Report",
  text: reportText,
  format: "pre",
  scrollY: true,
  anchor: "bottom-right"
});
```

同一の `id` で `showOverlayPanel()` を呼び出すと、既存のパネルが更新されます。一部のプロパティのみを更新したい場合は `updateOverlayPanel()` を使用します。

```js
app.updateOverlayPanel("report", {
  text: nextReportText,
  anchor: "top-right"
});
```

また、一時的に非表示にする場合は `hideOverlayPanel()`、DOM 要素ごと完全に削除する場合は `removeOverlayPanel()` を使い分けます。

## 本文の指定：`text` と `lines`

`OverlayPanel` の本文は、単一の文字列を渡す `text` または文字列配列を渡す `lines` のいずれかで指定します。

```js
app.showOverlayPanel({
  id: "plain-note",
  text: "1 つの文字列として表示します"
});
```

```js
app.showOverlayPanel({
  id: "line-note",
  lines: [
    "1 行目",
    "2 行目",
    "3 行目"
  ]
});
```

これらを同時に指定することはできません。これは、暗黙的な結合や上書きルールを排除し、更新時の意図しないデータの持ち越しを防ぐための設計です。どちらの入力形式を使用しているかを明確にすることで、コードの可読性と安全性を高めています。

## フォーマットとスクロール制御

`OverlayPanel` は、`format` オプションによって表示形式を切り替えます。

`format: "plain"` は一般的な説明文向けです。既定では改行を保持しつつ適切に折り返す `pre-wrap` に近い表示となります。

```js
app.showOverlayPanel({
  id: "help",
  title: "Help",
  lines: [
    "Drag: orbit camera",
    "Wheel: zoom"
  ],
  format: "plain"
});
```

`format: "pre"` は、ログ、エラー、診断サマリーのように、空白や改行などの書式を厳密に保持したい文章に使用します。

```js
app.showOverlayPanel({
  id: "diagnostics-summary",
  title: "Diagnostics",
  text: diagnosticsText,
  format: "pre",
  scrollY: true,
  maxHeight: "40vh"
});
```

長文を扱う場合は `scrollY: true` と `maxHeight` を組み合わせます。これにより、パネルが画面全体を覆い尽くすことなく、本文領域のみをスクロールさせることが可能です。

## 配置制御：`anchor`、`offset`、`positioningMode`

`OverlayPanel` は、`anchor`（基準点）に基づいて配置されます。

```js
app.showOverlayPanel({
  id: "inspector",
  title: "Inspector",
  lines: ["selected=nodeA"],
  anchor: "middle-right",
  offsetX: 16,
  offsetY: 0,
  width: 300
});
```

`anchor` は 9 方向（`top-left` から `bottom-right` まで）から選択可能です。

また、配置モードとして `positioningMode` が存在します。通常のフルスクリーンアプリでは `fixed` が使用されますが、教材ページなどにキャンバスを埋め込む `layoutMode: "embedded"` では、オーバーレイコンテナをキャンバスホストに紐付けるため、`absolute` が使用されます。`WebgApp` を介して `showOverlayPanel()` を呼び出すと、現在のレイアウト設定に応じた最適なコンテナ要素と配置モードが自動的に適用されます。

この仕組みにより、同一の `OverlayPanel` 実装を、フルスクリーンサンプルと埋め込み例の両方でそのまま利用できます。

## 畳み込み（collapse）と閉じる（close）機能

ヘルプパネルのように、完全に消去するのではなく「本文だけを畳んで最小限のボタンとして残したい」場合は `collapsible` オプションを使用します。

```js
app.showOverlayPanel({
  id: "help",
  title: "Help",
  lines: ["Drag: orbit", "R: reset"],
  collapsible: true,
  collapsed: false,
  showCollapseButton: true,
  collapseLabelExpanded: "Hide Help",
  collapseLabelCollapsed: "Show Help"
});
```

一方で、完全にパネルを閉じさせたい場合は `closable` と `showCloseButton` を使用します。

```js
app.showOverlayPanel({
  id: "error",
  title: "Error",
  text: error.message,
  format: "pre",
  closable: true,
  showCloseButton: true
});
```

「一時的に視界を確保する（collapse）」か、「閲覧を終了してパネルを破棄する（close）」かという用途に応じて使い分けてください。

## ボタンと選択肢（buttons / choices）

`OverlayPanel` の下部には、操作ボタンや選択肢を配置できます。これらの要素が押下されると、`onAction` ハンドラに `actionId` が返されます。

```js
app.showOverlayPanel({
  id: "choice",
  title: "Route",
  lines: ["どちらへ進みますか"],
  choices: [
    { id: "left", label: "Left" },
    { id: "right", label: "Right" }
  ],
  buttons: [
    { id: "cancel", label: "Cancel", kind: "secondary" }
  ],
  onAction: ({ panelId, actionId }) => {
    console.log(panelId, actionId);
  }
});
```

`buttons` はパネル全体に対する操作（例：キャンセル、保存）、`choices` は本文に対する選択肢（例：ルート選択、回答）という意味づけで使い分けるのが適切です。実装上はいずれも `actionId` を返すため、アプリケーション側では同一の入口で処理可能です。

なお、同一パネル内で `actionId` が重複すると、どのボタンが押されたか判別不能になるため、`OverlayPanel` では ID の重複をエラーとして検知します。

## モーダル設計と `pauseScene` の役割

`modal: true` を設定すると、背後の DOM 操作を受け付けず、操作をパネルに集中させることができます。

`pauseScene: true` は、アプリケーション側に「このパネルが表示されている間はシーンの進行を停止すべきである」という状態を伝えるフラグです。重要な点として、`OverlayPanel` 自体が自動的にシーンの更新（update）を停止させることはありません。

```js
app.showOverlayPanel({
  id: "pause-menu",
  title: "Paused",
  lines: ["Resume or restart?"],
  modal: true,
  pauseScene: true,
  anchor: "middle-center",
  buttons: [
    { id: "resume", label: "Resume", kind: "primary" },
    { id: "restart", label: "Restart", kind: "secondary" }
  ],
  onAction: ({ actionId }) => {
    if (actionId === "resume") {
      app.hideOverlayPanel("pause-menu");
    }
  }
});
```

更新ループ側では、以下のように状態を参照して処理を制御します。

```js
const pausePanel = app.getOverlayPanel("pause-menu");
const pauseState = pausePanel?.getState?.();
if (pauseState?.visible && pauseState.pauseScene) {
  return false; // 更新をスキップ
}
```

この分離により、UI 部品が勝手にゲーム時間を止めるという副作用を避け、シーン停止のタイミングをアプリケーション側の設計判断に委ねることができます。

## `WebgApp` によるオーバーレイ管理

`WebgApp` は、`OverlayPanel` のインスタンス管理と配置制御を担います。

```js
app.showOverlayPanel(options);
app.updateOverlayPanel(id, patch);
app.hideOverlayPanel(id);
app.removeOverlayPanel(id);
app.clearOverlayPanels();
app.getOverlayPanel(id);
app.hasOverlayPanel(id);
app.listOverlayPanels();
```

`WebgApp` はあえて「ヘルプ専用」や「ダイアログ専用」の API を持たず、汎用的な管理機能に特化しています。これは、`WebgApp` を基盤として軽量に保ち、個別のアプリケーションが持つ多様な進行 UI を柔軟に実装できるようにするためです。

定型的なオプションが必要な場合は、`OverlayPanelPresets.js` をインポートして利用してください。

```js
import { buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";

app.showOverlayPanel(buildHelpPanelOptions({
  id: "help",
  lines: ["Drag: orbit", "R: reset"]
}));
```

この構成により、開発者は「特殊な API」を覚えるのではなく、「`OverlayPanel` のオプションをプリセットで効率的に生成している」という直感的な理解で開発を進められます。

## テーマの適用

DOM オーバーレイの視覚的なスタイルは `WebgUiTheme` で管理されます。`WebgApp.setUiTheme()` を呼び出すことで、`DebugDock` および管理下のすべての `OverlayPanel` にテーマが反映されます。

```js
import { UI_THEME_PRESETS } from "../../webg/WebgUiTheme.js";

app.setUiTheme(UI_THEME_PRESETS.light);
```

`OverlayPanel` はテーマ内の `uiPanel` グループ（背景色、ボーダー、シャドウ、アクセントカラーなど）を参照して描画されます。

## `DebugDock` との配置調整

`DebugDock` は右側に固定表示される開発用領域です。デバッグモードでドックを表示すると、実質的な有効画面幅が狭まります。

`OverlayPanel` は `avoidDebugDock` オプションを使用することで、ドックと重ならないように配置を調整できます。`WebgApp` 経由で作成されたパネルは、現在のドックオフセットを自動的に取得できるため、右寄せアンカーのパネルを適切に内側へ寄せることが可能です。

```js
app.showOverlayPanel({
  id: "runtime-log",
  title: "Runtime Log",
  text: logText,
  format: "pre",
  anchor: "bottom-right",
  avoidDebugDock: true
});
```

`DebugDock` はあくまで開発者向けの調査領域です。一般利用者が閲覧する説明は `OverlayPanel`、開発中の内部状態確認は `DebugDock` と明確に使い分けてください。

## 埋め込みレイアウトとオーバーレイ

`WebgApp` は、フルスクリーンアプリだけでなく、教材ページ等にキャンバスを埋め込む `layoutMode: "embedded"` にも対応しています。

埋め込みモードでは、キャンバスが HTML 文書の中間に配置されるため、ページ全体をスクロールすると、ビューポート固定のオーバーレイはキャンバスから離れて見えてしまいます。

これを解決するため、`WebgApp` は埋め込みモード時にオーバーレイコンテナをキャンバスホストに同期させます。`OverlayPanel` はこのコンテナを基準に `absolute` 配置されるため、ページをスクロールしても常にキャンバスと共に移動します。

この挙動は `unittest/embedded` で確認でき、ホスト、キャンバス、各種パネル、タッチコントロールの矩形差分を毎フレーム検証しています。

## 実装例：複合的な UI 構成

ここまでの要素を組み合わせた、典型的な実装例を示します。

```js
import WebgApp from "../../webg/WebgApp.js";
import { buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";

const app = new WebgApp({
  document,
  messageFontTexture: "../../webg/font512.png"
});

await app.init();

// 1. 操作説明（プリセット利用）
app.showOverlayPanel(buildHelpPanelOptions({
  id: "help",
  lines: [
    "Drag: orbit",
    "R: reset",
    "B: briefing"
  ],
  anchor: "top-left"
}));

// 2. 実行時レポート（整形済みテキスト、スクロールあり）
app.showOverlayPanel({
  id: "runtime-report",
  title: "Runtime Report",
  text: "ready",
  format: "pre",
  scrollY: true,
  anchor: "bottom-right",
  maxHeight: "32vh"
});

// 3. ブリーフィング（ボタン付き、進行制御は関数で管理）
function showBriefing() {
  app.showOverlayPanel({
    id: "briefing",
    title: "Briefing",
    lines: [
      "このパネルはボタン付き説明です",
      "進行制御はサンプル側で持ちます"
    ],
    anchor: "bottom-left",
    buttons: [
      { id: "close", label: "Close", kind: "primary" }
    ],
    onAction: ({ actionId }) => {
      if (actionId === "close") {
        app.hideOverlayPanel("briefing");
      }
    }
  });
}

app.attachInput({
  onKeyDown: (key, ev) => {
    if (ev.repeat) return;
    if (key === "b") {
      showBriefing();
    }
  }
});

app.start({
  onUpdate: ({ deltaSec }) => {
    // 4. 短い状態表示（キャンバス HUD）
    app.message.setLines("status", [
      "status: running",
      `dt=${deltaSec.toFixed(3)}`
    ], {
      anchor: "top-left",
      x: 0,
      y: 0
    });

    return false;
  }
});
```

この例では、情報の性質に応じて「`Message`（状態）」「`OverlayPanel` プリセット（ヘルプ）」「`format: "pre"`（レポート）」「カスタム関数（ブリーフィング）」と使い分けています。表示経路を分離することで、規模が拡大しても管理しやすい構成となります。

## ユニットテストによる検証

UI 系の変更を行った際は、以下のユニットテストを確認することで意図した動作を検証できます。

| ユニットテスト | 検証内容 |
| :--- | :--- |
| `unittest/overlay_panel` | アンカー、pre形式、スクロール、ボタン、選択肢、モーダルなど |
| `unittest/embedded` | 埋め込みキャンバスとオーバーレイの配置追従 |
| `unittest/theme` | `WebgApp.setUiTheme()` によるテーマ切り替え |
| `unittest/message` | キャンバス HUD としての `Message` の基本動作 |
| `unittest/touch` | `Touch` による入力代替 UI の動作 |

特に `unittest/overlay_panel` は、本章で解説した UI 設計の核心部分を網羅しており、9 方向のアンカーやモーダル動作、アクション返却などを一画面で確認できるため、開発時の参照を推奨します。

## 実装時のチェックリスト

`OverlayPanel` を実装する際は、以下の点を確認してください。

1. ID の一意性: パネル ID が重複していないか。
2. 指定の排他性: `text` と `lines` を同時に指定していないか。
3. 表示面の選択: 日本語や長文を `Message` に入れていないか。
4. 可読性の確保: 長文の場合、`scrollY` と `maxHeight` を適切に指定しているか。
5. 視認性の配慮: シーン中央を遮らない適切な `anchor` を選択しているか。
6. ドック回避: 右寄せパネルで `avoidDebugDock` を考慮しているか。
7. アクション ID の一意性: ボタンや選択肢の `id` が重複していないか。
8. 進行停止の必要性: `modal: true` のパネルで、アプリ側が `pauseScene` を参照して更新を止める必要があるか。
9. 責務の分離: 会話やブリーフィングの進行ロジックを `OverlayPanel` 自体に組み込んでいないか。
10. 記録の優先: 開発者や解析ツールに渡す情報は `Diagnostics` レポートとして保存しているか。

## まとめ

本章では、`webg` における HUD とオーバーレイの内部構造について解説しました。

`Message` は `Text` クラスを基盤としたキャンバス HUD であり、軽量な ASCII 状態表示に適しています。一方、`OverlayPanel` は DOM ベースのオーバーレイであり、日本語、長文、ボタン、選択肢、スクロールなどを柔軟に扱います。`WebgApp` はこれらのオーバーレイの管理基盤を提供しますが、個別の用途（ヘルプやエラー等）に応じた API は持たず、オプションとプリセットによる構成を採用しています。

この分担により、`WebgApp` の汎用性を維持しつつ、開発者には「短い HUD は `Message`、読むパネルは `OverlayPanel`、記録は `Diagnostics` / `DebugDock`」という一貫した判断軸を提供しています。

次章では、UI の中でも特に入力に関わる `Touch` と `InputController` を扱い、画面上のボタンをどのようにキー入力へ接続し、アプリケーションを操作させるかについて詳しく見ていきましょう。
