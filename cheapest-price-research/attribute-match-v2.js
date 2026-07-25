#!/usr/bin/env node
// 7 軸機械照合 CLI v2 — 正規化 + 近似比較 + 4 値出力
//
// v1 (attribute-match.js) からの変更点 (背景: runs/2026_07_21_21_50/run_notes.md §8.3 / §9.1):
//   1. 比較前に決定的正規化を行う (NFKC / 小文字化 / 空白除去 / 括弧書き除去 / 約・およそ除去)
//      → 「PUレザー(合皮)」vs「PUレザー」、「無地(型押し)」vs「無地」等の表記差で落ちない
//   2. size は数値抽出して ±10% 以内なら一致、範囲表記 (22.2-31.8mm) は包含判定
//      → 「約14.5cm」vs「15cm」(実測 vs 公称) で落ちない
//   3. subcategory / category / pattern は包含一致を許容 (片方が他方を含めば一致)
//      → 「回転式2段」vs「回転式2段ピアス・ブレスレット収納スタンド」で落ちない
//      ただし包含が成立しても、長い側にだけ現れる差分に構成品追加マーカー
//      (セット / 付き / + / 同梱 / 入り) があれば一致としない (ADDON_MARKER)
//      → 「防草シート用U字ピン杭」vs「同・黒丸プレートセット」は別商品として弾く
//        (回帰テスト 2026-07-22 で追加。tmp/2026/07/22/ の質問/回答ファイル参照)
//   4. quantity は数値抽出して数値で比較 (単位語の差 1点/1個/1枚 を無視)
//   5. color は同義語テーブル (黒=ブラック等) を通してから配列重なり判定
//   6. material は棄却軸から除外し参考情報に降格 (advisory_mismatch_axes に記録のみ)
//      → mercari-research-v2.md 6-1 の「material は判定困難で揺れやすいため軸外」と同判断
//   7. 出力を 4 値に分割:
//        matched      — 全 hard 軸一致
//        near_miss    — 1 軸のみ不一致 (旧 run で親が手作業していた「代替系」の正式化)
//        insufficient — 候補側の判明軸が 2 つ以下 (全 null 素通り対策: パチンコ画面事故の再発防止)
//        rejected     — 2 軸以上不一致
//   8. --exclude-id で対象商品自身の出品を機械的に除外
//   9. --owner-id + --rivals で **物販オーナー自身の出品を own 区分に分離** (2026-07-26 追加)
//      検索は価格昇順・判定は「最初に true で打ち切り」のため、自分の再出品が先に true になると
//      他人の最安が分からないまま終わる。判定対象からは外し、情報としては own に残す。
//
// 使い方:
//   node attribute-match-v2.js \
//     --target <target_attributes.json> \
//     --candidates <candidate_attributes/page_NN.json> \
//     --product-code <商品番号> \
//     --output <matched_candidates_v2/page_NN.json> \
//     [--exclude-id <対象自身の item id>] \
//     [--owner-id <オーナーのメルカリ出品者ID>] [--rivals <rivals/page_NN.json,...>]
//
//   出品者 ID は rivals JSON にしか無いため、own 判定には --rivals も必要
//   (候補属性 JSON には sellerId が無い)。両方省略すると own は常に空になる。
//
// v1 は監査可能性のため不変で残す。過去 run の再現には v1 を使うこと。

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------
// 正規化プリミティブ
// ---------------------------------------------------------------

function stripParens(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/[（(][^()（）]*[）)]/g, '');
  } while (s !== prev);
  return s;
}

function norm(v) {
  if (v === null || v === undefined) return '';
  let t = String(v).normalize('NFKC');
  t = stripParens(t);
  t = t.toLowerCase();
  t = t.replace(/\s+/g, '');
  t = t.replace(/約|およそ/g, '');
  t = t.replace(/xxxl/g, '3xl').replace(/xxl/g, '2xl');
  return t;
}

function isUnknownRaw(v) {
  return v === null || v === undefined || v === '' ||
    (Array.isArray(v) && v.length === 0);
}

// フリーサイズ系は「サイズ展開なし」の意で、S/M/L 系との比較が定義できないため unknown 扱い
const FREE_SIZE = new Set(['フリーサイズ', 'フリー', 'free', 'f', 'freesize', 'ワンサイズ', 'onesize'].map(norm));

// ---------------------------------------------------------------
// color: 同義語テーブル → 正準形に写してから配列重なり判定
// 純粋な表記ゆれ (漢字/カタカナ/英字) のみ。色味の統合 (グレー↔ダークグレー等) はしない
// ---------------------------------------------------------------

const COLOR_SYNONYMS = [
  ['黒', 'ブラック', 'black', '黒色'],
  ['白', 'ホワイト', 'white', '白色'],
  ['赤', 'レッド', 'red', '赤色'],
  ['青', 'ブルー', 'blue'],
  ['緑', 'グリーン', 'green'],
  ['黄', '黄色', 'イエロー', 'yellow'],
  ['金', 'ゴールド', 'gold', '金色'],
  ['銀', 'シルバー', 'silver', '銀色'],
  ['茶', '茶色', 'ブラウン', 'brown'],
  ['灰', '灰色', 'グレー', 'グレイ', 'gray', 'grey'],
  ['紫', 'パープル', 'purple'],
  ['ピンク', '桃', '桃色', 'pink'],
  ['橙', 'オレンジ', 'orange'],
  ['水色', 'ライトブルー', 'スカイブルー'],
  ['紺', 'ネイビー', 'navy'],
  ['透明', 'クリア', 'クリアー', 'clear'],
  ['ベージュ', 'beige'],
];

const COLOR_CANON = new Map();
for (const group of COLOR_SYNONYMS) {
  for (const w of group) COLOR_CANON.set(norm(w), norm(group[0]));
}

function canonColor(c) {
  const n = norm(c);
  return COLOR_CANON.get(n) || n;
}

function colorMatch(a, b) {
  if (isUnknownRaw(a) || isUnknownRaw(b)) return true;
  const A = (Array.isArray(a) ? a : [a]).map(canonColor).filter(Boolean);
  const B = (Array.isArray(b) ? b : [b]).map(canonColor).filter(Boolean);
  if (!A.length || !B.length) return true;
  return A.some((c) => B.includes(c));
}

// ---------------------------------------------------------------
// テキスト軸 (category / subcategory / pattern):
// 正規化後の等価、または包含 (片方が他方を含む) で一致
// ---------------------------------------------------------------

// 構成品追加マーカー。
// 包含一致は「表記の差」を吸収するための緩和であって「実体の差」を通すためのものではない。
// 包含が成立したとき、長い側にだけ現れる差分 (residual) にこれらの語が含まれるなら、
// それは「対象に無い物が候補に付いている」= 中身が違う、というシグナルなので一致としない。
//
// 実データ根拠 (run 2026_07_21_21_50 / FD02802 "Uピン杭 100本 15cm"):
//   対象 subcategory "防草シート用U字ピン杭" ⊂ 候補 "防草シート用U字ピン杭・黒丸プレートセット"
//   → 素の包含一致では matched。しかし同 run の画像判定 reason は
//     「photo_3・photo_4 に『※黒丸板は付属しません』と明記」と、プレート付きを別商品と確定判断済み。
//   本ルール導入で FD02802 の matched 24→4 (残る 4 件はすべてプレートなしの杭単体)。
// 経緯: tmp/2026/07/22/2026_07_22_02_attribute-match-v2_質問への回答.md (選択肢1・実装条件1〜4)
//
// 保守的に維持すること。語を足す場合は必ず全 30 商品で回帰を取り直す。
const ADDON_MARKER = /セット|付き|[+＋]|同梱|入り/;

// 付加語チェックはテキスト 3 軸 (category / subcategory / pattern) のみに適用する。
// quantity は数値比較が主経路 (「2個セット」vs「2個」を壊さないため適用しない)、
// size も数値比較が主経路のため不要、material は参考軸のため素の包含一致のまま。
function textMatch(a, b, checkAddon = false) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return true; // 正規化後に空 = unknown → 通す
  if (na === nb) return true;
  if (na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))) {
    if (checkAddon) {
      // residual は正規化後の文字列に対して取る (括弧書き除去・NFKC 後)。
      // 正規化前に見ると「(ケース付き)」のような括弧内の語で挙動が変わってしまう。
      const [shortS, longS] = na.length <= nb.length ? [na, nb] : [nb, na];
      const residual = longS.split(shortS).join('');
      if (ADDON_MARKER.test(residual)) return false;
    }
    return true;
  }
  return false;
}

const textMatchStrict = (a, b) => textMatch(a, b, true);

// ---------------------------------------------------------------
// size: 数値 ±10%、範囲包含、記号サイズは正規化等価/包含
// ---------------------------------------------------------------

function extractNumbers(s) {
  const m = String(s).match(/\d+(?:\.\d+)?/g);
  return m ? m.map(Number) : [];
}

function extractRanges(s) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*[-〜~－]\s*(\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(String(s)))) {
    const lo = Math.min(Number(m[1]), Number(m[2]));
    const hi = Math.max(Number(m[1]), Number(m[2]));
    out.push([lo, hi]);
  }
  return out;
}

function near(a, b, tol = 0.1) {
  return Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
}

function sizeMatch(aRaw, bRaw) {
  const na = norm(aRaw), nb = norm(bRaw);
  if (!na || !nb) return true;
  if (FREE_SIZE.has(na) || FREE_SIZE.has(nb)) return true;
  if (na === nb) return true;
  if (na.length >= 1 && nb.length >= 1 && (na.includes(nb) || nb.includes(na))) return true;

  const numsA = extractNumbers(na), numsB = extractNumbers(nb);

  // 範囲包含 (例: 対象 31.8mm / 候補 22.2-31.8mm)
  for (const [lo, hi] of extractRanges(na)) {
    if (numsB.some((n) => n >= lo * 0.98 && n <= hi * 1.02)) return true;
  }
  for (const [lo, hi] of extractRanges(nb)) {
    if (numsA.some((n) => n >= lo * 0.98 && n <= hi * 1.02)) return true;
  }

  if (numsA.length && numsB.length) {
    if (numsA.length === numsB.length) {
      const sa = [...numsA].sort((x, y) => x - y);
      const sb = [...numsB].sort((x, y) => x - y);
      return sa.every((v, i) => near(v, sb[i]));
    }
    const [shorter, longer] = numsA.length < numsB.length ? [numsA, numsB] : [numsB, numsA];
    if (shorter.length === 1) return longer.some((v) => near(shorter[0], v));
    return false;
  }
  return false;
}

// ---------------------------------------------------------------
// quantity: 数値(複数可)を抽出し数値集合で比較。単位語 (点/個/枚/本) の差は無視
// ---------------------------------------------------------------

function quantityMatch(aRaw, bRaw) {
  const na = norm(aRaw), nb = norm(bRaw);
  if (!na || !nb) return true;
  if (na === nb) return true;
  const A = extractNumbers(na), B = extractNumbers(nb);
  if (A.length && B.length) {
    if (A.length !== B.length) return false;
    const sa = [...A].sort((x, y) => x - y);
    const sb = [...B].sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
  }
  if (!A.length && !B.length) {
    return na.includes(nb) || nb.includes(na);
  }
  return false;
}

// ---------------------------------------------------------------
// 評価
// ---------------------------------------------------------------

const HARD_AXES = ['category', 'subcategory', 'color', 'size', 'quantity', 'pattern'];
const ADVISORY_AXES = ['material'];

const AXIS_FN = {
  category: textMatchStrict,
  subcategory: textMatchStrict,
  pattern: textMatchStrict,
  color: colorMatch,
  size: sizeMatch,
  quantity: quantityMatch,
  material: textMatch,
};

function isAxisKnown(axis, v) {
  if (isUnknownRaw(v)) return false;
  if (axis === 'color') return (Array.isArray(v) ? v : [v]).some((c) => norm(c) !== '');
  return norm(v) !== '';
}

const MIN_FILLED_AXES = 3; // 判明軸がこれ未満 (=2 以下) の候補は insufficient

function evaluateCandidate(tAttr, cAttr) {
  const mismatch = [];
  for (const axis of HARD_AXES) {
    if (!AXIS_FN[axis](tAttr[axis], cAttr[axis])) mismatch.push(axis);
  }
  const advisoryMismatch = [];
  for (const axis of ADVISORY_AXES) {
    if (!AXIS_FN[axis](tAttr[axis], cAttr[axis])) advisoryMismatch.push(axis);
  }
  const filled = HARD_AXES.filter((axis) => isAxisKnown(axis, cAttr[axis])).length;

  let status;
  if (filled < MIN_FILLED_AXES) status = 'insufficient';
  else if (mismatch.length === 0) status = 'matched';
  else if (mismatch.length === 1) status = 'near_miss';
  else status = 'rejected';

  return { mismatch, advisoryMismatch, filled, status };
}

// ---------------------------------------------------------------
// 本体
// ---------------------------------------------------------------

/**
 * @param sellerIdOf  (id) => sellerId  候補の出品者 ID を引く関数 (rivals JSON 由来)。省略可
 * @param ownerId     物販オーナー自身のメルカリ出品者 ID。省略可
 *
 * オーナー自身の出品は `own` 区分に分け、matched/near_miss には入れない。
 * WHY: 検索は価格昇順で、判定は「最初に true が出たら打ち切り」なので、
 *      自分の再出品が先に true になると **他人の最安が分からないまま終わる**。
 *      一方で「自分が今いくらで再出品しているか」は値付けの材料になるので捨てない。
 *      → 判定対象からは外し、情報としては own に残す (除外ではなく区別)。
 */
function matchProduct(targetAttrs, candidateAttrs, productCode, excludeId, ownerId, sellerIdOf) {
  const targetProduct = targetAttrs.products && targetAttrs.products[productCode];
  if (!targetProduct) {
    throw new Error(`Product code not found in target attributes: ${productCode}`);
  }
  const tAttr = targetProduct.attributes;

  const groups = { matched: [], near_miss: [], insufficient: [], rejected: [], own: [] };
  let excludedSelf = null;
  let sellerIdKnown = 0;

  for (const cand of candidateAttrs.candidates) {
    if (excludeId && cand.id === excludeId) {
      excludedSelf = cand.id;
      continue;
    }
    const r = evaluateCandidate(tAttr, cand.attributes || {});
    const sid = sellerIdOf ? sellerIdOf(cand.id) : (cand.sellerId || null);
    if (sid) sellerIdKnown++;
    const entry = {
      rank: cand.rank,
      id: cand.id,
      price: cand.price,
      sellerId: sid || null,
      mismatch_axes: r.mismatch,
      advisory_mismatch_axes: r.advisoryMismatch,
      filled_axes: r.filled,
    };
    if (ownerId && sid && String(sid) === String(ownerId)) {
      // オーナー自身の出品。属性照合の結果も残しておく (同一商品かどうかの参考)
      entry.attrStatus = r.status;
      groups.own.push(entry);
    } else {
      groups[r.status].push(entry);
    }
  }

  for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.rank - b.rank);

  return {
    page: candidateAttrs.page,
    productCode,
    matcherVersion: 2,
    excludedSelf,
    ownerId: ownerId || null,
    sellerIdCoverage: `${sellerIdKnown}/${candidateAttrs.candidates.length}`,
    ...groups,
  };
}

/** rivals JSON (単体 or 配列) から id -> sellerId のマップを作る */
function sellerMapFromRivals(paths) {
  const map = new Map();
  for (const p of [].concat(paths)) {
    if (!p || !fs.existsSync(p)) continue;
    const r = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const it of r.items || []) {
      if (it.sellerId) map.set(it.id, String(it.sellerId));
    }
  }
  return map;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
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

  // 出品者 ID は rivals JSON にしか無いため、--rivals で渡す (候補属性 JSON には無い)
  const smap = args.rivals ? sellerMapFromRivals(args.rivals.split(',')) : null;
  const output = matchProduct(
    targetAttrs, candidateAttrs, args['product-code'],
    args['exclude-id'] || null,
    args['owner-id'] || null,
    smap ? (id) => smap.get(id) || null : null
  );

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));

  console.log(JSON.stringify({
    output: args.output,
    page: output.page,
    productCode: output.productCode,
    excludedSelf: output.excludedSelf,
    sellerIdCoverage: output.sellerIdCoverage,
    matchedCount: output.matched.length,
    nearMissCount: output.near_miss.length,
    insufficientCount: output.insufficient.length,
    rejectedCount: output.rejected.length,
    ownCount: output.own.length,
    ownPrices: output.own.map((o) => o.price),
    matchedRanks: output.matched.map((m) => m.rank),
    nearMissRanks: output.near_miss.map((m) => m.rank),
  }, null, 2));
}

if (require.main === module) main();

module.exports = { matchProduct, sellerMapFromRivals, evaluateCandidate, norm, sizeMatch, quantityMatch, textMatch, colorMatch };
