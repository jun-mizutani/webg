# WebgAppによるアプリ構成

## WebgApp で何が簡単になるのか

第4章では、`Screen`、`SmoothShader`、`Space`、`Shape`、`eye` を順番に用意し、最後に `clear -> draw -> present` を呼び出すことで、WebGPU 画面へ 3D オブジェクトを描画しました。

この流れは `webg` の土台を理解するうえで重要です。一方で、実際のアプリケーションでは、画面の初期化、標準シェーダー、シーン、カメラ、入力、HUD、診断情報、リサイズ対応、フレームループといった周辺処理を毎回組み立てることになります。

`WebgApp` は、この共通部分をまとめた高レイヤー（ハイレベル）の入口です。

| 第4章で自分で用意したもの | `WebgApp` で使うもの |
| :--- | :--- |
| `Screen` の作成と `await screen.ready` | `await app.init()` |
| `SmoothShader` の作成と初期化 | `app.shader` |
| `Space` の作成 | `app.space` |
| `eye` の作成と `space.setEye()` | `app.eye` |
| projection / viewport の更新 | `app.updateProjection()` と内部レイアウト処理 |
| `requestAnimationFrame` のループ | `app.start()` |
| `screen.clear()` / `space.draw()` / `screen.present()` | `WebgApp` の標準フレーム処理 |
| 入力、HUD、診断、デバッグ表示 | `app.input`、`app.message`、Diagnostics、DebugDock |

つまり、`WebgApp` を使うと、開発者は「何を置くか」「毎フレームどう動かすか」に集中しやすくなります。

ただし、`WebgApp` は何でも持った巨大な便利 API ではありません。アプリケーションの土台を作ることが主な役割です。ヘルプ、エラー表示、チュートリアル、ゲームルール、メニュー構造などは、`OverlayPanel` やサンプル側の controller / helper と組み合わせて作ります。

## 最小の WebgApp アプリ

`WebgApp` を使う最小の流れは、次の 4 段階です。

1. `new WebgApp(...)` で設定を渡す。
2. `await app.init()` で GPU、シーン、カメラ、入力、HUD を準備する。
3. `app.space` にオブジェクトを置く。
4. `app.start({ onUpdate })` でフレームループを開始する。

```js
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";

const app = new WebgApp({
  document,
  messageFontTexture: "../../webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 24.0,
    pitch: -12.0
  }
});

await app.init();

const shape = new Shape(app.getGPU());
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
  onUpdate({ deltaSec }) {
    box.rotateY(0.8 * deltaSec);
    box.rotateX(0.3 * deltaSec);
  }
});
```

この例で開発者が直接書いているのは、立方体の形状を作る処理、シーンへ配置する処理、毎フレーム回転させる処理です。`Screen`、標準シェーダー、`Space`、カメラ、入力管理、HUD、診断機能、`requestAnimationFrame` の予約は `WebgApp` がまとめて扱います。

## 基本ライフサイクル

`WebgApp` の利用順序は、次の形で覚えておくと安全です。

```js
const app = new WebgApp(options);
await app.init();

// app.getGPU(), app.space, app.eye, app.input, app.message が使える
// Shape や Node を作り、シーンを組み立てる

app.start({
  onUpdate(ctx) {
    // 毎フレームの更新
  }
});
```

### constructor は設定を保持する

`new WebgApp(options)` の時点では、GPU デバイス、`Screen`、`Space`、標準シェーダー、`eye` はまだ利用できません。constructor は、後続の `init()` で使う設定と内部状態を用意する段階です。

代表的な option は次の通りです。

| option | 役割 |
| :--- | :--- |
| `document` | DOM 操作に使用する document |
| `messageFontTexture` | HUD 文字表示に使うフォントテクスチャ |
| `clearColor` | 背景色 |
| `camera` | 標準カメラの初期状態 |
| `viewAngle` | 投影行列の視野角 |
| `light` | 標準ライト設定 |
| `fog` | 標準フォグ設定 |
| `attachInputOnInit` | `init()` 内で入力を接続するか |
| `autoDrawScene` | フレーム内で `space.draw(app.eye)` を自動実行するか |
| `autoDrawBones` | スケルトンボーンを自動描画するか |
| `layoutMode` | `viewport` または `embedded` |
| `renderMode` | `ondemand` または `continuous` |
| `uiTheme` | DebugDock / OverlayPanel のテーマ |

### init の後にアプリの土台が使える

`await app.init()` は、`WebgApp` における大きな境界線です。ここで `Screen` の準備を待ち、シェーダー、`Space`、標準カメラリグ、入力、HUD、診断機能などを作成します。

`init()` 後によく使うものは次の通りです。

| プロパティ / メソッド | 用途 |
| :--- | :--- |
| `app.getGPU()` | `Shape` や低レイヤーリソース作成に使う GPU context |
| `app.space` | ノード、形状、モデルを配置するシーン |
| `app.eye` | 現在の視点ノード |
| `app.input` | 入力状態 |
| `app.message` | HUD / メッセージ表示 |
| `app.shader` | 標準シェーダー |
| `app.screen` | 描画先の `Screen` |

`app.getGPU()`、`app.space`、`app.eye` などは、必ず `await app.init()` の後に使ってください。`init()` 前には実体がまだ作られていないためです。

## app.start と onUpdate

`app.start()` は、`WebgApp` のフレームループを開始します。内部では `requestAnimationFrame` から渡される時刻を受け取り、前フレームからの経過時間を計算し、更新、描画、HUD、提示を順番に進めます。

`onUpdate` は、その中で「描画前にシーンの状態を 1 フレームぶん進める場所」です。画面へ描く処理そのものではなく、次に描かれるべき状態を作る処理を書きます。

```js
app.start({
  onUpdate(ctx) {
    box.rotateY(0.8 * ctx.deltaSec);
  }
});
```

たとえば次のような処理は、`onUpdate` に書くのが自然です。

- 入力を見てプレイヤーを動かす。
- ノードの位置や回転を更新する。
- タイマーやクールダウンを進める。
- アプリのフェーズに応じて処理を分ける。
- HUD に表示する数値や状態を更新する。

一方で、次の処理は別の場所に置くと整理しやすくなります。

| 処理 | 書く場所 |
| :--- | :--- |
| 初期化、Shape 作成、モデル読み込み | `await app.init()` の後、`app.start()` の前 |
| 毎フレームの状態更新 | `onUpdate` |
| 3D シーン描画前の特殊な描画 | `onBeforeDraw` |
| 3D シーン描画後のポストプロセス | `onAfterDraw3d` |
| HUD 描画後の追加表示 | `onAfterHud` |

`onUpdate()` が `true` を返すと、フレームループは停止します。

```js
app.start({
  onUpdate() {
    if (gameOver) {
      return true;
    }
    return false;
  }
});
```

## フレームコンテキスト ctx

`onUpdate(ctx)` の `ctx` は、そのフレームで使いやすい情報をまとめたフレームコンテキストです。`WebgApp` が毎フレーム作成し、`onUpdate`、`onBeforeDraw`、`onAfterDraw3d`、`onAfterHud` に渡します。

主なプロパティは次の通りです。

| プロパティ | 意味と使いどころ |
| :--- | :--- |
| `app` | 現在の `WebgApp` 自身。HUD、フェーズ、スクリーンショットなどに使う |
| `scenePhase` | `"title"`、`"gameplay"`、`"result"` などの大まかな進行状態 |
| `timeMs` | `requestAnimationFrame` から渡された時刻。単位はミリ秒 |
| `timeSec` | `timeMs` を秒にした値。周期演出に使いやすい |
| `deltaSec` | 前フレームからの経過秒数。移動、回転、タイマー更新に使う |
| `screen` | 描画先の `Screen` |
| `shader` | 標準シェーダー |
| `space` | シーン内のノードや形状を管理する `Space` |
| `eye` | 現在のカメラ視点 |
| `cameraRig` | カメラ全体の土台 |
| `cameraRod` | カメラ距離を表すアーム |
| `cameraTarget` | 現在のカメラ注視点の配列コピー |
| `cameraFollow` | カメラ追従状態 |
| `input` | キー、ポインター、アクションの入力状態 |
| `projection` | 現在の projection matrix |

最初のうちは、`deltaSec`、`timeSec`、`input`、`space`、`app` を中心に見ると十分です。

```js
app.start({
  onUpdate(ctx) {
    if (ctx.input.has("arrowright")) {
      player.move(3.0 * ctx.deltaSec, 0.0, 0.0);
    }

    box.rotateY(1.2 * ctx.deltaSec);

    ctx.app.message.setLines("status", [
      `phase: ${ctx.scenePhase}`,
      `time: ${ctx.timeSec.toFixed(1)}`
    ]);
  }
});
```

### onUpdate({ deltaSec }) という書き方

サンプルでは、次のような書き方もよく使います。

```js
app.start({
  onUpdate({ deltaSec }) {
    box.rotateY(0.8 * deltaSec);
  }
});
```

これは `webg` 独自の構文ではなく、JavaScript の分割代入です。次のコードと同じ意味です。

```js
app.start({
  onUpdate(ctx) {
    const deltaSec = ctx.deltaSec;
    box.rotateY(0.8 * deltaSec);
  }
});
```

複数の値を取り出すこともできます。

```js
app.start({
  onUpdate({ deltaSec, timeSec, input, app }) {
    if (input.has("space")) {
      app.setScenePhase("jump");
    }

    box.setPosition(0.0, Math.sin(timeSec * 2.0) * 0.5, 0.0);
    box.rotateY(1.0 * deltaSec);
  }
});
```

`ctx` 全体を何度も使う場合は `onUpdate(ctx)`、必要な値が少ない場合は `onUpdate({ deltaSec, input })` のように書くと読みやすくなります。

### deltaSec を使う理由

`deltaSec` は、前フレームから現在のフレームまでに経過した秒数です。

毎フレーム固定値で回転させると、フレームレートによって速度が変わります。

```js
// 1 フレームごとに 0.02 回す。
// 30fps と 144fps では 1 秒あたりの回転量が変わる。
box.rotateY(0.02);
```

`deltaSec` を掛けると、「1 秒あたりどれだけ進むか」という指定になります。

```js
// 1 秒あたり 1.2 回す。
box.rotateY(1.2 * deltaSec);
```

移動やタイマーも同じ考え方です。

```js
app.start({
  onUpdate({ deltaSec, input }) {
    if (input.has("arrowright")) {
      player.move(3.0 * deltaSec, 0.0, 0.0);
    }

    cooldown -= deltaSec;
  }
});
```

`timeSec` は「アプリ全体の時刻」に基づく演出に向いています。

```js
app.start({
  onUpdate({ timeSec }) {
    box.setPosition(0.0, Math.sin(timeSec * 2.0) * 0.5, 0.0);
  }
});
```

`deltaSec` は「このフレームで何秒ぶん進めるか」、`timeSec` は「いま全体時間の何秒目か」と考えると使い分けやすくなります。

### 物理エンジンに渡す時間

`PhysicsSpace.step(deltaMs)` や Scene JSON runtime の `sceneRuntime.stepPhysics(deltaMs)` は、名前の通りミリ秒単位の `deltaMs` を受け取ります。一方、`WebgApp` の `ctx` には秒単位の `deltaSec` が入っています。

そのため、`onUpdate` から物理を進める場合は、`deltaSec` を 1000 倍して渡します。

```js
import PhysicsSpace from "../../webg/PhysicsSpace.js";

const physics = new PhysicsSpace({
  fixedTimeStepMs: 1000.0 / 60.0,
  maxSubSteps: 5
});

app.start({
  onUpdate({ deltaSec }) {
    const deltaMs = deltaSec * 1000.0;
    physics.step(deltaMs);
  }
});
```

`PhysicsSpace.step(deltaMs)` は、渡された可変の `deltaMs` を内部の accumulator に溜め、`fixedTimeStepMs` ごとに `stepFixed(dtSec)` を必要回数だけ実行します。つまり、`onUpdate` 側では「前フレームから何ミリ秒経ったか」を渡し、物理空間側が安定しやすい固定ステップへ分配します。

`step()` の戻り値は、実際に進めた fixed step の回数です。長い停止から復帰した場合などは、`maxSubSteps` によって一度に進める回数が抑えられます。

```js
app.start({
  onUpdate({ deltaSec }) {
    const deltaMs = Math.min(deltaSec * 1000.0, 80.0);
    const stepCount = physics.step(deltaMs);

    app.message.setLine("physics", `physics steps: ${stepCount}`);
  }
});
```

通常の移動や回転は `deltaSec`、`PhysicsSpace.step()` は `deltaMs`、`stepFixed(dtSec)` の内部処理は秒単位、という単位の違いに注意してください。物理の詳細は第26章で扱います。

## 入力を扱う

`WebgApp` は内部に `InputController` を保持しています。`attachInputOnInit` が true（既定値）の場合、`init()` 内で `app.attachInput()` が自動的に呼ばれます。

`ctx.input` を使うと、押されているキーを毎フレーム確認できます。

```js
app.start({
  onUpdate({ deltaSec, input }) {
    if (input.has("arrowleft")) {
      player.move(-3.0 * deltaSec, 0.0, 0.0);
    }
    if (input.has("arrowright")) {
      player.move(3.0 * deltaSec, 0.0, 0.0);
    }
  }
});
```

キー名で直接判定するのではなく、抽象化されたアクション名で扱いたい場合は `registerActionMap()` を使います。

```js
app.registerActionMap({
  jump: ["space", "enter"],
  reset: ["r"]
});

app.start({
  onUpdate() {
    if (app.wasActionPressed("jump")) {
      player.jump();
    }
    if (app.wasActionPressed("reset")) {
      resetStage();
    }
  }
});
```

`wasActionPressed()` は「押された瞬間」を扱う用途に向いています。押されている間ずっと移動させたい場合は、`input.has()` のような継続入力を使います。

`app.attachInput()` は、単に入力を接続するだけでなく、`F9` を接頭辞とするデバッグキーも処理します。既定では次の順次入力が使えます。

| 操作 | 意味 |
| :--- | :--- |
| `F9` -> `M` | デバッグ / リリースモードの切り替え |
| `F9` -> `C` | 診断サマリーをコピー |
| `F9` -> `V` | 診断 JSON をコピー |

独自のキーハンドラを追加する場合も、デバッグキーを維持したいなら `app.attachInput()` を使うのが基本です。

```js
app.attachInput({
  onKeyDown: (key, ev) => {
    if (ev.repeat) return;
    if (key === "s") {
      app.takeScreenshot({ prefix: "sample" });
    }
  }
});
```

## カメラの基本

`WebgApp` の標準カメラは、`cameraRig -> cameraRod -> eye` の 3 段構成です。

- `cameraRig`: 注視点や全体回転を持つ土台。
- `cameraRod`: カメラまでの距離を表すアーム。
- `eye`: 実際の視点ノード。

constructor の `camera` option で初期状態を指定できます。

```js
const app = new WebgApp({
  document,
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 24.0,
    pitch: -12.0,
    roll: 0.0
  }
});
```

`init()` の中でこの構成が作られ、`app.eye` が `app.space` の視点として登録されます。

マウスやタッチで周回できる Orbit カメラが必要な場合は、`await app.init()` の後に `createOrbitEyeRig()` を呼び出します。

```js
app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  minDistance: 4.0,
  maxDistance: 18.0
});
```

このメソッドは標準リグの上に `EyeRig` を構築し、ポインター操作も接続します。`WebgApp` が毎フレーム `EyeRig` を更新するため、サンプル側で個別に `update()` を呼ぶ必要はありません。

フォロー、ロックオン、シェイクには次の補助機能があります。

- `followNode()`: 対象ノードを滑らかに追従する。
- `lockOn()`: 対象へ素早く視点を合わせる。
- `clearCameraTarget()`: 追従やロックオンを解除する。
- `shakeCamera()`: 短い衝撃演出を発生させる。

カメラ制御の詳細は第6章で扱います。

## ライトとフォグ

`WebgApp` の標準ライトは、教材サンプルやビューアで対象を確認しやすい `eye-fixed` が既定です。

```js
const app = new WebgApp({
  document,
  light: {
    mode: "eye-fixed",
    position: [120.0, 180.0, 140.0, 1.0],
    type: 1.0
  }
});
```

シーン内の特定ノードに結び付いたライトにしたい場合は `world-node` を使います。

```js
const app = new WebgApp({
  document,
  light: {
    mode: "world-node",
    nodeName: "sunLight",
    position: [80.0, 120.0, 60.0, 1.0],
    type: 1.0
  }
});
```

`init()` 後に設定を切り替える場合は、`setEyeLight()` または `setWorldLight()` を使用します。フォグは constructor option と `setFog()` の両方で指定できます。

## HUD と Overlay

`WebgApp` は、Canvas 上へ描く HUD 用に `app.message` と `app.hudMessage` を持っています。

短い状態表示には `app.message.setLine()` / `setLines()` が便利です。

```js
app.start({
  onUpdate({ app, deltaSec }) {
    app.message.setLines("status", [
      "WebgApp sample",
      `delta: ${deltaSec.toFixed(3)} sec`
    ], {
      anchor: "top-left",
      x: 0,
      y: 0
    });
  }
});
```

項目名と値を並べたい場合は `setHudRows()` や `setControlRows()` を使います。短時間の通知には `pushToast()` や `flashMessage()` を使います。

長い説明、ヘルプ、エラー、選択肢付きのパネルには DOM ベースの `OverlayPanel` を使います。

```js
app.showOverlayPanel({
  id: "help",
  title: "Help",
  lines: [
    "Drag: orbit",
    "R: reset"
  ],
  anchor: "top-left",
  collapsible: true
});
```

同じ `id` で `showOverlayPanel()` を呼ぶと、既存のパネルが更新されます。隠す場合は `hideOverlayPanel()`、削除する場合は `removeOverlayPanel()` を使います。

ヘルプやエラー表示の定型オプションが必要な場合は、`OverlayPanelPresets.js` の helper を使います。

```js
import { buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";

app.showOverlayPanel(buildHelpPanelOptions({
  id: "help",
  lines: ["Drag: orbit", "R: reset"]
}));
```

`WebgApp` はヘルプ専用 API、エラー専用 API、会話専用 API を持ちません。表示の枠は `OverlayPanel`、文章のキューや分岐はアプリ側 controller、という分担にします。

## 必要になったら使う機能

`WebgApp` には、最小アプリを越えた機能も統合されています。最初からすべてを覚える必要はありません。必要になったところから使います。

| 機能 | 用途 |
| :--- | :--- |
| `layoutMode: "viewport"` | canvas と overlay を画面全体基準で配置する |
| `layoutMode: "embedded"` | 書籍や教材ページ内に canvas を埋め込む |
| Diagnostics | 環境チェックやランタイム警告を記録する |
| DebugDock | 診断情報を開発用 UI として表示する |
| `loadModel()` | glTF / Collada / ModelAsset JSON を読み込む |
| `loadScene()` | Scene JSON を読み込む |
| `validateScene()` | Scene JSON の妥当性を確認する |
| `createTween()` | 値を時間で補間する |
| `createParticleEmitter()` | 軽量なパーティクル演出を作る |
| `scenePhase` | `"title"`、`"gameplay"` などの進行状態を持つ |
| `saveProgress()` / `loadProgress()` | 進行状況を保存 / 読み込みする |
| `takeScreenshot()` | 描画後の canvas を画像として保存する |

`loadModel()` の例です。

```js
const runtime = await app.loadModel("./assets/robot.glb", {
  format: "gltf"
});
```

`format` には `"gltf"`、`"collada"`、`"json"` を指定できます。シーン全体を宣言的に読み込む場合は `loadScene()` を使います。

## フレーム処理の詳しい順序

基本的なアプリでは、`onUpdate` に更新処理を書き、`autoDrawScene: true` のまま使えば十分です。ここから先は、ポストプロセスや独自レンダーパスを組み込むときに必要になります。

`WebgApp.frame()` は概ね次の順序で進みます。

1. ページが非表示または非フォーカスなら、`ondemand` モードでは休止する。
2. 前フレームからの `deltaSec` を計算する。
3. 管理中の `EyeRig` を更新する。
4. フレームコンテキスト `ctx` を作成する。
5. `onUpdate(ctx)` を呼び出す。
6. Tween を更新する。
7. `Space` のアニメーションを更新する。
8. パーティクルエミッターを更新する。
9. カメラ追従、ロックオン、シェイクを反映する。
10. `screen.clear()` を呼び出す。
11. `onBeforeDraw(ctx)` を呼び出す。
12. `autoDrawScene` が true なら `space.draw(app.eye)` を実行する。
13. `autoDrawBones` が true ならボーンを描画する。
14. `onAfterDraw3d(ctx)` を呼び出す。
15. パーティクルを描画する。
16. HUD / メッセージ / トーストを描画する。
17. `onAfterHud(ctx)` を呼び出す。
18. `screen.present()` を呼び出す。
19. 入力のワンショット状態を次フレームへ進める。
20. 継続中なら次フレームを予約する。

ポストプロセスやオフスクリーンレンダーターゲットを使用する場合は、`autoDrawScene: false` を指定し、描画順を自前で管理します。

```js
const app = new WebgApp({
  document,
  autoDrawScene: false
});

await app.init();

app.start({
  onBeforeDraw({ space, eye }) {
    offscreenRenderer.drawScene(space, eye);
  },
  onAfterDraw3d() {
    postprocess.composeToScreen();
  }
});
```

## 典型的な構成例

ここまでの要素を組み合わせると、標準的なサンプルの骨格は次のようになります。

```js
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import { buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";

const app = new WebgApp({
  document,
  messageFontTexture: "../../webg/font512.png",
  clearColor: [0.06, 0.08, 0.12, 1.0],
  debugTools: {
    mode: "release",
    system: "sample",
    source: "samples/sample/main.js"
  },
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 24.0,
    pitch: -12.0
  }
});

await app.init();

app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0
});

const shape = new Shape(app.getGPU());
shape.applyPrimitiveAsset(Primitive.cube(2.0, shape.getPrimitiveOptions()));
shape.endShape();
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});

const node = app.space.addNode(null, "box");
node.addShape(shape);

app.showOverlayPanel(buildHelpPanelOptions({
  id: "help",
  lines: [
    "Drag: orbit",
    "R: reset",
    "F9 then M: debug mode"
  ]
}));

app.registerActionMap({
  reset: ["r"]
});

app.start({
  onUpdate({ deltaSec, app }) {
    if (app.wasActionPressed("reset")) {
      node.setAttitude(0.0, 0.0, 0.0);
    }

    node.rotateY(0.8 * deltaSec);
    node.rotateX(0.3 * deltaSec);

    app.message.setLines("status", [
      "WebgApp sample",
      `debug=${app.getDebugMode()}`
    ], {
      anchor: "top-left",
      x: 0,
      y: 0
    });
  }
});
```

## 実装時のチェックリスト

`WebgApp` を使っていて何も表示されない、動かない、入力が効かない場合は、まず次を確認してください。

- `await app.init()` の完了後に `app.getGPU()`、`app.space`、`app.eye` を使っているか。
- `Shape` に頂点やプリミティブを追加した後、`shape.endShape()` を呼んでいるか。
- 作成した `Shape` を `Node` に追加し、その `Node` を `app.space` 上に作っているか。
- 毎フレームの移動や回転に `deltaSec` を使っているか。
- `PhysicsSpace.step()` に渡す値は `deltaSec` ではなく `deltaSec * 1000.0` の `deltaMs` になっているか。
- 入力の「押された瞬間」と「押されている間」を使い分けているか。
- Orbit カメラが必要な場合、`app.createOrbitEyeRig()` を呼んでいるか。
- 長い説明やヘルプを HUD ではなく `OverlayPanel` に出しているか。
- カスタムレンダーパスを使う場合、`autoDrawScene: false` が必要か確認しているか。
- デバッグキーを維持したい独自入力は `app.attachInput()` 経由で接続しているか。

## まとめ

`WebgApp` は、`webg` でアプリケーションを作るための標準的な土台です。`Screen`、シェーダー、`Space`、カメラ、入力、HUD、診断機能、フレームループをまとめ、開発者がシーン構築と更新処理に集中できるようにします。

最初に覚える流れは、`new WebgApp()`、`await app.init()`、`app.space` への配置、`app.start({ onUpdate })` の 4 つです。

`onUpdate` では、描画前にシーンの状態を 1 フレームぶん進めます。移動や回転には `ctx.deltaSec` を使い、必要な場合は `onUpdate({ deltaSec, input, app })` のように分割代入で取り出します。物理エンジンへ渡す場合は、`deltaSec` をミリ秒へ変換して `physics.step(deltaSec * 1000.0)` とします。

次章では、この `WebgApp` が作る `cameraRig -> cameraRod -> eye` を土台として、`EyeRig` による Orbit、Follow、First-person などのカメラ制御を詳しく扱います。
