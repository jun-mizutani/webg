# joint_compute_node

`joint_compute_node` は、`joint_compute` と同じ `ComputePhysicsSpace` のGPU Jointシナリオを、通常のCPU側 `Node` へ同期して描画する比較サンプルです。GPU上の物理計算、readback、`syncNodesFromPhysics()`、標準 `Space.draw()` の境界を確認できます。共通の初期条件は `jointScenario.js` にまとめています

## 実行

```text
http://localhost:8765/samples/joint/joint_compute_node.html
```

## `joint_compute`との違い

`joint_compute`はping-pong `BodyState`をvertex shaderから直接参照します。このサンプルは、`ComputePhysicsSpace.encodeStateReadback()`でBodyStateをreadback bufferへコピーし、submit後に`readStateReadback()`を呼び、`syncNodesFromPhysics()`で通常の `Node` の位置とquaternionを更新します。描画は`Space.draw()`と`SmoothShader`が担当します

通常frameのcommand encoderはWebgAppが管理します。`onBeforeDraw`では既定Render Passを閉じてCompute処理とreadback copyを同じencoderへ記録し、Node描画用のRender Passを再開します。Render Passの終了、`FrameTimer`のGPU query解決、`queue.submit()`はWebgAppがframe末尾でまとめて実行し、次のframeの`onUpdate`からreadbackを開始します。この順序により、GPU計測用queryと物理readbackが一つのcommand bufferへそろいます

GPUからCPUへの転送とNode更新があるため、body数が増えた場合の性能はGPU直接描画より不利です。一方、通常のShape、Node、WebgAppの描画経路を保ったままCompute Physicsを利用できます。readback完了後の状態を次のframeで表示するため、GPU stateと表示にはreadbackによる時間差があります

## シナリオと色

6本の吊りロープ、DistanceJointで接続した振り子、ロープ中央を横切るkinematic Capsuleを登録します。床と境界Planeは登録していません。`joint_compute`との比較用に、ロープを緑／ライム、振り子のSphereを赤、操作Capsuleをシアン、表示用connectorを金色にしています

## 操作

- `A` / `D`: 操作用Capsuleを左右へ移動
- `Q`: `quasiStatic`。位置を処方し、接触solverへ速度0を渡す
- `I`: `impact`。処方速度を接触solverへ渡す
- `P`: pause / resume
- `R`: 初期body、Joint、Node表示を再設定
- `H`: Help Panelの表示／非表示
- Drag: camera orbit
- Wheel: camera zoom

Help Panelは起動時に見出しだけを表示した折り畳み状態です。`H`で表示／非表示を切り替えます

## 実装の流れ

```text
ComputePhysicsSpace.encodeFixedStep()
  -> encodeStateReadback()
  -> queue.submit()
  -> readStateReadback()
  -> syncNodesFromPhysics()
  -> Space.draw()
```

物理bodyの `ComputeSphereCollider` / `ComputeCapsuleCollider` と、描画用の通常 `Shape` は別に作ります。`Node` は `Space` へ配置しますが、`ComputePhysicsSpace` へbodyとして登録しません。`book/26_物理エンジン.md`の「Compute版の状態を通常のNodeへ同期する」構成に対応します

## ファイル構成

```text
joint/
  joint_compute_node.js
  joint_compute_node.html
  joint_compute_node.md / joint_compute_node.en.md
  jointScenario.js
  index.html / index.en.html
```
