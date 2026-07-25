#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const targetFiles = [
  "ReadMe.md",
  "Install.md",
  "Manual.md",
  "3DCG.md",
  "API.md",
  "Animation.md",
  "Diagnostics.md",
  "Display.md",
  "HUD.md",
  "LowLevel.md",
  "Model_Asset.md",
  "PostProcess.md",
  "Scene_Asset.md",
  "Shaders.md",
  "Sound.md",
  "TileMap.md",
  "Touch.md",
  "WebgApp.md",
  "templates/README.md"
];

const errors = [];

function readFile(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[!-/:-@[-`{-~]/g, "")
    .replace(/\s+/g, "-");
}

function collectAnchors(markdown) {
  const anchors = new Set();
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!match) continue;
    const headingText = match[2].trim();
    if (!headingText) continue;
    anchors.add(slugifyHeading(headingText));
  }
  return anchors;
}

function stripCodeBlocks(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "");
}

function collectLinks(markdown) {
  const stripped = stripCodeBlocks(markdown);
  const links = [];
  const regex = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of stripped.matchAll(regex)) {
    links.push(match[1].trim());
  }
  return links;
}

for (const relPath of targetFiles) {
  const markdown = readFile(relPath);
  const baseDir = path.dirname(path.join(repoRoot, relPath));
  const links = collectLinks(markdown);

  for (const link of links) {
    if (
      link.startsWith("http://") ||
      link.startsWith("https://") ||
      link.startsWith("mailto:") ||
      link.startsWith("javascript:") ||
      link.startsWith("#")
    ) {
      continue;
    }

    const [rawTarget, rawAnchor] = link.split("#");
    const resolvedPath = path.resolve(baseDir, rawTarget);
    if (!fs.existsSync(resolvedPath)) {
      errors.push(`${relPath}: missing link target ${link}`);
      continue;
    }

    if (!rawAnchor) continue;
    const targetText = fs.readFileSync(resolvedPath, "utf8");
    const anchors = collectAnchors(targetText);
    if (!anchors.has(rawAnchor)) {
      errors.push(`${relPath}: missing anchor ${link}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Document link check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Document link check passed for ${targetFiles.length} files.`);
