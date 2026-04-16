# タイルマップの実例：tile_sim

TileMap を単独で理解するだけでは、実際のアプリでアクター、アニメーション、camera、入力系とどう共存させるかはまだ見えてきません。`tile_sim` は、その複数の要素を同時に成立させている統合事例です。本章では、TileMap の論理位置、可視アクター、アニメーションランタイム、camera ジェスチャーをどのように分離し、どの役割をどこへ置いているかを整理します。 

ここで最初に押さえたいのは、`tile_sim` の中心が「TileMap の論理位置」と「glb の見た目」を別 node として持つことにある、という点です。TileMap 側は「どの cell にいるか」を決め、可視アクター側は「どう見せるか」を担当します。また、`human.glb` は 1 回だけ build し、各 unit は `instantiate()` で独立したアニメーションランタイムを持つ構成にすると、GPU resource と runtime state を自然に分けられます。さらに、`tile_sim` は TileMap アクターの移動用アクションボタンと、canvas 上の orbit / pan / pinch ジェスチャーを分けて持つ現在のサンプルです。つまり、盤面ロジック、可視アクター、入力経路の 3 つを分離していることが、このサンプルの最も重要な設計上の特徴です。 

## `tile_sim` をどう読むか
<!-- 図候補: tile_sim 構成図 -->

![tile_sim 構成図](fig24_01_tilesim_structure.jpg)

*tile_sim は 1 ファイル完結のサンプルではなく、TileMap、アクター、camera、mission を役割ごとに分けた実践例として読むと整理しやすくなります。*

`tile_sim` を読むときにまず見るべきなのは、「1 つのプレイヤーオブジェクトをそのまま TileMap の上へ載せている」のではないことです。実際には、盤面上の論理位置、見た目のアクター、入力処理、camera の追従がそれぞれ別層として保たれています。ここを最初に見落とすと、移動、回転、アニメーション、camera 追従の役割がどこにあるのか分かりにくくなります。 

本章では、最初に glb アクターを TileMap 上でどう動かすかを見て、そのあとで clip 構成の違い、`human.glb` の実測値、size 決定のコード、ワールド規格へのつなぎ方、汎用化候補、フレームループの組み立て方へ進みます。つまり、「まず動く仕組みを見る」「次に `human.glb` がなぜその仕組みでうまくいったかを見る」「最後に共通化できる部分を整理する」という順で読むと理解しやすくなります。 

## TileMap 上の glb アクターをどう構成するか

TileMap 上の自キャラを球ではなく glb のキャラクターにしたい場合も、考え方は同じです。違うのは、`playerNode` が単純な primitive node ではなく、「スキンとボーンを持つ glb ランタイムの root node」になることと、位置 tween に加えてアニメーションコントローラーも進める必要があることです。ここで大切なのは、「TileMap 上の論理位置」と「glb の見た目の移動」を 1 つの node に押し込めないことです。`tile_sim` を理解するときは、まずこの役割分担から入るほうが整理しやすくなります。 

この分け方にすると、TileMap は「どこへ進めるか」を返し、可視アクターは「どう見せるか」を受け持ちます。つまり、盤面ロジックとアクターの見え方を別層として保てます。 

### 複数 clip を持つ glb

一般的なキャラクター glb では、`Idle`、`Walk`、`Run`、`Attack` のように clip が分かれていることが多いです。この場合は `AnimationState` のコントローラーに `model.runtime` をそのまま渡すと、`state.clip` ベースで扱えます。つまり、clip がアセット側ですでに分かれているなら、アプリ側でそれ以上分割せず、そのままステートマシンの対象にするほうが分かりやすくなります。 

```js
import WebgApp from "./webg/WebgApp.js";
import AnimationState from "./webg/AnimationState.js";
import { resolveCameraRelativeGridMove } from "./webg/TileMap.js";

const HERO_GLB = "./hero.glb";

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

await app.init();
const runtime = await app.loadScene(scene);
const tileMap = runtime.tileMap;

const heroModel = await app.loadModel(HERO_GLB, {
  format: "gltf",
  instantiate: true,
  startAnimations: false,
  gltf: {
    includeSkins: true
  }
});

const rootInfo = heroModel.runtime.nodes.find((item) => item.parent === null)
  ?? heroModel.runtime.nodes[0];
const heroRoot = heroModel.instantiated.nodeMap.get(rootInfo.id);

let playerCell = tileMap.getTile(3, 3);
let moveTween = null;
tileMap.placeNodeOnCell(heroRoot, playerCell, 0.02, 0.80);

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
  if (moveTween && !moveTween.isFinished()) {
    return false;
  }
  if (!tileMap.canMove(playerCell, nextCell)) {
    return false;
  }

  const targetPosition = tileMap.getNodePositionOnCell(nextCell, 0.02, 0.80);
  tileMap.followCell(nextCell, {
    width: 8,
    height: 6,
    followCol: 2,
    followRow: 2
  });
  tileMap.refreshTileColors();

  moveTween = heroRoot.animatePosition(targetPosition, {
    durationMs: 250,
    easing: "outCubic",
    onComplete: () => {
      moveTween = null;
      playerCell = nextCell;
      tileMap.refreshTileColors();
    }
  });
  return true;
}

app.start({
  onUpdate: () => {
    if (!moveTween || moveTween.isFinished()) {
      if (app.wasActionPressed("move_up")) {
        const move = resolveCameraRelativeGridMove(app.camera.yaw, "arrowup");
        const next = tileMap.getTile(playerCell.col + move.dx, playerCell.row + move.dy);
        startMoveTo(next);
      }
    }

    locomotion.update({
      moving: !!moveTween && !moveTween.isFinished(),
      nowMs: app.space.now()
    });
  }
});
```

この例の `Idle` と `Walk` は説明用の clip 名です。実際のアセットでは名前が異なることが多いため、最初に `heroModel.runtime.getAnimationNames()` を見て、どの clip 名が入っているかを確認してから state 定義を書く必要があります。ここでも `TileMap` は論理位置と移動可否を返し、glb runtime 側が animation を進めている、という分担になっています。 

この形の重要ポイントは 3 つです。`heroRoot.animatePosition()` で glb 全体を cell から cell へ運ぶこと、`AnimationState.update()` は毎フレーム呼び続けること、`moving` の `true` / `false` を入力ではなく tween の進行状態から決めることです。入力を押している間だけ `walk` にするのではなく、「実際に今移動 tween が進んでいるか」で `walk` を決めるほうが、停止直後の pose がずれにくくなります。 

### 1 clip 内の区間を切り出す glb

`webg/samples/gltf_loader/hand.glb` のように、1 つの clip の中に複数 pose が並んでいるアセットでは、`model.runtime` をそのまま clip controller に使うより、`Action` でキー範囲を action 化してから `AnimationState` を重ねるほうが自然です。`webg/samples/animation_state` と `webg/samples/janken` はこの構成です。つまり、clip が 1 本しかなく、その中に複数状態が詰め込まれている場合だけ、アプリ側で action へ切り分けるという判断になります。 

```js
import Action from "./webg/Action.js";
import AnimationState from "./webg/AnimationState.js";

const heroModel = await app.loadModel("./hand.glb", {
  format: "gltf",
  instantiate: true,
  startAnimations: false,
  gltf: {
    includeSkins: true
  }
});

const rootInfo = heroModel.runtime.nodes.find((item) => item.parent === null)
  ?? heroModel.runtime.nodes[0];
const heroRoot = heroModel.instantiated.nodeMap.get(rootInfo.id);

const action = new Action(heroModel.runtime.shapes[0].anim);
action.addPattern({ id: "idlePose", fromKey: 12, toKey: 14, entryDurationMs: 250 });
action.addPattern({ id: "walkPose", fromKey: 4, toKey: 5, entryDurationMs: 180 });
action.addAction("idlePose", ["idlePose"]);
action.addAction("walkPose", ["walkPose"]);

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

locomotion.setState("idle", {
  force: true,
  context: {
    moving: false,
    nowMs: app.space.now()
  }
});
```

この例では `fromKey` と `toKey` の値がアセット固有です。`hand.glb` では `webg/samples/animation_state` が使っている区間に合わせていますが、別の glb では clip のキー範囲や意味が異なるため、同じ数字をそのまま流用してはいけません。複数 clip ではなく 1 つの clip を切り出すアセットのときだけ、この方式を使います。 

## `human.glb` でうまくいった構成

`webg/samples/tile_sim/human.glb` は、複数 clip を持つ character asset ではなく、1 本の clip の中に少数 key が並ぶ glb です。今回の `tile_sim` では、これを TileMap 上の自キャラとして動かしながら、次の 4 つを同時に成立させています。TileMap 上の cell から cell への移動、idle pose の継続アニメーション、移動開始時の進行方向への回転、skinned mesh とボーンアニメーションの正しい描画です。 

### proxy node と visible actor の分離

ここで重要だったのは、「TileMap 上の論理位置を持つ node」と「glb の見た目そのもの」を分けて持つことです。`tile_sim` では、ball を完全には捨てず、代理として残しています。TileMap の controller は従来どおり代理 ball を `animatePosition()` で動かし、可視の `human.glb` 側は毎フレームそのワールド位置へ追従します。こうすると、TileMap 側の移動ルールや `displayArea` 追従を壊さずに、見た目だけを glb へ差し替えられます。つまり、論理移動の基準を残したまま、可視表現だけを差し替える構成になっています。 

現在の `tile_sim` では、役割分担は次のようになっています。`ballNode` は TileMap の論理位置、hop を含む位置 tween、camera-relative input の受け口です。`placementNode` は visible な Alpha 全体をワールド上でどこへ置くかを受け持つ node です。`offsetNode` は足元位置補正、bbox center 補正、モデルの前方向補正を受け持つ node です。`shape.anim` は glb から bind 済みの runtime animation を毎フレーム進める入口です。この分け方にすると、TileMap は「どの cell にいるか」と「次にどこへ進むか」を決めるだけで済み、glb 側は「どう見せるか」に集中できます。 

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

### skinned mesh と shader

今回の `human.glb` 統合で、最初につまずきやすい点は shader です。skinned mesh には `BonePhong` か `BoneNormPhong` を使う必要があります。`tile_sim` の TileMap 本体は `NormPhong` を使っていますが、これはボーンパレットを読まないため、skinned glb をそのまま同じ shader で描くとレストポーズのまま止まります。今回の成功事例では、Alpha 用 runtime shape だけに `BonePhong` を個別に割り当てています。つまり、TileMap 全体の標準 shader と actor 側の shader を分けて考える必要がありました。 

```js
const boneShader = new BonePhong(app.getGL());
await boneShader.init();
for (const shape of runtime.shapes) {
  shape.setShader(boneShader);
}
```

ここは `tile_sim` の実例を読むうえで非常に重要で、アニメーションが動かない問題を clip 名や state machine の問題だと思い込む前に、まず skinned mesh がボーン対応 shader で描かれているかを確認するほうが安全です。 

### animation の進め方

次に重要なのは、animation をどこから進めるかです。`human.glb` は 1 本の clip の中に 3 つのキー状態を持ち、見た目としては `key0 -> key1 -> key2`、かつ `key2` が `key0` と同じ pose です。この型では、まず「clip が bind 済みの shape に正しくつながっているか」を優先して確認するほうが安全です。今回の `tile_sim` では、runtime 全体の clip 名を追い回すより、`runtime.shapes` の中で `shape.anim` を持つ shape を見つけ、その `Animation` を直接 `start()` / `play()` しています。こうしておくと、「animation 名はあるのに、見えている mesh と bind がずれている」という切り分けを減らせます。 

## TileMap 上の表示サイズをどう決めるか

animated model では「geometry の大きさ」「glTF root local scale」「TileMap 上で最終的にどのくらいで見せたいか」を分けて考えないと、見た目だけが大きすぎたり小さすぎたりしやすくなります。そのため `tile_sim` では、asset data 側へ焼き込む scale と、runtime node 側で最後に掛ける scale を役割分担して使っています。表示倍率の決定は「なんとなく 0.7 倍にする」ではなく、「TileMap ワールドでどの高さに見せたいか」を先に決め、そのあと imported data を合わせる作業として整理されています。 

### `bboxHeight` と `importedRootScale`

scale 導入後に重要になったのは、glTF 側の root local scale を「大きいから捨てる」のではなく、復元したまま最終表示サイズを論理的にそろえることです。TileMap 上では、character の大きさは次の 3 つに分けて考えると整理しやすくなります。import 済み mesh 自体の bounding box 高さ、glTF root local transform が追加で持つ scale、TileMap のワールドに対して最終的にどのくらいで見せたいか、の 3 つです。 

式で書くと、最終表示高さは次のようになります。

```text
finalHeight = bboxHeight * importedRootScale * runtimeNodeScale
```

ここで `bboxHeight` は import 済み shape 群の bounding box 高さ、`importedRootScale` は glTF root local transform の uniform scale、`runtimeNodeScale` は TileMap 上で最後に掛ける node scale です。 

### `runtimeNodeScale` の逆算

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

`webg/samples/tile_sim/human.glb` の現在の実測値では、root node は 1 つで `sx = sy = sz = 1.4680135250091553` を持っています。したがって `desiredDisplayScale = 0.70` なら `runtimeNodeScale = 0.47683484387218733` になります。ここで重要なのは、利用者が直接 `0.4768...` を決めているのではなく、まず `desiredDisplayScale` を TileMap 側の設計値として決め、そのあと imported data から `importedRootScale` を読み、`runtimeNodeScale` を逆算していることです。 

### TileMap ワールドの規格に合わせる

`tile_sim` の `alpha_actor.js` では、bounding box と imported root scale を次のように使っています。ここで見てほしいのは、bounding box 計測、root scale 解決、最終 node scale の逆算が別の関数へ分離されていることです。つまり、サイズ決定の役割を一塊の式にせず、読みやすい手順へ分けています。 

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

const desiredDisplayScale = 0.70;
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
  root.node.setByMatrix(root.nodeInfo.localMatrix);
}
```

この例の意図は次のとおりです。`bounds.centerX / centerZ` と `bounds.minY` は TileMap 上での中心寄せと足元補正に使うこと、それらの補正量は最終表示倍率 `desiredDisplayScale` を使って計算すること、glTF root local scale は `setByMatrix(rootInfo.localMatrix)` で復元すること、そのぶん `offsetNode.setScale(runtimeNodeScale)` は逆算値だけを掛けることです。こうしておくと、TileMap 上での足元位置、cell 中央への寄せ方、前後左右の offset は最終的な表示サイズに対してそろいやすくなり、glTF 側の transform 情報も落としません。 

最後に必要なのは、「TileMap のワールドで何を基準の高さとするか」です。ここは importer の問題ではなく sample 設計の問題です。`tile_sim` のように論理移動の土台として `BALL_RADIUS` を持つ場合は、`targetHeight = BALL_RADIUS * K` のように unit 規格値を持つと、別の glb へ差し替えても同じ手順で size をそろえやすくなります。つまり、TileMap 上の glb actor の size 決定は「なんとなく 0.7 倍にする」ではなく、「TileMap ワールドで前線ユニットをどのくらいの高さで見せたいか」を先に決め、それに imported data を合わせる作業と考えると整理しやすくなります。 

## 今回の事例から見えた共通パターン

今回の `tile_sim` はサンプルとしては十分動いていますが、同じ問題を別のサンプルで再び解きたくない処理も見えてきました。ここは「今すぐコアに入れるべき必須機能」ではなく、今後共通化すると役に立つ候補として整理しておきます。つまり、この節は `tile_sim` の完成形を崩す話ではなく、どこに共通パターンがあるかを見つけるための整理です。 

まず有力なのは、「skinned glb をアプリ全体の標準 shader とは別 shader で安全に `instantiate()` するヘルパー」です。今回のように TileMap 全体を `NormPhong` で描きつつ、一部の actor だけ `BonePhong` を使いたいケースは無理なく出てきます。次に、「TileMap actor adapter」も候補になります。`ballNode + placementNode + offsetNode + shape.anim` という構成は理にかなっていますが、サンプル側で毎回組むには少し長くなります。最後に、「1 clip の少数 key asset を ping-pong 再生するヘルパー」もあると便利です。今回の `human.glb` は結果的に clip 全体 loop で扱えましたが、短い待機 motion を切り出したいアセットは今後も出てきます。 

重要なのは、これらを全部一度にコア化する必要はないことです。今回の成功事例から優先度を付けるなら、まず「初回でつまずきやすい入口」を減らし、そのあと「サンプルごとの重複」を減らす方向で共通化を進めるのがよさそうです。 

## フレームループの組み立て

TileMap の cell 移動と glb のアニメーションを同時に扱うループは、次の順序にすると崩れにくくなります。ここでの要点は、「入力で新しい移動を開始する処理」と「animation state を毎フレーム継続進行させる処理」を分けることです。つまり、移動開始地点と継続更新地点を別に持つ構成が安定します。 

1. 入力を読む
2. 次の cell を決める
3. 必要なら `animatePosition()` を開始する
4. そのフレームの `moving` や `attackRequested` を作る
5. `AnimationState.update()` を呼ぶ
6. あとの時間進行は `WebgApp` の `space.update(deltaMs)` に任せる

```js
app.start({
  onUpdate: ({ deltaSec }) => {
    const move = app.wasActionPressed("move_up")
      ? resolveCameraRelativeGridMove(app.camera.yaw, "arrowup")
      : null;

    if (move && (!moveTween || moveTween.isFinished())) {
      const nextCell = tileMap.getTile(playerCell.col + move.dx, playerCell.row + move.dy);
      startMoveTo(nextCell);
    }

    locomotion.update({
      moving: !!moveTween && !moveTween.isFinished(),
      nowMs: app.space.now(),
      deltaSec
    });
  }
});
```

ここで `AnimationState.update()` を `onComplete()` の中だけで呼ぶのは不十分です。ステートマシンは「移動を開始したフレーム」「移動中の各フレーム」「停止したフレーム」の全部で状態を見たいので、毎フレーム呼び続ける必要があります。`startMoveTo()` は開始地点、`AnimationState.update()` は継続進行地点、と役割を分けると理解しやすくなります。 

## まとめ

この章で最も大事なのは、`tile_sim` を「TileMap 上へ glb を載せたサンプル」とだけ見ないことです。実際には、TileMap の論理位置、proxy node、visible actor、animation runtime、camera gesture、Touch ボタンを別経路として保ちながら、それらを 1 つのフレームループへ統合している事例です。つまり、TileMap と skinned actor を両立させるときの役割分担そのものが、この章の主題です。 

とくに重要なのは、次の 4 点です。TileMap の論理位置と glb の見た目を別 node として持つこと。`instantiate()` を使って共有 GPU resource と個別 runtime state を分けること。skinned mesh には `BonePhong` 系が必要であること。サイズは `bboxHeight`、`importedRootScale`、`runtimeNodeScale` を分けて逆算することです。この 4 点を押さえると、`tile_sim` の構造がかなり読みやすくなり、別アセットへ差し替えるときにも判断しやすくなります。続く第25章以降の low-level 章を読むと、ここで使っている見た目側の構造もさらに理解しやすくなります。 
