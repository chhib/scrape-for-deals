import { test } from 'node:test';
import assert from 'node:assert/strict';
import { untilComplete } from '../walk.js';

const pass = (total, keys) => ({ total, keys, rows: keys.map((k) => ({ variantId: k })), pages: 1 });

test('walk: one pass is enough when it collects the site total', async () => {
  const seen = [];
  const result = await untilComplete(['a', 'b'], async (p) => (seen.push(p), pass(3, ['x', 'y', 'z'])));
  assert.deepEqual(seen, ['a']);
  assert.deepEqual({ siteTotal: result.siteTotal, collected: result.collected, pagesWalked: result.pagesWalked }, { siteTotal: 3, collected: 3, pagesWalked: 1 });
});

test('walk: a listing that shifted mid-walk is walked again in another order until nothing is missing', async () => {
  // as on 2026-11-27 18:33: Nordiska Galleriet gave 8 207 distinct of 8 229 in one pass
  const passes = { relevance: pass(4, ['x', 'y', 'y', 'z']), ascending: pass(4, ['w', 'x', 'y', 'z']) };
  const result = await untilComplete(['relevance', 'ascending', 'descending'], async (p) => passes[p]);
  assert.equal(result.collected, 4);
  assert.equal(result.siteTotal, 4);
  assert.equal(result.pagesWalked, 2);
  assert.equal(result.rows.length, 8);
});

test('walk: still short after every pass comes back short', async () => {
  const result = await untilComplete(['a', 'b'], async () => pass(5, ['x', 'y']));
  assert.equal(result.collected, 2);
  assert.equal(result.siteTotal, 5);
});

test('walk: a sample run takes the first pass only', async () => {
  const seen = [];
  await untilComplete(['a', 'b'], async (p) => (seen.push(p), pass(5, ['x'])), { firstPassOnly: true });
  assert.deepEqual(seen, ['a']);
});
