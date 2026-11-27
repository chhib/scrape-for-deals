import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseListingPage, parseProductPage } from '../stores/nordic-nest.js';

// Saved from https://www.nordicnest.se/black-friday/ and one product page on 2026-11-27, trimmed.
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('nordic nest: parses products and paging from a saved listing page', () => {
  const page = parseListingPage(fixture('nordic-nest-black-friday-p1.html'), '2026-11-27T19:15:00.000Z');

  assert.deepEqual(page.pagination, { total: 33199, currentPage: 1, pageCount: 923 });
  assert.deepEqual(page.rows.map((r) => [r.productId, r.variantId, r.title, r.variantName, r.price, r.previousPrice]), [
    ['107517', '512083-01', 'Lamino fåtölj oljad ek/fårskinn', 'Scandinavian Grey (grå)', 15218, 23486],
    ['6322', '6322-01', 'Kay Bojesen apa liten', 'Teak-limbaträ, 20 cm', 949, 1349],
    ['9002372', '9002372', 'Swedish Grace tallrik Ø27 cm 8-pack - Snö (vit)', null, 1344, 2600], // a bundle
  ]);
  const [lamino] = page.rows;
  assert.equal(lamino.store, 'Nordic Nest');
  assert.equal(lamino.brand, 'Swedese');
  assert.equal(lamino.url, 'https://www.nordicnest.se/varumarken/swedese/lamino-fatolj-oljad-ekfarskinn/?variantId=512083-01');
  assert.match(lamino.image, /^https:\/\/www\.nordicnest\.se\/assets\/blobs\/swedese-lamino/);
  assert.equal(lamino.currency, 'SEK');
  assert.equal(lamino.inStock, true);
  assert.equal(lamino.scrapedAt, '2026-11-27T19:15:00.000Z');
});

test('nordic nest: a product page gives every variant with its own price', () => {
  const rows = parseProductPage(fixture('nordic-nest-product-page.html'), 'x');
  assert.deepEqual(rows.map((r) => [r.store, r.productId, r.variantId, r.variantName, r.price, r.previousPrice, r.inStock]), [
    ['Nordic Nest', '107517', '512083-01', 'Scandinavian Grey (grå)', 15218, 23486, true],
    ['Nordic Nest', '107517', '512084-01', 'Sahara (nougatbrun)', 17169, 23486, true],
    ['Nordic Nest', '107517', '512078-01', 'Black (svart)', 19134, 23486, false],
  ]);
  assert.equal(rows[2].url, 'https://www.nordicnest.se/varumarken/swedese/lamino-fatolj-oljad-ekfarskinn/?variantId=512078-01');
});

test('nordic nest: the listing is walked in price ranges that leave no gap, each under the 10 000 cap', async () => {
  // reports/r3.md: walked by instock, the in-stock part (19 741) came back 151 short after four orders
  const { PARTS } = await import('../stores/nordic-nest.js');
  const ranges = PARTS.map((p) => p.price.split(',').map(Number));
  assert.equal(ranges[0][0], 0);
  for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i][0] > ranges[i - 1][1] && ranges[i][0] - ranges[i - 1][1] < 0.001, PARTS[i].price);
  assert.ok(ranges.at(-1)[1] >= 10_000_000);
});
