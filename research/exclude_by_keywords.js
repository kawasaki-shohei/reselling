// キーワードベースで各行に除外フラグを付与する (手順書の第 4 段階 keyword_exclusion_step)
//
// 使い方:
//   node research/exclude_by_keywords.js <input_raw_json> [output_dir] [--pending <keywords_pending.json>]
//
// 例:
//   node research/exclude_by_keywords.js research/2026_04_16_06_46__mercari_14day_results.json
//   node research/exclude_by_keywords.js research/xxx.json research/runs/2026_04_16_06_46/exclusion_final \
//     --pending research/runs/2026_04_16_06_46/dict_expansion/keywords_pending.json
//
// 入力: research/collect.js の出力 JSON (items 配列を含む)
// 出力:
//   <output_dir>/exclusion_output.json (全 unique row と仮フラグ)
//   <output_dir>/exclusion_stats.md (統計サマリー)
//
// 辞書: procedures/exclude_by_keywords/keywords.json (正規辞書、定期更新対象)
// 共通ロジック: research/_classifier.js

const fs = require('fs');
const path = require('path');
const { loadDictionary, aggregateBySellerTitle, annotateRows } = require('./_classifier');
const { getRunDir } = require('./_run_paths');
const { writeFileSafe } = require('./_safe_write');

// 引数処理: <input_raw_json> [output_dir] [--pending <keywords_pending.json>]
const argv = process.argv.slice(2);
const positional = [];
let PENDING_PATH = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--pending') {
    PENDING_PATH = argv[i + 1];
    i++;
  } else {
    positional.push(argv[i]);
  }
}
const argInput = positional[0];
if (!argInput) {
  console.error('Usage: node research/exclude_by_keywords.js <input_raw_json> [output_dir] [--pending <keywords_pending.json>]');
  process.exit(1);
}
const INPUT = argInput;

const dict = loadDictionary(PENDING_PATH);

// 出力先: positional[1] があればそれを使用、なければ research/runs/<ts>/exclusion_final/
const OUT_DIR = positional[1] || getRunDir(INPUT, 'exclusion_final');
fs.mkdirSync(OUT_DIR, { recursive: true });

const OUT_JSON = path.join(OUT_DIR, 'exclusion_output.json');
const OUT_STATS = path.join(OUT_DIR, 'exclusion_stats.md');

const d = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const items = d.items;
const entries = aggregateBySellerTitle(items);
const rows = annotateRows(entries, dict.keywords, dict.priority);

const stats = {
  total_items: items.length,
  unique_rows: entries.length,
  unflagged: 0,
  by_category: {},
};
for (const p of dict.priority) stats.by_category[p] = 0;
for (const r of rows) {
  if (r.exclusion === null) stats.unflagged += 1;
  else stats.by_category[r.exclusion.primary] += 1;
}

const out = {
  meta: {
    step: 'keyword_exclusion_step',
    source: INPUT,
    totalItems: items.length,
    uniqueRows: entries.length,
    createdAt: new Date().toISOString(),
    classifier: 'keyword-match v1 (includes-based)',
    dictPath: path.relative(path.join(__dirname, '..'), dict.dictPath),
    pendingPath: dict.pendingPath ? path.relative(path.join(__dirname, '..'), dict.pendingPath) : null,
    priority: dict.priority,
    note: '部分文字列マッチのため一般語の誤爆あり (想定誤判定率 6%)。辞書改善で対応。',
  },
  stats,
  rows,
};

writeFileSafe(OUT_JSON, JSON.stringify(out, null, 2));

let md = `# キーワード除外 (keyword_exclusion_step) 統計サマリー\n\n`;
md += `- 入力: \`${INPUT}\`\n`;
md += `- 辞書: \`${out.meta.dictPath}\`\n`;
if (out.meta.pendingPath) md += `- 暫定辞書: \`${out.meta.pendingPath}\`\n`;
md += `- 総アイテム数: ${items.length}\n`;
md += `- ユニーク行数 (seller+title): ${entries.length}\n`;
md += `- 生成日時: ${new Date().toISOString()}\n\n`;
md += `## カテゴリ別件数 (primary のみ)\n\n`;
md += `| カテゴリ | 件数 | 割合 |\n|---|---|---|\n`;
for (const p of dict.priority) {
  const n = stats.by_category[p];
  md += `| ${p} | ${n} | ${((n / entries.length) * 100).toFixed(1)}% |\n`;
}
md += `| **unflagged (仕入れ候補)** | **${stats.unflagged}** | **${((stats.unflagged / entries.length) * 100).toFixed(1)}%** |\n\n`;
md += `## 精度の目安 (2026-04-18 検証)\n\n`;
md += `- 層別サンプリング 150 件で検証: 精度 **92.7%**、誤判定 (救済対象) **6.0%**、判別困難 **1.3%**\n`;
md += `- 誤判定は一般語の部分文字列マッチによる誤爆が主 (例: マカロン→マカ、ギンガム→ガム、ラッシュガード→シュガ)\n`;
md += `- primary 決定の優先度順: ${dict.priority.join(' > ')}\n`;
md += `- 複数カテゴリに該当した行は matches に全マッチを保持\n`;
md += `- 辞書改善と精度確認の運用は \`docs/research/mercari/exclude_by_keywords_precision_check.md\` を参照\n`;

writeFileSafe(OUT_STATS, md);

console.log(JSON.stringify(stats, null, 2));
console.log(`\nsaved: ${OUT_JSON}`);
console.log(`saved: ${OUT_STATS}`);
