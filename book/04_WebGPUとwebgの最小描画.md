# WebGPUとwebgの最小描画

本章では、WebGPUで一つのShapeを画面へ出すために必要な最小の流れを作り、`webg`の各クラスがブラウザ標準APIのどの処理を引き受けるかを確認します。
最小構成と`WebgApp`による標準構成を比較すると、何も表示されないときの原因を小さな範囲へ絞りながら、実用的なアプリ構成へ段階的に移れます。

## 最小描画で扱うもの

最小の3D描画は、キャンバスを管理する`Screen`、形状の見た目を決める`Shader`、描画対象を保持する`Space`、視点となる`eye`を組み合わせて構成します。
描画ループでは、画面を初期化し、シーンを描き、完成した画像を表示します。
本章では、この低水準な構成を確認した後、同じ処理を`WebgApp`で簡潔に組み立てる方法へ進みます。

APIを網羅的に暗記するのではなく、描画の土台とアプリケーションの補助機能を分け、初期化から表示までの組み立て順を追うことが本章の狙いです。

なお、サンプルの起動方法やリポジトリの配置、ローカルサーバーの構築方法を確認したい場合は、先に第2章「インストールと実行環境」を参照してください。

## 最初のアプリを構築するアプローチ

3Dアプリケーションの開発では、描画の土台、カメラ、入力、HUD（Head-Up Display：画面上へ重ねる情報表示）、診断情報、アセットの読み込みなど多くの要素を最初から盛り込むと、何も映らないなどの不具合が発生した場合に原因の切り分けが困難になります。

そこで `webg` では、以下の段階的な手法を推奨しています。

1. 低水準構成: `Screen + Space + Node + Shape` という最小単位で描画の仕組みを理解する。
2. 標準構成 (`WebgApp`): 補助機能（カメラリグ、HUD、入力管理など）を統合し、効率的に開発する。

特に、`await screen.ready` による待機と `shape.endShape()` によるバッファの確定は、非常に重要なステップです。
これらを怠ると、描画が表示されない、あるいはGPUバッファが正しく確定しないといった初歩的な問題に直面することになります。

## WebGPU APIから見た `webg` の低水準

本章では、ブラウザ標準のWebGPU APIが要求する処理を確認します。
次に、その処理を`webg`のどのクラスが担当するかを対応付けます。
この順で読むと、最小描画の全体像をつかみやすくなります。

WebGPUの標準APIでは、まずGPUアダプターとデバイスを取得します。
次にキャンバスのコンテキストを作ります。
そこへ描画パイプライン、バッファ、シェーダー、描画コマンドを順に接続します。
概念上は、描画先、GPUデータ、描画方法、コマンドの順に準備します。
最小描画でも、WebGPU側では次の処理が必要です。

- GPUDeviceの取得: GPUへコマンドを送るための本体を用意する
- GPUCanvasContextの設定: キャンバスを描画先として結び付ける
- シェーダーとパイプラインの作成: 頂点処理とピクセル処理の流れをGPU側へ定義する
- 頂点バッファやインデックスバッファの作成: 形状データをGPUメモリへ渡す
- コマンドエンコーダとレンダーパスの発行: どのフレームで何を描くかを記録し、最後に送信する

これらをアプリケーション側で直接扱うと、立方体一つでもコードが長くなります。
実用的なアプリでは、リサイズ、深度バッファ、投影更新も必要です。
さらにシーンの描画順序と複数Shapeも管理します。
`webg`の低水準APIは、これらの処理をクラス単位で分担します。

本章で最初に使う`Screen`は、描画先を管理します。
GPUCanvasContext、描画サイズ、クリア、present、レンダーパス開始を引き受けます。
`await screen.ready`は、WebGPUの準備完了を待つ操作です。
`screen.clear()`と`screen.present()`は、フレームごとのパス開始と表示に相当します。

`Shape`は、頂点データとマテリアル設定をまとめる層です。
`Primitive.cube()`などの生成結果を適用し、`endShape()`でGPUバッファを確定します。
`endShape()`を忘れると、頂点データが未完成のため描画されません。

シェーダークラスは、WebGPUのパイプライン設定とWGSL（WebGPU Shading Language：WebGPU用シェーディング言語）をまとめて扱います。
`SmoothShader`が代表例です。
アプリケーション側は、`shader.init()`、`setProjectionMatrix()`、`setLightPosition()`などを呼びます。
その背後では、シェーダーモジュール、パイプライン、ユニフォーム相当の更新が行われます。

`Node` は物体の3D空間での位置や姿勢や形状、さらに移動や回転といった3次元の動作を担当します。

`Space` はWebGPUの特定のAPIに直接対応するものではありませんが、シーン内にある `Node` と `Shape` を集約し、どの視点から何を描画するかを整理するための描画管理層です。
WebGPUのネイティブAPIは「何をいつ描くか」を命令として積み上げる仕組みですが、`webg`ではそれをシーン単位で扱えるように設計されています。
`space.draw(eye)` は、その時点のシーン構造を走査して必要な描画命令を発行する入口です。
materialの`alpha`が1.0の三角形を先に描き、1.0未満を全Shape横断で奥から手前へ並べる処理も、この入口の内部で行います。

このように、本章の最小描画はWebGPUの物理的な処理をScreen、Shape、シェーダークラス、Node、Spaceという低水準の部品へ整理して実装しているものです。

## 最初のアプリを構築する標準フロー

標準フローは、初期化、リソース作成、シーン構築、フレーム描画を決まった順序へ分け、準備前のGPUリソースを使う誤りや`endShape()`の呼び忘れを防ぐために使います。
この順序を最小例で覚えると、機能を追加した後も、どの段階で表示が止まったかを確認できます。

![最小描画からWebgAppへの流れ](fig04_01_minimum_to_webgapp_flow.jpg)

`webg` でアプリケーションを構築する際は、以下の順序で進めることでスムーズに組み立てられます。

1. `Screen` を生成し、`await screen.ready` で準備完了を待機する。
2. シェーダーを初期化し、プロジェクション行列（投影）を設定する。
3. `Space` を生成し、視点となるノード（eye）を用意する。
4. `Shape` を生成し、`endShape()` を呼び出して形状を確定させる。
5. `clear` $\rightarrow$ `draw` $\rightarrow$ `present` の描画ループを構築する。

## 低水準の最小実装例

まずは、最小構成で立方体を1つ描画する例を確認します。
ここでは「`webg` で描画を実現するために本当に必要な最小限の骨格は何か」を明らかにします。

![低水準の最小実装例](lowlevel.jpg)

ここではwebgを展開したフォルダの中に「user」というフォルダを作成することにします。

### ファイル配置
`webg` フォルダの中に `user/lowlevel` フォルダを作成して、`index.html`と`main.js`を配置します。

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

### `index.html`
表示するページを`index.html`という名前で用意します。
HTMLのファイル名は任意で構いません。

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

JavaScriptのファイルをmain.jsをいう名前で用意します。
ファイルを置くフォルダの構成を変更する場合は、import文の相対パスを適切に修正して下さい。

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
shape.endShape(); // 重要：ここで GPU バッファを確定させる
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});
const node = space.addNode(null, "obj");
node.addShape(shape);

const loop = () => {
  // 最小例のため固定角度で回す。実用コードでは deltaSec を掛ける。
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
まず `Screen` とシェーダーを初期化し、次にキャンバスのアスペクト比とプロジェクション行列を同期させ、その後に `Space` と視点（`eye`）を作成します。
続いて `Shape` を定義し、`endShape()` でGPUバッファを確定させ、最後に `clear` $\rightarrow$ `draw` $\rightarrow$ `present` の順で毎フレームの描画処理を行います。
上の低水準例は骨格を短くするため回転量を固定していますが、実用コードでは第5章と同様に経過時間を使い、refresh rateに依存しない速度へしてください。

この骨格を理解しておくことで、後述する `WebgApp` を利用した際に「どの処理が自動化されているのか」を明確に切り分けることができます。

## `WebgApp` による標準実装例

次に、先ほどの骨格を `WebgApp` で実装した例を見てみましょう。
`WebgApp` を使うと、`Screen`、`Space`、入力、HUDなどの土台部分が内部に集約され、記述が大幅に簡略化されます。

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

この例では、`Screen`、`Space`、カメラリグ、入力、HUDなどの土台部分が `WebgApp` 内部に集約されています。
この例では立方体が回転しているだけではなく、マウスのドラッグで視点が立方体の周りを周回したり、平行移動することも可能です。
また、「F9」キーの後に「M」キーを押すことでデバッグモードへ切り替えて詳細な情報を取得することができます。

実用的なアプリケーションを構築する場合は、この `WebgApp` の構成をベースにするのが自然です。
`WebgApp` の詳細については次章で解説します。

## サンプルの効果的な読み方

`webg` のサンプルを確認する際は、以下の順序で読み解くことで理解が深まります。

1. `samples/index.html` または `samples/README.md`でそのサンプルの目的と仕様を理解する。
2. `main.js` を開き、「初期化 $\rightarrow$ 入力 $\rightarrow$ 更新 $\rightarrow$ 描画 $\rightarrow$ HUD」の順に処理を追う。

特におすすめのサンプルは、`low_level`（最小構成）、`high_level`（WebgApp構成）、`scene`（統合例）、`shapes`（形状比較）です。

## 開発時の留意事項（チェックリスト）

実装の初期段階で陥りやすい注意点をまとめました。
動作しない場合はここを確認してください。

- [ ] `await screen.ready` の待機を忘れていないか。
- [ ] `shape.endShape()` を呼び出し、GPUバッファを確定させているか。
- [ ] ウィンドウのリサイズ後にプロジェクション行列（投影）を更新しているか。
- [ ] `event.key` を小文字化して比較しているか。
- [ ] 操作説明を画面（HUD）に表示し、ユーザーが操作方法を把握できる状態にあるか。
- [ ] `console.log()` だけでなく、診断情報レポート（Diagnostics）を活用しているか。
- [ ] サンプルの `*.txt` ファイルを読み、実装の意図を正しく理解しているか。

## まとめ

本章で最も重要なのは、「最初の描画を出すための骨格」と「そこから標準的なアプリケーション構成へ移行する流れ」を分けて理解することです。

低水準の最小例では、`Screen` $\rightarrow$ `Shader` $\rightarrow$ `Space` $\rightarrow$ `Shape` $\rightarrow$ `Loop` という一連の順序が土台となります。
一方で `WebgApp` は、その土台の上にカメラ、入力、HUD、診断情報といった実用的な機能を統合的に提供します。

この構造を理解することで、以降の章で扱うモデル読み込み、アニメーション、UI（User Interface：利用者との操作・表示の接点）、物理エンジンなどの各機能が、アプリケーションを構成する階層的な要素として理解しやすくなるはずです。

次は、第5章「WebgAppによるアプリ構成」へ進み、標準構成の詳細を深掘りしましょう。
