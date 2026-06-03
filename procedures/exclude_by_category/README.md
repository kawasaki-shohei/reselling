# 公式カテゴリによる除外 (exclude_by_category)

メルカリ売れ筋リサーチ第 4 段階の除外のうち、**Mercari 公式カテゴリ (`categoryId`) を使った除外**の一式を置く。キーワード除外 (`../exclude_by_keywords/`) とは除外の軸が異なる (タイトル文字列ではなく出品者が選んだ公式カテゴリ) ため、別ディレクトリで管理する。

## ディレクトリ構成

```
procedures/exclude_by_category/
├── README.md                     # このファイル
├── excluded_categories.json      # 除外対象の root カテゴリ定義
├── extract_category_master.js    # 生データ → 抽出版マスタを生成 (再取得時に使う)
└── category_master/
    ├── README.md                 # マスタファイルの説明
    ├── mercari_categories_raw.json   # 取得時の完全スナップショット (categoryGroups 含む)
    └── mercari_categories.json       # 除外判定が読む抽出版
```

## 除外の仕組み

第 4 段階で `research/exclude_by_keywords.js` (キーワード除外と同じスクリプト) が `research/_classifier.js` 経由で実行する。各行の代表 `categoryId` を `category_master/mercari_categories.json` で root カテゴリ名 (`rootCategoryName`) に解決し、`excluded_categories.json` の `mercari.excluded_root_categories` に含まれれば除外する (`primary = 'category_excluded'`、キーワードより優先)。

設計の詳細は [`../mercari-research-v2.md`](../mercari-research-v2.md) 第 4 段階「公式カテゴリ除外 (category_excluded)」を参照。

## 2 つのサイクル (キーワード除外と独立)

カテゴリ除外には独立した 2 つのサイクルがある:

### サイクル 1: マスタの再取得 (稀)

Mercari のカテゴリ体系が改定されたとき、または定期メンテナンスとして実施する。頻度は低い (キーワード辞書のような毎リサーチ更新ではない)。手順は本 README「カテゴリマスタの再取得手順」参照。

### サイクル 2: 除外カテゴリの精査 (精度検証と連携)

「どの root カテゴリを丸ごと除外すべきか」の選定は、`../exclude_by_keywords_precision_check/` の **Recall 検証と地続き**で行う。Recall 検証である root カテゴリの取りこぼし (本来除外すべき unflagged) が多いと判明したら、そのカテゴリを除外候補として精査する。判断の流れは [`../exclude_by_keywords_precision_check/README.md`](../exclude_by_keywords_precision_check/README.md) §8.2 を参照。

精査して除外と決めたら `excluded_categories.json` に root 名を追加し、`research/exclude_by_keywords.js` を再実行すれば次回リサーチから反映される (コード変更不要)。

## カテゴリマスタの再取得手順

ブランドマスタ (`../exclude_by_keywords/brand_master/`) と同じ indexedDB `master` DB を直読みする手法。対象ストアが `itemBrands` ではなく **`itemCategories`** な点だけが違う。Node 単体では取得できない (ブラウザの indexedDB が必要) ため、取得はブラウザ実行、抽出は Node スクリプトの 2 段階で行う。

### ステップ 1: 取得 (ブラウザ実行)

1. Playwright MCP のブラウザで `https://jp.mercari.com` にログイン
2. `https://jp.mercari.com/sell/create` (出品ページ) を開く — フロントが公式 API を叩き `master` DB の `itemCategories` / `itemCategoryGroups` ストアにカテゴリを書き込む
3. `browser_evaluate` で以下を実行し、結果を `category_master/mercari_categories_raw.json` に保存する (`filename` パラメータで指定):

```js
async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('master');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const getAll = (store) => new Promise((res) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => res([]);
  });
  const categories = await getAll('itemCategories');
  const groups = await getAll('itemCategoryGroups');
  return { categoryCount: categories.length, groupCount: groups.length, categories, categoryGroups: groups };
}
```

出力 raw の構造: `{ categoryCount, groupCount, categories, categoryGroups }`。`categoryGroups` には `flight_forbidden` (航空便禁止) 等のグループ情報が含まれる。

### ステップ 2: 抽出 (Node 実行)

raw から除外判定に必要なフィールドだけを抜いた実運用版を生成する。`rootCategoryName` が親辿りの最上位と一致するかを検証し、不一致があれば中断する。

```bash
node procedures/exclude_by_category/extract_category_master.js \
  procedures/exclude_by_category/category_master/mercari_categories_raw.json \
  procedures/exclude_by_category/category_master/mercari_categories.json \
  2026-06-03   # ← 取得日 (YYYY-MM-DD)。meta.fetchedAt に入る
```

### ステップ 3: 確認

- 件数が増減していないか (`meta.count`)
- 既存の `excluded_categories.json` の root 名が新マスタにも存在するか (カテゴリ改定で root 名が変わっていないか)
- 変わっていれば `excluded_categories.json` を新 root 名に合わせて更新する

## 関連ファイル

- `research/_classifier.js` — `categoryId → root` 解決とカテゴリ除外ロジック
- `research/exclude_by_keywords.js` — 第 4 段階の除外実行 (キーワード + カテゴリ両方)
- `../mercari-research-v2.md` 第 4 段階 — 仕組みと設計
- `../exclude_by_keywords_precision_check/README.md` §8.2 — 除外カテゴリの精査運用
