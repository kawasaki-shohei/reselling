#!/usr/bin/env node
/*
 * propose_normalize_map.js
 *
 * 第 5 段階 normalization_step の「正規化提案」前段スクリプト。
 * chunk 0〜N-1 の normalized_chunk_*.json と chunk N の structured_chunk_NN.json から
 * 合算 vocab を構築し、Haiku Agent に渡すプロンプトを生成する。
 *
 * 後続: 生成された propose_prompt_NN.md を Claude Code の Agent ツール
 *       (subagent_type=general-purpose, model=haiku-4-5-20251001) に渡す。
 *       Agent は proposed_normalize_map_NN.json を書き出す。
 *
 * 使い方:
 *   node research/propose_normalize_map.js <chunk-num> <run-dir>
 *
 * 例:
 *   node research/propose_normalize_map.js 00 research/runs/2026_04_23_05_06
 *
 * 入力:
 *   <run-dir>/structured_extraction/chunks_normalized/normalized_chunk_*.json (chunk 0〜N-1)
 *   <run-dir>/structured_extraction/chunks_output/structured_chunk_NN.json
 * 出力:
 *   <run-dir>/structured_extraction/normalization/propose_prompt_NN.md
 *   <run-dir>/structured_extraction/normalization/vocab_for_propose_NN.json
 */

const fs = require("node:fs");
const path = require("node:path");

const { buildVocab } = require("./extract_unique_vocab.js");

const NORMALIZED_FILE_PATTERN = /^normalized_chunk_(\d+)\.json$/;

function parseChunkNum(arg) {
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`chunk-num must be a non-negative integer: ${arg}`);
  }
  return { num: n, str: String(n).padStart(2, "0") };
}

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listNormalizedChunksBelow(dir, exclusiveUpper) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => {
      const m = name.match(NORMALIZED_FILE_PATTERN);
      return m ? { name, idx: Number(m[1]) } : null;
    })
    .filter((x) => x !== null && x.idx < exclusiveUpper)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => path.join(dir, x.name));
}

function buildPrompt({ outputAbsPath, chunkStr, vocab }) {
  const vocabJson = JSON.stringify(vocab, null, 2);
  return `# 表記揺れ提案 (chunk ${chunkStr})

## 【絶対禁則】ファイル操作の制約

以下を厳守。違反は仕様違反として扱う。

1. **指定出力パス以外にファイルを作成しない**
   - 出力パス: \`${outputAbsPath}\`
   - 中間ファイル・デバッグファイルを勝手に作らない
2. **入力ファイルを書き換えない**
   - プロンプト内に展開された vocab JSON、およびプロジェクト内の関連ファイルを書き換えない
3. **プロジェクト内の他ファイルを変更しない**
   - Edit / Write / NotebookEdit は、上記出力パスへの 1 回の書き込みのみに使う
   - 他の変更が必要になった場合は実行せず、プロンプト発行者に報告する
4. **違反しそうな操作は実行せず報告する**

## タスク

以下に与える vocab (category / subcategory / color の出現語と count) から、**純粋な表記揺れペア**を抽出して JSON で返してください。

抽出した結果を次の絶対パスに JSON として書き出してください:

\`${outputAbsPath}\`

## ルール

### 統一する対象 (これらは提案する)

| 種類 | 例 |
|---|---|
| 同じ語の別表記 (漢字↔カタカナ↔英字) | 青 ↔ ブルー / Tシャツ ↔ ティーシャツ / 白 ↔ ホワイト |
| 接尾辞だけの違い | Mサイズ ↔ M / カーキ色 ↔ カーキ / 2枚入り ↔ 2枚 / 3枚組 ↔ 3枚セット |
| 大小文字・全角半角・空白の差 | 100CM ↔ 100cm / Ｍ ↔ M |

### 統一しない対象 (これらは絶対に提案しない)

| 種類 | 例 |
|---|---|
| 別の色 (色名が違う) | カーキ ↔ チャコールグレー / ダークグレー ↔ グレー |
| 粒度違い (広い概念語と狭い概念語) | シール ↔ 3Dシール / ケース ↔ スマホケース / ミラー ↔ バイクミラー |
| 派生違い (用途・機能が違う) | スマホケース ↔ コインケース / ハーフパンツ ↔ ロングパンツ |

### 提案の方向性

少数派 → 多数派への変換ペアを出してください (count を比較し、count が小さい方を \`from\`、大きい方を \`to\` とする)。同 count の場合は出さなくてよい。

### 確信できないときは提案しない

下流で規則ベースの自動却下が走りますが、それでも**提案数は最小限に抑えてください**。判断に迷う色名統合 (カーキ ↔ チャコールグレー 等) や粒度違い (シール ↔ 3Dシール 等) は絶対に出さないでください。

## 出力フォーマット

\`\`\`json
{
  "proposals": [
    {
      "field": "color",
      "from": "青",
      "from_count": 1,
      "to": "ブルー",
      "to_count": 7,
      "reason": "漢字とカタカナで同じ色を指す"
    }
  ]
}
\`\`\`

- \`field\`: "category" / "subcategory" / "color" のいずれか
- \`from\`: 変換元の文字列 (vocab に出現する値、count が少ない側)
- \`from_count\`: vocab における from の出現回数
- \`to\`: 変換先の文字列 (vocab に出現する値、count が多い側)
- \`to_count\`: vocab における to の出現回数
- \`reason\`: 統一する理由 (一文で簡潔に)

提案が無ければ \`{"proposals": []}\` を出力してください。

## vocab (chunk 0 〜 ${chunkStr} で出現した値と count)

\`\`\`json
${vocabJson}
\`\`\`
`;
}

function main() {
  const [, , chunkArg, runDirArg] = process.argv;
  if (!chunkArg || !runDirArg) {
    console.error(
      "Usage: node research/propose_normalize_map.js <chunk-num> <run-dir>",
    );
    process.exit(1);
  }
  const { num: chunkNum, str: chunkStr } = parseChunkNum(chunkArg);
  const runDir = runDirArg.replace(/\/$/, "");
  const stageDir = path.join(runDir, "structured_extraction");
  const normalizedDir = path.join(stageDir, "chunks_normalized");
  const outputChunkPath = path.join(
    stageDir,
    "chunks_output",
    `structured_chunk_${chunkStr}.json`,
  );
  const normDir = path.join(stageDir, "normalization");
  const promptPath = path.join(normDir, `propose_prompt_${chunkStr}.md`);
  const vocabDebugPath = path.join(
    normDir,
    `vocab_for_propose_${chunkStr}.json`,
  );
  const proposedAbsPath = path.resolve(
    path.join(normDir, `proposed_normalize_map_${chunkStr}.json`),
  );

  if (!fs.existsSync(outputChunkPath)) {
    throw new Error(`structured_chunk file does not exist: ${outputChunkPath}`);
  }
  const priorChunkPaths = listNormalizedChunksBelow(normalizedDir, chunkNum);

  const allRows = [
    ...priorChunkPaths.flatMap(loadJsonFile),
    ...loadJsonFile(outputChunkPath),
  ];
  const vocab = buildVocab(allRows);

  fs.mkdirSync(normDir, { recursive: true });
  fs.writeFileSync(
    vocabDebugPath,
    JSON.stringify(vocab, null, 2) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    promptPath,
    buildPrompt({ outputAbsPath: proposedAbsPath, chunkStr, vocab }),
    "utf8",
  );

  const summary = {
    runDir,
    chunkNum,
    priorNormalizedChunks: priorChunkPaths.length,
    currentChunkPath: outputChunkPath,
    totalRows: allRows.length,
    uniqueCounts: {
      category: vocab.category.length,
      subcategory: vocab.subcategory.length,
      color: vocab.color.length,
    },
    promptPath,
    vocabDebugPath,
    proposedOutputPath: proposedAbsPath,
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  NORMALIZED_FILE_PATTERN,
  parseChunkNum,
  loadJsonFile,
  listNormalizedChunksBelow,
  buildPrompt,
};
