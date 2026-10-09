# Studio Small 01 HDRと生成cache

`studio_small_01_1k.hdr`はPoly Havenの[Studio Small 01](https://polyhaven.com/a/studio_small_01)から取得した1K Radiance HDRです。著作者はGreg Zaal、ライセンスはCC0です。元assetのSHA-256は`a2d308672f077b0872686a439d76dc3ace91274380ae2e5f02c653c3ccbc8407`、容量は1,701,440 byte、復号寸法は1024×512、最大radianceは606です。

`studio_small_01_1k_standard.webgpbr`は、Radiance標準primariesをlinear sRGBへ変換し、`standard` presetと`webg-split-sum-ggx-environment-mis-linear-srgb-v3`で生成したwebg用cacheです。SHA-256は`7a5b67be27efcf768b5e5b027c0395d9eed0a23e3184b5d89c2e48c948213f2d`、容量は4,627,199 byteです。詳しい色変換、生成条件、memory、処理時間は`studio_small_01_1k_standard.json`、2048 sample CPU基準との比較は`studio_small_01_1k_standard_quality.json`に記録しています。

512 sampleと2048 sample基準の正規化RMSEはirradiance 0.010504、specular mip 0が0.00003517、最も粗いmip 8が0.010160です。BRDF LUTは0.00161427です。色変換後のlinear sRGBと同じ輝度係数をimportance samplingに使用した確定版です。

次のPNGは、コアの`ProceduralEnvironment.js`から各presetのradianceを`resolution: { width: 256, height: 128 }`で生成し、`intensity: 0.5`、`exposureEv: 0`、Reinhard tone mapping、sRGB変換、`scale: 1`で作成した確認画像です。いずれも256×128のRGBA8 PNGです

- [`procedural_environment_blue-sky.png`](procedural_environment_blue-sky.png)
- [`procedural_environment_dark-studio.png`](procedural_environment_dark-studio.png)
- [`procedural_environment_bright-forest.png`](procedural_environment_bright-forest.png)
- [`procedural_environment_sunset-ocean.png`](procedural_environment_sunset-ocean.png)
- [`procedural_environment_bright-summer-ocean.png`](procedural_environment_bright-summer-ocean.png)
- [`procedural_environment_woody-room-two-windows.png`](procedural_environment_woody-room-two-windows.png)
