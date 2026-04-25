// 暫定辞書の生成 (dictionary_expansion_step) — 手順書の第 3 段階
//
// 本スクリプトは Node 側の事前処理を担う:
//   1. 正規辞書 (keywords.json) のみで一次除外をかける (第 4 段階と同じロジック)
//   2. unflagged 行 (exclusion === null) を抽出
//   3. 以下を出力:
//        - unflagged_titles.json        (候補タイトル)
//        - dict_expansion_prompt.md     (絶対パス置換済みのサブエージェント用プロンプト)
//
// Sonnet サブエージェントを起動して暫定辞書を生成する部分は、本スクリプトの範囲外。
// 生成された dict_expansion_prompt.md の内容を Claude Code の Agent ツール (model=sonnet) に渡す。
//
// 使い方:
//   node research/expand_dictionary.js <input_raw_json> [output_dir]
//
// 例:
//   node research/expand_dictionary.js research/2026_04_16_06_46__mercari_14day_results.json
//   node research/expand_dictionary.js research/xxx.json research/runs/2026_04_16_06_46/dict_expansion
//
// 省略時の出力先: research/runs/<ts>/dict_expansion/ (<ts> は生データファイル名から抽出)

const fs = require('fs');
const path = require('path');
const { loadDictionary, aggregateBySellerTitle, annotateRows } = require('./_classifier');
const { getRunDir } = require('./_run_paths');
const { writeFileSafe } = require('./_safe_write');

const argInput = process.argv[2];
if (!argInput) {
  console.error('Usage: node research/expand_dictionary.js <input_raw_json> [output_dir]');
  process.exit(1);
}

const OUT_DIR = process.argv[3] || getRunDir(argInput, 'dict_expansion');
fs.mkdirSync(OUT_DIR, { recursive: true });

// 正規辞書のみで一次除外 (--pending は使わない)
const dict = loadDictionary(null);

const raw = JSON.parse(fs.readFileSync(argInput, 'utf8'));
const entries = aggregateBySellerTitle(raw.items);
const rows = annotateRows(entries, dict.keywords, dict.priority);

const unflagged = rows.filter(r => r.exclusion === null).map(r => ({
  rowIndex: r.rowIndex,
  name: r.name,
}));

const UNFLAGGED_PATH = path.resolve(OUT_DIR, 'unflagged_titles.json');
writeFileSafe(UNFLAGGED_PATH, JSON.stringify(unflagged, null, 2));

// Agent プロンプト (絶対パス置換済み)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ABS = (p) => path.join(PROJECT_ROOT, p);
const PENDING_PATH = path.resolve(OUT_DIR, 'keywords_pending.json');

const prompt = `メルカリ売れ筋リサーチの除外キーワード抽出担当として作業してください。

## 入力ファイル (絶対パス)

- 正規辞書: ${ABS('procedures/exclude_by_keywords/keywords.json')}
- 設計メモ: ${ABS('docs/research/mercari/keywords_design_notes.md')}
- 参考 PDF: ${ABS('references/注意商品.pdf')}
- 参考 PDF: ${ABS('references/new仕入れ禁止商品_アパレル.pdf')}
- 候補タイトル: ${UNFLAGGED_PATH}

## タスク

候補タイトル中から「正規辞書に未登録で、かつ除外対象になりうるキーワード」を抽出し、
${PENDING_PATH} に書き出してください。

## 出力フォーマット

\`\`\`json
{
  "priority": ["food","plant_quarantine","medical","cosmetics_yakki","character_copyright","brand_imitation","electronics_check","handmade"],
  "keywords": {
    "<カテゴリ名>": [
      "単純文字列キーワード",
      { "keyword": "...", "notWith": ["..."] },
      { "keyword": "...", "withAll": ["..."] }
    ]
  },
  "_sources": {
    "<キーワード>": ["根拠となった候補タイトル例", "..."]
  }
}
\`\`\`

## ルール (設計メモに準拠)

1. 正規辞書 (keywords.json) に既に入っているキーワードは出さない (重複禁止)
2. 短語・一般語 (2〜4 文字の日本語など) は単独では出さない。以下のいずれかで出す:
   - 具体名・複合語への置き換え (例: "アイス" ではなく "アイスクリーム")
   - notWith (単独除外したいが一部文脈で誤爆する場合)
   - withAll (単独では除外せず、特定の語と同時に出るときだけ除外する場合)
3. 各候補は priority の 8 カテゴリのいずれかに分類する
4. 各候補について、候補タイトル例を 1〜3 件 \`_sources\` に併記する
5. タイトルに出現していても、PDF の禁止カテゴリに該当しない商品 (= 仕入れ候補になりうるもの) は出さない
6. 判断に迷ったら出さない (偽陽性より見逃しを許容する)

## 完了条件

\`keywords_pending.json\` を書き出した後、自分で Read してフォーマットが正しいことを確認してから終了する。
`;

const PROMPT_PATH = path.resolve(OUT_DIR, 'dict_expansion_prompt.md');
writeFileSafe(PROMPT_PATH, prompt);

console.log(JSON.stringify({
  input: argInput,
  output_dir: path.resolve(OUT_DIR),
  unflagged_count: unflagged.length,
  files: {
    unflagged_titles: UNFLAGGED_PATH,
    agent_prompt: PROMPT_PATH,
    expected_keywords_pending: PENDING_PATH,
  },
  next_step: 'Agent ツール (subagent_type=general-purpose, model=sonnet) を起動し、dict_expansion_prompt.md の内容を prompt 引数に渡す',
}, null, 2));
