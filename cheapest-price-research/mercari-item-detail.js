/**
 * メルカリ 商品詳細取得スクリプト (items/get API 経由)
 *
 * 用途:
 *   procedures/cheapest-price-research.md の第 2 段階 (対象商品 詳細取得) と
 *   第 5 段階 (候補詳細取得) で使う。Mercari 内部 API `items/get` を DPoP 認証
 *   付きで叩き、複数商品を 1 回の browser_evaluate でまとめて取得する。
 *
 *   navigate ベースの DOM スクレイピング (1 商品ごとに browser_navigate) と比較し、
 *   - navigate ゼロ (mercari.com を 1 回開くだけ)
 *   - 並列 10 で fetch
 *   - 数値・配列でそのまま返るので parse 不要
 *
 * 使い方:
 *   1. https://jp.mercari.com に browser_navigate (任意のページ。DPoP 認証用に
 *      未ログインで可)
 *   2. 2-3 秒待つ
 *   3. browser_evaluate で入力をセット:
 *        window.__ITEM_DETAIL_INPUT__ = {
 *          items: [
 *            { productCode: "FD00101", itemId: "m92167660103" },
 *            { productCode: "FD00301", itemId: "m85899014828" },
 *            ...
 *          ]
 *        }
 *   4. このスクリプト全体を browser_evaluate で実行
 *
 * 戻り値:
 *   {
 *     fetchedAt,                              // ISO 8601 JST
 *     total, succeeded, failed,
 *     results: [
 *       {
 *         productCode,                        // 入力 CSV の商品番号
 *         itemId,
 *         status: "ok" | "error",
 *         http: <status code>,                // null なら network エラー
 *         data: <items/get の data フィールド全体>  // status=ok のとき
 *         error: <string>                      // status=error のとき
 *       }
 *     ]
 *   }
 *
 *   data の主なフィールド:
 *     id, name, price (number), description,
 *     photos (URL 配列), thumbnails,
 *     seller: { id, name, num_sell_items, ratings, ... },
 *     item_condition: { id, name },
 *     shipping_payer, shipping_method, shipping_from_area, shipping_duration,
 *     item_category, item_category_ntiers,
 *     colors, item_attributes,
 *     num_likes, num_comments, registered_prices_count,
 *     updated (unix), created,
 *     hash_tags
 *
 * 認証:
 *   DPoP JWT のみで通る。`authorization` / `credentials: include` は不要 (検証済み)。
 */

(async () => {
  if (!window.__ITEM_DETAIL_INPUT__) {
    throw new Error('window.__ITEM_DETAIL_INPUT__ が設定されていません。事前に { items: [{ productCode, itemId }, ...] } を browser_evaluate で設定してください。');
  }
  const { items } = window.__ITEM_DETAIL_INPUT__;
  if (!Array.isArray(items) || !items.length) {
    throw new Error('window.__ITEM_DETAIL_INPUT__.items が空配列です。');
  }
  for (const it of items) {
    if (!it.productCode || !it.itemId) {
      throw new Error(`items の各要素に productCode と itemId は必須です: ${JSON.stringify(it)}`);
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

  const API_PATH = 'https://api.mercari.jp/items/get';
  const CONCURRENCY = 10;

  async function fetchOne({ productCode, itemId }) {
    try {
      const url = `${API_PATH}?id=${itemId}&include_item_attributes=true&include_non_ui_item_attributes=true`;
      const dpop = await generateDPoP(privateKey, publicKey, API_PATH, 'GET');
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'X-Platform': 'web', 'Accept': 'application/json', 'dpop': dpop },
      });
      const http = resp.status;
      if (!resp.ok) {
        const text = await resp.text();
        return { productCode, itemId, status: 'error', http, error: text.slice(0, 300) };
      }
      const json = await resp.json();
      return { productCode, itemId, status: 'ok', http, data: json.data };
    } catch (e) {
      return { productCode, itemId, status: 'error', http: null, error: String(e) };
    }
  }

  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    const batch = await Promise.all(chunk.map(fetchOne));
    results.push(...batch);
  }

  const succeeded = results.filter(r => r.status === 'ok').length;
  const failed = results.length - succeeded;
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);

  return {
    fetchedAt: jstNow.toISOString(),
    total: items.length,
    succeeded,
    failed,
    results,
  };
})();
