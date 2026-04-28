# ローレベルAPIの基礎

ハイレベル（高レイヤー）な `WebgApp` を利用すると、描画先の初期化やシーンの組み立てを非常に簡潔に記述できます。しかし、その背後では `Screen`、`Shader`、`CoordinateSystem`、`Node`、`Matrix`、`Quat` といったローレベル（低レイヤー）APIが、それぞれ独立した役割を担っています。本章では、`webg` の土台となっているこの中間層を、「GPU側の入口」「シーン変換の基礎」「数理の土台」という3つの観点から整理して解説します。

ここで重要なのは、`webg` のローレベルAPIは生のWebGPUをそのまま露出させるのではなく、「3Dアプリケーションを構築するための単位」へと抽象化した中間層であるという点です。ブラウザで3D描画を行う場合、本来はキャンバスとGPUデバイス、レンダーパイプライン、ユニフォームバッファ、頂点・インデックスバッファ、カメラ行列、モデル変換などを個別に連携させる必要があります。`webg` では、これらを一つの巨大なAPIにまとめるのではなく、役割ごとにクラスを分けることで管理しやすくしています。

具体的には、`Screen` と `Shader` がGPUに近い「入口」となり、キャンバスやデバイス、パイプライン、ユニフォームの初期化を担います。一方で `CoordinateSystem` と `Node` はシーン上の「姿勢と配置」を管理し、位置、回転、親子関係、そして `Shape` を配置する単位としての役割を分担します。さらに `Matrix` と `Quat` は、これらの上位レイヤーが利用する「数理の土台」として、投影行列の計算や行列積、クォータニオン補間などの変換計算を基盤から支えています。

![ローレベル API の 3 層構造](fig25_01_low_level_layer_map.jpg)

*本章では、Screen / Shader を「GPU側の入口」、CoordinateSystem / Node / Shape / Space を「シーン変換と配置」、Matrix / Quat を「数理の土台」として捉えることで、各APIの役割を体系的に理解することができます。*

## GPU側の入口：Screen と Shader

### Screen

`Screen` は、HTMLのキャンバス（canvas）とWebGPUの橋渡しを行うクラスです。内部では `navigator.gpu` からアダプター（adapter）とデバイス（device）を取得し、キャンバスの `webgpu` コンテキストを `configure` し、デプス（depth）テクスチャを管理します。つまり `Screen` は、「描画先の窓」と「その窓へ描画するためのWebGPUコンテキスト」を統合して管理する、GPU側入口の最外殻に位置するクラスです。

`Screen` の主な役割は、キャンバスの特定、WebGPUデバイスの確保、コンテキストの構成、リサイズ時のデプステクスチャの再構築、および `clear()` と `present()` のインターフェース提供です。ここで注目すべきは、`Screen` 自体はシェーダーやジオメトリ（geometry）の情報を保持しない点です。役割はあくまで「どこに描くか」という描画先の整備に特化しており、「どう描くか」という描画内容の制御は `Shader` 側に委ねられています。

最小のコード例を以下に示します。

```js
import Screen from "./webg/Screen.js";

// Screen が canvas と WebGPU の初期化を担当する
const screen = new Screen(document);

// device と context の準備が終わるまで待つ
await screen.ready;

// 背景色を決める
screen.setClearColor([0.1, 0.15, 0.1, 1.0]);

// Screen から GPU ラッパーを取り出す
const gpu = screen.getGL();
console.log(gpu.device, gpu.context);
```

この例で重要なのは、`await screen.ready` を待機するまで、WebGPUデバイスやコンテキストが利用可能な状態ではないということです。ローレベルAPIを利用する際、デバイスの準備が完了する前にシェーダーやバッファを作成しようとしてエラーになるケースが多く見られます。`Screen` は非同期初期化を持つクラスであると認識しておく必要があります。

また、`resize()` メソッドは単にキャンバスのサイズを変更するだけではありません。内部でデプステクスチャの再構築を行うため、画面サイズを変更した後は投影行列（projection matrix）も合わせて更新するという一連の流れで処理を行うのが一般的です。

```js
screen.resize(
  Math.max(1, Math.floor(window.innerWidth)),
  Math.max(1, Math.floor(window.innerHeight))
);
```

### Shader

WebGPUでは、描画のたびにレンダーパイプライン、シェーダーモジュール、ユニフォームバッファ、バインドグループ（bind group）が必要になります。`Shader` はこれらをクラスとしてまとめる基底層です。`Screen` が「描画先の窓」を作るのに対し、`Shader` は「描画手法」を定義します。

`webg` では `Shader` 基底クラスを直接使うよりも、通常は `SmoothShader` のような派生クラスを利用することが一般的です。教材や比較用の `book/examples/Phong.js` のような補助実装を参照する場面はありますが、現行のコア側で標準入口になっているのは `SmoothShader` です。`Shader` が担う具体的な処理は、ユニフォームバッファの作成、WGSLからのシェーダーモジュール生成、バインドグループレイアウトの構築、テクスチャとサンプラーのバインドグループ管理、およびパスエンコーダーへのパイプライン設定です。

`Shader` は、CPU側の描画パラメータを行列や光源値などの「GPUが解釈可能な形式」に整えて渡す中継点としての役割を果たします。以下に、派生クラスである `SmoothShader` を用いた最小のコード例を示します。

```js
import Screen from "./webg/Screen.js";
import SmoothShader from "./webg/SmoothShader.js";
import Matrix from "./webg/Matrix.js";

const screen = new Screen(document);
await screen.ready;

// SmoothShader は Shader の派生クラス
const shader = new SmoothShader(screen.getGL());
await shader.init();

// projection 行列を shader へ渡す
const projection = new Matrix();
projection.makeProjectionMatrix(
  0.1,
  1000.0,
  screen.getRecommendedFov(55.0),
  screen.getAspect()
);
shader.setProjectionMatrix(projection);

// 光源位置も shader 側へ渡す
shader.setLightPosition([120.0, 180.0, 140.0, 1.0]);
```

この例のように、投影行列や光源位置は `Matrix` や配列としてCPU側で計算し、それを `Shader` がGPUへ転送します。`Shader` 自体が数学的な計算を行うのではなく、計算済みの結果を描画設定に反映させる役割を担っています。

## シーン変換と配置：CoordinateSystem と Node

### CoordinateSystem

`CoordinateSystem` は、シーングラフにおける変換の基底となるクラスです。位置、回転、スケール、および親子関係を保持し、必要に応じてローカル行列とワールド行列を再構築します。ここで重要なのは、`CoordinateSystem` 自体は描画機能を持たないということです。見えるオブジェクトではなく、空間上の「姿勢」を定義するための基底として機能します。

`CoordinateSystem` が提供する機能は、座標（position）の保持、クォータニオンによる回転の管理、一様スケールの設定、親子関係の構築、およびローカル/ワールド行列の計算です。このクラスは、シェーダーや形状（shape）、GPUの情報を一切持たず、純粋に「3D空間上のどこに、どちらを向いて、どの親の下に配置されるか」という姿勢情報のみを管理します。

最小のコード例は次のとおりです。

```js
import CoordinateSystem from "./webg/CoordinateSystem.js";

const cs = new CoordinateSystem(null, "marker");

// 位置を決める
cs.setPosition(2.0, 1.0, 0.0);

// yaw(Y), pitch(X), roll(Z) の順で回転を決める
cs.setAttitude(45.0, 15.0, 0.0);

// uniform scale を設定する
cs.setScale(1.5);

// 行列を更新する
cs.setWorldMatrix();

console.log(cs.getWorldPosition());
console.log(cs.getWorldAttitude());
```

特に注意すべき点は、回転の適用順が `yaw (Y軸) → pitch (X軸) → roll (Z軸)` であることです。これは `webg` 全体における共通規約となっており、後の `Matrix` や `Quat` の処理においても一貫して適用されます。

### Node

`Node` は、`CoordinateSystem` を継承し、そこに `Shape` の保持と描画機能を追加したクラスです。シーンにオブジェクトを配置する実体と言えます。`CoordinateSystem` が「変換のみの基底」であるのに対し、`Node` はその変換の上に「何を描画するか」という実体を載せたものです。

ローレベルな実装では、`Space.addNode()` を通じて `Node` を生成し、そこに `Shape` を割り当てます。視点（カメラ）も通常は `Node` として配置されます。つまり `Node` は、可視オブジェクトに限らず、カメラリグやピボット、オフセット用の親ノードなど、「シーンに存在するあらゆる要素」を表す汎用的なクラスです。

`Node` が提供する主な機能は、`Shape` の保持、`CoordinateSystem` と同様の変換APIの利用、親子階層の構築、および自身と子孫ノードの再帰的な描画処理です。

最小のコード例は次のとおりです。

```js
import Space from "./webg/Space.js";

const space = new Space();

// 視点も Node として置く
const eye = space.addNode(null, "eye");
eye.setPosition(0.0, 0.0, 10.0);
space.setEye(eye);

// 描画オブジェクト用 Node
const box = space.addNode(null, "box");
box.setPosition(0.0, 0.0, 0.0);
box.setAttitude(0.0, 20.0, 0.0);
box.addShape(shape);
```

ここで、`Shape` はジオメトリとマテリアルを持つ「部品」であり、それをシーンに配置して位置や親子関係を与える実体が `Node` であるという関係性を理解してください。`Shape` 単体ではシーンに属さず、`Node` に紐付いて初めて空間上の位置を持ちます。

## 数理の土台：Matrix と Quat

### Matrix

3Dグラフィックスでは、回転、移動、投影、ビュー変換のすべてを行列で処理します。`webg` の `Matrix` は、列優先（column-major）の4×4行列です。`CoordinateSystem`、`Node`、`Shader`、`Space` の内部ではすべてこの `Matrix` が利用されており、あらゆる変換処理の最終的な集約点となっています。

`Matrix` が担う機能は、4×4行列の保持、オイラー角やクォータニオンからの回転行列生成、平行移動の適用、投影行列およびビュー行列の作成、ベクトルへの行列適用などです。特筆すべきは、同一の `Matrix` クラスが「カメラ用の投影行列」としても「オブジェクト用の変換行列」としても利用される点です。用途に応じて使い分けるため、`Shader` や `CoordinateSystem` の処理と密接に連携します。

オブジェクト変換の最小例を以下に示します。

```js
import Matrix from "./webg/Matrix.js";

const m = new Matrix();

// yaw, pitch, roll から回転を作る
m.setByEuler(30.0, 10.0, 0.0);

// 最後の列へ平行移動を入れる
m.position([2.0, 1.0, 0.0]);

// 点 [0, 0, 1] をこの行列で動かしてみる
const moved = m.mulVector([0.0, 0.0, 1.0]);
console.log(moved);
```

投影行列を作成する例は次のとおりです。

```js
const projection = new Matrix();
projection.makeProjectionMatrix(
  0.1,
  1000.0,
  screen.getRecommendedFov(55.0),
  screen.getAspect()
);
```

このように、行列を生成する操作自体は共通ですが、それをどのAPI（`Shader` や `Space` など）に渡すかによって、その意味（投影なのかモデル変換なのか）が決まります。

### Quat

`Quat` は、回転を表現するためのクォータニオン（四元数）です。`webg` では `[w, x, y, z]` の順で値を保持します。`CoordinateSystem` は内部的にクォータニオンを用いて姿勢を保持し、描画時にそれを `Matrix` へ変換します。つまり `Quat` は、姿勢の保持やアニメーションの補間を効率的に行うための内部的な部品としての役割を担っています。

`Quat` が提供する主な機能は、各軸の回転クォータニオン生成、オイラー角からの変換、クォータニオン同士の積、`slerp` による球面線形補間、および行列との相互変換です。

ここで重要なのは、`Quat` は「向きを保持するための形式」であり、最終的な描画には `Matrix` への変換が必要であるという点です。保持と補間は `Quat` が担い、最終的な変換適用は `Matrix` が担うという役割分担になっています。

最小のコード例を以下に示します。

```js
import Quat from "./webg/Quat.js";
import Matrix from "./webg/Matrix.js";

const q = new Quat();

// yaw(Y), pitch(X), roll(Z) から quaternion を作る
q.eulerToQuat(45.0, 10.0, 0.0);

// 行列へ変換して確認する
const m = new Matrix();
m.setByQuat(q);

console.log(q.q);            // [w, x, y, z]
console.log(m.mat.slice(0)); // 4x4 matrix
```

この例から分かるように、クォータニオンを生成しただけでは描画に利用できず、最終的に行列へと落とし込む必要があります。これがアニメーションや姿勢補間を実装する際の重要なポイントとなります。

## 全体をつないだ最小例

ここでは、これまで解説した `Screen`、`Shader`、`Shape`、`CoordinateSystem`、`Node`、`Matrix`、`Quat` のすべての役割がどのように連携するかを、一つのコード例で示します。

```js
import Screen from "./webg/Screen.js";
import Space from "./webg/Space.js";
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";
import Matrix from "./webg/Matrix.js";
import Quat from "./webg/Quat.js";
import CoordinateSystem from "./webg/CoordinateSystem.js";
import SmoothShader from "./webg/SmoothShader.js";

const screen = new Screen(document);
await screen.ready;
screen.setClearColor([0.1, 0.15, 0.1, 1.0]);

// Shader は WebGPU の pipeline と uniform をまとめる
const shader = new SmoothShader(screen.getGL());
await shader.init();

// projection は Matrix で作る
const projection = new Matrix();
const updateProjection = () => {
  screen.resize(
    Math.max(1, Math.floor(window.innerWidth)),
    Math.max(1, Math.floor(window.innerHeight))
  );
  projection.makeProjectionMatrix(
    0.1,
    1000.0,
    screen.getRecommendedFov(55.0),
    screen.getAspect()
  );
  shader.setProjectionMatrix(projection);
};
updateProjection();

// シーン全体を管理する
const space = new Space();

// 視点 Node を置く
const eye = space.addNode(null, "eye");
eye.setPosition(0.0, 0.0, 12.0);
space.setEye(eye);

// CoordinateSystem は変換の下書きに使える
const pose = new CoordinateSystem(null, "cubePose");
pose.setPosition(0.0, 0.0, 0.0);
pose.setAttitude(20.0, 10.0, 0.0);

// Quat を直接作って回転を確認する例
const spin = new Quat();
spin.setRotateY(1.0);

// Shape は geometry と material を持つ
const shape = new Shape(screen.getGL());
shape.setShader(shader);
shape.applyPrimitiveAsset(Primitive.cube(3.0, shape.getPrimitiveOptions()));
shape.endShape();
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});

// Node は Shape をシーンに置く
const cube = space.addNode(null, "cube");
cube.setPosition(...pose.getPosition());
cube.setAttitude(...pose.getLocalAttitude());
cube.addShape(shape);

const loop = () => {
  // Node 側の API で回転を足していく
  cube.rotateY(0.8);
  cube.rotateX(0.3);

  screen.clear();
  space.draw(eye);
  screen.present();
  requestAnimationFrame(loop);
};
loop();
```

このコードの流れを整理すると、`Screen` がWebGPUの窓を用意し、`Shader` が描画手法を定義し、`Matrix` が投影行列を計算し、`Quat` が回転の土台となり、`CoordinateSystem` が位置と向きを定義し、`Shape` が形状を定義し、最後に `Node` がそれらをシーンに配置して実体化させています。このように、ローレベルAPIは「GPU側の入口」から始まり、「変換の土台」を経て、「シーンに配置する実体」へと繋がる構造になっています。

## ローレベルAPIを利用する判断基準

ローレベルAPIを直接利用するのが適しているのは、以下のようなケースです。
- 描画の基盤となる仕組みを深く理解したいとき
- 独自のレンダリングパスやカスタムシェーダーを構築する前段階であるとき
- `WebgApp` が内部でどのような自動化を行っているかを確認したいとき

つまり、「素早く何かを構築すること」よりも、「どのレイヤーで何が起きているかを正確に把握すること」を優先する場合に有効です。ローレベルAPIを学ぶ価値は、すべてを手書きすることではなく、ハイレベルAPIの内部挙動を見通せるようになることにあります。

一方で、サンプルアプリケーションを迅速に作成したい場合や、HUD、ユーザー入力、デバッグ機能、カメラリグなどの便利な機能を統合して利用したい場合は、`WebgApp` を利用するのが自然です。ローレベルAPIは学習と拡張のための土台であり、日常的なアプリケーション開発においては必ずしも最短経路ではありません。`WebgApp` による自動化の恩恵を受けつつ、必要なときだけローレベルな制御に降りるという使い方が最も効率的です。

## 特に注意すべき重要なポイント

ローレベルAPIを扱う際に、特に混同しやすく注意が必要なポイントを以下にまとめます。

1. 非同期初期化の待機: `await screen.ready` および `await shader.init()` を忘れないこと。
2. Shapeの確定: `shape.endShape()` を呼び出して形状を確定させること。
3. Nodeによる実体化: `Shape` 単体では表示されず、必ず `Node` に追加してシーンに配置すること。
4. 描画の実行: `Node` を作成しても、`Space.draw(eye)` を呼び出さなければ描画されないこと。
5. 行列の形式: `Matrix` は列優先（column-major）であること。
6. クォータニオンの順序: `Quat` は `[w, x, y, z]` の順で保持すること。
7. 回転の適用順: 回転順は `yaw (Y) → pitch (X) → roll (Z)` であること。

これらの基本仕様をあらかじめ固定して理解しておくことで、実装時の混乱を避けることができます。

本章で `Screen`、`Shader`、`CoordinateSystem`、`Node`、`Matrix`、`Quat` の骨格を把握したことで、次章の `Shape`（ジオメトリとマテリアル）の詳細な解説に進む準備が整いました。本章をローレベルAPI全体の地図として活用し、各機能のつながりを意識しながら学習を進めてください。
