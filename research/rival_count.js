/**
 * メルカリ売れ筋リサーチ — 販売中商品の生データ取得スクリプト
 *
 * 使い方・仕様の詳細は procedures/mercari-research.md の「第4段階: 販売中ライバル数カウント」を参照。
 *
 * 概要:
 *   - 入力: window.__RIVAL_INPUT__ = [{ clusterKey, query }, ...]
 *     - clusterKey: 後で *_rivals_raw.json と *_candidates_filtered.json を結合するためのキー
 *       （候補の items[0].id）
 *     - query:      メルカリ検索に投げるキーワード
 *   - 出力: { _filename, executedAt, results: [{ clusterKey, query, rawListings, ... }, ...] }
 *     - rawListings は 14日以内・新品・個人出品の販売中商品の生リスト
 *     - 同商品判定はこのスクリプトでは行わない（後段の sub-agent(Haiku) で行う）
 *   - browser_evaluate で実行する（Node 単体では DPoP 認証ができないため動かない）
 *   - 1クラスターあたり最大1ページ（120件）を取得する。それ以上深追いしないのは、
 *     後段の判定コストと「直近120件に同商品がなければ実質ライバル不在」という実務判断から。
 */
async () => {
  if (typeof window === 'undefined' || !Array.isArray(window.__RIVAL_INPUT__)) {
    throw new Error('window.__RIVAL_INPUT__ が配列として設定されていません。事前に別の browser_evaluate で設定してください。');
  }
  const INPUT = window.__RIVAL_INPUT__;
  for (const c of INPUT) {
    if (!c.clusterKey || !c.query) {
      throw new Error(`入力に必須フィールドが欠けています: ${JSON.stringify(c)}`);
    }
  }

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
  const NOW_TS = Math.floor(Date.now() / 1000);
  const FOURTEEN_DAYS_AGO = NOW_TS - 14 * 86400;
  const PAGE_SIZE = 120;
  const MAX_PAGES = 1;
  const REQUEST_INTERVAL_MS = 200;

  async function fetchRawListingsForCluster({ clusterKey, query }) {
    const allItems = [];
    let pageToken = '';
    let pageNum = 0;

    while (pageNum < MAX_PAGES) {
      pageNum++;
      const dpop = await generateDPoP(privateKey, publicKey, API, 'POST');
      const body = {
        userId: '', config: { responseToggles: [] },
        pageSize: PAGE_SIZE, pageToken,
        searchSessionId: `rival_${clusterKey}_${pageNum}_${Date.now()}`,
        source: 'BaseSerp', indexRouting: 'INDEX_ROUTING_UNSPECIFIED', thumbnailTypes: [],
        searchCondition: {
          keyword: query, excludeKeyword: '',
          sort: 'SORT_CREATED_TIME', order: 'ORDER_DESC',
          status: ['STATUS_ON_SALE'],
          sizeId: [], categoryId: [], brandId: [], sellerId: [],
          priceMin: 0, priceMax: 0,
          itemConditionId: [1],
          shippingPayerId: [], shippingFromArea: [], shippingMethod: [],
          colorId: [], hasCoupon: false, attributes: [],
          itemTypes: ['ITEM_TYPE_MERCARI'],
          skuIds: [], shopIds: [], excludeShippingMethodIds: []
        },
        serviceFrom: 'suruga',
        withItemBrand: false, withItemSize: false, withItemPromotions: false,
        withItemSizes: false, withShopname: false, useDynamicAttribute: false,
        withSuggestedItems: false, withOfferPricePromotion: false,
        withProductSuggest: false, withParentProducts: false,
        withProductArticles: false, withSearchConditionId: false,
        withAuction: false, laplaceDeviceUuid: uuid
      };

      let resp;
      try {
        resp = await fetch(API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', 'X-Platform': 'web',
            'X-Country-Code': 'JP', 'Accept': 'application/json', 'dpop': dpop
          },
          credentials: 'include', body: JSON.stringify(body)
        });
      } catch (err) {
        return makeResult(clusterKey, query, allItems, pageNum, `fetch failed: ${String(err)}`);
      }

      if (!resp.ok) {
        return makeResult(clusterKey, query, allItems, pageNum, `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const items = data.items || [];
      if (!items.length) break;

      let hitOld = false;
      for (const item of items) {
        const updatedTs = parseInt(item.updated || 0);
        if (updatedTs < FOURTEEN_DAYS_AGO) {
          hitOld = true;
          continue;
        }
        allItems.push({
          id: item.id,
          name: item.name,
          price: parseInt(item.price || 0),
          sellerId: item.sellerId || '',
          updated: updatedTs,
          url: `https://jp.mercari.com/item/${item.id}`,
          thumbnail: (item.thumbnails || [])[0] || ''
        });
      }

      if (hitOld) break;
      const nextToken = data.meta?.nextPageToken;
      if (!nextToken) break;
      pageToken = nextToken;

      await new Promise(r => setTimeout(r, REQUEST_INTERVAL_MS));
    }

    return makeResult(clusterKey, query, allItems, pageNum, null);
  }

  function makeResult(clusterKey, query, listings, pagesScanned, error) {
    return {
      clusterKey,
      query,
      rawListingsCount: listings.length,
      rawListings: listings,
      pagesScanned,
      error
    };
  }

  const BATCH_SIZE = 50;
  const startTime = Date.now();
  const results = [];
  for (let i = 0; i < INPUT.length; i += BATCH_SIZE) {
    const batch = INPUT.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(c =>
        fetchRawListingsForCluster(c).catch(err =>
          makeResult(c.clusterKey, c.query, [], 0, String(err)))
      )
    );
    results.push(...batchResults);
  }

  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const prefix = jst.toISOString().replace(/[-:T]/g, '_').slice(0, 16);
  const filename = `${prefix}__rivals_raw.json`;

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  const totalListings = results.reduce((sum, r) => sum + r.rawListingsCount, 0);

  return {
    _filename: filename,
    executedAt: jst.toISOString(),
    elapsedSeconds: elapsedSec,
    elapsedFormatted: `${Math.floor(elapsedSec / 60)}分${elapsedSec % 60}秒`,
    inputCount: INPUT.length,
    resultCount: results.length,
    totalListings,
    errorCount: results.filter(r => r.error).length,
    results
  };
}
