# falling_dominoes_cpu

[English](README.en.md) | 日本語

## 概要

`samples/falling_dominoes`と同じ32個のドミノを、通常の`PhysicsSpace`でシミュレーションするサンプルです。左端のドミノだけへ初期角速度を与え、後続31個へBox接触を順番に伝えます。Compute版と同じ寸法、質量、重力、反発係数、摩擦係数、固定刻み、solver反復数、sleep条件、カメラを使い、GPU上でBodyStateを更新する方式と、CPU上で`PhysicsNode`を更新する方式を比較できます。

CPU版のBox/Plane接触は、`PhysicsSpace`のCPU接触処理を使います。`BoxCollider`、`PlaneCollider`、`PhysicsNode`を通常のwebg APIで登録し、Plane Nodeをsolverの明示的なPlane入力へ変換します。画面に見える床板は描画専用Nodeとして分け、物理Planeと二重に接触計算しません。

## 実行方法

実行ファイルは[`falling_dominoes_cpu.html`](./falling_dominoes_cpu.html)です。WebGPU対応ブラウザで開くと、画面中央のドミノ列が左から右へ順番に倒れます。WebGPUは通常のscene描画に使い、物理更新はCPUの`PhysicsSpace`が行い、結果を`PhysicsNode`へ同期します。Help Panelは起動時に畳まれているため、`H`で展開するとframe間隔、GPU Render時間・負荷率、JavaScript時間・負荷率、active body数、sleeping body数、fixed step数を確認できます。

初期カメラはCompute版と同じく、`target=(-0.16, -0.13, -0.06)`、`distance=0.28`、`yaw=-67.19`、`pitch=-43.59`、`roll=-29.93`、`fovX=70.00`です。ドラッグ、ホイール、キー、pinchによるzoom速度もCompute版と同じ設定です。

## 使用しているwebg機能

- `WebgApp`: WebGPU、canvas、depth texture、カメラ、入力、Help Panel、frame計測を初期化する
 - `PhysicsSpace`: fixed step、予測AABB、候補生成、Box/Plane接触、摩擦、反発、position correction、persistent sleepをCPU上で処理する
- `PhysicsNode`: CPU物理状態を保持し、solverが更新した位置・姿勢・速度・sleep状態をsceneへ反映する
- `BoxCollider`: ドミノの有限サイズBoxの接触形状と慣性を提供する
- `PlaneCollider`: 無限床の接触形状を提供する
- `Primitive`と`Shape`: PhysicsNodeへ追加するドミノと床板の描画形状を作る
- `buildHelpPanelOptions()`: 起動時に畳まれたHelp Panelを作り、frame計測と物理状態を表示する

## 操作方法

- `Space`: 先頭ドミノへ角速度を加えて連鎖を再開する
- `P`: pause / resume
- `R`: 初期配置へresetする
- `H`: Help Panelの展開 / 折りたたみ
- ドラッグ: camera orbit
- ホイール: zoom

## 確認内容

起動直後に先頭の赤いドミノが倒れ、後続のドミノへ接触が伝わることを確認します。ドミノが床Planeをすり抜けず、倒れたbodyが床上に残ること、最後に複数bodyがsleepしてHelp Panelのsleeping数へ反映されることを確認します。Compute版との比較では、連鎖の順序、床による支持、最終的な停止という動作が同等であることを確認するサンプルです。

## 実装の流れ

`createInitialDescriptors()`は、Compute版と同じ32体の位置、Box寸法、質量、初期角速度、材質値を生成します。CPUの`PhysicsNode`が角速度をdegree/secで保持するため、descriptorのrad/secを`PhysicsNode`へ渡す境界でdegree/secへ変換します。変換後もHelp Panelの速度表示はrad/secへ戻して、Compute版の表示単位と合わせています。

`createPhysicsSpace()`はfixed stepを120Hz、solver反復数を10、最大sub step数を4として、Compute版のBox候補余白、support feature許容値、位置補正slop、sleep・wake閾値を`PhysicsSpace`へ設定します。床は`PlaneCollider`付きstatic `PhysicsNode`として`PhysicsSpace`へ登録し、画面に見える薄い床板は描画専用の通常Nodeとして別に作ります。PhysicsSpaceは登録されたPlaneをsolver入力へ変換するため、boundsから別のPlaneを追加しません。

各frameでは`PhysicsSpace.step(deltaMs)`が実時間をfixed stepへ分配し、各fixed stepで重力積分、damping、姿勢積分、予測AABB、候補生成、Box/Plane接触、local impulse solver、position correction、sleep判定を実行します。solverが更新した`PhysicsNode`は通常の`WebgApp` scene描画で表示されるため、GPU BodyStateをvertex shaderから直接読むCompute版とは描画状態の受け渡しが異なります。

`R`によるresetではページを再読み込みし、PhysicsSpace、PhysicsNode、接触履歴、sleep状態を初期条件から作り直します。各試行は接触履歴と時間accumulatorを初期化して開始します。
