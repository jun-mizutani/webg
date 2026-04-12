// ---------------------------------------------
//  Task.js       2026/03/01
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

export default class Task {

  // タスク状態を初期化する
  constructor(name, no) {
    // Scheduleから実行される1本のコマンド列(タスク)を保持する
    this.name = name;
    this.id = no;
    this.stopped = false;
    this.ip = -1;
    this.stopIP = 0;
    this.commands = [];
    this.time = 0;
    this.remaining_time = 0;
    this.targetObj = null;
    this.arg = [];
    this.currentCommand = null;
    this.targetObject = null;
    this.time_scale = 1.0; // play speed
  }

  // 命令対象オブジェクトを設定する
  setTargetObject(target) {
    this.targetObject = target;
  }

  // 命令列へ追加する
  addCommand(cmd) {
    //console.log("ID[" + this.id + "] command[" + this.commands.length + "]")
    this.commands.push(cmd);
  }

  // 命令 `ip` の時間を設定する
  setTime(ip, time) {
    if ((ip >= 0)&&(ip < this.commands.length)) {
      this.commands[ip][0] = time;
    }
  }

  // 命令 `ip` の時間を返す
  getTime(ip) {
    if ((ip >= 0)&&(ip < this.commands.length)) {
      return this.commands[ip][0];
    } else {
      return -1;
    }
  }

  // タスク名を返す
  getName() {
    return this.name;
  }

  // 命令数を返す
  getNoOfCommands() {
    return this.commands.length;
  }

  // 命令列を一括設定する
  setCommand(command_table) {
    this.commands = command_table;
    //this.start();
  }

  // 補間引数を計算する
  partial_arg(arg, total_time, dtime) {
    let doarg = [];
    for (let i=0; i<arg.length; i++) {
      // print(arg[1])
      if (total_time > 0.1) {
        doarg[i] = arg[i] * dtime / total_time;
      } else {
        doarg.push(arg[i]);
      }
    }
    return doarg;
  }

  // 制御系命令を処理する
  controlCommand(command, arg) {
    if (command === "jump") {
       // jump to current command + arg position
       // [0, "jump", [-1]]
       this.ip = this.ip + arg - 1; // arg is not array.
    } else if (command === "quit") {
      // quit task
      this.stopped = true;
    }
  }

  // 命令を対象オブジェクトへ実行する
  execCommand(doarg) {
    let command = this.currentCommand;
    if (typeof command === "string") {
      this.controlCommand(command, ...doarg);
    } else {
      if (command !== null) {
        this.ret_code = command.call(this.targetObject, ...doarg);
      } else {
        let obj_name = "null";
        if (this.targetObject !== null) {
          obj_name = this.targetObject.name;
        }
        util.printf("Error (%s:execCommand):[%3d] %s.null(..)\n",
                     this.name, this.ip, obj_name);
      }
    }
  }

  // 次命令を取得する
  getNextCommand() {
    do {
      this.ip = this.ip + 1;
      if ((this.ip <= this.stopIP) && (this.ip >= 0)) {
        this.time = this.commands[this.ip][0] * this.time_scale;
        this.currentCommand = this.commands[this.ip][1];
        this.arg = this.commands[this.ip][2];
        this.remaining_time = this.time;
        if (this.time === 0) {
          this.execCommand(this.arg);
        }
      } else {
        this.stopped = true;  // end of task
        this.ip = -1;
      }
    } while ((this.time === 0) && (!this.stopped));
  }

  // 先頭から開始する
  start() {
    this.startFromTo(0, -1);
  }

  // 指定位置から開始する
  startFrom(start_ip) {
    this.startFromTo(start_ip, -1);
  }

  // 範囲指定で開始する
  startFromTo(start_ip, stop_ip) {
    //console.log("startFromTo:this.ip=" + this.ip);
    if (stop_ip >= this.commands.length) {
      stop_ip = this.commands.length - 1;
    }
    if (stop_ip < 0) {
      this.stopIP = this.commands.length - 1;
    } else {
      this.stopIP = stop_ip;
    }
    if ((start_ip >= 0)&&(start_ip < this.stopIP)) {
      this.stopped = false;
      // to compensate this.ip+=1 in getNextCommand.
      this.ip = start_ip - 1;
      // getNextCommand may execute commands with time===0.
      this.getNextCommand();
    }
  }

  // 経過時間に応じて実行を進める
  execute(delta_msec) {
    let doarg;
    if (this.stopped) { return -1; }
    if (this.ip === -1) {
      this.getNextCommand();
    }
    if (this.remaining_time > delta_msec) {
      this.remaining_time = this.remaining_time - delta_msec;
      doarg = this.partial_arg(this.arg, this.time, delta_msec);
      this.execCommand(doarg);
    } else {
      let time_next = delta_msec - this.remaining_time;
      doarg = this.partial_arg(this.arg, this.time, this.remaining_time);
      this.execCommand(doarg);
      do {
        this.getNextCommand();
        if (! this.stopped) {
          this.remaining_time = this.time - time_next;
          if (this.time > time_next) {
            doarg = this.partial_arg(this.arg, this.time, time_next);
            this.execCommand(doarg);
          } else { // time < time_next
            time_next = time_next - this.time;
            doarg = this.partial_arg(this.arg, this.time, this.time);
            this.execCommand(doarg);
          }
        }
      } while ((this.remaining_time <= 0) && !this.stopped);
    }
    return this.ip;
  }

  // 単一命令を実行する
  executeOneCommand(ip, arg_rate) {
    let commands = this.commands;
    let object = this.targetObject;
    let time = commands[ip][0];
    let command = commands[ip][1];
    let arg = commands[ip][2];
    let doarg = this.partial_arg(arg, 1.0, arg_rate);
    if (object === null) {
      command(...doarg);
    } else {
      command.call(object, ...doarg);
    }
  }

  // 1命令を即時実行する
  directExecution(command, doarg) {
    if (this.targetObject === null) {
      this.ret_code = command(...doarg);
    } else {
      if (command !== null) {
        this.ret_code =  command.call(this.targetObject, ...doarg);
      } else {
        util.printf("Error( %s<%d>:directExecution ):[%3d] %s:null(..)\n",
                     this.name, this.id, this.ip, this.targetObject.name);
      }
    }
  }

  // 実行中命令列へ差し込む
  insertCurrentCommand(time, command, arg, start_ip, stop_ip) {
    this.time = time;
    this.currentCommand = command;
    this.arg = arg;
    this.remaining_time = this.time;
    if ((start_ip !== null)&&(stop_ip !== null)) {
      if (stop_ip >= this.commands.length) {
        stop_ip = this.commands.length - 1;
      }
      if (stop_ip < 0) {
        this.stopIP = this.commands.length - 1;
      } else {
        this.stopIP = stop_ip;
      }
      if ((start_ip >= 0)&&(start_ip <= this.stopIP)) {
        this.stopped = false;
        this.ip = start_ip - 1;
      }
    }
  }
 };
