# シーン構成とScene JSON

この章では、Scene JSON が何を表し、どの段階で検証され、どのようにして `WebgApp` 上の実体へと変換されるのかを解説します。第10章で扱った `ModelAsset` が「1つのモデル」に関する共通表現であったのに対し、Scene JSON は、モデルやプリミティブ、カメラ、HUD、入力を統合した「シーン全体の初期状態」を表現するものです。

3Dアプリケーションの初期状態は、単一のモデルだけでは決定しません。カメラの初期方向、HUDの表示内容、キー入力とアクションの対応関係、プリミティブやモデルの配置、そして必要に応じて tileMap の定義まで、複数の要素を同時に決定する必要があります。`webg` では、これら「シーン全体の初期状態」をJSON形式でまとめたものを Scene JSON と呼び、それを保持するクラスを `SceneAsset`、実際にアプリケーションへと構築するクラスを `SceneLoader` と定義しています。

ここで最も重要な点は、Scene JSON は「ゲームロジック全体」を記述するものではなく、あくまで「シーンの初期状態を宣言するデータ」であるということです。具体的には、カメラ、HUD、入力、プリミティブ、モデル、tileMap を「起動時にどのように配置するか」という観点から定義します。ゲームルールや毎フレームの条件分岐などのロジックは持たせず、それらは JavaScript 側に記述し、Scene JSON には初期配置と宣言のみを持たせるのが基本設計となります。

`SceneAsset` は保存、読み込み、検証、およびビルドの入り口としての役割を担い、`SceneLoader` はプリミティブ、モデル、tileMap を同一のシーン構築フローへと統合します。入力についても、`input.bindings` では宣言のみを行い、実際の処理は `sceneRuntime.createInputHandler(actionHandlers)` を通じて JavaScript 側へ渡されます。つまり、Scene JSON は「配置と初期状態を宣言する層」として理解するのが最も効率的です。

Scene JSON を利用する際は、以下のフローで検討するとスムーズです。まず、Scene JSON または JavaScript オブジェクトを `SceneAsset` として読み込み、`validate()` または `assertValid()` で構造を検証します。次に、`build(target)` または `app.loadScene(scene)` を実行してシーンを実体化し、`sceneRuntime.getEntry(id)` や `sceneRuntime.createInputHandler()` を用いて JavaScript 側の処理へと接続します。必要に応じて `sceneRuntime.update()` を毎フレーム呼び出すことで、アニメーションを進行させます。このように、Scene JSON は「シーン全体の初期配置表」であり、`SceneLoader` はその配置表をランタイムへと変換する役割を担っています。この役割分担を明確にすることで、`ModelAsset` と `SceneAsset` の混同を防ぐことができます。

## Scene JSON 導入の目的とメリット

![Scene JSON の守備範囲図](fig11_01_scenejson_scope.jpg)
*Scene JSON は、単一のモデルではなく、camera、HUD、input、primitive、model、tileMap を含むシーン全体の初期状態を定義します。*

3Dアプリケーションにおいて、単にモデルを表示できるだけでは不十分です。カメラの向きや画面上のガイドテキスト、操作キーの割り当て、地面をプリミティブで構成するか tileMap で構成するかといった「シーン全体の初期状態」を定義する必要があります。これらをすべて JavaScript の初期化コードとして記述すると、サンプルごとに実装方法が異なり、保守性が低下します。`webg` ではこの問題を解決するために Scene JSON を導入しています。これにより、人間が構造を把握しやすくなるだけでなく、生成AIがシーン構成を生成する際にも、JSON形式であれば直接的に構造を制御できるためです。

Scene JSON、`SceneAsset`、および `SceneLoader` の役割は、大きく分けて以下の4点に集約されます。
1. シーン全体の初期状態を JSON 互換データとして保持すること。
2. カメラ、HUD、入力、プリミティブ、モデル、tileMap の構造をビルド前に検証すること。
3. 検証済みシーンを `WebgApp` や `{ gpu, space }` 上のランタイムへ変換すること。
4. ビルド後のエントリ参照や入力配線を、JavaScript から扱いやすいヘルパー関数として提供すること。

ここで注意すべきは、Scene JSON は `ModelAsset` の代替ではないということです。`ModelAsset` が「1モデル分」の共通表現であるのに対し、Scene JSON はそのモデルを含む「1シーン分」の共通表現であり、管理する粒度が異なります。

Scene JSON を導入する最大の利点は、シーンの初期状態を JavaScript のロジックから切り離せる点にあります。これにより、サンプルコードは「シーンをどう活用するか」という本質的な説明に集中できます。また、バリデータによってカメラや HUD、入力設定の整合性を事前に検証できるため、実行後にタイプミスや設定不足に気づくといった手間を削減できます。さらに、`SceneLoader` がプリミティブ、モデル、tileMap を同一の構築フローにまとめることで、「プリミティブは手書きコード、モデルはローダー、tileMap は専用ヘルパー」といった実装のばらつきを解消し、利用者はすべてを「シーンエントリを配置する」という統一的な視点で扱うことが可能になります。

具体的には、サンプルの初期設定を1つのファイルにまとめたい場合や、プリミティブとモデルを混在させたい場合、あるいは tileMap を含むシーンの起動状態を管理したい場合に非常に有効です。特に `webg/samples/scene` では、「Scene JSON で初期状態を宣言し、JavaScript 側でアクションハンドラーと update 処理のみを記述する」という標準的な構成例を示しています。

なお、Scene JSON はあくまで初期状態の宣言であり、ゲームロジック全体を記述する場所ではないことに注意してください。`SceneAsset.build()` はシーンランタイムを返しますが、すべての挙動を自動化するわけではありません。例えば `input.bindings` はアクション名の宣言のみを行い、実処理は `createInputHandler()` 側で定義します。また、シーンエントリの `transform` はアセット内部の座標ではなく、シーン上の配置座標を指します。HUD については、バリデータで文字列の短縮記法を許容していますが、`SceneLoader.normalizeHudLines()` はオブジェクト形式を前提にビルドするため、実用的には `{ x, y, text, color }` を明示的に指定することを推奨します。tileMap を利用する場合も、カメラや HUD とは別にビルドされるため、盤面操作のロジックは JavaScript 側で構築する必要があります。

## シーン実体化の2つの経路

Scene JSON を利用するフローは、高レイヤー（ハイレベル）な経路と低レイヤー（ローレベル）な経路の2つに分けられます。

通常のサンプル開発では、`WebgApp.loadScene(scene)` を使用するのが最も効率的です。この経路では、`SceneAsset` が JSON の読み込みと検証を担当し、`WebgApp.loadScene()` が `SceneLoader` を経由してシーンを実体化させます。カメラや HUD の設定をアプリケーションに即座に反映させたい場合に最適です。

```js
import SceneAsset from "./webg/SceneAsset.js";

const sceneAsset = await SceneAsset.load("./scene.json");
sceneAsset.assertValid();

const sceneRuntime = await app.loadScene(sceneAsset.getData());
```

一方で、シーンをオブジェクトとして保持したい場合や、`WebgApp` を介さずに `{ gpu, space }` のみでビルドしたい場合は、`SceneAsset.build(target)` を直接利用します。この経路ではカメラや HUD のアプリ反映は行われませんが、プリミティブ、モデル、tileMap のビルドおよび `inputMap` の生成は可能です。アプリケーションを持たないユニットテストや、シーンデータの一部のみを検証したい場合に適しています。

```js
import SceneAsset from "./webg/SceneAsset.js";

const sceneAsset = SceneAsset.fromData(sceneObject);
sceneAsset.assertValid();

const sceneRuntime = await sceneAsset.build({
  gpu: app.getGL(),
  space: app.space
});
```

## 実装例

### Scene JSON の読み込みと入力ハンドラーの利用

以下は、シーンを読み込む最小の実用例です。Scene JSON にはアクション名のみを記述し、JavaScript 側でそのアクションに対応する処理を紐付けます。これにより、シーン定義（データ）とロジック（処理）を明確に分離できます。

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

### プリミティブとモデルの混在配置

`SceneLoader` はプリミティブとモデルを同一の「シーンエントリ」としてビルドします。これにより、開発者は個別の処理の違いを意識せず、同一の配置単位として管理できます。

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

### ビルド済みエントリの操作

ビルド後に特定のシーンエントリを操作したい場合は、`getEntry(id)` を使用します。戻り値には `placementNode`、`runtime`、`nodeMap` などが含まれており、初期化後の座標調整や可視化の変更を JavaScript 側で容易に行うことができます。

```js
const sceneRuntime = await app.loadScene(sceneAsset.getData());

const heroEntry = sceneRuntime.getEntry("hero");
const floorEntry = sceneRuntime.getEntry("floor");

heroEntry.placementNode.move(2.0, 0.0, 0.0);
floorEntry.runtime.shapes[0].setWireframe(true);
```

### `sceneRuntime.update()` によるアニメーション制御

`playOnUpdate` が有効なモデルエントリが含まれるシーンでは、毎フレーム `sceneRuntime.update()` を呼び出すことで、対象となるすべてのアニメーションを一括して進行させることができます。個別のクリップを詳細に制御したい場合は `getEntry(id).runtime` のアニメーションヘルパーを利用し、シーン全体を大まかに進行させたい場合は `update()` を利用するという使い分けが可能です。

```js
app.start({
  onUpdate() {
    sceneRuntime.update();
  }
});
```

### tileMap を含むシーンのビルド

`SceneLoader` は `scene.tileMap` をビルドし、その結果を `sceneRuntime.tileMap` として提供します。ただし、tileMap はシーンの一部としてビルドされますが、盤面上の移動や選択などの操作ロジックは自動生成されません。Scene JSON で盤面を定義し、それをどのように運用するかは JavaScript 側で実装します。

```js
const sceneRuntime = await app.loadScene(sceneAsset.getData());

if (sceneRuntime.tileMap) {
  const startCell = sceneRuntime.tileMap.getTile(0, 0);
  sceneRuntime.tileMap.followCell(startCell);
}
```

### シーン構成の保存

現在のシーン構成を保存したい場合は、`downloadJSON()` を利用できます。保存された JSON は、構成の比較や診断情報の解析に活用でき、サンプル制作中の状態固定にも便利です。

```js
const sceneAsset = SceneAsset.fromData(sceneObject);
sceneAsset.downloadJSON("scene-export.json");
```

## シーンランタイムの構造

`SceneLoader.build(scene)` が返すシーンランタイムは、単なるエントリの配列ではなく、以下の5つの機能を備えたオブジェクトです。

- `entries`: ビルド済みのシーンエントリ一覧。
- `tileMap`: `scene.tileMap` が定義されていた場合に生成される `TileMap` ランタイム。
- `inputMap`: 小文字化したキーでアクションを検索できる対応表。
- `update()`: `playOnUpdate` が有効なモデルアニメーションを一括更新するヘルパー。
- `createInputHandler()` / `getEntry(id)`: JavaScript からシーンランタイムを効率的に操作するためのヘルパー。

この構造により、Scene JSON は「初期状態の宣言」に専念し、ビルド後の JavaScript 側では「エントリの取得」「入力の配線」「アニメーションの更新」といった実務的な操作に集中できる設計となっています。

## Scene JSON のデータ構成

Scene JSON のトップレベルは、主に以下の項目で構成されます。個々のスキーマを記憶するよりも、「どのような役割のデータか」という視点で把握してください。

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

- `camera`: アプリ起動時のカメラ状態（`target`, `distance`, `yaw`, `pitch`, `bank`, `viewAngle`, `near`, `far`）を定義します。`WebgApp` を対象にビルドした場合、これらの値がアプリのカメラに反映されます。
- `hud`: ガイドテキストとステータステキストの初期表示を定義します。実用的には各行を `{ x, y, text, color }` で明示するオブジェクト形式を推奨します。
- `input`: キーからアクションへの対応表です。ここではアクション名のみを定義し、実処理は `createInputHandler()` で紐付けます。
- `tileMap`: 高さ情報を持つ盤面の定義です。内部的に `TileMap.fromScene(...).build()` が呼ばれるため、盤面付きシーンを単一の JSON で管理できます。
- `primitives`: `Primitive` ファクトリーによるシーンエントリの定義です。`type`, `args`, `transform` のほか、必要に応じて `material` や `wireframe` を指定します。
- `models`: `ModelAsset` をシーンエントリとして配置する定義です。`source`（または埋め込み `asset`）、`transform`、`bindAnimations`, `startAnimations`, `playOnUpdate` などを指定します。

## 検証（validate）とビルド（build）の動作

`SceneValidator.validate(scene)` は、トップレベルの構造、カメラの数値、HUD の行配列、入力バインディング、tileMap、プリミティブ、モデルの構造を包括的に検証します。戻り値は以下の形式で返されます。

- `errors`: ビルドを停止させるべき致命的な不整合。
- `warnings`: ビルドは可能だが、見直しを推奨する項目。

読み込み失敗を早期に検知したい場合は、`assertValid()` を使用してください。

```js
{
  ok: true,
  errors: [],
  warnings: []
}
```

`SceneAsset.build(target)` および `SceneLoader.build(scene)` は、検証を通過したシーンデータからランタイムを組み立てます。`target` が `WebgApp` であればカメラと HUD も反映され、`{ gpu, space }` のみの場合はシーンエントリのビルドに特化します。

また、プリミティブとモデルの双方において、`SceneLoader` はまず「配置ノード」を作成し、その配下にランタイムのルート `Node` 群を接続します。これにより、アセット内部の原点や骨格構造を維持したまま、シーンエントリ単位で外部から配置トランスフォームを適用できます。

アニメーションに関しては、モデルエントリで `startAnimations` が `false` でない場合はビルド後に全クリップを開始し、`playOnUpdate` が `false` でない場合は `sceneRuntime.update()` によって毎フレーム更新されます。Scene JSON では「再生方針」までを宣言し、個別のクリップ制御などの詳細なロジックは JavaScript 側で実装する運用となります。

## 動作確認のためのリファレンス

Scene JSON の挙動を具体的に確認したい場合は、以下のサンプルを参照してください。

- `webg/samples/scene`: Scene JSON を読み込み、カメラ、HUD、プリミティブ、モデル、入力を統合的に確認できる標準サンプルです。入力アクションを `createInputHandler()` で接続する流れや、`SceneAsset.downloadJSON()` による再保存、診断情報の確認まで一通り実装されており、最初に読むべき例として最適です。
- `webg/samples/json_loader`: Scene JSON 内で参照される `ModelAsset` の最小構成を確認できます。
- `webg/samples/tile_sim`: シーン単位で tileMap や配置物をどのように扱うかの実例を示しています。
- `unittest` 配下の tileMap 系テスト: tileMap をシーン構成の一部として扱う際の最小単位の例を確認できます。

## 変更時の注意点と最小構成例

Scene JSON 関連の機能を変更する際は、整合性を保つため、以下のセットを併せて確認してください。

- スキーマの変更: `SceneValidator` と `SceneLoader`
- カメラ仕様の変更: `validateCamera()` と `applyCamera()`
- HUD 書式の変更: `validateHud()` と `normalizeHudLines()`
- 入力処理の変更: `createInputMap()` と `createInputHandler()`
- エントリ種類の追加: バリデータとビルドフローの両方

特に HUD の文字列短縮記法については、バリデータとローダーの間で許容範囲に一部差異があるため、ドキュメントやサンプルを更新する際はビルドが完全に通るオブジェクト形式を優先して使用してください。

以下に、最小構成の Scene JSON の例を示します。`camera`, `hud`, `input`, `primitives`, `models` を含めることで、シーンの基本構造を網羅できます。`type` と `version` は、保存や比較を行う際に推奨される項目です。

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

本章で最も重要な点は、Scene JSON を「ゲームロジックを格納する箱」ではなく、「シーン全体の初期状態を宣言する共通表現」として捉えることです。`ModelAsset` が単一モデルの表現であったのに対し、Scene JSON はカメラ、HUD、入力、プリミティブ、モデル、tileMap を包括する「シーン全体の初期配置表」として機能します。

`SceneAsset` が保存・読み込み・検証・ビルドのインターフェースとなり、`SceneLoader` がそのデータを実際のランタイムへと変換します。この構造を理解することで、シーンの初期化コードとアプリケーションのロジック本体をきれいに分離することが可能になります。

また、高レイヤー（ハイレベル）な経路と低レイヤー（ローレベル）な経路の使い分け、`createInputHandler()` や `getEntry(id)`、`update()` といったビルド後の操作手法についても確認しました。プリミティブとモデルを同一のシーンエントリとして扱い、入力の宣言を JSON に集約させることで、開発効率と保守性が向上します。

次章では、このように読み込まれたモデルやシーンに対して、具体的な動きを与えるためのアニメーションについて解説します。