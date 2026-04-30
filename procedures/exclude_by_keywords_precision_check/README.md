# exclude_by_keywords 精度検証 手順書

このドキュメントだけを読めば、辞書 `procedures/exclude_by_keywords/keywords.json` の精度検証を開始〜完了まで独立して実行できる。前提知識・コンテキスト一切不要。

---

## 0. このディレクトリ構成

```
procedures/exclude_by_keywords_precision_check/
├── README.md                       # このファイル (手順書・git)
├── agent_prompt_flagged.md         # flagged 判定用 Agent プロンプト (git)
├── agent_prompt_unflagged.md       # unflagged 判定用 Agent プロンプト (git)
├── scripts/                        # 汎用スクリプト (git)
│   ├── 01_prepare.js               # 判定対象抽出 → <phase>_all.json
│   ├── 02_split_batches.js         # 50 件 / バッチに分割
│   ├── 03_download_images.js       # thumbnail 並列 DL
│   ├── 04_aggregate_and_analyze.js # バッチ結果統合 + verdict 集計
│   └── 05_integrated_metrics.js    # flagged + unflagged 統合 P/R/F1 計算
├── reports/                        # 検証レポート (.gitignore、.gitkeep のみ追跡)
│   └── YYYY-MM-DD_<phase>.md       # 過去レポートは手元にのみ残る
└── runs/                           # エージェント実行ログ (.gitignore)
    └── YYYY-MM-DD_<phase>/
        ├── <phase>_all.json
        ├── batches/batch_NNN.json
        ├── images/{rowIndex}.webp
        ├── results/batch_NNN_result.json
        ├── summary/
        │   ├── merged_gt.json
        │   ├── stats.json
        │   └── error_patterns.md
        └── progress.json
```

`runs/` と `reports/` はどちらも `.gitignore` 済み (配下のファイルは git 管理しない、ディレクトリ自体だけ `.gitkeep` で保持)。git 管理するのは手順書・Agent プロンプト・スクリプトのみ。

- **runs/** は実行ログ (画像数千枚・バッチ JSON 数百個、再生成可能)
- **reports/** は検証レポートだが、単一ユーザー運用かつ編集しない性質のため git 管理外にする。過去レポートは手元にのみ残る (runs/ の中間ファイルから `04_aggregate_and_analyze.js` で数値部分は再生成可能)

---

## 1. 検証の目的

辞書の性能を **Precision (除外判定の正確さ) と Recall (除外すべき商品を拾えた率) の両輪**で測る。

| 指標 | 測定内容 | 測り方 |
|---|---|---|
| **Precision** | 辞書が「除外」と判定したもののうち、本当に除外すべきだった割合 | **Phase A**: flagged 全件を画像 + タイトルで GT 判定 (verdict = exclude / rescue / unclear) |
| **Recall** | 本来除外すべき全商品のうち、辞書が拾えた割合 | **Phase B**: unflagged 全件を画像 + タイトルで GT 判定 (verdict = keep / exclude / unclear) |
| **F1** | Precision と Recall の調和平均 | **Phase C**: 両 Phase の結果から算出 |

2026-04 の検証では Precision 91.71% に対し Recall 50.87%、F1 65.41% だった (辞書が除外すべき商品の半数しか拾えていない)。flagged 側だけ測ると Precision しか見えないので、必ず unflagged 側も測ること。

---

## 2. 実施前チェックリスト

```bash
# 1. 最新生データの場所を確認
ls research/*_mercari_14day_results.json | tail -1

# 2. 辞書のバージョン (git log で直近の keywords.json 変更を確認)
git log -5 --oneline -- procedures/exclude_by_keywords/keywords.json

# 3. 現在の JST 時刻を確認 (日次使用量制限リセットのタイミング把握)
date '+%Y-%m-%d %H:%M:%S %Z'

# 4. 前回レポートを確認 (手元にあれば比較用、git 管理外)
ls procedures/exclude_by_keywords_precision_check/reports/ 2>/dev/null || echo "no previous reports (initial run)"

# 5. 分類器の前提が崩れていないか (priority 配列の構造)
node -e 'const c = require("./research/_classifier"); console.log(c.loadDictionary(null).priority)'
```

前提が崩れていたら、手順を再設計する必要がある。詳細は `docs/research/mercari/exclude_by_keywords_precision_check.md` §5。

---

## 3. 全体フロー

```
Phase A: flagged 全件判定 (Precision 測定)
  A-1. 作業ディレクトリ作成
  A-2. 01_prepare.js で flagged_all.json 生成
  A-3. 02_split_batches.js で 50 件 / バッチに分割
  A-4. 03_download_images.js で画像並列 DL
  A-5. progress.json 初期化
  A-6. Agent 順次起動 (1 体 = 3 バッチ = 150 件)
  A-6.5 Agent 01 直後にスポットチェック (必須)
  A-7. 04_aggregate_and_analyze.js で集計
  A-8. レポート作成

Phase B: unflagged 全件判定 (Recall 測定) — Phase A と同じ手順、PHASE=unflagged に変更
Phase C: 05_integrated_metrics.js で統合 P/R/F1 算出、レポートに追記
```

---

## 4. Phase A: flagged 全件判定

### 4.1 作業ディレクトリ作成

以下を丸ごとコピーして実行:

```bash
# JST 基準で日付を取得
DATE=$(TZ=Asia/Tokyo date '+%Y-%m-%d')
PHASE=flagged
RUN_DIR=procedures/exclude_by_keywords_precision_check/runs/${DATE}_${PHASE}
mkdir -p $RUN_DIR
echo "RUN_DIR=$RUN_DIR"
```

### 4.2 判定対象抽出 (01_prepare.js)

```bash
# 最新生データのパスを確定 (環境に応じて書き換え可)
RAW=$(ls research/*_mercari_14day_results.json | tail -1)
echo "RAW=$RAW"

node procedures/exclude_by_keywords_precision_check/scripts/01_prepare.js \
  $RAW $RUN_DIR $PHASE
```

出力: `$RUN_DIR/flagged_all.json` (flagged 全件、rowIndex / title / primary / matches / image_path / thumbnail_url を含む)。

### 4.3 バッチ分割 (02_split_batches.js)

```bash
node procedures/exclude_by_keywords_precision_check/scripts/02_split_batches.js $RUN_DIR
```

出力: `$RUN_DIR/batches/batch_000.json` 〜 `batch_NNN.json` (各 50 件)。合計件数・バッチ数が標準出力に表示される。

### 4.4 画像ダウンロード (03_download_images.js)

```bash
node procedures/exclude_by_keywords_precision_check/scripts/03_download_images.js $RUN_DIR
```

出力: `$RUN_DIR/images/{rowIndex}.webp`。全 flagged 件数分を並列 30 で DL (数十分、件数次第)。`progress: N/M (failed: F)` が 100 件ごとに出力される。失敗 (failed) が許容範囲 (0 件が理想、数件までは許容) か確認。

### 4.5 progress.json 初期化

```bash
TOTAL=$(ls $RUN_DIR/batches | wc -l | tr -d ' ')
NOW=$(TZ=Asia/Tokyo date '+%Y-%m-%dT%H:%M:%S+09:00')
cat > $RUN_DIR/progress.json <<EOF
{
  "completed_batches": [],
  "total_batches": $TOTAL,
  "started_at": "$NOW",
  "last_updated_at": "$NOW"
}
EOF
cat $RUN_DIR/progress.json
```

### 4.6 Agent 順次起動

**1 Agent = 3 バッチ (150 件)** を標準。並列起動禁止 (使用量制限を一気に消費するため)。

Agent 総数の計算:
- Agent N (1..floor(total_batches / 3)) は `batch_{3*(N-1):03d}` 〜 `batch_{3*(N-1)+2:03d}` を担当
- 余りがある場合、最後の Agent が 1〜2 バッチを担当

Agent 起動は Claude Code の `Agent` ツールを使う:

```
Agent({
  description: "flagged GT 判定 Agent NN",
  subagent_type: "general-purpose",
  model: "opus",
  prompt: <agent_prompt_flagged.md の本文 + 下記 {BATCH_PATHS} / {RESULT_PATHS} 差し込み>
})
```

- `{BATCH_PATHS}` は改行区切りで 3 つのバッチ絶対パス
- `{RESULT_PATHS}` は改行区切りで 3 つの結果ファイル絶対パス
- `agent_prompt_flagged.md` 冒頭の説明に沿ってプロンプトを組み立てる

親セッションの役割: Agent 起動 → 完了確認 → progress.json 更新 → 次の Agent 起動。**親は画像 Read をしない** (親+子のトークン累積で使用量制限が早く来るため)。

#### 4.6.1 Agent 完了後の検証 (必ず実施)

Agent が「完了」報告しても鵜呑みにせず、**実ファイルの存在と件数を確認**する:

```bash
# N は Agent 番号 (1, 2, 3, ...)
check_agent() {
  local agent_n=$1
  for i in 0 1 2; do
    local batch_num=$((3 * (agent_n - 1) + i))
    local nnn=$(printf "%03d" $batch_num)
    local f=$RUN_DIR/results/batch_${nnn}_result.json
    if [ ! -f "$f" ]; then echo "MISSING: batch_$nnn"; continue; fi
    local count=$(python3 -c "import json; print(len(json.load(open('$f'))['items']))")
    echo "batch_$nnn: $count items"
  done
}
# 例: Agent 01 完了後
check_agent 1
```

50 件が 3 バッチ分 (計 150 件) 揃っていなければ Agent を SendMessage で復帰させる (§7.3)。

#### 4.6.2 progress.json 更新

```bash
# Agent N 完了時。JQ 等使わず sed / python で直接書く
python3 <<EOF
import json, datetime
p = "$RUN_DIR/progress.json"
d = json.load(open(p))
agent_n = $agent_n  # 適宜書き換え
new_batches = [3*(agent_n-1), 3*(agent_n-1)+1, 3*(agent_n-1)+2]
d["completed_batches"] = sorted(set(d["completed_batches"]) | set(new_batches))
d["last_updated_at"] = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).isoformat(timespec="seconds")
json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
print(d)
EOF
```

### 4.6.5 Agent 01 完了直後のスポットチェック (必須)

最初の Agent が完了したら、**10 件抜粋して verdict と理由を目視確認**する。判定品質に問題があれば Agent 02 以降を止めてプロンプト修正。

```bash
python3 <<'EOF'
import json, random
random.seed(42)
run_dir = "$RUN_DIR"  # 事前に export するか直接書き換え
items = []
for n in [0, 1, 2]:
    f = f"{run_dir}/results/batch_{n:03d}_result.json"
    items.extend(json.load(open(f))["items"])

# verdict が偏らないよう層別抽出 (5+5)
primary_verdict = "exclude"  # flagged の場合
secondary_verdict = "rescue"  # 少数派なので全部表示
primary = [i for i in items if i["gt_verdict"] == primary_verdict]
secondary = [i for i in items if i["gt_verdict"] == secondary_verdict]

sample = random.sample(primary, min(5, len(primary))) + secondary[:5]
for i in sample:
    print(f"rowIndex {i['rowIndex']:>4} [{i['gt_verdict']:>7}] {i.get('gt_reason', '')}")
    print(f"  title: {i['title'][:80]}")
    print(f"  image: {i['image_path']}")
EOF
```

気になる判定は `Read` ツールで画像を開いて直接確認する。

### 4.7 集計 (04_aggregate_and_analyze.js)

全 Agent 完了後:

```bash
node procedures/exclude_by_keywords_precision_check/scripts/04_aggregate_and_analyze.js \
  $RUN_DIR $PHASE
```

出力:
- `$RUN_DIR/summary/merged_gt.json` (全件統合)
- `$RUN_DIR/summary/stats.json` (verdict 分布、Precision 等)
- `$RUN_DIR/summary/error_patterns.md` (誤判定理由一覧、先頭 50 件)

### 4.8 レポート作成

`procedures/exclude_by_keywords_precision_check/reports/YYYY-MM-DD_flagged.md` に振り返りを書く (git 管理外、手元にのみ残る)。構成は §8 参照。

---

## 5. Phase B: unflagged 全件判定

Phase A と完全に対称。違いは以下のみ:

| 項目 | flagged (Phase A) | unflagged (Phase B) |
|---|---|---|
| `PHASE` 変数 | `flagged` | `unflagged` |
| 判定対象 | `exclusion !== null` の行 | `exclusion === null` の行 |
| verdict 3 値 | `exclude` / `rescue` / `unclear` | `keep` / `exclude` / `unclear` |
| Agent プロンプト | `agent_prompt_flagged.md` | `agent_prompt_unflagged.md` |
| 典型件数 (2026-04) | 約 2,460 件 / 14 Agent | 約 4,825 件 / 33 Agent |
| 所要時間 | 約 2 日 | 約 11 時間〜2 日 |
| スポットチェック (§4.6.5) の `primary_verdict` | `exclude` | `keep` |
| スポットチェック (§4.6.5) の `secondary_verdict` | `rescue` | `exclude` |

Phase A と B は独立実行可能。**Phase A (件数少) を先にやって辞書改善サイクルを回してから Phase B に進む**のが効率的。ただし辞書を両 Phase の間で変更した場合、Precision と Recall は別バージョンの辞書に対する値になり統合できないので注意。

実行コマンドは Phase A と同じで `PHASE=unflagged` に変えるだけ:

```bash
DATE=$(TZ=Asia/Tokyo date '+%Y-%m-%d')
PHASE=unflagged
RUN_DIR=procedures/exclude_by_keywords_precision_check/runs/${DATE}_${PHASE}
mkdir -p $RUN_DIR

RAW=$(ls research/*_mercari_14day_results.json | tail -1)

node procedures/exclude_by_keywords_precision_check/scripts/01_prepare.js $RAW $RUN_DIR $PHASE
node procedures/exclude_by_keywords_precision_check/scripts/02_split_batches.js $RUN_DIR
node procedures/exclude_by_keywords_precision_check/scripts/03_download_images.js $RUN_DIR
# progress.json 初期化 (§4.5 と同じ)
# Agent 起動 (§4.6 と同じ、プロンプトは agent_prompt_unflagged.md)
node procedures/exclude_by_keywords_precision_check/scripts/04_aggregate_and_analyze.js $RUN_DIR $PHASE
```

---

## 6. Phase C: 統合集計

両 Phase 完了後:

```bash
FLAGGED_DIR=procedures/exclude_by_keywords_precision_check/runs/<flagged の実行日>_flagged
UNFLAGGED_DIR=procedures/exclude_by_keywords_precision_check/runs/<unflagged の実行日>_unflagged
OUT=procedures/exclude_by_keywords_precision_check/runs/integrated_$(TZ=Asia/Tokyo date '+%Y-%m-%d').json

node procedures/exclude_by_keywords_precision_check/scripts/05_integrated_metrics.js \
  $FLAGGED_DIR $UNFLAGGED_DIR $OUT
```

出力例 (標準出力 + OUT パス):
```json
{
  "confusion_matrix": { "TP": 2256, "FP": 192, "FN": 2179, "TN": 2619 },
  "metrics": {
    "precision": "91.71%",
    "recall": "50.87%",
    "f1": "65.41%",
    "accuracy": "67.21%"
  }
}
```

| 指標 | 定義 |
|---|---|
| TP (True Positive) | flagged の exclude (辞書が除外し、実際に除外すべきだった) |
| FP (False Positive) | flagged の rescue (辞書が除外したが、実際は仕入れ候補) |
| FN (False Negative) | unflagged の exclude (辞書が通したが、実際は除外すべきだった) |
| TN (True Negative) | unflagged の keep (辞書が通し、実際に仕入れ候補でよい) |
| Precision | TP / (TP + FP) |
| Recall | TP / (TP + FN) |
| F1 | 2 × Precision × Recall / (Precision + Recall) |

unclear は分母に含めない (判別不能なものはスコア計算から除外)。

両レポート (`reports/YYYY-MM-DD_flagged.md` と `reports/YYYY-MM-DD_unflagged.md`) の結論セクションに統合値 (Precision / Recall / F1) を追記し、相互リンクを張る。

---

## 7. Agent 運用のルール (反省と運用知見)

### 7.1 必ず守る

- **1 Agent = 3 バッチ (150 件) を標準**。詰め込みすぎるとレート制限ヒット (2026-04-18: 500 件 / Agent を試して 250 件で停止した実績あり)
- **並列起動禁止**。順次 1 体ずつ
- **progress.json で中断再開を前提に設計**。件数が多い Phase (例: 4,000 件超の unflagged) は 1 日で完走できない想定
- **親セッションで画像 Read をしない**。Agent 側で画像を開き、親は Agent 間のオーケストレーションに徹する
- **使用する辞書バージョンを Phase 中に変えない**。Phase A と B の間で辞書を変えると Precision/Recall が別バージョンの値になる

### 7.2 Agent の「完了報告」を鵜呑みにしない

2026-04-20 の unflagged 検証で **Agent 03 と Agent 17 が「続きます」と書いて結果ファイルを生成せずに終了**した事例あり。Agent の返答テキストでは判定せず、**必ず §4.6.1 の実ファイル検証を毎回実施**。

### 7.3 停止した Agent の復帰 (SendMessage)

Agent 起動のレスポンスに含まれる `agentId` を控えておく。途中で止まったら:

```
SendMessage({
  to: "<agentId>",
  message: "batch_NNN_result.json がまだ書き出されていません。判定を継続し、全件保存してから「全 N 件保存完了」と報告してください。"
})
```

で transcript を保持したまま復帰する。2026-04-20 の Agent 03 と 17 はこれで無事完走。新しい `Agent()` 呼び出しは別個体になり、判定途中の文脈を失うので使わない。

### 7.4 Agent 01 完了直後のスポットチェック (必須)

最初の Agent が完了したら、§4.6.5 のコードで 10 件抜粋を目視確認。keep/exclude の境界判定・連想 NG の適用 (adidas 三本ラインなど) に問題がないか確認。品質問題があれば以降を止めてプロンプト修正。

### 7.5 プロンプト簡略化の許容範囲

2026-04-20 検証では Agent 01〜04 に詳細プロンプト (9 カテゴリ全説明 + 連想 NG 一覧 + 判定フロー)、Agent 05 以降は簡略版を使ったが、判定品質の劣化は見られなかった。**詳細プロンプトは Agent 01 だけで十分**。以降は `agent_prompt_*.md` のコア部分に絞ってよい。

### 7.6 Agent プロンプトに必ず含める検証ステップ

以下は `agent_prompt_flagged.md` と `agent_prompt_unflagged.md` に記載済みだが、今後改定する場合も必ず含める:

- 「**バッチごとに逐次保存**。1 バッチ (50 件) 完了ごとに即 Write、3 バッチまとめて一括書き出しは禁止」 — **これが最重要**。理由もプロンプト内で明示する (下記 §7.6.1)
- 「**入力件数 = 出力件数** を各バッチ書き出し後に Read で確認せよ」
- 「画像 Read でエラーが出た場合は 2-3 回リトライし、それでも失敗したら rowIndex と原因を明示的に報告せよ (unclear に逃げない)」
- 「`verdict_counts` を自分で数えない (集計は親スクリプト側で items から再計算)」
- 「完了時は全 3 バッチ Read して件数を自己検証してから『全 N 件保存完了』と明記。途中中断時はどこまで書き出し済みかを明示報告せよ」

### 7.6.1 バッチ逐次保存の徹底 (中断耐性の要)

Agent が「3 バッチ分 150 件をまとめて判定してから最後に一括で書き出す」挙動を取ると、レート制限 / 使用量制限ヒット時に**書き出し前の判定が全損する**。プロンプトには判定フローの手順として「1 バッチ処理 → 即 Write → 次バッチ処理 → 即 Write」を明記し、さらに**なぜ逐次保存が必要か (中断で判定がロストする、親は書き出されたファイルしか見ない)** を Agent 自身に理解させる。

単に「Write せよ」と書くだけでは、Agent が効率化の名目で「まとめて書く」判断をしかねない。2026-04 の検証でも Agent 03 / 17 が途中で transcript 切れを起こしたが、彼らは 1 バッチずつ書き出すルールを守っていたため、復帰時に未完了バッチだけやり直せた (既完了バッチの判定は失われていない)。この挙動を再現するには**理由込みのプロンプト**が必要。

### 7.7 親 Claude / Agent の GT 判定は 100% 正確ではない

Opus でも誤判定は発生する。2026-04-18 の実績:
- マイナーキャラ名 (サンリオ系「ウサハナ」等) を知らず rescue 判定
- 韓国コスメブランド名 (「FARMSTAY」等) を誤って部分文字列マッチ由来の誤判定扱い
- 絵文字・記号入りの「〇〇様♪★専用」表記を見落とし

対策:
- **スポットチェック (§4.6.5) で見つけたら都度訂正**。作業中に全件レビューは不可能なので、代表サンプルだけでも人の目で見る
- Agent プロンプトでは「知らないブランド/キャラは画像の実体を優先して判定せよ」と明示する
- 最終レポート作成時にユーザーが気になる rowIndex をスポットレビューして訂正を反映する

**誤判定を前提に運用する**こと。GT を「正解」ではなく「Opus による一次判定 + 人手で訂正された結果」と位置づける。

### 7.8 使用制限への対処

| 制限種別 | リセット | 対処 |
|---|---|---|
| レート制限 (単体 Agent の短時間大量消費) | 数分〜 15 分 | 15 分待って再試行 (1 回だけ) |
| 使用量制限 (5 時間窓) | 約 5 時間 | progress.json の `last_error` に記録し、リセット待ち |
| 日次使用量制限 | 翌日 JST 6 時頃 (Claude プランの窓) | 同上。翌朝再開 |

制限ヒット時の progress.json への記録:

```json
{
  "completed_batches": [0, 1, 2, ...],
  "total_batches": 97,
  "started_at": "...",
  "last_updated_at": "...",
  "last_error": {
    "at": "YYYY-MM-DDTHH:MM:SS+09:00",
    "agent": "Agent NN",
    "kind": "usage_limit_5h | usage_limit_daily | rate_limit",
    "detail": "(エラーメッセージ抜粋)"
  }
}
```

再開時は `completed_batches` に含まれない最小バッチ番号から次の Agent を起動。

---

## 8. レポートの書き方

`reports/YYYY-MM-DD_<phase>.md` に振り返りを書く (git 管理外、手元にのみ残る)。手元に過去レポートが残っていれば雛形としてコピー改変できる (git 履歴には無いので手元ファイル頼み)。必須セクション:

1. 結論 (要点 3 行)
2. 結果サマリー (verdict 分布、カテゴリ別精度 or 見落とし内訳)
3. プロセスの振り返り (計画 → 実績、使用制限ヒット回数、Agent 早期終了回数)
4. 誤判定パターン分析 (頻出キーワード・代表例)
5. 辞書改善の具体提案 (優先度 1〜3 付き)
6. 精度改善の試算 (優先度 1〜2 実装後の期待値)
7. 今後の運用への注意点 (次回検証時に改善すべき点)
8. 成果物一覧
9. ユーザーへの相談事項 (辞書改善の採否判断が必要なもの)

Phase C 完了後は Phase A / B 両方のレポートに統合 P/R/F1 を追記する。

### 8.1 辞書改善提案時の原則 (レポート §5 を書くときの指針)

過去検証で得た教訓:

- **辞書の肥大化は受け入れる**。Claude の訓練データは最新化できず、新ブランド / 新キャラクター / 新商品名は明示的に辞書追加しないと気付けない。`.includes()` ベースなので数千語に増えてもパフォーマンス問題はない
- **多義的な一般語は辞書に入れない**。例: 「パウダー」単独は食品 (プロテイン / ベーキング) ・工芸 (クロムパウダー / グリッター) ・DIY (エイジング) で多用され、入れると誤爆が増える。**化粧品専用の複合語**「ルースパウダー」「フェイスパウダー」等のみ登録する
- **短語の誤爆は notWith で対処を優先**。単語境界マッチや組み合わせマッチを実装する前に、`notWith` で文脈除外できないか検討する (2026-04-18 の実績: 7 語を notWith 化して 9 件の rescue をゼロにできた)
- **採用候補の可否判断**: GT に該当行がないのに机上の想定で追加しない (例: 「マカロン」は非食品文脈で「マカロンお守り」等もあり得るため慎重に扱う)

---

## 9. 関連資料

- `docs/research/mercari/keywords_design_notes.md` — 辞書設計原則 (notWith, withAll 等のパターン)
- `procedures/exclude_by_keywords/keywords.json` — 辞書本体
- `research/exclude_by_keywords.js` — 判定スクリプト (CLI 実行用)
- `research/_classifier.js` — 共通分類ロジック (`01_prepare.js` から呼ばれる)
- `references/注意商品.pdf`, `references/new仕入れ禁止商品_アパレル.pdf` — 除外対象の基準

### 用語の定義

| 用語 | 意味 |
|---|---|
| **仕入れ候補** | 中国輸入物販で仕入れ対象になりうる商品 (ブランド・キャラ・食品等に該当しないもの) |
| **flagged** | `exclude_by_keywords.js` が除外対象と判定した行 (`exclusion !== null`) |
| **unflagged** | スクリプトが判定しなかった行 (`exclusion === null`)。仕入れ候補プールに残る |
| **primary** | 複数カテゴリにマッチした場合の代表カテゴリ。優先度順で決定 |
| **matches** | マッチした全カテゴリと実際にヒットしたキーワードの辞書 |
| **exclusion** | flagged 行に付く `{ primary, matches }` オブジェクト。unflagged は `null` |
| **ground truth (GT)** | 正解データ。Opus + 画像で判定した結果 (100% 正確ではなく、ユーザーレビューで訂正される前提) |
| **verdict (flagged)** | `exclude` (除外判定が正しい) / `rescue` (誤判定) / `unclear` (判別困難) |
| **verdict (unflagged)** | `keep` (仕入れ候補でよい) / `exclude` (辞書の見落とし) / `unclear` (判別困難) |
