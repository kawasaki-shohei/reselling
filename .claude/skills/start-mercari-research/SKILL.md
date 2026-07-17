---
name: start-mercari-research
description: メルカリ売れ筋リサーチ手順 v2 (procedures/mercari-research-v2.md) を開始・実行するときに使用する。「メルカリリサーチを始めて/実行して」「手順書に沿ってリサーチして」、および離席して自律実行を任される（「出かけます」「止まらず作業できる準備を」「◯段階まで進めて続行/相談」）ときのキックオフ手順。段階の重さ・自律実行の準備点検・続行/相談の判断基準を定める。
---

# メルカリ売れ筋リサーチ v2 の開始手順

対象手順書: `reselling_workspace/reselling/procedures/mercari-research-v2.md`（工程「(1) 商品リサーチ」）。
このリサーチを任されて着手するときに使う。CLAUDE.md のグローバル原則はすべて有効なまま、その上乗せ。

## 場所（すべて `reselling_workspace/reselling/` が基点。primary の `reselling/` 側には無い）

- 手順書: `procedures/mercari-research-v2.md`
- 実装コード: `research/*.js`、プロンプト雛形: `research/*_prompt.md`
- run 出力: `research/runs/<ts>/`（`<ts>` は生データファイル名の `YYYY_MM_DD_HH_MM`）
- 生データ: `research/<ts>__mercari_14day_results.json`
- 正規辞書: `procedures/exclude_by_keywords/keywords.json`
- 各 run の記録: `research/runs/<ts>/run_notes.md`（直近の完走例と逸脱点・教訓がここにある。着手前に最新 run のものを読む）

## 段階の重さ（ユーザーの「3段階まではすぐ、4段階から長い」の実体）

- **第1〜3段階は短い**（Node 処理中心 + 第3段階だけ Sonnet 1 体）。ここまでは基本そのまま進めてよい。
- **第4段階以降が長い**。画像除外・構造化抽出・正規化・視覚属性抽出・同一商品判定で
  Sonnet/Haiku サブエージェントを多数・直列に回す。使用制限で1日で終わらない前提の設計。
  ここは中断再開（progress.json）・実ファイル検証・逐次保存が必須。

## 開始時にやること（この順番）

1. **手順書を最後まで読む。** 全体フロー・各段階の入出力・段階間の依存・段階内の原則を把握する。
   構造把握にツール（grep・ctx）は可。ただし各段階の実行判断は原文を自分で読んで下す。
2. **原則を二重で確認。** ①CLAUDE.md のグローバル原則、②手順書の「出力ファイルの共通原則」
   「Agent 運用の共通原則」（原則1〜9）。特に：出力は不変、Agent プロンプトに禁則全文を埋める、
   完了報告を鵜呑みにせず実ファイル検証、停止 Agent は SendMessage 復帰、親は軽作業（画像 Read しない）。
3. **最新 run の `run_notes.md` を読む**（既知の逸脱点・落とし穴を引き継ぐ）。
4. **今回が新規収集か継続かを決める。** 最新の生データが古ければ（14日窓を外れていれば）第1段階から新規収集。
5. 第1段階から進め、**段階の境界ごとに「続行 / 相談」を判断**（下記基準）。段階完了ごとに run_notes に追記。

## 第1〜3段階の実行（短い区間）

**第1段階 収集（Playwright + `research/collect.js`）**
- ブラウザ準備は自分で行う。`browser_navigate` で `https://jp.mercari.com` を開き 3 秒待つ（未ログイン可、
  DPoP 認証は IndexedDB の鍵を使う）。ユーザーにブラウザを開かせない。
- **レート制限のため 1 キーワードずつ**（`KEYWORDS` は11個、各キーワード内で5価格帯を並列）。
  全キーワード一括並列は取得件数が激減するので禁止。`collect.js` 本体は全件ループなので、
  呼び出し側で 1 キーワードに絞った版を `browser_evaluate` の `function` に渡す。
- **収集結果は約2〜3万件と大きい。自分のコンテキストに載せない。** `browser_evaluate` の `filename`
  パラメータで結果をファイルに保存する（未指定だとテキストで返り context を圧迫する）。キーワード別に
  保存 → Node で id ユニーク化してマージ、を基本にする。最終生データは `research/<ts>__mercari_14day_results.json`。
  ※ 保存先ディレクトリ等の細部は初回に実挙動を確認してから確定する。
- `withItemBrand:true` で `item.itemBrand` 付き（正規ブランド品）は収集段階で除外済み。

**第2段階 集約**: `node research/aggregate.js research/<rawfile>.json` → `aggregate/all_items_sorted_from_<date>.tsv`。
stdout の summary（totalItems / uniqueRows / coreClusters_count_ge_3）を run_notes に記録。

**第3段階 暫定辞書**:
- `node research/expand_dictionary.js research/<rawfile>.json` → `dict_expansion/` に unflagged と
  絶対パス置換済みプロンプトを生成。
- Agent ツール（`subagent_type=general-purpose, model=sonnet`）に生成された `dict_expansion_prompt.md`
  の**全文**を渡す → `keywords_pending.json` 生成。
- 手順3のバリデーション node ワンライナーでカテゴリ整合を確認。失敗時は手順書「エラー時の再試行ルール」に従う。

## 「止まらない準備」チェックリスト（第4段階に入る前に点検）

- 第4段階以降の入力（第3段階までの出力ファイル）が揃っているか。
- progress.json による中断再開・バッチ逐次保存の段取りができているか。
- Agent プロンプト雛形の全文を渡す準備（`build_*_prompt.js` で完成プロンプトを生成）。親が手で削らない。
- Agent 起動時の `agentId` を控え、停止時は SendMessage で復帰する運用。
- 使用制限3種（レート/5時間窓/日次）への対処を把握。待たずの即再起動は禁止。

## 続行 vs 相談の判断基準

**続行してよい**: 次段階の前提・入力が揃い、手順が一意に定まり、失敗しても中間成果が保存され再開できる。
第1〜3段階は原則そのまま続行してよい。

**止まって相談する**:
- 第1段階の収集がブラウザ/DPoP/レート制限で成立しない（Playwright セッションが張れない等）。
- 収集件数が過去 run と桁違いに少ない等、母集団が明らかに異常。
- ユーザーにしか決められない分岐がある（方針・並列数の変更など）。
- 前提・入力が欠けて先へ進めない。
- 同一エラーで2回続けて修正に失敗（3回目を試みず停止し報告）。
- 破壊的・不可逆な操作や外部公開（Web UI 公開など）が必要になった。

相談は CLAUDE.md に従い、冒頭に全質問を箇条書き → 最初の1問だけ投げて1問ずつ。
「試したこと（事実）・仮説・推奨案と却下案」を添える。

## 進行中の姿勢

- 段階完了ごとに run_notes.md に件数・時刻・逸脱点・実ファイル検証結果を追記（独立して読める記述で）。
- 却下された選択肢・「やらない」と決めた事項は残タスク・提案に再掲しない。
- git 操作には一切関与しない。
