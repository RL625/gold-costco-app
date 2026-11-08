/**
 * Cloudflare Worker：代理好市多台灣貴金屬 API（繞過 CORS）
 *
 * 部署步驟：
 * 1. 到 https://workers.cloudflare.com 登入
 * 2. Create Worker → 貼上本檔內容
 * 3. Deploy 後會得到網址，例如 https://gold-costco.你的帳號.workers.dev
 * 4. 把該網址填回 index.html 的 WORKER_URL
 */

const COSTCO_API =
  'https://www.costco.com.tw/rest/v2/taiwan/products/search' +
  '?fields=FULL&query=&pageSize=48&category=111001&lang=zh_TW&curr=TWD';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

function parseGrams(name) {
  if (!name) return null;
  const oz = name.match(/(\d+(?:\.\d+)?)\s*盎司/);
  if (oz) return parseFloat(oz[1]) * 31.1035;
  const g = name.match(/(\d+(?:\.\d+)?)\s*公克/);
  if (g) return parseFloat(g[1]);
  return null;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      const res = await fetch(COSTCO_API, {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!res.ok) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Costco API ' + res.status }),
          { status: 502, headers: CORS }
        );
      }

      const data = await res.json();
      const products = (data.products || []).map((p) => {
        const name = p.name || '';
        const priceObj = p.price || {};
        const stock = p.stock || {};
        const price =
          typeof priceObj.value === 'number'
            ? priceObj.value
            : priceObj.intValue != null
              ? priceObj.intValue
              : null;
        const grams = parseGrams(name);
        const stockStatus = stock.stockLevelStatus || '';
        const inStock = stockStatus === 'inStock';
        const path = p.url || '';
        const url = path
          ? 'https://www.costco.com.tw' + (path.startsWith('/') ? path : '/' + path)
          : 'https://www.costco.com.tw/Jewelry-Gold/22K-24k-Gold/Precious-Metal-Bullion-and-Gold-Bars/c/111001';

        return {
          code: p.code || '',
          name,
          grams,
          price,
          stock: inStock,
          stockStatus,
          url,
        };
      });

      return new Response(
        JSON.stringify({
          ok: true,
          updatedAt: new Date().toISOString(),
          count: products.length,
          products,
        }),
        { status: 200, headers: { ...CORS, 'Cache-Control': 'public, max-age=300' } }
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }),
        { status: 500, headers: CORS }
      );
    }
  },
};
