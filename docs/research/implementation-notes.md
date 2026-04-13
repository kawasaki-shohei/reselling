# 実装: API直接呼び出し方式（DPoP認証）

MercariはNext.jsを使っており、検索データを `api.mercari.jp/v2/entities:search` にPOSTで取得している。このAPIは **DPoP (Demonstrating Proof of Possession)** という認証方式を使っている。

- DPoPキーペア(EC P-256)がブラウザの **IndexedDB** (`auth-sdk` DB → `keyPairs` ストア → `"dpop"` キー)に `CryptoKey` オブジェクトとして保存されている
- 各リクエストに `dpop: <JWT>` ヘッダを付与する必要があり、JWTはリクエストごとに新規生成（使い回し不可）
- 未ログイン状態でも動作する（匿名セッション）

---

# 第1段階: テキストクラスタリング（recall重視・広く拾う）

digit→N + 先頭28文字の正規化でグルーピングする。完全一致よりもロット番号・デザイン番号・カラー違いを同一OEM品として正しく統合できる（2026-04-12検証済み）。

```python
def normalize(name):
    t = re.sub(r'[【】\[\]「」（）()♪✦•·※*!！★☆♡♥✓✨◆◇□■▲△▼〇●]', '', name)
    t = re.sub(r'\d+', 'N', t)   # 数字をNに統一（ロット番号・カラーコード等を吸収）
    t = re.sub(r'\s+', ' ', t).strip()
    return t[:28]                 # 先頭28文字でキー化
```

3件以上のクラスターを全て次の段階に渡す（`slice(0, N)` のような上限は禁止）。

**トレードオフ:**

| メリット | デメリット |
|---|---|
| ロット番号・サイズ違い（24cmと25cm等）を同一商品として正しく統合できる | 数字で区別される別商品（双眼鏡30倍と40倍等）を誤って同一クラスターに統合する可能性がある |

現時点ではあえて recall（広さ）を優先する。どのケースが多いかは商品ジャンルに依存し、一概にルール化できないため、運用しながらフィルタリング条件を段階的に追加していく方針とする。

---

# 第2段階: メタデータフィルタ（機械的に除外）

収集時に `categoryId`・`sellerId` も保存し、以下の条件でクラスターを検証する。

- **価格の一貫性**: クラスター内の最安値と最高値の比が2倍を超えたら警告フラグを立てる（別商品混入の可能性）
- **カテゴリの一致**: クラスター内で過半数と異なるカテゴリのアイテムは除外する
- **出品者の多様性**: クラスター内のユニーク出品者数を記録する（カテゴリフィルタ後の `filtered` 母集団で数える）。件数（`count`）と母集団を揃えるためカテゴリ不一致で除外したアイテムの出品者はカウントに含めない。
    - **10人以上**: `excluded: true` と `exclusionReason: "sellers_10_or_more"` フラグを付与する（`overview.md` 準拠: 「同商品の販売者数10人未満」）。競合過多のレッドオーシャンのため仕入れ判断から外す。ただし `candidates` 配列からは削除せず、フラグを付けて残す（トレーサビリティのため。レポート生成時にフラグで識別して除外する）。
    - **1〜9人**: 除外しない。1人でも大量SOLDは売れ筋の証拠であり、競合が少ない＝参入余地ありと解釈できるため。

---

# 収集時に保存するデータ

収集したユニーク化済みの全アイテムを保存する。後から再分析できるよう、毎回上書きしないよう **実行日時をプレフィックスに付ける**。

- ファイル名: `YYYY_MM_DD_HHMMSS_mercari_14day_results.json`
- 保存先: `research/`

保存する内容（`categoryId`・`sellerId`・`thumbnails` を含む）:

```javascript
{
  boundaryTs: BOUNDARY_TS,
  executedAt: jst.toISOString(),
  elapsedSeconds: elapsedSec,
  totalRequests: totalRequests,
  totalCollected: unique.length,
  summary: results.map(r => ({ keyword, priceMin, priceMax, pages, count })),
  items: unique  // id, name, price, updated, url, categoryId, sellerId, thumbnail
}
```

※ 収集コード内の `allItems.push` でも `categoryId`・`sellerId`・`thumbnails[0]` を含めること。

---

# 実装上の禁止事項

## ページ数に上限を設けない

ループの終了条件は以下の自然な条件のみ。それ以外の打ち切り（`pageNum < N` 等）を Claude が勝手に追加することを禁止する。

```javascript
// ✅ これだけでよい
const nextToken = data.meta?.nextPageToken;
if (!nextToken || lastTs < BOUNDARY_TS || hitBoundary) break;
```

ページ数が多くなるリスクはユーザーが承知済みであり、Claude が勝手に省略してはいけない。

## ページ内アイテムを `break` で打ち切らない

APIのソートは `created_time`（出品時刻）であり `updated`（売却時刻）ではない。1ページ内でも `updated` は単調減少しない。途中で古いアイテムが1件あっても、その後に新しいアイテムが続く可能性がある。

```javascript
// ❌ 間違い
for (const item of items) {
  if (parseInt(item.updated) < BOUNDARY_TS) { hitBoundary = true; break; }
  allItems.push(item);
}

// ✅ 正しい: 全件走査してからフラグを立てる
let hitBoundary = false;
for (const item of items) {
  const ts = parseInt(item.updated || 0);
  if (ts >= BOUNDARY_TS) {
    allItems.push(...);
  } else {
    hitBoundary = true; // breakしない
  }
}
```

`break` で内側ループを抜けると `hitBoundary = true` が外側ループを即終了させ、後続ページが全て失われる。これは **収集漏れの最大原因**。
