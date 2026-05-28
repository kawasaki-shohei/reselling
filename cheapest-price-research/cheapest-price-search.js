/**
 * 最安値リサーチ 検索 API スクリプト (batch 対応)
 *
 * 用途:
 *   procedures/cheapest-price-research.md の第 3 段階 (検索 API 取得) で使う。
 *   Mercari 検索 API を価格昇順で叩き、複数商品 × 1 バッチ分を 1 回の
 *   browser_evaluate でまとめて取得する。
 *
 * 使い方:
 *   1. https://jp.mercari.com に browser_navigate (任意のページ。DPoP 認証用に
 *      未ログインで可)
 *   2. 2-3 秒待つ
 *   3. browser_evaluate で入力をセット:
 *        window.__CHEAPEST_BATCH_INPUT__ = {
 *          products: [
 *            { productCode: "FD00101", keyword: "スタッズベルト V 黒", page: 1, pageToken: "" },
 *            { productCode: "FD00301", keyword: "ロングリード 10m 黒",   page: 1, pageToken: "" },
 *            ...
 *          ]
 *        }
 *   4. このスクリプト全体を browser_evaluate で実行
 *
 * 入力: window.__CHEAPEST_BATCH_INPUT__.products[]
 *   - productCode: 入力 CSV の商品番号
 *   - keyword: 検索キーワード
 *   - page: バッチ番号 (1 始まり、出力にそのまま入る)
 *   - pageToken: 1 ページ目は空文字、続きは前バッチ戻り値の nextPageToken
 *
 * 戻り値:
 *   {
 *     fetchedAt,                              // ISO 8601 JST
 *     total, succeeded, failed,
 *     results: [
 *       {
 *         productCode, keyword, page,
 *         status: "ok" | "error",
 *         totalReturned,                       // API が返した raw 件数
 *         totalAfterBrandFilter,               // itemBrand 除外後の件数
 *         nextPageToken,                       // 次ページの token (なければ null)
 *         hasNext,                             // 次ページの有無
 *         items: [
 *           {
 *             rank,                            // 1-N、itemBrand 除外後の価格昇順順位
 *             id, name, price, sellerId, updated,
 *             url,
 *             thumbnails                       // URL 配列
 *           }
 *         ],
 *         error: <string>                      // status=error のとき
 *       }
 *     ]
 *   }
 *
 * レート制限: 商品ごとに 200ms 間隔で順次実行 (並列は v2 collect.js 実測で
 * 4xx/5xx を誘発)
 *
 * 仕様準拠: procedures/cheapest-price-research.md 第 3 段階
 */

(async () => {
  if (!window.__CHEAPEST_BATCH_INPUT__) {
    throw new Error('window.__CHEAPEST_BATCH_INPUT__ が設定されていません。事前に { products: [{ productCode, keyword, page, pageToken }, ...] } を browser_evaluate で設定してください。');
  }
  const { products } = window.__CHEAPEST_BATCH_INPUT__;
  if (!Array.isArray(products) || !products.length) {
    throw new Error('window.__CHEAPEST_BATCH_INPUT__.products が空配列です。');
  }
  for (const p of products) {
    if (!p.productCode || !p.keyword) {
      throw new Error(`products の各要素に productCode と keyword は必須です: ${JSON.stringify(p)}`);
    }
  }

  async function generateDPoP(privateKey, publicKey, url, method) {
    const jwk = await crypto.subtle.exportKey('jwk', publicKey);
    const header = {
      typ: 'dpop+jwt', alg: 'ES256',
      jwk: { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y },
    };
    const uuid = document.cookie.match(/mercari-shd-uuid-lb=([^;]+)/)?.[1] || '';
    const payload = {
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID(),
      htu: url, htm: method, uuid,
    };
    const b64u = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const unsigned = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, privateKey,
      new TextEncoder().encode(unsigned),
    );
    return `${unsigned}.${b64u(String.fromCharCode(...new Uint8Array(sig)))}`;
  }

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

  const API = 'https://api.mercari.jp/v2/entities:search';
  const PAGE_SIZE = 50;
  const REQUEST_INTERVAL_MS = 200;

  async function searchOne({ productCode, keyword, page = 1, pageToken = '' }) {
    try {
      const dpop = await generateDPoP(privateKey, publicKey, API, 'POST');
      const body = {
        userId: '', config: { responseToggles: [] },
        pageSize: PAGE_SIZE, pageToken,
        searchSessionId: `cheapest_${productCode}_${page}_${Date.now()}`,
        source: 'BaseSerp', indexRouting: 'INDEX_ROUTING_UNSPECIFIED', thumbnailTypes: [],
        searchCondition: {
          keyword, excludeKeyword: '',
          sort: 'SORT_PRICE', order: 'ORDER_ASC',
          status: ['STATUS_ON_SALE'],
          sizeId: [], categoryId: [], brandId: [], sellerId: [],
          priceMin: 0, priceMax: 0,
          itemConditionId: [1],
          shippingPayerId: [], shippingFromArea: [], shippingMethod: [],
          colorId: [], hasCoupon: false, attributes: [],
          itemTypes: ['ITEM_TYPE_MERCARI'],
          skuIds: [], shopIds: [], excludeShippingMethodIds: [],
        },
        serviceFrom: 'suruga',
        withItemBrand: true, withItemSize: false, withItemPromotions: false,
        withItemSizes: false, withShopname: false, useDynamicAttribute: false,
        withSuggestedItems: false, withOfferPricePromotion: false,
        withProductSuggest: false, withParentProducts: false,
        withProductArticles: false, withSearchConditionId: false,
        withAuction: false, laplaceDeviceUuid: uuid,
      };
      const resp = await fetch(API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'X-Platform': 'web',
          'X-Country-Code': 'JP', 'Accept': 'application/json', 'dpop': dpop,
        },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text();
        return {
          productCode, keyword, page,
          status: 'error',
          totalReturned: 0, totalAfterBrandFilter: 0,
          nextPageToken: null, hasNext: false,
          items: [],
          error: `HTTP ${resp.status}: ${text.slice(0, 200)}`,
        };
      }
      const data = await resp.json();
      const rawItems = data.items || [];
      const filteredItems = rawItems.filter(item => !item.itemBrand);
      const items = filteredItems.map((item, idx) => ({
        rank: idx + 1,
        id: item.id,
        name: item.name,
        price: parseInt(item.price || 0, 10),
        sellerId: item.sellerId || '',
        updated: parseInt(item.updated || 0, 10),
        url: `https://jp.mercari.com/item/${item.id}`,
        thumbnails: item.thumbnails || [],
      }));
      return {
        productCode, keyword, page,
        status: 'ok',
        totalReturned: rawItems.length,
        totalAfterBrandFilter: items.length,
        nextPageToken: data.meta?.nextPageToken || null,
        hasNext: !!data.meta?.nextPageToken,
        items,
      };
    } catch (e) {
      return {
        productCode, keyword, page,
        status: 'error',
        totalReturned: 0, totalAfterBrandFilter: 0,
        nextPageToken: null, hasNext: false,
        items: [],
        error: String(e),
      };
    }
  }

  // 順次実行 (並列はレート制限の懸念があるため)
  const results = [];
  for (const p of products) {
    results.push(await searchOne(p));
    await new Promise(r => setTimeout(r, REQUEST_INTERVAL_MS));
  }

  const succeeded = results.filter(r => r.status === 'ok').length;
  const failed = results.length - succeeded;
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);

  return {
    fetchedAt: jstNow.toISOString(),
    total: products.length,
    succeeded,
    failed,
    results,
  };
})();
