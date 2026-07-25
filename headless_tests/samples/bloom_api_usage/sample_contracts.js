// ------------------------------------------------------------
// headless_tests/samples/bloom_api_usage/sample_contracts.js
//   Reject removed staged Bloom properties in application Bloom blocks
// ------------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryDir = fileURLToPath(new URL("../../../", import.meta.url));
const auditRoots = [
  join(repositoryDir, "samples"),
  join(repositoryDir, "unittest"),
  join(repositoryDir, "book")
];
const deprecatedBloomProperties = [
  "smallScale",
  "mediumScale",
  "largeScale",
  "smallSampleStep",
  "mediumSampleStep",
  "largeSampleStep",
  "smallThreshold",
  "mediumThreshold",
  "largeThreshold",
  "smallStrength",
  "mediumStrength",
  "largeStrength",
  "blurRadius",
  "blurIterations",
  "intensity",
  "resolutionScale",
  "stageMode",
  "exposure"
];

function findCodeFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findCodeFiles(path));
    else if (
      entry.isFile()
      && /\.(?:js|html|md)$/.test(entry.name)
      && !/^inside_.*\.md$/.test(entry.name)
    ) {
      files.push(path);
    }
  }
  return files;
}

function extractObjectBody(source, open) {
  let depth = 1;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return "";
}

// Pipelineのbloom blockとComputeBloomPassの直接constructor optionだけを検査し、
// DoFやSSRなどに同名の設定があってもBloom旧APIとして誤検出しません。
function extractComputeBloomOptionBlocks(source) {
  const blocks = [];
  const patterns = [
    /\bbloom\s*:\s*\{/g,
    /\bnew\s+ComputeBloomPass\s*\([^,]+,\s*\{/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const open = match.index + match[0].lastIndexOf("{");
      const body = extractObjectBody(source, open);
      if (body) blocks.push(body);
    }
  }
  return blocks;
}

const violations = [];
for (const root of auditRoots) {
  for (const path of findCodeFiles(root)) {
    const source = readFileSync(path, "utf8");
    for (const block of extractComputeBloomOptionBlocks(source)) {
      for (const property of deprecatedBloomProperties) {
        if (new RegExp(`\\b${property}\\s*:`).test(block)) {
          violations.push(`${relative(repositoryDir, path)} bloom.${property}`);
        }
      }
    }
  }
}

assert.deepEqual(
  violations,
  [],
  `applications must use the Pyramid Bloom API:\n${violations.join("\n")}`
);

const opacityMain = readFileSync(join(repositoryDir, "samples/opacity/main.js"), "utf8");
assert.match(opacityMain, /COMPUTE_BLOOM_DEFAULTS/);
assert.match(opacityMain, /bloom:\s*\{\s*\.\.\.COMPUTE_BLOOM_DEFAULTS,\s*strength:\s*0\.78/);

console.log("sample_bloom_api_usage_contracts: all application Bloom blocks use the Pyramid API");
