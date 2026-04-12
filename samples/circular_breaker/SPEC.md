# circular_breaker 仕様書（プレイヤー向け + 開発者向け）

この文書は、`circular_breaker` を後から見返したときに
- プレイヤーとしてどう遊ぶゲームか
- 開発者としてどこをどう触ればよいか
をすぐ理解できるようにまとめたものです。

---

## 1. ゲーム概要（プレイヤー向け）

`circular_breaker` は、円形アリーナで遊ぶ 3D ブロック崩しです。  

パドルでパックを打ち返し、外周に並ぶブロックを壊して得点を伸ばします。

### 1.1 目的
- パックを落とさず打ち返す
- 制限時間内にステージ目標数のブロックを破壊する
- レベルを進めて高得点を狙う

### 1.2 操作
- `ArrowLeft` / `ArrowRight`
  - パドルを移動します。

  - 移動方向は「パドルの長軸方向」に追従します。
- `A` / `D`
  - パドルを中心周りに回転します（角度制限なし）。
- `R`
  - プレイ中はパックを再発射します。

  - ゲーム終了画面ではゲームを初期状態から再スタートします。
- `K`
  - ポーズ切替（ゲーム進行を一時停止/再開）。
- `P`
  - スクリーンショットを保存します。
- `O`
  - ゲーム終了を強制します（終了HUD表示）。
- スマホ（coarse pointer）向けタッチUI
  - 画面下部に `← / → / A / D / R` ボタンを表示します。

  - `O / P / K` ボタンは表示しません。

  - `← / → / A / D` は押している間だけ入力を保持します。

  - `R` はワンショット入力で、プレイ中は再発射、終了時は再スタートです。

### 1.3 見える情報（HUD）
- プレイ中は上部情報を表示（`scale=2`）
  - 左上: `LEVEL`

  - 左寄り: `PACK`（残パック数）

  - 上部中央: 進捗表示 `(<現数>/<目標数>)`

  - 右上: `SCORE`
- `MISSION` という文言自体は表示しない
- ステージ開始待機中のみ、中央付近に `scale=2` の緑文字で操作方法を表示
- ゲーム終了時は `GAME OVER` / `FINAL SCORE` / `HIGHSCORES TOP 5` を表示し、`PRESS R TO RESTART` が点滅表示される
- キャンバスは viewport 全体（PC/スマホ）へ追従して描画される
- 縦長画面ではFOVを自動で広げ、視野の詰まりを抑える

### 1.4 現在のゲーム進行
- ステージ制限時間は `60秒`
- クリア目標はステージごとに増加
  - Stage1: 5個

  - Stage2: 6個

  - Stage3: 7個

  - 以降 `5 + (level - 1)`
- 目標達成（または全破壊）でステージクリア
- タイムアップ時は残りブロック数ペナルティ付きで次ステージへ進行
- ステージ遷移時:
  - クリア表示を約3秒表示

  - その後、次ステージ待機を最大10秒表示（キー入力/クリックで即開始可）

  - 待機画面に入る時点でパドルを初期位置へ戻す
- 初回起動時:
  - 自動開始しない

  - `PRESS ANY KEY TO START` を表示してキー入力待ち
- レベル上昇に応じてパック速度・目標数が上がる
- app 側 `GameStateManager` で `intro / play / pause / stage-clear / result` を切り替える

### 1.5 音
- BGM は最初の入力で開始する
- `scenePhases.js` から BGM preset を切り替え、待機 / プレイ / クリア / 終了を音でも追いやすくする
- 通知SE
  - ステージ開始待機: `ready -> countdown`

  - ステージ開始: `go -> ui_ok`

  - ポーズ: `stop -> ui_move`

  - クリア: `clear -> levelup`

  - 終了: `fail -> gameover`
- SE
  - パドル反射

  - 壁反射

  - ブロック破壊

  - 残パック減少（`damage`）

  - 補給成功（`bonus`）

---

## 2. 現在の仕様（プレイ挙動）

### 2.0 主要寸法（現行実装値）
- アリーナ半径: `62.0`（`ARENA_RADIUS`）
- 床高さ（厚み）: `2.4`（`FLOOR_HEIGHT`）
- 床中心Y座標: `-2.8`（`FLOOR_Y`）
- パドル寸法:
  - 長さ（X方向）: `12.4`（`PADDLE_HALF_LEN=6.2` の2倍）

  - 高さ（Y方向）: `1.8`

  - 奥行き（Z方向）: `3.0`（`PADDLE_HALF_DEPTH=1.5` の2倍）

### 2.1 パドル
- 形状: ベベル付き長方形
- 回転: `A/D` で中心固定回転
- 移動: パドルの長軸方向へスライド
- 可動範囲: アリーナ内の半径制限あり（`PADDLE_MOVE_LIMIT`）

### 2.2 パック
- 形状: ベベル付き円柱（16角以上）
- 発射方向: パドル短軸（法線）方向
- 発射時の工夫:
  - パドル前方へオフセット配置

  - 直後の自己衝突を避けるクールダウン

  - ステージ開始時のみ、左右±20度のランダム角を付与

### 2.3 反射ルール
- 壁: 円周法線で反射
- パドル:
  - OBB近似判定（長軸/短軸投影）

  - 法線反射

  - 接触位置（english）と回転量を加味して返球方向を補正

  - 粒子は出さずSEのみ再生
- ブロック:
  - ヒット半径判定

  - 種別ごとに挙動が異なる

    - `normal`: 1ヒット破壊

    - `hard`: 2耐久（1回目ヒットで低くなる）

    - `bomb`: 破壊時に近傍ブロックへ爆風連鎖

    - `switch`: 破壊時に `locked` を解除

    - `locked`（紫）: 解除前は破壊不可（反射のみ）

    - `supply`（緑）: 破壊で `PACK +1`、`damage / bonus` 系とは別に補給演出

  - 反射 + スコア加算 + 粒子エフェクト

  - 連続判定抑制:

    - 衝突後押し出し補正

    - `blockHitCooldown` による短時間ガード

### 2.6 PACK（残パック）とゲーム終了
- 初期残パック数は `3`
- パックが `paddleNode` ローカル座標系で `Z > 0`（カメラ側）へ入った瞬間に `PACK -1`
- 同領域に留まり続けても追加減算しない（エッジ検出）
- `Z > 0` の間はパックを暗色 + 高specularで表示し、前面へ戻ると白へ戻す
- `PACK` が `0` になった時点でゲーム終了（`PACK EMPTY`）
- ゲーム終了時にハイスコア上位5件を表示し、`R` で再スタートできる

### 2.4 外周マーカー（方位認識）
- 外周円柱はアリーナから少し離して配置（ブロックとの混同低減）
- 外周円柱は明るめ・やや高め
- 45度ごとに1本だけ「さらに高い円柱 + 色付き」
- 回転時の方位把握を支援

### 2.5 ビジュアル
- 背景クリア色はダークブルー
- キャンバス外（ページ背景）は白
- アリーナ床はグレー基調
- 床装飾として同心円ドーナツリング（青系）を配置

---

## 3. サウンド仕様（AudioSynth）

### 3.1 音源方針
- 外部ライブラリ不使用
- Web Audio API のみ使用
  - `AudioContext`

  - `OscillatorNode`

  - `GainNode`

### 3.2 BGM
- `samples/GameAudioPresets.js` の BGM preset を `intro / pause / result` と `play / stage-clear` で切り替える
- `scenePhases.js` から `applyGameBgmPreset()` を呼び、場面遷移と BGM の対応を 1 箇所で追えるようにしている
- ステージ開始は `ui_ok`、待機は `countdown`、クリア / 失敗は `levelup` / `gameover` を重ねている

### 3.3 SEプリセット
- `paddle`
- `wall`
- `block`
- `damage`
- `bonus`

---

## 4. 開発者向けガイド

### 4.1 主要ファイル
- ゲーム本体:
  - `/your/path/to/webg/samples/circular_breaker/main.js`
- 仕様書（このファイル）:
  - `/your/path/to/webg/samples/circular_breaker/SPEC.md`
- 音クラス:
  - `/your/path/to/webg/AudioSynth.js`

  - `/your/path/to/webg/GameAudioSynth.js`
- 音確認サンプル:
  - `/your/path/to/webg/samples/sound/index.html`
- 作業履歴メモ:
  - `/your/path/to/webg_codex_memo27.txt`

### 4.2 現在のモジュール構造
1. `main.js`
   - 画面/GPU初期化

   - builder から scene 部品を受け取る

   - runtime / phase / input helper の配線

   - メインループ
2. `arenaScene.js`
   - light

   - 床 / 床パターン / 外周壁 / guide ring
3. `blockField.js`
   - block texture / normal map

   - block prototype

   - block 初期配置 table

   - block type ごとの見た目変更

   - stage 開始時の block 初期化 helper
4. `gameRuntime.js`
   - ゲーム状態管理

   - パドル/パック更新

   - 衝突判定

   - block helper を使った hit 時の反応
5. `scenePhases.js`
   - app 側 `GameStateManager` の state 定義

   - phase と BGM preset / event sound の対応

   - 現在 phase の唯一の参照元
6. `stageFlow.js`
   - stage clear / 時間切れ / game over 判定

   - next stage の score 計算

   - stage timer と banner timer の更新
7. `highScoreStore.js`
   - progress helper 経由の high score 保存

   - localStorage fallback
8. `particleEffects.js`
   - `ParticleEmitter` の preset 調整

   - spark effect の生成 helper
9. `inputConfig.js`
   - action map

   - debug action handler

   - touch layout helper
10. `Hud.js`
   - 通常HUD

   - ステージ待機/クリア表示

   - ゲームオーバー + ハイスコア表示

### 4.3 重要な状態変数
- `state.paddleSpin`, `state.paddleYaw`
- `state.paddleAxisX/Z`（長軸）
- `state.paddleNormalX/Z`（短軸）
- `state.puckX/Z`, `state.puckVx/Vz`, `state.puckSpeed`
- `state.puckLocalZ`, `state.puckInPaddleLocalZPositive`, `state.puckWasInPaddleLocalZPositive`
- `state.paddleHitCooldown`, `state.wallSeCooldown`, `state.blockHitCooldown`
- `state.stageTimeLimitSec`, `state.targetBreaks`, `state.destroyedThisStage`
- `state.stageClearBannerSec`, `state.stageIntroSec`
- `state.packsRemain`, `state.packEventBannerSec`, `state.packEventText`
- `state.highScores`
- `state.level`, `state.score`
- `requestedScenePhase`（runtime 内部）

### 4.4 仕様変更時の推奨ポイント
- パドル操作感:
  - `updatePaddle()` の `moveSpeed`, `spinSpeed`
- 反射の気持ちよさ:
  - `handlePaddleCollision()` の english 係数
- 難易度:
  - `updateLevel()` の速度上昇量
- 視認性:
  - 外周マーカー色/高さ、カメラ位置
- 音:
  - `AudioSynth.js` の BPM、転調周期、休符確率、FX（delay/reverb）

  - `samples/GameAudioPresets.js` の BGM preset / event sound と各 phase への割り当て
- particle:
  - `particleEffects.js` の preset 既定値

  - `spawnSparks()` から emitter へ渡す position / velocity / life / size

### 4.5 デバッグ時の観点
- 「見えない/向き不明」
  - カメラ姿勢と外周マーカー表示を確認
- 「発射直後に詰まる」
  - `resetPuck()` のオフセットと `paddleHitCooldown`
- 「音が出ない」
  - 初回入力で `audio.resume()` されているか
- 「spark が大きすぎる / 小さすぎる」
  - `particleEffects.js` の `size`, `sizeSpread`, `shadowScale`

  - `gameRuntime.js` の `spawnSparks()` で与える `velocitySpread`

---

## 5. 現時点の未実装/拡張候補

- スコア詳細（コンボ倍率、ノーミス補正）
- ブロック種別の追加（回復、減速、時間停止など）
- パワーアップ要素
- ポーズ中オーバーレイの強化

---

## 6. 運用メモ

- ファイル変更時は先頭コメントの日付を更新する運用。
- Copyright 年表記は `2026` に統一。
- 作業履歴は `webg_codex_memo27.txt` に `##` 連番で記録。

## 7. BGM preset / event sound 設定（補足）

### 7.1 どこで BGM preset が決まるか
`circular_breaker` では、BGM preset と event sound の切り替えは `scenePhases.js` に集約している。

- `intro`
  - `menu`

  - 初回待機や次ステージ待機を音でも判別しやすくする
- `play`
  - `chase`

  - 実プレイ中の主旋律として使う
- `pause`
  - `menu`

  - 停止中であることを `ui_move` と一緒に伝える
- `stage-clear`
  - `victory`

  - `levelup` を重ねる
- `result`
  - `menu`

  - `gameover` を重ねる

scene ごとの意味づけをここへまとめることで、`main.js` や `gameRuntime.js` から「どの場面でどの音が鳴るか」を探し回らずに済む。

### 7.2 音の印象を変える場合は？
変更は次の順で考えると安全である。

1. scene と通知音の対応を変える
- `scenePhases.js` の `applyGameBgmPreset()` / `playGameEventSound()` の割り当てを見直す

2. BGM preset / event sound の中身を変える
- `samples/GameAudioPresets.js` 側の preset を調整する

3. 音場の印象を変える
- `AudioSynth.js` 側の `setBgmDelay()` / `setBgmReverb()` / `setSeReverb()` を調整する

## 8. リバーブ仕様（仕組みと実装）

### 8.1 仕組み
- `circular_breaker` のリバーブは `AudioSynth` コアの Convolver方式を利用する。
- 信号経路は以下の並列構成:
  - Dry: `SE/BGM Bus -> Dry -> Master`

  - Wet: `SE/BGM Bus -> Reverb Send -> Convolver(IR) -> Reverb Return -> Master`
- これにより、原音の明瞭さを保ちながら空間的な尾を付加する。

### 8.2 実装
- 実装ファイル:
  - `/your/path/to/webg/AudioSynth.js`
- 主要要素:
  - `buildFxChain()` で SE/BGM のリバーブノードを初期化

  - `createImpulseResponse()` でIRを生成

  - `setSeReverb(send, returnGain)` / `setBgmReverb(send, returnGain)` で効果量を調整
- 検証導線:
  - `/your/path/to/webg/samples/sound/index.html` の Reverb A/B ボタンでDry/Wet比較
