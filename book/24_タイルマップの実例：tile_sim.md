# タイルマップの実例：tile_sim

TileMap の機能を単独で理解しただけでは、実際のアプリケーションにおいてアクター、アニメーション、カメラ、および入力系とどのように共存させるべきかという全体像は見えてきません。`tile_sim` は、これらの複数の要素を同時に成立させている統合的な事例です。本章では、TileMap の論理位置、可視アクター、アニメーションランタイム、そしてカメラジェスチャーをどのように分離し、それぞれの役割をどこに配置しているかを整理します。

ここで最も重要な設計指針は、`tile_sim` の中心にある「TileMap の論理位置」と「glb モデルの見た目」を別々のノードとして管理している点です。TileMap 側は「どのセルに存在するか」という論理的な位置を決定し、可視アクター側は「それをどう見せるか」という表現を担当します。

また、`human.glb` を一度だけビルドし、各ユニットが `instantiate()` によって独立したアニメーションランタイムを持つ構成にすることで、GPU リソースとランタイム状態を自然に分離しています。さらに、`tile_sim` では TileMap アクターの移動用アクションボタンと、キャンバス上の orbit / pan / pinch ジェスチャーを分けて実装しています。つまり、「盤面ロジック」「可視アクター」「入力経路」の 3 つを明確に分離していることが、このサンプルの設計上の最大の特徴です。

## `tile_sim` の構造と読み解き方

<!-- 図候補: tile_sim 構成図 -->

![tile_sim 構成図](fig24_01_tilesim_structure.jpg)

*tile_sim は単一ファイルで完結したサンプルではなく、TileMap、アクター、カメラ、ミッションを役割ごとに分割した実践的な構成例として読み解くことで、設計意図が整理しやすくなります。*

`tile_sim` を解析する際にまず留意すべき点は、「1 つのプレイヤーオブジェクトをそのまま TileMap 上に配置しているわけではない」ということです。実際には、盤面上の論理位置、見た目のアクター、入力処理、そしてカメラの追従が、それぞれ独立したレイヤーとして保持されています。この構造を見落とすと、移動、回転、アニメーション、カメラ追従の各役割がどこに割り当てられているのかが判然としなくなります。

本章では、まず glb アクターを TileMap 上で動作させる基本的な仕組みを解説し、次にクリップ構成の違いや `human.glb` の実測値に基づいたサイズ決定、ワールド規格への適合方法について詳述します。最後に、汎用化の候補となるパターンと、フレームループの組み立て方について整理します。つまり、「動作の仕組みを理解し」、次に「特定のアセットがなぜその仕組みで最適に動作したかを分析し」、最後に「共通化できる設計パターンを抽出する」という順序で進めていきます。

## TileMap 上の glb アクターの構成

TileMap 上の自キャラクターを単純な球体ではなく glb モデルに置き換える場合も、基本的な考え方は同じです。異なるのは、`playerNode` が単純なプリミティブノードではなく、「スキンとボーンを持つ glb ランタイムのルートノード」になる点と、位置の tween に加えてアニメーションコントローラーを同時に進行させる必要がある点です。

ここで重要なのは、「TileMap 上の論理位置」と「glb の見た目の移動」を 1 つのノードに混在させないことです。この役割分担を明確にすることで、TileMap は「どこへ移動可能か」という論理的な判定を返し、可視アクターは「それをどう表現するか」という描画のみを受け持つことができ、盤面ロジックと視覚表現を別レイヤーとして保持できます。

### 複数のクリップを持つ glb モデルの扱い

一般的なキャラクター glb では、`Idle`、`Walk`、`Run`、`Attack` のようにアニメーションクリップが分かれていることが一般的です。この場合、`AnimationState` のコントローラーに `model.runtime` をそのまま渡すことで、`state.clip` ベースで制御が可能になります。アセット側ですでにクリップが分割されている場合は、アプリ側でさらに分割せず、そのままステートマシンの対象とするのが最も効率的です。

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

この例で使用している `Idle` と `Walk` は説明用のクリップ名です。実際のアセットでは名称が異なるため、事前に `heroModel.runtime.getAnimationNames()` を呼び出し、含まれているクリップ名を確認してからステート定義を行う必要があります。ここでも、TileMap は論理的な位置と移動可否を判定し、glb ランタイム側がアニメーションを進行させるという役割分担がなされています。

実装上の重要ポイントは次の 3 点です。
1. `heroRoot.animatePosition()` を用いて、glb モデル全体をセルからセルへ移動させること。
2. `AnimationState.update()` を毎フレーム呼び出し続けること。
3. `moving` の真偽値を、入力イベントではなく tween の進行状態から決定すること。

入力を検知した瞬間だけ `walk` 状態にするのではなく、「実際に移動 tween が進行しているか」で状態を決定することで、停止直後のポーズが不自然に切り替わる現象を防ぐことができます。

### 1 つのクリップから区間を切り出す glb モデルの扱い

`webg/samples/gltf_loader/hand.glb` のように、1 つのクリップの中に複数のポーズが連続して並んでいるアセットの場合、`model.runtime` を直接クリップコントローラーに利用するよりも、`Action` を用いてキー範囲をアクション化し、その上に `AnimationState` を重ねる構成が適切です。`webg/samples/animation_state` や `webg/samples/janken` ではこの構成を採用しています。つまり、クリップが 1 本しかなく、その内部に複数の状態が詰め込まれている場合に限り、アプリ側でアクションとして切り分ける判断を行います。

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

この例における `fromKey` と `toKey` の値はアセット固有のものです。`hand.glb` では `webg/samples/animation_state` の設定に合わせていますが、別のアセットではキーの範囲や意味が異なるため、これらの数値をそのまま流用してはいけません。この方式は、複数クリップではなく、単一クリップから特定の区間を切り出す必要があるアセットにのみ適用してください。

## `human.glb` における統合実装の詳細

`webg/samples/tile_sim/human.glb` は、複数のクリップを持つキャラクターアセットではなく、1 本のクリップの中に少数のキーが並んでいる glb モデルです。`tile_sim` では、これを TileMap 上の自キャラクターとして動作させながら、以下の 4 点を同時に成立させています。
- TileMap 上のセル間移動
- Idle ポーズの継続的なアニメーション
- 移動開始時の進行方向への回転
- スキンドメッシュとボーンアニメーションの正しい描画

### プロキシノードと可視アクターの分離

ここで鍵となるのが、「TileMap 上の論理位置を持つノード（プロキシノード）」と「glb モデルの見た目そのもの（可視アクター）」を分離して管理する手法です。`tile_sim` では、以前のサンプルで使用していた ball を完全に排除せず、代理（プロキシ）として残しています。

TileMap のコントローラーは従来通りプロキシとなる ball を `animatePosition()` で動作させ、可視アクターである `human.glb` 側が毎フレームそのワールド位置へ追従します。この構成により、TileMap 側の移動ルールや `displayArea` の追従ロジックを維持したまま、見た目だけを glb モデルへ差し替えることが可能になります。

現在の `tile_sim` における役割分担は以下の通りです。
- `ballNode`: TileMap の論理位置、ホップを含む位置 tween、およびカメラ相対入力の受け口。
- `placementNode`: 可視アクター全体をワールド上のどこに配置するかを制御するノード。
- `offsetNode`: 足元の位置補正、バウンディングボックスの中心補正、モデルの前方向補正を制御するノード。
- `shape.anim`: glb からバインドされたランタイムアニメーションを毎フレーム進行させる入口。

この構造により、TileMap は「どのセルにいて、次にどこへ進むか」という論理判定に専念でき、glb 側は「それをどう見せるか」という表現に集中できます。

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

注目すべきは、TileMap コントローラーに glb の内部構造を持ち込んでいない点です。コントローラーは `fromCell` と `toCell` という情報のみを外部に渡し、glb の回転やアニメーション再生の詳細は `alphaActor` 内部にカプセル化されています。これにより、将来的に別の glb モデルへ差し替える際も、コントローラー本体を修正することなく対応可能です。

### スキンドメッシュとシェーダーの選定

`human.glb` を統合する際、特に留意すべき点がシェーダーの選定です。スキンドメッシュを正しく描画するには、`SmoothShader` のスキニング経路を有効にする必要があります。TileMap 本体の地形側で使っている通常のマテリアル設定はボーンパレットを前提にしていないため、スキンド glb をそのまま流用するとレストポーズのまま静止してしまいます。

本実装では、アクター用のランタイムシェイプにのみ、`has_bone` を有効にした `SmoothShader` を個別に割り当てています。つまり、TileMap 全体の標準マテリアル設定と、アクター個別のスキニング設定を分けて管理することが不可欠です。

```js
const boneShader = new SmoothShader(app.getGL());
await boneShader.init();
boneShader.setHasBone(true);
for (const shape of runtime.shapes) {
  shape.setShader(boneShader);
}
```

アニメーションが動作しない場合、クリップ名やステートマシンの設定を疑う前に、まずスキンドメッシュがボーン対応シェーダーで描画されているかを確認することを推奨します。

### アニメーションの進行管理

次に、アニメーションをどこから制御するかという点についてです。`human.glb` は 1 本のクリップ内に 3 つのキー状態を持ち、`key0 -> key1 -> key2` という流れで、かつ `key2` が `key0` と同じポーズになる構成です。

この形式では、まず「クリップがバインド済みのシェイプに正しく接続されているか」を優先的に確認することが重要です。`tile_sim` では、ランタイム全体のクリップ名を追跡するのではなく、`runtime.shapes` の中から `shape.anim` を持つシェイプを特定し、その `Animation` オブジェクトを直接 `start()` または `play()` させています。これにより、「アニメーション名は存在するが、表示されているメッシュとのバインドがずれている」という不整合を回避できます。

## TileMap 上の表示サイズの決定手法

アニメーションモデルを扱う場合、「ジオメトリ自体の大きさ」「glTF ルートのローカルスケール」「TileMap 上での最終的な表示サイズ」を分けて考えなければ、見た目のサイズが不自然になりやすくなります。そのため `tile_sim` では、アセットデータに保持されるスケールと、ランタイムノードで最終的に適用するスケールを役割分担させています。

表示倍率の決定にあたっては、経験的な数値で「0.7 倍にする」と決めるのではなく、「TileMap ワールドにおいてどの高さに見せたいか」という目標値を先に定義し、その後でインポートデータに合わせて調整する手順を採ります。

### `bboxHeight` と `importedRootScale` の関係

glTF 側のルートローカルスケールを破棄せず、復元した状態で最終的な表示サイズを論理的に揃えることが重要です。TileMap 上のキャラクターサイズは、以下の 3 要素に分解して考えます。
1. インポート済みメッシュ自体のバウンディングボックス（bounding box）の高さ (`bboxHeight`)
2. glTF ルートローカル変換が持つスケール (`importedRootScale`)
3. TileMap ワールドに対して最終的に適用するノードスケール (`runtimeNodeScale`)

これらを数式で表すと、最終的な表示高さは次のようになります。

```text
finalHeight = bboxHeight * importedRootScale * runtimeNodeScale
```

### `runtimeNodeScale` の逆算

モデルを TileMap 上で特定の高さ `targetHeight` に設定したい場合、適用すべき `runtimeNodeScale` は次のように逆算できます。

```text
runtimeNodeScale = targetHeight / (bboxHeight * importedRootScale)
```

`tile_sim` では、絶対的な高さではなく `bboxHeight` に対する比率である `desiredDisplayScale` を定義し、次のように扱っています。

```text
targetHeight = bboxHeight * desiredDisplayScale
runtimeNodeScale = desiredDisplayScale / importedRootScale
```

これにより、glTF のルートスケールを維持したまま、TileMap 上で意図した最終サイズを実現できます。

例えば、`webg/samples/tile_sim/human.glb` の実測値では、ルートノードが `sx = sy = sz = 1.4680135250091553` というスケールを持っています。ここで `desiredDisplayScale = 0.70` と設定した場合、`runtimeNodeScale` は `0.47683484387218733` となります。重要なのは、この逆算値を直接指定するのではなく、設計値である `desiredDisplayScale` を先に決め、インポートデータから得られた `importedRootScale` を用いて自動的に算出している点です。

### TileMap ワールド規格への適合

`tile_sim` の `alpha_actor.js` では、バウンディングボックスの計測、ルートスケールの解決、最終スケールの逆算をそれぞれ別の関数に分離して実装しています。これにより、サイズ決定のプロセスを明確な手順として管理しています。

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

これらの関数を用いて、可視アクターを TileMap 上に配置する処理は以下のようになります。

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

この実装の意図は、`bounds.centerX / centerZ` および `bounds.minY` を用いて TileMap 上での中心寄せと足元補正を行い、それらの補正量を最終表示倍率 `desiredDisplayScale` に基づいて計算することにあります。同時に、glTF のルートローカルスケールは `setByMatrix(rootInfo.localMatrix)` で復元し、`offsetNode.setScale(runtimeNodeScale)` によって最終的なサイズ調整を行います。この手法により、足元位置やセル中央への寄せ方が最終的な表示サイズに対して整合し、かつ glTF の変換情報を損なうことがありません。

最後に、「TileMap ワールドにおいて何を基準の高さとするか」という設計上の規格を定義する必要があります。`tile_sim` のように論理移動の土台として `BALL_RADIUS` を持つ場合は、`targetHeight = BALL_RADIUS * K` のようにユニット規格値を設けることで、別のアセットに差し替えた際も同一の手順でサイズを統一できます。

## 実装から得られた共通パターンの抽出

`tile_sim` の実装を通じて、今後他のサンプルやプロジェクトでも再利用すべき共通パターンが見えてきました。これらは直ちにコアライブラリに組み込むべき必須機能ではありませんが、共通化することで開発効率を高められる候補です。

1. スキンド glb の安全なインスタンス化ヘルパー: TileMap 全体を通常の `SmoothShader` 設定で描画しつつ、特定のアクターのみ `has_bone` を有効にした `SmoothShader` を適用させたいケースは頻出します。このようなスキニング設定の切り替えを安全に行うヘルパーは有用です。
2. TileMap アクターアダプター: `ballNode` $\rightarrow$ `placementNode` $\rightarrow$ `offsetNode` $\rightarrow$ `shape.anim` という階層構造は理にかなっていますが、毎回手動で構築するには記述量が多くなります。これをカプセル化したアダプターの導入が考えられます。
3. 単一クリップの特定区間再生ヘルパー: `human.glb` のように、1 本のクリップ内から短い待機モーションなどを切り出してピンポン再生させる機能は、多くのアセットで必要になります。

これらの機能を段階的に共通化することで、まずは「導入時のつまずき」を減らし、次に「サンプル間の重複実装」を排除していくアプローチが現実的です。

## フレームループの組み立て

TileMap のセル移動と glb のアニメーションを同時に制御する場合、以下の順序でループを構成すると動作が安定します。ポイントは、「入力による新しい移動の開始」と「アニメーション状態の継続的な更新」を明確に分離することです。

1. 入力を読み取る
2. 次の移動先セルを決定する
3. 必要に応じて `animatePosition()` を開始する
4. 当フレームの `moving` や `attackRequested` などの状態フラグを確定させる
5. `AnimationState.update()` を呼び出す
6. その後の時間進行処理を `WebgApp` の `space.update(deltaMs)` に委ねる

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

ここで注意すべきは、`AnimationState.update()` を `onComplete()` コールバックの中だけで呼び出すのでは不十分である点です。ステートマシンは「移動を開始した瞬間」「移動中の各フレーム」「停止した瞬間」のすべての状態を監視する必要があるため、必ず毎フレーム呼び出す必要があります。`startMoveTo()` を「開始地点」、`AnimationState.update()` を「継続更新地点」として役割を分けることで、破綻のないアニメーション制御が可能になります。

## まとめ

本章で解説した `tile_sim` は、単に「TileMap 上に glb を載せたサンプル」ではなく、TileMap の論理位置、プロキシノード、可視アクター、アニメーションランタイム、カメラジェスチャー、およびタッチボタンという異なる経路の処理を、一つのフレームループへ統合した実践例です。TileMap とスキンドアクターを両立させる際の役割分担こそが、本章の核心です。

特に重要なポイントは以下の 4 点に集約されます。
- TileMap の論理位置と glb の見た目を別々のノードとして管理すること。
- `instantiate()` を活用し、共有 GPU リソースと個別のランタイム状態を分離すること。
- スキンドメッシュの描画には、`has_bone` を有効にした `SmoothShader` が必要であること。
- 表示サイズは `bboxHeight`、`importedRootScale`、`runtimeNodeScale` を用いて逆算して決定すること。

これらを押さえることで、`tile_sim` の構造を正しく理解でき、別のアセットを導入する際にも適切な判断が可能になります。続く第 25 章以降のローレベル（低レイヤー）な解説を読むことで、ここで使用した視覚的な構造の詳細についてさらに理解を深めることができます。
