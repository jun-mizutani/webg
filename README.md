# webg

[English](README.en.md) | 日本語

`webg` は、JavaScript と WebGPU を用いて 3D アプリケーションを構築するための自己完結型ライブラリです。

描画、シェーダー、3D 数学、シーングラフ、モデルアセット、アニメーション、UI、入力、衝突判定、物理エンジン、サウンド、ポストプロセス、診断機能を一つの体系として扱います。入力では、タッチ、マウス、ペンを Pointer Events として同じジェスチャー仕様へまとめ、スマートフォン向けの直接操作を PC ブラウザ上でも確認しやすくしています。

`webg` は、単に WebGPU を薄く包むためのライブラリではありません。WebGPU 3D アプリケーションを構成するために必要な中核機能を、外部 3D エンジンに依存せず、JavaScript と WebGPU の範囲で実装したライブラリです。

[すべてのサンプルアプリケーションはここから実行できます。](https://jun-mizutani.github.io/webg/samples/index.html)

![samples](./samples/samples1.jpg)

## 設計方針

`webg` は、次の方針で設計されています。

- 外部 3D エンジンに依存しない
- WebGPU の構造を隠しすぎない
- 高水準 API と低水準 API を両立する
- サンプルからライブラリ本体へ追跡しやすくする
- 3D 数学、シェーダー、モデル、シーン、UI、入力、物理を一体として扱う
- タッチ、マウス、ペンを同じジェスチャー仕様で扱い、デバイスをまたいだ操作設計をしやすくする
- 人間にも AI にも参照しやすい構成にする
- 学習用途と実用用途の両方で使えるようにする

Three.js や Babylon.js のような大規模汎用 3D エンジンを置き換えることを直接の目的にはしていません。`webg` は、WebGPU 3D アプリケーションの構造を理解しながら、自分で制御できる規模のエンジンとして利用することを重視しています。

## 主な特徴

`webg` の特徴は、3D 描画だけを切り出すのではなく、アプリケーションを完成させるために必要な周辺機能まで同じ設計の中で扱えることです。詳細な API 名は下の「API レイヤー」や `book/` の各章で確認できます。ここでは、どのような用途に向いているかを中心に紹介します。

### WebGPU による描画基盤

`webg` は WebGPU を直接利用して 3D 描画を行います。`Screen`、`Shader`、`Shape`、`RenderTarget` などを使えば、Canvas、頂点バッファ、インデックスバッファ、テクスチャ、深度バッファ、WGSL シェーダーといった WebGPU の構造を明示的に扱えます。

一方で、`WebgApp` を使えば GPU 初期化、標準シェーダー、描画ループ、カメラ、HUD、入力、診断表示をまとめて準備できます。最初は高水準 API でアプリケーションを作り、必要になった部分だけ低水準 API へ降りて確認できる構成です。

### モデル、シーン、アニメーション

プリミティブ形状、手続き的形状、glTF / GLB、Collada、テクスチャ、法線マップ、スキニングを扱えます。モデルデータは `ModelAsset` として描画処理から分離されるため、生成、読み込み、検証、シーン配置を段階的に扱えます。

シーンは `Space` と `Node` による階層構造として構築できます。プログラムから直接組み立てることも、JSON ベースの `SceneAsset` / `SceneLoader` で読み込むこともできます。アニメーションは Tween のような単発補間から、Clip / Pattern / Action / State による状態遷移、ボーンアニメーションまでを扱います。

### UI、入力、診断

3D アプリケーションでは、描画、入力、UI、診断表示が密接に関係します。`webg` では Canvas HUD、DOM overlay、`OverlayPanel`、`DebugDock`、キーボード、マウス、タッチ、仮想ボタン、カメラ操作をアプリケーション構成の一部として扱えます。

`Touch.attachSurface()` は Pointer Events を共通入口として扱うため、スマートフォンの tap / double tap / long press / flick を PC のマウス操作でも同じ判定条件で検証できます。モバイル向け UI の調整を実機だけに閉じず、PC ブラウザの開発者ツールを使いながら確認できる点も `webg` の入力設計の特徴です。

診断機能は、描画結果だけでなく内部状態を確認しながら開発するための仕組みです。`Diagnostics`、`DebugDock`、`DebugProbe`、機能別 unittest を使うことで、AI 支援開発でも「何が起きているか」を共有しやすくしています。

### 物理、サウンド、ポストプロセス

`webg` には、シーン構造と連携する軽量な物理エンジンが含まれています。static / kinematic / dynamic body、重力、速度、反発、damping、固定 timestep、Box / Sphere / Capsule / Plane collider を使い、落下、跳ね返り、床や壁との衝突、オブジェクト同士の干渉を扱えます。

サウンドは Web Audio API を使い、効果音生成、サウンド再生、簡易シンセサイザー、バス構成、アプリケーションイベントとの連携を行います。ポストプロセスでは RenderTarget と FullscreenPass を基盤として、Bloom、DOF、Vignette などの画面効果を追加できます。

## API レイヤー

`webg` は、目的に応じて複数のレイヤーで利用できます。

| レイヤー | 主なクラス | 用途 |
|---|---|---|
| 高水準 API | `WebgApp` | アプリケーション初期化、描画ループ、カメラ、入力、UI、診断機能をまとめて扱う |
| シーン API | `Space`, `Node`, `SceneAsset`, `SceneLoader` | シーン構成、階層構造、JSON ベースのシーン読み込みを扱う |
| モデル API | `Shape`, `Primitive`, `ModelAsset`, `ModelBuilder`, `ModelLoader` | メッシュ、プリミティブ形状、外部モデル、モデルアセットを扱う |
| 数学 API | `Matrix`, `Quat` など | 3D 座標変換、回転、行列、クォータニオンを扱う |
| 描画 API | `Screen`, `Shader`, `RenderTarget`, `FullscreenPass` | WebGPU 描画処理を直接扱う |
| アニメーション API | `Tween`, `Clip`, `Pattern`, `Action`, `State` | 補間、アニメーション、状態遷移を扱う |
| 入力 API | 入力制御系クラス | キーボード、マウス、タッチ、ジェスチャー、仮想ボタンを扱う |
| 物理 API | `PhysicsSpace`, `PhysicsNode`, `Collider` 系 | 重力、衝突判定、物理挙動を扱う |
| サウンド API | `AudioSynth`, `ToneSynth`, `GameAudioSynth` | Web Audio API ベースの音声処理を扱う |
| 診断 API | `Diagnostics`, `DebugDock`, `DebugProbe` | デバッグ表示、状態確認、検証支援を扱う |

通常のアプリケーション開発では、まず `WebgApp` から使い始め、必要に応じて `Space`、`Node`、`ModelAsset`、`PhysicsSpace` などを直接扱う構成を推奨します。

## v.1.0.0 の位置づけ

`webg` v.1.0.0 は、リポジトリをそのまま配置して WebGPU 3D アプリケーションを作るための安定版として扱います。

1.0.0 で安定 API と見なす範囲は、ライブラリのコア機能である `webg/*.js` の範囲です。`README`、`book/`、`book/examples/`、`samples/`、`unittest/` で説明または利用している公開クラスとメソッドです。特に `WebgApp`、`Space`、`Node`、`Shape`、`Primitive`、`ModelAsset`、`SceneAsset`、`SceneLoader`、`InputController`、`Touch`、`OverlayPanel`、`Diagnostics`、`AudioSynth`、`ToneSynth`、`GameAudioSynth`、`PhysicsSpace`、`PhysicsNode`、Collider 系クラスは、1.0.0 以降の利用者向け API として互換性を意識して保守します。

今後、互換性に影響する変更が必要な場合は、可能な範囲で旧 API 互換を残すか、README または `book/` 側で移行方法を説明します。一方、`samples/mmodeler` などのサンプルは、ライブラリ本体 API と同じような互換性の保証の対象ではありません。

`webg` は外部パッケージを使用していないため、複雑な依存関係を解決する必要がないため、npm パッケージではなく GitHub リポジトリ ( https://github.com/jun-mizutani/webg ) と GitHub Pages 上のサンプル公開 (https://jun-mizutani.github.io/webg/samples/index.html) を前提とします。

## リポジトリ構成

```text
webg/
  book/         技術解説ドキュメント
    examples/   ドキュメント内の実行可能コード
  samples/      機能別サンプルアプリケーション
  tools/        補助ツール
  unittest/     機能検証用テストおよび最小再現環境
  webg/         ライブラリ本体
```

## 導入手順

### 1. リポジトリを取得する

```bash
git clone https://github.com/jun-mizutani/webg.git
cd webg
```

`webg` は、現時点では npm パッケージとしてではなく、リポジトリをそのまま配置して利用する構成です。

ES Modules の相対 import と、`fetch()` によるアセット読み込みを使用するため、ディレクトリ構成を保ったまま利用してください。

### 2. ローカルサーバーを起動する

WebGPU、ES Modules、アセット読み込みを正しく動作させるには、`file://` ではなく HTTP サーバー経由でアクセスする必要があります。

Python 3 を利用する場合:

```bash
python3 -m http.server 8000
```

Node.js を利用する場合:

```bash
npx http-server . -p 8000
```

### 3. サンプル一覧を開く

ブラウザで以下にアクセスします。

```text
http://localhost:8000/samples/index.html
```

## 推奨される確認順序

初めて `webg` を確認する場合は、以下の順序を推奨します。

1. [samples/index.html](https://jun-mizutani.github.io/webg/samples/index.html)
   サンプル一覧が表示されることを確認します。

2. 手早く機能の幅を確認したい場合は、次の代表サンプルを開き、同じフォルダにある `.txt` 解説も合わせて確認します。
   `samples/mmodeler/index.html` は mobile profile の UI とダブルタップ、長押し中心の入力、`samples/cube4/index.html` は基本的な 3D 表示、`samples/circular_breaker/index.html` はゲーム的な構成、`samples/physics_collider/index.html` は物理エンジンと collider の動作確認に向いています。

3. `samples/low_level`
   WebGPU の最小構成に近い描画処理を確認します。

4. `samples/high_level`
   `WebgApp` を使った標準的なアプリケーション構成を確認します。

5. `samples/scene`
   シーン、ノード、アセット読み込みを確認します。

6. `samples/gltf_loader` または `samples/collada_loader`
   外部 3D モデルの読み込みを確認します。

7. `samples/skinning`
   ボーン構造とスキニングを確認します。

8. `samples/physics_bounce` または `samples/physics_collider`
   物理エンジンと衝突判定の挙動を確認します。

9. 目的に応じて、ポストプロセス、サウンド、UI、入力などのサンプルへ進みます。

## 基本的な使い方

高水準 API を使う場合は、`WebgApp` を入口としてアプリケーションを構築します。

基本的な流れは以下の通りです。

```javascript
import WebgApp from "../../webg/WebgApp.js";

async function main() {
  const app = new WebgApp("webgpu-canvas");

  await app.init();

  // モデル、ノード、シーン、UI、入力などをここで設定します。

  app.start({
    onUpdate: (deltaTime) => {
      // 毎フレームの更新処理をここに書きます。
    }
  });
}

main();
```

実際の描画、モデル追加、カメラ操作、物理エンジンとの連携については、`samples/` 配下の各サンプルを参照してください。

## ドキュメント

`book/` には、`webg` の設計と使い方を章立てで解説した技術文書が含まれています。インストール、3D グラフィックスの基礎、WebGPU の最小描画、`WebgApp` による構成、カメラ、シェーダー、モデルアセット、シーン、アニメーション、UI、入力、衝突判定、サウンド、診断情報、ポストプロセス、ローレベル API、スキニング、物理エンジンまでを段階的に扱います。

初めて読む場合は、まず第2章から第6章までで実行環境、最小描画、`WebgApp`、カメラ制御を確認し、その後に必要な機能の章へ進むと理解しやすくなります。

## サンプル

[samples/](https://jun-mizutani.github.io/webg/samples/index.html) には、機能別のサンプルアプリケーションが含まれています。低水準描画、高水準 API、外部モデル読み込み、シーン読み込み、スキニング、アニメーション、UI、入力、Raycast、ポストプロセス、サウンド、物理、衝突判定、モデル編集などを実際に動かして確認できます。

各サンプルには実装ファイルだけでなく説明テキストも用意しています。サンプルは単なるデモではなく、機能の使い方を確認するための参照実装として利用できます。

## テストと検証

[unittest/](https://jun-mizutani.github.io/webg/unittest/index.html) には、機能ごとの検証用ページが含まれています。API 契約、入力制御、メッセージ表示、OverlayPanel、物理、Raycast、Primitive、スキニング、タッチ入力、Tween、Vignette などを小さな単位で確認できます。

これらは、機能追加や修正時の回帰確認だけでなく、AI 支援開発時に「この API はどの条件でどう動くか」を確認する仕様資料としても利用できます。

## AI 支援開発での利用

`webg` は、AI 支援開発で参照しやすいように、設計説明、API 一覧、サンプル、機能別ドキュメントを含んでいます。

AI に `webg` を使ったコード生成や修正を依頼する場合は、以下のファイルを参照させることを推奨します。

- `book/付録A_コーディングAIの皆さまへ.md`
- `book/AppendixA_For_Coding_AI.md`
- `book/付録B_API一覧.md`
- 関連する `samples/` 配下の実装例
- 関連する `unittest/` 配下の検証用ページ

AI に依頼する場合は、単に「WebGPU のコードを書いて」と依頼するよりも、使用したい `webg` の API、対象サンプル、期待するノード構成、入力方式、物理挙動などを明示すると、より正確なコードを得やすくなります。

## 対応環境

`webg` は WebGPU に対応したモダンブラウザでの動作を前提としています。スマホでは最新のバージョンでのみ動作確認を行っています。

推奨環境は以下の通りです。

- Google Chrome
- Microsoft Edge
- Firefox
- Safari

ただし、WebGPU の実装状況や GPU ドライバの違いにより、ブラウザ、OS、GPU ごとに挙動が異なる場合があります。

問題が発生した場合は、以下を確認してください。

- WebGPU 対応ブラウザを使用しているか
- `file://` ではなく HTTP サーバー経由で開いているか
- ブラウザの WebGPU 設定が有効か
- GPU ドライバが古くないか
- ブラウザの開発者ツールに WebGPU 初期化エラーが出ていないか
- サンプルの相対パスが崩れていないか

## ライセンス

MIT License

## 著者

- Author: Jun Mizutani
- Website: https://www.mztn.org/
