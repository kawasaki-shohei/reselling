#!/usr/bin/env node
/*
 * assign_final_cluster_ids.js
 *
 * 第 6 段階 工程 6-3 (最終 cluster_id 採番)。
 * 6-1 の clusters.json と 6-2 の results/*.json を集約し、
 * 各商品に cluster_id を付与して仕入れ候補フラグを立てる。
 *
 * 使い方:
 *   node research/assign_final_cluster_ids.js <run-dir>
 *
 * 入力:
 *   <run-dir>/identity_resolution/clusters.json (6-1 出力)
 *   <run-dir>/identity_resolution/results/result_group_*.json (6-2 出力、複数)
 *   <run-dir>/image_review/filtered_unflagged.json (各 row の ids 数 = 14 日 SOLD 件数)
 *
 * 出力:
 *   <run-dir>/identity_resolution/final_clusters.json
 *
 * cluster_id 命名: `{category}_{subcategory}_{連番3桁}` (subcategory が null なら `{category}__{連番3桁}`)
 *
 * 仕入れ候補フラグ:
 *   cluster.count_total (= cluster 内の全 row の ids 合計 = 14 日内に売れた件数)
 *   が PURCHASE_THRESHOLD 以上なら is_purchase_candidate=true。
 *   Why: 1 seller が同一商品を 3 件以上売った場合も仕入れ候補として拾う。
 *   row 数 (size) で判定すると単独 seller の連続出品が漏れる。
 */

const fs = require("node:fs");
const path = require("node:path");
const { writeFileSafe } = require("./_safe_write");

const PURCHASE_THRESHOLD = 3;

function parseArgs() {
  const [, , runDirArg] = process.argv;
  if (!runDirArg) {
    console.error(
      "Usage: node research/assign_final_cluster_ids.js <run-dir>",
    );
    process.exit(1);
  }
  return { runDir: runDirArg.replace(/\/$/, "") };
}

function sanitizeIdPart(v) {
  if (v == null) return "";
  const s = String(v).trim();
  return s.replace(/[\s/\\|]+/g, "-");
}

function parseGroupKey(groupKey) {
  const out = {};
  for (const pair of groupKey.split("|")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    out[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return out;
}

function loadResultsForGroup(resultsDir, groupId) {
  const singlePath = path.join(resultsDir, `result_group_${groupId}.json`);
  if (fs.existsSync(singlePath)) {
    return [JSON.parse(fs.readFileSync(singlePath, "utf8"))];
  }
  const re = new RegExp(`^result_group_${groupId}_sub_(\\d+)\\.json$`);
  if (!fs.existsSync(resultsDir)) return [];
  const matches = fs
    .readdirSync(resultsDir)
    .map((name) => ({ name, m: name.match(re) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  return matches.map((x) =>
    JSON.parse(fs.readFileSync(path.join(resultsDir, x.name), "utf8")),
  );
}

function loadRowCounts(runDir) {
  const filteredPath = path.join(runDir, "image_review", "filtered_unflagged.json");
  if (!fs.existsSync(filteredPath)) {
    throw new Error(`filtered_unflagged.json does not exist: ${filteredPath}`);
  }
  const filtered = JSON.parse(fs.readFileSync(filteredPath, "utf8"));
  const m = new Map();
  for (const r of filtered.rows) m.set(r.rowIndex, r.ids.length);
  return m;
}

function totalIdsCount(items, rowCounts) {
  let s = 0;
  for (const it of items) s += rowCounts.get(it.rowIndex) ?? 1;
  return s;
}

function buildFinalClusters({ groups, resultsDir, rowCounts }) {
  const prefixCounter = new Map();
  const finalClusters = [];

  function nextId(category, subcategory) {
    const prefix = `${sanitizeIdPart(category)}_${sanitizeIdPart(subcategory)}`;
    const cur = (prefixCounter.get(prefix) ?? 0) + 1;
    prefixCounter.set(prefix, cur);
    const seq = String(cur).padStart(3, "0");
    return `${prefix}_${seq}`;
  }

  const sortedGroups = [...groups].sort((a, b) => a.groupId - b.groupId);

  for (const g of sortedGroups) {
    const parsed = parseGroupKey(g.groupKey);
    const category = stripBrackets(parsed.category);
    const subcategory = stripBrackets(parsed.subcategory);

    if (g.status === "singleton_confirmed") {
      const cid = nextId(category, subcategory);
      const countTotal = totalIdsCount(g.items, rowCounts);
      finalClusters.push({
        cluster_id: cid,
        source: "singleton",
        source_group_id: g.groupId,
        group_key: g.groupKey,
        size: 1,
        count_total: countTotal,
        is_purchase_candidate: countTotal >= PURCHASE_THRESHOLD,
        representative_attributes: g.items[0].attributes,
        items: g.items.map((it) => ({
          rowIndex: it.rowIndex,
          id: it.id,
          name: it.name,
        })),
      });
      continue;
    }

    const results = loadResultsForGroup(resultsDir, g.groupId);
    if (results.length === 0) {
      finalClusters.push({
        cluster_id: null,
        source: "pending_no_result",
        source_group_id: g.groupId,
        group_key: g.groupKey,
        size: g.items.length,
        count_total: totalIdsCount(g.items, rowCounts),
        is_purchase_candidate: false,
        representative_attributes: g.items[0].attributes,
        items: g.items.map((it) => ({
          rowIndex: it.rowIndex,
          id: it.id,
          name: it.name,
        })),
        note: "6-2 Agent の結果ファイルが未生成。再実行するか、groupId を確認",
      });
      continue;
    }

    const byRowIndex = new Map(g.items.map((it) => [it.rowIndex, it]));
    for (const res of results) {
      for (const sg of res.subgroups) {
        const items = sg.rowIndexes
          .map((ri) => byRowIndex.get(ri))
          .filter(Boolean);
        if (items.length === 0) continue;
        const cid = nextId(category, subcategory);
        const countTotal = totalIdsCount(items, rowCounts);
        finalClusters.push({
          cluster_id: cid,
          source: res.subgroups.length === 1 && results.length === 1 ? "agent_single_subgroup" : "agent_split",
          source_group_id: g.groupId,
          group_key: g.groupKey,
          size: items.length,
          count_total: countTotal,
          is_purchase_candidate: countTotal >= PURCHASE_THRESHOLD,
          representative_attributes: items[0].attributes,
          agent_reason: sg.reason ?? null,
          items: items.map((it) => ({
            rowIndex: it.rowIndex,
            id: it.id,
            name: it.name,
          })),
        });
      }
    }
  }

  return finalClusters;
}

function stripBrackets(v) {
  if (v == null) return null;
  if (v === "null") return null;
  if (typeof v === "string" && v.startsWith("[") && v.endsWith("]")) {
    return v.slice(1, -1);
  }
  return v;
}

function summarize(finalClusters) {
  const singleton = finalClusters.filter((c) => c.size === 1).length;
  const multi = finalClusters.filter((c) => c.size > 1).length;
  const purchase = finalClusters.filter((c) => c.is_purchase_candidate).length;
  const pending = finalClusters.filter(
    (c) => c.source === "pending_no_result",
  ).length;
  const totalRows = finalClusters.reduce((a, c) => a + c.size, 0);
  return {
    totalRows,
    clusterCount: finalClusters.length,
    singletonClusters: singleton,
    multiItemClusters: multi,
    pendingClusters: pending,
    purchaseCandidates: purchase,
    purchaseThreshold: PURCHASE_THRESHOLD,
  };
}

function main() {
  const { runDir } = parseArgs();
  const idDir = path.join(runDir, "identity_resolution");
  const clustersPath = path.join(idDir, "clusters.json");
  const resultsDir = path.join(idDir, "results");

  if (!fs.existsSync(clustersPath)) {
    throw new Error(`clusters.json does not exist: ${clustersPath}`);
  }
  const { groups } = JSON.parse(fs.readFileSync(clustersPath, "utf8"));
  const rowCounts = loadRowCounts(runDir);
  const finalClusters = buildFinalClusters({ groups, resultsDir, rowCounts });
  const summary = summarize(finalClusters);

  const outPath = path.join(idDir, "final_clusters.json");
  writeFileSafe(
    outPath,
    JSON.stringify({ summary, clusters: finalClusters }, null, 2) + "\n",
    "utf8",
  );
  console.log(JSON.stringify({ outPath, ...summary }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  parseGroupKey,
  buildFinalClusters,
  summarize,
  PURCHASE_THRESHOLD,
};
