> 本ドキュメントは [`overview.md`](../overview.md) の工程 **(1)商品リサーチ** の新手順である。旧手順は [`mercari-research.md`](./mercari-research.md) に残している。
> 本 v2 は仕入れ判断者の判定ルール (色違い別/個数違い別/用途違い別 等) に準拠して再設計している。判定ルール一覧は [`docs/research/mercari/judgment_examples/`](../docs/research/mercari/judgment_examples/)、除外辞書の設計原則は [`docs/research/mercari/keywords_design_notes.md`](../docs/research/mercari/keywords_design_notes.md) を参照。

---

## 旧手順との違い

旧 `mercari-research.md` は「タイトル先頭 28 文字の正規化完全一致」でクラスタリングする方式だった。これは:

- 同じ商品を別出品者がタイトル・画像・説明文を変えて出品する実務慣習 (通報回避) に対応できていない
- 色違い/個数違い/セット違い/サイズ違い 等の判定ルールを反映できていない

v2 は正解リスト (ground truth) を先に作り、それを基準に新クラスタリング実装を書く方針。本ドキュメントでは **正解リスト作成までの手順** を扱う。クラスタリング実装以降は完成後に別ドキュメントで記述する。

---

## 同一商品判定の前提

メルカリの売れ筋リサーチにおいて、**「タイトル・画像・説明文が一致する商品だけが同一商品」ではない**。中国輸入品は同じ商品を複数の出品者が扱うが、出品者は以下の理由でタイトル・画像・説明文を故意に変えて出品する慣習がある:

- **他出品者のコピーとして通報されるリスクを避けるため**
- 画像を自分で撮り直したり、説明文を自分なりに書き直したり、タイトルの語順や語句を入れ替えたりする
- つまり **タイトル・画像・説明文が別でも、実体 (色・サイズ・個数・セット・素材・用途・柄) が一致すれば同一商品**

よって同一商品判定は最終的にタイトル文字列ではなく **実体属性の一致** で行う必要がある。

### 別商品として扱うべき軸 (一般則)

実体属性のうち、違いがあれば別商品として扱うべき軸:

| 軸 | 例 |
|---|---|
| **色** | 白 / 黒 / 灰、ベージュ / ブラウン、シルバー / ゴールド |
| **サイズ** | A3 / A4 / B4、S / M / L / XL、90cm / 100cm / 140cm |
| **個数・セット数・容量** | 100 枚 / 150 枚、2 枚セット / 4 枚セット、500g / 900g |
| **柄** | 無地 / 花柄 / チェック / 十字架 |
| **素材** | 綿 / ポリエステル、本革 / 合皮、ビニール / OPP |
| **用途・機能** | ショルダーバッグ / トートバッグ / クラッチバッグ、サニタリーショーツ / ボクサーパンツ |

これらの軸は [`docs/research/mercari/judgment_examples/README.md`](../docs/research/mercari/judgment_examples/README.md) L13 に実体属性一覧として明記されている一般則である。

### `judgment_examples/` の位置づけ (重要)

[`docs/research/mercari/judgment_examples/`](../docs/research/mercari/judgment_examples/) にある判定例 (`色違いは別商品.md`、`個数違いは別商品.md` 等) は、**実際のリサーチや LLM 判定で迷った/誤ったケースを実物商品とスクリーンショット付きで記録した「困難例集」** である。**一般則の網羅リストではない**。

- 例えば `素材違いは別商品.md` というファイルは存在しないが、これは運用ルール `judgment_examples/README.md` L36「判定に迷わない自明な例は記録しない」による
- 判定例ファイルが無い軸であっても、上記表の一般則は適用される
- 新たに判定で迷ったケースが出た時に `judgment_examples/` に追加していくのが運用方針

判定例にファイルが無いからといって、その軸を無視してはならない。原則は常に README L13 の「実体属性の一致」である。

### 現行実装の限界 (v1)

旧 `research/analyze.js` と `research/rival_count.js` は「タイトル先頭 28 文字の正規化完全一致」でクラスタリングする実装であり、上記の前提を満たしていない。同じ商品が別出品者によって違うタイトルで出品されていた場合、別クラスタになってしまい同一商品の取りこぼしが発生する。

v2 ではこの問題を解消するため、後段で各行から **実体属性を構造化フィールドとして抽出** し、その属性の一致で同一商品をまとめる設計にする (本手順書更新時点では設計検討中)。

---

## 全体フロー (ここまでの確定範囲)

```
1. 収集 (collect_step)
     ↓ 生データ (約 8,000 items, JSON)
2. 販売実績の集約 (aggregate_step) (seller + title 単位、count で実績数を保持)
     ↓ 約 7,000 エントリ (TSV)
3. 暫定辞書の生成 (dictionary_expansion_step)
     ├─ 正規辞書のみで一次除外を走らせて unflagged を得る
     └─ Opus に unflagged を見せて新規キーワードを抽出 → keywords_pending.json
4. キーワード除外 (keyword_exclusion_step)
     ├─ 正規辞書 + 暫定辞書で判定
     ├─ flagged エントリ → 仕入れ候補から除外
     └─ unflagged エントリ → 次段へ
5. 主要ワード抽出 (primary_token_extraction_step) (Sonnet)
     出力 = 各エントリに商品本質を表す 1-2 語
```

### 各段階で残る件数の実績 (2026-04-16 データ、実装済み範囲のみ)

| 段階 | 入力 | 出力 | 前段比 | 初期比 |
|---|---|---|---|---|
| 1. 収集 (14日 SOLD) | - | 8,059 件 | - | 100% |
| 2. 集約 (seller+title 重複除去) | 8,059 件 | 7,223 件 | -10% | 89.6% |
| 3. 暫定辞書の生成 (件数は減らない) | 7,223 件 | 7,223 件 | 0% | 89.6% |
| 4. キーワード除外 (flagged 除外、unflagged が残る) | 7,223 件 | 約 4,800 件 | -33% | 約 60% |
| 5. 主要ワード抽出 (件数は減らない) | 約 4,800 件 | 約 4,800 件 | 0% | 約 60% |

第 4 段階の unflagged 件数は辞書改善で変動する。最新の参考値は `docs/research/mercari/exclude_by_keywords_precision_check.md` を参照。クラスタリング以降の件数は、クラスタリングロジックの設計で大きく変わる。現在まさにそのロジックの精度を上げるために設計を精査しているため、想定値は意図的に書かない (書くと将来のセッションがそれを事実として扱い、精度改善の前提が歪むため)。

---

## 第 1 段階: 収集 (collect_step)

旧手順と同じ。`research/collect.js` を `browser_evaluate` 経由で実行して 14 日 SOLD データを収集する。

- 入口キーワード 10 種 × 価格帯 5 区間 = 50 組み合わせを並列実行
- DPoP 認証のため事前に `https://jp.mercari.com` をブラウザで開いておく
- 出力: `research/YYYY_MM_DD_HH_MM__mercari_14day_results.json` (生データ、約 8,000 items)

入口キーワードと価格帯の詳細は旧 `mercari-research.md` の同セクションを参照。

---

## 第 2 段階: 販売実績の集約 (aggregate_step)

生データを `seller + title` で集約し、タイトル順にソートした TSV を作る。

### 目的

同一出品者が同じ商品を 14 日以内に複数回出品 (売れたら再出品) している場合、それらを 1 エントリに集約する。ただし **販売実績数を失わないよう `count` フィールドで保持する**。

- `count ≥ 3` のエントリはそれ単体で「14 日以内に同一商品が 3 件売れた」と確定
  → 仕入れ候補条件 (3 件以上) を満たすコアクラスタとして後段に渡る
- `count = 1 or 2` のエントリは他出品者の同商品と合流 (後段のクラスタリング) できれば仕入れ候補条件を満たす可能性
- 後段のキーワード除外の処理対象を減らす効果もある (同じタイトルを何度も判定しない)

### 出力

- `tmp/YYYY/MM/DD/all_items_sorted_from_YYYYMMDD.tsv`
- 1 行フォーマット: `[count] ¥price <TAB> seller_id <TAB> title <TAB> item_ids`
- `count`: 同じ seller+title の **販売実績数** (14 日以内の SOLD 件数)
- `price`: ¥min または ¥min-max (価格変動があった場合はレンジ)
- `item_ids`: 元の item id のカンマ区切り

### 実行

```bash
node research/aggregate.js research/<rawfile>.json
```

出力先を明示指定する場合:

```bash
node research/aggregate.js research/<rawfile>.json tmp/<path>/all_items_sorted_from_<date>.tsv
```

省略時は `tmp/YYYY/MM/DD/all_items_sorted_from_<生データ日付>.tsv` に自動配置される (ディレクトリは作業日 JST、ファイル名は入力ファイル名から抽出した日付)。

実行後、stdout に summary JSON が出る:

```json
{
  "input": "research/2026_04_16_06_46__mercari_14day_results.json",
  "output": "tmp/2026/04/16/all_items_sorted_from_20260416.tsv",
  "totalItems": 8059,
  "uniqueRows": 7223,
  "coreClusters_count_ge_3": 169
}
```

`coreClusters_count_ge_3` は `count ≥ 3` のコアクラスタ数 (その時点で仕入れ候補条件を単独で満たす件数の目安)。

---

## 第 3 段階: 暫定辞書の生成 (dictionary_expansion_step)

正規辞書 `procedures/exclude_by_keywords/keywords.json` に加えて、**リサーチ実行時にそのリサーチ限りの暫定辞書 `keywords_pending.json` を別ファイルで生成**する段階。次の第 4 段階 (キーワード除外) は「正規辞書 + 暫定辞書」の合算で判定する。正規辞書への反映はリサーチ後の別プロセスで行う (本手順書の対象外)。

### 狙い

正規辞書は過去に確認済みのキーワードしかカバーできず、新しいブランド・商品名・カテゴリに追随できない。AI (Opus) の知識と当回の生タイトル群から「正規辞書に未登録で除外対象になり得るキーワード」を抽出し、その回のリサーチに即時反映する。正規辞書へ取り込むかどうかはリサーチ後に判断するため、ノイズ候補が正規辞書に混入するリスクは切り離される。

### 前提条件

- 第 2 段階 (集約) が完了し、生データ `research/<rawfile>.json` が存在する
- 実装スクリプト: `research/expand_dictionary.js` (本段階専用) と `research/_classifier.js` (共通ロジック)

### 入力

- 生データ: `research/<rawfile>.json`
- 参照される静的ファイル (スクリプトが Opus プロンプトに絶対パスを埋め込む):
  - 正規辞書: `procedures/exclude_by_keywords/keywords.json`
  - 設計メモ: `docs/research/mercari/keywords_design_notes.md`
  - 参考 PDF: `references/注意商品.pdf`
  - 参考 PDF: `references/new仕入れ禁止商品_アパレル.pdf`

### 出力

- `tmp/YYYY/MM/DD/dict_expansion/unflagged_titles.json` (Node 側で生成)
- `tmp/YYYY/MM/DD/dict_expansion/opus_prompt.md` (Node 側で生成、絶対パス置換済みのサブエージェント用プロンプト)
- `tmp/YYYY/MM/DD/dict_expansion/keywords_pending.json` (Opus サブエージェントが書き出す、次段の `--pending` 入力)

フォーマットは正規辞書と同じ `priority` + `keywords`、加えて `_sources` で抽出根拠を併記。

---

### 手順 1: Node 側の事前処理

正規辞書で一次除外をかけ、unflagged タイトルの抽出と Opus 用プロンプト (絶対パス置換済み) の生成まで 1 コマンドで実施する:

```bash
node research/expand_dictionary.js research/<rawfile>.json
```

省略可能な第 2 引数で出力先を明示指定できる (デフォルトは `tmp/YYYY/MM/DD/dict_expansion/`):

```bash
node research/expand_dictionary.js research/<rawfile>.json tmp/<path>/dict_expansion
```

stdout に生成ファイルのパスと `unflagged_count` が JSON で出る。

---

### 手順 2: Opus サブエージェントに抽出を依頼

Claude Code の Agent ツール (`subagent_type=general-purpose`, `model=opus`) を起動し、手順 1 で生成された `opus_prompt.md` の **内容をそのまま** `prompt` 引数に渡す。プロンプト内の入出力パスは全て絶対パスで埋め込み済みのため、追加の置換は不要。

Agent 完了後、指定した `keywords_pending.json` が書き出されている。

---

### 手順 3: 出力 JSON のバリデーション

```bash
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("tmp/<path>/dict_expansion/keywords_pending.json", "utf8"));
const PRIORITY = ["food","plant_quarantine","medical","cosmetics_yakki","character_copyright","brand_imitation","electronics_check","handmade"];
if (!Array.isArray(p.priority) || !p.keywords) throw new Error("Missing priority or keywords");
let total = 0;
for (const cat of Object.keys(p.keywords)) {
  if (!PRIORITY.includes(cat)) throw new Error("Unknown category: " + cat);
  total += p.keywords[cat].length;
}
console.log("OK. total new keywords:", total);
'
```

バリデーションエラー時は手順 2 (Opus Agent) を再実行する (下記の再試行ルール参照)。

---

### エラー時の再試行ルール

| エラー | 対処 |
|---|---|
| Opus 出力が JSON パースに失敗 | 「前回出力が JSON としてパースできませんでした。全量を JSON 形式で再生成してください」とフォローアップ |
| カテゴリ名が 8 種以外 | 「カテゴリ名は food / plant_quarantine / medical / cosmetics_yakki / character_copyright / brand_imitation / electronics_check / handmade に限定してください」と伝えて該当箇所のみ修正させる |
| 既存辞書との重複が多い | 重複分をバリデーションで除外し、残りだけで続行 |
| 抽出数ゼロ | プロンプトの絶対パスが正しいか確認。それでもゼロなら本当に抽出すべきキーワードがない可能性もある |

---

## 第 4 段階: キーワード除外 (keyword_exclusion_step)

タイトルにあらかじめ用意した除外キーワードが含まれていたら「除外フラグ」を付ける機械処理。LLM は使わず Node.js の `String.prototype.includes()` による部分文字列マッチ。数秒で全 7,000 件を処理できる。

### 目的

明らかに仕入れ候補外のもの (食品・ブランド模造・キャラ・ハンドメイド 等) を機械的に除外する。第 3 段階で生成した暫定辞書と正規辞書の両方を合わせて判定する。

### 分類カテゴリ (9 種類)

| カテゴリ | 意味 |
|---|---|
| `food` | 食品衛生法対象 (食品全般) |
| `plant_quarantine` | 植物検疫対象 |
| `medical` | 医療機器 |
| `cosmetics_yakki` | 化粧品・医薬部外品 (薬機法) |
| `character_copyright` | キャラクター版権 |
| `brand_imitation` | ブランド名記載 (模造品疑い) |
| `electronics_check` | 電波法・PSE (Bluetooth 本体・スマートウォッチ等) |
| `handmade` | ハンドメイド (中国輸入品ではない) |
| `private_transaction` | 取引専用ページ (様専用・様リクエスト等、文字数制限で商品情報が欠落し仕入れ判断不能) |

### 優先度順序 (複数に該当した場合の primary 決定)

```
food > plant_quarantine > medical > cosmetics_yakki > character_copyright > brand_imitation > electronics_check > handmade > private_transaction
```

全マッチは `matches` 配列にも残す。

### 判定語リストの根拠

各判定語は以下の資料のいずれかに根拠を持つ:

- `references/注意商品.pdf` (仕入れ禁止商品カテゴリ・法令リスク)
- `references/new仕入れ禁止商品_アパレル.pdf` (アパレル特化の禁止事例)

設計パターン (notWith / withAll の使い分け、短語誤爆の対処など) は `docs/research/mercari/keywords_design_notes.md` を参照。

### 辞書と実装の場所

- **正規辞書**: `procedures/exclude_by_keywords/keywords.json`
- **暫定辞書** (当回のみ): `tmp/YYYY/MM/DD/dict_expansion/keywords_pending.json` (第 3 段階の出力)
- **実装スクリプト**: `research/exclude_by_keywords.js`
- **設計原則・パターン** (notWith / withAll / 短語誤爆の対処): `docs/research/mercari/keywords_design_notes.md`
- **精度確認と辞書更新の運用ルール**: `docs/research/mercari/exclude_by_keywords_precision_check.md`

辞書を JSON にしてスクリプトと分離してあるので、辞書だけの編集で再判定できる (コード変更なし)。

### 実行

```bash
node research/exclude_by_keywords.js research/<rawfile>.json tmp/<path>/exclusion_final \
  --pending tmp/<path>/dict_expansion/keywords_pending.json
```

出力:

- `tmp/<path>/exclusion_final/exclusion_output.json` (全 unique row と仮フラグ、最終版)
- `tmp/<path>/exclusion_final/exclusion_stats.md` (カテゴリ別件数の統計サマリー)

出力 JSON の各行:

```json
{
  "rowIndex": 0,
  "seller": "876120289",
  "name": "商品タイトル",
  "priceMin": 999,
  "priceMax": 999,
  "count": 1,
  "ids": ["m71226933068"],
  "exclusion": {
    "primary": "food",
    "matches": { "food": ["ふきのとう"] }
  }
}
```

`exclusion: null` なら印なし → 第 5 段階へ進む
`exclusion != null` なら印あり → 仕入れ候補から除外

### 参考値 (2026-04-16 データ、7,223 unique 行、正規辞書のみ・2026-04-19 時点)

| カテゴリ | 件数 | 割合 |
|---|---|---|
| food | 268 | 3.7% |
| plant_quarantine | 22 | 0.3% |
| medical | 1 | 0.0% |
| cosmetics_yakki | 231 | 3.2% |
| character_copyright | 1,035 | 14.3% |
| brand_imitation | 314 | 4.3% |
| electronics_check | 25 | 0.3% |
| handmade | 130 | 1.8% |
| private_transaction | 364 | 5.0% |
| **unflagged** | **4,833** | **66.9%** |

辞書改善・withAll 追加で変動。最新の参考値は `docs/research/mercari/exclude_by_keywords_precision_check.md` を参照。

---

## 第 5 段階: 主要ワード抽出 (primary_token_extraction_step)

第 4 段階の unflagged 行を対象に、「この商品は何か」を表す主要ワード 1〜2 語を LLM (Sonnet) で抽出する。

### 目的

後段のクラスタリングで同じ商品を束ねるためのキー。タイトル文字列そのまま (表記揺れ多数) ではなく、**本質を表す正規化された語** を用意する。

### 入力

- 第 4 段階で `exclusion: null` だった行 (unflagged)

### モデルとコスト

- モデル: Claude Sonnet
- コスト目安: 約 5,000 行で $3〜5
- 時間目安: 5 並列 sub-agent で 30〜40 分

### 前処理: TSV を並列処理用にチャンク分割

unflagged 行を 12 チャンク程度 (400 行 × n) に分割する:

```bash
node -e '
const fs = require("fs");
const out = JSON.parse(fs.readFileSync("tmp/<path>/exclusion_final/exclusion_output.json", "utf8"));
const targets = out.rows.filter(r => r.exclusion === null);

const CHUNK = 400;
for (let i = 0; i < Math.ceil(targets.length / CHUNK); i++) {
  const slice = targets.slice(i * CHUNK, (i + 1) * CHUNK);
  const lines = slice.map(r => {
    const pr = r.priceMin === r.priceMax ? `¥${r.priceMin}` : `¥${r.priceMin}-${r.priceMax}`;
    const cnt = r.count > 1 ? `[${r.count}件] ` : "";
    return `${r.rowIndex}\t${cnt}${pr}\t${r.seller}\t${r.name}`;
  });
  fs.writeFileSync(`tmp/<path>/fullrun_chunks/chunk_${String(i).padStart(2, "0")}.tsv`, lines.join("\n"));
}
'
```

各 TSV の行フォーマット: `rowIndex <TAB> [count] ¥price <TAB> seller_id <TAB> title`

### 並列実行戦略

5 sub-agent (全て Sonnet、`run_in_background=true`) でチャンクを分担。チャンク数が 12 ある場合の分担例:

| Sub-agent | 担当チャンク |
|---|---|
| agent 1 | chunks 00-02 (3 チャンク) |
| agent 2 | chunks 03-05 (3 チャンク) |
| agent 3 | chunks 06-08 (3 チャンク) |
| agent 4 | chunks 09-10 (2 チャンク) |
| agent 5 | chunk 11 (1 チャンク) |

### プロンプトのルール

各 sub-agent に渡すプロンプトの核となるルール:

#### 処理方法の厳格指定

- Bash/Node スクリプトでの一括処理は禁止
- 正規表現・辞書マッチングは禁止
- 各行を LLM 推論で 1 行ずつ判定
- 許可ツール: Read、Write のみ

#### rowIndex の厳守

入力 TSV の先頭の数字 (rowIndex) を、出力 JSON にそのままコピーする。**絶対に 1, 2, 3 と勝手に振り直さない**。

#### JSON エスケープの厳守

タイトルに `\` (顔文字 `\(^o^)/` 等) があれば、JSON では `\\` とエスケープする。

#### 中間 Write

各チャンク内で 100 件処理するごとに、現在までの結果配列を Write で上書きする (途中停止対策)。

#### 基本方針

- タイトルの本質 = 「この商品は何か」を表す 1 語 (不可能な場合のみ 2 語)
- 色・サイズ・個数・セット数・型番・価格・形容詞・煽り文句は除外
- ブランド名・キャラクター名は主要ワードに入れない

#### ルール 1: 表記揺れは一般的な方に寄せる

- 「鏡」と「ミラー」両方ありうる → `ミラー` (カタカナ優先)
- 「ヘアーキャッチャー」「ヘアキャッチャー」→ `ヘアキャッチャー` (長音なし)
- 「圧縮バッグ」「圧縮袋」→ `圧縮袋`
- 漢字定着語 (「袋」「靴」「服」等) はそのまま

#### ルール 2a: 装飾・形状の修飾語は外す

- クリアバインダー → `バインダー`
- ミニチェスト → `チェスト`
- 撮影背景布 → `背景布`
- 卓上ミラー → `ミラー`
- 化粧水ミスト → `化粧水`

#### ルール 2b: 用途・機能・ユーザー層を示す修飾語は残す

**バッグ系**: ショルダーバッグ / トートバッグ / クラッチバッグ / エコバッグ / パーティバッグ / 保冷バッグ / マザーズバッグ / ビジネスバッグ / ボディバッグ / リュック / ガーメントバッグ / ポーチ / 財布 / コインケース

**下着・ショーツ系**: サニタリーショーツ / ボクサーパンツ / マタニティショーツ / ベビーショーツ / ブラジャー / キャミソール / ベビードール

**シール系**: シール / ステッカー / タイルシール / ウォーターシール / フレークシール / マステ

**衣類**: Tシャツ / パーカー / スウェット / ニット / ブラウス / カットソー / チュニック / ワンピース / スカート / ドレス / パジャマ / ルームウェア

**靴**: スニーカー / サンダル / パンプス / ブーツ / ローファー / ヒール

**財布の形状**: 二つ折り財布 / 長財布 / ミニ財布 / ラウンドファスナー財布

#### ルール 2 の判断フロー

「この修飾語を外したら、商品の本質的な用途・機能が変わるか?」
- 変わる → 残す
- 変わらない → 外す

#### ルール 3: 複合名詞は 1 語扱い

「ネイルチップ」「クッションカバー」「宅配ビニール袋」「キーホルダー」は 1 語。

### 出力

各 sub-agent が担当チャンクごとに JSON を書く:

- `tmp/YYYY/MM/DD/fullrun_chunks/keywords_chunk_NN.json`

フォーマット:

```json
[
  {"rowIndex": 2, "title": "...", "keywords": ["リボン"]},
  {"rowIndex": 3, "title": "...", "keywords": ["背景布"]},
  ...
]
```

### 統合

全チャンクの結果を 1 つのファイルに結合する:

```bash
node -e '
const fs = require("fs");
const all = [];
for (const p of fs.readdirSync("tmp/<path>/fullrun_chunks").filter(f => f.startsWith("keywords_chunk_") && f.endsWith(".json"))) {
  all.push(...JSON.parse(fs.readFileSync(`tmp/<path>/fullrun_chunks/${p}`, "utf8")));
}
const uniq = new Map();
for (const d of all) uniq.set(d.rowIndex, d);
const merged = [...uniq.values()].sort((a, b) => a.rowIndex - b.rowIndex);
fs.writeFileSync("tmp/<path>/keywords_full_sonnet.json", JSON.stringify(merged, null, 2));
console.log("total:", merged.length);
'
```

出力: `tmp/YYYY/MM/DD/keywords_full_sonnet.json`

---

## 作業ディレクトリ構成 (中間ファイル)

```
tmp/YYYY/MM/DD/
├── all_items_sorted_from_YYYYMMDD.tsv            # 第 2 段階 集約出力
├── dict_expansion/                               # 第 3 段階 暫定辞書生成
│   ├── unflagged_titles.json                     #   正規辞書のみで仕分けた候補タイトル
│   ├── opus_prompt.md                            #   Opus サブエージェント用プロンプト
│   └── keywords_pending.json                     #   Opus が書き出す暫定辞書
├── exclusion_final/                              # 第 4 段階 最終除外出力
│   ├── exclusion_output.json                     #   正規辞書 + 暫定辞書で最終判定
│   └── exclusion_stats.md
├── fullrun_chunks/
│   ├── chunk_00.tsv ... chunk_NN.tsv             # 第 5 段階 入力
│   └── keywords_chunk_00.json ... NN.json        # 第 5 段階 出力
└── keywords_full_sonnet.json                     # 第 5 段階 統合
```

永続ファイル (git 管理):

```
procedures/exclude_by_keywords/keywords.json                   # 正規辞書 (定期更新)
research/aggregate.js                                          # 第 2 段階の実装スクリプト
research/expand_dictionary.js                                  # 第 3 段階の実装スクリプト
research/exclude_by_keywords.js                                # 第 4 段階の実装スクリプト
research/_classifier.js                                        # 第 3・4 段階の共通ロジック (内部ヘルパー)
```

---

## この先

第 5 段階の出力が揃った時点で、以下が揃う:

- 第 4 段階で除外された約 2,400 件 (誤判定の約 6% は辞書改善で対処中)
- 第 5 段階の主要ワード付き unflagged 約 4,800 件

これらを元に「仕入れ候補プール + 主要ワード」を整理し、次のステップ (クラスタリング以降) に進む。以降の手順は実装・検証が終わってから追加する。

---

## 補足: LLM による全件誤判定見直しを採用しなかった理由

2026-04-18 の検証で以下が判明したため、LLM による全件画像判定は採用しない:

- 第 4 段階 (キーワード除外) の精度は 92.7% で、誤判定は 6% 程度 (150 件の層別サンプリング検証)
- 誤判定のほぼ全ては「一般語の部分文字列マッチ」が原因
- これらは辞書改善 (単語境界マッチ/組み合わせマッチ/文脈除外) で大半を潰せる
- LLM + 画像判定を全件走らせるコスト ($15-20 + 数時間) に対して、辞書改善の方がコスト効率が高い

関連検証作業の記録は `tmp/2026/04/17/step_c_*` および `tmp/2026/04/17/gt_sample_150/` に残してある。
