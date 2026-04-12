// ---------------------------------------------
// Matrix.js       2026/04/02
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

/* ---------------------------------------------
   usage
   ---------------------------------------------
  let Matrix = require("./Matrix")
  m = new Matrix.Matrix()
  m.mul(m)

>   let Matrix = require("./Matrix")
undefined
>   m = new Matrix.Matrix()
Matrix { mat: [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] }
>   m.mul(m)
Matrix { mat: [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] }

----------------------------------------------- */

import util from "./util.js";

function RAD(degree) {
  return degree * Math.PI / 180.0;
}

function DEG(radian) {
  return radian * 180.0 / Math.PI;
}

export default class Matrix {

  // 4x4行列を生成する
  constructor() {
    // 列優先4x4行列Node/Shader/Skeleton全体で共通利用する
    this.mat = [ 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0,
                 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0 ];
  }

  // 単位行列にする
  makeUnit() {
    for (let i=0; i<16; i++) { this.mat[i] = 0.0 }
    this.mat[0] = 1.0; this.mat[5] = 1.0;
    this.mat[10]= 1.0; this.mat[15] = 1.0;
  }

  // 零行列にする
  makeZero() {
    for (let i=0; i<16; i++) { this.mat[i] = 0.0 }
  }

  // 要素を書き込む
  set(row, column, val) {
    this.mat[column * 4 + row] = val;
  }

  // 行列妥当性を確認する
  check() {
    let m = this.mat;
    let nan = false;
    for (let i=0; i<16; i++) {
      if (m[i]!==m[i]) { nan = true; break; }
    }
    if (nan) {
      this.print();
      console.assert(false, "NaN");
    }
  }

  // 配列から全要素を設定する
  setBulk(numtable) {
    for (let i=0; i<16; i++) {
      this.mat[i] = numtable[i];
    }
  }

  // 配列+オフセットで設定する
  setBulkWithOffset(numtable, offset) {
    for (let i=0; i<16; i++) {
      this.mat[i] = numtable[i + offset];
    }
  }

  // 要素を読む
  get(row, column) {
    return this.mat[column * 4 + row];
  }

  // 複製行列を返す
  clone() {
    let mat = new Matrix();
    for (let i=0; i<16; i++) { mat.mat[i] = this.mat[i]; }
    return mat;
  }

  // 別行列をコピーする
  copyFrom(mat) {
    for (let i=0; i<16; i++) { this.mat[i] = mat.mat[i]; }
  }

  // クォータニオンから回転行列を構築する

  setByQuat(quat) {
    // クォータニオンから回転行列を構成する
    let a = this.mat;
    let q0 = quat.q[0];
    let q1 = quat.q[1];
    let q2 = quat.q[2];
    let q3 = quat.q[3];
    let q1_2 = q1 + q1;
    let q2_2 = q2 + q2;
    let q3_2 = q3 + q3;
    let q01 = q0 * q1_2;
    let q02 = q0 * q2_2;
    let q03 = q0 * q3_2;
    let q11 = q1 * q1_2;
    let q12 = q1 * q2_2;
    let q13 = q1 * q3_2;
    let q22 = q2 * q2_2;
    let q23 = q2 * q3_2;
    let q33 = q3 * q3_2;
    a[0] = 1 - (q22 + q33);  //  b11
    a[1] = q12 + q03;        //  b21
    a[2] = q13 - q02;        //  b31
    a[4] = q12 - q03;        //  b12
    a[5] = 1 - (q11 + q33);  //  b22
    a[6] = q23 + q01;        //  b32
    a[8] = q13 + q02;        //  b13
    a[9] = q23 - q01;        //  b23
    a[10]= 1 - (q11 + q22);  //  b33
    a[3] = 0.0; a[7] = 0.0; a[11] = 0.0;
    a[12] = 0.0; a[13] = 0.0; a[14] = 0.0; // position
    a[15] = 1.0;
  }

  // XYZ順Eulerから回転行列を構築する
  setByEulerXYZ(rx, ry, rz) {
    // XYZオイラー角(deg)から回転行列を構成する
    let a = this.mat;
    let cosZ = Math.cos(RAD(rz));
    let cosX = Math.cos(RAD(rx));
    let cosY = Math.cos(RAD(ry));
    let sinZ = Math.sin(RAD(rz));
    let sinX = Math.sin(RAD(rx));
    let sinY = Math.sin(RAD(ry));

    let cosXcosZ = cosZ * cosX;
    let sinXsinZ = sinZ * sinX;
    let sinXcosZ = cosZ * sinX;
    let cosXsinZ = sinZ * cosX;

    a[ 0] = cosY * cosZ;
    a[ 1] = -cosY * sinZ;
    a[ 2] = sinY;
    a[ 4] = cosXsinZ + sinXcosZ * sinY;
    a[ 5] = cosXcosZ - sinXsinZ * sinY;
    a[ 6] = -sinX * cosY;
    a[ 8] = sinXsinZ - cosXcosZ * sinY;
    a[ 9] = cosXsinZ * sinY + sinXcosZ;
    a[10] = cosX * cosY;
    a[3] = 0.0; a[7] = 0.0; a[11] = 0.0;
    a[12] = 0.0; a[13] = 0.0; a[14] = 0.0; // position
    a[15] = 1.0;
  }

  // XYZ順Eulerへ変換して返す
  matToEulerXYZ() {
    let rx = DEG(-Math.atan2(this.mat[6], this.mat[10]));
    let ry = DEG( Math.asin(this.mat[2]));
    let rz = DEG(-Math.atan2(this.mat[1], this.mat[0]));
    return [rx, ry, rz];
  }

  // webg順Euler(Y/X/Z)で行列を構築する
  setByEuler(head, pitch, bank) {
    let a = this.mat;
    let cosZ = Math.cos(RAD(bank ));
    let cosX = Math.cos(RAD(pitch));
    let cosY = Math.cos(RAD(head ));
    let sinZ = Math.sin(RAD(bank ));
    let sinX = Math.sin(RAD(pitch));
    let sinY = Math.sin(RAD(head ));

    let cosYcosZ = cosZ * cosY;
    let sinYsinZ = sinZ * sinY;
    let sinYcosZ = cosZ * sinY;
    let cosYsinZ = sinZ * cosY;

    a[ 0] = cosYcosZ - sinX * sinYsinZ;
    a[ 1] = cosYsinZ + sinX * sinYcosZ;
    a[ 2] = -cosX * sinY;
    a[ 4] = -cosX * sinZ;
    a[ 5] = cosX * cosZ;
    a[ 6] = sinX;
    a[ 8] = sinX * cosYsinZ + sinYcosZ;
    a[ 9] = sinYsinZ - sinX * cosYcosZ;
    a[10] = cosX * cosY;
    a[3] = 0.0; a[7] = 0.0; a[11] = 0.0;
    a[12] = 0.0; a[13] = 0.0; a[14] = 0.0; // position
    a[15] = 1.0;
  }

  // webg順Eulerへ変換して返す
  matToEuler() {
    let rz = DEG(-Math.atan2(this.mat[4], this.mat[5]));  //  bank
    let rx = DEG(Math.asin(this.mat[6]));                 //  pitch
    let ry = DEG(-Math.atan2(this.mat[2], this.mat[10])); //  head
    return [ry, rx, rz];             //  [head, pitch, bank]
  }

  // 平行移動成分を設定する
  position(position) {
    // 平行移動成分(tx,ty,tz)を書き込む
    this.mat[12] = position[0];
    this.mat[13] = position[1];
    this.mat[14] = position[2];
  }

  // 平行移動成分を返す
  getPosition() {
    return [ this.mat[12], this.mat[13], this.mat[14] ];
  }

  // 3x3 部分の列長から軸ごとの scale を返す
  // webg は列ベクトル流儀なので、各列ベクトルの長さが local 軸の伸縮量になる
  getAxisScale() {
    const m = this.mat;
    return [
      Math.hypot(m[0], m[1], m[2]),
      Math.hypot(m[4], m[5], m[6]),
      Math.hypot(m[8], m[9], m[10])
    ];
  }

  // 3 軸がほぼ同じときだけ uniform scale として返す
  // non-uniform scale は CoordinateSystem の現段階では対象外なので null を返す
  getUniformScale(epsilon = 1.0e-4) {
    const [sx, sy, sz] = this.getAxisScale();
    if (sx <= epsilon || sy <= epsilon || sz <= epsilon) {
      return null;
    }
    const maxDelta = Math.max(Math.abs(sx - sy), Math.abs(sy - sz), Math.abs(sz - sx));
    if (maxDelta > epsilon) {
      return null;
    }
    return (sx + sy + sz) / 3.0;
  }

  // 3x3 部分へ uniform scale を掛ける
  // 列ごとに同じ倍率を掛けることで、回転基底を保ったまま local 全体を拡大縮小する
  applyUniformScale(scale) {
    const m = this.mat;
    m[0] *= scale; m[1] *= scale; m[2] *= scale;
    m[4] *= scale; m[5] *= scale; m[6] *= scale;
    m[8] *= scale; m[9] *= scale; m[10] *= scale;
    return this;
  }

  // uniform scale を除いた回転+平行移動行列を返す
  // Quaternion や Euler へ戻す前に 3x3 部分だけを正規化して使う
  removeUniformScale(scale) {
    const rigid = this.clone();
    if (Math.abs(scale) <= 1.0e-8) {
      console.assert(false, "Matrix.removeUniformScale() requires non-zero scale");
      return rigid;
    }
    rigid.mat[0] /= scale; rigid.mat[1] /= scale; rigid.mat[2] /= scale;
    rigid.mat[4] /= scale; rigid.mat[5] /= scale; rigid.mat[6] /= scale;
    rigid.mat[8] /= scale; rigid.mat[9] /= scale; rigid.mat[10] /= scale;
    return rigid;
  }

  // 行列加算する
  add(mb) {
    for (let i=0; i<16; i++) {
      this.mat[i] = this.mat[i] + mb.mat[i];
    }
    return this;
  }

  // 乗算（内部形式）を行う
  mul_(mb) {
    let a = this.mat;
    let a0 =a[ 0]; let a1 =a[ 1]; let a2 =a[ 2]; let a3 =a[ 3];
    let a4 =a[ 4]; let a5 =a[ 5]; let a6 =a[ 6]; let a7 =a[ 7];
    let a8 =a[ 8]; let a9 =a[ 9]; let a10=a[10]; let a11=a[11];
    let a12=a[12]; let a13=a[13]; let a14=a[14]; let a15=a[15];
    let b0 = mb.mat[ 0]; let b1 = mb.mat[ 1];
    let b2 = mb.mat[ 2]; let b3 = mb.mat[ 3];
    let b4 = mb.mat[ 4]; let b5 = mb.mat[ 5];
    let b6 = mb.mat[ 6]; let b7 = mb.mat[ 7];
    let b8 = mb.mat[ 8]; let b9 = mb.mat[ 9];
    let b10= mb.mat[10]; let b11= mb.mat[11];
    let b12= mb.mat[12]; let b13= mb.mat[13];
    let b14= mb.mat[14]; let b15= mb.mat[15];

    a[ 0] = a0 * b0 + a4 * b1 +  a8 * b2 + a12 * b3;
    a[ 1] = a1 * b0 + a5 * b1 +  a9 * b2 + a13 * b3;
    a[ 2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
    a[ 3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
    a[ 4] = a0 * b4 + a4 * b5 +  a8 * b6 + a12 * b7;
    a[ 5] = a1 * b4 + a5 * b5 +  a9 * b6 + a13 * b7;
    a[ 6] = a2 * b4 + a6 * b5 + a10 * b6 + a14 * b7;
    a[ 7] = a3 * b4 + a7 * b5 + a11 * b6 + a15 * b7;
    a[ 8] = a0 * b8 + a4 * b9 +  a8 * b10+ a12 * b11;
    a[ 9] = a1 * b8 + a5 * b9 +  a9 * b10+ a13 * b11;
    a[10] = a2 * b8 + a6 * b9 + a10 * b10+ a14 * b11;
    a[11] = a3 * b8 + a7 * b9 + a11 * b10+ a15 * b11;
    a[12] = a0 * b12+ a4 * b13+  a8 * b14+ a12 * b15;
    a[13] = a1 * b12+ a5 * b13+  a9 * b14+ a13 * b15;
    a[14] = a2 * b12+ a6 * b13+ a10 * b14+ a14 * b15;
    a[15] = a3 * b12+ a7 * b13+ a11 * b14+ a15 * b15;
    return this;
  }

  // 右から行列乗算する
  mul(mb) {
    // this = this * mb (剛体変換向け高速版)
    let a = this.mat;
    let a0 =a[ 0]; let a1 =a[ 1]; let a2 =a[ 2];
    let a4 =a[ 4]; let a5 =a[ 5]; let a6 =a[ 6];
    let a8 =a[ 8]; let a9 =a[ 9]; let a10=a[10];
    let a12=a[12]; let a13=a[13]; let a14=a[14];
    let b0 = mb.mat[ 0]; let b1 = mb.mat[ 1];
    let b2 = mb.mat[ 2];
    let b4 = mb.mat[ 4]; let b5 = mb.mat[ 5];
    let b6 = mb.mat[ 6];
    let b8 = mb.mat[ 8]; let b9 = mb.mat[ 9];
    let b10= mb.mat[10];
    let b12= mb.mat[12]; let b13= mb.mat[13];
    let b14= mb.mat[14];

    a[ 0] = a0 * b0 + a4 * b1 +  a8 * b2;
    a[ 1] = a1 * b0 + a5 * b1 +  a9 * b2;
    a[ 2] = a2 * b0 + a6 * b1 + a10 * b2;
    a[ 3] = 0.0;
    a[ 4] = a0 * b4 + a4 * b5 +  a8 * b6;
    a[ 5] = a1 * b4 + a5 * b5 +  a9 * b6;
    a[ 6] = a2 * b4 + a6 * b5 + a10 * b6;
    a[ 7] = 0.0;
    a[ 8] = a0 * b8 + a4 * b9 +  a8 * b10;
    a[ 9] = a1 * b8 + a5 * b9 +  a9 * b10;
    a[10] = a2 * b8 + a6 * b9 + a10 * b10;
    a[11] = 0.0;
    a[12] = a0 * b12+ a4 * b13+  a8 * b14+ a12;
    a[13] = a1 * b12+ a5 * b13+  a9 * b14+ a13;
    a[14] = a2 * b12+ a6 * b13+ a10 * b14+ a14;
    a[15] = 1.0;
    return this;
  }

  // 左から行列乗算する
  lmul(mb) {
    // this = mb * this (左側から合成)
    let a = this.mat;
    let a0 =a[ 0]; let a1 =a[ 1]; let a2 =a[ 2];
    let a4 =a[ 4]; let a5 =a[ 5]; let a6 =a[ 6];
    let a8 =a[ 8]; let a9 =a[ 9]; let a10=a[10];
    let a12=a[12]; let a13=a[13]; let a14=a[14];
    let b0 =mb.mat[ 0]; let b1 =mb.mat[ 1]; let b2 =mb.mat[ 2];
    let b4 =mb.mat[ 4]; let b5 =mb.mat[ 5]; let b6 =mb.mat[ 6];
    let b8 =mb.mat[ 8]; let b9 =mb.mat[ 9]; let b10=mb.mat[10];
    let b12=mb.mat[12]; let b13=mb.mat[13]; let b14=mb.mat[14];

    a[ 0] = b0 * a0 + b4 * a1 +  b8 * a2;
    a[ 1] = b1 * a0 + b5 * a1 +  b9 * a2;
    a[ 2] = b2 * a0 + b6 * a1 + b10 * a2;
    a[ 4] = b0 * a4 + b4 * a5 +  b8 * a6;
    a[ 5] = b1 * a4 + b5 * a5 +  b9 * a6;
    a[ 6] = b2 * a4 + b6 * a5 + b10 * a6;
    a[ 8] = b0 * a8 + b4 * a9 +  b8 * a10;
    a[ 9] = b1 * a8 + b5 * a9 +  b9 * a10;
    a[10] = b2 * a8 + b6 * a9 + b10 * a10;
    a[12] = b0 * a12+ b4 * a13+  b8 * a14+ b12;
    a[13] = b1 * a12+ b5 * a13+  b9 * a14+ b13;
    a[14] = b2 * a12+ b6 * a13+ b10 * a14+ b14;
    return this;
  }

  // 透視射影行列を作る
  makeProjectionMatrix(near, far, vfov, ratio) {
    let h = 1.0 / Math.tan(vfov * 0.5 * Math.PI / 180);
    let w = h / ratio;
    let q = 1.0 / (near - far);

    this.makeUnit();
    this.mat[0] = w;
    this.mat[5] = h;
    this.mat[10]= far * q;
    this.mat[11]= -1.0;
    this.mat[14]= far * near * q;
    this.mat[15]= 0.0;
  }

  // 幅高指定の射影行列を作る
  makeProjectionMatrixWH(near, far, width, height) {
    let q = 1.0 / (near - far);
    this.makeUnit();
    this.mat[0] = 2 * near / width;
    this.mat[5] = 2 * near / height;
    this.mat[10]= far * q;
    this.mat[11]= -1.0;
    this.mat[14]= far * near * q;
    this.mat[15]= 0.0;
  }

  // 正射影行列を作る
  makeProjectionMatrixOrtho(near, far, width, height) {
    let q = 1.0 / (near - far);
    this.makeUnit();
    this.mat[0] = 2.0 / (width*2);
    this.mat[5] = 2.0 / (height*2);
    this.mat[10]= 1.0 * q;
    this.mat[14]= near * q;
  }

  // 逆行列を計算する（簡易）
  inverse() {
    let m = this.mat;
    let work = new Matrix();
    work.copyFrom(this);
    let w = work.mat;
    let w12 = m[12];
    let w13 = m[13];
    let w14 = m[14];
    //  transposed matrix
    m[0]=w[0]; m[4]=w[1]; m[8]=w[2];
    m[1]=w[4]; m[5]=w[5]; m[9]=w[6];
    m[2]=w[8]; m[6]=w[9]; m[10]=w[10];
    //  copy
    m[7] = w[7];
    m[3] = w[3];
    m[11] = w[11];
    //  translation
    m[12] = -(m[0]*w12 + m[4]*w13 + m[8]*w14);
    m[13] = -(m[1]*w12 + m[5]*w13 + m[9]*w14);
    m[14] = -(m[2]*w12 + m[6]*w13 + m[10]*w14);
    m[15] =  w[15];
  }

  // 逆行列を厳密計算する
  inverse_strict() {
    let m = this.mat
    let a11=m[ 0]; let a12=m[ 4]; let a13=m[ 8]; let a14=m[12];
    let a21=m[ 1]; let a22=m[ 5]; let a23=m[ 9]; let a24=m[13];
    let a31=m[ 2]; let a32=m[ 6]; let a33=m[10]; let a34=m[14];
    let a41=m[ 3]; let a42=m[ 7]; let a43=m[11]; let a44=m[15];
    let detA;
    detA = a11*a22*a33*a44 + a11*a23*a34*a42 + a11*a24*a32*a43
         - a11*a24*a33*a42 - a11*a23*a32*a44 - a11*a22*a34*a43
         - a12*a21*a33*a44 - a13*a21*a34*a42 - a14*a21*a32*a43
         + a14*a21*a33*a42 + a13*a21*a32*a44 + a12*a21*a34*a43
         + a12*a23*a31*a44 + a13*a24*a31*a42 + a14*a22*a31*a43
         - a14*a23*a31*a42 - a13*a22*a31*a44 - a12*a24*a31*a43
         - a12*a23*a34*a41 - a13*a24*a32*a41 - a14*a22*a33*a41
         + a14*a23*a32*a41 + a13*a22*a34*a41 + a12*a24*a33*a41;
    if (Math.abs(detA) <= 1.0e-12) {
      console.assert(false, "Singular matrix");
      return false;
    }

    m[ 0] = (  a22*a33*a44 + a23*a34*a42 + a24*a32*a43
             - a24*a33*a42 - a23*a32*a44 - a22*a34*a43) / detA;
    m[ 4] = (- a12*a33*a44 - a13*a34*a42 - a14*a32*a43
             + a14*a33*a42 + a13*a32*a44 + a12*a34*a43) / detA;
    m[ 8] = (  a12*a23*a44 + a13*a24*a42 + a14*a22*a43
             - a14*a23*a42 - a13*a22*a44 - a12*a24*a43) / detA;
    m[12] = (- a12*a23*a34 - a13*a24*a32 - a14*a22*a33
             + a14*a23*a32 + a13*a22*a34 + a12*a24*a33) / detA;

    m[ 1] = (- a21*a33*a44 - a23*a34*a41 - a24*a31*a43
             + a24*a33*a41 + a23*a31*a44 + a21*a34*a43) / detA;
    m[ 5] = (  a11*a33*a44 + a13*a34*a41 + a14*a31*a43
             - a14*a33*a41 - a13*a31*a44 - a11*a34*a43) / detA;
    m[ 9] = (- a11*a23*a44 - a13*a24*a41 - a14*a21*a43
             + a14*a23*a41 + a13*a21*a44 + a11*a24*a43) / detA;
    m[13] = (  a11*a23*a34 + a13*a24*a31 + a14*a21*a33
             - a14*a23*a31 - a13*a21*a34 - a11*a24*a33) / detA;

    m[ 2] = (  a21*a32*a44 + a22*a34*a41 + a24*a31*a42
             - a24*a32*a41 - a22*a31*a44 - a21*a34*a42) / detA;
    m[ 6] = (- a11*a32*a44 - a12*a34*a41 - a14*a31*a42
             + a14*a32*a41 + a12*a31*a44 + a11*a34*a42) / detA;
    m[10] = (  a11*a22*a44 + a12*a24*a41 + a14*a21*a42
             - a14*a22*a41 - a12*a21*a44 - a11*a24*a42) / detA;
    m[14] = (- a11*a22*a34 - a12*a24*a31 - a14*a21*a32
             + a14*a22*a31 + a12*a21*a34 + a11*a24*a32) / detA;

    m[ 3] = (- a21*a32*a43 - a22*a33*a41 - a23*a31*a42
             + a23*a32*a41 + a22*a31*a43 + a21*a33*a42) / detA;
    m[ 7] = (  a11*a32*a43 + a12*a33*a41 + a13*a31*a42
             - a13*a32*a41 - a12*a31*a43 - a11*a33*a42) / detA;
    m[11] = (- a11*a22*a43 - a12*a23*a41 - a13*a21*a42
             + a13*a22*a41 + a12*a21*a43 + a11*a23*a42) / detA;
    m[15] = (  a11*a22*a33 + a12*a23*a31 + a13*a21*a32
           - a13*a22*a31 - a12*a21*a33 - a11*a23*a32) / detA;
    return true;
  }

  // 転置行列にする
  transpose() {
    let m = this.mat;
    let work = new Matrix();
    work.copyFrom(this);
    let w = work.mat;
    m[0]=w[0];  m[4]=w[1];  m[8]=w[2];   m[12]=w[3];
    m[1]=w[4];  m[5]=w[5];  m[9]=w[6];   m[13]=w[7];
    m[2]=w[8];  m[6]=w[9];  m[10]=w[10]; m[14]=w[11];
    m[3]=w[12]; m[7]=w[13]; m[11]=w[14]; m[15]=w[15];
  }

  // ビュー行列を作る
  makeView(w) {
    this.copyFrom(w);
    this.inverse();
  }

  // 転置3x3でベクトル変換する
  tmul3x3Vector(v) {
    let m = this.mat;
    let x = m[0]*v[0]+m[1]*v[1]+m[2]*v[2];
    let y = m[4]*v[0]+m[5]*v[1]+m[6]*v[2];
    let z = m[8]*v[0]+m[9]*v[1]+m[10]*v[2];
    return [x, y, z];
  }

  // 3x3部分でベクトル変換する
  mul3x3Vector(v) {
    let m = this.mat;
    let x = m[0]*v[0]+m[4]*v[1]+m[8]*v[2];
    let y = m[1]*v[0]+m[5]*v[1]+m[9]*v[2];
    let z = m[2]*v[0]+m[6]*v[1]+m[10]*v[2];
    return [x, y, z];
  }

  // 4x4でベクトル変換する
  mulVector(v) {
    let m = this.mat;
    let x = m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12];
    let y = m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13];
    let z = m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14];
    let w = m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15];
    if (Math.abs(w) <= 1.0e-12) {
      return [x, y, z];
    }
    return [ x/w, y/w, z/w ];
  }

  // 行列を簡易出力する
  print(f) {
    let out = "";
    out = this.sprint(out, f);
    util.printf(out);
  }

  // 行列文字列を構築する
  sprint(out, f) {
    let fmt;
    let m = this.mat;
    let fmte = "% 16.11e % 16.11e % 16.11e % 16.11e\n";
    let fmtf = "% 16.14f % 16.14f % 16.14f % 16.14f\n";
    if (f === "e") fmt = fmte; else fmt = fmtf;
    out += util.sprintf(fmt, m[0], m[4], m[8],  m[12]);
    out += util.sprintf(fmt, m[1], m[5], m[9],  m[13]);
    out += util.sprintf(fmt, m[2], m[6], m[10], m[14]);
    out += util.sprintf(fmt, m[3], m[7], m[11], m[15]);
    return out;
  }

  // 詳細形式で出力する
  print_verbose(f) {
    this.print(f);
    let m = this.mat;
    let sx = Math.sqrt( m[0]*m[0] + m[4]*m[4] + m[8]*m[8] );
    let sy = Math.sqrt( m[1]*m[1] + m[5]*m[5] + m[9]*m[9] );
    let sz = Math.sqrt( m[2]*m[2] + m[6]*m[6] + m[10]*m[10] );
    let fmt = "sx:% 8.11e   sy:% 8.11e   sz:%8.11e\n";
    util.printf(fmt, sx, sy, sz);
    let hpb = this.matToEuler();
    fmt = "h: % 8.11e   p: % 8.11e   b: : % 8.11e\n"
    util.printf(fmt, hpb[0], hpb[1], hpb[2]);
  }

}  // class Matrix
