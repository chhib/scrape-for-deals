// From the db to files, at any time (also while a run is writing to it), and a saved run into the db.
//   export: products.csv, products.json, report.html, run.json and deals.json of what the db holds;
//           the top-100 also goes into the db's deals table.
//   import: products.json and run.json of a run made before the db, so the db holds every store.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rank } from './rank.js';
import { writeOutputs } from './output.js';
import { selectDeals } from './deals.js';

export const STORE_NAMES = {
  svenssons: 'Svenssons',
  'nordiska-galleriet': 'Nordiska Galleriet',
  'lanna-mobler': 'Länna Möbler',
  'nordic-nest': 'Nordic Nest',
};

// Svenssons and Nordic Nest list one variant per product and give the rest on each product page; the Elevate
// stores list every variant of a product group, so they have no product pages to read.
const VARIANTS_FROM = { Svenssons: 'product pages', 'Nordic Nest': 'product pages' };

export function exportDb(db, dir, { stores = [], exportedAt = new Date().toISOString() } = {}) {
  const names = stores.length ? stores.map((s) => STORE_NAMES[s] ?? s) : db.storeNames();
  const rows = rank(db.rows(names));
  const run = {
    generatedAt: exportedAt,
    exportedFromDb: true,
    stores: names.map((name) => db.summary(name)).filter(Boolean)
      .map((s) => ({ store: s.store, variantsFrom: VARIANTS_FROM[s.store] ?? 'listing', ...s })),
  };
  const files = writeOutputs(dir, rows, run);
  const deals = selectDeals(rows).map((d) => ({ ...d, exportedAt }));
  db.saveDeals(deals);
  files.deals = join(dir, 'deals.json');
  writeFileSync(
    files.deals,
    JSON.stringify({ exportedAt, totalRows: rows.length, stores: run.stores.map((s) => s.store), deals }, null, 1) + '\n',
  );
  return { rows, run, deals, files };
}

// A store whose run read every product page goes in as product page rows, its products marked read at the
// time of that run, so a resumed run does not read them again within the max age.
export function importRun(db, dir) {
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  const rows = JSON.parse(readFileSync(join(dir, 'products.json'), 'utf8'));
  const counts = {};
  for (const summary of run.stores) {
    const name = STORE_NAMES[summary.store] ?? summary.store;
    const storeRows = rows.filter((r) => r.store === name);
    const pages = summary.listings.find((l) => l.listing.startsWith('product pages'));
    const pagesComplete = !run.sample && pages && pages.collected === pages.siteTotal;
    const keep = ({ store, productId, variantId, title, variantName, brand, url, image, price, previousPrice, currency, inStock, scrapedAt }) =>
      ({ store, productId, variantId, title, variantName, brand, url, image, price, previousPrice, currency, inStock, scrapedAt });
    if (pagesComplete) {
      const byProduct = new Map();
      const bundles = [];
      for (const r of storeRows) {
        if (r.productId === r.variantId) bundles.push(keep(r));
        else {
          if (!byProduct.has(r.productId)) byProduct.set(r.productId, []);
          byProduct.get(r.productId).push(keep(r));
        }
      }
      db.saveListingRows(bundles);
      for (const [productId, productRows] of byProduct) db.saveProductPage(name, productId, productRows, productRows[0].scrapedAt);
    } else {
      db.saveListingRows(storeRows.map(keep));
    }
    for (const listing of summary.listings) db.saveListing(name, listing, summary.generatedAt ?? run.generatedAt);
    counts[name] = { rows: storeRows.length, asProductPages: Boolean(pagesComplete) };
  }
  return counts;
}
