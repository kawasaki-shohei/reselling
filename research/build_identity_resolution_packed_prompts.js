#!/usr/bin/env node
/*
 * build_identity_resolution_packed_prompts.js
 *
 * 第 6 段階 工程 6-2 (同一商品判定) の「まとめ渡し」プロンプト組立スクリプト。
 * 6-1 の clusters.json から status="pending" の仮クラスタを groupId 順に取り出し、
 * 合計 items 数が上限 (デフォルト 50 件) を超えない範囲で複数グループを
 * 1 Agent 分のプロンプトに詰める。
 *
 * Why: 1 Agent = 1 グループ (平均 3〜4 件) では Agent 起動オーバーヘッドが
 * 判定本体を上回る。1 Agent あたりの合計件数を、実績のある単グループ上限
 * (SUB_BATCH_SIZE = 50 件) と同じに保ったままグループを詰めることで、
 * 判定 1 件あたりの入力 (仕様プロンプト + 画像 + タイトル) を変えずに
 * 起動回数だけを減らす。
 *
 * 使い方:
 *   node research/build_identity_resolution_packed_prompts.js <run-dir> [--max-items 50]
 *
 * 入力:
 *   research/identity_resolution_prompt.md (仕様プロンプト本体、固定)
 *   <run-dir>/identity_resolution/clusters.json (6-1 出力)
 *
 * 出力:
 *   <run-dir>/identity_resolution/prompts/prompt_pack_NNN.md (1 Agent = 1 pack)
 *
 * 結果ファイルは従来どおりグループごとに result_group_<groupId>.json
 * (Agent はグループ 1 つ判定完了ごとに即 Write する)。6-3 の集約は無変更で動く。
 *
 * size > 50 の pending グループは本スクリプトの対象外
 * (従来どおり build_identity_resolution_prompt.js のサブ分割で処理する)。
 * stdout の subSplitRequiredGroupIds に列挙される。
 */

const fs = require("node:fs");
const path = require("node:path");
const { writeFileSafe } = require("./_safe_write");
const {
  buildItemsSection,
  SUB_BATCH_SIZE,
} = require("./build_identity_resolution_prompt");

const PROMPT_BASE_PATH = path.resolve(
  path.join(__dirname, "identity_resolution_prompt.md"),
);
const DEFAULT_MAX_ITEMS_PER_AGENT = SUB_BATCH_SIZE;

function parseArgs() {
  const args = process.argv.slice(2);
  const runDirArg = args[0];
  if (!runDirArg || runDirArg.startsWith("--")) {
    console.error(
      "Usage: node research/build_identity_resolution_packed_prompts.js <run-dir> [--max-items 50]",
    );
    process.exit(1);
  }
  let maxItems = DEFAULT_MAX_ITEMS_PER_AGENT;
  const maxIdx = args.indexOf("--max-items");
  if (maxIdx >= 0) {
    const n = Number(args[maxIdx + 1]);
    if (!Number.isInteger(n) || n < 2) {
      throw new Error(`--max-items must be an integer >= 2: ${args[maxIdx + 1]}`);
    }
    maxItems = n;
  }
  return { runDir: runDirArg.replace(/\/$/, ""), maxItems };
}

/*
 * pending グループを groupId 順のまま、合計 size が maxItems を超えない
 * 範囲で前から詰める。size > maxItems のグループは packs に入れず
 * subSplitRequired に分離する (サブ分割の既存経路で処理)。
 */
function packPendingGroups(groups, maxItems) {
  const pending = groups
    .filter((g) => g.status === "pending")
    .sort((a, b) => a.groupId - b.groupId);
  const subSplitRequired = pending.filter((g) => g.size > maxItems);
  const packable = pending.filter((g) => g.size <= maxItems);

  const packs = [];
  let current = [];
  let currentItems = 0;
  for (const g of packable) {
    if (current.length > 0 && currentItems + g.size > maxItems) {
      packs.push(current);
      current = [];
      currentItems = 0;
    }
    current.push(g);
    currentItems += g.size;
  }
  if (current.length > 0) packs.push(current);
  return { packs, subSplitRequired };
}

function buildPackTailSection({ packGroups, resultsAbsDir, imagesDir }) {
  const totalItems = packGroups.reduce((a, g) => a + g.size, 0);
  const head = `## まとめ渡し (仮クラスタ ${packGroups.length} 個)

本プロンプトには仮クラスタが ${packGroups.length} 個 (合計 ${totalItems} 件) 含まれる。以下を厳守:

1. **各仮クラスタは完全に独立して判定する**。別の仮クラスタの商品と見比べたり、仮クラスタをまたいで subgroup を作ったりしない
2. **1 つの仮クラスタの判定が完了するたびに、その仮クラスタの指定出力パスへ即 Write する**。全クラスタ分をまとめて最後に書くのは禁止。理由: 途中で停止した場合、書き出し済みのファイルだけが成果として残り、未出力分だけやり直せる。親はファイルしか見ない
3. 冒頭「## 【絶対禁則】ファイル操作の制約」の「指定出力パスへの 1 回の書き込み」は、本プロンプトでは「**仮クラスタごとに 1 回、計 ${packGroups.length} 回**」と読み替える。それ以外のファイル操作は禁止のまま
4. 出力フォーマットは冒頭「## 出力フォーマット」のとおり (1 仮クラスタ = 1 JSON ファイル)
5. 各 Write 後に Read で件数と整合 (rowIndexes の和集合 == その仮クラスタの入力全件) を自己検証する
6. **各仮クラスタの判定を始める前に、その指定出力パスにファイルが既に存在するか確認する**。存在すれば過去の中断からの再開なので、その仮クラスタは判定せずスキップして次へ進む (既存ファイルの書き換えは禁止)
`;
  const sections = packGroups.map((g, i) => {
    const resultAbsPath = path.join(
      resultsAbsDir,
      `result_group_${g.groupId}.json`,
    );
    const itemsSection = buildItemsSection({ items: g.items, imagesDir });
    return `### 仮クラスタ ${i + 1}/${packGroups.length} (groupId=${g.groupId})

- groupKey: \`${g.groupKey}\`
- items (${g.items.length} 件):

${itemsSection}

指定出力パス (この仮クラスタの判定完了直後に 1 回で書く):

\`${resultAbsPath}\`
`;
  });
  return `${head}\n${sections.join("\n")}`;
}

function packFileName(packIndex) {
  return `prompt_pack_${String(packIndex).padStart(3, "0")}.md`;
}

function main() {
  const { runDir, maxItems } = parseArgs();
  const idDir = path.join(runDir, "identity_resolution");
  const clustersPath = path.join(idDir, "clusters.json");
  if (!fs.existsSync(clustersPath)) {
    throw new Error(`clusters.json does not exist: ${clustersPath}`);
  }
  const { groups } = JSON.parse(fs.readFileSync(clustersPath, "utf8"));
  const { packs, subSplitRequired } = packPendingGroups(groups, maxItems);

  const promptsDir = path.join(idDir, "prompts");
  const resultsAbsDir = path.resolve(path.join(idDir, "results"));
  // 画像の実体は第 4 段階 (画像除外) が DL した image_review/images/ にある
  // (build_identity_resolution_prompt.js と同じ参照先)
  const imagesDir = path.resolve(path.join(runDir, "image_review", "images"));
  fs.mkdirSync(promptsDir, { recursive: true });

  const base = fs.readFileSync(PROMPT_BASE_PATH, "utf8");
  const packSummaries = [];
  for (let i = 0; i < packs.length; i++) {
    const packGroups = packs[i];
    const tail = buildPackTailSection({
      packGroups,
      resultsAbsDir,
      imagesDir,
    });
    const outPath = path.join(promptsDir, packFileName(i));
    writeFileSafe(outPath, `${base.trimEnd()}\n\n---\n\n${tail}`, "utf8");
    packSummaries.push({
      packIndex: i,
      promptPath: outPath,
      groupCount: packGroups.length,
      itemCount: packGroups.reduce((a, g) => a + g.size, 0),
      groupIds: packGroups.map((g) => g.groupId),
    });
  }

  console.log(
    JSON.stringify(
      {
        maxItemsPerAgent: maxItems,
        pendingGroupCount: packs.flat().length + subSplitRequired.length,
        packCount: packs.length,
        packs: packSummaries,
        subSplitRequiredGroupIds: subSplitRequired.map((g) => g.groupId),
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
  packPendingGroups,
  buildPackTailSection,
  packFileName,
  DEFAULT_MAX_ITEMS_PER_AGENT,
};
