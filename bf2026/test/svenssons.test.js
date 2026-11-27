import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseListingPage, parseProductPage } from '../stores/svenssons.js';

const html = readFileSync(new URL('./fixtures/svenssons-black-friday-p1.html', import.meta.url), 'utf8');

test('svenssons: parses products and paging from a saved listing page', () => {
  const page = parseListingPage(html, '2026-11-27T17:00:00.000Z');

  assert.deepEqual(page.pagination, { total: 10932, currentPage: 1, pageCount: 304 });
  assert.equal(page.rows.length, 3);
  assert.deepEqual(page.rows[0], {
    store: 'Svenssons',
    productId: '108355',
    variantId: '514202-01',
    title: 'Pine adventsljusstake 62 cm',
    variantName: 'Vitlaserad',
    brand: 'Scandi Living',
    url: 'https://www.svenssons.se/varumarken/scandi-living/pine-adventsljusstake-62-cm/?variantId=514202-01',
    image: 'https://www.svenssons.se/assets/blobs/scandi-living-pine-adventsljusstake-62-cm-vitlaserad/514202-01_1_ProductImageMain-01d2e7385d.jpeg',
    price: 375,
    previousPrice: 1250,
    currency: 'SEK',
    inStock: true,
    scrapedAt: '2026-11-27T17:00:00.000Z',
  });
  assert.deepEqual(page.rows.map((r) => [r.variantId, r.price, r.previousPrice]), [
    ['514202-01', 375, 1250],
    ['643640-01', 165, 329],
    ['613666-01', 215, 429],
  ]);
});

test('svenssons: a page without listing data is an error, not an empty page', () => {
  assert.throws(() => parseListingPage('<html><body>Attention Required!</body></html>', 'x'), /INITIAL_DATA/);
});

test('svenssons: a bundle has no productId and is its own product', () => {
  // as sku 9001076 (a 6-pack bundle) came back from the live listing on 2026-11-27
  const bundle = html.replace('"productId":"108355",', '');
  assert.notEqual(bundle, html);
  const [row] = parseListingPage(bundle, 'x').rows;
  assert.equal(row.productId, '514202-01');
  assert.equal(row.variantId, '514202-01');
});

test('svenssons: a product page gives every variant with its own price, also those the listing leaves out', () => {
  const page = readFileSync(new URL('./fixtures/svenssons-product-page.html', import.meta.url), 'utf8');
  const rows = parseProductPage(page, '2026-11-27T17:00:00.000Z');

  assert.deepEqual(rows.map((r) => [r.productId, r.variantId, r.variantName, r.price, r.previousPrice, r.inStock]), [
    ['104894', '506247-01', 'White shade', 1574, 2099, true],
    ['104894', '506252-01', 'Yellow shade', 1574, 2099, true],
    ['104894', '506248-01', 'Lavender shade', 1679, 2099, true], // not on the Black Friday listing
  ]);
  assert.deepEqual(rows[2], {
    store: 'Svenssons',
    productId: '104894',
    variantId: '506248-01',
    title: 'Matin flush mount plafond Ø50 cm',
    variantName: 'Lavender shade',
    brand: 'HAY',
    url: 'https://www.svenssons.se/varumarken/hay/matin-flush-mount-plafond-o50-cm/?variantId=506248-01',
    image: 'https://www.svenssons.se/assets/blobs/hay-matin-flush-mount-plafond-50-cm-lavender-shade/506248-01_1_ProductImageMain-6662d539b7.jpg',
    price: 1679,
    previousPrice: 2099,
    currency: 'SEK',
    inStock: true,
    scrapedAt: '2026-11-27T17:00:00.000Z',
  });
});

test('svenssons: INITIAL_DATA written as concatenated string literals is read whole', () => {
  // Nordic Nest's pages split the literal around "<!--": JSON.parse('...<' + '!-- ...')
  const split = html.replace('"productName":"Pine adventsljusstake 62 cm"', `"productName":"Pine <' + '!-- adventsljusstake 62 cm"`);
  assert.notEqual(split, html);
  const [row] = parseListingPage(split, 'x').rows;
  assert.equal(row.title, 'Pine <!-- adventsljusstake 62 cm');
});
