#!/usr/bin/env node
/*
 * build_chunk_prompt.js
 *
 * 第 5 段階 (structured_extraction_step) で chunk N (N >= 1) 用の
 * Sonnet Agent 入力プロンプトを組み立てる。
 *
 * structured_extraction_prompt.md (仕様プロンプト本体) の末尾に
 * vocab_after_chunk_{N-1}.json から抽出した
 * 「## 【前段までに使われた語彙】」セクションを追加して書き出す。
 *
 * chunk 0 は前段語彙が無いので本スクリプトを使わず、
 * structured_extraction_prompt.md を直接 Sonnet Agent に渡す。
 *
 * 使い方:
 *   node research/build_chunk_prompt.js <chunk-num> <run-dir>
 *
 * 例:
 *   node research/build_chunk_prompt.js 1 research/runs/2026_04_16_06_46
 *
 * 入力:
 *   research/structured_extraction_prompt.md (仕様プロンプト本体)
 *   <run-dir>/structured_extraction/vocab/vocab_after_chunk_{N-1}.json
 * 出力:
 *   <run-dir>/structured_extraction/prompts/prompt_for_chunk_NN.md
 */

const fs = require("node:fs");
const path = require("node:path");
const { writeFileSafe } = require("./_safe_write");

const PROMPT_BASE_PATH = "research/structured_extraction_prompt.md";
const TARGET_FIELDS = ["category", "subcategory", "color"];

function parseChunkNum(arg) {
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `chunk-num must be an integer >= 1 (chunk 0 does not need this script): ${arg}`,
    );
  }
  return { num: n, str: String(n).padStart(2, "0") };
}

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildPriorVocabSection(vocab) {
  const lines = TARGET_FIELDS.map((f) => {
    const values = (vocab[f] || []).map((x) => x.value).join(", ");
    return `- ${f}: ${values}`;
  });
  return [
    "## 【前段までに使われた語彙】",
    "",
    "以下の category / subcategory / color が既に使用されています。",
    "あなたが抽出した語が同義なら、これらの表記に揃えてください。",
    "",
    ...lines,
    "",
  ].join("\n");
}

function buildPrompt(promptBase, vocab) {
  return promptBase + "\n" + buildPriorVocabSection(vocab);
}

function main() {
  const [, , chunkArg, runDirArg] = process.argv;
  if (!chunkArg || !runDirArg) {
    console.error(
      "Usage: node research/build_chunk_prompt.js <chunk-num> <run-dir>",
    );
    process.exit(1);
  }
  const { num: chunkNum, str: chunkStr } = parseChunkNum(chunkArg);
  const runDir = runDirArg.replace(/\/$/, "");

  const priorChunkNumStr = String(chunkNum - 1).padStart(2, "0");
  const vocabPath = path.join(
    runDir,
    "structured_extraction",
    "vocab",
    `vocab_after_chunk_${priorChunkNumStr}.json`,
  );
  const outputPath = path.join(
    runDir,
    "structured_extraction",
    "prompts",
    `prompt_for_chunk_${chunkStr}.md`,
  );

  if (!fs.existsSync(PROMPT_BASE_PATH)) {
    throw new Error(`prompt base does not exist: ${PROMPT_BASE_PATH}`);
  }
  if (!fs.existsSync(vocabPath)) {
    throw new Error(`vocab file does not exist: ${vocabPath}`);
  }

  const promptBase = fs.readFileSync(PROMPT_BASE_PATH, "utf8");
  const vocab = loadJsonFile(vocabPath);

  const finalPrompt = buildPrompt(promptBase, vocab);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSafe(outputPath, finalPrompt, "utf8");

  const summary = {
    chunkNum,
    runDir,
    promptBase: PROMPT_BASE_PATH,
    vocabSource: vocabPath,
    output: outputPath,
    sizeBytes: finalPrompt.length,
    vocabCounts: {
      category: vocab.category?.length || 0,
      subcategory: vocab.subcategory?.length || 0,
      color: vocab.color?.length || 0,
    },
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  PROMPT_BASE_PATH,
  TARGET_FIELDS,
  parseChunkNum,
  loadJsonFile,
  buildPriorVocabSection,
  buildPrompt,
};
