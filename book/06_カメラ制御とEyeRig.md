# カメラ制御とEyeRig

`WebgApp` でアプリの土台がそろうと、次に迷いやすいのは「視点をどのような単位で動かすか」です。`webg` では、視点そのものを特別な型で持つのではなく、`Space` の中にある `cameraRig`、`cameraRod`、`eye` の3段ノードを組み合わせてカメラを表します。`EyeRig` は、その3段構成に対して orbit、first-person、follow の3つの視点操作を同じ考え方で与えるヘルパーです。

この章では、`webg/EyeRig.js` と `webg/WebgApp.js` を土台にしながら、どのノードが何を担当しているのか、なぜ3段に分かれているのか、利用者コードではどこを触ればよいのかを順番に整理します。まず背景と考え方をつかみ、そのあとで orbit、first-person、follow の使い方を current 実装に沿ったコードで確認します。第5章で見た `WebgApp` の標準リグの上に、どのように視点操作を載せるかを読む章だと考えるとつながりが分かりやすくなります。

この章で最初に押さえておきたいのは、視点の本体は `EyeRig` ではなく、`Space.setEye(node)` で選ばれた `eye` ノードだという点です。`EyeRig` はカメラを描画するクラスではありません。`cameraRig`、`cameraRod`、`eye` という3つの `Node` に、一定の規則で位置と回転を与えるヘルパーです。画面へ何が映るかを決めている本体は、あくまで `eye` ノードです。

また、`base -> rod -> eye` に分ける構成は、回転と距離の役割を分離しやすくするためのものです。orbit では注視点、follow では追従対象、first-person では体の向きと視線の向きを分けて考えたくなります。ここでさらに重要なのが、`setAngles()` と `setLookAngles()` の違いです。`setAngles()` は `base` や `rod` の向きを変える操作で、視点の土台そのものを動かします。これに対して `setLookAngles()` は `eye` 側の独立視線で、進行方向とは少し違う方向を見るための補助です。

もうひとつ大切なのは、`attachPointer()` だけでは視点制御は完成しないことです。`attachPointer()` は mouse / touch / pen の入力口を取り付けるだけであり、実際の mode 切り替え、follow target の追従、keyboard 操作の反映は `update(deltaSec)` が進めます。入力を付けたのに視点が動かない場合は、この2つのどちらが抜けているかを先に確認すると切り分けやすくなります。

## なぜ `base / rod / eye` の3段構成なのか

3D アプリでは、「どこを見るか」だけでなく、「どこを中心に回るか」「誰を追いかけるか」「体の向きと視線の向きを分けるか」を場面ごとに切り替えたくなります。視点を1つの座標だけで扱うと、最初は簡単でも、あとから orbit と first-person を同居させたときに意味が混ざりやすくなります。`webg` が `base -> rod -> eye` の3段を採るのは、この分担を保ちやすくするためです。注視点や追従対象に追随する基準位置は `base`、そこからの回転や距離は `rod`、最後の独立視線は `eye` に置くと、mode が変わっても考え方を保ちやすくなります。

`WebgApp.createCameraRig()` も、この考え方に沿って標準の camera ノードを作ります。

```js
createCameraRig() {
  this.cameraRig = this.space.addNode(null, this.camera.rigName);
  this.cameraRod = this.space.addNode(this.cameraRig, this.camera.rodName);
  this.eye = this.space.addNode(this.cameraRod, this.camera.eyeName);
  this.space.setEye(this.eye);
}
```

ここで大切なのは、`EyeRig` がなければ視点が作れないわけではないことです。`EyeRig` は、すでにある3段構成へ orbit / first-person / follow の意味を与えるヘルパーだと考えると位置づけが分かりやすくなります。`WebgApp.init()` は標準の `cameraRig`、`cameraRod`、`eye` を作成し、`space.setEye(this.eye)` まで行うので、利用者はその上に `EyeRig` を載せれば十分です。

mode ごとの見方も、この3段構成で整理できます。orbit では `base` が注視点、`rod` が yaw / pitch、`eye` が distance を持ちます。first-person では `base` が体の位置と body yaw、`rod` が eye height、`eye` が独立視線を持ちます。follow では `base` が追従対象の現在位置、`rod` が後方から見下ろす向き、`eye` が追従距離を持ちます。同じ scene に対して「全景を回しながら見る」「主人公の目線で歩く」「対象の後ろから追いかける」を同じ型で扱えるのは、この共通構造があるためです。

## 視野角と投影行列は `EyeRig` ではなく `WebgApp` が扱う

camera を理解するときに見落としやすいのは、`EyeRig` が扱うのは位置と姿勢までであり、「どれくらい広く写すか」は別の制御だという点です。`webg` では `WebgApp` が `viewAngle`、`projectionNear`、`projectionFar` を持ち、`updateProjection()` で現在のシェーダーへ投影行列を流します。

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

ここで `viewAngle` は基準となる縦方向の視野角です。`webg` は `Screen.getRecommendedFov(base)` を通して、現在の aspect 比に応じて実際の縦 FOV を少し補正します。横長画面ではほぼそのまま、縦長画面では少し広めにすることで、端末の形が変わっても窮屈に見えにくくしています。したがって、camera の運用では「どこに置くか」「どちらを向かせるか」は `EyeRig` や `Node` 側、「どれくらい広く写すか」「遠近感をどれくらい強く見せるか」は `viewAngle` と投影行列側、と分けて考えると整理しやすくなります。

もっとも基本的なのは、`WebgApp` の生成時に `viewAngle`、必要なら `projectionNear` と `projectionFar` を与える方法です。

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

このとき `camera.distance` は camera の位置、`viewAngle` はレンズの広さに相当します。同じ distance でも `viewAngle` が小さければ望遠寄りに見え、大きければ広角寄りに見えます。ズーム演出や比較表示では、実行中に `viewAngle` を変えて `updateProjection()` を呼ぶ方法も使えます。

```js
app.viewAngle = 40.0;
app.updateProjection();
```

```js
app.updateProjection(40.0);
```

この操作は camera の位置を変えません。構図を保ったまま、望遠寄りまたは広角寄りの見え方へ切り替えたいときに向いています。反対に、対象へ実際に近づいた感じを出したいなら、`EyeRig` 側の distance や position を動かすほうが自然です。また、`projectionNear` と `projectionFar` も camera 設計の一部です。大きな scene を遠くまで見せたいからといって無闇に `far` を広げると、深度精度が荒れやすくなります。

## まずは orbit camera を動かす

最初に覚えるなら orbit が分かりやすくなります。注視点と距離を決め、drag や wheel で回すだけで、scene 全体の位置関係を確認しやすいからです。`samples/high_level` も、この構成を最小例として使っています。

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

この例では、`WebgApp` が作った `cameraRig`、`cameraRod`、`eye` をそのまま `EyeRig` に渡しています。`type: "orbit"` を選ぶと、`orbit.target` が `base` の位置になり、`orbit.yaw / pitch` が `rod` の向き、`orbit.distance` が `eye` の Z 位置になります。drag や wheel の入力は `attachPointer()` で受け取り、毎フレーム `update(deltaSec)` で反映します。モデルを読み込んだ直後、TileMap の高低差を見たいとき、ライトやポストプロセスの見え方を広い角度から確認したいときは、まず orbit を基準にすると全体像をつかみやすくなります。

## first-person は「体の向き」と「視線」を分けて考える

first-person は、camera が object の中に入り、前後左右へ移動する視点です。ここで重要なのは、進行方向と視線を1本にまとめ切らないことです。`EyeRig` では、`base` に体の位置と body yaw を置き、`eye` に独立した look pitch を与えられます。

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

`firstPerson.position` は `base` の位置、`eyeHeight` は `rod` の Y 位置、`lookPitch` は `eye` の回転に流れます。これにより、体の向きは保ったまま少し上を見る、あるいは進行方向から少し視線を外す、といった操作を入れやすくなります。コード側から明示的に姿勢を変えたい場合は、`setPosition()`、`setAngles()`、`setLookAngles()` を使います。

```js
eyeRig.setType("first-person");
eyeRig.setPosition(0.0, 0.0, 12.0);
eyeRig.setAngles(180.0, 0.0, 0.0);
eyeRig.setLookAngles(0.0, -10.0, 0.0);
```

ここでの `setAngles()` は body 側、`setLookAngles()` は eye 側という分担です。両方を同時に大きく回すと意図以上に camera が振れるので、どちらに意味を持たせたいかを決めてから使うほうが読みやすくなります。

## follow は「追従対象」と「追従のしかた」を分ける

follow camera は、プレイヤーや移動ターゲットを後方から見る視点です。重要なのは、追従対象そのものと、そこからどれくらい遅れて、どの角度から見るかを別の設定として持つことです。`EyeRig` では `targetNode` と `targetOffset` が対象、`distance`、`yaw`、`pitch`、`followLerp` が追従のしかたを表します。

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

`targetNode` を差し替えるときは `setTargetNode()`、追従位置を少し上げたいときは `setTargetOffset()` を使います。`inheritTargetYaw: true` を指定すると、対象ノードの向きに応じて後方視点を保ちやすくなります。`samples/camera_controller` の follow mode はこの考え方で構成されており、移動ターゲットが円軌道を回っても視点の意味が崩れにくくなっています。follow camera は、キャラクターを主役にした移動系サンプルや、TileMap 上の駒を追いながら周囲も見せたい場面で使いやすく、orbit より対象への集中を保ちやすく、first-person より周囲の状況を見失いにくいのが強みです。

## `EyeRig` の補助 API

`EyeRig` は mode を切り替えるだけでなく、いくつかの補助 API を持っています。利用者が触ることが多いのは、`setType(type)`、`setDistance(distance)` / `setRodLength(length)`、`setTarget(x, y, z)` / `setTargetNode(node)` / `setTargetOffset(x, y, z)`、`setAngles(...)`、`setLookAngles(...)` といった一群です。`setType(type)` は `"orbit"`、`"first-person"`、`"follow"` を切り替えます。未知の型を渡すと例外になるため、文字列を曖昧に補正してくれる前提では使わないほうが安全です。`setDistance(distance)` と `setRodLength(length)` は orbit と follow の距離を変える API で、内部では `minDistance` と `maxDistance` に収まるよう clamp されます。first-person では距離ではなく位置と eyeHeight を使うため、これらを主役にしません。 

また、対象を point として固定したいときは `setTarget(x, y, z)`、特定ノードを追従したいときは `setTargetNode(node)`、追従位置を頭上や胸元へずらしたいときは `setTargetOffset(x, y, z)` を使います。`setAngles()` は `base` や `rod` の向きを変え、`setLookAngles()` は `eye` の独立視線を変えます。ここでも、土台の向きと独立視線を分けて考えるほうが混乱しにくくなります。

## 使い始めるときの注意点

利用時に特に注意したいのは、`attachPointer()` だけで終わらせないこと、毎フレーム `update(deltaSec)` を呼ぶこと、`EyeRig` は投影行列を変えないこと、`WebgApp` の既定視点は固定された初期視点であり、orbit や follow は明示的に追加すること、`setAngles()` と `setLookAngles()` を混同しないこと、この5点です。`EyeRig` は「視点の位置と向きをどう決めるか」の層であり、「どう写るか」の層ではありません。視野角や `near / far` を変えたいなら `WebgApp.viewAngle` と `updateProjection()` の側を見る必要があります。

また、`WebgApp.init()` は標準の `cameraRig`、`cameraRod`、`eye` を作成するため、最初から camera 用ノード階層を自分で組み直す必要はありません。まずは `app.cameraRig`、`app.cameraRod`、`app.eye` をそのまま使い、その上に `EyeRig` を載せるほうが、サンプルや教材としても読みやすくなります。

## まとめ

この章で最も大事なのは、`EyeRig` を「カメラそのもの」として見ないことです。視点の本体は `Space.setEye(node)` で選ばれた `eye` ノードであり、`EyeRig` は `cameraRig`、`cameraRod`、`eye` という3段構成に orbit、first-person、follow の意味を与えるヘルパーです。この3段構成があるため、注視点を中心に回る視点、体の向きと視線を分けた一人称視点、対象の後方から追う追従視点を、同じ考え方で扱えます。

また、`EyeRig` が扱うのは位置と姿勢までであり、視野角や投影行列は `WebgApp` 側の `viewAngle`、`projectionNear`、`projectionFar`、`updateProjection()` が扱います。つまり、「どこに置くか」と「どのように写るか」は別の層です。この分け方を先に意識しておくと、以後のサンプルや実アプリで camera の問題を切り分けやすくなります。次章では、視点操作の上に乗る見た目の層として、シェーダーとマテリアルの考え方を見ていきます。
