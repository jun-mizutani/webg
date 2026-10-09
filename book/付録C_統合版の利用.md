# 統合版の利用

この付録では、`lib/webg.core.min.js`の読み込みと、個別モジュール版を使う
サンプルを統合版へ切り替える手順を説明します。コマンドはリポジトリのルートで実行します。

## 読み込みと配置

```text
lib/
  webg.core.min.js
  webg.core.min.js.map
  webg.core.js
  webg.core.js.map
  convert_imports.mjs
  build_report.json
  package.json
  package-lock.json
  LICENSE
webg/                     コメント付きの元ソースと素材
samples/                  個別モジュール版を使うサンプル
```

リポジトリのルートにあるJSからは、次のように読み込みます。

```js
import { WebgApp, Shape, Primitive, WaterBody, PbrRenderer }
  from "./lib/webg.core.min.js";
```

クラス名はそのまま公開名として使えます。別名は`WebgApp as App`の形で指定します。
コメントを読みながら統合コードを調べる場合は`webg.core.js`も選べます。
ソースマップは、開発者ツールで元ソースの行やブレークポイントへ進むための対応表です。
元ソースへ辿る場合は、`lib/`と`webg/`の相対配置を保持してください。

両方の版は同じAPIを使います。各章の個別importは、統合版では名前付きimportへ
置き換えます。共有JSも含め、アプリ内のコア読み込みを同じ方式へ揃えます。
クラスとモジュール状態を共有し、`instanceof`や物理の接触判定を一貫させるためです。

## 素材を配置する

統合版はJSをまとめたファイルです。画像、フォント、モデル、環境マップは、
アプリ側でURLを設定します。HTML内のコードと外部JSでは、importの基準になる
ファイルが異なるため、配置に合わせて相対パスを確認してください。
`fetch()`などの素材URLは、各APIが使う基準URLに合わせます。

02章のHTTPサーバーとWebGPU対応ブラウザを使って実行します。
統合版を読み込むアプリでは、配布済みJSを利用できます。
以下のNode.jsと依存パッケージは、サンプル変換ツールを実行する際に用意します。

## 変換ツールを準備する

Node.js 22で確認しています。次のコマンドで変換用の依存パッケージを揃えます。

```bash
npm --prefix lib ci
node lib/convert_imports.mjs --help
```

スクリプトは`lib/build_report.json`を使い、元のモジュールと統合版のexportを
対応付けます。統合版、変換スクリプト、対応表は同じ配布版のものを使います。

## 候補を確認する

例えば`samples/aquarium/`を変換する場合は、次のコマンドを使います。

```bash
node lib/convert_imports.mjs samples/aquarium
```

初期動作は候補表示です。変更するファイル、箇所数、変更前後のコードを確認できます。
`--dry-run`も同じ動作です。参照されるローカルJSをたどるため、共有JSと
遅延読み込み先も候補に含まれます。

## コピーを変換する

まず、元サンプルを保持した検証用コピーで動作を確認できます。
`--out`には新規または空のフォルダを指定します。

```bash
node lib/convert_imports.mjs --execute \
  --out user/bundled-samples samples/aquarium samples/water
```

元の相対配置を保持するため、コピーは
`user/bundled-samples/samples/aquarium/`と
`user/bundled-samples/samples/water/`に作られます。
指定したフォルダの通常ファイルはCSS・モデル・文書も含めて複製します。
参照される共有JSも複製・変換します。
フォルダ外にある素材やCSS、JS以外のURLは、コピー先で取得できることを確認します。

リポジトリのルートで02章のHTTPサーバーを起動し、例えば次のページを開きます。

```text
http://localhost:8000/user/bundled-samples/samples/aquarium/aquarium.html
http://localhost:8000/user/bundled-samples/samples/water/water.html
```

表示、カメラ、移動やアニメーション、効果のON/OFFを確認します。
開発者ツールのNetworkでは、`lib/webg.core.min.js`が取得され、
コアの個別JSが併せて読み込まれているかを調べます。
個別JSの取得が残る場合は、共有ファイルや動的importの変換範囲を確認してください。

## 元ファイルへ適用する

候補とコピーの動作を確認したあと、`--out`を省略して実行すると、
元ファイルと参照される共有JSを直接更新します。

```bash
node lib/convert_imports.mjs --execute samples/aquarium
```

実行前の内容はコミットやバックアップで保持すると、変更を比較しやすくなります。
書き出しの指定は`--execute`です。候補表示と実行では、その時点の対象コードを読みます。

## 変換するimport

default importと別名は、公開クラス名の名前付きimportへ変換します。

```js
// 個別版
import App from "../../webg/WebgApp.js";

// 統合版（元サンプルの配置で変換した場合）
import { WebgApp as App } from "../../lib/webg.core.min.js";
```

名前付きexportには一意な対応名があります。例えば次のように変換されます。

```js
import { DepthConvention_CAMERA_REVERSE_Z as CAMERA_REVERSE_Z }
  from "../../lib/webg.core.min.js";
```

ローカル名とES Modulesの参照関係を保持するための形です。
namespace import、再export、文字列で指定された動的importも変換します。
HTML内では`type="module"`のscriptを対象にし、他のマークアップを保持します。
import内部のコメントも保持します。

## 確認を求める入力

変数で指定する動的import、未登録のコアやexport、import属性、HTMLのbase要素、
URLやimport mapによるコア参照、クエリ付きのコア参照は、用途を確認してから扱います。
スクリプトは確認箇所を表示し、書き出しを開始する前に終了します。

コメント保持版を使う場合は、次のように`--bundle`で指定できます。

```bash
node lib/convert_imports.mjs --bundle lib/webg.core.js \
  --out user/bundled-readable samples/water
```

この例も候補表示です。書き出す場合は`--execute`を加えます。
対象、`--bundle`、`--out`のパスは、コマンドを実行する作業フォルダを基準に解決します。
