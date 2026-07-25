# unittest

`unittest` は、ブラウザで人が表示・操作して確認する開発用POCの置き場です。
名前は従来のURLを保つため維持していますが、Node.jsで自動実行する単体テスト群ではありません。

ブラウザを起動せずに合否判定できるコアcontractは `headless_tests/` に置きます。
一般利用者向けの完成した利用例や比較的大きなアプリは `samples/`、
書籍本文と一緒に読む小さな実行例は `book/examples/` が所有します。

## 分類

### visual POC: 14件

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

### interaction / browser API POC: 10件

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

### hybrid POC: 8件

起動時の自動checkと、その後の表示・操作確認を一つのページで行います。
自動checkだけをheadlessへ移すとvisual phaseを失うため、ページ自体はここに残します。
純粋なコアcontractと重複する部分は、コア名に対応するheadless suiteが所有します。

- `camera_follow`
- `destroy_lifecycle`
- `embedded`
- `input_controller`
- `overlay_panel`
- `particle_emitter`
- `scene_loader_contracts`
- `tween`

`scene_loader_contracts` は起動時contractに加えて、Scene JSONから構築したcrateの落下、停止、
pause / resetを人が確認するvisual phaseを持ちます。公開済み文書からの参照を保つため、
現在のdirectory名を維持します。

## 起動

HTTP server経由で `unittest/index.html` を開き、各ページの説明に従って確認します。
一覧は用途別に分類しており、各ページのURLと確認内容を参照できます。

headless contractだけを実行する場合は、repository rootで次を実行します。

```sh
node --experimental-default-type=module headless_tests/run_all.js
```

## 追加の判断基準

1. 人が見た目、操作感、ブラウザ固有APIを確認する最小POCは `unittest/` に追加します。
2. 人の判断を必要とせずNode.jsで決定論的に判定できる契約は `headless_tests/` に追加します。
3. 起動時checkとvisual phaseの両方が必要ならhybrid POCとし、純粋な契約だけを所有coreへ分離します。
4. 利用者へ見せる完成した例は `samples/`、書籍の説明に従う例は `book/examples/` に置きます。
5. 一時的な版名ではなく、確認対象のコア名または利用目的が分かる名前を使います。
