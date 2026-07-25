# materials

[English](README.en.md) | 日本語

![materials](./materials.jpg)

## 概要

このサンプルは、同じ16個のイコスフィアを標準の`SmoothShader`とDeferred Lightingで切り替えて描き、材質パラメーターの意味と見え方を比較します。同じシーングラフ、カメラ、頂点法線、光源位置を使うため、形状や視点の差ではなく、Phong型とGGX型の照明モデルの差を観察できます。

`SmoothShader`は`ambient`、`specular`、`power`を主に使用します。Deferred LightingはG-bufferへ保存した`specular`、`roughness`、`metallic`、`emissive`をGGX反射モデルで評価します。同じ`specular`という名前でも、標準側では白いハイライトの加算強度、Deferred側では非金属F0の0から4%を指定する倍率であり、同じ数値が同じ反射率を意味するわけではありません。

## 表示の読み方

初期状態は4×4の比較格子です。上から下へ`roughness / power`、左から右へ`specular / metallic`が変化します。標準表示では`roughness`と`metallic`を読みません。Deferred表示では`power`を読みません。片方だけが読む値を操作することで、各パラメーターの担当範囲を確認できます。

Smooth用ambientは0.18、Deferred用の線形拡散環境強度は0.035として別々に管理します。両者は照明式での意味が異なるため、一つの数値を共有しません。Deferred側の最終表示は、照明モデルの比較へReinhard圧縮を混ぜないようlinear clampを使用し、その後に正確なsRGB表示変換を行います。

イコスフィアは分割数2の162共有頂点と320三角形からなり、位置を正規化した球面法線を使用します。UV継ぎ目で複製される頂点にも同じ手動法線をコピーするため、標準経路とG-buffer経路が同じ滑らかな法線を読みます。

## 操作方法

[materials.html](./materials.html)をWebGPU対応ブラウザで開きます。

- `M`: `SmoothShader`とDeferred Lightingを切り替える
- `G`: 4×4格子と全16個へ同じ値を使う均一表示を切り替える
- `R`: 初期値へ戻す
- `/`またはcanvasのダブルタップ: Command Paletteを開く
- ドラッグまたは矢印キー: カメラを回転する

Command Paletteでは描画方式、配置、RGB、現在の描画方式に対応するambient、specular、emissive、roughness、metallic、powerを変更できます。格子表示では相対的な4段階を保ったまま入力値が反映され、均一表示では入力値が全16個へそのまま適用されます。

## 実装上の要点

標準経路は`Space.draw(cameraFrame)`でforward描画します。Deferred経路は、同じ`cameraFrame`を`ComputeEffectPipeline.renderScene()`と`encode()`へ渡し、G-buffer生成と後段照明が同じカメラ状態を共有するようにします。完成した表示色は`beginPresentPass()`でcanvasへ転送し、`clearDepthBuffer()`でHUD用のdepth付きpassへ戻します。

材質値は、片方の描画方式が読まない場合もShapeへすべて明示します。欠落値を推測するフォールバックは使用しません。このサンプルは環境鏡面反射を使用しないため、完全金属は黒くなる場合があります。既定格子のmetallicは0.00、0.25、0.50、0.75としています。均一表示では利用者が1.0を明示して挙動を確認できます。
