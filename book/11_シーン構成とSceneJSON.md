# シーン構成とScene JSON

本章では、カメラ、HUD（Head-Up Display：画面上へ重ねる情報表示）、入力、プリミティブ、モデルの初期状態をScene JSONへまとめ、JavaScriptの処理ロジックと分離します。
シーン構成を宣言データとして検証・保存できるようにすると、同じ内容を再現しやすくなり、配置変更のたびに初期化コードを書き換えずに済みます。

## Scene JSONで初期状態を宣言する

Scene JSONは、モデルやプリミティブの配置、カメラの初期設定、HUD、入力、アニメーション、物理設定など、シーンを開始するときに必要な状態を宣言するデータです。
`SceneAsset`が読み込みと検証を担当し、`SceneLoader`が宣言された内容を`WebgApp`上のランタイムへ変換します。

この章では、Scene JSONが何を表し、どの段階で検証され、どのようにして `WebgApp` 上の実体へと変換されるのかを解説します。
第10章で扱った `ModelAsset` が「1つのモデル」に関する共通表現であったのに対し、Scene JSONは、モデルやプリミティブ、カメラ、HUD、入力を統合した「シーン全体の初期状態」を表現するものです。

3Dアプリケーションの初期状態は、単一のモデルだけでは決定しません。
カメラの初期方向、HUDの表示内容、キー入力とアクションの対応関係、プリミティブやモデルの配置など、複数の要素を同時に決定する必要があります。
`webg` では、これら「シーン全体の初期状態」をJSON形式でまとめたものをScene JSONと呼び、それを保持するクラスを `SceneAsset`、実際にアプリケーションへと構築するクラスを `SceneLoader` と定義しています。

ここで最も重要な点は、Scene JSONは「ゲームロジック全体」を記述するものではなく、あくまで「シーンの初期状態を宣言するデータ」であるということです。
具体的には、カメラ、HUD、入力、プリミティブ、モデルを「起動時にどのように配置するか」という観点から定義します。
ゲームルールや毎フレームの条件分岐などのロジックは持たせず、それらはJavaScript側に記述し、Scene JSONには初期配置と宣言のみを持たせるのが基本設計となります。

`SceneAsset` は保存、読み込み、検証、およびビルドの入り口としての役割を担い、`SceneLoader` はプリミティブとモデルを同一のシーン構築フローへと統合します。
入力についても、`input.bindings` では宣言のみを行い、実際の処理は `sceneRuntime.createInputHandler(actionHandlers)` を通じてJavaScript側へ渡されます。
さらに、最上位の `physicsSpace` と各エントリーの `physics` を使うことで、`PhysicsSpace` と `PhysicsNode` をScene JSONから立ち上げる入口も持ちます。
つまり、Scene JSONは「配置と初期状態を宣言する層」として理解するのが最も効率的です。
物理設定そのものの意味、回転付きOBB（Oriented Bounding Box：方向付き境界ボックス）、接触応答、制限事項は第26章「物理エンジン」で詳しく扱います。

Scene JSONは、読み込み、検証、実体化、更新の順に扱います。
まず、Scene JSONまたはJavaScriptオブジェクトを `SceneAsset` として読み込みます。
次に、`validate()` または `assertValid()` で構造を検証します。

検証後は、`build(target)` または `app.loadScene(scene)` でシーンを実体化します。
`sceneRuntime.getEntry(id)` や `sceneRuntime.createInputHandler()` を使うと、JavaScript側の処理へ接続できます。

動的な要素は、ランタイムの更新で進めます。
アニメーションには、毎フレーム `sceneRuntime.update()` を呼び出します。
物理を宣言したシーンでは、`sceneRuntime.physicsSpace` と `sceneRuntime.stepPhysics(deltaMs)` を使って更新を明示的に進めます。

Scene JSONは、シーン全体の初期配置表です。
`SceneLoader` は、その配置表をランタイムへ変換します。
この役割分担を明確にすると、`ModelAsset` と `SceneAsset` の混同を防げます。

## Scene JSON導入の目的とメリット

Scene JSONは、配置や初期設定をJavaScriptの命令列から分離し、同じシーンを保存、比較、再構築するために使います。
データを構築前に検証できるため、不完全なエントリーをシーンの途中まで生成せず、編集ツール、サンプル、テストで同じ構成を共有できます。

![Scene JSONの守備範囲図](fig11_01_scenejson_scope.jpg)

*Scene JSONは、単一のモデルではなく、カメラ、HUD、入力、プリミティブ、モデルを含むシーン全体の初期状態を定義します。
*

3Dアプリケーションにおいて、単にモデルを表示できるだけでは不十分です。
カメラの向きや画面上のガイドテキスト、操作キーの割り当て、地面や背景の配置といった「シーン全体の初期状態」を定義する必要があります。
これらをすべてJavaScriptの初期化コードとして記述すると、サンプルごとに実装方法が異なり、保守性が低下します。
`webg` ではこの問題を解決するためにScene JSONを導入しています。
これにより、人間が構造を把握しやすくなるだけでなく、生成AIがシーン構成を生成する際にも、JSON形式であれば直接的に構造を制御できるためです。

Scene JSON、`SceneAsset`、および `SceneLoader` の役割は、大きく分けて以下の4点に集約されます。
1. シーン全体の初期状態をJSON互換データとして保持すること。
2. カメラ、HUD、入力、プリミティブ、モデルの構造をビルド前に検証すること。
3. 検証済みシーンを `WebgApp` や `{ gpu, space }` 上のランタイムへ変換すること。
4. ビルド後のエントリ参照や入力配線を、JavaScriptから扱いやすいヘルパー関数として提供すること。

ここで注意すべきは、Scene JSONは `ModelAsset` の代替ではないということです。
`ModelAsset` が「1モデル分」の共通表現であるのに対し、Scene JSONはそのモデルを含む「1シーン分」の共通表現であり、管理する粒度が異なります。

Scene JSONを導入する最大の利点は、シーンの初期状態をJavaScriptのロジックから切り離せる点にあります。
これにより、サンプルコードは「シーンをどう活用するか」という本質的な説明に集中できます。
また、バリデータによってカメラやHUD、入力設定の整合性を事前に検証できるため、実行後にタイプミスや設定不足に気づくといった手間を削減できます。
さらに、`SceneLoader` がプリミティブとモデルを同一の構築フローにまとめることで、「プリミティブは手書きコード、モデルはローダー」といった実装のばらつきを解消し、利用者はどちらも「シーンエントリを配置する」という統一的な視点で扱うことが可能になります。

具体的には、サンプルの初期設定を1つのファイルにまとめたい場合や、プリミティブとモデルを混在させたい場合に非常に有効です。
特に `samples/scene` では、「Scene JSONで初期状態を宣言し、JavaScript側でアクションハンドラーと更新処理のみを記述する」という標準的な構成例を示しています。

なお、Scene JSONはあくまで初期状態の宣言であり、ゲームロジック全体を記述する場所ではないことに注意してください。
`SceneAsset.build()` はシーンランタイムを返しますが、すべての挙動を自動化するわけではありません。
例えば `input.bindings` はアクション名の宣言のみを行い、実処理は `createInputHandler()` 側で定義します。
また、シーンエントリの `transform` はアセット内部の座標ではなく、シーン上の配置座標を指します。
HUDについては、バリデータで文字列の短縮記法を許容していますが、`SceneLoader.normalizeHudLines()` はオブジェクト形式を前提にビルドするため、実用的には `{ x, y, text, color }` を明示的に指定することを推奨します。

## シーン実体化の2つの経路

Scene JSONを利用する流れは、`WebgApp`を介する標準経路と、`{ gpu, space }`へ直接構築する低水準経路の2つに分けられます。

通常のサンプル開発では、`WebgApp.loadScene(scene)` を使用するのが最も効率的です。
この経路では、`SceneAsset` がJSONの読み込みと検証を担当し、`WebgApp.loadScene()` が `SceneLoader` を経由してシーンを実体化させます。
カメラやHUDの設定をアプリケーションに即座に反映させたい場合に最適です。

```js
import SceneAsset from "./webg/SceneAsset.js";

const sceneAsset = await SceneAsset.load("./scene.json");
sceneAsset.assertValid();

const sceneRuntime = await app.loadScene(sceneAsset.getData());
```

一方で、シーンをオブジェクトとして保持したい場合や、`WebgApp` を介さずに `{ gpu, space }` のみでビルドしたい場合は、`SceneAsset.build(target)` を直接利用します。
この経路ではカメラやHUDのアプリ反映は行われませんが、プリミティブ、モデルのビルドおよび `inputMap` の生成は可能です。
アプリケーションを持たないユニットテストや、シーンデータの一部のみを検証したい場合に適しています。

```js
import SceneAsset from "./webg/SceneAsset.js";

const sceneAsset = SceneAsset.fromData(sceneObject);
sceneAsset.assertValid();

const sceneRuntime = await sceneAsset.build({
  gpu: app.getGPU(),
  space: app.space
});
```

## 実装例

以下の例では、Scene JSONを読み込む入口、異なる種類のエントリーを同じシーンへ配置する方法、構築後のランタイムを操作する方法を目的別に示します。
宣言データと実行ロジックの役割を分けたまま、初期状態から動くアプリへ接続することが狙いです。

### Scene JSONの読み込みと入力ハンドラーの利用

以下は、シーンを読み込む最小の実用例です。
Scene JSONにはアクション名のみを記述し、JavaScript側でそのアクションに対応する処理を紐付けます。
これにより、シーン定義（データ）とロジック（処理）を明確に分離できます。

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

`SceneLoader` はプリミティブとモデルを同一の「シーンエントリ」としてビルドします。
これにより、開発者は個別の処理の違いを意識せず、同一の配置単位として管理できます。

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

ビルド後に特定のシーンエントリを操作したい場合は、`getEntry(id)` を使用します。
戻り値には `placementNode`、`runtime`、`nodeMap` などが含まれており、初期化後の座標調整や可視化の変更をJavaScript側で容易に行うことができます。

```js
const sceneRuntime = await app.loadScene(sceneAsset.getData());

const heroEntry = sceneRuntime.getEntry("hero");
const floorEntry = sceneRuntime.getEntry("floor");

heroEntry.placementNode.move(2.0, 0.0, 0.0);
floorEntry.runtime.shapes[0].setWireframe(true);
```

### `sceneRuntime.update()` によるアニメーション制御

`playOnUpdate` が有効なモデルエントリが含まれるシーンでは、毎フレーム `sceneRuntime.update()` を呼び出すことで、対象となるすべてのアニメーションを一括して進行させることができます。
個別のクリップを詳細に制御したい場合は `getEntry(id).runtime` のアニメーションヘルパーを利用し、シーン全体を大まかに進行させたい場合は `update()` を利用するという使い分けが可能です。

```js
app.start({
  onUpdate() {
    sceneRuntime.update();
  }
});
```

### シーン構成の保存

現在のシーン構成を保存したい場合は、`downloadJSON()` を利用できます。
保存されたJSONは、構成の比較や診断情報の解析に活用でき、サンプル制作中の状態固定にも便利です。

```js
const sceneAsset = SceneAsset.fromData(sceneObject);
sceneAsset.downloadJSON("scene-export.json");
```

## シーンランタイムの構造

シーンランタイムは、構築済みエントリーの取得、アニメーションと物理演算の更新、保存、破棄を一つのオブジェクトから行うために使います。
利用側がモデルごとのランタイムを別々に追跡せずに済み、シーン全体の寿命と毎フレームの更新を一箇所へまとめられます。
`SceneLoader.build(scene)`が返すシーンランタイムは、単なるエントリー配列ではなく、次の4つの機能を備えたオブジェクトです。

- `entries`: ビルド済みのシーンエントリ一覧。
- `inputMap`: 小文字化したキーでアクションを検索できる対応表。
- `update()`: `playOnUpdate` が有効なモデルアニメーションを一括更新するヘルパー。
- `createInputHandler()` / `getEntry(id)`: JavaScriptからシーンランタイムを効率的に操作するためのヘルパー。

この構造により、Scene JSONは「初期状態の宣言」に専念し、ビルド後のJavaScript側では「エントリの取得」「入力の配線」「アニメーションの更新」といった実務的な操作に集中できる設計となっています。

## Scene JSONのデータ構成

Scene JSONを手書きするときは、値を次の3種類に分けて考えると安全です。

- **最小構成で必要**
  - 例：`version`、配置する`entries`
  - 扱い：validateと構築の土台となる
- **用途に応じて指定**
  - 例：カメラ、HUD、入力、モデル、物理演算
  - 扱い：使用する機能だけ宣言する
- **構築後のランタイム**
  - 例：Node map、input handler、モデルインスタンス、物理演算ランタイム
  - 扱い：JSONへ直接書かず、`build()`の結果として受け取る

個々のフィールドの必須条件はエントリー種別によって異なるため、最終的には `SceneValidator` と `samples/scene` の現行データを確認してください。

Scene JSONのトップレベルは、主に以下の項目で構成されます。
個々のスキーマを記憶するよりも、「どのような役割のデータか」という視点で把握してください。

```json
{
  "version": "1.0",
  "type": "webg-scene",
  "meta": {},
  "camera": {},
  "hud": {},
  "input": {},
  "primitives": [],
  "models": []
}
```

- `camera`: アプリ起動時のカメラ状態（`target`, `distance`, `yaw`, `pitch`, `roll`, `viewAngle`, `near`, `far`）を定義します。`WebgApp` を対象にビルドした場合、これらの値がアプリのカメラに反映されます。
- `hud`: ガイドテキストとステータステキストの初期表示を定義します。実用的には各行を `{ x, y, text, color }` で明示するオブジェクト形式を推奨します。
- `input`: キーからアクションへの対応表です。ここではアクション名のみを定義し、実処理は `createInputHandler()` で紐付けます。
- `primitives`: `Primitive` ファクトリーによるシーンエントリの定義です。`type`, `args`, `transform` のほか、必要に応じて `material` や `wireframe` を指定します。
- `models`: `ModelAsset` をシーンエントリとして配置する定義です。`source`（または埋め込み `asset`）、`transform`、`bindAnimations`, `startAnimations`, `playOnUpdate` などを指定します。

## 検証（validate）とビルド（構築）の動作

`validate()`と`build()`を分けると、データの構造的な問題を、GPUリソースやNodeを一部だけ作った後ではなく、シーンを変更しない段階でまとめて報告できます。
編集ツールは検証結果だけを表示でき、実行時は成功したデータだけを構築へ進められます。
`SceneValidator.validate(scene)`は、最上位構造、カメラの数値、HUDの行配列、入力バインディング、プリミティブ、モデルの構造を包括的に検証します。

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

`SceneAsset.build(target)` および `SceneLoader.build(scene)` は、検証を通過したシーンデータからランタイムを組み立てます。
`target` が `WebgApp` であればカメラとHUDも反映され、`{ gpu, space }` のみの場合はシーンエントリのビルドに特化します。

また、プリミティブとモデルの双方において、`SceneLoader` はまず「配置ノード」を作成し、その配下にランタイムのルート `Node` 群を接続します。
これにより、アセット内部の原点や骨格構造を維持したまま、シーンエントリ単位で外部から配置トランスフォームを適用できます。

アニメーションに関しては、モデルエントリで `startAnimations` が `false` でない場合はビルド後に全クリップを開始し、`playOnUpdate` が `false` でない場合は `sceneRuntime.update()` によって毎フレーム更新されます。
Scene JSONでは「再生方針」までを宣言し、個別のクリップ制御などの詳細なロジックはJavaScript側で実装する運用となります。

## 動作確認のためのリファレンス

Scene JSONの挙動を具体的に確認したい場合は、以下のサンプルを参照してください。

- `samples/scene`: Scene JSONを読み込み、カメラ、HUD、プリミティブ、モデル、入力を統合的に確認できる標準サンプルです。入力アクションを `createInputHandler()` で接続する流れや、`SceneAsset.downloadJSON()` による再保存、診断情報の確認まで一通り実装されており、最初に読むべき例として最適です。
- `samples/json_loader`: Scene JSON内で参照される `ModelAsset` の最小構成を確認できます。

## 変更時の注意点と最小構成例

Scene JSON関連の機能を変更する際は、整合性を保つため、以下のセットを併せて確認してください。

- スキーマの変更: `SceneValidator` と `SceneLoader`
- カメラ仕様の変更: `validateCamera()` と `applyCamera()`
- HUD書式の変更: `validateHud()` と `normalizeHudLines()`
- 入力処理の変更: `createInputMap()` と `createInputHandler()`
- エントリ種類の追加: バリデータとビルドフローの両方

特にHUDの文字列短縮記法については、バリデータとローダーの間で許容範囲に一部差異があるため、ドキュメントやサンプルを更新する際はビルドが完全に通るオブジェクト形式を優先して使用してください。

以下に、最小構成のScene JSONの例を示します。
`camera`, `hud`, `input`, `primitives`, `models` を含めることで、シーンの基本構造を網羅できます。
`type` と `version` は、保存や比較を行う際に推奨される項目です。

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
    "roll": 0,
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

本章で最も重要な点は、Scene JSONを「ゲームロジックを格納する箱」ではなく、「シーン全体の初期状態を宣言する共通表現」として捉えることです。
`ModelAsset` が単一モデルの表現であったのに対し、Scene JSONはカメラ、HUD、入力、プリミティブ、モデルを包括する「シーン全体の初期配置表」として機能します。

`SceneAsset` が保存・読み込み・検証・ビルドのインターフェースとなり、`SceneLoader` がそのデータを実際のランタイムへと変換します。
この構造を理解することで、シーンの初期化コードとアプリケーションのロジック本体をきれいに分離することが可能になります。

また、高水準な経路と低水準な経路の使い分け、`createInputHandler()` や `getEntry(id)`、`update()` といったビルド後の操作手法についても確認しました。
プリミティブとモデルを同一のシーンエントリとして扱い、入力の宣言をJSONに集約させることで、開発効率と保守性が向上します。

次章では、このように読み込まれたモデルやシーンに対して、具体的な動きを与えるためのアニメーションについて解説します。
