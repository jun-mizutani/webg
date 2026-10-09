// ---------------------------------------------
// convert_imports.mjs  2026/10/05
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFile, writeFile, readdir, mkdir, stat, copyFile, lstat } from "node:fs/promises";
import { parse as parseJavaScript } from "acorn";
import { parse as parseHTML } from "parse5";

const directory = path.dirname(fileURLToPath(import.meta.url));
// 配置がlibなら公開用の参照先を使い、user/bundleなら開発用の参照先を使う
const publicLayout = path.basename(directory) === "lib";
const root = path.resolve(directory, publicLayout ? ".." : "../..");
const artifacts = publicLayout ? directory : path.join(directory, "dist");

// オプションと対象パスを読み、候補表示と書き出しの指定を分ける
function readOptions(args) {
  const options = { execute: false, bundle: path.join(artifacts, "webg.core.min.js"), targets: [] };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--execute") options.execute = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--bundle" || argument === "--out") {
      if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${argument} の値を指定してください`);
      options[argument === "--bundle" ? "bundle" : "out"] = path.resolve(args[++index]);
    } else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("-")) throw new Error(`オプションを確認してください: ${argument}`);
    else options.targets.push(path.resolve(argument));
  }
  if (options.execute && options.dryRun) throw new Error("--execute と --dry-run は一方を選んでください");
  return options;
}

// リポジトリ内の対象を判定し、複製先のパスに使える相対パスを返す
function relativeInside(filename) {
  const relative = path.relative(root, filename);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`リポジトリ内のファイルまたはサブフォルダを指定してください: ${filename}`);
  }
  return relative;
}

// パスの包含関係を確認し、元ソースと複製先の重複を防ぐ
function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// モジュールの相対参照を解決し、外部URLはブラウザ側の参照として保持する
function resolveReference(value, filename) {
  if (!value.startsWith("./") && !value.startsWith("../") && !value.startsWith("/")) return null;
  const pathname = value.split(/[?#]/)[0];
  return value.startsWith("/") ? path.join(root, pathname.slice(1)) : path.resolve(path.dirname(filename), pathname);
}

// 出力ファイルから統合版までの相対URLを、OSに依存する区切り文字から変換する
function bundleReference(filename, bundle) {
  const relative = path.relative(path.dirname(filename), bundle).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

// 構文木を順に訪問し、関数内の動的importも見つける
function visit(node, callback) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, callback));
    else if (value && typeof value === "object") visit(value, callback);
  }
}

// export名とimport名を、識別子または文字列として読み取る
function readName(node) { return node.name ?? node.value; }

// 識別子として使える名前はそのまま、それ以外は文字列のexport名として出力する
function printName(value) { return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value); }

// 元モジュールのexportから統合版の一意なexportへ対応付け、未登録の名前を報告する
function mappedName(item, name) {
  const mapped = name === "default" ? item.defaultName : item.namedExports?.[name];
  if (!mapped) throw new Error(`${item.path} のexport ${name} を対応表へ登録してください`);
  return mapped;
}

// 後ろの変更箇所から置換し、先に読んだ構文位置とコメントの対応を保持する
function applyEdits(source, edits) {
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }
  return source;
}

// JSのimportと再exportを統合版へ変換し、サンプル側のローカル依存を収集する
export function convertJavaScript(source, filename, destination, context) {
  const comments = [];
  const ast = parseJavaScript(source, { ecmaVersion: "latest", sourceType: "module", onComment: comments });
  const edits = [], dependencies = [], issues = [];
  const bundle = JSON.stringify(bundleReference(destination, context.bundle));
  visit(ast, node => {
    if (!["ImportDeclaration", "ImportExpression", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)) return;
    if (!node.source) return;
    let value = node.source.value;
    if (node.source.type === "TemplateLiteral" && node.source.expressions.length === 0) {
      value = node.source.quasis[0].value.cooked;
    }
    if (typeof value !== "string") {
      issues.push(`動的importの参照先を確認してください: ${source.slice(node.start, node.end)}`);
      return;
    }
    const resolved = resolveReference(value, filename);
    if (!resolved) {
      if (/webg\//.test(value) || value === "webg") issues.push(`URLまたはimport mapのコア参照を確認してください: ${value}`);
      return;
    }
    const item = context.inventory.get(resolved);
    if (!item) {
      if (contains(path.join(root, "webg"), resolved) && resolved.endsWith(".js")) {
        issues.push(`コアモジュールを対応表へ登録してください: ${value}`);
      } else if (resolved.endsWith(".js") || resolved.endsWith(".mjs")) {
        dependencies.push(resolved);
        if (value.startsWith("/") && filename !== destination) {
          issues.push(`複製先で使用するルート相対のJS参照を確認してください: ${value}`);
        }
      }
      return;
    }
    try {
      if (/[?#]/.test(value)) throw new Error(`クエリまたはfragment付きのコア参照を確認してください: ${value}`);
      if (node.options || node.attributes?.length) throw new Error("import属性の用途を確認してください");
      let text;
      if (node.type === "ImportExpression") {
        text = `import(${bundle}).then(bundleModule => bundleModule.${item.moduleName})`;
      } else if (node.type === "ImportDeclaration") {
        const specifiers = node.specifiers.map(specifier => {
          const name = specifier.type === "ImportNamespaceSpecifier" ? item.moduleName :
            mappedName(item, specifier.type === "ImportDefaultSpecifier" ? "default" : readName(specifier.imported));
          return name === specifier.local.name ? name : `${name} as ${specifier.local.name}`;
        });
        text = specifiers.length ? `import { ${specifiers.join(", ")} } from ${bundle};` : `import ${bundle};`;
      } else if (node.type === "ExportAllDeclaration") {
        const specifiers = node.exported ? [`${item.moduleName} as ${printName(readName(node.exported))}`] :
          Object.entries(item.namedExports).map(([name, mapped]) => `${mapped} as ${printName(name)}`);
        text = `export { ${specifiers.join(", ")} } from ${bundle};`;
      } else {
        const specifiers = node.specifiers.map(specifier =>
          `${mappedName(item, readName(specifier.local))} as ${printName(readName(specifier.exported))}`);
        text = `export { ${specifiers.join(", ")} } from ${bundle};`;
      }
      // import内部の説明コメントを置換行の直前へ移し、読み手への補足を保持する
      const notes = comments.filter(comment => comment.start >= node.start && comment.end <= node.end)
        .map(comment => source.slice(comment.start, comment.end));
      if (notes.length) text = notes.join("\n") + "\n" + text;
      edits.push({ start: node.start, end: node.end, text, before: source.slice(node.start, node.end) });
    } catch (error) { issues.push(error.message); }
  });
  return { code: applyEdits(source, edits), edits, dependencies, issues };
}

// HTMLの位置情報を使い、module scriptだけを変換して他のマークアップを保持する
function convertHTML(source, filename, destination, context) {
  const document = parseHTML(source, { sourceCodeLocationInfo: true });
  const edits = [], dependencies = [], issues = [];
  // parse5のHTMLノードは親を参照するため、子とtemplate内容だけをたどる
  function walkHTML(node) {
    const attributes = Object.fromEntries((node.attrs ?? []).map(item => [item.name, item.value]));
    if (node.tagName === "base") issues.push("base要素の参照先を確認してください");
    if (node.tagName === "script" && attributes.type === "module") {
      const location = node.sourceCodeLocation;
      if (attributes.src) {
        const src = attributes.src;
        const resolved = /^[A-Za-z][\w+.-]*:|^\/\//.test(src) ? null :
          resolveReference(src.startsWith(".") || src.startsWith("/") ? src : `./${src}`, filename);
        const item = context.inventory.get(resolved);
        if (item && /[?#]/.test(src)) {
          issues.push(`クエリまたはfragment付きのコア参照を確認してください: ${src}`);
        } else if (item) {
          const attribute = location.attrs.src;
          edits.push({ start: attribute.startOffset, end: attribute.endOffset,
            text: `src=${JSON.stringify(bundleReference(destination, context.bundle))}`, before: attributes.src });
        } else if (resolved) {
          if (contains(path.join(root, "webg"), resolved) && resolved.endsWith(".js")) {
            issues.push(`コアモジュールを対応表へ登録してください: ${src}`);
          } else {
            dependencies.push(resolved);
            if (src.startsWith("/") && filename !== destination) issues.push(`複製先で使用するルート相対のJS参照を確認してください: ${src}`);
          }
        }
      } else if (location?.startTag && location.endTag) {
        const start = location.startTag.endOffset, end = location.endTag.startOffset;
        const result = convertJavaScript(source.slice(start, end), filename, destination, context);
        for (const edit of result.edits) edits.push({ ...edit, start: edit.start + start, end: edit.end + start });
        dependencies.push(...result.dependencies);
        issues.push(...result.issues);
      }
    }
    for (const child of node.childNodes ?? []) walkHTML(child);
    if (node.content) walkHTML(node.content);
  }
  walkHTML(document);
  return { code: applyEdits(source, edits), edits, dependencies, issues };
}

// 指定フォルダ内の通常ファイルを集め、Git内部と導入済みパッケージを保持する
async function collectFiles(filename, files) {
  const info = await lstat(filename);
  if (info.isSymbolicLink()) throw new Error(`シンボリックリンクの実体を確認してください: ${filename}`);
  if (info.isDirectory()) {
    for (const item of await readdir(filename)) {
      if ([".git", "node_modules"].includes(item)) continue;
      await collectFiles(path.join(filename, item), files);
    }
  } else if (info.isFile()) files.add(filename);
}

// 変更したコードの先頭8行だけを確認し、既存ヘッダーの編集日を当日に揃える
function updateHeader(source) {
  const lines = source.split("\n");
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date()).replaceAll("-", "/");
  for (let index = 0; index < Math.min(8, lines.length); index++) {
    if (/^\s*(\/\/|\/\*|\*)/.test(lines[index])) {
      lines[index] = lines[index].replace(/\d{4}[/-]\d{2}[/-]\d{2}/, date);
    }
  }
  return lines.join("\n");
}

// 変換候補と依存ファイルをすべて確認したあと、指定された方式で一括書き出しする
export async function main(args = process.argv.slice(2)) {
  const options = readOptions(args);
  if (options.help) {
    const script = publicLayout ? "lib/convert_imports.mjs" : "user/bundle/convert_imports.mjs";
    console.log(`使用方法（webgのルートから）:
  node ${script} samples/aquarium
  node ${script} --execute --out user/bundle/converted samples/aquarium samples/water
  node ${script} --execute samples/aquarium

初期動作は候補表示。--executeで書き出し、--out指定時は元の相対配置を保って複製します。
--outは新規または空のフォルダを指定します。省略時は対象コードを直接更新します。
--bundle PATHで統合版を指定できます。標準は${path.relative(root, options.bundle)}です。`);
    return;
  }
  if (!options.targets.length) throw new Error("変換するファイルまたはフォルダを指定してください");
  const report = JSON.parse(await readFile(path.join(artifacts, "build_report.json"), "utf8"));
  if (report.inventory.some(item => !item.namedExports)) throw new Error("npm --prefix user/bundle run build で対応表を生成してください");
  await stat(options.bundle);
  const bundleAst = parseJavaScript(await readFile(options.bundle, "utf8"),
    { ecmaVersion: "latest", sourceType: "module" });
  const bundleExports = new Set(bundleAst.body.filter(node => node.type === "ExportNamedDeclaration")
    .flatMap(node => node.specifiers.map(specifier => readName(specifier.exported))));
  const expectedExports = report.inventory.flatMap(item =>
    [item.moduleName, item.defaultName, ...Object.values(item.namedExports)].filter(Boolean));
  if (expectedExports.some(name => !bundleExports.has(name))) {
    throw new Error("--bundleには現在の対応表から生成した統合版を指定してください");
  }
  const context = { bundle: options.bundle,
    inventory: new Map(report.inventory.map(item => [path.join(root, item.path), item])) };
  for (const target of options.targets) {
    relativeInside(target);
    if (contains(path.join(root, "webg"), target)) throw new Error("対象にはサンプル側のコードを指定してください");
    if (options.out && (contains(target, options.out) || contains(options.out, target))) {
      throw new Error("出力先は元の対象パスと分かれた場所へ指定してください");
    }
  }
  if (options.out && contains(options.out, options.bundle)) throw new Error("統合版を保持できる別の出力先を指定してください");
  if (options.execute && options.out) {
    let existing;
    try { existing = await readdir(options.out); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing?.length) throw new Error("--outには新規または空のフォルダを指定してください");
  }
  const files = new Set();
  for (const target of options.targets) await collectFiles(target, files);
  const plans = [], issues = [];
  // Setへ追加したローカル依存も順に処理し、共有JSや遅延読み込み先まで変換する
  for (const filename of files) {
    const relative = relativeInside(filename);
    const destination = options.out ? path.join(options.out, relative) : filename;
    const extension = path.extname(filename).toLowerCase();
    if (![".js", ".mjs", ".html", ".htm"].includes(extension)) continue;
    try {
      const source = await readFile(filename, "utf8");
      const result = extension.startsWith(".h") ? convertHTML(source, filename, destination, context) :
        convertJavaScript(source, filename, destination, context);
      for (const dependency of result.dependencies) {
        relativeInside(dependency);
        if (!files.has(dependency)) await collectFiles(dependency, files);
      }
      if (result.edits.length) plans.push({ filename, destination, relative, ...result });
      issues.push(...result.issues.map(issue => `${relative}: ${issue}`));
    } catch (error) { issues.push(`${relative}: ${error.message}`); }
  }
  for (const plan of plans) {
    console.log(`\n${plan.relative} (${plan.edits.length} 箇所)`);
    for (const edit of plan.edits) console.log(`  - ${edit.before}\n  + ${edit.text}`);
  }
  console.log(`\n変換候補 ${plans.length} ファイル / import・export ${plans.reduce((sum, p) => sum + p.edits.length, 0)} 箇所`);
  if (issues.length) throw new Error(`次の箇所を確認してから実行してください:\n${issues.join("\n")}`);
  if (!options.execute) { console.log("候補表示が完了しました。書き出しは --execute で指定します。"); return; }
  if (options.out) {
    for (const filename of files) {
      const destination = path.join(options.out, relativeInside(filename));
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(filename, destination);
    }
  }
  for (const plan of plans) await writeFile(plan.destination, updateHeader(plan.code));
  console.log(options.out ? `複製と変換が完了しました: ${options.out}` : "対象コードの変換が完了しました。");
}

// コマンドとして実行した場合に入口を呼び、確認が必要な箇所を標準エラーへ返す
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
