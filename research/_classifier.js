// 内部ヘルパー (直接 CLI 実行しない): 辞書読込・タイトル集約・分類ロジックを提供する。
// exclude_by_keywords.js (第 4 段階) と expand_dictionary.js (第 3 段階) の両方から使う。

const fs = require('fs');
const path = require('path');

const DICT_PATH = path.join(__dirname, '..', 'procedures', 'exclude_by_keywords', 'keywords.json');

// 正規辞書を読み、pendingPath があれば暫定辞書とマージして返す。
// マージルール: カテゴリごとにキーワード配列を concat / 重複は正規辞書側を優先
// (暫定辞書側は除外) / notWith・withAll 付きオブジェクトはそのまま保持 / priority は正規辞書側
function loadDictionary(pendingPath = null) {
  const base = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
  if (!pendingPath) {
    return { priority: base.priority, keywords: base.keywords, dictPath: DICT_PATH, pendingPath: null };
  }
  const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  const merged = {};
  for (const cat of base.priority) {
    const baseArr = base.keywords[cat] || [];
    const addArr = (pending.keywords && pending.keywords[cat]) || [];
    const existingNames = new Set(baseArr.map(e => typeof e === 'string' ? e : e.keyword));
    const filtered = addArr.filter(e => {
      const name = typeof e === 'string' ? e : e.keyword;
      return !existingNames.has(name);
    });
    merged[cat] = [...baseArr, ...filtered];
  }
  return { priority: base.priority, keywords: merged, dictPath: DICT_PATH, pendingPath };
}

// 生 items を seller+title で集約し、タイトル順にソートした entries を返す
function aggregateBySellerTitle(items) {
  const map = new Map();
  for (const it of items) {
    const key = (it.sellerId || '?') + '||' + (it.name || '');
    if (!map.has(key)) {
      map.set(key, {
        ids: [],
        price_min: Infinity,
        price_max: 0,
        seller: it.sellerId || '?',
        name: it.name || '',
      });
    }
    const rec = map.get(key);
    rec.ids.push(it.id);
    if (it.price < rec.price_min) rec.price_min = it.price;
    if (it.price > rec.price_max) rec.price_max = it.price;
  }
  const entries = [...map.values()];
  entries.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return entries;
}

// 単一タイトルに対する分類: カテゴリごとのマッチキーワード配列を返す
function classify(name, keywords) {
  const lower = name.toLowerCase();
  const has = (w) => name.includes(w) || lower.includes(w.toLowerCase());
  const flags = {};
  for (const [cat, kwList] of Object.entries(keywords)) {
    const matches = [];
    for (const entry of kwList) {
      const kw = typeof entry === 'string' ? entry : entry.keyword;
      const notWith = typeof entry === 'string' ? [] : (entry.notWith || []);
      const withAll = typeof entry === 'string' ? [] : (entry.withAll || []);
      if (!has(kw)) continue;
      // withAll: 指定された全語がタイトルに含まれていなければマッチさせない (組み合わせ判定)
      if (withAll.length > 0 && !withAll.every(has)) continue;
      // notWith: この語が同じタイトルにあればマッチ扱いしない (別単語の一部の誤爆防止)
      if (notWith.some(has)) continue;
      matches.push(kw);
    }
    if (matches.length > 0) flags[cat] = matches;
  }
  return flags;
}

function decidePrimary(flags, priority) {
  for (const p of priority) {
    if (flags[p]) return p;
  }
  return null;
}

// entries 配列を除外フラグ付きの rows に変換する
function annotateRows(entries, keywords, priority) {
  return entries.map((e, i) => {
    const flags = classify(e.name, keywords);
    const primary = decidePrimary(flags, priority);
    return {
      rowIndex: i,
      seller: e.seller,
      name: e.name,
      priceMin: e.price_min,
      priceMax: e.price_max,
      count: e.ids.length,
      ids: e.ids,
      exclusion: primary ? { primary, matches: flags } : null,
    };
  });
}

module.exports = {
  DICT_PATH,
  loadDictionary,
  aggregateBySellerTitle,
  classify,
  decidePrimary,
  annotateRows,
};
