#!/usr/bin/env node
// 判定対象 (flagged または unflagged) を抽出し、<RUN_DIR>/<phase>_all.json に書き出す。
//
// 使い方:
//   node 01_prepare.js <RAW_JSON_PATH> <RUN_DIR> <PHASE>
//   PHASE = "flagged" | "unflagged"
//
// 例:
//   node procedures/exclude_by_keywords_precision_check/scripts/01_prepare.js \
//     research/2026_04_16_06_46__mercari_14day_results.json \
//     procedures/exclude_by_keywords_precision_check/runs/2026-04-20_unflagged \
//     unflagged

const fs = require("fs");
const path = require("path");

const [, , RAW_JSON_ARG, RUN_DIR_ARG, PHASE_ARG] = process.argv;

if (!RAW_JSON_ARG || !RUN_DIR_ARG || !PHASE_ARG) {
  console.error("Usage: node 01_prepare.js <RAW_JSON> <RUN_DIR> <flagged|unflagged>");
  process.exit(1);
}
if (PHASE_ARG !== "flagged" && PHASE_ARG !== "unflagged") {
  console.error(`PHASE must be "flagged" or "unflagged", got: ${PHASE_ARG}`);
  process.exit(1);
}

const RAW = path.resolve(RAW_JSON_ARG);
const RUN_DIR = path.resolve(RUN_DIR_ARG);
const PHASE = PHASE_ARG;

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const CLASSIFIER_PATH = path.join(REPO_ROOT, "research", "_classifier.js");

const { loadDictionary, aggregateBySellerTitle, annotateRows } = require(CLASSIFIER_PATH);

fs.mkdirSync(RUN_DIR, { recursive: true });
fs.mkdirSync(path.join(RUN_DIR, "images"), { recursive: true });

const dict = loadDictionary(null);
const raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
const entries = aggregateBySellerTitle(raw.items);
const rows = annotateRows(entries, dict.keywords, dict.priority);

const thumbMap = new Map(raw.items.map((it) => [it.id, it.thumbnail]));
const imagesDir = path.join(RUN_DIR, "images");

const targets = rows.filter((r) => (PHASE === "flagged" ? r.exclusion !== null : r.exclusion === null));

const items = targets.map((r) => {
  const firstId = r.ids[0];
  const baseItem = {
    rowIndex: r.rowIndex,
    title: r.name,
    seller: r.seller,
    first_id: firstId,
    thumbnail_url: thumbMap.get(firstId) || null,
    image_path: path.join(imagesDir, `${r.rowIndex}.webp`),
    count: r.count,
    priceMin: r.priceMin,
    priceMax: r.priceMax,
  };
  if (PHASE === "flagged") {
    baseItem.primary = r.exclusion.primary;
    baseItem.matches = r.exclusion.matches;
  }
  return baseItem;
});

const outPath = path.join(RUN_DIR, `${PHASE}_all.json`);
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      meta: {
        phase: PHASE,
        source_raw: RAW_JSON_ARG,
        total: items.length,
        createdAt: new Date().toISOString(),
      },
      items,
    },
    null,
    2
  )
);

console.log(JSON.stringify({ phase: PHASE, total: items.length, output: outPath }, null, 2));
