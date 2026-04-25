// 第 4 段階の画像除外: 判定対象抽出スクリプト。
// exclusion_output.json の unflagged 行 (exclusion === null) のみを取り出し、
// 生データの thumbnail と join して image_review/all.json として書き出す。
// 同時に、後段の _image_download.js が読むための tasks 形式を含める。
//
// 使い方:
//   node research/prepare_image_review.js <raw.json> [output_dir]
//
// 例:
//   node research/prepare_image_review.js research/2026_04_16_06_46__mercari_14day_results.json
//
// デフォルトでは:
//   - exclusion_output.json: research/runs/<ts>/exclusion_final/exclusion_output.json
//   - 出力先 output_dir: research/runs/<ts>/image_review/
//   <ts> は raw.json のファイル名から抽出 (_run_paths.js を参照)。

const fs = require('fs');
const path = require('path');
const { extractTimestamp, getRunDir } = require('./_run_paths');
const { writeFileSafe } = require('./_safe_write');

function buildAllItems({ exclusionRows, rawItems, imagesDir }) {
  const thumbMap = new Map(rawItems.map((it) => [it.id, it.thumbnail]));
  const items = [];
  for (const r of exclusionRows) {
    if (r.exclusion !== null) continue;
    const firstId = r.ids && r.ids[0];
    items.push({
      rowIndex: r.rowIndex,
      title: r.name,
      seller: r.seller,
      first_id: firstId,
      thumbnail_url: firstId ? thumbMap.get(firstId) || null : null,
      image_path: path.join(imagesDir, `${r.rowIndex}.webp`),
      count: r.count,
      priceMin: r.priceMin,
      priceMax: r.priceMax,
    });
  }
  return items;
}

function main() {
  const [, , RAW_ARG, OUT_DIR_ARG] = process.argv;
  if (!RAW_ARG) {
    console.error('Usage: node research/prepare_image_review.js <raw.json> [output_dir]');
    process.exit(1);
  }

  const RAW = path.resolve(RAW_ARG);
  const ts = extractTimestamp(RAW_ARG);
  const EXCLUSION = path.resolve(getRunDir(RAW_ARG, 'exclusion_final'), 'exclusion_output.json');
  const OUT_DIR = OUT_DIR_ARG ? path.resolve(OUT_DIR_ARG) : path.resolve(getRunDir(RAW_ARG, 'image_review'));

  if (!fs.existsSync(EXCLUSION)) {
    console.error(`exclusion_output.json not found: ${EXCLUSION}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const imagesDir = path.join(OUT_DIR, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  const exclusionDoc = JSON.parse(fs.readFileSync(EXCLUSION, 'utf8'));
  const rawDoc = JSON.parse(fs.readFileSync(RAW, 'utf8'));

  const items = buildAllItems({
    exclusionRows: exclusionDoc.rows,
    rawItems: rawDoc.items,
    imagesDir,
  });

  const out = {
    meta: {
      step: 'image_exclusion_step',
      sub: 'prepare',
      ts,
      source_raw: path.relative(process.cwd(), RAW),
      source_exclusion: path.relative(process.cwd(), EXCLUSION),
      total: items.length,
      with_thumbnail: items.filter((i) => i.thumbnail_url).length,
      without_thumbnail: items.filter((i) => !i.thumbnail_url).length,
      createdAt: new Date().toISOString(),
    },
    items,
  };

  const outPath = path.join(OUT_DIR, 'all.json');
  writeFileSafe(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out.meta, output: outPath }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { buildAllItems };
