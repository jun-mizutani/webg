// ---------------------------------------------
//  Frame.js      2026/04/02
//  handle <node> elements of COLLADA format
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Quat from "./Quat.js";
import Matrix from "./Matrix.js";
import CoordinateSystem from "./CoordinateSystem.js";
import util from "./util.js";

export default class Frame extends CoordinateSystem {

  // COLLADA用フレームノードを生成する
  constructor(parent, name, sid = null, display_name = null) {
    // COLLADAの <node> 要素を保持するフレームクラス
    super(parent);
    this.name = name;
    this.sid = sid;
    this.displayName = display_name;
    this.usedAsBone = false;
    this.boneCount = 0;
    this.hasMesh = false;
    this.bofMatrix = new Matrix();
    this.type = "";
    if (parent) {
      parent.addChild(this);
    }
  }

  // 行列で姿勢/位置を設定する
  setByMatrix(matrix) {
    super.setByMatrix(matrix);
  }

  // ボーン重み関連を更新する
  setWeights() {
    this.hasWeights = true;
  }

  // フレーム種別を設定する
  setType(type_name) {
    this.type = type_name;
  }

  // 種別を返す
  getType() {
    return this.type;
  }

  // 名前を返す
  getName() {
    return this.name;
  }

  // Collada の id / sid / name の違いを吸収する候補名一覧を返す
  getCandidateNames() {
    const raw = [this.name, this.sid, this.displayName].filter(Boolean);
    const candidates = [];
    for (let i = 0; i < raw.length; i++) {
      const value = raw[i];
      const variants = [
        value,
        value.replace(/\./g, "_"),
        value.replace(/^.*?_/, ""),
        value.replace(/^.*?[:-]/, "")
      ];
      for (let j = 0; j < variants.length; j++) {
        if (variants[j] && !candidates.includes(variants[j])) {
          candidates.push(variants[j]);
        }
      }
    }
    return candidates;
  }

  // 指定 joint 名にこの frame が対応するか確認する
  matchesName(name) {
    if (!name) { return false; }
    const candidates = this.getCandidateNames();
    for (let i=0; i<candidates.length; i++) {
      if (candidates[i] === name) {
        return true;
      }
    }
    return false;
  }

  // joint 名配列に照合して、使うべき bone 名を返す
  resolveJointName(names) {
    if (!names) { return null; }
    for (let i=0; i<names.length; i++) {
      if (this.matchesName(names[i])) {
        return names[i];
      }
    }
    return null;
  }

  // 名前一致フレームを再帰検索する
  findFrame(name) {
    if (this.matchesName(name)) { return this; }
    if (this.children.length > 0) {
      for (let i=0; i<this.children.length; i++) {
        let frame = this.children[i].findFrame(name);
        if (frame) { return frame; }
      }
    }
    return null
  }

  // 名前配列に一致するボーン数を返す
  getNoOfBones(names) {
    let count = 0;
      if (this.children.length > 0) {
      for (let i=0; i<this.children.length; i++) {
        count = count + this.children[i].getNoOfBones(names);
      }
    }
    if (this.resolveJointName(names) !== null) {
      count = count + 1;
    }
    return count;
  }

  // 指定名群に一致する子孫を列挙する
  findChildFrames(names) {
    if (this.resolveJointName(names) !== null) { return this; }
    if (this.children.length > 0) {
      let frame;
      for (let i=0; i<this.children.length; i++) {
        frame = this.children[i].findChildFrames(names);
        if (frame !== null) { return frame; }
      }
    }
    return null;
  }

  // 名前配列からFrame配列を返す
  getFramesFromNames(joint_names) {
    let frames = [];
    let frame;
    for (let i=0; i<joint_names.length; i++) {
      frame = this.findFrame(joint_names[i]);
      frames.push(frame);
    }
    return frames;
  }

  copyToBone(joint_names, bind_shape_matrix,
             skeleton, parent_bone, count, verbose) {
    if (!this.findChildFrames(joint_names)) { return; }

    let bone;
    if (this.type === "JOINT") {
      let bone_name = this.resolveJointName(joint_names);
      if (bone_name === null) {
        bone_name = this.sid ?? this.displayName ?? this.name;
      }
      if (parent_bone === null) {
        let bsm = bind_shape_matrix.clone();
        let m = bsm.mat;
        let tmp;
        tmp = m[1]; m[1] = m[2]; m[2] = -tmp;  // m[1], m[2] = m[2], -m[1];
        tmp = m[5]; m[5] = m[6]; m[6] = -tmp;  // m[5], m[6] = m[6], -m[5];
        tmp = m[9]; m[9] =m[10]; m[10]= -tmp;  // m[9],m[10] =m[10], -m[9];
        tmp =m[13];m[13] =m[14]; m[14]= -tmp;  // m[13],m[14] =m[14],-m[13];
        this.matrix.lmul(bsm);
      }
      bone = skeleton.addBone(parent_bone, bone_name);
      if (verbose) {
        util.printf("Frame:bones[%2d] %s\n", skeleton.getBoneCount(), bone_name);
      }
      bone.setByMatrix(this.matrix);
      bone.setRestByMatrix(this.matrix);
      if (this.hasWeights) { bone.setWeights(); }
    }
    if (this.children.length> 0) {
      for (let i=0; i<this.children.length; i++) {
        this.children[i].copyToBone(joint_names, bind_shape_matrix,
                                    skeleton, bone, count, verbose);
      }
    }
    return;
  }

  // 当該ノードを出力する
  list(level, out) {
    let q = new Quat();
    let h, p, b;
    let head = "", left = "";
    for (let i=0;i<level;i++) {head+="+"; left+=" ";}

    out += `${head}node:${this.name}  type=${this.type}\n`;
    // let matrix
    this.matrix.print(out, 10);
    let pos = this.getPosition();
    out += `${left}local x:${pos[0].toFixed(5)}, `;
    out += `y:${Number(pos[1]).toFixed(5)}, z:${Number(pos[2]).toFixed(5)}\n`;
    h, p, b = this.getletAttitude();
    out += `${left}      h:${Number(h).toFixed(5)}, `;
    out += `p:${Number(p).toFixed(5)}, b:${Number(b).toFixed(5)}\n`;
  }

  // サブツリー全体を出力する
  listAll(level, out) {
    this.list(level, out);
    if (this.children) {
      for (let i=0; i<this.children.length; i++) {
        this.children[i].listAll(level + 1, out);
      }
    }
  }

};
