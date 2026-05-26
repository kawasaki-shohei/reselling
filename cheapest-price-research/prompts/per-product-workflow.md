# per-product 最安値探索 Workflow (第4-6段階)

本ドキュメントは [`procedures/cheapest-price-research.md`](../../procedures/cheapest-price-research.md) の第4-6段階を、**1商品 1 Agent** で完結させるための作業手順を定義する。呼び出し側 (親 Claude) は商品コード `{CODE}` と `{RUN_DIR}` (例: `cheapest-price-research/runs/2026_05_25_20_45`) を inline で渡す。

## 【絶対禁則】

1. 指定パス (`{RUN_DIR}/items/{CODE}/` 配下のみ) 以外への書き込み禁止
2. 入力ファイル (`target_detail/`, `target_images/`, `rivals/`) を書き換えない (Read のみ)
3. **`browser_navigate` は呼ばない** (親が mercari セッション保持中)
4. 違反操作は実行せず報告

## 必読ドキュメント (まだなら Read)

1. `cheapest-price-research/prompts/primary-filter.md` (1次フィルタ判定基準)
2. `cheapest-price-research/prompts/final-judgment.md` (最終判定基準)
3. `cheapest-price-research/mercari-item-detail.js` (Step 5 で参考)

## ツール準備

Step 5 で `browser_evaluate` を使うため、最初に load:

```
ToolSearch(query="select:mcp__playwright__browser_evaluate", max_results=1)
```

## 入力 (Read のみ)

- `{RUN_DIR}/target_detail/{CODE}.json` (対象 name/description/photos)
- `{RUN_DIR}/target_images/{CODE}/photo_1.jpg` (対象画像)
- `{RUN_DIR}/items/{CODE}/rivals/page_01.json` (候補items[]、価格昇順、最大60件)

## 出力 (本Agentが書き出すパス)

- `{RUN_DIR}/items/{CODE}/thumbs/page_01/{rank:02d}.jpg`
- `{RUN_DIR}/items/{CODE}/sheets/page_01_sheet_{1,2,3}.png`
- `{RUN_DIR}/items/{CODE}/primary_filter/page_01_sheet_{1,2,3}.json`
- `{RUN_DIR}/items/{CODE}/primary_filter/page_01.json`
- `{RUN_DIR}/items/{CODE}/candidate_detail/{id}.json` (最大 5)
- `{RUN_DIR}/items/{CODE}/candidate_images/{id}/photo_1.jpg`
- `{RUN_DIR}/items/{CODE}/final_judgment/{id}.json`
- `{RUN_DIR}/items/{CODE}/result.json`

## Step 1: サムネDL (並列10)

```bash
/Users/kawasaki/Documents/work_source/2026_04_10_reselling/reselling/cheapest-price-research/run-python.sh - <<'PY'
import json, urllib.request, concurrent.futures as cf, os
RUN="{RUN_DIR_ABS}"
CODE="{CODE}"
DEST=f"{RUN}/items/{CODE}/thumbs/page_01"
os.makedirs(DEST, exist_ok=True)
items=json.load(open(f"{RUN}/items/{CODE}/rivals/page_01.json"))['items']
def dl(it):
    rank=f"{it['rank']:02d}"
    url=(it.get('thumbnails') or [None])[0]
    if not url: return (rank,"no_url")
    try:
        req=urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            open(f"{DEST}/{rank}.jpg","wb").write(r.read())
        return (rank,"ok")
    except Exception as e: return (rank,f"err:{e}")
with cf.ThreadPoolExecutor(max_workers=10) as ex:
    r=list(ex.map(dl, items))
print(f"ok={sum(1 for _,s in r if s=='ok')}, err={sum(1 for _,s in r if s.startswith('err'))}, no_url={sum(1 for _,s in r if s=='no_url')}")
PY
```

## Step 2: コンタクトシート生成

```bash
/Users/kawasaki/Documents/work_source/2026_04_10_reselling/reselling/cheapest-price-research/run-python.sh \
  /Users/kawasaki/Documents/work_source/2026_04_10_reselling/reselling/cheapest-price-research/contact-sheet-builder.py \
  --thumbs-dir {RUN_DIR_ABS}/items/{CODE}/thumbs/page_01 \
  --rivals-json {RUN_DIR_ABS}/items/{CODE}/rivals/page_01.json \
  --output-dir {RUN_DIR_ABS}/items/{CODE}/sheets \
  --page 1
```

`ls` で生成枚数確認 (20件ごとに1枚、最大 3 枚)。

## Step 3: 1次フィルタ (シート毎、順次)

各シート M (生成された枚数だけ) について:

1. **target_image** `target_images/{CODE}/photo_1.jpg` Read
2. **シート画像** `sheets/page_01_sheet_M.png` Read
3. 対応 rank/title/price を `rivals/page_01.json` から抽出 (sheet_1: rank 1-20 / sheet_2: 21-40 / sheet_3: 41-60)
4. `primary-filter.md` の基準で同一候補 rank 配列を判定 (保守的、明らかに別物を弾く)
5. **即書き出し**: `primary_filter/page_01_sheet_M.json` = `{"sheet":M,"candidates":[3,7,12]}`

全シート完了後:
- `merged_candidates` = 全シート candidates を rank昇順マージ
- `primary_filter/page_01.json` = `{"page":1,"sheet_results":[...],"merged_candidates":[...]}`

## Step 4: 候補ゼロ判定

`merged_candidates` が空配列なら:

```json
{"productCode":"{CODE}","status":"no_match","reason":"page1精査で1次通過候補ゼロ","pagesScanned":1,"totalCandidatesJudged":0}
```

→ `result.json` 書き出し、**完了報告して終了**

## Step 5: 候補詳細取得 (上位5件)

`top_ranks = merged_candidates[:5]` 、`itemIds = [items[rank-1].id for rank in top_ranks]`

`mercari-item-detail.js` を Read して DPoP + items/get のロジック把握。

`browser_evaluate` で次のような関数を実行 (filename指定なし、戻り値で受け取り):

```js
async () => {
  const items = [{productCode:"{CODE}", itemId:"<id1>"}, ...];
  // mercari-item-detail.js の DPoP + 並列10 fetch + items/get batch を inline
  return { results: [{productCode, itemId, status, http, data?, error?}, ...] };
}
```

各 `status="ok"` 結果について:
- `candidate_detail/{id}.json` ← data フィールド書き出し
- bash + curl (or python urllib) で `data.photos[0]` を `candidate_images/{id}/photo_1.jpg` にDL

`status="error"` (404 等) はスキップ可。

## Step 6: 最終判定 (rank昇順、`sameProduct=true` で break)

`final-judgment.md` を Read。

candidates を rank昇順で順に:

1. **対象**: target_detail (name/description) + target_images/{CODE}/photo_1.jpg
2. **候補**: candidate_detail/{id}.json (name/description) + candidate_images/{id}/photo_1.jpg
3. 全6軸 (色/サイズ/個数/柄/素材/用途) で**いずれか明らかに違えば false**、全一致なら true
4. **即書き出し**: `final_judgment/{id}.json` =
   ```json
   {"candidateId":"m...","candidateRank":N,"candidatePrice":P,"candidateUrl":"https://jp.mercari.com/item/m...","sameProduct":bool,"reason":"..."}
   ```
5. `sameProduct=true` なら **break** (最安値確定)

## Step 7: result.json 書き出し

**matched** (Step 6 で break):
```json
{"productCode":"{CODE}","status":"matched","cheapest":{"id":"m...","rank":N,"page":1,"price":P,"url":"...","title":"..."},"reason":"..."}
```

**no_match** (全候補 false):
```json
{"productCode":"{CODE}","status":"no_match","reason":"page1の N候補すべて別商品","pagesScanned":1,"totalCandidatesJudged":N}
```

## 完了報告 (親が拾うので必須)

- 最終 status (matched / no_match)
- matched なら cheapest id/price/rank/title
- no_match なら理由
- 工程実績:
  - Step 1 thumb DL: ok/err 件数
  - Step 2 sheet生成: 何枚
  - Step 3 各シート candidates 件数 → merged 件数
  - Step 5 candidate_detail 取得件数
  - Step 6 最終判定 件数 + matched なら rank
- 例外/問題があれば全列挙

## 注意事項 (簡略運用)

本ワークフローは **page1 のみ精査** で打ち切る (procedureの「page2-5次バッチへ」は省略)。テスト規模での効率優先。手順書本体への反映は run_notes.md で検討する。
