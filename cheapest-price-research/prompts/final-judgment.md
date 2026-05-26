# 最安値リサーチ 第 6 段階: 最終判定プロンプト

procedures/cheapest-price-research.md の第 6 段階 (final_identity_judgment_step) で Sonnet サブエージェントに渡すプロンプト本体。

呼び出し側は `{TARGET_DETAIL_ABS_PATH}` / `{TARGET_IMAGE_PATHS}` / `{CANDIDATE_DETAIL_ABS_PATH}` / `{CANDIDATE_IMAGE_PATHS}` / `{CANDIDATE_RANK}` / `{CANDIDATE_ID}` / `{OUTPUT_JSON_ABS_PATH}` を実値に置換してから Agent に渡す。

---

## 【絶対禁則】ファイル操作の制約

1. 指定出力パス以外にファイルを作成しない
2. 入力ファイルを書き換えない (Read のみ可)
3. プロジェクト内の他ファイルを変更しない (Edit / Write / NotebookEdit は出力パスへの 1 回の書き込みのみ)
4. 違反しそうな操作は実行せず報告する

---

## タスク

中国輸入物販の最安値リサーチで、対象商品と候補 1 件が同一商品かを最終判定する。

**最終判定の意義**: 1 次フィルタ (画像 + タイトル) で残った候補について、説明文と全画像を使って実体属性 (色・サイズ・個数・セット数・柄・素材・用途) の一致を最終確認する。**ここで `sameProduct=true` になった候補が、その商品の「現在販売中の最安値」として確定する** (検索が価格昇順なので 1 件目のヒット = 最安値)。

## 入力

### 対象商品 (target)

- 詳細 JSON: `{TARGET_DETAIL_ABS_PATH}` ← Read で読む
- 画像 (全枚数): `{TARGET_IMAGE_PATHS}` ← それぞれ Read で必ず画像認識すること

詳細 JSON の構造:
```
{
  id, title, price, shipping,
  seller_id, seller_name, days_ago,
  images (URL 配列),
  description_head (商品説明文 先頭 500 字),
  attrs (商品の状態 / 配送方法 等)
}
```

### 候補商品 (candidate)

- rank: {CANDIDATE_RANK} (1 商品 1 バッチ内の価格昇順順位)
- id: {CANDIDATE_ID}
- 詳細 JSON: `{CANDIDATE_DETAIL_ABS_PATH}` ← Read で読む
- 画像 (全枚数): `{CANDIDATE_IMAGE_PATHS}` ← それぞれ Read で必ず画像認識すること

詳細 JSON の構造は target と同じ。

## 同一商品判定の前提

メルカリの中国輸入品は、出品者が他出品者通報リスクを避けるためタイトル・画像・説明文を意図的に変えて出品する慣習がある。よって「タイトル文字列の一致」ではなく **実体属性 (色・サイズ・個数・セット数・柄・素材・用途) の一致** で同一商品を判定する。

別商品扱いになる軸:

| 軸 | 例 |
|---|---|
| 色 | 白 / 黒 / ベージュ / ブラウン / シルバー / ゴールド 等 |
| サイズ | S / M / L / XL、A3 / A4 / B4、80×120 等 |
| 個数・セット数・容量 | 2 個セット / 5 枚セット / 500g / 100 枚 等 |
| 柄 | 無地 / 花柄 / チェック / 迷彩 等 |
| 素材 | 本革 / 合皮 / ナイロン / ポリエステル 等 |
| 用途・機能 | ショルダーバッグ / トートバッグ / クラッチバッグ 等 |

判定例集: `/Users/kawasaki/Documents/work_source/2026_04_10_reselling/reselling/docs/research/mercari/judgment_examples/README.md`

## 画像優先の原則

画像と説明文・タイトルに矛盾がある場合 (例: 画像が黒、説明文に「白」と書いてある等) は **画像を優先** する。タイトル・説明文は出品者が誤記する/省略することがあるが、画像は実物そのものを示す。target と candidate のどちらにこの矛盾があっても同様。

## 判定手順

1. target と candidate の **タイトル** を比較し、明示されている属性を抽出
2. target と candidate の **説明文 (description_head)** を比較し、タイトルに無い属性 (寸法・素材詳細・セット内容等) を補完
3. target と candidate の **全画像** を Read で確認し、色・形状・柄・素材の実体一致を確認
4. 全 6 軸 (色 / サイズ / 個数 / 柄 / 素材 / 用途) について「一致 / 不一致 / 不明」を判定
5. **どれか 1 軸でも明らかに不一致なら `sameProduct=false`**
6. 全軸が「一致」または「不明」なら `sameProduct=true`

## 出力

`{OUTPUT_JSON_ABS_PATH}` に以下の JSON 形式で書き出す:

```json
{
  "candidateId": "m12345",
  "candidateRank": 3,
  "candidatePrice": 980,
  "candidateUrl": "https://jp.mercari.com/item/m12345",
  "sameProduct": true,
  "axes": {
    "color":    { "verdict": "match",    "target": "黒", "candidate": "黒" },
    "size":     { "verdict": "unknown",  "target": null, "candidate": null },
    "quantity": { "verdict": "match",    "target": "1本", "candidate": "1本" },
    "pattern":  { "verdict": "match",    "target": "V字スタッズ", "candidate": "V字スタッズ" },
    "material": { "verdict": "unknown",  "target": "合皮(推定)", "candidate": "合皮(推定)" },
    "purpose":  { "verdict": "match",    "target": "ベルト", "candidate": "ベルト" }
  },
  "reason": "色 (黒)・形状 (V 字スタッズ)・個数 (1 本)・用途 (ベルト) が画像とタイトルで一致。説明文も '幅 3.5cm レザー調' と一致。サイズ・素材はどちらも明記なしだが画像から齟齬なし。"
}
```

- `axes` の verdict は `match` / `mismatch` / `unknown` のいずれか
- 1 軸でも `mismatch` があれば `sameProduct: false`
- `reason` は判定根拠を 1〜3 文で記述。どの軸で一致 / 不一致 / 不明かを必ず書く

## 完了報告

書き出し完了後、以下を報告する:

- 出力パス
- `sameProduct` の値
- `axes` の各軸の verdict サマリ
- `reason` の本文
