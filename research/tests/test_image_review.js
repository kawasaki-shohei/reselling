// 第 4 段階の画像除外パイプライン (prepare / split / aggregate) の単体テスト。
// Node 組み込みの assert のみ。実行: node research/tests/test_image_review.js
//
// 網羅対象 (純粋関数のみ、ネットワーク・CLI 起動はカバーしない):
//   - prepare_image_review.buildAllItems
//   - split_image_review_batches.splitItemsIntoBatches / batchFileName
//   - aggregate_image_review.collectBatchResults / buildVerdictDist / buildFilteredUnflaggedRows

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildAllItems } = require('../prepare_image_review');
const { splitItemsIntoBatches, batchFileName } = require('../split_image_review_batches');
const { buildTasks } = require('../download_image_review_thumbnails');
const {
  collectBatchResults,
  buildVerdictDist,
  buildFilteredUnflaggedRows,
  PASS_VERDICTS,
} = require('../aggregate_image_review');

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

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'image_review_test_'));
}

// ---------------------------------------------------------------------------
// prepare_image_review.buildAllItems
// ---------------------------------------------------------------------------

test('buildAllItems: exclusion === null のみ抽出する', () => {
  const exclusionRows = [
    { rowIndex: 0, name: 'A', seller: 's0', ids: ['m1'], count: 1, priceMin: 100, priceMax: 100, exclusion: null },
    { rowIndex: 1, name: 'B', seller: 's1', ids: ['m2'], count: 2, priceMin: 200, priceMax: 200, exclusion: { primary: 'food', matches: { food: ['チョコ'] } } },
    { rowIndex: 2, name: 'C', seller: 's2', ids: ['m3'], count: 3, priceMin: 300, priceMax: 300, exclusion: null },
  ];
  const rawItems = [
    { id: 'm1', thumbnail: 'https://t/m1.webp' },
    { id: 'm2', thumbnail: 'https://t/m2.webp' },
    { id: 'm3', thumbnail: 'https://t/m3.webp' },
  ];
  const got = buildAllItems({ exclusionRows, rawItems, imagesDir: '/tmp/imgs' });
  assert.equal(got.length, 2);
  assert.deepEqual(
    got.map((i) => i.rowIndex),
    [0, 2],
  );
});

test('buildAllItems: ids[0] で thumbnail を join、なければ null', () => {
  const exclusionRows = [
    { rowIndex: 0, name: 'A', seller: 's0', ids: ['m1'], count: 1, priceMin: 100, priceMax: 100, exclusion: null },
    { rowIndex: 1, name: 'B', seller: 's1', ids: ['m_unknown'], count: 1, priceMin: 100, priceMax: 100, exclusion: null },
    { rowIndex: 2, name: 'C', seller: 's2', ids: [], count: 0, priceMin: 0, priceMax: 0, exclusion: null },
  ];
  const rawItems = [{ id: 'm1', thumbnail: 'https://t/m1.webp' }];
  const got = buildAllItems({ exclusionRows, rawItems, imagesDir: '/tmp/imgs' });
  assert.equal(got[0].thumbnail_url, 'https://t/m1.webp');
  assert.equal(got[1].thumbnail_url, null, 'unknown id → null');
  assert.equal(got[2].thumbnail_url, null, 'empty ids → null');
});

test('buildAllItems: image_path が imagesDir/{rowIndex}.webp', () => {
  const exclusionRows = [
    { rowIndex: 42, name: 'A', seller: 's', ids: ['m1'], count: 1, priceMin: 0, priceMax: 0, exclusion: null },
  ];
  const rawItems = [{ id: 'm1', thumbnail: 'https://t/m1.webp' }];
  const got = buildAllItems({ exclusionRows, rawItems, imagesDir: '/tmp/imgs' });
  assert.equal(got[0].image_path, '/tmp/imgs/42.webp');
});

test('buildAllItems: メタフィールド (count / priceMin / priceMax / seller / first_id) を保持', () => {
  const exclusionRows = [
    { rowIndex: 7, name: 'X', seller: 'sel99', ids: ['mA', 'mB'], count: 5, priceMin: 980, priceMax: 1200, exclusion: null },
  ];
  const rawItems = [{ id: 'mA', thumbnail: 'https://t/mA.webp' }];
  const got = buildAllItems({ exclusionRows, rawItems, imagesDir: '/x' });
  assert.equal(got[0].title, 'X');
  assert.equal(got[0].seller, 'sel99');
  assert.equal(got[0].first_id, 'mA');
  assert.equal(got[0].count, 5);
  assert.equal(got[0].priceMin, 980);
  assert.equal(got[0].priceMax, 1200);
});

// ---------------------------------------------------------------------------
// split_image_review_batches
// ---------------------------------------------------------------------------

test('splitItemsIntoBatches: ちょうど割り切れる件数', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ rowIndex: i }));
  const batches = splitItemsIntoBatches(items, 50);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].length, 50);
  assert.equal(batches[1].length, 50);
});

test('splitItemsIntoBatches: 端数あり、最後のバッチが小さい', () => {
  const items = Array.from({ length: 123 }, (_, i) => ({ rowIndex: i }));
  const batches = splitItemsIntoBatches(items, 50);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].length, 50);
  assert.equal(batches[1].length, 50);
  assert.equal(batches[2].length, 23);
});

test('splitItemsIntoBatches: 空配列', () => {
  const batches = splitItemsIntoBatches([], 50);
  assert.equal(batches.length, 0);
});

test('batchFileName: 3 桁ゼロパディング', () => {
  assert.equal(batchFileName(0), 'batch_000.json');
  assert.equal(batchFileName(7), 'batch_007.json');
  assert.equal(batchFileName(99), 'batch_099.json');
  assert.equal(batchFileName(100), 'batch_100.json');
});

// ---------------------------------------------------------------------------
// download_image_review_thumbnails.buildTasks
// ---------------------------------------------------------------------------

test('buildTasks: thumbnail_url がある item のみ {rowIndex, url} に変換', () => {
  const items = [
    { rowIndex: 0, thumbnail_url: 'https://t/0.webp' },
    { rowIndex: 1, thumbnail_url: null },
    { rowIndex: 2, thumbnail_url: 'https://t/2.webp' },
    { rowIndex: 3, thumbnail_url: undefined },
  ];
  const got = buildTasks(items);
  assert.deepEqual(got, [
    { rowIndex: 0, url: 'https://t/0.webp' },
    { rowIndex: 2, url: 'https://t/2.webp' },
  ]);
});

test('buildTasks: 空入力 → 空配列', () => {
  assert.deepEqual(buildTasks([]), []);
});

// ---------------------------------------------------------------------------
// aggregate_image_review.collectBatchResults
// ---------------------------------------------------------------------------

test('collectBatchResults: ファイル名順に統合し items 配列を結合', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(
    path.join(dir, 'batch_001_result.json'),
    JSON.stringify({ batch_id: 1, items: [{ rowIndex: 50, verdict: 'keep' }] }),
  );
  fs.writeFileSync(
    path.join(dir, 'batch_000_result.json'),
    JSON.stringify({ batch_id: 0, items: [{ rowIndex: 0, verdict: 'exclude' }, { rowIndex: 1, verdict: 'keep' }] }),
  );
  const { files, items } = collectBatchResults(dir);
  assert.deepEqual(files, ['batch_000_result.json', 'batch_001_result.json']);
  assert.equal(items.length, 3);
  assert.equal(items[0].rowIndex, 0);
  assert.equal(items[1].rowIndex, 1);
  assert.equal(items[2].rowIndex, 50);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('collectBatchResults: フラット配列形式の結果ファイルも受け入れる', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(
    path.join(dir, 'batch_000_result.json'),
    JSON.stringify([{ rowIndex: 0, verdict: 'keep' }]),
  );
  const { items } = collectBatchResults(dir);
  assert.equal(items.length, 1);
  assert.equal(items[0].verdict, 'keep');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('collectBatchResults: 命名規則に合わないファイルは無視', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'batch_000_result.json'), JSON.stringify({ items: [{ rowIndex: 0, verdict: 'keep' }] }));
  fs.writeFileSync(path.join(dir, 'README.md'), 'noise');
  fs.writeFileSync(path.join(dir, 'partial.json'), JSON.stringify({ items: [] }));
  const { files, items } = collectBatchResults(dir);
  assert.deepEqual(files, ['batch_000_result.json']);
  assert.equal(items.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// aggregate_image_review.buildVerdictDist
// ---------------------------------------------------------------------------

test('buildVerdictDist: keep / exclude / unclear をカウント、未知 verdict は unknown に', () => {
  const items = [
    { verdict: 'keep' },
    { verdict: 'keep' },
    { verdict: 'exclude' },
    { verdict: 'unclear' },
    { verdict: 'ERROR' }, // 未知
  ];
  const { dist, unknown } = buildVerdictDist(items);
  assert.deepEqual(dist, { keep: 2, exclude: 1, unclear: 1 });
  assert.equal(unknown, 1);
});

test('buildVerdictDist: 空入力でも 0 で返す', () => {
  const { dist, unknown } = buildVerdictDist([]);
  assert.deepEqual(dist, { keep: 0, exclude: 0, unclear: 0 });
  assert.equal(unknown, 0);
});

// ---------------------------------------------------------------------------
// aggregate_image_review.buildFilteredUnflaggedRows
// ---------------------------------------------------------------------------

test('buildFilteredUnflaggedRows: keep + unclear のみ通過、exclude は除外', () => {
  const judgmentItems = [
    { rowIndex: 0, verdict: 'keep' },
    { rowIndex: 1, verdict: 'exclude' },
    { rowIndex: 2, verdict: 'unclear' },
  ];
  const exclusionRows = [
    { rowIndex: 0, name: 'A', exclusion: null },
    { rowIndex: 1, name: 'B', exclusion: null },
    { rowIndex: 2, name: 'C', exclusion: null },
  ];
  const got = buildFilteredUnflaggedRows(judgmentItems, exclusionRows);
  assert.equal(got.length, 2);
  assert.equal(got[0].rowIndex, 0);
  assert.equal(got[1].rowIndex, 2);
});

test('buildFilteredUnflaggedRows: exclusion_output.json の元 row フォーマットを保持', () => {
  const judgmentItems = [{ rowIndex: 0, verdict: 'keep' }];
  const exclusionRows = [
    {
      rowIndex: 0,
      seller: 's',
      name: 'A',
      priceMin: 100,
      priceMax: 200,
      count: 3,
      ids: ['m1', 'm2', 'm3'],
      exclusion: null,
    },
  ];
  const got = buildFilteredUnflaggedRows(judgmentItems, exclusionRows);
  assert.deepEqual(got[0], exclusionRows[0]);
});

test('buildFilteredUnflaggedRows: 元 rows に rowIndex が無い場合は throw', () => {
  const judgmentItems = [{ rowIndex: 99, verdict: 'keep' }];
  const exclusionRows = [{ rowIndex: 0, exclusion: null }];
  assert.throws(() => buildFilteredUnflaggedRows(judgmentItems, exclusionRows), /rowIndex 99 not found/);
});

test('PASS_VERDICTS: keep と unclear のみ', () => {
  assert.equal(PASS_VERDICTS.has('keep'), true);
  assert.equal(PASS_VERDICTS.has('unclear'), true);
  assert.equal(PASS_VERDICTS.has('exclude'), false);
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
