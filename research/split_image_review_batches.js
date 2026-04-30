// 第 4 段階の画像除外: バッチ分割スクリプト。
// image_review/<INPUT_FILENAME> を BATCH_SIZE 件ずつ image_review/batches/batch_NNN.json に分割する。
//
// 使い方:
//   node research/split_image_review_batches.js <image_review_dir> [BATCH_SIZE] [INPUT_FILENAME]
//   BATCH_SIZE のデフォルト: 50
//   INPUT_FILENAME のデフォルト: all.json
//
// 例:
//   node research/split_image_review_batches.js research/runs/2026_04_16_06_46/image_review
//   node research/split_image_review_batches.js research/runs/2026_04_28_10_26/image_review 50 all_after_pdf_check.json

const fs = require('fs');
const path = require('path');
const { writeFileSafe } = require('./_safe_write');

function splitItemsIntoBatches(items, batchSize) {
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

function batchFileName(index) {
  return `batch_${String(index).padStart(3, '0')}.json`;
}

function main() {
  const [, , RUN_DIR_ARG, BATCH_SIZE_ARG, INPUT_FILENAME_ARG] = process.argv;
  if (!RUN_DIR_ARG) {
    console.error('Usage: node research/split_image_review_batches.js <image_review_dir> [BATCH_SIZE] [INPUT_FILENAME]');
    process.exit(1);
  }

  const RUN_DIR = path.resolve(RUN_DIR_ARG);
  const BATCH_SIZE = BATCH_SIZE_ARG ? parseInt(BATCH_SIZE_ARG, 10) : 50;
  if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1) {
    throw new Error(`BATCH_SIZE must be a positive integer: ${BATCH_SIZE_ARG}`);
  }
  const INPUT_FILENAME = INPUT_FILENAME_ARG || 'all.json';

  const ALL_PATH = path.join(RUN_DIR, INPUT_FILENAME);
  if (!fs.existsSync(ALL_PATH)) {
    console.error(`input not found: ${ALL_PATH}`);
    process.exit(1);
  }

  const all = JSON.parse(fs.readFileSync(ALL_PATH, 'utf8'));
  const items = all.items;
  const batchesDir = path.join(RUN_DIR, 'batches');
  fs.mkdirSync(batchesDir, { recursive: true });

  const batches = splitItemsIntoBatches(items, BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    const slice = batches[i];
    writeFileSafe(
      path.join(batchesDir, batchFileName(i)),
      JSON.stringify({ batch_id: i, items: slice }, null, 2),
    );
  }

  console.log(
    JSON.stringify(
      {
        source: ALL_PATH,
        total_items: items.length,
        total_batches: batches.length,
        batch_size: BATCH_SIZE,
        out_dir: batchesDir,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main();
}

module.exports = { splitItemsIntoBatches, batchFileName };
