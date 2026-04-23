#!/usr/bin/env node
/*
 * build_visual_extraction_batches.js
 *
 * 第 5 段階 substep 5-3 (視覚属性抽出) のバッチ分割スクリプト。
 * 5-2 完了後の structured_full.json を 50 件ずつに分割し、各行に
 * 画像絶対パスと現在属性を埋め込んだバッチ JSON を書き出す。
 *
 * 使い方:
 *   node research/build_visual_extraction_batches.js <structured-full-path> <images-dir> <run-dir> [BATCH_SIZE]
 *
 * 例:
 *   node research/build_visual_extraction_batches.js \
 *     research/runs/2026_04_16_06_46/structured_extraction/structured_full.json \
 *     research/runs/2026_04_16_06_46/images \
 *     research/runs/2026_04_16_06_46
 *
 * BATCH_SIZE のデフォルト: 50
 *
 * 出力:
 *   <run-dir>/visual_extraction/batches/batch_NNN.json
 *
 * バッチ JSON のフォーマット:
 *   {
 *     "batchNum": 0,
 *     "items": [
 *       {
 *         "rowIndex": 163,
 *         "id": "m...",
 *         "name": "タイトル",
 *         "imagePath": "/abs/.../images/163.webp",
 *         "currentAttributes": {
 *           "category": ..., "subcategory": ..., "color": [...],
 *           "size": ..., "quantity": ...
 *         }
 *       },
 *       ...
 *     ]
 *   }
 */

const fs = require("node:fs");
const path = require("node:path");

function parseArgs() {
  const [, , structuredPath, imagesDir, runDir, batchSizeArg] = process.argv;
  if (!structuredPath || !imagesDir || !runDir) {
    console.error(
      "Usage: node research/build_visual_extraction_batches.js <structured-full-path> <images-dir> <run-dir> [BATCH_SIZE]",
    );
    process.exit(1);
  }
  const batchSize = batchSizeArg ? parseInt(batchSizeArg, 10) : 50;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`BATCH_SIZE must be a positive integer: ${batchSizeArg}`);
  }
  return { structuredPath, imagesDir, runDir, batchSize };
}

function buildBatches({ structuredPath, imagesDir, runDir, batchSize }) {
  const rows = JSON.parse(fs.readFileSync(structuredPath, "utf8"));
  const imagesDirAbs = path.resolve(imagesDir);
  const outDir = path.join(runDir, "visual_extraction", "batches");
  fs.mkdirSync(outDir, { recursive: true });

  const missingImages = [];
  const items = [];
  for (const r of rows) {
    const imagePath = path.join(imagesDirAbs, `${r.rowIndex}.webp`);
    if (!fs.existsSync(imagePath)) {
      missingImages.push(r.rowIndex);
      continue;
    }
    items.push({
      rowIndex: r.rowIndex,
      id: r.id,
      name: r.name,
      imagePath,
      currentAttributes: {
        category: r.category ?? null,
        subcategory: r.subcategory ?? null,
        color: r.color ?? null,
        size: r.size ?? null,
        quantity: r.quantity ?? null,
      },
    });
  }

  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batchNum = batches.length;
    const nnn = String(batchNum).padStart(3, "0");
    const batchItems = items.slice(i, i + batchSize);
    const outPath = path.join(outDir, `batch_${nnn}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify({ batchNum, items: batchItems }, null, 2) + "\n",
      "utf8",
    );
    batches.push({ batchNum, path: outPath, count: batchItems.length });
  }

  return {
    totalRows: rows.length,
    itemsWithImage: items.length,
    missingImages: missingImages.length,
    missingRowIndexes: missingImages.slice(0, 20),
    batchSize,
    batchCount: batches.length,
    outDir,
  };
}

if (require.main === module) {
  const args = parseArgs();
  const summary = buildBatches(args);
  console.log(JSON.stringify(summary, null, 2));
}

module.exports = { buildBatches };
