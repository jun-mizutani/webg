# カメラ制御とEyeRig

`WebgApp` によってアプリケーションの基盤が整った後、次に検討すべきは「視点をどのような単位で制御するか」という点です。`webg` では、視点を単一の座標として扱うのではなく、`Space` 内に配置された `cameraRig`、`cameraRod`、`eye` という3段のノード構成を組み合わせてカメラを表現します。`EyeRig` は、この3段構成に対して「軌道（orbit）」「一人称（first-person）」「追従（follow）」という3つの視点操作を共通の概念で提供する仕組みです。

本章では、`webg/EyeRig.js` と `webg/WebgApp.js` をベースに、各ノードの役割や3段構成を採用している理由、そして利用者側で制御すべきポイントについて詳述します。第5章で解説した `WebgApp` の標準リグの上に、どのように視点操作を実装するかを順に紐解いていきましょう。

まず理解しておくべき重要な点は、視点の本体は `EyeRig` クラスそのものではなく、`Space.setEye(node)` によって指定された `eye` ノードであるということです。`EyeRig` はカメラを描画するクラスではなく、`cameraRig`、`cameraRod`、`eye` という3つの `Node` に対して、一定の規則に基づいた位置と回転を与えるための支援的な役割を担います。最終的に画面に何が映るかを決定しているのは、あくまで `eye` ノードです。

また、`base -> rod -> eye` という階層構造は、回転と距離の役割を分離しやすくするための設計です。軌道視点では注視点、追従視点では追従対象、一人称視点では身体の向きと視線の向きを個別に制御したい場面が多くあります。ここで重要になるのが、`setAngles()` と `setLookAngles()` の使い分けです。`setAngles()` は `base` や `rod` の向きを変更し、視点の土台そのものを動かす操作です。対して `setLookAngles()` は `eye` 側の独立した視線を制御するもので、進行方向とは異なる方向を向かせるための補助的な操作となります。

さらに、`attachPointer()` を呼び出しただけでは視点制御は完結しません。`attachPointer()` はマウス、タッチ、ペンなどの入力インターフェースを接続する処理であり、実際のモード切り替え、追従対象への追随、キーボード操作の反映などは `update(deltaSec)` メソッドによって実行されます。入力を設定したにもかかわらず視点が動かない場合は、この `update` 処理の実装漏れがないかを確認してください。

## 視点制御の基盤となる3段構成の設計思想

![base rod eye カメラ構成図](fig06_01_eyerig_base_rod_eye.jpg)

*EyeRig は base、rod、eye の 3 段に分けることで、水平回転、高低角、最終視点を独立して扱いやすくしています。*

3Dアプリケーションでは、「どこを見るか」だけでなく、「どこを中心に回転するか」「誰を追跡するか」「身体の向きと視線の向きを分けるか」といった要求を場面に応じて切り替える必要があります。視点を単一の座標のみで管理すると、軌道視点と一人称視点を共存させた際に制御概念が混在し、設計が複雑になります。`webg` が `base -> rod -> eye` という3段構成を採用しているのは、これらの役割分担を明確に保つためです。

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
- 軌道視点 (orbit): `base` が注視点、`rod` が yaw / pitch（回転）、`eye` が distance（距離）を担います。
- 一人称視点 (first-person): `base` が身体の位置と body yaw、`rod` が eye height（目の高さ）、`eye` が独立視線を担います。
- 追従視点 (follow): `base` が追従対象の現在位置、`rod` が後方から見下ろす向き、`eye` が追従距離を担います。

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

ここで `viewAngle` は、短辺方向の見え方を決める基準視野角です。投影行列そのものは縦方向の FOV (`vfov`) を受け取りますが、現代の画面は PC の横長画面とスマートフォンの縦長画面でアスペクト比が大きく異なります。もし常に同じ縦 FOV を使うと、横長画面では縦方向、縦長画面では横方向の見える範囲が意図せず変わり、同じ `viewAngle` でも体感的なズーム量が揃いません。

`webg` ではこの差を抑えるため、`Screen.getRecommendedFov(base)` が `base` を「短辺方向の FOV」として解釈し、現在のアスペクト比から投影行列へ渡す縦 FOV を計算します。アスペクト比は次のように定義されます。

```text
aspect = width / height
```

`aspect >= 1.0` の横長または正方形の画面では、短辺は縦方向です。この場合、短辺方向の FOV と縦 FOV は同じなので、実際に使う `vfov` はそのまま `base` になります。

```text
vfov = base
```

一方、`aspect < 1.0` の縦長画面では、短辺は横方向です。この場合、横方向の FOV (`hfov`) が `base` になるように、縦 FOV を逆算します。透視投影では、距離 `d` における半分の見える幅または高さは `d * tan(fov / 2)` で表せます。横 FOV と縦 FOV の関係は次の式になります。

```text
tan(hfov / 2) = aspect * tan(vfov / 2)
```

縦長画面で `hfov = base` を保ちたいので、`vfov` は次の式で求めます。

```text
vfov = 2 * atan(tan(base / 2) / aspect)
```

これにより、例えば `base = 50°` のとき、PC の横長画面で `aspect = 1.8` なら `vfov = 50°` のままです。一方、スマートフォンの縦長画面で `aspect = 0.5` なら `vfov` は約 `86°` になります。この値だけを見ると広角化しているように見えますが、横方向の FOV は `50°` に保たれます。つまり、画面の短辺方向で見える範囲を維持するために、縦長画面では縦方向を大きく広げている、ということです。

この設計は、短辺方向の見える範囲を「ズーム 1 段階程度の調整で収まる範囲」に保つためのものです。画面の長辺方向は端末によって広くなったり長くなったりしますが、短辺方向が大きく変わらなければ、対象が極端に窮屈になったり、逆に小さくなりすぎたりする問題を避けやすくなります。特に、モバイル縦画面と PC 横画面の両方で同じサンプルを動かす場合、この基準は構図の安定に大きく効きます。

したがって、カメラの運用においては、「どこに配置し、どちらを向かせるか」は `EyeRig` や `Node` で制御し、「どれくらい広く写すか」「遠近感をどのように表現するか」は `viewAngle` と投影行列側で制御するという切り分けを明確にすることが肝要です。最も基本的な設定方法は、`WebgApp` の生成時に `viewAngle` および `projectionNear`、`projectionFar` を指定することです。

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

このとき、`camera.distance` はカメラの物理的な位置を決定し、`viewAngle` は短辺方向におけるレンズの広さに相当します。同じ `distance` であっても、`viewAngle` を小さくすれば望遠的な視覚効果となり、大きくすれば広角的な視覚効果となります。ズーム演出などの実装では、実行中に `viewAngle` を変更して `updateProjection()` を呼び出す手法が有効です。

```js
app.viewAngle = 40.0;
app.updateProjection();
```

```js
app.updateProjection(40.0);
```

この操作はカメラの位置を変更しません。構図を維持したまま、望遠または広角の見え方に切り替えたい場合に適しています。一方で、対象に実際に近づいた感覚を出したい場合は、`EyeRig` 側の `distance` や `position` を変更するのが自然です。また、`projectionNear` と `projectionFar` の設定も重要です。広大なシーンを表示するために `far` を過剰に広げると、深度バッファの精度が低下し、Zファイティング（描画のちらつき）が発生しやすくなるため注意してください。

短辺 FOV は、フルサイズカメラの焦点距離に換算して表示することもできます。フルサイズセンサーの短辺を `24mm` とすると、短辺 FOV `fovShort` に対応する焦点距離は次の式で求められます。

```text
focalLengthMm = 24 / (2 * tan(fovShort / 2))
```

この換算は、`webgmodeler` のような編集用サンプルで特に役立ちます。`50°` や `24°` といった角度表示よりも、`26mm`、`56mm`、`114mm` のようなレンズ相当表示の方が、広角、標準、望遠の感覚を共有しやすいためです。ただし、これは実在するカメラレンズをシミュレートしているという意味ではありません。あくまで、`viewAngle` が作る見え方を、写真でよく使われる焦点距離の言葉へ置き換えるための目安です。

## 軌道視点（Orbit Camera）の実装とパン操作

まずは、最も基本的な軌道（orbit）視点から解説します。注視点と距離を定義し、ドラッグやホイール操作で視点を回転させることで、シーン全体の空間的な位置関係を容易に確認できます。`samples/high_level（高レイヤー（ハイレベル））` でもこの構成が最小例として採用されています。

```js
import WebgApp from "./webg/WebgApp.js";

const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 0.0,
    pitch: 0.0,
    roll: 0.0
  }
});
await app.init();

const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  minDistance: 4.0,
  maxDistance: 18.0,
  wheelZoomStep: 1.0
});

app.start();
```

この例では、`WebgApp` が生成した `cameraRig`、`cameraRod`、`eye` の上に、`createOrbitEyeRig()` で軌道用の `EyeRig` を作成しています。`createOrbitEyeRig()` は、pointer 入力の接続、毎フレームの `update(deltaSec)`、そして `EyeRig` の orbit state と `WebgApp` の camera state の同期をまとめて扱います。これにより、サンプル側で `orbit.update(deltaSec)` や `app.camera.target` への手動コピーを書き忘れて、パン（PAN）操作が正しく機能しない事態を防ぎます。

返される `orbit` は通常の `EyeRig` なので、必要に応じて `setTarget()`、`setAngles()`、`setDistance()` などもそのまま使えます。`target` が `base` の位置に、`yaw / pitch` が `rod` の向きに、`distance` が `eye` の Z 軸位置にそれぞれ反映されます。

ここで重要なのは、軌道視点が「回転とズームだけのカメラ」ではないという点です。実際のモデルビューアやエディタでは、見たい対象を画面の中央へ寄せ直したい場面が頻繁に発生します。たとえば、キャラクター全体を確認したあとに手元だけを拡大したい場合や、建物全景から一部の窓まわりへ視線を移したい場合に、回転だけでは目的の箇所を中央へ持ってきにくいことがあります。このような場面のために、`EyeRig` の orbit / follow には パン（PAN） が実装されています。

パン（PAN）は、カメラ自体を別の場所へ瞬間移動させるのではなく、`orbit.target` を視線のスクリーン平面に沿って平行移動する操作です。これにより、現在の yaw / pitch / distance を大きく崩さずに、「見ている中心」だけを横や上へずらすことができます。設計上は、right / up の向きを `eye` のワールド行列から取り出し、その方向へ `target` を動かすことで実現しています。つまりパン（PAN）はワールド座標の X / Y / Z を固定的に増減する処理ではなく、あくまで「今見えている画面上の左右上下」に対応した移動です。このため、どの角度からモデルを見ていても、直感的に視点中心を動かせます。

`EyeRig` の pointer 操作では、orbit / follow モードで `Shift` を押しながらドラッグするとパン（PAN）操作が有効になります。また、タッチ操作では 2 本指操作の中心移動がパン（PAN）に割り当てられています。さらに、キーボード操作でも `Shift + Arrow` によって同じ平行移動を行えます。`createOrbitEyeRig()` を使うと、この入力処理と `WebgApp` camera state への同期が標準で接続されるため、サンプルごとに個別の実装を行うことなく、軌道カメラの挙動を共通化できます。

このパン（PAN）機能は、単に操作性を向上させるだけでなく、構図の決定において非常に有用です。詳細部へ寄ったときに target が対象の中心から外れていると、少し回転させただけで見たい箇所が画面外へ出やすくなります。パン（PAN）を併用して関心点を中央へ戻してから回転やズームを続けることで、ビューアやアセット検証、ライティング確認などの作業効率が大きく向上します。`gltf_loader`、`collada_loader`、`json_loader` などのローダーサンプルで `Shift + Arrow` と `Shift + Drag` を有効にしたのも、まさにこの用途を想定してのことです。

`createOrbitEyeRig()` の利点は、視点位置の初期化だけでなく、キーバインディングの管理にもあります。キーマップの既定値は `WebgApp` 側で管理されるため、利用者は「すべてのキー設定を書き直す」のではなく、「既定値に対して差分だけを指定する」という形で調整が可能です。

たとえば、回転キーだけを `W / A / S / D` へ変更し、ズームキーは既定値のままにする場合は次のように記述します。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  orbitKeyMap: {
    left: "a",
    right: "d",
    up: "w",
    down: "s"
  }
});
```

この場合、`zoomIn` と `zoomOut` は既定の `[` と `]` がそのまま使われます。また、パン（PAN）に使用する修飾キーは `panModifierKey` で変更可能です。たとえば `Alt + Drag` と `Alt + W / A / S / D` をパン（PAN）にしたい場合は、次のように指定します。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
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

`panModifierKey` を変更すると、キーボードのパン判定とポインタドラッグのパン判定の両方が同時に更新されます。指定可能な修飾キーは以下の通りです。

| 役割 | 指定できる名称 |
| :--- | :--- |
| Shift | `shift` |
| Control | `control`、`ctrl` |
| Alt / Option | `alt`、`option` |
| Meta / Command | `meta`、`command`、`cmd` |

この一覧は [16_タッチ機能と入力.md](./16_タッチ機能と入力.md) の特殊キー一覧と一致しています。

### ドラッグボタンと代替入力の調整

ビューアのみを構築する場合、左ドラッグを軌道回転に割り当てても問題ありません。しかし、モデラーやエディタでは、左ドラッグを矩形選択や頂点移動などのツール操作に割り当てたいため、カメラ操作を別のボタンへ移す必要があります。`EyeRig` はこの用途のために、カメラドラッグを開始する `dragButton` を設定できます。

`dragButton` はポインターイベントの `button` 値を使用します（左: `0`、中: `1`、右: `2`）。エディタ等で中ボタンに変更すると、左ボタンを編集操作に開放できます。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  dragButton: 1
});
```

さらに、Blender のような操作感を実現したい場合は、`dragZoomModifierKey` を指定することで、ホイールとは別のドラッグによるズーム操作を実装できます。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  dragButton: 1,
  panModifierKey: "shift",
  dragZoomModifierKey: "control",
  dragZoomSpeed: 0.04
});
```

この設定では、中ボタンドラッグが回転、`Shift + 中ボタンドラッグ` がパン（PAN）、`Ctrl + 中ボタンドラッグ` がドラッグズームとなります。

一方で、macOS のトラックパッド環境などでは中ボタンドラッグがブラウザに届かない場合があります。これを補完するため、`EyeRig` には修飾キー付きの代替ドラッグ開始条件を指定できる `alternateDragButton` と `alternateDragModifierKey` が用意されています。

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  dragButton: 1,
  panModifierKey: "shift",
  dragZoomModifierKey: "control",
  dragZoomSpeed: 0.04,
  alternateDragButton: 0,
  alternateDragModifierKey: "alt"
});
```

この設定では、通常の中ボタンドラッグに加えて、`Option + 左ドラッグ` もカメラドラッグとして認識されます。`alternateDragModifierKey` が押されているときのみ代替入力として扱うため、左ドラッグ単体での選択操作と衝突させずに導入可能です。これは、webgmodeler のように「左ドラッグは選択に使い、macOS では Option + 左ドラッグを中ボタン相当として使う」構成に最適です。

なお、現在の標準設定を確認したい場合は `getDefaultOrbitEyeRigBindings()` を使用してください。

```js
const defaults = app.getDefaultOrbitEyeRigBindings();

console.log(defaults.keyMap.left);       // "arrowleft"
console.log(defaults.panModifierKey);    // "shift"
console.log(defaults.alternateDragButton); // null
```

また、生成後の `EyeRig` インスタンスに対しても動的に設定を変更することが可能です。

```js
orbit.orbit.keyMap.left = "j";
orbit.orbit.keyMap.right = "l";
orbit.orbit.keyMap.up = "i";
orbit.orbit.keyMap.down = "k";
orbit.orbit.panModifierKey = "control";
```

このように、`createOrbitEyeRig()` は単なるヘルパーではなく、入力設定を既定値付きで管理するエントリーポイントとして機能します。

コード上で注視点を明示的に変更したい場合は、`setTarget()` を使用します。たとえば、モデルのバウンディングボックスに基づいて初期表示を決めた後、特定の部位を中央に寄せたい場合に有効です。

```js
orbit.setTarget(
  orbit.orbit.target[0] + 0.4,
  orbit.orbit.target[1] + 0.8,
  orbit.orbit.target[2]
);
```

ただし、スクリーン平面に沿った自然なパン（PAN）を毎回手作業で実装する必要はありません。`attachPointer()` と `update(deltaSec)` を適切に呼び出せば、ポインタ、タッチ、キーボードのすべての経路で統一されたパン挙動が得られます。

## 一人称視点：身体の向きと視線の方向の独立制御

一人称（first-person）視点は、カメラがオブジェクトの内部に配置され、前後左右に移動する視点です。ここでの設計のポイントは、進行方向と視線の方向を完全に同一視させないことです。`EyeRig` では、`base` に身体の位置と身体の向き（body yaw）を配置し、`eye` に独立した視線角度（look pitch）を持たせています。

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

`firstPerson.position` は `base` の位置に、`eyeHeight` は `rod` の Y 位置に、そして `lookPitch` は `eye` の回転に適用されます。これにより、「身体の向きは維持したまま上を見る」あるいは「進行方向から視線を少し外す」といった自然な挙動を実装しやすくなります。

コードから明示的に姿勢を変更したい場合は、`setPosition()`、`setAngles()`、`setLookAngles()` を使用します。

```js
eyeRig.setType("first-person");
eyeRig.setPosition(0.0, 0.0, 12.0);
eyeRig.setAngles(180.0, 0.0, 0.0);
eyeRig.setLookAngles(0.0, -10.0, 0.0);
```

ここでの `setAngles()` は身体（body）側の向きを、`setLookAngles()` は視点（eye）側の向きを制御します。両方を同時に大きく変更すると挙動が不安定になるため、どちらの要素を優先して動かしたいかを明確に区別して利用することを推奨します。

## 追従視点：追従対象と挙動の分離

追従（follow）カメラは、プレイヤーや特定の移動ターゲットを後方から捉える視点です。重要なのは、「追従対象そのもの」と「そこからどのような相対位置・角度で追従するか」という挙動の設定を分離して管理することです。`EyeRig` では、`targetNode` と `targetOffset` で対象を指定し、`distance`、`yaw`、`pitch`、`followLerp` で追従挙動を定義します。

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

追従対象を変更する場合は `setTargetNode()` を、追従位置を調整（例：頭上や胸元へずらす）したい場合は `setTargetOffset()` を使用します。`inheritTargetYaw: true` を指定すると、対象ノードの向きに合わせて視点も回転するため、常に後方視点を維持しやすくなります。`samples/camera_controller` の follow モードはこの設計に基づいており、ターゲットが複雑な軌道を移動しても視点の整合性が保たれています。

## EyeRig の補助 API

`EyeRig` はモードの切り替え以外に、運用に便利な補助 API を提供しています。

- `setType(type)`: `"orbit"`、`"first-person"`、`"follow"` の間でモードを切り替えます。
- `setDistance(distance)` / `setRodLength(length)`: 軌道および追従モードにおける距離を変更します。内部的に `minDistance` と `maxDistance` の範囲にクランプされます。
- `setTarget(x, y, z)` / `setTargetNode(node)` / `setTargetOffset(x, y, z)`: 注視点を座標で固定するか、特定のノードを追従させるかを設定します。
- `setAngles(...)`: `base` や `rod` の向きを変更し、視点の土台を制御します。
- `setLookAngles(...)`: `eye` の独立視線を変更します。

軌道視点や追従視点を用いる際は、`setTarget()` や `setTargetOffset()` を「カメラの中心をどこに置くか」を決定する API として活用してください。回転やズームだけで対象を捉えにくい場合は、まずターゲット側を調整し、その上で角度や距離を調整するのが基本です。パン（PAN）操作は、このターゲット調整を入力操作として常用できるようにしたものです。

## 実装上の留意点

`EyeRig` を利用する際は、特に以下のポイントに留意してください。

1. `attachPointer()` の呼び出しだけでなく、毎フレーム `update(deltaSec)` を実行すること。
2. `EyeRig` は位置と姿勢を制御するものであり、投影行列（画角など）は変更しないこと。
3. 軌道視点の標準利用では `WebgApp.createOrbitEyeRig()` を使い、入力更新と camera state 同期を `WebgApp` 側に任せること。
4. `setAngles()` と `setLookAngles()` の役割を混同しないこと。
5. 詳細部を追いたい場合は、回転だけで解決しようとせず、パン（PAN）によるターゲット調整を併用すること。
6. エディタで左ドラッグを選択操作に使う場合は、`dragButton: 1` などでカメラドラッグを別ボタンへ移し、macOS 向けには `alternateDragButton` と `alternateDragModifierKey` による代替操作を用意すること。
7. 視野角や `near / far` を変更したい場合は、`WebgApp.viewAngle` および `updateProjection()` を使用すること。

`EyeRig` は「視点をどこに置き、どちらに向かせるか」というレイヤーであり、「どのように写すか」というレイヤーではありません。この分離を意識することで、カメラ制御に関する原因の切り分けを迅速に行うことが可能になります。

また、`WebgApp.init()` は標準の `cameraRig`、`cameraRod`、`eye` を自動的に作成します。そのため、独自にカメラノード階層を構築し直す必要はありません。まずは `app.cameraRig`、`app.cameraRod`、`app.eye` をそのまま利用し、その上に `EyeRig` を載せる構成にすることで、コードの可読性と保守性を高めることができます。

## まとめ

本章で最も重要なのは、`EyeRig` を「カメラそのもの」として捉えないことです。視点の本体は `Space.setEye(node)` で指定された `eye` ノードであり、`EyeRig` は `cameraRig`、`cameraRod`、`eye` という3段構成に対して、意味的な制御を与えるヘルパーです。この階層構造があるため、注視点中心の回転、身体と視線を分けた一人称視点、対象を追う追従視点を、共通の概念で扱うことが可能になります。

また、`EyeRig` が管理するのは「位置と姿勢」であり、視野角や投影行列は `WebgApp` 側の `viewAngle`、`projectionNear`、`projectionFar` および `updateProjection()` が管理します。つまり、「どこに置くか」と「どのように写すか」は完全に別の層として分離されています。この設計思想を理解しておくことで、今後の複雑なシーン構築においても、カメラ制御の問題を的確に切り分けることができるでしょう。

次章では、視点操作の上に乗る視覚的な層として、シェーダーとマテリアルの考え方について解説します。
