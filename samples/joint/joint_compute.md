# joint_compute

`joint_compute` は、`ComputePhysicsSpace` のGPU Joint bufferとWGSL XPBD solverを使い、`joint_cpu_node` と同じ重力シナリオをCompute版で確認する公開サンプルです。左側の振り子、6本の吊りロープ、ロープ中央を横切るkinematic Capsuleを一つのGPU simulationへ登録します。CPU版と区別しやすいように、ロープを青／紫、振り子のSphereを桃色、操作Capsuleを黄色、質量を持たない表示用connectorを白色にしています。共通の初期条件は `jointScenario.js` にまとめています

## 実行

リポジトリのルートでHTTP serverを起動し、WebGPU対応ブラウザーで次を開きます

```text
http://localhost:8765/samples/joint/joint_compute.html
```

`samples/joint/index.html` は三つの方式を比較する目次、`joint_compute.en.md` は英語版です。実行ページは `joint_compute.html` です

## 操作

- `A`: 操作用Capsuleを左へ移動し、左端で停止
- `D`: 操作用Capsuleを右へ移動し、右端で停止。起動時はDキーを押した状態として右へ移動を開始
- `Q`: `quasiStatic`。Capsuleの位置を処方し、接触solverへ速度0を渡して位置補正でロープを押す
- `I`: `impact`。Capsuleの処方速度を接触solverへ渡し、衝突時の運動量伝達を確認する
- `P`: pause / resume
- `R`: 初期配置、Joint、周期計測を再生成して右方向から再開
- `H`: Help Panelの表示／非表示
- Drag: camera orbit
- Wheel: camera zoom

Help Panelは起動時に見出しだけを表示した折り畳み状態です。`H`で表示／非表示を切り替え、展開時は画面へHUD文字を重ねず、物理条件、GPU body／Joint数、振り子の理論周期と実測周期、ロープ速度、角速度、DistanceJointの最大位置誤差を表示します

## シナリオ

6本のロープは、それぞれ上端のstatic Sphere pivotと10本のdynamic Capsule linkで構成します。linkは半径 `0.06 m`、芯線長 `0.18 m`、全長 `0.30 m`、中心間隔 `0.305 m`、見かけの隙間約 `0.005 m`、質量 `0.50 kg`です。隣接linkの接触はcollision layer／maskで除外し、ロープ同士がJoint拘束以外の接触で固まらないようにしています。ロープlinkと操作Capsuleの接触は有効です。床や境界Planeは登録していないため、自由端の重力運動を床の反発と分けて観察できます

操作Capsuleは `bodyType="kinematic"`、半径 `0.33 m`、芯線長 `1.20 m`、Y位置 `4.00 m`です。Capsuleのlocal Y軸をX軸回転のquaternionでworld Z軸へ向け、画面の前後方向を長軸にしています。`quasiStatic`ではfixed stepごとに次の位置をteleportし、速度0をBodyStateへ渡します。`impact`では同じ位置処方に加えて `0.80 m/s` の処方速度を渡します。モードは速度から自動判定せず、`Q`／`I`で明示します

振り子は、左端ロープの根元からworld X方向へ `1 m` 左へ移したstatic Sphere pivotと、半径 `0.18 m` のSphere weightをDistanceJointで接続します。Joint距離は `T=2π√(L/g)` から `L=|g|(T/(2π))²` を計算し、重力 `9.80665 m/s²`、目標周期 `3 s`から約 `2.2356 m`を得ます。支点とSphereの間はGPU rendererが二つのBodyState位置を読み、白い質量なしconnectorとして表示します。connectorは二つのBodyState位置を結ぶ描画用の線です。物理計算にはpivot、weight、DistanceJointを使います

## Compute実装

`joint_compute.js` は `ComputePhysicsSpace` のbody descriptorへ `ComputeSphereCollider` と `ComputeCapsuleCollider` を渡し、body IDを明示した `DistanceJoint` descriptorを `addJoint()` へ登録します。Jointは `webg/ComputeJointBuffer.js` の固定stride GPU bufferへbody slot、anchor、距離、compliance、lambdaを格納し、`webg/ComputeJointSolver.js` がcontact solver後の独立WGSL passでXPBD position correctionを行います。Joint slotの偶奇を別passへ分け、1回のdispatchで全bodyを同じstateから更新した後にping-pong stateを交換します。設定された反復回数だけ偶奇passを繰り返すことで、同じbodyへ接続する隣接Jointが一つのdispatch内で古い相手位置を使い続けることを避け、ロープ上部のDistanceJoint誤差を抑えます。Joint bufferはCPUへlambdaを毎step読み戻しません

物体の描画は `samples/compute_physics` と同じく、Compute終了後のping-pong `BodyState`をvertex shaderから直接参照します。SphereとCapsuleの位置・姿勢・色をCPU側のNodeへ同期する通常処理はありません。振り子周期、ロープ速度、角速度、Joint誤差は、8 frameに1回の明示的な `MAP_READ` state readbackから計算します。readbackは診断表示のためだけに行い、描画や物理stepをCPU同期へ切り替えるfallbackにはしていません

固定stepごとに、kinematic Capsuleのposition commandを記録してから `ComputePhysicsSpace.encodeFixedStep()` を呼びます。frame時間に複数stepが必要な場合も、この順序をstepごとに繰り返します。これにより `quasiStatic`の位置補正と `impact`の処方速度を、同じGPU物理処理フローで比較できます

## ファイル構成

```text
joint/
  joint_compute.js
  joint_compute.html
  joint_compute.md / joint_compute.en.md
  jointScenario.js
  index.html / index.en.html
```

関連する共通実装は、公開コアの次のファイルを使用します

```text
webg/ComputePhysicsSpace.js
webg/ComputeJointBuffer.js
webg/ComputeJointSolver.js
webg/ComputeSphereCollider.js
webg/ComputeCapsuleCollider.js
```
