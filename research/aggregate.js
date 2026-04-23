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
//   node research/aggregate.js research/xxx.json research/runs/2026_04_16_06_46/aggregate/all_items_sorted_from_20260416.tsv
//
// 出力 TSV 1 行フォーマット:
//   [count件] ¥price <TAB> seller_id <TAB> title <TAB> item_ids
//
//   - count: 同一 seller+title の販売実績数 (14 日以内の SOLD 件数)。1 の場合は省略
//   - price: 価格変動がなければ ¥N、あれば ¥min-max
//   - item_ids: 元 item id のカンマ区切り

const fs = require('fs');
const path = require('path');
const { extractTimestamp, getRunDir } = require('./_run_paths');

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

// 出力先決定: 第 2 引数があればそれを使用。なければ research/runs/<ts>/aggregate/ に配置
// <ts> (= YYYY_MM_DD_HH_MM) は生データファイル名から抽出する (_run_paths.extractTimestamp)
let outPath = process.argv[3];
if (!outPath) {
  const ts = extractTimestamp(argInput);
  const sourceYmd = ts.slice(0, 10).replace(/_/g, ''); // YYYYMMDD
  const baseDir = getRunDir(argInput, 'aggregate');
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
