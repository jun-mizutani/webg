# カメラ制御とEyeRig

最終更新: 2026-04-26

`WebgApp` でアプリケーションの基盤が整った後、次に検討すべきは「視点をどのような単位で制御するか」という点です。`webg` では、視点を単一の座標として扱うのではなく、`Space` 内に配置された `cameraRig`、`cameraRod`、`eye` という3段のノード構成を組み合わせてカメラを表現します。`EyeRig` は、この3段構成に対して orbit（軌道）、first-person（一人称）、follow（追従）という3つの視点操作を共通の概念で提供するヘルパークラスです。

本章では、`webg/EyeRig.js` と `webg/WebgApp.js` をベースに、各ノードの役割や3段構成を採用している理由、そして利用者側で制御すべきポイントについて詳述します。第5章で解説した `WebgApp` の標準リグの上に、どのように視点操作を実装するかを順を追って紐解いていきましょう。

まず理解しておくべき重要な点は、視点の本体は `EyeRig` クラスそのものではなく、`Space.setEye(node)` によって指定された `eye` ノードであるということです。`EyeRig` はカメラを描画するクラスではなく、`cameraRig`、`cameraRod`、`eye` という3つの `Node` に対して、一定の規則に基づいた位置と回転を与えるためのヘルパーとしての役割を担います。最終的に画面に何が映るかを決定しているのは、あくまで `eye` ノードです。

また、`base -> rod -> eye` という階層構造は、回転と距離の役割を分離しやすくするための設計です。orbit では注視点、follow では追従対象、first-person では身体の向きと視線の向きを個別に制御したい場面が多くあります。ここで重要になるのが、`setAngles()` と `setLookAngles()` の使い分けです。`setAngles()` は `base` や `rod` の向きを変更し、視点の土台そのものを動かす操作です。対して `setLookAngles()` は `eye` 側の独立した視線を制御するもので、進行方向とは異なる方向を向かせるための補助的な操作となります。

さらに、`attachPointer()` を呼び出しただけでは視点制御は完結しません。`attachPointer()` はマウス、タッチ、ペンなどの入力インターフェースを接続する処理であり、実際のモード切り替え、追従対象への追随、キーボード操作の反映などは `update(deltaSec)` メソッドによって実行されます。入力を設定したにもかかわらず視点が動かない場合は、この `update` 処理の実装漏れがないかを確認してください。

## なぜ `base / rod / eye` の3段構成なのか

![base rod eye カメラ構成図](fig06_01_eyerig_base_rod_eye.jpg)

*EyeRig は base、rod、eye の 3 段に分けることで、水平回転、高低角、最終視点を独立して扱いやすくしています。*

3Dアプリケーションでは、「どこを見るか」だけでなく、「どこを中心に回転するか」「誰を追跡するか」「身体の向きと視線の向きを分けるか」といった要求を場面に応じて切り替える必要があります。視点を単一の座標のみで管理すると、orbit と first-person を共存させた際に制御概念が混在し、設計が複雑になります。`webg` が `base -> rod -> eye` という3段構成を採用しているのは、これらの役割分担を明確に保つためです。

注視点や追従対象に追随する基準位置を `base`、そこからの回転や距離を `rod`、そして最終的な独立視線を `eye` に割り当てることで、モードが切り替わっても一貫した考え方で制御が可能になります。`WebgApp.createCameraRig()` もこの設計思想に基づいて標準のカメラノードを作成します。

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
- orbit: `base` が注視点、`rod` が head / pitch（回転）、`eye` が distance（距離）を担います。
- first-person: `base` が身体の位置と body head、`rod` が eye height（目の高さ）、`eye` が独立視線を担います。
- follow: `base` が追従対象の現在位置、`rod` が後方から見下ろす向き、`eye` が追従距離を担います。

このように共通構造を持つことで、「全景を俯瞰する」「主人公の視点で歩く」「対象を後方から追う」といった異なる視点操作を、同一の型で効率的に扱うことができます。

## 視野角と投影行列の管理

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

ここで `viewAngle` は基準となる垂直方向の視野角です。`webg` は `Screen.getRecommendedFov(base)` を介して、現在のアスペクト比に応じて実際の垂直 FOV を補正します。これにより、横長画面では基準値を維持し、縦長画面では視野を少し広げることで、デバイスの形状に関わらず視認性を維持しています。

したがって、カメラの運用においては、「どこに配置し、どちらを向かせるか」は `EyeRig` や `Node` で制御し、「どれくらい広く写すか」「遠近感をどのように表現するか」は `viewAngle` と投影行列側で制御するという切り分けが重要になります。最も基本的な設定方法は、`WebgApp` の生成時に `viewAngle` および `projectionNear`、`projectionFar` を指定することです。

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
    head: 28.0,
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

## orbit camera の実装とパン(PAN)操作

まずは、最も基本的な orbit（軌道）視点から解説します。注視点と距離を定義し、ドラッグやホイール操作で視点を回転させることで、シーン全体の空間的な位置関係を容易に確認できます。`samples/high_level（ハイレベル（高レイヤー））` でもこの構成が最小例として採用されています。

```js
import WebgApp from "./webg/WebgApp.js";

const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    head: 0.0,
    pitch: 0.0,
    bank: 0.0
  }
});
await app.init();

const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  head: 24.0,
  pitch: -12.0,
  minDistance: 4.0,
  maxDistance: 18.0,
  wheelZoomStep: 1.0
});

app.start();
```

この例では、`WebgApp` が生成した `cameraRig`、`cameraRod`、`eye` の上に、`createOrbitEyeRig()` で orbit 用の `EyeRig` を作成しています。`createOrbitEyeRig()` は、pointer 入力の接続、毎フレームの `update(deltaSec)`、そして `EyeRig` の orbit state と `WebgApp` の camera state の同期をまとめて扱います。これにより、サンプル側で `orbit.update(deltaSec)` や `app.camera.target` への手動コピーを書き忘れて、パン(PAN)が見かけ上動かない状態を避けられます。

返される `orbit` は通常の `EyeRig` なので、必要に応じて `setTarget()`、`setAngles()`、`setDistance()` などもそのまま使えます。`target` が `base` の位置に、`head / pitch` が `rod` の向きに、`distance` が `eye` の Z 軸位置にそれぞれ反映されます。モデル読み込み直後の高低差確認や、ライティングおよびポストプロセスの検証など、シーンを広い角度から確認したい場合に最適なモードです。

ここで重要なのは、orbit 視点が「回転とズームだけのカメラ」ではないという点です。実際の model viewer や editor では、見たい対象を画面の中央へ寄せ直したい場面が頻繁に発生します。たとえば、キャラクター全体を確認したあとに手元だけを拡大したい場合や、建物全景から一部の窓まわりへ視線を移したい場合に、回転だけでは目的の箇所を中央へ持ってきにくいことがあります。このような場面のために、`EyeRig` の orbit / follow には **パン(PAN)** が追加されています。

パン(PAN)は、カメラ自体を別の場所へ瞬間移動させるのではなく、`orbit.target` を視線の screen 平面に沿って平行移動する操作です。これにより、現在の head / pitch / distance を大きく崩さずに、「見ている中心」だけを横や上へずらすことができます。設計上は、right / up の向きを `eye` の world 行列から取り出し、その方向へ `target` を動かすことで実現しています。つまりパン(PAN)はワールド座標の X / Y / Z を固定的に増減する処理ではなく、あくまで「今見えている画面上の左右上下」に対応した移動です。このため、どの角度からモデルを見ていても、直感的に視点中心を動かせます。

`EyeRig` の pointer 操作では、orbit / follow モードで `Shift` を押しながらドラッグするとパン（PAN）操作が有効になります。また、touch では 2 本指操作の中心移動がパン(PAN)に割り当てられています。さらに、キーボード操作でも `Shift + Arrow` によって同じ意味の平行移動を行えます。`createOrbitEyeRig()` を使うと、この入力処理と `WebgApp` camera state への同期が標準でつながるため、サンプルごとに「Shift を押したら target をどう動かすか」を個別に実装しなくても、orbit camera の挙動を共通化できます。

このパン(PAN)が有用なのは、単に操作しやすいからではありません。orbit camera は構図確認に優れていますが、詳細部へ寄ったときに target が対象の中心から外れていると、少し回しただけで見たい箇所が画面外へ出やすくなります。パン(PAN)を併用すると、対象の関心点を中央へ戻した上で回転やズームを続けられるため、viewer、asset 検証、ライティング確認、書籍用の図版調整のいずれでも作業効率が大きく向上します。`gltf_loader`、`collada_loader`、`json_loader` のようなローダーのサンプルで `Shift + Arrow` と `Shift + Drag` を有効にしたのも、まさにこの用途を意識したためです。

`createOrbitEyeRig()` の利点は、視点位置の初期化だけではありません。キーバインディングの既定値は `WebgApp` 側で管理されるため、利用者は「全部の keyMap を毎回書き直す」のではなく、「既定値に対して差分だけを指定する」という形で orbit camera を調整できます。特に、editor や viewer ごとに `Arrow` と `WASD` を切り替えたい場合、また PAN 用 modifier を `Shift` 以外へ変えたい場合に、この方式が有効です。

最も分かりやすい指定方法は、`orbitKeyMap` に差分だけを書く方法です。次の例では、回転キーだけを `W / A / S / D` へ変更し、ズームキーは既定値のまま使います。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  head: 24.0,
  pitch: -12.0,
  orbitKeyMap: {
    left: "a",
    right: "d",
    up: "w",
    down: "s"
  }
});
```

この場合、`zoomIn` と `zoomOut` は既定の `[` と `]` がそのまま使われます。利用者は変更したい項目だけを `orbitKeyMap` に記述すればよく、設定内容を簡潔に管理できます。

PAN に使う modifier key も、`panModifierKey` で変更できます。たとえば `Alt + Drag` と `Alt + W / A / S / D` を PAN にしたい場合は、次のように指定します。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  head: 24.0,
  pitch: -12.0,
  orbitKeyMap: {
    left: "a",
    right: "d",
    up: "w",
    down: "s"
  },
  panModifierKey: "alt"
});
```

`panModifierKey` は modifier key 専用の設定です。これを変更すると、keyboard の PAN 判定と pointer drag の PAN 判定の両方が同じ指定に従います。したがって、利用者側で keyboard と pointer を別々に調整する必要はありません。現在指定できる名称は次のとおりです。

| 役割 | 指定できる名称 |
| :--- | :--- |
| Shift | `shift` |
| Control | `control`、`ctrl` |
| Alt / Option | `alt`、`option` |
| Meta / Command | `meta`、`command`、`cmd` |

この一覧は [16_タッチ機能と入力.md](./16_タッチ機能と入力.md) の特殊キー一覧とも一致しています。`panModifierKey` に一般の文字キーを指定しても pointer drag 側では判定できないため、ここに挙げた modifier key 名だけを使うようにしてください。

### drag button と代替 drag 入力の調整

viewer だけを作る場合、左ドラッグを orbit 回転に割り当てても大きな問題はありません。しかし、modeler や editor では左ドラッグを矩形選択、頂点移動、面選択、ツール操作などに使いたくなるため、カメラ操作を別のボタンへ移す必要があります。`EyeRig` はこの用途のために、通常の camera drag を開始する `dragButton` を受け取ります。

`dragButton` は pointer event の `button` 値です。左ボタンは `0`、中ボタンは `1`、右ボタンは `2` です。`WebgApp.createOrbitEyeRig()` の既定値は左ボタンですが、editor では中ボタンへ変更すると、左ボタンを選択操作へ空けられます。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  head: 24.0,
  pitch: -12.0,
  dragButton: 1
});
```

この設定では、中ボタンドラッグが orbit 回転になります。`panModifierKey` が既定の `"shift"` であれば `Shift + 中ボタンドラッグ` がパン(PAN)になり、wheel は従来通り zoom として動作します。さらに、Blender に近い操作へ寄せたい場合は、`dragZoomModifierKey` を指定すると、modifier 付き drag を wheel とは別の zoom 操作として扱えます。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  head: 24.0,
  pitch: -12.0,
  dragButton: 1,
  panModifierKey: "shift",
  dragZoomModifierKey: "control",
  dragZoomSpeed: 0.04
});
```

この例では、中ボタンドラッグが orbit 回転、`Shift + 中ボタンドラッグ` がパン(PAN)、`Ctrl + 中ボタンドラッグ` が drag zoom になります。`dragZoomSpeed` は drag zoom の感度で、wheel zoom の `wheelZoomStep` とは別に調整できます。中ボタンを camera 用に使う構成は、左ドラッグを矩形選択や編集操作へ使うアプリケーションで特に有効です。

一方で、macOS のトラックパッド環境や一部のマウス設定では、中ボタンドラッグがブラウザまで届かないことがあります。この場合に、アプリケーション側で中ボタンだけを前提にしてしまうと、カメラを回転できない利用者が出ます。そこで `EyeRig` には、通常の `dragButton` とは別に、modifier 付きの代替 drag 開始条件を指定できる `alternateDragButton` と `alternateDragModifierKey` が用意されています。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  head: 24.0,
  pitch: -12.0,
  dragButton: 1,
  panModifierKey: "shift",
  dragZoomModifierKey: "control",
  dragZoomSpeed: 0.04,
  alternateDragButton: 0,
  alternateDragModifierKey: "alt"
});
```

この設定では、通常は中ボタンドラッグで orbit 回転を行います。加えて、`Option + 左ドラッグ` も camera drag の開始条件として認識されます。`alternateDragModifierKey` が押されている場合だけ代替入力として扱うため、左ドラッグ単体は矩形選択や編集操作に残せます。macOS では `Alt` が `Option` キーに相当するため、設定値は `"alt"` または `"option"` のどちらでも同じ意味になります。

代替 drag は `EyeRig` の通常の pointer drag 経路に入るため、drag 開始後の操作分岐は通常の中ボタンドラッグと同じです。上の例では、`Option + 左ドラッグ` が orbit 回転、`Shift + Option + 左ドラッグ` がパン(PAN)、`Ctrl + Option + 左ドラッグ` が drag zoom として扱われます。これは webgmodeler のように「左ドラッグ単体は選択に使い、macOS では Option + 左ドラッグを中ボタン相当として使う」場合に向いた構成です。

ここで注意したいのは、これは不具合を隠すための自動補正ではなく、利用者に公開する明示的な代替操作だという点です。中ボタンが届く環境では `dragButton: 1` がそのまま使われ、macOS などで中ボタン操作が困難な場合だけ `Option + 左ドラッグ` を同じ camera drag として使えるようにします。左ドラッグ単体を代替入力にしてしまうと editor の選択操作と衝突するため、必ず `alternateDragModifierKey` と組み合わせて指定してください。

既定値を確認してから一部だけ上書きしたい場合は、`getDefaultOrbitEyeRigBindings()` を使うと現在の標準設定をそのまま取得できます。開発時に現在の標準設定を明示的に確認したい場合にも便利です。

```js
const defaults = app.getDefaultOrbitEyeRigBindings();

console.log(defaults.keyMap.left);       // "arrowleft"
console.log(defaults.panModifierKey);    // "shift"
console.log(defaults.alternateDragButton); // null
```

返される `orbit` は通常の `EyeRig` なので、生成後に動的変更することもできます。たとえば一時的に editor mode へ入ったときだけ回転キーを変えたい場合は、`orbit.orbit.keyMap` や `orbit.orbit.panModifierKey` を直接更新すれば十分です。

```js
orbit.orbit.keyMap.left = "j";
orbit.orbit.keyMap.right = "l";
orbit.orbit.keyMap.up = "i";
orbit.orbit.keyMap.down = "k";
orbit.orbit.panModifierKey = "control";
```

このように、`createOrbitEyeRig()` は「orbit camera を作る helper」であると同時に、「orbit camera の入力設定を既定値付きで扱う入口」でもあります。利用者は `EyeRig` の内部構造を細かく知らなくても、`head`、`distance`、`orbitKeyMap`、`panModifierKey`、`dragButton`、`alternateDragButton` を与えるだけで、用途に合った orbit camera を素直に構成できます。

コード上で orbit target を明示的にずらしたい場合は、直接 `setTarget()` を呼んでも構いません。たとえば、読み込んだ model の bounding box を使って初期表示を決めたあと、頭部や手元を少し中央へ寄せたいときには、次のように target を更新できます。

```js
orbit.setTarget(
  orbit.orbit.target[0] + 0.4,
  orbit.orbit.target[1] + 0.8,
  orbit.orbit.target[2]
);
```

ただし、screen 平面に沿った自然なパン(PAN)を毎回手作業で書く必要はありません。通常は `attachPointer()` と `update(deltaSec)` を呼ぶだけで、pointer、touch、keyboard の各経路が同じパン(PAN)挙動へ揃います。利用者側は、「orbit target をずらせる」という概念を理解し、必要に応じて `setTarget()` で初期位置を調整するか、実行中は `Shift + Drag` や `Shift + Arrow` を使う、という理解で十分です。

## first-person 視点：身体の向きと視線の分離

first-person（一人称）視点は、カメラがオブジェクトの内部に配置され、前後左右に移動する視点です。ここでの設計のポイントは、進行方向と視線の方向を完全に同一視させないことです。`EyeRig` では、`base` に身体の位置と body head を配置し、`eye` に独立した look pitch を持たせています。

```js
const eyeRig = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
  document,
  element: app.screen.canvas,
  input: app.input,
  type: "first-person",
  firstPerson: {
    position: [0.0, 0.0, 28.0],
    bodyHead: 180.0,
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

follow（追従）カメラは、プレイヤーや特定の移動ターゲットを後方から捉える視点です。重要なのは、「追従対象そのもの」と「そこからどのような相対位置・角度で追従するか」という挙動の設定を分離して管理することです。`EyeRig` では、`targetNode` と `targetOffset` で対象を指定し、`distance`、`head`、`pitch`、`followLerp` で追従挙動を定義します。

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
    head: 0.0,
    pitch: -12.0,
    minDistance: 6.0,
    maxDistance: 40.0,
    inheritTargetHead: true,
    targetHeadOffset: 180.0,
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

追従対象を変更する場合は `setTargetNode()` を、追従位置を調整（例：頭上や胸元へずらす）したい場合は `setTargetOffset()` を使用します。`inheritTargetHead: true` を指定すると、対象ノードの向きに合わせて視点も回転するため、常に後方視点を維持しやすくなります。`samples/camera_controller` の follow モードはこの設計に基づいており、ターゲットが複雑な軌道を移動しても視点の整合性が保たれています。follow カメラは、キャラクター主体の移動シーンや、TileMap 上の駒を追跡しながら周囲の状況を提示したい場合に非常に有効です。

## `EyeRig` の補助 API

`EyeRig` はモードの切り替え以外に、運用に便利な補助 API を提供しています。頻繁に利用されるのは以下のメソッド群です。

- `setType(type)`: `"orbit"`、`"first-person"`、`"follow"` の間でモードを切り替えます。不適切な型を指定すると例外が発生するため、型安全性を考慮した指定を推奨します。
- `setDistance(distance)` / `setRodLength(length)`: orbit および follow モードにおける距離を変更します。内部的に `minDistance` と `maxDistance` の範囲にクランプされます。なお、first-person モードでは位置と `eyeHeight` を使用するため、これらのメソッドは主に使用しません。
- `setTarget(x, y, z)` / `setTargetNode(node)` / `setTargetOffset(x, y, z)`: 注視点を座標で固定するか、特定のノードを追従させるかを設定します。
- `setAngles(...)`: `base` や `rod` の向きを変更し、視点の土台を制御します。
- `setLookAngles(...)`: `eye` の独立視線を変更します。

orbit と follow を使うときは、`setTarget()` / `setTargetOffset()` を「カメラの中心をどこへ置くか」を決める API として理解すると分かりやすくなります。回転とズームだけで対象が扱いにくいときは、まずターゲット側を調整し、その上で角度や距離を調整するのが基本です。パン(PAN)は、このターゲット調整を入力操作として常用できるようにしたものだと考えてください。

ここでも、土台の向き（`setAngles`）と独立視線（`setLookAngles`）を分けて考えることで、制御の整合性を保つことができます。

## 実装上の留意点

`EyeRig` を利用する際は、特に以下のポイントに留意してください。

1. `attachPointer()` の呼び出しだけでなく、毎フレーム `update(deltaSec)` を実行すること。
2. `EyeRig` は位置と姿勢を制御するものであり、投影行列（画角など）は変更しないこと。
3. orbit の標準利用では `WebgApp.createOrbitEyeRig()` を使い、入力更新と camera state 同期を `WebgApp` 側へ任せること。
4. `setAngles()` と `setLookAngles()` の役割を混同しないこと。
5. orbit / follow で細部を追いたい場合は、回転だけで解決しようとせず、パン(PAN)によるターゲット調整を併用すること。
6. editor で左ドラッグを選択操作へ使う場合は、`dragButton: 1` などで camera drag を別ボタンへ移し、macOS 向けには `alternateDragButton` と `alternateDragModifierKey` による明示的な代替操作を用意すること。
7. 視野角や `near / far` を変更したい場合は、`WebgApp.viewAngle` および `updateProjection()` を使用すること。

`EyeRig` は「視点をどこに置き、どちらに向かせるか」というレイヤーであり、「どのように写すか」というレイヤーではありません。この分離を意識することで、カメラに関する原因の切り分けを迅速に行うことが可能になります。

また、`WebgApp.init()` は標準の `cameraRig`、`cameraRod`、`eye` を自動的に作成します。そのため、独自にカメラノード階層を構築し直す必要はありません。まずは `app.cameraRig`、`app.cameraRod`、`app.eye` をそのまま利用し、その上に `EyeRig` を載せる構成にすることで、コードの可読性と保守性を高めることができます。

## まとめ

本章で最も重要なのは、`EyeRig` を「カメラそのもの」として捉えないことです。視点の本体は `Space.setEye(node)` で指定された `eye` ノードであり、`EyeRig` は `cameraRig`、`cameraRod`、`eye` という3段構成に対して、 orbit、first-person、follow という意味的な制御を与えるヘルパーです。この階層構造があるため、注視点中心の回転、身体と視線を分けた一人称視点、対象を追う追従視点を、共通の概念で扱うことが可能になります。

また、`EyeRig` が管理するのは「位置と姿勢」であり、視野角や投影行列は `WebgApp` 側の `viewAngle`、`projectionNear`、`projectionFar` および `updateProjection()` が管理します。つまり、「どこに置くか」と「どのように写すか」は完全に別の層として分離されています。この設計思想を理解しておくことで、今後の複雑なシーン構築においても、カメラ制御の問題を的確に切り分けることができるでしょう。

次章では、視点操作の上に乗る視覚的な層として、シェーダーとマテリアルの考え方について解説します。
