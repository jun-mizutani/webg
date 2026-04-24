# WebgAppによるアプリ構成

`WebgApp` は、`webg` で 3D アプリケーションを組み立てるときの標準的な入口です。`Screen`、`Space`、シェーダー、camera rig、入力、HUD、ダイアログ、デバッグ表示、diagnostics など、ほとんどのアプリで毎回必要になる土台をまとめて初期化し、開発者がアプリ固有の処理へ集中できるように設計されています。単にコード量を減らすための便利関数ではなく、「3D アプリの骨格を毎回同じ順序で立ち上げる」ためのフレームワークとして理解するのが適切です。

本章では、`WebgApp` を使うと何が省略されるのか、どこまでが 3D 表現そのものの本質で、どこからが定型処理なのかを整理しながら解説します。第3章と第4章で扱ったローレベルな構成を踏まえた上で、`WebgApp` がどの処理を肩代わりし、利用者はどこへ自分の処理を書けばよいのかを順を追って確認します。視点ノードの詳細や `EyeRig` の考え方は第6章「カメラ制御とEyeRig」で詳しく扱うため、本章ではアプリ構成の観点から必要な範囲に絞って説明します。

本章の目的は、`WebgApp` のメソッド名を個別に暗記することではありません。`init()` の前後でどの状態がそろうのか、`start()` の中でどの順序で処理が進むのか、そして HUD、help panel、dialogue、diagnostics をどう使い分けるのかを理解し、「自分のアプリをどこへ差し込めば自然に動くか」を判断できるようになることにあります。

## WebgAppが引き受ける役割

`webg` のローレベル API では、利用者が次のような部品を順番に生成して接続します。

- `Screen`: canvas と WebGPU の準備
- `Shape`: 形状と材質
- `Node`: 位置、回転、スケールと `Shape` の保持
- `Space`: シーン全体の管理
- `eye`: 視点
- shader / projection matrix: 3D 空間を 2D 画面へ投影するための計算

この流れは 3D 描画の理解には重要ですが、実際にアプリを作るたびに同じ初期化を繰り返すのは大きな負担になります。`WebgApp` は、ここに HUD、入力、debug dock、fixed format panel、dialogue、asset loader、スクリーンショット、scene phase 管理といった実用的な機能も加えたうえで、標準的なアプリ構成をまとめて立ち上げます。

![WebgApp 全体構成図](fig05_01_webgapp_overview.jpg)

*WebgApp は、描画、シーン管理、視点、入力、UI、diagnostics をまとめて初期化し、3D アプリケーションの骨格を一定の形でそろえます*

ここで重要なのは、`WebgApp` が 3D の仕組みを隠しているわけではないという点です。`Shape` を `Node` に載せて `Space` に入れ、`eye` から描画するという基本構造は変わりません。`WebgApp` は、その構造を壊さずに、毎回ほぼ同じになる初期化と接続を共通化しています。

## 3Dアプリの基本構造をもう一度整理する

`WebgApp` を理解するためには、3D シーンの構成要素を簡潔に言い直せることが大切です。

- `Shape`: 何を描くか
- `Node`: どこに置くか
- `Space`: 全体をどう管理するか
- `eye`: どこから見るか

3D 描画の基本は、結局のところ「何を置くか」「どこへ置くか」「どこから見るか」に集約されます。立方体を 1 個置いて回すだけのサンプルでも、`Shape` だけでは表示されません。`Node` にアタッチし、`Space` に登録し、`eye` を通じて描画して初めて画面に現れます。この関係を理解しておくと、`WebgApp` を使っても「何が自動化され、何が利用者の責任として残るのか」を見失いにくくなります。

`webg` の座標系は右手座標系で、`+X=右`、`+Y=上`、`+Z=前` です。回転には `head / pitch / bank` を使い、一般的な `yaw / pitch / roll` に対応します。`WebgApp` もこの語彙で camera や follow 設定を扱うため、書籍全体でも `head` を基準に読むようにしてください。

## ローレベルな最小構成を確認する

まずは `WebgApp` を使わずに、必要な部品を個別に組み立てる最小例を見ておきます。これは第4章までの内容の復習でもあり、後で `WebgApp` が何を省略しているかを比較する基準にもなります。

```js
import Screen from "./webg/Screen.js";
import Space from "./webg/Space.js";
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";
import SmoothShader from "./webg/SmoothShader.js";
import Matrix from "./webg/Matrix.js";

const screen = new Screen(document);
await screen.ready;
screen.setClearColor([0.1, 0.15, 0.1, 1.0]);

const shader = new SmoothShader(screen.getGL());
await shader.init();

const projection = new Matrix();
const applyViewportLayout = () => {
  screen.resize(
    Math.max(1, Math.floor(window.innerWidth)),
    Math.max(1, Math.floor(window.innerHeight))
  );
  projection.makeProjectionMatrix(
    0.1,
    1000.0,
    screen.getRecommendedFov(55.0),
    screen.getAspect()
  );
  shader.setProjectionMatrix(projection);
};
applyViewportLayout();
window.addEventListener("resize", applyViewportLayout);
window.addEventListener("orientationchange", applyViewportLayout);

shader.setLightPosition([120.0, 180.0, 140.0, 1.0]);

const space = new Space();

const eye = space.addNode(null, "eye");
eye.setPosition(0.0, 0.0, 10.0);
space.setEye(eye);

const shape = new Shape(screen.getGL());
shape.setShader(shader);
shape.applyPrimitiveAsset(Primitive.cube(2.0, shape.getPrimitiveOptions()));
shape.endShape();
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0],
  ambient: 0.18,
  specular: 0.90,
  power: 40.0
});

const box = space.addNode(null, "box");
box.setPosition(0.0, 0.0, 0.0);
box.addShape(shape);

const loop = () => {
  box.rotateY(0.8);
  box.rotateX(0.3);
  screen.clear();
  space.draw(eye);
  screen.present();
  requestAnimationFrame(loop);
};
loop();
```

このコードでは、画面サイズ変更時の投影行列更新、`Screen` の生成、シェーダー準備、`Space` と `eye` の用意、そして毎フレームの `clear -> draw -> present` まで、利用者がすべて自分で管理しています。これはローレベル API を理解するために非常に重要ですが、実際のアプリでは毎回書きたくない部分でもあります。

## 同じ内容をWebgAppで書く

次に、同じ題材を `WebgApp` で書き直します。`book/examples/05_02.html` でもそのまま確認できます。

```js
import WebgApp from "./webg/WebgApp.js";
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";

const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    head: 0.0,
    pitch: 0.0
  }
});

await app.init();

const shape = new Shape(app.getGL());
shape.applyPrimitiveAsset(Primitive.cube(2.0, shape.getPrimitiveOptions()));
shape.endShape();
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});

const box = app.space.addNode(null, "box");
box.addShape(shape);

app.start({
  onUpdate() {
    box.rotateY(0.8);
    box.rotateX(0.4);
  }
});
```

利用者が書いているのは、形状生成、`Node` の配置、そして `onUpdate()` のロジックだけです。`WebgApp` は次のような定型処理を引き受けます。

- `Screen` の作成と WebGPU の準備
- 既定シェーダーの初期化
- `Space` の作成
- camera rig (`cameraRig -> cameraRod -> eye`) の構築
- 投影行列とビューポート更新
- 光源とフォグの適用
- `InputController` と touch の初期化
- message/HUD、debug dock、fixed format panel の準備
- diagnostics の初期化
- `requestAnimationFrame` ループの管理

これにより、利用者は「何を作るか」と「毎フレーム何をしたいか」に集中しやすくなります。

## WebgAppのライフサイクル

`WebgApp` を使うときは、次の 3 段階で考えると分かりやすくなります。

1. コンストラクタで初期設定を渡す
2. `await app.init()` で土台を作る
3. シーンを組み立てて `app.start()` で動かす

### コンストラクタで決めること

コンストラクタでは、「どのようなアプリの土台を作るか」を決めます。頻繁に使うのは次の項目です。

- `document`: ブラウザの `document`
- `messageFontTexture`: canvas ベースの HUD / message を使うなら必要
- `clearColor`: 背景色
- `camera`: 初期視点
- `shaderClass`: 既定シェーダーを差し替えたい場合
- `renderMode`: `ondemand` または `continuous`
- `layoutMode`: 通常表示か `embedded`
- `fixedCanvasSize`: canvas を固定サイズで扱う場合

初期視点の指定では `target`、`distance`、`head`、`pitch`、`bank` を使います。

```js
const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 12.0,
    head: 24.0,
    pitch: -12.0,
    bank: 0.0
  }
});
```

ここで作られる標準カメラは、まだ orbit や follow ではありません。`target` と `distance` を元にした「静的な初期視点」です。最初の表示を確実に整えたいときは、この固定視点だけでも十分役立ちます。

### initの後に何が使えるようになるか

`await app.init()` が完了すると、`WebgApp` の主要コンポーネントが利用可能になります。特に重要なのは次のものです。

- `app.screen`
- `app.shader`
- `app.space`
- `app.cameraRig`
- `app.cameraRod`
- `app.eye`
- `app.input`
- `app.message`
- `app.dialogue`

最もよく使う入口は `app.getGL()`、`app.space`、`app.eye` です。`Shape` を作るときは `app.getGL()` を、`Node` を追加するときは `app.space` を使います。

逆に言えば、`init()` 前にこれらへ触れてはいけません。`app.getGL()` も `app.space` も `init()` の内部で初めて作られるため、初期化前アクセスは不正な順序になります。

### startの中で何が起きるか

`app.start()` は、単に `requestAnimationFrame` を呼ぶための薄い関数ではありません。内部では、一定の順序で update と draw を実行します。現在の `WebgApp.frame()` は概ね次の順序で進みます。

1. 経過時間と `deltaSec` を計算する
2. 管理中の `EyeRig` を更新する
3. `onUpdate(ctx)` を呼ぶ
4. tween、shape animation、particle、camera follow/effects を更新する
5. `screen.clear()` を呼ぶ
6. `onBeforeDraw(ctx)` を呼ぶ
7. 3D シーンを描画する
8. `onAfterDraw3d(ctx)` を呼ぶ
9. particle、HUD、message を描画する
10. `onAfterHud(ctx)` を呼ぶ
11. `screen.present()` で画面へ反映する

この順序が分かっていると、「3D の前に独自 pass を差し込みたい」「3D の後に overlay を描きたい」「HUD の後で最終的な文字列を足したい」といった判断がしやすくなります。

## onUpdateに渡されるコンテキスト

`start()` のハンドラーには `ctx` が渡されます。ここにはそのフレームで必要になりやすい参照がまとめられています。

```js
app.start({
  onUpdate(ctx) {
    if (ctx.input.has("arrowleft")) {
      player.rotateY(-1.0);
    }
    if (ctx.input.has("arrowright")) {
      player.rotateY(1.0);
    }
  }
});
```

`ctx` に含まれる代表的な値は次の通りです。

- `app`
- `screen`
- `shader`
- `space`
- `eye`
- `cameraRig`
- `cameraRod`
- `cameraTarget`
- `cameraFollow`
- `input`
- `projection`
- `scenePhase`
- `dialogue`
- `gameHud`
- `timeMs`
- `timeSec`
- `deltaSec`

更新処理で頻繁に使うのは `ctx.input` と `ctx.deltaSec` です。アニメーションや移動量を時間ベースで安定させたいなら、固定値ではなく `deltaSec` を使って調整してください。

## renderModeの考え方

`WebgApp` の既定の `renderMode` は `ondemand` です。これは「必要なときだけ frame を進める」方針で、タブが非表示になったときや、表示中でも `document.hasFocus()` が `false` になったときは更新を止めます。教材ページ、viewer、設定画面のように、非 active 中は pause で問題ないアプリではこの既定値が自然です。

常に動かし続けたいアプリだけ `continuous` を使います。

```js
const app = new WebgApp({
  document,
  renderMode: "continuous"
});
```

ただし、単に orbit camera やドラッグ操作を使うだけなら `continuous` は不要です。`WebgApp` と `EyeRig` は、継続入力中に必要な frame を起こせるよう設計されています。まずは `ondemand` を基準に考え、常時アニメーションが必要なときだけ `continuous` を選んでください。

## embeddedレイアウトとfixedCanvasSize

`WebgApp` は 3D アプリを「ページ全体の主役」として置く場合だけでなく、「HTML 文書の途中へ埋め込む実行例」として使う場合も意識しています。その切り替えが `layoutMode: "embedded"` です。

これは単に canvas を小さくする設定ではありません。`embedded` を使うと、canvas の周囲に出る help panel、dialogue、touch control、fixed panel などの UI も含めて、「その実行例の近傍にまとまって配置する」方向へ挙動が切り替わります。スクロールしても UI が canvas と一緒に動くため、教材ページやマニュアルの本文と共存しやすくなります。

`fixedCanvasSize` は、実行例の見え方を安定させたいときに使います。比較用スクリーンショット、書籍本文、埋め込み viewer などでは、表示サイズが毎回変わらない方が扱いやすくなります。`book/examples/05_03.html` は、この `embedded` と `fixedCanvasSize` をまとめて確認できる例です。

```js
const app = new WebgApp({
  document,
  layoutMode: "embedded",
  fixedCanvasSize: {
    width: 1280,
    height: 720,
    useDevicePixelRatio: false
  },
  messageFontTexture: "./webg/font512.png"
});
```

このモードでは、3D 実行例が通常の文書フローの一部になります。説明文を上に置き、canvas を中ほどに配置し、その下へ補足説明を続けるような構成が自然です。

## 視点は固定から始めて必要なら拡張する

`WebgApp.init()` は標準の camera rig を構築します。具体的には `cameraRig -> cameraRod -> eye` という 3 段構成を作り、`space.setEye(this.eye)` まで完了させます。これだけで「初期視点から見る」アプリは成立します。

より高度な視点操作が必要になったときは、第6章で解説する `EyeRig` をこの標準リグへ追加します。現在は orbit 視点の標準入口として `app.createOrbitEyeRig()` が用意されており、pointer 接続、毎フレームの update、`WebgApp` camera state との同期までまとめて扱えます。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  head: 24.0,
  pitch: -12.0
});
```

この helper を使うと、sample 側で `orbit.update(deltaSec)` や `app.camera.target` への同期を書き忘れて、見かけ上 PAN が動かない状態を避けやすくなります。視点制御の詳細は次章で扱いますが、「`WebgApp` は最初から視点ノードを用意してくれる」ことはここで押さえておいてください。

## UIを目的別に使い分ける

`WebgApp` が便利なのは描画だけではありません。アプリに必要な補助 UI を目的ごとに整理して持っています。ここを使い分けると、HUD に何でも詰め込むより読みやすくなります。

### help panel

操作説明や簡単な補足は `createHelpPanel()` が適しています。教材ページや viewer では、常時表示の HUD よりも、必要なときに開いて読める help panel の方が自然な場面が多くあります。

```js
app.createHelpPanel({
  id: "sampleHelpOverlay",
  lines: [
    "Drag: orbit camera",
    "Shift+Drag: pan",
    "Wheel: zoom"
  ]
});
```

### statusとguide

短い状態表示は `setStatusLines()`、固定のガイドは `setGuideLines()` を使います。debug mode だけ表示したいガイドには `setDebugGuideLines()` が便利です。

```js
app.setStatusLines([
  "Sample cube",
  "WebgApp minimum"
], {
  anchor: "top-left",
  x: 0,
  y: 0
});

app.setDebugGuideLines([
  "F9 then M: toggle debug mode",
  "F9 then C: copy current state"
]);
```

### dialogue

会話、チュートリアル、進行メッセージのように、読み順があるテキストは `startDialogue()` が向いています。HUD に長文を流すのではなく、役割を分けてください。

```js
app.startDialogue([
  {
    speaker: "guide",
    title: "Tutorial",
    lines: [
      "ようこそ",
      "まず移動を試してください"
    ]
  }
]);
```

### error panelとfixed format panel

長いエラーや詳細な diagnostics は、HUD ではなく固定パネルへ分ける方が読みやすくなります。

```js
try {
  await app.loadScene(sceneData);
} catch (err) {
  app.showErrorPanel(err, {
    title: "scene load failed"
  });
}
```

## diagnosticsとDebugDock

`WebgApp` は diagnostics を標準機能として持っています。現在の app 状態を report として保持し、最新の warning / error を debug dock から追えるようになっています。

利用者がまず覚えておくとよいのは、`WebgApp` には「高レイヤーで warning を可視化する入口」があるという点です。たとえば、構造破壊ではないが、そのまま黙って続行すると利用者が不安になるような補正やフォールバックを行った場合は、`reportRuntimeWarning()` から warning を通知できます。

```js
app.reportRuntimeWarning(
  "scene fog density is too large for this sample; using the clamped value"
);
```

この API は `console.warn` と diagnostics / latest warning / DebugDock をまとめて更新するため、shader のような low-level ではなく、loader、scene 構築、UI 構成など高レイヤーの判断を見せたい場面で有効です。

一方で、shader レベルの軽い範囲外値のように「まずは console で原因を追えれば十分」という問題は、必ずしも `WebgApp` へ持ち上げる必要はありません。`webg` では現在、構造破壊系は例外で停止し、意味は通るが危険な範囲外は warning つきクリップで継続する、という方針で整理を進めています。本章では、この高レイヤー warning の可視化口として `WebgApp` を使えることだけ押さえておけば十分です。

## loaderとスクリーンショット

モデル読み込みや scene 読み込みも `WebgApp` の重要な役割です。フォーマットごとの差を吸収した入口として `loadModel()` と `loadScene()` を使えます。

```js
const modelRuntime = await app.loadModel("./assets/robot.gltf");
const sceneRuntime = await app.loadScene(sceneData);
```

スクリーンショットは `takeScreenshot()` で予約します。これは直後に PNG を作るのではなく、次の `present()` 後に canvas 内容を保存する方式です。

```js
app.attachInput({
  onKeyDown: (key, ev) => {
    if (ev.repeat) return;
    if (key === "s") {
      app.takeScreenshot({ prefix: "my_sample" });
    }
  }
});
```

## 実装時に注意したいこと

最後に、`WebgApp` を使うときに特に意識しておきたい点を整理します。

- `await app.init()` の前に `app.getGL()` や `app.space` を使わない
- `Shape` を作ったら `endShape()` を忘れない
- `Shape` だけでは表示されず、`Node` に載せて `Space` に入れる必要がある
- 長い説明文を HUD に押し込まず、help panel や dialogue、fixed panel と使い分ける
- orbit や follow が必要になるまでは、固定の初期視点で十分な場面も多い
- 高レイヤーの warning は `reportRuntimeWarning()` を使うと DebugDock から追いやすい

`WebgApp` は高機能ですが、最初から全部を使い切る必要はありません。まずは「コンストラクタで土台を決め、`init()` 後にシーンを組み、`start()` の `onUpdate()` へロジックを書く」という骨格をつかんでください。その上で、必要に応じて orbit camera、help panel、dialogue、loader、diagnostics を足していくと、アプリ構成が自然に整理されます。

## まとめ

`WebgApp` は、`webg` における 3D アプリケーションの標準的な骨格です。`Screen`、`Space`、シェーダー、camera rig、入力、UI、diagnostics を一定の順序でまとめて立ち上げることで、利用者はアプリ固有のロジックへ集中しやすくなります。

本章では、ローレベルな最小構成と比較しながら、`WebgApp` が何を肩代わりしているのかを確認しました。また、`init()` の後に何が使えるのか、`start()` の中でどの順序で処理が進むのか、`embedded` と `fixedCanvasSize` をどう理解すべきか、そして UI や diagnostics を目的別にどう使い分けるかを整理しました。

次章では、この `WebgApp` が作る標準 camera rig を土台にして、`EyeRig` による orbit、first-person、follow の視点制御を詳しく見ていきます。
