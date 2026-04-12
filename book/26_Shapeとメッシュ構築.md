# 26 Shapeとメッシュ構築

最終更新：2026-04-07 JST

この章は、`webg/Shape.js` を中心に、頂点登録、面登録、法線計算、`endShape()` による GPU バッファ確定までを整理したメッシュ構築章です。対象は `webg/Shape.js`、`webg/Primitive.js`、およびローレベルのサンプルにおける基本的な `Shape` 構築コードです。

## この章で押さえること

### A. `Shape` には高水準経路と低水準経路の 2 つがある

`Primitive` やアセットを流し込む経路と、自分で頂点と面を積む経路を分けて理解することが重要です。

### B. `endShape()` が CPU 側のメッシュから GPU 側のメッシュへの境界

この呼び出しを境に、編集フェーズから描画フェーズへ切り替わります。

### C. 頂点共有の有無で法線の見え方が変わる

滑らかに見せたいか、面を立てたいかで、頂点を共有するか複製するかを選ぶ必要があります。

## この章の流れ

まず `Shape` の役割と最小例を確認し、そのあとで高水準 / 低水準の違い、頂点登録、面登録、`endShape()` の内部、学習課題へ進みます。次章のプロシージャル教材を読む前の土台として使います。

## 1. `Shape`

### 背景、仕組み

`Shape` は、頂点、インデックス、法線、UV、マテリアル、シェーダーをまとめるクラスです。WebGPU の観点で見ると、頂点バッファとインデックスバッファを作る手前のまとまりです。

初心者向けには、「何を描くかを表す 3D の形そのもの」と考えると分かりやすくなります。

ここで大切なのは、webg には 2 つの `Shape` 作成経路があることです。

1. 高水準の経路
2. 低水準の経路

高水準の経路では、`Primitive.cube()` のような組み込み primitive や、glTF / Collada / `ModelAsset` の読み込み結果を `Shape` へ流し込みます。これは「すぐ表示したい」ときに向いています。

一方で低水準の経路では、`Shape` に対して自分で頂点を 1 個ずつ登録し、面を 1 枚ずつ登録して、最後に `endShape()` で GPU へつなぎます。プロシージャルジオメトリ、教材、特殊なメッシュ、研究用の形状では、この低水準の使い方が重要になります。

### 何をしてくれるか

1. 頂点データを保持する
2. 法線や UV を保持する
3. `endShape()` で GPU バッファを確定する
4. マテリアルとシェーダーパラメータを持つ
5. draw 時にシェーダーへデータを流す

### 最小のコード例

```js id="wcuvcw"
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";

// Shape は GPU 参照を受けて作る
const shape = new Shape(screen.getGL());

// Primitive から cube のデータを流し込む
shape.applyPrimitiveAsset(
  Primitive.cube(2.0, shape.getPrimitiveOptions())
);

// ここで GPU バッファを確定する
shape.endShape();

// マテリアルを指定する
shape.setMaterial("phong", {
  use_texture: 0,
  color: [0.22, 0.64, 0.96, 1.0]
});
```

### 使い方

最初は `Primitive.cube()` や `Primitive.sphere()` と組み合わせると理解しやすくなります。

1. `new Shape(gpu)`
2. `applyPrimitiveAsset(...)`
3. `endShape()`
4. `setMaterial(...)`
5. `Node.addShape(shape)`

### 1.1 高水準の `Shape` 作成と低水準の `Shape` 作成

最初に、両者の違いをはっきりさせます。

#### 高水準の `Shape` 作成

これは「すでに `Shape` の材料がまとまっている」場合です。

```js id="i468i6"
const shape = new Shape(screen.getGL());
shape.applyPrimitiveAsset(
  Primitive.cube(2.0, shape.getPrimitiveOptions())
);
shape.endShape();
```

この形では、頂点や面の構成は `Primitive` 側がすでに用意しています。利用者は「どの primitive を使うか」を選ぶだけです。

#### 低水準の `Shape` 作成

これは「自分でメッシュを組み立てる」場合です。

```js id="q0fplh"
const shape = new Shape(screen.getGL());

const p0 = shape.addVertexUV(-1.0, -1.0, 0.0, 0.0, 0.0) - 1;
const p1 = shape.addVertexUV( 1.0, -1.0, 0.0, 1.0, 0.0) - 1;
const p2 = shape.addVertexUV( 1.0,  1.0, 0.0, 1.0, 1.0) - 1;
const p3 = shape.addVertexUV(-1.0,  1.0, 0.0, 0.0, 1.0) - 1;

shape.addTriangle(p0, p1, p2);
shape.addTriangle(p0, p2, p3);

shape.endShape();
```

こちらでは、頂点と面の責任は利用者側にあります。webg は登録したデータを保持し、法線計算や GPU 転送を担当します。

### 1.2 頂点を登録するとはどういうことか

低水準の `Shape` 作成では、まず頂点を登録します。`Shape` は頂点ごとに少なくとも次のデータを持ちます。

1. position
2. normal
3. UV

内部では、主に次の配列へ積み上がっていきます。

1. `positionArray`
2. `normalArray`
3. `texCoordsArray`

`setVertex(x, y, z)` は position を登録し、同時に normal 用に `[0, 0, 0]` を 1 頂点分追加します。つまり `setVertex()` を呼んだ時点では、法線はまだ確定していません。

#### `setVertex()`

```js id="3grh79"
const count = shape.setVertex(0.0, 0.0, 0.0);
```

このメソッドは、次のことを行います。

1. `positionArray` に 3 要素追加する
2. `normalArray` に `[0, 0, 0]` を追加する
3. `vertexCount` を増やす
4. バウンディングボックスを更新する

重要なのは、返り値が「追加後の頂点数」であり、0 始まりのインデックスではないことです。
そのため、頂点インデックスとして使いたいときは、通常 `- 1` します。

```js id="qgz4ba"
const p0 = shape.setVertex(0.0, 0.0, 0.0) - 1;
```

#### `addVertex()`

```js id="e6x17s"
const p0 = shape.addVertex(0.0, 0.0, 0.0) - 1;
```

`addVertex()` は `setVertex()` に加えて、現在の texture mapping 設定から UV を自動計算して `texCoordsArray` へ追加します。
「UV も自分で決めたい」なら `addVertexUV()` のほうが分かりやすくなります。

#### `addVertexUV()`

```js id="yd3bmb"
const p0 = shape.addVertexUV(-1.0, -1.0, 0.0, 0.0, 0.0) - 1;
```

これは初心者が最初に使う低水準メソッドとして最も分かりやすいものです。

1. position を追加する
2. UV をそのまま追加する
3. インデックス用に戻り値を `- 1` して使う

#### `addVertexPosUV()`

```js id="hz0y60"
const p0 = shape.addVertexPosUV(
  [-1.0, -1.0, 0.0],
  [0.0, 0.0]
) - 1;
```

配列で position と UV を渡したいときに使います。プロシージャルジオメトリを配列ベースで組み立てるときに便利です。

### 1.3 面を登録するとはどういうことか

頂点だけでは、まだ「点の集合」です。画面に三角形として見せるには、どの頂点 3 つが 1 枚の面を作るかを登録する必要があります。

webg の `Shape` は、三角形を基本単位として面を扱います。内部では `indicesArray` に頂点インデックスが積まれていきます。

#### `addTriangle(p0, p1, p2)`

```js id="k55hwy"
shape.addTriangle(p0, p1, p2);
```

これは単にインデックスを 3 つ積むだけではありません。実装上は次の仕事もしています。

1. `indicesArray` に三角形インデックスを追加する
2. `primitiveCount` を増やす
3. `autoCalcNormals` が有効なら、その面の法線寄与を 3 頂点へ加算する
4. UV seam で頂点を複製すべき場合は、必要に応じて代替頂点を作る
5. `altVertices` を使って seam の両側の法線共有を助ける

つまり `addTriangle()` は、単なるインデックス登録メソッドではなく、法線計算と seam 処理の入口でもあります。

##### 法線加算の仕組み

`autoCalcNormals` が有効な場合、`addTriangle()` は `(p1 - p0) x (p2 - p0)` の外積で面法線を求め、その値を三角形の 3 頂点それぞれの normal へ足し込みます。

この段階ではまだ正規化しません。
複数の面から寄与を集めて、最後に `endShape()` で正規化します。

これはスムーズシェーディングを理解するうえで大切です。
「頂点法線は 1 面ごとに決まる」のではなく、「その頂点へ接続する面の法線寄与を合計したあとで正規化する」という流れです。

#### `addPlane(indices)`

```js id="0em7p0"
shape.addPlane([p0, p1, p2, p3]);
```

これは四角形専用というより、「先頭頂点を基準に扇状に三角形分割する補助メソッド」です。
実装では、次のような三角形列へ展開されます。

```text id="0z7yy9"
(p0, p1, p2)
(p0, p2, p3)
...
```

そのため、4 頂点の四角形だけでなく、凸多角形を単純に三角形化したいときにも使えます。

### 1.4 プロシージャルに四角形を作る最小例

次の例は、読み込み機能も `Primitive` も使わず、4 頂点と 2 三角形だけで平面を作るものです。

```js id="0koklg"
const shape = new Shape(screen.getGL());
shape.setShader(shader);

const p0 = shape.addVertexUV(-1.0, -1.0, 0.0, 0.0, 0.0) - 1;
const p1 = shape.addVertexUV( 1.0, -1.0, 0.0, 1.0, 0.0) - 1;
const p2 = shape.addVertexUV( 1.0,  1.0, 0.0, 1.0, 1.0) - 1;
const p3 = shape.addVertexUV(-1.0,  1.0, 0.0, 0.0, 1.0) - 1;

// 面は 2 枚の三角形として登録する
shape.addTriangle(p0, p1, p2);
shape.addTriangle(p0, p2, p3);

shape.endShape();
shape.setMaterial("phong", {
  use_texture: 0,
  color: [0.90, 0.72, 0.32, 1.0]
});
```

このコードでは、次の段階を自分の手で制御しています。

1. 頂点座標を決める
2. UV を決める
3. 面の張り方を決める
4. `endShape()` で GPU へ渡せる形に確定する

### 1.5 プロシージャルに立方体の 1 面を増やしていく考え方

学習の観点から見ると、立方体を一度に作るより「1 面ずつ増やす」ほうが理解しやすくなります。

1. まず前面だけを 4 頂点 + 2 三角形で作る
2. 次に背面を追加する
3. 左右面を追加する
4. 上下面を追加する

このとき、各面で法線をはっきり分けたいなら、角で頂点を共有しない設計にします。
逆に滑らかな球やチューブを作りたいなら、面同士で頂点を共有し、法線寄与を混ぜる設計にします。

ここはプロシージャルジオメトリの設計思想そのものです。

### 1.6 `endShape()` は何をしているのか

`endShape()` は、初心者向けには「CPU 上で集めたジオメトリを GPU に渡して、描画できる形へ変える最終確定ステップ」です。

しかし実装上は、その中でかなり多くの仕事をしています。

#### `endShape()` の全体像

1. 頂点法線を必要なら正規化する
2. seam 用の代替頂点法線を同期する
3. 頂点属性を GPU 転送用の packed 配列へ詰める
4. `GPUBufferUsage.VERTEX` の頂点バッファを作る
5. `GPUQueue.writeBuffer()` で頂点データを GPU へ送る
6. インデックス配列から `uint16` または `uint32` のインデックスバッファを作る
7. `GPUQueue.writeBuffer()` でインデックスデータを GPU へ送る
8. ワイヤーフレーム用のエッジインデックスも別に構築する

つまり `endShape()` は、単に終了を宣言するメソッドではなく、実際には CPU 側のメッシュから GPU 側のメッシュへ橋渡しする重要な関門です。

#### 法線の正規化

`addTriangle()` で法線を加算しただけでは、各頂点 normal の長さは面数に応じてばらつきます。
そこで `endShape()` は、`autoCalcNormals` が有効なら各頂点 normal を最後に正規化します。

この構造により、

1. 三角形ごとに法線寄与を足す
2. seam 処理を反映する
3. 最後に単位ベクトルにそろえる

という順序が保たれます。

#### `altVertices` と seam 同期

`Shape` には `altVertices` という補助データがあります。これは UV seam や閉じ目の都合で「同じ位置だが別頂点として持つ」組を覚えるための配列です。

`addTriangle()` は必要に応じて代替頂点を増やし、`altVertices` へ対応を記録します。
`endShape()` や `syncAltVertexNormals()` は、この対応を使って法線寄与を共有し、seam で照明が不自然に切れにくいようにしています。

これはプロシージャルに球や円筒を作るときに重要です。
UV の都合で頂点を複製しても、法線まで完全に切ってしまうと見た目がギザつきやすくなるためです。

#### 非スキンメッシュの packed layout

通常のメッシュでは、`endShape()` は 1 頂点あたり 8 float の配列を作ります。

```text id="5w233o"
[pos.x, pos.y, pos.z, normal.x, normal.y, normal.z, u, v]
```

つまり 1 頂点の stride は次のとおりです。

```text id="ci5oua"
8 * Float32Array.BYTES_PER_ELEMENT
```

この packed 配列が `vObj` です。
そのあとで `device.createBuffer({ usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })` を作り、`queue.writeBuffer()` で GPU へ転送します。

#### スキンメッシュの packed layout

`hasSkeleton` が有効な場合は、`endShape()` は頂点属性を 2 系統へ分けます。

1. `vObj0`: position / normal / UV
2. `vObj1`: bone index / weight

さらに互換用に `vObj` も 16 float stride で作ります。

これは BonePhong 系のシェーダーが skinning data を別 slot で受けるためです。
初心者がプロシージャルジオメトリを始める段階では、通常は非スキン経路だけ理解すれば十分です。

#### インデックスバッファの format の選択

`indicesArray` を GPU へ送るとき、`endShape()` はインデックス値を見て `uint16` と `uint32` を切り替えます。

1. 全インデックスが 65535 以下なら `uint16`
2. 1 つでも超えたら `uint32`

さらに byte length の都合で 4-byte alignment が必要な場合も `uint32` 側へ寄せます。

この処理があるため、小規模なメッシュでは軽量なインデックスバッファを使い、大きなメッシュでも破綻しにくくなっています。

#### ワイヤーフレーム用のエッジバッファの自動生成

`endShape()` は最後に `_buildWireIndexBuffer()` も呼びます。
これは三角形インデックスからエッジを重複除去して取り出し、ワイヤーフレーム表示用のインデックスバッファを別に作る処理です。

そのため `setWireframe(true)` を使うと、面描画と同じメッシュから線表示へ切り替えられます。

### 1.7 `endShape()` を呼ぶ前と後で何が変わるか

教育的に言うと、`endShape()` の前後では `Shape` の状態が大きく変わります。

#### `endShape()` の前

1. CPU 側の配列が主役
2. position / normal / UV / index を編集できる
3. まだ GPU バッファは確定していない

#### `endShape()` の後

1. GPU 側バッファが主役になる
2. draw に必要な頂点バッファとインデックスバッファがそろう
3. `Node` に載せて描画できる状態になる

この意味で `endShape()` は、メッシュ編集フェーズから描画フェーズへ切り替える境界です。

### 1.8 プロシージャルジオメトリの学習に向く小さな課題

ローレベルの理解を深めたいなら、次の順で作ると効果的です。

1. 三角形 1 枚を作る
2. 四角形を 2 三角形で作る
3. 立方体の 6 面を自分で作る
4. 円周上に頂点を並べて円板を作る
5. seam を持つ形状として円筒やトーラスを作る

この順で進むと、頂点インデックス、法線、UV seam、`endShape()` の意味が自然に見えてきます。
