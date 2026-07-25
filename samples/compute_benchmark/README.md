# compute_benchmark

[English](README.en.md) | 日本語

![compute_benchmark](./compute_benchmark.jpg)

## 概要

`compute_benchmark` は、`ComputeEffectPipeline` と標準の compute effect API を使ったときに、各処理が GPU にどの程度の負荷を与えるかを比較するサンプルです。`samples/compute_effect` が「複数の effect をひとつの 3D アプリへ組み込んだ見え方と操作」を確認するサンプルであるのに対して、このサンプルは「同じ scene 条件で各 effect を個別に測り、どの効果を導入するかを判断する」ための計測ツールです。

このサンプルは、標準解像度のまま`ComputeEffectPipeline`、`ComputePyramidBlurPass`、`ComputeBloomPass`、`ComputeDofPass`、`SsaoPass`、`ComputeSsrPass`などを順番に測ります。測定対象は床、壁、複数の不透明な立体、半透明の立体、反射率の差を含む固定sceneです。G-buffer、shadow map、透明合成、screen-space reflection、Fog、post effectが、それぞれ意味のある入力を持つように構成しています。

## 測定する項目

`gbuffer-render`はG-buffer作成、`shadow-map`はshadow map作成、`shadow-visibility`はG-bufferとshadow mapから直接光の可視率を作るcompute処理です。これらは「後段effectを使う前に必要になる処理」の負荷を見るための基準になります。

`blur`、`toon`、`dof`、`bloom`、`ssao`、`ssr-ray`、`ssr-composer`、`transparency`、`fog`、`tone-map`、`edge`、`vignette`は、それぞれの処理を個別に測る項目です。`transparency`は、二段階のFrost用blur、roughness mask、透明triangle描画を含む`TransparencyPass`全体を測ります。`fog`は透明合成済みHDR sceneと不透明G-buffer深度を入力にし、`vignette`はTone MapとEdgeを終えた表示色を入力にします。

`blur`は線形HDR sceneを`ComputeImagePyramid`で1/2、1/4、1/8、1/16へ連続縮小し、1/16から1/8、1/4、1/2、フル解像度へ順番に拡大する`ComputePyramidBlurPass`全体を測ります。各縮小処理は13 tapの低域通過フィルター、各拡大処理は9 tapのテントフィルターを使います。最小階層の低周波画像だけを段階的に拡大するため、途中階層の色を追加して光量を増やしません。

最後の`full-pipeline`は、shadow、SSAO、SSR、透明合成、Fog、Toon、DoF、Bloom、Tone Map、Edge、Vignetteを現行`ComputeEffectPipeline`の順序でまとめて有効にした代表的な複合負荷です。透明合成は固定sceneに半透明材質があるため自動的に実行されます。これにより、個別導入の判断と、複合利用した場合の目安を同じ画面で比較できます。

## 実行方法

- 実行ファイルは [./compute_benchmark.html](./compute_benchmark.html) です
- WebGPU と `timestamp-query` に対応した browser で開いてください
- `Samples` は本測定の回数、`Warmup` は統計へ含めない慣らし回数です
- `Pyramid Radius`は縮小時と拡大時のサンプル間隔で、既定値は`1.0`、設定範囲は`0.25`から`3.0`です
- `Pyramid Radius`は単独の`blur`測定にだけ適用されます
- `dof`、`bloom`、`full-pipeline` は、各処理の既定値を使う固定条件で測定します

`Run Benchmark` を押すと、各項目を warmup のあとに複数回測定し、平均、標準偏差、最小、最大を表で表示します。結果は `Download JSON` と `Download CSV` で保存できます。JSON には raw sample、canvas サイズ、DPR、browser 情報、`pyramidFilterRadius`、`pyramidLevels`も含めるため、後から別端末の結果と照合できます。

確認画像とトーンマッピングを含む測定項目は、照明条件を変えずに暗部を読み取れるよう、Reinhardトーンマッピングの露出を`2.0`に固定しています。この値はJSONの`toneMapExposure`にも記録されます。

## 結果の読み方

この sample が返す時間は、各 pass 自体の GPU 実行時間を比較するための値です。測定前の入力準備は毎回同じ条件で行いますが、その準備時間は各項目の本体時間へ含めていません。そのため、「DoF 自体の cost はどの程度か」「Bloom を追加するとどれだけ増えるか」を個別に比較しやすくなります。一方で、実フレーム全体の体感負荷を知りたい場合は、`full-pipeline` の値や `samples/compute_effect` の Help Panel と合わせて確認してください。

複数 pass を内部で使う項目は、browser や GPU driver によって単一 pass の timestamp が不安定になる場合があります。そのため、この sample では一部の項目を queue 完了待ち時間で測ります。表の `timer` 列は `gpu` と `queue` の 2 種だけを表示し、`gpu` は `timestamp-query` による GPU timestamp、`queue` は command submit から queue 完了までの時間を表します。

表の `avg ms` は warmup 後に記録した複数回の平均時間です。機種比較や effect の導入判断では、まずこの値を基準に見ます。`stddev` はばらつきの大きさで、値が大きいほど測定ごとの差が大きいことを示します。`min/max` は観測された最小値と最大値で、同じ項目でも driver の状態や他処理の影響でどの程度揺れたかを読むための値です。`n` は統計に使った記録回数で、`Samples` と一致します。

`full-pipeline`は、個別項目を単純に足した値ではなく、`ComputeEffectPipeline`を使ってshadow、SSAO、SSR、透明合成、Fog、Toon、DoF、Bloom、Tone Map、Edge、Vignetteを同じframe内で順に実行した時の通し負荷です。ここには、effect間でtextureを受け渡すcost、順番に依存するencodeの流れ、途中結果を次段で読むための実際の処理フローが含まれます。そのため、`transparency`、`fog`、`dof`、`bloom`、`edge`、`vignette`を別々に測った結果の合計と、`full-pipeline`が必ずしも一致するとは限りません。

個別実行と同時実行で結果が異なる理由は 2 つあります。1 つは、個別測定では「その pass だけ」を見るために他の後段 effect を動かしていないのに対し、`full-pipeline` では前段の出力を後段がそのまま受け取るため、実際の依存関係を含んだ通し処理になることです。もう 1 つは、GPU の cache、resource の再利用、command のまとまり方、queue 完了待ちの測り方が変わるためです。このため、`full-pipeline` は個別値の単純合計より少し小さくなる場合もあれば、逆に大きくなる場合もあります。

このsampleでは`gbuffer-render`の値が比較的小さいため、「共通部分が小さいのでfull-pipelineも個別和とあまり変わらない」ように見えることがあります。ただし、実際には`full-pipeline`は`renderScene()`と`encode()`を通した複合実行であり、個別項目の測定方法とは条件が同一ではありません。`gbuffer-render`が小さいことは差を小さく見せる要因の一つではありますが、それだけで`full-pipeline`の意味を説明しきれるわけではありません。判断の目安としては、個別項目で「どのeffectが重いか」を見て、`full-pipeline`で「実際にまとめて入れた時に全体がどこまで増えるか」を確認する、という使い分けが分かりやすいです。

## 確認ポイント

- `main.js` が sample 固有の複製 pipeline を持たず、公開済みの `webg/ComputeEffectPipeline.js` と各 pass をそのまま呼んでいること
- 同じfixed sceneを使って`render`、`shadow`、`SSAO`、`SSR`、透明合成、`Fog`、`DoF`、`Bloom`、`Vignette`の負荷差を比較できること
- `fog`が透明合成後のHDR入力、`vignette`がTone MapとEdge後の表示色入力を使うこと
- `blur`が1/2から1/16までの連続縮小と、1/16からフル解像度までの段階的な拡大を測定すること
- `Pyramid Radius`を変えると`blur`のサンプル間隔だけが変わり、`dof`、`bloom`、`full-pipeline`の条件は変わらないこと
- JSON に canvas サイズ、DPR、samples、warmup、browser 情報が入り、機種比較の記録として残せること
