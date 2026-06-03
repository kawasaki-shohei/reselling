#!/usr/bin/env node
// 判定対象 (flagged / unflagged) を本番の除外結果から抽出し、<RUN_DIR>/<phase>_all.json に書き出す。
//
// 除外判定は本番の exclude_by_keywords.js が生成する exclusion_output.json を入力にする
// (自前で除外を再計算しない)。これにより除外ロジックが本番と一致し、キーワード除外・
// 公式カテゴリ除外の追加・変更が精度チェックにも自動で反映される (二重実装による取りこぼし防止)。
//
// 精度チェックは「正規辞書のみ」の性能を測るため、入力 exclusion_output.json は
// exclude_by_keywords.js を --pending なし (暫定辞書を混ぜない) で実行して生成すること。
//
// 使い方:
//   node 01_prepare.js <EXCLUSION_OUTPUT_JSON> <RAW_JSON> <RUN_DIR> <PHASE>
//   PHASE = "flagged" | "unflagged"
//
// 例:
//   node procedures/exclude_by_keywords_precision_check/scripts/01_prepare.js \
//     procedures/exclude_by_keywords_precision_check/runs/2026-06-03_unflagged/exclusion/exclusion_output.json \
//     research/2026_05_15_10_00__mercari_14day_results.json \
//     procedures/exclude_by_keywords_precision_check/runs/2026-06-03_unflagged \
//     unflagged

const fs = require("fs");
const path = require("path");

const [, , EXCL_ARG, RAW_JSON_ARG, RUN_DIR_ARG, PHASE_ARG] = process.argv;

if (!EXCL_ARG || !RAW_JSON_ARG || !RUN_DIR_ARG || !PHASE_ARG) {
  console.error("Usage: node 01_prepare.js <EXCLUSION_OUTPUT_JSON> <RAW_JSON> <RUN_DIR> <flagged|unflagged>");
  process.exit(1);
}
if (PHASE_ARG !== "flagged" && PHASE_ARG !== "unflagged") {
  console.error(`PHASE must be "flagged" or "unflagged", got: ${PHASE_ARG}`);
  process.exit(1);
}

const EXCL = path.resolve(EXCL_ARG);
const RAW = path.resolve(RAW_JSON_ARG);
const RUN_DIR = path.resolve(RUN_DIR_ARG);
const PHASE = PHASE_ARG;

fs.mkdirSync(RUN_DIR, { recursive: true });
const imagesDir = path.join(RUN_DIR, "images");
fs.mkdirSync(imagesDir, { recursive: true });

// 本番の除外結果。rows は集約後の全行 + exclusion 印 (キーワード除外・カテゴリ除外を含む)。
const exclusion = JSON.parse(fs.readFileSync(EXCL, "utf8"));
const rows = exclusion.rows;

// thumbnail は exclusion_output.json に無いので生データから引く。
const raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
const thumbMap = new Map(raw.items.map((it) => [it.id, it.thumbnail]));

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
        source_exclusion: EXCL_ARG,
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
