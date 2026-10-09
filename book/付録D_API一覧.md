# 付録D　webg 3.0 API一覧

この付録は、webg 3.0で利用できる公開APIを機能別に調べるための参照資料です。現行版は`3.0.0 alpha`です。設定値、既定値、例外条件は、対応する現行実装、サンプル、headless testと合わせて確認してください。

初めてアプリを作る場合は、`05_WebgAppによるアプリ構成.md`から始めます。旧名から3.0の名称へ移行する場合は、`付録B_webg_1.0・2.0から3.0への移行.md`を参照してください。

## 1. APIの入口

webg 3.0は、既存の`WebgApp`を基盤にして、作品向けの`WebgSceneApp`を上位へ追加します。

```text
作品コード
  │
  ├─ webg/app/index.js
  │    └─ WebgSceneApp / SceneDefinition / ScenePhysics / PbrRenderer
  │
  └─ 個別制御が必要な場合
       └─ webg/WebgApp.js、webg/Shape.js、webg/ComputePhysicsSpace.js など
```

**目的：PBRとCompute physicsを使う作品を作る**

推奨入口：`webg/app/index.js`

主なAPI：`createWebgSceneApp()`、`WebgSceneApp`

**目的：SceneYAML projectを検証・読込みする**

推奨入口：`webg/app/index.js`

主なAPI：`SceneDefinition`、`parseSceneYAML()`

**目的：scene appから物理を操作する**

推奨入口：`webg/app/index.js`

主なAPI：`ScenePhysics`

**目的：PBR設定を個別に制御する**

推奨入口：`webg/app/index.js`

主なAPI：`PbrRenderer`

**目的：WebgAppのframe、入力、UIを直接制御する**

推奨入口：`webg/WebgApp.js`

主なAPI：`WebgApp`

**目的：ComputeのcommandとGPU bufferを直接制御する**

推奨入口：`webg/ComputePhysicsSpace.js`、`webg/ComputeEffectPipeline.js`

主なAPI：低水準Compute API

### 1.1 SceneAppのimport

通常の作品は、次の一括入口から読み込みます。

```js
import {
  WebgSceneApp,
  createWebgSceneApp,
  SceneDefinition,
  parseSceneYAML,
  ScenePhysics,
  PbrRenderer,
  WaterBody
} from "../../webg/app/index.js";
```

`webg/app/index.js`が公開する名前は次のとおりです。

| 名前 | 内容 |
|---|---|
| `WebgSceneApp` | scene定義、WebgApp、PBR、Compute physicsを接続する高水準app |
| `createWebgSceneApp()` | `WebgSceneApp.create()`の関数形式 |
| `SceneDefinition` | project manifestの検証、URL解決、scene構築 |
| `parseSceneYAML()` | SceneYAML／ModelYAMLの文字列を解析済みの値へ変換 |
| `parseSceneYAMLDocument()` | 解析済みの値、原文、コメントを返す |
| `stringifySceneYAML()` | JavaScriptの値をYAML文字列へ変換 |
| `DocumentAsset` | SceneAssetとModelAssetに共通する文書入出力の基底クラス |
| `SceneAsset` | 作品全体の設定、原文、コメントを保持 |
| `ModelAsset` | 再利用するモデルの構造、原文、コメントを保持 |
| `compressSceneYAML(text)` | 原文とコメントをgzip圧縮した`Promise<Blob>`を返す |
| `ScenePhysics` | CPU／Compute backendをまとめるscene向け物理facade |
| `PbrRenderer` | PBR環境、遅延照明、画面効果、最終表示 |
| `WaterBody` | 水域・波・吸収係数と受光対象の登録 |
| `PBR_RENDERER_PROFILES` | 利用できるPBR profileの定義。現在は`studio` |
| `resolvePbrRendererProfile()` | profileとpipeline個別設定を合成 |
| `resolvePbrDofOptions()` | DoFの公開設定を検証し、内部設定へ変換 |
| `validatePbrEnvironmentOptions()` | 環境presetと解像度を検証 |
| `validatePbrPipelineOptions()` | shadow、SSAO、SSR、lighting、tone mapを検証 |
| `validatePbrRendererOptions()` | renderer全体の設定を検証 |

`SceneFrame`、backend、binding、helperは`WebgSceneApp`が利用する内部実装です。内部処理を調べるときは、`09_シーン構成とSceneJSON.md`と現行の`webg/app/*.js`を参照します。

## 2. WebgSceneApp

### 2.1 生成

```js
const sceneApp = await createWebgSceneApp({
  project: "./scene.webg.yaml",
  camera: {
    target: [0.0, 1.0, 0.0],
    distance: 10.5
  },
  physics: {
    enabled: true,
    paused: true
  }
});

sceneApp.start();
```

**`new WebgSceneApp(options)`**

戻り値：`WebgSceneApp`

内容：初期化前のappを生成

**`WebgSceneApp.create(options)`**

戻り値：`Promise<WebgSceneApp>`

内容：project、GPU、scene、PBR、物理を初期化

**`createWebgSceneApp(options)`**

戻り値：`Promise<WebgSceneApp>`

内容：`WebgSceneApp.create()`の関数形式

`create()`が完了した時点で、rendererとCompute physicsのresourceが利用可能です。

### 2.2 options

**option：`project`**

型：URL、`SceneAsset`、`SceneDefinition`、manifest object

役割：読み込むsceneの指定。必須

**option：`document`**

型：`Document`

役割：canvasとUIを検索するdocument。埋込み環境で指定

**option：`renderMode`**

型：`"ondemand"`／`"continuous"`

役割：描画loopの実行方針。既定値は`"ondemand"`。非表示・非フォーカス時に休止する場合は`"ondemand"`、ページ状態にかかわらず継続する場合は`"continuous"`

**option：`camera`**

型：object

役割：EyeRigの姿勢、距離、焦点対象

**option：`physics`**

型：`false`、`true`、object

役割：物理の有効状態、空間照合、初期停止状態

**option：`effects`**

型：object

役割：`shadow`、`ssao`、`ssr`、`dof`の有効状態

**option：`paused`**

型：boolean

役割：`physics.paused`を上書きする初期停止状態

**option：`timeScale`**

型：number

役割：物理とアニメーションの初期時間倍率。既定値1、`0 < value <= 4`

**option：`label`**

型：string

役割：diagnosticsとエラーの識別名。既定値は`scene-app`

**option：`createScene`**

型：function

役割：projectにscene sourceがない場合のscene生成callback

**option：`onUpdate`**

型：function

役割：WebgAppのframe更新時に呼び出すcallback

**option：`onReadback`**

型：function

役割：Compute physicsのGPU readback完了時のcallback

**option：`onPresented`**

型：function

役割：最終表示を記録した後のcallback

**option：`onError`**

型：function

役割：frameまたはreadbackのエラーを受け取るcallback

`physics` objectの項目は次のとおりです。

**項目：`enabled`**

値：boolean

内容：Compute physicsの利用状態

**項目：`spatialMatch`**

値：`report`／`require-match`

内容：表示geometryとcolliderの空間対応を、記録または登録条件として扱う

**項目：`paused`**

値：boolean

内容：初期状態の物理停止

`camera`の主な項目は`target`、`distance`、`yaw`、`pitch`、`roll`、`minDistance`、`maxDistance`、`focusTarget`、`focusTargetOffset`です。DoFを有効にする場合、`focusTarget`へNode IDまたはNodeを指定します。

### 2.3 lifecycleと診断

**`sceneApp.start()`**

frame loopを開始。`sceneApp`を返す

**`sceneApp.stop()`**

frame loopを停止。GPU resourceを保持

**`sceneApp.setPaused(value)`**

Compute physicsの進行を切り替え、`sceneApp`を返す

**`sceneApp.reset()`**

全アニメーションを基準姿勢へ戻し、物理の初期状態を復元。登録粒子と保留発生要求を消去

**`sceneApp.setTimeScale(value)`／`getTimeScale()`**

物理・アニメーション・標準Compute粒子の時間倍率を設定・取得。範囲は`0 < value <= 4`

**`sceneApp.getAnimationIds()`／`getAnimationState(id)`**

アニメーションのID一覧と再生状態を取得

**`sceneApp.playAnimation(id, options)`**

先頭から再生。`{ loop: true }`で繰り返す

**`sceneApp.pauseAnimation(id)`／`resumeAnimation(id)`**

一時停止・再開

**`sceneApp.stopAnimation(id)`**

現在の姿勢を保って停止

**`sceneApp.seekAnimation(id, seconds)`**

秒単位の時刻へ移動

**`sceneApp.resetAnimations()`**

全アニメーションを停止して登録時の姿勢へ復元

**`sceneApp.onBeginContact(listener)`**

接触開始イベントを登録

**`sceneApp.getDiagnostics()`**

project、renderer、body、binding、readback、エラーを返す

**`sceneApp.destroy()`**

appが所有するframe、renderer、physics、scene resourceを解放

`onReadback`のpayloadには、`frameIndex`、`stateData`、`contacts`、`fixedSteps`、`physics`が含まれます。`contacts`は`begin`、`stay`、`end`に分かれます。

### 2.4 標準Compute粒子

PBRシーンの発光粒子は`ComputeParticleEmitter`を使います。初期値生成、移動、重力、減衰、寿命更新をGPUで行い、透明合成後のHDR画像へ加算します。PBRへ登録する場合は既定の`rgba16float`を使い、Canvasへ直接描画する場合は表示用形式を`targetFormat`へ指定します。

**`await sceneApp.createComputeParticleEmitter(options, id)`**

粒子を生成しPBRへ登録。idは任意

**`sceneApp.getComputeParticleEmitter(id)`**

JavaScriptまたはSceneYAMLで登録した粒子を取得

**`emitter.emit(count, options)`**

一括発生。返値はaccepted、rejected、reason

**`emitter.startEmission({ rate, ...options })`**

秒当たり発生数と発生条件で連続発生

**`emitter.stopEmission()`**

新しい連続発生を停止

**`emitter.setPaused(boolean)`**

移動・寿命の進行を停止または再開

**`emitter.clear()`**

粒子・保留要求・乱数系列番号・診断数を初期化。発生設定を保持

**`emitter.getEstimatedAliveCount()`**

最大寿命から求めた予約数。保留要求を含む

**`emitter.getDiagnostics()`**

容量、推定数、要求数、拒否数、停止状態を取得

**`emitter.setTimeScale(value)`**

0以上の時間倍率。WebgSceneAppへの登録時はシーンの倍率を適用

**`emitter.destroy()`**

粒子のGPU資源を解放。アプリ終了時にも解放

生成設定は`preset: "spark" | "light" | "fountain"`、`capacity`（既定1024）、`seed`（既定1）、`overflow: "reject" | "replace-oldest"`（既定reject）、`simulation: { gravity, drag }`、`appearance: { colors, intensity, size }`です。colorsは二つの線形HDR RGB、sizeは半径の[min, max]です。

発生設定は`position`、`lifetime: [min, max]`に、`velocity`と`velocitySpread`、または`direction`・`spreadAngle`・`speed: [min, max]`を組み合わせます。単位は秒、ワールド長さ/秒、度です。一括発生数は1〜capacityの整数、保留要求は最大32件です。rejectは連続した空き円環領域を要求単位で予約します。容量不足のreasonは`particle-capacity`または`command-capacity`です。

## 3. SceneDefinitionとproject manifest

WebgSceneAppの作品定義はSceneYAMLとJSONで同じデータ構造を使います。`SceneDefinition.load()`は`.yaml`または`.yml`をYAMLとして、`.json`をJSONとして解析します。`materialsUrl`と`physicsUrl`も同じ規則で読み込みます。原文とコメントはsource documentへ保持します。

`.yaml.gz`、`.yml.gz`、`.json.gz`はgzip展開後に同じreaderで読み込みます。`compressSceneYAML(text)`は`webg/app/index.js`からimportでき、UTF-8原文をコメントごと圧縮する保存用APIです。

### 3.1 SceneDefinitionのAPI

**`SceneDefinition.fromData(manifest, options)`**

戻り値：`SceneDefinition`

内容：object化済みmanifestを保持

**`SceneDefinition.load(url, options)`**

戻り値：`Promise<SceneDefinition>`

内容：SceneYAMLまたはJSON URLを読み込み、基準URLを保存

**`SceneDefinition.fromYAML(text, options)`**

戻り値：`SceneDefinition`

内容：SceneYAML textを解析し、project definitionを生成

**`definition.getSourceDocument()`**

戻り値：objectまたはnull

内容：元文書の形式、原文、コメント、URLを取得

**`definition.getSourceDocuments()`**

戻り値：Array

内容：外部文書を含む読み込み済みsource documentの一覧

**`definition.validate()`**

戻り値：`true`

内容：manifestのキー、型、sourceの組合せを検証

**`definition.loadMaterials()`**

戻り値：`Promise<Array>`

内容：inlineまたは`materialsUrl`の材質をSceneYAML／JSONから読込み

**`definition.loadPhysics()`**

戻り値：`Promise<object>`

内容：inlineまたは`physicsUrl`の物理設定をSceneYAML／JSONから読込み

**`definition.getRendererOptions()`**

戻り値：object

内容：renderer設定の複製を返す

**`definition.getPhysicsOptions()`**

戻り値：object

内容：physics設定の複製を返す

**`definition.getBindings()`**

戻り値：Array

内容：Nodeと物理設定の対応を返す

**`definition.resolveUrl(value, fieldName)`**

戻り値：string

内容：projectの基準URLから相対URLを解決

**`definition.build(target)`**

戻り値：`Promise<object>`

内容：`scene`／`sceneUrl`からscene runtimeを構築

**`definition.buildPrimitiveScene(target)`**

戻り値：`Promise<object>`

内容：`objects`／`objectSets`からprimitive sceneを構築

**`definition.buildModelRuntime(target)`**

戻り値：`Promise<object>`

内容：ModelAssetのNode、mesh、マテリアルをruntimeへ展開

**`definition.createLoader(target)`**

戻り値：`SceneLoader`

内容：SceneLoaderを生成

**`definition.destroy()`**

戻り値：boolean

内容：manifestと関連resourceを解放

### 3.2 manifestの最上位キー

**キー：`name`**

型：string

内容：project名

**キー：`version`**

型：integer

内容：manifest形式のversion。既定値は`1`

**キー：`renderer`**

型：object

内容：PBR profile、環境、画面効果、出力サイズ

**キー：`physics`**

型：object

内容：Compute physicsのspace、body、Joint

**キー：`physicsUrl`**

型：URL

内容：外部physics manifest。拡張子でSceneYAML／JSONを選択

**キー：`materials`**

型：Array

内容：inline材質manifest

**キー：`materialsUrl`**

型：URL

内容：外部材質manifest。拡張子でSceneYAML／JSONを選択

**キー：`objects`**

型：Array

内容：primitive、inline meshの配置、またはModelAsset内のNodeへの設定

**キー：`meshes`**

型：Array

内容：頂点と三角面・四角面からなる表示用mesh

**キー：`format`**

型：string

内容：inline meshやアニメーションを含む作品定義は`webg-scene`

**キー：`animations`**

型：Array

内容：object IDを対象にしたキーフレームアニメーション

**キー：`objectSets`**

型：Array

内容：prototype／variantと配置規則

**キー：`scene`／`sceneUrl`**

型：object／URL

内容：SceneAssetのinlineまたは外部指定

**キー：`modelAsset`／`modelAssetUrl`**

型：object／URL

内容：ModelAssetの直接指定、またはModelYAML／Model JSONへの参照

**キー：`bindings`**

型：Array

内容：asset Nodeとphysics bodyの対応

構築元は`scene`／`sceneUrl`、`modelAsset`／`modelAssetUrl`、`objects`／`objectSets`、`createScene`から選びます。ModelAssetを構築元とするときの`objects`は、モデル内のNodeと作品側のID・物理設定を結び付けます。primitive sceneでは`materials`または`materialsUrl`と、inlineの`physics.space`を組み合わせます。

`particleEmitters`には一意の`id`と標準Compute粒子の生成設定を配列で指定します。任意の`emission`に`rate`と発生条件を記載すると連続発生を設定します。詳しい例は09章と26章を参照してください。

### 3.3 primitive object

```yaml
id: ball
shape: { type: sphere, radius: 0.5 }
transform: { position: [0.0, 3.2, 0.0] }
material: ball-material
physics:
  bodyType: dynamic
  mass: 1.0
  material: { restitution: 0.18, friction: 0.36 }
```

**項目：`id`**

scene、physics、Joint、diagnosticsで共有する一意なID

**項目：`shape.type`**

`box`、`sphere`、`capsule`

**項目：`shape.size`**

Boxの全幅、全高、全奥行き

**項目：`shape.radius`**

SphereまたはCapsuleの半径

**項目：`shape.segmentLength`**

Capsuleの芯線長。0で球形へ縮退

**項目：`shape.offset`**

表示shapeとbody shapeのローカルオフセット

**項目：`transform.position`**

初期位置。既定値は`[0, 0, 0]`

**項目：`transform.orientation`**

初期姿勢。`{yaw, pitch, roll}` または軸順`[X, Y, Z]`の3要素を度数で指定します。既定値は無回転

**項目：`material`**

`materials[].id`を参照する文字列

**項目：`physics`**

`static`、`kinematic`、`dynamic`のbody設定

`physics.shape`を省略すると、表示用`shape`をbody shapeへ共有します。表示と衝突の寸法を同じ定義で管理し、proxy colliderを使う場合は`physics.shape`と`colliderRelation: "proxy"`を明示します。

### 3.4 objectSet

`objectSets[]`は、`prototype`または`variants`と、`placement`を組み合わせます。

| 項目 | 内容 |
|---|---|
| `prototype` | 共通のshape、transform、material、physics |
| `variants` | `id`ごとの複数形状定義 |
| `variantPattern` | 個体ごとにvariantを選ぶcycleまたはrange |
| `placement.type` | 現在は`grid3d` |
| `placement.count` | X、Y、Z方向の個数 |
| `placement.origin` | 配置の原点 |
| `placement.spacing` | 個体間隔 |
| `placement.seed` | jitter用の再現可能なseed |
| `placement.jitter` | 軸ごとの配置揺らぎ |
| `instancePattern` | `transform`、`physics`のcycleまたはrange |
| `overrides` | objectSet全体または個体への上書き |

## 4. PBRと画面効果

### 4.1 PbrRendererのAPI

**`new PbrRenderer(gpu, options)`**

戻り値：`PbrRenderer`

内容：PBR環境、pipeline、copy passを生成開始

**`renderer.waitUntilReady()`**

戻り値：`Promise<PbrRenderer>`

内容：非同期GPU resourceの準備完了を待つ

**`renderer.renderScene(space, cameraFrame, clearColor, options)`**

戻り値：`PbrRenderer`

内容：sceneをG-bufferへ描画

**`renderer.encode(commandEncoder, options)`**

戻り値：output target

内容：遅延照明からtone mapまでを記録

**`renderer.present(screen, options)`**

戻り値：`PbrRenderer`

内容：encode結果をcanvasへ表示

**`renderer.createFrameCallbacks(app, options)`**

戻り値：callback object

内容：WebgAppのframe処理へ接続

**`renderer.resize(width, height)`**

戻り値：boolean

内容：中間targetを画面サイズへ変更

**`renderer.getDiagnostics()`**

戻り値：object

内容：profile、サイズ、環境、DoF状態を返す

**`renderer.setWater(body, options)`**

戻り値：`Promise<void>`

内容：`WaterBody`の水面と集光を接続。`body: null`で専用GPU資源を解放。
optionsの`surfaceEnabled`・`causticsEnabled`は既定でfalse、
`quality`は`"low"`／`"high"`で既定は`"high"`。
切替中は新しいframeを止め、完了を待って再開する。
`ComputeEffectPipeline.setWater()`も同じ契約。

**`renderer.getWaterStats()`**

戻り値：object

内容：水面・集光の有効状態、dispatch／pass数、GPU計測`timing`を返す。
両方OFFでは専用処理数0、`timing: null`。
`ComputeEffectPipeline.getWaterStats()`も同じ契約。

**`renderer.afterGpuSubmit()`**

戻り値：void

内容：手動submit後の計測収集。標準frame callbackでは自動実行。

**`renderer.destroy()`**

戻り値：boolean

内容：PBR resourceを解放

直接`PbrRenderer`を生成する場合、`gpu`には`device`と`queue`を持つ初期化済みWebGPU contextを、`width`と`height`には正の整数を渡します。通常の作品では`WebgSceneApp`がこの準備を行います。

`WebgSceneApp`から利用する`PbrRenderer`は、環境のradianceを入力に`PbrEnvironmentCompute`を起動し、irradiance、specular mip、BRDF LUTをGPU上で生成します。CPUで作成済みのlevelを使う低水準経路は、`PbrEnvironment`と`createProceduralEnvironmentData()`を個別に組み合わせます。

### 4.2 renderer manifest

```yaml
profile: studio
width: 960
height: 640
environment:
  preset: dark-studio
  resolution: { width: 128, height: 64 }
dof: { enabled: false }
pipeline:
  lighting: { ambient: 0.0, environmentIntensity: 0.42 }
  ssao: { radius: 12.0, strength: 1.15, samples: 8 }
  ssr: { intensity: 0.65, distance: 24.0, steps: 28 }
  toneMap: { exposure: 1.0 }
```

**block：`profile`**

主な項目：`studio`

内容：PBR、shadow、SSAO、SSR、tone mapのprofile

**block：`environment`**

主な項目：`preset`、`resolution`

内容：procedural environmentと緯度経度画像の解像度。幅と高さは2:1

**block：`pipeline.shadow`**

主な項目：`type`、`bias`、`normalBias`、`pcfRadius`

内容：directionalまたはspot shadow

**block：`pipeline.ssao`**

主な項目：`radius`、`strength`、`bias`、`samples`、`resolutionScale`

内容：画面空間の環境遮蔽

**block：`pipeline.ssr`**

主な項目：`intensity`、`distance`、`thickness`、`steps`、`resolutionScale`、`reflectivityThreshold`

内容：画面空間反射

**block：`pipeline.lighting`**

主な項目：`unitSystem`、`ambient`、directional／spot、environment

内容：直接光とIBL。`relative`または`photometric`

**block：`pipeline.composer`**

主な項目：`mode`

内容：`add`、`mix`、`pbr-ssr`

**block：`pipeline.toneMap`**

主な項目：`mode`、`exposure`、`exposureEv100`、`saturation`、`gamma`

内容：線形HDRからcanvas表示への変換

**block：`dof`**

主な項目：`enabled`、`focus`、`blurRadius`

内容：`rangeMeters`と`transitionMeters`によるDoF

環境を有効にしたPBRでは`pipeline.lighting.ambient`を`0.0`にします。`unitSystem: "photometric"`では、`toneMap.exposureEv100`を指定します。tone mapの`exposure`と`exposureEv100`はどちらか一方を選びます。

### 4.3 PBR材質

primitiveの`materials[]`では、`color`、`metallic`、`roughness`、`specular`、`occlusion`、`emissive`、`emissiveFactor`、`alphaMode`などを指定します。制作sceneの外部材質では、`assetMaterialId`と`pbr`または`preset`を組み合わせます。

| 材質値 | 意味 |
|---|---|
| `color` | base color。RGBAの0〜1 |
| `metallic` | 金属成分。0〜1 |
| `roughness` | 鏡面反射の粗さ。0〜1 |
| `specular` | 非金属の鏡面反射量 |
| `occlusion` | 環境光の遮蔽量 |
| `emissive`、`emissiveFactor` | 照明とは独立した線形HDR発光 |
| `alphaMode` | `OPAQUE`、`MASK`、`BLEND` |
| `flatShading`、`doubleSided` | 法線と背面描画の設定 |

外部材質の`preset`には、`tile`、`appearance`、`scale`、`uvMapping`を組み合わせられます。`uvMapping`は`real-cuboid`、`real-sphere`、`real-capsule`を選びます。

### 4.4 WaterBody

import先は`webg/WaterBody.js`、または`webg/app/index.js`です。
水域はmanifestと別に`setWater()`で接続します。35章と
`samples/water/index.html`、`samples/fantasy/main.js`を参照してください。

**`new WaterBody(options)`**

GPUを作らず、水域、波、吸収、受光対象を保持。
座標と距離はm、時刻は秒、吸収係数は1/m。

- `origin`：水平照度基準面の中心。既定は`[0, 0, 0]`。
- `width`・`depth`：水域のXZ幅・奥行き。既定は各8m。
- `extent`：照度計算の一辺。既定は幅・奥行きの最大値×2.5。
- `surfaceHeight`：平均水面のワールドY。既定は2m。
- `amplitude`：波の変位の上界。既定は0.15m。
- `wavelength`・`speed`：波長倍率・時間倍率。既定は各1、speedは0で停止。
- `waveMix`：交差波・うねり・さざ波の非負の重み。既定は`[1, 0, 0]`。
- `variation`：連続な波形変調、0〜1。既定は0.65。
- `ior`：屈折率、1〜3。既定は1.333。
- `absorption`：RGB吸収係数。既定は`[0.09, 0.035, 0.025]`。
- `roughness`：水面の粗さ、0.045〜1。既定は0.06。
- `waterlineFade`：水際の集光混合幅。既定は0.08m。

`extent`は幅・奥行き以上、平均水深`surfaceHeight - origin[1]`は
`amplitude`より大きくする。各距離・倍率の許容範囲は35章と現行実装を参照。

**`water.setOptions(patch)`**

戻り値：`WaterBody`

設定の一部を変更。不正値では例外を投げ、元の有効な設定を保持する。
波や吸収の変更に`setWater()`の再接続は不要。

**`water.setTime(seconds)`**

戻り値：`WaterBody`

非負の秒単位の時刻を設定。アプリの更新処理から呼ぶ。

**`water.addReceiver(target, options)`**

戻り値：`WaterBody`

ShapeまたはNodeを登録。`strength`は0〜1で既定1、`children`は既定true。
Shape優先、Nodeでは最も近い親の登録を使う。対象は不透明面。

**`water.removeReceiver(target)`**

戻り値：boolean

登録を削除し、対象が登録されていたかを返す。

**`water.clearReceivers()`**

戻り値：`WaterBody`

受光対象を全解除。GPU資源の接続・解放はrendererが担当する。

初版の集光は鉛直入射光と水平照度画像の投影近似。
水面表示は有限の水平水域を上から見る用途で、水中カメラの描画は含まない。

## 5. ScenePhysicsと物理API

### 5.1 ScenePhysics

```js
const physics = new ScenePhysics({
  gpu: app.getGPU(),
  gravity: [0.0, -9.8, 0.0],
  fixedTimeStepMs: 8.3333333333,
  maxSubSteps: 8,
  solverIterations: 10,
  planes: [{ normal: [0.0, 1.0, 0.0], planeDistance: 0.0 }]
});
```

`ScenePhysics`の既定backendは`compute`です。比較・検証では`backend: "cpu"`を指定できます。

**`new ScenePhysics(options)`**

CPUまたはCompute backendとbindingを生成

**`physics.addBody(node, options)`**

Nodeと物理bodyを登録

**`physics.addRawBody(body)`**

bindingを使わずbodyを登録

**`physics.addPlane(node, options)`**

Planeを登録

**`physics.addJoint(joint)`／`removeJoint(joint)`**

Jointを登録・削除

**`physics.step(deltaMs, options)`**

CPUは即時step、Computeは同じcommand encoderへ記録

**`physics.createStateReadbackBuffer()`**

Compute state readback bufferを作成

**`physics.encodeStateReadback(...)`**

Compute readback copyを記録

**`physics.readStateReadback(...)`**

GPU readbackを非同期に読込み

**`physics.sync()`**

CPU bodyの姿勢をNodeへ同期

**`physics.syncReadback(stateData)`**

Compute readbackをNodeへ同期

**`physics.syncFromNodes()`**

CPUのkinematic／static Node姿勢をbodyへ書込み

**`physics.syncComputeFromNode(bodyId, node, options)`**

ComputeのNode姿勢を次のGPU stepへ記録

**`physics.reset()`**

Compute全bodyを初期状態へ復元

**`physics.resetBody(bodyId, options)`**

Computeの指定bodyを初期状態へ復元

**`physics.getBindings()`／`getBodies()`**

対応表とbody一覧を取得

**`physics.getLastContacts()`など**

接触、manifold、contact eventを取得

**`physics.raycast()`／`raycastAll()`**

レイとbodyの交差を検索

**`physics.queryAabb()`**

AABBとbodyの重なりを検索

**`physics.overlapSphere()`**

Sphereとbodyの重なりを検索

**`physics.onBeginContact()`など**

begin／stay／end contact listenerを登録

**`physics.destroy()`**

backendとbindingを解放

Computeの`step()`は`options.commandEncoder`を受け取り、GPU commandへ記録します。CPUの`step()`はdeltaMsを受け取り、CPU上で処理します。作品ではこのbackend差を`WebgSceneApp`が吸収します。

### 5.2 ComputePhysicsSpace

GPU状態を直接扱う高度な構成では、`ComputePhysicsSpace`を使います。

**`new ComputePhysicsSpace(gpu, options)`**

GPU buffer、fixed step、Broad Phase、solverを初期化

**`setBodies(bodies)`**

body配列を検証して初期stateへ設定

**`addBody(body)`／`removeBody(bodyId)`**

bodyを追加・削除

**`addJoint(joint)`／`removeJoint(jointId)`**

Compute Jointを登録・削除

**`encode(commandEncoder, elapsedMs)`**

経過時間をfixed stepへ分解して記録

**`step(commandEncoder, elapsedMs)`**

`encode()`と同じCompute記録入口

**`encodeFixedStep(commandEncoder)`**

一回分のclear、Broad Phase、solverを記録

**`getRenderState()`**

描画が参照するstate buffer情報を取得

**`getCurrentStateBuffer()`／`getStateBuffers()`**

GPU state bufferを取得

**`createStateReadbackBuffer()`**

state readback用bufferを作成

**`encodeStateReadback()`**

state copyをcommand encoderへ記録

**`readBodyStateFromReadback()`**

body一つの位置、速度、sleepを取得

**`syncNodeFromPhysics()`／`syncNodesFromPhysics()`**

readback stateをNodeへ反映

**`syncPhysicsFromNode()`**

kinematic／static姿勢をcontrolへ記録

**`applyForce()`／`applyImpulse()`**

bodyへ力または衝撃量を記録

**`applyTorque()`／`applyAngularImpulse()`**

bodyへ回転作用を記録

**`teleport()`／`setBodyOrientation()`**

bodyの位置・姿勢を更新

**`wakeBody()`／`sleepBody()`／`stopBodyMotion()`**

bodyの運動状態を更新

**`setBodyType()`／`setBodyMass()`**

body属性を更新

**`getContactsFromReadback()`など**

readbackからcontact、manifold、eventを取得

**`raycastFromReadback()`など**

readback状態へqueryを実行

**`getBodyInfo()`／`getJointInfo()`**

ID、slot、形状、Joint設定を取得

**`destroy()`**

GPU resourceを解放

Compute colliderは`ComputeBoxCollider`、`ComputeSphereCollider`、`ComputeCapsuleCollider`を使います。Planeは`ComputePhysicsSpace`の`planes`へ`normal`と`planeDistance`を指定します。標準のBroad PhaseはXZ Gridです。

### 5.3 CPU PhysicsSpace

既存のCPU物理を直接使う場合は`webg/PhysicsSpace.js`を読み込みます。

| API | 内容 |
|---|---|
| `new PhysicsSpace(options)` | gravity、fixed step、sleep、body容量を初期化 |
| `addBody(body)`／`removeBody(body)` | CPU PhysicsNodeを登録・削除 |
| `addJoint(joint)`／`removeJoint(joint)` | CPU Jointを登録・削除 |
| `step(deltaMs)` | accumulatorからfixed stepを実行 |
| `raycast()`／`raycastAll()` | CPU bodyへのレイ検索 |
| `queryAabb()`／`overlapSphere()` | CPU bodyへの空間query |
| `onBeginContact()`など | contact event listener |
| `getLastContacts()`など | 接触とsleep islandの結果 |
| `setGravity()`、`setFixedTimeStepMs()` | 空間設定を更新 |

## 6. WebgAppと低水準3D API

### 6.1 WebgApp

`WebgApp`は、GPU、canvas、`Screen`、`Space`、camera、input、message、更新loopをまとめる既存のアプリ基盤です。

| API | 内容 |
|---|---|
| `new WebgApp(options)` | app設定とruntime stateを初期化 |
| `app.init()` | Screen、GPU、Space、camera、UIを初期化 |
| `app.start(handlers)`／`app.stop()` | frame loopを開始・停止 |
| `app.getGPU()` | 初期化済みGPU wrapperを返す |
| `app.createCameraRig()` | camera base、rod、eyeのNode階層を作成 |
| `app.createOrbitEyeRig(options)` | Orbit EyeRigとpointer入力を接続 |
| `app.attachInput(handlers)` | key、pointer、touch入力を接続 |
| `app.loadScene(scene)` | scene dataをWebgAppのSpaceへ展開 |
| `app.loadModel(source, options)` | ModelAssetを読み込み |
| `app.showOverlayPanel(options)` | OverlayPanelを作成・表示 |
| `app.setHudRows(rows, options)` | HUDの行を更新 |
| `app.setControlRows(rows, options)` | 操作説明の行を更新 |
| `app.createTween(target, to, options)` | 値の時間変化を登録 |
| `app.createParticleEmitter(options)` | CPU ParticleEmitterを初期化・登録 |
| `app.registerActionMap(map)`／`getAction(name)` | 入力actionを登録・取得 |
| `app.setFog(options)` | 通常描画のfog設定を更新 |
| `app.getCurrentDiagnosticsReport()` | 現在のdiagnostics reportを返す |
| `app.setDebugMode(mode)` | `debug`／`release`を切り替え |
| `app.saveProgress()`／`loadProgress()` | progress storageへ保存・読込み |

Compute-firstのframeでは、`new WebgApp({ computeFrame: true })`と`start({ onComputeFrame })`を組み合わせます。`onComputeFrame`がCompute Pass、Render Pass、queue submitまでの一つのframeを記録します。`WebgSceneApp`はPBRと物理を組み合わせたこの処理順を内部で管理します。

### 6.2 Space、Node、Shape

**`Space`**

主なAPI：`addNode()`、`findNode()`、`draw()`、`update()`、`raycast()`、`checkCollisions()`

役割：Node階層、描画、アニメーション、低水準query

**`Node`**

主なAPI：`setParent()`、`setPosition()`、`setAttitude()`、`setScale()`、`addShape()`、`getWorldMatrix()`

役割：親子階層とworld姿勢

**`Shape`**

主なAPI：`setMaterial()`、`setMaterialAt()`、`setTexture()`、`applyPrimitiveAsset()`、`endShape()`、`draw()`、`destroy()`

役割：geometry、材質、texture、描画resource

**`Primitive`**

主なAPI：`sphere()`、`capsule()`、`cuboid()`、`cone()`、`revolution()`、`mapRealCuboid()`

役割：geometry生成と実寸UV

**`Screen`**

主なAPI：`beginPass()`、`endPass()`、`submit()`、`resize()`、`beginPresentPass()`

役割：canvas、render target、command submit

Shapeの作成では、`Primitive`でgeometryを生成し、`Shape.applyPrimitiveAsset()`へ渡してから`Shape.endShape()`でGPU resourceを確定します。材質は`setMaterial()`、複数材質は`setMaterialAt()`とtriangle material indexで指定します。

### 6.3 cameraと座標

| クラス／API | 内容 |
|---|---|
| `EyeRig` | Orbit、First Person、Followの姿勢、pointer、touch、focusを管理 |
| `WebgApp.createOrbitEyeRig()` | Orbitの標準Node階層と入力更新を接続 |
| `CameraFrame` | camera world matrixからcamera-relative座標とview行列を作成 |
| `createCameraFrameFromEye()` | Eye NodeからCameraFrameを生成 |
| `createRenderFrameToken()` | 同じcamera frameであることを示すtokenを生成 |
| `CAMERA_REVERSE_Z` | 通常cameraのReverse-Z深度規則 |
| `SHADOW_STANDARD_Z` | shadow mapのStandard-Z深度規則 |

通常cameraはReverse-Z、shadow mapはStandard-Zを使います。深度形式、clear値、比較関数、投影行列を同じ規則へそろえます。

## 7. PBR、Compute Pass、データassetの低水準API

**`PbrEnvironment`**

主なAPI：`getResources()`、`destroy()`

役割：irradiance、prefiltered specular、BRDF LUTを提供

**`ComputeEffectPipeline`**

主なAPI：`renderScene()`、`encode()`、`resize()`、`getBindingResources()`、`destroy()`

役割：G-buffer、PBR照明、SSAO、SSR、画面効果

**`ComputePass`**

主なAPI：`setUniforms()`、`encode()`、`destroy()`

役割：独自WGSLとstorage resourceのCompute接続

**`DeferredLightingPass`**

主なAPI：`render()`、`destroy()`

役割：G-bufferから直接光とIBLを計算

**`FullscreenPass`**

主なAPI：`draw()`、`destroy()`

役割：textureをfullscreenへ描画

**`ModelAsset`**

主なAPI：`load()`、`fromData()`、`validate()`、`build()`、`getClip()`

役割：mesh、Node、材質、animationのasset

**`SceneAsset`**

主なAPI：`load()`、`fromData()`、`assertValid()`、`toSceneDefinition()`、`build()`

役割：配置、mesh、物理、rendererを保持するシーン資産

**`DocumentAsset`**

主なAPI：`fromYAML()`、`fromJSON()`、`getSourceDocument()`、`toYAMLText()`

役割：SceneAsset／ModelAsset共通の入出力

**`MaterialParameters`**

主なAPI：`resolveShapeMaterial()`、`validateTransparency()`、`applyTransmissionParameters()`

役割：Shape材質と透明PBR値の解決

### 7.1 ComputePassのframe規則

`ComputePass.encode(commandEncoder, resources, options)`はGPU commandを記録します。queue submitは呼出側が行います。独自Computeを追加する場合は、次の順でresourceを管理します。

1. storage buffer、storage texture、uniformを作成する。
2. `ComputePass`へbindingを渡す。
3. `encode()`でCompute commandを同じencoderへ記録する。
4. 必要なRender Passを記録する。
5. `queue.submit()`を一度実行する。
6. page終了時に`destroy()`でresourceを解放する。

HDRの中間targetは`rgba16float`、canvasへ渡す最終targetは表示用formatとして扱います。tone mappingは最終表示の一度だけ適用します。

### 7.2 assetの選択

**作りたいもの：SceneYAML／JSONから配置、PBR、物理を構築する**

選ぶAPI：`SceneAsset`、`SceneDefinition`、`WebgSceneApp`

**作りたいもの：mesh、animation、skeletonを扱う**

選ぶAPI：`ModelAsset`

**作りたいもの：primitiveをコードまたはSceneYAML／project JSONから作る**

選ぶAPI：`Primitive`、`Shape`、`SceneDefinition`

**作りたいもの：外部PBR材質をNodeへ適用する**

選ぶAPI：`SceneDefinition.applyMaterials()`

**作りたいもの：texture生成と実寸mappingを使う**

選ぶAPI：`ProceduralMaterials`、`ProceduralTileSpec`、`Primitive.mapRealCuboid()`

### 7.3 SceneAssetとModelAssetの文書入出力

両クラスは`DocumentAsset`を継承します。YAMLとJSONの同じデータ構造を読み込み、各資産の検証処理で内容を確認します。

**`SceneAsset.load(url)`／`ModelAsset.load(url)`**

`.yaml`、`.yml`、`.json`と各gzip形式を読み込む

**`fromYAML(text, options)`／`fromJSON(text, options)`**

文字列から資産を作成

**`getData()`／`setData(data)`**

解析済みの値を取得・設定

**`getSourceDocument()`／`getSourceUrl()`**

原文、コメント、読み込み元を取得

**`toYAMLText()`**

YAML文字列を取得。値が未変更なら原文を返す

**`toJSONText(indent, options)`**

JSON文字列を取得

**`downloadYAML(filename)`／`downloadYAMLGz(filename)`**

YAMLまたは圧縮YAMLを保存

**`assertValid()`**

資産固有の参照・値を検証

コメント付き文書を編集して保存するときは、更新したYAML原文を`fromYAML()`へ渡します。値だけを変更して原文との対応が失われた状態では、`toYAMLText()`が例外を返します。コメントを含むYAMLからJSONへ変換する場合は、`toJSONText(2, { allowCommentLoss: true })`で変換の意図を明示します。

## 8. Joint、Collider、物理イベント

### 8.1 Joint

| クラス | 内容 |
|---|---|
| `Joint` | body A／B、compliance、enabled、collision suppressionの共通定義 |
| `DistanceJoint` | 2つのanchor間の距離を保つlinear constraint |
| `FixedJoint` | 2つのbodyの相対姿勢を固定 |
| `BallSocketJoint` | 2つのanchor位置を一致 |
| `HingeJoint` | 指定軸まわりの回転を許可 |
| `JointDefinition` | SceneYAMLのDistance Joint指定を検証してCompute定義へ変換 |

Distance Jointの主な設定は`bodyA`、`bodyB`、`localAnchorA`、`localAnchorB`、`distance`、`compliance`、`collideConnected`です。bodyの指定にはsceneのbinding IDまたはCompute body IDを使い、GPU slot番号は内部実装へ閉じ込めます。

### 8.2 Collider

| CPU | Compute | 形状 |
|---|---|---|
| `BoxCollider` | `ComputeBoxCollider` | 回転可能なBox |
| `SphereCollider` | `ComputeSphereCollider` | Sphere |
| `CapsuleCollider` | `ComputeCapsuleCollider` | local-Y Capsule |
| `PlaneCollider` | `ComputePlaneCollider` | 法線と平面距離による無限Plane |

各Colliderは`getAabb()`、`intersectRay()`、`overlapsAabb()`、`overlapSphere()`を提供します。Compute版のGPU solverはBox、Sphere、CapsuleとPlaneを対象にし、Capsuleの芯線はlocal Y軸です。

### 8.3 contact event

| API | 内容 |
|---|---|
| `onBeginContact(listener)` | 接触を開始したframeのevent |
| `onStayContact(listener)` | 接触が続くframeのevent |
| `onEndContact(listener)` | 接触が終了したframeのevent |
| `offBeginContact(listener)`など | listenerを解除 |
| `getContactsFromReadback()` | readback stateからcontactを取得 |
| `getManifoldsFromReadback()` | contact manifoldを取得 |
| `getContactEventsFromReadback()` | begin／stay／endを取得 |
| `raycastFromReadback()`など | GPU stateのreadbackへqueryを実行 |

## 9. 共通の利用規則

### 9.1 非同期処理

`WebgSceneApp.create()`、`createWebgSceneApp()`、`SceneDefinition.load()`、`PbrRenderer.waitUntilReady()`、assetの`load()`はPromiseを返します。後続の描画、物理、材質適用はPromiseの完了後に開始します。

### 9.2 command encoderとsubmit

Compute physics、`ComputePass`、`PbrRenderer.encode()`はcommand encoderへ処理を記録します。encoderの生成とqueue submitの所有者をframe単位で決め、同じframeのCompute、readback、描画、presentの順序を保ちます。`WebgSceneApp`ではこの順序を`SceneFrame`が管理します。

### 9.3 入力検証と例外

webgの公開APIは、未知のキー、配列長、数値範囲、未対応のenum、GPU resourceの状態を呼出時に検証します。エラーには、`renderer.pipeline.ssao.samples`や`physics.bodies[2].shape`のように入力位置が含まれます。表示を進めるための値の自動補正は行わず、設定の修正箇所を特定できるエラーとして返します。

### 9.4 resource lifecycle

GPU resourceを生成したクラスが、そのresourceの`resize()`と`destroy()`を担当します。作品終了時は、frame、renderer、physics、scene、Shape、追加passの所有関係に沿って解放します。同じresourceを複数の所有者が破棄する場合は、所有範囲をoptionsで明示します。

## 10. APIを探すときの参照順

1. この付録でクラス名と主要メソッドを確認する。
2. 対応する章で、役割、処理順、入力条件を読む。
3. `samples/project_app/`で`WebgSceneApp`の実行例を確認する。
4. `samples/`のREADMEとSceneYAML／JSONで設定形式を確認する。
5. `headless_tests/`で境界値と例外条件を確認する。
6. `unittest/`またはブラウザーでGPU表示と操作を確認する。
7. 最後に現行の`webg/*.js`で公開メソッドとresource所有を確認する。

**目的：WebgApp、canvas、入力、UI**

本文・サンプル：`05_WebgAppによるアプリ構成.md`、`12_UI表示の設計.md`

**目的：SceneYAML・ModelYAMLと資産**

本文・サンプル：`09_シーン構成とSceneJSON.md`、`08_モデルアセットとランタイム.md`

**目的：CPU／Compute physics**

本文・サンプル：`27_物理エンジンを使う.md`、`28_物理イベント、設定、更新.md`

**目的：手続き材質と実寸UV**

本文・サンプル：`29_手続きテクスチャと実寸マッピング.md`

**目的：PBR、IBL、環境光**

本文・サンプル：`30_物理ベースレンダリングと環境光.md`、`31_PBR統合の考え方.md`

**目的：低水準Shapeと描画**

本文・サンプル：`37_低水準APIの基礎.md`

**目的：物理solverの内部**

本文・サンプル：`42_物理エンジンの詳細設計.md`、`27_物理エンジンを使う.md`

この付録は、3.0の公開入口と主要な低水準APIの現在位置を示します。詳細なprofile値、Schema、実装上の制限は、現行の`webg/app/`、`webg/`、サンプルのSceneYAML／JSON、対応するテストを組み合わせて確認してください。
