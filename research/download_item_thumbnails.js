#!/usr/bin/env node
/*
 * download_item_thumbnails.js
 *
 * 第 5 段階 substep 5-3 (視覚属性抽出) の前準備。
 * structured_full.json の各行に対応する thumbnail を生データから引いて、
 * 並列 DL で <output-dir>/{rowIndex}.webp に保存する。
 *
 * 使い方:
 *   node research/download_item_thumbnails.js <structured-full-path> <raw-data-path> <output-dir> [CONCURRENT]
 *
 * 例:
 *   node research/download_item_thumbnails.js \
 *     research/runs/2026_04_16_06_46/structured_extraction/structured_full.json \
 *     research/2026_04_16_06_46__mercari_14day_results.json \
 *     research/runs/2026_04_16_06_46/images
 *
 * CONCURRENT のデフォルト: 30
 * 既に <output-dir>/{rowIndex}.webp が存在しサイズ > 0 の場合はスキップ (再実行で上書きしない)
 */

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

function parseArgs() {
  const [, , structuredPath, rawPath, outDir, concurrentArg] = process.argv;
  if (!structuredPath || !rawPath || !outDir) {
    console.error(
      "Usage: node research/download_item_thumbnails.js <structured-full-path> <raw-data-path> <output-dir> [CONCURRENT]",
    );
    process.exit(1);
  }
  const concurrent = concurrentArg ? parseInt(concurrentArg, 10) : 30;
  if (!Number.isInteger(concurrent) || concurrent < 1) {
    throw new Error(`CONCURRENT must be a positive integer: ${concurrentArg}`);
  }
  return { structuredPath, rawPath, outDir, concurrent };
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function buildTasks(structuredPath, rawPath) {
  const rows = loadJson(structuredPath);
  const raw = loadJson(rawPath);
  const byId = new Map();
  for (const it of raw.items) byId.set(it.id, it);

  const tasks = [];
  const missing = [];
  const nullThumb = [];
  for (const r of rows) {
    const it = byId.get(r.id);
    if (!it) {
      missing.push(r.rowIndex);
      continue;
    }
    if (!it.thumbnail) {
      nullThumb.push(r.rowIndex);
      continue;
    }
    tasks.push({ rowIndex: r.rowIndex, url: it.thumbnail });
  }
  return { tasks, missing, nullThumb, totalRows: rows.length };
}

function downloadAll({ tasks, outDir, concurrent }) {
  fs.mkdirSync(outDir, { recursive: true });
  return new Promise((resolve) => {
    let active = 0;
    let idx = 0;
    let done = 0;
    let failed = 0;
    let skipped = 0;
    const failures = [];

    function finalize() {
      if (done + skipped === tasks.length && active === 0) {
        resolve({ total: tasks.length, done, skipped, failed, failures });
      }
    }

    function next() {
      while (active < concurrent && idx < tasks.length) {
        const t = tasks[idx++];
        const outPath = path.join(outDir, `${t.rowIndex}.webp`);
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
          skipped++;
          finalize();
          continue;
        }
        active++;
        https
          .get(t.url, (res) => {
            if (res.statusCode !== 200) {
              active--;
              failed++;
              done++;
              failures.push({ rowIndex: t.rowIndex, status: res.statusCode });
              res.resume();
              if ((done + skipped) % 100 === 0) {
                console.log(
                  `progress: ${done + skipped}/${tasks.length} (done: ${done}, skipped: ${skipped}, failed: ${failed})`,
                );
              }
              finalize();
              next();
              return;
            }
            const f = fs.createWriteStream(outPath);
            res.pipe(f);
            f.on("finish", () => {
              f.close();
              active--;
              done++;
              if ((done + skipped) % 100 === 0) {
                console.log(
                  `progress: ${done + skipped}/${tasks.length} (done: ${done}, skipped: ${skipped}, failed: ${failed})`,
                );
              }
              finalize();
              next();
            });
            f.on("error", (err) => {
              active--;
              failed++;
              done++;
              failures.push({ rowIndex: t.rowIndex, error: err.message });
              finalize();
              next();
            });
          })
          .on("error", (err) => {
            active--;
            failed++;
            done++;
            failures.push({ rowIndex: t.rowIndex, error: err.message });
            finalize();
            next();
          });
      }
      if (tasks.length === 0) resolve({ total: 0, done: 0, skipped: 0, failed: 0, failures: [] });
    }

    next();
  });
}

async function main() {
  const { structuredPath, rawPath, outDir, concurrent } = parseArgs();
  const { tasks, missing, nullThumb, totalRows } = buildTasks(
    structuredPath,
    rawPath,
  );
  console.log(
    JSON.stringify(
      {
        totalRows,
        tasks: tasks.length,
        missing_in_raw: missing.length,
        thumbnail_null: nullThumb.length,
        concurrent,
        outDir,
      },
      null,
      2,
    ),
  );
  const result = await downloadAll({ tasks, outDir, concurrent });
  console.log(JSON.stringify(result, null, 2));
  if (missing.length > 0) {
    console.error(`WARN: ${missing.length} rowIndex not found in raw data`);
  }
  if (nullThumb.length > 0) {
    console.error(`WARN: ${nullThumb.length} rowIndex have null thumbnail`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { buildTasks, downloadAll };
