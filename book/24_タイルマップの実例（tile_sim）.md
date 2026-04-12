# 24 タイルマップの実例（tile_sim）

最終更新：2026-04-09 JST

この章は、`samples/tile_sim` を題材に、TileMap 上へスキニング付き glb actor を載せ、複数 unit と animation と camera 操作をどう両立させるかを整理した事例章です。対象は `samples/tile_sim/main.js`、`samples/tile_sim/controller.js`、`samples/tile_sim/alpha_actor.js`、`samples/tile_sim/camera.js` です。

## この章で押さえること

### A. TileMap の論理位置と glb の見た目は別 node として持つ

TileMap 側は「どの cell にいるか」を決め、visible actor 側は「どう見せるか」を担当する、という分離が `tile_sim` の中心です。

### B. 共有ランタイムと `instantiate()` を使うと複数 actor を扱いやすい

`human.glb` は 1 回だけ build し、各 unit は `instantiate()` で独立した animation runtime を持つ構成にすると、GPU resource と runtime state を自然に分けられます。

### C. Touch ボタンとカメラジェスチャーは別経路で扱う

`tile_sim` は TileMap actor の移動用アクションボタンと、canvas 上の orbit / pan / pinch gesture を分けて持つ現在のサンプルです。

## この章の流れ

最初に glb actor を TileMap 上でどう動かすかを見て、そのあとで clip 構成の違い、`human.glb` の実測値、size 決定のコード、ワールド規格へのつなぎ方、汎用化候補、フレームループの組み立て方へ進みます。

## 1. glb の自キャラを TileMap 上で動かす

TileMap 上の自キャラを球ではなく glb のキャラクターにしたい場合も、考え方は同じです。違うのは、`playerNode` が単純な primitive node ではなく、「スキンとボーンを持つ glb runtime の root node」になることと、位置 tween に加えて animation controller も進める必要があることです。

まず大事なのは、glb の見た目を動かす node と、TileMap 上の論理 cell を分けて持つことです。

1. `playerCell` は TileMap 上の論理位置です
2. `heroRoot` は glb 全体を持ち上げて移動させる placement node です
3. `locomotion` は idle / walk / attack のような animation ステートです
4. `moveTween` は今進行中の cell 間移動です

### 1.1 複数 clip を持つ glb をそのまま使う

一般的な character glb では、`Idle`、`Walk`、`Run`、`Attack` のように clip が分かれていることが多いです。この場合は `AnimationState` の controller に `model.runtime` をそのまま渡すと、`state.clip` ベースで扱えます。

```js
// glb character 用の高レベルの app を先に初期化する
import WebgApp from "./webg/WebgApp.js";
import AnimationState from "./webg/AnimationState.js";
import { resolveCameraRelativeGridMove } from "./webg/TileMap.js";

const HERO_GLB = "./hero.glb";

// TileMap と character の両方を同じ app 上で扱う
const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  camera: {
    target: [16.0, 0.0, 16.0],
    distance: 18.0,
    yaw: 0.0,
    pitch: -24.0
  }
});

// app 側の Screen / Shader / Space を起動する
await app.init();
// scene から TileMap runtime を組み立てる
const runtime = await app.loadScene(scene);
const tileMap = runtime.tileMap;

// glb を instantiate して scene 内の 1 体として扱える形へする
const heroModel = await app.loadModel(HERO_GLB, {
  format: "gltf",
  instantiate: true,
  startAnimations: false,
  gltf: {
    includeSkins: true
  }
});

// glb 全体を持ち上げる root node を解決する
const rootInfo = heroModel.runtime.nodes.find((item) => item.parent === null)
  ?? heroModel.runtime.nodes[0];
const heroRoot = heroModel.instantiated.nodeMap.get(rootInfo.id);

// TileMap 上の論理位置と移動中 state を app 側で保持する
let playerCell = tileMap.getTile(3, 3);
let moveTween = null;
// 起動直後の見た目位置は TileMap helper でそろえる
tileMap.placeNodeOnCell(heroRoot, playerCell, 0.02, 0.80);

// 複数 clip を持つ glb では runtime 自体を state machine の controller にできる
const locomotion = new AnimationState(heroModel.runtime, {
  initialState: "idle"
});
locomotion.addState({
  id: "idle",
  clip: "Idle",
  transitions: [
    {
      to: "walk",
      test: (ctx) => ctx.moving === true
    }
  ]
});
locomotion.addState({
  id: "walk",
  clip: "Walk",
  transitions: [
    {
      to: "idle",
      test: (ctx) => ctx.moving !== true
    }
  ]
});

function startMoveTo(nextCell) {
  // 移動中は次の要求を重ねない
  if (moveTween && !moveTween.isFinished()) {
    return false;
  }
  // 論理的に進めるかどうかは TileMap に確認する
  if (!tileMap.canMove(playerCell, nextCell)) {
    return false;
  }

  // glb root を次の cell の上面位置へ向かわせる
  const targetPosition = tileMap.getNodePositionOnCell(nextCell, 0.02, 0.80);
  // displayArea は player 本体より少し先に更新しておく
  tileMap.followCell(nextCell, {
    width: 8,
    height: 6,
    followCol: 2,
    followRow: 2
  });
  tileMap.refreshTileColors();

  // root node の tween と論理位置の確定を分けて持つ
  moveTween = heroRoot.animatePosition(targetPosition, {
    durationMs: 250,
    easing: "outCubic",
    onComplete: () => {
      // 見た目の到着後に論理位置を nextCell へ進める
      moveTween = null;
      playerCell = nextCell;
      tileMap.refreshTileColors();
    }
  });
  return true;
}

app.start({
  onUpdate: () => {
    // 入力が来た frame だけ次の cell を決める
    if (!moveTween || moveTween.isFinished()) {
      if (app.wasActionPressed("move_up")) {
        // camera の向きに合わせて ArrowUp を grid 移動へ変換する
        const move = resolveCameraRelativeGridMove(app.camera.yaw, "arrowup");
        const next = tileMap.getTile(playerCell.col + move.dx, playerCell.row + move.dy);
        startMoveTo(next);
      }
    }

    // state machine は毎 frame 進め、移動中かどうかだけを受け取る
    locomotion.update({
      moving: !!moveTween && !moveTween.isFinished(),
      nowMs: app.space.now()
    });
  }
});
```

この例の `Idle` と `Walk` は説明用の clip 名です。実際のアセットでは名前が異なることが多いため、最初に `heroModel.runtime.getAnimationNames()` を見て、どの clip 名が入っているかを確認してから state 定義を書いてください。

この形の重要ポイントは 3 つです。

1. `heroRoot.animatePosition()` で glb 全体を cell から cell へ運ぶこと
2. `AnimationState.update()` は毎フレーム呼び続けること
3. `moving` の `true` / `false` を、入力ではなく tween の進行状態から決めること

入力を押している間だけ `walk` にするのではなく、「実際に今移動 tween が進んでいるか」で `walk` を決めるほうが、停止直後の pose がずれにくくなります。

### 1.2 1 つの clip の中から区間を切り出して使う glb

`webg/samples/gltf_loader/hand.glb` のように、1 つの clip の中に複数 pose が並んでいるアセットでは、`model.runtime` をそのまま clip controller に使うより、`Action` でキー範囲を action 化してから `AnimationState` を重ねるほうが自然です。`webg/samples/animation_state` と `webg/samples/janken` はこの構成です。

```js
import Action from "./webg/Action.js";
import AnimationState from "./webg/AnimationState.js";

// 1 clip の中に複数 pose が並ぶ asset を読み込む
const heroModel = await app.loadModel("./hand.glb", {
  format: "gltf",
  instantiate: true,
  startAnimations: false,
  gltf: {
    includeSkins: true
  }
});

// glb 全体を運ぶ root node を解決する
const rootInfo = heroModel.runtime.nodes.find((item) => item.parent === null)
  ?? heroModel.runtime.nodes[0];
const heroRoot = heroModel.instantiated.nodeMap.get(rootInfo.id);

// 1 本の clip から必要な key 範囲を action として切り出す
const action = new Action(heroModel.runtime.shapes[0].anim);
action.addPattern({ id: "idlePose", fromKey: 12, toKey: 14, entryDurationMs: 250 });
action.addPattern({ id: "walkPose", fromKey: 4, toKey: 5, entryDurationMs: 180 });
action.addAction("idlePose", ["idlePose"]);
action.addAction("walkPose", ["walkPose"]);

// 切り出した action を state machine へつなぐ
const locomotion = new AnimationState(action, {
  initialState: "idle"
});
locomotion.addState({
  id: "idle",
  action: "idlePose",
  transitions: [
    {
      to: "walk",
      test: (ctx) => ctx.moving === true
    }
  ]
});
locomotion.addState({
  id: "walk",
  action: "walkPose",
  transitions: [
    {
      to: "idle",
      test: (ctx) => ctx.moving !== true
    }
  ]
});

// 起動直後は idle を明示的に開始して pose を安定させる
locomotion.setState("idle", {
  force: true,
  context: {
    moving: false,
    nowMs: app.space.now()
  }
});
```

この例では `fromKey` と `toKey` の値がアセット固有です。`hand.glb` では `webg/samples/animation_state` が使っている区間に合わせていますが、別の glb では clip のキー範囲や意味が異なるため、同じ数字をそのまま流用してはいけません。複数 clip ではなく 1 つの clip を切り出すアセットのときだけ、この方式を使います。

### 1.2.1 `webg/samples/tile_sim/human.glb` で実際にうまくいった構成

`webg/samples/tile_sim/human.glb` は、複数 clip を持つ character asset ではなく、1 本の clip の中に少数 key が並ぶ glb です。今回の `tile_sim` では、これを TileMap 上の自キャラとして動かしながら、次の 4 つを同時に成立させています。

1. TileMap 上の cell から cell への移動
2. idle pose の継続アニメーション
3. 移動開始時の進行方向への回転
4. skinned mesh とボーンアニメーションの正しい描画

ここで重要だったのは、「TileMap 上の論理位置を持つ node」と「glb の見た目そのもの」を分けて持つことです。`tile_sim` では、ball を完全には捨てず、proxy として残しています。TileMap の controller は従来どおり proxy ball を `animatePosition()` で動かし、可視の human.glb 側は毎フレームそのワールド位置へ追従します。こうすると、TileMap 側の移動ルールや `displayArea` 追従を壊さずに、見た目だけを glb へ差し替えられます。

現在の `tile_sim` では、役割分担は次のようになっています。

1. `ballNode`
   TileMap の論理位置、hop を含む位置 tween、camera-relative input の受け口
2. `placementNode`
   visible な Alpha 全体をワールド上でどこへ置くかを受け持つ node
3. `offsetNode`
   足元位置補正、bbox center 補正、モデルの前方向補正を受け持つ node
4. `shape.anim`
   glb から bind 済みの runtime animation を毎フレーム進める入口

この分け方にすると、TileMap は「どの cell にいるか」と「次にどこへ進むか」を決めるだけで済み、glb 側は「どう見せるか」に集中できます。今回うまくいった理由は、ここを混ぜなかったことです。

```js
const alphaActor = await createTileSimAlphaActor(app, ballNode, {
  ballRadius: BALL_RADIUS,
  ballLift: BALL_LIFT,
  footClearance: -0.06,
  scale: 2.0,
  yaw: 180.0
});

const controller = createTileMapController(tileMap, app, ballNode, null, startCell, {
  onMoveStart: ({ fromCell, toCell }) => {
    alphaActor.faceTowardCells(fromCell, toCell, {
      durationMs: BALL_MOVE_DURATION_MS
    });
  }
});

app.start({
  onUpdate: ({ deltaSec }) => {
    alphaActor.update(deltaSec * 1000.0);
  }
});
```

この例で見てほしいのは、TileMap controller に glb の内部事情を持ち込んでいない点です。controller は `fromCell` と `toCell` を外へ渡すだけで、glb の回転や animation 再生は `alphaActor` 側へ閉じ込めています。こうしておくと、別の glb へ差し替えるときも controller 本体はほぼそのまま使えます。

### 1.2.2 今回つまずいた点と、最終的にうまくいった対処

今回の `human.glb` 統合では、一見すると「glb を読み込んで TileMap 上へ置く」だけに見えても、実際にはいくつかの前提をそろえる必要がありました。ここは同じようなアセットを後で載せるときに再びつまずきやすいので、成功した形を明示しておきます。

まず、skinned mesh には `BonePhong` か `BoneNormPhong` を使う必要があります。`tile_sim` の TileMap 本体は `NormPhong` を使っていますが、これはボーンパレットを読まないため、skinned glb をそのまま同じ shader で描くとレストポーズのまま止まります。今回の成功事例では、Alpha 用 runtime shape だけに `BonePhong` を個別に割り当てています。

```js
const boneShader = new BonePhong(app.getGL());
await boneShader.init();
for (const shape of runtime.shapes) {
  shape.setShader(boneShader);
}
```

次に、animation をどこから進めるかも重要でした。`human.glb` は 1 本の clip の中に 3 つのキー状態を持ち、見た目としては `key0 -> key1 -> key2`、かつ `key2` が `key0` と同じ pose です。この型では、まず「clip が bind 済みの shape に正しくつながっているか」を優先して確認するほうが安全です。今回の `tile_sim` では、runtime 全体の clip 名を追い回すより、`runtime.shapes` の中で `shape.anim` を持つ shape を見つけ、その `Animation` を直接 `start()` / `play()` しています。こうしておくと、「animation 名はあるのに、見えている mesh と bind がずれている」という切り分けを減らせます。

さらに、モデル倍率の変更も整理が必要でした。現在の `CoordinateSystem` / `Node` は uniform scale を持てるため、Node 階層側で scale を掛けること自体は可能です。ただし、animated model では「geometry の大きさ」「glTF root local scale」「TileMap 上で最終的にどのくらいで見せたいか」を分けて考えないと、見た目だけが大きすぎたり小さすぎたりしやすくなります。そのため `tile_sim` では、asset data 側へ焼き込む scale と、runtime node 側で最後に掛ける scale を役割分担して使っています。

まず、`ModelAsset.scaleUniform(scale)` はアセット全体を同じ比率で拡大するときの標準入口です。これは mesh だけでなく、次の平行移動成分も同じ比率でそろえて拡大します。

1. mesh geometry の頂点位置
2. node translation
3. skeleton joint の `localMatrix`
4. skeleton joint の `inverseBindMatrix`
5. animation track pose の translation

ここを mesh だけにすると、見た目だけ大きくなってボーンの translation とずれるため、pose が崩れます。逆にここまでそろえると、見た目サイズだけを変えつつ、idle animation と移動アニメーションを保ったまま扱えます。

### 1.2.3 glTF root の local scale を含めて TileMap 上の表示サイズを決める

scale 導入後に重要になったのは、glTF 側の root local scale を「大きいから捨てる」のではなく、復元したまま最終表示サイズを論理的にそろえることです。TileMap 上では、character の大きさは次の 3 つに分けて考えると整理しやすくなります。

1. import 済み mesh 自体の bounding box 高さ
2. glTF root local transform が追加で持つ scale
3. TileMap のワールドに対して最終的にどのくらいで見せたいか

式で書くと、最終表示高さは次のようになります。

```text
finalHeight = bboxHeight * importedRootScale * runtimeNodeScale
```

ここで

* `bboxHeight`
  import 済み shape 群の bounding box 高さ
* `importedRootScale`
  glTF root local transform の uniform scale
* `runtimeNodeScale`
  TileMap 上で最後に掛ける node scale

です。

もし「この model を TileMap 上で高さ `targetHeight` にしたい」と決めるなら、最後に掛ける倍率は次のように逆算できます。

```text
runtimeNodeScale = targetHeight / (bboxHeight * importedRootScale)
```

`tile_sim` では、絶対高さではなく `bboxHeight` に対する比率 `desiredDisplayScale` を持ち、

```text
targetHeight = bboxHeight * desiredDisplayScale
runtimeNodeScale = desiredDisplayScale / importedRootScale
```

として扱っています。これにより、glTF root scale を捨てずに、TileMap 上で欲しい最終サイズだけをそろえられます。

### 1.2.4 `webg/samples/tile_sim/human.glb` の実測値

`2026-04-02 JST` 時点で `webg/samples/tile_sim/human.glb` を確認すると、root node は 1 つで、次の値を持っています。

* root node index: `15`
* root node name: `アーマチュア`
* `sx = sy = sz = 1.4680135250091553`
* `importedRootScale = 1.4680135250091553`

現在の `tile_sim` では、最終表示倍率を次のように置いています。

* Alpha / Warden: `desiredDisplayScale = 0.70`
* Bravo / Mule: `desiredDisplayScale = 0.64`

したがって、実際に `offsetNode` へ掛かる倍率は次の値になります。

* Alpha / Warden
  `0.70 / 1.4680135250091553 = 0.47683484387218733`
* Bravo / Mule
  `0.64 / 1.4680135250091553 = 0.4359632858259999`

ここで重要なのは、利用者が直接 `0.4768...` のような値を決めているのではなく、まず `desiredDisplayScale` を TileMap 側の設計値として決め、そのあと imported data から `importedRootScale` を読み、`runtimeNodeScale` を逆算していることです。この順番にすると、「なぜこの値なのか」を文書とコードの両方から追いやすくなります。

### 1.2.5 TileMap actor の size 決定をコードへ落とし込む例

`tile_sim` の `alpha_actor.js` では、bounding box と imported root scale を次のように使っています。

```js
const measureRuntimeShapeBounds = (app, shapes) => {
  const size = app.getShapeSize(shapes ?? []);
  const minY = Number.isFinite(size.miny) ? size.miny : 0.0;
  const maxY = Number.isFinite(size.maxy) ? size.maxy : minY;
  return {
    centerX: Number.isFinite(size.centerx) ? size.centerx : 0.0,
    centerZ: Number.isFinite(size.centerz) ? size.centerz : 0.0,
    minY,
    maxY,
    height: Math.max(0.0, maxY - minY)
  };
};

const resolveImportedRootUniformScale = (roots) => {
  const scales = [];
  for (let i = 0; i < roots.length; i++) {
    const localMatrix = roots[i]?.nodeInfo?.localMatrix;
    const uniformScale = localMatrix?.getUniformScale?.() ?? null;
    if (Number.isFinite(uniformScale) && uniformScale > 1.0e-8) {
      scales.push(Number(uniformScale));
    }
  }
  if (scales.length <= 0) {
    return 1.0;
  }
  const total = scales.reduce((sum, value) => sum + value, 0.0);
  return total / scales.length;
};
```

そのうえで、TileMap 上へ visible actor を置くときは次のように使います。

```js
const bounds = measureRuntimeShapeBounds(app, runtimeShapes);
const importedRootScale = resolveImportedRootUniformScale(roots);

// bboxHeight に対して最終的に何倍で見せたいかを先に決める
const desiredDisplayScale = 0.70;
// imported root scale は残したまま、最後に掛ける倍率だけを逆算する
const runtimeNodeScale = desiredDisplayScale / importedRootScale;

const offsetNode = app.space.addNode(placementNode, "hero-offset");
offsetNode.setPosition(
  -bounds.centerX * desiredDisplayScale,
  footClearance - (BALL_RADIUS + BALL_LIFT + bounds.minY * desiredDisplayScale),
  -bounds.centerZ * desiredDisplayScale
);
offsetNode.setScale(runtimeNodeScale);

for (const root of roots) {
  root.node.attach(offsetNode);
  // root local scale は捨てずに復元する
  root.node.setByMatrix(root.nodeInfo.localMatrix);
}
```

この例の意図は次のとおりです。

1. `bounds.centerX / centerZ` と `bounds.minY` は、TileMap 上での中心寄せと足元補正に使う
2. それらの補正量は、最終表示倍率 `desiredDisplayScale` を使って計算する
3. glTF root local scale は `setByMatrix(rootInfo.localMatrix)` で復元する
4. そのぶん `offsetNode.setScale(runtimeNodeScale)` は逆算値だけを掛ける

こうしておくと、TileMap 上での足元位置、cell 中央への寄せ方、前後左右の offset は最終的な表示サイズに対してそろいやすくなり、glTF 側の transform 情報も落としません。

### 1.2.6 TileMap のワールド規格へどうつなぐか

最後に必要なのは、「TileMap のワールドで何を基準の高さとするか」です。ここは importer の問題ではなく sample 設計の問題です。`tile_sim` のように論理移動の土台として `BALL_RADIUS` を持つ場合は、次の形で考えると説明しやすくなります。

```text
targetHeight = BALL_RADIUS * K
```

ここで `K` をサンプルの unit 規格値として持てば、別の glb へ差し替えても、

1. まず `bboxHeight` を測る
2. 次に `importedRootScale` を測る
3. `BALL_RADIUS * K` から `targetHeight` を決める
4. `runtimeNodeScale` を逆算する

という同じ手順で TileMap 上のサイズをそろえられます。つまり、TileMap 上の glb actor の size 決定は「なんとなく 0.7 倍にする」ではなく、「TileMap ワールドで前線ユニットをどのくらいの高さで見せたいか」を先に決め、それに imported data を合わせる作業と考えると整理しやすくなります。

最後に、進行方向への回転は、proxy ball 自体を回すのではなく visible 側の `placementNode` を回しています。TileMap では `fromCell` と `toCell` が分かれば十分なので、移動差分の `(dx, dz)` から `atan2(dx, dz)` で yaw を求め、必要なら glb 側の前方向補正だけを定数で足します。今回の `human.glb` では、モデルの前方向が TileMap 側の想定と 180 度ずれていたため、この補正を `alpha_actor.js` 側へ閉じ込めています。

### 1.2.7 今回の成功事例から見えた汎用化候補

今回の `tile_sim` はサンプルとしては十分動いていますが、同じ問題を別のサンプルで再び解きたくない処理も見えてきました。ここは「今すぐコアに入れるべき必須機能」ではなく、今後共通化すると役に立つ候補として整理しておきます。

まず有力なのは、「skinned glb をアプリ全体の既定 shader とは別 shader で安全に `instantiate()` するヘルパー」です。今回のように TileMap 全体を `NormPhong` で描きつつ、一部の actor だけ `BonePhong` を使いたいケースは自然に発生します。現状でもサンプル側で対応できますが、`WebgApp.loadModel()` や `ModelLoader.load()` に「skinned mesh には BonePhong 系を自動選択する」入口があると、レストポーズで止まる初回のつまずきをかなり減らせます。

次に、「ModelAsset へ uniform scale を焼き込むヘルパー」も重要でした。この機能は現在 `ModelAsset.scaleUniform(scale)` としてコアに入りました。TileMap 専用ではなく、glTF / ModelAsset を scene に載せるとき全般で再利用しやすい処理です。特に skinned mesh では、mesh だけでなく skeleton / animation pose の translation もそろえて拡大する必要があるため、この処理をサンプルごとに書かなくてよくなった価値は大きくなります。

さらに、「TileMap actor adapter」も候補になります。今回の `ballNode + placementNode + offsetNode + shape.anim` という構成は理にかなっていますが、サンプル側で毎回組むには少し長いです。たとえば次の責務を持つヘルパーを用意できると、TileMap 上の glb actor をかなり標準化できます。

1. proxy cell node を受け取る
2. visible actor root を追従させる
3. bbox から足元位置を補正する
4. move 開始時に `faceTowardCells()` を呼ぶ
5. idle / walk の切り替えや clip 再生をまとめる

これは `TileMap` 本体へ直接入れるというより、`webg` 側の高レベルヘルパーかサンプル共通ヘルパーとして切り出すのが自然です。TileMap そのものは「盤面の source of truth」であり続け、actor の見え方は別ヘルパーへ分ける今の思想と相性がよくなります。

最後に、「1 clip の少数 key asset を ping-pong 再生するヘルパー」もあると便利です。今回の `human.glb` は結果的に clip 全体 loop で扱えましたが、`key0 -> key1 -> key0` のような短い待機 motion を切り出したいアセットは今後も出てきます。`Action` を使えばすでに表現できますが、「bind 済み shape.anim を取り、指定 key 範囲を往復させる」という最小ヘルパーがあれば、tutorial やサンプルでは説明しやすくなります。

重要なのは、これらを全部一度にコア化する必要はないことです。今回の成功事例から優先度を付けるなら、次の順番が自然です。

1. skinned mesh 用 shader 選択の分かりやすい入口
2. TileMap actor adapter
3. 少数 key clip の ping-pong ヘルパー

### 1.3 TileMap と glb animation を同時に進めるフレーム例

TileMap の cell 移動と glb のアニメーションを同時に扱うループは、次の順序にすると崩れにくくなります。

1. 入力を読む
2. 次の cell を決める
3. 必要なら `animatePosition()` を開始する
4. そのフレームの `moving` や `attackRequested` を作る
5. `AnimationState.update()` を呼ぶ
6. あとの時間進行は `WebgApp` の `space.update(deltaMs)` に任せる

```js
app.start({
  onUpdate: ({ deltaSec }) => {
    // 入力 edge はこの frame に新しい移動を始めるかどうかだけへ使う
    const move = app.wasActionPressed("move_up")
      ? resolveCameraRelativeGridMove(app.camera.yaw, "arrowup")
      : null;

    if (move && (!moveTween || moveTween.isFinished())) {
      // 論理位置から次の cell を決め、移動 tween を開始する
      const nextCell = tileMap.getTile(playerCell.col + move.dx, playerCell.row + move.dy);
      startMoveTo(nextCell);
    }

    // animation state の継続進行は毎 frame 必ず行う
    locomotion.update({
      moving: !!moveTween && !moveTween.isFinished(),
      nowMs: app.space.now(),
      deltaSec
    });
  }
});
```

ここで `AnimationState.update()` を `onComplete()` の中だけで呼ぶのは不十分です。ステートマシンは「移動を開始したフレーム」「移動中の各フレーム」「停止したフレーム」の全部で状態を見たいので、毎フレーム呼び続ける必要があります。`startMoveTo()` は開始地点、`AnimationState.update()` は継続進行地点、と役割を分けると理解しやすくなります。
