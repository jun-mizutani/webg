// ---------------------------------------------
//  SceneAnimations.js  2026/09/09
//   SceneYAMLのNode animationを検証し、再生時刻から姿勢を生成する高水準モジュール
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Quat from "../Quat.js";

// 入力検証で見つかった形式エラーを、現在の項目名付きで即時に通知します
function fail(label, message) { throw new Error(`${label}: ${message}`); }

// オブジェクトのキー集合を先に確定し、未定義の設定が後段へ流れないようにします
function record(value, label, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label, "must be an object");
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}.${key}`, "is not supported");
  return value;
}

// SceneYAML内でNode、clip、trackを参照する識別子を読みます
function identifier(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(label, "must be a non-empty ID");
  return value;
}

// 時刻や補間係数など、計算へ進める数値が有限値であることを確認します
function number(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(label, "must be finite");
  return value;
}

// 座標またはQuaternionを固定長配列として読み、各要素を有限値へそろえます
function vector(value, size, label) {
  if (!Array.isArray(value) || value.length !== size) fail(label, `must contain ${size} numbers`);
  return value.map((v, i) => number(v, `${label}[${i}]`));
}

// animationで扱うscaleを検証し、現在実装している一様scaleの値を保持します
export function readAnimationScale(value, label) {
  const scale = vector(value, 3, label);
  if (scale.some(v => v <= 1e-8 || Math.abs(v - scale[0]) > 1e-8)) {
    fail(label, "requires positive uniform scale (> 1e-8); non-uniform scale is a later feature");
  }
  return scale;
}

// 同じ階層で参照されるIDの重複を検出し、あとから参照先が変わる状態を防ぎます
function unique(id, ids, label) {
  if (ids.has(id)) fail(label, `duplicate ID ${id}`);
  ids.add(id);
}

// GPU resourceを作る前にclip、keyframe、track、姿勢を全件検証し、実行用の不変データへ変換します
// 入力の順番と値を保ったまま、Quaternionだけは計算に使える単位長へ正規化します
export function readSceneAnimationDefinitions(value = [], label = "SceneYAML animations") {
  if (!Array.isArray(value)) fail(label, "must be an array");
  const clipIds = new Set();
  return value.map((source, ci) => {
    const loc = `${label}[${ci}]`;
    record(source, loc, ["id", "keyframes", "tracks"]);
    const id = identifier(source.id, `${loc}.id`);
    unique(id, clipIds, label);
    const cl = `${label} clip ${id}`;
    if (!Array.isArray(source.keyframes) || !source.keyframes.length) fail(cl, "requires keyframes");
    const keyIds = new Set();
    const keyframes = source.keyframes.map((key, i) => {
      const kl = `${cl}.keyframes[${i}]`;
      record(key, kl, ["id", "time"]);
      const keyId = identifier(key.id, `${kl}.id`);
      unique(keyId, keyIds, cl);
      const time = number(key.time, `${kl}.time`);
      if ((i === 0 && time !== 0) || (i > 0 && time <= source.keyframes[i - 1].time)) {
        fail(kl, "times must start at zero and strictly increase (seconds)");
      }
      return Object.freeze({ id: keyId, time });
    });
    if (!Array.isArray(source.tracks) || !source.tracks.length) fail(cl, "requires tracks");
    const trackIds = new Set(), targets = new Set();
    const tracks = source.tracks.map((track, ti) => {
      const tl = `${cl}.tracks[${ti}]`;
      record(track, tl, ["id", "target", "interpolation", "poses"]);
      const trackId = identifier(track.id, `${tl}.id`);
      unique(trackId, trackIds, cl);
      record(track.target, `${tl}.target`, ["object"]);
      const object = identifier(track.target.object, `${tl}.target.object`);
      unique(object, targets, `${cl} target`);
      const interpolation = track.interpolation ?? {};
      record(interpolation, `${tl}.interpolation`, ["position", "quaternion", "scale"]);
      for (const [field, mode] of Object.entries({ position: "linear", quaternion: "slerp", scale: "linear" })) {
        if (interpolation[field] !== undefined && interpolation[field] !== mode) {
          fail(`${tl}.interpolation.${field}`, `requires ${mode}`);
        }
      }
      if (!Array.isArray(track.poses) || track.poses.length !== keyframes.length) fail(tl, "poses must match keyframes count");
      const hasScale = track.poses[0]?.scale !== undefined;
      let constantScale;
      const poses = track.poses.map((pose, pi) => {
        const pl = `${cl} track ${trackId} key ${keyframes[pi].id}`;
        record(pose, pl, ["position", "quaternion", "scale"]);
        const position = vector(pose.position, 3, `${pl}.position`);
        const quaternion = vector(pose.quaternion, 4, `${pl}.quaternion`);
        const norm = Math.hypot(...quaternion);
        if (Math.abs(norm - 1) > 1e-4) fail(`${pl}.quaternion`, "requires unit length (tolerance 1e-4)");
        if ((pose.scale !== undefined) !== hasScale) fail(pl, "scale must be present at every key or omitted throughout");
        const scale = hasScale ? readAnimationScale(pose.scale, `${pl}.scale`) : undefined;
        if (scale) {
          constantScale ??= scale[0];
          if (Math.abs(scale[0] - constantScale) > 1e-8) fail(pl, "animated scale is a later feature; use constant scale");
        }
        return Object.freeze({
          position: Object.freeze(position),
          quaternion: Object.freeze(quaternion.map(v => v / norm)),
          ...(scale ? { scale: Object.freeze(scale) } : {})
        });
      });
      return Object.freeze({ id: trackId, target: Object.freeze({ object }), poses: Object.freeze(poses) });
    });
    return Object.freeze({ id, keyframes: Object.freeze(keyframes), tracks: Object.freeze(tracks) });
  });
}

// 2つのQuaternion間を最短経路で球面線形補間し、姿勢の中間値を生成します
// ほぼ同じQuaternionでは線形補間へ切り替え、角度計算の数値不安定性を避けます
function interpolateRotation(a, b, u) {
  let dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const sign = dot < 0 ? -1 : 1;
  dot = Math.min(1, Math.abs(dot));
  let x = 1 - u, y = u;
  if (dot < 0.9995) {
    const angle = Math.acos(dot), sine = Math.sin(angle);
    x = Math.sin((1 - u) * angle) / sine;
    y = Math.sin(u * angle) / sine;
  }
  const q = new Quat();
  q.q = a.map((v, i) => x * v + y * sign * b[i]);
  q.normalize();
  return q;
}

export default class SceneAnimations {
  // 検証済みclipをNodeへ結び付け、各Nodeの基準姿勢を保存して再生・Resetの起点を作ります
  // 物理対象Nodeへのanimation指定もこの段階で検査し、固定step同期が必要な状態を明示します
  constructor(definitions, getNode, physicalNodes = []) {
    this.clips = new Map();
    this.bases = new Map();
    this.destroyed = false;
    for (const definition of readSceneAnimationDefinitions(definitions)) {
      const boundNodes = new Set();
      const tracks = definition.tracks.map(track => {
        const label = `animation ${definition.id} track ${track.id}`;
        const node = getNode?.(track.target.object);
        if (!node || typeof node.setQuat !== "function") fail(label, `object ${track.target.object} is unavailable`);
        if (boundNodes.has(node)) fail(label, "multiple tracks resolve to the same Node");
        boundNodes.add(node);
        for (const physical of physicalNodes) {
          const visited = new Set();
          for (let ancestor = physical; ancestor; ancestor = ancestor.getParent()) {
            if (visited.has(ancestor)) fail(label, "cyclic scene hierarchy");
            visited.add(ancestor);
            if (ancestor === node) fail(label, "animated targets and their descendants must be display-only; physics animation needs fixed-step binding");
          }
        }
        if (!this.bases.has(node)) {
          node.setMatrix();
          const scale = node.matrix.getUniformScale();
          if (scale === null || scale <= 1e-8) fail(label, "base pose requires positive uniform local scale");
          this.bases.set(node, { matrix: node.matrix.clone(), scale });
        }
        return { ...track, node };
      });
      this.clips.set(definition.id, {
        ...definition, tracks, duration: definition.keyframes.at(-1).time,
        time: 0, status: "stopped", loop: false, skipDelta: false
      });
    }
  }

  // destroy後のclip操作を検出し、解放済み状態を利用者へ伝えます
  requireAlive() { if (this.destroyed) fail("SceneAnimations", "is destroyed"); }

  // IDからclipを解決し、存在するclipだけを再生操作へ渡します
  clip(id) {
    this.requireAlive();
    const clip = this.clips.get(id);
    if (!clip) fail("SceneAnimations", `unknown clip ${id}`);
    return clip;
  }

  // 定義順を保ったclip ID一覧を返し、作品側のUI選択へ利用できる形にします
  getIds() { this.requireAlive(); return [...this.clips.keys()]; }

  // clipの現在時刻、長さ、状態、loop設定を外部観測用のsnapshotへまとめます
  getState(id) {
    const { time, duration, status, loop } = this.clip(id);
    return Object.freeze({ id, time, duration, status, loop });
  }

  // 同じNodeを複数clipが同時に更新しないよう、再生前にNodeの使用状況を検査します
  claim(clip) {
    const nodes = new Set(clip.tracks.map(t => t.node));
    for (const other of this.clips.values()) {
      if (other === clip || !["playing", "paused"].includes(other.status)) continue;
      if (other.tracks.some(t => nodes.has(t.node))) fail(`animation ${clip.id}`, `target is owned by clip ${other.id}; stop that clip first`);
    }
  }

  // clipの現在時刻から前後のkeyframeを二分探索し、全trackのNode姿勢を反映します
  apply(clip) {
    const keys = clip.keyframes;
    let lo = 0, hi = keys.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (keys[mid].time <= clip.time) lo = mid; else hi = mid;
    }
    const u = hi === lo ? 0 : Math.max(0, Math.min(1, (clip.time - keys[lo].time) / (keys[hi].time - keys[lo].time)));
    for (const track of clip.tracks) {
      const a = track.poses[lo], b = track.poses[hi];
      track.node.setPosition(...a.position.map((v, i) => v + (b.position[i] - v) * u));
      track.node.setQuat(interpolateRotation(a.quaternion, b.quaternion, u));
      track.node.setScale(a.scale?.[0] ?? this.bases.get(track.node).scale);
    }
  }

  // clipを先頭時刻へ戻して再生を開始し、UI操作直後のdeltaSecを次の境界から数えます
  play(id, options = {}) {
    const clip = this.clip(id);
    record(options, `animation ${id} play options`, ["loop"]);
    const loop = options.loop ?? false;
    if (typeof loop !== "boolean") fail(`animation ${id}`, "loop must be boolean");
    this.claim(clip);
    Object.assign(clip, { time: 0, loop, status: clip.duration > 0 ? "playing" : "finished", skipDelta: true });
    this.apply(clip);
    return this.getState(id);
  }

  // 再生中clipを現在時刻で一時停止し、現在のNode姿勢を保持します
  pause(id) {
    const clip = this.clip(id);
    if (clip.status === "playing") clip.status = "paused";
    return this.getState(id);
  }

  // 一時停止中clipを再開し、他clipとのNode重複を再確認してから時間更新へ戻します
  resume(id) {
    const clip = this.clip(id);
    if (clip.status !== "paused") fail(`animation ${id}`, "resume requires a paused clip");
    this.claim(clip);
    clip.status = clip.duration > clip.time || (clip.loop && clip.duration > 0) ? "playing" : "finished";
    clip.skipDelta = true;
    return this.getState(id);
  }

  // clipを停止状態へ戻し、停止時点のNode姿勢をそのまま保持します
  stop(id) {
    const clip = this.clip(id);
    clip.status = "stopped";
    return this.getState(id);
  }

  // clipを指定秒へ移動し、移動後の姿勢を即時反映した一時停止状態を作ります
  seek(id, seconds) {
    const clip = this.clip(id);
    number(seconds, `animation ${id} seek seconds`);
    this.claim(clip);
    clip.time = Math.max(0, Math.min(clip.duration, seconds));
    clip.status = "paused";
    clip.skipDelta = true;
    this.apply(clip);
    return this.getState(id);
  }

  // 毎frameの経過秒を再生中clipへ配分し、loop、終了、補間姿勢を順に更新します
  update(deltaSec) {
    this.requireAlive();
    if (number(deltaSec, "animation deltaSec") < 0) fail("animation deltaSec", "must be non-negative");
    for (const clip of this.clips.values()) {
      if (clip.status !== "playing") continue;
      // UI操作直後の最初のframeは新しい時間境界を作り、操作前のdeltaを再生時間へ加えません
      if (clip.skipDelta) { clip.skipDelta = false; continue; }
      const next = clip.time + deltaSec;
      clip.time = clip.loop ? next % clip.duration : Math.min(next, clip.duration);
      if (!clip.loop && clip.time === clip.duration) clip.status = "finished";
      this.apply(clip);
    }
  }

  // 全clipを停止し、保存していたNode基準姿勢と時刻を初期状態へ戻します
  reset() {
    this.requireAlive();
    for (const clip of this.clips.values()) Object.assign(clip, { time: 0, status: "stopped", loop: false, skipDelta: false });
    for (const [node, base] of this.bases) node.setByMatrix(base.matrix);
  }

  // clip、基準姿勢、再生状態を解放し、以後の操作を状態エラーへ切り替えます
  destroy() {
    this.clips.clear(); this.bases.clear(); this.destroyed = true;
  }
}
