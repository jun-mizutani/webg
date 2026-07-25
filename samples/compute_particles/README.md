# compute_particles

[English](README.en.md) | 日本語

![compute_particles](./compute_particles.jpg)

## 概要
- WebGPU の Compute Shader を使い、大量の粒子を GPU 側で更新して描画するサンプルです
- webg コアの `GpuParticleEmitter` を使い、粒子用GPU resourceとCompute/Render Passの記録を共通化しています
- 粒子の位置、速度、寿命、色、サイズを storage buffer に保持し、compute pass が毎フレーム更新します
- render pass は同じ storage buffer を vertex shader で読み、1 粒子を 2 triangle の billboard quad として instanced draw します
- `GpuParticleEmitter` が粒子Buffer、uniform、Compute/Render pipeline、command encodeを管理します
- GPU から CPU へ粒子位置を readback しないため、CPU 側は個別粒子の移動計算を行いません
- ドラッグ、Shift + ドラッグ、ホイールで orbit camera を動かし、GPU 上の粒子群を別角度や別位置から確認できます

## 実行方法
- 実行ファイルは [./compute_particles.html](./compute_particles.html) です
- WebGPU に対応したブラウザで開き、必要に応じて help panel や HUD と合わせて確認してください

## 使用している webg 機能
- WebgApp: Screen、diagnostics、入力基盤をまとめて初期化する
- WebgApp computeFrame: `computeFrame: true`と`onComputeFrame` handlerで、標準scene描画を行わずcompute / renderの順序を制御する
- GpuParticleEmitter: 粒子Storage Buffer、billboard quad、uniform、Compute/Render pipeline、pass encode、resource破棄を管理する
- Screen.resize(): WebgApp が保持する Screen を通じて viewport 変更時の canvas 実ピクセルを更新する
- WebgApp.getGPU(): GpuParticleEmitterとサンプル固有のframe処理へWebGPU contextを渡す
- buildHelpPanelOptions() + showOverlayPanel(): 読ませる操作説明と現在状態を OverlayPanel の help panel として表示する

## 使用している WebGPU 機能
- storage buffer: Particle 配列を GPU 側の読み書き可能なデータとして保持
- uniform buffer: deltaTime、frame、screen size、emitter mode を shader へ渡す
- orbit camera uniform: yaw、pitch、distance、targetY、pan offset を render shader へ渡し、粒子群を view 変換して描画する
- compute pipeline: 1 invocation = 1 particle として位置、速度、寿命を更新
- render pipeline: storage buffer を vertex shader から読み、instanced billboard として描画
- alpha blending: 粒子が重なっても白く溶けすぎないよう、輪郭が残る標準 alpha 合成で描画する
- timestamp query: Compute PassとRender PassのGPU時間を取得し、各区間と合計のloadを表示する

## 確認ポイント
- 起動後に 49,152 個の粒子が噴水状に表示されることを確認します
- Space を押すと、一部粒子が再生成され、瞬間的な burst が見えることを確認します
- 1 / 2 で emitter mode が fountain / ring に切り替わることを確認します
- ドラッグで orbit、Shift + ドラッグで pan、ホイールで zoom できることを確認します
- P で pause したとき、粒子更新が止まり、描画だけが継続することを確認します
- H で OverlayPanel の help panel を畳み、再度 H または Show Help ボタンで再表示できることを確認します
- Help panelの`GPU compute / GPU render / GPU total / JS time`と各loadが更新されることを確認します。timestamp-query非対応時はGPU timingがunavailableと表示されます
- ブラウザの devtools を見る場合、CPU が粒子数分の位置更新ループを毎フレーム実行していないことを確認します

## 操作方法
- Space: burst
- ドラッグ: camera orbit
- Shift + ドラッグ: camera pan
- ホイール: zoom
- 1: fountain emitter
- 2: ring emitter
- P: pause / resume
- H: hide / show help

## 実装の詳細
- main.js の compute shader は storage buffer の同じ index だけを書き換えるため、粒子同士の書き込み競合を避けています
- 粒子のspawn、重力、渦、床反発、色、寿命はサンプル固有WGSLに残し、GpuParticleEmitterはアルゴリズムを固定しません
- GpuParticleEmitterはcommand encoderとsubmitを所有せず、WebgAppのcomputeFrame handlerがCompute、Render、timestamp queryの順序を決めます
- render shader は point-list ではなく billboard quad を instanced draw しているため、粒子サイズ、輪郭、alpha falloff を shader で制御できます
- camera 操作は render shader の view 変換だけで行い、pan は投影後の offset を uniform で渡すため、GPU から CPU へ位置を戻さない構成を保っています
- 操作説明と状態表示は独自 DOM HUD ではなく OverlayPanel の help panel にまとめ、本文を畳める標準 UI として構成しています
- 大量の視覚効果や背景演出向けの Compute Shader 利用例として確認できます
