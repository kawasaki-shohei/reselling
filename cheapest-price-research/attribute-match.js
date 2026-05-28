#!/usr/bin/env node
// 7 軸機械照合 CLI
//
// 入力:
//   --target       <target_attributes.json の絶対パス>
//   --candidates   <candidate_attributes/page_NN.json の絶対パス>
//   --product-code <商品番号>
//   --output       <matched_candidates/page_NN.json の絶対パス>
//
// 処理:
//   target_attributes.json から商品番号の 7 軸を取得し、
//   candidate_attributes の各候補の 7 軸と比較する。
//   1 軸でも明らかに違えば対象外 (rejected)、unknown は通す (matched)。
//   color は配列。target 色のいずれかが candidate 色に含まれれば match。
//
// 出力 JSON 構造:
//   {
//     page, productCode,
//     matched: [{rank, id, price, mismatch_axes: []}, ...],   // rank 昇順
//     rejected: [{rank, id, price, mismatch_axes: [...]}, ...]
//   }

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

// 軸ごとの比較ロジック
// 戻り値: true = match (一致 or unknown で通す)、false = mismatch
function compareAxis(axis, targetValue, candidateValue) {
  // unknown 扱い (null / undefined / 空配列 / 空文字)
  const isUnknown = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  if (isUnknown(targetValue) || isUnknown(candidateValue)) return true;

  if (axis === 'color') {
    // 両方配列。target の色のいずれかが candidate に含まれれば match
    if (!Array.isArray(targetValue) || !Array.isArray(candidateValue)) return false;
    const normalizeColor = (c) => String(c).trim().toLowerCase();
    const tSet = new Set(targetValue.map(normalizeColor));
    const cSet = new Set(candidateValue.map(normalizeColor));
    for (const c of tSet) {
      if (cSet.has(c)) return true;
    }
    return false;
  }

  // それ以外: 文字列比較 (前後空白除去、大文字小文字無視)
  const normalize = (v) => String(v).trim().toLowerCase();
  return normalize(targetValue) === normalize(candidateValue);
}

function main() {
  const args = parseArgs(process.argv);
  const required = ['target', 'candidates', 'product-code', 'output'];
  for (const k of required) {
    if (!args[k]) {
      console.error(`Missing required arg: --${k}`);
      process.exit(1);
    }
  }

  const targetAttrs = JSON.parse(fs.readFileSync(args.target, 'utf8'));
  const candidateAttrs = JSON.parse(fs.readFileSync(args.candidates, 'utf8'));

  const productCode = args['product-code'];
  const targetProduct = targetAttrs.products && targetAttrs.products[productCode];
  if (!targetProduct) {
    console.error(`Product code not found in target_attributes.json: ${productCode}`);
    process.exit(1);
  }
  const tAttr = targetProduct.attributes;

  const axes = ['category', 'subcategory', 'color', 'size', 'quantity', 'pattern', 'material'];

  const matched = [];
  const rejected = [];

  for (const cand of candidateAttrs.candidates) {
    const cAttr = cand.attributes || {};
    const mismatchAxes = [];
    for (const axis of axes) {
      if (!compareAxis(axis, tAttr[axis], cAttr[axis])) {
        mismatchAxes.push(axis);
      }
    }
    const entry = {
      rank: cand.rank,
      id: cand.id,
      price: cand.price,
      mismatch_axes: mismatchAxes
    };
    if (mismatchAxes.length === 0) {
      matched.push(entry);
    } else {
      rejected.push(entry);
    }
  }

  // 価格昇順 (= rank 昇順) でソート
  matched.sort((a, b) => a.rank - b.rank);
  rejected.sort((a, b) => a.rank - b.rank);

  const output = {
    page: candidateAttrs.page,
    productCode,
    matched,
    rejected
  };

  const outDir = path.dirname(args.output);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));

  const summary = {
    output: args.output,
    page: output.page,
    productCode,
    matchedCount: matched.length,
    rejectedCount: rejected.length,
    matchedRanks: matched.map(m => m.rank)
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
