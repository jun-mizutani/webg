# transmission

[English](README.en.md) | 日本語

## 概要

`transmission`は、透明PBR surface越しの背景透過と画面空間屈折を比較するテスト用アプリです。球、厚い板、トーラスへ独立したmaterial値を設定し、法線勾配、silhouette、Transmission、IORによって、物体へ入ってから出る光線とレンガ目地やOak木目の見え方が変わることを確認します。

透明体の背後にあった色付き立方体群は置かず、幅16、高さ9の壁全体へ`brick.running.red`のレンガtextureを貼っています。床には柾目と板目を板単位で混ぜた`wood.oak.mixed-sawn`のOak textureを貼り、板の長軸が画面の奥行き方向へ向くようにしています。どちらもコアの`ProceduralMaterials.createPreset()`で生成し、`applyTo()`でShapeへ登録します。presetが持つ物理寸法からUVの反復回数を求めるため、模様を壁や床の全面へ1回だけ引き伸ばさず、レンガの目地、表面の凹凸、床板の継ぎ目、木目を一貫した大きさで表示できます。

レンガの規則的な目地は、透明体を通った背景位置がどちらへどれだけ移動したかを確認する基準になります。Oak床は斜めに見える面で屈折と吸収を確認しやすくし、Color textureだけでなくNormal textureも使うことで、不透明背景自体がPBR照明へどう反応するかも同じ画面で観察できます。texture生成またはShader検証に失敗した場合は単色材質へ切り替えず、起動エラーとして報告します。

処理順序は次のとおりです。

```text
不透明G-buffer
  → Deferred PBR照明
  → 透明前面のoct法線、Transmission、entry距離mask
  → 透明前面materialの吸収色と吸収距離target
  → 透明裏面のexit距離、oct法線、IOR target
  → entryで空気から媒質への第1屈折
  → SSR方式の内部ray marchとbinary searchによるexit探索
  → exitで媒質から空気への第2屈折
  → 不透明G-buffer depthに対する背景ray march
  → 背景未到達時は明示したclearColor／固定色、またはHDR環境radiance
  → 内部光路長によるBeer-Lambert吸収
  → roughnessによるFrost
  → 透明PBR surfaceのForward合成
  → Tone Mapping
```

## 操作

- Canvasのdouble clickまたは`/`でCommandPaletteを開きます
- `Transmission`で屈折を有効／無効にします
- `Sphere`、`Slab`、`Torus`ボタンで編集するmaterialを直接選びます
- `Transmission`値は吸収後の屈折光へ配分する割合です。残りはPBR surface側へ配分します
- `IOR`は1.0から2.5で、entryとexitにおけるSnellの法則の屈折率として使います
- `Absorption R/G/B`は吸収距離を通過した後に残る線形RGBの割合です
- `Absorption Dist`は上記RGB割合まで減衰する距離で、小さいほど吸収が強くなります
- `Roughness`は屈折後の背景をFrost pyramidでぼかします
- `Surface Alpha`はTransmission 1.0で屈折背景の上へ重ねるPBR surfaceの基準Alphaです。Transmissionを下げると非透過分がsurface側へ加わります
- `T`でTransmission、SpaceでPause、`R`で初期値へ戻せます
- このサンプルはHDR環境を使わず、背景未到達rayに`transmissionRayMissFallback: "clear"`を明示しているため、アプリの`clearColor`を使います
- CommandPaletteの`Ray Debug`を有効にすると、屈折rayがfallbackを使った理由を色分けします。赤は同一pixelのvolume不成立、橙はentry屈折不能、紫は初回または内部reflection後の境界未発見、黄は1回reflectionした後も残る全反射、水色は外部探索距離なし、緑は背景未発見です
- Helpの`FPS`は0.2秒間のframe数を実経過時間で割った平均値で、0.2秒ごとに更新します。同じ表示には平均frame間隔に対するComputeEffectPipeline、G-buffer Render、両者のGPU合計、JavaScript処理時間の割合も表示します。画面への最終copyはGPU合計に含みません。GPU timestampを取得できない環境では0%に置き換えず、`unavailable`と表示します

周期的な停止を解析するため、このサンプルは20 ms以上の長いframe、透明batch分断数16以上への到達、batch数の16以上の増加、queue CPU時間4 ms以上への到達、global sort状態の変化だけを最大64件のring bufferへ記録します。通常frameでは詳細objectやJSONを生成しません。ブラウザconsoleで`getTransmissionAnomalyLog()`を実行すると、時系列順の記録を取得できます。各記録には透明Nodeのlocal／world角度（degree、yaw／pitch／roll）と位置、投影境界、干渉pair、triangle数、instance別batch run数、queue CPU時間、各passの最新CPU／GPU時間が含まれます。GPU timestampは非同期readbackの最新値であり、停止frameと完全に同じframeとは限りません。

透明instanceの干渉判定は、まずlocal AABBの8 cornerで安価な候補判定を行い、候補となったinstanceだけ実際の透明triangle頂点からtightな投影boundsを求めます。これによりSphereやTorusの表面上に存在しないAABB cornerが作る過剰なscreen overlapを除きます。tight boundsで残った重なりも、重なり矩形の短辺がrender target上で8 pixel以下なら、細い境界部分の描画順よりframe時間を優先して独立instanceとして扱います。除外pair数と最大除外幅はDiagnosticsと異常ログへ記録します。

ray探索はコア既定値の最大距離42、交差許容厚み0.10、基準48 stepを使います。透明物内部と透明物を出た後の背景探索は、どちらも画面上のray主軸で約8 pixel間隔を目標にstep数を増やし、既定条件では48から最大96 stepの範囲になります。交差候補を見つけた後は5回の二分探索で区間を1/32まで狭めます。交差許容厚みは、離散的に進むrayをdepth surfaceへ到達したと判定する範囲です。

## 実装の意味

`TransparencyPass`は透明物をG-bufferへ追加せず、既存の不透明depthを使って最前面のentry maskを作ります。entry targetはRGへoctahedral encodeした完全なview-space法線、BへTransmission、Aへlinear view depthを保存します。別のReverse-Z depth付きtargetへback faceだけを描き、Rへexit depth、GBへexit法線のoct encode、AへIORを保存します。octahedral encodeは単位法線のXYZを二成分へ畳み込み、Compute Shader側で前後方向を含む法線へ復元できる形式です。

Compute Shaderは次の順で二つの境界面と背景までの光線を追跡します。

```text
entryPosition = reconstructViewPosition(entryUV, entryDepth)
insideDirection = refract(cameraRay, entryNormal, 1 / IOR)
exitPosition = rayMarchTransparentFrontAndBack(entryPosition, insideDirection)
outsideDirection = refract(insideDirection, -exitNormal, IOR)
if totalInternalReflection:
    reflectedDirection = reflect(insideDirection, exitNormal)
    exitPosition = rayMarchTransparentFrontAndBack(exitPosition, reflectedDirection)
    outsideDirection = refract(reflectedDirection, -exitNormal, IOR)
backgroundPosition = rayMarchOpaqueDepth(exitPosition, outsideDirection)
opticalDistance = sumOfInternalRaySegments
transmittance.rgb = attenuationColor.rgb ^ (opticalDistance / attenuationDistance)
absorbedRefraction.rgb = refractedBackground.rgb × transmittance.rgb
effectiveTransmission = materialTransmission × passTransmissionStrength
surfaceAlpha = 1 - effectiveTransmission × (1 - materialSurfaceAlpha)
```

entryではcameraから表面へ向かう入射rayとentry法線から、空気から媒質へ進む方向をWGSLの`refract()`で求めます。内部rayはentry targetのfront surfaceとexit targetのback surfaceを同時に調べ、先に横切った境界区間を5回のbinary searchで絞ります。cameraから見たfront／back分類だけに出口を限定しないため、凹形状の内側や内部reflection後にfront surfaceへ到達する経路も候補になります。

最初の境界で媒質から空気への`refract()`が全反射を返した場合は、`reflect()`で媒質内を進む方向を求め、同じfront／back境界探索をもう一度行います。2つ目の境界で空気へ出られた場合は、その位置から不透明G-buffer depthへ進めて最初の背景surfaceを探します。Beer-Lambert吸収の光路長にはreflection前後の両区間を加えます。背景surfaceがなくrayが画面内の遠方へ向く場合は、その方向をscreen UVへ投影してHDR sceneを読みます。

画面外や未観測領域へ進み、screen-space情報だけでは背景を決められないrayには、`transmissionRayMissFallback`を使います。`"auto"`はHDR環境に元の`radiance`があればray方向の環境色、なければ`renderScene()`へ渡した`clearColor`を選びます。`"environment"`はHDR radianceを必須にし、不足時はclearColorへ自動変更せず例外にします。`"clear"`は常にclearColor、`"constant"`は`transmissionRayMissColor`で指定した固定色を使います。固定色とclearColorは表示用sRGBで指定し、TransparencyPassがTone Mapping前の線形色へ一度だけ変換します。

```js
pipeline.encode(gpu.commandEncoder, {
  // ...ほかのeffect設定
  transparency: {
    transmissionEnabled: true,
    transmissionRayMissFallback: "constant",
    transmissionRayMissColor: [0.04, 0.06, 0.10, 1.0]
  }
});
```

`transmissionRayMissColor`は`"constant"`でだけ受け付けます。色を指定しない`"constant"`や、ほかのmodeと同時に指定した色は入力の誤りとして停止します。内部境界未発見や2回目の境界でも全反射する場合は外向き方向自体を決められないため、environment modeでも方向を推測せずclearColorを使います。constant modeでは、この場合にも指定固定色を使います。

正常にhitしたpixelでは、吸収後の屈折色をそのまま背景として使い、同一pixelの未屈折scene色は混ぜません。Transmissionの非透過分は後段PBR Forwardのsurface Alphaへ配分します。Transmission 1.0では指定したSurface Alphaを使い、Transmissionを下げるほどsurface側が不透明へ近づきます。これによりsurface radianceと屈折光の二成分を合成し、正位置の背景がghost像として残ることを防ぎます。

吸収色は白、吸収距離は無限大が既定値で、この組合せでは透過率が1となり既存材質の色は変わりません。Transmission全体が無効、または個々のmaterialでTransmissionが0なら屈折処理を適用せず、Alpha surfaceとして描画します。処理はTone Mapping前の`rgba16float`線形HDRで行います。

## 現在の制限

これはscreen-spaceの境界面近似です。normal textureはentry屈折法線へ反映されますが、画面外や他の物体に隠れてtargetへ記録されない面の正確な交点、重なった複数体積の正確な対応、多層屈折、色分散は扱いません。背景交点を観測できないrayは選択したenvironment、clearColor、constantで置き換えますが、対応範囲はtargetへ記録された幾何形状です。内部reflectionは1回まで追跡し、2つ目の境界でも全反射する経路には追加bounceを行いません。Beer-Lambert吸収にはreflectionを含むview-space内部光路長を使います。

`Ray Debug`は通常表示で選択したfallbackとは別の分類表示です。Debugを有効にした場合はfallback色より診断色を優先します。Debugを無効にしてもfront／back両surface探索と1回の内部reflectionは実行されます。紫は初回またはreflection後に次の境界を発見できなかった領域、黄はreflection後の2つ目の境界でも全反射した領域として、追加改善が必要な経路を残します。

このサンプルではwebgの材質パラメーターでTransmission、IOR、Volume吸収を直接設定します。glTFの`KHR_materials_transmission`、`KHR_materials_ior`、`KHR_materials_volume`の読み込みとAlpha 1の物理Transmission材質は、ここで説明する対応範囲の外です。
