// Mercari カテゴリマスタの生データ (indexedDB master / itemCategories の getAll 結果) から、
// 除外判定に必要なフィールドだけを抽出した実運用版 mercari_categories.json を生成する。
//
// 取得 (ブラウザ実行) の手順は ./README.md を参照。本スクリプトは取得後の「抽出」専用。
// Node 単体で動く (ブラウザ不要)。
//
// 使い方:
//   node procedures/exclude_by_category/extract_category_master.js \
//     procedures/exclude_by_category/category_master/mercari_categories_raw.json \
//     procedures/exclude_by_category/category_master/mercari_categories.json \
//     [fetchedAt(YYYY-MM-DD)]
//
// 第 3 引数 fetchedAt を省略した場合、raw に取得日があればそれを、無ければ '(要手動更新)' を入れる
// (抽出実行日 ≠ 取得日のため、抽出日を自動で入れない)。

const fs = require('fs');

const [, , RAW_PATH, OUT_PATH, FETCHED_AT] = process.argv;
if (!RAW_PATH || !OUT_PATH) {
  console.error('Usage: node extract_category_master.js <raw.json> <out.json> [fetchedAt]');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
const cats = raw.categories;
const byId = new Map(cats.map((c) => [String(c.id), c]));

// 親 (parentCategoryId) を辿った最上位カテゴリ名。rootCategoryName の正しさを検証するために使う。
function lineageRoot(c) {
  let cur = c;
  for (let guard = 0; guard < 12; guard++) {
    const pid = cur.parentCategoryId;
    const nxt = pid ? byId.get(String(pid)) : null;
    if (!nxt) return cur.name;
    cur = nxt;
  }
  return cur.name;
}

let mismatch = 0;
const slim = cats.map((c) => {
  const rootName = c.rootCategoryName || c.name; // 最上位カテゴリは自身名で埋める
  if (lineageRoot(c) !== rootName) mismatch++;
  return {
    id: c.id,
    name: c.name,
    level: c.level,
    parentCategoryId: c.parentCategoryId,
    parentCategoryName: c.parentCategoryName,
    rootCategoryId: c.rootCategoryId,
    rootCategoryName: rootName,
    hasChild: c.hasChild || false,
  };
});

// 除外判定は rootCategoryName を信頼するため、親辿りと不一致があると除外がずれる。検出したら止める。
if (mismatch > 0) {
  console.error(`ERROR: rootCategoryName と親辿りの不一致が ${mismatch} 件。マスタの整合性に問題があるため中断する。`);
  process.exit(1);
}

const fetchedAt = FETCHED_AT || raw.fetchedAt || (raw.meta && raw.meta.fetchedAt) || '(要手動更新)';

const out = {
  meta: {
    source: "jp.mercari.com indexedDB 'master' DB / itemCategories ストア",
    method: '出品ページ(/sell/create)を開くとフロントが item_categories を master DB に書き込む。それを getAll で取得 (詳細は ../README.md)',
    fetchedAt,
    count: slim.length,
    note: '出品カテゴリの公式マスタ(抽出版)。collect.js が各商品に保存する categoryId を、このマスタで階層(rootCategoryName 等)に解決する。生データは mercari_categories_raw.json。',
  },
  categories: slim,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
console.log(`抽出完了: ${OUT_PATH} (${slim.length}件, fetchedAt=${fetchedAt})`);
