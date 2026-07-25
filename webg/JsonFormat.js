// ---------------------------------------------
//  JsonFormat.js    2026/03/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

function repeatIndent(level, unit) {
  return unit.repeat(level);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumberArray(value) {
  return Array.isArray(value)
    && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function isJsonOmittable(value) {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

function formatValue(value, level, indentUnit) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    // 行列やベクトルのような数値配列は1行へまとめ、
    // 不必要な改行とインデントでファイルが肥大化しないようにする
    if (isFiniteNumberArray(value)) {
      return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    }
    const nextLevel = level + 1;
    const body = value.map((item) => (
      `${repeatIndent(nextLevel, indentUnit)}${formatValue(isJsonOmittable(item) ? null : item, nextLevel, indentUnit)}`
    ));
    return `[\n${body.join(",\n")}\n${repeatIndent(level, indentUnit)}]`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, item]) => !isJsonOmittable(item));
    if (entries.length === 0) {
      return "{}";
    }
    const nextLevel = level + 1;
    const body = entries.map(([key, item]) => (
      `${repeatIndent(nextLevel, indentUnit)}${JSON.stringify(key)}: ${formatValue(item, nextLevel, indentUnit)}`
    ));
    return `{\n${body.join(",\n")}\n${repeatIndent(level, indentUnit)}}`;
  }

  if (isJsonOmittable(value)) {
    return "null";
  }

  return JSON.stringify(value);
}

export default function formatJSON(value, indent = 2) {
  const indentUnit = typeof indent === "number"
    ? " ".repeat(Math.max(0, indent))
    : String(indent ?? "  ");
  return formatValue(value, 0, indentUnit);
}
