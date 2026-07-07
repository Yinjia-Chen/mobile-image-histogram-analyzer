#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const COMMENT_RATIO_MIN = 1 / 3;
const COMMENTED_EXTENSIONS = new Set([".java", ".js", ".css", ".html", ".xml"]);

// 课程评分关注的主运行路径是优化版 H5 源码和 Android 外壳。
// baseline-app.js 是性能对照材料，因此不计入本次核心源码注释比例检查。
const SOURCE_FILES = [
  "app/src/main/assets/app.js",
  "app/src/main/java/com/framia/mobilehistogram/MainActivity.java"
];

function listCommentedSourceFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listCommentedSourceFiles(entryPath));
      continue;
    }
    if (COMMENTED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function classifySourceLines(text) {
  const lines = text.split(/\r?\n/);
  let codeLines = 0;
  let commentLines = 0;
  let inBlockComment = false;
  let inXmlComment = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (inXmlComment) {
      commentLines += 1;
      if (line.includes("-->")) {
        inXmlComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      commentLines += 1;
      if (line.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (line.startsWith("<!--")) {
      commentLines += 1;
      if (!line.includes("-->")) {
        inXmlComment = true;
      }
      continue;
    }

    if (line.startsWith("//")) {
      commentLines += 1;
      continue;
    }

    if (line.startsWith("/*") || line.startsWith("/**")) {
      commentLines += 1;
      if (!line.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }

    codeLines += 1;
  }

  return { codeLines, commentLines };
}

function formatRatio(value) {
  return value.toFixed(3);
}

let totalCodeLines = 0;
let totalCommentLines = 0;

for (const sourceFile of SOURCE_FILES) {
  const absolutePath = path.resolve(sourceFile);
  const text = fs.readFileSync(absolutePath, "utf8");
  const counts = classifySourceLines(text);
  const ratio = counts.codeLines === 0 ? 0 : counts.commentLines / counts.codeLines;

  totalCodeLines += counts.codeLines;
  totalCommentLines += counts.commentLines;

  console.log(
    [
      sourceFile,
      `code=${counts.codeLines}`,
      `comments=${counts.commentLines}`,
      `ratio=${formatRatio(ratio)}`
    ].join(" ")
  );
}

const totalRatio = totalCodeLines === 0 ? 0 : totalCommentLines / totalCodeLines;
console.log(
  [
    "core-source-total",
    `code=${totalCodeLines}`,
    `comments=${totalCommentLines}`,
    `ratio=${formatRatio(totalRatio)}`,
    `required>${formatRatio(COMMENT_RATIO_MIN)}`
  ].join(" ")
);

if (totalRatio <= COMMENT_RATIO_MIN) {
  console.error("核心源码注释数量必须多于代码行数的三分之一。");
  process.exit(1);
}

const appSourceFiles = listCommentedSourceFiles(path.resolve("app/src"));
const missingCommentFiles = [];

for (const sourceFile of appSourceFiles) {
  const text = fs.readFileSync(sourceFile, "utf8");
  const counts = classifySourceLines(text);
  if (counts.commentLines === 0) {
    missingCommentFiles.push(path.relative(process.cwd(), sourceFile));
  }
}

console.log(`app-src-commented-files checked=${appSourceFiles.length} missing=${missingCommentFiles.length}`);

if (missingCommentFiles.length > 0) {
  console.error("以下 app/src 文件还没有源码注释：");
  for (const file of missingCommentFiles) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}
