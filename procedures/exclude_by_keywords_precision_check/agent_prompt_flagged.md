# Agent プロンプトテンプレート: flagged 判定

Phase A (flagged 全件判定、Precision 測定) で Agent に渡すプロンプトのテンプレート。

**使い方**: 下記の本文をコピーし、`{BATCH_PATHS}` と `{RESULT_PATHS}` を実パスに置換して Agent の `prompt` 引数に渡す。

---

## verdict 定義 (flagged 側)

| verdict | 意味 |
|---|---|
| `exclude` | スクリプトの除外判定が**正しい**。本当に仕入れ候補外 |
| `rescue` | スクリプトの判定が**誤り**。本当は仕入れ候補になりうる (救済すべき) |
| `unclear` | 画像を見ても人間でも判別困難な微妙なケース |

---

## プロンプト本文 (Agent に渡す)

```
あなたはメルカリ売れ筋リサーチの除外判定 GT (正解データ) を作る担当です。

## 背景

中国輸入物販の仕入れ候補抽出辞書 procedures/exclude_by_keywords/keywords.json の精度検証を実施しています。辞書の script (exclude_by_keywords.js) が「除外」と判定した行 (flagged) が、本当に除外すべきか、それとも辞書の誤判定で救済すべきかを、画像 + タイトルから人間の目線で判定してください。

## あなたの担当

以下 3 つのバッチ (計 150 件) を判定:

{BATCH_PATHS}

判定結果を以下に書き出す (各バッチの入出力は 1:1 対応):

{RESULT_PATHS}

## verdict 3 値

- **exclude**: script 判定が正しい。画像 + タイトルを見ても除外対象で間違いない
- **rescue**: script 判定が誤り。画像を見たら一般雑貨・非版権品・非食品で、本来は仕入れ候補
- **unclear**: 画像を見ても判別困難

## 判定基準

primary カテゴリとヒットしたキーワード (matches) が画像の実体と一致するか判定:

| 入力例 | 画像 | verdict | 理由 |
|---|---|---|---|
| primary=food, matches=["ふきのとう"], title="ふきのとう模様の手ぬぐい" | 手ぬぐい | rescue | 食品ではなく雑貨 |
| primary=food, matches=["ふきのとう"], title="天然ふきのとう 200g" | 山菜 | exclude | 本当に食品 |
| primary=character_copyright, matches=["ピカチュウ"], title="ピカチュウ風 量産ピアス" | 黄色いクマ (ピカチュウではない) | rescue | キャラ本体ではない |
| primary=cosmetics_yakki, matches=["洗顔"], title="洗顔パフ 2点セット" | タオル・パフ | rescue | 雑貨、薬機法対象外 |

判定の軸:
- 画像の実体が primary/matches と**一致** → `exclude`
- 画像の実体が primary/matches と**無関係** → `rescue`
- 画像を見ても判断できない → `unclear`

## 既知の誤マッチパターン (これらは基本 rescue)

タイトルに短語が含まれて誤マッチするパターン。画像で実体を確認すれば正しく判定できる:

- `ウタ` → アウター/ボウタイ (K-POP ではない)
- `シュガ` → ラッシュガード (BTS シュガではない)
- `ガム` → ギンガム (チューインガムではない)
- `マカ` → マカロン (食品ではない)
- `オレンジ` → 色名 (食品ではない)
- `チョコ` → 色名 (食品ではない)
- `ハンドメイド` → ハンドメイド素材 (完成品ではない)
- `RM` → FARMSTAY / ARMY / DERMA 等の部分文字列
- `キャンディ` → キャンディイエロー (色名) / キャンディボンボン柄
- `アイス` → アイスヤーン (毛糸ブランド)

## 判定フロー (重要: バッチごとに逐次保存)

あなたは担当する 3 バッチを**順番に 1 バッチずつ処理する**。1 バッチ (50 件) を判定し終えたら**即座に** batch_NNN_result.json を Write してから次のバッチへ進む。**3 バッチ分 150 件をまとめて判定してから最後に 3 ファイル一括で書き出すのは禁止**。

### なぜ逐次保存が必要か

このジョブは Anthropic 側のレート制限 / 使用量制限で途中中断する可能性がある (実績あり)。中断時点で**書き出していないバッチの判定は完全に失われる**。1 バッチ (50 件) 完了ごとに即保存していれば、中断しても前のバッチ分は復帰時に再利用できる。親セッションは書き出された result.json の存在をもって進捗判断するため、**判定が終わっているのに書き出されていない = 判定していないのと同じ**扱いになる。

### 手順

1. batch_<1 つ目>.json を Read
2. items 配列の各要素について:
   a. image_path を Read で画像認識
   b. title + primary + matches + 画像の実体を照合
   c. exclude / rescue / unclear を判定
   d. gt_reason に理由を 30 字以内で記載
3. **50 件判定が終わったら即 batch_<1 つ目>_result.json を Write**
4. 次のバッチに進み、1〜3 を繰り返す
5. 全 3 バッチ完了したら、各 result.json を Read して件数が 50 件ずつ揃っていることを自己検証し、「全 150 件保存完了」と報告

## 出力フォーマット (batch_NNN_result.json)

```
{
  "batch_id": NNN,
  "items": [
    {
      "rowIndex": 123,
      "title": "商品タイトル",
      "primary": "food",
      "matches": {...},
      "image_path": "/absolute/path/to/images/123.webp",
      "gt_verdict": "exclude",
      "gt_reason": "山菜食品で判定正当",
      "judged_at": "YYYY-MM-DDTHH:MM:SS+09:00",
      "judged_by": "Opus 4.7 (subagent)"
    }
  ]
}
```

## 遵守事項 (必ず守る)

- **バッチごとに逐次保存**: 1 バッチ (50 件) 完了ごとに即 Write。3 バッチまとめて最後に一括書き出しは禁止 (中断時にロストするため)
- **入力件数 = 出力件数** を各バッチ書き出し後に Read で確認する (50 件ずつ、全 3 バッチで合計 150 件)
- **画像 Read エラーを unclear に逃がさない**: 2-3 回リトライし、失敗したら rowIndex と原因を明示的に報告する (gt_verdict = "ERROR" でよい)
- **verdict_counts を自己集計しない** (集計は親スクリプト側で items から再計算)
- **完了報告の形式**: 全 3 バッチ完走時に「全 150 件保存完了」と明記。途中で使用制限にヒットして停止する場合は、どのバッチまで書き出し済みか (例: 「batch_000_result.json と batch_001_result.json は保存済み、batch_002 は未処理」) を報告する

## 完了条件

すべての batch_NNN_result.json が書き出され、各 items 件数が入力と一致することを自分で Read で確認してから報告してください。
```
