#!/usr/bin/env node
/*
 * filter_normalize_map.js
 *
 * 第 5 段階 normalization_step の規則ベース仕分けステップ。
 * proposed_normalize_map_NN.json (Haiku 提案、不変) を読み、
 * 各 proposal を承認/却下に仕分ける。
 *
 * 使い方:
 *   node research/filter_normalize_map.js <chunk-num> <run-dir>
 *
 * 例:
 *   node research/filter_normalize_map.js 00 research/runs/2026_04_23_05_06
 *
 * 入力:
 *   <run-dir>/structured_extraction/normalization/proposed_normalize_map_NN.json
 * 出力:
 *   <run-dir>/structured_extraction/normalization/filtered_normalize_map_NN.json
 *   <run-dir>/structured_extraction/normalization/rejected_pairs_NN.json
 *
 * 判定順:
 *   1. NFKC + toLowerCase + 空白除去で from と to が一致 → 承認 (case/whitespace)
 *   2. 部分文字列関係 (from が to を含む / to が from を含む):
 *        除去される文字列が接尾辞リストに含まれる → 承認 (接尾辞除去)
 *        含まれない                              → 却下 (粒度統合の疑い)
 *   3. 上記いずれにも該当しない                  → 承認 (無関係 = 別表記)
 */

const fs = require("node:fs");
const path = require("node:path");
const { writeFileSafe } = require("./_safe_write");

const SUFFIX_LIST = [
  "サイズ",
  "色",
  "入り",
  "入",
  "組",
  "点",
  "セット",
  "枚セット",
];
const WHITESPACE_PATTERN = /\s+/g;

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

function writeJsonFile(outputPath, data) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSafe(outputPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function normalizeForCompare(s) {
  return s.normalize("NFKC").toLowerCase().replace(WHITESPACE_PATTERN, "");
}

function classifyProposal(proposal) {
  const { from, to } = proposal;
  if (typeof from !== "string" || typeof to !== "string") {
    return { approved: false, reason: "from_or_to_not_string" };
  }
  if (from === to) {
    return { approved: false, reason: "from_equals_to" };
  }
  if (normalizeForCompare(from) === normalizeForCompare(to)) {
    return { approved: true, reason: "case_or_whitespace_normalization" };
  }
  const longer = from.length >= to.length ? from : to;
  const shorter = from.length >= to.length ? to : from;
  if (longer.includes(shorter)) {
    const removed = longer.replace(shorter, "");
    if (SUFFIX_LIST.includes(removed)) {
      return { approved: true, reason: `suffix_removal: "${removed}"` };
    }
    return {
      approved: false,
      reason: `substring_relation_not_in_suffix_list: removed="${removed}"`,
    };
  }
  return { approved: true, reason: "unrelated_strings" };
}

function filterProposals(proposals) {
  const approved = [];
  const rejected = [];
  for (const p of proposals) {
    const c = classifyProposal(p);
    if (c.approved) {
      approved.push({ ...p, approval_reason: c.reason });
    } else {
      rejected.push({ ...p, rejection_reason: c.reason });
    }
  }
  return { approved, rejected };
}

function main() {
  const [, , chunkArg, runDirArg] = process.argv;
  if (!chunkArg || !runDirArg) {
    console.error(
      "Usage: node research/filter_normalize_map.js <chunk-num> <run-dir>",
    );
    process.exit(1);
  }
  const nn = parseChunkNum(chunkArg);
  const runDir = runDirArg.replace(/\/$/, "");
  const normDir = path.join(runDir, "structured_extraction", "normalization");
  const inputPath = path.join(normDir, `proposed_normalize_map_${nn}.json`);
  const filteredPath = path.join(normDir, `filtered_normalize_map_${nn}.json`);
  const rejectedPath = path.join(normDir, `rejected_pairs_${nn}.json`);

  const proposed = loadJsonFile(inputPath);
  if (!Array.isArray(proposed.proposals)) {
    throw new Error(
      `proposed_normalize_map JSON missing "proposals" array: ${inputPath}`,
    );
  }

  const { approved, rejected } = filterProposals(proposed.proposals);

  writeJsonFile(filteredPath, { proposals: approved });
  writeJsonFile(rejectedPath, { proposals: rejected });

  const summary = {
    input: inputPath,
    filtered: filteredPath,
    rejected: rejectedPath,
    proposed: proposed.proposals.length,
    approvedCount: approved.length,
    rejectedCount: rejected.length,
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  SUFFIX_LIST,
  parseChunkNum,
  normalizeForCompare,
  classifyProposal,
  filterProposals,
  loadJsonFile,
  writeJsonFile,
};
