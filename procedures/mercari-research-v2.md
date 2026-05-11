# メルカリ売れ筋リサーチ手順 v2

## やりたいこと

本ドキュメントは [`overview.md`](../overview.md) の工程 **(1) 商品リサーチ** の手順書である。

メルカリで中国輸入製品を調査し、以下の 2 条件を満たす商品を **仕入れ候補** として最後に出力する。
  
- **ブランド模造・その他の除外条件に合致しないもの** (→ 第 4 段階で判定: キーワード除外 + サブステップ画像除外)
- **14 日間に 3 個以上の販売実績があるもの** (販売実績 = 購入者が決まった件数。メルカリのステータス `sold_out` と `trading` の両方を「売れた」として同列に数える。第 1 段階 collect_step で両者を収集し、第 2 段階で集約、第 6 段階 6-3 でクラスタ内の販売件数合計 (`count_total` = クラスタ内全 row の `ids` 配列要素数の合計) が 3 件以上の場合に `is_purchase_candidate=true` として判定。row 数 (`size`) ではなく `count_total` で判定するのは、1 seller が同一商品を 3 件以上売った場合も拾うため)

※ **「同商品の販売者数 10 人未満のもの (販売中ライバル数カウント)」はスキップする** (本手順書では扱わない)。

この 2 条件を両方通過したクラスタを CSV のレポートとして書き出す。レポート出力の詳細は本手順書末尾「## 第 7 段階: 仕入れ候補書き出し (purchase_candidate_export_step)」を参照。

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

これらの軸は [`docs/research/mercari/judgment_examples/README.md`](../docs/research/mercari/judgment_examples/README.md) の「前提知識: タイトル・画像・説明文は同一商品判定の最終根拠ではない」セクションに実体属性一覧として明記されている一般則である。

### `judgment_examples/` の位置づけ (重要)

[`docs/research/mercari/judgment_examples/`](../docs/research/mercari/judgment_examples/) にある判定例 (`色違いは別商品.md`、`個数違いは別商品.md` 等) は、**実際のリサーチや LLM 判定で迷った/誤ったケースを実物商品とスクリーンショット付きで記録した「困難例集」** である。**一般則の網羅リストではない**。

- 例えば `素材違いは別商品.md` というファイルは存在しないが、これは `judgment_examples/README.md` の「運用ルール」セクションの「判定に迷わない自明な例は記録しない」による
- 判定例ファイルが無い軸であっても、上記表の一般則は適用される
- 新たに判定で迷ったケースが出た時に `judgment_examples/` に追加していくのが運用方針

判定例にファイルが無いからといって、その軸を無視してはならない。原則は常に README の「前提知識」セクションに示された「実体属性の一致」である。

---

## 出力ファイルの共通原則

### 原則 1: 一度書き出したら更新禁止 (不変)

本手順書の各段階が書き出す成果物ファイル (`aggregate/`、`dict_expansion/`、`exclusion_final/`、`image_review/` 配下全て、`structured_extraction/` 配下全て、`visual_extraction/` 配下全て、`identity_resolution/` 配下全て、および第 7 段階出力の `reports/YYYY/MM/YYYY_MM_DD_NN_メルカリ売れ筋リサーチ_v2.csv`) は **全て不変** とする。

- 誤った出力が見つかった場合は、入力側を修正して該当ファイル以降を再生成する
- 元ファイルを直接書き換えると、監査 (どの値がどう変換されたか追跡) と再生成 (やり直し) の両方が効かなくなる
- 再生成は「該当段階の入力を直す → 該当以降の段階を順に流す」が基本

### 原則 2: Agent 起動時はプロンプト本体に禁則を必ず含める

各 Agent (Sonnet / Haiku / 画像判定用 Sonnet 等) に渡すプロンプト本体の冒頭に、以下の禁則セクションを必ず含める:

1. 指定出力パス以外にファイルを作成しない
2. 入力ファイルを書き換えない
3. プロジェクト内の他ファイルを変更しない (Edit / Write / NotebookEdit は出力パスへの 1 回の書き込みのみ)
4. 違反しそうな操作は実行せず報告する

雛形は [`research/structured_extraction_prompt.md`](../research/structured_extraction_prompt.md) 冒頭の「【絶対禁則】ファイル操作の制約」セクションを参照。新しい Agent プロンプトを作る時は必ず同じ雛形を埋め込む。

### 原則 3: Agent 完了後は親 Claude が検証する

Agent 起動後、毎回以下をチェックする:

1. **出力ファイルの存在確認**: 指定パスに出力が作成されているか (`ls <output-path>`)
2. **入力ファイルの不変確認**: 入力ファイルの mtime・サイズが Agent 起動前と同じか (`stat <input-path>` を起動前後で比較)
3. **想定外のファイル作成なし**: Agent 起動前後で `git status` を比較し、想定外のファイルが作られていないか確認

違反が見つかったら、該当 Agent の出力を破棄 (使わない) して、プロンプトと Agent 指示を見直してからやり直す。

---

## Agent 運用の共通原則

Sonnet / Haiku いずれの Agent を起動する工程 (第 4 段階画像除外 / 第 5 段階 5-1・5-2・5-3 / 第 6 段階 6-2) は本原則を踏襲する。本原則は過去検証 (`procedures/exclude_by_keywords_precision_check/README.md` §7) の運用知見を本手順書に展開したものである。

**最重要** — 本手順書の Agent 工程は **使用制限・レート制限で途中停止することを前提に設計されている**。件数が多い段階 (5-1 は 32 chunk / 5-3 は約 32 バッチ / 6-2 は pending グループ数だけ) は 1 日で完走できない想定で、**すべて中断再開できるように進める**。以下の原則を守らないと、ヒット時に判定が全損し最初からやり直しになる。

### 原則 1: 1 Agent あたりの担当数

**Sonnet Agent (第 4 段階画像除外 / 5-1 構造化抽出 / 5-3 視覚属性抽出 / 6-2 同一商品判定)**:

- **1 Agent あたりの担当件数は工程ごとに異なる**。各工程の個別記述を参照
- **並列起動禁止** (使用量制限を一気に消費するため)

**Haiku Agent (5-2 正規化提案)**:

- **1 Agent = 1 chunk を標準**
- 実測 (2026-04-23): 1 chunk あたり約 16 秒、消費 71k token、200k context window に対して十分余裕
- 軽量だが、5-2 の出力は chunk ごとにファイルを分ける設計のため、1 Agent に複数 chunk を集約する実装コストは得られる時間短縮に見合わない
- 並列起動禁止 (Sonnet と同じ扱い)

### 原則 2: progress.json による中断再開

件数が多い Sonnet Agent 工程 (5-1 / 5-3 / 6-2) では、作業ディレクトリ直下に `progress.json` を作成・更新しながら進める。Haiku (5-2) は軽量なので省略可だが、全 chunk 完了の確認用に推奨。

共通フォーマット:

```json
{
  "stage": "5-1 | 5-2 | 5-3 | 6-2",
  "completed_units": [0, 1, 2],
  "total_units": 32,
  "started_at": "YYYY-MM-DDTHH:MM:SS+09:00",
  "last_updated_at": "YYYY-MM-DDTHH:MM:SS+09:00",
  "last_error": null
}
```

- **`completed_units` の単位は段階ごとに異なる** (5-1/5-2 は chunk 番号、5-3 はバッチ番号、6-2 は groupId)
- **各単位完了ごとに都度更新する** (Agent 完了 → 出力ファイル検証 → progress.json 更新 → 次 Agent 起動)
- **再開時**: `completed_units` に含まれない最小の単位から次 Agent を起動

制限ヒット時の `last_error` フォーマット:

```json
{
  "last_error": {
    "at": "YYYY-MM-DDTHH:MM:SS+09:00",
    "agent_label": "Agent 07 / group_42 等、人間が追える識別",
    "kind": "rate_limit | usage_limit_5h | usage_limit_daily | timeout | other",
    "detail": "エラーメッセージ抜粋"
  }
}
```

### 原則 3: バッチ逐次保存 (中断耐性の要)

Agent プロンプトには **「1 バッチ (例: 50 件) 完了ごとに即 Write、まとめて一括書き出しは禁止」** を必ず明記する。併せて **なぜ逐次保存が必要か (中断で判定がロストする、親は書き出されたファイルしか見ない)** を Agent 自身に理由として伝える。単に「Write せよ」だけだと、Agent が効率化の名目で「まとめて書く」判断をしかねない。

過去事例 (2026-04-20): Agent 03 / 17 が途中で transcript 切れを起こしたが、バッチ逐次保存ルールを守っていたため、復帰時に未完了バッチだけやり直せば既完了バッチの判定は失われなかった。

### 原則 4: Agent 完了報告を鵜呑みにしない (実ファイル検証必須)

Agent が「完了」と報告しても、親 Claude は必ず **実ファイルの存在と件数** を確認する。

確認項目:

1. 指定出力パスにファイルが存在するか (`ls <output-path>`)
2. JSON として Parse できるか
3. レコード件数が期待値 (50 件 / 150 件 / 仮クラスタのサイズ 等) と一致するか
4. 入力ファイルの mtime が Agent 起動前と同じか (出力ファイルの共通原則と整合)

過去事例 (2026-04-20): Agent 03 / 17 が「続きます」と書いて結果ファイルを生成せずに終了した。Agent の返答テキストでは判定せず、ファイル mtime と件数を直接見る。件数不整合または未完了時は、次の原則 5 で復帰させる。

### 原則 5: 停止 Agent の復帰は SendMessage (新規 Agent() は禁止)

Agent 起動時のレスポンスに含まれる **`agentId` を必ず控える**。途中停止したら:

```
SendMessage({
  to: "<agentId>",
  message: "<出力パス> がまだ書き出されていません。判定を継続し、全件保存してから『全 N 件保存完了』と報告してください。"
})
```

で **transcript (判定途中の文脈) を保持したまま復帰** する。新規 `Agent()` 呼び出しは別個体になり、判定途中の文脈を失うため **復帰目的では禁止** (未着手バッチの新規起動には当然使ってよい)。

### 原則 6: Agent 01 完了直後のスポットチェック (必須)

最初の Agent が完了したら、**出力から数件抜粋して判定を目視確認** する。判定品質に問題があれば Agent 02 以降を止めてプロンプトを修正する。

段階ごとの確認ポイント:

| 段階 | 確認対象 |
|---|---|
| 5-1 (構造化抽出) | category / subcategory / color / size / quantity の妥当性を 10 件程度 |
| 5-2 (正規化提案) | 承認された統合ペアが純粋な表記揺れか (粒度統合・意味統合が混入していないか) |
| 5-3 (視覚属性抽出) | 画像を数枚 Read し、pattern / material の実体一致 |
| 6-2 (同一商品判定) | subgroup 分けの妥当性を 1〜2 グループ目視 |

### 原則 7: 親セッションは軽作業に徹する

- **親 Claude は画像 Read をしない** (親+子のトークン累積で使用量制限が早く来る)
- 親の役割は Agent 起動 → 完了確認 (原則 4) → progress.json 更新 (原則 2) → 次 Agent 起動 に徹する
- スポットチェック時 (原則 6) のみ、少数件を親が Read してよい

### 原則 8: 使用制限 3 種への対処

| 制限種別 | リセットタイミング | 対処 |
|---|---|---|
| レート制限 (単体 Agent の短時間大量消費) | 数分〜15 分 | 15 分待って再試行 (1 回だけ) |
| 使用量制限 (5 時間窓) | 約 5 時間 | progress.json の `last_error` に記録、リセット時刻待ち |
| 日次使用量制限 | 翌日 JST 6 時頃 (Claude プランの窓に依存) | 同上、翌朝再開 |

いずれも `last_error` に原則 2 のフォーマットで記録し、リセット時刻以降に `completed_units` の続きから再開する。**「待たずに同じ Agent をすぐ再起動する」は禁止** (制限がさらに長引く)。

---

## 全体フロー

```
1. 収集 (collect_step)
     ↓ 生データ (約 8,000 items, JSON)
2. 販売実績の集約 (aggregate_step) (seller + title 単位、count で実績数を保持)
     ↓ 約 7,000 エントリ (TSV)
3. 暫定辞書の生成 (dictionary_expansion_step)
     ├─ 正規辞書のみで一次除外を走らせて unflagged を得る
     └─ Sonnet に unflagged を見せて新規キーワードを抽出 → keywords_pending.json
4. キーワード除外 (keyword_exclusion_step)
     ├─ 正規辞書 + 暫定辞書でキーワード判定
     │     ├─ flagged エントリ → 仕入れ候補から除外
     │     └─ unflagged エントリ → 画像除外へ
     └─ 画像除外 (image_exclusion_step) (Sonnet + 画像)
           unflagged 行を 1 件ずつ画像 + タイトルで判定し、辞書では拾えなかった除外対象 (新ブランド・新キャラ等) を救う
           verdict ∈ {keep, exclude, unclear}、unclear は keep 扱いで第 5 段階へ
5. 構造化抽出 (structured_extraction_step) (Sonnet)
     各エントリから以下を抽出し、category で大クラスタを作る:
     ├─ category (粗): パンツ / タオル / クリーム / ネックレス 等
     ├─ subcategory (細): ハーフパンツ / ビーチタオル / ハンドクリーム 等
     └─ 属性: color / size / quantity / pattern / material
6. 同一商品判定 (identity_resolution_step) (LLM + 画像)
     6 軸 (category/subcategory/color/size/quantity/pattern) で完全一致グループを作り、
     2 件以上の仮クラスタは LLM に画像 + タイトルを見せて subgroup に仕分け
     1 件のみの仮クラスタ (singleton) は LLM 判定を省略して単独クラスタとして確定
7. 仕入れ候補書き出し (purchase_candidate_export_step)
     is_purchase_candidate=true のクラスタ (count_total >= 3) のみを CSV に書き出す
     出力: reports/YYYY/MM/YYYY_MM_DD_NN_メルカリ売れ筋リサーチ_v2.csv
```

### 各段階で残る件数の実績 (2026-04-16 データ、実装済み範囲のみ)

| 段階 | 入力 | 出力 | 前段比 | 初期比 |
|---|---|---|---|---|
| 1. 収集 (14日 SOLD) | - | 8,059 件 | - | 100% |
| 2. 集約 (seller+title 重複除去) | 8,059 件 | 7,223 件 | -10% | 89.6% |
| 3. 暫定辞書の生成 (件数は減らない) | 7,223 件 | 7,223 件 | 0% | 89.6% |
| 4. キーワード除外 (flagged 除外、unflagged が残る) | 7,223 件 | 約 4,800 件 | -33% | 約 60% |
| 4. キーワード除外 (続) — 画像除外 (verdict=exclude を除外、keep + unclear が残る) | 約 4,800 件 | 要実測 | 要実測 | 要実測 |
| 5. 構造化抽出 (件数は減らない) | 第 4 段階通過後の行集合 | 同上 | 0% | 同上 |
| 6. 同一商品判定 (クラスタ単位でまとめる、件数は減らない) | 第 4 段階通過後の行集合 | 同上 | 0% | 同上 |
| 7. 仕入れ候補書き出し (`is_purchase_candidate=true` のクラスタのみ CSV 書き出し) | 全クラスタ | `count_total >= 3` のクラスタのみ | - | - |

第 4 段階 (キーワード除外) の unflagged 件数は辞書改善で変動する。画像除外 (image_exclusion_step) の通過件数は初回実測待ち。第 5・6 段階は件数自体は変わらず、**クラスタ数 (同一商品とみなせるまとまりの数)** が成果指標になる。第 6 段階のクラスタ数と第 7 段階の書き出し件数 (`is_purchase_candidate=true` のクラスタ数) は初回本番実行後に実測して追記する。現時点では想定値を書かない (書くと将来のセッションがそれを事実として扱い、精度改善の前提が歪むため)。

---

## 第 1 段階: 収集 (collect_step)

`research/collect.js` を Playwright MCP の `browser_evaluate` 経由で実行し、14 日以内に購入者が決まった商品データを収集する。

- **収集対象のステータス**: `STATUS_SOLD_OUT` (取引完了) と `STATUS_TRADING` (取引中、購入者決定済み) の両方。メルカリ UI で SOLD バッジが付く商品すべてに相当する。物販オーナーの「SOLD = 売れた」認識と揃える目的 (trading 分のキャンセルノイズは許容)
- 入口キーワード × 価格帯 5 区間を **1 キーワードずつ** 順次実行 (各キーワード内では 5 価格帯を並列)
- **⚠️ レート制限のため一括並列禁止** (2026-04-28 実測): 全キーワード × 5 価格帯を `Promise.all` で一括並列実行すると Mercari API の 4xx/5xx で `resp.ok=false` になり各検索が早期終了し、取得件数が大幅に減る (単独「インポート」9,824 件 → 全 11 キーワード一括では同キーワードで 1,039 件)。`browser_evaluate` 1 回につき 1 キーワード (5 価格帯並列) ずつ実行し、全キーワード分を順次呼び出して結果をマージする
- **ブラウザ準備は本手順書を実行する Claude Code 自身が行う**。`collect.js` を実行する前に Playwright MCP (`browser_navigate`) で `https://jp.mercari.com` を開き、DPoP 認証のためのセッションを確立する (未ログインで可)。**ユーザーに「ブラウザを開いてください」と依頼しない**
- 出力: `research/YYYY_MM_DD_HH_MM__mercari_14day_results.json` (生データ、約 8,000 items)

### itemBrand 付き商品の収集段階除外

検索 API に `withItemBrand: true` を指定し、`item.itemBrand` が非 null の商品は収集段階で除外する。これは出品者が Mercari のブランドマスタ ([`procedures/exclude_by_keywords/brand_master/brands.jsonl`](../procedures/exclude_by_keywords/brand_master/brands.jsonl)、52,579 件) から選択した正規ブランド品で、中国輸入物販の仕入れ候補の対象外のため。

設計判断の詳細は [`adr/adr_2026_04_21_itemBrandによるcollect段階除外とブランドマスタの辞書代替不採用.md`](../adr/adr_2026_04_21_itemBrandによるcollect段階除外とブランドマスタの辞書代替不採用.md) を参照。

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

- `research/runs/<ts>/aggregate/all_items_sorted_from_YYYYMMDD.tsv` (`<ts>` は生データファイル名から抽出した `YYYY_MM_DD_HH_MM`)
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
node research/aggregate.js research/<rawfile>.json research/runs/<ts>/aggregate/all_items_sorted_from_<date>.tsv
```

省略時は `research/runs/<ts>/aggregate/all_items_sorted_from_<生データ日付>.tsv` に自動配置される (`<ts>` は生データファイル名から抽出した `YYYY_MM_DD_HH_MM`、ファイル名の `<date>` は同 `<ts>` の日付部分)。

実行後、stdout に summary JSON が出る:

```json
{
  "input": "research/2026_04_16_06_46__mercari_14day_results.json",
  "output": "research/runs/2026_04_16_06_46/aggregate/all_items_sorted_from_20260416.tsv",
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

正規辞書は過去に確認済みのキーワードしかカバーできず、新しいブランド・商品名・カテゴリに追随できない。AI (Sonnet) の知識と当回の生タイトル群から「正規辞書に未登録で除外対象になり得るキーワード」を抽出し、その回のリサーチに即時反映する。正規辞書へ取り込むかどうかはリサーチ後に判断するため、ノイズ候補が正規辞書に混入するリスクは切り離される。

### 前提条件

- 第 2 段階 (集約) が完了し、生データ `research/<rawfile>.json` が存在する
- 実装スクリプト: `research/expand_dictionary.js` (本段階専用) と `research/_classifier.js` (共通ロジック)

### 入力

- 生データ: `research/<rawfile>.json`
- 参照される静的ファイル (スクリプトが Agent プロンプトに絶対パスを埋め込む):
  - 正規辞書: `procedures/exclude_by_keywords/keywords.json`
  - 設計メモ: `docs/research/mercari/keywords_design_notes.md`
  - 参考 PDF: `references/注意商品.pdf`
  - 参考 PDF: `references/new仕入れ禁止商品_アパレル.pdf`

### 出力

- `research/runs/<ts>/dict_expansion/unflagged_titles.json` (Node 側で生成)
- `research/runs/<ts>/dict_expansion/dict_expansion_prompt.md` (Node 側で生成、絶対パス置換済みのサブエージェント用プロンプト)
- `research/runs/<ts>/dict_expansion/keywords_pending.json` (Sonnet サブエージェントが書き出す、次段の `--pending` 入力)

フォーマットは正規辞書と同じ `priority` + `keywords`、加えて `_sources` で抽出根拠を併記。

---

### 手順 1: Node 側の事前処理

正規辞書で一次除外をかけ、unflagged タイトルの抽出と Agent 用プロンプト (絶対パス置換済み) の生成まで 1 コマンドで実施する:

```bash
node research/expand_dictionary.js research/<rawfile>.json
```

省略可能な第 2 引数で出力先を明示指定できる (デフォルトは `research/runs/<ts>/dict_expansion/`):

```bash
node research/expand_dictionary.js research/<rawfile>.json research/runs/<ts>/dict_expansion
```

stdout に生成ファイルのパスと `unflagged_count` が JSON で出る。

---

### 手順 2: Sonnet サブエージェントに抽出を依頼

Claude Code の Agent ツール (`subagent_type=general-purpose`, `model=sonnet`) を起動し、手順 1 で生成された `dict_expansion_prompt.md` の **内容をそのまま** `prompt` 引数に渡す。プロンプト内の入出力パスは全て絶対パスで埋め込み済みのため、追加の置換は不要。

Agent 完了後、指定した `keywords_pending.json` が書き出されている。

---

### 手順 3: 出力 JSON のバリデーション

正規辞書 `procedures/exclude_by_keywords/keywords.json` の `priority` 配列を正本としてカテゴリ集合を取得し、それと暫定辞書を突き合わせる:

```bash
node -e '
const fs = require("fs");
const base = JSON.parse(fs.readFileSync("procedures/exclude_by_keywords/keywords.json", "utf8"));
const p = JSON.parse(fs.readFileSync("research/runs/<ts>/dict_expansion/keywords_pending.json", "utf8"));
if (!Array.isArray(p.priority) || !p.keywords) throw new Error("Missing priority or keywords");
const validCats = new Set(base.priority);
let total = 0;
for (const cat of Object.keys(p.keywords)) {
  if (!validCats.has(cat)) throw new Error("Unknown category (not in normative dict): " + cat);
  total += p.keywords[cat].length;
}
console.log("OK. total new keywords:", total);
'
```

バリデーションエラー時は手順 2 (Sonnet Agent) を再実行する (下記の再試行ルール参照)。

---

### エラー時の再試行ルール

| エラー | 対処 |
|---|---|
| Agent 出力が JSON パースに失敗 | 「前回出力が JSON としてパースできませんでした。全量を JSON 形式で再生成してください」とフォローアップ |
| カテゴリ名が正規辞書外 | 「カテゴリ名は `procedures/exclude_by_keywords/keywords.json` の `priority` 配列に存在するものに限定してください」と伝えて該当箇所のみ修正させる |
| 既存辞書との重複が多い | 重複分をバリデーションで除外し、残りだけで続行 |
| 抽出数ゼロ | プロンプトの絶対パスが正しいか確認。それでもゼロなら本当に抽出すべきキーワードがない可能性もある |

---

## 第 4 段階: キーワード除外 (keyword_exclusion_step)

タイトルにあらかじめ用意した除外キーワードが含まれていたら「除外フラグ」を付ける機械処理。LLM は使わず Node.js の `String.prototype.includes()` による部分文字列マッチ。数秒で全 7,000 件を処理できる。

> **本段階の末尾に「### 画像除外 (image_exclusion_step)」が続く** (本セクション末尾参照)。前段までのキーワード判定で unflagged になった行を画像 + Sonnet で再判定し、辞書では拾えなかった除外対象 (新ブランド・新キャラ等) を救うステップ。第 5 段階 (構造化抽出) の入力 (`image_review/filtered_unflagged.json`) は本段階通過後 (画像除外も含む) の行集合。

### 目的

明らかに仕入れ候補外のもの (食品・ブランド模造・キャラ・ハンドメイド 等) を機械的に除外する。第 3 段階で生成した暫定辞書と正規辞書の両方を合わせて判定する。

### 全体の流れ

本段階は 2 つのパートで構成される: **(Part 1) キーワードマッチング** (`research/exclude_by_keywords.js` を実行) と **(Part 2) 画像除外** (`image_exclusion_step`)。Part 1 で flagged にならなかった unflagged 行を Part 2 が画像 + Sonnet で再判定する。

#### 出力ファイルの原則

冒頭「出力ファイルの共通原則」の原則 1〜3 を参照。本段階で不変となるファイルは `exclusion_final/` 配下すべて (`exclusion_output.json`、`exclusion_stats.md`) と `image_review/` 配下すべて。誤判定が見つかった場合は出力ファイルを直接書き換えず、辞書を修正するか本段階を再実行する。

#### 流れ図

```
第 1 段階出力 (<rawfile>.json、約 8,000 items)
正規辞書 (keywords.json) + 第 3 段階出力 (keywords_pending.json、暫定辞書)
  ↓
【Part 1: キーワードマッチング (exclude_by_keywords.js)】
  内部で seller+title 集約 → 辞書マージ →
  各 unique 行に対して includes 部分文字列マッチ (notWith / withAll 評価) →
  matches 配列格納 → priority 配列順で primary 決定
  ↓
exclusion_final/exclusion_output.json (全 unique 行 + 判定結果)
exclusion_final/exclusion_stats.md (カテゴリ別件数サマリー)
  ↓
  exclusion != null (flagged) → 仕入れ候補から除外
  exclusion == null (unflagged) のみ → Part 2 へ
  ↓
【Part 2: 画像除外 (image_exclusion_step)】
  unflagged 全件をバッチ分割 → 画像並列 DL →
  Sonnet Agent で verdict 判定 (keep / exclude / unclear) → 集計
  ↓
image_review/judgments.json (全 unflagged 行 + verdict + reason、不変)
image_review/filtered_unflagged.json (verdict ∈ {keep, unclear} のみ、第 5 段階の入力)
  ↓
  verdict = exclude → 仕入れ候補から除外
  verdict = keep または unclear → 第 5 段階 (構造化抽出) へ
```

#### 各処理の実行者・入出力

| Part | 処理 | 実行者 | 入力 | 出力 |
|---|---|---|---|---|
| 1 | キーワード除外判定 | スクリプト (`exclude_by_keywords.js`) | 生データ + 正規辞書 + 暫定辞書 | `exclusion_final/exclusion_output.json`、`exclusion_final/exclusion_stats.md` |
| 2 | 判定対象抽出 | スクリプト (`prepare_image_review.js`) | `exclusion_final/exclusion_output.json` | `image_review/all.json` |
| 2 | バッチ分割 | スクリプト (`split_image_review_batches.js`) | `image_review/all.json` | `image_review/batches/batch_NNN.json` |
| 2 | 画像並列 DL | スクリプト (`download_image_review_thumbnails.js`、内部で `_image_download.js`) | `image_review/all.json` の thumbnail URL | `image_review/images/{rowIndex}.webp` |
| 2 | progress.json 初期化 | bash | バッチ総数 | `image_review/progress.json` |
| 2 | 画像レビュー判定 | Sonnet Agent | バッチ JSON + 画像 + プロンプト (`research/image_exclusion_prompt.md`) | `image_review/results/batch_NNN_result.json` |
| 2 | 集計 + 第 5 段階入力生成 | スクリプト (`aggregate_image_review.js`) | `results/batch_*_result.json` | `image_review/judgments.json`、`image_review/filtered_unflagged.json` |

### キーワードマッチング (`exclude_by_keywords.js`)

1 スクリプトで集約・辞書マージ・マッチ・primary 判定・統計出力までを一括処理する (実行時間は数秒)。以下の各 #### は流れ図 Part 1 のステージ順で本処理の挙動を詳述する。

#### 入力 (3 系統)

| 系統 | パス | 性質 |
|---|---|---|
| 生データ | `research/<rawfile>.json` | 第 1 段階 `collect.js` の出力 (items 配列) |
| 正規辞書 | `procedures/exclude_by_keywords/keywords.json` | git 管理、定期更新対象。`priority` 配列とカテゴリ別キーワード集合を持つ |
| 暫定辞書 | `research/runs/<ts>/dict_expansion/keywords_pending.json` | 第 3 段階の Sonnet 出力 (当回のみ)、`--pending` オプションで指定 |

実装スクリプトは `research/exclude_by_keywords.js` (CLI) + `research/_classifier.js` (内部ヘルパー、第 3 段階と共用)。辞書 (JSON) とスクリプト (JS) を分離しているため、辞書だけの編集で再判定できる (コード変更なし)。

各キーワードの根拠は以下のいずれかに紐付く:

- `references/注意商品.pdf` (仕入れ禁止商品カテゴリ・法令リスク)
- `references/new仕入れ禁止商品_アパレル.pdf` (アパレル特化の禁止事例)

設計原則・パターン (notWith / withAll の使い分け、短語誤爆の対処) は `docs/research/mercari/keywords_design_notes.md` を参照。

#### seller+title 集約 (内部処理)

`_classifier.js` の `aggregateBySellerTitle(items)` で生 items を `sellerId + name` キーで束ね、entries 配列に変換する。第 2 段階 (`aggregate.js`) と同じ集約ロジックを内部関数として持つ (本段階では集約 TSV は書き出さない、entries はメモリ上で次段に渡す)。

各 entry は以下を保持する:

- `seller` / `name` (集約キー)
- `ids` 配列 (元の item id 群)
- `price_min` / `price_max` (価格レンジ)

タイトル順 (日本語 `localeCompare`) でソートしてから後段に渡す。

#### 辞書マージ (正規 + 暫定)

`_classifier.js` の `loadDictionary(pendingPath)` で正規辞書をベースに暫定辞書を以下のルールで concat する:

- カテゴリごとに `keywords[cat]` 配列を concat
- 重複キーワード (同じ文字列) は **正規辞書側を優先** し暫定辞書側を除外
- `notWith` / `withAll` 付きオブジェクトはそのまま保持
- `priority` 配列は **常に正規辞書側のもの** を採用 (暫定辞書は新カテゴリを追加しない前提)

`--pending` を渡さなかった場合は正規辞書のみで判定する。

#### キーワードマッチ (includes / notWith / withAll)

`_classifier.js` の `classify(name, keywords)` で、各 unique 行のタイトル (原文 + lowercase 両方) に対して各キーワードを評価する。3 種類の照合パターン:

- **`includes`**: 単純な部分文字列マッチ。タイトルにキーワード文字列が含まれればマッチ。最も基本のパターン
- **`withAll`**: 指定された語が **全てタイトルに含まれて初めてマッチ** とする組み合わせ判定 (例: `{ keyword: "様", withAll: ["専用"] }` は「様専用」「様 ご専用」のように「様」と「専用」が両方ある場合のみ取引専用ページとしてマッチさせる)
- **`notWith`**: 指定された語がタイトルにあれば **マッチを取り消す** 短語誤爆の防止 (例: `{ keyword: "ガム", notWith: ["ギンガム"] }` は「ガム」を食品マッチさせるが、「ギンガムチェック」のような語の中の偶然一致は除外する)

設計原則 (どの語に notWith / withAll を付けるか、短語誤爆の対処パターン、新キーワード追加時の判断基準) は `docs/research/mercari/keywords_design_notes.md` を参照。

#### primary 決定と分類カテゴリ

カテゴリ一覧と優先度順序の **正本は `procedures/exclude_by_keywords/keywords.json` の `priority` 配列**。本手順書では列挙しない (新しい禁止理由が出るたびに辞書だけ追記すれば本段階の処理に反映され、手順書の改訂は不要にするため)。

- カテゴリは禁止理由を表す英小文字 + アンダースコア命名 (例: 食品衛生法系・薬機法系・キャラクター版権系・ハンドメイド系・取引専用ページ系 など)
- `_classifier.js` の `decidePrimary(flags, priority)` が `priority` 配列の先頭から評価し、最初にマッチしたカテゴリを `primary` に採用する
- 全マッチは `matches` 配列に残るので、後段で primary 以外のカテゴリも参照できる

#### 出力フォーマット

出力先: `research/runs/<ts>/exclusion_final/` 配下

- `exclusion_output.json` (全 unique row + 判定結果、不変)
- `exclusion_stats.md` (カテゴリ別件数の統計サマリー、不変)

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

後段への振り分け:

- `exclusion: null` なら印なし → 画像除外 (image_exclusion_step) へ進む
- `exclusion != null` なら印あり → 仕入れ候補から除外

#### 実行

```bash
node research/exclude_by_keywords.js research/<rawfile>.json research/runs/<ts>/exclusion_final \
  --pending research/runs/<ts>/dict_expansion/keywords_pending.json
```

第 2 引数 (出力先ディレクトリ) を省略した場合は `research/runs/<ts>/exclusion_final/` に自動配置される (`<ts>` は生データファイル名から抽出)。`--pending` を省略した場合は正規辞書のみで判定する。

#### 参考値

カテゴリ別の件数・割合は辞書改訂のたびに変動するため本手順書には掲載しない。

### 画像除外 (image_exclusion_step)

前段までのキーワード判定で `exclusion === null` になった unflagged 行を 1 件ずつ画像 + タイトルで Sonnet に判定させ、辞書では拾えなかった除外対象を救うステップ。本ステップ通過後の行 (`image_review/filtered_unflagged.json`) が第 5 段階 (構造化抽出) の入力になる。スクリプト・Agent 構成と入出力ファイルは ### 全体の流れ の流れ図と「各処理の実行者・入出力」表を参照。

#### 判定軸 (verdict 3 値)

| verdict | 意味 | 後段への扱い |
|---|---|---|
| `keep` | 仕入れ候補としてよい | 第 5 段階へ |
| `exclude` | 辞書では拾えなかったが除外すべき | 仕入れ候補から除外 |
| `unclear` | 画像 + タイトルだけでは判別困難 | keep と同じ扱いで第 5 段階へ |

判定基準は `procedures/exclude_by_keywords/keywords.json` の `priority` 配列に並ぶカテゴリ群に準拠する。Agent プロンプトはカテゴリ集合を keywords.json から読む形にし、辞書追加で本ステップの判定軸も自動追従するように作る。

#### モデル

Sonnet 全件。**本工程は 1 Agent = 2 バッチ (100 件)** を担当する。並列禁止、バッチ逐次保存、SendMessage 復帰、progress.json による中断再開、Agent 01 直後のスポットチェックは冒頭「## Agent 運用の共通原則」を踏襲する。元ネタとなった過去検証の詳細は `procedures/exclude_by_keywords_precision_check/README.md` §7 を参照。

#### 実行

`<ts>` は生データファイル名から抽出されるタイムスタンプ。CLI は `<ts>` を引数の raw.json から自動導出するが、Agent 起動と progress.json 初期化の bash は `<ts>` を環境変数で握る前提。

##### ステップ 1〜3: スクリプト実行 (CLI)

```bash
# 1. unflagged 抽出 + image_review/all.json 生成
node research/prepare_image_review.js research/<rawfile>.json

# 2. 50 件 / バッチに分割 → image_review/batches/batch_NNN.json
node research/split_image_review_batches.js research/runs/<ts>/image_review

# 3. 画像並列 DL → image_review/images/{rowIndex}.webp (再実行時は既存 webp スキップ)
node research/download_image_review_thumbnails.js research/runs/<ts>/image_review
```

##### ステップ 4: progress.json 初期化

```bash
TS=<ts>
IRDIR=research/runs/$TS/image_review
TOTAL=$(ls $IRDIR/batches | wc -l | tr -d ' ')
NOW=$(TZ=Asia/Tokyo date '+%Y-%m-%dT%H:%M:%S+09:00')
cat > $IRDIR/progress.json <<EOF
{
  "stage": "image_exclusion",
  "completed_units": [],
  "total_units": $TOTAL,
  "started_at": "$NOW",
  "last_updated_at": "$NOW",
  "last_error": null
}
EOF
```

##### ステップ 5: Sonnet Agent を 1 体ずつ起動

担当割り当て: Agent N (N = 1, 2, ...) は `batch_{2*(N-1):03d}` 〜 `batch_{2*(N-1)+1:03d}` の 2 バッチ (= 100 件) を担当。総 Agent 数は `ceil(total_batches / 2)`、最後の Agent は 1 バッチでもよい。

Claude Code の Agent ツール呼び出し例:

```
Agent({
  description: "image_exclusion Agent NN",
  subagent_type: "general-purpose",
  model: "sonnet",
  prompt: <research/image_exclusion_prompt.md の「プロンプト本文」全文 +
           {BATCH_PATHS} を担当 2 バッチの絶対パス改行区切りで置換 +
           {RESULT_PATHS} を 2 結果ファイル (batch_NNN_result.json) の絶対パス改行区切りで置換>
})
```

各 Agent 完了後の検証 (出力ファイル件数の Read 確認、progress.json 更新)、停止 Agent の SendMessage 復帰、Agent 01 完了直後の 10 件スポットチェック、使用制限ヒット時の対処は冒頭「## Agent 運用の共通原則」の原則 4〜8 を踏襲する。元ネタとなった過去検証の詳細は `procedures/exclude_by_keywords_precision_check/README.md` §4.6 / §7 を参照。

##### ステップ 6: 集計 + 第 5 段階入力生成

```bash
node research/aggregate_image_review.js \
  research/runs/<ts>/image_review \
  research/runs/<ts>/exclusion_final/exclusion_output.json
```

出力:

- `research/runs/<ts>/image_review/judgments.json` (全 unflagged 行 + verdict + reason、不変、監査用)
- `research/runs/<ts>/image_review/filtered_unflagged.json` (verdict ∈ {keep, unclear} のみ、第 5 段階の入力)

stdout に verdict 分布と filtered 件数の summary が出る。

---

## 第 5 段階: 構造化抽出 (structured_extraction_step)

画像除外 (image_exclusion_step) を通過した行 (`image_review/filtered_unflagged.json`) を対象に、タイトルから **同一商品判定と後段クラスタリングに必要な構造化情報** を Sonnet で抽出する。抽出結果は表記揺れを含むため、chunk ごとに正規化して次 chunk に伝播しない形に整える。

### 目的

この段階の出力は 2 つの役割を持つ:

1. **category / subcategory で大クラスタを作る**: 第 6 段階で画像判定するときに「同じ商品ジャンル」ごとにまとめて処理する単位
2. **判定補助属性をタイトルから先取りする**: 色・サイズ・数量を第 6 段階の画像判定の前段材料として付ける

### 全体の流れ

#### 出力ファイルの原則

冒頭「出力ファイルの共通原則」の原則 1〜3 を参照。本段階で不変となるファイルは `chunks_output/`、`normalization/`、`chunks_normalized/`、`vocab/`、`prompts/` 配下すべて。誤った出力が見つかった場合は、入力側を修正して該当ファイル以降を再生成する (詳細は後述「正規化 > 監査とやり直し」)。

#### 流れ図

```
画像除外 (image_exclusion_step) 出力 (image_review/filtered_unflagged.json)
  ↓
  入力を 150 件ずつに分割
  ↓
chunks_input/chunk_NN.tsv (約 32 ファイル)
  ↓
【chunk 0 から NN まで直列実行、1 chunk あたり以下を順に処理】

  構造化抽出 (Sonnet)
    タイトルから category / subcategory / color / size / quantity を抽出
  ↓
  正規化提案 (Haiku)
    これまでの vocab を見て表記揺れペアを提案
  ↓
  正規化仕分け (Node)
    提案を機械的に承認/却下 (粒度統合は自動却下)
  ↓
  正規化適用 (Node)
    承認された変換を元データに適用 (新ファイルとして出力)
  ↓
  vocab 累積 (Node)
    正規化済みデータから累積 vocab を再生成 (次 chunk への前段語彙)

  ↓ 次 chunk へ
【全 chunk 完了後、chunks_normalized/ を結合】
  structured_full.json (構造化抽出 + 正規化後)
  ↓
  視覚属性抽出 (画像 + Sonnet、50 件/バッチ)
    各行の画像 + タイトル + 現在属性から
    category/subcategory/color/pattern/material を補正・補完
    (size/quantity は触らない)
    pattern / material は本 substep で新設される
  ↓
  バッチ結果を結合
  ↓
visual_extraction/visual_full.json (第 6 段階への入力)
```

#### 各処理の実行者・入出力

| 処理 | 実行者 | 入力 | 出力 |
|---|---|---|---|
| chunk 分割 | スクリプト (`split_chunks_for_extraction.js`) | `image_review/filtered_unflagged.json` | `chunks_input/chunk_NN.tsv` |
| chunk N 用プロンプト組立 (chunk 1 以降のみ) | スクリプト (`build_chunk_prompt.js`) | `structured_extraction_prompt.md` + `vocab/vocab_after_chunk_{N-1}.json` | `prompts/prompt_for_chunk_NN.md` |
| 構造化抽出 | Sonnet agent | chunk 0 は `structured_extraction_prompt.md`、chunk 1 以降は `prompts/prompt_for_chunk_NN.md` + `chunks_input/chunk_NN.tsv` | `chunks_output/structured_chunk_NN.json` |
| 正規化提案プロンプト生成 | スクリプト (`propose_normalize_map.js`) | 合算 vocab (chunks_normalized 0〜N-1 + chunks_output の NN) | `normalization/propose_prompt_NN.md` と `normalization/vocab_for_propose_NN.json` |
| 正規化提案 | Haiku agent | `propose_prompt_NN.md` | `normalization/proposed_normalize_map_NN.json` |
| 正規化仕分け | 規則ベース (`filter_normalize_map.js`) | `proposed_normalize_map_NN.json` | `normalization/filtered_normalize_map_NN.json` と `normalization/rejected_pairs_NN.json` |
| 正規化適用 | スクリプト (`apply_normalize_map.js`) | `structured_chunk_NN.json` + `filtered_normalize_map_NN.json` | `chunks_normalized/normalized_chunk_NN.json` |
| vocab 累積 | スクリプト (`extract_unique_vocab.js`) | `chunks_normalized/` | `vocab/vocab_after_chunk_NN.json` |
| 結合 | Node ワンライナー | `chunks_normalized/` | `structured_full.json` |
| 視覚属性抽出 画像 DL | スクリプト (`download_item_thumbnails.js`) | `structured_full.json` + 第 1 段階生データ | `image_review/images/{rowIndex}.webp` (既存なら skip、画像除外と共用) |
| 視覚属性抽出 バッチ分割 | スクリプト (`build_visual_extraction_batches.js`) | `structured_full.json` + 画像ディレクトリ | `visual_extraction/batches/batch_NNN.json` (50 件/バッチ) |
| 視覚属性抽出 プロンプト組立 | スクリプト (`build_visual_extraction_prompt.js`) | `visual_extraction_prompt.md` + バッチ JSON + 累積 vocab | `visual_extraction/prompts/prompt_batch_NNN.md` |
| 視覚属性抽出 | Sonnet agent (画像 + タイトル) | プロンプト + 画像 webp | `visual_extraction/results/visual_batch_NNN.json` |
| 視覚属性結合 | Node ワンライナー | `visual_extraction/results/` | `visual_extraction/visual_full.json` (第 6 段階への入力) |

### 直列実行と chunk 分割

- chunk サイズ: 150 行 (Sonnet 出力上限 64K tokens に収まるサイズ、安全マージン約 30%)
- 実行方式: 直列 (chunk N+1 の agent は chunk 0〜N の vocab を「前段までに使われた語彙」として参照する)
- chunk 数は `image_review/filtered_unflagged.json` の行数を 150 で割った数に依存 (画像除外の出力件数で変動)
- 入力フォーマット: 1 行目ヘッダー `rowIndex\tid\tname`、以降データ行
- 入力パス: `research/runs/<ts>/structured_extraction/chunks_input/chunk_NN.tsv`
- 実装スクリプト: `research/split_chunks_for_extraction.js`

### 構造化抽出 (Sonnet)

#### 抽出する 5 フィールド

| フィールド | 意味 | 例 |
|---|---|---|
| `category` | 粗いジャンル (判定不能は null) | パンツ / タオル / クリーム / ネックレス / シール / バッグ |
| `subcategory` | 用途・機能修飾を含む細かい名前 (category と同じなら null) | ハーフパンツ / ビーチタオル / ハンドクリーム / ショルダーバッグ |
| `color` | 色 (配列、無ければ null) | `["ブラック"]` / `["ベージュ", "ブラック"]` |
| `size` | サイズ (単位込み、無ければ null) | `"M"` / `"100cm"` / `"B4"` |
| `quantity` | 個数・セット枚数・容量 (単位込み、無ければ null) | `"4枚セット"` / `"500g"` / `"2連"` |

**pattern (柄) と material (素材) は本工程 (構造化抽出) では抽出しない**。画像が必要なため、本段階 (第 5 段階) の後半の視覚属性抽出で扱う。

#### クラスタ分割軸は category / subcategory のみ

color / size / quantity はクラスタ分割の軸にしない。第 6 段階の同一商品判定時の判定補助情報として参照する。null (タイトルに明記されていない) はワイルドカード扱い。

#### プロンプト

`research/structured_extraction_prompt.md` を使用する。chunk 0 はそのまま、chunk 1 以降は末尾に `【前段までに使われた語彙】` セクションを追記してから agent に渡す。

プロンプト内の主要ルール (抜粋):
1. `category` 統一リストは **持たない**。メタルール (カタカナ優先、長音符なし、複合名詞 1 語) で命名し、vocab と正規化で統一する
2. `color` / `size` / `quantity` の表記は **最小限の統一のみ** (黒→ブラック、Mサイズ→M 等)。辞書外はタイトル原文のままコピー
3. 推測禁止: タイトルに書かれていない属性は null
4. `rowIndex` と `id` と `name` はそのままコピー

#### 出力フォーマット

各 chunk: `research/runs/<ts>/structured_extraction/chunks_output/structured_chunk_NN.json`

```json
[
  {
    "rowIndex": 163,
    "id": "m99306383103",
    "name": "【4枚セット】女の子 ショーツ 女児 パンツ 下着 肌着 100cm",
    "category": "ショーツ",
    "subcategory": null,
    "color": null,
    "size": "100cm",
    "quantity": "4枚セット"
  }
]
```

#### 使用モデルとコスト目安

- モデル: Sonnet
- 1 chunk あたり: 約 3 分
- 全 32 chunk 直列: 約 130 分、$3〜8

### 正規化 (normalization_step)

chunk 間で発生する **純粋な表記揺れ** を統一して第 6 段階に渡す。

#### 用語定義 (本セクション内)

- **表記揺れ**: 同じ意味の語が異なる文字列で書かれている状態 (例: 「青」と「ブルー」)
- **意味統合**: 異なる意味の語を同じ語として扱うこと (例: 「カーキ」と「チャコールグレー」を統一) — **やってはいけない**
- **粒度統合**: 広い概念語と狭い概念語を統一すること (例: 「ケース」と「スマホケース」を統一) — **やってはいけない**
- **vocab 汚染**: chunk N の揺れ表記が vocab に載り、chunk N+1 以降がそれを踏襲することで下流 chunk に広がる現象

#### 統一する対象 / しない対象

**統一する対象 (表記レベルの揺れ、意味判定不要)**:

| 種類 | 例 |
|---|---|
| 同じ語の別表記 (漢字↔カタカナ↔英字) | 青 ↔ ブルー / Tシャツ ↔ ティーシャツ / 白 ↔ ホワイト |
| 接尾辞だけの違い | Mサイズ ↔ M / カーキ色 ↔ カーキ / 2枚入り ↔ 2枚 / 3枚組 ↔ 3枚セット |
| 大小文字・全角半角・空白の差 | 100CM ↔ 100cm / Ｍ ↔ M / 「4 枚セット」↔「4枚セット」 |

**統一しない対象 (意味判定が必要、第 6 段階で扱う)**:

| 種類 | 例 |
|---|---|
| 別の色 (色名が違う) | カーキ ↔ チャコールグレー / ダークグレー ↔ グレー |
| 粒度違い (広い概念語と狭い概念語) | シール ↔ 3Dシール / ケース ↔ スマホケース / ミラー ↔ バイクミラー |
| 派生違い (用途・機能が違う) | スマホケース ↔ コインケース / ハーフパンツ ↔ ロングパンツ |

#### 実行設定

- 実行タイミング: chunk ごと
- 使用モデル: Haiku
- 人の介入: なし (全自動)

#### 正規化提案

2 ステップで実行する。

**ステップ A: プロンプト生成 (`propose_normalize_map.js`)**

合算 vocab を構築し、Haiku Agent に渡すプロンプトファイルを生成する Node スクリプト。

- 入力:
  - `chunks_normalized/normalized_chunk_*.json` (chunk 0〜N-1)
  - `chunks_output/structured_chunk_NN.json`
  - chunk 0 の場合は chunks_normalized/ が空なので chunks_output のみを参照
- 出力:
  - `normalization/propose_prompt_NN.md` (Haiku Agent 用プロンプト、絶対出力パス埋め込み済み)
  - `normalization/vocab_for_propose_NN.json` (合算 vocab、デバッグ用)
- 実行: `node research/propose_normalize_map.js <chunk-num> <run-dir>`

**ステップ B: Haiku Agent 起動**

生成された `propose_prompt_NN.md` を Claude Code の Agent ツールに渡し、Haiku に表記揺れ提案を生成させる。

- Agent 起動パラメータ:
  - `subagent_type`: `general-purpose`
  - `model`: `haiku-4-5-20251001`
  - `prompt`: `propose_prompt_NN.md` の全文
- Agent はプロンプト内に埋め込まれた絶対パス (`normalization/proposed_normalize_map_NN.json`) に JSON を書き出す
- Agent への指示の骨子 (プロンプト内に記載済み):
  - vocab 内の表記揺れペアを見つける
  - 少数派 → 多数派への変換ペアを出す (count 比較)
  - 上記「統一する / しない対象」の表に従う
  - 確信できないものは出さない

出力フォーマット (`proposed_normalize_map_NN.json`):

```json
{
  "proposals": [
    {
      "field": "color",
      "from": "青",
      "from_count": 1,
      "to": "ブルー",
      "to_count": 7,
      "reason": "漢字とカタカナで同じ色を指す"
    }
  ]
}
```

#### 正規化仕分け (filter_normalize_map.js)

proposed を承認/却下に仕分ける全自動スクリプト。

- 入力: `normalization/proposed_normalize_map_NN.json`
- 出力:
  - `normalization/filtered_normalize_map_NN.json` (承認済みペアだけ、不変)
  - `normalization/rejected_pairs_NN.json` (却下履歴、監査用、不変)
- 実行: `node research/filter_normalize_map.js <chunk-num> <run-dir>`

判定順:

1. **case/whitespace 正規化の一致**: `from` と `to` を NFKC 正規化 + toLowerCase + 空白除去した結果が等しい → **承認**
2. **部分文字列関係**: (1) に該当せず、`from` が `to` を含む、または `to` が `from` を含む場合:
   - 除去される文字列が**接尾辞リスト** (下記) に含まれる → **承認**
   - 含まれない → **却下** (粒度統合の疑い)
3. **上記いずれにも該当しない (無関係な文字列ペア)**: **承認**

**接尾辞リスト (初期)**:

```
サイズ / 色 / 入り / 入 / 組 / 点 / セット / 枚セット
```

却下した項目は `rejected_pairs_NN.json` に理由と共に記録される。

#### 正規化適用 (apply_normalize_map.js)

承認済みペアを元 chunk JSON に適用して正規化済み chunk JSON を生成するスクリプト。

- 入力: `chunks_output/structured_chunk_NN.json` + `normalization/filtered_normalize_map_NN.json`
- 出力: `chunks_normalized/normalized_chunk_NN.json` (不変)
- 実行: `node research/apply_normalize_map.js <chunk-num> <run-dir>`

元ファイルは書き換えず、別ファイルとして出力する。filtered_normalize_map_NN.json が不在 / proposals 空の場合は元データをそのままコピーする。

#### 監査とやり直し

各ファイルが不変なので、ある商品の値がどう変換されたかを全工程で追跡できる。

ある商品で `color="青"` が `color="ブルー"` に変換された経緯を追う例:

1. `chunks_output/structured_chunk_NN.json` に元の `"青"` が記録されている
2. `normalization/proposed_normalize_map_NN.json` に Haiku が提案した `{"from": "青", "to": "ブルー", "reason": "..."}` が残る
3. `normalization/filtered_normalize_map_NN.json` に規則ベース検査を通過した承認版がある
4. `chunks_normalized/normalized_chunk_NN.json` に変換後の `"ブルー"` が入っている
5. `normalization/rejected_pairs_NN.json` には却下された他の提案 (例: 「Tシャツ→シャツ」など) が記録されている

誤った統一が後日発見されたら、該当 chunk の `filtered_normalize_map_NN.json` を修正 → `apply_normalize_map.js` を再実行 → `chunks_normalized/` 以降を再生成、という流れで直す。元の `chunks_output/structured_chunk_NN.json` は不変なのでやり直し可能。

### vocab 累積

正規化済みデータから category / subcategory / color の累積 vocab を生成し、次 chunk の agent に **前段までに使われた語彙** として渡す。

スクリプト `research/extract_unique_vocab.js`:

```bash
node research/extract_unique_vocab.js \
  research/runs/<ts>/structured_extraction/chunks_normalized/ \
  research/runs/<ts>/structured_extraction/vocab/vocab_after_chunk_NN.json
```

出力形式:

```json
{
  "category": [{"value": "Tシャツ", "count": 42}, {"value": "パンツ", "count": 38}],
  "subcategory": [{"value": "ハーフパンツ", "count": 15}],
  "color": [{"value": "ブラック", "count": 120}]
}
```

### chunk ごとの実行手順

本工程 (構造化抽出 5-1 + 正規化 5-2) は冒頭「## Agent 運用の共通原則」を必ず踏襲する。特に:

- **1 chunk = Sonnet Agent 1 回 + Haiku Agent 1 回** で 1 単位
- **1 Agent = 1 chunk = 150 件** を担当 (並列禁止)
- **chunk 単位で `progress.json` を更新** (Sonnet + Haiku 両方の書き出し成功で初めて completed)
- **chunk 並列禁止**: chunk N の vocab 累積 (`vocab_after_chunk_NN.json`) が chunk N+1 の前段入力になるため、機能面でも並列不可

#### progress.json の配置とスキーマ (5-1 / 5-2 共用)

- パス: `research/runs/<ts>/structured_extraction/progress.json`
- スキーマ:

```json
{
  "stage": "5-1 and 5-2",
  "completed_units": [0, 1, 2],
  "total_units": 32,
  "started_at": "2026-04-23T18:00:00+09:00",
  "last_updated_at": "2026-04-23T19:12:00+09:00",
  "last_error": null
}
```

- `completed_units` の要素 = **chunk 番号 (非負整数)**
- 更新タイミング: 各 chunk の全 6 ステップ完了後 (`vocab_after_chunk_NN.json` 生成まで確認できてから)
- 再開時: `completed_units` に含まれない最小 chunk 番号から次 chunk を開始
- 制限ヒット時は `last_error` を共通原則 2 のフォーマットで記録

#### Sonnet Agent (5-1 構造化抽出) の実ファイル検証項目

共通原則 4 (実ファイル検証) を以下の具体項目で実施:

1. `chunks_output/structured_chunk_NN.json` が存在し JSON として Parse 可能
2. 件数が `chunks_input/chunk_NN.tsv` のデータ行数 (ヘッダ除く) と一致
3. 各行に `rowIndex / id / name / category / subcategory / color / size / quantity` が揃う (pattern / material は本工程では null、5-3 視覚属性抽出で埋める)
4. `chunks_input/chunk_NN.tsv` の mtime が Agent 起動前と同じ

件数・構造不整合があれば SendMessage で復帰 (共通原則 5)。

#### Haiku Agent (5-2 正規化提案) の実ファイル検証項目

1. `normalization/proposed_normalize_map_NN.json` が存在し JSON として Parse 可能
2. ルート構造が `{"proposals": [...]}` である (空配列でも可)
3. 各 proposal に `field / from / from_count / to / to_count / reason` が揃う
4. `normalization/vocab_for_propose_NN.json` (Haiku に渡した vocab、`propose_normalize_map.js` が生成) の mtime が Agent 起動前と同じ

Haiku はエラー率が低いが、空出力や形式崩れは起きうる。SendMessage 復帰ルールは Sonnet と同じ。

---

以下は chunk 0 と chunk 1 以降の具体手順。

**chunk 0**:

```
1. 構造化抽出 (Sonnet):
     Agent 起動 (subagent_type=general-purpose, model=sonnet):
       prompt = structured_extraction_prompt.md の全文 (前段語彙セクションなし、初回なので)
       入力 TSV = chunks_input/chunk_00.tsv
       出力 JSON = chunks_output/structured_chunk_00.json

2. 正規化提案プロンプト生成 (Node):
     node research/propose_normalize_map.js 0 research/runs/<ts>

3. 正規化提案 (Haiku Agent):
     Agent 起動 (subagent_type=general-purpose, model=haiku-4-5-20251001):
       prompt = research/runs/<ts>/structured_extraction/normalization/propose_prompt_00.md の内容
       出力 = research/runs/<ts>/structured_extraction/normalization/proposed_normalize_map_00.json
              (絶対パスはプロンプト内に埋め込み済み)

4. 正規化仕分け:
     node research/filter_normalize_map.js 0 research/runs/<ts>

5. 正規化適用:
     node research/apply_normalize_map.js 0 research/runs/<ts>

6. vocab 累積:
     node research/extract_unique_vocab.js \
       research/runs/<ts>/structured_extraction/chunks_normalized/ \
       research/runs/<ts>/structured_extraction/vocab/vocab_after_chunk_00.json
```

**chunk 1 〜 chunk 31 (以降同じパターン)**:

```
0. 前段語彙整合プロンプト組立 (Node):
     node research/build_chunk_prompt.js NN research/runs/<ts>
     (NN は chunk 番号、整数 1 以上。chunk 0 は本ステップ不要)
     出力 = research/runs/<ts>/structured_extraction/prompts/prompt_for_chunk_NN.md

1. 構造化抽出 (Sonnet):
     Agent 起動 (subagent_type=general-purpose, model=sonnet):
       prompt = prompts/prompt_for_chunk_NN.md の内容
       入力 TSV = chunks_input/chunk_NN.tsv
       出力 JSON = chunks_output/structured_chunk_NN.json

2〜6: chunk 0 と同じ (ファイル名の NN 部分を置き換えて実行)
```

### 結合

正規化済みの `chunks_normalized/normalized_chunk_*.json` を 1 本の `structured_full.json` に結合する (`chunks_output/` ではなく `chunks_normalized/` を入力にする)。

```bash
node -e '
const fs = require("fs"); const path = require("path");
const dir = "research/runs/<ts>/structured_extraction/chunks_normalized/";
const all = fs.readdirSync(dir).filter(f => /^normalized_chunk_.+\.json$/.test(f)).sort()
  .flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
fs.writeFileSync("research/runs/<ts>/structured_extraction/structured_full.json", JSON.stringify(all, null, 2));
console.log("total rows:", all.length);
'
```

### 視覚属性抽出 (画像 + Sonnet)

タイトルだけでは取れない **画像由来の属性** を埋め、既存属性を画像と照らして補正する。本段階 (第 5 段階) の最終出力 `visual_extraction/visual_full.json` が第 6 段階の入力になる。

#### 目的

1. **color の補完**: タイトルに色が明記されていない行 (全体の約 60%) に画像から色を補う
2. **pattern (柄) の新設抽出**: 柄違い別商品を第 6 段階のクラスタリング軸で分離するため、画像から柄を抽出する
3. **material (素材) の新設抽出**: 判定困難なら null で構わない、6 軸には含めないが第 6 段階の判定補助として残す
4. **category / subcategory の補正**: タイトルで `null` だった行、または画像と明らかに矛盾する行を直す

`size` と `quantity` は画像では判別できない (M/L/XL、100 枚 等) ため **触らない** (タイトル由来をそのまま残す)。

#### 使用モデルとバッチ設計

- モデル: Sonnet (画像 + テキスト)
- 1 バッチ = 50 件 (過去実績 `procedures/exclude_by_keywords_precision_check/` の運用に準拠)
- 1 Agent = 1 バッチ = 50 件 (並列禁止、順次起動)
- 画像は 第 4 段階の画像除外 (image_exclusion_step) が DL 済みの `image_review/images/{rowIndex}.webp` を流用。不在なら `download_item_thumbnails.js` で自前 DL

#### 画像 DL (download_item_thumbnails.js)

`<structured-full>` の各 rowIndex に対応する thumbnail を第 1 段階生データから引いて並列 DL する。既存ファイルが size > 0 ならスキップ (第 4 段階の画像除外が先に DL 済みの場合は即完了)。

```bash
node research/download_item_thumbnails.js \
  research/runs/<ts>/structured_extraction/structured_full.json \
  research/<ts>__mercari_14day_results.json \
  research/runs/<ts>/image_review/images
```

#### バッチ分割 (build_visual_extraction_batches.js)

`structured_full.json` を 50 件ずつに分割し、各行に画像絶対パスと現在属性を埋めたバッチ JSON を生成する。

```bash
node research/build_visual_extraction_batches.js \
  research/runs/<ts>/structured_extraction/structured_full.json \
  research/runs/<ts>/image_review/images \
  research/runs/<ts>
```

出力: `research/runs/<ts>/visual_extraction/batches/batch_NNN.json`

#### プロンプト組立 (build_visual_extraction_prompt.js)

仕様プロンプト本体 (`research/visual_extraction_prompt.md`) に **前段の累積 vocab セクション**・**バッチファイルパス**・**結果の出力先パス** を追記して、1 バッチ = 1 本の Agent 用プロンプトを生成する。

##### 前段の累積 vocab の所在

「前段の累積 vocab」とは、5-1 (構造化抽出) + 5-2 (正規化) の処理を通じて蓄積された category / subcategory / color のユニーク値と出現回数をまとめた JSON を指す。このファイルは **5-2 の各 chunk 処理の最終ステップ「vocab 累積」** で `extract_unique_vocab.js` が走ることで、chunk ごとに新しいバージョンが出力される:

```
research/runs/<ts>/structured_extraction/vocab/
├── vocab_after_chunk_00.json   # chunk 0 処理後の累積 vocab
├── vocab_after_chunk_01.json   # chunk 0〜1 処理後
├── ...
└── vocab_after_chunk_31.json   # 全 chunk 処理後の最終版 (5-3 で使うのはこれ)
```

各ファイルは、その時点までの `chunks_normalized/normalized_chunk_*.json` 全部を入力に再生成されているため、**ファイル番号 NN が最大のものが全 chunk 分を含んだ最新版** になる。したがって 5-3 のプロンプト組立ステップの直前に追加で `extract_unique_vocab.js` を走らせる必要はない (5-2 の最終 chunk 処理でその回の vocab 累積が既に完了している前提)。

##### スクリプトの自動選択ロジック

`build_visual_extraction_prompt.js` は `<run-dir>/structured_extraction/vocab/` 配下の `vocab_after_chunk_NNN.json` を全て列挙し、**NNN が最大のものを 1 つ自動で読み込む** (内部関数 `pickLatestVocab`)。ディレクトリが存在しない、または対象ファイルが 1 つもない場合はエラーで停止する (前段の 5-2 が完了していない状態で 5-3 を走らせることを防ぐため)。

##### 実行コマンド

```bash
node research/build_visual_extraction_prompt.js <batch-num> research/runs/<ts>
```

- `<batch-num>`: 非負整数 (0, 1, 2, ...)。5-3 のバッチ分割 (`build_visual_extraction_batches.js`) で生成された `batch_NNN.json` の番号に対応
- 1 回の実行で 1 バッチ分のプロンプトを 1 本生成する。全バッチ処理するには `<batch-num>` を 0 から最終バッチ番号までループで回すこと

##### 入出力

- 入力:
  - `research/visual_extraction_prompt.md` (仕様プロンプト本体、固定パス、全バッチ共通)
  - `research/runs/<ts>/visual_extraction/batches/batch_NNN.json` (対象バッチ、50 件分の画像パスと現在属性を含む)
  - `research/runs/<ts>/structured_extraction/vocab/vocab_after_chunk_*.json` のうち NNN 最大のファイル
- 出力: `research/runs/<ts>/visual_extraction/prompts/prompt_batch_NNN.md` (Agent 用完成プロンプト)

##### 本ステップの前提条件 (これらが揃っていないとエラー停止)

- 5-2 の全 chunk 処理が最終 chunk まで完了し、`vocab_after_chunk_{最終}.json` が存在すること
- 5-3 の画像 DL (`download_item_thumbnails.js`) と バッチ分割 (`build_visual_extraction_batches.js`) が完了し、`visual_extraction/batches/batch_NNN.json` が存在すること

#### Agent 起動と運用

Agent (`subagent_type=general-purpose`, `model=sonnet`) に上記プロンプトを渡す。Agent は各行の画像を 1 件ずつ Read し、全 50 件分の属性判定結果を `visual_extraction/results/visual_batch_NNN.json` に書き出す。

**本工程は冒頭「## Agent 運用の共通原則」を必ず踏襲する**:

- **1 Agent = 1 バッチ (50 件)**、並列起動禁止 (共通原則 1)
- **バッチ書き出し**: 1 バッチ (50 件) 判定が完了したら即 `visual_batch_NNN.json` を Write (共通原則 3)
- `agentId` を必ず控え、停止時は SendMessage で復帰、新規 `Agent()` は禁止 (共通原則 5)

##### progress.json の配置とスキーマ (5-3 専用)

- パス: `research/runs/<ts>/visual_extraction/progress.json`
- スキーマ:

```json
{
  "stage": "5-3",
  "completed_units": [0, 1, 2],
  "total_units": 32,
  "started_at": "2026-04-23T18:00:00+09:00",
  "last_updated_at": "2026-04-23T19:30:00+09:00",
  "last_error": null
}
```

- `completed_units` の要素 = **バッチ番号 (NNN、非負整数)**、chunk 番号ではなく 5-3 のバッチ番号を入れる
- 更新タイミング: 各バッチの `visual_batch_NNN.json` 書き出しと件数検証 (50 件) が完了した直後

##### 実ファイル検証項目 (各バッチごと、共通原則 4)

1. `visual_extraction/results/visual_batch_NNN.json` が存在し JSON として Parse 可能 (top-level が配列)
2. 要素数が 50 (最終バッチのみ残件数) と一致
3. 各要素に `rowIndex / category / subcategory / color / pattern / material / size / quantity / notes` が揃う
4. `visual_extraction/batches/batch_NNN.json` および使用した画像 webp の mtime が Agent 起動前と同じ

##### スポットチェック (Agent 01 完了直後、必須)

共通原則 6 に従い、最初の Agent (バッチ 0 担当) 完了直後に目視確認:

- 画像を 5 枚ほど親 Claude で Read し、Agent が判定した pattern / material と実体が一致するか
- category / subcategory が前段 vocab と整合するか (新規追加は妥当か)
- 問題があれば Agent 02 以降を止め、`research/visual_extraction_prompt.md` を修正してからやり直す

判定ルール (プロンプトに記載):

- `category` / `subcategory`: vocab から選ぶ、新規追加可。`currentAttributes` が画像と矛盾しないならそのまま
- `color`: 画像から判定 (メタルール適用: 漢字→カタカナ等)
- `pattern`: 画像の柄を単語で (`無地` / `花柄` / `チェック` 等)。判定不能なら null
- `material`: 画像の質感から (`綿` / `本革` / `OPP` 等)。判定困難なら null 可
- `size` / `quantity`: **触らず currentAttributes をそのままコピー**

#### バッチ結果の結合

全バッチ完了後、`visual_extraction/results/visual_batch_*.json` を 1 本の `visual_extraction/visual_full.json` に結合する。

```bash
node -e '
const fs = require("fs"); const path = require("path");
const dir = "research/runs/<ts>/visual_extraction/results/";
const all = fs.readdirSync(dir).filter(f => /^visual_batch_.+\.json$/.test(f)).sort()
  .flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
fs.writeFileSync("research/runs/<ts>/visual_extraction/visual_full.json", JSON.stringify(all, null, 2));
console.log("total rows:", all.length);
'
```

結合後の `visual_full.json` が第 6 段階の入力になる。

---

## 第 6 段階: 同一商品判定 (identity_resolution_step)

第 5 段階の視覚属性抽出まで完了した `visual_extraction/visual_full.json` を入力に、**同じ商品を扱う出品を束ねる**。本段階は 3 工程で構成される。

### 背景: なぜこの段階が必要か

第 5 段階で category/subcategory/color/size/quantity/pattern/material まで揃うが、その状態でも **同一属性に別商品が混ざる** ケースが残る:

- `pattern=花柄` 同士でも **バラ / ひまわり / 桜** で別商品
- `subcategory` が粗いと **形状の微差** (同じトートバッグでも別デザイン) が残る
- `material=null` 同士で **本革 / 合皮** の別商品が混ざる
- `quantity=null` 同士で **1 枚単体 / 3 枚セット** の別商品が混ざる

判定ルール (`docs/research/mercari/judgment_examples/`) の一般則 (色・サイズ・個数・セット・素材・用途・柄) に沿って、画像 + タイトルを見て最終的に束ねる。

### 流れ図

```
visual_extraction/visual_full.json (属性付き、約 4,800 件)
  ↓
  6-1 Node 仮クラスタリング (build_identity_clusters.js)
    6 軸完全一致 (category + subcategory + color + size + quantity + pattern、null=null)
    material は軸外 (6-2 Agent の画像判定時の補助として渡す)
    サイズ 1 → 単独確定、サイズ 2+ → Sonnet 判定待ち
  ↓
identity_resolution/clusters.json (仮クラスタ一覧)
  ↓
  6-2 同一商品判定 (Sonnet + 画像、サイズ 2+ の各仮クラスタごと)
    仮クラスタ 1 つ = 1 Agent 呼出
    50 件超のみサブ分割 (50 件ずつ、境界またぎは明日以降回しで許容)
    Agent は画像 + タイトルから subgroup に仕分け
  ↓
identity_resolution/results/result_group_*.json
  ↓
  6-3 最終 cluster_id 採番 (assign_final_cluster_ids.js)
    singleton + Agent 判定結果を集約
    cluster_id = {category}_{subcategory}_{連番3桁}
    各クラスタに count_total (= ids 合計 = 14 日 SOLD 件数) を付与
    count_total >= 3 のクラスタに is_purchase_candidate=true
  ↓
identity_resolution/final_clusters.json (仕入れ候補付き最終成果)
```

### 各処理の実行者・入出力

| 処理 | 実行者 | 入力 | 出力 |
|---|---|---|---|
| 6-1 仮クラスタリング | スクリプト (`build_identity_clusters.js`) | `visual_extraction/visual_full.json` | `identity_resolution/clusters.json` |
| 6-2 プロンプト組立 | スクリプト (`build_identity_resolution_prompt.js`) | `identity_resolution_prompt.md` + `clusters.json` | `identity_resolution/prompts/prompt_group_<groupId>.md` |
| 6-2 同一商品判定 | Sonnet agent (画像 + タイトル) | プロンプト + 画像 webp | `identity_resolution/results/result_group_<groupId>.json` |
| 6-3 最終 cluster_id 採番 | スクリプト (`assign_final_cluster_ids.js`) | `clusters.json` + `results/*.json` + `image_review/filtered_unflagged.json` | `identity_resolution/final_clusters.json` |

### 6-1 Node 仮クラスタリング (build_identity_clusters.js)

入力の各行を 6 軸で完全一致グループに分ける。

- 軸: `category + subcategory + color + size + quantity + pattern`
- null は文字列 `"null"` 扱い (null=null の完全一致)
- color は配列、ソートして join
- material は軸外 (判定困難で揺れやすいため、6-2 Agent の補助情報として渡す)
- 各グループにサイズを記録し、サイズ 1 は `singleton_confirmed` (Agent 判定不要)、サイズ 2+ は `pending` (Agent 判定対象)

```bash
node research/build_identity_clusters.js \
  research/runs/<ts>/visual_extraction/visual_full.json \
  research/runs/<ts>
```

出力 `identity_resolution/clusters.json` の構造:

```json
{
  "summary": { "totalRows": 4733, "groupCount": 1234, "singletonGroups": 567, "multiItemGroups": 667 },
  "groups": [
    {
      "groupId": 0,
      "groupKey": "category=ショーツ|subcategory=キッズショーツ|color=[ブラック]|size=100cm|quantity=4枚|pattern=無地",
      "size": 3,
      "status": "pending",
      "items": [
        {
          "rowIndex": 163,
          "id": "m99306383103",
          "name": "【4枚セット】女の子 ショーツ 女児 パンツ 下着 肌着 100cm",
          "attributes": {
            "category": "ショーツ",
            "subcategory": "キッズショーツ",
            "color": ["ブラック"],
            "size": "100cm",
            "quantity": "4枚",
            "pattern": "無地",
            "material": "綿"
          }
        }
      ]
    }
  ]
}
```

**items の attributes には 6 軸に加えて `material` も保持する**。6 軸はグループ分け (groupKey 生成) にのみ使い、`material` は groupKey に含めないが、**6-2 Agent の画像判定時の補助情報として後段に引き継ぐ必要がある**ため、`build_identity_clusters.js` は `r.attributes` を丸ごと items に残す (スクリプト L75-80 で `attributes: r.attributes` として 5-3 の視覚属性抽出出力をそのまま転載)。

### 6-2 同一商品判定 (Sonnet + 画像)

仮クラスタ内の 2+ 件の商品が画像とタイトルを見て本当に同じ商品かを Sonnet に判定させる。

#### プロンプト組立

```bash
node research/build_identity_resolution_prompt.js <groupId> research/runs/<ts>
```

50 件以下の仮クラスタは 1 プロンプト、50 件超はサブ分割して複数プロンプト (`prompt_group_<gid>_sub_NN.md`) を出力する。サブ分割間の境界またぎは本手順書 v2 の現行バージョンでは許容 (取りこぼし、サブバッチ間で同一商品が別クラスタ扱いになる可能性あり)。将来サブ分割が頻発するほど大きい仮クラスタが本番で多発した場合、2 周目判定の仕組みを別途設計する。

#### プロンプトに埋め込まれる情報と material の引き渡し方

スクリプトは仕様プロンプト本体 (`research/identity_resolution_prompt.md`) の末尾に `## 仮クラスタ` セクションを追記し、対象 groupId の各 item を以下のフォーマットで **1 行ずつ** 埋め込む (`build_identity_resolution_prompt.js` L72-87 の `buildItemsSection`):

```
- rowIndex=163, id=m99306383103
  name: 【4枚セット】女の子 ショーツ 女児 パンツ 下着 肌着 100cm
  imagePath: `/absolute/path/to/runs/<ts>/images/163.webp`
  attributes: `{"category":"ショーツ","subcategory":"キッズショーツ","color":["ブラック"],"size":"100cm","quantity":"4枚","pattern":"無地","material":"綿"}`
```

**material の引き渡し方**: 6-1 の `clusters.json` に保持された各 item の `attributes` オブジェクトをそのまま `JSON.stringify` し、上記 `attributes:` フィールドに埋め込む。これにより 6 軸外の `material` も含む **全 7 属性が 1 件 1 行の JSON 文字列として** Agent に渡る (material だけの専用セクションは作らない)。

仕様プロンプト本体 (`research/identity_resolution_prompt.md`) 側では以下で受け取り側を明示している:

- 入力フォーマットの説明 (L49-51): `attributes: category/subcategory/color/size/quantity/pattern/material (material は 6 軸に含まれていないので値が異なる場合あり)`
- 作業手順 (L57): `タイトル + 画像 + attributes (特に material) を見て、どれとどれが同じ商品かを判定`
- 判定一般則 (L40-41): 実体属性一覧 (色・サイズ・個数・セット・**素材**・用途・柄) の「素材」軸として使う

つまり material は「6-1 の出力 `items.attributes.material` → 6-2 プロンプトの `attributes:` JSON 文字列に同居 → 仕様プロンプト本体の指示で注視対象化」という経路で Agent に届く。手順書・スクリプト・仕様プロンプトの 3 箇所で同じ経路を明記している。

#### Agent 起動と運用

Agent (`subagent_type=general-purpose`, `model=sonnet`) に上記プロンプトを渡す。Agent は各行の画像を Read し、仮クラスタ内を subgroup に仕分けて出力パスに JSON を書き出す。

**本工程は冒頭「## Agent 運用の共通原則」を必ず踏襲する**:

- **1 Agent = 1 グループ (pending、size 2〜50) を標準**、並列起動禁止 (共通原則 1)
  - size 50 超のグループのみサブ分割し、サブバッチ 1 個 = 1 Agent 呼出 (50 件)
  - 出力ファイルは `result_group_<gid>.json` として groupId 別に分ける設計のため、1 Agent に複数グループを詰め込まない
- `agentId` を必ず控え、停止時は SendMessage で復帰 (共通原則 5)
- 親 Claude は画像 Read しない (共通原則 7、スポットチェック時のみ例外)

##### progress.json の配置とスキーマ (6-2 専用)

- パス: `research/runs/<ts>/identity_resolution/progress.json`
- スキーマ:

```json
{
  "stage": "6-2",
  "completed_units": [2, 18, 19, 35, 44],
  "total_units": 5,
  "started_at": "2026-04-23T18:00:00+09:00",
  "last_updated_at": "2026-04-23T19:45:00+09:00",
  "last_error": null
}
```

- `completed_units` の要素 = **groupId** (`clusters.json` の pending グループ ID、非負整数)
- `total_units` = pending グループ数 (= `clusters.json` の `summary.multiItemGroups`)
- サブ分割されたグループは、**全サブバッチの出力が揃ってから** groupId を `completed_units` に追加する
- 更新タイミング: `result_group_<gid>.json` (または `result_group_<gid>_sub_NN.json` 全件) の書き出しと検証が完了した直後

##### 実ファイル検証項目 (各グループごと、共通原則 4)

1. `identity_resolution/results/result_group_<gid>.json` (サブ分割なしの場合) または `result_group_<gid>_sub_NN.json` (サブ分割の場合) がすべて存在し JSON として Parse 可能
2. ルート構造が `{groupId, groupKey, subgroups: [...]}` である
3. `subgroups[].rowIndexes` の和集合が仮クラスタの items 全 rowIndex と一致 (過不足なし、重複なし)
4. `identity_resolution/clusters.json` と使用した画像 webp の mtime が Agent 起動前と同じ

##### スポットチェック (Agent 01 完了直後、必須)

共通原則 6 に従い、最初のグループ判定完了直後に目視確認:

- subgroup 分けの妥当性を 1〜2 グループ分、親 Claude で画像 Read して確認
- 明らかに同一商品なのに別 subgroup になっている、または明らかに別商品なのに同じ subgroup にまとまっているケースがないか
- 問題があれば以降のグループ判定を止め、`research/identity_resolution_prompt.md` を修正してからやり直す

判定基準 (プロンプトに記載):

- 判定軸 = `judgment_examples/README.md` の「前提知識」セクションに示された実体属性一覧 (色・サイズ・個数・セット・素材・用途・柄)
- タイトルの揺れは同一判定の根拠にならない (中国輸入慣習)
- 画像の実体が同じなら同一、実体が違えば別
- 迷ったら分ける (偽陽性回避)

出力 (`result_group_<gid>.json`):

```json
{
  "groupId": 3,
  "groupKey": "...",
  "subgroups": [
    { "subgroupId": 1, "rowIndexes": [163, 822], "reason": "両方無地で画像が酷似" },
    { "subgroupId": 2, "rowIndexes": [491], "reason": "ワンポイント刺繍あり別商品" }
  ]
}
```

### 6-3 最終 cluster_id 採番 (assign_final_cluster_ids.js)

6-1 の singleton と 6-2 の Agent 結果を集約して、各行に最終 cluster_id を付与する。

```bash
node research/assign_final_cluster_ids.js research/runs/<ts>
```

処理内容:

- singleton グループは 1 クラスタとして確定
- pending グループは `result_group_*.json` を読み、subgroup ごとに 1 クラスタを作る
- サブ分割されたグループは `result_group_<gid>_sub_NN.json` を全部読んで結合 (サブ分割境界またぎは現状 2 周目判定をしないので、別 subgroup として扱う)
- cluster_id = `{category}_{subcategory}_{連番3桁}` (連番は prefix ごと、例: `ショーツ_キッズショーツ_001`)
- 各クラスタに `count_total` を付与する。`count_total` = クラスタ内全 row の `ids` 配列要素数の合計 (= 14 日内に売れた件数)。`image_review/filtered_unflagged.json` を読み `rowIndex → ids 数` の Map を作って合計する
- `count_total >= 3` のクラスタに `is_purchase_candidate=true` を立てる。Why: 1 seller が同一商品を 3 件以上売った場合も仕入れ候補として拾うため。row 数 (`size`) で判定すると単独 seller の連続出品が漏れる

### 出力

- `research/runs/<ts>/identity_resolution/final_clusters.json`
- `is_purchase_candidate=true` のクラスタが仕入れ候補 (`count_total` = 14 日 SOLD 件数の合計が 3 件以上で売れ筋と判断)

第 6 段階完了時点で仕入れ候補クラスタの特定が終わる。次の第 7 段階 (`purchase_candidate_export_step`) で `is_purchase_candidate=true` のクラスタのみを CSV に書き出して物販オーナーに渡す。

---

## 作業ディレクトリ構成 (中間ファイル)

```
research/runs/YYYY_MM_DD_HH_MM/                   # 1 回のリサーチ run の成果物一式 (<ts> で束ねる)
├── aggregate/                                    # 第 2 段階 集約出力
│   └── all_items_sorted_from_YYYYMMDD.tsv
├── dict_expansion/                               # 第 3 段階 暫定辞書生成
│   ├── unflagged_titles.json                     #   正規辞書のみで仕分けた候補タイトル
│   ├── dict_expansion_prompt.md                  #   Sonnet サブエージェント用プロンプト
│   └── keywords_pending.json                     #   Sonnet が書き出す暫定辞書
├── exclusion_final/                              # 第 4 段階 最終除外出力
│   ├── exclusion_output.json                     #   正規辞書 + 暫定辞書で最終判定
│   └── exclusion_stats.md
├── image_review/                                 # 第 4 段階画像除外の出力先 (images/ サブディレクトリは第 5 段階の視覚属性抽出と共用)
│   ├── all.json                                  #   [第 4 段階] unflagged 全件 (rowIndex / title / thumbnail_url / image_path)
│   ├── batches/                                  #   [第 4 段階] 50 件 / バッチ
│   │   └── batch_NNN.json
│   ├── images/                                   #   [第 4 段階で DL、第 5 段階の視覚属性抽出も同ディレクトリを参照]
│   │   └── {rowIndex}.webp                       #     thumbnail を webp で保存、両段階で共用 (再 DL を避けるため)
│   ├── results/                                  #   [第 4 段階] Sonnet Agent 生出力 (不変、1 バッチ単位で逐次保存)
│   │   └── batch_NNN_result.json
│   ├── progress.json                             #   [第 4 段階] 中断再開管理 (共通原則 2 のスキーマ: stage / completed_units / total_units / last_error)
│   ├── judgments.json                            #   [第 4 段階] 全件統合 + verdict + reason (不変、監査用)
│   └── filtered_unflagged.json                   #   [第 4 段階] verdict ∈ {keep, unclear} のみ (第 5 段階の入力)
├── structured_extraction/                        # 第 5 段階 構造化抽出 + 正規化
│   ├── progress.json                             #   [5-1 / 5-2 共用] 中断再開管理 (共通原則 2 のスキーマ: stage / completed_units / total_units / last_error、completed_units は chunk 番号)
│   ├── chunks_input/
│   │   └── chunk_NN.tsv                          #   150 件ずつ分割した入力 TSV (ファイル数は filtered_unflagged.json の行数に依存)
│   ├── chunks_output/                            #   agent 生出力 (不変、LLM が書いたまま)
│   │   └── structured_chunk_NN.json
│   ├── normalization/                            #   chunk ごとの正規化中間成果物 (全て不変)
│   │   ├── propose_prompt_NN.md                  #     Haiku Agent に渡すプロンプト (Node 生成)
│   │   ├── vocab_for_propose_NN.json             #     プロンプト生成時の合算 vocab (デバッグ用)
│   │   ├── proposed_normalize_map_NN.json        #     Haiku Agent が書いた提案
│   │   ├── filtered_normalize_map_NN.json        #     規則ベース検査で承認されたペアのみ
│   │   └── rejected_pairs_NN.json                #     却下されたペア (監査用)
│   ├── chunks_normalized/                        #   正規化適用後 (不変、視覚属性抽出への入力)
│   │   └── normalized_chunk_NN.json
│   ├── vocab/                                    #   chunks_normalized/ から生成した累積 vocab
│   │   └── vocab_after_chunk_NN.json             #     次 chunk の agent に渡す前段語彙
│   ├── prompts/                                  #   各 chunk 用の結合済みプロンプト
│   │   └── prompt_for_chunk_NN.md                #     構造化抽出プロンプト本体 + 前段語彙セクション
│   └── structured_full.json                      #   全 chunks_normalized/ を結合した中間成果物
├── visual_extraction/                            # 第 5 段階 視覚属性抽出 (画像 + Sonnet)
│   ├── progress.json                             #   [5-3] 中断再開管理 (共通原則 2 のスキーマ、completed_units はバッチ番号)
│   ├── batches/                                  #   50 件 / バッチ
│   │   └── batch_NNN.json                        #     画像絶対パスと現在属性を埋めたバッチ入力
│   ├── prompts/                                  #   各バッチ用の結合済みプロンプト
│   │   └── prompt_batch_NNN.md                   #     visual_extraction_prompt.md 本体 + vocab + バッチパス
│   ├── results/                                  #   Sonnet agent 生出力 (不変)
│   │   └── visual_batch_NNN.json
│   └── visual_full.json                          #   全 results/ を結合した最終成果物 (第 6 段階への入力)
└── identity_resolution/                          # 第 6 段階 同一商品判定
    ├── progress.json                             #   [6-2] 中断再開管理 (共通原則 2 のスキーマ、completed_units は groupId)
    ├── clusters.json                             #   6-1 Node 仮クラスタリング出力 (groups 配列、singleton / pending)
    ├── prompts/                                  #   6-2 各グループ用プロンプト
    │   └── prompt_group_<groupId>.md             #     identity_resolution_prompt.md 本体 + 仮クラスタ情報
    ├── results/                                  #   6-2 Sonnet agent 生出力 (不変)
    │   └── result_group_<groupId>.json
    └── final_clusters.json                       #   6-3 最終 cluster_id 付与済 + 仕入れ候補フラグ
```

### 第 7 段階の出力先 (作業ディレクトリの外)

第 7 段階 (`purchase_candidate_export_step`) の出力 CSV は `research/runs/<ts>/` の外、リポジトリルートの `reports/YYYY/MM/` に配置する (最終成果物として長期保存、git 管理対象)。

```
reports/YYYY/MM/
└── YYYY_MM_DD_NN_メルカリ売れ筋リサーチ_v2.csv    # 第 7 段階の出力 (UTF-8 BOM 無し、15 列、ヘッダ行あり)
```

永続ファイル (git 管理):

```
procedures/exclude_by_keywords/keywords.json                   # 正規辞書 (定期更新)
research/aggregate.js                                          # 第 2 段階の実装スクリプト
research/expand_dictionary.js                                  # 第 3 段階の実装スクリプト
research/exclude_by_keywords.js                                # 第 4 段階の実装スクリプト
research/prepare_image_review.js                               # 第 4 段階の画像除外 unflagged 抽出スクリプト
research/split_image_review_batches.js                         # 第 4 段階の画像除外 バッチ分割スクリプト
research/_image_download.js                                    # 第 4 段階の画像除外 画像 DL 共通モジュール (CLI ではない)
research/download_image_review_thumbnails.js                   # 第 4 段階の画像除外 画像 DL CLI (_image_download.js の薄いラッパー)
research/image_exclusion_prompt.md                             # 第 4 段階の画像除外 Sonnet Agent に渡すプロンプト
research/aggregate_image_review.js                             # 第 4 段階の画像除外 集計 + filtered_unflagged.json 生成
research/structured_extraction_prompt.md                       # 第 5 段階 構造化抽出 (5-1) agent に渡すプロンプト
research/split_chunks_for_extraction.js                        # 第 5 段階 入力 TSV 分割スクリプト
research/build_chunk_prompt.js                                 # 第 5 段階 chunk N (N >= 1) 用プロンプト組立 (前段語彙整合セクション追加)
research/extract_unique_vocab.js                               # 第 5 段階 語彙累積生成スクリプト
research/propose_normalize_map.js                              # 第 5 段階 normalization 提案 (Haiku Agent 用プロンプト生成)
research/filter_normalize_map.js                               # 第 5 段階 normalization 規則ベース仕分け
research/apply_normalize_map.js                                # 第 5 段階 normalization 適用
research/download_item_thumbnails.js                           # 第 5 段階 視覚属性抽出の前準備: サムネイル一括 DL (image_review と共用ディレクトリ)
research/build_visual_extraction_batches.js                    # 第 5 段階 視覚属性抽出 バッチ分割 (50 件/バッチ)
research/visual_extraction_prompt.md                           # 第 5 段階 視覚属性抽出 agent に渡すプロンプト本体
research/build_visual_extraction_prompt.js                     # 第 5 段階 視覚属性抽出 バッチごとのプロンプト組立 (vocab 埋め込み)
research/build_identity_clusters.js                            # 第 6 段階 工程 6-1 Node 仮クラスタリング
research/identity_resolution_prompt.md                         # 第 6 段階 工程 6-2 agent に渡すプロンプト本体
research/build_identity_resolution_prompt.js                   # 第 6 段階 工程 6-2 グループごとのプロンプト組立
research/assign_final_cluster_ids.js                           # 第 6 段階 工程 6-3 最終 cluster_id 採番 + 仕入れ候補フラグ
research/build_final_report.js                                 # 第 7 段階 is_purchase_candidate=true のクラスタを CSV に書き出し
research/_classifier.js                                        # 第 3・4 段階の共通ロジック (内部ヘルパー)
research/_run_paths.js                                         # 第 2〜4 段階の <ts> 抽出・出力ディレクトリ導出 (内部ヘルパー)
research/runs/.gitkeep                                         # 第 2 段階以降の出力先 (配下は gitignore)
```

---

## 第 7 段階: 仕入れ候補書き出し (purchase_candidate_export_step)

第 6 段階までで揃った `identity_resolution/final_clusters.json` から、`is_purchase_candidate=true` のクラスタのみを CSV ファイルに書き出して物販オーナーに渡す。本段階が本手順書のゴール。

### 目的

本手順書冒頭「## やりたいこと」の 2 条件 (ブランド模造・除外条件に合致しない + 14 日間に 3 個以上の販売実績) を両方満たしたクラスタを、物販オーナーが Google Sheets などで扱える形 (CSV) で書き出す。

### 入出力

- **入力**:
  - `research/runs/<ts>/identity_resolution/final_clusters.json` (第 6 段階 6-3 の出力)
  - `research/<ts>__mercari_14day_results.json` (第 1 段階の生データ、価格と URL を引くため)
- **出力**:
  - `reports/YYYY/MM/YYYY_MM_DD_NN_メルカリ売れ筋リサーチ_v2.csv`
    - `YYYY/MM/DD` は実行日 (JST)
    - `NN` は同日内の連番 (01 から 2 桁ゼロ埋め)

### 書き出し対象

`final_clusters.json` の `clusters` 配列のうち、**`is_purchase_candidate=true` のクラスタのみ** を書き出す (= `count_total >= 3` のクラスタ)。`count_total < 3` のクラスタは書き出さない。なお、`size` (= row 数) ではなく `count_total` (= ids 合計 = 14 日 SOLD 件数) で判定するため、size=1 (単独 seller の連続出品) のクラスタでも同一商品を 3 件以上売っていれば候補に含まれる。件数を確認したい場合は `final_clusters.json` の `summary.purchaseCandidates` を参照する。

`is_purchase_candidate=true` のクラスタは全件書き出す (`slice` や「上位のみ」等で間引かない)。

### CSV フォーマット

- **文字コード**: UTF-8 (BOM 無し)
- **区切り文字**: カンマ (`,`)
- **改行**: LF (`\n`)
- **ヘッダ行**: あり
- **null 値**: 空セル (文字列 `null` は書かない)
- **クォート**: カンマ / 改行 / ダブルクォート を含む値のみダブルクォートで囲み、値中のダブルクォートは `""` にエスケープする (RFC 4180 準拠)

### カラム構成 (15 列)

| # | カラム名 | 型 | 内容 | 取得元 |
|---|---|---|---|---|
| 1 | `cluster_id` | 文字列 | 6-3 採番の cluster_id | `cluster.cluster_id` |
| 2 | `count` | 整数 | クラスタ内 14 日 SOLD 件数 (= `ids` 合計) | `cluster.count_total` (無ければ `cluster.size` にフォールバック) |
| 3 | `representative_title` | 文字列 | 代表タイトル (items 先頭の name) | `cluster.items[0].name` |
| 4 | `price_min` | 整数 | クラスタ内最小価格 | 第 1 段階生データから `items[*].rowIndex` で引いた `price` の min |
| 5 | `price_max` | 整数 | クラスタ内最大価格 | 同上、max |
| 6 | `category` | 文字列 | | `cluster.representative_attributes.category` |
| 7 | `subcategory` | 文字列 | | 同上 |
| 8 | `color` | 文字列 | 配列を **スペース区切り** で 1 セルに (例: `ベージュ ブラック`) | 同上 (配列) |
| 9 | `size` | 文字列 | | 同上 |
| 10 | `quantity` | 文字列 | | 同上 |
| 11 | `pattern` | 文字列 | | 同上 |
| 12 | `material` | 文字列 | | 同上 |
| 13 | `url_1` | URL | クラスタ内 1 件目の商品 URL | 第 1 段階生データから `items[0].rowIndex` で引いた URL |
| 14 | `url_2` | URL | クラスタ内 2 件目の商品 URL | `items[1].rowIndex` で引いた URL |
| 15 | `url_3` | URL | クラスタ内 3 件目の商品 URL | `items[2].rowIndex` で引いた URL |

`count` (= `count_total`) は常に 3 以上だが、これは ids 合計であり cluster の `items` 数 (= row 数) とは別である。size=1 や size=2 のクラスタでも `count_total >= 3` なら候補になるため、`url_2` や `url_3` は対応する row が存在せず空セルになる場合がある。

### 禁止事項

- `slice(0, N)` や「上位のみ」「厳選」等の理由でクラスタを間引かない (全件書き出し)
- クラスタを目視判断で分割・統合・除外しない (クラスタリングの妥当性は第 6 段階までで確定済み、本段階は書き出しのみ)
- 代表タイトル (`items[0].name`) を意訳・短縮しない (原文そのまま)
- 画像は CSV に含めない (画像は第 5 段階 5-3 で使用、本段階の対象外)

### 実装スクリプト (`research/build_final_report.js`)

実装済み。以下の仕様で動作する:

- 入力: `<run-dir>/identity_resolution/final_clusters.json` と第 1 段階生データ (CLI 引数 2 つで明示指定)
- `is_purchase_candidate=true` のクラスタのみをループし、各クラスタの `items[*].rowIndex` を index に使って第 1 段階生データの `items` 配列から `price` と `url` を引く
- 15 列の CSV を組み立て、`reports/YYYY/MM/YYYY_MM_DD_NN_メルカリ売れ筋リサーチ_v2.csv` に書き出す (BOM なし UTF-8、LF 改行、RFC 4180 準拠のクォート)
- `YYYY/MM/DD` は JST の実行日。`NN` は同日内連番 (出力先ディレクトリの既存ファイル名を走査し、同日内で最大の番号 + 1 を自動採番)
- 出力パスが既に存在する場合はエラー停止 (出力ファイルの共通原則 1 「一度書き出したら更新禁止」)

実行コマンド:

```bash
node research/build_final_report.js <run-dir> <raw-data-path>
```

例:

```bash
node research/build_final_report.js \
  research/runs/2026_04_23_10_00 \
  research/2026_04_23_10_00__mercari_14day_results.json
```

stdout に書き出し結果 (outPath / totalClusters / purchaseCandidates / rows / columns) の JSON が出る。
