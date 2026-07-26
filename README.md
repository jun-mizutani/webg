# webg 2

[English](README.en.md) | 日本語

`webg`は、JavaScriptとWebGPUを用いて3Dアプリケーションを構築するための自己完結型ライブラリです。

version 2では、version 1から引き継いだ描画、3D数学、シーングラフ、モデルアセット、アニメーション、UI、入力、衝突判定、物理、サウンド、診断の各機能に加えて、Compute Shaderを使うGPU計算と遅延レンダリングを本格的に統合しました。
単純な3D表示には従来どおり短いフォワード描画を使い、G-bufferを共有する高度な照明や画面効果が必要な場面では`ComputeEffectPipeline`を選択できます。
GPU粒子、布、物理シミュレーション、手続きテクスチャのように、描画前にGPU上の状態を更新するアプリケーションにはGPU計算先行方式を用意しています。

`webg`は、WebGPUを薄く包み、内部構造を見えなくするためのライブラリではありません。
高水準な`WebgApp`から始めながら、必要に応じて`Screen`、`Shape`、Render Pass、Compute Pass、WGSL、GPUリソースまで追跡できることを重視しています。

[サンプルアプリケーションはここから実行できます。](https://jun-mizutani.github.io/webg/samples/index.html)

![samples](./samples/samples1.jpg)

## version 2.0 について

version 1のアプリケーションを移行する場合は、最初に[付録B「webg 1.0から2.0への移行」](book/付録B_webg_1.0から2.0への移行.md)を参照してください。
通常カメラの深度規則、独自シェーダー、ポストプロセス、G-buffer、半透明材質を扱っていない単純なアプリケーションは、従来の`WebgApp`、`Space`、`Node`、`Shape`を保ったまま移行できます。
すべてのアプリケーションをCompute Shader専用へ作り直す必要はありません。

## 設計方針

`webg`は次の方針で設計されています。

- 外部3Dエンジンへ依存しない
- WebGPUのRender Pass、Compute Pass、GPUリソースの関係を隠しすぎない
- 高水準APIと低水準APIを同じライブラリ内で利用できるようにする
- 形状、シーン、カメラ、入力、UI、物理、サウンド、診断を一つのアプリケーション構造へ接続する
- CPUとGPUのどちらで状態を更新するかを用途に応じて選べるようにする
- サンプル、書籍、自動テスト、コア実装を相互に追跡しやすくする
- 暗黙の数値補正やサイレントフォールバックで誤りを隠さず、入力条件の不一致を例外として示す
- 人間にもコーディングAIにも参照しやすい説明と検証環境を用意する

Three.jsやBabylon.jsのような大規模汎用3Dエンジンを置き換えることを直接の目的にはしていません。
WebGPU 3Dアプリケーションの処理フローを理解し、利用側が必要な範囲を自分で制御できる規模のライブラリとして使うことを重視しています。

## アプリケーション構成

### 共通基盤はWebgAppである

`WebgApp`は、GPU初期化、`Screen`、標準シェーダー、`Space`、カメラ、入力、HUD、Overlay Panel、CommandPalette、診断、更新ループ、描画タイミングをまとめます。
標準フォワード描画、遅延レンダリング、GPU計算先行方式のどれを選ぶ場合も、アプリケーションの共通入口として利用できます。

3Dシーンは`Space`、`Node`、`Shape`、`ModelAsset`で構成します。
照明方式を変更するために、モデル、Node階層、アニメーション、入力、UIを別の体系へ作り直す必要はありません。

```text
WebgApp
  ├─ 初期化、更新ループ、カメラ、入力、UI、診断
  ├─ Space、Node、Shape、ModelAsset
  └─ フレーム処理の選択
       ├─ 通常フレーム
       │    ├─ 標準フォワード描画
       │    │    └─ SmoothShaderによる直接照明
       │    └─ 遅延レンダリング
       │         └─ G-buffer + ComputeEffectPipeline
       └─ GPU計算先行方式
            └─ computeFrame + ComputePass / GpuParticleEmitter
```

### 標準フォワード描画

標準フォワード描画では、`SmoothShader`がShapeを描くときに照明を計算し、Canvasへ出力します。
少数のライトで十分な場面、G-bufferを必要とする画面効果を使わない場面、GPUリソースと処理段階を小さく保ちたい場面に向いています。

`WebgApp`の標準フレームは、通常カメラ用Reverse-Z、カメラ相対レンダリング、同一フレームのカメラ状態を内部で扱います。
単純なアプリケーションへ`CameraFrame`やRender Passを追加する必要はありません。

### 遅延レンダリングとComputeEffectPipeline

遅延レンダリングでは、最初に不透明Shapeの表面情報をG-bufferへ保存し、後段で照明と画面効果を計算します。
`ComputeEffectPipeline`は、シャドウ、SSAO、遅延照明、SSR、半透明、フォグ、トゥーン、DoF、Bloom、トーンマッピング、輪郭抽出、ビネットを、入力と出力の意味が一致する順序へ接続します。

遅延照明からBloomまでの中間色は線形HDRです。
露出、トーンマッピング、sRGB変換は最終表示の境界で一度だけ行います。
各処理で個別にガンマ補正や0から1への切り詰めを行うと、照明やBloomの輝度情報が失われます。

半透明三角形はG-bufferへ書きません。
不透明照明とSSRの後に`TransparencyPass`が線形HDRシーンへ合成し、その結果へ後段の画面効果を適用します。
利用側で透明専用Render Passを追加する必要はありません。

### GPU計算先行方式

GPU粒子、布、物理シミュレーション、手続きテクスチャのように、GPU上の状態を更新してから同じフレームで描画する場合は`computeFrame: true`を使います。
アプリケーションは`onComputeFrame`内でコマンドエンコーダーを作り、Compute PassとRender Passを必要な順に記録し、最後に一度だけ送信します。

この方式は遅延ライティングを使うための設定ではありません。
照明をどこで計算するかと、描画前にGPU状態を更新するかは別の選択です。

## version 2の主な特徴

### Camera Reverse-Zとカメラ相対レンダリング

通常カメラは`CAMERA_REVERSE_Z`を使い、`depth32float`、クリア値0、比較関数`greater`で統一します。
シャドウマップは`SHADOW_STANDARD_Z`を使い、同じ`depth32float`でもクリア値1、比較関数`less`として分離します。
通常カメラとシャドウの深度を同じ規則として扱わないでください。

広いワールドでは、JavaScriptの`Number`で物体位置とカメラ位置の差を求め、カメラ付近の小さな座標をGPUへ渡します。
巨大なワールド座標同士をGPUの`float32`行列で相殺しないため、遠方でも細かな位置情報を保ちやすくなります。

### CameraFrameと深度依存処理

`CameraFrame`は、一回の描画で共有する確定済みのカメラ状態です。
G-buffer描画と、同じ深度から位置や距離を復元する後段処理には、同じ`cameraFrame`を渡します。
各Passが`near`、`far`、FOV、カメラ行列を個別に推測しません。

通常の単一描画では`WebgApp`が内部で管理するため、利用側が`CameraFrame`を組み立てる必要はありません。
`ComputeEffectPipeline.renderScene()`と`encode()`を接続する場合に、同じコールバックから受け取った値を共有します。

### 複数マテリアルと半透明の自動合成

一つの`Shape`は複数のマテリアルスロットを持ち、各三角形が使用するスロット番号を保持できます。
従来の`setMaterial()`、`getMaterial()`、`updateMaterial()`はスロット0を操作するため、単一マテリアルのversion 1コードも維持できます。

描画透明度はマテリアルの独立した`alpha`で指定します。
`color[3]`は従来のテクスチャ混合率であり、透明度として読み替えません。
`alpha === 1.0`は不透明、`0.0 <= alpha < 1.0`は半透明として三角形単位で分類され、全Shapeの半透明三角形が奥から手前へ並べられます。

```js
const shape = new Shape(gpu);

shape.setMaterial("smooth-shader", {
  color: [0.84, 0.28, 0.10, 1.0],
  alpha: 1.0,
  specular: 0.6,
  roughness: 0.32
});

shape.setMaterialAt(1, "smooth-shader", {
  color: [0.15, 0.65, 1.0, 1.0],
  alpha: 0.42,
  specular: 1.0,
  roughness: 0.18,
  power: 128
});

shape.addTriangle(a, b, c, 0);
shape.addTriangle(a, c, d, 1);
shape.endShape();
```

半透明面同士が交差する場面や、循環した前後関係を持つ場面は、代表奥行きによる通常のAlpha合成だけでは一意に解決できません。
この制限が問題になるシーンでは、形状の分割や別の透明方式を検討してください。

### G-buffer、照明、画面効果

G-bufferには照明前のアルベド、法線、鏡面反射、粗さ、金属度、発光などを保存します。
遅延レンダリングへ渡す材質では`specular`、`roughness`、`metallic`、`emissive`を表面の意味に応じて明示し、不足値をG-buffer側で推測させません。

SSAOとシャドウは完成色ではなく可視率を返し、`DeferredLightingPass`が材質とライトへ適用します。
ローカルライトは`type: "point"`または`type: "cone"`を明示します。
SSRはアルベドのAlphaへ格納せず、独立したHDR反射として合成します。

### 画像Pyramidによる広いぼかし

Bloom、DoF、すりガラス、汎用の広いblurでは、大きなsample stepで離れたtexelを疎に読むのではなく、連続した低域通過と画像Pyramidを使います。
`ComputeImagePyramid`は段階的な縮小を共通化し、`ComputePyramidBlurPass`は最小段階から元の解像度へ順番に拡大します。

Bloomは1/2から1/32までの各段階を重み付きで合成し、広い光のにじみを作ります。
DoFは近景と遠景のgeometry coverageをCoCから分け、物体がフィルター領域へ含まれる割合と、焦点距離から選ぶPyramid Levelを別の値として扱います。

### GPU計算と再利用可能な補助機能

`ComputePass`は、指定されたコマンドエンコーダーへCompute Passを記録します。
`StorageTargetFactory`はコンピュート処理が書き込み、後段が読み取れるストレージテクスチャの生成条件を揃えます。
`PingPongBuffer`、`PingPongTexture`、`PingPongTarget`は、反復計算で前回の出力と次回の入力を交換する処理を共通化します。

`GpuParticleEmitter`は、粒子状態のストレージバッファ、更新用Compute Pipeline、インスタンス描画をまとめます。
座標空間と描画先の深度規則は`coordinateSpace`と`depthConvention`で明示します。

### UI、入力、診断、性能計測

Canvas HUD、DOM overlay、`OverlayPanel`、`CommandPalette`、`DebugDock`を使い、実行中の状態、設定値、操作を同じアプリケーション内へ表示できます。
入力ではPointer Eventsを共通入口として、タッチ、マウス、ペンを同じジェスチャー仕様で扱います。

`Diagnostics`と`DebugProbe`は内部状態と異常を確認し、`FrameTimer`はGPUタイムスタンプとJavaScript時間の測定を支援します。
見た目の確認だけでなく、`headless_tests`、`unittest`、機能別サンプル、`compute_benchmark`を目的に応じて使い分けられます。

## APIレイヤー

| レイヤー | 主なクラス | 用途 |
|---|---|---|
| アプリケーション | `WebgApp` | 初期化、更新ループ、カメラ、入力、UI、診断、フレーム処理を統合する |
| シーン | `Space`, `Node`, `SceneAsset`, `SceneLoader` | シーン階層、配置、JSONベースのシーン読み込みを扱う |
| モデル | `Shape`, `Primitive`, `ModelAsset`, `ModelBuilder`, `ModelLoader` | メッシュ、複数マテリアル、外部モデル、ランタイムインスタンスを扱う |
| 数学・カメラ | `Matrix`, `Quat`, `EyeRig`, `CameraFrame` | 座標変換、姿勢、視点、同一フレームのカメラ状態を扱う |
| Render API | `Screen`, `Shader`, `RenderTarget`, `FullscreenPass` | Render Pass、WGSL、描画先、最終表示を直接扱う |
| 遅延レンダリング | `GeometryBufferPass`, `DeferredLightingPass`, `ComputeEffectPipeline` | G-buffer、照明、半透明、画面効果を統合する |
| Compute API | `ComputePass`, `ComputeImagePyramid`, `ComputePyramidBlurPass` | Compute Pipeline、画像Pyramid、広いblurを扱う |
| GPUシミュレーション | `GpuParticleEmitter`, `StorageTargetFactory`, `PingPongBuffer`, `PingPongTexture`, `PingPongTarget` | GPU状態更新、ストレージリソース、反復計算を扱う |
| アニメーション | `Tween`, `Animation`, `Action`, `AnimationState` | 補間、キー区間の再生、アクション、状態遷移を扱う |
| 入力・UI | `InputController`, `Touch`, `OverlayPanel`, `CommandPalette` | キーボード、Pointer Events、ジェスチャー、操作画面を扱う |
| 物理 | `PhysicsSpace`, `PhysicsNode`, Collider系 | 重力、衝突判定、物理挙動を扱う |
| サウンド | `AudioSynth`, `ToneSynth`, `GameAudioSynth` | Web Audio APIを使う音声処理を扱う |
| 診断・計測 | `Diagnostics`, `DebugDock`, `DebugProbe`, `FrameTimer` | 状態確認、エラー表示、CPU・GPU時間の計測を行う |

通常のアプリケーションは`WebgApp`から始め、必要な機能だけを下位のAPIから選びます。
Compute Shaderを利用できるという理由だけで、標準フォワード描画を`ComputeEffectPipeline`へ置き換える必要はありません。

## リポジトリ構成

```text
webg/
  book/            version 2の技術解説
    examples/      各章の1ファイル実行例
  headless_tests/  画面操作を必要としない自動テスト
  samples/         機能別サンプルアプリケーション
  tools/           補助ツール
  unittest/        ブラウザで確認する小規模な検証アプリ
  webg/            ライブラリ本体
```

## 導入手順

### 1. リポジトリを取得する

```bash
git clone https://github.com/jun-mizutani/webg.git
cd webg
```

`webg`はnpmパッケージへ依存せず、リポジトリのディレクトリ構成を保って利用します。
ES Modulesの相対importと、`fetch()`によるアセット読み込みを使用するため、必要なファイルだけを無関係な位置へ移動しないでください。

### 2. ローカルHTTPサーバーを起動する

WebGPU、ES Modules、アセット読み込みを正しく動作させるため、`file://`ではなくHTTPサーバー経由で開きます。

Python 3を利用する場合:

```bash
python3 -m http.server 8000
```

Node.jsを利用する場合:

```bash
npx http-server . -p 8000
```

### 3. サンプル一覧を開く

```text
http://localhost:8000/samples/index.html
```

## 基本的な使い方

### 標準フォワード描画から始める

初めて使う場合は、`WebgApp`の標準フレームから始めます。
GPU初期化の完了後にShapeとNodeを作り、`onUpdate`でアプリケーション状態を更新します。

```js
import WebgApp from "./webg/WebgApp.js";
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";

const app = new WebgApp({
  document,
  clearColor: [0.1, 0.15, 0.1, 1.0]
});

await app.init();

const shape = new Shape(app.getGPU());
shape.applyPrimitiveAsset(
  Primitive.cube(2.0, shape.getPrimitiveOptions())
);
shape.endShape();
shape.setMaterial("smooth-shader", {
  color: [1.0, 0.5, 0.3, 1.0]
});

const node = app.space.addNode(null, "cube");
node.addShape(shape);

app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0
});

app.start({
  onUpdate: () => {
    node.rotateY(0.8);
  }
});
```

完全なHTMLとエラー表示を含む実装は`samples/high_level`を参照してください。

### ComputeEffectPipelineを使う

G-bufferと複数の画面効果が必要な場合は、`ComputeEffectPipeline`を初期化し、同じ`cameraFrame`をシーン描画と後段処理へ渡します。
最終テクスチャは`beginPresentPass()`でCanvasへ表示し、その後にHUD用の深度付きパスへ戻します。

```js
const pipeline = new ComputeEffectPipeline(gpu, {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});

const copyPass = new FullscreenPass(gpu);
await Promise.all([pipeline.ready, copyPass.init()]);

app.start({
  onUpdate: ({ screen }) => {
    pipeline.resize(screen.getWidth(), screen.getHeight());
  },

  onBeforeDraw: ({ cameraFrame }) => {
    pipeline.renderScene(
      app.space,
      cameraFrame,
      app.clearColor
    );
  },

  onAfterDraw3d: ({ cameraFrame }) => {
    gpu.endPass();

    const finalColor = pipeline.encode(gpu.commandEncoder, {
      cameraFrame,
      ssaoEnabled: true,
      bloomEnabled: true
    });

    app.screen.beginPresentPass({
      clearColor: app.clearColor,
      colorLoadOp: "clear"
    });
    copyPass.draw(finalColor);
    app.screen.clearDepthBuffer();
  }
});
```

この例は接続順序だけを示しています。
材質、ライト、各効果の設定、診断、GPU計測、破棄まで含む実装は`samples/compute_effect`を参照してください。

### GPU計算先行方式を使う

GPU状態を更新してから描画する場合は、`computeFrame: true`を指定し、`onComputeFrame`へ一フレーム分の記録と送信を集めます。

```js
const app = new WebgApp({
  document,
  computeFrame: true
});

await app.init();

app.start({
  onComputeFrame: ({ cameraFrame, deltaSec }) => {
    const gpu = app.getGPU();
    const encoder = gpu.device.createCommandEncoder();

    simulation.encode(encoder, resources, { deltaSec });
    renderer.encode(encoder, cameraFrame);

    gpu.queue.submit([encoder.finish()]);
  }
});
```

具体的なGPU粒子、布、物理、テクスチャ生成は、`samples/compute_particles`、`samples/compute_cloth`、`samples/compute_physics_bounce`、`samples/compute_texture`を参照してください。

## 推奨する確認順序

最初にすべてのCompute機能を読む必要はありません。
作りたいアプリケーションに近い経路から確認してください。

1. `samples/low_level`
   WebGPUのRender Pipeline、Buffer、WGSL、描画送信の最小構成を確認します。

2. `samples/high_level`
   `WebgApp`、`Space`、`Shape`、EyeRigを使う標準フォワード描画を確認します。

3. `samples/materials`と`samples/opacity`
   マテリアル値、複数マテリアル、三角形単位の材質番号、半透明の自動合成を確認します。

4. `samples/compute_deferred_lighting`
   G-bufferと遅延ライティングの基本的な接続を確認します。

5. `samples/compute_effect`
   SSAO、シャドウ、SSR、半透明、フォグ、トゥーン、DoF、Bloom、トーンマッピング、輪郭、ビネットの統合順序を確認します。

6. `samples/compute_bloom`と`samples/compute_dof`
   画像Pyramidを使うBloomと、geometry coverageおよびCoCを分けるDoFを個別に確認します。

7. `samples/compute_particles`、`samples/compute_cloth`、`samples/compute_texture`
   GPU計算先行方式でCompute PassとRender Passを同じフレームへ記録する方法を確認します。

8. `samples/compute_benchmark`
   各Compute処理のGPU時間、設定値、解像度、画像Pyramidの段階を比較します。

9. `samples/maze2`
   遅延ライティング、複数ローカルライト、SSR、Bloomなどを実際のアプリケーション規模で確認します。

## ドキュメント

`book/`はversion 2の設計と使い方を章立てで説明します。
初めて読む場合は、実行環境、WebGPUの最小描画、`WebgApp`、カメラ、Shape、マテリアルまでを先に確認し、その後に目的に応じてCompute Shaderと高度な表現の章へ進んでください。

特に次の文書がversion 2の入口になります。

- [`book/付録A_コーディングAIの皆さまへ.md`](book/付録A_コーディングAIの皆さまへ.md)
  人間またはAIが、目的に応じて書籍、サンプル、テスト、コア実装を選ぶための参照方針を説明します。
- [`book/付録B_webg_1.0から2.0への移行.md`](book/付録B_webg_1.0から2.0への移行.md)
  version 1のアプリケーションを移行するときの差分、注意点、確認順序を説明します。
- [`book/付録C_API一覧.md`](book/付録C_API一覧.md)
  version 2の公開クラスと主要メソッドを機能別に確認できます。
- [`book/27_コンピュートシェーダーの基礎.md`](book/27_コンピュートシェーダーの基礎.md)
  Compute Pipeline、ストレージリソース、深度規則、CameraFrame、GPU計算先行方式を説明します。
- [`book/28_コンピュートパスによる高度な表現.md`](book/28_コンピュートパスによる高度な表現.md)
  SSAO、シャドウ、遅延照明、SSR、GPU粒子、DoF、Bloomなどの各処理を説明します。
- [`book/29_リアルタイム3D表現の統合.md`](book/29_リアルタイム3D表現の統合.md)
  各処理を`ComputeEffectPipeline`へ接続する順序、色形式、リサイズ、破棄を説明します。

現行APIの設定値、既定値、例外条件は、READMEの短い例ではなく書籍本文、付録C、該当サンプル、現行実装を正本としてください。

## サンプルとテスト

`samples/`には、機能の使い方を実際のアプリケーションとして確認する参照実装があります。
各サンプルのREADME、説明ページ、`.txt`、実行HTMLを実装と合わせて参照してください。

`headless_tests/`は、引数検証、深度規則、色形式、GPUリソースの生成と破棄など、画面操作を必要としない条件を自動確認します。
全体を確認する場合は次を実行します。

```bash
node headless_tests/run_all.js
```

`unittest/`は、ブラウザで表示と操作を確認する小規模な検証アプリを収録します。
最終的な確認では、headless testだけでなく、対象に対応するunittestとsampleの実画面も確認してください。

## AI支援開発での利用

コーディングAIへwebg version 2を使った実装や調査を依頼する場合は、最初に`book/付録A_コーディングAIの皆さまへ.md`を参照させてください。
そのうえで、目的に対応する書籍の章、サンプル、headless test、unittest、現行`webg/*.js`を指定すると、一般的なWebGPUエンジンの推測とwebg固有のAPIを混同しにくくなります。

## 対応環境

`webg`はWebGPUと、使用する機能に必要なWebGPU APIへ対応したモダンブラウザを前提とします。

- Google Chrome
- Microsoft Edge
- Firefox
- Safari

WebGPUの実装、OS、GPU、ドライバによって、利用できる機能、性能、Canvas表示の挙動が異なる場合があります。
Compute Shaderを使うサンプルでは、ブラウザの開発者ツールに加えて、画面内のDiagnostics、DebugDock、GPU計測結果も確認してください。

問題が発生した場合は、次を順番に確認します。

- `file://`ではなくHTTPサーバー経由で開いているか
- ブラウザとGPUドライバがWebGPUへ対応しているか
- 開発者ツールにWebGPU validation errorや初期化エラーが出ていないか
- Render Pipelineと描画先の色形式、深度形式、深度規則が一致しているか
- 深度依存処理へ同じ`cameraFrame`を渡しているか
- Canvasの実ピクセル変更時に、処理を保持するクラスの`resize()`を呼んでいるか
- 終了時に、GPUリソースを保持するクラスの`destroy()`を一度だけ呼んでいるか

ブラウザ、HTTPサーバー、キャッシュを含む実行環境の詳しい確認方法は、[第2章「インストールと実行環境」](book/02_インストールと実行環境.md)を参照してください。

## ライセンス

MIT License

## 著者

- Author: Jun Mizutani
- Website: https://www.mztn.org/
