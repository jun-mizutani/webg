# samples

`samples` は、webgを使う人がブラウザで起動し、APIの利用方法、表示、操作、性能を確認する公開向けアプリの置き場です。
小さな機能例だけでなく、複数の機能を組み合わせたアプリ規模の例も含みます。

開発中の最小POCは `unittest/`、ブラウザを必要としない自動contractは `headless_tests/`、
書籍本文と一緒に読む実行例は `book/examples/` が所有します。

## 規模と目的

### 機能・APIサンプル

一つまたは少数の機能を読みやすい構成で示します。`axis`、`billboard`、`bloom`、`dof`、
`gltf_loader`、`json_loader`、`materials`、`physics_bounce`、`shapes`などが該当します。

### アプリケーション規模のサンプル

複数の状態、入力、UI、モデル、描画機能を組み合わせ、実際のアプリ構成に近い使い方を示します。
特に規模が大きいものは次のとおりです。

- `mmodeler`: モデル編集、階層、material、保存・読込を扱うツール
- `cube4`: 3D falling-block game
- `maze2`: maze gameと統合描画pipeline
- `circular_breaker`: 円形breakout game
- `compute_json`: animated ModelAsset viewerと統合compute effect
- `compute_cloth`: GPU布simulationと表示・操作・計測
- `compute_texture`: GPU texture feedbackとpointer interaction
- `compute_benchmark`: 複数passのGPU負荷比較・結果保存

directoryは規模では分けません。公開URLとsample間参照を安定させつつ、一覧と本文で目的を明示します。

## compute sampleの調査結果

2026-07-17時点の17件を、source、importするコア、README、操作、対応する非compute版、
公開履歴で確認しました。同じアプリを別名で残しただけのsampleはありませんでした。

| sample | 主目的 | 対応・比較対象 | 判断 |
|---|---|---|---|
| `compute_benchmark` | 標準passのGPU計測 | `compute_effect` | 統合表示ではなく同一sceneでの計測ツール |
| `compute_bloom` | staged Compute Bloom | `bloom` | Compute / Fragment実装の比較ペア |
| `compute_cloth` | mass-spring GPU simulation | なし | 独立したアプリ規模sample |
| `compute_deferred_lighting` | 多数local lightの遅延照明 | `compute_effect`の一部 | 単一コア機能へ焦点を絞る |
| `compute_dof` | staged Compute DoF | `dof` | Compute / Render Pass実装の比較ペア |
| `compute_edge` | Sobel近傍参照 | `compute_vignette`の共通枠 | effectは別。共通runtimeは既に共有済み |
| `compute_effect` | `ComputeEffectPipeline`統合利用 | 個別compute sample群 | 高水準APIの統合例 |
| `compute_json` | animated JSON model viewer | `json_loader`、`compute_effect` | asset利用とeffect統合を組み合わせるアプリ |
| `compute_particles` | GPU particle更新・描画 | `unittest/particle_emitter` | GPU大量粒子とCPU emitterで責務が異なる |
| `compute_physics_bounce` | GPU球体simulation | `physics_bounce` | GPU限定球体群と汎用CPU物理の比較ペア |
| `compute_postprocess` | sample内の低水準compute後処理 | `compute_effect` | core pipelineではなく接続方法を読む教材 |
| `compute_shadow_map` | directional shadow評価 | `compute_effect`の一部 | shadow単体のdebug・bias・PCF確認 |
| `compute_ssao` | depth-only SSAO | `compute_ssao_gbuffer` | normal texture不要の簡易方式 |
| `compute_ssao_gbuffer` | G-buffer normalを使う`SsaoPass` | `compute_ssao` | 正式コア経路と品質比較 |
| `compute_ssr` | screen-space reflection | `compute_effect`の一部 | ray条件とdebug viewへ焦点を絞る |
| `compute_texture` | ping-pong texture feedback | なし | 独立したアプリ規模sample |
| `compute_vignette` | 1 dispatchの最小後処理 | `unittest/vignette`、`compute_edge` | Compute / Fragment比較と最小教材 |

### 重複に見える組み合わせ

`bloom` / `compute_bloom`、`dof` / `compute_dof`、`physics_bounce` / `compute_physics_bounce`は、
同じ効果や題材を異なる実行方式で比較するための意図的なペアです。正規化した`main.js`の類似度も
それぞれ0.268、0.206、0.053で、実装を複製したものではありません。

`compute_ssao`と旧`compute_ssao2`は履歴上も同時に追加された比較ペアです。
前者はdepth差分からnormalを推定し、後者はG-buffer normalと正式`SsaoPass`を使います。
数字では役割が分からないため、後者を`compute_ssao_gbuffer`へ改名しました。

`compute_effect`、`compute_benchmark`、`compute_json`は同じ`ComputeEffectPipeline`を使いますが、
それぞれ統合APIの利用例、性能計測、外部ModelAsset viewerを所有します。
`compute_postprocess`はpipelineを使わず、sample内の低水準shader接続を説明するため別目的です。

`compute_edge`と`compute_vignette`はscene、入力、presentationの枠が共通ですが、
既に`computeSimplePostprocessApp.js`へ共有部分を統合済みです。各directoryにはeffect固有のWGSLとparameterだけが残ります。

## 整理の基準

1. 同じ見た目でもCPU / Compute、低水準 / 高水準、単体 / 統合の比較目的が明確なら両方を残します。
2. sceneやUIだけが共通なら、sampleを削除せず共通helperまたはコアへ実装を集約します。
3. 数字や開発時点ではなく、`compute_ssao_gbuffer`のように入力・方式・所有コアが分かる名前を使います。
4. sample固有の目的がなくなり、別sampleが操作・表示・説明をすべて包含した場合にだけ統合・削除を検討します。
5. 大規模sampleは小さなsampleの代替とはせず、複数機能を組み合わせる実例として位置付けます。

## 実行

HTTP server経由で `samples/index.html` を開き、各sampleのDemoまたはREADMEへ進みます。
各directoryの `README.md` と `README.en.md` が説明の正本で、`index.html`と`index.en.html`は生成した閲覧用HTMLです。
