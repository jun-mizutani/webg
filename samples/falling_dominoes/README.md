# falling_dominoes

[English](README.en.md) | 日本語

## 概要

`ComputePhysicsSpace`と`ComputeBoxCollider`を使い、一直線に並んだ32個（先頭1個＋後続31個）のドミノをGPU上でシミュレーションするサンプルです。左端のbodyだけへ初期角速度を与え、後続bodyは静止状態からBox接触で倒します。Box同士と床Planeの接触、回転、摩擦、persistent sleepは一つのCompute Physics処理で確認します。

描画側は`getRenderState()`が返す最新のBodyState Storage Bufferをvertex shaderから直接読みます。bodyの位置や姿勢を毎frame CPUへreadbackしてNodeへ同期する処理はありません。sleepしたbodyは元の色を75%の明るさで描画し、停止状態を画面上でも確認できます。sleeping body数はpanelの統計で確認できます。

## 実行方法

実行ファイルは[./falling_dominoes.html](./falling_dominoes.html)です。WebGPU対応ブラウザで開くと、画面中央のドミノ列が左から右へ順に倒れます。通常起動では追加readbackを発行しません。詳細診断が必要な場合はURL末尾へ`?diagnostics=1`を付けて開いてください。診断はコア外の`FallingDominoSleepDiagnostic.js`が明示的なBodyState readbackとcontact queryから組み立てます。左上のHelp Panelは起動時に畳まれた状態で表示され、`H`で展開するとframe間隔、GPU Compute時間・負荷率、GPU Render時間・負荷率、JavaScript時間・負荷率、物理状態を確認できます。カメラの初期値は`eye=(-0.35, 0.06, 0.02)`付近、`eyeYaw=-67.19`、`eyePitch=-43.59`、`eyeRoll=-29.93`、`cameraTarget=(-0.16, -0.13, -0.06)`、`eyeDistance=0.28`、`fovX=70.00`です。カメラのwheel、drag、key、pinchによるzoom速度は10%に設定しています。

## 使用しているwebg機能

- `WebgApp`: WebGPU、canvas、depth texture、camera、入力、panel表示を初期化する
- `ComputePhysicsSpace`: fixed step、GPU BodyState ping-pong、予測AABB、XZ Grid、candidate bitset、combined solver、persistent sleepを管理する
- `ComputeBoxCollider`: ドミノの寸法、逆慣性、Box同士とPlaneの接触形状を提供する
- `Primitive`と`Shape`: 単位cube meshを作り、GPU上のbody状態をinstance描画する
- `getRenderState()`: 現在のGPU state bufferを描画側のbind groupへ渡す
- `buildHelpPanelOptions()`: frame間隔、GPU Compute/Render時間、JavaScript時間、active body数、sleeping body数、fixed step数をHelp Panelへ表示する
- `getWakeLinearThreshold()`、`createStateReadbackBuffer()`、`getContactsFromReadback()`、`getPlaneContactsFromReadback()`: 接触wake条件を診断するための閾値取得、明示的state readback、CPU側の接触点再構成に使う。詳細診断は`?diagnostics=1`で有効になり、`FallingDominoSleepDiagnostic.js`がコア外で監査値を組み立てる。B29〜B32のpair力積とB31のsolver段階はCPUエミュレータのtraceからサンプル専用に組み立てる

## 確認ポイント

- 起動直後に先頭の赤いドミノが倒れ、隣のドミノへ接触が伝わること
- ドミノが床をすり抜けず、倒れたbodyが床上に残ること
- 列の後半まで連鎖が進み、最後に複数bodyがsleepしてpanelのsleeping body数へ反映されること
- 起動時に畳まれたHelp Panelが表示され、`H`で展開するとframe間隔、GPU Compute/Render時間、JavaScript時間、active body数、sleeping body数、fixed step数が表示されること
- `space`で先頭bodyへ角impulseを与え、連鎖を再開できること
- `P`でCompute更新だけを停止し、現在のGPU stateをそのまま描画できること
- `R`で同じ初期姿勢と初期角速度へ戻ること

## 操作方法

- ドラッグ: camera orbit
- ホイール: zoom（速度10%）
- `space`: 先頭のドミノを蹴って連鎖を開始する
- `P`: pause / resume
- `R`: reset
- `H`: Help Panelの展開 / 折りたたみ

## 実装の流れ

`createBodies()`は同じ寸法のBox bodyを32個生成し、すべてを直立姿勢にしたうえで、左端だけへz軸回りの初期角速度`-7.683333rad/s`を設定します。後続bodyはidentity姿勢と静止速度から始め、接触後のbody状態は`ComputePhysicsSpace`が更新します。Spaceはboundsから床と四壁の`ComputePlaneCollider`を作り、重力を固定時間刻みへ分けてGPUへ記録します。

このサンプルはm・kg・sを物理単位として、ドミノの寸法を列方向xの厚さ`0.006m`、高さ`0.050m`、底面の長辺zの長さ`0.025m`、木材相当の密度を`700kg/m³`としています。列方向xへ倒れるときはz方向の底面長辺を軸にするため、実際のドミノと同じ向きになります。寸法と密度から求めた基準質量`0.00525kg`に質量倍率`6.183333`を掛け、各bodyを約`0.0324625kg`にしています。間隔は`0.0225m`、重力は`-9.80665m/s²`、反発係数は`0.11`、bodyの`friction`は`0.300833`、`linearDamping`は`0.091667`、`angularDamping`は`0.133333`です。sleepへ入る線速度閾値は`0.0133167m/s`、wakeする線速度閾値は`0.02665m/s`、sleepへ入る角速度閾値は`0.469167rad/s`、wakeする角速度閾値は`0.7175rad/s`、接触速度閾値は`0.007075m/s`、法線速度閾値は`0.011675m/s`です。fixed stepは120Hz、solverは10反復、最大sub stepは4です。追加位置補正passは通常0回で、必要な比較だけ明示的に有効化します。`ComputePlaneCollider`にはPlane個別の摩擦係数がないため、床との摩擦もbody側の値を使います。ドミノ同士の摩擦は両bodyの係数から計算されるため、床とドミノ同士を別の係数へ分けるにはcore側のPlane材質拡張が必要です。

この寸法・質量・重力から、16.5mmの隙間を先頭bodyが倒れて埋めるときの目標値を簡易理論で計算しています。先頭bodyの底面端を一時的なpivot、上端角が次bodyの鉛直面へ当たる形、床との衝突後に角速度が角運動量保存で`7.683333rad/s`の4分の1へ落ちる形、摩擦なしを仮定します。厚さを6mmとした場合、接触角は`19.695deg`、重心の下降量は`2.474mm`、重力によるエネルギーは`0.787mJ`、接触直前までの回転エネルギーを加えたエネルギーは`0.838mJ`です。接触点の次body法線方向速度は約`0.3521m/s`、反発係数`0.11`を含む接触力積の簡易推定は約`2.013e-3N・s`になります。これはサイズ・質量と上記の仮定から求めた理論上の比較基準です。panelの`theory`行で同じ値を表示し、実測値がこの目標からどれだけ離れているかを確認します。

各fixed stepでは、coreが予測AABBを作り、XZ Gridとswept Yで候補を絞り、body別candidate bitsetを作ります。その後、同じ候補をcombined local solverが再利用して、Box同士とPlaneとの法線・摩擦impulseを8反復計算します。追加位置補正passは通常経路では0回とし、4段積み診断のための補正を実行時の既定設定へ持ち込みません。低い動きが連続したbodyはpersistent sleepへ入り、sleep状態はpanelの統計readbackと暗くなった描画色で確認できます。

sleep中のbodyがwake条件を満たした場合、coreはまず次fixed stepの相手body stateを予測して接触を検出します。その予測接触をwake判定だけで終わらせず、wakeしたbody側のbody間solverにも同じ相手stateとして渡します。これにより、wakeしたのに接触力積が失われて後続bodyへ動きが伝わらない状態を避けます。panelの`solverInVn`と`solverJ`は相手側とsleepから復帰したbody側の両方で確認できます。

Render Passでは、`physics.getRenderState()`の`bufferIndex`に対応するbind groupを選びます。Box meshのinstance vertex shaderがBodyStateの位置、quaternion、half extents、色を読み取るため、CPU側のNode配列を毎frame更新しません。panelのactive / sleeping統計は通常起動でも明示した非同期readbackを使います。詳細なwake診断は`?diagnostics=1`のときだけ、コア外の`FallingDominoSleepDiagnostic.js`がstate/contact readbackから監査値を組み立てます。Coreは特定body番号やpair名を持たないため、B29〜B32の隣接pairごとのsolver入力・力積とB31の段階値はCPUエミュレータのtraceから組み立てます。GPUの`vN`はsolver後の速度、`wakePeakVn`はsleep bodyのwake走査、`preFrameVn`はreadback frame開始時の速度です。`closePeak`はbody中心間のx方向接近速度なので、理論の接触点法線速度とは別の参考値です。`vN <= -wakeLinearSpeed`がcoreの接触wake条件です。

## 対象範囲

このサンプルはBox bodyと固定Planeだけを使う、Compute Physicsの処理フロー確認用です。Sphere、Capsule、Node同期、接触イベントのCPU取得、任意のドミノ列編集UIは含みません。形状を別形状へ自動変換する処理や、GPU状態を隠れてCPUへ戻すfallbackもありません。
