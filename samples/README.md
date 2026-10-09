# samples

初めて開発する場合は、[開発の入口と実行例](../book/開発の入口と実行例.md)または[ブラウザ版](../book/examples/guide.html)で、作りたいアプリから出発点を選べます。教材例で仕組みを確認し、このフォルダーの機能例・完成アプリへ進む順序も示しています。

`samples` は、webgを使う人がブラウザで起動し、APIの利用方法、表示、操作、性能を確認する公開向けアプリの置き場です。
小さな機能例だけでなく、複数の機能を組み合わせたアプリ規模の例も含みます。

ブラウザで機能単位を確認する小さなテストページは `unittest/`、ブラウザを必要としない自動contractは `headless_tests/`、
書籍本文と一緒に読む実行例は `book/examples/` が所有します。

開発時にwebgコアの古いES module URLを避ける場合は、[`cache_clear_webg/cache_clear_webg.html`](./cache_clear_webg/cache_clear_webg.html)をWebサーバー経由で開き、`全coreを再import`を実行します。このページは`webg`配下の全JavaScript moduleを一意な`?v=...`付きURLで読み込みます。webgコア自身のimport文にはキャッシュクエリを追加しません。

## 規模と目的

水面と集光をPBRへ追加する場合は、[water](water/index.html)から始めてください。独立ON/OFF、対象登録、共通の波、深度と透明物の合成、OFF時の解放までを一つの例で確認できます。

GLBの泳ぐモデルへ集光を組み合わせる小さな統合例は、[aquarium](aquarium/index.html)です。イルカのボーンアニメーション、親Nodeの遊泳経路、手続き材質の水底、霧、粒子を接続し、イルカだけの受光も切り替えられます。

### 機能・APIサンプル

一つまたは少数の機能を読みやすい構成で示します。`axis`、`billboard`、`bloom`、`dof`、
`falling_box`、`falling_dominoes_cpu`、`gltf_loader`、`json_loader`、`materials`、`pbr_reference`、`physics_bounce`、`procedural_texture`、`shapes`、`transmission`などが該当します。

`falling_box`は、同じ200体のBox落下シナリオをCPUの`PhysicsSpace`とComputeの`ComputePhysicsSpace`で実行する比較用サンプルです。CPU版のBox/Plane接触には、連鎖・停止・再wakeを確認済みのCPUのBox接触処理を使います。Compute版はGPU BodyStateとWGSL solverを確認します。

`falling_dominoes_cpu`は、公開Compute版の`falling_dominoes`と同じ32体のBox・PlaneシナリオをCPUの`PhysicsSpace`で実行する比較用サンプルです。CPU版のBox/Plane接触にはCPUのBox接触処理を使い、CPU版とCompute版で連鎖順序、床による支持、最終的なpersistent sleepが同等になることを確認します。

### アプリケーション規模のサンプル

複数の状態、入力、UI、モデル、描画機能を組み合わせ、実際のアプリ構成に近い使い方を示します。
小さな統合例から読む場合は`fantasy`を使います。PBRの段差マップで移動・攻撃する
ゲームを題材に、材質、Node更新、選択、粒子、リサイズ、解放を接続します。
`fantasy/README.md`の読む順序と、[bookの補足](../book/examples/fantasy_guide.html)から
一つずつ変更して確認できます。

特に規模が大きいものは次のとおりです。

- `mmodeler`: モデル編集、階層、material、保存・読込を扱うツール
- `cube4`: 3D falling-block game
- `maze2`: maze gameと統合描画pipeline
- `circular_breaker`: 円形breakout game
- `compute_json`: animated ModelAsset viewerと統合compute effect
- `compute_cloth`: GPU布simulationと表示・操作・計測
- `compute_texture`: GPU texture feedbackとpointer interaction
- `compute_benchmark`: 複数passのGPU負荷比較・結果保存
- `pbr_reference`: Forward／Deferred PBR、IBL、HDR、SSR、透明材質の統合比較
- `texture_catalog`: コアProcedural Texture presetの選択、編集、preview、コード出力

directoryは規模では分けません。公開URLとsample間参照を安定させつつ、一覧と本文で目的を明示します。

## compute sampleの公開範囲

以下の表では、Compute処理を主目的とする公開sampleを9件紹介します。物理の方式比較やSceneYAMLによる作品構成にもComputeを使う例があります。
PBR効果の統合処理は[book/examples/32_01.html](../book/examples/32_01.html)で、全体の調整と表示は[33_01.html](../book/examples/33_01.html)で確認できます。個別passの入力と出力は各章を参照してください。

| sample | 主目的 | 判断 |
|---|---|---|
| `compute_benchmark` | PBR・Compute処理のGPU計測 | 公開継続 |
| `compute_cloth` | mass-spring GPU simulation | 公開継続 |
| `compute_json` | animated ModelAsset viewer | 公開継続 |
| `compute_particles` | GPU particle更新・描画 | 公開継続 |
| `compute_particle_emitter` | SceneYAMLから標準Compute粒子を発生・停止してPBRへ表示 | 公開継続 |
| `compute_physics` | コアComputePhysicsSpaceによるBox/Sphere剛体simulation | 公開継続 |
| `falling_dominoes` | コアComputePhysicsSpaceによるBox接触の連鎖とpersistent sleep | 公開継続 |
| `compute_physics_bounce` | GPU球体simulation | 公開継続 |
| `compute_texture` | ping-pong texture feedback | 公開継続 |

個別passは、画質、内部target、GPU負荷、境界条件が処理結果へどのように影響するかを確認するための例です。

## 整理の基準

1. 同じ見た目でもCPU / Compute、低水準 / 高水準、単体 / 統合の比較目的が明確なら両方を残します。
2. sceneやUIだけが共通なら、sampleを削除せず共通helperまたはコアへ実装を集約します。
3. 入力・方式・利用するコアAPIが分かる名前を使います。
4. sample固有の目的がなくなり、別sampleが操作・表示・説明をすべて包含した場合にだけ統合・削除を検討します。
5. 大規模sampleは小さなsampleの代替とはせず、複数機能を組み合わせる実例として位置付けます。

## 実行

HTTP server経由で `samples/index.html` を開き、各sampleのDemoまたはREADMEへ進みます。
各directoryの `README.md` と `README.en.md` が説明の正本で、`index.html`と`index.en.html`は生成した閲覧用HTMLです。
