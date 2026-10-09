# webg 統合版

`webg.core.min.js` は、クラス名・関数名を保持して圧縮したES Modules形式の統合版です。
`webg.core.js` は、コメントと通常の書式を保持する版です。

```js
import { WebgApp, Shape, Primitive, WaterBody, PbrRenderer }
  from "./lib/webg.core.min.js";
```

importの相対パスは、読み込むJSまたはHTMLの配置に合わせて指定します。
画像・モデルなどの素材は、アプリ側で参照URLを設定します。

元ソースは `webg/` にあります。ソースマップは `../webg/` を参照します。
著作権表示とライセンス全文は、各JSの先頭と `LICENSE` に含まれます。
`build_report.json` は、生成時の元ファイル、export対応表、容量を記録します。

生成コードと開発用検証は `user/bundle/` で管理します。
リポジトリのルートから、次のコマンドで生成・検証できます。

```bash
npm --prefix user/bundle run build:lib
npm --prefix user/bundle run verify:lib
```

サンプルの変換ツールは `convert_imports.mjs` です。
リポジトリのルートで依存パッケージを揃え、候補を確認できます。

```bash
npm --prefix lib ci
node lib/convert_imports.mjs samples/aquarium
```

手順は日本語bookの `付録C_統合版の利用.md`、英語bookの `Appendix_C_Bundle.md` にあります。
