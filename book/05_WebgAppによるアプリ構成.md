# WebgAppによるアプリ構成

`WebgApp` は、`webg` で 3D アプリケーションを構築する際の標準的なエントリポイントです。`Screen`、`Space`、シェーダー、カメラ操作、入力、HUD、ダイアログ、デバッグ表示、診断機能など、ほとんどのアプリケーションで共通して必要となる基盤をまとめて初期化し、開発者がアプリ固有の処理に集中できるように設計されています。これは単にコード量を削減するための便利関数ではなく、「3D アプリケーションの骨格を常に一定の順序で立ち上げる」ためのフレームワークとして理解するのが適切です。

本章では、`WebgApp` を導入することでどのような定型処理が省略されるのか、そしてどこまでが 3D 表現の本質的な処理で、どこからがフレームワークによる定型処理なのかを整理して解説します。第3章と第4章で扱ったローレベル（低レイヤー）な構成を踏まえ、`WebgApp` がどの処理を担い、利用者はどこに独自の処理を記述すべきかを順を追って確認していきましょう。なお、視点ノードの詳細や `EyeRig` の概念については、第6章「カメラ制御とEyeRig」で詳しく扱うため、本章ではアプリ構成の観点から必要な範囲に絞って説明します。

本章の目的は、個別のメソッド名を暗記することではありません。`init()` の前後でどのような状態が整うのか、`start()` の内部でどのような順序で処理が進むのか、そして HUD、ヘルプパネル、ダイアログ、診断機能をどのように使い分けるのかを理解し、「自身のアプリケーションをどこに組み込めば自然に動作するか」を判断できるようになることにあります。

## WebgAppが担う役割と3Dシーンの基本構造

`webg` のローレベル API では、利用者が次のようなコンポーネントを順番に生成して接続する必要があります。

- `Screen`: canvas の準備と WebGPU の初期化
- `Shape`: 形状と材質の定義
- `Node`: 位置・回転・スケールの管理と `Shape` の保持（内部的に `CoordinateSystem` を継承）
- `Space`: シーン全体の管理
- `eye`: 視点の定義
- shader / projection matrix: 3D 空間を 2D 画面へ投影するための計算

このフローは 3D 描画の仕組みを理解する上では重要ですが、アプリケーションを開発するたびに同じ初期化を繰り返すのは大きな負担となります。`WebgApp` は、ここに HUD、入力管理、デバッグドック、固定フォーマットパネル、ダイアログ、アセットローダー、スクリーンショット、シーンフェーズ管理といった実用的な機能を加えた上で、標準的なアプリケーション構成をまとめて立ち上げます。

![WebgApp 全体構成図](fig05_01_webgapp_overview.jpg)

*WebgApp は、描画、シーン管理、視点、入力、UI、診断機能をまとめて初期化し、3D アプリケーションの骨格を一定の形式で整えます*

ここで重要なのは、`WebgApp` が 3D の仕組みを隠蔽して不透明にしているわけではないという点です。「`Shape` を `Node` に載せて `Space` に配置し、`eye` から描画する」という基本構造は変わりません。`WebgApp` は、その構造を維持したまま、毎回ほぼ同一となる初期化と接続処理を共通化したものです。

### Node と CoordinateSystem の関係

`WebgApp` をより深く理解するために、3D シーンを構成する要素を整理しましょう。

- `Shape`: 「何を描くか」（形状と材質）
- `Node`: 「どこに置くか」（位置・回転・スケール）
- `Space`: 「全体をどう管理するか」（空間の統括）
- `eye`: 「どこから見るか」（視点）

3D 描画の基本は、結局のところ「何を置くか」「どこへ置くか」「どこから見るか」に集約されます。ここで、`Node` の実体について詳しく触れておきます。`webg` において、位置や回転、スケール、そして親子関係（シーングラフ）という「座標の計算」を専門に担う基底クラスが `CoordinateSystem` です。

`Node` はこの `CoordinateSystem` を継承して作られています。つまり、`Node` は「座標を管理する能力」を備えた上で、さらに「`Shape`（形状）を保持して描画する機能」を追加したクラスであると言えます。この設計により、次のような論理的な役割分担が実現しています。

- `CoordinateSystem`: 「空間上のどこに、どの向きで存在するか」という数学的な位置情報を管理する。
- `Node`: その位置情報に「具体的な見た目（`Shape`）」を結びつけ、空間に実体化させる。

したがって、`Shape` を定義しただけでは単なる「形状データ」に過ぎず、空間上の位置を持ちません。その `Shape` を `Node` にアタッチし、さらに `Node` を `Space` に登録することで初めて、3D 空間内の特定の場所に物体が現れ、`eye`（視点）から見えるようになります。

### 座標系と回転の定義

`webg` の座標系は右手座標系で、`+X=右`、`+Y=上`、`+Z=前` と定義されています。回転の制御には `yaw / pitch / roll` という用語を用います。`WebgApp` でも camera や follow 設定においてこの語彙を使用するため、本書全体を通して `yaw` を基準に理解するようにしてください。この構造を把握しておくことで、`WebgApp` を利用した際に「何が自動化され、何が利用者の責任として残るのか」を明確に区別できるようになります。

## ローレベル構成とWebgAppによる実装の比較

まずは `WebgApp` を使わずに、必要なコンポーネントを個別に組み立てる最小構成の例を見てみましょう。これは第4章までの復習であり、`WebgApp` がどのような処理を省略しているかを比較するための基準となります。

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

このコードでは、画面サイズ変更時の投影行列更新、`Screen` の生成、シェーダーの準備、`Space` と `eye` の構築、そして毎フレームの `clear -> draw -> present` というサイクルまで、すべてを利用者が管理しています。これは低レイヤー API を理解する上で不可欠な知識ですが、実際のアプリケーション開発で毎回記述するのは非効率です。

次に、同じ内容を `WebgApp` で書き直してみます。`book/examples/05_02.html` でも同様の動作を確認できます。

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
    yaw: 0.0,
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

利用者が記述しているのは、形状の生成、`Node` の配置、そして `onUpdate()` 内の更新ロジックのみです。`WebgApp` は、内部で次のような定型処理を自動的に実行しています。

- `Screen` の作成と WebGPU の準備
- 既定シェーダーの初期化
- `Space` の作成
- カメラリグ (`cameraRig -> cameraRod -> eye`) の構築
- 投影行列とビューポートの自動更新
- 光源とフォグの適用
- `InputController` とタッチ操作の初期化
- メッセージ/HUD、デバッグドック、固定フォーマットパネルの準備
- 診断機能の初期化
- `requestAnimationFrame` によるループ管理

これにより、開発者は「何を作るか」と「毎フレームどのような挙動をさせるか」という本質的なロジックに集中することが可能になります。

## WebgAppのライフサイクル

`WebgApp` を利用する際は、次の 3 段階のライフサイクルで考えると理解しやすくなります。

1. コンストラクタで初期設定を定義する
2. `await app.init()` で基盤を構築する
3. シーンを組み立て、`app.start()` で動作させる

### コンストラクタによる環境定義

コンストラクタでは、「どのようなアプリケーションの土台を作るか」を決定します。頻繁に利用する主な設定項目は以下の通りです。

- `document`: ブラウザの `document` オブジェクト
- `messageFontTexture`: canvas ベースの HUD / メッセージを利用する場合に必要
- `clearColor`: 背景色
- `camera`: 初期視点の設定
- `shaderClass`: 既定シェーダーを差し替えたい場合に指定
- `viewAngle`: 基準となる視野角
- `projectionNear` / `projectionFar`: 投影行列の near / far 平面
- `light`: 光源を eye 固定にするか world node にするか
- `fog`: フォグの色、距離、密度、モード
- `useMessage` / `messageScale`: canvas HUD の有無と表示倍率
- `attachInputOnInit`: `init()` 時に入力を自動接続するか
- `autoDrawScene` / `autoDrawBones`: `frame()` 内で自動描画する対象
- `debugTools`: 診断機能やデバッグキーの初期設定
- `uiTheme`: デバッグドック、固定パネル、ヘルプパネルなどの外観
- `renderMode`: `ondemand` または `continuous`
- `layoutMode`: 通常表示か `embedded`（埋め込み）か
- `fixedCanvasSize`: canvas を固定サイズで扱う場合の設定

初期視点の指定では `target`、`distance`、`yaw`、`pitch`、`roll` を使用します。

```js
const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 12.0,
    yaw: 24.0,
    pitch: -12.0,
    roll: 0.0
  }
});
```

ここで設定される標準カメラは、まだ orbit（軌道）や follow（追従）の状態ではなく、`target` と `distance` に基づいた「静的な初期視点」です。最初の表示状態を確実に制御したい場合、この固定視点設定が非常に有効です。

### 投影行列、光源、およびフォグの設定

`WebgApp` では、カメラ位置だけでなく、投影行列、光源、フォグもコンストラクタオプションから一括して設定できます。視野角は `viewAngle`、奥行きの範囲は `projectionNear` と `projectionFar` で指定します。広大なシーンを扱う場合は `projectionFar` を大きく設定することになりますが、過剰に広げると深度精度（Zファイティング：奥行きの判定による描画のちらつき）が低下するため、表示対象に合わせて適切な範囲に収めるのが基本です。

```js
const app = new WebgApp({
  document,
  viewAngle: 50.0,
  projectionNear: 0.1,
  projectionFar: 180.0,
  light: {
    mode: "world-node",
    position: [80.0, 120.0, 60.0, 1.0],
    type: 1.0
  },
  fog: {
    color: [0.08, 0.10, 0.12, 1.0],
    near: 40.0,
    far: 140.0,
    density: 0.02,
    mode: 1.0
  }
});
```

既定の光源は `eye-fixed` であり、視点に対して固定された光として扱われます。これはモデル確認用のビューアなどで、視点を回転させても対象が適切に照らされるため便利です。シーン内の特定位置に光源を配置したい場合は、`light.mode: "world-node"` を使用するか、`await app.init()` の後に `setWorldLight()` を呼び出します。また、フォグの設定は `setFog()` を用いて実行中に変更することも可能です。

```js
app.setWorldLight({
  position: [40.0, 70.0, 20.0, 1.0],
  type: 1.0
});

app.setFog({
  color: [0.1, 0.12, 0.16, 1.0],
  near: 30.0,
  far: 120.0,
  mode: 1.0
});
```

### init 完了後の利用可能コンポーネント

`await app.init()` は、WebGPU コンテキストの作成やシェーダーのコンパイルなど、非同期的な準備処理をまとめて行う重要なステップです。この処理が完了すると、`WebgApp` の主要なコンポーネントが利用可能になります。

- `app.screen`
- `app.shader`
- `app.space`
- `app.cameraRig`
- `app.cameraRod`
- `app.eye`
- `app.input`
- `app.message`
- `app.dialogue`

開発者が最も頻繁に利用するのは `app.getGL()`、`app.space`、`app.eye` です。`Shape` を生成する際は `app.getGL()` を、`Node` を追加する際は `app.space` を使用します。なお、これらは `init()` の内部で生成されるため、`init()` 完了前にアクセスするとエラーとなる点に注意してください。

### start メソッドとフレーム更新の順序

`app.start()` は、単に `requestAnimationFrame` を呼び出すための関数ではなく、内部で厳密な順序に基づいた update と draw を実行します。現在の `WebgApp.frame()` は、概ね次の順序で処理が進みます。

1. 経過時間と `deltaSec`（前フレームからの経過秒数）を計算する
2. 管理中の `EyeRig` を更新する
3. `onUpdate(ctx)` を呼び出す
4. tween（補間機能）、shape animation、particle、camera follow/effects を更新する
5. `screen.clear()` を呼び出す
6. `onBeforeDraw(ctx)` を呼び出す
7. 3D シーンを描画する
8. `onAfterDraw3d(ctx)` を呼び出す
9. particle、HUD、message を描画する
10. `onAfterHud(ctx)` を呼び出す
11. `screen.present()` で画面へ反映する

この実行順序を把握しておくことで、「3D 描画の前に独自のパスを挿入したい」「3D 描画の後にオーバーレイを描きたい」「HUD の後に最終的な文字列を重ねたい」といった制御が可能になります。

## 実行時のコンテキストと描画モード

### onUpdate に渡されるコンテキスト

`start()` のハンドラーには `ctx`（コンテキスト）が渡されます。ここには、そのフレームで必要となる参照がまとめられています。

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

`ctx` に含まれる代表的な値は以下の通りです。

- `app` / `screen` / `shader` / `space` / `eye`
- `cameraRig` / `cameraRod` / `cameraTarget` / `cameraFollow`
- `input` / `projection` / `scenePhase` / `dialogue` / `gameHud`
- `timeMs` / `timeSec` / `deltaSec`

特に更新処理で頻繁に利用するのが `ctx.input` と `ctx.deltaSec` です。アニメーションや移動量を時間ベースで安定させたい場合は、固定値ではなく `deltaSec` を用いて計算してください。

### renderMode による負荷制御

`WebgApp` の既定の `renderMode` は `ondemand` です。ここでの `ondemand` は、ページが表示され、ウィンドウとページがフォーカスされている間はフレームループを継続し、タブが非表示になった際やフォーカスを失った際に自動的にポーズすることを意味します。

この設計は、教材ページやビューアのように、非アクティブな状態でまで更新を続ける必要がないアプリケーションにおいて、CPU/GPU 負荷を下げ、省電力で運用することを目的としています。一方で、バックグラウンドで常にアニメーションを動作させ続ける必要があるアプリケーションの場合は、`continuous` を指定してください。

```js
const app = new WebgApp({
  document,
  renderMode: "continuous"
});
```

### 自動描画とカスタム描画の切り替え

`WebgApp.frame()` は既定で `space.draw(app.eye)` を呼び出し、さらに HUD やメッセージまで描画します。通常の 3D サンプルではこれで十分ですが、ポストプロセス（後処理）、オフスクリーンレンダーターゲット（画面外描画バッファ）、複数パスの合成などを行う場合は、描画順序を自身で制御する必要があります。

その場合は `autoDrawScene: false` を指定し、`onBeforeDraw()` や `onAfterDraw3d()` の中で必要な描画処理を明示的に呼び出します。

```js
const app = new WebgApp({
  document,
  autoDrawScene: false
});

await app.init();

app.start({
  onBeforeDraw({ space, eye }) {
    // オフスクリーンパスやカスタムパスの中で space.draw(eye) を呼ぶ
    customRenderer.drawScene(space, eye);
  },
  onAfterDraw3d() {
    customRenderer.composeToScreen();
  }
});
```

また、ボーン表示を自動で重ねたい場合は `autoDrawBones: true` を指定します。これはスキニングやスケルトンの確認に便利ですが、最終的なビューアやゲーム表示では不要な機能です。

## レイアウトモードと視点制御の拡張

### embedded レイアウトと固定サイズ

`WebgApp` は、3D アプリをページ全体の主役として配置する場合だけでなく、HTML 文書の途中に埋め込む実行例として利用する場合も想定しています。その切り替えを行うのが `layoutMode: "embedded"` です。

`embedded` モードを有効にすると、canvas の周囲に表示されるヘルプパネル、ダイアログ、タッチコントロール、固定パネルなどの UI も含めて、「実行例の近傍にまとめて配置する」挙動に切り替わります。これにより、スクロールしても UI が canvas と共に移動するため、教材ページやマニュアルの本文と共存しやすくなります。

また、実行例の見た目を安定させたい場合は `fixedCanvasSize` を使用します。比較用スクリーンショットや書籍内のビューアなどでは、表示サイズが一定である方が扱いやすいためです。`book/examples/05_03.html` では、この `embedded` と `fixedCanvasSize` の組み合わせを確認できます。

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

### 視点制御の拡張

`WebgApp.init()` は標準のカメラリグを構築します。具体的には `cameraRig -> cameraRod -> eye` という 3 段構成を作成し、`space.setEye(this.eye)` までを完了させます。これにより、単純な「初期視点から見る」アプリケーションはすぐに成立します。

より高度な視点操作が必要な場合は、第6章で解説する `EyeRig` をこの標準リグに追加します。現在は orbit 視点の標準的な入口として `app.createOrbitEyeRig()` が用意されており、ポインター接続、毎フレームの更新、`WebgApp` のカメラ状態との同期までを一括して管理できます。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0
});
```

このヘルパーを利用することで、`orbit.update(deltaSec)` や `app.camera.target` への同期漏れによる「視点が動かない」といった実装ミスを避けることができます。

## ユーザー通知とデバッグ機能の使い分け

`WebgApp` は、描画以外にもアプリケーションに必要な補助 UI を目的別に整理して提供しています。情報の性質に応じてこれらを使い分けることで、HUD に情報を詰め込みすぎることを避け、視認性の高い洗練された UI を構築できます。

### 操作説明とガイド（help panel / status / guide）

操作説明や補足情報は `createHelpPanel()` が適しています。常時表示される HUD よりも、必要なときにのみ展開して読める形式の方が、画面を広く活用できます。

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

HUD を表形式で表示したい場合は `setHudRows()` や `setControlRows()` を使用します。短い自由文には `setStatusLines()` が向いていますが、項目名と現在値を対にして表示したい場合は row 形式の方が読みやすくなります。

```js
app.setHudRows([
  { label: "MODE", value: mode },
  { label: "VERTICES", value: vertexCount },
  { label: "FPS", value: fps.toFixed(1) }
], {
  anchor: "top-left",
  x: 0,
  y: 2
});
```

また、短い状態表示には `setStatusLines()`、固定のガイドには `setGuideLines()` を使用し、デバッグモード時のみ表示したいガイドには `setDebugGuideLines()` を使い分けるのが効果的です。

### 進行管理とエラー通知（dialogue / error panel）

会話、チュートリアル、進行メッセージのように、読み順があるテキストは `startDialogue()` に向いています。一方、詳細なエラーや診断機能の結果は、HUD ではなく固定パネルに分離して表示させることで、可読性を確保できます。

```js
try {
  await app.loadScene(sceneData);
} catch (err) {
  app.showErrorPanel(err, {
    title: "scene load failed"
  });
}
```

### 診断機能とDebugDock

`WebgApp` は診断機能を標準搭載しています。アプリケーションの現在の状態をレポートとして保持し、最新の警告やエラーをデバッグドックから追跡できるようになっています。

特に有用なのが、ハイレベルな警告を可視化するインターフェースです。たとえば、致命的なエラーではないが、そのまま続行すると不都合が生じるため自動的に補正を行った場合などは、`reportRuntimeWarning()` を通じて通知できます。

```js
app.reportRuntimeWarning(
  "scene fog density is too large for this sample; using the clamped value"
);
```

この API は `console.warn` への出力と同時に、診断機能およびデバッグドックの更新をまとめて行うため、ローダーやシーン構築、UI 構成などの高レイヤーな判断をユーザーに提示したい場面で有効です。

デバッグキーは既定で `F9` をプリフィックスとして扱います。`F9` の後に `M` でデバッグモードの切り替え、`C` で診断機能サマリーのコピー、`V` で JSON レポートのコピーを実行できます。`app.attachInput()` は、これらのデバッグキーを優先的に処理してから利用者のハンドラーへイベントを渡すため、`app.input.attach()` を直接呼ぶよりも安全です。

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

プリフィックスを変更したい場合は、`configureDebugKeyInput()` で設定可能です。

## アプリケーションを拡張する補助機能

`WebgApp` はシーンの描画以外に、アプリケーションで頻繁に利用される実行時の補助機能を管理しています。

`createTween()`（補間機能の生成）は、任意のオブジェクトや配列の値を時間経過とともに補間し、`frame()` 内で自動的に更新します。色や位置、UI 用の数値などを演出として動かしたい場合に便利です。

```js
const color = [1.0, 0.2, 0.1, 1.0];
app.createTween(color, [0.2, 0.8, 1.0, 1.0], {
  durationMs: 600
});
```

`createParticleEmitter()` で作成したパーティクルエミッター（放出器）は、`WebgApp` が更新と描画をまとめて行います。画面効果をシーン本体の `Space` と切り離して管理したい場合に適しています。

```js
const emitter = await app.createParticleEmitter({
  maxParticles: 256
});
```

カメラ演出としては、`shakeCamera()`、`followNode()`、`lockOn()` が用意されています。これらは第6章のカメラ制御と密接に関わりますが、`WebgApp` のフレームループ内で自動更新される機能であることはここで押さえておいてください。

```js
app.shakeCamera({
  durationMs: 180,
  strength: [0.2, 0.12, 0.0]
});

app.followNode(playerNode, {
  smooth: 0.18,
  offset: [0.0, 3.0, -8.0]
});
```

また、簡易的なゲーム HUD も用意されており、`setScore()`、`setCombo()`、`setTimer()`、`pushToast()` を使うことで、得点や短い通知を HUD 描画に載せることができます。

進行状態の保存には `saveProgress()` と `loadProgress()` を利用します。保存先は `progressStorage` オプションで変更可能で、未指定時はブラウザのストレージを利用します。サンプルごとに保存キーを分けたい場合は `progressStoragePrefix` を設定してください。

```js
app.saveProgress("stage", {
  level: 3,
  score: 1200
});

const progress = app.loadProgress("stage", {
  level: 1,
  score: 0
});
```

## ローダーとスクリーンショット

モデルの読み込みやシーンの構築も `WebgApp` の重要な役割です。フォーマットごとの差異を吸収したハイレベル（高レイヤー）なインターフェースとして `loadModel()` と `loadScene()` が提供されています。

```js
const modelRuntime = await app.loadModel("./assets/robot.gltf");
const sceneRuntime = await app.loadScene(sceneData);
```

スクリーンショットは `takeScreenshot()` で予約します。これは呼び出した瞬間に PNG を生成するのではなく、次の `present()` 完了後に canvas 内容を保存する方式を採用しています。

## 実装時の注意点

最後に、`WebgApp` を利用する際に特に意識すべき点をまとめます。

- `await app.init()` の完了前に `app.getGL()` や `app.space` にアクセスしない。
- `Shape` を定義した後は必ず `endShape()` を呼び出す。
- `Shape` を定義しただけでは表示されないため、必ず `Node` にアタッチし、`Space` に登録する。
- 長い説明文を HUD に詰め込まず、ヘルプパネル、ダイアログ、固定パネルを適切に使い分ける。
- orbit や follow が必要になるまでは、固定の初期視点設定で十分な場合が多い。
- ハイレベルな警告は `reportRuntimeWarning()` を使い、デバッグドックで管理しやすくする。
- カスタムレンダーパスを実装する場合は `autoDrawScene: false` を検討する。
- デバッグキーの機能を維持したい場合は、`app.input.attach()` ではなく `app.attachInput()` を使用する。

`WebgApp` は多機能ですが、最初からすべての機能を使い切る必要はありません。まずは「コンストラクタで土台を決め、`init()` 後にシーンを組み、`start()` の `onUpdate()` へロジックを記述する」という基本骨格を習得してください。その上で、必要に応じて orbit カメラ、ヘルプパネル、ダイアログ、ローダー、診断機能、tween（補間機能）、パーティクル、進行保存などを追加していくことで、アプリケーションの構成を自然に整理することができます。

## まとめ

`WebgApp` は、`webg` における 3D アプリケーションの標準的な骨格を提供します。`Screen`、`Space`、シェーダー、カメラリグ、入力、UI、診断機能を一定の順序でまとめて立ち上げることで、開発者はアプリケーション固有のロジックに集中できるようになります。

本章では、ローレベル（低レイヤー）な最小構成と比較しながら、`WebgApp` がどのような処理を抽象化しているのかを確認しました。また、`init()` 完了後に利用可能となるコンポーネント、`start()` 内での処理順序、`embedded` モードや `fixedCanvasSize` の考え方、そして UI や診断機能の使い分けについて整理しました。

次章では、この `WebgApp` が構築する標準カメラリグを土台として、`EyeRig` による orbit、first-person、follow といった高度な視点制御について詳しく解説します。
