# カメラ制御とEyeRig

`WebgApp` でアプリケーションの基盤が整った後、次に検討が必要なのが「視点をどのような単位で制御するか」という点です。`webg` では、視点そのものを単一の座標として扱うのではなく、`Space` 内に配置された `cameraRig`、`cameraRod`、`eye` という3段のノード構成を組み合わせてカメラを表現します。`EyeRig` は、この3段構成に対して orbit（軌道）、first-person（一人称）、follow（追従）という3つの視点操作を共通の考え方で提供するヘルパークラスです。

本章では、`webg/EyeRig.js` と `webg/WebgApp.js` をベースに、各ノードの役割や3段構成を採用している理由、そして利用者側で制御すべきポイントを整理します。第5章で解説した `WebgApp` の標準リグの上に、どのように視点操作を実装するかを順を追って解説します。

まず押さえておきたいのは、視点の本体は `EyeRig` クラスそのものではなく、`Space.setEye(node)` によって指定された `eye` ノードであるという点です。`EyeRig` はカメラを描画するクラスではなく、`cameraRig`、`cameraRod`、`eye` という3つの `Node` に対して、一定の規則に基づいた位置と回転を与えるためのヘルパーに過ぎません。最終的に画面に何が映るかを決定しているのは、あくまで `eye` ノードです。

また、`base -> rod -> eye` という階層構造は、回転と距離の役割を分離しやすくするための設計です。orbit では注視点、follow では追従対象、first-person では体の向きと視線の向きを個別に制御したい場面が多くあります。ここで重要になるのが、`setAngles()` と `setLookAngles()` の使い分けです。`setAngles()` は `base` や `rod` の向きを変更し、視点の土台そのものを動かす操作です。対して `setLookAngles()` は `eye` 側の独立した視線を制御するもので、進行方向とは異なる方向を向かせるための補助的な操作となります。

さらに、`attachPointer()` を呼び出しただけでは視点制御は完結しません。`attachPointer()` はマウス、タッチ、ペンなどの入力インターフェースを接続する処理であり、実際のモード切り替え、追従対象への追随、キーボード操作の反映などは `update(deltaSec)` メソッドによって実行されます。入力を設定したにもかかわらず視点が動かない場合は、この `update` 処理が抜けていないかを確認してください。

## なぜ `base / rod / eye` の3段構成なのか

![base rod eye カメラ構成図](fig06_01_eyerig_base_rod_eye.jpg)

*EyeRig は base、rod、eye の 3 段に分けることで、水平回転、高低角、最終視点を独立して扱いやすくしています。*

3Dアプリケーションでは、「どこを見るか」だけでなく、「どこを中心に回転するか」「誰を追跡するか」「体の向きと視線の向きを分けるか」といった要求を場面に応じて切り替える必要があります。視点を単一の座標のみで管理すると、orbit と first-person を共存させた際に制御概念が混在し、設計が複雑になります。`webg` が `base -> rod -> eye` という3段構成を採用しているのは、これらの役割分担を明確に保つためです。

注視点や追従対象に追随する基準位置を `base`、そこからの回転や距離を `rod`、そして最終的な独立視線を `eye` に割り当てることで、モードが切り替わっても一貫した考え方で制御が可能になります。

`WebgApp.createCameraRig()` もこの設計思想に基づいて標準のカメラノードを作成します。

```js
createCameraRig() {
  this.cameraRig = this.space.addNode(null, this.camera.rigName);
  this.cameraRod = this.space.addNode(this.cameraRig, this.camera.rodName);
  this.eye = this.space.addNode(this.cameraRod, this.camera.eyeName);
  this.space.setEye(this.eye);
}
```

ここで重要なのは、`EyeRig` がなければ視点を作成できないわけではないということです。`EyeRig` は、既存の3段構成に対して orbit / first-person / follow という意味付けを与えるヘルパーであると理解してください。`WebgApp.init()` は標準の `cameraRig`、`cameraRod`、`eye` を作成し、`space.setEye(this.eye)` までを完了させるため、利用者はその構造の上に `EyeRig` を適用させるだけで十分です。

モードごとの役割分担を整理すると以下のようになります。
- orbit: `base` が注視点、`rod` が yaw / pitch（回転）、`eye` が distance（距離）を担います。
- first-person: `base` が身体の位置と body yaw、`rod` が eye height（目の高さ）、`eye` が独立視線を担います。
- follow: `base` が追従対象の現在位置、`rod` が後方から見下ろす向き、`eye` が追従距離を担います。

このように共通構造を持つことで、「全景を俯瞰する」「主人公の視点で歩く」「対象を後方から追う」といった異なる視点操作を、同一の型で効率的に扱うことができます。

## 視野角と投影行列は `WebgApp` が管理する

カメラを理解する上で注意すべき点は、`EyeRig` が制御するのはあくまで「位置と姿勢」までであり、「どれくらい広く写すか（画角）」は別の制御領域であるということです。`webg` では `WebgApp` が `viewAngle`、`projectionNear`、`projectionFar` を保持し、`updateProjection()` メソッドを通じて現在のシェーダーへ投影行列を転送します。

```js
updateProjection(viewAngle = this.viewAngle) {
  const proj = new Matrix();
  const vfov = this.screen.getRecommendedFov(viewAngle);
  proj.makeProjectionMatrix(
    this.projectionNear,
    this.projectionFar,
    vfov,
    this.screen.getAspect()
  );
  this.projectionMatrix = proj;
  this.shader.setProjectionMatrix(proj);
}
```

ここで `viewAngle` は基準となる垂直方向の視野角です。`webg` は `Screen.getRecommendedFov(base)` を介して、現在の アスペクト比に応じて実際の垂直 FOV を補正します。これにより、横長画面では基準値を維持し、縦長画面では視野を少し広げることで、デバイスの形状に関わらず視認性を維持しています。

したがって、カメラの運用においては、「どこに配置し、どちらを向かせるか」は `EyeRig` や `Node` で制御し、「どれくらい広く写すか」「遠近感をどのように表現するか」は `viewAngle` と投影行列側で制御するという切り分けが重要になります。

最も基本的な設定方法は、`WebgApp` の生成時に `viewAngle` および `projectionNear`、`projectionFar` を指定することです。

```js
const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  viewAngle: 54.0,
  projectionNear: 0.1,
  projectionFar: 160.0,
  camera: {
    target: [0.0, 6.0, 0.0],
    distance: 46.0,
    yaw: 28.0,
    pitch: -18.0
  }
});
await app.init();
```

このとき、`camera.distance` はカメラの物理的な位置を決定し、`viewAngle` はレンズの広さに相当します。同じ `distance` であっても、`viewAngle` を小さくすれば望遠的な視覚効果となり、大きくすれば広角的な視覚効果となります。ズーム演出などの実装では、実行中に `viewAngle` を変更して `updateProjection()` を呼び出す手法が有効です。

```js
app.viewAngle = 40.0;
app.updateProjection();
```

```js
app.updateProjection(40.0);
```

この操作はカメラの位置を変更しません。構図を維持したまま、望遠または広角の見え方に切り替えたい場合に適しています。一方で、対象に実際に近づいた感覚を出したい場合は、`EyeRig` 側の `distance` や `position` を変更するのが自然です。また、`projectionNear` と `projectionFar` の設定も重要です。広大なシーンを表示するために `far` を過剰に広げると、深度バッファの精度が低下し、Zファイティング（描画のちらつき）が発生しやすくなるため注意してください。

## orbit camera の実装

まずは、最も基本的な orbit（軌道）視点から解説します。注視点と距離を定義し、ドラッグやホイール操作で視点を回転させることで、シーン全体の空間的な位置関係を容易に確認できます。`samples/high_level（高レイヤー）` でもこの構成が最小例として採用されています。

```js
import WebgApp from "./webg/WebgApp.js";
import EyeRig from "./webg/EyeRig.js";

const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 0.0,
    pitch: 0.0,
    bank: 0.0
  }
});
await app.init();

const orbit = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
  document,
  element: app.screen.canvas,
  input: app.input,
  type: "orbit",
  orbit: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 24.0,
    pitch: -12.0,
    minDistance: 4.0,
    maxDistance: 18.0,
    wheelZoomStep: 1.0
  }
});
orbit.attachPointer();

app.start({
  onUpdate: ({ deltaSec }) => {
    orbit.update(deltaSec);
  }
});
```

この例では、`WebgApp` が生成した `cameraRig`、`cameraRod`、`eye` をそのまま `EyeRig` に渡しています。`type: "orbit"` を指定すると、`orbit.target` が `base` の位置に、`orbit.yaw / pitch` が `rod` の向きに、`orbit.distance` が `eye` の Z 軸位置にそれぞれ反映されます。ドラッグやホイールによる入力は `attachPointer()` で受け取り、毎フレーム `update(deltaSec)` で座標に反映させます。モデル読み込み直後の高低差確認や、ライティングおよびポストプロセスの検証など、シーンを広い角度から確認したい場合に最適なモードです。

## first-person 視点：身体の向きと視線の分離

first-person（一人称）視点は、カメラがオブジェクトの内部に配置され、前後左右に移動する視点です。ここでの設計のポイントは、進行方向と視線の方向を完全に同一視させないことです。`EyeRig` では、`base` に身体の位置と body yaw を配置し、`eye` に独立した look pitch を持たせています。

```js
const eyeRig = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
  document,
  element: app.screen.canvas,
  input: app.input,
  type: "first-person",
  firstPerson: {
    position: [0.0, 0.0, 28.0],
    bodyYaw: 180.0,
    lookPitch: -8.0,
    eyeHeight: 1.8,
    moveSpeed: 12.0,
    runMultiplier: 2.2
  }
});
eyeRig.attachPointer();

app.start({
  onUpdate: ({ deltaSec }) => {
    eyeRig.update(deltaSec);
  }
});
```

`firstPerson.position` は `base` の位置に、`eyeHeight` は `rod` の Y 位置に、そして `lookPitch` は `eye` の回転に適用されます。これにより、「身体の向きは維持したまま上を見る」あるいは「進行方向から視線を少し外す」といった自然な挙動を実装しやすくなります。コードから明示的に姿勢を変更したい場合は、`setPosition()`、`setAngles()`、`setLookAngles()` を使用します。

```js
eyeRig.setType("first-person");
eyeRig.setPosition(0.0, 0.0, 12.0);
eyeRig.setAngles(180.0, 0.0, 0.0);
eyeRig.setLookAngles(0.0, -10.0, 0.0);
```

ここでの `setAngles()` は身体（body）側の向きを、`setLookAngles()` は視点（eye）側の向きを制御します。両方を同時に大きく変更するとカメラの挙動が不安定になるため、どちらの要素を優先して動かしたいかを明確に区別して利用することを推奨します。

## follow 視点：追従対象と挙動の分離

follow（追従）カメラは、プレイヤーや特定の移動ターゲットを後方から捉える視点です。重要なのは、「追従対象そのもの」と「そこからどのような相対位置・角度で追従するか」という挙動の設定を分離して管理することです。`EyeRig` では、`targetNode` と `targetOffset` で対象を指定し、`distance`、`yaw`、`pitch`、`followLerp` で追従挙動を定義します。

```js
const followRig = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
  document,
  element: app.screen.canvas,
  input: app.input,
  type: "follow",
  follow: {
    targetNode: playerNode,
    targetOffset: [0.0, 2.3, 0.0],
    distance: 16.0,
    yaw: 0.0,
    pitch: -12.0,
    minDistance: 6.0,
    maxDistance: 40.0,
    inheritTargetYaw: true,
    targetYawOffset: 180.0,
    followLerp: 6.0
  }
});
followRig.attachPointer();

app.start({
  onUpdate: ({ deltaSec }) => {
    followRig.update(deltaSec);
  }
});
```

追従対象を変更する場合は `setTargetNode()` を、追従位置を調整（例：頭上や胸元へずらす）したい場合は `setTargetOffset()` を使用します。`inheritTargetYaw: true` を指定すると、対象ノードの向きに合わせて視点も回転するため、常に後方視点を維持しやすくなります。`samples/camera_controller` の follow モードはこの設計に基づいており、ターゲットが複雑な軌道を移動しても視点の整合性が保たれています。follow カメラは、キャラクター主体の移動シーンや、TileMap 上の駒を追跡しながら周囲の状況を提示したい場合に非常に有効です。

## `EyeRig` の補助 API

`EyeRig` はモードの切り替え以外に、運用に便利な補助 API を提供しています。頻繁に利用されるのは以下のメソッド群です。

- `setType(type)`: `"orbit"`、`"first-person"`、`"follow"` の間でモードを切り替えます。不適切な型を指定すると例外が発生するため、型安全性を考慮した指定を推奨します。
- `setDistance(distance)` / `setRodLength(length)`: orbit および follow モードにおける距離を変更します。内部的に `minDistance` と `maxDistance` の範囲にクランプされます。なお、first-person モードでは位置と `eyeHeight` を使用するため、これらのメソッドは主に使用しません。
- `setTarget(x, y, z)` / `setTargetNode(node)` / `setTargetOffset(x, y, z)`: 注視点を座標で固定するか、特定のノードを追従させるかを設定します。
- `setAngles(...)`: `base` や `rod` の向きを変更し、視点の土台を制御します。
- `setLookAngles(...)`: `eye` の独立視線を変更します。

ここでも、土台の向き（`setAngles`）と独立視線（`setLookAngles`）を分けて考えることで、制御の混乱を防ぐことができます。

## 実装上の注意点

`EyeRig` を利用する際は、特に以下の5点に注意してください。

1. `attachPointer()` の呼び出しだけでなく、毎フレーム `update(deltaSec)` を実行すること。
2. `EyeRig` は位置と姿勢を制御するものであり、投影行列（画角など）は変更しないこと。
3. `WebgApp` の既定視点は固定された初期視点であるため、orbit や follow を利用する場合は明示的に `EyeRig` を追加すること。
4. `setAngles()` と `setLookAngles()` の役割を混同しないこと。
5. 視野角や `near / far` を変更したい場合は、`WebgApp.viewAngle` および `updateProjection()` を使用すること。

`EyeRig` は「視点をどこに置き、どちらに向かせるか」というレイヤーであり、「どのように写すか」というレイヤーではありません。この分離を意識することで、カメラに関するトラブルシューティングを効率的に行うことができます。

また、`WebgApp.init()` は標準の `cameraRig`、`cameraRod`、`eye` を自動的に作成します。そのため、独自にカメラノード階層を構築し直す必要はありません。まずは `app.cameraRig`、`app.cameraRod`、`app.eye` をそのまま利用し、その上に `EyeRig` を載せる構成にすることで、コードの可読性と保守性を高めることができます。

## まとめ

本章で最も重要なのは、`EyeRig` を「カメラそのもの」として捉えないことです。視点の本体は `Space.setEye(node)` で指定された `eye` ノードであり、`EyeRig` は `cameraRig`、`cameraRod`、`eye` という3段構成に対して、 orbit、first-person、follow という意味的な制御を与えるヘルパーです。この階層構造があるため、注視点中心の回転、身体と視線を分けた一人称視点、対象を追う追従視点を、共通の概念で扱うことが可能になります。

また、`EyeRig` が管理するのは「位置と姿勢」であり、視野角や投影行列は `WebgApp` 側の `viewAngle`、`projectionNear`、`projectionFar` および `updateProjection()` が管理します。つまり、「どこに置くか」と「どのように写すか」は完全に別の層として分離されています。この設計思想を理解しておくことで、今後の複雑なシーン構築においても、カメラ制御の問題を的確に切り分けることができるでしょう。

次章では、視点操作の上に乗る視覚的な層として、シェーダーとマテリアルの考え方について解説します。