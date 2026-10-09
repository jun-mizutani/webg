# PBRシーンから小さなゲームへ

小さな機能例でPBR、Node、選択、粒子を理解した後は、
それらを一つのゲームに接続する境界を確認します。
`samples/fantasy/`の「翠の砦」は、段差を移動して戦う一戦分のゲームです。
大きなゲーム基盤を持ち込まず、初期シーン、ルール、表示、入力、解放を分けています。
現在の戦場は水に沈んだ砦です。コースティクスと青緑の照明・フォグを加え、
同じゲームへ描画機能を追加する具体例としても読めます。

## まず動かして読む場所を決める

リポジトリをHTTPで配信し、`samples/fantasy/fantasy.html`を開きます。
例えば`http://localhost:8000/samples/fantasy/fantasy.html`です。
操作と確認ポイントは`samples/fantasy/README.md`、
ブラウザの説明ページは`samples/fantasy/index.html`です。

まずリオを選び、青いマスへ歩かせてから、他の味方を選びます。
移動中は入力が止まり、到着後に攻撃を選べることを確認します。
次に敵ターン、HP減少、再開始を試します。
この順序が、コードで読む行動の順序にもなります。
右側の「水中のコースティクス」を切り替え、
OFFでもゲームの状態を保ち、ONで地形へ動く集光が戻ることを確認します。

必要な原理を短い例で確認する場合は、03_01の親子Node、
15章の画面座標からのraycast、30_01のPBR材質、
`samples/compute_particle_emitter/`の発生・消去へ戻ります。
この統合例は、それらの短い例を置き換えるものではありません。

## 起動する入口は一つにする

`samples/fantasy/main.js`の`start()`から読みます。
`FantasyApp`は`WebgSceneApp`を継承し、画面サイズの追従だけを足します。
PBRの描画、登録したGPU粒子の更新と合成には標準callbackを使います。
別の例のフレームループや粒子の`step()`を重ねません。

`scene.js`の`createManifest()`は、SceneYAMLと同じ構造の初期データです。
配置、共通材質、renderer、粒子をここへ置きます。
`project`にはURLだけでなくmanifest objectも渡せるので、
地形をJavaScriptで生成する場合も同じ高水準入口を使えます。
保存・編集する文書が必要になったらSceneYAMLへ進みます。

このゲームは`physics:false`です。高低差があっても、
マスの進入規則を実装するだけなら剛体物理は必要ありません。
ルールは`rules.mjs`、描画位置も同じ地形の段数から求めます。
同じ高さをユニットと地形の両方へ保存し、食い違わせないようにします。

## 直接作ったShapeにPBR材質を渡す

シーンの`materials`で宣言する材質と、
`Shape.setMaterial()`へ直接渡すパラメーターを区別します。
後者ではRGBAの`color`と、`specular`、`roughness`、`metallic`を指定します。
RGBだけに省略せず、30章の最小形を保って値を変えます。

```js
shape.setMaterial("armor", {
  color: [0.48, 0.59, 0.62, 1.0],
  specular: 1.0,
  roughness: 0.28,
  metallic: 0.88,
  emissive_factor: [0.0, 0.0, 0.0]
});
```

`visuals.js`の`part()`は、形状の確定、材質、Nodeへの取り付けをまとめます。
パレットのRGBには、この関数でalphaを足します。
シーン側の発光は`emissiveFactor`、直接Shapeでは`emissive_factor`です。
似た名前を推測して混ぜず、使う経路の例を確認します。

`WebgSceneApp`のPBR設定で環境光を有効にする場合、
`renderer.pipeline.lighting.ambient`は0です。
この入口では非0の値を検証で拒否します。低水準描画での調整とは区別します。
鎧の粗さを変える実験では、照明と露出を同時に変えません。

## マスの移動とNodeの更新をつなぐ

`choose()`→`move()`→`updateMotion()`の順に読みます。
`paths()`が合法な経路を返し、`move()`が一区間ずつ表示の完了を待ちます。
`updateMotion()`は`onUpdate({ deltaSec })`から呼ばれ、
秒単位で位置と四肢を補間します。
`rotateX()`は加算なので、望む角度と前回角度の差を渡します。

経路を決めた瞬間に、表示と無関係に最終マスへ移すことはしません。
一区間の表示が完了してから論理上のマスを確定します。
行動中は`busy`で入力を止め、古い移動範囲への二重入力を防ぎます。
移動後の選択肢は`refresh()`で作り直します。

リオの移動力を4から3へ変えると、初期位置から「列4 行5」の上りへ
届かなくなります。次に区間の`duration`だけを増やし、
同じ経路をゆっくり歩かせます。経路の規則と表示速度を別々に確認できます。

## 選択と頭上ラベルに同じカメラを使う

`makePointerRay()`と`pickTile()`は15章の逆投影を使います。
透視成分を含む行列は`Matrix.mul_()`で合成し、
depthは`CAMERA_REVERSE_Z`から取ります。
カメラの行列は選択前に更新します。

`Space.raycast()`は表示物を選ぶAABBのクエリです。
攻撃の射程や移動の可否は、ヒットしたユニットのマス座標から
`rules.mjs`で判断します。形状の境界を戦闘ルールにしません。
ドラッグ終了のクリックは移動量で除きます。
補助盤のボタンも同じ`choose()`へ入り、入力方式ごとの規則を複製しません。

`updateLabels()`は現在のNode位置を同じprojectionとviewで投影し、
名前とHPのDOMをCanvasの表示寸法へ置きます。
カメラを回した後も、名前とクリック位置が一致するか確認します。

## CanvasとPBRの描画先を一緒に変える

CSSだけでCanvasを引き伸ばすと、描画寸法と表示寸法が分かれます。
`FantasyApp.js`は`.stage`を`ResizeObserver`で監視し、
`fixedCanvasSize`と`applyViewportLayout()`でCanvasを更新してから、
`renderer.resize(width, height)`でPBRの描画先をそろえます。
この例ではCSSピクセルを使い、`useDevicePixelRatio:false`です。

幅を変えて、Canvasだけでなく、粒子、ラベル、クリックも確認します。
リサイズは描画・DOM・入力が同じ寸法を使うかを見る操作です。

## 粒子と再開始・解放の所有者を決める

`scene.js`で装置を宣言し、行動のイベントから`emit()`を呼びます。
`appearance.colors`は二つのRGB配列です。
1色だけにする場合も、同じ色を二つ指定します。
足元の色を変える実験では、発生位置と経路を変えません。

`main.js`の`reset()`はゲームの再開始です。
HP、行動権、ターン、既存Node、ログを戻し、装置の`clear()`を呼びます。
コアの`WebgSceneApp.reset()`が独自のHPやDOMまで戻すとは想定しません。

終了では先にフレームを止めます。
`Visuals`が手動生成したShapeは`Visuals.destroy()`、
登録された粒子・PBR・宣言シーンは`WebgSceneApp.destroy()`が解放します。
`FantasyApp.destroy()`は作品が登録したObserverを外します。
所有者を決めておくと、通常の再開始でGPU資源を作り直す必要がなくなります。

## 動く部隊へ集光を追加する

先に35章と`samples/water/water.html`で、水面と集光を別々に比較します。
ゲームへの接続は`samples/fantasy/main.js`の`connectWater()`へ戻って読みます。
ここでは`WaterBody`を作り、起動済みの`sceneApp.renderer.setWater()`へ接続します。
新しい描画ループやWGSLは追加しません。

`origin: [0, -2, 0]`は照度の基準面、`surfaceHeight: 6`は平均水面のYです。
幅・奥行き18mの水域で、地形・部隊・装飾の親Nodeを登録します。
子の手足や装備にも受光登録が引き継がれるので、歩行で部品を動かすたびに
登録を作り直す必要はありません。選択リングと移動範囲は登録から外します。
金属の鏡面や発光は元のPBR経路で評価し、集光は直接光の拡散成分へ当てます。

```js
water.addReceiver(unitRoot); // 子部品にも適用する
await sceneApp.renderer.setWater(water, {
  causticsEnabled: true,
  surfaceEnabled: false,
  quality: "high"
});
```

この初版の集光は鉛直方向光に対応します。
`connectWater()`は`renderer.pipeline.lightOptions.direction`を`[0, -1, 0]`へ設定し、
`scene.js`では影のup方向を`[0, 0, 1]`にします。
高水準rendererのmanifestへ`lightDirection`を足す方法は使えません。
水域はGPUを持たない設定と登録の所有者、rendererが追加GPU資源の所有者です。

ゲーム側の`update()`では、秒単位の`waterTime`を進めて`water.setTime()`へ渡します。
同じ更新で部隊のNodeも動くので、集光は現在の位置・法線へ追従します。
波は`amplitude`、`wavelength`、`speed`、`waveMix`で変えます。
`water.setOptions()`での変更には、`setWater()`の再接続は必要ありません。

水面の屈折表示はOFFにし、青緑の照明と距離フォグで水中の雰囲気を作ります。
これは戦闘のマスを読みやすくする照明演出です。
水中カメラの屈折・全反射・水面の裏側は扱いません。
集光の吸収はRGB係数の平均、視点側の濁りは標準Fogによる近似です。
水面越しに見るRGB透過色の比較は`samples/water/`で行います。

チェックボックスの処理は、`sceneApp.stop()`→`await setWater()`→`sceneApp.start()`です。
準備中のframeを止め、ゲームのHP・行動権・既存Nodeを保って再開します。
集光OFFかつ水面OFFでは専用GPU資源を解放し、再ONに同じ`WaterBody`を使います。
`reset()`は部隊・粒子・戦闘状態を戻すだけで、水域を生成し直しません。
終了時は`WebgSceneApp.destroy()`からrendererが追加資源も解放します。

確認する順序は、集光OFFで移動→ONで段差移動→遠隔攻撃→敵ターン→再開始です。
表示だけでなく、追加機能の切替後も元の操作を続けられるか確認します。

## 自分のアプリへ変える順序

1. 元の場所で実行し、移動・攻撃・敵ターン・再開始を確認する。
2. `scene.js`または`visuals.js`で一つの材質を変え、同じ照明で比較する。
3. `rules.mjs`で一人の移動力を変え、合法な経路と表示範囲を確認する。
4. `move()`の表示時間を変え、マスの確定と入力停止を確認する。
5. 粒子の二つの色を変え、再開始後に前の粒子が残らないことを確認する。
6. カメラと画面幅を変え、選択・ラベル・描画寸法の対応を確認する。
7. 集光を切り替え、波の高さだけを変える。移動・攻撃・再開始を再確認する。

`node --test samples/fantasy/rules.test.mjs`は経路と戦闘の計算を確認します。
PBRの見え方、アニメーション、粒子、クリックはブラウザで別に確認します。
一つの機能を足すたびに「どの状態を、誰が、いつ更新し、いつ解放するか」を
この例の関数へ対応させると、AIも人も同じ手順で組み立てられます。
