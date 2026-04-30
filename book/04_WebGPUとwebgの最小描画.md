# WebGPUとwebgの最小描画

この章では、`webg` で最初の 3D アプリケーションを動作させるまでの流れを解説します。`webg` を使い始める際に重要なのは、API を網羅的に暗記することではなく、「どのような順序でプログラムを組み立てればよいか」という全体像を理解することです。

そのため本章では、まず描画の基礎的な構造を実装して動作を確認し、その後に `WebgApp` を用いた標準的なアプリケーション構成へと進む流れで解説します。ローレベル（低レイヤー）の最小構成と `WebgApp` の構成を分けて考えることで、どこまでが描画の土台であり、どこからがアプリケーションとしての補助機能なのかを明確に切り分けることができます。

なお、サンプルの起動方法やリポジトリの配置、ローカルサーバーの構築方法を確認したい場合は、先に第2章「インストールと実行環境」を参照してください。本章では、準備が整った状態で「最初のアプリをどう構築するか」という点に集中して進めていきます。

ここで意識していただきたいのは、理解を深めるためには、最初からローレベル（低レイヤー）の操作と `WebgApp` の機能を混ぜて考えないほうが効率的だということです。描画の仕組みそのものを理解したい場合は `Screen + Space + Shape` という最小単位から始め、小規模なアプリを迅速に作りたい場合は `WebgApp` から始めるのが自然です。

特に、`await screen.ready` による待機と `shape.endShape()` によるバッファの確定は、非常に重要なステップです。これらを怠ると、描画が表示されない、あるいは GPU バッファが正しく確定しないといった初歩的な問題に直面することになります。また、`webg` ではカメラ、HUD、診断情報、入力を単なる「後付けのオプション」とは考えません。視覚的な表示だけでなく、操作説明や状態表示、調査用レポートまでをアプリケーションの不可欠な構成要素として扱う設計思想を採用しています。

## 最初のアプリを構築するアプローチ

3D アプリケーションの初期実装では、描画の土台、カメラ、入力、HUD、診断情報、アセットの読み込みなどを同時に実装しがちです。しかし、最初から多くの要素を盛り込むと、不具合が発生した際に原因の切り分けが困難になります。

そこで `webg` では、描画の土台から標準構成へと段階的にステップアップする手法を推奨しています。まずコアとなる最小構成を把握し、その後に `WebgApp` による標準構成へ移行することで、機能の依存関係を整理して理解できるようになります。

本章の目的は、個々のメソッド名を暗記することではなく、描画が行われるまでに最低限必要な処理フローを掴むことです。そのうえで、HUD、診断情報、タッチ入力、音声などの機能をどのタイミングで追加すべきかという指針を得ることが目標です。詳細なクラスやメソッドの仕様を確認したい場合は、付録の「API 一覧」を活用してください。

実装の過程で特に注意すべき点は、`await screen.ready` を待たずに初期化を進めてしまうことや、`shape.endShape()` の呼び出しを忘れること、リサイズ後にプロジェクション行列（projection）を更新しないことなどです。また、操作方法を画面上に明示せずコード上の前提だけで進めたり、調査時に `console.log()` だけに頼って診断情報レポートを活用しなかったりすることも、開発効率を下げる要因となります。さらに、サンプルを検討する際は `main.js` だけでなく、必ず `*.txt` の説明ファイルを確認するようにしてください。

## WebGPU API から見た `webg` の低レイヤー

第3章で見た 3D 描画の考え方を、実際にブラウザ上で動かすときの土台になるのが WebGPU です。`webg` のローレベル（低レイヤー）のクラスは、この WebGPU を直接扱いやすい単位へ整理したものです。したがって、第4章の最小描画を理解するうえでは、「ブラウザ標準の WebGPU API で何をしなければならないか」と、「それを `webg` がどのクラスへ分担しているか」を対応づけて読むと全体像がつかみやすくなります。

WebGPU の生の API では、まず GPU アダプタとデバイスを取得し、canvas に対応するコンテキストを作り、そこへレンダーパイプライン、バッファ、シェーダー、描画コマンドを順に接続していきます。概念的には「描画先を準備する」「GPU に渡すデータを作る」「どのシェーダーでどう描くかを決める」「コマンドを発行して表示する」という流れです。たとえば最小描画でも、WebGPU 側では次のような処理を行います。

- `GPUDevice` の取得: GPU へコマンドを送るための本体を用意する
- `GPUCanvasContext` の設定: canvas を描画先として結び付ける
- シェーダーとパイプラインの作成: 頂点処理とピクセル処理の流れを GPU 側へ定義する
- 頂点バッファやインデックスバッファの作成: 形状データを GPU メモリへ渡す
- コマンドエンコーダとレンダーパスの発行: どのフレームで何を描くかを記録し、最後に送信する

これをすべてアプリケーション側で毎回直接扱うのは、最初の三角形や立方体を描く段階でもかなり冗長です。さらに、3D アプリケーションになると、単なる canvas 初期化だけでなく、リサイズへの追従、深度バッファの用意、投影行列の更新、シーン全体の描画順序、複数形状の管理まで必要になります。`webg` の低レイヤーは、この煩雑さをクラス単位で分担していると考えると理解しやすくなります。

第4章で最初に使う `Screen` は、WebGPU 側でいえば `GPUCanvasContext`、描画サイズ、クリア、プレゼント、レンダーパス開始といった「描画先まわり」の処理を引き受ける入口です。`await screen.ready` を待つという操作は、単なる儀式ではなく、内部で WebGPU の利用準備が整うまで待機していることを意味します。`screen.clear()` と `screen.present()` は、WebGPU でいえばフレームごとのレンダーパスの開始と表示する処理です。

`Shape` は、WebGPU に渡す頂点データや材質設定をまとめる層です。`Primitive.cube()` のような形状生成結果を `Shape` へ適用し、`endShape()` を呼ぶと、CPU 側で持っていた形状情報が GPU バッファとして確定します。したがって `shape.endShape()` を忘れると描画できないのは、WebGPU へ渡すべき頂点データがまだ完成していないのと同じ意味になります。

シェーダーについては、`SmoothShader` のようなクラスが WebGPU のパイプライン設定と WGSL シェーダーをまとめて扱う層です。アプリ側から見ると `shader.init()`、`setProjectionMatrix()`、`setLightPosition()` のような呼び出しだけで扱えますが、その背後では WebGPU に必要なシェーダーモジュール、パイプライン、uniform 相当の更新が行われています。ここも `webg` が低レイヤーを包んでいる部分です。

`Space` は WebGPU に直接対応する1個の API ではありませんが、シーン内にある `Node` と `Shape` を集約し、どの視点から何を描くかを整理するための描画管理層です。WebGPU の生 API は「何をいつ描くか」を命令として積み上げる仕組みですが、`webg` ではそれをシーン単位で扱えるようにしてあります。`space.draw(eye)` は、その時点のシーン構造をたどって必要な描画命令を発行する入口だと考えると分かりやすくなります。

この対応関係を踏まえると、第4章の最小描画は「WebGPU を使わずに別の仕組みで描いている」のではなく、「WebGPU の物理的な処理を、`Screen`、`Shape`、シェーダークラス、`Space` という低レイヤーの部品へ整理した形」で描いていることが分かります。したがって、本章のローレベル例は、WebGPU を隠して魔法のように簡略化しているのではなく、WebGPU に必要な仕事を扱いやすい単位へ分割して見せていると捉えるのが適切です。

## 最初のアプリを構築する標準フロー

![最小描画から WebgApp への流れ](fig04_01_minimum_to_webgapp_flow.jpg)

*最初は Screen、Shader、Space、Shape、描画ループの骨格を押さえ、そのあとで WebgApp の標準構成へ進むことで、補助機能の位置づけが明確になります。*

`webg` でアプリケーションを構築する際は、以下の順序で進めることでスムーズに組み立てられます。

1. `Screen` を生成し、`await screen.ready` で準備完了を待機する。
2. シェーダーとプロジェクション行列（projection）を初期化する。
3. `Space` を生成し、視点となるノードを用意する。
4. `Shape` を生成し、`endShape()` を呼び出して形状を確定させる。
5. `clear` $\rightarrow$ `draw` $\rightarrow$ `present` の描画ループを構築する。

必要に応じて、これらの処理を `WebgApp` へ移行させ、HUD、カメラ、タッチ入力、診断情報などの機能を統合していきます。

このフローは大きく二段階に分かれています。第一段階では、ローレベル（低レイヤー）な視点から描画の骨格を理解し、`Screen`、シェーダー、プロジェクション、`Space`、`Shape`、および描画ループの相互関係を把握します。第二段階では、`WebgApp` を用いてアプリケーションとしての標準構成に載せます。カメラ、HUD、タッチ入力、診断情報、デバッグドックなどを組み込みたい場合は、この段階的なアプローチが最も自然です。

## ローレベル（低レイヤー）の最小実装例

まずは、最小構成で立方体を 1 つ描画する例を確認します。ここでは「`webg` で描画を実現するために本当に必要な最小限の骨格は何か」を明らかにします。

```js
import Screen from "./webg/Screen.js";
import Space from "./webg/Space.js";
import Primitive from "./webg/Primitive.js";
import Shape from "./webg/Shape.js";
import Matrix from "./webg/Matrix.js";
import SmoothShader from "./webg/SmoothShader.js";

const screen = new Screen(document);
await screen.ready;
screen.setClearColor([0.1, 0.15, 0.1, 1.0]);

const shader = new SmoothShader(screen.getGL());
await shader.init();
Shape.prototype.shader = shader;

const projection = new Matrix();
const applyViewportLayout = () => {
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
applyViewportLayout();
window.addEventListener("resize", applyViewportLayout);
window.addEventListener("orientationchange", applyViewportLayout);

shader.setLightPosition([120.0, 180.0, 140.0, 1.0]);

const space = new Space();
const eye = space.addNode(null, "eye");
eye.setPosition(0.0, 0.0, 28.0);

const shape = new Shape(screen.getGL());
shape.applyPrimitiveAsset(Primitive.cube(8.0, shape.getPrimitiveOptions()));
shape.endShape();
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

この骨格を理解しておくことで、後述する `WebgApp` を利用した際に「どの処理が自動化されているのか」を明確に切り分けることができます。逆に、この基礎を知らずに `WebgApp` だけを利用すると、最小限の描画処理と補助機能の境界が見えにくくなります。

## `WebgApp` による標準実装例

次に、先ほどの考え方を `WebgApp` で実装した例を見てみましょう。ここでは、ローレベル（低レイヤー）で理解した骨格が、実際のアプリケーション構成においてどのように整理されるかを確認します。

```js
import WebgApp from "./webg/WebgApp.js";
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";
import EyeRig from "./webg/EyeRig.js";

const CAMERA_CONFIG = {
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 0.0,
  pitch: 0.0,
  roll: 0.0
};

const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
  camera: CAMERA_CONFIG
});

await app.init();

const shape = new Shape(app.getGL());
shape.applyPrimitiveAsset(Primitive.cube(2.0, shape.getPrimitiveOptions()));
shape.endShape();
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});

const obj = app.space.addNode(null, "obj");
obj.addShape(shape);

const orbit = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
  document,
  element: app.screen.canvas,
  input: app.input,
  type: "orbit",
  orbit: {
    target: CAMERA_CONFIG.target,
    distance: CAMERA_CONFIG.distance,
    yaw: CAMERA_CONFIG.yaw,
    pitch: CAMERA_CONFIG.pitch,
    minDistance: 4.0,
    maxDistance: 18.0,
    wheelZoomStep: 1.0
  }
});
orbit.attachPointer();

app.message.setLines("guide", [
  "Drag: orbit",
  "2-finger drag: pan",
  "Pinch / wheel: zoom"
], {
  anchor: "bottom-left",
  x: 0,
  y: -2
});

app.message.setLines("status", [
  "Manual example",
  "WebgApp + EyeRig"
], {
  anchor: "top-left",
  x: 0,
  y: 0
});

app.start({
  onUpdate: ({ deltaSec }) => {
    orbit.update(deltaSec);
    obj.rotateY(0.8);
    obj.rotateX(0.4);
  }
});
```

この例では、`Screen`、`Space`、カメラリグ、入力、HUD などの土台部分が `WebgApp` 内部に集約されています。また、ガイドラインやステータス行を容易に画面へ表示できる点、`EyeRig` を追加するだけでマウスやタッチによる視点操作を実装できる点、そして `start({ onUpdate })` メソッドによって標準的な更新ループに乗り出せる点が大きな利点です。

実用的なアプリケーションを構築する場合は、この `WebgApp` の構成をベースにするのが自然です。「描画の骨格を理解するためのローレベル例」と「アプリの標準構成を理解するための `WebgApp` 例」と分けて捉えることで、迷いなく実装を進めることができます。

## 最小描画のあとに拡張すべき要素

`webg` では、HUD や診断情報を後から無理に付け足すのではなく、初期段階からアプリケーションの構造に組み込んでおくことで、管理が容易になります。

- テキスト表示: 短い操作説明や状態表示には `Message` の `setLine()` / `setLines()` を使用し、詳細な説明やエラー理由の提示には `OverlayPanel` 系の panel を使用します。
- デバッグ・調査: 調査用レポートには `Diagnostics` と `DebugProbe` を活用し、シーン上に重ねる UI には `DialogueOverlay` や `UIPanel` を使用します。

ここでは詳細な使い方まで習得する必要はありませんが、「表示周りの機能も描画と同様に、アプリケーション構造の一部として扱う」という考え方を押さえておいてください。

入力系については、キーボードの比較名を小文字に統一することが基本です。タッチ入力まで統合的に管理したい場合は `Touch` と `InputController` を使用します。また、カメラ操作を標準的なヘルパーで実装したい場合は、`EyeRig` が最適なエントリーポイントとなります。

今後、モデルの読み込み、シーンの JSON 化、アニメーション、音声、ポストプロセスへと機能を拡張していく際は、これらの層を一つずつ積み上げていく方法を推奨します。すべてを同時に実装するのではなく、「描画 $\rightarrow$ 入力 $\rightarrow$ アセット $\rightarrow$ アニメーション $\rightarrow$ 音声」の順に構築することで、問題が発生した際の切り分けが容易になります。

## サンプルの効果的な読み方

サンプルコードを確認する際は、以下の順序で追うと理解がスムーズになります。

1. `webg/samples/index.html` で全体像を把握する。
2. 対応する `webg/samples/*/*.txt` を読み、そのサンプルの目的と仕様を理解する。
3. `main.js` を開き、「初期化 $\rightarrow$ 入力 $\rightarrow$ 更新 $\rightarrow$ 描画 $\rightarrow$ HUD」の順に処理を追う。

特におすすめのサンプルは、`low_level`、`high_level`、`scene`、`shapes`、`gltf_loader`、`sound` です。`main.js` だけを見るのではなく、必ず `*.txt` とセットで読むことで、「何を目的とした実装なのか」と「どのように実現しているのか」を正しく結びつけることができます。

## よくあるミスと次章への案内

実装の初期段階で陥りやすいミスを以下にまとめます。これらをチェックリストとして活用してください。

- `await screen.ready` の待機を忘れている。
- `shape.endShape()` を呼び出していないため、GPU バッファが確定していない。
- ウィンドウのリサイズ後にプロジェクション行列（projection）を更新していない。
- `event.key` を小文字化せずに比較している。
- 操作説明を画面に表示せず、開発者の想定だけで実装を進めている。
- 診断情報レポートを活用せず、`console.log()` だけでの追跡に頼っている。
- `webg/samples/*/*.txt` を読まずに `main.js` だけを見て判断している。

本章は、こうした失敗を避け、開発の基準を揃えるためのガイドとして構成されています。

この章の次は、第5章「WebgAppによるアプリ構成」へ進むのが最も自然な流れです。本章で触れた `WebgApp` の標準例をさらに深く掘り下げ、3D シーンの概念と結びつけて解説します。もしカメラ制御について先に詳しく知りたい場合は、第6章「カメラ制御とEyeRig」を参照してください。

## まとめ

本章で最も重要なのは、「最初の描画を出すための骨格」と「そこから標準的なアプリケーション構成へ移行する流れ」を分けて理解することです。

ローレベル（低レイヤー）の最小例では、`Screen`、シェーダー、プロジェクション、`Space`、`Shape`、そして `clear` $\rightarrow$ `draw` $\rightarrow$ `present` という一連の順序が土台となります。一方で `WebgApp` は、その土台の上にカメラ、入力、HUD、診断情報といったアプリケーションとしての標準機能を統合的に提供します。

この構造を理解することで、以降の章で扱うモデル、シーン、UI、入力、診断情報などの各機能が、単なる独立した機能ではなく、一つのアプリケーションを構成する階層的な要素として理解しやすくなるはずです。
