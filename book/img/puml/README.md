# PlantUML 図版ソース

このディレクトリには、まず PlantUML で構造図を作り、そこから SVG を生成する図版ソースを置く。

## 目的

SVG を直接編集すると、box の追加、矢印の付け替え、ラベル文言の見直しを行うたびに座標調整が大きくなりやすい。
そのため、最初の構造検討は PlantUML のような宣言的な形式で行い、必要な場合だけ生成後の SVG を手で追い込む流れを基本とする。
このとき最初から `package` などで囲って自動配置を強く縛るのではなく、まずは box と矢印だけの素の構成で関係を固める。

## 基本フロー

1. このディレクトリに `figXX_YY_name.puml` を作る
2. `node tools/render-plantuml-diagrams.mjs` を実行する
3. `book/img/svg/` に生成された SVG を確認する
4. 必要ならごく一部だけ SVG を手作業で微調整する
5. 手作業の最終結果は、可能な範囲で PlantUML や生成スクリプトへ戻す

## ファイル名

- PlantUML ソース: `fig07_01_material_and_shader_routing.puml`
- 公開 SVG: `book/img/svg/fig07_01_material_and_shader_routing.svg`

この対応が追いやすいよう、基本的にベース名はそろえる。

## 使い分け

- 構造図、関係図、役割分担図のように、box と矢印の関係が中心の図は PlantUML を優先する
- 最初の段階では `package` や過度なグループ化を避け、hidden link と note で最小限の並びだけを支える
- 文字詰め、余白、矢印位置をかなり細かく詰める必要がある図は、生成後の SVG 微調整を併用する
- 既存の `tools/generate-svg-diagrams.mjs` は、PlantUML に載せにくい図や、すでに SVG 側で細かく仕上げた図の管理に使う

## 運用の考え方

PlantUML は構造確認と文言の見直しを速く回すための入口として使い、そのまま `book/img/svg/` へ出力する。
特に、box の余白や矢印の接続位置をかなり詰める図では、PlantUML の自動配置だけで完成形にしようとせず、必要な場合は生成後の SVG を微調整してから、その結果をできる範囲で PlantUML 側へ戻す。
