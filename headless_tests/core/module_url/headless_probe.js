// Headless suite runner. Executes each contract case in an isolated Node.js process.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const suiteDir = dirname(fileURLToPath(import.meta.url));
const suiteName = suiteDir.split(/[\\/]/).slice(-3).join("/");
const cases = readdirSync(suiteDir)
  .filter((name) => name.endsWith("_contracts.js"))
  .sort();

let failed = 0;
for (const contractCase of cases) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-default-type=module", join(suiteDir, contractCase)],
    { encoding: "utf8" }
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    failed += 1;
    console.error(`FAIL ${suiteName}/${contractCase}`);
  }
}

if (failed > 0) {
  console.error(`FAIL ${suiteName}: ${failed}/${cases.length} cases failed`);
  process.exitCode = 1;
} else {
  console.log(`PASS ${suiteName}: ${cases.length} cases passed`);
}
