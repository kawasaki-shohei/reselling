---
description: 物販オーナー向けに、商品画像と URL を添えた辞書改善などの判断依頼 md を作成します
---

# 物販オーナー向け判断依頼 md の作成

メルカリリサーチの辞書改善・仕入れ方針などについて、物販オーナーに判断を仰ぐための md を作成します。
商品の画像・商品URL・GT 判定結果を 1 ファイルにまとめ、後工程で Google Drive にアップロードして共有できる形にします。

---

## 事前確認 (判断テーマを聞く前に必ず実施)

判断依頼 md には「既に方針が固まっている項目」を含めてはいけない。ユーザーから判断テーマを聞く前に、以下 4 点を確認して既存方針を把握する。

| 対象 | 目的 |
|---|---|
| `docs/research/mercari/keywords_design_notes.md` | keywords.json の設計原則・パターン (短語の扱い、notWith / withAll の使い分け) を把握した上で質問を組み立てる |
| `references/注意商品.pdf` | 仕入れ禁止カテゴリ (法令リスク・ブランド・キャラ) の全体像 |
| `references/new仕入れ禁止商品_アパレル.pdf` | アパレル特化の禁止事例集 (未登録ブランド・柄の個別事例) |
| `procedures/exclude_by_keywords/keywords.json` | 現行で既に除外キーワード・notWith・withAll が定義されている項目。これに含まれるテーマは原則として再質問しない |

ユーザーが提示した判断テーマが既存方針で結論済みの場合:

- ユーザーに「既に `<対象ファイル>` に記載があります」と伝え、本当に再判断が必要か確認してから進める
- 判断せずに強行して md を作らない

---

## 入力として確認する情報

以下をユーザーに質問してから作業を開始してください:

1. **判断テーマ**: いくつあるか。各テーマのタイトル・背景説明・質問文・選択肢
2. **対象 rowIndex**: 各テーマに紐づく商品の rowIndex (複数可)
3. **入力元ファイル** (デフォルトで直近のものがあれば提案):
   - `flagged_all.json` (タイトル・first_id・thumbnail_url・image_path の取得元)
   - `merged_gt.json` (gt_verdict・gt_reason の取得元)
   - 画像ディレクトリ (例: `tmp/2026/04/17/step_c_images/{rowIndex}.webp`)
4. **出力ディレクトリ名**: `tmp/YYYY/MM/DD/{dirname}/` の `dirname` 部分

---

## 作成手順

1. `date '+%Y-%m-%d %H:%M:%S %Z'` で JST の日付を確認
2. 出力先ディレクトリを作成:
   - `tmp/YYYY/MM/DD/{dirname}/scripts/`
   - `tmp/YYYY/MM/DD/{dirname}/images/`
3. 各 rowIndex について情報を収集:
   - `flagged_all.json` から `title` / `first_id` / `thumbnail_url` / `image_path` を取得
   - `merged_gt.json` (items 配列) から `gt_verdict` / `gt_reason` を取得
   - 商品URL: `https://jp.mercari.com/item/{first_id}` で組み立て
   - 画像をコピー: 入力側の `tmp/.../{rowIndex}.webp` → 出力側 `images/{rowIndex}.webp`
4. md を以下の構成で生成:
   - H1 タイトル: 「{内容の要約} の判断依頼 (YYYY-MM-DD)」
   - `## 背景`: 質問に至った経緯 (3-5 行)
   - 各判断テーマごとに:
     - H2: 「判断 N: {タイトル}」
     - 背景説明 (intro)
     - `### 該当商品` 見出しのもとに各商品を:
       - H4: `#### rowIndex {N}`
       - 商品名・商品URL・ヒットした辞書キーワード・辞書側 primary・GT 結果 を箇条書き
       - 画像埋め込み: `![タイトル](images/{rowIndex}.webp)`
     - `**質問**:` + 選択肢
   - `## 返信方法`: Google Doc にコメント or スレッド回答
5. ファイル名: `YYYY_MM_DD_NN_question_{テーマ}.md` (NN は同日内の枝番)
   - 同日の既存ファイルを確認して NN を決める
6. **Google Drive の質問フォルダに自動アップロード** (オプションではなく必須手順):
   - MCP ツール `mcp__google-drive-manager__upload_markdown_as_google_doc` を使用
   - `drive_folder_id`: `1rPBq2N3fH-TqyuqqZt3klxtyLUcrsgsp` (質問フォルダ)
   - `doc_title`: ファイル名 (拡張子なし)
   - 画像埋め込みのため pandoc 経由で Google Docs に変換される
   - 同名の Google Docs があれば上書きされる
7. 作業完了後、以下を報告:
   - 保存先フルパス (ローカル)
   - コピーした画像ファイルのリスト
   - **Google Docs の URL** (アップロード結果の `web_view_link`)

---

## 実装ガイド

- 情報収集・画像コピー・md 生成は 1 本のスクリプトにまとめる (`scripts/01_generate.js`)
- 質問本文 (intro / question / 選択肢) は**スクリプト内にハードコード**する。自動生成だと文脈が通らないため
- 質問の問いかけは選択肢を明示する: 「- はい → ...」「- いいえ → ...」のように分岐を列挙
- スクリプトの参考実装: `tmp/2026/04/19/additional_dictionary_review/scripts/01_generate.js`

---

## Google Drive へのアップロード (標準手順)

md 生成後は**必ず**「質問」フォルダに Google Docs としてアップロードする (作成手順 6 の通り):

- MCP ツール: `mcp__google-drive-manager__upload_markdown_as_google_doc`
- `md_path`: ローカル md の絶対パス
- `drive_folder_id`: `1rPBq2N3fH-TqyuqqZt3klxtyLUcrsgsp` (質問フォルダ)
- `doc_title`: ファイル名 (拡張子なし)

画像埋め込みのため pandoc 経由で Google Docs に変換される。同名 Docs があれば上書きされる。アップロード結果の `web_view_link` をユーザーに報告する。

---

## 禁止事項

- ユーザーの意向を推測して勝手に判断テーマ・質問文・選択肢を追加しない
- 必ず質問テーマごとに背景と質問文をユーザーに確認してから md を生成する

### 実装用語・技術詳細を書かない (最重要)

**物販オーナーは非エンジニアである**。判断依頼 md に以下のような実装詳細を書いてはいけない。これらを書くと物販オーナーは読めない:

- **辞書のカテゴリ名**: `food` / `plant_quarantine` / `medical` / `cosmetics_yakki` / `character_copyright` / `brand_imitation` / `electronics_check` / `handmade` などの内部カテゴリ名
- **実装ファイル名**: `keywords.json` / `exclude_by_keywords.js` / `expand_dictionary.js` / `_classifier.js` などのファイル名・パス
- **技術概念**: flagged / unflagged / primary / matches / priority / notWith / withAll / rowIndex / 辞書 / キーワード / マッチ / 部分文字列 / 除外フラグ
- **内部の経緯説明**: 「前セッションで〇〇カテゴリから削除されていた」「誤登録されていた」「辞書追加漏れ」などの実装履歴
- **実装アクションを選択肢にしない**: 「〇〇カテゴリに追加」「キーワード登録する」「notWith を足す」「辞書から削除」などを A/B/C の選択肢に置かない

### 選択肢はビジネス判断で書く

選択肢はあくまで**物販オーナーのビジネス判断**として書く。例:

- 良い例: 「全部仕入れ候補から外す」「大人向けは残す、子供向けは外す」「このブランドの商品は仕入れ対象」
- 悪い例: 「brand_imitation カテゴリに追加」「notWith に追記」「辞書からキーワード削除」

### 識別子の書き方

商品の識別は **通し番号** (「商品 1」「商品 2」...) で書く。`rowIndex {N}` のような内部インデックスは使わない (画像ファイル名の内部パスとしては使っても、md の見出し・本文には出さない)。

### 背景説明の書き方

背景は**今何に困っているか / 何を決めたいか**だけを、物販オーナーの視点で書く。中の実装がどう動いているか・過去にどう直したかは書かない。

「4/16 のリサーチ結果にこういう商品が N 件あります。PDF のこの記述に該当するかもしれないので方針を決めたいです」のように、**「商品」と「PDF」と「ビジネス判断」**だけで構成する。
