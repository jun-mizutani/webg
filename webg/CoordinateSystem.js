// ---------------------------------------------
//  CoordinateSystem.js  2026/04/21
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Matrix from "./Matrix.js";
import Quat from "./Quat.js";
import util from "./util.js";

export default class CoordinateSystem {

  // 階層ノードの姿勢/位置基底を初期化する
  constructor(parent_node, name) {
    // Node/Bone共通の座標系基底クラス
    // 位置・回転(quat)・親子関係・ワールド行列更新を担当する
    this.name = name;
    this.parent = parent_node;
    this.children = [];
    this.type = 0;
    this.matrix = new Matrix();
    this.worldMatrix = new Matrix();
    this.position = [0, 0, 0];
    this.quat = new Quat();
    this.scale = 1.0;
    this.matrixOverride = null;
    this.dirty = true;
    this.accumulatedRatio = 0;
    this.startRotation = new Quat();
    this.endRotation = new Quat();
    this.startPosition = null;
    this.transDistance = [];
  }

  // 姿勢情報をデバッグ出力する
  print(str, q, pos) {
    util.printf("%s h.%8.3f p.%8.3f b.%8.3f ", str, q.quatToEuler());
    util.printf(" x.%9.4f y.%9.4f z.%9.4f\n", ...pos);
  }

  // 移動制限情報を出力する
  printMoveRange() {
    this.print("start", this.startRotation, this.startPosition);
    this.print("end  ", this.endRotation, this.transDistance);
  }

  // タイプ識別子を設定する
  setType(type) {
    this.type = type;
  }

  // タイプ識別子を返す
  getType() {
    return this.type;
  }

  // 子ノードを追加する
  addChild(child) {
    this.children.push(child);
  }

  // 子ノード数を返す
  getNoOfChildren() {
    return this.children.length;
  }

  // n番目子ノードを返す
  getChild(n) {
    if (n > this.children.length) {
      return null;
    } else {
      return this.children[n];
    }
  }

  // 親ノードを設定する
  setParent(parent) {
    this.parent = parent;
  }

  // 親ノードを返す
  getParent() {
    return this.parent;
  }

  // ノード名を設定する
  setName(name) {
    this.name = name;
  }

  // ノード名を返す
  getName() {
    return this.name;
  }

  // 姿勢を設定する（head=Y, pitch=X, bank=Z）
  // 一般的な3D用語では yaw=Y, pitch=X, roll=Z に相当する
  setAttitude(head, pitch, bank) {
    this.matrixOverride = null;
    this.quat.eulerToQuat(head, pitch, bank);
    this.dirty = true;
  }

  // `setAttitude` の一般3D向け別名（yaw=Y, pitch=X, roll=Z）
  setYawPitchRoll(yaw, pitch, roll) {
    this.setAttitude(yaw, pitch, roll);
  }

  // ワールド姿勢(Euler)を返す
  getWorldAttitude() {
    this.setWorldMatrix();
    const rigid = this.getRigidMatrix(this.worldMatrix);
    return rigid.matToEuler();  // return [ry, rx, rz]
  }

  // ローカル姿勢(Euler)を返す
  getLocalAttitude() {
    this.setMatrix();
    const rigid = this.getRigidMatrix(this.matrix);
    return rigid.matToEuler();       // return [ry, rx, rz]
  }

  // ワールド位置を返す
  getWorldPosition() {
    this.setWorldMatrix();
    return this.worldMatrix.getPosition(); // return [x, y, z]
  }

  // ローカル位置を返す
  getPosition() {
    return [...this.position];
  }

  // ローカル位置を設定する
  setPosition(x, y, z) {
    this.matrixOverride = null;
    this.position[0] = x;
    this.position[1] = y;
    this.position[2] = z;
    this.dirty = true;
  }

  // X位置のみ設定する
  setPositionX(x) {
    this.matrixOverride = null;
    this.position[0] = x;
    this.dirty = true;
  }

  // Y位置のみ設定する
  setPositionY(y) {
    this.matrixOverride = null;
    this.position[1] = y;
    this.dirty = true;
  }

  // Z位置のみ設定する
  setPositionZ(z) {
    this.matrixOverride = null;
    this.position[2] = z;
    this.dirty = true;
  }

  // local uniform scale を返す
  getScale() {
    return this.scale;
  }

  // local uniform scale を設定する
  // CoordinateSystem は最初の導入段階では uniform scale のみを扱う
  setScale(scale) {
    const numericScale = Number(scale);
    console.assert(
      Number.isFinite(numericScale) && Math.abs(numericScale) > 1.0e-8,
      "CoordinateSystem.setScale() requires a non-zero finite number"
    );
    if (!Number.isFinite(numericScale) || Math.abs(numericScale) <= 1.0e-8) {
      return;
    }
    this.matrixOverride = null;
    this.scale = numericScale;
    this.dirty = true;
  }

  // ローカルX回転を加算する
  rotateX(degree) {
    let qq = new Quat();
    this.matrixOverride = null;
    qq.setRotateX(degree);
    this.quat.mulQuat(qq);
    this.dirty = true;
  }

  // ローカルY回転を加算する
  rotateY(degree) {
    let qq = new Quat();
    this.matrixOverride = null;
    qq.setRotateY(degree);
    this.quat.mulQuat(qq);
    this.dirty = true;
  }

  // ローカルZ回転を加算する
  rotateZ(degree) {
    let qq = new Quat();
    this.matrixOverride = null;
    qq.setRotateZ(degree);
    this.quat.mulQuat(qq);
    this.dirty = true;
  }

  // Euler回転を加算する
  // 引数順は webg 伝統の head(Y) / pitch(X) / bank(Z)
  rotate(head, pitch, bank) {
    let qq = new Quat();
    this.matrixOverride = null;
    qq.eulerToQuat(head, pitch, bank);
    this.quat.mulQuat(qq);
    this.dirty = true;
  }

  // `rotate` の一般3D向け別名（yaw=Y, pitch=X, roll=Z）
  rotateYawPitchRoll(yaw, pitch, roll) {
    this.rotate(yaw, pitch, roll);
  }

  // yaw は Y軸回転に相当する
  rotateYaw(degree) {
    this.rotateY(degree);
  }

  // pitch は X軸回転に相当する
  rotatePitch(degree) {
    this.rotateX(degree);
  }

  // roll は Z軸回転に相当する
  rotateRoll(degree) {
    this.rotateZ(degree);
  }

  // ローカル平行移動を加算する
  move(x, y, z) {
    const rotationMatrix = new Matrix();
    const delta = [Number(x), Number(y), Number(z)];
    this.matrixOverride = null;
    rotationMatrix.setByQuat(this.quat);
    const moved = rotationMatrix.mul3x3Vector(delta);
    this.position[0] += moved[0];
    this.position[1] += moved[1];
    this.position[2] += moved[2];
  }

  // quat / position / scale から local 行列を組み立てる
  // translation は最後の列なので、uniform scale を掛けても node の原点位置自体は変わらない
  composeMatrixFromState(matrix, quat, position, scale = 1.0) {
    matrix.setByQuat(quat);
    matrix.applyUniformScale(scale);
    matrix.position(position);
    return matrix;
  }

  // 行列から uniform scale を除いた剛体部分を返す
  // Euler / Quaternion へ戻すときは、回転部分だけを正規化して読む
  getRigidMatrix(matrix) {
    const scale = matrix.getUniformScale();
    if (scale === null) {
      throw new Error("CoordinateSystem.getRigidMatrix only supports uniform scale");
    }
    return matrix.removeUniformScale(scale);
  }

  // 行列から position / quat / uniform scale をまとめて分解する
  decomposeMatrixTransform(matrix) {
    const scale = matrix.getUniformScale();
    if (scale === null) {
      throw new Error("CoordinateSystem.decomposeMatrixTransform only supports uniform scale");
    }
    const rigid = matrix.removeUniformScale(scale);
    const quat = new Quat();
    quat.matrixToQuat(rigid);
    return {
      position: matrix.getPosition(),
      quat,
      scale,
      rigid
    };
  }

  // ローカル行列を再構築する
  setMatrix() {
    if (this.matrixOverride) {
      this.matrix.copyFrom(this.matrixOverride);
      this.dirty = false;
      return;
    }
    if (this.dirty) {
      this.composeMatrixFromState(this.matrix, this.quat, this.position, this.scale);
      this.dirty = false;
    } else {
      this.matrix.position(this.position);
    }
  }

  // 親行列を反映してワールド行列を再計算する
  setWorldMatrix() {
    let parent = this.parent;
    this.setMatrix();
    if (parent) {
      parent.setWorldMatrix();
      this.worldMatrix = this.matrix.clone();
      this.worldMatrix.lmul(parent.worldMatrix);
    } else {
      this.worldMatrix = this.matrix.clone();
    }
  }

  // サブツリー全体のワールド行列を更新する
  setWorldMatrixAll(wmat) {
    if (this.matrixOverride) {
      this.matrix.copyFrom(this.matrixOverride);
    } else {
      this.composeMatrixFromState(this.matrix, this.quat, this.position, this.scale);
    }
    this.worldMatrix.copyFrom(this.matrix);
    if ((this.parent !== null) && (wmat !== null)) {
      this.worldMatrix.lmul(wmat);      // [Cn] = [Q0] x ... x [Qn];
    }
    let children = this.children;
    for (let j=0; j<children.length; j++) {
      children[j].setWorldMatrixAll(this.worldMatrix);
    }
  }

  // ワールド行列を返す
  getWorldMatrix() {
    this.setWorldMatrix();
    return this.worldMatrix.clone();
  }

  // 行列から姿勢/位置を設定する
  setByMatrix(matrix) {
    this.matrix.copyFrom(matrix);
    const scale = matrix.getUniformScale();
    if (scale === null) {
      // SceneLoader の placement node のように、
      // 非一様 scale を含む静的行列は分解せず local matrix として保持する
      // setter が呼ばれた時点で override は解除され、通常の TRS 経路へ戻る
      this.matrixOverride = matrix.clone();
      this.position = matrix.getPosition();
      this.quat = new Quat();
      this.scale = 1.0;
      this.dirty = false;
      return;
    }
    const transform = this.decomposeMatrixTransform(matrix);
    this.matrixOverride = null;
    this.quat.copyFrom(transform.quat);
    this.position = transform.position;
    this.scale = transform.scale;
    this.dirty = false;
  }

  // クォータニオン姿勢を設定する
  setQuat(quat) {
    this.matrixOverride = null;
    this.quat = quat;
  }

  // ローカルクォータニオンを返す
  getQuat() {
    return [...this.quat];
  }

  // 行列からクォータニオンを算出して返す
  getQuatFromMatrix() {
    let quat = new Quat();
    const rigid = this.getRigidMatrix(this.matrix);
    quat.matrixToQuat(rigid);
    return quat;
  }

  // 行列から位置を抽出して返す
  getPositionFromMatrix() {
    return this.matrix.getPosition();
  }

  // 親子関係を解除する
  detach() {
    let parent = this.parent;
    if (parent!==null) {
      this.setWorldMatrix();
      this.setByMatrix(this.worldMatrix);
      this.dirty = true;
      if (parent.children.length > 0) {
        for (let i=0; i<parent.children.length; i++) {
          if (parent.children[i] == this) {
            parent.children.splice(i, 1);
            break;
          }
        }
      }
      this.parent = null;
    }
  }

  // 新しい親へ接続する
  attach(parent_node) {
    if ((this.parent === null) && (parent_node)) {
      this.setWorldMatrix();
      const localMatrix = this.worldMatrix.clone();
      const parentWorld = parent_node.getWorldMatrix();
      const inverseParent = parentWorld.clone();
      const inverted = inverseParent.inverse_strict();
      console.assert(inverted, "CoordinateSystem.attach() requires an invertible parent matrix");
      if (!inverted) {
        return;
      }
      localMatrix.lmul(inverseParent);
      this.setByMatrix(localMatrix);
      this.parent = parent_node;
      parent_node.children.push(this);
      this.dirty = true;
    }
  }

  // 親変更時に見た目保持で逆変換を適用する
  inverse(new_parent) {
    if (this.parent) {
      let p = this.parent;
      this.detach();
      p.inverse();
    }
    this.attach(new_parent);
  }

  // 他ノードとの距離を返す
  distance(node) {
    let a = this.getWorldPosition();
    let b = node.getWorldPosition();
    let x = b[0] - a[0];
    let y = b[1] - a[1];
    let z = b[2] - a[2];
    return Math.sqrt(x * x + y * y + z * z);
  }

  // 回転差分を設定する
  putRotation(head, pitch, bank) {
    this.accumulatedRatio = 0;
    let qq = new Quat();
    qq.eulerToQuat(head, pitch, bank);
    this.startRotation.copyFrom(this.quat);
    this.endRotation.copyFrom(this.quat);
    this.endRotation.mulQuat(qq);
  }

  // クォータニオン差分回転を設定する
  putRotationByQuat(quat) {
    this.accumulatedRatio = 0;
    this.startRotation.copyFrom(this.quat);
    this.endRotation.copyFrom(this.quat);
    this.endRotation.mulQuat(quat);
  }

  // 絶対姿勢をクォータニオンで設定する
  putAttitudeByQuat(quat) {
    this.accumulatedRatio = 0;
    this.startRotation.copyFrom(this.quat);
    this.endRotation.copyFrom(quat);
  }

  // 絶対姿勢をEulerで設定する
  putAttitude(head, pitch, bank) {
    this.accumulatedRatio = 0;
    this.startRotation.copyFrom(this.quat);
    this.endRotation.eulerToQuat(head, pitch, bank);
  }

  // 移動差分を設定する
  putDistance(x, y, z) {
    this.accumulatedRatio = 0;
    this.startPosition = [...this.position];
    this.transDistance = [x, y, z];
  }

  // 回転+移動を同時設定する
  putRotTrans(quat, pos) {
    this.accumulatedRatio = 0;
    this.startRotation.copyFrom(this.quat);
    this.endRotation.copyFrom(this.quat);
    this.endRotation.mulQuat(quat);
    this.startPosition = [...this.position];
    this.transDistance = [...pos];
  }

  // 行列から回転+移動を設定する
  putRotTransByMatrix(matrix) {
    this.accumulatedRatio = 0;
    const transform = this.decomposeMatrixTransform(matrix);
    this.matrixOverride = null;
    this.startRotation.copyFrom(this.quat);
    this.endRotation.copyFrom(transform.quat);
    this.startPosition = [...this.position];
    this.scale = transform.scale;
    this.dirty = true;
    let endPosition = transform.position;
    for (let i=0; i<3; i++) {
      this.transDistance[i] = endPosition[i] - this.startPosition[i];
    }
  }

  // 補間率 `t` で回転を適用する
  execRotation(t) {
    this.quat.slerp(this.startRotation, this.endRotation, t);
    this.dirty = true;
  }

  // 補間率 `t` で移動を適用する
  execTranslation(t) {
    let distance = this.transDistance;
    let pos = this.startPosition;
    this.position[0] = pos[0] + distance[0] * t;
    this.position[1] = pos[1] + distance[1] * t;
    this.position[2] = pos[2] + distance[2] * t;
  }

  // 回転のみ補間実行する
  doRotation(t) {
    this.accumulatedRatio = this.accumulatedRatio + t;
    let accum = this.accumulatedRatio;
    this.execRotation(accum);
  }

  // 移動のみ補間実行する
  doTranslation(t) {
    this.accumulatedRatio = this.accumulatedRatio + t;
    let accum = this.accumulatedRatio;
    this.execTranslation(accum);
  }

  // 回転+移動を補間実行する
  doRotTrans(t) {
    this.accumulatedRatio = this.accumulatedRatio + t;
    let accum = this.accumulatedRatio;
    this.execRotation(accum);
    this.execTranslation(accum);
  }
};
