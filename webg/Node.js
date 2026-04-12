// ---------------------------------------------
//  Node.js        2026/04/02
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import CoordinateSystem from "./CoordinateSystem.js";
import Matrix from "./Matrix.js";
import Quat from "./Quat.js";
import Shape from "./Shape.js";
import Tween from "./Tween.js";
import util from "./util.js";

export default class Node extends CoordinateSystem {

  // Shape群とスキン行列管理を持つ描画ノードを生成する
  constructor(parent_bone, name) {
    // NodeはSpace内の変換単位(座標系)
    // Shape複数保持、親子関係、描画再帰を担当する
    super(parent_bone, name);
    this.NODE_T = 0;
    this.BONE_T = 1;
    this.type = this.NODE_T;
    this.modelViewMatrix = new Matrix();
    this.normalMatrix = new Matrix();
    this.attachable = false;
    this.restPos = [0.0, 0.0, 0.0];
    this.restQuat = new Quat();
    this.restScale = 1.0;
    this.restMatrix = new Matrix();
    this.bofMatrix = new Matrix();
    this.modelMatrix = new Matrix();  // for rest position
    this.hasWeights = false;
    if (parent_bone !== null) {
      this.rootBone = false;
    } else {
      this.rootBone = true;
    }
    this.shapeInstances = [];
    this.shapes = this.shapeInstances;
    this.hideShape = true;
    this.positionTweens = [];
    this.rotationTweens = [];
  }

  // 親を設定し階層を更新する
  setParent(parent) {
    this.parent = parent;
  }

  // ノード配下Shapeの表示を切り替える
  hide(true_or_false) {
    this.hideShape = true_or_false;
    let shapes = this.shapes;
    if (shapes.length > 0) {
      for (let i=0; i<shapes.length; i++) {
        shapes[i].hide(true_or_false);
      }
    }
  }

  // アタッチ可能状態を設定する
  setAttachable(true_or_false) {
    this.attachable = true_or_false;
  }

  // Node 側でも local 行列合成 helper を持つ
  // browser の module cache により CoordinateSystem の旧版が残っていても、
  // Node 自身が uniform scale 対応 helper を持っていれば skinned mesh build を継続できる
  composeMatrixFromState(matrix, quat, position, scale = 1.0) {
    matrix.setByQuat(quat);
    matrix.applyUniformScale(scale);
    matrix.position(position);
    return matrix;
  }

  // 行列から uniform scale を除いた剛体部分を返す
  getRigidMatrix(matrix) {
    const scale = matrix.getUniformScale();
    if (scale === null) {
      console.assert(false, "Node only supports uniform scale in matrix decomposition");
      return matrix.clone();
    }
    return matrix.removeUniformScale(scale);
  }

  // 行列から position / quat / uniform scale をまとめて分解する
  decomposeMatrixTransform(matrix) {
    const scale = matrix.getUniformScale();
    console.assert(scale !== null, "Node only supports uniform scale in matrix decomposition");
    const uniformScale = scale ?? 1.0;
    const rigid = matrix.removeUniformScale(uniformScale);
    const quat = new Quat();
    quat.matrixToQuat(rigid);
    return {
      position: matrix.getPosition(),
      quat,
      scale: uniformScale,
      rigid
    };
  }

  // 親から切り離す
  detach() {
    if ((this.type === this.NODE_T) || this.attachable) {
      super.detach();
    }
  }

  // 新しい親へ接続する
  attach(parent_node) {
    if ((this.type === this.NODE_T) || this.attachable) {
      super.attach(parent_node);
    }
  }

  // ボーンオフセット関連を再計算する
  setWeights() {
    this.hasWeights = true;
  }

  // レスト位置を設定する
  setRestPosition(x, y, z) {
    this.restPos[0] = x;
    this.restPos[1] = y;
    this.restPos[2] = z;
    this.setPosition(x, y, z);
  }

  // レスト行列を直接設定する
  setRestByMatrix(matrix) {
    // rest pose(基準姿勢)を行列で与える骨初期姿勢の記録に使用
    const transform = this.decomposeMatrixTransform(matrix);
    this.restMatrix.copyFrom(matrix);
    this.restQuat.copyFrom(transform.quat);
    this.restPos = transform.position;
    this.restScale = transform.scale;
  }

  // レスト姿勢に回転を加える
  rotateRest(head, pitch, bank) {
    let qq = new Quat();
    qq.eulerToQuat(head, pitch, bank);
    this.restQuat.mulQuat(qq);
    this.quat.copyFrom(this.restQuat);
  }

  // レスト位置に移動を加える
  moveRest(x, y, z) {
    const rotationMatrix = new Matrix();
    rotationMatrix.setByQuat(this.restQuat);
    const moved = rotationMatrix.mul3x3Vector([Number(x), Number(y), Number(z)]);
    this.restPos[0] += moved[0];
    this.restPos[1] += moved[1];
    this.restPos[2] += moved[2];
    this.setPosition(this.restPos[0], this.restPos[1], this.restPos[2]);
  }

  // local position を時間をかけて移動する
  // target は [x, y, z] の vec3 を受け、Tween を使って position array を直接補間する
  animatePosition(to, options = {}) {
    if (!Array.isArray(to) || to.length < 3) {
      return null;
    }
    const tween = new Tween(this.position, [to[0], to[1], to[2]], {
      from: options.from !== undefined ? options.from : this.getPosition(),
      durationMs: options.durationMs,
      easing: options.easing ?? "linear",
      onUpdate: (target, progress, tweenRef) => {
        this.dirty = true;
        if (typeof options.onUpdate === "function") {
          options.onUpdate(target, progress, tweenRef, this);
        }
      },
      onComplete: (target, tweenRef) => {
        this.dirty = true;
        if (typeof options.onComplete === "function") {
          options.onComplete(target, tweenRef, this);
        }
      }
    });

    if (!tween.isFinished()) {
      this.positionTweens.push({ tween });
    }
    return tween;
  }

  // animatePosition() で積み上げた移動補間を 1 frame 進める
  updateAnimatedPosition(deltaMs = 0) {
    if (!Array.isArray(this.positionTweens) || this.positionTweens.length === 0) {
      return 0;
    }
    const active = [];
    let updatedCount = 0;
    for (let i = 0; i < this.positionTweens.length; i++) {
      const entry = this.positionTweens[i];
      if (!entry?.tween) continue;
      const finished = entry.tween.update(deltaMs);
      updatedCount += 1;
      if (!finished) {
        active.push(entry);
      }
    }
    this.positionTweens = active;
    return updatedCount;
  }

  // 実行中の position animation を消す
  clearAnimatedPosition() {
    this.positionTweens = [];
  }

  // local rotation を時間をかけて移動する
  // target は Euler [head, pitch, bank] を基本にし、relative=true なら現在姿勢からの差分として扱う
  animateRotation(to, options = {}) {
    if (!to) {
      return null;
    }

    const toQuat = new Quat();
    let targetQuat = null;

    if (Array.isArray(to) && to.length >= 3) {
      toQuat.eulerToQuat(to[0], to[1], to[2]);
      targetQuat = toQuat;
    } else if (to instanceof Quat) {
      targetQuat = to.clone();
    } else if (typeof to === "object") {
      if (Array.isArray(to.quat) && to.quat.length >= 4) {
        const quat = new Quat();
        quat.q[0] = Number(to.quat[0]);
        quat.q[1] = Number(to.quat[1]);
        quat.q[2] = Number(to.quat[2]);
        quat.q[3] = Number(to.quat[3]);
        quat.normalize();
        targetQuat = quat;
      } else {
        const head = Number.isFinite(to.head) ? Number(to.head)
          : Number.isFinite(to.yaw) ? Number(to.yaw)
            : 0.0;
        const pitch = Number.isFinite(to.pitch) ? Number(to.pitch) : 0.0;
        const bank = Number.isFinite(to.bank) ? Number(to.bank)
          : Number.isFinite(to.roll) ? Number(to.roll)
            : 0.0;
        toQuat.eulerToQuat(head, pitch, bank);
        targetQuat = toQuat;
      }
    }

    if (!targetQuat) {
      return null;
    }

    const startQuat = this.quat.clone();
    const endQuat = targetQuat.clone();
    if (options.relative === true) {
      const relativeQuat = targetQuat.clone();
      endQuat.copyFrom(this.quat.clone());
      endQuat.mulQuat(relativeQuat);
    }

    const tweenState = { ratio: 0.0 };
    const durationMs = Number.isFinite(options.durationMs) ? Math.max(0, Number(options.durationMs)) : 0;
    const tween = new Tween(tweenState, { ratio: 1.0 }, {
      durationMs,
      easing: options.easing ?? "linear",
      onUpdate: (target, progress, tweenRef) => {
        const q = new Quat();
        q.slerp(startQuat, endQuat, target.ratio);
        this.quat.copyFrom(q);
        this.dirty = true;
        if (typeof options.onUpdate === "function") {
          options.onUpdate(this, progress, tweenRef);
        }
      },
      onComplete: (target, tweenRef) => {
        const q = new Quat();
        q.slerp(startQuat, endQuat, 1.0);
        this.quat.copyFrom(q);
        this.dirty = true;
        if (typeof options.onComplete === "function") {
          options.onComplete(this, tweenRef);
        }
      }
    });

    if (options.append !== true) {
      this.clearAnimatedRotation();
    }
    if (!tween.isFinished()) {
      this.rotationTweens.push({ tween });
    }
    return tween;
  }

  // animateRotation() で積み上げた回転補間を 1 frame 進める
  updateAnimatedRotation(deltaMs = 0) {
    if (!Array.isArray(this.rotationTweens) || this.rotationTweens.length === 0) {
      return 0;
    }
    const active = [];
    let updatedCount = 0;
    for (let i = 0; i < this.rotationTweens.length; i++) {
      const entry = this.rotationTweens[i];
      if (!entry?.tween) continue;
      const finished = entry.tween.update(deltaMs);
      updatedCount += 1;
      if (!finished) {
        active.push(entry);
      }
    }
    this.rotationTweens = active;
    return updatedCount;
  }

  // 実行中の rotation animation を消す
  clearAnimatedRotation() {
    this.rotationTweens = [];
  }

  // 現在姿勢からレスト行列を更新する
  setRestMatrix() {
    this.composeMatrixFromState(this.restMatrix, this.restQuat, this.restPos, this.restScale);
  }

  // 子孫含めモデル行列を更新する
  setModelMatrixAll(mmat) {
    // rest pose側の累積行列 [Mn] とその逆行列(BOF) を再帰計算する
    this.setRestMatrix();
    this.modelMatrix.copyFrom(this.restMatrix);
    if (this.parent !== null && mmat !== null) {
      this.modelMatrix.lmul(mmat);      // [Mn]=[J0]x[J1]x ..[Jn]
    }
    let children = this.children;
    for (let j=0; j<children.length; j++) {
      if (children[j]) {
        children[j].setModelMatrixAll(this.modelMatrix);
      }
    }
    this.bofMatrix.copyFrom(this.modelMatrix);
    this.bofMatrix.inverse();           // [Mn]^-1
  }

  // 子孫含めグローバル行列を更新する
  setGlobalMatrixAll(wmat) {
    // 現在姿勢側の累積行列 [Cn] を再帰計算する
    // this.setWorldMatrixAll(wmat)
    this.composeMatrixFromState(this.matrix, this.quat, this.position, this.scale);
    this.worldMatrix.copyFrom(this.matrix);
    if ((this.rootBone === false) && (wmat !== null)) {
      this.worldMatrix.lmul(wmat);      // [Cn] = [Q0] x ... x [Qn]
    }
    let children = this.children;
    for (let j=0; j<children.length; j++) {
      if (children[j]) {
        children[j].setWorldMatrixAll(this.worldMatrix);
      }
    }
  }

  // レスト行列を返す
  getRestMatrix() {
    return this.restMatrix.clone();
  }

  // モデル行列を返す
  getModelMatrix() {
    return this.modelMatrix.clone();
  }

  // Bone Offset行列を返す
  getBofMatrix() {
    return this.bofMatrix.clone();
  }

  // グローバル行列を返す
  getGlobalMatrix() {
    return this.getWorldMatrix();
  }

  // Shapeを追加する
  addShape(shape) {
    // Node へ ShapeInstance を追加する
    // ShapeResource が渡された場合はここで instance を生成する
    if (shape === null) {
      util.printf("Error, try to add null shape to %s.", this.name);
      return;
    }
    let shapeInstance = shape;
    if (shape?.isShapeResource) {
      shapeInstance = new Shape(shape);
    }
    this.shapeInstances.push(shapeInstance);
    this.shapes = this.shapeInstances;
    shapeInstance.ownerNode = this;
    if (shapeInstance.skeleton === null) { return shapeInstance; }
    let bones = shapeInstance.skeleton.bones;
    if (bones.length > 0) {
      for (let i=0; i<bones.length; i++) {
        if (bones[i].parent === null) {
          bones[i].parent = this;
          this.addChild(bones[i]);
        }
      }
    }
    return shapeInstance;
  }

  // 保持Shapeを削除する
  delShape() {
    this.shapeInstances.pop();
    this.shapes = this.shapeInstances;
  }

  // Shapeを1つ設定する
  setShape(shape) {
     this.shapeInstances = [];
     this.shapes = this.shapeInstances;
     return this.addShape(shape);
  }

  // n番目Shapeを返す
  getShape(n) {
    if ((n > this.shapes.length) || (n <= 0)) {
      return null;
    } else {
      return this.shapes[n];
    }
  }

  // Shape数を返す
  getShapeCount() {
    return this.shapeInstances.length;
  }

  // Shapeを描画する
  draw(view_matrix, light_vec, count) {
    // Node単位の描画:
    // 1) modelView/normal行列作成
    // 2) 自Shapeを描画
    // 3) 子Nodeへ再帰
    if ((this.type === this.BONE_T) && !this.attachable) {
      return;
    }

    let modelview = this.modelViewMatrix;
    let normal = this.normalMatrix;
    this.setMatrix();
    modelview.copyFrom(this.matrix);
    modelview.lmul(view_matrix);  //  eye = [view] * [model] * local
    normal.copyFrom(modelview);
    normal.position([0, 0, 0]);

    if (this.type === this.NODE_T) {
      let shapes = this.shapes;
      for (let i=0; i<shapes.length; i++) {
        if (light_vec !== null) {
          shapes[i].shaderParameter("light", light_vec);
        }
        shapes[i].draw(modelview, normal);
        if (count === 1) { // for debug
          // console.log(this.getPosition());
        }
      }
    }

    let children = this.children;
    for (let j=0; j<children.length; j++) {
      if (children[j]) {
        children[j].draw(modelview, light_vec);
      }
    }
  }

  // スケルトン骨形状を描画する
  drawBones() {
    let modelview = this.modelViewMatrix;
    let normal = this.normalMatrix;
    if (this.type === this.BONE_T) {
      let shapes = this.shapes;

      // 2026-02-17 seems OK, but need to check if this is correct or not.
      //console.log("draw bone: " + this.name + "-" + shapes.length);
      //shapes[0].listVertexAll();

      for (let i=0; i<shapes.length; i++) {
        shapes[i].draw(modelview, normal);
      }
    }
    let children = this.children;
    for (let j=0; j<children.length; j++) {
      if (children[j]) {
        children[j].drawBones();
      }
    }
  }

};  // class Node
