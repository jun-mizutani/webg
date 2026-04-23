// ---------------------------------------------
//  Animation.js      2026/04/23
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Schedule from "./Schedule.js";
import Quat from "./Quat.js";
import Matrix from "./Matrix.js";
import Node from "./Node.js";
import CoordinateSystem from "./CoordinateSystem.js";
import util from "./util.js";

export default class Animation {

  // アニメーション名/配列状態を初期化する
  constructor(name) {
    // ボーンアニメーションのキー時刻/姿勢/補間処理を管理する
    this.name = name;
    this.boneCount = 0;
    this.times = [];
    this.poses = [];
    this.boneNames = [];
    this.diffPoses = [];
    this.tasks = [];
    this.schedule = new Schedule();
    this.skeleton = null;
    this.endFrameIP = -1;
  }

  // キーフレーム時刻配列を設定する
  setTimes(times) {
    this.times = times;
  }

  // ボーン姿勢配列を設定する
  setBonePoses(bone_poses) {
    this.poses.push(bone_poses);
    this.boneCount = this.poses.length;
    return this.poses.length;
  }

  // 対象ボーン名を追加する
  addBoneName(bone_name) {
    this.boneNames.push(bone_name);
  }

  // i番目ボーン名を返す
  getBoneName(i) {
    if (this.boneNames.length >= i) {
      return this.boneNames[i];
    } else {
      return null;
    }
  }

  // アニメ種別を返す
  getType() {
    return this.type;
  }

  // 名前を返す
  getName() {
    return this.name
  }

  // ポーズ数を返す
  countPoses() {
    return this.times.length;
  }

  // キーフレーム数を返す
  getKeyCount() {
    return this.times.length;
  }

  // 指定キーフレーム時刻を秒で返す
  getKeyTime(key) {
    if (!this.isValidKey(key)) {
      return null;
    }
    return this.times[key];
  }

  // キー番号が有効範囲か返す
  isValidKey(key) {
    return Number.isInteger(key) && key >= 0 && key < this.times.length;
  }

  // キー範囲が有効か返す
  isValidKeyRange(from, to) {
    return this.isValidKey(from) && this.isValidKey(to) && from < to;
  }

  // clip 全体の長さを msec で返す
  getDurationMs() {
    if (this.times.length <= 1) {
      return 0;
    }
    return (this.times[this.times.length - 1] - this.times[0]) * 1000;
  }

  // 指定キー間の姿勢行列を、通常の回転+移動補間で扱えるか判定する
  // `putRotTransByMatrix()` は position / quat / uniform scale へ分解するため、
  // どちらかのキーに非一様 scale が含まれる場合は matrixOverride 経路へ切り替える
  usesMatrixCommand(boneIndex, fromKey, toKey) {
    const fromPose = this.poses[boneIndex]?.[fromKey] ?? null;
    const toPose = this.poses[boneIndex]?.[toKey] ?? null;
    if (!fromPose || !toPose) {
      throw new Error("Animation.usesMatrixCommand received an invalid pose key");
    }
    return fromPose.getUniformScale() === null || toPose.getUniformScale() === null;
  }

  // clip 情報を要約して返す
  getClipInfo() {
    return {
      name: this.name,
      keyCount: this.getKeyCount(),
      boneCount: this.getNoOfBones(),
      startTimeSec: this.times.length > 0 ? this.times[0] : 0,
      endTimeSec: this.times.length > 0 ? this.times[this.times.length - 1] : 0,
      durationMs: this.getDurationMs(),
      boneNames: [...this.boneNames]
    };
  }

  // ボーン数を返す
  getNoOfBones() {
    return this.boneCount;
  }

  // データ構築を終了する
  close() {
    // 現行実装では close 時に追加の確定処理は持たないが、
    // Collada parser は parse 成功可否をこの戻り値で判定している
    return true;
  }

  // 2行列差分を算出する
  difference(matA, matB) {
    let quat;
    let pos = [];
    let qA = new Quat();
    let qB = new Quat();
    let posA = matA.getPosition();
    let posB = matB.getPosition();
    qA.matrixToQuat(matA);
    qB.matrixToQuat(matB);
    let dp = qA.dotProduct(qB);
    if (dp < 0) { qB.negate(); }  // shortest path
    qA.conjugate();
    quat = qB.clone();
    quat.lmulQuat(qA);
    pos[1] = posB[1] - posA[1];
    pos[2] = posB[2] - posA[2];
    pos[3] = posB[3] - posA[3];
    return [quat, pos];
  }

  // Skeletonへ適用する内部データを構築する
  setData(skeleton, bind_shape_matrix) {
    let time;
    let q, pos;
    this.skeleton = skeleton;
    const bsm = bind_shape_matrix.clone();
    for (let i=0; i<this.getNoOfBones(); i++) {
      let task = this.schedule.addTask(this.boneNames[i]);
      let b = skeleton.getBone(this.boneNames[i]);
      if (b === null) {
        skeleton.printJointNames();
        skeleton.printBone();
        util.printf("skeleton.getBone(this.boneNames[%d]) is null.(setData)\n", i);
      }
      task.setTargetObject(b);
      this.tasks.push(task);
      if (b.rootBone) {
        for (let key=0; key<this.times.length; key++) {
          this.poses[i][key].lmul(bsm);
        }
      }
    }

    for (let key=1; key<this.times.length; key++) {
      time = (this.times[key] - this.times[key-1]) * 1000;  // msec
      for (let i=0; i<this.getNoOfBones(); i++) {
        if (this.usesMatrixCommand(i, key - 1, key)) {
          this.tasks[i].addCommand(
            [ 0,
              CoordinateSystem.prototype.putMatrixByMatrix,
              [this.poses[i][key]]
            ]);
          this.tasks[i].addCommand(
            [
              time,
              CoordinateSystem.prototype.doMatrix,
              [1.0]
            ]);
        } else {
          this.tasks[i].addCommand(
            [ 0,
              CoordinateSystem.prototype.putRotTransByMatrix,
              [this.poses[i][key]]
            ]);
          this.tasks[i].addCommand(
            [
              time,
              CoordinateSystem.prototype.doRotTrans,
              [1.0]
            ]);
        }
      }
    }
  }

  // キーフレームデータを追加する
  appendData(time, key_frame_no) {
    let q, pos;
    let bone;
    let bone_diff;
      for (let i=0; i<this.getNoOfBones(); i++) {
      bone = this.poses[i];
      let last_frame = this.times.length;
      q, pos = this.difference(bone[last_frame], bone[key_frame_no]);
      bone_diff = [q, pos];
      this.diffPoses.push(bone_diff);
      this.tasks[i].addCommand([
        0, CoordinateSystem.prototype.putRotTrans, [q , pos]
      ]);
      this.tasks[i].addCommand([
        time, CoordinateSystem.prototype.doRotTrans, [1.0]
      ]);
    }
  }

  // 区間長を返す
  getPeriodFromTo(from, to) {
    if (!this.isValidKeyRange(from, to)) { return -1; }
    return (this.times[to] - this.times[from]) * 1000;
  }

  // 指定キー姿勢を適用する
  setPose(key) {
    for (let i=0; i<this.getNoOfBones(); i++) {
      let b = this.skeleton.getBone(this.boneNames[i]);
      b.setByMatrix(this.poses[i][key]);
    }
  }

  // 区間補間遷移を開始する
  transitionTo(time, keyFrom, keyTo) {
    let args = [];
    let ones = [];
    let useMatrixCommand = false;
    for (let i=0; i<this.getNoOfBones(); i++) {
      args.push(this.poses[i][keyFrom]);  // matrix
      ones.push(1.0);
      if (this.usesMatrixCommand(i, keyFrom, keyTo)) {
        useMatrixCommand = true;
      }
    }
    if (useMatrixCommand) {
      this.schedule.directExecution(
        0, CoordinateSystem.prototype.putMatrixByMatrix, args);
      this.schedule.directExecution(
        time, CoordinateSystem.prototype.doMatrix, ones, keyFrom * 2,
        keyTo * 2 - 1);
    } else {
      this.schedule.directExecution(
        0, CoordinateSystem.prototype.putRotTransByMatrix, args);
      this.schedule.directExecution(
        time, CoordinateSystem.prototype.doRotTrans, ones, keyFrom * 2,
        keyTo * 2 - 1);
    }
  }

  // 先頭から再生開始する
  start() {
    this.setPose(0);
    this.schedule.startFrom(0);
  }

  // 経過時刻に応じて1ステップ再生する
  play() {
    return this.schedule.doCommand();
  }

  // FPS指定で再生する
  playFps(frame_per_sec) {
    return this.schedule.doCommandFps(frame_per_sec);
  }

  // キー範囲指定で再生開始する
  startFromTo(keyFrom, keyTo) {
    this.setPose(keyFrom);
    this.schedule.startFromTo(keyFrom * 2, keyTo * 2 - 1);
  }

  // 再生時間指定で区間再生する
  startTimeFromTo(time, keyFrom, keyTo) {
    this.transitionTo(time, keyFrom, keyTo);
  }

  // 内容をデバッグ出力する
  list(print_matrix) {
    let time;
    let mat = new Matrix();
    let q, pos;
    let h, p, b;

    util.printf("\nAnimetion:%s, No. of keyframe=%d\n", this.name,
                 this.times.length);
    for (let i=0; i<this.getNoOfBones(); i++) {
      util.printf("[%02d]---- %s ----\n", i, this.getBoneName(i));
      for (let key=0; key<this.times.length; key++) {
        util.printf("[%6.2f]", this.times[key]);
        mat.copyFrom(this.poses[i][key]);
        if (print_matrix) { mat.print(); }
        pos = mat.getPosition();
        [h, p, b] = mat.matToEuler();
        util.printf(" h:%8.3f p:%8.3f b:%8.3f ", h, p, b);
        util.printf(" x:%9.4f y:%9.4f z:%9.4f\n", ...pos);
      }
    }
  }
};
