import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../stores/initial-data.js';
import { walkListing } from '../stores/elevate.js';
import { openDb } from '../db.js';

// A stand-in for the storefront Svenssons and Nordic Nest share: one listing page of three products,
// and a product page for each that adds a variant the listing leaves out.
const page = (data) => `<script>window.INITIAL_DATA = JSON.parse('${JSON.stringify({ page: data })}');</script>`;
const listed = (n) => ({
  productId: `p${n}`, sku: `p${n}-1`, productName: `Product ${n}`, url: `/p${n}/`, images: [],
  price: { current: { inclVat: 100 * n }, regular: { inclVat: 200 * n } }, stockStatus: 'inStock',
});
const variant = (n, v) => ({ articleNumber: `p${n}-${v}`, name: `v${v}`, url: `/p${n}/?variantId=p${n}-${v}`, price: { inclVat: 100 * n }, regularPrice: { inclVat: 200 * n }, stockStatus: 'inStock' });

function fakeSite() {
  const requests = [];
  const fetchText = async (url) => {
    requests.push(url);
    const { pathname } = new URL(url);
    if (pathname === '/sale/') {
      return page({ products: [1, 2, 3].map(listed), pagination: { total: 3, currentPage: 1, pageCount: 1 } });
    }
    const n = Number(pathname.match(/^\/p(\d)\//)[1]);
    return page({ productId: `p${n}`, productName: `Product ${n}`, variants: [variant(n, 1), variant(n, 2)] });
  };
  return { fetchText, requests };
}

const productPageRequests = (requests) => requests.filter((u) => !u.includes('/sale/')).length;

test('checkpoint: listing rows and each product page are in the db as soon as they are read', async () => {
  const site = fakeSite();
  const db = openDb(':memory:');
  const store = createStore({ store: 'Shop', origin: 'https://shop.test', listingPath: '/sale/', parts: [{}], fetchText: site.fetchText });
  const afterEachProduct = [];
  await store.listProducts({
    scrapedAt: 't', onListing: () => {},
    onRows: (rows) => db.saveListingRows(rows),
    onProduct: (productId, rows) => {
      db.saveProductPage('Shop', productId, rows);
      afterEachProduct.push(db.rows().length);
    },
  });
  // the three listed variants were saved before any product page; each page then adds its second variant
  assert.deepEqual(afterEachProduct, [4, 5, 6]);
  assert.equal(db.rows().length, 6);
  assert.equal(db.summary('Shop').productsWithVariantsFetched, 3);
});

test('checkpoint: a rerun reads only the product pages the db does not have fresh, and still returns every variant', async () => {
  const db = openDb(':memory:');
  const first = fakeSite();
  const shop = (site) => createStore({ store: 'Shop', origin: 'https://shop.test', listingPath: '/sale/', parts: [{}], fetchText: site.fetchText });
  // a first run stopped after one product page
  db.saveProductPage('Shop', 'p2', [
    { store: 'Shop', productId: 'p2', variantId: 'p2-1', title: 'Product 2', url: 'https://shop.test/p2/?variantId=p2-1', price: 200, previousPrice: 400, scrapedAt: 't0' },
    { store: 'Shop', productId: 'p2', variantId: 'p2-2', title: 'Product 2', url: 'https://shop.test/p2/?variantId=p2-2', price: 200, previousPrice: 400, scrapedAt: 't0' },
  ]);
  const stats = [];
  const rows = await shop(first).listProducts({
    scrapedAt: 't', onListing: (s) => stats.push(s),
    resumeProduct: (productId) => db.freshProductRows('Shop', productId, 12 * 3600_000),
  });
  assert.equal(productPageRequests(first.requests), 2);
  assert.deepEqual([...new Set(rows.map((r) => r.variantId))].sort(), ['p1-1', 'p1-2', 'p2-1', 'p2-2', 'p3-1', 'p3-2']);
  const pages = stats.find((s) => s.listing.startsWith('product pages'));
  assert.deepEqual([pages.siteTotal, pages.collected, pages.pagesWalked, pages.resumed], [3, 3, 2, 1]);
});

test('checkpoint: an Elevate listing hands over each page\'s rows as it is parsed', async () => {
  const pages = [];
  const fetchJson = async (query) => {
    const skip = Number(query.get('skip'));
    const productGroups = [skip + 1, skip + 2].filter((n) => n <= 3).map((n) => ({
      key: `g${n}`, products: [{ key: `p${n}`, title: `P${n}`, variants: [{ key: `v${n}`, link: `/p${n}`, sellingPrice: n, listPrice: 2 * n }] }],
    }));
    return { primaryList: { productGroups, totalHits: 3 } };
  };
  await walkListing({
    store: 'S', origin: 'https://example.test', market: 'M', priceId: 'P', pageReference: '/all', scrapedAt: 't',
    sessionKeys: { customerKey: 'c', sessionKey: 's' }, pageSize: 2, pause: false, fetchJson, onRows: (rows) => pages.push(rows.map((r) => r.variantId)),
  });
  assert.deepEqual(pages, [['v1', 'v2'], ['v3']]);
});
