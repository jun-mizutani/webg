# unittest

`unittest` は、ブラウザで表示・操作して確認する小さなテストページの置き場です。
画面、DOM、GPU、入力操作、ブラウザAPIに対応する33ページを収録しています。

Node.js上で合否判定できるコアcontractは `headless_tests/` に置きます。
一般利用者向けの完成した利用例や比較的大きなアプリは `samples/`、
書籍本文と一緒に読む小さな実行例は `book/examples/` が所有します。

## 分類

### visual tests: 14件

描画結果、シェーダー効果、形状、UI表示を人が見て確認します。

- `background`
- `cube_axes`
- `message`
- `phong_debug`
- `primitive_modelasset`
- `primitive_normal_map`
- `primitive_texture_uv`
- `primitive_wireframe`
- `skinning_basic`
- `skinning_normal_map`
- `smooth_shader`
- `textdemo`
- `translucent`
- `vignette`

### interaction / browser API tests: 10件

keyboard、pointer、touch、端末sensor、ブラウザAPIなどを人が操作して確認します。

- `compression`
- `detouch_min`
- `flick`
- `game_api`
- `physics_node_fall`
- `physics_node_rotate`
- `raycast`
- `theme`
- `tilt_input`
- `touch`

### hybrid tests: 9件

起動時の自動checkと、その後の表示・操作確認を一つのページで行います。
自動checkの結果と画面上の挙動を同じページで確認できます。
純粋なコアcontractと重複する部分は、コア名に対応するheadless suiteでも確認します。

- `camera_follow`
- `destroy_lifecycle`
- `embedded`
- `input_controller`
- `overlay_panel`
- `particle_emitter`
- `scene_loader_contracts`
- `scene_mesh`

`scene_loader_contracts` は起動時contractに加えて、Scene JSONから構築したcrateの落下、停止、
pause / resetを画面で確認できます。ページのURLは一覧から参照できます。

## 起動

HTTP server経由で `unittest/index.html` を開き、各ページの説明に従って確認します。
一覧は用途別に分類しており、各ページのURLと確認内容を参照できます。

headless contractだけを実行する場合は、repository rootで次を実行します。

```sh
node --experimental-default-type=module headless_tests/run_all.js
```

## 配置の目安

1. 見た目、操作感、ブラウザ固有APIを確認する小さなページは `unittest/` に追加します。
2. Node.jsで決定論的に判定できる契約は `headless_tests/` に追加します。
3. 起動時checkと画面確認の両方が必要なページはhybrid testsとし、純粋な契約はcoreとheadless suiteへ分けます。
4. 利用者へ見せる完成した例は `samples/`、書籍の説明に従う例は `book/examples/` に置きます。
5. 確認対象のコア名または利用目的が分かる名前を使います。

## 説明と関連サンプル

一覧の「実行」で確認画面、「説明を読む」で準備条件・操作・期待結果をHTMLで表示します。
`details.html`が各ページの説明原文を読み込み、見出し・箇条書き・API名を整えて表示します。
`samples/`はアプリの使い方、`unittest/`は固定条件での挙動、
`headless_tests/`は決定論的な契約を確認する役割を担当します。
同じ機能を扱う場合も、各ページには固有の確認条件を記載します。

テストを追加・整理するときは、一覧とこの分類を合わせて更新してください。
