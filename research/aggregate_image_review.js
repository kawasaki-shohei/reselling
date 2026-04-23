// 第 4 段階の画像除外: 集計 + 第 5 段階入力生成スクリプト。
// image_review/results/batch_*_result.json を全件統合して以下を書き出す:
//   - image_review/judgments.json       (全件 + verdict + reason、不変、監査用)
//   - image_review/filtered_unflagged.json (verdict ∈ {keep, unclear} のみ、第 5 段階の入力)
//
// filtered_unflagged.json は exclusion_output.json の row フォーマットに揃える
// (split_chunks_for_extraction.js が同じ rows[] 形式を期待するため)。
//
// 使い方:
//   node research/aggregate_image_review.js <image_review_dir> <exclusion_output.json>
//
// 例:
//   node research/aggregate_image_review.js \
//     research/runs/2026_04_16_06_46/image_review \
//     research/runs/2026_04_16_06_46/exclusion_final/exclusion_output.json

const fs = require('fs');
const path = require('path');

const VERDICT_KEYS = ['keep', 'exclude', 'unclear'];
const PASS_VERDICTS = new Set(['keep', 'unclear']);

function collectBatchResults(resultsDir) {
  const files = fs
    .readdirSync(resultsDir)
    .filter((f) => /^batch_\d+_result\.json$/.test(f))
    .sort();
  const items = [];
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf8'));
    const slice = Array.isArray(d) ? d : d.items;
    if (!Array.isArray(slice)) {
      throw new Error(`Invalid result format (no items array): ${f}`);
    }
    for (const item of slice) items.push(item);
  }
  return { files, items };
}

function buildVerdictDist(items) {
  const dist = Object.fromEntries(VERDICT_KEYS.map((k) => [k, 0]));
  let unknown = 0;
  for (const r of items) {
    if (dist[r.verdict] !== undefined) dist[r.verdict]++;
    else unknown++;
  }
  return { dist, unknown };
}

function buildFilteredUnflaggedRows(judgmentItems, exclusionRows) {
  const exclusionByIndex = new Map(exclusionRows.map((r) => [r.rowIndex, r]));
  const rows = [];
  for (const j of judgmentItems) {
    if (!PASS_VERDICTS.has(j.verdict)) continue;
    const orig = exclusionByIndex.get(j.rowIndex);
    if (!orig) {
      throw new Error(`rowIndex ${j.rowIndex} not found in exclusion_output.json`);
    }
    rows.push(orig);
  }
  return rows;
}

function main() {
  const [, , RUN_DIR_ARG, EXCLUSION_ARG] = process.argv;
  if (!RUN_DIR_ARG || !EXCLUSION_ARG) {
    console.error(
      'Usage: node research/aggregate_image_review.js <image_review_dir> <exclusion_output.json>',
    );
    process.exit(1);
  }

  const RUN_DIR = path.resolve(RUN_DIR_ARG);
  const EXCLUSION = path.resolve(EXCLUSION_ARG);
  const RESULTS_DIR = path.join(RUN_DIR, 'results');
  if (!fs.existsSync(RESULTS_DIR)) {
    console.error(`results/ directory not found under: ${RUN_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(EXCLUSION)) {
    console.error(`exclusion_output.json not found: ${EXCLUSION}`);
    process.exit(1);
  }

  const { files, items } = collectBatchResults(RESULTS_DIR);
  const { dist, unknown } = buildVerdictDist(items);

  const exclusionDoc = JSON.parse(fs.readFileSync(EXCLUSION, 'utf8'));
  const filteredRows = buildFilteredUnflaggedRows(items, exclusionDoc.rows);

  const judgments = {
    meta: {
      step: 'image_exclusion_step',
      sub: 'aggregate',
      source_results_dir: path.relative(process.cwd(), RESULTS_DIR),
      source_exclusion: path.relative(process.cwd(), EXCLUSION),
      batch_count: files.length,
      total_items: items.length,
      verdict_dist: dist,
      unknown_verdict: unknown,
      createdAt: new Date().toISOString(),
    },
    items,
  };

  const filtered = {
    meta: {
      step: 'image_exclusion_step',
      sub: 'filtered_unflagged',
      source_judgments: 'image_review/judgments.json',
      source_exclusion: path.relative(process.cwd(), EXCLUSION),
      kept_verdicts: [...PASS_VERDICTS],
      total_rows: filteredRows.length,
      createdAt: new Date().toISOString(),
    },
    rows: filteredRows,
  };

  const judgmentsPath = path.join(RUN_DIR, 'judgments.json');
  const filteredPath = path.join(RUN_DIR, 'filtered_unflagged.json');
  fs.writeFileSync(judgmentsPath, JSON.stringify(judgments, null, 2));
  fs.writeFileSync(filteredPath, JSON.stringify(filtered, null, 2));

  console.log(
    JSON.stringify(
      {
        batch_count: files.length,
        total_items: items.length,
        verdict_dist: dist,
        unknown_verdict: unknown,
        filtered_unflagged_rows: filteredRows.length,
        outputs: { judgments: judgmentsPath, filtered_unflagged: filteredPath },
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  collectBatchResults,
  buildVerdictDist,
  buildFilteredUnflaggedRows,
  PASS_VERDICTS,
};
