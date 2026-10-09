# PBR統合の基本実装

31章で確認した処理順を、`WebgApp`の初期化とフレーム更新へ接続します。まず実行例で完成画面を確認し、最小の実行順、初期化、カメラ情報を渡す更新処理を続けて読みます。その後で材質と個別の効果を調整します。

## この章の読み方

### この章を読む前に必要な知識

31章の統合方針と05章のWebgAppコールバックを知っていると読みやすくなります。

### 初回に読む範囲

基準シーン、最小の実行順、初期化、同じcameraFrameを渡すフレーム処理を先に読んでください。コードは段階を分けた部分例です。一つのHTMLで実行する全体例は`examples/32_01.html`です。

### 必要になったときに読む範囲

G-buffer（照明計算へ渡す画面単位の表面情報）、透明、フォグ、トゥーン、DoF（Depth of Field：被写界深度）、ブルーム、トーンマッピングは効果追加時に参照してください。

### この章を終えた時点でできること

物理ベースレンダリング（PBR）統合をWebgAppへ接続し、複数の画面効果を決められた順番で実行できます。

## 基準シーンとの比較で効果の役割を見分ける

まず[標準描画の例](examples/31_01.html)と[PBR統合の例](examples/32_01.html)を開き、同じ位置の床、壁、球を見比べます。

同じジオメトリをフォワードレンダリング経路と遅延レンダリング経路で比較すると、モデルやカメラの違いに惑わされず、SSAO、シャドウ、SSR、遅延照明が追加する情報を見分けられます。
`examples/31_01.html`は、標準の`WebgApp`と`SmoothShader`を使うフォワードレンダリング経路だけで床、壁、立方体、球、柱を描きます。
この例では`WebgApp`がカメラ用Reverse-Z、カメラ相対モデルビュー、フレーム状態を内部で管理し、利用者は`CameraFrame`、`renderFrameToken`、深度規約の接続をWebgApp側へ委ねます。

`examples/32_01.html`は同じジオメトリ配置を`ComputeEffectPipeline`で描きます。
比較する対象を描画方式に限定することで、SSAOの接地感、シャドウの直接光遮蔽、SSRの反射、遅延ライティングのマテリアル差を確認できます。

### 二つのレンダリング経路を入口で選ぶ

描画経路は、必要な効果に合わせてアプリケーションの入口で選びます。
単純な画面をフォワードレンダリング経路のまま保てば構成とリソースを小さくでき、G-bufferを共有する効果が必要な画面だけを遅延レンダリング経路の統合パイプラインへ移せます。
`ComputeEffectPipeline`は、選択した効果を統合する遅延レンダリング経路です。フォワードレンダリングへ切り替える場合は、アプリケーションの入口で標準の`WebgApp`描画を選びます。
`renderScene()`は常にG-bufferを生成し、`encode()`は影とAOの可視率、遅延照明、選択された後段効果を同じ処理順序と入出力仕様で接続します。
効果の有効・無効の切り替えで描画方式まで切り替えないことで、同じマテリアルがフレームごとに異なる照明経路へ入るのを防ぎます。

色だけを処理する画面は、最初から標準の`WebgApp`と`SmoothShader`を使うフォワードレンダリング経路で構成します。
ブルームや色の境界のみを独自に追加したい場合は、23〜25章と34〜36章のオフスクリーンターゲットと個別パスを使います。
逆に、SSAO、シャドウ、SSR、遅延照明を共有する画面は遅延レンダリング経路の統合パイプラインを選びます。
描画経路は、初期化時にアプリケーションの描画設計として選びます。

## 最小の実行順を先に確認する

統合パイプラインを使う最小の処理順は次のとおりです。後続の初期化例とフレーム処理例は、この一続きの処理を分けて詳しく示します。

```text
await app.init()
  -> ComputeEffectPipelineと最終表示用passを作る
  -> pipeline.readyと表示用passの初期化を待つ
  -> app.start()
       onBeforeDraw:
         pipeline.renderScene()でG-bufferを作る
       onAfterDraw3d:
         gpu.endPass()
         pipeline.encode()で照明と画面効果を記録する
         beginPresentPass()で最終表示passを開始する
         最終テクスチャをCanvasへ描く
         clearDepthBuffer()で次フレームへ備える
```

`renderScene()`と`encode()`には、同じフレームの`cameraFrame`を渡します。`encode()`が返す最終テクスチャをCanvasへ描く処理まで接続すると、パイプラインの結果が画面へ表示されます。

## シーンを描画する処理を初期化時に一つへ決める

初期化では、フォワードレンダリング経路の標準自動描画と遅延レンダリング経路の統合パイプラインが、同じシーンを二重に描かないよう、どちらがシーンを描画するかを一つに決めます。
統合パイプラインへ任せる場合は`autoDrawScene: false`を指定することで、G-buffer生成の前後へフォワードレンダリング経路による独自描画が混入せず、リソースの寿命とフレーム順序もパイプライン側へ集約できます。
画角、`near`、`far`は通常どおり`WebgApp`へ設定し、投影情報を共有して各パスへ渡します。

```js
import WebgApp from "./webg/WebgApp.js";
import ComputeEffectPipeline from "./webg/ComputeEffectPipeline.js";
import FullscreenPass from "./webg/FullscreenPass.js";

const app = new WebgApp({
  document,
  autoDrawScene: false,
  clearColor: [0.045, 0.065, 0.09, 1.0],
  viewAngle: 52,
  projectionNear: 0.1,
  projectionFar: 120,
  camera: {
    target: [0, -0.7, -4.0],
    distance: 27,
    yaw: 24,
    pitch: -13
  }
});
await app.init();

const gpu = app.getGPU();
const pipeline = new ComputeEffectPipeline(gpu, {
  width: app.screen.getWidth(),
  height: app.screen.getHeight(),
  lighting: {
    ambient: 0.10,
    directionalIntensity: 1.0
  },
  composer: {
    mode: "mix"
  },
  fog: {
    enabled: false,
    mode: "linear",
    color: [0.10, 0.15, 0.20],
    near: 20,
    far: 80,
    density: 0.03
  },
  toneMap: {
    mode: "reinhard",
    exposure: 1.0,
    saturation: 1.0,
    gamma: 2.2
  },
  vignette: {
    enabled: false,
    center: [0.5, 0.5],
    radius: 0.9,
    softness: 0.35,
    strength: 0.65,
    tint: [0.0, 0.0, 0.0]
  }
});

const copyPass = new FullscreenPass(gpu);
await Promise.all([pipeline.ready, copyPass.init()]);
```

`ComputeEffectPipeline`は内部で各パスを生成し、各パスが作るG-buffer、シャドウマップ、可視率、遅延ライティング、フォグを含むHDR効果、トーンマッピング、ビネットを含む表示色効果の描画先をまとめて管理します。
`ComputeEffectPipeline`が各効果に対応する`RenderTarget`を生成し、サイズ変更と破棄までまとめて管理します。

フォグとビネットは、既存アプリケーションの表示を変えないよう既定では無効です。
上の初期化例は、環境マップを使わず固定環境光で接続を最小化した例です。IBLとPBR向けSSRを含む標準構成は、前節の環境設定と`examples/33_01.html`を使います。33_01は外部HDR画像を必要とせず一つのHTMLから実行できるよう、radiance、irradiance、prefiltered specular、BRDF LUTを備えた小型の手続き環境データを使います。実写HDRを使う場合も、`PbrEnvironment`から先の接続方法は同じです。
コンストラクターの`fog.enabled`と`vignette.enabled`はパイプラインの初期設定になり、フレームごとの`encode()`オプションで上書きできます。
`ComputeFogPass`と`ComputeVignettePass`の描画先は、効果が無効な間もパイプラインが保持します。無効なフレームでは各パスの`encode()`をスキップし、描画先を再生成せずに余分な全画面ディスパッチを抑えます。

## 同じカメラフレームで描画と位置復元を一致

同じカメラフレームは、G-bufferを描いた視点と、その深度から位置を復元する視点を一致させるために共有します。
これにより、カメラ移動中もAO、影、反射がジオメトリからずれず、`near`、`far`、投影行列は共有された`cameraFrame`から各パスへ渡ります。
統合処理で最も重要な条件は、`renderScene()`と`encode()`へ同じ`cameraFrame`オブジェクトを渡すことです。

```js
app.start({
  onUpdate: ({ screen }) => {
    pipeline.resize(screen.getWidth(), screen.getHeight());
  },

  onBeforeDraw: ({ cameraFrame }) => {
    pipeline.renderScene(
      app.space,
      cameraFrame,
      app.clearColor,
      {
        shadowEnabled: true
      }
    );
  },

  onAfterDraw3d: ({ cameraFrame }) => {
    gpu.endPass();

    const finalColor = pipeline.encode(gpu.commandEncoder, {
      cameraFrame,
      ssaoEnabled: true,
      shadowEnabled: true,
      ssrEnabled: true,
      fogEnabled: false,
      toonEnabled: false,
      dofEnabled: false,
      bloomEnabled: false,
      edgeEnabled: false,
      vignetteEnabled: false
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

`cameraFrame`は、カメラのワールド位置を倍精度差分へ使う情報、カメラ相対モデルビューを作る機能、Reverse-Z投影、near、far、画角、アスペクト比を同じスナップショットとして保持します。
`renderScene()`はこのフレームでG-bufferを作り、`encode()`は同じフレームで深度から位置を復元します。
別オブジェクトや別フレームのフレームを渡すと例外で停止し、古いカメラ状態の混入を防ぎます。

フォグを有効にすると、`encode()`はこの`cameraFrame`と不透明G-buffer深度から距離を復元します。
ビネットは深度を読まないためカメラフレームを個別には使いませんが、同じ`encode()`の後段で処理され、完成した表示色を返します。
効果ごとのカメラ情報は共有された`cameraFrame`から取得し、ビネットは深度を使わず完成色を処理します。

### 描画情報に応じてトークンを使い分ける

`renderFrameToken`と`cameraFrame`は、利用側が共有する描画情報の範囲に応じて使い分けます。
位置復元に必要な情報だけを遅延レンダリング経路へ渡し、通常のフォワードレンダリング経路は単純なまま保ちます。

通常サンプルへ公開される`renderFrameToken`は、レンダーシェーダー版DoFのように、利用者がオフスクリーンシーン、`Space.draw()`、深度依存パスを手動接続するときの同一性証明です。
`renderFrameToken`は中身を持たないopaqueトークンとしてフレームの同一性を示し、カメラの投影と姿勢は`cameraFrame`が保持します。

`ComputeEffectPipeline`はG-bufferの生成から後段処理までを管理し、カメラ情報の整合性を完全に検証するため、コールバックの`cameraFrame`を使用します。
深度と投影を共有する一連の処理を、どのオブジェクトが管理するかに応じて、カメラフレームとトークンの入口を選びます。

| 描画構成 | 利用側が渡すもの |
| --- | --- |
| 標準の単一パス | 何も追加しない |
| 低水準のフォワードレンダリング経路 | `Space.draw(eye)` |
| レンダーシェーダー版DoFの手動接続 | 同じ`renderFrameToken` |
| `ComputeEffectPipeline` | 同じ`cameraFrame` |

トークンやフレームは、`onUpdate`から描画コールバックへ渡し、そのコールバックの実行中だけ共有します。次のフレームや非同期処理へ持ち越す場合は、新しいフレームを取得します。

## 完全なG-bufferマテリアルで照明結果を安定させる

G-buffer用マテリアルは、基本色と反射特性を照明前の情報として保存し、遅延ライティングやSSRがShapeごとの表面を一貫して評価するために使います。
必要な値を完全に指定すると、照明経路を切り替えてもマテリアルの意味が変わらず、入力漏れをプロパティ名付きの例外として確認できます。
統合パイプラインは照明前のbase colorと表面マテリアルを使うため、Shapeには`specular`、`roughness`、`metallic`、`occlusion`を明示します。発光は`emissive_factor`と任意の`emissive_texture`で独立したHDR色として指定し、従来のscalar `emissive`を使う場合は発光表現の入口を一つにそろえます。

```js
function createPrimitiveShape(gpu, primitiveFactory, material) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(
    primitiveFactory(shape.getPrimitiveOptions())
  );
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    ambient: 0.0,
    occlusion: 1.0,
    emissive_factor: [0.0, 0.0, 0.0],
    ...material
  });
  return shape;
}

const sphere = createPrimitiveShape(
  app.getGPU(),
  (options) => Primitive.sphere(2.2, 32, 22, options),
  {
    color: [0.12, 0.62, 0.88, 1.0],
    specular: 0.72,
    roughness: 0.20,
    metallic: 0.12,
    power: 58.0
  }
);
```

値が省略されていると、`GeometryBufferPass`は`util.readFiniteNumber()`による検証で停止します。
これは見た目を仮のマテリアルで続行するより、入力漏れをShapeの名前とプロパティで特定できる方が安全だからです。
`color`のアルファをSSR反射率として兼用せず、反射特性を表面マテリアルへ分けます。

## 半透明をマテリアルから自動統合する

`ComputeEffectPipeline`を使う場合は、透明用のレンダーパスをパイプラインが接続します。`Shape`の各マテリアルスロットに設定した`alpha_mode`を優先して、不透明三角形、Alpha Mask三角形、半透明三角形を分類します。
`OPAQUE`と`MASK`はG-bufferと不透明深度へ書き、`MASK`は`alpha_cutoff`未満のfragmentを破棄します。`BLEND`はG-bufferから除外します。
`alpha_mode`を省略したマテリアルでは、`alpha === 1.0`を`OPAQUE`、1.0未満を`BLEND`として扱います。

半透明三角形は同一`Shape`内を含む全`Shape`から集め、カメラフレームのビュー空間へ移した三角形の重心Zで奥から手前へ並べます。
描画時は不透明深度を読み込み、深度テスト専用の読み取りとして透明面の前後関係を判定します。透明面の深度値は維持されます。
色はsource-over方式のアルファ合成で重ねます。

すりガラス表現では、透明合成前の不透明HDRシーンから1/2、1/4、1/8の画像ピラミッドを作ります。
各段階は、一つ前の画像を連続したローパスフィルターで縮小した背景色です。
半透明面へマテリアルの`roughness`を描いたマスクを使い、鮮明な元のシーンと隣接する二つの段階を補間します。
`roughness`が小さい面では元のシーンに近い背景を保ち、値が大きいほど低い解像度の段階を使うため、背景ぼけが連続的に強くなります。

この背景合成は背景色と`roughness`で行い、表面色と鏡面反射へ`alpha`を適用する段階と分けます。そのため、薄い色のガラスでも`roughness`による背景ぼけを保てます。

```js
glassShape.setMaterial("smooth-shader", {
  color: [0.95, 0.78, 0.18, 1.0],
  alpha: 0.42,
  specular: 1.0,
  roughness: 0.18,
  metallic: 0.0,
  occlusion: 1.0,
  emissive_factor: [0.0, 0.0, 0.0],
  power: 128
});
```

`roughness`が小さい面では透過背景が鮮明で、GGX鏡面反射は狭く鋭くなります。値が大きい面では背景ぼけが強く、鏡面反射も広がります。透明物の前方描画は不透明物の遅延描画と同じ`PbrBrdf.js`を使い、直接光、局所光、シャドウ、IBLを同じマテリアル値で評価します。`alpha_mode`を`OPAQUE`へ変更すると次のフレームから不透明なPBR遅延描画へ移ります。`alpha_mode`を省略したマテリアルでは、`alpha`を1.0にすると同じ切り替えになりますが、表面自身の双方向反射率分布関数（Bidirectional Reflectance Distribution Function：BRDF）は共有されます。

透明三角形が存在しないフレームでは、`TransparencyPass`のぼかし、マスク、表面描画を省略します。
存在する場合の追加負荷は、3段階の画像ピラミッド生成、粗さのマスク描画、背景合成、透明三角形ごとの描画呼び出しです。
三角形同士の交差や循環順序には、奥行き順のAlpha合成を適用します。Weighted Blended OIT（Order-Independent Transparency、順序非依存半透明合成）は別の拡張方式として扱います。
多層の透明面を一枚ずつ再びぼかす処理も対象外です。
Alpha合成は`samples/opacity`、背景屈折と体積吸収は`samples/transmission`、PBR全体は`examples/33_01.html`で確認できます。

## 効果の状態を一箇所に集めて安全に切り替える

効果の状態を一つのオブジェクトへ集めると、利用者向け操作画面（UI：User Interface）の操作やプリセット変更の結果を同じフレームの`renderScene()`と`encode()`へ一貫して渡せます。
効果ごとに分散した変数を読む構成より、シャドウの種類や有効状態がフレーム前半と後半で食い違うのを防ぎやすく、現在の描画条件も保存・比較しやすくなります。
効果を実行時に切り替える場合は、状態を`encode()`へ明示的に渡します。

```js
const state = {
  ssaoEnabled: true,
  shadowEnabled: true,
  ssrEnabled: true,
  fogEnabled: false,
  toonEnabled: false,
  dofEnabled: false,
  bloomEnabled: false,
  edgeEnabled: false,
  vignetteEnabled: false,
  fogMode: "linear",
  fogColor: [0.10, 0.15, 0.20],
  fogNear: 20.0,
  fogFar: 80.0,
  fogDensity: 0.03,
  vignetteCenter: [0.5, 0.5],
  vignetteRadius: 0.9,
  vignetteSoftness: 0.35,
  vignetteStrength: 0.65,
  vignetteTint: [0.0, 0.0, 0.0],
  composerMode: "mix",
  toneMode: "reinhard",
  exposure: 1.0,
  saturation: 1.0,
  gamma: 2.2
};

const finalColor = pipeline.encode(gpu.commandEncoder, {
  cameraFrame,
  ssaoEnabled: state.ssaoEnabled,
  shadowEnabled: state.shadowEnabled,
  ssrEnabled: state.ssrEnabled,
  fogEnabled: state.fogEnabled,
  toonEnabled: state.toonEnabled,
  dofEnabled: state.dofEnabled,
  bloomEnabled: state.bloomEnabled,
  edgeEnabled: state.edgeEnabled,
  vignetteEnabled: state.vignetteEnabled,
  fog: {
    mode: state.fogMode,
    color: state.fogColor,
    near: state.fogNear,
    far: state.fogFar,
    density: state.fogDensity
  },
  vignette: {
    center: state.vignetteCenter,
    radius: state.vignetteRadius,
    softness: state.vignetteSoftness,
    strength: state.vignetteStrength,
    tint: state.vignetteTint
  },
  composer: {
    mode: state.composerMode
  },
  toneMap: {
    mode: state.toneMode,
    exposure: state.exposure,
    saturation: state.saturation,
    gamma: state.gamma
  }
});
```

シャドウはG-buffer前のシャドウマップ生成にも関係するため、`renderScene()`と`encode()`の`shadowEnabled`を一致させます。
方向光とスポットライトの種類も、同じフレームの両段階で一致させます。
統合パイプラインはこの不整合を検出して停止します。

SSAO、SSR、フォグ、DoF、ブルーム、ビネットなどを無効にしたフレームでも、生成済みのGPUリソースを保持して再利用します。フレームの実行経路から各効果を外すだけなので、操作中の有効・無効の切り替えで描画先の再生成を待たずに済みます。

フォグは`fogEnabled`または`fog.enabled`、ビネットは`vignetteEnabled`または`vignette.enabled`で有効化できます。
両方を同時に指定した場合は、上位の`fogEnabled`と`vignetteEnabled`がそのフレームの有効状態になります。
各効果の詳細設定は`fog`と`vignette`の入れ子へまとめます。
有効状態と数値設定を同じ状態オブジェクトから作ると、操作画面で一部だけ古い値が残ることを防げます。

### 透明合成後のフォグを一つのパスへ集約する

統合パイプラインのフォグは、遅延ライティングとSSRの合成後、さらに`TransparencyPass`が半透明三角形を合成した後に実行されます。
入力と出力はどちらも`rgba16float`です。
これにより、フォグの後段にあるトゥーン、DoF、ブルーム、トーンマッピングが、不透明面、反射、半透明面、フォグを含む一つのHDRシーンを処理できます。

距離にはG-bufferの不透明深度だけを使います。
半透明面はG-bufferへ入らず、透明描画でも深度を書き換えないため、ガラス越しの画素では背後の不透明面までの距離をフォグへ使います。
背後にも不透明面がなくReverse-Z深度が背景値0のときは、距離を推測せず、透明合成済みの色をそのまま残します。
この処理は、一枚の不透明深度を使う全画面の近似です。多層の透明物を扱う場合は、この奥行きの使い方に合わせて見え方を確認します。

`mode: "linear"`では`near`から`far`までの距離範囲でフォグを増やし、`mode: "exp"`では`density`と距離から指数的な可視率を求めます。
`far`は`near`より大きくする必要があります。
設定値の意味と既定値は34〜36章の`ComputeFogPass`の節で説明したとおりであり、統合パイプラインも同じパス実装と検証を使います。

フォワードレンダリング経路から遅延レンダリングへ移すときは、フォグの設定値を`fog`へ移し、`ComputeEffectPipeline`だけが統合シーンのフォグを担当する構成にします。
フォワード描画のフォグと全画面フォグを同じシーンへ適用すると、距離減衰が二重になり、半透明面と不透明面で処理の責任も分かれてしまいます。

### ビネットを最終表示の直前へ集約する

統合パイプラインのビネットは、トーンマッピングと任意の輪郭抽出が終わった`rgba8unorm`表示色へ適用されます。
出力は`encode()`が返す最終テクスチャです。
利用側はこのテクスチャを`beginPresentPass()`でキャンバスへ転送し、その後に`clearDepthBuffer()`でHUD用の深度付きパスへ戻ります。

この配置では、ビネットは3Dシーン全体と輪郭抽出の結果へ作用し、後から描く`Font`やHUDは読みやすい明るさで表示します。
HUDも暗くしたい特殊な演出では、HUDまでを別の画面外画像へ合成する設計が必要です。
標準の`ComputeEffectPipeline`は、操作表示の可読性を保つため、HUDをビネットの対象外として最後に描画します。

ビネットの入力は完成色と画面サイズです。深度やカメラフレームを使う効果とは入力を分けます。
`center`、`radius`、`softness`、`strength`、`tint`だけで表示色の周辺を調整し、画面のアスペクト比はパス内部で補正します。
アプリケーションがすでに独自のビネットを最終表示の直前へ接続している場合は、設定をパイプラインへ移して独自パスを外すか、パイプライン側を無効にし、適用箇所を一つにします。

### 役割の順に調整して原因を混ぜない

調整順序を固定すると、照明、遮蔽、反射、表示変換のどこで外観が変わったかを比較でき、別の効果のパラメーターで問題を隠すのを避けられます。
パラメータを一つずつ変えると、照明、反射、トーンマッピングのどこで白く見えるかを区別できます。
まず遅延ライティングだけで基本色と明るさを決め、次に可視率、反射、焦点、光のにじみ、表示変換の順に効果を追加します。

1. `lighting.ambient`と光源強度で、SSAOとシャドウを切った基準画像を作ります。
2. シャドウを有効にし、光の方向、投影範囲、`bias`、`normalBias`を調整します。
3. SSAOを有効にし、接地部と隙間だけが補助的に暗くなるよう`radius`と`strength`を決めます。
4. SSRを有効にし、反射マテリアルの`specular`と`roughness`を確認してから、`intensity`、`distance`、`thickness`を調整します。
5. 半透明を含むシーンでフォグを有効にし、`mode`、`color`、距離範囲または
   `density`を調整します。不透明深度だけを使う近似で十分かも確認します。
6. 必要な画面だけトゥーン、DoF、ブルームを追加します。各効果の結果がHDRで残っている段階で調べます。
7. トーンマッピングの`exposure`、`saturation`、`gamma`を決め、必要なら輪郭抽出を重ねます。
8. 最後にビネットの中心、半径、移行幅、強度、周辺色を決め、
   HUDの可読性を確認します。

この順序にすると、トーンマッピングの`exposure`で照明強度の問題を隠したり、SSAOの`strength`でシャドウの投影範囲不足を補ったりする調整を避けられます。
効果を無効化したときにも基準シーンが保たれることが大切です。

## まとめ

`ComputeEffectPipeline`を使うと、PBR照明と画面効果を、同じ`cameraFrame`、同じ深度規則、同じ色形式で接続できます。最初に基準シーンを表示し、効果を一つずつ追加して各段階の入力と出力を確認すると、設定値の問題と処理順の問題を分けて調べられます。
運用時のカメラ相対座標、リソース、診断、負荷調整は続く33章で扱います。
