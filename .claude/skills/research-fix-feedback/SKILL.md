---
name: research-fix-feedback
description: メルカリ売れ筋リサーチのレポート Web UI で物販オーナーが付けた「要修正(status=fix)」を回収し、除外漏れ系(A)と同一商品判定の誤り系(B)に分類して既存の各運用へ振り分ける手順。「要修正を取り込む」「fix を反映」「レポートのフィードバックを反映」「要修正を抜いて」と言われたら使用する。
---

# 要修正フィードバックの回収と反映

リサーチ結果レポート (`reselling-web` の Cloudflare Workers UI) で物販オーナーが各クラスタに付けた判定のうち、**`status = fix`(要修正)** を回収し、分類して既存の各運用へ流す。

要修正とは「このクラスタが仕入れ候補に残っているのは手順・辞書・スクリプト側の不備だから直せ」というフィードバック。次の run までに反映していく。

## この skill の立ち位置

`procedures/mercari-research-v2.md` は第 7 段階 (CSV 書き出し) で完結し、その CSV をレポート UI に載せた後に物販オーナーが付ける判定 (`fix` 含む) の回収・反映は手順書本体に記載がない。本 skill はその **第 7 段階の後続フェーズ** を扱う (手順書と競合せず、空白を埋める)。

判定ロジックや辞書ルールをここで再発明しない。**fix を回収して A/B に振り分け、既存の各運用へ流すルーター**に徹する。反映先の詳細手順は各運用ドキュメントに委ねる:

- 除外キーワード追加: CLAUDE.md「フィードバック受領時の運用」§機械的に除外できるキーワード + `docs/research/mercari/keywords_design_notes.md`
- 同一商品判定の例: `docs/research/mercari/judgment_examples/README.md`
- 物販オーナーへの確認依頼: `create-buyer-question` skill

## 鉄則

- **ファイルへの書き込みは必ず開発者(対話相手)の同意を取ってから**。回収・分類・反映先の提案までは勝手にやってよいが、`keywords.json` 等への実書き込みは都度同意を取る (CLAUDE.md「提案と実行の順序」)。
- **note の理由は物販オーナーの言葉のまま保持する**。「LED」「安全系」が何の法令に当たるか等を勝手に断定しない (知らない領域は憶測で埋めない)。除外カテゴリ名は既存 `keywords.json` の `priority` にあるものを当て、新カテゴリが要るなら確認する。
- **辞書追加は現データでヒットするものだけ**。将来の誤爆・新商品を想定した追加はしない (件数 > 0 かつ誤爆ゼロを確認してから)。**誤爆チェックは 1 run だけで済ませない。`2026_04_28_10_26` 以降の全 run の集約 TSV を横断して見る** (手順「§3 補足: 誤爆チェック」参照)。1 run だけだと母集団が偏り、別 run にある誤爆を見落とす (実例: 「HID」は 05_15 run では車用バルブのみだが、06_02 run に「HIDA様」という購入者名の誤爆があった)。

## 手順

### 1. fix を回収する

レポート URL (`https://reselling-web.<account>.workers.dev/reports/<run_id>/?key=<ACCESS_KEY>`) を受け取り、run_id と key を抜いて公開 API を叩く。`status === 'fix'` だけ残す。

```bash
# URL から run_id と key を抜く例 (URL を $URL に入れておく)
RUN_ID=$(echo "$URL" | sed -E 's#.*/reports/([^/?]+).*#\1#')
KEY=$(echo "$URL" | sed -E 's#.*[?&]key=([^&]+).*#\1#')
BASE=$(echo "$URL" | sed -E 's#(https://[^/]+).*#\1#')

curl -s "$BASE/api/reports/decisions?key=$KEY&run_id=$RUN_ID" \
  | python3 -c "import sys,json; d=json.load(sys.stdin)['decisions']; \
fix=[x for x in d if x['status']=='fix']; \
print('fix:',len(fix),'/ total:',len(d)); \
[print(x['cluster_id'],'|',x['note'].replace(chr(10),' ')) for x in fix]"
```

API 仕様: `GET /api/reports/decisions?key=&run_id=` が全クラスタの `{cluster_id, status, note, updated_at}` を返す (`reselling-web/src/index.js`)。status は `untouched/hold/buy/reject/fix` の 5 値。

### 2. A / B に分類する

各 fix の note を読み、2 系統に振り分ける。判別に迷う note は AskUserQuestion でなくテキストで実例を並べて開発者に確認する (CLAUDE.md「判断を仰ぐ質問には実例タイトルを並べる」)。

| 系統 | 中身 | note の例 |
|---|---|---|
| **A. 除外漏れ** | 本来 keyword/カテゴリ/画像で除外すべきものがレポートに残った | 「知財侵害。クロムハーツ」「ハンドメイド」「食品衛生法に抵触する」「安全系」「LED」「アルファード専用はだめ」 |
| **B. 同一商品判定の誤り** | 第 5 段階の属性抽出のブレ、または第 6 段階の同一商品判定 (6-1 の 6 軸完全一致の仮クラスタリング) が、同一商品を別クラスタに取りこぼした / 別商品を同一に誤統合した | 「2つ上と同一商品」「他のサンシェードと同一判定できていない」「価格帯で仕分けてる？」 |

### 3. 反映先へ振り分ける (提案まで)

**A. 除外漏れ** — note の性質で反映先が分かれる:

| note の性質 | 反映先 | 補足 |
|---|---|---|
| ブランド名・キャラ名など、タイトルの単独キーワードで機械除外できる | `procedures/exclude_by_keywords/keywords.json` | 追加前に **複数 run 横断** で件数 > 0 かつ誤爆ゼロを確認 (下記「§3 補足」)。短語誤爆は `notWith`、組み合わせは `withAll` |
| カテゴリ全体で除外すべき (公式 categoryId 単位) | `procedures/exclude_by_category/excluded_categories.json` | 食品・本・CD 等 root カテゴリ単位の取りこぼし |
| タイトルに語が出ず画像で初めて分かる (新キャラ・模造) | `research/image_exclusion_prompt.md` の判定軸 (= keywords.json の priority に追従) | 辞書に新カテゴリを足せば画像除外の軸も追従する |
| 除外可否が物販オーナーの判断に依存する | `create-buyer-question` skill で確認依頼を作る | 法令解釈・グレー判定など |

**B. 同一商品判定の誤り** — 反映先は 2 つ:

| 反映先 | 何を書くか |
|---|---|
| `docs/research/mercari/judgment_examples/case{NN}_*.md` | 実際の商品 URL + スクショ付きで判定例を追加 (フォーマットは `case01` 準拠、`README.md` 参照)。自明な例・既存と重複する例は記録しない |
| `procedures/identity_resolution_redesign_draft.md` と `tasks/` の再設計検討 | 第 5〜7 段階の再設計 (まだ合意前の検討段階) の裏付けデータとして、取りこぼし・誤統合の事例を証跡として積む。個別 case とは別に「再設計で解くべき事例」として集約 |

#### §3 補足: 誤爆チェック (keyword 追加前に必ず実施)

keyword を `keywords.json` に足す前に、その語が **除外したい商品以外を巻き込まないか** を確認する。**1 run だけでは母集団が偏るので、`2026_04_28_10_26` 以降の全 run の集約 TSV を横断する** (`2026_04_23_20_02` は約 5,500 行と小規模、`2026_04_25_01`/`2026_04_25_02` は集約 TSV が無いため対象外)。

集約 TSV は `research/runs/<run_id>/aggregate/all_items_sorted_from_<YYYYMMDD>.tsv`。第 2 段階 (集約) の出力で、列は `[1]価格 [2]seller_id [3]商品名 [4]item_id` のタブ区切り。検索語が実質当たるのは商品名 (列 3)。

```bash
cd research/runs
# 04_28 以降の集約 TSV をすべて対象にする (新しい run が増えれば自然に含まれる)
FILES=( ${(f)"$(ls 2026_04_28_10_26/aggregate/*.tsv 2026_05_15_10_00/aggregate/*.tsv 2026_06_02_09_10/aggregate/*.tsv 2>/dev/null)"} )
KW="HID"   # 追加候補の語
for f in $FILES; do
  echo "--- ${f%%/*} : $(grep -c "$KW" "$f")件 ---"
  grep "$KW" "$f" | awk -F'\t' '{print "   "$3}' | sort -u   # 全ヒットを目視して誤爆を探す
done
```

ヒット行を全部見て、除外したい商品**以外**が混じっていたらそれが誤爆。短語が一般語/購入者名に紛れるなら `notWith` で除外、組み合わせが要るなら `withAll` で限定する (詳細は `docs/research/mercari/keywords_design_notes.md`)。新しい run が出たら `FILES` にそのパスを足す。

### 4. 一覧にまとめて提案する

A/B 別に「cluster_id | note | 反映先候補 | 根拠」を表で出し、開発者の同意を取る。同意が出た項目だけ実際の書き込みに進む。

- A の keyword 追加は §3 の鉄則どおり現データ検索 → 誤爆チェック → 追加理由は Git コミットメッセージに残す (個別 WHY を別ドキュメントに書かない)。
- 反映が複数 run にまたがる継続作業なら `run_notes.md` か `tasks/` に残し、次 run で取りこぼさないようにする。

## 補足: cluster_id から商品の中身を引きたいとき

note だけで商品が特定できない場合、cluster_id をキーに当該 run の最終クラスタ (`reselling-web/public/reports/<run_id>/index.html` 埋め込みデータ、または `reselling/research/runs/<run_id>/` の中間出力) を引く。cluster_id 形式は手順書 6-3 の `{category}_{subcategory}_{連番3桁}` (subcategory 空なら `__`)。fix の note 自体に URL が書かれていることも多いので、まず note を読む。
