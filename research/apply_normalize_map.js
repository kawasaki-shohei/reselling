#!/usr/bin/env node
/*
 * apply_normalize_map.js
 *
 * 第 5 段階 normalization_step の最終ステップ。
 * filtered_normalize_map_NN.json の承認済みペアを
 * structured_chunk_NN.json (Sonnet 生出力、不変) に適用して
 * normalized_chunk_NN.json を生成する。
 *
 * 使い方:
 *   node research/apply_normalize_map.js <chunk-num> <run-dir>
 *
 * 例:
 *   node research/apply_normalize_map.js 00 research/runs/2026_04_23_05_06
 *
 * 入力:
 *   <run-dir>/structured_extraction/chunks_output/structured_chunk_NN.json
 *   <run-dir>/structured_extraction/normalization/filtered_normalize_map_NN.json
 *     ※ ファイル不在 / proposals 空なら元データをそのままコピー
 * 出力:
 *   <run-dir>/structured_extraction/chunks_normalized/normalized_chunk_NN.json
 */

const fs = require("node:fs");
const path = require("node:path");

function parseChunkNum(arg) {
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`chunk-num must be a non-negative integer: ${arg}`);
  }
  return String(n).padStart(2, "0");
}

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadFilteredMap(filePath) {
  if (!fs.existsSync(filePath)) {
    return { proposals: [] };
  }
  const data = loadJsonFile(filePath);
  if (!Array.isArray(data.proposals)) {
    throw new Error(
      `filtered_normalize_map JSON missing "proposals" array: ${filePath}`,
    );
  }
  return data;
}

function applyProposalsToRow(row, proposals) {
  const next = { ...row };
  for (const { field, from, to } of proposals) {
    const cur = next[field];
    if (cur === null || cur === undefined) continue;
    if (Array.isArray(cur)) {
      next[field] = cur.map((v) => (v === from ? to : v));
    } else if (typeof cur === "string" && cur === from) {
      next[field] = to;
    }
  }
  return next;
}

function applyProposals(rows, proposals) {
  return rows.map((row) => applyProposalsToRow(row, proposals));
}

function countApplications(rows, proposals) {
  const counts = new Map();
  for (const row of rows) {
    for (const { field, from, to } of proposals) {
      const cur = row[field];
      if (cur === null || cur === undefined) continue;
      const hit = Array.isArray(cur)
        ? cur.filter((v) => v === from).length
        : cur === from
          ? 1
          : 0;
      if (hit > 0) {
        const key = `${field}: ${from} -> ${to}`;
        counts.set(key, (counts.get(key) || 0) + hit);
      }
    }
  }
  return Object.fromEntries(counts);
}

function writeJsonFile(outputPath, data) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function main() {
  const [, , chunkArg, runDirArg] = process.argv;
  if (!chunkArg || !runDirArg) {
    console.error(
      "Usage: node research/apply_normalize_map.js <chunk-num> <run-dir>",
    );
    process.exit(1);
  }
  const nn = parseChunkNum(chunkArg);
  const runDir = runDirArg.replace(/\/$/, "");
  const stageDir = path.join(runDir, "structured_extraction");
  const inputChunkPath = path.join(
    stageDir,
    "chunks_output",
    `structured_chunk_${nn}.json`,
  );
  const filteredMapPath = path.join(
    stageDir,
    "normalization",
    `filtered_normalize_map_${nn}.json`,
  );
  const outputPath = path.join(
    stageDir,
    "chunks_normalized",
    `normalized_chunk_${nn}.json`,
  );

  const rows = loadJsonFile(inputChunkPath);
  if (!Array.isArray(rows)) {
    throw new Error(`structured_chunk JSON is not an array: ${inputChunkPath}`);
  }
  const filtered = loadFilteredMap(filteredMapPath);
  const proposals = filtered.proposals;

  const out = applyProposals(rows, proposals);
  writeJsonFile(outputPath, out);

  const summary = {
    inputChunk: inputChunkPath,
    filteredMap: fs.existsSync(filteredMapPath) ? filteredMapPath : null,
    output: outputPath,
    rows: rows.length,
    proposalsCount: proposals.length,
    applyCounts: countApplications(rows, proposals),
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  parseChunkNum,
  loadJsonFile,
  loadFilteredMap,
  applyProposalsToRow,
  applyProposals,
  countApplications,
  writeJsonFile,
};
