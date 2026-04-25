# itemBrand による collect_step 段階除外の採用と、ブランドマスタの辞書代替不採用

**日付**: 2026-04-21

## ステータス

**採用 (Accepted)** (※ 本 ADR の決定のうち「マスタを辞書代替に使う」は却下)

## コンテキスト

### 背景

工程 (1) 商品リサーチパイプラインでは、Mercari 検索 API で約 8,000 件/回の販売実績を収集し、除外キーワード辞書 [`../procedures/exclude_by_keywords/keywords.json`](../procedures/exclude_by_keywords/keywords.json) で仕入れ候補外を機械的に除外している。

2026-04-20 時点の辞書性能: Precision 91.71% / Recall 50.87% / F1 65.41%。Recall 改善のため、以下 2 つの可能性を検証した:

1. Mercari 検索 API の `withItemBrand: true` オプションで `itemBrand: {id, name, subName}` を取得し、その情報で仕入れ候補外を判定できるか
2. Mercari ブランドマスタ (後述) を辞書 `brand_imitation` の代替として利用し、辞書のメンテナンスコストを削減できるか

### 新たに判明した事実

#### Mercari 検索 API の itemBrand フィールド

- `v2/entities:search` エンドポイントの request body で `withItemBrand: true` を指定するとアイテムごとに `itemBrand: {id, name, subName}` が付与される
- これは出品者が **出品画面でブランドを選択した場合のみ**付く。自由入力ではない (後述のマスタ構造から一貫性が確認できる)

#### Mercari ブランドマスタ

- エンドポイント: `https://api.mercari.jp/master/v2/datasets/item_brands` (DPoP + authorization 必要)
- ブラウザキャッシュの `indexedDB: master.itemBrands` からも取得可能
- **52,579 ブランド**、ID は 1〜57,961 の欠番付き連番
- スキーマ: `id, name, subname, initial, jaPronunciation, nameJaFurigana`
- 自由入力でない根拠: 695 ユニーク brandId と 695 ユニーク name が完全 1:1 対応、`adidas / Adidas / アディダス` 等の表記ゆれが存在しない
- マスタ全件を [`../procedures/exclude_by_keywords/brand_master/brands.jsonl`](../procedures/exclude_by_keywords/brand_master/brands.jsonl) に git 管理し、再取得手順は同ディレクトリの [README.md](../procedures/exclude_by_keywords/brand_master/README.md) に記載

### 実データ検証 (2026-04-21 に収集した 8,059 件)

| 指標 | 値 |
|---|---:|
| totalCollected (unique) | 8,899 件 |
| itemBrand 付与 | 1,871 件 (21.02%) |
| itemBrand 空欄 | 7,028 件 (78.98%) |
| ユニークブランド数 | 695 |

#### itemBrand 付き商品の目視確認

- Top 50 ブランド (Starbucks 62, THE NORTH FACE 38, Sanrio 36, SQUEEZE 32, NIKE 31, CHANEL 28 等) を全件分類、**全て仕入れ候補外** (正規ブランド / 版権 / 総称ブランド)
- 要確認ブランド SQUEEZE (32 件) / MUSIC TEE (13 件) / NAILS (7 件) を各全件目視 → 中国輸入スクイーズ玩具 / バンド T / 作家ネイルチップで、**いずれも仕入れ候補外**
- 1 件のみ出現ブランド 442 件からランダム 30 件サンプル (seed=42): 韓国コスメ 10 / 海外コスメ 3 / 正規アパレル 9 / 食品 2 / 電化製品 3 / 版権・ノベルティ 2 / 韓国系ネイル 1、**仕入れ候補 0 件**
- マスタ内の `no brand (id=40540)` 該当: 8,059 件中 **6 件 (0.067%)**、うち仕入れ候補になり得るもの 2-3 件 (バンダナ・犬服・トレーニング器具)、全体の 0.03%

#### マスタの「N 文字以上でタイトルマッチ」検証 (itemBrand 空欄 7,028 件)

| N | ブランド数 | マッチ件数 | ヒット率 |
|---:|---:|---:|---:|
| 4 | 50,318 | 1,402 | 19.95% |
| 5 | 46,781 | 690 | 9.82% |
| 6 | 41,631 | 397 | 5.65% |
| 7 | 35,589 | 216 | 3.07% |
| 8 | 30,006 | 153 | 2.18% |
| 10 | 21,021 | 48 | 0.68% |

N=5 の純増マッチ 657 件のランダム 25 件を目視、**誤爆率 68%** (17/25)。誤爆の例:

- `karin` ← 「KARIN様専用」(人名)
- `enough` ← 「enough.】様 リクエスト」(一般語)
- `living` ← 「BTS ARIRANG LIVING LEGEND」(アルバム名)
- `butterfly` ← 「butterfly様 リクエスト」(愛称)
- `apple` ← 「ApplePencil互換」(電子機器)
- `japan` ← 「STAY JAPAN」(地名)
- `piece` ← 「ONEPIECE」(作品名)
- `dream` ← 「daydream スクイーズ」(一般語)
- `bonbon` ← 「CANDY BONBON シール」(商品シリーズ)

正しく除外に寄与したのは `miu miu`, `stone island`, `seventeen`, `shein`, `stokke` 等の一部のみで、これらは現行辞書 `brand_imitation` で既にカバー済み領域と重複。

## 検討した案

### 案 A: itemBrand 付きを collect_step で一律除外 (採用)

`research/collect.js` で `withItemBrand: true` に変更し、`item.itemBrand` が非 null のアイテムは収集しない。

**メリット**:
- 実データ検証で itemBrand 付き 1,871 件 (21%) はすべて仕入れ候補外と確認
- 収集後段 (辞書判定・構造化抽出・同一商品判定) の負荷が 21% 軽減
- 誤除外率は 1 件あたり 442 件中 0〜4 件程度 (95% 信頼区間) + `no brand` 該当の一部で、全体の 0.05% 未満
- 実装は単純、保守コスト低

**デメリット**:
- `no brand (id=40540)` に仕入れ候補になり得る商品 (バンダナ・犬服・トレーニング器具等) が 2-3 件含まれる (全体の 0.03%)
- マスタの総称ブランド (SQUEEZE, NAILS, MUSIC TEE) もこの除外に含まれるが、実体は仕入れ候補外なので問題ない

### 案 B: itemBrand 付きは除外、ただし `no brand` (id=40540) は例外扱い (却下)

case_A に加え `item.itemBrand.id !== '40540'` の条件を付けて `no brand` だけ通過させる。

**却下理由**:
- 対象 6 件中仕入れ候補は 2-3 件 = 全体の 0.03% を救うだけのために特定 ID をハードコードする保守負債が見合わない
- `no brand` の中身 (バンダナ・犬服・トレーニング器具) は画像を見ないと模造品/ノーブランド純粋品が区別不能で、タイトル辞書段階で救っても精度は上がらない
- うち 3-4 件は既存辞書 (`brand_imitation` 連想・`food` 6 歳以下) で部分的に捕獲可能

### 案 C: マスタを辞書 `brand_imitation` の代替として利用 (却下)

マスタの `name` を N 文字以上で絞り込み、`exclude_by_keywords` の判定ロジックでタイトルにマッチしたら除外する。これにより現行辞書 `brand_imitation` (184 エントリ) を削減する。

**却下理由**:
- N=5 で 46,781 ブランドを対象としたマッチで誤爆率 68% (ランダム 25 件中 17 件が仕入れ候補との誤爆)
- 誤爆源は「長さは 5 文字以上だが一般語・人名・地名・フレーズ由来のブランド」(`apple`, `japan`, `dream`, `butterfly`, `living` 等) が多数存在するため、N を上げても根本解決しない
- N=10 まで絞り込むと残存マッチ 48 件 (0.68%) となり辞書削減効果が極小
- カナ表記 (アディダス・ユニクロ等 109 件) はそもそもマスタに無いため辞書に残さざるを得ない
- 現行辞書 `brand_imitation` 184 エントリは手動で厳選された高 Precision な資産であり、マスタで代替すると Precision が悪化する
- itemBrand 付きは案 A の collect_step 除外で既にカバーされるため、タイトルマッチで重ねる実益が小さい

### 案 D: 現状維持 (辞書のみ、itemBrand 未使用) (却下)

**却下理由**:
- 案 A で収集段階から 21% を削減できる機会を逃す
- 辞書の Recall 改善の足しにならない

## 決定事項

以下の 2 つを決定する:

1. **案 A を採用**: `research/collect.js` で `withItemBrand: true` に変更し、`item.itemBrand` が非 null のアイテムは収集しない。WHY コメントで `no brand` の例外候補を救わない判断根拠を残す (実装済み)

2. **案 C を却下**: Mercari ブランドマスタは辞書 `brand_imitation` の代替として**使わない**。ただしマスタ自体はリファレンスとして git 管理 ([`../procedures/exclude_by_keywords/brand_master/`](../procedures/exclude_by_keywords/brand_master/)) を維持し、以下の補助用途に限定して活用する:
   - 辞書に新規キーワードを追加する際の検証リファレンス (マスタに存在するブランドか否か)
   - `expand_dictionary.js` (暫定辞書生成) における新規ブランド候補の品質判定補助

## 結果

### 期待される効果

- collect_step 後の母集団が 8,899 → 約 7,028 件 (-21%) になり、辞書判定・構造化抽出・同一商品判定の総処理コストが削減される
- 辞書 `brand_imitation` の責務は「itemBrand 空欄商品のタイトル内ブランド名判定」に明確化され、現行辞書を維持する根拠が明確になる
- マスタは git 管理された参照資産として、辞書メンテナンス時の品質保証に使える

### トレードオフ (デメリット)

- `no brand` の 0.03% (2-3 件/8,059 件) は仕入れ候補が取りこぼされる可能性がある
- Mercari がブランドマスタに総称エントリ (SQUEEZE 等) を追加しても自動追随できない (マスタ再取得の手動タスクが必要)
- itemBrand フィールドのスキーマが将来変更された場合、collect.js が無言で機能しなくなるリスクがある (テストが必要)

### 将来的な考慮事項

- 画像分類 PoC を導入する場合、「itemBrand 空欄 + 連想デザイン NG (Chrome Hearts クロス・adidas 三本ライン等)」の検出がメインターゲットになる (現状 Recall 悪化の主要因)
- マスタは数ヶ月に 1 回 ETag 比較で再取得する運用を [README](../procedures/exclude_by_keywords/brand_master/README.md) に記載済み
- `no brand` の仕入れ候補取りこぼしが問題化した場合は、本 ADR を廃止して案 B (id=40540 例外化) への移行を検討する

## 関連ファイル

- [`research/collect.js`](../research/collect.js) — 案 A の実装
- [`procedures/exclude_by_keywords/keywords.json`](../procedures/exclude_by_keywords/keywords.json) — 現行辞書 (本決定では変更なし)
- [`procedures/exclude_by_keywords/brand_master/`](../procedures/exclude_by_keywords/brand_master/) — マスタ本体・メタ情報・再取得手順書
- [`docs/research/mercari/keywords_design_notes.md`](../docs/research/mercari/keywords_design_notes.md) — 辞書設計原則 (本決定の背景理解に必要)
