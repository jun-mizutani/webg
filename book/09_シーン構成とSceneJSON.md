# シーン構成とSceneYAML

本章では、作品全体の初期状態を記述する`SceneYAML`と、読み込み後に扱う`SceneAsset`、検証と構築を担当する`SceneDefinition`、PBR表示とCompute physicsへ接続する`WebgSceneApp`の関係を説明します。
物体の配置、inline mesh、材質、物理空間、アニメーション、粒子の発生設定、renderer設定を一つの文書へまとめ、JavaScriptには入力処理や作品固有の更新処理を残します。

SceneYAMLとScene JSONは同じシーンデータを保存する二つの記法です。SceneYAMLはコメントを付けられるため、人が編集しながら作品の意図や物理条件を残せます。JSONは既存ツールとの交換や機械的な生成に向いています。どちらを読み込んでも、実行時には`SceneAsset`として同じデータを扱います。

## この章の読み方

### この章を読む前に必要な知識

08章の`ModelAsset`、05章のNode・Space・WebgApp、JavaScriptの配列とオブジェクトを知っていると読みやすくなります。

### 初回に読む範囲

`SceneYAML`が表す範囲、`SceneAsset`と`SceneDefinition`の違い、`WebgSceneApp`での起動例を先に読んでください。

### 必要になったときに読む範囲

inline mesh、物理設定、object animation、コメントを保持した保存、外部ModelAssetの参照は、シーンを編集・保存するときに参照してください。

### この章を終えた時点でできること

SceneYAMLまたは同じ内容のScene JSONから、primitive、inline mesh、ModelAsset参照、材質、物理、rendererを含むシーンを検証して起動できます。YAMLのコメントを保持したまま原文を読み戻し、必要に応じてYAMLまたはJSONへ保存できます。

## SceneYAMLで作品全体を宣言する

SceneYAMLは、アプリケーションが起動時に再現する作品全体を、読みやすい宣言データとして記述するシーン文書です。複数モデルの配置、物理条件、描画設定を一つにまとめます。個別モデルの形状と階層はModelYAMLで扱います。

`objects`には作品上の物体を記述し、`materials`には表面の見た目、`physics`には重力やfixed stepなどの物理条件、`renderer`にはPBR表示と画面効果を記述します。SceneYAML内で直接使うmeshは`meshes`へ置き、外部の複数mesh・Node階層・skeletonを使うときは`modelAsset`または`modelAssetUrl`から`ModelAsset`を参照します。

SceneYAMLへ初期配置を記述すると、シーンの値を変更するために毎回JavaScriptの初期化処理を書き換える必要がなくなります。SceneYAMLには再現に必要な初期値と宣言を置きます。ゲームのルール、入力への反応、毎フレームの作品固有の制御はJavaScriptへ置くことで、初期状態の編集と動作の実装を分けて進められます。

## SceneYAML、SceneAsset、SceneDefinitionの関係

同じシーンを三つの段階に分けて考えると、各クラスの役割が明確になります。

```text
SceneYAML / Scene JSON
        │ parse
        ▼
SceneAsset
  値・原文・コメント・読み込み元URLを保持
        │ toSceneDefinition()
        ▼
SceneDefinition
  項目・参照・数値を検証し、構築方法を決める
        │ build
        ▼
WebgSceneApp / Scene runtime
  Node・Shape・物理body・rendererを実行状態へ展開
```

`SceneAsset`は`DocumentAsset`を継承し、現在の値と保存用のsource documentを保持します。ModelAssetと共通の読み込み・原文保持・保存処理を使います。`SceneDefinition`は高水準SceneYAMLの項目を検証し、inline object、objectSet、ModelAsset参照、材質、物理、アニメーションを構築処理へ渡します。`WebgSceneApp`はその結果をWebGPU、PBR、Compute physics、frame更新へ接続します。

次のように、SceneYAMLを`SceneAsset`へ読み込み、検証してから高水準定義へ渡せます。

```js
import SceneAsset from "../../webg/SceneAsset.js";

const asset = await SceneAsset.load("./scene.webg.yaml");
asset.assertValid();

const source = asset.getSourceDocument();
console.log(source.format, source.comments.length);

const definition = asset.toSceneDefinition();
definition.validate();
```

通常のアプリケーションでは、次のように`WebgSceneApp`へ文書のURLを渡す方法が使いやすくなります。

```js
import { createWebgSceneApp } from "../../webg/app/index.js";

const app = await createWebgSceneApp({
  project: "./scene.webg.yaml",
  physics: { enabled: true, paused: true }
});

app.start();
```

`project`にはSceneYAMLまたは同じ構造のJSONのURL、`SceneAsset`、`SceneDefinition`、manifest objectを渡せます。作品全体を高水準APIで起動するときは、`WebgSceneApp`を入口にして、SceneAssetを編集・保存・診断が必要な場所で直接使います。

## SceneYAMLの文書構造

次は、球と床を表示し、球だけをdynamic bodyとして落とす最小構成です。コメントには、床の上面位置や物理条件を説明する情報を記録しています。

```yaml
# 球と床を表示する最小のSceneYAML projectです。
name: sphere-plane-project-app
version: 1

materials:
  # 床と球の見た目を別々に指定します。
  - id: floor-material
    color: [0.22, 0.28, 0.38, 1.0]
    metallic: 0.0
    roughness: 0.42
    specular: 0.72
  - id: ball-material
    color: [0.94, 0.30, 0.08, 1.0]
    metallic: 0.15
    roughness: 0.20
    specular: 1.0

physics:
  space:
    gravity: [0.0, -9.8, 0.0]
    fixedTimeStepMs: 8.3333333333
    solverIterations: 10
    maxBodies: 1
    planes:
      - normal: [0.0, 1.0, 0.0]
        planeDistance: 0.0

objects:
  - id: floor
    shape: { type: box, size: [12.0, 0.3, 8.0] }
    transform: { position: [0.0, -0.15, 0.0] }
    material: floor-material
  - id: ball
    shape: { type: sphere, radius: 0.5 }
    transform: { position: [0.0, 3.2, 0.0] }
    material: ball-material
    physics:
      bodyType: dynamic
      mass: 1.0

renderer:
  profile: studio
  width: 960
  height: 640
  clearColor: [0.012, 0.018, 0.028, 1.0]
  environment:
    preset: dark-studio
    resolution: { width: 128, height: 64 }
```

この例で、`objects[].shape`は表示形状を作る既存primitiveの指定です。`physics`を持つobjectでは、表示形状から対応する物理bodyが作られます。`materials`のIDをobjectから参照することで、複数のobjectへ同じ見た目を適用できます。

SceneYAMLの主な項目は次のように整理できます。

| 項目 | 役割 |
| --- | --- |
| `objects[]` | 作品上の物体、配置、親、primitiveまたはmesh参照、材質、物理body |
| `objectSets[]` | prototype、variant、配置規則を使ったprimitiveのまとまった生成 |
| `meshes[]` | SceneYAML内で直接定義する表示用geometry |
| `materials[]` | 色、metallic、roughness、specularなどのPBR値 |
| `physics.space` | 重力、fixed step、solver、容量、平面などの空間設定 |
| `physics.joints[]` | object IDを指定して接続する物理Joint |
| `animations[]` | object IDを対象にした位置・Quaternionのキーフレーム |
| `renderer` | PBR profile、環境光、画面サイズ、画面効果 |
| `modelAsset` / `modelAssetUrl` | ModelAssetを作品へ読み込む参照 |
| `materialsUrl` / `physicsUrl` | 設定を別のYAMLまたはJSON文書へ分ける参照 |

## inline meshと物理形状を分ける

SceneYAMLの`meshes`は、作品内で表示するgeometryを直接記述する場所です。`objects[].mesh`がこのgeometryを参照します。同じmeshを複数のobjectから参照でき、各objectは異なる位置、姿勢、材質を持てます。

```yaml
format: webg-scene
version: 1

physics:
  space:
    gravity: [0.0, -9.8, 0.0]
    maxBodies: 1

renderer:
  profile: studio

meshes:
  - id: panel-mesh
    vertices:
      - [-0.5, -0.5, 0.0]
      - [0.5, -0.5, 0.0]
      - [0.5, 0.5, 0.0]
      - [-0.5, 0.5, 0.0]
    faces:
      - [0, 1, 2, 3]

objects:
  - id: panel
    mesh: panel-mesh
    transform: { position: [0.0, 1.0, 0.0] }
    material: { color: [0.2, 0.6, 0.8, 1.0] }
    physics:
      bodyType: dynamic
      mass: 1.0
      # 表示面と中心をそろえ、厚さ0.1mのBoxを衝突形状に使う
      shape: { type: box, size: [1.0, 1.0, 0.1] }
      colliderRelation: proxy
```

表示面はローカル原点を中心に配置し、厚さを持つBoxを代理の衝突形状として`colliderRelation: proxy`で指定しています。表示meshと物理形状の役割を分けることで、細かい表示geometryを使いながら、物理には検証済みのBox・Sphere・Capsuleを明示できます。表示meshから複雑な衝突形状を自動生成する処理は現在のSceneYAMLの基本経路には含めません。物理条件を変えるときは`physics.shape`を編集します。

## ModelAssetをシーンへ配置する

`ModelAsset`は個別のモデル資産です。複数のmesh、Node階層、asset material、skeleton、animationを一つのモデルとして保持できます。SceneYAMLは作品全体の物理、renderer、object ID、配置方針を持ち、ModelAssetはモデル内部のgeometryと階層を持ちます。

```yaml
modelAssetUrl: ./robot.model.yaml

objects:
  - id: robot-body
    node: body
    material: robot-material
    transform: { position: [0.0, 1.0, 0.0] }
    physics:
      bodyType: dynamic
      mass: 5.0
      shape: { type: box, size: [1.0, 2.0, 1.0] }
```

この例では、`body`はModelAsset内部のNode ID、`robot-body`は作品側で参照するobject IDです。Joint、入力、接触通知など作品側の処理は`robot-body`を参照し、モデル内部のIDと混同しないようにします。ModelAssetの表示geometryを物理へ使う場合も、対応する衝突形状をSceneYAML側で明示します。

## SceneYAMLを検証して構築する

SceneYAMLを使うときは、読み込み、検証、構築、frame更新の順に進みます。`SceneDefinition.validate()`は、トップレベルの項目、object ID、mesh参照、材質、物理、renderer、アニメーションの構造を確認します。値が範囲外または参照先不明の場合、近い値へ変更せず例外として通知します。

```js
const asset = await SceneAsset.load("./scene.webg.yaml");
const report = asset.validate();

if (!report.ok) {
  console.error(report.errors);
  throw new Error("Invalid SceneYAML");
}

const app = await createWebgSceneApp({
  project: asset.toSceneDefinition(),
  physics: { enabled: true, paused: true }
});
```

高水準の起動では、`createWebgSceneApp({ project: "./scene.webg.yaml" })`に任せることもできます。`SceneAsset.build(target)`を直接呼ぶ場合は、編集ツールやGPUを使った小さな検証プログラムのように、構築対象を呼び出し側で管理したいときに使います。

```js
const asset = await SceneAsset.load("./scene.webg.yaml");
asset.assertValid();

// WebgAppはgetGPU()とspaceを持つ低水準の構築対象です。
const runtime = await asset.build(webgApp);
```

`SceneAsset`が高水準projectを保持している場合、`build()`は`SceneDefinition`を通してprimitive scene、ModelAsset runtime、材質、物理設定を構築します。構築後にGPUやNodeを一部だけ生成した状態で値の問題を発見しないため、編集画面や読み込み処理では`validate()`を先に呼び出します。

## WebgSceneAppのframe処理

`WebgSceneApp`は、SceneYAMLのrenderer、物理、アニメーションを毎フレームの処理へ接続します。通常のサンプルでは、作品側は`start()`を呼び出し、必要な入力や作品固有の更新だけをcallbackで追加します。

```js
const app = await createWebgSceneApp({
  project: "./scene_animation.yaml",
  physics: false,
  onUpdate({ deltaSec }) {
    // WebgAppと同じ秒単位で、作品固有の処理を更新する
    updateGameRule(deltaSec);
  }
});

app.start();
```

高水準のAPIでは、`setPaused()`がCompute physicsの進行、`reset()`が初期配置とphysics stateの復元、`playAnimation()`や`pauseAnimation()`がSceneYAMLのobject animationを制御します。`setTimeScale()`は物理とアニメーションの時間倍率を変更します。物理値である重力や質量そのものを書き換える処理とは分けて扱います。

## 粒子の発生設定を保存する

繰り返し発生する光点や噴出をシーンの配置と一緒に編集する場合は、`particleEmitters`へ発生装置を記述します。プリセット、容量、色や大きさを文書に置き、衝突や入力による発生タイミングはJavaScriptで判断します。以下はシーン直下へ追加する断片です。

```yaml
particleEmitters:
  - id: collision-sparks
    preset: spark
    capacity: 480
    seed: 42
    overflow: replace-oldest
    appearance:
      colors: [[8, 3.2, 0.45], [1.2, 5, 8]]
      size: [0.22, 0.44]
```

`WebgSceneApp`は初期化時に発生装置を作り、PBRへ登録します。次のコードは起動後のイベント処理で使います。

```js
const sparks = sceneApp.getComputeParticleEmitter("collision-sparks");
sparks.emit(32, {
  position: [0, 1, 0],
  velocity: [0, 12, 0],
  velocitySpread: [22, 9, 22],
  lifetime: [0.858, 1.32]
});
```

連続発生は各装置の`emission`へ`rate`と発生位置・速度・寿命を指定します。実行時の粒子状態と保存用の初期設定を分けるため、粒子が動いてもSceneYAMLの原文とコメントは保持されます。停止、消去、容量不足の通知は26章、GPU処理とPBRへの合成順は36章で説明します。

## inputとゲームロジックの分け方

キーを押したときに何をするかはJavaScriptへ残します。入力設定をSceneYAMLへ保存する場合も、文書にはキー名やアクション名を置き、ハンドラーはアプリケーションの動作として実装します。`WebgSceneApp`では、アプリのAPIを直接呼び出す小さなイベント処理を作品側へ追加できます。

```js
let paused = true;

window.addEventListener("keydown", event => {
  if (event.key === "r") {
    app.reset();
    return;
  }
  if (event.key === "p") {
    paused = !paused;
    app.setPaused(paused);
  }
});
```

この分け方により、同じSceneYAMLを別のアプリケーションへ読み込んでも、作品ごとに入力時の処理だけを差し替えられます。シーン文書へ毎フレームの条件分岐を詰め込まず、文書は初期状態と再現に必要な値へ集中させます。

## SceneYAMLの保存とコメント保持

`SceneAsset.fromYAML()`または`SceneAsset.load()`で読み込んだSceneYAMLは、解析済みの値だけでなく、原文、コメントの位置情報、読み込み元URLを保持します。

値を変更していない間は、`toYAMLText()`が元のYAMLをそのまま返します。空白、キー順、コメントを含めて原文を保持するため、読み込んだ文書を確認してそのまま保存する用途に適しています。

```js
const asset = SceneAsset.fromYAML(yamlText);
asset.assertValid();

const sameText = asset.toYAMLText();
asset.downloadYAML("scene.webg.yaml");
await asset.downloadYAMLGz("scene.webg.yaml.gz");
```

コメント付きYAMLをJavaScript値だけ変更して再びYAMLへ変換する場合、値とコメントの対応を安全に判断できないため、`SceneAsset`はコメントを黙って削除しません。更新済みのYAML原文を編集文書として渡すか、コメントを管理できる編集処理を使います。

JSONはコメントを表現できません。コメント付きYAMLからJSONを生成する場合は、コメントが失われることを明示して次のように呼び出します。

```js
const jsonText = asset.toJSONText(2, { allowCommentLoss: true });
asset.downloadJSON("scene.webg.json", 2, { allowCommentLoss: true });
```

この明示指定は、YAMLの説明を意図せず失う操作を見つけるためのものです。JSONから読み込んだSceneAssetをYAMLへ保存する場合は、`stringifySceneYAML()`が同じ値を限定YAMLとして出力します。YAMLへ変換した時点で新しいコメントは自動生成されません。

## 外部設定とsource document

SceneYAML本体が`materialsUrl`または`physicsUrl`を参照する場合、`SceneDefinition`は参照先のYAMLまたはJSONも拡張子に応じて読み込みます。外部文書のsource documentも`getSourceDocuments()`から確認できます。

```js
import SceneDefinition from "../../webg/app/SceneDefinition.js";

const definition = await SceneDefinition.load("./project.webg.yaml");
definition.validate();

for (const document of definition.getSourceDocuments()) {
  console.log(document.sourceUrl, document.format, document.comments.length);
}
```

`.yaml`と`.yml`はSceneYAML、`.json`はScene JSONとして解析されます。`.yaml.gz`、`.yml.gz`、`.json.gz`はgzipを展開した後に同じ解析を行います。YAMLのコメントを保存したい場合は、コメント付きの元文書をsource documentとして扱えるYAML経路を選びます。

## SceneYAMLの対応範囲と注意点

現在のSceneYAML parserは、webgのproject manifestで使う範囲を対象にした限定YAML parserです。コメント、インデントによるmapとsequence、基本的なscalar、短いflow配列とflow mapを扱います。文書はこの対応範囲の記法で記述します。アンカー、タグ、複雑な型を使うデータは、基本的な値と配列・マップへ展開して用意します。

SceneYAMLを拡張するときは、次の順で確認します。

1. `SceneDefinition.validate()`で項目、数値、ID参照を検証する
2. `PrimitiveScene`、`SceneMesh`、`ScenePhysics`など、実際に値を使う構築処理を更新する
3. `WebgSceneApp`のPBR、物理、frame処理との接続を確認する
4. SceneAssetのYAML/JSON入出力と、コメントを保持する編集経路を確認する
5. 対応するsample、unit test、本文の例を同じデータ構造へ合わせる

表示用inline meshを追加しても、物理形状が自動で変わるとは限りません。物理へ使う形状は`physics.shape`へ明示し、表示と衝突の寸法が意図した関係にあることを確認します。ModelAssetのmesh、SceneYAMLのmesh、物理形状はそれぞれ別の参照対象として扱います。

## 動作確認のためのリファレンス

現行のSceneYAMLとSceneAppの構成は、次のサンプルで確認できます。

- `samples/project_app/project_app_sphere_plane.html`: SceneYAML、Sphere、Plane、PBR、Compute bodyの最小構成
- `samples/project_app/project_app_object_set.html`: prototypeと`objectSets`による多数配置
- `samples/project_app/project_app_object_set_variants.html`: Sphere、Capsule、Boxのvariant
- `samples/project_app/project_app_physics.html`: 外部材質、Compute physics、SceneYAMLの組合せ
- `samples/project_app/scene_animation.html`: object IDを対象にした位置・Quaternion animation
- `samples/edit_yaml/edit_yaml.html`: SceneYAMLの配置、材質、物理、inline meshを編集する画面
- `docs/scene_yaml_model_asset_definition.md`: SceneYAML、ModelAsset、SceneAssetの正式な定義

## PBRシーンから小さなゲームへ進む

`samples/fantasy/`は、宣言した地形へ手動のShapeとNodeを追加し、
移動・攻撃・選択・GPU粒子を接続する小さな統合例です。
`main.js`の`start()`から、`scene.js`の初期設定と`visuals.js`の表示生成へ進みます。
独自の更新は`onUpdate`へ接続し、標準の粒子更新や描画を二重に実行しません。

`PBRシーンから小さなゲームへ.md`では、直接Shapeの材質、Node更新、選択、
リサイズ、再開始と解放の所有者を、この例の関数へ対応させています。
ゲームのHPや行動権はアプリの状態なので、コアの`reset()`とは分けて戻します。

## まとめ

SceneYAMLは、物体の配置だけでなく、inline mesh、材質、物理、animation、renderer、ModelAsset参照を含む作品全体のproject文書です。ModelYAMLが一つのモデルを保存するのに対し、SceneYAMLは複数の物体と作品全体の条件を保存します。

SceneYAMLまたは同じ値を持つScene JSONを読み込むと、`SceneAsset`がデータ、原文、コメント、読み込み元を保持します。`SceneDefinition`が内容を検証し、`WebgSceneApp`がPBR、Compute physics、Node、frame処理へ接続します。

YAMLコメントを含む文書は、値を変更していない限り原文のまま保存できます。値を変更してコメントの対応が不明になる場合は自動削除せず停止し、JSONへ変換してコメントを失う場合も明示指定を求めます。この扱いにより、SceneYAMLを人が読んで編集する文書として維持できます。

次の10章では、モデルに含まれるクリップの基本再生から、区間へ名前を付け、入力や状態に応じて選ぶ方法へ進みます。SceneYAMLで宣言したobject animationの再生操作は、本章のWebgSceneAppの更新と制御の節を参照してください。
