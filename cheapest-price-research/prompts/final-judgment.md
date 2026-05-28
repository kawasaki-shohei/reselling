# 最安値リサーチ 第 6 段階: 画像最終確認プロンプト

`procedures/cheapest-price-research-cowork.md` の第 6 段階 (image_final_confirmation_step) で Sonnet サブエージェントに渡すプロンプト本体。

第 5 段階の機械照合 (7 軸完全一致照合) で残った候補 1 件について、**対象画像 vs 候補画像** を Sonnet が並べて見て、最終的に同一商品か判定する。

呼び出し側は `{TARGET_IMAGE_PATHS}` / `{CANDIDATE_IMAGE_PATHS}` / `{TARGET_DETAIL_ABS_PATH}` / `{CANDIDATE_DETAIL_ABS_PATH}` / `{CANDIDATE_RANK}` / `{CANDIDATE_ID}` / `{CANDIDATE_PRICE}` / `{CANDIDATE_URL}` / `{OUTPUT_JSON_ABS_PATH}` を実値に置換してから Agent に渡す。

---

## 【絶対禁則】ファイル操作の制約

1. 指定出力パス以外にファイルを作成しない
2. 入力ファイルを書き換えない (Read のみ可)
3. プロジェクト内の他ファイルを変更しない (Edit / Write / NotebookEdit は出力パスへの 1 回の書き込みのみ)
4. 違反しそうな操作は実行せず報告する

---

## タスク

中国輸入物販の最安値リサーチで、対象商品と候補 1 件が同一商品かを **画像で最終確認** する。

**位置づけ**: 第 5 段階の機械照合で「7 軸属性が一致」と判定された候補について、対象画像と候補画像を 1 対 1 で見比べて確認する最後の関門。価格昇順なので、ここで `sameProduct=true` になった候補がその商品の「現在販売中の最安値」として確定する (= 検索 1 件目のヒット = 最安値)。

**なぜ画像最終確認が必要か**: 機械照合 (7 軸) は属性抽出 Agent の判定に依存する。属性抽出 Agent が誤って属性を付けた場合 (例: タイトル盛り盛り商品で画像優先原則を適用し損ねた場合)、機械照合で誤って「一致」になることがある。これを画像 1 対 1 比較で救う。

## 入力

### 対象商品 (target)

- 詳細 JSON: `{TARGET_DETAIL_ABS_PATH}` ← Read で読む (タイトル / 説明文 / 価格を確認するため、参考情報)
- 画像 (全枚数): `{TARGET_IMAGE_PATHS}` ← それぞれ Read で必ず画像認識すること

### 候補商品 (candidate)

- rank: `{CANDIDATE_RANK}` (1 商品 1 バッチ内の価格昇順順位)
- id: `{CANDIDATE_ID}`
- 価格: `{CANDIDATE_PRICE}`
- URL: `{CANDIDATE_URL}`
- 詳細 JSON: `{CANDIDATE_DETAIL_ABS_PATH}` ← Read で読む (タイトル / 説明文を確認、参考情報)
- 画像 (全枚数): `{CANDIDATE_IMAGE_PATHS}` ← それぞれ Read で必ず画像認識すること

## 同一商品判定の前提 (必読)

メルカリの中国輸入品は、出品者が他出品者通報リスクを避けるためタイトル・画像・説明文を意図的に変えて出品する慣習がある。よって「画像が完全に同じ」ではなく **実体属性 (色・サイズ・個数・セット数・柄・素材・用途) の一致** で同一商品を判定する。

具体例 (実際にあったケース、`docs/research/mercari/judgment_examples/` 参照):
- ウェリントン型偏光調光サングラス: 出品者 A は装飾の多いテンプレ A、出品者 B は「訳あり特価」を強調したテンプレ B。画像のデコレーション・構図・テキストレイアウトは完全に違うが、**フレームの形状・色・機能** は同一 → `sameProduct=true`
- キルティングトートバッグ A4 黒: 出品者によって背景や小物・モデルの服装が違っても、**バッグの形状・キルティング柄・色・素材・付属物** が一致すれば → `sameProduct=true`

**画像のテンプレ違い・装飾違い・背景違いは別商品とみなさない**。実体属性で判定すること。

## 判定軸

| 軸 | 判定方法 |
|---|---|
| 色 | 画像で同じ色か |
| サイズ | 画像内の寸法表記またはタイトル / 説明文の数値で同じか |
| 個数・セット数 | 画像で見える数量 + タイトル / 説明文の表記で同じか |
| 柄 | 画像で柄が同じか (無地 / 花柄 / キルティング 等) |
| 素材 | 画像での質感 + 説明文で同じか |
| 形状・用途 | 画像で同じカテゴリ・形状か |

**1 軸でも明らかに違えば `sameProduct=false`**。全軸が「一致」または「不明」なら `sameProduct=true`。

## 画像優先の原則

タイトル / 説明文 と画像で矛盾がある場合は **画像を優先**。出品者がタイトルを盛る/誤記することがあるが、画像は実物そのものを示す。target と candidate のどちらにこの矛盾があっても同様。

## 出力

`{OUTPUT_JSON_ABS_PATH}` (= `final_judgment/{CANDIDATE_ID}.json`) に以下の JSON 形式で書き出す:

```json
{
  "candidateId": "{CANDIDATE_ID}",
  "candidateRank": {CANDIDATE_RANK},
  "candidatePrice": {CANDIDATE_PRICE},
  "candidateUrl": "{CANDIDATE_URL}",
  "sameProduct": true,
  "reason": "対象と候補で形状 (ひし形キルティング全面)・色 (黒)・素材 (ナイロン)・付属物 (白い毛玉キャラクター) が一致。出品者は異なるが背景・構図も酷似。同一商品と判定。"
}
```

- `sameProduct`: bool (true / false)
- `reason`: 1〜3 文。**どの軸で一致したか、どの軸で違ったかを必ず明記**。`sameProduct=false` の場合は決定的な mismatch の軸と内容を書く

## 手順

1. 対象詳細 `{TARGET_DETAIL_ABS_PATH}` を Read (タイトル / 説明文を把握、参考情報)
2. 候補詳細 `{CANDIDATE_DETAIL_ABS_PATH}` を Read (タイトル / 説明文を把握、参考情報)
3. 対象画像 `{TARGET_IMAGE_PATHS}` を全枚数 Read で画像認識
4. 候補画像 `{CANDIDATE_IMAGE_PATHS}` を全枚数 Read で画像認識
5. 上記「判定軸」に従って 6 軸を確認 (1 軸でも mismatch なら false)
6. 出力 JSON を Write
7. 完了報告

## 完了報告

書き出し完了後、以下を報告する:

- 出力パス
- `sameProduct` の値
- `reason` の本文
- 判定で迷った点があれば追記 (次 run のプロンプト改善のため)
