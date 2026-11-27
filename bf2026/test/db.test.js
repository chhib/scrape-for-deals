import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db.js';
import { exportDb, importRun } from '../export.js';
import { selectDeals } from '../deals.js';

const ORIGIN = 'https://shop.test';
const row = (variantId, price, previousPrice, extra = {}) => ({
  store: 'Nordic Nest', productId: 'lamp', variantId, title: 'Lamp', variantName: variantId, brand: 'B',
  url: `${ORIGIN}/lamp/?variantId=${variantId}`, image: `${ORIGIN}/img/${variantId}.jpg`, price, previousPrice,
  currency: 'SEK', inStock: true, scrapedAt: '2026-11-27T20:00:00.000Z', ...extra,
});
const byVariant = (rows) => Object.fromEntries(rows.map((r) => [r.variantId, r]));

test('db: a listing page is saved as it is parsed, and a later page upserts the same variant by store and variantId', () => {
  const db = openDb(':memory:');
  db.saveListingRows([row('a', 1000, 2000), row('b', 1500, 2000)]);
  db.saveListingRows([row('a', 900, 2000, { scrapedAt: '2026-11-27T21:00:00.000Z' })]);

  const rows = byVariant(db.rows());
  assert.equal(Object.keys(rows).length, 2);
  assert.equal(rows.a.price, 900);
  assert.equal(rows.a.scrapedAt, '2026-11-27T21:00:00.000Z');
  assert.deepEqual(rows.b, row('b', 1500, 2000)); // read back as it went in, URLs whole again
});

test('db: product page rows override the listing rows of the same product and add the variants the listing left out', () => {
  const db = openDb(':memory:');
  db.saveListingRows([row('metal', 3000, 4000)]);
  db.saveProductPage('Nordic Nest', 'lamp', [row('metal', 2990, 4000), row('opal', 900, 5000)]);
  db.saveListingRows([row('metal', 3000, 4000)]); // the next listing pass leaves the product page row alone

  const rows = byVariant(db.rows());
  assert.deepEqual(Object.keys(rows).sort(), ['metal', 'opal']);
  assert.equal(rows.metal.price, 2990);
  assert.equal(rows.opal.price, 900);
});

test('db: an older row never replaces a newer one, so importing an earlier run cannot undo a later one', () => {
  const db = openDb(':memory:');
  db.saveListingRows([row('a', 900, 2000, { scrapedAt: '2026-11-27T21:00:00.000Z' })]);
  db.saveListingRows([row('a', 1000, 2000, { scrapedAt: '2026-11-27T18:00:00.000Z' })]);
  assert.equal(db.rows()[0].price, 900);
});

test('db: resume, a product page read within the max age is not read again; an older or unread one is', () => {
  const db = openDb(':memory:');
  const hour = 3600_000;
  const now = Date.parse('2026-11-28T08:00:00.000Z');
  db.saveProductPage('Nordic Nest', 'lamp', [row('opal', 900, 5000)], '2026-11-27T21:00:00.000Z'); // 11 h before now
  db.saveProductPage('Nordic Nest', 'sofa', [row('s1', 9000, 15000, { productId: 'sofa' })], '2026-11-27T19:00:00.000Z'); // 13 h

  assert.deepEqual(db.freshProductRows('Nordic Nest', 'lamp', 12 * hour, now), [row('opal', 900, 5000)]);
  assert.equal(db.freshProductRows('Nordic Nest', 'sofa', 12 * hour, now), null);
  assert.equal(db.freshProductRows('Nordic Nest', 'chair', 12 * hour, now), null);
  assert.equal(db.freshProductRows('Svenssons', 'lamp', 12 * hour, now), null);
});

test('db: a product page read with no variants still counts as read', () => {
  const db = openDb(':memory:');
  db.saveProductPage('Nordic Nest', 'gone', [], new Date().toISOString());
  assert.deepEqual(db.freshProductRows('Nordic Nest', 'gone', 3600_000), []);
});

test('export: ranks what the db holds mid-run; read products use their product page rows, unread ones keep their listing row', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf2026-export-'));
  try {
    const db = openDb(':memory:');
    db.saveListingRows([
      row('metal', 3000, 4000),
      row('c1', 5000, 8000, { productId: 'chair', title: 'Chair' }),
      row('bundle', 1344, 2600, { productId: 'bundle', title: '8-pack' }),
    ]);
    db.saveProductPage('Nordic Nest', 'lamp', [row('metal', 3000, 4000), row('opal', 900, 5000)]);
    db.saveListing('Nordic Nest', { listing: '/black-friday/?price=0,200', counted: 'products', siteTotal: 3, collected: 3, pagesWalked: 1 });

    const { rows, files, run } = exportDb(db, dir, { stores: ['nordic-nest'], exportedAt: 'e' });

    assert.deepEqual(rows.map((r) => r.variantId).sort(), ['bundle', 'c1', 'metal', 'opal']);
    assert.equal(rows[0].variantId, 'opal'); // ranked: the opal undercuts its ordinarily cheaper sibling
    assert.equal(rows[0].flagInverted, true);
    const saved = JSON.parse(readFileSync(files.json, 'utf8'));
    assert.equal(saved.length, 4);
    assert.match(readFileSync(files.csv, 'utf8'), /^store,/);
    assert.match(readFileSync(files.html, 'utf8'), /<!DOCTYPE html>/);
    const [store] = JSON.parse(readFileSync(files.run, 'utf8')).stores;
    assert.deepEqual(store, run.stores[0]);
    assert.equal(store.store, 'Nordic Nest');
    assert.equal(store.productsListed, 2); // lamp and chair; the bundle has no product page
    assert.equal(store.productsWithVariantsFetched, 1);
    assert.equal(store.variantsFromProductPages, 2);
    assert.equal(store.variantsFromListing, 2);
    assert.deepEqual(store.listings.map((l) => [l.listing, l.siteTotal, l.collected]), [['/black-friday/?price=0,200', 3, 3]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deals: in stock only, inverted per decision 9 with one row per title, then deep discounts up to 100', () => {
  const base = { store: 'S', productId: 'p', brand: null, variantName: null, url: 'u', image: 'i', inStock: true, flagInverted: false };
  const rows = [
    // inverted against an ordinarily cheaper sibling: any gap counts
    { ...base, variantId: 'd1', title: 'Dearer', price: 2900, previousPrice: 5000, discountPct: 42, savingKr: 2100, flagInverted: true, invertedGapKr: 100, undercutsPrice: 3000, undercutsPreviousPrice: 4000 },
    // same ordinary price: 2 600 kr and 26 % passes; a second row of the title with a smaller gap is left out
    { ...base, variantId: 'e1', title: 'Equal', price: 7400, previousPrice: 12000, discountPct: 38, savingKr: 4600, flagInverted: true, invertedGapKr: 2600, undercutsPrice: 10000, undercutsPreviousPrice: 12000 },
    { ...base, variantId: 'e2', title: 'Equal', price: 7450, previousPrice: 12000, discountPct: 38, savingKr: 4550, flagInverted: true, invertedGapKr: 2550, undercutsPrice: 10000, undercutsPreviousPrice: 12000 },
    // same ordinary price, 500 kr (5 %): not a deal
    { ...base, variantId: 'x1', title: 'Small gap', price: 9500, previousPrice: 12000, discountPct: 21, savingKr: 2500, flagInverted: true, invertedGapKr: 500, undercutsPrice: 10000, undercutsPreviousPrice: 12000 },
    // out of stock never shows
    { ...base, variantId: 'o1', title: 'Gone', price: 100, previousPrice: 20000, discountPct: 99.5, savingKr: 19900, inStock: false },
    // deep: 40 % and 2 000 kr; the title already in "inverted" is left out of "deep"
    { ...base, variantId: 'deep1', title: 'Sofa', price: 6000, previousPrice: 15000, discountPct: 60, savingKr: 9000 },
    { ...base, variantId: 'deep2', title: 'Table', price: 3000, previousPrice: 6000, discountPct: 50, savingKr: 3000 },
    { ...base, variantId: 'deep3', title: 'Dearer', price: 1000, previousPrice: 5000, discountPct: 80, savingKr: 4000 },
    { ...base, variantId: 'n1', title: 'Cheap', price: 500, previousPrice: 1000, discountPct: 50, savingKr: 500 }, // under 2 000 kr saved
  ];
  const deals = selectDeals(rows);
  assert.deepEqual(deals.map((d) => [d.section, d.rank, d.variantId, d.more]), [
    ['inverted', 1, 'e1', 1],
    ['inverted', 2, 'd1', 0],
    ['deep', 1, 'deep1', 0],
    ['deep', 2, 'deep2', 0],
  ]);

  const many = Array.from({ length: 150 }, (_, i) => ({ ...base, variantId: `m${i}`, title: `T${i}`, price: 1000, previousPrice: 4000 + i, discountPct: 75, savingKr: 3000 + i }));
  const inverted = Array.from({ length: 50 }, (_, i) => ({ ...base, variantId: `i${i}`, title: `I${i}`, price: 100, previousPrice: 200, flagInverted: true, invertedGapKr: 10 + i, undercutsPrice: 110 + i, undercutsPreviousPrice: 150 }));
  const capped = selectDeals([...many, ...inverted]);
  assert.equal(capped.filter((d) => d.section === 'inverted').length, 40);
  assert.equal(capped.length, 100);
  assert.equal(capped.find((d) => d.section === 'deep').variantId, 'm149');
});

test('export: the top-100 goes into the deals table and deals.json next to the export', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf2026-deals-'));
  try {
    const db = openDb(':memory:');
    db.saveProductPage('Nordic Nest', 'lamp', [row('metal', 3000, 4000), row('opal', 2900, 5000)]);
    db.saveListingRows([row('s1', 6000, 15000, { productId: 'sofa', title: 'Sofa' })]);

    const { files } = exportDb(db, dir, { exportedAt: '2026-11-27T22:00:00.000Z' });

    const table = db.deals();
    assert.deepEqual(table.map((d) => [d.section, d.rank, d.store, d.variantId]), [
      ['inverted', 1, 'Nordic Nest', 'opal'],
      ['deep', 1, 'Nordic Nest', 's1'],
    ]);
    assert.equal(table[0].undercutsVariantName, 'metal');
    assert.equal(table[0].url, `${ORIGIN}/lamp/?variantId=opal`);
    const json = JSON.parse(readFileSync(files.deals, 'utf8'));
    assert.equal(json.exportedAt, '2026-11-27T22:00:00.000Z');
    assert.equal(json.totalRows, 3);
    assert.deepEqual(json.deals.map((d) => d.variantId), ['opal', 's1']);

    exportDb(db, dir, { exportedAt: 'later' }); // the table holds the latest export only
    assert.equal(db.deals().length, 2);
    assert.ok(db.deals().every((d) => d.exportedAt === 'later'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('import: a saved run goes into the db; a store whose run read every product page counts as read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf2026-import-'));
  try {
    const at = new Date(Date.now() - 3600_000).toISOString();
    const rows = [
      { ...row('opal', 900, 5000), store: 'Svenssons', scrapedAt: at, flagInverted: true, flagCount: 3 },
      { ...row('g1', 500, 1000), store: 'Länna Möbler', productId: 'g', scrapedAt: at },
    ];
    writeFileSync(join(dir, 'products.json'), JSON.stringify(rows));
    writeFileSync(join(dir, 'run.json'), JSON.stringify({
      generatedAt: at, sample: false, stores: [
        { store: 'svenssons', listings: [
          { listing: '/black-friday/?instock=true', counted: 'products', siteTotal: 1, collected: 1, pagesWalked: 1 },
          { listing: 'product pages (all variants of each listed product)', siteTotal: 1, collected: 1, pagesWalked: 1, counted: 'products' },
        ] },
        { store: 'lanna-mobler', listings: [{ listing: '/FLAGS/All-Campaign-Products', counted: 'products', siteTotal: 1, collected: 1, pagesWalked: 1 }] },
      ],
    }));
    const db = openDb(':memory:');

    assert.deepEqual(importRun(db, dir), { Svenssons: { rows: 1, asProductPages: true }, 'Länna Möbler': { rows: 1, asProductPages: false } });

    assert.deepEqual(db.storeNames(), ['Svenssons', 'Länna Möbler']);
    assert.equal(db.rows(['Svenssons'])[0].flagInverted, undefined); // ranking columns are not stored, export ranks again
    assert.equal(db.freshProductRows('Svenssons', 'lamp', 12 * 3600_000).length, 1);
    assert.equal(db.summary('Länna Möbler').variantsFromListing, 1);
    assert.equal(db.summary('Svenssons').listings.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('db: compact folds the log into the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf2026-compact-'));
  try {
    mkdirSync(join(dir, 'data'));
    const path = join(dir, 'data', 'bf.db');
    const db = openDb(path);
    db.saveListingRows([row('a', 1, 2)]);
    db.compact();
    db.close();
    const again = openDb(path);
    assert.equal(again.rows().length, 1);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
