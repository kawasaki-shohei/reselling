#!/usr/bin/env node
/*
 * build_identity_resolution_prompt.js
 *
 * 第 6 段階 工程 6-2 (同一商品判定) の Agent プロンプト組立スクリプト。
 * 6-1 の clusters.json から指定 groupId の仮クラスタを取り出し、
 * 仕様プロンプト本体 (research/identity_resolution_prompt.md) の末尾に
 * 「## 仮クラスタ」と「## 指定出力パス」セクションを追記する。
 *
 * 使い方:
 *   node research/build_identity_resolution_prompt.js <group-id> <run-dir>
 *
 * 入力:
 *   research/identity_resolution_prompt.md (仕様プロンプト本体、固定)
 *   <run-dir>/identity_resolution/clusters.json (6-1 出力)
 *   <run-dir>/image_review/images/{rowIndex}.webp (第 4 段階が DL 済みの実体画像)
 *
 * 出力:
 *   <run-dir>/identity_resolution/prompts/prompt_group_<groupId>.md
 *
 * 50 件超の仮クラスタはサブ分割する (50 件ずつ)。本スクリプトは呼ばれたときの
 * groupId が 50 件以下の場合はそのまま 1 プロンプトを出し、50 件超の場合は
 * サブ分割したサブバッチ用プロンプトを複数出す。サブバッチ用の出力ファイル名は
 * prompt_group_<groupId>_sub_<subIdx>.md / result_group_<groupId>_sub_<subIdx>.json
 */

const fs = require("node:fs");
const path = require("node:path");
const { writeFileSafe } = require("./_safe_write");

const PROMPT_BASE_PATH = path.resolve(
  path.join(__dirname, "identity_resolution_prompt.md"),
);
const SUB_BATCH_SIZE = 50;

function parseArgs() {
  const [, , groupIdArg, runDirArg] = process.argv;
  if (groupIdArg == null || !runDirArg) {
    console.error(
      "Usage: node research/build_identity_resolution_prompt.js <group-id> <run-dir>",
    );
    process.exit(1);
  }
  const n = Number(groupIdArg);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`group-id must be a non-negative integer: ${groupIdArg}`);
  }
  return { groupId: n, runDir: runDirArg.replace(/\/$/, "") };
}

function loadCluster(runDir, groupId) {
  const clustersPath = path.join(
    runDir,
    "identity_resolution",
    "clusters.json",
  );
  if (!fs.existsSync(clustersPath)) {
    throw new Error(`clusters.json does not exist: ${clustersPath}`);
  }
  const { groups } = JSON.parse(fs.readFileSync(clustersPath, "utf8"));
  const group = groups.find((g) => g.groupId === groupId);
  if (!group) {
    throw new Error(`group ${groupId} not found in ${clustersPath}`);
  }
  if (group.status === "singleton_confirmed") {
    throw new Error(
      `group ${groupId} is singleton_confirmed; no prompt needed for 1-item groups`,
    );
  }
  if (group.status === "skipped_below_threshold") {
    throw new Error(
      `group ${groupId} is skipped_below_threshold; ` +
        "count_total が閾値未満のため 6-2 の判定対象外 (プロンプト生成不要)",
    );
  }
  return group;
}

function buildItemsSection({ items, imagesDir }) {
  const lines = [];
  for (const it of items) {
    const imagePath = path.resolve(
      path.join(imagesDir, `${it.rowIndex}.webp`),
    );
    const attrsJson = JSON.stringify(it.attributes);
    lines.push(
      `- rowIndex=${it.rowIndex}, id=${it.id}\n` +
        `  name: ${it.name}\n` +
        `  imagePath: \`${imagePath}\`\n` +
        `  attributes: \`${attrsJson}\``,
    );
  }
  return lines.join("\n");
}

function buildTailSection({
  group,
  subItems,
  outputAbsPath,
  subInfo,
  imagesDir,
}) {
  const itemsSection = buildItemsSection({ items: subItems, imagesDir });
  const subNote = subInfo
    ? `\n\n**サブ分割注意**: このプロンプトは groupId=${group.groupId} のサブバッチ ${subInfo.subIdx}/${subInfo.subTotal} です (${subItems.length} 件)。同じ groupId の他サブバッチは別 Agent が別出力パスに書きます。サブバッチ間の同一判定は今回は行いません (取りこぼし許容)。\n`
    : "";
  return `## 仮クラスタ

- groupId: ${group.groupId}
- groupKey: \`${group.groupKey}\`
- items (${subItems.length} 件):${subNote}

${itemsSection}

## 指定出力パス (書き出し先、1 回だけ書く)

\`${outputAbsPath}\`

全 ${subItems.length} 件を画像 + タイトルで判定し、「## 出力フォーマット」に従って JSON を 1 回で書き込む。書き込み後、Read して件数と整合 (rowIndexes の和集合 == 入力全件) を自己検証すること。

## 作業開始の前に

1. プロンプト冒頭「## 【絶対禁則】ファイル操作の制約」を再確認
2. 上記 items の各 imagePath を Read して画像を取得
3. 各行のタイトル・画像・attributes (特に material) を見て subgroup に仕分け
4. 出力パスに 1 回で書き込み → 件数検証
`;
}

function main() {
  const { groupId, runDir } = parseArgs();
  const idDir = path.join(runDir, "identity_resolution");
  const promptsDir = path.join(idDir, "prompts");
  // 画像の実体は第 4 段階 (画像除外) が DL した image_review/images/ にある。
  // 以前は <run-dir>/images を参照しており、run ごとに symlink で回避していた
  // (run_notes 2026_06_02_09_10 §3.4 / 2026_06_16_21_45 の既知問題)。
  const imagesDir = path.resolve(path.join(runDir, "image_review", "images"));
  fs.mkdirSync(promptsDir, { recursive: true });

  const group = loadCluster(runDir, groupId);
  const base = fs.readFileSync(PROMPT_BASE_PATH, "utf8");

  const outputs = [];
  if (group.size <= SUB_BATCH_SIZE) {
    const outPath = path.join(
      promptsDir,
      `prompt_group_${groupId}.md`,
    );
    const resultAbsPath = path.resolve(
      path.join(idDir, "results", `result_group_${groupId}.json`),
    );
    const tail = buildTailSection({
      group,
      subItems: group.items,
      outputAbsPath: resultAbsPath,
      subInfo: null,
      imagesDir,
    });
    writeFileSafe(outPath, `${base.trimEnd()}\n\n---\n\n${tail}`, "utf8");
    outputs.push({
      groupId,
      subIdx: null,
      itemCount: group.items.length,
      promptPath: outPath,
      resultAbsPath,
    });
  } else {
    const subTotal = Math.ceil(group.size / SUB_BATCH_SIZE);
    for (let i = 0; i < subTotal; i++) {
      const subItems = group.items.slice(
        i * SUB_BATCH_SIZE,
        (i + 1) * SUB_BATCH_SIZE,
      );
      const subStr = String(i + 1).padStart(2, "0");
      const outPath = path.join(
        promptsDir,
        `prompt_group_${groupId}_sub_${subStr}.md`,
      );
      const resultAbsPath = path.resolve(
        path.join(
          idDir,
          "results",
          `result_group_${groupId}_sub_${subStr}.json`,
        ),
      );
      const tail = buildTailSection({
        group,
        subItems,
        outputAbsPath: resultAbsPath,
        subInfo: { subIdx: i + 1, subTotal },
        imagesDir,
      });
      writeFileSafe(outPath, `${base.trimEnd()}\n\n---\n\n${tail}`, "utf8");
      outputs.push({
        groupId,
        subIdx: i + 1,
        itemCount: subItems.length,
        promptPath: outPath,
        resultAbsPath,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        groupId,
        groupSize: group.size,
        subBatchSize: SUB_BATCH_SIZE,
        outputs,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main();
}

module.exports = { buildItemsSection, buildTailSection, SUB_BATCH_SIZE };
