# mmodeler 設計メモ

作成日: 2026/05/21
更新日: 2026/06/02

この文書は `samples/mmodeler` の内部設計を整理するための設計書である。mmodeler は、スマートフォンやタブレット上の限られた画面で 3D mesh を編集することを目標としており、単なるデスクトップUIの縮小ではなく、キャンバス操作、ジェスチャー、コマンドパレット、ビューボタンを組み合わせたモバイル最適化 UI を構築する。

## ソフトウェア工学的な設計原則

本プロジェクトでは、長期的な保守性と拡張性を確保するため、以下のソフトウェア工学的な基本原則を設計の柱とする。

### 1. 関心の分離 (Separation of Concerns)
各モジュールは単一の責任のみを持つ（単一責任の原則）。
- **状態管理 (State)**: `ModelerScene` がデータ正本を保持し、UIや描画ロジックから切り離す。
- **ビジネスロジック (Logic)**: 各 `Controller` がモードごとの編集ルールを管理し、描画方法や入力形式に依存しない。
- **プレゼンテーション (Presentation)**: `ModelerRenderer` や `CommandPalette` が状態を可視化し、内部ロジックを直接操作しない。

### 2. 疎結合設計 (Loose Coupling)
モジュール間の直接的な依存を最小限に抑え、インターフェースを介した協調を行う。
- **仲介者の導入**: `main.js` を Wiring Layer（接続層）とし、`ModelerCommandDispatcher` を配送層として配置することで、コントローラー同士が互いの内部実装を直接知ることなく連携できる構成とする。
- **依存性の方向**: `Controller` $\rightarrow$ `Scene` の方向への依存は許容するが、`Scene` が `Controller` や `UI` に依存してはならない。

### 3. 正本の単一化 (Single Source of Truth: SSOT)
データの不整合（同期ズレ）を防ぐため、ある時点での正解データは常に一箇所にのみ存在させる。
- **セッション管理**: 編集中のデータは「編集セッション」が正本となり、確定（Commit）されるまで元のオブジェクトデータは書き換えない。これにより、不整合な状態での保存や、複雑な Undo/Redo 時のデータ破損を構造的に防止する。

### 4. 状態とロジックの分離 (Separation of State and Logic)
状態（データ構造）とそれを操作する関数を分離し、テストと変更を容易にする。
- 従来の「巨大なコンテキストオブジェクトを関数に渡す形式（Context Injection）」を廃止し、状態を所有するオブジェクトが適切なメソッド（API）を公開し、外部からそれを呼び出すオブジェクト指向設計へ移行する。

---

## 基本方針

上記の原則に基づき、実装レベルでは以下の方向性を維持する。

### 座標系の分離と正本管理
- **オブジェクトモード (Object Mode)**: シーン内のオブジェクトの配置（Origin, Rotation, Scale）を管理する。メッシュデータ（頂点配列）は変更せず、オブジェクトトランスフォームのみを更新する。
- **編集モード (Edit Mode)**: アクティブオブジェクトのローカルメッシュジオメトリを編集する。すべての操作はローカル座標系内で行われる。
- **正本の分離**: 編集モードでは、アクティブオブジェクトをクローンした「編集セッション用ジオメトリ」を正本とし、モード退出時にのみアクティブオブジェクトへ書き戻す（Commit）。

---

## 主要オブジェクトの役割

### ModelerScene (状態の核)
シーン全体の状態を管理する。
- **所有状態**: オブジェクトリスト、アクティブオブジェクトID、オブジェクト選択状態、Undo/Redo スタック、Dirtyフラグ、Next ID。
- **責務**: 状態の整合性維持、スナップショットの保存と復元、インポート後のシーン差し替え。
- **制約**: UI のコマンド名や DOM 構造に依存せず、純粋な状態管理に特化する。

### ModelerCommandDispatcher (コマンド配送)
アクションIDを、その責任を持つコントローラーへ振り分ける。
- **配送先**: `FileCommands`, `SceneCommands`, `ViewController`, `ObjectModeController`, `EditModeController`, `SculptModeController`, `HistoryCommands`。
- **調停**: モードによって意味が変わるコマンド（Move, Delete 等）を、現在のモードに応じて適切なコントローラーへ配送する。

### EditModeController (編集モード制御)
アクティブメッシュの編集セッションを管理する。
- **所有状態**: 編集用ジオメトリ（ vertices/faces）、選択状態（selectedVertices/Faces）、X-Mirrorペア、各種プレビュー状態（Loop Cut / Chain Select）。
- **責務**: 頂点・面の追加/削除、面作成、ループカット、細分化（Subd / Catmull-Clark）、および編集モード内でのトランスフォーム。
- **統合**: 以前 `main.js` に存在した topology / winding / selection normal などのジオメトリ計算ヘルパーをすべて集約し、所有する。

### ObjectModeController (オブジェクトモード制御)
シーン内のオブジェクト操作を管理する。
- **責務**: オブジェクト選択、プリミティブ追加（`ModelerPrimitiveFactory` 経由）、オブジェクトの結合（Join）、原点リセット、オブジェクトトランスフォーム。
- **統合**: `buildJoinedObject` 等の結合ロジックを `main.js` から移行し、内部で完結させる。

### SculptModeController (スカルプトモード制御)
頂点位置のみを連続的に変形させるモードを管理する。
- **所有状態**: ブラシ設定（Radius, Strength, Shape）、ストロークセッション、開始時スナップショット。
- **ブラシ種類**: `Draw` (法線方向), `Blur` (平滑化), `Grab` (牽引), `Pinch` (集約)。
- **減衰形状 (Falloff Shape)**: `Sphere`, `Triangle`, `Peak`, `Flat` の 4 種類を定義。

### ViewController (ビュー状態制御)
- **責務**: 投影法（透視/正投影）、ワイヤーフレーム、背景テーマ、可視ピックの有効/無効管理。

---

## モバイル編集セッション仕様

モバイルでの「指による遮蔽」問題を解決するため、すべての主要操作をセッション方式で扱う。

- **基本フロー**: `コマンド選択` $\rightarrow$ `ドラッグ（プレビュー更新）` $\rightarrow$ `指を離して確認` $\rightarrow$ `タップで確定` $\rightarrow$ `(または長押しでキャンセル)`。
- **適用範囲**: トランスフォーム (Move, Rotate, Scale, Extrude, Edge-Slide)、矩形選択 (Box Select)、ループカット方向決定。

### Sculpt Mode の特殊操作
- **入力ゲート**: `↑` ボタンを「ブラシストローク有効化 (Armed)」トグルとして使用。ON の間だけ一本指ドラッグを変形に使い、OFF の間はカメラ操作（Orbit）を優先する。
- **空領域ダブルタップ**: Sculpt Mode 中のみ、この操作を「カメラ操作 $\leftrightarrow$ ブラシ操作」の切り替えトグルとして扱う。
- **フリック移行**: ビュー dock またはキャンバス下端からの上方向フリックで、素早く Sculpt Mode へ移行する。

---

## 描画とプレビューの設計

### Sculpt ブラシカーソル
- **形状**: 表面の法線 $\vec{n}$ をスクリーン空間に投影し、その方向に合わせて回転させた「楕円」として描画する。
- **サイズ**: 3D 上の `brushRadius` を現在の View-Projection 行列で投影し、スクリーン上のピクセル距離から動的に算出する。

### 頂点ピック方式
- **スクリーン空間判定**: 3Dレイキャストではなく、全頂点をスクリーン座標に投影し、ポインターとの距離で判定する。
- **可視ピック**: 候補頂点からカメラ方向へ遮蔽物がないかを判定し、隠れている頂点の選択を防ぐ。

---

## 内部仕様と保守上の制約

### ジオメトリ正本の厳格な分離
- **Edit Mode 中**: `EditModeController` の編集セッション用ジオメトリを正本とする。表示・ピック・プレビューはすべてここを参照する。
- **Object Mode / 保存時**: `ModelerScene` の確定済みオブジェクトデータを正本とする。
- **Commit 境界**: `commitEditMeshState()` を通じてのみ、編集結果がシーンへ反映される。

### 頂点配列の 0-based 密配列化
mmodeler の編集メッシュは、頂点参照の固定費を抑えるため、`vertices` を 0-based の密な配列として扱う。`vertices[i].id === i` を不変条件とし、`face.indices` は頂点 ID ではなく `vertices` 配列の index を直接指す。これにより、face center、face normal、overlay、box select、sculpt brush など、全メッシュを頻繁に走査する処理で `vertices.find()` による線形探索を避ける。

頂点削除のように配列長が変わる操作では、削除後の配列順に従って vertex index を振り直し、face indices、selectedVertices、lastSelectedVertexId、X-Mirror の明示ペアを同じ変換表で更新する。存在しない頂点を参照する face や重複 index は補正せず、壊れた topology として例外にする。これは不具合を隠す自動補正ではなく、編集メッシュの不変条件を明確に保つための検査である。

この方式では、`nextVertexId` は安定 ID の払い出し番号ではなく、次に末尾へ追加される vertex index、すなわち通常は `vertices.length` を意味する。Import / Export / Primitive / Join / Undo snapshot もこの規則に合わせ、外部形式の 0-based index を mmodeler 内部でもそのまま扱う。

### Box Select の可視判定方針
Box Select は、クリックピックのように 1 点の厳密な遮蔽を調べる操作ではなく、画面上の矩形内に入った要素をまとめて選択する操作である。そのため、矩形の広さや候補数によって可視判定アルゴリズムを切り替えると、狭い範囲と広い範囲で選択結果が変わり、体感速度も逆転する。特に、狭い範囲だけ局所的な occluder を作る方式では、候補を遮蔽している face が矩形外にある場合に occluder から漏れ、選択ミスの原因になる。

現在の Box Select は、Wire 表示または Visible Pick 無効時には、矩形内に投影された候補をそのまま選択する。Solid 表示で Visible Pick が有効な場合も、box select では occlusion grid や候補ごとの遮蔽 raycast を使わず、front-facing 判定に統一する。vertex box select は候補 vertex に接続する face の front-facing 判定を使い、face box select は候補 face 自身の front-facing 判定を使う。これにより、狭い範囲と広い範囲で同じ規則が適用され、AAOP42_0003_webg.json.gz のような大規模 mesh でも操作停止を避けられる。

一方、クリックピックでは、点単位で「手前の面に隠れているか」を調べる必要があるため、従来の occlusion grid と raycast を維持する。つまり、クリック選択は精密判定、box select は一貫した高速判定という役割分担にする。

### Sculpt Mode の配列参照化
Sculpt Mode は、ブラシストローク中に全頂点、隣接頂点、face normal、vertex normal を繰り返し参照する。高頂点数 mesh では Map 構築や ID 変換の固定費が積み上がるため、内部計算も 0-based dense vertex index を前提にする。

`SculptModeController` では、adjacency、vertex normal、neighbor average を vertex index 配列として保持し、`array[vertex.id]` で直接参照する。`Blur` は隣接平均配列、`Draw` は vertex normal 配列、`Grab` と `Pinch` はブラシ範囲の頂点集合と falloff を使う。Grab 用の falloff はブラシ範囲だけを持つ疎な Map として扱うが、これは全頂点探索を置き換えるものではなく、ストローク開始時に固定された影響範囲の重み表である。

退化 face や孤立 vertex により頂点法線の合計がゼロになる場合は、ブラシの hit normal を fallback normal として使う。ゼロ長 vector を `normalize3()` に渡して例外で制御するのではなく、正規化前に長さを検査し、有効な fallback normal を明示的に使う。fallback normal までゼロ長の場合は、ブラシ入力側の問題として例外を出す。

### 入力フォーカスとイベント制御
- **テキスト入力保護**: `isTextEntryTarget()` を導入し、座標オーバーレイ等の `input` 要素がフォーカスされている間は、グローバルなキーボードハンドラやカメラ操作ハンドラがイベントを奪わないように制御する。
- **Safari対策**: `installSafariCalloutGuards()` 等のジェスチャー抑止設定から、テキスト入力領域を明示的に除外することで、キャレット（カーソル）の消失や選択不可問題を防止する。

---

## モジュール構成と責務分担

### Application Wiring (`main.js`)
- **役割**: 全モジュールの接続点。
- **責務**: アプリ初期化、DOMキャッシュ、イベントハンドラの登録、各コントローラーのインスタンス化、および複数モジュールを跨ぐ状態調停。

### Scene & Mode Controllers
- **`ModelerScene.js`**: シーン状態の正本。
- **`EditModeController.js`**: 編集セッション管理、ジオメトリ編集ロジック。
- **`ObjectModeController.js`**: オブジェクト選択、配置、プリミティブ追加、結合。
- **`SculptModeController.js`**: ブラシ変形セッション、頂点変形ロジック。
- **`ViewController.js`**: 表示設定の状態管理。

### Input & Calculation
- **`ModelerCommandDispatcher.js`**: アクションIDの配送。
- **`MobileInputController.js`**: ジェスチャー判定。
- **`ModelerPicking.js`**: スクリーン座標からのピック候補抽出。
- **`BoxSelectSession.js`**: 矩形選択の状態機械。
- **`math3d.js`**: 低レベルベクトル演算。

### Rendering & IO
- **`ModelerRenderer.js`**: WebGPUリソース管理。
- **`overlay2dRenderer.js` / `edgeWireframeOverlayRenderer.js`**: オーバーレイ描画。
- **`ModelerImportExport.js`**: ファイル形式変換。
- **`ModelerPrimitiveFactory.js`**: プリミティブジオメトリの生成。

---

## 完了条件（設計到達点）

1. **疎結合の実現**: 各コントローラーが互いの内部状態を直接参照せず、`main.js` や `Dispatcher` を介して協調している。
2. **正本の明確化**: 編集中のデータと確定済みデータが明確に分離され、不整合が発生しない。
3. **入力の堅牢性**: テキスト入力領域とキャンバス操作領域のイベント干渉が完全に解消されている。
4. **責任の局所化**: ジオメトリ計算ロジックが `main.js` から各コントローラーへ完全に移行している。
