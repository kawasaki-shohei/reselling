/**
 * メルカリ サムネ画像 並列ダウンロード
 *
 * 用途:
 *   procedures/cheapest-price-research.md の第 4 段階 4-1 で使う。
 *   検索 API 出力 (rivals/page_NN.json) の各 item の thumbnails[0] を
 *   ローカルディレクトリに保存する。
 *
 * 使い方:
 *   node cheapest-price-research/download-thumbnails.js <rivals_json> <output_dir>
 *
 * 例:
 *   node cheapest-price-research/download-thumbnails.js \
 *     cheapest-price-research/runs/2026_05_25_13_00/items/FD00101/rivals/page_01.json \
 *     cheapest-price-research/runs/2026_05_25_13_00/items/FD00101/thumbs/page_01
 *
 * 出力:
 *   output_dir 配下に {rank:02d}.jpg を rank 数だけ作成。
 *   既存ファイルはスキップ (再実行可能)。
 *
 * stdout に summary JSON:
 *   { total, downloaded, skipped, errors, error_details, output_dir }
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CONCURRENCY = 10;

const [, , rivalsJsonPath, outputDir] = process.argv;
if (!rivalsJsonPath || !outputDir) {
  console.error('Usage: node download-thumbnails.js <rivals_json> <output_dir>');
  process.exit(1);
}

const rivals = JSON.parse(fs.readFileSync(rivalsJsonPath, 'utf8'));
const items = rivals.items || [];

fs.mkdirSync(outputDir, { recursive: true });

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) return resolve('skipped');
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, res => {
      if (res.statusCode !== 200) {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve('downloaded')));
      file.on('error', err => {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
    });
    req.on('error', err => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });
    req.setTimeout(15000, () => {
      req.destroy(new Error(`timeout for ${url}`));
    });
  });
}

async function main() {
  const tasks = items
    .map(item => ({
      rank: item.rank,
      url: item.thumbnails?.[0],
      dest: path.join(outputDir, `${String(item.rank).padStart(2, '0')}.jpg`),
    }))
    .filter(t => t.url);

  let downloaded = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const chunk = tasks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map(t => download(t.url, t.dest)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        if (r.value === 'skipped') skipped++;
        else downloaded++;
      } else {
        errors.push({ rank: chunk[j].rank, error: r.reason.message });
      }
    }
  }

  console.log(JSON.stringify({
    total: tasks.length,
    downloaded,
    skipped,
    errors: errors.length,
    error_details: errors,
    output_dir: outputDir,
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
