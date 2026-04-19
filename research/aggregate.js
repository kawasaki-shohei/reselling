// 販売実績の集約 (aggregate_step) — 手順書の第 2 段階
//
// 生データを seller + title で集約し、同一商品の販売実績数を count として保持した
// タイトル順ソート TSV を出力する。後段 (第 3 段階 dictionary_expansion_step 以降) は
// 原則として生の raw JSON を入力にするが、本 TSV は人間が集約結果を目視するための
// 中間成果物として残す。
//
// 使い方:
//   node research/aggregate.js <input_raw_json> [output_tsv]
//
// 例:
//   node research/aggregate.js research/2026_04_16_06_46__mercari_14day_results.json
//   node research/aggregate.js research/xxx.json tmp/2026/04/19/all_items_sorted_from_20260416.tsv
//
// 出力 TSV 1 行フォーマット:
//   [count件] ¥price <TAB> seller_id <TAB> title <TAB> item_ids
//
//   - count: 同一 seller+title の販売実績数 (14 日以内の SOLD 件数)。1 の場合は省略
//   - price: 価格変動がなければ ¥N、あれば ¥min-max
//   - item_ids: 元 item id のカンマ区切り

const fs = require('fs');
const path = require('path');

const argInput = process.argv[2];
if (!argInput) {
  console.error('Usage: node research/aggregate.js <input_raw_json> [output_tsv]');
  process.exit(1);
}

const d = JSON.parse(fs.readFileSync(argInput, 'utf8'));

const map = new Map();
for (const it of d.items) {
  const key = (it.sellerId || '?') + '||' + (it.name || '');
  if (!map.has(key)) {
    map.set(key, {
      ids: [],
      price_min: Infinity,
      price_max: 0,
      seller: it.sellerId || '?',
      name: it.name || '',
    });
  }
  const rec = map.get(key);
  rec.ids.push(it.id);
  if (it.price < rec.price_min) rec.price_min = it.price;
  if (it.price > rec.price_max) rec.price_max = it.price;
}

const entries = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));

const lines = entries.map(e => {
  const pr = e.price_min === e.price_max ? `¥${e.price_min}` : `¥${e.price_min}-${e.price_max}`;
  const cnt = e.ids.length > 1 ? `[${e.ids.length}件] ` : '';
  return `${cnt}${pr}\t${e.seller}\t${e.name}\t${e.ids.join(',')}`;
});

// 出力先決定: 第 2 引数があればそれを使用。なければ tmp/YYYY/MM/DD/ 配下に自動配置
// - ディレクトリは作業日 (JST) 基準
// - ファイル名は入力ファイル名から取れる日付、取れなければ作業日
let outPath = process.argv[3];
if (!outPath) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  const workYmd = `${y}${m}${day}`;

  const inputBase = path.basename(argInput);
  const match = inputBase.match(/^(\d{4})_(\d{2})_(\d{2})/);
  const sourceYmd = match ? `${match[1]}${match[2]}${match[3]}` : workYmd;

  const baseDir = path.join('tmp', String(y), m, day);
  outPath = path.join(baseDir, `all_items_sorted_from_${sourceYmd}.tsv`);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'));

console.log(JSON.stringify({
  input: argInput,
  output: outPath,
  totalItems: d.items.length,
  uniqueRows: entries.length,
  coreClusters_count_ge_3: entries.filter(e => e.ids.length >= 3).length,
}, null, 2));
