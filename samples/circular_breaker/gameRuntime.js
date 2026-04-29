// ---------------------------------------------
// samples/circular_breaker/gameRuntime.js  2026/04/09
//   circular_breaker sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import {
  ARENA_RADIUS,
  BLOCK_RING_RADIUS,
  BLOCK_HIT_RADIUS,
  PADDLE_HALF_LEN,
  PADDLE_HALF_DEPTH,
  PADDLE_Y,
  PADDLE_MOVE_LIMIT,
  PUCK_RADIUS,
  PUCK_Y,
  SHADOW_Y,
  PARTICLES_PER_HIT,
  STAGE_TIME_LIMIT_SEC,
  STAGE_BASE_TARGET_BREAKS,
  STAGE_INTRO_MAX_SEC,
  STAGE_CLEAR_BANNER_SEC,
  STAGE_LAUNCH_RANDOM_DEG,
  DEG,
  RAD,
  clamp,
  len2,
  dot2,
  norm2,
  reflect2
} from "./constants.js";
import {
  applyBlockTypeAppearance,
  applyHardBlockDamageAppearance
} from "./blockField.js";
import { createHighScoreStore } from "./highScoreStore.js";
import { createStageFlowController } from "./stageFlow.js";

// この file は main.js から createGameRuntime() として呼ばれ、
// scenePhases.js と stageFlow.js に共有する gameplay state を管理する
// scene 構築や block 資産定義は別 file へ出し、
// ここでは移動、衝突、短時間演出更新を中心に扱う

// ゲーム進行ロジックを機能優先でまとめる
// main.js 側は「初期化して配線する責務」に集中させる
export const createGameRuntime = ({
  blocks,
  sparkEmitter,
  audio,
  screen,
  puckNode,
  puckShape,
  puckShadowNode,
  paddleNode,
  paddleBodyNode,
  paddleShadowNode,
  paddleShadowBodyNode,
  blockAssets,
  isActionDown,
  clearKeys,
  saveProgress,
  loadProgress
}) => {
  // high score 保存の入口も helper 化し、
  // runtime は gameplay 進行の都度 top5 を読む / 書くことだけに集中する
  const highScoreStore = createHighScoreStore({
    loadProgress,
    saveProgress
  });

  // ランタイム状態（毎フレーム更新される）
  const state = {
    level: 1,
    score: 0,
    startTime: performance.now(),
    lastMs: performance.now(),
    paddleSpin: 0.0,
    paddleYaw: Math.PI * 0.5,
    paddleCx: 0.0,
    paddleCz: 0.0,
    paddleAxisX: 0.0,
    paddleAxisZ: 1.0,
    paddleNormalX: -1.0,
    paddleNormalZ: 0.0,
    // paddleNode ローカル +Z 軸をワールドXZ平面へ射影した単位ベクトル
    // 「背面側（ローカルZ正）」判定に使う
    paddleLocalZX: 1.0,
    paddleLocalZZ: 0.0,
    // 確認用: パックが paddleNode ローカルZ正側にいるかを毎フレーム更新
    puckLocalZ: 0.0,
    puckInPaddleLocalZPositive: false,
    // エッジ検出用: 前フレームでローカルZ正領域に居たか
    puckWasInPaddleLocalZPositive: false,
    puckBackVisualApplied: false,
    // パドルの反作用速度
    // パックを打ち返した瞬間に「反射法線の逆向き」へインパルスを与える
    // カメラを揺らさないため、当たり判定用の基準ノードではなく
    // paddleBodyNode / paddleShadowBodyNode の見た目オフセットとして使う
    paddleRecoilVx: 0.0,
    paddleRecoilVz: 0.0,
    paddleRecoilOffsetX: 0.0,
    paddleRecoilOffsetZ: 0.0,
    puckX: 0.0,
    puckZ: 0.0,
    puckVx: 0.0,
    puckVz: 0.0,
    puckSpeed: 28.0,
    // リスポーン直後は背面ミス判定を止める猶予時間
    // 直後フレームの姿勢更新順に依存した誤判定を避ける
    puckMissGraceSec: 0.0,
    // 現在ステージでミス可能な残パック数
    // パドル背面へ逸れた時に1減少し、補給ブロック破壊で1増加する
    packsRemain: 3,
    stageStartTime: performance.now(),
    stageTimeLimitSec: STAGE_TIME_LIMIT_SEC,
    targetBreaks: STAGE_BASE_TARGET_BREAKS,
    destroyedThisStage: 0,
    locksOpen: false,
    stageResultText: "MISSION: destroy 5 blocks in 60s",
    stageClearBannerSec: 0.0,
    stageIntroSec: STAGE_INTRO_MAX_SEC,
    stageIntroNeedsInput: true,
    // gameFinished は stage 内ルールの終端フラグであり、
    // top-level phase の result と同義ではない
    // scenePhases.js はこの事実を見て result phase へ入る
    gameFinished: false,
    paddleHitCooldown: 0.0,
    wallSeCooldown: 0.0,
    blockHitCooldown: 0.0,
    // 補給/ミス演出の短時間HUD表示タイマー
    packEventBannerSec: 0.0,
    packEventText: "",
    gameOverText: "GAME OVER",
    highScores: highScoreStore.loadHighScores(),
    audioUnlocked: false
  };
  const updateStageMissionText = () => {
    state.stageResultText = `MISSION: destroy ${state.targetBreaks} blocks in ${Math.floor(state.stageTimeLimitSec)}s`;
  };

  // play phase に入る瞬間の初期化は runtime 側へ残し、
  // stageFlow.js が「次の stage 条件判定」と混ざらないようにする
  const beginStagePlay = () => {
    state.stageIntroSec = 0.0;
    state.stageIntroNeedsInput = false;
    clearKeys();
    resetPaddleToInitial();
    resetPuck(true);
    state.stageStartTime = performance.now();
    updateStageMissionText();
  };

  // stage-clear を抜けて intro countdown へ入る直前の準備をまとめる
  // scenePhases.js の onEnter(intro) から呼び、
  // 「次 stage の待機表示へ入る時に何を戻すか」を 1 箇所で追えるようにする
  const prepareStageIntro = (randomizeLaunch = false) => {
    clearKeys();
    resetPaddleToInitial();
    resetPuck(randomizeLaunch);
    updateStageMissionText();
  };

  // scenePhases.js が top-level phase を判断しやすいよう、
  // runtime 側で持つ stage 内状態だけを抜き出して返す
  const getSceneSignals = () => ({
    stageIntroSec: state.stageIntroSec,
    stageIntroNeedsInput: state.stageIntroNeedsInput,
    stageClearBannerSec: state.stageClearBannerSec,
    gameFinished: state.gameFinished
  });

  // result からの再開始は top-level phase の切り替えに近い準備なので、
  // stage 内ルール helper ではなく runtime 側で状態全体を戻す
  const restartGame = () => {
    clearKeys();
    state.level = 1;
    state.score = 0;
    state.startTime = performance.now();
    state.lastMs = performance.now();
    state.puckSpeed = 28.0;
    state.stageStartTime = performance.now();
    state.stageTimeLimitSec = STAGE_TIME_LIMIT_SEC;
    state.targetBreaks = STAGE_BASE_TARGET_BREAKS;
    state.destroyedThisStage = 0;
    state.locksOpen = false;
    state.stageResultText = "";
    state.stageClearBannerSec = 0.0;
    state.stageIntroSec = STAGE_INTRO_MAX_SEC;
    state.stageIntroNeedsInput = true;
    state.gameFinished = false;
    state.paddleHitCooldown = 0.0;
    state.wallSeCooldown = 0.0;
    state.blockHitCooldown = 0.0;
    state.packEventBannerSec = 0.0;
    state.packEventText = "";
    state.gameOverText = "GAME OVER";
    state.packsRemain = 3;
    state.highScores = highScoreStore.loadHighScores();
    sparkEmitter?.clear?.();
    updateStageMissionText();
    stageFlow.resetBlocks();
    resetPaddleToInitial();
    resetPuck(true);
  };

  const takeScreenshot = () => {
    const d = new Date();
    const pad2 = (v) => String(v).padStart(2, "0");
    const ts = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
    const file = `circular_breaker_${ts}.png`;
    screen.screenShot(file);
  };

  // ブラウザの自動再生制限対策
  // 最初のユーザー操作（keydown/pointerdown）で AudioContext を有効化する
  const unlockAudio = async () => {
    if (state.audioUnlocked) return;
    try {
      await audio.resume();
      audio.startBgm();
      state.audioUnlocked = true;
    } catch (err) {
      console.error("Audio unlock failed:", err);
    }
  };

  // パック速度を「方向 + 大きさ」で安全に設定
  // 方向ベクトルは正規化しておく
  const setPuckVelocity = (vx, vz, speed) => {
    const [nx, nz] = norm2(vx, vz);
    state.puckVx = nx * speed;
    state.puckVz = nz * speed;
  };

  // パック初期化
  // パドル短軸の前方へ少し離して配置し、直後の自己衝突を防ぐ
  const resetPuck = (randomizeLaunch = false) => {
    // パドル前方へ十分に離して配置し、開始直後の見た目埋まりを防ぐ
    const launchOffset = PADDLE_HALF_DEPTH + PUCK_RADIUS + 1.8;
    state.puckX = state.paddleCx + state.paddleNormalX * launchOffset;
    state.puckZ = state.paddleCz + state.paddleNormalZ * launchOffset;
    let launchX = state.paddleNormalX;
    let launchZ = state.paddleNormalZ;
    if (randomizeLaunch) {
      const jitter = (Math.random() * 2.0 - 1.0) * STAGE_LAUNCH_RANDOM_DEG * DEG;
      const cs = Math.cos(jitter);
      const sn = Math.sin(jitter);
      const rx = launchX * cs - launchZ * sn;
      const rz = launchX * sn + launchZ * cs;
      [launchX, launchZ] = norm2(rx, rz);
    }
    setPuckVelocity(launchX, launchZ, state.puckSpeed);
    // スタート待機中でも表示位置が正しくなるよう、ノードへ即時反映する
    puckNode.setPosition(state.puckX, PUCK_Y, state.puckZ);
    puckShadowNode.setPosition(state.puckX, SHADOW_Y, state.puckZ);
    // 発射直後はパドル判定を一時停止して連続ヒットを抑える
    state.paddleHitCooldown = 0.12;
    // 背面ミス判定も短時間停止し、開始直後の即ミス誤検知を防ぐ
    state.puckMissGraceSec = 0.45;
    // リセット時は背面フラグと色を前面状態へ明示復帰する
    // フラグだけ先にfalseへ戻ると、差分更新が走らず暗色が残る場合があるため
    state.puckLocalZ = 0.0;
    state.puckInPaddleLocalZPositive = false;
    state.puckWasInPaddleLocalZPositive = false;
    state.puckBackVisualApplied = false;
    if (puckShape) {
      puckShape.updateMaterial({
        color: [1.0, 1.0, 1.0, 1.0],
        ambient: 0.10,
        specular: 1.20,
        power: 92.0,
        emissive: 0.0
      });
    }
  };

  const resetPaddleToInitial = () => {
    state.paddleSpin = 0.0;
    state.paddleYaw = Math.PI * 0.5;
    state.paddleCx = 0.0;
    state.paddleCz = 0.0;
    state.paddleAxisX = 0.0;
    state.paddleAxisZ = 1.0;
    state.paddleNormalX = -1.0;
    state.paddleNormalZ = 0.0;
    state.paddleLocalZX = 1.0;
    state.paddleLocalZZ = 0.0;
    state.puckLocalZ = 0.0;
    state.puckInPaddleLocalZPositive = false;
    state.puckWasInPaddleLocalZPositive = false;
    state.puckBackVisualApplied = false;
    state.paddleRecoilVx = 0.0;
    state.paddleRecoilVz = 0.0;
    state.paddleRecoilOffsetX = 0.0;
    state.paddleRecoilOffsetZ = 0.0;
    paddleNode.setPosition(0.0, PADDLE_Y, 0.0);
    paddleNode.setAttitude(state.paddleYaw * RAD, 0, 0);
    paddleShadowNode.setPosition(0.0, SHADOW_Y, 0.0);
    paddleShadowNode.setAttitude(state.paddleYaw * RAD, 0, 0);
    if (paddleBodyNode) paddleBodyNode.setPosition(0.0, 0.0, 0.0);
    if (paddleShadowBodyNode) paddleShadowBodyNode.setPosition(0.0, 0.0, 0.0);
  };

  // ヒット位置から放射する火花を生成
  // ParticleEmitter に「出す量」と「初速の傾向」だけを渡し、
  // gameplay 側は衝突位置と演出タイミングの判断へ集中する
  const spawnSparks = (x, y, z, baseAngle) => {
    if (!sparkEmitter?.emit) return 0;
    const biasSpeed = 2.5;
    return sparkEmitter.emit(PARTICLES_PER_HIT, {
      position: [x, y, z],
      positionSpread: [0.35, 0.25, 0.35],
      velocity: [Math.cos(baseAngle) * biasSpeed, 12.0, Math.sin(baseAngle) * biasSpeed],
      velocitySpread: [22.0, 9.0, 22.0],
      gravity: [0.0, -15.0, 0.0],
      // ParticleEmitter.emit() は preset の scalar 値を自動補完しないため、
      // drag も gameplay 側で明示して更新時の NaN 混入を防ぐ
      drag: 0.03,
      life: 0.88,
      lifeSpread: 0.27,
      size: 2.6,
      sizeSpread: 0.9,
      color: [1.0, 1.0, 1.0, 1.0],
      colorSpread: [0.0, 0.0, 0.0, 0.0],
      shadowAlpha: 0.85,
      shadowScale: 1.2,
      shadowY: SHADOW_Y + 0.16
    });
  };
  // stage の開始条件、block 再配置、game over、restart は controller へ分離し、
  // runtime 本体は移動 / 衝突 / visual 更新の流れへ集中させる
  const stageFlow = createStageFlowController({
    state,
    blocks,
    blockAssets,
    clearKeys,
    updateStageMissionText,
    spawnSparks,
    audio,
    highScoreStore
  });

  const updateSupplyHighlight = () => {
    // 補給ブロックを常に視認しやすくするため、発光色をゆっくり脈動させる
    // あわせて非補給ブロックの texture/normal-map 利用フラグを明示的に戻し、
    // 補給用設定が他ブロックへ残る見え方を抑止する
    const t = performance.now() * 0.001;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b.active) continue;
      if (b.type !== "supply") {
        // 補給ブロック向け設定が残らないよう、通常側の陰影値を明示復帰
        const params = b.shape?.materialParams ?? {};
        if (params.use_texture !== 1
          || params.use_normal_map !== 1
          || params.emissive !== 0.0
          || params.ambient !== 0.12
          || params.specular !== 1.20) {
          b.shape.updateMaterial({
            ambient: 0.12,
            specular: 1.20,
            emissive: 0.0,
            power: 62.0,
            use_texture: 1,
            use_normal_map: 1,
            normal_strength: 0.5
          });
        }
        continue;
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 7.0 + b.angle * 1.3);
      const darkPhase = pulse < 0.35;
      // 要件:
      // - 暗い位相は通常ブロック相当の色/照明へ揃える
      // - 明るい位相は発光(emissive)だけを増やす
      b.shape.updateMaterial({
        color: [0.12, 0.70, 0.20, 1.0],
        ambient: 0.12,
        specular: 1.20,
        power: 62.0,
        emissive: darkPhase ? 0.0 : (0.025 + pulse * 0.225),
        use_texture: 0,
        use_normal_map: 0,
        normal_strength: 0.0
      });
    }
  };

  const updatePuckBacksideState = () => {
    // 確認用途: パック位置を paddleNode ローカルZ軸へ毎フレーム投影
    // `puckInPaddleLocalZPositive` が true のとき、パックはローカルZ正側に存在する
    const relX = state.puckX - state.paddleCx;
    const relZ = state.puckZ - state.paddleCz;
    state.puckLocalZ = dot2(relX, relZ, state.paddleLocalZX, state.paddleLocalZZ);
    state.puckInPaddleLocalZPositive = state.puckLocalZ > 0.0;
  };

  const updatePuckVisualByBackside = () => {
    // パックが paddleNode ローカルZ正側にある間は暗色・高specularへ切り替える
    // 見た目更新を毎フレーム行わず、状態が変わったときだけ反映して負荷を抑える
    const inBack = state.puckInPaddleLocalZPositive;
    if (inBack === state.puckBackVisualApplied) return;
    state.puckBackVisualApplied = inBack;
    if (!puckShape) return;
    if (inBack) {
      puckShape.updateMaterial({
        color: [0.20, 0.23, 0.30, 1.0],
        ambient: 0.08,
        specular: 1.85,
        power: 126.0,
        emissive: 0.0
      });
    } else {
      // 背面（localZ>0）から前面（localZ<=0）へ戻ったら白へ復帰する
      puckShape.updateMaterial({
        color: [1.0, 1.0, 1.0, 1.0],
        ambient: 0.10,
        specular: 1.20,
        power: 92.0,
        emissive: 0.0
      });
    }
  };

  // パドル更新
  // - rotate_left / rotate_right: 回転（中心固定）
  // - move_left / move_right: 現在の長軸方向へスライド移動
  // - 移動上限: アリーナ内半径にクランプ
  const updatePaddle = (dt) => {
    if (state.stageIntroSec > 0.0) return;
    const moveSpeed = 30.0;
    const spinSpeed = 2.3;
    const recoilVelDamping = 9.5;
    const recoilPosDamping = 6.2;
    const recoilStopEps = 0.015;
    const recoilMaxOffset = 3.8;
    if (isActionDown("rotate_left")) state.paddleSpin += spinSpeed * dt;
    if (isActionDown("rotate_right")) state.paddleSpin -= spinSpeed * dt;

    // 回転角度は無制限数値肥大化だけ防ぐため 2PI 周期に折り返す
    if (state.paddleSpin > Math.PI || state.paddleSpin < -Math.PI) {
      state.paddleSpin = Math.atan2(Math.sin(state.paddleSpin), Math.cos(state.paddleSpin));
    }

    // A/D は向きのみ更新する（中心はここでは動かさない）
    state.paddleYaw = Math.PI * 0.5 + state.paddleSpin;
    paddleNode.setAttitude(state.paddleYaw * RAD, 0, 0);
    paddleNode.setPosition(state.paddleCx, PADDLE_Y, state.paddleCz);
    const wm = paddleNode.getWorldMatrix();
    const p0 = wm.mulVector([0.0, 0.0, 0.0]);
    const p1 = wm.mulVector([1.0, 0.0, 0.0]);
    const pz = wm.mulVector([0.0, 0.0, 1.0]);
    [state.paddleAxisX, state.paddleAxisZ] = norm2(p1[0] - p0[0], p1[2] - p0[2]);
    [state.paddleNormalX, state.paddleNormalZ] = norm2(-state.paddleAxisZ, state.paddleAxisX);
    [state.paddleLocalZX, state.paddleLocalZZ] = norm2(pz[0] - p0[0], pz[2] - p0[2]);

    // 見た目の長軸方向を行列から直接取得
    // 角度式だけに頼ると軸解釈ずれが出るため、実姿勢ベースで計算する
    // move action はこの長軸方向ベクトルに沿って進める
    let move = 0.0;
    if (isActionDown("move_left")) move -= moveSpeed * dt;
    if (isActionDown("move_right")) move += moveSpeed * dt;

    // 反作用の押し戻し
    // - 速度を積分して見た目オフセットへ変換
    // - 速度と位置の両方を減衰させて、短く押されて元へ戻る挙動にする
    state.paddleRecoilOffsetX += state.paddleRecoilVx * dt;
    state.paddleRecoilOffsetZ += state.paddleRecoilVz * dt;
    state.paddleRecoilVx *= Math.exp(-recoilVelDamping * dt);
    state.paddleRecoilVz *= Math.exp(-recoilVelDamping * dt);
    state.paddleRecoilOffsetX *= Math.exp(-recoilPosDamping * dt);
    state.paddleRecoilOffsetZ *= Math.exp(-recoilPosDamping * dt);
    if (Math.abs(state.paddleRecoilVx) < recoilStopEps) state.paddleRecoilVx = 0.0;
    if (Math.abs(state.paddleRecoilVz) < recoilStopEps) state.paddleRecoilVz = 0.0;
    if (Math.abs(state.paddleRecoilOffsetX) < recoilStopEps) state.paddleRecoilOffsetX = 0.0;
    if (Math.abs(state.paddleRecoilOffsetZ) < recoilStopEps) state.paddleRecoilOffsetZ = 0.0;
    const recoilLen = len2(state.paddleRecoilOffsetX, state.paddleRecoilOffsetZ);
    if (recoilLen > recoilMaxOffset) {
      const k = recoilMaxOffset / recoilLen;
      state.paddleRecoilOffsetX *= k;
      state.paddleRecoilOffsetZ *= k;
    }

    state.paddleCx += state.paddleAxisX * move;
    state.paddleCz += state.paddleAxisZ * move;
    const d = len2(state.paddleCx, state.paddleCz);
    if (d > 1.0e-6) {
      // ブロックリングとの干渉回避
      // パドル中心を半径だけで止めると、回転方向によって先端がブロックへ食い込む
      // そのため「中心から半径方向へどれだけ張り出すか」を姿勢依存で計算して制限する
      const rx = state.paddleCx / d;
      const rz = state.paddleCz / d;
      const axisProj = Math.abs(dot2(rx, rz, state.paddleAxisX, state.paddleAxisZ));
      const normalProj = Math.abs(dot2(rx, rz, state.paddleNormalX, state.paddleNormalZ));
      const radialExtent = axisProj * PADDLE_HALF_LEN + normalProj * PADDLE_HALF_DEPTH;
      const blockSafeRadius = BLOCK_RING_RADIUS - BLOCK_HIT_RADIUS - 0.6;
      const maxByBlock = Math.max(0.0, blockSafeRadius - radialExtent);
      const maxRadius = Math.min(PADDLE_MOVE_LIMIT, maxByBlock);
      if (d > maxRadius) {
        state.paddleCx = state.paddleCx / d * maxRadius;
        state.paddleCz = state.paddleCz / d * maxRadius;
      }
    }

    paddleNode.setPosition(state.paddleCx, PADDLE_Y, state.paddleCz);
    paddleNode.setAttitude(state.paddleYaw * RAD, 0, 0);
    paddleShadowNode.setPosition(state.paddleCx, SHADOW_Y, state.paddleCz);
    paddleShadowNode.setAttitude(state.paddleYaw * RAD, 0, 0);

    // 見た目ノードへだけ反作用オフセットを適用する
    // これによりカメラ追従基準（paddleNode）は揺らさず、パドル本体だけ押される
    const recoilLocalX = dot2(state.paddleRecoilOffsetX, state.paddleRecoilOffsetZ, state.paddleAxisX, state.paddleAxisZ);
    const recoilLocalZ = dot2(state.paddleRecoilOffsetX, state.paddleRecoilOffsetZ, state.paddleNormalX, state.paddleNormalZ);
    if (paddleBodyNode) paddleBodyNode.setPosition(recoilLocalX, 0.0, recoilLocalZ);
    if (paddleShadowBodyNode) paddleShadowBodyNode.setPosition(recoilLocalX, 0.0, recoilLocalZ);
  };

  // パドルとパックの衝突判定と反射処理
  // 1) ローカル座標系（長軸/法線軸）へ投影してOBB近似判定
  // 2) 法線反射 + 接触位置(english) + 回転補正で返球方向を作る
  const handlePaddleCollision = (dt) => {
    if (state.paddleHitCooldown > 0.0) {
      state.paddleHitCooldown -= dt;
      return;
    }

    const cx = state.paddleCx;
    const cz = state.paddleCz;

    const axisX = state.paddleAxisX;
    const axisZ = state.paddleAxisZ;
    const [nx0, nz0] = norm2(-axisZ, axisX);

    const relX = state.puckX - cx;
    const relZ = state.puckZ - cz;
    const localX = dot2(relX, relZ, axisX, axisZ);
    const localN = dot2(relX, relZ, nx0, nz0);

    const inX = Math.abs(localX) <= (PADDLE_HALF_LEN + PUCK_RADIUS);
    const inN = Math.abs(localN) <= (PADDLE_HALF_DEPTH + PUCK_RADIUS);
    if (!inX || !inN) return;

    let nx = nx0;
    let nz = nz0;
    if (dot2(state.puckVx, state.puckVz, nx, nz) > 0.0) {
      nx = -nx;
      nz = -nz;
    }

    let [rvx, rvz] = reflect2(state.puckVx, state.puckVz, nx, nz);

    const english = clamp(localX / PADDLE_HALF_LEN, -1.0, 1.0);
    rvx += axisX * (english * 7.2 + state.paddleSpin * 4.0);
    rvz += axisZ * (english * 7.2 + state.paddleSpin * 4.0);

    const speed = state.puckSpeed + 2.0;
    setPuckVelocity(rvx, rvz, speed);

    // 打ち返し時の反作用:
    // 反射中心の法線ベクトル (nx,nz) の反対向きへパドルを少し押す
    // 値は「目で追えるが操作性を壊さない」程度に抑える
    const paddleRecoilImpulse = 13.5;
    const paddleRecoilInstantKick = 0.78;
    state.paddleRecoilOffsetX += -nx * paddleRecoilInstantKick;
    state.paddleRecoilOffsetZ += -nz * paddleRecoilInstantKick;
    state.paddleRecoilVx += -nx * paddleRecoilImpulse;
    state.paddleRecoilVz += -nz * paddleRecoilImpulse;

    // 反射後にパドル内部へ残っていると次フレームで再ヒットしやすい
    // 法線方向へ最低限押し出して、判定境界の外へ戻す
    const paddleHitLimitN = PADDLE_HALF_DEPTH + PUCK_RADIUS;
    const penetrationN = paddleHitLimitN - Math.abs(localN);
    if (penetrationN >= 0.0) {
      const pushOut = penetrationN + 0.14;
      state.puckX += nx * pushOut;
      state.puckZ += nz * pushOut;
    }

    state.paddleHitCooldown = 0.09;
    if (state.audioUnlocked) audio.playSe("paddle");
  };

  // 円形外周壁での反射処理
  // 外に出たら境界へ押し戻し、外向き速度成分のみ反転する
  const handleWallCollision = () => {
    const d = len2(state.puckX, state.puckZ);
    const limit = ARENA_RADIUS - PUCK_RADIUS - 0.8;
    if (d <= limit) return;

    const [nx, nz] = norm2(state.puckX, state.puckZ);
    state.puckX = nx * limit;
    state.puckZ = nz * limit;

    if (dot2(state.puckVx, state.puckVz, nx, nz) > 0.0) {
      const [rvx, rvz] = reflect2(state.puckVx, state.puckVz, nx, nz);
      setPuckVelocity(rvx, rvz, state.puckSpeed);
      if (state.audioUnlocked && state.wallSeCooldown <= 0.0) {
        audio.playSe("wall");
        state.wallSeCooldown = 0.05;
      }
    }
  };

  // ブロック衝突
  // 最初に当たった1個のみ処理し、非表示化 + 加点 + 反射 + 火花を行う
  const destroyBlock = (b, hitPosX, hitPosZ, scoreScale = 1.0) => {
    if (!b.active) return false;
    b.active = false;
    b.node.hide(true);
    b.glow = 0.35;
    state.destroyedThisStage++;

    let base = 120;
    if (b.type === "hard") base = 180;
    if (b.type === "bomb") base = 220;
    if (b.type === "switch") base = 140;
    if (b.type === "locked") base = 160;
    state.score += Math.floor(base * state.level * scoreScale);

    spawnSparks(hitPosX, 1.2, hitPosZ, b.angle);
    return true;
  };

  const openLockedBlocks = () => {
    state.locksOpen = true;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b.active || b.type !== "locked") continue;
      applyBlockTypeAppearance(b, {
        blockAssets,
        locksOpen: true
      });
    }
  };

  const handleBlockCollisions = () => {
    if (state.blockHitCooldown > 0.0) return;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b.active) continue;

      const pos = b.node.getPosition();
      const dx = state.puckX - pos[0];
      const dz = state.puckZ - pos[2];
      const d2 = dx * dx + dz * dz;
      const hitR = PUCK_RADIUS + BLOCK_HIT_RADIUS;
      if (d2 > hitR * hitR) continue;

      const [nx, nz] = norm2(dx, dz);
      // 衝突後に判定半径の外へ押し出して、同一ブロックへの連続ヒットを防ぐ
      state.puckX = pos[0] + nx * (hitR + 0.18);
      state.puckZ = pos[2] + nz * (hitR + 0.18);
      const [rvx, rvz] = reflect2(state.puckVx, state.puckVz, nx, nz);
      setPuckVelocity(rvx, rvz, state.puckSpeed + 0.4);
      state.blockHitCooldown = 0.07;

      // locked は switch が押されるまで無効化する（反射のみ）
      if (b.type === "locked" && !state.locksOpen) {
        spawnSparks(pos[0], pos[1], pos[2], b.angle);
        if (state.audioUnlocked) audio.playSe("wall");
        break;
      }

      // hard は2耐久1発目は破壊せず見た目だけ変える
      if (b.type === "hard" && b.hp > 1) {
        b.hp--;
        applyHardBlockDamageAppearance(b, {
          blockAssets
        });
        state.score += Math.floor(40 * state.level);
        spawnSparks(pos[0], pos[1], pos[2], b.angle);
        if (state.audioUnlocked) audio.playSe("wall");
        break;
      }

      const destroyed = destroyBlock(b, pos[0], pos[2], 1.0);
      if (destroyed && state.audioUnlocked) audio.playSe("block");

      // switch 破壊で locked を解除
      if (b.type === "switch") {
        openLockedBlocks();
      }

      // supply はノーマルマップ無しブロック
      // 破壊時に残パックを1つ増やし、短時間バナーで増加を通知する
      if (b.type === "supply" && destroyed) {
        state.packsRemain += 1;
        stageFlow.triggerPackEvent(`PACK +1  (${state.packsRemain})`);
        spawnSparks(pos[0], pos[1], pos[2], b.angle + Math.PI * 0.25);
        if (state.audioUnlocked) audio.playSe("powerup");
      }

      // bomb は近傍ブロックを巻き込む
      if (b.type === "bomb") {
        const blastR = 11.0;
        const blastR2 = blastR * blastR;
        for (let j = 0; j < blocks.length; j++) {
          if (j === i) continue;
          const t = blocks[j];
          if (!t.active) continue;
          if (t.type === "locked" && !state.locksOpen) continue;
          const tp = t.node.getPosition();
          const bx = tp[0] - pos[0];
          const bz = tp[2] - pos[2];
          if ((bx * bx + bz * bz) > blastR2) continue;
          destroyBlock(t, tp[0], tp[2], 0.7);
        }
      }
      break;
    }
  };

  const handlePuckMissByPaddleBack = () => {
    if (state.puckMissGraceSec > 0.0) return;
    // 仕様:
    // - paddleNode ローカルZ正領域へ「入った瞬間」にのみ1機減算
    // - 入った後に領域内へ留まり続けても追加減算しない
    const enteredNow = state.puckInPaddleLocalZPositive && !state.puckWasInPaddleLocalZPositive;
    if (!enteredNow) return;

    state.packsRemain = Math.max(0, state.packsRemain - 1);
    stageFlow.triggerPackEvent(`PACK -1  (${state.packsRemain})`);
    spawnSparks(state.puckX, PUCK_Y, state.puckZ, Math.atan2(state.puckVz, state.puckVx));
    if (state.audioUnlocked) audio.playSe("damage");
    if (state.packsRemain <= 0) {
      stageFlow.endGame("PACK EMPTY");
    }
  };

  // パック更新の統合ステップ
  // 位置更新 -> 各衝突処理 -> ノード姿勢反映
  const updatePuck = (dt) => {
    updatePuckBacksideState();
    updatePuckVisualByBackside();
    if (state.stageIntroSec > 0.0) return;
    if (state.puckMissGraceSec > 0.0) {
      state.puckMissGraceSec = Math.max(0.0, state.puckMissGraceSec - dt);
    }
    state.puckX += state.puckVx * dt;
    state.puckZ += state.puckVz * dt;
    updatePuckBacksideState();
    handlePuckMissByPaddleBack();
    if (state.gameFinished) {
      updatePuckVisualByBackside();
      puckNode.setPosition(state.puckX, PUCK_Y, state.puckZ);
      puckShadowNode.setPosition(state.puckX, SHADOW_Y, state.puckZ);
      return;
    }

    // 正領域にいても衝突判定は継続する
    handlePaddleCollision(dt);
    handleWallCollision();
    handleBlockCollisions();
    updatePuckBacksideState();
    updatePuckVisualByBackside();
    updateSupplyHighlight();
    state.puckWasInPaddleLocalZPositive = state.puckInPaddleLocalZPositive;
    if (state.wallSeCooldown > 0.0) state.wallSeCooldown -= dt;
    if (state.blockHitCooldown > 0.0) state.blockHitCooldown -= dt;

    puckNode.setPosition(state.puckX, PUCK_Y, state.puckZ);
    puckNode.rotateY(640.0 * dt);
    puckShadowNode.setPosition(state.puckX, SHADOW_Y, state.puckZ);
  };

  return {
    state,
    getSceneSignals,
    updateStageMissionText,
    prepareStageIntro,
    unlockAudio,
    takeScreenshot,
    beginStagePlay,
    resetPaddleToInitial,
    resetPuck,
    resetBlocks: stageFlow.resetBlocks,
    endGame: stageFlow.endGame,
    restartGame,
    updatePaddle,
    updatePuck,
    updateStageFlow: stageFlow.updateStageFlow,
    updateLevel: stageFlow.updateLevel,
    getActiveParticleCount: () => sparkEmitter?.getAliveCount?.() ?? 0
  };
};
