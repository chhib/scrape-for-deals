import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rerank } from '../rerank.js';

test('rerank: saved rows are ranked again by the current rules and every output is rewritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf2026-rerank-'));
  try {
    const row = (variantId, price) => ({ store: 'S', productId: 'sofa', variantId, title: 'Sofa', price, previousPrice: 16000 });
    // as a run under the old rule saved them: b marked inverted against a, 2 500 kr below at the same ordinary price
    const saved = [
      { ...row('b', 9500), flagInverted: true, invertedGapKr: 2500, undercutsVariantId: 'a', flagCount: 2 },
      { ...row('a', 12000), flagInverted: false, invertedGapKr: null, undercutsVariantId: null, flagCount: 0 },
    ];
    writeFileSync(join(dir, 'products.json'), JSON.stringify(saved));
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ generatedAt: 'g', sample: false, stores: [], failed: [] }));

    rerank([dir], 'r');

    const rows = JSON.parse(readFileSync(join(dir, 'products.json'), 'utf8'));
    const b = rows.find((r) => r.variantId === 'b');
    assert.equal(b.flagInverted, false);
    assert.equal(b.invertedGapKr, null);
    assert.equal(b.undercutsVariantId, null);
    assert.equal(b.flagCount, 1); // only flagSavingOver5000 (6 500 kr) is left
    const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    assert.equal(run.generatedAt, 'g');
    assert.equal(run.rerankedAt, 'r');
    assert.match(readFileSync(join(dir, 'products.csv'), 'utf8'), /^store,/);
    assert.match(readFileSync(join(dir, 'report.html'), 'utf8'), /<!DOCTYPE html>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rerank: a later run of one store is merged into the first folder and ranked with it', () => {
  const root = mkdtempSync(join(tmpdir(), 'bf2026-merge-'));
  try {
    const save = (name, rows, store) => {
      const dir = join(root, name);
      mkdirSync(dir);
      writeFileSync(join(dir, 'products.json'), JSON.stringify(rows));
      writeFileSync(join(dir, 'run.json'), JSON.stringify({ generatedAt: name, sample: false, stores: [{ store, status: 'complete' }], failed: [] }));
      return dir;
    };
    const row = (store, variantId, price, previousPrice) => ({ store, productId: 'p', variantId, title: 't', price, previousPrice });
    const all = save('all', [row('A', 'a1', 900, 1000)], 'a');
    const one = save('one', [row('N', 'n1', 2000, 15000)], 'n');

    rerank([all, one], 'r');

    const rows = JSON.parse(readFileSync(join(all, 'products.json'), 'utf8'));
    assert.deepEqual(rows.map((r) => r.variantId), ['n1', 'a1']);
    assert.equal(rows[0].flagUnder25Pct, true);
    const run = JSON.parse(readFileSync(join(all, 'run.json'), 'utf8'));
    assert.deepEqual(run.stores.map((s) => s.store), ['a', 'n']);
    assert.deepEqual(run.mergedFrom, [{ dir: one, generatedAt: 'one' }]);
    assert.equal(JSON.parse(readFileSync(join(one, 'products.json'), 'utf8')).length, 1); // the merged folder is left as it was
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rerank: a store in a later folder replaces that store\'s rows and summary from the earlier folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'bf2026-replace-'));
  try {
    const save = (name, rows, stores) => {
      const dir = join(root, name);
      mkdirSync(dir);
      writeFileSync(join(dir, 'products.json'), JSON.stringify(rows));
      writeFileSync(join(dir, 'run.json'), JSON.stringify({ generatedAt: name, sample: false, stores: stores.map((store) => ({ store })), failed: [] }));
      return dir;
    };
    const row = (store, variantId) => ({ store, productId: variantId, variantId, title: 't', price: 900, previousPrice: 1000 });
    const all = save('all', [row('A', 'a-old'), row('B', 'b-old')], ['a', 'b']);
    const again = save('again', [row('B', 'b-new')], ['b']);

    rerank([all, again], 'r');

    const rows = JSON.parse(readFileSync(join(all, 'products.json'), 'utf8'));
    assert.deepEqual(rows.map((r) => r.variantId).sort(), ['a-old', 'b-new']);
    const run = JSON.parse(readFileSync(join(all, 'run.json'), 'utf8'));
    assert.deepEqual(run.stores.map((s) => [s.store, s.generatedAt]), [['a', 'all'], ['b', 'again']]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
