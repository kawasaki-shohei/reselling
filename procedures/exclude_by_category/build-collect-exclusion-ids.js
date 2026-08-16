// 除外カテゴリの正本 (collect-excluded-categories.json) とカテゴリマスタから、collect 段階で
// 捨てる categoryId を全て展開し、research/collect.js の生成ブロックを書き換える。
//
// collect.js はブラウザの browser_evaluate 上で動き fs を使えないため、判定に必要な ID を
// ソースへ直接埋め込む方式を採る。手書きと生成物が混ざらないよう、生成部分はマーカーで囲む。
//
// 使い方:
//   node procedures/exclude_by_category/build-collect-exclusion-ids.js
//   node procedures/exclude_by_category/build-collect-exclusion-ids.js --check   // 書き換えず差分の有無だけ見る
//
// 正本を編集したら必ず本スクリプトを実行する。--check は CI や作業前確認用。

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SOURCE_LIST_PATH = path.join(__dirname, 'collect-excluded-categories.json');
const CATEGORY_MASTER_PATH = path.join(__dirname, 'category_master', 'mercari_categories.json');
const COLLECT_SCRIPT_PATH = path.join(REPO_ROOT, 'research', 'collect.js');

const BLOCK_BEGIN = '  // <<< GENERATED:EXCLUDED_CATEGORY_IDS — build-collect-exclusion-ids.js が生成する。手で編集しない >>>';
const BLOCK_END = '  // <<< END GENERATED:EXCLUDED_CATEGORY_IDS >>>';

// ---------------------------------------------------------------------------
// 展開ロジック (ファイル I/O を持たない。テストはここだけを対象にする)
// ---------------------------------------------------------------------------

function buildChildIndex(categories) {
  const childrenByParentId = new Map();
  for (const category of categories) {
    const parentId = String(category.parentCategoryId ?? '');
    if (!parentId) continue;
    if (!childrenByParentId.has(parentId)) childrenByParentId.set(parentId, []);
    childrenByParentId.get(parentId).push(String(category.id));
  }
  return childrenByParentId;
}

function collectSubtreeIds(rootId, childrenByParentId) {
  const collected = new Set([String(rootId)]);
  const pending = [String(rootId)];
  while (pending.length > 0) {
    for (const childId of childrenByParentId.get(pending.pop()) ?? []) {
      if (collected.has(childId)) continue;
      collected.add(childId);
      pending.push(childId);
    }
  }
  return collected;
}

// 正本の name / level がマスタと食い違っていたら、カテゴリ体系が変わったのに正本が
// 追随できていない状態。黙って古い ID で収集すると生データが欠損するので中断させる。
function verifyEntryMatchesMaster(entry, categoryById) {
  const master = categoryById.get(String(entry.id));
  if (!master) return `id=${entry.id} (${entry.name}) がカテゴリマスタに存在しない`;
  if (master.name !== entry.name) {
    return `id=${entry.id} の名前が不一致 (正本: ${entry.name} / マスタ: ${master.name})`;
  }
  const masterLevel = master.level === undefined ? '0' : String(master.level);
  if (masterLevel !== String(entry.level)) {
    return `id=${entry.id} (${entry.name}) の階層が不一致 (正本: ${entry.level} / マスタ: ${masterLevel})`;
  }
  return null;
}

/**
 * 正本の entries を categoryId 集合へ展開する。
 * entry は自身と全子孫を除外対象にし、except があればその部分木だけ対象から外す。
 * 戻り値: { categoryIds: string[] (昇順), errors: string[] }
 */
function expandExclusionCategoryIds({ entries, categories }) {
  const categoryById = new Map(categories.map((c) => [String(c.id), c]));
  const childrenByParentId = buildChildIndex(categories);
  const errors = [];

  const seenEntryIds = new Set();
  for (const entry of entries) {
    if (seenEntryIds.has(String(entry.id))) errors.push(`id=${entry.id} (${entry.name}) が正本に重複している`);
    seenEntryIds.add(String(entry.id));

    const mismatch = verifyEntryMatchesMaster(entry, categoryById);
    if (mismatch) errors.push(mismatch);

    // except は id と name しか持たない (階層は entry からの相対関係で検証する)
    for (const exception of entry.except ?? []) {
      const exceptionMaster = categoryById.get(String(exception.id));
      if (!exceptionMaster) {
        errors.push(`id=${entry.id} (${entry.name}) の except id=${exception.id} がカテゴリマスタに存在しない`);
        continue;
      }
      if (exceptionMaster.name !== exception.name) {
        errors.push(
          `id=${entry.id} (${entry.name}) の except id=${exception.id} の名前が不一致 ` +
            `(正本: ${exception.name} / マスタ: ${exceptionMaster.name})`,
        );
      }
      if (!collectSubtreeIds(entry.id, childrenByParentId).has(String(exception.id))) {
        errors.push(`id=${entry.id} (${entry.name}) の except id=${exception.id} が配下に存在しない`);
      }
    }
  }

  // entry 同士が入れ子だと、どちらを消せば除外が外れるのか読めなくなる。冗長エントリは弾く。
  for (const entry of entries) {
    const descendantIds = collectSubtreeIds(entry.id, childrenByParentId);
    for (const other of entries) {
      if (String(other.id) === String(entry.id)) continue;
      if (descendantIds.has(String(other.id))) {
        errors.push(`id=${other.id} (${other.name}) は id=${entry.id} (${entry.name}) の配下で冗長`);
      }
    }
  }

  const categoryIds = new Set();
  for (const entry of entries) {
    const excepted = new Set();
    for (const exception of entry.except ?? []) {
      for (const id of collectSubtreeIds(exception.id, childrenByParentId)) excepted.add(id);
    }
    for (const id of collectSubtreeIds(entry.id, childrenByParentId)) {
      if (!excepted.has(id)) categoryIds.add(id);
    }
  }

  return { categoryIds: [...categoryIds].sort((a, b) => Number(a) - Number(b)), errors };
}

function renderGeneratedBlock({ categoryIds, entryCount, categoryMasterFetchedAt }) {
  const lines = [];
  for (let i = 0; i < categoryIds.length; i += 12) {
    lines.push(`    ${categoryIds.slice(i, i + 12).map((id) => `'${id}'`).join(', ')},`);
  }
  return [
    BLOCK_BEGIN,
    `  // 正本: procedures/exclude_by_category/collect-excluded-categories.json (${entryCount} エントリ)`,
    `  // カテゴリマスタ取得日: ${categoryMasterFetchedAt} / 展開後 ${categoryIds.length} カテゴリ`,
    '  const EXCLUDED_CATEGORY_IDS = new Set([',
    ...lines,
    '  ]);',
    BLOCK_END,
  ].join('\n');
}

function replaceGeneratedBlock(source, generatedBlock) {
  const beginIndex = source.indexOf(BLOCK_BEGIN);
  const endIndex = source.indexOf(BLOCK_END);
  if (beginIndex === -1 || endIndex === -1) {
    throw new Error(`生成ブロックのマーカーが見つからない: ${COLLECT_SCRIPT_PATH}`);
  }
  if (source.indexOf(BLOCK_BEGIN, beginIndex + 1) !== -1 || source.indexOf(BLOCK_END, endIndex + 1) !== -1) {
    throw new Error(`生成ブロックのマーカーが複数ある: ${COLLECT_SCRIPT_PATH}`);
  }
  if (endIndex < beginIndex) {
    throw new Error(`生成ブロックのマーカー順序が不正: ${COLLECT_SCRIPT_PATH}`);
  }
  return source.slice(0, beginIndex) + generatedBlock + source.slice(endIndex + BLOCK_END.length);
}

module.exports = {
  BLOCK_BEGIN,
  BLOCK_END,
  buildChildIndex,
  collectSubtreeIds,
  expandExclusionCategoryIds,
  renderGeneratedBlock,
  replaceGeneratedBlock,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const checkOnly = process.argv.includes('--check');

  const sourceList = JSON.parse(fs.readFileSync(SOURCE_LIST_PATH, 'utf8'));
  const master = JSON.parse(fs.readFileSync(CATEGORY_MASTER_PATH, 'utf8'));

  const { categoryIds, errors } = expandExclusionCategoryIds({
    entries: sourceList.entries,
    categories: master.categories,
  });

  if (errors.length > 0) {
    console.error(`ERROR: 正本とカテゴリマスタの不整合が ${errors.length} 件。collect.js は更新しない。`);
    for (const message of errors) console.error(`  - ${message}`);
    process.exit(1);
  }

  const generatedBlock = renderGeneratedBlock({
    categoryIds,
    entryCount: sourceList.entries.length,
    categoryMasterFetchedAt: master.meta.fetchedAt,
  });
  const currentSource = fs.readFileSync(COLLECT_SCRIPT_PATH, 'utf8');
  const nextSource = replaceGeneratedBlock(currentSource, generatedBlock);

  if (currentSource === nextSource) {
    console.log(`変更なし: ${COLLECT_SCRIPT_PATH} (${sourceList.entries.length} エントリ → ${categoryIds.length} カテゴリ)`);
    process.exit(0);
  }
  if (checkOnly) {
    console.error(`ERROR: collect.js の生成ブロックが正本と一致しない。--check なしで再実行して更新すること。`);
    process.exit(1);
  }

  fs.writeFileSync(COLLECT_SCRIPT_PATH, nextSource);
  console.log(`更新: ${COLLECT_SCRIPT_PATH} (${sourceList.entries.length} エントリ → ${categoryIds.length} カテゴリ)`);
}
