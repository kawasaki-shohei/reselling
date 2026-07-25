# 出品前の最安値リサーチ手順 (Cowork 版)

本手順書は **Claude Cowork** で実行する。出品当日の前段ステップとして 1 日 20 件の商品の市場最安値を調査する。結果を物販オーナーが見て、出品時に使う [`procedures/listing-cowork.md`](./listing-cowork.md) の `listings/runs/YYYY_MM_DD/YYYY_MM_DD_listing.csv` の `価格` 列を手書きで埋める材料にする。

## やりたいこと

自分が出品しようとしている中国輸入品 (1 日 20 件) について、**メルカリで現在販売中の同一商品の最安値**を調査する。

入力 CSV (商品番号 / 商品名 / メルカリ URL、20 件) の各商品について、同一商品の最安値とその URL を出力する。

```
1. 物販オーナーが「今日リサーチする 20 件」のマスター CSV を用意
2. Cowork が最安値リサーチ実行 (本手順書)
3. Cowork が結果 CSV を物販オーナーに提示
4. 物販オーナーが結果を見て出品価格を決め、listing.csv の `価格` 列に手書きで埋める
5. 出品 (listing-cowork.md)
```

## 入力

物販オーナーが Cowork セッション開始時に渡す 20 件分の CSV (3 列、UTF-8):

```
商品番号,商品名,メルカリURL
FD02701,宅配ビニール袋 B4 100枚 白,https://jp.mercari.com/item/m34010056319
FD00301,犬 ロングリード 10m 訓練用 トレーニング 大型犬 中型犬 黒,https://jp.mercari.com/item/m85899014828
...
```

- 商品番号は出品 CSV (`listings/runs/YYYY_MM_DD/YYYY_MM_DD_listing.csv`) の `id` 列と同じ値を使う前提 (例: `FD02701`)。物販オーナーが管理キーとして両者で揃える
- メルカリ URL は仕入れ元または出品予定の参照商品。**本手順書の信頼できる唯一の入力**
- **商品名 列は信頼しない**: 物販オーナーの意図メモであり URL の実物と食い違うことがある (例: 「白」と書かれているが実物は黒)。本手順書では URL ベースで動き、商品名は参照しない (第 1 段階で URL から実物データを取得し、それを正にする)
- 同 URL で個数違い・色違いの枝番 (`FD00101` / `FD00102`) は別商品扱い (キーワードも検索も別に実行する)
- **マスター CSV は毎回新しい**: 前回どこまで処理した、の状態管理 (progress.json) は不要 (毎回 20 件で完結)

## 出力

**物販オーナーへの成果物は HTML 1 ファイルである。**

| ファイル | 役割 |
|---|---|
| `runs/<ts>/最安値リサーチ_<ts>.html` | **成果物**。物販オーナーがブラウザで開いて値付けに使う |
| `runs/<ts>/report.json` | run 固有の成果物データ (機械が読む正本)。HTML はここから生成される |
| `runs/<ts>/report_html_img/` | HTML が参照する画像 (自動コピー) |

生成は第 7 段階の 2 コマンドで完結する (`build-report.js` → `render-report.js`)。
**CSV は生成しない** (2026-07-26 に廃止。値付けの参照は HTML の一覧表で行う)。

report.json の 1 商品あたりの主要フィールド:

| フィールド | 内容 |
|---|---|
| `code` | 商品番号 (物販オーナーの管理番号) |
| `status` | 下表の 4 値 |
| `target.name` / `.price` / `.url` / `.photos` / `.attributesLine` | 対象商品 (自分の商品) |
| `search.keyword` / `.plannedKeyword` / `.candidateCount` / `.url` | 検索の記録 |
| `machine.{matched,near_miss,insufficient,rejected}` | 機械照合の内訳 |
| `judged[]` | 画像最終確認の履歴 (価格昇順、画像・◯×・理由付き) |
| `cheapest.price` / `.url` / `.photos` / `.priceDiff` / `.verifyUrl` | 最安ライバル (matched のみ) |
| `reason` | 同一と判定した理由 / 見つからなかった理由 |

スキーマの全体像は第 7 段階の記述を参照。

### ステータスの定義

| 値 | 意味 | 物販オーナーの次の行動 |
|---|---|---|
| `matched` | 同一商品が見つかった | 最安価格を見て値付けする |
| `no_match` | 候補を画像判定した結果、**すべて別商品**だった = 市場に同型が無い | **何もしない**。競合不在なので価格を維持できる |
| `no_candidates` | 画像判定に送れる候補が **1 件も作れなかった** = 調査が完了していない | **キーワードを変えて再調査**する |
| `error` | 対象商品の取得に失敗 (URL 削除・売約済み等) | 対象 URL を確認する |

**`no_match` と `no_candidates` の区別が最も重要**である。両者は「最安価格が空欄」という
同じ見た目になるが、意味は正反対:

- `no_match` は **結論** (調べ終わった。競合がいない)
- `no_candidates` は **未測定** (調べられていない)

判定条件は機械的に決まる:

```
第 6 段階に送った候補が 0 件            → no_candidates
第 6 段階に送った候補が 1 件以上あり、
  すべて sameProduct=false             → no_match
```

2026_07_21_21_50 run では両者を `no_match` で一括りにしたため、
物販オーナーが「no_match 17 件」を全件再調査する判断をし、
実際には調査不要だった商品 (市場に同型が無い商品) に時間を使う結果になった。

打ち切りの内訳 (250 件到達 / hasNext=false / キーワード変更の上限超過 / 判定上限到達) は
`result.json` の `reason` と `run_notes.md` に記録する。HTML のカード最下部にも小さく出るが、
一覧表には載せない (物販オーナーの値付け判断が変わらないため)。

このレポートを物販オーナーが見て、出品 CSV の `価格` 列に手書きで反映する。

## 同一商品判定の前提

メルカリの中国輸入品は、出品者が他出品者通報リスクを避けるためタイトル・画像・説明文を意図的に変えて出品する慣習がある。よって「タイトル文字列の一致」ではなく **実体属性の一致** で同一商品を判定する。

別商品扱いになる軸 (7 軸):

| 軸 | 説明 | 例 |
|---|---|---|
| `category` | 粗ジャンル | トートバッグ / サングラス / ロングリード |
| `subcategory` | 用途・機能修飾を含む細名 | マザーズバッグ / ウェリントン型 / 訓練用 |
| `color` | 色 (配列) | `["黒"]` / `["ブラック", "白"]` |
| `size` | サイズ | A3 / A4 / B4、S / M / L、80×120、25cm |
| `quantity` | 個数・セット数・容量 | 1個 / 2個セット / 100枚 / 500g |
| `pattern` | 柄 | 無地 / 花柄 / チェック / 迷彩 / ひし形キルティング |
| `material` | 素材 | 本革 / 合皮 / ナイロン / ポリエステル / プラスチック |

判定不能な軸は null (color は空配列 `[]`)。後段の機械照合で「unknown は通す」扱いになる。

実例集: [`docs/research/mercari/judgment_examples/`](../docs/research/mercari/judgment_examples/) を必ず参照する (判定例ファイルが無い軸でも上表の一般則は適用)。

## 出力ファイルの共通原則

### 原則 1: 一度書き出したら更新禁止 (不変)

本手順書の各段階が書き出す成果物 (`cheapest-price-research/runs/<ts>/` 配下全て、および第 7 段階の `report.json` / `最安値リサーチ_<ts>.html`) は全て不変とする。
ただし `report.json` と HTML は中間成果物から機械的に再生成できるため、生成スクリプト
(`build-report.js` / `render-report.js`) を直せば同じ run で作り直してよい。

- 誤った出力が見つかった場合は、入力側を修正して該当ファイル以降を再生成する
- 元ファイルを直接書き換えると、監査 (どの値がどう変換されたか追跡) と再生成 (やり直し) の両方が効かなくなる
- 再生成は新しい run (新しい `<ts>`) を作って実行する

### 原則 2: Agent 起動時はプロンプト本体に禁則を必ず含める

各 Sonnet Agent に渡すプロンプト本体の冒頭に、以下の禁則セクションを必ず含める:

1. 指定出力パス以外にファイルを作成しない
2. 入力ファイルを書き換えない
3. プロジェクト内の他ファイルを変更しない (Edit / Write / NotebookEdit は出力パスへの 1 回の書き込みのみ)
4. 違反しそうな操作は実行せず報告する

### 原則 3: Agent 完了後は親 Cowork が検証する

Agent 起動後、毎回以下をチェックする:

1. **出力ファイルの存在確認**: 指定パスに出力が作成されているか
2. **入力ファイルの不変確認**: 入力ファイルの mtime・サイズが Agent 起動前と同じか
3. **想定外のファイル作成なし**: Agent 起動前後で想定外のファイルが作られていないか確認

違反が見つかったら、該当 Agent の出力を破棄 (使わない) して、プロンプトと Agent 指示を見直してからやり直す。

---

## Agent 運用の共通原則

> **注意**: 過去 run のうち `runs/2026_05_28_10_31` (23件・52分) は**旧方式** (第 5-6 段階を 1 Agent に統合した
> 簡略フロー) の記録である。取りこぼし事例を受けて 2026-07-14 に現行の分離版へ改訂されたため、
> **旧 run の所要時間・Agent 数を現行手順の見積もりに使わないこと**。現行方式の実測は
> `runs/2026_07_21_21_50/run_notes.md` §5.1 (30件・約6時間14分・82体) を参照。

Sonnet Agent を起動する全工程 (第 2 段階キーワード生成 / 第 3 段階対象属性抽出 / 第 5 段階候補属性抽出 / 第 6 段階画像最終確認) は本原則に従う。Cowork は Opus 4.7 [1m] 親セッションから Sonnet サブエージェントを `subagent_type=general-purpose, model=sonnet` で起動できる (検証済み)。

### 原則 1: 1 Agent あたりの担当数

| 段階 | 1 Agent の担当 | 並列 |
|---|---|---|
| 第 2 段階 キーワード生成 | 20 件 (1 Agent で全件) | - |
| 第 3 段階 対象属性抽出 | 20 件 (1 Agent で全件) | - |
| 第 5 段階 候補属性抽出 | 1 バッチ = 50 件 (1 商品 1 バッチあたり 1 Agent、順次起動) | 禁止 |
| 第 6 段階 画像最終確認 | 1 候補 (順次起動、`sameProduct=true` で早期終了) | 禁止 |

並列起動は禁止 (使用量制限を一気に消費するため)。

### 原則 2: バッチ逐次保存 (中断耐性の要)

Agent プロンプトには **「1 結果完了ごとに即 Write、まとめて一括書き出しは禁止」** を必ず明記する。併せて **なぜ逐次保存が必要か (中断で判定がロストする、親は書き出されたファイルしか見ない)** を Agent 自身に理由として伝える。

### 原則 3: Agent 完了報告を鵜呑みにしない (実ファイル検証必須)

Agent が「完了」と報告しても、親 Cowork は必ず **実ファイルの存在と件数** を確認する:

1. 指定出力パスにファイルが存在する
2. JSON として Parse できる、または CSV として読める
3. レコード件数が期待値と一致する
4. 入力ファイルの mtime が Agent 起動前と同じ

Agent の返答テキストでは判定せず、ファイル mtime と件数を直接見る。件数不整合または未完了時は、次の原則 4 で復帰させる。

### 原則 4: 停止 Agent の復帰は SendMessage (新規 Agent() は禁止)

Agent 起動時のレスポンスに含まれる **`agentId` を必ず控える**。途中停止したら:

```
SendMessage({
  to: "<agentId>",
  message: "<出力パス> がまだ書き出されていません。判定を継続し、全件保存してから『全 N 件保存完了』と報告してください。"
})
```

で **transcript (判定途中の文脈) を保持したまま復帰** する。新規 `Agent()` 呼び出しは別個体になり、判定途中の文脈を失うため **復帰目的では禁止** (未着手バッチの新規起動には当然使ってよい)。

### 原則 5: Agent 01 完了直後のスポットチェック (必須)

最初の Agent が完了したら、**出力から数件抜粋して判定を目視確認** する。判定品質に問題があれば後続 Agent を止めてプロンプトを修正する。

| 段階 | 確認ポイント |
|---|---|
| 第 2 段階 キーワード生成 | 5〜10 件抜粋して「商品名 → キーワード」の対応 (色・個数・サイズの抜けが無いか、修飾語の混入が無いか) |
| 第 3 段階 対象属性抽出 | 5〜10 件抜粋して 7 軸属性ラベルの妥当性 (画像で判定した色が抜けていないか、null 多発の軸があるか) |
| 第 5 段階 候補属性抽出 | バッチ 1 の結果を実物画像と照合 (画像優先原則が機能しているか、明らかに違う属性付与がないか) |
| 第 6 段階 画像最終確認 | 最初の判定の `sameProduct` と `reason` (判定根拠が空・形式不備でないか) |

### 原則 6: 親 Cowork セッションは軽作業に徹する

- 親 Cowork は画像 Read をしない (親 + 子のトークン累積で使用量制限が早く来る)
- 親の役割は Agent 起動 → 完了確認 (原則 3) → 次 Agent 起動 に徹する
- スポットチェック時 (原則 5) のみ、少数件を親が Read してよい

### 原則 7: 使用制限への対処

使用制限ヒット時は session_checkpoint 的なものを残して翌日再開する。本手順書は **20 件 / 1 セッションで完走できる規模** で設計しているが、ヒットした場合は途中で中断し、翌セッションで新規 run を立ち上げて全 20 件をやり直す前提 (1 商品単位の中断再開は仕組まない、状態管理 progress.json も持たない)。

---

## run_notes.md の運用

各 run の `cheapest-price-research/runs/<ts>/run_notes.md` に、その run の実行結果と気づきを記録する。**手順書通りに進まなかったこと・予想外のこと・各段階の件数概要を残す目的**。本手順書の出力ファイル共通原則と同様に、書き出した内容は不変扱いとする (誤りが見つかったら別 run の `run_notes.md` で訂正する)。

### 書く目的

- 別のセッションが後から run の経緯を追えるようにする (transcripts は持続しない、commit messages では細かすぎる)
- 手順書 / スクリプト / プロンプト雛形の改善候補を蓄積する
- 過去 run との件数比較で母集団変化・プロンプト変更の影響を追跡する

### 書くタイミング

- 各段階完了時に追記する (記憶が新しいうち)
- run 完了時に最終整理する (件数フロー表・スケジュール・反映候補等)

### 書く内容 (最低限)

1. **この run の位置づけ**: run_id (`<ts>`)、目的、対象データ (入力 CSV のパス・件数 = 20)、進捗状況、前 run との関係
2. **件数フロー実績**: 各段階の入力 → 出力件数の表 (商品数 / 候補属性抽出バッチ数 / 機械照合通過数 / 画像最終確認 matched 件数 / no_match 件数)
3. **手順書記載からの逸脱点**: 実運用で調整した部分、その背景・対処・教訓
4. **新規発覚した問題と対処**: バグ・運用ミス・想定外の挙動
5. **実行スケジュール**: 各段階の開始・完了時刻 (JST)
6. **手順書への反映候補**: 次 run までに本手順書 / スクリプト / プロンプト雛形に反映すべき項目
7. **ファイル参照クイックリンク**

### 書き方

- **独立して読めるように書く**
- 節タイトル (`## 1.`、`### 3.1`) で構造化
- 過去 run の `run_notes.md` と相互リンクを貼る
- 件数・時刻・Agent 数・kept 数 等の具体的な数値を記録する

---

## プレースホルダ規約

本手順書のパス記述で使うプレースホルダの形式:

| プレースホルダ | フォーマット | 例 | 出所 |
|---|---|---|---|
| `<ts>` | `YYYY_MM_DD_HH_MM` (JST) | `2026_05_28_09_00` | run 開始時の JST 時刻 |
| `{商品番号}` | 入力 CSV の `商品番号` 列の値そのまま | `FD02701` | 入力 CSV |
| `{id}` | Mercari item id (`m` + 数字 11 桁) | `m92167660103` | Mercari API レスポンスの `item.id` |
| `page_NN` | `page_` + 2 桁ゼロ埋め | `page_01`, ..., `page_05` | 第 4 段階のバッチ番号 (1〜5、絶対上限 5) |
| `{rank}` | 2 桁ゼロ埋め | `01`〜`50` | 同バッチ内の価格昇順順位 (1〜50、itemBrand 除外後) |

---

## ディレクトリ構成

```
reselling/
├── cheapest-price-research/                          # 本手順書の専用ディレクトリ
│   ├── cheapest-price-search.js                      #   検索 API (javascript_tool 用)
│   ├── mercari-item-detail.js                        #   商品詳細 API (javascript_tool 用)
│   ├── attribute-match.js                            #   7 軸機械照合 (Node CLI)
│   ├── prompts/
│   │   ├── keyword-generation.md                     #   第 2 段階 プロンプト
│   │   ├── target-attribute-extraction.md            #   第 3 段階 プロンプト
│   │   ├── candidate-attribute-extraction.md         #   第 5 段階 プロンプト
│   │   └── final-judgment.md                         #   第 6 段階 プロンプト (画像最終確認用)
│   └── runs/
│       └── <ts>/                                     #   1 セッション = 1 run
│           ├── source.csv                            #     物販オーナー提供の 20 件マスター CSV (不変)
│           ├── keywords.csv                          #     第 2 段階出力 (4 列、不変)
│           ├── target_attributes.json                #     第 3 段階出力 (20 商品集約、不変)
│           ├── target_detail/
│           │   └── {商品番号}.json                   #     第 1 段階出力 (商品ごと、不変)
│           ├── target_images/
│           │   └── {商品番号}/
│           │       └── photo_N.jpg                   #     第 1 段階で DL した対象画像 (photos 全枚数)
│           ├── items/
│           │   └── {商品番号}/
│           │       ├── rivals/
│           │       │   └── page_NN.json              #     第 4 段階出力 (バッチごと、不変)
│           │       ├── thumbs/
│           │       │   └── page_NN/{rank}.jpg        #     サムネ DL
│           │       ├── candidate_attributes/
│           │       │   └── page_NN.json              #     第 5 段階 5-2 出力 (Sonnet、不変)
│           │       ├── matched_candidates/
│           │       │   └── page_NN.json              #     第 5 段階 5-3 出力 (機械照合、不変)
│           │       ├── candidate_detail/
│           │       │   └── {id}.json                 #     第 6 段階で取得 (一致候補のみ、不変)
│           │       ├── candidate_images/
│           │       │   └── {id}/photo_N.jpg          #     第 6 段階で DL (一致候補のみ、photos 全枚数)
│           │       ├── final_judgment/
│           │       │   └── {id}.json                 #     第 6 段階出力 (判定結果、不変)
│           │       └── result.json                   #     最終結果 (最安値 1 件 or no_match)
│           ├── report.json                           #   第 7 段階出力 (run 固有の成果物データ)
│           ├── 最安値リサーチ_<ts>.html               #   ★ 物販オーナーへの成果物 (これを提示する)
│           ├── report_html_img/                       #   HTML が参照する画像 (自動コピー)
│           └── run_notes.md                          #   本 run の実行結果・気づき・逸脱点
│
├── procedures/cheapest-price-research-cowork.md      # 本手順書
└── listings/runs/YYYY_MM_DD/                         # 出品手順 (listing-cowork.md) で使う
```

`cheapest-price-research/runs/<ts>/` 以下のファイルは全て不変。再生成は新しい run (新しい `<ts>`) を作る。

**progress.json は持たない**: 本手順書は 20 件 / 1 セッションで完走する設計。中断した場合は新 run でやり直す前提。

---

## 環境固有の事項 (Cowork)

### ブラウザ操作

Mercari API は DPoP 認証付きで Claude in Chrome の javascript_tool (≒ `browser_evaluate`) 経由で叩く。手順:

1. ユーザーが Chrome で `https://jp.mercari.com` にアクセス済み (任意のページ、未ログインで可、DPoP セッション確立のため)
2. Cowork セッション開始
3. 各 javascript_tool 実行時に `window.__ITEM_DETAIL_INPUT__` や `window.__CHEAPEST_BATCH_INPUT__` を事前に設定してから本実装スクリプトを実行

実装スクリプトは Claude Code と同じ `cheapest-price-research/*.js` を使う。

### javascript_tool の出力 truncation と回収経路 (2026_07_21_21_50 run §3 の正式化)

Cowork の `javascript_tool` は返り値が約 1,000 文字で打ち切られる (`[TRUNCATED]`)。また数字のみの長い文字列は
`[BLOCKED: Base64 encoded data]` になり一切返らない。**API レスポンスを返り値で受け取る設計は動かない**。

実証済みの回収経路 (5/28 run で確立、7/21 run で再検証済み):

```
ページ内スクリプトで console.log('TAG#key#' + JSON.stringify(data)) の形式でダンプ
  → read_console_messages (pattern: "TAG#key#", limit: 1) で 1 レコードずつ回収
  → 回収・書き出しは Sonnet サブエージェントに委譲してよい (親のコンテキスト節約)
```

### 画像 URL は商品 ID から計算可能 (API 不要)

サンドボックスの curl は `static.mercdn.net` にのみ到達できる (api.mercari.jp は不可)。
画像 URL は商品 ID から決定的に計算できるため、**photos[] を API から受け取る必要はない**:

- フル解像度: `https://static.mercdn.net/item/detail/orig/photos/{id}_{N}.jpg` (N=1,2,...)
- サムネ: `https://static.mercdn.net/c!/w=240,f=webp/thumb/photos/{id}_1.jpg`
- 存在しない N は **403** を返すので、404/403 が出た位置で枚数判定できる
- これにより **第 6 段階の候補 items/get 呼び出しは省略可** (必要なのは画像のみ。price/name は検索結果に既にある)

注意: bash ツールはコールごとに独立セッションのため、バックグラウンド実行 (`&`) は引き継がれない。
大量 DL は 40〜60 件のチャンクに分割してフォアグラウンドで実行する (`xargs -P 10` 等)。

---

## 全体フロー

```
0. セッション準備
   - 物販オーナーから 20 件分のマスター CSV を受け取る
   - <ts> 採番 (JST `YYYY_MM_DD_HH_MM`)
   - cheapest-price-research/runs/<ts>/ 作成、マスター CSV を source.csv にコピー
   - https://jp.mercari.com に Chrome でアクセス済み確認 (DPoP セッション確立)
↓
1. 対象商品 詳細取得 (target_detail_fetch_step)
   - items/get API batch で 20 件の target_detail を取得
   - 各商品の photos[] 全枚数を curl で target_images/{商品番号}/photo_N.jpg に保存
     ↓ target_detail/{商品番号}.json (20 ファイル)
     ↓ target_images/{商品番号}/photo_N.jpg (商品ごとに M 枚)
↓
2. キーワード生成 (keyword_generation_step)
   - Sonnet サブエージェント 1 体起動
   - 入力: target_detail/ + target_images/ (実物データ)
   - 出力: keywords.csv (4 列)
↓
3. 対象商品 属性抽出 (target_attribute_extraction_step)
   - Sonnet サブエージェント 1 体起動
   - 入力: target_detail/ (title + description) + target_images/ (photos 全枚数)
   - 出力: target_attributes.json (商品番号→ 7 軸属性)
↓
4〜6. 最安値探索ループ (商品ごと、順次)
     1 商品の流れ:
       (a) 検索 API でバッチ取得 (価格昇順 50 件)             [第 4 段階]
            ↓ rivals/page_NN.json
       (b) サムネ画像 DL (50 枚)
            ↓ thumbs/page_NN/{rank}.jpg
       (c) 候補 50 件の属性抽出 (Sonnet 1 体)                 [第 5 段階 5-2]
            ↓ candidate_attributes/page_NN.json
       (d) 対象属性 vs 各候補属性で 7 軸機械照合 (Node)        [第 5 段階 5-3]
            1 軸でも明らかに違えば外す、unknown は通す
            ↓ matched_candidates/page_NN.json (rank 配列、価格昇順)
       (e) 一致候補があれば、価格昇順先頭から順に画像最終確認  [第 6 段階]
            sameProduct=true → 最安値確定、次の商品へ
            sameProduct=false → 同バッチ次の一致候補で確認
       (f) 一致候補ゼロ or 全部 false → 次バッチ (page+1)
       (g) 打ち切り条件:
            5 バッチ取得 (250 件) で未確定 → no_match
            hasNext=false で次バッチが無い → no_match
     ↓ items/{商品番号}/result.json (20 ファイル)
↓
7. 最安値抽出 + レポート化 (cheapest_export_step)
   - 20 件の result.json を集約
   - build-report.js → report.json、render-report.js → 最安値リサーチ_<ts>.html
   - run_notes.md
   - 物販オーナーへ報告
```

---

## 第 1 段階: 対象商品 詳細取得 (target_detail_fetch_step)

入力 CSV (`source.csv`) の各 URL について、Mercari 内部 API `items/get` を叩いて実物データ (タイトル・価格・説明文・全画像 URL・出品者情報・商品の状態等) を取得し、後段すべての判定の基準にする。

**CSV の商品名は信頼できない場合がある** (物販オーナーの意図メモであり、URL が指す実物と食い違うことがある: 例 — 「白」と書かれているが実物は黒)。本手順書では **URL を正、CSV 商品名は無視** する設計とする。

### 入出力

| | 内容 |
|---|---|
| 入力 | `cheapest-price-research/runs/<ts>/source.csv` (物販オーナー提供の 20 件、3 列: 商品番号 / 商品名 / メルカリURL) |
| 出力 | `cheapest-price-research/runs/<ts>/target_detail/{商品番号}.json` (1 商品 = 1 ファイル、不変) |
| 出力 | `cheapest-price-research/runs/<ts>/target_images/{商品番号}/photo_N.jpg` (photos 全枚数、第 2 / 第 3 / 第 6 段階で使用) |

### API 仕様

| 項目 | 値 |
|---|---|
| エンドポイント | `GET https://api.mercari.jp/items/get?id={id}&include_item_attributes=true&include_non_ui_item_attributes=true` |
| 認証 | **DPoP JWT のみで通る** (`authorization` ヘッダ不要、`credentials: 'include'` も不要、検証済み) |
| 必須ヘッダ | `X-Platform: web` / `dpop: <jwt>` |
| `htu` (DPoP の payload) | クエリ抜きの `https://api.mercari.jp/items/get` |

### 取得項目 (`items/get` レスポンスの `data` フィールド)

| キー | 内容 |
|---|---|
| `id` | mercari item id (例: `m92167660103`) |
| `name` | 商品タイトル |
| `price` | 商品価格 (number) |
| `description` | 商品説明文 (全文、truncate なし) |
| `photos` | 商品画像 URL の配列 (全枚数、フル解像度) |
| `thumbnails` | サムネ URL の配列 |
| `seller` | 出品者情報 |
| `item_condition` | 商品の状態 |
| `shipping_payer` / `shipping_method` / `shipping_from_area` / `shipping_duration` | 配送関連 |
| `item_category` / `item_category_ntiers` | カテゴリ |
| `colors` / `item_attributes` | 色・属性 |
| `updated` (unix) / `created` (unix) | 更新時刻 |

### 手順

#### 1-1. javascript_tool で DPoP セッション確立

Chrome を `https://jp.mercari.com` の任意のページに移動して 2〜3 秒待つ (未ログインで可)。IndexedDB の DPoP キーペアが確立される。

#### 1-2. items/get API バッチ取得

実装スクリプト: `cheapest-price-research/mercari-item-detail.js` (javascript_tool 用、batch 入力対応)。

```js
window.__ITEM_DETAIL_INPUT__ = {
  items: [
    { productCode: "FD00101", itemId: "m92167660103" },
    { productCode: "FD00301", itemId: "m85899014828" },
    // ... 入力 CSV 全 20 件
  ]
};
```

戻り値:

```json
{
  "fetchedAt": "...",
  "total": 20,
  "succeeded": 19,
  "failed": 1,
  "results": [
    { "productCode": "FD00101", "itemId": "m...", "status": "ok",
      "http": 200, "data": { /* items/get の data フィールド全体 */ } }
  ]
}
```

#### 1-3. 結果を商品ごとに分割保存

戻り値の `results[]` を商品ごとに `cheapest-price-research/runs/<ts>/target_detail/{商品番号}.json` に書き出す (各ファイルには `data` フィールド本体を保存)。

#### 1-4. 対象画像 photos[] 全枚数をローカル DL

各商品の `data.photos[]` URL を全件 `bash` + `curl` で `cheapest-price-research/runs/<ts>/target_images/{商品番号}/photo_N.jpg` (N=1..M) に保存。後段の第 2 段階 (キーワード生成)、第 3 段階 (対象属性抽出)、第 6 段階 (画像最終確認) で使う。

#### 1-5. 検証

- 出力 JSON ファイルの個数 = 入力 CSV の商品数 (20、失敗分があれば error フィールドで把握)
- 各 JSON が parse 可能、`name` `price` `description` `photos` が空でない
- 各 photo_N.jpg が DL 完了 (file size > 0)、枚数 = photos[].length

---

## 第 2 段階: キーワード生成 (keyword_generation_step)

各商品について、第 1 段階で取得した **実物データ (タイトル + 説明文 + photos[0] 画像)** から Sonnet サブエージェントで検索キーワードを生成する。

**CSV 商品名は参照しない** (信頼できない場合があるため URL ベースの実物データを正とする)。

### 目的

第 1 段階の実物データから、検索ヒットを「**対象商品と同一の可能性が高い** ものに絞れるキーワード」を作る。タイトルそのままでは検索ヒットが広すぎる、または不適切な修飾語が混じる。

### 入出力

| | パス |
|---|---|
| 入力 | `cheapest-price-research/runs/<ts>/target_detail/{商品番号}.json` (全 20 商品) |
| 入力 | `cheapest-price-research/runs/<ts>/target_images/{商品番号}/photo_1.jpg` (色判定用、photo_1 のみで OK) |
| 入力 | `cheapest-price-research/runs/<ts>/source.csv` (商品番号一覧の参照用、商品名列は使わない) |
| 出力 | `cheapest-price-research/runs/<ts>/keywords.csv` (4 列: `商品番号,対象タイトル,メルカリURL,検索キーワード`) |

出力 CSV の 2 列目は CSV 入力の「商品名」ではなく **第 1 段階で取得した実物の `name` (タイトル)** に置き換える。

### 手順

1. Sonnet サブエージェント (`subagent_type=general-purpose, model=sonnet`) を 1 体起動
2. プロンプト本文は `cheapest-price-research/prompts/keyword-generation.md` を使う
3. Agent 完了後の検証:
   - 出力ファイルが存在
   - 出力 CSV の行数 = 20 + 1 (ヘッダ)
   - 入力ファイル mtime 不変
4. Agent 01 完了直後にスポットチェック (5〜10 件)

---

## 第 3 段階: 対象商品 属性抽出 (target_attribute_extraction_step)

各対象商品の 7 軸属性を Sonnet サブエージェントで抽出する。後段 (第 5 段階 機械照合) の基準データになる。

### 目的

第 1 段階の実物データ (タイトル + 説明文 + photos 全枚数) から、対象商品の 7 軸属性 (category / subcategory / color / size / quantity / pattern / material) を抽出する。

機械照合 (第 5 段階) はこの target_attributes.json を「正」として、各候補の属性と 1 軸ごとに突き合わせる。

### 入出力

| | パス |
|---|---|
| 入力 | `cheapest-price-research/runs/<ts>/target_detail/{商品番号}.json` (全 20 商品) |
| 入力 | `cheapest-price-research/runs/<ts>/target_images/{商品番号}/photo_N.jpg` (全枚数) |
| 入力 | `cheapest-price-research/runs/<ts>/source.csv` (商品番号一覧の参照用) |
| 出力 | `cheapest-price-research/runs/<ts>/target_attributes.json` (1 ファイルに 20 商品集約、不変) |

### 7 軸属性の定義

冒頭「## 同一商品判定の前提」で定義した 7 軸 (category / subcategory / color / size / quantity / pattern / material) を抽出する。判定不能な軸は null (color は空配列 `[]`)。

### 画像優先の原則

タイトル/説明文と画像で矛盾があれば画像優先。FD02701 の事例 (タイトル「白」だが画像と description で黒) では `color: ["黒"]` を出す。

### 出力 JSON フォーマット

```json
{
  "extractedAt": "2026-05-28T10:00:00+09:00",
  "products": {
    "FD00301": {
      "id": "m85899014828",
      "name": "犬 ロングリード 10m 訓練用 トレーニング 大型犬 中型犬 黒",
      "attributes": {
        "category": "ロングリード",
        "subcategory": "犬用訓練リード",
        "color": ["黒"],
        "size": "10m",
        "quantity": "1本",
        "pattern": "無地",
        "material": "ナイロン"
      },
      "attributes_detail": "幅約2.5cm(画像実測)。金具はシルバーの回転ナスカン。刻印なし。",
      "reason": "画像で黒・ナイロン製の長尺リードを確認。タイトル・説明文と一致。"
    }
  }
}
```

**attributes と attributes_detail の役割分担 (2026_07_21_21_50 run §9.1 を受けた改訂)**:

- `attributes` は **機械照合の比較キー**。括弧書き禁止・画像実測値禁止・短い一般語のみ
  (過去 run で `約14.5cm` vs `15cm`、`PUレザー(合皮)` vs `PUレザー` の表記差により
  同一商品が全滅し、対象自身の出品まで棄却される事故が起きた)
- `attributes_detail` は **第 6 段階 (画像最終確認) 用の識別ポイント** (自由記述)。
  画像実測の寸法・刻印・留め具/開閉方式・内部構造・付属品構成など、同型類似品との見分けに効く観察を書く。
  機械照合には使われない。第 6 段階のプロンプトにそのまま渡すこと

### 手順

1. Sonnet サブエージェント (`subagent_type=general-purpose, model=sonnet`) を 1 体起動
2. プロンプト本文は `cheapest-price-research/prompts/target-attribute-extraction.md` を使う
3. プロンプトに含めるべき要素:
   - 絶対禁則
   - 7 軸属性の定義 + 各軸の例
   - 画像優先の原則
   - 判定不能時は null (color は `[]`)
   - 1 商品判定ごとに即 Write (バッチ逐次保存)
   - 入力パス / 出力パス (絶対パス)
4. Agent 完了後の検証:
   - target_attributes.json が存在
   - JSON parse 可能、`products` の商品数 = 20
   - 入力ファイル mtime 不変
   - 想定外ファイル無し
5. Agent 01 完了直後にスポットチェック (5〜10 件抜粋して属性ラベルの妥当性を目視)

---

## 第 4 段階: 検索 API 取得 (rival_search_step)

第 2 段階で生成したキーワードを使い、Mercari 検索 API で **現在販売中の商品を価格昇順で 50 件** 取得する。バッチ単位 (1 ページ = 50 件) で動く。

### 目的

最安値候補の母集団を作る。後続の候補属性抽出 + 機械照合に渡す。価格昇順なので、バッチ先頭ほど安い。

### 検索条件

Mercari 検索 API (`POST https://api.mercari.jp/v2/entities:search`、DPoP 認証) のリクエストボディに以下を渡す:

| フィールド | 値 | 補足 |
|---|---|---|
| `keyword` | 第 2 段階のキーワード | 商品ごとに異なる |
| `excludeKeyword` | `''` | 空文字 |
| `sort` | `'SORT_PRICE'` | 価格でソート |
| `order` | `'ORDER_ASC'` | 昇順 (安い順) |
| `status` | `['STATUS_ON_SALE']` | 販売中のみ |
| `itemConditionId` | `[1]` | 新品・未使用 |
| `itemTypes` | `['ITEM_TYPE_MERCARI']` | 個人出品 (事業者ショップは除外) |
| `withItemBrand` | `true` | レスポンスに itemBrand を含める (後段で除外用) |
| `priceMin` / `priceMax` | `0` / `0` | 指定なし |
| `pageSize` | `50` | 1 バッチの件数 |
| `pageToken` | 前バッチの `meta.nextPageToken` (1 ページ目は `''`) | ページネーション |

### クライアント側フィルタ (取得後)

| 条件 | 適用 |
|---|---|
| `item.itemBrand != null` の行を除外 | **適用する** (中国輸入対象外の正規ブランド品を弾く) |
| 14 日以内 (`item.updated`) フィルタ | **適用しない** (古い出品でも最安候補に含める) |

### 注意: Mercari 検索 API のキーワード挙動

Mercari 検索 API はキーワードを **AND マッチで厳密にフィルタしない**。例: キーワードに「黒」を入れても、上位に白系商品が混じることがある。

そのため**キーワードだけで完全な絞り込みは期待できない**。本手順書の設計では、検索 API はあくまで候補母集団を取得する役割で、最終的な絞り込みは第 5 段階 (機械照合) と第 6 段階 (画像最終確認) で行う。

### 低ヒット時の再検索 (2026_07_21_21_50 run §8.2 の正式化)

初回検索のヒット数 (itemBrand 除外後) が **10 件未満** の商品は、キーワードを緩めて **1 回だけ** 再検索する。

- 緩め方: 希少語・過剰な色/サイズ/個数指定を外し、中核の商品名 + 効く属性 1 語程度に減らす
  (例: 「クリアリング 指輪 ダークブラウン」→「クリアリング 指輪」、「自転車ベル ステルス 31.8mm」→「自転車ベル」)
- 再試行は 1 回のみ。それでも母集団が作れなければその状態で進める (run_notes に記録)
- **注意**: 緩めすぎると別カテゴリの商品が大量混入する (実例: 「クリアリング 指輪」がガチャガチャ玩具を拾った)。
  中核名詞は必ず残すこと

#### 採否は「件数」ではなく「中身」で決める (2026_07_26_07_46 run §6.3 の反映)

**再検索の採否をヒット数で決めてはならない。** 検索は価格昇順なので、キーワードが広いと
**安い周辺小物が上位を占有し、件数だけは増えるのに実物商品が 0 件になる**。

実例 (2026_07_26_07_46 run):

| 商品 | 初回 | 再検索 | 再検索で集まったもの |
|---|---|---|---|
| FE08501 卓球ラケットセット | 1 件 | 27 件 | グリップテープ 9・キーホルダー 4・ゼッケンピン 9 等。**実物ラケット 0 件** |
| FE08902 ジュエリーボックス | 2 件 | 43 件 | 天然石ピアス 28・スマホケース 9 等。**実物ボックス 0 件** |

いずれも「件数が多いほう」を採用した結果、判定に送る候補がゼロになり no_match になった。

**採否の手順**:

1. 再検索結果の **上位 10 件のタイトルを親が確認**する (検索 API のレスポンスに含まれているので追加コスト無し)
2. 対象と**同じカテゴリの商品が 3 件以上**含まれていれば採用
3. 3 件未満なら **採用しない**。初回キーワードの母集団のまま進める
4. 採用したキーワードと不採用にしたキーワードの両方を rivals JSON の `keyword` /
   `rejectedKeyword` に記録する

### 再調査 run でのキーワードの扱い (2026_07_26_07_46 run の教訓)

前 run で `no_match` だった商品を再調査する run では、キーワードを変える対象を限定する。

| 前 run の状態 | 本 run の扱い |
|---|---|
| 判定に送る候補が **0 件** だった (母集団が作れていない) | **キーワードを変える**。前 run のキーワードは失敗が確定しているため |
| 判定に送る候補は **あった** が画像判定で全て false | **キーワードをそのまま使う**。母集団は妥当であり、変えると悪化する |

**⚠ 「前 run と語彙を変える」を全商品に一律で課してはならない。**

2026_07_26_07_46 run では親がこれを必須要件として全 14 商品に課した結果、
**前 run で母集団が正しかった商品のキーワードまで捨てさせて悪化させた**:

| 商品 | 前 run のキーワード | 前 run の母集団 | 本 run で変更後 | 結果 |
|---|---|---|---|---|
| FE08501 | 卓球ラケット 2本セット ケース付き | 34 件・実物ラケット中心 (妥当) | 卓球ラケット セット | 27 件・**実物 0 件**。no_match |

FE08501 が前 run で no_match だったのは母集団の問題ではなく「判定を 3 件で打ち切った」ためであり、
キーワードは変える必要がなかった。**no_match の原因を取り違えるとキーワード改変が逆効果になる。**

### 枝番商品の候補プール共有

同一キーワードになる枝番商品 (色違い・個数違いで検索条件が同じ、例: FD089A1 白 / FD089A3 黒) は、
検索・サムネ DL・候補属性抽出 (5-2) を **1 回だけ実行して結果を共有** してよい。
共有した場合は、コピー先 JSON の `productCode` を書き換え、`note` フィールドに流用元を明記する。
機械照合 (5-3) は対象属性が異なるため商品ごとに実行する。

### 出力

商品 1 つ・1 バッチごとに `cheapest-price-research/runs/<ts>/items/{商品番号}/rivals/page_NN.json`:

```json
{
  "page": 1,
  "fetchedAt": "2026-05-28T09:05:00+09:00",
  "totalReturned": 50,
  "totalAfterBrandFilter": 48,
  "nextPageToken": "...",
  "hasNext": true,
  "items": [
    {
      "rank": 1,
      "id": "m12345",
      "name": "...",
      "price": 980,
      "sellerId": "1234567",
      "updated": 1748000000,
      "url": "https://jp.mercari.com/item/m12345",
      "thumbnails": ["https://static.mercdn.net/.../photo_1.jpg"]
    }
  ]
}
```

`rank` は同バッチ内の価格昇順順位 (1 始まり、`itemBrand` 除外後)。

**⚠ `sellerId` を省略しないこと。** 2026_07_21_21_50 run では console 経由の回収時に
token 節約のため `sellerId` を落としてしまい、**物販オーナー自身の再出品を
ライバルと誤って報告した** (matched 8 件中 4 件が該当の疑い。第 5 段階 5-3 の own の項参照)。
検索 API は `item.sellerId` を返しているので、必ず保存する。
`keyword` (実際に採用した検索語) と `rejectedKeyword` (不採用にした語) も同様に必須。

### 実装

`cheapest-price-research/cheapest-price-search.js` を javascript_tool で実行 (batch 入力対応)。

### バッチ取得ループの打ち切り条件

| 条件 | 値 |
|---|---|
| **主条件**: 第 6 段階で同一商品マッチ発見 | 早期終了 (最安値確定) |
| 安全網 1: 5 バッチ取得しても確定しない (絶対上限 250 件) | 打ち切り |
| 安全網 2: hasNext=false で次バッチが無い | 打ち切り (市場が小さい商品) |
| 安全網 3: キーワード変更の上限 (再検索 1 回) を使い切っても母集団が作れない | 打ち切り |

**打ち切り時のステータスは、打ち切り条件ではなく「第 6 段階に候補を送れたか」で決まる**
(冒頭「## 出力 > ステータスの定義」参照):

- 1 件以上送って全て false → `no_match` (市場に同型が無いという**結論**)
- 1 件も送れなかった → `no_candidates` (調査**未完了**)

注: 旧手順書の「連続 N バッチで 1 次通過候補ゼロ」打ち切り条件は廃止 (1 次フィルタを廃止したため)。

---

## 第 5 段階: 候補属性抽出 + 機械照合 (candidate_attribute_match_step)

第 4 段階で取得した 1 バッチ 50 件の候補について、Sonnet で 7 軸属性を抽出し、対象属性と機械照合して一致候補を絞る。

### 設計の背景

旧設計はコンタクトシート画像 (60 件×3 シート) を Sonnet に見せて「対象画像 vs シート画像」を 1 次フィルタしていた。しかし出品者が画像を意図的に変える慣習があるため、画像のテンプレ差で同一商品を取りこぼすケースが発生した (例: サングラス__120 のように、ウェリントン型偏光調光サングラスを同一商品としつつ画像のデコレーション・構図が完全に違うケース)。

新設計は **属性抽出 → 機械照合** に置き換える。Sonnet は対象画像と候補画像を「比較」するのではなく、それぞれを独立に見て「属性ラベル」を付ける。機械照合は文字列ベースで行うので、画像のテンプレ差に左右されない。

### 手順

#### 5-1. サムネ画像 DL

第 4 段階出力の各 item の `thumbnails[0]` を取得し、`cheapest-price-research/runs/<ts>/items/{商品番号}/thumbs/page_NN/{rank}.jpg` に保存 (rank 2 桁ゼロ埋め)。

bash + curl で並列 DL。50 件分。

```bash
# 例 (並列 10 で DL)
mkdir -p cheapest-price-research/runs/<ts>/items/{商品番号}/thumbs/page_NN
# rivals/page_NN.json から thumbnails[0] と rank を抽出して curl
```

#### 5-2. 候補属性抽出 (Sonnet)

Sonnet サブエージェント 1 体起動。

入力:
- バッチ 50 件のタイトル + サムネ画像 (1 件 1 枚)
- 対象商品の属性 (`target_attributes.json` の該当商品分) — 抽出基準のヒントとして渡す

プロンプト本文は `cheapest-price-research/prompts/candidate-attribute-extraction.md` を使う。

出力: `cheapest-price-research/runs/<ts>/items/{商品番号}/candidate_attributes/page_NN.json`

```json
{
  "page": 1,
  "extractedAt": "...",
  "productCode": "FD01101",
  "candidates": [
    {
      "rank": 1,
      "id": "m16332362187",
      "name": "キルティング トートバッグ ブラック A4対応 軽量 大容量 通勤 黒 通学",
      "price": 610,
      "attributes": {
        "category": "トートバッグ",
        "subcategory": "フォーマルサブバッグ",
        "color": ["黒"],
        "size": "A4",
        "quantity": "1個",
        "pattern": "無地",
        "material": "ポリエステル"
      },
      "reason": "画像でフラットな無地のサブバッグを確認。タイトルに「キルティング」とあるが画像優先で無地と判定。"
    }
  ]
}
```

#### 5-3. 機械照合 (Node スクリプト)

`cheapest-price-research/attribute-match-v2.js` を実行する。
**必ず `--exclude-id` に対象商品自身の item id (`target_detail/{商品番号}.json` の `id`) を渡すこと**
(検索結果には対象自身の出品が高頻度で混入し、除外しないと「最安値 = 自分の出品」という無意味な結果になる)。

```bash
node cheapest-price-research/attribute-match-v2.js \
  --target cheapest-price-research/runs/<ts>/target_attributes.json \
  --candidates cheapest-price-research/runs/<ts>/items/{商品番号}/candidate_attributes/page_NN.json \
  --product-code {商品番号} \
  --exclude-id {対象自身の item id} \
  --owner-id 116890565 \
  --rivals cheapest-price-research/runs/<ts>/items/{商品番号}/rivals/page_NN.json \
  --output cheapest-price-research/runs/<ts>/items/{商品番号}/matched_candidates/page_NN.json
```

**`--owner-id` と `--rivals` は必ず渡すこと** (物販オーナー自身の出品を分離するため。次節参照)。
`--owner-id` に渡す値は **`cheapest-price-research/config.json` の `mercariOwnerId`** を使う。

```json
{ "mercariOwnerId": "116890565" }
```

物販オーナーごとに値が違うので、**別のオーナーが本手順書を使う場合はこのファイルだけ差し替える**
(手順書やスクリプトは変更不要)。ID の調べ方はメルカリの自分のプロフィール URL の末尾の数字
(`https://jp.mercari.com/user/profile/【ここ】`)。空にすると own 判定を行わない。

照合ロジック (v2、2026_07_21_21_50 run の §8.3/§9.1 を受けた改訂):

- **比較前に決定的正規化**: NFKC / 小文字化 / 空白除去 / **括弧書き `(...)` 除去** / `約`・`およそ` 除去
- 軸別ルール:
  - `category` / `subcategory` / `pattern`: 正規化後の等価、または **包含一致** (片方が他方を含めば一致)
  - `size`: 数値を抽出し **±10% 以内なら一致** (公称値 vs 実測値の差を吸収)。範囲表記 (`22.2-31.8mm`) は包含判定。フリーサイズは unknown 扱い
  - `quantity`: 数値で比較 (単位語 1点/1個/1枚 の差は無視)
  - `color`: 同義語テーブル (黒=ブラック等) を通してから配列重なり判定
  - `material`: **棄却軸から除外** (参考情報として `advisory_mismatch_axes` に記録のみ)
- unknown (null / `[]`) は従来どおり「通す」
- 出力は **4 値**:

| 区分 | 条件 | 扱い |
|---|---|---|
| `matched` | 全 hard 軸一致 | **near_miss と混ぜて価格昇順**に並べ第 6 段階へ |
| `near_miss` | 1 軸のみ不一致 | 同上 (**matched より後回しにはしない**。5-4 参照) |
| `insufficient` | 候補側の判明軸が 2 以下 | 原則第 6 段階に送らない (全 null 素通り事故の防止)。matched / near_miss とも空のときのみ親の判断で先頭 1 件まで確認可 |
| `rejected` | 2 軸以上不一致 | 対象外 |
| `own` | **出品者が物販オーナー自身** | 第 6 段階に送らない。report に「あなた自身の出品」として別枠表示 |

#### own (物販オーナー自身の出品) の扱い

検索結果には **物販オーナー自身の再出品が混入する**。メルカリは削除→再出品で item id が変わるため、
`--exclude-id` (対象自身の id を除外) では捕捉できない。出品者 ID で判定する必要がある。

**判定対象からは外すが、情報としては残す** (除外ではなく区別):

- **なぜ判定対象から外すか**: 検索は価格昇順で、第 6 段階は「最初に `sameProduct=true` が出たら打ち切り」。
  自分の再出品が先に true になると、**そこで打ち切られて他人の最安が分からないまま終わる**
- **なぜ捨てないか**: 「自分が今いくらで再出品しているか」は値付けの材料になる。
  実例 (2026_07_21_21_50 run): FD08001 で「最安ライバル ¥598 (差 -201)」と報告したが、
  画像が完全一致しており**自分の再出品を値下げしたもの**だった可能性が高い。
  これを「競合が 201 円安い」と読むと、下げる必要のない値下げをしてしまう

`rivals/page_NN.json` に `sellerId` が保存されていない run では own 判定ができない。
その場合 report.json の `ownDetectionAvailable` が `false` になり、HTML の冒頭に警告が出る。

出力: `cheapest-price-research/runs/<ts>/items/{商品番号}/matched_candidates/page_NN.json`

```json
{
  "page": 1,
  "productCode": "FD01101",
  "matcherVersion": 2,
  "excludedSelf": "m39658698781",
  "matched": [
    { "rank": 6, "id": "m37040454091", "price": 1080, "mismatch_axes": [], "advisory_mismatch_axes": [], "filled_axes": 5 }
  ],
  "near_miss": [
    { "rank": 12, "id": "m...", "price": 1150, "mismatch_axes": ["size"], "advisory_mismatch_axes": [], "filled_axes": 4 }
  ],
  "insufficient": [
    { "rank": 4, "id": "m...", "price": 1000, "mismatch_axes": [], "advisory_mismatch_axes": [], "filled_axes": 0 }
  ],
  "rejected": [
    { "rank": 1, "id": "m16332362187", "price": 610, "mismatch_axes": ["color", "pattern"], "advisory_mismatch_axes": ["material"], "filled_axes": 6 }
  ]
}
```

旧 `attribute-match.js` (v1、完全一致比較) は監査可能性のため不変で残す。過去 run (2026_07_21_21_50 以前) の再現には v1 を使う。

#### 5-4. 検証 + 分岐

**判定対象は `matched[]` と `near_miss[]` を混ぜて価格昇順に並べたもの** とする。

```
判定対象 = sort_by_price(matched[] + near_miss[])
```

- 1 件以上 → 第 6 段階 (画像最終確認) へ。**価格の安い順**に処理する
- 空 → 第 4 段階 (a) に戻り次バッチ (page+1) を取得
  (`insufficient` のみが残る場合、親の判断で先頭 1 件を第 6 段階に送ってもよいが、その旨を run_notes に記録する)

**⚠ matched を near_miss より優先してはならない** (2026_07_26_07_46 run で発覚した設計ミス)。

旧規定は「`matched` を見る。空なら `near_miss` を見る」だったため、
**matched に候補がある限り near_miss は価格が安くても一度も見られなかった**。
実例: FD07101 で matched ¥498 / near_miss ¥450 となり、安い ¥450 を飛ばして
¥498 を最安として報告した (この件は ¥450 が色違いの別商品だったため結果は正しかったが、
「サイズ表記だけ違う同一商品」だった場合は取りこぼしていた)。

価格昇順に統一すれば「**当たりが出た時点で、それより安い候補は全て確認済み**」が保証され、
報告する最安価格が真の最安であることが担保される。

### Agent 起動原則

冒頭「## Agent 運用の共通原則」を踏襲 (並列禁止、バッチ逐次保存、SendMessage 復帰、Agent 01 直後のスポットチェック等)。

---

## 第 6 段階: 画像最終確認 (image_final_confirmation_step)

第 5 段階の機械照合で残った候補について、価格昇順先頭から順に「**対象画像 vs 候補画像**」を Sonnet が並べて見て、最終的に同一商品か確認する。

### 目的

機械照合で残った候補は 7 軸属性が target と一致しているが、それでも別物の可能性がある (タイトル盛り盛りで属性が同じに見えるが実物は別物、属性抽出 Agent の判定誤りなど)。最終的に画像 1 対 1 で Sonnet が確認することでこれを救う。

### 入出力

| | 内容 |
|---|---|
| 入力 | `cheapest-price-research/runs/<ts>/items/{商品番号}/matched_candidates/page_NN.json` の `matched[]` + `near_miss[]` を**価格昇順**に並べたもの |
| 入力 | `cheapest-price-research/runs/<ts>/target_images/{商品番号}/photo_N.jpg` (対象画像 全枚数) |
| 入力 | items/get で取得する候補詳細 + 候補画像 (全枚数) |
| 出力 | `cheapest-price-research/runs/<ts>/items/{商品番号}/candidate_detail/{id}.json` (候補ごと、不変) |
| 出力 | `cheapest-price-research/runs/<ts>/items/{商品番号}/candidate_images/{id}/photo_N.jpg` (photos 全枚数) |
| 出力 | `cheapest-price-research/runs/<ts>/items/{商品番号}/final_judgment/{id}.json` (候補ごと、不変) |

### 判定回数の上限 (2026_07_21_21_50 run §11.2 の正式化)

1 商品あたりの画像最終確認は **最大 3 候補** まで。判定する候補の選定順:

1. `matched[]` + `near_miss[]` を混ぜた価格昇順の先頭 (分類より価格を優先する)
2. 同額の候補が並ぶ場合は、第 5 段階の Agent が「最有力」と評価したものを優先
3. 3 件目は可能なら価格帯の異なるクラスタから選ぶ (同一出品者グループの偏りを避ける)

3 件すべて false の場合、その false 理由に **一貫した構造的不一致パターン** があれば no_match として次商品へ進む
(候補が多い商品では上位候補が同額に密集することが多く、どれが一致しても報告する最安価格は変わらないため、
全件判定は時間に見合わない。4 件目以降に一致があった場合のリスクは run_notes に「上限到達で no_match」と明記して
朝の手動確認に委ねる)。パターンが一貫しない場合のみ、親の判断で 1〜2 件追加してよい。

### 手順

1. `matched_candidates/page_NN.json` の `matched[]` と `near_miss[]` を**混ぜて価格昇順に並べ**、安い順に処理する (分類で優先順位を付けない。5-4 の ⚠ 参照)
2. 最先頭の候補について:
   - **items/get で候補詳細を 1 件取得**し、`candidate_detail/{id}.json` に保存 (`mercari-item-detail.js` の単発呼び出し)
   - `data.photos[]` 全枚数を `candidate_images/{id}/photo_N.jpg` に curl で DL
   - Sonnet サブエージェント 1 体起動 (`prompts/final-judgment.md` を使う)
3. Sonnet の出力 (`final_judgment/{id}.json`):

```json
{
  "candidateId": "m37040454091",
  "candidateRank": 6,
  "candidatePrice": 1080,
  "candidateUrl": "https://jp.mercari.com/item/m37040454091",
  "sameProduct": true,
  "reason": "対象と候補で構図・素材・キャラクター付属物まで一致。全画像で齟齬なし。"
}
```

4. 分岐:
   - `sameProduct=true` → 最安値確定、`result.json` に matched 書き出し、商品ループ終了
   - `sameProduct=false` → 同バッチ次の候補で 2 に戻る
   - バッチ内全候補 false → 第 4 段階に戻り次バッチへ

### Sonnet プロンプトに含めるべき要素

- 絶対禁則
- タスク: 機械照合で残った候補と対象が同一商品か、画像 (target + candidate の全画像) で最終確認
- 画像優先の原則
- 入力: 対象画像 全枚数 + 候補画像 全枚数 + **対象の `attributes_detail` (第 3 段階が抽出した識別ポイント)**
- 同一商品で先に false が出ている場合は、その false 理由 (確認済みの識別ポイント) を申し送る
- 出力: `sameProduct` (bool) と `reason` (1〜3 文)

### `result.json` 書き出し

matched 確定時:

```json
{
  "productCode": "FD01101",
  "status": "matched",
  "cheapest": {
    "id": "m37040454091",
    "rank": 6,
    "page": 1,
    "price": 1080,
    "url": "https://jp.mercari.com/item/m37040454091",
    "title": "..."
  },
  "reason": "対象と候補で構図・素材・キャラクター付属物まで一致。",
  "pagesScanned": 1,
  "totalCandidatesAfterAttributeMatch": 5,
  "totalCandidatesJudgedInFinalStep": 1
}
```

打ち切り時は 2 種類に分かれる。**`totalCandidatesJudgedInFinalStep` が 0 かどうかで機械的に決まる。**

**(a) `no_match`** — 候補を判定した結果、全て別商品だった (市場に同型が無いという結論):

```json
{
  "productCode": "FD01101",
  "status": "no_match",
  "reason": "判定した 3 件が全て別商品。候補群は「ひし形キルティング+靴収納」で共通し、対象の「横畝ダウン調キルト+単室」とは構造が一貫して異なる",
  "keyword": "ボストンバッグ キルティング 黒",
  "pagesScanned": 2,
  "totalCandidatesAfterAttributeMatch": 8,
  "totalCandidatesJudgedInFinalStep": 3
}
```

**(b) `no_candidates`** — 判定に送れる候補が 1 件も作れなかった (調査未完了):

```json
{
  "productCode": "FE08501",
  "status": "no_candidates",
  "reason": "候補 27 件は全てグリップテープ・キーホルダー等の周辺小物で、実物の卓球ラケットセットが 0 件。キーワードが母集団を作れていない",
  "keyword": "卓球ラケット セット",
  "pagesScanned": 2,
  "totalCandidatesAfterAttributeMatch": 0,
  "totalCandidatesJudgedInFinalStep": 0
}
```

`reason` には**打ち切り条件そのもの**ではなく「**何が集まって、なぜ違ったのか**」を書く。
「5 バッチ取得しても見つからなかった」だけでは、次に何をすべきか判断できない。

出力先: `cheapest-price-research/runs/<ts>/items/{商品番号}/result.json`

---

## 第 7 段階: 最安値抽出 + レポート化 (cheapest_export_step)

## 🎯 この段階の成果物は HTML である

**物販オーナーに提示する最終成果物は `最安値リサーチ_<ts>.html` の 1 ファイルである。**
物販オーナーはこの HTML をブラウザで開き、出品価格を決める。**CSV は生成しない** (廃止)。

成果物までの流れは 2 本のスクリプトで完結する。**手作業で HTML を組んではならない。**

```
run ディレクトリの中間成果物 (result.json / rivals / final_judgment / 画像 …)
  ↓ node cheapest-price-research/build-report.js <run ディレクトリ>
report.json                          ← run 固有の成果物データ (機械が読む正本)
  ↓ node cheapest-price-research/render-report.js <run ディレクトリ>
最安値リサーチ_<ts>.html + report_html_img/   ← 物販オーナーへの成果物
```

### 入出力

| | 内容 |
|---|---|
| 入力 | `runs/<ts>/` 配下の中間成果物すべて (source.csv / target_detail / target_images / keywords.csv / target_attributes.json / items/*/rivals / items/*/matched_candidates / items/*/final_judgment / items/*/candidate_images / items/*/result.json) |
| 中間出力 | `runs/<ts>/report.json` — **この run 固有の成果物データ**。HTML 生成に必要な全情報を含む |
| **最終出力** | `runs/<ts>/最安値リサーチ_<ts>.html` — **物販オーナーへの成果物** |
| 付随出力 | `runs/<ts>/report_html_img/` — HTML が参照する画像 (自動コピー) |

### 手順

```bash
# 1. 中間成果物を集約して report.json を作る
node cheapest-price-research/build-report.js cheapest-price-research/runs/<ts>

# 2. report.json から HTML を生成する (画像コピーも自動)
node cheapest-price-research/render-report.js cheapest-price-research/runs/<ts>
```

どちらも stdout に件数サマリ (total / matched / no_match / no_candidates / error) を出す。
親 Cowork はこの数値が `items/*/result.json` の実数と一致することを確認する。

**ステータスの振り分けは build-report.js が機械的に行う**:
`result.json` の status が `no_match` かつ画像最終確認の実施件数が 0 件なら `no_candidates` に補正する
(冒頭「## 出力 > ステータスの定義」参照)。親が手で判断してはならない。

### report.json の構造 (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "runId": "2026_07_26_07_46",
  "generatedAt": "2026-07-26T22:58:00+09:00",
  "summary": { "total": 14, "matched": 8, "no_match": 3, "no_candidates": 3, "error": 0 },
  "products": [
    {
      "code": "FD08701",
      "status": "matched",
      "target": {
        "name": "...", "price": 998, "url": "...", "id": "m87178471048",
        "photos": ["target_images/FD08701/photo_1.jpg", "..."],
        "attributes": { "category": "...", "...": "..." },
        "attributesLine": "自転車ベル / リング型ステルスベル / 黒 / ...",
        "attributesDetail": "...", "attributesReason": "..."
      },
      "search": {
        "keyword": "自転車ベル", "plannedKeyword": "自転車ベル ステルス 31.8mm",
        "rejectedKeyword": "", "candidateCount": 43, "pagesScanned": 1, "url": "https://..."
      },
      "machine": { "matched": 1, "near_miss": 10, "insufficient": 1, "rejected": 31 },
      "judged": [
        { "id": "m...", "name": "...", "price": 300, "rank": 4, "url": "...",
          "sameProduct": false, "reason": "...", "thumb": "items/FD08701/..." }
      ],
      "reason": "同一商品と判定した理由 / 見つからなかった理由",
      "cheapest": {
        "id": "m40652156816", "name": "...", "price": 400, "url": "...",
        "photos": ["..."], "priceDiff": -598,
        "verifyUrl": "https://jp.mercari.com/search?...&price_max=399&...",
        "verifyPriceMax": 399
      }
    }
  ]
}
```

画像パスは **run ディレクトリからの相対パス**で持つ。render-report.js が
`report_html_img/` にコピーして HTML から参照できる形に書き換える。

### HTML の内容 (render-report.js が生成)

- 冒頭に「**この HTML が成果物です**」の案内と使い方
- タブ 2 つ: `同一商品が見つかった` / `見つからなかった`
- matched タブ先頭に**価格差の大きい順の一覧表** (行クリックで該当カードへジャンプ)
- 各カードは 2 カラム (自分の商品 / ライバル) + **左右独立のカルーセル** (◀▶送り + サムネイル)
- 属性は 1 行表示、同一判定の理由、画像確認した候補の一覧 (画像・価格・◯×・商品リンク・理由)
- **「これより安い出品が無いか確認」ボタン** = 最安価格−1 円を上限にした検索。
  押して同一商品が出てこなければその価格が最安で確定、という確認手段
- 検索した語をボタン直下に表示。検索の履歴 (緩めた経緯・候補件数等) はカード最下部に小さく
- `見つからなかった` タブは `市場に同型なし` と `調べられていない` を明確に区別して表示

**HTML の見た目を変えたい場合は `render-report.js` を修正する。**
生成済み HTML を手で編集してはならない (次の run で再現できなくなる)

### 物販オーナーへの報告フォーマット

**必ず `mcp__cowork__present_files` で HTML ファイルを提示する** (パスを文章で書くだけにしない)。

```
最安値リサーチ完了 (N 件、所要 約X時間Y分)。

[最安値リサーチ_<ts>.html を present_files で提示]

同一商品が見つかった: M 件
- うち自分より安いライバルがいた: K 件 (最大 -¥C、FDxxxxx)
- 同額: L 件 / 自分のほうが安い: J 件

見つからなかった: N 件
- 市場に同型なし (競合不在): P 件 → 価格を維持できます
- 調べられていない (キーワード不一致): Q 件 → 再調査の価値があります: FDxxxxx, FDxxxxx

特記すべき商品:
- FDxxxxx は自分 ¥A に対しライバル最安 ¥B、差 -¥C

HTML の使い方: 「同一商品が見つかった」タブの一覧表で価格差の大きい商品から見て、
画像を見比べて納得できたらその最安価格を値付けに使ってください。
「これより安い出品が無いか確認」ボタンを押して同一商品が出てこなければ、その価格が最安で確定です。
```

`調べられていない` (no_candidates) がある場合は、**商品番号を必ず列挙する**。
物販オーナーが「再調査すべき商品」を判断できるようにするため
(前 run で `no_match` と一括りにしたため、調査不要な商品まで再調査する判断につながった)。
```

---

## 全体実行のオーケストレーション

親 Cowork セッションが以下のループを回す:

```
0. 物販オーナーから 20 件分のマスター CSV パスを受け取る
   <ts> 採番 (JST date '+%Y_%m_%d_%H_%M')
   cheapest-price-research/runs/<ts>/ 作成
   入力 CSV を source.csv にコピー
↓
1. items/get API バッチ (20 件の URL を一括 fetch)
   → target_detail/{商品番号}.json (全 20 商品)
   → target_images/{商品番号}/photo_N.jpg (全 20 商品、photos 全枚数を curl で DL)
↓
2. Sonnet サブエージェント 1 体起動 (キーワード生成)
   → keywords.csv
↓
3. Sonnet サブエージェント 1 体起動 (対象属性抽出)
   → target_attributes.json
↓
keywords.csv の各商品について順次 (20 商品):
  - 第 4〜6 段階のループ (1 商品ぶん):
      page = 1
      while page <= 5:
        第 4 段階: rivals/page_NN.json (検索 API 50 件)
        if hasNext=false かつ items が空または不十分:
          break (no_match で次商品へ)
        第 5 段階 5-1: サムネ DL (50 枚)
        第 5 段階 5-2: 候補属性抽出 (Sonnet 1 体)
                       → candidate_attributes/page_NN.json
        第 5 段階 5-3: 機械照合 (attribute-match-v2.js、--exclude-id 付き)
                       → matched_candidates/page_NN.json (matched/near_miss/insufficient/rejected の 4 値)
        判定対象 = matched[] + near_miss[] を混ぜて価格昇順にソート
        if 判定対象が空: page += 1; continue
        for cand in 判定対象 (価格昇順、1 商品通算 最大 3 候補まで):
          第 6 段階: items/get で候補詳細取得
                     → candidate_detail/{id}.json + candidate_images/{id}/photo_N.jpg
          第 6 段階: Sonnet 1 体 (画像最終確認、対象の attributes_detail を渡す)
                     → final_judgment/{id}.json
          if sameProduct=true: result.json (matched); break (商品ループ脱出)
        if matched 確定: break
        if 判定 3 候補到達 かつ false 理由が一貫: result.json (no_match); break
        page += 1
      if not matched: result.json (no_match)
↓
7. build-report.js → report.json → render-report.js → 最安値リサーチ_<ts>.html (成果物)
   run_notes.md
   物販オーナーへ報告
```

---

## 規模感 (1 日 20 件)

| 段階 | 所要 (目安) | Sonnet 体数 |
|---|---|---|
| 0. 準備 + DPoP セッション確立 | 1 分 | 0 |
| 1. 対象詳細取得 + photos 全枚数 DL | 1〜2 分 (API 並列 10) | 0 |
| 2. キーワード生成 | 2-3 分 | 1 |
| 3. 対象属性抽出 | 2-3 分 | 1 |
| 4〜6. 最安値探索ループ (20 件) | 60-90 分 | 20-100 (商品依存) |
| 7. レポート + run_notes | 5 分 | 0 |
| **合計** | **約 1.5〜2 時間** | **約 22〜102 体** |

Sonnet 体数の内訳 (1 商品あたり):
- 候補属性抽出: 1〜5 体 (バッチごと、平均 1〜2 で matched 確定)
- 画像最終確認: 1〜N 体 (matched 候補のうち sameProduct=true が出るまで、平均 1〜3 で確定)

20 商品 × 平均 4 体 = 約 80 体が標準的なレンジ。

1 セッションで完走できる規模 (Cowork の 1M context + Opus 4.7 想定)。中断する場合は再開せず新 run で全 20 件をやり直す前提。

---

## 関連既存資産

| パス | 役割 | 本手順での参照段階 |
|---|---|---|
| `cheapest-price-research/mercari-item-detail.js` | items/get API batch 取得 | 第 1 / 第 6 段階 |
| `cheapest-price-research/cheapest-price-search.js` | 検索 API batch 取得 | 第 4 段階 |
| `cheapest-price-research/config.json` | **物販オーナー固有の設定** (メルカリ出品者ID)。オーナーが変わったらここだけ差し替える | 第 5 段階 5-3 / 第 7 段階 |
| `cheapest-price-research/build-report.js` | 中間成果物を集約して report.json を生成 (Node CLI) | 第 7 段階 |
| `cheapest-price-research/render-report.js` | report.json から**成果物 HTML** を生成 (Node CLI) | 第 7 段階 |
| `cheapest-price-research/attribute-match-v2.js` | 7 軸機械照合 v2 (正規化+近似比較+4値出力、Node CLI) | 第 5 段階 5-3 (**現行**) |
| `cheapest-price-research/attribute-match.js` | 7 軸機械照合 v1 (完全一致比較) | 過去 run (2026_07_21_21_50 以前) の再現用。新規 run では使わない |
| `cheapest-price-research/prompts/keyword-generation.md` | キーワード生成プロンプト | 第 2 段階 |
| `cheapest-price-research/prompts/target-attribute-extraction.md` | 対象属性抽出プロンプト | 第 3 段階 |
| `cheapest-price-research/prompts/candidate-attribute-extraction.md` | 候補属性抽出プロンプト | 第 5 段階 5-2 |
| `cheapest-price-research/prompts/final-judgment.md` | 画像最終確認プロンプト | 第 6 段階 |
| `docs/research/mercari/judgment_examples/` | 同一商品判定の実例集 | 第 3 / 第 5 / 第 6 段階 |
| `procedures/listing-cowork.md` | 出品手順 (本手順書の後段) | 連携 |
