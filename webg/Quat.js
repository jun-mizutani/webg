// ---------------------------------------------
// Quat.js        2026/04/18
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Matrix from "./Matrix.js";
import util from "./util.js";

function RAD(degree) {
  return degree * Math.PI / 180.0;
}

function DEG(radian) {
  return radian * 180.0 / Math.PI;
}

export default class Quat {

  // 単位クォータニオンを初期化する
  constructor() {
    // 回転表現クォータニオンEuler/行列との相互変換を提供する
    this.q = [1.0, 0.0, 0.0, 0.0];
  }

  // 右からクォータニオン乗算する
  mulQuat(qb) {
    let q0 = this.q[0];
    let q1 = this.q[1];
    let q2 = this.q[2];
    let q3 = this.q[3];
    let b0 = qb.q[0];
    let b1 = qb.q[1];
    let b2 = qb.q[2];
    let b3 = qb.q[3];
    this.q[0] = q0 * b0 - q1 * b1 - q2 * b2 - q3 * b3;
    this.q[1] = q0 * b1 + q1 * b0 + q2 * b3 - q3 * b2;
    this.q[2] = q0 * b2 + q2 * b0 - q1 * b3 + q3 * b1;
    this.q[3] = q0 * b3 + q3 * b0 + q1 * b2 - q2 * b1;
  }

  // 左からクォータニオン乗算する
  lmulQuat(qb) {
    let q0 = this.q[0];
    let q1 = this.q[1];
    let q2 = this.q[2];
    let q3 = this.q[3];
    let b0 = qb.q[0];
    let b1 = qb.q[1];
    let b2 = qb.q[2];
    let b3 = qb.q[3];
    this.q[0] = b0 * q0 - b1 * q1 - b2 * q2 - b3 * q3;
    this.q[1] = b0 * q1 + b1 * q0 + b2 * q3 - b3 * q2;
    this.q[2] = b0 * q2 + b2 * q0 - b1 * q3 + b3 * q1;
    this.q[3] = b0 * q3 + b3 * q0 + b1 * q2 - b2 * q1;
  }

  // 共役クォータニオンを作る
  conjugate() {
    //  this.q[0] =  this.q[0];
    this.q[1] = -this.q[1];
    this.q[2] = -this.q[2];
    this.q[3] = -this.q[3];
  }

  // 正規化する
  normalize() {
    let q0 = this.q[0];
    let q1 = this.q[1];
    let q2 = this.q[2];
    let q3 = this.q[3];

    let s = Math.sqrt(q0*q0 + q1*q1 + q2*q2 + q3*q3);
    // q[]に不正な値が入っている場合の対策
    if (s <= 0.0) {
      this.q[0] = 1.0;
      this.q[1] = 0.0;
      this.q[2] = 0.0;
      this.q[3] = 0.0;
      return;
    }
    this.q[0] = q0 / s;
    this.q[1] = q1 / s;
    this.q[2] = q2 / s;
    this.q[3] = q3 / s;
  }

  // X軸回転を設定する
  setRotateX(degree) {
    let r = RAD(degree) * 0.5;
    this.q[0] = Math.cos(r);
    this.q[1] = Math.sin(r);
    this.q[2] = 0.0;
    this.q[3] = 0.0;
  }

  // Y軸回転を設定する
  setRotateY(degree) {
    let r = RAD(degree) * 0.5;
    this.q[0] = Math.cos(r);
    this.q[1] = 0.0;
    this.q[2] = Math.sin(r);
    this.q[3] = 0.0;
  }

  // Z軸回転を設定する
  setRotateZ(degree) {
    let r = RAD(degree) * 0.5;
    this.q[0] = Math.cos(r);
    this.q[1] = 0.0;
    this.q[2] = 0.0;
    this.q[3] = Math.sin(r);
  }

  // Euler(Y/X/Z)から変換する
  eulerToQuat(head, pitch, bank) {
    let cosB = Math.cos(RAD(bank ) * 0.5);
    let cosP = Math.cos(RAD(pitch) * 0.5);
    let cosH = Math.cos(RAD(head ) * 0.5);
    let sinB = Math.sin(RAD(bank ) * 0.5);
    let sinP = Math.sin(RAD(pitch) * 0.5);
    let sinH = Math.sin(RAD(head ) * 0.5);

    let cosBcosP = cosB * cosP;
    let sinBsinP = sinB * sinP;
    let cosBsinP = cosB * sinP;
    let sinBcosP = sinB * cosP;

    this.q[0] = cosBcosP * cosH - sinBsinP * sinH;
    this.q[1] = cosBsinP * cosH - sinBcosP * sinH;
    this.q[2] = cosBcosP * sinH + sinBsinP * cosH;
    this.q[3] = sinBcosP * cosH + cosBsinP * sinH;
  }

  // 内積を返す
  dotProduct(qr) {
    let dp = 0;
    for(let i=0; i<4; i++) {
      dp = dp + this.q[i] * qr.q[i];
    }
    return dp;
  }

  // 符号反転する
  negate() {
    let q = this.q;
    q[0] = -q[0];
    q[1] = -q[1];
    q[2] = -q[2];
    q[3] = -q[3];
  }

  // 球面線形補間結果を返す
  slerp(a, b, t) {
    const end = b.clone();
    let cosp = a.q[0]*end.q[0] + a.q[1]*end.q[1] + a.q[2]*end.q[2] + a.q[3]*end.q[3];
    if (cosp < 0.0) {
      end.negate();
      cosp = -cosp;
    }
    cosp = Math.max(-1.0, Math.min(1.0, cosp));
    let p = Math.acos(cosp);
    let sinp = Math.sin(p);

    let s = sinp;
    if (sinp < 0.0) { s = -sinp }

    if (s > 0.0002) {  // 0.01146 degree;
      let scale0 = Math.sin((1.0 - t) * p) / sinp;
      let scale1 = Math.sin(t * p) / sinp;
      for(let i=0; i<4; i++) {
        this.q[i] = scale0 * a.q[i] + scale1 * end.q[i];
      }
    } else {
      for(let i=0; i<4; i++) {
        this.q[i] = end.q[i];
      }
    }
    this.normalize();
  }

  // 回転行列から変換する
  matrixToQuat(m) {
    let S;
    const trace = m.mat[0] + m.mat[5] + m.mat[10];
    if (trace > 0.0) {
      this.q[0] = Math.sqrt(trace + 1.0) / 2.0;
      S = 4 * this.q[0];
      if (S !== 0.0) {
        this.q[1] = (m.mat[6] - m.mat[9])/S;
        this.q[2] = (m.mat[8] - m.mat[2])/S;
        this.q[3] = (m.mat[1] - m.mat[4])/S;
      }
    } else {
      let i = 0;
      if (m.mat[5] > m.mat[0]) {
        i=1;
        if (m.mat[10] > m.mat[5]) {  i=2 }
      } else if (m.mat[10] > m.mat[0]) {
        i=2;
      }

      if (i===0) {
        this.q[1] = Math.sqrt(Math.max(0.0, 1.0 + m.mat[0] - m.mat[5] - m.mat[10])) / 2.0;
        S = 4 * this.q[1];
        if (S !== 0.0) {
          this.q[0] = (m.mat[6] - m.mat[9])/S;
          this.q[2] = (m.mat[4] + m.mat[1])/S;
          this.q[3] = (m.mat[8] + m.mat[2])/S;
        }
      } else if (i===1) {
          this.q[2] = Math.sqrt(Math.max(0.0, 1.0 - m.mat[0] + m.mat[5] - m.mat[10])) / 2.0;
          S = 4 * this.q[2];
          if (S !== 0.0) {
            this.q[0] = (m.mat[8]-m.mat[2])/S;
            this.q[1] = (m.mat[4]+m.mat[1])/S;
            this.q[3] = (m.mat[9]+m.mat[6])/S;
          }
      } else if (i===2) {
        this.q[3] = Math.sqrt(Math.max(0.0, 1.0 - m.mat[0] - m.mat[5] + m.mat[10])) / 2.0;
        S = 4 * this.q[3];
        if (S !== 0.0) {
          this.q[0] = (m.mat[1] - m.mat[4])/S;
          this.q[1] = (m.mat[8] + m.mat[2])/S;
          this.q[2] = (m.mat[9] + m.mat[6])/S;
        }
      }
    }
    this.normalize();
  }

  // 値を出力する
  print() {
    let q = this.q;
    util.printf("% 16.11e % 16.11e % 16.11e % 16.11e\n", q[0], q[1], q[2], q[3]);
  }

  // 複製を返す
  clone() {
    let quat = new Quat();
    for (let i=0; i<4; i++) { quat.q[i] = this.q[i]; }
    return quat;
  }

  // 別Quatをコピーする
  copyFrom(quat) {
    for (let i=0; i<4; i++) { this.q[i] = quat.q[i]; }
  }

  // 値妥当性を確認する
  check() {
    let q = this.q;
    let nan = false;
    for (let i=0; i<4; i++) {
      if (q[i] !== q[i]) { nan = true; break; }
    }
    if (nan) {
      this.print();
      console.assert(false, "NaN");
    }
  }

  // Eulerへ変換する
  quatToEuler() {
    let mat = new Matrix();
    mat.setByQuat(this);
    return mat.matToEuler();  // return head, pitch, bank;
  }
};
