# model_shape

[English](README.en.md) | 日本語

![model_shape](./model_shape.jpg)

## 概要
- Primitive.js が返す ModelAsset を ModelValidator で検証し、ModelBuilder で Shape に変換して表示するサンプルです。
- 法線マップ付きで複数形状を並べますが、形状生成経路を Shape 直書きではなく Primitive -> ModelAsset -> validate -> build に揃えている点が主な特徴です。
- WebgApp.js を使って、初期化、メッセージ表示、ループを高レベル API でまとめています。

## 実行方法
- 実行ファイルは [./model_shape.html](./model_shape.html) です
- WebGPU に対応したブラウザで開き、必要に応じて help panel や HUD と合わせて確認してください

## 使用している webg 機能
- WebgApp: 標準初期化、描画ループ、操作ガイド表示
- Primitive: 基本プリミティブを ModelAsset として生成
- ModelAsset: データ表現の共通入口
- ModelValidator: geometry / animation / node などの整合検証
- ModelBuilder: ModelAsset から Shape 群を構築
- SmoothShader: 通常テクスチャ + 法線マップ描画
- Texture.buildNormalMapFromHeightMap: 同一画像から法線マップ生成

## 確認ポイント
- Primitive が返した ModelAsset をそのまま validator に通せることを確認します
- ModelBuilder を経由して生成した Shape でも、法線マップ付き描画が成立することを確認します
- shapes と比べて、見え方の差より Primitive -> ModelAsset -> validate -> build の処理フローを追うサンプルであることを確認します
- ワイヤーフレーム切り替えや法線マップON / OFFで、生成経路が変わっても表示制御が破綻しないことを確認します

## 操作方法
- ドラッグ / 矢印キー: オービットカメラ回転
- ホイール / [ / ]: ズーム
- Space: 回転の一時停止
- N: 法線マップ ON / OFF
- W: ワイヤーフレーム ON / OFF
- R: カメラを初期位置へ戻す
