# webg 1.0・2.0から3.0への移行

この付録は、webg 1.0または2.0で作成したアプリケーションを、webg 3.0のSceneYAML、ModelYAML、PBR、Compute Shader物理を使う構成へ移すための案内です。
webg 3.0から制作を始める場合は本編の各章を順に読み、既存アプリケーションを移す場合は、この付録で変更範囲を決めてから対応する章へ進みます。

移行量はアプリケーションごとに異なります。
既存アプリケーションが、手続き的に`Node`と`Shape`を作る構成か、SceneYAMLで作品全体を記述する構成か、PBRやCompute Shaderをどこまで使うかを確認し、必要な層から順に移します。

現行APIの詳細、設定値、検証条件は本編の該当章と実行例で確認できます。この付録では、移行時の考え方、変更するファイルの単位、確認方法をまとめます。


3.0の個別モジュール版から統合版へ読み込み方を切り替える場合は、
`付録C_統合版の利用.md`を参照してください。ここで説明する版の移行とは分けて、
importとファイル配置を調整する手順として扱います。

## 1. webg 3.0で移行する範囲

webg 3.0では、従来の`WebgApp`、`Space`、`Node`、`Shape`を使う低水準の制作方法を保ちながら、作品全体を定義する高水準入口を追加しています。新しい入口は、シーン定義、PBR描画、Compute Shader物理、物理状態とNodeの同期を一つの処理フローへまとめます。

主な変更領域は次のとおりです。

**分野：アプリ入口**

3.0で使う構成：`WebgSceneApp`、`createWebgSceneApp()`

移行時に確認すること：既存の初期化、更新、破棄処理を高水準入口へ集約するか

**分野：シーン定義**

3.0で使う構成：`SceneYAML`、`SceneAsset`、`SceneDefinition`

移行時に確認すること：物体、材質、物理、renderer設定を文書へ移す範囲

**分野：モデル資産**

3.0で使う構成：`ModelYAML`、`ModelAsset`

移行時に確認すること：再利用するmeshとNode階層をモデル文書へ分ける範囲

**分野：描画**

3.0で使う構成：metallic-roughness PBR、HDR、IBL、G-buffer

移行時に確認すること：従来のマテリアルの値をPBRの意味へ置き換える方法

**分野：画面効果**

3.0で使う構成：shadow、SSAO、SSR、DoF、fog、bloomなど

移行時に確認すること：線形HDRのどの段階で効果を入れるか

**分野：物理**

3.0で使う構成：`PhysicsSpace`、`ScenePhysics`、`ComputePhysicsSpace`

移行時に確認すること：CPUからComputeへ移すbody数、同期方法、固定step

**分野：GPU計算**

3.0で使う構成：Compute pass、粒子、布、テクスチャ生成

移行時に確認すること：GPU状態の更新と描画の順序

**分野：音声**

3.0で使う構成：`GameAudioSynth`、`GameMusicPresets`、`AudioSynth`

移行時に確認すること：BGM、効果音、ユーザー操作による再生開始

最初に、既存アプリケーションを次の四つの経路のどれへ移すか決めます。

```text
既存アプリケーション
  ├─ WebgApp + Node + Shape
  │    ├─ 低水準構成を保ち、PBRだけを接続する
  │    └─ 必要に応じてSceneYAMLへ配置情報を移す
  ├─ SceneYAMLで作品全体を記述する
  │    └─ WebgSceneApp + SceneAsset + SceneDefinition
  ├─ GPU状態を先に更新する
  │    └─ Compute pass / compute-first
  └─ CPU物理を使う
       ├─ PhysicsSpaceを継続する
       └─ ScenePhysicsのCompute backendへ移す
```

## 2. アプリケーション入口を選ぶ

### 2.1 `WebgApp`を直接使う構成

`WebgApp`は、GPU、canvas、カメラ、入力、更新ループを明示的に制御するための基盤です。
既存コードが毎フレームの描画パスを細かく記録している場合や、独自のGPU bufferを多数管理している場合は、まずこの入口を保ったままPBRと深度規則を移します。

この構成では、アプリケーション側が次の処理を記述します。

1. `WebgApp.init()`でGPUとcanvasを準備する
2. `Space`、`Node`、`Shape`を作成して配置する
3. カメラフレームを更新する
4. 物理、Compute pass、描画passを同じcommand encoderへ記録する
5. resize時にresourceを更新し、終了時に`destroy()`を呼び出す

既存コードの動作を確認しながら個別の層を移せるため、描画パスを直接制御する作品に向いています。

### 2.2 `WebgSceneApp`へ移す構成

SceneYAMLで作品全体を保存し、PBRとCompute物理を標準の処理フローで使う場合は、`WebgSceneApp`を入口にします。
SceneYAMLの読み込み、参照検証、NodeとShapeの生成、PBRの準備、物理bodyの登録、固定step、GPU readback、Node同期、Resetを高水準runtimeがまとめます。

最小構成は次のようになります。

```js
import { createWebgSceneApp } from "../../webg/app/index.js";

const sceneApp = await createWebgSceneApp({
  project: "./scene.yaml",
  camera: {
    target: [0.0, 1.0, 0.0],
    distance: 10.0
  },
  physics: {
    enabled: true,
    paused: true
  },
  effects: {
    shadow: true,
    ssr: true
  }
});

sceneApp.start();
```

`WebgSceneApp.create(options)`は同じ初期化をクラス形式で行います。作品固有の入力やUIは、生成した`sceneApp`と作品側のJavaScriptへ記述します。
`start()`、`stop()`、`setPaused()`、`reset()`、`setTimeScale()`、`getDiagnostics()`、`destroy()`が、作品を操作・確認する基本APIです。

### 2.3 移行の判断

次の条件がそろうほど、`WebgSceneApp`へ移す効果が大きくなります。

- 物体、材質、物理条件をファイルとして編集したい
- SceneYAMLをブラウザー上の編集アプリや外部ツールで入出力したい
- PBRの環境光、画面効果、Compute物理を共通の初期化で使いたい
- 物理bodyの状態をNodeへ同期する処理を作品ごとに重複させたくない

独自のGPU処理を中心とする作品では、`WebgApp`を使い続け、SceneYAMLやPBRの部品だけを取り入れる構成も選べます。

## 3. SceneYAMLとModelYAMLへ配置を移す

### 3.1 シーン全体とモデル資産の分け方

3.0では、SceneYAMLとModelYAMLを同じYAML解析基盤で読み込み、読み込み後はそれぞれ`SceneAsset`と`ModelAsset`として扱います。
形式とruntimeの関係は次のようになります。

```text
SceneYAML  ──読み込み──> SceneAsset  ──構築──> SceneDefinition / Scene runtime
Scene JSON  ──読み込み──> SceneAsset  ──構築──> SceneDefinition / Scene runtime

ModelYAML  ──読み込み──> ModelAsset  ──構築──> Model runtime
Model JSON  ──読み込み──> ModelAsset  ──構築──> Model runtime
```

`SceneYAML`は作品全体を記述します。objects、objectSets、inline mesh、materials、physics、joints、animations、renderer、ModelAsset参照を一つの文書へまとめます。
`ModelYAML`は再利用する一つのモデルを記述します。複数のmesh、Node階層、material、skeleton、animationを一つのモデル資産として保持できます。

`SceneAsset`と`ModelAsset`は、読み込み後にアプリケーションが扱うデータ構造の名前です。共通の`DocumentAsset`がJSON/YAMLの解析、原文、コメント、source URL、保存を担当します。参照・値の検証と構築は、各Assetとそれぞれの検証・構築クラスが担当します。

### 3.2 SceneYAMLへ移す情報

シーン文書には、作品の初期状態と作品全体の設定を記述します。

```yaml
format: webg-scene
version: 1

materials:
  - id: ball-material
    color: [0.94, 0.30, 0.08, 1.0]
    metallic: 0.15
    roughness: 0.20
    specular: 1.0

objects:
  - id: ball
    shape: {type: sphere, radius: 0.5}
    transform: {position: [0.0, 3.2, 0.0]}
    material: ball-material
    physics:
      bodyType: dynamic
      mass: 1.0

physics:
  space:
    gravity: [0.0, -9.8, 0.0]
    planes:
      - normal: [0.0, 1.0, 0.0]
        planeDistance: 0.0

renderer:
  profile: studio
  environment:
    preset: dark-studio
    resolution: {width: 128, height: 64}
```

`objects[]`は作品内の配置物です。`objectSets[]`はprototypeとvariantから多数の配置を生成します。`materials[]`はPBR値や手続きテクスチャの指定を持ち、`physics`は物理空間とbodyの設定を持ちます。`renderer`はPBR profile、環境光、出力サイズ、画面効果を持ちます。

### 3.3 inline meshと物理形状

SceneYAML内へ直接meshを記述する場合は、`meshes`へ頂点と面を定義し、objectから`mesh`で参照します。

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
      - [ 0.5, -0.5, 0.0]
      - [ 0.5,  0.5, 0.0]
      - [-0.5,  0.5, 0.0]
    faces: [[0, 1, 2, 3]]

objects:
  - id: panel
    mesh: panel-mesh
    transform: {position: [0.0, 1.0, 0.0]}
    physics:
      bodyType: dynamic
      mass: 1.0
      shape: {type: box, size: [1.0, 1.0, 0.1]}
      colliderRelation: proxy
```

`mesh`は表示用geometry、`physics.shape`は物理solverが使う形状です。現在のSceneYAMLでは、物理形状をBox、Sphere、Capsuleとして明示します。表示用meshと衝突形状を個別に記述することで、表示の細かさと物理計算の単純さをそれぞれ調整できます。

### 3.4 ModelYAMLへ分ける情報

同じモデルを複数のSceneYAMLへ配置する場合は、mesh、Node階層、material、skeleton、animationをModelYAMLへ移します。SceneYAMLには、モデルの配置、作品側のobject ID、物理形状、作品固有の設定を記述します。

```yaml
modelAssetUrl: ./robot.yaml

objects:
  - id: robot-body
    node: body
    transform: {position: [0.0, 1.0, 0.0]}
    physics:
      bodyType: dynamic
      mass: 5.0
      shape: {type: box, size: [1.0, 2.0, 1.0]}
```

`body`はModelAsset内部のNode ID、`robot-body`はSceneYAML側のobject IDです。作品のphysics、joint、接触イベント、UIはSceneYAML側のobject IDを参照します。モデル内部の部品構成と作品全体の配置を分けることで、同じModelAssetを複数の作品へ配置できます。

### 3.5 YAMLコメントを制作情報として保持する

SceneYAMLとModelYAMLのコメントは、物理条件、座標系、材質の意図、編集上の注意を伝える制作情報です。`DocumentAsset`は解析済みの値に加えて、YAML原文、コメント情報、読み込み元URLを保持します。SceneAssetとModelAssetで同じDocumentAssetの仕組みを使うため、SceneYAMLとModelYAMLの保存規則がそろいます。

```js
import SceneAsset from "../../webg/SceneAsset.js";
import ModelAsset from "../../webg/ModelAsset.js";

const sceneAsset = await SceneAsset.load("./scene.yaml");
const modelAsset = await ModelAsset.load("./robot.yaml");

sceneAsset.assertValid();
modelAsset.assertValid();

const sceneSource = sceneAsset.getSourceDocument();
const modelSource = modelAsset.getSourceDocument();
console.log(sceneSource.comments.length, modelSource.comments.length);
```

値を変更していないAssetの`toYAMLText()`は、読み込んだ原文を返します。コメント付きYAMLの値を直接変更して保存すると、コメントと値の対応を安全に保つため例外を返します。編集アプリでは更新済みのYAML原文を`fromYAML()`へ渡して保存します。JSON出力はコメントを対象外とするため、`allowCommentLoss: true`を指定して変換の意図を明示します。

## 4. PBRへマテリアルを移す

### 4.1 マテリアル値をPBRへ置き換える

1.0・2.0のPhong系マテリアルで使っていた`ambient`、`specular`、`power`は、3.0ではbase color、metallic、roughness、specular、occlusion、emissiveへ分けて入力します。
値を一括変換せず、対象物が金属か非金属か、表面が滑らかか粗いか、光を発するかを決めて値を設定します。

```js
const gold = {
  color: [1.0, 0.766, 0.336, 1.0],
  alpha: 1.0,
  metallic: 1.0,
  roughness: 0.24,
  specular: 1.0,
  occlusion: 1.0,
  emissive_factor: [0.0, 0.0, 0.0],
  transmission: 0.0
};
```

金属ではbase colorが鏡面反射の色に反映されます。非金属ではbase colorが拡散成分の中心になり、`specular`が境界付近の鏡面反射量を調整します。`roughness`はハイライトの広がりと鏡面IBLのprefilter mipを決めます。`emissive_factor`は照明計算から分けた線形HDRの発光量です。

### 4.2 G-bufferと前方描画の処理フロー

不透明物はG-bufferへ表面情報を書き、後段の遅延照明で直接光、拡散IBL、鏡面IBL、emissiveを計算します。半透明物は透明PBRの前方描画で照明し、必要に応じてTransmissionで背景の屈折と吸収を表します。

```text
不透明Shape
  -> PBR G-buffer
  -> DeferredLightingPass
       -> 直接光 + 拡散IBL + 鏡面IBL + emissive
  -> SSRで画面内の鏡面反射を合成

半透明Shape
  -> PBR透明照明
  -> Transmissionによる屈折・吸収
  -> 不透明HDRシーンへ合成

線形HDR
  -> fog / DoF / bloom / toonなど
  -> tone mapping / edge / vignette
  -> canvas
```

2.0から遅延描画を使っている場合はG-bufferの処理構造を保ち、保存する表面値と照明モデルをPBRへ移します。標準フォワード描画からPBRへ移る場合は、`Shape`のマテリアルにPBR値をそろえ、`PbrRenderer`または`ComputeEffectPipeline`の照明経路へ接続します。

### 4.3 環境光、直接光、反射

PBRの環境光はHDR環境マップを入力に、拡散irradiance、粗さ別specular mip、BRDF LUTを組み合わせたIBLとして計算します。`renderer.environment`へpresetまたは環境設定を指定し、作品の大きさと表面の粗さに合わせて解像度を選びます。

直接光はdirectional light、point light、spot lightの種別を明示し、位置、方向、光量、色、減衰を設定します。PBRでは光源の色と強度がbase color、metallic、roughnessへ直接影響するため、旧ambient値で全体を明るくする構成から、環境光と直接光を分ける構成へ移します。

SSRは画面内に存在する鏡面反射を、鏡面IBLの一部と置き換えて表現します。反射が届かない領域は環境のspecular IBLへ接続します。床や金属面のroughnessを下げると反射の形が読み取りやすくなり、roughnessを上げると広いハイライトになります。

### 4.4 透明、Transmission、手続きテクスチャ

alphaを持つ物体は、透明描画の分類と順序が結果へ影響します。材質へalpha、transmission、厚み、吸収色を明示し、表示順を作品側の用途に合わせます。Transmissionを使うガラスや薄い樹脂では、反射、背景の屈折、吸収を同じPBR入力から調整します。

手続きテクスチャを使う場合は、`ProceduralTileSpec`、`ComputeProceduralTile`、`ProceduralMaterials`が作るColor map、Normal mapを材質へ接続します。実寸の繰返し間隔を指定する作品では、形状の寸法とUVの基準をそろえてから模様のスケールを調整します。

## 5. カメラ、深度、フレームをそろえる

### 5.1 Reverse-ZとShadowの深度規則

3.0の通常カメラは`CAMERA_REVERSE_Z`を使います。near側が1、far側が0で、clear値は0、比較関数は`greater`です。シャドウマップは`SHADOW_STANDARD_Z`を使い、near側が0、far側が1、clear値は1、比較関数は`less`です。

```js
import {
  CAMERA_REVERSE_Z,
  SHADOW_STANDARD_Z
} from "../../webg/DepthConvention.js";
```

通常カメラとshadow cameraの投影行列、depth clear、sampler比較関数を同じ値で扱うと、地面の欠落や影の反転が発生します。深度形式が同じ`depth32float`でも、二つの規則は別々に設定します。

### 5.2 カメラフレームとカメラ相対座標

カメラの位置や向きは、フレームの最初に一度更新し、同じ`cameraFrame`をG-buffer、透明、画面効果、UI用の描画へ渡します。各passが個別にカメラを更新すると、同じ画面内で投影結果がずれます。

大きなワールドや遠くの物体を描画する場合は、カメラ位置を原点とするカメラ相対座標へ変換します。CPU側のNode位置、GPUへ渡すobject buffer、shadow用のworld positionで基準をそろえ、物理計算が使うワールド座標とは境界を明確に分けます。

手動で複数passを接続する場合は、同一フレームの`renderFrameToken`を共有します。トークンが変わると、同じframeに対するresource更新を別frameとして扱うため、passの実行順とresourceの内容が一致しません。

### 5.3 EyeRigと画面サイズ

1.0・2.0からカメラを移すときは、EyeRigの位置、注視点、up方向、親Nodeの変換順を確認します。Orbit cameraでは、注視点からの距離、水平角、垂直角を同じ単位で設定します。

canvasの表示サイズとrender targetのサイズは、resize処理で同時に更新します。CSS上のサイズだけを変更すると、PBR、shadow、SSR、DoFの解像度と表示領域がずれます。

## 6. CPU物理からCompute物理へ移す

### 6.1 物理の選択

CPU物理の低水準入口は`PhysicsSpace`です。body数が少なく、CPU側で衝突結果を細かく制御する作品では、この構成を継続できます。

Compute物理の高水準入口は`ScenePhysics`です。3.0のSceneAppではCompute backendを標準経路として使い、`ScenePhysics`が`ComputePhysicsSpace`、body、Joint、readback、Node bindingをまとめます。CPU backendは比較と検証のために明示選択できます。

```js
import ScenePhysics from "../../webg/app/ScenePhysics.js";

const scenePhysics = new ScenePhysics({
  gpu,
  backend: "compute",
  gravity: [0.0, -9.8, 0.0]
});
```

既存のbody定義を移すときは、bodyType、mass、inertia、friction、restitution、linear damping、angular damping、sleep設定、collider形状を確認します。Box、Sphere、Capsule、Planeの形状を使い、表示meshの頂点数から物理形状を推定する処理は追加しません。

### 6.2 固定stepとGPU readback

Compute物理はGPU上の`BodyState`を更新します。`encode(commandEncoder, elapsedMs)`は経過時間を固定stepへ分割し、`encodeFixedStep(commandEncoder)`は一回の固定stepを記録します。描画と物理を同じcommand encoderへ記録する場合は、物理のencode、readback、描画の順序を明示します。

通常のNodeへ状態を反映する構成では、次の処理フローを使います。

```text
ComputePhysicsSpace.encode()
  -> GPU BodyStateを更新
  -> state readbackを記録
  -> submit
  -> readback完了
  -> syncNodeFromPhysics() / syncNodesFromPhysics()
  -> Nodeを描画
```

多数のbodyでCPU転送を減らす場合は、`getStateBuffers()`と`getRenderState().bufferIndex`を使い、描画shaderがGPU状態を直接参照する構成へ進みます。この方法では、bodyのbuffer配置とWGSLの読み出し位置を一致させ、readbackを使うNode同期との違いを作品側で管理します。

### 6.3 物理とSceneYAMLの対応

SceneYAMLでは、`physics.space`に重力、fixed step、solver容量、Planeを記述し、各objectの`physics`にbodyType、質量、材質、colliderを記述します。`joints`はobject ID同士を接続する作品側の拘束です。

物理bodyの初期位置と表示Nodeの初期位置、colliderの寸法をそろえます。床をPlaneにするかBoxにするかで接触する形状ペアと安定性が変わるため、受入試験では同じ設定を固定して比較します。

## 7. Compute-firstの処理へ移す

### 7.1 GPU状態を先に更新するアプリケーション

粒子、布、GPU物理、手続きテクスチャのように、GPU状態の更新結果を同じframeで描画する場合は、compute-firstの処理フローを使います。

```text
入力と時間を更新
  -> Compute passを記録
  -> 更新済みGPU bufferを描画passへ渡す
  -> 画面効果を記録
  -> submit / present
```

`ComputePass`の呼出側がcommand encoderの作成、passの順序、submitを管理します。同じframeで読み書きするresourceの順序を一つの処理フローへ集約します。

### 7.2 GPU計算とSceneAppを組み合わせる

`WebgSceneApp`の`onUpdate`は作品の状態更新に使います。独自Compute passのエンコーダーと描画順を直接制御する場合は、`WebgApp`の`computeFrame: true`と`onComputeFrame`を使い、必要なシーン資産と描画処理を接続します。使用するbuffer、bind group layout、リソースの寿命を各passで確認します。

粒子の数、storage bufferのサイズ、workgroup数、readbackの頻度を固定値として設計します。入力値を自動補正して処理を続けるより、仕様外の値は検証エラーとして表示する方が、GPU計算の不整合を早期に見つけられます。

## 8. 音声を3.0の構成へ移す

音声を使う作品では、`GameAudioSynth`がBGMと効果音の再生をまとめ、`GameMusicPresets`が音楽的なプリセットを提供します。BGMは8小節、64個の8分音符を基本に、曲調とBPMをプリセットで選べます。効果音は衝突、発射、決定などの用途別プリセットを使います。

ブラウザーの自動再生制限に対応するため、最初のユーザー操作で`resume()`を呼びます。master volumeはアプリケーション全体の音量、BGMとSEは個別の音量として分けて設定します。音声の詳細なプリセット設計は`16_サウンドの設計.md`を参照します。

## 9. resourceの寿命を整理する

3.0では、初期化時に作成するresourceと、画面サイズやscene変更で作り直すresourceを分けます。

**resource：GPU device、queue**

作成時期：アプリ初期化

更新・解放：アプリ終了時にWebgAppを破棄

**resource：SceneAsset、ModelAsset**

作成時期：文書読込時

更新・解放：原文を保持。構築済みランタイムの終了時に、そのランタイムの`destroy()`を呼ぶ

**resource：Shape、Node、material**

作成時期：scene構築時

更新・解放：scene終了時にSpaceから破棄

**resource：PBR環境、IBL、BRDF LUT**

作成時期：PBR初期化時

更新・解放：環境変更時に更新、終了時に解放

**resource：shadow、SSR、DoFのtarget**

作成時期：renderer初期化・resize時

更新・解放：サイズ変更時に再生成

**resource：Compute physics buffer**

作成時期：physics初期化時

更新・解放：body容量変更時に再生成、終了時に解放

**resource：audio context、buffer**

作成時期：音声初回使用時

更新・解放：アプリ終了時に停止・解放

SceneAssetの文書データとruntime resourceを同じ変数だけで管理せず、保存したい原文とGPU上の実体を分けて扱います。ModelAssetを複数配置する場合は、ModelAssetのGPU geometryを一度buildし、配置ごとのNode姿勢を個別に管理します。

## 10. 移行手順

### 手順1：アプリの範囲を記録する

入口、シーン生成方法、マテリアル、カメラ、画面効果、物理、Compute pass、音声、resize、destroyを一覧にします。各項目を「継続」「SceneYAMLへ移す」「PBRへ移す」「Computeへ移す」に分類します。

### 手順2：表示だけを3.0で再現する

まず物理と画面効果を停止し、カメラ、ライト、Shape、Node、材質だけを表示します。形状の位置、向き、寸法、face winding、normal、UV、透明分類を確認します。表示がそろった後にPBRのroughness、metallic、environmentを調整します。

### 手順3：SceneYAMLまたはModelYAMLへ保存する

作品全体の配置と設定はSceneYAMLへ、複数作品で再利用するモデル内部の構造はModelYAMLへ移します。読み込み直後に`assertValid()`を呼び、参照先、mesh、material、physics、animationのエラーを初期化時に検出します。

### 手順4：深度とPBRの処理フローを確認する

通常カメラがReverse-Z、shadowがStandard-Zになっていることを確認します。HDRの中間値、IBL、直接光、SSR、透明、tone mappingの順を確認し、canvasへ出す最終色だけをsRGBへ変換します。

### 手順5：物理を接続する

まずbodyを一つだけ追加し、固定step、gravity、collider寸法、mass、friction、restitutionを確認します。次にbody数を増やし、sleep、wake、接触イベント、readback、Node同期を確認します。CPUとComputeを比較する場合は同じ初期条件と固定stepを使います。

### 手順6：Compute passと音声を追加する

物理と表示が安定した後に粒子、布、テクスチャ生成などのCompute passを追加します。最後に音声の`resume()`、master volume、BGM、SEを追加し、ユーザー操作から再生が始まることを確認します。

## 11. 確認方法

移行の確認は、データ、runtime、実機表示の三段階で行います。

### 11.1 データの確認

- SceneYAML、ModelYAMLの構文を解析できる
- `SceneAsset.load()`、`ModelAsset.load()`が正しいAssetを返す
- `getSourceDocument()`から原文、コメント、source URLを取得できる
- `assertValid()`が不正な参照や数値を明示する
- コメント付きYAMLを未変更のまま`toYAMLText()`へ渡すと原文が保たれる
- コメント付きYAMLをJSONへ変換するときに`allowCommentLoss: true`を明示する

`samples/edit_yaml/check_document.mjs`はSceneYAML編集用の文書検査、`unittest/scene_mesh/check.mjs`はinline meshとScene構築の検査に使えます。

### 11.2 runtimeの確認

- Node、Shape、ModelAssetの参照先が期待した数になる
- PBR材質のmetallic、roughness、emissiveが対象物ごとに反映される
- physics bodyの種別、質量、collider、fixed stepが設定どおりになる
- Compute readback後にNode姿勢がGPU状態へ一致する
- `reset()`でscene初期値とphysics初期値を復元する
- `resize()`後もcanvas、shadow、SSR、DoFのtargetサイズがそろう
- 各機能の終了処理でrenderer、physics、sceneを解放し、音声を停止する

### 11.3 ブラウザーと実GPUの確認

最後に、実際のWebGPU環境で画面と操作を確認します。

1. canvasがウィンドウサイズに追従する
2. 通常カメラの深度がReverse-Zで安定する
3. shadowの比較方向がStandard-Zで正しい
4. HDRのハイライト、金属反射、roughnessの変化が見える
5. 透明とTransmissionの背景合成が安定する
6. Compute物理の接触、sleep、wake、readbackが表示と一致する
7. Compute粒子や布が同じframeの描画へ反映される
8. ユーザー操作から音声が再生される

`headless_tests/`のAPIとデータ構造の検査は、parser、Asset、SceneDefinition、PBR、physics、sampleの構造確認に使えます。実GPUの描画、音声、入力、WebGPU resourceの実行順は、対応するsampleをブラウザーで確認します。

## 12. 移行先を決めるための早見表

**目的：SceneYAMLで作品全体を定義する**

最初に読む文書・sample：`09_シーン構成とSceneJSON.md`、`samples/project_app/index.html`

**目的：SceneAssetとModelAssetを入出力する**

最初に読む文書・sample：`08_モデルアセットとランタイム.md`、`09_シーン構成とSceneJSON.md`、`samples/scene_model_yaml/index.html`

**目的：SceneYAML内でmeshを編集する**

最初に読む文書・sample：`samples/edit_yaml/index.html`

**目的：ModelYAMLを再利用する**

最初に読む文書・sample：`samples/model_yaml/index.html`

**目的：PBR、IBL、SSR、透明を調整する**

最初に読む文書・sample：`32_PBR統合の基本実装.md`、`33_PBR統合の運用と診断.md`、`samples/materials/index.html`、`samples/transmission/index.html`

**目的：手続きテクスチャを使う**

最初に読む文書・sample：`samples/procedural_texture/index.html`

**目的：CPU物理からCompute物理へ移す**

最初に読む文書・sample：`42_物理エンジンの詳細設計.md`、`samples/compute_physics/index.html`

**目的：Compute物理の表示同期を確認する**

最初に読む文書・sample：`samples/falling_box/index.html`、`samples/falling_dominoes/index.html`

**目的：Compute粒子や布を追加する**

最初に読む文書・sample：`samples/compute_particles/index.html`、`samples/compute_cloth/index.html`

**目的：Computeでテクスチャを生成する**

最初に読む文書・sample：`samples/compute_texture/index.html`

**目的：BGMと効果音を移す**

最初に読む文書・sample：`16_サウンドの設計.md`、`samples/sound/index.html`

3.0への移行では、入口、データ文書、描画、物理、Compute、音声を同時に変更する必要はありません。最初に表示をそろえ、次にSceneYAMLとModelYAMLでデータを分け、PBR、物理、Compute、音声を一つずつ加える順序にすると、各段階の結果を観測しやすくなります。
