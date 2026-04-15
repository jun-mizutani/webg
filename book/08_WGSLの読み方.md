# WGSLの読み方

この章は、`webg` のシェーダーを読むために必要な WGSL の基礎を、日本語で順に追いやすい形にまとめた章です。単に構文を列挙するのではなく、「CPU 側の setter で入れた値が、WGSL のどこへ届くのか」「サンプルを読むときに、どこから見始めるとよいのか」まで含めて整理します。`webg` の利用者が、すぐに WGSL を書き始める必要はありません。ただし、ノーマルマップがなぜ効くのか、フラットシェーディングで面単位の陰影がどう作られるのか、スキニングがどこで起きるのか、binding が増えたときに何をそろえるべきかを理解するには、WGSL の見方を避けて通れません。ここでは `book/examples/Phong.js`、`book/examples/NormPhong.js`、`book/examples/BonePhong.js`、`book/examples/BoneNormPhong.js`、`webg/SmoothShader.js` を読む前提で説明します。`Phong` 系 4 本は webgのコア機能ではなく、比較のために `book/examples` に置かれた教材用ファイルです。`webg/SmoothShader.js` は `Phong` 系 の 4 本の機能に加え、flat shading の切替も含んでいます。

この章で最初に押さえたいのは、WGSL を「GPU に渡す文字列」としてではなく、CPU 側の実装と対になったものとして読むことです。たとえば `setAmbientLight(0.3)` と書いたとき、値は JavaScript の変数に入って終わりではありません。ユニフォームバッファの特定のオフセットへ書き込まれ、`queue.writeBuffer()` で GPU へ送られ、WGSL の `uniforms.params0.x` のようなフィールドから読まれます。WGSL を単体で眺めても全体は見えません。CPU 側の setter と対にして読むことが大切です。 

また、シェーダーを読むときに最初から数式を追う必要はありません。まずは `@vertex` と `@fragment` の入口、`@group` / `@binding` のリソース参照、`@location` と `@builtin` の受け取り口を見ると、何を読んで何を返すシェーダーなのかが見えてきます。`webg` では `Shape.setMaterial()` や `shader.setDefaultParam()` から入るパラメータが多く、WGSL だけを読んでも全体の意図は分かりません。この章の役割は、サンプル、JavaScript のクラス、WGSL の 3 つをつなぐための読み方を作ることです。 

## WGSL は何のために読むのか

WebGPU では、CPU 側の JavaScript がバッファやテクスチャを準備し、WGSL が頂点ごとの変換とピクセルごとの色の決定を行います。したがって、WGSL を読む目的は、次の 3 つに分けると整理しやすくなります。第一に、利用者として、今使っているマテリアルが何を前提にしているかを知ること。第二に、開発者として、新しいパラメータやデバッグ表示を追加するときの変更点を知ること。第三に、サンプルを増やすときに、安全に真似すべき構造を見分けることです。`webg` の文書では、シェーダーを「見た目を決める部品」としてだけでなく、リソースの結び付けと描画処理の一部として扱います。そのため、WGSL の読み方も「式の意味」だけでなく、「どのリソースがどこから来たのか」を重視します。 

## 最初は入口を見る

WGSL を読み始めるとき、最初に見るべきなのは頂点シェーダーとフラグメントシェーダーの入口です。最小形は次のように読めます。 

```wgsl
struct VSIn {
  @location(0) position : vec3f,
};

struct VSOut {
  @builtin(position) position : vec4f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = vec4f(input.position, 1.0);
  return out;
}

@fragment
fn fsMain() -> @location(0) vec4f {
  return vec4f(1.0, 0.0, 0.0, 1.0);
}
```

ここでの読み方は単純です。`@vertex` が頂点シェーダーの入口であり、`@fragment` がフラグメントシェーダーの入口です。`VSIn` は頂点バッファから受け取る入力、`VSOut` は頂点シェーダーから後段へ渡す出力を表します。`@builtin(position)` はクリップ空間上の位置であり、`@location(0)` はカラーアタッチメント 0 へ返す色です。最初にこれだけ押さえると、「頂点側で位置を決め、フラグメント側で色を返す」という基本構造が見えてきます。 

WGSL では、`f32`、`i32`、`u32`、`vec2f`、`vec3f`、`vec4f`、`mat4x4f` のような型を使います。`webg` のシェーダーを読むときに特に頻繁に出るのは、`vec2f`、`vec3f`、`vec4f`、`mat4x4f`、`array<vec4f>` です。 

| 型              | 意味             | `webg` での典型例              |
| -------------- | -------------- | ------------------------- |
| `vec2f`        | 2 要素の浮動小数点ベクトル | UV、画面座標                   |
| `vec3f`        | 3 要素の浮動小数点ベクトル | position、normal           |
| `vec4f`        | 4 要素の浮動小数点ベクトル | color、light、パラメータ束        |
| `mat4x4f`      | 4x4 行列         | projection、model-view     |
| `array<vec4f>` | `vec4` の配列     | bone palette、詰め込み済みユニフォーム |

`webg` のシェーダーでは、パラメータを `params0`、`params1` のような `vec4f` にまとめて格納することがあります。これはフィールドを増やしすぎずにユニフォームレイアウトを整理するためです。読み手としては、`params0.x` のような表現を見たら、「JavaScript 側に対応する setter があるはずだ」と考えるとつながりやすくなります。 

## 受け取り口と差し込み口を見る

`@location(n)` は、頂点バッファの属性や、頂点シェーダーからフラグメントシェーダーへ補間されて渡る値の受け渡し位置です。たとえば次のような定義です。 

```wgsl
struct VSIn {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) texCoord : vec2f,
};
```

ここで大事なのは、WGSL 側の `@location` 番号が、CPU 側の `shaderLocation` と一致している必要があることです。位置と法線の番号がずれると、ライティング全体が不正に見えます。WGSL 側だけを見ていても原因が分からないときは、パイプライン作成側の属性設定を見る必要があります。また、頂点シェーダーの出力にも `@location` が出てきます。これは「フラグメントシェーダーへ何を渡しているか」を示します。たとえばワールド法線、UV、視線方向のような中間値がここを通ります。 

`@builtin` は、GPU が特別に扱う値です。`@builtin(position)` はクリップ空間上の最終位置であり、頂点シェーダーは必ずこれを返します。`@builtin(front_facing)` はフラグメントシェーダー側で表裏判定に使えます。`webg` の `backface_debug` はこれを利用しています。 

```wgsl
struct FSIn {
  @location(0) uv : vec2f,
  @builtin(front_facing) frontFacing : bool,
};
```

`front_facing` を使うと、裏面だけ別色にしたり、デバッグ表示を切り替えたりできます。ただし、分岐の置き方によってはテクスチャサンプリングの制約とぶつかることがあるため、単なる `bool` ではなく、「シェーダー全体の構造に影響する値」として見たほうが安全です。 

WebGPU では、ユニフォームバッファ、テクスチャ、サンプラーを bind group と binding 番号で束ねます。WGSL 側では次のように参照します。 

```wgsl
@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var uTexture : texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;
```

この 3 行を見たら、まず JavaScript 側で同じ binding 番号の bind group レイアウトを作っているか、`getBindGroup()` のような処理で同じ順番でリソースを格納しているか、`Shape.setMaterial()` で入れたテクスチャがどの binding に流れる設計かを確認します。`Phong` は、ユニフォーム、カラーテクスチャ、サンプラーをまとめた構成です。`NormPhong` ではノーマルマップ用テクスチャが増えます。`BonePhong` や `BoneNormPhong` ではボーン関連のユニフォームが大きくなるため、グループの分け方も読みどころになります。 

## uniform buffer を CPU 側と対応付けて読む

`webg` のシェーダーでは、ユニフォーム構造体の中に行列、光源、フォグ、パラメータ束が並びます。たとえば次のような形です。 

```wgsl
struct Uniforms {
  projection : mat4x4f,
  modelView  : mat4x4f,
  normalMat  : mat4x4f,
  light      : vec4f,
  params0    : vec4f,
  params1    : vec4f,
};
```

読み方のコツは、「フィールド名を見たら、CPU 側の setter を探す」ことです。`projection` なら `setProjectionMatrix()`、`modelView` なら `setModelViewMatrix()`、`normalMat` なら `setNormalMatrix()`、`light` なら `setLightPosition()`、`params0` / `params1` ならマテリアルパラメータを格納する setter 群です。この対応が見えると、WGSL は「謎の数式の集まり」ではなく、「JavaScript 側で準備した値を最終的に使う場所」として読めるようになります。 

`webg` のシェーダー読解で特に有効なのは、「setter -> ユニフォームへの格納 -> WGSL のフィールド」という 3 段階で追うことです。例として `Phong` を考えると、`shape.setMaterial("phong", { ambient: 0.3, specular: 0.9, power: 40.0 })` を書き、`doParameter()` がそれぞれの setter を呼び、setter が `uniformData` の所定オフセットを更新し、`writeBuffer()` が GPU へ送り、WGSL の `params0` から値を読む、という流れになります。この読み方に慣れると、パラメータを 1 個追加したいときに「どこを触ればよいか」がかなり明確になります。 

## テクスチャをどう読むか

WGSL 側でテクスチャを読む典型形は次のとおりです。 

```wgsl
let baseColor = textureSample(uTexture, uSampler, input.uv);
```

ここで確認したいのは、`uTexture` がどの binding か、`uSampler` がどの binding か、`input.uv` が頂点シェーダーから正しく渡っているかの 3 点です。`webg` では、テクスチャ未設定時に既定テクスチャを使う設計があり、見た目の上では「動いているように見える」ことがあります。つまり、テクスチャサンプリングの式があるからといって、利用者が本当にテクスチャを渡せているとは限りません。サンプルを読むときは、`shape.setMaterial()` の側もあわせて見る必要があります。 

通常のカラーテクスチャには `textureSample()` を使います。ただし、非一様な制御や微分計算と絡む場面では、WGSL の制約上、`textureSampleLevel()` を使う実装が現れます。`webg` の `NormPhong` と `BoneNormPhong` でノーマルマップ側に `textureSampleLevel(..., 0.0)` が出てくるのは、ノーマルマップだけが特殊というよりも、「WGSL の制約に合わせて安全な書き方を選んでいる」と見るほうが実態に近くなります。ここで大事なのは、「なぜ level を固定しているのか」をデバッグの観点で理解することです。WGSL は GLSL と違い、テクスチャサンプリングの置き場所に制約が出ることがあります。WebGPU ではこの種のバリデーションが厳密なので、サンプルが動いている理由を言語仕様の側から押さえておく価値があります。 

## ノーマルマップとフラットシェーディングをどう読むか

`NormPhong` と `BoneNormPhong` は接線ベクトル属性を必須にしていません。その代わり、フラグメントシェーダー内で `dpdx` / `dpdy` と UV の微分から接線ベクトル / 従法線ベクトルを再構成して TBN を組みます。同じ微分演算は、`SmoothShader` の `flat_shading` で「いま描いている三角形の面法線そのもの」を作る用途にも使えます。 

`NormPhong` では、ノーマルマップを読む流れを次の順で追うと分かりやすくなります。まず `normal_texture` を読む行を見る。次に、サンプリングした法線を、どの範囲からどの範囲へ変換しているかを見る。そのあと TBN をどう組んでいるかを見る。最後に `normal_strength` でどこを補間しているかを見る。この順で追うと、ノーマルマップの見え方が強すぎる、弱すぎるといった調整がどこで起きるのかが分かります。 

一方、`SmoothShader` では `flat_shading` を有効にすると、同じ bind group 構成、同じ texture / normal map / fog / skinning パラメータを保ったまま、法線の作り方だけを切り替えられます。通常の `SmoothShader` は頂点法線を頂点シェーダーからフラグメントシェーダーへ補間して使いますが、`flat_shading` を有効にした経路では、ビュー空間位置 `vPosition` の微分から、現在のフラグメントが属する三角形の面法線を直接作ります。 

```wgsl
let faceNormal = normalize(cross(dpdy(input.vPosition), dpdx(input.vPosition)));
let facing = select(-1.0, 1.0, input.frontFacing);
let nnormal = faceNormal * facing;
```

読み方の要点は単純です。`input.vPosition` は頂点シェーダーで `modelView * position` したビュー空間位置であること。`dpdx` と `dpdy` は、その位置が画面上でどちらへどれだけ変化しているかを表すこと。2 本の変化ベクトルの外積を取ると、その三角形の面法線が得られること。`frontFacing` を使って向きをそろえると、両面描画や `backface_debug` と並べても読みやすいことです。この方法では頂点法線を補間しないため、同じ mesh でも面ごとの陰影がはっきり出ます。WGSL を読むときは、「どの計算で最終法線 `nnormal` を作っているか」に注目すると、通常の `SmoothShader`、`flat_shading` を有効にした `SmoothShader`、`BoneNormPhong` の違いがかなり整理しやすくなります。 

## スキニングをどう読むか

`BonePhong` と `BoneNormPhong` で最初に見るべきなのは頂点シェーダーです。ここでは bone index と weight を使って、複数本のボーン行列を混ぜています。 

```wgsl
let i0 = i32(input.index.x) * 3;
let i1 = i32(input.index.y) * 3;
```

`webg` は 1 本のボーンを `vec4 x 3` の形で持つため、4x4 行列をそのまま置く設計とは見た目が少し異なります。ここで迷いやすいのは「なぜ 3 なのか」という点ですが、これは位置変換に必要な成分を詰めたパレット表現だからです。スキニングを読むときは、頂点入力に bone index / weight があるか、ユニフォーム側に bone palette があるか、複数本のボーン行列をどのように合成しているか、変形後の `position` と `normal` をどこへ流しているか、という順で見ると分かりやすくなります。 

## dynamic offset と大量描画の設計を見る

WGSL そのものには dynamic offset の構文は出ませんが、`webg` のシェーダーを読むうえでは非常に重要です。`Phong` 系や `Font`、`Wireframe` では、1 つのユニフォームバッファに複数オブジェクト分のデータを並べ、描画ごとにオフセットをずらして参照します。この設計の利点は、同じシェーダーを使うオブジェクトを大量に描くときに、毎回バッファを作り直さずに済むことです。WGSL 側でユニフォーム構造体が一定サイズに整理されているのは、この運用と関係しています。つまり、WGSL のレイアウトを読むことは、描画性能とも関係しています。 

## 日本語でつまずきやすい点

`binding` と `location` は別物です。`@binding(1)` と `@location(1)` は、同じ番号でも意味が違います。`binding` はテクスチャやユニフォームの差し込み口であり、`location` は頂点属性や補間値の受け渡し口です。番号だけを見て同一視しないことが大切です。 

また、`vec4f` にまとめてあるパラメータは「意味を節約している」わけではありません。`params0.x` のような書き方は読みにくく感じますが、これはレイアウトをまとめるための実装上の表現です。意味が失われているわけではないので、JavaScript 側の setter 名と対応付けて読みます。さらに、GLSL の感覚をそのまま持ち込まないことも大切です。WGSL は GLSL と似て見える部分がありますが、binding の明示、型の厳密さ、テクスチャサンプリングの制約、構文の細かな違いがあります。以前の経験で補うよりも、「このシェーダーは WebGPU の仕様でどのように書かれているか」をその都度確認するほうが安全です。 

## `webg` のシェーダーを読む順番

`webg` のシェーダーを 1 本読むときは、次の順番が分かりやすくなります。まず `Shape.setMaterial()` の例を見る。次に、シェーダークラス側でどのパラメータを受けるかを見る。そのあと `@group` / `@binding` を見る。続いて頂点シェーダーの入力と出力を見る。フラグメントシェーダーの色の決定を見る。必要なら CPU 側のユニフォーム更新を見る。この順番で追えば、WGSL を読んでいても「何のための式なのか」を見失いにくくなります。 

## 次に読む章

実際に `Shader.js`、`Phong`、`NormPhong`、`BonePhong`、`BoneNormPhong` を CPU 側から追いたい場合は、第9章「シェーダーの実装」を読むと理解がつながります。どのシェーダーをどのように使い分けるかをアプリ構築の目線で戻って確認したい場合は、第7章「シェーダーとマテリアル」が対応します。`WebgApp` を使ったアプリ全体の構成へ戻りたい場合は、第5章「WebgAppによるアプリ構成」へ戻ると整理しやすくなります。 

この章の役割は、WGSL を単なる構文としてではなく、`webg` のサンプル、JavaScript クラス、描画結果をつなぐための読み方として身に付けることです。ここが見えてくると、シェーダーの変更やデバッグがかなりやりやすくなります。 
