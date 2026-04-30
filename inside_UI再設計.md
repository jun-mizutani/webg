# inside_UI再設計

最終更新: 2026-04-30

## 2026-04-30 利用者コメント 1

> bookの14章と15章がわかりにくい原因が、開発者の私自身がwebgの開発過程で迷っていた状態がそのまま出てきていると考えている。
> 最初はアーケードゲームのように3Dシーンに重なる文字表示を意識して、汎用的に使えそうな文字端末と同じように Font.jsとText.jsを高速に動作することを目指して作成しました。汎用的に使えると思ったが、あなたはIDで管理できるMessage.jsを提案してきた。操作説明、ステータス表示、エラーメッセージなどの短時間表示する仕組み、デバッグ情報の表示に使った。しかし画面内に文字情報が多くなって表示しきれなくなる上に、デバッグ情報を記録したりAIに伝えることが困難となった。多くのステータスやデバッグ情報を記録したりAIに伝えるためにDebugDockを追加して、非常に有用なことが確認できた。その後に画面に操作方法を表示するための HelpPanel も画面にじゃまにならないように隠す(縮小)ことができるようにしたことで、これの有用性も確認できた。さて、それ以外のダイアログの使い分けや有用性がはっきりしないため、14章と15章のわかりにくさの原因になっていると考える。 HUD、DebugDock、タッチボタンははっきり説明可能なので問題ないが、それ以外の文字表示系UIの設計を再検討したい。その後で14章と15章の書き換えをしたい。

## 2026-04-30 利用者コメント 2

> HelpPanel を３Dシーンのどこに置くとじゃまにならないかという観点で再検討したく、上下左右のいち指定が欲しい。
> シーンに重ねるメッセージパネルは必要だが、DialogueOverlay、FixedFormatPanel、UIPanelと分ける必要はない。例えば整形済み(<pre>)にするかしないか、スクロールを許すか、ボタンで待つか、どこに表示するか、といった観点でアプリごとに定義すれば良く、名前の異なるクラスに「長文やログや説明を落ち着いて読むパネル」といった抽象的な使い分けはユーザにも読者にも伝わらない。既存の文字表示系UIをクラス名も含めて全面的に書き換える方向で考えている

## 現状整理

### わかりにくさの主因

現状の 14 章と 15 章がわかりにくい主因は、文字表示系 UI が役割ではなく開発履歴に沿って増えていることにある

`Text` と `Message` は canvas HUD であり、`DebugDock` は開発記録用、`Touch` は入力 UI なので比較的説明しやすい。一方で `HelpPanel`、`DialogueOverlay`、`FixedFormatPanel`、`UIPanel` は、いずれも DOM を使ってシーン上またはその周辺へ情報を重ねる UI でありながら、クラス名ごとに説明理由が分かれている。その結果、読者は「どの見た目・挙動を選ぶべきか」ではなく「どの名前のクラスを覚えるべきか」を先に要求される

### 現在の実装上の問題

- `HelpPanel` の位置指定は `top` / `left` / `right` だけで、`bottom` がない
- `DialogueOverlay` も `top` / `left` / `right` が中心で、下側へ逃がす設計が弱い
- `FixedFormatPanel` も上寄せ前提で、配置の観点が狭い
- `UIPanel` は汎用 DOM 部品だが、公開 API として前面に出ることで、読者に内部構造を意識させやすい
- `DialogueOverlay` には表示部と進行制御部が混ざっている
- `showErrorPanel()` は `FixedFormatPanel` の用途特化に見えるが、利用者視点では「エラー表示設定付きのメッセージパネル」で十分に理解できる

## 再設計の基本方針

### 方針 1: DOM の文字表示は 1 つの基盤へ統合する

`DialogueOverlay`、`FixedFormatPanel`、`UIPanel`、`HelpPanel` は公開 API としては廃止し、DOM 上の文字表示と簡単な操作を扱う基盤を 1 つだけ公開する

この基盤は仮に `OverlayPanel` と呼ぶ。ここでの名前は「シーン上に重なるパネル」であることだけを表し、説明、ログ、エラー、会話といった用途は option で決める

### 方針 2: 使い分けはクラス名ではなく option で決める

利用者が判断する軸は次のような具体的な属性に限定する

- どこに表示するか
- 長文を許すか
- `pre` 表示にするか
- スクロールを許すか
- ボタン入力待ちにするか
- scene の進行を止めるか
- 折りたたみ可能にするか
- 選択肢を出すか
- close ボタンや restart ボタンを出すか

### 方針 3: 表示部と進行制御部を分離する

`DialogueOverlay` が持っている queue、next、choice、restart のような機能は、パネル描画そのものとは切り分ける

`OverlayPanel` はあくまで表示部と簡単な button dispatch を担当し、会話や briefing の進行制御は必要なら別 controller で扱う

### 方針 4: 14 章と 15 章の説明も同じ考え方へ揃える

14 章では「何を表示したいか」から option を選ぶ説明にし、15 章では `OverlayPanel` と canvas HUD の実装を説明する。クラス名ベースの抽象分類は避ける

## 2026-04-30 実施判断

### core から削除するもの

`OverlayPanel` を追加したあとも `DialogueOverlay.js`、`UIPanel.js`、`FixedFormatPanel.js` が core に残っていると、利用者と読者は依然として「どのクラスを使い分けるか」を考えさせられる

そのため、core から次の module を削除する

- `webg/DialogueOverlay.js`
- `webg/UIPanel.js`
- `webg/FixedFormatPanel.js`

### core に残すもの

core に残すのは `OverlayPanel` と、その facade を持つ `WebgApp` だけにする

この時点では、`WebgApp.startDialogue()` / `nextDialogue()` / `chooseDialogue()` / `logDialogue()` / `getDialogueState()` のような会話専用 facade も残さない

理由は、文字表示系 API を整理する目的から見ると、class 名を減らしても `WebgApp` 自体が会話専用 API を持ち続けると、利用者は再び「会話は特別な高レベル機能」と受け取りやすくなるためである

tilemap 系 sample が一時的に壊れても、会話進行は sample / unittest 側の local helper として `OverlayPanel` から組み立てる方向へ寄せる

### unittest の扱い

`unittest/dialogue` は削除する

会話表示の確認は、今後は個別 sample 側の local 実装や `OverlayPanel` を使った実例の中で確認する方針とする。専用 unittest を残すと、再び Dialogue 専用部品を core 標準として誤認しやすいためである

### 既存 sample の扱い

`samples/scene` や `unittest/theme` のように `UIPanel` を直接 import していた実行コードは、`OverlayPanel` ベースへ書き換える

`tile_sim` のように会話進行を強く使う sample は、一時的な破損を許容したうえで、最終的には sample 側 local 実装へ追い出す対象として扱う

## 新しい公開 API 案

### 1. `OverlayPanel`

DOM ベースの文字表示と簡単なボタン操作を扱う唯一の公開クラス

```js
const panel = new OverlayPanel({
  document,
  theme,
  containerElement,
  viewportElement,
  positioningMode: "fixed"
});
```

### 2. `WebgApp` からの高レイヤー入口

通常利用者は `OverlayPanel` を直接 new せず、`WebgApp` の facade を使う

```js
const panel = app.createOverlayPanel(options);
app.showOverlayPanel(options);
app.updateOverlayPanel(panelId, patch);
app.hideOverlayPanel(panelId);
app.removeOverlayPanel(panelId);
app.clearOverlayPanels();
```

ここでは既存 API を温存しない。`createHelpPanel()`、`startDialogue()`、`showFixedFormatPanel()`、`showErrorPanel()`、`clearDialogue()`、`clearHelpPanel()` などは削除対象とする

## `OverlayPanel` の仕様

### 1. 基本 option

```js
{
  id: "help",
  title: "Help",
  text: "Drag: orbit camera\\nH: hide help",
  format: "plain",
  visible: true
}
```

#### 必須ではないが中心になるプロパティ

- `id`
  パネル識別子
- `title`
  見出し
- `text`
  本文文字列
- `lines`
  `text` の代わりに行配列で渡す入口
- `format`
  `"plain"` または `"pre"`
- `visible`
  初期表示状態

`text` と `lines` の両方が指定された場合はエラーにする。暗黙結合はしない

### 2. 配置 option

```js
{
  anchor: "top-left",
  offsetX: 16,
  offsetY: 16,
  width: 320,
  minWidth: 200,
  maxWidth: 420,
  maxHeight: "40vh",
  positioningMode: "fixed",
  avoidDebugDock: true,
  containerElement,
  viewportElement
}
```

#### `anchor`

次の 9 種を標準とする

- `top-left`
- `top-center`
- `top-right`
- `middle-left`
- `middle-center`
- `middle-right`
- `bottom-left`
- `bottom-center`
- `bottom-right`

#### 配置ルール

- `anchor` を基準に root を置き、`offsetX` / `offsetY` で微調整する
- `avoidDebugDock: true` のときは、右側配置で dock 分の回避余白を加える
- `positioningMode` は `"fixed"` または `"absolute"` に限定する
- `top` / `left` / `right` / `bottom` の個別指定は公開 API から外し、内部実装用に限定する

### 3. 表示整形 option

```js
{
  format: "plain",
  scrollY: false,
  scrollX: false,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  font: "14px/1.5 sans-serif"
}
```

#### 意味

- `format: "plain"`
  通常の説明文向け。`whiteSpace: pre-wrap`
- `format: "pre"`
  ログ、エラー、整形済み表示向け。既定フォントは monospace
- `scrollY`
  縦スクロールを許すか
- `scrollX`
  横スクロールを許すか
- `overflow`
  明示したい場合だけ指定

`format` と `whiteSpace` が矛盾する指定はエラーにする。暗黙補正はしない

### 4. 操作 option

```js
{
  closable: true,
  collapsible: true,
  collapsed: false,
  showCloseButton: true,
  showCollapseButton: true,
  closeOnEsc: true
}
```

#### 意味

- `closable`
  完全に閉じられる
- `collapsible`
  本文だけ畳める
- `collapsed`
  初期状態
- `closeOnEsc`
  Esc で閉じる

HelpPanel はこの option 群を preset 化したものとして表現する

### 5. ボタン待ち・選択肢 option

```js
{
  modal: true,
  pauseScene: true,
  buttons: [
    { id: "next", label: "Next", kind: "primary" },
    { id: "close", label: "Close", kind: "secondary" }
  ],
  choices: [
    { id: "left", label: "左へ行く" },
    { id: "right", label: "右へ行く" }
  ],
  defaultAction: "next"
}
```

#### 意味

- `modal`
  scene 上の他操作を受け付けない
- `pauseScene`
  アプリ更新側がこの値を見て進行停止できるようにする
- `buttons`
  下部ボタン列
- `choices`
  本文内または下部に並べる選択肢
- `defaultAction`
  Enter などで発火する既定操作

ここでは queue や branching を内蔵しない。押された結果を application 側へ返し、進行制御は controller に任せる

### 6. イベント

```js
{
  onAction: ({ panelId, actionId }) => {},
  onOpen: ({ panelId }) => {},
  onClose: ({ panelId }) => {},
  onCollapse: ({ panelId, collapsed }) => {}
}
```

button、choice、close、collapse はすべて `actionId` ベースで返す

## `WebgApp` facade の仕様

### 基本メソッド

```js
const panel = app.showOverlayPanel({
  id: "runtime-help",
  title: "Help",
  lines: [
    "Drag: orbit camera",
    "1 / 3 / 7: fixed view",
    "H: hide help"
  ],
  anchor: "top-left",
  collapsible: true,
  collapsed: false
});

app.updateOverlayPanel("runtime-help", {
  anchor: "bottom-left"
});

app.hideOverlayPanel("runtime-help");
app.removeOverlayPanel("runtime-help");
```

### 返り値と状態参照

```js
app.getOverlayPanel("runtime-help");
app.hasOverlayPanel("runtime-help");
app.listOverlayPanels();
```

### panel preset helper

公開 API として専用クラスは作らないが、option を組み立てる helper 関数はあってよい

```js
const helpPanelOptions = app.buildHelpPanelOptions({
  id: "help",
  lines: ["Drag: orbit", "H: hide"],
  anchor: "top-left"
});

const errorPanelOptions = app.buildErrorPanelOptions(error, {
  id: "load-error",
  anchor: "bottom-right"
});
```

ただしこれは helper であり、概念上の別 UI クラスではない

## 内部実装方針

### 残すもの

- canvas HUD 系の `Font` / `Text` / `Message`
- `DebugDock`
- `Touch`

### 削除対象

- `DialogueOverlay.js`
- `FixedFormatPanel.js`
- `UIPanel.js` の公開 API
- `WebgApp.createHelpPanel()`
- `WebgApp.startDialogue()` / `nextDialogue()` / `chooseDialogue()` / `clearDialogue()`
- `WebgApp.showFixedFormatPanel()` / `showErrorPanel()`

`UIPanel.js` は必要なら内部 utility として吸収し、公開 API から外す

### 新規構成案

- `webg/OverlayPanel.js`
  DOM パネル表示基盤
- `webg/OverlayPanelTheme.js`
  必要なら theme 切り出し
- `webg/WebgApp.js`
  overlay panel 管理 facade
- `webg/PanelFlowController.js`
  必要になったときだけ追加する進行制御 helper

最初の段階では `PanelFlowController.js` を作らず、app 側または sample 側でボタン結果を受けて進行してもよい

## preset の例

### 1. Help

```js
app.showOverlayPanel({
  id: "help",
  title: "Help",
  lines: [
    "Drag: orbit camera",
    "Wheel: zoom",
    "H: hide help"
  ],
  anchor: "top-left",
  collapsible: true,
  closable: false,
  format: "plain",
  scrollY: false,
  pauseScene: false
});
```

### 2. Error

```js
app.showOverlayPanel({
  id: "load-error",
  title: "scene load failed",
  text: `${error.message}`,
  anchor: "bottom-right",
  format: "pre",
  scrollY: true,
  closable: true,
  pauseScene: true,
  modal: true
});
```

### 3. Report / Dialogue

```js
app.showOverlayPanel({
  id: "briefing",
  title: "Mission Briefing",
  lines: [
    "Alpha が beacon を回収し、goal へ向かいます",
    "Bravo は後方を支援します"
  ],
  anchor: "bottom-left",
  format: "plain",
  scrollY: true,
  modal: true,
  pauseScene: true,
  buttons: [
    { id: "next", label: "Next", kind: "primary" }
  ],
  choices: [
    { id: "accept", label: "開始する" },
    { id: "review", label: "操作説明を見る" }
  ]
});
```

## バリデーション方針

- `text` と `lines` の同時指定はエラー
- `anchor` は列挙値限定
- `offsetX` / `offsetY` / `width` / `minWidth` / `maxWidth` は有限数のみ許可
- `minWidth > maxWidth` はエラー
- `format` は `"plain"` / `"pre"` のみ
- `buttons` / `choices` の `id` は panel 内で重複禁止
- `modal: true` かつ `pauseScene: false` のような矛盾はエラー候補
- 自動補正やサイレントフォールバックは行わない

既存方針に従い、数値や文字列の検証は `util.readFiniteNumber`、`util.readOptionalString`、`util.readOptionalBoolean` など既存 helper を優先して使う

## 実装順

1. `OverlayPanel` の option 仕様を固定する
2. anchor ベースの配置と `bottom-*` 系配置を実装する
3. 折りたたみ、close、button dispatch、scroll を実装する
4. `WebgApp` facade を追加する
5. 既存 sample / unittest を新 API へ一括置換する
6. `DialogueOverlay`、`FixedFormatPanel`、`UIPanel`、HelpPanel 系 API を削除する
7. 14 章と 15 章を新 API 前提で全面改稿する

## 文書改訂時の説明方針

### 14 章

14 章は「どのクラスがあるか」ではなく、「表示したい情報に対してどの option を選ぶか」を説明する章にする

- 短い HUD は canvas HUD
- 日本語や長文は `OverlayPanel`
- 操作停止を伴う説明も `OverlayPanel`
- ログやエラーも `OverlayPanel`
- 調査記録は `DebugDock` と diagnostics

### 15 章

15 章は `OverlayPanel` と canvas HUD の内部構造を扱う章にする

- canvas HUD が GPU 上でどう描かれるか
- DOM panel が anchor と offset でどう置かれるか
- なぜ `pre`、scroll、collapse、buttons を option で持つのか
- どの機能を sample 側で組み合わせると help、report、error になるか

## 保留事項

- `OverlayPanel` に side pane を残すかどうか
- `choices` の表示場所を本文直下にするか footer にするか
- `pauseScene` を app が自動処理するか、sample 側が参照するだけにするか
- theme を `WebgUiTheme` に統合したままにするか、新 theme 節を作るか
- `DebugDock` が表示中のとき右側 anchor の panel をどう回避するか

現時点では、まず単一パネル基盤へ統合することが主目的であり、複雑な 2 カラム表示や会話履歴保持は二段階目として扱うのが妥当と考える
