# compute_particle_emitter

[English](README.en.md) | 日本語

## 何をするサンプルか

SceneYAMLで定義した標準Compute粒子を、PBRシーンへ表示します。左側の噴水は連続発生、中央の火花と右側の光点はボタンによる一括発生です。GPUが初期位置・速度・寿命を生成し、その後の移動も更新します。利用するアプリは発生位置と条件を指定します。

## 実行と操作

[compute_particle_emitter.html](compute_particle_emitter.html)をHTTPサーバー経由で開いてください。ドラッグで視点回転、ホイールで拡大縮小できます。

「火花を64粒」「光点を64粒」で一括発生し、「連続発生を停止」で噴水の新しい発生を止めます。「一時停止」は全粒子の移動と寿命を保持します。停止中の一括発生は再開時まで保留されます。「全粒子を消去」は粒子と保留要求を消し、発生設定を保ちます。連続発生中は次の更新から再び粒子が生まれます。

「Bloom OFF／ON」で光のにじみを比較できます。Bloomを止めても粒子の更新と表示は続きます。中央のBoxと床には不透明深度による遮蔽が働きます。粒子の床との物理衝突は別の機能として扱います。

## 実装と設定

`scene.yaml`の`particleEmitters`に`fountain`と`sparks`を定義しています。`WebgSceneApp`が初期化時に読み込み、`getComputeParticleEmitter(id)`で取得します。`main.js`ではさらに`createComputeParticleEmitter({ preset: "light", capacity: 256 }, "light")`で光点を追加します。

`emit(64, { position, direction, spreadAngle, speed, lifetime })`で発生条件を渡します。角度は度、速度はワールド長さ/秒、寿命は秒です。`startEmission({ rate, ... })`は秒当たり発生数を指定します。重力と速度減衰は`simulation`、二つのHDR色・強度・半径範囲は`appearance`で調整できます。全Emitterはアプリ終了時に解放されます。

表示する推定数は、最大寿命からCPUで求めた予約数です。保留要求も含みます。容量不足時は`emit()`の`accepted`・`rejected`・`reason`と診断の拒否数で確認できます。このサンプルは満杯の要求を拒否する`overflow: "reject"`です。初期値と移動はGPUに保持し、毎frameのGPU readbackを伴いません。

標準粒子は透明合成後のHDRへ加算し、Bloomとトーンマッピングを共有します。SSRは粒子描画前のシーンを参照します。独自WGSLで粒子の動きを設計する例は、[compute_particles](../compute_particles/index.html)にあります。
