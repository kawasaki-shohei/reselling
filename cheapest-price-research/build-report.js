#!/usr/bin/env node
/**
 * 第 7 段階 前半: run ディレクトリの中間成果物を集約して report.json を生成する。
 *
 * report.json は **その run 固有の唯一の成果物データ** であり、
 * ここから render-report.js が物販オーナー向けの HTML を生成する。
 * (CSV は廃止。値付けに使うのは HTML)
 *
 * 使い方:
 *   node cheapest-price-research/build-report.js <run ディレクトリ>
 *
 * 例:
 *   node cheapest-price-research/build-report.js cheapest-price-research/runs/2026_07_26_07_46
 *
 * 入力 (run ディレクトリ内):
 *   source.csv                                  物販オーナー提供のマスター (商品番号/商品名/メルカリURL)
 *   target_detail/{code}.json                   第 1 段階
 *   target_images/{code}/photo_N.jpg            第 1 段階
 *   keywords.csv                                第 2 段階
 *   target_attributes.json                      第 3 段階
 *   items/{code}/rivals/page_NN.json            第 4 段階 (keyword を含む)
 *   items/{code}/candidate_attributes/page_NN.json  第 5 段階 5-2
 *   items/{code}/matched_candidates/page_NN.json    第 5 段階 5-3
 *   items/{code}/candidate_images/{id}/photo_N.jpg  第 6 段階
 *   items/{code}/thumbs/page_NN/{rank}.jpg      第 5 段階 5-1 (候補画像が無い場合の代替)
 *   items/{code}/final_judgment/{id}.json       第 6 段階
 *   items/{code}/result.json                    第 6 段階
 *
 * 出力:
 *   report.json   (UTF-8。この run の成果物データ)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------
// ヘルパ
// ---------------------------------------------------------------

const j = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);

function readCsv(p) {
  let t = fs.readFileSync(p, 'utf8');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // BOM
  const lines = t.split(/\r?\n/).filter((l) => l.trim() !== '');
  const head = splitCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    const o = {};
    head.forEach((h, i) => { o[h] = cells[i] !== undefined ? cells[i] : ''; });
    return o;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function globPhotos(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^photo_\d+\.jpg$/i.test(f))
    .filter((f) => {
      try { return fs.statSync(path.join(dir, f)).size > 1000; } catch { return false; }
    })
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))
    .map((f) => path.join(dir, f));
}

function pagesOf(dir, prefix) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort();
}

/**
 * 物販オーナーのメルカリ出品者 ID を取得する。
 * 設定ファイル: cheapest-price-research/config.json の mercariOwnerId
 * (このスクリプトと同じディレクトリ。物販オーナーごとに値が違うため設定ファイルに置く)
 *
 * 未設定・ファイル無しなら null を返し、own 判定を行わない (従来どおりの動作)。
 */
function ownerMercariId() {
  const p = path.join(__dirname, 'config.json');
  if (!fs.existsSync(p)) return null;
  try {
    const id = JSON.parse(fs.readFileSync(p, 'utf8')).mercariOwnerId;
    return id ? String(id) : null;
  } catch (e) {
    console.error(`config.json の読み込みに失敗しました (own 判定をスキップします): ${e.message}`);
    return null;
  }
}

function searchUrl(keyword, priceMax) {
  const p = new URLSearchParams();
  p.set('keyword', keyword || '');
  if (priceMax != null) p.set('price_max', String(priceMax));
  p.set('order', 'asc');
  p.set('sort', 'price');
  p.set('status', 'on_sale');
  p.set('item_condition_id', '1');
  return 'https://jp.mercari.com/search?' + p.toString();
}

function attrLine(a) {
  if (!a) return '';
  const keys = ['category', 'subcategory', 'color', 'size', 'quantity', 'pattern', 'material'];
  return keys
    .map((k) => (Array.isArray(a[k]) ? a[k].join('・') : a[k]))
    .filter((v) => v != null && v !== '' && String(v) !== '[]')
    .join(' / ');
}

// ---------------------------------------------------------------
// 本体
// ---------------------------------------------------------------

function build(runDir) {
  const runId = path.basename(runDir.replace(/\/+$/, ''));
  const src = readCsv(path.join(runDir, 'source.csv'));
  const ownerId = ownerMercariId();

  // 第 2 段階のキーワード (当初の予定値)
  let plannedKw = {};
  const kwPath = path.join(runDir, 'keywords.csv');
  if (exists(kwPath)) {
    for (const r of readCsv(kwPath)) {
      plannedKw[r['商品番号']] = r['検索キーワード'] || '';
    }
  }

  const ta = exists(path.join(runDir, 'target_attributes.json'))
    ? j(path.join(runDir, 'target_attributes.json')).products || {}
    : {};

  const products = [];

  for (const row of src) {
    const code = row['商品番号'];
    const itemDir = path.join(runDir, 'items', code);

    // --- 対象商品 ---
    const tdPath = path.join(runDir, 'target_detail', `${code}.json`);
    const td = exists(tdPath) ? j(tdPath) : {};
    const tImgs = globPhotos(path.join(runDir, 'target_images', code));

    // --- result ---
    const resPath = path.join(itemDir, 'result.json');
    const res = exists(resPath) ? j(resPath) : { status: 'error', reason: 'result.json が無い' };

    // --- rivals (全ページ) ---
    const rivalPages = pagesOf(path.join(itemDir, 'rivals'), 'page_');
    let candCount = 0, keyword = '', rejectedKeyword = '', rivalIndex = {};
    let sellerKnown = 0;
    for (const f of rivalPages) {
      const r = j(path.join(itemDir, 'rivals', f));
      candCount += (r.items || []).length;
      if (!keyword && r.keyword) keyword = r.keyword;
      if (!rejectedKeyword && r.rejectedKeyword) rejectedKeyword = r.rejectedKeyword;
      for (const it of r.items || []) {
        rivalIndex[it.id] = it;
        if (it.sellerId) sellerKnown++;
      }
    }
    if (!keyword) keyword = plannedKw[code] || '';

    // --- 機械照合の集計 (全ページ合算) ---
    const mcPages = pagesOf(path.join(itemDir, 'matched_candidates'), 'page_');
    const machine = { matched: 0, near_miss: 0, insufficient: 0, rejected: 0, own: 0 };
    const ownListings = [];
    for (const f of mcPages) {
      const m = j(path.join(itemDir, 'matched_candidates', f));
      for (const k of Object.keys(machine)) {
        if (Array.isArray(m[k])) machine[k] += m[k].length;
      }
      for (const o of m.own || []) {
        ownListings.push({
          id: o.id,
          name: (rivalIndex[o.id] && rivalIndex[o.id].name) || '',
          price: o.price,
          url: `https://jp.mercari.com/item/${o.id}`,
          // 属性照合の結果。matched なら「同一商品を自分で再出品している」可能性が高い
          attrStatus: o.attrStatus || null,
        });
      }
    }
    ownListings.sort((a, b) => (a.price || 0) - (b.price || 0));

    // --- 画像最終確認の履歴 ---
    const fjDir = path.join(itemDir, 'final_judgment');
    const judged = [];
    if (exists(fjDir)) {
      for (const f of fs.readdirSync(fjDir).filter((x) => x.endsWith('.json'))) {
        const g = j(path.join(fjDir, f));
        const id = g.candidateId;
        const imgs = globPhotos(path.join(itemDir, 'candidate_images', id));
        let thumb = imgs[0] || null;
        if (!thumb && g.candidateRank != null) {
          const t = path.join(itemDir, 'thumbs', 'page_01',
            String(g.candidateRank).padStart(2, '0') + '.jpg');
          if (exists(t)) thumb = t;
        }
        judged.push({
          id,
          name: (rivalIndex[id] && rivalIndex[id].name) || '',
          price: g.candidatePrice,
          rank: g.candidateRank,
          url: g.candidateUrl || `https://jp.mercari.com/item/${id}`,
          sameProduct: !!g.sameProduct,
          reason: g.reason || '',
          thumb: thumb ? path.relative(runDir, thumb) : null,
        });
      }
      judged.sort((a, b) => (a.price || 0) - (b.price || 0));
    }

    // --- ステータス確定 (no_match / no_candidates の振り分け) ---
    let status = res.status;
    if (status === 'no_match' && judged.length === 0) status = 'no_candidates';

    const p = {
      code,
      status,
      target: {
        name: td.name || row['商品名'] || '',
        price: td.price != null ? td.price : null,
        url: row['メルカリURL'] || (td.id ? `https://jp.mercari.com/item/${td.id}` : ''),
        id: td.id || '',
        photos: tImgs.map((f) => path.relative(runDir, f)),
        attributes: (ta[code] && ta[code].attributes) || null,
        attributesLine: attrLine(ta[code] && ta[code].attributes),
        attributesDetail: (ta[code] && ta[code].attributes_detail) || '',
        attributesReason: (ta[code] && ta[code].reason) || '',
      },
      search: {
        keyword,
        plannedKeyword: plannedKw[code] || '',
        rejectedKeyword,
        candidateCount: candCount,
        pagesScanned: res.pagesScanned != null ? res.pagesScanned : rivalPages.length,
        url: searchUrl(keyword),
        sellerIdAvailable: sellerKnown > 0,
      },
      machine,
      // 物販オーナー自身の出品 (判定対象からは外してある)。値付けの参考情報
      ownListings,
      judged,
      reason: res.reason || '',
      cheapest: null,
    };

    if (status === 'matched' && res.cheapest) {
      const c = res.cheapest;
      const imgs = globPhotos(path.join(itemDir, 'candidate_images', c.id));
      p.cheapest = {
        id: c.id,
        name: c.title || (rivalIndex[c.id] && rivalIndex[c.id].name) || '',
        price: c.price,
        url: c.url || `https://jp.mercari.com/item/${c.id}`,
        rank: c.rank,
        page: c.page,
        photos: imgs.map((f) => path.relative(runDir, f)),
        priceDiff: (p.target.price != null) ? c.price - p.target.price : null,
        // 「これより安い出品が無いか」を確認する検索 URL
        verifyUrl: searchUrl(keyword, c.price - 1),
        verifyPriceMax: c.price - 1,
      };
    }

    products.push(p);
  }

  const count = (s) => products.filter((x) => x.status === s).length;
  const anySeller = products.some((p) => p.search.sellerIdAvailable);

  return {
    schemaVersion: 2,
    runId,
    generatedAt: new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00'),
    ownerMercariId: ownerId,
    // rivals JSON に sellerId が保存されていない run では own 判定ができない
    ownDetectionAvailable: !!(ownerId && anySeller),
    summary: {
      total: products.length,
      matched: count('matched'),
      no_match: count('no_match'),
      no_candidates: count('no_candidates'),
      error: count('error'),
      withOwnListing: products.filter((p) => p.ownListings.length > 0).length,
    },
    products,
  };
}

function main() {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error('usage: node build-report.js <run ディレクトリ>');
    process.exit(1);
  }
  if (!exists(path.join(runDir, 'source.csv'))) {
    console.error(`source.csv が見つかりません: ${runDir}`);
    process.exit(1);
  }
  const rep = build(runDir);
  const out = path.join(runDir, 'report.json');
  fs.writeFileSync(out, JSON.stringify(rep, null, 2) + '\n');
  console.log(JSON.stringify({ output: out, ...rep.summary }, null, 2));
}

if (require.main === module) main();
module.exports = { build, searchUrl, attrLine };
