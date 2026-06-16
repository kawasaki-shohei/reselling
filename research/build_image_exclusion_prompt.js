#!/usr/bin/env node
/*
 * build_image_exclusion_prompt.js
 *
 * 第 4 段階 (image_exclusion_step) で 1 Agent が担当する N バッチ分の
 * Sonnet Agent 入力プロンプトを組み立てる。
 *
 * 雛形 research/image_exclusion_prompt.md の「## プロンプト本文」コードフェンス内を抽出し、
 * 以下のプレースホルダを差し込んだ完成プロンプトを 1 ファイルに書き出す:
 *   {CRITERIA}     ... research/exclude_criteria.md の判定基準 (本番と精度検証の単一ソース)
 *   {BATCH_PATHS}  ... 担当バッチの batch_NNN.json 絶対パス (改行区切り)
 *   {RESULT_PATHS} ... 対応する batch_NNN_result.json 絶対パス (改行区切り)
 *
 * 親 Claude が手でプロンプトを組まない / 判定基準を要約しないため (mercari-research-v2.md 原則 9)。
 *
 * 使い方:
 *   node research/build_image_exclusion_prompt.js <run-dir> <batch-num> [batch-num ...]
 *
 * 例 (Agent 1 = batch 0,1 を担当):
 *   node research/build_image_exclusion_prompt.js research/runs/2026_05_15_10_00 0 1
 *
 * 入力:
 *   research/image_exclusion_prompt.md  (雛形、固定)
 *   research/exclude_criteria.md        (判定基準の単一ソース、固定)
 *   <run-dir>/image_review/batches/batch_NNN.json
 * 出力:
 *   <run-dir>/image_review/prompts/prompt_for_batches_<NNN>[_<NNN>...].md
 */

const fs = require("node:fs");
const path = require("node:path");
const { writeFileSafe } = require("./_safe_write");

const PROMPT_BASE_PATH = path.resolve(
  path.join(__dirname, "image_exclusion_prompt.md"),
);
const CRITERIA_PATH = path.resolve(path.join(__dirname, "exclude_criteria.md"));
const CRITERIA_START_MARKER = "## 除外カテゴリの定義";

function parseArgs() {
  const [, , runDirArg, ...batchArgs] = process.argv;
  if (!runDirArg || batchArgs.length === 0) {
    console.error(
      "Usage: node research/build_image_exclusion_prompt.js <run-dir> <batch-num> [batch-num ...]",
    );
    process.exit(1);
  }
  const batchNums = batchArgs.map((a) => {
    const n = Number(a);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`batch-num must be a non-negative integer: ${a}`);
    }
    return n;
  });
  return { runDir: runDirArg.replace(/\/$/, ""), batchNums };
}

// 雛形の「## プロンプト本文」直後の最初のコードフェンス (``` ... ```) の中身を返す。
// 雛形本文の外 (タイトル・使い方・verdict 表) を Agent に渡さないため。
function extractPromptBody(baseRaw) {
  const sectionIdx = baseRaw.indexOf("## プロンプト本文");
  if (sectionIdx < 0) {
    throw new Error(`"## プロンプト本文" section not found in ${PROMPT_BASE_PATH}`);
  }
  const after = baseRaw.slice(sectionIdx);
  const m = after.match(/```[^\n]*\n([\s\S]*?)\n```/);
  if (!m) {
    throw new Error(`code fence after "## プロンプト本文" not found in ${PROMPT_BASE_PATH}`);
  }
  return m[1];
}

function loadCriteria() {
  const raw = fs.readFileSync(CRITERIA_PATH, "utf8");
  const idx = raw.indexOf(CRITERIA_START_MARKER);
  if (idx < 0) {
    throw new Error(`"${CRITERIA_START_MARKER}" not found in ${CRITERIA_PATH}`);
  }
  return raw.slice(idx).trimEnd();
}

function substitute(body, { criteria, batchPaths, resultPaths }) {
  for (const ph of ["{CRITERIA}", "{BATCH_PATHS}", "{RESULT_PATHS}"]) {
    if (!body.includes(ph)) {
      throw new Error(`placeholder ${ph} not found in prompt body`);
    }
  }
  return body
    .split("{CRITERIA}")
    .join(criteria)
    .split("{BATCH_PATHS}")
    .join(batchPaths)
    .split("{RESULT_PATHS}")
    .join(resultPaths);
}

function main() {
  const { runDir, batchNums } = parseArgs();
  const imageReviewDir = path.join(runDir, "image_review");
  const batchStrs = batchNums.map((n) => String(n).padStart(3, "0"));

  const batchAbsPaths = batchStrs.map((s) => {
    const p = path.resolve(path.join(imageReviewDir, "batches", `batch_${s}.json`));
    if (!fs.existsSync(p)) {
      throw new Error(`batch file does not exist: ${p}`);
    }
    return p;
  });
  const resultAbsPaths = batchStrs.map((s) =>
    path.resolve(path.join(imageReviewDir, "results", `batch_${s}_result.json`)),
  );

  const baseRaw = fs.readFileSync(PROMPT_BASE_PATH, "utf8");
  const body = extractPromptBody(baseRaw);
  const criteria = loadCriteria();

  const finalPrompt = substitute(body, {
    criteria,
    batchPaths: batchAbsPaths.join("\n"),
    resultPaths: resultAbsPaths.join("\n"),
  });

  const outDir = path.join(imageReviewDir, "prompts");
  const outPath = path.join(outDir, `prompt_for_batches_${batchStrs.join("_")}.md`);
  fs.mkdirSync(outDir, { recursive: true });
  writeFileSafe(outPath, finalPrompt, "utf8");

  // バッチ件数の合計を summary に出す (入出力件数チェックの手がかり)
  let itemCount = 0;
  for (const p of batchAbsPaths) {
    itemCount += JSON.parse(fs.readFileSync(p, "utf8")).items.length;
  }

  console.log(
    JSON.stringify(
      {
        runDir,
        batchNums,
        batchPaths: batchAbsPaths,
        resultPaths: resultAbsPaths,
        itemCount,
        criteriaSource: CRITERIA_PATH,
        promptPath: outPath,
        promptBytes: finalPrompt.length,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main();
}

module.exports = { extractPromptBody, loadCriteria, substitute };
