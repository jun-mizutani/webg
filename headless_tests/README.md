# headless_tests

`headless_tests` は、ブラウザを起動せずに webg の決定論的な契約を確認する開発者向けテストです。
Node.js で短時間に反復できることを優先し、コア変更時の回帰検出と API・resource・数値規約の固定に使います。

## 対象としないもの

次の確認は、このディレクトリだけでは完結しません。

- 実 WebGPU device での shader compile、pipeline validation、GPU 実行結果
- canvas、DOM、pointer、touch、audio などブラウザ固有 API の統合
- 描画品質、操作感、演出、性能を人が見て判断する確認
- POC や利用例として人が起動するアプリ

これらは、目的に応じて `unittest/`、`samples/`、`book/examples/`、またはブラウザ自動化で確認します。
headless test が成功しても、実ブラウザでの表示が正しいことまでは保証しません。

## ディレクトリ

- `core/<core_name>/`: `webg/*.js` の所有コアに対応する契約
- `integration/<topic>/`: 複数コアをまたぐ規約とレンダリング境界
- `samples/<sample_name>/`: sample の起動コードや API 利用方法の静的契約
- `diagnostics/<topic>/`: 数値調査や原因切り分けを目的とする probe

`core` の名前は、原則として対象ファイル名を snake_case にしたものです。
たとえば `webg/CameraFrame.js` は `core/camera_frame/`、
`webg/ComputeBlurPass.js` は `core/compute_blur_pass/` が所有します。

バージョン移行時に追加した契約も現在のコアが所有するため、`v2_` のような時点依存の接頭辞は使いません。
同じコアに複数の観点がある場合は、`api_contracts.js`、`depth_contracts.js`、
`hdr_contracts.js` のようにケース名で分けます。

## 実行

全件を実行します。

```sh
node --experimental-default-type=module headless_tests/run_all.js
```

一つのコア suite だけを実行します。

```sh
node --experimental-default-type=module headless_tests/core/physics_space/headless_probe.js
```

一つのケースだけを調べる場合は、対象の `*_contracts.js` を直接実行できます。

```sh
node --experimental-default-type=module headless_tests/core/camera_frame/api_contracts.js
```

`run_all.js` は各 suite を別プロセスで実行し、各 suite もケースを別プロセスで実行します。
これにより、mock、global、module cache の状態が別のケースへ漏れることを防ぎます。

## 追加と整理の規則

1. まず契約を所有する `webg/*.js` を決め、そのコア名の suite に追加します。
2. 複数コアの境界が主題の場合だけ `integration/` に置きます。
3. sample source の構成だけを確認するものは `samples/` に置き、コア契約と数えません。
4. 実装調査用で合否契約にしにくい数値 probe は `diagnostics/` に置きます。
5. 同じ準備・同じ対象を検査する小さな probe は、一つの suite の複数ケースへ統合します。
6. ブラウザ固有機能を mock しすぎて実際の契約を失う場合は、headless 化せずブラウザ側に残します。

現在の所有先と不足領域は `COVERAGE.md` に記録します。
ケースに併設された `.txt` は作成時の確認記録であり、現在の分類と実行方法はこの README を正とします。
