// ---------------------------------------------
//  Schedule.js   2026/03/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Task from "./Task.js";
import util from "./util.js";

export default class Schedule {

  // スケジューラ状態を初期化する
  constructor(name) {
    // Task列を時系列に実行する軽量スケジューラ
    this.last = 0;
    this.sequenceNo = 0;
    this.pause = false;
    this.stopped = false;
    this.tasks = [];
  }

  // Taskを追加する
  addTask(name) {
    this.sequenceNo = this.sequenceNo + 1;
    let task = new Task(name, this.sequenceNo);
    let n = this.getEmptyTask();
    if (n) {
      this.tasks[n] = task;
    } else {
      this.tasks.push(task); // no empty slot
    }
    return task;
  }

  // Taskを削除する
  delTask(task) {
    for (let i=0; i<this.tasks.length; i++) {
      if (this.tasks[i] === task) {
        this.tasks[i] = 0;
      }
    }
  }

  // 空Taskを返す
  getEmptyTask() {
    for (let i=0; i<this.tasks.length; i++) {
      if (this.tasks[i] === 0) { return i; }
    }
    return null; // no empty slot
  }

  // Task数を返す
  getNoOfTasks() {
    return this.tasks.length;
  }

  // n番Taskを返す
  getTask(n) {
    if ((n >= 0) && (n < this.tasks.length)) {
      return this.tasks[n];
    } else {
      return null;
    }
  }

  // 名前検索でTaskを返す
  getTaskByName(name) {
    for (let i=0; i<this.tasks.length; i++) {
      if (this.tasks[i] !== 0) {
        if ((this.tasks[i].getName() === name)) {
          return this.tasks[i];
        }
      }
    }
    return null;
  }

  // 実行を一時停止する
  pause() {
    this.pause = true;
  }

  // 先頭から開始する
  start() {
    this.startFromTo(0, -1);
  }

  // 指定命令位置から開始する
  startFrom(start_ip) {
    this.startFromTo(start_ip, -1);
  }

  // 範囲指定で開始する
  startFromTo(start_ip, stop_ip) {
    this.stopped = false;
    this.pause = false;
    // 停止中に長時間待ったあと再開すると、前回 frame からの経過時間を
    // 一気に消費して補間が瞬時に終わってしまう
    // 再生開始時点を新しい基準時刻として持ち直し、
    // 最初の play() が待ち時間を持ち越さないようにする
    this.last = util.now();
    for (let i=0; i<this.tasks.length; i++) {
      if (this.tasks[i] !== 0) {
        this.tasks[i].startFromTo(start_ip, stop_ip);
      }
    }
  }

  // FPS指定で命令実行する
  doCommandFps(frame_per_sec) {
    let ip = -1;
    let delta_msec = 1000 / frame_per_sec; // msec
    for (let i=0; i<this.tasks.length; i++) {
      if (this.tasks[i] !== 0) {
        ip = this.tasks[i].execute(delta_msec);
      }
    }
    return ip;
  }

  // 1ステップ命令実行する
  doCommand() {
    let ip;
    let running_ip = -1;
    if (this.stopped || this.pause) {
      this.last = util.now();
      return -1;
    }
    if (this.last === 0) {
      this.last = util.now();
    }
    let now =  util.now();
    let delta_msec = (now - this.last);
    this.last = now;
    if (! this.stopped) {
      for (let i=0; i<this.tasks.length; i++) {
        if (this.tasks[i] !== 0) {
          ip = this.tasks[i].execute(delta_msec);
          if (ip >= 0) { running_ip = ip; }
        }
      }
    }
    if (running_ip < 0) { this.stopped = true; }
    return running_ip; // when stopped, return -1
  }

  // 指定命令を補間率付きで実行する
  doOneCommand(ip, rate) {
    for (let i=0; i<this.tasks.length; i++) {
      if (this.tasks[i] !== 0) {
        this.tasks[i].executeOneCommand(ip, rate);
      }
    }
  }

  // 一時命令を直接実行する
  directExecution(time, command, args, start_ip, stop_ip) {
    for (let i=0; i<this.tasks.length; i++) {
      if (time > 0) {
        this.stopped = false;
        this.pause = false;
        // 補間付き command を差し込む場合も、開始 frame の基準時刻を
        // ここで更新して、停止中の待機時間が最初の補間率に混ざらないようにする
        this.last = util.now();
        this.tasks[i].insertCurrentCommand(time, command, [args[i]],
                                           start_ip, stop_ip);
      } else {
        this.tasks[i].directExecution(command, [args[i]]);
      }
    }
  }

  // 実行速度倍率を設定する
  setSpeed(time_scale) {
    for (let i=0; i<this.tasks.length; i++) {
      if (this.tasks[i] !== 0) {
        this.tasks[i].time_scale = time_scale;
      }
    }
  }

};
