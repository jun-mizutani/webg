# mmodeler 設計メモ

作成日: 2026/05/21
更新日: 2026/05/26

この文書は `samples/mmodeler` の内部設計を継続的に整理するためのメモである。`mmodeler.txt` はサンプル利用者向けの説明であり、この文書は今後のファイル分割、クラス設計、入力操作の見直し、編集モードの責務整理を判断するために使う。

mmodeler は、スマホやタブレット上の限られた画面で 3D mesh を編集することを目標にしている。単に desktop UI を小さくするのではなく、canvas、gesture、command palette、view button を組み合わせて、object mode と edit mode を切り替えながら編集できる構成を目指す。そのため、今後の分割では「既存の巨大な `main.js` を機械的に切る」だけではなく、どの object がどの状態を所有し、どの操作を責務として持つかを明確にする。

当初は webg の 3D / touch / ModelAsset 機能を示す sample として始めているが、現在の mmodeler は単なる小さな demo ではなく、スマートフォン上で実際に mesh を作成、編集、保存、Blender と受け渡しできる独立 tool に近づいている。そのため、見た目や操作説明だけでなく、内部状態の正本、pick 判定、保存 filename、controller 間の責務境界を仕様として扱う。特に Edit Mode の session geometry と active object geometry の違いは、今後の保守で不具合を生みやすいので、この文書で明示的に管理する。

## 基本方針

mmodeler の分割は、既存の `editOperations.js` や `transformController.js` の context 注入型に必ずしも合わせない。これらは `main.js` から処理を一時的に逃がすには有効だったが、長期的には「多数の関数を詰めた context object を渡す」形が肥大化しやすい。今後は、意味のある object が自分の状態と責務を持ち、明確な method を通して協調する設計へ寄せる。

ただし、既存の動作を一度に置き換えない。まず `ModelerScene` のような状態の核を作り、次に object mode / edit mode / view / command dispatch を整理し、最後に現在の `editOperations.js` や `transformController.js` を必要に応じて吸収または再設計する。

責務移管で method 名や公開 API を変える場合は、呼び出し側を同時に更新し、不要になった旧名の wrapper や一時 alias を残さない。互換 API を残す必要がある場合は、削除条件と期限をこの文書に明記する。

### 複数 object scene と座標系の分離

mmodeler の初期段階では「1 つの object を編集する」機能を主対象にしていた。この段階では object local 座標系と world 座標系が一致していても実用上の問題は少なく、`Origin` のような command も、ほぼ mesh の表示位置を world 原点へ戻す操作として理解できた。

しかし、ModelAsset JSON、GLB、glTF、Collada を読み込み、複数 object を持つ scene を扱うようになると、object local 座標系と world 座標系を同一視できなくなる。各 object は「local mesh geometry」と「scene 内での配置を表す object transform」を別々に持つ scene 要素である。Object Mode では scene 内の object を選択し、配置し、組み合わせる。Edit Mode では active object の local mesh geometry に入って vertex / face / edge を編集する。この 2 つは入力の見た目が似ていても、変更する正本が異なる。

そのため、Object Mode transform は mesh data を変更しない仕様とする。Object Mode の move / rotate / scale は object の `origin`、`rotation`、`scale` を変更するだけであり、vertices / faces には触れない。mesh の形状そのものを変えたい場合は Edit Mode に入り、active object の local 座標系内で編集する。表示、pick、保存、join のように world 座標が必要な場面では、その境界で local-to-world または world-to-local 変換を行う。

将来、Edit Mode の表示では active object の原点を画面上の編集中心へ置き、1 つの object が中心に見える local edit viewport を用意する可能性がある。この場合でも、内部データとして object transform を壊してはならない。Edit Mode で保存される変更は active object の local mesh geometry にだけ反映し、Object Mode へ戻ったときに scene 上の object transform が再適用される形を維持する。この方針により、複数 object scene の配置と、単一 object の詳細編集を両立できる。

## 主要 Object の役割

### ModelerScene

`ModelerScene` は最初に定義すべき中核 object とする。現在の `editor` plain object が持っている object list、active object、selection、undo / redo、dirty state、next id などを段階的に移す。

`ModelerScene` は描画や DOM を知らない。mesh object の集合、active object、現在の scene が変更済みかどうか、snapshot / restore、undo / redo の基本単位を扱う。import / export の対象となる状態もここに集約する。

想定する責務は次の通りである。

- object list を保持する
- active object を保持する
- object mode selection を保持する
- edit mode に渡す active mesh object を決める
- undo / redo stack を管理する
- dirty state を管理する
- snapshot / restore を提供する
- import 後の scene 差し替えを行う

重要なのは、`ModelerScene` は UI の command 名を知らないことである。`G`、`E`、`Add`、`Join` のような command は dispatcher や controller の責務であり、scene は状態と整合性を守る。

### CommandPalette

`CommandPalette` は UI object である。action id の表示、page 切り替え、button の enabled / active 表示、tap 位置を隠しにくい配置を担当する。dispatch 先は持たない。

`CommandPalette` が行うことは次に限定する。

- action id を 4x4 grid に表示する
- page を切り替える
- button の active / disabled を反映する
- palette を開く、閉じる
- 押された action id を外へ通知する

`CommandPalette` は `load`、`tool-face`、`toggle-projection`、`edge-slide` が何をするかを知らない方がよい。これらの分類は `ModelerCommandDispatcher` が扱う。

`Cood` は、選択 vertex の座標を status message へ流すだけの command ではなく、表示と入力を兼ねた coordinate overlay を開く command とする。最初の実装では単一 vertex 選択時だけ X / Y / Z を直接編集できる。複数 vertex 選択時は誤って一部だけを書き換えないよう、選択数と先頭 vertex の座標を表示し、入力欄は無効化する。

現在の `main.js` では、`dispatchModelerCommand(action)` が dispatcher の仮置きになっている。将来的には `ModelerCommandDispatcher` class を作り、CommandPalette、ribbon、view button、keyboard shortcut など複数の入力元から届く command id を同じ入口で処理する。

### ModelerCommandDispatcher

`ModelerCommandDispatcher` は action id を、状態を変更する対象ごとに割り振る。分類は UI の配置ではなく、どの object の責務を変更するかで決める。

想定する割り振り先は次の通りである。

- `FileCommands`: load、save-json、save-glb、screenshot
- `SceneCommands`: new-scene、primitive 追加、join-objects
- `ViewController`: projection、view axis、wireframe、background、visible pick 表示
- `ObjectModeController`: object selection、object transform、origin、object delete
- `EditModeController`: vertex / face selection、tool 切り替え、mirror、make face、loop cut、subdivision、extrude、edge slide
- `HistoryCommands`: undo、redo
- `CommandOptions`: primitive segments など、直接 geometry を変えない作成 option

`move`、`rotate`、`scale`、`delete`、`select-all` のような command は mode によって意味が変わる。dispatcher は現在 mode を見て、object mode 側または edit mode 側へ明示的に渡す。

### EditModeController

`EditModeController` は active mesh object を編集するための object である。編集モード中だけ必要な state を持ち、object mode へ戻るときに変更を scene へ反映する。

この controller は active object を保持してよい。編集モードは「今この mesh を編集する」ための状態なので、enter 時に active object を受け取り、exit 時に commit する設計は自然である。object 切り替えや import は、edit mode の外で行う。もし編集中に object を切り替える必要がある場合は、先に edit mode を exit する規則にする。

想定する責務は次の通りである。

- edit mode enter / exit
- vertex / face tool の切り替え
- vertex selection / face selection
- add vertex
- make face
- delete vertex / face
- X mirror edit
- loop cut
- subdivision
- edit transform 操作
- active object への commit

`EditModeController` は CommandPalette を知らない。CommandPalette から届いた command id は dispatcher が `editMode.setTool(...)`、`editMode.deleteSelected()`、`editMode.startTransform(...)` のような method へ変換して呼ぶ。

Edit Mode へ入るときの既定 tool は Face Select とする。mmodeler は面単位の loop cut、extrude、subdivision、Catmull-Clark などを mobile command の中心に置くため、Object Mode から Edit Mode へ移った直後に face を選びやすい方が自然である。必要な場合だけ command palette の `Vert` で Vertex Select へ切り替える。

### ObjectModeController

`ObjectModeController` は object list と object selection を扱う。active object の選択、複数 object selection、primitive object 追加、join、origin 移動、object 単位の transform を担当する。

現在の mmodeler は edit mode の操作が中心だが、object mode も scene 全体を扱う重要な境界である。object mode は active object を変更できるが、edit mode 中に勝手に active object を差し替えない。必要なら edit mode exit を明示する。

Object Mode transform は mesh data を変更しない。object は local mesh geometry とは別に `origin`、`rotation`、`scale` を持ち、move / rotate / scale はこの object transform state を更新する。頂点配列と face 配列は object local 座標系内の形状として保持し、描画、pick、保存、join など world 座標が必要な場面だけ object transform を適用する。これにより、Object Mode の transform は軽い scene 操作になり、Edit Mode の vertex / face transform とは責務が分かれる。

### ViewController

`ViewController` は camera、projection、wireframe、view axis、background、visible pick 表示などを扱う。`Ortho` や `Wireframe` は編集モードそのものではなく view state であるため、EditModeController に持たせすぎない。

ただし、wireframe が edit selection の pick 条件に影響する場合がある。その場合も、EditModeController は `viewController.isWireframePickEnabled()` のような意味のある API を読むだけにし、DOM や palette state には依存しない。

## Transform 操作の再設計

現在の `TransformController` は `move`、`rotate`、`scale`、`extrude`、`edge-slide` をまとめて扱う独立 controller として存在する。しかし、編集モードに限って言えば、これらはすべて active mesh object の編集操作である。特に `extrude` と `edge-slide` は edit mode の geometry と選択状態に深く依存するため、独立した汎用 controller として外に置く意味は弱い。

今後は、`TransformController` をそのまま維持する前提ではなく、EditModeController 内の `EditTransformSession` として再設計することを検討する。

### Mobile editing session の原則

mobile の canvas 操作では、pointerup をすぐ確定にすると、指で隠れている位置がそのまま結果になってしまう。transform だけでなく、矩形選択でも同じ問題がある。矩形選択では drag 終了点が指に隠れるため、pointerup の瞬間に確定すると「どこまでを囲んだのか」を確認する前に選択が変わる。

そのため、mobile で preview を伴う編集操作は、できるだけ session として扱う。drag は preview の更新、pointerup は 1 回の drag segment 終了、tap は確定、cancel command は取り消し、という分担を基本形にする。これにより、利用者は指を離した後に preview を見てから確定できる。

この原則は次の操作に適用する候補である。

- transform: move / rotate / scale / extrude / edge-slide
- box select: 矩形範囲の preview と確定
- loop cut preview: cut 方向の preview と確定
- Chain Select: 開始 vertex から連続選択する方向の preview と確定

### 旧方式の問題

初期の mobile transform は、palette で `G/R/S/E/GG` を選び、drag して pointerup で確定する方式だった。この方式は desktop の mouse 操作に近いが、スマホでは指の移動範囲が小さい。移動、回転、スケール、押出では、目的の量まで到達するために何度も command を開始し直す必要がある。

`edge-slide` では特に、drag しながら比率を探し、納得した時点で確定する操作が欲しくなる。pointerup ですぐ確定すると、指を置き直して継続調整しにくい。結果として、`G` や `GG` のような transform が「少し動かして確定、また command を開いて少し動かす」という細切れの操作になり、mobile での操作性が悪くなる。

### 目標とする操作フロー

mobile では transform を 1 回の drag で完結させるより、command 開始後に複数回 drag でき、明示的な tap で確定できる形を検討する。

想定する基本フローは次の通りである。

```text
double tap
G
drag
drag
drag
tap to confirm
```

このフローでは、`G` を選んだ時点で transform session が始まる。以後の drag はすべて同じ session に累積される。pointerup は確定ではなく「1 回の drag 操作が終わった」だけと扱う。tap、または専用の confirm command により確定する。キャンセル操作も別に用意する。

この考え方は `move` だけでなく、`rotate`、`scale`、`extrude`、`edge-slide` にも適用できる。特に `edge-slide` は、複数回 drag で slide ratio を調整し、最後に tap で確定する方が mobile では自然である。

### EditTransformSession の考え方

`EditTransformSession` は EditModeController の内部状態として扱う。開始時に対象 vertex / face / edge 情報、開始 snapshot、現在の累積量、axis constraint、preview 用の初期状態を保持する。

想定する state は次の通りである。

- transform kind: move / rotate / scale / extrude / edge-slide
- target vertices
- selected faces
- start snapshot
- current accumulated value
- drag baseline
- axis constraint
- mirror pairs
- edge slide targets
- extrude duplicated vertices
- changed flag

pointer の扱いは次のように整理する。

- transform session が active の間、canvas drag は camera ではなく transform preview に使う
- pointerdown は新しい drag segment の開始
- pointermove は現在 segment の差分を preview に反映
- pointerup は segment 終了であり、確定ではない
- tap は confirm
- Escape、Cancel command、または別 command は cancel または commit の規則を明示する

この方式では、preview を何度も更新しても undo stack には 1 回の操作として積む。session 開始時に snapshot を取り、confirm で確定、cancel で snapshot へ戻す。

### BoxSelectSession の考え方

矩形選択も transform と同じく session として扱う候補である。現在の `boxSelectArmed` は、empty double tap 後の次の drag を矩形選択に使うための状態だが、drag 終了時点で確定すると、終点が指に隠れたまま selection が変わる。

`BoxSelectSession` では、empty double tap で session を開始し、drag で矩形 preview を更新する。pointerup では矩形を残したまま preview を確定待ち状態にし、次の tap で選択を確定する。範囲が違っていた場合は、確定待ち状態のまま再度 drag して矩形を引き直せるようにする。cancel command または別の mode 切り替えでは preview を消して session を終了する。

2026/05/22 時点では、`BoxSelectSession.js` を追加し、mobile profile の empty double tap 後だけこの仕様を使う。desktop の通常 drag selection は従来通り pointerup で即時確定する。mobile では drag 終了時に矩形を表示したまま `awaitingConfirm` に入り、短い tap で `selectByClientRect()` を呼ぶ。確定前にもう一度 drag すると preview を作り直せるため、指で終点が隠れた状態で selection が変わらない。確定待ちの矩形は tap confirm または cancel まで表示したままにし、tap confirm の pointerdown / 微小 move / pointercancel では消さない。long press は矩形選択 session の cancel として扱い、preview と armed 状態を消す。

2026/05/23 の追加仕様として、`boxSelectArmed` または preview 確定待ちの状態で再度 double tap した場合も cancel として扱う。armed 状態は camera orbit を止めるため、利用者が「矩形選択に入ったがやめたい」と感じたときに long press だけでなく同じ double tap 操作で戻れるようにする。

想定する state は次の通りである。

- start point
- current rect
- committed rect
- additive selection flag
- target mode: object / vertex / face
- preview candidate count
- committed flag

この方式により、利用者は指を離したあとで矩形の範囲を確認できる。範囲が狭すぎる、広すぎる、終点がずれていると分かった場合は、確定前にもう一度 drag して preview を作り直せる。特に小さい頂点や密な mesh では、指で隠れていた終点を確認し、必要ならやり直してから確定できるため、誤選択を減らせる。

### Object transform との関係

object mode の move / rotate / scale は、edit mode transform と入力の見た目は似ているが、対象は mesh geometry ではなく object transform state である。move は `origin`、rotate は quaternion の `rotation`、scale は uniform `scale` を変更し、vertices / faces には触れない。object local 座標系内の mesh を変形する必要がある場合は Edit Mode に入って操作する。

将来的には ObjectModeController に `ObjectTransformSession` を持たせるか、EditTransformSession と共通の低レベル数学 helper を共有する。ただし、共有するのは pointer segment や screen drag から量を読む部分までであり、適用先は Object Mode と Edit Mode で分ける。Object Mode は object state、Edit Mode は edit session の geometry を更新する。

ただし、最初から汎用 `TransformController` を作る必要はない。edit mode の mobile 操作性を先に正しく設計し、その後に object mode と共通化できる部分だけを取り出す方が安全である。

### 現在の TransformController の扱い

現在の `transformController.js` は、すぐには削除しない。まず `ModelerScene` と EditModeController の境界を作り、現在の transform 処理がどの状態に依存しているかを確認する。その後、次のどちらかを選ぶ。

- `transformController.js` を EditModeController 内部の `EditTransformSession` へ吸収する
- 数学処理だけを `transformMath.js` のような helper に残し、session 管理は EditModeController / ObjectModeController へ移す

判断基準は、transform が「状態を持つ controller」として独立する必要があるかではなく、どの mode のどの object の編集状態に責任を持つかで決める。

## 実装順序

### 1. ModelerScene を作る

最初に `ModelerScene` を作り、現在の `editor` plain object から scene state を段階的に移す。最初は `editor` と同じ形の state を包むだけでもよいが、API は class method として定義する。

最初に移す候補は次の通りである。

- objects
- activeObjectId
- vertices / faces
- selectedObjectIds
- selectedVertices / selectedFaces
- next ids
- dirty
- lastMessage
- undo / redo stack

2026/05/21 時点では、`ModelerScene.js` を作成し、`main.js` の `editor` plain object を `new ModelerScene(...)` に置き換えた。既存の直接 property 参照を壊さないため、最初の実装では従来と同じ field を class instance に持たせている。selection、undo、active object、edit mode commit の method 化は次の段階で行う。

### 2. Command dispatch を class 化する

現在の `dispatchModelerCommand(action)` を `ModelerCommandDispatcher` へ移す。最初は巨大な if 文をそのまま method に移してもよい。その後、FileCommands、SceneCommands、ViewCommands、ObjectModeController、EditModeController、HistoryCommands、CommandOptions へ少しずつ分ける。

### 3. EditModeController を作る

EditModeController は active object を受け取って enter し、exit 時に commit する。最初は selection、tool 切り替え、delete、make face、mirror など、transform 以外の編集操作から移す。

### 4. Transform を EditModeController の内部 session として見直す

現在の `TransformController` の API をそのまま移すのではなく、mobile で複数 drag と明示 confirm を扱える `EditTransformSession` として設計し直す。最初の実装対象は `edge-slide` か `move` がよい。理由は、どちらも複数 drag の効果が分かりやすく、現在の操作性の課題が見えやすいからである。

### 5. ObjectModeController と ViewController を分ける

object selection、primitive 追加、join、origin、object transform を ObjectModeController へ移す。projection、view axis、wireframe、background、visible pick 表示を ViewController へ移す。

## 確定した Mobile Editing Session 仕様

mobile editing session は、preview を見てから確定できることを重視する。実装時に操作ごとに判断を変えると、transform、box select、loop cut preview の挙動がばらつくため、次の仕様を確定事項として扱う。

- transform session と box select session の確定は tap で行い、専用の confirm button は置かない
- transform session と box select session の cancel は long press で行う
- `G/R/S/E/GG` などの編集 command 実行中は、tap による通常選択を行わない
- session 中の tap は selection ではなく confirm として扱う
- pointerup は確定ではなく、drag segment の終了として扱う
- mobile で複数選択したい場合は画面左上の `↑` button を Shift 相当 toggle として使う
- `↑` button が active の間は tap selection が追加選択になり、選択済み vertex / face をもう一度 tap すると選択解除する
- 独立した axis chooser は廃止する
- 軸制限は command palette 1 枚目の `X/Y/Z/N` で、`G/R/S/E/GG` を選ぶ前に確定する
- `X/Y/Z` は world 軸、`N` は Edit Mode で選択 face の平均法線方向を軸制限の対象にする。face 選択が無く vertex 選択だけがある場合は、選択 vertex に接する周辺 face の平均法線方向を使う
- `N` は face normal に意味がある Edit Mode 専用 option とし、Object Mode transform では使わない
- 同じ軸制限 button をもう一度選ぶと free に戻す
- 正負方向を切り替える button は置かない
- `N` を 1 枚目 4 行 4 列へ置き、`M` / X Mirror は 2 枚目の `Next` の上へ移動する
- `Add`、`Pr`、`Del`、`Wire`、`Smooth`、`Lens` は command palette 2 枚目へ置き、選択 / 細分化 / 表示切り替え / 焦点距離切り替えを同じ page で扱う。`Smooth` は `Wire` の下に置き、`Lens` はその下に置く
- `Tab` は long press による mode 切り替えで代替できるため palette から外し、座標表示 / 入力 command は 3 枚目の `Cood` に置く
- edge-slide の slide ratio は複数 drag で線形累積する
- box select preview 中は、tap で確定するまで矩形を再 drag して修正できる

loop cut preview も同じ考え方で、単独 quad face の方向選択中は drag / pointer move で preview 線の方向を更新し、短い tap は現在表示されている preview を確定する。確定 tap の位置で preview 方向を再選択すると、指を離して確認した方向と実際に確定する方向がずれるため、tap confirm では edge 選択を更新しない。

loop cut preview 中は、確定またはキャンセルまで Edit Mode を維持する。preview active のまま Object Mode へ切り替わると、preview 線と選択 face の関係が切れ、tap confirm が成立しなくなるためである。長押しや mode 切り替え command が入った場合も、preview を先に確定またはキャンセルするよう message を出して切り替えを拒否する。

X Mirror が ON の loop cut では、source 側で決まった cut edge を mirror face 上の対応 edge へ写す。左右の face では頂点順が反転している場合があるため、source 側の edge index をそのまま mirror face へ流用しない。`findXMirrorFace()` が返す vertex pair で source edge の両端を mirror vertex へ変換し、mirror face の頂点列から同じ edge を探して plan を追加する。対応 edge が見つからない場合は、別方向へ自動補正せず message を出して処理を止める。

Chain Select は、Loop Select とは別の vertex selection command として扱う。Loop Select は loop cut 後の中点 vertex を対象にし、GG と同じ中点判定から左右 polygon の対辺中点へ進む。一方で Chain Select は中点判定を使わず、選択済み vertex を開始点として隣接 edge の方向候補を screen 上で preview し、tap で quad 面だけでつながる vertex chain を確定選択する。UV 球の緯線のような曲線 loop も対象にするため、直線近傍にある vertex を幾何的に拾うのではなく、edge の進行方向に近い隣接 edge をたどる。ただし 4 分割した立方体の 90 度角のような crease を越えて連続性を推定することはしない。角では chain を終了し、ユーザーが別方向の chain として選び直せる仕様とする。三角面や五角面では loop の解釈が曖昧になるため、その edge を境界として停止する。＋形の交点では縦または横の候補を preview で選べるようにし、確定前には通常の tap selection を行わない。

mesh 全体の subdivision は、選択 face だけを局所的に分割する command ではなく、active mesh の polygon 全体を一括で 4 分割する操作として扱う。quad-only mesh では全 face を同時に処理し、共有 edge の midpoint を 1 つの vertex として再利用するため、隣接 face 間に T-junction は発生しない。三角面や非 quad が存在する mesh では、後続の loop / edge 操作が前提にする topology が曖昧になるため、初期実装では自動補正せず実行しない。

Catmull-Clark subdivision は、形状維持の `Subd` とは別 command として扱う。active mesh 全体を対象にし、各 face の face point、各 edge の edge point、各旧 vertex の更新後位置を計算して、元 face の辺数と同じ数の quad face に置き換える。三角面は 3 個の quad に変換できるため処理対象に含める。ただし、1 本の edge を 3 face 以上が共有する non-manifold edge や、boundary が単純な 2 方向にならない vertex は smoothing の解釈が曖昧になるため、自動補正せず拒否する。

この仕様により、mobile では「指を動かして preview を作る」「指を離して結果を見る」「必要なら再 drag する」「tap で確定する」という一貫した操作にする。`G/R/S/E/GG` のような編集 command 中は、選択対象を変える必要はないため、tap selection との競合は起こさない。

## 決定済み方針と今後の検討範囲

object mode transform と edit mode transform は、変更する正本が異なるため別責務として扱う。Object Mode は object transform state を変更し、Edit Mode は active object の local mesh geometry を変更する。

今後共通化を検討してよい範囲は、pointer capture、drag segment、screen-space の移動量から transform 量を読む数学 helper までである。object へ適用する処理と edit mesh へ適用する処理は混ぜない。`TransformController` を整理するときも、この方針を前提に `ObjectTransformSession` と `EditTransformSession` を分けて考える。

## 保守上重要な仕様

この節は、利用者向けの操作説明というより、今後コードを変更するときに守るべき内部仕様をまとめる。mmodeler は入力、pick、mesh editing、保存、描画が同じ canvas 上で密接に関係するため、状態の正本を取り違えると、一見無関係に見える操作で不具合が出る。

### Edit Mode の geometry 正本

Object Mode では、`ModelerScene` が持つ object list と active object が保存・表示・選択の正本になる。これに対して Edit Mode では、active object を直接編集し続けるのではなく、`EditModeController.enterEditMode()` が active object の mesh を clone して edit session を作る。Edit Mode 中の vertex / face、selection、next id はこの session が正本であり、`getRenderableEditMeshState()` は現在表示・pick・overlay に使うべき mesh state を返す。

`commitEditMeshState()` は edit session の内容を active object へ書き戻す境界である。Object Mode へ戻る、save / export する、object list を操作する、snapshot を作る、といった保存対象または scene 全体を見る処理では commit が必要になる。一方で、Edit Mode 中の click selection、visible pick、box select、overlay、loop cut preview、GG target 探索は、commit 前の edit session を読む必要がある。

この違いは Loop Cut 後に特に重要になる。Loop Cut で作成された中点 vertex は、まず `EditModeController` の edit session に追加される。active object 側へ commit する前に vertex pick や face pick が active object の古い `vertices` / `faces` を読むと、新しい中点 vertex を含む face を正しく判定できない。その結果、画面上には頂点 marker や edge が見えているのに、Vertex Select では選択できない、Visible Pick の遮蔽判定で候補が落ちる、という不具合につながる。

今後 pick / selection / overlay / transform preview を修正するときは、次の原則を守る。

- Edit Mode 中の表示・pick・selection・preview は `getRenderableEditMeshState()` の `vertices` / `faces` を読む
- Object Mode 中の object selection、join、primitive 追加、save / export の保存対象は commit 済み active object または object list を読む
- active object の transform / origin / rotation / scale は object 側の state なので、local-to-world 変換には active object を使う
- local mesh の vertex / face lookup は Edit Mode 中なら edit session 側を使い、active object の古い配列を暗黙に使わない
- scene 全体を差し替える New Scene / import / 旧 snapshot 復元では、古い edit session を `discardEditSession()` で明示的に破棄する

この規則により、表示されている mesh、pick 対象の mesh、保存される mesh がどの段階で一致するかを追いやすくする。すべての処理で常に active object へ書き戻すのではなく、表示・編集用の session と保存・object 操作用の committed data を用途ごとに使い分ける。

### Vertex Pick の方式

Edit Mode の vertex click selection は、3D 空間上の marker object を raycast して選んでいるわけではない。現在の marker は 2D overlay として描画しており、Space 上に pick 用 marker node を作らない。旧 marker raycast 用の `pickVertexMarker()` は入口だけ残っているが、現在は `null` を返す。

主経路は `pickVertexByRayDistance(ray)` である。この処理は、`getRenderableEditMeshState().vertices` の全 vertex を現在の view-projection matrix で browser client 座標へ投影し、pointer の client 座標からの screen-space 距離が一定半径内に入る vertex を候補にする。候補が複数ある場合は、pointer に近いものを優先し、距離が同じ場合は screen 上の z が手前のものを優先する。

Visible Pick が ON の場合は、候補を作った後に `isVertexSelectableFromView()` で表向き判定と遮蔽判定を行う。遮蔽判定では、候補 vertex 自身を含む face を自己遮蔽として扱わないよう `ignoreVertexId` を使い、候補点より手前に別 face があるかを調べる。このときも Edit Mode 中は edit session の `faces` / `vertices` を使う必要がある。active object の古い mesh を使うと、Loop Cut 後の中点 vertex を含む face が見つからず、見えている頂点が選択不能になる。

Box Select でも同じ考え方を使う。矩形内に入るかどうかは vertex の world position を client 座標へ投影して判定し、Visible Pick が ON の場合だけ追加で遮蔽判定を行う。矩形選択は「画面上で見えている点を範囲指定する」操作なので、client 座標への投影が正本であり、3D ray と marker geometry の交差ではない。

この方式を採る理由は、スマートフォン上で小さな vertex marker を直接 raycast 用 geometry として持つより、screen-space の距離で選ぶ方が touch 操作と相性がよく、2D overlay 表示とも一致しやすいためである。今後 pick を `ModelerPicking.js` へ分離する場合も、vertex pick は「renderable edit mesh を screen 座標へ投影して pointer との距離で候補化する」仕様を維持する。

### 保存 filename の仕様

mmodeler から保存する ModelAsset JSON、gzip 圧縮済み ModelAsset JSON、GLB は、固定 filename ではなく日時付き filename を使う。形式は次の通りである。

```text
ma_YYYYMMDD_HHMMSS.json
ma_YYYYMMDD_HHMMSS.json.gz
ma_YYYYMMDD_HHMMSS.glb
```

たとえば 2026/05/24 11:44:00 に保存した gzip JSON は `ma_20260524_114400.json.gz` になる。利用者が download folder の中で保存順を追いやすく、同じ file を何度も保存しても固定名で上書き確認や自動リネームに依存しにくいようにするためである。

同じ browser session 内で同じ秒に複数回保存した場合は、2 回目以降に `_02`、`_03` のような短い suffix を付ける。たとえば同じ秒に JSON.gz と GLB を続けて保存した場合、後の file は `ma_20260524_114400_02.glb` のようになる。これは download filename の衝突を避けるための命名規則であり、保存内容や geometry を変更する処理ではない。

この filename 規則は mmodeler の実用 tool 化において重要である。スマートフォンやタブレットでは file manager 上で細かい rename を行いにくく、Blender との受け渡しでも保存時刻が分かる方が作業履歴を追いやすい。今後 `ModelerImportExport.js` を作る場合は、file format の生成処理だけでなく、この filename 規則も同じ module または明示的な helper として維持する。

### 外部 ModelAsset の面順と Blender 連携

mmodeler に import する外部 ModelAsset JSON は、`geometry.polygonLoops` または `geometry.indices` に記録された面順を source of truth として扱う。import 直後に原点基準の自動 orientation 補正を掛けると、原点から離れた object、複数 object scene、凹形状、内側面を持つ model で、exporter が正しく出した winding を誤って反転する可能性がある。そのため、ModelAsset import では外部 asset の面順を勝手に補正せず、editor object へ取り込んだあとそのまま active object へ commit する。

一方で、mmodeler 内で新規 face を追加する処理では、隣接 face との edge 方向や選択面の法線を使って面順をそろえる必要がある。`orientAllFacesConsistently()` や `orientLoopByAdjacentFaces()` は、mmodeler が内部で生成した face の整合性を保つための補助であり、外部 ModelAsset の import 時に無条件で適用する処理ではない。

primitive 追加では、`makePrimitiveGeometry()` が外向きの face loop を生成する責務を持つ。primitive 追加後に原点基準で自動反転すると、Plane のように原点上へ置かれる形状や、Cylinder / Cone の cap と side のように法線方向が部位ごとに異なる形状で、正しい面順を判定しにくい。したがって、Cube / Plane / Cylinder / Cone / Double Cone / Sphere / Torus は生成時点の loop 順を正とし、追加直後に `orientAllFacesConsistently()` を掛けない。

Blender 連携では、Blender 上で外側が表として正常に見えていても、object の `matrix_world` に負 scale や Mirror を含むと、頂点を world 座標へ焼き込んだ時点で座標系の handedness が反転する。この場合、`blender_modelasset_io.py` は `matrix_world.to_3x3().determinant() < 0` を検出し、出力する polygon loop を反転して ModelAsset 側でも外側が表になるようにする。これは model の法線を勝手に補正する処理ではなく、Blender の object transform を geometry に焼き込む際に必要な winding 変換である。

## TODO: クラス分割予定

この節は履歴ではなく、現時点での分割状態と次に進める作業を確認するための TODO とする。完了済みの作業は「完了」として短く残し、次に触るべき未分割の責務を優先して書く。

2026/05/24 時点では、`main.js` は約 5100 行であり、まだ接続役だけにはなっていない。一方で、初期方針にあった主要 class はすでに作成され、編集 mode の geometry command も大部分が `EditModeController` へ移っている。今後の分割は、既存 class を増やす段階から、`main.js` に残る大きな責務を用途ごとに外へ出す段階へ移る。

### 現在の責務分担

`CommandPalette.js` は 4x4 palette の page、button 表示、enabled / active 表示、axis button の色、tap 位置を隠しにくい配置を担当する。command の意味は知らず、押された action id を外へ通知する UI object として扱う。この境界は今後も維持し、palette 配置の変更が dispatch 処理へ混ざらないようにする。

`ModelerCommandDispatcher.js` は palette、ribbon、view dock などから届く action id の入口である。primitive segment や axis option のように palette を閉じない command と、それ以外の実行 command を分け、file、scene、view、history、edit、selection 系へ分類している。現在も file 入出力、transform 開始、mode 切り替え、複合 selection command などは `main.js` の関数を呼ぶ箇所が残るが、primitive 追加、object join、view command、edit command の一部は controller method へ直接 dispatch されている。

`ModelerScene.js` は object list、active object、object selection、message、dirty state、undo / redo stack、active object commit、object list 差し替えを扱う scene state の核である。Edit Mode 中の mesh geometry の正本は `EditModeController` の edit session に移り、保存・object 操作用の正本は commit 後の active object になる。`ModelerScene` は描画や DOM を知らず、scene 全体の整合性を守る役割に寄せる。

`EditModeController.js` は active mesh object の編集 session を所有する。`enterEditMode()` は active object の mesh を clone して内部 session を作り、`commitEditMeshState()` は session から active object へ clone を書き戻す。`exitEditMode()` は commit 後に session を破棄して Object Mode へ戻り、New Scene や import のように scene 全体を差し替える処理では `discardEditSession()` で古い session を明示的に破棄する。これは保存済み object へ暗黙に戻す処理ではなく、scene reset 境界として扱う。

`EditModeController` には tool 切り替え、vertex / face selection、add vertex、make face、delete、face flip、extrude、keyboard transform、X Mirror、loop cut、loop cut preview、Chain Select、Select Loop、GG target 探索、subdivision、Catmull-Clark が集まっている。`editOperations.js` は役割を終えて削除済みであり、Edit Mode の geometry command は controller 内の session state を更新する形になった。視点依存の face ordering、screen 移動の camera basis、transform preview の pointer 処理など、外部情報が必要な部分だけを `main.js` または `transformController` から注入する。

2026/05/24 の transform 吸収作業では、Edit Mode の move / rotate / scale / extrude / GG preview で実際に `vertex.position` を更新する処理を `EditModeController.applyEditTransformDrag()` へ移した。続けて、target vertices、initial positions、X Mirror pairs、edge slide targets、extrude normals、center、axis constraint、changed、segmentChanged などの Edit Mode transform session state を `EditModeController.startEditTransformSession()` が所有する形へ移した。この開始 API は session object を外へ返さず、開始できたかどうかの boolean だけを返す。`transformController.js` は pointer session、drag 量、Object Mode の axis constraint、history transaction の調停を続けるが、Edit Mode の geometry 更新と session state は `EditModeController` の責務になった。さらに `transformController.js` は Edit Mode transform session object を保持せず、Edit 変形中かどうかだけを見て `EditModeController.applyEditTransformDrag()` を呼ぶ形へ寄せた。drag input は camera basis、drag delta、viewport size などの入力値として渡し、active edit mesh size から worldPerPixel を決める処理、axis constraint から axis vector / constrained move delta への変換、GG 用 slide 幅の解釈は `EditModeController` 側で行う。drag segment 終了、confirm / cancel についても `EditModeController.finishEditTransformDragSegment()`、`confirmEditTransformSession()`、`cancelEditTransformSession()` を経由し、session 終了の意味を controller 側の API として表すようにした。

`ObjectModeController.js` は Object Mode の object selection、select all / invert / X<0、object delete、join、primitive 追加、origin reset を扱う。geometry 生成のうち primitive 生成は `ModelerPrimitiveFactory.js` へ分離済みであり、controller は undo、commit、scene 置換、表示更新、message を担当している。join 用の local-to-world 変換と保存対象の決定はまだ `main.js` に残る。

2026/05/24 の Object Mode transform 分離により、object は `origin`、`rotation`、`scale` を mesh geometry とは別に持つ。現時点では pointer session はまだ `transformController.js` に残っているが、Object Mode の move / rotate / scale は vertices / faces を書き換えず object transform state を更新する。続く整理で、Object Mode transform の開始 snapshot と preview 適用は `ObjectModeController.createObjectTransformSnapshot()` と `ObjectModeController.applyObjectTransformPreview()` へ移した。`transformController.js` は pointer session と drag 量の計算を担当し、Object Mode の適用先は controller 側へ渡す。次に進める場合は、この pointer session 自体を `ObjectTransformSession` と `EditTransformSession` へ分ける。

2026/05/24 の追加整理で、click selection と box select の確定処理も controller 側へ寄せ始めた。Object Mode では `selectObjectFromPick()`、`clearObjectSelectionFromPick()`、`selectObjectsByIdsFromBox()` が selection 反映、scene rebuild、message を担当する。Edit Mode では `selectVertexFromPick()`、`selectFaceFromPick()`、`clearSelectionFromPick()`、`selectVerticesByIdsFromBox()`、`selectFacesByIdsFromBox()` が selection 反映、selection overlay 更新、message を担当する。これにより `main.js` の pointer handler は、`ModelerPicking` の結果を mode / tool ごとの controller method へ渡す接続役へ近づいた。

`ViewController.js` は projection mode、object wireframe、background theme、visible pick、mobile view axis の状態と表示系 command を扱う。WebGPU resource、camera object、DOM 更新はまだ直接保持せず、`setEffects(...)` で `main.js` から渡された callback を呼ぶ。この形により、view state の所有と描画 resource の寿命管理をまだ分けておける。

`BoxSelectSession.js` は mobile profile の empty double tap から始まる矩形選択 session を担当する。drag で preview、pointerup で確認待ち、tap で確定、long press または再 double tap で cancel という mobile 操作仕様を `main.js` から分離している。Object Mode / Edit Mode のどちらを選択対象にするか、実際の pick 結果をどう selection へ反映するかは、呼び出し側が渡す callback に残る。

`MobileInputController.js` は mobile profile の入力状態をまとめる controller として追加した。selection shift、command palette 用の保留 tap、double tap 判定、box select armed、ribbon flick、2 本指 view roll gesture、pointer 抑止 window、last gesture diagnostics を所有する。2 本指 roll は EyeRig の rod 側 `orbit.roll` ではなく eye 側 `orbit.lookRoll` を更新し、camera target や distance を変えずに画面中心を軸として視野そのものを回転する。2 本指入力は EyeRig の pinch zoom / 2 本指 pan と同じ pointer stream を使うため、roll が入力を claim して EyeRig を止めてはいけない。人間の指では純粋な zoom、純粋な pan、純粋な roll を正確に分けて操作できないので、同じ 2 本指 gesture から中心移動は EyeRig の pan、距離変化は EyeRig の pinch zoom、角度変化は MobileInputController の lookRoll として同時に反映する。`main.js` は canvas click selection、pick、mode 切り替え、message、orbit、BoxSelectSession などの application 側 effect を callback として渡す。これにより、mobile input の状態機械と、実際に何を選択・編集するかの処理を分け始めた。

view dock の `X/-X/Y/-Y/Z/-Z` は標準方向へ戻す操作として扱う。これらを押したときは orbit camera の target と distance は維持し、rod 側の yaw / pitch を preset に合わせる。同時に eye 側の `lookRoll` も 0 に戻し、2 本指 view roll で傾いた視野を標準の水平状態へ戻す。

`ModelerPrimitiveFactory.js` は Cube / Plane / Sphere / Torus / Cylinder / Cone / Double Cone の editable primitive geometry を生成する。ここでは UI や scene state を持たず、`kind`、`objectId`、`segments` から local vertices / faces を持つ scene object を返す。生成される primitive は local origin を形状の中心に置き、object origin と一致させる。分割数は `VALID_PRIMITIVE_SEGMENTS` で検証し、不正な値を自動補正しない。face loop は生成時点で外向きになることを仕様とし、primitive 追加後に原点基準の orientation 補正を掛けない。`main.js` は `mobileInput.primitiveSegments` を読み、この factory へ値として渡す薄い adapter だけを持つ。

`ModelerRenderer.js` は WebGPU scene graph node と Shape の寿命管理を担当し始めた。現在は object mesh node、selected face overlay node、旧 marker root、旧 grid root の生成と破棄、ModelAsset から Shape を作る処理を持つ。edge overlay は、edge 抽出と色判定を `main.js` に残したまま、渡された edge list を line-list buffer へ詰める処理を `ModelerRenderer.rebuildEdgeOverlayBuffer()` へ移し、現在 camera の matrix 設定と draw を `ModelerRenderer.drawEdgeOverlayLines()` へ移した。marker overlay も、active object や edit mesh を renderer へ渡さず、`makeMarkerOverlayRenderData()` で screen-space marker の配列へ変換してから `ModelerRenderer.drawMarkerOverlay()` へ渡す形にした。guide overlay は、grid / axis / loop cut guide / Chain Select preview の意味づけを `main.js` に残し、line data へ変換してから renderer へ渡す。2026/05/25 の整理で、overlay pass 共通の view / projection snapshot を `ModelerRenderer.makeOverlayViewProjection()` へ置き、guide overlay の view / projection matrix セットアップと line-list buffer 反映は `ModelerRenderer.drawGuideOverlayLines()` へ移した。camera projection の多くと dirty flag はまだ `main.js` に残している。renderer は edit command や import の意味を知らず、渡された object、asset、material、selected state、または描画済み overlay data を scene graph / overlay buffer へ反映する。dirty flag については、次の分割準備として `markEditOverlayGeometryDirty()`、`markEditOverlayVisualDirty()`、`markMarkerOverlayDirty()`、`markEdgeOverlayUploadDirty()` に更新入口を集め、geometry 変更、selection / color 変更、marker だけの再投影、edge buffer upload の違いを関数名で追えるようにした。

Perspective の edit edge、vertex marker、guide preview、selected face overlay の zBias は、固定値をそのまま使わず、projection の depth coefficient と FOV から scale する。基準 projection は near / far = 0.05 / 1000.0 とし、現在の Perspective near / far から `abs(far * near / (near - far))` を求めて比を掛ける。2026/05/26 時点では Perspective near / far も基準値と同じ 0.05 / 1000.0 とする。Near を過度に小さくすると depth precision が落ち、Z fighting が起きやすくなるためである。Orthographic は従来 range を維持しているため、専用の小さい固定 bias または 0 を使う。通常 mesh は裏面確認のため両面描画するが、selected face overlay は反対側の面まで選択色が見えると選択面を誤認しやすいため、overlay shader だけ back-face culling を有効にする。

`transformController.js` はまだ独立 file として残っている。mobile touch では pointerup を確定ではなく drag segment 終了として扱い、tap で明示 confirm する仕様に寄せているが、最終的な `EditTransformSession` ではない。現在は pointer session、axis constraint、drag 量計算、confirm / cancel、history transaction 境界を担当する殻に近づいている。Edit Mode の transform session state と geometry preview は `EditModeController` へ委譲し、Object Mode の move / rotate / scale は `ObjectModeController` method へ委譲する。Edit Mode については、`transformController.js` が session object を持たず `targetKind` で Edit / Object の対象種別だけを扱う段階まで進んだ。drag preview 適用も `applyObjectTransformDragPreview()` と `applyEditTransformDragPreview()` に分け、今後 Edit 側だけを `EditModeController` へ吸収しやすい形にした。今後は pointer event の所有者と history transaction 境界を整理し、Object Mode 側は `ObjectModeController`、Edit Mode 側は `EditModeController` の session として完結させる。

### main.js に残る大きな責務

`main.js` は現在も mmodeler の接続点であり、次の責務が集中している。ここを一度に削ると原因追跡が難しくなるため、入力、picking、import / export、rendering のように観測しやすい境界ごとに分ける。

- WebGPU / scene rebuild / overlay 描画: object mesh node と selected face overlay node の scene graph 管理、edge overlay の line-list buffer 構築、marker overlay の screen-space marker buffer 構築、guide overlay の line-list buffer 構築は `ModelerRenderer.js` へ移し始めた。`main.js` には edge 抽出、edge 色判定、marker overlay render data の作成、guide overlay render data の作成、projection、camera sync、dirty flag が残っている
- picking / visible pick / rectangle selection: `ModelerPicking.js` へ ray 作成、triangle intersection、front-facing 判定、occlusion grid、vertex / face selectable 判定、click pick 集約、object / vertex / face rectangle candidate 抽出を移し始めた。selection 確定は `ObjectModeController` / `EditModeController` に寄せ始め、`main.js` には input state と controller 呼び分けが残っている
- import / export: file type 判定、gzip 判定、日時付き download filename 生成、Blob download、ModelAsset JSON / gzip JSON / GLB / glTF / Collada の読み込み入口、import entry 抽出、editor object 化、ModelAsset 生成、GLB 形式化、GLB / JSON / gzip JSON の保存実行は `ModelerImportExport.js` へ移し始めた。`main.js` には保存対象 geometry の決定、scene 差し替え、dirty state と message の更新が残っている
- mobile UI と入力制御: `MobileInputController.js` へ tap / double tap / long press、box select armed、ribbon flick、2 本指 view roll、pointer 抑止、gesture diagnostics を移し始めた。`main.js` には ribbon / status の DOM 反映、Safari の file picker 復帰対策、file operation の共通 error reporting、raw pointer diagnostics、canvas pointer handler と selection 確定の接続が残っている
- primitive 生成: Cube / Plane / Sphere / Torus / Cylinder / Cone / Double Cone の geometry 生成と face loop の仕様は `ModelerPrimitiveFactory.js` へ移した。`main.js` には mobile UI の分割数を factory へ渡す adapter が残る
- controller bridge / wrapper: `EditModeController`、`ObjectModeController`、`ViewController`、`ModelerCommandDispatcher` を既存 UI / keyboard / pointer 処理へ接続する薄い wrapper が残っている

### 分割中: ModelerPicking

`ModelerPicking.js` は着手済みである。目的は、pointer 座標と renderable state から pick result を返す純粋計算に近い処理を `main.js` から分離することである。

2026/05/24 の最初の分割では、screen ray 作成、object / face / vertex candidate の作成、triangle hit、front-facing 判定、visible pick 用 occlusion grid、object rectangle hit を `ModelerPicking.js` へ移し、`main.js` 側は既存の関数名を薄い wrapper として残した。続けて `selectByClientRect()` 内の object / vertex / face rectangle candidate 抽出と、click selection 用の `pickAtClientPoint(...)` も `ModelerPicking` へ移した。`ModelerPicking` は DOM event を直接受け取らず、client 座標、camera / projection 情報、renderable edit mesh state、object list、view option から pick result を返す。

特に vertex pick は、marker object の raycast ではなく、renderable edit mesh の vertex を screen 座標へ投影して pointer との距離で選ぶ仕様である。`ModelerPicking` へ分けるときも、Edit Mode 中に active object の古い vertices を読まないよう、renderable edit mesh state を明示的に受け取る API にする。

この段階では `ModelerPicking` へ selection の確定までは持たせない。tap が selection なのか transform confirm なのか、box select confirm なのかは mobile input state と関係するため、`main.js` が判断し、確定処理は `ObjectModeController` / `EditModeController` へ渡す。`ModelerPicking` は「何が pointer の下にあるか」を答える責務に限定する。Add Vertex についても、クリック位置から face または配置用 plane を決める camera 依存の処理は `main.js` に残し、確定後の undo / add vertex / selection / rebuild / message は `EditModeController.addVertexFromPick()` へ寄せた。

完了条件は、`main.js` の pointer handler が pick 計算の詳細を持たず、`pickAtClientPoint(...)`、`collectBoxSelectCandidates(...)` のような API から得た結果を mode / tool に応じて controller へ渡す形になることである。

### 分割中: ModelerImportExport

`ModelerImportExport.js` は着手済みである。目的は、file picker から得た file を ModelAsset entry または object list へ変換する処理と、保存用 asset / GLB / screenshot / download 処理を `main.js` から分離することである。

2026/05/24 の最初の分割では、日時付き download filename と Blob download を `ModelerImportExport.js` へ移した。続けて file name / MIME / gzip magic による形式判定、ModelAsset JSON / gzip JSON の読み込み、GLB / glTF / Collada を `WebgApp.loadModel()` 経由で ModelAsset へ正規化する入口も `ModelerImportExport.loadModelAssetFile()` へ移した。保存側は `saveModelAssetJson()`、`saveModelAssetJsonGz()`、`saveGlbBytes()` に download 実行と filename 採番を寄せた。さらに ModelAsset node からの import entry 抽出、node world matrix の解決、import entry から editor object への変換、編集 geometry から保存 / 表示用 ModelAsset を作る処理、GLB 形式化と GLB 保存実行も `ModelerImportExport.js` へ移した。`main.js` は保存対象 geometry を決め、dirty state と message を更新する。

file operation command から import / export helper を呼ぶ薄い adapter は整理を始めた。`openModelFilePicker()`、`loadSelectedModelFile()`、`runAsyncFileOperation()`、`runFileOperation()` は `main.js` に残し、DOM button と `ModelerCommandDispatcher` から同じ入口を使う。これは UI event、file input value reset、status message を扱う層であり、file format 変換を担当する `ModelerImportExport.js` へは入れない。import 後に scene を差し替える、undo snapshot を積む、既存 edit session を破棄する、message を出す、といった application state の変更も、最初は `main.js` または dispatcher 側に残す。

完了条件は、file 内容を読んで「取り込める object 群」または「保存する byte / text」を作る処理が独立し、scene state の差し替えと file format の parsing が混ざらないことである。特に iPhone Safari の file picker 復帰対策や status stage 表示は、UI 側の責務として分けて扱う。

### 分割中: ModelerRenderer

表示構築は行数削減効果が大きいが、WebGPU node、overlay cache、camera projection、marker dirty flag、scene rebuild の頻度制御が絡むため、小さく段階分割する。最初の分割として `ModelerRenderer.js` を作成し、object mesh node、selected face overlay node、旧 marker root、旧 grid root の寿命管理と Shape 生成を移した。続けて dirty flag の直接更新を `main.js` 内の専用関数へ集め、edge overlay の line-list buffer 構築を renderer へ移した。marker overlay については、`makeMarkerOverlayRenderData()` で投影済み marker data を作り、buffer 更新と draw を renderer へ移した。guide overlay についても、grid / axis / loop cut guide / Chain Select preview を line data へ変換し、view / projection matrix セットアップと buffer 更新、draw を renderer へ移した。次に進める場合は、projection / camera sync と onUpdate 周辺の接続を整理するか、renderer 分割をいったん止めてブラウザ確認しやすい単位として commit する。

完了条件は、`main.js` が「どの state が変わったので描画を要求するか」を決め、renderer が「その state をどう WebGPU / overlay へ反映するか」を担当することである。renderer が edit command や file import の意味を知る必要はない。

### TransformController の扱い

`TransformController` を長期的に独立 controller として残すかはまだ確定しない。編集モードの transform は active mesh object の編集操作であり、`EditModeController` 内の `EditTransformSession` として扱う方が責務は自然である。一方で、現在の `transformController.js` は pointer capture、desktop mouse、mobile touch segment、confirm / cancel、preview 更新をまとめて扱っており、すぐに移すと input regression を起こしやすい。

2026/05/24 の整理で、`operationContext` / `ctx` という名前は `transformServices` / `services` へ変更した。これは巨大な依存集合を正当化するためではなく、現在の `transformController.js` が scene / history、UI、camera、selection、edit geometry operation にまたがる service collection を受け取っていることを明示するためである。今後はこの `services` をさらに分け、少なくとも pointer session、history transaction、edit geometry operation、object origin transform を別の責務として見られるようにする。

同日の次段階で、transform 開始時に積む undo entry、開始時 snapshot、dirty state の復元は `beginTransformTransaction()`、`restoreTransformStartSnapshot()`、`rollbackTransformTransaction()` として `main.js` 側の history transaction service に寄せた。`TransformController` は transaction object を保持するだけで、`editor.undoStack` や `editor.dirty` を直接触らない。これにより、変形処理側では「開始した preview を戻す」「失敗または cancel で履歴を戻す」という意味だけを扱い、undo stack の深さや dirty state の整合性は scene / history 側の責務として追える。

次の方針は、transform の数学処理と pointer session 管理を分けて観察することである。move / rotate / scale / extrude / GG の geometry 更新と session state は `EditModeController` へ寄せたため、残る問題は「pointer event と history transaction をどの session が所有するか」である。`ModelerPicking` と mobile input 周辺を整理した後、pointer session を `EditModeController` 内へ移すか、pointer bridge だけを独立 helper として残すかを判断する。

### 当面の完了条件

次の一連の作業では、`main.js` の行数を単に減らすことではなく、読んだときの処理フローを明確にすることを完了条件にする。

- pointer input は、gesture / mobile state を見て「何をしたい操作か」を判断する
- pick 計算は、入力座標と scene / view state から「何が対象か」を返す
- command dispatch は、action id を controller method へ割り振る
- edit geometry は、`EditModeController` の edit session を正本として更新する
- object list と undo / redo は、`ModelerScene` が整合性を守る
- view state は、`ViewController` が保持し、実際の WebGPU / DOM 反映は renderer 側へ寄せる

この形まで進むと、`main.js` は app 初期化、DOM cache、WebgApp / shader / controller の接続、イベント登録、各 controller の wiring を読む file になり、編集 command の詳細は対応する controller や session の file で追えるようになる。
