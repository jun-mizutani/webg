# maze2_spec

この文書は、`samples/maze` を `samples/maze2` として発展させた、八角形断面のSF風通路の現行実装仕様である。迷路生成、first-person操作、衝突判定、レーダー、固定seed、部屋、入口と出口を維持し、形状生成、material、照明、描画経路、操作を拡張している。

寸法や初期値は、特記しない限り `samples/maze2/main.js` の現行値と一致させる。今後調整した場合も、コードだけを変更せず本書へ反映する。

## 1. 目標

- 通路の基本断面を、床、左右の下部斜面、左右の垂直壁、左右の上部斜面、天井からなる八角形にする。
- 壁の上下端へ内向きの三角柱状レールを付け、単なる bevel ではなく、厚い構造フレームに囲まれたチューブとして見せる。
- 暗かった天井を各セルの天井灯で照らし、光の反復で進行方向とセルのリズムが分かるようにする。
- 床、壁、斜面へ明確に読める SSR を適用し、天井灯と周囲の白系内装が流れる高彩度の SF 内装にする。
- Shadow Map と SSAO は使用しない。多数のpoint Local LightとSSRを使うため、追加負荷を抑える。
- `samples/maze` は比較用として一切変更しない。

## 2. 維持する機能

- 15 x 15 cell、seed `20260707`、DFS backtracker、room overlay、start / goal の生成規則
- `EyeRig` first-person、W/S 移動、A/D 旋回、Shift 走行、drag 視線、reset、screenshot
- 円柱プレイヤーによる XZ 平面衝突、uniform grid、heading-up radar
- help panel、diagnostics、CommandPalette、touch 操作
- 床の corridor / room / start / goal の識別。ただし配色は新しい意匠へ変更する

## 3. 基準寸法

単位は meter とする。

| 項目 | 値 | 備考 |
| --- | ---: | --- |
| cell pitch / 壁心間距離 | 4.00 | X、Z とも同じ |
| 構造天井高さ | 4.00 | 床仕上げ面から天井下面中央面まで |
| 主壁厚 | 0.12 | 有効通路幅は通常部で 3.88 |
| 床厚 | 0.12 | 上面を y = 0.00 とする |
| 天井厚 | 0.12 | 下面を y = 4.00 とする |
| 下部斜面の張出し・高さ | 0.62 | 壁内面から通路内側へ張り出す |
| 上部斜面の張出し・高さ | 1.00 | 天井側を広げ、チューブの肩を強調する |
| 垂直壁の範囲 | y = 0.62..3.00 | 上下斜面間 |
| 最小天井平坦幅 | 1.88 | 3.88 - 1.00 x 2、通常直線部 |
| eye height | 1.60 | 現行値を維持 |
| player radius / height | 0.30 / 1.70 | 現行値を維持 |

「天井高 4 m」は構造天井の平坦面 y = 4.00 を指す。上部斜面の最低部は y = 3.00 だが、通路中央では 4.00 m を確保する。下部斜面は player の足元へ張り出すため、衝突上の有効幅は斜面先端間で約 2.64 m となる。直径 0.60 m の player に対し、中央には約 2.04 m の移動余裕が残る。

## 4. 八角形断面

直線通路を横断した内装面の頂点を、左から右へ定義する。`W = 3.88`、下部張出し `BL = 0.62`、上部張出し `BU = 1.00`、`H = 4.00` とする。

```text
(-W/2 + BU, H) ---- ( W/2 - BU, H)
       /                    \
(-W/2, H-BU)             (W/2, H-BU)
   |                          |
(-W/2, BL)               (W/2, BL)
       \                    /
(-W/2 + BL, 0) ---- ( W/2 - BL, 0)
```

- 主壁は壁心上の薄い直方体とし、通路側の面を断面の左右垂直辺とする。
- 下部レールは、壁内面の `(0, 0)..(0, B)` と床側の `(B, 0)` を結ぶ直角三角形を、壁方向へ通した構造材として見せる。
- 上部レールは、壁内面の `(0, H-B)..(0, H)` と天井側の `(B, H)` を結ぶ構造材として見せる。
- 三角柱は壁を削る bevel ではなく、壁・床・天井の角を埋める独立構造材とする。
- 床と天井の平面は維持する。斜面と重なる非表示領域があってもよいが、同一平面の z-fighting は作らない。
- 通常区間は通路側に見える斜面 quad だけを custom mesh に追加する。壁、床、天井と同一平面になる三角柱の他面は追加しない。
- 自由端だけに三角形 end cap を追加し、各面に正しい winding と法線を持たせる。`Shape.endShape()` を必ず呼ぶ。

## 5. 壁境界を基準にした生成方式

通路中心線を sweep して一本の tube mesh を作る方式は採用しない。迷路には十字路、T 字路、部屋、扉があり、中心線 sweep では交差部の自己交差と面の欠落が起きやすいためである。

代わりに、現行と同じ wall boundary を構造の基準とする。

1. 迷路データから、外周を含む一意な水平・垂直 wall segment 一覧を作る。
2. 各 wall segment に主壁、下部斜面、上部斜面を一組生成する。
3. 床と天井は cell tile を基準に生成する。
4. 上下斜面の端点は wall topology を見て、継続、外角、端部のいずれかに分類する。
5. 分岐や部屋は「tube の交差」ではなく、複数の八角形通路が接続する少し広い node chamber として処理する。

この方式では、壁が左右にある直線部分は常に正確な八角形断面になる。曲がり角や分岐では断面が一時的に広がるが、閉塞や重複壁を作らず、歩行可能性を優先する。

## 6. 端点と曲がり角の接続規則

各 wall segment の端点について、同じ壁心上に次の segment があるか、直角方向の wall が接続するかを調べる。

### 6.1 同一直線に継続する場合

- 隣接 segment と上下斜面を同じ交点まで伸ばす。
- material groupごとにまとめた mesh を使い、端面と draw call を減らす。
- 法線と material を共通化し、継ぎ目を見せない。

### 6.2 90 度で壁が続く場合

- 水平・垂直の斜面を壁心交点まで伸ばす。交点を越える重なりは作らない。
- L字接続では、直交するhorizontal / vertical railの各終端辺を四角形のmiter bridgeで直接つなぐ。下部と上部で別々に、4組のrail側面を接続する。
- miter bridgeの4頂点は、二本のrail slopeがすでに持つ終端辺の頂点をそのまま使う。bridgeは二本の斜面の境界を共有するため、capの座標差による細い隙間を作らない。
- bridgeはwall厚の周囲にあるrail同士を結ぶだけで、開口側へ新しい面を延長しない。床、天井、主壁と同一平面を共有せず、重複した柱や閉じた四面体でz-fightingを隠す方式は使わない。

### 6.3 壁が途切れる場合

- 通路開口、分岐、部屋入口では、上下斜面を wall segment の端で止める。
- 露出する三角形端面を必ず張る。
- 端面にはアクセント色の end cap material を使い、意図したフレーム終端として見せる。
- player の進路側へ cap を延長しない。

### 6.4 T 字路・十字路

- 開いている cell boundary には主壁も上下レールも生成しない。
- 残った壁のレール端は 6.3 の end cap で閉じる。
- junction の床と天井は cell tile が連続して覆うため、中央に穴を作らない。
- junction 全体を無理に単一八角形へ保たない。進入する各枝で八角形が成立し、交差中心は広い接続 chamber になることを仕様とする。

### 6.5 行き止まり

- 正面壁にも上下レールを付ける。
- 左右壁のrail端は 6.2 のmiter bridgeで接続し、行き止まり奥を一周する厚いフレームにする。
- 正面壁中央へ識別パネルまたは警告色を置ける構成とする。

## 7. 扉、入口、出口、部屋

- cell pitch を 4.00 m に変更するため、room door は幅 2.40 m、高さ 2.70 m を初期値とする。
- 扉の左右 jamb は主壁として残し、それぞれへ上下レールを付ける。
- 扉上 lintel の下面は y = 2.70 とする。上部レールと干渉する場合は、開口上だけ上部レールを lintel 下面沿いへ下げず、lintel 前面の独立フレームとして閉じる。
- 扉を通る player の head clearance は 2.70 m、横方向 clearance は 2.40 m を保証する。
- 外周入口と出口も同寸法を基本とし、外側から見える斜面端には end cap を付ける。
- room 内部の撤去済み wall boundary には斜面を生成しない。部屋外周だけに斜面が付くため、部屋は corridor より広い chamber になる。
- roomの天井灯も各cellに置き、corridorと同じpoint Local Lightを使う。過露光は、共通パラメータとtone mappingで調整する。

## 8. 意匠と material

基本テーマは「整備された宇宙施設のサービスチューブ」とする。床のarea accentは維持しつつ、壁、上下斜面、天井は同じ白系で統一する。面の役割と色の変化は、roughness、metallic、白・緑・オレンジ・赤の天井照明で読み分ける。

| 部位 | 基本色の方向 | roughness | metallic | SSR 用 alpha / reflectivity |
| --- | --- | ---: | ---: | ---: |
| 主壁パネル | neutral facility white | 0.42 | 0.28 | 0.70 |
| 下部構造レール | neutral facility white | 0.20 | 0.32 | 0.70 |
| 上部構造レール | neutral facility white | 0.16 | 0.36 | 0.70 |
| 通路・部屋の床 | cool white / warm white | 0.62 | 0.08 | 0.28 |
| 開始・終了・分岐の床 | vivid green / orange / blue | 0.54〜0.56 | 0.08 | 0.22〜0.24 |
| 天井パネル | neutral facility white | 0.55 | 0.28 | 0.70 |
| end cap | cyan または amber | 0.40 | 0.55 | 0.20 |
| light fixture | 各cellのLocal Lightと同じ白・緑・オレンジ・赤 | 0.10 | 0.10 | 0.10 |

- G-buffer の alpha が SSR 反射率として使われる現行契約に合わせる。
- SSR は壁、斜面、天井、床のいずれでも天井灯の反射が認識できる強さにする。ただしscreen-space由来の欠けは残るため、完全な鏡面にはしない。
- 上部斜面は下部斜面と別 Shape / material groupにし、同じ白系でも少し高いmetallicと低いroughnessで天井側のチューブ輪郭を強調する。
- 通路内装の色は白系に固定し、天井照明の白・緑・オレンジ・赤の混色をアクセントにする。floorのarea accentは残す。
- 主壁、上下斜面、天井のSSR reflectivityは初期値0.70で統一し、白系の内装へ色付き天井灯を映す。
- 3方向以上へ開いた分岐 cell の床は専用の鮮やかな青 material とし、通常 corridor と視覚的に区別する。
- 天井灯 fixture は高さ0.025mの薄い長方形panelとする。直線cellでは上部斜面と直交する幅を1.48mにして左右各0.20mの余白を残し、通路の前後方向は3.60mにしてcell長4.00mの前後各0.20mの余白を残す。曲がり角、T字、十字、roomでは一方向へ伸ばさない1.48m角panelとする。
- fixtureのdiffuserと側面は、同じcellのpoint Local Lightと必ず同じ色名を使う。Local Lightだけを色替えしてfixtureを別色のまま残さない。
- texture asset の追加は初期実装の必須条件にしない。色、material、構造形状、照明だけで成立させる。

### 8.1 現行material値

- corridor floor color `[0.68, 0.73, 0.80, 0.28]`
- room floor color `[0.82, 0.76, 0.66, 0.28]`
- start floor color `[0.04, 0.72, 0.48, 0.22]`
- goal floor color `[0.96, 0.24, 0.04, 0.22]`
- 3方向以上のjunction floor color `[0.04, 0.48, 0.88, 0.24]`
- floor materialは`specular 0.48`、`metallic 0.08`とし、白系・鮮やか系の塗装面に弱い反射だけを残す
- main wall / lower rail / upper rail / ceiling color `[0.82, 0.84, 0.88, 0.70]`
- fixture white color `[1.00, 0.98, 0.94, 0.10]`
- fixture green color `[0.18, 1.00, 0.46, 0.10]`
- fixture orange color `[1.00, 0.34, 0.06, 0.10]`
- fixture red color `[1.00, 0.05, 0.10, 0.10]`
- fixture materialは`ambient 0.18`、`specular 0.80`、`roughness 0.10`、`metallic 0.10`、`emissive 0.10`とする
- end cap color `[0.08, 0.58, 0.62, 0.20]`

配列の第4要素は透明度ではなく、G-buffer経由でSSRが読むreflectivityとして使う。描画自体はopaqueである。

照明fixture全体の`emissive`は0.10に抑える。BloomはPyramid方式を有効にし、full-resolution extractの`threshold`を0.60、`softKnee`を0.40、全体`strength`を1.10とする。1/2から1/16までのLevel Weightと`filterRadius`は`COMPUTE_BLOOM_DEFAULTS`を使用し、1/32のLevel Weightは広い発光を強めるため0.80とする。白系の壁や床全体、または照明fixture全面の自己発光ではなく、天井灯下面中央の直接反射を中心に滑らかな発光を加える。

## 9. Deferred Local Light

- 全225 cellの天井中央に、通路照明用の`type: "point"`を1灯ずつ定義する。
- positionは`[cellCenterX, 3.70, cellCenterZ]`とし、天井灯の下面から0.2375 m下へ置く。
- corridorとroomの共通初期値はradius 7.2 m、intensity 5.20とする。
- pointは全方向へ放射し、下側の通路と直上のfixture下面を同時に照らす。fixture materialの低いroughnessと高いspecularにより、下面へBloom抽出用のHDR反射を作る。
- Shadow Mapは無効なため、pointと照明対象の間にある形状によるvisibilityは計算しない。壁やfixtureを光が貫通する問題は、Local Light用の別のShadow方式がなければ解決しない。
- 全225灯のうち135灯（60%）はwhite `[1.00, 0.98, 0.94]` とする。残る90灯（40%）はgreen `[0.18, 1.00, 0.46]`、orange `[1.00, 0.34, 0.06]`、red `[1.00, 0.05, 0.10]` を各30灯ずつ使う。
- 色はcell種別や開口方向で上書きしない。rowとcolから求める15種類の固定bucketを各15回ずつ使い、割合を再現可能に保ちながら同色が一列へ固まることを避ける。
- 同じ固定bucketをfixture meshのmaterial group選択にも使う。照明器具の側面、diffuser、Deferred Lightingのpoint Local Lightは同じ白・緑・オレンジ・赤で対応する。
- `DeferredLightingPass` の上限と毎 pixel の負荷を考慮し、225灯を毎 frame 全投入しない。
- camera からの XZ 距離で候補を絞り、radius が camera 周辺へ届く灯のうち近い順に最大64灯を `DeferredLightingPass` へ渡す。
- 選択は camera が cell 境界を越えたとき、または一定距離を移動したときだけ更新し、毎 frame の sort を避ける。
- fixture mesh は全 cell で常時表示してよい。light 選択数と fixture 表示数は分離する。
- ambientは`DEFERRED_AMBIENT = 0.11`をPipeline constructorと毎frameのlighting optionで共有し、灯数選択境界で完全な黒にならないようにする。

## 10. 描画 pass 構成

現行の`ComputeEffectPipeline`がG-buffer、Deferred Lighting、SSR、geometry edge、tone mappingを所有する。アプリケーションは同じ`CameraFrame`を`renderScene()`と`encode()`へ渡し、Local Light配列は加工せず統合pipelineの`lights`へ渡す。

```text
ComputeEffectPipeline.renderScene()
  -> GeometryBufferPass
ComputeEffectPipeline.encode()
  -> DeferredLightingPass (最大64 active point Local Lights)
  -> ComputeSsrPass (G-bufferからreflection生成)
  -> ComputeEffectComposer (base=deferred result, mode=mix)
  -> ComputeEdgePass (normal/depth geometry edge)
  -> ComputeEffectToneMapPass
  -> FullscreenPass
  -> canvas present
```

- G-buffer は `colorMode: "material"`、`normalSpace: "view"` とする。
- SSR は `resolutionScale: 0.70` から開始する。
- SSR 初期値は intensity 0.68、distance 14.0 m、thickness 0.30 m、steps 48、reflectivity threshold 0.05 とする。
- tone map初期値は exposure 1.00、saturation 1.32、gamma 2.2、mode `reinhard` とする。
- composer は `mix` を基本とする。`add` は照明器具周辺が白飛びしやすいため初期値にしない。
- Shadow Map、spot shadow、SSAO、Toon、DoF は初期状態 OFF とする。geometry Edge は初期状態 ON とする。
- 現行の camera 追従 spot light は廃止する。操作説明と palette から shadow / spot 固有項目を除く。
- geometry Edge は初期値 ON、thickness 1、`strength: 1.35`、`threshold: 0.10`、`mix: 0.68` のblack-multiply、color edge OFF とする。CommandPalette の `Edge` toggleでON/OFFできる。
- frame 順序は G-buffer render、deferred compute、SSR compute、compose、geometry edge、tone map、canvas copy、present とし、同一 command encoder 内で完結させる。

SSR は screen-space のため、画面外、遮蔽物の裏、正面を向いた平坦面では反射情報が欠ける。この欠けは異常ではない。高めたintensityでも不自然な全面鏡面にしないよう、roughnessを残して輪郭をやわらげる。

## 11. 衝突判定とレーダー

- 見た目の下部三角柱から自動抽出した斜辺を collision に使うと、足元の有効幅が意図せず変動し、重複線分も増える。このため collision は render mesh から分離する。
- collision wall は各 wall boundary の通路側主壁面を表す単純線分から直接構築する。
- player center が壁心から `WALL_THICKNESS / 2 + PLAYER_RADIUS` 未満へ近づかない現行相当の規則を維持する。
- 下部レールは視覚上 player 側へ 0.62 m 張り出すが、初期実装では collision を主壁面に維持する。カメラがレールへ極端に食い込んで見える場合のみ、別定数 `COLLISION_INSET` を最大 0.20 m まで導入する。
- 上部レール、天井、fixture、lintel は player 高さと交差しないため歩行 collision 対象外とする。
- radar は render mesh 由来ではなく、同じ論理 wall boundary の collision 線分を描画する。斜面の細かい辺を表示しない。
- radar は heading-up表示、表示半径 12.0 m とする。初期版の8.0 mに対して同じ画面寸法で1.5倍広い範囲を表示する。
- radar grid stepは4.0 m、DOM canvasの表示寸法は168 pxとする。
- door、entrance、junction の開口は collision segment も途切れ、見た目と通行可能領域を一致させる。

## 12. 操作とUI

- 初期位置は`[-4.0959586292702035, 0.0, 9.691514516173461]`、eye heightは1.60 m、初期 body yawは-29.91426226806605度とする。
- `W` / `S` は前進 / 後退、`Shift` は走行とする。
- `A`と`ArrowLeft`は同じ右旋回、`D`と`ArrowRight`は同じ左旋回とする。A/Dは利用者の指定により通常と逆方向の割当である。
- touch buttonは左から `A W D S` の順とし、keyboardと同じinput stateを使用する。
- horizontal dragはbody yaw、vertical dragは一時的なlook pitchを操作し、release後は水平へ戻す。
- `0`は視点reset、`K`はscreenshot、`5` / `6`はSSR intensityの減少 / 増加とする。
- double tap / double clickまたは`/`でCommandPaletteを開閉する。
- CommandPaletteはSSR ON/OFF、Edge ON/OFF、SSR intensity / distance / thickness / steps / resolution scale、exposure、reset、screenshotを提供する。
- palette値の変更時は`app.requestRender()`を呼び、ondemand描画でも直ちに見た目へ反映する。

## 13. geometry のまとめ方

- 1 部品 1 Shape の大量生成は避ける。
- material と部品種別ごとに mesh builder を持ち、`corridor / room / start / goal / junction floors`、`ceiling panels`、`main walls`、`lower rails`、`upper rails`、`caps/fillers`、`fixtures` にまとめる。
- 衝突用 wall boundary 一覧は geometry と別データとして保持する。
- custom mesh helper は position、normal、index を追加する小さな API に限定する。
- 平坦な斜面quad、miter bridge、end capは面ごとに頂点を分け、意図しない smooth shading を避ける。
- 透明 material は使わず、opaque pass のままにする。
- triangle 数、Shape 数、active light 数を diagnostics に表示する。

## 14. 実装履歴に対応する順序

1. 複製版が `samples/maze` と同じ状態で起動することを確認する。
2. cell pitch と天井高を 4.00 m に変更し、扉、初期位置、レーダー目盛り、help 表示を追従させる。
3. wall boundary の一意な一覧を生成し、render geometry と collision の共通入力にする。
4. 直線 wall の上下三角柱を実装し、断面寸法と法線を確認する。
5. 継続、90 度miter bridge、自由端end cap を実装する。
6. 扉、入口、出口、行き止まり、T 字路、十字路、room 境界を個別に確認する。
7. material と fixture mesh を導入する。
8. Geometry Buffer + Deferred Lighting の描画へ切り替え、近傍 64 灯選択を実装する。
9. SSR、composer、tone map を追加し、負荷と反射強度を調整する。
10. palette、help、diagnostics を新構成へ合わせ、旧 spot / shadow / SSAO 項目を整理する。
11. desktop と mobile 相当 viewport で操作、表示、resize を確認する。

各段階で起動可能な状態を保ち、geometry と effect chain を同時に全面変更しない。

## 15. 受入条件

- `samples/maze` のファイルに差分がない。
- 通常の直線通路で、床から天井まで八角形断面が連続して見える。
- 曲がり角、T 字路、十字路、行き止まり、room door、外周入口と出口に、可視の穴、裏返った面、z-fighting、進路を塞ぐ filler がない。
- すべての door を player が通過できる。
- start から goal まで現行と同様に移動でき、壁抜けがない。
- 各 cell に fixture があり、近傍 cell の天井と上部レールが判別できる明るさを持つ。
- active deferred light 数が 64 以下で、Shadow Map と SSAO が生成・実行されない。
- SSR OFF と ON の差が床または金属度の高い上下斜面で確認できるが、通路全体が鏡面にはならない。
- resize 後も G-buffer、deferred、SSR、composer、tone map の target 寸法が一致する。
- console error と WebGPU validation error がない。
- `node --check samples/maze2/main.js` が成功する。
- diagnostics に Shape 数、triangle 数、active light 数、主要 GPU timing が表示される。

## 16. 現行の主要初期値と調整範囲

次の値は視認性と GPU timing を見て、仕様意図を保つ範囲で調整してよい。

- 下部斜面張出し `0.62 m`: 0.55..0.70 m
- 上部斜面張出し `1.00 m`: 0.85..1.15 m
- active light 上限 `64`: 32..96
- light radius / intensity
- SSR intensity、distance、thickness、steps、resolution scale
- material の色、roughness、metallic、reflectivity
- end cap のアクセント色

cell pitch 4.00 m、構造天井高 4.00 m、八角形断面、各 cell の fixture、deferred lighting、SSR 使用、Shadow Map / SSAO OFF は固定要件とする。
