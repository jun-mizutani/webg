// ---------------------------------------------
//  Skeleton.js       2026/03/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Matrix from "./Matrix.js";
import Node from "./Node.js";
import util from "./util.js";
import { DEFAULT_MAX_SKIN_BONES, SKIN_MATRIX_FLOATS_PER_BONE } from "./SkinningConfig.js";

export default class Skeleton {

  // ボーン配列・行列パレットを初期化する
  constructor() {
    // Skeletonはボーン配列と行列パレットを管理する
    // Shape/BonePhongへ渡すスキニング基盤データを生成する
    this.MAX_BONE = DEFAULT_MAX_SKIN_BONES;
    this.bones = [];
    this.attachable = false;
    this.boneOrder = [];
    this.allJointNames = [];
    this.boneNo = 0;
    this.boneShape = null;
    this.matrixPalette = new Float32Array(this.MAX_BONE * SKIN_MATRIX_FLOATS_PER_BONE);
    this.show = false;
  }

  // スケルトンを複製する
  clone() {
    let skel = new Skeleton();
    let num = 0;
    skel.setBoneOrder(this.boneOrder);

    let copyBoneToBone = function (src_bone, parent) {
      if (num < this.MAX_BONE) {
        num++;
        let bone = skel.addBone(parent, src_bone.name);
        bone.setRestByMatrix(src_bone.restMatrix);
        bone.setByMatrix(src_bone.restMatrix);
        bone.hasWeights = src_bone.hasWeights;
        if (src_bone.children.length > 0) {
          for (let i=0; i<src_bone.children.length; i++) {
            copyBoneToBone(src_bone.children[i], bone);
          }
        }
      }
    };
    copyBoneToBone(this.bones[1], null);
    skel.bindRestPose();
    return skel;
  }

  // ボーンを追加し `Node` を返す
  addBone(parent_bone, name) {
    // ボーン(Node)を生成して親子関係を接続する
    let bone = new Node(parent_bone, name);
    bone.setType(bone.BONE_T);
    if (this.boneShape !== null) {
      bone.addShape(this.boneShape);
    }
    this.bones.push(bone);
    this.boneNo = this.bones.length;
    if (parent_bone !== null) {
      parent_bone.children.push(bone);
    }
    return bone;
  }

  // 共通骨表示Shapeを設定する
  setBoneShape(shape) {
    this.boneShape = shape;
    if (this.bones.length === 0) { return }
    for (let i=0; i<this.bones.length; i++) {
      this.bones[i].setShape(this.boneShape);
    }
  }

  // attach可否を設定する
  setAttachable(true_or_false) {
    this.attachable = true_or_false;
    if (this.bones.length === 0) { return }
    for (let i=0; i<this.bones.length; i++) {
      this.bones[i].setAttachable(true_or_false);
    }
  }

  // attach可否を返す
  isAttachable() {
    return this.attachable;
  }

  // 骨表示ON/OFFを返す
  isShown() {
    return this.show;
  }

  // 骨表示を切り替える
  showBone(true_or_false) {
    this.show = true_or_false;
    if (this.bones.length === 0) { return }
    for (let i=0; i<this.bones.length; i++) {
      let bone = this.bones[i];
      bone.hide(!true_or_false);
      if (true_or_false) {
        bone.setAttachable(true);
      } else {
        bone.setAttachable(this.attachable);
      }
    }
  }

  // ジョイント名順を固定する
  setBoneOrder(names) {
    // シェーダ用パレット順を joint名配列で固定する
    this.allJointNames = names;
    let nBones = names.length;
    if (nBones > this.MAX_BONE) { nBones = this.MAX_BONE; }
    for (let i=0; i<nBones; i++) {
      for (let j=0; j<this.bones.length; j++) {
        if (this.bones[j].name === names[i]) {
          this.boneOrder.push(this.bones[j]);
        }
      }
    }
    return this.boneOrder;
  }

  // ジョイント名順を返す
  getBoneOrder() {
    return this.boneOrder;
  }

  // 名前からボーン番号を返す
  getBoneNo(name) {
    for (let i=0; i<this.bones.length; i++) {
      if (this.bones[i].name === name) {
        return i - 1;
      }
    }
    util.printf("Bone (%s) is not found. (Skeleton.getBoneNo)\n", name);
    return null;
  }

  // ボーン数を返す
  getBoneCount() {
    return this.bones.length;
  }

  // 名前でボーンを返す
  getBone(name) {
    if (name === undefined) {
      util.printf("Bone name is undefined.(Skeleton.getBone)\n");
      return null;
    }
    for (let i=0; i<this.bones.length; i++) {
      if (this.bones[i].name === name) {
        return this.bones[i];
      }
    }
    util.printf("Bone (%s) is not found.(Skeleton.getBone)\n", name);
    return null;
  }

  // ジョイント番号からボーンを返す
  getBoneFromJointNo(num) {
    if (this.boneOrder.length > 0) {
      let bone_name = this.allJointNames[num];
      return this.getBone(bone_name);
    } else {
      return this.bones[num];
    }
  }

  // ジョイント名一覧を出力する
  printJointNames() {
    util.printf("#this.allJointNames = %4d\n", this.allJointNames.length);
    for (let i=0; i<this.allJointNames.length; i++) {
      util.printf("%4d  %s\n", i, this.allJointNames[i]);
    }
  }

  // ボーン情報を出力する
  printBone() {
    util.printf("this.bones.length = %4d\n", this.bones.length);
    for (let i=0; i<this.bones.length; i++) {
      util.printf("%4d  %s\n", i, this.bones[i].name);
    }
  }

  // ボーンからジョイント番号を返す
  getJointFromBone(bone) {
    if (this.allJointNames.length > 0) {
      for (let i=0; i<this.allJointNames.length; i++) {
        if (bone.name === this.allJointNames[i]) {
          return i;  // starting at 0
        }
      }
    } else {
      return this.getBoneNoFromBone(bone);
    }
    return null;
  }

  // ボーンから配列インデックスを返す
  getBoneNoFromBone(bone) {
    if (this.bones.length > 0) {
      for (let i=0; i<this.bones.length; i++) {
        if (this.bones[i] === bone) {
          return i;  // starting at 0;
        }
      }
    }
    return null;
  }

  // レスト姿勢を固定しパレット基準を作る
  bindRestPose() {
    // rest pose側の model行列/BOF 行列を再計算する
    for (let i=0; i<this.bones.length; i++) {
      let bone = this.bones[i];
      if (bone.rootBone) {
        bone.setModelMatrixAll(null);
      }
    }
  }

  // 現在姿勢から行列パレットを更新する
  updateMatrixPalette() {
    // スキニング用行列パレットを更新する
    // 基本式: palette = currentGlobal * boneOffsetInverse
    let wm = new Matrix();
    for (let i=0; i<this.bones.length; i++) {
      let bone = this.bones[i];
      if (bone.rootBone) {
        bone.setGlobalMatrixAll(null);
      }
    }
    let nBones = this.boneOrder.length;
    if (nBones > 0) {
      for (let i=0; i<nBones; i++) {
        wm.copyFrom(this.boneOrder[i].worldMatrix);
        if (!this.disableBof) {
          wm.mul(this.boneOrder[i].bofMatrix); // [Pallete_n] = [Cn] x [Mn]^-1;
        }

        let n = i * 12;
        for (let j=0; j<3; j++) {
          let k = n + j * 4;
          this.matrixPalette[k ]    = wm.mat[j];
          this.matrixPalette[k + 1] = wm.mat[j+4];
          this.matrixPalette[k + 2] = wm.mat[j+8];
          this.matrixPalette[k + 3] = wm.mat[j+12];
        }
      }
    } else {                                      // if #this.boneOrder === 0;
      nBones = this.bones.length;
      if (nBones > this.MAX_BONE) { nBones = this.MAX_BONE; }
      for (let i=0; i<nBones; i++) {
        wm.copyFrom(this.bones[i].worldMatrix);
        if (!this.disableBof) {
          wm.mul(this.bones[i].bofMatrix);  // [Pallete_n] = [Cn] x [Mn]^-1;
        }
        let n = i * 12;
        for (let j=0; j<3; j++) {
          let k = n + j * 4;
          this.matrixPalette[k ]    = wm.mat[j];
          this.matrixPalette[k + 1] = wm.mat[j+4];
          this.matrixPalette[k + 2] = wm.mat[j+8];
          this.matrixPalette[k + 3] = wm.mat[j+12];
        }
      }
    }
    return this.matrixPalette;
  }

  // ボーン一覧を出力する
  listBones() {
    this.updateMatrixPalette();
    for (let i=0; i<this.bones.length; i++) {
      let bone = this.bones[i];
      util.printf("[%d] %s\n", i, bone.name);
      util.printf("<<rest var>>\n");
      bone.restMatrix.print();
      util.printf("<<model>>\n");
      bone.modelMatrix.print();
      util.printf("<<bone offset>>\n");
      bone.bofMatrix.print();
      util.printf("<<world>>\n");
      bone.worldMatrix.print();
      util.printf("<<var>>\n");
      bone.matrix.print();
      let pos = bone.getPosition();
      util.printf(" x:% 12.5f, y:% 12.5f, z:% 12.5f\n",
                 pos[0], pos[1], pos[2]);
      let [h, p, b] = bone.getLocalAttitude();
      util.printf(" h:% 12.5f, p:% 12.5f, b:% 12.5f\n", h, p, b);
      let [x, y, z] = bone.getWorldPosition();
      util.printf(" WX:% 11.5f, WY:% 11.5f, WZ:% 11.5f\n", x, y, z);
    }
  }

  // パレット内容を出力する
  printMatrixPalette() {
    this.bindRestPose();
    let m = this.updateMatrixPalette();
    this.listBones();
    util.printf("\n");

    let nBones = this.boneOrder.length;
    if (nBones > 0) {
      if (nBones > this.MAX_BONE) { nBones = this.MAX_BONE; }
      for (let i=0; i<nBones; i++) {
        let bone = this.boneOrder[i];
        let k = i * 16;
        util.printf("-----// Pallete [%2d  %s] --------\n", i, bone.name);
        let fmt = "% 16.11e % 16.11e % 16.11e % 16.11e\n";
        util.printf(fmt, m[k+0], m[k+4], m[k+8],  m[k+12]);
        util.printf(fmt, m[k+1], m[k+5], m[k+9],  m[k+13]);
        util.printf(fmt, m[k+2], m[k+6], m[k+10], m[k+14]);
        util.printf(fmt, m[k+3], m[k+7], m[k+11], m[k+15]);
      }
    } else {
      for (let i=0; i<this.bones.length; i++) {
        let k = i * 16;
        util.printf("-----// Pallete [%2d] --------\n", i);
        let fmt = "% 16.11e % 16.11e % 16.11e % 16.11e\n";
        util.printf(fmt, m[k+0], m[k+4], m[k+8],  m[k+12]);
        util.printf(fmt, m[k+1], m[k+5], m[k+9],  m[k+13]);
        util.printf(fmt, m[k+2], m[k+6], m[k+10], m[k+14]);
        util.printf(fmt, m[k+3], m[k+7], m[k+11], m[k+15]);
      }
    }
  }

  // 骨Shapeを描画する
  drawBones() {
    // showBone(true) 時のみ debugBone 由来の骨可視化 Shape を再帰描画する
    let bone;
    if (this.show === false) { return }
    if (this.bones.length > 0) {
      for (let i=0; i<this.bones.length; i++) {
        bone = this.bones[i];
        if (bone.rootBone) { bone.drawBones(); }
      }
    }
  }

};
