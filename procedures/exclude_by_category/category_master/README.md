# Mercari カテゴリマスタ (データ)

Mercari の出品カテゴリ公式マスタのデータ置き場。`research/collect.js` が各商品に保存する `categoryId` を、カテゴリ階層 (root カテゴリ名等) に解決するために使う。

| ファイル | 内容 |
|---|---|
| `mercari_categories_raw.json` | 取得時の完全なスナップショット (2026-06-03)。`{categoryCount, groupCount, categories, categoryGroups}`。`categories` は全フィールド (`imageUrls` 等含む)、`categoryGroups` 105 件 (`flight_forbidden` 航空便禁止カテゴリ等) も保持。**保全・再生成の元データ** |
| `mercari_categories.json` | 上記 raw から除外判定に必要なフィールドだけ抽出した実運用版。カテゴリ 8,781 件。各要素は `id` / `name` / `level` / `parentCategoryId` / `parentCategoryName` / `rootCategoryId` / `rootCategoryName` / `hasChild`。先頭の `meta` に取得元・件数・取得日を持つ。**除外ロジック (`research/_classifier.js`) が読むのはこちら** |

## 取得・抽出の手順

再取得 (ブラウザでの取得 → `extract_category_master.js` での抽出) の手順は親 [`../README.md`](../README.md)「カテゴリマスタの再取得手順」を参照。

`rootCategoryName` は親 (`parentCategoryId`) を辿った最上位カテゴリ名と一致することを確認済み (2026-06-03 時点、8,781 件すべてで一致)。除外判定はこのフィールドを直接参照する。
