# tile_sim Rules

最終更新: 2026-04-02 JST

この文書は、`samples/tile_sim` の現状ルールを、実装済みの sample に合わせて整理したものです。以前は strategy / simulation 系 sample の案を広く集めた draft でしたが、現在は `tile_game` を土台にした実動 sample ができているため、まず「今は何が入っているか」を先に読みやすくそろえます。そのうえで、後半に今後の拡張案をまとめます。

`tile_sim` は、`tile_game` の beacon mission をそのまま消すのではなく、そこへ複数部隊、補給差、高地と低地の役割差、敵側の最小 AI、`DialogueOverlay`、2D tactical map を重ねていく sample です。つまり現段階では「本格的な戦略 game を完成させたもの」ではなく、「高さ付き TileMap を strategy / simulation へ広げるとき、どの要素が自然につながるか」を試す中間段階と考えるのが分かりやすいです。実装上は、`human.glb` や marker / proxy の primitive shape を shared resource として 1 回だけ組み立て、各 unit / marker は `instantiate()` や shape instance を使って runtime 状態だけを分ける構成にしています。

## 0. まず結論

現状の `tile_sim` は、player が `Alpha` だけを直接動かし、1 手ごとに `Bravo`、`Mule`、`Warden` が順に反応する、小さい turn-based sample です。勝利条件は beacon をすべて回収してから goal へ到達することで、この骨格自体は `tile_game` を引き継いでいます。あわせて shortest route hint と budget を持ちますが、budget は停止条件ではなく作戦比較用の目安として扱います。

ただし `tile_game` と違って、ここでは unit が複数になり、高地と低地で `food` と `arms` の増減が変わり、敵監視部隊も最小限の判断を行います。さらに主要情報は HUD ではなく `DialogueOverlay` の briefing / report / inspection に寄せてあり、盤面全体の俯瞰には小さい 2D tactical map を併用します。

## 1. 現在の sample が目指していること

この sample の主題は、「高い地形は強いが重く、低い地形は弱いが回しやすい」という差が、複数部隊を置いたときにどう意味を持つかを見ることです。高地が単純に有利なだけではなく、高地に居続けると維持が苦しくなり、低地に下りると補給は楽になるが戦闘面では不利になる、という逆向きの性格を重ねています。

同時に、`tile_sim` は `DialogueOverlay` の有用性確認も目的に含みます。そのため、mission の説明、操作説明、unit の役割説明、重要な turn report、接敵 warning、tile inspection、result debrief といった文章情報を `DialogueOverlay` だけで追える構成を試しています。ここは単なる装飾ではなく、strategy 系 sample に必要な説明量を UI でどう支えるかを見るための重要な部分です。

## 2. 現在の盤面と mission の骨格

盤面は `tile_game` と同じく TileMap で作られ、start cell、複数の beacon、最後の goal を持ちます。mission の流れは次の順です。

1. title / briefing を `DialogueOverlay` で読む
2. `Alpha` を 1 手ずつ動かす
3. 各手のあとに `Bravo`、`Mule`、`Warden` が順に反応する
4. `food` / `arms` を更新する
5. beacon 回収や敵接近 warning が起きたときに `DialogueOverlay` で turn report を読む
6. beacon をすべて回収したら goal が開く
7. goal へ入ったら clear

この構造により、sample としては「1 手動かす -> 状況を読む -> 次の 1 手を考える」の rhythm を保っています。リアルタイムではなく小さい turn 制にしているのは、高さ差、補給差、unit role の違いを利用者にも AI にも追いやすくするためです。

## 3. 現在の unit 構成

現在の `tile_sim` に出る unit は 4 つです。

### `Alpha`

`Alpha` は player が直接動かす前衛です。薄い赤寄りに色を乗せた `human.glb` を使い、勝敗条件に直接関わるのはこの unit で、beacon の回収も goal への到達も `Alpha` が担当します。

操作は arrow key または touch button で行い、camera の向きに合わせて TileMap 上を 1 cell ずつ動きます。移動は 250ms の短い tween でつないでいるため、cell の移り変わりを追いやすくしつつ、完全なリアルタイムにはしていません。

### `Bravo`

`Bravo` は水色寄りに色を変えた `human.glb` で、`Alpha` のあとに自動で動く支援役です。現在の役割は「高い地形へ寄って見張りと射撃位置の確保を担当する」ことです。言い換えると、前線を直接突破するより、高地を取りやすい位置へ寄る role を持っています。

`Bravo` は高地にいると `arms` を維持しやすい反面、`food` 面では少し苦しくなりやすく、長く居座るほど補給の重さも見えてきます。これにより、「高地へ寄るだけで正解」にはならず、support unit としての維持の難しさも sample に出ます。

### `Mule`

`Mule` は緑寄りに色を変えた `human.glb` で、後方補給役です。低い地形へ寄って `food` と `arms` を貯めやすく、補給線を維持する role を持ちます。現在は faction 全体の stock を大きく持つ構成ではなく、まず unit ごとの `food` / `arms` の変化を分かりやすく見る段階なので、`Mule` 自身が低地向きの resource unit として動きます。

`Mule` は前線に出ると強いわけではありません。むしろ低地へ寄るほど役割に合い、高地へ上がると補給効率が落ちます。この unit を入れることで、「高地が戦闘向き」「低地が補給向き」という対比を盤面上で読み取りやすくしています。

### `Warden`

`Warden` は赤寄りに色を変えた `human.glb` で、敵側の監視部隊です。現段階では本格的な戦闘解決や大規模な敵軍は入っておらず、goal や未回収 beacon を守る方向へ 1 step ずつ反応する最小 AI に絞っています。

`Warden` も `food` / `arms` を持ち、高地では守備姿勢として `arms` を維持しやすく、低地では補給が楽になるような差を持っています。敵側も高地と低地で違う困り方をすることで、盤面の高さ差が player 側だけの都合にならないようにしています。

## 4. 高地と低地の現在の意味

現在の `tile_sim` では、高さは単なる見た目ではなく、resource の増減と AI の位置取りに直接効きます。大きく言うと、次の傾向を持たせています。

| 地形帯 | 戦術面 | 補給面 |
| --- | --- | --- |
| 低地 | 戦闘では不利寄り | `food` / `arms` を回しやすい |
| 中地 | 中間 | 中間 |
| 高地 | 見張りや守りに向く | 維持が重くなりやすい |

`Alpha`、`Bravo`、`Mule`、`Warden` の各 unit は細部が少しずつ違いますが、全体方針としては「高地は強いが重い、低地は弱いが軽い」です。これにより、盤面のどこへ unit を置くかが、単なる距離最短ではなく、役割と維持の判断になります。

## 5. 現在の resource ルール

resource は今のところ `food` と `arms` の 2 種に絞っています。これは sample として読みやすさを保つためで、資源の数を増やしすぎないことを優先しています。

### `food`

`food` は unit の維持に近い値です。高地では消費が重く、低地では回復しやすくなります。`food` が少ない unit は右側 `STATE` 欄、短い flash、AI 判断の中でも危険状態として扱われ、前線維持が苦しくなっていることを読み取れるようにしています。

### `arms`

`arms` は戦闘継続力や装備の余裕に近い値です。高地では守備的な `arms` 維持が強く出る unit もありますが、低地で補給を回したほうが全体としては安定しやすい構図にしています。

現状では、これらは部隊ごとの携行量に近い扱いで、まだ本格的な faction stock、補給線切断、倉庫管理までは入っていません。そこは後段の拡張候補です。

## 6. 現在の AI の考え方

AI はまだ deep search ではありません。現段階では、陣営方針と unit role を見ながら、utility 的に「どの cell に寄るべきか」「どの目標を優先すべきか」を決める軽い判断です。

`Bravo` と `Mule` は support unit 側の logic で 1 step 反応し、`Warden` は enemy unit 側の logic で高地、goal、残っている beacon、`Alpha` との距離を見ながら動きます。この段階で重要なのは「強さ」よりも、「高地へ寄る支援」「低地で回す補給」「goal を守る敵」という役割差が盤面に出ることです。

## 7. 現在の UI と情報表示

現在の `tile_sim` では、短い HUD を常用せず、主要情報は `DialogueOverlay` に寄せています。これは strategy / simulation 系 sample では、状況説明や判断理由の文量が増えやすいためです。

### `DialogueOverlay`

`DialogueOverlay` では次の内容を扱います。

1. title 時の導入説明
2. play 開始時の briefing
3. `Alpha`、`Bravo`、`Mule`、`Warden` の役割説明
4. 各 turn の report
5. beacon 回収、goal 開放、接敵 warning などの event
6. click した tile の inspection
7. clear 後の debrief

`STATE` 欄には現在の発話者、見出し、選択肢数、進行状態などを出し、tutorial を作る側にも内部状態が読みやすいようにしています。

### 2D tactical map

右下寄りには小さい 2D tactical map を置き、盤面全体の高さ帯、`Alpha` / `Bravo` / `Mule` / `Warden`、未回収 beacon、goal、選択中 cell を俯瞰できるようにしています。3D 側で隠れやすい状況でも、配置と流れを失わないようにするのが目的です。

## 8. 現在の TileMap 表現

`tile_sim` は `surfaceShading: "smooth"` を指定しており、`tile_game` の flat な cell と比べて、tile 上部の cap が shared vertex の法線で少し滑らかに見える構成です。現在の smooth cap は、中央の平らな上面を少し残しつつ、その外周に bevel 帯を入れる形にしてあります。

ここは単なる見た目の実験ではなく、「高さ付き TileMap を strategy / simulation 系へ広げるとき、どの程度の柔らかさが読みやすいか」を見る part でもあります。したがって、`tile_sim_rules.md` にも現状ルールの一部として残しておきます。

## 9. 現在のルールを一言でまとめると

現状の `tile_sim` は、次の一文にまとめられます。

「`Alpha` が beacon を回収して goal を目指す mission を土台に、`Bravo`、`Mule`、`Warden` の反応、高地と低地の維持差、`food` / `arms`、`DialogueOverlay`、2D tactical map を重ねて、strategy / simulation の読み口を試す sample」

まだ本格戦闘、都市運営、複数敵部隊、外交、tech tree は入っていません。だからこそ、今は何が入っていて何がまだ案の段階なのかを分けて読むのが大切です。

## 10. 今後の拡張案

ここから先は、現状実装の後ろに積み上げやすい拡張案です。以下はまだ「現状ルール」ではなく、「次に自然な候補」です。

### 10.1 戦闘解決を明示する

現在は接敵圧力までは見せていますが、本格的な攻撃解決はまだ入っていません。次の段階では、`Alpha` と `Warden`、あるいは `Bravo` を含めた簡単な combat resolution を追加できます。

最初は複雑にせず、次の程度で十分です。

1. 高地なら `attack` / `defense` に小さい bonus
2. `arms` が少ないと攻撃効率低下
3. `food` が少ないと retreat しやすくなる
4. 接敵時に `DialogueOverlay` へ短い戦況 report を出す

### 10.2 faction stock と補給線を入れる

今の `food` / `arms` は unit ごとの軽い表現ですが、strategy らしさを一段進めるなら faction 全体の stock を持たせるのが自然です。`Mule` が stock を前線へ運び、低地の補給拠点や農地を失うと stock が減り、前線維持が苦しくなる構図へ広げられます。

これを入れると、`Mule` の意味がさらにはっきりし、高地防衛と低地補給の綱引きが sample 上でも一層分かりやすくなります。

### 10.3 拠点の種類を増やす

現在は beacon と goal が mission の主な object ですが、今後は次のような拠点へ広げられます。

1. 農地: `food` を回しやすい
2. 工房: `arms` を補充しやすい
3. 砦: 高地守備に向く
4. 中継所: 補給線の結節点になる

これにより、goal へ直進するだけではなく、「どの拠点を先に押さえるか」という判断が入ります。

### 10.4 role を増やす

現在の role は実質的に前衛、支援、補給、敵監視です。将来は次のような role を増やせます。

1. `ranged`: 射撃特化で高地と相性がよい
2. `scout`: 低地の高速 route を回る偵察役
3. `engineer`: 拠点整備や仮設防衛に向く
4. `medic`: 維持や morale 回復を補助する

ただし最初から増やしすぎると sample の読み口が重くなるため、1 role ずつ段階的に足すのがよいです。

### 10.5 `DialogueOverlay` を tutorial だけでなく判断 UI に広げる

今の `DialogueOverlay` は briefing、report、inspection の表示が中心です。次の段階では、unit 選択や補給方針、拠点占領時の choice にも広げられます。

たとえば次のような選択肢が考えられます。

1. 高地を維持するため `arms` を優先する
2. `food` 不足なので一時後退する
3. `Mule` を前へ送るか、安全側へ残すかを選ぶ
4. goal 開放後に急行するか、`Bravo` の位置を待つかを選ぶ

これにより、`DialogueOverlay` は単なる説明表示ではなく、strategy 系 sample の判断 UI としても評価しやすくなります。

### 10.6 phase を増やす

現在は大きく `title / play / result` ですが、今後は次のような phase を足せます。

1. `briefing`
2. `turn`
3. `event`
4. `camp`
5. `result`

この構成にすると、長い campaign 的な sample へ広げても、どの段階で何を見せたいかを整理しやすくなります。

### 10.7 A 案、B 案、C 案として再分岐する

以前の draft で考えていた方向性は、今でも拡張案として有効です。

1. A 案: 高地防衛と低地補給の綱引き
2. B 案: 遠征軍の持久戦
3. C 案: 高地要塞と低地都市の二重運営

現状の `tile_sim` は A 案に最も近いです。今後、phase や camp、scenario を増やすなら B 案寄りへ、拠点生産や stock を強めるなら C 案寄りへ伸ばすことができます。

## 11. 現時点の推奨

今の `tile_sim` から次に進めるなら、順番としては次の流れが自然です。

1. 現在の `food` / `arms` と高低差の読みやすさを整える
2. 接敵時の最小 combat resolution を入れる
3. faction stock と補給線を導入する
4. beacon / goal に加えて農地や砦を入れる
5. `DialogueOverlay` の choice を状況判断 UI として広げる

この順なら、現在の sample の良さを壊さずに、strategy / simulation として一段ずつ厚みを足していけます。
