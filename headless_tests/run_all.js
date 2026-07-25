// Runs every headless suite in an isolated Node.js process.
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = dirname(fileURLToPath(import.meta.url));

const findFiles = (directory, matches) => {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...findFiles(path, matches));
    } else if (entry.isFile() && matches(entry.name)) {
      found.push(path);
    }
  }
  return found;
};

const suites = findFiles(rootDir, (name) => name === "headless_probe.js").sort();
const contractCases = findFiles(rootDir, (name) => name.endsWith("_contracts.js"));
let failed = 0;

for (const suite of suites) {
  const suiteName = relative(rootDir, dirname(suite)).replaceAll("\\", "/");
  const result = spawnSync(
    process.execPath,
    ["--experimental-default-type=module", suite],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    console.log(`PASS ${suiteName}`);
    continue;
  }

  failed += 1;
  console.error(`FAIL ${suiteName}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

const summary = `${suites.length - failed}/${suites.length} suites passed, ${contractCases.length} cases executed`;
if (failed === 0) {
  console.log(`HEADLESS PASS: ${summary}`);
} else {
  console.error(`HEADLESS FAIL: ${summary}; ${failed} suites failed`);
  process.exitCode = 1;
}
