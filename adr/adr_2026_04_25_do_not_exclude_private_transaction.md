# ADR: private_transaction (取引専用表記) を除外対象にしない

**日付**: 2026-04-25

## ステータス

採用 (Accepted)

## 決定

メルカリタイトルの「〇〇様専用」「〇〇様リクエスト」「〇〇さま専用」「〇〇さまリクエスト」「〇〇さん専用」等、取引専用ページを示す表記を含む商品を **機械的な除外対象にしない**。通常の仕入れ候補プールに残し、同一商品判定は v2 第 6 段階 6-2 (Sonnet + 画像による同一商品判定) で画像から実体属性を捉えて行う。

## 根拠

タイトルに商品情報がなくても、画像判定で同一商品クラスタに集約できる。

例: [`../reports/2026/04/2026_04_24_02_メルカリ売れ筋リサーチ_v2.csv`](../reports/2026/04/2026_04_24_02_メルカリ売れ筋リサーチ_v2.csv) の `maさま` クラスタ (`ネックレス_チェーンネックレス_019`、3 件、仕入れ候補フラグあり) — タイトルが `maさま` のみで商品情報ゼロだが、画像判定で 3 件が正しく 1 クラスタに集約された。物販オーナーは代表 URL 3 件を画像で確認して判断できるため、タイトルの情報希薄性は仕入れ判断の障害でなくなった。

## 検討経緯

| 日付 | 判断 | 根拠 |
|---|---|---|
| 〜2026-04-17 | 辞書あり (旧 `private_transaction` カテゴリ) | 取引専用ページを機械的除外 |
| 2026-04-18 | 廃止 | 物販オーナー「取引専用でも第三者購入できるケースあり、除外不要」 |
| 2026-04-19 | 復活 | タイトル 40 字制限で情報欠落し判断不能、`withAll` で組み合わせ判定 |
| 2026-04-25 | 再廃止 (本 ADR で確定) | v2 第 6 段階画像判定で実体属性を捉えられ、復活の根拠が消滅 |

## トレードオフ

- **デメリット**: 情報希薄タイトル (`様専用` / `maさま` 等) が仕入れ候補プールに残る。第 4 段階画像除外と第 5・6 段階の処理対象が増える
- **メリット**: 画像判定で実体属性を捉えて同一商品クラスタに集約できるため、情報希薄なタイトルでも仕入れ候補として扱える。「maさま」のように画像判定で正しくまとまるケースを取りこぼさない

## 関連ドキュメント更新 (2026-04-25)

- [`../procedures/exclude_by_keywords/keywords.json`](../procedures/exclude_by_keywords/keywords.json): `priority` と `keywords` から `private_transaction` を削除
- [`../docs/research/mercari/keywords_design_notes.md`](../docs/research/mercari/keywords_design_notes.md): カテゴリ優先順の列挙と注釈から削除
- [`../research/image_exclusion_prompt.md`](../research/image_exclusion_prompt.md): カテゴリ一覧から削除
- [`../procedures/exclude_by_keywords_precision_check/README.md`](../procedures/exclude_by_keywords_precision_check/README.md) §7.4: スポットチェック観点から削除
- [`../procedures/exclude_by_keywords_precision_check/agent_prompt_unflagged.md`](../procedures/exclude_by_keywords_precision_check/agent_prompt_unflagged.md): 「除外 9 カテゴリ」→「除外 8 カテゴリ」、判定 9 項目目を削除

2026-04-18 〜 2026-04-19 時点の精度検証結果の数値記述 (例: 「4/16 データで 364 件除外」) は当時の事実として各所に残す。
