#!/usr/bin/env node
/*
 * build_identity_clusters.js
 *
 * 第 6 段階 工程 6-1 (Node 仮クラスタリング)。
 * 5-3 完了後の属性付き JSON を入力に、以下の 6 軸で完全一致グループを作る:
 *   category + subcategory + color + size + quantity + pattern
 * - null は "null" と完全一致 (null=null)
 * - color は配列、ソートして join する
 * - material はクラスタ軸に含めない (判定困難なため、6-2 で画像判定時の補助として使う)
 *
 * 使い方:
 *   node research/build_identity_clusters.js <input-attributes-json> <run-dir>
 *
 * 入力 JSON のフォーマット (5-3 最終出力):
 *   [
 *     {
 *       "rowIndex": 163,
 *       "id": "m...",
 *       "name": "タイトル",
 *       "attributes": {
 *         "category": "...", "subcategory": "...", "color": [...],
 *         "size": "...", "quantity": "...", "pattern": "...", "material": "..."
 *       }
 *     }
 *   ]
 *
 * 出力:
 *   <run-dir>/identity_resolution/clusters.json
 */

const fs = require("node:fs");
const path = require("node:path");
const { writeFileSafe } = require("./_safe_write");

const CLUSTER_AXES = [
  "category",
  "subcategory",
  "color",
  "size",
  "quantity",
  "pattern",
];

function parseArgs() {
  const [, , inputPath, runDirArg] = process.argv;
  if (!inputPath || !runDirArg) {
    console.error(
      "Usage: node research/build_identity_clusters.js <input-attributes-json> <run-dir>",
    );
    process.exit(1);
  }
  return { inputPath, runDir: runDirArg.replace(/\/$/, "") };
}

function normalizeValue(v) {
  if (v == null) return "null";
  if (Array.isArray(v)) {
    const sorted = [...v].filter((x) => x != null).map(String).sort();
    return sorted.length === 0 ? "null" : `[${sorted.join(",")}]`;
  }
  return String(v);
}

function buildGroupKey(attrs) {
  return CLUSTER_AXES.map((k) => `${k}=${normalizeValue(attrs?.[k])}`).join(
    "|",
  );
}

function clusterRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = buildGroupKey(r.attributes);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({
      rowIndex: r.rowIndex,
      id: r.id,
      name: r.name,
      attributes: r.attributes,
    });
  }
  const groups = [];
  const keys = [...map.keys()].sort();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const items = map.get(key);
    groups.push({
      groupId: i,
      groupKey: key,
      size: items.length,
      status: items.length === 1 ? "singleton_confirmed" : "pending",
      items,
    });
  }
  return groups;
}

function summarize(groups) {
  const singleton = groups.filter((g) => g.status === "singleton_confirmed");
  const multi = groups.filter((g) => g.status === "pending");
  const sizeBuckets = { "1": 0, "2": 0, "3-4": 0, "5-9": 0, "10-19": 0, "20-49": 0, "50+": 0 };
  for (const g of groups) {
    const s = g.size;
    if (s === 1) sizeBuckets["1"]++;
    else if (s === 2) sizeBuckets["2"]++;
    else if (s <= 4) sizeBuckets["3-4"]++;
    else if (s <= 9) sizeBuckets["5-9"]++;
    else if (s <= 19) sizeBuckets["10-19"]++;
    else if (s <= 49) sizeBuckets["20-49"]++;
    else sizeBuckets["50+"]++;
  }
  const maxGroup = groups.reduce(
    (acc, g) => (g.size > acc.size ? { size: g.size, key: g.groupKey } : acc),
    { size: 0, key: null },
  );
  return {
    totalRows: groups.reduce((acc, g) => acc + g.size, 0),
    groupCount: groups.length,
    singletonGroups: singleton.length,
    multiItemGroups: multi.length,
    sizeBuckets,
    largestGroupSize: maxGroup.size,
    largestGroupKey: maxGroup.key,
  };
}

function main() {
  const { inputPath, runDir } = parseArgs();
  const rows = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(rows)) {
    throw new Error(`expected top-level array in ${inputPath}`);
  }
  const groups = clusterRows(rows);
  const summary = summarize(groups);

  const outDir = path.join(runDir, "identity_resolution");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "clusters.json");
  writeFileSafe(
    outPath,
    JSON.stringify({ summary, groups }, null, 2) + "\n",
    "utf8",
  );
  console.log(JSON.stringify({ outPath, ...summary }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { buildGroupKey, clusterRows, summarize, CLUSTER_AXES };
