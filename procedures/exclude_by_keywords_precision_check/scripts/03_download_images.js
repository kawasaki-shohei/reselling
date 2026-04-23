#!/usr/bin/env node
// <RUN_DIR>/<phase>_all.json の各 item の thumbnail_url を並列 DL して
// <RUN_DIR>/images/{rowIndex}.webp に保存する。
//
// 使い方:
//   node 03_download_images.js <RUN_DIR> [CONCURRENT]
//   CONCURRENT のデフォルト: 30
//
// 例:
//   node procedures/exclude_by_keywords_precision_check/scripts/03_download_images.js \
//     procedures/exclude_by_keywords_precision_check/runs/2026-04-20_unflagged

const fs = require("fs");
const https = require("https");
const path = require("path");

const [, , RUN_DIR_ARG, CONCURRENT_ARG] = process.argv;

if (!RUN_DIR_ARG) {
  console.error("Usage: node 03_download_images.js <RUN_DIR> [CONCURRENT]");
  process.exit(1);
}

const RUN_DIR = path.resolve(RUN_DIR_ARG);
const CONCURRENT = CONCURRENT_ARG ? parseInt(CONCURRENT_ARG, 10) : 30;

const phaseFiles = fs.readdirSync(RUN_DIR).filter((f) => f.endsWith("_all.json"));
if (phaseFiles.length !== 1) {
  console.error(`Expected exactly one <phase>_all.json in ${RUN_DIR}`);
  process.exit(1);
}
const ALL_PATH = path.join(RUN_DIR, phaseFiles[0]);
const IMAGES_DIR = path.join(RUN_DIR, "images");
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const all = JSON.parse(fs.readFileSync(ALL_PATH, "utf8"));
const tasks = all.items
  .map((it) => ({ rowIndex: it.rowIndex, url: it.thumbnail_url }))
  .filter((t) => t.url);

let active = 0,
  idx = 0,
  done = 0,
  failed = 0;

function next() {
  while (active < CONCURRENT && idx < tasks.length) {
    const t = tasks[idx++];
    const p = path.join(IMAGES_DIR, `${t.rowIndex}.webp`);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) {
      done++;
      continue;
    }
    active++;
    https
      .get(t.url, (res) => {
        if (res.statusCode !== 200) {
          active--;
          failed++;
          done++;
          if (done % 100 === 0) console.log(`progress: ${done}/${tasks.length} (failed: ${failed})`);
          return next();
        }
        const f = fs.createWriteStream(p);
        res.pipe(f);
        f.on("finish", () => {
          f.close();
          active--;
          done++;
          if (done % 100 === 0) console.log(`progress: ${done}/${tasks.length} (failed: ${failed})`);
          next();
        });
      })
      .on("error", () => {
        active--;
        failed++;
        done++;
        next();
      });
  }
  if (done === tasks.length && active === 0) {
    console.log(JSON.stringify({ total: tasks.length, done, failed }, null, 2));
  }
}
next();
