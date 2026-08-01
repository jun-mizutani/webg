// ---------------------------------------------
// util.js        2026/08/01
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Node.js 環境では fs を使って同期ファイルI/Oを提供する
// ブラウザ環境では fs は未使用のままにして readFile/writeFile を無効化する
const isNode = typeof process !== "undefined" && !!process.versions?.node;
let fs = null;
if (isNode) {
  const fsMod = await import("fs");
  fs = fsMod.default ?? fsMod;
}

const util = {};
// utilはprintf/sprintf、時間計測、文字列処理などの共通補助関数群

// 1文字または短い文字列を指定回数だけ複製して返す
// 右寄せ/左寄せの埋め草文字生成で使う
util.strDup = function (char, cnt) {
  if (cnt < 1) return "";
  return Array(cnt).fill(char).join("");
};

// %d 相当の整数フォーマット
// flag:
//   "+" 正数に+を付与
//   " " 正数の先頭に空白を付与
//   "0" 幅不足分を0埋め
//   "-" 左寄せ
// cnt: 最小桁幅
util.format_D = function (num, flag, cnt) {
  if (isNaN(num)) return util.strDup(" ", cnt - 3) + "NaN";
  let digits = 1;
  if (Math.abs(num) > 1.0) {
    digits = Math.floor(Math.log10(Math.abs(num))) + 1;
  }
  let char = " ";
  if (flag === "0") char = "0";
  if (flag === " ") char = " ";
  let sign = "";
  if (num < 0.0) {
    num = Math.floor(-num);
    sign = "-";
    digits++;
  } else if (flag === " ") {
    num = Math.floor(num);
    sign = " ";
    digits++;
  } else {
    num = Math.floor(num);
  }
  if ((flag === "+") && (sign !== "-")) {
    sign = "+";
    digits++;
  }
  if (cnt > digits) {
    if (flag === "-") {
      return sign + num + util.strDup(" ", cnt - digits);
    }
    if (char === "0") {
      return sign + util.strDup(char, cnt - digits) + num;
    }
    return util.strDup(char, cnt - digits) + sign + num;
  }
  return sign + num;
};

// %f 相当の固定小数点フォーマット
// precision 未指定時は 17 桁で toFixed し、符号と幅を調整する
// -0 を負数として扱うため Object.is(n, -0) も判定する
util.format_F = function (num, flag, cnt, precision) {
  if ((precision === "") || (precision === undefined)) precision = 17;
  precision = Number(precision);
  cnt = Number(cnt) || 0;
  if (isNaN(num)) return util.strDup(" ", Math.max(0, cnt - 3)) + "NaN";

  const n = Number(num);
  let sign = "";
  if ((n < 0.0) || Object.is(n, -0)) sign = "-";
  else if (flag === "+") sign = "+";
  else if (flag === " ") sign = " ";

  const body = Math.abs(n).toFixed(precision);
  let result = sign + body;

  if (cnt > result.length) {
    const padLen = cnt - result.length;
    if (flag === "-") {
      result += util.strDup(" ", padLen);
    } else if ((flag === "0") && (sign !== "")) {
      result = sign + util.strDup("0", padLen) + body;
    } else {
      const padChar = (flag === "0") ? "0" : " ";
      result = util.strDup(padChar, padLen) + result;
    }
  }
  return result;
};

// %e / %E 相当の指数表記フォーマット
// JavaScriptの toExponential は指数桁数可変なので、C系の見た目に寄せて
// 指数部を最低3桁(例: e+003 / e-012)に正規化する
util.format_E = function (num, flag, cnt, precision, etype) {
  if ((precision === "") || (precision === undefined)) precision = 17;
  precision = Number(precision);
  cnt = Number(cnt) || 0;
  if (isNaN(num)) return util.strDup(" ", Math.max(0, cnt - 3)) + "NaN";

  const n = Number(num);
  let sign = "";
  if ((n < 0.0) || Object.is(n, -0)) sign = "-";
  else if (flag === "+") sign = "+";
  else if (flag === " ") sign = " ";

  const expStr = Math.abs(n).toExponential(precision);
  const [mant, rawExp] = expStr.split("e");
  const expVal = Number(rawExp);
  const expAbs = Math.abs(expVal);
  const expDigits = String(expAbs);
  const expPad = util.strDup("0", Math.max(0, 3 - expDigits.length)) + expDigits;
  const expOut = (expVal < 0) ? `-${expPad}` : expPad;

  const body = `${mant}${etype}${expOut}`;
  let result = sign + body;

  if (cnt > result.length) {
    const padLen = cnt - result.length;
    if (flag === "-") {
      result += util.strDup(" ", padLen);
    } else if ((flag === "0") && (sign !== "")) {
      result = sign + util.strDup("0", padLen) + body;
    } else {
      const padChar = (flag === "0") ? "0" : " ";
      result = util.strDup(padChar, padLen) + result;
    }
  }
  return result;
};

// %s 相当の文字列フォーマット
// null / undefined を明示文字列へ変換して表示崩れを防ぐ
util.format_S = function (str, flag, cnt) {
  if (str === null) str = "NULL";
  if (str === undefined) str = "UNDEFINED";
  if (cnt > str.length) {
    if (flag === "-") {
      return str + util.strDup(" ", cnt - str.length);
    }
    return util.strDup(" ", cnt - str.length) + str;
  }
  return str;
};

// %x / %X 相当の16進フォーマット
// 負数が入る場合は JavaScript の toString(16) 仕様に従う
util.format_X = function (num, flag, cnt, type) {
  if (isNaN(num)) return util.strDup(" ", cnt - 3) + "NaN";
  let num16 = num.toString(16);
  if (type === "X") num16 = num16.toUpperCase();
  let char = " ";
  if (flag === "0") char = "0";
  if (flag === " ") char = " ";
  if (cnt > num16.length) {
    if (char === "0") {
      return util.strDup(char, cnt - num16.length) + num16;
    }
    if (flag === "-") {
      return num16 + util.strDup(" ", cnt - num16.length);
    }
    return util.strDup(char, cnt - num16.length) + num16;
  }
  return util.strDup(char, cnt - num16.length) + num16;
};

// 軽量 sprintf 実装
// サポート書式:
//   %%                -> %
//   %[flag][width][.precision][type]
//   type: s d c x X e E f
// 未サポート書式はそのまま残すことで、デバッグ時に崩壊しない出力を優先する
util.sprintf = function (fmt, ...arg) {
  let n = 0;
  const regex = /%%|%([+0 -]?)([0-9]*)(?:\.([0-9]*))?([sdcxXeEf])/g;
  return fmt.replace(regex, (match, fmt_flag, fmt_width, fmt_prec, fmt_type) => {
    if (match === "%%") return "%";
    if (arg[n] === undefined) return match;

    const width = (fmt_width === "") ? 0 : Number(fmt_width);
    const prec = (fmt_prec === undefined) ? "" : fmt_prec;
    let valueString = match;

    if (fmt_type === "d") {
      valueString = util.format_D(arg[n], fmt_flag, width);
    } else if (fmt_type === "f") {
      valueString = util.format_F(arg[n], fmt_flag, width, prec);
    } else if ((fmt_type === "e") || (fmt_type === "E")) {
      valueString = util.format_E(arg[n], fmt_flag, width, prec, fmt_type);
    } else if ((fmt_type === "x") || (fmt_type === "X")) {
      valueString = util.format_X(arg[n], fmt_flag, width, fmt_type);
    } else if (fmt_type === "s") {
      valueString = util.format_S(arg[n], fmt_flag, width);
    } else if (fmt_type === "c") {
      const code = Number(arg[n]);
      valueString = String.fromCharCode(code);
    }
    n++;
    return valueString;
  });
};

util.printDevice = "console";
util.printStr = "";

// 出力先を console / string で切り替える簡易printf
// printDevice:
//   "console" -> console.logへ出力
//   "string"  -> printStrへ連結
//   null      -> 出力しない
util.printf = function (fmt, ...arg) {
  if (util.printDevice === null) return;
  let str = util.sprintf(fmt, ...arg);
  if (util.printDevice === "console") {
    if (str.slice(-1) === "\n") str = str.slice(0, -1);
    console.log(str);
  } else if (util.printDevice === "string") {
    util.printStr += str;
  }
};

// 経過時間計測用の薄いラッパ
util.now = function () {
  return Date.now();
};

// 互換維持のため残しているビジーウェイト
// メインスレッドをブロックするため、通常用途では非推奨
util.sleep = function (sec) {
  const t = util.now() + (sec * 1000);
  while (util.now() <= t) {
    /* blocking */
  }
};

// Node.js環境限定の同期テキスト読み込み
// ブラウザ環境では null を返す
util.readFile = function (filename) {
  if (filename && fs) {
    return fs.readFileSync(filename, "utf8");
  }
  return null;
};

// Node.js環境限定の同期書き込み
// 成功時 true、未対応環境では null を返す
util.writeFile = function (filename, data) {
  if (filename && fs) {
    fs.writeFileSync(filename, data);
    return true;
  }
  return null;
};

// 既存コード互換の空行出力ヘルパ
util.print = function () {
  console.log();
};

// 既存互換の同期HTTP読み込み
// 非同期処理へ移行できない古い呼び出しを残すために維持している
util.readUrlSync = function (filename) {
  const request = new XMLHttpRequest();
  request.open("GET", filename, false);
  request.send();
  return request.responseText;
};

// fetch を使った非同期テキスト読み込み
util.readUrl = async function (filename) {
  const response = await fetch(filename);
  if (!response.ok) {
    throw new Error(`Failed to load text: ${filename} (${response.status} ${response.statusText})`);
  }
  return await response.text();
};

// object の own property 判定を共通化する
util.hasOwn = function (value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
};

// candidates 配列の先頭から undefined 以外を探し、値とラベルを返す
util.resolveOptionCandidate = function (candidates = []) {
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i] ?? {};
    if (candidate.value !== undefined) {
      return candidate;
    }
  }
  return null;
};

// 有限数を読み、必要なら整数・範囲も検証する
util.readFiniteNumber = function (value, name, {
  integer = false,
  min = null,
  minExclusive = null,
  max = null,
  maxExclusive = null
} = {}) {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
  const numeric = Number(value);
  if (integer && !Number.isInteger(numeric)) {
    throw new Error(`${name} must be an integer`);
  }
  if (min !== null && numeric < min) {
    throw new Error(`${name} must be >= ${min}`);
  }
  if (minExclusive !== null && numeric <= minExclusive) {
    throw new Error(`${name} must be > ${minExclusive}`);
  }
  if (max !== null && numeric > max) {
    throw new Error(`${name} must be <= ${max}`);
  }
  if (maxExclusive !== null && numeric >= maxExclusive) {
    throw new Error(`${name} must be < ${maxExclusive}`);
  }
  return numeric;
};

// 任意指定の数値 option を読むための入口
// undefined は「利用者が指定しなかった」と解釈して fallback を返すが、
// NaN、Infinity、範囲外などの明示された不正値は呼び出し元のバグとして例外にする
// fallback は自動補正ではなく、未指定時の既定値を一箇所で明示するための値
util.readOptionalFiniteNumber = function (value, name, fallback, constraints = {}) {
  if (value === undefined) {
    return fallback;
  }
  return util.readFiniteNumber(value, name, constraints);
};

// 任意指定の整数 option を読むための入口
// 個数、幅、高さ、index のように小数を許さない設定値を検証し、
// 指定された値が整数でなければ silently round せずに例外で止める
util.readOptionalInteger = function (value, name, fallback, { min = null, max = null } = {}) {
  return util.readOptionalFiniteNumber(value, name, fallback, {
    integer: true,
    min,
    max
  });
};

// 必須の整数値を範囲付きで読むための入口
// optional ではないため undefined も不正値として扱い、範囲外を自動補正しない
util.readIntegerInRange = function (value, name, min, max) {
  return util.readFiniteNumber(value, name, {
    integer: true,
    min,
    max
  });
};

// 任意指定の boolean option を読むための入口
// undefined のときだけ fallback を返し、0/1 や文字列 "true" は boolean へ変換しない
// 設定ファイルや option object の型間違いを早い段階で見つけるための関数
util.readOptionalBoolean = function (value, name, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be boolean`);
  }
  return value;
};

// 任意指定の文字列 option を読むための入口
// trim と allowEmpty により、空白除去後の空文字を許すかどうかを呼び出し側で明示する
// 数値や boolean を文字列へ暗黙変換しないことで、設定名や DOM id の誤指定を隠さない
util.readOptionalString = function (value, name, fallback, { trim = false, allowEmpty = true } = {}) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const text = trim ? value.trim() : value;
  if (!allowEmpty && text.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return text;
};

// 任意指定の callback option を読むための入口
// 関数未指定なら fallback を返し、null を許す API かどうかは allowNull で明示する
// function 以外を no-op 扱いにしないことで、event handler 名や callback 渡し忘れを検出する
util.readOptionalFunction = function (value, name, fallback = null, { allowNull = true } = {}) {
  if (value === undefined) {
    return fallback;
  }
  if (value === null) {
    if (!allowNull) {
      throw new Error(`${name} must be a function`);
    }
    return null;
  }
  if (typeof value !== "function") {
    throw new Error(`${name} must be a function${allowNull ? " or null" : ""}`);
  }
  return value;
};

// 任意指定の plain object option を読むための入口
// undefined のときだけ fallback を返し、配列や null は object 設定として受け入れない
// ネストした option block の型間違いを、後続処理で意味不明な property access になる前に止める
util.readPlainObject = function (value, name, fallback = {}) {
  if (value === undefined) {
    return fallback;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
};

// 任意指定の列挙値 option を読むための入口
// mode、anchor、align のように許可された文字列だけを受け付ける設定で使う
// 未知の文字列を既定値へ丸めずに例外にすることで、綴り間違いや未対応 mode を見逃さない
util.readOptionalEnum = function (value, name, fallback, allowed = [], { trim = true, lowerCase = false } = {}) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  let text = trim ? value.trim() : value;
  if (lowerCase) {
    text = text.toLowerCase();
  }
  if (!allowed.includes(text)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return text;
};

// 画面上の基準位置を表す anchor option を読むための専用入口
// 汎用 enum reader に許可値を集約し、各 UI 部品で anchor 名のゆれが出ないようにする
util.readOptionalAnchor = function (value, fallback, name = "anchor") {
  return util.readOptionalEnum(value, name, fallback, [
    "top-left",
    "top-right",
    "top-center",
    "bottom-left",
    "bottom-right",
    "bottom-center",
    "center"
  ]);
};

// テキストや button group の水平揃え option を読むための専用入口
// left、center、right 以外を受け付けず、誤った align 名を既定値へ隠さない
util.readOptionalAlign = function (value, fallback, name = "align") {
  return util.readOptionalEnum(value, name, fallback, ["left", "center", "right"]);
};

// overlay や panel の配置方式 option を読むための専用入口
// CSS の absolute / fixed に対応する値だけを許可し、未知の配置方式を早期に検出する
util.readOptionalPositioningMode = function (value, name, fallback) {
  return util.readOptionalEnum(value, name, fallback, ["absolute", "fixed"]);
};

// 任意指定の DOM element 参照を読むための入口
// HTMLElement 以外の環境も考慮して object または function を許可し、文字列 selector への暗黙解決は行わない
// null を明示指定できる API では、呼び出し側が「要素なし」を意図したことをそのまま伝える
util.readOptionalElement = function (value, name, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (value !== null && (typeof value !== "object" && typeof value !== "function")) {
    throw new Error(`${name} must be an object or null`);
  }
  return value;
};

util.readVec3 = function (value, name, fallback = undefined) {
  if (value === undefined || value === null) {
    if (fallback !== undefined) {
      return [...fallback];
    }
    throw new Error(`${name} must be a vec3 array`);
  }
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${name} must be a vec3 array`);
  }
  return [
    util.readFiniteNumber(value[0], `${name}[0]`),
    util.readFiniteNumber(value[1], `${name}[1]`),
    util.readFiniteNumber(value[2], `${name}[2]`)
  ];
};

util.readColor = function (value, name, fallback = undefined, length = 4) {
  if (value === undefined || value === null) {
    if (fallback !== undefined) {
      return [...fallback];
    }
    throw new Error(`${name} must be a color array`);
  }
  if (!Array.isArray(value) || value.length < length) {
    throw new Error(`${name} must be a color array`);
  }
  const out = [];
  for (let i = 0; i < length; i++) {
    out.push(util.readFiniteNumber(value[i], `${name}[${i}]`));
  }
  return out;
};

util.readFiniteOption = function (candidates, name, defaultValue, constraints = {}) {
  const resolved = util.resolveOptionCandidate(candidates);
  if (!resolved) {
    return defaultValue;
  }
  return util.readFiniteNumber(resolved.value, `${name} (${resolved.label ?? "value"})`, constraints);
};

util.readVec3Option = function (candidates, name, defaultValue) {
  const resolved = util.resolveOptionCandidate(candidates);
  if (!resolved) {
    return [...defaultValue];
  }
  return util.readVec3(resolved.value, `${name} (${resolved.label ?? "value"})`);
};

util.readKeyOption = function (candidates, name, defaultValue) {
  const resolved = util.resolveOptionCandidate(candidates);
  if (!resolved) {
    return defaultValue;
  }
  return util.readOptionalString(
    resolved.value,
    `${name} (${resolved.label ?? "value"})`,
    defaultValue,
    { trim: true, allowEmpty: false }
  ).toLowerCase();
};

util.readEnumOption = function (candidates, name, defaultValue, allowed = []) {
  const resolved = util.resolveOptionCandidate(candidates);
  if (!resolved) {
    return defaultValue;
  }
  return util.readOptionalEnum(
    resolved.value,
    `${name} (${resolved.label ?? "value"})`,
    defaultValue,
    allowed
  );
};

util.readBooleanOption = function (candidates, name, defaultValue) {
  const resolved = util.resolveOptionCandidate(candidates);
  if (!resolved) {
    return defaultValue;
  }
  return util.readOptionalBoolean(resolved.value, `${name} (${resolved.label ?? "value"})`, defaultValue);
};

/*
 * hashUint32()はChris Wellons氏がHash Function Prospectorで探索した
 * 32bit整数permutation lowbias32をJavaScriptへ移したもの
 *
 * 出典:
 *   Chris Wellons, "Prospecting for Hash Functions"
 *   https://nullprogram.com/blog/2018/07/31/
 *   https://github.com/skeeto/hash-prospector
 *
 * 原記事は、特記がない内容をpublic domainとして公開しており、
 * Hash Prospector repositoryはUnlicenseで公開されている
 */

// hashへ渡す値をunsigned 32bit整数として検証し、負数、小数、範囲外を暗黙変換しない
function readHashUint32(value, label) {
  return util.readFiniteNumber(value, label, {
    integer: true,
    min: 0,
    max: 0xffffffff
  }) >>> 0;
}

// 検証済み32bit整数へlowbias32のmultiply-xorshiftを適用する内部処理
// Math.imul()で乗算の下位32bitを取り、JavaScript Numberの丸めを結果へ持ち込まない
function mixLowbias32(value) {
  let result = value >>> 0;
  result = (result ^ (result >>> 16)) >>> 0;
  result = Math.imul(result, 0x7feb352d) >>> 0;
  result = (result ^ (result >>> 15)) >>> 0;
  result = Math.imul(result, 0x846ca68b) >>> 0;
  return (result ^ (result >>> 16)) >>> 0;
}

// 任意indexや部材IDなど、一つの32bit整数に対応する再現可能な32bit値を返す
// 内部stateを持つ乱数列ではないため、呼び出し順に関係なく同じ入力は同じ出力になる
util.hashUint32 = function (value) {
  return mixLowbias32(readHashUint32(value, "hashUint32 value"));
};

// 複数の32bit整数を順序付きで畳み込み、座標や複合IDに対応する値を返す
// lowbias32自体とは別のwebg用入力結合規則であり、32bitを超える入力空間では衝突し得る
util.hashUint32Sequence = function (values, seed = 0) {
  if (!Array.isArray(values) && !(values instanceof Uint32Array)) {
    throw new Error("hashUint32Sequence values must be an Array or Uint32Array");
  }
  if (values.length === 0) {
    throw new Error("hashUint32Sequence values must not be empty");
  }

  // 長さを初期stateへ含め、末尾へ0を追加した列を同じ入力として扱わない
  let state = mixLowbias32(
    (readHashUint32(seed, "hashUint32Sequence seed") ^ values.length) >>> 0
  );
  for (let index = 0; index < values.length; index += 1) {
    const value = readHashUint32(values[index], `hashUint32Sequence values[${index}]`);
    state = mixLowbias32((state ^ value) >>> 0);
  }
  return state >>> 0;
};

// 32bit値の上位24bitを、JavaScriptとWGSLのf32で共通に表せる[0, 1)へ変換する
// 32bit全体をf32へ変換すると最大値付近が1.0へ丸まるため、下位8bitは意図的に使わない
util.uint32ToUnitFloat = function (value) {
  const word = readHashUint32(value, "uint32ToUnitFloat value");
  return (word >>> 8) / 16777216.0;
};

// MT19937の状態数とtwist位置は、周期2^19937-1の標準パラメーターを使う
// C版のunsigned longをJavaScriptの32bit unsigned演算へ対応させるため、
// 状態はUint32Arrayへ保存し、乗算にはMath.imul()、演算結果には>>> 0を使う
const MT19937_STATE_SIZE = 624;
const MT19937_MIDDLE_WORD = 397;
const MT19937_MATRIX_A = 0x9908b0df;
const MT19937_UPPER_MASK = 0x80000000;
const MT19937_LOWER_MASK = 0x7fffffff;
const MT19937_DEFAULT_SEED = 5489;

/*
 * Mersenne Twister MT19937 implementation adapted from mt19937ar.c
 * https://www.math.sci.hiroshima-u.ac.jp/m-mat/MT/MT2002/mt19937ar.html
 *
 * Copyright (C) 1997 - 2002, Makoto Matsumoto and Takuji Nishimura,
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. The names of the contributors may not be used to endorse or promote
 *    products derived from this software without specific prior written
 *    permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// MT19937へ渡す値をunsigned 32bit整数として検証し、負数や小数を暗黙変換しない
function readMt19937Uint32(value, label) {
  return util.readFiniteNumber(value, label, {
    integer: true,
    min: 0,
    max: 0xffffffff
  }) >>> 0;
}

// mt19937ar.cのinit_genrand()、init_by_array()、genrand_*()に対応する生成器
// 暗号用途には使用せず、seedから再現可能なsimulationやprocedural生成に使用する
class MersenneTwister {
  constructor(seed = MT19937_DEFAULT_SEED) {
    this.state = new Uint32Array(MT19937_STATE_SIZE);
    this.index = MT19937_STATE_SIZE;
    if (Array.isArray(seed) || seed instanceof Uint32Array) {
      this.initByArray(seed);
    } else {
      this.initGenrand(seed);
    }
  }

  // 2002年版init_genrand()と同じ係数で、単一の32bit seedから624語を初期化する
  initGenrand(seed) {
    this.state[0] = readMt19937Uint32(seed, "MersenneTwister seed");
    for (let index = 1; index < MT19937_STATE_SIZE; index += 1) {
      const previous = this.state[index - 1];
      const mixed = previous ^ (previous >>> 30);
      this.state[index] = (Math.imul(1812433253, mixed) + index) >>> 0;
    }
    this.index = MT19937_STATE_SIZE;
    return this;
  }

  // 2002年版init_by_array()に従い、空でない32bit seed配列を全状態へ反映する
  initByArray(seedArray) {
    if (!Array.isArray(seedArray) && !(seedArray instanceof Uint32Array)) {
      throw new Error("MersenneTwister seed array must be an Array or Uint32Array");
    }
    if (seedArray.length === 0) {
      throw new Error("MersenneTwister seed array must not be empty");
    }
    const keys = new Uint32Array(seedArray.length);
    for (let index = 0; index < seedArray.length; index += 1) {
      keys[index] = readMt19937Uint32(
        seedArray[index],
        `MersenneTwister seed array[${index}]`
      );
    }

    this.initGenrand(19650218);
    let stateIndex = 1;
    let keyIndex = 0;
    let remaining = Math.max(MT19937_STATE_SIZE, keys.length);
    while (remaining > 0) {
      const previous = this.state[stateIndex - 1];
      const mixed = previous ^ (previous >>> 30);
      this.state[stateIndex] = (
        (this.state[stateIndex] ^ Math.imul(mixed, 1664525))
        + keys[keyIndex]
        + keyIndex
      ) >>> 0;
      stateIndex += 1;
      keyIndex += 1;
      if (stateIndex >= MT19937_STATE_SIZE) {
        this.state[0] = this.state[MT19937_STATE_SIZE - 1];
        stateIndex = 1;
      }
      if (keyIndex >= keys.length) {
        keyIndex = 0;
      }
      remaining -= 1;
    }

    remaining = MT19937_STATE_SIZE - 1;
    while (remaining > 0) {
      const previous = this.state[stateIndex - 1];
      const mixed = previous ^ (previous >>> 30);
      this.state[stateIndex] = (
        (this.state[stateIndex] ^ Math.imul(mixed, 1566083941))
        - stateIndex
      ) >>> 0;
      stateIndex += 1;
      if (stateIndex >= MT19937_STATE_SIZE) {
        this.state[0] = this.state[MT19937_STATE_SIZE - 1];
        stateIndex = 1;
      }
      remaining -= 1;
    }
    // 全要素が0の初期状態を避けるため、C版と同じく最上位bitを固定する
    this.state[0] = MT19937_UPPER_MASK;
    this.index = MT19937_STATE_SIZE;
    return this;
  }

  // 624語を一括twistし、次の624個の出力に使う内部状態へ更新する
  twist() {
    let word = 0;
    let index = 0;
    for (; index < MT19937_STATE_SIZE - MT19937_MIDDLE_WORD; index += 1) {
      word = (
        (this.state[index] & MT19937_UPPER_MASK)
        | (this.state[index + 1] & MT19937_LOWER_MASK)
      ) >>> 0;
      this.state[index] = (
        this.state[index + MT19937_MIDDLE_WORD]
        ^ (word >>> 1)
        ^ ((word & 1) === 0 ? 0 : MT19937_MATRIX_A)
      ) >>> 0;
    }
    for (; index < MT19937_STATE_SIZE - 1; index += 1) {
      word = (
        (this.state[index] & MT19937_UPPER_MASK)
        | (this.state[index + 1] & MT19937_LOWER_MASK)
      ) >>> 0;
      this.state[index] = (
        this.state[index + MT19937_MIDDLE_WORD - MT19937_STATE_SIZE]
        ^ (word >>> 1)
        ^ ((word & 1) === 0 ? 0 : MT19937_MATRIX_A)
      ) >>> 0;
    }
    word = (
      (this.state[MT19937_STATE_SIZE - 1] & MT19937_UPPER_MASK)
      | (this.state[0] & MT19937_LOWER_MASK)
    ) >>> 0;
    this.state[MT19937_STATE_SIZE - 1] = (
      this.state[MT19937_MIDDLE_WORD - 1]
      ^ (word >>> 1)
      ^ ((word & 1) === 0 ? 0 : MT19937_MATRIX_A)
    ) >>> 0;
    this.index = 0;
  }

  // temperingを適用したunsigned 32bit整数を返すgenrand_int32()対応API
  genrandInt32() {
    if (this.index >= MT19937_STATE_SIZE) {
      this.twist();
    }
    let value = this.state[this.index];
    this.index += 1;
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    value ^= value >>> 18;
    return value >>> 0;
  }

  // JavaScript側で意図が読みやすいuint32名から標準整数生成を呼ぶ
  nextUint32() {
    return this.genrandInt32();
  }

  // 最上位31bitを符号なし整数として返すgenrand_int31()対応API
  genrandInt31() {
    return this.genrandInt32() >>> 1;
  }

  // 両端を含む[0, 1]の32bit精度実数を返すgenrand_real1()対応API
  genrandReal1() {
    return this.genrandInt32() * (1.0 / 4294967295.0);
  }

  // 上端を含まない[0, 1)の32bit精度実数を返すgenrand_real2()対応API
  genrandReal2() {
    return this.genrandInt32() * (1.0 / 4294967296.0);
  }

  // 両端を含まない(0, 1)の32bit精度実数を返すgenrand_real3()対応API
  genrandReal3() {
    return (this.genrandInt32() + 0.5) * (1.0 / 4294967296.0);
  }

  // 32bit出力を2回使い、上端を含まない[0, 1)の53bit精度実数を返す
  genrandRes53() {
    const high = this.genrandInt32() >>> 5;
    const low = this.genrandInt32() >>> 6;
    return (high * 67108864.0 + low) * (1.0 / 9007199254740992.0);
  }

  // JavaScript標準random APIと同じ[0, 1)規約で、既存のrandom function引数へ渡しやすくする
  random() {
    return this.genrandReal2();
  }
}

util.MersenneTwister = MersenneTwister;

export default util;
