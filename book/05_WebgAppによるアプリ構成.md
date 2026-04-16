# WebgAppによるアプリ構成

`WebgApp` クラスは、`webg` の中でも特に重要な機能です。標準的な 3D アプリケーションに必要となる機能をあらかじめまとめ、アプリを無理なく構築できるようにした、いわばフレームワーク的なクラスです。アプリを作成するたびに、`webg` の多くの機能の中から必要なものを一つひとつ探し出し、順序を考えながら組み立てていくのは、初学者にとっても経験者にとっても負担になります。`WebgApp` は、その負担を減らし、利用者がアプリの内容そのものに集中できるようにするためのクラスです。 

この章では、`webg/WebgApp.js` を初めて使う人に向けて、`WebgApp` が何を引き受け、何を簡潔にしてくれるのかを順を追って説明します。付録「API一覧」の `WebgApp` 項目や、第3章「3Dグラフィックスの基礎」、第4章「WebGPUとwebgの最小描画」を土台にしながら、まずは「3D シーンをどう考えるか」という根本から整理し、そのうえで `WebgApp` の意味へ進みます。視点リグの使い方を先に詳しく知りたい場合は、第6章「カメラ制御とEyeRig」を続けて読むと、`cameraRig`、`cameraRod`、`eye` の位置づけがつかみやすくなります。 

この章の目標は、`WebgApp` のメソッド名を暗記することではありません。まず、「形状を作る」「空間へ置く」「視点から見る」という 3D の基本をつかみ、そのうえで `WebgApp` が毎回の初期化や接続の手間をどのように減らしてくれるのかを理解することです。特にこの章では、ローレベルの構成と `WebgApp` を使った構成を見比べながら、どこが本質で、どこが補助なのかが分かるように進めていきます。操作説明の文章を短い HUD に押し込むより、`WebgApp.createHelpPanel()` のヘルプパネルで表示するほうが初学者にも読みやすい、という方針でこの章を進めます。 

## `WebgApp` を理解する前に、3D シーンの基本要素を押さえる
<!-- 図候補: WebgApp 全体構成図 -->

![WebgApp 全体構成図](fig05_01_webgapp_overview.jpg)

*WebgApp は、描画、scene graph、camera rig、入力、HUD、diagnostics をまとめて初期化し、利用者コードの入口を整理します。*

`WebgApp` を理解しやすくするためには、その前に `webg` の 3D シーンがどのような要素で成り立っているかを押さえておくのが近道です。`webg` の 3D シーンは、おおむね次のように考えると整理しやすくなります。`Shape` はどのような形か、`Node` はその形をどこに置くか、`Space` はシーン全体をどこで管理するか、`eye` はどこから見るか、という分担です。`WebgApp` は、この土台を毎回同じ順序で準備する補助クラスです。したがって、先にこの 4 つの役割を理解しておくと、`WebgApp` が単なる便利関数の集まりではなく、3D アプリの標準的な構成をまとめて扱うクラスであることが見えてきます。 

3D プログラムは最初は難しく見えますが、初学者向けに単純化すると、「何を置くか」「どこへ置くか」「どこから見るか」の 3 つに整理できます。たとえば、机の上に立方体のおもちゃを置き、それを少し離れた位置から見る場面を想像してください。おもちゃそのものの形が `Shape`、机の上のどこに置くかが `Node` の位置と回転、部屋全体が `Space`、どこから眺めるかが `eye`、それを画面へ映す窓が `Screen` です。`webg` では、この分担をクラスとして分けています。ここを最初に分けて理解すると、「なぜ `Shape` だけでは表示されないのか」「なぜ `Node` が必要なのか」が自然に見えてきます。 

あわせて、座標系の基礎もここでそろえておきます。`webg` の座標系は右手系で、`+X=右`、`+Y=上`、`+Z=前` です。回転用語は `head / pitch / bank` で、一般的な言い方では `yaw / pitch / roll` に対応します。回転ゼロのオブジェクトが向いている前方向は `[0, 0, 1]` であり、`head` を増やすと Y 軸まわりに回転し、前方向は右向きへ回っていきます。ここで重要になるのが `CoordinateSystem` です。`CoordinateSystem` は、位置、回転、スケール、親子関係を持つ変換の基底クラスであり、`Node` はその上に `Shape` を載せて描画できる機能を加えたクラスです。したがって、`CoordinateSystem` で学ぶ `setPosition()`、`setAttitude()`、`rotateY()`、`setScale()` は、そのまま `Node` にも使えます。 

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

このコードは画面には何も出しませんが、「3D オブジェクトをどこへ、どの向きで置くか」を先に考える練習になります。第3章の基礎説明と見比べながら読むと、`WebgApp` の話へ入ったあとも座標や回転の意味がぶれにくくなります。 

## `webg` の最小構成をクラスごとに見る

ここまでの話を踏まえて、`webg` の最小構成をクラスごとに整理してみます。`Screen` は canvas と WebGPU の入口です。描画結果を最終的に映す窓だと考えると分かりやすく、`clear()` と `present()` もここが担当します。`Shape` はメッシュとマテリアルを持つクラスで、立方体、球、外部モデルのメッシュなど、「何を描くか」を表します。ただし、`Shape` だけではシーンのどこにも置かれていません。まだ「形があるだけ」の状態です。`CoordinateSystem` は位置、回転、スケールを持つ変換の基盤であり、親子階層もここで扱います。`Node` は `CoordinateSystem` を継承し、さらに `Shape` を載せられるクラスです。`Space` はシーン全体を管理し、複数の `Node` をまとめて `draw(eye)` で描画します。`eye` も通常は `Node` であり、「どこから見るかを表す `Node`」を `Space.setEye()` して使います。 

この整理が見えてくると、3D を画面に出すまでの順序も自然に決まります。`Screen` を作る、シェーダーと投影行列を準備する、`Space` を作る、`eye` を置く、`Shape` を作る、`Node` を作って `Shape` を載せる、`screen.clear() -> space.draw(eye) -> screen.present()` の順で描画する、という流れです。この順序が分かると、あとで `WebgApp` が何を自動化しているのかもはっきり見えてきます。 

## ローレベルで立方体を 1 個表示する

では、`Screen`、`Shape`、`CoordinateSystem`、`Node` を明示的に使って、立方体を 1 個表示する例を見てみます。少し長めですが、3D シーンの構成要素を理解するには役立つ例です。 

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

この例を初学者向けに言い換えると、`Screen` は画面を用意し、`shader` と `projection` は 3D を 2D の画面へ投影する準備をし、`Space` はシーン全体の入れ物になり、`eye` はカメラの位置になり、`Shape` は立方体の見た目を表し、`CoordinateSystem` は立方体をどこへ向けるかの下準備をし、`Node` はその立方体を実際にシーンへ置くためのオブジェクトになります。ここで重要なのは、`Shape` を作っただけでは表示されないことです。`Node` に載せて `Space` に入れ、さらに `eye` から描画して初めて見えるようになります。ローレベルで一度この流れを体験しておくと、あとで `WebgApp` を使ったときに、「何が省略され、何が残っているのか」が分かりやすくなります。 

## 同じことを `WebgApp` で書く

ここからが `WebgApp` の要点です。上のローレベル例と同じ内容を、`WebgApp` を使って短く書くと、次のようになります。 

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

このコードでは、`Screen` の作成、シェーダーの作成と初期化、`Space` の作成、カメラリグと `eye` の作成、投影行列とビューポートの更新、入力の接続、HUD・デバッグ・診断情報の初期化、メインループの管理を `WebgApp` がまとめて引き受けます。つまり、`WebgApp` は 3D の仕組みを隠すクラスではありません。毎回同じ初期化を書かなくて済むようにし、利用者が本来作りたいアプリの処理へ集中できるようにする土台です。この意味で、`WebgApp` は `webg` を実際のアプリ制作へ結びつける中核的なクラスだと言えます。

`await app.init()` の中では、少なくとも `Screen` の作成、シェーダーの初期化、`Space` の作成、カメラリグ・カメラロッド・`eye` の作成、光源とフォグの初期設定、ビューポートに合わせた投影行列の更新、`InputController` の接続、`Message`・デバッグドック・固定フォーマットパネルの初期化が行われます。最初に押さえるべき `WebgApp` の中心は、`await app.init()` と `app.start({ onUpdate() {} })` の 2 つです。この 2 つの間にシーン構築を書けば、多くのサンプルを始められます。 

## コンストラクタと初期化後の主な使いどころ

`WebgApp` を使い始めるとき、最初に意識するのはコンストラクタで渡すオプションです。`document` には通常のブラウザの `document` を渡します。`messageFontTexture` は canvas HUD を使うなら指定しておくほうが安全です。`clearColor` は背景色であり、サンプル全体の印象を決める最初の入口になります。`shaderClass` は通常 `SmoothShader` が使われ、static mesh と skinned mesh を同じ入口で扱いたい場合に追加指定なしで進められるようになっています。面単位の陰影にしたいときも、まずは `SmoothShader` を使ったまま `flat_shading` を Shape ごとに切り替える考え方が自然です。教材用の `Phong` / `NormPhong` に全体の標準設定を切り替えたいときだけ `shaderClass` を明示します。`useMessage` は canvas HUD が不要なら `false` にできますが、最初は初期値のままで問題ありません。 

初期視点は `camera` で指定します。まずは `target` と `distance` を把握すれば十分です。ここで重要なのは、`WebgApp` の標準カメラが `follow` でも `orbit` でもないことです。`init()` では、`cameraRig -> cameraRod -> eye` という標準リグを 1 回作り、その位置と向きを `camera.target`、`camera.distance`、`camera.yaw`、`camera.pitch`、`camera.bank` で決めます。つまり、最初の状態は「固定された初期視点」であり、追従や周回視点が自動で始まるわけではありません。`follow` にしたいときは `followNode()` または `lockOn()` を明示的に使います。`orbit` にしたいときは、この章の後半に出てくる `EyeRig` の例のように `type: "orbit"` を与えて pointer 操作を接続します。最初の 1 画面を確実に見せたい段階では、この静的な初期視点のまま始めたほうが、カメラ制御由来の要因を減らしやすくなります。

```js
camera: {
  target: [0.0, 0.0, 0.0],
  distance: 12.0,
  yaw: 0.0,
  pitch: 0.0
}
```

ビューポート全体ではなく固定サイズで描画したいときは `fixedCanvasSize` を使います。教材ページの一部に canvas を埋め込み、ページ全体は通常どおりスクロールさせたいときは、`layoutMode: "embedded"` を併用します。このモードでは、canvas 本体だけでなく、`createHelpPanel()`、`startDialogue()`、`showFixedFormatPanel()`、touch controls も canvas の host 要素を基準に配置されるため、ページをスクロールしても一緒に移動します。ただし、ページ側の HTML / CSS が `html, body { overflow: hidden; }` のままだと、文書自体はスクロールしません。教材ページとして使う場合は、canvas を本文中へ置き、ページ全体の overflow は通常のままにしておきます。

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

`await app.init()` の後は、`app.screen`、`app.shader`、`app.space`、`app.cameraRig`、`app.cameraRod`、`app.eye`、`app.input`、`app.message` をサンプル側で使えます。特によく使うのは、`app.getGL()`、`app.space`、`app.eye` です。更新処理は `start()` に渡します。毎フレームの処理を `start()` にハンドラー関数として渡すことで、`WebgApp` が管理するメインループの中で実行できます。`ctx` には `app`、`space`、`eye`、`input`、`scenePhase`、`gameHud` などが入り、更新処理の中で必要な情報をまとめて参照できます。代表的なハンドラーは `onUpdate`、`onBeforeDraw`、`onAfterDraw3d`、`onAfterHud` の 4 つですが、最初は `onUpdate` だけで十分です。 

```js
const shape = new Shape(app.getGL());
const node = app.space.addNode(null, "player");
```

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

## カメラはまず標準リグから始める

`WebgApp.init()` は標準カメラリグを作ります。最初は `app.eye` をそのまま使えば十分です。この標準リグは、`cameraRig` を `camera.target` の位置へ置き、`eye` を `camera.distance` だけ前後方向へ離した静的な視点です。ここでは `EyeRig` はまだ使っていないため、ドラッグで自動的に orbit したり、target node を自動的に follow したりはしません。言い換えると、`WebgApp` の通常状態は「固定された初期視点」であり、`follow` は `followNode()` / `lockOn()` を呼んだときだけ有効になります。`orbit` も `EyeRig` を作って `attachPointer()` したときに初めて動きます。この違いを先に意識しておくと、「なぜドラッグしても視点が回らないのか」「なぜ target を登録していないのに追従しないのか」といった点で迷いにくくなります。

周回視点のカメラが必要になったら、`await app.init()` のあとで、いま使っている `WebgApp` ベースのアプリに次の `EyeRig` のコードを追記します。これは、`WebgApp` が用意した `app.cameraRig`、`app.cameraRod`、`app.eye` をそのまま利用して、「固定された初期視点」を pointer で回せる orbit camera に切り替える例です。詳しい意味づけは次章で扱いますが、この章では「標準リグの上に orbit を載せられる」という関係だけ押さえておけば十分です。

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

## HUD、対話、エラー表示をどう使い分けるか

`WebgApp` は、描画だけでなく表示まわりの補助もまとめて扱います。ここでは、何をどこへ表示するかという観点で整理しておきます。操作説明の文章は、`createHelpPanel()` を使って表示するのが自然です。これは左上にヘルプパネルを表示し、`Hide Help` / `Show Help` ボタンで本文を折りたためます。初学者向けのサンプルや教材用のサンプルでは、操作説明を常時 canvas に焼き込むより、このヘルプパネルのほうが読みやすく、画面も散らかりにくくなります。

```js
app.createHelpPanel({
  id: "sampleHelpOverlay",
  lines: [
    "Drag: orbit camera",
    "Wheel: zoom",
    "Space: pause"
  ]
});
```

一方、現在値のように短く更新される情報は HUD に向いています。操作説明はヘルプパネル、現在値の表示は HUD として分けると整理しやすくなります。パラメータが多いサンプルでは、`setHudRows()` や `setControlRows()` を使うと、1 行に 1 パラメータという形にそろえやすくなります。会話やチュートリアルのような UTF-8 テキストを見せたい場合は `startDialogue()` を使い、長いエラーメッセージは HUD に入れず `showErrorPanel()` や `showFixedFormatPanel()` のような固定パネル側へ分けるほうが読みやすくなります。この使い分けは第14章「UI表示の設計」でも整理されていますが、この章の段階では、「短い現在値は HUD、長い説明は help / dialogue / fixed panel」という分け方を押さえておけば十分です。

```js
app.setStatusLines([
  `PHASE ${phase}`,
  `LIVES ${lives}`
], {
  anchor: "top-left",
  x: 0,
  y: 0
});
```

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

```js
try {
  await app.loadScene(sceneData);
} catch (err) {
  app.showErrorPanel(err, {
    title: "scene load failed"
  });
}
```

## モデルやシーンの読み込み、スクリーンショット、デバッグ

`WebgApp` は、ローダーの統一的な入口も持っています。glTF、Collada、ModelAsset JSON を読み込むときは `loadModel()` を使い、Scene JSON をまとめて構築するときは `loadScene()` を使います。この 2 つは、読み込みの入口をそろえるためのものです。フォーマットごとの差をサンプル側で強く意識せずに扱え、読み込み後のランタイムは `app.modelRuntime` と `app.sceneRuntime` に保持されます。 

```js
const runtime = await app.loadModel("./assets/robot.gltf");
```

```js
const sceneRuntime = await app.loadScene(sceneData);
```

`WebgApp` を使う場合は、スクリーンショットの保存も `Screen` を直接たどるのではなく、`app.takeScreenshot()` から始められます。このヘルパーは、その場で直ちに PNG を生成するのではなく、次の `present()` のあとに現在の canvas 内容を保存するよう予約します。通常のサンプルでは、キー入力の中から呼び出せば十分です。保存名を完全に固定したいときは文字列をそのまま渡せます。ここでも、内部構造へ直接触れず、高レベル API だけで完結できるようになっていることが分かります。 

`app.attachInput()` の `onKeyDown(key, ev)` に渡る `key` は、生の `KeyboardEvent.key` ではなく、`InputController.normalizeKey()` によって正規化された比較名です。英字は lower-case で渡り、`Space` は `" "` ではなく `space`、`Esc` は `escape` として比較します。キー名の詳しい一覧は第16章「タッチ機能と入力」を参照してください。

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

```js
app.takeScreenshot("still.png");
```

デバッグについても、`WebgApp` は共通操作を持っています。通常は、`F9` のあとに `M` を押すとデバッグモードを切り替えられます。最初は通常表示で動作を確認し、必要なときだけデバッグモードへ入り、問題があれば診断情報やパネルを見る、という理解で十分です。パラメータ調整サンプルでは、ヘルプパネル、HUD、デバッグドックを分けて使うと見通しがよくなります。 

## 初学者がつまずきやすい点と、この章の位置づけ

ここまで読んだ段階で、初学者が特につまずきやすい点を整理しておきます。まず、`init()` 前に `app.getGL()` や `app.space` を使ってはいけません。これらは `init()` の中で作られるため、先に参照すると未初期化の状態です。次に、`Shape.endShape()` を忘れないことが重要です。`Shape` を作ったあとに `endShape()` を呼ばないと、GPU バッファが確定しません。また、`Shape` だけでは表示されません。表示するには `Node` に載せて `Space` に入れ、`eye` から描画する必要があります。`CoordinateSystem` も描画オブジェクトではなく、変換の基盤です。画面に見せたいときは通常 `Node` を使います。さらに、長い説明を HUD に入れないことも大切です。操作説明は `createHelpPanel()`、会話は `startDialogue()`、エラー全文は `showErrorPanel()` へ分けるほうが読みやすくなります。スクリーンショットも `takeScreenshot()` を `await app.init()` のあとで使う、という順序を守る必要があります。

どのような場面で `WebgApp` を使うべきかという問いに対しては、サンプルを 1 本作りたいとき、小さなゲームを素早く立ち上げたいとき、HUD・入力・デバッグもまとめて使いたいとき、モデルやシーンファイルを素早く読み込みたいとき、という答えになります。逆に、「3D がどのように表示されるか」を最初から理解したい段階では、本章のローレベルの例や第4章の例を先に読む価値があります。つまり、`WebgApp` は実用に近い入口であり、ここを理解すると、以後の章で扱うモデル、シーン、UI、入力、デバッグといった機能が、ばらばらの部品ではなく「一つのアプリを構成する要素」として見えやすくなります。 

## まとめ

この章で最も大事なのは、`WebgApp` を「便利だから使うクラス」とだけ見ないことです。`WebgApp` は、3D アプリを組み立てるたびに繰り返していた初期化と接続をまとめ、利用者がアプリの内容そのものへ集中できるようにする入口です。ローレベルの構成では、`Screen`、`Space`、`Shape`、`Node`、`eye` を自分でつなぎます。`WebgApp` は、その流れを壊すのではなく、標準的な形へ整理して引き受けます。ここが見えると、`WebgApp` は 3D の仕組みを隠すものではなく、構造を保ったまま使いやすくするものだと理解しやすくなります。

また、この章では、`WebgApp` の標準カメラが固定された初期視点であり、`orbit` や `follow` は明示的に追加すること、表示は HUD、help panel、dialogue、fixed panel に分けて考えること、`loadModel()` や `loadScene()` が読み込みの入口をそろえていること、`takeScreenshot()` やデバッグ操作も高レベル API としてまとめられていることを確認しました。こうした考え方を先に押さえておくと、第6章の `EyeRig`、第10章のモデル読み込み、第11章の Scene JSON、第14章の UI 設計が一続きの構造として見えてきます。次章では、その中でも特に視点操作に関わる `cameraRig`、`cameraRod`、`eye` の 3 段構成と、`EyeRig` の意味を詳しく見ていきます。 
