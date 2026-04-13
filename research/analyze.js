/**
 * メルカリ売れ筋リサーチ — 分析スクリプト（第1段階 + 第2段階）
 *
 * 使い方:
 *   node analyze.js <入力ファイルパス>
 *
 *   例:
 *   node research/analyze.js research/2026_04_12_145958_mercari_14day_results.json
 *
 * 入力:
 *   collect.js が出力した JSON ファイル（items 配列を含む）
 *
 * 出力:
 *   同ディレクトリに日付付きで保存:
 *   - YYYY_MM_DD_HHMMSS_clusters.json（第1段階: 全クラスター）
 *   - YYYY_MM_DD_HHMMSS_candidates.json（第2段階: 3件以上のクラスター + メタデータ付き）
 *
 * 処理内容:
 *   第1段階: テキストクラスタリング（digit→N + 先頭28文字）
 *   第2段階: メタデータ付与（価格一貫性フラグ・カテゴリ多数決・出品者数記録）
 *   ※ 第3段階（禁止商品チェック・手動）はこのスクリプトの範囲外
 */

const fs = require('fs');
const path = require('path');

// === 引数チェック ===
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('使い方: node analyze.js <入力ファイルパス>');
  console.error('例: node research/analyze.js research/2026_04_12_145958_mercari_14day_results.json');
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`ファイルが見つかりません: ${inputPath}`);
  process.exit(1);
}

// === 入力読み込み ===
const raw = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const items = raw.items;
if (!items || !Array.isArray(items)) {
  console.error('items 配列が見つかりません');
  process.exit(1);
}

console.log(`入力: ${items.length}件`);

// === 第1段階: テキストクラスタリング ===
// procedures/mercari-research.md 準拠: digit→N + 先頭28文字
function normalize(name) {
  let t = name;
  t = t.replace(/[【】\[\]「」（）()♪✦•·※*!！★☆♡♥✓✨◆◇□■▲△▼〇●]/g, '');
  t = t.replace(/\d+/g, 'N');
  t = t.replace(/\s+/g, ' ').trim();
  return t.substring(0, 28);
}

const clusters = {};
for (const item of items) {
  const key = normalize(item.name);
  if (!clusters[key]) clusters[key] = [];
  clusters[key].push(item);
}

// 3件以上のクラスターのみ抽出
const hotClusters = Object.entries(clusters)
  .filter(([_, group]) => group.length >= 3)
  .sort((a, b) => b[1].length - a[1].length);

console.log(`クラスター総数: ${Object.keys(clusters).length}`);
console.log(`3件以上: ${hotClusters.length}クラスター`);

// === 第2段階: メタデータ付与 ===
const candidates = hotClusters.map(([key, group]) => {
  const prices = group.map(i => i.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRatio = maxPrice / minPrice;

  // カテゴリ多数決
  const catCounts = {};
  for (const item of group) {
    const cat = item.categoryId || 'unknown';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }
  const majorityCategory = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0][0];
  const categoryMismatchCount = group.filter(i => (i.categoryId || 'unknown') !== majorityCategory).length;

  // カテゴリ不一致のアイテムを除外した filtered グループ
  const filtered = categoryMismatchCount > 0
    ? group.filter(i => (i.categoryId || 'unknown') === majorityCategory)
    : group;

  // 出品者数（カテゴリフィルタ後の母集団で数える）
  const uniqueSellers = new Set(filtered.map(i => i.sellerId)).size;
  // 10人以上は競合過多としてフラグ付与（overview.md 準拠: 同商品の販売者数10人未満）
  const excluded = uniqueSellers >= 10;
  const exclusionReason = excluded ? 'sellers_10_or_more' : null;

  // 代表サムネイル（最大3枚、ユニーク）
  const seenThumbs = new Set();
  const thumbnails = [];
  for (const item of filtered) {
    if (item.thumbnail && !seenThumbs.has(item.thumbnail)) {
      seenThumbs.add(item.thumbnail);
      thumbnails.push(item.thumbnail);
      if (thumbnails.length >= 3) break;
    }
  }

  return {
    key,
    count: filtered.length,
    countBeforeFilter: group.length,
    categoryFiltered: categoryMismatchCount,
    minPrice,
    maxPrice,
    priceRatio: Math.round(priceRatio * 100) / 100,
    priceWarning: priceRatio > 2.0,
    uniqueSellers,
    excluded,
    exclusionReason,
    majorityCategory,
    thumbnails,
    representativeTitle: filtered[0]?.name || group[0]?.name,
    items: filtered.map(i => ({
      id: i.id,
      name: i.name,
      price: i.price,
      url: i.url,
      sellerId: i.sellerId,
      categoryId: i.categoryId,
      thumbnail: i.thumbnail
    }))
  };
});

// 3件未満になったクラスターを除外（カテゴリフィルタで減った場合）
const finalCandidates = candidates.filter(c => c.count >= 3);

console.log(`カテゴリフィルタ後: ${finalCandidates.length}クラスター`);
console.log(`価格警告フラグ: ${finalCandidates.filter(c => c.priceWarning).length}件`);
console.log(`出品者1人のみ: ${finalCandidates.filter(c => c.uniqueSellers === 1).length}件`);
console.log(`出品者2人以上: ${finalCandidates.filter(c => c.uniqueSellers >= 2).length}件`);
console.log(`出品者10人以上で除外フラグ: ${finalCandidates.filter(c => c.excluded).length}件`);
console.log(`有効候補（除外フラグなし）: ${finalCandidates.filter(c => !c.excluded).length}件`);

// === 出力 ===
const now = new Date();
const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const prefix = jst.toISOString().replace(/[-:T]/g, '_').slice(0, 17);
const outputDir = path.dirname(inputPath);

// 全クラスター（デバッグ用）
const clustersPath = path.join(outputDir, `${prefix}_clusters.json`);
fs.writeFileSync(clustersPath, JSON.stringify({
  totalItems: items.length,
  totalClusters: Object.keys(clusters).length,
  hotClusters: hotClusters.length,
  clusters: hotClusters.map(([key, group]) => ({
    key,
    count: group.length,
    sample: group[0]?.name
  }))
}, null, 2));

// 候補（Claude の第3段階入力用）
const candidatesPath = path.join(outputDir, `${prefix}_candidates.json`);
fs.writeFileSync(candidatesPath, JSON.stringify({
  inputFile: inputPath,
  totalItems: items.length,
  totalCandidates: finalCandidates.length,
  candidates: finalCandidates
}, null, 2));

console.log(`\n出力:`);
console.log(`  クラスター: ${clustersPath}`);
console.log(`  候補: ${candidatesPath}`);
console.log(`\n上位10クラスター:`);
for (const c of finalCandidates.slice(0, 10)) {
  const sellerInfo = c.uniqueSellers === 1 ? '出品者1人' : `出品者${c.uniqueSellers}人`;
  const warn = c.priceWarning ? ' ⚠️価格幅大' : '';
  const exc = c.excluded ? ' ❌除外' : '';
  console.log(`  [${c.count}件] ¥${c.minPrice}-¥${c.maxPrice} ${sellerInfo}${warn}${exc} | ${c.representativeTitle.substring(0, 40)}`);
}
