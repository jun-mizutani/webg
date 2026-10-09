# falling_box

[English](README.en.md) | 日本語

## 概要

200体のBox落下シナリオをCPU版とCompute版で比較します。CPU版は通常の`PhysicsSpace`を使い、Box/Plane接触にはCPUのBox接触処理を適用します。Compute版はコアの`ComputePhysicsSpace`を使用します。両方とも同じseed、初期配置、姿勢、角速度、重力、五つのPlane境界、fixed step、solver反復数、sleep条件で開始します。

## 実行方法

 - [CPU版 falling_box_cpu.html](./falling_box_cpu.html): `PhysicsNode`と`PlaneCollider`を通常の`PhysicsSpace`へ登録します
- [Compute版 falling_box_compute.html](./falling_box_compute.html): `ComputePhysicsSpace`のGPU BodyStateとWGSL solverを使い、Boxをinstance描画します

どちらもWebGPU対応ブラウザで開いてください。起動時のHelp Panelは畳まれています。`H`で展開するとframe間隔、GPU Render時間・負荷率、JavaScript時間・負荷率、active body数、sleeping body数、fixed step数を確認できます。

## 使用しているwebg機能

- `WebgApp`: WebGPU、canvas、depth texture、camera、入力、Help Panel、frame計測を初期化する
 - `PhysicsSpace`: CPU版のfixed step、Box/Plane接触、摩擦、反発、position correction、persistent sleepを処理し、結果を`PhysicsNode`へ同期する
- `ComputePhysicsSpace`: Compute版のGPU BodyState、予測AABB、XZ Grid、candidate bitset、combined solver、persistent sleepを処理する
- `PhysicsNode`、`BoxCollider`、`PlaneCollider`: CPU版のBox bodyと無限Plane境界を構成する
- `Primitive`、`Shape`: CPU版の実寸Boxと、Compute版のinstance描画用unit cubeを作る
- `getRenderState()`: Compute版の最新ping-pong BodyStateを描画へ渡す

## 共通シナリオ

初期条件は`fallingBoxScenario.js`へまとめています。200体を4列×4行のlayerとして配置し、seed`20260822`から配置の揺らぎを再現します。各bodyはBoxで、五つのPlaneは床と四壁を表します。重力は`-4.9m/s²`、fixed stepは`1/120s`、solver反復数は14です。

CPU版では各descriptorを`PhysicsNode`と`BoxCollider`へ変換し、五つのPlaneをstaticな`PhysicsNode`として`PhysicsSpace`へ登録します。`PhysicsSpace`は登録したPlaneをsolver入力へ変換し、登録NodeのBox/Plane接触を一つのCPU処理で解決します。表示用の床板は物理Planeとは別の通常Nodeとして作るため、床を二重に接触計算しません。Compute版では同じdescriptorをGPU BodyStateへ変換し、`ComputePhysicsSpace`へ登録します。CPU PhysicsNodeの角速度はdegree/secで保持されるため、共通descriptorのrad/secからNodeへ同期する境界で変換します。

## 確認内容

同じシナリオをCPU版とCompute版で起動し、200体が落下して境界Planeと接触し、衝突後に停止へ向かうことを確認します。目的は、同じ初期条件から物体群が落下し、接触し、sleepへ向かう処理全体を両backendで確認することです。CPU版はPhysicsNodeのscene描画、Compute版はGPU BodyStateのinstance描画という状態受け渡しの違いも比較できます。CPU版は`PhysicsSpace`の通常APIだけを使い、Box/Plane接触はコアのCPU接触処理を使います。

## 操作方法

- `P`または`Space`: pause / resume
- `R`: ページを再読み込みして初期条件へreset
- `H`: Help Panelの展開 / 折りたたみ
- ドラッグ: camera orbit
- ホイール: zoom
