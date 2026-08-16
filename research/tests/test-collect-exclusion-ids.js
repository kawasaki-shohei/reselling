// collect 段階のカテゴリ除外 ID 展開 (build-collect-exclusion-ids.js) の単体テスト。
// Node 組み込みの assert のみ。実行: node research/tests/test-collect-exclusion-ids.js
//
// 網羅対象 (純粋関数のみ、ファイル I/O と CLI 起動はカバーしない):
//   - expandExclusionCategoryIds (展開・except・整合性検証)
//   - renderGeneratedBlock / replaceGeneratedBlock (生成ブロックの差し替え)

const assert = require('node:assert/strict');

const {
  BLOCK_BEGIN,
  BLOCK_END,
  expandExclusionCategoryIds,
  renderGeneratedBlock,
  replaceGeneratedBlock,
} = require('../../procedures/exclude_by_category/build-collect-exclusion-ids');

const failures = [];
function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`FAIL  ${name}\n  ${e.message}`);
  }
}

// 実マスタ (mercari_categories.json) と同じ形。root レコードは level / parentCategoryId を
// 持たない実データの性質をそのまま再現する。
const CATEGORIES = [
  { id: '9', name: 'ハンドメイド・手芸', rootCategoryName: 'ハンドメイド・手芸', hasChild: true },
  {
    id: '911', name: 'ファッション小物', level: '1', parentCategoryId: '9',
    parentCategoryName: 'ハンドメイド・手芸', rootCategoryId: '9', rootCategoryName: 'ハンドメイド・手芸', hasChild: true,
  },
  {
    id: '910', name: '財布・ケース・小物入れ', level: '2', parentCategoryId: '911',
    parentCategoryName: 'ファッション小物', rootCategoryId: '9', rootCategoryName: 'ハンドメイド・手芸', hasChild: true,
  },
  {
    id: '10201', name: 'ポーチ', level: '3', parentCategoryId: '910',
    parentCategoryName: '財布・ケース・小物入れ', rootCategoryId: '9', rootCategoryName: 'ハンドメイド・手芸', hasChild: false,
  },
  {
    id: '10219', name: 'アームカバー・アームウォーマー', level: '2', parentCategoryId: '911',
    parentCategoryName: 'ファッション小物', rootCategoryId: '9', rootCategoryName: 'ハンドメイド・手芸', hasChild: false,
  },
  {
    id: '914', name: 'アクセサリー', level: '1', parentCategoryId: '9',
    parentCategoryName: 'ハンドメイド・手芸', rootCategoryId: '9', rootCategoryName: 'ハンドメイド・手芸', hasChild: true,
  },
  {
    id: '987', name: 'ピアス', level: '2', parentCategoryId: '914',
    parentCategoryName: 'アクセサリー', rootCategoryId: '9', rootCategoryName: 'ハンドメイド・手芸', hasChild: false,
  },
];

const HANDMADE_ACCESSORY_ENTRY = {
  id: '914', name: 'アクセサリー', level: '1', criteria: 'handmade', why: '作家品のアクセサリー',
};

// ---------------------------------------------------------------------------
// expandExclusionCategoryIds
// ---------------------------------------------------------------------------

test('expandExclusionCategoryIds: entry 自身と全子孫を展開する', () => {
  const { categoryIds, errors } = expandExclusionCategoryIds({
    entries: [HANDMADE_ACCESSORY_ENTRY],
    categories: CATEGORIES,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(categoryIds, ['914', '987']);
});

test('expandExclusionCategoryIds: root エントリ (level を持たないマスタ行) を level 0 として受け付ける', () => {
  const { categoryIds, errors } = expandExclusionCategoryIds({
    entries: [{ id: '9', name: 'ハンドメイド・手芸', level: '0', criteria: 'handmade', why: 'root 丸ごと' }],
    categories: CATEGORIES,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(categoryIds, ['9', '910', '911', '914', '987', '10201', '10219']);
});

test('expandExclusionCategoryIds: except の部分木を除外対象から外す', () => {
  const { categoryIds, errors } = expandExclusionCategoryIds({
    entries: [{
      id: '911', name: 'ファッション小物', level: '1', criteria: 'handmade', why: '作家品のファッション小物',
      except: [{ id: '910', name: '財布・ケース・小物入れ' }],
    }],
    categories: CATEGORIES,
  });
  assert.deepEqual(errors, []);
  // 910 とその子 10201 が落ち、911 自身と 10219 だけ残る
  assert.deepEqual(categoryIds, ['911', '10219']);
});

test('expandExclusionCategoryIds: ID は数値昇順で返す', () => {
  const { categoryIds } = expandExclusionCategoryIds({
    entries: [{ id: '9', name: 'ハンドメイド・手芸', level: '0', criteria: 'handmade', why: 'root 丸ごと' }],
    categories: CATEGORIES,
  });
  assert.deepEqual(categoryIds, [...categoryIds].sort((a, b) => Number(a) - Number(b)));
});

test('expandExclusionCategoryIds: マスタに存在しない id を検出する', () => {
  const { errors } = expandExclusionCategoryIds({
    entries: [{ id: '99999', name: '廃止カテゴリ', level: '1', criteria: 'handmade', why: '' }],
    categories: CATEGORIES,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /99999.*カテゴリマスタに存在しない/);
});

test('expandExclusionCategoryIds: マスタと名前が食い違う entry を検出する', () => {
  const { errors } = expandExclusionCategoryIds({
    entries: [{ ...HANDMADE_ACCESSORY_ENTRY, name: 'アクセサリー(旧名)' }],
    categories: CATEGORIES,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /名前が不一致/);
});

test('expandExclusionCategoryIds: マスタと階層が食い違う entry を検出する', () => {
  const { errors } = expandExclusionCategoryIds({
    entries: [{ ...HANDMADE_ACCESSORY_ENTRY, level: '2' }],
    categories: CATEGORIES,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /階層が不一致/);
});

test('expandExclusionCategoryIds: 入れ子になった冗長 entry を検出する', () => {
  const { errors } = expandExclusionCategoryIds({
    entries: [
      HANDMADE_ACCESSORY_ENTRY,
      { id: '987', name: 'ピアス', level: '2', criteria: 'handmade', why: '' },
    ],
    categories: CATEGORIES,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /987.*914.*配下で冗長/);
});

test('expandExclusionCategoryIds: 重複 entry を検出する', () => {
  const { errors } = expandExclusionCategoryIds({
    entries: [HANDMADE_ACCESSORY_ENTRY, { ...HANDMADE_ACCESSORY_ENTRY }],
    categories: CATEGORIES,
  });
  assert.ok(errors.some((e) => /正本に重複している/.test(e)));
});

test('expandExclusionCategoryIds: entry の配下にない except を検出する', () => {
  const { errors } = expandExclusionCategoryIds({
    entries: [{
      ...HANDMADE_ACCESSORY_ENTRY,
      except: [{ id: '910', name: '財布・ケース・小物入れ' }],
    }],
    categories: CATEGORIES,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /except id=910 が配下に存在しない/);
});

test('expandExclusionCategoryIds: マスタと名前が食い違う except を検出する', () => {
  const { errors } = expandExclusionCategoryIds({
    entries: [{
      id: '911', name: 'ファッション小物', level: '1', criteria: 'handmade', why: '',
      except: [{ id: '910', name: '小物入れ' }],
    }],
    categories: CATEGORIES,
  });
  assert.ok(errors.some((e) => /except id=910 の名前が不一致/.test(e)));
});

// ---------------------------------------------------------------------------
// renderGeneratedBlock / replaceGeneratedBlock
// ---------------------------------------------------------------------------

test('renderGeneratedBlock: マーカーで囲まれた Set 定義を出力する', () => {
  const block = renderGeneratedBlock({
    categoryIds: ['9', '914', '987'], entryCount: 1, categoryMasterFetchedAt: '2026-06-03',
  });
  assert.ok(block.startsWith(BLOCK_BEGIN));
  assert.ok(block.endsWith(BLOCK_END));
  assert.match(block, /const EXCLUDED_CATEGORY_IDS = new Set\(\[/);
  assert.match(block, /'9', '914', '987',/);
  assert.match(block, /展開後 3 カテゴリ/);
});

test('replaceGeneratedBlock: マーカー間だけを差し替え、前後は保つ', () => {
  const source = ['const A = 1;', BLOCK_BEGIN, '  const OLD = new Set([]);', BLOCK_END, 'const B = 2;'].join('\n');
  const block = renderGeneratedBlock({ categoryIds: ['914'], entryCount: 1, categoryMasterFetchedAt: '2026-06-03' });
  const got = replaceGeneratedBlock(source, block);
  assert.ok(got.startsWith('const A = 1;\n'));
  assert.ok(got.endsWith('\nconst B = 2;'));
  assert.ok(!got.includes('const OLD'));
  assert.match(got, /'914',/);
});

test('replaceGeneratedBlock: 同じブロックの再適用で結果が変わらない (冪等)', () => {
  const source = ['const A = 1;', BLOCK_BEGIN, BLOCK_END, 'const B = 2;'].join('\n');
  const block = renderGeneratedBlock({ categoryIds: ['914'], entryCount: 1, categoryMasterFetchedAt: '2026-06-03' });
  const once = replaceGeneratedBlock(source, block);
  assert.equal(replaceGeneratedBlock(once, block), once);
});

test('replaceGeneratedBlock: マーカーが無ければ throw する', () => {
  const block = renderGeneratedBlock({ categoryIds: ['914'], entryCount: 1, categoryMasterFetchedAt: '2026-06-03' });
  assert.throws(() => replaceGeneratedBlock('const A = 1;', block), /マーカーが見つからない/);
});

test('replaceGeneratedBlock: マーカーが複数あれば throw する', () => {
  const source = [BLOCK_BEGIN, BLOCK_END, BLOCK_BEGIN, BLOCK_END].join('\n');
  const block = renderGeneratedBlock({ categoryIds: ['914'], entryCount: 1, categoryMasterFetchedAt: '2026-06-03' });
  assert.throws(() => replaceGeneratedBlock(source, block), /マーカーが複数ある/);
});

test('replaceGeneratedBlock: マーカーの順序が逆なら throw する', () => {
  const source = [BLOCK_END, BLOCK_BEGIN].join('\n');
  const block = renderGeneratedBlock({ categoryIds: ['914'], entryCount: 1, categoryMasterFetchedAt: '2026-06-03' });
  assert.throws(() => replaceGeneratedBlock(source, block), /マーカー順序が不正/);
});

// ---------------------------------------------------------------------------
// 結果報告
// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.log(`\n${failures.length} test(s) failed`);
  process.exit(1);
} else {
  console.log('\nAll tests passed');
}
