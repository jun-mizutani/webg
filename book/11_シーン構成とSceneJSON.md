# シーン構成とScene JSON

この章では、Scene JSON が何を表し、どの段階で検証され、どの段階で `WebgApp` 上の実体へ変わるのかを見ていきます。第10章の `ModelAsset` は、1 モデル分の共通表現でした。これに対して、この章で扱う Scene JSON は、そのモデルやプリミティブ、カメラ、HUD、入力をまとめた「シーン全体の初期状態」の表現です。3D アプリの初期状態は、モデル 1 個だけでは決まりません。カメラの初期向き、HUD の表示、キーとアクションの対応、プリミティブやモデルの配置、必要であれば tileMap まで、複数の要素を一緒に決める必要があります。`webg` では、その「シーン全体の初期状態」を JSON としてまとめるのが Scene JSON であり、それを保持するのが `SceneAsset`、実際にアプリへ構築するのが `SceneLoader` です。

この章で最初に押さえたいのは、Scene JSON は「ゲームロジック全体」ではなく、シーンの初期状態を宣言するデータだということです。Scene JSON は、カメラ、HUD、入力、プリミティブ、モデル、tileMap を「起動時にどう置くか」という視点でまとめるデータです。ゲームルールや毎フレームの分岐までは持ちません。ロジック本体は JavaScript 側に残し、Scene JSON には初期配置と宣言だけを持たせるのが基本になります。さらに、`SceneAsset` は保存、読み込み、検証、build の入口であり、`SceneLoader` はプリミティブ、モデル、tileMap を同じシーン構築フローへそろえます。入力についても、`input.bindings` は宣言だけを持ち、実処理は `sceneRuntime.createInputHandler(actionHandlers)` を通して JavaScript 側へ渡します。つまり Scene JSON は、「配置と初期状態を宣言する層」として理解するのがもっとも整理しやすい入口です。

また、Scene JSON を使うときは、次の順で考えると迷いにくくなります。まず Scene JSON または JavaScript オブジェクトを `SceneAsset` として持ち、`validate()` または `assertValid()` で構造を確認します。次に `build(target)` または `app.loadScene(scene)` でシーンを実体化し、`sceneRuntime.getEntry(id)` や `sceneRuntime.createInputHandler()` で JavaScript 側の処理へつなぎます。必要なら `sceneRuntime.update()` を毎フレーム呼んでアニメーションを進めます。つまり、Scene JSON は「シーン全体の初期配置表」であり、`SceneLoader` はその配置表をランタイムへ変換する層です。ここを最初に押さえると、`ModelAsset` と `SceneAsset` の役割も混ざりにくくなります。

## なぜ Scene JSON を使うのか
<!-- 図候補: 図11-1 Scene JSON の守備範囲図 -->

![図11-1 Scene JSON の守備範囲図](fig11_01_scenejson_scope.jpg)

*図11-1 Scene JSON は、モデル 1 体ではなく、camera、HUD、input、primitive、model、tileMap を含むシーン全体の初期状態を表します。*

3D アプリでは、1 つのモデルを表示できても、それだけではサンプルやゲームは完成しません。カメラの向き、画面左上のガイドテキスト、どのキーがどのアクション名へ対応するか、地面をプリミティブで作るのか tileMap で作るのか、といった「シーン全体の初期状態」が必要になります。これをすべて JavaScript の手書き初期化コードへ散らすと、サンプルごとに書き方が変わりやすくなります。`webg` では、その差を減らすために Scene JSON を置いています。人間が読むときも、生成 AI が構造を生成するときも、「このシーンは何を初期状態として持つか」を JSON から直接追えるようにすることが目的です。

Scene JSON と `SceneAsset`、`SceneLoader` の役割は、次の 4 つに分けて考えると分かりやすくなります。第一に、シーン全体の初期状態を JSON 互換データとして保持すること。第二に、カメラ、HUD、入力、プリミティブ、モデル、tileMap の構造を build 前に検証すること。第三に、検証済みシーンを `WebgApp` や `{ gpu, space }` 上のランタイムへ変換すること。第四に、build 後のエントリ参照や入力配線を、JavaScript 側から扱いやすいヘルパーで返すことです。ここで大事なのは、Scene JSON が `ModelAsset` の代わりではないことです。`ModelAsset` は 1 モデル分の共通表現、Scene JSON はそのモデルやプリミティブを含む 1 シーン分の共通表現です。粒度が違うため、両者を分けて考える必要があります。

Scene JSON を導入する理由は、単にシーンをファイル化したいからではありません。まず、シーンの初期状態を JavaScript 本体から切り離せることが重要です。これにより、サンプルは「シーンをどう使うか」の説明に集中しやすくなります。次に、カメラ、HUD、入力、エントリ配置の整合性をバリデーターで先に止められることが重要です。たとえば `input.bindings` のアクション名のタイプミスや `camera.target` の配列長不足は、画面を開いてから探すより JSON 段階で見つけたほうが追いやすくなります。さらに、`SceneLoader` がプリミティブ、モデル、tileMap を同じシーン構築フローにまとめることで、「プリミティブは手書きコード、モデルはローダー、tileMap は別ヘルパー」というばらつきを減らせます。利用者は「シーンエントリを配置する」という同じ見方で扱いやすくなります。

Scene JSON は、次のような場面で特に役立ちます。サンプルの初期カメラ、HUD、入力、配置物を 1 ファイルにまとめたいとき。プリミティブとモデルを同じシーンに混在させたいとき。tileMap を含むシーンの起動状態を JSON で持ちたいとき。シーンの入力アクション名だけを JSON に書き、処理の中身は JavaScript 側に残したいとき。シーンを再保存して、構成の比較や診断情報に使いたいときです。特に `webg/samples/scene` は、「Scene JSON で初期状態を宣言し、JavaScript 側ではアクションハンドラーと update だけを書く」構成の実例です。シーン単位のサンプルを作るときは、この形が基準になります。

先に意識しておきたい注意点もあります。Scene JSON は初期状態の宣言であり、ゲームロジック全体を入れる場所ではありません。`SceneAsset.build()` はシーンランタイムを返しますが、すべての振る舞いを自動化するわけではありません。`input.bindings` はアクション名の宣言だけであり、実処理は `createInputHandler()` 側で渡します。シーンエントリの `transform` はアセット内部 transform ではなく、シーン上の配置 transform です。また、`hud` はバリデーターでは文字列の短縮記法も受け付けますが、現在の `SceneLoader.normalizeHudLines()` はオブジェクト形式を前提に build します。実用上は `{ x, y, text, color }` を明示するほうが安全です。`tileMap` を使う場合も、カメラや HUD とは別に build されるランタイムなので、盤面操作ロジックは JavaScript 側で組み立てる必要があります。

## 標準フローと 2 つの入口

Scene JSON を使う流れは、高レベル経路とローレベル経路の 2 つに分けて考えると分かりやすくなります。普段のサンプルでは、`WebgApp.loadScene(scene)` を使うのが素直です。この経路では、Scene JSON の読み込みと検証を `SceneAsset` が受け持ち、シーンの実体化は `WebgApp.loadScene()` が `SceneLoader` 経由で行います。カメラや HUD をアプリへ反映したい通常のサンプルでは、この形が自然です。 

```js
import SceneAsset from "./webg/SceneAsset.js";

const sceneAsset = await SceneAsset.load("./scene.json");
sceneAsset.assertValid();

const sceneRuntime = await app.loadScene(sceneAsset.getData());
```

一方、シーンをオブジェクトのまま保持したい場合や、`WebgApp` を使わず `{ gpu, space }` だけで build したい場合は、`SceneAsset.build(target)` を直接使います。この形では、カメラと HUD のアプリ反映は行われませんが、プリミティブ、モデル、tileMap の build と `inputMap` 生成は使えます。アプリを持たないテストや、シーンデータの一部だけを確認したいときに向いています。つまり、通常のアプリでは高レベル経路、構造確認や限定的な build ではローレベル経路、という使い分けが自然です。 

```js
import SceneAsset from "./webg/SceneAsset.js";

const sceneAsset = SceneAsset.fromData(sceneObject);
sceneAsset.assertValid();

const sceneRuntime = await sceneAsset.build({
  gpu: app.getGL(),
  space: app.space
});
```

## 使い方のコード例

### `scene.json` を読み込み、エントリと入力ハンドラーを使う

シーンを読む最小の実用例です。Scene JSON はアクション名だけを持ち、JavaScript 側ではそのアクション名に処理を結び付けます。ここでのポイントは、Scene JSON 側には `key` と `action` の対応だけを書き、実処理は `actionHandlers` 側へ残すことです。これにより、シーン定義とロジック本体がきれいに分離されます。 

```js
const sceneAsset = await SceneAsset.load("./scene.json");
sceneAsset.assertValid();

const sceneRuntime = await app.loadScene(sceneAsset.getData());
const input = sceneRuntime.createInputHandler({
  "reset-camera": () => resetCamera(),
  "toggle-pause": () => togglePause()
});

window.addEventListener("keydown", (event) => {
  input.onKeyDown(event.key, event);
});
```

### プリミティブとモデルを同じシーンに置く

`SceneLoader` はプリミティブとモデルを同じエントリとして build できるため、シーンの中で両方を混在させやすくなっています。このとき利用者は「これはプリミティブだから別処理」「これはモデルだからローダー経由で別扱い」と考えすぎずに済みます。配置単位としては、どちらも同じ「シーンエントリ」です。 

```json
{
  "primitives": [
    {
      "id": "floor",
      "type": "cube",
      "args": [16],
      "transform": {
        "translation": [0.0, -10.0, 0.0],
        "rotation": [0.0, 0.0, 0.0, 1.0],
        "scale": [1.0, 0.08, 1.0]
      }
    }
  ],
  "models": [
    {
      "id": "hero",
      "source": "../json_loader/modelasset.json",
      "transform": {
        "translation": [0.0, 0.0, 0.0],
        "rotation": [0.0, 0.0, 0.0, 1.0],
        "scale": [1.5, 1.5, 1.5]
      },
      "bindAnimations": true,
      "startAnimations": true,
      "playOnUpdate": true
    }
  ]
}
```

### 配置済みエントリを後から取り出す

build 後にシーンエントリを触りたいときは、`getEntry(id)` を使うと追いやすくなります。戻り値には `placementNode`、`runtime`、`nodeMap` などが入っているため、シーン初期化後の調整や一時的な可視化変更を JavaScript 側で行いやすくなります。Scene JSON は初期状態を決め、build 後のランタイムは JavaScript 側で触る、という分担がここでも見えてきます。 

```js
const sceneRuntime = await app.loadScene(sceneAsset.getData());

const heroEntry = sceneRuntime.getEntry("hero");
const floorEntry = sceneRuntime.getEntry("floor");

heroEntry.placementNode.move(2.0, 0.0, 0.0);
floorEntry.runtime.shapes[0].setWireframe(true);
```

### `sceneRuntime.update()` でシーン内アニメーションを進める

`playOnUpdate` が有効なモデルエントリを持つシーンでは、毎フレーム `sceneRuntime.update()` を呼ぶとアニメーションをまとめて進められます。これは「シーン内のどのモデルを毎フレーム再生するか」をエントリ単位でまとめて扱うための薄い入口です。個別クリップを細かく制御したい場合は `getEntry(id).runtime` 側のアニメーションヘルパーを使い、シーン全体を大まかに進めたい場合は `update()` を使うと整理しやすくなります。 

```js
app.start({
  onUpdate() {
    sceneRuntime.update();
  }
});
```

### `tileMap` を含むシーンを build する

現在の `SceneLoader` は `scene.tileMap` を build し、戻り値の `sceneRuntime.tileMap` から扱えるようにしています。ここで大事なのは、tileMap もシーンの一部として build される一方で、盤面上の移動や選択処理までは Scene JSON が自動で作るわけではないことです。Scene JSON は盤面定義を持ち、JavaScript 側がその盤面をどう使うかを決めます。

```js
const sceneRuntime = await app.loadScene(sceneAsset.getData());

if (sceneRuntime.tileMap) {
  const startCell = sceneRuntime.tileMap.getTile(0, 0);
  sceneRuntime.tileMap.followCell(startCell);
}
```

### 現在のシーンを JSON として保存する

シーンをエクスポーター的に使いたいときは、`downloadJSON()` がそのまま使えます。この保存結果は、シーン構成の比較や診断情報の材料に使えます。サンプルを作る途中でシーンを固定したいときにも便利です。

```js
const sceneAsset = SceneAsset.fromData(sceneObject);
sceneAsset.downloadJSON("scene-export.json");
```

## `SceneLoader` が返すシーンランタイムは何を持っているか

`SceneLoader.build(scene)` の戻り値は、単なる `entries` 配列だけではありません。現在の実装では、次の 5 つを中心に見ると理解しやすくなります。`entries` は build 済みのシーンエントリ一覧です。`tileMap` は `scene.tileMap` があれば build 済み `TileMap` ランタイムが入ります。`inputMap` は小文字化したキーで引けるアクション対応表です。`update()` は `playOnUpdate` が有効なモデルアニメーションをまとめて進めるヘルパーです。`createInputHandler()` と `getEntry(id)` は、JavaScript 側からシーンランタイムを扱いやすくするヘルパーです。この構造があるため、Scene JSON は初期状態の宣言に集中し、build 後の JavaScript 側では「エントリを取る」「入力をアクション名で配線する」「シーン内アニメーションを進める」といった実務的な操作に集中できます。

## Scene JSON が持つ主なデータ

Scene JSON のトップレベルは、現行実装では主に次の項目で構成されます。ここではスキーマを丸暗記するより、「何の役割のデータか」で分けて読むほうが分かりやすくなります。

```json
{
  "version": "1.0",
  "type": "webg-scene",
  "meta": {},
  "camera": {},
  "hud": {},
  "input": {},
  "tileMap": {},
  "primitives": [],
  "models": []
}
```

`camera` は、アプリ起動時のカメラ状態です。`target`、`distance`、`yaw`、`pitch`、`bank`、`viewAngle`、`near`、`far` を持ちます。`WebgApp` を対象にして build した場合は、ここがアプリ側のカメラ状態へ反映されます。`hud` は、ガイドテキストとステータステキストの初期表示です。現状の build ではオブジェクト形式を使うのが安全で、各行を `{ x, y, text, color }` で明示する形が実用的です。`input` は、キーからアクションへの対応表です。ここにはアクション名だけを書き、実処理は `createInputHandler()` 側でコールバックに結び付けます。`tileMap` は、高さ付き盤面のシーン定義です。`TileMap.fromScene(...).build()` が内部で使われるため、盤面付きシーンを 1 つの JSON として扱えます。`primitives` は、`Primitive` ファクトリーをシーンエントリとして置く定義です。`type`、`args`、`transform`、必要なら `material` や `wireframe` を持ちます。`models` は、既存の `ModelAsset` をシーンエントリとして置く定義です。`source` か埋め込み `asset`、`transform`、`bindAnimations`、`startAnimations`、`playOnUpdate` などを持ちます。

## validate と build の見方

`SceneValidator.validate(scene)` は、トップレベルの構造、カメラの数値、HUD の行配列、入力バインディング、tileMap、プリミティブ、モデルの構造を確認します。戻り値は次の形です。`errors` は build を止める不整合、`warnings` は build 自体は進められるが見直したい項目です。シーンの読み込み失敗を早く止めたいときは `assertValid()` が向きます。 

```js
{
  ok: true,
  errors: [],
  warnings: []
}
```

`SceneAsset.build(target)` と `SceneLoader.build(scene)` は、整合性検証を通したシーンからランタイムを組み立てます。`target` が `WebgApp` ならカメラと HUD もアプリへ反映され、`{ gpu, space }` だけならシーンエントリ build に集中します。また、プリミティブとモデルの両方で、`SceneLoader` は配置ノードを先に作り、その下へランタイムの root `Node` 群を接続します。これにより、アセット内部の原点や骨構造は保ったまま、シーンエントリ単位の配置 transform を外側から掛けられます。アニメーションについては、モデルエントリで `startAnimations !== false` なら build 後に全クリップを開始し、`playOnUpdate !== false` なら `sceneRuntime.update()` が毎フレームアニメーションを進めます。Scene JSON には「再生方針」の宣言まで含められますが、個別クリップ制御の細かいロジックは JavaScript 側で追加する形になります。 

## 例を通して確かめる

Scene JSON の流れを具体的に確かめたいときは、次の例が役立ちます。`webg/samples/scene` は、Scene JSON を読み、カメラ、HUD、プリミティブ、モデル、入力をまとめて確認する標準サンプルです。`webg/samples/json_loader` は、Scene JSON の中で参照する `ModelAsset` を小さく確かめる例です。`webg/samples/tile_sim` は、シーン単位で tileMap や配置物をどう扱うかを見る実例です。`unittest` 配下の tileMap 系は、`tileMap` をシーン構成の一部として扱うときの小さな例です。特に `webg/samples/scene` は、Scene JSON の入力アクションを `createInputHandler()` で JavaScript 側へ結ぶ流れ、`SceneAsset.downloadJSON()` を使った再保存、診断情報と組み合わせたシーン状態確認まで一通り見られるため、最初に読む例として役立ちます。 

## 変更時の注意点と参考用の最小例

Scene JSON 周りを変更するときは、1 か所だけを見るとずれやすいため、少なくとも次の組を一緒に確認してください。スキーマを変えるなら `SceneValidator` と `SceneLoader`。カメラの意味を変えるなら `validateCamera()` と `applyCamera()`。HUD の書式を変えるなら `validateHud()` と `normalizeHudLines()`。入力の扱いを変えるなら `createInputMap()` と `createInputHandler()`。プリミティブ、モデル、tileMap のエントリを増やすならバリデーターと build フローの両方です。特に現在は、HUD の文字列短縮記法についてバリデーターとローダーの許容範囲が完全には一致していません。文書やサンプルを更新するときは、build まで通る書き方を優先し、実用上はオブジェクト形式へそろえておくほうが安全です。 

最小構成の Scene JSON は、少なくとも `camera`、`hud`、`input`、`primitives`、`models` を持つと理解しやすくなります。`type` と `version` は推奨で、保存や比較を考えるなら入れておくのが自然です。次の例は、最小限のシーン構成を確認するときの出発点として向いています。 

```json
{
  "version": "1.0",
  "type": "webg-scene",
  "meta": {
    "name": "triangle-scene"
  },
  "camera": {
    "target": [0, 0, 0],
    "distance": 30,
    "yaw": 0,
    "pitch": 0,
    "bank": 0,
    "viewAngle": 55,
    "near": 0.1,
    "far": 1000
  },
  "hud": {
    "guideLines": [
      {
        "x": 0,
        "y": 1,
        "text": "scene ready",
        "color": [1.0, 0.9, 0.6]
      }
    ]
  },
  "input": {
    "bindings": [
      { "key": "r", "action": "reset-camera", "description": "reset orbit camera" }
    ]
  },
  "primitives": [
    {
      "id": "floor",
      "type": "cube",
      "args": [12],
      "transform": {
        "translation": [0, -7, 0],
        "rotation": [0, 0, 0, 1],
        "scale": [1, 0.08, 1]
      }
    }
  ],
  "models": [
    {
      "id": "hero",
      "source": "./modelasset.json",
      "transform": {
        "translation": [0, 0, 0],
        "rotation": [0, 0, 0, 1],
        "scale": [1, 1, 1]
      },
      "bindAnimations": true,
      "startAnimations": true,
      "playOnUpdate": true
    }
  ]
}
```

## まとめ

この章で最も大事なのは、Scene JSON を「ゲーム全体のロジックを入れる箱」としてではなく、「シーン全体の初期状態を宣言する共通表現」として理解することです。`ModelAsset` が 1 モデル分の共通表現だったのに対し、Scene JSON はカメラ、HUD、入力、プリミティブ、モデル、tileMap を含む 1 シーン分の初期配置表です。`SceneAsset` はその保存、読み込み、検証、build の入口であり、`SceneLoader` はその配置表を実際のランタイムへ変換する層です。ここが見えると、シーン初期化コードとロジック本体をきれいに分けやすくなります。

また、この章では、Scene JSON が持つ粒度、`SceneAsset` と `SceneLoader` の位置づけ、高レベル経路とローレベル経路の違い、`createInputHandler()`、`getEntry(id)`、`update()` といった build 後の扱い方を確認しました。プリミティブとモデルを同じシーンエントリの見方で扱えること、tileMap もシーンの一部として build できること、入力は宣言だけを JSON に置いて処理本体は JavaScript 側へ残すことが、この章の中心です。次章では、こうして読み込まれたモデルやシーンの上で実際に動きを与えるためのアニメーションを扱います。
