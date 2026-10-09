# joint

`joint` は、同じ重力JointシナリオをCPU版とGPU Compute版で比較するサンプルファミリーです。`joint_cpu_node` はwebgコアのCPU版 `PhysicsSpace` と通常の `Node` 描画、`joint_compute` は `ComputePhysicsSpace` のGPU Joint bufferとWGSL XPBD solverによるGPU直接描画、`joint_compute_node` はGPU物理の状態をreadbackして通常のCPU側 `Node` へ同期する描画を確認します

三つのアプリは、振り子、6本の吊りロープ、ロープ中央を横切るkinematic Capsuleからなる同じシナリオを使います。初期位置、Joint距離、ロープ寸法、Capsule姿勢、カメラは `jointScenario.js` にまとめているため、処理方式の違いを同じ条件で比較できます。色は描画経路を見分けるために方式ごとに変えています

## 実行

リポジトリのルートでHTTP serverを起動し、WebGPU対応ブラウザーで次のいずれかを開きます

```text
http://localhost:8765/samples/joint/joint_cpu_node.html
http://localhost:8765/samples/joint/joint_compute.html
http://localhost:8765/samples/joint/joint_compute_node.html
```

各方式の詳しい説明は、[joint_cpu_node.md](./joint_cpu_node.md)、[joint_compute.md](./joint_compute.md)、[joint_compute_node.md](./joint_compute_node.md)と、それぞれの英語版に記載しています

## 三つの描画経路

`joint_cpu_node` は `PhysicsSpace.stepFixed()`でCPU側の剛体とJointを更新し、通常の `Space.draw()`でNodeを描画します。CPU版のJoint solverと、通常のCollider、Shape、Nodeの組み合わせを確認する基準実装です

`joint_compute` は `ComputePhysicsSpace.encodeFixedStep()`でGPU上のbody、contact、Jointを更新し、ping-pong `BodyState`をvertex shaderから直接読みます。物理状態をCPU Nodeへ毎frame転送しないGPU-firstの描画経路です

`joint_compute_node` は `joint_compute`と同じGPU物理を使いますが、明示的なstate readback後に `syncNodesFromPhysics()`で通常のNodeへ姿勢を反映し、`Space.draw()`で描画します。GPU直接描画との比較や、Compute物理結果を既存のNode描画へ接続する経路の確認に使います。readbackは非同期であるため、GPU直接描画より表示が遅れ、転送とNode更新のコストが加わります

## 共通シナリオ

振り子のDistanceJoint距離は、小振幅近似の `T=2π√(L/g)` を `L=|g|(T/(2π))²` へ変形して、重力 `9.80665 m/s²` と目標周期 `3 s` から計算します。6本のロープは、上端のstatic Sphere pivotと10本のdynamic Capsule linkをDistanceJointで接続したchainです。linkは半径 `0.06 m`、芯線長 `0.18 m`、全長 `0.30 m`、中心間隔 `0.305 m`、見かけの隙間約 `0.005 m`、質量 `0.50 kg`です

操作Capsuleは重力を受けないkinematic bodyで、local Y軸をX軸回転のquaternionでworld Z軸へ向けています。起動時はD方向へ移動し、A/Dで左右を切り替え、端で停止します。Qの `quasiStatic` は位置をfixed stepごとに処方して接触速度0を渡し、Iの `impact` は `0.80 m/s` の処方速度を接触solverへ渡します

## 操作

- `A`: 操作用Capsuleを左へ移動
- `D`: 操作用Capsuleを右へ移動。起動時はD方向
- `Q`: `quasiStatic`へ切り替え
- `I`: `impact`へ切り替え
- `P`: pause / resume
- `R`: 初期状態へreset
- `H`: Help Panelの表示／非表示
- Drag: camera orbit　Wheel: camera zoom

Help Panelは各アプリの起動状態に従います。展開すると、物理条件、body／Joint数、振り子の理論周期と実測周期、ロープ速度、角速度、Joint誤差などを表示します。画面へHUD文字は重ねません

## ファイル構成

```text
joint/
  joint_cpu_node.js       CPU PhysicsSpace + Node drawing
  joint_compute.js        GPU Compute physics + direct GPU drawing
  joint_compute_node.js   GPU Compute physics + readback + Node drawing
  joint_cpu_node.html
  joint_compute.html
  joint_compute_node.html
  jointScenario.js         shared initial conditions and quaternion helper
  README.md / README.en.md
  joint_cpu_node.md / joint_cpu_node.en.md
  joint_compute.md / joint_compute.en.md
  joint_compute_node.md / joint_compute_node.en.md
  index.html / index.en.html
```
