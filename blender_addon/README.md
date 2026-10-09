# Webg SceneYAML I/O

Blender 4.5以降向けのSceneYAML入出力アドオンです。ソース内のコメントとdocstringは英語で記述しています。読み込んだYAMLに含まれる日本語コメントは元の言語のまま保存します。

## インストールと操作

`python3 blender_addon/build_scene_yaml_addon.py`で配布用ZIPを生成します。Blenderで生成された`blender_addon/blender_scene_yaml.zip`をアドオンとしてインストールし、Webg SceneYAML I/Oを有効にします。

英語の利用者向けには[English README](./README.en.md)を用意しています。

1. File > Import > Webg SceneYAMLでprojectを開きます。
2. オブジェクトを移動・回転・拡縮します。PBRの共通項目はPrincipled BSDFで編集できます。
3. File > Export > Webg SceneYAMLで保存先を選びます。

`.yaml`、`.yml`は通常のUTF-8テキスト、`.yaml.gz`、`.yml.gz`はgzip圧縮されたUTF-8テキストとして入出力します。Export時はファイル名の拡張子で圧縮を選択します。新しい保存先を指定して圧縮形式を変更できます。

## ファイルごとの役割

アドオンは、配布用ZIPを作るファイルと、Blenderの中で実際に動くファイルに分かれています。

| ファイル | 役割 |
|---|---|
| `build_scene_yaml_addon.py` | リポジトリ側で実行する配布用ビルドスクリプト。`blender_scene_yaml/`内の4モジュールを`blender_scene_yaml.zip`へまとめます。Blenderのアドオンとして実行するモジュールではありません |
| `blender_scene_yaml/__init__.py` | Blender側の入口。Import、Exportのメニューとオペレーターを登録し、YAMLの読み込み・書き出し全体を進めます |
| `blender_scene_yaml/scene_yaml.py` | Blenderに依存しないSceneYAMLの解析と、元のコメント・改行・キー順を保った値の更新を担当します |
| `blender_scene_yaml/animation.py` | Blenderに依存しないアニメーション定義の検証と補間を担当します |
| `blender_scene_yaml/blender_animation.py` | BlenderのAction/F-CurveとSceneYAMLの`animations[]`を相互変換します。Import時はYAMLのキーフレームからActionを作り、Export時は現在のActionをYAMLのキーフレームと比較して変更を反映します |

`build_scene_yaml_addon.py`は`blender_animation.py`を直接実行するファイルではありません。配布時に`blender_animation.py`をZIPへ収録し、Blenderでアドオンを有効にした後に`__init__.py`が`blender_animation.py`を呼び出します。したがって、ビルド時の処理とSceneYAMLを編集・変換する実行時の処理を分けて確認できます。

## 対応範囲

| 機能 | 現在の動作 |
|---|---|
| Box、Sphere、Capsule | Import、位置・回転・寸法の書戻し |
| objectSet | grid3d、variant cycle、instance cycle/rangeを展開し、個体編集をoverrideへ書戻し |
| PBR | inlineおよび外部材質のcolor、metallic、roughness、specularを編集 |
| object animation | Action/F-CurveとSceneYAMLの位置・Quaternionキーを相互変換。scaleは一定の正の一様値 |
| 物理設定 | objectの`webg_physics_json`に保存。編集したJSONをYAMLへ反映 |
| Joint、renderer | 元のYAML定義を保持 |
| コメントと書式 | 無編集時は原文一致。部分編集時は値の範囲だけ更新 |
| `.blend`保存 | 原文YAMLを専用Textへ保存し、再起動後もYAMLを基準に往復を継続 |
| 同時編集 | ディスクとBlenderを三者比較。同一項目の競合は項目名と値を表示して保存を中止 |
| 保存 | 一時ファイルから置換。既存ファイルには世代付き`.bak`を作成 |

primitive往復の実例は`project_app_sphere_plane`、`project_app_joint`、`project_app_object_set`、`project_app_object_set_variants`、`domino_36_03`です。object animationは[`scene_animation.yaml`](../samples/project_app/scene_animation.yaml)と[再生ページ](../samples/project_app/scene_animation.html)を参照できます。Import後は対象コレクションの物体を編集します。新規作品は最小のSceneYAMLから始めるほか、原文を保持するセッションがない場合には、各meshへ一意な`webg_id`を付けたBoxのシーンから直接Exportできます。この新規出力はmodifierのないBoxを対象とし、親も出力対象のBoxへ限定します。

アニメーションの対象は表示専用objectです。位置は線形補間、Quaternionは球面線形補間で再生します。Bezier曲線を含む編集はExportの`Allow curve approximation`を選択するとキー時刻で出力できます。キー間の動きはBlenderとwebgで差が生じ得るため、区間内の姿勢も確認してください。joint対象、物理bodyやその祖先のアニメーション、変化するscaleは今後の拡張です。キー削除や部分的なretimingはYAMLを編集して再Importします。

任意meshを使う`project_app_physics`のImport、頂点編集、modifierの書戻しは対応範囲外です。Boxの追加、外部マテリアルのPBR値更新、既存オブジェクトの物理値更新はYAMLの該当箇所へ反映します。SphereとCapsuleの寸法変更は一様scale、Boxは各軸scaleに対応します。元のassetやBlenderシーンを自動で置換する旧アドオンとは別のメニューを使用します。

## コメント保持の実装

`__init__.py`はBlenderとの接続を担当し、`scene_yaml.py`は外部パッケージに依存することなく限定SceneYAMLを解析します。文書全体を元の文字列として保存し、値ごとの文字範囲へ差分を適用するため、コメント、改行、引用符、キー順を維持できます。複雑な構造変更は原文を再構成する前にエラーで通知します。

`WebgSceneYAML_Document_…`というTextデータに原文YAMLをそのまま保存し、`WebgSceneYAML_State_…`にはファイルパスなどの接続情報だけを保存します。オブジェクトの基準値やYAMLの意味を持つActionスナップショットは保存せず、Export時に原文YAMLと現在のBlender状態を直接比較します。通常のテキスト編集は元のYAMLファイルで行ってください。原文Textは`.blend`の保存対象です。

既存オブジェクトの移動・回転・拡縮、物理値、PBR値は変更された項目だけをYAMLへ反映します。Blenderで新しいBoxを追加する場合は、オブジェクトのカスタムプロパティ`webg_id`へ一意なIDを設定し、対象SceneYAMLのコレクションへ入れてからExportします。Boxはメッシュから形状を取得できます。SphereとCapsule、物理設定を持つ新規オブジェクトは`webg_shape_json`と`webg_physics_json`を明示的に設定します。既存オブジェクトの削除は、コメント付き要素の扱いを明確にするため、YAMLで削除してから再Importする操作に限定しています。

## 検証

```sh
python3 tools/blender_scene_yaml/test_codec.py
blender --background --factory-startup --python-exit-code 1 --python tools/blender_scene_yaml/test_roundtrip.py
node --experimental-default-type=module headless_tests/core/webg_scene_app/scene_gzip_contracts.js
```

Blenderテストは一時フォルダーへYAML、gzip、`.blend`を保存します。無編集往復、移動、objectSet override、コメント保持、再起動後のExportを検証します。WebGPU描画・Compute物理の確認はブラウザーで別途行います。
