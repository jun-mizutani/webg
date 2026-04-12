# templates

`templates/` は、webg で新しい 3D アプリを始めるときの雛形置き場です。

- `templates/basic`
  最小構成で `WebgApp.js` を使い、1つの 3D オブジェクトを表示する雛形
- `templates/model_viewer`
  `EyeRig(type="orbit")` と `app.loadModel()` の入口を持ち、視点 node を持つモデル閲覧系アプリへ発展させやすい雛形
- `templates/gameplay`
  簡単なゲーム状態更新と touch controls を含む雛形

どのテンプレートも次の方針で揃えています。

- `WebgApp.js` で初期化順序を固定する
- canvas HUD と HTML debug dock の両方に同じ controls row を流す
- `Diagnostics` / `DebugProbe` / debug/release 切替を最初から使える形にする
- キー判定は `event.key.toLowerCase()` 前提で扱う
- 通常は `EyeRig` を入口にし、`type` を `orbit` / `first-person` / `follow` で切り替える
- camera 専用オブジェクトではなく、視点として使う node 構成を動かす helper として扱う
- コメントを多めに入れ、処理段階を追いやすくする

補足:

- `templates/model_viewer` は `MODEL_SOURCE` が空なら placeholder で起動し、値を入れると `app.loadModel()` を使う最小 viewer になります
- `templates/basic` と `templates/gameplay` も probe / copy / save / debug/release の流れをそのまま流用できるようにしてあります
