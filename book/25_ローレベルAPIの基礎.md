# ローレベルAPIの基礎

高レベルの `WebgApp` を使うと、描画先の初期化やシーンの組み立てをかなり簡潔に書けます。しかし、その背後では `Screen`、`Shader`、`CoordinateSystem`、`Node`、`Matrix`、`Quat` のようなローレベル API が、それぞれ別の役割を引き受けています。本章では、`webg` の土台になっているこの中間層を、GPU 側の入口、シーン変換の基礎、数理の土台という 3 つの観点から整理します。 

ここで最初に押さえたいのは、`webg` のローレベル API は、生の WebGPU をそのまま露出する層ではなく、「3D アプリを組む単位」へ少し引き上げた中間層だということです。ブラウザで 3D を描くとき、本来は canvas と GPU デバイス、レンダーパイプライン、uniform buffer、頂点バッファ、インデックスバッファ、カメラ行列、モデル変換を自分でつなぐ必要があります。`webg` では、これらをそのまま 1 枚の API へ押し込めず、役割ごとにいくつかのクラスへ分けています。 

その分け方を先に言うと、`Screen` と `Shader` は GPU に近い入口です。canvas / device / pipeline / uniform の初期化は、この 2 つに集まっています。一方で `CoordinateSystem` と `Node` はシーン上の姿勢と配置の基礎で、位置、回転、親子関係、`Shape` を置く単位という役割をここで切り分けます。さらに `Matrix` と `Quat` は、その上の層が前提にしている変換計算の土台です。projection、行列積、クォータニオン補間など、他の層はこれらを前提に動いています。つまりこの章では、「GPU 側の入口」「シーン変換の基礎」「数理の土台」という 3 層構造として読むと整理しやすくなります。 

## `webg` のローレベル層をどう捉えるか

![ローレベル API の 3 層構造](fig25_01_low_level_layer_map.jpg)

*第25章では、Screen / Shader を GPU 側の入口、CoordinateSystem / Node / Shape / Space をシーン変換と配置、Matrix / Quat を数理の土台として読むと、いまどの層の説明かを見失いにくくなります。*

ブラウザで 3D を描くとき、本来は次のような WebGPU の構成要素を自分でつなぐ必要があります。canvas と GPU デバイス、レンダーパイプライン、uniform buffer、頂点バッファとインデックスバッファ、カメラ用の行列、オブジェクトごとのモデル変換です。`webg` のローレベル層は、この生の WebGPU の部品を「3D アプリを組む単位」へ少し引き上げています。具体的には、`Screen` が canvas と WebGPU コンテキスト、`Shader` がパイプラインと uniform、`Shape` が頂点 / インデックスデータとマテリアル、`CoordinateSystem` が位置・回転・スケール、`Node` が `Shape` を置くシーングラフ上のノード、`Matrix` / `Quat` が変換計算を担当します。 

この分け方を先に理解しておくと、ローレベルのコードを読んでも「今は GPU の準備をしているのか」「今はシーンの姿勢を決めているのか」「今は数学的な変換を扱っているのか」を切り分けやすくなります。つまり、低レベル API を全部まとめて覚えるのではなく、「どの役割の層にいるか」を見ながら読むことが大切です。 

## `Screen`

`Screen` は、canvas と WebGPU の橋渡しです。内部では `navigator.gpu` から adapter と device を取り、canvas の `webgpu` コンテキストを `configure` し、depth texture も管理します。つまり `Screen` は、「描画先の窓」と「その窓へ描くための WebGPU コンテキスト」をまとめたクラスです。GPU 側の入口の中でも、いちばん外側にあるのがこのクラスです。 

`Screen` がしてくれることはかなりはっきりしています。`#canvas` を見つけること、WebGPU デバイスを確保すること、canvas コンテキストを `configure` すること、resize 時に depth texture を作り直すこと、`clear()` と `present()` の入口をそろえることです。ここで重要なのは、`Screen` が shader や geometry を知らないことです。役割はあくまで「どこへ描くか」を整えるところまでで、「どう描くか」は次の `Shader` 側へ分かれています。つまり `Screen` は描画先を整える土台であり、描画内容そのものの役割は持ちません。 

最小のコード例は次のようになります。

```js
import Screen from "./webg/Screen.js";

// Screen が canvas と WebGPU の初期化を担当する
const screen = new Screen(document);

// device と context の準備が終わるまで待つ
await screen.ready;

// 背景色を決める
screen.setClearColor([0.1, 0.15, 0.1, 1.0]);

// Screen から GPU ラッパーを取り出す
const gpu = screen.getGL();
console.log(gpu.device, gpu.context);
```

この例で見るべきなのは、`await screen.ready` を待つまでは、WebGPU デバイスと context が使える前提に立たないことです。ローレベルコードで最初につまずきやすいのは、device 準備前に shader や buffer を作ろうとする点なので、`Screen` はまず非同期初期化を持つクラスだと覚えておくほうが安全です。 

また、`resize()` は単なる canvas サイズ変更ではありません。内部では depth texture の再構築も行うため、画面サイズを変えたあとは projection 行列も更新する、という一連の流れで考えるほうが自然です。つまり、`Screen` の resize は見た目だけでなく描画条件の更新と一緒に扱う必要があります。 

```js
screen.resize(
  Math.max(1, Math.floor(window.innerWidth)),
  Math.max(1, Math.floor(window.innerHeight))
);
```

## `Shader`

WebGPU では、描画するたびにレンダーパイプライン、シェーダーモジュール、uniform buffer、bind group が必要です。`Shader` はそれらをクラスとしてまとめる基底層です。ここで `Screen` との違いをはっきりさせると、`Screen` は描画先を作り、`Shader` は描き方を作ります。つまり、GPU に近い入口は 2 つありますが、片方は「窓」、もう片方は「描画設定」です。 

`webg` では `Shader` を直接使うより、`Phong`、`NormPhong`、`BonePhong`、`SmoothShader` のような派生クラスを使うことが多くなります。つまり `Shader` 自体は継承用の基底として読むほうが自然です。通常の利用では、まず派生クラスから入ると理解しやすくなります。 `Shader` がしてくれることは、uniform buffer を作ること、WGSL からシェーダーモジュールを作ること、bind group layout を作ること、texture と sampler の bind group をまとめること、パスエンコーダーにパイプラインを設定することです。ここで重要なのは、`Shader` が行列や光源値を「GPU へ渡す形式」に整えている点です。CPU 側の描画パラメータと GPU 側の実際の pipeline をつなぐ中継点だと考えると整理しやすくなります。 

最小のコード例としては、`Shader` 基底ではなく `SmoothShader` を使うほうが分かりやすくなります。

```js
import Screen from "./webg/Screen.js";
import SmoothShader from "./webg/SmoothShader.js";
import Matrix from "./webg/Matrix.js";

const screen = new Screen(document);
await screen.ready;

// SmoothShader は Shader の派生クラス
const shader = new SmoothShader(screen.getGL());
await shader.init();

// projection 行列を shader へ渡す
const projection = new Matrix();
projection.makeProjectionMatrix(
  0.1,
  1000.0,
  screen.getRecommendedFov(55.0),
  screen.getAspect()
);
shader.setProjectionMatrix(projection);

// 光源位置も shader 側へ渡す
shader.setLightPosition([120.0, 180.0, 140.0, 1.0]);
```

この例の読み方は、「projection 行列や light position は `Matrix` や配列として CPU 側で作り、それを `Shader` が GPU に流す」という形です。つまり `Shader` 自身が数学を解くというより、計算済みの結果を描画設定へ乗せる役割を持ちます。だからこそ `Matrix` 節や `Quat` 節とつながってきます。 

## `CoordinateSystem`

`CoordinateSystem` は、シーングラフの変換基底です。位置、回転、スケール、親子関係を持ち、必要に応じてローカル行列とワールド行列を再構築します。`Node` はこの `CoordinateSystem` を継承しています。ここでのポイントは、`CoordinateSystem` 自体は描画しない、ということです。つまり、見えるオブジェクトではなく、姿勢を持つための基底として読むほうが自然です。 

`CoordinateSystem` がしてくれることは、position を持つこと、クォータニオンで回転を持つこと、一様スケールを持つこと、親子関係を持つこと、ローカル / ワールド行列を計算することです。ここで重要なのは、`CoordinateSystem` が「変換だけ」を受け持つことです。shape を知らず、shader も知らず、GPU も知りません。役割はあくまで 3D 空間上の姿勢と親子関係です。つまり、シーン上の「どこに、どちら向きで、どの親の下にあるか」を表す最小単位です。 

最小のコード例は次のとおりです。

```js
import CoordinateSystem from "./webg/CoordinateSystem.js";

const cs = new CoordinateSystem(null, "marker");

// 位置を決める
cs.setPosition(2.0, 1.0, 0.0);

// head(Y), pitch(X), bank(Z) の順で回転を決める
cs.setAttitude(45.0, 15.0, 0.0);

// uniform scale を設定する
cs.setScale(1.5);

// 行列を更新する
cs.setWorldMatrix();

console.log(cs.getWorldPosition());
console.log(cs.getWorldAttitude());
```

ここでとくに重要なのは、回転順が `head / pitch / bank = Y / X / Z` だという点です。これは後の `Matrix` や `Quat` の節でも一貫して前提になります。つまり、`CoordinateSystem` を読むときは位置 API だけでなく、この回転順の前提も一緒に押さえるほうが安全です。 

## `Node`

`Node` は `CoordinateSystem` に `Shape` の保持と描画機能を足したクラスです。シーンにオブジェクトを置く実体だと考えると分かりやすくなります。ここで `CoordinateSystem` との違いをはっきりさせると、`CoordinateSystem` は変換だけの基底、`Node` はその変換の上に「何を描くか」を載せた実体です。つまり、変換と描画の境目がこのクラスにあります。 

ローレベルでは `Space.addNode()` で `Node` を作り、そこへ `Shape` を載せます。視点も通常は `Node` として置きます。つまり `Node` は「シーンにあるもの一般」を表すクラスであり、必ずしも visible object に限りません。camera も marker も object も同じシーングラフの node です。 `Node` がしてくれることは、`Shape` を持てること、`CoordinateSystem` と同じ変換 API を使えること、親子階層を持てること、描画時に自分と子孫を再帰的に描画することです。ここで重要なのは、「shape を持つ node」と「shape を持たない node」の両方が自然に存在することです。後者は camera rig や pivot、offset 用の親 node としてよく使います。 

最小のコード例は次のようになります。

```js
import Space from "./webg/Space.js";

const space = new Space();

// 視点も Node として置く
const eye = space.addNode(null, "eye");
eye.setPosition(0.0, 0.0, 10.0);
space.setEye(eye);

// 描画 object 用 Node
const box = space.addNode(null, "box");
box.setPosition(0.0, 0.0, 0.0);
box.setAttitude(0.0, 20.0, 0.0);
box.addShape(shape);
```

この例では `shape` の詳細は省いていますが、読み方としては「`Shape` は geometry と material を持つ部品であり、それを scene に置く実体が `Node`」です。つまり `Shape` 単体では scene に所属せず、`Node` に載って初めて位置や親子関係を持ちます。 

## `Matrix`

3D では、回転、移動、projection 行列、ビュー変換をすべて行列で扱います。`webg` の `Matrix` は列優先の 4×4 行列です。`CoordinateSystem`、`Node`、`Shader`、`Space` は内部で `Matrix` を使っています。つまり、ローレベル層の上にあるほとんどの変換は最終的にここへ集まります。だから `Matrix` は単独の数学クラスというより、他の層が前提にしている変換土台として読むほうが自然です。 

`Matrix` がしてくれることは、4×4 行列を持つこと、オイラー角やクォータニオンから回転行列を作ること、平行移動を入れること、projection 行列を作ること、ビュー行列を作ること、ベクトルへ掛けることです。ここで重要なのは、`Matrix` が projection と local/world 変換の両方に使われることです。つまり、「カメラ用の特別な行列」と「object 用の変換行列」が別クラスになっているわけではなく、同じ `Matrix` が用途に応じて使われています。これが `Shader` 節や `CoordinateSystem` 節との接点になります。 

最小のコード例は次のとおりです。

```js
import Matrix from "./webg/Matrix.js";

const m = new Matrix();

// head, pitch, bank から回転を作る
m.setByEuler(30.0, 10.0, 0.0);

// 最後の列へ平行移動を入れる
m.position([2.0, 1.0, 0.0]);

// 点 [0, 0, 1] をこの行列で動かしてみる
const moved = m.mulVector([0.0, 0.0, 1.0]);
console.log(moved);
```

projection 行列の最小例は次のとおりです。

```js
const projection = new Matrix();
projection.makeProjectionMatrix(
  0.1,
  1000.0,
  screen.getRecommendedFov(55.0),
  screen.getAspect()
);
```

この 2 つの例を並べて見ると、`Matrix` は object 変換にも camera projection にも使われることが分かります。つまり「行列を作る」という操作は 1 つでも、どこに渡すかで意味が変わります。ここを意識して読むと、`Shader` や `Space` のコードも追いやすくなります。 

## `Quat`

`Quat` は回転を表すためのクォータニオンです。`webg` では `[w, x, y, z]` の順で持ちます。`CoordinateSystem` は内部でクォータニオンを使って姿勢を保持し、そのあと `Matrix` へ変換します。つまり `Quat` は単独で完結した数学クラスではなく、`CoordinateSystem` の回転保持や animation 補間の下支えをしている部品です。だから `Node` や `CoordinateSystem` を理解したあとで読むと位置づけが見えやすくなります。 

`Quat` がしてくれることは、X / Y / Z 軸回転クォータニオンを作ること、オイラー角からクォータニオンを作ること、クォータニオン同士を掛けること、`slerp` で滑らかに補間すること、行列と相互変換することです。ここで重要なのは、`Quat` が「向きを保持する形式」であり、描画用には最終的に `Matrix` へ変換されることです。つまり、`Quat` と `Matrix` は競合する別方式ではなく、役割の違う連携相手です。保持と補間は `Quat`、最終的な変換適用は `Matrix`、という分担で読むと整理しやすくなります。 

最小のコード例は次のようになります。

```js
import Quat from "./webg/Quat.js";
import Matrix from "./webg/Matrix.js";

const q = new Quat();

// head(Y), pitch(X), bank(Z) から quaternion を作る
q.eulerToQuat(45.0, 10.0, 0.0);

// 行列へ変換して確認する
const m = new Matrix();
m.setByQuat(q);

console.log(q.q);            // [w, x, y, z]
console.log(m.mat.slice(0)); // 4x4 matrix
```

この例で見えるのは、「クォータニオンを作っただけでは描画に使わず、最終的には行列へ落としている」という点です。つまり `Quat` は保持と補間の形式であり、GPU に直接渡す最終形ではない、ということが分かります。ここが animation や姿勢補間を理解するときのポイントになります。 

## 全体をつないだ最小例

次のコードは、`Screen`、`Shader`、`Shape`、`CoordinateSystem`、`Node`、`Matrix`、`Quat` の役割がつながる最小例です。ここでは `Shape` 自体の詳しい説明は次章へ回しますが、「どの部品がどこで使われるか」を一続きで見るにはこの例が最も分かりやすくなります。つまり、ローレベル API を個別に覚えるのではなく、実際にどう流れるかを確認するためのコードです。 

```js
import Screen from "./webg/Screen.js";
import Space from "./webg/Space.js";
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";
import Matrix from "./webg/Matrix.js";
import Quat from "./webg/Quat.js";
import CoordinateSystem from "./webg/CoordinateSystem.js";
import SmoothShader from "./webg/SmoothShader.js";

const screen = new Screen(document);
await screen.ready;
screen.setClearColor([0.1, 0.15, 0.1, 1.0]);

// Shader は WebGPU の pipeline と uniform をまとめる
const shader = new SmoothShader(screen.getGL());
await shader.init();

// projection は Matrix で作る
const projection = new Matrix();
const updateProjection = () => {
  screen.resize(
    Math.max(1, Math.floor(window.innerWidth)),
    Math.max(1, Math.floor(window.innerHeight))
  );
  projection.makeProjectionMatrix(
    0.1,
    1000.0,
    screen.getRecommendedFov(55.0),
    screen.getAspect()
  );
  shader.setProjectionMatrix(projection);
};
updateProjection();

// シーン全体を管理する
const space = new Space();

// 視点 Node を置く
const eye = space.addNode(null, "eye");
eye.setPosition(0.0, 0.0, 12.0);
space.setEye(eye);

// CoordinateSystem は変換の下書きに使える
const pose = new CoordinateSystem(null, "cubePose");
pose.setPosition(0.0, 0.0, 0.0);
pose.setAttitude(20.0, 10.0, 0.0);

// Quat を直接作って回転を確認する例
const spin = new Quat();
spin.setRotateY(1.0);

// Shape は geometry と material を持つ
const shape = new Shape(screen.getGL());
shape.setShader(shader);
shape.applyPrimitiveAsset(Primitive.cube(3.0, shape.getPrimitiveOptions()));
shape.endShape();
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});

// Node は Shape をシーンに置く
const cube = space.addNode(null, "cube");
cube.setPosition(...pose.getPosition());
cube.setAttitude(...pose.getLocalAttitude());
cube.addShape(shape);

const loop = () => {
  // Node 側の API で回転を足していく
  cube.rotateY(0.8);
  cube.rotateX(0.3);

  screen.clear();
  space.draw(eye);
  screen.present();
  requestAnimationFrame(loop);
};
loop();
```

この例の読み方は次のとおりです。`Screen` は WebGPU の窓、`Shader` は GPU にどう描くかを伝え、`Matrix` は projection 行列を作り、`Quat` は回転表現の土台になり、`CoordinateSystem` は位置と向きの土台になり、`Shape` は形そのもので、`Node` はその形をシーンに置く実体です。この順で見ると、`webg` のローレベル層は「GPU 側の入口」から始まり、「変換の土台」を通って、「シーンに置く実体」へつながっていることが分かります。 

## どこまでローレベルへ降りるべきか

ローレベル API を直接使うと向いているのは、描画の土台を理解したいとき、独自の pass や独自のシェーダーを作る前段階、`WebgApp` が何を自動化しているかを知りたいときです。つまり、「まず何かを素早く作る」よりも、「今どの層で何が起きているかを理解したい」ときに向いています。ローレベル API を読む価値は、すべてを手書きすることよりも、高レベル API の裏側を見通せるようになることにあります。 

反対に、サンプルを素早く 1 本作りたいとき、HUD、入力、デバッグ、診断情報も一緒に使いたいとき、カメラリグやヘルプパネルを毎回手書きしたくないときは `WebgApp` へ移ったほうが自然です。ローレベル API は学習と拡張の土台であり、日常的なアプリ組み立ての入口としては必ずしも最短ではありません。`WebgApp` が何を自動化しているかを知ったうえで、必要なときだけローレベルへ降りる、という使い方が最も自然です。 

## よくある注意点

ローレベル API を触り始めたときに最も外しやすい前提は、`await screen.ready` を忘れないこと、`await shader.init()` を忘れないこと、`shape.endShape()` を忘れないこと、`Shape` だけでは表示されないこと、`Node` を作っても `Space.draw(eye)` しなければ見えないこと、`Matrix` は列優先で `Quat` は `[w, x, y, z]` だということ、回転順は `head / pitch / bank = Y / X / Z` だということ、この 7 点です。とくに非同期初期化、`Shape` と `Node` の役割差、回転順と quaternion の並び順は混同しやすいので、最初に固定して覚えるほうが安全です。 

この章の次に読むものとしては、もっとも自然なのは `Shape` の章です。この章で `Screen`、`Shader`、`CoordinateSystem`、`Node`、`Matrix`、`Quat` の骨格を押さえておくと、次章で geometry と material の話へ進んだときに、「いま shape だけを読めばよい」という状態を作りやすくなります。つまり、この第25章はローレベル API 全体の地図を先に固める章として位置づけると整理しやすくなります。 
