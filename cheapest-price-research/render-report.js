#!/usr/bin/env node
/**
 * 第 7 段階 後半: report.json から物販オーナー向けの HTML を生成する。
 *
 * **この HTML が最安値リサーチの最終成果物** である。物販オーナーはこれを開いて
 * 出品価格を決める。CSV は生成しない。
 *
 * 使い方:
 *   node cheapest-price-research/render-report.js <run ディレクトリ>
 *
 * 出力 (run ディレクトリ内):
 *   最安値リサーチ_<runId>.html   成果物 (これを物販オーナーに提示する)
 *   report_html_img/              HTML が参照する画像 (自動コピー)
 *
 * HTML の仕様:
 *   - PC 表示前提・単一ファイル・外部 CDN 不使用 (オフラインで開ける)
 *   - タブ 2 つ: [同一商品が見つかった] / [見つからなかった]
 *   - matched タブ先頭に価格差順の一覧表 (行クリックで該当カードへジャンプ)
 *   - 各カードは 2 カラム (自分の商品 / ライバル)、それぞれ独立カルーセル
 *   - 「これより安い出品が無いか確認」ボタン (最安値-1円を上限にした検索)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const yen = (n) => (n == null ? '—' : '¥' + Number(n).toLocaleString('ja-JP'));
const cut = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '…' : String(s || ''));

// ---------------------------------------------------------------
// 画像コピー
// ---------------------------------------------------------------

function copyImages(runDir, outDir, rep) {
  const imgDir = path.join(outDir, 'report_html_img');
  fs.mkdirSync(imgDir, { recursive: true });
  const map = new Map(); // run 内の相対パス -> HTML から見た相対パス

  const put = (rel, name) => {
    if (!rel) return null;
    if (map.has(rel)) return map.get(rel);
    const srcAbs = path.join(runDir, rel);
    if (!fs.existsSync(srcAbs)) return null;
    fs.copyFileSync(srcAbs, path.join(imgDir, name));
    const out = 'report_html_img/' + name;
    map.set(rel, out);
    return out;
  };

  for (const p of rep.products) {
    p.target.photos = p.target.photos
      .map((rel, i) => put(rel, `T_${p.code}_${i + 1}.jpg`)).filter(Boolean);
    if (p.cheapest) {
      p.cheapest.photos = p.cheapest.photos
        .map((rel, i) => put(rel, `C_${p.code}_${i + 1}.jpg`)).filter(Boolean);
    }
    for (const g of p.judged) {
      g.thumb = put(g.thumb, `J_${p.code}_${g.id}.jpg`);
    }
  }
  return map.size;
}

// ---------------------------------------------------------------
// 部品
// ---------------------------------------------------------------

function carousel(id, photos, label) {
  if (!photos || !photos.length) {
    return `<div class="carousel empty">画像なし</div>`;
  }
  const thumbs = photos.map((src, i) =>
    `<img class="car-thumb${i === 0 ? ' is-cur' : ''}" data-car="${id}" data-i="${i}" src="${src}" loading="lazy" alt="">`
  ).join('');
  return `<div class="carousel" id="${id}" data-srcs='${esc(JSON.stringify(photos))}'>
<div class="car-main"><img id="${id}-main" src="${photos[0]}" loading="lazy" alt="${esc(label)}"></div>
<div class="car-nav"><button class="car-btn" data-car="${id}" data-step="-1" type="button">&#9664;</button>
<span class="car-count"><span id="${id}-idx">1</span> / ${photos.length}</span>
<button class="car-btn" data-car="${id}" data-step="1" type="button">&#9654;</button></div>
<div class="car-thumbs">${thumbs}</div></div>`;
}

function judgedTable(p, title) {
  if (!p.judged.length) return '';
  const rows = p.judged.map((g) => `<tr>
<td class="jimg">${g.thumb ? `<a href="${g.url}" target="_blank" rel="noopener"><img src="${g.thumb}" loading="lazy" alt=""></a>` : ''}</td>
<td class="num">${yen(g.price)}</td>
<td class="${g.sameProduct ? 'jsame' : 'jdiff'}">${g.sameProduct ? '◯ 同一' : '× 別物'}</td>
<td class="jcand"><a href="${g.url}" target="_blank" rel="noopener">${esc(cut(g.name, 52) || g.id)}</a><span class="jid">${esc(g.id)}</span></td>
<td class="jr">${esc(g.reason)}</td></tr>`).join('');
  return `<details class="jbox" open><summary>${esc(title)} — ${p.judged.length}件</summary>
<table class="jtable"><thead><tr><th></th><th>価格</th><th>判定</th><th>候補商品</th><th>理由</th></tr></thead>
<tbody>${rows}</tbody></table></details>`;
}

/**
 * 物販オーナー自身の出品 (再出品) を表示する。
 * 「ライバルが安い」のか「自分で値下げしていただけ」なのかを取り違えないための情報。
 */
function ownBox(p) {
  if (!p.ownListings || !p.ownListings.length) return '';
  const rows = p.ownListings.map((o) => {
    const same = o.attrStatus === 'matched';
    const diff = (p.target.price != null && o.price != null) ? o.price - p.target.price : null;
    const dtxt = diff == null ? '' :
      (diff === 0 ? '（同額）' : diff < 0 ? `（自分で ¥${Math.abs(diff).toLocaleString('ja-JP')} 値下げ済み）`
        : `（自分で ¥${diff.toLocaleString('ja-JP')} 値上げ済み）`);
    return `<li><a href="${o.url}" target="_blank" rel="noopener">${esc(cut(o.name, 46) || o.id)}</a>
<b>${yen(o.price)}</b> <span class="ownnote">${dtxt}${same ? '' : ' ※属性は対象と不一致'}</span></li>`;
  }).join('');
  return `<div class="ownbox"><b>あなた自身の出品が ${p.ownListings.length} 件見つかりました</b>
<span class="ownlab">（ライバルではないので最安値の判定からは除外しています）</span>
<ul>${rows}</ul></div>`;
}

function kwHist(p) {
  const s = p.search;
  const parts = [];
  if (s.plannedKeyword && s.plannedKeyword !== s.keyword) {
    parts.push(`初回「${esc(s.plannedKeyword)}」ではヒットが少なく、「${esc(s.keyword)}」に緩めて再検索しました`);
  }
  if (s.rejectedKeyword) {
    parts.push(`「${esc(s.rejectedKeyword)}」も試しましたが母集団が不適切だったため採用しませんでした`);
  }
  parts.push(`候補 ${s.candidateCount}件 / ${s.pagesScanned}ページ取得 / 機械照合 一致${p.machine.matched}・惜しい${p.machine.near_miss}・情報不足${p.machine.insufficient}・除外${p.machine.rejected}`);
  return `<p class="kwhist">${parts.join('<br>')}</p>`;
}

// ---------------------------------------------------------------
// カード
// ---------------------------------------------------------------

function matchedCard(p) {
  const c = p.cheapest;
  const d = c.priceDiff;
  const cls = d == null ? 'dz' : (d < 0 ? 'dn' : (d > 0 ? 'du' : 'dz'));
  const txt = d == null ? '—' : (d === 0 ? '同額' : (d > 0 ? '+' : '−') + '¥' + Math.abs(d).toLocaleString('ja-JP'));
  return `<section class="card" id="card-${p.code}">
<div class="card-head"><span class="code">${esc(p.code)}</span>
<h2 class="title">${esc(p.target.name)}</h2><span class="dbig ${cls}">${txt}</span></div>
<div class="cols">
  <div class="col"><div class="col-head mine">自分の商品</div>
    <div class="price">${yen(p.target.price)}</div>
    <a class="link" href="${p.target.url}" target="_blank" rel="noopener">${esc(p.target.id || p.target.url)}</a>
    ${carousel('c-t-' + p.code, p.target.photos, p.code + ' 自分')}
    <div class="attrs">${p.target.attributesLine ? p.target.attributesLine.split(' / ').map((v) => `<b>${esc(v)}</b>`).join(' <span class="sep">/</span> ') : ''}</div>
  </div>
  <div class="col"><div class="col-head rival">同一と判定したライバル (最安)</div>
    <div class="price">${yen(c.price)}</div>
    <a class="link" href="${c.url}" target="_blank" rel="noopener">${esc(c.id)}</a>
    ${carousel('c-c-' + p.code, c.photos, p.code + ' ライバル')}
    <div class="cname">${esc(cut(c.name, 70))}</div>
  </div>
</div>
${ownBox(p)}
<div class="rsn"><b>同一商品と判定した理由</b><br>${esc(p.reason)}</div>
<div class="cta"><a class="btn" href="${c.verifyUrl}" target="_blank" rel="noopener">これより安い出品が無いか確認 (${yen(c.verifyPriceMax)} 以下を検索)</a>
<span class="cta-note">押して同一商品が出てこなければ、この価格が最安で確定です</span>
<span class="cta-kw">検索した語: <b>${esc(p.search.keyword)}</b></span></div>
${judgedTable(p, 'この商品で確認した候補 (安い順)')}
${kwHist(p)}</section>`;
}

function unmatchedCard(p) {
  const isNoCand = p.status === 'no_candidates';
  const badge = isNoCand
    ? '<span class="pill warn">調べられていない</span>'
    : '<span class="pill ng">市場に同型なし</span>';
  const warn = isNoCand
    ? `<div class="warnbox"><b>画像確認を 1 件も行っていません。</b>
検索キーワードが母集団を作れておらず、「市場に無い」ではなく<b>「調べられていない」</b>状態です。
下のボタンで実際の検索結果を確認し、別のキーワードで再調査する価値があります。</div>`
    : '';
  return `<section class="card" id="card-${p.code}">
<div class="card-head"><span class="code">${esc(p.code)}</span>
<h2 class="title">${esc(p.target.name)}</h2>${badge}<span class="dbig dz">${yen(p.target.price)}</span></div>
<div class="cols one">
  <div class="col"><div class="col-head mine">自分の商品</div>
    <a class="link" href="${p.target.url}" target="_blank" rel="noopener">${esc(p.target.id || p.target.url)}</a>
    ${carousel('c-t-' + p.code, p.target.photos, p.code)}
    <div class="attrs">${p.target.attributesLine ? p.target.attributesLine.split(' / ').map((v) => `<b>${esc(v)}</b>`).join(' <span class="sep">/</span> ') : ''}</div>
  </div>
</div>
${warn}
${ownBox(p)}
<div class="cta"><a class="btn" href="${p.search.url}" target="_blank" rel="noopener">この条件でメルカリを開く (安い順・新品)</a>
<span class="cta-note">実際に同一商品が出品されていないか、ご自身の目で確認できます</span>
<span class="cta-kw">検索した語: <b>${esc(p.search.keyword)}</b></span></div>
${judgedTable(p, '確認した候補 (安い順) — すべて別物と判定')}
<div class="rsn"><b>見つからなかった理由</b><br>${esc(p.reason)}</div>
${kwHist(p)}</section>`;
}

// ---------------------------------------------------------------
// HTML 全体
// ---------------------------------------------------------------

const CSS = `
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic UI",sans-serif;
margin:0;padding:0 0 60px;background:#f5f5f7;color:#1d1d1f;line-height:1.65;overflow-x:hidden}
.wrap{max-width:1280px;margin:0 auto;padding:22px 28px}
h1{font-size:23px;margin:0 0 4px}
.sub{color:#6e6e73;font-size:13px}
.note{background:#fff;border-left:4px solid #0071e3;border-radius:0 8px 8px 0;padding:11px 15px;
margin:14px 0 0;font-size:12.5px;color:#4a4a4f}
.tabs{position:sticky;top:0;z-index:20;background:rgba(245,245,247,.94);backdrop-filter:blur(8px);
border-bottom:1px solid #e0e0e5;padding:10px 28px;display:flex;gap:8px}
.tab{border:1px solid #d2d2d7;background:#fff;border-radius:8px;padding:8px 18px;font-size:13.5px;
font-weight:600;cursor:pointer;color:#1d1d1f}
.tab.is-on{background:#1d1d1f;color:#fff;border-color:#1d1d1f}
.pane{display:none}.pane.is-on{display:block}
table.sum{border-collapse:collapse;width:100%;background:#fff;border-radius:10px;overflow:hidden;
box-shadow:0 1px 3px rgba(0,0,0,.08);font-size:13px;margin-bottom:22px}
table.sum th{background:#fafafc;text-align:left;padding:9px 12px;font-size:11.5px;color:#6e6e73;
border-bottom:1px solid #e8e8ed}
table.sum td{padding:9px 12px;border-bottom:1px solid #f0f0f3}
table.sum tr[data-target]{cursor:pointer}
table.sum tr[data-target]:hover{background:#f0f7ff}
.code-cell{font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:12.5px;white-space:nowrap}
.tname{color:#4a4a4f}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.dn{color:#1d9d4e;font-weight:700}.du{color:#d70015;font-weight:700}.dz{color:#86868b}
.card{background:#fff;border-radius:12px;padding:18px 22px;margin-bottom:20px;
box-shadow:0 1px 3px rgba(0,0,0,.08);scroll-margin-top:70px}
.card.flash{box-shadow:0 0 0 3px #0071e3}
.card-head{display:flex;align-items:baseline;gap:11px;flex-wrap:wrap;margin-bottom:12px}
.code{font-size:14px;font-weight:700;font-family:ui-monospace,Menlo,monospace;background:#1d1d1f;
color:#fff;padding:3px 10px;border-radius:6px}
.title{font-size:15.5px;font-weight:600;margin:0;flex:1;min-width:200px}
.dbig{font-size:21px;font-weight:700}
.pill{font-size:11px;padding:3px 10px;border-radius:20px;color:#fff;font-weight:600}
.pill.ng{background:#8e8e93}.pill.warn{background:#ff9500}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.cols.one{grid-template-columns:1fr;max-width:560px}
@media(max-width:900px){.cols{grid-template-columns:1fr}}
.col{border:1px solid #e8e8ed;border-radius:10px;padding:12px 14px;min-width:0}
.col-head{font-size:11.5px;font-weight:700;letter-spacing:.03em;padding-bottom:7px;margin-bottom:9px;
border-bottom:2px solid #e8e8ed}
.col-head.mine{border-color:#1d1d1f}.col-head.rival{border-color:#1d9d4e;color:#1d9d4e}
.price{font-size:22px;font-weight:700;line-height:1.3}
.link{font-size:11.5px;color:#0071e3;text-decoration:none;font-family:ui-monospace,Menlo,monospace;
word-break:break-all}
.link:hover{text-decoration:underline}
.carousel{margin:10px 0 8px}
.carousel.empty{height:120px;display:flex;align-items:center;justify-content:center;color:#a1a1a6;
font-size:12px;background:#fafafc;border-radius:8px}
.car-main{height:330px;display:flex;align-items:center;justify-content:center;background:#fff;
border:1px solid #e8e8ed;border-radius:9px;overflow:hidden}
.car-main img{max-width:100%;max-height:100%;object-fit:contain}
.car-nav{display:flex;align-items:center;justify-content:center;gap:14px;margin:7px 0 6px}
.car-btn{border:1px solid #d2d2d7;background:#fff;border-radius:7px;width:36px;height:28px;
cursor:pointer;font-size:12px;color:#1d1d1f;line-height:1}
.car-btn:hover{background:#f0f0f3}
.car-count{font-size:12px;color:#6e6e73;font-variant-numeric:tabular-nums}
.car-thumbs{display:flex;flex-wrap:wrap;gap:5px}
.car-thumbs img{width:46px;height:46px;object-fit:cover;border-radius:5px;border:1px solid #e0e0e5;
cursor:pointer;background:#fff}
.car-thumb.is-cur{border-color:#0071e3;box-shadow:0 0 0 2px rgba(0,113,227,.25)}
.attrs{font-size:12.5px;background:#f5f5f7;border-radius:7px;padding:8px 12px;line-height:1.85;
word-break:break-word;margin-top:4px}
.attrs b{font-weight:600}.attrs .sep{color:#c7c7cc;margin:0 2px}
.cname{font-size:12.5px;color:#4a4a4f;margin-top:4px}
.rsn{font-size:12.5px;background:#f0f7ff;border-left:3px solid #0071e3;padding:9px 13px;
border-radius:0 6px 6px 0;margin-top:13px}
.warnbox{font-size:12.5px;background:#fff8e6;border-left:3px solid #ff9500;padding:10px 14px;
border-radius:0 6px 6px 0;margin-top:13px}
.cta{margin-top:14px}
.btn{display:inline-block;background:#0071e3;color:#fff!important;padding:9px 18px;border-radius:8px;
font-size:13px;text-decoration:none;font-weight:600}
.btn:hover{background:#005fbf}
.cta-note{display:block;font-size:11.5px;color:#6e6e73;margin-top:5px}
.cta-kw{display:block;font-size:12.5px;color:#4a4a4f;margin-top:5px}
.cta-kw b{font-family:ui-monospace,Menlo,monospace;font-weight:700;background:#fff3cd;
border:1px solid #ffe08a;padding:2px 9px;border-radius:5px}
.ownbox{font-size:12.5px;background:#f0f4ff;border-left:3px solid #5856d6;padding:10px 14px;
border-radius:0 6px 6px 0;margin-top:13px}
.ownbox ul{margin:7px 0 0;padding-left:18px}
.ownbox li{margin:3px 0}
.ownbox a{color:#0071e3;text-decoration:none;font-weight:600}
.ownbox a:hover{text-decoration:underline}
.ownlab{font-size:11.5px;color:#6e6e73;font-weight:400}
.ownnote{color:#6e6e73;font-size:11.5px}
.jbox{margin-top:14px;font-size:12.5px}
.jbox summary{cursor:pointer;font-weight:600;color:#4a4a4f;font-size:12px;padding:5px 0}
.jtable{border-collapse:collapse;width:100%;margin-top:7px}
.jtable th,.jtable td{text-align:left;padding:7px 9px;border-bottom:1px solid #f0f0f3;vertical-align:top}
.jtable th{font-size:11px;color:#6e6e73;background:#fafafc}
.jimg{width:74px;padding-left:6px!important}
.jimg img{width:62px;height:62px;object-fit:cover;border-radius:6px;border:1px solid #e0e0e5;display:block}
.jsame{color:#1d9d4e;font-weight:700;white-space:nowrap}
.jdiff{color:#86868b;font-weight:600;white-space:nowrap}
.jcand{min-width:180px}
.jcand a{color:#0071e3;text-decoration:none;font-weight:600;display:block;line-height:1.45}
.jcand a:hover{text-decoration:underline}
.jid{display:block;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:#a1a1a6;margin-top:2px}
.jr{color:#4a4a4f;line-height:1.6}
.kwhist{font-size:11.5px;color:#86868b;margin:13px 2px 0;padding-top:9px;border-top:1px dashed #e8e8ed}
`;

const JS = `
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click',function(){
    document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('is-on')});
    document.querySelectorAll('.pane').forEach(function(x){x.classList.remove('is-on')});
    t.classList.add('is-on');
    document.getElementById(t.dataset.pane).classList.add('is-on');
    window.scrollTo({top:0});
  });
});
function show(id,i){
  var el=document.getElementById(id); if(!el) return;
  var srcs=JSON.parse(el.dataset.srcs); var n=srcs.length;
  i=((i%n)+n)%n;
  document.getElementById(id+'-main').src=srcs[i];
  document.getElementById(id+'-idx').textContent=i+1;
  el.dataset.cur=i;
  el.querySelectorAll('.car-thumb').forEach(function(t){
    t.classList.toggle('is-cur', Number(t.dataset.i)===i);
  });
}
document.querySelectorAll('.car-btn').forEach(function(b){
  b.addEventListener('click',function(){
    var el=document.getElementById(b.dataset.car);
    show(b.dataset.car,(Number(el.dataset.cur)||0)+Number(b.dataset.step));
  });
});
document.querySelectorAll('.car-thumb').forEach(function(t){
  t.addEventListener('click',function(){ show(t.dataset.car,Number(t.dataset.i)); });
});
document.querySelectorAll('table.sum tr[data-target]').forEach(function(tr){
  tr.addEventListener('click',function(){
    var c=document.getElementById(tr.dataset.target); if(!c) return;
    c.scrollIntoView({behavior:'smooth',block:'start'});
    c.classList.add('flash'); setTimeout(function(){c.classList.remove('flash')},1400);
  });
});
`;

function render(rep) {
  const M = rep.products.filter((p) => p.status === 'matched')
    .sort((a, b) => (a.cheapest.priceDiff ?? 0) - (b.cheapest.priceDiff ?? 0) || a.code.localeCompare(b.code));
  const U = rep.products.filter((p) => p.status !== 'matched')
    .sort((a, b) => (a.status === b.status ? a.code.localeCompare(b.code) : (a.status === 'no_candidates' ? -1 : 1)));

  const rows = M.map((p) => {
    const d = p.cheapest.priceDiff;
    const cls = d == null ? 'dz' : (d < 0 ? 'dn' : (d > 0 ? 'du' : 'dz'));
    const txt = d == null ? '—' : (d === 0 ? '同額' : (d > 0 ? '+' : '−') + '¥' + Math.abs(d).toLocaleString('ja-JP'));
    return `<tr data-target="card-${p.code}"><td class="code-cell">${esc(p.code)}</td>
<td class="tname">${esc(cut(p.target.name, 34))}</td><td class="num">${yen(p.target.price)}</td>
<td class="num">${yen(p.cheapest.price)}</td><td class="num ${cls}">${txt}</td>
<td class="num">${p.judged.length}</td></tr>`;
  }).join('');

  const s = rep.summary;
  const nc = s.no_candidates;

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<title>最安値リサーチ結果 ${esc(rep.runId)}</title>
<style>${CSS}</style></head><body>
<div class="wrap">
<h1>最安値リサーチ結果</h1>
<div class="sub">run ${esc(rep.runId)} ／ 対象 ${s.total}件 ／ 生成 ${esc(rep.generatedAt.slice(0, 16).replace('T', ' '))}</div>
<div class="note"><b>この HTML が最安値リサーチの成果物です。</b>
「同一商品が見つかった」タブの一覧表で価格差の大きい商品から確認し、画像を見比べて納得できたら、
その最安価格を出品価格の判断に使ってください。各商品には「これより安い出品が無いか確認」ボタンがあり、
押して同一商品が出てこなければ、その価格が最安で確定です。</div>
</div>
${rep.ownDetectionAvailable === false ? '<div class="note" style="border-left-color:#ff9500"><b>注意:</b> この run は検索結果に出品者 ID が保存されていないため、「ライバル」と「あなた自身の再出品」を区別できていません。画像が完全に一致するライバルは、あなたの再出品である可能性があります。</div>' : ''}
<div class="tabs">
<button class="tab is-on" data-pane="pane-m">同一商品が見つかった (${s.matched}件)</button>
<button class="tab" data-pane="pane-u">見つからなかった (${s.no_match + nc}件)</button>
</div>
<div class="wrap">
<div class="pane is-on" id="pane-m">
${M.length ? `<table class="sum"><thead><tr><th>商品番号</th><th>商品名</th><th class="num">自分の価格</th>
<th class="num">ライバル最安</th><th class="num">価格差</th><th class="num">確認した候補</th></tr></thead>
<tbody>${rows}</tbody></table>${M.map(matchedCard).join('\n')}`
      : '<div class="card">同一商品が見つかった商品はありません。</div>'}
</div>
<div class="pane" id="pane-u">
<div class="note">「見つからなかった」には性質の違う 2 種類があります。<br>
<b>市場に同型なし (${s.no_match}件)</b> — 候補を画像で確認した結果すべて別物でした。競合がいないので価格を維持できます。<br>
<b>調べられていない (${nc}件)</b> — 検索キーワードが合わず、そもそも判定できていません。再調査の価値があります。</div>
${U.length ? U.map(unmatchedCard).join('\n') : '<div class="card">該当なし。</div>'}
</div>
</div>
<script>${JS}</script>
</body></html>`;
}

function main() {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error('usage: node render-report.js <run ディレクトリ>');
    process.exit(1);
  }
  const repPath = path.join(runDir, 'report.json');
  if (!fs.existsSync(repPath)) {
    console.error(`report.json が見つかりません。先に build-report.js を実行してください: ${repPath}`);
    process.exit(1);
  }
  const rep = JSON.parse(fs.readFileSync(repPath, 'utf8'));
  const n = copyImages(runDir, runDir, rep);
  const html = render(rep);
  const out = path.join(runDir, `最安値リサーチ_${rep.runId}.html`);
  fs.writeFileSync(out, html);
  console.log(JSON.stringify({
    output: out, images: n, bytes: Buffer.byteLength(html), ...rep.summary,
  }, null, 2));
}

if (require.main === module) main();
module.exports = { render, copyImages };
