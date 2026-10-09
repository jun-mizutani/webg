# maze_spec

`samples/maze`は、固定seedから生成した迷路の中をfirst-person視点で歩くサンプルです。この文書では、空間寸法、迷路生成、衝突判定、レーダー表示の規則を説明します。

## 利用する機能

`Shape`と`Primitive.cuboid()`で通路と部屋を構築し、`EyeRig`のfirst-person視点で移動します。`ComputeEffectPipeline`、`CommandPalette`、タッチボタン、レーダーを組み合わせて、迷路の形状と歩行範囲を確認できます。

## 空間仕様

- 階層は1 階
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
- 初期位置はmaze2の初期位置をcell pitch比`2.5 / 4.0`で変換した`[-2.559974143293877, 0.0, 6.057196572608413]`とし、同じrow、colとcell内相対位置を使う
- 初期body yawは`-29.91426226806605`度とし、起動時と`0` keyによるreset時で共有する

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
- 現在の設定では goal 側 east 外壁にも開口部を置く

### 部屋

- 迷路生成後に room を上書きする
- 部屋サイズは `2 x 2` cell 以上、現在の設定では `2` か `3` cell の幅と高さを使う
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
- 上部 lintel は高さ `0.55m`
- lintel の下端は `y = 2.4m`
- lintel の上端は `y = 2.95m`
- 天井下面 `3.0m` との間には `0.05m` の余白が残る

## 衝突判定仕様

- 衝突は XZ 平面の円柱プレイヤーを使う
- `DEFAULT_PLAYER_RADIUS = 0.3`
- `DEFAULT_PLAYER_HEIGHT = 1.7`
- collision builder は shape の垂直三角形から線分を抽出し、uniform grid に登録する
- door の side jamb は壁として衝突対象に含む
- lintel は `minY = 2.4m` 以上のため、プレイヤー円柱の高さ範囲 `0.0m - 1.7m` と重ならず、結果として衝突対象にもレーダー表示にも現れない
- 床、天井、通常 floor tile は collision 対象に含めない

## レーダー仕様

- レーダーは heading-up 表示
- 衝突用線分をそのまま 2D canvas に投影する
- そのため、実際にプレイヤーを押し戻す壁と、レーダーに出る壁が一致する
- lintel はプレイヤー高さと重ならないため、レーダーにも描かれない
- 表示範囲は半径 `8m`

## 色仕様

- floor color は area ごとに変えられるようにする
- 現在の設定では次の 4 種類を持つ
- corridor
- room
- start
- goal
- 壁と天井は共通色を使い、sample 定数で調整する

## scene graph と shape 命名

- floor は `1f_floor_<kind>_<index>`
- 天井は `1f_roof_main`
- 壁は `1f_wall_outer_*` または `1f_wall_internal_*`
- view marker は衝突対象にしたくないため `maze_view_base_marker` とし、`_wall_` token を含めない

この命名により、`WalkCollisionBuilder.parseCollisionName()` の token 読み取りだけで floor / roof / wall を区別しやすくする。
