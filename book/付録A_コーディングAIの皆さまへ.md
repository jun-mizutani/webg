# コーディング AI の皆さまへ

## `webg`利用者を支援するためのガイドライン

この付録は、`webg`を用いて3Dアプリケーションを開発する利用者を、コーディングAIが支援する場面を想定して作成されました。
ここで想定するAIは、一般的な3Dエンジンや外部ライブラリの知識をそのまま適用するのではなく、`webg`という自己完結したライブラリの設計思想に基づき、何をどの順番で参照すべきかを判断する支援者です。

`webg`を利用するアプリケーションでは、まず`WebgApp`が初期化、更新ループ、カメラ、入力、UI、描画タイミングを統合します。
3D形状は`Space`、`Node`、`Shape`、`ModelAsset`によって構成され、この部分はフォワードレンダリング経路でも、コンピュート処理を利用する遅延レンダリング経路でも共通です。

大きな選択は形状の作り方ではなく、照明と画面効果をどの描画経路で処理するかにあります。
普通に頂点シェーダーとフラグメントシェーダーでシーンを描画する場合は、`SmoothShader`を使うフォワードレンダリング経路を選びます。
高度な照明、SSAO、SSR、複数の後段効果が必要な場合は、`ComputeEffectPipeline`を使う遅延レンダリング経路を選択できます。
どちらも`WebgApp`のフレーム処理内で構成できます。

```text
WebgApp
  ├─ 初期化、更新ループ、カメラ、入力、UI
  ├─ Space、Node、Shape、ModelAsset
  └─ 照明・最終描画経路の選択
       ├─ フォワードレンダリング経路
       │    └─ SmoothShaderによる直接照明
       └─ 遅延レンダリング経路
            └─ G-buffer + ComputeEffectPipeline
```

この図の上側は、アプリケーションの共通基盤です。
下側の分岐は、同じシーンと形状をどの照明経路で最終画面へ変換するかを示します。
遅延レンダリング経路を選ぶために`WebgApp`、`Space`、`Shape`を捨てて、生のWebGPUアプリケーションへ作り直す必要はありません。
反対に、コンピュートシェーダーが利用できるという理由だけで、単純な画面まで遅延レンダリング経路へ移す必要もありません。

本書において重要なのは、`webg`が外部の3Dライブラリに依存せず、描画、シーン管理、モデル、アニメーション、UI、入力、物理、音声、診断、GPU計算を内部に持つことです。
AIが技術支援を行う際は、「一般的なWebGPU実装はこうであるはずだ」あるいは「Three.jsではこうだから同様だろう」といった推測よりも、本書、`samples`、`headless_tests`、`unittest`、`webg`本体の現行実装を優先してください。

一般論は概念を説明する補助として利用できますが、公開API、引数、形式、ライフサイクル、例外条件の最終判断は`webg`の資料と実装に置きます。
本付録の目的は、利用者が何を作りたいか、どの層で問題が起きているかに応じて、AIが参照する章、サンプル、自動テスト、ブラウザPOC、コア実装を選ぶための読書地図を提供することです。

## `WebgApp`を中心に考える

### アプリケーションの共通基盤

`WebgApp`は、単にCanvasを初期化する補助クラスではありません。
Screen、GPUコンテキスト、シーン、標準シェーダー、カメラ、入力、Message、HUD、Overlay Panel、DebugDock、フレーム処理を一つのアプリケーション構造へまとめます。

利用者がフォワードレンダリング経路を使う場合も、遅延レンダリング経路を使う場合も、次の処理は共通です。

- `await app.init()`でGPUとアプリケーション機能を初期化する
- `Space`と`Node`でシーン階層と配置を管理する
- `Shape`、`Primitive`、`ModelAsset`で3D形状を用意する
- `EyeRig`または標準カメラで視点を管理する
- `onUpdate`でアプリケーション状態を更新する
- `InputController`でキーボード、ポインター、タッチを扱う
- HUD、Overlay Panel、CommandPaletteで情報と操作を提示する

描画経路が変わっても、モデルの読み込み、Nodeの移動、アニメーションの更新、カメラの操作、UIの構築を別の体系へ置き換える必要はありません。
AIは、照明方式の変更をアプリケーション全体の作り直しとして提案しないでください。

### 3D形状と配置は共通である

`Space`はシーンのNode階層を管理し、`Shape`は頂点、法線、UV、複数のmaterial slot、三角形ごとのmaterial番号などを保持します。
`ModelAsset`から展開されたモデルも、最終的にはNodeとShapeとしてシーンへ配置されます。

フォワードレンダリング経路では、これらのShapeを`SmoothShader`が直接描画します。
遅延レンダリング経路では、同じSpaceとShapeを`GeometryBufferPass`がG-bufferへ描画し、後段で照明を計算します。
内部で使うシェーダーと出力先は異なりますが、利用者が同じモデルを別形式で作り直す必要はありません。

ただし、遅延レンダリング経路ではG-bufferへ渡す表面のマテリアル情報が必要です。
`specular`、`roughness`、`metallic`、`emissive`をすべて指定し、欠落値を任意のフォールバックで補って問題を隠さないでください。

## 照明と最終描画経路を選ぶ

### フォワードレンダリング経路

フォワードレンダリング経路では、形状を描くときに`SmoothShader`が照明を評価し、その結果をCanvasへ出力します。
構成が小さく、3Dシーンを短い経路で描画できることが利点です。

次の場合は、フォワードレンダリング経路を最初に検討します。

- 単純な3D形状やモデルを表示する
- 少数のライトで十分である
- G-bufferを必要とする画面効果を使わない
- 描画構成とリソース数を小さく保ちたい
- `SmoothShader`のマテリアル設定で必要な見た目を作れる

この経路では`WebgApp`の通常のフレーム処理を利用します。
利用者がカメラフレームや個別のコマンドエンコーダーを管理する必要はありません。
`Space.draw(eye)`による単純な描画へ、遅延レンダリング用のリソースやフレーム状態を追加しないでください。

### 遅延レンダリング経路

遅延レンダリング経路では、最初に不透明Shapeの表面情報をG-bufferへ保存し、そのテクスチャを使って照明と画面効果を計算します。
`ComputeEffectPipeline`は、G-buffer、シャドウ、SSAO、遅延照明、SSR、半透明、Toon、DoF、Bloom、Tone Mapping、Edgeを一つの順序へ接続します。

半透明はmaterialの独立した`alpha`で指定します。
`color[3]`を透明度へ読み替えません。
一つのShapeに不透明と半透明の三角形が混在しても、全Shape横断で透明三角形を奥から手前へ並べます。
Pipeline利用側へ透明用Render Passを追加する提案はせず、`roughness`による背景ぼけとSpecularを内部の`TransparencyPass`へ任せます。

次の場合は、遅延レンダリング経路を検討します。

- G-bufferを共有する複数の効果を使う
- SSAOで接地感を加えたい
- SSRで画面空間反射を加えたい
- 多数または種類の異なるライトを後段で評価したい
- HDR区間で照明、反射、Bloom、DoFを接続したい
- 中間テクスチャの形式と処理順序を統合APIへ任せたい

遅延レンダリング経路も`WebgApp`の中で動作します。
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

`ComputeEffectPipeline`は、効果を無効にしたときにフォワードレンダリング経路へ自動的に戻るクラスではありません。
アプリケーションの入口で、フォワードレンダリング経路を使うか、遅延レンダリング経路を使うかを明示的に選びます。

### GPU状態を先に更新する処理は別の応用である

GPU粒子、布、物理、手続きテクスチャのように、画面を描く前にGPU上の状態を更新する処理は、照明経路の分岐とは別の応用です。
この場合も`WebgApp`を利用できますが、`computeFrame: true`と`onComputeFrame`を使います。

```text
WebgApp computeFrame
  -> 状態を更新するコンピュートパス
  -> 最新状態を読むレンダーパス
  -> コマンドバッファを送信
```

この処理を使う理由は、遅延照明を使うためではありません。
大量の状態をGPU上で更新し、その結果をCPUへ戻さず描画へ渡すためです。
照明経路の選択とGPUシミュレーションの選択を同じ問題として扱わないでください。

## 自己完結した設計思想の理解

`webg`は、外部ライブラリをつなぎ合わせた薄いラッパーではありません。
描画、シーン、モデル、アニメーション、UI、入力、診断、GPU計算を一つの設計規則で接続します。

カメラは`cameraRig` $\rightarrow$ `cameraRod` $\rightarrow$ `eye`、シーンと形状は`Space` $\rightarrow$ `Node` $\rightarrow$ `Shape`で構成します。
`ModelAsset` $\rightarrow$ `build()` $\rightarrow$ `instantiate()`は共通リソースと個別インスタンスを分け、`clip` $\rightarrow$ `pattern` $\rightarrow$ `action` $\rightarrow$ `state`はアニメーションを段階化します。

AIは、最初に`webg`独自の定義と各機能が担当する処理を確認し、その後で一般的な3DやWebGPUの概念と対応付けてください。
一般論を先に当てはめると、深度規則、色空間、カメラ状態、GPUリソースを管理する箇所を取り違えることがあります。

## 遵守すべきテクニカル・ルール

### 1. 初期化とライフサイクル

- `await screen.ready`または`await app.init()`の完了前に、GPUリソースを生成しません。
- `app.space`、`app.eye`、`app.getGPU()`は`await app.init()`完了後に使用します。
- 毎フレームのアプリケーション状態更新は`app.start({ onUpdate: ... })`へ置きます。
- `computeFrame: true`を使う場合は`onComputeFrame`を必ず登録します。
- `computeFrame: true`でないアプリへ`onComputeFrame`だけを追加しません。

### 2. 形状とリソースの確定

- `Shape`へ頂点データを追加した後は、必ず`shape.endShape()`を呼びます。
- ModelAssetは`build()`で実行時リソースを作り、必要な数だけ`instantiate()`します。
- 同じShapeを複数配置するときは、頂点を複製せずNodeのtransformを使います。
- リソースの生成、サイズ変更、更新、破棄をどこで行うか一つに決めます。
- Pipelineが内部で生成・管理するリソースを、利用側から重複作成または破棄しません。

### 3. 座標系と回転

- 右手座標系で`+X=右`、`+Y=上`です。
- ワールド`+Z`と標準カメラのローカル前方`-Z`を区別します。
- モデル前方はアセットまたはアプリケーションの規約を確認します。
- 回転は`yaw / pitch / roll`と`CoordinateSystem`の定義に従います。
- 大きなワールド座標をGPUのfloat32行列で相殺せず、カメラ相対のモデルビュー変換を使います。

### 4. 深度とカメラフレーム

- 通常カメラは`CAMERA_REVERSE_Z`、`depth32float`、クリア値0、比較関数`greater`です。
- Shadow Mapは`SHADOW_STANDARD_Z`、クリア値1、比較関数`less`です。
- 通常カメラの深度とShadow Mapの深度を同じ意味として扱いません。
- `CameraFrame`は、一回の描画で共有するカメラ状態を確定した値です。標準の単一パスへ不要な`CameraFrame`や`renderFrameToken`を追加しません。
- 同じ深度を読む後段パスだけが、同じ`CameraFrame`またはトークンを共有します。
- `ComputeEffectPipeline.renderScene()`と`encode()`へ同じ`CameraFrame`を渡します。
- 半透明はmaterialの`alpha`と三角形のmaterial slot番号から自動分類します。
- `TransparencyPass`はSSR後、Toon / DoF / Bloom前のHDR sceneへ透明面を合成します。
- near、far、FOV、カメラのワールド行列を個別のパスで推測しません。

### 5. 最終表示の順序

標準の単一パスでは`clear` $\rightarrow$ `draw` $\rightarrow$ `present`を使います。
完成したテクスチャをCanvasへ表示する統合経路では、次の順序を使います。

```text
beginPresentPass()
  -> FullscreenPass.draw()
  -> clearDepthBuffer()
  -> Canvas上のHUDまたは後続描画
```

`clearDepthBuffer()`は最終テクスチャを消す処理ではありません。
完成したテクスチャを表示した後、HUDが使う深度付きCanvasパスを再開します。

## 目的別の参照先

AIは利用者がどの層の話をしているかを判定し、目的に対応する章、サンプル、自動テストを選択してください。
以下でディレクトリ名だけを記したものは、`samples/`以下のサンプルです。

- **最初の3Dオブジェクト**: 第4、5章、`low_level`、`high_level`
- **`WebgApp`によるアプリケーション基盤**:
  第5、6章、`high_level`
- **Orbit、Follow、First-personカメラ**:
  第5、6章、`high_level`、`eye_rig`
- **形状とマテリアル**: 第7、9、22〜24章、`shapes`、`materials`
- **フォワードレンダリング経路の照明**:
  第9、24章、`SmoothShader`、`shapes`、`materials`
- **遅延照明と複数の画面効果**:
  第27〜29章、`compute_effect`、`compute_json`
- **glTF、GLB、Colladaモデル**:
  第10、12、13章、`gltf_loader`、`collada_loader`
- **Scene JSON**: 第5、10、11章、`scene`
- **アニメーションの状態遷移**:
  第12、13章、`animation_state`、`janken`
- **HUDやパネルなどのUI**:
  第5、14〜16章、`OverlayPanel`、`CommandPalette`を使うサンプル
- **入力、レイキャスト、衝突判定**:
  第16、17章、`unittest/raycast`、`headless_tests/core/physics_space`
- **物理ボディ、反発、摩擦**:
  第26章、`physics_bounce`、`headless_tests/core/physics_space`
- **個別のコンピュート効果**: 第27〜29章。参照先は
  `compute_bloom`、`compute_deferred_lighting`、`compute_dof`、
  `compute_edge`、`compute_shadow_map`、`compute_ssao`、
  `compute_ssao_gbuffer`、`compute_ssr`、`compute_vignette`
- **GPU上で更新する粒子、布、物理、テクスチャ**:
  第27章。参照先は
  `compute_particles`、`compute_cloth`、`compute_physics_bounce`、
  `compute_texture`
- **低水準のコンピュート接続**:
  第27章、`compute_postprocess`、`webg/ComputePass.js`
- **コンピュート処理の性能比較**:
  第27〜29章、`compute_benchmark`

同じ題材名を持つサンプルを重複と判断しないでください。
`bloom`と`compute_bloom`、`dof`と`compute_dof`、`physics_bounce`と`compute_physics_bounce`は、描画方式または計算場所を比較する別のサンプルです。
コンピュート系サンプルの目的と維持理由は`samples/README.md`で確認できます。

## APIが見つからない場合の調べ方

APIや利用方法が見つからない場合は、外部ライブラリのAPIを代用せず、次の順に探索してください。

1. `book/付録C_API一覧.md`でクラス名と機能名を探します。
2. 章本文で背景、役割、理由、処理順序、注意点を確認します。
3. `samples/<name>/README.md`でサンプルの目的を確認します。
4. `main.js`と補助`*.js`で実際の接続方法を確認します。
5. `headless_tests/core/<core_name>`で自動検証される仕様を確認します。
6. `unittest`で人が確認するブラウザPOCを探します。
7. 最後に`webg/*.js`で公開API、例外、リソースを管理する処理を確認します。

検索コマンドを使えるAIは、次のように範囲を広げます。

```sh
rg -n "ClassName|methodName|feature keyword" book/付録C_API一覧.md book/*.md
rg -n "methodName|feature keyword" samples headless_tests unittest webg
rg -n "^export |export default|methodName" webg/*.js
```

API名が分からない場合は、付録Cの見出しから所属クラスを絞り込みます。

```sh
rg -n "^(##|###|####) " book/付録C_API一覧.md
```

ファイル名とクラス名は、多くの場合`webg/<ClassName>.js`に対応します。
例外として、`formatJSON()`は`webg/JsonFormat.js`、UIテーマは`webg/WebgUiTheme.js`、Helpとエラー表示の設定を作る関数は`webg/OverlayPanelPresets.js`にあります。

## コンピュート処理を追加するときの判断

コンピュートシェーダーは、`WebgApp`に代わる別のアプリケーション基盤ではありません。
標準描画の一部を置き換えるか、GPU上の状態更新を担当する処理です。
AIは、何を管理したいかに応じて入口を選びます。

### `ComputeEffectPipeline`を使う

G-bufferを共有し、遅延照明と複数の画面効果を一般的な順序で接続する場合に使います。
Pipelineが中間テクスチャを生成し、各パスの接続、サイズ変更、破棄をまとめて行います。

### 個別のコンピュートパスを使う

一つの効果を比較する、中間結果を表示する、標準と異なる順序を研究する場合に使います。
入力、出力、処理順序、サイズ変更、破棄は利用側で管理します。

### `ComputePass`または`computeFrame`を使う

独自WGSL、ストレージバッファ、ストレージテクスチャ、GPUシミュレーションに使います。
`ComputePass.encode()`はコマンドエンコーダーへ処理を記録しますが、送信は行いません。
エンコーダーの生成、レンダーパスとの順序、送信は呼び出し側で行います。

### 安全確認

- WGSLの`@workgroup_size`とJavaScript側の`workgroupSize`を一致させます。
- ディスパッチ数を切り上げる場合はWGSLに範囲外ガードを置きます。
- 前状態を読み、次状態を書く処理ではping-pongリソースを検討します。
- バインディング番号、リソース種別、テクスチャ形式を明示します。
- HDR区間は`rgba16float`を維持し、表示変換は最後に一度だけ行います。
- Canvasのサイズ変更時は、画面サイズに依存するリソースもサイズを変更します。
- `destroy()`後のパスやリソースを再利用しません。

headless testが成功しても、実際のWebGPUデバイスでのWGSLコンパイル、Pipelineの検証、描画結果までは保証しません。
実GPUでの成立はブラウザでサンプルを起動して確認し、表示品質や操作感は人が判断します。

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

1. `book/付録C_API一覧.md`でAPI名と所属クラスを探します。
2. 章本文で背景、役割、理由、使いどころ、注意点を理解します。
3. `samples`のREADMEで目的とアプリケーションへの接続方法を確認します。
4. `headless_tests`で人の判断を必要としない仕様を確認します。
5. `unittest`で表示、操作、実GPU、ブラウザAPIを人が確認します。
6. `webg`本体で公開API、例外、リソース管理の最終仕様を確認します。

headless testが成功しても、実際のブラウザ表示が正しいとは限りません。
反対に、ブラウザで一度表示されたことだけでは、境界値、例外、破棄後の状態などの仕様を保証できません。
自動検証とブラウザ確認は代替関係ではなく、それぞれ異なる項目を確認します。

## APIレイヤーの分離と整合性

AIが避けるべきなのは、ハイレベルAPIとローレベルAPIを、リソースを管理する箇所を確認せずに混在させることです。

- まず`WebgApp`、`SmoothShader`、`ComputeEffectPipeline`などの既存入口を検討します。
- 利用者が`WebgApp`を使用している場合は、そのフレーム処理を維持します。
- 生のWebGPUまたは個別パスを使う場合も、既存リソースの管理方法を維持します。
- リソースの生成、サイズ変更、更新、破棄をどこで行うか一つに決めます。
- 不完全な入力を別形式や既定カメラへ読み替えて問題を隠しません。

`ModelAsset`はメッシュ、スケルトン、アニメーションを持つ単一モデルの共通表現です。
`SceneAsset`はカメラ、HUD、配置済みプリミティブ、配置済みモデルなど、シーン全体の初期状態です。
モデルを複数配置したいのか、シーン全体を保存・復元したいのかを切り分けてください。

アニメーションの問題は、clip、Action、AnimationState、スケルトン適用のどこにあるかを確認します。
描画の問題は、フォワードレンダリング経路なら`SmoothShader`のマテリアル設定を、遅延照明ならG-bufferのマテリアルとPipeline設定を確認します。
WGSLは、既存の設定値では解決できず、入出力や処理方式自体を変える場合に変更します。

## 問題を診断する順序

表示や動作に問題がある場合は、最初からシェーダーの計算式だけを疑わず、共通基盤から最終表示へ順番に確認します。

1. `await app.init()`または`await screen.ready`が完了しているか確認します。
2. JavaScript例外とWebGPUの検証メッセージを確認します。
3. `WebgApp`のフレーム方式と登録したコールバックが一致しているか確認します。
4. Space、Node、Shape、カメラの状態が期待どおりか確認します。
5. フォワードレンダリング経路か遅延レンダリング経路かを確認します。
6. 遅延レンダリング経路ではG-bufferの各テクスチャを確認します。
7. `CameraFrame`、深度規則、テクスチャ形式を確認します。
8. サイズ変更後に古いリソースを参照していないか確認します。
9. 最終表示だけが黒い場合はTone Mapping、表示処理、Fullscreen copyを確認します。
10. HUDが消える場合は`clearDepthBuffer()`でCanvasパスへ戻っているか確認します。
11. GPU状態を先に更新する処理では、ディスパッチ、バインディング、範囲外ガード、送信順序を確認します。
12. 性能問題ではCPU時間だけで判断せず、`compute_benchmark`のGPU計測を参照します。

## AIが維持すべき基本姿勢

1. `WebgApp`をアプリケーションの中心として考える:
   高度な描画やGPU計算を追加しても、共通のシーン、カメラ、入力、UIを維持します。
2. 最も抽象度の高いAPIから検討する:
   `WebgApp`、`loadModel()`、`SmoothShader`、`ComputeEffectPipeline`で解決できるか確認します。
3. 本書で設計意図を確認し、現行実装で照合する:
   APIと例外はサンプル、自動テスト、ブラウザPOC、`webg/*.js`で確認します。
4. 問題の層と描画経路を切り分ける:
   アプリケーション、シーン、形状、カメラ、照明、UI、物理、コンピュート、最終表示を一つの原因へまとめず、使用中の描画経路も確認します。
5. 確認方法と変更範囲を選ぶ:
   自動テスト、ブラウザ自動撮影、人の目視確認が保証する範囲を区別します。アプリケーション側の組み合わせを優先し、コアの不具合または共通APIの不足と確認できた場合は、コア、サンプル、テスト、文書を同じ仕様で更新します。

`webg`は、`WebgApp`を中心として、設計、実装、サンプル、自動テスト、文書化を一つの体系に保つライブラリです。
AIは本書を一次的な参照地図として利用し、共通の3Dアプリケーション構造を維持したまま、目的に合う照明経路とGPU処理を選び、利用者が根拠を確認できる形で支援してください。
