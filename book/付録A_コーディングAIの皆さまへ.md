# コーディングAIの皆さまへ

初回のアプリ開発では、まず[開発の入口と実行例](開発の入口と実行例.md)で目的に合う出発点を一つ選んでください。人間向けの案内と同じ実行例、コード、確認ポイントを使います。この付録は、その後にAPIや内部接続を調べる際の参照先を説明します。

## コアの読み込み方式を揃える

最初に、アプリが`webg/`の個別モジュール版と`lib/webg.core.min.js`の
どちらを使うか確認してください。統合版では`WebgApp`、`Shape`などを
名前付きimportで取り出します。APIの意味は本書と元ソースで確認できます。
サンプルの移植では、共有JS・再export・動的importまで同じ方式へ揃えます。
変換コマンドと確認順序は`付録C_統合版の利用.md`にまとめています。

## `webg`利用者を支援するためのガイドライン

この付録は、`webg`を用いて3Dアプリケーションを開発する利用者を、コーディングAIが支援する場面を想定して作成されました。
ここで想定するAIは、一般的な3Dエンジンや外部ライブラリの知識をそのまま適用するのではなく、`webg`という自己完結したライブラリの設計思想に基づき、何をどの順番で参照すべきかを判断する支援者です。

`webg`を利用するアプリケーションでは、まず`WebgApp`が初期化、更新ループ、カメラ、入力、UI、描画タイミングを統合します。
3D形状は`Space`、`Node`、`Shape`、`ModelAsset`によって構成され、この部分は標準Forward描画でも、物理ベースレンダリング（Physically-Based Rendering：PBR）を行う統合レンダリングでも共通です。

webg 3.0では、金属度・粗さ方式のPBR、画像ベース照明（Image-Based Lighting：IBL）、PBR G-buffer、透明PBR、画面空間Transmission、汎用の手続きテクスチャが、主要な表現基盤として加わりました。PBRは`metallic`と`roughness`をマテリアルへ追加し、マテリアル、直接光源、高輝度範囲（High Dynamic Range：HDR）の環境、事前積分済みIBL、カメラ、シャドウ、画面空間効果、トーンマッピングを線形HDRの処理フローへ接続する仕組みです。

大きな選択は形状の作り方ではなく、照明と画面効果をどの描画経路で処理するかにあります。
小さな構成で形状を直接描画する場合は、`SmoothShader`を使う標準Forward描画を選びます。
PBR G-buffer、IBL、複数光源、SSAO、SSR、透明・屈折、Fog、Bloomなどを一つのHDR画像へ統合する場合は、`ComputeEffectPipeline`を使うPBR統合レンダリングを選びます。
どちらも`WebgApp`のフレーム処理内で構成し、同じ`Space`、`Node`、`Shape`、カメラ、入力、UIを使います。

```text
WebgApp
  ├─ 初期化、更新ループ、カメラ、入力、UI
  ├─ Space、Node、Shape、ModelAsset
  └─ 照明・最終描画経路の選択
       ├─ 標準Forward描画
       │    └─ SmoothShaderで形状を直接描画
       └─ PBR統合レンダリング
            └─ PBR G-buffer + ComputeEffectPipeline
                 ├─ 直接光 + IBL + Shadow + SSAO
                 ├─ SSR + 透明PBR + Transmission
                 └─ Fog + Bloom + Tone Mappingなど
```

この図の上側は、アプリケーションの共通基盤です。
下側の分岐は、同じシーンと形状をどの照明経路で最終画面へ変換するかを示します。
PBR統合レンダリングでは、既存の`WebgApp`、`Space`、`Shape`をそのまま基盤として利用し、`ComputeEffectPipeline`を後段へ接続します。
単純な画面は、PBRとコンピュートシェーダーを利用できる環境でも、標準Forward描画を入口にすると構成を小さく保てます。

本書において重要なのは、`webg`が外部の3Dライブラリに依存せず、描画、シーン管理、モデル、アニメーション、UI、入力、物理、音声、診断、GPU計算を内部に持つことです。
AIが技術支援を行う際は、「一般的なWebGPU実装はこうであるはずだ」あるいは「Three.jsではこうだから同様だろう」といった推測よりも、本書、`samples`、`headless_tests`、`unittest`、`webg`本体の現行実装を優先してください。

一般論は概念を説明する補助として利用できますが、公開API、引数、形式、ライフサイクル、例外条件の最終判断は`webg`の資料と実装に置きます。
本付録の目的は、利用者が何を作りたいか、どの層で問題が起きているかに応じて、AIが参照する章、サンプル、自動テスト、ブラウザPOC、コア実装を選ぶための読書地図を提供することです。とくにPBRでは、完成画像だけからマテリアル値を推測せず、G-buffer、光源、IBL、透明合成、最終表示のどの段階まで正しいかを分けて調べます。

## SceneYAMLから作品を起動する

作品の配置、PBR、Compute物理をまとめて記述する場合は、`webg/app/index.js`の`createWebgSceneApp({ project: "./scene.yaml" })`を入口にします。`WebgSceneApp`は`WebgApp`を基盤として、`SceneDefinition`による検証、`PbrRenderer`、`ScenePhysics`、アニメーション、Node同期を接続します。独自の描画処理を組む場合は`WebgApp`を直接使います。

SceneYAMLは作品全体の配置、inline mesh、マテリアル、物理、renderer設定を記述し、ModelYAMLは再利用するモデルのmesh、Node階層、skeleton、animationを記述します。読み込み後はそれぞれ`SceneAsset`と`ModelAsset`として扱います。両クラスは`DocumentAsset`を継承し、`SceneYaml.js`の解析処理と原文・コメント保持を共有します。

YAMLを編集・保存する処理では`getSourceDocument()`で原文を扱います。値が未変更なら`toYAMLText()`は原文を返し、コメント付き文書の値だけを変更した場合は保存時に例外を返します。更新済みの原文は`fromYAML()`へ渡します。JSONへの変換は`allowCommentLoss: true`を指定します。

物理付きinline meshは、表示を`mesh`、衝突形状を`physics.shape`のBox・Sphere・Capsuleで記述します。08〜09章、`samples/model_yaml`、`samples/scene_model_yaml`、`samples/edit_yaml`を参照してください。

## PBRのマテリアルと光を合わせて確認する

PBRの名称からは、金属、樹脂、陶器、石、ガラスといった表面マテリアルのモデルが注目されがちです。しかし、同じマテリアルでも、光源の方向、距離、形、大きさ、環境内の高輝度領域、露出が変われば見え方は大きく変わります。AIは「金属が金色に見えない」という症状をbase colorだけの問題へ限定せず、金属度、粗さ、Fresnel反射、直接光、鏡面IBL、SSR、トーンマッピングを順に確認してください。

webgのPBRは、金属度・粗さ方式を使います。非金属のbase colorは主に拡散反射色、金属のbase colorは主に鏡面反射のF0へ使われます。`specular`は非金属の基準鏡面反射率、`roughness`は微細面法線の分布、`metallic`は非金属と金属の混合、`occlusion`は環境光の遮蔽を表します。発光は照明とは別の線形HDR色として扱います。

環境マップは背景画像であるだけでなく、全方向から届く光の入力です。`PbrEnvironment`は、元のradiance、拡散反射用のirradiance、roughness別に事前積分したprefiltered specular、BRDF LUTを、遅延照明、PBR向けSSR、透明PBRで共有できるGPUリソースにします。`environmentBackground: false`を選ぶとIBLだけを利用し、画面背景には`clearColor`を表示できます。環境光を有効にした状態では固定`ambient`を重ねないため、`ambient`は0にします。

PBRの計算は線形HDRで行い、表示直前に一度だけトーンマッピングとsRGB変換を行います。base colorやclear colorは表示用sRGB、照明後の値は線形HDRとして役割を分けます。Bloom、Fog、SSR、Transmissionはトーンマッピング前、EdgeとVignetteは表示色へ変換した後に置きます。

光量設定では、相対値を使う`unitSystem: "relative"`と、測光単位を使う`unitSystem: "photometric"`のどちらかに単位系をそろえます。相対値ではシーン内の見た目を基準に強度を調整し、測光単位では点光源の光度、露出、EV100を同じ単位系で扱います。シーンが暗い場合は、直接光、IBL、露出の順に確認します。

glTF 2.0 coreのPBR入力は、`GltfShape`が`baseColorFactor`、`metallicFactor`、`roughnessFactor`、Normal、Occlusion、Emissiveの各テクスチャ、`emissiveFactor`、`alphaMode`へ変換します。一方、`KHR_materials_transmission`、`KHR_materials_ior`、`KHR_materials_volume`を画面空間Transmissionへ接続する場合は、webg独自の透明・屈折設定へ専用の入力処理を加えます。glTF coreの読み込み対応とwebg独自機能の対応範囲を分けて判断します。

## `WebgApp`を中心に考える

### アプリケーションの共通基盤

`WebgApp`はCanvasの初期化に加えて、Screen、GPUコンテキスト、シーン、標準シェーダー、カメラ、入力、Message、HUD、Overlay Panel、DebugDock、フレーム処理を一つのアプリケーション構造へまとめます。

利用者が標準Forward描画を使う場合も、PBR統合レンダリングを使う場合も、次の処理は共通です。

- `await app.init()`でGPUとアプリケーション機能を初期化する
- `Space`と`Node`でシーン階層と配置を管理する
- `Shape`、`Primitive`、`ModelAsset`で3D形状を用意する
- `EyeRig`または標準カメラで視点を管理する
- `onUpdate`でアプリケーション状態を更新する
- `InputController`でキーボード、ポインター、タッチを扱う
- HUD、Overlay Panel、CommandPaletteで情報と操作を提示する

描画経路が変わっても、モデルの読み込み、Nodeの移動、アニメーションの更新、カメラの操作、UIの構築は既存の体系を継続して利用できます。
AIは、照明方式を変更するときも、アプリケーションの共通基盤を保ったまま描画経路だけを切り替える提案を行います。

### 3D形状と配置は共通である

`Space`はシーンのNode階層を管理し、`Shape`は頂点、法線、UV、複数のmaterial slot、三角形ごとのmaterial番号などを保持します。
`ModelAsset`から展開されたモデルも、最終的にはNodeとShapeとしてシーンへ配置されます。

標準Forward描画では、これらのShapeを`SmoothShader`が直接描画します。
PBR統合レンダリングでは、同じSpaceとShapeを`GeometryBufferPass`がPBR G-bufferへ描画し、後段で照明を計算します。
内部で使うシェーダーと出力先が変わっても、同じモデルを`Node`と`Shape`として各描画経路へ渡せます。

PBR統合レンダリングではG-bufferへ渡す表面のマテリアル情報をそろえます。
base color、`specular`、`roughness`、`metallic`、`occlusion`、発光を表す値を用途に応じて指定し、欠落値はプロパティ名付きの例外として確認できる状態にします。発光は`emissive_factor`と任意の`emissive_texture`、または従来のscalar `emissive`のどちらか一つの入口へそろえます。

## 照明と最終描画経路を選ぶ

### 標準Forward描画

標準Forward描画では、形状を描くときに`SmoothShader`が照明を評価し、その結果をCanvasへ出力します。
構成が小さく、3Dシーンを短い経路で描画できることが利点です。

次の場合は、標準Forward描画を最初に検討します。

- 単純な3D形状やモデルを表示する
- 少数のライトで十分である
- G-buffer不要の画面効果は標準Forward経路で構成する
- 描画構成とリソース数を小さく保ちたい
- `SmoothShader`のマテリアル設定で必要な見た目を作れる

この経路では`WebgApp`の通常のフレーム処理を利用します。
標準Forward描画では`WebgApp`がカメラ状態とコマンドエンコーダーを管理し、PBR統合描画では`ComputeEffectPipeline`が各段階を接続します。
`Space.draw(eye)`による単純な描画は標準Forward経路として保ち、PBR統合用のG-bufferやフレーム状態は`ComputeEffectPipeline`の経路へまとめます。

### PBR統合レンダリング

PBR統合レンダリングでは、最初に不透明Shapeの表面情報をPBR G-bufferへ保存し、そのテクスチャを使って直接光、IBL、画面効果を計算します。
`ComputeEffectPipeline`は、G-buffer、Shadow、SSAO、PBR遅延照明、SSR、透明PBRとTransmission、Fog、Toon、DoF、Bloom、Tone Mapping、Edge、Vignetteを一つの順序へ接続します。

透明分類はmaterialの`alpha_mode`を優先し、`OPAQUE`、`MASK`、`BLEND`を区別します。
`alpha_mode`を省略したマテリアルでは、独立した`alpha`が1.0未満なら`BLEND`として扱います。
`color[3]`はテクスチャ混合率として読み、透明度は`alpha`で指定します。
一つのShapeに不透明と半透明の三角形が混在しても、全Shape横断で透明三角形を奥から手前へ並べます。
Pipeline利用側へ透明用Render Passを追加する提案はせず、`roughness`による背景ぼけ、透明表面のGGX反射、Transmissionによる屈折と吸収を内部の`TransparencyPass`へ任せます。

次の場合は、PBR統合レンダリングを検討します。

- G-bufferを共有する複数の効果を使う
- 金属度・粗さ方式のPBRとIBLを統合する
- SSAOで接地感を加えたい
- SSRで画面空間反射を加えたい
- 透明表面を不透明物と同じGGXで照明し、屈折と体積吸収を加えたい
- 多数または種類の異なるライトを後段で評価したい
- HDR区間で照明、反射、Bloom、DoFを接続したい
- 中間テクスチャの形式と処理順序を統合APIへ任せたい

PBR統合レンダリングも`WebgApp`の中で動作します。
`onBeforeDraw`で`pipeline.renderScene()`を呼び、`onAfterDraw3d`で`pipeline.encode()`と最終表示を行います。
両方には同じ`cameraFrame`を渡します。

```text
WebgAppの状態更新
  -> onBeforeDraw
       -> Shadow MapとG-bufferを描画
  -> onAfterDraw3d
       -> 照明と画面効果を記録
       -> 完成したテクスチャをCanvasへ表示
       -> HUD用の深度付きパスへ戻る
```

`ComputeEffectPipeline`はPBR統合レンダリングの入口です。アプリケーションの入口で、標準Forward描画を使うか、PBR統合レンダリングを使うかを明示的に選びます。

### PBR統合の処理順を維持する

PBR統合レンダリングでは、各効果を単に有効にするだけでなく、入力の意味を保つ順序が重要です。

```text
Shadow Map
  -> PBR G-buffer
  -> PBR遅延照明（直接光 + IBL、線形HDR）
  -> SSRで鏡面IBLを画面内反射へ置換
  -> 透明PBR + Transmission
  -> Fog -> Toon -> DoF -> Bloom
  -> Tone Mapping + sRGB変換
  -> Edge -> Vignette
  -> Canvas表示 -> HUD
```

SSRは`composer.mode: "pbr-ssr"`で、画面内の交差を確認できた範囲だけ鏡面IBLをSSRへ置き換え、交差がない範囲には元のIBLを残します。透明物は不透明G-bufferと分けて前方描画へ送り、`PbrForwardShader`が不透明物と同じ`PbrBrdf.js`を使い、直接光、Shadow、IBLを同じGGXモデルで評価します。

Transmissionはentry面で空気から媒質へ屈折し、透明物内のexit面を探索し、媒質から空気へ再屈折して背景を探します。内部光路長にはBeer–Lambert吸収を適用します。背景交点へ到達できないレイには、`transmissionRayMissFallback`で`"auto"`、`"environment"`、`"clear"`、`"constant"`を選びます。これは隠れた形状を推測するフォールバックではなく、観測できない背景を何で表すかを明示する設定です。

`"environment"`は環境radianceを必須とし、不足時は設定エラーとして知らせます。`"constant"`は表示用sRGBの`transmissionRayMissColor`を必須とします。内部境界が見つからず外向き方向を決められない場合は、environment方向を推測せず、constant以外のmodeではclear colorを使います。

### GPU状態を先に更新する処理は別の応用である

GPU粒子、布、物理、手続きテクスチャのように、画面を描く前にGPU上の状態を更新する処理は、照明経路の分岐とは別の応用です。
この場合も`WebgApp`を利用できますが、`computeFrame: true`と`onComputeFrame`を使います。

```text
WebgApp computeFrame
  -> 状態を更新するコンピュートパス
  -> 最新状態を読むレンダーパス
  -> コマンドバッファを送信
```

この処理は、大量の状態をGPU上で更新し、その結果をCPUへ戻さず描画へ渡すために使います。
遅延照明を使うかどうかとは別に、照明経路とGPUシミュレーションの経路をそれぞれ選びます。

## 自己完結した設計思想の理解

`webg`は、描画、シーン、モデル、アニメーション、UI、入力、診断、GPU計算を一つの設計規則で接続する自己完結したライブラリです。

カメラは`cameraRig` $\rightarrow$ `cameraRod` $\rightarrow$ `eye`、シーンと形状は`Space` $\rightarrow$ `Node` $\rightarrow$ `Shape`で構成します。
`ModelAsset` $\rightarrow$ `build()` $\rightarrow$ `instantiate()`は共通リソースと個別インスタンスを分け、`clip` $\rightarrow$ `pattern` $\rightarrow$ `action` $\rightarrow$ `state`はアニメーションを段階化します。

AIは、最初に`webg`独自の定義と各機能が担当する処理を確認し、その後で一般的な3DやWebGPUの概念と対応付けてください。
一般論を先に当てはめると、深度規則、色空間、カメラ状態、GPUリソースを管理する箇所を取り違えることがあります。

## 手続きテクスチャをPBR入力として扱う

webgの手続きテクスチャは、`ProceduralTileSpec`でタイル寸法、模様、目地、表面appearanceを定義し、`ComputeProceduralTile`でColor、Height、NormalをGPU生成する仕組みです。`ProceduralMaterials`がpresetの選択、生成結果の保持、PBRマテリアル設定、Shapeへの適用、破棄をまとめます。

```text
ProceduralTileSpec
  -> ComputeProceduralTile
       -> Color texture
       -> Height texture
       -> Normal texture
  -> ProceduralMaterial
       -> Shapeの実寸UVとPBRマテリアルへ適用
```

直方体へ実寸のタイル、石、木、ビニールを適用する場合は、`Primitive.mapRealCuboid()`で各面へメートル単位のUVを作ります。`Primitive.mapCube()`は画像atlas用として使い分けます。`createPreset()`の`scale`は「テクスチャの大きさ」の倍率で、`scale: 10`は模様を10倍の大きさで表示し、面上の反復回数を10分の1にします。

`ProceduralMaterial.applyTo(shape)`は、形状を`applyPrimitiveAsset()`で取り込んだ後、`endShape()`でGPU転送を確定する前に呼びます。先にUVの意味を確認し、倍率は実寸UVまたは生成definitionの段階で調整します。CPU版は正しさを判定する基準、Compute版は通常利用のGPU生成、比較とreadbackは検証時だけ使う処理として分けます。

## 遵守すべきテクニカル・ルール

### 用語をCGの一般的な表記へ揃える

CGにおけるmaterialは「マテリアル」と表記します。`Shape`の設定、PBRの表面特性、G-bufferの入力、glTFのmaterial、material slotは、それぞれ「マテリアル」「マテリアル値」「マテリアルスロット」と説明してください。「材質」は、現実の壁や床を構成する素材など、CGのmaterialとは異なる意味を明示する場合だけ使います。

### 1. 初期化とライフサイクル

- GPUリソースは`await screen.ready`または`await app.init()`の完了後に生成します。
- `app.space`、`app.eye`、`app.getGPU()`は`await app.init()`完了後に使用します。
- 毎フレームのアプリケーション状態更新は`app.start({ onUpdate: ... })`へ置きます。
- `computeFrame: true`を使う場合は`onComputeFrame`を必ず登録します。
- `onComputeFrame`は`computeFrame: true`と組み合わせて登録します。

### 2. 形状とリソースの確定

- `Shape`へ頂点データを追加した後は、必ず`shape.endShape()`を呼びます。
- `Primitive.cube()`、`Primitive.mapCube()`、`Primitive.mapRealCuboid()`はUVの意味が異なります。用途を確認し、対応する関数を選びます。
- 手続きマテリアルを実寸で使う直方体には、各面へメートル単位のUVを作る`Primitive.mapRealCuboid()`を使います。
- `ProceduralMaterial.applyTo(shape)`は、`applyPrimitiveAsset()`の後、`endShape()`の前に呼びます。
- `ProceduralMaterials.createPreset()`の`scale`はUVへ掛ける反復倍率ではなく、テクスチャ一周期を何倍の大きさで表示するかを表します。
- ModelAssetは`build()`で実行時リソースを作り、必要な数だけ`instantiate()`します。
- 同じShapeを複数配置するときは、頂点を複製せずNodeのtransformを使います。
- リソースの生成、サイズ変更、更新、破棄をどこで行うか一つに決めます。
- Pipelineが内部で生成・管理するリソースは、Pipelineの所有物として扱います。

### 3. 座標系と回転

- 右手座標系で`+X=右`、`+Y=上`です。
- ワールド`+Z`と標準カメラのローカル前方`-Z`を区別します。
- モデル前方はアセットまたはアプリケーションの規約を確認します。
- 回転は`yaw / pitch / roll`と`CoordinateSystem`の定義に従います。
- 大きなワールド座標をGPUのfloat32行列で相殺せず、カメラ相対のモデルビュー変換を使います。

### 4. 深度とカメラフレーム

- 通常カメラは`CAMERA_REVERSE_Z`、`depth32float`、クリア値0、比較関数`greater`です。
- Shadow Mapは`SHADOW_STANDARD_Z`、クリア値1、比較関数`less`です。
- 通常カメラの深度とShadow Mapの深度は、Reverse-Z／Standard-Zの規約を含めて別の値として扱います。
- `CameraFrame`は、一回の描画で共有するカメラ状態を確定した値です。標準の単一パスは`WebgApp`のカメラ状態を使い、G-bufferや深度依存の後段処理で`CameraFrame`や`renderFrameToken`を共有します。
- 同じ深度を読む後段パスだけが、同じ`CameraFrame`またはトークンを共有します。
- `ComputeEffectPipeline.renderScene()`と`encode()`へ同じ`CameraFrame`を渡します。
- `renderScene()`と`encode()`でShadowの有効状態と種類を一致させます。
- 透明分類はmaterialの`alpha_mode`を優先し、省略時は`alpha`と三角形のmaterial slot番号から自動分類します。
- `TransparencyPass`はSSR後、Fog / Toon / DoF / Bloom前のHDR sceneへ透明面を合成します。
- near、far、FOV、カメラのワールド行列は`WebgApp`または共有`CameraFrame`から受け取ります。

### 5. PBRの色と光

- base color、画像テクスチャ、clear color、`transmissionRayMissColor`が表示用sRGBか、照明計算用の線形値かを確認します。
- PBR照明、SSR、透明合成、Fog、DoF、Bloomは`rgba16float`の線形HDR区間で処理します。
- Tone MappingとsRGB変換は最終表示の前に一度だけ行います。
- 金属ではbase colorが鏡面反射色へ影響します。金属が灰色に見える場合にbase colorだけでなく、`metallic`、IBL、直接光、露出を確認します。
- `lighting.environment`を使う場合は`ambient: 0.0`とし、環境光の入力を一つへそろえます。
- `environmentRotationDegrees`はradiance、irradiance、prefiltered specularへ同じ回転を適用します。
- `environmentBackground: false`は環境による照明を維持し、画面背景だけをclear colorにする指定です。
- `composer.mode: "pbr-ssr"`ではSSRを鏡面IBLへ加算せず、交差を確認できた範囲だけ置き換えます。
- 発光は照明を受けたbase colorではなく、独立した線形HDR色として扱います。

### 6. 最終表示の順序

標準の単一パスでは`clear` $\rightarrow$ `draw` $\rightarrow$ `present`を使います。
完成したテクスチャをCanvasへ表示する統合経路では、次の順序を使います。

```text
beginPresentPass()
  -> FullscreenPass.draw()
  -> clearDepthBuffer()
  -> Canvas上のHUDまたは後続描画
```

`clearDepthBuffer()`は完成したテクスチャを表示した後、HUDが使う深度付きCanvasパスを再開する処理です。

### 7. 再現可能な乱数を用途で分ける

順番に値を生成するparticle、音声ノイズ、確率判定には`util.MersenneTwister`を使います。このclassは2002年版 mt19937ar.c と同じ32bit出力を生成します。座標、部材ID、格子点、任意indexから呼び出し順に依存しない値を求める場合は、lowbias32 に基づく`util.hashUint32()`を使います。

複数の整数は`util.hashUint32Sequence()`で順序付きに結合します。hash値をJavaScriptとWGSLで共通の`[0, 1)`へ変換する場合は、上位24bitを使う`util.uint32ToUnitFloat()`と同じ規則に揃えます。WGSLではJavaScript関数を直接呼べないため、同じ定数とshiftの32bit版を実装し、既知出力testで一致を確認します。

MT19937は処理の用途ごとに独立streamへ分けます。基準seedから用途識別値をhashし、たとえばリバーブ生成量の変更がBGMの休符や転調を変えないようにします。コアの再現可能な乱数には`util.MersenneTwister`と`util.hashUint32()`を使い、秘密値、token、予測不能性が必要な識別子には暗号学的乱数を使います。

- Mersenne Twister: https://www.math.sci.hiroshima-u.ac.jp/m-mat/MT/MT2002/mt19937ar.html
- lowbias32: https://nullprogram.com/blog/2018/07/31/

## 目的別の参照先

AIは利用者がどの層の話をしているかを判定し、目的に対応する章、サンプル、自動テストを選択してください。
以下でディレクトリ名だけを記したものは、`samples/`以下のサンプルです。

- **最初の3Dオブジェクト**: 04〜05章、`low_level`、`high_level`
- **WebgAppによるアプリケーション基盤**: 05〜06章、`high_level`
- **Orbit、Follow、First-personカメラ**:
  05〜06章、`high_level`、`eye_rig`
- **形状とマテリアル**: 07章、19章、37〜39章、`shapes`、`materials`
- **標準Forward描画の照明**:
  07章、39章、`SmoothShader`、`shapes`、`materials`
- **PBR、手続きマテリアル、複数の画面効果**:
  III部とIV部、`examples/33_01.html`、`pbr_reference`、`transmission`、`procedural_texture`、`texture_catalog`、`compute_json`
- **glTF、GLB、Colladaモデル**:
  08章、10〜11章、`gltf_loader`、`collada_loader`
- **SceneYAML・ModelYAMLと作品の起動**: 05章、08〜09章、`project_app`、`scene_model_yaml`、`model_yaml`、`edit_yaml`
- **アニメーションの状態遷移**:
  10〜11章、`animation_state`、`janken`
- **HUDやパネルなどのUI**:
  05章、12〜14章、`OverlayPanel`、`CommandPalette`を使うサンプル
- **入力、レイキャスト、衝突判定**:
  14〜15章、`unittest/raycast`、`headless_tests/core/physics_space`
- **物理ボディ、反発、摩擦**:
  27〜28章、`physics_bounce`、`headless_tests/core/physics_space`
- **Compute版物理エンジン**:
  GPU上のbody状態、固定刻み、ComputeCollider、通常のNodeへの同期、GPU状態を直接参照する描画を扱います。27〜28章とIII部、`samples/compute_physics`、`examples/27_02.html`、`examples/27_03.html`を参照してください
- **個別のコンピュート効果**: 20〜22章、34〜36章、31〜33章。画像Pyramid Bloom、
  DoF、Shadow visibility、SSAO、SSRの処理を個別の段階として確認します
- **GPU上で更新する粒子、布、物理、テクスチャ**:
  20〜22章。参照先は
  `compute_particles`、`compute_cloth`、`compute_physics_bounce`、
  `compute_texture`
- **低水準のコンピュート接続**:
  20〜22章、`examples/20_01.html`、`webg/ComputePass.js`
- **コンピュート処理の性能比較**:
  20〜22章、34〜36章、31〜33章、`compute_benchmark`

PBR統合の全体像を確認するときは、最初に30章でマテリアル、光源、IBL、事前積分の意味を確認し、31〜33章と`examples/33_01.html`で実際の接続順を確認します。手続きテクスチャの生成と実寸UVは29章、個別の画面効果と性能設定は34〜36章を参照してください。Transmissionの屈折、内部reflection、背景未到達時の選択は`samples/transmission`を参照します。

同じ題材名を持つサンプルは、描画方式または計算場所を比較する組として読み分けます。
`bloom`とCompute版、`dof`とCompute版、`physics_bounce`と`compute_physics_bounce`は、描画方式または計算場所を比較する別の例です。
公開Compute系sampleの目的と維持理由は`samples/README.md`で確認できます。

## APIが見つからない場合の調べ方

APIや利用方法が見つからない場合は、外部ライブラリのAPIを代用せず、次の順に探索してください。

1. `book/付録D_API一覧.md`でクラス名と機能名を探します。
2. 章本文で背景、役割、理由、処理順序、注意点を確認します。
3. `samples/<name>/README.md`でサンプルの目的を確認します。
4. `main.js`と補助`*.js`で実際の接続方法を確認します。
5. `headless_tests/core/<core_name>`で自動検証される仕様を確認します。
6. `unittest`で人が確認するブラウザPOCを探します。
7. 最後に`webg/*.js`で公開API、例外、リソースを管理する処理を確認します。

検索コマンドを使えるAIは、次のように範囲を広げます。

```sh
rg -n "ClassName|methodName|feature keyword" book/付録D_API一覧.md book/*.md
rg -n "methodName|feature keyword" samples headless_tests unittest webg
rg -n "^export |export default|methodName" webg/*.js
```

API名が分からない場合は、付録Dの見出しから所属クラスを絞り込みます。

```sh
rg -n "^(##|###|####) " book/付録D_API一覧.md
```

ファイル名とクラス名は、多くの場合`webg/<ClassName>.js`に対応します。
例外として、`formatJSON()`は`webg/JsonFormat.js`、UIテーマは`webg/WebgUiTheme.js`、Helpとエラー表示の設定を作る関数は`webg/OverlayPanelPresets.js`にあります。

## コンピュート処理を追加するときの判断

コンピュートシェーダーは、`WebgApp`のフレーム処理へ接続するGPU処理です。標準描画の一部を置き換えるか、GPU上の状態更新を担当します。
AIは、何を管理したいかに応じて入口を選びます。

### `ComputeEffectPipeline`を使う

PBR G-bufferを共有し、PBR遅延照明と複数の画面効果を標準順序で接続する場合に使います。
Pipelineが中間テクスチャを生成し、各パスの接続、サイズ変更、破棄をまとめて行います。

### 個別のコンピュートパスを使う

一つの効果を比較する、中間結果を表示する、標準と異なる順序を研究する場合に使います。
入力、出力、処理順序、サイズ変更、破棄は利用側で管理します。

### `ComputePass`または`computeFrame`を使う

独自WGSL、ストレージバッファ、ストレージテクスチャ、GPUシミュレーションに使います。
`ComputePass.encode()`はコマンドエンコーダーへ処理を記録し、コマンドの送信は呼び出し側が`queue.submit()`で行います。
エンコーダーの生成、レンダーパスとの順序、送信は呼び出し側で行います。

### 安全確認

- WGSLの`@workgroup_size`とJavaScript側の`workgroupSize`を一致させます。
- ディスパッチ数を切り上げる場合はWGSLに範囲外ガードを置きます。
- 前状態を読み、次状態を書く処理ではping-pongリソースを検討します。
- バインディング番号、リソース種別、テクスチャ形式を明示します。
- HDR区間は`rgba16float`を維持し、表示変換は最後に一度だけ行います。
- Canvasのサイズ変更時は、画面サイズに依存するリソースもサイズを変更します。
- `destroy()`を呼ぶ前に、対象のパスやリソースの利用を完了します。

headless testはCPU側の仕様を確認し、実際のWebGPUデバイスでのWGSLコンパイル、Pipelineの検証、描画結果はブラウザでサンプルを起動して確認します。表示品質や操作感は人が判断します。

## UIコンポーネントの選択指針

利用者が画面へ情報を表示したい場合は、目的に応じて次のコンポーネントを使い分けます。

- 操作説明やHelp: `app.showOverlayPanel(buildHelpPanelOptions(...))`
- 動的な数値や状態: `app.message.setLines("status", [...], options)`またはHUD
- 会話やチュートリアル: `OverlayPanel`の`buttons` / `choices`とアプリケーション側の制御処理
- 詳細なエラー理由: `buildErrorPanelOptions()`または`format: "pre"`のOverlay Panel
- 低頻度の設定変更: `CommandPalette`
- 継続的な開発診断: `DebugDock`

画面効果の調整項目を増やすときも、常時表示する操作だけをHUDや固定ボタンへ置き、低頻度の設定値は`CommandPalette`へまとめます。

## リソース参照の優先順位

AIは次の用途を混同せず、必要な根拠を持つ参照先を選びます。

1. `book/付録D_API一覧.md`でAPI名と所属クラスを探します。
2. 章本文で背景、役割、理由、使いどころ、注意点を理解します。
3. `samples`のREADMEで目的とアプリケーションへの接続方法を確認します。
4. `headless_tests`で自動判定できる仕様を確認します。
5. `unittest`で表示、操作、実GPU、ブラウザAPIを人が確認します。
6. `webg`本体で公開API、例外、リソース管理の最終仕様を確認します。

headless testはCPU側の仕様、ブラウザ確認は実GPU上の表示と操作を確認します。境界値、例外、破棄後の状態は、両方の検証結果を組み合わせて保証します。
自動検証とブラウザ確認は代替関係ではなく、それぞれ異なる項目を確認します。

## APIレイヤーの分離と整合性

AIが避けるべきなのは、ハイレベルAPIとローレベルAPIを、リソースを管理する箇所を確認せずに混在させることです。

- 作品定義から起動する場合は`WebgSceneApp`、描画を直接構成する場合は`WebgApp`、`SmoothShader`、`ComputeEffectPipeline`を検討します。
- 利用者が`WebgApp`を使用している場合は、そのフレーム処理を維持します。
- 生のWebGPUまたは個別パスを使う場合も、既存リソースの管理方法を維持します。
- リソースの生成、サイズ変更、更新、破棄をどこで行うか一つに決めます。
- 不完全な入力は、プロパティ名と期待形式を含む例外として利用者へ伝えます。

`ModelAsset`はメッシュ、スケルトン、アニメーションを持つ単一モデルの共通表現です。
`SceneAsset`はSceneYAMLまたはJSONの作品定義を保持し、配置、inline mesh、マテリアル、物理、アニメーション、renderer、モデル参照をまとめます。
モデルを複数配置したいのか、シーン全体を保存・復元したいのかを切り分けてください。

アニメーションの問題は、clip、Action、AnimationState、スケルトン適用のどこにあるかを確認します。
描画の問題は、標準Forward描画なら`SmoothShader`のマテリアル設定を、PBR統合レンダリングならG-bufferのマテリアル、光源、環境、Pipeline設定を確認します。
WGSLは、既存の設定値では解決できず、入出力や処理方式自体を変える場合に変更します。

## 問題を診断する順序

表示や動作に問題がある場合は、最初からシェーダーの計算式だけを疑わず、共通基盤から最終表示へ順番に確認します。

1. `await app.init()`または`await screen.ready`が完了しているか確認します。
2. JavaScript例外とWebGPUの検証メッセージを確認します。
3. `WebgApp`のフレーム方式と登録したコールバックが一致しているか確認します。
4. Space、Node、Shape、カメラの状態が期待どおりか確認します。
5. 標準Forward描画かPBR統合レンダリングかを確認します。
6. PBR統合レンダリングでは、G-bufferのbase color、法線、深度、`specular`、`roughness`、`metallic`、`occlusion`、発光を個別に確認します。
7. `CameraFrame`、深度規則、テクスチャ形式を確認します。
8. 直接光だけ、IBLだけ、統合照明の順で確認し、マテリアルと光源の問題を分けます。
9. SSRでは元の鏡面IBLと置換後の反射を、Transmissionではentry、exit、背景hit、fallbackを分けて確認します。
10. サイズ変更後に古いリソースを参照していないか確認します。
11. 最終表示だけが黒い場合はTone Mapping、表示処理、Fullscreen copyを確認します。
12. HUDが消える場合は`clearDepthBuffer()`でCanvasパスへ戻っているか確認します。
13. GPU状態を先に更新する処理では、ディスパッチ、バインディング、範囲外ガード、送信順序を確認します。
14. 性能問題ではCPU時間だけで判断せず、`compute_benchmark`のGPU計測と、各PBR passの処理時間を参照します。

## AIが維持すべき基本姿勢

1. `WebgApp`をアプリケーションの中心として考える:
   高度な描画やGPU計算を追加しても、共通のシーン、カメラ、入力、UIを維持します。
2. 最も抽象度の高いAPIから検討する:
   `WebgSceneApp`とSceneYAMLを入口にできるか確認し、個別制御には`WebgApp`、`ModelAsset`、`ComputeEffectPipeline`を使います。
3. 本書で設計意図を確認し、現行実装で照合する:
   APIと例外はサンプル、自動テスト、ブラウザPOC、`webg/*.js`で確認します。
4. 問題の層と描画経路を切り分ける:
   アプリケーション、シーン、形状、カメラ、照明、UI、物理、コンピュート、最終表示を一つの原因へまとめず、使用中の描画経路も確認します。
5. 確認方法と変更範囲を選ぶ:
   自動テスト、ブラウザ自動撮影、人の目視確認が保証する範囲を区別します。アプリケーション側の組み合わせを優先し、コアの不具合または共通APIの不足と確認できた場合は、コア、サンプル、テスト、文書を同じ仕様で更新します。

`webg`は、`WebgApp`を中心として、設計、実装、サンプル、自動テスト、文書化を一つの体系に保つライブラリです。
AIは本書を一次的な参照地図として利用し、共通の3Dアプリケーション構造を維持したまま、目的に合う照明経路とGPU処理を選び、利用者が根拠を確認できる形で支援してください。

## 単機能の例からゲームへ進む場合

`PBRシーンから小さなゲームへ.md`と`samples/fantasy/README.md`から始めます。
まず元のゲームを動かし、`start()`から初期シーン・手動Shape・更新・選択・解放を読みます。
材質、移動力、歩行時間、粒子色を一つずつ変えて、各関数の責任を確認してください。
短い教材例をつなぐ際に、フレームループ、粒子更新、GPU資源の解放を二重に実装しません。
