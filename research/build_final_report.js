#!/usr/bin/env node
/*
 * build_final_report.js
 *
 * 第 7 段階 (purchase_candidate_export_step)。
 * 6-3 の final_clusters.json から is_purchase_candidate=true のクラスタのみを
 * CSV に書き出す。
 *
 * 使い方:
 *   node research/build_final_report.js <run-dir> <raw-data-path> [final-clusters-path]
 *
 * 例:
 *   node research/build_final_report.js \
 *     research/runs/2026_04_23_10_00 \
 *     research/2026_04_23_10_00__mercari_14day_results.json
 *
 * 入力:
 *   <run-dir>/identity_resolution/final_clusters.json (第 6 段階 6-3 の出力)
 *     第 3 引数で別パス (例: final_clusters_alt.json) を明示指定可能
 *   <raw-data-path>                                    (第 1 段階の生データ、価格と URL を引く)
 *
 * 価格と URL の引き方:
 *   cluster.items[i].id で raw.items を検索する (id → item の Map を事前構築)。
 *   rowIndex は aggregate TSV の行番号であり raw.items の添字ではないため、
 *   添字として使うと別商品を指してしまう (過去に発生したバグへの対処)。
 *
 * 出力:
 *   reports/YYYY/MM/YYYY_MM_DD_NN_メルカリ売れ筋リサーチ_v2.csv
 *     - YYYY/MM/DD は実行日 (JST)
 *     - NN は同日内の連番 (01 から 2 桁ゼロ埋め、既存ファイル走査で自動採番)
 *
 * CSV フォーマット:
 *   - UTF-8 (BOM 無し)
 *   - 区切り: カンマ、改行: LF
 *   - ヘッダ行あり
 *   - null は空セル (文字列 "null" は書かない)
 *   - カンマ / 改行 / ダブルクォートを含む値のみクォートし、値中のダブルクォートは "" にエスケープ (RFC 4180 準拠)
 *
 * カラム (15 列):
 *   cluster_id, count, representative_title, price_min, price_max,
 *   category, subcategory, color, size, quantity, pattern, material,
 *   url_1, url_2, url_3
 *
 * count 列の意味:
 *   cluster 内の全 row の ids 合計 (= 14 日内に売れた件数)。final_clusters.json の
 *   count_total を採用し、無ければ size (= row 数) にフォールバックする。
 *
 * 不変性原則: 出力パスが既に存在する場合はエラー停止 (共通原則 1)。
 */

const fs = require("node:fs");
const path = require("node:path");
const { writeFileSafe } = require("./_safe_write");

const COLUMNS = [
  "cluster_id",
  "count",
  "representative_title",
  "price_min",
  "price_max",
  "category",
  "subcategory",
  "color",
  "size",
  "quantity",
  "pattern",
  "material",
  "url_1",
  "url_2",
  "url_3",
];

const REPORTS_ROOT = "reports";
const FILE_NAME_SUFFIX = "メルカリ売れ筋リサーチ_v2";

function parseArgs() {
  const [, , runDirArg, rawPathArg, finalClustersArg] = process.argv;
  if (!runDirArg || !rawPathArg) {
    console.error(
      "Usage: node research/build_final_report.js <run-dir> <raw-data-path> [final-clusters-path]",
    );
    process.exit(1);
  }
  return {
    runDir: runDirArg.replace(/\/$/, ""),
    rawPath: rawPathArg,
    finalClustersPath: finalClustersArg ?? null,
  };
}

function jstDateParts(now = new Date()) {
  // now.getTime() は UTC ms。+9h して getUTC* で読むと JST の年月日になる。
  // getTimezoneOffset() を使うと実行環境の TZ で結果が変わるので使わない。
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = String(jst.getUTCFullYear());
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  return { yyyy, mm, dd };
}

function pickNextSequence(outDir, dateStr) {
  if (!fs.existsSync(outDir)) return "01";
  const re = new RegExp(
    `^${dateStr}_(\\d{2})_${FILE_NAME_SUFFIX}\\.csv$`,
  );
  const used = fs
    .readdirSync(outDir)
    .map((name) => name.match(re))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const next = used.length === 0 ? 1 : Math.max(...used) + 1;
  return String(next).padStart(2, "0");
}

function buildOutputPath(now = new Date()) {
  const { yyyy, mm, dd } = jstDateParts(now);
  const outDir = path.join(REPORTS_ROOT, yyyy, mm);
  const dateStr = `${yyyy}_${mm}_${dd}`;
  const nn = pickNextSequence(outDir, dateStr);
  const fileName = `${dateStr}_${nn}_${FILE_NAME_SUFFIX}.csv`;
  return { outDir, outPath: path.join(outDir, fileName) };
}

function formatColor(color) {
  if (color == null) return "";
  if (Array.isArray(color)) {
    return color.filter((v) => v != null).join(" ");
  }
  return String(color);
}

function quoteCsvField(value) {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function computePriceRange(items, rawById) {
  const prices = [];
  for (const it of items) {
    const raw = rawById.get(it.id);
    if (raw != null && typeof raw.price === "number") prices.push(raw.price);
  }
  if (prices.length === 0) return { min: null, max: null };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function pickUrls(items, rawById) {
  const urls = [];
  for (let i = 0; i < 3; i++) {
    const it = items[i];
    if (it == null) {
      urls.push(null);
      continue;
    }
    const raw = rawById.get(it.id);
    urls.push(raw != null && raw.url ? raw.url : null);
  }
  return urls;
}

function buildRow(cluster, rawById) {
  const attrs = cluster.representative_attributes ?? {};
  const { min, max } = computePriceRange(cluster.items, rawById);
  const [url1, url2, url3] = pickUrls(cluster.items, rawById);
  return {
    cluster_id: cluster.cluster_id,
    count: cluster.count_total ?? cluster.size,
    representative_title: cluster.items[0]?.name ?? "",
    price_min: min,
    price_max: max,
    category: attrs.category,
    subcategory: attrs.subcategory,
    color: formatColor(attrs.color),
    size: attrs.size,
    quantity: attrs.quantity,
    pattern: attrs.pattern,
    material: attrs.material,
    url_1: url1,
    url_2: url2,
    url_3: url3,
  };
}

function toCsvLine(values) {
  return values.map(quoteCsvField).join(",");
}

function main() {
  const { runDir, rawPath, finalClustersPath: explicitPath } = parseArgs();

  const finalClustersPath =
    explicitPath ??
    path.join(runDir, "identity_resolution", "final_clusters.json");
  if (!fs.existsSync(finalClustersPath)) {
    throw new Error(`final_clusters.json does not exist: ${finalClustersPath}`);
  }
  if (!fs.existsSync(rawPath)) {
    throw new Error(`raw data file does not exist: ${rawPath}`);
  }

  const { clusters } = JSON.parse(fs.readFileSync(finalClustersPath, "utf8"));
  if (!Array.isArray(clusters)) {
    throw new Error(
      `final_clusters.json does not have clusters array: ${finalClustersPath}`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  const rawItems = Array.isArray(raw) ? raw : raw.items;
  if (!Array.isArray(rawItems)) {
    throw new Error(`raw data does not have items array: ${rawPath}`);
  }
  const rawById = new Map(
    rawItems.filter((x) => x && typeof x.id === "string").map((it) => [it.id, it]),
  );

  const targets = clusters.filter((c) => c.is_purchase_candidate === true);

  const { outDir, outPath } = buildOutputPath();
  fs.mkdirSync(outDir, { recursive: true });

  const lines = [toCsvLine(COLUMNS)];
  for (const cluster of targets) {
    const row = buildRow(cluster, rawById);
    lines.push(toCsvLine(COLUMNS.map((k) => row[k])));
  }
  const csv = lines.join("\n") + "\n";

  writeFileSafe(outPath, csv, "utf8");

  console.log(
    JSON.stringify(
      {
        outPath,
        totalClusters: clusters.length,
        purchaseCandidates: targets.length,
        rows: targets.length,
        columns: COLUMNS.length,
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
  COLUMNS,
  quoteCsvField,
  formatColor,
  jstDateParts,
  pickNextSequence,
  buildOutputPath,
  computePriceRange,
  pickUrls,
  buildRow,
  toCsvLine,
};
