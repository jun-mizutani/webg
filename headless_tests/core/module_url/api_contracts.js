// ---------------------------------------------------------
// headless_tests/core/module_url/api_contracts.js  2026/08/20
//   Local JavaScript module URL identity contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(suiteDirectory, "../../..");
// user/はcache-busting queryを使う開発実験と一時検証を置く領域で、公開module identity契約の対象外です
// 公開・検証対象のsourceだけを走査し、user実験のURL形式を公開APIの失敗として扱いません
const sourceRoots = ["webg", "samples", "book/examples", "unittest", "headless_tests"];
const sourceExtensions = new Set([".js", ".html"]);

// source treeを再帰走査し、実行されるJavaScriptとHTMLだけを検査対象へ集める
// README中の説明用URLや履歴資料は実行時のmodule identityを作らないため対象外とする
function collectSourceFiles(directory, output) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".#") || entry.name.startsWith("#")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(path, output);
    } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      output.push(path);
    }
  }
}

const sourceFiles = [];
for (const relativeRoot of sourceRoots) {
  collectSourceFiles(join(repositoryRoot, relativeRoot), sourceFiles);
}

// `.js`直後のqueryは、static import、dynamic import、export-from、script srcのいずれでも
// 同じsourceを別moduleとして評価させるため、用途やquery名にかかわらず禁止する
const moduleQueryPattern = /\.js[?][^"'\s)>]*/g;
const violations = [];
for (const path of sourceFiles) {
  const source = readFileSync(path, "utf8");
  const matches = source.match(moduleQueryPattern);
  if (matches) {
    violations.push({
      path: path.slice(repositoryRoot.length + 1),
      urls: matches
    });
  }
}

assert.deepEqual(
  violations,
  [],
  `JavaScript module URLs must not contain query strings: ${JSON.stringify(violations)}`
);

console.log("PASS module_url_identity_contracts");
