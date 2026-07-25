# maze_spec

> この文書は複製元 `samples/maze` の旧仕様である。`samples/maze2` の現行仕様は [maze2_spec.md](./maze2_spec.md) を参照する。

この文書は `samples/maze` の初期実装仕様メモです。`user/walk_around` を出発点にしつつ、「固定モデルを読むウォークスルー」ではなく「sample 側で迷路を動的生成して、その中を歩く first-person アプリ」として具体化した内容を記録します。

## 目的

`samples/maze` の目的は次の 3 点です。

- `EyeRig` の first-person mode、`ComputeEffectPipeline`、`CommandPalette`、touch button、レーダー表示、衝突判定を、固定 JSON モデルなしで再利用できることを確認する
- `Shape` と `Primitive.cuboid()` だけで歩行可能な 3D 迷路を構築し、sample 側の procedural scene 生成例として残す
- `user/walk_around` の「建物内を歩く体験」を保ちながら、特定データ依存を外した再利用可能な構成を示す

## まず守る前提

- `samples/maze` は独自にゼロから設計した別アプリではなく、完全に動作していた `user/walk_around` の構成を土台にしている
- 移動、ドラッグ視線、spot light、Compute Effect、レーダー、衝突円柱、touch button、palette はできるだけ `walk_around` と同じ扱いを維持する
- ただし floor 切替は当面不要なので、階選択 UI と複数階 collision 切替は初期実装では外す

## 空間仕様

- 階層は当面 1 階のみ
- 迷路グリッドは 15 x 15 cell
- 1 cell の基準幅は `2.5m`
- 壁厚は `0.1m`
- 天井厚は `0.1m`
- 天井下面は床面から `3.0m`
- 床面は `y = 0.0`
- 床 cuboid は厚み `0.1m` を持ち、中心 `y = -0.05` に置く
- 天井 cuboid は厚み `0.1m` を持ち、中心 `y = 3.05` に置く
- 歩行者の base は床面上 `y = 0.0`
- `EyeRig.eyeHeight` は `1.6m`
- 壁厚を通路幅に含めるため、有効通路幅は概ね `2.4m`

## 迷路生成仕様

### 乱数

- 疑似乱数は fixed seed を使う
- 初期 seed は `20260707`
- 同じ seed で再読み込みしたときは同じ迷路形状を再現する

### 基本迷路

- 15 x 15 の cell grid を DFS backtracker で掘る
- 内部表現では各 cell が `north / east / south / west` の 4 壁フラグを持つ
- 開通した辺は対応する 2 cell の壁フラグを両方 `false` にする
- 入口は west 外壁の開始 cell に開口部を作る
- 初期実装では goal 側 east 外壁にも開口部を置く

### 部屋

- 迷路生成後に room を上書きする
- 部屋サイズは `2 x 2` cell 以上、初期実装では `2` か `3` cell の幅と高さを使う
- 1 room の最小内法は `5.0m x 5.0m`
- room 同士は重ねない
- room 内では内部壁を取り除く
- 各 room は少なくとも 1 つ、最大 2 つの入口を持つ

## 壁と開口部

### 壁

- 壁はすべて `Primitive.cuboid()` から作る
- outer wall も internal wall も 1 区間 `2.5m` ごとの cuboid を基本にする
- 壁の高さは `3.0m`
- wall shape 名には `1f_wall_...` を含め、collision builder が token から壁として判定できるようにする

### 入口と room door

- outer entrance も room entrance も「壁区間の一部を開口する」方式にする
- door width は `2.0m`
- door top height は `2.4m`
- 1 区間 `2.5m` の壁に開口すると、左右には `0.25m` ずつの side jamb が残る
- これは要求にある「左右に 0.2m 程度の垂れ壁を残す」に対して、初期実装では対称な `0.25m` を採用する
- 上部 lintel は高さ `0.55m`
- lintel の下端は `y = 2.4m`
- lintel の上端は `y = 2.95m`
- 天井下面 `3.0m` との間には `0.05m` の余白が残る

## 衝突判定仕様

- 衝突は `walk_around` と同じく XZ 平面の円柱プレイヤーを使う
- `DEFAULT_PLAYER_RADIUS = 0.3`
- `DEFAULT_PLAYER_HEIGHT = 1.7`
- collision builder は shape の垂直三角形から線分を抽出し、uniform grid に登録する
- door の side jamb は壁として衝突対象に含む
- lintel は `minY = 2.4m` 以上のため、プレイヤー円柱の高さ範囲 `0.0m - 1.7m` と重ならず、結果として衝突対象にもレーダー表示にも現れない
- 床、天井、通常 floor tile は collision 対象に含めない

## レーダー仕様

- レーダーは `walk_around` と同じ heading-up 表示
- 衝突用線分をそのまま 2D canvas に投影する
- そのため、実際にプレイヤーを押し戻す壁と、レーダーに出る壁が一致する
- lintel はプレイヤー高さと重ならないため、レーダーにも描かれない
- 表示範囲は半径 `8m`

## 色仕様

- floor color は area ごとに変えられるようにする
- 初期実装では次の 4 種類を持つ
- corridor
- room
- start
- goal
- 壁と天井は共通色で開始し、後から palette 化せず sample 定数で調整する

## scene graph と shape 命名

- floor は `1f_floor_<kind>_<index>`
- 天井は `1f_roof_main`
- 壁は `1f_wall_outer_*` または `1f_wall_internal_*`
- view marker は衝突対象にしたくないため `maze_view_base_marker` とし、`_wall_` token を含めない

この命名により、`WalkCollisionBuilder.parseCollisionName()` の token 読み取りだけで floor / roof / wall を区別しやすくする。

## walk_around から維持するもの

- `WebgApp` の起動フロー
- `EyeRig` first-person
- 左右 drag で bodyYaw へ吸収する処理
- 上下 drag の一時 pitch と release 後の水平戻し
- `W/S` 前後移動、`A/D` 旋回、`Shift` 走る
- `ComputeEffectPipeline`
- `CommandPalette`
- `FullscreenPass`
- 右上のレーダー
- probe / diagnostics / HUD / help panel の更新パターン
- view-locked spot light と shadow の考え方

## walk_around から外すもの

- `WebgApp.loadModel()` による JSON 読み込み
- floor 切替 `1 / 2 / 3`
- ModelAsset 名や階名からの visibility 分類
- Joto 専用の床・屋根厚み追加
- building 全体の bounding box から階推定する補助処理

## 今後の拡張候補

- seed を palette や query から切り替える
- room の数、最小サイズ、door 数を設定できるようにする
- start から goal までの最短経路計算と可視化
- goal 到達判定と簡単なタイム計測 HUD
- floor tile を 1 cell 単位ではなく room / corridor の連結面としてまとめ、shape 数を減らす
- 壁 segment を連結して長い cuboid へまとめ、collision 線分数と draw call を減らす
- 壁や床へ procedural texture を導入する
