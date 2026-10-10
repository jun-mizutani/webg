# PBR Reference

`pbr_reference`は、webgのPBR forward描画と遅延描画を同じ材質、照明、環境で比較する公開サンプルです。PBRの数値契約はコアと`headless_tests`が所有し、このサンプルは表示、操作、実写HDR、診断結果の確認を担当します。

手続き環境の生成器は`webg/ProceduralEnvironment.js`にあります。`listProceduralEnvironmentPresets()`で利用できる名前を取得し、`createProceduralEnvironmentData({ preset: "dark-studio" })`のように指定します。`createProceduralEnvironmentPng({ preset: "dark-studio", intensity: 0.5, scale: 4 })`は、radianceをReinhard tone mappingとsRGB変換したRGBA8 PNGの`Uint8Array`を返します。表示や保存では、戻り値を`new Blob([pngBytes], { type: "image/png" })`へ渡します。

画面には15個の球があります。横方向はroughness 0.08、0.20、0.40、0.65、0.90、縦方向はmetallic 0.0、0.5、1.0です。全ての球が同じbase color、誘電体F0 0.04、白色直接光を使います。

`Deferredへ切替`ボタンまたはSpaceキーで、`PbrForwardShader`と`ComputeEffectPipeline`の`DeferredLightingPass`を切り替えます。Shape、camera、材質値は両経路で共有します。両経路ともReinhard Tone Mapと標準sRGB変換を使い、SSAO、Shadow、SSR、Fog、Toon、DoF、Bloom、Edge、Vignetteは無効です。

`IBLを有効化`ボタンはDeferredへ切り替え、直接光に加えて最小構成の画像ベース照明を評価します。起動時は小さな手続き生成環境を使います。`診断HDR IBLへ切替`を押すと、Radiance HDRからCompute Shaderで前処理し、CPU参照値との比較を通過した環境へ切り替わります。どちらも線形HDRの緯度経度画像、拡散irradiance map、roughness別の鏡面map、BRDF積分LUTから構成されます。IBLを無効に戻せば、forwardとdeferredの直接光だけを比較できます。

`PBR SSRを有効化`ボタンはDeferredとIBLを有効にし、画面内でray hitした反射だけを鏡面IBLへ置き換えます。SSR出力のRGBはhit位置のTone Map前の線形HDR radiance、alphaはhit confidenceです。ray missや画面端では同じHDR環境のroughness別鏡面IBLを保ち、直接光、拡散IBL、発光は置き換えません。透明物はSSR後に描くため、現在は反射元にも反射面にも含まれません。

`HDR背景を表示`は、照明の入力になった元の緯度経度HDRを物体のないpixelへ表示します。球は、その同じHDRから生成したirradiance、roughness別鏡面map、BRDF LUTで照らされます。背景は元画像を表示し、球は材質に応じて積分した照明を使います。`IBLのみで確認`はdirectional、point、cone、shadowを無効にし、環境由来の拡散反射と鏡面反射だけを残します。`環境を45°回転`は背景と不透明／透明物のIBLをworld-spaceのY軸周りへ一緒に回すため、背景の明部と球の反射が対応して移動することを確認できます。

背景とIBLは共通の線形HDR処理フローを通り、最終段階で同じReinhard Tone MapとsRGB変換を受けます。背景表示を要求した環境に元radianceがない場合や、環境なしで回転を指定した場合は例外です。確認画像は`hdr_background_ibl_only_0deg.jpg`と`hdr_background_ibl_only_45deg.jpg`です。

画面の`HDR Input`はRadiance RGBE decoderの診断結果です。起動時に8×4の2:1緯度経度HDRをbyte列から復号し、標準方向`-Y +X`、`EXPOSURE`補正、高輝度値が維持されることを確認します。診断HDRは上側を青、下側を暖色、左右4方向を異なる色にし、上下反転、左右反転、roughness mip、高輝度clipを検出しやすくしています。

`PbrEnvironmentReference.js`と`PbrEnvironmentCompute.js`が同じHammersley点列、方向変換、cosine-weighted拡散積分、GGX importance sampling、roughness規則から5段階の鏡面mapと32×32 BRDF LUTを生成します。画面の`HDR Prefilter`にはCPU時間、GPU完了待ちを含むCompute時間、半精度textureから読み戻した全要素の最大絶対誤差を表示します。cache検証後は、そのCompute生成値をcacheから復元したresourceが15球を照らします。`手続きIBLへ戻す`で手続き生成環境を選択できます。

数値検証を通過したCompute結果と元HDRを版付きbinary cacheへ保存します。cacheはsource ID、元HDRの寸法・色空間・方向、全出力解像度、specular mip数、三種類のsample count、生成algorithm版をmetadataへ持ち、radiance、irradiance、specular、BRDF LUTをlittle-endian binary16で保持します。参照アプリはmemory上のcacheをBlob URLから非同期fetchし、同じkeyの二回取得が一つのGPU environmentを共有することを確認してから、その復元環境を実際の照明へ使います。

画面の`HDR Cache`が`v1 / 6.9 KiB / reused`なら、7054 byteの診断cacheが版1として読まれ、二回の取得で同じGPU resourceが再利用されています。source ID、生成条件、版、mip寸法、payload長が違うcacheは例外です。通信失敗やcache破損も例外として報告します。利用中handleを`release()`した後にだけ`evict()`でき、利用中の強制破棄は拒否されます。

`環境診断`ボタンは、最終球、元HDR radiance、拡散irradiance、GGX prefiltered specular、BRDF LUTを順に全画面表示します。元HDR、irradiance、specularは診断用露出を1 EVずつ変更できます。`次のSpecular Mip`はmipと対応roughnessを一段ずつ進め、画面の`View Detail`へ解像度、mip、roughness、露出を表示します。BRDF LUTはRをFresnel scale、Gをbiasとして線形表示します。各成分は反射計算の係数です。

診断画像をクリックすると、白黒crosshairが選択位置へ移動し、`Selected Pixel`へUV、texel座標、cache内のbinary16復元値を表示します。画像は縦横比を保って全画面へ収め、黒帯のclickは選択として扱いません。診断露出は画面表示だけを変え、照明に使う環境強度やcache値を変更しません。確認画像は`environment_debug_radiance.jpg`、`environment_debug_irradiance.jpg`、`environment_debug_specular_mip.jpg`、`environment_debug_brdf_lut.jpg`です。

`White Furnace`、`GPU Interval`、`Env Memory`を表示します。White Furnaceは、白い一様環境で誘電体と金属、roughness 5段階、`NdotV` 4段階の計40点を調べ、energyの上限を1.02とします。判定対象はsingle-scattering GGXのenergy増幅です。複数散乱を含む保存性を評価するときは、散乱モデルに応じた別の検証条件を用意します。

`GPU Interval`はtimestamp-query対応GPUで、Compute前処理の最初のdispatchから最後のdispatchまでを測ります。`HDR Prefilter`のGPU wallはCPUからsubmitして完了を待つ時間で、pipeline準備や待機を含み得ます。`Env Memory`はformatと寸法から求めた論理texture data量を表示します。driver内部のpaddingや管理領域は別に必要です。

ForwardとDeferredは、同じIBL合成、BRDF LUT境界処理、診断HDRを使います。IBLのみを比較するときはForwardのshader既定radianceを0へ設定し、両方の画面で`Error`が`なし`であることを確認します。輪郭のラスタライズとG-buffer量子化による差も含め、反射と照明の対応を観察してください。

CPU実装を基準にCompute Shader版の出力を比較します。診断設定の誤差上限は0.25です。上限超過、非有限値、寸法またはmip数の不一致は例外になります。8×4の診断入力は出力の検証に使い、実写HDRの速度を比較するときは同じ画像と生成条件で計測してください。

実写HDRは`診断HDR IBLへ切替`をもう一度押して選択できます。使用する`Studio Small 01`はPoly HavenのCC0 assetで、元HDR 1024×512と、オフラインCPU toolで生成した約4.41 MiBの`.webgpbr` cacheを同梱しています。`Real HDR Asset`には読込、復号、GPU転送を合わせた時間が表示されます。元HDRを背景へ表示し、同じ環境から得たIBLで15球を照らします。

`standard`はirradiance 64×32、specular 256×128から9 mip、BRDF LUT 128×128、各512 sampleです。`webg-split-sum-ggx-environment-mis-linear-srgb-v3`は、Radiance標準primariesをlinear sRGBへ変換し、linear sRGB輝度による環境proposalを拡散のcosine proposalと鏡面のGGX proposalへMISで組み合わせます。

診断HDRのCompute実装はCPU版と同じalias tableとPDFを使います。生成中はalias tableに1 pixel当たり8 byteを使います。alias tableは生成処理のためのデータで、runtimeはcacheのIBL textureを参照します。

コアの`RadianceHdr.js`は`FORMAT=32-bit_rle_rgbe`、標準`-Y height +X width`、線形`GAMMA=1`を受け付け、flat、旧RLE、新RLE scanlineを復号します。`EXPOSURE`と`COLORCORR`はfileへ適用済みの累積倍率として除算し、元radianceへ戻します。未知format、別方向、切れたRLE、余分なpayload、非有限metadataは例外です。復号値は`linear-radiance-rgb`として保ち、別関数でRadiance標準primariesの白色点EからsRGB D65へBradford色順応して`linear-srgb`へ変換します。色域外は`reject`または`clip`を必ず明示し、標準以外の`PRIMARIES`は未対応変換として例外にします。

`PBR Textureを有効化`ボタンはDeferredへ切り替え、手続き生成したmetallic-roughness、環境遮蔽、発光テクスチャを15個の球へ適用します。metallic-roughnessテクスチャはglTFと同じくGにroughness、Bにmetallicを格納し、材質ごとの一様係数と乗算します。環境遮蔽テクスチャはRを使い、ambientとIBLの間接光だけを弱めます。発光テクスチャはsRGBから線形値へ変換した後、基本色とは独立した線形HDRの`emissive_factor`を掛けるため、1.0を超える発光を確認できます。環境遮蔽の模様を比べるときはIBLも有効にしてください。

`Alpha 3平面比較を表示`ボタンは、data URIへ埋め込んだ5種類の2×2 textureを持つ`pbr_fixture.gltf`を通常の`WebgApp.loadModel()`で読み、そのbase color textureを3枚の開いた平面へ適用します。平面は左から`OPAQUE`、`MASK`、`BLEND`で、同じcamera、照明、材質係数、textureを使います。fixture表示時は比較に必要なDeferredとIBLを自動的に有効にします。

基本色textureの4画素にはalpha 1.0、約0.19、約0.86、約0.38が入っています。nearest samplingを明示しているため画素間でalphaは補間されません。`OPAQUE`は4領域のalphaを無視し、`MASK`は`alphaCutoff=0.5`未満の2領域をG-bufferへ書かず、`BLEND`は材質alphaが1.0でも4領域それぞれのtexture alphaで背景と合成します。背後には明暗checkerを置いているため、MASKでは硬い穴、BLENDではcheckerの透け方として差を同時に確認できます。

3枚は背面を持たない片面平面です。閉じた立体の背面がMASKの穴を埋めたり、BLENDで前面と背面が重なったりしないため、alpha modeそのものを比較できます。double-sided pipelineと裏面法線反転は別の検査項目であり、この3平面比較には混在させません。

`透明PBR Fixtureを表示`ボタンは、alpha専用比較とは別に、元のglTF立方体を`BLEND`材質として表示します。base colorとnormalに加え、metallic-roughness、occlusion、独立HDR emissiveの5 textureを透明共有GGXへ接続し、Deferredと同じirradiance map、roughness別鏡面map、BRDF LUTを使います。さらにdirectional shadow、青いpoint light、橙色のcone lightを同時に有効化し、透明fragment自身の位置で影と局所光が評価されることを確認します。

`物理光源へ切替`ボタンはDeferredへ切り替え、相対強度と有限半径減衰からphotometric単位と逆二乗減衰へ切り替えます。photometric時のdirectional lightは照度lux、point lightとcone lightは光度candelaです。局所光には、光源中心で逆二乗式が無限大にならないようにする`minimumDistance`を必ず指定します。`radius`の内側では逆二乗減衰を使い、範囲端だけを連続的に0へ落とします。

photometric時は`exposureEv100=9.0`を使用します。手続き生成環境のIBL強度500は表示比較用の尺度です。測光されたcd/m²との比較には、校正済みHDR画像とその測定条件を用意してください。この画面では、単位、距離減衰、露出の処理フローを一括で切り替え、透明物にも同じ局所光減衰が適用されることを確認します。

コア側では`PbrBrdf.js`が直接光BRDFを共有し、`PbrEnvironmentReference.js`がCPU参照値、`PbrEnvironmentCompute.js`がGPU resourceを生成します。Compute出力はstorage書込みとsamplingの両方に対応する`rgba16float`です。BRDF LUTもR/Gだけを使う`rgba16float`とし、未使用channelを照明へ混ぜません。IBLを指定した場合は一様`ambient`を0にする必要があり、irradiance、prefiltered specular、BRDF LUT、sampler、mip数の一部が欠けていると例外になります。

実行にはWebGPU対応ブラウザとHTTP serverが必要です。repository rootでserverを起動し、`/samples/pbr_reference/pbr_reference.html`を開きます。

```sh
python3 -m http.server 8000
```

サンプル固有のHDR入力、接続、表示用Forward shaderと、コアの数値契約は次で確認します。

```sh
node --experimental-default-type=module samples/pbr_reference/pbr_reference_test.mjs
node --experimental-default-type=module samples/pbr_reference/pbr_forward_shader_test.mjs
node headless_tests/core/radiance_hdr/headless_probe.js
node headless_tests/core/pbr_environment_reference/headless_probe.js
node headless_tests/core/pbr_environment_compute/headless_probe.js
node headless_tests/core/pbr_environment_cache/headless_probe.js
node headless_tests/core/pbr_environment_debug_pass/headless_probe.js
node headless_tests/core/pbr_environment_evaluation/headless_probe.js
```

透明forward shaderは、GGX直接光、base colorとnormal、metallic-roughness、occlusion、独立HDR emissive、texture alpha、IBL、directional／spot shadow、point／cone lightを扱います。局所光はDeferredと同じ相対減衰または逆二乗減衰を使います。occlusionは直接光と発光には掛けず、IBLの間接光だけを弱めます。shadowは不透明G-buffer位置のscreen-space visibilityを流用せず、透明fragmentのview-space位置からshadow mapをPCF参照します。`SmoothShader`には派生shaderが材質textureと追加Bind Groupを拡張するhookを加え、標準SmoothShaderのlayoutと表示はそのまま使います。
