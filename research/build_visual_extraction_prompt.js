#!/usr/bin/env node
/*
 * build_visual_extraction_prompt.js
 *
 * 第 5 段階 substep 5-3 (視覚属性抽出) 用のプロンプト組立スクリプト。
 * 仕様プロンプト本体 (research/visual_extraction_prompt.md) に
 * 累積 vocab セクション + バッチファイルパス + 指定出力パス を追記して、
 * バッチごとに結合済みプロンプトを書き出す。
 *
 * 使い方:
 *   node research/build_visual_extraction_prompt.js <batch-num> <run-dir>
 *
 * 例:
 *   node research/build_visual_extraction_prompt.js 0 research/runs/2026_04_16_06_46
 *
 * 入力:
 *   research/visual_extraction_prompt.md (仕様プロンプト本体、固定)
 *   <run-dir>/visual_extraction/batches/batch_NNN.json
 *   <run-dir>/structured_extraction/vocab/vocab_after_chunk_{last}.json
 *
 * 出力:
 *   <run-dir>/visual_extraction/prompts/prompt_batch_NNN.md
 */

const fs = require("node:fs");
const path = require("node:path");
const { writeFileSafe } = require("./_safe_write");

const PROMPT_BASE_PATH = path.resolve(
  path.join(__dirname, "visual_extraction_prompt.md"),
);

function parseArgs() {
  const [, , batchArg, runDirArg] = process.argv;
  if (batchArg == null || !runDirArg) {
    console.error(
      "Usage: node research/build_visual_extraction_prompt.js <batch-num> <run-dir>",
    );
    process.exit(1);
  }
  const n = Number(batchArg);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`batch-num must be a non-negative integer: ${batchArg}`);
  }
  return {
    batchNum: n,
    batchStr: String(n).padStart(3, "0"),
    runDir: runDirArg.replace(/\/$/, ""),
  };
}

function pickLatestVocab(vocabDir) {
  if (!fs.existsSync(vocabDir)) {
    throw new Error(`vocab dir does not exist: ${vocabDir}`);
  }
  const re = /^vocab_after_chunk_(\d+)\.json$/;
  const entries = fs
    .readdirSync(vocabDir)
    .map((name) => {
      const m = name.match(re);
      return m ? { name, idx: Number(m[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.idx - b.idx);
  if (entries.length === 0) {
    throw new Error(`no vocab_after_chunk_*.json found in ${vocabDir}`);
  }
  const last = entries[entries.length - 1];
  return path.join(vocabDir, last.name);
}

function buildVocabSection(vocab) {
  const cats = vocab.category
    .map((v) => v.value)
    .filter((v) => v != null)
    .sort();
  const subs = vocab.subcategory
    .map((v) => v.value)
    .filter((v) => v != null)
    .sort();
  return `## 【前段までに使われた語彙 (vocab)】

第 5 段階 5-2 完了時点で category / subcategory に既に使われている語を以下に列挙する。
画像判定でカテゴリを決める際、同義のものがあれば優先してこのリストから選ぶ。
新規追加は許可するが、既存と似た粒度を維持すること。

### category (${cats.length} 語)

${cats.map((v) => `- ${v}`).join("\n")}

### subcategory (${subs.length} 語)

${subs.map((v) => `- ${v}`).join("\n")}
`;
}

function buildTailSection({ batchPath, outputAbsPath, batchStr, itemCount }) {
  return `## バッチファイルパス (Read する対象)

\`${batchPath}\`

このファイルを Read し、\`items\` 配列の全行 (${itemCount} 件) について画像 + タイトル + 現在属性を見て 5 フィールド + 新設 2 フィールドを判定する。

## 指定出力パス (書き出し先、1 回だけ書く)

\`${outputAbsPath}\`

全件処理が完了してから、上記ルールの「## 出力フォーマット」に従って JSON 配列を 1 回で書き込む。書き込み後、Read して件数が ${itemCount} 件であることを自己検証すること。

## 作業開始の前に

1. プロンプト冒頭「## 【絶対禁則】ファイル操作の制約」を再確認
2. バッチファイル (${batchPath}) を Read
3. 最初の 1 件で画像 Read → 判定の流れを試し、その後残り件数を同じ手順で処理
4. 全件処理後、出力パスに 1 回で書き込み → 件数検証

(バッチ ${batchStr}、全 ${itemCount} 件)
`;
}

function main() {
  const { batchNum, batchStr, runDir } = parseArgs();
  const visualDir = path.join(runDir, "visual_extraction");
  const batchPath = path.join(visualDir, "batches", `batch_${batchStr}.json`);
  const outDir = path.join(visualDir, "prompts");
  const outPath = path.join(outDir, `prompt_batch_${batchStr}.md`);
  const resultAbsPath = path.resolve(
    path.join(visualDir, "results", `visual_batch_${batchStr}.json`),
  );
  const vocabDir = path.join(runDir, "structured_extraction", "vocab");

  if (!fs.existsSync(batchPath)) {
    throw new Error(`batch file does not exist: ${batchPath}`);
  }
  const batch = JSON.parse(fs.readFileSync(batchPath, "utf8"));
  const vocabPath = pickLatestVocab(vocabDir);
  const vocab = JSON.parse(fs.readFileSync(vocabPath, "utf8"));
  const base = fs.readFileSync(PROMPT_BASE_PATH, "utf8");
  const vocabSection = buildVocabSection(vocab);
  const tail = buildTailSection({
    batchPath: path.resolve(batchPath),
    outputAbsPath: resultAbsPath,
    batchStr,
    itemCount: batch.items.length,
  });
  const combined = `${base.trimEnd()}\n\n---\n\n${vocabSection}\n---\n\n${tail}`;

  fs.mkdirSync(outDir, { recursive: true });
  writeFileSafe(outPath, combined, "utf8");

  console.log(
    JSON.stringify(
      {
        batchNum,
        batchStr,
        batchPath,
        vocabPath,
        itemCount: batch.items.length,
        promptPath: outPath,
        resultAbsPath,
        promptBytes: combined.length,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main();
}

module.exports = { buildVocabSection, buildTailSection };
