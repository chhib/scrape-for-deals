import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeStatus } from '../check.js';

const good = { store: 'S', productId: 'p', variantId: 'v', title: 'T', price: 10, previousPrice: 20 };
const listing = (siteTotal, collected) => ({ listing: '/all', siteTotal, collected, pagesWalked: 1, counted: 'products' });

test('check: a full run is complete only when every listing collected the site total', () => {
  assert.deepEqual(storeStatus([good], [listing(10, 10)], { sample: false }), { status: 'complete', problems: [] });
  const short = storeStatus([good], [listing(10, 10), listing(5159, 5150)], { sample: false });
  assert.equal(short.status, 'incomplete');
  assert.match(short.problems[0], /\/all: collected 5150 of 5159/);
  // a product delisted mid-walk leaves more collected than the site now counts: nothing is missing
  assert.equal(storeStatus([good], [listing(10, 11)], { sample: false }).status, 'complete');
});

test('check: a sample run is not held to the site total, but is held to filled rows', () => {
  assert.equal(storeStatus([good], [listing(8460, 120)], { sample: true }).status, 'sample');
  assert.equal(storeStatus([], [listing(8460, 0)], { sample: true }).status, 'failed');
  for (const broken of [{ ...good, title: '' }, { ...good, price: NaN }, { ...good, variantId: null }, { ...good, productId: undefined }]) {
    const result = storeStatus([good, broken], [listing(1, 1)], { sample: true });
    assert.equal(result.status, 'failed');
    assert.match(result.problems[0], /1 rows lack/);
  }
});
