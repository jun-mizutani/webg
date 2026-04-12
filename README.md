# webg

[English](README.en.md) | [日本語](README.ja.md)

`webg` は、JavaScript から WebGPU を使って 3D アプリケーションを構築するためのライブラリです。  
外部ライブラリに依存せず、**描画、シーン、モデル、アニメーション、UI、入力、診断、TileMap、ポストプロセス**までを、ひとつの体系として扱えるように設計しています。

このリポジトリには、ライブラリ本体だけでなく、**サンプル集**、**unittest**、そして詳細な**書籍原稿**も含まれています。  
単に API を使うための道具としてだけでなく、**構造を追いながら学べること**を重視しています。

## 特徴

- **外部ライブラリ非依存**
  - 描画、シーン、アセット、アニメーション、UI、入力、TileMap までを `webg` 自身で完結
- **高水準 API と低水準 API の両立**
  - `WebgApp` を使って素早くアプリを立ち上げることも
  - `Screen`、`Shape`、`Shader`、`Matrix` などを直接扱うことも可能
- **サンプルと実装を往復しやすい**
  - `samples/` は単なるデモではなく教材
  - `unittest/` は局所的な確認と切り分けに利用可能
- **書籍付き**
  - `webg/book/` に詳細な解説原稿を同梱
  - 最初の表示から、モデル、シーン、アニメーション、TileMap、ローレベル API までを段階的に解説

## できること

`webg` では、たとえば次のような 3D アプリを構築できます。

- WebGPU を使ったブラウザ上の 3D 表示
- カメラ制御（orbit / follow / first-person）
- glTF (glb) / Collada の読み込み
- スキニングアニメーション
- HUD、メッセージ、パネル、dialogue overlay
- キーボード入力、タッチ入力、仮想ボタン
- 効果音や BGM の再生
- bloom、DOF などのポストプロセス
- タイルマップによる盤面表現とキャラクターアニメーション
- 診断情報やデバッグ表示を含む開発支援

## このリポジトリの構成

```text
webg/
  book/         書籍原稿
  samples/      サンプルアプリケーション
  unittest/     機能確認用アプリ
  webg/         ライブラリ本体
````

### 主なディレクトリ

* `webg/`

  * ライブラリ本体です
  * `Screen`、`Shape`、`WebgApp`、`ModelAsset`、`SceneLoader` などの実装があります

* `samples/`

  * 機能確認と教材を兼ねたサンプル群です
  * 各サンプルに `main.js` と `*.txt` があり、`*.txt` が概要を説明します

* `unittest/`

  * より小さな単位で切り分けや確認を行うためのアプリ群です

* `book/`

  * `webg` の詳細な解説原稿です
  * 最初の表示、アプリ構成、モデル、シーン、アニメーション、UI、TileMap、ローレベル API までを解説しています

## 最初の使い方

### 1. リポジトリを配置する

`webg` は npm パッケージとして使う前提ではなく、まずはリポジトリをそのまま配置して使う形を基本にしています。

```bash
git clone https://github.com/jun-mizutani/webg.git
cd webg
```

### 2. ローカルサーバーを立てる

サンプルや unittest は、`file://` ではなくローカルサーバー経由で開くことを推奨します。

```bash
python3 -m http.server 8000
```

ブラウザで次を開いてください。

```text
http://127.0.0.1:8000/samples/index.html
```

または

```text
http://localhost:8000/samples/index.html
```

## まず見るべきサンプル

最初の入口としては、次のサンプルが分かりやすくなります。

* `samples/low_level`

  * 最小描画の骨格を確認するためのサンプル
* `samples/high_level`

  * `WebgApp` による標準的なアプリ構成の最小例
* `samples/scene`

  * Scene JSON によるシーン初期化の入口
* `samples/gltf_loader`

  * glTF / GLB 読み込みの確認
* `samples/animation_state`

  * `AnimationState` の条件評価型の例
* `samples/janken`

  * `AnimationState` の入力駆動型の例
* `samples/tile_sim`

  * TileMap と glb actor を組み合わせた実践例

---

## 最初に読むべき章

このリポジトリには `book/` 以下に書籍原稿を同梱しています。
最初に読む流れとしては、次の順を勧めます。

1. **第2章** インストールと実行環境
2. **第3章** 3Dグラフィックスの基礎
3. **第4章** WebGPUとwebgの最小描画
4. **第5章** WebgAppによるアプリ構成

その後、目的に応じて次へ進むと理解しやすくなります。

* カメラ操作 → 第6章
* シェーダーとマテリアル → 第7章〜第9章
* モデル読み込み → 第10章
* Scene JSON → 第11章
* アニメーション → 第12章〜第13章
* UI → 第14章以降
* TileMap → 第22章以降
* ローレベル API → 第25章以降

## 最小コード例

`WebgApp` を使った最小の高水準構成は、次のような雰囲気です。

```js
import WebgApp from "./webg/WebgApp.js";
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";

const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  camera: {
    target: [0, 0, 0],
    distance: 8,
    yaw: 0,
    pitch: 0
  }
});

await app.init();

const shape = new Shape(app.getGL());
shape.applyPrimitiveAsset(Primitive.cube(2.0, shape.getPrimitiveOptions()));
shape.endShape();
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [0.22, 0.64, 0.96, 1.0]
});

const box = app.space.addNode(null, "box");
box.addShape(shape);

app.start({
  onUpdate() {
    box.rotateY(0.8);
    box.rotateX(0.4);
  }
});
```

---

## `webg` の考え方

`webg` では、似て見えても役割の異なるものを分けて扱います。

* `ModelAsset`

  * 1 モデル分の共通表現
* Scene JSON / `SceneAsset`

  * シーン全体の初期状態
* `build()`

  * 共有リソースを含むランタイム化
* `instantiate()`

  * ランタイムから新しいシーンインスタンスを生成
* `clip -> pattern -> action -> state`

  * アニメーションを層で分けて理解するための考え方

このように、`webg` は単に「動けばよい」ライブラリではなく、**構造を追いやすくすること**を重視しています。

`webg` は **外部巨大エンジンの代替** というより、**WebGPU ベースの 3D アプリを、自分で構造を追いながら構築したい人のためのライブラリ** と考えるのが適しています。


## AI と一緒に使う場合

`webg` は、外部ライブラリに強く依存せず、サンプル、unittest、書籍、コア実装を同じリポジトリの中に持っています。
そのため、生成 AI による支援とも相性が良くなっています。

AI と一緒に進める場合は、次の順で考えると分かりやすくなります。

1. まず目的に近い章を確認する
2. 対応する `samples/` を見る
3. 必要なら `unittest/` で局所的に確認する
4. 最後に `webg/` 本体実装へ降りる

## ライセンス

```text
MIT License
```

## 著者

```text
Author: Jun Mizutani
Website: https://www.mztn.org/
```
## 補足

本書と `webg` は、単なる API 集やサンプル集ではなく、
**3D アプリを構成する各層を追いながら、必要に応じて内部まで確認できること**を重視して作っています。

最初からすべてを理解する必要はありません。
まずは最小のサンプルを動かし、必要に応じて本書の該当章と対応するサンプルへ戻る、という進め方を勧めます。
