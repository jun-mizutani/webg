// ---------------------------------------------
// samples/build_readme_html.js  2026/07/25
//   Build HTML documents from sample README files
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import fs from "node:fs";
import path from "node:path";

// この script の目的:
// - samples/*/README.md を samples/*/index.html へ変換する
// - samples/*/README.en.md を samples/*/index.en.html へ変換する
// - GitHub Pages 上で sample ごとの説明文を HTML として直接開ける構成を保つ
// - sample 名を引数で指定した場合は、その sample だけを再生成して目的外の差分を避ける

const ROOT = path.resolve("samples");
const README_FILES = [
  { source: "README.md", output: "index.html", lang: "ja" },
  { source: "README.en.md", output: "index.en.html", lang: "en" }
];

// コマンドラインから渡された sample 名を読み取り、指定がなければ従来通り全 sample を対象にする
// 例:
//   node samples/build_readme_html.js
//   node samples/build_readme_html.js dof
//   node samples/build_readme_html.js dof compute_effect
const readRequestedSampleNames = () => process.argv
  .slice(2)
  .filter((name) => name.trim() !== "");

// HTML へ埋め込む最小限の装飾を 1 か所で管理し、生成物ごとの揺れを避ける
// docs 側は app 側の見た目を再現する必要はないため、読みやすさ優先の紙面レイアウトに寄せる
const buildDocumentCss = () => `
:root {
  color-scheme: light;
  --bg: #eef3f8;
  --paper: rgba(255, 255, 255, 0.94);
  --line: #c8d5e4;
  --ink: #17324a;
  --muted: #5c748b;
  --accent: #1566ab;
  --accent-soft: #dfeefe;
  --code-bg: #f3f7fb;
  --shadow: rgba(29, 52, 79, 0.10);
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  min-height: 100%;
}
body {
  background:
    radial-gradient(circle at top left, rgba(21, 102, 171, 0.12), transparent 24%),
    radial-gradient(circle at top right, rgba(255, 191, 118, 0.10), transparent 22%),
    linear-gradient(180deg, #f8fbfd 0%, var(--bg) 100%);
  color: var(--ink);
  font: 16px/1.78 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif;
}
.page {
  width: min(1080px, calc(100% - 28px));
  margin: 0 auto;
  padding: 24px 0 56px;
}
.hero,
.doc {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 22px;
  box-shadow: 0 22px 52px var(--shadow);
}
.hero {
  padding: 22px 24px;
  margin-bottom: 18px;
}
.hero h1 {
  margin: 0 0 8px;
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.08;
}
.hero p {
  margin: 0;
  color: var(--muted);
}
.doc {
  padding: 28px;
}
.doc > :first-child {
  margin-top: 0;
}
h1, h2, h3, h4, h5, h6 {
  line-height: 1.25;
  margin: 1.45em 0 0.55em;
}
h1 {
  font-size: 2.2rem;
}
h2 {
  padding-bottom: 0.28em;
  border-bottom: 1px solid var(--line);
  font-size: 1.48rem;
}
h3 {
  font-size: 1.14rem;
}
p, ul, ol, table, pre, blockquote {
  margin: 0 0 1em;
}
ul, ol {
  padding-left: 1.4em;
}
li + li {
  margin-top: 0.26em;
}
a {
  color: var(--accent);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
img {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 16px;
  border: 1px solid var(--line);
  box-shadow: 0 12px 32px rgba(29, 52, 79, 0.08);
  margin: 1.1em 0 1.4em;
}
code {
  padding: 0.12em 0.38em;
  border-radius: 0.45em;
  background: var(--code-bg);
  border: 1px solid #dbe6f1;
  font: 0.92em/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
pre {
  padding: 14px 16px;
  overflow-x: auto;
  border-radius: 14px;
  background: #0f1720;
  color: #ecf5ff;
}
pre code {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: #ffffff;
}
th, td {
  padding: 10px 12px;
  border: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
th {
  background: #f5f9fc;
}
hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 1.5em 0;
}
blockquote {
  padding: 0.3em 0 0.3em 1em;
  border-left: 4px solid #c9dbef;
  color: var(--muted);
}
@media (max-width: 720px) {
  .page {
    width: min(100% - 18px, 1080px);
    padding-top: 16px;
  }
  .hero,
  .doc {
    border-radius: 18px;
  }
  .doc {
    padding: 20px;
  }
}
`;

// HTML 特殊文字をそのまま埋め込まないよう、テキスト部分だけを明示的に escape する
// inline 要素の組み立て中にも何度も使うため、小さな関数として分離しておく
const escapeHtml = (text) => String(text)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;");

// README.md / README.en.md へのリンクは生成後の HTML 名へ自動変換する
// sample 実行ページや外部 URL のように、そのまま使うべき URL は変更しない
const rewriteHref = (href) => {
  if (href === "README.md" || href === "./README.md") return href.replace("README.md", "index.html");
  if (href === "README.en.md" || href === "./README.en.md") return href.replace("README.en.md", "index.en.html");
  if (href.endsWith("/README.md")) return `${href.slice(0, -9)}/index.html`;
  if (href.endsWith("/README.en.md")) return `${href.slice(0, -12)}/index.en.html`;
  return href;
};

// 太字、inline code、画像、リンクを README の記述から HTML へ変換する
// README の本文はほぼこの範囲で表現されているため、ここを安定させれば大半の見出し・表・箇条書きが読める
const renderInline = (source) => {
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)|\[(.*?)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;
  let html = "";
  let lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    html += escapeHtml(source.slice(lastIndex, index));
    if (match[1] !== undefined) {
      html += `<img src="${escapeHtml(rewriteHref(match[2]))}" alt="${escapeHtml(match[1])}" />`;
    } else if (match[3] !== undefined) {
      html += `<a href="${escapeHtml(rewriteHref(match[4]))}">${escapeHtml(match[3])}</a>`;
    } else if (match[5] !== undefined) {
      html += `<code>${escapeHtml(match[5])}</code>`;
    } else if (match[6] !== undefined) {
      html += `<strong>${escapeHtml(match[6])}</strong>`;
    }
    lastIndex = index + match[0].length;
  }
  html += escapeHtml(source.slice(lastIndex));
  return html;
};

// fenced code blockはREADMEの実行例やAPI例を崩さず見せるため、block単位でHTMLへ変換する
// info stringはclass指定だけに使い、内容本体はescapeしてそのまま表示する
const renderCodeBlock = (lines, startIndex) => {
  const firstLine = lines[startIndex].trim();
  const info = firstLine.slice(3).trim();
  const body = [];
  let index = startIndex + 1;
  while (index < lines.length && !lines[index].trim().startsWith("```")) {
    body.push(lines[index]);
    index += 1;
  }
  if (index < lines.length) {
    index += 1;
  }
  return {
    html: `<pre><code${info ? ` class="language-${escapeHtml(info)}"` : ""}>${escapeHtml(body.join("\n"))}</code></pre>`,
    nextIndex: index
  };
};

const isTableSeparatorLine = (line) => /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/.test(line);

const splitTableCells = (line) => line
  .trim()
  .replace(/^\|/, "")
  .replace(/\|$/, "")
  .split("|")
  .map((cell) => cell.trim());

// 連続した markdown table を thead / tbody を持つ table へ変換する
// mmodeler README のように表が多い sample でも読みやすい HTML を保つため、最低限の表構文を扱う
const renderTable = (lines, startIndex) => {
  const headerCells = splitTableCells(lines[startIndex]);
  const bodyRows = [];
  let index = startIndex + 2;
  while (index < lines.length && lines[index].trim().startsWith("|")) {
    bodyRows.push(splitTableCells(lines[index]));
    index += 1;
  }
  const headerHtml = headerCells.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
  const bodyHtml = bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("");
  return {
    html: `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`,
    nextIndex: index
  };
};

// 箇条書き / 番号付きリストを indentation に応じた入れ子構造として組み立てる
// mmodeler README には 2 段以上の list があるため、単純に 1 段へ潰すのではなく nest を維持する
const renderList = (lines, startIndex) => {
  const tokenPattern = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
  const stack = [];
  let html = "";
  let index = startIndex;

  // `closeUntil`は必要な画面要素を準備し、表示状態を更新する
  const closeUntil = (indent) => {
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      html += `</li></${stack.pop().tag}>`;
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    const match = tokenPattern.exec(line);
    if (!match) break;
    const indent = match[1].length;
    const tag = match[2].endsWith(".") ? "ol" : "ul";
    const content = match[3];

    if (stack.length === 0) {
      stack.push({ indent, tag });
      html += `<${tag}><li>${renderInline(content)}`;
      index += 1;
      continue;
    }

    const current = stack[stack.length - 1];
    if (indent > current.indent) {
      stack.push({ indent, tag });
      html += `<${tag}><li>${renderInline(content)}`;
      index += 1;
      continue;
    }

    if (indent === current.indent && tag === current.tag) {
      html += `</li><li>${renderInline(content)}`;
      index += 1;
      continue;
    }

    closeUntil(indent);
    if (stack.length === 0 || stack[stack.length - 1].indent < indent || stack[stack.length - 1].tag !== tag) {
      stack.push({ indent, tag });
      html += `<${tag}><li>${renderInline(content)}`;
    } else {
      html += `</li><li>${renderInline(content)}`;
    }
    index += 1;
  }

  closeUntil(-1);
  return { html, nextIndex: index };
};

// 見出し、段落、表、リストの順に block を判定し、README 全体を本文 HTML へ変換する
// GitHub Flavored Markdown 全体を実装するのではなく、この repository の README 群で実際に使っている表現に絞る
const renderMarkdown = (source) => {
  const lines = source.replace(/\r/g, "").split("\n");
  let index = 0;
  const blocks = [];

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === "") {
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push("<hr />");
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const block = renderCodeBlock(lines, index);
      blocks.push(block.html);
      index = block.nextIndex;
      continue;
    }

    if (trimmed.startsWith("|") && index + 1 < lines.length && isTableSeparatorLine(lines[index + 1])) {
      const table = renderTable(lines, index);
      blocks.push(table.html);
      index = table.nextIndex;
      continue;
    }

    if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
      const list = renderList(lines, index);
      blocks.push(list.html);
      index = list.nextIndex;
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const current = lines[index];
      const currentTrimmed = current.trim();
      if (
        currentTrimmed === "" ||
        /^(#{1,6})\s+/.test(currentTrimmed) ||
        /^---+$/.test(currentTrimmed) ||
        (/^(\s*)([-*]|\d+\.)\s+/.test(current)) ||
        (currentTrimmed.startsWith("|") && index + 1 < lines.length && isTableSeparatorLine(lines[index + 1]))
      ) {
        break;
      }
      paragraphLines.push(currentTrimmed);
      index += 1;
    }
    const paragraphHtml = paragraphLines
      .map((paragraphLine) => renderInline(paragraphLine))
      .join("<br />");
    blocks.push(`<p>${paragraphHtml}</p>`);
  }

  // 各 block を独立した行へ置き、生成後の HTML でも本文構造を追いやすくする
  return blocks.join("\n");
};

// README の先頭見出しから document title を決め、見出しがない場合はフォルダ名をそのまま使う
// title は browser tab と hero の両方に使うため、README 本文から一度だけ抽出して共有する
const extractTitle = (source, fallback) => {
  const line = source.replace(/\r/g, "").split("\n").find((entry) => entry.startsWith("# "));
  return line ? line.slice(2).trim() : fallback;
};

// 共通レイアウトを使って HTML 全体を組み立て、生成先ごとに lang と title だけを変える
// hero は title のみを表示し、その下に README 本文を変換した HTML をそのまま置く
const buildDocumentHtml = ({ title, lang, sampleName, bodyHtml }) => `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="data:," />
  <!-- 2026/06/19 -->
  <style>
${buildDocumentCss()}
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <h1>${escapeHtml(title)}</h1>
    </section>
    <article class="doc">
${bodyHtml}
    </article>
  </main>
</body>
</html>
`;

// README から index.html / index.en.html を作る処理本体
// sampleDir は検証済みの directory だけを受け取り、README がない言語は生成対象から外す
const buildSampleReadmeHtml = (sampleName) => {
  const sampleDir = path.join(ROOT, sampleName);
  for (const target of README_FILES) {
    const sourcePath = path.join(sampleDir, target.source);
    if (!fs.existsSync(sourcePath)) continue;
    const markdown = fs.readFileSync(sourcePath, "utf8");
    const title = extractTitle(markdown, sampleName);
    const bodyHtml = renderMarkdown(markdown);
    const documentHtml = buildDocumentHtml({
      title,
      lang: target.lang,
      sampleName,
      bodyHtml
    });
    fs.writeFileSync(path.join(sampleDir, target.output), documentHtml);
  }
};

// 指定された sample 名が samples/ 直下の folder として存在するか確認する
// 誤字を黙って無視すると「生成されたはずなのに古いまま」という状態になるため、ここでは明示的に失敗させる
const validateSampleName = (sampleName) => {
  if (sampleName.includes("/") || sampleName.includes("\\")) {
    throw new Error(`sample name must not contain path separators: ${sampleName}`);
  }
  const sampleDir = path.join(ROOT, sampleName);
  if (!fs.existsSync(sampleDir) || !fs.statSync(sampleDir).isDirectory()) {
    throw new Error(`sample directory not found: ${sampleName}`);
  }
};

// samples/* を走査し、README があるフォルダだけを対象に HTML を出力する
// README 側を source of truth とし、index.html / index.en.html は毎回再生成できる派生物として扱う
// 引数で sample 名が渡された場合は、その sample だけを再生成して目的外の index 差分を避ける
const buildReadmeHtml = () => {
  const requestedSampleNames = readRequestedSampleNames();
  const sampleNames = requestedSampleNames.length > 0
    ? requestedSampleNames
    : fs.readdirSync(ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

  for (const sampleName of sampleNames) {
    validateSampleName(sampleName);
    buildSampleReadmeHtml(sampleName);
  }
};

try {
  buildReadmeHtml();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
