# inside mmodeler 作業記録

## 2026/05/29 13:16 JST

### 目的または理由

`samples/mmodeler/main.js` の整理として、起動時の初期 cube 生成処理を既存の primitive 生成機構へ寄せる。

これまで `createInitialModel()` は、初期 cube の頂点と face を `main.js` 内で手作業で追加し、その後 `resetObjectState("Cube")` で単一 object 化していた。この処理は、すでに `ModelerPrimitiveFactory.js` が editable primitive object を生成する責務を持っている現在の設計と重複している。

また、初期 cube だけが `Y=0..2` の底面基準で、primitive 追加の cube は `Y=-1..1` の local origin 中心という違いがあった。mmodeler の Object Mode / Edit Mode 分離方針では、object local geometry は local origin を中心に持つ方が自然であり、初期 cube も `Y=-1..1` にそろえる方針とした。

### 作業内容

- `main.js` の `createInitialModel()` を、手書きの `addVertex()` / `addFace()` ではなく `ModelerPrimitiveFactory.js` の `buildPrimitiveObject("cube", DEFAULT_OBJECT_ID)` を使う形に変更した。
- 生成した cube object を `replaceObjectsAndActivate()` へ渡し、Object Mode の active object として初期化する形にした。
- 初期 cube の座標は `ModelerPrimitiveFactory.js` の仕様に従い、`Y=-1..1`、local origin 中心になった。
- `createInitialModel()` から旧 edit buffer へ直接頂点・面を積む処理を削除した。
- 上記変更により `main.js` 側の `addVertex()` / `addFace()` wrapper が未使用になったため削除した。
- `ModelerScene.js` の `resetObjectState()` は参照がなくなり、旧 edit buffer 前提の API になったため削除した。

### 確認

- `main.js` を ES module として構文チェックした。
- `ModelerScene.js` を ES module として構文チェックした。
- `resetObjectState` / `addVertex` / `addFace` の参照漏れがないことを確認した。

### 補足

ブラウザ上での WebGPU 実描画確認は未実施。初期 cube の見た目は、従来の底面基準から local origin 中心へ変わる。

## 2026/05/29 13:26 JST

### 目的または理由

`samples/mmodeler/main.js` の 2226 行付近から 2415 行付近に、Edit Mode 用の topology / winding / selection normal 処理が残っていた。

これらの処理は、active mesh の face 法線、vertex loop の向き、隣接 face を使った winding 調整、選択 face からの代表法線計算を扱うものであり、責務としては `EditModeController` が所有する edit session geometry に属する。現在の `EditModeController.js` には同等の `computeFaceNormal()`、`computeNormalForVertexIds()`、`reverseVertexLoop()`、`getLoopEdgeDirection()`、`shouldFlipLoopAwayFromOrigin()`、`orientLoopByAdjacentFaces()`、`computeSelectionNormal()` がすでに存在していたため、`main.js` 側の実装は重複した古い経路になっていた。

### 作業内容

- `main.js` から Edit Mode 用の topology / winding helper 群を削除した。
- 削除した対象は、`computeFaceNormal()`、`computeNormalForVertexIds()`、`reverseVertexLoop()`、`getLoopEdgeDirection()`、`shouldFlipLoopAwayFromOrigin()`、`orientLoopByAdjacentFaces()`、`orientAllFacesConsistently()`、`computeSelectionNormal()`。
- `ObjectModeController` へ注入していた `orientAllFacesConsistently` は未使用だったため、constructor 引数と保持 property を削除した。
- `main.js` 側の `new ObjectModeController(...)` から `orientAllFacesConsistently` の注入を削除した。

### 確認

- `main.js` 内に該当 helper の参照が残っていないことを確認した。
- topology / winding / selection normal の該当処理が `EditModeController.js` 側に残っていることを確認した。
- `main.js` を ES module として構文チェックした。
- `ObjectModeController.js` を ES module として構文チェックした。

### 補足

この整理により、Edit Mode の geometry 判断は `EditModeController` 側へ集約され、`main.js` は接続役に近づいた。ブラウザ上での WebGPU 実描画確認は未実施。

## 2026/05/29 13:40 JST

### 目的または理由

`main.js` の `selection and transform targets` セクションには、Edit Mode の選択 vertex / face の実体取得、active vertex 群の決定、highlight 対象 vertex の決定、最後に選択した vertex の表示文字列作成が残っていた。

これらは Edit Mode の edit session geometry と selection state を読む処理であり、`main.js` より `EditModeController` が所有する方が自然である。また、Object Mode transform の対象 object 決定も object selection と active object を読む処理なので、`ObjectModeController` へ寄せる方が責務境界に合う。

### 作業内容

- `EditModeController.js` に `getSelectedVertexObjects()`、`getHighlightedVertexIds()`、`getLastSelectedVertex()`、`getLastSelectedVertexLabel()` を追加した。
- 既存の `EditModeController.getActiveVertexObjects()`、`getSelectedFaceObjects()`、`getVertexById()`、`getFaceById()` と合わせて、Edit Mode の選択・参照処理を controller 側へ集約した。
- `ObjectModeController.js` に `getTransformTargetObjects()` を追加した。
- `main.js` の `selection and transform targets` セクションを削除した。
- `main.js` 側の呼び出しを、`editModeController.getActiveVertexObjects()`、`editModeController.getSelectedFaceObjects()`、`editModeController.getHighlightedVertexIds()`、`editModeController.getLastSelectedVertexLabel()`、`editModeController.getVertexById()` へ置き換えた。
- `transformController` へ渡す Object Mode transform 対象取得も、`objectModeController.getTransformTargetObjects()` を呼ぶ形に変更した。
- すでに未使用だった `getTransformTargetVertexObjects()` と、そこからしか使われていなかった `getSelectedObjectVertexObjects()` を削除した。

### 確認

- `main.js` から `selection and transform targets` セクションが消えていることを確認した。
- `main.js` に `getTransformTargetVertexObjects()`、`getSelectedObjectVertexObjects()`、旧 selection helper の定義が残っていないことを確認した。
- `main.js`、`EditModeController.js`、`ObjectModeController.js` を ES module として構文チェックした。

### 補足

loop cut preview のように screen 座標、camera、active object transform が絡む処理は、まだ `main.js` 側で controller の getter を呼んでいる。これは edit geometry の所有ではなく、view / input / projection との接続処理として残した。ブラウザ上での WebGPU 実描画確認は未実施。

## 2026/05/29 13:49 JST

### 目的または理由

`main.js` の `transform and keyboard command bridges` セクションには、`transformController` や `EditModeController` の method をそのまま返すだけの薄い wrapper が残っていた。

こうした中継だけの関数は、実際の処理がどの module にあるのかを読み取りにくくする。`main.js` に残すべきなのは、複数 module の状態を調停する処理、または UI event と controller を接続する処理に限定する方が、責務境界を追いやすい。

### 作業内容

- `getTransformModeLabel()`、`setTransformAxis()`、`cancelTransformMode()`、`confirmTransformMode()`、`applyTransformDrag()`、`installTransformPointerBridge()` を削除し、呼び出し側を `transformController` の direct call に変更した。
- `moveActiveVerticesBy()`、`moveSelectionByScreenKeys()`、`moveSelectionByNormalKey()`、`scaleSelectionByKeyboard()` を削除し、keyboard handler から `EditModeController` の direct call に変更した。
- `setTool()` と `clearSelection()` も単純な中継だったため削除し、DOM handler / keyboard handler / mode 切り替えから `editModeController` を直接呼ぶ形にした。
- セクション名を `transform and keyboard command bridges` から `keyboard handlers` に変更した。
- `setTransformMode()` は、transform 開始後に palette で事前選択した軸制限を反映し、mobile palette を閉じる UI 調停を持つため残した。

### 確認

- `main.js` を ES module として構文チェックした。
- 削除した wrapper 名の定義が `main.js` に残っていないことを確認した。

### 補足

`deleteSelected()`、`selectAllForCurrentMode()`、`invertSelectionForCurrentMode()`、`selectXNegativeForCurrentMode()` は、transform / preview の cancel と現在 mode による controller 振り分けを行うため、単純中継ではなく command 調停として残している。ブラウザ上での WebGPU 実描画確認は未実施。

## 2026/05/29 14:03 JST

### 目的または理由

`main.js` の 2891 行から 3168 行付近には、Edit Mode に見える処理と、Object Mode / View / input adapter の処理が混在していた。無理に移動すると camera、projection、active object transform、pointer 座標の依存を `EditModeController` へ持ち込む可能性があるため、役割を確認しながら低リスクな整理だけを行った。

特に Preview 系の `updateLoopCutPreviewFromPointer()` と `updateChainSelectPreviewFromPointer()` は、edit session の preview state を更新しているように見えるが、実際には pointer の client 座標、現在 camera の view-projection、active object の local-to-world 変換を使って screen-space 候補を作り、それを `EditModeController` へ渡す adapter である。このため、現時点では `main.js` に残す意味があると判断した。

### 作業内容

- `buildJoinedObject()` を `main.js` から `ObjectModeController.js` へ移した。
- `ObjectModeController` には `localToWorldPosition` を注入し、join 時の local-to-world 変換と vertex / face ID 再採番を controller 側で行う形にした。
- `main.js` の `new ObjectModeController(...)` から `buildJoinedObject` 注入を外し、代わりに `localToWorldPosition` を渡すようにした。
- `confirmLoopCutPreview()` と `confirmChainSelectPreview()` は `EditModeController` への単純中継だったため削除し、呼び出し側を `editModeController.confirmLoopCutPreview()` / `editModeController.confirmChainSelectPreview()` の direct call に変更した。

### 確認

- `main.js` を ES module として構文チェックした。
- `ObjectModeController.js` を ES module として構文チェックした。
- `main.js` に `buildJoinedObject()`、`confirmLoopCutPreview()`、`confirmChainSelectPreview()` の wrapper 定義が残っていないことを確認した。

### 補足

`orderVertexIdsForFaceFromView()` は Edit Mode の make face 用だが、camera basis と eye position に依存する view-aware ordering なので、現時点では `main.js` から `EditModeController` へ注入する形を維持した。将来さらに整理するなら、camera / projection 依存の edit preview adapter を別 module に切り出すのがよい。ブラウザ上での WebGPU 実描画確認は未実施。

## 2026/05/29 14:14 JST

### 目的または理由

`main.js` の関数配置とコメントが、直近の分割状況に合っているかを確認した。大きな責務移動はすでに十分進んでいるため、今回は関数の並び順を大きく変えず、古い説明や読み手を迷わせるコメントを中心に修正した。

また、`mmodeler_design.md` の現在状況が 2026/05/24 時点の記述を含んだままだったため、2026/05/29 時点の `main.js` / controller 分割状態に合わせて更新した。

### 作業内容

- `main.js` 冒頭の日付と Sections コメントを現在の構成に合わせて更新した。
- `webgmodeler` と書かれていた古い呼称を `mmodeler` に修正した。
- 冒頭の「編集データを唯一の正とする」説明を、Object Mode の object state と Edit Mode の edit session の正本分離に合わせて書き直した。
- undo / redo の後に `information overlays and object geometry helpers` セクション見出しを追加し、object info / coordinate overlay / object geometry helper のまとまりを読みやすくした。
- `deleteSelected()` のコメントを、Edit Mode 専用ではなく現在 mode に応じた削除入口として修正した。
- `cancelLoopCutPreview()` の直前に残っていた X Mirror 用の古いコメントを削除した。
- selected face overlay 用 ModelAsset の meta 名を `mmodeler_selection` に変更した。
- `mmodeler_design.md` の更新日を 2026/05/29 に変更した。
- `ModelerCommandDispatcher`、`ObjectModeController`、`main.js に残る責務` の説明を、現在の分割状態に合わせて更新した。

### 確認

- `main.js` を ES module として構文チェックした。
- `mmodeler_design.md` と `main.js` から、古い `webgmodeler`、`resetObjectState`、`selection and transform targets`、`transform and keyboard command bridges` などの不要な記述が残っていないことを確認した。

### 補足

関数の並び順は、現状の大枠で十分整理されていると判断した。`main.js` は app / UI / camera / projection / controller wiring / event handling の接続点として読める構成になっており、Preview 系 adapter は camera / projection 依存を controller に持ち込まない境界として残している。ブラウザ上での WebGPU 実描画確認は未実施。

## 2026/05/29 14:48 JST

### 目的または理由

`mmodeler_design.md` に、2026/05/29 時点の `samples/mmodeler` の module 構成と役割分担を、今後の整理作業で参照できる粒度で明確に記録する必要があった。

直近の整理で `main.js` から Edit Mode / Object Mode / picking / transform / import-export / rendering の責務がかなり分離されたため、古い「これから分割する」目線だけではなく、現在どの module が何を所有し、何を担当しないかを明文化した。

### 作業内容

- `mmodeler_design.md` の TODO 節に `現状のモジュール構成と責務分担` を追加し、実ファイル構成に沿って詳細な責務一覧を書いた。
- `Application wiring` として、`main.js`、`modelerConfig.js`、`math3d.js` の役割を整理した。
- `Scene and mode controllers` として、`ModelerScene.js`、`EditModeController.js`、`ObjectModeController.js`、`ViewController.js` の所有 state と境界を整理した。
- `Commands and UI state` として、`CommandPalette.js`、`ModelerCommandDispatcher.js`、`MobileInputController.js`、`BoxSelectSession.js` の担当範囲を整理した。
- `Picking and preview adapters` として、`ModelerPicking.js` と loop cut / Chain Select preview adapter の責務境界を整理した。
- `Transform`、`Rendering`、`Geometry creation and file IO`、`Documentation and assets` の各節を追加し、`transformController.js`、`ModelerRenderer.js`、overlay renderer、`ModelerPrimitiveFactory.js`、`ModelerImportExport.js`、`glbExporter.js`、`blender_modelasset_io.py` などの役割を記載した。

### 確認

- 追加した節の前後を読み、後続の `main.js に残る大きな責務`、`分割中: ModelerPicking`、`分割中: ModelerImportExport`、`分割中: ModelerRenderer` と矛盾しないことを確認した。
- `mmodeler_design.md` 内に、直近の整理で削除済みの古い見出しや旧称が残っていないことを確認した。

### 補足

今回の変更は Markdown ドキュメントのみであり、JavaScript の実装は変更していない。そのため、追加の構文チェックやブラウザ上での WebGPU 実描画確認は実施していない。

## 2026/05/29 19:35 JST

### 目的または理由

Sculpt Mode の `Brsh` から開く brush 設定 overlay で、数値入力欄をクリックすると一瞬 cursor が表示された直後に消え、radius / strength を直接入力できない問題が報告された。

mmodeler は canvas 操作を安定させるために document / window / canvas に広い keyboard / pointer handler を持っている。また mobile profile では長押しや page gesture を抑止する CSS / event guard も使っている。これらが coordinate overlay の input にも影響すると、text input の focus や caret が canvas 操作側へ奪われる可能性があるため、入力欄を明示的に text editing 領域として分離した。

### 作業内容

- `samples/mmodeler/main.js` に `isTextEntryTarget()` を追加し、`input`、`textarea`、`select`、`contenteditable` を text entry target として判定できるようにした。
- `focusModelerCanvas()` で現在の active element が text entry target の場合は canvas focus を取り戻さないようにした。
- camera key bridge の `keydown` / `keyup` capture handler で、event target が text entry target の場合は処理しないようにした。これにより、input 内の arrow key や編集操作を camera 操作として奪わないようにした。
- coordinate overlay の input に `pointerdown`、`pointerup`、`click`、`touchstart`、`touchend`、`beforeinput`、`input` の propagation stop を追加し、overlay 内の text editing event が canvas / document 側の操作へ伝播しにくいようにした。
- `samples/mmodeler/index.html` の `.coordinate-overlay` と `.coordinate-row input` の `touch-action` を `auto` に変更し、input では `-webkit-user-modify: read-write` も指定した。mobile Safari 系でも数値入力欄を通常の text input として扱いやすくするための調整である。

### 確認

- `node --input-type=module --check < samples/mmodeler/main.js` で `main.js` の構文チェックを行い、成功した。

### 補足

ブラウザ上の WebGPU / mobile touch 実機確認は未実施。今回の修正は、input focus を奪う可能性がある global handler と touch gesture 抑止の影響を coordinate overlay input から切り離す目的のもの。

## 2026/05/29 19:44 JST

### 目的または理由

前回の focus / key bridge 対策後も、Sculpt brush 設定の数値入力欄に入力できず、クリック時に一瞬 cursor が出てすぐ消える問題が継続していた。

追加で確認したところ、mobile Safari 対策として入れている `installSafariCalloutGuards()` が `selectstart` / `dragstart` / `contextmenu` guard を coordinate overlay や input にも登録していた。また CSS の末尾にある全体指定 `* { -webkit-touch-callout: none; }` が、coordinate overlay input の `-webkit-touch-callout: default` を後から上書きしていた。これらは text input の caret / selection に直接関係するため、input focus だけでなく text selection 側を守る必要があった。

### 作業内容

- `installSafariCalloutGuards()` の `guardTargets` から coordinate overlay、overlay title / hint、Apply / Close button、coordinate input fields を外した。
- `selectionchange` handler で `document.activeElement` が text entry target の場合は `removeAllRanges()` を実行しないようにした。input 編集中の caret / selection を global selection cleanup が壊さないようにするためである。
- `isCoordinateOverlayControl()` と `isTextEntryTarget()` を、`target` が Element でない場合にも `parentElement` から近い要素を探す形へ強化した。
- CSS 末尾の全体 `-webkit-touch-callout: none` 指定の後に、`.coordinate-overlay` とその子要素では `user-select: text`、`-webkit-user-select: text`、`-webkit-touch-callout: default` を再指定した。
- coordinate overlay input に `focus`、`focusin`、`focusout` の propagation stop も追加した。

### 確認

- `node --input-type=module --check < samples/mmodeler/main.js` で `main.js` の構文チェックを行い、成功した。

### 補足

今回の修正は、前回よりも text input の caret / selection を直接妨げる可能性がある処理を外す内容である。ブラウザ上の WebGPU / mobile touch 実機確認は未実施。

## 2026/05/30 00:18 JST

### 目的または理由

Sculpt Mode の brush 設定で `Dir` 表示は不要になり、代わりに brush の減衰形状を選べるようにする必要があった。減衰形状は中心からの距離に応じた強度変化の名前として `Sphere`、`Triangle`、`Peak`、`Flat` を扱う。

また command palette は Sculpt Mode 中に Object / Edit 用 command が多く残っており、brush 操作に必要な command が埋もれていた。Sculpt Mode では Draw / Blur / Grab / Pinch、方向、Undo / Redo、表示系だけをまとめた専用 palette に切り替える方針とした。

### 作業内容

- `samples/mmodeler/index.html` の coordinate overlay 3 行目に `coordinateFalloff` select を追加した。通常の vertex coordinate 編集では従来通り Z input を表示し、Sculpt brush 設定時だけ Z input を隠して falloff select を表示する。
- `Brsh` overlay の 3 行目 label を `Dir` から `Shape` に変更し、`Sphere`、`Triangle`、`Peak`、`Flat` を選べるようにした。
- `samples/mmodeler/SculptModeController.js` の falloff を新しい名称へ整理した。
  - `Flat`: 距離で減衰しない。
  - `Triangle`: 距離に比例して減衰する。
  - `Peak`: 中心から離れると早く減衰する。
  - `Sphere`: 半球状の減衰として扱う。
- brush type を `draw`、`blur`、`grab`、`pinch` に整理した。既存の `inflate` / `smooth` 指定は後方互換として `draw` / `blur` へ寄せる。
- Draw は法線方向、Blur は隣接頂点平均、Grab は cursor 移動方向、Pinch は cursor center 方向へ頂点を移動するようにした。
- brush strength は 1.0 を強めの入力値として扱えるよう、内部で brush radius や type ごとの scale を掛けて移動量へ変換する形にした。初期値は 0.25 とした。
- `samples/mmodeler/CommandPalette.js` に Sculpt Mode 専用の 1 page palette を追加した。Sculpt Mode では通常の 4 page palette ではなく、Draw / Blur / Grab / Pinch、Dir+ / Dir-、Brsh、Pr、Wire、Smth、Undo、Redo、Lens を表示する。
- Sculpt Mode 専用 palette は 5 column 表示に切り替えるため、`index.html` に 追加 palette button slot と `.command-palette.sculpt-palette` の CSS を追加した。
- `samples/mmodeler/ModelerCommandDispatcher.js` と `main.js` に `sculpt-draw`、`sculpt-blur`、`sculpt-grab`、`sculpt-pinch` の dispatch と active 表示を追加した。

### 確認

- `node --input-type=module --check < samples/mmodeler/main.js` を実行し、成功した。
- `node --input-type=module --check < samples/mmodeler/CommandPalette.js` を実行し、成功した。
- `node --input-type=module --check < samples/mmodeler/ModelerCommandDispatcher.js` を実行し、成功した。
- `node --input-type=module --check < samples/mmodeler/SculptModeController.js` を実行し、成功した。

### 補足

ブラウザ上の WebGPU / mobile touch 実機確認は未実施。Sculpt Mode 専用 palette は user 指定の配置に合わせて 5 column として実装した。

## 2026/05/30 00:34 JST

### 目的または理由

Sculpt Mode 専用 command palette は 5 column ではなく、通常 palette と同じ 4x4 が正しいと修正指示があった。また Sculpt Mode 中は empty double tap を box select や command palette 表示ではなく、camera 操作と brush stroke 操作の切り替え toggle として使いたい。

Sculpt Mode では selection を使わないため、empty double tap を box select に割り当てる意味が薄い。既存の `↑` button と同じ brush gate を empty double tap からも切り替えられるようにした。

### 作業内容

- `samples/mmodeler/CommandPalette.js` の Sculpt Mode 専用 palette を 4x4 に修正した。
  - 1 行目: `Draw`, `-`, `Brsh`, `Pr`
  - 2 行目: `Blur`, `-`, `-`, `Wire`
  - 3 行目: `Grab`, `Sclp+`, `Undo`, `Smth`
  - 4 行目: `Pinch`, `Sclp-`, `Redo`, `Lens`
- `samples/mmodeler/index.html` から Sculpt 専用 5 column CSS と余分な palette button slot を削除した。
- `samples/mmodeler/MobileInputController.js` の empty double tap 処理に、Sculpt Mode 専用 callback `handleSculptEmptyDoubleTap` を先に呼ぶ分岐を追加した。
- `samples/mmodeler/main.js` に `toggleSculptBrushInputFromEmptyDoubleTap()` を追加し、Sculpt Mode 中の empty double tap で `mobileInput.selectionShiftActive` を切り替えるようにした。
- empty double tap で brush 側になった場合は mobile orbit を止め、camera 側に戻した場合は mobile orbit を有効にするようにした。

### 確認

- `node --input-type=module --check < samples/mmodeler/main.js` を実行し、成功した。
- `node --input-type=module --check < samples/mmodeler/CommandPalette.js` を実行し、成功した。
- `node --input-type=module --check < samples/mmodeler/MobileInputController.js` を実行し、成功した。

### 補足

ブラウザ上の WebGPU / mobile touch 実機確認は未実施。Sculpt Mode 以外の empty double tap は従来どおり box select / empty scene palette の経路を維持している。

## 2026/05/30 00:41 JST

### 目的または理由

Sculpt Mode 専用 palette の方向指定は `Dir+` / `Dir-` ではなく、以前の sculpt 入口表記に近い `Sclp+` / `Sclp-` にしたい。一方で通常 palette 側では `Dir-` は不要で、`Dir+` 相当の command は Sculpt Mode への入口として `Sclpt` と表示したい。

同じ action id `sculpt-plus` を通常 palette と Sculpt Mode 専用 palette の両方で使っているため、palette context に応じて表示 label を出し分ける必要があった。

### 作業内容

- `samples/mmodeler/CommandPalette.js` の通常 action label で `sculpt-plus` を `Sclpt` 表示に変更した。実行内容は従来通り normal plus 方向の sculpt brush を設定して Sculpt Mode に入る。
- 通常 palette から `sculpt-minus` を削除し、該当 slot を `undefined` にした。
- Sculpt Mode 専用 palette では `sculpt-plus` を `Sclp+`、`sculpt-minus` を `Sclp-` と表示するよう、`getCommandActionLabel(action, context)` に `sculptPalette` context を追加した。
- `CommandPalette.render()` から label 取得時に `sculptPalette` context を渡すようにした。

### 確認

- `node --input-type=module --check < samples/mmodeler/CommandPalette.js` を実行し、成功した。

### 補足

今回の変更は command palette の表示と通常 palette の配置変更のみであり、brush の動作ロジックは変更していない。ブラウザ上の実機確認は未実施。

## 2026/05/30 00:56 JST

### 目的または理由

Sculpt Mode の brush cursor は、近傍 surface を認識したかどうかを楕円の細さで示していたが、楕円の向きは固定だった。そのため、斜めの面に当たっている場合でも、surface の傾き方向と brush cursor の見た目が一致しにくかった。

厳密な 3D circle projection までは不要だが、cursor 近傍の法線を camera screen basis へ投影し、その方向に合わせて楕円を回転させれば、表面の傾きに沿った feedback になる。

### 作業内容

- `samples/mmodeler/overlay2dRenderer.js` の `addMarker()` に `rotation` 引数を追加し、screen-space の円 / 楕円 marker を回転した quad として描けるようにした。
- `samples/mmodeler/main.js` に `localToWorldDirection()` を追加し、object local normal を world direction に戻せるようにした。
- `samples/mmodeler/main.js` に `computeSculptPreviewRotation()` を追加した。
  - brush hit の local normal を world normal に変換する。
  - camera の right / up 方向との dot から、normal が画面上でどちらへ傾いているかを求める。
  - 投影された normal 方向を楕円の短軸方向とみなし、major axis はそれに直交する角度として `rotation` を計算する。
- `drawSculptPreviewOverlayPass()` で上記 rotation を `SculptModeController.getBrushPreview()` に渡し、さらに `overlay2d.addMarker()` に渡すようにした。

### 確認

- `node --input-type=module --check < samples/mmodeler/main.js` を実行し、成功した。
- `node --input-type=module --check < samples/mmodeler/overlay2dRenderer.js` を実行し、成功した。

### 補足

今回の変更は近似 preview の回転対応であり、3D 空間の円を厳密に projection するものではない。ブラウザ上の WebGPU / mobile touch 実機確認は未実施。

## 2026/05/30 01:06 JST

### 目的または理由

Sculpt Mode の brush cursor size は `brushRadius * 72px` を 18px から 84px に clamp する簡易式で決めていた。そのため、実際の 3D brush radius が画面上でどの程度の大きさに見えるかとは同期しておらず、特に camera distance や projection によって実際より小さく見えることがあった。

brush cursor は実際の影響半径に近い feedback にしたいため、hit point と、surface に沿って brush radius だけ離した点を同じ viewProjection で投影し、その screen distance から cursor radius を決める方式に変更した。

### 作業内容

- `samples/mmodeler/main.js` の `drawSculptPreviewOverlayPass()` で、固定式 `brushRadius * 72px` による cursor 半径計算をやめた。
- `computeSculptPreviewRadiusNdc()` を追加した。
  - hit point の local position を world position に変換する。
  - hit normal を world normal に変換する。
  - camera の right / up と法線の画面上方向から、楕円の major axis に近い surface tangent を作る。
  - hit point からその tangent 方向へ `brushRadius * objectScale` だけ離した world point を作る。
  - center point と edge point を viewProjection で NDC に投影し、screen pixel distance を cursor radius に変換する。
- hit していない場合や投影できない場合は、従来と同じ 18px の fallback radius を使うようにした。
- 表示が完全に消えないよう、投影結果の半径は最低 6px にしている。

### 確認

- `node --input-type=module --check < samples/mmodeler/main.js` を実行し、成功した。

### 補足

今回の変更により、brush cursor size は camera distance / projection / object scale に追従する。ブラウザ上の WebGPU / mobile touch 実機確認は未実施。

## 2026/05/30 01:12 JST

### 目的または理由

通常 command palette の 3 枚目に残っていた `Brsh` は、Sculpt Mode 専用 palette にも存在するため通常 mode では不要になった。通常 palette では Sculpt Mode への入口を `Sclpt` に寄せ、brush 設定は Sculpt Mode に入ってから行う方が役割が分かりやすい。

### 作業内容

- `samples/mmodeler/CommandPalette.js` の通常 command palette 3 枚目から `sculpt-brush` を削除し、該当 slot を `undefined` に変更した。
- Sculpt Mode 専用 palette の `Brsh` はそのまま維持した。

### 確認

- `node --input-type=module --check < samples/mmodeler/CommandPalette.js` を実行し、成功した。

### 補足

今回の変更は command palette の表示配置のみであり、brush 設定 overlay や Sculpt Mode の動作は変更していない。ブラウザ上の実機確認は未実施。

## 2026/05/30 01:14 JST

### 目的または理由

Sculpt Mode と command palette の実装が進み、`README.md` / `README.en.md` の説明が古くなっていた。特に通常 command palette から `Brsh` が削除されたこと、通常 palette の Sculpt 入口が `Sclpt` になったこと、Sculpt Mode 専用 palette、brush type、falloff shape、empty double tap の動作、brush cursor の表示方式を反映する必要があった。

### 作業内容

- `samples/mmodeler/README.md` を更新した。
  - mobile gesture の double tap 説明に、Sculpt Mode 中の empty double tap は camera / brush 操作 toggle になることを追加した。
  - command palette の概要に、Object / Edit Mode は 4 page、Sculpt Mode は専用 1 page palette へ切り替わることを記載した。
  - 第2ページの Sculpt 入口を `Sclpt` として説明し、通常 palette の `Sclp-` 説明を削除した。
  - 第3ページから通常 palette の `Brsh` 説明を削除した。
  - Sculpt Mode 専用 palette の Draw / Blur / Grab / Pinch / Brsh / Sclp+ / Sclp- / Undo / Redo / display 系 command を追加した。
  - Sculpt Mode 詳細に brush type、direction、falloff shape、empty double tap toggle、rotated ellipse cursor、projected brush radius、X Mirror を記載した。
  - Box Select の例外として、Sculpt Mode では empty double tap が camera / brush toggle になることを記載した。
- `samples/mmodeler/README.en.md` を同じ内容で更新した。

### 確認

- `README.md` / `README.en.md` 内を検索し、通常 palette の古い `Brsh` 説明や通常 palette の `Sclp-` 説明が残っていないことを確認した。
- Sculpt Mode 専用 palette 側には `Brsh`、`Sclp+`、`Sclp-` の説明が残っていることを確認した。

### 補足

今回の変更は Markdown ドキュメントのみであり、JavaScript の実装は変更していない。そのため、構文チェックやブラウザ上の実機確認は実施していない。

## 2026/05/29 16:31 JST

### 目的または理由

`SculptModeController.js` を mmodeler へ接続する段階に入った。今回は一度に完成 UI を作るのではなく、Sculpt Mode が editor mode として存在し、Command Palette / mobile flick / mobile `↑` button / canvas pointer stroke / preview overlay へ最小限つながることを目的にした。

既存の Edit Mode / Object Mode の操作を壊さないため、Sculpt Mode では selection を使わず、active object の vertices を直接変更する入口だけを追加した。brush type、radius、strength の専用 UI はまだ作らず、`SculptModeController` の既定値を使う。

### 作業内容

- `modelerConfig.js` に `EDITOR_MODE_SCULPT` を追加し、`EDITOR_MODES` に登録した。
- `main.js` で `SculptModeController` を import / instantiate し、`sculptModeController` として保持するようにした。
- `setEditorMode()` に Sculpt Mode 分岐を追加し、Edit Mode session を抜けて active object geometry を Sculpt Mode の対象にするようにした。
- Sculpt Mode に入った直後は mobile `↑` button を inactive にし、camera orbit を優先するようにした。
- `CommandPalette.js` に `mode-sculpt` action を追加し、3 枚目の空き slot から Sculpt Mode へ入れるようにした。
- `ModelerCommandDispatcher.js` に `mode-sculpt` の dispatch を追加した。
- `MobileInputController.js` の flick 判定を拡張し、mobile ribbon 上の上方向 flick で Sculpt Mode へ入れるようにした。stroke 中や transform 中は flick shortcut を受け付けない。
- Sculpt Mode 中の `↑` button は selection shift ではなく `brush stroke armed` として扱い、active の間だけ一本指 drag を sculpt stroke に流すようにした。
- canvas pointer handler に Sculpt Mode 分岐を追加し、`beginStroke()` / `applyStrokeSample()` / `endStroke()` を pointerdown / pointermove / pointerup へ接続した。
- stroke 開始時に `pushUndo("sculpt stroke")` を積み、stroke 中の cancel は `SculptModeController` の開始 snapshot 復元を使う構成にした。
- active object surface pick から local hit point と face normal を求め、Sculpt brush の center / normal として渡す helper を `main.js` に追加した。
- Sculpt Mode の preview として、cursor screen position と hit normal から近似 ellipse を `Overlay2DRenderer` で描く `drawSculptPreviewOverlayPass()` を追加した。
- `mmodeler_design.md` の `SculptModeController.js` 説明を、予定 module ではなく現在接続済みの module として更新した。

### 確認

- `main.js` を ES module として構文チェックした。
- `ModelerCommandDispatcher.js` を ES module として構文チェックした。
- `MobileInputController.js` を ES module として構文チェックした。
- `CommandPalette.js` を ES module として構文チェックした。
- `modelerConfig.js` を ES module として構文チェックした。
- `SculptModeController.js` を ES module として構文チェックした。
- `EDITOR_MODE_SCULPT`、`mode-sculpt`、Sculpt stroke helper、Sculpt preview、mobile flick service が各 file に追加されていることを確認した。

### 補足

今回の接続は初期接続であり、brush type / radius / strength を操作する専用 UI はまだ作っていない。Sculpt Mode のブラウザ実機操作、WebGPU 描画、mobile touch 操作の確認も未実施である。

## 2026/05/29 17:31 JST

### 目的または理由

Sculpt Mode の動作確認で、ブラシの効き方が強すぎることが分かったため、既定 brush strength を現在の 5% 程度へ下げる必要があった。

また、上方向 flick の説明で `ribbon` と呼んでいた領域が、現状の `index.html` には存在しないことを確認した。`main.js` と `MobileInputController.js` には ribbon 前提の名前が残っているが、現在の mobile DOM には左側の view dock、左上の `↑` button、command palette、canvas がある。したがって flick shortcut の対象を実在する UI に合わせる必要があった。

### 作業内容

- `SculptModeController.js` の `DEFAULT_BRUSH_STRENGTH` を `0.08` から `0.004` に変更し、既定の brush 変形量を 5% に下げた。
- `MobileInputController.js` の raw flick 判定対象を、存在しない `.mobile-ribbon` だけではなく、既存の `.view-dock` と canvas 下端にも広げた。
- canvas 下端から始まる flick は、canvas 高さの 16% または 48px から 96px の範囲を下端 gesture area として扱うようにした。
- `mmodeler_design.md` の Sculpt Mode flick 入口説明を、`mobile ribbon / canvas edge` から `view dock または canvas 下端` に修正した。
- `mmodeler_design.md` に、現状の `index.html` には `.mobile-ribbon` がないため、flick shortcut の対象を既存 UI に置くことを明記した。

### 確認

- `index.html` に `.mobile-ribbon`、`ribbon-header`、`ribbon-action` が存在せず、`mobileSelectionShift` と `view-dock` が存在することを確認した。

### 補足

今回の変更後の操作は、Command Palette の `Scpt` または canvas 下端 / view dock からの上方向 flick で Sculpt Mode へ入り、`↑` button を active にした状態で stroke する想定である。ブラウザ上での再確認はまだ実施していない。

## 2026/05/29 17:37 JST

### 目的または理由

Sculpt Mode への入口と brush の法線方向指定を、Command Palette 2 枚目から直接行えるようにする必要があった。既存の 2 枚目には `Add` と `Del` が縦に並んでおり、その下の空き slot を使えば、編集系 command のまとまりの中で `Sclp+` / `Sclp-` を見つけやすい。

`Sclp+` は法線方向へ膨らませる brush、`Sclp-` は法線逆方向へ凹ませる brush とし、どちらも Sculpt Mode への移行を兼ねる方針にした。

### 作業内容

- `CommandPalette.js` に `sculpt-plus` / `sculpt-minus` action label を追加した。
- Command Palette 2 枚目の `Add` / `Del` と同じ列の下に、`Sclp+` / `Sclp-` を配置した。
- `ModelerCommandDispatcher.js` に `setSculptBrushDirection` callback を追加し、`sculpt-plus` / `sculpt-minus` action を dispatch できるようにした。
- `main.js` に `setSculptBrushDirection(direction)` を追加し、現在の brush strength の絶対値を維持したまま符号だけを `+` / `-` に切り替え、Sculpt Mode へ移行するようにした。
- mobile action enabled / active 判定に `sculpt-plus` / `sculpt-minus` を追加し、active 表示で現在の法線方向符号が分かるようにした。
- `mmodeler_design.md` の Sculpt Mode 設計に、`Sclp+` / `Sclp-` の役割と配置を追記した。

### 確認

- `CommandPalette.js` を ES module として構文チェックした。
- `ModelerCommandDispatcher.js` を ES module として構文チェックした。
- `main.js` を ES module として構文チェックした。
- `sculpt-plus` / `sculpt-minus` / `setSculptBrushDirection` が各 file に追加されていることを確認した。

### 補足

今回の変更では brush strength の絶対値や radius を変更する UI はまだ追加していない。`Sclp+` / `Sclp-` は Sculpt Mode への移行と法線方向の符号指定だけを担当する。

## 2026/05/29 17:45 JST

### 目的または理由

既存の `M` / X Mirror を Sculpt Mode でも有効にできるか確認し、Sculpt Mode の brush stroke にも左右対称適用を追加することにした。

Sculpt Mode は vertex / face selection を持たないため、Edit Mode のような mirror vertex pair selection ではなく、brush sample の center と normal を active object local 座標で X 反転して、同じ brush をもう一度適用する方式が自然である。

### 作業内容

- `SculptModeController.js` に `mirrorX3()` helper を追加した。
- `applyStrokeSample()` に `xMirror` option を追加し、`xMirror: true` のときは通常 sample に加えて X 反転した center / normal にも brush を適用するようにした。
- X=0 付近では二重適用を避けるため、brush center の X がほぼ 0 の場合は mirror sample を追加しないようにした。
- `main.js` の sculpt stroke 開始 / 更新時に、既存の `xMirrorEdit` 状態を `SculptModeController` へ渡すようにした。
- `mmodeler_design.md` に、Sculpt Mode でも既存の `M` / X Mirror toggle を共有し、brush sample の mirror 適用として扱うことを追記した。

### 確認

- `SculptModeController.js` を ES module として構文チェックした。
- `main.js` を ES module として構文チェックした。
- `xMirror` option と mirror brush 適用が追加されていることを確認した。

### 補足

今回の実装は、Sculpt Mode の brush sample を X 反転位置にも適用する初期対応である。mirror preview の二重表示や、中心付近での falloff のより厳密な合成はまだ行っていない。

## 2026/05/29 17:53 JST

### 目的または理由

既存の `Cood` と同じような overlay UI で、Sculpt brush の有効半径と強度を設定できるようにする必要があった。

座標 overlay と別の UI を新規作成すると mobile 画面上の部品が増えるため、既存の coordinate overlay を文脈に応じて `Radius` / `Strength` / `Direction` の入力 UI として使い回す方針にした。

### 作業内容

- `index.html` の coordinate overlay label に `coordinateLabelX` / `coordinateLabelY` / `coordinateLabelZ` の id を追加し、表示名を動的に変更できるようにした。
- `CommandPalette.js` に `sculpt-brush` action を追加し、3 枚目の `mode-sculpt` があった slot を `Brsh` に変更した。
- `ModelerCommandDispatcher.js` に `showSculptBrushSettings` callback を追加し、`sculpt-brush` action から brush 設定 overlay を開けるようにした。
- `main.js` に `coordinateOverlayMode` を追加し、coordinate overlay を `coordinate` 用と `brush` 用で切り替えられるようにした。
- `setBrushOverlayValues()` を追加し、既存 overlay の 3 入力を `Radius`、`Strength`、`Direction` として表示するようにした。
- `applyBrushOverlayInput()` を追加し、radius と strength を `SculptModeController.setBrushOptions()` へ反映するようにした。
- strength に正値を入力した場合は現在の `Sclp+` / `Sclp-` の符号を維持し、負値を入力した場合は負方向として扱うようにした。
- `showSculptBrushSettings()` を追加し、Command Palette の `Brsh` または Sculpt Mode 中の `Cood` から brush 設定 overlay を開けるようにした。
- `mmodeler_design.md` に、`Brsh` と coordinate overlay 流用による brush radius / strength 設定方針を追記した。

### 確認

- `main.js` を ES module として構文チェックした。
- `CommandPalette.js` を ES module として構文チェックした。
- `ModelerCommandDispatcher.js` を ES module として構文チェックした。
- `sculpt-brush`、`showSculptBrushSettings`、`setBrushOverlayValues`、`applyBrushOverlayInput`、`coordinateOverlayMode` が追加されていることを確認した。

### 補足

今回の UI は既存 coordinate overlay の再利用であり、専用の slider や stepper はまだ追加していない。`Direction` は `Sclp+` / `Sclp-` で指定するため overlay 上では読み取り専用として扱う。

## 2026/05/29 18:23 JST

### 目的または理由

`Brsh` の Radius / Strength 入力で、ブラウザの number input によるスピンボタンではなく、直接数値を入力しやすい UI にしたいという確認があった。

既存の `Cood` は座標編集として number input のまま維持し、Sculpt brush 設定のときだけ入力欄を direct input 向けに切り替える方針にした。

### 作業内容

- `main.js` の `setBrushOverlayValues()` で、coordinate overlay の入力欄を `type="text"`、`inputMode="decimal"` に切り替えるようにした。
- `main.js` の `setCoordinateOverlayValues()` で、通常の座標編集に戻るときは入力欄を `type="number"`、`inputMode="decimal"`、`step="any"` に戻すようにした。

### 確認

- `main.js` を ES module として構文チェックした。

### 補足

値の検証は従来どおり `readFiniteNumber()` で行うため、text input にしても不正な値は brush 設定へ反映しない。

## 2026/05/29 19:19 JST

### 目的または理由

`Brsh` overlay で数値入力できず、`Radius` などの title と入力エリアが重なっていることが分かった。coordinate overlay の label 列が `24px` 固定で、`Radius` / `Strength` / `Direction` のような長い label を表示するには狭すぎた。

また、ブラシのデフォルト有効半径を `0.1` に変更する必要があった。

### 作業内容

- `SculptModeController.js` の `DEFAULT_BRUSH_RADIUS` を `0.5` から `0.1` に変更した。
- `index.html` の `.coordinate-row` を `24px 1fr` から `46px minmax(0, 1fr)` に変更し、label と input が重なりにくい layout にした。
- `.coordinate-row label` を右寄せ、12px、短い line-height に調整し、label が入力欄へ被りにくくした。
- `Brsh` overlay の label を `Radius` / `Strength` / `Direction` から `Rad` / `Str` / `Dir` に短縮した。

### 確認

- `SculptModeController.js` を ES module として構文チェックした。
- `main.js` を ES module として構文チェックした。
- default brush radius、coordinate overlay layout、brush label の変更箇所を確認した。

### 補足

`Brsh` overlay の入力欄は前回変更どおり `type="text"` として扱うため、スピンボタンではなく直接入力する想定である。ブラウザ上でのタップ入力再確認はまだ行っていない。

## 2026/05/29 16:06 JST

### 目的または理由

Sculpt Mode は brush 設定後にすぐ表面を見ながら削る操作が多いため、Command Palette だけでなく mobile の flick 操作から素早く入れる導線があると使いやすい。

一方で、flick 直後に brush stroke が暴発すると camera 操作や mode 切り替えと競合するため、flick はあくまで Sculpt Mode への mode 切り替えとして扱い、stroke armed 状態までは変更しない方針を設計に追加した。

### 作業内容

- `mmodeler_design.md` の mobile editing session 仕様に、Sculpt Mode へ flick 操作で入れる方針を追記した。
- Sculpt Mode に入った直後は `↑` button を inactive にし、一本指 drag は camera orbit を優先する、と記載した。
- `Sculpt Mode 設計` 節に、Command Palette だけでなく mobile flick からも Sculpt Mode へ入れる導線を追加した。
- flick gesture の認識は `MobileInputController`、mode 切り替えや既存 preview / transform / stroke の扱いは `main.js` の adapter が担当する、と責務分担を整理した。
- sculpt stroke 中の flick は cancel / confirm と競合しやすいため、無視するか先に stroke 終了を促す message を出して拒否する方針を記載した。

### 確認

- 追加した記述が、`↑` button を brush stroke armed として使う前回の方針、および mobile editing session の既存仕様と矛盾しないことを確認した。

### 補足

今回の変更は Markdown ドキュメントのみであり、JavaScript の実装は変更していない。そのため、追加の構文チェックやブラウザ上での WebGPU 実描画確認は実施していない。

## 2026/05/29 15:21 JST

### 目的または理由

`SculptModeController.js` を新設して mmodeler に Sculpt Mode を追加する前に、Sculpt Mode の目的、変更対象、既存 mode との境界、brush の基本仕様、preview 表示、picking / renderer / main.js との責務分担を設計書へ整理する必要があった。

今回の依頼ではコード修正は行わず、まず `mmodeler_design.md` に設計項目として追加することが目的である。

### 作業内容

- `mmodeler_design.md` の module 構成に `SculptModeController.js` の予定責務を追加した。
- `Sculpt Mode 設計` 節を追加し、Sculpt Mode は active object の local mesh vertices だけを変更し、object transform や selection、face winding は変更しないことを明記した。
- brush radius、brush strength、brush type、cursor hit、stroke session、stroke 開始 snapshot、brush preview 用 tangent basis など、`SculptModeController` が持つ state を整理した。
- 正の強度で膨らみ、負の強度で凹む基本 brush と、隣接頂点平均へ近づける smooth brush の考え方を記載した。
- 表面に平行な 3D circle を camera / projection で投影した楕円として brush preview を表示する方針を記載した。
- Sculpt Mode の pointer input、undo transaction、cancel、picking との境界、`main.js` に残す camera / projection adapter の考え方を整理した。

### 確認

- 追加した `Sculpt Mode 設計` 節の前後を読み、`EditModeController`、`ObjectModeController`、`ModelerPicking`、renderer の既存責務説明と矛盾しないことを確認した。

### 補足

今回の変更は Markdown ドキュメントのみであり、JavaScript の実装は変更していない。そのため、追加の構文チェックやブラウザ上での WebGPU 実描画確認は実施していない。

## 2026/05/29 15:48 JST

### 目的または理由

Sculpt Mode の brush preview について、当初は「表面に平行な 3D circle を projection して楕円表示する」と記載していた。しかし実際の目的は、厳密な影響範囲の表示ではなく、cursor が近傍 vertex / surface を認識しているかどうかを簡単に伝える feedback である。

また、Undo / cancel についても stroke 中の複雑な履歴管理ではなく、開始 snapshot へ戻すだけで十分であるため、設計書の記述を簡略化する必要があった。

### 作業内容

- `mmodeler_design.md` の `Sculpt Mode 設計` 節で、brush preview を精密な 3D projection ではなく、screen-space の近似楕円として扱う方針に変更した。
- 近傍 vertex / surface hit を認識している場合は、surface normal と view direction の角度から楕円の短軸を細くし、認識していない場合は円に近い preview を表示する、と記載した。
- preview の入力を cursor screen position、screen-space brush radius、view direction、hit normal の dot 値程度に抑え、projection matrix で 3D circle を投影する必要はないことを明記した。
- Sculpt stroke の Undo / cancel は、stroke 開始 snapshot に戻すだけでよいと記載を修正した。

### 確認

- `Sculpt Mode 設計` 節の preview、pointer input、Undo の記述を読み直し、今回の方針と矛盾しないことを確認した。

### 補足

今回の変更は Markdown ドキュメントのみであり、JavaScript の実装は変更していない。そのため、追加の構文チェックやブラウザ上での WebGPU 実描画確認は実施していない。

## 2026/05/29 15:52 JST

### 目的または理由

Sculpt Mode を mmodeler に接続する前段階として、まず設計書に沿った独立 module `SculptModeController.js` を作成することにした。

接続を先に進めると、mode 切り替え、pointer handler、renderer overlay、undo wiring が同時に絡むため、今回は Sculpt Mode の核になる brush state、stroke session、頂点変形、開始 snapshot 復元、preview 用情報の生成だけを小さく切り出した。

### 作業内容

- `samples/mmodeler/SculptModeController.js` を新規作成した。
- brush radius、brush strength、brush type、falloff type を保持し、`setBrushOptions()` / `getBrushOptions()` で操作できるようにした。
- `beginStroke()`、`applyStrokeSample()`、`endStroke()`、`cancelStroke()` を追加し、stroke 開始時 snapshot、連続変形、確定、開始 snapshot への復元を扱えるようにした。
- `inflate` / `draw` 系 brush として、brush radius 内の頂点を vertex normal 方向へ `strength * falloff` だけ移動する処理を追加した。
- `smooth` brush として、face adjacency から隣接頂点平均を求め、対象頂点を平均位置へ近づける処理を追加した。
- face normal、vertex normal、adjacency、neighbor average、falloff を計算する helper を同じ module 内に置いた。
- `getBrushPreview()` を追加し、cursor center、screen-space radius、view direction、hit normal から近似 ellipse の `majorRadius` / `minorRadius` / `hit` を返すようにした。hit していない場合は円、hit している場合は円と見分けやすい楕円になるようにした。

### 確認

- `SculptModeController.js` を ES module として構文チェックした。
- `beginStroke`、`applyStrokeSample`、`cancelStroke`、`getBrushPreview` などの主要 method が追加されていることを確認した。

### 補足

リポジトリ側に package.json の ESM 指定がないため、Node の通常 import による簡易実行 smoke test は `.js` file を CommonJS と解釈して失敗した。ブラウザで module として読み込む前提の構文チェックは通っている。今回は mmodeler への import / wiring はまだ行っていないため、ブラウザ上での WebGPU 実描画確認も未実施。

## 2026/05/29 16:02 JST

### 目的または理由

Sculpt Mode では brush stroke に一本指 drag を使いたいが、同時に表面を確認するための orbit camera 操作も必要になる。一本指 drag を常に brush stroke にすると camera 操作と競合し、mobile で使いにくくなる。

既存 UI には mobile 左上の `↑` button があり、Edit / Object Mode では selection shift として使われている。Sculpt Mode には selection がないため、この button を brush stroke の ON/OFF gate として再利用できるかを設計に反映した。

### 作業内容

- `mmodeler_design.md` の `Sculpt Mode 設計` 節に mobile UI 方針を追記した。
- Sculpt Mode の既定状態では一本指 drag を camera orbit に残し、`↑` button が active の間だけ brush stroke を有効にする、と記載した。
- Edit / Object Mode では `↑` を selection shift、Sculpt Mode では `brush stroke armed` toggle として解釈する方針を記載した。
- `↑` が inactive のときは brush preview 更新と camera 操作を優先し、active のときだけ pointerdown / drag / pointerup を `SculptModeController` へ渡す、と整理した。
- Command Palette は brush type、radius、strength、falloff の設定入口にし、設定後に palette を閉じて `↑` を on にして stroke する流れを基本操作とした。
- Sculpt Mode 中の status 表示では、既存の `shift` 表示ではなく `brush` / `stroke` / `brush armed` のような mode に応じた表現にする方針を記載した。

### 確認

- 追加した記述が既存の `↑` button / selection shift の説明、および Sculpt Mode の pointer input 方針と矛盾しないことを確認した。

### 補足

今回の変更は Markdown ドキュメントのみであり、JavaScript の実装は変更していない。そのため、追加の構文チェックやブラウザ上での WebGPU 実描画確認は実施していない。
