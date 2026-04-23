// ---------------------------------------------
// util.js        2026/04/23
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

export default util;
