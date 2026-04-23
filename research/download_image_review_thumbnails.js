// 第 4 段階の画像除外: 画像並列 DL CLI。
// image_review/all.json の各 item の thumbnail_url を並列 DL して
// image_review/images/{rowIndex}.webp に保存する。
// 既存ファイル (size > 0) はスキップ (再実行で再 DL しない)。
//
// 使い方:
//   node research/download_image_review_thumbnails.js <image_review_dir> [CONCURRENT]
//   CONCURRENT のデフォルト: 30
//
// 例:
//   node research/download_image_review_thumbnails.js research/runs/2026_04_16_06_46/image_review

const fs = require('fs');
const path = require('path');
const { downloadThumbnails } = require('./_image_download');

function buildTasks(items) {
  return items
    .filter((it) => it.thumbnail_url)
    .map((it) => ({ rowIndex: it.rowIndex, url: it.thumbnail_url }));
}

async function main() {
  const [, , RUN_DIR_ARG, CONCURRENT_ARG] = process.argv;
  if (!RUN_DIR_ARG) {
    console.error('Usage: node research/download_image_review_thumbnails.js <image_review_dir> [CONCURRENT]');
    process.exit(1);
  }
  const concurrent = CONCURRENT_ARG ? parseInt(CONCURRENT_ARG, 10) : 30;
  if (!Number.isInteger(concurrent) || concurrent < 1) {
    throw new Error(`CONCURRENT must be a positive integer: ${CONCURRENT_ARG}`);
  }

  const RUN_DIR = path.resolve(RUN_DIR_ARG);
  const ALL_PATH = path.join(RUN_DIR, 'all.json');
  if (!fs.existsSync(ALL_PATH)) {
    console.error(`all.json not found: ${ALL_PATH}`);
    process.exit(1);
  }

  const all = JSON.parse(fs.readFileSync(ALL_PATH, 'utf8'));
  const tasks = buildTasks(all.items);
  const outDir = path.join(RUN_DIR, 'images');

  console.log(
    JSON.stringify(
      { totalItems: all.items.length, downloadTasks: tasks.length, concurrent, outDir },
      null,
      2,
    ),
  );

  const result = await downloadThumbnails({ tasks, outDir, concurrent });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { buildTasks };
