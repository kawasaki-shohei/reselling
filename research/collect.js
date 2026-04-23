/**
 * メルカリ売れ筋リサーチ — 14日ウィンドウ方式 収集スクリプト
 *
 * 使い方:
 *   Claude Code の browser_evaluate でこのファイルの中身を実行する。
 *   （Node.js単体では動かない。ブラウザのIndexedDB・Cookieが必要なため）
 *
 *   1. browser_navigate で https://jp.mercari.com の任意のページを開く
 *   2. 3秒待つ
 *   3. browser_evaluate でこのファイルの内容を実行する
 *      - filename パラメータは指定しない（スクリプト内でファイル保存先を生成する）
 *
 * 出力:
 *   research/YYYY_MM_DD_HH_MM__mercari_14day_results.json
 *
 * 仕様準拠:
 *   - procedures/mercari-research.md の全ルールに従う
 *   - ページ数上限なし（自然終了条件のみ）
 *   - ページ内 break 禁止（全件走査）
 *   - item.id でユニーク化
 *   - categoryId・sellerId・thumbnail・itemSize を保存 (itemSize は出品者が設定していれば {id, name})
 */
async () => {
  // === DPoP JWT 生成 ===
  async function generateDPoP(privateKey, publicKey, url, method) {
    const jwk = await crypto.subtle.exportKey('jwk', publicKey);
    const header = {
      typ: 'dpop+jwt', alg: 'ES256',
      jwk: { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }
    };
    const uuid = document.cookie.match(/mercari-shd-uuid-lb=([^;]+)/)?.[1] || '';
    const payload = {
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID(),
      htu: url, htm: method, uuid
    };
    const b64u = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const unsigned = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, privateKey,
      new TextEncoder().encode(unsigned)
    );
    return `${unsigned}.${b64u(String.fromCharCode(...new Uint8Array(sig)))}`;
  }

  // === IndexedDB から DPoP キーペア取得 ===
  const keyPair = await new Promise((resolve, reject) => {
    const req = indexedDB.open('auth-sdk', 1);
    req.onsuccess = () => {
      const tx = req.result.transaction('keyPairs', 'readonly');
      const g = tx.objectStore('keyPairs').get('dpop');
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => reject(g.error);
    };
    req.onerror = () => reject(req.error);
  });
  const { publicKey, privateKey } = keyPair;
  const uuid = document.cookie.match(/mercari-shd-uuid-lb=([^;]+)/)?.[1] || '';

  // === 定数 ===
  const API = 'https://api.mercari.jp/v2/entities:search';
  const BOUNDARY_TS = Math.floor(Date.now() / 1000) - 14 * 86400;
  const KEYWORDS = ['インポート', '韓国', 'オルチャン', '海外', '輸入', '再販', '再入荷', 'ラスト一点', '入荷しました', '人気'];
  const PRICE_RANGES = [[800, 1000], [1000, 1200], [1200, 2000], [2000, 3000], [3000, 5000]];
  const startTime = Date.now();

  // === 1組み合わせ分の収集 ===
  async function searchAll(keyword, priceMin, priceMax) {
    let allItems = [], pageToken = '', pageNum = 0;

    // ページ数上限なし（自然終了条件のみ）
    while (true) {
      pageNum++;
      const dpop = await generateDPoP(privateKey, publicKey, API, 'POST');
      const body = {
        userId: '', config: { responseToggles: [] },
        pageSize: 120, pageToken,
        searchSessionId: `${keyword}_${priceMin}_${pageNum}_${Date.now()}`,
        source: 'BaseSerp', indexRouting: 'INDEX_ROUTING_UNSPECIFIED', thumbnailTypes: [],
        searchCondition: {
          keyword, excludeKeyword: '', sort: 'SORT_CREATED_TIME', order: 'ORDER_DESC',
          status: ['STATUS_SOLD_OUT'], sizeId: [], categoryId: [], brandId: [], sellerId: [],
          priceMin, priceMax, itemConditionId: [1],
          shippingPayerId: [], shippingFromArea: [], shippingMethod: [],
          colorId: [], hasCoupon: false, attributes: [],
          itemTypes: ['ITEM_TYPE_MERCARI'], skuIds: [], shopIds: [], excludeShippingMethodIds: []
        },
        serviceFrom: 'suruga',
        withItemBrand: true, withItemSize: true, withItemPromotions: false,
        withItemSizes: false, withShopname: false, useDynamicAttribute: false,
        withSuggestedItems: false, withOfferPricePromotion: false,
        withProductSuggest: false, withParentProducts: false,
        withProductArticles: false, withSearchConditionId: false,
        withAuction: false, laplaceDeviceUuid: uuid
      };

      const resp = await fetch(API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'X-Platform': 'web',
          'X-Country-Code': 'JP', 'Accept': 'application/json', 'dpop': dpop
        },
        credentials: 'include', body: JSON.stringify(body)
      });
      if (!resp.ok) break;

      const data = await resp.json();
      const items = data.items || [];
      if (!items.length) break;

      // ページ内全件走査（break禁止）
      let hitBoundary = false;
      for (const item of items) {
        const ts = parseInt(item.updated || 0);
        if (ts < BOUNDARY_TS) {
          hitBoundary = true; // breakしない。全件走査を続ける
          continue;
        }
        // itemBrand が設定されている商品は出品者が Mercari のブランドマスタ
        // (procedures/exclude_by_keywords/brand_master/brands.jsonl、52,579 件)
        // から選択した正規ブランド・版権・総称ブランド品のため、中国輸入物販の
        // 仕入れ候補にならない想定で収集段階から除外する。
        // 唯一の例外候補が id=40540 'no brand' (出品者がノーブランドを明示) で、
        // ここには仕入れ候補になり得る商品 (バンダナ/犬服/トレーニング器具等) が
        // 混じるが、母集団 8,059 件中わずか 6 件 (0.067%) かつ大半は既存辞書
        // (brand_imitation / food) で捕獲できるため一律除外としている。
        if (item.itemBrand) continue;
        allItems.push({
          id: item.id,
          name: item.name,
          price: parseInt(item.price || 0),
          updated: ts,
          url: `https://jp.mercari.com/item/${item.id}`,
          categoryId: item.categoryId || '',
          sellerId: item.sellerId || '',
          thumbnail: (item.thumbnails || [])[0] || '',
          itemSize: item.itemSize || null
        });
      }

      // 自然終了条件のみ（ページ数上限は設けない）
      const lastTs = parseInt(items[items.length - 1]?.updated || 0);
      const nextToken = data.meta?.nextPageToken;
      if (!nextToken || lastTs < BOUNDARY_TS || hitBoundary) break;

      pageToken = nextToken;
      await new Promise(r => setTimeout(r, 200));
    }

    return { keyword, priceMin, priceMax, pages: pageNum, count: allItems.length, items: allItems };
  }

  // === 50組み合わせを並列実行 ===
  const searches = [];
  for (const kw of KEYWORDS) {
    for (const [min, max] of PRICE_RANGES) {
      searches.push(searchAll(kw, min, max));
    }
  }
  const results = await Promise.all(searches);

  // === item.id でユニーク化 ===
  const seen = new Set();
  const allItems = results.flatMap(r => r.items);
  const unique = allItems.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  // === 集計 ===
  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  const totalRequests = results.reduce((sum, r) => sum + r.pages, 0);

  // === JSTでファイル名生成 ===
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const prefix = jst.toISOString().replace(/[-:T]/g, '_').slice(0, 17);
  const filename = `${prefix}_mercari_14day_results.json`;

  return {
    _filename: filename, // Claudeがこの値を使ってファイル保存すること
    boundaryTs: BOUNDARY_TS,
    executedAt: jst.toISOString(),
    elapsedSeconds: elapsedSec,
    elapsedFormatted: `${Math.floor(elapsedSec / 60)}分${elapsedSec % 60}秒`,
    totalRequests,
    totalCollected: unique.length,
    summary: results.map(r => ({
      keyword: r.keyword, priceMin: r.priceMin, priceMax: r.priceMax,
      pages: r.pages, count: r.count
    })),
    items: unique
  };
}
