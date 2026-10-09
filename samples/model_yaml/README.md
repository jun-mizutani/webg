# ModelYAMLの読込みと複数配置

[English](README.en.md) | [実行](model_yaml.html)

## このサンプルでできること

コメント付きの[model.yaml](model.yaml)をModelAssetとして読み込み、台座付きの青い結晶を3組表示します。ModelYAMLは個別モデルの形状、マテリアル、Node階層を保存する形式です。この例では2つのメッシュと3つのNodeを記述し、同じモデルを一度構築して3回配置します。

WebgAppの標準Forward描画とオービットカメラを使います。ドラッグで視点を回し、ホイールで拡大縮小します。「回転を開始」で各結晶がY軸まわりに回転し、「回転を停止」で止まります。台座はそのままなので、親子関係と個別Nodeの操作を確認できます。

## 起動と保存

リポジトリをHTTPサーバーで配信し、WebGPU対応ブラウザで[model_yaml.html](model_yaml.html)を開きます。localhostまたはHTTPSを使用してください。画面下部に検証結果、メッシュ数、Node数、三角形数、配置数、コメント数を表示します。「読み込んだYAML原文」を開くとコメントを含む入力全体を確認できます。

「YAML保存」は元のモデル定義を保存します。「gzip YAML保存」は同じ原文を圧縮します。画面上の3組の配置と回転はJavaScriptが作る実行時の状態です。保存されるのは1組分のモデル定義で、画面全体の保存にはSceneYAMLを使います。

## 実装の流れ

main.jsではModelAsset.load("./model.yaml")で読み込み、assertValid()でモデル内部の参照と形状データを検証します。WebgApp.init()の完了後にasset.build(app.getGPU())を一度呼び出し、runtime.instantiate(app.space)を3回呼び出します。配置ごとのnodeMapからrootとgemを取得して位置と回転を変更します。GPUの形状データを共有し、Nodeの姿勢を配置ごとに管理する例です。

ModelYAMLのversionは文字列の"1.0"です。positionsはXYZが連続する配列、indicesは3要素で1三角形を表します。ModelAssetのrotationは[x, y, z, w]順のQuaternionです。台座と結晶の色はmaterialsのshaderParamsへ記述します。法線はModelBuilderが形状から計算します。

getSourceDocument()から入力原文とコメントを取得します。このサンプルはAssetの値を保持するため、toYAMLText()とdownloadYAML()はコメントと字下げを保った原文を返します。Nodeの回転は表示中の姿勢へ反映し、Assetの値は保持します。コメント付きAssetの値を直接変更して保存しようとすると、コアはコメント保持のため例外で停止します。コメント付きモデルを編集する場合は、更新したYAML原文をfromYAML()へ渡してください。

## ファイルと確認点

model.yamlがモデル定義、main.jsが読込み・構築・操作、model_yaml.htmlが実行ページです。各モデルは2メッシュ、3 Node、20三角形です。3組が同時に表示され、回転操作では結晶だけが動くことを確認してください。保存したYAMLは入力原文と一致し、gzipを展開しても同じ文字列になります。起動や保存に失敗した場合は理由を画面へ表示します。

ページを閉じると更新を停止し、配置したインスタンス、共有モデルリソースの順に解放します。
