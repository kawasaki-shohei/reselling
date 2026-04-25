#!/usr/bin/env node
/*
 * assign_final_cluster_ids_skip_identity.js
 *
 * 6-2 同一商品判定 (Sonnet による subgroup 分割) を飛ばす簡易版。
 * 6-1 の clusters.json を読み、pending グループを分割せず「1 グループ = 1 クラスタ」として
 * final_clusters_alt.json を書き出す。
 *
 * 目的: 6-2 で大量に分割されて仕入れ候補が少なく出た場合のリカバリ。
 * 6 軸 (category/subcategory/color/size/quantity/pattern) が一致するだけで
 * 別商品が混ざりうる点は仕入れ判断者が目視で捌く前提。
 *
 * 使い方:
 *   node research/assign_final_cluster_ids_skip_identity.js <run-dir>
 *
 * 入力:
 *   <run-dir>/identity_resolution/clusters.json (6-1 出力)
 *
 * 出力:
 *   <run-dir>/identity_resolution/final_clusters_alt.json
 */

const fs = require("node:fs");
const path = require("node:path");
const { writeFileSafe } = require("./_safe_write");

const PURCHASE_THRESHOLD = 3;

function parseArgs() {
  const [, , runDirArg] = process.argv;
  if (!runDirArg) {
    console.error(
      "Usage: node research/assign_final_cluster_ids_skip_identity.js <run-dir>",
    );
    process.exit(1);
  }
  return { runDir: runDirArg.replace(/\/$/, "") };
}

function sanitizeIdPart(v) {
  if (v == null) return "";
  return String(v).trim().replace(/[\s/\\|]+/g, "-");
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

function stripBrackets(v) {
  if (v == null) return null;
  if (v === "null") return null;
  if (typeof v === "string" && v.startsWith("[") && v.endsWith("]")) {
    return v.slice(1, -1);
  }
  return v;
}

function buildFinalClusters(groups) {
  const prefixCounter = new Map();
  const finalClusters = [];
  const sorted = [...groups].sort((a, b) => a.groupId - b.groupId);

  for (const g of sorted) {
    const parsed = parseGroupKey(g.groupKey);
    const category = stripBrackets(parsed.category);
    const subcategory = stripBrackets(parsed.subcategory);
    const prefix = `${sanitizeIdPart(category)}_${sanitizeIdPart(subcategory)}`;
    const seq = (prefixCounter.get(prefix) ?? 0) + 1;
    prefixCounter.set(prefix, seq);
    const cluster_id = `${prefix}_${String(seq).padStart(3, "0")}`;

    finalClusters.push({
      cluster_id,
      source: g.status === "singleton_confirmed" ? "singleton" : "pending_unsplit",
      source_group_id: g.groupId,
      group_key: g.groupKey,
      size: g.items.length,
      is_purchase_candidate: g.items.length >= PURCHASE_THRESHOLD,
      representative_attributes: g.items[0].attributes,
      items: g.items.map((it) => ({
        rowIndex: it.rowIndex,
        id: it.id,
        name: it.name,
      })),
    });
  }

  return finalClusters;
}

function summarize(finalClusters) {
  const singleton = finalClusters.filter((c) => c.size === 1).length;
  const multi = finalClusters.filter((c) => c.size > 1).length;
  const purchase = finalClusters.filter((c) => c.is_purchase_candidate).length;
  const totalRows = finalClusters.reduce((a, c) => a + c.size, 0);
  return {
    totalRows,
    clusterCount: finalClusters.length,
    singletonClusters: singleton,
    multiItemClusters: multi,
    purchaseCandidates: purchase,
    purchaseThreshold: PURCHASE_THRESHOLD,
    note: "6-2 Sonnet 判定を飛ばし、6-1 pending グループを未分割のまま 1 クラスタ化",
  };
}

function main() {
  const { runDir } = parseArgs();
  const idDir = path.join(runDir, "identity_resolution");
  const clustersPath = path.join(idDir, "clusters.json");
  if (!fs.existsSync(clustersPath)) {
    throw new Error(`clusters.json does not exist: ${clustersPath}`);
  }
  const { groups } = JSON.parse(fs.readFileSync(clustersPath, "utf8"));
  const finalClusters = buildFinalClusters(groups);
  const summary = summarize(finalClusters);

  const outPath = path.join(idDir, "final_clusters_alt.json");
  if (fs.existsSync(outPath)) {
    throw new Error(
      `output file already exists (共通原則 1: 不変): ${outPath}`,
    );
  }
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

module.exports = { buildFinalClusters, summarize, PURCHASE_THRESHOLD };
