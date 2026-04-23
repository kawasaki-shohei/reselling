# Mercari ブランドマスタ ローカルコピー

Mercari が管理する商品ブランドマスタ (`itemBrands` DB、52,579 件規模) のローカルコピー。辞書判定 (`exclude_by_keywords`) で `itemBrand.id` からブランド名を引くためのオフラインコピー。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `brands.jsonl` | ブランドマスタ本体。1 行 1 ブランドの JSONL。スキーマ: `id, name, subname, initial, jaPronunciation, nameJaFurigana` |
| `meta.json` | 取得日時・ETag・件数・schema・ソース URL |
| `README.md` | 本ファイル |

## 背景

- Mercari 検索 API (`v2/entities:search`) で `withItemBrand: true` を指定するとアイテムにブランド情報 (`itemBrand: { id, name, subName }`) が付く
- この `id` は Mercari 内部マスタ DB の PK。全 ID ↔ 名称の対応は `master/v2/datasets/item_brands` エンドポイントから取得可能
- 出品者は出品画面で 52,579 ブランドから選択する (自由入力ではない)
- マスタに無いブランド (中国輸入ノーブランド・個人ハンドメイド等) は `itemBrand` 空欄のまま出品される

## 再取得タイミング

Mercari 側でブランドマスタが更新されるたびに、手動で再取得する。目安:

- 辞書判定で `itemBrand` 参照を始めたとき
- 数ヶ月に 1 回、ETag 変化をチェックする運用
- 「知らないブランド」が増えた実感があるとき

厳密な更新頻度は Mercari 側の運用依存。実測ベースで判断する。

## 再取得手順

### 前提

- Claude Code で Playwright MCP が使える
- 事前に Playwright ブラウザで jp.mercari.com にログインしていること (未ログインでも DB 取得自体は可能だが、将来の仕様変更リスクを避けるためログイン推奨)

### 手順 1: Mercari にアクセスしてマスタをブラウザキャッシュに載せる

`mcp__playwright__browser_navigate('https://jp.mercari.com/sell/create')` を実行。

フロントエンドが `https://api.mercari.jp/master/v2/datasets/item_brands` を叩き、レスポンスを `master.itemBrands` (indexedDB) に書き込む。ETag が前回と同じなら 304 でキャッシュ再利用され、変化があれば 200 で全件更新される。

### 手順 2: indexedDB から全件 dump

`mcp__playwright__browser_evaluate` で以下を実行し、`filename` で `tmp/YYYY/MM/DD/mercari_master_brands_raw.json` に保存する:

```js
async () => {
  const masterDb = await new Promise((res, rej) => {
    const r = indexedDB.open('master');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = masterDb.transaction('itemBrands', 'readonly');
  const os = tx.objectStore('itemBrands');
  const brands = await new Promise((res) => {
    const r = os.getAll();
    r.onsuccess = () => res(r.result);
  });
  return { brandCount: brands.length, brands };
}
```

### 手順 3: 現在の ETag を取得 (更新検知用)

`mcp__playwright__browser_network_requests({ filter: 'item_brands', requestHeaders: true })` で `if-none-match` ヘッダの値 (ETag) を確認。`meta.json` の `etag_at_fetch` と比較し、変わっていれば更新あり。

### 手順 4: JSONL と meta への変換・上書き

```bash
python3 <<'EOF'
import json
from datetime import datetime, timezone, timedelta
src = 'tmp/YYYY/MM/DD/mercari_master_brands_raw.json'
d = json.load(open(src))
brands = sorted(d['brands'], key=lambda x: int(x.get('id', 0)))

dst = 'procedures/exclude_by_keywords/brand_master/brands.jsonl'
with open(dst, 'w', encoding='utf-8') as f:
    for b in brands:
        f.write(json.dumps(b, ensure_ascii=False, separators=(',', ':')) + '\n')

ids = [int(b['id']) for b in brands]
jst = timezone(timedelta(hours=9))
meta = {
    'source': 'https://api.mercari.jp/master/v2/datasets/item_brands',
    'indexedDB_location': 'master.itemBrands',
    'fetched_at': datetime.now(jst).isoformat(),
    'etag_at_fetch': '<ETAG_HERE>',  # 手順 3 で確認した値を入れる
    'brand_count': len(brands),
    'id_min': min(ids),
    'id_max': max(ids),
    'schema_keys': list(brands[0].keys())
}
with open('procedures/exclude_by_keywords/brand_master/meta.json', 'w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)
    f.write('\n')
EOF
```

### 手順 5: git 差分を確認

```bash
git diff --stat procedures/exclude_by_keywords/brand_master/
```

`brands.jsonl` は 1 行 1 ブランドなので、追加・削除・変更が行単位で読める。スキーマ変更 (schema_keys の増減) にも要注意。

## 注意事項

- ファイルサイズ約 8 MB。大きいが git LFS は不要 (GitHub の 100 MB/file 上限は大幅に下回る)
- ブランド ID は連番だが欠番あり (統廃合されたブランドの抹消)。id の最小-最大から件数を推定できない
- Mercari 側のマスタ構造が突然変わる可能性はあり。再取得時に `meta.json` の `schema_keys` 差分を確認する
- 認証情報 (`authTokenData` localStorage、`auth-sdk.keyPairs.dpop` indexedDB) は本取得プロセスでは使わない。master エンドポイントは直叩きすると DPoP + authorization が必要なため、フロントエンドに叩かせてキャッシュを読む手順を採用している
