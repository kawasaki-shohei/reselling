#!/usr/bin/env node
// <RUN_DIR>/<phase>_all.json を BATCH_SIZE 件ずつ <RUN_DIR>/batches/batch_NNN.json に分割する。
//
// 使い方:
//   node 02_split_batches.js <RUN_DIR> [BATCH_SIZE]
//   BATCH_SIZE のデフォルト: 50
//
// 例:
//   node procedures/exclude_by_keywords_precision_check/scripts/02_split_batches.js \
//     procedures/exclude_by_keywords_precision_check/runs/2026-04-20_unflagged

const fs = require("fs");
const path = require("path");

const [, , RUN_DIR_ARG, BATCH_SIZE_ARG] = process.argv;

if (!RUN_DIR_ARG) {
  console.error("Usage: node 02_split_batches.js <RUN_DIR> [BATCH_SIZE]");
  process.exit(1);
}

const RUN_DIR = path.resolve(RUN_DIR_ARG);
const BATCH_SIZE = BATCH_SIZE_ARG ? parseInt(BATCH_SIZE_ARG, 10) : 50;

const phaseFiles = fs.readdirSync(RUN_DIR).filter((f) => f.endsWith("_all.json"));
if (phaseFiles.length !== 1) {
  console.error(`Expected exactly one <phase>_all.json in ${RUN_DIR}, found ${phaseFiles.length}`);
  process.exit(1);
}
const ALL_PATH = path.join(RUN_DIR, phaseFiles[0]);

const all = JSON.parse(fs.readFileSync(ALL_PATH, "utf8"));
const items = all.items;
const batchesDir = path.join(RUN_DIR, "batches");
fs.mkdirSync(batchesDir, { recursive: true });

const totalBatches = Math.ceil(items.length / BATCH_SIZE);
for (let i = 0; i < totalBatches; i++) {
  const slice = items.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
  const NNN = String(i).padStart(3, "0");
  fs.writeFileSync(
    path.join(batchesDir, `batch_${NNN}.json`),
    JSON.stringify({ batch_id: i, items: slice }, null, 2)
  );
}

console.log(
  JSON.stringify(
    { source: phaseFiles[0], total_items: items.length, total_batches: totalBatches, batch_size: BATCH_SIZE },
    null,
    2
  )
);
