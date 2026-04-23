#!/usr/bin/env node
/*
 * split_chunks_for_extraction.js
 *
 * 第 4 段階 (keyword_exclusion_step) の出力 `exclusion_output.json` から
 * unflagged 行 (exclusion === null) を抽出し、第 5 段階 (structured_extraction_step)
 * 用に固定件数ずつの TSV chunk に分割する。
 *
 * 使い方:
 *   node research/split_chunks_for_extraction.js <input-json> <output-dir> [chunk-size=150]
 *
 * 例:
 *   node research/split_chunks_for_extraction.js \
 *     research/runs/2026_04_23_06_47/exclusion_final/exclusion_output.json \
 *     research/runs/2026_04_23_06_47/structured_extraction/chunks_input/
 *
 * 出力 TSV フォーマット (1 行目がヘッダー):
 *   rowIndex <TAB> id <TAB> name
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CHUNK_SIZE = 150;
const TSV_HEADER = "rowIndex\tid\tname";
const FORBIDDEN_TSV_CHARS = /[\t\r\n]/;

function loadExclusionOutput(inputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`input file does not exist: ${inputPath}`);
  }
  const raw = fs.readFileSync(inputPath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.rows)) {
    throw new Error(`input JSON is missing "rows" array: ${inputPath}`);
  }
  return data.rows;
}

function extractUnflaggedRows(rows) {
  const skipped = [];
  const unflagged = [];
  for (const row of rows) {
    if (row.exclusion !== null) continue;
    if (!Array.isArray(row.ids) || row.ids.length === 0) {
      skipped.push({ rowIndex: row.rowIndex, reason: "no ids" });
      continue;
    }
    if (typeof row.name !== "string") {
      skipped.push({ rowIndex: row.rowIndex, reason: "name is not string" });
      continue;
    }
    if (FORBIDDEN_TSV_CHARS.test(row.name)) {
      skipped.push({ rowIndex: row.rowIndex, reason: "name contains tab or newline" });
      continue;
    }
    unflagged.push({
      rowIndex: row.rowIndex,
      id: row.ids[0],
      name: row.name,
    });
  }
  return { unflagged, skipped };
}

function splitIntoChunks(rows, chunkSize) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return chunks;
}

function formatTsv(chunkRows) {
  const lines = [TSV_HEADER];
  for (const r of chunkRows) {
    lines.push(`${r.rowIndex}\t${r.id}\t${r.name}`);
  }
  return lines.join("\n") + "\n";
}

function chunkFileName(index) {
  return `chunk_${String(index).padStart(2, "0")}.tsv`;
}

function writeChunkFiles(outputDir, chunks) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPaths = [];
  for (let i = 0; i < chunks.length; i++) {
    const outPath = path.join(outputDir, chunkFileName(i));
    fs.writeFileSync(outPath, formatTsv(chunks[i]), "utf8");
    outputPaths.push(outPath);
  }
  return outputPaths;
}

function main() {
  const [, , inputPath, outputDir, chunkSizeArg] = process.argv;
  if (!inputPath || !outputDir) {
    console.error(
      "Usage: node research/split_chunks_for_extraction.js <input-json> <output-dir> [chunk-size=150]",
    );
    process.exit(1);
  }
  const chunkSize = chunkSizeArg ? Number(chunkSizeArg) : DEFAULT_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`chunk-size must be a positive integer: ${chunkSizeArg}`);
  }

  const rows = loadExclusionOutput(inputPath);
  const { unflagged, skipped } = extractUnflaggedRows(rows);
  const chunks = splitIntoChunks(unflagged, chunkSize);
  const outputPaths = writeChunkFiles(outputDir, chunks);

  if (skipped.length > 0) {
    console.error(`skipped ${skipped.length} rows:`);
    for (const s of skipped.slice(0, 10)) {
      console.error(`  rowIndex=${s.rowIndex} reason="${s.reason}"`);
    }
    if (skipped.length > 10) {
      console.error(`  ...and ${skipped.length - 10} more`);
    }
  }

  const summary = {
    inputPath,
    outputDir,
    totalRows: rows.length,
    unflaggedRows: unflagged.length,
    skippedRows: skipped.length,
    chunkSize,
    chunkCount: chunks.length,
    firstChunk: outputPaths[0] || null,
    lastChunk: outputPaths[outputPaths.length - 1] || null,
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  TSV_HEADER,
  FORBIDDEN_TSV_CHARS,
  loadExclusionOutput,
  extractUnflaggedRows,
  splitIntoChunks,
  formatTsv,
  chunkFileName,
  writeChunkFiles,
};
