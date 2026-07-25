# WebGPUとwebgの最小描画

この章では、`webg` を用いて最初の 3D アプリケーションを動作させるまでの流れを具体的に解説します。

`webg` を使い始める際に重要なのは、API を網羅的に暗記することではなく、「どのような順序でプログラムを組み立てればよいか」という全体像を理解することです。そのため本章では、まず「描画の基礎的な構造（ローレベル）」を実装して動作を確認し、その後に「`WebgApp` を用いた標準的なアプリケーション構成」へと進む段階的なアプローチをとります。

これにより、どこまでが描画の土台であり、どこからがアプリケーションとしての補助機能なのかを明確に切り分けることができます。

なお、サンプルの起動方法やリポジトリの配置、ローカルサーバーの構築方法を確認したい場合は、先に第2章「インストールと実行環境」を参照してください。

## 最初のアプリを構築するアプローチ

3D アプリケーションの開発では、描画の土台、カメラ、入力、HUD、診断情報、アセットの読み込みなど多くの要素を最初から盛り込むと、何も映らないなどの不具合が発生した場合に原因の切り分けが困難になります。

そこで `webg` では、以下の段階的な手法を推奨しています。

1. ローレベル（低レイヤー）構成: `Screen + Space + Node + Shape` という最小単位で描画の仕組みを理解する。
2. 標準構成 (`WebgApp`): 補助機能（カメラリグ、HUD、入力管理など）を統合し、効率的に開発する。

特に、`await screen.ready` による待機と `shape.endShape()` によるバッファの確定は、非常に重要なステップです。これらを怠ると、描画が表示されない、あるいは GPU バッファが正しく確定しないといった初歩的な問題に直面することになります。

## WebGPU API から見た `webg` の低レイヤー

したがって、本章の最小描画を理解するうえでは、「ブラウザ標準の WebGPU APIで何をしなければならないか」と、「それを webg  がどのクラスへ分担しているか」を対応づけて読むと全体像がつかみやすくなります。
WebGPU のネイティブ API では、まず GPU アダプタとデバイスを取得し、canvas に対応するコンテキストを作成し、そこへレンダーパイプライン、バッファ、シェーダー、描画コマンドを順に接続していきます。概念的には「描画先を準備する」「GPUに渡すデータを作る」「どのシェーダーでどう描くかを決める」「コマンドを発行して表示する」という流れになります。たとえば最小描画においても、WebGPU側では次のような処理が行われています。

- GPUDevice の取得: GPU へコマンドを送るための本体を用意する
- GPUCanvasContext の設定: canvas を描画先として結び付ける
- シェーダーとパイプラインの作成: 頂点処理とピクセル処理の流れを GPU 側へ定義する
- 頂点バッファやインデックスバッファの作成: 形状データを GPU メモリへ渡す
- コマンドエンコーダとレンダーパスの発行: どのフレームで何を描くかを記録し、最後に送信する

これらをすべてアプリケーション側で直接扱うのは、単純な立方体を描画する段階であっても非常に冗長です。さらに、実用的な 3D アプリケーションでは、canvas の初期化だけでなく、リサイズへの追従、深度バッファの用意、投影行列の更新、シーン全体の描画順序、複数 形状の管理まで必要になります。webg のローレベル(低レイヤー)は、こうした煩雑な処理 をクラス単位で分担しています。

具体的に、本章で最初に使用する `Screen` は、WebGPU における GPUCanvasContext、描画サイズ、クリア、プレゼント、レンダーパス開始といった「描画先まわり」の処理を引き受ける入口です。await screen.ready を待つという操作は、内部で WebGPU の利用準備が整うまで待機していることを意味しています。また、screen.clear() と screen.present( ) は、WebGPU でいうところのフレームごとのレンダーパスの開始と表示処理に相当します。

`Shape` は、WebGPU に渡す頂点データや材質設定をまとめる層です。Primitive.cube() のような形状生成結果を `Shape` へ適用し、endShape() を呼ぶことで、CPU 側で保持していた形状情報が GPU バッファとして確定します。したがって shape.endShape() を忘れると描画されないのは、WebGPU へ渡すべき頂点データが未完成であるためです。
シェーダーについては、SmoothShader のようなクラスが WebGPU のパイプライン設定と WGSL シェーダーをまとめて扱います。アプリケーション側からは shader.init()、setP rojectionMatrix()、setLightPosition() といったメソッドを呼び出すだけで操作できま すが、その背後では WebGPU に必要なシェーダーモジュール、パイプライン、uniform 相当 の更新が行われています。

`Node` は物体の3D空間での位置や姿勢や形状、さらに移動や回転といった3次元の動作を担当します。 

`Space` は WebGPU の特定の API に直接対応するものではありませんが、シーン内にある Node と Shape を集約し、どの視点から何を描画するかを整理するための描画管理層です。 WebGPU のネイティブ API は「何をいつ描くか」を命令として積み上げる仕組みですが、webg ではそれをシーン単位で扱えるように設計されています。space.draw(eye) は、その時 点のシーン構造を走査して必要な描画命令を発行する入口となります。

このように、本章の最小描画は WebGPU の物理的な処理を Screen、Shape、シェーダークラス、Node、Space というローレベル(低レイヤー)の部品へ整理して実装しているものです。

## 最初のアプリを構築する標準フロー

![最小描画から WebgApp への流れ](fig04_01_minimum_to_webgapp_flow.jpg)

`webg` でアプリケーションを構築する際は、以下の順序で進めることでスムーズに組み立てられます。

1. `Screen` を生成し、`await screen.ready` で準備完了を待機する。
2. シェーダーを初期化し、プロジェクション行列（projection）を設定する。
3. `Space` を生成し、視点となるノード（eye）を用意する。
4. `Shape` を生成し、`endShape()` を呼び出して形状を確定させる。
5. `clear` $\rightarrow$ `draw` $\rightarrow$ `present` の描画ループを構築する。

## ローレベル（低レイヤー）の最小実装例

まずは、最小構成で立方体を 1 つ描画する例を確認します。ここでは「`webg` で描画を実現するために本当に必要な最小限の骨格は何か」を明らかにします。

![ローレベルの最小実装例](lowlevel.jpg)

ここでは webg を展開したフォルダの中に「user」というフォルダを作成することにします。

### ファイル配置
`webg` フォルダの中に `user/lowlevel` フォルダを作成して、index.html と main.js を配置します。

```
 --+-- webg/
   |
   +-- user/
        |
        +-- lowlevel/
             |
             +- index.html
             +- main.js
```

### index.html
表示するページを index.html という名前で用意します。html のファイル名は任意のファイル名で構いません。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Low Level</title>
</head>
<body style="margin:0; overflow:hidden;">
  <canvas id="canvas" width="720" height="540"></canvas>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

### main.js

JavaScript のファイルを main.js をいう名前で用意します。 ファイルを置くフォルダの構成を変更する場合は、import 文の相対パスを適切に修正して下さい。

```js
import Screen from "../../webg/Screen.js";
import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";

const screen = new Screen(document);
await screen.ready;
screen.setClearColor([0.1, 0.15, 0.1, 1.0]);

const shader = new SmoothShader(screen.getGPU());
await shader.init();
Shape.prototype.shader = shader;

const projection = new Matrix();
projection.makeProjectionMatrix(0.1, 1000.0, 55.0, screen.getAspect()); 
shader.setProjectionMatrix(projection);
shader.setLightPosition([120.0, 180.0, 140.0, 1.0]);

const space = new Space();
const eye = space.addNode(null, "eye");
eye.setPosition(0.0, 0.0, 28.0);

const shape = new Shape(screen.getGPU());
shape.applyPrimitiveAsset(Primitive.cube(8.0, shape.getPrimitiveOptions()));
shape.endShape(); // 重要：ここでGPUバッファを確定させる
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});
const node = space.addNode(null, "obj");
node.addShape(shape);

const loop = () => {
  node.rotateY(0.8);
  node.rotateX(0.4);
  screen.clear();
  space.draw(eye);
  screen.present();
  requestAnimationFrame(loop);
};
loop();
```

このコードを読み解く際は、以下の順序を意識してください。
まず `Screen` とシェーダーを初期化し、次にビューポートとプロジェクション行列を同期させ、その後に `Space` と視点（`eye`）を作成します。続いて `Shape` を定義し、`endShape()` で GPU バッファを確定させ、最後に `clear` $\rightarrow$ `draw` $\rightarrow$ `present` の順で毎フレームの描画処理を行います。

この骨格を理解しておくことで、後述する `WebgApp` を利用した際に「どの処理が自動化されているのか」を明確に切り分けることができます。

## `WebgApp` による標準実装例

次に、先ほどの骨格を `WebgApp` で実装した例を見てみましょう。`WebgApp` を使うと、`Screen`、`Space`、入力、HUD などの土台部分が内部に集約され、記述が大幅に簡略化されます。

```js
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";

const app = new WebgApp({
  messageFontTexture: "../../webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
});
await app.init();

const orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 24.0,
    pitch: -12.0,
    minDistance: 4.0,
    maxDistance: 18.0,
    wheelZoomStep: 1.0
});

const shape = new Shape(app.getGPU());
shape.applyPrimitiveAsset(Primitive.cube(2.0, shape.getPrimitiveOptions()));
shape.endShape();

shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});

const obj = app.space.addNode(null, "obj");
obj.addShape(shape);

app.start({
  onUpdate: ({ deltaSec }) => {
    obj.rotateY(0.8);
    obj.rotateX(0.4);
  }
});
```

この例では、`Screen`、`Space`、カメラリグ、入力、HUD などの土台部分が `WebgApp` 内部に集約されています。この例では立方体が回転しているだけではなく、マウスのドラッグで視点が立方体の周りを周回したり、平行移動することも可能です。また、「F9」キーの後に「M」キーを押すことでデバッグモードへ切り替えて詳細な情報を取得することができます。

実用的なアプリケーションを構築する場合は、この `WebgApp` の構成をベースにするのが自然です。`WebgApp` の詳細については次章で解説します。

## サンプルの効果的な読み方

`webg` のサンプルを確認する際は、以下の順序で読み解くことで理解が深まります。

1. `webg/samples/index.html` で全体像を把握する。
2. 対応する `webg/samples/*/*.txt`（解説ファイル）を先に読み、そのサンプルの目的と仕様を理解する。
3. `main.js` を開き、「初期化 $\rightarrow$ 入力 $\rightarrow$ 更新 $\rightarrow$ 描画 $\rightarrow$ HUD」の順に処理を追う。

特におすすめのサンプルは、`low_level`（最小構成）、`high_level`（WebgApp構成）、`scene`（統合例）、`shapes`（形状比較）です。

## 開発時の留意事項（チェックリスト）

実装の初期段階で陥りやすい注意点をまとめました。動作しない場合はここを確認してください。

- [ ] `await screen.ready` の待機を忘れていないか。
- [ ] `shape.endShape()` を呼び出し、GPU バッファを確定させているか。
- [ ] ウィンドウのリサイズ後にプロジェクション行列（projection）を更新しているか。
- [ ] `event.key` を小文字化して比較しているか。
- [ ] 操作説明を画面（HUD）に表示し、ユーザーが操作方法を把握できる状態にあるか。
- [ ] `console.log()` だけでなく、診断情報レポート（Diagnostics）を活用しているか。
- [ ] サンプルの `*.txt` ファイルを読み、実装の意図を正しく理解しているか。

## まとめ

本章で最も重要なのは、「最初の描画を出すための骨格」と「そこから標準的なアプリケーション構成へ移行する流れ」を分けて理解することです。

ローレベルの最小例では、`Screen` $\rightarrow$ `Shader` $\rightarrow$ `Space` $\rightarrow$ `Shape` $\rightarrow$ `Loop` という一連の順序が土台となります。一方で `WebgApp` は、その土台の上にカメラ、入力、HUD、診断情報といった実用的な機能を統合的に提供します。

この構造を理解することで、以降の章で扱うモデル読み込み、アニメーション、UI、物理エンジンなどの各機能が、アプリケーションを構成する階層的な要素として理解しやすくなるはずです。

次は、第5章「WebgAppによるアプリ構成」へ進み、標準構成の詳細を深掘りしましょう。
