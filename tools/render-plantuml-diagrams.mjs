import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "book", "img", "puml");
const OUT_DIR = path.join(ROOT, "book", "img", "svg");

function parseArgs(argv) {
  const filters = [];
  for (const arg of argv) {
    if (arg === "--publish") {
      continue;
    }
    filters.push(arg);
  }
  return { filters };
}

async function listPumlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPumlFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".puml")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function matchFilters(filePath, filters) {
  if (filters.length === 0) {
    return true;
  }

  const relative = path.relative(SRC_DIR, filePath);
  const baseName = path.basename(filePath, ".puml");
  return filters.some((filter) => (
    filter === relative ||
    filter === filePath ||
    filter === baseName ||
    filter === `${baseName}.puml`
  ));
}

async function ensureDirectories(outDir) {
  await fs.mkdir(SRC_DIR, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });
}

async function renderFile(filePath, outDir) {
  const relative = path.relative(ROOT, filePath);
  await execFileAsync("plantuml", ["-tsvg", "-output", outDir, filePath], {
    cwd: ROOT
  });
  return relative;
}

async function main() {
  const { filters } = parseArgs(process.argv.slice(2));

  await ensureDirectories(OUT_DIR);
  const allFiles = await listPumlFiles(SRC_DIR);
  const files = allFiles.filter((filePath) => matchFilters(filePath, filters));
  if (files.length === 0) {
    console.log(`No matching .puml files found in ${SRC_DIR}`);
    return;
  }

  const rendered = [];
  for (const filePath of files) {
    rendered.push(await renderFile(filePath, OUT_DIR));
  }

  console.log(`Rendered ${rendered.length} PlantUML file(s) into ${OUT_DIR}`);
  for (const item of rendered) {
    console.log(`- ${item}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
