/*
 * _row_counts.js (内部ヘルパー、CLI ではない)
 *
 * image_review/filtered_unflagged.json から rowIndex → 14 日 SOLD 件数
 * (= ids 配列の要素数) の Map を作る。
 * 6-1 (build_identity_clusters.js) と 6-3 (assign_final_cluster_ids.js) が共用する。
 */

const fs = require("node:fs");
const path = require("node:path");

function loadRowSoldCounts(runDir) {
  const filteredPath = path.join(
    runDir,
    "image_review",
    "filtered_unflagged.json",
  );
  if (!fs.existsSync(filteredPath)) {
    throw new Error(`filtered_unflagged.json does not exist: ${filteredPath}`);
  }
  const filtered = JSON.parse(fs.readFileSync(filteredPath, "utf8"));
  const rowSoldCounts = new Map();
  for (const r of filtered.rows) rowSoldCounts.set(r.rowIndex, r.ids.length);
  return rowSoldCounts;
}

function totalSoldCount(items, rowSoldCounts) {
  let s = 0;
  for (const it of items) s += rowSoldCounts.get(it.rowIndex) ?? 1;
  return s;
}

module.exports = { loadRowSoldCounts, totalSoldCount };
