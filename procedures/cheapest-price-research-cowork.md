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

CSV (UTF-8、BOM 付き): `cheapest-price-research/runs/<ts>/report.csv`

列定義:

| 列 | 内容 |
|---|---|
| 商品番号 | 入力 CSV の `商品番号` |
| 対象URL | 入力 CSV の `メルカリURL` |
| 対象価格 | 対象商品の現在価格 (円) |
| 最安URL | 同一商品の最安値出品 URL |
| 最安価格 | 同一商品の最安値 (円) |
| 価格差 | `最安価格 - 対象価格` (負なら対象が高い) |
| 同一判定理由 | 最終判定 (第 6 段階) の `reason` 文字列 |
| ステータス | `matched` (同一商品あり) / `no_match` (連続ゼロ閾値または絶対上限に到達) / `error` |

このレポートを物販オーナーが見て、出品 CSV の `価格` 列に手書きで反映する。

## 同一商品判定の前提

メルカリの中国輸入品は、出品者が他出品者通報リスクを避けるためタイトル・画像・説明文を意図的に変えて出品する慣習がある。よって「タイトル文字列の一致」ではなく **実体属性 (色・サイズ・個数・セット数・柄・素材・用途) の一致** で同一商品を判定する。

別商品扱いになる軸 (一般則):

| 軸 | 例 |
|---|---|
| 色 | 白 / 黒 / ベージュ / ブラウン / シルバー / ゴールド 等 |
| サイズ | S / M / L / XL、A3 / A4 / B4、80×120、25cm 等 |
| 個数・セット数・容量 | 2個セット / 5枚セット / 100枚 / 500g 等 |
| 柄 | 無地 / 花柄 / チェック / 迷彩 等 |
| 素材 | 本革 / 合皮 / ナイロン / ポリエステル 等 |
| 用途・機能 | ショルダーバッグ / トートバッグ / クラッチバッグ 等 |

実例集: [`docs/research/mercari/judgment_examples/`](../docs/research/mercari/judgment_examples/) を必ず参照する (判定例ファイルが無い軸でも上表の一般則は適用)。

## 出力ファイルの共通原則

### 原則 1: 一度書き出したら更新禁止 (不変)

本手順書の各段階が書き出す成果物 (`cheapest-price-research/runs/<ts>/` 配下全て、および `cheapest-price-research/runs/<ts>/report.csv`) は全て不変とする。

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

Sonnet Agent を起動する全工程 (第 2 段階キーワード生成 / 第 4 段階 1 次フィルタ / 第 6 段階最終判定) は本原則に従う。Cowork は Opus 4.7 [1m] 親セッションから Sonnet サブエージェントを `subagent_type=general-purpose, model=sonnet` で起動できる (検証済み)。

### 原則 1: 1 Agent あたりの担当数

| 段階 | 1 Agent の担当 | 並列 |
|---|---|---|
| 第 2 段階 キーワード生成 | 20 件 (1 Agent で全件、1 chunk) | - |
| 第 4 段階 1 次フィルタ | 1 シート = 最大 20 件 (1 商品 1 バッチあたり最大 3 Agent、順次起動) | 禁止 |
| 第 6 段階 最終判定 | 1 候補 (順次起動、`sameProduct=true` でループ早期終了) | 禁止 |

並列起動は禁止 (使用量制限を一気に消費するため)。

### 原則 2: バッチ逐次保存 (中断耐性の要)

Agent プロンプトには **「1 結果完了ごとに即 Write、まとめて一括書き出しは禁止」** を必ず明記する。併せて **なぜ逐次保存が必要か (中断で判定がロストする、親は書き出されたファイルしか見ない)** を Agent 自身に理由として伝える。これを書かないと、Agent が効率化の名目で「まとめて書く」判断をしかねない。

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
| 第 4 段階 1 次フィルタ | シート 1 の結果を実物画像と照合 (明らかな別商品が混入していないか、明らかな同一商品を取りこぼしていないか) |
| 第 6 段階 最終判定 | 最初の判定の `reason` を確認 (判定根拠が空・形式不備でないか、判定軸を実際に照合しているか) |

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
- 手順書 / スクリプト / プロンプト雛形の改善候補を蓄積する (実運用で発覚した問題は次 run までに本手順書へ反映するか、次 run でも対処できるようにする)
- 過去 run との件数比較で母集団変化・プロンプト変更の影響を追跡する

### 書くタイミング

- 各段階完了時に追記する (記憶が新しいうち)
- run 完了時に最終整理する (件数フロー表・スケジュール・反映候補等)

### 書く内容 (最低限)

1. **この run の位置づけ**: run_id (`<ts>`)、目的、対象データ (入力 CSV のパス・件数 = 20)、進捗状況、前 run との関係
2. **件数フロー実績**: 各段階の入力 → 出力件数の表 (商品数 / 1 次通過候補数 / 最終 matched 件数 / no_match 件数。前 run との比較を含めると尚良)
3. **手順書記載からの逸脱点**: 実運用で調整した部分、その背景・対処・教訓
4. **新規発覚した問題と対処**: バグ・運用ミス・想定外の挙動 (発覚 → 検証 → 対処 → 以降の運用変更 → 教訓)
5. **実行スケジュール**: 各段階の開始・完了時刻 (JST)
6. **手順書への反映候補**: 次 run までに本手順書 / スクリプト / プロンプト雛形に反映すべき項目
7. **ファイル参照クイックリンク**: 主要出力ファイル (`source.csv` / `keywords.csv` / `target_detail/` / 代表的な `items/{商品番号}/result.json` / `report.csv`) へのリンク

### 書き方

- **独立して読めるように書く**。コンテキスト (これまでのセッション履歴) がない前提で理解できるようにする
- 節タイトル (`## 1.`、`### 3.1` のように番号付き) で構造化し、項目間で参照しやすくする
- 過去 run の `run_notes.md` と相互リンクを貼る
- 件数・時刻・Agent 数・kept 数 等の具体的な数値を記録する (主観的感想は控え、事実と教訓を中心に書く)
- 検証スクリプトを書いた場合はそのままコードブロックで貼る (次 run で再利用しやすい)

---

## プレースホルダ規約

本手順書のパス記述で使うプレースホルダの形式:

| プレースホルダ | フォーマット | 例 | 出所 |
|---|---|---|---|
| `<ts>` | `YYYY_MM_DD_HH_MM` (JST) | `2026_05_27_09_00` | run 開始時の JST 時刻。一度決めたら同セッション中は変えない |
| `{商品番号}` | 入力 CSV の `商品番号` 列の値そのまま | `FD02701` | 入力 CSV |
| `{id}` | Mercari item id (`m` + 数字 11 桁) | `m92167660103` | Mercari API レスポンスの `item.id` |
| `page_NN` | `page_` + 2 桁ゼロ埋め | `page_01`, ..., `page_05` | 第 3 段階のバッチ番号 (1〜5、絶対上限 5) |
| `sheet_M` | `sheet_` + 1 桁 | `sheet_1`, `sheet_2`, `sheet_3` | 第 4 段階のシート番号 (1〜3、最大) |
| `{rank}` | 2 桁ゼロ埋め | `01`〜`60` | 同バッチ内の価格昇順順位 (1〜60、itemBrand 除外後) |

---

## ディレクトリ構成

```
reselling/
├── cheapest-price-research/                          # 本手順書の専用ディレクトリ
│   ├── cheapest-price-search.js                      #   検索 API (javascript_tool 用)
│   ├── contact-sheet-builder.py                      #   コンタクトシート生成 (Python + Pillow)
│   ├── mercari-item-detail.js                        #   商品詳細 (javascript_tool 用)
│   ├── download-thumbnails.js                        #   サムネ並列 DL (Node CLI)
│   ├── run-python.sh                                 #   Python ラッパー (macOS/Linux 吸収)
│   ├── prompts/
│   │   ├── keyword-generation.md                     #   第 2 段階 プロンプト
│   │   ├── primary-filter.md                         #   第 4 段階 プロンプト
│   │   └── final-judgment.md                         #   第 6 段階 プロンプト
│   └── runs/
│       └── <ts>/                                     #   1 セッション = 1 run (例: 2026_05_27_09_00)
│           ├── source.csv                            #     物販オーナー提供の 20 件マスター CSV (不変)
│           ├── keywords.csv                          #     第 2 段階出力 (4 列、不変)
│           ├── target_detail/
│           │   └── {商品番号}.json                   #     第 1 段階出力 (商品ごと、不変)
│           ├── target_images/
│           │   └── {商品番号}/
│           │       └── photo_1.jpg                   #     第 1 段階で DL した対象画像 (photos[0])
│           ├── items/
│           │   └── {商品番号}/
│           │       ├── rivals/
│           │       │   └── page_NN.json              #     第 3 段階出力 (バッチごと、不変)
│           │       ├── thumbs/
│           │       │   └── page_NN/{rank}.jpg        #     サムネ DL
│           │       ├── sheets/
│           │       │   └── page_NN_sheet_M.png       #     第 4 段階入力 (コンタクトシート)
│           │       ├── primary_filter/
│           │       │   └── page_NN.json              #     第 4 段階出力 (1 次通過候補)
│           │       ├── candidate_detail/
│           │       │   └── {id}.json                 #     第 5 段階出力 (候補詳細、不変)
│           │       ├── candidate_images/
│           │       │   └── {id}/photo_1.jpg          #     第 5 段階で DL した候補画像
│           │       ├── final_judgment/
│           │       │   └── {id}.json                 #     第 6 段階出力 (判定結果、不変)
│           │       └── result.json                   #     最終結果 (最安値 1 件 or no_match)
│           ├── report.csv                            #   第 7 段階出力 (物販オーナーへの提示物、UTF-8 BOM 付き)
│           └── run_notes.md                          #   本 run の実行結果・気づき・逸脱点
│
├── procedures/cheapest-price-research-cowork.md      # 本手順書
└── listings/runs/YYYY_MM_DD/                         # 出品手順 (listing-cowork.md) で使う、最安値リサーチの後段
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

実装スクリプトは Claude Code と同じ `cheapest-price-research/*.js` を使う (動作確認済み)。

### Python 実行 (`run-python.sh`)

`contact-sheet-builder.py` (Python + Pillow) はラッパー経由で起動:

```bash
cheapest-price-research/run-python.sh cheapest-price-research/contact-sheet-builder.py \
  --thumbs-dir cheapest-price-research/runs/<ts>/items/{商品番号}/thumbs/page_01 \
  --rivals-json cheapest-price-research/runs/<ts>/items/{商品番号}/rivals/page_01.json \
  --output-dir cheapest-price-research/runs/<ts>/items/{商品番号}/sheets \
  --page 1
```

Cowork サンドボックスは Linux + system Python 3.10 + Pillow 12.1 がプリインストール済み。ラッパーが自動で system python3 を選ぶ。

ローカル macOS では `.venv` が必要 (本実装の補足):

```bash
python3 -m venv cheapest-price-research/.venv
cheapest-price-research/.venv/bin/pip install -r cheapest-price-research/requirements.txt
```

ただし Cowork サンドボックス内では venv 不要。

---

## 全体フロー

```
0. セッション準備
   - 物販オーナーから 20 件分のマスター CSV を受け取る (パスをチャットで指定してもらう)
   - <ts> 採番 (JST `YYYY_MM_DD_HH_MM`)
   - cheapest-price-research/runs/<ts>/ 作成、マスター CSV を source.csv にコピー
   - https://jp.mercari.com に Chrome でアクセス済み確認 (DPoP セッション確立)
↓
1. 対象商品 詳細取得 (target_detail_fetch_step)
   - items/get API batch で 20 件の target_detail を取得
   - 各商品の photos[0] を curl で target_images/{商品番号}/photo_1.jpg に保存
     ↓ target_detail/{商品番号}.json (20 ファイル)
     ↓ target_images/{商品番号}/photo_1.jpg (20 ファイル)
↓
2. キーワード生成 (keyword_generation_step)
   - Sonnet サブエージェント 1 体起動
   - 入力: target_detail/ + target_images/ (実物データ)
   - 出力: keywords.csv (商品番号→検索キーワード、4 列)
   - Agent 01 完了直後にスポットチェック (5〜10 件)
↓
3〜6. 最安値探索ループ (商品ごと、順次)
     1 商品の流れ:
       (a) 検索 API でバッチ取得 (価格昇順 60 件)             [第 3 段階]
            ↓
       (b) コンタクトシート 1 次フィルタ (最大 3 シート)      [第 4 段階]
            ↓
       (c) 1 次通過候補を価格昇順で詳細取得                  [第 5 段階]
            ↓
       (d) 対象詳細 vs 候補詳細 で同一商品判定               [第 6 段階]
            ↓
       (e) 判定結果による分岐:
            sameProduct=true  → そのまま最安値確定 → 次の商品へ
            sameProduct=false → 次の候補へ ((c) に戻る)
            全候補 false     → 次バッチへ ((a) に戻る、page+1)
       (f) 打ち切り条件:
            連続 3 バッチで 1 次通過候補がゼロ → no_match で次の商品へ
            5 バッチ取得しても確定しない (絶対上限 300 件) → no_match で次の商品へ
            すぐ hasNext=false で次バッチが無い → no_match で次の商品へ
     ↓ cheapest-price-research/runs/<ts>/items/{商品番号}/result.json (20 ファイル)
↓
7. 最安値抽出 + レポート化 (cheapest_export_step)
   - 20 件の result.json を集約
   - cheapest-price-research/runs/<ts>/report.csv (UTF-8 BOM 付き、8 列)
   - run_notes.md を書く
   - 物販オーナーへ報告 (report.csv のパス + サマリ)
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
| 出力 | `cheapest-price-research/runs/<ts>/target_images/{商品番号}/photo_1.jpg` (photos[0] のローカル DL、第 2 / 第 4 / 第 6 段階で使用) |

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
| `seller` | 出品者情報 `{ id, name, num_sell_items, ratings, ... }` |
| `item_condition` | 商品の状態 `{ id, name }` (例: `{ id: 1, name: "新品、未使用" }`) |
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
// 入力 (window.__ITEM_DETAIL_INPUT__ を javascript_tool でセット)
window.__ITEM_DETAIL_INPUT__ = {
  items: [
    { productCode: "FD00101", itemId: "m92167660103" },
    { productCode: "FD00301", itemId: "m85899014828" },
    // ... 入力 CSV 全 20 件 (URL からの itemId 抽出は呼び出し側で行う)
  ]
};
```

`mercari-item-detail.js` を javascript_tool で実行。内部で **10 並列** fetch。

戻り値:

```json
{
  "fetchedAt": "...",
  "total": 20,
  "succeeded": 19,
  "failed": 1,
  "results": [
    { "productCode": "FD00101", "itemId": "m...", "status": "ok",
      "http": 200, "data": { /* items/get の data フィールド全体 */ } },
    { "productCode": "FD00...", "itemId": "m...", "status": "error",
      "http": 404, "error": "..." }
  ]
}
```

#### 1-3. 結果を商品ごとに分割保存

戻り値の `results[]` を商品ごとに `cheapest-price-research/runs/<ts>/target_detail/{商品番号}.json` に書き出す (各ファイルには `data` フィールド本体を保存)。

#### 1-4. 対象画像 photos[0] をローカル DL

各商品の `data.photos[0]` URL を `bash` + `curl` で `cheapest-price-research/runs/<ts>/target_images/{商品番号}/photo_1.jpg` に保存。後段の第 2 段階 (キーワード生成 Agent が画像を Read)、第 4 段階 (1 次フィルタ Agent が画像を Read)、第 6 段階 (最終判定 Agent が画像を Read) で使う。

#### 1-5. 検証

- 出力 JSON ファイルの個数 = 入力 CSV の商品数 (20、失敗分があれば error フィールドで把握)
- 各 JSON が parse 可能、`name` `price` `description` `photos` が空でない
- 各 photo_1.jpg が DL 完了 (file size > 0)

### 既存資産

- `cheapest-price-research/mercari-item-detail.js` (batch 入力 / 並列 10 / DPoP 認証込み)

---

## 第 2 段階: キーワード生成 (keyword_generation_step)

各商品について、第 1 段階で取得した **実物データ (タイトル + 説明文 + photos[0] 画像)** から Sonnet サブエージェントで検索キーワードを生成する。

**CSV 商品名は参照しない** (第 1 段階の註と同様、信頼できない場合があるため URL ベースの実物データを正とする)。

### 目的

第 1 段階の実物データから、検索ヒットを「**対象商品と同一の可能性が高い** ものに絞れるキーワード」を作る。タイトルそのままでは検索ヒットが広すぎる、または不適切な修飾語 (「人気」「おしゃれ」「韓国」等) が混じる。

**商品が特定できる中核名 + 同一商品判定の軸 (色・サイズ・個数等)** に絞ったキーワードを作る。色やサイズや個数の情報は **画像と説明文から判断する** (タイトルに書かれていなくても画像で判明する色などを反映する)。

### 入出力

| | パス |
|---|---|
| 入力 | `cheapest-price-research/runs/<ts>/target_detail/{商品番号}.json` (全 20 商品分) |
| 入力 | `cheapest-price-research/runs/<ts>/target_images/{商品番号}/photo_1.jpg` (全 20 商品分) |
| 入力 | `cheapest-price-research/runs/<ts>/source.csv` (商品番号一覧の参照用、商品名列は使わない) |
| 出力 | `cheapest-price-research/runs/<ts>/keywords.csv` (4 列: `商品番号,対象タイトル,メルカリURL,検索キーワード`) |

出力 CSV の 2 列目は CSV 入力の「商品名」ではなく **第 1 段階で取得した実物の `name` (タイトル)** に置き換える (実物を正にする方針の徹底)。

### 手順

1. Sonnet サブエージェント (`subagent_type=general-purpose, model=sonnet`) を 1 体起動
2. プロンプト本文は `cheapest-price-research/prompts/keyword-generation.md` を使う。プロンプトに含めるべき要素:
   - 絶対禁則 (Agent 運用の共通原則 原則 2)
   - タスク説明: 中国輸入物販で同一商品の最安値を調査するためのキーワード生成、**実物データ (target_detail + target_images) ベースで作る**
   - 同一商品判定の前提 (本手順書「## 同一商品判定の前提」と `docs/research/mercari/judgment_examples/README.md` の参照)
   - 別商品扱いの軸 (色・サイズ・個数・柄・素材・用途) と各軸の例
   - キーワード生成ルール:
     - 各商品について `target_detail/{商品番号}.json` を Read し `name` / `description` を参照
     - 各商品について `target_images/{商品番号}/photo_1.jpg` を Read で画像認識し色・形状・個数を判断
     - 2〜3 語をスペース区切り
     - 中核名 (カテゴリ・用途) + 同一商品判定の軸を含める
     - 修飾語の羅列を避ける (人気・おしゃれ・上品・韓国・男女兼用・春夏・新品 等は基本入れない)
     - **画像で判明した色をタイトルが省略していても必ずキーワードに含める** (CSV / タイトルだけ見て色を判断しない)
   - 入力パス: 上記の入出力テーブルに記載
   - 出力パス: `cheapest-price-research/runs/<ts>/keywords.csv` の絶対パス
   - 例 (色違い・個数違い・サイズ違いをキーワードに反映する具体例 5〜10 件)
3. Agent 完了後の検証:
   - 出力ファイルが存在
   - 出力 CSV の行数 = 20 + 1 (ヘッダ)
   - 入力 target_detail / target_images の mtime / size が Agent 起動前と一致
   - 想定外ファイルが作成されていない
4. Agent 01 完了直後にスポットチェック (Agent 運用の共通原則 原則 5):
   - 5〜10 件抜粋して「商品名 → キーワード」の対応を目視確認
   - 色・個数・サイズの抜けが無いか、修飾語の混入が無いか

### 例

| 実物タイトル + 画像 | 検索キーワード |
|---|---|
| `宅配ビニール袋 B4 100枚 新品 テープ付 宅急便 ネコポス ゆうパケット` + 画像が**黒** | `宅配ビニール袋 B4 100枚 黒` (画像で黒と判明、タイトルにない色を反映) |
| `犬 ロングリード 10m 訓練用 トレーニング 大型犬 中型犬 黒` + 画像が黒 | `ロングリード 10m 黒` |
| `ハンドバッグ 大容量 黒 韓国 キルティング マザーズバック トートバッグ A4` + 画像が黒のキルティング | `トートバッグ キルティング A4 黒` |

---

## 第 3 段階: 検索 API 取得 (rival_search_step)

第 2 段階で生成したキーワードを使い、Mercari 検索 API で**現在販売中の商品を価格昇順で 60 件**取得する。バッチ単位 (1 ページ = 60 件) で動く。

### 目的

最安値候補の母集団を作る。後続の 1 次フィルタに渡す。価格昇順なので、バッチ先頭ほど安い。

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
| `priceMin` / `priceMax` | `0` / `0` | 指定なし (商品固有キーワードで絞っているため価格帯指定は不要) |
| `pageSize` | `60` | 1 バッチの件数 |
| `pageToken` | 前バッチの `meta.nextPageToken` (1 ページ目は `''`) | ページネーション |
| `sizeId` `categoryId` `brandId` `sellerId` ほか | `[]` | 空配列 |

リクエストヘッダ (DPoP 認証含む) と DPoP JWT 生成ロジックは `cheapest-price-research/cheapest-price-search.js` の実装に準拠する。

### クライアント側フィルタ (取得後)

| 条件 | 適用 |
|---|---|
| `item.itemBrand != null` の行を除外 | **適用する** (中国輸入対象外の正規ブランド品を弾く) |
| 14 日以内 (`item.updated`) フィルタ | **適用しない** (古い出品でも最安候補に含める) |

### 注意: Mercari 検索 API のキーワード挙動

Mercari 検索 API はキーワードを **AND マッチで厳密にフィルタしない** (description も検索対象になっている可能性、または OR 評価)。例: キーワードに「黒」を入れても、上位に白系商品が混じることがある (実測: 「宅配ビニール袋 黒 100枚 B4」で検索しても、rank 1〜8 に白・サイズ違い・枚数違いが残る)。

そのため**キーワードだけで完全な絞り込みは期待できない**。本手順書の設計では、検索 API はあくまで候補母集団を取得する役割で、最終的な絞り込みは第 4 段階 (1 次フィルタ・対象画像と並べて Sonnet 判定) と第 6 段階 (最終判定・説明文 + 全画像で精査) で行う。

### 出力

商品 1 つ・1 バッチごとに `cheapest-price-research/runs/<ts>/items/{商品番号}/rivals/page_NN.json`:

```json
{
  "page": 1,
  "fetchedAt": "2026-05-27T09:05:00+09:00",
  "totalReturned": 60,
  "totalAfterBrandFilter": 58,
  "nextPageToken": "...",
  "hasNext": true,
  "items": [
    {
      "rank": 1,
      "id": "m12345",
      "name": "スタッズベルト V 黒 ロック",
      "price": 980,
      "sellerId": "1234567",
      "updated": 1748000000,
      "url": "https://jp.mercari.com/item/m12345",
      "thumbnails": ["https://static.mercdn.net/.../photo_1.jpg", "..."]
    }
  ]
}
```

`rank` は同バッチ内の価格昇順順位 (1 始まり、`itemBrand` 除外後)。

### 実装

`cheapest-price-research/cheapest-price-search.js` を javascript_tool で実行 (batch 入力対応)。

入力 (`window.__CHEAPEST_BATCH_INPUT__`、複数商品を 1 回でまとめて投げる batch 形式):

```js
window.__CHEAPEST_BATCH_INPUT__ = {
  products: [
    { productCode: "FD00101", keyword: "スタッズベルト V 黒", page: 1, pageToken: "" },
    { productCode: "FD00301", keyword: "ロングリード 10m 黒",   page: 1, pageToken: "" },
    // ... 入力 CSV 全 20 件 or バッチ単位
  ]
};
```

戻り値: `{ fetchedAt, total, succeeded, failed, results: [{ productCode, keyword, page, status, totalReturned, totalAfterBrandFilter, nextPageToken, hasNext, items: [...] }, ...] }`

スクリプトは内部で **商品ごとに 200ms 間隔で順次** fetch する (Mercari 検索 API はキーワード並列でレート制限ヒットの実績があるため)。

### バッチ取得ループの打ち切り条件

| 条件 | 値 |
|---|---|
| **主条件**: 第 6 段階で同一商品マッチ発見 | 早期終了 (最安値確定) |
| 安全網 1: 連続 3 バッチで 1 次通過候補ゼロ | 打ち切り (`no_match`) |
| 安全網 2: 5 バッチ取得しても確定しない (絶対上限 300 件) | 打ち切り (`no_match`) |
| 安全網 3: hasNext=false で次バッチが無い | 打ち切り (`no_match`、市場が小さい商品) |

「1 次通過候補ゼロ」は第 4 段階の出力 (Sonnet が同一候補と判定した index) が空配列のこと。

---

## 第 4 段階: 1 次フィルタ (image_primary_filter_step)

第 3 段階の 60 件サムネ + タイトル + 対象画像を Sonnet に見せ、「対象商品と同一の可能性あり」な候補の index を返す。**60 件を 20 件 × 最大 3 シートのコンタクトシートに分割**して判定する。

### 設計

| 要素 | 値 |
|---|---|
| 1 シートの件数 | 20 件 |
| シート枚数 | 最大 3 (= 60 件 / 20 件)、件数が少なければ 1〜2 シートで完結 |
| 1 シートのレイアウト | 5 列 × 4 行 = 20 セル |
| 1 セルの解像度目安 | 300〜400px (Mercari サムネのネイティブ相当) |
| Sonnet 呼び出し回数 | シート 1 枚ごと、最大 3 体 |
| 1 回あたり Sonnet が読む画像数 | 2 (対象画像 + シート画像) |

20 件 × 3 シートに分割する理由: 60 件を 1 シートにすると 1 セル ~150px で細部判別力が落ちる。Claude vision は内部で画像をリサイズするため、1 シートを大きくしても解像度向上にはならない。シート枚数を分割することで 1 セルあたりの実効解像度を確保する。

### 手順

#### 4-1. サムネダウンロード

第 3 段階出力の各 item の `thumbnails[0]` を取得し、以下に保存:

```
cheapest-price-research/runs/<ts>/items/{商品番号}/thumbs/page_NN/{rank}.jpg
```

`rank` は 2 桁ゼロ埋め (01〜60)。

実装: `cheapest-price-research/download-thumbnails.js` を bash 経由で実行 (Node CLI、内部で並列 10 ダウンロード):

```bash
node cheapest-price-research/download-thumbnails.js \
  cheapest-price-research/runs/<ts>/items/{商品番号}/rivals/page_01.json \
  cheapest-price-research/runs/<ts>/items/{商品番号}/thumbs/page_01
```

#### 4-2. コンタクトシート生成

`cheapest-price-research/contact-sheet-builder.py` (Python + Pillow) で 20 件ごとに 1 枚の PNG を生成。最大 3 枚出力:

```
cheapest-price-research/runs/<ts>/items/{商品番号}/sheets/page_NN_sheet_1.png  # rank 01〜20
cheapest-price-research/runs/<ts>/items/{商品番号}/sheets/page_NN_sheet_2.png  # rank 21〜40
cheapest-price-research/runs/<ts>/items/{商品番号}/sheets/page_NN_sheet_3.png  # rank 41〜60
```

各セル仕様:
- 1 セル 400×500px (画像 400×400 + 下部ラベル領域 100px)
- 5 列 × 4 行 = 20 セル
- シート全体 2000×2000px + マージン
- 各セルにオーバーレイ表示する情報:
  - 左上に index (rank) を白地黒文字で大きく
  - 下部に価格 `¥980`、タイトル先頭 30 字を 2 行で

CLI 仕様 (`run-python.sh` 経由):

```bash
cheapest-price-research/run-python.sh cheapest-price-research/contact-sheet-builder.py \
  --thumbs-dir cheapest-price-research/runs/<ts>/items/{商品番号}/thumbs/page_01 \
  --rivals-json cheapest-price-research/runs/<ts>/items/{商品番号}/rivals/page_01.json \
  --output-dir cheapest-price-research/runs/<ts>/items/{商品番号}/sheets \
  --page 1
```

`run-python.sh` は Python ラッパー。環境ごとに適切な python3 を自動選択する:

- ローカル macOS: `cheapest-price-research/.venv` (Homebrew Python 3.13 + Pillow 12.2)
- Cowork サンドボックス (Linux): system `python3` (3.10 + Pillow 12.1 プリインストール)

Cowork サンドボックスは Pillow プリインストール済み、setup 不要。

#### 4-3. Sonnet 1 次判定 (シートごとに 1 Agent、最大 3 Agent)

1 シート = 1 Agent。Agent を **順次**起動する (並列禁止)。

各 Agent に渡す入力:
- 対象画像 1 枚 (`cheapest-price-research/runs/<ts>/target_images/{商品番号}/photo_1.jpg`)
- シート画像 1 枚 (`page_NN_sheet_M.png`)
- そのシートに含まれる 20 件のタイトル + index + 価格の一覧 (テキスト)
- 対象商品のタイトルと価格 (テキスト)

プロンプト本文は `cheapest-price-research/prompts/primary-filter.md` を使う。プロンプトに含めるべき要素:
- 絶対禁則
- タスク説明: 1 次フィルタの目的は「明らかに別商品を弾く」こと。細部の決定打は次段に任せる
- 同一商品判定の前提 (色・サイズ・個数・柄・素材・用途で別商品扱い)
- 画像優先の原則 (タイトル・説明文と画像で矛盾があれば画像優先)
- 入力: 対象画像 + シート画像 + 20 件のタイトル一覧
- 出力: 同一商品候補の index 配列 (JSON 形式)。保守的に拾う (取りこぼしより誤包含を許容)

出力ファイル: `cheapest-price-research/runs/<ts>/items/{商品番号}/primary_filter/page_NN.json`

```json
{
  "page": 1,
  "sheet_results": [
    { "sheet": 1, "candidates": [3, 7, 12] },
    { "sheet": 2, "candidates": [] },
    { "sheet": 3, "candidates": [45] }
  ],
  "merged_candidates": [3, 7, 12, 45]
}
```

`merged_candidates` は最大 3 シートの結果を価格昇順 (= rank 昇順) でマージしたもの。

---

## 第 5 段階: 候補詳細取得 (candidate_detail_fetch_step)

第 4 段階の 1 次通過候補について、第 1 段階と同じ方法 (items/get API batch) で詳細を取得する。

### 入出力

| | 内容 |
|---|---|
| 入力 | `cheapest-price-research/runs/<ts>/items/{商品番号}/primary_filter/page_NN.json` の `merged_candidates` (rank 配列) |
| 出力 | 候補ごとに `cheapest-price-research/runs/<ts>/items/{商品番号}/candidate_detail/{id}.json` (items/get の `data` フィールド本体、不変) |
| 出力 | 候補ごとに `cheapest-price-research/runs/<ts>/items/{商品番号}/candidate_images/{id}/photo_1.jpg` (photos[0]、第 6 段階で Sonnet が Read する画像) |

### 取得戦略

価格昇順 (= rank 昇順) で **上位 N 件 (例: 5 件) を一括取得** → 最安候補から順に第 6 段階で判定 → matched 出たら打ち切り (取りすぎ分はそのまま破棄して次商品へ)。

「1 件ずつ取得 → 判定 → matched なら終了」も理論上は最も効率的だが、items/get API は 1 回 fetch あたり ~30ms 程度なので 5 件先取りしても無駄は少ない。一方で「N 件全部 false なら次バッチ (page+1) 取得」のループ制御が単純化される。

### 手順

#### 5-1. items/get バッチ取得

`merged_candidates` の上位 N 件 (デフォルト 5、商品ごとに調整可) の id を抽出し、第 1 段階と同じ `cheapest-price-research/mercari-item-detail.js` を javascript_tool で実行:

```js
window.__ITEM_DETAIL_INPUT__ = {
  items: [
    { productCode: "FD00301", itemId: "m33821215532" },   // rank 2
    { productCode: "FD00301", itemId: "m55414129562" },   // rank 3
    // ...
  ]
};
```

戻り値の `results[]` を商品ごとに `candidate_detail/{id}.json` に分割保存。

#### 5-2. 候補画像 photos[0] をローカル DL

各候補の `data.photos[0]` URL を `bash` + `curl` で `candidate_images/{id}/photo_1.jpg` に保存。

### 早期終了の意味

第 6 段階で `sameProduct=true` が出たらこのループを打ち切る (価格昇順なのでそれが最安値)。`false` なら次の候補の判定に進む。N 件全部 `false` なら第 3 段階に戻り次バッチ (page+1) を取得する。

---

## 第 6 段階: 最終判定 (final_identity_judgment_step)

対象商品 (第 1 段階) と候補 1 件 (第 5 段階) の詳細を Sonnet が比較し、同一商品か判定する。

### 判定素材

| 素材 | 出所 |
|---|---|
| タイトル | 対象詳細 / 候補詳細 (`name`) |
| 説明文 (全文) | 対象詳細 / 候補詳細 (`description`) |
| 画像 (photos[0]) | 対象詳細 / 候補詳細 (ローカル DL 済み) |
| 価格 | 対象詳細 / 候補詳細 (`price`、参考情報) |
| 商品の状態 | 対象詳細 / 候補詳細 (`item_condition`、参考情報) |

### 入出力

| | 内容 |
|---|---|
| 入力 | 対象詳細 + 候補詳細 (1 件) |
| 出力 | `cheapest-price-research/runs/<ts>/items/{商品番号}/final_judgment/{id}.json` |

### 出力フォーマット

```json
{
  "candidateId": "m12345",
  "candidateRank": 3,
  "candidatePrice": 980,
  "candidateUrl": "https://jp.mercari.com/item/m12345",
  "sameProduct": true,
  "axes": {
    "color":    { "verdict": "match"|"mismatch"|"unknown", "target": "...", "candidate": "..." },
    "size":     { ... },
    "quantity": { ... },
    "pattern":  { ... },
    "material": { ... },
    "purpose":  { ... }
  },
  "reason": "判定根拠を 1-3 文で記述"
}
```

### 手順

1. Sonnet サブエージェント (`model=sonnet`) を 1 体起動
2. プロンプト本文は `cheapest-price-research/prompts/final-judgment.md` を使う。プロンプトに含めるべき要素:
   - 絶対禁則
   - タスク説明: 対象商品と候補 1 件が同一商品か最終判定する
   - 同一商品判定の前提 (色・サイズ・個数・柄・素材・用途で別商品扱い)
   - 画像優先の原則
   - 入力: 対象 (タイトル + 説明文 + photo_1.jpg) + 候補 (タイトル + 説明文 + photo_1.jpg)
   - 出力: 上記 JSON
   - 判定基準: 全 6 軸 (色/サイズ/個数/柄/素材/用途) のいずれかが明らかに違えば `sameProduct=false`。判定根拠 (どの軸で一致したか・どの軸で違ったか) を `reason` に書く
3. Agent 完了後の検証 (出力存在、JSON parse、判定理由が空でない)

### 判定結果による分岐

- `sameProduct=true` → 第 3 段階のループを打ち切り、第 7 段階 (`result.json` 書き出し) に進む
- `sameProduct=false` → 第 5 段階に戻り、次の候補 (rank 昇順で次) を取得・判定
- 1 次通過候補がすべて `false` → 第 3 段階に戻り、次バッチ (page+1) を取得

### `result.json` 書き出し

最安値確定時 (第 5・6 段階で `sameProduct=true` が出た時) に書き出す:

```json
{
  "productCode": "FD00101",
  "status": "matched",
  "cheapest": {
    "id": "m12345",
    "rank": 3,
    "page": 1,
    "price": 980,
    "url": "https://jp.mercari.com/item/m12345"
  },
  "reason": "色 (黒)・形状 (V 字スタッズ)・素材 (合皮)・個数 (1 本) が一致...",
  "pagesScanned": 1,
  "totalCandidatesAfterPrimaryFilter": 6,
  "totalCandidatesJudgedInFinalStep": 1
}
```

打ち切り条件到達時 (`no_match`):

```json
{
  "productCode": "FD00101",
  "status": "no_match",
  "reason": "5 バッチ (300 件) 取得しても同一商品が見つからなかった",
  "pagesScanned": 5,
  "totalCandidatesAfterPrimaryFilter": 0,
  "totalCandidatesJudgedInFinalStep": 0
}
```

出力先: `cheapest-price-research/runs/<ts>/items/{商品番号}/result.json`

---

## 第 7 段階: 最安値抽出 + レポート化 (cheapest_export_step)

20 件の `result.json` を集約して CSV にする。

### 入出力

| | 内容 |
|---|---|
| 入力 | `cheapest-price-research/runs/<ts>/items/*/result.json` (全 20 商品) + `cheapest-price-research/runs/<ts>/target_detail/*.json` (対象価格) + `cheapest-price-research/runs/<ts>/source.csv` (商品番号→対象URLの対応) |
| 出力 | `cheapest-price-research/runs/<ts>/report.csv` (UTF-8 BOM 付き) |

### 列定義

本手順書冒頭「## 出力」の列定義に従う:

```
商品番号,対象URL,対象価格,最安URL,最安価格,価格差,同一判定理由,ステータス
```

### 手順

1. `cheapest-price-research/runs/<ts>/items/*/result.json` を全件 glob
2. 各 result について `source.csv` から商品番号 → 対象 URL を引く
3. 各 result について `target_detail/{商品番号}.json` から対象価格 (`price` フィールド) を引く
4. result の `status` で分岐:
   - `matched` → 最安値情報を埋める、`価格差 = 最安価格 - 対象価格`
   - `no_match` → 最安系の列は空欄、`同一判定理由` に reason、`ステータス=no_match`
   - `error` → 同上で `ステータス=error`
5. CSV に書き出し (UTF-8 BOM 付き)
6. report.csv のフルパス + 結果サマリを物販オーナーに報告

### 物販オーナーへの報告フォーマット

セッション完了時に以下をチャットで物販オーナーに報告する:

```
最安値リサーチ完了 (20 件、所要 約X時間Y分)。
レポート: /Users/kawasaki/.../cheapest-price-research/runs/<ts>/report.csv

結果サマリ:
- matched: M 件
- no_match: N 件 (理由: ...)
- error: E 件 (理由: ...)

特記すべき商品 (任意):
- FDxxxxx は対象 ¥A に対し最安 ¥B、差 -¥C (要注目)
- FDxxxxx は対象と最安が同価格

次の作業: report.csv を見て listings/runs/YYYY_MM_DD/YYYY_MM_DD_listing.csv の `価格` 列に手書きで埋めてください。
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
   → target_images/{商品番号}/photo_1.jpg (全 20 商品、curl で DL)
↓
2. Sonnet サブエージェント 1 体起動
   入力: target_detail/ + target_images/ (実物データ)
   出力: keywords.csv (商品番号→検索キーワード)
   Agent 01 完了直後にスポットチェック (5〜10 件)
↓
keywords.csv の各商品について順次 (20 商品):
  - 第 3〜6 段階のループ (1 商品ぶん):
      page=1 から始める
      while page <= 5 and 連続ゼロ < 3:
        第 3 段階: rivals/page_NN.json (バッチ取得)
        if hasNext=false かつ items が空または不十分: 
          break (no_match で次商品へ)
        第 4 段階: primary_filter/page_NN.json (Sonnet × 最大 3 シート)
        if primary_filter が空: 連続ゼロ += 1; page += 1; continue
        for rank in merged_candidates (上位 5 件):
          第 5 段階: candidate_detail/{id}.json + candidate_images/{id}/photo_1.jpg
          第 6 段階: final_judgment/{id}.json
          if sameProduct=true: result.json (matched); break (ループ脱出)
        if matched: break
        連続ゼロ = 0; page += 1
      if not matched: result.json (no_match)
↓
3. report.csv (20 行の最終 CSV)
   run_notes.md
   物販オーナーへ報告
```

---

## 規模感 (1 日 20 件)

| 段階 | 所要 (目安) | Sonnet 体数 |
|---|---|---|
| 0. 準備 + DPoP セッション確立 | 1 分 | 0 |
| 1. 対象詳細取得 + 画像 DL | 1 分 (API 並列 10) | 0 |
| 2. キーワード生成 | 2-3 分 | 1 |
| 3-6. 最安値探索ループ (20 件) | 60-120 分 | 40-100 (商品依存) |
| 7. レポート + run_notes | 5 分 | 0 |
| **合計** | **約 1-2 時間** | **40-100 体** |

1 セッションで完走できる規模 (Cowork の 1M context + Opus 4.7 想定)。中断する場合は再開せず新 run で全 20 件をやり直す前提。

---

## 関連既存資産

| パス | 役割 | 本手順での参照段階 |
|---|---|---|
| `cheapest-price-research/mercari-item-detail.js` | items/get API batch 取得 | 第 1 / 第 5 段階 |
| `cheapest-price-research/cheapest-price-search.js` | 検索 API batch 取得 | 第 3 段階 |
| `cheapest-price-research/download-thumbnails.js` | サムネ並列 DL | 第 4 段階 4-1 |
| `cheapest-price-research/contact-sheet-builder.py` | コンタクトシート PNG 生成 | 第 4 段階 4-2 |
| `cheapest-price-research/run-python.sh` | Python ラッパー (macOS/Linux 吸収) | 第 4 段階 4-2 |
| `cheapest-price-research/prompts/keyword-generation.md` | キーワード生成プロンプト本文 | 第 2 段階 |
| `cheapest-price-research/prompts/primary-filter.md` | 1 次フィルタプロンプト本文 | 第 4 段階 4-3 |
| `cheapest-price-research/prompts/final-judgment.md` | 最終判定プロンプト本文 | 第 6 段階 |
| `docs/research/mercari/judgment_examples/` | 同一商品判定の実例集 | 第 2 / 第 4 / 第 6 段階 |
| `procedures/listing-cowork.md` | 出品手順 (本手順書の後段) | 連携 |
