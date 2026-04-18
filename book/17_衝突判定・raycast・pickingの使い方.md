# 衝突判定・raycast・pickingの使い方

ユーザーからの入力を受け取れるようになると、次に必要になるのは「その入力が3D空間の何に当たったのか」、あるいは「シーン内の何と何が重なったのか」を判断することです。

クリックしてオブジェクトを選択したいのか、オブジェクト同士の接触を調べたいのか、あるいはTileMap上のどのセルを押したのかによって、使用するAPIは異なります。`webg` では、これらの役割を `Space.raycast()`、`Space.checkCollisions()`、`Space.checkCollisionsDetailed()`、および `TileMap.pickCell()` が分担して担っています。

ここで重要なのは、これらがすべて「判定」に関するAPIであっても、判定の起点が異なるという点です。`raycast()` は1本のレイ（光線）を飛ばして何に当たるかを調べるAPIであり、`checkCollisions` 関連のAPIはシーン内のシェイプ同士が重なっているかを調べるものです。また `TileMap.pickCell()` はさらに特殊で、一般的なシェイプではなく「現在見えているTileMapのどのセルに当たったか」を返します。

本章では、単にAPI名を覚えることではなく、「どのような判定を行いたいときに、どのAPIを選択すべきか」という基準を整理して解説します。

なお、現在の `webg` の実装では、`raycast()` と `checkCollisions()` はまずAABB（軸並行境界ボックス）ベースで動作します。そのため、非常に細い棒や斜めの円柱のような形状の場合、見た目よりも少し大きめの範囲でヒット判定が出る場合があります。より厳密な判定が必要な場合には、広域判定の後に三角形レベルでの絞り込みを行う `checkCollisionsDetailed()` を使用します。

また、どのAPIを使用する場合でも、`filter` を適切に設定することで、カメラ自身や補助用のシェイプを判定候補から除外でき、結果をより正確に得ることができます。

## クリック位置から `Space.raycast()` へつなぐ

`Space.raycast()` は、レイの起点（origin）と方向（direction）を受け取り、ヒットしたシェイプを返します。このAPIはマウスやタップの画面座標を直接受け取るものではありません。そのため、まずは画面座標を正規化デバイス座標（NDC）に変換し、投影行列とビュー行列を用いてワールド空間のレイを生成する工程が必要です。`unittest/raycast` にはこの一連の流れが実装されており、実装例として非常に参考になります。

```js
import Matrix from "./webg/Matrix.js";

// 画面上の座標(CSSピクセル)を正規化デバイス座標(NDC)に変換する
const cssToNdc = (canvas, clientX, clientY) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
  const y = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;
  return [x, y];
};

// マウス位置から3D空間へのレイを生成する
const makeRayFromMouse = (canvas, clientX, clientY, eyeNode, proj, view) => {
  const [nx, ny] = cssToNdc(canvas, clientX, clientY);
  const invVp = proj.clone();
  invVp.mul(view);
  invVp.inverse_strict();

  const far = invVp.mulVector([nx, ny, 1.0]);
  const eyePos = eyeNode.getWorldPosition();
  const dir = [
    far[0] - eyePos[0],
    far[1] - eyePos[1],
    far[2] - eyePos[2]
  ];
  return { origin: eyePos, dir };
};

canvas.addEventListener("click", (ev) => {
  // カメラのワールド行列を最新の状態に更新する
  app.eye.setWorldMatrix();
  const view = new Matrix();
  view.makeView(app.eye.worldMatrix);

  const ray = makeRayFromMouse(
    app.screen.canvas,
    ev.clientX,
    ev.clientY,
    app.eye,
    app.projectionMatrix,
    view
  );

  // レイキャストを実行し、最初に当たったオブジェクトを取得する
  const hit = app.space.raycast(ray.origin, ray.dir, {
    firstHit: true,
    // カメラ自身や非表示のシェイプを判定から除外するフィルタ
    filter: ({ node, shape }) => node !== app.eye && !shape.isHidden
  });

  if (!hit) {
    return;
  }
  console.log(hit.node.name, hit.point, hit.t, hit.boundsOnly);
});
```

この実装で重要なポイントは、`raycast()` を呼び出す前に `app.eye.setWorldMatrix()` と `view.makeView(app.eye.worldMatrix)` を実行している点です。レイを生成する基準となる視点行列が古いままでは、画面上のクリック位置と3D空間での方向がずれてしまいます。また、`filter` を活用することで、不要なオブジェクトを候補から排除し、効率的な判定が可能になります。

`raycast()` は内部的に方向ベクトルを正規化し、各シェイプのローカル境界ボックスをワールドAABBへ変換して判定を行います。戻り値の `point` はレイ上のワールド座標であり、`boundsOnly: true` は「メッシュ表面そのものではなく、境界ボックスベースでのヒットであること」を示しています。クリックによるオブジェクト選択や大まかなヒットテストには十分な精度ですが、厳密な表面判定とは異なります。現在の `webg` における `raycast()` は、「精密な表面判定」というよりも「選択UIのための入り口」として活用するのが適切です。

## シーン内の重なりを調べる

シーン内のオブジェクト同士が一括して重なっているかを調べたい場合は、レイキャストではなく衝突判定（Collision）関連のAPIを使用します。`samples/collisions` では、移動するオブジェクトと複数のシェイプを組み合わせ、この判定の違いを確認できるようになっています。

衝突判定の基本的な考え方は、「まず広域判定で候補を絞り込み、必要に応じて詳細判定へ進む」という2段構えの構成です。

### `checkCollisions()` による広域判定

まず使用するのは `checkCollisions()` です。

```js
const collisions = app.space.checkCollisions({
  firstHit: false,
  filter: ({ node, shape }) => {
    if (!shape || shape.isHidden) return false;
    // 地面(ground)は判定対象から除外する
    return node.name !== "ground";
  }
});

for (let i = 0; i < collisions.length; i++) {
  const pair = collisions[i];
  console.log(pair.nodeA.name, pair.nodeB.name, pair.boundsOnly);
}
```

このAPIは、各シェイプのワールドAABBを生成し、それらが重なっているペアを列挙します。`firstHit: true` に設定すれば最初に見つかった1件のみを返しますが、挙動の確認やデバッグにおいては、全件を配列で取得したほうが全体の流れを把握しやすくなります。ここでも `filter` を用いて地面や非表示シェイプを除外しておくことで、「意図しないオブジェクトに当たっている」という混乱を防ぐことができます。

### `checkCollisionsDetailed()` による詳細判定

AABBによる判定は広域的なものであるため、斜めに配置された細長い形状などでは、見た目以上に多くの候補が検出されることがあります。より精緻な判定が必要な場合に `checkCollisionsDetailed()` を使用します。

```js
const detailed = app.space.checkCollisionsDetailed({
  firstHit: false,
  maxTrianglePairs: 80000,
  filter: ({ node, shape }) => {
    if (!shape || shape.isHidden) return false;
    return node.name !== "ground";
  }
});

for (let i = 0; i < detailed.length; i++) {
  const pair = detailed[i];
  console.log(
    pair.nodeA.name,
    pair.nodeB.name,
    pair.boundsOnly,
    pair.detailedSkipped === true
  );
}
```

`checkCollisionsDetailed()` は、広域判定を通過したペアに対して、三角形同士の交差判定を追加で行います。ただし、三角形の数が極端に多い場合に計算量が急増するため、`maxTrianglePairs` を超えたペアについては詳細判定をスキップし、`boundsOnly: true` および `detailedSkipped: true` というフラグを付けて返します。

したがって、常に詳細判定版を呼び出すのではなく、まずは `checkCollisions()` で候補の量を確認し、必要な場面に限定して詳細判定を行う運用が効率的です。

## `TileMap.pickCell()` でセルを選択する

TileMapを使用する場合、シーン内の一般的なシェイプよりも「現在見えているどのセルを押したか」という情報が重要になります。そのための専用APIが `TileMap.pickCell(origin, dir)` です。`samples/tile_sim` では、カメラのジェスチャー操作とタップによる選択を同じキャンバスで扱いながら、このAPIを用いて選択セルを決定しています。

```js
const pickCellAt = (clientX, clientY) => {
  app.eye.setWorldMatrix();
  const view = new Matrix();
  view.makeView(app.eye.worldMatrix);

  const ray = makeRayFromMouse(
    app.screen.canvas,
    clientX,
    clientY,
    app.eye,
    app.projectionMatrix,
    view
  );
  const hit = tileMap.pickCell(ray.origin, ray.dir);
  if (!hit) {
    return;
  }

  console.log(
    hit.cell.col,
    hit.cell.row,
    hit.hitFace,
    hit.hitHeight
  );
};
```

`pickCell()` は、現在の `displayArea`（表示領域）に含まれるセルごとにAABBを持ち、そのボックスにレイが進入したかを判定します。戻り値の `hitFace` には `top`、`bottom`、`wall-x+`、`wall-x-`、`wall-y+`、`wall-y-` のいずれかが格納され、セルの上面を押したのか、あるいは側面を押したのかを区別できます。これにより、「移動先を決めるときは上面ヒットのみを採用し、壁面ヒットは補助情報として扱う」といった使い分けが容易になります。

ここで特筆すべき点は、`pickCell()` がシーン全体ではなく `displayArea` を基準に動作することです。広大なマップ全体を総当たりで調べるのではなく、現在表示されているセル群に対象を絞るため、TileMapの運用に最適化された設計になっています。これは第23章で解説する `followCell()` や `refreshTileColors()` の考え方とも密接に関連しています。

## 判定APIの使い分けまとめ

どのAPIを選択すべきかは、目的とする操作によって決まります。

- マウスやタップでオブジェクトを選択したい場合 $\rightarrow$ `Space.raycast()`
  クリック位置から3Dレイを生成し、最初にヒットした要素を取得することで、シンプルな選択UIを実装できます。
- シーン内のオブジェクト同士の重なりを判定したい場合 $\rightarrow$ `checkCollisions()`
  ゲームロジックにおける基本的な当たり判定や、衝突候補の抽出に適しています。
- 境界ボックス（AABB）では判定が粗すぎる場合 $\rightarrow$ `checkCollisionsDetailed()`
  `checkCollisions()` で絞り込んだ後、さらに三角形レベルでの厳密な判定を行いたい場合に使用します。
- TileMap上のセルを選択したい場合 $\rightarrow$ `TileMap.pickCell()`
  セル位置、ヒットした面、高さまで取得できるため、TileMap独自の移動ルールや詳細情報の表示（インスペクトUI）に繋げやすくなります。

## 注意点

まず、`raycast()` および衝突判定系APIは、すべて最新のワールド行列を前提として動作します。オブジェクトの移動や回転を更新した直後に判定を行う場合は、フレーム内の更新順序を正しく管理してください。特にカメラ側で `app.eye.setWorldMatrix()` を忘れると、生成されるレイが古い姿勢を向いてしまい、判定位置がずれる原因となります。

次に、現在の `raycast()` と `checkCollisions()` がAABBベースであるという点を意識してください。戻り値の `boundsOnly` フラグは、その判定が「メッシュ表面の厳密なヒット」ではなく「境界ボックスのヒット」であることを示しています。細い棒状のオブジェクトや、斜めに配置された円柱、あるいは中空の形状の付近では、見た目と判定位置にわずかな乖離が生じることがあります。この特性を理解しておくことで、「当たっているように見えるのに反応しない」あるいはその逆といった混乱を避けることができます。

また、`filter` を設定せずに使用すると、カメラ自身や補助用シェイプ、非表示オブジェクトまで判定候補に含まれてしまい、意図した結果が得られにくくなります。開発の初期段階から `node !== app.eye` や `!shape.isHidden`、あるいは特定の地面オブジェクトを除外するといった条件を組み込んでおくことで、サンプルコードを実用的なアプリケーションへと発展させやすくなります。

最後に、TileMapの `pickCell()` は「現在見えているセル」を対象としている点に注意してください。マップ全体のセルから探索経路を導き出すパスファインディング（経路探索）などの処理とは役割が異なります。選択UIとパスファインディングを同じAPIで実現しようとせず、役割を分けて設計することを推奨します。

## 関連サンプル

本章の内容を具体的に確認するには、以下のサンプルおよびユニットテストが適しています。

- レイキャストの最小構成例: `unittest/raycast`
- 衝突判定の比較: `samples/collisions`
- TileMap上の選択実装: `samples/tile_sim` および `unittest/tilemap`

ユーザー入力との連携については、前章の [16_タッチ入力の設計.md](./16_タッチ入力の設計.md) を合わせて参照してください。タップとドラッグを同一キャンバスで共存させる実装の流れを把握できます。また、TileMapランタイムとの接続については、第23章の `pickCell()`、`followCell()`、`refreshTileColors()` の節と併せて読むことで、選択UIが実際の盤面運用にどのように結びつくかがより明確になります。