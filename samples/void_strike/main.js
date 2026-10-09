// main.js 2026/09/25
// 星間戦闘の入力、wave進行、衝突、Compute火花、HUD、音楽を接続する
import { parseSceneYAML } from "../../webg/SceneYaml.js";
import GameAudioSynth from "../../webg/GameAudioSynth.js";
import ShooterApp from "./ShooterApp.js";
import { createStarfighterScene } from "./space_scene.js";

const elements = new Map();
for (const id of ["stage", "hud-score", "hud-wave", "hud-hull", "hud-combo", "boost-fill",
  "wave-banner", "overlay", "overlay-kicker", "overlay-title", "overlay-copy", "start-run",
  "pause-button", "sound-button", "fire-button", "error-panel", "loading"]) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`void_strike requires #${id}`);
  elements.set(id, element);
}
const element = id => elements.get(id);

let sceneApp = null;
let world = null;
let audio = null;
let audioEnabled = false;
let phase = "title";
let elapsedSec = 0;
let spawnTimer = 0;
let waveClearTimer = 0;
let wave = 1;
let waveSpawned = 0;
let waveQuota = 5;
let score = 0;
let combo = 0;
let comboTimer = 0;
let hull = 3;
let shotTimer = 0;
let enemyShotTimer = 0.8;
let shieldTimer = 0;
let hitBlinkTimer = 0;
let hitLightTimer = 0;
let boostEnergy = 100;
let boostFxTimer = 0;
let fireAudioTimer = 0;
let idSequence = 0;
let randomState = 0x51f15e5d;
const touchState = { left: false, right: false, up: false, down: false, fire: false, boost: false };
const LANES = [-8.5, -4.3, 0, 4.3, 8.5];

// HUDの文字列を状態から一度に構築し、プレイ状況と操作結果を同じ箇所へ表示する
function updateHud() {
  element("hud-score").textContent = String(score).padStart(7, "0");
  element("hud-wave").textContent = String(wave).padStart(2, "0");
  element("hud-hull").textContent = `${"◆".repeat(hull)}${"◇".repeat(3 - hull)}`;
  element("hud-combo").textContent = combo > 1 ? `x${combo}` : "READY";
  element("boost-fill").style.width = `${boostEnergy.toFixed(1)}%`;
  element("pause-button").textContent = phase === "paused" ? "RESUME" : "PAUSE";
}

// タイトル、ポーズ、ゲーム終了を同じoverlay領域で説明し、開始操作を分かりやすくする
function showOverlay(mode, title, copy, buttonText) {
  phase = mode;
  element("overlay-kicker").textContent = mode === "gameover" ? "MISSION FAILED" : "DEEP SPACE · SECTOR 07";
  element("overlay-title").textContent = title;
  element("overlay-copy").textContent = copy;
  element("start-run").textContent = buttonText;
  element("overlay").classList.remove("is-hidden");
  updateHud();
}

// overlayを閉じ、通常のプレイ画面へ切り替える
function hideOverlay() {
  element("overlay").classList.add("is-hidden");
}

// 乱数系列を固定seedで進め、waveごとの敵配置と左右揺れを再現可能にする
function random01() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 4294967296;
}

// 現在押されているkeyboard actionとタッチ状態を一つの移動入力として扱う
function actionDown(name) {
  if (touchState[name]) return true;
  const actionName = name === "boost" ? "boost" : name;
  return sceneApp.app.getAction(actionName);
}

// AudioContextをユーザー操作中に有効化し、音楽とゲーム効果音を同じSynthから出す
async function enableAudio() {
  if (!audio) {
    audio = new GameAudioSynth();
    audio.setMasterVolume(0.42);
    audio.setBgmVolume(0.28);
    audio.setSeVolume(0.55);
    audio.setMelody("run_neon");
  }
  await audio.resume();
  audioEnabled = true;
  if (phase === "running") audio.startBgm();
  element("sound-button").textContent = "SOUND ON";
  element("sound-button").setAttribute("aria-pressed", "true");
}

// 音楽を開始または停止し、AudioContextの制限に合わせてユーザー操作時にresumeする
async function toggleAudio() {
  if (audioEnabled) {
    audioEnabled = false;
    audio?.stopBgm();
    element("sound-button").textContent = "SOUND OFF";
    element("sound-button").setAttribute("aria-pressed", "false");
    return;
  }
  await enableAudio();
}

// 再スタート時に敵弾と味方弾をpoolへ戻し、ゲーム状態を初期値へそろえる
function resetRun() {
  elapsedSec = 0;
  wave = 1;
  waveSpawned = 0;
  waveQuota = 5;
  score = 0;
  combo = 0;
  comboTimer = 0;
  hull = 3;
  shotTimer = 0;
  enemyShotTimer = 0.8;
  shieldTimer = 0;
  hitBlinkTimer = 0;
  hitLightTimer = 0;
  boostEnergy = 100;
  spawnTimer = 0.5;
  waveClearTimer = 0;
  boostFxTimer = 0;
  fireAudioTimer = 0;
  idSequence = 0;
  randomState = 0x51f15e5d;
  world.player.x = 0;
  world.player.y = -1;
  world.player.node.setPosition(0, -1, 10);
  world.player.node.setAttitude(0, 0, 0);
  for (const enemy of world.enemies) world.setCraftVisible(enemy, false);
  for (const bolt of [...world.playerBolts, ...world.enemyBolts]) world.releaseBolt(bolt);
  sceneApp.getComputeParticleEmitter("cyan-sparks").clear();
  sceneApp.getComputeParticleEmitter("hot-sparks").clear();
  updateHud();
}

// 新しい出撃を始め、音声が有効ならBGMを再開する
function startRun() {
  resetRun();
  hideOverlay();
  phase = "running";
  if (audioEnabled) audio.startBgm();
  updateHud();
}

// 一機をwaveの編成規則に従って出現させ、耐久値と大きさを種類別に決める
function spawnEnemy() {
  const index = waveSpawned;
  const lane = LANES[index % LANES.length];
  const row = Math.floor(index / LANES.length);
  const heavy = wave >= 2 && (index + wave) % 4 === 1;
  const offset = (random01() - 0.5) * 1.1;
  world.activateEnemy({
    x: lane + offset,
    y: ((index % 3) - 1) * 2.25 + (random01() - 0.5) * 0.7,
    z: -38 - row * 4,
    hp: heavy ? 2 + Math.floor(wave / 5) : 1,
    radius: heavy ? 1.35 : 0.82,
    phase: idSequence++,
    kind: heavy ? "heavy" : "drone"
  });
  waveSpawned++;
}

// 最寄りの生きた敵へ向かう敵弾を発射し、全waveに共通する弾幕密度を制限する
function spawnEnemyBolt(enemy) {
  const player = world.player;
  const dx = player.x - enemy.x;
  const dy = player.y - enemy.y;
  const dz = player.z - enemy.z;
  const distance = Math.hypot(dx, dy, dz);
  const speed = enemy.kind === "heavy" ? 13.5 : 11.5;
  world.fireBolt(world.enemyBolts, {
    x: enemy.x,
    y: enemy.y,
    z: enemy.z + 0.8,
    vx: dx / distance * speed,
    vy: dy / distance * speed,
    vz: dz / distance * speed,
    radius: enemy.kind === "heavy" ? 0.34 : 0.25
  });
}

// 先頭二門から青白いboltを同時発射し、弾数を固定poolの範囲に保つ
function firePlayerVolley() {
  const player = world.player;
  for (const side of [-1, 1]) {
    world.fireBolt(world.playerBolts, {
      x: player.x + side * 0.48,
      y: player.y + 0.02,
      z: player.z - 1.05,
      vx: 0,
      vy: 0,
      vz: -36,
      radius: 0.45
    });
  }
  if (audioEnabled && fireAudioTimer <= 0) {
    audio.playGameTone(860, 0.055, "piano", { type: "square", gain: 0.045, release: 0.04 });
    fireAudioTimer = 0.1;
  }
}

// 撃破位置へCompute粒子を散らし、色付きHDR光と得点・comboを更新する
function destroyEnemy(enemy) {
  world.setCraftVisible(enemy, false);
  const heavyBonus = enemy.kind === "heavy" ? 2 : 1;
  combo++;
  comboTimer = 3.2;
  score += (enemy.kind === "heavy" ? 260 : 100) * wave * Math.min(combo, 8);
  const colorDirection = [0.18, 0.45, 0.9];
  sceneApp.getComputeParticleEmitter("cyan-sparks").emit(enemy.kind === "heavy" ? 48 : 26, {
    position: [enemy.x, enemy.y, enemy.z],
    direction: colorDirection,
    spreadAngle: 180,
    speed: enemy.kind === "heavy" ? [3.2, 10] : [2.4, 7.2],
    lifetime: [0.32, 0.9]
  });
  sceneApp.getComputeParticleEmitter("hot-sparks").emit(enemy.kind === "heavy" ? 26 : 14, {
    position: [enemy.x, enemy.y, enemy.z],
    direction: colorDirection,
    spreadAngle: 150,
    speed: [2.2, 7.4],
    lifetime: [0.28, 0.72]
  });
  sceneApp.lights[4].position = [enemy.x, enemy.y, enemy.z];
  sceneApp.lights[4].intensity = enemy.kind === "heavy" ? 15 : 9;
  if (audioEnabled && heavyBonus) {
    audio.playGameTone(enemy.kind === "heavy" ? 190 : 300, 0.16, "woodwind", {
      gain: enemy.kind === "heavy" ? 0.12 : 0.075,
      release: 0.22,
      pan: Math.max(-0.8, Math.min(0.8, enemy.x / 12))
    });
  }
}

// 被弾時に耐久値、無敵時間、火花、画面演出を更新する
function damagePlayer() {
  if (shieldTimer > 0 || phase !== "running") return;
  hull--;
  shieldTimer = 1.25;
  hitBlinkTimer = 0;
  combo = 0;
  comboTimer = 0;
  sceneApp.getComputeParticleEmitter("hot-sparks").emit(52, {
    position: [world.player.x, world.player.y, world.player.z],
    direction: [0, 0, 1], spreadAngle: 155,
    speed: [3, 8], lifetime: [0.25, 0.72]
  });
  sceneApp.getComputeParticleEmitter("cyan-sparks").emit(22, {
    position: [world.player.x, world.player.y, world.player.z],
    direction: [0, 0, 1], spreadAngle: 150,
    speed: [2, 6], lifetime: [0.25, 0.65]
  });
  sceneApp.lights[3].intensity = 14;
  hitLightTimer = 0.28;
  if (audioEnabled) audio.playGameTone(115, 0.28, "piano", { gain: 0.18, release: 0.35 });
  updateHud();
  if (hull <= 0) {
    phase = "gameover";
    audio?.stopBgm();
    showOverlay("gameover", "SHIP LOST", `SCORE ${String(score).padStart(7, "0")}  ·  WAVE ${wave}`, "REDEPLOY");
  }
}

// 機体の位置と傾きを入力へ追従させ、エネルギーを消費するboostを適用する
function updatePlayer(deltaSec) {
  const player = world.player;
  const axisX = Number(actionDown("right")) - Number(actionDown("left"));
  const axisY = Number(actionDown("up")) - Number(actionDown("down"));
  const boosting = actionDown("boost") && boostEnergy > 0;
  const speed = boosting ? 15.5 : 10.5;
  const moveLength = Math.hypot(axisX, axisY);
  const scale = moveLength > 1 ? 1 / moveLength : 1;
  player.x = Math.max(-10.6, Math.min(10.6, player.x + axisX * scale * speed * deltaSec));
  player.y = Math.max(-6.1, Math.min(6.1, player.y + axisY * scale * speed * deltaSec));
  player.node.setPosition(player.x, player.y, player.z);
  player.node.setAttitude(-axisY * 12, 0, -axisX * 22);
  if (boosting) {
    boostEnergy = Math.max(0, boostEnergy - 43 * deltaSec);
    shieldTimer = Math.max(shieldTimer, 0.08);
    boostFxTimer -= deltaSec;
    if (boostFxTimer <= 0) {
      sceneApp.getComputeParticleEmitter("cyan-sparks").emit(5, {
        position: [player.x, player.y, player.z + 1.05],
        direction: [0, 0, 1], spreadAngle: 24,
        speed: [2, 5], lifetime: [0.2, 0.48]
      });
      boostFxTimer = 0.075;
    }
  } else {
    boostEnergy = Math.min(100, boostEnergy + 22 * deltaSec);
  }
  if (shieldTimer > 0) {
    shieldTimer -= deltaSec;
    hitBlinkTimer += deltaSec;
    const visible = Math.floor(hitBlinkTimer * 12) % 2 === 0;
    for (const shape of player.parts) shape.hide(!visible);
    if (shieldTimer <= 0) for (const shape of player.parts) shape.hide(false);
  }
  shotTimer -= deltaSec;
  fireAudioTimer -= deltaSec;
  if (actionDown("fire") && shotTimer <= 0) {
    firePlayerVolley();
    shotTimer = 0.135;
  }
  sceneApp.updatePlayerLight([player.x, player.y, player.z]);
}

// 敵機を前進・蛇行させ、waveの射出列と敵弾の周期を保つ
function updateEnemies(deltaSec) {
  spawnTimer -= deltaSec;
  if (waveSpawned < waveQuota && spawnTimer <= 0) {
    spawnEnemy();
    spawnTimer = Math.max(0.36, 0.72 - wave * 0.018);
  }
  enemyShotTimer -= deltaSec;
  let activeCount = 0;
  for (const enemy of world.enemies) {
    if (!enemy.active) continue;
    activeCount++;
    enemy.z += (enemy.kind === "heavy" ? 7.5 : 9.2 + wave * 0.24) * deltaSec;
    enemy.x = enemy.baseX + Math.sin(elapsedSec * 1.5 + enemy.phase) * 1.1;
    enemy.y = enemy.baseY + Math.cos(elapsedSec * 1.1 + enemy.phase * 0.7) * 0.55;
    enemy.node.setPosition(enemy.x, enemy.y, enemy.z);
    enemy.node.rotateZ(Math.sin(elapsedSec * 1.6 + enemy.phase) * deltaSec * 24);
    enemy.fireCooldown -= deltaSec;
    if (enemyShotTimer <= 0 && enemy.fireCooldown <= 0 && enemy.z > -18) {
      spawnEnemyBolt(enemy);
      enemy.fireCooldown = enemy.kind === "heavy" ? 1.45 : 2.1;
      enemyShotTimer = 0.72;
    }
    if (enemy.z > 9.2) {
      world.setCraftVisible(enemy, false);
      damagePlayer();
      activeCount--;
    } else if (Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y,
      (enemy.z - world.player.z) * 0.72) < enemy.radius + 0.7) {
      world.setCraftVisible(enemy, false);
      damagePlayer();
      activeCount--;
    }
  }
  if (waveSpawned >= waveQuota && activeCount === 0) {
    waveClearTimer += deltaSec;
    if (waveClearTimer >= 1.05) {
      wave++;
      waveSpawned = 0;
      waveQuota = Math.min(11, 5 + Math.floor((wave - 1) * 1.2));
      waveClearTimer = 0;
      spawnTimer = 0.75;
      const banner = element("wave-banner");
      banner.textContent = `WAVE ${String(wave).padStart(2, "0")}`;
      banner.classList.remove("pulse");
      void banner.offsetWidth;
      banner.classList.add("pulse");
      if (audioEnabled) audio.playGameTone(510, 0.18, "woodwind", { gain: 0.08, release: 0.26 });
    }
  } else {
    waveClearTimer = 0;
  }
}

// 味方boltを前進させて敵の距離球と照合し、撃破または画面外でpoolへ戻す
function updatePlayerBolts(deltaSec) {
  for (const bolt of world.playerBolts) {
    if (!bolt.active) continue;
    bolt.z += bolt.vz * deltaSec;
    bolt.node.setPosition(bolt.x, bolt.y, bolt.z);
    if (bolt.z < -46) {
      world.releaseBolt(bolt);
      continue;
    }
    for (const enemy of world.enemies) {
      if (!enemy.active) continue;
      const range = enemy.radius + bolt.radius;
      if (Math.hypot(bolt.x - enemy.x, bolt.y - enemy.y,
        (bolt.z - enemy.z) * 0.9) > range) continue;
      world.releaseBolt(bolt);
      enemy.hp--;
      sceneApp.getComputeParticleEmitter("hot-sparks").emit(12, {
        position: [enemy.x, enemy.y, enemy.z], direction: [0, 0, -1],
        spreadAngle: 90, speed: [1.2, 3.5], lifetime: [0.18, 0.4]
      });
      if (enemy.hp <= 0) destroyEnemy(enemy);
      break;
    }
  }
}

// 敵boltを移動させ、機体との接触、画面外到達、pool再利用を処理する
function updateEnemyBolts(deltaSec) {
  for (const bolt of world.enemyBolts) {
    if (!bolt.active) continue;
    bolt.x += bolt.vx * deltaSec;
    bolt.y += bolt.vy * deltaSec;
    bolt.z += bolt.vz * deltaSec;
    bolt.node.setPosition(bolt.x, bolt.y, bolt.z);
    if (bolt.z > 15 || Math.abs(bolt.x) > 18 || Math.abs(bolt.y) > 12) {
      world.releaseBolt(bolt);
      continue;
    }
    if (Math.hypot(bolt.x - world.player.x, bolt.y - world.player.y,
      (bolt.z - world.player.z) * 0.9) < bolt.radius + 0.62) {
      world.releaseBolt(bolt);
      damagePlayer();
    }
  }
}

// 宇宙ゲートと星空をスクロールさせ、ゲームphaseに応じて背景の動き方を変える
function updateScenery(deltaSec) {
  const speed = phase === "running" ? 13.5 : 3.2;
  for (const gate of world.gateNodes) {
    let z = gate.node.getPosition()[2] + speed * deltaSec;
    if (z > 20) z -= 160;
    gate.node.setPosition(0, 0, z);
    gate.node.rotateZ(deltaSec * (gate.index % 2 ? -4 : 3));
  }
  world.starNode.rotateZ(deltaSec * (phase === "running" ? 0.28 : 0.08));
}

// 1 frame分のゲーム進行を更新し、停止phaseでは背景とHUDだけを保つ
function updateFrame({ deltaSec }) {
  const dt = Math.min(Math.max(deltaSec, 0), 0.04);
  updateScenery(dt);
  if (phase !== "running") return;
  elapsedSec += dt;
  if (sceneApp.app.wasActionPressed("pause")) {
    showOverlay("paused", "SYSTEM PAUSED", "PRESS P OR SELECT RESUME TO RETURN TO THE FIGHT", "RESUME");
    audio?.stopBgm();
    return;
  }
  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) combo = 0;
  }
  updatePlayer(dt);
  updateEnemies(dt);
  if (phase !== "running") return;
  updatePlayerBolts(dt);
  updateEnemyBolts(dt);
  sceneApp.lights[4].intensity = Math.max(3.5, sceneApp.lights[4].intensity - dt * 20);
  if (hitLightTimer > 0) {
    hitLightTimer = Math.max(0, hitLightTimer - dt);
    sceneApp.lights[3].intensity = 7 + 7 * (hitLightTimer / 0.28);
  }
  updateHud();
}

// キーボードを登録し、ゲーム中にOrbit EyeRigが同じキーを消費しないようにする
function installInput() {
  sceneApp.app.registerActionMap({
    left: ["arrowleft", "a"],
    right: ["arrowright", "d"],
    up: ["arrowup", "w"],
    down: ["arrowdown", "s"],
    fire: ["space"],
    boost: ["shift"],
    start: ["enter"],
    pause: ["p", "escape"]
  });
  sceneApp.app.input.attach({
    onKeyDown: (key, event) => {
      if (event.repeat) return;
      if (key === "enter" && (phase === "title" || phase === "gameover")) startRun();
      if ((key === "p" || key === "escape") && phase === "paused") {
        hideOverlay();
        phase = "running";
        if (audioEnabled) audio.startBgm();
      }
    }
  });
  for (const control of document.querySelectorAll("[data-control]")) {
    const action = control.dataset.control;
    control.addEventListener("pointerdown", event => {
      event.preventDefault();
      control.setPointerCapture(event.pointerId);
      touchState[action] = true;
    });
    for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
      control.addEventListener(eventName, () => { touchState[action] = false; });
    }
  }
}

// SceneYAMLのPBR/Emitter設定から星間戦場を組み立て、入力と表示を有効にする
async function start() {
  const response = await fetch(new URL("./scene.yaml", import.meta.url));
  if (!response.ok) throw new Error(`SceneYAML: HTTP ${response.status}`);
  const manifest = parseSceneYAML(await response.text());
  sceneApp = await ShooterApp.create({
    project: manifest,
    label: "void_strike",
    renderMode: "continuous",
    physics: false,
    camera: { target: [0, 0, -22], distance: 49, yaw: 0, pitch: -3,
      minDistance: 49, maxDistance: 49 },
    effects: { shadow: true, ssao: false, ssr: true, dof: false },
    createScene: ({ app }) => {
      world = createStarfighterScene(app);
      return { kind: "callback", runtime: world, nodes: world.nodes,
        getNode: id => {
          const node = world.nodes.get(String(id));
          if (!node) throw new Error(`void_strike node is unavailable: ${id}`);
          return node;
        } };
    },
    onUpdate: updateFrame,
    onError: showError
  });
  sceneApp.app.getGPU().device.addEventListener("uncapturederror", event => showError(event.error));
  Object.assign(sceneApp.renderer.pipeline.bloomOptions, {
    enabled: true, threshold: 0.92, softKnee: 0.42, strength: 0.72, filterRadius: 1.1
  });
  installInput();
  element("start-run").addEventListener("click", startRun);
  element("pause-button").addEventListener("click", () => {
    if (phase === "running") {
      showOverlay("paused", "SYSTEM PAUSED", "PRESS P OR SELECT RESUME TO RETURN TO THE FIGHT", "RESUME");
      audio?.stopBgm();
    } else if (phase === "paused") {
      hideOverlay();
      phase = "running";
      if (audioEnabled) audio.startBgm();
    }
  });
  element("sound-button").addEventListener("click", () => toggleAudio().catch(showError));
  element("loading").classList.add("is-hidden");
  showOverlay("title", "VOID STRIKE", "PILOT THE LAST INTERCEPTOR THROUGH THE RIFT. BREAK THE FORMATION, CHAIN YOUR HITS, AND HOLD THE LINE.", "START RUN");
  sceneApp.start();
}

// エラー原因を表示し、未処理の入力・BGM・フレーム更新を止める
function showError(error) {
  const panel = element("error-panel");
  panel.hidden = false;
  panel.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  sceneApp?.stop();
  audio?.stopBgm();
  console.error(error);
}

// ページを離れる時に音とSceneAppのGPU資源を解放する
function destroy() {
  audio?.stopBgm();
  sceneApp?.destroy();
  audio = null;
  world = null;
  sceneApp = null;
}

window.addEventListener("pagehide", destroy);
window.addEventListener("error", event => showError(event.error ?? new Error(event.message)));
start().catch(error => { showError(error); destroy(); });
