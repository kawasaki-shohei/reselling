// 第 5 段階 substep 5-3 (視覚属性抽出): 過去 run の判定結果を引き継ぐスクリプト。
// 過去 run の visual_extraction/visual_full.json から id → {attributes, notes} の
// 判定キャッシュを作り、現在 run の structured_extraction/structured_full.json から
// id 一致するものを切り離して visual_extraction/results/visual_batch_inherited.json に
// 直接書き出す。残った未判定 items を structured_full_after_inherit.json として書き出し、
// 後段の build_visual_extraction_batches.js に渡す (引数 <structured-full-path>)。
//
// Why: 同じ商品 ID を 2 回 Sonnet 視覚属性抽出するのは Sonnet コストの無駄なため。
//      14 日ウィンドウで複数回 collect する運用に対する後段の再判定削減策。
//
// 使い方:
//   node research/inherit_visual_extraction.js <current_run_dir> [options]
//
// オプション:
//   --from <prev-run-dir>       過去 run のディレクトリ (複数指定可、省略時は自動検出)
//
// 例:
//   node research/inherit_visual_extraction.js research/runs/2026_04_28_10_26
//   node research/inherit_visual_extraction.js research/runs/2026_04_28_10_26 \
//     --from research/runs/2026_04_23_20_02
//
// 出力 (どちらも既存時はエラー終了):
//   - <current_run_dir>/structured_extraction/structured_full_after_inherit.json
//       未判定 items (build_visual_extraction_batches.js への入力)
//   - <current_run_dir>/visual_extraction/results/visual_batch_inherited.json
//       引き継いだ判定 (visual_batch_NNN.json と同じトップレベル配列フォーマット、
//       バッチ結合ワンライナーが自動的に拾える)

const fs = require('fs');
const path = require('path');
const { writeFileSafe } = require('./_safe_write');

const RESEARCH_DIR = __dirname;
const RUNS_DIR = path.join(RESEARCH_DIR, 'runs');

function parseArgs(argv) {
  const out = { current: null, fromRuns: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.fromRuns.push(argv[++i]);
    else if (a.startsWith('--')) throw new Error('unknown option: ' + a);
    else if (!out.current) out.current = a;
    else throw new Error('unexpected positional arg: ' + a);
  }
  if (!out.current) {
    throw new Error('Usage: node research/inherit_visual_extraction.js <current_run_dir> [--from <prev-run-dir>]...');
  }
  return out;
}

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
    const visual = path.join(RUNS_DIR, ts, 'visual_extraction', 'visual_full.json');
    if (!fs.existsSync(visual)) continue;
    prev.push(path.join(RUNS_DIR, ts));
  }
  prev.sort().reverse();
  return prev;
}

// 過去 run から id → {attributes, notes, source_run} のマップを構築 (新しい順、最初の判定を採用)
function buildInheritMap(prevRunDirs) {
  const map = new Map();
  for (const prevRunDir of prevRunDirs) {
    const visualPath = path.join(prevRunDir, 'visual_extraction', 'visual_full.json');
    if (!fs.existsSync(visualPath)) {
      console.warn('skip (missing visual_full.json): ' + prevRunDir);
      continue;
    }
    const visual = JSON.parse(fs.readFileSync(visualPath, 'utf8'));
    const visualItems = Array.isArray(visual) ? visual : (visual.items || []);
    const sourceRel = path.relative(RESEARCH_DIR, visualPath);
    for (const v of visualItems) {
      if (!v || !v.id) continue;
      if (map.has(v.id)) continue;
      map.set(v.id, {
        attributes: v.attributes,
        notes: v.notes,
        source_visual: sourceRel,
        source_rowIndex: v.rowIndex,
      });
    }
  }
  return map;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const currentRunDir = path.resolve(args.current);
  if (!fs.existsSync(currentRunDir)) {
    throw new Error('current run dir not found: ' + currentRunDir);
  }
  const structuredPath = path.join(currentRunDir, 'structured_extraction', 'structured_full.json');
  if (!fs.existsSync(structuredPath)) {
    throw new Error('structured_full.json not found: ' + structuredPath);
  }

  const outputAfterInherit = path.join(currentRunDir, 'structured_extraction', 'structured_full_after_inherit.json');
  const visualResultsDir = path.join(currentRunDir, 'visual_extraction', 'results');
  const outputInheritedBatch = path.join(visualResultsDir, 'visual_batch_inherited.json');
  for (const p of [outputAfterInherit, outputInheritedBatch]) {
    if (fs.existsSync(p)) {
      throw new Error('output already exists (refuse to overwrite): ' + p);
    }
  }

  const prevRunDirs = (args.fromRuns.length > 0
    ? args.fromRuns.map(p => path.resolve(p))
    : autoDiscoverPrevRuns(currentRunDir));
  for (const p of prevRunDirs) {
    if (path.resolve(p) === currentRunDir) {
      throw new Error('--from must not equal the current run dir: ' + p);
    }
  }

  const inheritMap = buildInheritMap(prevRunDirs);

  const structured = JSON.parse(fs.readFileSync(structuredPath, 'utf8'));
  const structuredItems = Array.isArray(structured) ? structured : (structured.items || []);

  const inheritedItems = [];
  const remainingItems = [];
  for (const it of structuredItems) {
    const inh = it.id ? inheritMap.get(it.id) : null;
    if (inh) {
      inheritedItems.push({
        rowIndex: it.rowIndex,
        id: it.id,
        name: it.name,
        attributes: inh.attributes,
        notes: inh.notes,
        inherited_from: inh.source_visual,
        inherited_source_rowIndex: inh.source_rowIndex,
      });
    } else {
      remainingItems.push(it);
    }
  }

  // structured_full_after_inherit.json:
  //   元 structured_full.json と同じく top-level 配列 (build_visual_extraction_batches.js が
  //   配列前提で読むため、形式を維持する)
  if (!fs.existsSync(visualResultsDir)) fs.mkdirSync(visualResultsDir, { recursive: true });
  writeFileSafe(outputAfterInherit, JSON.stringify(remainingItems, null, 2));
  // visual_batch_inherited.json: 結合ワンライナーが flatMap で取り込む top-level 配列
  writeFileSafe(outputInheritedBatch, JSON.stringify(inheritedItems, null, 2));

  console.log(JSON.stringify({
    current: path.relative(process.cwd(), currentRunDir),
    inherit_sources: prevRunDirs.map(p => path.relative(process.cwd(), p)),
    input_count: structuredItems.length,
    inherited_count: inheritedItems.length,
    remaining_count: remainingItems.length,
    outputs: {
      structured_full_after_inherit: path.relative(process.cwd(), outputAfterInherit),
      visual_batch_inherited: path.relative(process.cwd(), outputInheritedBatch),
    },
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { buildInheritMap, autoDiscoverPrevRuns };
