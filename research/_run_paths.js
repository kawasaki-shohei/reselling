// リサーチパイプラインの出力パス共通ロジック
//
// 生データファイル名 (research/YYYY_MM_DD_HH_MM__mercari_14day_results.json) から
// タイムスタンプ <ts> = "YYYY_MM_DD_HH_MM" を抽出し、第 2〜6 段階の出力ディレクトリ
// research/runs/<ts>/<stage>/ を導出する。
//
// 1 回のリサーチ run の成果物は同じ <ts> ディレクトリ配下にまとまるよう、全段階で
// 本モジュールを経由すること。

const path = require('path');

const TS_REGEX = /^(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/;

function extractTimestamp(inputPath) {
  const base = path.basename(inputPath);
  const m = base.match(TS_REGEX);
  if (!m) {
    throw new Error(
      `Cannot extract YYYY_MM_DD_HH_MM timestamp from input filename: ${base}. ` +
      `Expected pattern like "2026_04_16_06_47__mercari_14day_results.json".`
    );
  }
  return `${m[1]}_${m[2]}_${m[3]}_${m[4]}_${m[5]}`;
}

function getRunDir(inputPath, stage) {
  const ts = extractTimestamp(inputPath);
  return path.join('research', 'runs', ts, stage);
}

module.exports = { extractTimestamp, getRunDir };
