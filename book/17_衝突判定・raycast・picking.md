# 17 衝突判定・raycast・picking

最終更新：2026-04-08 JST

入力を受け取れるようになると、次に必要になるのは「何を指したのか」「何と重なったのか」を 3D 空間の中で判定する方法です。webg では、この役割を `Space.raycast()`、`Space.checkCollisions()`、`Space.checkCollisionsDetailed()`、`TileMap.pickCell()` が分担しています。いずれも scene graph の上で使える API ですが、用途は少しずつ異なります。

この章では、背景としてまず raycast と collision が何を解決するかを整理し、そのうえで `Space` と `TileMap` の API を current 実装に沿って見ます。画面座標から 3D の ray を作る流れ、AABB ベースの広域判定、TileMap 上の cell 選択まで、利用者コードで必要になる手順をつないで確認します。

## この章で押さえること

### A. `raycast()` は「視点から見てどこへ当たるか」を調べる API

クリックやタップの位置から ray を飛ばし、最初に当たった shape を取り出したいときは `Space.raycast()` を使います。戻り値には `t`、`point`、`node`、`shape` が入り、現在の実装では AABB ベースのヒットであることを示す `boundsOnly: true` も付きます。

### B. `checkCollisions()` は shape 同士の広域判定

scene 内の object 同士が重なったかをまとめて見たいときは `checkCollisions()` を使います。こちらもまずは軸平行境界ボックスによる広域判定です。ゲームの当たり判定を最初に組む段階や、どの pair が候補に入っているかを洗い出したい段階で役立ちます。

### C. `checkCollisionsDetailed()` は絞り込み用の詳細版

細長い形や斜め配置では、AABB だけだと「箱は重なっているが、形としては当たっていない」候補が残ることがあります。`checkCollisionsDetailed()` は、その候補へ三角形同士の交差判定を追加して絞り込む API です。まず広域判定で候補を減らし、必要なときだけ詳細判定へ進む使い方が自然です。

### D. `TileMap.pickCell()` は TileMap 用の picking API

TileMap を使う場面では、scene 全体の raycast ではなく、「現在の表示範囲のどの cell に当たったか」を知りたいことが多くなります。そのための専用 API が `TileMap.pickCell(origin, dir)` です。戻り値には `cell`、`hitFace`、`hitHeight` が入り、上面を押したのか壁面を押したのかも判別できます。

### E. `filter` を最初に書くと判定結果が読みやすい

camera 自身、非表示 shape、床だけの補助 object などを含めたまま判定すると、結果が読みにくくなります。`raycast()` と collision 系はどちらも `filter` を受け取るので、最初に「何を対象にするか」を明示しておくと整理しやすくなります。

## この章の流れ

最初に `Space.raycast()` で「画面の一点から 3D 空間へ ray を作る」流れを見ます。次に、scene 全体の object 同士を調べる `checkCollisions()` と `checkCollisionsDetailed()` の使い分けを整理します。そのあとで TileMap 専用の `pickCell()` を見て、最後に raycast と collision を使うときの注意点をまとめます。

## 1. 背景

3D アプリでは、見た目だけでなく「選択」「接触」「移動可否」を空間上で判断する必要があります。クリックした object を選びたいなら raycast、動いている object が他の object と重なったかを知りたいなら collision、TileMap 上のどの cell を指したかを知りたいなら picking が必要になります。

この 3 つは似て見えますが、起点が異なります。raycast は「1 本の ray から見て何に当たるか」、collision は「scene 内の object 同士が重なっているか」、TileMap picking は「TileMap の cell のどこに触れたか」です。API を分けて考えると、判定の責務が見えやすくなります。

## 2. クリック位置から `Space.raycast()` へつなぐ

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

このコードで大事なのは、`raycast()` の前に `app.eye.setWorldMatrix()` と `view.makeView(app.eye.worldMatrix)` を行っていることです。ray を作る基準になる視点行列が古いままだと、画面上のクリック位置と 3D 空間の向きがずれます。

`raycast()` は内部で direction を正規化し、各 shape のローカル bounding box をワールド AABB へ変換して判定します。そのため、戻り値の `point` は ray 上のワールド座標で、`boundsOnly: true` は「メッシュ表面そのものではなく境界ボックスベースのヒット」であることを示します。クリック選択や大まかな hit test には十分ですが、細長い形状での厳密な表面判定とは意味が異なります。

## 3. `checkCollisions()` と `checkCollisionsDetailed()`

scene 内の object 同士を一括で調べたいときは、raycast ではなく collision 系を使います。`samples/collisions` は mover と複数 shape を動かしながら、この差を見やすくしています。

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

この API は、各 shape のワールド AABB を作り、それらの重なりを列挙します。`firstHit: true` にすれば 1 件だけ返せますが、挙動確認やデバッグでは全件配列のほうが流れを追いやすくなります。

ただし、AABB は広域判定なので、斜めに置いた細長い形では候補が多めに出ます。そこで必要になるのが `checkCollisionsDetailed()` です。

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

`checkCollisionsDetailed()` は、広域判定を通過した pair に対して、三角形同士の交差判定を追加します。ただし、三角形数が多すぎると計算量が急増するため、`maxTrianglePairs` を超えた pair では詳細判定をスキップし、`boundsOnly: true` と `detailedSkipped: true` を付けて返します。常に詳細版だけを呼ぶのではなく、まず `checkCollisions()` で候補の量を見てから必要な場面に絞るほうが扱いやすくなります。

## 4. `TileMap.pickCell()` で cell を選ぶ

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

`pickCell()` は、現在の display area に含まれる cell ごとに AABB を持ち、その box へ ray が入るかを調べます。戻り値の `hitFace` には `top`、`bottom`、`wall-x+`、`wall-x-`、`wall-y+`、`wall-y-` が入り、上面を押したのか側面を押したのかを区別できます。TileMap 上で移動先を決めるときは上面だけを採用し、壁面ヒットは補助情報として扱う、といった使い分けがしやすくなります。

`pickCell()` が scene 全体ではなく display area を基準にする点も大切です。広い map 全体を総当たりするのではなく、現在表示している cell 群に対象を絞るため、TileMap の運用に自然な API になっています。

## 5. どの API を選ぶべきか

マウスやタップで object を選択したいなら `Space.raycast()` が入口です。クリック位置から 3D ray を作り、1 件目の hit を読むだけで scene の選択 UI を組めます。

scene 内の object 同士が重なったかを知りたいなら `checkCollisions()` を使います。ゲームロジックの最初の当たり判定や、どの pair が候補に入っているかを確認するときに向いています。

境界ボックスだけでは候補が多すぎる場合に、`checkCollisionsDetailed()` で三角形判定へ進みます。ただしこれは絞り込み用であり、常に最初から使う前提ではありません。

TileMap 上の選択なら `TileMap.pickCell()` が最も素直です。cell、面、当たった高さまで返るため、TileMap 独自の移動ルールや inspect UI へつなぎやすくなります。

## 6. 注意点

まず、`raycast()` と collision 系はどちらも現在のワールド行列を前提にします。移動や回転を更新した直後に判定するなら、その frame の更新順を崩さないことが大切です。camera 側でも `app.eye.setWorldMatrix()` を忘れると、クリック位置から作る ray が古い姿勢を向いてしまいます。

次に、current 実装の `raycast()` と `checkCollisions()` は AABB ベースだという点を意識しておく必要があります。戻り値の `boundsOnly` は、この判定が「メッシュ表面の厳密ヒット」ではなく「境界ボックスのヒット」であることを示します。細い棒、斜めの円柱、中空形状の近くでは、見た目と少しずれる候補が出ることがあります。

`filter` を書かずに使い始めると、camera 自身、補助 shape、非表示 object まで候補へ入り、意図した判定が見えにくくなります。最初から `node !== app.eye`、`!shape.isHidden`、`ground を除外する` といった条件を入れておくと、sample を実アプリへ育てやすくなります。

TileMap では、`pickCell()` が「現在見えている cell」を対象にしていることも忘れないほうが安全です。map 全体の cell から探索経路を作る処理とは責務が異なるため、選択 UI と path finding を同じ API で賄おうとしないほうが整理しやすくなります。

## 7. 関連 sample

raycast の最小例は `unittest/raycast`、collision の比較は `samples/collisions`、TileMap 上の選択は `samples/tile_sim` と `unittest/tilemap` が分かりやすくなります。入力とのつながりは前章の [16_タッチ機能と入力.md](./16_タッチ機能と入力.md) を合わせて読むと、tap と drag を同じ canvas で共存させる流れを追いやすくなります。
