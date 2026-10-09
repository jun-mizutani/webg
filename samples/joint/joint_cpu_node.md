# joint_cpu_node

`joint_cpu_node` は、webgコアのCPU版 `PhysicsSpace` と `DistanceJoint` を使い、重力で自律的に動く振り子と6本の吊りロープを表示するサンプルです。A/Dキーで画面の前後方向を長軸にしたkinematic Capsuleをロープの中央付近へ横切らせ、Jointで連結されたCapsule linkへ接触の影響が伝わる様子を確認できます。GPU Compute版との共通シナリオ定義は `jointScenario.js` を参照します

## 実行

リポジトリのルートでHTTP serverを起動し、WebGPU対応ブラウザーで次を開きます

```text
http://localhost:8765/samples/joint/joint_cpu_node.html
```

`samples/joint/index.html` は三つの方式を比較する目次、`joint_cpu_node.en.md` は英語版です。実行ページは `joint_cpu_node.html` です

## シナリオ

画面左の振り子は、staticなSphere pivotとSphere weightを1本の `DistanceJoint` で接続しています。Joint距離は小振幅近似の `T=2π√(L/g)` から `L=|g|(T/(2π))²` へ変形して、重力 `9.80665 m/s²` と目標周期 `3 s` から約 `2.2356 m` としています。支点と球をつなぐ白いCapsuleは表示専用の通常Nodeであり、PhysicsSpaceへ登録せず、質量、重力、衝突、Jointを持ちません。Help Panelには目標周期と、下向き通過間隔から求めた実測周期を表示します

6本のロープは、それぞれ上端のstatic Sphere pivotから10本のdynamic Capsule linkを `DistanceJoint` で連結したchainです。linkは半径 `0.06 m`、芯線長 `0.18 m`、全長 `0.30 m`、中心間隔 `0.305 m`、見かけの隙間約 `0.005 m`、質量 `0.50 kg`です。隣接link同士はcollision layer / maskで接触させず、ロープlinkと操作Capsuleの接触だけを有効にしています。床や境界Planeは配置していません

操作Capsuleは重力を受けないkinematic bodyです。local Y軸をX軸回転のquaternionでworld Z軸へ向けるため、画面の前後方向が長軸になります。起動時はDキーを押した状態として右へ移動を開始し、A/Dで方向を切り替え、端で停止します。Qの `quasiStatic` では位置をfixed stepごとに処方し、contact solverへ速度0を渡します。Iの `impact` では同じ位置処方に `0.80 m/s` の処方速度を渡します。モードの切り替えは速度から自動判定しません

## webgコアとの関係

`joint_cpu_node.js` は `WebgApp`、`PhysicsSpace`、`CapsuleCollider`、`SphereCollider`、`Primitive`、`Shape`、`DistanceJoint`、`JointMath`を `webg/` から直接importし、`Scene.addPhysicsNode()`でcoreのPhysicsNodeを登録します。Jointの位置拘束はcoreのXPBD solverが担当し、`jointSolverIterations=16`、`jointPositionCorrectionIterations=16`を設定しています。サンプル内の `KinematicMotionController` はA/D入力からkinematic bodyの位置と接触速度を作るだけで、衝突やJointのsolverを複製しません

frame時間を固定刻みへ分配し、各stepの直前にCapsuleのposition commandを更新してから `PhysicsSpace.stepFixed()` を呼びます。これにより複数のfixed stepが必要なframeでも、入力による位置処方と物理更新の順序を確認できます。表示形状と衝突形状には、`Primitive.capsule()` と `CapsuleCollider`、`Primitive.sphere()` と `SphereCollider` の対応する組み合わせを使います

## 操作

- `A`: 操作用Capsuleを左へ移動し、左端で停止
- `D`: 操作用Capsuleを右へ移動し、右端で停止。起動時はD方向から始まる
- `Q`: `quasiStatic`へ切り替え、速度0の位置処方でロープを押す
- `I`: `impact`へ切り替え、処方速度をcontact solverへ渡す
- `P`: pause / resume
- `R`: 初期配置、姿勢、速度、周期計測をreset
- `H`: Help Panelを表示／非表示
- Drag: camera orbit
- Wheel: camera zoom

Help Panelは起動時に非表示です。`H`で表示するとgravity、body数、Joint数、ロープ数、振り子の目標・実測周期、Capsuleの位置と速度、ロープの現在値・ピーク値、接触数、Joint最大位置誤差を表示します。画面へHUD文字は重ねません

## ファイル構成

```text
joint/
  joint_cpu_node.js
  joint_cpu_node.html
  joint_cpu_node.md / joint_cpu_node.en.md
  jointScenario.js
  index.html / index.en.html
```
