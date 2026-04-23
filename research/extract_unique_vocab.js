#!/usr/bin/env node
/*
 * extract_unique_vocab.js
 *
 * 第 5 段階 (structured_extraction_step) の出力 chunk 群から、
 * 後続 chunk の agent に渡す語彙 (vocab) を生成する。
 *
 * 使い方:
 *   node research/extract_unique_vocab.js <input-dir> <output-path>
 *
 * 例:
 *   node research/extract_unique_vocab.js \
 *     research/runs/2026_04_23_06_47/structured_extraction/chunks_normalized/ \
 *     research/runs/2026_04_23_06_47/structured_extraction/vocab/vocab_after_chunk_05.json
 *
 * 入力: <input-dir> 配下の normalized_chunk_*.json (複数)
 * 出力: category / subcategory / color のユニーク値と出現回数
 *       (頻度降順、同 count は value の 50 音順で安定化)
 */

const fs = require("node:fs");
const path = require("node:path");

const TARGET_FIELDS = ["category", "subcategory", "color"];
const CHUNK_FILE_PATTERN = /^normalized_chunk_.+\.json$/;

function listChunkFiles(inputDir) {
  if (!fs.existsSync(inputDir)) {
    throw new Error(`input directory does not exist: ${inputDir}`);
  }
  const stat = fs.statSync(inputDir);
  if (!stat.isDirectory()) {
    throw new Error(`input path is not a directory: ${inputDir}`);
  }
  const entries = fs.readdirSync(inputDir);
  return entries
    .filter((name) => CHUNK_FILE_PATTERN.test(name))
    .map((name) => path.join(inputDir, name))
    .sort();
}

function loadChunk(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error(`chunk file is not a JSON array: ${filePath}`);
  }
  return data;
}

function isMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value !== "string") return false;
  if (value.trim() === "") return false;
  return true;
}

function extractFieldValues(row, field) {
  const raw = row[field];
  if (field === "color") {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isMeaningfulValue);
  }
  return isMeaningfulValue(raw) ? [raw] : [];
}

function countFrequency(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    for (const value of extractFieldValues(row, field)) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return counts;
}

function sortByFrequencyDesc(counts) {
  const collator = new Intl.Collator("ja");
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return collator.compare(a.value, b.value);
    });
}

function buildVocab(rows) {
  const vocab = {};
  for (const field of TARGET_FIELDS) {
    vocab[field] = sortByFrequencyDesc(countFrequency(rows, field));
  }
  return vocab;
}

function writeJsonFile(outputPath, data) {
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function main() {
  const [, , inputDir, outputPath] = process.argv;
  if (!inputDir || !outputPath) {
    console.error(
      "Usage: node research/extract_unique_vocab.js <input-dir> <output-path>",
    );
    process.exit(1);
  }

  const chunkFiles = listChunkFiles(inputDir);
  if (chunkFiles.length === 0) {
    throw new Error(
      `no normalized_chunk_*.json files found in: ${inputDir}`,
    );
  }

  const allRows = chunkFiles.flatMap(loadChunk);
  const vocab = buildVocab(allRows);
  writeJsonFile(outputPath, vocab);

  const summary = {
    inputDir,
    outputPath,
    chunkFiles: chunkFiles.length,
    totalRows: allRows.length,
    uniqueCounts: Object.fromEntries(
      TARGET_FIELDS.map((f) => [f, vocab[f].length]),
    ),
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  TARGET_FIELDS,
  CHUNK_FILE_PATTERN,
  listChunkFiles,
  loadChunk,
  extractFieldValues,
  countFrequency,
  sortByFrequencyDesc,
  buildVocab,
};
