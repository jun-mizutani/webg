# 付録C API一覧

この付録は、`webg` の公開APIをカテゴリごとに引くための一覧です。
前置きの説明は最小限にとどめ、クラス、関数、代表的メソッドを実装名に合わせて確認できる構成にしています。

対象は、アプリケーションから直接使うAPIと、v2の描画契約を理解するために参照する公開exportです。
`webg/`に存在する全ファイルを機械的に列挙するモジュール索引ではありません。
内部処理だけを分担する補助モジュールは、利用者が独立して接続する公開契約を持つ場合に掲載します。

## 1. 描画基盤

描画基盤は、`Screen` がキャンバスとWebGPUの初期化を、`RenderTarget` がオフスクリーンテクスチャを、`Shader` がパイプラインとユニフォームを、`FullscreenPass` 系がポストプロセスを担当します。

ここを先に押さえると、ブルーム、被写界深度（DOF）、ビネット、背景描画、ワイヤーフレーム、ビルボードのような上位機能が「何を土台にしているか」を追いやすくなります。

### `Screen`
`Screen` は `#canvas` を基準にWebGPUを開始し、リサイズ、クリア、プレゼント、スクリーンショット、レンダリングループの入口をまとめます。

- `constructor(document, options = {})`: `#canvas` を取得してWebGPU初期化の入口を作る。`options.gpu.requiredFeatures` と `options.gpu.optionalFeatures` でデバイス作成前のGPU機能要求を指定できる。未指定時は従来どおり機能なしで初期化する
- `getRequestedGPUFeatures()`: アダプター対応確認後、デバイスへ実際に要求した必須/任意機能名を返す
- `getUnavailableOptionalGPUFeatures()`: アダプターが対応せずデバイスへ要求しなかった任意機能名を返す
- `hasGPUFeature(feature)`: 初期化済みデバイスが指定機能を持つか確認する

- `resize(w, h)`: キャンバスと内部サイズを更新し、DPR反映後の描画サイズへ合わせる
- `getRecommendedFov(base = 55.0)`: 現在のアスペクト比に合う推奨縦FOVを返す
- `setClearColor(color)`: クリア時に使うRGBA色を設定する
- `getGPU()`: 内部のWebGPUコンテキストを返す
- `getFrameCount()`: `clear()` が何回呼ばれたかを返す
- `getAspect()`: 現在の width / height を返す
- `getWidth()`: 現在の描画幅を返す
- `getHeight()`: 現在の描画高さを返す
- `createRenderTarget(options = {})`: 同じGPU上にオフスクリーン `RenderTarget` を作る
- `resetFrameCount()`: フレームカウンタを 0に戻す
- `cullFace()`: 描画状態を直接変更しない予約メソッド
- `viewport()`: 描画状態を直接変更しない予約メソッド
- `clear(target = null)`: キャンバスまたは指定描画先のカラー / 深度をクリアする
- `clearDepthBuffer(target = null)`: カラーを保ち、カメラ用Reverse-Z深度をクリア値0で初期化した深度付きパスを再開する。表示後はHUD描画へ戻る切り替えにもなる
- `beginPass(options = {})`: 任意の描画先と読み込み / クリア条件でレンダリングパスを開始する
- `beginPresentPass(options = {})`: 完成テクスチャをキャンバスへ転送するため、深度アタッチメントを持たない表示パスを開始する
- `endPass()`: 現在のパスを終了する
- `submit()`: コマンドをGPUに送信する
- `present()`: 画面への反映を確定する
- `animation(loopFunc)`: `requestAnimationFrame` でループを開始する
- `update()`: 現在は追加処理を行わない予約メソッド
- `swapInterval(interval)`: 現在は追加処理を行わない予約メソッド
- `screenShot(filename)`: キャンバス内容をPNGとして保存する

### `RenderTarget`
`RenderTarget` はオフスクリーン描画先です。
`sampleDepth: true` を付けると、後段パスから深度を読む構成にできます。

- `constructor(gpu, options = {})`: オフスクリーンのカラー / 深度テクスチャとサンプラーを初期化する
- `resize(width, height)`: サイズ変更の場合だけテクスチャを作り直して `true` を返す。同じサイズではGPUリソースを維持して `false` を返す
- `resizeToScreen(screen)`: `Screen` の現在サイズに追従する
- `destroy()`: 内部テクスチャ群を破棄する
- `getWidth()`: 現在の幅を返す
- `getHeight()`: 現在の高さを返す
- `getFormat()`: カラーテクスチャの形式を返す
- `getTexture()`: カラーテクスチャ本体を返す
- `getView()`: カラービューを返す
- `getColorView()`: カラービューの別名として返す
- `getDepthView()`: 深度ビューを返す
- `getDepthTexture()`: 深度テクスチャ本体を返す
- `getDepthSampleView()`: シェーダーから読むための深度ビューを返す
- `isDepthSampled()`: 深度をサンプル可能かどうかを返す
- `getSampler()`: 全画面パス用サンプラーを返す

### `DepthConvention`

通常カメラは`CAMERA_REVERSE_Z`、シャドウマップは`SHADOW_STANDARD_Z`を使用します。
どちらも`depth32float`ですが、クリア値、比較関数、near/farの意味が異なります。

- `CAMERA_REVERSE_Z`: near=1、far/background=0、クリア=0、compare=`greater`、同値を許す比較=`greater-equal`
- `SHADOW_STANDARD_Z`: near=0、far/background=1、クリア=1、compare=`less`、同値を許す比較=`less-equal`
- `requireDepthConvention(value, label)`: 既知の深度規則オブジェクトそのものかを検証する。フィールドが同じ複製は受け入れない
- `readDepthRange(near, far, label, options)`: near/farを検証し、許可された場合だけ明示的な`Infinity` farを扱う

### `CameraFrame`

`CameraFrame`は、一回の描画で共有する確定済みのカメラ状態です。
カメラのWorld姿勢、Camera Reverse-Z投影、near／far、画角、aspectを同じスナップショットへまとめます。
G-bufferと深度依存パスは同じオブジェクトを共有し、異なるフレームのカメラ状態を混在させません。

通常サンプルが任意の時点で生成して保持する値ではありません。
`WebgApp`の描画コールバックから受け取る`cameraFrame`を、そのフレームの`renderScene()`と`encode()`へ渡します。
単一パス描画は`Space.draw(eye)`、完全なカメラ状態を公開しない手動深度共有は`renderFrameToken`を使います。

- `new CameraFrame(options)`: `cameraWorldMatrix`、`near`、`far`、`vfov`、
  `aspect`、`CAMERA_REVERSE_Z`を検証し、投影を含むフレームスナップショットを作る
- `cameraWorldMatrix`: 生成時のCamera World Matrixの複製
- `cameraWorldPosition`: World Matrixから確定したCameraのWorld位置
- `viewRotationMatrix`: 巨大な平行移動を含まないWorld-to-view回転
- `near`、`far`、`infiniteFar`: 検証済みのCamera距離範囲
- `vfov`、`aspect`: 投影生成に使った縦画角とビューポートのアスペクト比
- `depthConvention`: `CAMERA_REVERSE_Z`そのもの
- `projectionMatrix`: 同じframeのnear、far、vfov、aspectから生成した投影行列
- `worldPointToCameraRelative(worldPoint)`: World位置からCamera World位置を
  JavaScriptの倍精度で減算する
- `worldPointToCameraRelativeF32(worldPoint)`: Camera相対位置をGPU入力用の
  `Float32Array`で返す
- `cameraRelativePointToView(point)`: Camera相対位置へview回転を適用する
- `worldPointToView(worldPoint)`: World位置をCamera相対化して
  view-spaceへ変換する
- `createModelViewMatrix(objectWorldMatrix)`: オブジェクトの平行移動を
  Camera相対化し、
  回転とスケールを維持したmodel-view matrixを返す
- `createCameraTransformFrameFromEye(eye, label)`: 投影を要求しない
  `Space.draw(eye)`用の相対座標変換スナップショットを作る
- `createCameraFrameFromEye(eye, options)`: EyeのWorld Matrixを一度更新し、
  完全な`CameraFrame`を作る
- `createRenderFrameToken(cameraFrame)`: 完全なCamera情報を公開しない、
  オブジェクト同一性だけを持つフレームトークンを作る
- `isRenderFrameToken(value)`: 公開tokenがコアで生成されたものか判定する
- `resolveRenderFrameTokenCameraFrame(token, label)`: コア所有パスが
  tokenに対応する
  `CameraFrame`を解決する。任意のオブジェクトは受け入れない

### `ColorSpace`

`ColorSpace`は、材質入力と最終表示で共有する正確なsRGB／線形色変換を提供します。
単純な2.2乗ではなく、暗部の線形区間を含む標準sRGB伝達関数をCPUとWGSLで一致させます。

- `SRGB_REFERENCE_GAMMA`: 追加表示調整を行わない基準ガンマの`2.2`
- `COLOR_SPACE_WGSL`: `srgbToLinearChannel()`、`srgbToLinear()`、
  `linearToSrgbChannel()`、`linearToSrgb()`を定義する共有WGSL文字列
- `srgbChannelToLinear(value, label)`: 0から1のsRGBチャンネルを線形値へ変換する
- `linearChannelToSrgb(value, label)`: 0から1の線形チャンネルをsRGB値へ変換する
- `srgbColorToLinear(value, label)`: RGBAのRGBだけを線形化し、alphaを維持する

### `Shader`
`Shader` は、派生クラスが共通で使う基底です。
ユニフォームバッファ、バインドグループレイアウト、シェーダーモジュール、パイプラインレイアウト、テクスチャ解決をまとめます。

- `constructor(gpu)`: GPU参照と共通状態を初期化する
- `createResources()`: 派生クラス側でリソースを作るためのフック
- `createUniformBuffer(byteLength)`: 指定サイズのユニフォームバッファを作る
- `createShaderModule(code)`: WGSL文字列からシェーダーモジュールを作る
- `createPipelineLayout(bindGroupLayouts)`: パイプラインレイアウトを作る
- `createUniformBindGroupLayout(options)`: ユニフォーム用バインドグループレイアウトを作る
- `createTextureBindGroupLayout(options)`: テクスチャ / サンプラー用レイアウトを作る
- `createUniformTextureBindGroupLayout(options)`: ユニフォームとテクスチャを混在させるレイアウトを作る
- `createDefaultTexture(options)`: 既定の 1x1テクスチャ / サンプラーを作る
- `resolveTextureResources(texture)`: テクスチャ引数からビュー / サンプラーを解決する
- `getOrCreateTexturedBindGroup(options)`: テクスチャ対応バインドグループをキャッシュ付きで返す
- `updateUniforms()`: 現在の uniformData をGPUへ転送する
- `updateUniformsAt(index)`: 配列型ユニフォームの指定位置だけを転送する
- `allocUniformIndex()`: 動的オフセット用インデックスを確保する
- `useProgram(passEncoder)`: パイプラインをパスエンコーダーへ設定する
- `updateParam(param, key, updateFunc)`: shaderParameter の差分更新を行う

### `FullscreenPass`
`FullscreenPass` は、1枚のテクスチャを全画面四角形で描く最小ポストプロセス基盤です。
`VignettePass` はこの上に乗っています。

- `constructor(gpu, options = {})`: 全画面四角形で 1枚のテクスチャを描く基盤を作る
- `setSource(texture)`: 描画元テクスチャまたは RenderTarget を設定する
- `setColorScale(r, g, b, a = 1.0)`: 出力色へ掛ける係数を設定する
- `setUvScale(u, v)`: 入力元テクスチャのUV倍率を設定する
- `setUvOffset(u, v)`: 入力元テクスチャのUVオフセットを設定する
- `draw(texture = this.texture)`: 現在のパスへ入力元テクスチャを描く

### `VignettePass`
`VignettePass` は、周辺減光を足す軽量パスです。
`samples` の最終出力やHUD付きの画面で使いやすい構成です。

- `constructor(gpu, options = {})`: ビネット用全画面パスを初期化する
- `setCenter(x, y)`: ビネットの中心をUV基準で更新する
- `setRadius(value)`: 外周半径を更新する
- `setSoftness(value)`: 内側から外周へ落ちる滑らかさを更新する
- `setStrength(value)`: ビネットの効きの強さを更新する
- `setEnabled(flag)`: ビネットのON / OFFを切り替える
- `setTint(r, g, b, a = 1.0)`: 周辺にかける色を更新する
- `render(screen, options = {})`: 入力元テクスチャにビネットを掛けて描画する

### `FrostedGlassPass`
`FrostedGlassPass` は、シーン色、ぼかしカラー、ガラスマスクを合成し、曇りガラスのように背後がぼけて見える領域を作るポストプロセスです。
`unittest/translucent` の中心です。

- `constructor(gpu, options = {})`: 曇りガラス用のシーン / マスク / ぼかし / 合成補助機能を初期化する
- `resize(width, height)`: サイズ変更の場合だけシーン / マスク / ぼかし描画先群を更新して `true` を返し、同じサイズでは `false` を返す
- `resizeToScreen(screen)`: `Screen` の現在サイズへ追従する
- `beginScene(screen, clearColor = screen.clearColor)`: 不透明シーンを描くオフスクリーンパスを始める
- `beginMask(screen, clearColor = [0, 0, 0, 0])`: シーン深度を使いながらガラスマスクパスを始める
- `render(screen, options = {})`: シーンをぼかし、シーン / ぼかし / マスクを合成してキャンバスまたは出力先に出力する
- `setEnabled(flag)`: 曇りガラス効果のON / OFFを切り替える
- `setBlurRadius(value)`: ぼかしサンプル間隔を更新する
- `setBlurIterations(value)`: ぼかしの往復回数を更新する
- `setBlurScale(value)`: ぼかし補助機能の内部描画先の解像度倍率を更新する
- `setBlurStrength(value)`: マスク alpha によるぼかし混合量を更新する
- `setTintStrength(value)`: マスクRGBの tint を最終色へ混ぜる強さを更新する
- `setMaskPower(value)`: マスク alpha の効き方を指数的に調整する
- `getSceneTarget()`: 不透明シーンのオフスクリーン描画先を返す
- `getMaskTarget()`: ガラスマスクの描画先を返す
- `getBlurTarget()`: 直近描画のぼかし出力描画先を返す
- `getBlurTargetA()`: ぼかし補助機能の一時描画先Aを返す
- `getBlurTargetB()`: ぼかし補助機能の一時描画先Bを返す

### `SeparableBlurPass`
`SeparableBlurPass` は、二つの描画先を交互に使い、横方向と縦方向へ分けてぼかす補助機能です。
ブルーム、被写界深度（DOF）、曇りガラスのぼかしで使います。

- `constructor(gpu, options = {})`: 二つの描画先を交互に使うぼかし補助機能を初期化する
- `setBlurRadius(value)`: ぼかしサンプル間隔の倍率を更新する
- `setIterations(value)`: 水平方向 / 垂直方向ぼかしの往復回数を更新する
- `setTargetScale(value)`: 内部ぼかし描画先の解像度倍率を更新する
- `resize(width, height)`: サイズ変更の場合だけ内部ぼかし描画先群を更新して `true` を返し、同じサイズでは `false` を返す
- `resizeToScreen(screen)`: `Screen` の現在サイズへ追従する
- `getTargetA()`: ぼかし用一時描画先Aを返す
- `getTargetB()`: ぼかし用一時描画先Bを返す
- `getOutputTarget()`: 直近描画の最終描画先を返す
- `getTargetScale()`: 現在の描画先の解像度倍率を返す
- `getScaledWidth()`: 解像度倍率を適用した幅を返す
- `getScaledHeight()`: 解像度倍率を適用した高さを返す
- `render(screen, source, options = {})`: 入力元テクスチャへ横方向と縦方向に分けたぼかしを掛ける

### `BloomPass`
`BloomPass` は、シーン色、高輝度抽出、ぼかし、合成をまとめます。
`samples/bloom` の中心です。

- `constructor(gpu, options = {})`: ブルーム用のシーン、高輝度抽出、ぼかし、合成の補助機能を初期化する
- `setEnabled(flag)`: ブルームのON / OFFを切り替える
- `setThreshold(value)`: 高輝度抽出の閾値を更新する
- `setSoftKnee(value)`: 高輝度抽出の立ち上がりを滑らかにする
- `setExtractIntensity(value)`: 高輝度抽出結果をぼかしへ回す強さを更新する
- `setBloomStrength(value)`: 合成時のブルーム強度を更新する
- `setExposure(value)`: 合成後段の露出を更新する
- `setToneMapMode(value)`: トーンマッピング方式を切り替える
- `setBlurRadius(value)`: ぼかしサンプル間隔を更新する
- `setBlurScale(value)`: ぼかし補助機能の内部描画先の解像度倍率を更新する
- `setBlurIterations(value)`: ぼかしの往復回数を更新する
- `resize(width, height)`: サイズ変更の場合だけ内部シーン、高輝度抽出、ぼかしの描画先群を更新して `true` を返し、同じサイズでは `false` を返す
- `resizeToScreen(screen)`: `Screen` の現在サイズへ追従する
- `getSceneTarget()`: 3Dシーンのオフスクリーン描画先を返す
- `getExtractTarget()`: 高輝度抽出結果の描画先を返す
- `getExtractHeatTarget()`: 高輝度抽出の強度を色分け表示する描画先を返す
- `getBlurTargetA()`: ぼかし補助機能の一時描画先Aを返す
- `getBlurTargetB()`: ぼかし補助機能の一時描画先Bを返す
- `getBlurScale()`: 現在のぼかし描画先の解像度倍率を返す
- `beginScene(screen, clearColor = screen.clearColor)`: シーン描画先をクリアして 3D描画を始める
- `render(screen, options = {})`: ブルーム合成してキャンバスまたは出力先に出力する

### `DofPass`
`DofPass` は、シーン色、カメラ用Reverse-Zのサンプリング可能な深度、小・中・大の3段階のぼかしカラーから被写界深度を合成します。
シーン描画と深度復元が同じフレームであることを `renderFrameToken` で検証します。
`samples/dof` の中心です。

- `constructor(gpu, options = {})`: 被写界深度（DOF）用のシーン / 深度 / ぼかし合成補助機能を初期化する
- `setEnabled(flag)`: 被写界深度（DOF）のON / OFFを切り替える
- `setFocusDistance(value)`: sharp に保ちたい距離を更新する
- `setFocusRange(value)`: ぼかし段階 1つ分の距離幅を更新する。最大ぼかし到達距離ではない
- `setMaxBlurMix(value)`: ぼかしをシーンへ最大どこまで混ぜるかを更新する
- `setDofMode(value)`: DoFモードを更新する。現在の公開実装では `staged` を使用する
- `setSharpnessWidth(value)`: 各段階幅の中で前段階の見え方を保持する割合を更新する
- `setSharpnessPower(value)`: フォーカスからぼかしへ移る曲線の強さを更新する
- `setBlurRadius(value)`: ぼかしサンプル間隔の倍率を更新する
- `setBlurIterations(value)`: 後方互換用に、小 / 中 / 大のぼかし往復回数を同じ値へまとめて更新する
- `setStageBlurIterations(value)`: `{ small, medium, large }` で段階別のぼかし往復回数を更新する
- `getStageBlurIterations()`: 現在の段階別ぼかし往復回数を返す
- `setBlurScale(value)`: ぼかし補助機能の内部描画先の解像度倍率を更新する
- `setStagedStageCount(value)`: 多段階ぼかしで使う段階数を `1` から `3` の範囲で更新する
- `getStagedStageCount()`: 多段階ぼかしで使う現在の段階数を返す
- `getStageTargetScale(stage)`: `small` / `medium` / `large` の内部描画先の解像度倍率を返す
- `resize(width, height)`: サイズ変更の場合だけシーン / ぼかし描画先群を更新して `true` を返し、同じサイズでは `false` を返す
- `resizeToScreen(screen)`: `Screen` の現在サイズへ追従する
- `getSceneTarget()`: 3Dシーンと深度の描画先を返す
- `getBlurTargetA()`: 大ぼかし補助機能の一時描画先Aを返す
- `getBlurTargetB()`: 大ぼかし補助機能の一時描画先Bを返す
- `getSmallBlurTarget()`: 小ぼかしの出力描画先を返す
- `getMediumBlurTarget()`: 中ぼかしの出力描画先を返す
- `getLargeBlurTarget()`: 大ぼかしの出力描画先を返す
- `getBlurScale()`: 現在のぼかし描画先の解像度倍率を返す
- `getDepthDebugTarget()`: 深度デバッグ用描画先を返す
- `getFocusDebugTarget()`: フォーカスマスクデバッグ用描画先を返す
- `getStageDebugTarget()`: 多段階ぼかしの段階選択を色分け表示する描画先を返す
- `beginScene(screen, clearColor = screen.clearColor, { renderFrameToken })`: トークンに対応する内部カメラフレームを記録し、シーン描画先をクリアして3D描画を始める
- `render(screen, { renderFrameToken, ...options })`: `beginScene()` と同じトークンを検証し、カメラ用Reverse-Z深度を使って被写界深度（DOF）を合成する

### コンピュートシェーダー系の画面効果
ここは、第27章、第28章、および `samples/compute_effect` で使うコンピュートシェーダー系APIの一覧です。
`ComputeEffectPipeline` が高水準APIです。
その内側では、`GeometryBufferPass`、`ShadowMapPass`、`SpotShadowMapPass`、`SsaoPass`、`ComputeShadowPass`、`ComputeSpotShadowPass`、`DeferredLightingPass`、`ComputeSsrPass`、`ComputeEffectComposer`、`TransparencyPass`、`ComputeFogPass`、`ComputeToonPass`、`ComputeDofPass`、`ComputeBloomPass`、`ComputeEffectToneMapPass`、`ComputeEdgePass`、`ComputeVignettePass`を処理順に接続します。
各パスは、必要な部分だけを利用側で接続する低水準APIとしても使えます。

### `ComputePass`
`ComputePass` はWGSL、バインディング定義、ユニフォーム、ディスパッチ寸法を一つのコンピュートパイプラインとして扱う基盤APIです。

- `constructor(gpu, options = {})`: WGSL、エントリーポイント、バインディング、ワークグループ寸法、ユニフォームに含める浮動小数点数の個数を検証してパイプラインを作る
- `setUniforms(values)`: 宣言された個数と完全に一致する浮動小数点数の配列をユニフォームとして転送する
- `encode(commandEncoder, resources, options = {})`: リソースをバインディングへ解決し、指定またはリソース由来のディスパッチ寸法でコンピュートパスを記録する
- `destroy()`: パイプラインが内部で生成したユニフォームバッファなどを破棄する

### `ComputeBlurPass`
`ComputeBlurPass` は二つの描画先を交互に使い、水平方向と垂直方向へ分けて記録するぼかし処理です。

- `constructor(gpu, options = {})`: 中間描画先、出力描画先、2方向の `ComputePass` を作る
- `encode(commandEncoder, source, options = {})`: `radius`、`iterations`、`sampleStep` を使ってぼかしを記録する
- `resize(width, height)`: 現在の解像度倍率に合わせて内部描画先を更新する
- `getIntermediateTarget()` / `getOutputTarget()` / `getTargets()`: 診断または後段接続用描画先を返す
- `destroy()`: 内部描画先とパスを破棄する

### `GeometryBufferPass`
`GeometryBufferPass` は、標準 `Space` をG-bufferへ描く入口です。
アルベド、ビュー空間法線、表面マテリアル、カメラ用Reverse-Z深度を同時に生成し、後段のSSAO、シャドウ、遅延照明、SSR、形状の輪郭で共有します。
アルベド形式は`rgba8unorm-srgb`です。
形状の`color`、カラーテクスチャ、`clearColor`を表示用sRGB色として受け、後段からは線形アルベドとして読める状態にします。

- `constructor(gpu, options = {})`: G-bufferの寸法、カラーモード、法線空間、アタッチメント形式を指定してMRTパスを作る
- `createGBufferProjectionParams(cameraFrame)`: `GeometryBufferPass.js` の名前付きエクスポート。Reverse-Zのカメラフレームから深度線形化とビュー空間復元に使う投影パラメータを作る
- `syncSpaceEntries(space, options = {})`: `Space` 配下の標準 `Shape` を収集し、このパスが描けるエントリー一覧へ同期する
- `getBindingResources()`: 後段パスが読む `color`、`normal`、`material`、`depth` のバインディングリソースを返す
- `resize(width, height)`: カメラ依存のG-bufferアタッチメントをリサイズする
- `renderEntries(entries, cameraFrame, clearColor, options = {})`: 事前に集めたエントリー群を同じカメラフレームでG-bufferへ描く
- `render(cameraFrame, clearColor)`: 現在保持しているエントリー一覧をG-bufferへ描く
- `renderSpace(space, cameraFrame, clearColor, options = {})`: `Space` からエントリー収集とG-buffer描画をまとめて行う
- `destroy()`: アタッチメントと内部GPU資源を破棄する

### `SsaoPass`
`SsaoPass` は、G-bufferの法線とカメラ用Reverse-Z深度から画面空間の環境遮蔽を計算し、環境遮蔽の可視率を返します。
シーン色との合成は行いません。
`resolutionScale` で未加工AO描画先だけを低解像度化でき、最終可視率は元の解像度に保たれます。

- `constructor(gpu, options = {})`: SSAO用のコンピュートパスと出力描画先を作る。`resolutionScale` の既定値は `0.7`、範囲は `0.5..1.0`
- `encode(commandEncoder, resources, options = {})`: `normal`、`depth` と `options.cameraFrame` を受け取り、AO可視率を出力する。`resolutionScale` を指定すると未加工AO描画先の解像度を変更する
- `getOutputTarget()`: 直近 `encode()` の出力描画先を返す
- `resize(width, height)`: フル解像度の出力寸法を更新し、未加工AO描画先は `resolutionScale` から再計算する
- `destroy()`: 内部で生成した描画先とコンピュートパスを破棄する

### `ShadowMapPass`
`ShadowMapPass` は、標準 `Space` を方向光の視点から深度テクスチャへ描くパスです。
後段の `ComputeShadowPass` がこの深度を読み、カメラ側G-bufferと照合して影を評価します。

- `constructor(gpu, options = {})`: シャドウマップの固定解像度と深度形式を指定して深度専用パスを作る
- `createDirectionalLightMatrices(options = {})`: `ShadowMapPass.js` の名前付きエクスポート。方向光の方向、対象点、投影範囲からビュー行列、投影行列、`viewProjection`を作る
- `syncSpaceEntries(space, options = {})`: 影に参加する標準 `Shape` を収集して内部エントリー一覧へ同期する
- `renderSpace(space, lightViewProjection, options = {})`: `Space` を光源視点から描いてシャドウマップを更新する
- `resize(width, height)`: シャドウマップの深度テクスチャを作り直す
- `getBindingResources()`: `shadowTexture` と比較用サンプラーをまとめて返す
- `getDepthView()`: 深度アタッチメントビューを返す
- `getDepthSampleView()`: シェーダーから読む深度ビューを返す
- `getWidth()`: 現在のシャドウマップ幅を返す
- `getHeight()`: 現在のシャドウマップ高さを返す
- `destroy()`: 深度テクスチャと内部GPU資源を破棄する

### `SpotShadowMapPass`
`SpotShadowMapPass` は、標準 `Space` をスポットライトの視点から深度テクスチャへ描くパスです。
深度専用描画は `ShadowMapPass` と同じ役割を持ち、光源位置、照射方向、FOV、near、farからライトのビュー投影行列を作る点が異なります。

- `constructor(gpu, options = {})`: シャドウマップの固定解像度と深度形式を指定して深度専用パスを作る
- `createSpotLightMatrices(options = {})`: `SpotShadowMapPass.js` の名前付きエクスポート。スポットライトの位置、照射方向、FOV、near、far、aspectからビュー行列、投影行列、`viewProjection`を作る
- `renderSpace(space, lightViewProjection, options = {})`: `Space` をスポットライト視点から描いてシャドウマップを更新する
- `getBindingResources()`: `shadowTexture` と比較用サンプラーをまとめて返す
- `resize(width, height)`: シャドウマップの深度テクスチャを作り直す
- `destroy()`: 深度テクスチャと内部GPU資源を破棄する

### `ComputeShadowPass`
`ComputeShadowPass` は、カメラ用Reverse-ZのG-buffer、カメラフレーム、ライトのビュー投影行列、通常Zのシャドウマップ深度から方向光の可視率を作るコンピュートパスです。
照明色は`DeferredLightingPass`が生成します。

- `constructor(gpu, options = {})`: 影評価用コンピュートパスと出力描画先を作る
- `encode(commandEncoder, resources, options = {})`: G-bufferとシャドウマップ、`cameraFrame`、`lightViewProjection`、`lightDirection`を受け取り、バイアス、`normalBias`、PCF半径から可視率を出力する
- `resize(width, height)`: 出力寸法を更新する
- `getOutputTarget()`: 直近 `encode()` の出力描画先を返す
- `destroy()`: 内部で生成した描画先とコンピュートパスを破棄する

### `ComputeSpotShadowPass`
`ComputeSpotShadowPass` は、カメラ用Reverse-ZのG-buffer、カメラフレーム、スポットライトのビュー投影行列、通常Zのシャドウマップ深度からスポットライトの可視率を作るコンピュートパスです。

- `constructor(gpu, options = {})`: スポットシャドウ評価用コンピュートパスと出力描画先を作る
- `encode(commandEncoder, resources, options = {})`: G-bufferとシャドウマップ、`cameraFrame`、`lightViewProjection`、`lightPosition`を受け取り、バイアス、`normalBias`、PCF半径から可視率を出力する
- `resize(width, height)`: 出力寸法を更新する
- `getOutputTarget()`: 直近 `encode()` の出力描画先を返す
- `destroy()`: 内部で生成した描画先とコンピュートパスを破棄する

### `ComputeSsrPass`
`ComputeSsrPass`は、G-bufferのマテリアル、法線、Reverse-Z深度と線形HDRシーンから画面空間反射を計算します。
レイマーチングの結果から1/2、1/4、1/8の画像ピラミッドを作り、材質の`roughness`に応じて反射RGBをぼかします。
反射の重みを保存するアルファは現在の画素の値を保ち、最終合成は`ComputeEffectComposer`へ任せます。

- `constructor(gpu, options = {})`
  - SSR用コンピュートパス、反射レイ用の描画先、`roughness`用の
    画像ピラミッド、最終反射の描画先を作ります。
  - `width`と`height`の既定値は1です。
  - `resolutionScale`の既定値は`0.7`、範囲は0.5から1.0です。
    反射レイ用の描画先、`roughness`用の画像ピラミッド、
    最終反射の描画先に適用する解像度倍率です。
  - `reflectivityThreshold`の既定値は`0.05`、範囲は0.0から1.0です。
    材質の反射性が小さい画素でレイマーチングを省くしきい値です。
- `ready`
  - 反射レイ用の描画先、`roughness`用の画像ピラミッド、最終反射の
    描画先を使用できるまで待つ`Promise`です。
- `encode(commandEncoder, resources, options = {})`
  - `resources`へ`scene`、`normal`、`material`、`depth`を渡します。
  - `options.cameraFrame`は同じG-buffer描画に使ったカメラフレームです。
  - `intensity`の既定値は`0.82`、範囲は0.0から1.5です。
    検出した反射の合成強度を指定します。
  - `distance`の既定値は`42.0`で、1以上を指定します。
    ビュー空間でレイを探索する最大距離です。
  - `thickness`の既定値は`0.42`で、0より大きい値を指定します。
    レイと深度面を交差とみなす許容厚みです。
  - `steps`の既定値は`48`で、12から64の整数を指定します。
    粗い探索に使う基準ステップ数です。
  - `resolutionScale`と`reflectivityThreshold`は`constructor`と同じ意味、
    既定値、範囲で、この`encode()`以降に使う値を更新できます。
  - `enabled`の既定値は`true`です。`false`では反射生成を無効にします。
  - `view`の既定値は`"reflection"`です。`"normal"`と`"depth"`も
    診断表示に使えます。
- `resize(width, height)`
  - G-bufferの元の解像度を更新し、反射レイ用の描画先、最終出力の
    描画先、`roughness`用の画像ピラミッドを現在の
    `resolutionScale`に合わせてリサイズします。
- `setResolutionScale(scale)`
  - 実行時の解像度倍率を0.5から1.0で更新します。
- `getOutputTarget()`
  - `roughness`を適用した直近の`rgba16float`反射用描画先を返します。
- `destroy()`
  - レイ、`roughness`、画像ピラミッド、出力に使う全GPUリソースを
    破棄します。

### `ComputeToonPass`
`ComputeToonPass` は、線形なシーン色を段階化してトゥーン風の明暗表現を作るコンピュートパスです。
輪郭線は扱わず、色の段階化だけを担当します。

- `constructor(gpu, options = {})`: トゥーン用コンピュートパスと出力描画先を作る
- `encode(commandEncoder, scene, options = {})`: シーン色を受け取り、段階数、混合率、ガンマを使って段階化したカラーを出力する
- `resize(width, height)`: 出力寸法を更新する
- `getOutputTarget()`: 直近 `encode()` の出力描画先を返す
- `getComputePass()`: 内部 `ComputePass` を返す
- `destroy()`: 内部で生成した描画先とコンピュートパスを破棄する

### `ComputeImagePyramid`

`ComputeImagePyramid`は、元の解像度の線形HDR画像から、指定した低解像度の段階を連続して生成する共通のコンピュート機能です。
各段階は元の解像度から直接抜き出さず、一つ前の段階へ13点ローパスフィルターを適用して1/2へ縮小します。

- `constructor(gpu, options = {})`
  - `width`と`height`の既定値は1です。
  - `format`の既定値と対応値は`"rgba16float"`です。
  - `levels`の既定値は`[2, 4, 8]`です。
  - 段階は2から始まる連続した2の累乗で指定します。
  - 指定した全段階のストレージ用描画先と縮小パスを作ります。
- `ready`
  - 全段階の描画先を使用できるまで待つ`Promise`です。
- `encode(commandEncoder, source, options = {})`
  - 元の解像度の`source`から全段階を順番に生成し、
    最も低い解像度の描画先を返します。
  - `filterRadius`の既定値は`1.0`、範囲は0.25から3.0です。
    各13点ローパスフィルターのサンプル間隔を入力画像の画素単位で
    指定します。
  - `timestampWrites`で最初と最後の段階を含む計測範囲を指定できます。
- `getLevel(divisor)`
  - 2、4、8など、生成時に指定した縮小率の描画先を返します。
- `getLevels()`
  - 保持している縮小率の配列を返します。
- `resize(width, height)`
  - 保持する全段階を新しい元の解像度から再計算します。
- `destroy()`
  - 縮小パスと全段階の描画先を破棄します。

### `ComputePyramidBlurPass`

`ComputePyramidBlurPass`は、`ComputeImagePyramid`で線形HDR画像を連続縮小し、最小の段階から元の解像度へ順番に拡大するぼかし処理です。
途中の段階の色は加算せず、最小段階の低周波画像だけを拡大するため、再構成によって光量を増やしません。

- `constructor(gpu, options = {})`
  - `width`と`height`の既定値は1です。
  - `format`の既定値と対応値は`"rgba16float"`です。
  - `levels`の既定値は`[2, 4, 8, 16]`です。
  - 段階は2から始まる連続した2の累乗で指定します。
  - 連続縮小用の`ComputeImagePyramid`、9点テントフィルターによる
    拡大パス、元の解像度の出力用描画先を作ります。
  - `filterRadius`の既定値は`1.0`、設定範囲は0.25から3.0です。
- `ready`
  - 画像ピラミッドと出力用描画先を使用できるまで待つ`Promise`です。
- `encode(commandEncoder, source, options = {})`
  - `source`には、元の解像度と一致する`rgba16float`の描画先を
    指定します。
  - 既定では1/2、1/4、1/8、1/16へ連続縮小し、1/16から1/8、
    1/4、1/2、元の解像度へ段階的に拡大します。
  - `filterRadius`は縮小時と拡大時のサンプル間隔です。
    省略時は構築時の値を使います。
  - `timestampWrites`は最初の縮小処理から最後の拡大処理までの
    計測範囲を指定します。
  - 元の解像度へ再構成した出力用描画先を返します。
- `getOutputTarget()`
  - 直近の元の解像度のぼかし画像を返します。
- `getLevels()`
  - 保持している縮小率の配列を返します。
- `resize(width, height)`
  - 全段階と出力用描画先を新しい元の解像度へ合わせます。
- `destroy()`
  - 縮小、拡大、出力に使う全GPUリソースを破棄します。

### `ComputeDofPass`

`ComputeDofPass`は、線形HDRシーンとカメラ用Reverse-Z深度を使って被写界深度を合成します。
シーン、遠景、近景、CoCの補助情報の4系統について、1/2、1/4、1/8、1/16の画像ピラミッドを作ります。
焦点外の形状内部は選択した低周波の段階で置き換え、近景と遠景のフィルター処理済みの被覆率を元の輪郭の外側へ合成します。

- `constructor(gpu, options = {})`
  - `width`と`height`の既定値は1です。
  - `format`の既定値と対応値は`"rgba16float"`です。
  - 4組の画像ピラミッド、CoC抽出パス、合成パス、出力用の描画先を
    作ります。
- `ready`
  - 全描画先と画像ピラミッドを使用できるまで待つ`Promise`です。
- `encode(commandEncoder, resources, options = {})`
  - `resources.scene`へ`rgba16float`のシーンを渡します。
  - `resources.depth`へカメラ用Reverse-Z深度を渡します。
  - `options.cameraFrame`は同じG-buffer描画に使ったカメラフレームです。
  - `focusDistance`の既定値は`36.0`で、0より大きい値を指定します。
    カメラから合焦面までのビュー空間での距離です。
  - `focusRange`の既定値は`7.0`で、0より大きい値を指定します。
    焦点面付近を鮮明に保つ幅と、画像ピラミッドの段階が進む
    距離の基準です。
  - `blurRadius`の既定値は`1.0`、範囲は0.25から3.0です。
    画像ピラミッドの各段階を作るローパスフィルターのサンプル間隔です。
  - `cocScale`の既定値は`1.0`、範囲は0.0から2.0です。
    焦点からの距離差をCoCの段階へ変換する倍率です。
  - `sharpnessWidth`の既定値は`0.15`、範囲は0.0から0.95です。
    合焦帯から最初の低周波の段階へ移り始める境界幅です。
  - `sharpnessPower`の既定値は`1.0`で、0より大きい値を指定します。
    隣接する画像ピラミッドの段階間の補間カーブを調整します。
  - `debugView`の既定値は`"composite"`です。`"depth"`と`"focus"`も
    指定できます。
  - `enabled`の既定値は`true`です。DoF合成の有効、無効を切り替えます。
- `resize(width, height)`
  - 元の解像度の描画先と4系統の全段階をまとめて更新します。
- `getHalfTarget()` / `getQuarterTarget()`
  - シーンの画像ピラミッドにある1/2または1/4段階を返します。
- `getEighthTarget()` / `getSixteenthTarget()`
  - シーンの画像ピラミッドにある1/8または1/16段階を返します。
- `getBlurTarget()`
  - シーンの画像ピラミッドにある1/16段階を返します。
- `getFarFieldTarget()` / `getNearFieldTarget()`
  - 元の解像度の遠景または近景の被覆率用描画先を返します。
- `getFarSixteenthTarget()` / `getNearSixteenthTarget()`
  - 遠景または近景の画像ピラミッドにある1/16段階を返します。
- `getCocFieldTarget()` / `getCocSixteenthTarget()`
  - 元の解像度または1/16段階のCoC補助情報を返します。
- `getSmallBlurTarget()` / `getMediumBlurTarget()` /
  `getLargeBlurTarget()`
  - 診断表示名に対応して1/2、1/4、1/16段階を返します。
- `getOutputTarget()`
  - 直近のDoF合成結果を返します。
- `destroy()`
  - コンピュートパス、4組の画像ピラミッド、元の解像度の描画先を
    破棄します。

### `ComputeBloomPass`

`ComputeBloomPass`は、線形HDRシーンから高輝度成分を一度だけ抽出し、1/2、1/4、1/8、1/16、1/32の画像ピラミッドを作ります。
1/32から元の解像度へ各段階の重みを付けながら再構成し、元のシーンへ加算した`rgba16float`の描画先を返します。

- `constructor(gpu, options = {})`
  - `width`と`height`の既定値は1です。
  - `format`の既定値と対応値は`"rgba16float"`です。
  - 高輝度抽出、画像ピラミッド、拡大、ブルーム、最終出力に使う
    リソースを作ります。
  - `encode()`と同じブルーム設定をインスタンスの既定値として指定できます。
- `ready`
  - 全描画先と画像ピラミッドを使用できるまで待つ`Promise`です。
- `encode(commandEncoder, scene, options = {})`
  - `threshold`の既定値は`0.60`、範囲は0.0から4.0です。
    ブルームへ入れ始める線形HDR輝度を指定します。
  - `softKnee`の既定値は`0.40`、範囲は0.0から1.0です。
    `threshold`付近で抽出量が立ち上がる境界を滑らかにします。
  - `strength`の既定値は`0.70`、範囲は0.0から4.0です。
    再構成したブルーム全体を元のシーンへ加える量です。
  - `halfWeight`の既定値は`0.45`で、光源近傍の1/2段階を調整します。
  - `quarterWeight`の既定値は`0.28`で、1/4段階を調整します。
  - `eighthWeight`の既定値は`0.17`で、1/8段階を調整します。
  - `sixteenthWeight`の既定値は`0.10`で、1/16段階を調整します。
  - `thirtySecondWeight`の既定値は`0.18`で、最も外側まで広がる
    1/32段階を調整します。
  - 各段階の重みの範囲は0.0から4.0で、自動正規化しません。
  - `filterRadius`の既定値は`1.00`、範囲は0.25から3.0です。
    段階的な拡大で使うテントフィルターの間隔を、拡大元の
    低解像度画像の画素単位で指定します。
  - `enabled`の既定値は`true`です。`false`ではブルームを元のシーンへ
    加えず、シーンだけを出力します。
- `resize(width, height)`
  - 高輝度抽出、画像ピラミッドの全段階、拡大、ブルーム、出力用の
    描画先を更新します。
- `getExtractTarget()`
  - 元の解像度の高輝度抽出結果を返します。
- `getHalfTarget()` / `getQuarterTarget()` / `getEighthTarget()`
  - 1/2、1/4、1/8の縮小結果を返します。
- `getSixteenthTarget()` / `getThirtySecondTarget()`
  - 1/16または1/32の縮小結果を返します。
- `getBlurTarget()`
  - 段階的な拡大後に得た、元の解像度のブルームを返します。
- `getOutputTarget()`
  - 直近のHDRシーンとブルームの合成結果を返します。
- `destroy()`
  - 高輝度抽出、画像ピラミッド、拡大、合成に使う全GPUリソースを
    破棄します。

### `ComputeEdgePass`
`ComputeEdgePass` は、シーン色のSobel輪郭と、法線 / 深度を使う形状の輪郭を扱えるコンピュートパスです。
`blendMode` により黒乗算、黒減算、白加算を切り替えられます。
入力シーンはトーンマッピング後の`rgba8unorm`、または標準`RenderTarget`の`bgra8unorm`を受け付け、出力は`rgba8unorm`です。
トーンマッピング前の`rgba16float`は受け付けません。

- `constructor(gpu, options = {})`: edge 用コンピュートパス群と出力描画先を作る
- `encode(commandEncoder, scene, options = {})`: 表示用シーン色と、形状の境界を使う場合はG-bufferの`normal` / `depth` / `cameraFrame`を受け取り、輪郭線を合成して出力する。削除済みの`projection`は受け付けない
- `resize(width, height)`: 出力寸法を更新する
- `getOutputTarget()`: 直近 `encode()` の出力描画先を返す
- `getEdgePass()`: 色の輪郭用の内部 `ComputePass` を返す
- `getGeometryEdgePass()`: 形状の輪郭用の内部 `ComputePass` を返す
- `destroy()`: 内部で生成した描画先と内部パスを破棄する

### `ComputeVignettePass`
`ComputeVignettePass`は、トーンマッピングと任意の輪郭抽出を終えた表示色へ、画面周辺の減光と色付けを加えるコンピュートパスです。
入力と出力は`rgba8unorm`であり、線形HDR区間へは接続しません。
中心からの水平方向の距離は画面のアスペクト比で補正されるため、縦横比が変わっても周辺効果を円形に保てます。

- `constructor(gpu, options = {})`
  - `width`と`height`の既定値は1です。
  - `format`の既定値と対応値は`"rgba8unorm"`です。
  - `center`の既定値は`[0.5, 0.5]`です。
  - `radius`の既定値は`0.9`で、0より大きい値を指定します。
  - `softness`の既定値は`0.35`で、0より大きく`radius`以下の値を指定します。
  - `strength`の既定値は`0.65`、範囲は0.0から1.0です。
  - `tint`の既定値は`[0.0, 0.0, 0.0]`で、各成分へ0以上の値を指定します。
  - `enabled`の既定値は`false`です。
- `ready`
  - 出力描画先を使用できるまで待つ`Promise`です。
- `encode(commandEncoder, scene, options = {})`
  - `scene`へ`rgba8unorm`の表示色を渡します。
  - `center`、`radius`、`softness`、`strength`、`tint`、`enabled`を検証し、周辺効果を適用した`rgba8unorm`の描画先を返します。
  - `timestampWrites`でGPU時間の計測範囲を指定できます。
- `resize(width, height)`
  - 出力描画先を新しい表示寸法へ更新します。
  - 寸法が変わった場合だけ`true`を返します。
- `getOutputTarget()`
  - 直近のビネット適用結果を返します。
- `getComputePass()`
  - 内部の`ComputePass`を返します。
- `destroy()`
  - 出力描画先と内部のコンピュートパスを破棄します。

### `DeferredLightingPass`
`DeferredLightingPass` はG-bufferのアルベド / 法線 / マテリアル / 深度、AO / 方向光 / スポット可視率とローカルライト配列を読み、ビュー空間で`rgba16float`の照明結果を計算します。
環境拡散光はAO可視率、Fresnel反射、`metallic`によるエネルギー配分を適用し、完全な金属へアルベド由来の拡散光を加えません。
Reverse-Z深度0の背景では位置と光源を評価せず、G-bufferのアルベドクリア値をそのまま引き継ぎます。
ローカルライトは全方向の`type: "point"`と方向付きの`type: "cone"`を扱います。
コーンライトはワールド方向の`direction`と度単位の`innerAngle` / `outerAngle`を必須とし、放射角を距離減衰と独立に制御します。

- `constructor(gpu, options = {})`: 出力描画先、最大ライト数、照明用コンピュートパスを作る
- `encode(commandEncoder, resources, options = {})`: `cameraFrame`、必須の`directionalLight` / `spotLight`（使わない場合は`null`）、明示的な`type`を持つローカルライトの`lights`、`lightCount`、診断用の`view`を受け取り照明結果を出力する
- `resize(width, height)`: 出力描画先をG-buffer寸法へ合わせる
- `getOutputTarget()`: 直近の照明結果描画先を返す
- `destroy()`: ライトバッファ、出力描画先、コンピュートパスを破棄する

### `GpuParticleEmitter`
`GpuParticleEmitter` はパーティクル状態のストレージバッファ、更新コンピュートパイプライン、インスタンス描画パイプラインを統合します。

- `constructor(gpu, options = {})`: パーティクル数、WGSL、初期状態、quad、描画形式に加え、利用側WGSLが定義する`coordinateSpace`と`depthConvention`を検証してリソースを作る
- `encodeCompute(commandEncoder, options = {})`: パーティクル状態の更新ディスパッチを記録する
- `encodeRender(commandEncoder, options = {})`: 更新済みストレージバッファをインスタンス描画する描画パスを記録する
- `getParticleCount()` / `getWorkgroupSize()` / `getParticleBuffer()`: 現行構成と状態バッファを返す
- `destroy()`: バッファ、パイプライン、バインドグループ関連リソースを破棄する

### `ComputeEffectComposer`
`ComputeEffectComposer` は、SSRの反射成分をHDR基礎カラーへ合成する小さなコンピュートパスです。
tone mappingやガンマ変換は持たず、入出力を`rgba16float`で維持します。

- `constructor(gpu, options = {})`: 反射合成用コンピュートパスと出力描画先を作る
- `encode(commandEncoder, resources, options = {})`: `base`、`reflection`、`depth` を受け取り、背景除外付きの合成結果を出力する
- `resize(width, height)`: 出力寸法を更新する
- `getOutputTarget()`: 直近 `encode()` の出力描画先を返す
- `destroy()`: 内部で生成した描画先とコンピュートパスを破棄する

### `ComputeEffectToneMapPass`
`ComputeEffectToneMapPass` は、コンピュート系の複数効果を通った`rgba16float`の線形HDR色を、最終表示用の`rgba8unorm`へ変換して閉じるパスです。
Reinhardまたは線形切り詰めの後に正確なsRGB伝達関数を適用し、さらに`pow(srgbColor, 2.2 / gamma)`で表示上の追加調整を行います。
`gamma: 2.2`では追加調整を行わず、標準sRGBの結果を維持します。

- `constructor(gpu, options = {})`: 表示変換用コンピュートパスと出力描画先を作る
- `encode(commandEncoder, resources, options = {})`: `rgba16float`のシーン色とカメラ用Reverse-Z深度を受け取り、露出、`reinhard`または`linear`、sRGB変換、彩度、追加のガンマ調整を適用した表示色を出力する
- `resize(width, height)`: 出力寸法を更新する
- `getOutputTarget()`: 直近 `encode()` の出力描画先を返す
- `destroy()`: 内部で生成した描画先とコンピュートパスを破棄する

### `ComputeEffectPipeline`
`ComputeEffectPipeline` は、G-buffer、シャドウマップ、可視率、遅延照明、SSR、半透明、フォグ、トゥーン、DoF、ブルーム、トーンマッピング、輪郭抽出、ビネットをまとめる高水準APIです。
標準`Space`と`Shape`を入力にし、同じカメラフレームとHDR処理順を検証しながら必要な効果を実行します。

材質の`alpha`が1.0未満の三角形がある場合、遅延ライティングとSSRの後で内部の`TransparencyPass`を実行します。
利用側は透明用のレンダーパスを追加しません。
透明三角形がなければ、透明用のぼかし、マスク、表面描画を省略します。

`shadow.type` には `"directional"` または `"spot"` を指定できます。
`"directional"` では `ShadowMapPass` と `ComputeShadowPass` を使い、`"spot"` では `SpotShadowMapPass` と `ComputeSpotShadowPass` を使います。
同じフレームの `renderScene()` と `encode()` には同じ `shadow.type` を渡す必要があります。

- `constructor(gpu, options = {})`: 内部で管理するパス群、描画先群、光源設定をまとめて初期化する
- `renderScene(space, cameraFrame, clearColor, options = {})`: シャドウマップとカメラ用Reverse-ZのG-bufferを作り、そのフレーム識別情報を記録する
- `encode(commandEncoder, { cameraFrame, ...options })`: `renderScene()`と同じカメラフレームを検証し、コンピュート効果の処理全体を記録して表示用テクスチャを返す
- `resize(width, height)`: サイズ変更の場合だけカメラ依存描画先と各パスをまとめて更新して `true` を返し、同じサイズでは `false` を返す
- `getBindingResources()`: 直近描画に対応する `color` / `depth` / `normal` などの共有リソースを返す
- `destroy()`: 内部で生成したパス群と描画先群をまとめて破棄する

### `TransparencyPass`

`TransparencyPass`は、`ComputeEffectPipeline`のHDR区間で半透明三角形を自動合成します。
不透明シーンから1/2、1/4、1/8の画像ピラミッドを作り、透明面の粗さのマスクから選んだ背景を合成します。
その後、全`Shape`から集めて奥から手前へ並べた三角形をアルファ合成します。

- `constructor(gpu, options = {})`
  - `width`と`height`の既定値は1です。
  - HDR出力、粗さのマスク、3段階のすりガラス用画像ピラミッド、
    背景合成パス、透明表面用のシェーダーを作ります。
- `ready`
  - 描画先、画像ピラミッド、シェーダーを使用できるまで待つ
    `Promise`です。
- `encode(commandEncoder, resources = {})`
  - `scene`へ透明合成前の`rgba16float` HDRシーンを渡します。
  - `depth`へカメラ用Reverse-Z深度を渡します。
  - `space`へ透明三角形を含む`Space`を渡します。
  - `cameraFrame`は同じG-buffer描画に使ったカメラフレームです。
  - 必要に応じて`ambient`と`lightOverride`も渡せます。
  - すりガラス背景と透明表面を合成した`rgba16float`の描画先を返します。
- `resize(width, height)`
  - HDR出力、マスク、1/2、1/4、1/8段階を更新します。
  - 寸法が変わった場合だけ`true`を返します。
- `destroy()`
  - コンピュートパス、画像ピラミッド、`RenderTarget`、
    シェーダーを破棄します。

### `ComputeFogPass`
`ComputeFogPass`は、半透明合成を終えた線形HDRシーンへ、カメラから不透明面までの距離に応じたフォグを一度だけ適用するコンピュートパスです。
入力と出力は`rgba16float`です。
距離はカメラ用Reverse-ZのG-buffer深度と、同じG-buffer描画に使った`cameraFrame`から復元します。
背景深度では距離を推測せず、入力シーンの色をそのまま保持します。

- `constructor(gpu, options = {})`
  - `width`と`height`の既定値は1です。
  - `format`の既定値と対応値は`"rgba16float"`です。
  - `color`の既定値は`[0.1, 0.15, 0.1]`で、各成分へ0以上の値を指定します。
  - `near`の既定値は`20.0`、`far`の既定値は`80.0`で、`far`は`near`より大きくする必要があります。
  - `density`の既定値は`0.03`で、0以上の値を指定します。
  - `mode`の既定値は`"linear"`で、`"linear"`または`"exp"`を指定します。
  - `enabled`の既定値は`false`です。
- `ready`
  - 出力描画先を使用できるまで待つ`Promise`です。
- `encode(commandEncoder, resources, options = {})`
  - `resources.scene`へ`rgba16float`のシーンを渡します。
  - `resources.depth`へカメラ用Reverse-Z深度を渡します。
  - `options.cameraFrame`へ同じG-buffer描画に使ったカメラフレームを渡します。
  - `color`、`near`、`far`、`density`、`mode`、`enabled`を検証し、フォグ適用後の`rgba16float`描画先を返します。
  - `timestampWrites`でGPU時間の計測範囲を指定できます。
- `resize(width, height)`
  - 出力描画先を新しい表示寸法へ更新します。
  - 寸法が変わった場合だけ`true`を返します。
- `getOutputTarget()`
  - 直近のフォグ適用結果を返します。
- `getComputePass()`
  - 内部の`ComputePass`を返します。
- `destroy()`
  - 出力描画先と内部のコンピュートパスを破棄します。

### `Background`
`Background` は、画面後景にテクスチャや色を配置するヘルパーです。

- `constructor(gpu)`: 背景描画用のシェーダー / テクスチャ状態を初期化する
- `createResources()`: 背景描画に必要なリソースを作る
- `createDefaultTexture()`: 既定の 1x1テクスチャを作る
- `getBindGroup(texture)`: 指定テクスチャ用バインドグループを返す
- `setColor(r, g, b)`: 背景色を設定する
- `setAspect(aspect)`: 背景の縦横比を設定する
- `setWindow(left, top, width, height)`: 背景を置くウィンドウ領域を設定する
- `setWindowPixels(x, y, width, height, screenWidth, screenHeight)`: 画素基準で区間を設定する
- `setTextureAspect(textureWidth, textureHeight, rectWidth, rectHeight)`: テクスチャと表示矩形の比率を合わせる
- `setOrder(order)`: 描画順を設定する
- `init()`: 背景描画の初期化を行う
- `setBackground(texture)`: 表示する背景テクスチャを設定する
- `makeShape()`: 背景用 quad 形状を作る
- `draw()`: 背景を描画する

### `Wireframe`
`Wireframe` は、形状の線表示を行う最小シェーダーです。
`unittest` やデバッグ用に便利です。

- `constructor(gpu)`: ワイヤーフレーム用シェーダー状態を初期化する
- `createResources()`: ワイヤーフレーム描画に必要なリソースを作る
- `getBindGroup()`: ワイヤーフレーム用バインドグループを返す
- `setProjectionMatrix(m)`: 投影行列を設定する
- `setModelViewMatrix(m)`: モデル-ビュー行列を設定する
- `setNormalMatrix(m)`: 法線行列を設定する
- `setColor(color)`: 線色を設定する
- `doParameter(param)`: 形状側 parameter をまとめて反映する

### `SmoothShader`
`SmoothShader` は、現在の標準 3D材質です。
static mesh、skinned mesh、テクスチャ、法線 map、フォグ、flat shading を 1本の入口で扱います。

- `constructor(gpu, options = {})`: smooth shading 用の標準シェーダーを初期化する。`backfaceDebug`、`cullMode`、`frontFace`、深度設定もここで受ける
- `createResources()`: ユニフォームバッファ、バインドグループレイアウト、パイプラインなどGPU資源を作る
- `createDefaultTexture()`: テクスチャ未指定時に使う既定の 1x1テクスチャを作る
- `createDefaultNormalTexture()`: 法線 map 未指定時に使う既定の flat 法線テクスチャを作る
- `createDefaultBoneBindGroup()`: ボーンパレット未指定時に使う既定のバインドグループを作る
- `useProgram(passEncoder)`: 現在の描画パスにパイプラインを設定する
- `getBindGroup(texture)`: テクスチャと法線テクスチャの組み合わせからバインドグループを返す
- `getBindGroup1(texture)`: group(1) 用バインドグループを明示的に取得する
- `getBindGroup2(skeleton = null)`: ボーンパレット用バインドグループを返す
- `ensureSkinEntry(skeleton = null)`: skeleton ごとのボーンバッファ / バインドグループを必要に応じて作る
- `getDummySkinVertexBuffer()`: 非スキニング形状でも同じレイアウトで描ける代替 skin vertex バッファを返す
- `setProjectionMatrix(m)`: 投影行列を設定する
- `setModelViewMatrix(m)`: モデル-ビュー行列を設定する
- `setNormalMatrix(m)`: 法線行列を設定する
- `setLightPosition(x, y, z, w = 1.0)`: ライト位置または方向を設定する
- `setColor(color)`: 材質の基本色を設定する
- `setAmbientLight(value)`: 環境光の強さを設定する
- `setSpecular(value)`: 鏡面反射の強さを設定する
- `setSpecularPower(value)`: Phong式で反射方向と視線方向の内積へ適用する鏡面指数を設定する
- `setAlpha(value)`: 0から1の描画透明度を設定する。`color[3]`のtexture混合率とは別の値
- `setRoughness(value)`: 0.04から1の表面粗さを設定する。透明用シェーダーでは背景ぼけとPhong型Specularの幅へ反映する
- `setEmissive(value)`: 発光成分の強さを設定する
- `setHasBone(flag)`: スキニング経路を使うかを切り替える
- `useTexture(flag)`: カラーテクスチャを使うかを切り替える
- `setWeightDebug(flag)`: ボーンウェイトのRGB可視化を切り替える
- `useNormalMap(flag)`: 法線 map を使うかを切り替える
- `setNormalStrength(value)`: 法線 map の効きの強さを設定する
- `setFlatShading(flag)`: 補間頂点法線ではなく面法線を使う flat shading を切り替える
- `setFogColor(color)`: フォグ色を設定する
- `setFogNear(value)`: 線形フォグの開始距離を設定する
- `setFogFar(value)`: 線形フォグの終了距離を設定する
- `setFogDensity(value)`: exponential フォグの密度を設定する
- `setFogMode(value)`: フォグモードを設定する
- `setUseFog(flag)`: フォグの有効 / 無効を切り替える
- `setBackfaceDebug(flag)`: 裏面デバッグ表示を切り替える
- `setBackfaceColor(color)`: 裏面デバッグ色を設定する
- `setTextureUnit(texUnit)`: 現在は描画状態を変更しない予約メソッド
- `setMatrixPalette(matrixPalette)`: ボーンパレットをシェーダーへ渡す
- `updateTexture(texture)`: 形状側から渡されたテクスチャを現在のバインドグループへ反映する
- `doParameter(param)`: `shape.shaderParameter()` や `shape.setMaterial()` で渡した値をまとめて反映する
- `setDefaultParam(param)`: 既定パラメータを差し替える

### `GlassMaskShader`
`GlassMaskShader` は、`FrostedGlassPass` のマスク描画先へガラス領域を書き込むための専用シェーダーです。
通常の質感描画ではなく、マスクのRGBと alpha を合成パスへ渡す役割を持ちます。

- `constructor(gpu, options = {})`: マスクシェーダーの描画先形式、深度 compare、cull モードなどを初期化する
- `setProjectionMatrix(m)`: 投影行列をユニフォームへ設定する
- `setModelViewMatrix(m)`: モデル-ビュー行列をユニフォームへ設定する
- `setNormalMatrix(m)`: `Shape.draw()` から法線行列を受け取る入口
- `setColor(color)`: マスク描画先へ書くRGB tint と alpha 強度を設定する
- `doParameter(param = {})`: `color` または `mask_color` をシェーダーユニフォームへ反映する

### `BillboardShader`
`BillboardShader` は、常にカメラに向く quad 表現の基盤です。

- `constructor(gpu)`: ビルボード用シェーダー状態を初期化する
- `createResources()`: ビルボード描画に必要なリソースを作る
- `createDefaultTexture()`: 既定のビルボードテクスチャを作る
- `getBindGroup(texture)`: 指定テクスチャ用バインドグループを返す
- `setProjectionMatrix(m)`: 投影行列を設定する
- `setViewMatrix(m)`: ビュー行列を設定する
- `setCameraAxes(right, up)`: カメラの right / up 軸を設定する
- `setOpacity(alpha)`: ビルボードの透明度を設定する

## 2. ジオメトリ / シーングラフ

`Shape`、`CoordinateSystem`、`Node`、`Space` は、`webg` のシーングラフの中心です。

`Shape` は geometry とマテリアル、`Node` は階層、`Space` は node 木全体、`Skeleton` は骨階層の管理を担当します。

### `Shape`
`Shape`は、頂点、三角形、法線、UV、スキンウェイト、材質、シェーダーの入り口です。
`Primitive`や`ModelBuilder`の構築結果が最終的にここへ入ります。

- `constructor(gpu)`: 形状用のGPU状態と配列を初期化する
- `setName(name)`: 形状名を設定する
- `getName()`: 形状名を返す
- `setAutoCalcNormals(flag)`: 法線の自動計算の有効・無効を切り替える
- `setAnimation(anim)`: 形状に紐づくアニメーションを設定する
- `getAnimation()`: 紐づいたアニメーションを返す
- `getVertexCount()`: 頂点数を返す
- `getTriangleCount()`: 三角形数を返す
- `shaderParameter(key, value)`: 形状の`shaderParameter`を設定する
- `setMaterial(materialId, params = {})`: 材質IDとシェーダーの`params`を設定する
- `setMaterialAt(index, materialId, params = {})`: 0から連続する材質スロットへ材質を設定する。スロットを飛ばした登録は拒否する
- `updateMaterial(params = {})`: 既存マテリアルに対する差分更新を行う
- `updateMaterialAt(index, params = {})`: 指定した材質スロットの`params`を差分更新する
- `getMaterial()`: 現在のマテリアル情報を返す
- `getMaterialAt(index)`: 指定した材質スロットのIDと`params`の複製を返す
- `getMaterialCount()`: 登録済みの材質スロット数を返す
- `getMaterialAlpha(index = 0)`: 指定したスロットの`alpha`を検証して返す。省略時は1.0
- `setShader(shader)`: 形状が使うシェーダーを設定する
- `setTexture(texture)`: テクスチャを設定する
- `setTextureMappingMode(mode)`: テクスチャマッピング方式を設定する
- `setTextureMappingAxis(axis)`: テクスチャマッピング軸を設定する
- `setTextureScale(scale_u, scale_v)`: テクスチャのスケールを設定する
- `setWireframe(flag = true)`: ワイヤーフレーム表示を切り替える
- `isWireframe()`: ワイヤーフレーム状態を返す
- `setSkeleton(skeleton)`: スキニングに使うスケルトンを設定する
- `getSkeleton()`: スケルトンを返す
- `hide(true_or_false)`: 形状の表示 / 非表示を切り替える
- `endShape()`: 頂点バッファを確定してGPUへ送る。自動法線はここで正規化するが、`setAutoCalcNormals(false)`で指定した手動法線は正規化しない
- `draw(modelview, normal, options = {})`: 現在のシェーダーで描画する。通常は`Space.draw()`から呼ばれ、材質、半透明用パイプライン、インデックス範囲などの内部指定は`options`で受け取る
- `drawMaterial(modelview, normal, materialIndex, options = {})`: 指定した材質スロットに属する三角形、または`options.triangleIndex`で指定した1三角形を描画する
- `drawOpaqueMaterials(modelview, normal, options = {})`: `alpha === 1.0`の材質スロットだけを深度書き込み可能な描画へ送る
- `collectTranslucentTriangles(modelview, normal, queue, options = {})`: `alpha < 1.0`の三角形とビュー空間の重心深度を透明描画キューへ追加する
- `releaseObjects()`: CPU側の頂点配列や補助配列を空にする
- `destroy(options = {})`: 形状インスタンスを終了し、必要に応じて共有リソースの破棄へつなげる
- `setVertex(x, y, z)`: 現在頂点を書き込む
- `addVertex(x, y, z)`: 頂点を追加する
- `addVertexUV(x, y, z, u, v)`: 頂点とUVを追加する
- `addVertexPosUV(pos, uv)`: 位置とUVの対を追加する
- `setVertNormal(vn, x, y, z)`: 指定頂点の法線を設定する。手動法線として使う場合は有限な単位ベクトルを渡す
- `getVertNormal(vn)`: 指定頂点の法線を返す
- `getVertPosition(vn)`: 指定頂点の位置を返す
- `addVertexWeight(vn, ind, wt)`: スキンウェイトを追加する
- `addTriangle(p0, p1, p2, materialIndex = 0)`: 3頂点で三角形を作り、使用する材質スロット番号を記録する。自動法線では面法線を蓄積してUVの継ぎ目で共有し、手動法線では継ぎ目の複製頂点へ元法線をコピーして再合算しない
- `addPolygon(indices, materialIndex = 0)`: 多角形を追加し、分割した三角形へ同じ材質スロット番号を設定する。ワイヤーフレーム用には元の辺ループも保持する
- `addPlane(indices, materialIndex = 0)`: 既存API名を維持した`addPolygon()`の別名
- `setTriangleMaterial(triangleIndex, materialIndex)`: `endShape()`前の三角形へ材質スロット番号を割り当て直す
- `getPrimitiveOptions()`: Primitive 生成時の既定オプションを返す
- `applyPrimitiveAsset(asset)`: Primitive 由来アセットを形状に流し込む

### `CoordinateSystem`
`CoordinateSystem`は、位置、姿勢、親子関係、行列変換の基底です。
`Node`などのシーングラフ要素の土台になります。

- `constructor(parent_node, name)`: 親子関係付きの座標系を初期化する
- `print(str, q, pos)`: 姿勢と位置をデバッグ出力する
- `printMoveRange()`: 補間用の開始 / 終了情報を出力する
- `setType(type)`: 種類識別子を設定する
- `getType()`: 種類識別子を返す
- `setName(name)`: node 名を設定する
- `getName()`: node 名を返す
- `setParent(parent)`: 親 node を設定する
- `getParent()`: 親 node を返す
- `addChild(child)`: 子 node を追加する
- `getNoOfChildren()`: 子の数を返す
- `getChild(n)`: 指定インデックスの子を返す
- `setAttitude(yaw, pitch, roll)`: yaw / pitch / roll で姿勢を設定する
- `getWorldAttitude()`: ワールド space の姿勢を返す
- `getLocalAttitude()`: local space の姿勢を返す
- `getWorldPosition()`: ワールド space の位置を返す
- `getPosition()`: local position を返す
- `setPosition(x, y, z)`: position を設定する
- `setPositionX(x)`: X位置だけを設定する
- `setPositionY(y)`: Y位置だけを設定する
- `setPositionZ(z)`: Z位置だけを設定する
- `getScale()`: ローカルの一様拡大縮小率を返す
- `setScale(scale)`: ローカルの一様拡大縮小率を設定する
- `rotateX(degree)`: X軸回転を加える
- `rotateY(degree)`: Y軸回転を加える
- `rotateZ(degree)`: Z軸回転を加える
- `rotate(yaw, pitch, roll)`: yaw / pitch / roll で回転を加える
- `move(x, y, z)`: 位置を相対移動する
- `composeMatrixFromState(matrix, quat, position, scale = 1.0)`: TRSから local 行列を合成する
- `getRigidMatrix(matrix)`: 一様拡大縮小を除いた剛体行列を返す
- `decomposeMatrixTransform(matrix)`: 行列を位置、クォータニオン、一様拡大縮小率に分解する
- `setMatrix()`: local 行列を再計算する
- `setWorldMatrix()`: ワールド行列を再計算する
- `setWorldMatrixAll(wmat)`: 子孫も含めてワールド行列を更新する
- `getWorldMatrix()`: ワールド行列を返す
- `setByMatrix(matrix)`: 行列から姿勢と位置を設定する
- `setQuat(quat)`: クォータニオンから姿勢を設定する
- `getQuat()`: 現在のクォータニオンを返す
- `getQuatFromMatrix()`: 現在行列からクォータニオンを算出する
- `getPositionFromMatrix()`: 現在行列から position を抽出する
- `detach()`: 親から切り離す
- `attach(parent_node)`: 親へ接続する
- `inverse(new_parent)`: 新しい親に対する inverse を作る
- `distance(node)`: 2 node 間距離を返す
- `putRotation(yaw, pitch, roll)`: 補間用の相対回転を設定する
- `putRotationByQuat(quat)`: 補間用の相対クォータニオン回転を設定する
- `putAttitudeByQuat(quat)`: 補間用の絶対クォータニオン姿勢を設定する
- `putAttitude(yaw, pitch, roll)`: 補間用の絶対 Euler 姿勢を設定する
- `putDistance(x, y, z)`: 補間用の移動差分を設定する
- `putRotTrans(quat, pos)`: 補間用の回転と移動を同時設定する
- `putRotTransByMatrix(matrix)`: 行列から補間用の回転と移動を設定する
- `putMatrixByMatrix(matrix)`: 行列補間用の開始 / 終了行列を設定する
- `execRotation(t)`: 補間率で回転を適用する
- `execTranslation(t)`: 補間率で移動を適用する
- `doRotation(t)`: `execRotation()` 後に行列を更新する
- `doTranslation(t)`: `execTranslation()` 後に行列を更新する
- `doRotTrans(t)`: 回転と移動を同時に補間適用する
- `doMatrix(t)`: 行列補間を適用する

### `Node`
`Node` は `CoordinateSystem` に形状とスキニング関連を足したものです。
`Space.addNode()` の返り値として最もよく触ります。

- `constructor(parent_bone, name)`: 親ボーンを持つ node を初期化する
- `setParent(parent)`: 親 node を設定する
- `hide(true_or_false)`: node 配下形状の表示を切り替える
- `setAttachable(true_or_false)`: 取り付け可否を設定する
- `setWeights()`: この node がウェイトを持つことを記録する
- `detach()`: 親から切り離す
- `attach(parent_node)`: 指定親へ接続する
- `setRestPosition(x, y, z)`: rest position を設定する
- `setRestByMatrix(matrix)`: rest 行列を設定する
- `rotateRest(yaw, pitch, roll)`: rest 姿勢へ回転を加える
- `moveRest(x, y, z)`: rest 位置へ local 移動を加える
- `animatePosition(to, options = {})`: local position を補間処理で補間する
- `updateAnimatedPosition(deltaMs = 0)`: position 補間処理を進める
- `clearAnimatedPosition()`: position 補間処理を消す
- `animateRotation(to, options = {})`: local rotation を補間処理で補間する
- `updateAnimatedRotation(deltaMs = 0)`: rotation 補間処理を進める
- `clearAnimatedRotation()`: rotation 補間処理を消す
- `setRestMatrix()`: rest 行列を再計算する
- `setModelMatrixAll(mmat)`: モデル行列を子孫込みで更新する
- `setGlobalMatrixAll(wmat)`: global 行列を子孫込みで更新する
- `getRestMatrix()`: rest 行列を返す
- `getModelMatrix()`: モデル行列を返す
- `getBofMatrix()`: ボーンオフセット行列を返す
- `getGlobalMatrix()`: global 行列を返す
- `addShape(shape)`: 形状を node に追加する
- `delShape()`: 形状を外す
- `setShape(shape)`: node の形状を置き換える
- `getShape(n)`: n 番目の形状を返す
- `getShapeCount()`: 形状数を返す
- `draw(view_matrix, light_vec, count)`: node を描画する
- `drawBones()`: ボーン可視化を描画する

### `Space`
`Space` は node 木の管理と描画の入口です。
`draw(eyeOrFrame)`が標準の入口であり、webg 1.0互換経路では`setEye(eye)`の後に引数なしの`draw()`も使用できます。

- `constructor()`: シーングラフの root と時間管理を初期化する
- `addNode(parent_node, name)`: 親 node の下に新しい node を作る
- `addPhysicsNode(parent_node, name, options = {})`: 親 node の下に `PhysicsNode` を作る
- `delNode(name)`: node を削除する
- `removeNode(node, options = {})`: node 1個をシーン graph から外す
- `removeNodeTree(node, options = {})`: node subtree 全体をシーン graph から外し、必要なら配下形状も終了する
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
- `setEye(node)`: webg 1.0互換経路で引数なしの`draw()`が使う既定の視点ノードを設定する
- `hasTranslucentTriangles()`: 可視Shapeに`alpha`が1.0未満の三角形があるか、GPU描画前に判定する
- `draw(eyeOrFrame, options = {})`: `eye`ノード、完全なカメラフレーム、または登録済み`renderFrameToken`からカメラ相対モデルビュー行列を作ってノードツリーを描画する。引数を省略した場合は`setEye()`で設定した既定の視点を使用し、既定の視点もなければ例外で停止する。通常の低水準描画は`eye`、手動深度共有はトークンを使う。`options.filter({ node, shape, index })`で描画対象を選別できる
- `drawBones()`: 全ボーンを描画する
- `raycast(origin, dir, { firstHit = true, filter } = {})`: レイキャストを実行する
- `checkCollisions({ firstHit = false, filter, includeHidden = false } = {})`: 衝突判定を行う
- `checkCollisionsDetailed(options = {})`: 詳細な衝突判定結果を返す
- `updateCollisionEvents(options = {})`: 衝突イベント状態を更新する

### `PhysicsNode`
`PhysicsNode` は、`Node` を継承した物理ノードです。
シーン graph と描画ノードの構造を保ったまま、`bodyType`、質量、速度、sleep、コライダー参照をまとめて持たせるための入口として使います。

現行の設計では、`PhysicsNode` 自身は「1個の物体の状態」を保持し、複数物体の接触解決や跳ね返りは `PhysicsSpace` 側で扱います。
`dynamic` 中の transform 直接変更は許可せず、位置を変えたいときは `teleport()` を使うか、いったん `kinematic` へ切り替えてから操作する前提です。

- `constructor(parent_node, name, options = {})`: `bodyType`、質量、速度、減衰、sleep 設定を持つ物理ノードを作る
- `getBodyType()`: 現在の `bodyType` を返す
- `isStatic()`: `static` かどうかを返す
- `isKinematic()`: `kinematic` かどうかを返す
- `isDynamic()`: `dynamic` かどうかを返す
- `setBodyType(type, options = {})`: `static / kinematic / dynamic` を切り替える
- `pauseDynamic(options = {})`: `dynamic` を一時停止して `kinematic` へ切り替える
- `resumeDynamic(options = {})`: 一時停止中の `dynamic` を復帰させる
- `setMass(mass)`: 質量を設定する
- `getMass()`: 質量を返す
- `getInverseMass()`: 逆質量を返す
- `setInertia(inertia)`: local diagonal inertia を手動設定する
- `resetInertia()`: コライダーと質量から自動計算する inertia へ戻す
- `getInertia()`: local diagonal inertia を返す
- `getInverseInertia()`: local diagonal inverse inertia を返す
- `setGravityScale(scale)`: 重力係数を設定する
- `getGravityScale()`: 重力係数を返す
- `setLinearDamping(damping)`: 線形減衰を設定する
- `getLinearDamping()`: 線形減衰を返す
- `setAngularDamping(damping)`: 角減衰を設定する
- `getAngularDamping()`: 角減衰を返す
- `setAllowSleep(enabled)`: sleep を許可するか設定する
- `getAllowSleep()`: sleep 許可状態を返す
- `setTrigger(enabled)`: トリガー扱いにするか設定する
- `getTrigger()`: トリガー状態を返す
- `setFixedRotation(enabled)`: 回転固定を設定する
- `getFixedRotation()`: 回転固定状態を返す
- `setCollisionLayer(layer)`: collision レイヤー bitmask を設定する
- `getCollisionLayer()`: collision レイヤー bitmask を返す
- `setCollisionMask(mask)`: 接触対象にするレイヤー bitmask を設定する
- `getCollisionMask()`: collision マスク bitmask を返す
- `canCollideWith(otherBody)`: 双方のレイヤー / マスクが一致し、接触候補にできるかを返す
- `setCollider(collider)`: コライダー参照を保持する
- `getCollider()`: コライダー参照を返す
- `setPhysicsMaterial(material)`: 物理材質参照を保持する
- `getPhysicsMaterial()`: 物理材質参照を返す
- `setPhysicsSpace(physicsSpace)`: 所属 `PhysicsSpace` 参照を設定する
- `getPhysicsSpace()`: 所属 `PhysicsSpace` 参照を返す
- `setLinearVelocity(x, y, z)`: 線形速度を設定する
- `setLinearVelocityVec(velocity)`: vec3で線形速度を設定する
- `getLinearVelocity()`: 線形速度を返す
- `setAngularVelocity(x, y, z)`: 角速度を設定する
- `setAngularVelocityVec(angularVelocity)`: vec3で角速度を設定する
- `getAngularVelocity()`: 角速度を返す
- `applyForce(force)`: force accumulator へ加算する
- `getForce()`: 現在の force accumulator を返す
- `applyImpulse(impulse)`: 線形 impulse を加えて速度を変える
- `applyTorque(torque)`: torque accumulator へ加算する
- `applyAngularImpulse(impulse)`: local diagonal inverse inertia を使って角 impulse を角速度へ反映する
- `getTorque()`: 現在の torque accumulator を返す
- `clearForce()`: force accumulator を消す
- `clearTorque()`: torque accumulator を消す
- `clearAccumulators()`: force / torque accumulator をまとめて消す
- `stopMotion()`: 線形速度、角速度、accumulator を 0に戻す
- `wakeUp()`: sleeping を解除する
- `sleep()`: sleeping 状態へ入れる
- `getSleeping()`: sleeping 状態を返す
- `teleport(position, options = {})`: 物理状態を保ったまま指定位置へ移す
- `syncNodeFromPhysics(position, options = {})`: 物理更新結果を node の位置と姿勢へ反映する
- `syncPhysicsFromNode()`: node 側の位置、姿勢、速度、`bodyType` を物理側へ渡しやすい形で返す

### `PhysicsSpace`
`PhysicsSpace` は、複数の `PhysicsNode` をまとめて進める物理空間です。
固定タイムステップ、重力、平面コライダーとボックスコライダーの接触解決、ボックス-ボックスのOBB接触解決、反発、摩擦、sleep 判定、接触 begin / stay / end の記録、および各段階のリスナー通知までを扱います。
`PhysicsNode` がトリガーに設定されている場合は、接触自体は検出してイベント / リスナーに流しますが、押し戻しと速度反発は行いません。
問い合わせ系としては、同じコライダー情報を使う `raycast()`、`raycastAll()`、`queryAabb()`、`overlapSphere()` も備えています。

立方体同士の衝突や跳ね返りは `PhysicsNode` ではなく `PhysicsSpace.step()` の内部で解決します。
平面コライダーに対する着地や滑り、平面 / ボックス / 球 / カプセルコライダーに対する物理レイキャスト、AABB範囲問い合わせ、球範囲問い合わせもここで扱います。
`raycast()` は最短 1件、`raycastAll()` は距離順の全ヒットを返します。
ボックスはボディのクォータニオン姿勢を反映したOBBとして詳細判定 / 問い合わせ / レイキャストに参加し、広域判定では外接AABBを使います。
将来的にジョイントを追加するとしても、その処理はここへ集約する前提です。

- `constructor(options = {})`: gravity、fixed timestep、solver 回数、sleep 閾値を持つ物理空間を作る
- `setGravity(gravity)`: 重力ベクトルを設定する
- `getGravity()`: 重力ベクトルを返す
- `setFixedTimeStepMs(value)`: fixed timestep を設定する
- `getFixedTimeStepMs()`: fixed timestep を返す
- `setMaxSubSteps(value)`: 1フレームあたりの最大 sub 間隔数を設定する
- `getMaxSubSteps()`: 1フレームあたりの最大 sub 間隔数を返す
- `setSolverIterations(value)`: 接触 solver の反復回数を設定する
- `getSolverIterations()`: 接触 solver の反復回数を返す
- `setBroadphaseMode(mode)`: 広域判定モードを `"sweepAabb"` または `"bruteForce"` に設定する
- `getBroadphaseMode()`: 広域判定モードを返す
- `setDefaultRestitution(value)`: 既定反発係数を設定する
- `getDefaultRestitution()`: 既定反発係数を返す
- `setDefaultFriction(value)`: 既定摩擦係数を設定する
- `getDefaultFriction()`: 既定摩擦係数を返す
- `setSleepLinearThreshold(value)`: sleep に入れる速度しきい値を設定する
- `getSleepLinearThreshold()`: sleep に入れる速度しきい値を返す
- `setSleepAngularThreshold(value)`: sleep に入れる角速度しきい値を設定する
- `getSleepAngularThreshold()`: sleep に入れる角速度しきい値を返す
- `setSleepStepsThreshold(value)`: sleep に入るまでに必要な連続低速接触間隔数を設定する
- `getSleepStepsThreshold()`: sleep に入るまでに必要な連続低速接触間隔数を返す
- `resetAccumulator()`: accumulator を 0に戻す
- `getAccumulatorMs()`: 現在の accumulator を返す
- `addBody(body)`: `PhysicsNode` を physics space へ登録する
- `removeBody(body)`: `PhysicsNode` を physics space から外す
- `getBodies()`: 現在登録されているボディ一覧を返す
- `getLastContacts()`: 直近の fixed 間隔全体で解決した接触一覧を返す
- `getLastContactEvents()`: 直近の fixed 間隔における接触開始、継続、終了を `begin / stay / end` で返す
- `onBeginContact(listener)`: 接触開始時のリスナーを登録する
- `onStayContact(listener)`: 接触継続時のリスナーを登録する
- `onEndContact(listener)`: 接触終了時のリスナーを登録する
- `offBeginContact(listener)`: 接触開始リスナーを解除する
- `offStayContact(listener)`: 接触継続リスナーを解除する
- `offEndContact(listener)`: 接触終了リスナーを解除する
- `raycast(origin, dir, options = {})`: 平面 / ボックス / 球 / カプセルコライダーに対する最短ヒットを返す。`layerMask` で対象レイヤーを絞れ、`triggerOnly` でトリガーボディだけを対象にできる
- `raycastAll(origin, dir, options = {})`: 平面 / ボックス / 球 / カプセルコライダーに対する全ヒットを距離順で返す。`layerMask` で対象レイヤーを絞れ、`triggerOnly` でトリガーボディだけを対象にできる
- `queryAabb(min, max, options = {})`: physics space AABBと重なるAABB対応コライダー一覧を返す。`layerMask` で対象レイヤーを絞れ、`triggerOnly` でトリガーボディだけを対象にできる
- `overlapSphere(center, radius, options = {})`: 球と重なるコライダー一覧を返す。`layerMask` で対象レイヤーを絞れ、`triggerOnly` でトリガーボディだけを対象にできる
- `step(deltaMs)`: 可変 delta を内部 accumulator へ積み、必要回数だけ fixed 間隔を進める
- `stepFixed(dtSec)`: 1回分の固定 timestep で重力、接触解決、摩擦、sleep 判定まで進める

### コライダーと各形状クラス
`Collider` は、`PhysicsNode` に設定する物理判定形状の基底クラスです。
`PhysicsSpace` はコライダーの `getBroadphaseKind()`、`canBroadphasePairWith()`、`buildContactWith()`、`intersectRay()`、`overlapsAabb()`、`overlapSphere()` を通じて、形状ごとの広域判定 / 詳細判定 / 問い合わせ / レイキャストをディスパッチします。

- `Collider(type, options = {})`: コライダー種別と `offset` を持つ基底コライダーを作る
- `getWorldPosition(position, quat = null)`: ボディ位置と `offset` からコライダーのワールド位置を返す。`quat` を渡した場合はオフセットも姿勢に合わせて回す
- `getBroadphaseKind()`: 広域判定用の種別名を返す
- `canBroadphasePairWith(otherCollider)`: 広域判定候補にする相手コライダーかを返す
- `intersectRay(position, origin, dir, maxDistance = Infinity, quat = null)`: レイヒット情報、または `null` を返す
- `overlapsAabb(position, queryMin, queryMax, quat = null)`: 問い合わせAABBと重なるかを返す
- `getAabb(position, quat = null)`: コライダーのワールドAABB、または `null` を返す
- `overlapSphere(position, center, radius, quat = null)`: 球重なり情報、または `null` を返す
- `buildContactWith(position, otherCollider, otherPosition, bodyA, bodyB, quat = null, otherQuat = null)`: 相手コライダー型に応じた接触生成へディスパッチする

`BoxCollider(size, options = {})` はボディのクォータニオン姿勢を反映するOBBコライダーです。
広域判定では外接AABBを返し、ボックス-ボックス、平面-ボックス、球-ボックス、カプセル-ボックスの接触、レイ-ボックス、queryAabb、overlapSphere に対応します。

`PlaneCollider(normal, options = {})` は無限平面コライダーです。
平面-ボックス、平面-球、平面-カプセルの接触とレイ-平面に対応します。
AABBを持たないため、`queryAabb()` の結果には入りません。

`SphereCollider(radius, options = {})` は球コライダーです。
球-球、球-ボックス、平面-球、カプセル-球の接触、レイ-球、queryAabb、overlapSphere に対応します。

`CapsuleCollider(radius, segmentLength, options = {})` は y 軸方向のカプセルコライダーです。
カプセル-カプセル、カプセル-球、カプセル-ボックス、平面-カプセルの接触、レイ-カプセル、queryAabb、overlapSphere に対応します。

### `Skeleton`
`Skeleton` はボーン階層と行列パレットを管理します。
現行の skinned mesh 描画では `SmoothShader` のスキニング経路と組み合わせて使います。

- `constructor()`: ボーン階層とパレットを初期化する
- `clone()`: skeleton の複製を作る
- `addBone(parent_bone, name)`: ボーンを追加する
- `setBoneShape(shape)`: ボーン表示用形状を設定する
- `setAttachable(true_or_false)`: 取り付け可否を設定する
- `isAttachable()`: 取り付け可能か返す
- `isShown()`: ボーンが表示対象か返す
- `showBone(true_or_false)`: ボーン表示を切り替える
- `setBoneOrder(names)`: パレット順を設定する
- `getBoneOrder()`: パレット順を返す
- `getBoneNo(name)`: ボーン名からインデックスを返す
- `getBoneCount()`: ボーン数を返す
- `getBone(name)`: ボーンを名前で返す
- `getBoneFromJointNo(num)`: ジョイントインデックスからボーンを返す
- `getJointFromBone(bone)`: ボーンからジョイントを返す
- `getBoneNoFromBone(bone)`: ボーンからインデックスを返す
- `bindRestPose()`: rest pose を固定する
- `updateMatrixPalette()`: 行列パレットを更新する
- `listBones()`: ボーン一覧を返す
- `printMatrixPalette()`: パレット内容を出力する
- `drawBones()`: ボーンを可視化描画する

### `Billboard`
`Billboard` は、画面に向く小さな板を複数並べるときに使います。
シーン上に浮かせる注釈や marker を作りたいときにも向いています。

- `constructor(gpu, maxCount = 256)`: ビルボード群を初期化する
- `setTexture(texture)`: ビルボードに使うテクスチャを設定する
- `setOpacity(alpha)`: 透明度を設定する
- `clear()`: 登録済みビルボードを消す
- `addBillboard(x, y, z, sx, sy, color = [1.0, 1.0, 1.0, 1.0])`: ビルボードを 1個追加する
- `setPosition(index, x, y, z)`: 指定ビルボードの位置を変える
- `setScale(index, sx, sy)`: 指定ビルボードの大きさを変える
- `setColor(index, r, g, b, a)`: 指定ビルボードの色を変える
- `setCamera(eyeNode, projectionMatrix)`: カメラ参照を設定する
- `drawWithAxes(eyeNode, projectionMatrix, right, up)`: カメラ軸を指定して描く
- `draw(eyeNode, projectionMatrix)`: ビルボードを描画する
- `drawGround(eyeNode, projectionMatrix)`: 地面向けのビルボードを描画する

### `Primitive`
`Primitive` は、`cube`、`sphere`、`arrow` などの基本形状を `ModelAsset` として生成する static factory です。
`samples/model_shape`、`samples/scene`、`unittest/primitive_modelasset` でよく使います。

生成結果は `ModelAsset` なので、`Shape.applyPrimitiveAsset(asset)` へ渡すか、`ModelAsset.build(gpu)` でランタイム形状へ変換します。

- `static getOptions(options = {})`: UV mapping 用オプションを既定値込みで正規化する
- `static makeAsset(name, geometry)`: 単一 mesh / 単一 node の `ModelAsset` を作る
- `static makeRevolutionGeometry(latitude, longitude, verts, spherical, options = {})`: 回転体用 geometry オブジェクトを作る
- `static revolution(latitude, longitude, verts, spherical, options = {})`: 任意断面の回転体を `ModelAsset` として作る
- `static sphere(radius, latitude, longitude, options = {})`: 球を作る
- `static donut(radius, radiusTube, latitude, longitude, options = {})`: トーラスを作る
- `static cone(height, radius, n, options = {})`: 円錐を作る
- `static truncated_cone(height, radiusTop, radiusBottom, n, options = {})`: 切頭円錐を作る
- `static double_cone(height, radius, n, options = {})`: 双円錐を作る
- `static prism(height, radius, n, options = {})`: 角柱を作る
- `static arrow(length, head, width, n, options = {})`: 矢印形状を作る
- `static cuboid(size_x, size_y, size_z, options = {})`: 直方体を作る
- `static mapCuboid(size_x, size_y, size_z)`: UV展開済み直方体を作る
- `static cube(size, options = {})`: 立方体を作る
- `static mapCube(size)`: UV展開済み立方体を作る
- `static debugBone(a, options = {})`: ボーン診断表示向け形状を作る

### `Mesh`
`Mesh` は、`Frame` から展開される中間表現で、import 処理の参照先として使われます。

- `constructor(frame)`: フレーム由来の mesh を初期化する
- `setName(name)`: mesh 名を設定する
- `getName()`: mesh 名を返す
- `setVertices(verts)`: 頂点配列を設定する
- `getVertices()`: 頂点配列を返す
- `setPolygons(polygons)`: polygon 配列を設定する
- `getPolygons()`: polygon 配列を返す
- `setTextureCoord(texure_coord)`: UV配列を設定する
- `getTextureCoord()`: UV配列を返す
- `setSkinWeights(skin_weights)`: skin ウェイトを設定する
- `getSkinWeights()`: skin ウェイトを返す
- `setNormals(normals)`: 法線配列を設定する
- `getNormals()`: 法線配列を返す
- `setJointNames(joint_names)`: ジョイント名を設定する
- `getJointNames()`: ジョイント名を返す
- `setBindPoseMatrices(bindPoseMatrices)`: bind pose 行列を設定する
- `getBindPoseMatrices()`: bind pose 行列を返す
- `setBindShapeMatrix(bind_shape_matrix)`: bind 形状行列を設定する
- `getBindShapeMatrix()`: bind 形状行列を返す
- `setNodeMatrix(node_matrix)`: node 行列を設定する
- `getNodeMatrix()`: node 行列を返す
- `setMaterialId(id)`: マテリアル id を設定する
- `getMaterialId()`: マテリアル id を返す
- `updateBoundingBox(x, y, z)`: bounding ボックスを更新する
- `printInfo()`: mesh 情報を出力する

## 3. 数学 / 時間

`Matrix` と `Quat` は transform と補間の基盤です。
`Frame`、`Schedule`、`Task`、`Stack` はアニメーションやインポーターの内部補助で使われます。

### `Matrix`
- `constructor()`: 4x4行列の入れ物を作り、各要素を扱える状態にする
- `makeUnit()`: 単位行列へ初期化する
- `makeZero()`: 全要素を 0にする
- `set(row, column, val)`: 指定した要素を書き換える
- `check()`: NaNを検出して assert する
- `setBulk(numtable)`: 配列の値をまとめて流し込む
- `setBulkWithOffset(numtable, offset)`: 配列の一部を指定オフセットから流し込む
- `get(row, column)`: 指定した要素を返す
- `clone()`: 同じ内容の新しい `Matrix` を返す
- `copyFrom(mat)`: 他の行列内容をそのままコピーする
- `setByQuat(quat)`: クォータニオンから回転行列を作る
- `setByEulerXYZ(rx, ry, rz)`: XYZ順の Euler 角から行列を作る
- `matToEulerXYZ()`: XYZ順 Euler 角へ変換する
- `setByEuler(yaw, pitch, roll)`: yaw / pitch / roll から行列を作る
- `matToEuler()`: yaw / pitch / roll へ変換する
- `position(position)`: 平行移動成分を設定する
- `getPosition()`: 平行移動成分を返す
- `getAxisScale()`: 各ローカル軸の拡大縮小率を返す
- `getUniformScale(epsilon = 1.0e-4)`: 一様拡大縮小なら倍率を返し、非一様なら`null`を返す
- `applyUniformScale(scale)`: 3x3回転部分へ一様拡大縮小率を掛ける
- `removeUniformScale(scale)`: 一様拡大縮小を除いた行列を返す
- `add(mb)`: 行列加算を行う
- `mul(mb)`: 右側の行列を掛ける
- `lmul(mb)`: 左側の行列を掛ける
- `makeProjectionMatrix(near, far, vfov, ratio, depthConvention?)`: 縦FOVベースの投影行列を作る。4引数の公開形式はカメラ用Reverse-Z。シャドウマップは第5引数へ`SHADOW_STANDARD_Z`を明示する
- `makeProjectionMatrixWH(near, far, width, height, depthConvention?)`: 幅と高さから投影行列を作る。4引数はカメラ用Reverse-Z
- `makeProjectionMatrixOrtho(near, far, width, height, depthConvention?)`: 正射影行列を作る。4引数はカメラ用Reverse-Z
- `inverse()`: 逆行列を作る
- `inverse_strict()`: 逆行列を作り、失敗時は false を返す
- `transpose()`: 転置行列を作る
- `makeView(w)`: 視点から見るビュー行列を作る
- `mulVector(v)`: 4次元ベクトルを掛ける
- `mul3x3Vector(v)`: 3x3部分だけを使ってベクトルを掛ける
- `tmul3x3Vector(v)`: 3x3部分の転置を使ってベクトルを掛ける
- `print(f)`: 行列を出力する
- `sprint(out, f)`: 行列の文字列表現を作る
- `print_verbose(f)`: 拡大縮小率とオイラー角も含めて出力する

### `Quat`
- `constructor()`: 単位クォータニオンを作る
- `mulQuat(qb)`: 右側のクォータニオンを掛ける
- `lmulQuat(qb)`: 左側のクォータニオンを掛ける
- `conjugate()`: 共役クォータニオンを返す
- `normalize()`: 長さを 1にそろえる
- `setRotateX(degree)`: X軸回転クォータニオンを作る
- `setRotateY(degree)`: Y軸回転クォータニオンを作る
- `setRotateZ(degree)`: Z軸回転クォータニオンを作る
- `eulerToQuat(yaw, pitch, roll)`: Euler 角をクォータニオンに変換する
- `dotProduct(qr)`: 2つのクォータニオンの内積を返す
- `negate()`: 符号反転したクォータニオンを返す
- `slerp(a, b, t)`: 2つのクォータニオンを球面線形補間する
- `matrixToQuat(m)`: 行列からクォータニオンを復元する
- `print()`: クォータニオンを出力する
- `quatToEuler()`: クォータニオンから Euler 角を返す
- `clone()`: 同じ内容の新しいクォータニオンを返す
- `copyFrom(quat)`: 他のクォータニオンをコピーする
- `check()`: NaNを検出して assert する

### `Frame`
`Frame` は Collada の骨階層やジョイント解析の補助で使われます。

- `constructor(parent, name, sid = null, display_name = null)`: 親子関係を持つ解析用フレームを作る
- `setByMatrix(matrix)`: 行列からフレームの姿勢を設定する
- `setWeights()`: 解析済みウェイト情報を整える
- `setType(type_name)`: フレーム種別を設定する
- `getType()`: フレーム種別を返す
- `getName()`: フレーム名を返す
- `getCandidateNames()`: ジョイント名候補の一覧を返す
- `matchesName(name)`: 指定名に一致するかを判定する
- `resolveJointName(names)`: 候補名の中からジョイント名を解決する
- `findFrame(name)`: 子孫からフレームを検索する
- `getNoOfBones(names)`: 関連ボーン数を数える
- `findChildFrames(names)`: 子孫フレームを集める
- `getFramesFromNames(joint_names)`: ジョイント名一覧からフレーム群を返す
- `copyToBone(...)`: フレームの内容をボーンへ転写する
- `list(level, out)`: 階層を 1層分たどって内容を並べる
- `listAll(level, out)`: 子孫を含めて一覧化する

### `FrameTimer`
`FrameTimer` は JavaScript フレーム時間と、利用可能な場合のGPUタイムスタンプ問い合わせを集計します。
通常は `WebgApp({ frameTiming: true })` を通じて利用します。

- `constructor(device, options = {})`: 時刻対応、平均化区間、問い合わせリソースを初期化する
- `beginFrame(frameIntervalMs)` / `endFrame()`: 1フレームのCPU側計測範囲を管理する
- `beginGpuTiming()` / `endGpuTiming(encoder)`: GPU問い合わせの記録と resolve を管理する
- `getGpuTimestampWrites()` / `getGpuRenderTimestampWrites()`: コンピュート / 描画パスへ渡す時刻 descriptor を返す
- `afterSubmit()`: submit 後に利用可能な問い合わせ結果を読み、移動平均へ反映する
- `getDisplayLines()`: HUD向けの timing 行を返す

### `Schedule`
`Schedule` はアニメーションのコマンドキューです。
`Animation` と `Task` の内部で使われます。

- `constructor(name)`: コマンド待ち行列の名前付き入れ物を作る
- `addTask(name)`: 新しいタスクを追加する
- `delTask(task)`: 指定タスクを削除する
- `getEmptyTask()`: 空のタスクを返す
- `getNoOfTasks()`: タスク数を返す
- `getTask(n)`: インデックス指定でタスクを返す
- `getTaskByName(name)`: 名前からタスクを返す
- `pause()`: 実行を一時停止する
- `start()`: 先頭から再生する
- `startFrom(start_ip)`: 指定位置から再生する
- `startFromTo(start_ip, stop_ip)`: 範囲を指定して再生する
- `doCommandFps(frame_per_sec)`: FPS基準でコマンドを進める
- `doCommand()`: 1回分のコマンドを実行する
- `doOneCommand(ip, rate)`: 指定コマンドを 1ステップ進める
- `directExecution(time, command, args, start_ip, stop_ip)`: 時間指定でコマンドを直接実行する
- `setSpeed(time_scale)`: 実行速度を変更する

### `Task`
- `constructor(name, no)`: タスク名と番号を持つコマンド実行単位を作る
- `setTargetObject(target)`: コマンドの対象オブジェクトを設定する
- `addCommand(cmd)`: コマンドを末尾へ追加する
- `setTime(ip, time)`: コマンドインデックスごとの時間を設定する
- `getTime(ip)`: 指定コマンドの時間を返す
- `getName()`: タスク名を返す
- `getNoOfCommands()`: コマンド数を返す
- `setCommand(command_table)`: コマンド table をまとめて設定する
- `partial_arg(arg, total_time, dtime)`: 時間比例で引数を補間する
- `controlCommand(command, arg)`: start / stop などの制御コマンドを処理する
- `execCommand(doarg)`: 1個のコマンドを実行する
- `getNextCommand()`: 次に実行するコマンドを返す
- `start()`: タスクを先頭から始める
- `startFrom(start_ip)`: 指定コマンド位置から始める
- `startFromTo(start_ip, stop_ip)`: 指定範囲で始める
- `execute(delta_msec)`: 経過時間を使ってタスクを進める
- `executeOneCommand(ip, arg_rate)`: 1コマンド分だけ進める
- `directExecution(command, doarg)`: 補間なしでコマンドを実行する
- `insertCurrentCommand(time, command, arg, start_ip, stop_ip)`: 現在コマンドを挿入する

### `Stack`
- `push(contents)`: 末尾へ要素を積む
- `pop()`: 末尾の要素を取り出す
- `top()`: 末尾の要素を参照する
- `count()`: 現在の要素数を返す

## 4. テクスチャ / 文字 / HUD / UI

ここは、3Dの上にテクスチャ、文字、操作ガイド、長文パネルを重ねるための層です。

`Texture` は画像や手続き生成の入口で、`Text` と `Message` はキャンバス上のHUDを作ります。

`OverlayPanel` と `DebugDock` はキャンバス外のDOMを使うUI層です。
ヘルプ、エラー、説明、ログの違いはクラス名ではなく `OverlayPanel` のオプションで表します。

### `Texture`
`Texture` は、単なる画像 wrapper ではなく、「画像をGPUテクスチャとして持つ」「procedural に生成する」「法線マップを派生させる」という複数の役割をまとめるクラスです。

`samples/shapes`、`samples/model_shape`、`samples/proctex`、`samples/sound` では、このクラスが見え方や素材生成の土台になっています。

- `constructor(gpu)`: テクスチャ / サンプラーを扱う基底 wrapper を作る
- `ensureTexture(width, height, format = "rgba8unorm", usage)`: 必要なテクスチャを確保する
- `setupTexture()`: 既定状態のテクスチャを準備する
- `setClamp()`: 端の画素を延長するサンプリングへ切り替える
- `setRepeat()`: repeat サンプリングに切り替える
- `readImageFromFile(textureFile)`: 画像ファイルを読み込んでテクスチャ化する
- `readNormalMapFromFile(textureFile)`: 法線マップ画像を読み込んでテクスチャ化する
- `makeNormalMapPixelsFromHeightMap(options = {})`: height map 画像から法線 map の画素配列を作る
- `buildNormalMapFromHeightMap(options = {})`: 現在の height map テクスチャから法線 map テクスチャを作る
- `readNormalMapFromHeightFile(heightMapFile, options = {})`: height map ファイルを読んで法線 map テクスチャを作る
- `setImage(image, width, height, ncol)`: 画像データをテクスチャへ流し込む
- `writeImageToFile()`: 現在のテクスチャ画像を書き出す
- `createTexture(width, height, ncol, usage)`: 新しいテクスチャを作る
- `fillTexture(r, g, b, a)`: 単色でテクスチャを埋める
- `point(x, y, color)`: 1ピクセルだけを書き換える
- `assignTexture()`: 現在のテクスチャを描画用に割り当てる
- `name()`: テクスチャ名を返す
- `active()`: 現在のテクスチャが有効かを返す
- `getView()`: ビューを返す
- `getSampler()`: サンプラーを返す
- `makeProceduralHeightMapPixels(options = {})`: 手続き的な height map 画素配列を作る
- `buildProceduralHeightMap(options = {})`: 高さマップを手続き的に作る
- `buildNormalMapFromProceduralHeight(options = {})`: 手続き的 height map から法線 map テクスチャを作る
- `makeProceduralBillboardTexturePixels(options = {})`: ビルボード用の手続き的画素配列を作る
- `buildProceduralBillboardTexture(options = {})`: ビルボード用の手続き的テクスチャを作る

### `Font`
`Font` はテキスト用シェーダーとテクスチャをまとめる基礎です。

- `constructor(gpu)`: 文字描画用シェーダーの共通状態を作る
- `createResources()`: テキスト描画に必要なGPU資源を作る
- `createDefaultTexture()`: 既定の 1x1テクスチャを nearest サンプラー付きで作る
- `getBindGroup(texture)`: 指定 font テクスチャ用バインドグループを返す
- `setTextureUnit(texUnit)`: 現在は描画状態を変更しない予約メソッド
- `setChar(x, y, ch)`: 描画対象の文字セル位置と文字コードを設定する
- `setPos(x, y)`: 描画位置だけを更新する
- `setScale(scale)`: 文字サイズ倍率を設定する
- `setColor(r, g, b)`: 文字色を設定する
- `getScale()`: 現在の文字サイズ倍率を返す
- `setTexStep(u, v)`: atlas 1セル分のUV幅と高さを設定する
- `setFlipV(enable)`: V方向反転を切り替える
- `setTexelSize(u, v)`: atlas の 1 texel 分のUV幅と高さを設定する
- `setCellStep(x, y)`: 1文字セル分のNDC幅と高さを設定する
- `setCharAt(index, x, y, ch)`: 動的オフセット用ユニフォームインデックスへ文字情報を設定する
- `updateUniformsAt(index)`: 指定インデックスのユニフォームだけをGPUへ転送する

### `Text`
`Text` は 2Dの文字列を格子ベースで描くクラスです。

役割は「任意位置へASCII文字を並べること」で、`Message` の土台でもあります。

title、簡単なデバッグ文字列、最小HUDを自前で組みたいときに使いますが、通常のサンプルでは `Message` や `WebgApp` 補助機能の方が扱いやすいです。

- `constructor(gpu, options = {})`: 格子ベース文字描画の状態を作る
- `setGridSize(cols, rows)`: 文字グリッドの大きさを設定する
- `getGridSize()`: 文字グリッドの現在サイズを返す
- `getVisibleGridSize(scale = this.shader?.getScale?.() ?? 1.0)`: 画面に見えている格子サイズを返す
- `getLayoutInfo(scale = this.shader?.getScale?.() ?? 1.0)`: 格子と余白の配置情報を返す
- `goTo(x, y)`: カーソル位置を移動する
- `saveCursor()`: 現在のカーソル位置を退避する
- `restoreCursor()`: 退避したカーソル位置へ戻す
- `scrollUp()`: 1行上へスクロールする
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
- `makeShape()`: 文字描画用形状を作る
- `initFont()`: 既定 font を初期化する
- `getDefaultFontImage()`: 既定 font atlas 画像を返す
- `drawScreen()`: 現在の文字バッファを画面へ出す

### `Message`
`Message` はHUD / guide / status 表示を block 単位で扱うクラスです。
`WebgApp` と `SceneLoader` でよく使います。

`Text` よりハイレベルで、`id`、`anchor`、`block` の単位で配置できるため、START、SCORE、HIGH SCORES、短い result title、簡単な操作案内のような「短いASCII表示」をまとめやすくなります。

一方で、日本語や一般的なUTF-8文章を出す用途には向いていません。
その場合は `OverlayPanel` を使うのが標準です。

- `constructor(gpu, options = {})`: 文字HUD全体の状態を作る
- `setColor(r, g, b)`: 既定の文字色を設定する
- `normalizeColor(color = this.color)`: 色配列を描画向けに整える
- `resolvePosition(options = {})`: 表示位置を解決する
- `formatLines(lines, options = {})`: 行配列を表示用に整形する
- `alignLines(lines, options = {})`: 左寄せ / 中央 / 右寄せを整える
- `setLine(id, text, options = {})`: 1行分のメッセージを登録する
- `setLines(idPrefix, lines, options = {})`: 複数行を `idPrefix:0`, `idPrefix:1` ... として登録・更新する
- `setBlock(id, lines, options = {})`: 複数行ブロックを登録する
- `replaceAll(entries = [])`: 登録済み message を全置換する
- `remove(id)`: 指定 id の message を削除する
- `clear()`: 全 message を消す
- `setMessage(n, x, y, text)`: 番号指定の message を設定する
- `writeMessage(x, y, text)`: 指定位置へ message を書く
- `delMessage(n)`: 番号指定の message を削除する
- `clearMessages()`: message 群を消去する
- `listMessages()`: 登録済み message を一覧化する
- `getResolvedLines()`: 現在の表示内容を行配列で返す
- `drawScreen()`: HUDとして描画する

### 会話UIの扱い
会話、チュートリアル本文、選択肢のようなUI専用補助機能はコアから削除されています。

現在の方針では、UTF-8の本文やボタン付きパネルは`OverlayPanel`を使ってアプリケーションまたはサンプル側で組み立てます。

このため、コアのAPI一覧には会話専用クラスや会話専用メソッドを掲載しません。
文字表示と操作は、`Text`、`Message`、`OverlayPanel`、`DebugDock`を用途に応じて組み合わせます。

### HTMLパネル系
`OverlayPanel`、`CommandPalette`、`OverlayPanelPresets`、`DebugDock`、`WebgUiTheme` は、HTMLベースの補助UIを作る層です。

`OverlayPanel` はシーンの上に重ねるテキスト / ボタン / 選択肢パネルです。
ヘルプ、エラー、説明、ログはオプションで表します。
`CommandPalette` はキャンバス上で一時的に開くコマンド / 設定UIです。
`DebugDock` はPC向けの開発補助表示です。

`unittest/overlay_panel`、`unittest/embedded`、`unittest/theme`、`samples/com_palette` が代表例です。

- `DebugDock`: PCで操作部品、診断情報、診断採取状態をキャンバス外から読むための固定ドックです。`constructor()` でドックDOMと操作を準備し、`setRows()` で内容を差し替え、`clearRows()` で空にし、`setTheme()` で色を更新し、`isActive()` で表示条件を判定し、`ensure()` でDOMを作成し、`syncVisibility()` で開閉し、`update()` で本文を反映し、`formatText()` で表示文字列を整えます
- `OverlayPanel`: シーンの上に重ねるDOMパネルです。`constructor()` でパネルを作り、`update()` でオプションを差し替え、`show()` / `hide()` / `remove()` で表示を制御し、`setTheme()` で見た目を更新し、`setCollapsed()` で本文を畳み、`getState()` で状態を返します。`anchor`、`format`、`scrollY`、`buttons`、`choices`、`modal`、`pauseScene` などのオプションで用途を表します
- `CommandPalette`: キャンバス first なアプリで、ダブルクリック / ダブルタップ / キーボードから一時的に開くコマンドパレットです。`constructor()` でコマンド定義、コンテナ、表示領域、コールバック、`pageRows` を受け取り、`attachToCanvas()` で起動ジェスチャーを登録します。`open()` / `close()` / `toggle()` / `nextPage()` で表示を制御し、`setCommands()` でコマンド一覧を差し替え、`setStyle()` / `setTheme()` で見た目を変更し、`detach()` / `destroy()` でリスナーとDOMを破棄します
- `OverlayPanelPresets`: `buildHelpPanelOptions()` と`buildErrorPanelOptions()`で
  代表的なオプションオブジェクトを作ります。これは`WebgApp`の用途別窓口ではなく、
  必要なサンプルや書籍の例から明示的にimportする補助機能です
- `WebgUiTheme`: HTML UI一式の色、余白、border、シャドウを group 単位で差し替えるテーマ補助機能です。`DEFAULT_UI_THEME`、`DEFAULT_UI_LIGHT_THEME`、`DEFAULT_UI_SUNSET_THEME`、`DEFAULT_UI_FOREST_THEME` が既定 preset、`UI_THEME_PRESETS` が名前付きのまとめ、`mergeUiTheme()` が部分上書きの結合入口です

#### `CommandPalette`

- `constructor(options = {})`: `document`、`container`、`viewport`、`commands`、`title`、`className`、`pageRows`、`pageRowsByPage`、`onCommand`、`onChange`、`getCommandState`、`closeOnCommand`、`titleTapCyclesPage`、`resetPageOnOpen` などを受け取り、パレットDOMと既定スタイルを準備する。既定CSSの背景、枠、影を使う通常のパレットでは `className: "command-palette surface"` を指定する。`pageSize` は使用せず、行数指定の `pageRows` を使う。`titleTapCyclesPage` の既定値は `true`、`resetPageOnOpen` の既定値も `true`
- `static installStyles(documentRef = document, options = {})`: 既定CSSまたは指定CSSを document へ注入する
- `static setDefaultStyle(css)`: 以後のインスタンスが使う既定CSSを差し替える
- `getDefaultCommandPaletteCss()`: 既定CSS文字列を返す
- `isOpen`: パレットが開いているかを返す取得プロパティ
- `pageCount`: 現在のコマンド定義からページ数を返す取得プロパティ
- `setCommands(commands = [])`: コマンド一覧を差し替え、ページ範囲を補正して再描画する
- `setStyle(css)`: `styleId` で識別される document 内のスタイル要素を置き換える。同じ `styleId` のインスタンスはCSSを共有する
- `setTheme(theme = {})`: CSSカスタムプロパティをコンテナに設定し、色を部分的に変更する
- `attachToCanvas(canvas = this.viewport, options = {})`: `doubleClick`、`doubleTap`、`key` による開閉ジェスチャーを登録する
- `detach()`: `attachToCanvas()` で登録したリスナーを解除する
- `destroy()`: リスナーとパレットDOMを破棄する
- `open(clientX = null, clientY = null)`: 指定座標付近、または座標なしなら中央にパレットを開く
- `close()`: パレットを閉じる
- `toggle(clientX = null, clientY = null)`: 開閉状態を切り替える
- `nextPage()`: 次ページへ進む。最後のページの次は先頭へ戻る

`CommandPalette` のコマンド種類は、`button`、`toggle`、`stepper`、`select` が基本です。
`button` と `toggle` は 4列格子の 1セル、`stepper` と `select` は 1行全体を使います。
`pageRows` はこの「行数」を指定する値であり、コマンド数そのものではありません。
`id: "palette-next"` のボタンはページ切り替えとして扱われます。
ページ移動の基本はこの明示ボタンですが、既定ではタイトル行のタップ / click でもページが循環し、再表示時は 1ページ目から開きます。
さらに、複数ページがあり現在ページへ `palette-next` が無く、かつ空き枠が残っている場合には、内部で `Next` ボタンを補う動作があります。

## 5. モデル / シーンの読み込み

ここは `webg` のいちばん実務的な層です。
`ModelAsset` が 1モデル単位、`SceneAsset` が 1シーン単位の共通表現で、`ModelLoader` と `SceneLoader` がそのビルドをまとめます。

### `Gltf`
`Gltf` は glTF / GLBのローレベル読み込み器です。
bufferView、accessor、バイナリチャンク展開を担当します。

- `constructor()`: glTF解析用の状態を初期化する
- `load(url, options = {})`: glTF / GLBをまとめて読み込む
- `loadGltf(url, onStage = null)`: JSON形式の glTFを読む
- `loadGlb(url, onStage = null)`: バイナリ形式のGLBを読む
- `loadBuffersFromGltf(alreadyHasBinary = false, onStage = null)`: バッファ群を展開する
- `fetchBuffer(bufferDef)`: 指定バッファを取得する
- `getAccessor(accessorIndex)`: accessor 定義を返す
- `getBufferView(viewIndex)`: bufferView 定義を返す
- `getAccessorData(accessorIndex)`: accessor の生データを返す
- `readComponent(dataView, offset, componentType)`: componentType に応じて 1要素を読む
- `getNumComponents(type)`: accessor 種類から要素数を返す
- `getTypedArrayConstructor(componentType)`: componentType に対応する TypedArray を返す

### `GltfShape`
`GltfShape` は glTFから `ModelAsset` とランタイム shapes を作るインポーターです。

`samples/gltf_loader` が直接見るのはこの層の結果です。

- `constructor(gpu)`: glTFの geometry と node を組み立てるための状態を作る
- `getSceneNodes()`: シーンに含まれる node 群を返す
- `buildNodeTransforms({ normalizeOrigin = true } = {})`: node の local 行列群を作る
- `findOriginAnchorNode()`: 原点基準に使う node を探す
- `getSkinRootNodeIndex(skin)`: skin の root node インデックスを返す
- `getNodeLocalMatrix(node)`: node の local 行列を返す
- `buildParents()`: 親子インデックスの対応表を作る
- `buildWorldTransforms(localMatrices, parents = this.buildParents())`: ワールド行列群を作る
- `collectAnimatedNodeIndices()`: アニメーション対象 node を集める
- `getUniformScaleFromMatrix(matrix, epsilon = 1.0e-4)`: 行列から一様拡大縮小率を求める
- `removeUniformScale(matrix, scale)`: 行列から一様拡大縮小成分を外す
- `makeUniformScaleMatrix(scale)`: 一様拡大縮小行列を作る
- `buildStaticBakePlans(skinPlans = new Map())`: 静的 bake の計画を作る
- `bakeGeometryByMatrix(geometry, matrix, normalMatrix = matrix)`: geometry を行列で bake する
- `makeShapes({ includeSkins = true } = {})`: ランタイム用形状群を作る
- `toModelAsset({ includeSkins = true } = {})`: `ModelAsset` へ変換する
- `getModelAsset(options = {})`: 変換結果の `ModelAsset` を返す
- `buildMaterials()`: マテリアル定義を作る
- `buildMeshDefs({ includeSkins = true, materials = [], skinPlans = new Map(), bakePlans = new Map() } = {})`: mesh 定義を作る
- `buildSkeletonDefs(skinPlans = new Map(), bakePlans = new Map())`: skeleton 定義を作る
- `buildAnimationDefs(skeletons, skinPlans = new Map(), bakePlans = new Map())`: アニメーション定義を作る
- `buildNodeDefs(meshes, skeletons, animations, bakePlans = new Map())`: node 定義を作る

### `Collada`
`Collada` はXML parser です。
`parse(text, verbose, output)` を入口に、mesh、フレーム、アニメーションを読み出します。

- `constructor()`: Collada XML解析用の状態を作る
- `printf(fmt, ...arg)`: 解析ログを出す
- `getMeshes()`: 読み込んだ mesh 群を返す
- `getMeshCount()`: mesh 数を返す
- `releaseMeshes()`: mesh 群を解放する
- `getMaterialColor(materialId)`: マテリアルの色を返す
- `getMaterialParams(materialId)`: マテリアルの追加 param を返す
- `setRegExp()`: 解析に使う正規表現群を準備する
- `parseText(string_to_parse)`: 文字列を parser へ流し込む
- `parseArgs(string_to_parse)`: タグ引数を分解する
- `getNextTag()`: 次のXML tag を読む
- `skip(tag)`: 指定 tag を読み飛ばす
- `skipToClosingTag(element)`: 対応する閉じ tag まで進める
- `asset(tag)`: アセット block を読む
- `library_cameras(tag)`: カメラ定義を読む
- `library_lights(tag)`: ライト定義を読む
- `library_images(tag)`: image 定義を読む
- `library_effects(tag)`: 効果定義を読む
- `library_materials(tag)`: マテリアル定義を読む
- `source()`: 入力元配列を読む
- `geo_mesh(id)`: geometry mesh を読む
- `library_geometries(tag)`: geometry 群を読む
- `controller_skin(source_name)`: skin controller を読む
- `library_controllers(tag)`: controller 群を読む
- `node(tag, parent_frame)`: シーン node を読む
- `library_visual_scenes(tag)`: visual シーン群を読む
- `checkAnimationType(id)`: アニメーション種類を判定する
- `parseAnimationTargetName(target, fallback_name)`: アニメーション描画先名を整える
- `animation(tag, parent)`: アニメーション block を読む
- `library_animations(tag)`: アニメーション群を読む
- `scene(tag)`: シーン block を読む
- `getAnimation()`: 解析済みアニメーションを返す
- `parse(text, verbose, output)`: Collada 全体を解析する

### `ColladaShape`
`ColladaShape` は Collada から `ModelAsset` への正規化と形状生成をまとめるインポーターです。

- `shapeToMeshDef(shape, meshIndex)`: 形状から mesh 定義を作る
- `skeletonToDef(skeleton, meshIndex, bindShapeMatrix)`: skeleton 定義を作る
- `animationToDef(anim, meshIndex, skeletonId)`: アニメーション定義を作る
- `cloneAnimationSource(anim)`: アニメーション入力元を複製する
- `resolveAnimationBoneName(rawBoneName, skeleton)`: ボーン名を skeleton に合わせて解決する
- `normalizeAnimationForSkeleton(anim, skeleton)`: skeleton に合うようアニメーションを整える
- `createRuntimeAnimation(animSource)`: ランタイム用アニメーションを作る
- `animationMatchesSkeleton(anim, skeleton)`: アニメーションと skeleton の対応を判定する
- `getModelOriginPolicy(hasSkeleton)`: 原点扱いの方針を返す
- `getGeometryOriginOffset(mesh, hasSkeleton)`: geometry の原点オフセットを返す
- `getGeometryNodeMatrix(mesh, hasSkeleton)`: geometry 変換行列を返す
- `toModelAsset(bone_enable, tex_select)`: Collada を `ModelAsset` 化する
- `setBones(mesh, shape, verts, newindex)`: ボーン情報を形状へ流し込む
- `setShape(nmesh, bone_enable, texture_select)`: 1 mesh 分の形状を作る
- `makeShapes(bone_enable, tex_select)`: 形状群をまとめて作る

### `ModelLoader`
`ModelLoader` は glTF、Collada、ModelAsset JSONの差を吸収するハイレベルローダーです。
`WebgApp.loadModel()` の中身でもあります。

- `constructor(target = {})`: ローダーの対象環境を保持する
- `detectFormat(source, options = {})`: 入力形式を判定する
- `async loadJSON(source)`: ModelAsset JSONを読む
- `async loadGltf(source, options = {}, onStage = null)`: glTF / GLBを読む
- `async loadCollada(source, options = {}, onStage = null)`: Collada を読む
- `async loadAsset(source, options = {})`: 形式ごとの差を吸収して `ModelAsset` を読む
- `async load(source, options = {})`: 形式を吸収して 1本のローダーとして実行する

`load(source, options)` は `fetch -> validate -> build -> apply-runtime-materials -> instantiate -> runtime` の流れで進み、戻り値に `asset`, `runtime`, `instantiated`, `getClipNames()`, `getClipInfo(id)`, `instantiate()`, `downloadJSON()` を持ちます。
`instantiated` はシーン上に配置された実体、`runtime` は共有リソースを保持する基盤と考えると、寿命管理を整理しやすくなります。

### `ModelAsset`
`ModelAsset` は 1モデル分のJSON互換データを束ねる入口です。
`ModelLoader` や `samples/json_loader` の中心です。

ビルド前にメッシュ、スケルトン、アニメーションをまとめて調整したいときは、この層で処理するのが自然です。
特に現行の`Node`はローカルの拡大縮小率を継続保持する用途に向いていないため、スキニング付きGLBの倍率を変更したい場合は、`ModelAsset.scaleUniform(scale)`でデータ側へ一様拡大縮小を反映してからビルドするほうが安全です。

- `constructor(data = null)`: モデルアセットの保持体を作る
- `static fromData(data)`: data からアセットを作る
- `static fromJSON(text)`: JSON文字列からアセットを作る
- `static isGzipSource(source)`: URL / file 名が `.json.gz` かを判定する
- `static assertCompressionStreamSupport(operation = "gzip ModelAsset JSON")`: gzip 入出力に必要な browser APIが使えるか確認する
- `static async compressTextToGzipBlob(text)`: JSON文字列を gzip Blob へ変換する
- `static async decompressGzipBlobToText(blob)`: gzip Blob をJSON文字列へ復元する
- `static async fromGzipBlob(blob)`: gzip 圧縮された ModelAsset JSON Blob からアセットを作る
- `static async load(url)`: URLからJSONまたは `.json.gz` のアセットを読む
- `setData(data)`: 内部 data を差し替える
- `getData()`: 内部 data を返す
- `scaleUniform(scale)`: メッシュ、ノード、スケルトン、アニメーションの平行移動をまとめて一様に拡大縮小する
- `getClip(id)`: 指定 clip を返す
- `getClips()`: 全 clip を返す
- `getClipNames()`: clip 名一覧を返す
- `getClipInfo(id)`: clip の詳細を返す
- `toJSONText(indent = 2)`: JSON文字列へ書き出す
- `async toJSONGzBlob(indent = 2)`: 現在のJSONを gzip Blob として返す
- `static downloadBlob(blob, filename)`: Blob を指定ファイル名で保存する
- `downloadJSON(filename = "modelasset.json", indent = 2)`: JSONをファイル保存する
- `async downloadJSONGz(filename = "modelasset.json.gz", indent = 2)`: gzip 圧縮JSONをファイル保存する
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
const runtime = asset.build(app.getGPU());
runtime.instantiate(app.space);
```

`scaleUniform(scale)` は破壊的に data を更新して `this` を返します。
元アセットも残したいときは、この例のように `fromData(asset.cloneJSONValue(asset.getData()))` で複製を作ってから使います。
skinned mesh では geometry だけでなくジョイントと pose の translation も同時に伸ばすため、見た目サイズとボーン変形がずれにくくなります。

### `ModelValidator`
`ModelValidator` は `ModelAsset` の参照整合と配列長を確認します。
`validate(asset)` が基本入口です。

- `constructor()`: 検証結果を保持する器を作る
- `validate(asset)`: `ModelAsset` 全体を検証する
- `result()`: 直近の検証結果を返す
- `assertValid(asset)`: 無効なら例外にする

内部の確認対象は、`geometry`、`skin`、`skeleton`、`animation`、`node` です。

`errors` はビルドを止める不整合、`warnings` はビルドを止めない注意点として扱われます。

### `ModelBuilder`
`ModelBuilder` は `ModelAsset` からランタイムの `Shape`、`Skeleton`、`Animation`、`Node` を組み立てます。

- `constructor(gpu)`: build に使うGPU状態を保持する
- `emitStage(handler, stage)`: build 段階を通知する
- `matrixFromArray(values)`: 数値配列から行列を作る
- `matrixFromTransform(transform = {})`: transform 定義から行列を作る
- `createBaseShape(mesh, material)`: mesh とマテリアルから基礎形状を作る
- `computeNormals(shape)`: 形状の法線を補う
- `buildSkeleton(skeletonDef)`: skeleton 定義からランタイム skeleton を作る
- `applySkin(shape, skin)`: skin 情報を形状へ適用する
- `buildAnimations(asset, skeletonId, skeleton, skeletonDef = null)`: アニメーション群を組み立てる
- `buildNodeShape(mesh, material, skeletonDef, options = {})`: node 用形状を組み立てる
- `build(asset)`: アセット全体からランタイムをビルドする

`build(asset)` の戻り値には、`materialDefs`、`meshDefs`、`skeletonDefs`、`animationMap`、`nodes`、`nodeMap`、`shapes`、`createNodeTree(space)`、`bindAnimationBindings()`、`instantiate(space, options)`、`destroy()`、およびアニメーション補助機能が入ります。

### `SceneAsset`
`SceneAsset` はシーンJSONの保存、検証、ビルドの入口です。
`samples/scene` が直接使います。

- `constructor(data = null)`: シーンアセットの保持体を作る
- `static fromData(data)`: data からアセットを作る
- `static fromJSON(text)`: JSON文字列からアセットを作る
- `static async load(url)`: URLからシーンを読む
- `setData(data)`: 内部 data を差し替える
- `getData()`: 内部 data を返す
- `toJSONText(indent = 2)`: JSON文字列へ書き出す
- `downloadJSON(filename = "scene.json", indent = 2)`: JSONをファイル保存する
- `validate()`: シーン validator で確認する
- `assertValid()`: 無効なら例外にする
- `async build(target)`: 実行環境へシーンをビルドする

### `SceneValidator`
`SceneValidator` はシーンJSONの構造と参照を確認します。

- `constructor()`: シーンの検証結果を保持する器を作る
- `addError(path, message)`: 検証エラーを追加する
- `addWarning(path, message)`: 検証警告を追加する
- `expect(condition, path, message)`: 条件が false ならエラーを追加する
- `ensureArray(value, path, label)`: 配列であることを確認する
- `ensureObject(value, path, label)`: オブジェクトであることを確認する
- `validateFiniteNumber(value, path, label)`: 有限数値を検証する
- `validateNumberArray(value, path, label, length = null)`: 数値配列を検証する
- `buildIdSet(items, path, label)`: id 重複を確認しながら Set を作る
- `validateTransform(transform, path)`: 変換情報の平行移動、回転、拡大縮小率を検証する
- `validateMaterialOverride(material, path)`: マテリアル override を検証する
- `validateCamera(camera, path)`: カメラの `target`, `distance`, `yaw`, `pitch`, `roll` などを検証する
- `validateHud(hud, path)`: HUD定義を検証する
- `validateInput(input, path)`: 入力 bindings を検証する
- `validatePrimitive(entry, path)`: primitive エントリーを検証する
- `validateModel(entry, path)`: モデルエントリーを検証する
- `validateScene(scene)`: シーン全体の内部検証を行う
- `validate(scene)`: シーンJSONの構造を検証する
- `assertValid(scene)`: 無効なら例外にする

確認対象は `camera`、`hud`、`input`、`primitives`、`models` です。

`type` と `version` は、現在の実装では識別用の推奨タグとして扱います。

### `SceneLoader`
`SceneLoader` はシーンJSONを `WebgApp` / `{ gpu, space }` 上の実体へ変換します。

- `constructor(target = {})`: シーン build の対象環境を保持する
- `matrixFromTransform(transform = {})`: transform から行列を作る
- `normalizeHudLines(lines = [])`: HUD行を整える
- `applyHud(scene)`: シーンのHUD設定を反映する
- `applyCamera(scene)`: シーンのカメラ設定を反映する
- `createPlacementNode(entry, defaultName)`: placement 用 node を作る
- `ensurePhysicsSpace(scene = {})`: シーン用 `PhysicsSpace` を用意する
- `buildPhysicsCollider(colliderDef = {})`: シーンのコライダー定義からコライダーインスタンスを作る
- `createPhysicsPlacementNode(entry, defaultName, scene)`: `entry.physics` 付きエントリーを `PhysicsNode` として作る
- `applyMaterialOverride(shape, material = {})`: 形状へマテリアル上書きを反映する
- `buildPrimitiveAsset(entry)`: primitive エントリーをアセット化する
- `async resolveModelAsset(entry)`: モデルエントリーからアセットを解決する
- `attachRootsToPlacement(runtime, createdNodeMap, placementNode)`: ランタイム root を placement node へ接続する
- `applyShapeOverrides(shapes, entry)`: 形状へエントリー側の上書きを適用する
- `async buildEntryRuntime(entry, asset)`: 1エントリー分のランタイムを組み立てる
- `createInputMap(scene)`: シーンの入力 map を作る
- `async build(scene)`: シーンJSON全体をランタイムに変換する

`build(scene)` の戻り値は `entries`、`inputMap`、`physicsSpace`、`scene`、`update()`、`stepPhysics(deltaMs)`、`createInputHandler(actionHandlers)`、`getEntry(id)` を持ちます。

シーンJSONで `physicsSpace` を top-level に持たせると `PhysicsSpace` を生成でき、各 primitive / モデルエントリーに `physics` を持たせると、その placement node を `PhysicsNode` として作成できます。
`entry.physics.collider` を必須にし、`bodyType`、速度、減衰、collision レイヤー / マスク、`trigger`、`fixedRotation`、`material.restitution / friction`、`box / plane / sphere / capsule` コライダーを明示する構成です。
`stepPhysics(deltaMs)` は build 後の runtime から明示的に呼び出し、シーンJSONで宣言した物理空間をアプリケーション側の更新処理から進めます。

## 6. アニメーション / アクション / ステート / カメラリグ

この層は、読み込んだアセットをどう再生し、どう切り替え、どう視点を動かすかを扱います。

`12_アニメーション.md` と `10_モデルアセットとランタイム.md` を読んだあとでここを見ると、クリップ、パターン、アクション、ステートの関係が追いやすくなります。

### `Animation`
- `constructor(name)`: 1本のアニメーションを表す器を作る
- `setTimes(times)`: キー時間列を設定する
- `setBonePoses(bone_poses)`: ボーン pose 列を設定する
- `addBoneName(bone_name)`: ボーン名を追加する
- `getBoneName(i)`: 指定インデックスのボーン名を返す
- `getName()`: アニメーション名を返す
- `getKeyCount()`: キー数を返す
- `getKeyTime(key)`: 指定キーの時間を返す
- `isValidKey(key)`: 指定キーが有効かを返す
- `isValidKeyRange(from, to)`: キー範囲が有効かを返す
- `getDurationMs()`: 全体の再生時間を返す
- `getClipInfo()`: clip 情報を返す
- `setData(skeleton, bind_shape_matrix)`: skeleton と bind 形状を結び付ける
- `transitionTo(time, keyFrom, keyTo)`: 指定区間を遷移用に整える
- `start()`: 先頭から再生を始める
- `play()`: 1フレーム分進める
- `playFps(frame_per_sec)`: FPS基準で進める
- `startFromTo(keyFrom, keyTo)`: 指定キー区間から始める
- `startTimeFromTo(time, keyFrom, keyTo)`: 時間指定で区間再生を始める
- `list(print_matrix)`: 内容を一覧表示する

### `Action`
`Action` は 1本の `Animation` の内部区間をパターンとして再利用し、それをアクション名で束ねます。

- `constructor(anim, options = {})`: アニメーションを束ねるアクション層を作る
- `addPattern(def)`: パターン定義を追加する
- `addKeyPattern(name, time, from, to)`: キー区間からパターンを作る
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
- `getCurrentPatternIndex()`: 現在のパターンインデックスを返す
- `isPlaying()`: 再生中かを返す
- `startPattern(patternId, options = {})`: 指定パターンを再生する
- `transitionToKey(entryDurationMs, fromKey, toKey)`: キー間の遷移を始める
- `start(actionId, options = {})`: 指定アクションを再生する
- `startAction(action_name)`: アクション名で再生する
- `play(_deltaMs = null)`: 1ステップ進める
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
- `setVariable(name, value)`: 1変数だけ設定する
- `playStateTarget(state, context, options = {})`: ステートに応じたターゲットを再生する
- `setState(id, options = {})`: 現在ステートを切り替える
- `resolveTransition(context, nowMs)`: 遷移先を解決する
- `update(context = {}, deltaMs = null)`: 1フレーム分ステートマシンを進める
- `getCurrentState()`: 現在ステートを返す
- `getCurrentTransition()`: 現在 transition を返す
- `getDebugInfo()`: デバッグ用の状態情報を返す

### `EyeRig`
`EyeRig` は `base -> rod -> eye` の3段視点ヘルパーです。
オービットは中心周回、First Person は身体方向と独立視線、Follow は独立したカメラ基準位置から対象を注視する姿勢追跡を担当します。
各 Node へ設定する値は親を基準とするローカル変換です。

`attachPointer()` を使うと、mouse / pen / touch のポインターイベントを同じ経路で扱えます。
オービットは1本指 drag で周回、2本指 drag でPAN、pinch で distance を変更します。
First Person は1本指 drag を独立した `lookYaw / lookPitch` に使います。
Follow は drag で rod の基準構図、pinch で eye の基準 distance を変更し、PANは行いません。

- `constructor(baseNode, rodNode, eyeNode, options = {})`: 3段構成のカメラリグを作る
- `static fromNodes(baseNode, eyeNode, options = {})`: 既存 node からリグを組む
- `setType(type)`: リグの操作タイプを設定する
- `setInput(inputController)`: 入力コントローラーを設定する
- `setElement(element)`: ポインターを受ける element を設定する
- `setTarget(x, y, z)`: オービットの local 描画先を設定する
- `setPosition(x, y, z)`: First Person の local 基礎位置を設定する
- `setTargetNode(targetNode)`: Follow の注視対象 node を設定して追跡状態を初期化する
- `setTargetOffset(x, y, z)`: Follow 対象 node 内の local 注視位置を設定する
- `setDistance(distance)`: eye までの距離を設定する
- `setAngles(yaw, pitch, roll = 0.0)`: 現在モードの基礎または rod 側の基準角を設定する
- `setLookAngles(yaw, pitch, roll = 0.0)`: eye 側の独立視線または Follow 手動補正を設定する
- `setEyeHeight(height)`: 視点高さを設定する
- `setRodLength(length)`: 支点から eye までの長さを設定する
- `getFollowTargetWorldPosition()`: targetNode と local targetOffset からワールド注視点を返す
- `resolveFollowTargetQuat()`: 現在の rod local 座標で描画先を向く目標クォータニオンを返す
- `resetFollowTracking()`: Follow の追跡姿勢と診断値を初期化する
- `updateFollowDiagnostics()`: eye 前方と描画先方向の内積を `follow.lastViewDot` へ保存する
- `apply(force = false)`: node へ計算結果を反映する
- `update(deltaSec)`: 1フレーム分リグを更新する
- `attachPointer(element = this.element)`: ポインターハンドラーを element に付ける
- `detachPointer()`: ポインターハンドラーを外す
- `cancelDrag()`: drag 状態を中断する
- `onPointerDown(ev)`: ポインター down を処理する
- `onPointerMove(ev)`: ポインター move を処理する
- `onPointerUp(ev)`: ポインター up を処理する
- `onWheel(ev)`: wheel を処理する
- `destroy()`: イベントハンドラーを外して破棄する

## 7. 診断情報 / デバッグ / アプリ

この層は、ランタイムの状態をテキスト / JSON / パネルに出すためのものです。

`samples/scene`、`samples/bloom`、`samples/dof`、`samples/sound` などで、調査フローをサンプルの中に閉じ込めるために使います。

### `Diagnostics`
`Diagnostics` はレポートオブジェクトの生成、整形、保存、clipboard へのコピーを担当します。

- `requireReport(report, methodName)`: 診断情報 report オブジェクトであることを確認する
- `requirePlainObject(value, methodName, name)`: オブジェクト引数を検証する
- `requireArray(value, methodName, name)`: array 引数を検証する
- `requireInputFrame(frame, methodName, index = null)`: 入力 replay フレームを検証する
- `toSummaryText(report, options = {})`: 人とAIが最初に読む summary テキストへ整形する
- `getSummaryStatKeys(stats = {})`: summary で優先表示する stat キーの順序を返す
- `resolveSystem(init = {})`: system 名や段階を整えてレポート用の初期値を作る
- `createReport(init = {})`: 空のレポートを作る
- `createSuccessReport(init = {})`: 成功扱いのレポートを作る
- `createErrorReport(error, init = {})`: 失敗扱いのレポートを作る
- `createProgressReport(data, init = {})`: 保存済み progress を report として表現する
- `createReplayReport(inputLog, init = {})`: 入力 replay 用 report を作る
- `createInputTimelineReport(inputLog, init = {})`: 入力 timeline report を作る
- `summarizeInputFrame(frame, index = 0)`: 入力フレームを 1行に要約する
- `addDetail(report, line)`: detail 行を追加する
- `addWarning(report, line)`: warning 行を追加する
- `setStat(report, key, value)`: 統計値を 1件設定する
- `mergeStats(report, stats = {})`: 統計値群をまとめて反映する
- `toText(report, options = {})`: テキストレポートへ整形する
- `toJSON(report, space = 2)`: JSONレポートへ整形する
- `copyText(report, options = {})`: テキストレポートを clipboard へ送る
- `copySummary(report, options = {})`: summary テキストを clipboard へ送る
- `copyJSON(report, space = 2)`: JSONレポートを clipboard へ送る
- `copyString(text)`: 任意文字列を clipboard へ送る
- `downloadText(report, filename = "diagnostics.txt", options = {})`: テキストレポートを保存する
- `downloadJSON(report, filename = "diagnostics.json", space = 2)`: JSONレポートを保存する
- `downloadString(text, filename, mimeType)`: 任意文字列をダウンロードする

### `DebugConfig`
`DebugConfig` はデバッグ / リリースの切り替えとフラグ管理を担当します。

- `createFlags(mode)`: モードから既定フラグ群を作る
- `setMode(mode = "release")`: デバッグ / リリースを切り替える。既定は利用者向け表示を優先する `release`
- `configure(flags = {})`: 個別フラグを上書きする
- `isDebug()`: デバッグモードかを返す
- `isRelease()`: リリースモードかを返す
- `isEnabled(key)`: 指定フラグが有効かを返す

### `DebugProbe`
`DebugProbe` は、1フレーム後に 1回だけ状態を採取するためのヘルパーです。

- `constructor(options = {})`: 診断採取の待ち行列を作る
- `request(options = {})`: 1回分の診断採取を予約する
- `update(frameCount)`: frameCount を見て診断採取を実行する
- `hasPending()`: 予約中の診断採取があるかを返す
- `getPendingCount()`: 予約数を返す
- `getLastResult()`: 直近結果を返す
- `clear()`: 予約と結果を消す

### `WebgApp`
`WebgApp` は、`Screen`、`Shader`、`Space`、`Input`、`Message`、デバッグ補助、loadModel/loadScene をまとめるハイレベル入口です。

入力コールバックに渡るキー名は `InputController.normalizeKey()` 済みです。
英字は小文字になり、`Space` は `space`、`Esc` は `escape` として比較します。

サンプルの多くは `WebgApp` を使うことで、初期化の重複を減らしています。

役割は「3Dアプリの土台を最短で作ること」で、`Screen`、投影、カメラリグ、HUD、入力、診断情報、ローダー、dialogue、progress 保存までを 1か所へ集約します。

最小サンプルなら `init()` と `start()` だけでも動きますし、必要に応じてローダー、診断ドック、dialogue、診断採取を少しずつ足していけます。

`WebgApp` を使うサンプルは、何も指定しない場合 `release` モードで起動します。
`app.attachInput()` で入力を接続していれば、`F9` のあとに `m` を押すとデバッグモードへ切り替えられます。
`keyInput.enabled` を false にしているサンプルでも、モード切り替えだけは標準で残るため、「通常表示で動作確認してから必要な時だけデバッグに入る」流れを共通で使えます。

注意点として、このショートカットは `WebgApp` の入力処理に乗っている場合だけに有効です。
サンプル側が未加工 `InputController` を直接使ってキーボードを処理している構成では、自動では有効になりません。
その場合はサンプル側で同等のモード切替を実装してください。

#### 起動 / 構成
- `constructor(options = {})`: `Screen`、`Space`、`Message`、デバッグ補助をまとめる。`gpu: { requiredFeatures, optionalFeatures }`でGPUデバイス機能を指定できる。`fixedCanvasSize: { width, height, useDevicePixelRatio }` を渡すと固定キャンバスサイズで起動し、`layoutMode: "embedded"` を渡すとキャンバスとDOM overlay を文書フロー内へ埋め込める。`renderMode: "ondemand" | "continuous"` も受け付け、既定は `ondemand`
- `getGPU()`: 現在のGPUコンテキストを返す
- `setUiTheme(theme = {})`: HTML UIテーマを差し替える
- `attachInput(handlers = {})`: キーボード / ポインター入力を接続する。`WebgApp` の診断キー処理もこの経路で有効になる
- `configureDebugKeyInput(options = {})`: 診断キー配列を設定する。`keyInput.enabled` が false でも `F9` → `m` のモード切り替えは標準で残る
- `createCameraRig()`: 標準カメラリグを作る
- `createOrbitEyeRig(options = {})`: 標準カメラリグ上にオービット用 `EyeRig` を作り、ポインター入力、毎フレーム更新、`WebgApp` カメラ状態への同期をまとめて設定する
- `syncCameraFromEyeRig(eyeRig = this.eyeRig)`: `EyeRig` のオービット状態を `WebgApp` のカメラ状態へ反映する
- `updateManagedEyeRig(deltaSec)`: `createOrbitEyeRig()` で作成した `EyeRig` をフレーム内で更新し、必要に応じてカメラ状態を同期する
- `applyViewportLayout()`: キャンバスとHUDのレイアウトを反映する。`fixedCanvasSize` がある場合は固定サイズを優先し、`layoutMode: "embedded"` では overlay をキャンバス配置元基準へそろえる
- `checkEnvironment(options = {})`: 実行環境の診断レポートを作る
- `updateProjection(viewAngle = this.viewAngle)`: 投影行列を更新する
- `setLoopHandlers(handlers = {})`: 毎フレーム呼ぶハンドラーを設定する
- `start(handlers = {})`: メインループを開始する。`renderMode: "ondemand"` ではページが表示かつフォーカスを持つ間だけ進み、非動作中中は一時停止と同じように更新が止まる
- `stop()`: メインループを止める
- `requestRender()`: `ondemand` モードでフレームを 1本予約する。ページが非動作中の間は予約しない
- `frame(timeMs)`: 1フレーム分の処理を進める
- `getFrameContext(timeMs)`: フレーム用のコンテキスト情報を返す
- `formatScreenshotTimestamp(date = new Date())`: スクリーンショット用時刻文字列を作る
- `resolveScreenshotFilename(options = {})`: スクリーンショット保存名を解決する
- `takeScreenshot(options = {})`: 次の present 後にPNG保存を予約する

`start()`の`onUpdate`はシーンとカメラ状態を更新する場所です。
カメラフレーム確定前なので`cameraFrame`や`renderFrameToken`は渡りません。
`onBeforeDraw`と`onAfterDraw3d`は同じ描画フレームの`cameraFrame`と`renderFrameToken`を受け取ります。
標準描画ではどちらも使わず、描画シェーダー版DoFの手動接続はトークン、`ComputeEffectPipeline`は完全なフレームを同じコールバック間で共有します。
どちらも次フレームへ保存しません。

#### シーン / モデル / カメラ
- `validateScene(scene)`: シーンJSONを検証する
- `async loadModel(source, options = {})`: モデルローダーのハイレベル入口としてモデルを読む
- `async loadScene(scene)`: シーンローダーのハイレベル入口としてシーンを読む
- `setEyeLight(positionAndType = this.lightPosition)`: 視点空間基準のライトを設定する
- `setWorldLight(options = {})`: ワールド node 基準のライトを設定する
- `applyLightConfig()`: ライト設定をシェーダー側へ反映する
- `setFog(options = {})`: フォグ設定を更新する
- `getShapeSize(shapes)`: 形状群のサイズ情報を返す
- `createTween(target, to, options = {})`: `Tween` を作成して app 管理下へ登録する
- `updateTweens(deltaMs = 0)`: 登録済み補間処理を進め、終了済み補間処理を取り除く
- `clearTweens()`: 登録済み補間処理をすべて消す
- `async createParticleEmitter(options = {})`: パーティクル発生器を作成し、必要ならレンダラーも初期化する
- `updateParticleEmitters(deltaMs = 0)`: 登録済みパーティクル発生器を更新する
- `drawParticleEmitters()`: 登録済みパーティクル発生器を描画する
- `clearParticleEmitters()`: 登録済みパーティクル発生器を消す
- `shakeCamera(options = {})`: カメラ shake を開始する
- `updateCameraEffects(nowMs = Date.now())`: カメラ shake や位置追従描画先を反映する
- `updateCameraTarget(deltaMs = 0)`: follow / lock-on 対象から cameraRig の基準位置を更新する
- `followNode(node, options = {})`: node の位置へ cameraRig を滑らかに追従させる。EyeRig Follow の姿勢追跡とは別機能
- `lockOn(target, options = {})`: node または座標へ cameraRig の基準位置を即時設定する
- `clearCameraTarget()`: cameraRig の位置追従描画先を解除する
- `flashMessage(text, options = {})`: 短い toast message を表示する

#### HUD / guide / status / panels
- `setHudRows(rows = [], options = {})`: HUD行群を設定する
- `clearHudRows()`: HUD行群を消す
- `setControlRows(rows = [], options = {})`: control 表示行を設定する
- `clearControlRows()`: control 行を消す
- `pushToast(text, options = {})`: 一定時間表示する toast を追加する
- `clearToasts()`: toast 表示を消す
- `makeTextControlRows(lines = [])`: テキスト形式の control 行を作る
- `setHudLayoutOffsets(options = {})`: HUDの段差と余白を調整する
- `setDebugDockRows(rows = [])`: 診断ドック用の行を設定する
- `clearDebugDockRows()`: 診断ドック行を消す
- `showOverlayPanel(options = {})`: `OverlayPanel` を作成または更新して表示する
- `updateOverlayPanel(panelOrId, patch = {})`: `OverlayPanel` のオプションを差し替える
- `hideOverlayPanel(panelOrId)`: `OverlayPanel` を非表示にする
- `removeOverlayPanel(panelOrId)`: `OverlayPanel` をDOMと管理表から削除する
- `clearOverlayPanels()`: app 管理の `OverlayPanel` をすべて削除する
- `getOverlayPanel(panelId)`: 指定 id の `OverlayPanel` を返す
- `hasOverlayPanel(panelId)`: 指定 id の `OverlayPanel` があるか返す
- `listOverlayPanels()`: app 管理の `OverlayPanel` 一覧を返す
- `drawMessages()`: キャンバスHUDの message 群を描画する
- `isDebugDockActive()`: 診断ドックを出す条件を返す
- `syncDebugDockVisibility()`: 診断ドックの表示状態を合わせる
- `getDebugKeyPrefixLabel()`: 診断キー prefix の表示文字を返す
- `getDebugKeyGuideLines()`: 診断キーの説明行を返す
- `handleDebugKeyInput(key, ev)`: 診断キー入力を処理する
- `resolveDebugKeyAction(key)`: キーから操作名を解決する
- `runDebugKeyAction(action)`: アクションを実行する
- `updateDebugDock()`: 診断ドックの本文を更新する
- `formatDebugDockControls()`: 診断ドック用 control 文を整形する
- `makeControlRowData(row = {})`: control row の表示用 data を作る
- `formatDebugDockControlRow(rowData = {}, maxPrefixWidth = 0)`: 1行分の control 表示を整形する
- `formatDebugDockText()`: 診断ドック全体のテキストを作る
- `formatHudRowsForCanvas()`: キャンバスHUD用の行を整形する
- `buildHudRowLines(rowDataList = [], compact = false)`: HUD row をテキスト行へ変換する
- `getHudAvailableCols(scale = this.messageScale)`: 現在のHUDで使える列数を返す

#### 診断情報 / 診断採取
- `resetDiagnostics(stage = "init")`: 診断情報レポートを初期化する
- `setDiagnosticsStage(stage)`: 段階名を更新する
- `addDiagnosticsDetail(line)`: detail 行を追加する
- `addDiagnosticsWarning(line)`: warning 行を追加する
- `reportRuntimeWarning(line, options = {})`: runtime warning を記録して診断情報へ反映する
- `mergeDiagnosticsStats(stats = {})`: 統計値を取り込む
- `setDiagnosticsReport(report)`: レポートを差し替える
- `getDiagnosticsReport()`: 現在のレポートを返す
- `createProbeReport(stage = "runtime-probe")`: 診断採取用レポートを作る
- `setDebugMode(mode = "release")`: 診断 / release を明示的に設定し、DebugConfig、DebugDock、レイアウトを更新する
- `toggleDebugMode()`: デバッグ / リリースの表示を切り替える
- `getDebugMode()`: 現在のデバッグモードを返す
- `isConsoleEnabled()`: console 出力が有効かを返す
- `isDebugUiEnabled()`: 診断用補助UIの表示が有効かを返す
- `formatDiagnosticsSummary(report = null, options = {})`: summary テキストを作る
- `formatDiagnosticsJSON(report = null, space = 2)`: JSONレポートを作る
- `copyDiagnosticsSummary(options = {})`: 診断情報 summary を clipboard へコピーする
- `copyDiagnosticsReportJSON(options = {})`: 診断情報JSONを clipboard へコピーする
- `captureDiagnosticsSnapshot(options = {})`: summary / JSONの 1回採取を予約する
- `captureDiagnosticsSummary(options = {})`: summary スナップショットの標準入口
- `captureDiagnosticsReportJSON(options = {})`: report JSONスナップショットの標準入口
- `getCurrentDiagnosticsReport(options = {})`: 現在のシーン / runtime 状態を反映した report を返す
- `getCurrentStateDockText(options = {})`: 診断ドック用の現在状態テキストを返す
- `invalidateCurrentDiagnosticsCache(options = {})`: 診断情報キャッシュを無効化する
- `buildAutomaticDiagnosticsStats(report, options = {})`: カメラ / キャンバス / シーンなどの stat を自動収集する
- `mergeAutomaticDiagnosticsContext(report, options = {})`: 診断情報コンテキストを自動補完する
- `collectCurrentSceneStats(options = {})`: 現在シーンの node / 形状 / アニメーション統計を集める
- `setLatestRuntimeError(error, options = {})`: 直近 runtime エラーを記録する
- `setLatestRuntimeWarning(line, options = {})`: 直近 runtime warning を記録する
- `clearLatestRuntimeAlerts()`: runtime エラー / warning 表示を消す
- `syncLatestRuntimeAlertsFromReport(report)`: 診断情報 report から runtime alert 表示を同期する
- `updateDebugProbe()`: 予約済み診断採取を進める
- `getProbeStatusLine()`: 診断採取状態行を返す
- `getDiagnosticsStatusLine()`: 診断情報状態行を返す

#### 保存 / replay / 補助状態
- `saveProgress(key, data, options = {})`: アプリ名義の保存領域へ progress を保存する
- `loadProgress(key, defaultValue = null)`: progress を読み出す
- `clearProgress(key)`: 指定キーの progress を消す
- `getProgressStorage()`: progress 保存に使うストレージを返す
- `getProgressStorageKey(key)`: progress 保存用の実キーを返す
- `recordInputFrame(meta = {})`: 現在フレームの入力スナップショットを記録する
- `replayInputFrame(frame, options = {})`: 記録済みフレームを入力状態へ戻す
- `getInputLog()`: 記録済み入力フレーム群を返す
- `clearInputLog()`: 入力ログを消す

`WebgApp.loadModel()` は `ModelLoader.load()`、`WebgApp.loadScene()` は `SceneLoader.build()` のハイレベル窓口です。

`samples/json_loader`、`samples/gltf_loader`、`samples/collada_loader`、`samples/scene` は、この窓口を使うことでフォーマットごとの差を外へ漏らしません。

### `EyeRig` と `WebgApp`
`WebgApp.createCameraRig()` は、標準カメラリグを作る入口です。

オービットカメラを標準的に使う場合は、`createCameraRig()` 後の node を直接渡して `EyeRig` を作る代わりに、`WebgApp.createOrbitEyeRig()` を使えます。
この入口は、`EyeRig.update(deltaSec)` と `WebgApp` のカメラ状態同期を `WebgApp.frame()` 内へ組み込むため、PANによる `orbit.target` 更新が `app.camera.target` で上書きされる事故を避けやすくなります。

`EyeRig` は、`WebgApp` が使う視点ヘルパーの標準形を提供しますが、必要なら任意の node 階層へ差し替えられます。
その場合は `syncCameraFromEyeRig()` を明示的に使うか、独自のカメラ状態管理を行ってください。

## 8. オーディオ / パーティクル

音周りは、`ToneSynth` が単音基盤、`AudioSynth` がSE/BGM基盤、`GameAudioSynth` がゲーム向けの便利層です。

`samples/sound` は、SE / BGM / delay / reverb / envelope / 診断情報を同じ画面で往復できる例です。

### `ToneSynth`

- `constructor(options = {})`: 単音再生用の synth 基盤を作る
- `ensureContext()`: AudioContextを確保し、単音用バスとエフェクト処理を準備する
- `buildToneFxChain()`: 単音用バスのディレイ / リバーブ処理を作る
- `async resume()`: user ジェスチャー後に audio コンテキストを再開する
- `setMasterVolume(v)`: 全体音量を設定する
- `setSeVolume(v)`: 単音 / SE bus の音量を設定する
- `setSeDelay(timeSec = 0.11, feedback = 0.26, wet = 0.22)`: 単音 / SE用 delay を設定する
- `setSeReverb(send = 0.28, returnGain = 0.48)`: 単音 / SE用 reverb を設定する
- `getImpulseKindList()`: 利用可能な impulse kind を返す
- `normalizeImpulseConfig(config = {})`: impulse 設定を正規化する
- `updateConvolverImpulse(convolver, config)`: convolver の impulse を更新する
- `setSeReverbImpulse(config = {})`: 単音 / SE用 reverb impulse を設定する
- `getSeReverbImpulseConfig()`: 単音 / SE用 reverb impulse 設定を返す
- `setSeEnvelopePreset(name, config)`: 単音 / SE用 envelope preset を登録する
- `getSeEnvelopePreset(name)`: 単音 / SE用 envelope preset を返す
- `getSeEnvelopePresetList()`: 単音 / SE用 envelope preset 一覧を返す
- `playTone(freq, dur = 0.12, options = {})`: 単音を鳴らし、voice handle を返す
- `stopTone(voice, when = null, options = {})`: 個別の voice を停止する
- `stopAllTones(options = {})`: 現在鳴っている単音をすべて停止する
- `getImpulseProfile(kind = "room")`: 既定 impulse profile を返す
- `createImpulseResponse(ctx, durationSec = 1.5, decay = 2.5, options = {})`: impulse response を作る

### `AudioSynth`

- `constructor()`: `ToneSynth` を継承したSE/BGM synth を作る
- `ensureContext()`: ToneSynth のコンテキストを確保し、BGM bus を追加する
- `buildBgmFxChain()`: BGM用のディレイ / リバーブ処理を作る
- `async resume()`: user ジェスチャー後に audio コンテキストを再開する
- `setMasterVolume(v)`: 全体音量を設定する
- `setBgmVolume(v)`: BGM音量を設定する
- `setBgmDelay(timeSec = 0.18, feedback = 0.22, wet = 0.18)`: BGM用 delay を設定する
- `setBgmReverb(send = 0.28, returnGain = 0.48)`: BGM用 reverb を設定する
- `getImpulseKindList()`: 利用可能な impulse kind を返す
- `normalizeImpulseConfig(config = {})`: impulse 設定を正規化する
- `updateConvolverImpulse(convolver, config)`: convolver の impulse を更新する
- `setBgmReverbImpulse(config = {})`: BGM用 reverb impulse を設定する
- `getBgmReverbImpulseConfig()`: BGM用 reverb impulse 設定を返す
- `playTone(freq, dur = 0.12, options = {})`: 単音を鳴らす
- `playSe(name)`: SE名で音を鳴らす
- `async loadAudioBuffer(name, url)`: mp3 / wav / ogg などの音声ファイルを読み込み、名前付き `AudioBuffer` として登録する
- `async decodeAudioBuffer(name, arrayBuffer)`: 取得済み `ArrayBuffer` を decode して登録する
- `registerAudioBuffer(name, buffer)`: 既存 `AudioBuffer` を名前付きで登録する
- `getAudioBufferList()`: 登録済み音声素材名の一覧を返す
- `getAudioBuffer(name)`: 登録済み `AudioBuffer` を返す
- `playAudioBuffer(name, options = {})`: 登録済み音声素材をSEまたはBGM bus へ流して再生する
- `stopAudioBuffer(voice, when = null, options = {})`: `playAudioBuffer()` が返した voice を停止する
- `stopAllAudioBuffers(options = {})`: 再生中の音声素材をまとめて停止する
- `setBpm(bpm)`: BGMのBPMを設定する
- `setRootHz(hz)`: 基準周波数を設定する
- `getMelodyList()`: 登録済み melody 一覧を返す
- `setMelody(name)`: 現在の melody を切り替える
- `registerMelody(name, config)`: melody preset を登録する
- `startBgm()`: BGM再生を開始する
- `stopBgm(fadeSec = 0.20)`: BGMをフェードしながら止める
- `scheduleBgm(lookAheadSec)`: 先読みでBGMスケジュールを進める
- `scheduleBgmStep(step, when)`: 1ステップ分のBGMを予定する
- `getStepParam(arr, step, _unusedFallback)`: 配列から間隔対応値を返す
- `shouldPlayRhythm(step, melody)`: 指定間隔で音を鳴らすかを判定する
- `degreeToSemitone(scale, degree)`: 音階の度数を半音へ変換する
- `maybeModulate()`: 必要ならキー modulation する
- `playBgmVoice(freq, when, dur, type, gain)`: BGMの 1 voice を鳴らす
- `setBgmEnvelope(config)`: BGM envelope を設定する
- `getBgmEnvelope()`: BGM envelope を返す

### `GameAudioSynth`
`GameAudioSynth` は、ゲーム向けの melody preset とSE catalog を追加した上位層です。

- `constructor()`: ゲーム向け preset を持つ synth を作る
- `playGameTone(freq, dur = 0.12, profile = "piano", options = {})`: プロファイル付きで単音を鳴らす
- `installMelodyPresets()`: melody preset を登録する
- `installSePresets()`: SE preset を登録する
- `getSoundEffectList()`: 利用可能なSE一覧を返す
- `getSoundEffectInfo(name)`: SEの詳細を返す
- `getGameSeList()`: ゲーム向けSE一覧を返す
- `playSe(name)`: SEを再生する
- `playGameSe(name)`: ゲーム向けSEを再生する

### `ParticleEmitter`
`ParticleEmitter` は、短命なビルボードパーティクルをまとめて発生 / 更新 / 描画する軽量エフェクト層です。

- `constructor(options = {})`: 発生器名、最大パーティクル数、preset、シャドウ、乱数 seed などを初期化する
- `static getPresetDefinition(name = "spark")`: 既定 preset 定義を名前から返す
- `getPreset()`: 現在の preset 内容を返す
- `setPreset(name = "spark", options = {})`: preset を切り替え、テクスチャと既定発生値を更新する
- `setRenderer({ billboard, shadowBillboard, texture } = {})`: 外部で作ったレンダラー一式を差し込む
- `init(gpu)`: ビルボードと procedural テクスチャを含む実レンダラーをGPU上に初期化する
- `rebuildTexture()`: 現在の preset に合わせてパーティクルテクスチャを再生成する
- `clear()`: 生存中パーティクルをすべて消す
- `getAliveCount()`: 現在生存しているパーティクル数を返す
- `emit(options = {})`: 位置、速度、寿命、色、重力、drag、個数などを指定してパーティクルを発生させる
- `update(deltaSec)`: 生存パーティクルの位置、速度、寿命、シャドウを 1フレーム分更新する
- `draw(eyeNode, projectionMatrix)`: 現在生存しているパーティクルをビルボードとして描画する

## 9. タッチ / 入力 / タイルマップ

`Touch` と `InputController` は、キーボードとタッチを同じキー状態にまとめるための層です。

`unittest/touch`、`unittest/input_controller`、`samples/scene` の入力 mapping を読むときは、この層の小文字ルールを前提にすると分かりやすくなります。

### `Touch`
`Touch` は、キー入力の代わりに押す仮想ボタン群を画面下へ固定表示するクラスです。

用途は menu や会話パネルではなく、`arrowleft`、`space`、`enter` のようなキー名を hold / 操作として流し込むことです。

シーンの上に card や status パネルを重ねたいときは `OverlayPanel`、キー入力の代わりのボタンが欲しいときは `Touch`、と分けて考えると整理しやすくなります。

- `constructor(doc, options = {})`: touch UIを管理する器を作る
- `isCoarsePointer()`: coarse ポインター環境かを返す
- `isEnabled()`: touch UIが有効かを返す
- `injectDefaultStyle()`: 既定CSSを注入する
- `create(options = {})`: 仮想ボタン群を作る
- `applyDensitySize()`: 表示密度に応じたサイズへ調整する
- `applyLayoutMode()`: レイアウトモードを切り替える
- `resetGroupInlineLayout(groupItems = null)`: group の inline 配置を初期化する
- `applyMultilineSpreadByRows(groupItems, groupGap, availableWidth)`: 複数行配置へ広げる
- `releaseAll()`: すべての押下状態を解除する
- `destroy()`: CSSとDOMを破棄する

`Touch.create()` は、hold と操作を分けて扱います。

hold は `pointerdown` / `pointerup` でキー状態に流し込み、操作は 1回の押下イベントとして扱います。

### `InputController`
`InputController` は、キーボード、ポインター、touch ボタンを同じキー状態へまとめるクラスです。

`normalizeKey()` により、`event.key` の揺れを小文字の比較名へ整え、サンプル側が入力元ごとの差を意識せず `"w"`、`"space"`、`"arrowleft"` のような名前で扱えるようにします。

比較は未加工の `event.key` ではなく、この正規化後の名前で行います。
たとえば `Space` は `" "` ではなく `space`、`Escape` は `escape` として受け取る前提です。

`WebgApp.attachInput()` や `EyeRig` も最終的にはこの層のキー状態を使います。

- `constructor(doc)`: キーボード / ポインター入力を束ねる器を作る
- `normalizeKey(key)`: browser 差や touch 由来のキー名を小文字の比較名へ正規化する
- `clear()`: キー状態を全消去する
- `has(key)`: 指定キーが押されているかを返す
- `press(key)`: キーを押下状態にする
- `release(key)`: キーを離す
- `beginFrame()`: 1フレーム用の瞬間入力フラグを消す
- `captureFrameState(meta = {})`: 現在の入力状態を replay 用スナップショットとして返す
- `applyFrameState(frame = {}, options = {})`: スナップショットを現在の入力状態へ戻す
- `registerActionMap(map = {})`: 操作名とキーの対応を登録する
- `getActionMap()`: 現在の操作 map をオブジェクトとして返す
- `getAction(name)`: 操作が現在動作中かを返す
- `wasActionPressed(name)`: そのフレームで操作が押されたかを返す
- `wasActionReleased(name)`: そのフレームで操作が離されたかを返す
- `pulseAction(key)`: 1フレームだけ有効なアクションを作る
- `triggerAction(name)`: `pulseAction()` と同じ処理を行う別名
- `setTouchLayoutOptions(options = {})`: touch 操作部品の配置既定値を設定する
- `shouldPreventDefaultForKeyboardEvent(event, key, preventDefault = true)`: キーボードの既定動作抑止可否を返す
- `setPointerPreventDefaultElement(element)`: ポインター既定動作抑止の対象 element を設定する
- `shouldPreventDefaultForPointerEvent(event, preventDefault = true, element = this.pointerPreventDefaultElement)`: ポインターの既定動作抑止可否を返す
- `installTouchControls(options = {})`: touch UIをキー状態に接続する
- `detach()`: イベントリスナーを外す
- `attach({ onKeyDown, onKeyUp, onPointerDown } = {})`: キーボードとポインターを受け付ける

`InputController.attach()` はキーボードの `keydown` / `keyup` とポインター入力をまとめて扱います。

`installTouchControls()` は `Touch.create()` を使って仮想ボタンをそのままキー状態に流し込みます。

キーボードと touch の両方を使うサンプルでは、比較名を `16_タッチ機能と入力.md` の一覧に合わせて `"space"`、`"escape"`、`"f9"` のようにそろえると実装と文書の両方が追いやすくなります。

## 10. 内部補助 / 設定 / 使い分け

`Frame`、`Mesh`、`Schedule`、`Task`、`Stack` は、現在の public サンプルから直接触ることは少ないですが、インポーターやアニメーションの内部で重要です。

`util.js`、`formatJSON()`、`Tween`、`SkinningConfig` は、周辺処理を支える補助APIです。

API文書を読むときは、まず public クラスを押さえ、そのあとに内部補助を確認すると理解しやすくなります。

### `StorageTargetFactory`
`StorageTargetFactory` はコンピュートシェーダーが書き込み、後段パスがサンプルできる `RenderTarget` の生成条件を統一する advanced public 補助機能です。

- `constructor(gpu, options = {})`: ストレージテクスチャ形式と usage を固定する
- `create(options = {})`: 深度なしのストレージ / サンプリング可能な描画先を1個作る
- `createPingPong(options = {})`: 同条件の描画先2個を生成して保持する`PingPongTarget`を作る
- `getDefaultStorageTargetUsage()`: 既定のストレージ / テクスチャ / copy usage を返す名前付きエクスポート
- `resizeTarget(target, width, height)`: 寸法が変わった場合だけ描画先を resize する名前付きエクスポート

### `PingPongBuffer` / `PingPongTexture` / `PingPongTarget`
これらは2個のリソースを current（読み取り元）と next（書き込み先）として交互に使う advanced public 補助機能です。

- `getCurrent()` / `getNext()`: 現在の入力リソースと次の出力リソースを返す
- `getCurrentIndex()` / `getNextIndex()`: バインドグループ選択などに使うインデックスを返す
- `swap()`: 直前の書き込み先を新しい読み取り元へ切り替える
- `reset(index = 0)`: リソース内容を変えず役割インデックスだけを初期化する
- `PingPongTarget.resize(width, height)`: 内部で保持する2描画先を同じ寸法へ更新する
- `PingPongTarget.destroy()`: `ownsResources`が有効な場合は内部で保持する描画先も破棄する

### `util.js` / `formatJSON`
`util.js` は文字列整形、時間計測、同期 / 非同期I/Oの補助関数群です。
`JsonFormat.js` の `formatJSON()` は、数値配列を読みやすく保ったままJSON文字列へ整形する関数です。

- `strDup(char, cnt)`: 文字を指定回数だけ複製する
- `format_D(num, flag, cnt)`: 整数を `%d` 風に整形する
- `format_F(num, flag, cnt, precision)`: 固定小数点を整形する
- `format_E(num, flag, cnt, precision, etype)`: 指数表記を整形する
- `format_S(str, flag, cnt)`: 文字列を整形する
- `format_X(num, flag, cnt, type)`: 16進数を整形する
- `sprintf(fmt, ...arg)`: 軽量 `sprintf` として整形する
- `printf(fmt, ...arg)`: console か string へ出力する
- `now()`: 現在時刻を返す
- `sleep(sec)`: ビジーウェイトで待つ
- `readFile(filename)`: Node.js で同期読み込みする
- `writeFile(filename, data)`: Node.js で同期書き込みする
- `print()`: 空行を出力する
- `readUrlSync(filename)`: 同期的なURL読み込みを行う
- `readUrl(filename)`: fetch ベースで非同期読み込みする
- `formatJSON(value, indent = 2)`: JSON値を、行列や数値配列を潰しすぎずに整形して返す

### `Tween`
`Tween` は、数値、配列、色、ベクトルなどを時間で補間する汎用補間処理補助機能です。

- `constructor(target = {}, to = {}, options = {})`: 補間対象、目標値、duration、easing、コールバックを設定する
- `captureStartValues()`: 開始時点の値をスナップショットする
- `apply(progress = 0.0)`: 指定 progress の値を描画先へ反映する
- `update(deltaMs = 0)`: 経過時間を進めて補間を更新する
- `reset(options = {})`: 再生状態を初期値へ戻す
- `pause()`: 補間を一時停止する
- `resume()`: 一時停止した補間を再開する
- `isFinished()`: 補間完了済みかを返す

### `ShapeResource` / `Shape`
`ShapeResource` は共有可能な geometry とGPUバッファを持つ基底資源です。
`Shape` はその共有資源を参照しながら、hidden 状態、マテリアル差分、skeleton runtime などのインスタンス側の状態を持ちます。

- `ShapeResource.constructor(gpu)`: 頂点配列、インデックスバッファ、ワイヤーフレーム、bounding ボックス、skin 情報を保持する共有資源を初期化する
- `ShapeResource.destroy(options = {})`: shared GPUBuffer とCPU側配列を明示破棄する
- `Shape.constructor(gpuOrResource)`: `GPU` または `ShapeResource` を受け取り、共有資源を使う描画インスタンスを初期化する
- `Shape.createInstance()`: 同じ `ShapeResource` を参照する新しい `Shape` を返す
- `Shape.destroy(options = {})`: 形状インスタンスの寿命を終了し、必要なら shared リソースの破棄へつなげる

`Shape` を再利用する予定がない場合は `destroy()` を呼び、runtime から生成したシーン実体をまとめて片付けたい場合は `instantiated.destroy()`、その runtime 自体を今後使わない場合は `runtime.destroy()` を使います。
GCによる遅延回収に依存せず、不要になったリソースは明示的に終了する運用が推奨されます。

### `SkinningConfig`
`SkinningConfig.js` は、スキニング用ユニフォームバッファの既定値と補助関数をまとめます。

- `DEFAULT_MAX_SKIN_BONES`: 既定の最大ボーン数
- `SKIN_MATRIX_VECTORS_PER_BONE`: 1ボーンを何個の `vec4` で送るかを表す定数
- `SKIN_MATRIX_FLOATS_PER_BONE`: 1ボーンあたりの浮動小数点数の個数
- `alignTo(value, alignment = 256)`: WebGPUの dynamic ユニフォームオフセットが指定バイト数の倍数になるように値を切り上げる

### 典型的な読み順
1. `Screen` と `Shader`
2. `Shape` と `Space`
3. `ModelAsset` と `ModelLoader`
4. `SceneAsset` と `SceneLoader`
5. `WebgApp`
6. `Diagnostics` と `DebugProbe`
7. `AudioSynth` / `GameAudioSynth`
8. `Touch` / `InputController`
