# 付録 API一覧

最終更新：2026-04-11 JST

この付録は、`webg` の公開 API をカテゴリごとに引くための一覧です。前置きの説明は最小限にとどめ、クラス、関数、代表的メソッドを実装名に合わせて確認できる構成にしています。

## 1. 描画基盤

描画基盤は、`Screen` が canvas と WebGPU 初期化を、`RenderTarget` がオフスクリーンテクスチャを、`Shader` がパイプラインと uniform を、`FullscreenPass` 系がポストプロセスを担当します。

ここを先に押さえると、bloom、被写界深度（DOF）、vignette、背景描画、wireframe、billboard のような上位機能が「何を土台にしているか」を追いやすくなります。

### `Screen`
`Screen` は `#canvas` を基準に WebGPU を開始し、リサイズ、クリア、プレゼント、スクリーンショット、レンダリングループの入口をまとめます。

- `constructor(document)`: `#canvas` を取得して WebGPU 初期化の入口を作る
- `resize(w, h)`: canvas と内部サイズを更新し、DPR 反映後の描画サイズへ合わせる
- `getRecommendedFov(base = 55.0)`: 現在のアスペクト比に合う推奨縦 FOV を返す
- `setClearColor(color)`: クリア時に使う RGBA 色を設定する
- `getGL()`: 内部の WebGPU context を返す
- `getFrameCount()`: `clear()` が何回呼ばれたかを返す
- `getAspect()`: 現在の width / height を返す
- `getWidth()`: 現在の描画幅を返す
- `getHeight()`: 現在の描画高さを返す
- `createRenderTarget(options = {})`: 同じ GPU 上にオフスクリーン `RenderTarget` を作る
- `resetFrameCount()`: フレームカウンタを 0 に戻す
- `cullFace()`: 互換用 no-op として残してある
- `viewport()`: 互換用 no-op として残してある
- `clear(target = null)`: canvas または指定 target の color / depth をクリアする
- `clearDepthBuffer(target = null)`: color を保ったまま depth だけをクリアする
- `beginPass(options = {})`: 任意の target と load / clear 条件でレンダリングパスを開始する
- `endPass()`: 現在のパスを終了する
- `submit()`: コマンドを GPU に送信する
- `present()`: 画面への反映を確定する
- `animation(loopFunc)`: `requestAnimationFrame` でループを開始する
- `update()`: 互換用 no-op として残してある
- `swapInterval(interval)`: 互換用 no-op として残してある
- `screenShot(filename)`: canvas 内容を PNG として保存する

### `RenderTarget`
`RenderTarget` はオフスクリーン描画先です。`sampleDepth: true` を付けると、後段パスから depth を読む構成にできます。

- `constructor(gpu, options = {})`: オフスクリーンの color / depth texture と sampler を初期化する
- `resize(width, height)`: texture サイズを作り直して描画先を更新する
- `resizeToScreen(screen)`: `Screen` の現在サイズに追従する
- `destroy()`: 内部 texture 群を破棄する
- `getWidth()`: 現在の幅を返す
- `getHeight()`: 現在の高さを返す
- `getFormat()`: color texture の format を返す
- `getTexture()`: color texture 本体を返す
- `getView()`: color view を返す
- `getColorView()`: color view の別名として返す
- `getDepthView()`: depth view を返す
- `getDepthTexture()`: depth texture 本体を返す
- `getDepthSampleView()`: shader から読むための depth view を返す
- `isDepthSampled()`: depth を sample 可能かどうかを返す
- `getSampler()`: fullscreen pass 用 sampler を返す

### `Shader`
`Shader` は、派生クラスが共通で使う基底です。uniform buffer、bind group layout、shader module、pipeline layout、texture 解決をまとめます。

- `constructor(gpu)`: GPU 参照と共通状態を初期化する
- `createResources()`: 派生クラス側で resources を作るためのフック
- `createUniformBuffer(byteLength)`: 指定サイズの uniform buffer を作る
- `createShaderModule(code)`: WGSL 文字列から shader module を作る
- `createPipelineLayout(bindGroupLayouts)`: pipeline layout を作る
- `createUniformBindGroupLayout(options)`: uniform 用 bind group layout を作る
- `createTextureBindGroupLayout(options)`: texture / sampler 用 layout を作る
- `createUniformTextureBindGroupLayout(options)`: uniform と texture を混在させる layout を作る
- `createDefaultTexture(options)`: 既定の 1x1 texture / sampler を作る
- `resolveTextureResources(texture)`: texture 引数から view / sampler を解決する
- `getOrCreateTexturedBindGroup(options)`: texture 対応 bind group をキャッシュ付きで返す
- `updateUniforms()`: 現在の uniformData を GPU へ転送する
- `updateUniformsAt(index)`: 配列型 uniform の指定位置だけを転送する
- `allocUniformIndex()`: 動的 offset 用 index を確保する
- `useProgram(passEncoder)`: pipeline を pass encoder へ設定する
- `updateParam(param, key, updateFunc)`: shaderParameter の差分更新を行う

### `FullscreenPass`
`FullscreenPass` は、1 枚の texture を fullscreen quad で描く最小ポストプロセス基盤です。`VignettePass` はこの上に乗っています。

- `constructor(gpu, options = {})`: fullscreen quad で 1 枚の texture を描く基盤を作る
- `setSource(texture)`: 描画元 texture または RenderTarget を設定する
- `setColorScale(r, g, b, a = 1.0)`: 出力色へ掛ける係数を設定する
- `setUvScale(u, v)`: source texture の UV scale を設定する
- `setUvOffset(u, v)`: source texture の UV offset を設定する
- `draw(texture = this.texture)`: 現在の pass へ source texture を描く

### `VignettePass`
`VignettePass` は、周辺減光を足す軽量パスです。`samples` の最終出力や HUD 付きの画面で使いやすい構成です。

- `constructor(gpu, options = {})`: vignette 用 fullscreen pass を初期化する
- `setCenter(x, y)`: vignette の中心を UV 基準で更新する
- `setRadius(value)`: 外周半径を更新する
- `setSoftness(value)`: 内側から外周へ落ちる滑らかさを更新する
- `setStrength(value)`: vignette の効きの強さを更新する
- `setEnabled(flag)`: vignette の ON / OFF を切り替える
- `setTint(r, g, b, a = 1.0)`: 周辺にかける色を更新する
- `render(screen, options = {})`: source texture に vignette を掛けて描画する

### `SeparableBlurPass`
`SeparableBlurPass` は、横 blur と縦 blur を ping-pong するヘルパーです。bloom と被写界深度（DOF）の両方で使います。

- `constructor(gpu, options = {})`: blur 用 ping-pong helper を初期化する
- `setBlurRadius(value)`: blur サンプル間隔の倍率を更新する
- `setIterations(value)`: horizontal / vertical blur の往復回数を更新する
- `setTargetScale(value)`: 内部 blur target の縮小率を更新する
- `resize(width, height)`: 内部 blur targets を指定サイズへ更新する
- `resizeToScreen(screen)`: `Screen` の現在サイズへ追従する
- `getTargetA()`: blur 用一時 target A を返す
- `getTargetB()`: blur 用一時 target B を返す
- `getOutputTarget()`: 直近 render の最終 target を返す
- `getTargetScale()`: 現在の target scale を返す
- `getScaledWidth()`: 縮小後の幅を返す
- `getScaledHeight()`: 縮小後の高さを返す
- `render(screen, source, options = {})`: source texture へ separable blur を掛ける

### `BloomPass`
`BloomPass` は、scene color、bright extract、blur、composite をまとめます。`samples/bloom` の中心です。

- `constructor(gpu, options = {})`: bloom 用の scene/extract/blur/composite helper を初期化する
- `setEnabled(flag)`: bloom の ON / OFF を切り替える
- `setThreshold(value)`: bright extract の閾値を更新する
- `setSoftKnee(value)`: extract の立ち上がりを滑らかにする
- `setExtractIntensity(value)`: extract 結果を blur へ回す強さを更新する
- `setBloomStrength(value)`: composite 時の bloom 強度を更新する
- `setExposure(value)`: composite 後段の exposure を更新する
- `setToneMapMode(value)`: tone map mode を切り替える
- `setBlurRadius(value)`: blur サンプル間隔を更新する
- `setBlurScale(value)`: blur helper の内部 target scale を更新する
- `setBlurIterations(value)`: blur の往復回数を更新する
- `resize(width, height)`: 内部 scene / extract / blur targets を更新する
- `resizeToScreen(screen)`: `Screen` の現在サイズへ追従する
- `getSceneTarget()`: 3D scene の offscreen target を返す
- `getExtractTarget()`: bright extract 結果の target を返す
- `getExtractHeatTarget()`: extract 強度を heat 表示する target を返す
- `getBlurTargetA()`: blur helper の一時 target A を返す
- `getBlurTargetB()`: blur helper の一時 target B を返す
- `getBlurScale()`: 現在の blur target scale を返す
- `beginScene(screen, clearColor = screen.clearColor)`: scene target を clear して 3D 描画を始める
- `render(screen, options = {})`: bloom 合成して canvas または destination に出力する

### `DofPass`
`DofPass` は、scene color、sampled depth、blur color から被写界深度を合成します。`samples/dof` の中心です。

- `constructor(gpu, options = {})`: 被写界深度（DOF）用の scene / depth / blur 合成 helper を初期化する
- `setEnabled(flag)`: 被写界深度（DOF）の ON / OFF を切り替える
- `setFocusDistance(value)`: sharp に保ちたい距離を更新する
- `setFocusRange(value)`: focus 面の前後で sharp に残す幅を更新する
- `setMaxBlurMix(value)`: blur を scene へ最大どこまで混ぜるかを更新する
- `setProjectionRange(near, far)`: depth 線形化のための near / far を更新する
- `setBlurRadius(value)`: blur サンプル間隔の倍率を更新する
- `setBlurIterations(value)`: blur の往復回数を更新する
- `setBlurScale(value)`: blur helper の内部 target scale を更新する
- `resize(width, height)`: scene / blur targets を指定サイズへ更新する
- `resizeToScreen(screen)`: `Screen` の現在サイズへ追従する
- `getSceneTarget()`: 3D scene と depth の描画先 target を返す
- `getBlurTargetA()`: blur helper の一時 target A を返す
- `getBlurTargetB()`: blur helper の一時 target B を返す
- `getBlurScale()`: 現在の blur target scale を返す
- `getDepthDebugTarget()`: depth デバッグ用 target を返す
- `getFocusDebugTarget()`: focus mask デバッグ用 target を返す
- `beginScene(screen, clearColor = screen.clearColor)`: scene target を clear して 3D 描画を始める
- `render(screen, options = {})`: depth を使って被写界深度（DOF）合成して出力する

### `Background`
`Background` は、画面後景に texture や色を配置するヘルパーです。

- `constructor(gpu)`: 背景描画用の shader / texture state を初期化する
- `createResources()`: 背景描画に必要な resources を作る
- `createDefaultTexture()`: 既定の 1x1 texture を作る
- `getBindGroup(texture)`: 指定 texture 用 bind group を返す
- `setColor(r, g, b)`: 背景色を設定する
- `setAspect(aspect)`: 背景の縦横比を設定する
- `setWindow(left, top, width, height)`: 背景を置くウィンドウ領域を設定する
- `setWindowPixels(x, y, width, height, screenWidth, screenHeight)`: pixel 基準で window を設定する
- `setTextureAspect(textureWidth, textureHeight, rectWidth, rectHeight)`: texture と表示矩形の比率を合わせる
- `setOrder(order)`: 描画順を設定する
- `init()`: 背景描画の初期化を行う
- `setBackground(texture)`: 表示する背景 texture を設定する
- `makeShape()`: 背景用 quad shape を作る
- `draw()`: 背景を描画する

### `Wireframe`
`Wireframe` は、shape の線表示を行う最小 shader です。`unittest` やデバッグ用に便利です。

- `constructor(gpu)`: wireframe 用 shader state を初期化する
- `createResources()`: wireframe 描画に必要な resources を作る
- `getBindGroup()`: wireframe 用 bind group を返す
- `setProjectionMatrix(m)`: projection matrix を設定する
- `setModelViewMatrix(m)`: model-view matrix を設定する
- `setNormalMatrix(m)`: normal matrix を設定する
- `setColor(color)`: 線色を設定する
- `doParameter(param)`: shape 側 parameter をまとめて反映する

### `SmoothShader`
`SmoothShader` は、現在の標準 3D 材質です。static mesh、skinned mesh、texture、normal map、fog を 1 本の入口で扱います。

- `constructor(gpu, options = {})`: smooth shading 用の標準 shader を初期化する。`backfaceDebug`、`cullMode`、`frontFace`、depth 設定もここで受ける
- `createResources()`: uniform buffer、bind group layout、pipeline など GPU 資源を作る
- `createDefaultTexture()`: texture 未指定時に使う既定の 1x1 texture を作る
- `createDefaultNormalTexture()`: normal map 未指定時に使う既定の flat normal texture を作る
- `createDefaultBoneBindGroup()`: bone palette 未指定時に使う既定の bind group を作る
- `useProgram(passEncoder)`: 現在の render pass に pipeline を設定する
- `getBindGroup(texture)`: texture と normal texture の組み合わせから bind group を返す
- `getBindGroup1(texture)`: group(1) 用 bind group を明示的に取得する
- `getBindGroup2(skeleton = null)`: bone palette 用 bind group を返す
- `ensureSkinEntry(skeleton = null)`: skeleton ごとの bone buffer / bind group を必要に応じて作る
- `getDummySkinVertexBuffer()`: 非スキニング shape でも同じ layout で描ける代替 skin vertex buffer を返す
- `setProjectionMatrix(m)`: projection matrix を設定する
- `setModelViewMatrix(m)`: model-view matrix を設定する
- `setNormalMatrix(m)`: normal matrix を設定する
- `setLightPosition(x, y, z, w = 1.0)`: light 位置または方向を設定する
- `setColor(color)`: 材質の基本色を設定する
- `setAmbientLight(value)`: 環境光の強さを設定する
- `setSpecular(value)`: 鏡面反射の強さを設定する
- `setSpecularPower(value)`: 鏡面反射の鋭さを設定する
- `setEmissive(value)`: 発光成分の強さを設定する
- `setHasBone(flag)`: スキニング経路を使うかを切り替える
- `useTexture(flag)`: color texture を使うかを切り替える
- `setWeightDebug(flag)`: bone weight の RGB 可視化を切り替える
- `useNormalMap(flag)`: normal map を使うかを切り替える
- `setNormalStrength(value)`: normal map の効きの強さを設定する
- `setFogColor(color)`: fog 色を設定する
- `setFogNear(value)`: linear fog の開始距離を設定する
- `setFogFar(value)`: linear fog の終了距離を設定する
- `setFogDensity(value)`: exponential fog の密度を設定する
- `setFogMode(value)`: fog mode を設定する
- `setUseFog(flag)`: fog の有効 / 無効を切り替える
- `setBackfaceDebug(flag)`: 裏面デバッグ表示を切り替える
- `setBackfaceColor(color)`: 裏面デバッグ色を設定する
- `setTextureUnit(texUnit)`: 互換用 no-op として残してある
- `setMatrixPalette(matrixPalette)`: bone palette を shader へ渡す
- `updateTexture(texture)`: shape 側から渡された texture を現在の bind group へ反映する
- `doParameter(param)`: `shape.shaderParameter()` や `shape.setMaterial()` で渡した値をまとめて反映する
- `setDefaultParam(param)`: 既定パラメータを差し替える

### `FlatShader`
`FlatShader` は `SmoothShader` と同じ API を持ち、最終法線だけを面法線へ切り替える材質です。

- `constructor(gpu, options = {})`: `SmoothShader` を土台に初期化し、フラグメント側の法線生成を flat shading 用へ差し替える
- `SmoothShader` の各メソッド: `setColor()`、`useTexture()`、`useNormalMap()`、`setHasBone()`、`setMatrixPalette()`、`setFog...()` などはそのまま同じ意味で使える

### `Phong` / `NormPhong` / `BonePhong` / `BoneNormPhong`
これらは分割構成の旧来 shader 群です。現行の標準入口は `SmoothShader` / `FlatShader` ですが、個別実装を読むときや差分比較では引き続き参照します。

- `Phong`: 標準のライティング shader。`setLightPosition()`、`useTexture()`、`setAmbientLight()`、`setSpecular()`、`setSpecularPower()`、`setColor()`、`setFogColor()`、`setFogNear()`、`setFogFar()`、`setFogDensity()`、`setFogMode()`、`setUseFog()`、`setProjectionMatrix()`、`setModelViewMatrix()`、`setNormalMatrix()`、`updateTexture()`、`doParameter()` を持つ
- `NormPhong`: `Phong` に normal map を足した版。`useNormalMap()`、`setNormalStrength()`、`createDefaultNormalTexture()` で凹凸表現を追加する
- `BonePhong`: `Phong` にスキニングを足した版。`setHasBone()`、`setWeightDebug()`、`setMatrixPalette()`、`getDummySkinVertexBuffer()`、`getBindGroup1(texture)` で bone palette を扱う
- `BoneNormPhong`: `BonePhong` と `NormPhong` を合わせた版。スキニングと normal map を同時に扱う

### `BillboardShader`
`BillboardShader` は、常に camera に向く quad 表現の基盤です。

- `constructor(gpu)`: billboard 用 shader state を初期化する
- `createResources()`: billboard 描画に必要な resources を作る
- `createDefaultTexture()`: 既定の billboard texture を作る
- `getBindGroup(texture)`: 指定 texture 用 bind group を返す
- `setProjectionMatrix(m)`: projection matrix を設定する
- `setViewMatrix(m)`: view matrix を設定する
- `setCameraAxes(right, up)`: camera の right / up 軸を設定する
- `setOpacity(alpha)`: billboard の透明度を設定する

## 2. ジオメトリ / シーングラフ

`Shape`、`CoordinateSystem`、`Node`、`Space` は、`webg` のシーングラフの中心です。

`Shape` は geometry と material、`Node` は階層、`Space` は node 木全体、`Skeleton` は骨階層の管理を担当します。

### `Shape`
`Shape` は、頂点、三角形、法線、UV、skin weight、material、shader の入り口です。`Primitive` や `ModelBuilder` の build 結果が最終的にここへ入ります。

- `constructor(gpu)`: shape 用の GPU state と配列を初期化する
- `setName(name)`: shape 名を設定する
- `getName()`: shape 名を返す
- `setAutoCalcNormals(flag)`: 法線の自動計算を ON / OFF する
- `setAnimation(anim)`: shape に紐づく animation を設定する
- `getAnimation()`: 紐づいた animation を返す
- `getVertexCount()`: 頂点数を返す
- `getTriangleCount()`: 三角形数を返す
- `shaderParameter(key, value)`: shape の shaderParameter を設定する
- `setMaterial(materialId, params = {})`: material id と shader params を設定する
- `updateMaterial(params = {})`: 既存 material に対する差分更新を行う
- `getMaterial()`: 現在の material 情報を返す
- `setShader(shader)`: shape が使う shader を設定する
- `setTexture(texture)`: texture を設定する
- `setTextureMappingMode(mode)`: texture mapping mode を設定する
- `setTextureMappingAxis(axis)`: texture mapping axis を設定する
- `setTextureScale(scale_u, scale_v)`: texture のスケールを設定する
- `setWireframe(flag = true)`: wireframe 表示を切り替える
- `isWireframe()`: wireframe 状態を返す
- `setSkeleton(skeleton)`: スキニングに使う skeleton を設定する
- `getSkeleton()`: skeleton を返す
- `hide(true_or_false)`: shape の表示 / 非表示を切り替える
- `endShape()`: 頂点バッファを確定して GPU へ送る
- `draw(modelview, normal)`: 現在の shader で描画する
- `releaseObjects()`: GPU 資源を解放する
- `setVertex(x, y, z)`: 現在頂点を書き込む
- `addVertex(x, y, z)`: 頂点を追加する
- `addVertexUV(x, y, z, u, v)`: 頂点と UV を追加する
- `addVertexPosUV(pos, uv)`: position / UV の対を追加する
- `setVertNormal(vn, x, y, z)`: 指定頂点の normal を設定する
- `getVertNormal(vn)`: 指定頂点の normal を返す
- `getVertPosition(vn)`: 指定頂点の position を返す
- `addVertexWeight(vn, ind, wt)`: skin weight を追加する
- `addTriangle(p0, p1, p2)`: 3 頂点で triangle を作る
- `addPlane(indices)`: 既存 index から plane を作る
- `getPrimitiveOptions()`: Primitive 生成時の既定 option を返す
- `applyPrimitiveAsset(asset)`: Primitive 由来アセットを shape に流し込む

### `CoordinateSystem`
`CoordinateSystem` は、位置、姿勢、親子関係、行列変換の基底です。`Node`、`EyeRig`、`Frame`、`Billboard` の土台になります。

- `constructor(parent_node, name)`: 親子関係付きの座標系を初期化する
- `setName(name)`: node 名を設定する
- `getName()`: node 名を返す
- `setParent(parent)`: 親 node を設定する
- `getParent()`: 親 node を返す
- `addChild(child)`: 子 node を追加する
- `getNoOfChildren()`: 子の数を返す
- `getChild(n)`: 指定 index の子を返す
- `setAttitude(head, pitch, bank)`: head / pitch / bank で姿勢を設定する
- `setYawPitchRoll(yaw, pitch, roll)`: yaw / pitch / roll で姿勢を設定する
- `getWorldAttitude()`: world space の姿勢を返す
- `getLocalAttitude()`: local space の姿勢を返す
- `getWorldPosition()`: world space の位置を返す
- `getPosition()`: local position を返す
- `setPosition(x, y, z)`: position を設定する
- `rotateX(degree)`: X 軸回転を加える
- `rotateY(degree)`: Y 軸回転を加える
- `rotateZ(degree)`: Z 軸回転を加える
- `rotate(head, pitch, bank)`: head / pitch / bank で回転を加える
- `rotateYawPitchRoll(yaw, pitch, roll)`: yaw / pitch / roll で回転を加える
- `move(x, y, z)`: 位置を相対移動する
- `setMatrix()`: local matrix を再計算する
- `setWorldMatrix()`: world matrix を再計算する
- `setWorldMatrixAll(wmat)`: 子孫も含めて world matrix を更新する
- `getWorldMatrix()`: world matrix を返す
- `setByMatrix(matrix)`: matrix から姿勢と位置を設定する
- `setQuat(quat)`: quaternion から姿勢を設定する
- `getQuat()`: 現在の quaternion を返す
- `detach()`: 親から切り離す
- `attach(parent_node)`: 親へ接続する
- `inverse(new_parent)`: 新しい親に対する inverse を作る
- `distance(node)`: 2 node 間距離を返す

### `Node`
`Node` は `CoordinateSystem` に shape とスキニング関連を足したものです。`Space.addNode()` の返り値として最もよく触ります。

- `constructor(parent_bone, name)`: 親 bone を持つ node を初期化する
- `setAttachable(true_or_false)`: attach 可否を設定する
- `detach()`: 親から切り離す
- `attach(parent_node)`: 指定親へ接続する
- `setRestPosition(x, y, z)`: rest position を設定する
- `setRestByMatrix(matrix)`: rest matrix を設定する
- `setRestMatrix()`: rest matrix を再計算する
- `setModelMatrixAll(mmat)`: model matrix を子孫込みで更新する
- `setGlobalMatrixAll(wmat)`: global matrix を子孫込みで更新する
- `getRestMatrix()`: rest matrix を返す
- `getModelMatrix()`: model matrix を返す
- `getBofMatrix()`: bone offset matrix を返す
- `getGlobalMatrix()`: global matrix を返す
- `addShape(shape)`: shape を node に追加する
- `delShape()`: shape を外す
- `setShape(shape)`: node の shape を置き換える
- `getShape(n)`: n 番目の shape を返す
- `getShapeCount()`: shape 数を返す
- `draw(view_matrix, light_vec, count)`: node を描画する
- `drawBones()`: bone 可視化を描画する

### `Space`
`Space` は node 木の管理と描画の入口です。`draw(eye)` が最重要 API です。

- `constructor()`: シーングラフの root と時間管理を初期化する
- `addNode(parent_node, name)`: 親 node の下に新しい node を作る
- `delNode(name)`: node を削除する
- `findNode(name)`: node 名で検索する
- `listNode()`: node 一覧を返す
- `scanSkeletons()`: skeleton をスキャンして更新する
- `now()`: 現在時刻を返す
- `timerStart()`: タイマーを開始する
- `uptime()`: 起動後経過時間を返す
- `deltaTime()`: 前回フレームからの経過時間を返す
- `count()`: node 数を返す
- `setLight(node)`: 光源 node を設定する
- `setLightType(type)`: 光源タイプを設定する
- `getLightType()`: 光源タイプを返す
- `setEye(node)`: 視点 node を設定する
- `draw(eye_node)`: node 木を描画する
- `drawBones()`: 全 bone を描画する
- `raycast(origin, dir, { firstHit = true, filter } = {})`: レイキャストを実行する
- `checkCollisions({ firstHit = false, filter, includeHidden = false } = {})`: 衝突判定を行う
- `checkCollisionsDetailed(options = {})`: 詳細な衝突判定結果を返す
- `updateCollisionEvents(options = {})`: 衝突イベント状態を更新する

### `Skeleton`
`Skeleton` は bone tree と matrix palette を管理します。`BonePhong` / `BoneNormPhong` と組み合わせて使います。

- `constructor()`: bone tree と palette を初期化する
- `clone()`: skeleton の複製を作る
- `addBone(parent_bone, name)`: bone を追加する
- `setBoneShape(shape)`: bone 表示用 shape を設定する
- `setAttachable(true_or_false)`: attach 可否を設定する
- `isAttachable()`: attach 可能か返す
- `isShown()`: bone が表示対象か返す
- `showBone(true_or_false)`: bone 表示を切り替える
- `setBoneOrder(names)`: palette 順を設定する
- `getBoneOrder()`: palette 順を返す
- `getBoneNo(name)`: bone 名から index を返す
- `getBoneCount()`: bone 数を返す
- `getBone(name)`: bone を名前で返す
- `getBoneFromJointNo(num)`: joint index から bone を返す
- `getJointFromBone(bone)`: bone から joint を返す
- `getBoneNoFromBone(bone)`: bone から index を返す
- `bindRestPose()`: rest pose を固定する
- `updateMatrixPalette()`: matrix palette を更新する
- `listBones()`: bone 一覧を返す
- `printMatrixPalette()`: palette 内容を出力する
- `drawBones()`: bone を可視化描画する

### `Billboard`
`Billboard` は、画面に向く小さな板を複数並べるときに使います。scene 上に浮かせる注釈や marker を作りたいときにも向いています。

- `constructor(gpu, maxCount = 256)`: billboard 群を初期化する
- `setTexture(texture)`: billboard に使う texture を設定する
- `setOpacity(alpha)`: 透明度を設定する
- `clear()`: 登録済み billboard を消す
- `addBillboard(x, y, z, sx, sy, color = [1.0, 1.0, 1.0, 1.0])`: billboard を 1 個追加する
- `setPosition(index, x, y, z)`: 指定 billboard の位置を変える
- `setScale(index, sx, sy)`: 指定 billboard の大きさを変える
- `setColor(index, r, g, b, a)`: 指定 billboard の色を変える
- `setCamera(eyeNode, projectionMatrix)`: camera 参照を設定する
- `drawWithAxes(eyeNode, projectionMatrix, right, up)`: camera 軸を指定して描く
- `draw(eyeNode, projectionMatrix)`: billboard を描画する
- `drawGround(eyeNode, projectionMatrix)`: 地面向けの billboard を描画する

### `Primitive`
`Primitive` は、`Cube`、`Sphere`、`Arrow` などのプリミティブを `Shape` へ流し込むファクトリです。`samples/model_shape`、`samples/scene`、`unittest/primitive_modelasset` でよく使います。

- `constructor(options = {})`: primitive 生成用の作業領域を初期化する
- `calcUV(x, y, z)`: 頂点座標から UV を計算する
- `addVertex(x, y, z)`: 頂点を追加する
- `addVertexUV(x, y, z, u, v)`: 頂点と UV を追加する
- `addTriangle(a, b, c)`: 三角形を追加する
- `addAltVertex(source, duplicate)`: seam 用の重複頂点を記録する
- `addPlane(indices)`: plane を追加する
- `toGeometry()`: primitive を geometry object に変換する

### `Mesh`
`Mesh` は、`Frame` から展開される旧来の中間表現ですが、現行コードでも import 参照先として残っています。

- `constructor(frame)`: frame 由来の mesh を初期化する
- `setName(name)`: mesh 名を設定する
- `getName()`: mesh 名を返す
- `setVertices(verts)`: 頂点配列を設定する
- `getVertices()`: 頂点配列を返す
- `setPolygons(polygons)`: polygon 配列を設定する
- `getPolygons()`: polygon 配列を返す
- `setTextureCoord(texure_coord)`: UV 配列を設定する
- `getTextureCoord()`: UV 配列を返す
- `setSkinWeights(skin_weights)`: skin weight を設定する
- `getSkinWeights()`: skin weight を返す
- `setNormals(normals)`: normal 配列を設定する
- `getNormals()`: normal 配列を返す
- `setJointNames(joint_names)`: joint 名を設定する
- `getJointNames()`: joint 名を返す
- `setBindPoseMatrices(bindPoseMatrices)`: bind pose 行列を設定する
- `getBindPoseMatrices()`: bind pose 行列を返す
- `setBindShapeMatrix(bind_shape_matrix)`: bind shape matrix を設定する
- `getBindShapeMatrix()`: bind shape matrix を返す
- `setNodeMatrix(node_matrix)`: node matrix を設定する
- `getNodeMatrix()`: node matrix を返す
- `setMaterialId(id)`: material id を設定する
- `getMaterialId()`: material id を返す
- `updateBoundingBox(x, y, z)`: bounding box を更新する
- `printInfo()`: mesh 情報を出力する

## 3. 数学 / 時間

`Matrix` と `Quat` は transform と補間の基盤です。`Frame`、`Schedule`、`Task`、`Stack` はアニメーションやインポーターの内部補助で使われます。

### `Matrix`
- `constructor()`: 4x4 行列の入れ物を作り、各要素を扱える状態にする
- `makeUnit()`: 単位行列へ初期化する
- `makeZero()`: 全要素を 0 にする
- `set(row, column, val)`: 指定した要素を書き換える
- `setBulk(numtable)`: 配列の値をまとめて流し込む
- `setBulkWithOffset(numtable, offset)`: 配列の一部を指定オフセットから流し込む
- `get(row, column)`: 指定した要素を返す
- `clone()`: 同じ内容の新しい `Matrix` を返す
- `copyFrom(mat)`: 他の行列内容をそのままコピーする
- `setByQuat(quat)`: quaternion から回転行列を作る
- `setByEulerXYZ(rx, ry, rz)`: XYZ 順の Euler 角から行列を作る
- `setByEuler(head, pitch, bank)`: head / pitch / bank から行列を作る
- `position(position)`: 平行移動成分を設定する
- `getPosition()`: 平行移動成分を返す
- `add(mb)`: 行列加算を行う
- `mul(mb)`: 右側の行列を掛ける
- `lmul(mb)`: 左側の行列を掛ける
- `makeProjectionMatrix(near, far, vfov, ratio)`: 縦 FOV ベースの投影行列を作る
- `makeProjectionMatrixWH(near, far, width, height)`: 幅と高さから投影行列を作る
- `makeProjectionMatrixOrtho(near, far, width, height)`: 正射影行列を作る
- `inverse()`: 逆行列を作る
- `transpose()`: 転置行列を作る
- `makeView(w)`: 視点から見る view 行列を作る
- `mulVector(v)`: 4 次元ベクトルを掛ける
- `mul3x3Vector(v)`: 3x3 部分だけを使ってベクトルを掛ける
- `tmul3x3Vector(v)`: 3x3 部分の転置を使ってベクトルを掛ける

### `Quat`
- `constructor()`: 単位 quaternion を作る
- `mulQuat(qb)`: 右側の quaternion を掛ける
- `lmulQuat(qb)`: 左側の quaternion を掛ける
- `condugate()`: 共役 quaternion を返す
- `normalize()`: 長さを 1 にそろえる
- `setRotateX(degree)`: X 軸回転 quaternion を作る
- `setRotateY(degree)`: Y 軸回転 quaternion を作る
- `setRotateZ(degree)`: Z 軸回転 quaternion を作る
- `eulerToQuat(head, pitch, bank)`: Euler 角を quaternion に変換する
- `dotProduct(qr)`: 2 つの quaternion の内積を返す
- `negate()`: 符号反転した quaternion を返す
- `slerp(a, b, t)`: 2 つの quaternion を球面線形補間する
- `matrixToQuat(m)`: 行列から quaternion を復元する
- `quatToEuler()`: quaternion から Euler 角を返す
- `clone()`: 同じ内容の新しい quaternion を返す
- `copyFrom(quat)`: 他の quaternion をコピーする

### `Frame`
`Frame` は Collada の骨階層や joint 解析の補助で使われます。

- `constructor(parent, name, sid = null, display_name = null)`: 親子関係を持つ解析用 frame を作る
- `setByMatrix(matrix)`: matrix から frame の姿勢を設定する
- `setWeights()`: 解析済み weight 情報を整える
- `setType(type_name)`: frame 種別を設定する
- `getType()`: frame 種別を返す
- `getName()`: frame 名を返す
- `getCandidateNames()`: joint 名候補の一覧を返す
- `matchesName(name)`: 指定名に一致するかを判定する
- `resolveJointName(names)`: 候補名の中から joint 名を解決する
- `findFrame(name)`: 子孫から frame を検索する
- `getNoOfBones(names)`: 関連 bone 数を数える
- `findChildFrames(names)`: 子孫 frame を集める
- `getFramesFromNames(joint_names)`: joint 名一覧から frame 群を返す
- `copyToBone(...)`: frame の内容を bone へ転写する
- `list(level, out)`: 階層を 1 層分たどって内容を並べる
- `listAll(level, out)`: 子孫を含めて一覧化する

### `Schedule`
`Schedule` はアニメーションのコマンドキューです。`Animation` と `Task` の内部で使われます。

- `constructor(name)`: command queue の名前付き入れ物を作る
- `addTask(name)`: 新しい task を追加する
- `delTask(task)`: 指定 task を削除する
- `getEmptyTask()`: 空の task を返す
- `getNoOfTasks()`: task 数を返す
- `getTask(n)`: index 指定で task を返す
- `getTaskByName(name)`: 名前から task を返す
- `pause()`: 実行を一時停止する
- `start()`: 先頭から再生する
- `startFrom(start_ip)`: 指定位置から再生する
- `startFromTo(start_ip, stop_ip)`: 範囲を指定して再生する
- `doCommandFps(frame_per_sec)`: fps 基準で command を進める
- `doCommand()`: 1 回分の command を実行する
- `doOneCommand(ip, rate)`: 指定 command を 1 ステップ進める
- `directExecution(time, command, args, start_ip, stop_ip)`: 時間指定で command を直接実行する
- `setSpeed(time_scale)`: 実行速度を変更する

### `Task`
- `constructor(name, no)`: task 名と番号を持つ command 実行単位を作る
- `setTargetObject(target)`: command の対象オブジェクトを設定する
- `addCommand(cmd)`: command を末尾へ追加する
- `setTime(ip, time)`: command index ごとの時間を設定する
- `getTime(ip)`: 指定 command の時間を返す
- `getName()`: task 名を返す
- `getNoOfCommands()`: command 数を返す
- `setCommand(command_table)`: command table をまとめて設定する
- `partial_arg(arg, total_time, dtime)`: 時間比例で引数を補間する
- `controlCommand(command, arg)`: start / stop などの制御 command を処理する
- `execCommand(doarg)`: 1 個の command を実行する
- `getNextCommand()`: 次に実行する command を返す
- `start()`: task を先頭から始める
- `startFrom(start_ip)`: 指定 command 位置から始める
- `startFromTo(start_ip, stop_ip)`: 指定範囲で始める
- `execute(delta_msec)`: 経過時間を使って task を進める
- `executeOneCommand(ip, arg_rate)`: 1 command 分だけ進める
- `directExecution(command, doarg)`: 補間なしで command を実行する
- `insertCurrentCommand(time, command, arg, start_ip, stop_ip)`: 現在 command を挿入する

### `Stack`
- `push(contents)`: 末尾へ要素を積む
- `pop()`: 末尾の要素を取り出す
- `top()`: 末尾の要素を参照する
- `count()`: 現在の要素数を返す

## 4. テクスチャ / 文字 / HUD / UI

ここは、3D の上に texture、文字、操作ガイド、会話 UI を重ねるための層です。

`Texture` は画像や手続き生成の入口で、`Text` と `Message` は canvas 上の HUD を作ります。

`Dialogue`、`DebugDock`、`FixedFormatPanel`、`UIPanel` は canvas 外の DOM を使う UI 層で、表示場所と用途を分けて使うのが前提です。

### `Texture`
`Texture` は、単なる画像 wrapper ではなく、「画像を GPU texture として持つ」「procedural に生成する」「法線マップを派生させる」という複数の役割をまとめる class です。

`samples/shapes`、`samples/model_shape`、`samples/proctex`、`samples/sound` では、この class が見え方や素材生成の土台になっています。

- `constructor(gpu)`: texture / sampler を扱う基底 wrapper を作る
- `ensureTexture(width, height, format = "rgba8unorm", usage)`: 必要な texture を確保する
- `setupTexture()`: 既定状態の texture を準備する
- `setClamp()`: clamp sampling に切り替える
- `setRepeat()`: repeat sampling に切り替える
- `setImage(image, width, height, ncol)`: 画像データを texture へ流し込む
- `writeImageToFile()`: 現在の texture 画像を書き出す
- `createTexture(width, height, ncol, usage)`: 新しい texture を作る
- `fillTexture(r, g, b, a)`: 単色で texture を埋める
- `point(x, y, color)`: 1 ピクセルだけを書き換える
- `assignTexture()`: 現在の texture を描画用に割り当てる
- `name()`: texture 名を返す
- `active()`: 現在の texture が有効かを返す
- `getView()`: view を返す
- `getSampler()`: sampler を返す
- `buildProceduralHeightMap(options = {})`: 高さマップを手続き的に作る
- `buildProceduralBillboardTexture(options = {})`: billboard 用の手続き的 texture を作る

### `Font`
`Font` は text 用 shader と texture をまとめる base です。

- `constructor(gpu)`: 文字描画用 shader の共通状態を作る
- `createResources()`: text 描画に必要な GPU 資源を作る
- `createDefaultTexture()`: 既定の 1x1 texture を nearest sampler 付きで作る
- `getBindGroup(texture)`: 指定 font texture 用 bind group を返す
- `setTextureUnit(texUnit)`: 既存互換の no-op として残してある
- `setChar(x, y, ch)`: 描画対象の文字セル位置と文字コードを設定する
- `setPos(x, y)`: 描画位置だけを更新する
- `setScale(scale)`: 文字サイズ倍率を設定する
- `setColor(r, g, b)`: 文字色を設定する
- `getScale()`: 現在の文字サイズ倍率を返す
- `setTexStep(u, v)`: atlas 1 セル分の UV 幅と高さを設定する
- `setFlipV(enable)`: V 方向反転を切り替える
- `setTexelSize(u, v)`: atlas の 1 texel 分の UV 幅と高さを設定する
- `setCellStep(x, y)`: 1 文字セル分の NDC 幅と高さを設定する
- `setCharAt(index, x, y, ch)`: 動的 offset 用 uniform index へ文字情報を設定する
- `updateUniformsAt(index)`: 指定 index の uniform だけを GPU へ転送する

### `Text`
`Text` は 2D の文字列を grid ベースで描く class です。

役割は「任意位置へ ASCII 文字を並べること」で、`Message` の土台でもあります。

title、簡単なデバッグ文字列、最小 HUD を自前で組みたいときに使いますが、通常のサンプルでは `Message` や `WebgApp` helper の方が扱いやすいです。

- `constructor(gpu, options = {})`: grid ベース文字描画の状態を作る
- `setGridSize(cols, rows)`: 文字グリッドの大きさを設定する
- `getGridSize()`: 文字グリッドの現在サイズを返す
- `getVisibleGridSize(scale = this.shader?.getScale?.() ?? 1.0)`: 画面に見えている grid サイズを返す
- `getLayoutInfo(scale = this.shader?.getScale?.() ?? 1.0)`: grid と余白の配置情報を返す
- `goTo(x, y)`: カーソル位置を移動する
- `saveCursor()`: 現在のカーソル位置を退避する
- `restoreCursor()`: 退避したカーソル位置へ戻す
- `scrollUp()`: 1 行上へスクロールする
- `incCursorPosition()`: カーソルを次の位置へ進める
- `write(str)`: 現在位置へ文字列を書く
- `writef(fmt, ...args)`: 書式付き文字列を書く
- `writeAt(x, y, str)`: 指定位置へ文字列を書く
- `writefAt(x, y, fmt, ...args)`: 指定位置へ書式付き文字列を書く
- `drawText(str, x, y)`: 文字列を即時描画する
- `clearLine(lineNo)`: 指定行を消す
- `clearScreen()`: 画面全体を消す
- `setScale(scale)`: 文字サイズ倍率を設定する
- `setMinCharCode(code)`: 文字 atlas の最小文字コードを設定する
- `makeShape()`: 文字描画用 shape を作る
- `initFont()`: 既定 font を初期化する
- `getDefaultFontImage()`: 既定 font atlas 画像を返す
- `drawScreen()`: 現在の文字バッファを画面へ出す

### `Message`
`Message` は HUD / guide / status 表示を block 単位で扱う class です。`WebgApp` と `SceneLoader` でよく使います。

`Text` より高レベルで、`id`、`anchor`、`block` の単位で配置できるため、START、SCORE、HIGH SCORES、短い result title、簡単な操作案内のような「短い ASCII 表示」をまとめやすくなります。

一方で、日本語や一般的な UTF-8 会話文を出す用途には向いていません。その場合は `Dialogue` や `UIPanel` を使うのが標準です。

- `constructor(gpu, options = {})`: 文字 HUD 全体の状態を作る
- `setColor(r, g, b)`: 既定の文字色を設定する
- `normalizeColor(color = this.color)`: 色配列を描画向けに整える
- `resolvePosition(options = {})`: 表示位置を解決する
- `formatLines(lines, options = {})`: 行配列を表示用に整形する
- `alignLines(lines, options = {})`: 左寄せ / 中央 / 右寄せを整える
- `setLine(id, text, options = {})`: 1 行分のメッセージを登録する
- `setBlock(id, lines, options = {})`: 複数行ブロックを登録する
- `replaceAll(entries = [])`: 登録済み message を全置換する
- `remove(id)`: 指定 id の message を削除する
- `clear()`: 全 message を消す
- `setMessage(n, x, y, text)`: 旧形式の message を設定する
- `writeMessage(x, y, text)`: 指定位置へ message を書く
- `delMessage(n)`: 旧形式の message を削除する
- `clearMessages()`: message 群を消去する
- `listMessages()`: 登録済み message を一覧化する
- `getResolvedLines()`: 現在の表示内容を行配列で返す
- `drawScreen()`: HUD として描画する

### `Dialogue` / `DialogueOverlay`
`Dialogue` は、会話、チュートリアル本文、選択肢を UTF-8 のまま扱うための DOM overlay helper です。

import path は `webg/DialogueOverlay.js` です。default export の class 名は `Dialogue` ですが、役割としては `DialogueOverlay` と呼んで読むと実装と文書を対応づけやすくなります。

`Message` の上位版ではなく、canvas 外の DOM を scene の上に重ねる独立した表示経路です。

`WebgApp.startDialogue()`、`nextDialogue()`、`chooseDialogue()` はこの class の高レベル facade です。

- `constructor(options = {})`: DOM overlay を使う会話 UI の器を作る
- `setTheme(theme = {})`: `UIPanel` 系 theme を会話 UI に反映する
- `setDockOffsetProvider(fn)`: debug dock と重ならないよう右余白計算を差し替える
- `setLayout(options = {})`: title、footer、theme、dock offset provider をまとめて更新する
- `ensureOverlay()`: overlay DOM を必要時に作成する
- `start(entries = [], options = {})`: entry 群を先頭から読み直して会話を開始する
- `restart()`: 直前に開始した会話を先頭からやり直す
- `clear()`: queue と表示を消して会話を閉じる
- `current()`: 現在表示中の entry を返す
- `isActive()`: 会話が表示中かつ entry を持つかを返す
- `enqueue(entries = [])`: 既存 queue の後ろへ追加 entry を積む
- `next()`: 次の entry へ進める
- `choose(index = 0)`: 選択肢を 1 つ選び、必要なら branch を queue に差し込む
- `getState()`: 現在の進行状態、index、lastChoice、visible 状態を返す
- `render()`: 現在 state を DOM に反映する

### HTML panel 系
`DebugDock`、`FixedFormatPanel`、`UIPanel`、`WebgUiTheme` は、HTML ベースの補助 UI を作る層です。

`UIPanel` は scene の上に重ねる操作 UI、`FixedFormatPanel` は長文とエラー、`DebugDock` は PC 向けの開発補助表示、と役割を分けて使います。

`samples/scene` の `UIPanel`、`samples/bloom` や `samples/dof` の debug dock、`unittest/theme` の比較が代表例です。

- `DebugDock`: PC で controls、diagnostics、probe 状態を canvas 外から読むための固定 dock です。`constructor()` で dock DOM と action を準備し、`setRows()` で内容を差し替え、`clearRows()` で空にし、`setTheme()` で色を更新し、`isActive()` で表示条件を判定し、`ensure()` で DOM を作成し、`syncVisibility()` で開閉し、`update()` で本文を反映し、`formatText()` で表示文字列を整えます
- `FixedFormatPanel`: 長文やエラーを `<pre>` 形式で固定表示する panel manager です。`constructor()` で管理表を作り、`setTheme()` で既定色を差し替え、`applyPanelStyle()` で共通 style を当て、`showText()` で指定 id のパネルを表示し、`clear()` で 1 枚を消し、`clearAll()` で全消去します
- `UIPanel`: scene の上に重ねる button / hint / status panel を組む DOM helper です。`constructor()` で共通 style を挿入し、`setTheme()` で色を差し替え、`createLayout()` で左右 2 列の DOM root を作り、`createPanel()` で panel を作り、`createGroup()` で縦並び group を作り、`createEyebrow()`、`createTitle()`、`createCopy()`、`createHint()` で各種 text ブロックを作り、`createButtonGrid()` や `createButton()` でボタン群を組み、`createTextBlock()`、`createPill()`、`createStatusBlock()` で用途別ブロックを作り、`setDockOffset()` で debug dock と干渉しない余白を調整し、`setButtonActive()` で活性状態を切り替え、`syncResponsiveLayout()` で画面幅に応じた列配置へ寄せ、`applyThemeToLayout()` で theme を DOM に反映します
- `WebgUiTheme`: HTML UI 一式の色、余白、border、shadow を group 単位で差し替える theme helper です。`DEFAULT_UI_THEME`、`DEFAULT_UI_LIGHT_THEME`、`DEFAULT_UI_SUNSET_THEME`、`DEFAULT_UI_FOREST_THEME` が既定 preset、`UI_THEME_PRESETS` が名前付きのまとめ、`mergeUiTheme()` が部分上書きの結合入口です

## 5. モデル / シーンの読み込み

ここは `webg` のいちばん実務的な層です。`ModelAsset` が 1 モデル単位、`SceneAsset` が 1 シーン単位の共通表現で、`ModelLoader` と `SceneLoader` がそのビルドをまとめます。

### `Gltf`
`Gltf` は glTF / GLB のローレベル読み込み器です。bufferView、accessor、binary chunk 展開を担当します。

- `constructor()`: glTF 解析用の state を初期化する
- `load(url, options = {})`: glTF / GLB をまとめて読み込む
- `loadGltf(url, onStage = null)`: JSON 形式の glTF を読む
- `loadGlb(url, onStage = null)`: binary 形式の GLB を読む
- `loadBuffersFromGltf(alreadyHasBinary = false, onStage = null)`: buffer 群を展開する
- `fetchBuffer(bufferDef)`: 指定 buffer を取得する
- `getAccessor(accessorIndex)`: accessor 定義を返す
- `getBufferView(viewIndex)`: bufferView 定義を返す
- `getAccessorData(accessorIndex)`: accessor の生データを返す
- `readComponent(dataView, offset, componentType)`: componentType に応じて 1 要素を読む
- `getNumComponents(type)`: accessor type から component 数を返す
- `getTypedArrayConstructor(componentType)`: componentType に対応する TypedArray を返す

### `GltfShape`
`GltfShape` は glTF から `ModelAsset` とランタイム shapes を作るインポーターです。

`samples/gltf_loader` が直接見るのはこの層の結果です。

- `constructor(gpu)`: glTF の geometry と node を組み立てるための state を作る
- `getSceneNodes()`: scene に含まれる node 群を返す
- `buildNodeTransforms({ normalizeOrigin = true } = {})`: node の local matrix 群を作る
- `findOriginAnchorNode()`: 原点基準に使う node を探す
- `getSkinRootNodeIndex(skin)`: skin の root node index を返す
- `getNodeLocalMatrix(node)`: node の local matrix を返す
- `buildParents()`: 親子 index の対応表を作る
- `buildWorldTransforms(localMatrices, parents = this.buildParents())`: world matrix 群を作る
- `collectAnimatedNodeIndices()`: animation 対象 node を集める
- `getUniformScaleFromMatrix(matrix, epsilon = 1.0e-4)`: 行列から uniform scale を推定する
- `removeUniformScale(matrix, scale)`: 行列から scale 成分を外す
- `makeUniformScaleMatrix(scale)`: uniform scale 行列を作る
- `buildStaticBakePlans(skinPlans = new Map())`: 静的 bake の計画を作る
- `bakeGeometryByMatrix(geometry, matrix, normalMatrix = matrix)`: geometry を matrix で bake する
- `makeShapes({ includeSkins = true } = {})`: ランタイム用 shape 群を作る
- `toModelAsset({ includeSkins = true } = {})`: `ModelAsset` へ変換する
- `getModelAsset(options = {})`: 変換結果の `ModelAsset` を返す
- `buildMaterials()`: material 定義を作る
- `buildMeshDefs({ includeSkins = true, materials = [], skinPlans = new Map(), bakePlans = new Map() } = {})`: mesh 定義を作る
- `buildSkeletonDefs(skinPlans = new Map(), bakePlans = new Map())`: skeleton 定義を作る
- `buildAnimationDefs(skeletons, skinPlans = new Map(), bakePlans = new Map())`: animation 定義を作る
- `buildNodeDefs(meshes, skeletons, animations, bakePlans = new Map())`: node 定義を作る

### `Collada`
`Collada` は XML parser です。`parse(text, verbose, output)` を入口に、mesh、frame、animation を読み出します。

- `constructor()`: Collada XML 解析用の state を作る
- `printf(fmt, ...arg)`: 解析ログを出す
- `getMeshes()`: 読み込んだ mesh 群を返す
- `getMeshCount()`: mesh 数を返す
- `releaseMeshes()`: mesh 群を解放する
- `getMaterialColor(materialId)`: material の色を返す
- `getMaterialParams(materialId)`: material の追加 param を返す
- `setRegExp()`: 解析に使う正規表現群を準備する
- `parseText(string_to_parse)`: 文字列を parser へ流し込む
- `parseArgs(string_to_parse)`: タグ引数を分解する
- `getNextTag()`: 次の XML tag を読む
- `skip(tag)`: 指定 tag を読み飛ばす
- `skipToClosingTag(element)`: 対応する閉じ tag まで進める
- `asset(tag)`: asset block を読む
- `library_cameras(tag)`: camera 定義を読む
- `library_lights(tag)`: light 定義を読む
- `library_images(tag)`: image 定義を読む
- `library_effects(tag)`: effect 定義を読む
- `library_materials(tag)`: material 定義を読む
- `source()`: source 配列を読む
- `geo_mesh(id)`: geometry mesh を読む
- `library_geometries(tag)`: geometry 群を読む
- `controller_skin(source_name)`: skin controller を読む
- `library_controllers(tag)`: controller 群を読む
- `node(tag, parent_frame)`: scene node を読む
- `library_visual_scenes(tag)`: visual scene 群を読む
- `checkAnimationType(id)`: animation type を判定する
- `parseAnimationTargetName(target, fallback_name)`: animation target 名を整える
- `animation(tag, parent)`: animation block を読む
- `library_animations(tag)`: animation 群を読む
- `scene(tag)`: scene block を読む
- `getAnimation()`: 解析済み animation を返す
- `parse(text, verbose, output)`: Collada 全体を解析する

### `ColladaShape`
`ColladaShape` は Collada から `ModelAsset` への正規化と shape 生成をまとめるインポーターです。

- `shapeToMeshDef(shape, meshIndex)`: shape から mesh 定義を作る
- `skeletonToDef(skeleton, meshIndex, bindShapeMatrix)`: skeleton 定義を作る
- `animationToDef(anim, meshIndex, skeletonId)`: animation 定義を作る
- `cloneAnimationSource(anim)`: animation source を複製する
- `resolveAnimationBoneName(rawBoneName, skeleton)`: bone 名を skeleton に合わせて解決する
- `normalizeAnimationForSkeleton(anim, skeleton)`: skeleton に合うよう animation を整える
- `createRuntimeAnimation(animSource)`: ランタイム用 animation を作る
- `animationMatchesSkeleton(anim, skeleton)`: animation と skeleton の対応を判定する
- `getModelOriginPolicy(hasSkeleton)`: 原点扱いの方針を返す
- `getGeometryOriginOffset(mesh, hasSkeleton)`: geometry の原点オフセットを返す
- `getGeometryNodeMatrix(mesh, hasSkeleton)`: geometry 変換行列を返す
- `toModelAsset(bone_enable, tex_select)`: Collada を `ModelAsset` 化する
- `setBones(mesh, shape, verts, newindex)`: bone 情報を shape へ流し込む
- `setShape(nmesh, bone_enable, texture_select)`: 1 mesh 分の shape を作る
- `makeShapes(bone_enable, tex_select)`: shape 群をまとめて作る

### `ModelLoader`
`ModelLoader` は glTF、Collada、ModelAsset JSON の差を吸収する高レベルローダーです。`WebgApp.loadModel()` の中身でもあります。

- `constructor(target = {})`: loader の対象環境を保持する
- `detectFormat(source, options = {})`: 入力形式を判定する
- `loadJSON(source)`: ModelAsset JSON を読む
- `loadGltf(source, options = {}, onStage = null)`: glTF / GLB を読む
- `loadCollada(source, options = {}, onStage = null)`: Collada を読む
- `loadAsset(source, options = {})`: 既存アセットを読む
- `load(source, options = {})`: 形式を吸収して 1 本の loader として実行する

`load(source, options)` は `fetch -> validate -> build -> apply-runtime-materials -> instantiate -> runtime` の流れで進み、戻り値に `asset`, `runtime`, `instantiated`, `getClipNames()`, `getClipInfo(id)`, `instantiate()`, `downloadJSON()` を持ちます。

### `ModelAsset`
`ModelAsset` は 1 モデル分の JSON 互換データを束ねる入口です。`ModelLoader` や `samples/json_loader` の中心です。

ビルド前に mesh / skeleton / animation をまとめて調整したいときは、この層で処理するのが自然です。特に現行の `Node` は local scale を継続保持する用途に向いていないため、skinned glb を倍率変更したい場合は `ModelAsset.scaleUniform(scale)` で data 側へ uniform scale を焼き込んでからビルドするほうが安全です。

- `constructor(data = null)`: model asset の保持体を作る
- `fromData(data)`: data から asset を作る
- `fromJSON(text)`: JSON 文字列から asset を作る
- `load(url)`: URL から asset を読む
- `setData(data)`: 内部 data を差し替える
- `getData()`: 内部 data を返す
- `scaleUniform(scale)`: mesh / node / skeleton / animation の translation をまとめて uniform scale する
- `getClip(id)`: 指定 clip を返す
- `getClips()`: 全 clip を返す
- `getClipNames()`: clip 名一覧を返す
- `getClipInfo(id)`: clip の詳細を返す
- `toJSONText(indent = 2)`: JSON 文字列へ書き出す
- `downloadJSON(filename = "modelasset.json", indent = 2)`: JSON をファイル保存する
- `validate()`: validator で内容確認する
- `assertValid()`: 有効でなければ例外にする
- `build(gpu)`: ランタイム用のビルドを行う

```js
const loader = new ModelLoader(app);
const loaded = await loader.loadAsset("./hero.glb", {
  format: "gltf",
  gltf: {
    includeSkins: true
  }
});

const asset = ModelAsset.fromData(
  loaded.asset.cloneJSONValue(loaded.asset.getData())
).scaleUniform(2.0);

asset.assertValid();
const runtime = asset.build(app.getGL());
runtime.instantiate(app.space);
```

`scaleUniform(scale)` は破壊的に data を更新して `this` を返します。元 asset も残したいときは、この例のように `fromData(asset.cloneJSONValue(asset.getData()))` で clone を作ってから使います。skinned mesh では geometry だけでなく joint と pose の translation も同時に伸ばすため、見た目サイズとボーン変形がずれにくくなります。

### `ModelValidator`
`ModelValidator` は `ModelAsset` の参照整合と配列長を確認します。`validate(asset)` が基本入口です。

- `constructor()`: 検証結果を保持する器を作る
- `validate(asset)`: `ModelAsset` 全体を検証する
- `result()`: 直近の検証結果を返す
- `assertValid(asset)`: 無効なら例外にする

内部の確認対象は、`geometry`、`skin`、`skeleton`、`animation`、`node` です。

`errors` はビルドを止める不整合、`warnings` はビルドを止めない注意点として扱われます。

### `ModelBuilder`
`ModelBuilder` は `ModelAsset` からランタイムの `Shape`、`Skeleton`、`Animation`、`Node` を組み立てます。

- `constructor(gpu)`: build に使う GPU state を保持する
- `emitStage(handler, stage)`: build stage を通知する
- `matrixFromArray(values)`: 数値配列から matrix を作る
- `matrixFromTransform(transform = {})`: transform 定義から matrix を作る
- `createBaseShape(mesh, material)`: mesh と material から base shape を作る
- `computeNormals(shape)`: shape の normal を補う
- `buildSkeleton(skeletonDef)`: skeleton 定義からランタイム skeleton を作る
- `applySkin(shape, skin)`: skin 情報を shape へ適用する
- `buildAnimations(asset, skeletonId, skeleton, skeletonDef = null)`: animation 群を組み立てる
- `buildNodeShape(mesh, material, skeletonDef, options = {})`: node 用 shape を組み立てる
- `build(asset)`: asset 全体からランタイムをビルドする

`build(asset)` の戻り値には、`materialDefs`、`meshDefs`、`skeletonDefs`、`animationMap`、`nodes`、`nodeMap`、`shapes`、`createNodeTree(space)`、`bindAnimationBindings()`、`instantiate(space, options)`、および animation helper が入ります。

### `SceneAsset`
`SceneAsset` は Scene JSON の保存、検証、ビルドの入口です。`samples/scene` が直接使います。

- `constructor(data = null)`: scene asset の保持体を作る
- `fromData(data)`: data から asset を作る
- `fromJSON(text)`: JSON 文字列から asset を作る
- `load(url)`: URL から scene を読む
- `setData(data)`: 内部 data を差し替える
- `getData()`: 内部 data を返す
- `toJSONText(indent = 2)`: JSON 文字列へ書き出す
- `downloadJSON(filename = "scene.json", indent = 2)`: JSON をファイル保存する
- `validate()`: scene validator で確認する
- `assertValid()`: 無効なら例外にする
- `build(target)`: 実行環境へ scene をビルドする

### `SceneValidator`
`SceneValidator` は Scene JSON の構造と参照を確認します。

- `constructor()`: scene の検証結果を保持する器を作る
- `validate(scene)`: Scene JSON の構造を検証する
- `assertValid(scene)`: 無効なら例外にする

確認対象は `camera`、`hud`、`input`、`primitives`、`models` です。

`type` と `version` は現在の実装では推奨の identity tag として扱います。

### `SceneLoader`
`SceneLoader` は Scene JSON を `WebgApp` / `{ gpu, space }` 上の実体へ変換します。

- `constructor(target = {})`: scene build の対象環境を保持する
- `matrixFromTransform(transform = {})`: transform から matrix を作る
- `normalizeHudLines(lines = [], fallbackX = 0, fallbackY = 0, fallbackColor = [0.90, 0.95, 1.0])`: HUD 行を整える
- `applyHud(scene)`: scene の HUD 設定を反映する
- `applyCamera(scene)`: scene の camera 設定を反映する
- `createPlacementNode(entry, defaultName)`: placement 用 node を作る
- `applyMaterialOverride(shape, material = {})`: shape へ material 上書きを反映する
- `buildPrimitiveAsset(entry)`: primitive entry をアセット化する
- `resolveModelAsset(entry)`: model entry からアセットを解決する
- `attachRootsToPlacement(runtime, createdNodeMap, placementNode)`: ランタイム root を placement node へ接続する
- `applyShapeOverrides(shapes, entry)`: shape へ entry 側の上書きを適用する
- `buildEntryRuntime(entry, asset)`: 1 entry 分のランタイムを組み立てる
- `createInputMap(scene)`: scene の input map を作る
- `build(scene)`: Scene JSON 全体をランタイムに変換する

`build(scene)` の戻り値は `entries`、`inputMap`、`scene`、`update()`、`createInputHandler(actionHandlers)`、`getEntry(id)` を持ちます。

## 6. アニメーション / アクション / ステート / カメラリグ

この層は、読み込んだアセットをどう再生し、どう切り替え、どう視点を動かすかを扱います。

`12_アニメーション.md` と `10_モデルアセットとランタイム.md` を読んだあとでここを見ると、クリップ、パターン、アクション、ステートの関係が追いやすくなります。

### `Animation`
- `constructor(name)`: 1 本の animation を表す器を作る
- `setTimes(times)`: key 時間列を設定する
- `setBonePoses(bone_poses)`: bone pose 列を設定する
- `addBoneName(bone_name)`: bone 名を追加する
- `getBoneName(i)`: 指定 index の bone 名を返す
- `getName()`: animation 名を返す
- `getKeyCount()`: key 数を返す
- `getKeyTime(key)`: 指定 key の時間を返す
- `isValidKey(key)`: 指定 key が有効かを返す
- `isValidKeyRange(from, to)`: key 範囲が有効かを返す
- `getDurationMs()`: 全体の再生時間を返す
- `getClipInfo()`: clip 情報を返す
- `setData(skeleton, bind_shape_matrix)`: skeleton と bind 形状を結び付ける
- `transitionTo(time, keyFrom, keyTo)`: 指定区間を遷移用に整える
- `start()`: 先頭から再生を始める
- `play()`: 1 フレーム分進める
- `playFps(frame_per_sec)`: fps 基準で進める
- `startFromTo(keyFrom, keyTo)`: 指定 key 区間から始める
- `startTimeFromTo(time, keyFrom, keyTo)`: 時間指定で区間再生を始める
- `list(print_matrix)`: 内容を一覧表示する

### `Action`
`Action` は 1 本の `Animation` の内部区間をパターンとして再利用し、それをアクション名で束ねます。

- `constructor(anim, options = {})`: animation を束ねるアクション層を作る
- `addPattern(def)`: パターン定義を追加する
- `addKeyPattern(name, time, from, to)`: key 区間からパターンを作る
- `getPattern(id = null)`: パターンを返す
- `getPatternInfo(id = null)`: パターンの詳細を返す
- `getPatterns()`: パターン一覧を返す
- `removePattern(id)`: パターンを削除する
- `clearPatterns()`: パターンを全消去する
- `addActionDef(def)`: アクション定義を追加する
- `addAction(name, pattern_list)`: パターン群からアクションを作る
- `getAction(id)`: アクションを返す
- `getActions()`: アクション一覧を返す
- `removeAction(id)`: アクションを削除する
- `clearActions()`: アクションを全消去する
- `setVerbose(true_or_false)`: 追跡ログの量を切り替える
- `getCurrentAction()`: 現在のアクションを返す
- `getActionInfo()`: 現在のアクション情報を返す
- `getCurrentPattern()`: 現在のパターンを返す
- `getCurrentPatternIndex()`: 現在のパターン index を返す
- `isPlaying()`: 再生中かを返す
- `startPattern(patternId, options = {})`: 指定パターンを再生する
- `transitionToKey(entryDurationMs, fromKey, toKey)`: key 間の遷移を始める
- `start(actionId, options = {})`: 指定アクションを再生する
- `startAction(action_name)`: アクション名で再生する
- `play(_deltaMs = null)`: 1 ステップ進める
- `playAction()`: 現在アクションを進める
- `stop()`: 再生を止める
- `pause()`: 一時停止する
- `resume()`: 再開する
- `startTimeFromTo(pat)`: パターンの時間範囲で始める

### `AnimationState`
`AnimationState` は、`Action` または `Animation` をステートマシンで切り替える最小層です。

- `constructor(controller, options = {})`: ステートマシンのコントローラーを作る
- `addState(def)`: ステート定義を追加する
- `getState(id)`: ステートを返す
- `setVariables(object)`: 評価用変数群を設定する
- `setVariable(name, value)`: 1 変数だけ設定する
- `playStateTarget(state, context, options = {})`: ステートに応じたターゲットを再生する
- `setState(id, options = {})`: 現在ステートを切り替える
- `resolveTransition(context, nowMs)`: 遷移先を解決する
- `update(context = {}, deltaMs = null)`: 1 フレーム分ステートマシンを進める
- `getCurrentState()`: 現在ステートを返す
- `getCurrentTransition()`: 現在 transition を返す
- `getDebugInfo()`: デバッグ用の状態情報を返す

### `EyeRig`
`EyeRig` は `base -> rod -> eye` の 3 段視点ヘルパーです。`../discontinued/demo1`、`samples/scene`、`samples/raycast`、`samples/animation_state` などでよく使います。

`attachPointer()` を使うと、mouse / pen / touch の pointer event を同じ経路で扱えます。orbit / follow では 1 本指 drag で回転、2 本指 drag で平行移動、pinch で zoom ができ、first-person では 1 本指 drag を視線回転として使います。pan / pinch の係数は `constructor()` の `orbit.dragPanSpeed`、`orbit.pinchZoomSpeed`、`follow.dragPanSpeed`、`follow.pinchZoomSpeed` で調整できます。

- `constructor(baseNode, rodNode, eyeNode, options = {})`: 3 段構成のカメラリグを作る
- `fromNodes(baseNode, eyeNode, options = {})`: 既存 node からリグを組む
- `setType(type)`: リグの操作タイプを設定する
- `setInput(inputController)`: 入力コントローラーを設定する
- `setElement(element)`: pointer を受ける element を設定する
- `setTarget(x, y, z)`: 視線の目標位置を設定する
- `setPosition(x, y, z)`: リグ全体の位置を設定する
- `setTargetNode(targetNode)`: 追従対象 node を設定する
- `setTargetOffset(x, y, z)`: 追従対象からのずれを設定する
- `setDistance(distance)`: eye までの距離を設定する
- `setAngles(head, pitch, bank = 0.0)`: 向き角を設定する
- `setLookAngles(head, pitch, bank = 0.0)`: 視線角を設定する
- `setEyeHeight(height)`: 視点高さを設定する
- `setRodLength(length)`: 支点から eye までの長さを設定する
- `syncTarget(force = false, deltaSec = 0.0)`: target を現在の状態へ同期する
- `apply(force = false)`: node へ計算結果を反映する
- `update(deltaSec)`: 1 フレーム分リグを更新する
- `attachPointer(element = this.element)`: pointer handler を element に付ける
- `detachPointer()`: pointer handler を外す
- `cancelDrag()`: drag 状態を中断する
- `onPointerDown(ev)`: pointer down を処理する
- `onPointerMove(ev)`: pointer move を処理する
- `onPointerUp(ev)`: pointer up を処理する
- `onWheel(ev)`: wheel を処理する
- `destroy()`: event handler を外して破棄する

## 7. 診断情報 / デバッグ / アプリ

この層は、ランタイムの状態をテキスト / JSON / panel に出すためのものです。

`samples/scene`、`samples/bloom`、`samples/dof`、`samples/sound` などで、調査フローをサンプルの中に閉じ込めるために使います。

### `Diagnostics`
`Diagnostics` はレポートオブジェクトの生成、整形、保存、clipboard へのコピーを担当します。

- `resolveSystem(init = {})`: system 名や stage を整えてレポート用の初期値を作る
- `createReport(init = {})`: 空のレポートを作る
- `createSuccessReport(init = {})`: 成功扱いのレポートを作る
- `createErrorReport(error, init = {})`: 失敗扱いのレポートを作る
- `addDetail(report, line)`: detail 行を追加する
- `addWarning(report, line)`: warning 行を追加する
- `setStat(report, key, value)`: 統計値を 1 件設定する
- `mergeStats(report, stats = {})`: 統計値群をまとめて反映する
- `toText(report, options = {})`: テキストレポートへ整形する
- `toJSON(report, space = 2)`: JSON レポートへ整形する
- `copyText(report, options = {})`: テキストレポートを clipboard へ送る
- `copyJSON(report, space = 2)`: JSON レポートを clipboard へ送る
- `copyString(text)`: 任意文字列を clipboard へ送る
- `downloadText(report, filename = "diagnostics.txt", options = {})`: テキストレポートを保存する
- `downloadJSON(report, filename = "diagnostics.json", space = 2)`: JSON レポートを保存する
- `downloadString(text, filename, mimeType)`: 任意文字列をダウンロードする

### `DebugConfig`
`DebugConfig` はデバッグ / リリースの切り替えとフラグ管理を担当します。

- `createFlags(mode)`: mode から既定フラグ群を作る
- `setMode(mode = "debug")`: デバッグ / リリースを切り替える
- `configure(flags = {})`: 個別フラグを上書きする
- `isDebug()`: デバッグモードかを返す
- `isRelease()`: リリースモードかを返す
- `isEnabled(key)`: 指定フラグが有効かを返す

### `DebugProbe`
`DebugProbe` は、1 フレーム後に 1 回だけ状態を採取するためのヘルパーです。

- `constructor(options = {})`: probe の待ち行列を作る
- `request(options = {})`: 1 回分の probe を予約する
- `update(frameCount)`: frameCount を見て probe を実行する
- `hasPending()`: 予約中の probe があるかを返す
- `getPendingCount()`: 予約数を返す
- `getLastResult()`: 直近結果を返す
- `clear()`: 予約と結果を消す

### `WebgApp`
`WebgApp` は、`Screen`、`Shader`、`Space`、`Input`、`Message`、デバッグ補助、loadModel/loadScene をまとめる高レベル入口です。

サンプルの多くは `WebgApp` を使うことで、初期化の重複を減らしています。

役割は「3D アプリの土台を最短で作ること」で、`Screen`、projection、カメラリグ、HUD、input、診断情報、ローダー、dialogue、progress 保存までを 1 か所へ集約します。

最小サンプルなら `init()` と `start()` だけでも動きますし、必要に応じてローダー、debug dock、dialogue、probe を少しずつ足していけます。

`WebgApp` を使うサンプルでは、リリースモードで起動していても `F9` のあとに `m` を押すとデバッグモードへ切り替えられます。`keyInput.enabled` を false にしているサンプルでも、mode toggle だけは標準で残るため、「通常表示で動作確認してから必要な時だけデバッグに入る」流れを共通で使えます。

注意点として、このショートカットは `WebgApp` の入力処理に乗っている場合だけに有効です。サンプル側が raw `InputController` を直接使って keyboard を処理している構成では、自動では有効になりません。その場合はサンプル側で同等の mode 切替を実装してください。

#### 起動 / 構成
- `constructor(options = {})`: `Screen`、`Space`、`Message`、デバッグ補助をまとめる。`fixedCanvasSize: { width, height, useDevicePixelRatio }` を渡すと固定 canvas サイズで起動し、`layoutMode: "embedded"` を渡すと canvas と DOM overlay を文書フロー内へ埋め込める
- `getGL()`: 現在の GPU context を返す
- `setUiTheme(theme = {})`: HTML UI テーマを差し替える
- `attachInput(handlers = {})`: keyboard / pointer 入力を接続する。`WebgApp` の debug key 処理もこの経路で有効になる
- `configureDebugKeyInput(options = {})`: debug key 配列を設定する。`keyInput.enabled` が false でも `F9` → `m` の mode toggle は標準で残る
- `createCameraRig()`: 標準カメラリグを作る
- `applyViewportLayout()`: canvas と HUD のレイアウトを反映する。`fixedCanvasSize` がある場合は固定サイズを優先し、`layoutMode: "embedded"` では overlay を canvas host 基準へそろえる
- `checkEnvironment(options = {})`: 実行環境の診断レポートを作る
- `updateProjection(viewAngle = this.viewAngle)`: projection matrix を更新する
- `setLoopHandlers(handlers = {})`: 毎フレーム呼ぶ handler を設定する
- `start(handlers = {})`: main loop を開始する
- `stop()`: main loop を止める
- `frame(timeMs)`: 1 フレーム分の処理を進める
- `getFrameContext(timeMs)`: frame 用の context 情報を返す
- `formatScreenshotTimestamp(date = new Date())`: screenshot 用 timestamp 文字列を作る
- `resolveScreenshotFilename(options = {})`: screenshot 保存名を解決する
- `takeScreenshot(options = {})`: 次の present 後に PNG 保存を予約する

#### Scene / model / camera
- `validateScene(scene)`: Scene JSON を検証する
- `loadModel(source, options = {})`: Model loader の高レベル入口としてモデルを読む
- `loadScene(scene)`: Scene loader の高レベル入口としてシーンを読む
- `setEyeLight(positionAndType = this.lightPosition)`: eye space 基準の light を設定する
- `setWorldLight(options = {})`: world node 基準の light を設定する
- `applyLightConfig()`: light 設定を shader 側へ反映する
- `setFog(options = {})`: fog 設定を更新する
- `getShapeSize(shapes)`: shape 群のサイズ情報を返す

#### HUD / guide / status / panels
- `setGuideLines(lines, options = {})`: guide 行を設定する
- `setStatusLines(lines, options = {})`: status 行を設定する
- `clearStatusLines()`: status 行を消す
- `setHudRows(rows = [], options = {})`: HUD 行群を設定する
- `clearHudRows()`: HUD 行群を消す
- `setControlRows(rows = [], options = {})`: control 表示行を設定する
- `clearControlRows()`: control 行を消す
- `makeTextControlRows(lines = [])`: text 形式の control 行を作る
- `setHudLayoutOffsets(options = {})`: HUD の段差と余白を調整する
- `setDebugDockRows(rows = [])`: debug dock 用の行を設定する
- `clearDebugDockRows()`: debug dock 行を消す
- `setDebugGuideLines(lines, options = {})`: デバッグ用 guide 行を設定する
- `applyDebugGuideLines()`: debug guide を反映する
- `showFixedFormatPanel(text, options = {})`: `FixedFormatPanel` に text を出す
- `clearFixedFormatPanel(panelId = "default")`: `FixedFormatPanel` を 1 枚消す
- `clearAllFixedFormatPanels()`: `FixedFormatPanel` を全消去する
- `showErrorPanel(error, options = {})`: エラー用 panel を出す
- `drawMessages()`: canvas HUD の message 群を描画する
- `isDebugDockActive()`: debug dock を出す条件を返す
- `syncDebugDockVisibility()`: debug dock の表示状態を合わせる
- `getDebugKeyPrefixLabel()`: debug key prefix の表示文字を返す
- `getDebugKeyGuideLines()`: debug key の説明行を返す
- `handleDebugKeyInput(key, ev)`: debug key 入力を処理する
- `resolveDebugKeyAction(key)`: key から action 名を解決する
- `runDebugKeyAction(action)`: アクションを実行する
- `updateDebugDock()`: debug dock の本文を更新する
- `formatDebugDockControls()`: debug dock 用 control 文を整形する
- `makeControlRowData(row = {})`: control row の表示用 data を作る
- `formatDebugDockControlRow(rowData = {}, maxPrefixWidth = 0)`: 1 行分の control 表示を整形する
- `formatDebugDockText()`: debug dock 全体の text を作る
- `formatHudRowsForCanvas()`: canvas HUD 用の行を整形する
- `buildHudRowLines(rowDataList = [], compact = false)`: HUD row を text 行へ変換する
- `getHudAvailableCols(scale = this.messageScale)`: 現在の HUD で使える列数を返す
- `createDialogue(options = {})`: `Dialogue` overlay を必要時に作る
- `startDialogue(entries = [], options = {})`: UTF-8 会話 / チュートリアルを開始する
- `nextDialogue()`: 現在の会話を次へ進める
- `chooseDialogue(index = 0)`: choice を 1 つ選ぶ
- `enqueueDialogue(entries = [])`: 既存の会話 queue の後ろへ追加する
- `clearDialogue()`: 会話 overlay を閉じる
- `getDialogueState()`: 会話の進行状態を返す

#### 診断情報 / probe
- `resetDiagnostics(stage = "init")`: 診断情報レポートを初期化する
- `setDiagnosticsStage(stage)`: stage 名を更新する
- `addDiagnosticsDetail(line)`: detail 行を追加する
- `addDiagnosticsWarning(line)`: warning 行を追加する
- `mergeDiagnosticsStats(stats = {})`: 統計値を取り込む
- `setDiagnosticsReport(report)`: レポートを差し替える
- `getDiagnosticsReport()`: 現在のレポートを返す
- `createProbeReport(stage = "runtime-probe")`: probe 用レポートを作る
- `toggleDebugMode()`: デバッグ / リリースの表示を切り替える
- `getDebugMode()`: 現在のデバッグモードを返す
- `isConsoleEnabled()`: console 出力が有効かを返す
- `isDebugUiEnabled()`: debug 用補助 UI の表示が有効かを返す
- `copyDiagnosticsSummary(options = {})`: diagnostics summary を clipboard へ送る
- `copyDiagnosticsReportJSON(options = {})`: diagnostics report JSON を clipboard へ送る
- `formatDiagnosticsSummary(report = null, options = {})`: summary text を作る
- `formatDiagnosticsJSON(report = null, space = 2)`: JSON レポートを作る
- `captureDiagnosticsSnapshot(options = {})`: summary / JSON の 1 回採取を予約する
- `captureDiagnosticsSummary(options = {})`: summary snapshot の標準入口
- `captureDiagnosticsReportJSON(options = {})`: report JSON snapshot の標準入口
- `updateDebugProbe()`: 予約済み probe を進める
- `getProbeStatusLine()`: probe 状態行を返す
- `getDiagnosticsStatusLine()`: 診断情報状態行を返す

#### 保存 / replay / 補助状態
- `saveProgress(key, data, options = {})`: アプリ名義の保存領域へ progress を保存する
- `loadProgress(key, defaultValue = null)`: progress を読み出す
- `clearProgress(key)`: 指定 key の progress を消す
- `recordInputFrame(meta = {})`: 現在 frame の input snapshot を記録する
- `replayInputFrame(frame, options = {})`: 記録済み frame を input state へ戻す
- `getInputLog()`: 記録済み input frame 群を返す
- `clearInputLog()`: input log を消す

`WebgApp.loadModel()` は `ModelLoader.load()`、`WebgApp.loadScene()` は `SceneLoader.build()` の高レベルFacadeです。

`samples/json_loader`、`samples/gltf_loader`、`samples/collada_loader`、`samples/scene` は、このFacadeを使うことでフォーマットごとの差を外へ漏らしません。

### `EyeRig` と `WebgApp`
`WebgApp.createCameraRig()` は、標準カメラリグを作る入口です。

`EyeRig` は、`WebgApp` が使う視点ヘルパーの標準形を提供しますが、必要なら任意の node 階層へ差し替えられます。

## 8. オーディオ / パーティクル

音周りは、`AudioSynth` が基盤、`GameAudioSynth` がゲーム向けの便利層です。

`samples/sound` は、SE / BGM / delay / reverb / envelope / 診断情報を同じ画面で往復できる例です。

### `AudioSynth`

- `constructor()`: AudioContext を使う基底 synth を作る
- `ensureContext()`: AudioContext を確保する
- `buildFxChain()`: master / delay / reverb の FX chain を作る
- `resume()`: user gesture 後に audio context を再開する
- `setMasterVolume(v)`: 全体音量を設定する
- `setSeVolume(v)`: SE 音量を設定する
- `setBgmVolume(v)`: BGM 音量を設定する
- `setSeDelay(timeSec = 0.11, feedback = 0.26, wet = 0.22)`: SE 用 delay を設定する
- `setBgmDelay(timeSec = 0.18, feedback = 0.22, wet = 0.18)`: BGM 用 delay を設定する
- `setSeReverb(send = 0.28, returnGain = 0.48)`: SE 用 reverb を設定する
- `setBgmReverb(send = 0.24, returnGain = 0.40)`: BGM 用 reverb を設定する
- `getImpulseKindList()`: 利用可能な impulse kind を返す
- `normalizeImpulseConfig(config = {}, fallback = {})`: impulse 設定を正規化する
- `updateConvolverImpulse(convolver, config)`: convolver の impulse を更新する
- `setSeReverbImpulse(config = {})`: SE 用 reverb impulse を設定する
- `setBgmReverbImpulse(config = {})`: BGM 用 reverb impulse を設定する
- `getSeReverbImpulseConfig()`: SE 用 reverb impulse 設定を返す
- `getBgmReverbImpulseConfig()`: BGM 用 reverb impulse 設定を返す
- `playTone(freq, dur = 0.12, options = {})`: 単音を鳴らす
- `playSe(name)`: SE 名で音を鳴らす
- `setBpm(bpm)`: BGM の BPM を設定する
- `setRootHz(hz)`: 基準周波数を設定する
- `getMelodyList()`: 登録済み melody 一覧を返す
- `setMelody(name)`: 現在の melody を切り替える
- `registerMelody(name, config)`: melody preset を登録する
- `startBgm()`: BGM 再生を開始する
- `stopBgm(fadeSec = 0.20)`: BGM をフェードしながら止める
- `scheduleBgm(lookAheadSec)`: 先読みで BGM スケジュールを進める
- `scheduleBgmStep(step, when)`: 1 ステップ分の BGM を予定する
- `getStepParam(arr, step, fallback)`: 配列から step 対応値を返す
- `shouldPlayRhythm(step, melody)`: 指定 step で音を鳴らすかを判定する
- `degreeToSemitone(scale, degree)`: scale 度数を半音へ変換する
- `maybeModulate()`: 必要なら key modulation する
- `playBgmVoice(freq, when, dur, type, gain)`: BGM の 1 voice を鳴らす
- `setSeEnvelopePreset(name, config)`: SE envelope preset を登録する
- `getSeEnvelopePreset(name)`: SE envelope preset を返す
- `getSeEnvelopePresetList()`: SE envelope preset 一覧を返す
- `setBgmEnvelope(config)`: BGM envelope を設定する
- `getBgmEnvelope()`: BGM envelope を返す
- `getImpulseProfile(kind = "room")`: 既定 impulse profile を返す
- `createImpulseResponse(ctx, durationSec = 1.5, decay = 2.5, options = {})`: impulse response を作る

### `GameAudioSynth`
`GameAudioSynth` は、ゲーム向けの melody preset と SE catalog を追加した上位層です。

- `constructor()`: ゲーム向け preset を持つ synth を作る
- `playGameTone(freq, dur = 0.12, profile = "soft", options = {})`: プロファイル付きで単音を鳴らす
- `installMelodyPresets()`: melody preset を登録する
- `installSePresets()`: SE preset を登録する
- `getSoundEffectList()`: 利用可能な SE 一覧を返す
- `getSoundEffectInfo(name)`: SE の詳細を返す
- `getGameSeList()`: ゲーム向け SE 一覧を返す
- `playSe(name)`: SE を再生する
- `playGameSe(name)`: ゲーム向け SE を再生する

### `ParticleEmitter`
`ParticleEmitter` は、短命な billboard particle をまとめて spawn / update / draw する軽量エフェクト層です。

- `constructor(options = {})`: emitter 名、最大 particle 数、preset、shadow、乱数 seed などを初期化する
- `static getPresetDefinition(name = "spark")`: 既定 preset 定義を名前から返す
- `getPreset()`: 現在の preset 内容を返す
- `setPreset(name = "spark", options = {})`: preset を切り替え、texture と既定 spawn 値を更新する
- `setRenderer({ billboard, shadowBillboard, texture } = {})`: 外部で作った renderer 一式を差し込む
- `init(gpu)`: Billboard と procedural texture を含む実 renderer を GPU 上に初期化する
- `rebuildTexture()`: 現在の preset に合わせて particle texture を再生成する
- `clear()`: 生存中 particle をすべて消す
- `getAliveCount()`: 現在生存している particle 数を返す
- `emit(options = {})`: 位置、速度、寿命、色、重力、drag、個数などを指定して particle を発生させる
- `update(deltaSec)`: 生存 particle の位置、速度、寿命、shadow を 1 フレーム分更新する
- `draw(eyeNode, projectionMatrix)`: 現在生存している particle を billboard として描画する

## 9. タッチ / 入力 / タイルマップ

`Touch` と `InputController` は、キーボードとタッチを同じ key state にまとめるための層です。

`unittest/touch`、`unittest/input_controller`、`samples/scene` の input mapping を読むときは、この層の小文字ルールを前提にすると分かりやすくなります。

### `Touch`
`Touch` は、キー入力の代わりに押す仮想ボタン群を画面下へ固定表示する class です。

用途は menu や会話 panel ではなく、`arrowleft`、`space`、`enter` のような key 名を hold / action として流し込むことです。

scene の上に card や status panel を重ねたいときは `UIPanel`、キー入力の代わりのボタンが欲しいときは `Touch`、と分けて考えると整理しやすくなります。

- `constructor(doc, options = {})`: touch UI を管理する器を作る
- `isCoarsePointer()`: coarse pointer 環境かを返す
- `isEnabled()`: touch UI が有効かを返す
- `injectDefaultStyle()`: 既定 CSS を注入する
- `create(options = {})`: 仮想ボタン群を作る
- `applyDensitySize()`: 表示密度に応じたサイズへ調整する
- `applyLayoutMode()`: レイアウトモードを切り替える
- `resetGroupInlineLayout(groupItems = null)`: group の inline 配置を初期化する
- `applyMultilineSpreadByRows(groupItems, groupGap, availableWidth)`: 複数行配置へ広げる
- `releaseAll()`: すべての押下状態を解除する
- `destroy()`: CSS と DOM を破棄する

`Touch.create()` は、hold と action を分けて扱います。

hold は `pointerdown` / `pointerup` で key state に流し込み、action は 1 回の押下イベントとして扱います。

### `InputController`
`InputController` は、keyboard、pointer、touch button を同じ key state へまとめる class です。

`normalizeKey()` により、`event.key` の揺れを小文字の比較名へ整え、サンプル側が入力元ごとの差を意識せず `"w"`、`"space"`、`"arrowleft"` のような名前で扱えるようにします。

`WebgApp.attachInput()` や `EyeRig` も最終的にはこの層の key 状態を使います。

- `constructor(doc)`: keyboard / pointer input を束ねる器を作る
- `normalizeKey(key)`: browser 差や touch 由来の key 名を小文字の比較名へ正規化する
- `clear()`: key state を全消去する
- `has(key)`: 指定 key が押されているかを返す
- `press(key)`: key を押下状態にする
- `release(key)`: key を離す
- `pulseAction(key)`: 1 フレームだけ有効なアクションを作る
- `installTouchControls(options = {})`: touch UI を key state に接続する
- `detach()`: event listener を外す
- `attach({ onKeyDown, onKeyUp, onPointerDown } = {})`: keyboard と pointer を受け付ける

`InputController.attach()` は keyboard の `keydown` / `keyup` と pointer input をまとめて扱います。

`installTouchControls()` は `Touch.create()` を使って仮想ボタンをそのまま key state に流し込みます。

keyboard と touch の両方を使うサンプルでは、比較名を `16_タッチ入力の設計.md` の一覧に合わせて `"space"`、`"escape"`、`"f9"` のようにそろえると実装と文書の両方が追いやすくなります。

### `TileMap` helper functions
`TileMap.js` には class 本体とは別に、盤面入力や edge cut 判定を補助する関数も export されています。

- `resolveCameraRelativeGridMove(yawDeg, key)`: camera の yaw を見て、`arrow` 入力を grid の `dx` / `dy` へ変換する
- `resolveEdgeCutMask(centerHeight, eastHeight, westHeight, northHeight, southHeight)`: 4 方向との高さ差から edge cut の bitmask を作る
- `describeEdgeCutMask(mask)`: edge cut の bitmask を `E+N` のような短い文字列表現へ変換する

### `TileMap`
`TileMap` は、盤面データ、表示形状、cell 配置、pick、移動判定、path 探索をまとめるクラスです。

- `constructor(options = {})`: 行数、列数、高さ、cell 寸法、terrain、displayArea などを受けて盤面を初期化する
- `clamp(value, min, max)`: 値を範囲内へ収める
- `terrainFromHeight(height)`: 高さから terrain id を決める
- `colorFromTerrain(terrain)`: terrain id から既定色を返す
- `resolveTerrainMaterial(terrain, key = "surface")`: terrain ごとの材質定義を返す
- `tintColor(color, ratio)`: 基本色へ明暗補正をかける
- `normalizeDimensions(options = {})`: 行数、列数、cell 寸法を正規化する
- `normalizeDisplayArea(displayArea = null)`: `displayArea` を現在の盤面寸法へ合わせて整える
- `generateTileDefinitions(options = {})`: `tiles` と `generator` から cell 定義群を作る
- `createCellSpec(col, row, tileDef = {})`: 1 cell 分の論理定義を作る
- `createCellMaterial(cell)`: cap 用の材質情報を作る
- `createCellFoundationMaterial(cell)`: foundation 用の材質情報を作る
- `applyCellMaterial(shape, material)`: 1 cell 用材質を shape に反映する
- `assignEdgeCutMasks()`: 近傍との高さ差から全 cell の edge cut mask を計算する
- `applySurfaceShapes(space, parentNode = null)`: 盤面形状を scene へ配置する
- `build(space, parentNode = null)`: TileMap 全体の shape / node / metadata をまとめて構築する
- `getCell(col, row)`: 指定座標の cell を返す
- `getTile(col, row)`: cell の tile 定義を返す
- `getTopY(col, row)`: 指定 cell 上面の Y 座標を返す
- `getWorldPosition(col, row, y = null)`: 指定 cell の world 座標を返す
- `getHeight(col, row)`: 指定 cell の高さ段数を返す
- `toWorld(col, row, offset = {})`: cell 座標を world 座標へ変換する
- `getEdgeCutMask(col, row)`: 指定 cell の edge cut mask を返す
- `getShapeKind(col, row)`: 指定 cell の形状種別を返す
- `isBlocked(col, row)`: その cell が通行不可かを返す
- `isInDisplayArea(col, row)`: 現在の表示窓に含まれるかを返す
- `setDisplayArea(area)`: 表示窓を更新する
- `getDisplayAreaCells()`: 現在表示中の cell 一覧を返す
- `followCell(col, row, options = {})`: 指定 cell が見えるよう表示窓を追従させる
- `getNodePositionOnCell(node, cellRef, options = {})`: node を置くべき座標を計算する
- `placeNodeOnCell(node, cellRef, options = {})`: node を指定 cell 上へ配置する
- `refreshTileColors()`: terrain / material 変更後に cell 色を更新する
- `pickCell(origin, dir)`: ray と盤面の交差から cell を選ぶ
- `canMove(fromRef, toRef, options = {})`: 2 cell 間を移動可能か判定する
- `findPath(startRef, goalRef, options = {})`: 盤面上の経路探索を行う
- `resolveCellRef(ref)`: `{ col, row }`、配列、オブジェクトなどから cell 参照を解決する

## 10. 内部補助 / 設定 / 使い分け

`Frame`、`Mesh`、`Schedule`、`Task`、`Stack` は、現在の public サンプルから直接触ることは少ないですが、インポーターやアニメーションの内部で重要です。

`util.js`、`formatJSON()`、`Tween`、`SkinningConfig` は、周辺処理を支える補助 API です。

API 文書を読むときは、まず public class を押さえ、そのあとに内部補助を確認すると理解しやすくなります。

### `util.js` / `formatJSON`
`util.js` は文字列整形、時間計測、同期 / 非同期 I/O の補助関数群です。`JsonFormat.js` の `formatJSON()` は、数値配列を読みやすく保ったまま JSON 文字列へ整形する関数です。

- `strDup(char, cnt)`: 文字を指定回数だけ複製する
- `format_D(num, flag, cnt)`: 整数を `%d` 風に整形する
- `format_F(num, flag, cnt, precision)`: 固定小数点を整形する
- `format_E(num, flag, cnt, precision, etype)`: 指数表記を整形する
- `format_S(str, flag, cnt)`: 文字列を整形する
- `format_X(num, flag, cnt, type)`: 16 進数を整形する
- `sprintf(fmt, ...arg)`: 軽量 `sprintf` として整形する
- `printf(fmt, ...arg)`: console か string へ出力する
- `now()`: 現在時刻を返す
- `sleep(sec)`: ビジーウェイトで待つ
- `readFile(filename)`: Node.js で同期読み込みする
- `writeFile(filename, data)`: Node.js で同期書き込みする
- `print()`: 空行を出力する
- `readUrlSync(filename)`: 既存互換の同期 URL 読み込みを行う
- `readUrl(filename)`: fetch ベースで非同期読み込みする
- `formatJSON(value, indent = 2)`: JSON 値を、行列や数値配列を潰しすぎずに整形して返す

### `Tween`
`Tween` は、数値、配列、色、ベクトルなどを時間で補間する汎用 tween helper です。

- `constructor(target = {}, to = {}, options = {})`: 補間対象、目標値、duration、easing、callback を設定する
- `captureStartValues()`: 開始時点の値を snapshot する
- `apply(progress = 0.0)`: 指定 progress の値を target へ反映する
- `update(deltaMs = 0)`: 経過時間を進めて補間を更新する
- `reset(options = {})`: 再生状態を初期値へ戻す
- `pause()`: 補間を一時停止する
- `resume()`: 一時停止した補間を再開する
- `isFinished()`: 補間完了済みかを返す

### `ShapeResource` / `ShapeInstance`
`ShapeResource` は共有可能な geometry と GPU buffer を持つ基底資源です。`ShapeInstance.js` は現状 `Shape` をそのまま export する互換入口です。

- `ShapeResource.constructor(gpu)`: 頂点配列、index buffer、wireframe、bounding box、skin 情報を保持する共有資源を初期化する
- `ShapeInstance`: `Shape` の別名 export。既存 import を壊さず `Shape` を参照したいときに使う

### `SkinningConfig`
`SkinningConfig.js` は、スキニング用 uniform buffer の既定値と補助関数をまとめます。

- `DEFAULT_MAX_SKIN_BONES`: 既定の最大 bone 数
- `SKIN_MATRIX_VECTORS_PER_BONE`: 1 bone を何個の `vec4` で送るかを表す定数
- `SKIN_MATRIX_FLOATS_PER_BONE`: 1 bone あたりの float 数
- `alignTo(value, alignment = 256)`: WebGPU の dynamic uniform offset 境界に合わせて値を切り上げる

### 典型的な読み順
1. `Screen` と `Shader`
2. `Shape` と `Space`
3. `ModelAsset` と `ModelLoader`
4. `SceneAsset` と `SceneLoader`
5. `WebgApp`
6. `Diagnostics` と `DebugProbe`
7. `AudioSynth` / `GameAudioSynth`
8. `Touch` / `InputController`
