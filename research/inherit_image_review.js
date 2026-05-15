// 第 4 段階の画像除外: 過去 run の判定結果を引き継ぐスクリプト。
// 過去 run の image_review/all.json + judgments.json から first_id 単位の
// 判定キャッシュを作り、現在 run の入力から first_id 一致するものを切り離して
// results/inherited_result.json に直接書き出す。残った未判定 items を
// all_after_inherit.json として書き出し、後段の split_image_review_batches.js
// に渡す。
//
// Why: 同じ商品 ID を 2 回 Sonnet 画像判定するのは Sonnet コストの無駄なため。
//      14 日ウィンドウで複数回 collect する運用に対する後段の再判定削減策。
//
// 使い方:
//   node research/inherit_image_review.js <current_image_review_dir> [options]
//
// オプション:
//   --from <prev-run-dir>       過去 run のディレクトリ (複数指定可、省略時は自動検出)
//   --input <filename>          入力ファイル名 (デフォルト: all.json)
//
// 例:
//   node research/inherit_image_review.js research/runs/2026_04_28_10_26/image_review
//   node research/inherit_image_review.js research/runs/2026_04_28_10_26/image_review \
//     --from research/runs/2026_04_23_20_02 --input all_after_pdf_check.json
//
// 出力 (どちらも既存時はエラー終了):
//   - <current_image_review_dir>/all_after_inherit.json   (未判定の items)
//   - <current_image_review_dir>/results/inherited_result.json (引き継いだ判定)
//
// 出力先既存ならエラー終了 (出力ファイルの不変原則と整合)。

const fs = require('fs');
const path = require('path');
const { writeFileSafe } = require('./_safe_write');

const RESEARCH_DIR = __dirname;
const RUNS_DIR = path.join(RESEARCH_DIR, 'runs');

function parseArgs(argv) {
  const out = { current: null, fromRuns: [], input: 'all.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.fromRuns.push(argv[++i]);
    else if (a === '--input') out.input = argv[++i];
    else if (a.startsWith('--')) throw new Error('unknown option: ' + a);
    else if (!out.current) out.current = a;
    else throw new Error('unexpected positional arg: ' + a);
  }
  if (!out.current) {
    throw new Error('Usage: node research/inherit_image_review.js <current_image_review_dir> [--from <prev-run-dir>]... [--input <filename>]');
  }
  return out;
}

// run-dir (例: research/runs/2026_04_28_10_26) から ts (= 2026_04_28_10_26) を抽出
function tsOfRunDir(runDir) {
  return path.basename(path.resolve(runDir));
}

function autoDiscoverPrevRuns(currentRunDir) {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const currentTs = tsOfRunDir(currentRunDir);
  const candidates = fs.readdirSync(RUNS_DIR);
  const prev = [];
  for (const ts of candidates) {
    if (ts === currentTs) continue;
    const judgments = path.join(RUNS_DIR, ts, 'image_review', 'judgments.json');
    if (!fs.existsSync(judgments)) continue;
    prev.push(path.join(RUNS_DIR, ts));
  }
  // 新しい順 (ts は YYYY_MM_DD_HH_MM 形式で文字列ソートと時系列が一致する想定)
  prev.sort().reverse();
  return prev;
}

// 過去 run から first_id → {verdict, reason, judged_at, source_run, source_rowIndex} のマップを構築
function buildInheritMap(prevRunDirs) {
  const map = new Map();
  for (const prevRunDir of prevRunDirs) {
    const allPath = path.join(prevRunDir, 'image_review', 'all.json');
    const judgmentsPath = path.join(prevRunDir, 'image_review', 'judgments.json');
    if (!fs.existsSync(allPath) || !fs.existsSync(judgmentsPath)) {
      console.warn('skip (missing all.json or judgments.json): ' + prevRunDir);
      continue;
    }
    const all = JSON.parse(fs.readFileSync(allPath, 'utf8'));
    const allItems = all.items || all;
    const rowIndexToFirstId = new Map();
    for (const it of allItems) {
      if (it && it.rowIndex !== undefined && it.first_id) {
        rowIndexToFirstId.set(it.rowIndex, it.first_id);
      }
    }
    const judgments = JSON.parse(fs.readFileSync(judgmentsPath, 'utf8'));
    const judgmentItems = judgments.items || judgments;
    const sourceRel = path.relative(RESEARCH_DIR, judgmentsPath);
    for (const j of judgmentItems) {
      const fid = rowIndexToFirstId.get(j.rowIndex);
      if (!fid) continue;
      // 既に新しい run の判定が入っていればスキップ (新しい順で走査している)
      if (map.has(fid)) continue;
      map.set(fid, {
        verdict: j.verdict,
        reason: j.reason,
        judged_at: j.judged_at,
        source_judgments: sourceRel,
        source_rowIndex: j.rowIndex,
      });
    }
  }
  return map;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const currentDir = path.resolve(args.current);
  if (!fs.existsSync(currentDir)) {
    throw new Error('current dir not found: ' + currentDir);
  }

  const inputPath = path.join(currentDir, args.input);
  if (!fs.existsSync(inputPath)) {
    throw new Error('input not found: ' + inputPath);
  }

  const outputAllAfter = path.join(currentDir, 'all_after_inherit.json');
  const resultsDir = path.join(currentDir, 'results');
  const outputInheritedResult = path.join(resultsDir, 'inherited_result.json');
  for (const p of [outputAllAfter, outputInheritedResult]) {
    if (fs.existsSync(p)) {
      throw new Error('output already exists (refuse to overwrite): ' + p);
    }
  }

  // 現在 run の絶対パスから run-dir を遡って取り出す
  const currentRunDir = path.resolve(currentDir, '..');

  // 過去 run の決定
  const prevRunDirs = (args.fromRuns.length > 0
    ? args.fromRuns.map(p => path.resolve(p))
    : autoDiscoverPrevRuns(currentRunDir));
  for (const p of prevRunDirs) {
    if (path.resolve(p) === currentRunDir) {
      throw new Error('--from must not equal the current run dir: ' + p);
    }
  }

  // 過去判定マップ構築
  const inheritMap = buildInheritMap(prevRunDirs);

  // 現在 run の入力読み込み
  const inputDoc = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const inputMeta = inputDoc.meta || null;
  const inputItems = inputDoc.items || inputDoc;
  if (!Array.isArray(inputItems)) {
    throw new Error('input items not array: ' + inputPath);
  }

  // 引き継ぎ判定と未判定に分ける
  const inheritedItems = [];
  const remainingItems = [];
  for (const it of inputItems) {
    const inh = it.first_id ? inheritMap.get(it.first_id) : null;
    if (inh) {
      inheritedItems.push({
        rowIndex: it.rowIndex,
        title: it.title,
        image_path: it.image_path,
        verdict: inh.verdict,
        reason: inh.reason,
        judged_at: inh.judged_at,
        judged_by: 'inherited',
        inherited_from: inh.source_judgments,
        inherited_source_rowIndex: inh.source_rowIndex,
      });
    } else {
      remainingItems.push(it);
    }
  }

  const allAfterDoc = {
    meta: {
      step: 'image_exclusion_step',
      sub: 'all_after_inherit',
      source_input: path.relative(process.cwd(), inputPath),
      inherit_sources: prevRunDirs.map(p => path.relative(process.cwd(), p)),
      input_count: inputItems.length,
      inherited_count: inheritedItems.length,
      remaining_count: remainingItems.length,
      createdAt: new Date().toISOString(),
      ...(inputMeta ? { upstream_meta: inputMeta } : {}),
    },
    items: remainingItems,
  };
  const inheritedDoc = {
    meta: {
      step: 'image_exclusion_step',
      sub: 'inherited',
      source_input: path.relative(process.cwd(), inputPath),
      inherit_sources: prevRunDirs.map(p => path.relative(process.cwd(), p)),
      total_items: inheritedItems.length,
      createdAt: new Date().toISOString(),
    },
    items: inheritedItems,
  };

  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  writeFileSafe(outputAllAfter, JSON.stringify(allAfterDoc, null, 2));
  writeFileSafe(outputInheritedResult, JSON.stringify(inheritedDoc, null, 2));

  console.log(JSON.stringify({
    current: path.relative(process.cwd(), currentDir),
    input: args.input,
    inherit_sources: prevRunDirs.map(p => path.relative(process.cwd(), p)),
    input_count: inputItems.length,
    inherited_count: inheritedItems.length,
    remaining_count: remainingItems.length,
    outputs: {
      all_after_inherit: path.relative(process.cwd(), outputAllAfter),
      inherited_result: path.relative(process.cwd(), outputInheritedResult),
    },
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { buildInheritMap, autoDiscoverPrevRuns };
