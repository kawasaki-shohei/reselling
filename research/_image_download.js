// 内部ヘルパー: thumbnail URL → webp 並列 DL の共通モジュール (CLI ではない)。
// 第 4 段階の画像除外と、その他の画像 DL 用途で共用する想定。
//
// 使い方 (他スクリプトから require):
//   const { downloadThumbnails } = require('./_image_download');
//   const result = await downloadThumbnails({
//     tasks: [{ rowIndex: 0, url: 'https://...' }, ...],
//     outDir: '/abs/path/to/images',
//     concurrent: 30,
//   });
//
// tasks: { rowIndex, url } の配列。url が falsy のものはスキップしない (failures に積む) ため、
//        呼び出し側で事前フィルタすること。
// 既存ファイル (size > 0) はスキップして再 DL しない。

const fs = require('fs');
const https = require('https');
const path = require('path');

function downloadThumbnails({ tasks, outDir, concurrent = 30 }) {
  fs.mkdirSync(outDir, { recursive: true });

  return new Promise((resolve) => {
    if (tasks.length === 0) {
      resolve({ total: 0, done: 0, skipped: 0, failed: 0, failures: [] });
      return;
    }

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

    function logProgress() {
      if ((done + skipped) % 100 === 0) {
        console.log(
          `progress: ${done + skipped}/${tasks.length} (done: ${done}, skipped: ${skipped}, failed: ${failed})`,
        );
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

        if (!t.url) {
          failed++;
          done++;
          failures.push({ rowIndex: t.rowIndex, error: 'missing_url' });
          logProgress();
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
              logProgress();
              finalize();
              next();
              return;
            }
            const f = fs.createWriteStream(outPath);
            res.pipe(f);
            f.on('finish', () => {
              f.close();
              active--;
              done++;
              logProgress();
              finalize();
              next();
            });
            f.on('error', (err) => {
              active--;
              failed++;
              done++;
              failures.push({ rowIndex: t.rowIndex, error: err.message });
              finalize();
              next();
            });
          })
          .on('error', (err) => {
            active--;
            failed++;
            done++;
            failures.push({ rowIndex: t.rowIndex, error: err.message });
            finalize();
            next();
          });
      }
    }

    next();
  });
}

module.exports = { downloadThumbnails };
