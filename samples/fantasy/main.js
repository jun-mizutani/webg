// ---------------------------------------------
// main.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 翠の砦: 入力、ターン進行、Nodeの更新をPBRシーンへ接続する

import Matrix from "../../webg/Matrix.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";
import FantasyApp from "./FantasyApp.js";
import { createManifest } from "./scene.js";
import { Visuals } from "./visuals.js";
import WaterBody from "../../webg/WaterBody.js";
import {
  tiles, key, tileAt, world, newUnits, occupant,
  paths, canAttack, damage, outcome, enemyPlan
} from "./rules.mjs";

// 指定IDの操作部品を取得し、UIの更新とevent登録に使う参照を返す
const element = selector => document.querySelector(selector);
const grid = new Map();
const party = new Map();

// 表示用の説明と、rulesが保持する能力・行動状態を分ける
const roles = {
  knight: { icon: "⚔", description: "隣接する敵に剣で攻撃。重装甲で前線を支える。" },
  mage: { icon: "✦", description: "射程3の魔法。段差と障害物を越えて攻撃。" },
  ranger: { icon: "➶", description: "射程4の弓。移動力5で側面と高所を狙う。" }
};

let sceneApp = null;
let visuals = null;
let water = null;
let waterTime = 1.5;
let units = newUnits();
let selected = "knight";
let round = 1;
let turn = "ally";
let busy = false;
let finished = false;
let failed = false;
let motion = null;
let reachable = new Map();

// ログを新しい順に表示し、DOMへ残す件数を上限内に保つ
function log(message) {
  const item = document.createElement("li");
  item.textContent = message;
  element("#log").prepend(item);

  while (element("#log").children.length > 24) {
    element("#log").lastChild.remove();
  }
}

// 初期化・操作・GPUの失敗を同じ表示へ集め、失敗後の入力と更新を止める
function showError(error) {
  if (failed) return;
  failed = true;

  element("#error").hidden = false;
  element("#error").textContent = `戦場でエラーが発生しました: ${error.message ?? error}`;
  element("#loading").hidden = true;
  element("#caustics").disabled = true;

  for (const button of document.querySelectorAll("button")) {
    button.disabled = true;
  }

  sceneApp?.stop();
  console.error(error);
}

// UIから参照する選択中のユニットを、毎回現在の戦闘データから取得する
function current() {
  return units.find(unit => unit.id === selected);
}

// 操作による論理状態の変更は、行動アニメーション終了後の味方ターンで受け付ける
function canControl(unit) {
  return unit && unit.hp > 0 && unit.team === "ally"
    && turn === "ally" && !busy && !finished && !failed;
}

// 3Dと補助盤のどちらからも、同じ選択処理へ入る
function select(id) {
  if (busy || turn !== "ally" || finished) return;
  const unit = units.find(candidate => candidate.id === id);
  if (!unit || unit.hp <= 0) return;

  selected = id;
  refresh();
}

// DOMは起動時に一度作り、戦闘中は表示とenabled状態だけを更新する
function setupUI() {
  for (const unit of units.filter(candidate => candidate.team === "ally")) {
    const button = document.createElement("button");
    button.className = "party-card";
    button.setAttribute("aria-label", `${unit.name} ${unit.role}を選択`);
    button.innerHTML = `
      <span class="portrait">${roles[unit.id].icon}</span>
      <span class="party-info">
        <strong>${unit.name}</strong><small>${unit.role}</small><p></p>
      </span>`;
    button.onclick = () => select(unit.id);

    element("#party").append(button);
    party.set(unit.id, button);
  }

  for (const tile of tiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.onclick = () => choose(tile.x, tile.z).catch(showError);
    element("#grid").append(button);
    grid.set(key(tile.x, tile.z), button);
  }

  element("#wait").onclick = () => {
    const unit = current();
    if (!canControl(unit)) return;

    unit.moved = true;
    unit.acted = true;
    log(`${unit.name}は待機した。`);
    refresh();
  };

  element("#end-turn").onclick = () => runEnemyTurn().catch(showError);
  element("#restart").onclick = reset;
  element("#again").onclick = reset;
}

// 操作可能な内容を、選択中の能力と進行状態から文章へ変える
function describeAction(unit) {
  if (finished) return "戦闘終了";
  if (busy) return turn === "enemy" ? "敵が行動しています…" : "行動中…";
  if (unit?.acted) {
    return `${unit.name}は行動済み。他の味方を選ぶか、ターンを終了します。`;
  }
  if (unit?.moved) {
    return `${unit.name}：射程内の敵をクリックして攻撃。待機でも行動を終了できます。`;
  }
  return `${unit?.name ?? "味方"}を選択中。青いマスへ移動、または射程内の敵を攻撃。`;
}

// 部隊一覧はHPと行動権を示し、戦闘不能のユニットを選択から外す
function refreshParty() {
  for (const unit of units.filter(candidate => candidate.team === "ally")) {
    const button = party.get(unit.id);
    const status = unit.hp <= 0 ? "戦闘不能"
      : unit.acted ? "行動済み"
      : unit.moved ? "攻撃できます" : "移動・攻撃できます";

    button.className = `party-card ${unit.id === selected ? "selected" : ""} ${unit.hp <= 0 ? "fallen" : ""}`;
    button.disabled = busy || turn !== "ally" || unit.hp <= 0 || finished;
    button.setAttribute("aria-pressed", String(unit.id === selected));
    button.querySelector("p").textContent = `HP ${unit.hp}/${unit.maxHp} · ${status}`;
  }
}

// 補助盤と3Dの移動範囲は、同じ経路探索結果を使って表示する
function refreshGrid() {
  for (const tile of tiles) {
    const id = key(tile.x, tile.z);
    const unit = occupant(units, tile.x, tile.z);
    const button = grid.get(id);
    const canMove = reachable.has(id) && !unit;

    button.textContent = unit
      ? (unit.team === "ally" ? roles[unit.id].icon : "◆")
      : (tile.blocked ? "▧" : String(tile.h));
    button.className = [
      unit?.team ?? "", canMove ? "reachable" : "",
      unit?.id === selected ? "active" : ""
    ].join(" ");
    button.setAttribute("aria-label",
      `列${tile.x + 1} 行${tile.z + 1} 高さ${tile.h}`
      + (unit ? ` ${unit.name} HP ${unit.hp}` : "")
      + (tile.blocked ? " 障害物" : "")
      + (canMove ? " 移動可能" : ""));
    button.disabled = busy || finished || turn !== "ally" || tile.blocked;

    visuals?.markers.get(id).hide(!canMove);
  }
}

// 行動の区切りでUIを再計算し、各フレームでは既存のボタンを維持する
function refresh() {
  const unit = current();
  reachable = canControl(unit) && !unit.moved && !unit.acted
    ? paths(unit, units) : new Map();

  element("#phase").textContent = `TURN ${String(round).padStart(2, "0")} · ${turn === "ally" ? "味方の行動" : "敵の行動"}`;
  element("#unit-name").textContent = unit ? `${unit.name} / ${unit.role}` : "味方を選択";
  element("#stats").textContent = unit ? `HP ${unit.hp}/${unit.maxHp}　移動 ${unit.move}　射程 ${unit.range}` : "";
  element("#ability").textContent = roles[unit?.id]?.description ?? "";
  element("#hint").textContent = describeAction(unit);
  element("#end-turn").disabled = busy || finished || turn !== "ally" || failed;
  element("#restart").disabled = busy || failed;
  element("#wait").disabled = !canControl(unit) || unit.acted;

  refreshParty();
  refreshGrid();

  if (!visuals) return;
  visuals.selection.hide(!unit || unit.hp <= 0 || finished);
  if (unit) {
    const position = world(unit);
    position[1] += 0.13;
    visuals.selection.setPosition(...position);
  }
  for (const candidate of units) visuals.visible(candidate);
}

// 既存GPU資源を再利用し、論理状態・Node・粒子・DOMを初期状態へ戻す
function reset() {
  if (busy || failed) return;

  units = newUnits();
  round = 1;
  turn = "ally";
  selected = "knight";
  finished = false;
  motion = null;

  for (const unit of units) visuals.place(unit);
  for (const emitter of sceneApp.particleEmitters.values()) emitter.clear();

  element("#result").hidden = true;
  element("#log").replaceChildren();
  log("水に沈んだ星晶の丘に到着。敵をすべて倒してください。");
  refresh();
}

// asyncな行動手順とonUpdateをつなぐ。完了通知はNodeの最終姿勢を適用した後に返す
function animate(kind, data, duration) {
  return new Promise(resolve => {
    motion = { kind, ...data, duration, time: 0, resolve };
  });
}

// 標準Emitterへ発生条件だけを渡す。GPUの更新・PBR合成はWebgSceneAppに任せる
function emit(id, count, position, extra = {}) {
  sceneApp.getComputeParticleEmitter(id).emit(count, {
    position, direction: [0, 1, 0], spreadAngle: 95,
    speed: [0.5, 2], lifetime: [0.25, 0.6], ...extra
  });
}

// 一区間ずつ歩行を待ち、表示が到着した時点でマス座標を確定する
async function move(unit, path) {
  if (!path.length) return;
  const rig = visuals.rigs.get(unit.id);

  for (const tile of path) {
    const from = world(unit);
    const to = world(tile);
    const duration = 0.27 + (to[1] > from[1] ? 0.12 : 0);

    visuals.face(rig, from, to);
    await animate("walk", { unit, rig, from, to }, duration);

    unit.x = tile.x;
    unit.z = tile.z;
    rig.root.setPosition(...to);
    visuals.pose(rig, 0);
    emit("steps", 12, to);
  }

  unit.moved = true;
  log(`${unit.name}が移動。標高 ${tileAt(unit.x, unit.z).h}。`);
}

// 攻撃表示→ダメージ確定→被弾表示の順序を保ち、最後に勝敗を調べる
async function attack(attacker, target) {
  const rig = visuals.rigs.get(attacker.id);
  const from = world(attacker);
  const to = world(target);
  from[1] += 0.95;
  to[1] += 0.8;
  visuals.face(rig, from, to);

  await animate("attack", { unit: attacker, rig, from, to, ranged: attacker.range > 1 }, 0.55);

  const hit = damage(attacker, target);
  target.hp = Math.max(0, target.hp - hit);
  attacker.acted = true;
  attacker.moved = true;

  const effect = attacker.id === "mage" || attacker.id === "hex" ? "magic" : "hit";
  emit(effect, 95, to, { spreadAngle: 160, speed: [1, 4], lifetime: [0.35, 0.85] });
  log(`${attacker.name} → ${target.name}：${hit}ダメージ`
    + (target.hp === 0 ? "、撃破！" : "")
    + (hit > attacker.power ? "（高所 +3）" : ""));

  const targetRig = visuals.rigs.get(target.id);
  await animate("hit", { unit: target, rig: targetRig, from: world(target) }, 0.24);
  targetRig.root.setPosition(...world(target));
  visuals.visible(target);
  checkResult();
}

// 勝敗は生存ユニットから決め、結果画面だけをここで更新する
function checkResult() {
  const result = outcome(units);
  if (!result) return;
  finished = true;

  element("#result-caption").textContent = result === "victory" ? "MISSION COMPLETE" : "MISSION FAILED";
  element("#result-title").textContent = result === "victory" ? "丘に、光が戻る。" : "星晶は闇に沈んだ。";
  element("#result-text").textContent = result === "victory"
    ? `${round}ターンで敵を撃破。あなたの部隊は星晶を守り抜いた。`
    : "味方が全滅しました。高所と遠隔攻撃を使って再挑戦してください。";
  element("#result").hidden = false;
}

// 3Dクリックと補助盤を同じマス座標へそろえてから、選択・攻撃・移動を判断する
async function choose(x, z) {
  const unit = current();
  if (!canControl(unit)) return;
  const target = occupant(units, x, z);

  if (target?.team === "ally") {
    select(target.id);
    return;
  }

  const route = reachable.get(key(x, z));
  const attacks = target?.team === "enemy" && !unit.acted && canAttack(unit, target);
  const moves = !target && route?.path.length && !unit.moved && !unit.acted;

  if (!attacks && !moves) {
    element("#hint").textContent = target?.team === "enemy"
      ? "その敵は射程外、または行動済みです。先に移動してください。"
      : "そのマスへは移動できません。青いマスを選択してください。";
    return;
  }

  busy = true;
  refresh();
  try {
    if (attacks) await attack(unit, target);
    else await move(unit, route.path);
  } finally {
    busy = false;
    refresh();
  }
}

// 敵を順番に動かし、全員の表示が完了してから次の味方ターンを始める
async function runEnemyTurn() {
  if (busy || finished || turn !== "ally") return;
  busy = true;
  turn = "enemy";
  log(`第${round}ターン：敵の行動。`);
  refresh();

  try {
    for (const enemy of units.filter(unit => unit.team === "enemy" && unit.hp > 0)) {
      const plan = enemyPlan(enemy, units);
      await move(enemy, plan.path);
      refresh();

      const targets = units.filter(unit => canAttack(enemy, unit)).sort((a, b) => a.hp - b.hp);
      if (targets.length) await attack(enemy, targets[0]);
      else await animate("pause", {}, 0.2);
      if (finished) break;
    }

    if (!finished) {
      round++;
      turn = "ally";
      for (const unit of units) {
        unit.moved = false;
        unit.acted = false;
      }
      if (current()?.hp <= 0) selected = units.find(unit => unit.team === "ally" && unit.hp > 0)?.id;
      log(`第${round}ターン：味方の行動。`);
    }
  } finally {
    busy = false;
    refresh();
  }
}

// 秒単位の補間で歩行・攻撃・被弾の表示を進め、マス座標は行動確定時に更新する
function updateMotion(deltaSec) {
  if (!motion) return;
  const animation = motion;
  animation.time += deltaSec;
  const t = Math.min(1, animation.time / animation.duration);
  const smooth = t * t * (3 - 2 * t);

  if (animation.kind === "walk") {
    const position = animation.from.map((value, i) => value + (animation.to[i] - value) * smooth);
    position[1] += Math.sin(t * Math.PI) * 0.2;
    animation.rig.root.setPosition(...position);
    visuals.pose(animation.rig, t * Math.PI * 4);
  } else if (animation.kind === "attack") {
    visuals.pose(animation.rig, Math.sin(t * Math.PI) * 2);
    if (animation.ranged && t < 0.8) {
      const position = animation.from.map((value, i) => value + (animation.to[i] - value) * t / 0.8);
      const effect = animation.unit.id === "mage" || animation.unit.id === "hex" ? "magic" : "hit";
      emit(effect, 3, position, { speed: [0.05, 0.3], lifetime: [0.12, 0.3] });
    }
  } else if (animation.kind === "hit") {
    const position = [...animation.from];
    position[1] += 0.1 * Math.sin(t * Math.PI);
    position[0] += 0.12 * Math.sin(t * Math.PI * 4);
    animation.rig.root.setPosition(...position);
  }

  if (t === 1) {
    if (animation.rig) visuals.pose(animation.rig, 0);
    motion = null;
    animation.resolve();
  }
}

// 現在のNode位置を投影して名前とHPを重ねる。カメラ変更にも毎フレーム追従する
function updateLabels() {
  const app = sceneApp.app;
  app.eye.setWorldMatrix();
  const view = new Matrix();
  view.makeView(app.eye.worldMatrix);
  const viewProjection = app.projectionMatrix.clone();
  viewProjection.mul_(view);
  const rect = app.screen.canvas.getBoundingClientRect();

  for (const unit of units) {
    const rig = visuals.rigs.get(unit.id);
    const position = rig.root.getPosition();
    position[1] += 2.1;
    const ndc = viewProjection.mulVector(position);

    rig.label.hidden = unit.hp <= 0 || Math.abs(ndc[0]) > 1 || Math.abs(ndc[1]) > 1
      || ndc[2] < 0 || ndc[2] > 1;
    rig.label.style.left = `${(ndc[0] + 1) * 0.5 * rect.width}px`;
    rig.label.style.top = `${(1 - ndc[1]) * 0.5 * rect.height}px`;
    rig.label.querySelector("i").style.width = `${unit.hp / unit.maxHp * 100}%`;
  }
}

// 作品側の更新を高水準入口から呼び、粒子のstepとPBR描画は入口側へ集約する
function update({ deltaSec }) {
  if (!visuals) return;
  const dt = Math.min(deltaSec, 0.05);
  // 戦闘の待機中も水面の時刻を進め、登録済みの動くNodeへ集光を投影する
  waterTime += dt;
  water?.setTime(waterTime);
  updateMotion(dt);
  updateLabels();
  visuals.selection.rotateY(dt * 25);
}

// 透視成分を含むview-projectionはmul_で合成し、Reverse-Zのfarからレイを復元する
function makePointerRay(event) {
  const app = sceneApp.app;
  app.eye.setWorldMatrix();
  const rect = app.screen.canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * 2 - 1;
  const y = 1 - (event.clientY - rect.top) / rect.height * 2;
  const view = new Matrix();
  view.makeView(app.eye.worldMatrix);
  const inverse = app.projectionMatrix.clone();
  inverse.mul_(view);
  inverse.inverse_strict();

  const far = inverse.mulVector([x, y, CAMERA_REVERSE_Z.farDepth]);
  const origin = app.eye.getWorldPosition();
  const dir = far.map((value, i) => value - origin[i]);
  return { origin, dir };
}

// 飾りや移動マーカーを選択候補から外し、ヒットしたShapeの名前をマスへ対応させる
function pickTile(event) {
  const ray = makePointerRay(event);
  const hit = sceneApp.app.space.raycast(ray.origin, ray.dir, {
    // 表示中の地形とユニットだけをraycastの候補にし、装飾と移動markerを分ける
    filter: ({ node, shape }) => !shape.isHidden
      && (/^(tile-|cap-)/.test(node.name)
        || /^(knight|mage|ranger|orc|hex|goblin)-/.test(node.name))
  });
  if (!hit) return;

  const id = hit.node.name.split("-")[0];
  const unit = units.find(candidate => candidate.id === id);
  const coords = unit ? [unit.x, unit.z] : hit.node.name.split("-").slice(1).map(Number);
  choose(...coords).catch(showError);
}

// 6pxを越えた操作はカメラのドラッグとして扱い、終了時の誤選択を避ける
function connectPicking() {
  const canvas = sceneApp.app.screen.canvas;
  let down = null;

  canvas.addEventListener("pointerdown", event => {
    down = [event.clientX, event.clientY];
  });
  canvas.addEventListener("pointerup", event => {
    if (!down) return;
    const start = down;
    down = null;
    if (Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 6) return;
    pickTile(event);
  });
  canvas.addEventListener("pointercancel", () => { down = null; });
}

// 全地形・部隊・装飾を一つの水域へ登録する。子部品は親Nodeから登録を引き継ぐ
// 選択リングと移動範囲は受光対象から外し、操作の色を読み取りやすく保つ
async function connectWater() {
  // 光の向きとFogは公開pipelineへ渡し、manifestの高水準profileを補完する
  const pipeline = sceneApp.renderer.pipeline;
  pipeline.lightOptions.direction = [0, -1, 0];
  Object.assign(pipeline.fogOptions, {
    enabled: true, mode: "exp", density: 0.018, color: [0.025, 0.12, 0.17]
  });

  water = new WaterBody({
    origin: [0, -2, 0], width: 18, depth: 18, extent: 30,
    surfaceHeight: 6, amplitude: 0.15, wavelength: 0.9, speed: 1.3,
    waveMix: [1, 0.2, 0.12], absorption: [0.12, 0.05, 0.025]
  });
  water.setTime(waterTime);

  for (const node of sceneApp.app.space.nodes) {
    if (node.parent || node.name === "selection" || node.name.startsWith("reach-")) continue;
    water.addReceiver(node);
  }

  const control = element("#caustics");
  // 水域の設定を反映し、集光と水面の有効状態を非同期に切り替える
  const apply = () => sceneApp.renderer.setWater(water, {
    causticsEnabled: control.checked, surfaceEnabled: false, quality: "high"
  });
  await apply();
  control.disabled = false;

  // setWater()の非同期準備中は描画を停止し、OFFへの切替で専用GPU資源を解放する
  control.onchange = async () => {
    control.disabled = true;
    sceneApp.stop();
    try {
      await apply();
    } catch (error) {
      showError(error);
    } finally {
      control.disabled = failed;
      if (!failed) sceneApp.start();
    }
  };
}

// 初期配置→PBRと粒子→動くNode→入力→フレーム開始の順で組み立てる
async function start() {
  setupUI();
  sceneApp = await FantasyApp.create({
    project: createManifest(),
    renderMode: "continuous",
    physics: false,
    camera: {
      // camera_reference.jsonの参照値を再現した、近い初期視点
      target: [0.14835843440235372, -0.7909845572832235, 1.1021019765733993],
      distance: 17.9,
      yaw: 17.448079196810994,
      pitch: -32.65484739489927,
      roll: 0.7334482334065264,
      minDistance: 17,
      maxDistance: 39
    },
    effects: { shadow: true, ssao: false, ssr: false, dof: false },
    onUpdate: update,
    onError: showError
  });

  sceneApp.app.getGPU().device.addEventListener("uncapturederror", event => showError(event.error));
  visuals = new Visuals(sceneApp.app, units);
  Object.assign(sceneApp.renderer.pipeline.bloomOptions, {
    enabled: true, threshold: 1.2, strength: 0.18
  });
  await connectWater();

  connectPicking();
  reset();
  sceneApp.start();
  element("#loading").hidden = true;
}

// 手動で作ったShapeの所有者はVisuals。ループを止めてから、標準入口と別に解放する
window.addEventListener("pagehide", () => {
  sceneApp?.stop();
  visuals?.destroy();
  sceneApp?.destroy();
});
window.addEventListener("error", event => showError(event.error ?? new Error(event.message)));
window.addEventListener("unhandledrejection", event => showError(event.reason));

start().catch(showError);
