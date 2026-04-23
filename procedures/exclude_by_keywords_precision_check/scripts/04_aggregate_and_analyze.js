#!/usr/bin/env node
// <RUN_DIR>/results/batch_*_result.json をすべて統合し、verdict 分布と誤判定理由を集計する。
// 出力: <RUN_DIR>/summary/merged_gt.json, stats.json, error_patterns.md
//
// 使い方:
//   node 04_aggregate_and_analyze.js <RUN_DIR> <PHASE>
//   PHASE = "flagged" | "unflagged"
//
// 例:
//   node procedures/exclude_by_keywords_precision_check/scripts/04_aggregate_and_analyze.js \
//     procedures/exclude_by_keywords_precision_check/runs/2026-04-20_unflagged unflagged

const fs = require("fs");
const path = require("path");

const [, , RUN_DIR_ARG, PHASE_ARG] = process.argv;

if (!RUN_DIR_ARG || !PHASE_ARG) {
  console.error("Usage: node 04_aggregate_and_analyze.js <RUN_DIR> <flagged|unflagged>");
  process.exit(1);
}
if (PHASE_ARG !== "flagged" && PHASE_ARG !== "unflagged") {
  console.error(`PHASE must be "flagged" or "unflagged"`);
  process.exit(1);
}

const RUN_DIR = path.resolve(RUN_DIR_ARG);
const PHASE = PHASE_ARG;
const RESULTS_DIR = path.join(RUN_DIR, "results");
const SUMMARY_DIR = path.join(RUN_DIR, "summary");
fs.mkdirSync(SUMMARY_DIR, { recursive: true });

const files = fs
  .readdirSync(RESULTS_DIR)
  .filter((f) => f.startsWith("batch_") && f.endsWith("_result.json"))
  .sort();

const allItems = [];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf8"));
  allItems.push(...(d.items || d));
}

// PHASE ごとに verdict キーが異なる:
//   flagged:   exclude / rescue / unclear
//   unflagged: keep / exclude / unclear
const verdictKeys = PHASE === "flagged" ? ["exclude", "rescue", "unclear"] : ["keep", "exclude", "unclear"];
const dist = Object.fromEntries(verdictKeys.map((k) => [k, 0]));
for (const r of allItems) {
  if (dist[r.gt_verdict] !== undefined) dist[r.gt_verdict]++;
}

const total = allItems.length;
const stats = {
  phase: PHASE,
  total,
  verdict_dist: dist,
};

if (PHASE === "flagged") {
  stats.precision_on_flagged = `${((dist.exclude / total) * 100).toFixed(2)}%`;
  stats.rescue_rate = `${((dist.rescue / total) * 100).toFixed(2)}%`;
  stats.unclear_rate = `${((dist.unclear / total) * 100).toFixed(2)}%`;
} else {
  stats.miss_rate = `${((dist.exclude / total) * 100).toFixed(2)}%`;
  stats.keep_rate = `${((dist.keep / total) * 100).toFixed(2)}%`;
  stats.unclear_rate = `${((dist.unclear / total) * 100).toFixed(2)}%`;
}

fs.writeFileSync(path.join(SUMMARY_DIR, "merged_gt.json"), JSON.stringify({ phase: PHASE, items: allItems }, null, 2));
fs.writeFileSync(path.join(SUMMARY_DIR, "stats.json"), JSON.stringify(stats, null, 2));

// 誤判定パターン分析用の md 雛形
let md = `# ${PHASE} 検証 誤判定パターン分析\n\n`;
md += `## verdict 分布\n\n`;
md += `| verdict | 件数 | 割合 |\n|---|---|---|\n`;
for (const k of verdictKeys) {
  md += `| ${k} | ${dist[k]} | ${((dist[k] / total) * 100).toFixed(2)}% |\n`;
}
md += `\n`;

// 誤判定側の理由一覧 (flagged: rescue / unflagged: exclude)
const errorKey = PHASE === "flagged" ? "rescue" : "exclude";
const errorLabel = PHASE === "flagged" ? "誤判定 (rescue)" : "辞書見落とし (exclude)";
const errors = allItems.filter((r) => r.gt_verdict === errorKey);
md += `## ${errorLabel} の ${errors.length} 件 (先頭 50 件抜粋、全件は merged_gt.json 参照)\n\n`;
for (const r of errors.slice(0, 50)) {
  const extra = PHASE === "flagged" && r.primary ? ` [${r.primary}]` : "";
  md += `- rowIndex ${r.rowIndex}${extra} / ${r.title} / ${r.gt_reason}\n`;
}

fs.writeFileSync(path.join(SUMMARY_DIR, "error_patterns.md"), md);
console.log(JSON.stringify(stats, null, 2));
