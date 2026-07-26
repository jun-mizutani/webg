# HUDとオーバーレイの設計

本章では、常時表示するHUD（Head-Up Display：画面上へ重ねる情報表示）、必要なときだけ開く `CommandPalette`、文章を読ませる `OverlayPanel` を、最終3D画像の上へ安全に配置します。
表示面を描く処理と入力状態を更新する処理を分けることで、ポストプロセス後も文字を鮮明に保ち、UI（User Interface：利用者との操作・表示の接点）を閉じた後にキーや一時停止状態が残る問題を防げます。

## HUDとオーバーレイの役割を分ける

HUDはスコアや短い状態をキャンバス上へ重ね、DOMオーバーレイは長文、設定、複数の操作部品をHTML要素として構成します。
本章では、`Text`、`Message`、`CommandPalette`、`OverlayPanel`の構造と更新方法を確認し、表示内容に応じて組み合わせる方法を説明します。

本章は第14章の選択指針を実装へ落とす章です。
`CommandPalette`、GPUで描くHUD (`Text` / `Message`)、DOM（Document Object Model：HTML要素を文書構造として扱う仕組み） `OverlayPanel` のオプション、更新、配置、モーダル動作に焦点を当てます。
入力ジェスチャーの詳細は第16章へ分離します。

前章では、`webg` における文字表示の使い分けについて、利用者視点から整理しました。
簡潔な状態表示は `Message`、精読させる文章は `OverlayPanel`、調査記録は `Diagnostics` / `DebugDock`、そしてタッチ入力は `Touch` という役割分担です。

本章では、この分担が内部的にどのような構造で実現されているかを解説します。
単なるAPIのリファレンスではなく、なぜ `Message` と `OverlayPanel` を分ける必要があるのか、`WebgApp`がどの表示を生成・更新・終了するのか、そして `OverlayPanel` のオプションがどのように実際の表示構造に反映されるのかを確認していきます。

具体的には、まずキャンバスHUDとDOMオーバーレイの技術的な差異を整理し、`Text` から `Message` へ至る描画フローを確認します。
続いて、`CommandPalette` の構築方法や状態管理、ページ構成について詳しく見ていきましょう。
さらに、`OverlayPanel` のDOM構造やオプションの反映仕組み、`WebgApp` によるオーバーレイ管理の範囲、そしてテーマや埋め込みレイアウトへの対応について解説します。
最後に、実装時の確認手順とユニットテストの活用方法についてまとめます。

## 表示面の技術的差異と設計思想

`webg` のUI表示は、描画される「面」の違いから理解すると明確になります。

**キャンバスHUD (Text, Message)**

- **実体**: WebGPUで描画する文字クアッド（四角形ポリゴン）
- **特性**: 軽量な更新、短い英数字と記号、シーンとの一体的な描画が可能
- **制約**: 日本語、長文、ボタン、スクロールには向かない

**DOMオーバーレイ (OverlayPanel, CommandPalette, DebugDock, Touch)**

- **実体**: HTML要素（DOM）
- **特性**: UTF-8、可変幅フォント、ボタン、スクロール、フォーカス管理が可能
- **制約**: 3D深度との直接的な合成、過剰なDOM更新による負荷に注意が必要

キャンバスHUDは3Dシーンと同じ描画パイプラインに乗るため、軽量に動作します。
毎フレーム変動するスコアや状態表示に適しています。
一方、表示できる文字はフォントアトラスの範囲に依存します。
標準では短い英数字と記号を前提とするため、日本語や長文の表示には向きません。

対してDOMオーバーレイは、ブラウザが持つ高度なテキストレイアウト機能をそのまま活用できます。
日本語、可変幅フォント、ボタン、スクロール、アクセシビリティなどをブラウザに委ねることが可能です。
ただし、これは3Dシーンの一部ではなく、キャンバスの上に重なる別レイヤーであるため、配置や重なり順を適切に管理しなければ、シーンの重要な部分を遮ることになります。

この技術的な特性の違いが、`Message` と `OverlayPanel` を明確に分ける設計思想の根拠となっています。
なお、`CommandPalette` もDOMオーバーレイですが、`OverlayPanel` とは用途が異なります。
`OverlayPanel` はヘルプやエラーレポートのように、ユーザーが情報を読むためのパネルです。
対して `CommandPalette` は、必要な時だけ開き、低頻度のコマンドや設定値を素早く変更するための小さな操作面として設計されています。

## CommandPaletteの構築と状態管理

全画面キャンバスを使う編集アプリやビューワでは、常時表示のメニューバーが操作領域を狭めてしまうことがあります。
そのような場合に有効なのが、ダブルクリックやキー操作で一時的に開くパレットです。
`CommandPalette` はDOMの生成と入力の検出を担当しますが、シーンやエフェクトの状態自体は保持しません。
状態はアプリケーション側に置き、パレットは現在値を読み取って操作結果を通知する「入口」として機能します。

### 生成とキャンバスへの接続

最小構成では、`document`、DOMの配置先となる `container`、操作対象の `viewport`、そして `commands` をコンストラクタへ渡します。
コンストラクタはDOMと既定のCSSを準備しますが、この段階ではキャンバスの入力は奪いません。
`attachToCanvas()` を呼ぶことで、ダブルクリック、ダブルタップ、指定キーによる開閉イベントが登録されます。

```js
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";

const canvas = document.getElementById("canvas");
const state = {
  shadow: true,
  radius: 18,
  brush: "Draw"
};

const palette = new CommandPalette({
  document,
  container: document.body,
  viewport: canvas,
  title: "Tools",
  className: "command-palette surface",
  closeOnCommand: false,
  onCommand: (id) => {
    if (id === "reset-camera") {
      resetCamera();
    }
  },
  onChange: (id, value) => {
    if (id === "shadow") state.shadow = value;
    if (id === "radius") state.radius = value;
    if (id === "brush") state.brush = value;
  },
  commands: [
    { id: "reset-camera", label: "Reset", detail: "camera" },
    { type: "toggle", id: "shadow", label: "Shadow", detail: "toggle",
      value: () => state.shadow },
    { type: "stepper", id: "radius", label: "Radius",
      value: () => state.radius, min: 8, max: 64, step: 2, input: true },
    {
      type: "select",
      id: "brush",
      label: "Brush",
      value: () => state.brush,
      options: [
        { value: "Draw", label: "Draw" },
        { value: "Blur", label: "Blur" },
        { value: "Grab", label: "Grab" }
      ]
    }
  ]
});

palette.attachToCanvas(canvas, {
  key: "/"
});
```

この例では、ダブル操作で指定位置の近くへ開き、`/` キーで開く場合はビューポートの中央へ配置されます。
`className: "command-palette surface"` を付けると、既定CSSの背景、枠、影がルート要素に適用されるため、白い背景や明るいシーンの上でも読みやすくなります。
開いた後はタイトル行をドラッグして、パレットを見やすい位置へ移動できます。
ドラッグハンドルはタイトル行だけなので、ボタン、切り替え、段階変更、選択の操作とパレット移動が衝突しにくい構成になっています。
アプリ側で位置移動を禁止したい場合は、コンストラクタに `draggable: false` を指定します。

起動方法を個別に制限する場合は、`doubleClick: false`、`doubleTap: false`、または `key: null` を指定します。
また、`open()`、`close()`、`toggle()` メソッドを使って手動で制御することも可能です。

### 操作部品の選定と状態管理

`commands` の各要素では、まず操作を識別する `id` を決めます。
`label` はボタンや行の主要な表示、`detail` はその下に表示する短い補足です。
その上で、利用者に何をさせたいかに応じて `type` を選択します。

- **ボタン（button）**: カメラのリセットやファイルの保存など、押した時点で1回の処理を実行する操作に適しています。ユーザーが押すと、パレット全体の `onCommand` と、定義している場合は個別の `onSelect` が呼ばれます。
- **切り替え（toggle）**: グリッドの表示ON/OFFなどのboolean状態を反転させる操作に使用します。`value` には現在の状態を返す関数を渡し、操作後は反転した値が `onChange` へ通知されます。
- **数値調整（stepper）**: ブラシの半径やエフェクトの強度など、段階的に数値を増減させる操作に適しています。`min` / `max` に許容範囲、`step` に増減量を指定します。`input: true` を追加すると、数値入力欄が表示され、キーボードによる直接入力も可能になります。
- **選択（select）**: ブラシの種類や表示モードなど、あらかじめ決めた候補から1つを切り替える操作に使用します。`value` に現在値を返す関数を渡し、`options` に `{ value, label }` の配列を指定します。ボタンを押すたびに次の候補へ進み、選ばれた値が `onChange` へ通知されます。

`toggle`、`stepper`、`select` の `value` には通常、アプリケーションが持つ現在値を返す関数を指定します。
操作時は共通の `onChange` または個別の `onChange` で状態を更新します。

また、複数のボタンから1つのモードを選ぶ場合は、`modeSwitch: true` と `getCommandState()` を組み合わせます。
`modeSwitch` で色の種類を指定し、`getCommandState()` でどのボタンをactiveにするかを決定します。

```js
const state = { mode: "object" };

const palette = new CommandPalette({
  document,
  container: document.body,
  viewport: canvas,
  className: "command-palette surface",
  closeOnCommand: false,
  getCommandState: (id) => ({
    active: id === `mode-${state.mode}`
  }),
  onCommand: (id) => {
    if (id === "mode-object") state.mode = "object";
    if (id === "mode-edit") state.mode = "edit";
  },
  commands: [
    { id: "mode-object", label: "Obj", detail: "mode", modeSwitch: true },
    { id: "mode-edit", label: "Edit", detail: "mode", modeSwitch: true }
  ]
});
```

`closeOnCommand` の既定値は `true` です。
単発コマンドであれば操作後に閉じるのが自然ですが、複数の設定を続けて変更させるパレットでは `false` を指定します。

### ページ構成とスタイルのカスタマイズ

`pageRows` は1ページの高さを行数で指定します。
ボタンと切り替えは1セル、段階変更と 選択は1行全体を使用します。
`pageRowsByPage` を指定すると、ページ番号ごとに行数を上書きできます。
ページは表示枚数に応じて自動的に作成されますが、ページ移動の基本はアプリケーション側が明示する `id: "palette-next"` のボタンです。
複数ページのパレットでは、利用者が次ページへ進めるよう、原則として各ページのコマンド定義へ `palette-next` を含めてください。

```js
const palette = new CommandPalette({
  document,
  container: document.body,
  viewport: canvas,
  className: "command-palette surface",
  pageRows: 2,
  pageRowsByPage: [2, 1],
  commands: [
    { id: "select", label: "Sel", detail: "tool" },
    { id: "move", label: "Move", detail: "tool" },
    { id: "rotate", label: "Rot", detail: "tool" },
    { id: "scale", label: "Scale", detail: "tool" },
    { id: "brush", label: "Brush", detail: "tool" },
    { id: "erase", label: "Erase", detail: "tool" },
    { id: "snap", label: "Snap", detail: "toggle" },
    { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },

    { id: "view-front", label: "Front", detail: "view" },
    { id: "view-top", label: "Top", detail: "view" },
    { id: "view-side", label: "Side", detail: "view" },
    { id: "palette-next", label: "Next", detail: "page", pageSwitch: true }
  ]
});
```

`palette-next` は `nextPage()` を呼ぶ特別なIDで、最終ページの次は先頭に戻ります。
`pageSwitch: true` はページ切り替え用ボタンの配色を適用する指定です。

そのうえで、現在の `CommandPalette` には補助的な既定動作もあります。
`titleTapCyclesPage` の既定値は `true` であり、タイトル行をタップまたはクリックするとページが循環します。
また、再表示時は `resetPageOnOpen` の既定値が `true` であるため、毎回1ページ目から開きます。
さらに、複数ページがあり、現在ページに `palette-next` が無く、かつ空き枠が残っている場合には、内部で `Next` ボタンを補ってページ移動できるようにしています。
ただし、これは移動不能を避けるための補助であり、レイアウトと操作の意図を利用者へ明確に伝えるには、やはり `palette-next` を各ページへ明示的に置く構成が基本です。

`CommandPalette` は既定のスタイルを自動的に注入しますが、`setStyle()` でCSS全体を差し替えたり、`setTheme()` で色を変更したりできます。
既定のレイアウトを維持しつつ一部だけ変更したい場合は、`getDefaultCommandPaletteCss()` の後ろに独自の規則を連結してください。

```js
const compactPaletteCss = `${getDefaultCommandPaletteCss()}
.command-palette {
  width: 300px;
}

.palette-button,
.palette-control-button,
.palette-select-button {
  border-radius: 6px;
}

.palette-button {
  height: 42px;
}
`;

palette.setStyle(compactPaletteCss);
```

パレットが不要になった場合は、イベントの解除とDOMの削除をまとめて行う `destroy()` を呼び出して適切に後始末を行ってください。

```js
window.addEventListener("pagehide", () => {
  palette.destroy();
}, { once: true });
```

## TextとMessageの階層構造と描画

`Text` は、文字グリッドをGPU上に描画するための低水準なクラスです。
文字位置、文字コード、スケール、色、フォントテクスチャなどを管理し、最終的に文字ごとのクアッド（四角形ポリゴン）として画面に描画します。

`Message` は、この `Text` クラスをラップしてHUDとして使いやすくした高水準な管理層です。
文字列を `id` 付きのブロックとして登録し、`anchor` や `width` を指定することで容易に配置できます。

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

`Message` は `setLine()`（単一行）、`setLines()`（複数行）、`setBlock()`（明示的なブロック管理）というインターフェースを提供しています。
最大の利点は、表示内容を `id` で更新できる点にあります。
毎フレームすべてを再構築するのではなく、特定の `id` を持つブロックだけを更新することで、スコアやガイドなどの異なる情報を効率的に管理できます。

### HUDの描画タイミング

`WebgApp` を使用する場合、通常は `app.start()` の描画ループ内でシーンの描画とHUDの描画がまとめて処理されます。
アプリケーション側は `onUpdate` ハンドラ内で `app.message.setLines()` を呼び出し、最新の状態を登録します。

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

この時点では内部的なデータとして登録しているだけであり、実際の描画は `WebgApp` 内部の `drawMessages()` メソッドを通じて、シーン描画後の最終工程として重ねられます。
「HUDはキャンバスの一部として描画される」という特性を理解しておくことで、DOMオーバーレイとの使い分けがより明確になります。

## OverlayPanelの構造と動作

`OverlayPanel` はDOM要素で構成されており、概念的には以下のような階層構造を持っています。

```text
root (オーバーレイ全体の基準)
  backdrop (背景遮蔽層)
  shell (配置制御層：anchor に従って配置)
    panel (パネル本体)
      header (ヘッダー：タイトル、閉じる/畳むボタン)
      body (本文：text または lines)
      choices (選択肢領域)
      buttons (操作ボタン領域)
```

通常は `WebgApp` の管理メソッドを介して操作します。
同一の `id` で `showOverlayPanel()` を呼び出すと既存のパネルが更新され、一部のみを更新したい場合は `updateOverlayPanel()` を使用します。

### 本文の指定とフォーマット

本文は単一文字列の `text` または文字列配列の `lines` で指定します。
これらを同時に指定することはできません。
これは、更新時の意図しないデータの持ち越しを防ぎ、コードの可読性と安全性を高めるための設計です。
表示形式は `format` オプションで切り替えます。

- `format: "plain"`: 一般的な説明文向け。改行を保持しつつ適切に折り返します。
- `format: "pre"`: ログやエラーメッセージなど、空白や改行の書式を厳密に保持したい文章に使用します。

長文を扱う場合は `scrollY: true` と `maxHeight` を組み合わせることで、本文領域のみをスクロールさせ、画面全体を覆い尽くさないように制御できます。

### 配置制御とレイアウトモード

`OverlayPanel` は `anchor`（基準点）に基づいて配置されます。
アンカーは9方向から選択可能です。
また、配置モードとして `positioningMode` が存在します。
通常のフルスクリーンアプリでは `fixed` が使用されますが、教材ページなどにキャンバスを埋め込む `layoutMode: "embedded"` では、オーバーレイコンテナをキャンバスホストに関連付けるため `absolute` が使用されます。
`WebgApp` を介して呼び出すことで、現在のレイアウト設定に応じた最適なモードが自動的に適用されます。

### パネルの操作性とインタラクション

ヘルプパネルのように、完全に消去せず本文だけを畳んで最小限のボタンとして残したい場合は `collapsible` オプションを使用します。
一方で、閲覧を終了してパネルを完全に破棄したい場合は `closable` と `showCloseButton` を使用します。

また、パネル下部には操作ボタン (`buttons`) や選択肢 (`choices`) を配置できます。
これらが押下されると、`onAction` ハンドラに `actionId` が返されます。

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

`buttons` はパネル全体に対する操作（保存・キャンセルなど）、`choices` は本文に対する選択肢（ルート選択など）という意味づけで使い分けるのが適切です。
実装上はいずれも `actionId` を返すため、アプリケーション側では同一の入口で処理可能です。

### モーダル設定とシーン停止の連携

`modal: true` を設定すると、背後のDOM操作を受け付けず、ユーザーの意識をパネルに集中させることができます。
また、`pauseScene: true` は、アプリケーション側に「このパネルが表示されている間はシーンの進行を停止すべきである」という状態を伝えるフラグです。
重要な点として、`OverlayPanel` 自体が自動的にゲームループを停止させることはありません。

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

この分離により、UI部品が勝手にゲーム時間を止めるという副作用を避け、停止のタイミングをアプリケーション側の設計判断に委ねることができます。

## WebgAppによる統合管理

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

`WebgApp` はあえて「ヘルプ専用」などの個別APIを持たず、汎用的な管理機能に特化しています。
これにより、個別のアプリケーションが持つ多様な進行UIを柔軟に実装することが可能です。
定型的なオプションが必要な場合は、`OverlayPanelPresets.js` を活用してください。

### テーマ適用とデバッグドックの回避

DOMオーバーレイの視覚スタイルは `WebgUiTheme` で管理されます。
`WebgApp.setUiTheme()` を呼び出すことで、`DebugDock` およびすべての `OverlayPanel` にテーマが反映されます。

また、右側に固定表示される `DebugDock` とパネルが重ならないよう、`avoidDebugDock` オプションが用意されています。
これを有効にすると、現在のドックオフセットを自動的に取得し、右寄せパネルを適切に内側へ寄せます。

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

`DebugDock` はあくまで開発者向けの調査領域です。
一般利用者が閲覧する説明は `OverlayPanel`、開発中の内部状態確認は `DebugDock` と明確に使い分けてください。

### 埋め込みレイアウトへの対応

`WebgApp` は、フルスクリーンアプリだけでなく、教材ページ等にキャンバスを埋め込む `layoutMode: "embedded"` にも対応しています。
埋め込みモードでは、キャンバスがHTML文書の中間に配置されるため、ページ全体をスクロールすると、ビューポート固定のオーバーレイはキャンバスから離れて見えてしまいます。

これを解決するため、`WebgApp` は埋め込みモード時にオーバーレイコンテナをキャンバスホストに同期させます。
`OverlayPanel` はこのコンテナを基準に `absolute` 配置されるため、ページをスクロールしても常にキャンバスと共に移動します。

この挙動は `unittest/embedded` で確認でき、ホスト、キャンバス、各種パネル、タッチコントロールの表示領域（矩形）に差異がないかを毎フレーム検証しています。

## 実装例：複合的なUI構成

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

情報の性質に応じて「`Message`（状態）」「`OverlayPanel` プリセット（ヘルプ）」「`format: "pre"`（レポート）」「カスタム関数（ブリーフィング）」と使い分けています。
表示経路を分離することで、規模が拡大しても管理しやすい構成となります。

## 検証と実装チェックリスト

UI系の変更を行った際は、以下のユニットテストとサンプルを確認することで意図した動作を検証できます。

- **OverlayPanelの基本動作**: `unittest/overlay_panel` でアンカー、pre形式、ボタン、モーダル等の動作を確認。
- **埋め込みレイアウト**: `unittest/embedded` で埋め込み時の配置追従を確認。
- **テーマ適用**: `unittest/theme` で `setUiTheme()` による切り替えを確認。
- **Messageの基本動作**: `unittest/message` で確認。
- **タッチ入力**: `unittest/touch` で `Touch` による入力代替動作を確認。
- **CommandPaletteの詳細**: `samples/com_palette` で行数に応じたページ分割、Mode Switchのactive表示、数値の直接入力、ダブルクリックとダブルタップによる起動を確認。

特に `unittest/overlay_panel` は、本章で解説したUI設計の核心部分を網羅しており、9方向のアンカーやモーダル動作、アクション返却などを一画面で確認できるため、開発時の参照を推奨します。

DOMオーバーレイを実装する際は、以下のチェックリストを活用してください。

- **IDの一意性**: パネルIDやアクションIDが重複していないか。
- **指定の排他性**: `text` と `lines` を同時に指定していないか。
- **表示面の選択**: 日本語や長文を `Message` に入れていないか。
- **可読性の確保**: 長文の場合、`scrollY` と `maxHeight` を適切に指定しているか。
- **視認性の配慮**: シーン中央を遮らない適切な `anchor` を選択しているか。
- **ドック回避**: 右寄せパネルで `avoidDebugDock` を考慮しているか。
- **アクションIDの一意性**: ボタンや選択肢の `id` が重複していないか。
- **進行停止の必要性**: `modal: true` のパネルで、アプリ側が `pauseScene` を参照して更新を止める必要があるか。
- **役割の分離**: 会話やブリーフィングの進行ロジックを `OverlayPanel` 自体に組み込んでいないか。
- **記録の優先**: 開発者や解析ツールに渡す情報は `Diagnostics` レポートとして保存しているか。
- **状態の参照と更新**: `CommandPalette` の `value` がアプリケーションの現在値を読み、コールバックがその状態を更新する構成になっているか。
- **操作の選択**: 単発操作、ON/OFF、数値変更、候補切り替えに、ボタン、切り替え、段階変更、選択を正しく使い分けているか。
- **ページ移動**: 複数ページが作られる場合、基本の操作として `palette-next` を各ページへ置いているか。title tapの循環や暗黙 `Next` 補完に頼る場合も、利用者がページ構造を理解しやすいかを確認する。
- **後始末**: 画面を破棄するときに `CommandPalette.destroy()` を呼び、キャンバスとdocumentのイベントを解除しているか。

## まとめ

本章では、`webg` におけるHUDとオーバーレイの内部構造について解説しました。

`Message`は`Text`クラスを基盤としたキャンバスHUDであり、短い英数字と記号による軽量な状態表示に適しています。
一方、`OverlayPanel`はDOMを使うオーバーレイであり、日本語、長文、ボタン、選択肢、スクロールなどを柔軟に扱います。
`CommandPalette`もDOMオーバーレイですが、読ませる情報ではなく、必要なときだけ開くコマンドと簡単な設定の操作面を担当します。

この分担は、`WebgApp` の汎用性を保つための判断軸です。
短いHUDには `Message`、読むパネルには `OverlayPanel` を使います。
一時的な操作には `CommandPalette`、記録には `Diagnostics` または `DebugDock` を使います。

次章では、UIの中でも特に入力に関わる `Touch` と `InputController` を扱い、画面上のボタンをどのようにキー入力へ接続し、アプリケーションを操作させるかについて詳しく見ていきましょう。
