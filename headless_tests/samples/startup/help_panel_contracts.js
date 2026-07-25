// ---------------------------------------------------------
// headless_tests/samples/startup/help_panel_contracts.js  2026/07/21
//   Sample Help Panel initial-collapse contract
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(testDir, "../../../samples");

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

const helpSources = collectJavaScriptFiles(samplesDir)
  .map((path) => ({ path, source: readFileSync(path, "utf8") }))
  .filter(({ source }) => source.includes("buildHelpPanelOptions({"));

assert.ok(helpSources.length > 0, "sample Help Panel implementations must be found");
for (const { path, source } of helpSources) {
  const calls = source.match(/buildHelpPanelOptions\(\{[\s\S]*?\}\)/g) ?? [];
  assert.ok(calls.length > 0, `${path} must contain a Help Panel options call`);
  for (const call of calls) {
    assert.match(call, /\bcollapsed:\s*true\b/, `${path} Help Panel must start collapsed`);
  }
}

console.log(`sample_help_panel_contracts: ${helpSources.length} implementations start collapsed`);
