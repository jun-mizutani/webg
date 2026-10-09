# DoF、画風、GPUパーティクル

## この章の読み方

### この章を読む前に必要な知識

34章の画像処理、35章の照明・フォグ、22章のGPUデータ交換を知っていると読みやすくなります。

### 初回に読む範囲

DoF（Depth of Field：被写界深度）、トゥーン、輪郭抽出、ビネット、HDR（High Dynamic Range：広い輝度範囲）効果の順序を先に読んでください。

### 必要になったときに読む範囲

GPU（Graphics Processing Unit：画像処理装置）パーティクル、共有バッファ、リサイズ、診断、中間結果は大量要素を扱うときに参照してください。

### この章を終えた時点でできること

奥行き表現、画風、周辺調整、GPU上の粒子更新を一つの処理フローへ組み込めます。

## DoFで焦点と奥行きを伝える

DoF（Depth of Field、被写界深度）は、焦点を合わせた距離を鮮明に保ち、その手前と奥をぼかすことで、注目させたい対象とシーンの奥行きを伝えるために使います。
すでに描いたHDRシーンとカメラ用Reverse-Z深度を使うため、距離ごとにシーンを描き分けずに焦点表現を追加でき、焦点距離をフレームごとに変える演出にも対応できます。

`ComputeDofPass`は深度からカメラまでの距離を復元し、焦点面との差を錯乱円（Circle of Confusion：CoC）の段階へ変換します。
シーン色、近景、遠景、CoCの補助情報の4系統について、1/2、1/4、1/8、1/16の画像ピラミッドを作ります。
合焦範囲を外れた形状は、距離に応じて隣接する低周波の段階を選び、鮮明な元画像を残さず置き換えます。

近景と遠景は、アルファ乗算済みの色と形状の被覆率へ分離します。
遠景のぼけは焦点面や近景の後ろへ置き、近景のぼけは焦点面、遠景、背景の手前へ重ねます。
CoCの補助情報を被覆率と別に保持するため、物体の輪郭外へぼけを広げながら、どの段階を選ぶかを独立して制御できます。

```js
import ComputeDofPass from "./webg/ComputeDofPass.js";

const dofPass = new ComputeDofPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await dofPass.ready;

const focusedColor = dofPass.encode(
  app.getGPU().commandEncoder,
  {
    scene: hdrScene,
    depth: gbufferResources.depth
  },
  {
    cameraFrame,
    focusDistance: 36.0,
    focusRange: 7.0,
    cocScale: 1.0,
    debugView: "composite",
    sharpnessWidth: 0.15,
    sharpnessPower: 1.0,
    blurRadius: 1.0,
    enabled: true
  }
);
```

この例は`COMPUTE_DOF_DEFAULTS`と同じ値です。
各設定の意味は次のとおりです。

- `focusDistance`の既定値は`36.0`です。カメラから合焦面までの
  ビュー空間での距離で、0より大きい値を指定します。
- `focusRange`の既定値は`7.0`です。焦点面の近くを鮮明に保つ幅と、
  画像ピラミッドの段階が一つ進む距離の基準になります。0より大きい値を
  指定します。
- `blurRadius`の既定値は`1.0`です。画像ピラミッドの各段階を作る
  13点ローパスフィルターのサンプル間隔です。範囲は0.25から3.0で、
  大きくすると同じ段階でもぼけが広がります。
- `cocScale`の既定値は`1.0`です。焦点面との差から求めたCoCを
  拡大または縮小します。範囲は0.0から2.0で、大きくすると同じ
  距離差でも低い解像度の段階へ早く進みます。
- `sharpnessWidth`の既定値は`0.15`です。合焦帯から最初の低周波
  段階へ移る境界幅を指定します。範囲は0.0から0.95です。
- `sharpnessPower`の既定値は`1.0`です。隣接する低周波の段階間の
  補間カーブを調整します。0より大きい値を指定します。
- `debugView`の既定値は`"composite"`です。`"depth"`では復元距離、
  `"focus"`では合焦状態、`"composite"`では完成色を出力します。
- `enabled`の既定値は`true`です。DoF合成を有効にします。

### EyeRigとCompute DoFを連動させる

上の例は、`ComputeDofPass`を低レベルに直接呼び出す構成です。
この場合、`focusDistance`は呼び出し側が数値で指定します。
一方、通常のアプリケーションでは、カメラのズームや回転、対象Nodeの移動に合焦面も追従させる方が自然です。
そのため、`EyeRig`で合焦対象を指定し、`ComputeEffectPipeline`の`focusSource`を`"camera"`に設定できます。

```js
import ComputeEffectPipeline from "./webg/ComputeEffectPipeline.js";

const orbit = app.createOrbitEyeRig({
  target: [0.0, 1.5, 0.0],
  distance: 18.0,
  yaw: 28.0,
  pitch: -20.0,
  focus: {
    enabled: true,
    mode: "node",
    targetNode: ballNode,
    targetOffset: [0.0, 0.0, 0.0]
  }
});

const pipeline = new ComputeEffectPipeline(app.getGPU(), {
  dof: {
    enabled: true,
    focusSource: "camera",
    focusRange: 5.8,
    cocScale: 0.95,
    blurRadius: 1.15,
    focusTransitionWidth: 0.40,
    sharpnessWidth: 0.60
  }
});
```

`WebgApp`はEyeRigの更新後に`CameraFrame`を作り、`EyeRig.getFocusDistance(cameraFrame)`の結果を`cameraFrame.focusDistance`へ保存します。
`ComputeEffectPipeline`は`focusSource: "camera"`を指定したDoFのフレームで、その値を`ComputeDofPass`へ渡します。
これにより、`ballNode`が物理計算で移動しても、またOrbitをズームしても、合焦距離は現在の描画フレームから再計算されます。

合焦距離とDoFのぼけ幅は別の設定です。
`EyeRig.focus`は対象の選択、`CameraFrame.focusDistance`は対象までの現在の視点空間距離、`focusRange`や`cocScale`はその距離差をどの程度のぼけへ変換するかを表します。
`focusSource`の既定値は`"explicit"`なので、直接利用時の数値`focusDistance`は従来どおり利用できます。
`"camera"`を指定したときに`CameraFrame.focusDistance`が存在しなければ、固定値へ戻さず設定不足として例外になります。

FPSでは、動くNodeがまだ決まっていない場合に`camera-forward`を使い、カメラから正面へ1.0 mのように指定できます。
固定された展示物へ焦点を合わせる場合は、`world-point`でワールド座標を指定します。
このように合焦対象の種類はEyeRigが選び、画像ピラミッド、CoC、段階混合は`ComputeDofPass`が担当します。

調整は、最初に`focusDistance`で被写体へ焦点を合わせ、`focusRange`で鮮明に保つ奥行きを決めます。
次に`cocScale`で距離差に対するぼけの進み方を整え、`blurRadius`でぼけの空間的な広さを調整します。
最後に`sharpnessWidth`と`sharpnessPower`で段階間の移行を確認します。

DoFがカメラ移動に追従しないときは、ぼけの設定より先に、`scene`と`depth`が同じフレームのものか、G-bufferの描画に使った同じ`cameraFrame`を渡しているかを確認します。
未描画の背景自体には距離がないため、背景全体を一律にぼかさず、近景または遠景のフィルター処理済みの被覆率が届いた範囲だけを更新します。

## トゥーンと輪郭を分けて画風を調整する

トゥーンと輪郭は、物理的に滑らかな陰影をイラストやセル画のような明暗帯と線へ置き換え、写実表現とは異なる画風を作るために使います。
明るさの段階化と輪郭線の検出を別のパスにすると、色面の数と線の太さを独立に調整でき、輪郭だけを通常の照明へ加える、トゥーンだけを使って線を省く、といった使い分けもできます。

`ComputeToonPass`は照明済みのHDRシーンを少数の明暗帯へ変換します。
RGBを個別に丸めると色相が変わるため、パスはRGBの最大値を強度として段階化し、元のRGB全体へ同じ倍率をかけます。
これにより、元のマテリアル色を保ったまま陰影だけを整理できます。

HDRの値を0から1へ切り詰めてから段階化すると、1.0を超える輝度がすべて同じ白帯になります。
そこで強度を0.5〜1、1〜2、2〜4のよう2倍ごとの露出区間へ分け、各区間の内側を`levels`段階へ量子化します。
これにより、発光部の値を1.0へ切り詰めず、後段のブルームとトーンマッピングへ光量差を残せます。
`floor`は1.0未満の暗部だけに適用され、HDR側の明るさはそのまま保ちます。

```js
import ComputeToonPass from "./webg/ComputeToonPass.js";

const toonPass = new ComputeToonPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await toonPass.ready;

const toonColor = toonPass.encode(
  app.getGPU().commandEncoder,
  hdrScene,
  {
    levels: 4,
    strength: 1.0,
    gamma: 1.0,
    floor: 0.28,
    enabled: true
  }
);
```

`levels`は明暗の段階数、`strength`は元の色と段階化した色の混合率、`gamma`は帯の境界を暗部または明部寄りへ移す値、`floor`は最暗帯の明るさです。
照明値の意味が残っているトーンマッピング前に適用すると、強い光を含むHDRの範囲から明暗帯を作れます。

### 色の境界と形状の境界を目的で使い分ける

色の境界は画像として見える色や明るさの境界を線にしたいとき、形状の境界は物体の外形や面の折れ目を安定して線にしたいときに使います。
目的に合う情報を選べば、模様まで積極的に線へ含めることも、照明の変化に影響されにくい輪郭だけを描くこともできます。

`ComputeEdgePass`は、シーン色の輝度差を読む色の境界と、G-bufferの法線差・深度差を読む形状の境界を持ちます。
色の境界は模様や照明の切り替わりも拾いやすく、形状の境界は物体の外形や面の折れ目を拾いやすいという違いがあります。

```js
import ComputeEdgePass from "./webg/ComputeEdgePass.js";

const edgePass = new ComputeEdgePass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await edgePass.ready;

const outlined = edgePass.encode(
  app.getGPU().commandEncoder,
  displayColor,
  {
    normal: gbufferResources.normal,
    depth: gbufferResources.depth,
    cameraFrame,
    strength: 1.0,
    threshold: 0.16,
    mix: 1.0,
    thickness: 2,
    blendMode: "black-multiply",
    colorEnabled: false,
    geometryEnabled: true,
    normalWeight: 1.0,
    depthWeight: 1.0,
    enabled: true
  }
);
```

形状の境界では`normal`、`depth`、`cameraFrame`をひとまとめに渡します。
色の境界だけならこれらは不要です。
`thickness`は検出後の輪郭を周囲へ広げる幅、`threshold`は差を輪郭とみなす判定値です。
`black-multiply`は元色を残した黒線、`black-subtract`はより強い黒線、`white-add`は発光的な白線に適します。

輪郭抽出へ渡す`displayColor`は、トーンマッピング後の`rgba8unorm`、または標準描画先と同じ`bgra8unorm`である必要があります。
`ComputeEdgePass`は表示色の輝度差を読む処理であり、`rgba8unorm`または`bgra8unorm`を入力に使います。線形HDRの`rgba16float`はトーンマッピング後に表示色へ変換してから渡します。
遅延照明の結果へ輪郭を加える場合は、先に`ComputeEffectToneMapPass`で表示色へ変換します。
フォワードレンダリング経路の`RenderTarget`へ適用する場合は、`bgra8unorm`のまま渡せます。

入力形式を二つ認める一方、`ComputeEdgePass`が内部で生成して保持する出力ストレージテクスチャは`rgba8unorm`です。
これは、キャンバスと同じ形式で作られる通常のレンダーターゲットが`bgra8unorm`であっても、ストレージ書き込みに使う内部出力の形式まで同じとは限らないためです。
入力と出力の形式を同一と仮定せず、パスが返した出力ターゲットを最終表示へ渡してください。

## ビネットで画面周辺の見せ方を整える

ビネットは、画面の中心付近を保ちながら周辺を減光または着色し、視線を注目領域へ導くために使います。
三次元位置やマテリアルを再評価する効果ではなく、完成した表示画像に対する画面構成上の調整です。
そのため`ComputeVignettePass`は、トーンマッピングと任意の輪郭抽出が終わった`rgba8unorm`表示色を入力に取り、同じ形式の最終テクスチャを返します。

```js
import ComputeVignettePass from "./webg/ComputeVignettePass.js";

const vignettePass = new ComputeVignettePass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await vignettePass.ready;

const finalColor = vignettePass.encode(
  app.getGPU().commandEncoder,
  outlinedDisplayColor,
  {
    center: [0.5, 0.5],
    radius: 0.9,
    softness: 0.35,
    strength: 0.65,
    tint: [0.0, 0.0, 0.0],
    enabled: true
  }
);
```

`center`は正規化した画面座標で表す効果の中心です。
`[0.5, 0.5]`は画面中央であり、被写体が中央から外れている構図では中心を移動できます。
`radius`は周辺効果が完了する外側半径、`softness`は効果が立ち上がる幅です。
内側半径は`radius - softness`で求められるため、`softness`は0より大きく、`radius`以下である必要があります。

`strength`は0から1の範囲で、周辺へ`tint`をどれだけ作用させるかを決めます。
処理は周辺係数と`strength`から求めた割合で、入力RGBへ白から`tint`までの係数を乗算します。
既定の黒い`tint`では周辺減光になります。
色を持つ`tint`では、その色を単純に上塗りするのではなく、入力色の各成分を乗算して周辺の色調を変えます。
アルファは入力値を保持します。

| 設定値 | 既定値 | 意味 |
| --- | ---: | --- |
| `center` | `[0.5, 0.5]` | 正規化画面座標で表す効果の中心 |
| `radius` | `0.9` | 効果が完了する外側半径 |
| `softness` | `0.35` | 内側から外側へ変化する幅 |
| `strength` | `0.65` | 周辺へ`tint`を作用させる割合 |
| `tint` | `[0.0, 0.0, 0.0]` | 入力色へ乗算する周辺色 |
| `enabled` | `false` | ビネットを適用するかどうか |

画面の幅と高さが異なる場合に正規化座標の距離をそのまま使うと、円形に意図した効果が横長または縦長に歪みます。
`ComputeVignettePass`は中心からの水平方向の差へ画面のアスペクト比を掛けてから距離を求めます。
この補正により、キャンバスをリサイズしても効果の距離基準を画面上で保ちます。
パス自体の出力ターゲットは、他の全画面パスと同様に新しいキャンバス寸法へ`resize()`する必要があります。

ビネットは完成色と画面サイズを読み、深度、法線、マテリアル、`cameraFrame`から独立して処理します。
したがってG-bufferを持たないフォワードレンダリング経路の表示色にも個別パスとして接続できます。
線形HDR色はトーンマッピング後の表示色へ変換してから入力します。
露出やトーンマッピングより前へ置かず、最終表示色を作った後に一度だけ適用します。

HUD（Head-Up Display、画面上の情報表示）をビネットで暗くしたくない場合は、ビネット後のテクスチャを画面へ提示してからHUDを描きます。
31〜33章の統合経路では、「トーンマッピング、輪郭抽出、ビネット、最終表示、HUD」の順序になります。
アプリケーションがすでに独自のビネットを最終表示の直前へ持っている場合は、統合パイプライン側と二重に有効化せず、設定を一方へ集約します。

## HDR効果を順につなぐ

効果の順序は、1.0を超えるHDRの光量を必要な処理まで残し、同じ色変換を一度だけ適用するために決めます。
正しい順序でつなぐと、非常に明るい光だけをブルームで広げ、DoFで発光の明るさを保ったままぼかし、最後に表示可能な範囲へトーンマッピングできます。
順序を誤ると、各パスが正常でも強い光の差が消え、ブルームや反射が平坦に見えます。

ブルームはHDRシーンから明るい部分を抽出します。
トーンマッピング後に実行すると強い光が表示範囲へ圧縮済みとなり、ブルームの入力差が失われます。
DoFもHDRシーンをぼかすことで、合焦外の発光が自然な明るさを保ちます。
フォグ、トゥーン、DoF、ブルームはトーンマッピングより前、最終表示色へ輪郭と周辺調整を重ねる輪郭抽出とビネットはトーンマッピング後が基本です。

標準順序は次のとおりです。

```text
G-buffer
  -> 可視率（シャドウ / SSAO）
  -> 遅延ライティング
  -> SSRと効果合成
  -> `TransparencyPass`
  -> 標準Compute粒子のHDR加算
  -> フォグ
  -> トゥーン / DoF / ブルーム
  -> トーンマッピング
  -> 輪郭抽出
  -> ビネット
  -> 最終表示
```

`TransparencyPass`は、G-bufferへ入れなかった半透明三角形を合成済みのHDRシーンへ加えます。
不透明シーンから1/2、1/4、1/8の画像ピラミッドを作り、粗さのマスク値に対応する隣接段階を補間して背景ぼけを作った後、全`Shape`から集めて奥から手前へ並べた透明表面をアルファ合成します。
利用側が個別に`encode()`することを前提としたパスではなく、通常は31〜33章の`ComputeEffectPipeline`が半透明三角形を検出したフレームだけ実行します。

`ComputeFogPass`は透明合成後のHDRシーン全体を処理しますが、距離の基準には不透明なG-buffer深度だけを使います。
`ComputeVignettePass`はトーンマッピングと輪郭抽出を終えた表示色を処理し、最終表示へ渡すテクスチャを作ります。
フォグとビネットはいずれも既定では無効であり、統合パイプラインでは有効なときだけ標準順序へ挿入されます。

## 標準Compute粒子をPBRへ合成する

26章の`ComputeParticleEmitter`は、`GpuParticleEmitter`を継承し、発生条件の検証、初期値生成、更新式、発光ビルボードの描画をまとめたクラスです。PBRアプリでは`WebgSceneApp.createComputeParticleEmitter()`で登録すると、`ComputeParticlePass`が透明合成後のHDR画像へ加えます。利用側は発生条件を指定し、GPU資源の構築や個別の描画パスは標準クラスへ任せます。

PBRの合成先は`rgba16float`を使い、Canvasへ直接描画する場合は`targetFormat: screen.getGPU().format`のように表示用テクスチャの形式を指定します。発生要求やGPU上の更新処理は、どちらの出力先でも同じ`ComputeParticleEmitter`を使います。

粒子の発生要求は1件につき32 floatです。1更新までに最大32件を保持し、カメラや時間を表す48 floatと合わせて4,288 byteのuniformを一括転送します。GPUの各実行単位は自分の粒子枠に対応する要求を読み、seedと発生番号から初期速度・寿命・半径を作ります。一粒子の状態は12 float、48 byteで保持し、同じbufferを描画から参照します。

この構成では発生要求をまとめて送れるため、衝突ごとに多数の粒子を発生させる使い方に適しています。CPUには最大寿命による予約数を残し、容量不足と診断表示に使います。通常の描画はGPU readbackを伴わず進みます。GPU更新の対象数と描画instance数は容量に比例するため、必要な発生頻度と寿命から容量を見積もります。

合成では線形HDRのRGBへ発光を加算し、描画先のalpha値を保持します。不透明G-bufferの深度を読み取り専用で参照することで、床や柱の奥の粒子が隠れます。合成後はシーンと同じBloom・トーンマッピングへ渡します。Bloom OFFでも粒子の更新と表示は継続します。

低水準の`ComputeEffectPipeline`へ直接接続する場合は、次のように登録します。この例は、初期化済みの`app`と`pipeline`を使う初期化処理の断片です。

```js
import ComputeParticleEmitter from "./webg/ComputeParticleEmitter.js";

const particles = new ComputeParticleEmitter(app.getGPU(), {
  preset: "light", capacity: 1024, seed: 42, overflow: "reject"
});
await pipeline.addParticleEmitter(particles);
particles.startEmission({ rate: 30, position: [0, 1, 0] });
```

毎フレームの`pipeline.encode(commandEncoder, { cameraFrame, deltaSec })`には、同じフレームのカメラと秒単位の時間差を渡します。encoderの生成とsubmitはフレームを管理する呼び出し元が行います。登録した粒子と中間HDR画像はpipelineの破棄時に解放されます。

SSRは粒子合成前のシーンを参照し、FogとDoFは不透明物の深度を参照します。透明物との奥行き並べ替えや粒子自身の深度を使う効果は、これらの入力を追加して設計する表現です。標準Compute粒子は円形の発光表現に使い、煙の透明度や粒子同士の相互作用は用途に合わせた描画・更新処理として扱います。

## 独自WGSLでGPUパーティクルを更新する

GPUパーティクルは、火花、煙、雨、群れのような多数の粒子を毎フレーム動かしながら、CPUとGPUの間で全粒子の状態を往復させないために使います。
`GpuParticleEmitter`は粒子状態をストレージバッファで更新し、そのバッファを頂点シェーダーから直接読むため、粒子数が多いほどCPUで個別更新して転送する方式との差が大きくなります。

この自由度と引き換えに、粒子レイアウトと座標の意味は利用側WGSL（WebGPU Shading Language：WebGPU用シェーディング言語）が定義します。
G-buffer系の画面空間のエフェクトのように共通のアタッチメントから意味を復元するのではなく、コンピュートシェーダーのWGSLとレンダーシェーダーのWGSLの間で、位置、速度、寿命、色などの配置を一致させます。

通常カメラへ直接描く場合は、Emitter生成時に座標と深度を明示します。

```js
import GpuParticleEmitter from "./webg/GpuParticleEmitter.js";
import { CAMERA_REVERSE_Z } from "./webg/DepthConvention.js";

const emitter = new GpuParticleEmitter(app.getGPU(), {
  particleCount: 32768,
  floatsPerParticle: 12,
  workgroupSize: 64,
  initialData,
  computeCode,
  renderCode,
  coordinateSpace: "camera-relative",
  depthConvention: CAMERA_REVERSE_Z,
  targetFormat: app.getGPU().format
});
```

このコードは生成時の接続点を示す断片であり、`computeCode`、`renderCode`、`initialData`は利用側で用意します。`initialData`は`Float32Array`で、要素数は`particleCount * floatsPerParticle`と完全に一致させます。長さが違う場合、コアは不足分を補わず例外にします。

JavaScript側の値とWGSL側の宣言には、次の対応関係があります。

| JavaScript側 | WGSL側 |
| --- | --- |
| `floatsPerParticle: 12` | 1粒子の状態を12個の`f32`で表す配置 |
| `workgroupSize: 64` | Compute entry pointの`@workgroup_size(64)` |
| Computeのgroup 0 / binding 0 | 読み書き可能な粒子storage buffer |
| Computeのgroup 0 / binding 1 | 読み取り専用のparameter uniform buffer |
| Renderのgroup 0 / binding 0 | 読み取り専用の粒子storage buffer |
| Renderのgroup 0 / binding 1 | 読み取り専用のparameter uniform buffer |

例えば、1粒子を三つの`vec4f`、合計12個の`f32`として読む最小構成は次の形です。ここでは`state0.xy`を画面位置、`state2`を色とするだけの例にしています。実際の位置、速度、寿命、色の割り当ては利用側で決めますが、ComputeとRenderで同じフィールドを同じ意味に使います。

```wgsl
struct Particle {
  state0 : vec4f,
  state1 : vec4f,
  state2 : vec4f,
};

struct SimParams {
  values : vec4f,
};

// Compute側: 1 invocationが1粒子を更新する
@group(0) @binding(0) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : SimParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= arrayLength(&particles)) {
    return;
  }
  var particle = particles[id.x];
  particle.state0.xy += particle.state1.xy * params.values.x;
  particles[id.x] = particle;
}
```

```wgsl
struct Particle {
  state0 : vec4f,
  state1 : vec4f,
  state2 : vec4f,
};

struct SimParams {
  values : vec4f,
};

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f,
};

// Render側: Compute後の同じ粒子bufferを読み取る
@group(0) @binding(0) var<storage, read> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : SimParams;

@vertex
fn vsMain(
  @location(0) corner : vec2f,
  @builtin(instance_index) instanceIndex : u32
) -> VertexOutput {
  let particle = particles[instanceIndex];
  var output : VertexOutput;
  output.position = vec4f(particle.state0.xy + corner * 0.01, 0.5, 1.0);
  output.color = particle.state2;
  return output;
}

@fragment
fn fsMain(input : VertexOutput) -> @location(0) vec4f {
  return input.color;
}
```

`GpuParticleEmitter`は`ceil(particleCount / workgroupSize)`個のworkgroupを実行します。WGSLに記述した`@workgroup_size`をJavaScriptから読み取って自動修正することはないため、両方の値を同時に変更します。

深度の宣言とWGSLの出力を同じReverse-Z規約へそろえます。宣言と出力が異なると、深度比較の向きが崩れます。
頂点シェーダーが作るクリップ位置、描画パイプラインの比較、深度クリア値が同じ規約であることを確認します。
パーティクルバッファの位置フィールドは、利用側のWGSLでレイアウトを明示します。コアは指定されたレイアウトを読み取ります。

### 更新と描画で同じGPUバッファを共有する

`GpuParticleEmitter`は、一つの粒子ストレージバッファをCompute側では読み書き可能、Render側では読み取り専用として参照します。Compute Passを先に記録し、その後にRender Passを記録することで、更新後の状態をCPUへ読み戻さず、そのフレームの描画へ直接使います。

```text
粒子buffer --Computeで更新--> 同じ粒子buffer --Renderで読取--> screen
```

この方式では、一つのinvocationが自分の粒子だけを更新する構成を基本とします。更新中に別粒子の更新前状態を必要とする相互作用には、利用側で入力用と出力用のバッファを分けるピンポン構成を選びます。バッファの切り替えは利用側の責務として明示します。

`floatsPerParticle`はWGSL側の構造体と一致している必要があります。
位置、速度、寿命、色などの配置はアプリケーションのWGSLが定めます。
レイアウトは位置、速度、寿命、色などの型と順序を明示してそろえます。ずれを検出した場合は、粒子数を少なくした診断表示でWGSLとCPU側の定義を照合します。
コンピュートシェーダーのWGSLとレンダーシェーダーのWGSLが同じ配置を読んでいることを、粒子数を少なくした診断表示で確認します。

## リサイズ時のずれとリークを防ぐ

リサイズと破棄を担当するパスを明確にするのは、ウィンドウ寸法の変更後も各テクスチャの画素対応を保ち、不要になったGPUリソースを確実に破棄するためです。
関連するパスを同じタイミングで更新し、作成した側だけが破棄する規則を守れば、画像のずれ、古いテクスチャの参照、二重破棄、メモリリークを防げます。

キャンバスの寸法が変わると、入力と出力が同じ画素を表すパスはまとめてリサイズする必要があります。
G-bufferだけが新しい寸法で、SSAOとSSRが前の寸法のままでは、テクスチャの座標対応が壊れます。

```js
function resizeEffects(width, height) {
  gbuffer.resize(width, height);
  ssaoPass.resize(width, height);
  deferredPass.resize(width, height);
  ssrPass.resize(width, height);
  fogPass.resize(width, height);
  dofPass.resize(width, height);
  bloomPass.resize(width, height);
  toonPass.resize(width, height);
  edgePass.resize(width, height);
  vignettePass.resize(width, height);
}

app.start({
  onUpdate: ({ screen }) => {
    resizeEffects(screen.getWidth(), screen.getHeight());
  }
});
```

各`resize()`は同じ寸法のリソースを維持し、寸法が変わった場合にだけ再構築します。
フレームの途中ではなく`onUpdate`で同期し、その後の`onBeforeDraw`から新しいターゲットを使います。
破棄時は、ターゲットを生成したパスの`destroy()`を呼びます。
同じテクスチャを複数のパスへ入力する場合は、入力として参照するだけのパスが完了するまでテクスチャを保持します。
この管理が煩雑になるほど効果を組み合わせる場合は、31〜33章の`ComputeEffectPipeline`へリソースの生成、更新、破棄をまとめる方が安全です。

## 中間結果を意味ごとに見て原因を絞る

G-bufferや可視率などの中間結果を個別に表示すると、最終画像だけでは同じに見える入力不足、座標の不一致、合成順序の誤りを切り分けられます。
複数のパスを一度に調整する代わりに、情報が最初に不正になる段階を特定できるため、シェーダーの数が増えても原因を推測だけで追わずに済みます。
次の順で観測します。

1. アルベドが照明前の色になっているか。
2. 法線を色表示したとき、カメラ回転に対してビュー空間として変化するか。
3. 深度背景が0で、near側ほど明るいか。
4. マテリアルの4成分がspecular、roughness、metallic、occlusionとして入り、emissiveが独立HDR attachmentへ入っているか。
5. AOとシャドウの可視率が白を「遮蔽なし」としているか。
6. 遅延ライティングの出力がHDRのままか。
7. 反射アルファが交差判定しない領域で0か。
8. フォグが背景深度0を距離として扱わず、透明合成後のHDR色を
   読んでいるか。
9. トーンマッピング、sRGB表示変換、追加のガンマ調整が表示前の1回だけか。
10. ビネットが輪郭抽出の後、最終表示とHUDの前に一度だけ
    適用されているか。

画面が黒い場合は、効果の式だけでなくパスの接続も確認します。
たとえば、全画面コピーをカメラ用Reverse-Z深度付きパスへ描くと、アタッチメントの不一致が起こる場合があります。
深度なしの最終表示パスを開いたまま、`Font`のパイプラインへ進んだ場合も同様です。
この不一致は、コマンドバッファー全体を無効にすることがあります。

WebGPUの`uncaptured error`（捕捉されなかった検証エラー）を確認し、最終表示からHUD描画への切り替えを`beginPresentPass()`と`clearDepthBuffer()`の対で構成します。

## 画質への影響が小さい順に負荷を下げる

負荷調整では、効果そのものを削る前に、中間の描画先の解像度、1画素あたりの参照数、適用範囲の順で見直します。
ぼかしやバイラテラルフィルターによる拡大を前提にした派生描画先から解像度を下げれば、輪郭やマテリアルを保持するG-bufferを壊さずに、大きな計算量を減らせるためです。

画面空間のエフェクトの負荷は、おおむね処理画素数、1画素あたりのサンプル数、パス数の積で決まります。
最初に`resolutionScale`を下げ、次にレイステップやサンプル数を調整し、最後に効果の有効範囲を狭めます。
解像度倍率は縦横へ効くため、1.0から0.7への変更でも処理画素数は約49%になります。

G-bufferのアタッチメントは同じ解像度で揃え、低解像度化は各効果が生成する派生ターゲットへ適用します。
アルベド、法線、マテリアル、深度は同じ画素を表す必要があります。
低解像度化はSSAO生ターゲットやSSR反射など、各パスが内部で生成して管理する派生ターゲットへ適用します。

フォグとビネットは最終的な画素対応を保つ全画面効果として実行するため、現在は入力解像度を変える`resolutionScale`を使わず、画面寸法へ合わせて処理します。
どちらも1画素につき少数のテクスチャ参照と算術処理で完了しますが、有効にすれば画面解像度分のディスパッチと出力テクスチャが追加されます。
統合パイプラインで無効にした場合は、そのパスの`encode()`自体を省略します。
負荷を測るときは、強度を0へ近づけた状態ではなく、効果の有効状態を切り替えてGPU時間を比較します。

## まとめ

DoF、トゥーン、輪郭抽出、ビネット、GPUパーティクルは、入力する画像や深度、適用する色区間、後続の表示処理を確認してから組み合わせます。派生ターゲットの解像度、参照数、パス数を順に調整すると、必要な画質を保ちながら負荷を見積もれます。
描画の座標、深度、色形式を内部規則から理解したい場合は、41章へ進みます。
