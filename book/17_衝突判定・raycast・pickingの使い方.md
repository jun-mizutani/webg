# 衝突判定・raycast・pickingの使い方

入力を受け取れるようになると、次に必要になるのは、その入力が 3D 空間の何に当たったのか、あるいは scene 内の何が重なったのかを判断することです。クリックで object を選びたいのか、object 同士の接触を調べたいのか、TileMap 上のどの cell を押したかを知りたいのかによって、使う API は変わります。`webg` では、この役割を `Space.raycast()`、`Space.checkCollisions()`、`Space.checkCollisionsDetailed()`、`TileMap.pickCell()` が分担しています。 

ここで重要なのは、これらが似た「判定 API」ではあっても、起点が異なることです。`raycast()` は 1 本の ray から見て何に当たるかを調べる API であり、collision 系は scene 内の shape 同士が重なっているかを調べる API です。`TileMap.pickCell()` はさらに別で、一般 shape ではなく「現在見えている TileMap のどの cell に当たったか」を返します。つまり本章の中心は、API 名を覚えることよりも、「どんな判定をしたいときにどの API を選ぶべきか」を整理することにあります。 

また、現在の `webg` 実装では、`raycast()` と `checkCollisions()` はまず AABB ベースで動きます。細い棒や斜めの円柱のような形状では、見た目より少し大きめの候補が出ることがあります。そのため、collision 系には広域判定のあとに三角形レベルの絞り込みを行う `checkCollisionsDetailed()` が用意されています。加えて、どの API でも `filter` を先に書いておくと、camera 自身や補助 shape を候補から外せるため、結果がかなり読みやすくなります。 

## 空間判定をどう使い分けるか

3D アプリでは、見た目だけでなく「選択」「接触」「移動可否」を空間上で判断する必要があります。クリックした object を選びたいなら raycast、動いている object が他の object と重なったかを知りたいなら collision、TileMap 上のどの cell を指したかを知りたいなら picking が必要になります。ここを 1 つの API で無理に考えず、起点ごとに分けて捉えると整理しやすくなります。 

要するに、`raycast()` は「この位置を指したら何に当たるか」、collision 系は「scene に存在するもの同士が今重なっているか」、`TileMap.pickCell()` は「盤面のどの cell のどの面を押したか」を返す API です。この違いが見えると、あとで `TileMap` の path 探索や `displayArea` の考え方とも混ざりにくくなります。

## クリック位置から `Space.raycast()` へつなぐ

`Space.raycast()` は ray の origin と direction を受け取り、ヒットした shape を返します。つまり、マウスやタップの画面座標をそのまま渡す API ではありません。まず画面座標を NDC に変換し、投影行列とビュー行列からワールド空間の ray を作る段階が必要です。`unittest/raycast` は、この流れをそのまま読める教材になっています。 

```js
import Matrix from "./webg/Matrix.js";

const cssToNdc = (canvas, clientX, clientY) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
  const y = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;
  return [x, y];
};

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

  const hit = app.space.raycast(ray.origin, ray.dir, {
    firstHit: true,
    filter: ({ node, shape }) => node !== app.eye && !shape.isHidden
  });

  if (!hit) {
    return;
  }
  console.log(hit.node.name, hit.point, hit.t, hit.boundsOnly);
});
```

このコードで大事なのは、`raycast()` の前に `app.eye.setWorldMatrix()` と `view.makeView(app.eye.worldMatrix)` を行っていることです。ray を作る基準になる視点行列が古いままだと、画面上のクリック位置と 3D 空間の向きがずれます。また、`filter` を最初から書いているため、camera 自身や非表示 shape を候補へ入れずに済みます。 

`raycast()` は内部で direction を正規化し、各 shape のローカル bounding box をワールド AABB へ変換して判定します。そのため、戻り値の `point` は ray 上のワールド座標で、`boundsOnly: true` は「メッシュ表面そのものではなく境界ボックスベースのヒット」であることを示します。クリック選択や大まかな hit test には十分ですが、細長い形状での厳密な表面判定とは意味が異なります。つまり `raycast()` は、現在の `webg` では「精密な表面ヒット」ではなく「選択 UI の入口」と考えるほうが実装に合っています。 

## scene 内の重なりを調べる

scene 内の object 同士を一括で調べたいときは、raycast ではなく collision 系を使います。`samples/collisions` は mover と複数 shape を動かしながら、この違いを見やすくしています。ここでの考え方は、まず広域判定で候補を見つけ、そのあと必要なら詳細判定へ進む、という 2 段構えです。 

### `checkCollisions()`

まず使うのは `checkCollisions()` です。

```js
const collisions = app.space.checkCollisions({
  firstHit: false,
  filter: ({ node, shape }) => {
    if (!shape || shape.isHidden) return false;
    return node.name !== "ground";
  }
});

for (let i = 0; i < collisions.length; i++) {
  const pair = collisions[i];
  console.log(pair.nodeA.name, pair.nodeB.name, pair.boundsOnly);
}
```

この API は、各 shape のワールド AABB を作り、それらの重なりを列挙します。`firstHit: true` にすれば 1 件だけ返せますが、挙動確認やデバッグでは全件配列のほうが流れを追いやすくなります。また、ここでも `filter` を先に入れて ground や非表示 shape を除外しておくと、「何に当たっているのか分からない」状態になりにくくなります。 

### `checkCollisionsDetailed()`

AABB は広域判定なので、斜めに置いた細長い形では候補が多めに出ます。そこで必要になるのが `checkCollisionsDetailed()` です。

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

`checkCollisionsDetailed()` は、広域判定を通過した pair に対して、三角形同士の交差判定を追加します。ただし、三角形数が多すぎると計算量が急増するため、`maxTrianglePairs` を超えた pair では詳細判定をスキップし、`boundsOnly: true` と `detailedSkipped: true` を付けて返します。したがって、常に詳細版だけを呼ぶのではなく、まず `checkCollisions()` で候補の量を見てから必要な場面に絞るほうが扱いやすくなります。 

## `TileMap.pickCell()` で cell を選ぶ

TileMap を使う場面では、scene 内の一般 shape よりも「今見えているどの cell を押したか」が重要になることが多くなります。`TileMap.pickCell(origin, dir)` は、そのための専用 API です。`samples/tile_sim` では、camera gesture と tap selection を同じ canvas で扱いながら、この API で選択 cell を決めています。

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

`pickCell()` は、現在の `displayArea` に含まれる cell ごとに AABB を持ち、その box へ ray が入るかを調べます。戻り値の `hitFace` には `top`、`bottom`、`wall-x+`、`wall-x-`、`wall-y+`、`wall-y-` が入り、上面を押したのか側面を押したのかを区別できます。TileMap 上で移動先を決めるときは上面だけを採用し、壁面ヒットは補助情報として扱う、といった使い分けがしやすくなります。

ここでさらに大切なのは、`pickCell()` が scene 全体ではなく `displayArea` を基準にすることです。広い map 全体を総当たりするのではなく、現在表示している cell 群に対象を絞るため、TileMap の運用に自然な API になっています。これは第23章で扱った `followCell()` や `refreshTileColors()` の考え方ともきれいにつながります。

## どの API を選ぶべきか

マウスやタップで object を選択したいなら `Space.raycast()` が入口です。クリック位置から 3D ray を作り、1 件目の hit を読むだけで scene の選択 UI を組めます。scene 内の object 同士が重なったかを知りたいなら `checkCollisions()` を使います。ゲームロジックの最初の当たり判定や、どの pair が候補に入っているかを確認するときに向いています。境界ボックスだけでは候補が多すぎる場合に、`checkCollisionsDetailed()` で三角形判定へ進みます。ただしこれは絞り込み用であり、常に最初から使う前提ではありません。TileMap 上の選択なら `TileMap.pickCell()` が最も素直です。cell、面、当たった高さまで返るため、TileMap 独自の移動ルールや inspect UI へつなぎやすくなります。 

## 注意点

まず、`raycast()` と collision 系はどちらも現在のワールド行列を前提にします。移動や回転を更新した直後に判定するなら、その frame の更新順を崩さないことが大切です。camera 側でも `app.eye.setWorldMatrix()` を忘れると、クリック位置から作る ray が古い姿勢を向いてしまいます。 

次に、current 実装の `raycast()` と `checkCollisions()` は AABB ベースだという点を意識しておく必要があります。戻り値の `boundsOnly` は、この判定が「メッシュ表面の厳密ヒット」ではなく「境界ボックスのヒット」であることを示します。細い棒、斜めの円柱、中空形状の近くでは、見た目と少しずれる候補が出ることがあります。ここを最初に理解しておくと、「当たっているように見えるのに違う」「違うように見えるのに当たっている」といった混乱をかなり減らせます。 

また、`filter` を書かずに使い始めると、camera 自身、補助 shape、非表示 object まで候補へ入り、意図した判定が見えにくくなります。最初から `node !== app.eye`、`!shape.isHidden`、`ground を除外する` といった条件を入れておくと、sample を実アプリへ育てやすくなります。TileMap では、`pickCell()` が「現在見えている cell」を対象にしていることも忘れないほうが安全です。map 全体の cell から探索経路を作る処理とは役割が異なるため、選択 UI と path finding を同じ API で賄おうとしないほうが整理しやすくなります。

## 関連 sample

raycast の最小例は `unittest/raycast`、collision の比較は `samples/collisions`、TileMap 上の選択は `samples/tile_sim` と `unittest/tilemap` が分かりやすくなります。入力とのつながりは前章の [16_タッチ入力の設計.md](./16_タッチ入力の設計.md) を合わせて読むと、tap と drag を同じ canvas で共存させる流れを追いやすくなります。TileMap ランタイムとの接続は、第23章の `pickCell()`、`followCell()`、`refreshTileColors()` の節と合わせて読むと、選択 UI が盤面運用へどうつながるかがさらに見えやすくなります。
