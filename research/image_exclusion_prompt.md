# Agent プロンプト: 画像除外 (image_exclusion_step)

第 4 段階の画像除外 (本番リサーチパイプラインの二次フィルタ) で Sonnet Agent に渡すプロンプト。

**使い方**: 下記「プロンプト本文」全文をコピーし、`{BATCH_PATHS}` と `{RESULT_PATHS}` を実パス (改行区切りの複数行可) に置換して Agent (`subagent_type=general-purpose`, `model=sonnet`) の `prompt` 引数に渡す。

---

## verdict 定義

| verdict | 意味 | 後段への扱い |
|---|---|---|
| `keep` | 画像 + タイトルを見ても除外すべき理由が見当たらない | 第 5 段階 (構造化抽出) へ |
| `exclude` | 画像 + タイトルを見ると `keywords.json` の除外カテゴリのいずれかに該当する | 仕入れ候補から除外 |
| `unclear` | 画像 + タイトルを見ても判別困難 (画像不鮮明・主役不明等) | keep と同じく第 5 段階へ |

---

## プロンプト本文 (Agent に渡す)

```
【絶対禁則】ファイル操作の制約

以下を厳守すること。違反しそうな操作を察知したら実行せず、即座に停止して人間に報告する。

1. 出力先として明示された result.json 以外のファイルを Write / Edit / NotebookEdit してはならない
2. 入力ファイル (batch_*.json、images/*.webp、keywords.json) を一切書き換えない
3. プロジェクト内の他ファイル (手順書、スクリプト、辞書、ADR 等) を変更しない
4. 上記以外のファイルシステム書き込み操作 (mkdir / mv / rm 等) を行わない

---

あなたはメルカリ売れ筋リサーチの画像除外ステップ (第 4 段階内) の判定担当です。中国輸入物販の仕入れ候補プールから、キーワード辞書では拾えなかった除外対象 (新ブランド・新キャラクター・食品等) を画像 + タイトルで救い上げる役割です。

## 担当バッチ (計 150 件、3 ファイル)

{BATCH_PATHS}

## 出力先 (各バッチに対応、計 3 ファイル)

{RESULT_PATHS}

## 判定軸: verdict 3 値

- **keep**: 画像 + タイトルを見ても除外理由が見当たらない (仕入れ候補としてよい)
- **exclude**: 画像 + タイトルが除外カテゴリのいずれかに該当する (= 辞書では拾えなかった見落とし)
- **unclear**: 画像不鮮明 / 主役不明 / 判別困難 (最終手段)

## 除外カテゴリ

判定基準の一次資料は `procedures/exclude_by_keywords/keywords.json` の `priority` 配列。各カテゴリ名 (food / plant_quarantine / medical / cosmetics_yakki / character_copyright / brand_imitation / electronics_check / handmade / underwear / sourcing_unavailable / media 等、辞書追加で増える可能性あり) は禁止理由を表す。

各カテゴリの法令根拠原文は `references/注意商品.pdf` (page 5-6 の法令一覧、page 1-4 のブランド・キャラ例) に記載。判定基準の整理版は `procedures/exclude_by_keywords_precision_check/agent_prompt_unflagged.md` の「除外カテゴリの定義」「連想デザイン NG 一覧」「その他の法令注意点」「短語誤爆に惑わされない」セクションに集約済 (本プロンプトでは重複を避ける)。**疑わしい/判定迷う場合は PDF を直接 Read して原文に当たること** (詳細は判定フローの e を参照)。

## 判定フロー (バッチごとに逐次保存)

担当 3 バッチを **順番に 1 バッチずつ** 処理する。1 バッチ (50 件) を判定し終えたら **即座に** 対応する batch_NNN_result.json を Write してから次のバッチへ進む。**3 バッチ分 150 件をまとめて判定してから一括書き出すのは禁止**。

### なぜ逐次保存が必須か

このジョブは Anthropic 側のレート制限 / 使用量制限で途中中断する可能性がある (precision_check Phase B で実績あり)。中断時点で **書き出していないバッチの判定は完全に失われる**。1 バッチ完了ごとに即保存していれば、中断しても前のバッチ分は復帰時に再利用できる。親セッションは書き出された result.json の存在をもって進捗判断するため、**判定が終わっているのに書き出されていない = 判定していないのと同じ** 扱いになる。

### 手順

1. batch_<1 つ目>.json を Read
2. items 配列の各要素について:
   a. image_path を Read で画像認識 (Read エラーは 2-3 回リトライ、それでも失敗したら verdict = "ERROR" + reason に原因明示)
   b. title + 画像 を照合し、除外カテゴリに該当するか判定
   c. 該当 → verdict = "exclude" / reason = カテゴリ名 + 30 字以内の理由
   d. 該当せず → verdict = "keep" / reason = 30 字以内の根拠
   e. 判別困難 (= unclear としようとした場合): まず `references/注意商品.pdf` を Read で再確認する (page 5-6 が法令一覧、page 1-4 がブランド・キャラ例)。PDF を読むことで該当する法令カテゴリが見つかれば exclude に倒す。それでも判定不能なら verdict = "unclear" / reason = 困難な理由
3. **50 件判定が終わったら即 batch_<1 つ目>_result.json を Write**
4. 次のバッチに進み、1〜3 を繰り返す
5. 全 3 バッチ完了したら、各 result.json を Read して件数が 50 件ずつ揃っていることを自己検証し、「全 150 件保存完了」と報告

## 出力フォーマット

各 batch_NNN_result.json:

{
  "batch_id": NNN,
  "items": [
    {
      "rowIndex": 123,
      "title": "商品タイトル",
      "image_path": "/abs/path/to/images/123.webp",
      "verdict": "keep",
      "reason": "30 字以内の根拠",
      "judged_at": "YYYY-MM-DDTHH:MM:SS+09:00"
    }
  ]
}

## 遵守事項

- バッチごとに逐次保存 (1 バッチ完了ごとに即 Write、一括書き出しは禁止)
- 入力件数 = 出力件数 を各バッチ書き出し後に Read で確認 (50 件ずつ、全 3 バッチで合計 150 件)
- 画像 Read エラーを unclear に逃がさない (verdict = "ERROR" を立てて rowIndex と原因を明示)
- verdict_counts を自己集計しない (集計は親スクリプト aggregate_image_review.js が行う)
- 判断に迷ったら unclear ではなく、より確度の高い選択を選ぶ (unclear は本当に判別不能な場合のみ)
- 完了報告: 全 3 バッチ完走時に「全 150 件保存完了」と明記。途中で停止する場合はどのバッチまで書き出し済みかを明示報告

## 完了条件

すべての batch_NNN_result.json が書き出され、各 items 件数が入力と一致することを自分で Read で確認してから報告すること。
```
