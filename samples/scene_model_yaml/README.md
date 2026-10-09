# SceneYAMLとModelYAMLの組合せ

[English](README.en.md) | [実行](scene_model_yaml.html)

## 概要

SceneYAMLからModelYAMLを参照し、3個の青いBoxをPBRで表示して床へ落とします。個別モデルの形状を保存するModelYAMLと、作品全体の表示・物理条件を保存するSceneYAMLを一緒に使うサンプルです。

[model.yaml](model.yaml)には1mのBoxと8×0.3×6mの床のgeometry、マテリアルID、4つのNode、初期位置を記述します。同じBoxメッシュを3つのNodeから参照し、中心の高さを2m、3m、4mに設定しています。[scene.yaml](scene.yaml)はmodelAssetUrl: ./model.yamlでこのモデルを読み込み、PBRの色・金属度・粗さ、環境光、重力、衝突形状を指定します。

## 起動と操作

リポジトリをHTTPサーバーで配信し、WebGPU対応ブラウザで[scene_model_yaml.html](scene_model_yaml.html)を開いてください。localhostまたはHTTPSを使用します。起動時は物理を停止しているので、初期配置を見渡せます。ドラッグで視点を回し、ホイールで距離を変更します。

「開始」でBoxが床へ落下し、「停止」で物理の進行を止めます。「初期位置へ」は物理を停止し、ModelYAMLの初期位置へ戻します。描画とカメラ操作は物理の停止中も利用できます。画面には4 body、4 binding、固定更新240Hz、両文書のコメント数を表示します。

## 二つのYAMLのつながり

SceneYAMLのobjects[].nodeはModelYAMLのnodes[].idを参照します。objects[].idは作品側で物体を識別する名前です。例えばfalling-box-1がbox-node-1へ対応します。現行の外部モデル経路では、初期位置をModelYAMLのNodeへ記述し、SceneYAMLのobjectsでそのNodeと物理設定を結び付けます。

SceneYAMLのmaterials[].assetMaterialIdはModelYAMLのmaterials[].idへ一致させます。この例ではbox-materialへ青い金属の外観を適用し、floor-materialへ粗い床の外観を適用します。マテリアルを共有する3個のBoxには同じ外観が反映されます。

表示メッシュと衝突形状は別々に記述します。SceneYAMLのphysics.shapeにBoxの寸法を明示し、colliderRelation: matchとspatialMatch: require-matchで表示との寸法対応を確認します。床をstatic、3個のBoxをdynamicにします。Boxの質量は各1kg、重力はY方向へ-9.8m/s²、固定時間刻みは1000/240ms、solverIterationsは14です。

## 読込みと保存

main.jsはSceneAsset.load("./scene.yaml")で原文と値を読み込み、assertValid()後にcreateWebgSceneApp({ project: sceneAsset })へ渡します。WebgSceneAppがSceneDefinitionを使って相対URLを解決し、ModelAsset.loadでModelYAMLを読み込みます。モデルの構築、PBRマテリアルの適用、Compute物理bodyの登録、Node同期をコアの高水準APIへ任せます。

読み込み済みのModelAssetはsceneApp.model.assetから取得します。原文表示にも読み込み済みのAssetを使います。画面下部の二つの折り畳み欄で、コメントを含む原文を確認できます。

「SceneYAML保存」と「ModelYAML保存」は、それぞれ入力の初期定義を原文のまま保存します。保存対象は初期定義で、実行中の物体位置とは分けて扱います。保存したscene.yamlとmodel.yamlは同じフォルダへ置き、相対参照を維持してください。外部モデルはModelYAMLの保存ボタンで個別に保存します。

## ファイルと実装メモ

scene_model_yaml.htmlが実行ページ、main.jsが初期化とボタン処理、scene.yamlが作品設定、model.yamlがモデル定義です。日英READMEとindexに同じ説明を掲載しています。

両Assetの値を変更せず、物理結果は実行時のNodeへ同期するため、保存時にYAMLコメントを保持できます。起動・保存のエラーは画面へ表示します。実行中の物理や描画エラーでは更新を止めます。終了時はWebgSceneApp.destroy()でリソースを解放します。

このサンプルは、SceneYAMLのinline mesh経路と外部ModelYAML経路のうち、外部モデルを使う構成を示します。ModelYAMLだけの読込みと複数配置は[model_yaml](../model_yaml/index.html)も参照してください。
