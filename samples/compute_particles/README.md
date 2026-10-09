# compute_particles

[English](README.en.md) | 日本語

## 概要

`ComputeParticleEmitter`を使い、49,152個の粒子をGPUで生成・更新・描画するサンプルです。利用側のコードはWGSLや粒子bufferのレイアウトを定義せず、発生位置、方向、速度、寿命を標準APIへ渡します。粒子の位置・速度・寿命はGPU上のstorage bufferで更新され、同じbufferがbillboard描画に使われます。

fountainは一つの発生要求から上向きの粒子群を作り、ringは24個の発生要求を円周上へ配置します。どちらも`ComputeParticleEmitter`の同じAPIで構成しています。発光色は線形HDRで加算合成されます。

## 実行方法

HTTPサーバー経由で[compute_particles.html](./compute_particles.html)を開いてください。WebGPUに対応したブラウザが必要です。

## 使用しているwebg機能

- `WebgApp`: Screen、カメラ、入力、Compute frame、GPU submitを初期化・管理します
- `ComputeParticleEmitter`: 発生要求、粒子storage buffer、uniform、Compute/Render pipeline、billboard描画、寿命更新をまとめます
- `GpuParticleEmitter`: 標準Emitterが継承する低水準GPU resource基盤です
- `OverlayPanel`: 操作方法、推定生存数、発生要求数、拒否数を表示します
- `Screen`: Canvasのcolor/depth viewを用意し、粒子のComputeとRenderを同じcommand encoderへ記録します

## 操作方法

- `Space`: 2,048粒の火花を追加発生
- `1`: fountainへ切り替え
- `2`: ringへ切り替え
- `P`: 粒子の移動・寿命更新を停止／再開
- `H`: Help panelを折りたたむ／表示する
- ドラッグ: カメラ回転
- `Shift` + ドラッグ: カメラ移動
- ホイール: 拡大縮小

## 実装の要点

`main.js`は`ComputeParticleEmitter`を次の設定で生成します。

```js
const emitter = new ComputeParticleEmitter(screen.getGPU(), {
  capacity: 49152,
  preset: "spark",
  targetFormat: screen.getGPU().format,
  overflow: "replace-oldest",
  simulation: { gravity: [0, -0.70, 0], drag: 0.05 },
  appearance: {
    colors: [[1.0, 0.28, 0.04], [0.04, 0.46, 1.0]],
    intensity: 1.26,
    size: [0.006, 0.018]
  }
});
```

fountainは1件の要求、ringは24件の要求として`emit()`を呼びます。1件の要求には`position`、`direction`、`spreadAngle`、`speed`、`lifetime`を指定します。発生要求とカメラ・時間はuniformへまとめて転送され、粒子の初期値生成と移動はCompute Shaderが行います。

`targetFormat`は、このサンプルのようにCanvasへ直接描画するときのswapchain formatです。PBRシーンへ登録する場合は、`WebgSceneApp.createComputeParticleEmitter()`がHDR中間画像と`ComputeParticlePass`を用意します。

表示中の`estimated`は最大寿命からCPUが管理する予約数の推定値です。通常の描画で粒子位置をCPUへ戻さないため、GPU処理の流れを維持したまま容量と発生要求を確認できます。

## 確認ポイント

- 起動直後に49,152個の粒子がfountain状に表示される
- `2`で24方向のring表示へ切り替わる
- `Space`で追加発生し、容量を超える粒子は`replace-oldest`で置き換わる
- `P`で停止中の粒子が同じ姿勢を保ち、再開後に寿命更新が進む
- Help panelの推定数、要求数、拒否数が操作に応じて変化する
- 粒子の位置をCompute Shaderで毎frame更新する
