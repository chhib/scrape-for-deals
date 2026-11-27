import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkListing } from '../stores/elevate.js';

// A stand-in for the listing API: `total` products priced 1..total, with the API's rule that
// no request may reach past product number `cap`.
function fakeApi(total, cap) {
  const requests = [];
  const fetchJson = async (query) => {
    const skip = Number(query.get('skip')), limit = Number(query.get('limit')), sort = query.get('sort');
    requests.push({ skip, limit, sort });
    if (skip + limit > cap) throw new Error('Cannot request a product number greater than ' + cap);
    const order = Array.from({ length: total }, (_, i) => i + 1);
    if (sort === 'PRICE_DESCENDING') order.reverse();
    const productGroups = order.slice(skip, skip + limit).map((n) => ({
      key: `g${n}`,
      products: [{ key: `p${n}`, title: `Product ${n}`, name: `Product ${n}`, variants: [{ key: `v${n}`, link: `/p${n}`, sellingPrice: n, listPrice: n * 2 }] }],
    }));
    return { primaryList: { productGroups, totalHits: total } };
  };
  return { fetchJson, requests };
}

const walk = (api, extra = {}) =>
  walkListing({ store: 'S', origin: 'https://example.test', market: 'M', priceId: 'P', pageReference: '/all', scrapedAt: 't',
    sessionKeys: { customerKey: 'c', sessionKey: 's' }, pageSize: 10, pause: false, ...api, ...extra });

test('elevate: a listing under the cap is walked once, to its last page', async () => {
  const api = fakeApi(35, 100);
  const result = await walk({ fetchJson: api.fetchJson, cap: 100 });
  assert.equal(result.siteTotal, 35);
  assert.equal(result.collected, 35);
  assert.equal(result.pagesWalked, 4);
  assert.equal(new Set(result.rows.map((r) => r.variantId)).size, 35);
});

test('elevate: a listing over the cap is walked from both ends of the price order and still complete', async () => {
  const api = fakeApi(35, 20);
  const result = await walk({ fetchJson: api.fetchJson, cap: 20 });
  assert.equal(result.siteTotal, 35);
  assert.equal(result.collected, 35);
  assert.deepEqual([...new Set(api.requests.map((r) => r.sort))], [null, 'PRICE_ASCENDING', 'PRICE_DESCENDING']);
});

test('elevate: a listing more than twice the cap comes back short, so the runner can fail it', async () => {
  const api = fakeApi(55, 20);
  const result = await walk({ fetchJson: api.fetchJson, cap: 20 });
  assert.equal(result.siteTotal, 55);
  assert.equal(result.collected, 40);
});
