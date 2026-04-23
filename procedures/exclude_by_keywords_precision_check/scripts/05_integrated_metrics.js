#!/usr/bin/env node
// flagged 検証と unflagged 検証の結果を統合し、Precision / Recall / F1 を算出する。
// 両方の summary/stats.json が揃っている前提。
//
// 使い方:
//   node 05_integrated_metrics.js <FLAGGED_RUN_DIR> <UNFLAGGED_RUN_DIR> [OUT_PATH]
//   OUT_PATH を省略すると標準出力のみ
//
// 例:
//   node procedures/exclude_by_keywords_precision_check/scripts/05_integrated_metrics.js \
//     procedures/exclude_by_keywords_precision_check/runs/2026-04-18_flagged \
//     procedures/exclude_by_keywords_precision_check/runs/2026-04-20_unflagged \
//     procedures/exclude_by_keywords_precision_check/runs/integrated_2026-04.json

const fs = require("fs");
const path = require("path");

const [, , FLAGGED_DIR, UNFLAGGED_DIR, OUT_PATH_ARG] = process.argv;

if (!FLAGGED_DIR || !UNFLAGGED_DIR) {
  console.error("Usage: node 05_integrated_metrics.js <FLAGGED_RUN_DIR> <UNFLAGGED_RUN_DIR> [OUT_PATH]");
  process.exit(1);
}

const flaggedStats = JSON.parse(fs.readFileSync(path.join(FLAGGED_DIR, "summary", "stats.json"), "utf8"));
const unflaggedStats = JSON.parse(fs.readFileSync(path.join(UNFLAGGED_DIR, "summary", "stats.json"), "utf8"));

if (flaggedStats.phase !== "flagged" || unflaggedStats.phase !== "unflagged") {
  console.error("Phase mismatch. Check stats.json phase field.");
  process.exit(1);
}

const TP = flaggedStats.verdict_dist.exclude; // flagged で正しく除外
const FP = flaggedStats.verdict_dist.rescue; // flagged だが本当は仕入れ候補 (誤検出)
const FN = unflaggedStats.verdict_dist.exclude; // unflagged だが本当は除外すべき (見落とし)
const TN = unflaggedStats.verdict_dist.keep; // unflagged で正しく通過

const precision = TP / (TP + FP);
const recall = TP / (TP + FN);
const f1 = (2 * precision * recall) / (precision + recall);
const accuracy = (TP + TN) / (TP + FP + FN + TN);

const result = {
  computed_at: new Date().toISOString(),
  sources: {
    flagged: FLAGGED_DIR,
    unflagged: UNFLAGGED_DIR,
  },
  confusion_matrix: { TP, FP, FN, TN },
  unclear_counts: {
    flagged: flaggedStats.verdict_dist.unclear,
    unflagged: unflaggedStats.verdict_dist.unclear,
  },
  metrics: {
    precision: `${(precision * 100).toFixed(2)}%`,
    recall: `${(recall * 100).toFixed(2)}%`,
    f1: `${(f1 * 100).toFixed(2)}%`,
    accuracy: `${(accuracy * 100).toFixed(2)}%`,
  },
  notes: [
    "TP = flagged の exclude (辞書が除外し、実際に除外すべきだった)",
    "FP = flagged の rescue (辞書が除外したが、実際は仕入れ候補)",
    "FN = unflagged の exclude (辞書が通したが、実際は除外すべきだった)",
    "TN = unflagged の keep (辞書が通し、実際に仕入れ候補でよい)",
    "Precision = TP / (TP + FP): 除外判定の正確さ",
    "Recall = TP / (TP + FN): 除外すべき商品を拾えた率",
    "unclear は分母に含めない",
  ],
};

console.log(JSON.stringify(result, null, 2));

if (OUT_PATH_ARG) {
  fs.writeFileSync(path.resolve(OUT_PATH_ARG), JSON.stringify(result, null, 2));
  console.error(`\nWrote: ${OUT_PATH_ARG}`);
}
