// ---------------------------------------------
//  SceneYaml.js    2026/09/19
//   Small YAML reader for WebgSceneApp scene manifests
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// SceneYAML/ModelYAMLは、利用者が記述するwebg document向けの限定的なYAML方言です。
// YAML全体を実装せず、コメント、インデント、map、sequence、基本scalar、flow配列/mapを扱います。

function parserError(line, message) {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  return new Error(`SceneYAML parse error${suffix}: ${message}`);
}

// インデントと引用符の判定に使う空白文字だけを識別します
function isWhitespace(value) {
  return value === " " || value === "\t";
}

// 引用符内の#を保持しながら、YAML行末のコメント部分だけを取り除きます
function findCommentIndex(text) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (char === "'" && text[index + 1] === "'") {
        index += 1;
      } else if (char === "'") {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#" && (index === 0 || isWhitespace(text[index - 1]))) {
      return index;
    }
  }
  return -1;
}

// 引用符内の#を保持しながら、YAML行末のコメント部分だけを取り除きます
function stripComment(text) {
  const index = findCommentIndex(text);
  return (index < 0 ? text : text.slice(0, index)).trimEnd();
}

// 入力文字列を行番号、インデント、コメント除去済み本文へ分解します
// タブや文書区切りをこの段階で処理し、後段parserの入力条件をそろえます
function readLines(text) {
  if (typeof text !== "string") {
    throw parserError(undefined, "source must be a string");
  }
  const lines = [];
  const sourceLines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < sourceLines.length; index += 1) {
    const source = sourceLines[index];
    if (source.includes("\t")) {
      throw parserError(index + 1, "tabs are not supported for indentation");
    }
    const content = stripComment(source);
    if (!content.trim()) continue;
    const indent = content.length - content.trimStart().length;
    const value = content.slice(indent).trim();
    if (value === "---" || value === "...") continue;
    lines.push({ line: index + 1, indent, value });
  }
  return lines;
}

// single quoteまたはdouble quoteで囲まれたscalarをデコードします
function unquote(value, line) {
  if (value.length < 2) throw parserError(line, "quoted value is incomplete");
  if (value[0] === "'") {
    if (value[value.length - 1] !== "'") throw parserError(line, "single-quoted value is incomplete");
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value[value.length - 1] !== '"') throw parserError(line, "double-quoted value is incomplete");
  try {
    return JSON.parse(value);
  } catch (error) {
    throw parserError(line, `invalid double-quoted value (${error?.message ?? error})`);
  }
}

// 引用符とflow配列・mapの深さを考慮して、最上位のkey:value境界を探します
function splitKeyValue(text, line, { flow = false } = {}) {
  let quote = null;
  let escaped = false;
  let squareDepth = 0;
  let curlyDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && text[index + 1] === "'") index += 1;
      else if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[") squareDepth += 1;
    else if (char === "]") squareDepth -= 1;
    else if (char === "{") curlyDepth += 1;
    else if (char === "}") curlyDepth -= 1;
    else if (char === ":" && squareDepth === 0 && curlyDepth === 0
      && (flow || index + 1 === text.length || isWhitespace(text[index + 1]))) {
      const rawKey = text.slice(0, index).trim();
      if (!rawKey) throw parserError(line, "mapping key is empty");
      return { key: rawKey, rawValue: text.slice(index + 1).trim() };
    }
  }
  return null;
}

// mapping keyの引用形式を解釈し、参照に使う文字列へ変換します
function readKey(rawKey, line) {
  if (rawKey[0] === '"' || rawKey[0] === "'") return unquote(rawKey, line);
  return rawKey;
}

// null、boolean、number、quoted string、通常文字列の順にscalarを確定します
function readScalarToken(value, line) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed[0] === '"' || trimmed[0] === "'") {
    return unquote(trimmed, line);
  }
  if (trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  return trimmed;
}

class FlowParser {
  constructor(text, line) {
    this.text = text;
    this.line = line;
    this.index = 0;
  }

  // flow値の読み取り位置を空白の次へ進めます
  skipSpaces() {
    while (isWhitespace(this.text[this.index])) this.index += 1;
  }

  // flow値の現在行を付けてparser errorを生成します
  fail(message) {
    throw parserError(this.line, message);
  }

  // flow配列またはflow mapを最後まで読み、余分な文字を検出します
  parse() {
    const value = this.parseValue();
    this.skipSpaces();
    if (this.index !== this.text.length) this.fail("unexpected characters after flow value");
    return value;
  }

  // 現在位置の開始文字からscalar、配列、mapの解析分岐を選びます
  parseValue() {
    this.skipSpaces();
    const char = this.text[this.index];
    if (char === "[") return this.parseArray();
    if (char === "{") return this.parseObject();
    if (char === '"' || char === "'") return this.parseQuoted();
    const start = this.index;
    while (this.index < this.text.length && !",]}".includes(this.text[this.index])) this.index += 1;
    if (start === this.index) this.fail("flow value is empty");
    return readScalarToken(this.text.slice(start, this.index).trim(), this.line);
  }

  // flow内のquoted scalarを読み、quote終了位置までを一つの値にします
  parseQuoted() {
    const quote = this.text[this.index];
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if (quote === '"' && escaped) {
        escaped = false;
      } else if (quote === '"' && char === "\\") {
        escaped = true;
      } else if (quote === "'" && char === "'" && this.text[this.index + 1] === "'") {
        this.index += 1;
      } else if (char === quote) {
        this.index += 1;
        return unquote(this.text.slice(start, this.index), this.line);
      }
      this.index += 1;
    }
    this.fail("quoted flow value is incomplete");
  }

  // flow配列の各要素を再帰的に読み、カンマと閉じ括弧を検証します
  parseArray() {
    this.index += 1;
    const result = [];
    this.skipSpaces();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      result.push(this.parseValue());
      this.skipSpaces();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ",") this.fail("flow array expects a comma or closing bracket");
      this.index += 1;
      this.skipSpaces();
    }
    this.fail("flow array is incomplete");
  }

  // flow mapのkey:valueを再帰的に読み、重複keyを検出します
  parseObject() {
    this.index += 1;
    const result = {};
    this.skipSpaces();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      this.skipSpaces();
      const keyStart = this.index;
      let key;
      if (this.text[this.index] === '"' || this.text[this.index] === "'") {
        key = this.parseQuoted();
      } else {
        while (this.index < this.text.length && this.text[this.index] !== ":") this.index += 1;
        key = this.text.slice(keyStart, this.index).trim();
      }
      if (this.text[this.index] !== ":") this.fail("flow object expects a colon");
      if (!key) this.fail("flow object key is empty");
      if (Object.prototype.hasOwnProperty.call(result, key)) this.fail(`duplicate key: ${key}`);
      this.index += 1;
      result[key] = this.parseValue();
      this.skipSpaces();
      if (this.text[this.index] === "}") {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ",") this.fail("flow object expects a comma or closing brace");
      this.index += 1;
    }
    this.fail("flow object is incomplete");
  }
}

// 行内値をflow parserまたはscalar parserへ振り分けます
function readValue(value, line) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed[0] === "[" || trimmed[0] === "{") {
    return new FlowParser(trimmed, line).parse();
  }
  return readScalarToken(trimmed, line);
}

class SceneYamlParser {
  constructor(text) {
    this.lines = readLines(text);
    this.index = 0;
  }

  // block parserの現在行に構文エラー位置を付加して通知します
  fail(line, message) {
    throw parserError(line, message);
  }

  // rootからblockを読み、全行が一つのSceneYAML値に含まれることを確認します
  parse() {
    if (this.lines.length === 0) return null;
    if (this.lines[0].indent !== 0) this.fail(this.lines[0].line, "root indentation must be zero");
    const [value, nextIndex] = this.parseBlock(this.index, this.lines[0].indent);
    this.index = nextIndex;
    if (this.index < this.lines.length) {
      this.fail(this.lines[this.index].line, "unexpected indentation or sequence item");
    }
    return value;
  }

  // インデントされたblockの先頭からmappingまたはsequenceを選びます
  parseBlock(index, indent) {
    const line = this.lines[index];
    if (!line || line.indent !== indent) this.fail(line?.line, "invalid indentation");
    if (line.value === "-" || line.value.startsWith("- ")) {
      return this.parseSequence(index, indent);
    }
    if (line.value.startsWith("-")) this.fail(line.line, "sequence marker must be followed by a space");
    return this.parseMapping(index, indent);
  }

  // 同じインデントに並ぶkey:valueを読み、子blockを再帰的に接続します
  parseMapping(index, indent) {
    const result = {};
    let cursor = index;
    while (cursor < this.lines.length) {
      const line = this.lines[cursor];
      if (line.indent < indent) break;
      if (line.indent > indent) this.fail(line.line, "mapping indentation skips a level");
      if (line.value === "-" || line.value.startsWith("- ")) break;
      const pair = splitKeyValue(line.value, line.line);
      if (!pair) this.fail(line.line, "mapping entry requires `key: value`");
      const key = readKey(pair.key, line.line);
      if (Object.prototype.hasOwnProperty.call(result, key)) this.fail(line.line, `duplicate key: ${key}`);
      let value;
      cursor += 1;
      if (pair.rawValue) {
        value = readValue(pair.rawValue, line.line);
      } else if (cursor < this.lines.length && this.lines[cursor].indent > indent) {
        [value, cursor] = this.parseBlock(cursor, this.lines[cursor].indent);
      } else {
        value = {};
      }
      result[key] = value;
    }
    return [result, cursor];
  }

  // 同じインデントに並ぶsequence itemを読み、mapping itemの子要素も統合します
  parseSequence(index, indent) {
    const result = [];
    let cursor = index;
    while (cursor < this.lines.length) {
      const line = this.lines[cursor];
      if (line.indent < indent) break;
      if (line.indent > indent) this.fail(line.line, "sequence indentation skips a level");
      if (!(line.value === "-" || line.value.startsWith("- "))) break;
      const rest = line.value === "-" ? "" : line.value.slice(2).trim();
      cursor += 1;
      if (!rest) {
        if (cursor < this.lines.length && this.lines[cursor].indent > indent) {
          let value;
          [value, cursor] = this.parseBlock(cursor, this.lines[cursor].indent);
          result.push(value);
        } else {
          result.push(null);
        }
        continue;
      }

      const pair = splitKeyValue(rest, line.line);
      if (!pair) {
        result.push(readValue(rest, line.line));
        if (cursor < this.lines.length && this.lines[cursor].indent > indent) {
          this.fail(this.lines[cursor].line, "a scalar sequence item cannot have nested content");
        }
        continue;
      }

      const item = {};
      const firstKey = readKey(pair.key, line.line);
      let value;
      if (pair.rawValue) {
        value = readValue(pair.rawValue, line.line);
      } else if (cursor < this.lines.length && this.lines[cursor].indent > indent) {
        [value, cursor] = this.parseBlock(cursor, this.lines[cursor].indent);
      } else {
        value = {};
      }
      item[firstKey] = value;

      if (cursor < this.lines.length && this.lines[cursor].indent > indent) {
        const childIndent = this.lines[cursor].indent;
        const [additional, nextCursor] = this.parseMapping(cursor, childIndent);
        for (const [key, childValue] of Object.entries(additional)) {
          if (Object.prototype.hasOwnProperty.call(item, key)) this.fail(line.line, `duplicate key: ${key}`);
          item[key] = childValue;
        }
        cursor = nextCursor;
      }
      result.push(item);
    }
    return [result, cursor];
  }
}

// YAML原文からコメントの位置と本文を抽出します
// 値のparse結果とは別に保持し、Assetへ渡す途中でコメントを失わないようにします
function readCommentRecords(text) {
  if (typeof text !== "string") {
    throw parserError(undefined, "source must be a string");
  }
  const comments = [];
  const sourceLines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < sourceLines.length; index += 1) {
    const source = sourceLines[index];
    const commentIndex = findCommentIndex(source);
    if (commentIndex < 0) continue;
    const body = source.slice(commentIndex + 1).trim();
    if (!body) continue;
    comments.push(Object.freeze({
      line: index + 1,
      inline: source.slice(0, commentIndex).trim().length > 0,
      text: body
    }));
  }
  return Object.freeze(comments);
}

// YAML scalarを独自parserが再現できるJSON quoted形式へ変換します
function stringifyScalar(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new TypeError("SceneYAML values must contain only JSON-compatible finite data");
}

// 配列を一行で表せる値か確認します
function isScalarValue(value) {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

// 小さなscalar配列をflow形式へ変換し、頂点や姿勢を読みやすく一行へ収めます
function stringifyFlowArray(value) {
  return `[${value.map(item => stringifyScalar(item)).join(", ")}]`;
}

// mappingを指定インデントへ追加します
function appendMapping(value, indent, lines) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("SceneYAML mapping value must be an object");
  }
  const padding = " ".repeat(indent);
  for (const [key, child] of Object.entries(value)) {
    const prefix = `${padding}${JSON.stringify(key)}:`;
    if (isScalarValue(child)) {
      lines.push(`${prefix} ${stringifyScalar(child)}`);
    } else if (Array.isArray(child) && child.every(isScalarValue)) {
      lines.push(`${prefix} ${stringifyFlowArray(child)}`);
    } else if (child && typeof child === "object" && !Array.isArray(child)
      && Object.keys(child).length === 0) {
      lines.push(`${prefix} {}`);
    } else if (Array.isArray(child) && child.length === 0) {
      lines.push(`${prefix} []`);
    } else {
      lines.push(prefix);
      appendNested(child, indent + 2, lines);
    }
  }
}

// mappingの子にあるarrayまたはobjectをblock形式へ追加します
function appendNested(value, indent, lines) {
  const padding = " ".repeat(indent);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isScalarValue(item)) {
        lines.push(`${padding}- ${stringifyScalar(item)}`);
      } else if (Array.isArray(item) && item.every(isScalarValue)) {
        lines.push(`${padding}- ${stringifyFlowArray(item)}`);
      } else if (item && typeof item === "object" && !Array.isArray(item)) {
        if (Object.keys(item).length === 0) {
          lines.push(`${padding}- {}`);
        } else {
          lines.push(`${padding}-`);
          appendMapping(item, indent + 2, lines);
        }
      } else {
        throw new TypeError("SceneYAML array values must contain only JSON-compatible data");
      }
    }
    return;
  }
  appendMapping(value, indent, lines);
}

// JSON互換のJavaScript値を限定SceneYAMLへ変換します
// コメントは値から生成できないため、原文を保持するSceneAsset/ModelAssetが必要な場合は
// 各AssetのtoYAMLText()が保持中のsource textを優先して返します
export function stringifySceneYAML(value) {
  if (isScalarValue(value)) return `${stringifyScalar(value)}\n`;
  const lines = [];
  if (Array.isArray(value)) {
    appendNested(value, 0, lines);
  } else {
    appendMapping(value, 0, lines);
  }
  return `${lines.join("\n")}\n`;
}

// YAML textを値・原文・コメントの組へ変換します
// valueだけを呼出側へ渡すparseSceneYAMLと違い、編集・保存経路でsourceを維持できます
export function parseSceneYAMLDocument(text) {
  return Object.freeze({
    value: new SceneYamlParser(text).parse(),
    sourceText: text,
    comments: readCommentRecords(text)
  });
}

// SceneYAML文字列を読み、project manifestとして利用できるJavaScript値を返します
export function parseSceneYAML(text) {
  return parseSceneYAMLDocument(text).value;
}

export default parseSceneYAML;
