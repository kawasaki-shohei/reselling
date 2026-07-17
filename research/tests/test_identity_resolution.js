// 第 6 段階 (同一商品判定) の単体テスト。
// Node 組み込みの assert のみ。実行: node research/tests/test_identity_resolution.js
//
// 網羅対象 (純粋関数 + 一時ディレクトリを使う集約のみ、CLI 起動はカバーしない):
//   - build_identity_clusters.clusterRows / decideGroupStatus / summarize
//     (count_total 付与と skipped_below_threshold 判定)
//   - build_identity_resolution_packed_prompts.packPendingGroups / buildPackTailSection
//   - assign_final_cluster_ids.buildFinalClusters (skipped グループの素通し)

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  clusterRows,
  decideGroupStatus,
  summarize,
} = require("../build_identity_clusters");
const {
  packPendingGroups,
  buildPackTailSection,
  packFileName,
} = require("../build_identity_resolution_packed_prompts");
const { buildFinalClusters } = require("../assign_final_cluster_ids");
const { PURCHASE_THRESHOLD } = require("../_purchase_threshold");

const failures = [];
function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`FAIL  ${name}`);
  }
}

function row(rowIndex, attrs) {
  return {
    rowIndex,
    id: `m${rowIndex}`,
    name: `商品${rowIndex}`,
    attributes: {
      category: "ショーツ",
      subcategory: null,
      color: null,
      size: null,
      quantity: null,
      pattern: null,
      material: null,
      ...attrs,
    },
  };
}

function group(groupId, status, items, extra = {}) {
  return {
    groupId,
    groupKey: `category=ショーツ|subcategory=null|color=null|size=null|quantity=null|pattern=null`,
    size: items.length,
    status,
    items,
    ...extra,
  };
}

// --- decideGroupStatus ---

test("decideGroupStatus: 1 件は count に関わらず singleton_confirmed", () => {
  assert.equal(decideGroupStatus([row(1, {})], 5), "singleton_confirmed");
  assert.equal(decideGroupStatus([row(1, {})], 1), "singleton_confirmed");
});

test("decideGroupStatus: 2 件以上で count_total が閾値未満なら skipped_below_threshold", () => {
  const items = [row(1, {}), row(2, {})];
  assert.equal(
    decideGroupStatus(items, PURCHASE_THRESHOLD - 1),
    "skipped_below_threshold",
  );
});

test("decideGroupStatus: 2 件以上で count_total が閾値ちょうどなら pending", () => {
  const items = [row(1, {}), row(2, {})];
  assert.equal(decideGroupStatus(items, PURCHASE_THRESHOLD), "pending");
});

// --- clusterRows ---

test("clusterRows: count_total を ids 数から集計し status を振り分ける", () => {
  const rows = [
    // グループ A: 2 行 × count 1+1=2 → skipped
    row(1, { color: ["ブラック"] }),
    row(2, { color: ["ブラック"] }),
    // グループ B: 2 行 × count 2+1=3 → pending
    row(3, { color: ["ホワイト"] }),
    row(4, { color: ["ホワイト"] }),
    // グループ C: 1 行 → singleton
    row(5, { color: ["レッド"] }),
  ];
  const counts = new Map([
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 1],
    [5, 4],
  ]);
  const groups = clusterRows(rows, counts);
  const byColor = new Map(
    groups.map((g) => [g.items[0].attributes.color[0], g]),
  );
  assert.equal(byColor.get("ブラック").status, "skipped_below_threshold");
  assert.equal(byColor.get("ブラック").count_total, 2);
  assert.equal(byColor.get("ホワイト").status, "pending");
  assert.equal(byColor.get("ホワイト").count_total, 3);
  assert.equal(byColor.get("レッド").status, "singleton_confirmed");
  assert.equal(byColor.get("レッド").count_total, 4);
});

test("clusterRows: counts に無い rowIndex は 1 件として数える", () => {
  const rows = [row(1, {}), row(2, {}), row(3, {})];
  const groups = clusterRows(rows, new Map());
  assert.equal(groups.length, 1);
  // count_total = 1+1+1 = 3 >= 閾値 → pending (size >= 3 のグループは常に pending)
  assert.equal(groups[0].count_total, 3);
  assert.equal(groups[0].status, "pending");
});

// --- summarize ---

test("summarize: pending / skipped / multiItem を分けて数える", () => {
  const groups = [
    group(0, "singleton_confirmed", [row(1, {})]),
    group(1, "pending", [row(2, {}), row(3, {})]),
    group(2, "skipped_below_threshold", [row(4, {}), row(5, {})]),
  ];
  const s = summarize(groups);
  assert.equal(s.groupCount, 3);
  assert.equal(s.singletonGroups, 1);
  assert.equal(s.pendingGroups, 1);
  assert.equal(s.skippedBelowThresholdGroups, 1);
  // multiItemGroups は「2 件以上のグループ数」(構造の指標) のまま
  assert.equal(s.multiItemGroups, 2);
  assert.equal(s.purchaseThreshold, PURCHASE_THRESHOLD);
});

// --- packPendingGroups ---

function pendingGroupOfSize(groupId, size) {
  const items = [];
  for (let i = 0; i < size; i++) items.push(row(groupId * 1000 + i, {}));
  return group(groupId, "pending", items);
}

test("packPendingGroups: groupId 順に上限まで詰め、超えたら次の pack へ", () => {
  const groups = [
    pendingGroupOfSize(0, 10),
    pendingGroupOfSize(1, 20),
    pendingGroupOfSize(2, 20),
    pendingGroupOfSize(3, 10),
  ];
  const { packs, subSplitRequired } = packPendingGroups(groups, 50);
  assert.equal(subSplitRequired.length, 0);
  assert.deepEqual(
    packs.map((p) => p.map((g) => g.groupId)),
    [[0, 1, 2], [3]],
  );
});

test("packPendingGroups: 上限ちょうどの単独グループは 1 pack を占有する", () => {
  const groups = [pendingGroupOfSize(0, 50), pendingGroupOfSize(1, 2)];
  const { packs } = packPendingGroups(groups, 50);
  assert.deepEqual(
    packs.map((p) => p.map((g) => g.groupId)),
    [[0], [1]],
  );
});

test("packPendingGroups: 上限超のグループは packs に入れず subSplitRequired に分離", () => {
  const groups = [pendingGroupOfSize(0, 51), pendingGroupOfSize(1, 3)];
  const { packs, subSplitRequired } = packPendingGroups(groups, 50);
  assert.deepEqual(subSplitRequired.map((g) => g.groupId), [0]);
  assert.deepEqual(
    packs.map((p) => p.map((g) => g.groupId)),
    [[1]],
  );
});

test("packPendingGroups: pending 以外 (singleton / skipped) は対象外", () => {
  const groups = [
    group(0, "singleton_confirmed", [row(1, {})]),
    group(1, "skipped_below_threshold", [row(2, {}), row(3, {})]),
    pendingGroupOfSize(2, 4),
  ];
  const { packs, subSplitRequired } = packPendingGroups(groups, 50);
  assert.equal(subSplitRequired.length, 0);
  assert.deepEqual(
    packs.map((p) => p.map((g) => g.groupId)),
    [[2]],
  );
});

// --- buildPackTailSection / packFileName ---

test("buildPackTailSection: グループごとの出力パスと逐次 Write 指示を含む", () => {
  const packGroups = [pendingGroupOfSize(7, 2), pendingGroupOfSize(9, 3)];
  const tail = buildPackTailSection({
    packGroups,
    resultsAbsDir: "/abs/results",
    imagesDir: "/abs/images",
  });
  assert.ok(tail.includes("仮クラスタ 1/2 (groupId=7)"));
  assert.ok(tail.includes("仮クラスタ 2/2 (groupId=9)"));
  assert.ok(tail.includes(path.join("/abs/results", "result_group_7.json")));
  assert.ok(tail.includes(path.join("/abs/results", "result_group_9.json")));
  assert.ok(tail.includes("判定が完了するたびに"));
  assert.ok(tail.includes("計 2 回"));
});

test("packFileName: 3 桁ゼロ埋め", () => {
  assert.equal(packFileName(0), "prompt_pack_000.md");
  assert.equal(packFileName(12), "prompt_pack_012.md");
});

// --- buildFinalClusters (skipped グループの扱い) ---

test("buildFinalClusters: skipped グループは cluster_id 無しで素通しし、結果ファイルを読まない", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "idres-test-"));
  try {
    const resultsDir = path.join(tmpDir, "results");
    fs.mkdirSync(resultsDir);
    // skipped グループ (groupId=0) の結果ファイルが「存在しても」読まれないことを確認
    fs.writeFileSync(
      path.join(resultsDir, "result_group_0.json"),
      JSON.stringify({
        groupId: 0,
        groupKey: "k",
        subgroups: [{ subgroupId: 1, rowIndexes: [1, 2], reason: "過去runの残骸" }],
      }),
    );
    const groups = [
      group(0, "skipped_below_threshold", [row(1, {}), row(2, {})]),
      group(1, "singleton_confirmed", [row(3, {})]),
    ];
    const rowCounts = new Map([
      [1, 1],
      [2, 1],
      [3, 3],
    ]);
    const clusters = buildFinalClusters({ groups, resultsDir, rowCounts });

    const skipped = clusters.find((c) => c.source === "skipped_below_threshold");
    assert.ok(skipped, "skipped エントリが存在する");
    assert.equal(skipped.cluster_id, null);
    assert.equal(skipped.size, 2);
    assert.equal(skipped.count_total, 2);
    assert.equal(skipped.is_purchase_candidate, false);
    // 結果ファイルの subgroup 分割 (2 クラスタ化) が適用されていない = 素通し
    assert.equal(
      clusters.filter((c) => c.source_group_id === 0).length,
      1,
      "skipped グループは 1 エントリのまま",
    );

    const singleton = clusters.find((c) => c.source === "singleton");
    assert.equal(singleton.count_total, 3);
    assert.equal(singleton.is_purchase_candidate, true);

    // 被覆不変: 全 row がいずれかのエントリに属する
    const totalRows = clusters.reduce((a, c) => a + c.size, 0);
    assert.equal(totalRows, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- 結果表示 ---

if (failures.length > 0) {
  console.log(`\n${failures.length} 件失敗:`);
  for (const f of failures) {
    console.log(`\n--- ${f.name} ---`);
    console.log(f.error && f.error.stack ? f.error.stack : String(f.error));
  }
  process.exit(1);
}
console.log("\n全テスト PASS");
