# WebgAppによるアプリ構成

`WebgApp` クラスは、`webg` において極めて重要な役割を担っています。標準的な 3D アプリケーションに必要となる機能をあらかじめ統合し、スムーズにアプリを構築できるよう設計された、フレームワークとしての役割を担うクラスです。アプリを作成するたびに、`webg` が提供する膨大な機能の中から必要なものを一つひとつ選択し、実行順序を検討しながら組み立てる作業は、学習者にとっても経験者にとっても大きな負担となります。`WebgApp` はその負担を軽減し、開発者がアプリのコンテンツそのものの実装に集中できるように設計されています。

本章では、`WebgApp` を初めて利用する方に向けて、このクラスがどのような処理を肩代わりし、実装をいかに簡潔にするのかを順を追って説明します。付録の「API一覧」にある `WebgApp` の項目や、第3章「3Dグラフィックスの基礎」、第4章「WebGPUとwebgの最小描画」の内容を前提としつつ、まずは「3D シーンをどう定義するか」という根本的な考え方から整理し、そのうえで `WebgApp` の有用性について解説します。視点リグ（Camera Rig）の詳細な使い方については、第6章「カメラ制御とEyeRig」で `cameraRig`、`cameraRod`、`eye` の関係性を詳しく解説しているため、併せて参照してください。

本章の目的は、`WebgApp` のメソッド名を暗記することではありません。「形状を作る」「空間へ配置する」「視点から見る」という 3D の基本原則を理解し、`WebgApp` が繰り返される初期化や接続の手間をどのように自動化しているかを把握することにあります。特に、ローレベル（低レイヤー）な構成と `WebgApp` を用いた構成を対比させることで、どこが 3D 描画の本質的な処理であり、どこが補助的な処理であるかを明確にします。また、操作説明などのテキスト情報は、限られたスペースの HUD に詰め込むよりも、`WebgApp.createHelpPanel()` によるヘルプパネルで表示する方が学習者にとって読みやすいため、本章ではその手法を採用します。

## 3D シーンを構成する基本要素

`WebgApp` の機能を深く理解するために、まずは `webg` の 3D シーンがどのような要素で構成されているかを確認しましょう。

![WebgApp 全体構成図](fig05_01_webgapp_overview.jpg)

*WebgApp は、描画、シーングラフ（scene graph）、カメラリグ（camera rig）、入力、HUD、診断機能（diagnostics）を一括して初期化し、アプリケーションの入口を整理します。*

`webg` の 3D シーンは、役割に応じて次のように整理して考えることができます。
- `Shape`：どのような「形」であるか（形状と材質）
- `Node`：その形を「どこに置くか」（位置・回転・スケール）
- `Space`：シーン全体を「どう管理するか」（空間の統括）
- `eye`：どこから「見るか」（視点）

`WebgApp` は、これら 4 つの要素を常に同じ順序で準備するための補助クラスです。この役割分担を理解していれば、`WebgApp` が単なる便利関数の集合体ではなく、3D アプリケーションの標準的な構成を管理するクラスであることが理解できるはずです。

3D プログラミングは複雑に見えますが、基本は「何を置くか」「どこへ置くか」「どこから見るか」の 3 点に集約されます。例えば、机の上に立方体のおもちゃを置き、それを少し離れた位置から眺める場面を想像してください。おもちゃそのものの形状が `Shape`、机の上の配置場所が `Node` の位置と回転、部屋全体が `Space`、眺める位置が `eye`、そしてそれを画面に映し出す窓が `Screen` に相当します。`webg` ではこれらを個別のクラスとして分離しています。この構造を理解することで、「なぜ `Shape` を定義しただけでは表示されないのか」「なぜ `Node` が必要なのか」という疑問が自然に解消されます。

あわせて、座標系の基礎についても整理しておきます。`webg` の座標系は右手座標系を採用しており、`+X=右`、`+Y=上`、`+Z=前` と定義されています。回転の制御には `head / pitch / bank` という用語を用いており、これは一般的な `yaw / pitch / roll` に対応します。回転がゼロの状態のオブジェクトは `[0, 0, 1]` 方向（前方向）を向いており、`head` の値を増やすと Y 軸を中心に回転し、前方向が右向きへと変化します。

ここで重要になるのが `CoordinateSystem` クラスです。これは位置、回転、スケール、および親子関係を持つ変換の基底クラスであり、`Node` はこの `CoordinateSystem` を継承し、さらに `Shape` を載せて描画する機能を追加したクラスです。したがって、`CoordinateSystem` で提供されている `setPosition()`、`setAttitude()`、`rotateY()`、`setScale()` といったメソッドは、そのまま `Node` でも利用可能です。

```js
import CoordinateSystem from "./webg/CoordinateSystem.js";

const pose = new CoordinateSystem(null, "samplePose");
pose.setPosition(0.0, 1.5, 0.0);
pose.setAttitude(30.0, 15.0, 0.0);
pose.setScale(1.2);
pose.setWorldMatrix();

console.log(pose.getWorldPosition());   // [x, y, z]
console.log(pose.getWorldAttitude());   // [head, pitch, bank]
```

このコードは画面に何も描画しませんが、「3D オブジェクトをどこに、どの向きで配置するか」という概念を練習するのに適しています。第3章の基礎解説と照らし合わせて読むことで、後の `WebgApp` の解説においても、座標や回転の意味を正確に把握できるでしょう。

## webg の最小構成と描画フロー

ここまでの概念を踏まえ、`webg` の最小構成をクラス単位で整理します。

- `Screen`：canvas と WebGPU への入口です。描画結果を最終的に映し出す「窓」であり、`clear()`（画面消去）と `present()`（画面表示）を制御します。
- `Shape`：メッシュとマテリアルを保持するクラスです。立方体や球体、外部モデルなどの「何を描くか」を定義します。ただし、`Shape` 単体では空間上の位置を持たないため、この段階ではまだ「形があるだけ」の状態です。
- `CoordinateSystem`：位置、回転、スケールを管理する変換の基盤であり、親子階層（シーングラフ）を扱います。
- `Node`：`CoordinateSystem` を継承し、さらに `Shape` をアタッチして描画可能にしたクラスです。
- `Space`：シーン全体を管理し、複数の `Node` をまとめて `draw(eye)` メソッドで描画します。
- `eye`：通常は `Node` として定義され、「どこから見るか」を決定します。これを `Space.setEye()` に登録して使用します。

この構成を理解すると、3D 描画までの手順は次のような論理的なフローになります。
1. `Screen` を生成する。
2. シェーダーと投影行列を準備する。
3. `Space` を生成する。
4. `eye`（視点）を配置する。
5. `Shape`（形状）を定義する。
6. `Node` を生成して `Shape` を載せ、`Space` に追加する。
7. `screen.clear()` $\rightarrow$ `space.draw(eye)` $\rightarrow$ `screen.present()` の順で描画ループを回す。

この一連の流れを把握しておくことで、後述する `WebgApp` がどの部分を自動化しているのかが明確になります。

## ローレベル（低レイヤー）による立方体の表示実装

それでは、`Screen`、`Shape`、`CoordinateSystem`、`Node` を明示的に使用して、立方体を 1 個表示する実装例を見てみましょう。コード量は多くなりますが、3D シーンの構成要素を深く理解するためには非常に有用な例です。

```js
import Screen from "./webg/Screen.js";
import Space from "./webg/Space.js";
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";
import SmoothShader from "./webg/SmoothShader.js";
import Matrix from "./webg/Matrix.js";
import CoordinateSystem from "./webg/CoordinateSystem.js";

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

const pose = new CoordinateSystem(null, "boxPose");
pose.setPosition(0.0, 0.0, 0.0);
pose.setAttitude(25.0, -10.0, 0.0);

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
box.setPosition(...pose.getPosition());
box.setAttitude(...pose.getLocalAttitude());
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

この実装を整理すると、`Screen` が描画領域を確保し、`shader` と `projection` が 3D 空間を 2D 画面へ投影するための計算を担い、`Space` がシーン全体のコンテナとなります。`eye` はカメラの視点となり、`Shape` は立方体の外見を定義し、`CoordinateSystem` はその配置計画を立て、最終的に `Node` がその形状をシーンに実体化させます。

ここで重要なのは、`Shape` を定義しただけでは何も表示されないという点です。`Node` にアタッチして `Space` に登録し、さらに `eye` を通じて描画して初めて画面に現れます。このようにローレベル（低レイヤー）な実装を一度体験しておくことで、`WebgApp` を使用した際に「何が省略され、何が保持されているのか」を正確に理解できるようになります。

## WebgApp による実装の簡略化

次に、先ほどのローレベルな実装と同じ内容を `WebgApp` を用いて記述してみます。

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
box.setPosition(0.0, 0.0, 0.0);
box.addShape(shape);

app.createHelpPanel({
  id: "sampleHelpOverlay",
  lines: [
    "ArrowLeft / ArrowRight: rotate",
    "F9 then M: toggle debug mode"
  ]
});

app.setStatusLines([
  "Sample cube",
  "WebgApp minimum"
], {
  anchor: "top-left",
  x: 0,
  y: 0
});

app.start({
  onUpdate() {
    box.rotateY(0.8);
    box.rotateX(0.4);
  }
});
```

`WebgApp` を導入することで、`Screen` の生成、シェーダーの初期化、`Space` の構築、カメラリグと `eye` の設定、投影行列とビューポートの更新処理、入力系の接続、HUD・デバッグ・診断情報の初期化、そしてメインループの管理という膨大な定型処理をすべて `WebgApp` が引き受けます。

つまり、`WebgApp` は 3D の仕組みを隠蔽するものではなく、毎回繰り返される初期化コードを共通化し、開発者が本来作りたいアプリケーションのロジックに集中できるようにするための土台です。この意味で、`WebgApp` は `webg` を実際のアプリ制作へと結びつける中核的なクラスと言えます。

具体的に `await app.init()` の内部では、`Screen` の作成から始まり、シェーダーの初期化、`Space` の生成、カメラリグ（`cameraRig` $\rightarrow$ `cameraRod` $\rightarrow$ `eye`）の構築、光源とフォグの初期設定、ビューポートに合わせた投影行列の更新、`InputController` の接続、そして `Message` やデバッグドック、固定フォーマットパネルの初期化が行われています。開発者がまず押さえるべきは、`await app.init()` と `app.start({ onUpdate() {} })` という 2 つのライフサイクルイベントです。この間にシーン構築のコードを記述することで、効率的にアプリケーションを開発できます。

## コンストラクタのオプションと初期化後の活用

`WebgApp` を利用する際、まず設定するのがコンストラクタに渡すオプションです。

- `document`：ブラウザの `document` オブジェクトを渡します。
- `messageFontTexture`：canvas HUD を利用する場合に指定します。
- `clearColor`：背景色を設定します。
- `shaderClass`：通常は `SmoothShader` が使用されます。静的メッシュとスキニングメッシュを同一の入口で扱いたい場合に最適です。面単位の陰影（フラットシェーディング）を適用したい場合も、`SmoothShader` を使用したまま `Shape` ごとに設定を切り替えるのが一般的です。学習用サンプルなどで、標準設定を `Phong` や `NormPhong` に変更したい場合のみ、ここを明示的に指定します。
- `useMessage`：canvas HUD が不要な場合は `false` に設定可能です。
- `renderMode`：描画ループの実行方針を指定します。既定値は `ondemand` で、この場合はページが表示されていて `document.hasFocus()` が `true` の間だけフレーム更新が進みます。タブが非表示になったときや、表示中でも別ウィンドウへフォーカスが移ったときは、`pause` と同じように更新が止まります。これは、操作も画面変化もない間に無駄な `requestAnimationFrame` を回し続けず、省電力で運用しやすくすることが目的です。常にフレーム更新を続けたいアプリだけ `continuous` を明示してください。

初期視点は `camera` オプションで指定します。基本的には `target`（注視点）と `distance`（距離）を把握すれば十分です。ここで注意すべき点は、`WebgApp` の標準カメラは、デフォルトでは `follow`（追従）や `orbit`（周回）の状態ではないということです。`init()` では標準的なリグを構築し、指定された `target`、`distance`、`yaw`、`pitch`、`bank` に基づいて「固定された初期視点」を配置します。追従させたい場合は `followNode()` や `lockOn()` を、周回視点にしたい場合は後述する `EyeRig` を導入してポインター操作を接続する必要があります。最初の画面を確実に提示したい段階では、この静的な初期視点のまま運用することで、カメラ制御に起因する予期せぬ挙動を防ぐことができます。

```js
camera: {
  target: [0.0, 0.0, 0.0],
  distance: 12.0,
  yaw: 0.0,
  pitch: 0.0
}
```

また、ビューポート全体ではなく固定サイズで描画したい場合は `fixedCanvasSize` を使用します。ウェブページの一部に canvas を埋め込み、ページ全体を通常通りスクロールさせたい場合は `layoutMode: "embedded"` を併用してください。このモードでは、canvas 本体だけでなく、`createHelpPanel()` や `startDialogue()`、タッチコントロールなどの UI 要素が canvas のホスト要素を基準に配置されるため、スクロールしても UI が適切に追従します。

```js
const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
  layoutMode: "embedded",
  fixedCanvasSize: {
    width: 1280,
    height: 720,
    useDevicePixelRatio: false
  },
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 0.0,
    pitch: 0.0
  }
});
```

`await app.init()` の完了後は、`app.screen`、`app.shader`、`app.space`、`app.cameraRig`、`app.cameraRod`、`app.eye`、`app.input`、`app.message` といった主要コンポーネントにアクセス可能です。特によく利用するのは `app.getGL()`、`app.space`、`app.eye` です。

更新処理は `start()` メソッドにハンドラー関数を渡して実装します。これにより、`WebgApp` が管理するメインループの中で処理が実行されます。コンテキスト（`ctx`）には `app`、`space`、`eye`、`input`、`scenePhase`、`gameHud` などが含まれており、更新処理に必要な情報をまとめて参照できます。代表的なハンドラーには `onUpdate`、`onBeforeDraw`、`onAfterDraw3d`、`onAfterHud` の 4 つがありますが、基本的には `onUpdate` だけで十分なケースがほとんどです。

ここで注意したいのが、`WebgApp` のメインループは `renderMode` によって動作が変わる点です。既定の `ondemand` では、ページが表示されており、かつ `document.hasFocus()` が `true` の間だけフレーム更新が進みます。つまり、別タブへ移ったり、同じタブが見えていても別アプリへフォーカスが移ったときは、アニメーション、`onUpdate`、particle、camera follow などの時間進行が止まります。この既定値は、教材ページや設定画面のように「非 active 中は pause でよい」アプリで、無駄な更新を避けて電力消費を抑えるためのものです。一方、バックグラウンドでも継続して進めたい計測用途や特殊な監視表示では、`renderMode: "continuous"` を明示的に指定してください。

```js
const shape = new Shape(app.getGL());
const node = app.space.addNode(null, "player");

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

## 標準リグからカメラ制御へ拡張する

`WebgApp.init()` が構築する標準カメラリグは、最初は `app.eye` をそのまま利用するだけで十分機能します。このリグは `cameraRig` を `camera.target` の位置に配置し、`eye` を `camera.distance` 分だけ離した静的な視点を提供します。

前述の通り、この状態ではドラッグによる orbit 操作や、ターゲットノードへの自動 follow は行われません。この「固定視点」という基本状態を意識しておくことで、「なぜドラッグしても視点が回らないのか」という混乱を防ぐことができます。

周回視点（Orbit Camera）が必要な場合は、`await app.init()` の後に `EyeRig` を導入します。これは `WebgApp` が用意した `app.cameraRig`、`app.cameraRod`、`app.eye` をそのまま利用し、ポインター操作によって視点を回せるように拡張する手法です。

```js
import EyeRig from "./webg/EyeRig.js";

const orbit = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
  document,
  element: app.screen.canvas,
  input: app.input,
  type: "orbit",
  orbit: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 0.0,
    pitch: 0.0
  }
});

orbit.attachPointer();
```

## UI 表示の使い分け：HUD、対話、エラー表示

`WebgApp` は描画だけでなく、ユーザーインターフェース（UI）の表示補助機能も統合しています。情報の性質に応じて、以下のように使い分けるのが効率的です。

1. 操作説明（ヘルプ）：`createHelpPanel()` を使用します。左上にパネルを表示し、ボタンで折りたたみが可能です。操作説明を画面に常時表示させるよりも、ヘルプパネルにまとめる方が画面が整理され、学習者にとっても読みやすくなります。
2. 動的な数値・状態表示：HUD（Heads-Up Display）が適しています。`setHudRows()` や `setControlRows()` を使用することで、1 行に 1 パラメータという形式で整然と表示できます。
3. 会話やチュートリアル：UTF-8 テキストを適切に表示したい場合は `startDialogue()` を利用します。
4. エラーメッセージや詳細情報：長いメッセージは HUD ではなく、`showErrorPanel()` や `showFixedFormatPanel()` などの固定パネルに分離して表示することで、視認性が向上します。

```js
// ヘルプパネルの例
app.createHelpPanel({
  id: "sampleHelpOverlay",
  lines: [
    "Drag: orbit camera",
    "Wheel: zoom",
    "Space: pause"
  ]
});

// HUD表示の例
app.setStatusLines([
  `PHASE ${phase}`,
  `LIVES ${lives}`
], {
  anchor: "top-left",
  x: 0,
  y: 0
});

// 対話ウィンドウの例
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

// エラーパネルの例
try {
  await app.loadScene(sceneData);
} catch (err) {
  app.showErrorPanel(err, {
    title: "scene load failed"
  });
}
```

## モデル読み込み、スクリーンショット、およびデバッグ機能

`WebgApp` はアセットローダーの統一的な入口も提供しています。glTF、Collada、ModelAsset JSON を読み込む際は `loadModel()` を、Scene JSON を用いてシーン全体を構築する際は `loadScene()` を使用します。これにより、フォーマットごとの差異を意識せずにアセットを扱え、読み込み後のランタイムは `app.modelRuntime` や `app.sceneRuntime` に保持されます。

```js
const runtime = await app.loadModel("./assets/robot.gltf");
const sceneRuntime = await app.loadScene(sceneData);
```

スクリーンショットの保存も、`app.takeScreenshot()` を通じて簡単に行えます。このメソッドは直ちに PNG を生成するのではなく、次の `present()` 実行後に canvas 内容を保存するように予約します。

```js
app.attachInput({
  onKeyDown: (key, ev) => {
    if (ev.repeat) return;
    if (key === "s") {
      app.takeScreenshot({ prefix: "my_sample" });
    }
  }
});

app.takeScreenshot("still.png");
```

また、`app.attachInput()` の `onKeyDown` で受け取る `key` は、`InputController.normalizeKey()` によって正規化された文字列です。例えば、英字はすべて小文字で渡され、スペースキーは `"space"`、エスケープキーは `"escape"` として比較します。

デバッグ機能についても共通の操作が用意されています。通常、`F9` キーの後に `M` キーを押すことでデバッグモードを切り替えられます。まずは通常表示で動作を確認し、必要に応じてデバッグモードに切り替えて診断情報やパネルを確認するというフローが推奨されます。

## 実装時に注意すべき点

本章の内容を実践するにあたり、特に注意すべき点を整理します。

- 初期化順序の遵守：`await app.init()` が完了する前に `app.getGL()` や `app.space` にアクセスしてはいけません。これらは `init()` 内部で生成されるため、未初期化の状態ではエラーとなります。
- `Shape.endShape()` の呼び出し：`Shape` を定義した後は必ず `endShape()` を呼び出してください。これを忘れると GPU バッファが確定せず、正しく描画されません。
- 描画の三原則：`Shape` を作っただけでは表示されません。「`Node` に載せて `Space` に入れ、`eye` から描画する」という手順を徹底してください。
- UI の使い分け：長い説明文を HUD に詰め込まず、ヘルプパネルやダイアログ、固定パネルに適切に分散させてください。
- スクリーンショットのタイミング：`takeScreenshot()` は必ず `await app.init()` の後に呼び出してください。

`WebgApp` は、単一のサンプルを迅速に作成したい場合や、小規模なゲームを素早く立ち上げたい場合、あるいは HUD・入力・デバッグ機能をまとめて利用したい場合に最適なハイレベル（高レイヤー） API です。一方で、「3D 描画が内部的にどう動作しているか」を深く理解したい場合は、本章のローレベル（低レイヤー）な例や第4章の内容を先に精読することをお勧めします。

## まとめ

`WebgApp` は単なる便利クラスではなく、3D アプリケーション構築において繰り返される定型的な初期化と接続を構造化した、開発の入口となるクラスです。

ローレベル（低レイヤー）な構成では、`Screen`、`Space`、`Shape`、`Node`、`eye` を開発者が手動で接続しますが、`WebgApp` はその標準的なフローを整理して引き受けます。この構造を理解していれば、`WebgApp` が仕組みを隠蔽しているのではなく、構造を維持したまま開発効率を高めていることが分かるはずです。

本章では、標準カメラが固定視点であること、UI 表示を目的別に使い分けること、アセット読み込みの入口が統一されていること、そしてスクリーンショットやデバッグ機能が高レベル（高レイヤー） API として提供されていることを確認しました。これらの概念を把握しておくことで、次章以降の `EyeRig`、モデル読み込み、Scene JSON、UI 設計といった機能が、独立した部品ではなく「一つのアプリケーションを構成する一連の要素」として結びついて見えてくるでしょう。

次章では、視点操作の中核となる `cameraRig`、`cameraRod`、`eye` の 3 段構成と、`EyeRig` による高度な視点制御について詳しく解説します。
